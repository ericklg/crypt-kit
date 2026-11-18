import { z } from 'zod';
import { DEFAULT_STALE_DAYS } from './detectors/stale-items';
import { REPO_PATTERN } from './github';

const repoList = z
  .string()
  .transform((s) => s.split(',').map((r) => r.trim()).filter(Boolean))
  .pipe(z.array(z.string().regex(REPO_PATTERN, 'must be owner/repo')).min(1, 'list at least one owner/repo'));

const envSchema = z.object({
  /** Comma-separated `owner/repo` list to watch. */
  EXORCIST_REPOS: repoList,
  EXORCIST_STALE_DAYS: z.coerce.number().int().min(1).default(DEFAULT_STALE_DAYS),
  /** Fine-grained token, Issues + Pull requests read/write, only on EXORCIST_REPOS (R6.5). */
  GITHUB_TOKEN: z.string().min(1),
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
  boardPassword: string | null;
  publicDemo: boolean;
  cronSecret: string | null;
};

/** Reads and validates the app's env. Throws a readable error naming the bad variables. */
export function loadConfig(env: Record<string, string | undefined> = process.env): ExorcistConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Exorcist is misconfigured: ${problems}`);
  }
  const e = parsed.data;
  return {
    repos: e.EXORCIST_REPOS,
    staleDays: e.EXORCIST_STALE_DAYS,
    githubToken: e.GITHUB_TOKEN,
    boardPassword: e.CRYPT_BOARD_PASSWORD ?? null,
    publicDemo: e.CRYPT_PUBLIC_DEMO !== undefined,
    cronSecret: e.CRON_SECRET ?? null,
  };
}
