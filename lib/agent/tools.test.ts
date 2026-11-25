import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { ToolExecutionOptions } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/lib/db/schema";
import type { CalendarProvider } from "@/lib/calendar/provider";
import type { CalEvent } from "@/lib/google/types";
import { normalizeRule } from "@/lib/scheduling/rules";
import type { Session } from "@/lib/session";
import { parseLocal, toLocal } from "@/lib/time";
import type { ActionProposal } from "./action-types";

// The tool layer is tested against a fake Google Calendar; persistence is stubbed.
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/sync", () => ({ syncIfStale: vi.fn() }));
vi.mock("./actions", () => ({
  createProposal: vi.fn(async (_s: Session, proposal: ActionProposal, summary: string) => ({
    actionId: "act_1",
    status: "awaiting_user_approval",
    summary,
    proposal,
  })),
  getActionState: vi.fn(),
  lastExecutedAction: vi.fn(),
}));

const { createTools } = await import("./tools");

const TZ = "America/New_York";
const at = (local: string) => parseLocal(local, TZ);

const user: User = {
  id: "user_1",
  googleSub: "google-sub-1",
  passwordHash: null,
  calendarProvider: "google",
  picture: null,
  lastLoginAt: null,
  email: "me@acme.com",
  name: "Sam",
  timezone: TZ,
  workingHours: { start: "09:00", end: "17:00", days: ["mon", "tue", "wed", "thu", "fri"] },
  goals: { maxMeetingHoursPerWeek: 20, focusHoursPerDay: 2 },
  createdAt: new Date(),
  updatedAt: new Date(),
};

const standup: CalEvent = {
  id: "evt_standup",
  title: "Standup",
  allDay: false,
  start: at("2030-03-04T10:00").toISOString(),
  end: at("2030-03-04T10:30").toISOString(),
  attendees: [{ email: "me@acme.com", self: true }, { email: "priya@acme.com" }],
  organizerSelf: true,
  recurring: true,
  transparent: false,
  myResponse: "accepted",
};

function fakeCalendar() {
  return {
    kind: "google" as const,
    listEvents: vi.fn(async ({ timeMin, timeMax }: { timeMin: Date; timeMax: Date }) =>
      [standup].filter((e) => new Date(e.start) < timeMax && new Date(e.end) > timeMin),
    ),
    getEvent: vi.fn(async (id: string) => {
      if (id !== standup.id) throw new Error("not found");
      return standup;
    }),
    freeBusy: vi.fn(async ({ emails }: { emails: string[] }) => ({
      busy: new Map([
        ["primary", [{ start: new Date(standup.start), end: new Date(standup.end) }]],
        // Priya is busy all Monday morning.
        ...emails.filter((e) => e === "priya@acme.com").map((e) => [e, [{ start: at("2030-03-04T09:00"), end: at("2030-03-04T12:00") }]] as const),
      ]),
      unavailable: emails.filter((e) => e !== "priya@acme.com"),
    })),
  };
}

let gcal: ReturnType<typeof fakeCalendar>;
let tools: ReturnType<typeof createTools>;

const opts = { toolCallId: "call_1", messages: [], context: {} } as unknown as ToolExecutionOptions<never>;
type Executable = { execute?: (input: never, options: never) => unknown };
type ToolInput<T extends Executable> = Parameters<NonNullable<T["execute"]>>[0];
type ToolOutput<T extends Executable> = Exclude<Awaited<ReturnType<NonNullable<T["execute"]>>>, AsyncIterable<unknown>>;

/** Calls a tool's execute with typed input and output. */
async function run<T extends Executable>(t: T, input: ToolInput<T>): Promise<ToolOutput<T>> {
  const execute = t.execute as (input: ToolInput<T>, options: ToolExecutionOptions<never>) => Promise<ToolOutput<T>>;
  return execute(input, opts);
}

beforeEach(() => {
  gcal = fakeCalendar();
  const session = { userId: user.id, user, calendar: gcal as unknown as CalendarProvider } satisfies Session;
  tools = createTools(session, [normalizeRule({ type: "no_meetings_before", time: "10:00", days: ["tue"] })]);
});

describe("agent tools", () => {
  it("get_events returns local wall-clock times, not UTC", async () => {
    const out = await run(tools.get_events, { from: "2030-03-04", to: "2030-03-04" });
    expect(out.events[0]).toMatchObject({ title: "Standup", start: "2030-03-04T10:00", end: "2030-03-04T10:30", recurring: true });
  });

  it("find_free_slots merges attendees' busy time, applies saved rules and flags hidden calendars", async () => {
    const out = await run(tools.find_free_slots, {
      durationMinutes: 30,
      from: "2030-03-04",
      to: "2030-03-05",
      attendees: ["priya@acme.com", "ext@other.com"],
      maxResults: 8,
    });
    expect(out.slots.length).toBeGreaterThan(0);
    for (const s of out.slots) {
      if (s.start.startsWith("2030-03-04")) expect(s.start >= "2030-03-04T12:00").toBe(true); // Priya busy until 12
      if (s.start.startsWith("2030-03-05")) expect(s.start >= "2030-03-05T10:00").toBe(true); // Tue rule
    }
    expect(out.notes.join(" ")).toContain("ext@other.com");
  });

  it("propose_create_event converts local options to instants and warns about clashes", async () => {
    const out = await run(tools.propose_create_event, {
      title: "Roadmap review",
      attendees: ["Priya@acme.com", "me@acme.com"],
      options: [{ start: "2030-03-04T10:15", end: "2030-03-04T10:45" }],
    });
    if (out.proposal.kind !== "create_event") throw new Error("expected a create proposal");
    const p = out.proposal;
    expect(toLocal(new Date(p.options[0].start), TZ)).toBe("2030-03-04T10:15");
    expect(p.options[0].label).toBe("Mon, Mar 4 · 10:15–10:45");
    expect(p.attendees).toEqual(["priya@acme.com"]); // lower-cased, self removed
    expect(p.addMeetLink).toBe(true);
    expect(p.warnings?.[0]).toContain('"Standup"');
  });

  it("propose_update_event keeps the duration when only a new start is given", async () => {
    const out = await run(tools.propose_update_event, { eventId: standup.id, newStart: "2030-03-05T11:00" });
    if (out.proposal.kind !== "update_event") throw new Error("expected an update proposal");
    expect(out.proposal.newLabel).toBe("Tue, Mar 5 · 11:00–11:30");
    expect(out.proposal.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("1 attendee will be notified"), expect.stringContaining("recurring")]),
    );
  });

  it("rejects proposals in the past", async () => {
    await expect(
      run(tools.propose_create_event, { title: "Old", attendees: [], options: [{ start: "2001-01-01T10:00", end: "2001-01-01T11:00" }] }),
    ).rejects.toThrow(/in the past/);
  });
});

describe("agent loop (mock model, same plumbing as /api/chat)", () => {
  it("runs a tool call, streams UI parts, and round-trips history", async () => {
    const { convertToModelMessages, isStepCount, readUIMessageStream, simulateReadableStream, streamText, toUIMessageStream } =
      await import("ai");
    const { MockLanguageModelV4 } = await import("ai/test");
    type UIMsg = import("ai").UIMessage;

    const usage = {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 5, text: 5, reasoning: undefined },
    };
    let call = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        call += 1;
        const chunks: LanguageModelV4StreamPart[] =
          call === 1
            ? [
                {
                  type: "tool-call",
                  toolCallId: "call_slots",
                  toolName: "find_free_slots",
                  input: JSON.stringify({ durationMinutes: 30, from: "2030-03-05", to: "2030-03-05" }),
                },
                { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
              ]
            : [
                { type: "text-start", id: "t1" },
                { type: "text-delta", id: "t1", delta: "Tue 10:00 works." },
                { type: "text-end", id: "t1" },
                { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
              ];
        return { stream: simulateReadableStream({ chunks }) };
      },
    });

    const history: UIMsg[] = [{ id: "u1", role: "user", parts: [{ type: "text", text: "Find 30 min on Tuesday" }] }];
    const result = streamText({
      model,
      instructions: "test",
      messages: await convertToModelMessages(history),
      tools,
      stopWhen: isStepCount(5),
    });

    let last: UIMsg | undefined;
    for await (const msg of readUIMessageStream<UIMsg>({ stream: toUIMessageStream({ stream: result.stream, tools, originalMessages: history }) })) {
      last = msg;
    }

    const toolPart = last?.parts.find((p) => p.type === "tool-find_free_slots") as
      | { state: string; output: { slots: { start: string }[] } }
      | undefined;
    expect(toolPart?.state).toBe("output-available");
    const firstSlot = toolPart?.output.slots[0]?.start ?? "";
    expect(firstSlot >= "2030-03-05T10:00").toBe(true); // Tue rule applied
    expect(last?.parts.some((p) => p.type === "text" && p.text === "Tue 10:00 works.")).toBe(true);

    // The next request sends the whole history back; it must convert cleanly.
    const next = await convertToModelMessages([...history, last!, { id: "u2", role: "user", parts: [{ type: "text", text: "Book it" }] }]);
    expect(next.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant", "user"]);
  });
});
