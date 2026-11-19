import type { Finding } from '@crypt-kit/core';
import type { PriceDrop } from './detectors/price-drops';

/** What a good verdict looks like (R7.4). The kit appends its untrusted-input rules. */
export const VERDICT_INSTRUCTIONS = `
You help someone decide whether to buy a PC game now or wait. Each finding is one game
they're watching whose price just reached their target. Give a buy-or-wait verdict.

In "proposal", start with "Buy now." or "Wait." and follow with one or two short
sentences of plain reasoning the person can check against the numbers given:
- Compare the price with the historic low when there is one. At or near it (within about
  10%) usually means buy; well above it means a deeper sale has happened before.
- Mention the saving against the normal price only when it helps.
- Don't invent sale dates, upcoming discounts, reviews or anything not in the finding.
  If the numbers don't settle it, say so and lean toward buying, since it's already
  under their target.

In "summary", say in one sentence where the price stands, e.g. "At its all-time low and
under your $8 target."
`.trim();

/** What the model sees: the prices and target, nothing about the person or other games. */
export function describePriceDrop(finding: Finding<PriceDrop>): unknown {
  const p = finding.payload;
  const savings = p.normalPrice && p.normalPrice > 0 ? Math.round((1 - p.price / p.normalPrice) * 100) : null;
  return {
    game: p.title,
    store: p.store,
    currency: p.currency,
    price: p.price,
    normalPrice: p.normalPrice,
    percentOffNormal: savings,
    historicLow: p.historicLow,
    target: p.target,
    priceSource: p.source === 'fixture' ? 'demo data' : p.source,
  };
}
