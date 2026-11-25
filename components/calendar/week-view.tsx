"use client";

import { Video } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useNow } from "@/hooks/use-media-query";
import { categorize, type EventCategory } from "@/lib/categorize";
import type { CalEvent } from "@/lib/google/types";
import type { WorkingHours } from "@/lib/scheduling/rules";
import { formatShort, hhmmToMinutes, localMinutes, toLocal, toLocalDate, weekdayOfLocalDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { layoutDay, type PositionedEvent } from "./layout-day";

const HOUR_PX = 60;
const GRID_COLS = "3.5rem repeat(7, minmax(0, 1fr))";

export const CATEGORY_COLOR: Record<EventCategory, string> = {
  focus: "var(--cat-focus)",
  one_on_one: "var(--cat-one-on-one)",
  team: "var(--cat-team)",
  external: "var(--cat-external)",
  personal: "var(--cat-personal)",
};

type Props = {
  days: string[];
  events: CalEvent[];
  timeZone: string;
  myEmail: string;
  workingHours: WorkingHours;
  onSelect: (event: CalEvent) => void;
};

export function WeekView({ days, events, timeZone, myEmail, workingHours, onSelect }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const now = useNow();
  const today = toLocalDate(now, timeZone);
  const workStart = hhmmToMinutes(workingHours.start);
  const workEnd = hhmmToMinutes(workingHours.end);

  const positioned = useMemo(() => days.map((d) => layoutDay(events, d, timeZone)), [days, events, timeZone]);
  const allDayByDate = useMemo(
    () => days.map((d) => events.filter((e) => e.allDay && e.start <= d && d < e.end)),
    [days, events],
  );
  const hasAllDay = allDayByDate.some((list) => list.length);

  // Start scrolled to just before the working day.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: Math.max(0, (workStart - 60) / 60) * HOUR_PX });
  }, [workStart]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
      <div className="flex min-h-0 min-w-[46rem] flex-1 flex-col">
        <div className="grid overflow-hidden border-b [scrollbar-gutter:stable]" style={{ gridTemplateColumns: GRID_COLS }}>
          <div />
          {days.map((d) => {
            const isToday = d === today;
            return (
              <div key={d} className="flex flex-col items-center gap-0.5 py-2 text-xs">
                <span className={cn("font-medium uppercase text-muted-foreground", isToday && "text-brand")}>
                  {weekdayOfLocalDate(d)}
                </span>
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full text-base font-medium tabular-nums",
                    isToday && "bg-brand text-brand-foreground",
                  )}
                >
                  {Number(d.slice(8))}
                </span>
              </div>
            );
          })}
        </div>

        {hasAllDay && (
          <div className="grid overflow-hidden border-b [scrollbar-gutter:stable]" style={{ gridTemplateColumns: GRID_COLS }}>
            <div className="py-1 pr-2 text-right text-[0.7rem] text-muted-foreground">all-day</div>
            {allDayByDate.map((list, i) => (
              <div key={days[i]} className="flex min-w-0 flex-col gap-0.5 border-l p-0.5">
                {list.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onSelect(e)}
                    className="truncate rounded px-1.5 py-0.5 text-left text-xs font-medium"
                    style={{ background: `color-mix(in oklch, ${CATEGORY_COLOR[categorize(e, myEmail)]} 20%, var(--background))` }}
                  >
                    {e.title}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          <div className="grid" style={{ gridTemplateColumns: GRID_COLS, height: 24 * HOUR_PX }}>
            <div className="relative">
              {Array.from({ length: 23 }, (_, h) => (
                <span
                  key={h}
                  className="absolute right-2 -translate-y-1/2 text-[0.7rem] text-muted-foreground tabular-nums"
                  style={{ top: (h + 1) * HOUR_PX }}
                >
                  {String(h + 1).padStart(2, "0")}:00
                </span>
              ))}
            </div>

            {days.map((d, i) => {
              const isWorkday = workingHours.days.includes(weekdayOfLocalDate(d));
              return (
                <div
                  key={d}
                  className="relative border-l"
                  style={{
                    backgroundImage: "linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
                    backgroundSize: `100% ${HOUR_PX}px`,
                  }}
                >
                  {isWorkday ? (
                    <>
                      <div className="absolute inset-x-0 top-0 bg-muted/50" style={{ height: (workStart / 60) * HOUR_PX }} />
                      <div className="absolute inset-x-0 bottom-0 bg-muted/50" style={{ top: (workEnd / 60) * HOUR_PX }} />
                    </>
                  ) : (
                    <div className="absolute inset-0 bg-muted/50" />
                  )}

                  {positioned[i].map((p) => (
                    <EventBlock key={p.event.id} p={p} tz={timeZone} myEmail={myEmail} onSelect={onSelect} />
                  ))}

                  {d === today && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-destructive"
                      style={{ top: (localMinutes(now, timeZone) / 60) * HOUR_PX }}
                    >
                      <span className="absolute -top-[3px] -left-1 size-2 rounded-full bg-destructive" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function EventBlock({ p, tz, myEmail, onSelect }: { p: PositionedEvent; tz: string; myEmail: string; onSelect: (e: CalEvent) => void }) {
  const e = p.event;
  const color = CATEGORY_COLOR[categorize(e, myEmail)];
  const height = (p.height / 60) * HOUR_PX - 2;
  const declined = e.myResponse === "declined";
  const tentative = e.myResponse === "tentative" || e.myResponse === "needsAction";
  const start = new Date(e.start);
  const end = new Date(e.end);

  return (
    <button
      type="button"
      onClick={() => onSelect(e)}
      title={`${e.title}\n${formatShort(start, tz)}–${toLocal(end, tz).slice(11)}`}
      className={cn(
        "absolute z-10 flex flex-col overflow-hidden rounded-md px-1.5 py-0.5 text-left text-xs leading-tight shadow-xs transition hover:z-30 hover:shadow-md focus-visible:z-30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        declined && "opacity-50",
      )}
      style={{
        top: (p.top / 60) * HOUR_PX + 1,
        height: Math.max(height, 18),
        left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
        width: `calc(${100 / p.cols}% - 4px)`,
        background: `color-mix(in oklch, ${color} ${e.transparent ? 8 : 18}%, var(--background))`,
        borderLeft: `3px ${tentative ? "dashed" : "solid"} ${color}`,
      }}
    >
      <span className={cn("flex items-center gap-1 font-medium", declined && "line-through")}>
        <span className="truncate">{e.title}</span>
        {e.meetLink && height >= 30 && <Video className="size-3 shrink-0 opacity-60" aria-label="Has video call" />}
      </span>
      {height >= 32 && (
        <span className="truncate text-muted-foreground tabular-nums">
          {toLocal(start, tz).slice(11)}–{toLocal(end, tz).slice(11)}
        </span>
      )}
    </button>
  );
}
