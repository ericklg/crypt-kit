import type { Draft } from './draft.js';
import type { Finding } from './finding.js';

export type ActionResult =
  | { ok: true; message: string; url: string | null }
  | { ok: false; error: string };

export interface ActionContext {
  /**
   * Aborts when the runner's action timeout passes. Forward it to every request
   * (e.g. `fetch(url, { signal })`), so a timed-out action stops instead of landing late.
   */
  signal: AbortSignal;
}

/** The side effect an approved draft performs. The runner calls it at most once per approval. */
export interface Action<P> {
  id: string;
  run(finding: Finding<P>, draft: Draft, ctx: ActionContext): Promise<ActionResult>;
}
