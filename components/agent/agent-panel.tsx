"use client";

import { ArrowUp, RotateCcw, SquarePen, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DailyBrief } from "@/components/brief/daily-brief";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAgent, type KairosUIMessage } from "./agent-provider";
import { MessageView } from "./message-view";

export const EXAMPLE_PROMPTS = [
  "What does my week look like?",
  "Find 30 minutes with Priya next week for a roadmap review, mornings only",
  "Push my 3pm to tomorrow, same time",
  "I need 3 hours for the pricing deck before Thursday",
  "Never book meetings before 10 on Fridays",
  "Undo that",
];

/** Three bouncing dots in a reply bubble: Kairos is working on it. */
export function TypingIndicator() {
  return (
    <div role="status" aria-label="Kairos is working on it" className="flex">
      <span className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-muted px-3.5 py-3">
        {[0, 160, 320].map((delay) => (
          <span
            key={delay}
            className="size-1.5 rounded-full bg-muted-foreground animate-[typing-dot_1.2s_ease-in-out_infinite] motion-reduce:animate-none"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
    </div>
  );
}

/**
 * Show the dots whenever the agent is busy but nothing is visibly happening:
 * before the first token, and between steps (after a tool finishes, before the
 * next text). Hidden while text streams or a tool shows its own spinner.
 */
export function showTyping(messages: KairosUIMessage[], busy: boolean): boolean {
  if (!busy) return false;
  const last = messages.at(-1);
  if (last?.role !== "assistant") return true;
  const part = last.parts.at(-1);
  if (part?.type === "text") return !part.text.trim();
  if (part && "toolCallId" in part) return part.state !== "input-streaming" && part.state !== "input-available";
  return true;
}

/** Message box: the text grows upward; send/stop live in their own row so they never cover the text. */
export function ChatComposer({
  busy,
  onSend,
  onStop,
}: {
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [input, setInput] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const canSend = !!input.trim() && !busy;

  function submit() {
    if (!canSend) return;
    onSend(input);
    setInput("");
    ref.current?.focus();
  }

  return (
    <form
      className="shrink-0 border-t p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div
        className="cursor-text rounded-xl border border-input bg-background shadow-xs transition focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30"
        onClick={() => ref.current?.focus()}
      >
        <textarea
          ref={ref}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="Ask Kairos to schedule, move, protect or explain…"
          aria-label="Message Kairos"
          className="block max-h-40 min-h-10 w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-sm outline-none field-sizing-content placeholder:text-muted-foreground"
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <span className="truncate pl-1 text-xs text-muted-foreground">
            {busy ? "Kairos is working…" : <span className="hidden sm:inline">Enter to send · Shift+Enter for a new line</span>}
          </span>
          {busy ? (
            <Button type="button" size="icon-sm" variant="secondary" className="shrink-0 rounded-full" onClick={onStop} aria-label="Stop">
              <Square className="fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon-sm"
              className={cn("shrink-0 rounded-full transition", canSend ? "bg-brand text-brand-foreground hover:bg-brand/90" : "opacity-40")}
              disabled={!canSend}
              aria-label="Send"
            >
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

export function AgentPanel() {
  const { messages, status, error, stop, regenerate, ask, reset } = useAgent();
  const endRef = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, status]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <Logo className="text-sm" />
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>
            <SquarePen /> New chat
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.length === 0 ? (
          <div className="flex flex-col gap-4">
            <DailyBrief />
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">Try asking</p>
              {EXAMPLE_PROMPTS.slice(0, 5).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => ask(p)}
                  className="rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((m) => (
              <MessageView key={m.id} message={m} />
            ))}
            {showTyping(messages, busy) && <TypingIndicator />}
            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <span>Something went wrong.</span>
                <Button size="sm" variant="ghost" onClick={() => regenerate()}>
                  <RotateCcw /> Retry
                </Button>
              </div>
            )}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <ChatComposer busy={busy} onSend={ask} onStop={() => void stop()} />
    </div>
  );
}
