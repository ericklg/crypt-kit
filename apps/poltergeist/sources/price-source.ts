/** A source's current price for one item. Prices are in `currency` units (e.g. 7.49). */
export interface PriceQuote {
  itemId: string;
  title: string;
  price: number;
  currency: 'USD';
  /** The usual (retail) price, when the source has one. */
  normalPrice: number | null;
  /** The lowest price the source has recorded, when it has one (R7.4). */
  historicLow: number | null;
  /** Where the price is, e.g. "Steam". */
  store: string | null;
  /** Where to send the user, in the form the source's terms require (R7.5). */
  url: string;
}

/** I/O for one call, injected so polls stay testable (detector rule 6). */
export interface SourceContext {
  fetch: typeof globalThis.fetch;
  signal: AbortSignal;
}

export type SourceId = 'fixture' | 'cheapshark' | 'bestbuy';

/** Where prices come from. See .kiro/steering/price-sources.md for each source's terms. */
export interface PriceSource {
  id: SourceId;
  /** Display name, e.g. "CheapShark". */
  name: string;
  /** False when the source needs config that isn't set (e.g. an API key). */
  enabled(): boolean;
  /** Current prices for these items. Items the source doesn't know are left out. */
  quote(itemIds: readonly string[], ctx: SourceContext): Promise<PriceQuote[]>;
  /** Items matching a title, for adding to the watchlist. Only call it for a user's query. */
  search(query: string, ctx: SourceContext): Promise<PriceQuote[]>;
}
