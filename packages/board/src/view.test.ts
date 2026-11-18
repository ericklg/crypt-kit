import { sampleHaunt } from '@crypt-kit/core/testing';
import { describe, expect, it } from 'vitest';
import { toHauntView } from './view.js';

describe('toHauntView', () => {
  it('keeps only what the board shows and drops the payload and internals', () => {
    const haunt = sampleHaunt({
      key: 'acme/lantern#214',
      status: 'drafted',
      draft: { summary: 's', proposal: 'p', reasoning: 'r', options: { close: true } },
      claimExpiresAt: '2026-11-18T12:00:00.000Z',
    });

    const view = toHauntView(haunt, {
      meta: () => 'acme/lantern · issue #214',
      age: () => '41 days quiet',
      headline: () => ({ value: '$7.49', was: '$14.99' }),
    });

    expect(view).toMatchObject({ key: 'acme/lantern#214', meta: 'acme/lantern · issue #214', age: '41 days quiet', facts: [] });
    expect(view.headline).toEqual({ value: '$7.49', was: '$14.99' });
    expect(view.claimExpiresAt).toBeNull(); // only exposed for approving haunts
    const json = JSON.stringify(view);
    expect(json).not.toContain('payload');
    expect(json).not.toContain('payloadHash');
    expect(json).not.toContain('version');
  });

  it('exposes claimExpiresAt for approving haunts', () => {
    const view = toHauntView(sampleHaunt({ status: 'approving', claimExpiresAt: '2026-11-18T12:00:00.000Z' }), {
      meta: () => '',
      age: () => '',
    });
    expect(view.claimExpiresAt).toBe('2026-11-18T12:00:00.000Z');
  });
});
