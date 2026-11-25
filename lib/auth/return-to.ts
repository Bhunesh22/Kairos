/** Only same-site relative paths, so the sign-in flow can't be used as an open redirect. */
export function safeReturnTo(value: string | null | undefined, fallback = "/calendar"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (value.startsWith("/api/") || value.startsWith("/sign-in")) return fallback;
  return value;
}
