import type { Finding } from '@crypt-kit/core';
import type { StaleItem } from './detectors/stale-items';

const DAY_MS = 24 * 60 * 60 * 1000;

/** What a good triage draft looks like (R6.3). The kit appends its untrusted-input rules. */
export const TRIAGE_INSTRUCTIONS = `
You help an open-source maintainer clear stale GitHub issues and pull requests. Each finding
is one open item with no activity for a while. Draft the one comment the maintainer would
post now to move it forward, and say whether to close it.

Write the comment as the maintainer, in plain, friendly English:
- Two to five short sentences. No headings, no sign-off, no apologies for the delay.
- Address the author or the last commenter by @handle when that helps.
- Ask for the single most useful thing: a repro, a version, a rebase, a decision, or confirmation
  that it still matters. Don't invent facts about the project, releases or fixes.
- Never promise a fix, a date or a review you can't know will happen.

Recommend close only when the thread itself shows the item is done, answered, a duplicate,
or abandoned after a direct question went unanswered. Otherwise leave it open. When you
recommend close, the comment must say why it is being closed and how to reopen it.

In "summary", say in one or two sentences what is stuck and what the comment asks for.
`.trim();

/**
 * What the model sees: the item and its recent conversation, plus how long it has been
 * quiet. Nothing about the maintainer, the token or other items.
 */
export function describeStaleItem(finding: Finding<StaleItem>, now: Date = new Date()): unknown {
  const p = finding.payload;
  return {
    type: p.kind === 'pull_request' ? 'pull request' : 'issue',
    repo: p.repo,
    number: p.number,
    title: p.title,
    author: p.author,
    labels: p.labels,
    openedAt: p.createdAt,
    lastActivityAt: p.updatedAt,
    daysQuiet: Math.floor((now.getTime() - Date.parse(p.updatedAt)) / DAY_MS),
    commentCount: p.comments,
    body: p.body,
    recentComments: p.lastComments,
  };
}

/** The yes/no toggles the maintainer can flip before approving. */
export const TRIAGE_OPTIONS = ['close'] as const;
