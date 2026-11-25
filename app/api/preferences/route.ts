import { generateText, Output } from "ai";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getModel } from "@/lib/agent/model";
import { getDb } from "@/lib/db";
import { preferences } from "@/lib/db/schema";
import { AppError, route } from "@/lib/errors";
import { toPreferenceDTO } from "@/lib/preferences";
import { flatRuleSchema, normalizeRule, type Rule } from "@/lib/scheduling/rules";
import { getSession } from "@/lib/session";

export const GET = route(async () => {
  const { userId } = await getSession();
  const rows = await getDb().select().from(preferences).where(eq(preferences.userId, userId)).orderBy(asc(preferences.createdAt));
  return Response.json(rows.map(toPreferenceDTO));
});

/** POST { text } — parse a preference written in plain English into a rule. */
export const POST = route(async (req: Request) => {
  const { userId } = await getSession();
  const parsed = z.object({ text: z.string().trim().min(3).max(200) }).safeParse(await req.json());
  if (!parsed.success) throw new AppError("bad_request", "Describe the preference in a few words.");
  const { text } = parsed.data;

  let rule: Rule;
  try {
    const { output } = await generateText({
      model: getModel(),
      output: Output.object({ schema: flatRuleSchema }),
      instructions:
        "Convert the user's scheduling preference into one structured rule. Times are 24h HH:mm. " +
        "Use 'note' if it doesn't fit any structured type.",
      prompt: text,
    });
    rule = normalizeRule(output);
  } catch {
    // Unparseable or invalid: keep it as free-form guidance for the agent.
    rule = { type: "note" };
  }

  const [row] = await getDb().insert(preferences).values({ userId, ruleText: text, rule }).returning();
  return Response.json(toPreferenceDTO(row), { status: 201 });
});
