import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/jwt";

/** POST /api/auth/logout — clears the session cookie. Google tokens stay stored so the next sign-in is one click. */
export async function POST() {
  const res = new NextResponse(null, { status: 204 });
  res.cookies.delete({ name: SESSION_COOKIE, path: "/" });
  return res;
}
