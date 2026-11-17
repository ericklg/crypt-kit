import { describe, expect, it } from 'vitest';
import { hashPayload, stableStringify } from './hash.js';

describe('hashPayload', () => {
  it('ignores object key order, including nested objects', () => {
    expect(hashPayload({ a: 1, b: { c: 2, d: 3 } })).toBe(hashPayload({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it('changes when a value changes', () => {
    expect(hashPayload({ price: 4.99 })).not.toBe(hashPayload({ price: 3.99 }));
  });

  it('keeps array order significant', () => {
    expect(hashPayload([1, 2])).not.toBe(hashPayload([2, 1]));
  });

  it('handles undefined without throwing', () => {
    expect(hashPayload(undefined)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('stableStringify', () => {
  it('sorts keys', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});
