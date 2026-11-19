import { z } from 'zod';
import { DEFAULT_STALE_DAYS } from './detectors/stale-items';
import { REPO_PATTERN } from './github';

const repoList = z
  .string()
  .transform((s) => s.split(',').map((r) => r.trim()).filter(Boolean))
  .pipe(z.array(z.string().regex(REPO_PATTERN, 'must be owner/repo')).min(1, 'list at least one owner/repo'));

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** HTTPS, or plain HTTP only on this machine (a local stand-in for tests). No trailing slash. */
const apiUrl = z
  .url()
  .refine((s) => {
    if (!URL.canParse(s)) return false; // zod still runs this after z.url() fails
    const u = new URL(s);
    return u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK.has(u.hostname));
  }, 'use https (http only for localhost)')
  .transform((s) => s.replace(/\/+$/, ''));

const envSchema = z.object({
  /** Comma-separated `owner/repo` list to watch. */
  EXORCIST_REPOS: repoList,
  EXORCIST_STALE_DAYS: z.coerce.number().int().min(1).default(DEFAULT_STALE_DAYS),
  /** Fine-grained token, Issues + Pull requests read/write, only on EXORCIST_REPOS (R6.5). */
  GITHUB_TOKEN: z.string().min(1),
  /** GitHub's REST API root. Unset: api.github.com. For GitHub Enterprise, or a local fake in tests. */
  GITHUB_API_URL: apiUrl.optional(),
  /** Who may act. See access.ts. */
  CRYPT_BOARD_PASSWORD: z.string().min(12).optional(),
  CRYPT_PUBLIC_DEMO: z.enum(['1', 'true']).optional(),
  /** Vercel Cron sends it as a bearer token on scheduled runs. */
  CRON_SECRET: z.string().min(16).optional(),
});

export type ExorcistConfig = {
  repos: string[];
  staleDays: number;
  githubToken: string;
  githubApiUrl: string | null;
  boardPassword: string | null;
  publicDemo: boolean;
  cronSecret: string | null;
};

/** A missing or invalid env var. Its message names variables, never their values. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** Reads and validates the app's env. Throws a ConfigError naming the bad variables. */
export function loadConfig(env: Record<string, string | undefined> = process.env): ExorcistConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Exorcist is misconfigured: ${problems}`);
  }
  const e = parsed.data;
  return {
    repos: e.EXORCIST_REPOS,
    staleDays: e.EXORCIST_STALE_DAYS,
    githubToken: e.GITHUB_TOKEN,
    githubApiUrl: e.GITHUB_API_URL ?? null,
    boardPassword: e.CRYPT_BOARD_PASSWORD ?? null,
    publicDemo: e.CRYPT_PUBLIC_DEMO !== undefined,
    cronSecret: e.CRON_SECRET ?? null,
  };
}
