import { describe, expect, it } from "vitest";
import { parseLocal, toLocal, type Interval } from "@/lib/time";
import { findFreeSlots, freeIntervals, type SlotRequest } from "./find-slots";
import { DEFAULT_WORKING_HOURS, normalizeRule } from "./rules";

const TZ = "Asia/Kolkata";
// Mon 2026-11-30 → Sun 2026-12-06
const MON = "2026-11-30";
const FRI = "2026-12-04";

const at = (local: string, tz = TZ) => parseLocal(local, tz);
const busy = (start: string, end: string, tz = TZ): Interval => ({ start: at(start, tz), end: at(end, tz) });
const locals = (slots: { start: Date }[], tz = TZ) => slots.map((s) => toLocal(s.start, tz));

function request(overrides: Partial<SlotRequest> = {}): SlotRequest {
  return {
    from: MON,
    to: FRI,
    durationMinutes: 30,
    timeZone: TZ,
    workingHours: DEFAULT_WORKING_HOURS,
    busy: [],
    now: at("2026-11-25T12:00"),
    maxResults: 500,
    maxPerDay: 500,
    minSpacingMinutes: 0,
    ...overrides,
  };
}

/** Every candidate start, in chronological order (diversity filter neutralised). */
function allStarts(overrides: Partial<SlotRequest> = {}) {
  const { slots } = findFreeSlots(request({ stepMinutes: 30, ...overrides }));
  return locals(slots).sort();
}

describe("findFreeSlots", () => {
  it("stays inside working hours, in the user's time zone", () => {
    const starts = allStarts({ from: MON, to: MON });
    expect(starts[0]).toBe("2026-11-30T09:00");
    expect(starts.every((s) => s.slice(11) >= "09:00" && s.slice(11) <= "17:30")).toBe(true);
  });

  it("never overlaps busy time", () => {
    const meetings = [busy("2026-11-30T10:00", "2026-11-30T11:00"), busy("2026-11-30T14:00", "2026-11-30T15:30")];
    const { slots } = findFreeSlots(request({ from: MON, to: MON, busy: meetings }));
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      for (const m of meetings) expect(s.start < m.end && m.start < s.end).toBe(false);
    }
  });

  it("skips non-working days and explicitly excluded days", () => {
    const starts = allStarts({ from: MON, to: "2026-12-06", excludeDays: ["fri"] });
    const days = new Set(starts.map((s) => s.slice(0, 10)));
    expect(days).toEqual(new Set(["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03"]));
  });

  it("honours a morning window (slot must end by latestTime)", () => {
    const starts = allStarts({ from: MON, to: MON, durationMinutes: 45, earliestTime: "09:00", latestTime: "12:00" });
    expect(starts.at(-1)).toBe("2026-11-30T11:00");
    expect(starts.every((s) => s.slice(11) < "12:00")).toBe(true);
  });

  it("applies 'no meetings before 10 on Fridays' only on Fridays", () => {
    const rules = [normalizeRule({ type: "no_meetings_before", time: "10:00", days: ["fri"] })];
    const starts = allStarts({ rules });
    expect(starts.filter((s) => s.startsWith(FRI))[0]).toBe("2026-12-04T10:00");
    expect(starts.filter((s) => s.startsWith(MON))[0]).toBe("2026-11-30T09:00");
  });

  it("skips no-meeting days and explains why", () => {
    const rules = [normalizeRule({ type: "no_meetings_on_days", days: ["wed"] })];
    const { slots, notes } = findFreeSlots(request({ rules }));
    expect(locals(slots).some((s) => s.startsWith("2026-12-02"))).toBe(false);
    expect(notes.join(" ")).toMatch(/Wed, Dec 2/);
  });

  it("keeps a buffer around existing meetings", () => {
    const rules = [normalizeRule({ type: "buffer_between_meetings", minutes: 15 })];
    const meetings = [busy("2026-11-30T10:00", "2026-11-30T11:00")];
    const starts = allStarts({ from: MON, to: MON, busy: meetings, rules, stepMinutes: 15 });
    expect(starts).not.toContain("2026-11-30T09:30"); // would end 10:00, no buffer
    expect(starts).toContain("2026-11-30T09:15"); // ends 09:45, 15 min before
    expect(starts).not.toContain("2026-11-30T11:00");
    expect(starts).toContain("2026-11-30T11:15");
  });

  it("respects protected focus blocks", () => {
    const rules = [normalizeRule({ type: "protected_block", start: "14:00", end: "16:00", label: "Focus" })];
    const starts = allStarts({ from: MON, to: MON, rules });
    expect(starts.some((s) => s.slice(11) >= "13:45" && s.slice(11) < "16:00")).toBe(false);
  });

  it("enforces max meetings per day", () => {
    const rules = [normalizeRule({ type: "max_meetings_per_day", count: 2 })];
    const meetings = [busy("2026-11-30T09:00", "2026-11-30T09:30"), busy("2026-11-30T15:00", "2026-11-30T15:30")];
    const { slots, notes } = findFreeSlots(request({ from: MON, to: "2026-12-01", busy: meetings, rules }));
    expect(locals(slots).every((s) => s.startsWith("2026-12-01"))).toBe(true);
    expect(notes[0]).toMatch(/already 2 meetings/);
  });

  it("never proposes times in the past", () => {
    const starts = allStarts({ from: MON, to: MON, now: at("2026-11-30T13:10") });
    expect(starts[0]).toBe("2026-11-30T13:30");
  });

  it("prefers slots that don't leave unusable gaps", () => {
    // 10:00–11:00 meeting. A 60-min slot at 11:00 hugs it; 11:15 would strand 15 minutes.
    const meetings = [busy("2026-11-30T10:00", "2026-11-30T11:00")];
    const { slots } = findFreeSlots(
      request({ from: MON, to: MON, durationMinutes: 60, busy: meetings, earliestTime: "09:00", latestTime: "13:00", stepMinutes: 15 }),
    );
    const byStart = new Map(slots.map((s) => [toLocal(s.start, TZ), s.score]));
    const best = slots[0];
    expect(["2026-11-30T09:00", "2026-11-30T11:00"]).toContain(toLocal(best.start, TZ));
    expect(best.reasons.length).toBeGreaterThan(0);
    expect(byStart.get("2026-11-30T11:15") ?? -Infinity).toBeLessThan(best.score);
  });

  it("spreads options across days and keeps same-day options apart", () => {
    const { slots } = findFreeSlots(request({ maxResults: 5, maxPerDay: 2, minSpacingMinutes: 90 }));
    expect(slots).toHaveLength(5);
    const perDay = new Map<string, Date[]>();
    for (const s of slots) {
      const day = toLocal(s.start, TZ).slice(0, 10);
      perDay.set(day, [...(perDay.get(day) ?? []), s.start]);
    }
    for (const starts of perDay.values()) {
      expect(starts.length).toBeLessThanOrEqual(2);
      if (starts.length === 2) expect(Math.abs(starts[0].getTime() - starts[1].getTime())).toBeGreaterThanOrEqual(90 * 60_000);
    }
  });

  it("handles DST transitions (America/New_York, spring forward)", () => {
    const tz = "America/New_York";
    const { slots } = findFreeSlots(
      request({ timeZone: tz, from: "2026-03-08", to: "2026-03-09", now: new Date("2026-03-01T00:00:00Z"), stepMinutes: 60 }),
    );
    const mondayFirst = locals(slots, tz).filter((s) => s.startsWith("2026-03-09")).sort()[0];
    expect(mondayFirst).toBe("2026-03-09T09:00");
    // 09:00 EDT is 13:00 UTC after the switch.
    expect(at("2026-03-09T09:00", tz).toISOString()).toBe("2026-03-09T13:00:00.000Z");
  });
});

describe("freeIntervals", () => {
  it("returns the gaps between merged busy blocks", () => {
    const within = busy("2026-11-30T09:00", "2026-11-30T18:00");
    const free = freeIntervals(within, [
      busy("2026-11-30T10:00", "2026-11-30T11:00"),
      busy("2026-11-30T10:30", "2026-11-30T12:00"),
      busy("2026-11-30T17:00", "2026-11-30T19:00"),
    ]);
    expect(free.map((f) => [toLocal(f.start, TZ).slice(11), toLocal(f.end, TZ).slice(11)])).toEqual([
      ["09:00", "10:00"],
      ["12:00", "17:00"],
    ]);
  });
});

describe("normalizeRule", () => {
  it("rejects malformed rules with a readable message", () => {
    expect(() => normalizeRule({ type: "no_meetings_before" })).toThrow(/no_meetings_before/);
    expect(() => normalizeRule({ type: "protected_block", start: "16:00", end: "14:00" })).toThrow(/before end/);
  });
});
