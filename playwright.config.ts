// Smoke tests: each app's production build on a freshly seeded local database.
// Build first (`pnpm build`), then `pnpm e2e`. No model, no GitHub, no network.
import { defineConfig, devices } from '@playwright/test';
import { BOARD_PASSWORD, DATA_DIR, EXORCIST_PORT, FAKE_GITHUB, FAKE_GITHUB_PORT, POLTERGEIST_PORT } from './e2e/env';

/** Seeds a fresh database with the app's demo script, then starts its build. */
const serve = (app: string, db: string, port: number) =>
  `mkdir -p '${DATA_DIR}' && rm -f '${DATA_DIR}/${db}'* && node apps/${app}/scripts/seed-demo.mjs > /dev/null && cd apps/${app} && ./node_modules/.bin/next start -H 127.0.0.1 -p ${port}`;

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  forbidOnly: !!process.env.CI,
  // No retries: a test approves its seeded haunt, and the data is seeded once per server start.
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    // Pinned for both servers, so a password in the shell or .env.local can't change the result.
    httpCredentials: { username: 'e2e', password: BOARD_PASSWORD },
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 860 },
    trace: 'retain-on-failure',
    // Every run records the flow. E2E_SLOWMO=1000 slows each step so a person can follow it.
    video: { mode: 'on', size: { width: 1280, height: 860 } },
    launchOptions: { slowMo: Number(process.env.E2E_SLOWMO ?? 0) },
  },
  projects: [
    { name: 'exorcist', testMatch: 'exorcist.spec.ts', use: { baseURL: `http://127.0.0.1:${EXORCIST_PORT}` } },
    { name: 'poltergeist', testMatch: 'poltergeist.spec.ts', use: { baseURL: `http://127.0.0.1:${POLTERGEIST_PORT}` } },
  ],
  webServer: [
    {
      command: 'node e2e/fake-github.mjs',
      url: `${FAKE_GITHUB}/__writes`,
      env: { FAKE_GITHUB_PORT: String(FAKE_GITHUB_PORT) },
    },
    {
      command: serve('exorcist', 'exorcist.db', EXORCIST_PORT),
      url: `http://127.0.0.1:${EXORCIST_PORT}`,
      env: {
        CRYPT_DB_URL: `file:${DATA_DIR}/exorcist.db`,
        EXORCIST_REPOS: 'acme/lantern,acme/ember',
        GITHUB_TOKEN: 'e2e-fake-token',
        GITHUB_API_URL: FAKE_GITHUB,
        CRYPT_BOARD_PASSWORD: BOARD_PASSWORD,
      },
      timeout: 60_000,
    },
    {
      command: serve('poltergeist', 'poltergeist.db', POLTERGEIST_PORT),
      url: `http://127.0.0.1:${POLTERGEIST_PORT}`,
      env: {
        CRYPT_DB_URL: `file:${DATA_DIR}/poltergeist.db`,
        POLTERGEIST_SOURCE: 'fixture',
        // The demo list (DEMO_WATCHLIST), pinned so a live-source list in the shell or .env.local can't break the fixture.
        POLTERGEIST_WATCHLIST: 'hollow-knight:8,hades-2:25,celeste:5,outer-wilds:10,balatro:13,dead-cells:10,stardew-valley:9,disco-elysium:15',
        CRYPT_BOARD_PASSWORD: BOARD_PASSWORD,
      },
      timeout: 60_000,
    },
  ],
});
