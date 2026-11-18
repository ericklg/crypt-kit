'use server';

import type { ApproveEdits, BoardActions } from '@crypt-kit/board';
import { BoardAccessError, createBoardActions } from '@crypt-kit/board/server';
import { checkBotId } from 'botid/server';
import { refresh } from 'next/cache';
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

/**
 * Sends the board fresh views after every operation, failed ones too: a failed approve
 * still moves the haunt to action_failed, and the client needs the new revision.
 */
async function andRefresh<T>(op: Promise<T>): Promise<T> {
  try {
    return await op;
  } finally {
    refresh();
  }
}

export async function approve(key: string, edits: ApproveEdits) {
  return andRefresh(board().approve(key, edits));
}

export async function spare(key: string) {
  return andRefresh(board().spare(key));
}

export async function redraft(key: string) {
  return andRefresh(board().redraft(key));
}

export async function settle(key: string, outcome: 'done' | 'not_done') {
  return andRefresh(board().settle(key, outcome));
}

export async function run() {
  return andRefresh(board().run());
}
