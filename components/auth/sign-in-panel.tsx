"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeReturnTo } from "@/lib/auth/return-to";
import { cn } from "@/lib/utils";

const ERRORS: Record<string, string> = {
  denied: "Google sign-in was cancelled. You can try again, or use email below.",
  state: "Your sign-in attempt expired. Please try again.",
  no_refresh_token: "Google didn't grant ongoing access. Please try again and approve all permissions.",
  config: "Google sign-in isn't configured yet. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and AUTH_SECRET in .env.",
  failed: "Sign-in failed. Please try again.",
};

const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Full-page navigation to Google; also passes the browser time zone for new accounts. */
export function GoogleSignInButton({ href, label = "Continue with Google", className }: { href: string; label?: string; className?: string }) {
  const [pending, setPending] = useState(false);
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        setPending(true);
        const url = new URL(href, window.location.origin);
        url.searchParams.set("tz", browserTimeZone());
        window.location.href = url.toString();
      }}
      aria-disabled={pending}
      className={cn(
        "inline-flex h-10 w-full items-center justify-center gap-3 rounded-lg border bg-background px-4 text-sm font-medium shadow-xs transition hover:bg-muted aria-disabled:pointer-events-none aria-disabled:opacity-60",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-4.5" aria-hidden="true">
        <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81Z" />
        <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.87-3c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.27v3.1A12 12 0 0 0 12 24Z" />
        <path fill="#FBBC05" d="M5.27 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
        <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43A11.97 11.97 0 0 0 1.27 6.6l4 3.1C6.22 6.86 8.87 4.75 12 4.75Z" />
      </svg>
      {pending ? "Redirecting to Google…" : label}
    </a>
  );
}

function EmailForm({ returnTo }: { returnTo: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const body =
      mode === "signup"
        ? {
            name: form.get("name"),
            email: form.get("email"),
            password: form.get("password"),
            timeZone: browserTimeZone(),
            sampleData: form.get("sampleData") === "on",
          }
        : { email: form.get("email"), password: form.get("password") };
    try {
      const res = await fetch(mode === "signup" ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Something went wrong. Please try again.");
      }
      window.location.href = returnTo;
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 text-left">
      <div className="grid grid-cols-2 rounded-lg bg-muted p-0.5 text-sm" role="tablist" aria-label="Email sign-in mode">
        {(["signup", "signin"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={cn("rounded-md py-1.5 font-medium text-muted-foreground", mode === m && "bg-background text-foreground shadow-xs")}
          >
            {m === "signup" ? "Create account" : "Sign in"}
          </button>
        ))}
      </div>

      {mode === "signup" && (
        <div className="grid gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" autoComplete="name" required maxLength={80} />
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={mode === "signup" ? 8 : undefined}
          required
        />
      </div>
      {mode === "signup" && (
        <label className="flex items-start gap-2 text-sm text-muted-foreground">
          <input type="checkbox" name="sampleData" defaultChecked className="mt-0.5 accent-brand" />
          Start with a sample week of meetings, so you can try the AI right away
        </label>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="h-10">
        {pending && <Loader2 className="animate-spin" />}
        {mode === "signup" ? "Create account" : "Sign in"}
      </Button>
    </form>
  );
}

export function SignInPanel() {
  const params = useSearchParams();
  const error = params.get("error");
  const returnTo = safeReturnTo(params.get("returnTo"));

  return (
    <div className="flex w-full flex-col gap-5">
      {error && (
        <p role="alert" className="flex gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-left text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {ERRORS[error] ?? ERRORS.failed}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <GoogleSignInButton href={`/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`} />
        <p className="text-xs text-muted-foreground">
          Syncs your Google Calendar. Google Calendar sync is invite-only during the beta. If Google says{" "}
          <span className="font-medium text-foreground">“Access blocked”</span>, use email below.
        </p>
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or use a Kairos calendar
        <span className="h-px flex-1 bg-border" />
      </div>

      <EmailForm returnTo={returnTo} />
    </div>
  );
}
