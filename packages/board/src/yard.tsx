'use client';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { fill } from './copy.js';
import { HauntDetail, type DraftEdits, type Pending } from './detail.js';
import { Icon } from './icons.js';
import { APPROVABLE, SPARABLE, StatusPill } from './status.js';
import type { ActionOutcome, BoardActions, Creature, HauntView, ResolvedCopy } from './types.js';

export interface YardProps {
  views: HauntView[];
  copy: ResolvedCopy;
  creature: Creature;
  actions: BoardActions;
  /** Server time (ISO) for the first render, so settle locks match between server and client. */
  now: string;
  /** Open this haunt's drawer on first render (deep links, previews). */
  defaultOpenKey?: string | null;
  /** Theme motion setting; `reduced` skips the leave animation delay. */
  motion: 'full' | 'reduced';
  /** Approve opens the result's link in a new tab. See `BoardTheme.approveOpensLink`. */
  opensLink?: boolean;
}

type Leave = 'approve' | 'spare';
type Toast = { id: number; message: string; tone: 'ok' | 'fail' };

/** Only https links from the server are opened. */
function safeLink(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Leave animation length; matches .ck-grave's opacity/transform transition in board.css. */
const LEAVE_MS = 450;
const NOW_TICK_MS = 15_000;

/** Elements Tab can reach inside the drawer. */
const TABBABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** Edits belong to one haunt's one draft: two haunts with identical drafts never share them. */
const editKey = (view: HauntView) => (view.draftId === null ? null : JSON.stringify([view.key, view.draftId]));

/** Finds a grave by key without building a selector, since keys may contain any character. */
const graveFor = (root: HTMLElement, key: string) =>
  [...root.querySelectorAll<HTMLElement>('[data-grave]')].find((el) => el.dataset.grave === key) ?? null;

/** Ops that end a haunt's turn on the board; their success supersedes requests still in flight. */
const FINAL_OPS: ReadonlySet<Pending> = new Set<Pending>(['approve', 'spare', 'settle']);

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The interactive part of the board: the graves, the haunt drawer, toasts and keyboard
 * shortcuts. Shortcuts only fire while focus is inside this component (WCAG 2.1.4).
 */
export function Yard({ views, copy, creature, actions, now: nowProp, defaultOpenKey = null, motion, opensLink = false }: YardProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(() => defaultOpenKey ?? views[0]?.key ?? null);
  const [open, setOpen] = useState(() => defaultOpenKey !== null && views.some((v) => v.key === defaultOpenKey));
  const [leaving, setLeaving] = useState<ReadonlyMap<string, Leave>>(new Map());
  const leavingRef = useRef(leaving);
  leavingRef.current = leaving;
  /**
   * Haunts this client finished acting on, by key, with the revision it acted on. They stay
   * hidden only while the server still sends that same revision; once the server's list
   * catches up (or the runner reopens the key with a newer revision) they show normally.
   */
  const [tombstones, setTombstones] = useState<ReadonlyMap<string, number>>(new Map());
  /** Edits per haunt and draft (`editKey`), so they survive close/reopen but not a new draft. */
  const [edits, setEdits] = useState<Readonly<Record<string, DraftEdits>>>({});
  const [whyOpen, setWhyOpen] = useState<ReadonlySet<string>>(new Set());
  /** In-flight op per key. A Map, since finding keys are arbitrary strings ("toString"). */
  const [pending, setPending] = useState<ReadonlyMap<string, Exclude<Pending, null>>>(new Map());
  const [toast, setToast] = useState<Toast | null>(null);
  /**
   * Deal links whose tab the browser blocked. Kept apart from the passing message, and until
   * each is used or dismissed: its haunt has left the board, so this is the only way to it.
   */
  const [blocked, setBlocked] = useState<ReadonlyArray<{ id: number; href: string; title: string }>>([]);
  const dropBlocked = (id: number) => setBlocked((list) => list.filter((b) => b.id !== id));
  const [now, setNow] = useState(() => Date.parse(nowProp));

  const rootRef = useRef<HTMLDivElement>(null);
  /** Bumped per key when a final op succeeds; requests started before it are superseded. */
  const epochs = useRef(new Map<string, number>());
  /** What to focus after the next render: a grave key, '@close', '@proposal' or '@yard'. */
  const focusNext = useRef<string | null>(open ? '@close' : null);

  const items = views.filter((v) => tombstones.get(v.key) !== v.revision);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const selected = items.find((v) => v.key === selectedKey) ?? null;
  const drawerOpen = open && selected !== null;
  const drawerOpenRef = useRef(drawerOpen);
  drawerOpenRef.current = drawerOpen;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast((t) => (t?.id === toast.id ? null : t)), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  // Forget tombstones the server no longer needs: the key is gone, or it came back newer.
  useEffect(() => {
    setTombstones((t) => {
      if (!t.size) return t;
      const current = new Map(views.map((v) => [v.key, v.revision]));
      const next = new Map([...t].filter(([key, rev]) => current.get(key) === rev));
      return next.size === t.size ? t : next;
    });
  }, [views]);

  // The drawer's haunt went away (another session acted on it): close and land on the yard.
  useEffect(() => {
    if (open && !selected) {
      setOpen(false);
      focusNext.current = itemsRef.current[0]?.key ?? '@yard';
    }
  }, [open, selected]);

  // While the drawer is open, the header and HUD (rendered by the server) are inert too.
  useEffect(() => {
    const board = rootRef.current?.closest('.ck-board');
    board?.querySelectorAll('[data-ck-backdrop]').forEach((el) => el.toggleAttribute('inert', drawerOpen));
  }, [drawerOpen]);

  // aria-modal: focus that leaves the open drawer (the host page's own links, a click
  // elsewhere) is brought back, so Tab and Escape keep working inside it. The ref check
  // lets the closing render move focus to the yard before this listener is removed.
  useEffect(() => {
    if (!drawerOpen) return;
    const onFocusIn = (e: FocusEvent) => {
      const drawer = rootRef.current?.querySelector<HTMLElement>('.ck-drawer');
      if (!drawerOpenRef.current || !drawer || (e.target instanceof Node && drawer.contains(e.target))) return;
      drawer.querySelector<HTMLElement>('.ck-drawer-close')?.focus({ preventScroll: true });
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [drawerOpen]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const q = (selector: string) => root.querySelector<HTMLElement>(selector);
    const target = focusNext.current;
    focusNext.current = null;
    let el: HTMLElement | null = null;
    if (target === '@proposal') el = q('#ck-proposal') ?? q('.ck-drawer-close');
    else if (target === '@close') el = q('.ck-drawer-close');
    else if (target === '@yard') el = q('.ck-yard');
    else if (target) el = graveFor(root, target) ?? q('.ck-yard');
    // A refresh can remove the focused control (e.g. Try again): keep focus inside the modal.
    const drawer = q('.ck-drawer');
    if (!el && drawerOpen && drawer && !drawer.contains(document.activeElement)) el = q('.ck-drawer-close');
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
    focusNext.current = selectedKey ?? '@yard';
  };

  /** The nearest stone after (else before) `key` that isn't itself on its way out. */
  const neighbourOf = (key: string): string | null => {
    const list = itemsRef.current.filter((v) => v.key === key || !leavingRef.current.has(v.key));
    const i = list.findIndex((v) => v.key === key);
    return list[i + 1]?.key ?? list[i - 1]?.key ?? null;
  };

  /**
   * Runs one server action for a haunt. A request that fails in transit (thrown) is
   * reported as unconfirmed: the server may already have acted.
   */
  // Not wrapped in startTransition on purpose: React entangles pending async transitions,
  // so one slow server action would hold back every other action's UI updates.
  const run = (key: string, op: Exclude<Pending, null>, call: () => Promise<ActionOutcome>, after?: (res: ActionOutcome) => void) => {
    setPending((p) => new Map(p).set(key, op));
    const startedIn = epochs.current.get(key) ?? 0;
    void (async () => {
      let res: ActionOutcome;
      try {
        res = await call();
      } catch {
        res = { ok: false, message: copy.ui.unconfirmed };
      }
      setPending((p) => {
        if (p.get(key) !== op) return p;
        const next = new Map(p);
        next.delete(key);
        return next;
      });
      // A final op that succeeded while this request was in flight (e.g. Spare during a
      // redraft) supersedes it: its expected conflict is not news to the user.
      const superseded = (epochs.current.get(key) ?? 0) !== startedIn;
      if (!res.ok && !superseded) showToast(res.message, 'fail');
      if (res.ok && FINAL_OPS.has(op)) epochs.current.set(key, (epochs.current.get(key) ?? 0) + 1);
      after?.(res);
    })();
  };

  const leave = (kind: Leave, key: string) => {
    const view = itemsRef.current.find((v) => v.key === key);
    const busy = pending.get(key);
    // A second approve/spare/settle on the same haunt waits; a redraft in flight may be spared.
    if (!view || leaving.has(key) || busy === 'approve' || busy === 'spare' || busy === 'settle') return;
    if (kind === 'approve' && (busy === 'redraft' || !(APPROVABLE.includes(view.status) && view.draft))) return;
    if (kind === 'spare' && !SPARABLE.includes(view.status)) return;

    const id = editKey(view);
    const edit = id ? edits[id] : undefined;
    const delay = motion === 'reduced' || prefersReducedMotion() ? 0 : LEAVE_MS;
    // Focus moves now, not when the request ends: the drawer goes inert and the stone fades
    // out, and a slow request must not leave keyboard focus (and the shortcuts) stranded.
    const parkedOn = neighbourOf(key) ?? '@yard';
    const stillParked = () => {
      const root = rootRef.current;
      const active = document.activeElement;
      if (!root || !active || active === document.body) return true;
      return active === (parkedOn === '@yard' ? root.querySelector('.ck-yard') : graveFor(root, parkedOn));
    };
    setOpen(false);
    setSelectedKey(key);
    setLeaving((m) => new Map(m).set(key, kind));
    focusNext.current = parkedOn;
    // Opened now, inside the click or key press, because a tab opened after the server
    // answers is blocked as a popup. It's pointed at the link, or closed, once we know.
    const tab = kind === 'approve' && opensLink ? window.open('', '_blank') : null;

    run(
      key,
      kind,
      async () => {
        const [res] = await Promise.all([
          kind === 'approve'
            ? actions.approve(key, {
                proposal: edit?.proposal ?? view.draft!.proposal,
                options: { ...view.draft!.options, ...edit?.options },
                revision: view.revision,
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
        // Only take focus back if the user hasn't moved it since.
        if (!res.ok) {
          tab?.close();
          if (stillParked()) focusNext.current = key;
          return;
        }
        const next = neighbourOf(key);
        setTombstones((t) => new Map(t).set(key, view.revision));
        setSelectedKey((cur) => (cur === key ? next : cur));
        if (stillParked()) focusNext.current = next ?? '@yard';
        if (kind === 'approve' && opensLink) {
          const href = safeLink(res.url);
          if (href && tab && !tab.closed) {
            tab.opener = null; // the deal page gets no handle on the board
            tab.location.replace(href);
          } else {
            tab?.close();
            if (href) {
              setBlocked((list) => [...list, { id: Date.now() + Math.random(), href, title: view.title }]);
              return;
            }
          }
        }
        showToast(kind === 'approve' ? copy.approved : copy.spared);
      },
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'escape' && drawerOpen) {
      e.preventDefault();
      closeDrawer();
      return;
    }
    if (key === 'tab' && drawerOpen) {
      const drawer = rootRef.current?.querySelector<HTMLElement>('.ck-drawer');
      const stops = drawer ? [...drawer.querySelectorAll<HTMLElement>(TABBABLE)] : [];
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first || !last) return;
      const at = document.activeElement;
      if (e.shiftKey && (at === first || !drawer!.contains(at))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    const target = e.target as HTMLElement;
    if (target.closest('textarea, input, select')) return;

    // Shortcuts act on the focused grave when there is one; Tab alone never moves the selection.
    const focusedKey = !drawerOpen ? (target.closest<HTMLElement>('[data-grave]')?.dataset.grave ?? null) : null;
    const actOn = focusedKey ?? selectedKey;

    const move = (step: number) => {
      const list = itemsRef.current;
      if (!list.length) return;
      const from = Math.max(0, list.findIndex((v) => v.key === (focusedKey ?? selectedKey)));
      const next = list[(from + step + list.length) % list.length]!.key;
      setSelectedKey(next);
      focusNext.current = next;
    };

    if (!drawerOpen && (key === 'j' || key === 'arrowright')) return (e.preventDefault(), move(1));
    if (!drawerOpen && (key === 'k' || key === 'arrowleft')) return (e.preventDefault(), move(-1));
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

  const onEdit = (id: string, change: DraftEdits) =>
    setEdits((all) => ({
      ...all,
      [id]: {
        ...all[id],
        ...(change.proposal !== undefined ? { proposal: change.proposal } : {}),
        ...(change.options ? { options: { ...all[id]?.options, ...change.options } } : {}),
      },
    }));
  const selectedEditKey = selected ? editKey(selected) : null;

  return (
    <div className="ck-yard-root" ref={rootRef} data-open={drawerOpen} onKeyDown={onKeyDown}>
      <main className="ck-yard" inert={drawerOpen} tabIndex={-1}>
        <ul className="ck-graves" aria-label={copy.ui.listLabel}>
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
      <aside className="ck-drawer" role="dialog" aria-modal="true" aria-labelledby="ck-detail-title" inert={!drawerOpen}>
        <button className="ck-btn ck-btn-ghost ck-drawer-close" type="button" onClick={closeDrawer} aria-label={copy.ui.close}>
          <Icon name="x" />
        </button>
        {selected ? (
          <HauntDetail
            view={selected}
            copy={copy}
            edits={selectedEditKey ? edits[selectedEditKey] : undefined}
            whyOpen={whyOpen.has(selected.key)}
            now={now}
            pending={pending.get(selected.key) ?? null}
            onEdit={(change) => selectedEditKey && onEdit(selectedEditKey, change)}
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
            onRedraft={() => run(selected.key, 'redraft', () => actions.redraft(selected.key))}
            onSettle={(outcome) => run(selected.key, 'settle', () => actions.settle(selected.key, outcome))}
          />
        ) : null}
      </aside>
      <div className="ck-toasts" aria-live="polite">
        {blocked.map((b) => (
          <div className="ck-toast" data-tone="fail" role="alert" key={b.id}>
            <Icon name="alert" />
            <span>{fill(copy.ui.linkBlocked, { title: b.title })}</span>
            <a className="ck-link" href={b.href} target="_blank" rel="noopener noreferrer" onClick={() => dropBlocked(b.id)}>
              {copy.ui.openLink}
            </a>
            <button className="ck-btn ck-btn-ghost" type="button" onClick={() => dropBlocked(b.id)} aria-label={copy.ui.dismiss}>
              <Icon name="x" />
            </button>
          </div>
        ))}
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
  copy: ResolvedCopy;
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
                <span className="ck-sr">{`, ${copy.ui.was} `}</span>
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
