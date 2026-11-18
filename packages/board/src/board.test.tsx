import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Board } from './board.js';
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
    expect(t.calls).toContainEqual(['approve', 'a#1', { proposal: 'Edited', options: { close: true } }]);
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

    expect(t.calls.filter(([n]) => n === 'approve')).toEqual([['approve', 'a#2', { proposal: 'Comment two', options: { close: true } }]]);
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
