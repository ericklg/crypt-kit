import type { z } from 'zod';
import type { Finding } from './finding.js';
import type { Logger } from './logger.js';

/**
 * Everything a detector may use for I/O. Detectors must not reach for globals
 * (fetch, Date.now, model SDKs), so tests can run them against recorded fixtures.
 */
export interface PollContext {
  fetch: typeof globalThis.fetch;
  now(): Date;
  signal: AbortSignal;
  log: Logger;
}

/**
 * Turns source data into findings. `poll` must be deterministic and must never
 * call an AI model, directly or indirectly. See .kiro/steering/detector-contract.md.
 */
export interface Detector<P> {
  id: string;
  payloadSchema: z.ZodType<P>;
  /** Throw if the source can't be read. Never return a partial list as if it were complete. */
  poll(ctx: PollContext): Promise<Finding<P>[]>;
}
