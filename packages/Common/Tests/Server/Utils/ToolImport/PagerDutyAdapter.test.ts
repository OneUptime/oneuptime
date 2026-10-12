import { describe, expect, test } from "@jest/globals";
import PagerDutyAdapter, {
  toAccountName,
  toRestriction,
} from "../../../../Server/Utils/ToolImport/Adapters/PagerDuty/PagerDutyAdapter";
import {
  ToolImportReadContext,
  ToolImportReadError,
} from "../../../../Server/Utils/ToolImport/Types";
import DayOfWeek from "../../../../Types/Day/DayOfWeek";
import EventInterval from "../../../../Types/Events/EventInterval";
import {
  PAGERDUTY_EU_HOST,
  PAGERDUTY_REGION_EU,
  PAGERDUTY_REGION_US,
  PAGERDUTY_US_HOST,
} from "../../../../Types/ToolImport/ToolImportCatalog";
import {
  ToolImportNote,
  ToolImportNoteCode,
} from "../../../../Types/ToolImport/ToolImportNote";
import ToolImportResourceKind from "../../../../Types/ToolImport/ToolImportResourceKind";
import { groupRotationsIntoSchedules } from "../../../../Types/ToolImport/ToolImportScheduleRules";
import {
  ImportedPolicy,
  ImportedRotation,
  ImportedSchedule,
  ImportedService,
  ToolImportSnapshot,
} from "../../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../../Types/ToolImport/ToolImportSource";
import {
  ALICE_ID,
  BACKUP_SCHEDULE_ID,
  BOB_ID,
  BUSINESS_SCHEDULE_ID,
  CAROL_ID,
  CHECKOUT_SERVICE_ID,
  layer,
  LEGACY_SERVICE_ID,
  page,
  PAGERDUTY_KEY,
  PAGERDUTY_SCHEDULES,
  PAGERDUTY_USERS,
  pagerDutyApi,
  pagerDutyError,
  pagerDutyUser,
  PAYMENTS_TEAM_ID,
  PLATFORM_POLICY_ID,
  PLATFORM_TEAM_ID,
  PRIMARY_SCHEDULE_ID,
  reference,
  SHIFT_BASED_POLICY_ID,
} from "./PagerDutyFixtures";
import { FixtureApi, json, RecordingSleep } from "./ToolImportFixtureTransport";

/*
 * The PagerDuty adapter against a fixture PagerDuty in the documented
 * response shapes: what an account becomes in OneUptime's words - above
 * all, that a schedule's layers keep overriding one another, highest first,
 * so the schedule stays one schedule - the requests it makes (the region's
 * host, the token and version headers, offset paging) and how it holds up
 * when the key is refused, a list is forbidden or not in the account's
 * plan, or PagerDuty says to slow down. Nothing here reaches a real
 * PagerDuty.
 */

const NOW: number = Date.parse("2026-10-08T12:00:00Z");

function context(
  api: FixtureApi,
  overrides: Partial<ToolImportReadContext> = {},
  sleep: RecordingSleep = new RecordingSleep({ now: NOW }),
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
  api: FixtureApi = pagerDutyApi(),
  region: string = PAGERDUTY_REGION_US,
  overrides: Partial<ToolImportReadContext> = {},
  sleep?: RecordingSleep,
): Promise<ToolImportSnapshot> {
  return await new PagerDutyAdapter().read(
    {
      source: ToolImportSource.PagerDuty,
      apiKey: PAGERDUTY_KEY,
      region: region,
    },
    context(api, overrides, sleep),
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

function codes(notes: Array<ToolImportNote>): Array<ToolImportNoteCode> {
  return notes.map((note: ToolImportNote): ToolImportNoteCode => {
    return note.code;
  });
}

function names(rotations: Array<ImportedRotation>): Array<string> {
  return rotations.map((rotation: ImportedRotation): string => {
    return rotation.name;
  });
}

describe("PagerDutyAdapter: what a PagerDuty account becomes", () => {
  test("people keep their PagerDuty id and name, with a lowercase email; the account is named from its web address", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(snapshot.source).toBe(ToolImportSource.PagerDuty);
    expect(snapshot.accountName).toBe("acme");
    expect(snapshot.people).toEqual([
      {
        sourceId: ALICE_ID,
        name: "Alice Wong",
        email: "alice@example.com",
        isActive: true,
        notes: [],
      },
      {
        sourceId: BOB_ID,
        name: "Bob Marley",
        email: "bob@example.com",
        isActive: true,
        notes: [],
      },
      {
        sourceId: CAROL_ID,
        name: "Carol Jones",
        email: "carol@example.com",
        isActive: true,
        notes: [],
      },
    ]);
  });

  test("teams take their members from the teams each person is on, with no request per team", async () => {
    const api: FixtureApi = pagerDutyApi();
    const snapshot: ToolImportSnapshot = await read(api);

    expect(snapshot.teams).toEqual([
      {
        sourceId: PLATFORM_TEAM_ID,
        name: "Platform",
        description: "Keeps the lights on",
        memberSourceIds: [ALICE_ID, BOB_ID],
        notes: [],
      },
      {
        sourceId: PAYMENTS_TEAM_ID,
        name: "Payments",
        description: undefined,
        memberSourceIds: [BOB_ID],
        notes: [],
      },
    ]);
    expect(
      api.urls.filter((url: URL): boolean => {
        return url.pathname.startsWith("/teams/");
      }),
    ).toEqual([]);
  });

  test("a schedule's layers keep PagerDuty's order, the highest first, and outrank the ones below; a layer that ended is left out", async () => {
    const snapshot: ToolImportSnapshot = await read();
    const primary: ImportedSchedule = scheduleOf(snapshot, PRIMARY_SCHEDULE_ID);

    expect(primary).toMatchObject({
      name: "Primary",
      description: "Who gets paged first",
      timezone: "America/New_York",
      isEnabled: true,
      ownerTeamSourceIds: [PLATFORM_TEAM_ID],
    });
    expect(names(primary.rotations)).toEqual(["Weekend cover", "Layer 1"]);
    expect(
      primary.rotations.map((rotation: ImportedRotation) => {
        return rotation.precedence;
      }),
    ).toEqual([3, 2]);
    expect(primary.notes).toEqual([
      {
        code: ToolImportNoteCode.RotationEnded,
        values: { rotation: "Old layer", date: "2025-12-01T00:00:00.000Z" },
      },
    ]);

    // Layers that override one another stay one schedule, in that order.
    const groups: Array<Array<ImportedRotation>> = groupRotationsIntoSchedules(
      primary.rotations,
    );
    expect(groups).toHaveLength(1);
    expect(names(groups[0]!)).toEqual(["Weekend cover", "Layer 1"]);
  });

  test("a layer keeps its virtual start, turn length and people in order, and a time-of-week restriction is a weekly window", async () => {
    const snapshot: ToolImportSnapshot = await read();
    const [weekend, daily] = scheduleOf(snapshot, PRIMARY_SCHEDULE_ID)
      .rotations as [ImportedRotation, ImportedRotation];

    expect(weekend).toEqual({
      key: "PLWKND1",
      name: "Weekend cover",
      startsAt: "2026-01-03T05:00:00.000Z",
      intervalType: EventInterval.Week,
      intervalCount: 1,
      restriction: {
        type: "Weekly",
        windows: [
          {
            startDay: DayOfWeek.Saturday,
            startTime: "00:00",
            endDay: DayOfWeek.Monday,
            endTime: "00:00",
          },
        ],
      },
      participantSourceIds: [CAROL_ID],
      precedence: 3,
      notes: [],
    });
    expect(daily).toEqual({
      key: "PLDAY01",
      name: "Layer 1",
      startsAt: "2026-01-05T14:00:00.000Z",
      intervalType: EventInterval.Day,
      intervalCount: 1,
      restriction: null,
      participantSourceIds: [ALICE_ID, BOB_ID],
      precedence: 2,
      notes: [],
    });
  });

  test("a time-of-day restriction is a daily window; a layer that ends later is kept with a note; two-week turns stay two weeks", async () => {
    const snapshot: ToolImportSnapshot = await read();
    const business: ImportedSchedule = scheduleOf(
      snapshot,
      BUSINESS_SCHEDULE_ID,
    );
    const nineToSix: ImportedRotation = business.rotations[1]!;

    expect(business.timezone).toBe("Europe/London");
    expect(business.ownerTeamSourceIds).toEqual([PAYMENTS_TEAM_ID]);
    expect(nineToSix).toMatchObject({
      name: "Nine to six",
      startsAt: "2026-02-02T09:00:00.000Z",
      intervalType: EventInterval.Week,
      intervalCount: 2,
      restriction: { type: "Daily", startTime: "09:00", endTime: "18:00" },
      participantSourceIds: [BOB_ID],
      precedence: 1,
    });
    expect(nineToSix.notes).toEqual([
      {
        code: ToolImportNoteCode.RotationEnds,
        values: { rotation: "Nine to six", date: "2027-01-01T00:00:00.000Z" },
      },
    ]);
  });

  test("a layer that only takes over later starts then, with whoever PagerDuty puts on call at that moment", async () => {
    const snapshot: ToolImportSnapshot = await read();
    const nextQuarter: ImportedRotation = scheduleOf(
      snapshot,
      BUSINESS_SCHEDULE_ID,
    ).rotations[0]!;

    // Its turns count from Nov 1; on Nov 2 the second person is on call.
    expect(nextQuarter).toMatchObject({
      name: "Next quarter",
      startsAt: "2026-11-02T09:00:00.000Z",
      intervalType: EventInterval.Day,
      intervalCount: 1,
      participantSourceIds: [BOB_ID, ALICE_ID],
      precedence: 2,
    });
    expect(nextQuarter.notes).toEqual([
      {
        code: ToolImportNoteCode.RotationNotStarted,
        values: { rotation: "Next quarter", date: "2026-11-02T09:00:00.000Z" },
      },
    ]);
  });

  test("a later start that falls inside a turn is noted as not exact", async () => {
    const api: FixtureApi = pagerDutyApi().add({
      path: "/schedules",
      query: { "include[]": "schedule_layers" },
      answers: [
        json(
          page("schedules", [
            {
              ...PAGERDUTY_SCHEDULES[0]!,
              schedule_layers: [
                layer({
                  id: "PLMID01",
                  name: "Midweek",
                  start: "2026-11-02T21:00:00Z",
                  virtualStart: "2026-11-01T09:00:00Z",
                  turnSeconds: 86400,
                  users: [
                    reference("user_reference", ALICE_ID, "Alice", "users"),
                    reference("user_reference", BOB_ID, "Bob", "users"),
                    reference("user_reference", CAROL_ID, "Carol", "users"),
                  ],
                }),
              ],
            },
          ]),
        ),
      ],
    });

    const rotation: ImportedRotation = scheduleOf(
      await read(api),
      PRIMARY_SCHEDULE_ID,
    ).rotations[0]!;

    // 1.5 days after the virtual start: the second turn, which is Bob's.
    expect(rotation.participantSourceIds).toEqual([BOB_ID, CAROL_ID, ALICE_ID]);
    expect(codes(rotation.notes)).toEqual([
      ToolImportNoteCode.RotationNotStarted,
      ToolImportNoteCode.RotationApproximated,
    ]);
  });

  test("a schedule the list gives without its layers has them read on its own; 12-hour turns are 12 hours", async () => {
    const api: FixtureApi = pagerDutyApi();
    const snapshot: ToolImportSnapshot = await read(api);
    const backup: ImportedSchedule = scheduleOf(snapshot, BACKUP_SCHEDULE_ID);

    expect(api.callsTo(`/schedules/${BACKUP_SCHEDULE_ID}`)).toHaveLength(1);
    expect(api.callsTo(`/schedules/${PRIMARY_SCHEDULE_ID}`)).toHaveLength(0);
    expect(backup.rotations).toEqual([
      {
        key: "PLHALF1",
        name: "Half days",
        startsAt: "2026-03-01T08:00:00.000Z",
        intervalType: EventInterval.Hour,
        intervalCount: 12,
        restriction: null,
        participantSourceIds: [BOB_ID, ALICE_ID],
        precedence: 1,
        notes: [],
      },
    ]);
  });

  test("a turn that is not whole hours comes over to the nearest hour, with a note", async () => {
    const api: FixtureApi = pagerDutyApi().add({
      path: `/schedules/${BACKUP_SCHEDULE_ID}`,
      answers: [
        json({
          schedule: {
            id: BACKUP_SCHEDULE_ID,
            name: "Backup",
            time_zone: "UTC",
            schedule_layers: [
              layer({
                id: "PLODD01",
                name: "Ninety minutes",
                start: "2026-03-01T08:00:00Z",
                virtualStart: "2026-03-01T08:00:00Z",
                turnSeconds: 5400,
                users: [reference("user_reference", BOB_ID, "Bob", "users")],
              }),
            ],
          },
        }),
      ],
    });

    const rotation: ImportedRotation = scheduleOf(
      await read(api),
      BACKUP_SCHEDULE_ID,
    ).rotations[0]!;

    expect(rotation.intervalType).toBe(EventInterval.Hour);
    expect(rotation.intervalCount).toBe(2);
    expect(rotation.notes).toEqual([
      {
        code: ToolImportNoteCode.RotationApproximated,
        values: { rotation: "Ninety minutes" },
      },
    ]);
  });

  test("an unnamed layer is named the way PagerDuty numbers it, the lowest Layer 1", async () => {
    const api: FixtureApi = pagerDutyApi().add({
      path: `/schedules/${BACKUP_SCHEDULE_ID}`,
      answers: [
        json({
          schedule: {
            id: BACKUP_SCHEDULE_ID,
            name: "Backup",
            time_zone: "UTC",
            schedule_layers: [
              { ...BACKUP_LAYER_WITHOUT_NAME, id: "PLTOP01" },
              { ...BACKUP_LAYER_WITHOUT_NAME, id: "PLLOW01" },
            ],
          },
        }),
      ],
    });

    expect(
      names(scheduleOf(await read(api), BACKUP_SCHEDULE_ID).rotations),
    ).toEqual(["Layer 2", "Layer 1"]);
  });

  test("escalation rules are levels: each pages its targets and waits its delay; a policy's loops are its repeats", async () => {
    const snapshot: ToolImportSnapshot = await read();
    const platform: ImportedPolicy = policyOf(snapshot, PLATFORM_POLICY_ID);

    expect(platform).toEqual({
      sourceId: PLATFORM_POLICY_ID,
      name: "Platform EP",
      description: "Pages the platform on-call, then Bob",
      ownerTeamSourceIds: [PLATFORM_TEAM_ID],
      levels: [
        {
          escalateAfterMinutes: 15,
          personSourceIds: [],
          teamSourceIds: [],
          scheduleSourceIds: [PRIMARY_SCHEDULE_ID],
        },
        {
          escalateAfterMinutes: 30,
          personSourceIds: [BOB_ID],
          teamSourceIds: [],
          scheduleSourceIds: [],
        },
      ],
      repeatTimes: 2,
      notes: [
        { code: ToolImportNoteCode.PolicyRoundRobin },
        { code: ToolImportNoteCode.PolicyUnknownTarget },
      ],
    });
  });

  test("a rule that pages a shift-based schedule says that part is left out", async () => {
    const snapshot: ToolImportSnapshot = await read();
    const policy: ImportedPolicy = policyOf(snapshot, SHIFT_BASED_POLICY_ID);

    expect(policy.levels).toEqual([
      {
        escalateAfterMinutes: 10,
        personSourceIds: [],
        teamSourceIds: [],
        scheduleSourceIds: [],
      },
    ]);
    expect(policy.notes).toEqual([
      { code: ToolImportNoteCode.PolicyScheduleNotRead },
    ]);
    expect(policy.description).toBeUndefined();
  });

  test("the account's shift-based schedules are not read: the preview says so", async () => {
    expect(codes((await read()).notes)).toEqual([
      ToolImportNoteCode.ShiftBasedSchedulesNotRead,
    ]);

    const without: FixtureApi = pagerDutyApi().add({
      path: "/v3/schedules",
      answers: [json({ schedules: [], limit: 1, offset: 0, more: false })],
    });
    expect((await read(without)).notes).toEqual([]);

    // An account without shift-based schedules may not have the endpoint.
    for (const status of [400, 403, 404]) {
      const missing: FixtureApi = pagerDutyApi().add({
        path: "/v3/schedules",
        answers: [json(pagerDutyError("Not Found", 2100), status)],
      });
      expect((await read(missing)).notes).toEqual([]);
    }
  });

  test("services keep their owner team, and a disabled one starts unticked with a note", async () => {
    const services: Array<ImportedService> = (await read()).services;

    expect(services).toEqual([
      {
        sourceId: CHECKOUT_SERVICE_ID,
        name: "Checkout API",
        description: "Checkout API in production",
        ownerTeamSourceIds: [PAYMENTS_TEAM_ID],
        isEnabled: true,
        notes: [],
      },
      {
        sourceId: LEGACY_SERVICE_ID,
        name: "Legacy batch",
        description: "Legacy batch in production",
        ownerTeamSourceIds: [],
        isEnabled: false,
        notes: [{ code: ToolImportNoteCode.TurnedOffInSource }],
      },
    ]);
  });

  test("PagerDuty has no incident settings to bring over", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(snapshot.incidentSeverities).toEqual([]);
    expect(snapshot.incidentStates).toEqual([]);
    expect(snapshot.incidentRoles).toEqual([]);
    expect(snapshot.incidentCustomFields).toEqual([]);
  });
});

const BACKUP_LAYER_WITHOUT_NAME: Record<string, unknown> = {
  ...layer({
    id: "PLNONE1",
    name: "",
    start: "2026-03-01T08:00:00Z",
    virtualStart: "2026-03-01T08:00:00Z",
    turnSeconds: 604800,
    users: [reference("user_reference", BOB_ID, "Bob", "users")],
  }),
  name: null,
};

describe("PagerDutyAdapter: the requests it makes", () => {
  test("every request goes to api.pagerduty.com with the token and version headers, for the US region", async () => {
    const api: FixtureApi = pagerDutyApi();
    await read(api);

    expect(api.requests.length).toBeGreaterThan(0);

    for (const request of api.requests) {
      expect(new URL(request.url).host).toBe(PAGERDUTY_US_HOST);
      expect(request.headers["Authorization"]).toBe(
        `Token token=${PAGERDUTY_KEY}`,
      );
      expect(request.headers["Accept"]).toBe(
        "application/vnd.pagerduty+json;version=2",
      );
      expect(request.url).not.toContain(PAGERDUTY_KEY);
    }
  });

  test("an account in the EU region is read from api.eu.pagerduty.com", async () => {
    const api: FixtureApi = pagerDutyApi();
    await read(api, PAGERDUTY_REGION_EU);

    for (const url of api.urls) {
      expect(url.host).toBe(PAGERDUTY_EU_HOST);
    }
  });

  test("a region that is not one of PagerDuty's is refused before anything is called", async () => {
    const api: FixtureApi = pagerDutyApi();

    await expect(read(api, "APAC")).rejects.toThrow(ToolImportReadError);
    expect(api.requests).toEqual([]);
  });

  test("lists are read 100 at a time, by offset, until PagerDuty says there are no more", async () => {
    const first: Array<Record<string, unknown>> = Array.from(
      { length: 100 },
      (_: unknown, index: number): Record<string, unknown> => {
        return pagerDutyUser({
          id: `PU${String(index).padStart(5, "0")}`,
          name: `Person ${index}`,
          email: `person${index}@example.com`,
          teams: [],
        });
      },
    );

    const api: FixtureApi = pagerDutyApi()
      .add({
        path: "/users",
        query: { offset: "0" },
        answers: [json(page("users", first, { offset: 0, more: true }))],
      })
      .add({
        path: "/users",
        query: { offset: "100" },
        answers: [
          json(page("users", PAGERDUTY_USERS, { offset: 100, more: false })),
        ],
      });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(snapshot.people).toHaveLength(103);
    expect(
      api.callsTo("/users").map((url: URL) => {
        return [url.searchParams.get("limit"), url.searchParams.get("offset")];
      }),
    ).toEqual([
      ["100", "0"],
      ["100", "100"],
    ]);
  });

  test("schedules are asked for with their layers", async () => {
    const api: FixtureApi = pagerDutyApi();
    await read(api);

    expect(
      api.callsTo("/schedules").map((url: URL) => {
        return url.searchParams.getAll("include[]");
      }),
    ).toEqual([["schedule_layers"]]);
  });

  test("the read is reported kind by kind, in the order it reads them", async () => {
    const kinds: Array<ToolImportResourceKind> = [];

    await read(pagerDutyApi(), PAGERDUTY_REGION_US, {
      onProgress: async (kind: ToolImportResourceKind): Promise<void> => {
        kinds.push(kind);
      },
    });

    expect(kinds).toEqual([
      ToolImportResourceKind.Person,
      ToolImportResourceKind.Team,
      ToolImportResourceKind.OnCallSchedule,
      ToolImportResourceKind.OnCallPolicy,
      ToolImportResourceKind.Service,
    ]);
  });

  test("nothing but the documented endpoints is called", async () => {
    const api: FixtureApi = pagerDutyApi();
    await read(api);

    expect(
      [
        ...new Set(
          api.urls.map((url: URL): string => {
            return url.pathname;
          }),
        ),
      ].sort(),
    ).toEqual(
      [
        "/users",
        "/teams",
        "/schedules",
        `/schedules/${BACKUP_SCHEDULE_ID}`,
        "/v3/schedules",
        "/escalation_policies",
        "/services",
      ].sort(),
    );
  });
});

describe("PagerDutyAdapter: when PagerDuty says no", () => {
  test("a refused key stops the read with what to check, and never repeats the key", async () => {
    const api: FixtureApi = pagerDutyApi().add({
      path: "/users",
      answers: [
        json(pagerDutyError(`Unauthorized ${PAGERDUTY_KEY}`, 2006), 401),
      ],
    });

    const error: unknown = await read(api).catch((caught: unknown) => {
      return caught;
    });

    expect(error).toBeInstanceOf(ToolImportReadError);
    expect((error as Error).message).toContain(
      "PagerDuty did not accept the API key.",
    );
    expect((error as Error).message).toContain("API Access Keys");
    expect((error as Error).message).not.toContain(PAGERDUTY_KEY);
    // Nothing after the refused request is read.
    expect(api.requests).toHaveLength(1);
  });

  test("a list the key may not read is a note, and the rest is still read", async () => {
    const api: FixtureApi = pagerDutyApi().add({
      path: "/escalation_policies",
      answers: [json(pagerDutyError("Access Denied", 2010), 403)],
    });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(snapshot.policies).toEqual([]);
    expect(snapshot.notes).toContainEqual({
      code: ToolImportNoteCode.CouldNotRead,
      values: { kind: ToolImportResourceKind.OnCallPolicy },
    });
    expect(snapshot.services).toHaveLength(2);
  });

  test("an account whose plan has no teams is noted, not failed", async () => {
    const api: FixtureApi = pagerDutyApi().add({
      path: "/teams",
      answers: [
        json(
          pagerDutyError(
            "Account does not have the abilities to perform the action.",
            2015,
          ),
          402,
        ),
      ],
    });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(snapshot.teams).toEqual([]);
    expect(snapshot.notes).toContainEqual({
      code: ToolImportNoteCode.CouldNotRead,
      values: { kind: ToolImportResourceKind.Team },
    });
    expect(snapshot.schedules).toHaveLength(3);
  });

  test("a key that can read nothing at all stops the read", async () => {
    let api: FixtureApi = pagerDutyApi();

    for (const path of [
      "/users",
      "/teams",
      "/schedules",
      "/escalation_policies",
      "/services",
    ]) {
      api = api.add({
        path: path,
        answers: [json(pagerDutyError("Access Denied", 2010), 403)],
      });
    }

    await expect(read(api)).rejects.toThrow(
      "The API key could not read anything from PagerDuty.",
    );
  });

  test("a 429 waits for the seconds PagerDuty's ratelimit-reset gives, then reads on", async () => {
    const sleep: RecordingSleep = new RecordingSleep({ now: NOW });
    const api: FixtureApi = pagerDutyApi().add({
      path: "/teams",
      answers: [
        json(pagerDutyError("Rate Limit Exceeded", 2020), 429, {
          "ratelimit-limit": "960",
          "ratelimit-remaining": "0",
          "ratelimit-reset": "7",
        }),
        json(page("teams", [])),
      ],
    });

    const snapshot: ToolImportSnapshot = await read(
      api,
      PAGERDUTY_REGION_US,
      {},
      sleep,
    );

    expect(sleep.waits).toEqual([7000]);
    expect(api.callsTo("/teams")).toHaveLength(2);
    expect(snapshot.teams).toEqual([]);
    expect(snapshot.services).toHaveLength(2);
  });

  test("the snapshot never holds the key", async () => {
    expect(JSON.stringify(await read())).not.toContain(PAGERDUTY_KEY);
  });

  test("the request budget stops a read that would never end", async () => {
    const api: FixtureApi = pagerDutyApi().add({
      path: "/users",
      answers: [
        json(
          page(
            "users",
            [
              pagerDutyUser({
                id: "PLOOP01",
                name: "Loop",
                email: "loop@example.com",
                teams: [],
              }),
            ],
            { more: true },
          ),
        ),
      ],
    });

    await expect(
      read(api, PAGERDUTY_REGION_US, { maxRequests: 20 }),
    ).rejects.toThrow("took more than 20 requests");
  });
});

describe("PagerDutyAdapter: PagerDuty's words in OneUptime's", () => {
  test("restrictions: a time of day every day, times of week, several of them, and one that leaves no hour out", () => {
    expect(
      toRestriction([
        {
          type: "daily_restriction",
          start_time_of_day: "20:00:00",
          duration_seconds: 12 * 60 * 60,
        },
      ]),
    ).toEqual({ type: "Daily", startTime: "20:00", endTime: "08:00" });

    expect(
      toRestriction([
        {
          type: "weekly_restriction",
          start_time_of_day: "09:00:00",
          duration_seconds: 8 * 60 * 60,
          start_day_of_week: 1,
        },
        {
          type: "weekly_restriction",
          start_time_of_day: "09:00:00",
          duration_seconds: 8 * 60 * 60,
          start_day_of_week: 7,
        },
      ]),
    ).toEqual({
      type: "Weekly",
      windows: [
        {
          startDay: DayOfWeek.Monday,
          startTime: "09:00",
          endDay: DayOfWeek.Monday,
          endTime: "17:00",
        },
        {
          startDay: DayOfWeek.Sunday,
          startTime: "09:00",
          endDay: DayOfWeek.Sunday,
          endTime: "17:00",
        },
      ],
    });

    // Around the clock is no restriction at all.
    expect(
      toRestriction([
        {
          type: "daily_restriction",
          start_time_of_day: "00:00:00",
          duration_seconds: 24 * 60 * 60,
        },
      ]),
    ).toBeNull();
    expect(
      toRestriction([
        {
          type: "weekly_restriction",
          start_time_of_day: "08:00:00",
          duration_seconds: 7 * 24 * 60 * 60,
          start_day_of_week: 3,
        },
      ]),
    ).toBeNull();
    expect(toRestriction([])).toBeNull();
    // Something that is not a restriction is not guessed.
    expect(
      toRestriction([{ type: "daily_restriction", duration_seconds: 3600 }]),
    ).toBeNull();
  });

  test("the account is named from a PagerDuty web address only", () => {
    expect(toAccountName("https://acme.pagerduty.com/users/P1")).toBe("acme");
    expect(toAccountName("https://acme-eu.eu.pagerduty.com/users/P1")).toBe(
      "acme-eu",
    );
    expect(toAccountName("https://evil.example.com/users/P1")).toBeUndefined();
    expect(toAccountName("not an address")).toBeUndefined();
    expect(toAccountName(undefined)).toBeUndefined();
  });
});
