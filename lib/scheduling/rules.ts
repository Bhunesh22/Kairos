import { z } from "zod";
import { HHMM_RE, WEEKDAYS, type Weekday } from "@/lib/time";

/**
 * Scheduling preferences ("rules") the user teaches Kairos. Structured rules are
 * enforced by the slot finder in code; `note` rules are free-form guidance that
 * only goes into the agent's instructions.
 */

const hhmm = z.string().regex(HHMM_RE, "Use 24h HH:mm");
const weekdays = z.array(z.enum(WEEKDAYS)).min(1);

export const ruleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("no_meetings_before"), time: hhmm, days: weekdays.optional() }),
  z.object({ type: z.literal("no_meetings_after"), time: hhmm, days: weekdays.optional() }),
  z.object({ type: z.literal("no_meetings_on_days"), days: weekdays }),
  z.object({ type: z.literal("buffer_between_meetings"), minutes: z.number().int().min(5).max(60) }),
  z.object({
    type: z.literal("protected_block"),
    start: hhmm,
    end: hhmm,
    days: weekdays.optional(),
    label: z.string().max(60).optional(),
  }),
  z.object({ type: z.literal("max_meetings_per_day"), count: z.number().int().min(1).max(20) }),
  z.object({ type: z.literal("note") }),
]);

export type Rule = z.infer<typeof ruleSchema>;
export type RuleType = Rule["type"];

export const RULE_TYPES = [
  "no_meetings_before",
  "no_meetings_after",
  "no_meetings_on_days",
  "buffer_between_meetings",
  "protected_block",
  "max_meetings_per_day",
  "note",
] as const satisfies readonly RuleType[];

/**
 * Flat shape used for LLM tool input / structured output. Gemini handles flat
 * objects with optional fields more reliably than discriminated unions, so the
 * model fills this and `normalizeRule` validates it into a `Rule`.
 */
export const flatRuleSchema = z.object({
  type: z
    .enum(RULE_TYPES)
    .describe(
      "no_meetings_before/after: time limit (optionally only on some days). no_meetings_on_days: whole days off-limits. " +
        "buffer_between_meetings: minutes of gap. protected_block: recurring focus/lunch block start–end. " +
        "max_meetings_per_day: count. note: anything else, kept as guidance.",
    ),
  time: z.string().optional().describe("HH:mm 24h, for no_meetings_before / no_meetings_after"),
  days: z.array(z.enum(WEEKDAYS)).optional().describe("Days the rule applies to; omit for every day"),
  minutes: z.number().optional().describe("For buffer_between_meetings"),
  count: z.number().optional().describe("For max_meetings_per_day"),
  start: z.string().optional().describe("HH:mm, for protected_block"),
  end: z.string().optional().describe("HH:mm, for protected_block"),
  label: z.string().optional().describe("Short label for protected_block, e.g. 'Focus' or 'Lunch'"),
});
export type FlatRule = z.infer<typeof flatRuleSchema>;

export function normalizeRule(flat: FlatRule): Rule {
  const { type, time, days, minutes, count, start, end, label } = flat;
  const candidate = { type, time, days: days?.length ? days : undefined, minutes, count, start, end, label };
  const parsed = ruleSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid ${type} rule: ${issue.path.join(".") || "rule"} ${issue.message}`);
  }
  if (parsed.data.type === "protected_block" && parsed.data.start >= parsed.data.end) {
    throw new Error("protected_block start must be before end");
  }
  return parsed.data;
}

export function ruleAppliesOn(rule: { days?: Weekday[] }, day: Weekday): boolean {
  return !rule.days || rule.days.includes(day);
}

const DAY_LABEL: Record<Weekday, string> = {
  sun: "Sun",
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
};

export function formatDays(days?: Weekday[]): string {
  if (!days?.length) return "every day";
  const key = [...days].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b)).join(",");
  if (key === "mon,tue,wed,thu,fri") return "weekdays";
  if (key === "sun,sat") return "weekends";
  return days.map((d) => DAY_LABEL[d]).join(", ");
}

export function describeRule(rule: Rule, ruleText?: string): string {
  switch (rule.type) {
    case "no_meetings_before":
      return `No meetings before ${rule.time} (${formatDays(rule.days)})`;
    case "no_meetings_after":
      return `No meetings after ${rule.time} (${formatDays(rule.days)})`;
    case "no_meetings_on_days":
      return `No meetings on ${formatDays(rule.days)}`;
    case "buffer_between_meetings":
      return `${rule.minutes}-min buffer between meetings`;
    case "protected_block":
      return `Protect ${rule.start}–${rule.end}${rule.label ? ` for ${rule.label}` : ""} (${formatDays(rule.days)})`;
    case "max_meetings_per_day":
      return `At most ${rule.count} meetings per day`;
    case "note":
      return ruleText ?? "Note";
  }
}

export type WorkingHours = { start: string; end: string; days: Weekday[] };

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  start: "09:00",
  end: "18:00",
  days: ["mon", "tue", "wed", "thu", "fri"],
};

export const workingHoursSchema = z
  .object({ start: hhmm, end: hhmm, days: z.array(z.enum(WEEKDAYS)) })
  .refine((w) => w.start < w.end, "Start must be before end");

export type Goals = { maxMeetingHoursPerWeek: number; focusHoursPerDay: number };

export const DEFAULT_GOALS: Goals = { maxMeetingHoursPerWeek: 20, focusHoursPerDay: 2 };
