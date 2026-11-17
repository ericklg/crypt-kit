import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createRunner, silentLogger, type Action, type ActionResult, type Finding } from '@crypt-kit/core';
import { assertTrackerStoreContract, sampleHaunt } from '@crypt-kit/core/testing';
import { createSqliteStore, createSqliteStoreFromEnv, type SqliteTrackerStore } from './index.js';

const dirs: string[] = [];
const stores: SqliteTrackerStore[] = [];

function tempDbUrl(): string {
  const dir = mkdtempSync(join(tmpdir(), 'crypt-kit-'));
  dirs.push(dir);
  return `file:${join(dir, 'test.db')}`;
}

function open(url: string, tableName?: string): SqliteTrackerStore {
  const store = createSqliteStore(tableName ? { url, tableName } : { url });
  stores.push(store);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('createSqliteStore', () => {
  it('meets the TrackerStore contract on a file database', async () => {
    await assertTrackerStoreContract(async () => open(tempDbUrl()));
  });

  it('meets the TrackerStore contract in memory', async () => {
    await assertTrackerStoreContract(async () => open(':memory:'));
  });

  it('keeps haunts across restarts', async () => {
    const url = tempDbUrl();
    const first = open(url);
    const haunt = sampleHaunt({ status: 'spared', sparedPayloadHash: 'h', error: 'naïve — 👻 "quoted"' });
    await first.put(haunt, null);
    first.close();

    const reopened = open(url);

    expect(await reopened.get(haunt.key)).toEqual(haunt);
  });

  it('keeps tables with different names separate', async () => {
    const url = tempDbUrl();
    const exorcist = open(url, 'exorcist_haunts');
    const poltergeist = open(url, 'poltergeist_haunts');

    await exorcist.put(sampleHaunt({ key: 'shared' }), null);

    expect(await poltergeist.get('shared')).toBeNull();
    expect(await poltergeist.put(sampleHaunt({ key: 'shared' }), null)).toBe(true);
  });

  it.each(['order', 'group', 'select', 'table'])('works with the reserved word %s as a table name', async (tableName) => {
    await assertTrackerStoreContract(async () => open(':memory:', tableName));
  });

  it.each([
    ['Haunts', /lowercase/],
    ['CRYPT_HAUNTS', /lowercase/],
    ['crypt__haunts', /single underscores/],
    ['haunts_', /single underscores/],
    ['sqlite_haunts', /sqlite_/],
    ['h'.repeat(49), /at most 48/],
  ])('rejects the table name %s', (tableName, message) => {
    expect(() => createSqliteStore({ url: ':memory:', tableName })).toThrow(message);
  });

  it("can't collide with another store's index name", async () => {
    const url = tempDbUrl();
    const a = open(url, 'exorcist');
    await a.put(sampleHaunt({ key: 'a' }), null);

    // Before the fix, store "exorcist" created an index named "exorcist_by_detector",
    // so a store using that name as its table failed to migrate.
    const b = open(url, 'exorcist_by_detector');

    expect(await b.put(sampleHaunt({ key: 'b' }), null)).toBe(true);
    expect(await a.get('b')).toBeNull();
  });

  describe('upgrading a database created before the index rename', () => {
    /** Lays out a database the way the previous version of this store did. */
    async function legacyDatabase(url: string, table: string): Promise<void> {
      const client = createClient({ url });
      await client.batch(
        [
          `create table "${table}" (key text primary key, detector_id text not null, status text not null,
            version integer not null, first_seen_at text not null, data text not null)`,
          `create index "${table}_by_detector" on "${table}" (detector_id, status, first_seen_at, key)`,
          {
            sql: `insert into "${table}" (key, detector_id, status, version, first_seen_at, data) values (?, ?, ?, ?, ?, ?)`,
            args: ['old', 'sample', 'new', 1, '2026-11-01T00:00:00.000Z', JSON.stringify(sampleHaunt({ key: 'old' }))],
          },
        ],
        'write',
      );
      client.close();
    }

    async function indexNames(url: string): Promise<string[]> {
      const client = createClient({ url });
      const result = await client.execute(`select name from sqlite_master where type = 'index' and name not like 'sqlite_%' order by name`);
      client.close();
      return result.rows.map((row) => String(row.name));
    }

    it('replaces the old index when the original store reopens', async () => {
      const url = tempDbUrl();
      await legacyDatabase(url, 'exorcist');

      const store = open(url, 'exorcist');

      expect((await store.get('old'))?.key).toBe('old');
      expect(await indexNames(url)).toEqual(['exorcist__by_detector']);
    });

    it('lets a store named like the old index open first, then the original store', async () => {
      const url = tempDbUrl();
      await legacyDatabase(url, 'exorcist');

      const conflicting = open(url, 'exorcist_by_detector');
      expect(await conflicting.put(sampleHaunt({ key: 'b' }), null)).toBe(true);

      const original = open(url, 'exorcist');
      expect((await original.get('old'))?.key).toBe('old');
      expect(await original.get('b')).toBeNull();
      expect(await indexNames(url)).toEqual(['exorcist__by_detector', 'exorcist_by_detector__by_detector']);
    });

    it("doesn't drop an index that only looks like the old one", async () => {
      const url = tempDbUrl();
      const client = createClient({ url });
      await client.batch(
        [
          `create table "reports" (key text primary key, detector_id text, status text)`,
          // Same name pattern, different columns: someone else's index.
          `create index "reports_by_detector" on "reports" (detector_id)`,
        ],
        'write',
      );
      client.close();

      const store = open(url, 'reports_by_detector');

      await expect(store.migrate()).rejects.toThrow();
      expect(await indexNames(url)).toContain('reports_by_detector');
    });
  });

  it('rejects table names that could inject SQL', () => {
    expect(() => createSqliteStore({ url: ':memory:', tableName: 'haunts; drop table x' })).toThrow(/Invalid table name/);
    expect(() => createSqliteStore({ url: ':memory:', tableName: '1haunts' })).toThrow(/Invalid table name/);
  });

  it('treats keys and filters as data, not SQL', async () => {
    const store = open(':memory:');
    const key = "x' or '1'='1";
    await store.put(sampleHaunt({ key, detectorId: "d'; drop table crypt_haunts; --" }), null);

    expect(await store.get('anything')).toBeNull();
    expect((await store.get(key))?.key).toBe(key);
    expect(await store.list({ detectorId: "d'; drop table crypt_haunts; --" })).toHaveLength(1);
  });
});

describe('createSqliteStoreFromEnv', () => {
  it('uses CRYPT_DB_URL when set', async () => {
    const url = tempDbUrl();
    const store = createSqliteStoreFromEnv({ CRYPT_DB_URL: url });
    stores.push(store);
    await store.put(sampleHaunt(), null);

    expect(await open(url).get('sample#1')).not.toBeNull();
  });
});

describe('two processes on one database', () => {
  const payloadSchema = z.object({ count: z.number() });
  type Payload = z.infer<typeof payloadSchema>;
  const finding: Finding<Payload> = {
    key: 'a',
    kind: 'test',
    severity: 'low',
    title: 'Item a',
    url: null,
    payload: { count: 1 },
    observedAt: '2026-11-01T00:00:00.000Z',
  };

  function processOn(url: string) {
    const store = open(url);
    const run = vi.fn<Action<Payload>['run']>(async (): Promise<ActionResult> => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { ok: true, message: 'Posted', url: null };
    });
    const runner = createRunner<Payload>({
      detector: { id: 'test', payloadSchema, poll: async () => [finding] },
      agent: { draft: async () => ({ summary: 's', proposal: 'p', reasoning: 'r', options: {} }) },
      action: { id: 'post', run },
      store,
      log: silentLogger,
    });
    return { runner, actionRun: run };
  }

  it('runs the action once when both approve the same haunt', async () => {
    const url = tempDbUrl();
    const a = processOn(url);
    const b = processOn(url);
    await a.runner.run();

    const results = await Promise.all([a.runner.approve('a'), b.runner.approve('a')]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(a.actionRun.mock.calls.length + b.actionRun.mock.calls.length).toBe(1);
    expect((await open(url).get('a'))?.status).toBe('approved');
  });

  it('creates and drafts each haunt once when both run at the same time', async () => {
    const url = tempDbUrl();
    const a = processOn(url);
    const b = processOn(url);

    const [ra, rb] = await Promise.all([a.runner.run(), b.runner.run()]);

    expect(ra.created + rb.created).toBe(1);
    expect(ra.drafted + rb.drafted).toBe(1);
    expect(await open(url).get('a')).toMatchObject({ status: 'drafted', version: 3 });
  });
});
