"use client";

import { ChevronLeft, ChevronRight, Loader2, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useAgent } from "@/components/agent/agent-provider";
import { AgentPanel } from "@/components/agent/agent-panel";
import { ConnectGoogle } from "@/components/connect-google";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useEvents, useMe } from "@/hooks/use-calendar-data";
import { CATEGORY_LABEL, type EventCategory } from "@/lib/categorize";
import { ApiError, isGoogleAccessError } from "@/lib/fetcher";
import type { CalEvent } from "@/lib/google/types";
import { addDaysToLocalDate, formatLocalDateLabel, startOfLocalWeek, toLocalDate } from "@/lib/time";
import { EventDetails } from "./event-details";
import { CATEGORY_COLOR, WeekView } from "./week-view";

function ErrorState({ error }: { error: unknown }) {
  if (isGoogleAccessError(error)) return <ConnectGoogle message={(error as ApiError).message} />;
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-center">
      <div className="max-w-md">
        <p className="font-medium">Kairos couldn&apos;t load your calendar</p>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="hidden items-center gap-3 text-xs text-muted-foreground xl:flex">
      {(Object.keys(CATEGORY_LABEL) as EventCategory[]).map((c) => (
        <span key={c} className="flex items-center gap-1">
          <span className="size-2 rounded-full" style={{ background: CATEGORY_COLOR[c] }} />
          {CATEGORY_LABEL[c]}
        </span>
      ))}
    </div>
  );
}

export function CalendarWorkspace() {
  const me = useMe();
  const tz = me.data?.timezone;
  const [weekOffset, setWeekOffset] = useState(0);
  const [selected, setSelected] = useState<CalEvent | null>(null);
  const { panelOpen, setPanelOpen } = useAgent();

  const days = useMemo(() => {
    if (!tz) return [];
    const monday = addDaysToLocalDate(startOfLocalWeek(toLocalDate(new Date(), tz)), weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => addDaysToLocalDate(monday, i));
  }, [tz, weekOffset]);

  const events = useEvents(days[0] ?? null, days[6] ?? null);
  const error = me.error ?? events.error;

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <Button variant="outline" size="sm" onClick={() => setWeekOffset(0)} disabled={!tz}>
            Today
          </Button>
          <div className="flex">
            <Button variant="ghost" size="icon-sm" aria-label="Previous week" onClick={() => setWeekOffset((w) => w - 1)} disabled={!tz}>
              <ChevronLeft />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Next week" onClick={() => setWeekOffset((w) => w + 1)} disabled={!tz}>
              <ChevronRight />
            </Button>
          </div>
          <h1 className="truncate text-sm font-medium sm:text-base">
            {days.length ? `${formatLocalDateLabel(days[0])} – ${formatLocalDateLabel(days[6])}, ${days[6].slice(0, 4)}` : " "}
          </h1>
          {events.isValidating && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Refreshing" />}
          <div className="ml-auto flex items-center gap-3">
            <Legend />
            {me.data && (
              <Link
                href="/settings"
                className="hidden rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted sm:inline"
                title={me.data.calendarProvider === "local" ? "Events live in Kairos. Connect Google Calendar in Settings." : "Synced with Google Calendar"}
              >
                {me.data.calendarProvider === "local" ? "Kairos calendar" : "Google Calendar"} · {tz}
              </Link>
            )}
          </div>
        </div>

        {error && !events.data ? (
          <ErrorState error={error} />
        ) : me.data && events.data ? (
          <WeekView
            days={days}
            events={events.data.events}
            timeZone={events.data.timeZone}
            myEmail={me.data.email}
            workingHours={me.data.workingHours}
            onSelect={setSelected}
          />
        ) : (
          <div className="flex flex-1 flex-col gap-3 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        )}
      </section>

      <aside className="hidden w-[400px] shrink-0 border-l lg:flex">
        <AgentPanel />
      </aside>

      {/* Below lg the agent lives in a sheet. */}
      <Button
        className="fixed right-4 bottom-4 z-40 rounded-full bg-brand text-brand-foreground shadow-lg hover:bg-brand/90 lg:hidden"
        size="lg"
        onClick={() => setPanelOpen(true)}
      >
        <MessageSquareText /> Ask Kairos
      </Button>
      <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-md lg:hidden" showCloseButton={false}>
          <SheetTitle className="sr-only">Kairos agent</SheetTitle>
          <AgentPanel />
        </SheetContent>
      </Sheet>

      {tz && me.data && (
        <EventDetails event={selected} timeZone={tz} myEmail={me.data.email} onOpenChange={(open) => !open && setSelected(null)} />
      )}
    </div>
  );
}
