import { describe, expect, it } from 'vitest';
import { findNonJson, hashPayload, stableStringify } from './hash.js';

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

describe('findNonJson', () => {
  it('accepts plain JSON values, including null-prototype objects', () => {
    expect(findNonJson({ a: [1, 'two', true, null, { b: -0.5 }] })).toBeNull();
    expect(findNonJson(Object.assign(Object.create(null), { a: 1 }))).toBeNull();
  });

  it.each([
    [{ when: new Date() }, /payload\.when is a Date/],
    [{ tags: new Set(['x']) }, /payload\.tags is a Set/],
    [{ n: Number.NaN }, /payload\.n is NaN/],
    [{ n: Infinity }, /payload\.n is Infinity/],
    [{ missing: undefined }, /payload\.missing is undefined/],
    [{ big: 1n }, /payload\.big is bigint/],
    [{ list: [1, , 3] }, /payload\.list\[1\] is a hole/],
    [{ deep: { fn: () => 1 } }, /payload\.deep\.fn is function/],
  ])('reports %o', (value, message) => {
    expect(findNonJson(value)).toMatch(message);
  });

  it('reports object and array cycles instead of throwing', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    const arr: unknown[] = [1];
    arr.push(arr);
    const nested: Record<string, unknown> = { child: { list: [] as unknown[] } };
    ((nested.child as { list: unknown[] }).list).push(nested);

    expect(findNonJson(obj)).toMatch(/payload\.self refers back to one of its parents/);
    expect(findNonJson(arr)).toMatch(/payload\[1\] refers back/);
    expect(findNonJson(nested)).toMatch(/payload\.child\.list\[0\] refers back/);
  });

  it('allows the same object to appear twice when there is no cycle', () => {
    const shared = { id: 1 };
    expect(findNonJson({ a: shared, b: shared, list: [shared, shared] })).toBeNull();
  });
});

describe('stableStringify', () => {
  it('sorts keys', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});
