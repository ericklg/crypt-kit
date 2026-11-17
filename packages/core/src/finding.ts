import { z } from 'zod';

export const severitySchema = z.enum(['low', 'medium', 'high']);
export type Severity = z.infer<typeof severitySchema>;

/** One detected item. `key` must be stable across runs for the same real-world item. */
export interface Finding<P> {
  key: string;
  kind: string;
  severity: Severity;
  title: string;
  /** Link to the item at its source, when there is one. */
  url: string | null;
  payload: P;
  /** ISO 8601 timestamp of when the detector saw the item. */
  observedAt: string;
}

/** Validates everything about a finding except its payload, which the detector's own schema checks. */
export const findingEnvelopeSchema = z.object({
  key: z.string().trim().min(1).max(512),
  kind: z.string().trim().min(1).max(64),
  severity: severitySchema,
  title: z.string().trim().min(1).max(300),
  url: z.url().nullable(),
  payload: z.unknown(),
  observedAt: z.iso.datetime(),
});
