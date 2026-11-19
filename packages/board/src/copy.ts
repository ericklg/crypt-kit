import type { BoardCopy, ResolvedCopy, UiCopy } from './types.js';

/** English defaults for the board's built-in text. Override any of them with `BoardCopy.ui`. */
export const DEFAULT_UI_COPY: UiCopy = {
  listLabel: 'Haunts',
  was: 'was',
  severity: { low: 'Low priority', medium: 'Medium priority', high: 'High priority' },
  keysLabel: 'Keyboard shortcuts',
  keyMove: 'move',
  keyOpen: 'open',
  weeklyGoal: 'Weekly goal',
  keyEnter: 'Enter',
  goalReached: 'goal reached',
  goalProgress: '{score} of {goal} {scoreLabel}',
  openCount: '{count} {openLabel}',
  close: 'Close',
  found: 'What the AI found',
  why: 'Why this draft',
  drafting: 'Drafting',
  draftingHint: 'You can still press {spareLabel} while the draft is written.',
  waitingHint: 'You can still press {spareLabel}.',
  waitingNote: 'The AI hasn’t seen it yet, so nothing has been sent anywhere.',
  draftFailedTitle: 'No draft this time',
  draftFailedNote: 'Nothing was sent anywhere.',
  tryAgain: 'Try again',
  tryApproveAgain: 'Try {approve} again',
  actionFailedNote: 'The draft is kept, so you can fix the cause and try again.',
  stuckTitle: 'This may already have happened',
  stuckBody: 'You pressed {approveLabel}, but the result never came back. Check whether it actually happened, then tell us what you saw.',
  happened: 'It happened',
  didntHappen: 'It didn’t',
  unlocksIn: 'You can answer in {minutes} min, once the first try has timed out.',
  unlockPending: 'You can answer once the first try has timed out.',
  unlocked: 'You can answer now.',
  running: 'Running…',
  runDone: 'Done. The board is up to date.',
  runFailed: 'The run didn’t finish. Refresh to see the current state.',
  linkBlocked: 'Your browser blocked the new tab for {title}.',
  reviewRequested: 'Your assistant asked you to review this',
  reviewRequestedHint: 'Nothing happens until you press {approveLabel}.',
  openLink: 'Open it here',
  dismiss: 'Dismiss',
  unconfirmed: 'We couldn’t confirm what happened. Check the source and refresh before trying again.',
};

/** Fills `{name}` placeholders. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}

export function resolveCopy(copy: BoardCopy): ResolvedCopy {
  const { ui = {}, ...rest } = copy;
  const { severity, ...strings } = ui;
  return { ...rest, ui: { ...DEFAULT_UI_COPY, ...strings, severity: { ...DEFAULT_UI_COPY.severity, ...severity } } };
}
