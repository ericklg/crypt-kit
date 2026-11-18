import { createMemoryStore, createRunner, silentLogger, type ActionResult, type Finding } from '@crypt-kit/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { BoardAccessError, createBoardActions, DEFAULT_FAILURE_MESSAGES, loadBoard, parseApproveEdits } from './server.js';

const payloadSchema = z.object({ n: z.number() });
type P = z.infer<typeof payloadSchema>;

const finding = (key: string, n = 1): Finding<P> => ({
  key,
  kind: 'test',
  severity: 'low',
  title: `Item ${key}`,
  url: null,
  payload: { n },
  observedAt: '2026-11-18T00:00:00.000Z',
});

function setup(action: () => Promise<ActionResult> = async () => ({ ok: true, message: 'Posted', url: null })) {
  let findings: Finding<P>[] = [finding('a'), finding('b')];
  const run = vi.fn(action);
  // A clock that moves on every read, so runs never share a millisecond.
  const start = Date.now();
  let tick = 0;
  const runner = createRunner<P>({
    now: () => new Date(start + tick++),
    detector: { id: 'd', payloadSchema, poll: async () => findings },
    agent: { draft: async (f) => ({ summary: 's', proposal: `About ${f.key}`, reasoning: 'r', options: { close: false } }) },
    action: { id: 'act', run },
    store: createMemoryStore(),
    log: silentLogger,
  });
  return { runner, run, setFindings: (f: Finding<P>[]) => (findings = f) };
}

const present = { meta: () => 'meta', age: () => 'age' };

describe('loadBoard', () => {
  it('lists open haunts as views and counts approvals from the last 7 days', async () => {
    const t = setup();
    await t.runner.run();
    const before = await loadBoard(t.runner, present);
    expect(before.haunts.map((h) => h.key)).toEqual(['a', 'b']);
    expect(before.score).toBe(0);
    expect(JSON.stringify(before)).not.toContain('"payload"');

    await createBoardActions(() => t.runner).approve('a', { proposal: 'Hi', options: {}, revision: before.haunts[0]!.revision });
    const after = await loadBoard(t.runner, present);
    expect(after.haunts.map((h) => h.key)).toEqual(['b']);
    expect(after.score).toBe(1);

    const nextWeek = await loadBoard(t.runner, present, { now: new Date(Date.now() + 8 * 24 * 3600_000) });
    expect(nextWeek.score).toBe(0);
  });
});

describe('createBoardActions', () => {
  it('passes edits and the reviewed revision, and refuses a revision the haunt has moved past', async () => {
    const t = setup();
    await t.runner.run();
    const [a] = (await loadBoard(t.runner, present)).haunts;
    const actions = createBoardActions(() => t.runner);

    t.setFindings([finding('a', 2), finding('b')]);
    await t.runner.run(); // payload changed: a has a newer version now

    expect(await actions.approve('a', { proposal: 'Stale', options: {}, revision: a!.revision })).toEqual({
      ok: false,
      message: DEFAULT_FAILURE_MESSAGES.conflict,
    });
    expect(t.run).not.toHaveBeenCalled();

    const [fresh] = (await loadBoard(t.runner, present)).haunts;
    expect(await actions.approve('a', { proposal: 'Fresh', options: { close: true }, revision: fresh!.revision })).toEqual({ ok: true });
    expect(t.run).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'a' }),
      expect.objectContaining({ proposal: 'Fresh', options: { close: true } }),
      expect.anything(),
    );
  });

  it('reports a failed action with its own error', async () => {
    const t = setup(async () => ({ ok: false, error: 'GitHub returned 403.' }));
    await t.runner.run();
    const [a] = (await loadBoard(t.runner, present)).haunts;
    expect(await createBoardActions(() => t.runner).approve('a', { proposal: 'x', options: {}, revision: a!.revision })).toEqual({
      ok: false,
      message: 'GitHub returned 403.',
    });
  });

  it('runs the guard before every operation and shows its refusal', async () => {
    const t = setup();
    await t.runner.run();
    const guard = vi.fn(async (_op: string) => {
      throw new BoardAccessError('Sign in to act on haunts.');
    });
    const actions = createBoardActions(() => t.runner, { guard });
    const refused = { ok: false, message: 'Sign in to act on haunts.' };

    expect(await actions.approve('a', { proposal: 'x', options: {}, revision: 1 })).toEqual(refused);
    expect(await actions.spare('a')).toEqual(refused);
    expect(await actions.redraft('a')).toEqual(refused);
    expect(await actions.settle('a', 'done')).toEqual(refused);
    expect(await actions.run()).toEqual(refused);
    expect(guard.mock.calls.map(([op]) => op)).toEqual(['approve', 'spare', 'redraft', 'settle', 'run']);
    expect(t.run).not.toHaveBeenCalled();
    expect((await t.runner.list(['spared'])).length).toBe(0);
  });

  it('lets other guard errors fail the request', async () => {
    const t = setup();
    const actions = createBoardActions(() => t.runner, {
      guard: async () => {
        throw new Error('boom');
      },
    });
    await expect(actions.spare('a')).rejects.toThrow('boom');
  });

  it('rejects malformed input from a direct POST without touching the runner', async () => {
    const t = setup();
    await t.runner.run();
    const spy = vi.spyOn(t.runner, 'approve');
    const actions = createBoardActions(() => t.runner);
    const bad = { ok: false, message: DEFAULT_FAILURE_MESSAGES.invalid };

    expect(await actions.approve('a', { proposal: 1, options: {}, revision: 1 } as never)).toEqual(bad);
    expect(await actions.approve('a', { proposal: 'x', options: { close: 'yes' }, revision: 1 } as never)).toEqual(bad);
    expect(await actions.approve('a', { proposal: 'x', options: {} } as never)).toEqual(bad);
    expect(await actions.approve(42 as never, { proposal: 'x', options: {}, revision: 1 })).toEqual(bad);
    expect(await actions.settle('a', 'maybe' as never)).toEqual(bad);
    expect(await actions.spare('x'.repeat(513))).toEqual(bad);
    expect(spy).not.toHaveBeenCalled();
  });

  it('hides runner internals behind plain messages', async () => {
    const t = setup();
    await t.runner.run();
    const actions = createBoardActions(() => t.runner, { messages: { not_found: 'Gone.' } });
    expect(await actions.spare('missing')).toEqual({ ok: false, message: 'Gone.' });
    await actions.spare('a');
    expect(await actions.spare('a')).toEqual({ ok: false, message: DEFAULT_FAILURE_MESSAGES.not_allowed });
  });
});

describe('parseApproveEdits', () => {
  it('drops unknown fields', () => {
    expect(parseApproveEdits({ proposal: 'x', options: { close: true }, revision: 2, extra: 1 })).toEqual({
      proposal: 'x',
      options: { close: true },
      revision: 2,
    });
  });
});
