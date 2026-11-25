import { APICallError } from "ai";
import type { LanguageModelV4 } from "@ai-sdk/provider";

/**
 * Status codes that mean "this model can't serve you right now", not "your
 * request is wrong": overloaded (503), rate-limited (429), internal (500),
 * or the model ID isn't available to this key (404).
 */
const FALLBACK_STATUSES = new Set([404, 429, 500, 503]);

export function shouldFallBack(err: unknown): boolean {
  return APICallError.isInstance(err) && (err.isRetryable || FALLBACK_STATUSES.has(err.statusCode ?? 0));
}

/**
 * One model that tries `models` in order, moving to the next when one is
 * overloaded or unavailable. Each step of the agent loop falls back
 * independently, so a busy model only costs one extra request.
 */
export function withFallback(models: LanguageModelV4[], onFallback?: (from: string, err: unknown) => void): LanguageModelV4 {
  if (!models.length) throw new Error("withFallback needs at least one model");
  const [primary] = models;

  async function attempt<T>(call: (model: LanguageModelV4) => PromiseLike<T>): Promise<T> {
    let lastError: unknown;
    for (const model of models) {
      try {
        return await call(model);
      } catch (err) {
        if (!shouldFallBack(err)) throw err;
        lastError = err;
        onFallback?.(model.modelId, err);
      }
    }
    throw lastError;
  }

  return {
    specificationVersion: "v4",
    provider: primary.provider,
    modelId: models.map((m) => m.modelId).join(" → "),
    supportedUrls: primary.supportedUrls,
    doGenerate: (options) => attempt((m) => m.doGenerate(options)),
    doStream: (options) => attempt((m) => m.doStream(options)),
  };
}
