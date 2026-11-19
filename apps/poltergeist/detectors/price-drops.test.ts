import { silentLogger } from '@crypt-kit/core';
import { assertDetectorContract, fixtureFetch } from '@crypt-kit/core/testing';
import { describe, expect, it } from 'vitest';
import { DEMO_WATCHLIST } from '../config';
import { createCheapSharkSource } from '../sources/cheapshark';
import { createFixtureSource } from '../sources/fixture';
import { recordedCheapSharkRoutes } from '../sources/fixtures/cheapshark';
import { createPriceDropsDetector, type WatchItem } from './price-drops';

const NOW = new Date('2026-11-19T12:00:00Z');
const live = (watch: WatchItem[]) => createPriceDropsDetector({ source: createCheapSharkSource(), watchlist: async () => watch });
const poll = (detector: ReturnType<typeof live>, routes = recordedCheapSharkRoutes) =>
  detector.poll({ fetch: fixtureFetch(routes).fetch, now: () => NOW, signal: new AbortController().signal, log: silentLogger });

// LEGO Batman (612) is $2.99, BioShock (128) $16.79, Arkham VR (167910) $2.99 in the recording.
const WATCH: WatchItem[] = [
  { itemId: '612', target: 3 },
  { itemId: '128', target: 15 },
  { itemId: '167910', target: 2.99 },
];

describe('price drops detector', () => {
  it('follows the detector contract against recorded CheapShark responses', async () => {
    await assertDetectorContract(live(WATCH), { routes: recordedCheapSharkRoutes, now: NOW });
  });

  it('reports only games at or under their target, keyed source:id@price', async () => {
    const findings = await poll(live(WATCH));
    expect(findings.map((f) => f.key)).toEqual(['cheapshark:167910@2.99', 'cheapshark:612@2.99']);
    expect(findings[1]).toMatchObject({
      kind: 'price_drop',
      title: 'LEGO Batman',
      url: 'https://www.cheapshark.com/redirect?dealID=Dtzv5PHBf71720cIYjxx3oHvvZK3iHUbQjv6fWLVpd8%3D',
      payload: { source: 'cheapshark', itemId: '612', price: 2.99, normalPrice: 19.99, historicLow: 2.28, target: 3, store: 'WinGameStore' },
    });
  });

  it('writes the price in the key with two decimals, so $4 and $4.00 are one haunt', async () => {
    const catalog = [{ itemId: 'x', title: 'X', price: 4, currency: 'USD' as const, normalPrice: 10, historicLow: null, store: null, url: 'https://www.cheapshark.com/' }];
    const detector = createPriceDropsDetector({ source: createFixtureSource(catalog), watchlist: async () => [{ itemId: 'x', target: 5 }] });
    const [f] = await detector.poll({ fetch: fixtureFetch([]).fetch, now: () => NOW, signal: new AbortController().signal, log: silentLogger });
    expect(f!.key).toBe('fixture:x@4.00');
  });

  it('gives a further drop a new key, so it becomes a new haunt', async () => {
    const cheaper = recordedCheapSharkRoutes.map((r) =>
      String(r.match).includes('/games')
        ? { ...r, body: { ...(r.body as object), '612': { ...(r.body as Record<string, { deals: { price: string }[] }>)['612'], deals: [{ storeID: '21', dealID: 'Abc%3D', price: '1.99', retailPrice: '19.99' }] } } }
        : r,
    );
    const [, lego] = await poll(live(WATCH), cheaper);
    expect(lego!.key).toBe('cheapshark:612@1.99');
  });

  it('rates a price at its historic low as high, half off as medium', async () => {
    const findings = await poll(live([{ itemId: '612', target: 5 }, { itemId: '167910', target: 5 }]));
    expect(findings.map((f) => f.severity)).toEqual(['medium', 'medium']); // 85% off, above the historic low
    const fixture = await createPriceDropsDetector({ source: createFixtureSource(), watchlist: async () => DEMO_WATCHLIST }).poll({
      fetch: fixtureFetch([]).fetch,
      now: () => NOW,
      signal: new AbortController().signal,
      log: silentLogger,
    });
    expect(Object.fromEntries(fixture.map((f) => [f.payload.itemId, f.severity]))).toMatchObject({ 'hollow-knight': 'high', 'balatro': 'low' });
  });

  it('runs the demo watchlist on fixture prices with no network', async () => {
    const detector = createPriceDropsDetector({ source: createFixtureSource(), watchlist: async () => DEMO_WATCHLIST });
    const { findings, calls } = await assertDetectorContract(detector, { routes: [], now: NOW });
    expect(calls).toEqual([]);
    expect(findings.map((f) => f.payload.itemId)).toEqual([
      'hollow-knight', 'hades-2', 'celeste', 'outer-wilds', 'balatro', 'dead-cells', 'stardew-valley',
    ]); // disco-elysium is over its target
  });

  it('reports nothing for an empty watchlist, without calling the source', async () => {
    const { fetch, calls } = fixtureFetch([]);
    const findings = await live([]).poll({ fetch, now: () => NOW, signal: new AbortController().signal, log: silentLogger });
    expect(findings).toEqual([]);
    expect(calls).toEqual([]);
  });
});
