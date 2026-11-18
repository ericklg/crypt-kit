import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Who may act on haunts. Actions post to GitHub with the maintainer's token, so the app
 * fails closed:
 * - `password`: CRYPT_BOARD_PASSWORD is set. The browser asks for it (HTTP Basic), and every
 *   server action checks it again, since actions are reachable by direct POST.
 * - `public-demo`: CRYPT_PUBLIC_DEMO=1. Anyone may act. Only for the sandbox repo.
 * - `closed`: neither is set. The board is readable, but every action is refused.
 */
export type AccessMode = 'password' | 'public-demo' | 'closed';

export function accessMode(config: { boardPassword: string | null; publicDemo: boolean }): AccessMode {
  if (config.boardPassword) return 'password';
  return config.publicDemo ? 'public-demo' : 'closed';
}

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Checks an `Authorization: Basic …` header against the password, in constant time. Any user name. */
export function basicAuthMatches(header: string | null, password: string): boolean {
  if (!header?.startsWith('Basic ')) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const colon = decoded.indexOf(':');
  if (colon === -1) return false;
  return timingSafeEqual(digest(decoded.slice(colon + 1)), digest(password));
}

export const BASIC_AUTH_REALM = 'Exorcist';
