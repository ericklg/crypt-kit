import type { Haunt, HauntStatus } from './haunt.js';

export interface ListFilter {
  detectorId?: string;
  status?: readonly HauntStatus[];
}

/**
 * Persistence for haunts. Writes are compare-and-set on `Haunt.version`, which is what
 * keeps separate processes from running one action twice or overwriting each other.
 */
export interface TrackerStore {
  get(key: string): Promise<Haunt | null>;
  /**
   * Writes `haunt` only if the stored version equals `expectedVersion`, or, when
   * `expectedVersion` is null, only if no haunt with that key exists yet.
   * Returns false on a conflict and leaves the store unchanged.
   * `haunt.version` must be `(expectedVersion ?? 0) + 1`; see `checkPutVersion`.
   */
  put(haunt: Haunt, expectedVersion: number | null): Promise<boolean>;
  /** Ordered by `firstSeenAt`, then `key`, both compared as plain strings. */
  list(filter?: ListFilter): Promise<Haunt[]>;
}

/** Throws if a write's version doesn't follow from its expected version. Adapters call this first. */
export function checkPutVersion(haunt: Haunt, expectedVersion: number | null): void {
  if (expectedVersion !== null && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) {
    throw new RangeError(`expectedVersion must be null or a positive integer, got ${expectedVersion}`);
  }
  const want = (expectedVersion ?? 0) + 1;
  if (haunt.version !== want) {
    throw new RangeError(`Haunt ${haunt.key} has version ${haunt.version}; a write expecting ${expectedVersion} must carry ${want}`);
  }
}

/** Plain string order, so every store sorts the same way regardless of locale. */
export function compareHaunts(a: Haunt, b: Haunt): number {
  if (a.firstSeenAt !== b.firstSeenAt) return a.firstSeenAt < b.firstSeenAt ? -1 : 1;
  if (a.key !== b.key) return a.key < b.key ? -1 : 1;
  return 0;
}

/** In-memory store for tests and local experiments. Returns copies so callers can't mutate state. */
export function createMemoryStore(initial: readonly Haunt[] = []): TrackerStore {
  const haunts = new Map<string, Haunt>(initial.map((h) => [h.key, structuredClone(h)]));
  return {
    async get(key) {
      const haunt = haunts.get(key);
      return haunt ? structuredClone(haunt) : null;
    },
    async put(haunt, expectedVersion) {
      checkPutVersion(haunt, expectedVersion);
      const current = haunts.get(haunt.key);
      const matches = expectedVersion === null ? current === undefined : current?.version === expectedVersion;
      if (!matches) return false;
      haunts.set(haunt.key, structuredClone(haunt));
      return true;
    },
    async list(filter = {}) {
      return [...haunts.values()]
        .filter((h) => (filter.detectorId ? h.detectorId === filter.detectorId : true))
        .filter((h) => (filter.status ? filter.status.includes(h.status) : true))
        .sort(compareHaunts)
        .map((h) => structuredClone(h));
    },
  };
}
