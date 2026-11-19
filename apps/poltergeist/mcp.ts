// Price Poltergeist's haunts over MCP (stdio), for Kiro: list, read, redraft, and ask for
// review. Claiming a deal stays on the board. Run with `pnpm --filter @crypt-kit/poltergeist mcp`;
// it reads the same env as the app (.env.local), including CRYPT_DB_URL.
import { createHauntsMcpServer, serveStdio } from '@crypt-kit/mcp';
import { getRunner } from './runtime';

await serveStdio(createHauntsMcpServer({ name: 'poltergeist', runner: getRunner(), boardUrl: process.env.CRYPT_BOARD_URL ?? null }));
