import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteKeyValue, type SqliteKeyValue } from './index.js';

const dirs: string[] = [];
const opened: SqliteKeyValue[] = [];
afterEach(() => {
  for (const kv of opened.splice(0)) kv.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function url(): string {
  const dir = mkdtempSync(join(tmpdir(), 'crypt-kv-'));
  dirs.push(dir);
  return `file:${join(dir, 'kv.db')}`;
}
const open = (u: string, now: () => number) => {
  const kv = createSqliteKeyValue({ url: u, now });
  opened.push(kv);
  return kv;
};

describe('createSqliteKeyValue', () => {
  it('shares values between connections until they expire', async () => {
    let t = 1_000;
    const u = url();
    const a = open(u, () => t);
    const b = open(u, () => t); // another process on the same database
    expect(await b.get('k')).toBeNull();
    await a.set('k', 'v1', 500);
    expect(await b.get('k')).toBe('v1');
    await b.set('k', 'v2', 500);
    expect(await a.get('k')).toBe('v2');
    t = 1_600;
    expect(await a.get('k')).toBeNull();
  });

  it('rejects bad table names and TTLs', async () => {
    expect(() => createSqliteKeyValue({ url: ':memory:', tableName: 'Bad Name' })).toThrow(/Invalid table name/);
    const kv = open(url(), () => 0);
    await expect(kv.set('k', 'v', 0)).rejects.toThrow(RangeError);
  });
});
