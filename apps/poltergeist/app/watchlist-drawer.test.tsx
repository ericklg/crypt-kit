// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  loadWatchlist: vi.fn(),
  searchGames: vi.fn(),
  setTarget: vi.fn(),
  unwatchGame: vi.fn(),
  watchGame: vi.fn(),
}));
vi.mock('./watchlist-actions', () => actions);

const { WatchlistDrawer } = await import('./watchlist-drawer');

const game = (itemId: string, title: string, target: number) => ({ itemId, title, target, price: 9.99, store: 'Steam' });
const list = (...games: ReturnType<typeof game>[]) => ({ ok: true as const, games });
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

beforeAll(() => {
  // jsdom doesn't implement modal dialogs.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});
beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
  actions.loadWatchlist.mockResolvedValue(list(game('celeste', 'Celeste', 5), game('balatro', 'Balatro', 13)));
});
afterEach(() => cleanup());

const openDrawer = () => {
  render(<WatchlistDrawer sourceName="demo data" />);
  fireEvent.click(screen.getByRole('button', { name: 'Watchlist' }));
  return document.querySelector('dialog')!;
};

describe('watchlist drawer', () => {
  it('offers a retry when the watchlist fails to load', async () => {
    actions.loadWatchlist.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const dialog = openDrawer();
    const retry = await within(dialog).findByRole('button', { name: 'Try again' });
    expect(within(dialog).queryByText('Loading…')).toBeNull();
    fireEvent.click(retry);
    expect(await within(dialog).findByText('Celeste')).toBeTruthy();
  });

  it('drops a search answer that arrives after the query was cleared', async () => {
    const slow = deferred<unknown>();
    actions.searchGames.mockReturnValueOnce(slow.promise);
    const dialog = openDrawer();
    const box = within(dialog).getByRole('searchbox', { name: 'Search games' });
    fireEvent.change(box, { target: { value: 'bala' } });
    await waitFor(() => expect(actions.searchGames).toHaveBeenCalledWith('bala'));
    fireEvent.change(box, { target: { value: 'b' } });
    await act(async () => slow.resolve({ ok: true, hits: [{ itemId: 'balatro', title: 'Balatro', price: 12.49, store: 'Steam', watching: true }] }));
    expect(within(dialog).queryByRole('list', { name: 'Search results' })).toBeNull();
  });

  it('ends “Searching…” and says so when a search request fails', async () => {
    actions.searchGames.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const dialog = openDrawer();
    fireEvent.change(within(dialog).getByRole('searchbox', { name: 'Search games' }), { target: { value: 'bala' } });
    expect(await within(dialog).findByText(/Search didn’t go through/)).toBeTruthy();
    expect(within(dialog).queryByText('Searching…')).toBeNull();
  });

  it('locks every target while one saves, so no edit is silently dropped', async () => {
    const save = deferred<unknown>();
    actions.setTarget.mockReturnValueOnce(save.promise);
    const dialog = openDrawer();
    const celeste = (await within(dialog).findByRole('textbox', { name: /Celeste/ })) as HTMLInputElement;
    const balatro = within(dialog).getByRole('textbox', { name: /Balatro/ }) as HTMLInputElement;
    fireEvent.change(celeste, { target: { value: '4.50' } });
    fireEvent.blur(celeste);
    await waitFor(() => expect(balatro.disabled).toBe(true));
    await act(async () => save.resolve(list(game('celeste', 'Celeste', 4.5), game('balatro', 'Balatro', 13))));
    expect(balatro.disabled).toBe(false);
    expect(within(dialog).getByText('Celeste alerts at $4.50 or less.')).toBeTruthy();
  });

  it('closes on a backdrop click but not on a click in its own padding', async () => {
    const dialog = openDrawer();
    await within(dialog).findByText('Celeste');
    dialog.getBoundingClientRect = () => ({ left: 900, right: 1440, top: 0, bottom: 1000, width: 540, height: 1000, x: 900, y: 0, toJSON: () => ({}) });
    fireEvent.click(dialog, { clientX: 920, clientY: 500 }); // inside, on the padding
    expect(dialog.open).toBe(true);
    fireEvent.click(dialog, { clientX: 400, clientY: 500 }); // the backdrop
    expect(dialog.open).toBe(false);
  });
});
