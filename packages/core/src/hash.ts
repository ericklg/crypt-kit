import { createHash } from 'node:crypto';

/** JSON with object keys sorted, so equal values always serialize the same way. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.fromEntries(
        Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    }
    return val;
  });
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload) ?? 'undefined').digest('hex');
}
