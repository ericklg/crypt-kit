import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('config', () => {
  const env = { EXORCIST_REPOS: 'acme/lantern, acme/ember', GITHUB_TOKEN: 'github_pat_x' };

  it('reads repos, defaults and access settings', () => {
    expect(loadConfig(env)).toEqual({
      repos: ['acme/lantern', 'acme/ember'],
      staleDays: 30,
      githubToken: 'github_pat_x',
      boardPassword: null,
      publicDemo: false,
      cronSecret: null,
    });
    expect(loadConfig({ ...env, EXORCIST_STALE_DAYS: '45', CRYPT_PUBLIC_DEMO: '1' })).toMatchObject({ staleDays: 45, publicDemo: true });
  });

  it('names the bad variables without echoing their values', () => {
    const run = () => loadConfig({ EXORCIST_REPOS: 'nope', GITHUB_TOKEN: '', CRYPT_BOARD_PASSWORD: 'hunter2' });
    expect(run).toThrow(/EXORCIST_REPOS/);
    expect(run).toThrow(/GITHUB_TOKEN/);
    expect(run).toThrow(/CRYPT_BOARD_PASSWORD/);
    expect(run).not.toThrow(/hunter2/);
  });
});
