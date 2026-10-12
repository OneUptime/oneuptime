import { describe, expect, test } from "@jest/globals";
import GrafanaOnCallAdapter, {
  getFirstTurnStart,
  parseGrafanaTime,
  toAccountName,
  toLevels,
  toRotationPattern,
  toRotations,
} from "../../../../Server/Utils/ToolImport/Adapters/GrafanaOnCall/GrafanaOnCallAdapter";
import { ToolImportPeopleIndex } from "../../../../Server/Utils/ToolImport/ToolImportAdapterSupport";
import {
  ToolImportReadContext,
  ToolImportReadError,
} from "../../../../Server/Utils/ToolImport/Types";
import DayOfWeek from "../../../../Types/Day/DayOfWeek";
import EventInterval from "../../../../Types/Events/EventInterval";
import {
  ToolImportNote,
  ToolImportNoteCode,
} from "../../../../Types/ToolImport/ToolImportNote";
import ToolImportResourceKind from "../../../../Types/ToolImport/ToolImportResourceKind";
import {
  getGroupScheduleName,
  groupRotationsIntoSchedules,
} from "../../../../Types/ToolImport/ToolImportScheduleRules";
import {
  ImportedPerson,
  ImportedPolicy,
  ImportedRotation,
  ImportedSchedule,
  ToolImportSnapshot,
} from "../../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../../Types/ToolImport/ToolImportSource";
import {
  ALICE_ID,
  BOB_ID,
  CALENDAR_SCHEDULE_ID,
  CAROL_ID,
  CRITICAL_CHAIN_ID,
  GRAFANA_API_URL,
  GRAFANA_HOST,
  GRAFANA_TOKEN,
  GRAFANA_USERS,
  grafanaError,
  grafanaOnCallApi,
  ICAL_SCHEDULE_ID,
  LOW_CHAIN_ID,
  page,
  PAYMENTS_TEAM_ID,
  PLATFORM_TEAM_ID,
  WEB_SCHEDULE_ID,
} from "./GrafanaOnCallFixtures";
import { FixtureApi, json, RecordingSleep } from "./ToolImportFixtureTransport";
import moment from "moment-timezone";

/*
 * The Grafana OnCall adapter against a fixture Grafana OnCall in the
 * documented response shapes: what an organisation becomes in OneUptime's
 * words - layer priorities kept as precedence, rotations with several
 * people on call at once as one layer each, times moved from the zone a
 * rotation keeps into the schedule's, a rotation edited later started from
 * the turn under way then - the requests it makes (only at the address the
 * person gave, under its path, never following a `next` link, one a
 * second) and how it holds up when the token is refused. Nothing here
 * reaches a real Grafana OnCall.
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
  api: FixtureApi = grafanaOnCallApi(),
  apiUrl: string = GRAFANA_API_URL,
  sleep?: RecordingSleep,
  overrides: Partial<ToolImportReadContext> = {},
): Promise<ToolImportSnapshot> {
  return await new GrafanaOnCallAdapter().read(
    {
      source: ToolImportSource.GrafanaOnCall,
      apiKey: GRAFANA_TOKEN,
      apiUrl: apiUrl,
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

function names(rotations: Array<ImportedRotation>): Array<string> {
  return rotations.map((rotation: ImportedRotation): string => {
    return rotation.name;
  });
}

function codes(notes: Array<ToolImportNote>): Array<ToolImportNoteCode> {
  return notes.map((note: ToolImportNote): ToolImportNoteCode => {
    return note.code;
  });
}

const PEOPLE: Array<ImportedPerson> = [
  {
    sourceId: ALICE_ID,
    name: "alice",
    email: "alice@example.com",
    isActive: true,
    notes: [],
  },
  {
    sourceId: BOB_ID,
    name: "bob",
    email: "bob@example.com",
    isActive: true,
    notes: [],
  },
  {
    sourceId: CAROL_ID,
    name: "carol",
    email: "carol@example.com",
    isActive: true,
    notes: [],
  },
];

describe("GrafanaOnCallAdapter: what a Grafana OnCall organisation becomes", () => {
  test("people keep their OnCall id, with their username as their name and a lowercase email", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(snapshot.source).toBe(ToolImportSource.GrafanaOnCall);
    expect(snapshot.people).toEqual(PEOPLE);
    // Grafana Cloud's OnCall host is shared by many stacks: it names nobody's.
    expect(snapshot.accountName).toBeUndefined();
  });

  test("teams take their members from the teams each person lists", async () => {
    expect((await read()).teams).toEqual([
      {
        sourceId: PLATFORM_TEAM_ID,
        name: "Platform",
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
  });

  test("a web schedule's rotations keep their layer priority; a one-off shift and an override do not come over", async () => {
    const web: ImportedSchedule = scheduleOf(await read(), WEB_SCHEDULE_ID);

    expect(web).toMatchObject({
      name: "Platform primary",
      timezone: "Europe/Berlin",
      isEnabled: true,
      ownerTeamSourceIds: [PLATFORM_TEAM_ID],
    });
    expect(names(web.rotations)).toEqual([
      "Office hours",
      "Night and weekend",
      "Pair support (1)",
      "Pair support (2)",
    ]);
    expect(
      web.rotations.map((rotation: ImportedRotation) => {
        return rotation.precedence;
      }),
    ).toEqual([2, 1, 0, 0]);
    expect(web.notes).toEqual([
      {
        code: ToolImportNoteCode.RotationLayers,
        values: { rotation: "Pair support", count: 2 },
      },
      {
        code: ToolImportNoteCode.RotationOneOff,
        values: { rotation: "Launch day" },
      },
    ]);
  });

  test("a web rotation's hours are kept in UTC, so they come over in the schedule's zone as they are today, with a note", async () => {
    const office: ImportedRotation = rotationOf(
      scheduleOf(await read(), WEB_SCHEDULE_ID),
      "Office hours",
    );

    // 08:00-16:00 UTC is 10:00-18:00 in Berlin in October (UTC+2).
    expect(office).toEqual({
      key: "OOFFICE00001",
      name: "Office hours",
      startsAt: "2026-01-05T08:00:00.000Z",
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
            startTime: "10:00",
            endDay: day,
            endTime: "18:00",
          };
        }),
      },
      participantSourceIds: [CAROL_ID, ALICE_ID],
      precedence: 2,
      notes: [
        {
          code: ToolImportNoteCode.RotationTimezoneConverted,
          values: { rotation: "Office hours", timezone: "UTC" },
        },
      ],
    });
  });

  test("a rotation edited in the web UI starts from the turn under way when it was edited, round the clock", async () => {
    const nights: ImportedRotation = rotationOf(
      scheduleOf(await read(), WEB_SCHEDULE_ID),
      "Night and weekend",
    );

    // Edited on Wednesday March 4: the week that began on Monday March 2.
    expect(nights).toEqual({
      key: "ONIGHTS00002",
      name: "Night and weekend",
      startsAt: "2026-03-02T08:00:00.000Z",
      intervalType: EventInterval.Week,
      intervalCount: 1,
      restriction: null,
      participantSourceIds: [ALICE_ID, BOB_ID],
      precedence: 1,
      notes: [],
    });
  });

  test("a group of two on call together becomes two layers, one per place in the group", async () => {
    const web: ImportedSchedule = scheduleOf(await read(), WEB_SCHEDULE_ID);

    expect(rotationOf(web, "Pair support (1)")).toEqual({
      key: "OPAIR0000003:1",
      name: "Pair support (1)",
      startsAt: "2026-01-05T00:00:00.000Z",
      intervalType: EventInterval.Day,
      intervalCount: 1,
      restriction: null,
      participantSourceIds: [ALICE_ID],
      precedence: 0,
      notes: [],
    });
    expect(rotationOf(web, "Pair support (2)").participantSourceIds).toEqual([
      BOB_ID,
    ]);
  });

  test("higher layers sit on top of every schedule the pair splits into, so they still override both", async () => {
    const web: ImportedSchedule = scheduleOf(await read(), WEB_SCHEDULE_ID);
    const groups: Array<Array<ImportedRotation>> = groupRotationsIntoSchedules(
      web.rotations,
    );

    expect(groups.map(names)).toEqual([
      ["Office hours", "Night and weekend", "Pair support (1)"],
      ["Office hours", "Night and weekend", "Pair support (2)"],
    ]);
    expect(
      getGroupScheduleName({
        scheduleName: web.name,
        groupIndex: 1,
        group: groups[1]!,
        groups: groups,
        maxLength: 100,
      }),
    ).toBe("Platform primary (Pair support (2))");
  });

  test("a calendar schedule's rotation keeps the schedule's zone, starts from the group it names, and its end is noted", async () => {
    const calendar: ImportedSchedule = scheduleOf(
      await read(),
      CALENDAR_SCHEDULE_ID,
    );

    expect(calendar).toMatchObject({
      name: "Payments API",
      timezone: "America/New_York",
      ownerTeamSourceIds: [PAYMENTS_TEAM_ID],
    });
    expect(calendar.rotations).toEqual([
      {
        key: "OCALDAILY005",
        name: "Payments days",
        startsAt: "2026-02-02T14:00:00.000Z",
        intervalType: EventInterval.Day,
        intervalCount: 1,
        restriction: { type: "Daily", startTime: "09:00", endTime: "17:00" },
        participantSourceIds: [CAROL_ID, BOB_ID],
        precedence: 0,
        notes: [
          {
            code: ToolImportNoteCode.RotationEnds,
            values: {
              rotation: "Payments days",
              date: "2027-03-01T05:00:00.000Z",
            },
          },
        ],
      },
    ]);
    expect(calendar.notes).toEqual([
      {
        code: ToolImportNoteCode.RotationEnded,
        values: { rotation: "Old rota", date: "2026-01-01T05:00:00.000Z" },
      },
    ]);
  });

  test("a schedule read from an iCal link comes over without layers, with a note", async () => {
    expect(scheduleOf(await read(), ICAL_SCHEDULE_ID)).toEqual({
      sourceId: ICAL_SCHEDULE_ID,
      name: "Legacy calendar",
      timezone: "UTC",
      isEnabled: true,
      ownerTeamSourceIds: [],
      rotations: [],
      notes: [{ code: ToolImportNoteCode.ScheduleFromCalendarLink }],
    });
  });

  test("an escalation chain's steps between waits page together; a wait is the level's; a repeat repeats it five times", async () => {
    expect(policyOf(await read(), CRITICAL_CHAIN_ID)).toEqual({
      sourceId: CRITICAL_CHAIN_ID,
      name: "Platform critical",
      ownerTeamSourceIds: [PLATFORM_TEAM_ID],
      levels: [
        {
          escalateAfterMinutes: 5,
          personSourceIds: [BOB_ID],
          teamSourceIds: [],
          scheduleSourceIds: [WEB_SCHEDULE_ID],
        },
        {
          escalateAfterMinutes: 10,
          personSourceIds: [],
          teamSourceIds: [PLATFORM_TEAM_ID],
          scheduleSourceIds: [],
        },
        {
          escalateAfterMinutes: 30,
          personSourceIds: [ALICE_ID, CAROL_ID],
          teamSourceIds: [],
          scheduleSourceIds: [],
        },
      ],
      repeatTimes: 5,
      // The channel step after the repeat never runs, so it is not noted.
      notes: [
        { code: ToolImportNoteCode.PolicyWebhookStep },
        { code: ToolImportNoteCode.PolicyRoundRobin },
        { code: ToolImportNoteCode.PolicyConditionalStep },
      ],
    });
  });

  test("a chain that waits first, pages a Slack user group and resolves the alert says so for each", async () => {
    expect(policyOf(await read(), LOW_CHAIN_ID)).toEqual({
      sourceId: LOW_CHAIN_ID,
      name: "Low urgency",
      ownerTeamSourceIds: [],
      levels: [
        {
          escalateAfterMinutes: 30,
          personSourceIds: [CAROL_ID],
          teamSourceIds: [],
          scheduleSourceIds: [],
        },
      ],
      repeatTimes: 0,
      notes: [
        { code: ToolImportNoteCode.PolicyUserGroup },
        { code: ToolImportNoteCode.PolicyResolvesAlert },
        {
          code: ToolImportNoteCode.PolicyFirstStepWaits,
          values: { minutes: 2 },
        },
      ],
    });
  });

  test("Grafana OnCall has no services or incident settings to bring over", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(snapshot.services).toEqual([]);
    expect(snapshot.incidentSeverities).toEqual([]);
    expect(snapshot.incidentCustomFields).toEqual([]);
    expect(snapshot.notes).toEqual([]);
  });
});

describe("GrafanaOnCallAdapter: the requests it makes", () => {
  test("every request goes to the address given, under its path, with the token as it is", async () => {
    const api: FixtureApi = grafanaOnCallApi();
    await read(api);

    expect(
      api.urls.map((url: URL): string => {
        return `${url.host}${url.pathname}?${url.search.slice(1)}`;
      }),
    ).toEqual(
      [
        "users",
        "teams",
        "schedules",
        "on_call_shifts",
        "escalation_chains",
        "escalation_policies",
      ].map((list: string): string => {
        return `${GRAFANA_HOST}/oncall/api/v1/${list}/?page=1&perpage=100`;
      }),
    );

    for (const request of api.requests) {
      expect(request.headers["Authorization"]).toBe(GRAFANA_TOKEN);
      expect(request.url).not.toContain(GRAFANA_TOKEN);
    }
  });

  test("pages are asked for by number at the address given; a page's next link is never followed", async () => {
    const api: FixtureApi = grafanaOnCallApi()
      .add({
        path: "/oncall/api/v1/users/",
        query: { page: "1" },
        answers: [
          json({
            ...(page("users", GRAFANA_USERS.slice(0, 2), {
              page: 1,
              totalPages: 2,
            }) as Record<string, unknown>),
            next: "https://attacker.example/oncall/api/v1/users/?page=2",
          }),
        ],
      })
      .add({
        path: "/oncall/api/v1/users/",
        query: { page: "2" },
        answers: [
          json(
            page("users", GRAFANA_USERS.slice(2), { page: 2, totalPages: 2 }),
          ),
        ],
      });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(snapshot.people).toHaveLength(3);
    expect(
      api.callsTo("/oncall/api/v1/users/").map((url: URL) => {
        return url.searchParams.get("page");
      }),
    ).toEqual(["1", "2"]);
    for (const url of api.urls) {
      expect(url.host).toBe(GRAFANA_HOST);
    }
  });

  test("requests keep to one a second, Grafana OnCall's own limit", async () => {
    const sleep: RecordingSleep = new RecordingSleep({ now: NOW });
    const api: FixtureApi = grafanaOnCallApi();

    await read(api, GRAFANA_API_URL, sleep);

    expect(sleep.waits).toEqual(
      Array.from({ length: api.requests.length - 1 }, () => {
        return 1000;
      }),
    );
  });

  test("a self-hosted install is read at its own address, its path and port kept, and named in the history", async () => {
    const api: FixtureApi = grafanaOnCallApi("");
    const snapshot: ToolImportSnapshot = await read(
      api,
      "http://oncall.acme.internal:8080/",
    );

    expect(snapshot.accountName).toBe("oncall.acme.internal");
    expect(api.urls[0]!.toString()).toBe(
      "http://oncall.acme.internal:8080/api/v1/users/?page=1&perpage=100",
    );
    for (const url of api.urls) {
      expect(url.host).toBe("oncall.acme.internal:8080");
    }
  });

  test("an address pasted with the API's own /api/v1 on it reads the same", async () => {
    const api: FixtureApi = grafanaOnCallApi();

    await read(api, `${GRAFANA_API_URL}/api/v1/`);

    expect(api.urls[0]!.pathname).toBe("/oncall/api/v1/users/");
  });

  test("schedules from iCal links alone need no rotations read, and no chains need no steps read", async () => {
    const api: FixtureApi = grafanaOnCallApi()
      .add({
        path: "/oncall/api/v1/schedules/",
        answers: [
          json(
            page("schedules", [
              {
                id: ICAL_SCHEDULE_ID,
                name: "Legacy calendar",
                type: "ical",
                team_id: null,
              },
            ]),
          ),
        ],
      })
      .add({
        path: "/oncall/api/v1/escalation_chains/",
        answers: [json(page("escalation_chains", []))],
      });

    await read(api);

    expect(api.callsTo("/oncall/api/v1/on_call_shifts/")).toEqual([]);
    expect(api.callsTo("/oncall/api/v1/escalation_policies/")).toEqual([]);
  });
});

describe("GrafanaOnCallAdapter: when Grafana OnCall says no", () => {
  test.each([401, 403])(
    "a token it refuses with a %i stops the read at once, with what to check, never repeating it",
    async (status: number) => {
      const api: FixtureApi = grafanaOnCallApi().add({
        path: "/oncall/api/v1/users/",
        answers: [
          json(grafanaError(`Invalid token. ${GRAFANA_TOKEN}`), status),
        ],
      });

      const error: unknown = await read(api).catch((caught: unknown) => {
        return caught;
      });

      expect(error).toBeInstanceOf(ToolImportReadError);
      expect((error as Error).message).toContain(
        "Grafana OnCall did not accept the API key.",
      );
      expect((error as Error).message).toContain("not a service account token");
      expect((error as Error).message).not.toContain(GRAFANA_TOKEN);
      expect(api.requests).toHaveLength(1);
    },
  );

  test("a list the token may not read is a note, and the rest is still read", async () => {
    const api: FixtureApi = grafanaOnCallApi().add({
      path: "/oncall/api/v1/escalation_chains/",
      answers: [
        json(
          grafanaError("You do not have permission to perform this action."),
          403,
        ),
      ],
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

  test("a 429 waits as Grafana OnCall asks, then reads on", async () => {
    const sleep: RecordingSleep = new RecordingSleep({ now: NOW });
    const api: FixtureApi = grafanaOnCallApi().add({
      path: "/oncall/api/v1/teams/",
      answers: [
        json(grafanaError("Request was throttled."), 429, {
          "retry-after": "20",
        }),
        json(page("teams", [])),
      ],
    });

    const snapshot: ToolImportSnapshot = await read(
      api,
      GRAFANA_API_URL,
      sleep,
    );

    expect(sleep.waits).toContain(20000);
    expect(snapshot.teams).toEqual([]);
    expect(snapshot.policies).toHaveLength(2);
  });

  test("the snapshot never holds the token", async () => {
    expect(JSON.stringify(await read())).not.toContain(GRAFANA_TOKEN);
  });
});

describe("GrafanaOnCallAdapter: Grafana OnCall's words in OneUptime's", () => {
  const index: ToolImportPeopleIndex = new ToolImportPeopleIndex(PEOPLE);

  test("times without a zone are read in the rotation's zone; a time with one is that instant", () => {
    expect(
      parseGrafanaTime(
        "2026-01-05T09:00:00",
        "America/New_York",
      )?.toISOString(),
    ).toBe("2026-01-05T14:00:00.000Z");
    expect(
      parseGrafanaTime("2026-07-05T09:00:00", "Europe/Berlin")?.toISOString(),
    ).toBe("2026-07-05T07:00:00.000Z");
    expect(
      parseGrafanaTime(
        "2026-01-05T09:00:00Z",
        "America/New_York",
      )?.toISOString(),
    ).toBe("2026-01-05T09:00:00.000Z");
    expect(parseGrafanaTime("", "UTC")).toBeNull();
    expect(parseGrafanaTime("not a time", "UTC")).toBeNull();
  });

  test("recurrences OneUptime can only come close to are not exact; one group never hands over to anyone else", () => {
    const start: moment.Moment = moment.tz("2026-01-05T09:00:00", "UTC");
    const pattern: (
      data: Partial<Parameters<typeof toRotationPattern>[0]>,
    ) => ReturnType<typeof toRotationPattern> = (
      data: Partial<Parameters<typeof toRotationPattern>[0]>,
    ) => {
      return toRotationPattern({
        frequency: "daily",
        interval: 1,
        byDay: [],
        hasCalendarRules: false,
        start: start,
        durationMinutes: 480,
        groupCount: 2,
        ...data,
      });
    };

    // Every day, 09:00 for 8 hours: exact.
    expect(pattern({})).toEqual({
      intervalType: EventInterval.Day,
      intervalCount: 1,
      restriction: { type: "Daily", startTime: "09:00", endTime: "17:00" },
      isTurnExact: true,
      isRestrictionExact: true,
    });
    // Every other day: the hours are only every other day.
    expect(pattern({ interval: 2 }).isRestrictionExact).toBe(false);
    // Weekdays, handing over each weekday: OneUptime counts every day.
    expect(pattern({ byDay: ["MO", "TU", "WE", "TH", "FR"] }).isTurnExact).toBe(
      false,
    );
    expect(
      pattern({ byDay: ["MO", "TU", "WE", "TH", "FR"], groupCount: 1 })
        .isTurnExact,
    ).toBe(true);
    // A week from Monday 09:00 for five days: one weekly window.
    expect(
      pattern({ frequency: "weekly", durationMinutes: 5 * 24 * 60 })
        .restriction,
    ).toEqual({
      type: "Weekly",
      windows: [
        {
          startDay: DayOfWeek.Monday,
          startTime: "09:00",
          endDay: DayOfWeek.Saturday,
          endTime: "09:00",
        },
      ],
    });
    // Hours within an hour, days of the month: not a day's window.
    expect(
      pattern({ frequency: "hourly", interval: 4, durationMinutes: 60 }),
    ).toMatchObject({
      intervalType: EventInterval.Hour,
      intervalCount: 4,
      restriction: null,
      isRestrictionExact: false,
    });
    expect(
      pattern({ frequency: "monthly", durationMinutes: 7 * 24 * 60 }),
    ).toMatchObject({
      intervalType: EventInterval.Month,
      isRestrictionExact: false,
    });
    expect(pattern({ hasCalendarRules: true }).isRestrictionExact).toBe(false);
    // Round the clock is no restriction at all.
    expect(
      pattern({ frequency: "weekly", durationMinutes: 7 * 24 * 60 }),
    ).toMatchObject({ restriction: null, isRestrictionExact: true });
  });

  test("the first turn of an edited rotation is the one under way then, however long ago it started", () => {
    const start: moment.Moment = moment.tz("2016-01-31T09:00:00", "UTC");

    // Monthly from January 31st, ten years on: never a turn too far.
    const monthly: moment.Moment = getFirstTurnStart({
      start: start,
      rotationStart: moment.tz("2026-03-15T00:00:00", "UTC"),
      frequency: "monthly",
      interval: 1,
      durationMinutes: 24 * 60,
    });
    expect(monthly.toISOString()).toBe("2026-03-31T09:00:00.000Z");

    // Under way at the edit: that turn.
    expect(
      getFirstTurnStart({
        start: moment.tz("2026-01-05T08:00:00", "UTC"),
        rotationStart: moment.tz("2026-01-07T00:00:00", "UTC"),
        frequency: "weekly",
        interval: 1,
        durationMinutes: 7 * 24 * 60,
      }).toISOString(),
    ).toBe("2026-01-05T08:00:00.000Z");

    // Not edited: its start.
    expect(
      getFirstTurnStart({
        start: start,
        rotationStart: start,
        frequency: "daily",
        interval: 1,
        durationMinutes: 60,
      }).toISOString(),
    ).toBe(start.toISOString());
  });

  test("a recurrent event pages the same people every time, one layer each; a group nobody is brought over for is a gap", () => {
    const scheduleNotes: Array<ToolImportNote> = [];
    const rotations: Array<ImportedRotation> = toRotations({
      shift: {
        id: "OREC",
        name: "Standup cover",
        type: "recurrent_event",
        level: 4,
        start: "2026-01-05T09:00:00",
        duration: 3600,
        frequency: "weekly",
        interval: 1,
        by_day: ["MO"],
        users: [ALICE_ID, BOB_ID],
      },
      index: 0,
      defaultTimezone: "UTC",
      scheduleTimezone: "UTC",
      peopleIndex: index,
      now: NOW,
      scheduleNotes: scheduleNotes,
    });

    expect(
      rotations.map((rotation: ImportedRotation) => {
        return [
          rotation.name,
          rotation.participantSourceIds,
          rotation.precedence,
        ];
      }),
    ).toEqual([
      ["Standup cover (1)", [ALICE_ID], 4],
      ["Standup cover (2)", [BOB_ID], 4],
    ]);
    expect(rotations[0]!.restriction).toEqual({
      type: "Weekly",
      windows: [
        {
          startDay: DayOfWeek.Monday,
          startTime: "09:00",
          endDay: DayOfWeek.Monday,
          endTime: "10:00",
        },
      ],
    });
    expect(codes(scheduleNotes)).toEqual([ToolImportNoteCode.RotationLayers]);

    const gapNotes: Array<ToolImportNote> = [];
    const withGap: Array<ImportedRotation> = toRotations({
      shift: {
        id: "OGAP",
        name: "With a gap",
        type: "rolling_users",
        start: "2026-01-05T09:00:00",
        duration: 604800,
        frequency: "weekly",
        interval: 1,
        rolling_users: [[ALICE_ID], ["UNOBODY0000"], [CAROL_ID]],
      },
      index: 0,
      defaultTimezone: "UTC",
      scheduleTimezone: "UTC",
      peopleIndex: index,
      now: NOW,
      scheduleNotes: gapNotes,
    });

    expect(withGap[0]!.participantSourceIds).toEqual([ALICE_ID, CAROL_ID]);
    expect(codes(withGap[0]!.notes)).toEqual([ToolImportNoteCode.RotationGaps]);

    const nobodyNotes: Array<ToolImportNote> = [];
    expect(
      toRotations({
        shift: {
          id: "ONOBODY",
          name: "Nobody here",
          type: "rolling_users",
          start: "2026-01-05T09:00:00",
          duration: 604800,
          frequency: "weekly",
          rolling_users: [["UNOBODY0000"]],
        },
        index: 0,
        defaultTimezone: "UTC",
        scheduleTimezone: "UTC",
        peopleIndex: index,
        now: NOW,
        scheduleNotes: nobodyNotes,
      }),
    ).toEqual([]);
    expect(codes(nobodyNotes)).toEqual([ToolImportNoteCode.RotationNobody]);
  });

  test("steps nothing in OneUptime can do are noted; a step of a kind Grafana adds later is not guessed", () => {
    const notes: Array<ToolImportNote> = [];

    const flattened: ReturnType<typeof toLevels> = toLevels({
      steps: [
        { type: "notify_persons", persons_to_notify: ["UNOBODY0000"] },
        { type: "declare_incident", severity: "critical" },
        { type: "notify_whole_channel" },
        { type: "notify_if_num_alerts_in_window", num_alerts_in_window: 3 },
        { type: "something_new" },
      ],
      peopleIndex: index,
      notes: notes,
    });

    expect(flattened.levels).toEqual([
      {
        escalateAfterMinutes: 30,
        personSourceIds: [],
        teamSourceIds: [],
        scheduleSourceIds: [],
      },
    ]);
    expect(codes(notes)).toEqual([
      ToolImportNoteCode.PolicyUnknownTarget,
      ToolImportNoteCode.PolicyDeclaresIncident,
      ToolImportNoteCode.PolicyChannelStep,
      ToolImportNoteCode.PolicyConditionalStep,
    ]);

    // A chain that pages nobody repeats nothing.
    expect(
      toLevels({
        steps: [{ type: "repeat_escalation" }],
        peopleIndex: index,
        notes: [],
      }),
    ).toEqual({ levels: [], repeatTimes: 0 });
  });

  test("the history names a self-hosted install by its host, never Grafana Cloud's shared one", () => {
    expect(toAccountName("https://oncall.acme.example/")).toBe(
      "oncall.acme.example",
    );
    expect(toAccountName(GRAFANA_API_URL)).toBeUndefined();
    expect(toAccountName("not an address")).toBeUndefined();
  });

  test("the fixture people are the ones the API lists", () => {
    expect(GRAFANA_USERS).toHaveLength(PEOPLE.length);
  });
});
