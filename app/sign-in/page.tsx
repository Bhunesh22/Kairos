import type { Metadata } from "next";
import { Suspense } from "react";
import { SignInPanel } from "@/components/auth/sign-in-panel";
import { Logo } from "@/components/logo";

export const metadata: Metadata = { title: "Sign in · Kairos" };

export default function SignInPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border bg-card p-8 text-center shadow-xs">
        <Logo className="text-xl" />
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Sign in to Kairos</h1>
          <p className="text-sm text-muted-foreground">
            Tell Kairos what you need and it schedules, moves and prepares your meetings. Nothing changes without your approval.
          </p>
        </div>
        {/* Reads ?error and ?returnTo, which are only known at request time. */}
        <Suspense fallback={<div className="h-96 w-full animate-pulse rounded-lg bg-muted" />}>
          <SignInPanel />
        </Suspense>
      </div>
    </main>
  );
}
