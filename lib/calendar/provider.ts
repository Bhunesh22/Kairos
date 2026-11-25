import type { Attendee, CalEvent } from "@/lib/google/types";
import type { Interval } from "@/lib/time";

/**
 * What the agent, briefs and API routes need from a calendar. Implemented by
 * GoogleCalendar (synced with Google) and LocalCalendar (stored in Neon, for
 * people who can't or don't connect Google).
 */
export interface CalendarProvider {
  readonly kind: CalendarKind;
  getTimezone(): Promise<string | undefined>;
  listEvents(opts: { timeMin: Date; timeMax: Date; query?: string; max?: number }): Promise<CalEvent[]>;
  getEvent(eventId: string): Promise<CalEvent>;
  createEvent(input: NewEventInput): Promise<CalEvent>;
  patchEvent(eventId: string, patch: EventPatch, notifyAttendees: boolean): Promise<CalEvent>;
  deleteEvent(eventId: string, notifyAttendees: boolean): Promise<void>;
  /** Busy intervals keyed by email ("primary" = the user). Calendars that can't be read go in `unavailable`. */
  freeBusy(opts: { timeMin: Date; timeMax: Date; emails: string[] }): Promise<{ busy: Map<string, Interval[]>; unavailable: string[] }>;
}

export type CalendarKind = "google" | "local";

export type NewEventInput = {
  title: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  attendees: string[];
  /** Video link: Google Meet on Google calendars, Jitsi on Kairos calendars. */
  addMeetLink: boolean;
  timeZone: string;
};

export type EventPatch = {
  title?: string;
  description?: string;
  location?: string;
  start?: Date;
  end?: Date;
  /** Full replacement attendee list. Pass existing attendees through unchanged to keep their RSVPs. */
  attendees?: Pick<Attendee, "email" | "name" | "responseStatus" | "optional">[];
  timeZone: string;
};
