'use client';

import { useEffect, useLayoutEffect, useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { HauntDetail, type DraftEdits } from './detail.js';
import { Icon } from './icons.js';
import { APPROVABLE, SPARABLE, StatusPill } from './status.js';
import type { ActionOutcome, BoardActions, BoardCopy, Creature, HauntView } from './types.js';

export interface YardProps {
  views: HauntView[];
  copy: BoardCopy;
  creature: Creature;
  actions: BoardActions;
  /** Server time (ISO) for the first render, so settle locks match between server and client. */
  now: string;
  /** Open this haunt's drawer on first render (deep links, previews). */
  defaultOpenKey?: string | null;
  /** Theme motion setting; `reduced` skips the leave animation delay. */
  motion: 'full' | 'reduced';
}

type Leave = 'approve' | 'spare';
type Toast = { id: number; message: string; tone: 'ok' | 'fail' };

/** Leave animation length; matches .ck-grave's opacity/transform transition in board.css. */
const LEAVE_MS = 450;
const NOW_TICK_MS = 15_000;

const attr = (value: string) => value.replace(/["\\]/g, '\\$&');
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The interactive part of the board: the graves, the haunt drawer, toasts and keyboard
 * shortcuts. Shortcuts only fire while focus is inside this component (WCAG 2.1.4).
 */
export function Yard({ views, copy, creature, actions, now: nowProp, defaultOpenKey = null, motion }: YardProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(() => defaultOpenKey ?? views[0]?.key ?? null);
  const [open, setOpen] = useState(() => defaultOpenKey !== null && views.some((v) => v.key === defaultOpenKey));
  const [leaving, setLeaving] = useState<ReadonlyMap<string, Leave>>(new Map());
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [edits, setEdits] = useState<Readonly<Record<string, DraftEdits>>>({});
  const [whyOpen, setWhyOpen] = useState<ReadonlySet<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [now, setNow] = useState(() => Date.parse(nowProp));
  const [, startTransition] = useTransition();

  const rootRef = useRef<HTMLDivElement>(null);
  /** What to focus after the next render: a grave key, '@close' or '@proposal'. */
  const focusNext = useRef<string | null>(null);

  // Haunts the server still reports, minus ones this client has just finished acting on.
  const items = views.filter((v) => !hidden.has(v.key));
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const selected = items.find((v) => v.key === selectedKey) ?? null;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast((t) => (t?.id === toast.id ? null : t)), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  // While the drawer is open, the header and HUD (rendered by the server) are inert too.
  useEffect(() => {
    const board = rootRef.current?.closest('.ck-board');
    board?.querySelectorAll('[data-ck-backdrop]').forEach((el) => el.toggleAttribute('inert', open));
  }, [open]);

  useLayoutEffect(() => {
    const target = focusNext.current;
    const root = rootRef.current;
    if (!target || !root) return;
    focusNext.current = null;
    const el =
      target === '@proposal'
        ? (root.querySelector<HTMLElement>('#ck-proposal') ?? root.querySelector<HTMLElement>('.ck-drawer-close'))
        : target === '@close'
          ? root.querySelector<HTMLElement>('.ck-drawer-close')
          : (root.querySelector<HTMLElement>(`[data-grave="${attr(target)}"]`) ?? root.querySelector<HTMLElement>('.ck-yard'));
    el?.focus({ preventScroll: true });
  });

  const showToast = (message: string, tone: Toast['tone'] = 'ok') => setToast({ id: Date.now(), message, tone });

  const openHaunt = (key: string, focus: '@close' | '@proposal' = '@close') => {
    setSelectedKey(key);
    setOpen(true);
    focusNext.current = focus;
  };

  const closeDrawer = () => {
    setOpen(false);
    focusNext.current = selectedKey;
  };

  /** The haunt that should be selected after `key` is removed. */
  const neighbourOf = (key: string): string | null => {
    const list = itemsRef.current;
    const i = list.findIndex((v) => v.key === key);
    return list[i + 1]?.key ?? list[i - 1]?.key ?? null;
  };

  const run = (key: string, call: () => Promise<ActionOutcome>, after?: (res: ActionOutcome) => void) => {
    setBusyKey(key);
    startTransition(async () => {
      let res: ActionOutcome;
      try {
        res = await call();
      } catch {
        res = { ok: false, message: 'Something went wrong. Nothing was changed; try again.' };
      }
      setBusyKey((b) => (b === key ? null : b));
      if (!res.ok) showToast(res.message, 'fail');
      after?.(res);
    });
  };

  const leave = (kind: Leave, key: string) => {
    const view = itemsRef.current.find((v) => v.key === key);
    if (!view || leaving.has(key) || busyKey === key) return;
    if (kind === 'approve' && !(APPROVABLE.includes(view.status) && view.draft)) return;
    if (kind === 'spare' && !SPARABLE.includes(view.status)) return;

    const edit = edits[key];
    const delay = motion === 'reduced' || prefersReducedMotion() ? 0 : LEAVE_MS;
    setOpen(false);
    setSelectedKey(key);
    setLeaving((m) => new Map(m).set(key, kind));

    run(
      key,
      async () => {
        const [res] = await Promise.all([
          kind === 'approve'
            ? actions.approve(key, {
                proposal: edit?.proposal ?? view.draft!.proposal,
                options: { ...view.draft!.options, ...edit?.options },
              })
            : actions.spare(key),
          wait(delay),
        ]);
        return res;
      },
      (res) => {
        setLeaving((m) => {
          const next = new Map(m);
          next.delete(key);
          return next;
        });
        if (!res.ok) {
          focusNext.current = key;
          return;
        }
        const next = neighbourOf(key);
        setHidden((h) => new Set(h).add(key));
        setSelectedKey((cur) => (cur === key ? next : cur));
        focusNext.current = next ?? '@yard';
        showToast(kind === 'approve' ? copy.approved : copy.spared);
      },
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'escape' && open) {
      e.preventDefault();
      closeDrawer();
      return;
    }
    const target = e.target as HTMLElement;
    if (target.closest('textarea, input, select')) return;

    // Shortcuts act on the focused grave when there is one; Tab alone never moves the selection.
    const focusedKey = !open ? (target.closest<HTMLElement>('[data-grave]')?.dataset.grave ?? null) : null;
    const actOn = focusedKey ?? selectedKey;

    const move = (step: number) => {
      const list = itemsRef.current;
      if (!list.length) return;
      const from = Math.max(0, list.findIndex((v) => v.key === (focusedKey ?? selectedKey)));
      const next = list[(from + step + list.length) % list.length]!.key;
      setSelectedKey(next);
      focusNext.current = next;
    };

    if (!open && (key === 'j' || key === 'arrowright')) return (e.preventDefault(), move(1));
    if (!open && (key === 'k' || key === 'arrowleft')) return (e.preventDefault(), move(-1));
    if ((key === 'a' || key === 'r') && actOn) {
      e.preventDefault();
      if (e.repeat) return; // a held key must not act on one haunt after another
      leave(key === 'a' ? 'approve' : 'spare', actOn);
      return;
    }
    if (key === 'e' && actOn) {
      e.preventDefault();
      openHaunt(actOn, '@proposal');
    }
  };

  const onEdit = (key: string, change: DraftEdits) =>
    setEdits((all) => ({
      ...all,
      [key]: {
        ...all[key],
        ...(change.proposal !== undefined ? { proposal: change.proposal } : {}),
        ...(change.options ? { options: { ...all[key]?.options, ...change.options } } : {}),
      },
    }));

  return (
    <div className="ck-yard-root" ref={rootRef} data-open={open} onKeyDown={onKeyDown}>
      <main className="ck-yard" inert={open} tabIndex={-1}>
        <ul className="ck-graves" aria-label="Haunts">
          {items.length ? (
            items.map((view) => (
              <Grave
                key={view.key}
                view={view}
                copy={copy}
                creature={creature}
                selected={view.key === selectedKey}
                leaving={leaving.get(view.key)}
                onOpen={openHaunt}
              />
            ))
          ) : (
            <li className="ck-empty">
              <Icon name={creature} size="xl" />
              <h3>{copy.emptyTitle}</h3>
              <p>{copy.emptyBody}</p>
            </li>
          )}
        </ul>
      </main>
      <div className="ck-scrim" onClick={closeDrawer} aria-hidden="true" />
      <aside className="ck-drawer" role="dialog" aria-modal="true" aria-labelledby="ck-detail-title" inert={!open}>
        <button className="ck-btn ck-btn-ghost ck-drawer-close" type="button" onClick={closeDrawer} aria-label="Close">
          <Icon name="x" />
        </button>
        {selected ? (
          <HauntDetail
            view={selected}
            copy={copy}
            edits={edits[selected.key]}
            whyOpen={whyOpen.has(selected.key)}
            now={now}
            busy={busyKey === selected.key}
            onEdit={(change) => onEdit(selected.key, change)}
            onWhyToggle={(isOpen) =>
              setWhyOpen((s) => {
                if (s.has(selected.key) === isOpen) return s;
                const next = new Set(s);
                if (isOpen) next.add(selected.key);
                else next.delete(selected.key);
                return next;
              })
            }
            onApprove={() => leave('approve', selected.key)}
            onSpare={() => leave('spare', selected.key)}
            onRedraft={() => run(selected.key, () => actions.redraft(selected.key))}
            onSettle={(outcome) => run(selected.key, () => actions.settle(selected.key, outcome))}
          />
        ) : null}
      </aside>
      <div aria-live="polite" className="ck-sr-live">
        {toast ? (
          <div className="ck-toast" data-tone={toast.tone} role={toast.tone === 'fail' ? 'alert' : 'status'}>
            <Icon name={toast.tone === 'fail' ? 'alert' : 'check'} />
            <span>{toast.message}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface GraveProps {
  view: HauntView;
  copy: BoardCopy;
  creature: Creature;
  selected: boolean;
  leaving: Leave | undefined;
  onOpen(key: string): void;
}

function Grave({ view, copy, creature, selected, leaving, onOpen }: GraveProps) {
  return (
    <li>
      <button
        type="button"
        className="ck-grave"
        data-grave={view.key}
        data-status={view.status}
        data-selected={selected}
        data-leaving={leaving}
        aria-haspopup="dialog"
        onClick={() => onOpen(view.key)}
      >
        <span className="ck-spirit">
          <Icon name={creature} size="lg" />
        </span>
        <span className="ck-g-title">{view.title}</span>
        <span className="ck-g-meta">
          {view.meta}
          <br />
          {view.age}
        </span>
        {view.headline ? (
          <span className="ck-g-price">
            {view.headline.value}
            {view.headline.was ? (
              <s>
                <span className="ck-sr">, was </span>
                {view.headline.was}
              </s>
            ) : null}
          </span>
        ) : null}
        <StatusPill status={view.status} label={copy.status[view.status]} />
      </button>
    </li>
  );
}
