import { NextResponse, type NextRequest } from "next/server";
import { randomToken, sha256Base64Url } from "@/lib/auth/crypto";
import { buildAuthUrl, GoogleOAuthError, redirectUri } from "@/lib/auth/google-oauth";
import { OAUTH_COOKIE, oauthCookieOptions, signInRedirect, type OAuthState } from "@/lib/auth/oauth-state";
import { safeReturnTo } from "@/lib/auth/return-to";
import { isValidTimeZone } from "@/lib/time";

/** GET /api/auth/google[?returnTo=/calendar][&prompt=consent][&tz=Asia/Kolkata] — starts Google sign-in. */
export async function GET(req: NextRequest) {
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get("returnTo"));
  const forceConsent = req.nextUrl.searchParams.get("prompt") === "consent";
  const tz = req.nextUrl.searchParams.get("tz") ?? undefined;
  const oauth: OAuthState = {
    state: randomToken(16),
    verifier: randomToken(32),
    returnTo,
    forcedConsent: forceConsent,
    tz: tz && isValidTimeZone(tz) ? tz : undefined,
  };

  let url: string;
  try {
    url = buildAuthUrl({
      state: oauth.state,
      codeChallenge: sha256Base64Url(oauth.verifier),
      redirectUri: redirectUri(req.nextUrl.origin),
      forceConsent,
    });
  } catch (err) {
    if (err instanceof GoogleOAuthError && err.code === "config") return signInRedirect(req, "config", returnTo);
    throw err;
  }

  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_COOKIE, JSON.stringify(oauth), oauthCookieOptions);
  return res;
}
