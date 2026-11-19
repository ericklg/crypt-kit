import { z } from 'zod';
import type { WatchItem } from './detectors/price-drops';

/** The demo watchlist for the fixture source: mockup B's games, one of them not on sale. */
export const DEMO_WATCHLIST: readonly WatchItem[] = [
  { itemId: 'hollow-knight', target: 8 },
  { itemId: 'hades-2', target: 25 },
  { itemId: 'celeste', target: 5 },
  { itemId: 'outer-wilds', target: 10 },
  { itemId: 'balatro', target: 13 },
  { itemId: 'dead-cells', target: 10 },
  { itemId: 'stardew-valley', target: 9 },
  { itemId: 'disco-elysium', target: 15 },
];

const ITEM = /^[A-Za-z0-9-]{1,64}$/;

/** `612:8, 128:5.5` → watch items. Targets are USD. */
const watchlist = z
  .string()
  .transform((s, ctx) => {
    const items: WatchItem[] = [];
    for (const part of s.split(',').map((p) => p.trim()).filter(Boolean)) {
      const [itemId = '', target = ''] = part.split(':').map((x) => x.trim());
      const price = Number(target);
      if (!ITEM.test(itemId) || !/^\d+(\.\d{1,2})?$/.test(target) || !(price >= 0)) {
        ctx.addIssue({ code: 'custom', message: `"${part.slice(0, 40)}" isn't itemId:targetPrice` });
        return z.NEVER;
      }
      items.push({ itemId, target: price });
    }
    if (!items.length) ctx.addIssue({ code: 'custom', message: 'list at least one itemId:targetPrice' });
    return items;
  });

const envSchema = z.object({
  /** `fixture` (default: demo prices, no network) or `cheapshark` (live). */
  POLTERGEIST_SOURCE: z.enum(['fixture', 'cheapshark']).default('fixture'),
  /** `gameId:target` pairs. Required for cheapshark; defaults to DEMO_WATCHLIST for fixture. */
  POLTERGEIST_WATCHLIST: watchlist.optional(),
  /** Added to the User-Agent CheapShark sees, e.g. an email (see steering/price-sources.md). */
  CHEAPSHARK_CONTACT: z.string().max(100).optional(),
  CRYPT_BOARD_PASSWORD: z.string().min(12).optional(),
  CRYPT_PUBLIC_DEMO: z.enum(['1', 'true']).optional(),
  CRON_SECRET: z.string().min(16).optional(),
});

export interface PoltergeistConfig {
  source: 'fixture' | 'cheapshark';
  watchlist: readonly WatchItem[];
  cheapsharkContact: string | null;
  boardPassword: string | null;
  publicDemo: boolean;
  cronSecret: string | null;
}

/** A missing or invalid env var. Its message names variables, never their values. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export function loadConfig(env: Record<string, string | undefined> = process.env): PoltergeistConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Price Poltergeist is misconfigured: ${problems}`);
  }
  const e = parsed.data;
  if (e.POLTERGEIST_SOURCE === 'cheapshark' && !e.POLTERGEIST_WATCHLIST) {
    throw new ConfigError('Price Poltergeist is misconfigured: POLTERGEIST_WATCHLIST: required when POLTERGEIST_SOURCE is cheapshark');
  }
  return {
    source: e.POLTERGEIST_SOURCE,
    watchlist: e.POLTERGEIST_WATCHLIST ?? DEMO_WATCHLIST,
    cheapsharkContact: e.CHEAPSHARK_CONTACT ?? null,
    boardPassword: e.CRYPT_BOARD_PASSWORD ?? null,
    publicDemo: e.CRYPT_PUBLIC_DEMO !== undefined,
    cronSecret: e.CRON_SECRET ?? null,
  };
}
