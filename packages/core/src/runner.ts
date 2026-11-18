import type { Action, ActionResult } from './action.js';
import type { Detector, PollContext } from './detector.js';
import { draftSchema, type Agent, type Draft } from './draft.js';
import { findingEnvelopeSchema, type Finding } from './finding.js';
import { findNonJson, hashPayload } from './hash.js';
import { CLAIMED_STATUSES, OPEN_STATUSES, RESOLVABLE_STATUSES, type Haunt, type HauntStatus } from './haunt.js';
import { consoleLogger, errorMessage, type Logger } from './logger.js';
import type { TrackerStore } from './tracker.js';

export const DEFAULT_MAX_DRAFTS_PER_RUN = 20;
export const DEFAULT_POLL_TIMEOUT_MS = 30_000;
export const DEFAULT_ACTION_TIMEOUT_MS = 60_000;
export const DEFAULT_SETTLE_AFTER_MS = 5 * 60_000;
export const DEFAULT_DRAFT_CLAIM_TIMEOUT_MS = 2 * 60_000;

export interface RunnerOptions<P> {
  detector: Detector<P>;
  agent: Agent<P>;
  action: Action<P>;
  store: TrackerStore;
  /** Cap on agent calls per run (R3.4). Findings over the cap are drafted on the next run. */
  maxDraftsPerRun?: number;
  pollTimeoutMs?: number;
  /**
   * How long an action may run before the runner aborts it and leaves the haunt
   * `approving` for the user to check. Default 60 s.
   */
  actionTimeoutMs?: number;
  /**
   * How long after an approval claim `settle()` is allowed. Must be longer than
   * `actionTimeoutMs`, so the original attempt has stopped before anyone retries it.
   * Default 5 min.
   */
  settleAfterMs?: number;
  /**
   * After this long, a `drafting` claim is treated as abandoned and can be taken over.
   * The agent call is aborted shortly before then. Default 2 min.
   */
  draftClaimTimeoutMs?: number;
  /**
   * Reopen an `approved` haunt as `new` when a poll finds its payload changed. Off by
   * default, because most keys name one event (a price, a version). Turn it on when a key
   * names a long-lived item that can need acting on again, like a GitHub issue.
   */
  reopenApprovedOnChange?: boolean;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  log?: Logger;
}

export interface RunReport {
  ok: boolean;
  error: string | null;
  /** Valid, unique findings returned by this poll. */
  found: number;
  /** Findings dropped for failing validation or repeating a key. */
  invalid: number;
  created: number;
  /** Resolved or spared haunts that came back as new. */
  reopened: number;
  resolved: number;
  drafted: number;
  draftFailed: number;
  /** New haunts left for the next run because of the draft cap. */
  deferred: number;
  /** Writes skipped because another runner or process changed the haunt first. */
  conflicts: number;
}

export type FailureReason =
  | 'not_found'
  | 'not_allowed'
  /** Another operation on this haunt is running in this process. */
  | 'in_progress'
  /** Another runner or process changed the haunt first. Reload and try again. */
  | 'conflict'
  | 'invalid_draft'
  | 'action_failed'
  /** The action was attempted but its result couldn't be saved. The haunt is left `approving`. */
  | 'outcome_unknown'
  /** The claim took longer than the action timeout to save, so the action was never started. */
  | 'not_started';

export type OperationResult<P> =
  | { ok: true; haunt: Haunt<P> }
  | { ok: false; reason: FailureReason; message: string; haunt: Haunt<P> | null };

export interface DraftEdits {
  proposal?: string;
  /** Only keys already present in the draft's options can be changed. */
  options?: Record<string, boolean>;
  /**
   * The haunt version the user reviewed. When set, approve fails with `conflict` if the
   * haunt has changed since (e.g. a run replaced the draft), so edits written for one
   * draft are never applied to another.
   */
  expectedVersion?: number;
}

/** What the user found at the source for a haunt stuck in `approving`. */
export type SettleOutcome = 'done' | 'not_done';

export interface Runner<P> {
  /** Poll, dedupe, resolve and draft. Concurrent calls share one run. */
  run(): Promise<RunReport>;
  /**
   * Claim the haunt as `approving`, run the action once, then record the result.
   * The only path to a side effect (R4.1).
   */
  approve(key: string, edits?: DraftEdits): Promise<OperationResult<P>>;
  /** Reject a haunt. It is re-drafted only if its payload changes (R4.3). */
  spare(key: string): Promise<OperationResult<P>>;
  /** Ask the agent again for a failed or unwanted draft. */
  redraft(key: string): Promise<OperationResult<P>>;
  /**
   * Resolve a haunt stuck in `approving` after the user checked the source:
   * `done` marks it approved, `not_done` returns it to `drafted` so it can be approved again.
   */
  settle(key: string, outcome: SettleOutcome): Promise<OperationResult<P>>;
  list(status?: readonly HauntStatus[]): Promise<Haunt<P>[]>;
}

/** Open statuses whose draft (or failed draft) was written for one specific payload. */
const DRAFT_HOLDING: readonly HauntStatus[] = ['drafted', 'draft_failed', 'action_failed'];

const locksByStore = new WeakMap<TrackerStore, Set<string>>();
const runsByStore = new WeakMap<TrackerStore, Map<string, Promise<RunReport>>>();

/** In-flight runs keyed by detector ID, shared by every runner on the same store. */
function runsFor(store: TrackerStore): Map<string, Promise<RunReport>> {
  let runs = runsByStore.get(store);
  if (!runs) {
    runs = new Map();
    runsByStore.set(store, runs);
  }
  return runs;
}

function locksFor(store: TrackerStore): Set<string> {
  let locks = locksByStore.get(store);
  if (!locks) {
    locks = new Set();
    locksByStore.set(store, locks);
  }
  return locks;
}

const APPROVABLE: readonly HauntStatus[] = ['drafted', 'action_failed'];
const REDRAFTABLE: readonly HauntStatus[] = ['drafted', 'draft_failed'];
const SPARABLE: readonly HauntStatus[] = [...OPEN_STATUSES, 'drafting'];


export function createRunner<P>(options: RunnerOptions<P>): Runner<P> {
  const { detector, agent, action, store } = options;
  const maxDrafts = options.maxDraftsPerRun ?? DEFAULT_MAX_DRAFTS_PER_RUN;
  const pollTimeoutMs = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? consoleLogger;

  const actionTimeoutMs = options.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;
  const settleAfterMs = options.settleAfterMs ?? DEFAULT_SETTLE_AFTER_MS;
  const draftClaimTimeoutMs = options.draftClaimTimeoutMs ?? DEFAULT_DRAFT_CLAIM_TIMEOUT_MS;
  const reopenApprovedOnChange = options.reopenApprovedOnChange ?? false;

  if (!Number.isInteger(maxDrafts) || maxDrafts < 0) {
    throw new RangeError('maxDraftsPerRun must be a non-negative integer');
  }
  for (const [name, value] of Object.entries({ actionTimeoutMs, settleAfterMs, draftClaimTimeoutMs })) {
    if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`);
  }
  if (settleAfterMs <= actionTimeoutMs) {
    throw new RangeError('settleAfterMs must be longer than actionTimeoutMs');
  }

  // How long before the draft claim expires the agent call is aborted. Leaves time to
  // save draft_failed while the claim is still ours.
  const draftAbortMarginMs = Math.min(5_000, Math.floor(draftClaimTimeoutMs / 10));

  /**
   * Calls the agent with an abort signal and a hard timeout of `budgetMs`. A timeout
   * rejects, so the haunt is saved as draft_failed and can be redrafted.
   */
  async function callAgent(haunt: Haunt<P>, budgetMs: number): Promise<unknown> {
    if (budgetMs <= 0) throw new Error('Claiming the draft took too long, so the agent was not called');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`The agent didn't answer within ${Math.round(budgetMs / 1000)}s`);
        // Reject first: abort listeners run synchronously, and an agent that resolves on
        // abort (e.g. with a fallback) must not win the race after the deadline.
        reject(error);
        controller.abort(error);
      }, budgetMs);
    });
    try {
      return await Promise.race([agent.draft(haunt.finding, { signal: controller.signal }), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** ISO time `ms` from now, by the runner's clock. */
  const inMs = (ms: number) => new Date(now().getTime() + ms).toISOString();

  /**
   * Whether a claim has expired, using the deadline the claiming runner stored.
   * Falls back to this runner's own window for a claim without one.
   */
  function claimExpired(haunt: Haunt): boolean {
    const fallbackMs = haunt.status === 'approving' ? settleAfterMs : draftClaimTimeoutMs;
    const deadline = haunt.claimExpiresAt ?? new Date(Date.parse(haunt.updatedAt) + fallbackMs).toISOString();
    return now().getTime() >= Date.parse(deadline);
  }

  /** A live claim another worker (maybe another process) still holds. */
  const liveClaim = (haunt: Haunt) => CLAIMED_STATUSES.includes(haunt.status) && !claimExpired(haunt);

  // Keys with an operation in flight, shared by every runner on the same store object.
  // This only saves wasted work inside one process; versioned writes are what keep
  // separate processes safe.
  const busy = locksFor(store);
  const inFlightRuns = runsFor(store);

  async function load(key: string): Promise<Haunt<P> | null> {
    const haunt = await store.get(key);
    if (!haunt || haunt.detectorId !== detector.id) return null;
    return haunt as Haunt<P>;
  }

  /** Runs `fn` with the key locked, or returns null if the key is already busy. */
  async function withLock<T>(key: string, fn: () => Promise<T>): Promise<{ value: T } | null> {
    if (busy.has(key)) return null;
    busy.add(key);
    try {
      return { value: await fn() };
    } finally {
      busy.delete(key);
    }
  }

  /**
   * Writes `next` as the version after `prev` (or as a new haunt when `prev` is null).
   * Returns the saved haunt, or null if another writer got there first.
   */
  async function write(prev: Haunt<P> | null, next: Haunt<P>): Promise<Haunt<P> | null> {
    const haunt: Haunt<P> = { ...next, version: (prev?.version ?? 0) + 1 };
    const saved = await store.put(haunt as Haunt, prev ? prev.version : null);
    if (!saved) log.info('write conflict, skipped', { detector: detector.id, key: haunt.key });
    return saved ? haunt : null;
  }

  function freshHaunt(finding: Finding<P>, payloadHash: string, at: string, firstSeenAt = at): Haunt<P> {
    return {
      key: finding.key,
      detectorId: detector.id,
      status: 'new',
      version: 0,
      finding,
      payloadHash,
      sparedPayloadHash: null,
      draft: null,
      result: null,
      error: null,
      claimExpiresAt: null,
      firstSeenAt,
      lastSeenAt: at,
      updatedAt: at,
    };
  }

  /**
   * Claims the haunt as `drafting` before calling the agent, so only one process pays
   * for the model call, then stores the outcome. Null means another writer won.
   */
  async function claimAndDraft(haunt: Haunt<P>): Promise<Haunt<P> | null> {
    // The agent's budget counts from before the claim write and ends a margin before
    // the claim expires, so an overrunning call is aborted while the claim is still ours
    // instead of running on after another process has taken it over.
    const agentDeadline = now().getTime() + draftClaimTimeoutMs - draftAbortMarginMs;
    const claimed = await write(haunt, {
      ...haunt,
      status: 'drafting',
      error: null,
      claimExpiresAt: inMs(draftClaimTimeoutMs),
      updatedAt: now().toISOString(),
    });
    if (!claimed) return null;
    let next: Haunt<P>;
    try {
      const parsed = draftSchema.safeParse(await callAgent(claimed, agentDeadline - now().getTime()));
      if (!parsed.success) throw new Error('Agent returned a draft that failed validation');
      next = { ...claimed, status: 'drafted', draft: parsed.data, error: null, claimExpiresAt: null, updatedAt: now().toISOString() };
    } catch (error) {
      log.warn('draft failed', { detector: detector.id, key: haunt.key, error: errorMessage(error) });
      next = {
        ...claimed,
        status: 'draft_failed',
        draft: null,
        error: errorMessage(error),
        claimExpiresAt: null,
        updatedAt: now().toISOString(),
      };
    }
    return write(claimed, next);
  }

  /**
   * Splits a poll into accepted findings and the set of every key the source reported,
   * valid or not. An invalid observation is not evidence that an item disappeared.
   */
  function validate(raw: unknown[]): { findings: Map<string, Finding<P>>; observed: Set<string>; invalid: number } {
    const findings = new Map<string, Finding<P>>();
    const observed = new Set<string>();
    let invalid = 0;
    for (const item of raw) {
      // Trim like findingEnvelopeSchema does, so observed keys match stored keys.
      if (item && typeof item === 'object' && 'key' in item && typeof item.key === 'string' && item.key.trim()) {
        observed.add(item.key.trim());
      }
      const envelope = findingEnvelopeSchema.safeParse(item);
      if (!envelope.success) {
        invalid++;
        log.warn('dropped finding with invalid envelope', {
          detector: detector.id,
          issues: envelope.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
        continue;
      }
      const payload = detector.payloadSchema.safeParse(envelope.data.payload);
      if (!payload.success) {
        invalid++;
        log.warn('dropped finding with invalid payload', {
          detector: detector.id,
          key: envelope.data.key,
          issues: payload.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
        continue;
      }
      // Checked after the schema, since a schema can transform values (e.g. into Dates).
      const nonJson = findNonJson(payload.data);
      if (nonJson) {
        invalid++;
        log.warn('dropped finding with a non-JSON payload', { detector: detector.id, key: envelope.data.key, issue: nonJson });
        continue;
      }
      if (findings.has(envelope.data.key)) {
        invalid++;
        log.warn('dropped finding with duplicate key', { detector: detector.id, key: envelope.data.key });
        continue;
      }
      findings.set(envelope.data.key, { ...envelope.data, payload: payload.data });
    }
    return { findings, observed, invalid };
  }

  async function doRun(): Promise<RunReport> {
    const report: RunReport = {
      ok: true,
      error: null,
      found: 0,
      invalid: 0,
      created: 0,
      reopened: 0,
      resolved: 0,
      drafted: 0,
      draftFailed: 0,
      deferred: 0,
      conflicts: 0,
    };

    // Anything seen at or after this instant was written by a newer poll than ours.
    const pollStartedAt = now().toISOString();

    // 1. Detect. No agent calls happen until poll() has returned (R1.2, R3.1).
    let raw: unknown;
    try {
      const ctx: PollContext = { fetch: fetchImpl, now, signal: AbortSignal.timeout(pollTimeoutMs), log };
      raw = await detector.poll(ctx);
      if (!Array.isArray(raw)) throw new TypeError('poll() must return an array of findings');
    } catch (error) {
      // A failed poll says nothing about what disappeared, so nothing is resolved.
      log.error('poll failed', { detector: detector.id, error: errorMessage(error) });
      return { ...report, ok: false, error: errorMessage(error) };
    }

    const { findings, observed, invalid } = validate(raw);
    report.found = findings.size;
    report.invalid = invalid;

    // 2. Remember: create, reopen or refresh each finding (R2.1, R2.2).
    for (const finding of findings.values()) {
      await withLock(finding.key, async () => {
        const at = now().toISOString();
        const payloadHash = hashPayload(finding.payload);
        const existing = await store.get(finding.key);
        if (!existing) {
          if (await write(null, freshHaunt(finding, payloadHash, at))) report.created++;
          else report.conflicts++;
          return;
        }
        if (existing.detectorId !== detector.id) {
          log.warn('key already used by another detector, skipping', { detector: detector.id, key: finding.key });
          return;
        }
        const current = existing as Haunt<P>;
        // A finished approval comes back as new when the app opts in and the item really
        // changed (e.g. a thread that went stale again after the comment). Never while
        // `approving`: that write would break the claim.
        // An approval that landed after our poll started is newer than what we saw, so a
        // slow poll can't undo it (same rule as resolving, below).
        if (
          reopenApprovedOnChange &&
          current.status === 'approved' &&
          current.payloadHash !== payloadHash &&
          current.updatedAt < pollStartedAt
        ) {
          if (await write(current, freshHaunt(finding, payloadHash, at, current.firstSeenAt))) report.reopened++;
          else report.conflicts++;
          return;
        }
        // Never rewrite an approval (claimed or done) or a draft claim someone still holds:
        // bumping the version would make their final write fail.
        if (current.status === 'approving' || current.status === 'approved' || liveClaim(current)) return;

        const refreshed: Haunt<P> = { ...current, finding, payloadHash, lastSeenAt: at };
        let next = refreshed;
        let reopened = false;
        if (current.status === 'drafting') {
          // An abandoned draft claim: release it with the latest observation, so the
          // takeover drafts from the current payload, not the one the dead worker had.
          next = { ...refreshed, status: 'new', claimExpiresAt: null, error: null, updatedAt: at };
        } else if (DRAFT_HOLDING.includes(current.status) && current.payloadHash !== payloadHash && current.updatedAt < pollStartedAt) {
          // A draft answers the payload it was written for. When the item changed, drop it
          // and draft again, so nobody approves a proposal about an outdated item. A draft
          // or error written after our poll started is newer than our observation.
          next = { ...refreshed, status: 'new', draft: null, result: null, error: null, updatedAt: at };
        } else if (current.status === 'spared' || current.status === 'resolved') {
          // A rejection sticks until the payload changes, even across a disappear/return (R4.3).
          if (current.sparedPayloadHash !== null && current.sparedPayloadHash === payloadHash) {
            next = current.status === 'resolved' ? { ...refreshed, status: 'spared', updatedAt: at } : refreshed;
          } else {
            next = freshHaunt(finding, payloadHash, at, current.firstSeenAt);
            reopened = true;
          }
        }
        const saved = await write(current, next);
        if (!saved) report.conflicts++;
        else if (reopened) report.reopened++;
      });
    }

    // 3. Resolve live haunts the source no longer reports at all (R2.3). A draft claim
    //    still held elsewhere is left alone; an abandoned one resolves like any open haunt.
    const resolvable = (h: Haunt) =>
      RESOLVABLE_STATUSES.includes(h.status) || (h.status === 'drafting' && claimExpired(h));
    for (const haunt of await store.list({ detectorId: detector.id, status: [...RESOLVABLE_STATUSES, 'drafting'] })) {
      if (observed.has(haunt.key) || !resolvable(haunt)) continue;
      await withLock(haunt.key, async () => {
        const current = await load(haunt.key);
        if (!current || !resolvable(current)) return;
        // Our snapshot is too old to say the item disappeared if anything touched the haunt
        // after our poll started: a newer poll saw it, or a draft, spare or settle landed
        // (a poll that sees a live draft claim can't record lastSeenAt without breaking
        // the claim). The next run will resolve it if it's really gone.
        if (current.lastSeenAt >= pollStartedAt || current.updatedAt >= pollStartedAt) return;
        const resolved: Haunt<P> = { ...current, status: 'resolved', claimExpiresAt: null, updatedAt: now().toISOString() };
        if (await write(current, resolved)) report.resolved++;
        else report.conflicts++;
      });
    }

    // 4. Hand off: draft new haunts (including released abandoned claims), oldest first,
    //    up to the cap (R3.1, R3.4).
    const pending = await store.list({ detectorId: detector.id, status: ['new'] });
    report.deferred = Math.max(0, pending.length - maxDrafts);
    for (const haunt of pending.slice(0, maxDrafts)) {
      await withLock(haunt.key, async () => {
        const current = await load(haunt.key);
        if (!current || current.status !== 'new') return;
        const drafted = await claimAndDraft(current);
        if (!drafted) report.conflicts++;
        else if (drafted.status === 'drafted') report.drafted++;
        else report.draftFailed++;
      });
    }

    log.info('run complete', { detector: detector.id, ...report });
    return report;
  }

  function fail(reason: FailureReason, message: string, haunt: Haunt<P> | null = null): OperationResult<P> {
    return { ok: false, reason, message, haunt };
  }

  const CONFLICT_MESSAGE = 'This haunt changed somewhere else. Reload and try again.';

  /** Locks the key, loads the haunt and checks its status before running `fn`. */
  async function operate(
    key: string,
    allowed: readonly HauntStatus[],
    fn: (haunt: Haunt<P>) => Promise<OperationResult<P>>,
  ): Promise<OperationResult<P>> {
    const outcome = await withLock(key, async () => {
      const haunt = await load(key);
      if (!haunt) return fail('not_found', `No haunt with key ${key}`);
      if (!allowed.includes(haunt.status)) {
        return fail('not_allowed', `Haunt is ${haunt.status}; expected ${allowed.join(' or ')}`, haunt);
      }
      return fn(haunt);
    });
    return outcome ? outcome.value : fail('in_progress', 'Another operation on this haunt is in progress');
  }

  function applyEdits(draft: Draft, edits: DraftEdits): unknown {
    const options = { ...draft.options };
    for (const [name, value] of Object.entries(edits.options ?? {})) {
      // Own properties only: `in` would accept inherited names like "toString".
      if (Object.hasOwn(options, name)) options[name] = value;
    }
    return { ...draft, proposal: edits.proposal ?? draft.proposal, options };
  }

  type Attempt = { timedOut: false; result: ActionResult } | { timedOut: true };

  /**
   * Runs the action with an abort signal and a hard timeout. A timeout is reported
   * separately from a failure: the action may still have taken effect.
   */
  async function runAction(haunt: Haunt<P>, draft: Draft, budgetMs: number): Promise<Attempt> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<Attempt>((resolve) => {
      timer = setTimeout(() => {
        // Settle first, for the same reason as callAgent: an action that resolves on abort
        // must not be recorded as a clean result after the deadline.
        resolve({ timedOut: true });
        controller.abort(new Error('Action timed out'));
      }, budgetMs);
    });
    const attempt = (async (): Promise<Attempt> => {
      try {
        const result = await action.run(haunt.finding, draft, { signal: controller.signal });
        if (result && typeof result === 'object' && 'ok' in result) return { timedOut: false, result };
        return { timedOut: false, result: { ok: false, error: 'Action returned an invalid result' } };
      } catch (error) {
        if (controller.signal.aborted) return { timedOut: true };
        return { timedOut: false, result: { ok: false, error: errorMessage(error) } };
      }
    })();
    try {
      return await Promise.race([attempt, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    run() {
      const existing = inFlightRuns.get(detector.id);
      if (existing) return existing;
      const started: Promise<RunReport> = doRun().finally(() => {
        if (inFlightRuns.get(detector.id) === started) inFlightRuns.delete(detector.id);
      });
      inFlightRuns.set(detector.id, started);
      return started;
    },

    approve(key, edits = {}) {
      return operate(key, APPROVABLE, async (haunt) => {
        if (!haunt.draft) return fail('not_allowed', 'Haunt has no draft to approve', haunt);
        // The claim below is a compare-and-set on this loaded version, so this check holds
        // up to the moment of the claim.
        if (edits.expectedVersion !== undefined && haunt.version !== edits.expectedVersion) {
          return fail('conflict', CONFLICT_MESSAGE, haunt);
        }
        const parsed = draftSchema.safeParse(applyEdits(haunt.draft, edits));
        if (!parsed.success) return fail('invalid_draft', 'Edited draft failed validation', haunt);

        // 1. Claim. Only one writer can move this version to `approving`, so only one
        //    process ever reaches the action. If we die after this, the haunt stays
        //    `approving` and the user settles it instead of re-approving it.
        //    The deadline is stored with the claim, so a runner with a shorter window can't
        //    settle it early while our action is still allowed to run.
        //    The action's own deadline counts from before the claim write, so a slow
        //    acknowledgement eats into its budget and it always ends before claimExpiresAt.
        const actionDeadline = now().getTime() + actionTimeoutMs;
        const claimed = await write(haunt, {
          ...haunt,
          status: 'approving',
          draft: parsed.data,
          error: null,
          claimExpiresAt: inMs(settleAfterMs),
          updatedAt: now().toISOString(),
        });
        if (!claimed) return fail('conflict', CONFLICT_MESSAGE, haunt);

        // 2. Act, within whatever budget the claim left us.
        const budgetMs = actionDeadline - now().getTime();
        if (budgetMs <= 0) {
          // The action never started, so hand the haunt back unless someone else already
          // has (e.g. settled it after our deadline).
          log.warn('claim acknowledged too late; action not started', { detector: detector.id, key, action: action.id });
          const released = await write(claimed, {
            ...claimed,
            status: haunt.status,
            draft: haunt.draft,
            result: haunt.result,
            error: haunt.error,
            claimExpiresAt: null,
            updatedAt: now().toISOString(),
          }).catch(() => null);
          return fail('not_started', 'Claiming this haunt took too long, so the action was not started. Nothing was done; try again.', released ?? claimed);
        }
        const attempt = await runAction(claimed, parsed.data, budgetMs);
        if (attempt.timedOut) {
          log.error('action timed out; haunt left approving', { detector: detector.id, key, action: action.id, actionTimeoutMs });
          return fail(
            'outcome_unknown',
            "The action didn't finish in time and may or may not have run. Check the source, then settle this haunt.",
            claimed,
          );
        }
        const { result } = attempt;

        // 3. Record. Nothing else writes an `approving` haunt except settle(), which waits
        //    out settleAfterMs, so a failure here means the store is unavailable.
        const at = now().toISOString();
        const next: Haunt<P> = result.ok
          ? { ...claimed, status: 'approved', result, error: null, claimExpiresAt: null, updatedAt: at }
          : { ...claimed, status: 'action_failed', result, error: result.error, claimExpiresAt: null, updatedAt: at };
        let saved: Haunt<P> | null = null;
        let saveError: string | null = null;
        try {
          saved = await write(claimed, next);
        } catch (error) {
          saveError = errorMessage(error);
        }
        if (!saved) {
          log.error('action outcome not saved; haunt left approving', {
            detector: detector.id,
            key,
            action: action.id,
            actionOk: result.ok,
            error: saveError ?? 'write conflict',
          });
          return fail(
            'outcome_unknown',
            result.ok
              ? 'The action ran, but its result could not be saved. Check the source, then settle this haunt.'
              : 'The action failed, and that result could not be saved. Check the source, then settle this haunt.',
            claimed,
          );
        }

        if (result.ok) {
          log.info('action ran', { detector: detector.id, key, action: action.id });
          return { ok: true, haunt: saved };
        }
        log.warn('action failed', { detector: detector.id, key, action: action.id, error: result.error });
        return fail('action_failed', result.error, saved);
      });
    },

    async spare(key) {
      // No per-key lock: a run or redraft holds it for the whole agent call, and the user
      // must be able to spare a draft in flight. The versioned write is enough, and the
      // late draft's own write then conflicts and is dropped.
      const haunt = await load(key);
      if (!haunt) return fail('not_found', `No haunt with key ${key}`);
      if (!SPARABLE.includes(haunt.status)) {
        return fail('not_allowed', `Haunt is ${haunt.status}; expected ${SPARABLE.join(' or ')}`, haunt);
      }
      const saved = await write(haunt, {
        ...haunt,
        status: 'spared',
        sparedPayloadHash: haunt.payloadHash,
        error: null,
        claimExpiresAt: null,
        updatedAt: now().toISOString(),
      });
      return saved ? { ok: true, haunt: saved } : fail('conflict', CONFLICT_MESSAGE, haunt);
    },

    redraft(key) {
      return operate(key, REDRAFTABLE, async (haunt) => {
        const drafted = await claimAndDraft(haunt);
        if (!drafted) return fail('conflict', CONFLICT_MESSAGE, haunt);
        return drafted.status === 'drafted'
          ? { ok: true, haunt: drafted }
          : fail('invalid_draft', drafted.error ?? 'Draft failed', drafted);
      });
    },

    settle(key, outcome) {
      return operate(key, ['approving'], async (haunt) => {
        // The original attempt (maybe in another process) is only guaranteed to have
        // stopped once the deadline its claimer stored has passed. That deadline is the
        // claimer's settleAfterMs, which is longer than its action timeout.
        if (!claimExpired(haunt)) {
          const after = haunt.claimExpiresAt ?? new Date(Date.parse(haunt.updatedAt) + settleAfterMs).toISOString();
          return fail('not_allowed', `This approval may still be running. You can settle it after ${after}.`, haunt);
        }
        const at = now().toISOString();
        const next: Haunt<P> =
          outcome === 'done'
            ? {
                ...haunt,
                status: 'approved',
                result: { ok: true, message: 'Confirmed at the source by the user', url: null },
                error: null,
                claimExpiresAt: null,
                updatedAt: at,
              }
            : { ...haunt, status: 'drafted', result: null, error: null, claimExpiresAt: null, updatedAt: at };
        const saved = await write(haunt, next);
        return saved ? { ok: true, haunt: saved } : fail('conflict', CONFLICT_MESSAGE, haunt);
      });
    },

    async list(status) {
      const haunts = await store.list(status ? { detectorId: detector.id, status } : { detectorId: detector.id });
      return haunts as Haunt<P>[];
    },
  };
}
