"use client";

import { AlertTriangle, ClipboardList, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { useAgent } from "@/components/agent/agent-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { BriefContent } from "@/lib/brief-types";
import { fetchJson } from "@/lib/fetcher";
import { formatHours } from "@/lib/scheduling/find-slots";

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="flex flex-col rounded-lg bg-muted/60 px-2.5 py-1.5">
      <span className={tone === "warn" ? "font-semibold text-warning tabular-nums" : "font-semibold tabular-nums"}>{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export function DailyBrief() {
  const { ask } = useAgent();
  const { data, error, isLoading, mutate } = useSWR<BriefContent>("/api/brief", { revalidateOnFocus: false });
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      await mutate(fetchJson<BriefContent>("/api/brief?refresh=1"), { revalidate: false });
    } finally {
      setRefreshing(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border p-4">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  if (error || !data) {
    return <p className="rounded-xl border p-4 text-sm text-muted-foreground">Couldn&apos;t load today&apos;s brief.</p>;
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4" aria-label="Daily brief">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium text-brand">
            <Sparkles className="size-3.5" /> Today&apos;s brief
          </p>
          <h2 className="mt-1 text-base font-semibold text-balance">{data.headline}</h2>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={refresh} disabled={refreshing} aria-label="Regenerate brief">
          <RefreshCw className={refreshing ? "animate-spin" : undefined} />
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{data.summary}</p>

      <div className="grid grid-cols-3 gap-1.5 text-sm">
        <Stat label="meetings" value={String(data.stats.meetings)} />
        <Stat label="in meetings" value={formatHours(data.stats.meetingMinutes)} />
        <Stat
          label="focus time"
          value={formatHours(data.stats.focusMinutes)}
          tone={data.stats.focusMinutes < 60 && data.stats.meetings > 0 ? "warn" : undefined}
        />
      </div>

      {data.headsUp.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {data.headsUp.map((h) => (
            <li key={h} className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" /> {h}
            </li>
          ))}
        </ul>
      )}

      {data.prep.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">Prep needed</p>
          {data.prep.map((p) => (
            <button
              key={p.eventId}
              type="button"
              onClick={() => ask(`Prepare me for “${p.title}” at ${p.time} today.`)}
              className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              <ClipboardList className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span>
                <span className="font-medium">{p.title}</span> <span className="text-muted-foreground tabular-nums">· {p.time}</span>
                <span className="block text-xs text-muted-foreground">{p.note}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {data.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {data.suggestions.map((s) => (
            <Button key={s.label} size="sm" variant="outline" onClick={() => ask(s.prompt)}>
              {s.label}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}
