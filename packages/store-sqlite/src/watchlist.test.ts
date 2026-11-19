import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteWatchlist, type SqliteWatchlist, type SqliteWatchlistOptions } from './index.js';

const dirs: string[] = [];
const opened: SqliteWatchlist[] = [];
afterEach(() => {
  for (const w of opened.splice(0)) w.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function url(): string {
  const dir = mkdtempSync(join(tmpdir(), 'crypt-watch-'));
  dirs.push(dir);
  return `file:${join(dir, 'w.db')}`;
}
let tick = 0;
const open = (u: string, seed?: SqliteWatchlistOptions['seed']) => {
  const w = createSqliteWatchlist({ url: u, now: () => new Date(Date.UTC(2026, 10, 19, 0, 0, tick++)), ...(seed ? { seed } : {}) });
  opened.push(w);
  return w;
};

describe('createSqliteWatchlist', () => {
  it('adds, retargets and removes entries per source, oldest first', async () => {
    const w = open(url());
    await w.put({ source: 'cheapshark', itemId: '612', title: 'LEGO Batman', target: 3 });
    await w.put({ source: 'cheapshark', itemId: '128', title: 'BioShock', target: 15 });
    await w.put({ source: 'fixture', itemId: 'celeste', title: 'Celeste', target: 5 });
    expect((await w.list('cheapshark')).map((e) => [e.itemId, e.target])).toEqual([['612', 3], ['128', 15]]);

    expect(await w.setTarget('cheapshark', '612', 2.5)).toBe(true);
    expect(await w.setTarget('cheapshark', 'nope', 1)).toBe(false);
    expect(await w.remove('cheapshark', '128')).toBe(true);
    expect(await w.remove('cheapshark', '128')).toBe(false);
    expect(await w.list('cheapshark')).toEqual([expect.objectContaining({ itemId: '612', title: 'LEGO Batman', target: 2.5 })]);
    expect((await w.list('fixture')).map((e) => e.itemId)).toEqual(['celeste']);
  });

  it('seeds a source once, even across connections, and not again after it is emptied', async () => {
    const u = url();
    const seed = () => [{ source: 'fixture', itemId: 'celeste', title: 'Celeste', target: 5 }];
    const a = open(u, seed);
    const b = open(u, seed);
    const [la, lb] = await Promise.all([a.list('fixture'), b.list('fixture')]);
    expect(la.map((e) => e.itemId)).toEqual(['celeste']);
    expect(lb.map((e) => e.itemId)).toEqual(['celeste']);
    await a.remove('fixture', 'celeste');
    expect(await b.list('fixture')).toEqual([]);
  });
});
