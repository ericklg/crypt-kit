import type { SourceContext } from './price-source';

/** Expiring string values shared across instances (e.g. `createSqliteKeyValue`). */
export interface SharedState {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  /** Atomically reserves the next start time for a once-per-interval action, across instances. */
  reserve?(key: string, intervalMs: number): Promise<number>;
}

/** A source refused us for now. Polls fail instead of reporting partial prices. */
export class RateLimitError extends Error {
  override readonly name = 'RateLimitError';
  constructor(
    readonly source: string,
    readonly retryAt: number,
  ) {
    super(`${source} is rate limiting this app; not calling it again until ${new Date(retryAt).toISOString()}`);
  }
}

export interface CachedGetOptions {
  /** Shown in errors, e.g. "CheapShark". */
  name: string;
  /** Prefix for shared keys, e.g. "cheapshark". */
  keyPrefix: string;
  /**
   * Sends the request for a path. Credentials go in here, never in `path`: the path is
   * the cache key and appears in error messages.
   */
  request(path: string, ctx: SourceContext): Promise<Response>;
  cacheMs: number;
  /** Shared cache and rate-limit pause. Without it, both are per instance. */
  shared?: SharedState | null;
  /** Least time between request starts, for per-second limits. Default 0. */
  minIntervalMs?: number;
  /** Responses kept in memory per instance. Default 200. */
  maxCached?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * A GET for a source API: cached in memory and in shared state, one request at a time
 * per instance, at most one start per `minIntervalMs`, and paused everywhere after a 429
 * until its Retry-After has passed.
 */
export function createCachedGet(options: CachedGetOptions) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxCached = options.maxCached ?? 200;
  const minInterval = options.minIntervalMs ?? 0;
  const shared = options.shared ?? null;
  const blockKey = `${options.keyPrefix}:blocked-until`;
  const cacheKey = (path: string) => `${options.keyPrefix}:cache:${path}`;
  const cache = new Map<string, { expires: number; data: unknown }>();
  let queue: Promise<unknown> = Promise.resolve();
  let blockedUntil = 0;
  let lastStart = Number.NEGATIVE_INFINITY;

  /** Keeps the in-memory cache small: expired entries go, then the oldest past the cap. */
  const remember = (path: string, expires: number, data: unknown) => {
    const t = now();
    for (const [key, entry] of cache) if (entry.expires <= t) cache.delete(key);
    cache.delete(path);
    cache.set(path, { expires, data });
    while (cache.size > maxCached) cache.delete(cache.keys().next().value!);
  };

  return function get<T>(path: string, ctx: SourceContext, ttl = options.cacheMs): Promise<T> {
    const run = async (): Promise<T> => {
      const hit = cache.get(path);
      if (hit && hit.expires > now()) return hit.data as T;
      if (shared) {
        const stored = await shared.get(cacheKey(path));
        // Not copied into the in-memory cache: that would restart its clock, and the
        // shared entry's own expiry is the one that counts.
        if (stored !== null) return JSON.parse(stored) as T;
        blockedUntil = Math.max(blockedUntil, Number(await shared.get(blockKey)) || 0);
      }
      if (blockedUntil > now()) throw new RateLimitError(options.name, blockedUntil);
      if (minInterval > 0) {
        // With shared state the slot is reserved for every instance at once, so all of them
        // together stay under a per-second limit; without it, only this instance is spaced.
        const slot = shared?.reserve ? await shared.reserve(`${options.keyPrefix}:next-slot`, minInterval) : Math.max(now(), lastStart + minInterval);
        lastStart = slot;
        const gap = slot - now();
        if (gap > 0) await sleep(gap);
      }
      const res = await options.request(path, ctx);
      if (res.status === 429) {
        const seconds = Number(res.headers.get('retry-after'));
        const pauseMs = (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000;
        blockedUntil = Math.max(blockedUntil, now() + pauseMs);
        await shared?.set(blockKey, String(blockedUntil), blockedUntil - now());
        throw new RateLimitError(options.name, blockedUntil);
      }
      if (!res.ok) throw new Error(`${options.name} returned ${res.status} for ${path.split(/[?(]/)[0]}`);
      const text = await res.text();
      const data = JSON.parse(text) as T;
      remember(path, now() + ttl, data);
      await shared?.set(cacheKey(path), text, ttl);
      return data;
    };
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  };
}
