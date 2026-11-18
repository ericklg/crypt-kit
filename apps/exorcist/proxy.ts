import { NextResponse, type NextRequest } from 'next/server';
import { BASIC_AUTH_REALM, basicAuthMatches } from './access';

/**
 * Asks the browser for CRYPT_BOARD_PASSWORD (HTTP Basic) when it is set. This is only the
 * prompt: app/actions.ts checks the password again on every action.
 */
export function proxy(request: NextRequest) {
  const password = process.env.CRYPT_BOARD_PASSWORD;
  if (!password || basicAuthMatches(request.headers.get('authorization'), password)) return NextResponse.next();
  return new NextResponse('Sign in to use this board.', {
    status: 401,
    headers: { 'www-authenticate': `Basic realm="${BASIC_AUTH_REALM}", charset="UTF-8"` },
  });
}

export const config = {
  // Everything except Next's static assets and the cron route, which has its own secret.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/cron).*)'],
};
