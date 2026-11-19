#!/usr/bin/env node
// pnpm create-app <name>  →  apps/<name>, a working Crypt Kit app to fill in.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, namesFor } from './generate.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const name = process.argv[2];
if (!name) {
  console.error('usage: pnpm create-app <name>   (e.g. pnpm create-app release-wraith)');
  process.exit(1);
}
try {
  const files = generate(name, { root });
  const { title, env } = namesFor(name);
  console.log(`Created apps/${name} (${title}), ${files.length} files.\n`);
  console.log('Next:');
  console.log('  pnpm install');
  console.log(`  pnpm --filter @crypt-kit/${name} test      # the detector's contract test`);
  console.log(`  CRYPT_PUBLIC_DEMO=1 pnpm --filter @crypt-kit/${name} dev`);
  console.log(`\nThen edit detectors/items.ts (what to watch, ${env}_SOURCE_URL), actions/act.ts (what approving does),`);
  console.log('prompt.ts (what to draft) and theme.ts (how it looks). See its README.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
