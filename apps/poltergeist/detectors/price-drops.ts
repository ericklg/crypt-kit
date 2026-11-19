import type { Detector, Finding, Severity } from '@crypt-kit/core';
import { z } from 'zod';
import type { PriceSource } from '../sources/price-source';

/** One watched item: tell me when it's at or under `target`. */
export interface WatchItem {
  itemId: string;
  /** Target price in USD. */
  target: number;
}

const price = z.number().nonnegative().max(100_000);

/** Everything here describes this exact price, so the same drop always hashes the same. */
export const priceDropSchema = z.object({
  source: z.enum(['fixture', 'cheapshark', 'bestbuy']),
  itemId: z.string().min(1).max(64),
  title: z.string(),
  price,
  currency: z.literal('USD'),
  normalPrice: price.nullable(),
  historicLow: price.nullable(),
  store: z.string().nullable(),
  target: price,
  url: z.url({ protocol: /^https$/ }),
});

export type PriceDrop = z.infer<typeof priceDropSchema>;

/** Two decimals, so float noise can't change a key. */
const cents = (n: number) => n.toFixed(2);

function severityFor(q: { price: number; normalPrice: number | null; historicLow: number | null }): Severity {
  if (q.historicLow !== null && q.price <= q.historicLow) return 'high';
  if (q.normalPrice !== null && q.normalPrice > 0 && q.price <= q.normalPrice * 0.5) return 'medium';
  return 'low';
}

export interface PriceDropsOptions {
  source: PriceSource;
  /** Read on every poll, so watchlist edits apply on the next run. */
  watchlist: () => Promise<readonly WatchItem[]>;
}

/**
 * A finding for each watched item whose current price is at or under its target (R7.2),
 * keyed `<source>:<itemId>@<price>` so a further drop is a new haunt (R7.3). When the price
 * goes back up, the item stops being reported and its haunt resolves.
 */
export function createPriceDropsDetector({ source, watchlist }: PriceDropsOptions): Detector<PriceDrop> {
  return {
    id: `price-drops-${source.id}`,
    payloadSchema: priceDropSchema,
    async poll(ctx) {
      const items = await watchlist();
      if (!items.length) return [];
      const targets = new Map(items.map((i) => [i.itemId, i.target]));
      const quotes = await source.quote([...targets.keys()], { fetch: ctx.fetch, signal: ctx.signal });
      const observedAt = ctx.now().toISOString();

      const findings: Finding<PriceDrop>[] = [];
      for (const q of quotes) {
        const target = targets.get(q.itemId);
        if (target === undefined || q.price > target) continue;
        findings.push({
          key: `${source.id}:${q.itemId}@${cents(q.price)}`,
          kind: 'price_drop',
          severity: severityFor(q),
          title: q.title,
          url: q.url,
          observedAt,
          payload: {
            source: source.id,
            itemId: q.itemId,
            title: q.title,
            price: q.price,
            currency: q.currency,
            normalPrice: q.normalPrice,
            historicLow: q.historicLow,
            store: q.store,
            target,
            url: q.url,
          },
        });
      }
      return findings;
    },
  };
}
