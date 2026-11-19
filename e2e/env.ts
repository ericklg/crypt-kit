// Shared by playwright.config.ts and the specs.
import { join } from 'node:path';

/** Where the seeded smoke-test databases live (gitignored). Absolute, because the seed runs
 * from the repo root and `next start` from the app's folder. */
export const DATA_DIR = join(import.meta.dirname, '.data');
export const EXORCIST_PORT = 3201;
export const POLTERGEIST_PORT = 3202;
export const FAKE_GITHUB_PORT = 4010;
export const FAKE_GITHUB = `http://127.0.0.1:${FAKE_GITHUB_PORT}`;
