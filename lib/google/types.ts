/** Calendar event as Kairos sees it. Safe to import from client components. */
export type CalEvent = {
  id: string;
  title: string;
  description?: string;
  location?: string;
  allDay: boolean;
  /** Timed events: ISO instant with offset. All-day events: "YYYY-MM-DD". */
  start: string;
  /** Timed events: ISO instant. All-day events: "YYYY-MM-DD", exclusive. */
  end: string;
  attendees: Attendee[];
  organizerEmail?: string;
  organizerSelf?: boolean;
  meetLink?: string;
  htmlLink?: string;
  recurring: boolean;
  /** The user's own RSVP, when they are an attendee. */
  myResponse?: string;
  /** "Free" events (transparency=transparent) don't block time. */
  transparent: boolean;
  eventType?: string;
};

export type Attendee = {
  email: string;
  name?: string;
  responseStatus?: string;
  self?: boolean;
  organizer?: boolean;
  optional?: boolean;
};

/** Does this event actually occupy the user's time? */
export function isBlocking(e: CalEvent): boolean {
  return !e.allDay && !e.transparent && e.myResponse !== "declined";
}

export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];
