import { boardPasswordChallenge } from '@crypt-kit/board/server';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Asks the browser for CRYPT_BOARD_PASSWORD (HTTP Basic) when it is set. This is only the
 * prompt: app/actions.ts checks the password again on every action.
 */
export function proxy(request: NextRequest) {
  return boardPasswordChallenge(process.env.CRYPT_BOARD_PASSWORD, request.headers.get('authorization'), 'Exorcist') ?? NextResponse.next();
}

export const config = {
  // Everything except Next's static assets and the cron route, which has its own secret.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/cron).*)'],
};
