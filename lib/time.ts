import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

/**
 * Time zone helpers. The agent and the UI speak in *local* wall-clock strings
 * ("2026-12-01T10:00") in the user's calendar time zone; only this module turns
 * them into absolute instants. The model never does offset arithmetic.
 */

export const LOCAL_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
export const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToHhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Absolute instant for a local date ("2026-12-01") plus minutes after midnight in `tz`. */
export function atLocalMinutes(localDate: string, minutes: number, tz: string): Date {
  const [y, mo, d] = localDate.split("-").map(Number);
  return new Date(new TZDate(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60, 0, tz).getTime());
}

/** "2026-12-01T10:00" in `tz` → Date. */
export function parseLocal(local: string, tz: string): Date {
  const [date, time] = local.split("T");
  return atLocalMinutes(date, hhmmToMinutes(time), tz);
}

/** Date → "2026-12-01T10:00" in `tz`. */
export function toLocal(date: Date, tz: string): string {
  return format(new TZDate(date, tz), "yyyy-MM-dd'T'HH:mm");
}

/** Date → "2026-12-01" in `tz`. */
export function toLocalDate(date: Date, tz: string): string {
  return format(new TZDate(date, tz), "yyyy-MM-dd");
}

/** Minutes after local midnight in `tz`. */
export function localMinutes(date: Date, tz: string): number {
  const z = new TZDate(date, tz);
  return z.getHours() * 60 + z.getMinutes();
}

/** Calendar arithmetic on local date strings, independent of time zones and DST. */
export function addDaysToLocalDate(localDate: string, days: number): string {
  const [y, m, d] = localDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function weekdayOfLocalDate(localDate: string): Weekday {
  const [y, m, d] = localDate.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Inclusive list of local dates between two local dates (capped for safety). */
export function localDatesBetween(from: string, to: string, max = 92): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < max; d = addDaysToLocalDate(d, 1)) out.push(d);
  return out;
}

/** Start of the local day in `tz`. */
export function startOfLocalDay(localDate: string, tz: string): Date {
  return atLocalMinutes(localDate, 0, tz);
}

/** Monday of the week containing `localDate`. */
export function startOfLocalWeek(localDate: string): string {
  const idx = WEEKDAYS.indexOf(weekdayOfLocalDate(localDate));
  return addDaysToLocalDate(localDate, -((idx + 6) % 7));
}

/** "Tue, Dec 1 · 10:00–10:45" in `tz`. */
export function formatRange(start: Date, end: Date, tz: string): string {
  const s = new TZDate(start, tz);
  const e = new TZDate(end, tz);
  const sameDay = format(s, "yyyy-MM-dd") === format(e, "yyyy-MM-dd");
  return sameDay
    ? `${format(s, "EEE, MMM d · HH:mm")}–${format(e, "HH:mm")}`
    : `${format(s, "EEE, MMM d HH:mm")} – ${format(e, "EEE, MMM d HH:mm")}`;
}

/** "Tue 10:00" in `tz`. */
export function formatShort(date: Date, tz: string): string {
  return format(new TZDate(date, tz), "EEE HH:mm");
}

export function formatLocalDateLabel(localDate: string): string {
  const [y, m, d] = localDate.split("-").map(Number);
  return format(new Date(y, m - 1, d), "EEE, MMM d");
}

export type Interval = { start: Date; end: Date };

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Sorts and merges overlapping or touching intervals. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) {
      if (i.end > last.end) last.end = i.end;
    } else {
      out.push({ start: new Date(i.start), end: new Date(i.end) });
    }
  }
  return out;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
