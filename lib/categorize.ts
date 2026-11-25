import type { CalEvent } from "@/lib/google/types";

export type EventCategory = "focus" | "one_on_one" | "team" | "external" | "personal";

export const CATEGORY_LABEL: Record<EventCategory, string> = {
  focus: "Focus",
  one_on_one: "1:1",
  team: "Team",
  external: "External",
  personal: "Solo",
};

const CONSUMER_DOMAINS = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com"]);

export function emailDomain(email?: string): string | undefined {
  return email?.split("@")[1]?.toLowerCase();
}

/** Cheap, deterministic category used for colouring and as a hint for the agent. */
export function categorize(e: CalEvent, myEmail?: string): EventCategory {
  const title = e.title.toLowerCase();
  if (e.eventType === "focusTime" || /\b(focus|deep work|heads[ -]?down|no meetings|maker time)\b/.test(title)) {
    return "focus";
  }
  const others = e.attendees.filter((a) => !a.self && !a.email.endsWith("calendar.google.com"));
  if (others.length === 0) return "personal";
  const myDomain = emailDomain(myEmail);
  if (myDomain && !CONSUMER_DOMAINS.has(myDomain) && others.some((a) => emailDomain(a.email) !== myDomain)) {
    return "external";
  }
  return others.length === 1 ? "one_on_one" : "team";
}
