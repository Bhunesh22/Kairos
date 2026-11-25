import { addDaysToLocalDate } from "@/lib/time";

/**
 * A realistic two-week schedule for new Kairos-calendar users, so the agent
 * and the daily brief have something to work with from the first minute.
 * Deliberately includes a conflict, a back-to-back run, meetings without an
 * agenda and an external call. Attendees use reserved example domains.
 */

export type SampleEvent = {
  title: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  attendees: { email: string; name: string }[];
  meet: boolean;
};

const P = {
  priya: { email: "priya.sharma@example.com", name: "Priya Sharma" },
  rahul: { email: "rahul.verma@example.com", name: "Rahul Verma" },
  alex: { email: "alex.chen@example.com", name: "Alex Chen" },
  sam: { email: "sam.lee@example.com", name: "Sam Lee" },
  maria: { email: "maria.garcia@acme-corp.example", name: "Maria Garcia" },
};
const TEAM = [P.priya, P.rahul, P.alex];

type Template = Omit<SampleEvent, "start" | "end"> & { day: number; from: string; to: string; weeks?: number[] };

const TEMPLATES: Template[] = [
  // Every weekday
  ...[0, 1, 2, 3, 4].map(
    (day): Template => ({ day, from: "09:30", to: "09:45", title: "Daily standup", description: "Yesterday · today · blockers", attendees: TEAM, meet: true }),
  ),
  // Monday
  {
    day: 0,
    from: "10:00",
    to: "11:00",
    title: "Sprint planning",
    description: "1. Review last sprint\n2. Capacity\n3. Commit to sprint goals",
    attendees: [...TEAM, P.sam],
    meet: true,
  },
  { day: 0, from: "15:00", to: "15:30", title: "1:1 Rahul / me", attendees: [P.rahul], meet: true },
  // Tuesday: a back-to-back afternoon
  { day: 1, from: "11:00", to: "11:30", title: "1:1 Priya / me", description: "Roadmap priorities for next quarter", attendees: [P.priya], meet: true },
  { day: 1, from: "13:00", to: "14:00", title: "Lunch & learn: AI tooling", attendees: TEAM, meet: true, weeks: [0] },
  { day: 1, from: "14:00", to: "15:00", title: "Design review: onboarding flow", attendees: [P.alex, P.priya], meet: true },
  { day: 1, from: "15:00", to: "15:30", title: "Bug triage", attendees: [P.rahul, P.sam], meet: true },
  // Wednesday: a conflict
  { day: 2, from: "14:00", to: "15:00", title: "Product sync", description: "Metrics review and launch checklist", attendees: [P.priya, P.rahul], meet: true },
  { day: 2, from: "14:30", to: "15:00", title: "Hiring debrief", attendees: [P.sam], meet: true, weeks: [0] },
  // Thursday: focus time and an external call
  { day: 3, from: "10:00", to: "12:00", title: "Focus: pricing deck", attendees: [], meet: false },
  {
    day: 3,
    from: "16:00",
    to: "16:45",
    title: "Customer call: Acme onboarding",
    description: "Walk through the rollout plan and open questions from Acme's IT team.",
    attendees: [P.maria, P.priya],
    meet: true,
  },
  // Friday
  { day: 4, from: "12:00", to: "13:00", title: "Team lunch", location: "Cafeteria, 3rd floor", attendees: TEAM, meet: false },
  { day: 4, from: "16:00", to: "16:30", title: "Weekly wrap-up", attendees: [...TEAM, P.sam], meet: true },
];

/** Events for the week starting `monday` and the week after, as local wall-clock times. */
export function buildSampleWeeks(monday: string): SampleEvent[] {
  return [0, 1].flatMap((week) =>
    TEMPLATES.filter((t) => !t.weeks || t.weeks.includes(week)).map((t) => {
      const date = addDaysToLocalDate(monday, week * 7 + t.day);
      return {
        title: t.title,
        description: t.description,
        location: t.location,
        attendees: t.attendees,
        meet: t.meet,
        start: `${date}T${t.from}`,
        end: `${date}T${t.to}`,
      };
    }),
  );
}
