"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ConnectGoogle } from "@/components/connect-google";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useMe, usePreferences } from "@/hooks/use-calendar-data";
import type { MeResponse, PreferenceDTO } from "@/lib/api-types";
import { fetchJson, isGoogleAccessError, type ApiError } from "@/lib/fetcher";
import type { WorkingHours } from "@/lib/scheduling/rules";
import { WEEKDAYS } from "@/lib/time";
import { cn } from "@/lib/utils";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

function ScheduleCard({ me, onSaved }: { me: MeResponse; onSaved: (me: MeResponse) => void }) {
  const [timezone, setTimezone] = useState(me.timezone);
  const [hours, setHours] = useState<WorkingHours>(me.workingHours);
  const [focus, setFocus] = useState(me.goals.focusHoursPerDay);
  const [maxMeetings, setMaxMeetings] = useState(me.goals.maxMeetingHoursPerWeek);
  const [saving, setSaving] = useState(false);
  const zones = useMemo(() => {
    const all = Intl.supportedValuesOf("timeZone");
    return all.includes(me.timezone) ? all : [me.timezone, ...all];
  }, [me.timezone]);

  async function save() {
    setSaving(true);
    try {
      const next = await fetchJson<MeResponse>("/api/me", {
        method: "PATCH",
        body: JSON.stringify({
          timezone,
          workingHours: hours,
          goals: { focusHoursPerDay: focus, maxMeetingHoursPerWeek: maxMeetings },
        }),
      });
      onSaved(next);
      toast.success("Saved.");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const toggleDay = (d: (typeof WEEKDAYS)[number]) =>
    setHours((h) => ({ ...h, days: h.days.includes(d) ? h.days.filter((x) => x !== d) : [...h.days, d] }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Schedule</CardTitle>
        <CardDescription>Kairos only proposes meetings inside your working hours.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-1.5">
          <Label htmlFor="tz">Time zone</Label>
          <select id="tz" className={selectClass} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="start">Day starts</Label>
            <Input id="start" type="time" value={hours.start} onChange={(e) => setHours((h) => ({ ...h, start: e.target.value }))} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="end">Day ends</Label>
            <Input id="end" type="time" value={hours.end} onChange={(e) => setHours((h) => ({ ...h, end: e.target.value }))} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label>Working days</Label>
          <div className="flex flex-wrap gap-1.5">
            {[...WEEKDAYS.slice(1), WEEKDAYS[0]].map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={hours.days.includes(d)}
                onClick={() => toggleDay(d)}
                className={cn(
                  "h-8 w-11 rounded-lg border text-sm capitalize",
                  hours.days.includes(d) ? "border-brand bg-brand/10 font-medium" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="focus">Focus goal (h/day)</Label>
            <Input id="focus" type="number" min={0} max={8} step={0.5} value={focus} onChange={(e) => setFocus(Number(e.target.value))} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="max">Meeting cap (h/week)</Label>
            <Input id="max" type="number" min={0} max={80} value={maxMeetings} onChange={(e) => setMaxMeetings(Number(e.target.value))} />
          </div>
        </div>
        <Button className="w-fit" onClick={save} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />} Save
        </Button>
      </CardContent>
    </Card>
  );
}

function RulesCard() {
  const { data: rules, mutate, isLoading } = usePreferences();
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setAdding(true);
    try {
      const rule = await fetchJson<PreferenceDTO>("/api/preferences", { method: "POST", body: JSON.stringify({ text }) });
      await mutate([...(rules ?? []), rule], { revalidate: false });
      setText("");
      toast.success(rule.rule.type === "note" ? "Saved as a note for Kairos." : `Rule added: ${rule.description}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function toggle(rule: PreferenceDTO, active: boolean) {
    await mutate(rules?.map((r) => (r.id === rule.id ? { ...r, active } : r)), { revalidate: false });
    await fetchJson(`/api/preferences/${rule.id}`, { method: "PATCH", body: JSON.stringify({ active }) }).catch((err) => {
      toast.error((err as Error).message);
      void mutate();
    });
  }

  async function remove(rule: PreferenceDTO) {
    await mutate(rules?.filter((r) => r.id !== rule.id), { revalidate: false });
    await fetchJson(`/api/preferences/${rule.id}`, { method: "DELETE" }).catch((err) => {
      toast.error((err as Error).message);
      void mutate();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rules</CardTitle>
        <CardDescription>
          Preferences Kairos enforces whenever it looks for time. Add them here or just tell the agent, e.g. “never before 10 on Fridays”.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={add} className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Keep 2–4pm free for deep work on weekdays"
            aria-label="New rule"
          />
          <Button type="submit" disabled={adding || !text.trim()}>
            {adding ? <Loader2 className="animate-spin" /> : <Plus />} Add
          </Button>
        </form>
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : rules?.length ? (
          <ul className="divide-y rounded-lg border">
            {rules.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-medium", !r.active && "text-muted-foreground line-through")}>{r.description}</p>
                  {r.rule.type !== "note" && r.ruleText !== r.description && (
                    <p className="truncate text-xs text-muted-foreground">“{r.ruleText}”</p>
                  )}
                </div>
                <Switch checked={r.active} onCheckedChange={(v) => toggle(r, v)} aria-label={r.active ? "Pause rule" : "Resume rule"} />
                <Button variant="ghost" size="icon-sm" onClick={() => remove(r)} aria-label="Delete rule">
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No rules yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

export function SettingsView() {
  const { data: me, error, mutate } = useMe();
  if (error && isGoogleAccessError(error)) return <ConnectGoogle message={(error as ApiError).message} />;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        {error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : me ? (
          <ScheduleCard key={me.timezone + me.workingHours.start} me={me} onSaved={(next) => mutate(next, { revalidate: false })} />
        ) : (
          <Skeleton className="h-80 w-full" />
        )}
        <RulesCard />
      </div>
    </div>
  );
}
