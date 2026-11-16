#!/usr/bin/env node
// Kiro PostFileSave hook: run the Vitest tests related to the saved file.
// Kiro passes event context as JSON on STDIN. The exact field holding the
// saved path can differ between surfaces, so we look for any string value
// that points at a .ts/.tsx file under packages/ or apps/.
import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';

const root = process.cwd();

function readStdin() {
  return new Promise((done) => {
    if (process.stdin.isTTY) return done('');
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => done(data));
  });
}

function findPaths(value, out = new Set()) {
  if (typeof value === 'string') {
    if (/\.tsx?$/.test(value)) out.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) findPaths(item, out);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) findPaths(item, out);
  }
  return out;
}

const raw = (await readStdin()).trim();
const candidates = raw ? findPaths(safeParse(raw)) : new Set(process.argv.slice(2));

const files = [...candidates]
  .map((p) => relative(root, resolve(root, p)))
  .filter((p) => /^(packages|apps)\//.test(p));

if (files.length === 0) {
  console.log('related-tests: no workspace TypeScript file in the event, skipping.');
  process.exit(0);
}

const result = spawnSync('pnpm', ['exec', 'vitest', 'related', '--run', '--passWithNoTests', ...files], {
  cwd: root,
  encoding: 'utf8',
});

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
if (result.status === 0) {
  console.log(`related-tests: passed for ${files.join(', ')}`);
  process.exit(0);
}
// Non-zero exit sends stderr to the agent so it can fix the failure.
console.error(`related-tests: FAILED for ${files.join(', ')}\n${output.slice(-4000)}`);
process.exit(1);

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
