import { describe, expect, it } from 'vitest';
import { ModelConfigError, modelFromEnv } from './model.js';

describe('modelFromEnv', () => {
  it('defaults to Bedrock and builds a provider model', () => {
    const model = modelFromEnv({ CRYPT_MODEL_ID: 'example.model-v1', AWS_REGION: 'us-east-1' });

    expect(typeof model).toBe('object');
    expect(model).toMatchObject({ modelId: 'example.model-v1' });
    expect((model as { provider: string }).provider).toMatch(/bedrock/);
  });

  it('returns the ID string for the AI Gateway', () => {
    expect(modelFromEnv({ CRYPT_MODEL_PROVIDER: 'Gateway', CRYPT_MODEL_ID: ' provider/model ' })).toBe('provider/model');
  });

  it('requires a model ID, with a provider-specific hint', () => {
    expect(() => modelFromEnv({})).toThrow(ModelConfigError);
    expect(() => modelFromEnv({})).toThrow(/Bedrock model or inference profile/);
    expect(() => modelFromEnv({ CRYPT_MODEL_PROVIDER: 'gateway' })).toThrow(/ai-gateway\.vercel\.sh/);
  });

  it('rejects unknown providers', () => {
    expect(() => modelFromEnv({ CRYPT_MODEL_PROVIDER: 'openai', CRYPT_MODEL_ID: 'x' })).toThrow(/must be one of bedrock, gateway/);
  });
});
