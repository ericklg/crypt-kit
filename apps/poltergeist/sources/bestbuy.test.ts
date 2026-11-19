import { assertDetectorContract, fixtureFetch } from '@crypt-kit/core/testing';
import { describe, expect, it } from 'vitest';
import { createPriceDropsDetector } from '../detectors/price-drops';
import { createOpenDealAction } from '../actions/open-deal';
import { RateLimitError } from './cached-get';
import { BESTBUY_ATTRIBUTION, createBestBuySource } from './bestbuy';
import { BESTBUY_API, products, recordedBestBuyRoutes, TEST_KEY } from './fixtures/bestbuy';

const ctx = (fetch: typeof globalThis.fetch) => ({ fetch, signal: new AbortController().signal });
const noSleep = async () => {};
const source = () => createBestBuySource({ apiKey: TEST_KEY, sleep: noSleep });

describe('Best Buy source', () => {
  it('quotes SKUs in one batched lookup, with the product link exactly as sent', async () => {
    const { fetch, calls } = fixtureFetch(recordedBestBuyRoutes);
    const quotes = await source().quote(['6323759', '5477500'], ctx(fetch));
    expect(calls).toHaveLength(1);
    expect(quotes).toEqual([
      { itemId: '5477500', title: products.tvStick.name, price: 39.99, currency: 'USD', normalPrice: 39.99, historicLow: null, store: 'Best Buy', url: products.tvStick.url },
      { itemId: '6323759', title: products.camera.name, price: 449.99, currency: 'USD', normalPrice: 549.99, historicLow: null, store: 'Best Buy', url: products.camera.url },
    ]);
  });

  it('leaves out music and movies, which need Best Buy’s affiliate program', async () => {
    const { fetch } = fixtureFetch(recordedBestBuyRoutes);
    expect((await source().quote(['6323759', '5477500', '1000001'], ctx(fetch))).map((q) => q.itemId)).toEqual(['5477500', '6323759']);
    expect((await source().search('Canon Rebel', ctx(fixtureFetch(recordedBestBuyRoutes).fetch))).map((q) => q.itemId)).toEqual(['6323759']);
  });

  it('searches with whole keywords only, so typed text can’t change the query', async () => {
    const { fetch, calls } = fixtureFetch([{ match: /\/products\(/, body: { products: [] } }]);
    await source().search('canon) | sku=*&(rebel', ctx(fetch));
    expect(decodeURIComponent(new URL(calls[0]!.url).pathname)).toBe('/v1/products(search=canon&search=sku&search=rebel)');
    expect(await source().search('!', ctx(fetch))).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('keeps the API key out of cache keys and error messages', async () => {
    const stored: string[] = [];
    const shared = { get: async () => null, set: async (k: string) => void stored.push(k) };
    const ok = createBestBuySource({ apiKey: TEST_KEY, shared, sleep: noSleep });
    await ok.quote(['6323759', '5477500'], ctx(fixtureFetch(recordedBestBuyRoutes).fetch));
    expect(stored.join(' ')).not.toContain(TEST_KEY);

    const down = fixtureFetch([{ match: /\/products\(/, status: 403, body: { errorMessage: `bad key ${TEST_KEY}` } }]);
    const error = await source().quote(['6323759'], ctx(down.fetch)).catch((e: Error) => e);
    expect(String(error)).toBe('Error: Best Buy returned 403 for /products');
    expect(String(error)).not.toContain(TEST_KEY);
  });

  it('starts requests at least 250 ms apart, under the 5-a-second limit', async () => {
    let t = 0;
    const waits: number[] = [];
    const s = createBestBuySource({
      apiKey: TEST_KEY,
      now: () => t,
      sleep: async (ms) => {
        waits.push(ms);
        t += ms;
      },
    });
    const fetch: typeof globalThis.fetch = async () => Response.json({ products: [] });
    for (const q of ['tv', 'camera', 'laptop']) await s.search(q, ctx(fetch));
    expect(waits).toEqual([250, 250]);
  });

  it('spaces requests across instances that share state, under the per-second limit', async () => {
    let t = 0;
    let next = 0;
    const shared = {
      get: async () => null,
      set: async () => {},
      // Mirrors createSqliteKeyValue.reserve: one atomic step per caller.
      reserve: async (_k: string, iv: number) => {
        const slot = Math.max(next, t);
        next = slot + iv;
        return slot;
      },
    };
    const waits: number[] = [];
    let fetches = 0;
    const fetch: typeof globalThis.fetch = async () => {
      fetches++;
      return Response.json({ products: [] });
    };
    // Six instances, each with its own queue, searching at the same moment (clock held at 0):
    // each must wait until its own slot, 250 ms after the previous one.
    const instances = Array.from({ length: 6 }, () =>
      createBestBuySource({ apiKey: TEST_KEY, shared, now: () => t, sleep: async (ms) => void waits.push(ms) }),
    );
    await Promise.all(instances.map((s, i) => s.search(`tv ${i}`, ctx(fetch))));
    expect(fetches).toBe(6);
    expect([...waits].sort((a, b) => a - b)).toEqual([250, 500, 750, 1000, 1250]); // the first starts at once
  });

  it('rechecks the shared pause after waiting for its slot', async () => {
    let t = 0;
    const values = new Map<string, string>();
    const shared = {
      get: async (k: string) => values.get(k) ?? null,
      set: async (k: string, v: string) => void values.set(k, v),
      reserve: async () => 250, // our slot is 250 ms away
    };
    let calls = 0;
    const fetch: typeof globalThis.fetch = async () => {
      calls++;
      return Response.json({ products: [] });
    };
    const s = createBestBuySource({
      apiKey: TEST_KEY,
      shared,
      now: () => t,
      // While we wait, another instance gets a 429 and pauses everyone for a minute.
      sleep: async (ms) => {
        values.set('bestbuy:blocked-until', String(t + 60_000));
        t += ms;
      },
    });
    await expect(s.search('tv', ctx(fetch))).rejects.toBeInstanceOf(RateLimitError);
    expect(calls).toBe(0);
  });

  it('pauses after a 429 until Retry-After has passed', async () => {
    let calls = 0;
    const fetch: typeof globalThis.fetch = async () => {
      calls++;
      return new Response('', { status: 429, headers: { 'retry-after': '30' } });
    };
    const s = createBestBuySource({ apiKey: TEST_KEY, now: () => 0, sleep: noSleep });
    await expect(s.search('tv', ctx(fetch))).rejects.toBeInstanceOf(RateLimitError);
    await expect(s.search('camera', ctx(fetch))).rejects.toThrow(/Best Buy is rate limiting/);
    expect(calls).toBe(1);
  });

  it('drops links that don’t go to Best Buy, and is enabled only with a key', async () => {
    const { fetch } = fixtureFetch([
      { match: /\/products\(/, body: { products: [{ ...products.camera, url: 'https://evil.example/x' }, { ...products.tvStick, url: 'http://www.bestbuy.com/x' }] } },
    ]);
    expect(await source().quote(['6323759', '5477500'], ctx(fetch))).toEqual([]);
    expect(createBestBuySource({ apiKey: '  ' }).enabled()).toBe(false);
    expect(source().attribution).toEqual(BESTBUY_ATTRIBUTION);
    expect(source().noun).toEqual({ one: 'product', many: 'products' });
  });

  it('drives the price-drop detector and the open-deal action end to end', async () => {
    const detector = createPriceDropsDetector({ source: source(), watchlist: async () => [{ itemId: '6323759', target: 450 }, { itemId: '5477500', target: 30 }] });
    const { findings } = await assertDetectorContract(detector, { routes: recordedBestBuyRoutes });
    expect(findings.map((f) => f.key)).toEqual(['bestbuy:6323759@449.99']);
    const result = await createOpenDealAction().run(findings[0]!, { summary: 's', proposal: 'Buy now.', reasoning: 'r', options: {} }, { signal: new AbortController().signal });
    expect(result).toEqual({ ok: true, message: 'Deal link opened.', url: products.camera.url });
  });

  it('never sends the key anywhere but api.bestbuy.com', async () => {
    const hosts = new Set<string>();
    const fetch: typeof globalThis.fetch = async (input) => {
      hosts.add(new URL(String(input)).host);
      return Response.json({ products: [] });
    };
    await source().search('tv', ctx(fetch));
    await source().quote(['6323759'], ctx(fetch));
    expect([...hosts]).toEqual([new URL(BESTBUY_API).host]);
  });
});
