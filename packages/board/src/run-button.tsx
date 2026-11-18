'use client';

import { useState, useTransition } from 'react';
import { Icon } from './icons.js';
import type { ActionOutcome } from './types.js';

/** Starts a run through the app's server action and reports the result inline. */
export function RunButton({ label, run }: { label: string; run: () => Promise<ActionOutcome> }) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState('');

  const onClick = () =>
    startTransition(async () => {
      setStatus('');
      try {
        const res = await run();
        setStatus(res.ok ? 'Done. The board is up to date.' : res.message);
      } catch {
        setStatus('The run failed. Try again.');
      }
    });

  return (
    <div className="ck-run">
      <span className="ck-run-status" aria-live="polite">
        {pending ? 'Running…' : status}
      </span>
      <button className="ck-btn" type="button" onClick={onClick} disabled={pending}>
        <Icon name="wand" /> {label}
      </button>
    </div>
  );
}
