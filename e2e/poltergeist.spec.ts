// Poltergeist smoke: see a price drop, edit the verdict, claim the deal, and see the link open.
import { expect, test } from '@playwright/test';

const KEY = 'fixture:hollow-knight@7.49';

test.beforeEach(async ({ context }) => {
  // Only this machine. The claimed deal's tab is aborted rather than loading CheapShark.
  await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
});

test('claim a deal with an edited verdict', async ({ page, context }, testInfo) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Poltergeist/);

  const grave = page.locator(`[data-grave="${KEY}"]`);
  await expect(grave).toHaveAttribute('data-status', 'drafted');
  await expect(grave).toContainText('Hollow Knight');
  await page.screenshot({ path: testInfo.outputPath('1-board.png') });

  await grave.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveCSS('transform', 'none'); // slid fully in
  const verdict = drawer.getByLabel('Verdict');
  await expect(verdict).toHaveValue(/^Buy now/);
  await verdict.fill('Buy now. It’s at its all-time low. (Edited on the board.)');
  await page.screenshot({ path: testInfo.outputPath('2-drawer-edited.png') });

  // The tab opens blank on the click (so it isn't blocked), then goes to the deal.
  const tab = context.waitForEvent('page');
  const dealRequest = context.waitForEvent('request', (r) => r.url().startsWith('https://www.cheapshark.com/'));
  await drawer.getByRole('button', { name: /^Claim deal/ }).click();
  const opened = await tab;
  expect((await dealRequest).frame().page()).toBe(opened);
  await opened.close();

  await expect(page.getByText('Deal opened in a new tab.')).toBeVisible();
  await expect(grave).toHaveCount(0, { timeout: 10_000 });
  await page.screenshot({ path: testInfo.outputPath('3-claimed.png') });

  await page.reload();
  await expect(page.locator('[data-grave]').first()).toBeVisible();
  await expect(page.locator(`[data-grave="${KEY}"]`)).toHaveCount(0);
});
