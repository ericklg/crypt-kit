'use client';

import { Icon } from '@crypt-kit/board';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  loadWatchlist,
  searchGames,
  setTarget,
  unwatchGame,
  watchGame,
  type SearchHit,
  type WatchedGame,
  type WatchlistResult,
} from './watchlist-actions';

const usd = (n: number) => `$${n.toFixed(2)}`;
const SEARCH_DELAY_MS = 350;

/**
 * The watchlist drawer (mockup A, mockups/watchlist): search to add a game, edit targets,
 * stop watching. A native modal <dialog>, so focus stays inside, Escape closes it and the
 * board behind is inert; focus returns to the Watchlist button on close.
 */
export function WatchlistDrawer({ sourceName }: { sourceName: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const searchSeq = useRef(0);
  const [games, setGames] = useState<WatchedGame[] | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'fail' } | null>(null);

  const apply = (res: WatchlistResult, ok?: string) => {
    if (res.ok) {
      setGames(res.games);
      if (ok) setMessage({ text: ok, tone: 'ok' });
    } else {
      setMessage({ text: res.message, tone: 'fail' });
    }
  };

  const load = async () => {
    setLoadFailed(false);
    try {
      const res = await loadWatchlist();
      apply(res);
      if (!res.ok) setLoadFailed(true);
    } catch {
      setLoadFailed(true);
      setMessage({ text: 'Your watchlist didn’t load. Check your connection and try again.', tone: 'fail' });
    }
  };

  const open = () => {
    dialog.current?.showModal();
    setMessage(null);
    void load();
  };

  // Search after typing pauses. Every change, even to a query too short to search, starts
  // a new sequence, so answers to older queries are dropped.
  useEffect(() => {
    const q = query.trim();
    const seq = ++searchSeq.current;
    if (q.length < 2) {
      setHits(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const id = setTimeout(async () => {
      let res: Awaited<ReturnType<typeof searchGames>>;
      try {
        res = await searchGames(q);
      } catch {
        res = { ok: false, message: 'Search didn’t go through. Check your connection and try again.' };
      }
      if (seq !== searchSeq.current) return;
      setSearching(false);
      if (res.ok) setHits(res.hits);
      else {
        setHits(null);
        setMessage({ text: res.message, tone: 'fail' });
      }
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(id);
  }, [query]);

  const run = async (key: string, call: () => Promise<WatchlistResult>, ok: string | ((games: WatchedGame[]) => string)) => {
    setBusy(key);
    try {
      const res = await call();
      apply(res, res.ok ? (typeof ok === 'string' ? ok : ok(res.games)) : undefined);
      if (res.ok) setHits((h) => h?.map((hit) => ({ ...hit, watching: res.games.some((g) => g.itemId === hit.itemId) })) ?? null);
    } catch {
      setMessage({ text: 'That didn’t go through. Check your connection and try again.', tone: 'fail' });
    } finally {
      setBusy(null);
    }
  };

  const saveTarget = (game: WatchedGame, value: string) => {
    // Enter then leaving the field would otherwise save twice.
    if (busy !== null || value.trim() === game.target.toFixed(2)) return;
    void run(`target:${game.itemId}`, () => setTarget(game.itemId, value), (list) => {
      const saved = list.find((g) => g.itemId === game.itemId);
      return saved ? `${saved.title} alerts at ${usd(saved.target)} or less.` : 'Target saved.';
    });
  };

  const onTargetSubmit = (game: WatchedGame) => (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem('target') as HTMLInputElement;
    saveTarget(game, input.value);
  };

  return (
    <>
      <button className="ck-btn" type="button" onClick={open} aria-haspopup="dialog">
        <Icon name="list" /> Watchlist
      </button>
      <dialog
        ref={dialog}
        className="wl-drawer"
        aria-labelledby="wl-title"
        // Only a click outside the drawer's box is a backdrop click; its own padding isn't.
        onClick={(e) => {
          if (e.target !== e.currentTarget) return;
          const r = e.currentTarget.getBoundingClientRect();
          const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
          if (outside) dialog.current?.close();
        }}
      >
        <button className="ck-btn ck-btn-ghost wl-close" type="button" onClick={() => dialog.current?.close()} aria-label="Close">
          <Icon name="x" />
        </button>
        <h2 id="wl-title">Your watchlist</h2>
        <p className="wl-note">We tell you when a game drops to your target. Prices from {sourceName}.</p>

        <h3 className="wl-label">Add a game</h3>
        <label className="wl-field">
          <Icon name="search" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title"
            aria-label="Search games"
            maxLength={100}
            autoComplete="off"
          />
        </label>
        {searching ? <p className="wl-note">Searching…</p> : null}
        {hits && !searching ? (
          hits.length ? (
            <ul className="wl-list" aria-label="Search results">
              {hits.map((h) => (
                <li className="wl-item" key={h.itemId}>
                  <div>
                    <b>{h.title}</b>
                    <div className="wl-meta">{h.store ? `Cheapest now at ${h.store}` : 'Cheapest price now'}</div>
                  </div>
                  <span className="wl-price">{usd(h.price)}</span>
                  {h.watching ? (
                    <span className="wl-pill">Watching</span>
                  ) : (
                    <button className="ck-btn" type="button" disabled={busy !== null} onClick={() => run(`watch:${h.itemId}`, () => watchGame(h.itemId), `Watching ${h.title}. Its target starts 20% under today’s price.`)}>
                      <Icon name="plus" /> Watch<span className="ck-sr"> {h.title}</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="wl-note">No games match “{query.trim()}”.</p>
          )
        ) : null}

        <h3 className="wl-label">Watching{games ? ` (${games.length})` : ''}</h3>
        {games === null ? (
          loadFailed ? (
            <p className="wl-note">
              Your watchlist didn’t load.{' '}
              <button className="ck-btn" type="button" onClick={() => void load()}>
                Try again
              </button>
            </p>
          ) : (
            <p className="wl-note">Loading…</p>
          )
        ) : games.length ? (
          <ul className="wl-list" aria-label="Watched games">
            {games.map((g) => (
              <li className="wl-item" key={g.itemId}>
                <div>
                  <b>{g.title}</b>
                  <div className="wl-meta">
                    {g.price === null ? 'No price right now' : <>{g.store ? `${g.store} · ` : ''}now <span className="wl-price">{usd(g.price)}</span></>}
                  </div>
                </div>
                <form className="wl-target" onSubmit={onTargetSubmit(g)}>
                  <label>
                    Target
                    <input
                      // Remounts with the saved value whenever it changes.
                      key={g.target}
                      name="target"
                      defaultValue={g.target.toFixed(2)}
                      inputMode="decimal"
                      aria-label={`Target price for ${g.title}, in dollars`}
                      onBlur={(e) => saveTarget(g, e.currentTarget.value)}
                      // All targets wait while anything saves, so no edit is dropped.
                      disabled={busy !== null}
                    />
                  </label>
                </form>
                <button className="ck-btn ck-btn-ghost" type="button" disabled={busy !== null} onClick={() => run(`remove:${g.itemId}`, () => unwatchGame(g.itemId), `Stopped watching ${g.title}.`)} aria-label={`Stop watching ${g.title}`}>
                  <Icon name="x" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="wl-note">No games yet. Search above to add one.</p>
        )}
        <p className="wl-note">Changes apply the next time prices are checked.</p>
        <div className="wl-status" role="status" aria-live="polite" data-tone={message?.tone}>
          {message?.text}
        </div>
      </dialog>
    </>
  );
}
