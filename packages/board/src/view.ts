import type { Finding, Haunt } from '@crypt-kit/core';
import type { HauntFact, HauntView } from './types.js';

/** How an app describes one of its findings on the board. Runs on the server. */
export interface Presenter<P> {
  meta(finding: Finding<P>): string;
  age(finding: Finding<P>, now: Date): string;
  facts?(finding: Finding<P>): HauntFact[];
  headline?(finding: Finding<P>): HauntView['headline'];
}

/**
 * Turns a haunt into the small, serializable view the board renders. Only the fields
 * listed here cross to the client: the raw payload, hashes and versions stay on the server.
 */
export function toHauntView<P>(haunt: Haunt<P>, present: Presenter<P>, now: Date = new Date()): HauntView {
  const { finding } = haunt;
  return {
    key: haunt.key,
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
    claimExpiresAt: haunt.status === 'approving' ? haunt.claimExpiresAt : null,
  };
}
