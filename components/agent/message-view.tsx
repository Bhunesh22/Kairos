"use client";

import { isToolUIPart } from "ai";
import { BookmarkCheck, CalendarSearch, Clock, Loader2, Search, TriangleAlert, UserSearch } from "lucide-react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import type { KairosUIMessage } from "./agent-provider";
import { ApprovalCard, UndoCard } from "./approval-card";

type Part = KairosUIMessage["parts"][number];
type ToolPart = Extract<Part, { toolCallId: string }>;

const READ_TOOLS: Record<string, { icon: typeof Search; running: string; done: (part: ToolPart) => string }> = {
  "tool-get_events": {
    icon: CalendarSearch,
    running: "Reading your calendar…",
    done: (p) => {
      if (p.type !== "tool-get_events" || p.state !== "output-available") return "Read your calendar";
      const { from, to } = p.input;
      return `Read your calendar ${from === to ? from : `${from} → ${to}`} (${p.output.count} events)`;
    },
  },
  "tool-get_event": { icon: CalendarSearch, running: "Opening the event…", done: () => "Read event details" },
  "tool-search_contacts": {
    icon: UserSearch,
    running: "Looking up contacts…",
    done: (p) =>
      p.type === "tool-search_contacts" && p.state === "output-available"
        ? `Looked up “${p.input.query}” (${p.output.matches.length} match${p.output.matches.length === 1 ? "" : "es"})`
        : "Looked up contacts",
  },
  "tool-find_free_slots": {
    icon: Clock,
    running: "Finding the best times…",
    done: (p) =>
      p.type === "tool-find_free_slots" && p.state === "output-available"
        ? `Checked availability: ${p.output.slots.length} good slot${p.output.slots.length === 1 ? "" : "s"}`
        : "Checked availability",
  },
};

function ActivityLine({ part }: { part: ToolPart }) {
  const meta = READ_TOOLS[part.type];
  if (!meta) return null;
  const Icon = meta.icon;
  const running = part.state === "input-streaming" || part.state === "input-available";
  const failed = part.state === "output-error";
  return (
    <div className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", failed && "text-destructive")}>
      {running ? <Loader2 className="size-3.5 animate-spin" /> : failed ? <TriangleAlert className="size-3.5" /> : <Icon className="size-3.5" />}
      <span className="truncate">{running ? meta.running : failed ? (part.errorText ?? "That step failed") : meta.done(part)}</span>
    </div>
  );
}

function ToolView({ part }: { part: ToolPart }) {
  if (part.type in READ_TOOLS) return <ActivityLine part={part} />;

  if (part.state === "output-error") {
    return (
      <div className="flex items-start gap-1.5 text-xs text-destructive">
        <TriangleAlert className="mt-px size-3.5 shrink-0" /> {part.errorText ?? "That step failed."}
      </div>
    );
  }
  if (part.state !== "output-available") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Preparing…
      </div>
    );
  }

  switch (part.type) {
    case "tool-propose_create_event":
    case "tool-propose_update_event":
    case "tool-propose_delete_event":
      return <ApprovalCard data={part.output} />;
    case "tool-propose_undo":
      return part.output.found ? (
        <UndoCard actionId={part.output.actionId} summary={part.output.summary} resultLabel={part.output.resultLabel} />
      ) : null;
    case "tool-save_preference":
      return (
        <Link
          href="/settings"
          className="inline-flex w-fit items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs hover:bg-muted"
        >
          <BookmarkCheck className="size-3.5 text-brand" /> Rule saved: {part.output.description}
        </Link>
      );
    default:
      return null;
  }
}

const markdown =
  "text-sm leading-relaxed [&_a]:underline [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 first:[&_p]:mt-0 last:[&_p]:mb-0 [&_strong]:font-semibold [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5";

export function MessageView({ message }: { message: KairosUIMessage }) {
  if (message.role === "user") {
    const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {message.parts.map((part, i) => {
        if (part.type === "text") {
          return part.text.trim() ? (
            <div key={i} className={markdown}>
              <ReactMarkdown>{part.text}</ReactMarkdown>
            </div>
          ) : null;
        }
        if (isToolUIPart(part)) return <ToolView key={part.toolCallId} part={part as ToolPart} />;
        return null;
      })}
    </div>
  );
}
