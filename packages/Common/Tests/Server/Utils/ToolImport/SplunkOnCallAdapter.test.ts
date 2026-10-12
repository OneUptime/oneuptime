import { describe, expect, test } from "@jest/globals";
import SplunkOnCallAdapter, {
  getMaskDays,
  lineUpWithWhoIsOnCall,
  toLevels,
  toRestriction,
} from "../../../../Server/Utils/ToolImport/Adapters/SplunkOnCall/SplunkOnCallAdapter";
import { ToolImportPeopleIndex } from "../../../../Server/Utils/ToolImport/ToolImportAdapterSupport";
import {
  ToolImportReadContext,
  ToolImportReadError,
} from "../../../../Server/Utils/ToolImport/Types";
import DayOfWeek from "../../../../Types/Day/DayOfWeek";
import EventInterval from "../../../../Types/Events/EventInterval";
import { SPLUNK_ON_CALL_HOST } from "../../../../Types/ToolImport/ToolImportCatalog";
import {
  ToolImportNote,
  ToolImportNoteCode,
} from "../../../../Types/ToolImport/ToolImportNote";
import ToolImportResourceKind from "../../../../Types/ToolImport/ToolImportResourceKind";
import { groupRotationsIntoSchedules } from "../../../../Types/ToolImport/ToolImportScheduleRules";
import {
  ImportedPerson,
  ImportedPolicy,
  ImportedPolicyLevel,
  ImportedRotation,
  ImportedSchedule,
  ToolImportSnapshot,
} from "../../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../../Types/ToolImport/ToolImportSource";
import {
  PAYMENTS_POLICY_SLUG,
  PAYMENTS_ROTATION_SLUG,
  PAYMENTS_TEAM_SLUG,
  PLATFORM_POLICY_SLUG,
  PLATFORM_ROTATIONS,
  PLATFORM_TEAM_SLUG,
  PRIMARY_ROTATION_SLUG,
  shift,
  SPLUNK_API_ID,
  SPLUNK_KEY,
  SPLUNK_USERS,
  splunkOnCallApi,
  SUN_ROTATION_SLUG,
} from "./SplunkOnCallFixtures";
import { FixtureApi, json, RecordingSleep } from "./ToolImportFixtureTransport";

/*
 * The Splunk On-Call adapter against a fixture Splunk On-Call in the
 * documented response shapes: what an organisation becomes in OneUptime's
 * words - a team's rotations as schedules, shifts as their rotations with
 * the days and hours their masks give, lined up with whoever is on call
 * now - the requests it makes (the two key headers, at most two a second)
 * and how it holds up when the key is refused (401 or 403), a team is gone,
 * a list is forbidden or Splunk On-Call says to slow down. Nothing here
 * reaches a real Splunk On-Call.
 */

const NOW: number = Date.parse("2026-10-08T12:00:00Z");

function context(
  api: FixtureApi,
  sleep: RecordingSleep = new RecordingSleep({ now: NOW }),
  overrides: Partial<ToolImportReadContext> = {},
): ToolImportReadContext {
  return {
    transport: api.transport,
    sleep: sleep.sleep,
    now: (): number => {
      return sleep.clock.now;
    },
    maxRequests: 500,
    deadlineAt: NOW + 15 * 60 * 1000,
    ...overrides,
  };
}

async function read(
  api: FixtureApi = splunkOnCallApi(),
  sleep?: RecordingSleep,
  overrides: Partial<ToolImportReadContext> = {},
): Promise<ToolImportSnapshot> {
  return await new SplunkOnCallAdapter().read(
    {
      source: ToolImportSource.SplunkOnCall,
      apiKey: SPLUNK_KEY,
      apiKeyId: SPLUNK_API_ID,
      region: "",
    },
    context(api, sleep, overrides),
  );
}

function scheduleOf(
  snapshot: ToolImportSnapshot,
  id: string,
): ImportedSchedule {
  return snapshot.schedules.find((schedule: ImportedSchedule): boolean => {
    return schedule.sourceId === id;
  })!;
}

function policyOf(snapshot: ToolImportSnapshot, id: string): ImportedPolicy {
  return snapshot.policies.find((policy: ImportedPolicy): boolean => {
    return policy.sourceId === id;
  })!;
}

function rotationOf(
  schedule: ImportedSchedule,
  name: string,
): ImportedRotation {
  return schedule.rotations.find((rotation: ImportedRotation): boolean => {
    return rotation.name === name;
  })!;
}

function codes(notes: Array<ToolImportNote>): Array<ToolImportNoteCode> {
  return notes.map((note: ToolImportNote): ToolImportNoteCode => {
    return note.code;
  });
}

const PEOPLE: Array<ImportedPerson> = [
  {
    sourceId: "alice",
    name: "Alice Wong",
    email: "alice@example.com",
    isActive: true,
    notes: [],
  },
  {
    sourceId: "bob",
    name: "Bob Marley",
    email: "bob@example.com",
    isActive: true,
    notes: [],
  },
  {
    sourceId: "carol",
    name: "Carol Jones",
    email: "carol@example.com",
    isActive: true,
    notes: [],
  },
];

describe("SplunkOnCallAdapter: what a Splunk On-Call organisation becomes", () => {
  test("people are named by their username, with their full name and a lowercase email; someone without one has none", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(snapshot.source).toBe(ToolImportSource.SplunkOnCall);
    expect(snapshot.people).toEqual([
      ...PEOPLE,
      {
        sourceId: "dave",
        name: "dave",
        email: null,
        isActive: true,
        notes: [],
      },
    ]);
  });

  test("a user list answered as a list of lists, as the API has been, reads the same", async () => {
    const api: FixtureApi = splunkOnCallApi().add({
      path: "/api-public/v2/user",
      answers: [
        json({ users: [SPLUNK_USERS], _selfUrl: "/api-public/v2/user" }),
      ],
    });

    expect((await read(api)).people).toHaveLength(4);
  });

  test("teams are named by their slug, with their members", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(snapshot.teams).toEqual([
      {
        sourceId: PLATFORM_TEAM_SLUG,
        name: "Platform",
        description: "Platform engineers",
        memberSourceIds: ["alice", "bob"],
        notes: [],
      },
      {
        sourceId: PAYMENTS_TEAM_SLUG,
        name: "Payments",
        description: "Payments engineers",
        memberSourceIds: ["bob", "carol"],
        notes: [],
      },
    ]);
  });

  test("a team's rotation is a schedule owned by the team, named by the rotation's own id, in its first shift's time zone", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(
      snapshot.schedules.map((schedule: ImportedSchedule) => {
        return {
          sourceId: schedule.sourceId,
          name: schedule.name,
          timezone: schedule.timezone,
          owners: schedule.ownerTeamSourceIds,
        };
      }),
    ).toEqual([
      {
        sourceId: PRIMARY_ROTATION_SLUG,
        name: "Primary",
        timezone: "America/Denver",
        owners: [PLATFORM_TEAM_SLUG],
      },
      {
        sourceId: SUN_ROTATION_SLUG,
        name: "Follow the sun",
        timezone: "America/New_York",
        owners: [PLATFORM_TEAM_SLUG],
      },
      {
        sourceId: PAYMENTS_ROTATION_SLUG,
        name: "Payments 24/7",
        timezone: "Europe/London",
        owners: [PAYMENTS_TEAM_SLUG],
      },
    ]);
  });

  test("a weekday shift keeps its start, weekly hand-off and hours, and is lined up so whoever is on call now still is", async () => {
    const snapshot: ToolImportSnapshot = await read();
    const business: ImportedRotation = rotationOf(
      scheduleOf(snapshot, PRIMARY_ROTATION_SLUG),
      "Business hours",
    );

    expect(business).toEqual({
      key: "1",
      name: "Business hours",
      startsAt: "2026-01-05T16:00:00.000Z",
      intervalType: EventInterval.Week,
      intervalCount: 1,
      restriction: {
        type: "Weekly",
        windows: [
          DayOfWeek.Monday,
          DayOfWeek.Tuesday,
          DayOfWeek.Wednesday,
          DayOfWeek.Thursday,
          DayOfWeek.Friday,
        ].map((day: DayOfWeek) => {
          return {
            startDay: day,
            startTime: "09:00",
            endDay: day,
            endTime: "17:00",
          };
        }),
      },
      /*
       * Counted from its start, this week is bob's turn - but Splunk On-Call
       * has alice on call (someone set her current), so the order is turned
       * to put her on call now.
       */
      participantSourceIds: ["bob", "alice"],
      notes: [],
    });
  });

  test("weekday nights and the weekend (a mask and a second mask) are one set of weekly windows, and never overlap the day shift", async () => {
    const snapshot: ToolImportSnapshot = await read();
    const primary: ImportedSchedule = scheduleOf(
      snapshot,
      PRIMARY_ROTATION_SLUG,
    );
    const afterHours: ImportedRotation = rotationOf(primary, "After hours");

    expect(afterHours.startsAt).toBe("2026-01-06T00:00:00.000Z");
    expect(afterHours.participantSourceIds).toEqual(["carol", "alice"]);
    expect(afterHours.restriction).toEqual({
      type: "Weekly",
      windows: [
        {
          startDay: DayOfWeek.Monday,
          startTime: "17:00",
          endDay: DayOfWeek.Tuesday,
          endTime: "09:00",
        },
        {
          startDay: DayOfWeek.Tuesday,
          startTime: "17:00",
          endDay: DayOfWeek.Wednesday,
          endTime: "09:00",
        },
        {
          startDay: DayOfWeek.Wednesday,
          startTime: "17:00",
          endDay: DayOfWeek.Thursday,
          endTime: "09:00",
        },
        {
          startDay: DayOfWeek.Thursday,
          startTime: "17:00",
          endDay: DayOfWeek.Friday,
          endTime: "09:00",
        },
        {
          startDay: DayOfWeek.Friday,
          startTime: "17:00",
          endDay: DayOfWeek.Saturday,
          endTime: "09:00",
        },
        {
          startDay: DayOfWeek.Sunday,
          startTime: "00:00",
          endDay: DayOfWeek.Monday,
          endTime: "00:00",
        },
        {
          startDay: DayOfWeek.Saturday,
          startTime: "00:00",
          endDay: DayOfWeek.Sunday,
          endTime: "00:00",
        },
      ],
    });

    // The day and night shifts take turns, so they stay one schedule.
    expect(groupRotationsIntoSchedules(primary.rotations)).toHaveLength(1);
  });

  test("a shift kept in another time zone has its hours moved into the schedule's, with a note when daylight saving moves them", async () => {
    const snapshot: ToolImportSnapshot = await read();
    const sun: ImportedSchedule = scheduleOf(snapshot, SUN_ROTATION_SLUG);
    const americas: ImportedRotation = rotationOf(sun, "Americas");
    const sydney: ImportedRotation = rotationOf(sun, "Sydney");

    expect(americas).toMatchObject({
      intervalType: EventInterval.Day,
      intervalCount: 1,
      restriction: { type: "Daily", startTime: "08:00", endTime: "20:00" },
      participantSourceIds: ["alice"],
      notes: [],
    });

    // 08:00 to 20:00 in Sydney (UTC+11 in October) is 17:00 to 05:00 in New York (UTC-4).
    expect(sydney).toMatchObject({
      startsAt: "2026-01-04T21:00:00.000Z",
      restriction: { type: "Daily", startTime: "17:00", endTime: "05:00" },
      participantSourceIds: ["bob"],
    });
    expect(sydney.notes).toEqual([
      {
        code: ToolImportNoteCode.RotationTimezoneConverted,
        values: { rotation: "Sydney", timezone: "Australia/Sydney" },
      },
    ]);

    // Their hours meet from 17:00 to 20:00: two schedules.
    expect(groupRotationsIntoSchedules(sun.rotations)).toHaveLength(2);
  });

  test("a round-the-clock shift has no restriction; a two-weekly hand-off is two weeks; shifts on call together split", async () => {
    const snapshot: ToolImportSnapshot = await read();
    const payments: ImportedSchedule = scheduleOf(
      snapshot,
      PAYMENTS_ROTATION_SLUG,
    );

    expect(payments.rotations).toEqual([
      {
        key: "21",
        name: "Everyone",
        startsAt: "2026-03-02T10:00:00.000Z",
        intervalType: EventInterval.Week,
        intervalCount: 2,
        restriction: null,
        participantSourceIds: ["bob", "carol"],
        notes: [],
      },
      {
        key: "22",
        name: "Shadow",
        startsAt: "2026-03-02T10:00:00.000Z",
        intervalType: EventInterval.Week,
        intervalCount: 1,
        restriction: null,
        participantSourceIds: ["alice"],
        notes: [],
      },
    ]);
    expect(groupRotationsIntoSchedules(payments.rotations)).toHaveLength(2);
  });

  test("a daily hand-off on a shift that skips days is noted: Splunk On-Call counts only the days it is on call", async () => {
    const api: FixtureApi = splunkOnCallApi().add({
      path: `/api-public/v2/team/${PLATFORM_TEAM_SLUG}/rotations`,
      answers: [
        json({
          rotations: [
            {
              groupId: 101,
              label: "Primary",
              shifts: [
                shift({
                  shiftId: 7,
                  label: "Weekday days",
                  duration: 1,
                  shifttype: "pho",
                  start: "2026-01-05T09:00:00Z",
                  timezone: "UTC",
                  members: ["alice", "bob"],
                  mask: {
                    day: {
                      su: false,
                      m: true,
                      t: true,
                      w: true,
                      th: true,
                      f: true,
                      sa: false,
                    },
                    time: [
                      {
                        start: { hour: 9, minute: 0 },
                        end: { hour: 17, minute: 0 },
                      },
                    ],
                  },
                }),
              ],
            },
          ],
        }),
      ],
    });

    const rotation: ImportedRotation = scheduleOf(
      await read(api),
      PRIMARY_ROTATION_SLUG,
    ).rotations[0]!;

    expect(rotation.intervalType).toBe(EventInterval.Day);
    expect(rotation.notes).toEqual([
      {
        code: ToolImportNoteCode.RotationApproximated,
        values: { rotation: "Weekday days" },
      },
    ]);
  });

  test("a policy's steps are levels: a step's timeout is the wait before it, and a step with none pages with the one before", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(policyOf(snapshot, PLATFORM_POLICY_SLUG)).toEqual({
      sourceId: PLATFORM_POLICY_SLUG,
      name: "Platform escalation",
      ownerTeamSourceIds: [PLATFORM_TEAM_SLUG],
      levels: [
        {
          escalateAfterMinutes: 15,
          personSourceIds: [],
          teamSourceIds: [],
          scheduleSourceIds: [PRIMARY_ROTATION_SLUG],
        },
        {
          escalateAfterMinutes: 10,
          // An email address that is one of the people pages them.
          personSourceIds: ["bob", "alice"],
          teamSourceIds: [],
          scheduleSourceIds: [],
        },
        {
          escalateAfterMinutes: 30,
          personSourceIds: [],
          teamSourceIds: [],
          scheduleSourceIds: [PRIMARY_ROTATION_SLUG],
        },
      ],
      repeatTimes: 0,
      notes: [
        { code: ToolImportNoteCode.PolicyEmailAddress },
        { code: ToolImportNoteCode.PolicyWebhookStep },
        { code: ToolImportNoteCode.PolicyRunsAnotherPolicy },
        { code: ToolImportNoteCode.PolicyNextOnCall },
      ],
    });
  });

  test("a policy whose first step waits says so", async () => {
    const policy: ImportedPolicy = policyOf(await read(), PAYMENTS_POLICY_SLUG);

    expect(policy.ownerTeamSourceIds).toEqual([PAYMENTS_TEAM_SLUG]);
    expect(policy.levels).toEqual([
      {
        escalateAfterMinutes: 30,
        personSourceIds: [],
        teamSourceIds: [],
        scheduleSourceIds: [PAYMENTS_ROTATION_SLUG],
      },
    ]);
    expect(policy.notes).toEqual([
      {
        code: ToolImportNoteCode.PolicyFirstStepWaits,
        values: { minutes: 5 },
      },
    ]);
  });

  test("a policy that is gone by the time it is read is left out, and the rest is read", async () => {
    const api: FixtureApi = splunkOnCallApi().add({
      path: `/api-public/v1/policies/${PAYMENTS_POLICY_SLUG}`,
      answers: [json({ message: "Not found" }, 404)],
    });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(
      snapshot.policies.map((policy: ImportedPolicy) => {
        return policy.sourceId;
      }),
    ).toEqual([PLATFORM_POLICY_SLUG]);
  });

  test("Splunk On-Call has no services or incident settings to bring over", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(snapshot.services).toEqual([]);
    expect(snapshot.incidentSeverities).toEqual([]);
    expect(snapshot.incidentStates).toEqual([]);
    expect(snapshot.incidentRoles).toEqual([]);
    expect(snapshot.incidentCustomFields).toEqual([]);
    expect(snapshot.notes).toEqual([]);
  });
});

describe("SplunkOnCallAdapter: the requests it makes", () => {
  test("every request goes to api.victorops.com with the API ID and key headers, never in the address", async () => {
    const api: FixtureApi = splunkOnCallApi();
    await read(api);

    expect(api.requests.length).toBe(11);

    for (const request of api.requests) {
      expect(new URL(request.url).host).toBe(SPLUNK_ON_CALL_HOST);
      expect(request.headers["X-VO-Api-Id"]).toBe(SPLUNK_API_ID);
      expect(request.headers["X-VO-Api-Key"]).toBe(SPLUNK_KEY);
      expect(request.headers["Authorization"]).toBeUndefined();
      expect(request.url).not.toContain(SPLUNK_KEY);
      expect(request.url).not.toContain(SPLUNK_API_ID);
    }
  });

  test("requests keep to two a second, the most each endpoint allows", async () => {
    const sleep: RecordingSleep = new RecordingSleep({ now: NOW });
    const api: FixtureApi = splunkOnCallApi();

    await read(api, sleep);

    expect(sleep.waits).toEqual(
      Array.from({ length: api.requests.length - 1 }, () => {
        return 600;
      }),
    );
  });

  test("nothing but the documented endpoints is called", async () => {
    const api: FixtureApi = splunkOnCallApi();
    await read(api);

    expect(
      api.urls.map((url: URL): string => {
        return url.pathname;
      }),
    ).toEqual([
      "/api-public/v2/user",
      "/api-public/v1/team",
      `/api-public/v1/team/${PLATFORM_TEAM_SLUG}/members`,
      `/api-public/v1/teams/${PLATFORM_TEAM_SLUG}/rotations`,
      `/api-public/v1/team/${PAYMENTS_TEAM_SLUG}/members`,
      `/api-public/v1/teams/${PAYMENTS_TEAM_SLUG}/rotations`,
      `/api-public/v2/team/${PLATFORM_TEAM_SLUG}/rotations`,
      `/api-public/v2/team/${PAYMENTS_TEAM_SLUG}/rotations`,
      "/api-public/v1/policies",
      `/api-public/v1/policies/${PLATFORM_POLICY_SLUG}`,
      `/api-public/v1/policies/${PAYMENTS_POLICY_SLUG}`,
    ]);
  });

  test("the read is reported kind by kind, in the order it reads them", async () => {
    const kinds: Array<ToolImportResourceKind> = [];

    await read(splunkOnCallApi(), undefined, {
      onProgress: async (kind: ToolImportResourceKind): Promise<void> => {
        kinds.push(kind);
      },
    });

    expect(kinds).toEqual([
      ToolImportResourceKind.Person,
      ToolImportResourceKind.Team,
      ToolImportResourceKind.OnCallSchedule,
      ToolImportResourceKind.OnCallPolicy,
    ]);
  });
});

describe("SplunkOnCallAdapter: when Splunk On-Call says no", () => {
  test.each([401, 403])(
    "a key it refuses with a %i stops the read at once, with what to check, never repeating the key or ID",
    async (status: number) => {
      const api: FixtureApi = splunkOnCallApi().add({
        path: "/api-public/v2/user",
        answers: [
          json(
            { message: `Forbidden for ${SPLUNK_API_ID} ${SPLUNK_KEY}` },
            status,
          ),
        ],
      });

      const error: unknown = await read(api).catch((caught: unknown) => {
        return caught;
      });

      expect(error).toBeInstanceOf(ToolImportReadError);
      expect((error as Error).message).toBe(
        "Splunk On-Call did not accept the API ID and API key. Check that you copied the API ID and the whole API key from Integrations > API in Splunk On-Call.",
      );
      expect(api.requests).toHaveLength(1);
    },
  );

  test("a team that is gone by the time it is read keeps no members, and the rest is still read", async () => {
    const api: FixtureApi = splunkOnCallApi().add({
      path: `/api-public/v1/team/${PAYMENTS_TEAM_SLUG}/members`,
      answers: [json({ message: "Team not found" }, 404)],
    });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(snapshot.teams[1]!.memberSourceIds).toEqual([]);
    expect(snapshot.schedules).toHaveLength(3);
  });

  test("a list the key may not read is a note, and the rest is still read", async () => {
    const api: FixtureApi = splunkOnCallApi().add({
      path: "/api-public/v1/policies",
      answers: [json({ message: "Forbidden" }, 403)],
    });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(snapshot.policies).toEqual([]);
    expect(snapshot.notes).toEqual([
      {
        code: ToolImportNoteCode.CouldNotRead,
        values: { kind: ToolImportResourceKind.OnCallPolicy },
      },
    ]);
    expect(snapshot.schedules).toHaveLength(3);
  });

  test("a 429 waits as Splunk On-Call asks, then reads on", async () => {
    const sleep: RecordingSleep = new RecordingSleep({ now: NOW });
    const api: FixtureApi = splunkOnCallApi().add({
      path: "/api-public/v1/team",
      answers: [
        json({ message: "Rate-limit reached" }, 429, { "retry-after": "3" }),
        json([]),
      ],
    });

    const snapshot: ToolImportSnapshot = await read(api, sleep);

    expect(sleep.waits).toContain(3000);
    expect(api.callsTo("/api-public/v1/team")).toHaveLength(2);
    expect(snapshot.teams).toEqual([]);
  });

  test("the snapshot never holds the key or its ID", async () => {
    const serialized: string = JSON.stringify(await read());

    expect(serialized).not.toContain(SPLUNK_KEY);
    expect(serialized).not.toContain(SPLUNK_API_ID);
  });
});

describe("SplunkOnCallAdapter: Splunk On-Call's words in OneUptime's", () => {
  test("masks: none is round the clock, an end before the start runs overnight, a whole week is no restriction, and the third mask counts", () => {
    expect(toRestriction({})).toBeNull();
    expect(
      toRestriction({
        mask: {
          day: {
            su: true,
            m: true,
            t: true,
            w: true,
            th: true,
            f: true,
            sa: true,
          },
          time: [
            { start: { hour: 22, minute: 30 }, end: { hour: 6, minute: 0 } },
          ],
        },
      }),
    ).toEqual({ type: "Daily", startTime: "22:30", endTime: "06:00" });
    expect(
      toRestriction({
        mask: {
          day: {
            su: true,
            m: true,
            t: true,
            w: true,
            th: true,
            f: true,
            sa: true,
          },
          time: [
            { start: { hour: 0, minute: 0 }, end: { hour: 0, minute: 0 } },
          ],
        },
      }),
    ).toBeNull();
    // Monday 09:00 to Wednesday 17:00: the first day, the middle, the last.
    expect(
      toRestriction({
        mask: {
          day: { m: true },
          time: [
            { start: { hour: 9, minute: 0 }, end: { hour: 0, minute: 0 } },
          ],
        },
        mask2: { day: { t: true }, time: [] },
        mask3: {
          day: { w: true },
          time: [
            { start: { hour: 0, minute: 0 }, end: { hour: 17, minute: 0 } },
          ],
        },
      }),
    ).toEqual({
      type: "Weekly",
      windows: [
        {
          startDay: DayOfWeek.Monday,
          startTime: "09:00",
          endDay: DayOfWeek.Tuesday,
          endTime: "00:00",
        },
        {
          startDay: DayOfWeek.Tuesday,
          startTime: "00:00",
          endDay: DayOfWeek.Wednesday,
          endTime: "00:00",
        },
        {
          startDay: DayOfWeek.Wednesday,
          startTime: "00:00",
          endDay: DayOfWeek.Wednesday,
          endTime: "17:00",
        },
      ],
    });
    expect([
      ...getMaskDays({ mast3: { day: { sa: true, su: false } } }),
    ]).toEqual([DayOfWeek.Saturday]);
    expect(getMaskDays({}).size).toBe(7);
  });

  test("lining up with who is on call: by the middle of the current period; nobody on call, or someone not in the shift, changes nothing", () => {
    const index: ToolImportPeopleIndex = new ToolImportPeopleIndex(PEOPLE);
    const startsAt: number = Date.parse("2026-01-05T00:00:00Z");
    const day: number = 24 * 60 * 60 * 1000;

    // Day 2 is the third turn: carol's by the list, bob's in Splunk On-Call.
    const lined: Array<string> = lineUpWithWhoIsOnCall({
      members: ["alice", "bob", "carol"],
      startsAt: startsAt,
      turnMs: day,
      current: {
        start: "2026-01-07T00:00:00Z",
        end: "2026-01-08T00:00:00Z",
        username: "bob",
      },
      peopleIndex: index,
    });

    expect(lined).toEqual(["carol", "alice", "bob"]);
    // The third turn's person is bob, and the order around him is kept.
    expect(lined[2]).toBe("bob");

    for (const current of [
      {},
      { start: "2026-01-07T00:00:00Z", username: "nobody-here" },
      { username: "bob" },
    ]) {
      expect(
        lineUpWithWhoIsOnCall({
          members: ["alice", "bob", "carol"],
          startsAt: startsAt,
          turnMs: day,
          current: current,
          peopleIndex: index,
        }),
      ).toEqual(["alice", "bob", "carol"]);
    }
  });

  test("steps: what each kind of entry pages, and what is left out", () => {
    const notes: Array<ToolImportNote> = [];
    const levels: Array<ImportedPolicyLevel> = toLevels({
      steps: [
        {
          timeout: 0,
          entries: [
            { executionType: "user", user: { username: "nobody-here" } },
            {
              executionType: "rotation_group_previous",
              rotationGroup: { slug: "rtg-1" },
            },
            { executionType: "something_new" },
          ],
        },
      ],
      peopleIndex: new ToolImportPeopleIndex(PEOPLE),
      notes: notes,
    });

    expect(levels).toEqual([
      {
        escalateAfterMinutes: 30,
        personSourceIds: [],
        teamSourceIds: [],
        scheduleSourceIds: ["rtg-1"],
      },
    ]);
    expect(codes(notes)).toEqual([
      ToolImportNoteCode.PolicyUnknownTarget,
      ToolImportNoteCode.PolicyNextOnCall,
    ]);
    expect(
      toLevels({
        steps: [],
        peopleIndex: new ToolImportPeopleIndex([]),
        notes: [],
      }),
    ).toEqual([]);
  });

  test("the fixture's shifts are the ones the tests read", () => {
    expect(PLATFORM_ROTATIONS).toHaveLength(2);
  });
});
