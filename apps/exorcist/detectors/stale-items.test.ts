import { hashPayload, silentLogger, type PollContext } from '@crypt-kit/core';
import { assertDetectorContract, fixtureFetch } from '@crypt-kit/core/testing';
import { describe, expect, it } from 'vitest';
import { createStaleItemsDetector } from './stale-items';
import { FIXTURE_NOW, lanternIssues, recordedGitHubRoutes } from './fixtures/github';

const detector = (extra: Partial<Parameters<typeof createStaleItemsDetector>[0]> = {}) =>
  createStaleItemsDetector({ repos: ['acme/lantern', 'acme/ember'], ...extra });

function ctx(routes = recordedGitHubRoutes, now = FIXTURE_NOW) {
  const recorded = fixtureFetch(routes);
  const context: PollContext = { fetch: recorded.fetch, now: () => now, signal: new AbortController().signal, log: silentLogger };
  return { context, calls: recorded.calls };
}

describe('stale items detector', () => {
  it('follows the detector contract', async () => {
    await assertDetectorContract(detector(), { routes: recordedGitHubRoutes, now: FIXTURE_NOW });
  });

  it('finds open issues and PRs quiet for 30 days, keyed owner/repo#number', async () => {
    const { context } = ctx();
    const findings = await detector().poll(context);
    expect(findings.map((f) => f.key)).toEqual(['acme/lantern#214', 'acme/lantern#231', 'acme/ember#77', 'acme/ember#81']);
    expect(findings.map((f) => f.kind)).toEqual(['issue', 'pull_request', 'issue', 'issue']);
    expect(findings[1]!.url).toBe('https://github.com/acme/lantern/pull/231');
  });

  it('stops reading a repo at the first item inside the cutoff, and follows Link pages until then', async () => {
    const { context, calls } = ctx();
    await detector().poll(context);
    expect(calls.map((c) => new URL(c.url).pathname + new URL(c.url).search)).toEqual([
      '/repos/acme/lantern/issues?state=open&sort=updated&direction=asc&per_page=100',
      '/repos/acme/lantern/issues/214/comments?per_page=5&page=1',
      '/repos/acme/ember/issues?state=open&sort=updated&direction=asc&per_page=100',
      '/repositories/42/issues?state=open&sort=updated&direction=asc&per_page=100&page=2',
      '/repos/acme/ember/issues/81/comments?per_page=5&page=1',
      '/repos/acme/ember/issues/81/comments?per_page=5&page=2',
    ]);
  });

  it('does not read the next page once a page reaches the cutoff', async () => {
    const routes = recordedGitHubRoutes.map((r) =>
      String(r.match).includes('/repos/acme/lantern/issues?')
        ? { ...r, headers: { link: '<https://api.github.com/repositories/7/issues?page=2>; rel="next"' } }
        : r,
    );
    const { context, calls } = ctx(routes);
    await detector({ repos: ['acme/lantern'] }).poll(context);
    expect(calls.some((c) => c.url.includes('/repositories/7/'))).toBe(false);
  });

  it('throws instead of returning a partial list when a repo has more stale items than it reads', async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({ ...lanternIssues[0]!, number: i + 1, comments: 0 }));
    const routes = [
      {
        match: /\/(repos\/acme\/lantern|repositories\/7)\/issues\?/,
        headers: { link: '<https://api.github.com/repositories/7/issues?page=next>; rel="next"' },
        body: page,
      },
    ];
    await expect(detector({ repos: ['acme/lantern'] }).poll(ctx(routes).context)).rejects.toThrow(/more than 1000 stale items/);
  });

  it('keeps the latest comments, labels and author in the payload', async () => {
    const { context } = ctx();
    const [crash, , paths, typo] = await detector().poll(context);
    expect(crash!.payload).toMatchObject({
      repo: 'acme/lantern',
      number: 214,
      author: 'mira',
      labels: ['bug'],
      comments: 3,
      updatedAt: '2026-10-08T16:40:00.000Z',
    });
    expect(crash!.payload.lastComments.at(-1)).toEqual({ author: 'mira', body: 'Any update?', createdAt: '2026-10-08T16:40:00.000Z' });
    expect(paths!.payload.labels).toEqual(['windows']);
    // 7 comments: the latest five come from the end of page 1 and all of page 2.
    expect(typo!.payload.lastComments.map((c) => c.author)).toEqual(['user3', 'user4', 'user5', 'kai', 'lee']);
  });

  it('rates severity by how long past the cutoff an item is', async () => {
    const { context } = ctx();
    const findings = await detector().poll(context);
    expect(Object.fromEntries(findings.map((f) => [f.key, f.severity]))).toEqual({
      'acme/lantern#214': 'low', // 41 days
      'acme/lantern#231': 'low', // 35 days
      'acme/ember#77': 'high', // 90 days: 3x the cutoff
      'acme/ember#81': 'low',
    });
  });

  it('keeps the payload hash stable as days pass, so a spared ghost is not redrafted for nothing', async () => {
    const first = await detector().poll(ctx().context);
    const later = await detector().poll(ctx(recordedGitHubRoutes, new Date('2026-11-25T12:00:00Z')).context);
    expect(later.map((f) => hashPayload(f.payload))).toEqual(first.map((f) => hashPayload(f.payload)));
  });

  it('sends the token and API version to GitHub', async () => {
    let seen: Headers | null = null;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      seen = new Request(input, init).headers;
      return new Response('[]', { headers: { 'content-type': 'application/json' } });
    };
    await createStaleItemsDetector({ repos: ['acme/lantern'], token: 'github_pat_test' }).poll({ ...ctx().context, fetch });
    expect(seen!.get('authorization')).toBe('Bearer github_pat_test');
    expect(seen!.get('x-github-api-version')).toBe('2026-03-10');
  });

  it('never follows a Link page to another origin with the token', async () => {
    const routes = [
      {
        match: 'https://api.github.com/repos/acme/lantern/issues?state=open&sort=updated&direction=asc&per_page=100',
        headers: { link: '<https://evil.example/steal>; rel="next"' },
        body: [],
      },
    ];
    await expect(createStaleItemsDetector({ repos: ['acme/lantern'], token: 't' }).poll(ctx(routes).context)).rejects.toThrow(
      /Refusing to send the token/,
    );
  });

  it('throws on a failed request instead of reporting a partial list', async () => {
    const routes = [
      {
        match: /\/repos\/acme\/lantern\/issues\?/,
        status: 403,
        body: { message: 'Resource not accessible by personal access token' },
      },
    ];
    await expect(detector({ repos: ['acme/lantern'] }).poll(ctx(routes).context)).rejects.toThrow(
      'GitHub returned 403 for GET /repos/acme/lantern/issues: Resource not accessible by personal access token',
    );
  });

  it('rejects bad config', () => {
    expect(() => createStaleItemsDetector({ repos: ['not a repo'] })).toThrow(RangeError);
    expect(() => createStaleItemsDetector({ repos: ['a/b'], staleDays: 0 })).toThrow(RangeError);
  });
});
