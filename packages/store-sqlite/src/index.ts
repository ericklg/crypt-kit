import { createClient, type Client, type InValue, type Row } from '@libsql/client';
import { checkPutVersion, type Haunt, type ListFilter, type TrackerStore } from '@crypt-kit/core';

export const DEFAULT_TABLE_NAME = 'crypt_haunts';
export const DEFAULT_DATABASE_URL = 'file:crypt-kit.db';

export interface SqliteStoreOptions {
  /** An existing libSQL client. The store won't close a client it didn't create. */
  client?: Client;
  /** `file:./crypt-kit.db` locally, `libsql://<db>.turso.io` on Vercel, or `:memory:`. */
  url?: string;
  /** Turso auth token. Only needed for remote databases. */
  authToken?: string;
  /** Letters, digits and underscores only. Defaults to `crypt_haunts`. */
  tableName?: string;
}

export interface SqliteTrackerStore extends TrackerStore {
  /** Creates the table and index if needed. Every method calls it first, so this is optional. */
  migrate(): Promise<void>;
  /** Closes the client if this store created it. */
  close(): void;
}

const TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

/**
 * A TrackerStore on SQLite through libSQL. The same code runs against a local file in
 * development and a Turso database in production. Writes are a single conditional
 * statement (`ON CONFLICT DO NOTHING` / `WHERE version = ?`), so they stay safe across
 * processes and serverless instances.
 */
export function createSqliteStore(options: SqliteStoreOptions = {}): SqliteTrackerStore {
  const table = options.tableName ?? DEFAULT_TABLE_NAME;
  if (!TABLE_NAME.test(table)) throw new Error(`Invalid table name: ${JSON.stringify(table)}`);

  const ownsClient = !options.client;
  const client =
    options.client ??
    createClient(
      options.authToken
        ? { url: options.url ?? DEFAULT_DATABASE_URL, authToken: options.authToken }
        : { url: options.url ?? DEFAULT_DATABASE_URL },
    );

  let ready: Promise<void> | null = null;
  const migrate = (): Promise<void> => {
    ready ??= client
      .batch(
        [
          `create table if not exists ${table} (
            key text primary key,
            detector_id text not null,
            status text not null,
            version integer not null,
            first_seen_at text not null,
            data text not null
          )`,
          `create index if not exists ${table}_by_detector on ${table} (detector_id, status, first_seen_at, key)`,
        ],
        'write',
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
      const result = await client.execute({ sql: `select data from ${table} where key = ?`, args: [key] });
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
              sql: `insert into ${table} (key, detector_id, status, version, first_seen_at, data)
                    values (?, ?, ?, ?, ?, ?) on conflict (key) do nothing`,
              args: [haunt.key, haunt.detectorId, haunt.status, haunt.version, haunt.firstSeenAt, data],
            })
          : await client.execute({
              sql: `update ${table}
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
      // Default BINARY collation compares like plain JS string comparison (see compareHaunts).
      const sql = `select data from ${table}${where.length ? ` where ${where.join(' and ')}` : ''} order by first_seen_at, key`;
      const result = await client.execute({ sql, args });
      return result.rows.map(toHaunt);
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
