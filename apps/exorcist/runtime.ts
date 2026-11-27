// How Exorcist is wired: config, runner, store. Next.js code imports it through ./crypt
// (which adds `server-only`); scripts like mcp.ts import it directly.
import { createAiAgent, modelFromEnv } from '@crypt-kit/agent';
import { createRunner, type Runner } from '@crypt-kit/core';
import { createSqliteStore, DEFAULT_DATABASE_URL } from '@crypt-kit/store-sqlite';
import { createCommentAndCloseAction } from './actions/comment-and-close';
import { loadConfig, type ExorcistConfig } from './config';
import { createStaleItemsDetector, type StaleItem } from './detectors/stale-items';
import { describeStaleItem, TRIAGE_INSTRUCTIONS, TRIAGE_OPTIONS } from './prompt';

// One runner and store per server process. They hold no request state; built on first
// use so a missing env var fails the request that needs it, not the build.
let config: ExorcistConfig | null = null;
let runner: Runner<StaleItem> | null = null;

export function getConfig(): ExorcistConfig {
  config ??= loadConfig();
  return config;
}

export function getRunner(): Runner<StaleItem> {
  if (runner) return runner;
  const c = getConfig();
  const github = c.githubApiUrl ? { baseUrl: c.githubApiUrl } : {};
  const url = process.env.CRYPT_DB_URL?.trim() || DEFAULT_DATABASE_URL;
  const authToken = process.env.CRYPT_DB_AUTH_TOKEN?.trim();
  runner = createRunner<StaleItem>({
    detector: createStaleItemsDetector({ repos: c.repos, staleDays: c.staleDays, token: c.githubToken, ...github }),
    agent: createAiAgent<StaleItem>({
      // Resolved on the first draft: reading the board needs no model settings.
      model: () => modelFromEnv(),
      instructions: TRIAGE_INSTRUCTIONS,
      options: TRIAGE_OPTIONS,
      describe: (f) => describeStaleItem(f),
    }),
    action: createCommentAndCloseAction({ token: c.githubToken, ...github }),
    // An issue banished with a comment can go quiet again later; bring it back then.
    reopenApprovedOnChange: true,
    // Its own table, so Exorcist and Poltergeist can share one database.
    store: createSqliteStore({ url, tableName: 'exorcist_haunts', ...(authToken ? { authToken } : {}) }),
  });
  return runner;
}
