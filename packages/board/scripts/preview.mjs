#!/usr/bin/env node
// Renders the built board with the mockup's sample data to a static HTML file, for
// screenshots and comparison against mockups/board/board-mockups.html?view=b.
//   pnpm --filter @crypt-kit/board build && node packages/board/scripts/preview.mjs <out.html> [openKey]
// No hydration: this shows the board's initial render only.
import { readFileSync, writeFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Board } from '../dist/index.js';

const [out, openKey] = process.argv.slice(2);
if (!out) {
  console.error('usage: preview.mjs <out.html> [openKey]');
  process.exit(1);
}

const theme = {
  id: 'exorcist',
  creature: 'ghost',
  motion: 'reduced',
  palette: {
    bg: '#0b0e14', bg2: '#0f131b', surface: '#151a24', surface2: '#1c2230', line: '#2a3243', ink: '#e9eef7',
    muted: '#a3adc0', accent: '#8ef0d8', accentInk: '#062720', glow: 'rgba(142,240,216,.16)', warn: '#ffd27a',
    danger: '#ff9a8a', good: '#9be7a6',
  },
  copy: {
    name: 'Exorcist', sub: 'acme/lantern, acme/ember', openLabel: 'haunting', scoreLabel: 'banished this week',
    approve: 'Banish', approveHint: 'Nothing is posted until you banish.', approved: 'Banished. Comment posted.',
    spare: 'Spare', spared: 'Spared.', run: 'Summon', proposalLabel: 'Comment to post', sourceLabel: 'Open on GitHub',
    actionFailedTitle: 'The comment wasn’t posted', waiting: 'This run reached its limit of 20 drafts. It’s first in line for the next run at 8:00 PM.',
    emptyTitle: 'All quiet in the crypt', emptyBody: 'No stale issues or pull requests.',
    status: {
      new: 'Waiting for a draft', drafting: 'Summoning a draft', drafted: 'Ready to banish', draft_failed: 'Draft failed',
      approving: 'Check GitHub', approved: 'Banished', action_failed: 'Banish failed', spared: 'Spared', resolved: 'Laid to rest',
    },
    optionLabels: { close: 'Close the issue after commenting' },
  },
};

const v = (key, status, severity, title, meta, age, facts, extra = {}) => ({
  key, revision: 1, draftId: extra.draft ? key : null, status, severity, title, meta, age, url: `https://github.com/${key.replace('#', '/issues/')}`,
  facts: facts.map(([label, value]) => ({ label, value })), headline: null, draft: null, error: null, claimExpiresAt: null, ...extra,
});

const haunts = [
  v('acme/lantern#214', 'drafted', 'high', 'Crash when the config file is empty', 'acme/lantern · issue #214', '41 days quiet',
    [['Comments', '3'], ['Last reply', '@mira'], ['Labels', 'bug']],
    { draft: { summary: 'The reporter posted a clear repro 41 days ago and nobody has answered.', proposal: 'Thanks for the repro, @mira. I can reproduce this on 2.4.1: an empty config makes the loader throw before defaults apply. Could you confirm it still happens on 2.5.0? If it does, I’ll pick it up this week.', reasoning: 'Clear repro, no maintainer reply, and probably still valid.', options: { close: false } } }),
  v('acme/lantern#198', 'drafted', 'low', 'Docs: wrong flag name in the quickstart', 'acme/lantern · issue #198', '63 days quiet', [['Comments', '1']],
    { draft: { summary: 'Already fixed in #205.', proposal: 'This was fixed in #205 and released in 2.5.0, so I’m closing it.', reasoning: 'The linked PR changed the exact line.', options: { close: true } } }),
  v('acme/lantern#231', 'drafting', 'medium', 'Add retries to the webhook sender', 'acme/lantern · pull request #231', '35 days quiet', []),
  v('acme/ember#77', 'draft_failed', 'medium', 'Paths with spaces break on Windows', 'acme/ember · issue #77', '90 days quiet', [], { error: 'The model didn’t answer within 115 seconds.' }),
  v('acme/ember#64', 'approving', 'medium', 'Support Node 26', 'acme/ember · pull request #64', '30 days quiet', [], { claimExpiresAt: '2026-11-18T19:58:00.000Z' }),
  v('acme/ember#81', 'action_failed', 'low', 'Typo in the timeout error message', 'acme/ember · issue #81', '33 days quiet', [],
    { error: 'GitHub returned 403: the token can’t comment on acme/ember.', draft: { summary: 'A one-word typo nobody has picked up.', proposal: 'Thanks for spotting this!', reasoning: 'Small and clear.', options: { close: false } } }),
  v('acme/lantern#240', 'new', 'medium', 'Flaky test on macOS runners', 'acme/lantern · issue #240', '31 days quiet', []),
];

const noop = async () => ({ ok: true });
const actions = { approve: noop, spare: noop, redraft: noop, settle: noop, run: noop };
const css = readFileSync(new URL('../src/board.css', import.meta.url), 'utf8');
const body = renderToStaticMarkup(
  createElement(Board, { theme, haunts, score: 12, weeklyGoal: 20, actions, now: '2026-11-18T19:50:00.000Z', ...(openKey ? { defaultOpenKey: openKey } : {}) }),
);
writeFileSync(out, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}${css}</style></head><body>${body}</body></html>`);
console.log(`wrote ${out}`);
