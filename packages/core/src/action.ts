import type { Draft } from './draft.js';
import type { Finding } from './finding.js';

export type ActionResult =
  | { ok: true; message: string; url: string | null }
  | { ok: false; error: string };

/** The side effect an approved draft performs. The runner calls it at most once per approval. */
export interface Action<P> {
  id: string;
  run(finding: Finding<P>, draft: Draft): Promise<ActionResult>;
}
