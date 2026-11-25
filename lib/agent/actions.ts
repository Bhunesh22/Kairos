import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { agentActions, type ActionStatus, type AgentAction } from "@/lib/db/schema";
import { AppError, toAppError } from "@/lib/errors";
import type { CalEvent } from "@/lib/google/types";
import type { Session } from "@/lib/session";
import { formatRange } from "@/lib/time";
import type { ActionProposal, ActionState, EventSnapshot, ProposalToolOutput } from "./action-types";

/**
 * Human-in-the-loop execution. The agent can only *propose* calendar writes;
 * each proposal is a row here. Approval executes it against Google and stores
 * before/after snapshots so it can be undone.
 */

export async function createProposal(session: Session, proposal: ActionProposal, summary: string): Promise<ProposalToolOutput> {
  const [row] = await getDb()
    .insert(agentActions)
    .values({ userId: session.userId, kind: proposal.kind, summary, proposal })
    .returning({ id: agentActions.id });
  return { actionId: row.id, status: "awaiting_user_approval", summary, proposal };
}

/** Atomically moves an action between states, so double clicks can't execute twice. */
async function claim(userId: string, id: string, from: ActionStatus, to: ActionStatus): Promise<AgentAction> {
  const [row] = await getDb()
    .update(agentActions)
    .set({ status: to })
    .where(and(eq(agentActions.id, id), eq(agentActions.userId, userId), eq(agentActions.status, from)))
    .returning();
  if (row) return row;
  const existing = await findAction(userId, id);
  if (!existing) throw new AppError("not_found", "That action doesn't exist.", 404);
  throw new AppError("conflict", `This change is already ${existing.status}.`, 409);
}

async function findAction(userId: string, id: string): Promise<AgentAction | undefined> {
  const [row] = await getDb()
    .select()
    .from(agentActions)
    .where(and(eq(agentActions.id, id), eq(agentActions.userId, userId)));
  return row;
}

async function finish(id: string, values: Partial<AgentAction>): Promise<AgentAction> {
  const [row] = await getDb()
    .update(agentActions)
    .set({ ...values, resolvedAt: new Date() })
    .where(eq(agentActions.id, id))
    .returning();
  return row;
}

const othersOf = (e: CalEvent) => e.attendees.filter((a) => !a.self);

export async function approveAction(session: Session, id: string, opts: { optionIndex?: number } = {}): Promise<ActionState> {
  const row = await claim(session.userId, id, "proposed", "executing");
  const { gcal, user } = session;
  const p = row.proposal;
  try {
    let before: EventSnapshot | null = null;
    let after: EventSnapshot | null = null;
    let proposal = p;

    if (p.kind === "create_event") {
      const index = opts.optionIndex ?? 0;
      const option = p.options[index];
      if (!option) throw new AppError("bad_request", "Pick one of the proposed times.");
      after = await gcal.createEvent({
        title: p.title,
        description: p.description,
        location: p.location,
        start: new Date(option.start),
        end: new Date(option.end),
        attendees: p.attendees,
        addMeetLink: p.addMeetLink,
        timeZone: user.timezone,
      });
      proposal = { ...p, chosenOption: index };
    } else if (p.kind === "update_event") {
      before = await gcal.getEvent(p.eventId);
      const { changes } = p;
      let attendees: CalEvent["attendees"] | undefined;
      if (changes.addAttendees?.length || changes.removeAttendees?.length) {
        const remove = new Set(changes.removeAttendees?.map((e) => e.toLowerCase()));
        const kept = before.attendees.filter((a) => !remove.has(a.email.toLowerCase()));
        const known = new Set(kept.map((a) => a.email.toLowerCase()));
        const added = (changes.addAttendees ?? []).filter((e) => !known.has(e.toLowerCase())).map((email) => ({ email }));
        attendees = [...kept, ...added];
      }
      const notify = othersOf(before).length > 0 || !!changes.addAttendees?.length;
      after = await gcal.patchEvent(
        p.eventId,
        {
          title: changes.title,
          description: changes.description,
          location: changes.location,
          start: changes.start ? new Date(changes.start) : undefined,
          end: changes.end ? new Date(changes.end) : undefined,
          attendees,
          timeZone: user.timezone,
        },
        notify,
      );
    } else {
      before = await gcal.getEvent(p.eventId);
      await gcal.deleteEvent(p.eventId, othersOf(before).length > 0 && !!before.organizerSelf);
    }

    return toState(await finish(id, { status: "executed", before, after, proposal, error: null }), user.timezone);
  } catch (err) {
    const e = toAppError(err);
    await finish(id, { status: "failed", error: e.message });
    throw e;
  }
}

export async function rejectAction(session: Session, id: string): Promise<ActionState> {
  await claim(session.userId, id, "proposed", "executing");
  return toState(await finish(id, { status: "rejected" }), session.user.timezone);
}

export async function undoAction(session: Session, id: string): Promise<ActionState> {
  const row = await claim(session.userId, id, "executed", "undoing");
  const { gcal, user } = session;
  const { before, after } = row;
  try {
    if (row.kind === "create_event" && after) {
      await gcal.deleteEvent(after.id, othersOf(after).length > 0);
    } else if (row.kind === "update_event" && before) {
      const attendeesChanged =
        after && after.attendees.map((a) => a.email).join() !== before.attendees.map((a) => a.email).join();
      await gcal.patchEvent(
        before.id,
        {
          title: before.title,
          description: before.description ?? "",
          location: before.location ?? "",
          start: new Date(before.start),
          end: new Date(before.end),
          attendees: attendeesChanged ? before.attendees : undefined,
          timeZone: user.timezone,
        },
        othersOf(before).length > 0,
      );
    } else if (row.kind === "delete_event" && before) {
      // Google can't restore a deleted event; recreate it (attendees get a fresh invite).
      const recreated = await gcal.createEvent({
        title: before.title,
        description: before.description,
        location: before.location,
        start: new Date(before.start),
        end: new Date(before.end),
        attendees: othersOf(before).map((a) => a.email),
        addMeetLink: !!before.meetLink,
        timeZone: user.timezone,
      });
      return toState(await finish(id, { status: "undone", after: recreated, error: null }), user.timezone);
    }
    return toState(await finish(id, { status: "undone", error: null }), user.timezone);
  } catch (err) {
    const e = toAppError(err);
    await finish(id, { status: "executed", error: `Undo failed: ${e.message}` });
    throw e;
  }
}

export async function getActionState(session: Session, id: string): Promise<ActionState> {
  const row = await findAction(session.userId, id);
  if (!row) throw new AppError("not_found", "That action doesn't exist.", 404);
  return toState(row, session.user.timezone);
}

/** Most recent executed action, for "undo that". */
export async function lastExecutedAction(userId: string): Promise<AgentAction | undefined> {
  const [row] = await getDb()
    .select()
    .from(agentActions)
    .where(and(eq(agentActions.userId, userId), eq(agentActions.status, "executed")))
    .orderBy(desc(agentActions.resolvedAt))
    .limit(1);
  return row;
}

/** Recently resolved actions, so the agent knows what the user approved or rejected. */
export async function recentResolvedActions(userId: string, limit = 6): Promise<AgentAction[]> {
  return getDb()
    .select()
    .from(agentActions)
    .where(and(eq(agentActions.userId, userId), inArray(agentActions.status, ["executed", "rejected", "undone", "failed"])))
    .orderBy(desc(agentActions.resolvedAt))
    .limit(limit);
}

export function toState(row: AgentAction, timeZone: string): ActionState {
  let resultLabel: string | undefined;
  const p = row.proposal;
  if (row.status === "executed" || row.status === "undone") {
    if (p.kind === "create_event" && p.chosenOption !== undefined) resultLabel = p.options[p.chosenOption]?.label;
    if (p.kind === "update_event") resultLabel = p.newLabel ?? p.currentLabel;
    if (p.kind === "delete_event" && row.after) {
      resultLabel = formatRange(new Date(row.after.start), new Date(row.after.end), timeZone);
    }
  }
  return {
    id: row.id,
    status: row.status,
    summary: row.summary,
    error: row.error,
    eventLink: row.after?.htmlLink,
    resultLabel,
  };
}
