import { describe, expect, it } from "vitest";
import type { AgentAction, Preference, User } from "@/lib/db/schema";
import { DEFAULT_GOALS, DEFAULT_WORKING_HOURS } from "@/lib/scheduling/rules";
import { buildInstructions } from "./prompt";

const user: User = {
  id: "user_1",
  googleSub: "google-sub-1",
  passwordHash: null,
  calendarProvider: "google",
  picture: null,
  lastLoginAt: null,
  email: "me@acme.com",
  name: "Asha",
  timezone: "Asia/Kolkata",
  workingHours: DEFAULT_WORKING_HOURS,
  goals: DEFAULT_GOALS,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Wed 2026-11-25 14:32 IST
const now = new Date("2026-11-25T09:02:00Z");

describe("buildInstructions", () => {
  const rules = [
    { id: "r1", userId: "user_1", ruleText: "no meetings before 10 on fridays", rule: { type: "no_meetings_before", time: "10:00", days: ["fri"] }, active: true, createdAt: now },
  ] as Preference[];
  const actions = [{ id: "a1", summary: 'Schedule "Roadmap review"', status: "executed", error: null }] as AgentAction[];
  const text = buildInstructions({ user, rules, recentActions: actions, now });

  it("grounds the model in local time and a date table", () => {
    expect(text).toContain("Now: Wednesday 2026-11-25 14:32 in Asia/Kolkata");
    expect(text).toContain("- Wednesday 2026-11-25 (today)");
    expect(text).toContain("- Thursday 2026-11-26 (tomorrow)");
    expect(text).toContain("- Tuesday 2026-12-08");
  });

  it("spells out this week and next week", () => {
    expect(text).toContain('"This week" = 2026-11-23 to 2026-11-29');
    expect(text).toContain('"Next week" = 2026-11-30 (Mon, Nov 30) to 2026-12-06');
  });

  it("includes rules, working hours and recent approvals", () => {
    expect(text).toContain("No meetings before 10:00 (Fri)");
    expect(text).toContain("Working hours: 09:00–18:00, weekdays");
    expect(text).toContain('Schedule "Roadmap review": executed');
  });
});
