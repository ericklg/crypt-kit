import type { ActionResult } from './action.js';
import type { Draft } from './draft.js';
import type { Finding } from './finding.js';

export const HAUNT_STATUSES = [
  'new',
  'drafted',
  'draft_failed',
  'approved',
  'action_failed',
  'spared',
  'resolved',
] as const;

export type HauntStatus = (typeof HAUNT_STATUSES)[number];

/** Statuses the board shows as open and waiting on the user. */
export const OPEN_STATUSES: readonly HauntStatus[] = ['new', 'drafted', 'draft_failed', 'action_failed'];

/** Statuses that are still "live" at the source, so they resolve when the item disappears. */
export const RESOLVABLE_STATUSES: readonly HauntStatus[] = [...OPEN_STATUSES, 'spared'];

/** A finding plus everything the kit has done about it. */
export interface Haunt<P = unknown> {
  key: string;
  detectorId: string;
  status: HauntStatus;
  finding: Finding<P>;
  /** Hash of `finding.payload`, used to re-draft a spared haunt only when it changes. */
  payloadHash: string;
  draft: Draft | null;
  result: ActionResult | null;
  /** Last draft or action error, shown on the board. */
  error: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  updatedAt: string;
}
