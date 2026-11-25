import "server-only";
import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { GoogleCalendar } from "@/lib/google/calendar";
import { CALENDAR_SCOPES } from "@/lib/google/types";
import { isValidTimeZone } from "@/lib/time";

export type Session = { userId: string; user: User; gcal: GoogleCalendar };

/**
 * Clerk stores and refreshes the Google OAuth token. We fetch a fresh access
 * token per request and never persist it.
 */
async function getGoogleAccessToken(userId: string): Promise<string> {
  const client = await clerkClient();
  const res = await client.users.getUserOauthAccessToken(userId, "google").catch(() => null);
  const token = res?.data[0];
  if (!token?.token) {
    throw new AppError("google_not_connected", "Connect your Google account so Kairos can manage your calendar.", 403);
  }
  if (token.scopes?.length && !CALENDAR_SCOPES.every((s) => token.scopes!.includes(s))) {
    throw new AppError("google_reauth", "Kairos needs permission to read and edit your Google Calendar.", 403);
  }
  return token.token;
}

async function getOrCreateUser(userId: string, gcal: GoogleCalendar): Promise<User> {
  const db = getDb();
  const [existing] = await db.select().from(users).where(eq(users.id, userId));
  if (existing) return existing;

  const [profile, googleTz] = await Promise.all([currentUser(), gcal.getTimezone().catch(() => undefined)]);
  const timezone = googleTz && isValidTimeZone(googleTz) ? googleTz : "UTC";
  const [created] = await db
    .insert(users)
    .values({
      id: userId,
      email: profile?.primaryEmailAddress?.emailAddress ?? "",
      name: profile?.fullName ?? profile?.firstName ?? null,
      timezone,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [row] = await db.select().from(users).where(eq(users.id, userId));
  return row;
}

/** Authenticated user + Google Calendar client. Throws AppError for API routes to render. */
export async function getSession(): Promise<Session> {
  const { userId } = await auth();
  if (!userId) throw new AppError("unauthenticated", "Sign in to continue.", 401);
  const gcal = GoogleCalendar.fromAccessToken(await getGoogleAccessToken(userId));
  const user = await getOrCreateUser(userId, gcal);
  return { userId, user, gcal };
}
