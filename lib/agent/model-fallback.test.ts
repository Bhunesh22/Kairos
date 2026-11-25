import { APICallError, generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { withFallback } from "./model-fallback";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

function failing(modelId: string, statusCode: number) {
  return new MockLanguageModelV4({
    modelId,
    doGenerate: async () => {
      throw new APICallError({
        message: "This model is currently experiencing high demand.",
        url: "https://generativelanguage.googleapis.com",
        requestBodyValues: {},
        statusCode,
        isRetryable: statusCode === 503,
      });
    },
  });
}

function working(modelId: string, text: string) {
  return new MockLanguageModelV4({
    modelId,
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    }),
  });
}

describe("withFallback", () => {
  it("moves to the next model when one is overloaded or missing", async () => {
    const onFallback = vi.fn();
    const model = withFallback([failing("busy", 503), failing("gone", 404), working("ok", "hello")], onFallback);
    const { text } = await generateText({ model, prompt: "hi", maxRetries: 0 });
    expect(text).toBe("hello");
    expect(onFallback.mock.calls.map((c) => c[0])).toEqual(["busy", "gone"]);
  });

  it("does not hide real request errors", async () => {
    const second = working("never", "x");
    const spy = vi.spyOn(second, "doGenerate");
    const model = withFallback([failing("bad-request", 400), second]);
    await expect(generateText({ model, prompt: "hi", maxRetries: 0 })).rejects.toThrow(/high demand/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("surfaces the last error when every model is busy", async () => {
    const model = withFallback([failing("a", 503), failing("b", 429)]);
    await expect(generateText({ model, prompt: "hi", maxRetries: 0 })).rejects.toMatchObject({ statusCode: 429 });
  });
});
