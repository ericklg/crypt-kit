import { timingSafeEqual, createHash } from 'node:crypto';
import { getConfig, getRunner } from '../../../crypt';

const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * Scheduled run (vercel.json). Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
 * Runs only detect and draft; nothing is posted without an approval on the board.
 */
export async function GET(request: Request) {
  const secret = getConfig().cronSecret;
  const sent = request.headers.get('authorization') ?? '';
  if (!secret || !timingSafeEqual(digest(sent), digest(`Bearer ${secret}`))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const report = await getRunner().run();
  return Response.json(report, { status: report.ok ? 200 : 502 });
}
