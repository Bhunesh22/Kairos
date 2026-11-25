import { NextResponse } from "next/server";
import { z } from "zod";
import { createPasswordUser, findUserByEmail } from "@/lib/auth/accounts";
import { setSessionCookie } from "@/lib/auth/jwt";
import { hashPassword } from "@/lib/auth/password";
import { LocalCalendar } from "@/lib/calendar/local";
import { AppError, route } from "@/lib/errors";

const bodySchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email."),
  password: z.string().min(8, "Use at least 8 characters for your password.").max(200),
  timeZone: z.string().max(64).optional(),
  sampleData: z.boolean().default(true),
});

/** POST /api/auth/signup — email account with a Kairos calendar (no Google needed). */
export const POST = route(async (req: Request) => {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new AppError("bad_request", parsed.error.issues[0].message);
  const { name, email, password, timeZone, sampleData } = parsed.data;

  const existing = await findUserByEmail(email);
  if (existing) {
    throw new AppError(
      "conflict",
      existing.passwordHash ? "An account with this email already exists. Sign in instead." : "This email signs in with Google. Use Continue with Google.",
      409,
    );
  }

  const user = await createPasswordUser({ email, name, passwordHash: await hashPassword(password), timezone: timeZone });
  if (!user) throw new AppError("conflict", "An account with this email already exists. Sign in instead.", 409);
  if (sampleData) await new LocalCalendar(user).seedSampleEvents();

  const res = NextResponse.json({ ok: true }, { status: 201 });
  await setSessionCookie(res, user);
  return res;
});
