import { describe, expect, it } from 'vitest';
import { DEMO_WATCHLIST, loadConfig } from './config';

describe('config', () => {
  it('defaults to fixture prices and the demo watchlist', () => {
    expect(loadConfig({})).toEqual({
      source: 'fixture',
      watchlist: DEMO_WATCHLIST,
      cheapsharkContact: null,
      bestbuyApiKey: null,
      boardPassword: null,
      publicDemo: false,
      cronSecret: null,
    });
  });

  it('reads a CheapShark watchlist of gameId:target pairs, including $0 for free games', () => {
    expect(loadConfig({ POLTERGEIST_SOURCE: 'cheapshark', POLTERGEIST_WATCHLIST: '612:3, 128:15.50, 167910:0' }).watchlist).toEqual([
      { itemId: '612', target: 3 },
      { itemId: '128', target: 15.5 },
      { itemId: '167910', target: 0 },
    ]);
  });

  it('requires a watchlist for CheapShark and rejects malformed entries, naming the variable', () => {
    expect(() => loadConfig({ POLTERGEIST_SOURCE: 'cheapshark' })).toThrow(/POLTERGEIST_WATCHLIST/);
    for (const bad of ['612', '612:abc', '612:-1', '../x:3', '612:3.333', ',', '612:3:50', '612:100000.01', '612:3, 612:4']) {
      expect(() => loadConfig({ POLTERGEIST_SOURCE: 'cheapshark', POLTERGEIST_WATCHLIST: bad })).toThrow(/POLTERGEIST_WATCHLIST/);
    }
    expect(loadConfig({ POLTERGEIST_SOURCE: 'cheapshark', POLTERGEIST_WATCHLIST: '612:100000' }).watchlist).toEqual([{ itemId: '612', target: 100_000 }]);
    expect(() => loadConfig({ CRYPT_BOARD_PASSWORD: 'hunter2' })).toThrow(/CRYPT_BOARD_PASSWORD/);
    expect(() => loadConfig({ CRYPT_BOARD_PASSWORD: 'hunter2' })).not.toThrow(/hunter2/);
  });

  it('rejects IDs the chosen source would silently skip', () => {
    expect(() => loadConfig({ POLTERGEIST_SOURCE: 'cheapshark', POLTERGEIST_WATCHLIST: '612x:3, hollow-knight:8' })).toThrow(
      /CheapShark game IDs are 1–10 digits: 612x, hollow-knight/,
    );
    expect(() => loadConfig({ POLTERGEIST_WATCHLIST: '612:3' })).toThrow(/fixture source has no such games: 612/);
    expect(loadConfig({ POLTERGEIST_WATCHLIST: 'celeste:5' }).watchlist).toEqual([{ itemId: 'celeste', target: 5 }]);
  });

  it('uses Best Buy only with an API key and a SKU watchlist, and never echoes the key', () => {
    const key = 'bby-secret-key-123';
    expect(() => loadConfig({ POLTERGEIST_SOURCE: 'bestbuy', POLTERGEIST_WATCHLIST: '6323759:400' })).toThrow(/BESTBUY_API_KEY: required/);
    expect(() => loadConfig({ POLTERGEIST_SOURCE: 'bestbuy', BESTBUY_API_KEY: key })).toThrow(/POLTERGEIST_WATCHLIST: required when POLTERGEIST_SOURCE is bestbuy/);
    expect(() => loadConfig({ POLTERGEIST_SOURCE: 'bestbuy', BESTBUY_API_KEY: key, POLTERGEIST_WATCHLIST: 'tv-1:400' })).toThrow(/Best Buy SKUs are 1–12 digits: tv-1/);
    expect(() => loadConfig({ POLTERGEIST_SOURCE: 'bestbuy', BESTBUY_API_KEY: key, POLTERGEIST_WATCHLIST: 'tv-1:400' })).not.toThrow(new RegExp(key));
    expect(loadConfig({ POLTERGEIST_SOURCE: 'bestbuy', BESTBUY_API_KEY: ` ${key} `, POLTERGEIST_WATCHLIST: '6323759:400' })).toMatchObject({
      source: 'bestbuy',
      bestbuyApiKey: key,
      watchlist: [{ itemId: '6323759', target: 400 }],
    });
  });
});
