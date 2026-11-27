import type { BoardTheme } from '@crypt-kit/board';

/**
 * Price Poltergeist's look and words: mockup B (Graveyard), candle amber on plum-black
 * (mockups/board/board-mockups.html?view=b&theme=poltergeist).
 */
export function poltergeistTheme(watched: number, sourceName: string, noun: { one: string; many: string } = { one: 'game', many: 'games' }): BoardTheme {
  return {
    id: 'poltergeist',
    creature: 'flame',
    approveOpensLink: true,
    palette: {
      bg: '#120b10',
      bg2: '#170f15',
      surface: '#1e141b',
      surface2: '#281b24',
      line: '#3b2b36',
      ink: '#f6ecf2',
      muted: '#c4afbd',
      accent: '#ffb347',
      accentInk: '#2b1700',
      glow: 'rgba(255,179,71,.16)',
      warn: '#ffd27a',
      danger: '#ff9a8a',
      good: '#a9e58f',
    },
    copy: {
      name: 'Price Poltergeist',
      sub: `Price drops on ${watched} watched ${watched === 1 ? noun.one : noun.many} · ${sourceName}`,
      openLabel: 'rattling',
      scoreLabel: 'deals claimed this week',
      approve: 'Claim deal',
      approveHint: 'Nothing opens until you claim it. Nothing is ever bought.',
      approved: 'Deal opened in a new tab.',
      spare: 'Let it rest',
      spared: 'Resting. You’ll hear again if the price drops further.',
      run: 'Check prices',
      proposalLabel: 'Verdict',
      sourceLabel: 'View deal',
      actionFailedTitle: 'The deal didn’t open',
      waiting: 'Queued behind this run’s other verdicts. It’s next in line.',
      emptyTitle: 'Nothing is rattling',
      // Mockup B said "every hour"; Vercel Hobby crons run daily, so say what's true.
      emptyBody: `None of your ${noun.many} are under target. Prices are checked once a day, or when you press Check prices.`,
      status: {
        new: 'Waiting for a verdict',
        drafting: 'Consulting the spirits',
        drafted: 'Verdict ready',
        draft_failed: 'Verdict failed',
        approving: 'Check the store',
        approved: 'Claimed',
        action_failed: 'Couldn’t open',
        spared: 'Resting',
        resolved: 'Price went back up',
      },
      optionLabels: {},
    },
  };
}
