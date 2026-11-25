import "server-only";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { CALENDAR_SCOPES } from "@/lib/google/types";

/**
 * Google OAuth 2.0 authorization-code flow with PKCE. One consent screen asks
 * for identity and calendar access together; we keep a refresh token so the
 * user signs in once and Kairos can keep working with their calendar.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export const GOOGLE_SCOPES = ["openid", "email", "profile", ...CALENDAR_SCOPES];

export class GoogleOAuthError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "GoogleOAuthError";
  }
}

function clientCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new GoogleOAuthError("config", "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set.");
  }
  return { clientId, clientSecret };
}

/** Must exactly match an "Authorized redirect URI" on the Google OAuth client. */
export function redirectUri(requestOrigin: string): string {
  return new URL("/api/auth/google/callback", process.env.APP_URL || requestOrigin).toString();
}

export function buildAuthUrl(opts: { state: string; codeChallenge: string; redirectUri: string; forceConsent: boolean }): string {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: clientCredentials().clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    // Consent is only forced when we still need a refresh token; otherwise returning users just pick an account.
    prompt: opts.forceConsent ? "consent" : "select_account",
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
  token_type: string;
};

async function tokenRequest(params: Record<string, string>): Promise<GoogleTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<GoogleTokenResponse> & { error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new GoogleOAuthError(body.error ?? "token_request_failed", body.error_description ?? `Google token request failed (${res.status})`);
  }
  return body as GoogleTokenResponse;
}

export function exchangeCode(code: string, codeVerifier: string, redirect: string): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = clientCredentials();
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirect,
    client_id: clientId,
    client_secret: clientSecret,
  });
}

export function refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = clientCredentials();
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret });
}

export type GoogleProfile = { sub: string; email: string; emailVerified: boolean; name?: string; picture?: string };

/** Verifies the ID token's signature, issuer, audience and expiry against Google's keys. */
export async function verifyIdToken(idToken: string): Promise<GoogleProfile> {
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: clientCredentials().clientId,
  });
  if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
    throw new GoogleOAuthError("invalid_id_token", "Google didn't return an account id and email.");
  }
  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === "string" ? payload.name : undefined,
    picture: typeof payload.picture === "string" ? payload.picture : undefined,
  };
}

/** With granular consent users can untick calendar access; we need both scopes. */
export function hasCalendarScopes(grantedScope: string): boolean {
  const granted = new Set(grantedScope.split(/\s+/));
  return CALENDAR_SCOPES.every((s) => granted.has(s));
}
