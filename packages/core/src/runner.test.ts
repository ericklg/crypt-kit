import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Action, ActionResult } from './action.js';
import type { Detector } from './detector.js';
import type { Agent } from './draft.js';
import type { Finding } from './finding.js';
import { silentLogger } from './logger.js';
import { createRunner, DEFAULT_SETTLE_AFTER_MS, type RunnerOptions } from './runner.js';
import { createMemoryStore, type TrackerStore } from './tracker.js';

const payloadSchema = z.object({ count: z.number() });
type Payload = z.infer<typeof payloadSchema>;

function finding(key: string, count = 1): Finding<Payload> {
  return {
    key,
    kind: 'test',
    severity: 'low',
    title: `Item ${key}`,
    url: `https://example.com/${key}`,
    payload: { count },
    observedAt: '2026-11-01T00:00:00.000Z',
  };
}

/** A detector whose next poll result the test controls, plus an event log shared with the agent. */
function setup(overrides: Partial<RunnerOptions<Payload>> = {}) {
  const events: string[] = [];
  let next: unknown[] | (() => Promise<unknown[]>) = [];

  const detector: Detector<Payload> = {
    id: 'test-detector',
    payloadSchema,
    async poll() {
      events.push('poll:start');
      const result = typeof next === 'function' ? await next() : next;
      events.push('poll:end');
      return result as Finding<Payload>[];
    },
  };

  const draft = vi.fn<Agent<Payload>['draft']>(async (f) => {
    events.push(`draft:${f.key}`);
    return { summary: `About ${f.key}`, proposal: `Do something with ${f.key}`, reasoning: 'Because', options: { close: true } };
  });

  const run = vi.fn<Action<Payload>['run']>(async (): Promise<ActionResult> => ({ ok: true, message: 'Done', url: null }));

  const store = createMemoryStore();
  let tick = 0;
  const runner = createRunner<Payload>({
    detector,
    agent: { draft },
    action: { id: 'test-action', run },
    store,
    log: silentLogger,
    now: () => new Date(Date.UTC(2026, 10, 1, 0, 0, tick++)),
    ...overrides,
  });

  return {
    runner,
    store,
    draft,
    actionRun: run,
    events,
    setFindings(value: unknown[] | (() => Promise<unknown[]>)) {
      next = value;
    },
  };
}

describe('run: detect and remember', () => {
  it('creates and drafts haunts for new findings', async () => {
    const t = setup();
    t.setFindings([finding('a'), finding('b')]);

    const report = await t.runner.run();

    expect(report).toMatchObject({ ok: true, found: 2, created: 2, drafted: 2, draftFailed: 0 });
    const haunts = await t.runner.list();
    expect(haunts.map((h) => [h.key, h.status])).toEqual([
      ['a', 'drafted'],
      ['b', 'drafted'],
    ]);
    expect(haunts[0]?.draft?.proposal).toBe('Do something with a');
  });

  it('never calls the agent before poll has finished', async () => {
    const t = setup();
    t.setFindings([finding('a'), finding('b')]);

    await t.runner.run();

    expect(t.events).toEqual(['poll:start', 'poll:end', 'draft:a', 'draft:b']);
  });

  it('does not draft a tracked finding again on the next run', async () => {
    const t = setup();
    t.setFindings([finding('a')]);
    await t.runner.run();

    const report = await t.runner.run();

    expect(report).toMatchObject({ created: 0, drafted: 0 });
    expect(t.draft).toHaveBeenCalledTimes(1);
  });

  it('marks haunts resolved when the source stops reporting them, and reopens them if they return', async () => {
    const t = setup();
    t.setFindings([finding('a'), finding('b')]);
    await t.runner.run();
    const firstSeenAt = (await t.store.get('b'))?.firstSeenAt;

    t.setFindings([finding('a')]);
    const second = await t.runner.run();
    expect(second.resolved).toBe(1);
    expect((await t.store.get('b'))?.status).toBe('resolved');

    t.setFindings([finding('a'), finding('b')]);
    const third = await t.runner.run();
    expect(third).toMatchObject({ reopened: 1, drafted: 1 });
    const b = await t.store.get('b');
    expect(b?.status).toBe('drafted');
    expect(firstSeenAt).toBeDefined();
    expect(b?.firstSeenAt).toBe(firstSeenAt);
    expect(b?.updatedAt).not.toBe(firstSeenAt);
  });

  it('does not resolve an approved haunt that disappears', async () => {
    const t = setup();
    t.setFindings([finding('a')]);
    await t.runner.run();
    await t.runner.approve('a');

    t.setFindings([]);
    const report = await t.runner.run();

    expect(report.resolved).toBe(0);
    expect((await t.store.get('a'))?.status).toBe('approved');
  });

  it('drops findings with an invalid payload or envelope and keeps the rest', async () => {
    const warn = vi.fn();
    const t = setup({ log: { ...silentLogger, warn } });
    t.setFindings([
      finding('good'),
      { ...finding('bad-payload'), payload: { count: 'many' } },
      { ...finding('bad-envelope'), severity: 'apocalyptic' },
      { ...finding(''), title: 'empty key' },
    ]);

    const report = await t.runner.run();

    expect(report).toMatchObject({ found: 1, invalid: 3, created: 1 });
    expect((await t.runner.list()).map((h) => h.key)).toEqual(['good']);
    expect(warn).toHaveBeenCalledWith('dropped finding with invalid payload', expect.objectContaining({ key: 'bad-payload' }));
  });

  it('does not resolve a tracked haunt that comes back with invalid data', async () => {
    const t = setup();
    t.setFindings([finding('a')]);
    await t.runner.run();

    t.setFindings([{ ...finding('a'), payload: { count: 'broken' } }]);
    const report = await t.runner.run();

    expect(report).toMatchObject({ invalid: 1, resolved: 0 });
    expect((await t.store.get('a'))?.status).toBe('drafted');
    expect(t.draft).toHaveBeenCalledTimes(1);
  });

  it('keeps the first finding when a poll repeats a key', async () => {
    const t = setup();
    t.setFindings([finding('a', 1), finding('a', 2)]);

    const report = await t.runner.run();

    expect(report).toMatchObject({ found: 1, invalid: 1 });
    expect((await t.store.get('a'))?.finding.payload).toEqual({ count: 1 });
  });

  it('resolves nothing and reports an error when poll throws', async () => {
    const t = setup();
    t.setFindings([finding('a')]);
    await t.runner.run();

    t.setFindings(async () => {
      throw new Error('GitHub is down');
    });
    const report = await t.runner.run();

    expect(report).toMatchObject({ ok: false, error: 'GitHub is down', resolved: 0 });
    expect((await t.store.get('a'))?.status).toBe('drafted');
  });

  it('treats a non-array poll result as a failed poll', async () => {
    const t = setup();
    t.setFindings(async () => ({ not: 'an array' }) as unknown as unknown[]);

    const report = await t.runner.run();

    expect(report).toMatchObject({ ok: false, created: 0 });
  });

  it('shares one in-flight run between concurrent callers', async () => {
    const t = setup();
    let release!: () => void;
    t.setFindings(() => new Promise((resolve) => (release = () => resolve([finding('a')]))));

    const first = t.runner.run();
    const second = t.runner.run();
    release();

    expect(await first).toBe(await second);
    expect(t.events.filter((e) => e === 'poll:start')).toHaveLength(1);
  });

  it('shares one in-flight run across runners on the same store and detector', async () => {
    const t = setup();
    let release!: () => void;
    t.setFindings(() => new Promise((resolve) => (release = () => resolve([finding('a')]))));
    const otherPoll = vi.fn(async () => [] as Finding<Payload>[]);
    const other = createRunner<Payload>({
      detector: { id: 'test-detector', payloadSchema, poll: otherPoll },
      agent: { draft: t.draft },
      action: { id: 'test-action', run: t.actionRun },
      store: t.store,
      log: silentLogger,
    });

    const first = t.runner.run();
    const second = other.run();
    release();

    expect(await second).toBe(await first);
    expect(otherPoll).not.toHaveBeenCalled();
    expect((await t.store.get('a'))?.status).toBe('drafted');
  });

  it('does not resolve a haunt that a newer poll saw while this poll was running', async () => {
    const t = setup();
    let release!: () => void;
    t.setFindings(() => new Promise((resolve) => (release = () => resolve([]))));

    const running = t.runner.run();
    // Simulate another process finishing a newer poll that created and drafted "a".
    await t.store.put({
      key: 'a',
      detectorId: 'test-detector',
      status: 'drafted',
      version: 1,
      finding: finding('a'),
      payloadHash: 'x',
      sparedPayloadHash: null,
      draft: { summary: 's', proposal: 'p', reasoning: 'r', options: {} },
      result: null,
      error: null,
      firstSeenAt: '2099-01-01T00:00:00.000Z',
      lastSeenAt: '2099-01-01T00:00:00.000Z',
      updatedAt: '2099-01-01T00:00:00.000Z',
    }, null);
    release();
    const report = await running;

    expect(report.resolved).toBe(0);
    expect((await t.store.get('a'))?.status).toBe('drafted');
  });

  it('matches trimmed keys so a padded key is not resolved in its own run', async () => {
    const t = setup();
    t.setFindings([finding(' a ')]);

    const first = await t.runner.run();
    const second = await t.runner.run();

    expect(first).toMatchObject({ created: 1, resolved: 0, drafted: 1 });
    expect(second).toMatchObject({ created: 0, resolved: 0, drafted: 0 });
    expect((await t.store.get('a'))?.status).toBe('drafted');
    expect(t.draft).toHaveBeenCalledTimes(1);
  });

  it('ignores keys owned by another detector in a shared store', async () => {
    const t = setup();
    await t.store.put({
      key: 'a',
      detectorId: 'someone-else',
      status: 'drafted',
      version: 1,
      finding: finding('a'),
      payloadHash: 'x',
      sparedPayloadHash: null,
      draft: null,
      result: null,
      error: null,
      firstSeenAt: '2026-10-01T00:00:00.000Z',
      lastSeenAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    }, null);
    t.setFindings([finding('a')]);

    const report = await t.runner.run();

    expect(report.created).toBe(0);
    expect((await t.store.get('a'))?.detectorId).toBe('someone-else');
    expect(await t.runner.list()).toEqual([]);
  });
});

describe('run: agent handoff', () => {
  it('caps drafts per run and drafts the rest on the next run', async () => {
    const t = setup({ maxDraftsPerRun: 2 });
    t.setFindings([finding('a'), finding('b'), finding('c')]);

    const first = await t.runner.run();
    expect(first).toMatchObject({ drafted: 2, deferred: 1 });
    expect((await t.store.get('c'))?.status).toBe('new');

    const second = await t.runner.run();
    expect(second).toMatchObject({ drafted: 1, deferred: 0 });
    expect((await t.store.get('c'))?.status).toBe('drafted');
  });

  it('rejects an invalid draft cap', () => {
    expect(() => setup({ maxDraftsPerRun: -1 })).toThrow(RangeError);
  });

  it('marks a haunt draft_failed when the agent throws, keeping detection results', async () => {
    const t = setup();
    t.draft.mockRejectedValueOnce(new Error('model timeout'));
    t.setFindings([finding('a'), finding('b')]);

    const report = await t.runner.run();

    expect(report).toMatchObject({ ok: true, created: 2, drafted: 1, draftFailed: 1 });
    const a = await t.store.get('a');
    expect(a).toMatchObject({ status: 'draft_failed', draft: null, error: 'model timeout' });
  });

  it('marks a haunt draft_failed when the agent returns an invalid draft', async () => {
    const t = setup();
    t.draft.mockResolvedValueOnce({ summary: '', proposal: 'x' });
    t.setFindings([finding('a')]);

    await t.runner.run();

    expect((await t.store.get('a'))?.status).toBe('draft_failed');
  });

  it('redrafts a failed haunt on request', async () => {
    const t = setup();
    t.draft.mockRejectedValueOnce(new Error('model timeout'));
    t.setFindings([finding('a')]);
    await t.runner.run();

    const result = await t.runner.redraft('a');

    expect(result.ok).toBe(true);
    expect((await t.store.get('a'))).toMatchObject({ status: 'drafted', error: null });
  });

  it('refuses to redraft an approved haunt', async () => {
    const t = setup();
    t.setFindings([finding('a')]);
    await t.runner.run();
    await t.runner.approve('a');

    const result = await t.runner.redraft('a');

    expect(result).toMatchObject({ ok: false, reason: 'not_allowed' });
  });
});

describe('approval gate', () => {
  it('never runs an action during a run', async () => {
    const t = setup();
    t.setFindings([finding('a'), finding('b')]);

    await t.runner.run();
    await t.runner.run();

    expect(t.actionRun).not.toHaveBeenCalled();
  });

  it('runs the action once on approve and records the result', async () => {
    const t = setup();
    t.setFindings([finding('a')]);
    await t.runner.run();

    const result = await t.runner.approve('a');

    expect(result).toMatchObject({ ok: true, haunt: { status: 'approved', result: { ok: true, message: 'Done' } } });
    expect(t.actionRun).toHaveBeenCalledTimes(1);
  });

  it('runs the action only once when approve is double-clicked', async () => {
    const t = setup();
    t.setFindings([finding('a')]);
    await t.runner.run();
    let release!: () => void;
    t.actionRun.mockImplementationOnce(
      () => new Promise<ActionResult>((resolve) => (release = () => resolve({ ok: true, message: 'Done', url: null }))),
    );

    const first = t.runner.approve('a');
    const second = await t.runner.approve('a');
    await vi.waitFor(() => expect(t.actionRun).toHaveBeenCalled());
    release();

    expect(second).toMatchObject({ ok: false, reason: 'in_progress' });
    expect((await first).ok).toBe(true);
    expect(await t.runner.approve('a')).toMatchObject({ ok: false, reason: 'not_allowed' });
    expect(t.actionRun).toHaveBeenCalledTimes(1);
  });

  it('does not let a concurrent run overwrite an approval in progress', async () => {
    const t = setup();
    t.setFindings([finding('a')]);
    await t.runner.run();
    let release!: () => void;
    t.actionRun.mockImplementationOnce(
      () => new Promise<ActionResult>((resolve) => (release = () => resolve({ ok: true, message: 'Done', url: null }))),
    );

    const approving = t.runner.approve('a');
    await vi.waitFor(() => expect(t.actionRun).toHaveBeenCalled());
    t.setFindings([]);
    const overlapping = await t.runner.run();
    // Mid-approval the haunt is claimed as approving, and a run must leave it alone.
    expect(overlapping.resolved).toBe(0);
    expect((await t.store.get('a'))?.status).toBe('approving');
    release();
    await approving;

    expect((await t.store.get('a'))?.status).toBe('approved');
  });

  it('runs the action once when two runners share a store and both approve', async () => {
    const t = setup();
    t.setFindings([finding('a')]);
    await t.runner.run();
    const otherRun = vi.fn<Action<Payload>['run']>(async (): Promise<ActionResult> => ({ ok: true, message: 'Done', url: null }));
    const other = createRunner<Payload>({
      detector: { id: 'test-detector', payloadSchema, poll: async () => [] },
      agent: { draft: t.draft },
      action: { id: 'test-action', run: otherRun },
      store: t.store,
      log: silentLogger,
    });
    let release!: () => void;
    t.actionRun.mockImplementationOnce(
      () => new Promise<ActionResult>((resolve) => (release = () => resolve({ ok: true, message: 'Done', url: null }))),
    );

    const first = t.runner.approve('a');
    const second = await other.approve('a');
    await vi.waitFor(() => expect(t.actionRun).toHaveBeenCalled());
    release();
    await first;

    expect(second).toMatchObject({ ok: false, reason: 'in_progress' });
    expect(t.actionRun.mock.calls.length + otherRun.mock.calls.length).toBe(1);
  });

  it('ignores edits to inherited property names like toString', async () => {
    const t = setup();
    t.setFindings([finding('a')]);
    await t.runner.run();

    await t.runner.approve('a', { options: { toString: true, constructor: false } });

    const [, draft] = t.actionRun.mock.calls[0]!;
    expect(draft.options).toEqual({ close: true });
    expect(Object.keys(draft.options)).toEqual(['close']);
  });

  it('uses the edited proposal and only toggles existing options', async () => {
    const t = setup();
    t.setFindings([finding('a')]);
    await t.runner.run();

    await t.runner.approve('a', { proposal: 'Edited text', options: { close: false, deleteRepo: true } });

    const [, draft] = t.actionRun.mock.calls[0]!;
    expect(draft.proposal).toBe('Edited text');
    expect(draft.options).toEqual({ close: false });
  });

  it('rejects an edit that empties the proposal without running the action', async () => {
    const t = setup();
    t.setFindings([finding('a')]);
    await t.runner.run();

    const result = await t.runner.approve('a', { proposal: '   ' });

    expect(result).toMatchObject({ ok: false, reason: 'invalid_draft' });
    expect(t.actionRun).not.toHaveBeenCalled();
    expect((await t.store.get('a'))?.status).toBe('drafted');
  });

  it('keeps the haunt open with the error when the action fails, and allows a retry', async () => {
    const t = setup();
    t.setFindings([finding('a')]);
    await t.runner.run();
    t.actionRun.mockRejectedValueOnce(new Error('403 from GitHub'));

    const failed = await t.runner.approve('a');
    expect(failed).toMatchObject({ ok: false, reason: 'action_failed', haunt: { status: 'action_failed', error: '403 from GitHub' } });

    const retried = await t.runner.approve('a');
    expect(retried.ok).toBe(true);
    expect(t.actionRun).toHaveBeenCalledTimes(2);
  });

  it('treats an action result of ok:false as a failure', async () => {
    const t = setup();
    t.setFindings([finding('a')]);
    await t.runner.run();
    t.actionRun.mockResolvedValueOnce({ ok: false, error: 'Rate limited' });

    const result = await t.runner.approve('a');

    expect(result).toMatchObject({ ok: false, reason: 'action_failed', message: 'Rate limited' });
  });

  it('refuses to approve a haunt without a draft', async () => {
    const t = setup({ maxDraftsPerRun: 0 });
    t.setFindings([finding('a')]);
    await t.runner.run();

    expect(await t.runner.approve('a')).toMatchObject({ ok: false, reason: 'not_allowed' });
    expect(await t.runner.approve('missing')).toMatchObject({ ok: false, reason: 'not_found' });
    expect(t.actionRun).not.toHaveBeenCalled();
  });
});

describe('spare', () => {
  it('does not redraft a spared haunt while its payload is unchanged', async () => {
    const t = setup();
    t.setFindings([finding('a', 1)]);
    await t.runner.run();

    expect((await t.runner.spare('a')).ok).toBe(true);
    await t.runner.run();

    expect((await t.store.get('a'))?.status).toBe('spared');
    expect(t.draft).toHaveBeenCalledTimes(1);
  });

  it('redrafts a spared haunt when its payload changes', async () => {
    const t = setup();
    t.setFindings([finding('a', 1)]);
    await t.runner.run();
    await t.runner.spare('a');

    t.setFindings([finding('a', 2)]);
    const report = await t.runner.run();

    expect(report).toMatchObject({ reopened: 1, drafted: 1 });
    expect((await t.store.get('a'))?.status).toBe('drafted');
  });

  it('keeps a rejection when the item disappears and returns unchanged', async () => {
    const t = setup();
    t.setFindings([finding('a', 1)]);
    await t.runner.run();
    await t.runner.spare('a');

    t.setFindings([]);
    await t.runner.run();
    expect((await t.store.get('a'))?.status).toBe('resolved');

    t.setFindings([finding('a', 1)]);
    const report = await t.runner.run();

    expect(report).toMatchObject({ reopened: 0, drafted: 0 });
    expect((await t.store.get('a'))?.status).toBe('spared');
    expect(t.draft).toHaveBeenCalledTimes(1);
  });

  it('redrafts a spared item that disappears and returns changed', async () => {
    const t = setup();
    t.setFindings([finding('a', 1)]);
    await t.runner.run();
    await t.runner.spare('a');
    t.setFindings([]);
    await t.runner.run();

    t.setFindings([finding('a', 2)]);
    const report = await t.runner.run();

    expect(report).toMatchObject({ reopened: 1, drafted: 1 });
    expect(await t.store.get('a')).toMatchObject({ status: 'drafted', sparedPayloadHash: null });
  });

  it('resolves a spared haunt that disappears', async () => {
    const t = setup();
    t.setFindings([finding('a')]);
    await t.runner.run();
    await t.runner.spare('a');

    t.setFindings([]);
    await t.runner.run();

    expect((await t.store.get('a'))?.status).toBe('resolved');
  });
});

/**
 * Two "processes": separate runners on separate store objects over one shared backend.
 * They share data but not in-process locks or in-flight runs, so only versioned writes
 * keep them consistent.
 */
function twoProcesses(findings: () => Finding<Payload>[]) {
  const backend = createMemoryStore();
  const view = (): TrackerStore => ({
    get: (key) => backend.get(key),
    put: (haunt, expected) => backend.put(haunt, expected),
    list: (filter) => backend.list(filter),
  });
  const make = (overrides: Partial<RunnerOptions<Payload>> = {}) => {
    const store = view();
    const draft = vi.fn<Agent<Payload>['draft']>(async (f) => ({
      summary: `About ${f.key}`,
      proposal: `Do something with ${f.key}`,
      reasoning: 'Because',
      options: {},
    }));
    const run = vi.fn<Action<Payload>['run']>(async (): Promise<ActionResult> => ({ ok: true, message: 'Done', url: null }));
    const runner = createRunner<Payload>({
      detector: { id: 'test-detector', payloadSchema, poll: async () => findings() },
      agent: { draft },
      action: { id: 'test-action', run },
      store,
      log: silentLogger,
      ...overrides,
    });
    return { runner, store, draft, actionRun: run };
  };
  return { backend, a: make(), b: make(), make };
}

/** A clock far enough ahead that every claim made "now" is past the settle grace period. */
const later = () => new Date(Date.now() + DEFAULT_SETTLE_AFTER_MS + 60_000);

/** An action mock that waits until released, so tests can act while it is "running". */
function gate(mock: ReturnType<typeof vi.fn<Action<Payload>['run']>>) {
  let release!: (result?: ActionResult) => void;
  mock.mockImplementationOnce(
    () => new Promise<ActionResult>((resolve) => (release = (r) => resolve(r ?? { ok: true, message: 'Done', url: null }))),
  );
  return {
    async release(result?: ActionResult) {
      await vi.waitFor(() => expect(mock).toHaveBeenCalled());
      release(result);
    },
  };
}

describe('across processes (versioned writes)', () => {
  it('runs the action once when two processes approve the same haunt', async () => {
    const p = twoProcesses(() => [finding('a')]);
    await p.a.runner.run();
    const g = gate(p.a.actionRun);

    const first = p.a.runner.approve('a');
    const second = await p.b.runner.approve('a');
    await g.release();

    expect((await first).ok).toBe(true);
    expect(second).toMatchObject({ ok: false });
    expect(['conflict', 'not_allowed']).toContain(second.ok ? '' : second.reason);
    expect(p.a.actionRun.mock.calls.length + p.b.actionRun.mock.calls.length).toBe(1);
    expect((await p.backend.get('a'))?.status).toBe('approved');
  });

  it("doesn't let another process's run disturb an approval in progress", async () => {
    const p = twoProcesses(() => [finding('a')]);
    await p.a.runner.run();
    const g = gate(p.a.actionRun);

    const approving = p.a.runner.approve('a');
    await vi.waitFor(() => expect(p.a.actionRun).toHaveBeenCalled());
    const report = await p.b.runner.run();
    await g.release();

    expect(report).toMatchObject({ conflicts: 0, resolved: 0 });
    expect((await approving).ok).toBe(true);
    expect((await p.backend.get('a'))?.status).toBe('approved');
  });

  it('discards a draft when another process spares the haunt while the agent is thinking', async () => {
    const p = twoProcesses(() => [finding('a')]);
    let finishDraft!: () => void;
    p.a.draft.mockImplementationOnce(
      (f) =>
        new Promise((resolve) => {
          finishDraft = () => resolve({ summary: 's', proposal: `late draft for ${f.key}`, reasoning: 'r', options: {} });
        }),
    );

    const running = p.a.runner.run();
    await vi.waitFor(() => expect(p.a.draft).toHaveBeenCalled());
    expect((await p.b.runner.spare('a')).ok).toBe(true);
    finishDraft();
    const report = await running;

    expect(report).toMatchObject({ drafted: 0, conflicts: 1 });
    expect(await p.backend.get('a')).toMatchObject({ status: 'spared', draft: null });
  });

  it('calls the agent once when two processes run while the first draft is in flight', async () => {
    const p = twoProcesses(() => [finding('a')]);
    let finishDraft!: () => void;
    p.a.draft.mockImplementationOnce(
      () => new Promise((resolve) => (finishDraft = () => resolve({ summary: 's', proposal: 'p', reasoning: 'r', options: {} }))),
    );

    const first = p.a.runner.run();
    await vi.waitFor(() => expect(p.a.draft).toHaveBeenCalled());
    const second = await p.b.runner.run();
    finishDraft();
    await first;

    expect(p.a.draft.mock.calls.length + p.b.draft.mock.calls.length).toBe(1);
    expect(second).toMatchObject({ drafted: 0, created: 0 });
    expect((await p.backend.get('a'))?.status).toBe('drafted');
  });

  it('takes over a drafting claim abandoned past its timeout, but not a fresh one', async () => {
    const p = twoProcesses(() => [finding('a')]);
    const crashed = p.make({ draftClaimTimeoutMs: 1_000 });
    crashed.draft.mockImplementationOnce(() => new Promise(() => {})); // the "process" dies mid-draft
    void crashed.runner.run();
    await vi.waitFor(async () => expect((await p.backend.get('a'))?.status).toBe('drafting'));

    const tooSoon = await p.make({ draftClaimTimeoutMs: 1_000 }).runner.run();
    expect(tooSoon.drafted).toBe(0);

    const afterTimeout = p.make({ draftClaimTimeoutMs: 1_000, now: () => new Date(Date.now() + 5_000) });
    const report = await afterTimeout.runner.run();
    expect(report.drafted).toBe(1);
    expect(afterTimeout.draft).toHaveBeenCalledTimes(1);
    expect((await p.backend.get('a'))?.status).toBe('drafted');
  });

  it('bumps the version by one on every write', async () => {
    const p = twoProcesses(() => [finding('a')]);
    await p.a.runner.run(); // insert, claim drafting, save draft
    expect((await p.backend.get('a'))?.version).toBe(3);

    await p.a.runner.approve('a'); // claim approving, save result

    expect((await p.backend.get('a'))?.version).toBe(5);
  });
});

describe('approving: claim, act, record', () => {
  /** A store whose writes to the given status fail, like a database going away mid-approval. */
  function failingOn(store: TrackerStore, status: string, mode: 'throw' | 'conflict' = 'throw'): TrackerStore {
    return {
      get: (key) => store.get(key),
      list: (filter) => store.list(filter),
      put: async (haunt, expected) => {
        if (haunt.status === status) {
          if (mode === 'throw') throw new Error('database unavailable');
          return false;
        }
        return store.put(haunt, expected);
      },
    };
  }

  function setupWith(store: TrackerStore, overrides: Partial<RunnerOptions<Payload>> = {}) {
    const run = vi.fn<Action<Payload>['run']>(async (): Promise<ActionResult> => ({ ok: true, message: 'Done', url: null }));
    const runner = createRunner<Payload>({
      detector: { id: 'test-detector', payloadSchema, poll: async () => [finding('a')] },
      agent: { draft: async () => ({ summary: 's', proposal: 'p', reasoning: 'r', options: {} }) },
      action: { id: 'test-action', run },
      store,
      log: silentLogger,
      ...overrides,
    });
    return { runner, actionRun: run };
  }

  it.each(['throw', 'conflict'] as const)(
    'leaves the haunt approving and reports outcome_unknown when the result save fails (%s)',
    async (mode) => {
      const backend = createMemoryStore();
      const t = setupWith(failingOn(backend, 'approved', mode));
      await t.runner.run();

      const result = await t.runner.approve('a');

      expect(result).toMatchObject({ ok: false, reason: 'outcome_unknown', haunt: { status: 'approving' } });
      expect((await backend.get('a'))?.status).toBe('approving');
      expect(t.actionRun).toHaveBeenCalledTimes(1);
    },
  );

  it('refuses to approve, spare or redraft a haunt stuck in approving', async () => {
    const backend = createMemoryStore();
    const t = setupWith(failingOn(backend, 'approved'));
    await t.runner.run();
    await t.runner.approve('a');

    expect(await t.runner.approve('a')).toMatchObject({ ok: false, reason: 'not_allowed' });
    expect(await t.runner.spare('a')).toMatchObject({ ok: false, reason: 'not_allowed' });
    expect(await t.runner.redraft('a')).toMatchObject({ ok: false, reason: 'not_allowed' });
    expect(t.actionRun).toHaveBeenCalledTimes(1);
  });

  it('never resolves or refreshes a haunt stuck in approving', async () => {
    const backend = createMemoryStore();
    const failing = setupWith(failingOn(backend, 'approved'));
    await failing.runner.run();
    await failing.runner.approve('a');
    const before = await backend.get('a');

    const emptyPoll = createRunner<Payload>({
      detector: { id: 'test-detector', payloadSchema, poll: async () => [] },
      agent: { draft: async () => ({}) },
      action: { id: 'test-action', run: async () => ({ ok: true, message: '', url: null }) },
      store: backend,
      log: silentLogger,
    });
    await emptyPoll.run();

    expect(await backend.get('a')).toEqual(before);
  });

  it('settles a stuck haunt as done without running the action again', async () => {
    const backend = createMemoryStore();
    const t = setupWith(failingOn(backend, 'approved'));
    await t.runner.run();
    await t.runner.approve('a');

    const settled = await setupWith(backend, { now: later }).runner.settle('a', 'done');

    expect(settled).toMatchObject({ ok: true, haunt: { status: 'approved', result: { ok: true } } });
    expect(t.actionRun).toHaveBeenCalledTimes(1);
  });

  it('settles a stuck haunt as not done, after which it can be approved again', async () => {
    const backend = createMemoryStore();
    const t = setupWith(failingOn(backend, 'approved'));
    await t.runner.run();
    await t.runner.approve('a');

    const healthy = setupWith(backend, { now: later });
    expect(await healthy.runner.settle('a', 'not_done')).toMatchObject({ ok: true, haunt: { status: 'drafted' } });
    expect(await healthy.runner.approve('a')).toMatchObject({ ok: true, haunt: { status: 'approved' } });
    expect(t.actionRun.mock.calls.length + healthy.actionRun.mock.calls.length).toBe(2);
  });

  it('refuses to settle while the original approval may still be running in another process', async () => {
    const p = twoProcesses(() => [finding('a')]);
    await p.a.runner.run();
    const g = gate(p.a.actionRun);

    const approving = p.a.runner.approve('a');
    await vi.waitFor(() => expect(p.a.actionRun).toHaveBeenCalled());
    const settle = await p.b.runner.settle('a', 'not_done');
    const retry = await p.b.runner.approve('a');
    await g.release();

    expect(settle).toMatchObject({ ok: false, reason: 'not_allowed', message: expect.stringMatching(/may still be running/) });
    expect(retry).toMatchObject({ ok: false, reason: 'not_allowed' });
    expect((await approving).ok).toBe(true);
    expect(p.a.actionRun.mock.calls.length + p.b.actionRun.mock.calls.length).toBe(1);
  });

  it('times out a hung action, aborts its signal and leaves the haunt approving', async () => {
    const backend = createMemoryStore();
    const t = setupWith(backend, { actionTimeoutMs: 20 });
    await t.runner.run();
    let signal: AbortSignal | undefined;
    t.actionRun.mockImplementationOnce((_f, _d, ctx) => {
      signal = ctx.signal;
      return new Promise<ActionResult>(() => {});
    });

    const result = await t.runner.approve('a');

    expect(result).toMatchObject({ ok: false, reason: 'outcome_unknown', message: expect.stringMatching(/didn't finish in time/) });
    expect(signal?.aborted).toBe(true);
    expect((await backend.get('a'))?.status).toBe('approving');
  });

  it('treats an action that rejects because it was aborted as a timeout, not a failure', async () => {
    const backend = createMemoryStore();
    const t = setupWith(backend, { actionTimeoutMs: 20 });
    await t.runner.run();
    t.actionRun.mockImplementationOnce(
      (_f, _d, ctx) =>
        new Promise<ActionResult>((_resolve, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    );

    const result = await t.runner.approve('a');

    expect(result).toMatchObject({ ok: false, reason: 'outcome_unknown' });
    expect((await backend.get('a'))?.status).toBe('approving');
  });

  it('allows settling once the grace period has passed, after the original attempt timed out', async () => {
    const p = twoProcesses(() => [finding('a')]);
    const a = p.make({ actionTimeoutMs: 20, settleAfterMs: 1_000 });
    const b = p.make({ now: later });
    await a.runner.run();
    a.actionRun.mockImplementationOnce(() => new Promise<ActionResult>(() => {}));

    expect(await a.runner.approve('a')).toMatchObject({ reason: 'outcome_unknown' });
    expect(await b.runner.settle('a', 'not_done')).toMatchObject({ ok: true, haunt: { status: 'drafted' } });
    expect(await b.runner.approve('a')).toMatchObject({ ok: true });
  });

  it('rejects a settle grace period that is not longer than the action timeout', () => {
    const backend = createMemoryStore();
    expect(() => setupWith(backend, { actionTimeoutMs: 1_000, settleAfterMs: 1_000 })).toThrow(/settleAfterMs/);
    expect(() => setupWith(backend, { actionTimeoutMs: 0 })).toThrow(/actionTimeoutMs/);
  });

  it('refuses to settle a haunt that is not approving', async () => {
    const t = setupWith(createMemoryStore());
    await t.runner.run();

    expect(await t.runner.settle('a', 'done')).toMatchObject({ ok: false, reason: 'not_allowed' });
    expect(await t.runner.settle('missing', 'done')).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('records a failed action as action_failed through the same claim', async () => {
    const backend = createMemoryStore();
    const t = setupWith(backend);
    await t.runner.run();
    t.actionRun.mockResolvedValueOnce({ ok: false, error: 'Rate limited' });

    const result = await t.runner.approve('a');

    expect(result).toMatchObject({ ok: false, reason: 'action_failed' });
    expect(await backend.get('a')).toMatchObject({ status: 'action_failed', error: 'Rate limited' });
  });

  it('does not run the action when the claim write itself throws', async () => {
    const backend = createMemoryStore();
    const t = setupWith(failingOn(backend, 'approving'));
    await t.runner.run();

    await expect(t.runner.approve('a')).rejects.toThrow('database unavailable');
    expect(t.actionRun).not.toHaveBeenCalled();
    expect((await backend.get('a'))?.status).toBe('drafted');
  });
});
