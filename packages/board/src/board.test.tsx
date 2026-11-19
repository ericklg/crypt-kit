import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Board } from './board.js';
import type { BoardTheme } from './types.js';
import { fakeActions, theme, views } from './test-fixtures.js';

const NOW = '2026-11-18T12:00:00.000Z';

function setup(opts: { actions?: ReturnType<typeof fakeActions>; defaultOpenKey?: string } = {}) {
  const fake = opts.actions ?? fakeActions();
  const utils = render(
    <Board
      theme={theme}
      haunts={views()}
      score={12}
      weeklyGoal={20}
      actions={fake.actions}
      now={NOW}
      {...(opts.defaultOpenKey ? { defaultOpenKey: opts.defaultOpenKey } : {})}
    />,
  );
  const graves = () => [...utils.container.querySelectorAll<HTMLButtonElement>('[data-grave]')];
  const grave = (key: string) => utils.container.querySelector<HTMLButtonElement>(`[data-grave="${key}"]`)!;
  const drawer = () => utils.container.querySelector<HTMLElement>('.ck-drawer')!;
  const isOpen = () => utils.container.querySelector('.ck-yard-root')!.getAttribute('data-open') === 'true';
  return { ...utils, ...fake, graves, grave, drawer, isOpen };
}

describe('Board (server render)', () => {
  it('renders the header, stats, meter and stones without any client state', () => {
    const html = renderToString(<Board theme={theme} haunts={views()} score={25} weeklyGoal={20} actions={fakeActions().actions} now={NOW} />);

    expect(html).toContain('Exorcist');
    expect(html).toContain('Crash on empty config');
    expect(html).toContain('--ck-accent:#8ef0d8');
    expect(html).toContain('aria-valuenow="20"');
    expect(html).toContain('25 of 20 banished this week, goal reached');
  });
});

describe('graves', () => {
  it('names each stone by its visible text, including meta and age', () => {
    const t = setup();
    const g = t.grave('a#2');

    expect(g.tagName).toBe('BUTTON');
    expect(g.hasAttribute('aria-label')).toBe(false);
    expect(g.textContent).toContain('acme/lantern · issue #2');
    expect(g.textContent).toContain('63 days quiet');
  });

  it('shows the empty state when nothing is haunting', () => {
    render(<Board theme={theme} haunts={[]} score={0} weeklyGoal={20} actions={fakeActions().actions} now={NOW} />);
    expect(screen.getByText('All quiet in the crypt')).toBeTruthy();
  });
});

describe('drawer', () => {
  it('opens as a modal: drawer interactive, everything behind it inert, focus on Close', () => {
    const t = setup();
    expect(t.drawer().hasAttribute('inert')).toBe(true);

    fireEvent.click(t.grave('a#1'));

    expect(t.isOpen()).toBe(true);
    expect(t.drawer().hasAttribute('inert')).toBe(false);
    expect(t.container.querySelector('.ck-yard')!.hasAttribute('inert')).toBe(true);
    expect(t.container.querySelector('.ck-head')!.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(within(t.drawer()).getByRole('button', { name: 'Close' }));
  });

  it('closes on Escape from inside the editor and returns focus to the stone', () => {
    const t = setup();
    fireEvent.click(t.grave('a#2'));
    const editor = within(t.drawer()).getByRole('textbox');
    editor.focus();

    fireEvent.keyDown(editor, { key: 'Escape' });

    expect(t.isOpen()).toBe(false);
    expect(t.drawer().hasAttribute('inert')).toBe(true);
    expect(t.container.querySelector('.ck-head')!.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(t.grave('a#2'));
  });

  it('keeps edits and the reasoning disclosure across close and reopen', () => {
    const t = setup();
    fireEvent.click(t.grave('a#1'));
    fireEvent.change(within(t.drawer()).getByRole('textbox'), { target: { value: 'My edited comment' } });
    fireEvent.click(within(t.drawer()).getByRole('checkbox'));
    const why = t.drawer().querySelector('details')!;
    why.open = true;
    fireEvent(why, new Event('toggle'));

    fireEvent.keyDown(t.drawer(), { key: 'Escape' });
    fireEvent.click(t.grave('a#1'));

    expect((within(t.drawer()).getByRole('textbox') as HTMLTextAreaElement).value).toBe('My edited comment');
    expect((within(t.drawer()).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect(t.drawer().querySelector('details')!.open).toBe(true);
  });

  it('opens a deep-linked haunt on first render', () => {
    const t = setup({ defaultOpenKey: 'a#3' });
    expect(t.isOpen()).toBe(true);
    expect(within(t.drawer()).getByRole('heading', { name: 'Webhook retries' })).toBeTruthy();
  });
});

describe('approve and spare', () => {
  it('sends the edited proposal and options, removes the stone, and moves focus to the next one', async () => {
    const t = setup();
    fireEvent.click(t.grave('a#1'));
    fireEvent.change(within(t.drawer()).getByRole('textbox'), { target: { value: 'Edited' } });
    fireEvent.click(within(t.drawer()).getByRole('checkbox'));

    fireEvent.click(within(t.drawer()).getByRole('button', { name: /Banish/ }));

    await waitFor(() => expect(t.container.querySelector('[data-grave="a#1"]')).toBeNull());
    expect(t.calls).toContainEqual(['approve', 'a#1', { proposal: 'Edited', options: { close: true }, revision: 3 }]);
    expect(document.activeElement).toBe(t.grave('a#2'));
    expect(screen.getByRole('status').textContent).toContain('Banished. Comment posted.');
  });

  it('keeps the stone and shows the error when the action fails', async () => {
    const t = setup({ actions: fakeActions({ approve: async () => ({ ok: false, message: 'GitHub returned 403.' }) }) });
    fireEvent.click(t.grave('a#1'));

    fireEvent.click(within(t.drawer()).getByRole('button', { name: /Banish/ }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('GitHub returned 403.'));
    expect(t.grave('a#1')).toBeTruthy();
    expect(t.grave('a#1').getAttribute('data-leaving')).toBeNull();
  });

  it('A acts on the focused stone, and a held key does not carry on to the next one', async () => {
    const t = setup();
    t.grave('a#2').focus();

    fireEvent.keyDown(t.grave('a#2'), { key: 'a' });
    await waitFor(() => expect(t.container.querySelector('[data-grave="a#2"]')).toBeNull());
    // Focus has moved to the next stone; the still-held key keeps sending repeats.
    expect(document.activeElement).toBe(t.grave('a#3'));
    fireEvent.keyDown(t.grave('a#3'), { key: 'a', repeat: true });
    await new Promise((r) => setTimeout(r, 20));

    expect(t.calls.filter(([n]) => n === 'approve')).toEqual([['approve', 'a#2', { proposal: 'Comment two', options: { close: true }, revision: 3 }]]);
    expect(t.grave('a#3')).toBeTruthy();
  });

  it('R spares the focused stone', async () => {
    const t = setup();
    t.grave('a#2').focus();
    fireEvent.keyDown(t.grave('a#2'), { key: 'r' });
    await waitFor(() => expect(t.calls).toContainEqual(['spare', 'a#2']));
  });

  it('ignores A on a haunt that cannot be approved', () => {
    const t = setup();
    t.grave('a#5').focus();
    fireEvent.keyDown(t.grave('a#5'), { key: 'a' });
    expect(t.calls).toEqual([]);
  });

  it('shortcuts only work inside the yard, not from the header', () => {
    const t = setup();
    const summon = screen.getByRole('button', { name: /Summon/ });
    summon.focus();
    fireEvent.keyDown(summon, { key: 'a' });
    expect(t.calls).toEqual([]);
  });
});

describe('keyboard navigation', () => {
  it('J and K move from the focused stone, not a stale selection', () => {
    const t = setup();
    t.grave('a#2').focus();

    fireEvent.keyDown(t.grave('a#2'), { key: 'j' });
    expect(document.activeElement).toBe(t.grave('a#3'));
    expect(t.grave('a#3').getAttribute('data-selected')).toBe('true');

    fireEvent.keyDown(t.grave('a#3'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(t.grave('a#2'));
  });

  it('E opens the focused stone with the editor focused', () => {
    const t = setup();
    t.grave('a#2').focus();
    fireEvent.keyDown(t.grave('a#2'), { key: 'e' });
    expect(t.isOpen()).toBe(true);
    expect(document.activeElement).toBe(within(t.drawer()).getByRole('textbox'));
  });
});

describe('states', () => {
  it('new: waiting notice, spare only', () => {
    const t = setup({ defaultOpenKey: 'a#5' });
    expect(within(t.drawer()).getByText('First in line for the next run.', { exact: false })).toBeTruthy();
    expect(within(t.drawer()).queryByRole('button', { name: /Banish/ })).toBeNull();
    expect(within(t.drawer()).getByRole('button', { name: /Spare/ })).toBeTruthy();
  });

  it('action_failed: shows the error and a retry approve', () => {
    const t = setup({ defaultOpenKey: 'a#4' });
    expect(within(t.drawer()).getByText(/GitHub returned 403/)).toBeTruthy();
    expect(within(t.drawer()).getByRole('button', { name: /Try banish again/ })).toBeTruthy();
  });

  it('approving: settle buttons stay disabled until the claim expires', async () => {
    const t = setup({ defaultOpenKey: 'a#6' });
    const happened = within(t.drawer()).getByRole('button', { name: /It happened/ }) as HTMLButtonElement;
    expect(happened.disabled).toBe(true);
    expect(within(t.drawer()).getByText('Unlocks in 10 min')).toBeTruthy();
  });

  it('approving: settle calls the action once unlocked', async () => {
    const fake = fakeActions();
    render(
      <Board theme={theme} haunts={views()} score={0} weeklyGoal={20} actions={fake.actions} now="2026-11-18T12:30:00.000Z" defaultOpenKey="a#6" />,
    );
    fireEvent.click(screen.getByRole('button', { name: /It didn’t/ }));
    await waitFor(() => expect(fake.calls).toContainEqual(['settle', 'a#6', 'not_done']));
  });

  it('draft_failed: Try again calls redraft', async () => {
    const fake = fakeActions();
    const v = views();
    v[0] = { ...v[0]!, status: 'draft_failed', draft: null, error: 'The model timed out.' };
    render(<Board theme={theme} haunts={v} score={0} weeklyGoal={20} actions={fake.actions} now={NOW} defaultOpenKey="a#1" />);
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(fake.calls).toContainEqual(['redraft', 'a#1']));
  });
});

describe('review fixes', () => {
  const board = (v: ReturnType<typeof views>, fake = fakeActions(), extra: { defaultOpenKey?: string; theme?: typeof theme } = {}) => (
    <Board
      theme={extra.theme ?? theme}
      haunts={v}
      score={0}
      weeklyGoal={20}
      actions={fake.actions}
      now={NOW}
      {...(extra.defaultOpenKey ? { defaultOpenKey: extra.defaultOpenKey } : {})}
    />
  );

  it('keeps settling locked when the deadline is unknown', () => {
    const v = views();
    v[5] = { ...v[5]!, claimExpiresAt: null };
    render(board(v, fakeActions(), { defaultOpenKey: 'a#6' }));
    expect((screen.getByRole('button', { name: /It happened/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Waiting for the first attempt to time out.')).toBeTruthy();
  });

  it('takes interface text from copy.ui and the theme verbs', () => {
    const t = { ...theme, copy: { ...theme.copy, approve: 'Claim deal', spare: 'Let it rest', ui: { keyMove: 'mover', close: 'Cerrar' } } };
    const { container } = render(board(views(), fakeActions(), { theme: t, defaultOpenKey: 'a#1' }));
    const legend = container.querySelector('.ck-keys')!.textContent!;
    expect(legend).toContain('mover');
    expect(legend).toContain('claim deal');
    expect(legend).toContain('let it rest');
    expect(legend).not.toMatch(/approve|spare/);
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeTruthy();
  });

  it('shows a key again when the runner reopens it with a newer revision', async () => {
    const fake = fakeActions();
    const { container, rerender } = render(board(views(), fake));
    const g = () => container.querySelector('[data-grave="a#1"]');
    fireEvent.click(g()!);
    fireEvent.click(within(container.querySelector('.ck-drawer')!).getByRole('button', { name: /Banish/ }));
    await waitFor(() => expect(g()).toBeNull());

    rerender(board(views(), fake)); // server hasn't caught up: same revision, still hidden
    expect(g()).toBeNull();
    rerender(board(views().slice(1), fake)); // server dropped it
    const reopened = views();
    reopened[0] = { ...reopened[0]!, revision: 9, draftId: 'd:new', draft: { ...reopened[0]!.draft!, proposal: 'Fresh draft' } };
    rerender(board(reopened, fake)); // runner reopened it later
    expect(g()).toBeTruthy();
  });

  it('shows a key again when a newer revision arrives without the key ever leaving the list', async () => {
    const fake = fakeActions();
    const { container, rerender } = render(board(views(), fake));
    const g = () => container.querySelector('[data-grave="a#1"]');
    fireEvent.click(g()!);
    fireEvent.click(within(container.querySelector('.ck-drawer')!).getByRole('button', { name: /Banish/ }));
    await waitFor(() => expect(g()).toBeNull());

    const reopened = views();
    reopened[0] = { ...reopened[0]!, revision: 9, draftId: 'd:new', draft: { ...reopened[0]!.draft!, proposal: 'Fresh draft' } };
    rerender(board(reopened, fake));
    expect(g()).toBeTruthy();
  });

  it('drops edits when the haunt gets a new draft', () => {
    const fake = fakeActions();
    const { container, rerender } = render(board(views(), fake, { defaultOpenKey: 'a#1' }));
    const box = () => within(container.querySelector('.ck-drawer')!).getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(box(), { target: { value: 'Old edit' } });
    expect(box().value).toBe('Old edit');

    const v = views();
    v[0] = { ...v[0]!, revision: 7, draftId: 'd:replaced', draft: { ...v[0]!.draft!, proposal: 'Replacement draft' } };
    rerender(board(v, fake, { defaultOpenKey: 'a#1' }));

    expect(box().value).toBe('Replacement draft');
  });

  it('focuses Close when the drawer opens from a deep link', () => {
    const { container } = render(board(views(), fakeActions(), { defaultOpenKey: 'a#2' }));
    expect(document.activeElement).toBe(container.querySelector('.ck-drawer-close'));
  });

  it('closes the drawer and returns focus to the yard when its haunt disappears', () => {
    const fake = fakeActions();
    const { container, rerender } = render(board(views(), fake, { defaultOpenKey: 'a#2' }));
    rerender(board(views().filter((v) => v.key !== 'a#2'), fake, { defaultOpenKey: 'a#2' }));
    expect(container.querySelector('.ck-yard-root')!.getAttribute('data-open')).toBe('false');
    expect(container.querySelector('.ck-yard')!.contains(document.activeElement)).toBe(true);
  });

  it('keeps focus in the open drawer when a refresh removes the focused button', () => {
    const fake = fakeActions();
    const v = views();
    v[0] = { ...v[0]!, status: 'draft_failed', draft: null, draftId: null, error: 'Timed out.' };
    const { container, rerender } = render(board(v, fake, { defaultOpenKey: 'a#1' }));
    screen.getByRole('button', { name: /Try again/ }).focus();

    rerender(board(views(), fake, { defaultOpenKey: 'a#1' })); // now drafted: Try again is gone

    expect(container.querySelector('.ck-drawer')!.contains(document.activeElement)).toBe(true);
  });

  it('reports a failed request as unconfirmed, not as nothing changed', async () => {
    const fake = fakeActions({
      approve: async () => {
        throw new Error('network');
      },
    });
    const { container } = render(board(views(), fake, { defaultOpenKey: 'a#1' }));
    fireEvent.click(within(container.querySelector('.ck-drawer')!).getByRole('button', { name: /Banish/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/couldn’t confirm what happened/));
    expect(screen.getByRole('alert').textContent).not.toMatch(/Nothing was changed/);
  });

  it('lets you spare a haunt while its redraft is in flight', async () => {
    const fake = fakeActions({ redraft: () => new Promise(() => {}) });
    const v = views();
    v[0] = { ...v[0]!, status: 'draft_failed', draft: null, draftId: null, error: 'Timed out.' };
    render(board(v, fake, { defaultOpenKey: 'a#1' }));

    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(fake.calls).toContainEqual(['redraft', 'a#1']));
    const spare = screen.getByRole('button', { name: /Spare/ }) as HTMLButtonElement;
    expect(spare.disabled).toBe(false);
    fireEvent.click(spare);

    await waitFor(() => expect(fake.calls).toContainEqual(['spare', 'a#1']));
  });
});

describe('run button', () => {
  it('calls run and reports the result', async () => {
    const t = setup();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Summon/ }));
    });
    await waitFor(() => expect(screen.getByText('Done. The board is up to date.')).toBeTruthy());
    expect(t.calls).toContainEqual(['run']);
  });
});

describe('review round 2', () => {
  const board = (v: ReturnType<typeof views>, fake = fakeActions(), extra: { defaultOpenKey?: string; theme?: typeof theme } = {}) => (
    <Board
      theme={extra.theme ?? theme}
      haunts={v}
      score={0}
      weeklyGoal={20}
      actions={fake.actions}
      now={NOW}
      {...(extra.defaultOpenKey ? { defaultOpenKey: extra.defaultOpenKey } : {})}
    />
  );
  const drawerOf = (c: HTMLElement) => c.querySelector<HTMLElement>('.ck-drawer')!;
  const graveOf = (c: HTMLElement, key: string) =>
    [...c.querySelectorAll<HTMLElement>('[data-grave]')].find((el) => el.dataset.grave === key)!;

  it('keeps edits apart for two haunts whose drafts are identical', async () => {
    const v = views();
    v[1] = { ...v[1]!, draftId: v[0]!.draftId, draft: { ...v[0]!.draft! } };
    const fake = fakeActions();
    const { container } = render(board(v, fake));
    fireEvent.click(graveOf(container, 'a#1'));
    fireEvent.change(within(drawerOf(container)).getByRole('textbox'), { target: { value: 'Only for a#1' } });
    fireEvent.keyDown(drawerOf(container), { key: 'Escape' });

    fireEvent.click(graveOf(container, 'a#2'));
    expect((within(drawerOf(container)).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Comment one');
    fireEvent.click(within(drawerOf(container)).getByRole('button', { name: /Banish/ }));
    await waitFor(() => expect(fake.calls.some((c) => c[0] === 'approve')).toBe(true));
    expect(fake.calls).toContainEqual(['approve', 'a#2', { proposal: 'Comment one', options: { close: false }, revision: 3 }]);
  });

  it('returns focus to a stone whose key contains quotes and newlines', () => {
    const odd = 'acme/"lantern"\nissue\\7';
    const v = views();
    v[0] = { ...v[0]!, key: odd };
    const { container } = render(board(v, fakeActions()));
    fireEvent.click(graveOf(container, odd));
    expect(() => fireEvent.keyDown(drawerOf(container), { key: 'Escape' })).not.toThrow();
    expect(document.activeElement).toBe(graveOf(container, odd));
  });

  it('wraps Tab and Shift+Tab inside the open drawer', () => {
    const { container } = render(board(views(), fakeActions(), { defaultOpenKey: 'a#1' }));
    const drawer = drawerOf(container);
    const close = within(drawer).getByRole('button', { name: 'Close' });
    const stops = [...drawer.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], textarea, input, summary')];
    const last = stops[stops.length - 1]!;

    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
  });

  it('brings focus back into the drawer when it moves to the host page', () => {
    const outside = document.createElement('a');
    outside.href = '#nav';
    outside.textContent = 'Host nav';
    document.body.prepend(outside);
    try {
      const { container } = render(board(views(), fakeActions(), { defaultOpenKey: 'a#1' }));
      act(() => outside.focus());
      expect(document.activeElement).toBe(within(drawerOf(container)).getByRole('button', { name: 'Close' }));

      fireEvent.keyDown(drawerOf(container), { key: 'Escape' });
      expect(document.activeElement).toBe(graveOf(container, 'a#1'));
      act(() => outside.focus());
      expect(document.activeElement).toBe(outside); // closed: the host page is reachable again
    } finally {
      outside.remove();
    }
  });

  it('takes the list label and severity tags from copy.ui', () => {
    const v = views();
    v[0] = { ...v[0]!, severity: 'high' };
    v[1] = { ...v[1]!, headline: { value: '$7', was: '$14' } };
    const t = { ...theme, copy: { ...theme.copy, ui: { listLabel: 'Tumbas', was: 'antes', severity: { high: 'Alta' } } } };
    const { container } = render(board(v, fakeActions(), { theme: t, defaultOpenKey: 'a#1' }));
    expect(container.querySelector('.ck-graves')!.getAttribute('aria-label')).toBe('Tumbas');
    expect(container.querySelector('.ck-sev')!.textContent).toBe('Alta');
    expect(container.querySelector('.ck-g-price')!.textContent).toBe('$7, antes $14');
  });

  it('lets copy.ui reorder the meter text and rename the Enter keycap', () => {
    const t = {
      ...theme,
      copy: { ...theme.copy, ui: { goalProgress: '{scoreLabel}: {score}/{goal}', openCount: '{openLabel} ({count})', keyEnter: 'Eingabe' } },
    };
    const { container } = render(<Board theme={t} haunts={views()} score={12} weeklyGoal={20} actions={fakeActions().actions} now={NOW} />);
    const top = container.querySelectorAll('.ck-meter-top > span');
    expect(top[0]!.textContent).toBe(`${theme.copy.scoreLabel}: 12/20`);
    expect(top[0]!.querySelector('b')!.textContent).toBe('12');
    expect(top[1]!.textContent).toBe(`${theme.copy.openLabel} (6)`);
    expect(container.querySelector('.ck-bar')!.getAttribute('aria-valuetext')).toBe(`${theme.copy.scoreLabel}: 12/20`);
    expect(container.querySelector('.ck-keys')!.textContent).toContain('Eingabe');
  });
});

describe('review round 3', () => {
  const board = (v: ReturnType<typeof views>, fake = fakeActions(), extra: { defaultOpenKey?: string } = {}) => (
    <Board
      theme={theme}
      haunts={v}
      score={0}
      weeklyGoal={20}
      actions={fake.actions}
      now={NOW}
      {...(extra.defaultOpenKey ? { defaultOpenKey: extra.defaultOpenKey } : {})}
    />
  );
  const drawerOf = (c: HTMLElement) => c.querySelector<HTMLElement>('.ck-drawer')!;
  const graveOf = (c: HTMLElement, key: string) =>
    [...c.querySelectorAll<HTMLElement>('[data-grave]')].find((el) => el.dataset.grave === key) ?? null;

  it.each(['approved', 'spared', 'resolved'] as const)('shows no Spare button for a %s haunt that kept its draft', (status) => {
    const v = views();
    v[0] = { ...v[0]!, status };
    const { container } = render(board(v, fakeActions(), { defaultOpenKey: 'a#1' }));
    expect(within(drawerOf(container)).queryByRole('button', { name: /Spare/ })).toBeNull();
  });

  it('does not report a redraft conflict that lands after Spare succeeded', async () => {
    let finishRedraft!: (r: { ok: false; message: string }) => void;
    const fake = fakeActions({ redraft: () => new Promise((resolve) => (finishRedraft = resolve)) });
    const v = views();
    v[0] = { ...v[0]!, status: 'draft_failed', draft: null, draftId: null, error: 'Timed out.' };
    const { container } = render(board(v, fake, { defaultOpenKey: 'a#1' }));

    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    fireEvent.click(screen.getByRole('button', { name: /Spare/ }));
    await waitFor(() => expect(graveOf(container, 'a#1')).toBeNull());
    expect(screen.getByRole('status').textContent).toContain('Spared');

    await act(async () => finishRedraft({ ok: false, message: 'Someone else changed this haunt.' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Spared');
  });

  it('still reports a redraft failure when nothing superseded it', async () => {
    const fake = fakeActions({ redraft: async () => ({ ok: false, message: 'The model is down.' }) });
    const v = views();
    v[0] = { ...v[0]!, status: 'draft_failed', draft: null, draftId: null, error: 'Timed out.' };
    render(board(v, fake, { defaultOpenKey: 'a#1' }));
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('The model is down.'));
  });

  it('moves focus to the next stone as soon as the drawer closes, before the request ends', async () => {
    let finish!: (r: { ok: boolean; message: string }) => void;
    const fake = fakeActions({ approve: () => new Promise((resolve) => (finish = resolve as typeof finish)) });
    const { container } = render(board(views(), fake, { defaultOpenKey: 'a#1' }));

    fireEvent.click(within(drawerOf(container)).getByRole('button', { name: /Banish/ }));
    expect(document.activeElement).toBe(graveOf(container, 'a#2'));

    await waitFor(() => expect(fake.calls.some((c) => c[0] === 'approve')).toBe(true));
    await act(async () => finish({ ok: false, message: 'GitHub returned 500.' }));
    expect(document.activeElement).toBe(graveOf(container, 'a#1')); // failed: back to the stone
  });

  it('does not take focus back from where the user moved it during the request', async () => {
    let finish!: (r: { ok: true }) => void;
    const fake = fakeActions({ spare: () => new Promise((resolve) => (finish = resolve)) });
    const { container } = render(board(views(), fake, { defaultOpenKey: 'a#1' }));

    fireEvent.click(within(drawerOf(container)).getByRole('button', { name: /Spare/ }));
    fireEvent.keyDown(graveOf(container, 'a#2')!, { key: 'j' });
    expect(document.activeElement).toBe(graveOf(container, 'a#3'));

    await waitFor(() => expect(fake.calls.some((c) => c[0] === 'spare')).toBe(true));
    await act(async () => finish({ ok: true }));
    expect(graveOf(container, 'a#1')).toBeNull();
    expect(document.activeElement).toBe(graveOf(container, 'a#3'));
  });
});

describe('review round 5', () => {
  const graveOf = (c: HTMLElement, key: string) =>
    [...c.querySelectorAll<HTMLElement>('[data-grave]')].find((el) => el.dataset.grave === key) ?? null;

  it.each(['toString', '__proto__', 'constructor'])('treats a haunt keyed %s like any other', async (key) => {
    const v = views();
    v[0] = { ...v[0]!, key };
    const fake = fakeActions();
    const { container } = render(<Board theme={theme} haunts={v} score={0} weeklyGoal={20} actions={fake.actions} now={NOW} defaultOpenKey={key} />);
    const banish = within(container.querySelector<HTMLElement>('.ck-drawer')!).getByRole('button', { name: /Banish/ }) as HTMLButtonElement;
    expect(banish.disabled).toBe(false);
    fireEvent.click(banish);
    await waitFor(() => expect(fake.calls.some((c) => c[0] === 'approve' && c[1] === key)).toBe(true));
  });

  it('does not park focus on a stone that is itself leaving', async () => {
    const fake = fakeActions({ approve: () => new Promise(() => {}) });
    const { container } = render(<Board theme={theme} haunts={views().slice(0, 3)} score={0} weeklyGoal={20} actions={fake.actions} now={NOW} />);

    fireEvent.click(graveOf(container, 'a#2')!);
    fireEvent.click(within(container.querySelector<HTMLElement>('.ck-drawer')!).getByRole('button', { name: /Banish/ }));
    expect(document.activeElement).toBe(graveOf(container, 'a#3'));

    fireEvent.keyDown(graveOf(container, 'a#3')!, { key: 'a' });
    expect(document.activeElement).toBe(graveOf(container, 'a#1')); // not a#2, which is fading out
  });
});

describe('approve opens a link', () => {
  const linkTheme = { ...theme, approveOpensLink: true };
  const drawerOf = (c: HTMLElement) => c.querySelector<HTMLElement>('.ck-drawer')!;
  const fakeTab = () => ({ closed: false, opener: {} as unknown, location: { replace: vi.fn() }, close: vi.fn() });
  const render1 = (approve: () => Promise<{ ok: true; url?: string } | { ok: false; message: string }>, t: BoardTheme = linkTheme) =>
    render(<Board theme={t} haunts={views()} score={0} weeklyGoal={20} actions={fakeActions({ approve }).actions} now={NOW} defaultOpenKey="a#1" />);

  it('opens the tab during the click and points it at the link once the server confirms', async () => {
    const tab = fakeTab();
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as never);
    const { container } = render1(async () => ({ ok: true, url: 'https://www.cheapshark.com/redirect?dealID=abc%3D' }));

    fireEvent.click(within(drawerOf(container)).getByRole('button', { name: /Banish/ }));
    expect(open).toHaveBeenCalledWith('', '_blank'); // synchronously, inside the click
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith('https://www.cheapshark.com/redirect?dealID=abc%3D'));
    expect(tab.opener).toBeNull();
    expect(tab.close).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('closes the tab when the approve fails', async () => {
    const tab = fakeTab();
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as never);
    const { container } = render1(async () => ({ ok: false, message: 'Nope' }));
    fireEvent.click(within(drawerOf(container)).getByRole('button', { name: /Banish/ }));
    await waitFor(() => expect(tab.close).toHaveBeenCalled());
    expect(tab.location.replace).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('offers the link in the message when the browser blocked the tab', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { container } = render1(async () => ({ ok: true, url: 'https://example.com/deal' }));
    fireEvent.click(within(drawerOf(container)).getByRole('button', { name: /Banish/ }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Your browser blocked the new tab for Crash on empty config.');
    const link = within(alert).getByRole('link', { name: 'Open it here' }) as HTMLAnchorElement;
    expect(link.href).toBe('https://example.com/deal');
    expect(link.rel).toBe('noopener noreferrer');
    open.mockRestore();
  });

  it('keeps the blocked-tab message until it’s used or dismissed', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { container } = render1(async () => ({ ok: true, url: 'https://example.com/deal' }));
    fireEvent.click(within(drawerOf(container)).getByRole('button', { name: /Banish/ }));
    await screen.findByRole('alert');
    await act(() => new Promise((r) => setTimeout(r, 2800))); // past the normal message timeout
    const alert = screen.getByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
    open.mockRestore();
  }, 10_000);

  it('keeps each blocked link when later claims or spares show their own messages', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const urls: Record<string, string> = { 'a#1': 'https://example.com/one', 'a#2': 'https://example.com/two' };
    const { container } = render(
      <Board theme={linkTheme} haunts={views()} score={0} weeklyGoal={20} now={NOW}
        actions={fakeActions({ approve: async (key: string) => ({ ok: true, url: urls[key]! }) }).actions} />,
    );
    const grave = (k: string) => [...container.querySelectorAll<HTMLElement>('[data-grave]')].find((el) => el.dataset.grave === k)!;

    fireEvent.click(grave('a#1'));
    fireEvent.click(within(drawerOf(container)).getByRole('button', { name: /Banish/ }));
    await waitFor(() => expect(screen.getAllByRole('link', { name: 'Open it here' })).toHaveLength(1));
    fireEvent.click(grave('a#2'));
    fireEvent.click(within(drawerOf(container)).getByRole('button', { name: /Banish/ }));
    await waitFor(() => expect(screen.getAllByRole('link', { name: 'Open it here' })).toHaveLength(2));
    fireEvent.click(grave('a#3'));
    fireEvent.click(within(drawerOf(container)).getByRole('button', { name: /Spare/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Spared'));

    const links = screen.getAllByRole('link', { name: 'Open it here' }) as HTMLAnchorElement[];
    expect(links.map((l) => l.href)).toEqual(['https://example.com/one', 'https://example.com/two']);
    fireEvent.click(links[0]!);
    expect((screen.getAllByRole('link', { name: 'Open it here' }) as HTMLAnchorElement[]).map((l) => l.href)).toEqual(['https://example.com/two']);
    open.mockRestore();
  });

  it('never opens a non-https link', async () => {
    const tab = fakeTab();
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as never);
    const { container } = render1(async () => ({ ok: true, url: 'javascript:alert(1)' }));
    fireEvent.click(within(drawerOf(container)).getByRole('button', { name: /Banish/ }));
    await waitFor(() => expect(tab.close).toHaveBeenCalled());
    expect(tab.location.replace).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'Open it here' })).toBeNull();
    open.mockRestore();
  });

  it('opens nothing for themes without approveOpensLink, or on Spare', async () => {
    const open = vi.spyOn(window, 'open');
    const { container, unmount } = render1(async () => ({ ok: true, url: 'https://example.com' }), theme);
    fireEvent.click(within(drawerOf(container)).getByRole('button', { name: /Banish/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Banished'));
    unmount();

    const again = render1(async () => ({ ok: true }));
    fireEvent.click(within(drawerOf(again.container)).getByRole('button', { name: /Spare/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Spared'));
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
});

describe('header actions', () => {
  it('renders app controls in the header, before the run button', () => {
    const html = renderToString(
      <Board theme={theme} haunts={views()} score={0} weeklyGoal={20} now={NOW} actions={fakeActions().actions} headerActions={<button type="button">Watchlist</button>} />,
    );
    const head = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
    expect(head.indexOf('Watchlist')).toBeGreaterThan(-1);
    expect(head.indexOf('Watchlist')).toBeLessThan(head.indexOf('Summon'));
  });
});

describe('review requests', () => {
  it('shows an assistant’s review request and its note in the drawer, with approval still the user’s', () => {
    const v = views();
    v[0] = { ...v[0]!, approvalRequest: { note: 'The reporter confirmed the fix on 2.5.0.', at: NOW } };
    render(<Board theme={theme} haunts={v} score={0} weeklyGoal={20} now={NOW} actions={fakeActions().actions} defaultOpenKey="a#1" />);
    const drawer = document.querySelector<HTMLElement>('.ck-drawer')!;
    expect(within(drawer).getByText('Your assistant asked you to review this')).toBeTruthy();
    expect(within(drawer).getByText('The reporter confirmed the fix on 2.5.0.')).toBeTruthy();
    expect(within(drawer).getByText('Nothing happens until you press Banish.')).toBeTruthy();
  });

  it('shows nothing extra without one', () => {
    render(<Board theme={theme} haunts={views()} score={0} weeklyGoal={20} now={NOW} actions={fakeActions().actions} defaultOpenKey="a#1" />);
    expect(screen.queryByText('Your assistant asked you to review this')).toBeNull();
  });
});
