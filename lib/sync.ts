import "server-only";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { categorize } from "@/lib/categorize";
import { getDb } from "@/lib/db";
import { contacts, eventsCache, syncState } from "@/lib/db/schema";
import type { CalEvent } from "@/lib/google/types";
import type { Session } from "@/lib/session";

const STALE_MS = 30 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const CHUNK = 400;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function eventRange(e: CalEvent) {
  // All-day dates are stored as UTC midnight; they're excluded from time maths anyway.
  return e.allDay
    ? { startAt: new Date(`${e.start}T00:00:00Z`), endAt: new Date(`${e.end}T00:00:00Z`) }
    : { startAt: new Date(e.start), endAt: new Date(e.end) };
}

/**
 * Mirrors the last 90 days and next 30 days of events into Neon and rebuilds
 * the contact list from attendees. Cheap enough to run every 30 minutes.
 */
export async function syncIfStale(session: Session, { force = false } = {}): Promise<boolean> {
  const db = getDb();
  const { userId, user, calendar } = session;
  const [state] = await db
    .select()
    .from(syncState)
    .where(and(eq(syncState.userId, userId), eq(syncState.calendarId, "primary")));
  if (!force && state?.lastSyncedAt && Date.now() - state.lastSyncedAt.getTime() < STALE_MS) return false;

  const now = new Date();
  const timeMin = new Date(now.getTime() - 90 * DAY_MS);
  const timeMax = new Date(now.getTime() + 30 * DAY_MS);
  const events = await calendar.listEvents({ timeMin, timeMax, max: 2000 });

  const eventRows = events.map((e) => ({
    userId,
    googleEventId: e.id,
    calendarId: "primary",
    title: e.title,
    ...eventRange(e),
    allDay: e.allDay,
    attendees: e.attendees.map(({ email, name, responseStatus }) => ({ email, name, responseStatus })),
    category: categorize(e, user.email),
    updatedAt: now,
  }));

  // Contacts: everyone the user has met (or will meet) in small meetings.
  const people = new Map<string, { email: string; name: string | null; meetingCount: number; lastMetAt: Date | null }>();
  for (const e of events) {
    if (e.allDay || e.attendees.length > 25) continue;
    const start = new Date(e.start);
    for (const a of e.attendees) {
      if (a.self || a.email.endsWith("calendar.google.com")) continue;
      const email = a.email.toLowerCase();
      const p = people.get(email) ?? { email, name: null, meetingCount: 0, lastMetAt: null };
      p.name = p.name ?? a.name ?? null;
      p.meetingCount += 1;
      if (start <= now && (!p.lastMetAt || start > p.lastMetAt)) p.lastMetAt = start;
      people.set(email, p);
    }
  }
  const contactRows = [...people.values()].map((p) => ({ userId, ...p }));

  await db.batch([
    db
      .delete(eventsCache)
      .where(and(eq(eventsCache.userId, userId), gte(eventsCache.startAt, timeMin), lt(eventsCache.startAt, timeMax))),
    ...chunks(eventRows, CHUNK).map((rows) => db.insert(eventsCache).values(rows).onConflictDoNothing()),
    ...chunks(contactRows, CHUNK).map((rows) =>
      db
        .insert(contacts)
        .values(rows)
        .onConflictDoUpdate({
          target: [contacts.userId, contacts.email],
          set: {
            name: sql`coalesce(excluded.name, ${contacts.name})`,
            meetingCount: sql`excluded.meeting_count`,
            lastMetAt: sql`excluded.last_met_at`,
          },
        }),
    ),
    db
      .insert(syncState)
      .values({ userId, calendarId: "primary", lastSyncedAt: now })
      .onConflictDoUpdate({ target: [syncState.userId, syncState.calendarId], set: { lastSyncedAt: now } }),
  ]);
  return true;
}
