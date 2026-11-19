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
  /** Screen-reader word before a headline's old value: "$12, was $20". */
  was: string;
  /** Severity tag in the drawer. */
  severity: Record<Severity, string>;
  keysLabel: string;
  keyMove: string;
  keyOpen: string;
  /** Keycap label for the Enter key in the shortcut legend. */
  keyEnter: string;
  weeklyGoal: string;
  /** Appended to the meter's accessible text (", goal reached") once the score passes the goal. */
  goalReached: string;
  /** Weekly meter text; `{score}`, `{goal}` and `{scoreLabel}` are filled in. */
  goalProgress: string;
  /** Open count above the meter; `{count}` and `{openLabel}` are filled in. */
  openCount: string;
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
  /** Shown when approve should open a link but the browser blocked the new tab. `{title}` is the haunt's. */
  linkBlocked: string;
  /** Notice on a haunt an assistant flagged for review (MCP `request_approval`), with its note below. */
  reviewRequested: string;
  /** Under that notice; `{approveLabel}` is the approve button's text. */
  reviewRequestedHint: string;
  /** Text of the link in that message. */
  openLink: string;
  /** Accessible name of the button that closes a message. */
  dismiss: string;
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
  /**
   * Approving opens the action result's `url` in a new tab (e.g. a deal link). The tab is
   * opened during the click, so browsers don't block it, and pointed at the link once the
   * server confirms. Default false.
   */
  approveOpensLink?: boolean;
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
  /** An assistant asked the user to review this (MCP `request_approval`). Optional for older views. */
  approvalRequest?: { note: string; at: string } | null;
}

/** `url`: where the action's result lives (a posted comment, a deal). Only https links are opened. */
export type ActionOutcome = { ok: true; url?: string } | { ok: false; message: string };

export interface ApproveEdits {
  proposal: string;
  options: Record<string, boolean>;
  /**
   * The `revision` the user reviewed. Pass it to the runner as `expectedVersion`, so an
   * approve fails with a conflict instead of applying these edits to a newer draft.
   */
  revision: number;
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
