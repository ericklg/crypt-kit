import type { Detector, Finding, Severity } from '@crypt-kit/core';
import { z } from 'zod';
import { createGitHub, REPO_PATTERN } from '../github';

export const DEFAULT_STALE_DAYS = 30;
/** Pages of 100 read per repo, oldest activity first. Older items than this are never reached. */
const MAX_PAGES = 10;
const RECENT_COMMENTS = 5;
const BODY_CHARS = 2000;
const COMMENT_CHARS = 600;
const COMMENT_FETCHES_AT_ONCE = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

const commentSchema = z.object({
  author: z.string().nullable(),
  body: z.string(),
  createdAt: z.iso.datetime(),
});

/**
 * Only values that change when something real happens on the item, so a spared ghost is
 * redrafted when someone replies or edits it, not because another day passed (detector rule 5).
 */
export const staleItemSchema = z.object({
  repo: z.string().regex(REPO_PATTERN),
  number: z.int().positive(),
  kind: z.enum(['issue', 'pull_request']),
  title: z.string(),
  author: z.string().nullable(),
  labels: z.array(z.string()),
  comments: z.int().nonnegative(),
  createdAt: z.iso.datetime(),
  /** Last activity. The action's idempotency marker is built from it. */
  updatedAt: z.iso.datetime(),
  body: z.string(),
  lastComments: z.array(commentSchema),
});

export type StaleItem = z.infer<typeof staleItemSchema>;

export interface StaleItemsOptions {
  /** `owner/repo` names to watch. */
  repos: readonly string[];
  /** Days without activity before an item is stale. Default 30 (R6.1). */
  staleDays?: number;
  token?: string | null;
  baseUrl?: string;
}

/** The part of GitHub's issue object this detector reads. */
interface IssueJson {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  user: { login: string } | null;
  labels: Array<string | { name?: string }>;
  comments: number;
  created_at: string;
  updated_at: string;
  pull_request?: unknown;
}

interface CommentJson {
  user: { login: string } | null;
  body: string | null;
  created_at: string;
}

const excerpt = (text: string | null, max: number) => {
  const t = (text ?? '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** GitHub timestamps are second-precision ISO; normalise so the payload hash is stable. */
const iso = (value: string) => new Date(value).toISOString();

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function severityFor(updatedAt: string, now: Date, staleDays: number): Severity {
  const days = (now.getTime() - Date.parse(updatedAt)) / DAY_MS;
  if (days >= staleDays * 3) return 'high';
  if (days >= staleDays * 2) return 'medium';
  return 'low';
}

/**
 * Open issues and pull requests with no activity for `staleDays` (R6.1), keyed
 * `owner/repo#number` (R6.2). Reads the oldest-updated items first and stops at the
 * cutoff, so a busy repo costs a page, not its whole backlog.
 */
export function createStaleItemsDetector(options: StaleItemsOptions): Detector<StaleItem> {
  const staleDays = options.staleDays ?? DEFAULT_STALE_DAYS;
  if (!Number.isInteger(staleDays) || staleDays < 1) throw new RangeError('staleDays must be a positive integer');
  for (const repo of options.repos) {
    if (!REPO_PATTERN.test(repo)) throw new RangeError(`Not an owner/repo name: ${repo}`);
  }
  const repos = [...new Set(options.repos.map((r) => r.toLowerCase()))];

  return {
    id: 'github-stale-items',
    payloadSchema: staleItemSchema,
    async poll(ctx) {
      const github = createGitHub({ token: options.token ?? null, fetch: ctx.fetch, ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}) });
      const now = ctx.now();
      const cutoff = now.getTime() - staleDays * DAY_MS;

      const lastComments = async (repo: string, item: IssueJson) => {
        if (item.comments === 0) return [];
        const page = Math.ceil(item.comments / RECENT_COMMENTS);
        const { data } = await github.request<CommentJson[]>(
          'GET',
          `/repos/${repo}/issues/${item.number}/comments?per_page=${RECENT_COMMENTS}&page=${page}`,
          { signal: ctx.signal },
        );
        return data.map((c) => ({ author: c.user?.login ?? null, body: excerpt(c.body, COMMENT_CHARS), createdAt: iso(c.created_at) }));
      };

      const findings: Finding<StaleItem>[] = [];
      for (const repo of repos) {
        const stale: IssueJson[] = [];
        let url: string | null = `/repos/${repo}/issues?state=open&sort=updated&direction=asc&per_page=100`;
        for (let page = 0; url && page < MAX_PAGES; page++) {
          const res: { data: IssueJson[]; next: string | null } = await github.request<IssueJson[]>('GET', url, { signal: ctx.signal });
          const fresh = res.data.findIndex((i) => Date.parse(i.updated_at) >= cutoff);
          stale.push(...(fresh === -1 ? res.data : res.data.slice(0, fresh)));
          url = fresh === -1 ? res.next : null;
        }
        if (url) ctx.log.warn(`${repo}: more than ${MAX_PAGES * 100} stale items; only the oldest ${MAX_PAGES * 100} are tracked`);

        const comments = await mapLimit(stale, COMMENT_FETCHES_AT_ONCE, (item) => lastComments(repo, item));
        stale.forEach((item, i) => {
          const updatedAt = iso(item.updated_at);
          findings.push({
            key: `${repo}#${item.number}`,
            kind: item.pull_request ? 'pull_request' : 'issue',
            severity: severityFor(updatedAt, now, staleDays),
            title: item.title,
            url: item.html_url,
            observedAt: now.toISOString(),
            payload: {
              repo,
              number: item.number,
              kind: item.pull_request ? 'pull_request' : 'issue',
              title: item.title,
              author: item.user?.login ?? null,
              labels: item.labels.map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean),
              comments: item.comments,
              createdAt: iso(item.created_at),
              updatedAt,
              body: excerpt(item.body, BODY_CHARS),
              lastComments: comments[i]!,
            },
          });
        });
      }
      return findings;
    },
  };
}
