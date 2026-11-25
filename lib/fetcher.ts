import type { ApiErrorBody } from "@/lib/api-types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** JSON fetch that throws ApiError with the server's error code. Used by SWR and mutations. */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body as ApiErrorBody | null;
    if (res.status === 401 && typeof window !== "undefined") {
      // Session JWT expired while the page was open: go back through sign-in and return here.
      // Outside React (no router), and a full reload clears stale cached data anyway.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/sign-in?returnTo=${encodeURIComponent(window.location.pathname)}`);
    }
    throw new ApiError(err?.error ?? `Request failed (${res.status})`, err?.code ?? "internal", res.status);
  }
  return body as T;
}

export const isGoogleAccessError = (err: unknown) =>
  err instanceof ApiError && (err.code === "google_not_connected" || err.code === "google_reauth");
