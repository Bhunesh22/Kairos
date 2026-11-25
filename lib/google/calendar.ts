import "server-only";
import { auth as googleAuth, calendar as googleCalendar, type calendar_v3 } from "@googleapis/calendar";
import type { Interval } from "@/lib/time";
import type { CalendarProvider, EventPatch, NewEventInput } from "@/lib/calendar/provider";
import type { CalEvent } from "./types";

export type GoogleErrorKind = "auth" | "not_found" | "rate_limit" | "other";

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly kind: GoogleErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

async function call<T>(fn: () => Promise<{ data: T }>): Promise<T> {
  try {
    return (await fn()).data;
  } catch (err) {
    const e = err as { status?: number; code?: number | string; response?: { status?: number }; message?: string };
    const status = e.response?.status ?? e.status ?? (typeof e.code === "number" ? e.code : undefined);
    const message = e.message ?? "Google Calendar request failed";
    if (status === 401 || (status === 403 && /scope|permission|insufficient/i.test(message))) {
      throw new GoogleApiError(message, "auth", status);
    }
    if (status === 404 || status === 410) throw new GoogleApiError(message, "not_found", status);
    if (status === 429 || (status === 403 && /rate|quota/i.test(message))) throw new GoogleApiError(message, "rate_limit", status);
    throw new GoogleApiError(message, "other", status);
  }
}

function toCalEvent(e: calendar_v3.Schema$Event): CalEvent {
  const self = e.attendees?.find((a) => a.self);
  return {
    id: e.id!,
    title: e.summary?.trim() || "(No title)",
    description: e.description ?? undefined,
    location: e.location ?? undefined,
    allDay: !!e.start?.date,
    start: (e.start?.dateTime ?? e.start?.date)!,
    end: (e.end?.dateTime ?? e.end?.date)!,
    attendees: (e.attendees ?? [])
      .filter((a) => a.email && !a.resource)
      .map((a) => ({
        email: a.email!,
        name: a.displayName ?? undefined,
        responseStatus: a.responseStatus ?? undefined,
        self: a.self ?? undefined,
        organizer: a.organizer ?? undefined,
        optional: a.optional ?? undefined,
      })),
    organizerEmail: e.organizer?.email ?? undefined,
    organizerSelf: e.organizer?.self ?? undefined,
    meetLink: e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? undefined,
    htmlLink: e.htmlLink ?? undefined,
    recurring: !!e.recurringEventId,
    myResponse: self?.responseStatus ?? undefined,
    transparent: e.transparency === "transparent",
    eventType: e.eventType ?? undefined,
  };
}

/** Typed wrapper over Google Calendar v3 for the user's primary calendar. */
export class GoogleCalendar implements CalendarProvider {
  readonly kind = "google" as const;

  constructor(
    private readonly api: calendar_v3.Calendar,
    private readonly calendarId = "primary",
  ) {}

  static fromAccessToken(accessToken: string): GoogleCalendar {
    const oauth = new googleAuth.OAuth2();
    oauth.setCredentials({ access_token: accessToken });
    return new GoogleCalendar(googleCalendar({ version: "v3", auth: oauth }));
  }

  async getTimezone(): Promise<string | undefined> {
    const data = await call(() => this.api.settings.get({ setting: "timezone" }));
    return data.value ?? undefined;
  }

  async listEvents(opts: { timeMin: Date; timeMax: Date; query?: string; max?: number }): Promise<CalEvent[]> {
    const max = opts.max ?? 250;
    const out: CalEvent[] = [];
    let pageToken: string | undefined;
    do {
      const data = await call(() =>
        this.api.events.list({
          calendarId: this.calendarId,
          timeMin: opts.timeMin.toISOString(),
          timeMax: opts.timeMax.toISOString(),
          q: opts.query,
          singleEvents: true,
          orderBy: "startTime",
          maxResults: Math.min(250, max - out.length),
          pageToken,
        }),
      );
      for (const item of data.items ?? []) {
        if (item.status !== "cancelled" && item.id && (item.start?.dateTime || item.start?.date)) out.push(toCalEvent(item));
      }
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken && out.length < max);
    return out;
  }

  async getEvent(eventId: string): Promise<CalEvent> {
    return toCalEvent(await call(() => this.api.events.get({ calendarId: this.calendarId, eventId })));
  }

  async createEvent(input: NewEventInput): Promise<CalEvent> {
    const data = await call(() =>
      this.api.events.insert({
        calendarId: this.calendarId,
        conferenceDataVersion: input.addMeetLink ? 1 : 0,
        sendUpdates: input.attendees.length ? "all" : "none",
        requestBody: {
          summary: input.title,
          description: input.description,
          location: input.location,
          start: { dateTime: input.start.toISOString(), timeZone: input.timeZone },
          end: { dateTime: input.end.toISOString(), timeZone: input.timeZone },
          attendees: input.attendees.map((email) => ({ email })),
          conferenceData: input.addMeetLink
            ? { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } }
            : undefined,
        },
      }),
    );
    return toCalEvent(data);
  }

  async patchEvent(eventId: string, patch: EventPatch, notifyAttendees: boolean): Promise<CalEvent> {
    const body: calendar_v3.Schema$Event = {};
    if (patch.title !== undefined) body.summary = patch.title;
    if (patch.description !== undefined) body.description = patch.description;
    if (patch.location !== undefined) body.location = patch.location;
    if (patch.start) body.start = { dateTime: patch.start.toISOString(), timeZone: patch.timeZone };
    if (patch.end) body.end = { dateTime: patch.end.toISOString(), timeZone: patch.timeZone };
    if (patch.attendees) {
      body.attendees = patch.attendees.map((a) => ({
        email: a.email,
        displayName: a.name,
        responseStatus: a.responseStatus,
        optional: a.optional,
      }));
    }
    const data = await call(() =>
      this.api.events.patch({
        calendarId: this.calendarId,
        eventId,
        sendUpdates: notifyAttendees ? "all" : "none",
        requestBody: body,
      }),
    );
    return toCalEvent(data);
  }

  async deleteEvent(eventId: string, notifyAttendees: boolean): Promise<void> {
    try {
      await call(() =>
        this.api.events.delete({ calendarId: this.calendarId, eventId, sendUpdates: notifyAttendees ? "all" : "none" }),
      );
    } catch (err) {
      // Already gone is fine for a delete.
      if (!(err instanceof GoogleApiError && err.kind === "not_found")) throw err;
    }
  }

  /**
   * Busy intervals per email. Calendars we can't see (outside the user's
   * Workspace, not shared) come back in `unavailable` rather than failing.
   */
  async freeBusy(opts: { timeMin: Date; timeMax: Date; emails: string[] }) {
    const ids = [...new Set([this.calendarId, ...opts.emails])];
    const data = await call(() =>
      this.api.freebusy.query({
        requestBody: {
          timeMin: opts.timeMin.toISOString(),
          timeMax: opts.timeMax.toISOString(),
          items: ids.map((id) => ({ id })),
        },
      }),
    );
    const busy = new Map<string, Interval[]>();
    const unavailable: string[] = [];
    for (const id of ids) {
      const cal = data.calendars?.[id];
      if (!cal || cal.errors?.length) {
        unavailable.push(id);
        continue;
      }
      busy.set(
        id,
        (cal.busy ?? []).flatMap((b) => (b.start && b.end ? [{ start: new Date(b.start), end: new Date(b.end) }] : [])),
      );
    }
    return { busy, unavailable };
  }
}
