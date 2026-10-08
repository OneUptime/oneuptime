import { describe, expect, test } from "@jest/globals";
import {
  buildToolImportPlan,
  normalizeImportName,
  ToolImportAccess,
  ToolImportProjectState,
} from "../../../../Server/Utils/ToolImport/ToolImportPlanner";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import { TOOL_IMPORT_MAX_ITEMS_PER_KIND } from "../../../../Types/ToolImport/ToolImportLimits";
import {
  makeToolImportNote,
  ToolImportNote,
  ToolImportNoteCode,
} from "../../../../Types/ToolImport/ToolImportNote";
import {
  ToolImportAction,
  ToolImportPlan,
  ToolImportPlanItem,
} from "../../../../Types/ToolImport/ToolImportPlan";
import ToolImportResourceKind from "../../../../Types/ToolImport/ToolImportResourceKind";
import {
  ImportedIncidentRoleKind,
  ImportedIncidentStateKind,
  ToolImportSnapshot,
} from "../../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../../Types/ToolImport/ToolImportSource";
import {
  AFTER_HOURS,
  BUSINESS_HOURS,
  customField,
  fullAccess,
  incidentState,
  level,
  person,
  policy,
  projectState,
  role,
  rotation,
  schedule,
  service,
  severity,
  snapshot,
  team,
} from "./ToolImportSnapshotFixtures";

/*
 * The planner: what an import would do with what was read, for one person
 * in one project. Pure, so every rule is pinned here without a database:
 * people matched by email, names matched to what exists, earlier imports
 * found by the tool's id, refusals by permission and plan, the limits, and
 * what starts ticked.
 */

function plan(
  data: Partial<ToolImportSnapshot>,
  state: ToolImportProjectState = projectState(),
  access: ToolImportAccess = fullAccess(),
): ToolImportPlan {
  return buildToolImportPlan({
    snapshot: snapshot(data),
    state: state,
    access: access,
  });
}

function item(result: ToolImportPlan, key: string): ToolImportPlanItem {
  const found: ToolImportPlanItem | undefined = result.items.find(
    (candidate: ToolImportPlanItem): boolean => {
      return candidate.key === key;
    },
  );

  if (!found) {
    throw new Error(`No item ${key} in the plan.`);
  }

  return found;
}

function existing(
  kind: ToolImportResourceKind,
  records: Array<{ id: string; name: string }>,
): ToolImportProjectState["existingByKind"] {
  return new Map([[kind, records]]);
}

describe("ToolImportPlanner: people", () => {
  test("someone already in the project, by email, is matched to their account", () => {
    const result: ToolImportPlan = plan(
      { people: [person("alice")] },
      projectState({
        memberUserIdsByEmail: new Map([["alice@example.com", "user-alice"]]),
      }),
    );

    expect(item(result, "Person:alice")).toMatchObject({
      action: ToolImportAction.Match,
      existingRecordId: "user-alice",
      reason: { code: ToolImportNoteCode.PersonAlreadyMember },
      isSelectable: false,
      isSelectedByDefault: false,
      summary: { email: "alice@example.com" },
    });
  });

  test("someone on a team, a schedule or a policy is invited and starts ticked", () => {
    const result: ToolImportPlan = plan({
      people: [person("a"), person("b"), person("c")],
      teams: [team("t", "Team", ["a"])],
      schedules: [schedule("s", "Schedule", [rotation("r", ["b"])])],
      policies: [policy("p", "Policy", [level({ people: ["c"] })])],
    });

    for (const key of ["Person:a", "Person:b", "Person:c"]) {
      expect(item(result, key)).toMatchObject({
        action: ToolImportAction.Invite,
        isSelectable: true,
        isSelectedByDefault: true,
        notes: [],
      });
    }
  });

  test("someone on nothing being brought over is listed unticked, so a whole directory is never invited by default", () => {
    const result: ToolImportPlan = plan({ people: [person("stakeholder")] });

    expect(item(result, "Person:stakeholder")).toMatchObject({
      action: ToolImportAction.Invite,
      isSelectable: true,
      isSelectedByDefault: false,
      notes: [{ code: ToolImportNoteCode.NotOnAnything }],
    });
  });

  test("no email, or deactivated in the tool, is skipped with the reason", () => {
    const result: ToolImportPlan = plan({
      people: [
        person("noemail", { email: null }),
        person("gone", { isActive: false }),
      ],
    });

    expect(item(result, "Person:noemail")).toMatchObject({
      action: ToolImportAction.Skip,
      reason: { code: ToolImportNoteCode.PersonNoEmail },
      isSelectable: false,
    });
    expect(item(result, "Person:gone")).toMatchObject({
      action: ToolImportAction.Skip,
      reason: { code: ToolImportNoteCode.PersonDeactivated },
    });
  });

  test("a person who may not invite sees why everyone new is skipped, and members are still matched", () => {
    const refusal: ToolImportNote = makeToolImportNote(
      ToolImportNoteCode.NeedsPlan,
      { plan: "Growth" },
    );

    const result: ToolImportPlan = plan(
      { people: [person("new"), person("member")] },
      projectState({
        memberUserIdsByEmail: new Map([["member@example.com", "user-member"]]),
      }),
      fullAccess({ inviteRefusal: refusal, inviteTeams: [] }),
    );

    expect(item(result, "Person:new")).toMatchObject({
      action: ToolImportAction.Skip,
      reason: refusal,
    });
    expect(item(result, "Person:member").action).toBe(ToolImportAction.Match);
    expect(result.inviteTeams).toEqual([]);
  });
});

describe("ToolImportPlanner: teams and other named records", () => {
  test("a team whose name is in the project is matched to it, members left as they are", () => {
    const result: ToolImportPlan = plan(
      { teams: [team("t", "  platform   team ", ["a"])] },
      projectState({
        existingByKind: existing(ToolImportResourceKind.Team, [
          { id: "team-1", name: "Platform Team" },
        ]),
      }),
    );

    expect(item(result, "Team:t")).toMatchObject({
      action: ToolImportAction.Match,
      existingRecordId: "team-1",
      reason: { code: ToolImportNoteCode.TeamNameExists },
    });
  });

  test("a new team is created, ticked, naming its members", () => {
    const result: ToolImportPlan = plan({
      people: [person("a"), person("b")],
      teams: [team("t", "Platform", ["a", "b"])],
    });

    expect(item(result, "Team:t")).toMatchObject({
      action: ToolImportAction.Create,
      isSelectable: true,
      isSelectedByDefault: true,
      summary: { memberCount: 2 },
      references: ["Person:a", "Person:b"],
    });
  });

  test("what an earlier import brought over is left alone; if it was deleted since, it is created again with a note", () => {
    const state: ToolImportProjectState = projectState({
      previousRecords: [
        {
          kind: ToolImportResourceKind.Team,
          sourceId: "kept",
          recordId: "team-kept",
          isComplete: true,
          stillExists: true,
        },
        {
          kind: ToolImportResourceKind.Team,
          sourceId: "deleted",
          recordId: "team-deleted",
          isComplete: true,
          stillExists: false,
        },
      ],
    });

    const result: ToolImportPlan = plan(
      {
        teams: [team("kept", "Kept", []), team("deleted", "Deleted", [])],
      },
      state,
    );

    expect(item(result, "Team:kept")).toMatchObject({
      action: ToolImportAction.AlreadyImported,
      existingRecordId: "team-kept",
      reason: { code: ToolImportNoteCode.AlreadyImported },
      isSelectable: false,
    });
    expect(item(result, "Team:deleted")).toMatchObject({
      action: ToolImportAction.Create,
      notes: [{ code: ToolImportNoteCode.ImportedBeforeDeletedSince }],
    });
  });

  test("an earlier import's record is found by the same tool's id only", () => {
    const result: ToolImportPlan = plan(
      { teams: [team("other-id", "Platform", [])] },
      projectState({
        previousRecords: [
          {
            kind: ToolImportResourceKind.Team,
            sourceId: "some-id",
            recordId: "team-x",
            isComplete: true,
            stillExists: true,
          },
          {
            kind: ToolImportResourceKind.Service,
            sourceId: "other-id",
            recordId: "service-x",
            isComplete: true,
            stillExists: true,
          },
        ],
      }),
    );

    expect(item(result, "Team:other-id").action).toBe(ToolImportAction.Create);
  });

  test("what the person may not create is skipped with the reason, never attempted", () => {
    const access: ToolImportAccess = fullAccess();
    access.createRefusals.set(
      ToolImportResourceKind.Team,
      makeToolImportNote(ToolImportNoteCode.NeedsPlan, { plan: "Scale" }),
    );
    access.createRefusals.set(
      ToolImportResourceKind.Service,
      makeToolImportNote(ToolImportNoteCode.NoPermission),
    );

    const result: ToolImportPlan = plan(
      {
        teams: [team("t", "Platform", [])],
        services: [service("s", "Checkout")],
      },
      projectState(),
      access,
    );

    expect(item(result, "Team:t")).toMatchObject({
      action: ToolImportAction.Skip,
      reason: { code: ToolImportNoteCode.NeedsPlan, values: { plan: "Scale" } },
    });
    expect(item(result, "Service:s")).toMatchObject({
      action: ToolImportAction.Skip,
      reason: { code: ToolImportNoteCode.NoPermission },
    });
  });

  test("a name that exists is matched even when the person may not create the kind", () => {
    const access: ToolImportAccess = fullAccess();
    access.createRefusals.set(
      ToolImportResourceKind.Service,
      makeToolImportNote(ToolImportNoteCode.NoPermission),
    );

    const result: ToolImportPlan = plan(
      { services: [service("s", "Checkout")] },
      projectState({
        existingByKind: existing(ToolImportResourceKind.Service, [
          { id: "service-1", name: "checkout" },
        ]),
      }),
      access,
    );

    expect(item(result, "Service:s")).toMatchObject({
      action: ToolImportAction.Match,
      existingRecordId: "service-1",
      reason: {
        code: ToolImportNoteCode.NameExists,
        values: { name: "checkout" },
      },
    });
  });

  test("two items of a kind whose names are unique in a project: the second is matched to the first", () => {
    const result: ToolImportPlan = plan({
      incidentSeverities: [severity("a", "Major", 1), severity("b", "major", 2)],
    });

    expect(item(result, "IncidentSeverity:a").action).toBe(
      ToolImportAction.Create,
    );
    expect(item(result, "IncidentSeverity:b")).toMatchObject({
      action: ToolImportAction.Match,
      references: ["IncidentSeverity:a"],
      isSelectable: false,
    });
  });

  test("two teams or schedules of the same name are both created: OneUptime allows it", () => {
    const result: ToolImportPlan = plan({
      teams: [team("a", "Ops", []), team("b", "Ops", [])],
    });

    expect(item(result, "Team:a").action).toBe(ToolImportAction.Create);
    expect(item(result, "Team:b").action).toBe(ToolImportAction.Create);
  });
});

describe("ToolImportPlanner: on-call schedules", () => {
  test("rotations never on call together are one schedule; the summary says how it comes over", () => {
    const result: ToolImportPlan = plan({
      people: [person("a"), person("b")],
      teams: [team("t", "Platform", [])],
      schedules: [
        schedule(
          "s",
          "Platform",
          [
            rotation("business", ["a"], { restriction: BUSINESS_HOURS }),
            rotation("after", ["b"], { restriction: AFTER_HOURS }),
          ],
          { ownerTeamSourceIds: ["t"] },
        ),
      ],
    });

    expect(item(result, "OnCallSchedule:s")).toMatchObject({
      action: ToolImportAction.Create,
      isSelectedByDefault: true,
      summary: { scheduleCount: 1, layerCount: 2, timezone: "Europe/London" },
      references: ["Person:a", "Person:b", "Team:t"],
      notes: [],
    });
  });

  test("rotations on call together become schedules of their own, and the note says how many", () => {
    const result: ToolImportPlan = plan({
      schedules: [
        schedule("s", "Platform", [
          rotation("primary", ["a"]),
          rotation("shadow", ["b"]),
        ]),
      ],
    });

    expect(item(result, "OnCallSchedule:s")).toMatchObject({
      summary: { scheduleCount: 2, layerCount: 2 },
      notes: [{ code: ToolImportNoteCode.ScheduleSplit, values: { count: 2 } }],
    });
  });

  test("a zone OneUptime does not know becomes UTC, with a note; the rotations' notes are shown on the schedule", () => {
    const result: ToolImportPlan = plan({
      schedules: [
        schedule(
          "s",
          "Mars",
          [
            rotation("r", ["a"], {
              notes: [
                makeToolImportNote(ToolImportNoteCode.RotationGaps, {
                  rotation: "r",
                }),
              ],
            }),
          ],
          {
            timezone: "Mars/Olympus_Mons",
            notes: [makeToolImportNote(ToolImportNoteCode.TurnedOffInSource)],
            isEnabled: false,
          },
        ),
      ],
    });

    expect(item(result, "OnCallSchedule:s")).toMatchObject({
      action: ToolImportAction.Create,
      // Turned off in the tool: brought over only if ticked.
      isSelectedByDefault: false,
      summary: { timezone: "UTC" },
      notes: [
        { code: ToolImportNoteCode.TurnedOffInSource },
        { code: ToolImportNoteCode.RotationGaps, values: { rotation: "r" } },
        {
          code: ToolImportNoteCode.TimezoneUnknown,
          values: { timezone: "Mars/Olympus_Mons" },
        },
      ],
    });
  });

  test("a schedule an earlier import made into several is already imported as all of them", () => {
    const result: ToolImportPlan = plan(
      { schedules: [schedule("s", "Platform", [rotation("r", ["a"])])] },
      projectState({
        previousRecords: [
          {
            kind: ToolImportResourceKind.OnCallSchedule,
            sourceId: "s",
            recordId: "schedule-1",
            isComplete: true,
            stillExists: true,
          },
          {
            kind: ToolImportResourceKind.OnCallSchedule,
            sourceId: "s#2",
            recordId: "schedule-2",
            isComplete: true,
            stillExists: true,
          },
          {
            kind: ToolImportResourceKind.OnCallSchedule,
            sourceId: "s#3",
            recordId: "schedule-3",
            isComplete: true,
            stillExists: false,
          },
          {
            kind: ToolImportResourceKind.OnCallSchedule,
            sourceId: "s2",
            recordId: "schedule-other",
            isComplete: true,
            stillExists: true,
          },
        ],
      }),
    );

    expect(item(result, "OnCallSchedule:s")).toMatchObject({
      action: ToolImportAction.AlreadyImported,
      existingRecordId: "schedule-1",
      additionalRecordIds: ["schedule-2"],
    });
  });
});

describe("ToolImportPlanner: escalation policies", () => {
  test("a policy names what its levels page and its owner team", () => {
    const result: ToolImportPlan = plan({
      policies: [
        policy(
          "p",
          "Platform",
          [
            level({ schedules: ["s"], wait: 5 }),
            level({ people: ["a"], teams: ["t"] }),
          ],
          { repeatTimes: 2, ownerTeamSourceIds: ["owners"] },
        ),
      ],
    });

    expect(item(result, "OnCallPolicy:p")).toMatchObject({
      action: ToolImportAction.Create,
      summary: { levelCount: 2, repeatTimes: 2 },
      references: [
        "OnCallSchedule:s",
        "Person:a",
        "Team:t",
        "Team:owners",
      ],
    });
  });

  test("a policy built from a template, or with no levels, is skipped with the reason", () => {
    const result: ToolImportPlan = plan({
      policies: [
        policy("templated", "From a template", [], { isUnreadable: true }),
        policy("empty", "Channel only", []),
      ],
    });

    expect(item(result, "OnCallPolicy:templated")).toMatchObject({
      action: ToolImportAction.Skip,
      reason: { code: ToolImportNoteCode.PolicyTemplated },
    });
    expect(item(result, "OnCallPolicy:empty")).toMatchObject({
      action: ToolImportAction.Skip,
      reason: { code: ToolImportNoteCode.NothingToPage },
    });
  });

  test("on the Free plan a policy of several levels says only its first comes over", () => {
    const result: ToolImportPlan = plan(
      {
        policies: [
          policy("p", "Platform", [level({ people: ["a"] }), level({ people: ["b"] })]),
          policy("q", "One level", [level({ people: ["a"] })]),
        ],
      },
      projectState(),
      fullAccess({ isLimitedToOneLevelPerPolicy: true }),
    );

    expect(item(result, "OnCallPolicy:p").notes).toEqual([
      { code: ToolImportNoteCode.PolicyFreePlanOneLevel },
    ]);
    expect(item(result, "OnCallPolicy:q").notes).toEqual([]);
  });
});

describe("ToolImportPlanner: incident settings", () => {
  test("a severity matches OneUptime's under its own wording ('Critical' is 'Critical Incident')", () => {
    const result: ToolImportPlan = plan(
      {
        incidentSeverities: [
          severity("crit", "Critical", 1),
          severity("major", "Major Incident", 2),
          severity("sev0", "SEV0", 3),
        ],
      },
      projectState({
        existingByKind: existing(ToolImportResourceKind.IncidentSeverity, [
          { id: "sev-critical", name: "Critical Incident" },
          { id: "sev-major", name: "Major" },
        ]),
      }),
    );

    expect(item(result, "IncidentSeverity:crit")).toMatchObject({
      action: ToolImportAction.Match,
      existingRecordId: "sev-critical",
    });
    expect(item(result, "IncidentSeverity:major")).toMatchObject({
      action: ToolImportAction.Match,
      existingRecordId: "sev-major",
    });
    expect(item(result, "IncidentSeverity:sev0").action).toBe(
      ToolImportAction.Create,
    );
  });

  test("statuses OneUptime starts and ends incidents in are matched to its own; in-progress ones are created; the rest are not needed", () => {
    const result: ToolImportPlan = plan(
      {
        incidentStates: [
          incidentState("triage", "Triage", ImportedIncidentStateKind.Created, "triage"),
          incidentState("live", "Fixing", ImportedIncidentStateKind.InProgress, "live"),
          incidentState("ack", "acknowledged", ImportedIncidentStateKind.InProgress, "live"),
          incidentState("closed", "Closed", ImportedIncidentStateKind.Resolved, "closed"),
          incidentState("learn", "Post-incident", ImportedIncidentStateKind.NotNeeded, "learning"),
        ],
      },
      projectState({
        existingByKind: existing(ToolImportResourceKind.IncidentState, [
          { id: "state-ack", name: "Acknowledged" },
        ]),
      }),
    );

    expect(item(result, "IncidentState:triage")).toMatchObject({
      action: ToolImportAction.Match,
      existingRecordId: "state-identified",
      reason: {
        code: ToolImportNoteCode.StateMatchedToCreated,
        values: { state: "Identified" },
      },
    });
    expect(item(result, "IncidentState:live").action).toBe(
      ToolImportAction.Create,
    );
    expect(item(result, "IncidentState:ack")).toMatchObject({
      action: ToolImportAction.Match,
      existingRecordId: "state-ack",
    });
    expect(item(result, "IncidentState:closed")).toMatchObject({
      action: ToolImportAction.Match,
      existingRecordId: "state-resolved",
      reason: { code: ToolImportNoteCode.StateMatchedToResolved },
    });
    expect(item(result, "IncidentState:learn")).toMatchObject({
      action: ToolImportAction.Skip,
      reason: {
        code: ToolImportNoteCode.StateNotNeeded,
        values: { category: "learning" },
      },
    });
  });

  test("the role that leads an incident is OneUptime's primary role; the reporter is not needed; others are created", () => {
    const result: ToolImportPlan = plan({
      incidentRoles: [
        role("lead", "Incident Lead", ImportedIncidentRoleKind.Lead),
        role("reporter", "Reporter", ImportedIncidentRoleKind.Reporter),
        role("comms", "Communications Lead", ImportedIncidentRoleKind.Custom),
      ],
    });

    expect(item(result, "IncidentRole:lead")).toMatchObject({
      action: ToolImportAction.Match,
      existingRecordId: "role-commander",
      reason: {
        code: ToolImportNoteCode.RoleMatchedToPrimary,
        values: { role: "Incident Commander" },
      },
    });
    expect(item(result, "IncidentRole:reporter")).toMatchObject({
      action: ToolImportAction.Skip,
      reason: { code: ToolImportNoteCode.RoleReporter },
    });
    expect(item(result, "IncidentRole:comms").action).toBe(
      ToolImportAction.Create,
    );
  });

  test("a custom field is created with its type and options; one from a catalog or of an unknown type is skipped", () => {
    const result: ToolImportPlan = plan({
      incidentCustomFields: [
        customField("area", "Affected Area", CustomFieldType.Dropdown, {
          options: ["Product", "Billing"],
        }),
        customField("team", "Affected Team", CustomFieldType.Dropdown, {
          isFromCatalog: true,
        }),
        customField("odd", "Hologram", null),
      ],
    });

    expect(item(result, "IncidentCustomField:area")).toMatchObject({
      action: ToolImportAction.Create,
      summary: { fieldType: CustomFieldType.Dropdown, optionCount: 2 },
    });
    expect(item(result, "IncidentCustomField:team")).toMatchObject({
      action: ToolImportAction.Skip,
      reason: { code: ToolImportNoteCode.CustomFieldFromCatalog },
    });
    expect(item(result, "IncidentCustomField:odd")).toMatchObject({
      action: ToolImportAction.Skip,
      reason: { code: ToolImportNoteCode.CustomFieldTypeNotSupported },
    });
  });
});

describe("ToolImportPlanner: the plan as a whole", () => {
  test("items are listed people first and policies last, each kind in the tool's order", () => {
    const result: ToolImportPlan = plan({
      policies: [policy("p", "Policy", [level({ people: ["a"] })])],
      schedules: [schedule("s", "Schedule", [rotation("r", ["a"])])],
      services: [service("svc", "Service")],
      teams: [team("t2", "Second", []), team("t1", "First", [])],
      people: [person("a")],
    });

    expect(result.items.map((entry: ToolImportPlanItem) => entry.key)).toEqual([
      "Person:a",
      "Team:t2",
      "Team:t1",
      "Service:svc",
      "OnCallSchedule:s",
      "OnCallPolicy:p",
    ]);
  });

  test("the plan carries the read's account, time and notes, and the teams people can be invited to", () => {
    const result: ToolImportPlan = plan({
      notes: [
        makeToolImportNote(ToolImportNoteCode.CouldNotRead, {
          kind: ToolImportResourceKind.Service,
        }),
      ],
    });

    expect(result.source).toBe(ToolImportSource.OpsGenie);
    expect(result.accountName).toBe("acme");
    expect(result.readAt).toBe("2026-10-08T12:00:00.000Z");
    expect(result.notes).toEqual([
      {
        code: ToolImportNoteCode.CouldNotRead,
        values: { kind: ToolImportResourceKind.Service },
      },
    ]);
    expect(result.inviteTeams).toEqual([{ id: "team-members", name: "Members" }]);
    expect(result.defaultInviteTeamId).toBe("team-members");
  });

  test("past a kind's limit, items are skipped with the limit, for the next import", () => {
    const limit: number =
      TOOL_IMPORT_MAX_ITEMS_PER_KIND[ToolImportResourceKind.IncidentSeverity];
    const severities: Array<ReturnType<typeof severity>> = [];

    for (let index: number = 0; index <= limit; index++) {
      severities.push(severity(`s${index}`, `Severity ${index}`, index + 1));
    }

    const result: ToolImportPlan = plan({ incidentSeverities: severities });
    const created: Array<ToolImportPlanItem> = result.items.filter(
      (entry: ToolImportPlanItem) => entry.action === ToolImportAction.Create,
    );

    expect(created).toHaveLength(limit);
    expect(item(result, `IncidentSeverity:s${limit}`)).toMatchObject({
      action: ToolImportAction.Skip,
      reason: { code: ToolImportNoteCode.OverLimit, values: { limit: limit } },
    });
  });

  test("matched and already-imported items do not count against the limit", () => {
    const limit: number =
      TOOL_IMPORT_MAX_ITEMS_PER_KIND[ToolImportResourceKind.IncidentRole];
    const roles: Array<ReturnType<typeof role>> = [
      role("lead", "Lead", ImportedIncidentRoleKind.Lead),
    ];

    for (let index: number = 0; index < limit; index++) {
      roles.push(role(`r${index}`, `Role ${index}`, ImportedIncidentRoleKind.Custom));
    }

    const result: ToolImportPlan = plan({ incidentRoles: roles });

    expect(
      result.items.filter(
        (entry: ToolImportPlanItem) => entry.action === ToolImportAction.Create,
      ),
    ).toHaveLength(limit);
  });

  test("names compare without case or extra spaces", () => {
    expect(normalizeImportName("  Platform   Team ")).toBe("platform team");
    expect(normalizeImportName("")).toBe("");
  });
});
