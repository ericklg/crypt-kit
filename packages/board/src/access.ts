import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Who may act on haunts. Actions can reach the outside world with the app's credentials,
 * so apps fail closed:
 * - `password`: CRYPT_BOARD_PASSWORD is set. The browser asks for it (HTTP Basic), and every
 *   server action checks it again, since actions are reachable by direct POST.
 * - `public-demo`: CRYPT_PUBLIC_DEMO=1. Anyone may act. Only for demo data.
 * - `closed`: neither is set. The board is readable, but every action is refused.
 */
export type AccessMode = 'password' | 'public-demo' | 'closed';

export interface AccessConfig {
  boardPassword: string | null;
  publicDemo: boolean;
}

export function accessMode(config: AccessConfig): AccessMode {
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

/**
 * The access part of a server action's guard: the message to refuse with, or null when the
 * caller may act. `authorization` is the request's Authorization header.
 */
export function checkBoardAccess(config: AccessConfig, authorization: string | null): string | null {
  const mode = accessMode(config);
  if (mode === 'closed') return 'Actions are off on this board. Set CRYPT_BOARD_PASSWORD to turn them on.';
  if (mode === 'password' && !basicAuthMatches(authorization, config.boardPassword!)) {
    return 'Sign in to act on haunts. Reload the page to get the password prompt.';
  }
  return null;
}

/**
 * The browser prompt for CRYPT_BOARD_PASSWORD, for an app's Next.js proxy: null lets the
 * request through, otherwise send the returned 401. Only the prompt: actions check again.
 */
export function boardPasswordChallenge(password: string | undefined, authorization: string | null, realm: string): Response | null {
  if (!password || basicAuthMatches(authorization, password)) return null;
  return new Response('Sign in to use this board.', {
    status: 401,
    headers: { 'www-authenticate': `Basic realm="${realm.replace(/["\\]/g, '')}", charset="UTF-8"` },
  });
}
