import { describe, expect, it } from 'vitest';
import { accessMode, basicAuthMatches, checkBoardAccess } from './access.js';

const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
const pw = 'correct horse battery';

describe('access', () => {
  it('fails closed unless a password or the public demo is configured', () => {
    expect(accessMode({ boardPassword: null, publicDemo: false })).toBe('closed');
    expect(accessMode({ boardPassword: null, publicDemo: true })).toBe('public-demo');
    expect(accessMode({ boardPassword: pw, publicDemo: true })).toBe('password');
  });

  it('accepts only the right password, with any user name', () => {
    expect(basicAuthMatches(basic('erick', pw), pw)).toBe(true);
    expect(basicAuthMatches(basic('', pw), pw)).toBe(true);
    expect(basicAuthMatches(basic('erick', 'wrong'), pw)).toBe(false);
    expect(basicAuthMatches(basic('erick', `${pw}x`), pw)).toBe(false);
    expect(basicAuthMatches(`Bearer ${pw}`, pw)).toBe(false);
    expect(basicAuthMatches(`Basic ${Buffer.from(pw).toString('base64')}`, pw)).toBe(false); // no colon
    expect(basicAuthMatches(null, pw)).toBe(false);
  });

  it('checkBoardAccess returns the refusal to show, or null when the caller may act', () => {
    expect(checkBoardAccess({ boardPassword: null, publicDemo: false }, null)).toMatch(/Actions are off/);
    expect(checkBoardAccess({ boardPassword: pw, publicDemo: false }, null)).toMatch(/Sign in/);
    expect(checkBoardAccess({ boardPassword: pw, publicDemo: false }, basic('x', 'nope'))).toMatch(/Sign in/);
    expect(checkBoardAccess({ boardPassword: pw, publicDemo: false }, basic('x', pw))).toBeNull();
    expect(checkBoardAccess({ boardPassword: null, publicDemo: true }, null)).toBeNull();
  });
});
