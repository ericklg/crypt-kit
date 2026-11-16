import { describe, expect, it } from 'vitest';
import { CRYPT_KIT_VERSION } from './index.js';

describe('@crypt-kit/core', () => {
  it('exposes a semver version', () => {
    expect(CRYPT_KIT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
