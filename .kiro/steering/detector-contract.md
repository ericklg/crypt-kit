---
inclusion: fileMatch
fileMatchPattern: ["packages/core/**/*.ts", "**/detectors/**/*.ts"]
---

# Detector contract

A detector turns source data into findings. It is the only part of the loop that decides *what* happened, so it must be deterministic and testable.

## Rules

1. **No AI before detection.** `poll()` must never call a model, directly or indirectly. The contract test helper enforces this by failing on any network call outside the recorded fixtures.
2. **Stable keys.** The same real-world item must produce the same `key` on every run. Build keys from source IDs, never from titles, timestamps or array positions.
   - Exorcist: `owner/repo#number`
   - Poltergeist: `source:itemId@price` (a further price drop creates a new haunt on purpose)
3. **Validated payloads.** Each detector declares a Zod `payloadSchema`. The runner drops findings that fail it and logs the error.
4. **Payloads are plain JSON.** Haunts are stored as JSON and reloaded by other runs and processes, so the validated payload may only contain strings, finite numbers, booleans, null, arrays and plain objects. Use ISO strings for dates (`z.iso.datetime()`, not `z.coerce.date()`). The runner drops non-JSON payloads, and the contract helper fails on them.
5. **Payloads hold only what matters.** A spared haunt is re-drafted when its payload hash changes, so leave out values that drift every run (e.g. "days stale", fetch timestamps). Put them in `title` or compute them in the UI instead.
6. **Injected I/O.** Detectors get HTTP clients and clocks through `PollContext`, so tests use recorded fixtures instead of the network.
7. **Fail loudly, not partly.** If a source call fails, throw. The runner isolates the failure; it must not record a half-complete run as "everything resolved".

## Shape

```ts
export interface Detector<P> {
  id: string;
  payloadSchema: z.ZodType<P>;
  poll(ctx: PollContext): Promise<Finding<P>[]>;
}
```

## Every new detector ships with

- fixtures recorded from the real source (secrets stripped)
- a contract test using the kit's helper: stable keys across two polls, schema-valid payloads, zero model calls

```ts
import { assertDetectorContract } from '@crypt-kit/core/testing';

it('follows the detector contract', async () => {
  await assertDetectorContract(staleIssuesDetector, { routes: recordedGitHubRoutes });
});
```

The helper serves only the recorded routes through `ctx.fetch` and swaps global `fetch` for a stub that throws, so any unrecorded network call (including a model call) fails the test.
