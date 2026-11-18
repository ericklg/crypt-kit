'use client';

import { useState } from 'react';
import { Icon } from './icons.js';
import type { ActionOutcome, UiCopy } from './types.js';

type RunCopy = Pick<UiCopy, 'running' | 'runDone' | 'runFailed'>;

/**
 * Starts a run through the app's server action and reports the result inline. Uses its
 * own pending state rather than a transition, so a slow run can't hold back the yard.
 */
export function RunButton({ label, ui, run }: { label: string; ui: RunCopy; run: () => Promise<ActionOutcome> }) {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('');

  const onClick = async () => {
    setPending(true);
    setStatus('');
    try {
      const res = await run();
      setStatus(res.ok ? ui.runDone : res.message);
    } catch {
      setStatus(ui.runFailed);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="ck-run">
      <span className="ck-run-status" aria-live="polite">
        {pending ? ui.running : status}
      </span>
      <button className="ck-btn" type="button" onClick={onClick} disabled={pending}>
        <Icon name="wand" /> {label}
      </button>
    </div>
  );
}
