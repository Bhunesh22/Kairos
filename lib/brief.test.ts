import { describe, expect, it } from "vitest";
import type { CalEvent } from "@/lib/google/types";
import { parseLocal } from "@/lib/time";
import { computeFacts } from "./brief";

const TZ = "Asia/Kolkata";
const DATE = "2026-12-01";
const me = { email: "me@acme.com", self: true };

function meeting(title: string, start: string, end: string, extra: Partial<CalEvent> = {}): CalEvent {
  return {
    id: title,
    title,
    allDay: false,
    start: parseLocal(`${DATE}T${start}`, TZ).toISOString(),
    end: parseLocal(`${DATE}T${end}`, TZ).toISOString(),
    attendees: [me, { email: "priya@acme.com" }],
    recurring: false,
    transparent: false,
    myResponse: "accepted",
    ...extra,
  };
}

const facts = (events: CalEvent[]) =>
  computeFacts(events, { tz: TZ, date: DATE, myEmail: me.email, workStart: "09:00", workEnd: "18:00", isWorkday: true });

describe("computeFacts", () => {
  const day = [
    meeting("Standup", "13:00", "13:30", { description: "Daily" }),
    meeting("Design review", "13:30", "14:00"),
    meeting("Planning", "14:00", "15:00", { description: "Q1" }),
    meeting("Sales sync", "14:30", "15:00", { description: "Pipeline" }),
    meeting("Declined thing", "10:00", "11:00", { myResponse: "declined" }),
    meeting("Lunch (free)", "12:00", "13:00", { transparent: true, attendees: [me] }),
  ];

  it("counts meetings and merged meeting time, ignoring declined and free events", () => {
    const f = facts(day);
    expect(f.stats.meetings).toBe(4);
    expect(f.stats.meetingMinutes).toBe(120); // 13:00–15:00 merged
  });

  it("flags conflicts and back-to-back runs", () => {
    const f = facts(day);
    expect(f.conflicts).toEqual(['"Planning" overlaps "Sales sync" at 14:30']);
    expect(f.backToBack[0]).toMatch(/^4 meetings back to back 13:00–15:00/);
  });

  it("finds focus blocks inside working hours", () => {
    const f = facts(day);
    expect(f.freeBlocks).toEqual(["09:00–13:00", "15:00–18:00"]);
    expect(f.stats.focusMinutes).toBe(420);
    expect(f.stats.longestFreeBlockMinutes).toBe(240);
  });

  it("asks for prep on meetings without an agenda", () => {
    expect(facts(day).prepCandidates.map((p) => p.title)).toEqual(["Design review"]);
  });

  it("reports no focus time on non-working days", () => {
    const f = computeFacts(day, { tz: TZ, date: DATE, myEmail: me.email, workStart: "09:00", workEnd: "18:00", isWorkday: false });
    expect(f.stats.focusMinutes).toBe(0);
  });
});
