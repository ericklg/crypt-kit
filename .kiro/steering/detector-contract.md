---
inclusion: fileMatch
fileMatchPattern: ["packages/core/**/*.ts", "**/detectors/**/*.ts"]
---

# Detector contract

A detector turns source data into findings. It is the only part of the loop that decides *what* happened, so it must be deterministic and testable.

## Rules

1. **No AI before detection.** `poll()` must never call a model, directly or indirectly. The contract test helper asserts this with a mocked agent.
2. **Stable keys.** The same real-world item must produce the same `key` on every run. Build keys from source IDs, never from titles, timestamps or array positions.
   - Exorcist: `owner/repo#number`
   - Poltergeist: `source:itemId@price` (a further price drop creates a new haunt on purpose)
3. **Validated payloads.** Each detector declares a Zod `payloadSchema`. The runner drops findings that fail it and logs the error.
4. **Injected I/O.** Detectors get HTTP clients and clocks through `PollContext`, so tests use recorded fixtures instead of the network.
5. **Fail loudly, not partly.** If a source call fails, throw. The runner isolates the failure; it must not record a half-complete run as "everything resolved".

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
