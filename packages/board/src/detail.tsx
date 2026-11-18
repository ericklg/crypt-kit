import { Icon } from './icons.js';
import { APPROVABLE, SPARABLE, StatusPill } from './status.js';
import type { BoardCopy, HauntView } from './types.js';

export interface DraftEdits {
  proposal?: string;
  options?: Record<string, boolean>;
}

export interface HauntDetailProps {
  view: HauntView;
  copy: BoardCopy;
  edits: DraftEdits | undefined;
  whyOpen: boolean;
  /** Current time in ms, for the settle unlock. */
  now: number;
  /** True while an action for this haunt is in flight. */
  busy: boolean;
  onEdit(edits: DraftEdits): void;
  onWhyToggle(open: boolean): void;
  onApprove(): void;
  onSpare(): void;
  onRedraft(): void;
  onSettle(outcome: 'done' | 'not_done'): void;
}

/** The shared haunt detail shown in the drawer: facts, draft, and the actions its status allows. */
export function HauntDetail(props: HauntDetailProps) {
  const { view, copy } = props;
  return (
    <>
      <div className="ck-d-kicker">
        <StatusPill status={view.status} label={copy.status[view.status]} />
        <span className={`ck-sev ck-sev-${view.severity}`}>{view.severity}</span>
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

function SpareButton({ copy, onSpare, busy }: Pick<HauntDetailProps, 'copy' | 'onSpare' | 'busy'>) {
  return (
    <button className="ck-btn" type="button" onClick={onSpare} disabled={busy}>
      <Icon name="x" /> {copy.spare} <kbd>R</kbd>
    </button>
  );
}

function DetailBody(props: HauntDetailProps) {
  const { view, copy, busy } = props;

  if (view.status === 'new') {
    return (
      <>
        <div className="ck-notice">
          <Icon name="clock" />
          <div>
            <strong>{copy.status.new}</strong>
            <p>{copy.waiting} Nothing has been sent to the agent yet.</p>
          </div>
        </div>
        <div className="ck-d-actions">
          {SPARABLE.includes(view.status) ? <SpareButton {...props} /> : null}
          <span className="ck-hint">You can spare it before it’s drafted.</span>
        </div>
      </>
    );
  }

  if (view.status === 'drafting') {
    return (
      <>
        <div className="ck-d-label">
          <Icon name="spark" /> Drafting
        </div>
        <div className="ck-skeleton" style={{ width: '92%' }} />
        <div className="ck-skeleton" style={{ width: '78%' }} />
        <div className="ck-skeleton" style={{ width: '60%' }} />
        <div className="ck-d-actions">
          <SpareButton {...props} />
          <span className="ck-hint">You can spare it while the draft is written.</span>
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
            <strong>No draft this time</strong>
            <p>{view.error} Nothing was sent anywhere.</p>
          </div>
        </div>
        <div className="ck-d-actions">
          <button className="ck-btn ck-btn-primary" type="button" onClick={props.onRedraft} disabled={busy}>
            <Icon name="refresh" /> Try again
          </button>
          <SpareButton {...props} />
        </div>
      </>
    );
  }

  if (view.status === 'approving') {
    const unlocksAt = view.claimExpiresAt ? Date.parse(view.claimExpiresAt) : 0;
    const locked = props.now < unlocksAt;
    const minutes = Math.max(1, Math.ceil((unlocksAt - props.now) / 60_000));
    return (
      <>
        <div className="ck-notice">
          <Icon name="clock" />
          <div>
            <strong>This may already have happened</strong>
            <p>
              The {copy.approve.toLowerCase()} started but its result wasn’t saved. Check the source before doing
              anything else, then record what you found.
            </p>
          </div>
        </div>
        <div className="ck-d-actions">
          {view.url ? (
            <a className="ck-btn" href={view.url} target="_blank" rel="noopener noreferrer">
              <Icon name="external" /> {copy.sourceLabel}
            </a>
          ) : null}
          <button className="ck-btn" type="button" disabled={locked || busy} onClick={() => props.onSettle('done')}>
            <Icon name="check" /> It happened
          </button>
          <button className="ck-btn" type="button" disabled={locked || busy} onClick={() => props.onSettle('not_done')}>
            <Icon name="x" /> It didn’t
          </button>
          <span className="ck-hint">{locked ? `Unlocks in ${minutes} min` : 'You can record it now.'}</span>
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
            <p>{view.error} The draft is kept, so you can fix the cause and try again.</p>
          </div>
        </div>
      ) : null}
      <div className="ck-d-label">
        <Icon name="spark" /> What the agent found
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
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => props.onEdit({ options: { [name]: e.target.checked } })}
          />{' '}
          {copy.optionLabels[name] ?? name}
        </label>
      ))}
      <details className="ck-d-why" open={props.whyOpen} onToggle={(e) => props.onWhyToggle(e.currentTarget.open)}>
        <summary>Why this draft</summary>
        <p>{draft.reasoning}</p>
      </details>
      <div className="ck-d-actions">
        {APPROVABLE.includes(view.status) ? (
          <button className="ck-btn ck-btn-primary" type="button" onClick={props.onApprove} disabled={busy}>
            <Icon name={failed ? 'refresh' : 'check'} /> {failed ? `Try ${copy.approve.toLowerCase()} again` : copy.approve}{' '}
            <kbd>A</kbd>
          </button>
        ) : null}
        <SpareButton {...props} />
        <span className="ck-hint">{copy.approveHint}</span>
      </div>
    </>
  );
}
