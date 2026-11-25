# Kairos: your AI chief of staff for time

**Name:** **Kairos.** The Greeks had two words for time. *Chronos* is clock time, which is what calendars track today. *Kairos* is the right moment, which is what this app manages.

**One-liner:** Kairos is an AI-native layer on top of Google Calendar. You say what you want, and it schedules, protects, prepares and reviews your time for you.

**Description (README / deck):**

> Business users lose hours every week to calendar admin: scheduling back and forth, juggling conflicts, walking into meetings unprepared, and watching focus time get cut into 30-minute scraps. Kairos turns Google Calendar from a passive grid into an active agent. You say *"Find 45 minutes with Priya and Rahul next week, mornings only, add a Meet link."* Kairos reads your calendar, applies your preferences, finds the best slots and books the meeting once you approve. Each morning it briefs you on your day, prepares you for each meeting, and protects time for the work that matters.

## 1. What the problem statement is asking

**Today:** Google Calendar is a **record of commitments**, basically a database with a grid on top. The user does all the thinking and work: finding slots, agreeing on times, fixing conflicts, preparing, following up.

**AI-native means reversing that:** **the user states intent, the agent does the work, the user approves.** The AI is the main way you use the calendar, not a chatbot added to the side.

**Your interview framing:** *"From calendar-as-ledger to calendar-as-agent."*

### Who the "business user" is

| Persona                 | Core pain                                                                 |
| ----------------------- | ------------------------------------------------------------------------- |
| Manager / team lead     | Back-to-back meetings, no time to think, constant reshuffling             |
| Sales / customer-facing | Scheduling with external people across time zones, prep before every call |
| IC (engineer / PM)      | Broken-up focus time, meetings with no agenda                             |
| Executive               | Needs a "chief of staff" who sets priorities and gives briefings          |

### Where the 10X comes from (three levers)

1. **Calendar admin time drops to near zero.** A scheduling email thread becomes one sentence and one click. Conflicts get resolved for you.
2. **Meetings get better.** Every meeting has an agenda, a prep brief and follow-ups.
3. **Deep work gets protected.** The agent consolidates your week into larger free blocks and fits your tasks into them by priority.

Bonus lever: **visibility.** For the first time you can see where your time actually goes compared with your goals.

The framework to present is the **meeting lifecycle**: Schedule → Prepare → Protect → Follow up → Reflect. Each feature below fits one of these stages.

---

## 2. Features that make it 10X

### P0: core agent (must demo)

| # | Feature                               | What it does                                                                                                   | Example                                         |
| - | ------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1 | **AI Command Bar (⌘K) + chat** | Creates, moves, cancels and queries events in natural language, across multiple steps                          | "Push my 3pm to tomorrow, same time"            |
| 2 | **Smart Scheduler**             | Checks attendees' free/busy, time zones, working hours and your rules, then offers 3 ranked slots with reasons | "45 min with Priya & Rahul next week, mornings" |
| 3 | **Approval cards + Undo**       | The agent proposes every change and you approve it. Every action is logged and can be reversed                 | "Undo that"                                     |
| 4 | **Preference memory**           | Remembers rules and applies them to every decision                                                             | "No meetings before 10 on Fridays"              |
| 5 | **Daily Brief**                 | Morning summary: agenda, conflicts, prep needed, free focus time, suggested fixes                              | Shown on open, or at 8am                        |

### P1: differentiators (build if time allows)

| #  | Feature                        | What it does                                                                                                                  |
| -- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 6  | **Focus Defrag**         | Spots days broken into small gaps and proposes moving flexible meetings to free up 2-hour deep-work blocks                    |
| 7  | **Tasks → time blocks** | "Pricing deck (3h) due Thu, 2 PR reviews (1h)" gets scheduled into free slots by priority and deadline                        |
| 8  | **Meeting Prep Brief**   | For each meeting: purpose, attendees, past meetings with these people, open items, suggested agenda                           |
| 9  | **Meeting hygiene**      | Flags meetings with no agenda and drafts one, suggests 25/50-min lengths, adds buffers between back-to-back meetings          |
| 10 | **Time Insights**        | AI sorts events into categories (1:1, team, external, focus, admin) and shows charts, e.g. "62% in meetings vs your 40% goal" |
| 11 | **Meeting cost**         | Attendees × duration × hourly rate, e.g. "This weekly sync costs ~X/month." A strong business-user angle                    |

### P2: vision (roadmap slide)

- **Proactive agent:** watches for calendar changes (Google push notifications) and adds suggestions to an inbox, e.g. "Rahul declined. Reschedule?"
- **Post-meeting follow-through:** notes or transcript become action items, tasks, a follow-up email and the next meeting.
- **External negotiation:** the agent emails options to external guests and books the slot they reply with.
- **Team mode:** org-wide meeting load, no-meeting days, shared focus windows.
- **Recurring-meeting audits:** "This weekly has had no agenda for 6 weeks. Make it biweekly?"
- Voice input, and travel or commute buffers.

---

## 3. Architecture

```
┌─────────────────────── Browser (Next.js client) ───────────────────────┐
│ Week/Day calendar · ⌘K command bar · Chat · Approval cards · Insights  │
└───────────────────────────────┬────────────────────────────────────────┘
                                │ streaming (AI SDK) / server actions
┌───────────────────────────────▼────────────────────────────────────────┐
│                     Next.js server (route handlers)                    │
│  Clerk auth ──► Google OAuth access token                              │
│  Agent orchestrator (Gemini + tools)                                   │
│     ├── Calendar tools ─────────► Google Calendar API v3               │
│     ├── Scheduling engine (deterministic slot finder, TZ math)         │
│     └── Memory tools ───────────► Neon Postgres (Drizzle)              │
│  Vercel Cron ──► daily brief · sync · proactive suggestions            │
└────────────────────────────────────────────────────────────────────────┘
```

| Layer         | Choice                                                      | Why                                                                                                         |
| ------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Framework     | Next.js (App Router) + TypeScript                           | One codebase for client and server: server components, route handlers, server actions                       |
| UI            | Tailwind + shadcn/ui + FullCalendar (or a custom week grid) | Fast to build and looks polished                                                                            |
| Auth          | Clerk with Google sign-in + Calendar scopes                 | Clerk stores and refreshes Google tokens, so you never store them yourself                                  |
| Google        | `googleapis` (Calendar v3)                                | `events.list/insert/patch/delete`, `freebusy.query`                                                     |
| AI            | Gemini via Vercel AI SDK (`ai` + `@ai-sdk/google`)      | Tool-calling loop, streaming and the `useChat` hook out of the box. `@google/genai` directly also works |
| DB            | Neon Postgres + Drizzle ORM                                 | Serverless Postgres. pgvector is available later for semantic memory                                        |
| Jobs / deploy | Vercel Cron + Vercel                                        | Neon has a native Vercel integration                                                                        |

### Agent design (the part to spend most time on in the interview)

**Tools**

- **Read tools (run automatically):** `get_events`, `get_free_busy`, `find_free_slots`, `search_contacts`, `get_preferences`, `get_time_insights`
- **Write tools (need approval):** `create_event`, `update_event`, `delete_event`, `schedule_tasks`, `save_preference`

**Principles**

1. **The LLM handles intent and judgment; code handles the math.** Gemini pulls out the constraints (next week, mornings, 45 min). A deterministic slot-finder works out availability. Gemini then ranks and explains the options. LLMs get date arithmetic wrong, so never let them do it.
2. **A human approves every write.** Reads run on their own. Writes return a *proposal* that the UI shows as an approval card. Nothing changes in the calendar without a click. Later this can become per-user autonomy levels.
3. **Ground every call.** The system prompt always includes the current datetime, the user's time zone, working hours and saved rules. All times are ISO 8601 with an offset, and all tool inputs are validated with Zod.
4. **Log every action and allow undo.** Each executed action stores its before and after state.
5. **Google is the source of truth.** Neon caches events for analytics, briefs and resolving names to emails.

**Example flow:** "45 min with Priya and Rahul next week, mornings, avoid Friday"

1. `search_contacts("Priya")`, `search_contacts("Rahul")` find their emails from past attendees.
2. `get_preferences()` loads rules such as "no meetings before 10 on Fridays".
3. `find_free_slots({attendees, duration: 45, range, window: "09:00–12:00", exclude: ["Fri"]})` returns candidate slots (computed in code).
4. Gemini picks the top 3 with reasons, e.g. "Tue 10:00 keeps your afternoon focus block intact."
5. The UI shows an approval card. The user picks a slot, `create_event` runs with a Meet link and an AI-drafted agenda, the action is logged, and the calendar refreshes.

### Getting the Google token through Clerk

```ts
const { userId } = await auth();
const client = await clerkClient();
const { data } = await client.users.getUserOauthAccessToken(userId!, 'google');

const oauth = new google.auth.OAuth2();
oauth.setCredentials({ access_token: data[0]?.token });
const calendar = google.calendar({ version: 'v3', auth: oauth });
```

### Database schema (Neon)

```
users            id (Clerk ID), email, timezone, working_hours jsonb, goals jsonb, created_at
preferences      id, user_id, rule_text, rule jsonb, active, created_at
events_cache     id, user_id, google_event_id, calendar_id, title, start_at, end_at,
                 attendees jsonb, category, is_flexible, priority, etag, updated_at
contacts         id, user_id, name, email, last_met_at, meeting_count
tasks            id, user_id, title, est_minutes, deadline, priority, status, event_id
conversations    id, user_id, created_at
messages         id, conversation_id, role, content jsonb, created_at
agent_actions    id, user_id, tool, input jsonb, before jsonb, after jsonb,
                 status (proposed|executed|rejected|undone), created_at
briefs           id, user_id, type (daily|meeting), ref_id, content jsonb, generated_at
sync_state       user_id, calendar_id, sync_token, last_synced_at
```

### Folder structure

```
kairos/
├─ app/
│  ├─ (auth)/sign-in/[[...sign-in]]/page.tsx
│  ├─ (app)/calendar/page.tsx        # main week view + command bar
│  ├─ (app)/insights/page.tsx
│  ├─ (app)/settings/page.tsx        # working hours, rules, goals
│  ├─ api/chat/route.ts              # agent endpoint (streaming)
│  ├─ api/actions/[id]/route.ts      # approve / reject / undo
│  └─ api/cron/daily-brief/route.ts
├─ components/  calendar/ · command-bar/ · approval-card/ · brief/ · ui/
├─ lib/
│  ├─ google/calendar.ts             # typed wrapper over Calendar API
│  ├─ agent/tools.ts · agent/prompt.ts
│  ├─ scheduling/find-slots.ts       # deterministic engine + tests
│  ├─ db/schema.ts · db/index.ts
│  └─ time.ts                        # TZ helpers
├─ middleware.ts                     # Clerk (named proxy.ts on Next.js 16+)
└─ drizzle.config.ts
```

---

## 4. Development flow, step by step

This assumes about a week. Compress as needed.

**Phase 0: Product framing (½ day)**

- Write personas, jobs to be done, the 10X thesis, the P0/P1/P2 list and success metrics. This becomes your thought-process doc.

**Phase 1: Setup (½ day)**

```bash
npx create-next-app@latest kairos --typescript --tailwind --app --eslint
cd kairos && npx shadcn@latest init
npm i @clerk/nextjs googleapis ai @ai-sdk/google zod drizzle-orm @neondatabase/serverless date-fns @date-fns/tz
npm i -D drizzle-kit
```

- **Google Cloud:** create a project, enable the Calendar API, and set up the OAuth consent screen (External, *Testing*). Add the scopes `calendar.events` and `calendar.readonly`. **Add test users.** Create a Web OAuth client.
- **Clerk:** enable Google sign-in with **custom credentials**, paste in the client ID and secret, add the Calendar scopes, and set the redirect URI in Google Cloud.
- **Neon:** create the project, copy `DATABASE_URL`, write the Drizzle schema, run `drizzle-kit push`.
- **Gemini:** create a key in Google AI Studio and set it as `GOOGLE_GENERATIVE_AI_API_KEY`.
- **`.env.local`:** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `DATABASE_URL`, `GOOGLE_GENERATIVE_AI_API_KEY`, `CRON_SECRET`

**Phase 2: Calendar foundation (1 day)**

- Clerk sign-in, a protected `/calendar` route, and a `getOrCreateUser()` helper that saves the user's time zone.
- `lib/google/calendar.ts` with typed `listEvents`, `createEvent` (including a Meet link), `updateEvent`, `deleteEvent` and `freeBusy`.
- Week and day view showing real events. Basic manual create, drag and edit.
- Cache events in Neon and build `contacts` from past attendees.

**Phase 3: Agent core (1.5 days)**

- `/api/chat` running Gemini with tools, streaming, and a step limit of about 6.
- System prompt with the current time, time zone, working hours and rules.
- The ⌘K command bar and a chat panel.
- Read tools first, then write tools returning proposals, then the approval card, then execute, log and undo.
- `find-slots.ts`: merge busy intervals, apply the working-hours window and rules, score candidates. **Write unit tests for this.**

**Phase 4: Smart features (1.5 days)**

- Preference memory: save a rule from chat, show it in Settings, apply it in slot-finding.
- Daily Brief: one Gemini call over today's events with structured JSON output, rendered as a card.
- Meeting Prep Brief on event click.
- Focus Defrag and task auto-scheduling. Both reuse the slot engine and return a batch proposal.
- Insights page: AI-categorized events, charts, and a meeting-cost estimate.

**Phase 5: Proactive layer (½ day, optional)**

- Vercel Cron generates the daily brief and refreshes the sync.
- A suggestions inbox for detected conflicts and fragmented days.

**Phase 6: Polish, test, ship (1 day)**

- An eval set of 20–30 prompts covering relative dates, time zones, ambiguous names and conflicts. Run it and fix the failures.
- Loading, empty and error states, plus keyboard shortcuts.
- Deploy to Vercel with Neon. Seed a demo calendar.
- Record a 3-minute demo and finish the write-up.

---

## 5. Gotchas that will bite you

- **OAuth Testing mode:** only listed test users (up to 100) can sign in. **Add the interviewers' emails before you share the link.** Refresh tokens in Testing mode expire after 7 days. Calendar scopes are "sensitive" and need Google verification for production, but you can skip that for a prototype.
- **Clerk dev instances** use shared Google credentials that can't request extra scopes. You need your own custom credentials.
- **Free/busy for other people** only works if their calendar is visible to you, for example in the same Workspace org or shared with you. For external attendees, fall back to your own availability plus their time zone and propose options. That limitation is also a good talking point.
- **Meet links** need `conferenceData.createRequest` plus `conferenceDataVersion: 1`.
- **Time zones:** store UTC, display in the user's time zone, and never let the model calculate offsets.
- **Limits:** Vercel functions have timeouts, so stream responses and cap agent steps. Gemini rate limits are low on the free tier, so use a Flash model for the tool loop and cache briefs.

---

## 6. What to submit as the "thought process"

**Doc / deck outline:** problem → personas → the "ledger to agent" insight → feature map across the meeting lifecycle → prioritization (why P0 is P0) → architecture and agent design principles → trust and safety (approvals, undo, least-privilege scopes) → metrics → roadmap.

**Metrics to propose:** time to schedule a meeting, % of meetings created through the agent, suggestion acceptance rate, undo rate (a proxy for agent errors), focus hours gained per week, meeting hours reduced.

**3-minute demo script:**

1. Sign in with Google and see your real week.
2. The Daily Brief flags a conflict and suggests a fix.
3. "Find 30 min with Priya next week for roadmap review, mornings." An approval card appears; click it and the event shows up with a Meet link and agenda.
4. "I need 3h for the pricing deck before Thursday." It gets blocked into your calendar.
5. "Protect 2 focus hours every day." Defrag proposals appear.
6. "Where did my time go last week?" Insights and meeting cost appear.
7. "Undo that."
