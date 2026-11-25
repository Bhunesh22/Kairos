import "server-only";
import { tool } from "ai";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { categorize } from "@/lib/categorize";
import { getDb } from "@/lib/db";
import { contacts, preferences } from "@/lib/db/schema";
import { toAppError } from "@/lib/errors";
import { isBlocking, type CalEvent } from "@/lib/google/types";
import { findFreeSlots } from "@/lib/scheduling/find-slots";
import { describeRule, flatRuleSchema, normalizeRule, type Rule } from "@/lib/scheduling/rules";
import type { Session } from "@/lib/session";
import { syncIfStale } from "@/lib/sync";
import { stripHtml } from "@/lib/text";
import {
  addDaysToLocalDate,
  formatRange,
  formatShort,
  HHMM_RE,
  LOCAL_DATE_RE,
  LOCAL_DATETIME_RE,
  overlaps,
  parseLocal,
  startOfLocalDay,
  toLocal,
  toLocalDate,
  WEEKDAYS,
} from "@/lib/time";
import { createProposal, getActionState, lastExecutedAction } from "./actions";
import type { SlotOption } from "./action-types";

const localDate = z.string().regex(LOCAL_DATE_RE).describe("Local date YYYY-MM-DD");
const localDateTime = z
  .string()
  .regex(LOCAL_DATETIME_RE)
  .describe("Local date-time in the user's time zone, YYYY-MM-DDTHH:mm (no offset)");
const hhmm = z.string().regex(HHMM_RE).describe("24h HH:mm");
const email = z.string().email();

/** Compact event shape for the model: local times, no offsets, no noise. */
export function eventForModel(e: CalEvent, tz: string, myEmail?: string) {
  const others = e.attendees.filter((a) => !a.self);
  return {
    id: e.id,
    title: e.title,
    start: e.allDay ? e.start : toLocal(new Date(e.start), tz),
    end: e.allDay ? e.end : toLocal(new Date(e.end), tz),
    allDay: e.allDay || undefined,
    attendees: others.slice(0, 8).map((a) => a.name ?? a.email),
    moreAttendees: others.length > 8 ? others.length - 8 : undefined,
    myResponse: e.myResponse,
    iAmOrganizer: e.organizerSelf ?? !e.organizerEmail,
    category: categorize(e, myEmail),
    hasAgenda: !!e.description?.trim(),
    hasMeetLink: !!e.meetLink,
    recurring: e.recurring || undefined,
    free: e.transparent || undefined,
  };
}

/** A problem with the tool call itself, phrased for the model so it can correct course. */
class ToolError extends Error {}

/** Runs a tool body and turns failures into a short message the model can relay. */
function safely<I, O>(fn: (input: I) => Promise<O>) {
  return async (input: I): Promise<O> => {
    try {
      return await fn(input);
    } catch (err) {
      if (err instanceof ToolError) throw err;
      throw new Error(toAppError(err).message);
    }
  };
}

export function createTools(session: Session, rules: Rule[]) {
  const { gcal, user } = session;
  const tz = user.timezone;

  /** Names of the user's own blocking events that overlap [start, end). */
  async function clashes(start: Date, end: Date, ignoreEventId?: string): Promise<string[]> {
    const events = await gcal.listEvents({ timeMin: start, timeMax: end, max: 20 });
    return events
      .filter((e) => e.id !== ignoreEventId && isBlocking(e) && overlaps({ start: new Date(e.start), end: new Date(e.end) }, { start, end }))
      .map((e) => `"${e.title}" (${formatShort(new Date(e.start), tz)})`);
  }

  async function timedEvent(eventId: string): Promise<CalEvent> {
    const event = await gcal.getEvent(eventId);
    if (event.allDay) throw new ToolError("Kairos can only change timed events, not all-day events.");
    return event;
  }

  return {
    get_events: tool({
      description:
        "List events on the user's calendar between two local dates (inclusive). Use it for any question about the schedule, " +
        "and to find an event's id before moving or cancelling it.",
      inputSchema: z.object({
        from: localDate,
        to: localDate,
        query: z.string().optional().describe("Optional text to match against titles, descriptions and attendees"),
      }),
      execute: safely(async ({ from, to, query }) => {
        const events = await gcal.listEvents({
          timeMin: startOfLocalDay(from, tz),
          timeMax: startOfLocalDay(addDaysToLocalDate(to, 1), tz),
          query,
          max: 250,
        });
        return { timeZone: tz, count: events.length, events: events.map((e) => eventForModel(e, tz, user.email)) };
      }),
    }),

    get_event: tool({
      description: "Full details of one event: description/agenda, attendees with RSVP status, organizer, location, Meet link.",
      inputSchema: z.object({ eventId: z.string() }),
      execute: safely(async ({ eventId }) => {
        const e = await gcal.getEvent(eventId);
        return {
          ...eventForModel(e, tz, user.email),
          description: e.description ? stripHtml(e.description).slice(0, 2000) : undefined,
          location: e.location,
          organizer: e.organizerEmail,
          attendees: e.attendees.map((a) => ({
            name: a.name,
            email: a.email,
            response: a.responseStatus,
            isMe: a.self || undefined,
            optional: a.optional || undefined,
          })),
        };
      }),
    }),

    search_contacts: tool({
      description:
        "Find people the user has met with, by name or email fragment, to resolve names like 'Priya' to an email address.",
      inputSchema: z.object({ query: z.string().min(1) }),
      execute: safely(async ({ query }) => {
        await syncIfStale(session);
        const pattern = `%${query.trim()}%`;
        const rows = await getDb()
          .select()
          .from(contacts)
          .where(and(eq(contacts.userId, session.userId), or(ilike(contacts.name, pattern), ilike(contacts.email, pattern))))
          .orderBy(desc(contacts.meetingCount))
          .limit(5);
        return {
          matches: rows.map((c) => ({
            name: c.name,
            email: c.email,
            meetingsTogether: c.meetingCount,
            lastMet: c.lastMetAt ? toLocalDate(c.lastMetAt, tz) : undefined,
          })),
          hint: rows.length ? undefined : "No match in recent meetings. Ask the user for the email address.",
        };
      }),
    }),

    find_free_slots: tool({
      description:
        "Compute the best free time slots, honouring working hours, the user's saved rules and attendees' busy time. " +
        "Always use this instead of working out availability yourself. Returns ranked slots with reasons.",
      inputSchema: z.object({
        durationMinutes: z.number().int().min(5).max(480),
        from: localDate.describe("First local date to search (inclusive)"),
        to: localDate.describe("Last local date to search (inclusive)"),
        attendees: z.array(email).optional().describe("Emails of other people who must be free"),
        earliestTime: hhmm.optional().describe("Earliest start, e.g. 09:00. Use for 'mornings', 'after lunch' etc."),
        latestTime: hhmm.optional().describe("Latest end time, e.g. 12:00 for mornings"),
        excludeDays: z.array(z.enum(WEEKDAYS)).optional(),
        maxResults: z.number().int().min(1).max(8).optional(),
      }),
      execute: safely(async (input) => {
        const timeMin = startOfLocalDay(input.from, tz);
        const timeMax = startOfLocalDay(addDaysToLocalDate(input.to, 1), tz);
        const fb = await gcal.freeBusy({ timeMin, timeMax, emails: input.attendees ?? [] });
        const result = findFreeSlots({
          from: input.from,
          to: input.to,
          durationMinutes: input.durationMinutes,
          timeZone: tz,
          workingHours: user.workingHours,
          earliestTime: input.earliestTime,
          latestTime: input.latestTime,
          excludeDays: input.excludeDays,
          busy: [...fb.busy.values()].flat(),
          ownMeetings: fb.busy.get("primary") ?? [],
          rules,
          maxResults: input.maxResults ?? 5,
        });
        const hidden = fb.unavailable.filter((id) => id !== "primary");
        return {
          timeZone: tz,
          slots: result.slots.map((s) => ({
            start: toLocal(s.start, tz),
            end: toLocal(s.end, tz),
            label: formatRange(s.start, s.end, tz),
            reasons: s.reasons,
          })),
          notes: [
            ...result.notes,
            ...(hidden.length
              ? [`Couldn't see the calendars of ${hidden.join(", ")}; these slots only reflect the user's availability for them.`]
              : []),
          ],
        };
      }),
    }),

    propose_create_event: tool({
      description:
        "Propose a new event for the user to approve. Offer 1–3 time options (best first). " +
        "Nothing is booked until the user approves the card in the UI.",
      inputSchema: z.object({
        title: z.string().min(1).max(200),
        description: z.string().max(4000).optional().describe("Agenda or notes. Draft a short agenda for meetings with others."),
        location: z.string().max(300).optional(),
        attendees: z.array(email).default([]).describe("Other attendees' emails (not the user)"),
        addMeetLink: z.boolean().optional().describe("Add a Google Meet link. Defaults to true when there are attendees."),
        options: z
          .array(z.object({ start: localDateTime, end: localDateTime, reason: z.string().max(160).optional() }))
          .min(1)
          .max(3),
        reason: z.string().max(200).optional().describe("Why this is being proposed, if the user didn't ask directly"),
      }),
      execute: safely(async (input) => {
        const now = new Date();
        const options: SlotOption[] = input.options.map((o) => {
          const start = parseLocal(o.start, tz);
          const end = parseLocal(o.end, tz);
          if (end <= start) throw new ToolError(`Option ${o.start} ends before it starts.`);
          if (start < now) throw new ToolError(`Option ${o.start} is in the past.`);
          return { start: start.toISOString(), end: end.toISOString(), label: formatRange(start, end, tz), reason: o.reason };
        });
        const warnings: string[] = [];
        for (const o of options) {
          const hit = await clashes(new Date(o.start), new Date(o.end));
          if (hit.length) warnings.push(`${o.label} overlaps ${hit.join(", ")}`);
        }
        const attendees = [...new Set(input.attendees.map((a) => a.toLowerCase()))].filter(
          (a) => a !== user.email.toLowerCase(),
        );
        if (attendees.length) warnings.push(`${attendees.length} attendee${attendees.length > 1 ? "s" : ""} will get an invite.`);
        return createProposal(
          session,
          {
            kind: "create_event",
            title: input.title,
            description: input.description,
            location: input.location,
            attendees,
            addMeetLink: input.addMeetLink ?? attendees.length > 0,
            options,
            reason: input.reason,
            warnings,
          },
          `Schedule "${input.title}"`,
        );
      }),
    }),

    propose_update_event: tool({
      description:
        "Propose changing an existing event (move it, rename it, edit the agenda, add or remove attendees). " +
        "Get the eventId from get_events first. Nothing changes until the user approves.",
      inputSchema: z.object({
        eventId: z.string(),
        newStart: localDateTime.optional(),
        newEnd: localDateTime.optional().describe("Omit to keep the current duration"),
        title: z.string().max(200).optional(),
        description: z.string().max(4000).optional(),
        location: z.string().max(300).optional(),
        addAttendees: z.array(email).optional(),
        removeAttendees: z.array(email).optional(),
        reason: z.string().max(200).optional(),
      }),
      execute: safely(async (input) => {
        const event = await timedEvent(input.eventId);
        const curStart = new Date(event.start);
        const curEnd = new Date(event.end);
        const changes: Record<string, unknown> = {};
        const warnings: string[] = [];
        let newLabel: string | undefined;

        if (input.newStart || input.newEnd) {
          const start = input.newStart ? parseLocal(input.newStart, tz) : curStart;
          const end = input.newEnd ? parseLocal(input.newEnd, tz) : new Date(start.getTime() + (curEnd.getTime() - curStart.getTime()));
          if (end <= start) throw new ToolError("The new end time is before the start.");
          if (start < new Date()) throw new ToolError("The new time is in the past.");
          changes.start = start.toISOString();
          changes.end = end.toISOString();
          newLabel = formatRange(start, end, tz);
          const hit = await clashes(start, end, event.id);
          if (hit.length) warnings.push(`New time overlaps ${hit.join(", ")}`);
        }
        for (const key of ["title", "description", "location", "addAttendees", "removeAttendees"] as const) {
          if (input[key] !== undefined) changes[key] = input[key];
        }
        if (!Object.keys(changes).length) throw new ToolError("No changes were specified.");

        const others = event.attendees.filter((a) => !a.self);
        if (event.organizerSelf === false) {
          warnings.push("You're not the organizer, so this only changes your copy. Consider asking the organizer instead.");
        } else if (others.length) {
          warnings.push(`${others.length} attendee${others.length > 1 ? "s" : ""} will be notified.`);
        }
        if (event.recurring) warnings.push("Only this occurrence of the recurring event changes.");

        const what = newLabel ? `Move "${event.title}"` : `Update "${event.title}"`;
        return createProposal(
          session,
          {
            kind: "update_event",
            eventId: event.id,
            eventTitle: event.title,
            currentLabel: formatRange(curStart, curEnd, tz),
            newLabel,
            changes,
            reason: input.reason,
            warnings,
          },
          what,
        );
      }),
    }),

    propose_delete_event: tool({
      description: "Propose cancelling or removing an event. Get the eventId from get_events first. Nothing changes until the user approves.",
      inputSchema: z.object({ eventId: z.string(), reason: z.string().max(200).optional() }),
      execute: safely(async ({ eventId, reason }) => {
        const event = await timedEvent(eventId);
        const others = event.attendees.filter((a) => !a.self);
        const warnings: string[] = [];
        if (event.organizerSelf === false) warnings.push("You're not the organizer; this removes it from your calendar only.");
        else if (others.length) warnings.push(`${others.length} attendee${others.length > 1 ? "s" : ""} will get a cancellation.`);
        if (event.recurring) warnings.push("Only this occurrence of the recurring event is removed.");
        return createProposal(
          session,
          {
            kind: "delete_event",
            eventId,
            eventTitle: event.title,
            currentLabel: formatRange(new Date(event.start), new Date(event.end), tz),
            attendeeCount: others.length,
            reason,
            warnings,
          },
          `Cancel "${event.title}"`,
        );
      }),
    }),

    propose_undo: tool({
      description:
        "When the user asks to undo or revert, find the change to undo (the latest executed one by default) and show an undo button.",
      inputSchema: z.object({ actionId: z.string().uuid().optional() }),
      execute: safely(async ({ actionId }) => {
        const action = actionId ? { id: actionId } : await lastExecutedAction(session.userId);
        if (!action) return { found: false as const, message: "There's nothing to undo yet." };
        const state = await getActionState(session, action.id);
        if (state.status !== "executed") {
          return { found: false as const, message: `That change is ${state.status}, so it can't be undone.` };
        }
        return { found: true as const, actionId: state.id, summary: state.summary, resultLabel: state.resultLabel };
      }),
    }),

    save_preference: tool({
      description:
        "Save a lasting scheduling preference the user states (e.g. 'no meetings before 10 on Fridays', 'keep 2–4pm for focus'). " +
        "It is enforced in every future slot search.",
      inputSchema: flatRuleSchema.extend({
        ruleText: z.string().max(200).describe("The preference in the user's own words"),
      }),
      execute: safely(async ({ ruleText, ...flat }) => {
        let rule: Rule;
        try {
          rule = normalizeRule(flat);
        } catch (err) {
          throw new ToolError((err as Error).message);
        }
        const [row] = await getDb()
          .insert(preferences)
          .values({ userId: session.userId, ruleText, rule })
          .returning({ id: preferences.id });
        return { saved: true, id: row.id, description: describeRule(rule, ruleText) };
      }),
    }),
  };
}

export type KairosTools = ReturnType<typeof createTools>;
