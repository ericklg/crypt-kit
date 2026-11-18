import type { Draft, Finding } from '@crypt-kit/core';
import { describe, expect, it } from 'vitest';
import type { StaleItem } from '../detectors/stale-items';
import { createCommentAndCloseAction, markerFor } from './comment-and-close';

const item = (extra: Partial<StaleItem> = {}): Finding<StaleItem> => {
  const payload: StaleItem = {
    repo: 'acme/lantern',
    number: 214,
    kind: 'issue',
    title: 'Crash when the config file is empty',
    author: 'mira',
    labels: ['bug'],
    comments: 3,
    createdAt: '2026-09-30T09:12:00.000Z',
    updatedAt: '2026-10-08T16:40:00.000Z',
    body: 'Repro…',
    lastComments: [],
    ...extra,
  };
  return {
    key: `${payload.repo}#${payload.number}`,
    kind: payload.kind,
    severity: 'low',
    title: payload.title,
    url: null,
    payload,
    observedAt: '2026-11-18T12:00:00.000Z',
  };
};

const draft = (close: boolean): Draft => ({ summary: 's', proposal: '  Thanks for the repro, @mira.  ', reasoning: 'r', options: { close } });

/** A fake GitHub that records every request and serves the given existing comments. */
function fakeGitHub(existing: Array<{ body: string; html_url: string }> = [], fail: Record<string, number> = {}) {
  const calls: Array<{ method: string; path: string; body: unknown; auth: string | null }> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    const u = new URL(req.url);
    const body = req.method === 'GET' ? null : await req.json();
    calls.push({ method: req.method, path: u.pathname + u.search, body, auth: req.headers.get('authorization') });
    const status = fail[`${req.method} ${u.pathname}`];
    if (status) return Response.json({ message: 'Nope' }, { status });
    if (req.method === 'GET') return Response.json(existing);
    if (req.method === 'POST') return Response.json({ body: (body as { body: string }).body, html_url: 'https://github.com/acme/lantern/issues/214#issuecomment-9' }, { status: 201 });
    return Response.json({ state: 'closed' });
  };
  return { fetch, calls };
}

const signal = new AbortController().signal;

describe('comment-and-close action', () => {
  it('posts the comment with its marker and leaves the issue open when close is off', async () => {
    const gh = fakeGitHub();
    const result = await createCommentAndCloseAction({ token: 'tok', fetch: gh.fetch }).run(item(), draft(false), { signal });

    expect(result).toEqual({ ok: true, message: 'Comment posted.', url: 'https://github.com/acme/lantern/issues/214#issuecomment-9' });
    expect(gh.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /repos/acme/lantern/issues/214/comments?since=2026-10-08T16%3A40%3A00.000Z&per_page=100',
      'POST /repos/acme/lantern/issues/214/comments',
    ]);
    expect(gh.calls[1]!.body).toEqual({
      body: 'Thanks for the repro, @mira.\n\n<!-- crypt-kit:exorcist acme/lantern#214@2026-10-08T16:40:00.000Z -->',
    });
    expect(gh.calls.every((c) => c.auth === 'Bearer tok')).toBe(true);
  });

  it('closes an issue as not planned only when the user kept close', async () => {
    const gh = fakeGitHub();
    const result = await createCommentAndCloseAction({ token: 'tok', fetch: gh.fetch }).run(item(), draft(true), { signal });
    expect(result).toMatchObject({ ok: true, message: 'Comment posted; issue closed.' });
    expect(gh.calls.at(-1)).toMatchObject({ method: 'PATCH', path: '/repos/acme/lantern/issues/214', body: { state: 'closed', state_reason: 'not_planned' } });
  });

  it('closes a pull request through the pulls endpoint', async () => {
    const gh = fakeGitHub();
    await createCommentAndCloseAction({ token: 'tok', fetch: gh.fetch }).run(item({ kind: 'pull_request', number: 231 }), draft(true), { signal });
    expect(gh.calls.at(-1)).toMatchObject({ method: 'PATCH', path: '/repos/acme/lantern/pulls/231', body: { state: 'closed' } });
  });

  it('does not post twice when an earlier attempt already left its comment', async () => {
    const earlier = { body: `Hello\n\n${markerFor(item().payload)}`, html_url: 'https://github.com/acme/lantern/issues/214#issuecomment-1' };
    const gh = fakeGitHub([{ body: 'unrelated', html_url: 'x' }, earlier]);
    const result = await createCommentAndCloseAction({ token: 'tok', fetch: gh.fetch }).run(item(), draft(true), { signal });

    expect(gh.calls.some((c) => c.method === 'POST')).toBe(false);
    expect(gh.calls.at(-1)).toMatchObject({ method: 'PATCH' }); // still finishes the close
    expect(result).toEqual({ ok: true, message: 'Comment was already posted; issue closed.', url: earlier.html_url });
  });

  it('posts again for a new stale spell, whose marker differs', async () => {
    const old = { body: markerFor(item({ updatedAt: '2026-05-01T00:00:00.000Z' }).payload), html_url: 'x' };
    const gh = fakeGitHub([old]);
    await createCommentAndCloseAction({ token: 'tok', fetch: gh.fetch }).run(item(), draft(false), { signal });
    expect(gh.calls.some((c) => c.method === 'POST')).toBe(true);
  });

  it('fails with GitHub’s reason, so the haunt shows the error and stays open', async () => {
    const gh = fakeGitHub([], { 'POST /repos/acme/lantern/issues/214/comments': 403 });
    await expect(createCommentAndCloseAction({ token: 'tok', fetch: gh.fetch }).run(item(), draft(true), { signal })).rejects.toThrow(
      'GitHub returned 403 for POST /repos/acme/lantern/issues/214/comments: Nope',
    );
    expect(gh.calls.some((c) => c.method === 'PATCH')).toBe(false);
  });
});
