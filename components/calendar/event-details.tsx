"use client";

import { CalendarClock, Check, CircleHelp, ExternalLink, MapPin, Sparkles, Trash2, Users, Video, X } from "lucide-react";
import { useAgent } from "@/components/agent/agent-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CATEGORY_LABEL, categorize } from "@/lib/categorize";
import type { CalEvent } from "@/lib/google/types";
import { stripHtml } from "@/lib/text";
import { formatLocalDateLabel, formatRange } from "@/lib/time";

const RSVP_ICON: Record<string, React.ReactNode> = {
  accepted: <Check className="size-3.5 text-success" aria-label="Accepted" />,
  declined: <X className="size-3.5 text-destructive" aria-label="Declined" />,
  tentative: <CircleHelp className="size-3.5 text-warning" aria-label="Maybe" />,
};

export function EventDetails({
  event,
  timeZone,
  myEmail,
  onOpenChange,
}: {
  event: CalEvent | null;
  timeZone: string;
  myEmail: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { ask, openCommand } = useAgent();
  const label = event
    ? event.allDay
      ? formatLocalDateLabel(event.start)
      : formatRange(new Date(event.start), new Date(event.end), timeZone)
    : "";
  const ref = event ? `“${event.title}” (${label})` : "";

  const run = (fn: () => void) => {
    fn();
    onOpenChange(false);
  };

  return (
    <Sheet open={!!event} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {event && (
          <>
            <SheetHeader className="border-b">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{CATEGORY_LABEL[categorize(event, myEmail)]}</Badge>
                {event.recurring && <Badge variant="outline">Recurring</Badge>}
              </div>
              <SheetTitle className="text-lg">{event.title}</SheetTitle>
              <SheetDescription>{label}</SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-5 p-4 text-sm">
              {event.meetLink && (
                <Button asChild className="w-fit">
                  <a href={event.meetLink} target="_blank" rel="noreferrer">
                    <Video /> {event.meetLink.includes("meet.google.com") ? "Join Google Meet" : "Join video call"}
                  </a>
                </Button>
              )}

              {event.location && (
                <p className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  {event.location}
                </p>
              )}

              {event.attendees.length > 0 && (
                <div>
                  <p className="mb-2 flex items-center gap-2 font-medium">
                    <Users className="size-4 text-muted-foreground" /> {event.attendees.length} guests
                  </p>
                  <ul className="flex flex-col gap-1.5">
                    {event.attendees.map((a) => (
                      <li key={a.email} className="flex items-center gap-2">
                        <span className="flex size-4 items-center justify-center">{RSVP_ICON[a.responseStatus ?? ""] ?? null}</span>
                        <span className="truncate">
                          {a.name ?? a.email}
                          {a.self && <span className="text-muted-foreground"> (you)</span>}
                          {a.organizer && <span className="text-muted-foreground"> · organizer</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <p className="mb-1 font-medium">Agenda</p>
                {event.description?.trim() ? (
                  <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-muted-foreground">{stripHtml(event.description)}</p>
                ) : (
                  <p className="text-muted-foreground">No agenda yet.</p>
                )}
              </div>

              <div className="flex flex-col gap-2 border-t pt-4">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Ask Kairos</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => run(() => ask(`Prepare me for ${ref}.`))}>
                    <Sparkles /> Prep brief
                  </Button>
                  {!event.description?.trim() && event.attendees.length > 0 && (
                    <Button variant="outline" size="sm" onClick={() => run(() => ask(`Draft an agenda for ${ref} and add it to the event.`))}>
                      <Sparkles /> Draft agenda
                    </Button>
                  )}
                  {!event.allDay && (
                    <Button variant="outline" size="sm" onClick={() => run(() => openCommand(`Move ${ref} to `))}>
                      <CalendarClock /> Reschedule…
                    </Button>
                  )}
                  {!event.allDay && (
                    <Button variant="outline" size="sm" onClick={() => run(() => ask(`Cancel ${ref}.`))}>
                      <Trash2 /> Cancel
                    </Button>
                  )}
                </div>
              </div>

              {event.htmlLink && (
                <a
                  href={event.htmlLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Open in Google Calendar <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
