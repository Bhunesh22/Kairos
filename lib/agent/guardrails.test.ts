import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { checkScope, outOfScopeReply, SCOPE_RULES } from "./guardrails";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
const msg = (role: "user" | "assistant", text: string) => ({ id: Math.random().toString(36), role, parts: [{ type: "text" as const, text }] });

/** A classifier model that answers with `verdict` and records the prompt it saw. */
function classifier(verdict: { inScope: boolean; suggestion: string }) {
  const seen: string[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      seen.push(JSON.stringify(options.prompt));
      return { content: [{ type: "text", text: JSON.stringify(verdict) }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
    },
  });
  return { model, seen };
}

describe("checkScope", () => {
  it("blocks out-of-scope messages and passes the model's suggestion through", async () => {
    const { model } = classifier({ inScope: false, suggestion: "Want me to book time with a doctor?" });
    expect(await checkScope([msg("user", "Prescribe me vitamin D")], model)).toEqual({
      inScope: false,
      suggestion: "Want me to book time with a doctor?",
    });
  });

  it("sends recent context so follow-ups are judged with the earlier turns", async () => {
    const { model, seen } = classifier({ inScope: false, suggestion: "" });
    const result = await checkScope(
      [msg("user", "I have vitamin D deficiency"), msg("assistant", "I can't prescribe medication."), msg("user", "Okay what are the symptoms")],
      model,
    );
    expect(result).toEqual({ inScope: false, suggestion: undefined });
    expect(seen[0]).toContain("vitamin D deficiency");
    expect(seen[0]).toContain("what are the symptoms");
  });

  it("fails open when the model is unavailable (the agent's own rules still apply)", async () => {
    const down = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({ message: "high demand", url: "x", requestBodyValues: {}, statusCode: 503, isRetryable: true });
      },
    });
    expect(await checkScope([msg("user", "anything")], down)).toEqual({ inScope: true });
  });

  it("skips the check when the last message isn't from the user", async () => {
    const { model, seen } = classifier({ inScope: false, suggestion: "" });
    expect(await checkScope([msg("assistant", "hello")], model)).toEqual({ inScope: true });
    expect(seen).toHaveLength(0);
  });
});

describe("scope messaging", () => {
  it("redirects to calendar help", () => {
    expect(outOfScopeReply()).toMatch(/only help with your schedule, meetings and time/);
    expect(outOfScopeReply("Want me to book a doctor's appointment?")).toMatch(/doctor's appointment\?$/);
  });

  it("tells the agent that follow-ups to off-topic requests stay off-topic", () => {
    expect(SCOPE_RULES).toMatch(/Follow-up questions about an out-of-scope topic are still out of scope/);
  });
});
