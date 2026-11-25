"use client";

import { useMemo, useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * Current time, floored to `intervalMs` and re-rendered when it ticks over.
 * The server snapshot is a constant so prerendering never reads the clock;
 * only render this below data that loads on the client.
 */
export function useNow(intervalMs = 60_000): Date {
  const tick = useSyncExternalStore(
    (onChange) => {
      const id = setInterval(onChange, Math.min(intervalMs, 15_000));
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / intervalMs),
    () => 0,
  );
  return useMemo(() => new Date(tick * intervalMs), [tick, intervalMs]);
}
