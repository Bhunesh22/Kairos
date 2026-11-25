import "server-only";
import { NextResponse, type NextRequest } from "next/server";

/** Short-lived cookie that carries CSRF state and the PKCE verifier across the Google redirect. */
export const OAUTH_COOKIE = "kairos_oauth";

export type OAuthState = {
  state: string;
  verifier: string;
  returnTo: string;
  forcedConsent: boolean;
  /** Browser time zone, used for new accounts that don't share their Google Calendar. */
  tz?: string;
};

export const oauthCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/api/auth",
  maxAge: 600,
};

export function readOAuthState(req: NextRequest): OAuthState | null {
  const raw = req.cookies.get(OAUTH_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as OAuthState;
    return parsed.state && parsed.verifier ? parsed : null;
  } catch {
    return null;
  }
}

export type SignInError = "denied" | "state" | "no_refresh_token" | "config" | "failed";

/** Sends the browser back to the sign-in page with a reason the page can explain. */
export function signInRedirect(req: NextRequest, error: SignInError, returnTo?: string): NextResponse {
  const url = new URL("/sign-in", req.nextUrl.origin);
  url.searchParams.set("error", error);
  if (returnTo) url.searchParams.set("returnTo", returnTo);
  const res = NextResponse.redirect(url);
  res.cookies.delete({ name: OAUTH_COOKIE, path: oauthCookieOptions.path });
  return res;
}
