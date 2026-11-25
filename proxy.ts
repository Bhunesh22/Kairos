import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/jwt";

const PUBLIC_PAGES = new Set(["/", "/sign-in"]);

/**
 * Page-level gate. API routes aren't matched: each handler verifies the JWT
 * itself (getSession) and answers with a JSON 401 instead of a redirect.
 */
export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === "/sign-in" && session) {
    return NextResponse.redirect(new URL("/calendar", req.url));
  }
  if (!PUBLIC_PAGES.has(pathname) && !session) {
    const url = new URL("/sign-in", req.url);
    url.searchParams.set("returnTo", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except API routes, Next.js internals and files with an extension.
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
