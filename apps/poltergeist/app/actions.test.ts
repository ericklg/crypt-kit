import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  authorization: null as string | null,
  isBot: false,
  config: { boardPassword: null as string | null, publicDemo: false },
  runner: {
    approve: vi.fn(async () => ({ ok: true, haunt: { result: { ok: true, message: 'Deal link opened.', url: 'https://www.cheapshark.com/redirect?dealID=a%3D' } } })),
    run: vi.fn(async () => ({ ok: false })),
  },
}));
const refresh = vi.hoisted(() => vi.fn());

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => new Headers(state.authorization ? { authorization: state.authorization } : {}) }));
vi.mock('botid/server', () => ({ checkBotId: async () => ({ isBot: state.isBot }) }));
vi.mock('next/cache', () => ({ refresh }));
vi.mock('../crypt', () => ({ getConfig: () => state.config, getRunner: () => state.runner }));

const { approve, run } = await import('./actions');
const edits = { proposal: 'Buy now.', options: {}, revision: 2 };

describe('server actions', () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.stubEnv('VERCEL', '1'); // BotID only runs on Vercel
    state.config = { boardPassword: null, publicDemo: false };
    state.isBot = false;
    state.runner.approve.mockClear();
    refresh.mockClear();
  });

  it('refuses everything until access is configured, and still refreshes', async () => {
    expect(await approve('cheapshark:612@2.99', edits)).toEqual({ ok: false, message: expect.stringMatching(/Actions are off/) });
    expect(state.runner.approve).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('returns the deal link for the board to open, with the reviewed revision as expectedVersion', async () => {
    state.config = { boardPassword: null, publicDemo: true };
    expect(await approve('cheapshark:612@2.99', edits)).toEqual({ ok: true, url: 'https://www.cheapshark.com/redirect?dealID=a%3D' });
    expect(state.runner.approve).toHaveBeenCalledWith('cheapshark:612@2.99', { proposal: 'Buy now.', options: {}, expectedVersion: 2 });
  });

  it('refuses requests BotID flags', async () => {
    state.config = { boardPassword: null, publicDemo: true };
    state.isBot = true;
    expect(await approve('cheapshark:612@2.99', edits)).toMatchObject({ ok: false, message: expect.stringMatching(/automated/) });
    expect(state.runner.approve).not.toHaveBeenCalled();
  });

  it('skips BotID off Vercel, where it can’t run, and keeps the access gate', async () => {
    vi.stubEnv('VERCEL', '');
    state.isBot = true; // would refuse if BotID were consulted
    state.config = { boardPassword: null, publicDemo: true };
    expect(await approve('cheapshark:612@2.99', edits)).toMatchObject({ ok: true });
    state.config = { boardPassword: null, publicDemo: false };
    expect(await approve('cheapshark:612@2.99', edits)).toMatchObject({ ok: false, message: expect.stringMatching(/Actions are off/) });
  });

  it('explains a failed price check in plain words', async () => {
    state.config = { boardPassword: null, publicDemo: true };
    expect(await run()).toEqual({ ok: false, message: 'Prices couldn’t be checked just now. Try again in a few minutes.' });
  });
});
