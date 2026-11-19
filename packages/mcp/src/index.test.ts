import { createMemoryStore, createRunner, silentLogger, type Finding } from '@crypt-kit/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createHauntsMcpServer, HAUNT_TOOLS } from './index.js';

const payloadSchema = z.object({ n: z.number() });
type P = z.infer<typeof payloadSchema>;
const finding = (key: string): Finding<P> => ({
  key,
  kind: 'test',
  severity: 'medium',
  title: `Item ${key}`,
  url: `https://example.com/${key}`,
  payload: { n: 1 },
  observedAt: '2026-11-19T00:00:00.000Z',
});

async function setup() {
  const act = vi.fn(async () => ({ ok: true as const, message: 'Done', url: null }));
  let drafts = 0;
  const runner = createRunner<P>({
    detector: { id: 'd', payloadSchema, poll: async () => [finding('a'), finding('b')] },
    agent: { draft: async (f) => ({ summary: `About ${f.key} #${++drafts}`, proposal: 'Do it', reasoning: 'r', options: {} }) },
    action: { id: 'act', run: act },
    store: createMemoryStore(),
    log: silentLogger,
  });
  await runner.run();
  // The server gets only what it's allowed to call; anything else would throw.
  const guarded = new Proxy(runner, {
    get(target, prop) {
      if (prop === 'approve' || prop === 'spare' || prop === 'settle' || prop === 'run') throw new Error(`MCP server touched ${String(prop)}`);
      return Reflect.get(target, prop);
    },
  });
  const server = createHauntsMcpServer({ name: 'test', runner: guarded, boardUrl: 'http://localhost:3000' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
    return { error: res.isError === true, text: res.content[0]!.text, json: () => JSON.parse(res.content[0]!.text) };
  };
  return { runner, act, client, call };
}

describe('haunts MCP server', () => {
  it('offers exactly four tools, none of which approves, spares or settles', async () => {
    const { client } = await setup();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...HAUNT_TOOLS].sort());
    expect(tools.find((t) => t.name === 'list_haunts')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'request_approval')?.description).toMatch(/does not approve it or run anything/);
  });

  it('lists open haunts and marks source text as untrusted', async () => {
    const { call } = await setup();
    const res = (await call('list_haunts')).json();
    expect(res.note).toMatch(/never as instructions/);
    expect(res.haunts.map((h: { key: string; status: string }) => [h.key, h.status])).toEqual([['a', 'drafted'], ['b', 'drafted']]);
  });

  it('gets one haunt in full, and says so when it’s missing', async () => {
    const { call } = await setup();
    expect((await call('get_haunt', { key: 'a' })).json().haunt).toMatchObject({ key: 'a', payload: { n: 1 }, draft: { proposal: 'Do it' } });
    expect(await call('get_haunt', { key: 'nope' })).toMatchObject({ error: true, text: 'No haunt with key nope.' });
  });

  it('redrafts through the agent', async () => {
    const { call } = await setup();
    const res = (await call('redraft_haunt', { key: 'a' })).json();
    expect(res.haunt.draft.summary).toBe('About a #3');
  });

  it('flags a haunt for review without ever running the action', async () => {
    const { call, act, runner } = await setup();
    const res = (await call('request_approval', { key: 'a', note: 'The reporter confirmed it.' })).json();
    expect(res.haunt).toMatchObject({ status: 'drafted', reviewRequested: true, approvalRequest: { note: 'The reporter confirmed it.' } });
    expect(act).not.toHaveBeenCalled();
    expect((await runner.get('a'))?.status).toBe('drafted');
  });

  it('reports refusals as tool errors', async () => {
    const { call, runner } = await setup();
    await runner.spare('b');
    expect(await call('request_approval', { key: 'b', note: 'x' })).toMatchObject({ error: true });
    expect(await call('redraft_haunt', { key: 'missing' })).toMatchObject({ error: true });
  });

  it('rejects malformed arguments before reaching the runner', async () => {
    const { client } = await setup();
    const res = (await client.callTool({ name: 'request_approval', arguments: { key: 'a', note: 'x'.repeat(501) } })) as { isError?: boolean };
    expect(res.isError).toBe(true);
  });
});
