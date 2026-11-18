import type { Action } from '@crypt-kit/core';
import type { StaleItem } from '../detectors/stale-items';
import { createGitHub } from '../github';

/** Pages of 100 comments checked for an earlier attempt's marker. */
const MAX_MARKER_PAGES = 5;

export interface CommentAndCloseOptions {
  /** Fine-grained token with Issues and Pull requests read/write on the configured repos (R6.5). */
  token: string;
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
}

/**
 * Identifies this approval's comment. It is tied to the item's last activity before the
 * comment, so a retried or re-settled approval of the same stale spell finds it and does
 * not post twice, while a later stale spell gets a new comment.
 */
export function markerFor(item: Pick<StaleItem, 'repo' | 'number' | 'updatedAt'>): string {
  return `<!-- crypt-kit:exorcist ${item.repo}#${item.number}@${item.updatedAt} -->`;
}

interface CommentJson {
  body: string | null;
  html_url: string;
}

/**
 * Posts the approved triage comment, then closes the item only if the user kept the
 * `close` option (R6.4). Safe to retry: an earlier attempt's comment is found by its
 * marker and not posted again.
 */
export function createCommentAndCloseAction(options: CommentAndCloseOptions): Action<StaleItem> {
  const github = createGitHub({
    token: options.token,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
  });

  return {
    id: 'github-comment-and-close',
    async run(finding, draft, { signal }) {
      const item = finding.payload;
      const base = `/repos/${item.repo}/issues/${item.number}`;
      const marker = markerFor(item);

      let posted: CommentJson | null = null;
      let url: string | null = `${base}/comments?since=${encodeURIComponent(item.updatedAt)}&per_page=100`;
      for (let page = 0; url && page < MAX_MARKER_PAGES && !posted; page++) {
        const res: { data: CommentJson[]; next: string | null } = await github.request<CommentJson[]>('GET', url, { signal });
        posted = res.data.find((c) => c.body?.includes(marker)) ?? null;
        url = res.next;
      }
      // An unfinished search can't prove there's no earlier comment, so don't risk a duplicate.
      if (!posted && url) {
        throw new Error(
          `More than ${MAX_MARKER_PAGES * 100} comments since this item went quiet, so an earlier attempt couldn’t be ruled out. Nothing was posted; check the thread on GitHub.`,
        );
      }

      const reused = posted !== null;
      if (!posted) {
        const body = `${draft.proposal.trim()}\n\n${marker}`;
        posted = (await github.request<CommentJson>('POST', `${base}/comments`, { body: { body }, signal })).data;
      }

      const close = draft.options?.close === true;
      if (close) {
        const path = item.kind === 'pull_request' ? `/repos/${item.repo}/pulls/${item.number}` : base;
        const patch = item.kind === 'pull_request' ? { state: 'closed' } : { state: 'closed', state_reason: 'not_planned' };
        await github.request('PATCH', path, { body: patch, signal });
      }

      const what = item.kind === 'pull_request' ? 'pull request' : 'issue';
      const did = reused ? 'Comment was already posted' : 'Comment posted';
      return { ok: true, message: close ? `${did}; ${what} closed.` : `${did}.`, url: posted.html_url };
    },
  };
}
