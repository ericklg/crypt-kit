import { DEFAULT_SETTLE_AFTER_MS, hashPayload, type Finding, type Haunt } from '@crypt-kit/core';
import type { HauntFact, HauntView } from './types.js';

/** How an app describes one of its findings on the board. Runs on the server. */
export interface Presenter<P> {
  meta(finding: Finding<P>): string;
  age(finding: Finding<P>, now: Date): string;
  facts?(finding: Finding<P>): HauntFact[];
  headline?(finding: Finding<P>): HauntView['headline'];
}

export interface ViewOptions {
  now?: Date;
  /**
   * The runner's settle window, used when an approving haunt has no stored deadline
   * (the runner falls back to `updatedAt + settleAfterMs` the same way). Default
   * `DEFAULT_SETTLE_AFTER_MS`; pass the runner's value if you changed it.
   */
  settleAfterMs?: number;
}

/**
 * Turns a haunt into the small, serializable view the board renders. Only the fields
 * listed here cross to the client: the payload and hashes stay on the server.
 */
export function toHauntView<P>(haunt: Haunt<P>, present: Presenter<P>, options: ViewOptions = {}): HauntView {
  const { finding } = haunt;
  const now = options.now ?? new Date();
  const settleAfterMs = options.settleAfterMs ?? DEFAULT_SETTLE_AFTER_MS;

  let claimExpiresAt: string | null = null;
  if (haunt.status === 'approving') {
    const fallback = Date.parse(haunt.updatedAt) + settleAfterMs;
    claimExpiresAt = haunt.claimExpiresAt ?? (Number.isFinite(fallback) ? new Date(fallback).toISOString() : null);
  }

  return {
    key: haunt.key,
    revision: haunt.version,
    // Includes the key, so identical drafts on two haunts still get different ids.
    draftId: haunt.draft ? hashPayload({ key: haunt.key, draft: haunt.draft }).slice(0, 16) : null,
    status: haunt.status,
    severity: finding.severity,
    title: finding.title,
    meta: present.meta(finding),
    age: present.age(finding, now),
    url: finding.url,
    facts: present.facts?.(finding) ?? [],
    headline: present.headline?.(finding) ?? null,
    draft: haunt.draft
      ? {
          summary: haunt.draft.summary,
          proposal: haunt.draft.proposal,
          reasoning: haunt.draft.reasoning,
          options: { ...haunt.draft.options },
        }
      : null,
    error: haunt.error,
    claimExpiresAt,
  };
}
