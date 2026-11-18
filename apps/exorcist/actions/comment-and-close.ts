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
 * not post twice, while a later stale spell gets a new comment. Only counts when the
 * token's own user wrote it, since anyone can paste the text.
 */
export function markerFor(item: Pick<StaleItem, 'repo' | 'number' | 'updatedAt'>): string {
  return `<!-- crypt-kit:exorcist ${item.repo}#${item.number}@${item.updatedAt} -->`;
}

interface CommentJson {
  body: string | null;
  html_url: string;
  user: { login: string } | null;
}

interface IssueJson {
  state: string;
  updated_at: string;
}

/**
 * Posts the approved triage comment, then closes the item only if the user kept the
 * `close` option (R6.4).
 * - Safe to retry: our own earlier comment for this stale spell is found by its marker
 *   and not posted again.
 * - Never acts on a changed thread: if the item closed or had new activity since the
 *   draft was written, nothing is posted, so an old draft can't answer a new reply.
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
      const what = item.kind === 'pull_request' ? 'pull request' : 'issue';

      const me = (await github.request<{ login: string }>('GET', '/user', { signal })).data.login.toLowerCase();
      const ours = (c: CommentJson) => c.user?.login.toLowerCase() === me && (c.body?.includes(marker) ?? false);

      let posted: CommentJson | null = null;
      let url: string | null = `${base}/comments?since=${encodeURIComponent(item.updatedAt)}&per_page=100`;
      for (let page = 0; url && page < MAX_MARKER_PAGES && !posted; page++) {
        const res: { data: CommentJson[]; next: string | null } = await github.request<CommentJson[]>('GET', url, { signal });
        posted = res.data.find(ours) ?? null;
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
        // Our own earlier comment would move updated_at, which is why this check comes
        // after the marker search: only a first attempt needs the thread unchanged.
        const current = (await github.request<IssueJson>('GET', base, { signal })).data;
        if (current.state !== 'open') {
          throw new Error(`This ${what} was closed on GitHub after the draft was written, so nothing was posted.`);
        }
        if (Date.parse(current.updated_at) > Date.parse(item.updatedAt)) {
          throw new Error(
            `This ${what} changed on GitHub after the draft was written, so nothing was posted. Spare it; it comes back with a new draft if it goes quiet again.`,
          );
        }
        const body = `${draft.proposal.trim()}\n\n${marker}`;
        posted = (await github.request<CommentJson>('POST', `${base}/comments`, { body: { body }, signal })).data;
      }

      const close = draft.options?.close === true;
      if (close) {
        const path = item.kind === 'pull_request' ? `/repos/${item.repo}/pulls/${item.number}` : base;
        const patch = item.kind === 'pull_request' ? { state: 'closed' } : { state: 'closed', state_reason: 'not_planned' };
        await github.request('PATCH', path, { body: patch, signal });
      }

      const did = reused ? 'Comment was already posted' : 'Comment posted';
      return { ok: true, message: close ? `${did}; ${what} closed.` : `${did}.`, url: posted.html_url };
    },
  };
}
