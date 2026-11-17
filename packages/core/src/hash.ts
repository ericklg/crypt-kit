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

/**
 * Where `value` stops being plain JSON, or null if it is plain JSON throughout.
 * Payloads are persisted as JSON and read back by other runs and processes, so a
 * Date, Map, class instance, undefined or non-finite number would come back as a
 * different type (or vanish). Detectors must convert those first (e.g. dates to ISO strings).
 */
export function findNonJson(value: unknown, path = 'payload'): string | null {
  return check(value, path, new Set());
}

/** `ancestors` holds the objects on the current path only, so shared (acyclic) references are fine. */
function check(value: unknown, path: string, ancestors: Set<object>): string | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? null : `${path} is ${value}, which JSON can't store`;
  if (typeof value !== 'object') return `${path} is ${typeof value}, which JSON can't store`;

  if (ancestors.has(value)) return `${path} refers back to one of its parents, which JSON can't store`;
  if (!Array.isArray(value)) {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return `${path} is a ${value.constructor?.name ?? 'non-plain object'}; use a plain object, string or number`;
    }
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (!(i in value)) return `${path}[${i}] is a hole in a sparse array`;
        const problem = check(value[i], `${path}[${i}]`, ancestors);
        if (problem) return problem;
      }
      return null;
    }
    for (const [key, item] of Object.entries(value)) {
      const problem = check(item, `${path}.${key}`, ancestors);
      if (problem) return problem;
    }
    return null;
  } finally {
    ancestors.delete(value);
  }
}
