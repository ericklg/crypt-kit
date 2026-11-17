import { describe, expect, it } from 'vitest';
import { assertTrackerStoreContract, sampleHaunt, TrackerStoreContractError } from './testing.js';
import { checkPutVersion, createMemoryStore, type TrackerStore } from './tracker.js';

describe('createMemoryStore', () => {
  it('meets the TrackerStore contract', async () => {
    await assertTrackerStoreContract(async () => createMemoryStore());
  });
});

describe('assertTrackerStoreContract', () => {
  it('catches a store that overwrites without checking versions', async () => {
    const lastWriteWins = (): TrackerStore => {
      const rows = new Map<string, ReturnType<typeof sampleHaunt>>();
      return {
        async get(key) {
          const row = rows.get(key);
          return row ? structuredClone(row) : null;
        },
        async put(haunt) {
          rows.set(haunt.key, structuredClone(haunt));
          return true;
        },
        async list() {
          return [...rows.values()].map((h) => structuredClone(h));
        },
      };
    };

    const error = await assertTrackerStoreContract(async () => lastWriteWins()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TrackerStoreContractError);
    const problems = (error as TrackerStoreContractError).problems.join('\n');
    expect(problems).toMatch(/must not overwrite an existing key/);
    expect(problems).toMatch(/stale expected version must fail/);
    expect(problems).toMatch(/exactly one concurrent put/);
  });
});

describe('checkPutVersion', () => {
  it('accepts version 1 for an insert and expected + 1 for an update', () => {
    expect(() => checkPutVersion(sampleHaunt({ version: 1 }), null)).not.toThrow();
    expect(() => checkPutVersion(sampleHaunt({ version: 4 }), 3)).not.toThrow();
  });

  it('rejects skipped versions and invalid expected versions', () => {
    expect(() => checkPutVersion(sampleHaunt({ version: 2 }), null)).toThrow(RangeError);
    expect(() => checkPutVersion(sampleHaunt({ version: 3 }), 1)).toThrow(RangeError);
    expect(() => checkPutVersion(sampleHaunt({ version: 1 }), 0)).toThrow(RangeError);
  });
});
