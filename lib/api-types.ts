import type { CalEvent } from "@/lib/google/types";
import type { Goals, Rule, WorkingHours } from "@/lib/scheduling/rules";

/** Response shapes shared by API routes and client hooks. */

export type MeResponse = {
  name: string | null;
  email: string;
  picture: string | null;
  /** "google" = synced Google Calendar; "local" = Kairos calendar stored in Neon. */
  calendarProvider: "google" | "local";
  googleLinked: boolean;
  timezone: string;
  workingHours: WorkingHours;
  goals: Goals;
};

export type EventsResponse = { timeZone: string; events: CalEvent[] };

export type PreferenceDTO = {
  id: string;
  ruleText: string;
  rule: Rule;
  description: string;
  active: boolean;
  createdAt: string;
};

export type ApiErrorBody = { error: string; code: string };
