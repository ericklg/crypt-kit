import type { HauntStatus, Severity } from '@crypt-kit/core';

/** Built-in creature icons. Each app picks one for its haunts. */
export type Creature = 'ghost' | 'flame';

/** Colour tokens. Board sets them as CSS custom properties (`--ck-bg`, ...). */
export interface Palette {
  bg: string;
  bg2: string;
  surface: string;
  surface2: string;
  line: string;
  ink: string;
  muted: string;
  accent: string;
  /** Text colour on accent backgrounds (primary buttons). */
  accentInk: string;
  /** Soft accent glow, usually the accent at ~16% alpha. */
  glow: string;
  warn: string;
  danger: string;
  good: string;
}

/** Every user-facing string the board shows, so each app can speak its own language. */
export interface BoardCopy {
  name: string;
  sub: string;
  /** "haunting", "rattling": label under the open count. */
  openLabel: string;
  /** "banished this week". */
  scoreLabel: string;
  /** Primary action verb, e.g. "Banish", "Claim deal". */
  approve: string;
  /** Shown next to the approve button, e.g. "Nothing is posted until you banish." */
  approveHint: string;
  /** Toast after a successful approve. */
  approved: string;
  spare: string;
  spared: string;
  /** Button that starts a run, e.g. "Summon". */
  run: string;
  /** Label above the editable proposal, e.g. "Comment to post". */
  proposalLabel: string;
  /** Link text to the item's source, e.g. "Open on GitHub". */
  sourceLabel: string;
  actionFailedTitle: string;
  /** Shown on haunts still waiting for a draft. */
  waiting: string;
  emptyTitle: string;
  emptyBody: string;
  /** Status pill text per haunt status. */
  status: Record<HauntStatus, string>;
  /** Labels for the draft's yes/no options, by option key. */
  optionLabels: Record<string, string>;
  /** Any of the board's built-in interface text, overriding `DEFAULT_UI_COPY`. */
  ui?: UiCopyOverrides;
}

/** Overrides for `UiCopy`; severity labels can be overridden one at a time. */
export type UiCopyOverrides = Partial<Omit<UiCopy, 'severity'>> & { severity?: Partial<Record<Severity, string>> };

/**
 * The board's built-in interface text. `{approve}`, `{spare}` and `{minutes}` are filled in.
 * Every string the board renders comes from here or from `BoardCopy`.
 */
export interface UiCopy {
  /** Accessible name of the list of stones. */
  listLabel: string;
  /** Severity tag in the drawer. */
  severity: Record<Severity, string>;
  keysLabel: string;
  keyMove: string;
  keyOpen: string;
  weeklyGoal: string;
  /** "{score} of {goal} {scoreLabel}" with ", goal reached" appended when over. */
  goalReached: string;
  of: string;
  close: string;
  found: string;
  why: string;
  drafting: string;
  draftingHint: string;
  waitingHint: string;
  waitingNote: string;
  draftFailedTitle: string;
  draftFailedNote: string;
  tryAgain: string;
  tryApproveAgain: string;
  actionFailedNote: string;
  stuckTitle: string;
  stuckBody: string;
  happened: string;
  didntHappen: string;
  unlocksIn: string;
  unlockPending: string;
  unlocked: string;
  running: string;
  runDone: string;
  runFailed: string;
  /** Shown when a request fails in transit: the server may or may not have acted. */
  unconfirmed: string;
}

/** BoardCopy with every UI string resolved, as the client components receive it. */
export type ResolvedCopy = Omit<BoardCopy, 'ui'> & { ui: UiCopy };

/** The theme contract: the only way an app restyles the board (see .kiro/steering/ui.md). */
export interface BoardTheme {
  id: string;
  creature: Creature;
  palette: Palette;
  copy: BoardCopy;
  /** `reduced` turns animations off regardless of the OS setting. Default `full`. */
  motion?: 'full' | 'reduced';
}

export interface HauntFact {
  label: string;
  value: string;
  tone?: 'good' | 'strike';
}

/**
 * What the board needs to show one haunt. Built on the server with `toHauntView`, so the
 * finding's payload and other internals never reach the client.
 */
export interface HauntView {
  key: string;
  /** The haunt's version. A key that comes back after being acted on has a newer one. */
  revision: number;
  /** Changes whenever the agent writes a new draft; edits are kept per draft. Null without a draft. */
  draftId: string | null;
  status: HauntStatus;
  severity: Severity;
  title: string;
  /** e.g. "acme/lantern · issue #214". */
  meta: string;
  /** e.g. "41 days quiet". */
  age: string;
  url: string | null;
  facts: HauntFact[];
  /** Optional big number on the stone, e.g. a price, with the old value struck through. */
  headline: { value: string; was?: string } | null;
  draft: { summary: string; proposal: string; reasoning: string; options: Record<string, boolean> } | null;
  error: string | null;
  /**
   * For `approving` haunts: when settling unlocks (ISO), resolved the same way the runner
   * does. Null means unknown, and the board keeps settling locked.
   */
  claimExpiresAt: string | null;
}

export type ActionOutcome = { ok: true } | { ok: false; message: string };

export interface ApproveEdits {
  proposal: string;
  options: Record<string, boolean>;
}

/**
 * Server actions the board calls. Apps wrap the runner (and authenticate the caller)
 * in `'use server'` functions and pass them in.
 */
export interface BoardActions {
  approve(key: string, edits: ApproveEdits): Promise<ActionOutcome>;
  spare(key: string): Promise<ActionOutcome>;
  redraft(key: string): Promise<ActionOutcome>;
  settle(key: string, outcome: 'done' | 'not_done'): Promise<ActionOutcome>;
  run(): Promise<ActionOutcome>;
}
