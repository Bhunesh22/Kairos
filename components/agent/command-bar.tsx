"use client";

import { CalendarDays, Settings, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useAgent } from "./agent-provider";
import { EXAMPLE_PROMPTS } from "./agent-panel";

/** ⌘K: type an intent, press Enter, and the agent takes it from there. */
export function CommandBar() {
  const { commandOpen, setCommandOpen, commandDraft, ask, openCommand } = useAgent();
  const router = useRouter();
  const [value, setValue] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (commandOpen) setCommandOpen(false);
        else openCommand();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commandOpen, openCommand, setCommandOpen]);

  // Reset the input to the draft each time the bar opens.
  const [lastOpen, setLastOpen] = useState(false);
  if (commandOpen !== lastOpen) {
    setLastOpen(commandOpen);
    if (commandOpen) setValue(commandDraft);
  }

  const send = (text: string) => {
    setCommandOpen(false);
    ask(text);
  };
  const go = (href: string) => {
    setCommandOpen(false);
    router.push(href);
  };

  return (
    <CommandDialog open={commandOpen} onOpenChange={setCommandOpen} title="Ask Kairos" description="Tell Kairos what you need">
      <Command shouldFilter={false}>
        <CommandInput value={value} onValueChange={setValue} placeholder="What do you need? e.g. 45 min with Rahul next week…" />
        <CommandList>
          <CommandEmpty>Type a request and press Enter.</CommandEmpty>
          {value.trim() && (
            <CommandGroup heading="Ask Kairos">
              <CommandItem value={`ask:${value}`} onSelect={() => send(value)}>
                <Sparkles className="text-brand" /> <span className="truncate">{value}</span>
              </CommandItem>
            </CommandGroup>
          )}
          <CommandGroup heading="Suggestions">
            {EXAMPLE_PROMPTS.filter((p) => !value.trim() || p.toLowerCase().includes(value.trim().toLowerCase())).map((p) => (
              <CommandItem key={p} value={p} onSelect={() => send(p)}>
                <Sparkles className="text-muted-foreground" /> {p}
              </CommandItem>
            ))}
          </CommandGroup>
          {!value.trim() && (
            <CommandGroup heading="Go to">
              <CommandItem value="nav:calendar" onSelect={() => go("/calendar")}>
                <CalendarDays /> Calendar
              </CommandItem>
              <CommandItem value="nav:settings" onSelect={() => go("/settings")}>
                <Settings /> Settings & rules
              </CommandItem>
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
