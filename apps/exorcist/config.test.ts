import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('config', () => {
  const env = { EXORCIST_REPOS: 'acme/lantern, acme/ember', GITHUB_TOKEN: 'github_pat_x' };

  it('reads repos, defaults and access settings', () => {
    expect(loadConfig(env)).toEqual({
      repos: ['acme/lantern', 'acme/ember'],
      staleDays: 30,
      githubToken: 'github_pat_x',
      githubApiUrl: null,
      boardPassword: null,
      publicDemo: false,
      cronSecret: null,
    });
    expect(loadConfig({ ...env, EXORCIST_STALE_DAYS: '45', CRYPT_PUBLIC_DEMO: '1' })).toMatchObject({ staleDays: 45, publicDemo: true });
  });

  it('takes a GitHub API root over https, or http only on this machine', () => {
    expect(loadConfig({ ...env, GITHUB_API_URL: 'https://ghe.example.com/api/v3/' }).githubApiUrl).toBe('https://ghe.example.com/api/v3');
    expect(loadConfig({ ...env, GITHUB_API_URL: 'http://127.0.0.1:4010' }).githubApiUrl).toBe('http://127.0.0.1:4010');
    expect(loadConfig({ ...env, GITHUB_API_URL: 'http://localhost:4010' }).githubApiUrl).toBe('http://localhost:4010');
    for (const bad of ['http://ghe.example.com', 'ftp://127.0.0.1', 'not a url']) {
      expect(() => loadConfig({ ...env, GITHUB_API_URL: bad }), bad).toThrow(/GITHUB_API_URL/);
    }
  });

  it('names the bad variables without echoing their values', () => {
    const run = () => loadConfig({ EXORCIST_REPOS: 'nope', GITHUB_TOKEN: '', CRYPT_BOARD_PASSWORD: 'hunter2' });
    expect(run).toThrow(/EXORCIST_REPOS/);
    expect(run).toThrow(/GITHUB_TOKEN/);
    expect(run).toThrow(/CRYPT_BOARD_PASSWORD/);
    expect(run).not.toThrow(/hunter2/);
  });
});
