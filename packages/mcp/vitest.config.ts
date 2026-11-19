import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

const core = (path: string) => fileURLToPath(new URL(`../core/src/${path}`, import.meta.url));

export default defineProject({
  test: {
    name: 'mcp',
    include: ['src/**/*.test.ts'],
  },
  // Test against core's source, so `pnpm test` doesn't depend on a prior build.
  resolve: {
    alias: [
      { find: /^@crypt-kit\/core\/testing$/, replacement: core('testing.ts') },
      { find: /^@crypt-kit\/core$/, replacement: core('index.ts') },
    ],
  },
});
