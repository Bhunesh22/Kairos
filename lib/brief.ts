import "server-only";
import { createHash } from "node:crypto";
import { generateText, Output } from "ai";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getModel } from "@/lib/agent/model";
import type { BriefContent } from "@/lib/brief-types";
import { categorize } from "@/lib/categorize";
import { getDb } from "@/lib/db";
import { briefs } from "@/lib/db/schema";
import { isBlocking, type CalEvent } from "@/lib/google/types";
import { formatHours, freeIntervals } from "@/lib/scheduling/find-slots";
import type { Session } from "@/lib/session";
import {
  addDaysToLocalDate,
  atLocalMinutes,
  formatShort,
  hhmmToMinutes,
  mergeIntervals,
  startOfLocalDay,
  toLocal,
  toLocalDate,
  weekdayOfLocalDate,
  type Interval,
} from "@/lib/time";

const MINUTE = 60_000;
const minutesOf = (i: Interval) => (i.end.getTime() - i.start.getTime()) / MINUTE;
const hhmm = (d: Date, tz: string) => toLocal(d, tz).slice(11);

type Facts = ReturnType<typeof computeFacts>;

/** Deterministic analysis of a day. The LLM only narrates these facts. */
export function computeFacts(events: CalEvent[], opts: { tz: string; date: string; myEmail: string; workStart: string; workEnd: string; isWorkday: boolean }) {
  const { tz, date } = opts;
  const timed = events.filter(isBlocking).sort((a, b) => a.start.localeCompare(b.start));
  const iv = (e: CalEvent): Interval => ({ start: new Date(e.start), end: new Date(e.end) });
  const meetings = timed.filter((e) => e.attendees.some((a) => !a.self));

  const conflicts: string[] = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = iv(timed[i]);
      const b = iv(timed[j]);
      if (b.start >= a.end) break;
      conflicts.push(`"${timed[i].title}" overlaps "${timed[j].title}" at ${hhmm(b.start, tz)}`);
    }
  }

  const backToBack: string[] = [];
  const merged = mergeIntervals(timed.map(iv));
  let chain: Interval[] = [];
  const flush = () => {
    if (chain.length >= 3) {
      backToBack.push(`${chain.length} meetings back to back ${hhmm(chain[0].start, tz)}–${hhmm(chain.at(-1)!.end, tz)} with no break`);
    }
    chain = [];
  };
  for (const e of timed.map(iv)) {
    const last = chain.at(-1);
    if (last && (e.start.getTime() - last.end.getTime()) / MINUTE > 5) flush();
    chain.push(e);
  }
  flush();

  const work: Interval = {
    start: atLocalMinutes(date, hhmmToMinutes(opts.workStart), tz),
    end: atLocalMinutes(date, hhmmToMinutes(opts.workEnd), tz),
  };
  const free = opts.isWorkday ? freeIntervals(work, merged) : [];
  const focusBlocks = free.filter((f) => minutesOf(f) >= 60);

  const prepCandidates = meetings
    .filter((e) => e.myResponse !== "declined")
    .map((e) => ({
      eventId: e.id,
      title: e.title,
      time: formatShort(new Date(e.start), tz),
      noAgenda: !e.description?.trim(),
      category: categorize(e, opts.myEmail),
      attendees: e.attendees.filter((a) => !a.self).length,
    }))
    .filter((m) => m.noAgenda || m.category === "external");

  return {
    date,
    isWorkday: opts.isWorkday,
    events: timed.map((e) => ({
      id: e.id,
      title: e.title,
      start: hhmm(new Date(e.start), tz),
      end: hhmm(new Date(e.end), tz),
      category: categorize(e, opts.myEmail),
      attendees: e.attendees.filter((a) => !a.self).length,
      hasAgenda: !!e.description?.trim(),
    })),
    stats: {
      meetings: meetings.length,
      meetingMinutes: Math.round(mergeIntervals(meetings.map(iv)).reduce((s, i) => s + minutesOf(i), 0)),
      focusMinutes: Math.round(focusBlocks.reduce((s, i) => s + minutesOf(i), 0)),
      longestFreeBlockMinutes: Math.round(Math.max(0, ...free.map(minutesOf))),
      conflicts: conflicts.length,
    },
    conflicts,
    backToBack,
    freeBlocks: focusBlocks.map((f) => `${hhmm(f.start, tz)}–${hhmm(f.end, tz)}`),
    prepCandidates,
  };
}

function fallbackBrief(f: Facts, eventsHash: string): BriefContent {
  const { stats } = f;
  const headline = !f.events.length
    ? "Your day is clear"
    : `${stats.meetings} meeting${stats.meetings === 1 ? "" : "s"}, ${formatHours(stats.focusMinutes)} of focus time`;
  const suggestions: BriefContent["suggestions"] = [];
  if (f.conflicts.length) suggestions.push({ label: "Resolve conflict", prompt: `Help me resolve today's conflict: ${f.conflicts[0]}.` });
  if (f.backToBack.length) suggestions.push({ label: "Add breaks", prompt: "Add short breaks between my back-to-back meetings today." });
  if (stats.focusMinutes < 120 && f.isWorkday) {
    suggestions.push({ label: "Protect focus time", prompt: "Find and propose a 2-hour focus block for me in the next 3 working days." });
  }
  suggestions.push({ label: "Plan tomorrow", prompt: "What does tomorrow look like, and is there anything I should fix?" });
  return {
    date: f.date,
    eventsHash,
    stats,
    headline,
    summary: f.freeBlocks.length ? `Free for deep work: ${f.freeBlocks.join(", ")}.` : "No long free blocks today.",
    headsUp: [...f.conflicts, ...f.backToBack],
    prep: f.prepCandidates.slice(0, 3).map((p) => ({
      eventId: p.eventId,
      title: p.title,
      time: p.time,
      note: p.noAgenda ? "No agenda yet" : "External meeting",
    })),
    suggestions: suggestions.slice(0, 3),
    aiGenerated: false,
  };
}

const aiBriefSchema = z.object({
  headline: z.string().describe("At most 10 words. The single most useful thing about the day."),
  summary: z.string().describe("Two short sentences: shape of the day and where the focus time is."),
  prep: z
    .array(z.object({ eventId: z.string(), note: z.string().describe("At most 12 words: what to prepare or why it matters") }))
    .max(3),
  suggestions: z
    .array(
      z.object({
        label: z.string().describe("Button text, at most 4 words"),
        prompt: z.string().describe("A first-person instruction to the Kairos agent, e.g. 'Move my 15:00 design review to tomorrow afternoon'"),
      }),
    )
    .max(3),
});

export async function getDailyBrief(session: Session, { refresh = false } = {}): Promise<BriefContent> {
  const { gcal, user, userId } = session;
  const tz = user.timezone;
  const date = toLocalDate(new Date(), tz);
  const events = await gcal.listEvents({
    timeMin: startOfLocalDay(date, tz),
    timeMax: startOfLocalDay(addDaysToLocalDate(date, 1), tz),
    max: 100,
  });
  const eventsHash = createHash("sha1")
    .update(JSON.stringify(events.map((e) => [e.id, e.start, e.end, e.title, e.myResponse, !!e.description])))
    .digest("hex");

  const db = getDb();
  const where = and(eq(briefs.userId, userId), eq(briefs.type, "daily"), eq(briefs.refId, date));
  const [cached] = await db.select().from(briefs).where(where);
  if (cached && !refresh && cached.content.eventsHash === eventsHash) return cached.content;

  const facts = computeFacts(events, {
    tz,
    date,
    myEmail: user.email,
    workStart: user.workingHours.start,
    workEnd: user.workingHours.end,
    isWorkday: user.workingHours.days.includes(weekdayOfLocalDate(date)),
  });
  let content = fallbackBrief(facts, eventsHash);

  try {
    const { output } = await generateText({
      model: getModel(),
      output: Output.object({ schema: aiBriefSchema }),
      instructions:
        "You write a crisp morning brief for a busy professional, like a great chief of staff. " +
        "Use only the facts given. Times are local. Prioritise conflicts, overload and missing prep. " +
        "Suggestions must be concrete actions the calendar agent can take (reschedule, add buffers, block focus time, draft an agenda).",
      prompt: JSON.stringify({
        today: date,
        workingHours: `${user.workingHours.start}–${user.workingHours.end}`,
        focusGoalHoursPerDay: user.goals.focusHoursPerDay,
        ...facts,
      }),
    });
    const prepById = new Map(facts.prepCandidates.map((p) => [p.eventId, p]));
    const knownEvents = new Map(facts.events.map((e) => [e.id, e]));
    content = {
      ...content,
      headline: output.headline,
      summary: output.summary,
      prep: output.prep.flatMap((p) => {
        const e = prepById.get(p.eventId) ?? knownEvents.get(p.eventId);
        if (!e) return [];
        const time = "time" in e ? e.time : e.start;
        return [{ eventId: p.eventId, title: e.title, time, note: p.note }];
      }),
      suggestions: output.suggestions.length ? output.suggestions : content.suggestions,
      aiGenerated: true,
    };
  } catch (err) {
    console.warn("Daily brief: falling back to deterministic brief", err);
  }

  await db
    .insert(briefs)
    .values({ userId, type: "daily", refId: date, content, generatedAt: new Date() })
    .onConflictDoUpdate({ target: [briefs.userId, briefs.type, briefs.refId], set: { content, generatedAt: new Date() } });
  return content;
}
