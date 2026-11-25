"use client";

import { useUser } from "@clerk/nextjs";
import { CalendarCheck2, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CALENDAR_SCOPES } from "@/lib/google/types";

/** Shown when Clerk has no Google token with calendar scopes. Re-runs Google consent with the right scopes. */
export function ConnectGoogle({ message }: { message: string }) {
  const { user } = useUser();
  const [busy, setBusy] = useState(false);

  async function connect() {
    if (!user) return;
    setBusy(true);
    try {
      const redirectUrl = window.location.href;
      const google = user.externalAccounts.find((a) => a.provider === "google");
      const account = google
        ? await google.reauthorize({ redirectUrl, additionalScopes: CALENDAR_SCOPES })
        : await user.createExternalAccount({ strategy: "oauth_google", redirectUrl, additionalScopes: CALENDAR_SCOPES });
      const next = account.verification?.externalVerificationRedirectURL;
      if (next) window.location.href = next.toString();
      else window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't start Google sign-in.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <CalendarCheck2 className="size-10 text-brand" />
        <h1 className="text-xl font-semibold">Connect Google Calendar</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Button onClick={connect} disabled={busy || !user}>
          {busy && <Loader2 className="animate-spin" />} Grant calendar access
        </Button>
        <p className="text-xs text-muted-foreground">Kairos reads your calendar and only changes events after you approve.</p>
      </div>
    </div>
  );
}
