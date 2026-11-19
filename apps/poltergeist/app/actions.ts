'use server';

import type { ApproveEdits, BoardActions } from '@crypt-kit/board';
import { BoardAccessError, checkBoardAccess, createBoardActions } from '@crypt-kit/board/server';
import { checkBotId } from 'botid/server';
import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { getConfig, getRunner } from '../crypt';

/**
 * Runs before every board operation. Server actions are reachable by direct POST, so this
 * is the real gate; the proxy's password prompt is only for the browser.
 */
async function guard(): Promise<void> {
  const refusal = checkBoardAccess(getConfig(), (await headers()).get('authorization'));
  if (refusal) throw new BoardAccessError(refusal);
  const verdict = await checkBotId();
  if (verdict.isBot) throw new BoardAccessError('This request looked automated, so it was refused.');
}

let actions: BoardActions | null = null;
const board = () =>
  (actions ??= createBoardActions(getRunner, {
    guard,
    messages: { runFailed: 'Prices couldn’t be checked just now. Try again in a few minutes.' },
  }));

/** Sends the board fresh views after every operation, failed ones too. */
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
