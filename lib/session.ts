import "server-only";
import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { getGoogleAccessToken } from "@/lib/auth/accounts";
import { SESSION_COOKIE, verifySessionToken, type SessionClaims } from "@/lib/auth/jwt";
import { getDb } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { LocalCalendar } from "@/lib/calendar/local";
import type { CalendarProvider } from "@/lib/calendar/provider";
import { GoogleCalendar } from "@/lib/google/calendar";

export type Session = { userId: string; user: User; calendar: CalendarProvider };

/** Session JWT from `Authorization: Bearer …` (API clients) or the httpOnly cookie (the web app). */
export async function readSessionClaims(): Promise<SessionClaims | null> {
  const bearer = (await headers()).get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer ?? (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}

/** The signed-in user plus their calendar (Google or Kairos). Throws AppError for API routes to render. */
export async function getSession(): Promise<Session> {
  const claims = await readSessionClaims();
  if (!claims) throw new AppError("unauthenticated", "Sign in to continue.", 401);

  const [user] = await getDb().select().from(users).where(eq(users.id, claims.sub));
  if (!user) throw new AppError("unauthenticated", "Sign in to continue.", 401);

  const calendar =
    user.calendarProvider === "google"
      ? GoogleCalendar.fromAccessToken(await getGoogleAccessToken(user.id))
      : new LocalCalendar(user);
  return { userId: user.id, user, calendar };
}
