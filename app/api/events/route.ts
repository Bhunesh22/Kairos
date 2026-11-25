import { after, type NextRequest } from "next/server";
import { AppError, route } from "@/lib/errors";
import { getSession } from "@/lib/session";
import { syncIfStale } from "@/lib/sync";
import { addDaysToLocalDate, LOCAL_DATE_RE, localDatesBetween, startOfLocalDay } from "@/lib/time";

/** GET /api/events?from=YYYY-MM-DD&to=YYYY-MM-DD — live events for local dates (inclusive). */
export const GET = route(async (req: NextRequest) => {
  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  if (!LOCAL_DATE_RE.test(from) || !LOCAL_DATE_RE.test(to) || to < from) {
    throw new AppError("bad_request", "Pass from and to as YYYY-MM-DD.");
  }
  if (localDatesBetween(from, to).length > 42) throw new AppError("bad_request", "Range is limited to 6 weeks.");

  const session = await getSession();
  const tz = session.user.timezone;
  const events = await session.calendar.listEvents({
    timeMin: startOfLocalDay(from, tz),
    timeMax: startOfLocalDay(addDaysToLocalDate(to, 1), tz),
    max: 1000,
  });

  // Keep contacts and the analytics mirror fresh without slowing this response.
  after(() => syncIfStale(session).catch((err) => console.warn("Background sync failed", err)));

  return Response.json({ timeZone: tz, events });
});
