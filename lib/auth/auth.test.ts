import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt, sha256Base64Url } from "./crypto";
import { buildAuthUrl, hasCalendarScopes, redirectUri } from "./google-oauth";
import { signSessionToken, verifySessionToken } from "./jwt";
import { safeReturnTo } from "./return-to";

const SECRET = "test-secret-test-secret-test-secret-123";

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-123.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "shh");
  vi.stubEnv("APP_URL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("session JWT", () => {
  it("round-trips the user id and email", async () => {
    const token = await signSessionToken({ sub: "user_1", email: "me@acme.com" });
    expect(await verifySessionToken(token)).toEqual({ sub: "user_1", email: "me@acme.com" });
  });

  it("rejects tampered, foreign-key, expired and missing tokens", async () => {
    const token = await signSessionToken({ sub: "user_1", email: "me@acme.com" });
    const [h, p, s] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), sub: "admin" })).toString("base64url");
    expect(await verifySessionToken(`${h}.${forgedPayload}.${s}`)).toBeNull();

    const otherKey = await new SignJWT({ email: "x" }).setProtectedHeader({ alg: "HS256" }).setSubject("user_1")
      .setIssuer("kairos").setAudience("kairos-app").setExpirationTime("1h").sign(new TextEncoder().encode("another-secret-another-secret-123456"));
    expect(await verifySessionToken(otherKey)).toBeNull();

    const expired = await new SignJWT({ email: "x" }).setProtectedHeader({ alg: "HS256" }).setSubject("user_1")
      .setIssuer("kairos").setAudience("kairos-app").setExpirationTime(Math.floor(Date.now() / 1000) - 10).sign(new TextEncoder().encode(SECRET));
    expect(await verifySessionToken(expired)).toBeNull();

    expect(await verifySessionToken(undefined)).toBeNull();
    expect(await verifySessionToken("not-a-jwt")).toBeNull();
  });

  it("fails loudly when AUTH_SECRET is missing or weak", async () => {
    vi.stubEnv("AUTH_SECRET", "short");
    await expect(signSessionToken({ sub: "u", email: "e" })).rejects.toThrow(/AUTH_SECRET/);
  });
});

describe("token encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encrypt("ya29.refresh-token");
    expect(decrypt(a)).toBe("ya29.refresh-token");
    expect(encrypt("ya29.refresh-token")).not.toBe(a);
  });

  it("detects tampering and a rotated secret", () => {
    const enc = encrypt("token");
    const parts = enc.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
    vi.stubEnv("AUTH_SECRET", "a-completely-different-secret-value-xyz");
    expect(() => decrypt(enc)).toThrow();
  });
});

describe("Google OAuth URL", () => {
  it("asks for identity + calendar scopes, offline access and PKCE in one step", () => {
    const url = new URL(
      buildAuthUrl({ state: "st", codeChallenge: sha256Base64Url("verifier"), redirectUri: redirectUri("http://localhost:3000"), forceConsent: false }),
    );
    const q = url.searchParams;
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(q.get("scope")?.split(" ")).toEqual([
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.readonly",
    ]);
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("prompt")).toBe("select_account");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("redirect_uri")).toBe("http://localhost:3000/api/auth/google/callback");
  });

  it("forces the consent screen only when asked, and honours APP_URL", () => {
    vi.stubEnv("APP_URL", "https://kairos.example.com");
    const q = new URL(buildAuthUrl({ state: "s", codeChallenge: "c", redirectUri: redirectUri("http://ignored"), forceConsent: true })).searchParams;
    expect(q.get("prompt")).toBe("consent");
    expect(q.get("redirect_uri")).toBe("https://kairos.example.com/api/auth/google/callback");
  });

  it("requires both calendar scopes to be granted", () => {
    const base = "openid https://www.googleapis.com/auth/userinfo.email";
    expect(hasCalendarScopes(base)).toBe(false);
    expect(hasCalendarScopes(`${base} https://www.googleapis.com/auth/calendar.events`)).toBe(false);
    expect(
      hasCalendarScopes(`${base} https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly`),
    ).toBe(true);
  });
});

describe("safeReturnTo", () => {
  it("allows in-app paths and blocks open redirects", () => {
    expect(safeReturnTo("/settings")).toBe("/settings");
    expect(safeReturnTo("/calendar?week=2")).toBe("/calendar?week=2");
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "/api/auth/logout", "/sign-in", null, ""]) {
      expect(safeReturnTo(bad)).toBe("/calendar");
    }
  });
});
