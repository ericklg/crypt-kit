import type { Action } from '@crypt-kit/core';
import type { PriceDrop } from '../detectors/price-drops';

/** Hosts a deal link may point at, per source. CheapShark requires its own redirect links. */
const ALLOWED_HOSTS: Record<PriceDrop['source'], readonly string[]> = {
  cheapshark: ['www.cheapshark.com'],
  fixture: ['www.cheapshark.com'],
  bestbuy: ['www.bestbuy.com', 'api.bestbuy.com'],
};

/**
 * Hands the board the deal link to open in the user's browser (R7.5). It never fetches the
 * link (CheapShark's redirect blocks automated access) and never buys anything.
 */
export function createOpenDealAction(): Action<PriceDrop> {
  return {
    id: 'open-deal-link',
    async run(finding) {
      const { url, source } = finding.payload;
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return { ok: false, error: 'This deal has no valid link.' };
      }
      if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS[source].includes(parsed.hostname)) {
        return { ok: false, error: `This deal’s link doesn’t go to ${source === 'bestbuy' ? 'Best Buy' : 'CheapShark'}, so it wasn’t opened.` };
      }
      return { ok: true, message: 'Deal link opened.', url: parsed.href };
    },
  };
}
