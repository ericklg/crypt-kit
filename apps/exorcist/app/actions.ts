'use server';

import type { ApproveEdits, BoardActions } from '@crypt-kit/board';
import { BoardAccessError, createBoardActions } from '@crypt-kit/board/server';
import { checkBotId } from 'botid/server';
import { headers } from 'next/headers';
import { accessMode, basicAuthMatches } from '../access';
import { getConfig, getRunner } from '../crypt';

/**
 * Runs before every board operation. Server actions are reachable by direct POST, so this
 * is the real gate; the proxy's password prompt is only for the browser.
 */
async function guard(): Promise<void> {
  const config = getConfig();
  const mode = accessMode(config);
  if (mode === 'closed') {
    throw new BoardAccessError('Actions are off on this board. Set CRYPT_BOARD_PASSWORD to turn them on.');
  }
  if (mode === 'password' && !basicAuthMatches((await headers()).get('authorization'), config.boardPassword!)) {
    throw new BoardAccessError('Sign in to act on haunts. Reload the page to get the password prompt.');
  }
  const verdict = await checkBotId();
  if (verdict.isBot) throw new BoardAccessError('This request looked automated, so it was refused.');
}

let actions: BoardActions | null = null;
const board = () => (actions ??= createBoardActions(getRunner, { guard }));

export async function approve(key: string, edits: ApproveEdits) {
  return board().approve(key, edits);
}

export async function spare(key: string) {
  return board().spare(key);
}

export async function redraft(key: string) {
  return board().redraft(key);
}

export async function settle(key: string, outcome: 'done' | 'not_done') {
  return board().settle(key, outcome);
}

export async function run() {
  return board().run();
}
