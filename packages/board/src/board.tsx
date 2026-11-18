import type { CSSProperties } from 'react';
import { resolveCopy } from './copy.js';
import { Icon } from './icons.js';
import { RunButton } from './run-button.js';
import type { BoardActions, BoardTheme, HauntView, Palette } from './types.js';
import { Yard } from './yard.js';

export interface BoardProps {
  theme: BoardTheme;
  /** From `toHauntView`, oldest first. */
  haunts: HauntView[];
  /** Haunts approved this week. */
  score: number;
  weeklyGoal: number;
  actions: BoardActions;
  /** Server time (ISO). Defaults to now. */
  now?: string;
  /** Open this haunt's drawer on first render. */
  defaultOpenKey?: string;
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The theme palette as `--ck-*` custom properties. */
export function paletteVars(palette: Palette): CSSProperties {
  return Object.fromEntries(Object.entries(palette).map(([k, v]) => [`--ck-${kebab(k)}`, v])) as CSSProperties;
}

/**
 * The haunted board (visual spec: mockup B, Graveyard). A server component: the header,
 * stats and HUD render on the server, and only the yard, drawer and run button hydrate.
 * Import '@crypt-kit/board/board.css' once in the app.
 */
export function Board({ theme, haunts, score, weeklyGoal, actions, now, defaultOpenKey }: BoardProps) {
  const { creature } = theme;
  const copy = resolveCopy(theme.copy);
  const { ui } = copy;
  const pct = weeklyGoal > 0 ? Math.min(100, Math.round((score / weeklyGoal) * 100)) : 0;

  return (
    <div className="ck-board" data-theme={theme.id} data-motion={theme.motion ?? 'full'} style={paletteVars(theme.palette)}>
      <header className="ck-head" data-ck-backdrop="">
        <div className="ck-brand">
          <div className="ck-brand-mark">
            <Icon name={creature} size="lg" />
          </div>
          <div>
            <h1 className="ck-brand-name">{copy.name}</h1>
            <div className="ck-brand-sub">{copy.sub}</div>
          </div>
        </div>
        <div className="ck-stats">
          <div className="ck-stat ck-accent">
            <b>{haunts.length}</b>
            <span>{copy.openLabel}</span>
          </div>
          <div className="ck-stat">
            <b>{score}</b>
            <span>{copy.scoreLabel}</span>
          </div>
          <RunButton label={copy.run} ui={{ running: ui.running, runDone: ui.runDone, runFailed: ui.runFailed }} run={actions.run} />
        </div>
      </header>

      <div className="ck-hud" data-ck-backdrop="">
        <div className="ck-meter">
          <div className="ck-meter-top">
            <span>
              <b>{score}</b> {ui.of} {weeklyGoal} {copy.scoreLabel}
            </span>
            <span>
              {haunts.length} {copy.openLabel}
            </span>
          </div>
          <div
            className="ck-bar"
            role="progressbar"
            aria-label={ui.weeklyGoal}
            aria-valuemin={0}
            aria-valuemax={weeklyGoal}
            aria-valuenow={Math.min(score, weeklyGoal)}
            aria-valuetext={`${score} ${ui.of} ${weeklyGoal} ${copy.scoreLabel}${score > weeklyGoal ? `, ${ui.goalReached}` : ''}`}
          >
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="ck-keys" aria-label={ui.keysLabel}>
          <span>
            <kbd>J</kbd> <kbd>K</kbd> {ui.keyMove}
          </span>
          <span>
            <kbd>Enter</kbd> {ui.keyOpen}
          </span>
          <span>
            <kbd>A</kbd> {copy.approve.toLowerCase()}
          </span>
          <span>
            <kbd>R</kbd> {copy.spare.toLowerCase()}
          </span>
        </div>
      </div>

      <Yard
        views={haunts}
        copy={copy}
        creature={creature}
        actions={actions}
        now={now ?? new Date().toISOString()}
        defaultOpenKey={defaultOpenKey ?? null}
        motion={theme.motion ?? 'full'}
      />
    </div>
  );
}
