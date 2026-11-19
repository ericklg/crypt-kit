import 'server-only';
import { createAiAgent, modelFromEnv } from '@crypt-kit/agent';
import { createRunner, type Runner } from '@crypt-kit/core';
import { createSqliteStore, DEFAULT_DATABASE_URL } from '@crypt-kit/store-sqlite';
import { createOpenDealAction } from './actions/open-deal';
import { loadConfig, type PoltergeistConfig } from './config';
import { createPriceDropsDetector, type PriceDrop } from './detectors/price-drops';
import { describePriceDrop, VERDICT_INSTRUCTIONS } from './prompt';
import { createCheapSharkSource } from './sources/cheapshark';
import { createFixtureSource } from './sources/fixture';
import type { PriceSource } from './sources/price-source';

// One runner, store and source (with its cache) per server process, built on first use
// so a missing env var fails the request that needs it, not the build.
let config: PoltergeistConfig | null = null;
let source: PriceSource | null = null;
let runner: Runner<PriceDrop> | null = null;

export function getConfig(): PoltergeistConfig {
  config ??= loadConfig();
  return config;
}

export function getSource(): PriceSource {
  const c = getConfig();
  source ??= c.source === 'cheapshark' ? createCheapSharkSource({ contact: c.cheapsharkContact }) : createFixtureSource();
  return source;
}

export function getRunner(): Runner<PriceDrop> {
  if (runner) return runner;
  const c = getConfig();
  const url = process.env.CRYPT_DB_URL?.trim() || DEFAULT_DATABASE_URL;
  const authToken = process.env.CRYPT_DB_AUTH_TOKEN?.trim();
  runner = createRunner<PriceDrop>({
    detector: createPriceDropsDetector({ source: getSource(), watchlist: async () => c.watchlist }),
    agent: createAiAgent<PriceDrop>({ model: () => modelFromEnv(), instructions: VERDICT_INSTRUCTIONS, describe: describePriceDrop }),
    action: createOpenDealAction(),
    // Its own table, so Poltergeist and Exorcist can share one database.
    store: createSqliteStore({ url, tableName: 'poltergeist_haunts', ...(authToken ? { authToken } : {}) }),
  });
  return runner;
}
