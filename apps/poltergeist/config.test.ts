import { describe, expect, it } from 'vitest';
import { DEMO_WATCHLIST, loadConfig } from './config';

describe('config', () => {
  it('defaults to fixture prices and the demo watchlist', () => {
    expect(loadConfig({})).toEqual({
      source: 'fixture',
      watchlist: DEMO_WATCHLIST,
      cheapsharkContact: null,
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
    for (const bad of ['612', '612:abc', '612:-1', '../x:3', '612:3.333', ',']) {
      expect(() => loadConfig({ POLTERGEIST_WATCHLIST: bad })).toThrow(/POLTERGEIST_WATCHLIST/);
    }
    expect(() => loadConfig({ CRYPT_BOARD_PASSWORD: 'hunter2' })).toThrow(/CRYPT_BOARD_PASSWORD/);
    expect(() => loadConfig({ CRYPT_BOARD_PASSWORD: 'hunter2' })).not.toThrow(/hunter2/);
  });
});
