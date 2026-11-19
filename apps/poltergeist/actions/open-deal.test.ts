import type { Finding } from '@crypt-kit/core';
import { describe, expect, it } from 'vitest';
import type { PriceDrop } from '../detectors/price-drops';
import { createOpenDealAction } from './open-deal';

const drop = (extra: Partial<PriceDrop> = {}): Finding<PriceDrop> => {
  const payload: PriceDrop = {
    source: 'cheapshark',
    itemId: '612',
    title: 'LEGO Batman',
    price: 2.99,
    currency: 'USD',
    normalPrice: 19.99,
    historicLow: 2.28,
    store: 'WinGameStore',
    target: 3,
    url: 'https://www.cheapshark.com/redirect?dealID=Dtzv5PHBf71720cIYjxx3oHvvZK3iHUbQjv6fWLVpd8%3D',
    ...extra,
  };
  return { key: 'cheapshark:612@2.99', kind: 'price_drop', severity: 'medium', title: payload.title, url: payload.url, payload, observedAt: '2026-11-19T12:00:00Z' };
};

const draft = { summary: 's', proposal: 'Buy now.', reasoning: 'r', options: {} };
const ctx = { signal: new AbortController().signal };

describe('open-deal action', () => {
  it('hands back the CheapShark redirect link and does nothing else', async () => {
    const original = globalThis.fetch;
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      return new Response();
    }) as typeof fetch;
    try {
      expect(await createOpenDealAction().run(drop(), draft, ctx)).toEqual({ ok: true, message: 'Deal link opened.', url: drop().payload.url });
      expect(fetched).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('refuses links that leave CheapShark or aren’t https', async () => {
    for (const url of ['https://evil.example/deal', 'http://www.cheapshark.com/redirect?dealID=x', 'https://www.cheapshark.com.evil.example/']) {
      expect(await createOpenDealAction().run(drop({ url }), draft, ctx)).toMatchObject({ ok: false });
    }
  });
});
