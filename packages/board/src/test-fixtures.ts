import type { BoardActions, BoardTheme, HauntView } from './types.js';

export const theme: BoardTheme = {
  id: 'exorcist',
  creature: 'ghost',
  motion: 'reduced',
  palette: {
    bg: '#0b0e14', bg2: '#0f131b', surface: '#151a24', surface2: '#1c2230', line: '#2a3243', ink: '#e9eef7',
    muted: '#a3adc0', accent: '#8ef0d8', accentInk: '#062720', glow: 'rgba(142,240,216,.16)', warn: '#ffd27a',
    danger: '#ff9a8a', good: '#9be7a6',
  },
  copy: {
    name: 'Exorcist', sub: 'acme/lantern', openLabel: 'haunting', scoreLabel: 'banished this week',
    approve: 'Banish', approveHint: 'Nothing is posted until you banish.', approved: 'Banished. Comment posted.',
    spare: 'Spare', spared: 'Spared.', run: 'Summon', proposalLabel: 'Comment to post', sourceLabel: 'Open on GitHub',
    actionFailedTitle: 'The comment wasn’t posted', waiting: 'First in line for the next run.',
    emptyTitle: 'All quiet in the crypt', emptyBody: 'No stale issues.',
    status: {
      new: 'Waiting for a draft', drafting: 'Summoning a draft', drafted: 'Ready to banish', draft_failed: 'Draft failed',
      approving: 'Check GitHub', approved: 'Banished', action_failed: 'Banish failed', spared: 'Spared', resolved: 'Laid to rest',
    },
    optionLabels: { close: 'Close the issue after commenting' },
  },
};

const base = { severity: 'medium' as const, facts: [], headline: null, error: null, claimExpiresAt: null, url: 'https://github.com/acme/lantern/issues/1' };
const draft = (proposal: string, close = false) => ({ summary: `Summary for ${proposal}`, proposal, reasoning: 'Because.', options: { close } });

export function views(): HauntView[] {
  return [
    { ...base, key: 'a#1', status: 'drafted', title: 'Crash on empty config', meta: 'acme/lantern · issue #1', age: '41 days quiet', draft: draft('Comment one') },
    { ...base, key: 'a#2', status: 'drafted', title: 'Wrong flag in docs', meta: 'acme/lantern · issue #2', age: '63 days quiet', draft: draft('Comment two', true) },
    { ...base, key: 'a#3', status: 'drafted', title: 'Webhook retries', meta: 'acme/lantern · pull request #3', age: '35 days quiet', draft: draft('Comment three') },
    { ...base, key: 'a#4', status: 'action_failed', title: 'Typo in error', meta: 'acme/ember · issue #4', age: '33 days quiet', draft: draft('Comment four'), error: 'GitHub returned 403.' },
    { ...base, key: 'a#5', status: 'new', title: 'Flaky test', meta: 'acme/lantern · issue #5', age: '31 days quiet', draft: null },
    { ...base, key: 'a#6', status: 'approving', title: 'Support Node 26', meta: 'acme/ember · pull request #6', age: '30 days quiet', draft: null, claimExpiresAt: '2026-11-18T12:10:00.000Z' },
  ];
}

export function fakeActions(overrides: Partial<BoardActions> = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const ok = async () => ({ ok: true as const });
  const record =
    (name: string, impl: (...args: never[]) => ReturnType<BoardActions['run']>) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return (impl as (...a: unknown[]) => ReturnType<BoardActions['run']>)(...args);
    };
  const actions: BoardActions = {
    approve: record('approve', overrides.approve ?? ok) as BoardActions['approve'],
    spare: record('spare', overrides.spare ?? ok) as BoardActions['spare'],
    redraft: record('redraft', overrides.redraft ?? ok) as BoardActions['redraft'],
    settle: record('settle', overrides.settle ?? ok) as BoardActions['settle'],
    run: record('run', overrides.run ?? ok) as BoardActions['run'],
  };
  return { actions, calls };
}
