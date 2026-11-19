import { createCachedGet, type SharedState } from './cached-get';
import type { PriceQuote, PriceSource, SourceContext } from './price-source';

// Follows Best Buy's API terms; see .kiro/steering/price-sources.md.
export const BESTBUY_API = 'https://api.bestbuy.com/v1';
/** Best Buy's own logo snippet, as its Branding Guidelines provide it. */
export const BESTBUY_ATTRIBUTION = {
  href: 'https://developer.bestbuy.com',
  logo: 'https://developer.bestbuy.com/images/bestbuy-logo.png',
  alt: 'Best Buy Developer API',
} as const;
const DEFAULT_CACHE_MS = 60 * 60 * 1000; // the terms allow up to 72 hours
/** The terms allow 5 calls a second; stay under it. */
const MIN_INTERVAL_MS = 250;
const MAX_SKUS_PER_CALL = 100;
const MAX_SEARCH_RESULTS = 10;
const MAX_SEARCH_WORDS = 5;
const SHOW = 'sku,name,salePrice,regularPrice,url,type';
const SKU = /^\d{1,12}$/;
/** Music and movie data needs Best Buy's affiliate program, so it's left out. */
const EXCLUDED_TYPES = new Set(['music', 'movie']);
const LINK_HOSTS = new Set(['www.bestbuy.com', 'api.bestbuy.com']);

/** Best Buy SKUs are digits. */
export const isBestBuySku = (id: string) => SKU.test(id);

export interface BestBuyOptions {
  /** BESTBUY_API_KEY. Only ever sent to api.bestbuy.com; never in cache keys or errors. */
  apiKey: string;
  cacheMs?: number;
  shared?: SharedState | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface Product {
  sku: number | string;
  name: string;
  salePrice: number | null;
  regularPrice: number | null;
  url: string | null;
  type: string | null;
}

interface ProductsPage {
  products: Product[];
}

const money = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null);

/** The product page link exactly as Best Buy sent it (the terms forbid changing links). */
function productLink(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && LINK_HOSTS.has(u.hostname) ? url : null;
  } catch {
    return null;
  }
}

function toQuote(p: Product): PriceQuote | null {
  const sku = String(p.sku);
  const price = money(p.salePrice);
  const url = productLink(p.url);
  if (!SKU.test(sku) || price === null || !url || EXCLUDED_TYPES.has(String(p.type ?? '').toLowerCase())) return null;
  return {
    itemId: sku,
    title: p.name,
    price,
    currency: 'USD',
    normalPrice: money(p.regularPrice),
    historicLow: null, // the Products API doesn't publish one
    store: 'Best Buy',
    url,
  };
}

/**
 * Best Buy prices through its Products API, enabled by BESTBUY_API_KEY (R7.7). Item IDs
 * are SKUs. Lookups batch SKUs with `sku in(...)`, requests start at most 4 a second, and
 * responses are cached for an hour, shared across instances when `shared` is given.
 */
export function createBestBuySource(options: BestBuyOptions): PriceSource {
  const key = options.apiKey.trim();
  const get = createCachedGet({
    name: 'Best Buy',
    keyPrefix: 'bestbuy',
    cacheMs: options.cacheMs ?? DEFAULT_CACHE_MS,
    minIntervalMs: MIN_INTERVAL_MS,
    shared: options.shared ?? null,
    ...(options.now ? { now: options.now } : {}),
    ...(options.sleep ? { sleep: options.sleep } : {}),
    // The key is added only here, so it never reaches a cache key, a log or an error.
    request: (path, ctx) => {
      const sep = path.includes('?') ? '&' : '?';
      return ctx.fetch(`${BESTBUY_API}${path}${sep}apiKey=${encodeURIComponent(key)}`, {
        headers: { accept: 'application/json' },
        signal: ctx.signal,
      });
    },
  });

  return {
    id: 'bestbuy',
    name: 'Best Buy',
    noun: { one: 'product', many: 'products' },
    attribution: BESTBUY_ATTRIBUTION,
    enabled: () => key.length > 0,

    async quote(itemIds, ctx: SourceContext) {
      const skus = [...new Set(itemIds)].filter((id) => SKU.test(id)).sort();
      const quotes: PriceQuote[] = [];
      for (let i = 0; i < skus.length; i += MAX_SKUS_PER_CALL) {
        const batch = skus.slice(i, i + MAX_SKUS_PER_CALL);
        const page = await get<ProductsPage>(`/products(sku%20in(${batch.join(',')}))?format=json&show=${SHOW}&pageSize=${MAX_SKUS_PER_CALL}`, ctx);
        for (const p of page.products ?? []) {
          const q = toQuote(p);
          if (q && batch.includes(q.itemId)) quotes.push(q);
        }
      }
      return quotes.sort((a, b) => a.itemId.localeCompare(b.itemId));
    },

    async search(query, ctx) {
      // Keyword search takes whole words; anything else could change the query's meaning.
      const words = query.toLowerCase().match(/[a-z0-9]+/g)?.slice(0, MAX_SEARCH_WORDS) ?? [];
      if (words.join(' ').length < 2) return [];
      const terms = words.map((w) => `search=${w}`).join('&');
      const page = await get<ProductsPage>(`/products(${terms})?format=json&show=${SHOW}&pageSize=${MAX_SEARCH_RESULTS}`, ctx);
      return (page.products ?? []).flatMap((p) => toQuote(p) ?? []);
    },
  };
}
