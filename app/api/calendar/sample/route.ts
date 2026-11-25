import { LocalCalendar } from "@/lib/calendar/local";
import { route } from "@/lib/errors";
import { getSession } from "@/lib/session";

/** GET → { count } of seeded sample events on a Kairos calendar. */
export const GET = route(async () => {
  const { calendar } = await getSession();
  return Response.json({ count: calendar instanceof LocalCalendar ? await calendar.countSampleEvents() : 0 });
});

/** DELETE → removes the seeded sample events, keeping the user's own. */
export const DELETE = route(async () => {
  const { calendar } = await getSession();
  return Response.json({ deleted: calendar instanceof LocalCalendar ? await calendar.deleteSampleEvents() : 0 });
});
