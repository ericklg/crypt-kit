import { fill } from './copy.js';
import { Icon } from './icons.js';
import { APPROVABLE, SPARABLE, StatusPill } from './status.js';
import type { HauntView, ResolvedCopy } from './types.js';

export interface DraftEdits {
  proposal?: string;
  options?: Record<string, boolean>;
}

/** The request in flight for a haunt, if any. */
export type Pending = 'approve' | 'spare' | 'redraft' | 'settle' | null;

export interface HauntDetailProps {
  view: HauntView;
  copy: ResolvedCopy;
  edits: DraftEdits | undefined;
  whyOpen: boolean;
  /** Current time in ms, for the settle unlock. */
  now: number;
  pending: Pending;
  onEdit(edits: DraftEdits): void;
  onWhyToggle(open: boolean): void;
  onApprove(): void;
  onSpare(): void;
  onRedraft(): void;
  onSettle(outcome: 'done' | 'not_done'): void;
}

/** Approve and spare are final; nothing else may start while one is in flight. */
const isFinal = (p: Pending) => p === 'approve' || p === 'spare' || p === 'settle';

/** The shared haunt detail shown in the drawer: facts, draft, and the actions its status allows. */
export function HauntDetail(props: HauntDetailProps) {
  const { view, copy } = props;
  return (
    <>
      <div className="ck-d-kicker">
        <StatusPill status={view.status} label={copy.status[view.status]} />
        <span className={`ck-sev ck-sev-${view.severity}`}>{copy.ui.severity[view.severity]}</span>
      </div>
      <h2 className="ck-d-title" id="ck-detail-title">
        {view.title}
      </h2>
      <p className="ck-d-meta">
        <span>{view.meta}</span>
        <span aria-hidden="true">·</span>
        <span>{view.age}</span>
        {view.url ? (
          <a className="ck-link" href={view.url} target="_blank" rel="noopener noreferrer">
            <Icon name="external" />
            {copy.sourceLabel}
          </a>
        ) : null}
      </p>
      {view.facts.length ? (
        <dl className="ck-facts">
          {view.facts.map((f) => (
            <div className="ck-fact" data-tone={f.tone} key={f.label}>
              {/* dt before dd for valid markup; CSS shows the value on top. */}
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <DetailBody {...props} />
    </>
  );
}

function SpareButton({ view, copy, onSpare, pending }: Pick<HauntDetailProps, 'view' | 'copy' | 'onSpare' | 'pending'>) {
  // Only statuses the runner can spare get the button (not approved, spared or resolved).
  if (!SPARABLE.includes(view.status)) return null;
  // Sparing stays available during a redraft; the runner discards the late draft.
  return (
    <button className="ck-btn" type="button" onClick={onSpare} disabled={isFinal(pending)}>
      <Icon name="x" /> {copy.spare} <kbd>R</kbd>
    </button>
  );
}

function DetailBody(props: HauntDetailProps) {
  const { view, copy, pending } = props;
  const { ui } = copy;
  const words = { approve: copy.approve.toLowerCase(), spare: copy.spare.toLowerCase() };

  if (view.status === 'new') {
    return (
      <>
        <div className="ck-notice">
          <Icon name="clock" />
          <div>
            <strong>{copy.status.new}</strong>
            <p>
              {copy.waiting} {ui.waitingNote}
            </p>
          </div>
        </div>
        <div className="ck-d-actions">
          <SpareButton {...props} />
          <span className="ck-hint">{fill(ui.waitingHint, words)}</span>
        </div>
      </>
    );
  }

  if (view.status === 'drafting') {
    return (
      <>
        <div className="ck-d-label">
          <Icon name="spark" /> {ui.drafting}
        </div>
        <div className="ck-skeleton" style={{ width: '92%' }} />
        <div className="ck-skeleton" style={{ width: '78%' }} />
        <div className="ck-skeleton" style={{ width: '60%' }} />
        <div className="ck-d-actions">
          <SpareButton {...props} />
          <span className="ck-hint">{fill(ui.draftingHint, words)}</span>
        </div>
      </>
    );
  }

  if (view.status === 'draft_failed') {
    return (
      <>
        <div className="ck-notice" data-tone="fail">
          <Icon name="alert" />
          <div>
            <strong>{ui.draftFailedTitle}</strong>
            <p>
              {view.error} {ui.draftFailedNote}
            </p>
          </div>
        </div>
        <div className="ck-d-actions">
          <button className="ck-btn ck-btn-primary" type="button" onClick={props.onRedraft} disabled={pending !== null}>
            <Icon name="refresh" /> {ui.tryAgain}
          </button>
          <SpareButton {...props} />
        </div>
      </>
    );
  }

  if (view.status === 'approving') {
    // An unknown deadline stays locked: the runner would refuse an early settle anyway.
    const unlocksAt = view.claimExpiresAt ? Date.parse(view.claimExpiresAt) : Number.POSITIVE_INFINITY;
    const locked = !(props.now >= unlocksAt);
    const hint = !locked
      ? ui.unlocked
      : Number.isFinite(unlocksAt)
        ? fill(ui.unlocksIn, { minutes: Math.max(1, Math.ceil((unlocksAt - props.now) / 60_000)) })
        : ui.unlockPending;
    return (
      <>
        <div className="ck-notice">
          <Icon name="clock" />
          <div>
            <strong>{ui.stuckTitle}</strong>
            <p>{fill(ui.stuckBody, words)}</p>
          </div>
        </div>
        <div className="ck-d-actions">
          {view.url ? (
            <a className="ck-btn" href={view.url} target="_blank" rel="noopener noreferrer">
              <Icon name="external" /> {copy.sourceLabel}
            </a>
          ) : null}
          <button className="ck-btn" type="button" disabled={locked || pending !== null} onClick={() => props.onSettle('done')}>
            <Icon name="check" /> {ui.happened}
          </button>
          <button className="ck-btn" type="button" disabled={locked || pending !== null} onClick={() => props.onSettle('not_done')}>
            <Icon name="x" /> {ui.didntHappen}
          </button>
          <span className="ck-hint">{hint}</span>
        </div>
      </>
    );
  }

  const draft = view.draft;
  if (!draft) return null;
  const proposal = props.edits?.proposal ?? draft.proposal;
  const options = { ...draft.options, ...props.edits?.options };
  const failed = view.status === 'action_failed';

  return (
    <>
      {failed ? (
        <div className="ck-notice" data-tone="fail">
          <Icon name="alert" />
          <div>
            <strong>{copy.actionFailedTitle}</strong>
            <p>
              {view.error} {ui.actionFailedNote}
            </p>
          </div>
        </div>
      ) : null}
      <div className="ck-d-label">
        <Icon name="spark" /> {ui.found}
      </div>
      <p className="ck-d-summary">{draft.summary}</p>
      <label className="ck-d-label" htmlFor="ck-proposal">
        {copy.proposalLabel} <kbd>E</kbd>
      </label>
      <textarea
        id="ck-proposal"
        className="ck-d-proposal"
        rows={5}
        value={proposal}
        onChange={(e) => props.onEdit({ proposal: e.target.value })}
      />
      {Object.entries(options).map(([name, checked]) => (
        <label className="ck-toggle" key={name}>
          <input type="checkbox" checked={checked} onChange={(e) => props.onEdit({ options: { [name]: e.target.checked } })} />{' '}
          {copy.optionLabels[name] ?? name}
        </label>
      ))}
      <details className="ck-d-why" open={props.whyOpen} onToggle={(e) => props.onWhyToggle(e.currentTarget.open)}>
        <summary>{ui.why}</summary>
        <p>{draft.reasoning}</p>
      </details>
      <div className="ck-d-actions">
        {APPROVABLE.includes(view.status) ? (
          <button className="ck-btn ck-btn-primary" type="button" onClick={props.onApprove} disabled={pending !== null}>
            <Icon name={failed ? 'refresh' : 'check'} /> {failed ? fill(ui.tryApproveAgain, words) : copy.approve} <kbd>A</kbd>
          </button>
        ) : null}
        <SpareButton {...props} />
        <span className="ck-hint">{copy.approveHint}</span>
      </div>
    </>
  );
}
