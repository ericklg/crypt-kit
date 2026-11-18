import { describe, expect, it } from 'vitest';
import { accessMode, basicAuthMatches } from './access';
import { loadConfig } from './config';

const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

describe('access', () => {
  it('fails closed unless a password or the public demo is configured', () => {
    expect(accessMode({ boardPassword: null, publicDemo: false })).toBe('closed');
    expect(accessMode({ boardPassword: null, publicDemo: true })).toBe('public-demo');
    expect(accessMode({ boardPassword: 'correct horse battery', publicDemo: true })).toBe('password');
  });

  it('accepts only the right password, with any user name', () => {
    const pw = 'correct horse battery';
    expect(basicAuthMatches(basic('erick', pw), pw)).toBe(true);
    expect(basicAuthMatches(basic('', pw), pw)).toBe(true);
    expect(basicAuthMatches(basic('erick', 'wrong'), pw)).toBe(false);
    expect(basicAuthMatches(basic('erick', `${pw}x`), pw)).toBe(false);
    expect(basicAuthMatches(`Bearer ${pw}`, pw)).toBe(false);
    expect(basicAuthMatches(`Basic ${Buffer.from(pw).toString('base64')}`, pw)).toBe(false); // no colon
    expect(basicAuthMatches(null, pw)).toBe(false);
  });
});

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
