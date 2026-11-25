# Kairos

Kairos is an AI-native layer on top of Google Calendar. You say what you want, and it schedules, protects, prepares and reviews your time for you.

**Live app:** https://kairos-sigma-neon.vercel.app

Anyone can sign up with email and get a Kairos calendar, pre-filled with a sample week if they want one. *Continue with Google* syncs your real Google Calendar, but only for invited testers while the Google OAuth app is in Testing mode.

> The Greeks had two words for time. *Chronos* is clock time, which is what calendars track. *Kairos* is the right moment, which is what this app manages.

The core idea: **calendar-as-ledger → calendar-as-agent.** The user states intent, the agent does the work, the user approves. The full product thinking (personas, the 10X levers, feature map, roadmap) is in [docs/PLAN.md](docs/PLAN.md).

## What works today

| Feature | What it does |
|---|---|
| **Two ways in** | *Continue with Google* syncs your Google Calendar. Anyone else (or anyone who doesn't grant calendar access) gets a **Kairos calendar** stored in Neon, optionally pre-filled with a sample week, with every AI feature below. |
| **Week view** | Live events, colour-coded by type (focus, 1:1, team, external, solo), working hours shaded, "now" line, event details with RSVPs and the video link. |
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
  Google OAuth sign-in ─► session JWT (httpOnly cookie) ─► Google tokens from Neon, refreshed when stale
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
5. **Least privilege.** Scopes are `calendar.events` and `calendar.readonly`, granted once at sign-in.

## Authentication

There's no third-party auth service. Two ways to sign in, both ending in the same session JWT:

| | Who it's for | Calendar |
|---|---|---|
| **Continue with Google** | Google accounts on the OAuth app's test-user list (Google blocks everyone else while the app is in *Testing*) | Their Google Calendar, if they grant calendar access; otherwise a Kairos calendar |
| **Email + password** | Everyone | A Kairos calendar (`local_events` in Neon) |

The agent talks to a `CalendarProvider` interface ([lib/calendar/provider.ts](lib/calendar/provider.ts)) with two implementations, `GoogleCalendar` and `LocalCalendar`, so scheduling, approvals, undo, rules and briefs work identically on both. On a Kairos calendar invitations aren't emailed, video links are Jitsi rooms, and other people's availability isn't visible; the agent and the approval cards say so.

Google sign-in, in detail:

```
"Continue with Google" → /api/auth/google            state + PKCE verifier in a 10-min httpOnly cookie
  → Google consent (openid email profile + calendar.events + calendar.readonly, offline access)
  → /api/auth/google/callback
       verify state · exchange code (PKCE) · verify ID token against Google's keys · require both calendar scopes
       upsert users row (Neon) · store refresh/access tokens AES-256-GCM encrypted (google_accounts)
       issue session JWT (HS256, 7 days) in an httpOnly, SameSite=Lax cookie
```

- **Authorization:** [proxy.ts](proxy.ts) verifies the JWT on pages and redirects to `/sign-in`. Every API route calls `getSession()` in [lib/session.ts](lib/session.ts), which verifies the JWT (cookie, or `Authorization: Bearer` for API clients), loads the user from Neon and scopes all queries to that user id.
- **Google tokens:** access tokens are refreshed with the stored refresh token about a minute before expiry. If Google reports the grant revoked or expired, the app shows a one-click **Reconnect** button.
- **CSRF:** the session cookie is `SameSite=Lax`, so browsers don't send it on cross-site POSTs; the OAuth flow uses a `state` parameter and PKCE.
- **Email accounts:** passwords are hashed with scrypt; login compares in constant time and does the same work for unknown emails.
- **Account linking:** a Google sign-in links to an existing email account with the same *Google-verified* address. *Connect Google Calendar* in Settings links Google to the signed-in account and switches it to Google Calendar (Kairos-calendar events stay stored).
- **Sign out** clears the cookie. Tokens stay stored, so signing back in is one click.

## Setup

Prerequisites: Node 24 (`nvm use`), plus accounts on Google Cloud, Neon and Google AI Studio.

### 1. Google Cloud (the only auth setup)
1. Create a project and **enable the Google Calendar API** (APIs & Services → Library).
2. **Google Auth Platform** (OAuth consent screen):
   - **Branding:** app name and support email.
   - **Audience:** External, left in *Testing*. Under **Test users**, add every Google account that will sign in, including interviewers (up to 100).
   - **Data access:** add `https://www.googleapis.com/auth/calendar.events` and `https://www.googleapis.com/auth/calendar.readonly`.
3. **Clients → Create client → Web application**:
   - Authorized JavaScript origin: `http://localhost:3000`
   - Authorized redirect URI: `http://localhost:3000/api/auth/google/callback`
4. Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

When you deploy, add the production origin and `https://<your-domain>/api/auth/google/callback` to the same client, and set `APP_URL`.

### 2. Secrets
Set `AUTH_SECRET` to a random value (`openssl rand -base64 32`). It signs session JWTs and encrypts stored Google tokens; changing it signs everyone out and requires them to reconnect Google.

### 3. Neon
Create a project and copy the **pooled** connection string.

### 4. Gemini
Create an API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

### 5. Run it
```bash
cp .env.example .env         # fill in the values
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
  sign-in                      "Continue with Google"
  api/auth/google(/callback)   OAuth start + callback; api/auth/logout
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
lib/auth/                      JWT sessions, Google OAuth (PKCE), token encryption, account storage
proxy.ts                       JWT gate for pages (Next.js 16's renamed middleware)
```

## Known limits

- **Other people's availability** is only visible when their calendar is shared with you (for example, the same Google Workspace). Otherwise slots reflect your availability, and the agent says so.
- **All-day events** are read but not edited by the agent.
- **Chat history** lives in the browser tab. The action log persists.
- **Kairos calendars** don't email invites or see attendees' availability, and there's no password reset or login rate limiting yet.
- **OAuth Testing mode**: only listed test users can sign in, and Google expires refresh tokens after 7 days. Kairos detects this and asks for one-click reconnect.

## Next up

From [docs/PLAN.md](docs/PLAN.md): Focus Defrag (batch proposals that free 2-hour blocks), tasks → time blocks, the Insights page (time by category, meeting cost), a proactive suggestions inbox with Vercel Cron, chat persistence, and an eval set of tricky prompts (relative dates, time zones, ambiguous names).
