import { describe, expect, it } from "vitest";
import type { CalEvent } from "@/lib/google/types";
import { parseLocal } from "@/lib/time";
import { layoutDay } from "./layout-day";

const TZ = "Europe/London";
let n = 0;
function ev(start: string, end: string, extra: Partial<CalEvent> = {}): CalEvent {
  return {
    id: `e${n++}`,
    title: "Event",
    allDay: false,
    start: parseLocal(start, TZ).toISOString(),
    end: parseLocal(end, TZ).toISOString(),
    attendees: [],
    recurring: false,
    transparent: false,
    ...extra,
  };
}

describe("layoutDay", () => {
  it("places events by local wall-clock minutes", () => {
    const [p] = layoutDay([ev("2026-12-01T09:30", "2026-12-01T10:15")], "2026-12-01", TZ);
    expect(p).toMatchObject({ top: 570, height: 45, col: 0, cols: 1 });
  });

  it("splits overlapping events into columns and leaves others full width", () => {
    const a = ev("2026-12-01T09:00", "2026-12-01T10:00");
    const b = ev("2026-12-01T09:30", "2026-12-01T10:30");
    const c = ev("2026-12-01T10:00", "2026-12-01T11:00"); // fits back in column 0
    const d = ev("2026-12-01T14:00", "2026-12-01T15:00");
    const byId = new Map(layoutDay([a, b, c, d], "2026-12-01", TZ).map((p) => [p.event.id, p]));
    expect(byId.get(a.id)).toMatchObject({ col: 0, cols: 2 });
    expect(byId.get(b.id)).toMatchObject({ col: 1, cols: 2 });
    expect(byId.get(c.id)).toMatchObject({ col: 0, cols: 2 });
    expect(byId.get(d.id)).toMatchObject({ col: 0, cols: 1 });
  });

  it("clips multi-day events to the day and ignores all-day events", () => {
    const overnight = ev("2026-11-30T22:00", "2026-12-01T02:00");
    const allDay: CalEvent = { ...ev("2026-12-01T00:00", "2026-12-02T00:00"), allDay: true, start: "2026-12-01", end: "2026-12-02" };
    const out = layoutDay([overnight, allDay], "2026-12-01", TZ);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ top: 0, height: 120, startsBefore: true, endsAfter: false });
  });
});
