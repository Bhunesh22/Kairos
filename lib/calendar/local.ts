import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, count, eq, gt, ilike, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { localEvents, type LocalEvent, type User } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import type { CalEvent } from "@/lib/google/types";
import { parseLocal, startOfLocalWeek, toLocalDate } from "@/lib/time";
import type { CalendarProvider, EventPatch, NewEventInput } from "./provider";
import { buildSampleWeeks } from "./sample-week";

type Db = ReturnType<typeof getDb>;
type Owner = Pick<User, "id" | "email" | "name" | "timezone">;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Video links for Kairos calendars: Jitsi rooms work without accounts. */
export function videoLink(): string {
  return `https://meet.jit.si/Kairos-${randomBytes(9).toString("base64url")}`;
}

/** Same shape as Google events, so the agent and UI don't care where an event lives. */
export function localToCalEvent(row: LocalEvent, owner: Pick<User, "email" | "name">): CalEvent {
  const others = row.attendees.map((a) => ({ email: a.email, name: a.name, optional: a.optional, responseStatus: "needsAction" }));
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    location: row.location ?? undefined,
    allDay: false,
    start: row.startAt.toISOString(),
    end: row.endAt.toISOString(),
    attendees: others.length
      ? [{ email: owner.email, name: owner.name ?? undefined, self: true, organizer: true, responseStatus: "accepted" }, ...others]
      : [],
    organizerEmail: owner.email,
    organizerSelf: true,
    meetLink: row.meetLink ?? undefined,
    recurring: false,
    myResponse: others.length ? "accepted" : undefined,
    transparent: false,
  };
}

const notFound = () => new AppError("not_found", "That event no longer exists.", 404);

/** A calendar stored in Neon, for people who don't sync Google Calendar. */
export class LocalCalendar implements CalendarProvider {
  readonly kind = "local" as const;

  constructor(
    private readonly owner: Owner,
    private readonly db: Db = getDb(),
  ) {}

  async getTimezone(): Promise<string> {
    return this.owner.timezone;
  }

  async listEvents({ timeMin, timeMax, query, max = 250 }: { timeMin: Date; timeMax: Date; query?: string; max?: number }) {
    const conditions = [eq(localEvents.userId, this.owner.id), lt(localEvents.startAt, timeMax), gt(localEvents.endAt, timeMin)];
    if (query?.trim()) {
      const pattern = `%${query.trim()}%`;
      conditions.push(
        or(ilike(localEvents.title, pattern), ilike(localEvents.description, pattern), ilike(sql`${localEvents.attendees}::text`, pattern))!,
      );
    }
    const rows = await this.db
      .select()
      .from(localEvents)
      .where(and(...conditions))
      .orderBy(asc(localEvents.startAt))
      .limit(max);
    return rows.map((r) => localToCalEvent(r, this.owner));
  }

  private async row(eventId: string): Promise<LocalEvent> {
    if (!UUID_RE.test(eventId)) throw notFound();
    const [row] = await this.db
      .select()
      .from(localEvents)
      .where(and(eq(localEvents.id, eventId), eq(localEvents.userId, this.owner.id)));
    if (!row) throw notFound();
    return row;
  }

  async getEvent(eventId: string): Promise<CalEvent> {
    return localToCalEvent(await this.row(eventId), this.owner);
  }

  private otherAttendees(emails: { email: string; name?: string; optional?: boolean }[]) {
    const me = this.owner.email.toLowerCase();
    const seen = new Set<string>();
    return emails.flatMap((a) => {
      const email = a.email.toLowerCase();
      if (email === me || seen.has(email)) return [];
      seen.add(email);
      return [{ email, ...(a.name ? { name: a.name } : {}), ...(a.optional ? { optional: true } : {}) }];
    });
  }

  async createEvent(input: NewEventInput): Promise<CalEvent> {
    const [row] = await this.db
      .insert(localEvents)
      .values({
        userId: this.owner.id,
        title: input.title,
        description: input.description || null,
        location: input.location || null,
        startAt: input.start,
        endAt: input.end,
        attendees: this.otherAttendees(input.attendees.map((email) => ({ email }))),
        meetLink: input.addMeetLink ? videoLink() : null,
      })
      .returning();
    return localToCalEvent(row, this.owner);
  }

  async patchEvent(eventId: string, patch: EventPatch): Promise<CalEvent> {
    await this.row(eventId);
    const set: Partial<typeof localEvents.$inferInsert> = { updatedAt: new Date() };
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.description !== undefined) set.description = patch.description || null;
    if (patch.location !== undefined) set.location = patch.location || null;
    if (patch.start) set.startAt = patch.start;
    if (patch.end) set.endAt = patch.end;
    if (patch.attendees) set.attendees = this.otherAttendees(patch.attendees);
    const [row] = await this.db
      .update(localEvents)
      .set(set)
      .where(and(eq(localEvents.id, eventId), eq(localEvents.userId, this.owner.id)))
      .returning();
    return localToCalEvent(row, this.owner);
  }

  async deleteEvent(eventId: string): Promise<void> {
    if (!UUID_RE.test(eventId)) return;
    await this.db.delete(localEvents).where(and(eq(localEvents.id, eventId), eq(localEvents.userId, this.owner.id)));
  }

  /** Only the owner's calendar is visible; other people are reported as unavailable, like private Google calendars. */
  async freeBusy({ timeMin, timeMax, emails }: { timeMin: Date; timeMax: Date; emails: string[] }) {
    const rows = await this.db
      .select({ start: localEvents.startAt, end: localEvents.endAt })
      .from(localEvents)
      .where(and(eq(localEvents.userId, this.owner.id), lt(localEvents.startAt, timeMax), gt(localEvents.endAt, timeMin)));
    return {
      busy: new Map([["primary", rows.map((r) => ({ start: r.start, end: r.end }))]]),
      unavailable: [...new Set(emails.map((e) => e.toLowerCase()))].filter((e) => e !== this.owner.email.toLowerCase()),
    };
  }

  /** Seeds this week and next with a realistic schedule. Returns the number of events created. */
  async seedSampleEvents(now = new Date()): Promise<number> {
    const monday = startOfLocalWeek(toLocalDate(now, this.owner.timezone));
    const rows = buildSampleWeeks(monday).map((e) => ({
      userId: this.owner.id,
      title: e.title,
      description: e.description ?? null,
      location: e.location ?? null,
      startAt: parseLocal(e.start, this.owner.timezone),
      endAt: parseLocal(e.end, this.owner.timezone),
      attendees: e.attendees,
      meetLink: e.meet ? videoLink() : null,
      isSample: true,
    }));
    if (rows.length) await this.db.insert(localEvents).values(rows);
    return rows.length;
  }

  async countSampleEvents(): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(localEvents)
      .where(and(eq(localEvents.userId, this.owner.id), eq(localEvents.isSample, true)));
    return row?.n ?? 0;
  }

  async deleteSampleEvents(): Promise<number> {
    const deleted = await this.db
      .delete(localEvents)
      .where(and(eq(localEvents.userId, this.owner.id), eq(localEvents.isSample, true)))
      .returning({ id: localEvents.id });
    return deleted.length;
  }
}
