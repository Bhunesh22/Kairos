# Kairos

Kairos is an AI-native layer on top of Google Calendar. You say what you want, and it schedules, protects, prepares and reviews your time for you.

> The Greeks had two words for time. *Chronos* is clock time, which is what calendars track. *Kairos* is the right moment, which is what this app manages.

The core idea: **calendar-as-ledger → calendar-as-agent.** The user states intent, the agent does the work, the user approves. The full product thinking (personas, the 10X levers, feature map, roadmap) is in [docs/PLAN.md](docs/PLAN.md).

## What works today

| Feature | What it does |
|---|---|
| **Week view on your real Google Calendar** | Live events, colour-coded by type (focus, 1:1, team, external, solo), working hours shaded, "now" line, event details with RSVPs and Meet link. |
| **Agent chat + ⌘K command bar** | Natural-language requests across many steps: "Find 30 min with Priya next week, mornings", "Push my 3pm to tomorrow", "Cancel the design review", "What does my week look like?" |
| **Smart scheduler** | A deterministic slot finder that checks attendees' free/busy, working hours and your rules, and ranks slots by fragmentation, day load and focus time. Gemini then explains the ranking. |
| **Approval cards + undo** | The agent can only *propose* calendar changes. You pick a slot and approve; every executed change stores before/after snapshots and can be undone in one click, or by saying "undo that". |
| **Preference memory** | "Never before 10 on Fridays", "15-min buffers", "protect 2–4pm for focus" become structured rules enforced in every slot search. Manage them in Settings. |
| **Daily brief** | Conflicts, back-to-back runs, meetings without an agenda and free focus blocks, computed in code and summarised by Gemini, with one-click fixes. Cached until the day's events change. |
| **Meeting prep** | From any event: a prep brief, a drafted agenda, reschedule or cancel. |

## Architecture

```
Browser (Next.js client)
  Week view · ⌘K bar · Agent panel (useChat) · Approval cards · Daily brief · Settings
        │  streaming UI messages / JSON
Next.js route handlers (app/api/*)
  Clerk auth ─► Google OAuth access token (Clerk stores and refreshes it)
  /api/chat      Gemini tool loop (AI SDK v7 streamText, ≤ 8 steps)
     ├─ read tools  (auto): get_events, get_event, search_contacts, find_free_slots
     └─ write tools (propose only): propose_create/update/delete_event, propose_undo, save_preference
  /api/actions   approve / reject / undo → Google Calendar API, before/after snapshots
  /api/brief     deterministic facts → Gemini structured output → cached in Neon
        │
  Google Calendar API v3 (source of truth)      Neon Postgres via Drizzle (rules, action log, briefs, contacts, event mirror)
```

### Design decisions

1. **The LLM handles intent and judgement; code handles the maths.** Gemini extracts constraints and explains choices. Availability, time zones, rules and scoring live in [lib/scheduling/find-slots.ts](lib/scheduling/find-slots.ts), which is pure and unit-tested.
2. **The model never does time-zone arithmetic.** Tools take and return local wall-clock strings (`2026-12-01T10:00`) in the user's calendar time zone, and the system prompt includes a 15-day date table and explicit "this week / next week" ranges. Only [lib/time.ts](lib/time.ts) converts to instants.
3. **A human approves every write.** Write tools insert a `proposed` row in `agent_actions` and return a card. Approval executes it, with an atomic status claim so double clicks can't book twice, and stores before/after state for undo. The model is told which proposals were approved or rejected on its next turn.
4. **Google is the source of truth.** The UI always reads live from Google. Neon holds what Google doesn't: rules, the action log, briefs, and a 120-day event mirror used to resolve names to emails (and later for insights).
5. **Least privilege.** Scopes are `calendar.events` and `calendar.readonly`. Kairos never stores Google tokens; Clerk does.

## Setup

Prerequisites: Node 24 (`nvm use`), plus accounts on Google Cloud, Clerk, Neon and Google AI Studio.

### 1. Google Cloud
1. Create a project and **enable the Google Calendar API**.
2. **OAuth consent screen**: External, publishing status *Testing*. Add the scopes `https://www.googleapis.com/auth/calendar.events` and `https://www.googleapis.com/auth/calendar.readonly`.
3. **Add test users**: every Google account that will sign in, including interviewers. Testing mode allows up to 100.
4. Create an **OAuth client ID** of type *Web application*. You'll add Clerk's redirect URI to it in the next step.

### 2. Clerk
1. Create an application with **Google** as a sign-in option.
2. Under SSO connections → Google, turn on **Use custom credentials**. Paste the Google client ID and secret, and add the two Calendar scopes above to **Scopes**.
3. Copy Clerk's **Authorized redirect URI** into the Google OAuth client's *Authorized redirect URIs*.

Clerk's shared development credentials can't request extra scopes, so custom credentials are required. If a user signed in before the scopes were added, Kairos shows a **Grant calendar access** button that re-runs Google consent.

### 3. Neon
Create a project and copy the **pooled** connection string.

### 4. Gemini
Create an API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

### 5. Run it
```bash
cp .env.example .env.local   # fill in the values
npm install
npm run db:push              # create tables in Neon
npm run dev                  # http://localhost:3000
```

## Scripts

| Command | |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Unit tests (Vitest): slot finder, DST, brief analysis, prompt grounding, agent tools against a fake Google Calendar, and the full tool loop with a mock model |
| `npm run typecheck` | Generate Next.js route types and run `tsc` |
| `npm run lint` | ESLint |
| `npm run db:push` / `db:studio` | Apply the Drizzle schema / browse the database |

## Project structure

```
app/
  page.tsx                     landing
  (app)/calendar, (app)/settings
  sign-in, sign-up             Clerk
  api/chat                     agent endpoint (streaming)
  api/actions/[id]             approve / reject / undo
  api/events, api/me, api/brief, api/preferences
components/
  calendar/                    week view, overlap layout, event details
  agent/                       provider (shared chat), panel, message parts, approval cards, ⌘K
  brief/, settings/
lib/
  agent/                       tools, system prompt, model, action execution
  scheduling/                  slot finder + rules (pure, tested)
  google/                      typed Calendar API wrapper
  db/                          Drizzle schema + Neon client
  brief.ts, sync.ts, session.ts, time.ts
proxy.ts                       Clerk (Next.js 16's renamed middleware)
```

## Known limits

- **Other people's availability** is only visible when their calendar is shared with you (for example, the same Google Workspace). Otherwise slots reflect your availability, and the agent says so.
- **All-day events** are read but not edited by the agent.
- **Chat history** lives in the browser tab. The action log persists.
- **OAuth Testing mode**: refresh tokens expire after 7 days and only listed test users can sign in.

## Next up

From [docs/PLAN.md](docs/PLAN.md): Focus Defrag (batch proposals that free 2-hour blocks), tasks → time blocks, the Insights page (time by category, meeting cost), a proactive suggestions inbox with Vercel Cron, chat persistence, and an eval set of tricky prompts (relative dates, time zones, ambiguous names).
