'use server';

import { BoardAccessError } from '@crypt-kit/board/server';
import { refresh } from 'next/cache';
import { isKnownItem, parseTarget } from '../config';
import { getConfig, getSource, getWatchlist } from '../crypt';
import { RateLimitError } from '../sources/cached-get';
import type { PriceQuote } from '../sources/price-source';
import { guard } from './guard';

/** Most games one watchlist holds: four CheapShark lookups per price check. */
const MAX_WATCHED = 100;
const MAX_QUERY = 100;
const SOURCE_TIMEOUT_MS = 15_000;

export interface WatchedGame {
  itemId: string;
  title: string;
  target: number;
  /** Today's price and store, when the source has them. */
  price: number | null;
  store: string | null;
}

export interface SearchHit {
  itemId: string;
  title: string;
  price: number;
  store: string | null;
  watching: boolean;
}

export type WatchlistResult = { ok: true; games: WatchedGame[] } | { ok: false; message: string };
export type SearchResult = { ok: true; hits: SearchHit[] } | { ok: false; message: string };

const sourceCtx = () => ({ fetch: globalThis.fetch, signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) });
const isId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 64;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Guards the call and turns expected failures into a message the drawer shows. */
async function gated<T extends { ok: true }>(body: () => Promise<T>): Promise<T | { ok: false; message: string }> {
  try {
    await guard();
    return await body();
  } catch (error) {
    if (error instanceof BoardAccessError) return { ok: false, message: error.message };
    if (error instanceof RateLimitError) return { ok: false, message: `${error.source} asked us to slow down. Try again in a minute.` };
    if (error instanceof Error && error.name === 'TimeoutError') return { ok: false, message: 'Prices took too long to load. Try again.' };
    throw error;
  }
}

/**
 * Stored entries with today's prices. Prices are best-effort: if the source fails (e.g. a
 * 429), the list still shows, with no prices, so a committed edit is never reported as
 * failed. Polls still fail loudly on source errors; that's the detector, not this.
 */
async function readGames(): Promise<WatchedGame[]> {
  const source = getSource();
  const entries = await getWatchlist().list(source.id);
  let quotes: PriceQuote[] = [];
  if (entries.length) {
    try {
      quotes = await source.quote(entries.map((e) => e.itemId), sourceCtx());
    } catch {
      quotes = [];
    }
  }
  const byId = new Map(quotes.map((q) => [q.itemId, q]));
  return entries.map((e) => {
    const q = byId.get(e.itemId);
    return {
      itemId: e.itemId,
      title: q?.title || e.title || `${capital(source.noun.one)} ${e.itemId}`,
      target: e.target,
      price: q?.price ?? null,
      store: q?.store ?? null,
    };
  });
}

/** The watched games with today's prices, for the drawer. */
export async function loadWatchlist(): Promise<WatchlistResult> {
  return gated(async () => ({ ok: true as const, games: await readGames() }));
}

/** Games matching a title, marked when already watched. Only runs for a typed query. */
export async function searchGames(query: string): Promise<SearchResult> {
  return gated(async () => {
    const q = typeof query === 'string' ? query.trim().slice(0, MAX_QUERY) : '';
    if (q.length < 2) return { ok: true as const, hits: [] };
    const source = getSource();
    const [hits, watched] = await Promise.all([
      source.search(q, sourceCtx()).catch((error: unknown) => {
        if (error instanceof RateLimitError) throw error;
        throw new BoardAccessError('Search isn’t available right now. Try again in a minute.');
      }),
      getWatchlist().list(source.id),
    ]);
    const ids = new Set(watched.map((w) => w.itemId));
    return {
      ok: true as const,
      hits: hits
        .filter((h) => isKnownItem(getConfig().source, h.itemId))
        .map((h) => ({ itemId: h.itemId, title: h.title, price: h.price, store: h.store, watching: ids.has(h.itemId) })),
    };
  });
}

/** Default target for a new game: 20% under today's price, to the cent. */
const defaultTarget = (q: PriceQuote) => Math.floor(q.price * 80) / 100;

/** Starts watching a game. The title and starting target come from the source, not the client. */
export async function watchGame(itemId: string): Promise<WatchlistResult> {
  return gated(async () => {
    const source = getSource();
    if (!isId(itemId) || !isKnownItem(getConfig().source, itemId)) throw new BoardAccessError(`That ${getSource().noun.one} can’t be watched.`);
    const list = getWatchlist();
    const watched = await list.list(source.id);
    if (!watched.some((w) => w.itemId === itemId)) {
      if (watched.length >= MAX_WATCHED) throw new BoardAccessError(`You can watch up to ${MAX_WATCHED} ${source.noun.many}. Remove one first.`);
      const [quote] = await source.quote([itemId], sourceCtx()).catch((error: unknown) => {
        if (error instanceof RateLimitError) throw error;
        throw new BoardAccessError(`Prices couldn’t be loaded, so the ${source.noun.one} wasn’t added. Try again in a minute.`);
      });
      if (!quote) throw new BoardAccessError(`That ${source.noun.one} has no price right now, so it can’t be watched.`);
      // add, not put: a request that raced another add must not reset a target set since.
      await list.add({ source: source.id, itemId, title: quote.title, target: defaultTarget(quote) });
      refresh();
    }
    return { ok: true as const, games: await readGames() };
  });
}

/** Changes a watched game's target, typed as dollars (e.g. "7.50"). */
export async function setTarget(itemId: string, target: string): Promise<WatchlistResult> {
  return gated(async () => {
    const value = typeof target === 'string' ? parseTarget(target) : null;
    if (!isId(itemId) || value === null) throw new BoardAccessError('Enter a price like 7.50, from 0 to 100,000.');
    if (!(await getWatchlist().setTarget(getSource().id, itemId, value))) throw new BoardAccessError(`That ${getSource().noun.one} isn’t on your watchlist any more.`);
    refresh();
    return { ok: true as const, games: await readGames() };
  });
}

/** Stops watching a game. Its open haunts resolve at the next price check. */
export async function unwatchGame(itemId: string): Promise<WatchlistResult> {
  return gated(async () => {
    if (isId(itemId) && (await getWatchlist().remove(getSource().id, itemId))) refresh();
    return { ok: true as const, games: await readGames() };
  });
}
