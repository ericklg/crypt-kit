// Generates a new Crypt Kit app from ./template. Plain JS so it runs without a build.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'template');
const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
// Apps are named @crypt-kit/<name>, so these would clash with the kit's own packages and apps.
const RESERVED = new Set(['exorcist', 'poltergeist', 'core', 'board', 'agent', 'mcp', 'store-sqlite']);

/** Checks an app name: kebab-case, 2–30 characters, not one of the kit's own. Returns the problem or null. */
export function invalidName(name) {
  if (typeof name !== 'string' || name.length < 2 || name.length > 30) return 'use 2 to 30 characters';
  if (!NAME.test(name)) return 'use lowercase letters, digits and single hyphens, starting with a letter (e.g. "release-wraith")';
  if (RESERVED.has(name)) return `"${name}" is already used by the kit`;
  // SQLite reserves the sqlite_ prefix, and store-sqlite refuses such table names.
  if (namesFor(name).table.startsWith('sqlite_')) return 'don\'t start with "sqlite" as a whole word (SQLite reserves it for table names)';
  return null;
}

/** The values a template uses, from an app name like "release-wraith". */
export function namesFor(name) {
  const words = name.split('-');
  return {
    name, // release-wraith
    title: words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' '), // Release Wraith
    table: `${words.join('_')}_haunts`, // release_wraith_haunts (store-sqlite's table rules)
    env: words.join('_').toUpperCase(), // RELEASE_WRAITH
  };
}

const fill = (text, values) => text.replace(/\{\{(name|title|table|env)\}\}/g, (_, k) => values[k]);

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/**
 * Writes `apps/<name>` under `root`. Refuses to touch an existing folder. Returns the
 * files written, relative to the new app.
 */
export function generate(name, { root, templateDir = TEMPLATE_DIR } = {}) {
  const problem = invalidName(name);
  if (problem) throw new Error(`Invalid app name ${JSON.stringify(name)}: ${problem}`);
  if (!root) throw new Error('root is required');
  const target = join(root, 'apps', name);
  if (existsSync(target)) throw new Error(`apps/${name} already exists; pick another name`);
  const values = namesFor(name);
  const written = [];
  for (const source of walk(templateDir)) {
    const rel = relative(templateDir, source).replace(/\.tmpl$/, '');
    const dest = join(target, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, fill(readFileSync(source, 'utf8'), values));
    written.push(rel);
  }
  return written.sort();
}
