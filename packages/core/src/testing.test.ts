import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Detector } from './detector.js';
import { assertDetectorContract, DetectorContractError, fixtureFetch, type FixtureRoute } from './testing.js';

const payloadSchema = z.object({ stars: z.number() });
type Payload = z.infer<typeof payloadSchema>;

const routes: FixtureRoute[] = [
  { match: 'https://api.example.com/items', body: [{ id: 7, name: 'Lantern', stars: 3 }] },
];

/** A well-behaved detector: reads through ctx.fetch and builds keys from source IDs. */
const goodDetector: Detector<Payload> = {
  id: 'good',
  payloadSchema,
  async poll(ctx) {
    const res = await ctx.fetch('https://api.example.com/items', { signal: ctx.signal });
    const items = (await res.json()) as { id: number; name: string; stars: number }[];
    return items.map((item) => ({
      key: `item#${item.id}`,
      kind: 'item',
      severity: 'low' as const,
      title: item.name,
      url: `https://example.com/items/${item.id}`,
      payload: { stars: item.stars },
      observedAt: ctx.now().toISOString(),
    }));
  },
};

describe('assertDetectorContract', () => {
  it('passes a detector that follows the contract', async () => {
    const report = await assertDetectorContract(goodDetector, { routes });

    expect(report.findings.map((f) => f.key)).toEqual(['item#7']);
    expect(report.calls).toEqual([
      { method: 'GET', url: 'https://api.example.com/items' },
      { method: 'GET', url: 'https://api.example.com/items' },
    ]);
  });

  it('fails a detector whose keys change between identical polls', async () => {
    let n = 0;
    const unstable: Detector<Payload> = {
      ...goodDetector,
      id: 'unstable',
      async poll(ctx) {
        const findings = await goodDetector.poll(ctx);
        return findings.map((f) => ({ ...f, key: `${f.key}-${n++}` }));
      },
    };

    await expect(assertDetectorContract(unstable, { routes })).rejects.toThrow(/keys changed between identical polls/);
  });

  it('fails a detector that calls the network outside its fixtures', async () => {
    const leaky: Detector<Payload> = {
      ...goodDetector,
      id: 'leaky',
      async poll(ctx) {
        await ctx.fetch('https://api.openai.example/v1/chat');
        return goodDetector.poll(ctx);
      },
    };

    await expect(assertDetectorContract(leaky, { routes })).rejects.toThrow(/Unrecorded request/);
  });

  it('fails a detector that uses global fetch, and restores global fetch afterwards', async () => {
    const original = globalThis.fetch;
    const sneaky: Detector<Payload> = {
      ...goodDetector,
      id: 'sneaky',
      async poll() {
        await fetch('https://bedrock.example/invoke');
        return [];
      },
    };

    await expect(assertDetectorContract(sneaky, { routes })).rejects.toThrow(/used global fetch/);
    expect(globalThis.fetch).toBe(original);
  });

  it('reports every invalid payload and duplicate key', async () => {
    const sloppy: Detector<Payload> = {
      ...goodDetector,
      id: 'sloppy',
      async poll(ctx) {
        const [f] = await goodDetector.poll(ctx);
        return [f!, f!, { ...f!, key: 'item#8', payload: { stars: 'lots' } as unknown as Payload }];
      },
    };

    const error = await assertDetectorContract(sloppy, { routes }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DetectorContractError);
    const problems = (error as DetectorContractError).problems;
    expect(problems.some((p) => p.includes('duplicate key item#7'))).toBe(true);
    expect(problems.some((p) => p.includes('(item#8) payload'))).toBe(true);
  });

  it('fails when fixtures produce no findings unless that is allowed', async () => {
    const empty = [{ match: 'https://api.example.com/items', body: [] }];

    await expect(assertDetectorContract(goodDetector, { routes: empty })).rejects.toThrow(/no findings/);
    await expect(assertDetectorContract(goodDetector, { routes: empty, requireFindings: false })).resolves.toMatchObject({
      findings: [],
    });
  });
});

describe('fixtureFetch', () => {
  it('matches by method and RegExp and records each call', async () => {
    const { fetch, calls } = fixtureFetch([
      { match: /\/items\/\d+$/, body: { ok: true } },
      { match: 'https://api.example.com/items', method: 'POST', status: 201, body: 'created' },
    ]);

    const get = await fetch('https://api.example.com/items/42');
    const post = await fetch('https://api.example.com/items', { method: 'POST' });

    expect(await get.json()).toEqual({ ok: true });
    expect(post.status).toBe(201);
    expect(await post.text()).toBe('created');
    expect(calls).toEqual([
      { method: 'GET', url: 'https://api.example.com/items/42' },
      { method: 'POST', url: 'https://api.example.com/items' },
    ]);
    await expect(fetch('https://api.example.com/items', { method: 'DELETE' })).rejects.toThrow(/Unrecorded request/);
  });
});
