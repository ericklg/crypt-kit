import type { Action, ActionResult } from './action.js';
import type { Detector, PollContext } from './detector.js';
import { draftSchema, type Agent, type Draft } from './draft.js';
import { findingEnvelopeSchema, type Finding } from './finding.js';
import { hashPayload } from './hash.js';
import { OPEN_STATUSES, RESOLVABLE_STATUSES, type Haunt, type HauntStatus } from './haunt.js';
import { consoleLogger, errorMessage, type Logger } from './logger.js';
import type { TrackerStore } from './tracker.js';

export const DEFAULT_MAX_DRAFTS_PER_RUN = 20;
export const DEFAULT_POLL_TIMEOUT_MS = 30_000;

export interface RunnerOptions<P> {
  detector: Detector<P>;
  agent: Agent<P>;
  action: Action<P>;
  store: TrackerStore;
  /** Cap on agent calls per run (R3.4). Findings over the cap are drafted on the next run. */
  maxDraftsPerRun?: number;
  pollTimeoutMs?: number;
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
}

export type FailureReason = 'not_found' | 'not_allowed' | 'in_progress' | 'invalid_draft' | 'action_failed';

export type OperationResult<P> =
  | { ok: true; haunt: Haunt<P> }
  | { ok: false; reason: FailureReason; message: string; haunt: Haunt<P> | null };

export interface DraftEdits {
  proposal?: string;
  /** Only keys already present in the draft's options can be changed. */
  options?: Record<string, boolean>;
}

export interface Runner<P> {
  /** Poll, dedupe, resolve and draft. Concurrent calls share one run. */
  run(): Promise<RunReport>;
  /** Run the action once for a drafted haunt. The only path to a side effect (R4.1). */
  approve(key: string, edits?: DraftEdits): Promise<OperationResult<P>>;
  /** Reject a haunt. It is re-drafted only if its payload changes (R4.3). */
  spare(key: string): Promise<OperationResult<P>>;
  /** Ask the agent again for a failed or unwanted draft. */
  redraft(key: string): Promise<OperationResult<P>>;
  list(status?: readonly HauntStatus[]): Promise<Haunt<P>[]>;
}

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

export function createRunner<P>(options: RunnerOptions<P>): Runner<P> {
  const { detector, agent, action, store } = options;
  const maxDrafts = options.maxDraftsPerRun ?? DEFAULT_MAX_DRAFTS_PER_RUN;
  const pollTimeoutMs = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? consoleLogger;

  if (!Number.isInteger(maxDrafts) || maxDrafts < 0) {
    throw new RangeError('maxDraftsPerRun must be a non-negative integer');
  }

  // Keys with an operation in flight, shared by every runner on the same store, so
  // per-request runners (e.g. in route handlers) can't approve one haunt twice.
  // Cross-process locking is the store's job (see store adapters).
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

  async function save(haunt: Haunt<P>): Promise<Haunt<P>> {
    await store.upsert(haunt as Haunt);
    return haunt;
  }

  function freshHaunt(finding: Finding<P>, payloadHash: string, at: string, firstSeenAt = at): Haunt<P> {
    return {
      key: finding.key,
      detectorId: detector.id,
      status: 'new',
      finding,
      payloadHash,
      sparedPayloadHash: null,
      draft: null,
      result: null,
      error: null,
      firstSeenAt,
      lastSeenAt: at,
      updatedAt: at,
    };
  }

  /** Calls the agent for one haunt and stores the outcome. Caller must hold the lock. */
  async function draftLocked(haunt: Haunt<P>): Promise<Haunt<P>> {
    const at = now().toISOString();
    try {
      const parsed = draftSchema.safeParse(await agent.draft(haunt.finding));
      if (!parsed.success) throw new Error('Agent returned a draft that failed validation');
      return await save({ ...haunt, status: 'drafted', draft: parsed.data, error: null, updatedAt: at });
    } catch (error) {
      log.warn('draft failed', { detector: detector.id, key: haunt.key, error: errorMessage(error) });
      return await save({ ...haunt, status: 'draft_failed', draft: null, error: errorMessage(error), updatedAt: at });
    }
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
          await save(freshHaunt(finding, payloadHash, at));
          report.created++;
          return;
        }
        if (existing.detectorId !== detector.id) {
          log.warn('key already used by another detector, skipping', { detector: detector.id, key: finding.key });
          return;
        }
        const current = existing as Haunt<P>;
        const refreshed = { ...current, finding, payloadHash, lastSeenAt: at };

        if (current.status === 'spared' || current.status === 'resolved') {
          // A rejection sticks until the payload changes, even across a disappear/return (R4.3).
          if (current.sparedPayloadHash !== null && current.sparedPayloadHash === payloadHash) {
            await save(current.status === 'resolved' ? { ...refreshed, status: 'spared', updatedAt: at } : refreshed);
            return;
          }
          await save(freshHaunt(finding, payloadHash, at, current.firstSeenAt));
          report.reopened++;
          return;
        }
        await save(refreshed);
      });
    }

    // 3. Resolve live haunts the source no longer reports at all (R2.3).
    for (const haunt of await store.list({ detectorId: detector.id, status: RESOLVABLE_STATUSES })) {
      if (observed.has(haunt.key)) continue;
      await withLock(haunt.key, async () => {
        const current = await load(haunt.key);
        if (!current || !RESOLVABLE_STATUSES.includes(current.status)) return;
        // A newer poll (another runner or process) saw this item after ours started,
        // so our snapshot is too old to say it disappeared.
        if (current.lastSeenAt >= pollStartedAt) return;
        await save({ ...current, status: 'resolved', updatedAt: now().toISOString() });
        report.resolved++;
      });
    }

    // 4. Hand off: draft new haunts, oldest first, up to the cap (R3.1, R3.4).
    const pending = await store.list({ detectorId: detector.id, status: ['new'] });
    report.deferred = Math.max(0, pending.length - maxDrafts);
    for (const haunt of pending.slice(0, maxDrafts)) {
      await withLock(haunt.key, async () => {
        const current = await load(haunt.key);
        if (!current || current.status !== 'new') return;
        const drafted = await draftLocked(current);
        if (drafted.status === 'drafted') report.drafted++;
        else report.draftFailed++;
      });
    }

    log.info('run complete', { detector: detector.id, ...report });
    return report;
  }

  function fail(reason: FailureReason, message: string, haunt: Haunt<P> | null = null): OperationResult<P> {
    return { ok: false, reason, message, haunt };
  }

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

  async function runAction(haunt: Haunt<P>, draft: Draft): Promise<ActionResult> {
    try {
      const result = await action.run(haunt.finding, draft);
      if (result && typeof result === 'object' && 'ok' in result) return result;
      return { ok: false, error: 'Action returned an invalid result' };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
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
        const parsed = draftSchema.safeParse(applyEdits(haunt.draft, edits));
        if (!parsed.success) return fail('invalid_draft', 'Edited draft failed validation', haunt);

        const result = await runAction(haunt, parsed.data);
        const at = now().toISOString();
        if (result.ok) {
          const saved = await save({ ...haunt, status: 'approved', draft: parsed.data, result, error: null, updatedAt: at });
          log.info('action ran', { detector: detector.id, key, action: action.id });
          return { ok: true, haunt: saved };
        }
        const saved = await save({ ...haunt, status: 'action_failed', draft: parsed.data, result, error: result.error, updatedAt: at });
        log.warn('action failed', { detector: detector.id, key, action: action.id, error: result.error });
        return fail('action_failed', result.error, saved);
      });
    },

    spare(key) {
      return operate(key, OPEN_STATUSES, async (haunt) => ({
        ok: true,
        haunt: await save({
          ...haunt,
          status: 'spared',
          sparedPayloadHash: haunt.payloadHash,
          error: null,
          updatedAt: now().toISOString(),
        }),
      }));
    },

    redraft(key) {
      return operate(key, REDRAFTABLE, async (haunt) => {
        const drafted = await draftLocked(haunt);
        return drafted.status === 'drafted'
          ? { ok: true, haunt: drafted }
          : fail('invalid_draft', drafted.error ?? 'Draft failed', drafted);
      });
    },

    async list(status) {
      const haunts = await store.list(status ? { detectorId: detector.id, status } : { detectorId: detector.id });
      return haunts as Haunt<P>[];
    },
  };
}
