// Exorcist smoke: see a ghost, edit its comment, banish it, and check what GitHub received.
import { expect, test } from '@playwright/test';
import { FAKE_GITHUB } from './env';

const KEY = 'acme/lantern#198';
const EDITED = 'Fixed in #205, so I’m closing this. Reopen it if the quickstart still shows the old flag. (Edited on the board.)';

test.beforeEach(async ({ context, request }) => {
  // Only this machine: a stray call to GitHub or a font CDN fails the test instead of leaking.
  await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
  await request.post(`${FAKE_GITHUB}/__reset`);
});

test('banish a stale issue with an edited comment', async ({ page, request }, testInfo) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Exorcist/);

  const grave = page.locator(`[data-grave="${KEY}"]`);
  await expect(grave).toHaveAttribute('data-status', 'drafted');
  await expect(grave).toContainText('Docs: wrong flag name in the quickstart');
  await page.screenshot({ path: testInfo.outputPath('1-board.png') });

  await grave.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveCSS('transform', 'none'); // slid fully in
  const comment = drawer.getByLabel('Comment to post');
  await expect(comment).toHaveValue(/fixed in #205/);
  await comment.fill(EDITED);
  await expect(drawer.getByLabel('Close it after commenting')).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('2-drawer-edited.png') });

  // Nothing is sent before the approval.
  expect(await (await request.get(`${FAKE_GITHUB}/__writes`)).json()).toEqual([]);

  await drawer.getByRole('button', { name: /^Banish/ }).click();
  await expect(page.getByText('Banished. Comment posted.')).toBeVisible();
  await expect(grave).toHaveCount(0, { timeout: 10_000 });
  await page.screenshot({ path: testInfo.outputPath('3-banished.png') });

  const writes = await (await request.get(`${FAKE_GITHUB}/__writes`)).json();
  expect(writes).toHaveLength(2);
  expect(writes[0]).toMatchObject({ method: 'POST', path: '/repos/acme/lantern/issues/198/comments' });
  expect(writes[0].body.body).toContain(EDITED);
  expect(writes[0].body.body).toContain('<!-- crypt-kit:exorcist acme/lantern#198@');
  expect(writes[1]).toEqual({ method: 'PATCH', path: '/repos/acme/lantern/issues/198', body: { state: 'closed', state_reason: 'not_planned' } });

  // The banish is saved: it stays gone after a reload.
  await page.reload();
  await expect(page.locator('[data-grave]').first()).toBeVisible();
  await expect(page.locator(`[data-grave="${KEY}"]`)).toHaveCount(0);
});
