import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { googleAccounts, users, type User } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { GoogleCalendar } from "@/lib/google/calendar";
import { isValidTimeZone } from "@/lib/time";
import { decrypt, encrypt } from "./crypto";
import { GoogleOAuthError, hasCalendarScopes, refreshAccessToken, type GoogleProfile, type GoogleTokenResponse } from "./google-oauth";

const EXPIRY_MARGIN_MS = 60_000;

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const [user] = await getDb().select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  return user;
}

function pickTimezone(...candidates: (string | undefined | null)[]): string {
  return candidates.find((tz): tz is string => !!tz && isValidTimeZone(tz)) ?? "UTC";
}

/** Email sign-up: a Kairos calendar account. Returns undefined if the email is already taken. */
export async function createPasswordUser(input: {
  email: string;
  name: string;
  passwordHash: string;
  timezone?: string;
}): Promise<User | undefined> {
  const [user] = await getDb()
    .insert(users)
    .values({
      email: input.email.trim().toLowerCase(),
      name: input.name,
      passwordHash: input.passwordHash,
      calendarProvider: "local",
      timezone: pickTimezone(input.timezone),
      lastLoginAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();
  return user;
}

/**
 * Finds or creates the Kairos user for a Google sign-in:
 * 1. the user already linked to this Google account;
 * 2. else the signed-in user (connecting Google from Settings), or an email
 *    account with the same Google-verified address, which gets linked;
 * 3. else a new user.
 * Granting calendar access switches the user to their Google Calendar;
 * otherwise they keep (or start on) a Kairos calendar.
 */
export async function resolveGoogleUser(
  profile: GoogleProfile,
  opts: { accessToken: string; calendarGranted: boolean; sessionUserId?: string; timezoneHint?: string },
): Promise<{ user: User; created: boolean }> {
  const db = getDb();
  const now = new Date();
  const provider = (current?: User["calendarProvider"]) => (opts.calendarGranted ? "google" : (current ?? "local"));

  const [linked] = await db.select().from(users).where(eq(users.googleSub, profile.sub));
  if (linked) {
    const [user] = await db
      .update(users)
      .set({
        name: linked.name ?? profile.name ?? null,
        picture: profile.picture ?? linked.picture,
        calendarProvider: provider(linked.calendarProvider),
        lastLoginAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, linked.id))
      .returning();
    return { user, created: false };
  }

  let target: User | undefined;
  if (opts.sessionUserId) {
    [target] = await db.select().from(users).where(and(eq(users.id, opts.sessionUserId), isNull(users.googleSub)));
  }
  if (!target && profile.emailVerified) {
    [target] = await db.select().from(users).where(and(eq(users.email, profile.email), isNull(users.googleSub)));
  }
  if (target) {
    const [user] = await db
      .update(users)
      .set({
        googleSub: profile.sub,
        name: target.name ?? profile.name ?? null,
        picture: profile.picture ?? target.picture,
        calendarProvider: provider(target.calendarProvider),
        lastLoginAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, target.id))
      .returning();
    return { user, created: false };
  }

  const googleTz = opts.calendarGranted
    ? await GoogleCalendar.fromAccessToken(opts.accessToken)
        .getTimezone()
        .catch(() => undefined)
    : undefined;
  const [user] = await db
    .insert(users)
    .values({
      email: profile.email,
      googleSub: profile.sub,
      name: profile.name ?? null,
      picture: profile.picture ?? null,
      calendarProvider: provider(),
      timezone: pickTimezone(googleTz, opts.timezoneHint),
      lastLoginAt: now,
    })
    .returning();
  return { user, created: true };
}

/**
 * Stores the tokens from a sign-in. Google only sends a refresh token on
 * explicit consent, so an existing one is kept when none comes back.
 * Returns whether a refresh token is on file afterwards.
 */
export async function saveGoogleTokens(userId: string, tokens: GoogleTokenResponse): Promise<boolean> {
  const db = getDb();
  const [existing] = await db.select().from(googleAccounts).where(eq(googleAccounts.userId, userId));
  const refreshToken = tokens.refresh_token ? encrypt(tokens.refresh_token) : (existing?.refreshToken ?? null);
  const values = {
    refreshToken,
    accessToken: encrypt(tokens.access_token),
    accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    scopes: tokens.scope,
    updatedAt: new Date(),
  };
  await db
    .insert(googleAccounts)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: googleAccounts.userId, set: values });
  return !!refreshToken;
}

/** A valid Google access token for the user, refreshing (and persisting) it when it's about to expire. */
export async function getGoogleAccessToken(userId: string): Promise<string> {
  const db = getDb();
  const [account] = await db.select().from(googleAccounts).where(eq(googleAccounts.userId, userId));
  const reconnect = () =>
    new AppError("google_reauth", "Your Google connection expired. Sign in with Google again to continue.", 403);

  if (!account?.refreshToken || !hasCalendarScopes(account.scopes)) throw reconnect();

  if (account.accessToken && account.accessTokenExpiresAt && account.accessTokenExpiresAt.getTime() - EXPIRY_MARGIN_MS > Date.now()) {
    try {
      return decrypt(account.accessToken);
    } catch {
      // Encrypted under an old AUTH_SECRET: fall through and refresh.
    }
  }

  let refreshToken: string;
  try {
    refreshToken = decrypt(account.refreshToken);
  } catch {
    throw reconnect();
  }

  let tokens: GoogleTokenResponse;
  try {
    tokens = await refreshAccessToken(refreshToken);
  } catch (err) {
    // invalid_grant: revoked access, or the 7-day expiry of refresh tokens while the OAuth app is in Testing mode.
    if (err instanceof GoogleOAuthError && err.code === "invalid_grant") {
      await db.update(googleAccounts).set({ refreshToken: null, accessToken: null, updatedAt: new Date() }).where(eq(googleAccounts.userId, userId));
      throw reconnect();
    }
    throw err;
  }

  await db
    .update(googleAccounts)
    .set({
      accessToken: encrypt(tokens.access_token),
      accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      ...(tokens.refresh_token ? { refreshToken: encrypt(tokens.refresh_token) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(googleAccounts.userId, userId));
  return tokens.access_token;
}
