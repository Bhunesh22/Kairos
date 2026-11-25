import {
  addDaysToLocalDate,
  atLocalMinutes,
  formatLocalDateLabel,
  hhmmToMinutes,
  localDatesBetween,
  mergeIntervals,
  overlaps,
  weekdayOfLocalDate,
  type Interval,
  type Weekday,
} from "@/lib/time";
import { ruleAppliesOn, type Rule, type WorkingHours } from "./rules";

/**
 * Deterministic slot finder. The LLM extracts constraints ("next week, mornings,
 * 45 min, not Friday"); this code does the availability math and scoring; the
 * LLM then explains and proposes. Pure and fully unit-tested.
 */

export type SlotRequest = {
  /** First local date to consider (inclusive), "YYYY-MM-DD". */
  from: string;
  /** Last local date to consider (inclusive). */
  to: string;
  durationMinutes: number;
  timeZone: string;
  workingHours: WorkingHours;
  /** Optional time-of-day window, e.g. mornings = 09:00–12:00. The slot must fit inside it. */
  earliestTime?: string;
  latestTime?: string;
  excludeDays?: Weekday[];
  /** Busy time of everyone involved (user + attendees whose calendars are visible). */
  busy: Interval[];
  /** The user's own meetings, used for day-load balancing and the max-per-day rule. Defaults to `busy`. */
  ownMeetings?: Interval[];
  rules?: Rule[];
  now?: Date;
  stepMinutes?: number;
  maxResults?: number;
  /** Max slots returned per day, so options spread across the range. */
  maxPerDay?: number;
  /** Minimum distance between two options on the same day. */
  minSpacingMinutes?: number;
};

export type Slot = { start: Date; end: Date; score: number; reasons: string[] };
export type SlotResult = { slots: Slot[]; notes: string[] };

const MINUTE = 60_000;
const LUNCH = { start: 12 * 60, end: 13 * 60 };

export function findFreeSlots(req: SlotRequest): SlotResult {
  const {
    timeZone: tz,
    durationMinutes: duration,
    workingHours,
    rules = [],
    stepMinutes = 15,
    maxResults = 5,
    maxPerDay = 2,
    minSpacingMinutes = 90,
  } = req;
  const now = req.now ?? new Date();
  const busy = mergeIntervals(req.busy);
  const own = req.ownMeetings ?? req.busy;
  const notes: string[] = [];

  const buffer = Math.max(
    0,
    ...rules.flatMap((r) => (r.type === "buffer_between_meetings" ? [r.minutes] : [])),
  );
  const maxMeetingsRule = rules.find((r) => r.type === "max_meetings_per_day");

  const candidates: (Slot & { dayIndex: number })[] = [];
  const dates = localDatesBetween(req.from, req.to);

  dates.forEach((date, dayIndex) => {
    const weekday = weekdayOfLocalDate(date);
    const label = formatLocalDateLabel(date);
    if (!workingHours.days.includes(weekday) || req.excludeDays?.includes(weekday)) return;

    if (rules.some((r) => r.type === "no_meetings_on_days" && r.days.includes(weekday))) {
      notes.push(`Skipped ${label}: no-meeting day rule.`);
      return;
    }

    const workOpen = hhmmToMinutes(workingHours.start);
    const workClose = hhmmToMinutes(workingHours.end);
    let open = workOpen;
    let close = workClose;
    if (req.earliestTime) open = Math.max(open, hhmmToMinutes(req.earliestTime));
    if (req.latestTime) close = Math.min(close, hhmmToMinutes(req.latestTime));
    for (const r of rules) {
      if (r.type === "no_meetings_before" && ruleAppliesOn(r, weekday)) open = Math.max(open, hhmmToMinutes(r.time));
      if (r.type === "no_meetings_after" && ruleAppliesOn(r, weekday)) close = Math.min(close, hhmmToMinutes(r.time));
    }
    if (close - open < duration) return;

    const day: Interval = { start: atLocalMinutes(date, 0, tz), end: atLocalMinutes(addDaysToLocalDate(date, 1), 0, tz) };
    const work: Interval = { start: atLocalMinutes(date, workOpen, tz), end: atLocalMinutes(date, workClose, tz) };
    const dayBusy = busy.filter((b) => overlaps(b, day));
    const meetingsToday = own.filter((m) => overlaps(m, day)).length;

    if (maxMeetingsRule && meetingsToday >= maxMeetingsRule.count) {
      notes.push(`Skipped ${label}: already ${meetingsToday} meetings (limit ${maxMeetingsRule.count}).`);
      return;
    }

    const protectedBlocks: Interval[] = rules.flatMap((r) =>
      r.type === "protected_block" && ruleAppliesOn(r, weekday)
        ? [{ start: atLocalMinutes(date, hhmmToMinutes(r.start), tz), end: atLocalMinutes(date, hhmmToMinutes(r.end), tz) }]
        : [],
    );

    for (let m = Math.ceil(open / stepMinutes) * stepMinutes; m + duration <= close; m += stepMinutes) {
      const start = atLocalMinutes(date, m, tz);
      const end = new Date(start.getTime() + duration * MINUTE);
      if (start < now) continue;
      const padded = { start: new Date(start.getTime() - buffer * MINUTE), end: new Date(end.getTime() + buffer * MINUTE) };
      if (dayBusy.some((b) => overlaps(b, padded))) continue;
      if (protectedBlocks.some((p) => overlaps(p, { start, end }))) continue;

      candidates.push({
        ...scoreSlot({ start, end, startMinutes: m, duration, dayIndex, dayBusy, work, meetingsToday, buffer }),
        dayIndex,
      });
    }
  });

  const picked = pickDiverse(candidates, maxResults, maxPerDay, minSpacingMinutes);

  const earliest = candidates.reduce<Slot | undefined>((a, c) => (!a || c.start < a.start ? c : a), undefined);
  for (const slot of picked) {
    if (earliest && slot.start.getTime() === earliest.start.getTime() && slot.reasons.length < 2) {
      slot.reasons.push("Earliest available time");
    }
  }

  if (!picked.length && !notes.length) notes.push("No free time matched these constraints.");
  return { slots: picked.map(({ start, end, score, reasons }) => ({ start, end, score, reasons })), notes };
}

function scoreSlot(args: {
  start: Date;
  end: Date;
  startMinutes: number;
  duration: number;
  dayIndex: number;
  dayBusy: Interval[];
  work: Interval;
  meetingsToday: number;
  buffer: number;
}): Slot {
  const { start, end, startMinutes, duration, dayIndex, dayBusy, work, meetingsToday, buffer } = args;
  let score = 100;
  const reasons: { weight: number; text: string }[] = [];

  // Fragmentation: gaps under an hour (beyond the buffer) are time nobody can use.
  const prev = dayBusy.filter((b) => b.end <= start).sort((a, b) => b.end.getTime() - a.end.getTime())[0];
  const next = dayBusy.filter((b) => b.start >= end).sort((a, b) => a.start.getTime() - b.start.getTime())[0];
  const prevInWork = !!prev && prev.end > work.start;
  const nextInWork = !!next && next.start < work.end;
  const prevEdge = prevInWork ? prev.end : work.start;
  const nextEdge = nextInWork ? next.start : work.end;
  const gapBefore = Math.max(0, (start.getTime() - prevEdge.getTime()) / MINUTE);
  const gapAfter = Math.max(0, (nextEdge.getTime() - end.getTime()) / MINUTE);
  const wasted = (gap: number) => gap > buffer && gap < 60;
  if (wasted(gapBefore)) score -= 15;
  if (wasted(gapAfter)) score -= 15;
  if ((prevInWork && gapBefore <= buffer) || (nextInWork && gapAfter <= buffer)) {
    score += 6;
    reasons.push({ weight: 6, text: "Sits next to an existing meeting, so the rest of the day stays open" });
  }

  // Longest uninterrupted block left in the working day after booking this slot.
  const longest = longestFreeBlock(work, [...dayBusy, { start, end }]);
  if (longest >= 120) {
    score += 8;
    reasons.push({ weight: 8, text: `Keeps a ${formatHours(longest)} focus block free that day` });
  } else if (longest < 60) {
    score -= 5;
  }

  // Load balancing across days.
  score += Math.max(-12, 9 - meetingsToday * 3);
  if (meetingsToday <= 1) {
    reasons.push({ weight: 7, text: meetingsToday === 0 ? "No other meetings that day" : "Light day (1 other meeting)" });
  }

  // Mild preference for sooner, round start times, and avoiding lunch.
  score -= dayIndex * 1.5;
  score += startMinutes % 60 === 0 ? 4 : startMinutes % 30 === 0 ? 2 : -2;
  if (startMinutes < LUNCH.end && startMinutes + duration > LUNCH.start) score -= 8;

  return {
    start,
    end,
    score: Math.round(score * 10) / 10,
    reasons: reasons.sort((a, b) => b.weight - a.weight).slice(0, 2).map((r) => r.text),
  };
}

function pickDiverse<T extends Slot & { dayIndex: number }>(
  candidates: T[],
  maxResults: number,
  maxPerDay: number,
  minSpacingMinutes: number,
): T[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score || a.start.getTime() - b.start.getTime());
  const picked: T[] = [];
  const perDay = new Map<number, number>();
  for (const c of sorted) {
    if (picked.length >= maxResults) break;
    if ((perDay.get(c.dayIndex) ?? 0) >= maxPerDay) continue;
    // Options on the same day should be meaningfully different.
    const tooClose = (p: T) =>
      p.dayIndex === c.dayIndex && Math.abs(p.start.getTime() - c.start.getTime()) < minSpacingMinutes * MINUTE;
    if (picked.some(tooClose)) continue;
    picked.push(c);
    perDay.set(c.dayIndex, (perDay.get(c.dayIndex) ?? 0) + 1);
  }
  return picked;
}

/** Free intervals inside `within` that don't overlap any of `busy`. */
export function freeIntervals(within: Interval, busy: Interval[]): Interval[] {
  const merged = mergeIntervals(busy.filter((b) => overlaps(b, within)));
  const out: Interval[] = [];
  let cursor = within.start;
  for (const b of merged) {
    if (b.start > cursor) out.push({ start: cursor, end: b.start < within.end ? b.start : within.end });
    if (b.end > cursor) cursor = b.end;
    if (cursor >= within.end) break;
  }
  if (cursor < within.end) out.push({ start: cursor, end: within.end });
  return out;
}

function longestFreeBlock(within: Interval, busy: Interval[]): number {
  return Math.max(0, ...freeIntervals(within, busy).map((f) => (f.end.getTime() - f.start.getTime()) / MINUTE));
}

export function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
