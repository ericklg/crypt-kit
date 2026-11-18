import type { HauntStatus } from '@crypt-kit/core';

const TONE: Record<HauntStatus, 'ready' | 'busy' | 'fail' | 'check' | 'wait'> = {
  new: 'wait',
  drafting: 'busy',
  drafted: 'ready',
  draft_failed: 'fail',
  approving: 'check',
  approved: 'ready',
  action_failed: 'fail',
  spared: 'wait',
  resolved: 'wait',
};

/** Statuses the approve button acts on. */
export const APPROVABLE: readonly HauntStatus[] = ['drafted', 'action_failed'];
/** Statuses the spare button acts on (matches the runner). */
export const SPARABLE: readonly HauntStatus[] = ['new', 'drafting', 'drafted', 'draft_failed', 'action_failed'];

export function StatusPill({ status, label }: { status: HauntStatus; label: string }) {
  return (
    <span className={`ck-pill ck-pill-${TONE[status]}`}>
      <span className="ck-dot" />
      {label}
    </span>
  );
}
