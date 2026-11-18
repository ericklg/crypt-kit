import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

const core = (path: string) => fileURLToPath(new URL(`../core/src/${path}`, import.meta.url));

export default defineProject({
  test: {
    name: 'board',
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
  resolve: {
    alias: [
      { find: /^@crypt-kit\/core\/testing$/, replacement: core('testing.ts') },
      { find: /^@crypt-kit\/core$/, replacement: core('index.ts') },
    ],
  },
});
