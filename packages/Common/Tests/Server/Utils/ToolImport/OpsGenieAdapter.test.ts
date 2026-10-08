import { describe, expect, test } from "@jest/globals";
import OpsGenieAdapter, {
  toMinutes,
} from "../../../../Server/Utils/ToolImport/Adapters/OpsGenie/OpsGenieAdapter";
import {
  ToolImportReadContext,
  ToolImportReadError,
} from "../../../../Server/Utils/ToolImport/Types";
import DayOfWeek from "../../../../Types/Day/DayOfWeek";
import EventInterval from "../../../../Types/Events/EventInterval";
import {
  OPSGENIE_EU_HOST,
  OPSGENIE_REGION_EU,
  OPSGENIE_REGION_US,
  OPSGENIE_US_HOST,
} from "../../../../Types/ToolImport/ToolImportCatalog";
import {
  ToolImportNote,
  ToolImportNoteCode,
} from "../../../../Types/ToolImport/ToolImportNote";
import ToolImportResourceKind from "../../../../Types/ToolImport/ToolImportResourceKind";
import {
  ImportedPolicy,
  ImportedRotation,
  ImportedSchedule,
  ToolImportSnapshot,
} from "../../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../../Types/ToolImport/ToolImportSource";
import {
  ALICE_ID,
  BOB_ID,
  CAROL_ID,
  CHECKOUT_SERVICE_ID,
  NOBODY_ESCALATION_ID,
  OPSGENIE_KEY,
  OPSGENIE_TEAM_DETAILS,
  OPSGENIE_USERS,
  opsGenieApi,
  opsGenieError,
  opsGenieUser,
  PAYMENTS_TEAM_ID,
  PLATFORM_ESCALATION_ID,
  PLATFORM_SCHEDULE_ID,
  PLATFORM_TEAM_ID,
  WEEKEND_SCHEDULE_ID,
} from "./OpsGenieFixtures";
import { FixtureApi, json, RecordingSleep } from "./ToolImportFixtureTransport";

/*
 * The Opsgenie adapter against a fixture Opsgenie in the documented
 * response shapes: what an account becomes in OneUptime's words, the
 * requests it takes (the hosts, the header, the paging), and how it holds up
 * when the key is refused, a list is forbidden, one team is gone, or
 * Opsgenie says to slow down. Nothing here reaches a real Opsgenie.
 */

const NOW: number = Date.parse("2026-10-08T12:00:00Z");

function context(
  api: FixtureApi,
  overrides: Partial<ToolImportReadContext> = {},
): ToolImportReadContext {
  const clock: { now: number } = { now: NOW };
  const sleep: RecordingSleep = new RecordingSleep(clock);

  return {
    transport: api.transport,
    sleep: sleep.sleep,
    now: (): number => {
      return clock.now;
    },
    maxRequests: 500,
    deadlineAt: NOW + 15 * 60 * 1000,
    ...overrides,
  };
}

async function read(
  api: FixtureApi = opsGenieApi(),
  region: string = OPSGENIE_REGION_US,
  overrides: Partial<ToolImportReadContext> = {},
): Promise<ToolImportSnapshot> {
  return await new OpsGenieAdapter().read(
    {
      source: ToolImportSource.OpsGenie,
      apiKey: OPSGENIE_KEY,
      region: region,
    },
    context(api, overrides),
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

describe("OpsGenieAdapter: what an Opsgenie account becomes", () => {
  test("people keep their Opsgenie id and name, with the username as a lowercase email, and a blocked person reads as inactive", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(snapshot.source).toBe(ToolImportSource.OpsGenie);
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
        isActive: false,
        notes: [],
      },
    ]);
  });

  test("teams are read one by one for their members when the list leaves them out, as Opsgenie's does", async () => {
    const api: FixtureApi = opsGenieApi();
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
        memberSourceIds: [BOB_ID],
        notes: [],
      },
    ]);

    expect(api.callsTo(`/v2/teams/${PLATFORM_TEAM_ID}`)).toHaveLength(1);
    expect(
      api.callsTo(`/v2/teams/${PLATFORM_TEAM_ID}`)[0]!.searchParams.get(
        "identifierType",
      ),
    ).toBe("id");
  });

  test("a team list that carries its members is not read team by team", async () => {
    const api: FixtureApi = opsGenieApi().add({
      path: "/v2/teams",
      answers: [
        json({
          data: Object.values(OPSGENIE_TEAM_DETAILS),
          took: 0.1,
          requestId: "r",
        }),
      ],
    });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(snapshot.teams[0]!.memberSourceIds).toEqual([ALICE_ID, BOB_ID]);
    expect(api.callsTo(`/v2/teams/${PLATFORM_TEAM_ID}`)).toHaveLength(0);
    expect(api.callsTo(`/v2/teams/${PAYMENTS_TEAM_ID}`)).toHaveLength(0);
  });

  test("a team that is gone by the time it is read keeps no members, and the rest is still read", async () => {
    const api: FixtureApi = opsGenieApi().add({
      path: `/v2/teams/${PAYMENTS_TEAM_ID}`,
      answers: [json(opsGenieError(404, "Team not found"), 404)],
    });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(snapshot.teams.map((team: { name: string }) => team.name)).toEqual([
      "Platform",
      "Payments",
    ]);
    expect(snapshot.teams[1]!.memberSourceIds).toEqual([]);
    expect(snapshot.schedules).toHaveLength(2);
  });

  test("a weekly rotation keeps its start, length, people in order and weekday window", async () => {
    const schedule: ImportedSchedule = scheduleOf(
      await read(),
      PLATFORM_SCHEDULE_ID,
    );

    expect(schedule.name).toBe("Platform_schedule");
    expect(schedule.description).toBe("Who gets paged for the platform");
    expect(schedule.timezone).toBe("Europe/Istanbul");
    expect(schedule.isEnabled).toBe(true);
    expect(schedule.ownerTeamSourceIds).toEqual([PLATFORM_TEAM_ID]);

    const business: ImportedRotation = schedule.rotations[0]!;

    expect(business).toEqual({
      key: "f6a2b9d1-0c3e-4f5a-8b7c-1d2e3f4a5b6c",
      name: "Business hours",
      startsAt: "2024-02-05T06:00:00.000Z",
      intervalType: EventInterval.Week,
      intervalCount: 1,
      restriction: {
        type: "Weekly",
        windows: [
          {
            startDay: DayOfWeek.Monday,
            startTime: "09:00",
            endDay: DayOfWeek.Friday,
            endTime: "17:00",
          },
        ],
      },
      participantSourceIds: [ALICE_ID, BOB_ID],
      notes: [],
    });
  });

  test("'No one' turns and turns taken by a team are left out of a rotation, each with a note", async () => {
    const schedule: ImportedSchedule = scheduleOf(
      await read(),
      PLATFORM_SCHEDULE_ID,
    );
    const afterHours: ImportedRotation = schedule.rotations[1]!;

    expect(afterHours.name).toBe("After hours");
    expect(afterHours.intervalType).toBe(EventInterval.Day);
    expect(afterHours.intervalCount).toBe(2);
    expect(afterHours.participantSourceIds).toEqual([BOB_ID]);
    expect(codes(afterHours.notes)).toEqual([
      ToolImportNoteCode.RotationGaps,
      ToolImportNoteCode.RotationNonPersonTurns,
    ]);
    expect(afterHours.restriction).toEqual({
      type: "Weekly",
      windows: [
        {
          startDay: DayOfWeek.Friday,
          startTime: "17:00",
          endDay: DayOfWeek.Monday,
          endTime: "09:00",
        },
      ],
    });
  });

  test("a rotation that ended is left out, and the schedule says so", async () => {
    const schedule: ImportedSchedule = scheduleOf(
      await read(),
      PLATFORM_SCHEDULE_ID,
    );

    expect(
      schedule.rotations.map((rotation: ImportedRotation) => rotation.name),
    ).toEqual(["Business hours", "After hours"]);
    expect(schedule.notes).toContainEqual({
      code: ToolImportNoteCode.RotationEnded,
      values: { rotation: "Old rotation", date: "2023-06-01T06:00:00.000Z" },
    });
  });

  test("a time-of-day restriction is a daily window, overnight included, and an hourly rotation keeps its length", async () => {
    const schedule: ImportedSchedule = scheduleOf(
      await read(),
      WEEKEND_SCHEDULE_ID,
    );

    expect(schedule.isEnabled).toBe(false);
    expect(codes(schedule.notes)).toContain(ToolImportNoteCode.TurnedOffInSource);
    // An unknown zone is passed on as named: the preview says what it becomes.
    expect(schedule.timezone).toBe("Mars/Olympus_Mons");
    expect(schedule.ownerTeamSourceIds).toEqual([]);

    expect(schedule.rotations[0]).toMatchObject({
      name: "Primary",
      intervalType: EventInterval.Hour,
      intervalCount: 12,
      restriction: { type: "Daily", startTime: "22:00", endTime: "06:30" },
    });
    expect(schedule.rotations[1]!.restriction).toBeNull();
  });

  test("a rotation that ends later is kept, with a note that a OneUptime layer does not end", async () => {
    const api: FixtureApi = opsGenieApi();
    const schedule: Record<string, unknown> = {
      id: "s-ends",
      name: "Ends soon",
      timezone: "UTC",
      enabled: true,
      rotations: [
        {
          id: "r-ends",
          name: "Summer",
          startDate: "2026-06-01T00:00:00Z",
          endDate: "2026-12-01T00:00:00Z",
          type: "weekly",
          length: 1,
          participants: [{ type: "user", id: ALICE_ID }],
        },
      ],
    };

    api.add({
      path: "/v2/schedules",
      query: { expand: "rotation" },
      answers: [json({ data: [schedule], took: 0.1, requestId: "r" })],
    });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(snapshot.schedules[0]!.rotations[0]!.notes).toEqual([
      {
        code: ToolImportNoteCode.RotationEnds,
        values: { rotation: "Summer", date: "2026-12-01T00:00:00.000Z" },
      },
    ]);
  });

  test("a schedule listed without its rotations has them read on their own", async () => {
    const api: FixtureApi = opsGenieApi()
      .add({
        path: "/v2/schedules",
        query: { expand: "rotation" },
        answers: [
          json({
            data: [{ id: "s-lazy", name: "Lazy", timezone: "UTC", enabled: true }],
            took: 0.1,
            requestId: "r",
          }),
        ],
      })
      .add({
        path: "/v2/schedules/s-lazy/rotations",
        query: { scheduleIdentifierType: "id" },
        answers: [
          json({
            data: [
              {
                id: "r1",
                name: "Rota",
                startDate: "2026-01-05T09:00:00Z",
                type: "weekly",
                length: 1,
                participants: [
                  { type: "user", id: BOB_ID, username: "bob@example.com" },
                ],
              },
            ],
            took: 0.1,
            requestId: "r",
          }),
        ],
      });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(snapshot.schedules[0]!.rotations[0]!.participantSourceIds).toEqual([
      BOB_ID,
    ]);
  });

  test("escalation rules with the same delay page together; each level waits until the next delay", async () => {
    const policy: ImportedPolicy = policyOf(
      await read(),
      PLATFORM_ESCALATION_ID,
    );

    expect(policy.name).toBe("Platform_escalation");
    expect(policy.ownerTeamSourceIds).toEqual([PLATFORM_TEAM_ID]);
    expect(policy.repeatTimes).toBe(2);
    expect(policy.levels).toEqual([
      {
        escalateAfterMinutes: 5,
        personSourceIds: [],
        teamSourceIds: [],
        scheduleSourceIds: [PLATFORM_SCHEDULE_ID],
      },
      {
        escalateAfterMinutes: 55,
        personSourceIds: [BOB_ID],
        teamSourceIds: [],
        scheduleSourceIds: [],
      },
      {
        // The last level waits the repeat's wait before the policy runs again.
        escalateAfterMinutes: 10,
        personSourceIds: [],
        teamSourceIds: [PLATFORM_TEAM_ID],
        scheduleSourceIds: [WEEKEND_SCHEDULE_ID],
      },
    ]);
  });

  test("what an escalation cannot carry over exactly is noted once each", async () => {
    const policy: ImportedPolicy = policyOf(
      await read(),
      PLATFORM_ESCALATION_ID,
    );

    expect(codes(policy.notes).sort()).toEqual(
      [
        ToolImportNoteCode.PolicyNextOnCall,
        ToolImportNoteCode.PolicyTeamAdmins,
        ToolImportNoteCode.PolicyWaitsForClose,
      ].sort(),
    );
  });

  test("an escalation with no rules has no levels, and without a repeat its last level waits the default 30 minutes", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(policyOf(snapshot, NOBODY_ESCALATION_ID).levels).toEqual([]);

    const api: FixtureApi = opsGenieApi().add({
      path: "/v2/escalations",
      answers: [
        json({
          data: [
            {
              id: "e-once",
              name: "Once",
              rules: [
                {
                  condition: "if-not-acked",
                  notifyType: "default",
                  delay: { timeAmount: 10, timeUnit: "minutes" },
                  recipient: { type: "user", id: ALICE_ID },
                },
              ],
            },
          ],
          took: 0.1,
          requestId: "r",
        }),
      ],
    });

    const once: ImportedPolicy = (await read(api)).policies[0]!;

    expect(once.repeatTimes).toBe(0);
    expect(once.levels[0]!.escalateAfterMinutes).toBe(30);
    // The first level waited 10 minutes in Opsgenie; OneUptime pages it at once.
    expect(once.notes).toEqual([
      {
        code: ToolImportNoteCode.PolicyFirstStepWaits,
        values: { minutes: 10 },
      },
    ]);
  });

  test("a schedule paged as 'all' pages everyone who takes turns in it", async () => {
    const api: FixtureApi = opsGenieApi().add({
      path: "/v2/escalations",
      answers: [
        json({
          data: [
            {
              id: "e-all",
              name: "Everyone",
              rules: [
                {
                  condition: "if-not-acked",
                  notifyType: "all",
                  delay: { timeAmount: 0, timeUnit: "minutes" },
                  recipient: { type: "schedule", id: PLATFORM_SCHEDULE_ID },
                },
              ],
            },
          ],
          took: 0.1,
          requestId: "r",
        }),
      ],
    });

    const policy: ImportedPolicy = (await read(api)).policies[0]!;

    expect(policy.levels[0]!.personSourceIds).toEqual([ALICE_ID, BOB_ID]);
    expect(policy.levels[0]!.scheduleSourceIds).toEqual([]);
  });

  test("services keep their owner team", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(snapshot.services).toEqual([
      {
        sourceId: CHECKOUT_SERVICE_ID,
        name: "Checkout",
        description: "Takes the money",
        ownerTeamSourceIds: [PAYMENTS_TEAM_ID],
        notes: [],
      },
    ]);
  });

  test("Opsgenie has no incident settings to bring over", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(snapshot.incidentSeverities).toEqual([]);
    expect(snapshot.incidentStates).toEqual([]);
    expect(snapshot.incidentRoles).toEqual([]);
    expect(snapshot.incidentCustomFields).toEqual([]);
  });
});

describe("OpsGenieAdapter: the requests it makes", () => {
  test("every request goes to api.opsgenie.com with the GenieKey header, for the US region", async () => {
    const api: FixtureApi = opsGenieApi();
    await read(api, OPSGENIE_REGION_US);

    expect(api.requests.length).toBeGreaterThan(0);

    for (const request of api.requests) {
      expect(new URL(request.url).host).toBe(OPSGENIE_US_HOST);
      expect(new URL(request.url).protocol).toBe("https:");
      expect(request.method).toBe("GET");
      expect(request.headers["Authorization"]).toBe(`GenieKey ${OPSGENIE_KEY}`);
    }
  });

  test("an account in the EU region is read from api.eu.opsgenie.com", async () => {
    const api: FixtureApi = opsGenieApi();
    await read(api, OPSGENIE_REGION_EU);

    for (const request of api.requests) {
      expect(new URL(request.url).host).toBe(OPSGENIE_EU_HOST);
    }
  });

  test("a region that is not one of Opsgenie's is refused before anything is called", async () => {
    const api: FixtureApi = opsGenieApi();

    await expect(read(api, "MARS")).rejects.toThrow(ToolImportReadError);
    expect(api.requests).toHaveLength(0);
  });

  test("people are paged by offset until a short page", async () => {
    const firstPage: Array<Record<string, unknown>> = [];

    for (let index: number = 0; index < 100; index++) {
      firstPage.push(
        opsGenieUser({
          id: `u-${index}`,
          username: `person${index}@example.com`,
          fullName: `Person ${index}`,
        }),
      );
    }

    const api: FixtureApi = opsGenieApi()
      .add({
        path: "/v2/users",
        query: { offset: "0" },
        answers: [
          json({
            data: firstPage,
            totalCount: 101,
            paging: { next: "https://api.opsgenie.com/v2/users?offset=100" },
            took: 0.1,
            requestId: "r",
          }),
        ],
      })
      .add({
        path: "/v2/users",
        query: { offset: "100" },
        answers: [
          json({
            data: [OPSGENIE_USERS[0]],
            totalCount: 101,
            paging: {},
            took: 0.1,
            requestId: "r",
          }),
        ],
      });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(snapshot.people).toHaveLength(101);
    expect(
      api.callsTo("/v2/users").map((url: URL) => {
        return [url.searchParams.get("offset"), url.searchParams.get("limit")];
      }),
    ).toEqual([
      ["0", "100"],
      ["100", "100"],
    ]);
  });

  test("the read is reported kind by kind, in the order it reads them", async () => {
    const seen: Array<ToolImportResourceKind> = [];

    await read(opsGenieApi(), OPSGENIE_REGION_US, {
      onProgress: async (kind: ToolImportResourceKind): Promise<void> => {
        seen.push(kind);
      },
    });

    expect(seen).toEqual([
      ToolImportResourceKind.Person,
      ToolImportResourceKind.Team,
      ToolImportResourceKind.OnCallSchedule,
      ToolImportResourceKind.OnCallPolicy,
      ToolImportResourceKind.Service,
    ]);
  });
});

describe("OpsGenieAdapter: when Opsgenie says no", () => {
  test("a refused key stops the read with what to check, and never repeats the key", async () => {
    const api: FixtureApi = opsGenieApi().add({
      path: "/v2/account",
      answers: [json(opsGenieError(401, `Key ${OPSGENIE_KEY} is invalid`), 401)],
    });

    let error: unknown = undefined;

    try {
      await read(api);
    } catch (thrown) {
      error = thrown;
    }

    expect(error).toBeInstanceOf(ToolImportReadError);
    expect((error as Error).message).toContain(
      "Opsgenie did not accept the API key",
    );
    expect((error as Error).message).toContain("Configuration access");
    expect((error as Error).message).not.toContain(OPSGENIE_KEY);
    // Nothing else is read once the key is refused.
    expect(api.callsTo("/v2/users")).toHaveLength(0);
  });

  test("a list the key may not read is a note, and the rest is still read", async () => {
    const api: FixtureApi = opsGenieApi().add({
      path: "/v2/schedules",
      query: { expand: "rotation" },
      answers: [json(opsGenieError(403, "Forbidden"), 403)],
    });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(snapshot.schedules).toEqual([]);
    expect(snapshot.notes).toEqual([
      {
        code: ToolImportNoteCode.CouldNotRead,
        values: { kind: ToolImportResourceKind.OnCallSchedule },
      },
    ]);
    expect(snapshot.people).toHaveLength(3);
    expect(snapshot.policies.length).toBeGreaterThan(0);
  });

  test("an account without the services API is noted, not failed", async () => {
    const api: FixtureApi = opsGenieApi().add({
      path: "/v1/services",
      answers: [json(opsGenieError(404, "Not found"), 404)],
    });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(snapshot.services).toEqual([]);
    expect(codes(snapshot.notes)).toEqual([ToolImportNoteCode.CouldNotRead]);
  });

  test("a key that can read nothing at all stops the read", async () => {
    const forbidden: () => ReturnType<typeof json> = () => {
      return json(opsGenieError(403, "Forbidden"), 403);
    };
    const api: FixtureApi = opsGenieApi()
      .add({ path: "/v2/account", answers: [forbidden()] })
      .add({ path: "/v2/users", answers: [forbidden()] })
      .add({ path: "/v2/teams", answers: [forbidden()] })
      .add({
        path: "/v2/schedules",
        query: { expand: "rotation" },
        answers: [forbidden()],
      })
      .add({ path: "/v2/escalations", answers: [forbidden()] })
      .add({ path: "/v1/services", answers: [forbidden()] });

    await expect(read(api)).rejects.toThrow(
      "The API key could not read anything from Opsgenie",
    );
  });

  test("a 429 waits as Opsgenie asks, then reads on", async () => {
    const clock: { now: number } = { now: NOW };
    const sleep: RecordingSleep = new RecordingSleep(clock);
    const api: FixtureApi = opsGenieApi().add({
      path: "/v2/escalations",
      answers: [
        json(opsGenieError(429, "You are making too many requests"), 429, {
          "retry-after": "3",
          "x-ratelimit-state": "THROTTLED",
        }),
        json({ data: [], took: 0.1, requestId: "r" }),
      ],
    });

    const snapshot: ToolImportSnapshot = await new OpsGenieAdapter().read(
      {
        source: ToolImportSource.OpsGenie,
        apiKey: OPSGENIE_KEY,
        region: OPSGENIE_REGION_US,
      },
      {
        transport: api.transport,
        sleep: sleep.sleep,
        now: (): number => {
          return clock.now;
        },
        maxRequests: 500,
        deadlineAt: NOW + 60 * 60 * 1000,
      },
    );

    expect(sleep.waits).toEqual([3000]);
    expect(api.callsTo("/v2/escalations")).toHaveLength(2);
    expect(snapshot.policies).toEqual([]);
  });

  test("the snapshot never holds the key", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(JSON.stringify(snapshot)).not.toContain(OPSGENIE_KEY);
  });

  test("the request budget stops a read that would never end", async () => {
    const api: FixtureApi = opsGenieApi();

    await expect(
      read(api, OPSGENIE_REGION_US, { maxRequests: 3 }),
    ).rejects.toThrow("took more than 3 requests");
    expect(api.requests.length).toBeLessThanOrEqual(3);
  });

  test("nothing but the documented endpoints is called", async () => {
    const api: FixtureApi = opsGenieApi();
    await read(api);

    const paths: Set<string> = new Set<string>(
      api.urls.map((url: URL): string => {
        return url.pathname.startsWith("/v2/teams/")
          ? "/v2/teams/{id}"
          : url.pathname;
      }),
    );

    expect([...paths].sort()).toEqual(
      [
        "/v1/services",
        "/v2/account",
        "/v2/escalations",
        "/v2/schedules",
        "/v2/teams",
        "/v2/teams/{id}",
        "/v2/users",
      ].sort(),
    );
  });
});

describe("OpsGenieAdapter: Opsgenie's delays as minutes", () => {
  test.each([
    [{ timeAmount: 0, timeUnit: "minutes" }, 0],
    [{ timeAmount: 5 }, 5],
    [{ timeAmount: 2, timeUnit: "hours" }, 120],
    [{ timeAmount: 1, timeUnit: "days" }, 1440],
    [{ timeAmount: 90, timeUnit: "seconds" }, 2],
    [{ timeAmount: 30000, timeUnit: "miliseconds" }, 1],
    [{ timeAmount: 7, timeUnit: "nanos" }, 0],
    [{ timeAmount: -4, timeUnit: "minutes" }, 0],
  ] as Array<[Record<string, unknown>, number]>)(
    "%j is %i minutes",
    (delay: Record<string, unknown>, minutes: number) => {
      expect(toMinutes(delay)).toBe(minutes);
    },
  );
});
