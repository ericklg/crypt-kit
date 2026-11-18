import { bedrock } from '@ai-sdk/amazon-bedrock';
import type { LanguageModel } from 'ai';

export const MODEL_PROVIDERS = ['bedrock', 'gateway'] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export class ModelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelConfigError';
  }
}

/**
 * Picks the model from the environment:
 *
 * - `CRYPT_MODEL_PROVIDER`: `bedrock` (default) or `gateway` (Vercel AI Gateway).
 * - `CRYPT_MODEL_ID`: required. A Bedrock model or inference profile ID, or a Gateway
 *   ID such as `provider/model`. There is no default, because model IDs change often.
 *
 * Credentials stay with the provider's own variables: Bedrock reads `AWS_REGION` plus
 * `AWS_BEARER_TOKEN_BEDROCK` or the AWS credential variables, and the Gateway reads
 * `AI_GATEWAY_API_KEY` (or Vercel OIDC when deployed).
 */
export function modelFromEnv(env: Record<string, string | undefined> = process.env): LanguageModel {
  const provider = (env.CRYPT_MODEL_PROVIDER?.trim() || 'bedrock').toLowerCase();
  const modelId = env.CRYPT_MODEL_ID?.trim();

  if (!MODEL_PROVIDERS.includes(provider as ModelProvider)) {
    throw new ModelConfigError(`CRYPT_MODEL_PROVIDER must be one of ${MODEL_PROVIDERS.join(', ')}; got ${JSON.stringify(provider)}`);
  }
  if (!modelId) {
    throw new ModelConfigError(
      provider === 'bedrock'
        ? 'Set CRYPT_MODEL_ID to a Bedrock model or inference profile ID enabled in your AWS account.'
        : 'Set CRYPT_MODEL_ID to an AI Gateway model ID such as "provider/model". List them at https://ai-gateway.vercel.sh/v1/models.',
    );
  }

  // A plain string resolves through the AI SDK's global provider, which is the AI Gateway.
  return provider === 'bedrock' ? bedrock(modelId) : modelId;
}
