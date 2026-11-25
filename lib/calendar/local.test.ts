import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/test/pg";

// Real Postgres semantics (PGlite) for the Kairos calendar, accounts and the approval flow.
const h = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/sync", () => ({ syncIfStale: vi.fn() }));

const { LocalCalendar } = await import("./local");
const { buildSampleWeeks } = await import("./sample-week");
const { createPasswordUser, resolveGoogleUser, findUserByEmail } = await import("@/lib/auth/accounts");
const { hashPassword, verifyPassword } = await import("@/lib/auth/password");
const { approveAction, undoAction } = await import("@/lib/agent/actions");
const { createTools } = await import("@/lib/agent/tools");
const { parseLocal, toLocal } = await import("@/lib/time");
type User = import("@/lib/db/schema").User;

const TZ = "Asia/Kolkata";
const at = (local: string) => parseLocal(local, TZ);
let n = 0;

async function newUser(name = "Asha"): Promise<User> {
  const user = await createPasswordUser({ email: `User${n++}@Example.com`, name, passwordHash: "x", timezone: TZ });
  if (!user) throw new Error("user not created");
  return user;
}

beforeAll(async () => {
  h.db = await createTestDb();
}, 30_000);

describe("LocalCalendar", () => {
  it("creates, reads, searches, moves and deletes events", async () => {
    const user = await newUser();
    const cal = new LocalCalendar(user);
    const created = await cal.createEvent({
      title: "Roadmap review",
      start: at("2030-03-05T10:00"),
      end: at("2030-03-05T10:30"),
      attendees: ["Priya@Example.com", "priya@example.com", user.email],
      addMeetLink: true,
      timeZone: TZ,
    });
    expect(created.meetLink).toMatch(/^https:\/\/meet\.jit\.si\/Kairos-/);
    expect(created.attendees.map((a) => [a.email, !!a.self])).toEqual([
      [user.email, true],
      ["priya@example.com", false],
    ]);

    const day = await cal.listEvents({ timeMin: at("2030-03-05T00:00"), timeMax: at("2030-03-06T00:00") });
    expect(day.map((e) => e.title)).toEqual(["Roadmap review"]);
    expect(await cal.listEvents({ timeMin: at("2030-03-05T00:00"), timeMax: at("2030-03-06T00:00"), query: "priya" })).toHaveLength(1);
    expect(await cal.listEvents({ timeMin: at("2030-03-05T00:00"), timeMax: at("2030-03-06T00:00"), query: "nobody" })).toHaveLength(0);

    const moved = await cal.patchEvent(created.id, { start: at("2030-03-06T11:00"), end: at("2030-03-06T11:30"), title: "Roadmap", timeZone: TZ });
    expect(toLocal(new Date(moved.start), TZ)).toBe("2030-03-06T11:00");
    expect(moved.title).toBe("Roadmap");

    await cal.deleteEvent(created.id);
    await expect(cal.getEvent(created.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(cal.getEvent("not-a-uuid")).rejects.toMatchObject({ code: "not_found" });
  });

  it("keeps users' calendars isolated", async () => {
    const a = new LocalCalendar(await newUser());
    const b = new LocalCalendar(await newUser());
    const event = await a.createEvent({ title: "Private", start: at("2030-04-01T09:00"), end: at("2030-04-01T10:00"), attendees: [], addMeetLink: false, timeZone: TZ });
    await expect(b.getEvent(event.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(b.patchEvent(event.id, { title: "Hacked", timeZone: TZ })).rejects.toMatchObject({ code: "not_found" });
    await b.deleteEvent(event.id);
    expect((await a.getEvent(event.id)).title).toBe("Private");
  });

  it("reports only the owner's busy time; other people are unavailable", async () => {
    const user = await newUser();
    const cal = new LocalCalendar(user);
    await cal.createEvent({ title: "Busy", start: at("2030-05-01T10:00"), end: at("2030-05-01T11:00"), attendees: [], addMeetLink: false, timeZone: TZ });
    const fb = await cal.freeBusy({ timeMin: at("2030-05-01T00:00"), timeMax: at("2030-05-02T00:00"), emails: ["Rahul@example.com", user.email] });
    expect(fb.busy.get("primary")).toHaveLength(1);
    expect(fb.unavailable).toEqual(["rahul@example.com"]);
  });

  it("seeds a sample fortnight and removes only sample events", async () => {
    const user = await newUser();
    const cal = new LocalCalendar(user);
    const now = at("2030-03-06T12:00"); // a Wednesday
    const count = await cal.seedSampleEvents(now);
    expect(count).toBe(buildSampleWeeks("2030-03-04").length);
    const week = await cal.listEvents({ timeMin: at("2030-03-04T00:00"), timeMax: at("2030-03-18T00:00"), max: 500 });
    expect(week).toHaveLength(count);
    expect(week.some((e) => e.title === "Hiring debrief")).toBe(true); // the deliberate conflict

    await cal.createEvent({ title: "Mine", start: at("2030-03-07T18:00"), end: at("2030-03-07T19:00"), attendees: [], addMeetLink: false, timeZone: TZ });
    expect(await cal.deleteSampleEvents()).toBe(count);
    const left = await cal.listEvents({ timeMin: at("2030-03-04T00:00"), timeMax: at("2030-03-18T00:00") });
    expect(left.map((e) => e.title)).toEqual(["Mine"]);
  });
});

describe("agent approval flow on a Kairos calendar", () => {
  it("proposes, books and undoes an event end to end", async () => {
    const user = await newUser();
    const cal = new LocalCalendar(user);
    const session = { userId: user.id, user, calendar: cal };
    const tools = createTools(session, []);
    const opts = { toolCallId: "c1", messages: [], context: {} } as never;

    const proposal = (await tools.propose_create_event.execute!(
      { title: "Roadmap review", attendees: ["priya@example.com"], options: [{ start: "2030-06-04T10:00", end: "2030-06-04T10:30" }] },
      opts,
    )) as { actionId: string; proposal: { warnings?: string[]; addMeetLink: boolean } };
    expect(proposal.proposal.warnings?.join(" ")).toMatch(/don't email invites/);
    expect(proposal.proposal.addMeetLink).toBe(true);

    const booked = await approveAction(session, proposal.actionId, { optionIndex: 0 });
    expect(booked).toMatchObject({ status: "executed", resultLabel: "Tue, Jun 4 · 10:00–10:30" });
    const [event] = await cal.listEvents({ timeMin: at("2030-06-04T00:00"), timeMax: at("2030-06-05T00:00") });
    expect(event.title).toBe("Roadmap review");
    await expect(approveAction(session, proposal.actionId)).rejects.toMatchObject({ code: "conflict" }); // no double booking

    const move = (await tools.propose_update_event.execute!({ eventId: event.id, newStart: "2030-06-05T15:00" }, opts)) as { actionId: string };
    await approveAction(session, move.actionId);
    expect(toLocal(new Date((await cal.getEvent(event.id)).start), TZ)).toBe("2030-06-05T15:00");

    await undoAction(session, move.actionId);
    expect(toLocal(new Date((await cal.getEvent(event.id)).start), TZ)).toBe("2030-06-04T10:00");

    await undoAction(session, proposal.actionId);
    await expect(cal.getEvent(event.id)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("accounts", () => {
  it("hashes and verifies passwords", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
    expect(await verifyPassword("anything", "garbage")).toBe(false);
  });

  it("stores emails lower-case and refuses duplicates", async () => {
    const first = await createPasswordUser({ email: "Dup@Example.com", name: "A", passwordHash: "x" });
    expect(first?.email).toBe("dup@example.com");
    expect(await createPasswordUser({ email: "dup@example.com", name: "B", passwordHash: "y" })).toBeUndefined();
  });

  it("gives Google users without calendar access a Kairos calendar", async () => {
    const { user, created } = await resolveGoogleUser(
      { sub: "g-new", email: "newbie@gmail.com", emailVerified: true, name: "New Bie" },
      { accessToken: "t", calendarGranted: false, timezoneHint: "Europe/Berlin" },
    );
    expect(created).toBe(true);
    expect(user).toMatchObject({ calendarProvider: "local", timezone: "Europe/Berlin", googleSub: "g-new" });

    const again = await resolveGoogleUser({ sub: "g-new", email: "newbie@gmail.com", emailVerified: true }, { accessToken: "t", calendarGranted: false });
    expect(again).toMatchObject({ created: false, user: { id: user.id } });
  });

  it("links Google to an email account with the same verified address, and switches to Google Calendar when granted", async () => {
    const pw = await createPasswordUser({ email: "linkme@example.com", name: "Link", passwordHash: "x" });
    const { user, created } = await resolveGoogleUser(
      { sub: "g-link", email: "linkme@example.com", emailVerified: true },
      { accessToken: "t", calendarGranted: true },
    );
    expect(created).toBe(false);
    expect(user).toMatchObject({ id: pw!.id, googleSub: "g-link", calendarProvider: "google", passwordHash: "x" });
  });

  it("connects Google to the signed-in account even with a different email", async () => {
    const me = await createPasswordUser({ email: "work@company.example", name: "Me", passwordHash: "x" });
    const { user } = await resolveGoogleUser(
      { sub: "g-personal", email: "me.personal@gmail.com", emailVerified: true },
      { accessToken: "t", calendarGranted: false, sessionUserId: me!.id },
    );
    expect(user.id).toBe(me!.id);
    expect((await findUserByEmail("work@company.example"))?.googleSub).toBe("g-personal");
  });

  it("never links on an unverified email", async () => {
    await createPasswordUser({ email: "victim@example.com", name: "V", passwordHash: "x" });
    await expect(
      resolveGoogleUser({ sub: "g-attacker", email: "victim@example.com", emailVerified: false }, { accessToken: "t", calendarGranted: false }),
    ).rejects.toThrow();
    expect((await findUserByEmail("victim@example.com"))?.googleSub).toBeNull();
  });
});
