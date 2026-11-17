import type { ActionResult } from './action.js';
import type { Draft } from './draft.js';
import type { Finding } from './finding.js';

export const HAUNT_STATUSES = [
  'new',
  'drafted',
  'draft_failed',
  'approving',
  'approved',
  'action_failed',
  'spared',
  'resolved',
] as const;

export type HauntStatus = (typeof HAUNT_STATUSES)[number];

/** Statuses the board shows as open and waiting on the user. */
export const OPEN_STATUSES: readonly HauntStatus[] = ['new', 'drafted', 'draft_failed', 'action_failed'];

/**
 * An approval was claimed but its outcome was never recorded (the process died or the
 * final save failed). The action may or may not have run, so the user must check the
 * source and settle the haunt instead of approving it again.
 */
export const NEEDS_CHECK_STATUSES: readonly HauntStatus[] = ['approving'];

/** Statuses that are still "live" at the source, so they resolve when the item disappears. */
export const RESOLVABLE_STATUSES: readonly HauntStatus[] = [...OPEN_STATUSES, 'spared'];

/** A finding plus everything the kit has done about it. */
export interface Haunt<P = unknown> {
  key: string;
  detectorId: string;
  status: HauntStatus;
  /**
   * Starts at 1 and goes up by one on every write. Stores only accept a write whose
   * expected version matches, so concurrent writers (any runner, any process) can't
   * overwrite each other.
   */
  version: number;
  finding: Finding<P>;
  /** Hash of the latest `finding.payload`. */
  payloadHash: string;
  /**
   * Payload hash at the moment the user spared this haunt, or null if never spared.
   * Survives resolution, so an unchanged item that disappears and returns stays spared (R4.3).
   */
  sparedPayloadHash: string | null;
  draft: Draft | null;
  result: ActionResult | null;
  /** Last draft or action error, shown on the board. */
  error: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  updatedAt: string;
}
