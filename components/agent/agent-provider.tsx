"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type InferUITools, type UIDataTypes, type UIMessage } from "ai";
import { createContext, use, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { KairosTools } from "@/lib/agent/tools";

export type KairosUIMessage = UIMessage<unknown, UIDataTypes, InferUITools<KairosTools>>;

type ChatHelpers = ReturnType<typeof useChat<KairosUIMessage>>;

type AgentContextValue = {
  messages: KairosUIMessage[];
  status: ChatHelpers["status"];
  error: ChatHelpers["error"];
  stop: ChatHelpers["stop"];
  regenerate: ChatHelpers["regenerate"];
  /** Send a message to the agent and make sure the panel is visible. */
  ask: (text: string) => void;
  reset: () => void;
  /** Mobile only: the agent lives in a sheet. */
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  commandOpen: boolean;
  commandDraft: string;
  openCommand: (draft?: string) => void;
  setCommandOpen: (open: boolean) => void;
  /** Re-fetch calendar-derived data after an approved change. */
  refreshCalendar: () => void;
};

const AgentContext = createContext<AgentContextValue | null>(null);

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const { mutate } = useSWRConfig();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [panelOpen, setPanelOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandDraft, setCommandDraft] = useState("");
  const [transport] = useState(() => new DefaultChatTransport<KairosUIMessage>({ api: "/api/chat" }));

  const chat = useChat<KairosUIMessage>({
    transport,
    onError: (err) => toast.error(err.message || "Kairos couldn't respond. Try again."),
    onFinish: ({ message }) => {
      if (message.parts.some((p) => p.type === "tool-save_preference")) void mutate("/api/preferences");
    },
  });
  const { sendMessage, setMessages, clearError } = chat;

  const refreshCalendar = useCallback(() => {
    void mutate((key) => typeof key === "string" && (key.startsWith("/api/events") || key.startsWith("/api/brief")));
  }, [mutate]);

  const ask = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (!isDesktop) setPanelOpen(true);
      void sendMessage({ text: trimmed });
    },
    [isDesktop, sendMessage],
  );

  const reset = useCallback(() => {
    setMessages([]);
    clearError();
  }, [setMessages, clearError]);

  const openCommand = useCallback((draft = "") => {
    setCommandDraft(draft);
    setCommandOpen(true);
  }, []);

  const value = useMemo<AgentContextValue>(
    () => ({
      messages: chat.messages,
      status: chat.status,
      error: chat.error,
      stop: chat.stop,
      regenerate: chat.regenerate,
      ask,
      reset,
      panelOpen,
      setPanelOpen,
      commandOpen,
      commandDraft,
      openCommand,
      setCommandOpen,
      refreshCalendar,
    }),
    [chat.messages, chat.status, chat.error, chat.stop, chat.regenerate, ask, reset, panelOpen, commandOpen, commandDraft, openCommand, refreshCalendar],
  );

  return <AgentContext value={value}>{children}</AgentContext>;
}

export function useAgent(): AgentContextValue {
  const ctx = use(AgentContext);
  if (!ctx) throw new Error("useAgent must be used inside <AgentProvider>");
  return ctx;
}
