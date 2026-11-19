import 'server-only';
import { createAiAgent, modelFromEnv } from '@crypt-kit/agent';
import { createRunner, type Runner } from '@crypt-kit/core';
import {
  createSqliteKeyValue,
  createSqliteStore,
  createSqliteWatchlist,
  DEFAULT_DATABASE_URL,
  type SqliteWatchlist,
} from '@crypt-kit/store-sqlite';
import { createOpenDealAction } from './actions/open-deal';
import { loadConfig, type PoltergeistConfig } from './config';
import { createPriceDropsDetector, type PriceDrop } from './detectors/price-drops';
import { describePriceDrop, VERDICT_INSTRUCTIONS } from './prompt';
import { createCheapSharkSource } from './sources/cheapshark';
import { createFixtureSource, FIXTURE_CATALOG } from './sources/fixture';
import type { PriceSource } from './sources/price-source';

// One runner, store, watchlist and source (with its cache) per server process, built on
// first use so a missing env var fails the request that needs it, not the build.
let config: PoltergeistConfig | null = null;
let source: PriceSource | null = null;
let watchlist: SqliteWatchlist | null = null;
let runner: Runner<PriceDrop> | null = null;

const dbUrl = () => process.env.CRYPT_DB_URL?.trim() || DEFAULT_DATABASE_URL;
const db = () => {
  const authToken = process.env.CRYPT_DB_AUTH_TOKEN?.trim();
  return { url: dbUrl(), ...(authToken ? { authToken } : {}) };
};

export function getConfig(): PoltergeistConfig {
  config ??= loadConfig();
  return config;
}

export function getSource(): PriceSource {
  if (source) return source;
  const c = getConfig();
  // CheapShark's cache and rate-limit pause live in the database, so every instance shares them.
  source =
    c.source === 'cheapshark'
      ? createCheapSharkSource({ contact: c.cheapsharkContact, shared: createSqliteKeyValue({ ...db(), tableName: 'poltergeist_kv' }) })
      : createFixtureSource();
  return source;
}

/**
 * The watched games, kept in the database and edited from the board's watchlist drawer.
 * POLTERGEIST_WATCHLIST (or the demo list) seeds it once, the first time it's read.
 */
export function getWatchlist(): SqliteWatchlist {
  if (watchlist) return watchlist;
  const c = getConfig();
  const titles = new Map(FIXTURE_CATALOG.map((q) => [q.itemId, q.title]));
  watchlist = createSqliteWatchlist({
    ...db(),
    tableName: 'poltergeist_watchlist',
    // Env entries have no titles; the drawer shows the source's current title instead.
    seed: (s) => (s === c.source ? c.watchlist.map((i) => ({ source: s, itemId: i.itemId, title: titles.get(i.itemId) ?? '', target: i.target })) : []),
  });
  return watchlist;
}

export function getRunner(): Runner<PriceDrop> {
  if (runner) return runner;
  const src = getSource();
  runner = createRunner<PriceDrop>({
    detector: createPriceDropsDetector({
      source: src,
      // Read on every poll, so drawer edits apply at the next price check.
      watchlist: async () => (await getWatchlist().list(src.id)).map((e) => ({ itemId: e.itemId, target: e.target })),
    }),
    agent: createAiAgent<PriceDrop>({ model: () => modelFromEnv(), instructions: VERDICT_INSTRUCTIONS, describe: describePriceDrop }),
    action: createOpenDealAction(),
    // Its own table, so Poltergeist and Exorcist can share one database.
    store: createSqliteStore({ ...db(), tableName: 'poltergeist_haunts' }),
  });
  return runner;
}
