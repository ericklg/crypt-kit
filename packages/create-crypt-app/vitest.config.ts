import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'create-crypt-app',
    // Template files end in .tmpl, so they're never collected as tests.
    include: ['*.test.ts'],
  },
});
