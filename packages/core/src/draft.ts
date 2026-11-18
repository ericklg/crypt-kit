import { z } from 'zod';
import type { Finding } from './finding.js';

/** The agent's proposed action for one finding. `proposal` is what the user can edit. */
export const draftSchema = z.object({
  summary: z.string().trim().min(1).max(500),
  proposal: z.string().trim().min(1).max(5000),
  reasoning: z.string().trim().max(2000),
  /** App-specific toggles the user can flip before approving, e.g. `{ close: true }`. */
  options: z.record(z.string(), z.boolean()).default({}),
});

export type Draft = z.infer<typeof draftSchema>;

export interface AgentContext {
  /**
   * Aborts when the runner's draft claim is about to expire. Forward it to the model
   * call (e.g. `generateText({ abortSignal })`), so an overrunning draft stops before
   * another process takes the claim over and pays for a second call.
   */
  signal: AbortSignal;
}

/** Drafts an action for a single finding. Called only after detection, once per new finding. */
export interface Agent<P> {
  draft(finding: Finding<P>, ctx: AgentContext): Promise<unknown>;
}
