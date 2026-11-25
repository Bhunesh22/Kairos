import "server-only";
import { unstable_rethrow } from "next/navigation";
import { GoogleApiError } from "@/lib/google/calendar";

export type AppErrorCode =
  | "unauthenticated"
  | "google_not_connected"
  | "google_reauth"
  | "not_found"
  | "bad_request"
  | "conflict"
  | "rate_limited"
  | "config"
  | "internal";

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/** Normalises any thrown error into an AppError with a user-safe message. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof GoogleApiError) {
    switch (err.kind) {
      case "auth":
        return new AppError("google_reauth", "Kairos needs permission to access your Google Calendar again.", 403);
      case "not_found":
        return new AppError("not_found", "That event no longer exists in Google Calendar.", 404);
      case "rate_limit":
        return new AppError("rate_limited", "Google Calendar is rate-limiting requests. Try again in a minute.", 429);
      default:
        return new AppError("internal", `Google Calendar error: ${err.message}`, 502);
    }
  }
  if (err instanceof Error && /DATABASE_URL|GOOGLE_GENERATIVE_AI_API_KEY|AUTH_SECRET|GOOGLE_CLIENT_ID/.test(err.message)) {
    return new AppError("config", err.message, 500);
  }
  console.error(err);
  return new AppError("internal", "Something went wrong.", 500);
}

export function errorResponse(err: unknown): Response {
  const e = toAppError(err);
  return Response.json({ error: e.message, code: e.code }, { status: e.status });
}

/** Wraps a route handler so thrown errors become JSON error responses. */
export function route<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      // Let Next.js control-flow signals (prerender bail-out, redirects) through.
      unstable_rethrow(err);
      return errorResponse(err);
    }
  };
}
