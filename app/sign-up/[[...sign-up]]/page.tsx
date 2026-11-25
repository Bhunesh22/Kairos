import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";
import { Logo } from "@/components/logo";

export default function SignUpPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      <Logo className="text-xl" />
      {/* Catch-all route: the pathname is only known at request time. */}
      <Suspense fallback={<div className="h-[420px] w-full max-w-sm animate-pulse rounded-xl bg-muted" />}>
        <SignUp />
      </Suspense>
    </main>
  );
}
