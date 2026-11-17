// Crypt Kit core: detector, tracker, runner, agent and action contracts.
// Test helpers live in the separate "@crypt-kit/core/testing" entry point.
export const CRYPT_KIT_VERSION = '0.2.0';

export type { Action, ActionContext, ActionResult } from './action.js';
export type { Detector, PollContext } from './detector.js';
export { draftSchema, type Agent, type Draft } from './draft.js';
export { findingEnvelopeSchema, severitySchema, type Finding, type Severity } from './finding.js';
export { hashPayload, stableStringify } from './hash.js';
export {
  CLAIMED_STATUSES,
  HAUNT_STATUSES,
  NEEDS_CHECK_STATUSES,
  OPEN_STATUSES,
  RESOLVABLE_STATUSES,
  type Haunt,
  type HauntStatus,
} from './haunt.js';
export { consoleLogger, errorMessage, silentLogger, type Logger } from './logger.js';
export {
  createRunner,
  DEFAULT_ACTION_TIMEOUT_MS,
  DEFAULT_DRAFT_CLAIM_TIMEOUT_MS,
  DEFAULT_MAX_DRAFTS_PER_RUN,
  DEFAULT_POLL_TIMEOUT_MS,
  DEFAULT_SETTLE_AFTER_MS,
  type DraftEdits,
  type FailureReason,
  type OperationResult,
  type RunReport,
  type Runner,
  type RunnerOptions,
  type SettleOutcome,
} from './runner.js';
export {
  checkPutVersion,
  compareHaunts,
  createMemoryStore,
  type ListFilter,
  type TrackerStore,
} from './tracker.js';
