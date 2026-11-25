import { z } from "zod";
import { approveAction, getActionState, rejectAction, undoAction } from "@/lib/agent/actions";
import { AppError, route } from "@/lib/errors";
import { getSession } from "@/lib/session";

export const GET = route(async (_req: Request, ctx: RouteContext<"/api/actions/[id]">) => {
  const { id } = await ctx.params;
  return Response.json(await getActionState(await getSession(), id));
});

const bodySchema = z.object({
  op: z.enum(["approve", "reject", "undo"]),
  optionIndex: z.number().int().min(0).max(2).optional(),
});

/** POST { op: "approve" | "reject" | "undo", optionIndex? } */
export const POST = route(async (req: Request, ctx: RouteContext<"/api/actions/[id]">) => {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) throw new AppError("not_found", "That action doesn't exist.", 404);
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) throw new AppError("bad_request", "Invalid request.");

  const session = await getSession();
  const { op, optionIndex } = parsed.data;
  const state =
    op === "approve"
      ? await approveAction(session, id, { optionIndex })
      : op === "reject"
        ? await rejectAction(session, id)
        : await undoAction(session, id);
  return Response.json(state);
});
