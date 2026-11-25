"use client";

import { CalendarCheck2 } from "lucide-react";
import { usePathname } from "next/navigation";
import { GoogleSignInButton } from "@/components/auth/sign-in-panel";

/** Shown when the stored Google grant is missing, revoked or expired. One click re-runs Google consent. */
export function ConnectGoogle({ message }: { message: string }) {
  const pathname = usePathname();
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <CalendarCheck2 className="size-10 text-brand" />
        <h1 className="text-xl font-semibold">Reconnect Google Calendar</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <GoogleSignInButton href={`/api/auth/google?prompt=consent&returnTo=${encodeURIComponent(pathname)}`} />
        <p className="text-xs text-muted-foreground">Kairos reads your calendar and only changes events after you approve.</p>
      </div>
    </div>
  );
}
