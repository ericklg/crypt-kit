import type { BoardTheme } from '@crypt-kit/board';

/**
 * Exorcist's look and words: mockup B (Graveyard), spectral cyan on near-black
 * (mockups/board/board-mockups.html?view=b). `repos` is shown under the name.
 */
export function exorcistTheme(repos: readonly string[]): BoardTheme {
  return {
    id: 'exorcist',
    creature: 'ghost',
    palette: {
      bg: '#0b0e14',
      bg2: '#0f131b',
      surface: '#151a24',
      surface2: '#1c2230',
      line: '#2a3243',
      ink: '#e9eef7',
      muted: '#a3adc0',
      accent: '#8ef0d8',
      accentInk: '#062720',
      glow: 'rgba(142,240,216,.16)',
      warn: '#ffd27a',
      danger: '#ff9a8a',
      good: '#9be7a6',
    },
    copy: {
      name: 'Exorcist',
      sub: repos.join(', '),
      openLabel: 'haunting',
      scoreLabel: 'banished this week',
      approve: 'Banish',
      approveHint: 'Nothing is posted until you banish.',
      approved: 'Banished. Comment posted.',
      spare: 'Spare',
      spared: 'Spared.',
      run: 'Summon',
      proposalLabel: 'Comment to post',
      sourceLabel: 'Open on GitHub',
      // Not "the comment wasn't posted": the comment may have landed before the close failed.
      actionFailedTitle: 'Banishing didn’t finish',
      waiting: 'This run reached its draft limit. It’s first in line for the next run.',
      emptyTitle: 'All quiet in the crypt',
      emptyBody: 'No stale issues or pull requests.',
      status: {
        new: 'Waiting for a draft',
        drafting: 'Summoning a draft',
        drafted: 'Ready to banish',
        draft_failed: 'Draft failed',
        approving: 'Check GitHub',
        approved: 'Banished',
        action_failed: 'Banish failed',
        spared: 'Spared',
        resolved: 'Laid to rest',
      },
      optionLabels: { close: 'Close it after commenting' },
    },
  };
}
