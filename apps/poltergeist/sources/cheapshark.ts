import type { PriceQuote, PriceSource, SourceContext } from './price-source';

// Follows CheapShark's usage notes; see .kiro/steering/price-sources.md.
export const CHEAPSHARK_API = 'https://www.cheapshark.com/api/1.0';
export const CHEAPSHARK_REDIRECT = 'https://www.cheapshark.com/redirect?dealID=';
const USER_AGENT = 'CryptKit-PricePoltergeist/0.1 (+https://github.com/ericklg/crypt-kit)';
export const DEFAULT_CACHE_MS = 60 * 60 * 1000;
const STORES_CACHE_MS = 24 * 60 * 60 * 1000;
/** Multiple Game Lookup takes at most 25 IDs. */
const MAX_IDS_PER_CALL = 25;
const MAX_SEARCH_RESULTS = 10;
/** Responses kept in memory per instance; every distinct search is one. */
const MAX_CACHED = 200;
const GAME_ID = /^\d{1,10}$/;

/** CheapShark game IDs are 1–10 digits. */
export const isCheapSharkGameId = (id: string) => GAME_ID.test(id);

export interface CheapSharkOptions {
  /** How long responses are reused. Default 1 hour, CheapShark's own update rate. */
  cacheMs?: number;
  /** Added to the User-Agent, e.g. an email, so CheapShark can reach us. */
  contact?: string | null;
  /**
   * State shared by every server instance (e.g. `createSqliteKeyValue`). With it, the cache
   * and a 429's pause apply across instances, not just the one that saw them.
   */
  shared?: SharedState | null;
  now?: () => number;
}

/** Expiring string values shared across instances. */
export interface SharedState {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
}

const BLOCK_KEY = 'cheapshark:blocked-until';
const cacheKey = (path: string) => `cheapshark:cache:${path}`;

/** CheapShark refused us for now (429). Polls fail instead of reporting partial prices. */
export class CheapSharkRateLimitError extends Error {
  override readonly name = 'CheapSharkRateLimitError';
  constructor(readonly retryAt: number) {
    super(`CheapShark is rate limiting this app; not calling it again until ${new Date(retryAt).toISOString()}`);
  }
}

interface Deal {
  storeID: string;
  dealID: string;
  price: string;
  retailPrice: string;
}

interface GameLookup {
  info: { title: string };
  cheapestPriceEver: { price: string } | null;
  deals: Deal[];
}

interface GameSearchHit {
  gameID: string;
  cheapest: string;
  cheapestDealID: string;
  external: string;
}

interface Store {
  storeID: string;
  storeName: string;
}

const money = (s: string | undefined | null) => {
  const n = s === undefined || s === null ? Number.NaN : Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

/** dealIDs come URL-encoded from the API; only allow that alphabet so the link can't be bent. */
const dealLink = (dealId: string) => (/^[A-Za-z0-9%._~-]+$/.test(dealId) ? `${CHEAPSHARK_REDIRECT}${dealId}` : null);

/**
 * Live PC game prices from CheapShark (no key). Item IDs are CheapShark game IDs.
 * Responses are cached (default 1 hour) and requests run one at a time, and a 429
 * pauses all calls until its Retry-After has passed.
 */
export function createCheapSharkSource(options: CheapSharkOptions = {}): PriceSource {
  const cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS;
  const now = options.now ?? Date.now;
  const userAgent = options.contact ? `${USER_AGENT} ${options.contact.replace(/[^\x20-\x7e]/g, '')}` : USER_AGENT;
  const cache = new Map<string, { expires: number; data: unknown }>();
  /** Keeps the in-memory cache small: expired entries go, then the oldest past the cap. */
  const remember = (path: string, expires: number, data: unknown) => {
    const t = now();
    for (const [key, entry] of cache) if (entry.expires <= t) cache.delete(key);
    cache.delete(path);
    cache.set(path, { expires, data });
    while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  };
  const shared = options.shared ?? null;
  let queue: Promise<unknown> = Promise.resolve();
  let blockedUntil = 0;

  /** GET a CheapShark API path, through the caches, one request at a time per instance. */
  const get = <T>(path: string, ctx: SourceContext, ttl = cacheMs): Promise<T> => {
    const run = async (): Promise<T> => {
      const hit = cache.get(path);
      if (hit && hit.expires > now()) return hit.data as T;
      if (shared) {
        const stored = await shared.get(cacheKey(path));
        // Not copied into the in-memory cache: that would restart its clock, and the
        // shared entry's own expiry is the one that counts.
        if (stored !== null) return JSON.parse(stored) as T;
        blockedUntil = Math.max(blockedUntil, Number(await shared.get(BLOCK_KEY)) || 0);
      }
      if (blockedUntil > now()) throw new CheapSharkRateLimitError(blockedUntil);
      const res = await ctx.fetch(`${CHEAPSHARK_API}${path}`, {
        headers: { accept: 'application/json', 'user-agent': userAgent },
        signal: ctx.signal,
      });
      if (res.status === 429) {
        const seconds = Number(res.headers.get('retry-after'));
        const pauseMs = (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000;
        blockedUntil = now() + pauseMs;
        await shared?.set(BLOCK_KEY, String(blockedUntil), pauseMs);
        throw new CheapSharkRateLimitError(blockedUntil);
      }
      if (!res.ok) throw new Error(`CheapShark returned ${res.status} for ${path.split('?')[0]}`);
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

  /**
   * storeID → name. Display only, so a failure doesn't fail the poll. It reuses the last
   * names that loaded, because quotes that suddenly lose their store would change the
   * payload and redraft verdicts over an outage that changed no price.
   */
  let lastStores = new Map<string, string>();
  const storeNames = async (ctx: SourceContext): Promise<Map<string, string>> => {
    try {
      const stores = await get<Store[]>('/stores', ctx, STORES_CACHE_MS);
      lastStores = new Map(stores.map((s) => [s.storeID, s.storeName]));
    } catch (error) {
      if (error instanceof CheapSharkRateLimitError) throw error;
    }
    return lastStores;
  };

  return {
    id: 'cheapshark',
    name: 'CheapShark',
    enabled: () => true,

    async quote(itemIds, ctx) {
      const ids = [...new Set(itemIds)].filter((id) => GAME_ID.test(id)).sort();
      if (!ids.length) return [];
      const batches: string[][] = [];
      for (let i = 0; i < ids.length; i += MAX_IDS_PER_CALL) batches.push(ids.slice(i, i + MAX_IDS_PER_CALL));
      const stores = await storeNames(ctx);
      const quotes: PriceQuote[] = [];
      for (const batch of batches) {
        const games = await get<Record<string, GameLookup | null>>(`/games?ids=${batch.join(',')}`, ctx);
        for (const id of batch) {
          const game = games[id];
          if (!game?.info?.title) continue;
          let best: { deal: Deal; price: number } | null = null;
          for (const deal of game.deals ?? []) {
            const price = money(deal.price);
            if (price !== null && dealLink(deal.dealID) && (!best || price < best.price)) best = { deal, price };
          }
          if (!best) continue;
          quotes.push({
            itemId: id,
            title: game.info.title,
            price: best.price,
            currency: 'USD',
            normalPrice: money(best.deal.retailPrice),
            historicLow: money(game.cheapestPriceEver?.price),
            store: stores.get(best.deal.storeID) ?? null,
            url: dealLink(best.deal.dealID)!,
          });
        }
      }
      return quotes;
    },

    async search(query, ctx) {
      const title = query.trim().slice(0, 100);
      if (title.length < 2) return [];
      const hits = await get<GameSearchHit[]>(`/games?title=${encodeURIComponent(title)}&limit=${MAX_SEARCH_RESULTS}`, ctx);
      return hits.flatMap((h) => {
        const price = money(h.cheapest);
        const url = dealLink(h.cheapestDealID);
        if (!GAME_ID.test(h.gameID) || price === null || !url) return [];
        return [{ itemId: h.gameID, title: h.external, price, currency: 'USD' as const, normalPrice: null, historicLow: null, store: null, url }];
      });
    },
  };
}
