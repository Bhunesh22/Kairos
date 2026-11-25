import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { preferences } from "@/lib/db/schema";
import { AppError, route } from "@/lib/errors";
import { toPreferenceDTO } from "@/lib/preferences";
import { getSession } from "@/lib/session";

async function owned(ctx: RouteContext<"/api/preferences/[id]">) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) throw new AppError("not_found", "Rule not found.", 404);
  const { userId } = await getSession();
  return and(eq(preferences.id, id), eq(preferences.userId, userId));
}

/** PATCH { active } — pause or resume a rule. */
export const PATCH = route(async (req: Request, ctx: RouteContext<"/api/preferences/[id]">) => {
  const where = await owned(ctx);
  const parsed = z.object({ active: z.boolean() }).safeParse(await req.json());
  if (!parsed.success) throw new AppError("bad_request", "Invalid request.");
  const [row] = await getDb().update(preferences).set({ active: parsed.data.active }).where(where).returning();
  if (!row) throw new AppError("not_found", "Rule not found.", 404);
  return Response.json(toPreferenceDTO(row));
});

export const DELETE = route(async (_req: Request, ctx: RouteContext<"/api/preferences/[id]">) => {
  const where = await owned(ctx);
  const [row] = await getDb().delete(preferences).where(where).returning({ id: preferences.id });
  if (!row) throw new AppError("not_found", "Rule not found.", 404);
  return new Response(null, { status: 204 });
});
