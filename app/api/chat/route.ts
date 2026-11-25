import { convertToModelMessages, createUIMessageStreamResponse, isStepCount, streamText, toUIMessageStream, type UIMessage } from "ai";
import { and, asc, eq } from "drizzle-orm";
import { recentResolvedActions } from "@/lib/agent/actions";
import { getModel } from "@/lib/agent/model";
import { buildInstructions } from "@/lib/agent/prompt";
import { createTools } from "@/lib/agent/tools";
import { getDb } from "@/lib/db";
import { preferences } from "@/lib/db/schema";
import { route, toAppError } from "@/lib/errors";
import { getSession } from "@/lib/session";

export const maxDuration = 60;

const MAX_HISTORY = 30;

/** Keep the tail of the conversation, starting on a user turn. */
function trimHistory(messages: UIMessage[]): UIMessage[] {
  if (messages.length <= MAX_HISTORY) return messages;
  const tail = messages.slice(-MAX_HISTORY);
  const firstUser = tail.findIndex((m) => m.role === "user");
  return firstUser > 0 ? tail.slice(firstUser) : tail;
}

export const POST = route(async (req: Request) => {
  const session = await getSession();
  const { messages }: { messages: UIMessage[] } = await req.json();

  const [rules, recentActions] = await Promise.all([
    getDb()
      .select()
      .from(preferences)
      .where(and(eq(preferences.userId, session.userId), eq(preferences.active, true)))
      .orderBy(asc(preferences.createdAt)),
    recentResolvedActions(session.userId),
  ]);

  const tools = createTools(
    session,
    rules.map((r) => r.rule),
  );

  const result = streamText({
    model: getModel(),
    instructions: buildInstructions({ user: session.user, rules, recentActions }),
    messages: await convertToModelMessages(trimHistory(messages)),
    tools,
    stopWhen: isStepCount(8),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      tools,
      originalMessages: messages,
      onError: (err) => toAppError(err).message,
    }),
  });
});
