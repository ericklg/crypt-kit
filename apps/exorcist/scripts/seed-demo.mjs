#!/usr/bin/env node
// Fills a local database with demo haunts in every state the board shows, through the real
// runner with a fake agent and fake actions. No network, no model, nothing posted.
//   pnpm typecheck && CRYPT_DB_URL=file:/tmp/exorcist-demo.db node apps/exorcist/scripts/seed-demo.mjs
// Then start the app with the same CRYPT_DB_URL and EXORCIST_REPOS=acme/lantern,acme/ember.
import { createRunner, silentLogger } from '@crypt-kit/core';
import { createSqliteStore } from '@crypt-kit/store-sqlite';

const url = process.env.CRYPT_DB_URL;
if (!url?.startsWith('file:')) {
  console.error('Set CRYPT_DB_URL to a local file: database (e.g. file:/tmp/exorcist-demo.db).');
  process.exit(1);
}

const now = Date.now();
const daysAgo = (d) => new Date(now - d * 86_400_000).toISOString();
const item = (repo, number, kind, title, quietDays, extra = {}) => ({
  key: `${repo}#${number}`,
  kind,
  severity: quietDays >= 90 ? 'high' : quietDays >= 60 ? 'medium' : 'low',
  title,
  url: `https://github.com/${repo}/${kind === 'pull_request' ? 'pull' : 'issues'}/${number}`,
  observedAt: new Date(now).toISOString(),
  payload: {
    repo, number, kind, title, author: 'mira', labels: [], comments: 0,
    createdAt: daysAgo(quietDays + 10), updatedAt: daysAgo(quietDays), body: '', lastComments: [], ...extra,
  },
});

const findings = [
  item('acme/lantern', 214, 'issue', 'Crash when the config file is empty', 41, {
    labels: ['bug'], comments: 3,
    lastComments: [{ author: 'mira', body: 'Any update?', createdAt: daysAgo(41) }],
  }),
  item('acme/lantern', 198, 'issue', 'Docs: wrong flag name in the quickstart', 63, { comments: 1 }),
  item('acme/ember', 77, 'issue', 'Paths with spaces break on Windows', 90),
  item('acme/ember', 64, 'pull_request', 'Support Node 26', 30),
  item('acme/ember', 81, 'issue', 'Typo in the timeout error message', 33),
  item('acme/lantern', 240, 'issue', 'Flaky test on macOS runners', 31),
];

const drafts = {
  'acme/lantern#214': {
    summary: 'The reporter posted a clear repro 41 days ago and nobody has answered.',
    proposal: 'Thanks for the repro, @mira. Could you confirm it still happens on 2.5.0? If it does, I’ll look at the loader’s handling of empty files.',
    reasoning: 'Clear repro, no maintainer reply, and probably still valid.',
    options: { close: false },
  },
  'acme/lantern#198': {
    summary: 'The quickstart flag was renamed in #205.',
    proposal: 'This was fixed in #205, so I’m closing it. Reopen it if the quickstart still shows the old flag.',
    reasoning: 'The linked PR changed the exact line.',
    options: { close: true },
  },
};

const store = createSqliteStore({ url, tableName: 'exorcist_haunts' });
const base = {
  detector: { id: 'github-stale-items', payloadSchema: { safeParse: (v) => ({ success: true, data: v }) }, poll: async () => findings },
  store,
  log: silentLogger,
  maxDraftsPerRun: 5, // leaves #240 waiting for a draft
};
const seeding = createRunner({
  ...base,
  agent: {
    draft: async (f) => {
      if (f.key === 'acme/ember#77') throw new Error('The model didn’t answer in time.');
      return drafts[f.key] ?? { summary: 'Quiet for a while.', proposal: 'Is this still needed?', reasoning: 'No replies.', options: { close: false } };
    },
  },
  action: {
    id: 'fake',
    run: async (f) =>
      f.key === 'acme/ember#81'
        ? { ok: false, error: 'GitHub returned 403: the token can’t comment on acme/ember.' }
        : new Promise(() => {}), // #64: never answers, so it is left "approving"
  },
  actionTimeoutMs: 200,
  settleAfterMs: 8 * 60_000,
});

await seeding.run();
await seeding.approve('acme/ember#81');
await seeding.approve('acme/ember#64');
const statuses = (await seeding.list()).map((h) => `${h.key} ${h.status}`);
console.log(statuses.join('\n'));
store.close();
