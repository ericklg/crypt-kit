import { ModelConfigError } from '@crypt-kit/agent';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ error: null as Error | null }));

vi.mock('next/server', () => ({ connection: async () => {} }));
vi.mock('./actions', () => ({ approve: vi.fn(), spare: vi.fn(), redraft: vi.fn(), settle: vi.fn(), run: vi.fn() }));
vi.mock('../crypt', () => ({
  getConfig: () => ({ repos: ['acme/lantern'] }),
  getRunner: () => {
    throw state.error;
  },
}));

const { default: Page } = await import('./page');

describe('page setup errors', () => {
  it('explains a missing model setting instead of failing the request', async () => {
    state.error = new ModelConfigError('CRYPT_MODEL_ID is required');
    const el = (await Page()) as { props: { message: string } };
    expect(el.props.message).toBe('CRYPT_MODEL_ID is required');
  });

  it('lets unrelated errors through', async () => {
    state.error = new Error('database is down');
    await expect(Page()).rejects.toThrow('database is down');
  });
});
