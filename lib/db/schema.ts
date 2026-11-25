import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { BriefContent } from "@/lib/brief-types";
import type { ActionProposal, EventSnapshot } from "@/lib/agent/action-types";
import { DEFAULT_GOALS, DEFAULT_WORKING_HOURS, type Goals, type Rule, type WorkingHours } from "@/lib/scheduling/rules";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const CALENDAR_PROVIDERS = ["google", "local"] as const;

/**
 * One row per person. Created by Google sign-in or email sign-up; a person
 * can have both (linked by verified email or by connecting Google later).
 */
export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  /** Always stored lower-case. */
  email: text("email").notNull().unique(),
  /** Google's stable account id (the ID token's `sub`), once Google is linked. */
  googleSub: text("google_sub").unique(),
  /** scrypt hash for email sign-in; null for Google-only accounts. */
  passwordHash: text("password_hash"),
  /** Which calendar Kairos manages: the user's Google Calendar, or a Kairos calendar stored in Neon. */
  calendarProvider: text("calendar_provider", { enum: CALENDAR_PROVIDERS }).notNull().default("local"),
  name: text("name"),
  picture: text("picture"),
  timezone: text("timezone").notNull().default("UTC"),
  workingHours: jsonb("working_hours").$type<WorkingHours>().notNull().default(DEFAULT_WORKING_HOURS),
  goals: jsonb("goals").$type<Goals>().notNull().default(DEFAULT_GOALS),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

/** Google OAuth tokens, encrypted at rest (AES-256-GCM). Kept apart from `users` so they never travel with profile data. */
export const googleAccounts = pgTable("google_accounts", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  refreshToken: text("refresh_token_enc"),
  accessToken: text("access_token_enc"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  /** Space-separated scopes the user granted. */
  scopes: text("scopes").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Events on Kairos calendars (users who don't sync Google). Same shape the agent sees for Google events. */
export const localEvents = pgTable(
  "local_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    location: text("location"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    /** Other attendees (the owner is implied). */
    attendees: jsonb("attendees").$type<{ email: string; name?: string; optional?: boolean }[]>().notNull().default([]),
    meetLink: text("meet_link"),
    /** Seeded demo data, removable from Settings. */
    isSample: boolean("is_sample").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("local_events_user_start_idx").on(t.userId, t.startAt)],
);

/** Scheduling rules the user taught Kairos ("no meetings before 10 on Fridays"). */
export const preferences = pgTable(
  "preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ruleText: text("rule_text").notNull(),
    rule: jsonb("rule").$type<Rule>().notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("preferences_user_idx").on(t.userId)],
);

/**
 * Local mirror of recent Google events, for contacts, briefs and analytics.
 * Google stays the source of truth; the UI always reads live from Google.
 */
export const eventsCache = pgTable(
  "events_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    googleEventId: text("google_event_id").notNull(),
    calendarId: text("calendar_id").notNull().default("primary"),
    title: text("title").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
    attendees: jsonb("attendees").$type<{ email: string; name?: string; responseStatus?: string }[]>().notNull().default([]),
    category: text("category"),
    isFlexible: boolean("is_flexible"),
    priority: integer("priority"),
    etag: text("etag"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("events_cache_user_event_uq").on(t.userId, t.calendarId, t.googleEventId),
    index("events_cache_user_start_idx").on(t.userId, t.startAt),
  ],
);

/** People the user meets with, derived from event attendees. Resolves "Priya" → priya@acme.com. */
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name"),
    email: text("email").notNull(),
    lastMetAt: timestamp("last_met_at", { withTimezone: true }),
    meetingCount: integer("meeting_count").notNull().default(0),
  },
  (t) => [uniqueIndex("contacts_user_email_uq").on(t.userId, t.email)],
);

export const ACTION_STATUSES = ["proposed", "executing", "executed", "rejected", "failed", "undoing", "undone"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

/** Every calendar change the agent proposes. Approval executes it; before/after snapshots make it undoable. */
export const agentActions = pgTable(
  "agent_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["create_event", "update_event", "delete_event"] }).notNull(),
    summary: text("summary").notNull(),
    proposal: jsonb("proposal").$type<ActionProposal>().notNull(),
    before: jsonb("before").$type<EventSnapshot | null>(),
    after: jsonb("after").$type<EventSnapshot | null>(),
    status: text("status", { enum: ACTION_STATUSES }).notNull().default("proposed"),
    error: text("error"),
    createdAt: createdAt(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("agent_actions_user_created_idx").on(t.userId, t.createdAt)],
);

/** Generated briefs, cached per day (daily) or per event (meeting). */
export const briefs = pgTable(
  "briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["daily", "meeting"] }).notNull(),
    refId: text("ref_id").notNull(),
    content: jsonb("content").$type<BriefContent>().notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("briefs_user_type_ref_uq").on(t.userId, t.type, t.refId)],
);

export const syncState = pgTable(
  "sync_state",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    calendarId: text("calendar_id").notNull().default("primary"),
    syncToken: text("sync_token"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.calendarId] })],
);

export type User = typeof users.$inferSelect;
export type GoogleAccount = typeof googleAccounts.$inferSelect;
export type LocalEvent = typeof localEvents.$inferSelect;
export type Preference = typeof preferences.$inferSelect;
export type AgentAction = typeof agentActions.$inferSelect;
