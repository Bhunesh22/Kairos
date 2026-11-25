import type { NextRequest } from "next/server";
import { getDailyBrief } from "@/lib/brief";
import { route } from "@/lib/errors";
import { getSession } from "@/lib/session";

export const maxDuration = 30;

/** GET /api/brief[?refresh=1] — today's brief, cached until the day's events change. */
export const GET = route(async (req: NextRequest) => {
  const session = await getSession();
  const brief = await getDailyBrief(session, { refresh: req.nextUrl.searchParams.get("refresh") === "1" });
  return Response.json(brief);
});
