import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  authorization: null as string | null,
  isBot: false,
  config: { boardPassword: null as string | null, publicDemo: false },
  runner: { spare: vi.fn(async () => ({ ok: true })), run: vi.fn(async () => ({ ok: true })) },
}));

vi.mock('next/headers', () => ({ headers: async () => new Headers(state.authorization ? { authorization: state.authorization } : {}) }));
vi.mock('botid/server', () => ({ checkBotId: async () => ({ isBot: state.isBot }) }));
vi.mock('../crypt', () => ({ getConfig: () => state.config, getRunner: () => state.runner }));

const { spare, run } = await import('./actions');
const basic = (pass: string) => `Basic ${Buffer.from(`any:${pass}`).toString('base64')}`;

describe('server action guard', () => {
  beforeEach(() => {
    state.authorization = null;
    state.isBot = false;
    state.config = { boardPassword: null, publicDemo: false };
    state.runner.spare.mockClear();
    state.runner.run.mockClear();
  });

  it('refuses everything when no access mode is configured', async () => {
    expect(await spare('acme/lantern#214')).toEqual({ ok: false, message: expect.stringMatching(/Actions are off/) });
    expect(await run()).toMatchObject({ ok: false });
    expect(state.runner.spare).not.toHaveBeenCalled();
    expect(state.runner.run).not.toHaveBeenCalled();
  });

  it('requires the board password on every action, not just the page', async () => {
    state.config = { boardPassword: 'correct horse battery', publicDemo: false };
    expect(await spare('acme/lantern#214')).toEqual({ ok: false, message: expect.stringMatching(/Sign in/) });
    state.authorization = basic('wrong password!!');
    expect(await spare('acme/lantern#214')).toMatchObject({ ok: false });
    expect(state.runner.spare).not.toHaveBeenCalled();

    state.authorization = basic('correct horse battery');
    expect(await spare('acme/lantern#214')).toEqual({ ok: true });
    expect(state.runner.spare).toHaveBeenCalledWith('acme/lantern#214');
  });

  it('refuses requests BotID flags, even with access', async () => {
    state.config = { boardPassword: null, publicDemo: true };
    state.isBot = true;
    expect(await spare('acme/lantern#214')).toEqual({ ok: false, message: expect.stringMatching(/automated/) });
    expect(state.runner.spare).not.toHaveBeenCalled();
  });

  it('lets anyone act in the public demo', async () => {
    state.config = { boardPassword: null, publicDemo: true };
    expect(await spare('acme/lantern#214')).toEqual({ ok: true });
  });
});
