import { jwtVerify, SignJWT } from "jose";

/**
 * Session = a short HS256 JWT in an httpOnly cookie. It carries only the user id
 * and email; everything else is loaded from Neon per request. No "server-only"
 * import because proxy.ts uses it too.
 */

export const SESSION_COOKIE = "kairos_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const ISSUER = "kairos";
const AUDIENCE = "kairos-app";

export type SessionClaims = { sub: string; email: string };

function signingKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be set to a random string of at least 32 characters (openssl rand -base64 32).");
  }
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(signingKey());
}

/** Returns the claims for a valid, unexpired token, otherwise null. Throws only if AUTH_SECRET is missing. */
export async function verifySessionToken(token: string | undefined | null): Promise<SessionClaims | null> {
  if (!token) return null;
  const key = signingKey();
  try {
    const { payload } = await jwtVerify(token, key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    return { sub: payload.sub, email: typeof payload.email === "string" ? payload.email : "" };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  // Lax: sent on top-level navigation (the OAuth redirect back) but not on cross-site POSTs, which blocks CSRF.
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};

/** Signs a session for `user` and sets it on the response (sign-in, sign-up, OAuth callback). */
export async function setSessionCookie(
  res: { cookies: { set: (name: string, value: string, options: typeof sessionCookieOptions) => unknown } },
  user: { id: string; email: string },
): Promise<void> {
  res.cookies.set(SESSION_COOKIE, await signSessionToken({ sub: user.id, email: user.email }), sessionCookieOptions);
}
