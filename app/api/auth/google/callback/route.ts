import { NextResponse, type NextRequest } from "next/server";
import { resolveGoogleUser, saveGoogleTokens } from "@/lib/auth/accounts";
import { exchangeCode, GoogleOAuthError, hasCalendarScopes, redirectUri, verifyIdToken } from "@/lib/auth/google-oauth";
import { SESSION_COOKIE, setSessionCookie, verifySessionToken } from "@/lib/auth/jwt";
import { OAUTH_COOKIE, oauthCookieOptions, readOAuthState, signInRedirect } from "@/lib/auth/oauth-state";
import { LocalCalendar } from "@/lib/calendar/local";

/**
 * GET /api/auth/google/callback — Google redirects here after consent.
 * Verifies state, exchanges the code (with PKCE), verifies the ID token, finds
 * or creates the user in Neon, stores encrypted tokens and issues the session JWT.
 * With calendar access the user gets their Google Calendar; without it, a Kairos calendar.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const saved = readOAuthState(req);

  if (params.get("error")) return signInRedirect(req, params.get("error") === "access_denied" ? "denied" : "failed", saved?.returnTo);
  const code = params.get("code");
  if (!saved || !code || params.get("state") !== saved.state) return signInRedirect(req, "state");

  try {
    const tokens = await exchangeCode(code, saved.verifier, redirectUri(req.nextUrl.origin));
    if (!tokens.id_token) return signInRedirect(req, "failed", saved.returnTo);
    const calendarGranted = hasCalendarScopes(tokens.scope);

    const profile = await verifyIdToken(tokens.id_token);
    const current = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
    const { user, created } = await resolveGoogleUser(profile, {
      accessToken: tokens.access_token,
      calendarGranted,
      sessionUserId: current?.sub,
      timezoneHint: saved.tz,
    });
    const hasRefreshToken = await saveGoogleTokens(user.id, tokens);

    if (calendarGranted && !hasRefreshToken) {
      // Returning user whose stored refresh token is gone: ask Google once more, with explicit consent.
      if (saved.forcedConsent) return signInRedirect(req, "no_refresh_token", saved.returnTo);
      const retry = new URL("/api/auth/google", req.nextUrl.origin);
      retry.searchParams.set("prompt", "consent");
      retry.searchParams.set("returnTo", saved.returnTo);
      return NextResponse.redirect(retry);
    }

    if (created && user.calendarProvider === "local") await new LocalCalendar(user).seedSampleEvents();

    const res = NextResponse.redirect(new URL(saved.returnTo, req.nextUrl.origin));
    await setSessionCookie(res, user);
    res.cookies.delete({ name: OAUTH_COOKIE, path: oauthCookieOptions.path });
    return res;
  } catch (err) {
    console.error("Google sign-in failed", err);
    const config = err instanceof GoogleOAuthError && err.code === "config";
    return signInRedirect(req, config ? "config" : "failed", saved.returnTo);
  }
}
