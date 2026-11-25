import { describe, expect, it } from "vitest";
import type { KairosUIMessage } from "./agent-provider";
import { showTyping } from "./agent-panel";

const user: KairosUIMessage = { id: "u", role: "user", parts: [{ type: "text", text: "What's my week like?" }] };
const assistant = (parts: unknown[]): KairosUIMessage => ({ id: "a", role: "assistant", parts: parts as KairosUIMessage["parts"] });
const tool = (state: string) => ({ type: "tool-get_events", toolCallId: "t1", state, input: {} });

describe("showTyping", () => {
  it("shows dots after sending, before any reply", () => {
    expect(showTyping([user], true)).toBe(true);
    expect(showTyping([user, assistant([{ type: "step-start" }])], true)).toBe(true);
  });

  it("hides dots while text streams or a tool shows its own spinner", () => {
    expect(showTyping([user, assistant([{ type: "text", text: "Your week" }])], true)).toBe(false);
    expect(showTyping([user, assistant([tool("input-available")])], true)).toBe(false);
  });

  it("shows dots between steps, after a tool finishes", () => {
    expect(showTyping([user, assistant([tool("output-available")])], true)).toBe(true);
  });

  it("never shows when idle", () => {
    expect(showTyping([user, assistant([{ type: "text", text: "" }])], false)).toBe(false);
  });
});
