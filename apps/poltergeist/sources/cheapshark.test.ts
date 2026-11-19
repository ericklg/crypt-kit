import { fixtureFetch } from '@crypt-kit/core/testing';
import { describe, expect, it } from 'vitest';
import { CheapSharkRateLimitError, createCheapSharkSource } from './cheapshark';
import { API, recordedCheapSharkRoutes, recordedGames } from './fixtures/cheapshark';

const ctx = (fetch: typeof globalThis.fetch) => ({ fetch, signal: new AbortController().signal });

describe('CheapShark source', () => {
  it('quotes each game’s cheapest deal, with its historic low, store and redirect link', async () => {
    const { fetch } = fixtureFetch(recordedCheapSharkRoutes);
    const quotes = await createCheapSharkSource().quote(['612', '128', '167910'], ctx(fetch));
    expect(quotes).toEqual([
      {
        itemId: '128',
        title: 'BioShock',
        price: 16.79,
        currency: 'USD',
        normalPrice: 19.99,
        historicLow: 3.5,
        store: 'GameBillet',
        url: 'https://www.cheapshark.com/redirect?dealID=et8hm7BwoAPZnyJpSAAehTMKS7M1aPlbLKSZDWmUtEo%3D',
      },
      expect.objectContaining({ itemId: '167910', price: 2.99, store: 'WinGameStore', historicLow: 2.19 }),
      expect.objectContaining({ itemId: '612', title: 'LEGO Batman', price: 2.99, historicLow: 2.28 }),
    ]);
  });

  it('keeps the API’s already-encoded dealID as is', async () => {
    const { fetch } = fixtureFetch(recordedCheapSharkRoutes);
    const [, arkham] = await createCheapSharkSource().quote(['128', '167910'], ctx(fetch)).then((q) => q);
    expect(arkham!.url).toBe('https://www.cheapshark.com/redirect?dealID=y7nEC%2FMdMa4myBUYqzJ%2BN09pUxao0wE%2FOOLHOmEAmCM%3D');
  });

  it('sends a descriptive User-Agent with the optional contact', async () => {
    const agents: string[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      agents.push(new Request(input, init).headers.get('user-agent') ?? '');
      return Response.json([]);
    };
    await createCheapSharkSource({ contact: 'ops@example.com' }).search('batman', ctx(fetch));
    expect(agents[0]).toBe('CryptKit-PricePoltergeist/0.1 (+https://github.com/ericklg/crypt-kit) ops@example.com');
  });

  it('serves repeat calls from its cache for an hour', async () => {
    let t = 0;
    const { fetch, calls } = fixtureFetch(recordedCheapSharkRoutes);
    const source = createCheapSharkSource({ now: () => t });
    await source.quote(['612', '128', '167910'], ctx(fetch));
    await source.quote(['167910', '612', '128'], ctx(fetch)); // same set, any order
    expect(calls.length).toBe(2); // stores + one games lookup
    t = 60 * 60 * 1000 + 1;
    await source.quote(['612', '128', '167910'], ctx(fetch));
    expect(calls.filter((c) => c.url.includes('/games')).length).toBe(2);
  });

  it('sends one request at a time', async () => {
    let inFlight = 0;
    let most = 0;
    const fetch: typeof globalThis.fetch = async () => {
      most = Math.max(most, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return Response.json([]);
    };
    const source = createCheapSharkSource();
    await Promise.all(['a', 'b', 'c', 'd'].map((q) => source.search(`batman ${q}`, ctx(fetch))));
    expect(most).toBe(1);
  });

  it('asks for at most 25 games per lookup, in a stable order so the cache hits', async () => {
    const urls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      urls.push(String(input));
      return Response.json(String(input).endsWith('/stores') ? [] : {});
    };
    const ids = Array.from({ length: 30 }, (_, i) => String(1000 + i));
    await createCheapSharkSource().quote(ids, ctx(fetch));
    const lookups = urls.filter((u) => u.includes('/games?ids='));
    expect(lookups.map((u) => new URL(u).searchParams.get('ids')!.split(',').length)).toEqual([25, 5]);

    const one = fixtureFetch(recordedCheapSharkRoutes);
    await createCheapSharkSource().quote(['612', '128', '167910'], ctx(one.fetch));
    expect(one.calls.at(-1)!.url).toBe(`${API}/games?ids=128,167910,612`);
  });

  it('stops calling after a 429 until Retry-After has passed, and fails the poll', async () => {
    let t = 0;
    let calls = 0;
    const fetch: typeof globalThis.fetch = async () => {
      calls++;
      return new Response('slow down', { status: 429, headers: { 'retry-after': '120' } });
    };
    const source = createCheapSharkSource({ now: () => t });
    await expect(source.search('batman', ctx(fetch))).rejects.toBeInstanceOf(CheapSharkRateLimitError);
    t = 119_000;
    await expect(source.search('hades', ctx(fetch))).rejects.toBeInstanceOf(CheapSharkRateLimitError);
    expect(calls).toBe(1);
    t = 121_000;
    await expect(source.search('hades', ctx(fetch))).rejects.toBeInstanceOf(CheapSharkRateLimitError);
    expect(calls).toBe(2);
  });

  it('fails a quote when the lookup fails, and only leaves store names out when the store list does', async () => {
    const down = fixtureFetch([{ match: `${API}/stores`, body: recordedCheapSharkRoutes[0]!.body }, { match: /\/games\?ids=/, status: 503, body: {} }]);
    await expect(createCheapSharkSource().quote(['612'], ctx(down.fetch))).rejects.toThrow('CheapShark returned 503 for /games');

    const noStores = fixtureFetch([{ match: `${API}/stores`, status: 500, body: {} }, { match: `${API}/games?ids=612`, body: { '612': recordedGames['612'] } }]);
    const [lego] = await createCheapSharkSource().quote(['612'], ctx(noStores.fetch));
    expect(lego).toMatchObject({ itemId: '612', price: 2.99, store: null });
  });

  it('skips unknown games, non-numeric IDs and deals with odd IDs', async () => {
    const odd = { ...recordedGames['612'], deals: [{ ...recordedGames['612'].deals[0]!, dealID: 'abc"><script>' }] };
    const { fetch, calls } = fixtureFetch([
      { match: `${API}/stores`, body: [] },
      { match: `${API}/games?ids=612,999`, body: { '612': odd, '999': null } },
    ]);
    expect(await createCheapSharkSource().quote(['612', '999', '../stores'], ctx(fetch))).toEqual([]);
    expect(calls.every((c) => !c.url.includes('..'))).toBe(true);
  });

  it('searches by title, encoded, and returns each game’s cheapest deal', async () => {
    const { fetch, calls } = fixtureFetch([
      {
        match: `${API}/games?title=lego%20batman%20%26%20co&limit=10`,
        body: [{ gameID: '612', cheapest: '2.99', cheapestDealID: 'Dtzv5PHBf71720cIYjxx3oHvvZK3iHUbQjv6fWLVpd8%3D', external: 'LEGO Batman' }],
      },
    ]);
    const hits = await createCheapSharkSource().search('  lego batman & co ', ctx(fetch));
    expect(hits).toEqual([expect.objectContaining({ itemId: '612', title: 'LEGO Batman', price: 2.99 })]);
    expect(calls).toHaveLength(1);
    expect(await createCheapSharkSource().search('x', ctx(fetch))).toEqual([]); // too short: no request
  });
});
