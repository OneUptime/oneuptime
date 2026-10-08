import { describe, expect, test } from "@jest/globals";
import IncidentIoAdapter, {
  toCustomFieldType,
  toStateKind,
} from "../../../../Server/Utils/ToolImport/Adapters/IncidentIo/IncidentIoAdapter";
import {
  ToolImportReadContext,
  ToolImportReadError,
} from "../../../../Server/Utils/ToolImport/Types";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import DayOfWeek from "../../../../Types/Day/DayOfWeek";
import EventInterval from "../../../../Types/Events/EventInterval";
import { INCIDENT_IO_HOST } from "../../../../Types/ToolImport/ToolImportCatalog";
import {
  ToolImportNote,
  ToolImportNoteCode,
} from "../../../../Types/ToolImport/ToolImportNote";
import ToolImportResourceKind from "../../../../Types/ToolImport/ToolImportResourceKind";
import {
  ImportedIncidentCustomField,
  ImportedIncidentRole,
  ImportedIncidentRoleKind,
  ImportedIncidentSeverity,
  ImportedIncidentState,
  ImportedIncidentStateKind,
  ImportedPolicy,
  ImportedPolicyLevel,
  ImportedRotation,
  ImportedSchedule,
  ImportedService,
  ToolImportSnapshot,
} from "../../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../../Types/ToolImport/ToolImportSource";
import {
  AFFECTED_AREA_FIELD_ID,
  CHANNEL_ONLY_PATH_ID,
  CUSTOMERS_FIELD_ID,
  DAN_ID,
  IMPACT_FIELD_ID,
  INCIDENT_IO_KEY,
  INCIDENT_IO_USERS,
  incidentIoApi,
  incidentIoError,
  LISA_ID,
  MARTHA_ID,
  page,
  PLATFORM_TEAM_ID,
  PRIMARY_ROTATION_ID,
  PRIMARY_SCHEDULE_ID,
  RORY_ID,
  SUPPORT_ROTATION_ID,
  SUPPORT_SCHEDULE_ID,
  TEAM_FIELD_ID,
  TEMPLATED_PATH_ID,
  TICKET_FIELD_ID,
  URGENT_PATH_ID,
} from "./IncidentIoFixtures";
import { FixtureApi, json, RecordingSleep } from "./ToolImportFixtureTransport";

/*
 * The incident.io adapter against a fixture incident.io in the shapes of
 * its OpenAPI definition: what an organisation becomes in OneUptime's words
 * - people, teams, rotations with concurrent layers and working intervals,
 * escalation paths with delays, branches and repeats, severities, statuses,
 * roles, custom fields and the catalog's services - and how the read holds
 * up when the key is refused, a list is forbidden, or incident.io rate
 * limits. Nothing here reaches a real incident.io.
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
  api: FixtureApi = incidentIoApi(),
  overrides: Partial<ToolImportReadContext> = {},
): Promise<ToolImportSnapshot> {
  return await new IncidentIoAdapter().read(
    {
      source: ToolImportSource.IncidentIo,
      apiKey: INCIDENT_IO_KEY,
      region: "",
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

describe("IncidentIoAdapter: what an incident.io organisation becomes", () => {
  test("the organisation is named from the key's dashboard address", async () => {
    expect((await read()).accountName).toBe("acme");
  });

  test("people keep their id and name, with a lowercase email; someone deactivated reads as inactive", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(snapshot.people).toEqual([
      {
        sourceId: LISA_ID,
        name: "Lisa Karlin Curtis",
        email: "lisa@incident.io",
        isActive: true,
        notes: [],
      },
      {
        sourceId: MARTHA_ID,
        name: "Martha Lambert",
        email: "martha@incident.io",
        isActive: true,
        notes: [],
      },
      {
        sourceId: RORY_ID,
        name: "Rory Bain",
        email: "rory@incident.io",
        isActive: true,
        notes: [],
      },
      {
        sourceId: DAN_ID,
        name: "Dan Gone",
        email: "dan@incident.io",
        isActive: false,
        notes: [],
      },
    ]);
  });

  test("teams keep the members that are people of the organisation", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(snapshot.teams).toEqual([
      {
        sourceId: PLATFORM_TEAM_ID,
        name: "Platform",
        memberSourceIds: [LISA_ID, RORY_ID],
        notes: [],
      },
    ]);
  });

  test("a rotation with two layers is two lines of turns, each taking the next people in the list", async () => {
    const schedule: ImportedSchedule = scheduleOf(
      await read(),
      PRIMARY_SCHEDULE_ID,
    );

    expect(schedule.timezone).toBe("Europe/London");
    expect(schedule.ownerTeamSourceIds).toEqual([PLATFORM_TEAM_ID]);
    expect(schedule.notes).toContainEqual({
      code: ToolImportNoteCode.RotationLayers,
      values: { rotation: "Primary rota", count: 2 },
    });

    expect(
      schedule.rotations.map((rotation: ImportedRotation) => {
        return {
          key: rotation.key,
          name: rotation.name,
          people: rotation.participantSourceIds,
        };
      }),
    ).toEqual([
      {
        key: `${PRIMARY_ROTATION_ID}:primary`,
        name: "Primary rota (Primary)",
        // Turn 1: Lisa and Martha; turn 2: Rory and Lisa; turn 3: Martha and Rory.
        people: [LISA_ID, RORY_ID, MARTHA_ID],
      },
      {
        key: `${PRIMARY_ROTATION_ID}:secondary`,
        name: "Primary rota (Secondary)",
        people: [MARTHA_ID, LISA_ID, RORY_ID],
      },
    ]);

    for (const rotation of schedule.rotations) {
      expect(rotation.startsAt).toBe("2024-05-06T09:00:00.000Z");
      expect(rotation.intervalType).toBe(EventInterval.Week);
      expect(rotation.intervalCount).toBe(1);
      expect(rotation.restriction).toBeNull();
    }
  });

  test("the version of a rotation in effect now is brought over, and a change scheduled for later is noted", async () => {
    const schedule: ImportedSchedule = scheduleOf(
      await read(),
      PRIMARY_SCHEDULE_ID,
    );

    expect(schedule.rotations[0]!.notes).toContainEqual({
      code: ToolImportNoteCode.RotationScheduledChange,
      values: { rotation: "Primary rota", date: "2099-01-01T09:00:00.000Z" },
    });
  });

  test("a rotation whose only version starts later is brought over as it will be, with a note", async () => {
    const api: FixtureApi = incidentIoApi().add({
      path: "/v2/schedules",
      answers: [
        json(
          page("schedules", [
            {
              id: "s-future",
              name: "Future",
              timezone: "UTC",
              team_ids: [],
              config: {
                rotations: [
                  {
                    id: "r-future",
                    name: "Later",
                    effective_from: "2099-03-01T00:00:00Z",
                    handover_start_at: "2099-03-01T00:00:00Z",
                    handovers: [{ interval: 1, interval_type: "daily" }],
                    layers: [{ id: "l", name: "Layer 1" }],
                    users: [{ id: LISA_ID, name: "Lisa" }],
                    working_intervals: [],
                  },
                ],
              },
            },
          ]),
        ),
      ],
    });

    const rotation: ImportedRotation = (await read(api)).schedules[0]!
      .rotations[0]!;

    expect(rotation.notes).toEqual([
      {
        code: ToolImportNoteCode.RotationNotStarted,
        values: { rotation: "Later", date: "2099-03-01T00:00:00.000Z" },
      },
    ]);
    expect(rotation.intervalType).toBe(EventInterval.Day);
  });

  test("working intervals on some days are weekly windows; uneven handovers are noted", async () => {
    const schedule: ImportedSchedule = scheduleOf(
      await read(),
      SUPPORT_SCHEDULE_ID,
    );
    const rotation: ImportedRotation = schedule.rotations[0]!;

    expect(rotation.key).toBe(SUPPORT_ROTATION_ID);
    expect(rotation.intervalType).toBe(EventInterval.Day);
    expect(rotation.intervalCount).toBe(1);
    expect(rotation.participantSourceIds).toEqual([MARTHA_ID, DAN_ID]);
    expect(codes(rotation.notes)).toEqual([
      ToolImportNoteCode.RotationUnevenShifts,
    ]);
    expect(rotation.restriction).toEqual({
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
    });
  });

  test("the same hours on all seven days are a daily window, and an interval past midnight ends the next day", async () => {
    const everyDay: Array<Record<string, string>> = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ].map((weekday: string) => {
      return { weekday: weekday, start_time: "08:00", end_time: "20:00" };
    });

    const api: FixtureApi = incidentIoApi().add({
      path: "/v2/schedules",
      answers: [
        json(
          page("schedules", [
            {
              id: "s-hours",
              name: "Hours",
              timezone: "UTC",
              team_ids: [],
              config: {
                rotations: [
                  {
                    id: "r-day",
                    name: "Every day",
                    handover_start_at: "2026-01-05T08:00:00Z",
                    handovers: [{ interval: 1, interval_type: "weekly" }],
                    layers: [{ id: "l", name: "Layer 1" }],
                    users: [{ id: LISA_ID, name: "Lisa" }],
                    working_intervals: everyDay,
                  },
                  {
                    id: "r-night",
                    name: "Nights",
                    handover_start_at: "2026-01-05T08:00:00Z",
                    handovers: [{ interval: 1, interval_type: "weekly" }],
                    layers: [{ id: "l", name: "Layer 1" }],
                    users: [{ id: RORY_ID, name: "Rory" }],
                    working_intervals: [
                      {
                        weekday: "friday",
                        start_time: "22:00",
                        end_time: "06:00",
                      },
                      {
                        weekday: "saturday",
                        start_time: "18:00",
                        end_time: "00:00",
                      },
                    ],
                  },
                ],
              },
            },
          ]),
        ),
      ],
    });

    const schedule: ImportedSchedule = (await read(api)).schedules[0]!;

    expect(schedule.rotations[0]!.restriction).toEqual({
      type: "Daily",
      startTime: "08:00",
      endTime: "20:00",
    });
    expect(schedule.rotations[1]!.restriction).toEqual({
      type: "Weekly",
      windows: [
        {
          startDay: DayOfWeek.Friday,
          startTime: "22:00",
          endDay: DayOfWeek.Saturday,
          endTime: "06:00",
        },
        {
          startDay: DayOfWeek.Saturday,
          startTime: "18:00",
          endDay: DayOfWeek.Sunday,
          endTime: "00:00",
        },
      ],
    });
  });

  test("an escalation path's levels, delays, branch and repeat become levels and a repeat count", async () => {
    const policy: ImportedPolicy = policyOf(await read(), URGENT_PATH_ID);

    expect(policy.name).toBe("Urgent Support");
    expect(policy.ownerTeamSourceIds).toEqual([PLATFORM_TEAM_ID]);
    expect(policy.repeatTimes).toBe(3);
    expect(policy.isUnreadable).toBe(false);
    expect(policy.levels).toEqual([
      {
        // Five minutes to acknowledge, plus the two-minute delay after it.
        escalateAfterMinutes: 7,
        personSourceIds: [],
        teamSourceIds: [],
        scheduleSourceIds: [PRIMARY_SCHEDULE_ID],
      },
      {
        // The first branch: Rory, and everyone in the Support schedule.
        escalateAfterMinutes: 15,
        personSourceIds: [RORY_ID, MARTHA_ID, DAN_ID],
        teamSourceIds: [],
        scheduleSourceIds: [],
      },
    ]);
  });

  test("what an escalation path cannot carry over exactly is noted once each", async () => {
    const policy: ImportedPolicy = policyOf(await read(), URGENT_PATH_ID);

    expect(policy.notes).toEqual([
      { code: ToolImportNoteCode.PolicyChannelStep },
      {
        code: ToolImportNoteCode.PolicyBranch,
        values: { condition: "Alert priority" },
      },
      { code: ToolImportNoteCode.PolicyRoundRobin },
    ]);
  });

  test("a path built from a template cannot be read, and one that only posts to a channel pages nobody", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(policyOf(snapshot, TEMPLATED_PATH_ID)).toMatchObject({
      isUnreadable: true,
      levels: [],
    });
    expect(policyOf(snapshot, CHANNEL_ONLY_PATH_ID)).toMatchObject({
      isUnreadable: false,
      levels: [],
      notes: [{ code: ToolImportNoteCode.PolicyChannelStep }],
    });
  });

  test("a repeat from a later level, a hand-over to another path, the next person on call and a working-hours wait are noted", async () => {
    const api: FixtureApi = incidentIoApi().add({
      path: "/v2/escalation_paths",
      answers: [
        json(
          page("escalation_paths", [
            {
              id: "p-odd",
              name: "Odd",
              kind: "standalone",
              team_ids: [],
              path: [
                {
                  id: "n1",
                  type: "delay",
                  delay: {
                    delay_seconds: 600,
                    delay_interval_condition: "active",
                    delay_weekday_interval_config_id: "wh",
                  },
                },
                {
                  id: "n2",
                  type: "level",
                  level: {
                    targets: [
                      {
                        id: PRIMARY_SCHEDULE_ID,
                        type: "schedule",
                        schedule_mode: "next_on_call",
                        urgency: "high",
                      },
                    ],
                    time_to_ack_seconds: 61,
                    retry_config: { attempts: 3, interval_seconds: 300 },
                  },
                },
                {
                  id: "n3",
                  type: "level",
                  level: {
                    targets: [{ id: LISA_ID, type: "user", urgency: "high" }],
                  },
                },
                {
                  id: "n4",
                  type: "escalation_path",
                  escalation_path: { escalation_path_id: URGENT_PATH_ID },
                },
                {
                  id: "n5",
                  type: "repeat",
                  repeat: { repeat_times: 2, to_node: "n3" },
                },
              ],
            },
          ]),
        ),
      ],
    });

    const policy: ImportedPolicy = (await read(api)).policies[0]!;

    expect(
      policy.levels.map((level: ImportedPolicyLevel) => {
        return level.escalateAfterMinutes;
      }),
    ).toEqual([2, 30]);
    expect(codes(policy.notes)).toEqual([
      ToolImportNoteCode.PolicyWorkingHours,
      ToolImportNoteCode.PolicyLevelRepeats,
      ToolImportNoteCode.PolicyNextOnCall,
      ToolImportNoteCode.PolicyHandsOver,
      ToolImportNoteCode.PolicyRepeatsFromLater,
      ToolImportNoteCode.PolicyFirstStepWaits,
    ]);
    expect(policy.repeatTimes).toBe(2);
  });

  test("severities are ordered most severe first", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(
      snapshot.incidentSeverities.map((severity: ImportedIncidentSeverity) => {
        return [severity.name, severity.order];
      }),
    ).toEqual([
      ["Critical", 1],
      ["Major", 2],
      ["Minor", 3],
    ]);
  });

  test("statuses say whether OneUptime starts, works or ends an incident in them", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(
      snapshot.incidentStates.map((state: ImportedIncidentState) => {
        return [state.name, state.kind, state.sourceCategory];
      }),
    ).toEqual([
      ["Triage", ImportedIncidentStateKind.Created, "triage"],
      ["Investigating", ImportedIncidentStateKind.InProgress, "live"],
      ["Fixing", ImportedIncidentStateKind.InProgress, "live"],
      ["Post-incident", ImportedIncidentStateKind.NotNeeded, "learning"],
      ["Closed", ImportedIncidentStateKind.Resolved, "closed"],
      ["Declined", ImportedIncidentStateKind.NotNeeded, "declined"],
    ]);
  });

  test("roles keep their kind, and a role without a description takes its instructions", async () => {
    const snapshot: ToolImportSnapshot = await read();

    expect(
      snapshot.incidentRoles.map((role: ImportedIncidentRole) => {
        return [role.name, role.kind, role.description];
      }),
    ).toEqual([
      [
        "Incident Lead",
        ImportedIncidentRoleKind.Lead,
        "The person currently coordinating the incident",
      ],
      [
        "Reporter",
        ImportedIncidentRoleKind.Reporter,
        "The person who reported the incident",
      ],
      [
        "Communications Lead",
        ImportedIncidentRoleKind.Custom,
        "Keep customers informed",
      ],
    ]);
  });

  test("custom fields get OneUptime's type, and a dropdown its options in their order", async () => {
    const api: FixtureApi = incidentIoApi();
    const fields: Array<ImportedIncidentCustomField> = (await read(api))
      .incidentCustomFields;

    const byId: (id: string) => ImportedIncidentCustomField = (id: string) => {
      return fields.find((field: ImportedIncidentCustomField): boolean => {
        return field.sourceId === id;
      })!;
    };

    expect(byId(AFFECTED_AREA_FIELD_ID)).toMatchObject({
      fieldType: CustomFieldType.Dropdown,
      options: ["Product", "Billing"],
      isFromCatalog: false,
    });
    expect(byId(CUSTOMERS_FIELD_ID)).toMatchObject({
      fieldType: CustomFieldType.MultiSelectDropdown,
      options: ["Acme"],
    });
    expect(byId(TICKET_FIELD_ID).fieldType).toBe(CustomFieldType.Text);
    expect(byId(IMPACT_FIELD_ID).fieldType).toBe(CustomFieldType.Number);
    expect(byId(TEAM_FIELD_ID)).toMatchObject({
      isFromCatalog: true,
      options: [],
    });

    // A field whose choices come from the catalog has no options to read.
    expect(
      api.callsTo("/v1/custom_field_options").map((url: URL) => {
        return url.searchParams.get("custom_field_id");
      }),
    ).toEqual([AFFECTED_AREA_FIELD_ID, CUSTOMERS_FIELD_ID]);
  });

  test("services are the catalog's service entries, archived ones left out", async () => {
    const api: FixtureApi = incidentIoApi();
    const snapshot: ToolImportSnapshot = await read(api);

    expect(
      snapshot.services.map((service: ImportedService) => {
        return service.name;
      }),
    ).toEqual(["API", "Web app"]);
    expect(api.callsTo("/v3/catalog_entries")).toHaveLength(1);
  });
});

describe("IncidentIoAdapter: the requests it makes", () => {
  test("every request goes to api.incident.io with the Bearer key", async () => {
    const api: FixtureApi = incidentIoApi();
    await read(api);

    for (const request of api.requests) {
      expect(new URL(request.url).host).toBe(INCIDENT_IO_HOST);
      expect(request.headers["Authorization"]).toBe(
        `Bearer ${INCIDENT_IO_KEY}`,
      );
    }
  });

  test("lists are followed page by page through pagination_meta.after", async () => {
    const api: FixtureApi = incidentIoApi().add({
      path: "/v2/users",
      answers: [
        (_request: unknown, url: URL) => {
          return url.searchParams.get("after") === "cursor-2"
            ? json(page("users", INCIDENT_IO_USERS.slice(2)))
            : json(page("users", INCIDENT_IO_USERS.slice(0, 2), "cursor-2"));
        },
      ],
    });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(snapshot.people).toHaveLength(4);
    expect(
      api.callsTo("/v2/users").map((url: URL) => {
        return url.searchParams.get("after");
      }),
    ).toEqual([null, "cursor-2"]);
  });

  test("a cursor that comes back again ends the list instead of looping", async () => {
    const api: FixtureApi = incidentIoApi().add({
      path: "/v2/users",
      answers: [json(page("users", INCIDENT_IO_USERS, "same-cursor"))],
    });

    await read(api);

    expect(api.callsTo("/v2/users")).toHaveLength(2);
  });

  test("escalation paths are read 25 at a time, the most the API allows", async () => {
    const api: FixtureApi = incidentIoApi();
    await read(api);

    expect(
      api.callsTo("/v2/escalation_paths")[0]!.searchParams.get("page_size"),
    ).toBe("25");
  });
});

describe("IncidentIoAdapter: when incident.io says no", () => {
  test("a refused key stops the read before anything else is read", async () => {
    const api: FixtureApi = incidentIoApi().add({
      path: "/v1/identity",
      answers: [json(incidentIoError(401, "Invalid API key"), 401)],
    });

    let error: unknown = undefined;

    try {
      await read(api);
    } catch (thrown) {
      error = thrown;
    }

    expect(error).toBeInstanceOf(ToolImportReadError);
    expect((error as Error).message).toContain(
      "incident.io did not accept the API key",
    );
    expect((error as Error).message).not.toContain(INCIDENT_IO_KEY);
    expect(api.callsTo("/v2/users")).toHaveLength(0);
  });

  test("a list the key's roles do not cover is a note, and the rest is still read", async () => {
    const api: FixtureApi = incidentIoApi().add({
      path: "/v2/escalation_paths",
      answers: [json(incidentIoError(403, "Missing scope"), 403)],
    });

    const snapshot: ToolImportSnapshot = await read(api);

    expect(snapshot.policies).toEqual([]);
    expect(snapshot.notes).toEqual([
      {
        code: ToolImportNoteCode.CouldNotRead,
        values: { kind: ToolImportResourceKind.OnCallPolicy },
      },
    ]);
    expect(snapshot.schedules).toHaveLength(2);
  });

  test("a 429 waits until the rate limit resets, then reads on", async () => {
    const clock: { now: number } = { now: NOW };
    const sleep: RecordingSleep = new RecordingSleep(clock);
    const resetAt: number = Math.round(NOW / 1000) + 20;
    const api: FixtureApi = incidentIoApi().add({
      path: "/v1/severities",
      answers: [
        json(incidentIoError(429, "Rate limit reached"), 429, {
          "x-ratelimit-reset": String(resetAt),
          "x-ratelimit-limit": "1200",
          "x-ratelimit-remaining": "0",
        }),
        json({ severities: [] }),
      ],
    });

    await new IncidentIoAdapter().read(
      {
        source: ToolImportSource.IncidentIo,
        apiKey: INCIDENT_IO_KEY,
        region: "",
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

    expect(sleep.waits).toEqual([20000]);
  });

  test("a region given for a tool with one API is refused", async () => {
    await expect(
      new IncidentIoAdapter().read(
        {
          source: ToolImportSource.IncidentIo,
          apiKey: INCIDENT_IO_KEY,
          region: "EU",
        },
        context(incidentIoApi()),
      ),
    ).rejects.toThrow(ToolImportReadError);
  });

  test("the snapshot never holds the key", async () => {
    expect(JSON.stringify(await read())).not.toContain(INCIDENT_IO_KEY);
  });
});

describe("IncidentIoAdapter: incident.io's words in OneUptime's", () => {
  test.each([
    ["triage", ImportedIncidentStateKind.Created],
    ["live", ImportedIncidentStateKind.InProgress],
    ["active", ImportedIncidentStateKind.InProgress],
    ["paused", ImportedIncidentStateKind.InProgress],
    ["closed", ImportedIncidentStateKind.Resolved],
    ["learning", ImportedIncidentStateKind.NotNeeded],
    ["declined", ImportedIncidentStateKind.NotNeeded],
    ["merged", ImportedIncidentStateKind.NotNeeded],
    ["canceled", ImportedIncidentStateKind.NotNeeded],
  ] as Array<[string, ImportedIncidentStateKind]>)(
    "a %s status is %s",
    (category: string, kind: ImportedIncidentStateKind) => {
      expect(toStateKind(category)).toBe(kind);
    },
  );

  test.each([
    ["single_select", CustomFieldType.Dropdown],
    ["multi_select", CustomFieldType.MultiSelectDropdown],
    ["text", CustomFieldType.Text],
    ["link", CustomFieldType.Text],
    ["numeric", CustomFieldType.Number],
  ] as Array<[string, CustomFieldType]>)(
    "a %s field is a %s field",
    (type: string, fieldType: CustomFieldType) => {
      expect(toCustomFieldType(type)).toBe(fieldType);
    },
  );

  test("a field type incident.io adds later is not guessed", () => {
    expect(toCustomFieldType("hologram")).toBeNull();
  });
});
