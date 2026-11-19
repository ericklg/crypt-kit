import type { Presenter } from '@crypt-kit/board';
import type { PriceDrop } from './detectors/price-drops';

const usd = (n: number) => `$${n.toFixed(2)}`;
const SOURCE_NAMES: Record<PriceDrop['source'], string> = { cheapshark: 'CheapShark', fixture: 'demo prices', bestbuy: 'Best Buy' };

function ago(from: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** How a price drop reads on its stone and in the drawer (mockup B). Runs on the server. */
export const priceDropPresenter: Presenter<PriceDrop> = {
  meta: (f) => `${f.payload.store ?? 'Best price'} · via ${SOURCE_NAMES[f.payload.source]}`,
  // A new key means a new price, so first seen is when it dropped to this price.
  age: (_f, now, firstSeenAt) => `dropped ${ago(new Date(firstSeenAt), now)}`,
  headline: (f) => {
    const p = f.payload;
    return p.normalPrice !== null && p.normalPrice > p.price ? { value: usd(p.price), was: usd(p.normalPrice) } : { value: usd(p.price) };
  },
  facts: (f) => {
    const p = f.payload;
    return [
      { label: 'Now', value: usd(p.price), tone: 'good' as const },
      ...(p.normalPrice !== null && p.normalPrice > p.price ? [{ label: 'Was', value: usd(p.normalPrice), tone: 'strike' as const }] : []),
      ...(p.historicLow !== null ? [{ label: 'All-time low', value: usd(p.historicLow) }] : []),
      { label: 'Your target', value: usd(p.target) },
    ];
  },
};
