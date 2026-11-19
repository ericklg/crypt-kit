import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS module without types
import { generate, invalidName, namesFor, TEMPLATE_DIR } from './generate.mjs';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
const tempRoot = () => {
  const r = mkdtempSync(join(tmpdir(), 'crypt-scaffold-'));
  roots.push(r);
  return r;
};
const walk = (dir: string): string[] => readdirSync(dir).flatMap((e) => (statSync(join(dir, e)).isDirectory() ? walk(join(dir, e)) : [join(dir, e)]));

describe('create-crypt-app', () => {
  it('writes the four files to edit, a fixture test, and the wiring', () => {
    const root = tempRoot();
    const files: string[] = generate('release-wraith', { root });
    for (const f of ['detectors/items.ts', 'detectors/items.test.ts', 'detectors/fixtures.ts', 'actions/act.ts', 'prompt.ts', 'theme.ts', 'runtime.ts', 'mcp.ts', 'app/page.tsx', 'app/guard.ts', 'package.json', 'README.md']) {
      expect(files).toContain(f);
    }
    expect(files.some((f) => f.endsWith('.tmpl'))).toBe(false);
  });

  it('fills every placeholder', () => {
    const root = tempRoot();
    generate('release-wraith', { root });
    const app = join(root, 'apps', 'release-wraith');
    for (const file of walk(app)) expect(readFileSync(file, 'utf8'), file).not.toMatch(/\{\{\w+\}\}/);
    expect(JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).name).toBe('@crypt-kit/release-wraith');
    expect(readFileSync(join(app, 'runtime.ts'), 'utf8')).toContain("tableName: 'release_wraith_haunts'");
    expect(readFileSync(join(app, 'config.ts'), 'utf8')).toContain('RELEASE_WRAITH_SOURCE_URL');
    expect(readFileSync(join(app, 'theme.ts'), 'utf8')).toContain("name: 'Release Wraith'");
  });

  it('derives names that fit the store’s and env’s rules', () => {
    expect(namesFor('a1-b2')).toEqual({ name: 'a1-b2', title: 'A1 B2', table: 'a1_b2_haunts', env: 'A1_B2' });
  });

  it('refuses bad names and existing folders, and writes nothing then', () => {
    for (const bad of ['', 'x', 'Release', 'release_wraith', '-wraith', 'wraith-', 'a--b', '9lives', 'x'.repeat(31), '../evil', 'exorcist', 'store-sqlite', 'sqlite', 'sqlite-ghost']) {
      expect(invalidName(bad), bad).not.toBeNull();
    }
    // Only the whole word is reserved.
    expect(invalidName('sqlites')).toBeNull();
    const root = tempRoot();
    generate('wisp', { root });
    expect(() => generate('wisp', { root })).toThrow(/already exists/);
    expect(() => generate('../evil', { root })).toThrow(/Invalid app name/);
    expect(readdirSync(join(root, 'apps'))).toEqual(['wisp']);
  });

  it('ships templates only as .tmpl files, so the repo never compiles or tests them', () => {
    expect(walk(TEMPLATE_DIR).every((f) => f.endsWith('.tmpl'))).toBe(true);
  });
});
