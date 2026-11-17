import type { Haunt, HauntStatus } from './haunt.js';

export interface ListFilter {
  detectorId?: string;
  status?: readonly HauntStatus[];
}

/** Persistence for haunts. Swap the in-memory store for SQLite or libSQL in production. */
export interface TrackerStore {
  get(key: string): Promise<Haunt | null>;
  upsert(haunt: Haunt): Promise<void>;
  list(filter?: ListFilter): Promise<Haunt[]>;
}

/** In-memory store for tests and local experiments. Returns copies so callers can't mutate state. */
export function createMemoryStore(initial: readonly Haunt[] = []): TrackerStore {
  const haunts = new Map<string, Haunt>(initial.map((h) => [h.key, structuredClone(h)]));
  return {
    async get(key) {
      const haunt = haunts.get(key);
      return haunt ? structuredClone(haunt) : null;
    },
    async upsert(haunt) {
      haunts.set(haunt.key, structuredClone(haunt));
    },
    async list(filter = {}) {
      return [...haunts.values()]
        .filter((h) => (filter.detectorId ? h.detectorId === filter.detectorId : true))
        .filter((h) => (filter.status ? filter.status.includes(h.status) : true))
        .sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt) || a.key.localeCompare(b.key))
        .map((h) => structuredClone(h));
    },
  };
}
