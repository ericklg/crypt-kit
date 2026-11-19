import { createClient, type Client, type InValue, type Row } from '@libsql/client';
import { checkPutVersion, compareHaunts, type Haunt, type ListFilter, type TrackerStore } from '@crypt-kit/core';

export const DEFAULT_TABLE_NAME = 'crypt_haunts';
export const DEFAULT_DATABASE_URL = 'file:crypt-kit.db';

export interface SqliteStoreOptions {
  /** An existing libSQL client. The store won't close a client it didn't create. */
  client?: Client;
  /** `file:./crypt-kit.db` locally, `libsql://<db>.turso.io` on Vercel, or `:memory:`. */
  url?: string;
  /** Turso auth token. Only needed for remote databases. */
  authToken?: string;
  /**
   * Lowercase letters, digits and single underscores, starting with a letter, at most
   * 48 characters. Defaults to `crypt_haunts`. Lowercase only because SQLite compares
   * names case-insensitively, and `__` is reserved for the store's own index names.
   */
  tableName?: string;
}

export interface SqliteTrackerStore extends TrackerStore {
  /** Creates the table and index if needed. Every method calls it first, so this is optional. */
  migrate(): Promise<void>;
  /** Closes the client if this store created it. */
  close(): void;
}

// Lowercase so two spellings can't silently share a table, no `__` so a table can't be
// named like another store's index, and no `sqlite_` prefix (reserved by SQLite).
const TABLE_NAME = /^(?!sqlite_)[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const MAX_TABLE_NAME = 48;

function invalidTableName(table: string): string | null {
  if (table.length > MAX_TABLE_NAME) return `at most ${MAX_TABLE_NAME} characters`;
  if (!TABLE_NAME.test(table)) {
    return 'use lowercase letters, digits and single underscores, starting with a letter (not "sqlite_")';
  }
  return null;
}

/**
 * A TrackerStore on SQLite through libSQL. The same code runs against a local file in
 * development and a Turso database in production. Writes are a single conditional
 * statement (`ON CONFLICT DO NOTHING` / `WHERE version = ?`), so they stay safe across
 * processes and serverless instances.
 */
export function createSqliteStore(options: SqliteStoreOptions = {}): SqliteTrackerStore {
  const table = options.tableName ?? DEFAULT_TABLE_NAME;
  const problem = invalidTableName(table);
  if (problem) throw new Error(`Invalid table name ${JSON.stringify(table)}: ${problem}`);

  const ownsClient = !options.client;
  const client =
    options.client ??
    createClient(
      options.authToken
        ? { url: options.url ?? DEFAULT_DATABASE_URL, authToken: options.authToken }
        : { url: options.url ?? DEFAULT_DATABASE_URL },
    );

  // Always quoted: a valid name can still be a keyword (`order`, `group`).
  // TABLE_NAME already rules out quote characters, so no escaping is needed.
  const t = `"${table}"`;
  // `__` can't appear in a table name, so this can never collide with another store's table.
  const index = `"${table}__by_detector"`;

  /**
   * Indexes created by earlier versions of this store, named `<table>_by_detector`, that
   * either belong to this table or occupy this table's name. Only indexes that match the
   * old definition exactly are returned, so a user's own index is never dropped.
   */
  async function legacyIndexes(): Promise<string[]> {
    const result = await client.execute({
      // NOCASE because SQLite names are case-insensitive and older versions allowed
      // mixed-case tables (e.g. "Exorcist", whose index was "Exorcist_by_detector").
      sql: `select name, tbl_name from sqlite_master
            where type = 'index' and (tbl_name = ? collate nocase or name = ? collate nocase)`,
      args: [table, table],
    });
    const legacy: string[] = [];
    for (const row of result.rows) {
      const name = String(row.name);
      const owner = String(row.tbl_name);
      if (name.toLowerCase() !== `${owner}_by_detector`.toLowerCase()) continue;
      if (await isLegacyIndex(name, owner)) legacy.push(name);
    }
    return legacy;
  }

  /**
   * Checks the index's real structure rather than its SQL text: a plain, non-unique,
   * non-partial index on exactly (detector_id, status, first_seen_at, key), ascending,
   * default collation. That is what older versions created; anything else is left alone.
   */
  async function isLegacyIndex(name: string, owner: string): Promise<boolean> {
    const [list, columns] = await client.batch(
      [
        { sql: `select "unique", origin, partial from pragma_index_list(?) where name = ?`, args: [owner, name] },
        { sql: `select name, "desc", coll from pragma_index_xinfo(?) where key = 1 order by seqno`, args: [name] },
      ],
      'read',
    );
    const meta = list?.rows[0];
    if (!meta || Number(meta.unique) !== 0 || String(meta.origin) !== 'c' || Number(meta.partial) !== 0) return false;
    const want = ['detector_id', 'status', 'first_seen_at', 'key'];
    const got = columns?.rows ?? [];
    return (
      got.length === want.length &&
      got.every((col, i) => col.name === want[i] && Number(col.desc) === 0 && String(col.coll).toUpperCase() === 'BINARY')
    );
  }

  let ready: Promise<void> | null = null;
  const migrate = (): Promise<void> => {
    ready ??= legacyIndexes()
      .then((legacy) =>
        client.batch(
          [
            // Drop old-style indexes first: one named like this table would block create table.
            ...legacy.map((name) => `drop index if exists "${name.replaceAll('"', '""')}"`),
            `create table if not exists ${t} (
            key text primary key,
            detector_id text not null,
            status text not null,
            version integer not null,
            first_seen_at text not null,
            data text not null
          )`,
            `create index if not exists ${index} on ${t} (detector_id, status, first_seen_at, key)`,
          ],
          'write',
        ),
      )
      .then(() => undefined)
      .catch((error: unknown) => {
        ready = null; // let the next call retry
        throw error;
      });
    return ready;
  };

  const toHaunt = (row: Row): Haunt => JSON.parse(String(row.data)) as Haunt;

  return {
    migrate,

    async get(key) {
      await migrate();
      const result = await client.execute({ sql: `select data from ${t} where key = ?`, args: [key] });
      const row = result.rows[0];
      return row ? toHaunt(row) : null;
    },

    async put(haunt, expectedVersion) {
      checkPutVersion(haunt, expectedVersion);
      await migrate();
      const data = JSON.stringify(haunt);
      const result =
        expectedVersion === null
          ? await client.execute({
              sql: `insert into ${t} (key, detector_id, status, version, first_seen_at, data)
                    values (?, ?, ?, ?, ?, ?) on conflict (key) do nothing`,
              args: [haunt.key, haunt.detectorId, haunt.status, haunt.version, haunt.firstSeenAt, data],
            })
          : await client.execute({
              sql: `update ${t}
                    set detector_id = ?, status = ?, version = ?, first_seen_at = ?, data = ?
                    where key = ? and version = ?`,
              args: [haunt.detectorId, haunt.status, haunt.version, haunt.firstSeenAt, data, haunt.key, expectedVersion],
            });
      return result.rowsAffected === 1;
    },

    async list(filter: ListFilter = {}) {
      await migrate();
      if (filter.status && filter.status.length === 0) return [];
      const where: string[] = [];
      const args: InValue[] = [];
      if (filter.detectorId) {
        where.push('detector_id = ?');
        args.push(filter.detectorId);
      }
      if (filter.status) {
        where.push(`status in (${filter.status.map(() => '?').join(', ')})`);
        args.push(...filter.status);
      }
      const sql = `select data from ${t}${where.length ? ` where ${where.join(' and ')}` : ''}`;
      const result = await client.execute({ sql, args });
      // Sort in JS: SQLite's BINARY collation orders UTF-8 bytes, which differs from
      // JS's UTF-16 order for some keys (e.g. U+E000 vs U+10000). compareHaunts is the contract.
      return result.rows.map(toHaunt).sort(compareHaunts);
    },

    close() {
      if (ownsClient) client.close();
    },
  };
}

/**
 * Builds a store from `CRYPT_DB_URL` and `CRYPT_DB_AUTH_TOKEN`, falling back to a
 * local `crypt-kit.db` file. Apps call this once per process.
 */
export function createSqliteStoreFromEnv(env: Record<string, string | undefined> = process.env): SqliteTrackerStore {
  const url = env.CRYPT_DB_URL?.trim() || DEFAULT_DATABASE_URL;
  const authToken = env.CRYPT_DB_AUTH_TOKEN?.trim();
  return createSqliteStore(authToken ? { url, authToken } : { url });
}

/** Values that expire, shared by every process using the same database. */
export interface SqliteKeyValue {
  /** The value, or null when it's missing or expired. */
  get(key: string): Promise<string | null>;
  /** Stores `value` for `ttlMs` milliseconds, replacing any earlier value. */
  set(key: string, value: string, ttlMs: number): Promise<void>;
  /** Closes the client if this store created it. */
  close(): void;
}

export interface SqliteKeyValueOptions extends Omit<SqliteStoreOptions, 'tableName'> {
  /** Same naming rules as the haunts table. Default `crypt_kv`. */
  tableName?: string;
  now?: () => number;
}

/**
 * A small expiring key-value table, for state that must be shared across serverless
 * instances (e.g. an API's cache and rate-limit pause). Not for haunts.
 */
export function createSqliteKeyValue(options: SqliteKeyValueOptions = {}): SqliteKeyValue {
  const table = options.tableName ?? 'crypt_kv';
  const problem = invalidTableName(table);
  if (problem) throw new Error(`Invalid table name ${JSON.stringify(table)}: ${problem}`);
  const now = options.now ?? Date.now;
  const ownsClient = !options.client;
  const client =
    options.client ??
    createClient(
      options.authToken
        ? { url: options.url ?? DEFAULT_DATABASE_URL, authToken: options.authToken }
        : { url: options.url ?? DEFAULT_DATABASE_URL },
    );
  const t = `"${table}"`;
  let ready: Promise<void> | null = null;
  const migrate = () =>
    (ready ??= client
      .execute(`create table if not exists ${t} (key text primary key, value text not null, expires_at integer not null)`)
      .then(() => undefined)
      .catch((error: unknown) => {
        ready = null;
        throw error;
      }));

  return {
    async get(key) {
      await migrate();
      const result = await client.execute({ sql: `select value from ${t} where key = ? and expires_at > ?`, args: [key, now()] });
      const row = result.rows[0];
      return row ? String(row.value) : null;
    },
    async set(key, value, ttlMs) {
      if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError('ttlMs must be a positive number');
      await migrate();
      await client.batch(
        [
          { sql: `delete from ${t} where expires_at <= ?`, args: [now()] },
          {
            sql: `insert into ${t} (key, value, expires_at) values (?, ?, ?)
                  on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at`,
            args: [key, value, Math.ceil(now() + ttlMs)],
          },
        ],
        'write',
      );
    },
    close() {
      if (ownsClient) client.close();
    },
  };
}

/** One watched item: an app's source ID, the item's ID there, and the user's threshold. */
export interface WatchEntry {
  source: string;
  itemId: string;
  /** Display name as the source gave it when the item was added. */
  title: string;
  target: number;
  addedAt: string;
}

/** The items an app watches, per source. Shared by every process on the same database. */
export interface SqliteWatchlist {
  /** Entries for one source, oldest first. Seeds the list from `seed` the first time. */
  list(source: string): Promise<WatchEntry[]>;
  /** Adds an entry. If it's already watched, nothing changes (an earlier target is kept). */
  add(entry: Omit<WatchEntry, 'addedAt'>): Promise<void>;
  /** Adds or updates an entry (by source and item ID). */
  put(entry: Omit<WatchEntry, 'addedAt'>): Promise<void>;
  /** Changes an existing entry's target. False when it isn't watched. */
  setTarget(source: string, itemId: string, target: number): Promise<boolean>;
  /** False when it wasn't watched. */
  remove(source: string, itemId: string): Promise<boolean>;
  close(): void;
}

export interface SqliteWatchlistOptions extends Omit<SqliteStoreOptions, 'tableName'> {
  /** Same naming rules as the haunts table. Default `crypt_watchlist`. */
  tableName?: string;
  /** Entries to start a source's list with, used once while the table has none for it. */
  seed?: (source: string) => ReadonlyArray<Omit<WatchEntry, 'addedAt'>>;
  now?: () => Date;
}

/** A watchlist table (e.g. Poltergeist's games and target prices). */
export function createSqliteWatchlist(options: SqliteWatchlistOptions = {}): SqliteWatchlist {
  const table = options.tableName ?? 'crypt_watchlist';
  const problem = invalidTableName(table);
  if (problem) throw new Error(`Invalid table name ${JSON.stringify(table)}: ${problem}`);
  const now = options.now ?? (() => new Date());
  const ownsClient = !options.client;
  const client =
    options.client ??
    createClient(
      options.authToken
        ? { url: options.url ?? DEFAULT_DATABASE_URL, authToken: options.authToken }
        : { url: options.url ?? DEFAULT_DATABASE_URL },
    );
  const t = `"${table}"`;
  // Seeding is remembered per source, so removing every item doesn't bring the seed back.
  const seeds = `"${table}__seeded"`;
  let ready: Promise<void> | null = null;
  const migrate = () =>
    (ready ??= client
      .batch(
        [
          `create table if not exists ${t} (source text not null, item_id text not null, title text not null,
             target real not null, added_at text not null, primary key (source, item_id))`,
          `create table if not exists ${seeds} (source text primary key)`,
        ],
        'write',
      )
      .then(() => undefined)
      .catch((error: unknown) => {
        ready = null;
        throw error;
      }));

  const toEntry = (row: Row): WatchEntry => ({
    source: String(row.source),
    itemId: String(row.item_id),
    title: String(row.title),
    target: Number(row.target),
    addedAt: String(row.added_at),
  });

  return {
    async list(source) {
      await migrate();
      const seed = options.seed?.(source) ?? [];
      if (seed.length) {
        const at = now().toISOString();
        // Single statements, like the haunt store: insert only while the source isn't marked
        // seeded, then mark it. If two instances overlap, the primary key drops repeats, and
        // once marked, emptying the list never brings the seed back.
        await client.execute({
          sql: `insert into ${t} (source, item_id, title, target, added_at)
                select * from (values ${seed.map(() => '(?, ?, ?, ?, ?)').join(', ')})
                where not exists (select 1 from ${seeds} where source = ?)
                on conflict do nothing`,
          args: [...seed.flatMap((e) => [source, e.itemId, e.title, e.target, at] as InValue[]), source],
        });
        await client.execute({ sql: `insert into ${seeds} (source) values (?) on conflict do nothing`, args: [source] });
      }
      const result = await client.execute({ sql: `select * from ${t} where source = ? order by added_at, item_id`, args: [source] });
      return result.rows.map(toEntry);
    },
    async add(entry) {
      await migrate();
      await client.execute({
        sql: `insert into ${t} (source, item_id, title, target, added_at) values (?, ?, ?, ?, ?) on conflict do nothing`,
        args: [entry.source, entry.itemId, entry.title, entry.target, now().toISOString()],
      });
    },
    async put(entry) {
      await migrate();
      await client.execute({
        sql: `insert into ${t} (source, item_id, title, target, added_at) values (?, ?, ?, ?, ?)
              on conflict (source, item_id) do update set title = excluded.title, target = excluded.target`,
        args: [entry.source, entry.itemId, entry.title, entry.target, now().toISOString()],
      });
    },
    async setTarget(source, itemId, target) {
      await migrate();
      const result = await client.execute({ sql: `update ${t} set target = ? where source = ? and item_id = ?`, args: [target, source, itemId] });
      return result.rowsAffected > 0;
    },
    async remove(source, itemId) {
      await migrate();
      const result = await client.execute({ sql: `delete from ${t} where source = ? and item_id = ?`, args: [source, itemId] });
      return result.rowsAffected > 0;
    },
    close() {
      if (ownsClient) client.close();
    },
  };
}
