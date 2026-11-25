import { eq } from "drizzle-orm";
import { z } from "zod";
import type { MeResponse } from "@/lib/api-types";
import { getDb } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";
import { AppError, route } from "@/lib/errors";
import { workingHoursSchema } from "@/lib/scheduling/rules";
import { getSession } from "@/lib/session";
import { isValidTimeZone } from "@/lib/time";

const toMe = ({ name, email, picture, calendarProvider, googleSub, timezone, workingHours, goals }: User): MeResponse => ({
  name,
  email,
  picture,
  calendarProvider,
  googleLinked: !!googleSub,
  timezone,
  workingHours,
  goals,
});

export const GET = route(async () => {
  const { user } = await getSession();
  return Response.json(toMe(user));
});

const patchSchema = z.object({
  timezone: z.string().refine(isValidTimeZone, "Unknown time zone").optional(),
  workingHours: workingHoursSchema.optional(),
  goals: z
    .object({
      maxMeetingHoursPerWeek: z.number().min(0).max(80),
      focusHoursPerDay: z.number().min(0).max(8),
    })
    .optional(),
});

export const PATCH = route(async (req: Request) => {
  const { userId } = await getSession();
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) throw new AppError("bad_request", parsed.error.issues[0].message);
  const [row] = await getDb()
    .update(users)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  return Response.json(toMe(row));
});
