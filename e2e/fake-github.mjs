#!/usr/bin/env node
// A stand-in for GitHub's REST API, just enough for Exorcist's comment-and-close action.
// It records every write so a test can check what would have been posted.
//   GET  /__writes  → the recorded POST and PATCH requests
//   POST /__reset   → forget them
// Listens on 127.0.0.1 only. Nothing here reaches the network.
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_GITHUB_PORT ?? 4010);
const LOGIN = 'crypt-kit-bot';
let writes = [];

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(raw ? JSON.parse(raw) : null));
  });

const ISSUE = /^\/repos\/([^/]+\/[^/]+)\/(issues|pulls)\/(\d+)$/;
const COMMENTS = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/comments$/;

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (pathname === '/__writes') return send(res, 200, writes);
  if (pathname === '/__reset' && req.method === 'POST') {
    writes = [];
    return send(res, 200, { ok: true });
  }
  if (req.headers.authorization !== 'Bearer e2e-fake-token') return send(res, 401, { message: 'Bad credentials' });

  if (pathname === '/user' && req.method === 'GET') return send(res, 200, { login: LOGIN });

  const comments = COMMENTS.exec(pathname);
  if (comments && req.method === 'GET') return send(res, 200, []);
  if (comments && req.method === 'POST') {
    const body = await readBody(req);
    writes.push({ method: 'POST', path: pathname, body });
    const [, repo, number] = comments;
    return send(res, 201, { body: body.body, html_url: `https://github.com/${repo}/issues/${number}#issuecomment-1`, user: { login: LOGIN } });
  }

  const issue = ISSUE.exec(pathname);
  // Quiet since long before any seeded draft, so the action sees an unchanged thread.
  if (issue && req.method === 'GET') return send(res, 200, { state: 'open', updated_at: '2000-01-01T00:00:00Z' });
  if (issue && req.method === 'PATCH') {
    const body = await readBody(req);
    writes.push({ method: 'PATCH', path: pathname, body });
    return send(res, 200, { state: body.state });
  }

  send(res, 404, { message: 'Not Found' });
});

server.listen(PORT, '127.0.0.1', () => console.log(`fake GitHub on http://127.0.0.1:${PORT}`));
