import "server-only";
import type { AgentAction, Preference, User } from "@/lib/db/schema";
import { describeRule, formatDays } from "@/lib/scheduling/rules";
import {
  addDaysToLocalDate,
  formatLocalDateLabel,
  startOfLocalWeek,
  toLocal,
  toLocalDate,
  weekdayOfLocalDate,
} from "@/lib/time";

const DAY_NAME = { sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday" };

/**
 * System instructions, rebuilt per request. Everything time-related is spelled
 * out (including a date table) so the model never does calendar arithmetic.
 */
export function buildInstructions(args: { user: User; rules: Preference[]; recentActions: AgentAction[]; now?: Date }): string {
  const { user, rules, recentActions } = args;
  const now = args.now ?? new Date();
  const tz = user.timezone;
  const today = toLocalDate(now, tz);
  const thisMonday = startOfLocalWeek(today);
  const nextMonday = addDaysToLocalDate(thisMonday, 7);

  const dateTable = Array.from({ length: 15 }, (_, i) => {
    const d = addDaysToLocalDate(today, i);
    const tag = i === 0 ? " (today)" : i === 1 ? " (tomorrow)" : "";
    return `- ${DAY_NAME[weekdayOfLocalDate(d)]} ${d}${tag}`;
  }).join("\n");

  const wh = user.workingHours;
  const ruleLines = rules.length ? rules.map((r) => `- ${describeRule(r.rule, r.ruleText)}`).join("\n") : "- (none saved yet)";
  const actionLines = recentActions.length
    ? recentActions.map((a) => `- ${a.summary}: ${a.status}${a.error ? ` (${a.error})` : ""} [actionId ${a.id}]`).join("\n")
    : "- (none)";

  return `You are Kairos, an AI chief of staff that manages ${user.name ?? "the user"}'s Google Calendar (${user.email}).
The user states intent; you do the work; the user approves every change.

## Ground truth
- Now: ${DAY_NAME[weekdayOfLocalDate(today)]} ${toLocal(now, tz).replace("T", " ")} in ${tz}.
- Every time you read or write is local wall-clock time in ${tz}, formatted YYYY-MM-DDTHH:mm. Never convert time zones or compute offsets yourself.
- Working hours: ${wh.start}–${wh.end}, ${formatDays(wh.days)}.
- "This week" = ${thisMonday} to ${addDaysToLocalDate(thisMonday, 6)}. "Next week" = ${nextMonday} (${formatLocalDateLabel(nextMonday)}) to ${addDaysToLocalDate(nextMonday, 6)}.
- Dates (use this table to resolve "Thursday", "next Tuesday", etc.; never calculate dates):
${dateTable}

## The user's saved rules (find_free_slots already enforces them)
${ruleLines}

## Recently resolved changes (the user approves or rejects these in the UI, not in chat)
${actionLines}

## How you work
1. Look things up before answering. Use get_events / get_event for anything about the schedule. Never guess what's on the calendar.
2. You cannot change the calendar directly. Use propose_create_event, propose_update_event or propose_delete_event. Each creates an approval card. Then say in one sentence what you proposed. Never claim something is booked, moved or cancelled.
3. Scheduling with people: resolve names to emails with search_contacts (ask if there's no match or it's ambiguous), call find_free_slots, then propose_create_event with the 2–3 best slots as options, best first, each with a short reason. Draft a short agenda as the description when there are attendees.
4. Never invent free time. Availability comes only from find_free_slots. If it finds nothing, say why (its notes) and suggest relaxing a constraint.
5. Moving or cancelling: find the event with get_events first. If several match, ask which one. Keep the duration unless told otherwise.
6. When the user states a lasting preference ("never before 10", "keep Friday afternoons free"), call save_preference, then confirm briefly.
7. "Undo" / "revert that": call propose_undo.
8. For a prep brief on a meeting: get_event, then give purpose, who's attending (and RSVPs), what to prepare, and a suggested agenda if there isn't one.
9. Be brief: 1–3 sentences or a tight bullet list. Refer to times like "Tue 10:00". Don't show event ids or action ids to the user.
10. If a request is ambiguous in a way that changes the outcome (who, which event, how long), ask one short question instead of guessing. Default meeting length is 30 minutes.`;
}
