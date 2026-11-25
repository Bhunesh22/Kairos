"use client";

import { AlertTriangle, ArrowRight, CalendarClock, CalendarPlus, CalendarX2, Check, ExternalLink, Loader2, Undo2, Users, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ActionState, ProposalToolOutput } from "@/lib/agent/action-types";
import { useMe } from "@/hooks/use-calendar-data";
import { fetchJson } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { useAgent } from "./agent-provider";

type Op = "approve" | "reject" | "undo";

const STATUS_BADGE: Partial<Record<ActionState["status"], { label: string; className: string }>> = {
  executed: { label: "Done", className: "bg-success/15 text-success" },
  rejected: { label: "Dismissed", className: "bg-muted text-muted-foreground" },
  undone: { label: "Undone", className: "bg-muted text-muted-foreground" },
  failed: { label: "Failed", className: "bg-destructive/10 text-destructive" },
};

/** Shared action plumbing for approval and undo cards. */
function useAction(actionId: string, initial: ActionState["status"] = "proposed") {
  const { refreshCalendar } = useAgent();
  const [state, setState] = useState<ActionState | null>(null);
  const [pending, setPending] = useState<Op | null>(null);

  // Pick up the stored status, e.g. if the card re-mounts after the user acted on it.
  useEffect(() => {
    let cancelled = false;
    fetchJson<ActionState>(`/api/actions/${actionId}`)
      .then((s) => !cancelled && setState(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [actionId]);

  async function run(op: Op, body: Record<string, unknown> = {}) {
    setPending(op);
    try {
      const next = await fetchJson<ActionState>(`/api/actions/${actionId}`, {
        method: "POST",
        body: JSON.stringify({ op, ...body }),
      });
      setState(next);
      if (op !== "reject") refreshCalendar();
      if (op === "approve") toast.success("Done. Your calendar is updated.");
      if (op === "undo") toast.success("Undone.");
      if (next.error) toast.warning(next.error);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That didn't work.");
      fetchJson<ActionState>(`/api/actions/${actionId}`).then(setState).catch(() => {});
    } finally {
      setPending(null);
    }
  }

  return { state, status: state?.status ?? initial, pending, run };
}

export function ApprovalCard({ data }: { data: ProposalToolOutput }) {
  const p = data.proposal;
  const { state, status, pending, run } = useAction(data.actionId);
  const { data: me } = useMe();
  const sendsInvites = me?.calendarProvider !== "local";
  const [choice, setChoice] = useState(0);
  const isOpen = status === "proposed";
  const badge = STATUS_BADGE[status];

  const Icon = p.kind === "create_event" ? CalendarPlus : p.kind === "update_event" ? CalendarClock : CalendarX2;
  const approveLabel =
    p.kind === "create_event"
      ? p.attendees.length && sendsInvites
        ? "Book & send invites"
        : "Add to calendar"
      : p.kind === "update_event"
        ? "Apply change"
        : "Cancel event";

  return (
    <div className="overflow-hidden rounded-xl border bg-card text-sm shadow-xs">
      <div className="flex items-start gap-3 border-b px-3 py-2.5">
        <Icon className="mt-0.5 size-4 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{data.summary}</p>
          {p.reason && <p className="text-xs text-muted-foreground">{p.reason}</p>}
        </div>
        {badge ? (
          <Badge className={cn("shrink-0", badge.className)}>{badge.label}</Badge>
        ) : (
          <Badge variant="outline" className="shrink-0">
            Needs approval
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-3 px-3 py-3">
        {p.kind === "create_event" && (
          <>
            {(p.attendees.length > 0 || p.addMeetLink) && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {p.attendees.length > 0 && <Users className="size-3.5 text-muted-foreground" />}
                {p.attendees.map((a) => (
                  <span key={a} className="rounded-full bg-muted px-2 py-0.5">
                    {a}
                  </span>
                ))}
                {p.addMeetLink && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
                    <Video className="size-3" /> Video call
                  </span>
                )}
              </div>
            )}
            <div role="radiogroup" aria-label="Time options" className="flex flex-col gap-1.5">
              {p.options.map((o, i) => {
                const chosen = isOpen ? choice === i : p.chosenOption === i || (state?.resultLabel === o.label);
                if (!isOpen && !chosen && status !== "rejected") return null;
                return (
                  <button
                    key={o.start}
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    disabled={!isOpen}
                    onClick={() => setChoice(i)}
                    className={cn(
                      "flex flex-col rounded-lg border px-3 py-2 text-left transition disabled:cursor-default",
                      chosen ? "border-brand bg-brand/5 ring-1 ring-brand" : "hover:bg-muted/60",
                    )}
                  >
                    <span className="font-medium tabular-nums">{o.label}</span>
                    {o.reason && <span className="text-xs text-muted-foreground">{o.reason}</span>}
                  </button>
                );
              })}
            </div>
            {p.description && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none">Agenda</summary>
                <p className="mt-1 whitespace-pre-wrap">{p.description}</p>
              </details>
            )}
          </>
        )}

        {p.kind === "update_event" && (
          <div className="flex flex-col gap-1.5">
            {p.newLabel ? (
              <div className="flex flex-wrap items-center gap-2 tabular-nums">
                <span className="text-muted-foreground line-through">{p.currentLabel}</span>
                <ArrowRight className="size-3.5 text-muted-foreground" />
                <span className="font-medium">{p.newLabel}</span>
              </div>
            ) : (
              <span className="text-muted-foreground tabular-nums">{p.currentLabel}</span>
            )}
            <ul className="text-xs text-muted-foreground">
              {p.changes.title && <li>Rename to “{p.changes.title}”</li>}
              {p.changes.description !== undefined && <li>Update the agenda</li>}
              {p.changes.location !== undefined && <li>Location: {p.changes.location || "none"}</li>}
              {p.changes.addAttendees?.length ? <li>Invite {p.changes.addAttendees.join(", ")}</li> : null}
              {p.changes.removeAttendees?.length ? <li>Remove {p.changes.removeAttendees.join(", ")}</li> : null}
            </ul>
          </div>
        )}

        {p.kind === "delete_event" && (
          <p className="tabular-nums">
            <span className="font-medium">{p.eventTitle}</span> <span className="text-muted-foreground">· {p.currentLabel}</span>
          </p>
        )}

        {isOpen && p.warnings?.length ? (
          <ul className="flex flex-col gap-1 rounded-lg bg-warning/10 px-2.5 py-2 text-xs">
            {p.warnings.map((w) => (
              <li key={w} className="flex gap-1.5">
                <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-3 py-2">
        {isOpen && (
          <>
            <Button
              size="sm"
              variant={p.kind === "delete_event" ? "destructive" : "default"}
              disabled={!!pending}
              onClick={() => run("approve", p.kind === "create_event" ? { optionIndex: choice } : {})}
            >
              {pending === "approve" ? <Loader2 className="animate-spin" /> : <Check />}
              {approveLabel}
            </Button>
            <Button size="sm" variant="ghost" disabled={!!pending} onClick={() => run("reject")}>
              Dismiss
            </Button>
          </>
        )}
        {status === "executed" && (
          <>
            {state?.eventLink && (
              <Button asChild size="sm" variant="ghost">
                <a href={state.eventLink} target="_blank" rel="noreferrer">
                  Open <ExternalLink />
                </a>
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={!!pending} onClick={() => run("undo")}>
              {pending === "undo" ? <Loader2 className="animate-spin" /> : <Undo2 />} Undo
            </Button>
          </>
        )}
        {(status === "executing" || status === "undoing") && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Working…
          </span>
        )}
        {(status === "rejected" || status === "undone" || status === "failed") && (
          <span className="text-xs text-muted-foreground">No changes are pending.</span>
        )}
      </div>
    </div>
  );
}

export function UndoCard({ actionId, summary, resultLabel }: { actionId: string; summary: string; resultLabel?: string }) {
  const { status, pending, run } = useAction(actionId, "executed");
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-sm shadow-xs">
      <Undo2 className="size-4 shrink-0 text-brand" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Undo: {summary}</p>
        {resultLabel && <p className="text-xs text-muted-foreground tabular-nums">{resultLabel}</p>}
      </div>
      {status === "executed" ? (
        <Button size="sm" disabled={!!pending} onClick={() => run("undo")}>
          {pending ? <Loader2 className="animate-spin" /> : <Undo2 />} Undo
        </Button>
      ) : (
        <Badge className="bg-muted text-muted-foreground">{status === "undone" ? "Undone" : status}</Badge>
      )}
    </div>
  );
}
