import {
  CLAIMED_STATUSES,
  OPEN_STATUSES,
  type FailureReason,
  type HauntStatus,
  type OperationResult,
  type Runner,
} from '@crypt-kit/core';
import type { ActionOutcome, ApproveEdits, BoardActions, HauntView } from './types.js';
import { toHauntView, type Presenter } from './view.js';

export { accessMode, basicAuthMatches, boardPasswordChallenge, checkBoardAccess, type AccessConfig, type AccessMode } from './access.js';

/** Every status the board shows: open haunts plus the ones held by a claim. */
export const BOARD_STATUSES: readonly HauntStatus[] = [...OPEN_STATUSES, ...CLAIMED_STATUSES];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_KEY = 512;
const MAX_PROPOSAL = 20_000;
const MAX_OPTIONS = 20;

export interface LoadBoardOptions {
  now?: Date;
  /** The runner's `settleAfterMs`, if you changed it. See `toHauntView`. */
  settleAfterMs?: number;
}

export interface BoardData {
  haunts: HauntView[];
  /** Haunts approved in the last 7 days. */
  score: number;
}

/** Reads what the board shows: the haunts as views (payloads stay here) and the weekly score. */
export async function loadBoard<P>(runner: Runner<P>, present: Presenter<P>, options: LoadBoardOptions = {}): Promise<BoardData> {
  const now = options.now ?? new Date();
  const [open, approved] = await Promise.all([runner.list(BOARD_STATUSES), runner.list(['approved'])]);
  const since = now.getTime() - WEEK_MS;
  return {
    haunts: open.map((h) =>
      toHauntView(h, present, { now, ...(options.settleAfterMs !== undefined ? { settleAfterMs: options.settleAfterMs } : {}) }),
    ),
    score: approved.filter((h) => Date.parse(h.updatedAt) >= since).length,
  };
}

/** What the user sees when an operation is refused, by reason. Runner messages can name internals. */
export type BoardMessages = Record<Exclude<FailureReason, 'action_failed'>, string> & {
  /** The request's arguments weren't well formed. */
  invalid: string;
  /** A run (Summon) failed. */
  runFailed: string;
};

export const DEFAULT_FAILURE_MESSAGES: BoardMessages = {
  invalid: 'That request wasn’t valid. Refresh and try again.',
  runFailed: 'The run didn’t finish. Refresh to see the current state.',
  not_found: 'This haunt is gone. Refresh to see the current board.',
  not_allowed: 'This haunt changed state. Refresh to see what it needs now.',
  in_progress: 'Something is already happening to this haunt. Wait a moment, then refresh.',
  conflict: 'This haunt changed somewhere else. Refresh and try again.',
  invalid_draft: 'The edited draft isn’t valid. Check it and try again.',
  outcome_unknown: 'We couldn’t confirm what happened. Check the source and refresh before trying again.',
  not_started: 'Nothing was done: the request took too long to start. Try again.',
};

/** Turns a runner result into what the board shows. Failed actions report their own error. */
export function toActionOutcome(result: OperationResult<unknown>, messages: BoardMessages = DEFAULT_FAILURE_MESSAGES): ActionOutcome {
  if (result.ok) {
    const url = result.haunt.result?.ok ? result.haunt.result.url : null;
    return url ? { ok: true, url } : { ok: true };
  }
  if (result.reason === 'action_failed') {
    const error = result.haunt?.result && !result.haunt.result.ok ? result.haunt.result.error : null;
    return { ok: false, message: error ?? result.message };
  }
  return { ok: false, message: messages[result.reason] };
}

/** Thrown by a guard to refuse an operation with a message the user may see. */
export class BoardAccessError extends Error {
  override readonly name = 'BoardAccessError';
}

export interface BoardActionsOptions {
  /**
   * Runs before every operation. Throw `BoardAccessError` to refuse it with that message;
   * anything else thrown fails the request. Put the caller's authorization and bot check here.
   */
  guard?: (op: keyof BoardActions) => Promise<void>;
  /** Overrides for any of `DEFAULT_FAILURE_MESSAGES`. */
  messages?: Partial<BoardMessages>;
}

function isKey(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && key.length <= MAX_KEY;
}

/** Validates approve input from the client. Returns null if it isn't well formed. */
export function parseApproveEdits(edits: unknown): ApproveEdits | null {
  if (typeof edits !== 'object' || edits === null) return null;
  const { proposal, options, revision } = edits as Record<string, unknown>;
  if (typeof proposal !== 'string' || proposal.length > MAX_PROPOSAL) return null;
  if (!Number.isSafeInteger(revision) || (revision as number) < 1) return null;
  if (typeof options !== 'object' || options === null || Array.isArray(options)) return null;
  const entries = Object.entries(options);
  if (entries.length > MAX_OPTIONS || entries.some(([, v]) => typeof v !== 'boolean')) return null;
  return { proposal, options: Object.fromEntries(entries) as Record<string, boolean>, revision: revision as number };
}

/**
 * The board's actions over a runner, for an app's `'use server'` functions to call.
 * Server functions are reachable by direct POST, so every argument is validated here and
 * `guard` runs before anything else.
 */
export function createBoardActions<P>(getRunner: () => Runner<P>, options: BoardActionsOptions = {}): BoardActions {
  const messages: BoardMessages = { ...DEFAULT_FAILURE_MESSAGES, ...options.messages };
  const invalid = (): ActionOutcome => ({ ok: false, message: messages.invalid });

  const guarded = async (op: keyof BoardActions, body: () => Promise<ActionOutcome>): Promise<ActionOutcome> => {
    try {
      await options.guard?.(op);
    } catch (error) {
      if (error instanceof BoardAccessError) return { ok: false, message: error.message };
      throw error;
    }
    return body();
  };

  return {
    approve: (key, edits) =>
      guarded('approve', async () => {
        const parsed = parseApproveEdits(edits);
        if (!isKey(key) || !parsed) return invalid();
        const result = await getRunner().approve(key, {
          proposal: parsed.proposal,
          options: parsed.options,
          expectedVersion: parsed.revision,
        });
        return toActionOutcome(result, messages);
      }),
    spare: (key) => guarded('spare', async () => (isKey(key) ? toActionOutcome(await getRunner().spare(key), messages) : invalid())),
    redraft: (key) =>
      guarded('redraft', async () => (isKey(key) ? toActionOutcome(await getRunner().redraft(key), messages) : invalid())),
    settle: (key, outcome) =>
      guarded('settle', async () =>
        isKey(key) && (outcome === 'done' || outcome === 'not_done')
          ? toActionOutcome(await getRunner().settle(key, outcome), messages)
          : invalid(),
      ),
    run: () =>
      guarded('run', async () => {
        const report = await getRunner().run();
        return report.ok ? { ok: true } : { ok: false, message: messages.runFailed };
      }),
  };
}
