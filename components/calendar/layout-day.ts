import type { CalEvent } from "@/lib/google/types";
import { addDaysToLocalDate, localMinutes, startOfLocalDay } from "@/lib/time";

export type PositionedEvent = {
  event: CalEvent;
  /** Minutes after local midnight. */
  top: number;
  height: number;
  col: number;
  cols: number;
  startsBefore: boolean;
  endsAfter: boolean;
};

const MIN_HEIGHT = 15;

/**
 * Positions one day's timed events in a day column. Overlapping events are
 * split into side-by-side columns, Google Calendar style.
 */
export function layoutDay(events: CalEvent[], date: string, tz: string): PositionedEvent[] {
  const dayStart = startOfLocalDay(date, tz).getTime();
  const dayEnd = startOfLocalDay(addDaysToLocalDate(date, 1), tz).getTime();

  const items = events
    .flatMap((event): PositionedEvent[] => {
      if (event.allDay) return [];
      const s = new Date(event.start).getTime();
      const e = new Date(event.end).getTime();
      if (e <= dayStart || s >= dayEnd) return [];
      // Wall-clock minutes, so DST days still line up with the hour grid.
      const top = s <= dayStart ? 0 : localMinutes(new Date(s), tz);
      const bottom = e >= dayEnd ? 24 * 60 : localMinutes(new Date(e), tz);
      return [{ event, top, height: Math.max(bottom - top, MIN_HEIGHT), col: 0, cols: 1, startsBefore: s < dayStart, endsAfter: e > dayEnd }];
    })
    .sort((a, b) => a.top - b.top || b.height - a.height);

  const out: PositionedEvent[] = [];
  let cluster: PositionedEvent[] = [];
  let clusterEnd = -1;

  const flush = () => {
    const colEnds: number[] = [];
    for (const item of cluster) {
      let col = colEnds.findIndex((end) => end <= item.top);
      if (col === -1) col = colEnds.push(0) - 1;
      colEnds[col] = item.top + item.height;
      item.col = col;
    }
    for (const item of cluster) item.cols = colEnds.length;
    out.push(...cluster);
    cluster = [];
    clusterEnd = -1;
  };

  for (const item of items) {
    if (cluster.length && item.top >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.top + item.height);
  }
  flush();
  return out;
}
