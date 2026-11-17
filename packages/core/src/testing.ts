import type { Detector, PollContext } from './detector.js';
import { findingEnvelopeSchema, type Finding } from './finding.js';
import type { Haunt } from './haunt.js';
import { silentLogger } from './logger.js';
import type { TrackerStore } from './tracker.js';

/** A recorded response. `match` is an exact URL or a RegExp tested against the full URL. */
export interface FixtureRoute {
  match: string | RegExp;
  method?: string;
  status?: number;
  headers?: Record<string, string>;
  body: unknown;
}

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

// Global fetch is swapped for a throwing stub while any contract poll is active.
// A depth counter keeps overlapping checks (e.g. it.concurrent) from restoring it early.
let stubDepth = 0;
let realFetch: typeof globalThis.fetch | undefined;

const forbiddenFetch: typeof globalThis.fetch = async (input) => {
  const url = input instanceof Request ? input.url : String(input);
  throw new Error(`Detector used global fetch (${url}); use ctx.fetch instead`);
};

function blockGlobalFetch(): void {
  if (stubDepth++ === 0) {
    realFetch = globalThis.fetch;
    globalThis.fetch = forbiddenFetch;
  }
}

function restoreGlobalFetch(): void {
  if (--stubDepth === 0) {
    if (realFetch) globalThis.fetch = realFetch;
    realFetch = undefined;
  }
}

export interface RecordedCall {
  method: string;
  url: string;
}

/** A fetch that only serves recorded fixtures and throws on anything else. */
export function fixtureFetch(routes: readonly FixtureRoute[]): {
  fetch: typeof globalThis.fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const call = { method: request.method.toUpperCase(), url: request.url };
    calls.push(call);
    const route = routes.find(
      (r) =>
        (r.method ?? 'GET').toUpperCase() === call.method &&
        (typeof r.match === 'string' ? r.match === call.url : r.match.test(call.url)),
    );
    if (!route) throw new Error(`Unrecorded request in detector test: ${call.method} ${call.url}`);
    const status = route.status ?? 200;
    // Response forbids a body for these statuses, so fixtures for them can't carry one.
    if (NULL_BODY_STATUSES.has(status) || route.body === null || route.body === undefined) {
      return new Response(null, { status, headers: { ...route.headers } });
    }
    const body = typeof route.body === 'string' ? route.body : JSON.stringify(route.body);
    const headers = { 'content-type': 'application/json', ...route.headers };
    return new Response(body, { status, headers });
  };
  return { fetch, calls };
}

export interface ContractOptions {
  routes: readonly FixtureRoute[];
  /** Fixed clock for the polls. Defaults to 2026-11-01T00:00:00Z. */
  now?: Date;
  /** Fail if the detector returns no findings. Default true, so fixtures exercise real paths. */
  requireFindings?: boolean;
}

export interface ContractReport<P> {
  findings: Finding<P>[];
  calls: RecordedCall[];
}

export class DetectorContractError extends Error {
  constructor(
    readonly detectorId: string,
    readonly problems: string[],
  ) {
    super(`Detector "${detectorId}" broke its contract:\n- ${problems.join('\n- ')}`);
    this.name = 'DetectorContractError';
  }
}

/**
 * Polls the detector twice against fixtures and checks the contract:
 * valid envelopes and payloads, unique non-empty keys, the same keys on both
 * polls, and no network access beyond the recorded fixtures (so no model calls).
 * Throws DetectorContractError listing every problem found.
 */
export async function assertDetectorContract<P>(
  detector: Detector<P>,
  options: ContractOptions,
): Promise<ContractReport<P>> {
  const problems: string[] = [];
  const clock = options.now ?? new Date('2026-11-01T00:00:00Z');
  const { fetch, calls } = fixtureFetch(options.routes);

  const pollOnce = async (): Promise<unknown[]> => {
    const ctx: PollContext = { fetch, now: () => new Date(clock), signal: new AbortController().signal, log: silentLogger };
    blockGlobalFetch();
    try {
      const result = await detector.poll(ctx);
      if (!Array.isArray(result)) throw new Error('poll() did not return an array');
      return result;
    } finally {
      restoreGlobalFetch();
    }
  };

  let first: unknown[] = [];
  let second: unknown[] = [];
  try {
    first = await pollOnce();
    second = await pollOnce();
  } catch (error) {
    problems.push(`poll() threw: ${error instanceof Error ? error.message : String(error)}`);
    throw new DetectorContractError(detector.id, problems);
  }

  /** Validates one poll's output; both polls must pass on their own. */
  const check = (items: unknown[], label: string): { findings: Finding<P>[]; keys: Set<string> } => {
    const findings: Finding<P>[] = [];
    const keys = new Set<string>();
    items.forEach((item, index) => {
      const envelope = findingEnvelopeSchema.safeParse(item);
      if (!envelope.success) {
        problems.push(`${label} finding[${index}] envelope: ${envelope.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
        return;
      }
      const payload = detector.payloadSchema.safeParse(envelope.data.payload);
      if (!payload.success) {
        problems.push(`${label} finding[${index}] (${envelope.data.key}) payload: ${payload.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
        return;
      }
      if (keys.has(envelope.data.key)) problems.push(`${label} duplicate key ${envelope.data.key}`);
      keys.add(envelope.data.key);
      findings.push({ ...envelope.data, payload: payload.data });
    });
    return { findings, keys };
  };

  const { findings, keys } = check(first, 'poll 1');
  const { keys: secondKeys } = check(second, 'poll 2');
  const unstable = [...keys].filter((k) => !secondKeys.has(k));
  const extra = [...secondKeys].filter((k) => !keys.has(k));
  if (unstable.length || extra.length) {
    problems.push(`keys changed between identical polls (missing: ${unstable.join(', ') || 'none'}; new: ${extra.join(', ') || 'none'})`);
  }

  if ((options.requireFindings ?? true) && first.length === 0) {
    problems.push('poll() returned no findings; record fixtures that produce at least one');
  }

  if (problems.length) throw new DetectorContractError(detector.id, problems);
  return { findings, calls };
}

/** A minimal valid haunt for store tests. Override any field. */
export function sampleHaunt(overrides: Partial<Haunt> = {}): Haunt {
  const key = overrides.key ?? 'sample#1';
  return {
    key,
    detectorId: 'sample',
    status: 'new',
    version: 1,
    finding: {
      key,
      kind: 'sample',
      severity: 'low',
      title: `Sample ${key}`,
      url: null,
      payload: { n: 1, nested: { ok: true } },
      observedAt: '2026-11-01T00:00:00.000Z',
    },
    payloadHash: 'hash',
    sparedPayloadHash: null,
    draft: null,
    result: null,
    error: null,
    claimExpiresAt: null,
    firstSeenAt: '2026-11-01T00:00:00.000Z',
    lastSeenAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

export class TrackerStoreContractError extends Error {
  constructor(readonly problems: string[]) {
    super(`TrackerStore broke its contract:\n- ${problems.join('\n- ')}`);
    this.name = 'TrackerStoreContractError';
  }
}

/**
 * Runs every TrackerStore guarantee the runner relies on against fresh, empty stores
 * from `makeStore`: round-trips, insert-if-absent, compare-and-set on version, version
 * checks, filtering, ordering, copy-on-read and one winner under concurrent writes.
 * Throws TrackerStoreContractError listing every problem found.
 */
export async function assertTrackerStoreContract(makeStore: () => Promise<TrackerStore>): Promise<void> {
  const problems: string[] = [];
  const expect = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  {
    const store = await makeStore();
    expect((await store.get('missing')) === null, 'get() of a missing key must return null');

    const haunt = sampleHaunt({ draft: { summary: 's', proposal: 'p', reasoning: 'r', options: { close: true } } });
    expect((await store.put(haunt, null)) === true, 'put(haunt, null) must insert a new key');
    expect(same(await store.get(haunt.key), haunt), 'get() must return exactly what was stored');
    expect((await store.put(sampleHaunt({ error: 'other writer' }), null)) === false, 'put(haunt, null) must not overwrite an existing key');
    expect((await store.get(haunt.key))?.error === null, 'a rejected insert must leave the stored haunt unchanged');

    const v2 = { ...haunt, version: 2, status: 'drafted' as const };
    expect((await store.put(v2, 1)) === true, 'put(haunt, 1) must update a haunt stored at version 1');
    expect((await store.put({ ...v2, status: 'spared' }, 1)) === false, 'put() with a stale expected version must fail');
    expect((await store.get(haunt.key))?.status === 'drafted', 'a failed put() must leave the stored haunt unchanged');
    expect((await store.put(sampleHaunt({ key: 'absent', version: 2 }), 1)) === false, 'put() expecting a version must fail when the key is absent');

    let threw = false;
    try {
      await store.put({ ...v2, version: 5 }, 2);
    } catch {
      threw = true;
    }
    expect(threw, 'put() must throw when haunt.version is not expectedVersion + 1');

    const copy = await store.get(haunt.key);
    if (copy) copy.finding.title = 'mutated';
    expect((await store.get(haunt.key))?.finding.title === haunt.finding.title, 'get() must return a copy, not shared state');
  }

  {
    const store = await makeStore();
    const rows = [
      sampleHaunt({ key: 'b', detectorId: 'one', status: 'new', firstSeenAt: '2026-11-02T00:00:00.000Z' }),
      sampleHaunt({ key: 'a', detectorId: 'one', status: 'drafted', firstSeenAt: '2026-11-02T00:00:00.000Z' }),
      sampleHaunt({ key: 'c', detectorId: 'one', status: 'spared', firstSeenAt: '2026-11-01T00:00:00.000Z' }),
      sampleHaunt({ key: 'd', detectorId: 'two', status: 'new', firstSeenAt: '2026-10-01T00:00:00.000Z' }),
    ];
    for (const row of rows) await store.put(row, null);

    const keys = async (filter?: Parameters<TrackerStore['list']>[0]) => (await store.list(filter)).map((h) => h.key).join(',');
    expect((await keys()) === 'd,c,a,b', `list() must order by firstSeenAt then key (got ${await keys()})`);
    expect((await keys({ detectorId: 'one' })) === 'c,a,b', 'list() must filter by detectorId');
    expect((await keys({ detectorId: 'one', status: ['new', 'spared'] })) === 'c,b', 'list() must filter by status');
    expect((await keys({ status: [] })) === '', 'list() with an empty status list must return nothing');
  }

  {
    // JS compares UTF-16 code units; UTF-8 byte order (e.g. SQLite BINARY) puts these the other way round.
    const store = await makeStore();
    const at = '2026-11-03T00:00:00.000Z';
    for (const key of ['\u{10000}', '\uE000', 'z']) await store.put(sampleHaunt({ key, firstSeenAt: at }), null);
    const order = (await store.list()).map((h) => h.key);
    const want = ['z', '\u{10000}', '\uE000'];
    expect(same(order, want), `list() must order keys by JS string comparison (UTF-16), got ${JSON.stringify(order)}`);
  }

  {
    const store = await makeStore();
    await store.put(sampleHaunt(), null);
    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, i) => store.put(sampleHaunt({ version: 2, error: `writer ${i}` }), 1)),
    );
    expect(attempts.filter(Boolean).length === 1, `exactly one concurrent put() on the same version may win (got ${attempts.filter(Boolean).length})`);

    const inserts = await Promise.all(Array.from({ length: 8 }, () => store.put(sampleHaunt({ key: 'race' }), null)));
    expect(inserts.filter(Boolean).length === 1, 'exactly one concurrent insert of the same key may win');
  }

  if (problems.length) throw new TrackerStoreContractError(problems);
}
