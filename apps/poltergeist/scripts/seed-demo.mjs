#!/usr/bin/env node
// Fills a local database with demo haunts in every state the board shows, through the real
// runner with a fake agent and fake action. No network, no model, nothing opened.
//   pnpm typecheck && CRYPT_DB_URL=file:/tmp/poltergeist-demo.db node apps/poltergeist/scripts/seed-demo.mjs
// Then start the app with the same CRYPT_DB_URL (the fixture source is the default).
import { createRunner, silentLogger } from '@crypt-kit/core';
import { createSqliteStore } from '@crypt-kit/store-sqlite';

const url = process.env.CRYPT_DB_URL;
if (!url?.startsWith('file:')) {
  console.error('Set CRYPT_DB_URL to a local file: database (e.g. file:/tmp/poltergeist-demo.db).');
  process.exit(1);
}

// Mirrors sources/fixture.ts and DEMO_WATCHLIST in config.ts.
const games = [
  ['hollow-knight', 'Hollow Knight', 7.49, 14.99, 7.49, 'Steam', 8],
  ['hades-2', 'Hades II', 22.49, 29.99, 19.99, 'Fanatical', 25],
  ['celeste', 'Celeste', 4.99, 19.99, 3.99, 'GOG', 5],
  ['outer-wilds', 'Outer Wilds', 9.99, 24.99, 7.99, 'Steam', 10],
  ['balatro', 'Balatro', 12.49, 14.99, 9.99, 'Steam', 13],
  ['dead-cells', 'Dead Cells', 9.99, 24.99, 9.99, 'Steam', 10],
  ['stardew-valley', 'Stardew Valley', 8.99, 14.99, 7.49, 'GOG', 9],
];
const findings = games.map(([itemId, title, price, normalPrice, historicLow, store, target]) => ({
  key: `fixture:${itemId}@${price.toFixed(2)}`,
  kind: 'price_drop',
  severity: price <= historicLow ? 'high' : price <= normalPrice * 0.5 ? 'medium' : 'low',
  title,
  url: 'https://www.cheapshark.com/',
  observedAt: new Date().toISOString(),
  payload: { source: 'fixture', itemId, title, price, currency: 'USD', normalPrice, historicLow, store, target, url: 'https://www.cheapshark.com/' },
}));

const verdicts = {
  'hollow-knight': ['At its all-time low and under your $8 target.', 'Buy now. $7.49 matches the lowest price recorded, so waiting is unlikely to save more.'],
  'hades-2': ['Under your target, but it has been cheaper before.', 'Wait. It has sold for $19.99 before, so a deeper sale is likely.'],
  'dead-cells': ['At its all-time low.', 'Buy now. $9.99 is the lowest price recorded.'],
  'stardew-valley': ['Under your target, $1.50 above its all-time low.', 'Buy now. It’s within about 20% of its all-time low and under your target.'],
};

const store = createSqliteStore({ url, tableName: 'poltergeist_haunts' });
const runner = createRunner({
  detector: { id: 'price-drops-fixture', payloadSchema: { safeParse: (v) => ({ success: true, data: v }) }, poll: async () => findings },
  store,
  // A clock that moves 1 ms per call, so haunts seen in one run keep the list's order.
  now: ((tick) => () => new Date(Date.now() + ++tick))(0),
  log: silentLogger,
  maxDraftsPerRun: 6, // leaves Stardew Valley waiting for a verdict
  agent: {
    draft: async (f) => {
      if (f.payload.itemId === 'outer-wilds') throw new Error('The model returned a verdict that didn’t pass validation.');
      const [summary, proposal] = verdicts[f.payload.itemId] ?? ['Under your target.', 'Buy now. It’s under your target.'];
      return { summary, proposal, reasoning: 'Compared with the historic low.', options: {} };
    },
  },
  action: {
    id: 'fake',
    run: async (f) =>
      f.payload.itemId === 'dead-cells'
        ? { ok: false, error: 'This deal’s link doesn’t go to CheapShark, so it wasn’t opened.' }
        : new Promise(() => {}), // Balatro: never answers, so it's left "approving"
  },
  actionTimeoutMs: 200,
  settleAfterMs: 8 * 60_000,
});

await runner.run();
await runner.approve('fixture:dead-cells@9.99');
await runner.approve('fixture:balatro@12.49');
// Celeste: left mid-verdict for an hour, as the runner's claim does (the drafting state).
const celeste = await store.get('fixture:celeste@4.99');
const at = new Date();
await store.put(
  { ...celeste, status: 'drafting', draft: null, error: null, claimExpiresAt: new Date(at.getTime() + 3_600_000).toISOString(), updatedAt: at.toISOString(), version: celeste.version + 1 },
  celeste.version,
);
console.log((await runner.list()).map((h) => `${h.key} ${h.status}`).join('\n'));
store.close();
