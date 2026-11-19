import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFixtureSource } from '../sources/fixture';

type Entry = { source: string; itemId: string; title: string; target: number; addedAt: string };

const state = vi.hoisted(() => ({
  isBot: false,
  config: { boardPassword: null as string | null, publicDemo: true, source: 'fixture' as 'fixture' | 'cheapshark' },
  entries: [] as Entry[],
}));
const refresh = vi.hoisted(() => vi.fn());

const watchlist = {
  list: async (source: string) => state.entries.filter((e) => e.source === source),
  put: async (e: Omit<Entry, 'addedAt'>) => {
    state.entries = [...state.entries.filter((x) => !(x.source === e.source && x.itemId === e.itemId)), { ...e, addedAt: 'now' }];
  },
  setTarget: async (source: string, itemId: string, target: number) => {
    const e = state.entries.find((x) => x.source === source && x.itemId === itemId);
    if (e) e.target = target;
    return Boolean(e);
  },
  remove: async (source: string, itemId: string) => {
    const before = state.entries.length;
    state.entries = state.entries.filter((x) => !(x.source === source && x.itemId === itemId));
    return state.entries.length < before;
  },
};
const source = createFixtureSource();

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('botid/server', () => ({ checkBotId: async () => ({ isBot: state.isBot }) }));
vi.mock('next/cache', () => ({ refresh }));
vi.mock('../crypt', () => ({ getConfig: () => state.config, getSource: () => source, getWatchlist: () => watchlist }));

const { loadWatchlist, searchGames, setTarget, unwatchGame, watchGame } = await import('./watchlist-actions');

describe('watchlist actions', () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.stubEnv('VERCEL', '1'); // BotID only runs on Vercel
    state.isBot = false;
    state.config = { boardPassword: null, publicDemo: true, source: 'fixture' };
    state.entries = [{ source: 'fixture', itemId: 'celeste', title: 'Celeste', target: 5, addedAt: 'a' }];
    refresh.mockClear();
  });

  it('lists watched games with today’s price and store', async () => {
    expect(await loadWatchlist()).toEqual({
      ok: true,
      games: [{ itemId: 'celeste', title: 'Celeste', target: 5, price: 4.99, store: 'GOG' }],
    });
  });

  it('searches by title and marks games already watched', async () => {
    const res = await searchGames('  celes ');
    expect(res).toEqual({ ok: true, hits: [expect.objectContaining({ itemId: 'celeste', watching: true })] });
    expect(await searchGames('x')).toEqual({ ok: true, hits: [] }); // too short: no lookup
  });

  it('watches a game with a title and target from the source, 20% under today’s price', async () => {
    const res = await watchGame('hollow-knight');
    expect(res.ok && res.games.find((g) => g.itemId === 'hollow-knight')).toMatchObject({ title: 'Hollow Knight', target: 5.99 });
    expect(refresh).toHaveBeenCalledTimes(1);
    await watchGame('hollow-knight'); // already watched: nothing changes
    expect(state.entries.filter((e) => e.itemId === 'hollow-knight')).toHaveLength(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refuses IDs the source can’t look up', async () => {
    expect(await watchGame('612')).toEqual({ ok: false, message: 'That game can’t be watched.' });
    expect(await watchGame('x'.repeat(65))).toMatchObject({ ok: false });
    expect(await watchGame(42 as never)).toMatchObject({ ok: false });
    expect(state.entries).toHaveLength(1);
  });

  it('sets a target typed in dollars, and refuses anything else', async () => {
    expect(await setTarget('celeste', '$4.50')).toMatchObject({ ok: true, games: [expect.objectContaining({ target: 4.5 })] });
    for (const bad of ['abc', '-1', '4.555', '100000.01', '']) {
      expect(await setTarget('celeste', bad)).toEqual({ ok: false, message: 'Enter a price like 7.50, from 0 to 100,000.' });
    }
    expect(await setTarget('nope', '3')).toEqual({ ok: false, message: 'That game isn’t on your watchlist any more.' });
    expect(state.entries[0]!.target).toBe(4.5);
  });

  it('stops watching a game', async () => {
    expect(await unwatchGame('celeste')).toEqual({ ok: true, games: [] });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('still lists games, without prices, when the source fails, so a committed edit isn’t reported as failed', async () => {
    state.entries.push({ source: 'fixture', itemId: 'balatro', title: 'Balatro', target: 13, addedAt: 'b' });
    const quote = vi.spyOn(source, 'quote').mockRejectedValue(new Error('CheapShark returned 503 for /games'));
    try {
      expect(await unwatchGame('celeste')).toEqual({ ok: true, games: [{ itemId: 'balatro', title: 'Balatro', target: 13, price: null, store: null }] });
      expect(state.entries.map((e) => e.itemId)).toEqual(['balatro']);
    } finally {
      quote.mockRestore();
    }
  });

  it('explains a failed search or add instead of failing the request', async () => {
    const search = vi.spyOn(source, 'search').mockRejectedValue(new Error('CheapShark returned 503 for /games'));
    const quote = vi.spyOn(source, 'quote').mockRejectedValue(new Error('CheapShark returned 503 for /games'));
    try {
      expect(await searchGames('celeste')).toEqual({ ok: false, message: 'Search isn’t available right now. Try again in a minute.' });
      expect(await watchGame('balatro')).toEqual({ ok: false, message: 'Prices couldn’t be loaded, so the game wasn’t added. Try again in a minute.' });
      expect(state.entries.map((e) => e.itemId)).toEqual(['celeste']);
    } finally {
      search.mockRestore();
      quote.mockRestore();
    }
  });

  it('goes through the same access gate as the board', async () => {
    state.config = { boardPassword: null, publicDemo: false, source: 'fixture' };
    for (const res of [await loadWatchlist(), await searchGames('celeste'), await watchGame('balatro'), await setTarget('celeste', '1'), await unwatchGame('celeste')]) {
      expect(res).toEqual({ ok: false, message: expect.stringMatching(/Actions are off/) });
    }
    state.config = { boardPassword: null, publicDemo: true, source: 'fixture' };
    state.isBot = true;
    expect(await watchGame('balatro')).toMatchObject({ ok: false, message: expect.stringMatching(/automated/) });
    expect(state.entries.map((e) => [e.itemId, e.target])).toEqual([['celeste', 5]]);
  });
});
