"use client";

import { ArrowUp, Loader2, RotateCcw, SquarePen, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DailyBrief } from "@/components/brief/daily-brief";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAgent } from "./agent-provider";
import { MessageView } from "./message-view";

export const EXAMPLE_PROMPTS = [
  "What does my week look like?",
  "Find 30 minutes with Priya next week for a roadmap review, mornings only",
  "Push my 3pm to tomorrow, same time",
  "I need 3 hours for the pricing deck before Thursday",
  "Never book meetings before 10 on Fridays",
  "Undo that",
];

export function AgentPanel() {
  const { messages, status, error, stop, regenerate, ask, reset } = useAgent();
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, status]);

  function submit() {
    if (!input.trim() || busy) return;
    ask(input);
    setInput("");
  }

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
            {status === "submitted" && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Thinking…
              </div>
            )}
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

      <form
        className="shrink-0 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="relative">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask Kairos to schedule, move, protect or explain…"
            aria-label="Message Kairos"
            rows={2}
            className="max-h-40 min-h-16 resize-none pr-12"
          />
          {busy ? (
            <Button type="button" size="icon-sm" variant="secondary" className="absolute right-2 bottom-2" onClick={() => stop()} aria-label="Stop">
              <Square />
            </Button>
          ) : (
            <Button type="submit" size="icon-sm" className="absolute right-2 bottom-2" disabled={!input.trim()} aria-label="Send">
              <ArrowUp />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
