import { z } from 'zod';
import type { WatchItem } from './detectors/price-drops';
import { isCheapSharkGameId } from './sources/cheapshark';
import { FIXTURE_CATALOG } from './sources/fixture';

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
/** The detector's supported price range (`priceDropSchema`). */
export const MAX_TARGET = 100_000;

/** Whether the source can look this item up (so watching it can ever alert). */
export function isKnownItem(source: PoltergeistConfig['source'], itemId: string): boolean {
  return source === 'cheapshark' ? isCheapSharkGameId(itemId) : FIXTURE_CATALOG.some((q) => q.itemId === itemId);
}

/** A target as typed: dollars with at most two decimals, from 0 to MAX_TARGET. */
export function parseTarget(input: string): number | null {
  const s = input.trim().replace(/^\$/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n >= 0 && n <= MAX_TARGET ? n : null;
}

/** `612:8, 128:5.5` → watch items. Targets are USD. */
const watchlist = z
  .string()
  .transform((s, ctx) => {
    const items: WatchItem[] = [];
    for (const part of s.split(',').map((p) => p.trim()).filter(Boolean)) {
      const fields = part.split(':').map((x) => x.trim());
      const [itemId = '', target = ''] = fields;
      const price = parseTarget(target);
      if (fields.length !== 2 || !ITEM.test(itemId) || price === null || target.startsWith('$')) {
        ctx.addIssue({ code: 'custom', message: `"${part.slice(0, 40)}" isn't itemId:targetPrice with a target from 0 to ${MAX_TARGET}` });
        return z.NEVER;
      }
      if (items.some((i) => i.itemId === itemId)) {
        ctx.addIssue({ code: 'custom', message: `"${itemId}" is listed twice` });
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
  // IDs the source can't look up would be skipped silently, so the alert would never fire.
  const list = e.POLTERGEIST_WATCHLIST ?? DEMO_WATCHLIST;
  const unknown = list.filter((i) => !isKnownItem(e.POLTERGEIST_SOURCE, i.itemId)).map((i) => i.itemId.slice(0, 40));
  if (unknown.length) {
    const what = e.POLTERGEIST_SOURCE === 'cheapshark' ? 'CheapShark game IDs are 1–10 digits' : 'the fixture source has no such games';
    throw new ConfigError(`Price Poltergeist is misconfigured: POLTERGEIST_WATCHLIST: ${what}: ${unknown.join(', ')}`);
  }
  return {
    source: e.POLTERGEIST_SOURCE,
    watchlist: list,
    cheapsharkContact: e.CHEAPSHARK_CONTACT ?? null,
    boardPassword: e.CRYPT_BOARD_PASSWORD ?? null,
    publicDemo: e.CRYPT_PUBLIC_DEMO !== undefined,
    cronSecret: e.CRON_SECRET ?? null,
  };
}
