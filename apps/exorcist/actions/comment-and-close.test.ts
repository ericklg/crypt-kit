import type { Draft, Finding } from '@crypt-kit/core';
import { describe, expect, it } from 'vitest';
import type { StaleItem } from '../detectors/stale-items';
import { createCommentAndCloseAction, markerFor } from './comment-and-close';

const QUIET_SINCE = '2026-10-08T16:40:00.000Z';

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
    updatedAt: QUIET_SINCE,
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

type Comment = { body: string; html_url: string; user: { login: string } };
const by = (login: string, body: string, html_url = 'x'): Comment => ({ body, html_url, user: { login } });

/** A fake GitHub: the token belongs to `maintainer`; the item is open and unchanged unless told otherwise. */
function fakeGitHub(opts: { comments?: Comment[]; issue?: { state: string; updated_at: string }; fail?: Record<string, number> } = {}) {
  const calls: Array<{ method: string; path: string; body: unknown; auth: string | null }> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    const u = new URL(req.url);
    const body = req.method === 'GET' ? null : await req.json();
    calls.push({ method: req.method, path: u.pathname + u.search, body, auth: req.headers.get('authorization') });
    const status = opts.fail?.[`${req.method} ${u.pathname}`];
    if (status) return Response.json({ message: 'Nope' }, { status });
    if (u.pathname === '/user') return Response.json({ login: 'Maintainer' });
    if (req.method === 'GET' && u.pathname.endsWith('/comments')) return Response.json(opts.comments ?? []);
    if (req.method === 'GET') return Response.json(opts.issue ?? { state: 'open', updated_at: '2026-10-08T16:40:00Z' });
    if (req.method === 'POST') {
      return Response.json({ body: (body as { body: string }).body, html_url: 'https://github.com/acme/lantern/issues/214#issuecomment-9', user: { login: 'maintainer' } }, { status: 201 });
    }
    return Response.json({ state: 'closed' });
  };
  const writes = () => calls.filter((c) => c.method !== 'GET');
  return { fetch, calls, writes };
}

const signal = new AbortController().signal;
const action = (gh: ReturnType<typeof fakeGitHub>) => createCommentAndCloseAction({ token: 'tok', fetch: gh.fetch });

describe('comment-and-close action', () => {
  it('posts the comment with its marker and leaves the issue open when close is off', async () => {
    const gh = fakeGitHub();
    const result = await action(gh).run(item(), draft(false), { signal });

    expect(result).toEqual({ ok: true, message: 'Comment posted.', url: 'https://github.com/acme/lantern/issues/214#issuecomment-9' });
    expect(gh.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /user',
      'GET /repos/acme/lantern/issues/214/comments?since=2026-10-08T16%3A40%3A00.000Z&per_page=100',
      'GET /repos/acme/lantern/issues/214',
      'POST /repos/acme/lantern/issues/214/comments',
    ]);
    expect(gh.calls.at(-1)!.body).toEqual({
      body: 'Thanks for the repro, @mira.\n\n<!-- crypt-kit:exorcist acme/lantern#214@2026-10-08T16:40:00.000Z -->',
    });
    expect(gh.calls.every((c) => c.auth === 'Bearer tok')).toBe(true);
  });

  it('closes an issue as not planned only when the user kept close', async () => {
    const gh = fakeGitHub();
    const result = await action(gh).run(item(), draft(true), { signal });
    expect(result).toMatchObject({ ok: true, message: 'Comment posted; issue closed.' });
    expect(gh.calls.at(-1)).toMatchObject({ method: 'PATCH', path: '/repos/acme/lantern/issues/214', body: { state: 'closed', state_reason: 'not_planned' } });
  });

  it('closes a pull request through the pulls endpoint', async () => {
    const gh = fakeGitHub();
    await action(gh).run(item({ kind: 'pull_request', number: 231 }), draft(true), { signal });
    expect(gh.calls.at(-1)).toMatchObject({ method: 'PATCH', path: '/repos/acme/lantern/pulls/231', body: { state: 'closed' } });
  });

  it('does not post twice when our earlier attempt already left its comment, even though the thread moved', async () => {
    const earlier = by('maintainer', `Hello\n\n${markerFor(item().payload)}`, 'https://github.com/acme/lantern/issues/214#issuecomment-1');
    // Our own comment bumped updated_at; that must not block finishing the retry.
    const gh = fakeGitHub({ comments: [by('mira', 'unrelated'), earlier], issue: { state: 'open', updated_at: '2026-11-18T12:00:00Z' } });
    const result = await action(gh).run(item(), draft(true), { signal });

    expect(gh.writes().map((c) => c.method)).toEqual(['PATCH']); // no second POST; still finishes the close
    expect(result).toEqual({ ok: true, message: 'Comment was already posted; issue closed.', url: earlier.html_url });
  });

  it('ignores a copied marker in someone else’s comment', async () => {
    const spoof = by('mallory', markerFor(item().payload));
    const gh = fakeGitHub({ comments: [spoof] });
    const result = await action(gh).run(item(), draft(false), { signal });
    expect(gh.writes().map((c) => c.method)).toEqual(['POST']);
    expect(result).toMatchObject({ message: 'Comment posted.' });
  });

  it('refuses to post on a thread that changed after the draft was written', async () => {
    const gh = fakeGitHub({ comments: [by('mira', 'Fixed on main, thanks!')], issue: { state: 'open', updated_at: '2026-11-17T09:00:00Z' } });
    await expect(action(gh).run(item(), draft(true), { signal })).rejects.toThrow(/changed on GitHub after the draft was written, so nothing was posted/);
    expect(gh.writes()).toEqual([]);
  });

  it('refuses to post on an item that was closed after the draft was written', async () => {
    const gh = fakeGitHub({ issue: { state: 'closed', updated_at: '2026-10-08T16:40:00Z' } });
    await expect(action(gh).run(item(), draft(false), { signal })).rejects.toThrow(/was closed on GitHub/);
    expect(gh.writes()).toEqual([]);
  });

  it('posts again for a new stale spell, whose marker differs', async () => {
    const old = by('maintainer', markerFor(item({ updatedAt: '2026-05-01T00:00:00.000Z' }).payload));
    const gh = fakeGitHub({ comments: [old] });
    await action(gh).run(item(), draft(false), { signal });
    expect(gh.writes().map((c) => c.method)).toEqual(['POST']);
  });

  it('refuses to post when it could not read every comment since the item went quiet', async () => {
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const req = new Request(input, init);
      calls.push(req.method);
      if (new URL(req.url).pathname === '/user') return Response.json({ login: 'maintainer' });
      const next = '<https://api.github.com/repositories/7/issues/214/comments?page=n>; rel="next"';
      return Response.json([by('mira', 'unrelated')], { headers: { link: next } });
    };
    await expect(createCommentAndCloseAction({ token: 'tok', fetch }).run(item(), draft(true), { signal })).rejects.toThrow(/Nothing was posted/);
    expect(calls.filter((m) => m !== 'GET')).toEqual([]);
  });

  it('fails with GitHub’s reason, so the haunt shows the error and stays open', async () => {
    const gh = fakeGitHub({ fail: { 'POST /repos/acme/lantern/issues/214/comments': 403 } });
    await expect(action(gh).run(item(), draft(true), { signal })).rejects.toThrow(
      'GitHub returned 403 for POST /repos/acme/lantern/issues/214/comments: Nope',
    );
    expect(gh.calls.some((c) => c.method === 'PATCH')).toBe(false);
  });
});
