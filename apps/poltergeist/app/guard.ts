import 'server-only';
import { BoardAccessError, checkBoardAccess } from '@crypt-kit/board/server';
import { checkBotId } from 'botid/server';
import { headers } from 'next/headers';
import { getConfig } from '../crypt';

/**
 * Runs before every server action (board and watchlist). Server actions are reachable by
 * direct POST, so this is the real gate; the proxy's password prompt is only for the browser.
 */
export async function guard(): Promise<void> {
  const refusal = checkBoardAccess(getConfig(), (await headers()).get('authorization'));
  if (refusal) throw new BoardAccessError(refusal);
  // BotID runs only on Vercel (it needs Vercel's OIDC token); elsewhere the access gate
  // above is the protection.
  if (!process.env.VERCEL) return;
  const verdict = await checkBotId();
  if (verdict.isBot) throw new BoardAccessError('This request looked automated, so it was refused.');
}
