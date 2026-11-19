import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

const pkg = (path: string) => fileURLToPath(new URL(`../../packages/${path}`, import.meta.url));

export default defineProject({
  test: {
    name: 'poltergeist',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**', '.next/**'],
  },
  // Test against the packages' source, so `pnpm test` doesn't depend on a prior build.
  resolve: {
    alias: [
      { find: /^@crypt-kit\/core\/testing$/, replacement: pkg('core/src/testing.ts') },
      { find: /^@crypt-kit\/core$/, replacement: pkg('core/src/index.ts') },
      { find: /^@crypt-kit\/agent$/, replacement: pkg('agent/src/index.ts') },
      { find: /^@crypt-kit\/board\/server$/, replacement: pkg('board/src/server.ts') },
      { find: /^@crypt-kit\/board$/, replacement: pkg('board/src/index.ts') },
    ],
  },
});
