import type { FixtureRoute } from '@crypt-kit/core/testing';

/**
 * GitHub REST responses (API 2026-03-10) for two repos, trimmed to the fields the
 * detector reads plus a few it must ignore. Shaped on GitHub's documented responses;
 * replace with recordings from the sandbox repo once it exists.
 *
 * Clock for these fixtures: 2026-11-18T12:00:00Z, 30-day cutoff 2026-10-19T12:00:00Z.
 */
export const FIXTURE_NOW = new Date('2026-11-18T12:00:00Z');

const API = 'https://api.github.com';
const user = (login: string) => ({ login, id: 1, type: 'User', site_admin: false });

const issue = (repo: string, number: number, extra: Record<string, unknown>) => ({
  id: 1_000_000 + number,
  node_id: `I_${number}`,
  number,
  state: 'open',
  locked: false,
  html_url: `https://github.com/${repo}/issues/${number}`,
  url: `${API}/repos/${repo}/issues/${number}`,
  user: user('someone'),
  labels: [],
  assignees: [],
  comments: 0,
  body: null,
  author_association: 'NONE',
  created_at: '2026-01-01T00:00:00Z',
  ...extra,
});

const comment = (login: string, body: string, created_at: string) => ({
  id: Date.parse(created_at),
  user: user(login),
  body,
  created_at,
  updated_at: created_at,
  author_association: 'CONTRIBUTOR',
});

export const lanternIssues = [
  issue('acme/lantern', 214, {
    title: 'Crash when the config file is empty',
    body: 'Repro: `touch lantern.toml && lantern start` throws `TypeError: cannot read properties of undefined`.',
    user: user('mira'),
    labels: [{ id: 1, name: 'bug', color: 'd73a4a' }],
    comments: 3,
    created_at: '2026-09-30T09:12:00Z',
    updated_at: '2026-10-08T16:40:00Z',
  }),
  issue('acme/lantern', 231, {
    title: 'Add retries to the webhook sender',
    html_url: 'https://github.com/acme/lantern/pull/231',
    body: 'Retries failed webhook deliveries three times with backoff.',
    user: user('devin'),
    pull_request: { url: `${API}/repos/acme/lantern/pulls/231`, html_url: 'https://github.com/acme/lantern/pull/231', merged_at: null },
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-14T08:00:00Z',
  }),
  // Fresh: the detector must stop here.
  issue('acme/lantern', 240, { title: 'Flaky test on macOS runners', updated_at: '2026-11-10T11:00:00Z' }),
];

export const emberPage1 = [
  issue('acme/ember', 77, {
    title: 'Paths with spaces break on Windows',
    labels: ['windows'],
    created_at: '2026-06-02T00:00:00Z',
    updated_at: '2026-08-20T07:30:00Z',
  }),
];

export const emberPage2 = [
  issue('acme/ember', 81, {
    title: 'Typo in the timeout error message',
    body: 'It says "timout".',
    comments: 7,
    created_at: '2026-10-02T00:00:00Z',
    updated_at: '2026-10-16T13:00:00Z',
  }),
  issue('acme/ember', 90, { title: 'Recently active', updated_at: '2026-11-17T09:00:00Z' }),
];

export const recordedGitHubRoutes: FixtureRoute[] = [
  { match: `${API}/repos/acme/lantern/issues?state=open&sort=updated&direction=asc&per_page=100`, body: lanternIssues },
  {
    match: `${API}/repos/acme/lantern/issues/214/comments?per_page=5&page=1`,
    body: [
      comment('mira', 'Still happening on 2.4.1.', '2026-10-01T10:00:00Z'),
      comment('ops-bot', 'This issue has been labeled bug.', '2026-10-01T10:01:00Z'),
      comment('mira', 'Any update?', '2026-10-08T16:40:00Z'),
    ],
  },
  {
    match: `${API}/repos/acme/ember/issues?state=open&sort=updated&direction=asc&per_page=100`,
    headers: { link: `<${API}/repositories/42/issues?state=open&sort=updated&direction=asc&per_page=100&page=2>; rel="next", <${API}/repositories/42/issues?state=open&sort=updated&direction=asc&per_page=100&page=2>; rel="last"` },
    body: emberPage1,
  },
  { match: `${API}/repositories/42/issues?state=open&sort=updated&direction=asc&per_page=100&page=2`, body: emberPage2 },
  {
    // 7 comments: the latest five span pages 1 and 2.
    match: `${API}/repos/acme/ember/issues/81/comments?per_page=5&page=1`,
    body: [1, 2, 3, 4, 5].map((n) => comment(`user${n}`, `Comment ${n}`, `2026-10-0${n}T00:00:00Z`)),
  },
  {
    match: `${API}/repos/acme/ember/issues/81/comments?per_page=5&page=2`,
    body: [comment('kai', 'I can take this.', '2026-10-10T00:00:00Z'), comment('lee', 'Thanks!', '2026-10-16T13:00:00Z')],
  },
];
