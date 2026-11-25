"use client";

import useSWR from "swr";
import type { EventsResponse, MeResponse, PreferenceDTO } from "@/lib/api-types";

export function useMe() {
  return useSWR<MeResponse>("/api/me");
}

/** Live events for local dates [from, to]. Pass nulls to wait (e.g. until the time zone is known). */
export function useEvents(from: string | null, to: string | null) {
  return useSWR<EventsResponse>(from && to ? `/api/events?from=${from}&to=${to}` : null, { keepPreviousData: true });
}

export function usePreferences() {
  return useSWR<PreferenceDTO[]>("/api/preferences");
}
