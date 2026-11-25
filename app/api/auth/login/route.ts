import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { findUserByEmail } from "@/lib/auth/accounts";
import { setSessionCookie } from "@/lib/auth/jwt";
import { verifyAgainstDummy, verifyPassword } from "@/lib/auth/password";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { AppError, route } from "@/lib/errors";

const bodySchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });

/** POST /api/auth/login — email + password sign-in. */
export const POST = route(async (req: Request) => {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new AppError("bad_request", "Enter your email and password.");
  const { email, password } = parsed.data;

  const user = await findUserByEmail(email);
  if (!user?.passwordHash) {
    await verifyAgainstDummy(password);
    if (user) throw new AppError("unauthenticated", "This account signs in with Google. Use Continue with Google.", 401);
    throw new AppError("unauthenticated", "Wrong email or password.", 401);
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    throw new AppError("unauthenticated", "Wrong email or password.", 401);
  }

  await getDb().update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  const res = NextResponse.json({ ok: true });
  await setSessionCookie(res, user);
  return res;
});
