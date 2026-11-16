import type { Detector, PollContext } from './detector.js';
import { findingEnvelopeSchema, type Finding } from './finding.js';
import { silentLogger } from './logger.js';

/** A recorded response. `match` is an exact URL or a RegExp tested against the full URL. */
export interface FixtureRoute {
  match: string | RegExp;
  method?: string;
  status?: number;
  headers?: Record<string, string>;
  body: unknown;
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
    const body = typeof route.body === 'string' ? route.body : JSON.stringify(route.body);
    const headers = { 'content-type': 'application/json', ...route.headers };
    return new Response(body, { status: route.status ?? 200, headers });
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
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      throw new Error(`Detector used global fetch (${url}); use ctx.fetch instead`);
    };
    try {
      const result = await detector.poll(ctx);
      if (!Array.isArray(result)) throw new Error('poll() did not return an array');
      return result;
    } finally {
      globalThis.fetch = realFetch;
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

  const findings: Finding<P>[] = [];
  const keys = new Set<string>();
  first.forEach((item, index) => {
    const envelope = findingEnvelopeSchema.safeParse(item);
    if (!envelope.success) {
      problems.push(`finding[${index}] envelope: ${envelope.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      return;
    }
    const payload = detector.payloadSchema.safeParse(envelope.data.payload);
    if (!payload.success) {
      problems.push(`finding[${index}] (${envelope.data.key}) payload: ${payload.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      return;
    }
    if (keys.has(envelope.data.key)) problems.push(`duplicate key ${envelope.data.key}`);
    keys.add(envelope.data.key);
    findings.push({ ...envelope.data, payload: payload.data });
  });

  const secondKeys = new Set(
    second.map((item) => (item && typeof item === 'object' && 'key' in item ? String(item.key) : '')),
  );
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
