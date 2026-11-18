import { withBotId } from 'botid/next/config';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
};

// Adds BotID's challenge and proxy rewrites, so the client check in
// instrumentation-client.ts can complete outside Vercel's automatic routing too.
export default withBotId(nextConfig);
