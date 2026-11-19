// The app's wiring, for Next.js code only: `server-only` fails the build if a client
// component imports it, so API keys can't reach the browser. Scripts (the MCP server)
// import ./runtime directly.
import 'server-only';

export * from './runtime';
