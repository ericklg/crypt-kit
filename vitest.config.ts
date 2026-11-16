import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Match the pnpm workspace so app-local detector tests are discovered too.
    projects: ['packages/*', 'apps/*'],
  },
});
