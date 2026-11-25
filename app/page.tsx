import { ArrowRight, CalendarCheck2, ShieldCheck, Sparkles, Undo2 } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

const FEATURES = [
  {
    icon: Sparkles,
    title: "Schedule in a sentence",
    body: "“45 minutes with Priya and Rahul next week, mornings.” Kairos checks everyone's availability and your rules, then offers the three best slots with reasons.",
  },
  {
    icon: ShieldCheck,
    title: "Protects your focus",
    body: "Teach it your rules once: no meetings before 10, buffers between calls, a protected focus block. They're enforced in every slot it suggests.",
  },
  {
    icon: CalendarCheck2,
    title: "Briefs you every morning",
    body: "Conflicts, back-to-backs, meetings with no agenda and where your deep-work time is, with one-click fixes.",
  },
  {
    icon: Undo2,
    title: "You stay in control",
    body: "The agent proposes; you approve. Every change is logged and can be undone with one click.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo className="text-lg" />
        <Button asChild variant="ghost" size="sm">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 sm:px-6">
        <section className="py-16 sm:py-24">
          <p className="mb-4 text-sm font-medium text-brand">Chronos is clock time. Kairos is the right moment.</p>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            Your AI chief of staff for time.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-pretty text-muted-foreground">
            Kairos is an AI-native layer on top of Google Calendar. Say what you want, and it schedules, protects, prepares
            and reviews your time. You just approve.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" className="bg-brand text-brand-foreground hover:bg-brand/90">
              <Link href="/calendar">
                Open Kairos <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#how">How it works</a>
            </Button>
          </div>
        </section>

        <section id="how" className="grid gap-4 pb-20 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-xl border bg-card p-6">
              <Icon className="mb-3 size-5 text-brand" />
              <h2 className="font-medium">{title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        Works with Google Calendar or a built-in Kairos calendar. Powered by Gemini. Nothing changes without your approval.
      </footer>
    </div>
  );
}
