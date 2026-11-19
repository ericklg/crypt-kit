import type { PriceQuote, PriceSource } from './price-source';

/**
 * Fixed prices for the public demo and local development: no network, no rate limits.
 * Links go to CheapShark's home page, since these aren't real deals.
 */
export const FIXTURE_CATALOG: readonly PriceQuote[] = [
  { itemId: 'hollow-knight', title: 'Hollow Knight', price: 7.49, normalPrice: 14.99, historicLow: 7.49, store: 'Steam' },
  { itemId: 'hades-2', title: 'Hades II', price: 22.49, normalPrice: 29.99, historicLow: 19.99, store: 'Fanatical' },
  { itemId: 'celeste', title: 'Celeste', price: 4.99, normalPrice: 19.99, historicLow: 3.99, store: 'GOG' },
  { itemId: 'outer-wilds', title: 'Outer Wilds', price: 9.99, normalPrice: 24.99, historicLow: 7.99, store: 'Steam' },
  { itemId: 'balatro', title: 'Balatro', price: 12.49, normalPrice: 14.99, historicLow: 9.99, store: 'Steam' },
  { itemId: 'dead-cells', title: 'Dead Cells', price: 9.99, normalPrice: 24.99, historicLow: 9.99, store: 'Steam' },
  { itemId: 'stardew-valley', title: 'Stardew Valley', price: 8.99, normalPrice: 14.99, historicLow: 7.49, store: 'GOG' },
  { itemId: 'disco-elysium', title: 'Disco Elysium', price: 39.99, normalPrice: 39.99, historicLow: 9.99, store: 'Steam' },
].map((q) => ({ ...q, currency: 'USD' as const, url: 'https://www.cheapshark.com/' }));

export function createFixtureSource(catalog: readonly PriceQuote[] = FIXTURE_CATALOG): PriceSource {
  const byId = new Map(catalog.map((q) => [q.itemId, q]));
  return {
    id: 'fixture',
    name: 'demo prices',
    enabled: () => true,
    async quote(itemIds) {
      return itemIds.flatMap((id) => {
        const q = byId.get(id);
        return q ? [{ ...q }] : [];
      });
    },
    async search(query) {
      const q = query.trim().toLowerCase();
      return q ? catalog.filter((item) => item.title.toLowerCase().includes(q)).map((item) => ({ ...item })) : [];
    },
  };
}
