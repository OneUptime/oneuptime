import { afterEach, describe, expect, jest, test } from "@jest/globals";
import IncidentCustomField from "../../../../Models/DatabaseModels/IncidentCustomField";
import IncidentRole from "../../../../Models/DatabaseModels/IncidentRole";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import ServiceModel from "../../../../Models/DatabaseModels/Service";
import Team from "../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import ToolImportRecord from "../../../../Models/DatabaseModels/ToolImportRecord";
import ToolImportApplier, {
  toErrorMessage,
} from "../../../../Server/Utils/ToolImport/ToolImportApplier";
import {
  buildToolImportPlan,
  ToolImportAccess,
  ToolImportProjectState,
} from "../../../../Server/Utils/ToolImport/ToolImportPlanner";
import Errors from "../../../../Server/Utils/Errors";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import { RestrictionType } from "../../../../Types/OnCallDutyPolicy/RestrictionTimes";
import { ToolImportNoteCode } from "../../../../Types/ToolImport/ToolImportNote";
import {
  ToolImportAction,
  ToolImportOutcome,
  ToolImportPlan,
  ToolImportPlanItem,
  ToolImportProgress,
  ToolImportReport,
  ToolImportReportItem,
} from "../../../../Types/ToolImport/ToolImportPlan";
import ToolImportResourceKind from "../../../../Types/ToolImport/ToolImportResourceKind";
import {
  ImportedIncidentRoleKind,
  ImportedIncidentStateKind,
  ToolImportSnapshot,
} from "../../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../../Types/ToolImport/ToolImportSource";
import { ApplierWorld } from "./ToolImportApplierWorld";
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
 * The import itself, with OneUptime's services stood in for (ApplierWorld):
 * what it creates, in what order, with whose props, what each record names,
 * what it remembers, how it reports, and how it carries on when one create
 * is refused, resumes after a worker stopped, and never makes anything
 * twice. ToolImportApplierPostgres runs the same import through the real
 * services and a real database.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const RUN_ID: ObjectID = ObjectID.generate();
const INVITE_TEAM_ID: string = ObjectID.generate().toString();
const MEMBER_USER_ID: string = ObjectID.generate().toString();

const PERSON_PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: ObjectID.generate(),
};

/*
 * The account: Alice and Bob take turns on the primary rotation, Mia (already
 * a member) is on a shadow rotation at the same time, and Carl is on nothing.
 */
function account(): ToolImportSnapshot {
  return snapshot({
    source: ToolImportSource.OpsGenie,
    people: [
      person("alice"),
      person("bob"),
      person("carl"),
      person("mia", { email: "mia@example.com" }),
    ],
    teams: [team("platform", "Platform", ["alice", "bob", "mia"])],
    schedules: [
      schedule(
        "primary",
        "Primary",
        [rotation("rota", ["alice", "bob"]), rotation("shadow", ["mia"])],
        { ownerTeamSourceIds: ["platform"], timezone: "Europe/Istanbul" },
      ),
      schedule("hours", "Hours", [
        rotation("business", ["alice"], { restriction: BUSINESS_HOURS }),
        rotation("after", ["bob", "alice"], { restriction: AFTER_HOURS }),
      ]),
    ],
    policies: [
      policy(
        "escalation",
        "Escalation",
        [
          level({ schedules: ["primary"], wait: 5 }),
          level({ people: ["bob"], teams: ["platform"], wait: 15 }),
        ],
        { repeatTimes: 2, ownerTeamSourceIds: ["platform"] },
      ),
    ],
    services: [
      {
        ...service("checkout", "Checkout"),
        description: "Takes the money",
        ownerTeamSourceIds: ["platform"],
      },
    ],
    incidentSeverities: [severity("critical", "SEV1", 1)],
    incidentStates: [
      incidentState("fixing", "Fixing", ImportedIncidentStateKind.InProgress, "live"),
    ],
    incidentRoles: [
      role("comms", "Communications", ImportedIncidentRoleKind.Custom),
    ],
    incidentCustomFields: [
      customField("area", "Affected Area", CustomFieldType.Dropdown, {
        options: ["Product", "Billing"],
      }),
    ],
  });
}

function state(): ToolImportProjectState {
  return projectState({
    memberUserIdsByEmail: new Map([["mia@example.com", MEMBER_USER_ID]]),
  });
}

function access(): ToolImportAccess {
  return fullAccess({
    inviteTeams: [{ id: INVITE_TEAM_ID, name: "Members" }],
    defaultInviteTeamId: INVITE_TEAM_ID,
  });
}

interface Run {
  report: ToolImportReport;
  plan: ToolImportPlan;
  progress: Array<ToolImportProgress>;
}

async function runImport(data: {
  snapshot?: ToolImportSnapshot;
  state?: ToolImportProjectState;
  access?: ToolImportAccess;
  selectedKeys?: (plan: ToolImportPlan) => Array<string>;
  inviteTeamId?: string | null;
  isLimitedToOneLevelPerPolicy?: boolean;
}): Promise<Run> {
  const plan: ToolImportPlan = buildToolImportPlan({
    snapshot: data.snapshot || account(),
    state: data.state || state(),
    access: data.access || access(),
  });

  const selected: Array<string> = data.selectedKeys
    ? data.selectedKeys(plan)
    : plan.items
        .filter((item: ToolImportPlanItem) => item.isSelectable)
        .map((item: ToolImportPlanItem) => item.key);

  const progress: Array<ToolImportProgress> = [];

  const report: ToolImportReport = await ToolImportApplier.apply({
    runId: RUN_ID,
    projectId: PROJECT_ID,
    source: ToolImportSource.OpsGenie,
    snapshot: data.snapshot || account(),
    plan: plan,
    selection: {
      selectedKeys: selected,
      inviteTeamId:
        data.inviteTeamId === undefined ? INVITE_TEAM_ID : data.inviteTeamId,
    },
    props: PERSON_PROPS,
    isLimitedToOneLevelPerPolicy: Boolean(data.isLimitedToOneLevelPerPolicy),
    now: new Date("2026-10-08T12:00:00Z"),
    onProgress: async (value: ToolImportProgress): Promise<void> => {
      progress.push({ ...value });
    },
  });

  return { report, plan, progress };
}

function outcomeOf(report: ToolImportReport, key: string): ToolImportReportItem {
  const found: ToolImportReportItem | undefined = report.items.find(
    (item: ToolImportReportItem) => item.key === key,
  );

  if (!found) {
    throw new Error(`No report item ${key}`);
  }

  return found;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ToolImportApplier: a whole import", () => {
  test("new people are invited to the chosen team, in their name, as the person importing", async () => {
    const world: ApplierWorld = new ApplierWorld();
    const { report } = await runImport({});

    const invites: Array<{ email: unknown; teamId: string | undefined }> = world
      .createsOf("TeamMember")
      .filter((create) => create.miscDataProps?.["email"])
      .map((create) => {
        return {
          email: create.miscDataProps?.["email"],
          name: create.miscDataProps?.["name"],
          teamId: (create.data as TeamMember).teamId?.toString(),
        };
      });

    expect(invites).toEqual([
      { email: "alice@example.com", name: "ALICE", teamId: INVITE_TEAM_ID },
      { email: "bob@example.com", name: "BOB", teamId: INVITE_TEAM_ID },
      { email: "carl@example.com", name: "CARL", teamId: INVITE_TEAM_ID },
    ]);

    expect(outcomeOf(report, "Person:alice")).toMatchObject({
      outcome: ToolImportOutcome.Invited,
      recordIds: [world.userIdFor("alice@example.com")],
    });
    expect(outcomeOf(report, "Person:mia")).toMatchObject({
      outcome: ToolImportOutcome.Matched,
      recordIds: [MEMBER_USER_ID],
    });
  });

  test("every record is created with the person's props, never as OneUptime", async () => {
    const world: ApplierWorld = new ApplierWorld();
    await runImport({});

    expect(world.creates.length).toBeGreaterThan(20);

    for (const create of world.creates) {
      expect(create.props).toBe(PERSON_PROPS);
      expect(create.props.isRoot).toBeUndefined();
    }
  });

  test("a new team gets its members: invited people and members of the project alike", async () => {
    const world: ApplierWorld = new ApplierWorld();
    const { report } = await runImport({});

    const created: Team = world.dataOf<Team>("Team")[0]!;

    expect(created.name).toBe("Platform");
    expect(created.projectId?.toString()).toBe(PROJECT_ID.toString());

    const members: Array<string | undefined> = world
      .createsOf("TeamMember")
      .filter((create) => !create.miscDataProps)
      .map((create) => (create.data as TeamMember).userId?.toString());

    expect(members).toEqual([
      world.userIdFor("alice@example.com"),
      world.userIdFor("bob@example.com"),
      MEMBER_USER_ID,
    ]);

    for (const member of world
      .createsOf("TeamMember")
      .filter((create) => !create.miscDataProps)) {
      expect((member.data as TeamMember).teamId?.toString()).toBe(
        created.id!.toString(),
      );
    }

    expect(outcomeOf(report, "Team:platform")).toMatchObject({
      outcome: ToolImportOutcome.Created,
      recordIds: [created.id!.toString()],
      notes: [],
    });
  });

  test("a schedule whose rotations are on call together becomes two schedules; each layer keeps its people in turn order", async () => {
    const world: ApplierWorld = new ApplierWorld();
    const { report } = await runImport({});

    const schedules: Array<OnCallDutyPolicySchedule> =
      world.dataOf<OnCallDutyPolicySchedule>("OnCallDutyPolicySchedule");

    expect(schedules.map((created) => created.name)).toEqual([
      "Primary",
      "Primary (shadow)",
      "Hours",
    ]);
    expect(schedules[0]!.timezone).toBe("Europe/Istanbul");
    expect(schedules[2]!.timezone).toBe("Europe/London");

    const layers: Array<OnCallDutyPolicyScheduleLayer> =
      world.dataOf<OnCallDutyPolicyScheduleLayer>("OnCallDutyPolicyScheduleLayer");

    expect(
      layers.map((layer) => {
        return {
          schedule: layer.onCallDutyPolicyScheduleId?.toString(),
          name: layer.name,
          order: layer.order,
          restriction: layer.restrictionTimes?.restictionType,
        };
      }),
    ).toEqual([
      {
        schedule: schedules[0]!.id!.toString(),
        name: "rota",
        order: 1,
        restriction: RestrictionType.None,
      },
      {
        schedule: schedules[1]!.id!.toString(),
        name: "shadow",
        order: 1,
        restriction: RestrictionType.None,
      },
      {
        schedule: schedules[2]!.id!.toString(),
        name: "business",
        order: 1,
        restriction: RestrictionType.Weekly,
      },
      {
        schedule: schedules[2]!.id!.toString(),
        name: "after",
        order: 2,
        restriction: RestrictionType.Weekly,
      },
    ]);

    const layerUsers: Array<OnCallDutyPolicyScheduleLayerUser> =
      world.dataOf<OnCallDutyPolicyScheduleLayerUser>(
        "OnCallDutyPolicyScheduleLayerUser",
      );

    const usersOf: (layer: OnCallDutyPolicyScheduleLayer) => Array<unknown> = (
      layer: OnCallDutyPolicyScheduleLayer,
    ) => {
      return layerUsers
        .filter(
          (user) =>
            user.onCallDutyPolicyScheduleLayerId?.toString() ===
            layer.id!.toString(),
        )
        .map((user) => [user.userId?.toString(), user.order]);
    };

    expect(usersOf(layers[0]!)).toEqual([
      [world.userIdFor("alice@example.com"), 1],
      [world.userIdFor("bob@example.com"), 2],
    ]);
    expect(usersOf(layers[1]!)).toEqual([[MEMBER_USER_ID, 1]]);
    expect(usersOf(layers[3]!)).toEqual([
      [world.userIdFor("bob@example.com"), 1],
      [world.userIdFor("alice@example.com"), 2],
    ]);

    expect(outcomeOf(report, "OnCallSchedule:primary")).toMatchObject({
      outcome: ToolImportOutcome.Created,
      recordIds: [schedules[0]!.id!.toString(), schedules[1]!.id!.toString()],
    });
  });

  test("a schedule's owner team is set on every schedule it became", async () => {
    const world: ApplierWorld = new ApplierWorld();
    await runImport({});

    const teamId: string = world.dataOf<Team>("Team")[0]!.id!.toString();
    const owners: Array<Record<string, unknown>> = world
      .dataOf("OnCallDutyPolicyScheduleOwnerTeam")
      .map((owner) => {
        return {
          schedule: (
            owner as unknown as { onCallDutyPolicyScheduleId: ObjectID }
          ).onCallDutyPolicyScheduleId.toString(),
          team: (owner as unknown as { teamId: ObjectID }).teamId.toString(),
        };
      });

    const schedules: Array<OnCallDutyPolicySchedule> =
      world.dataOf<OnCallDutyPolicySchedule>("OnCallDutyPolicySchedule");

    expect(owners).toEqual([
      { schedule: schedules[0]!.id!.toString(), team: teamId },
      { schedule: schedules[1]!.id!.toString(), team: teamId },
    ]);
  });

  test("a policy pages every schedule a schedule became, the people and teams of each level, with its waits and repeat", async () => {
    const world: ApplierWorld = new ApplierWorld();
    const { report } = await runImport({});

    const created: OnCallDutyPolicy =
      world.dataOf<OnCallDutyPolicy>("OnCallDutyPolicy")[0]!;

    expect(created.name).toBe("Escalation");
    expect(created.repeatPolicyIfNoOneAcknowledges).toBe(true);
    expect(created.repeatPolicyIfNoOneAcknowledgesNoOfTimes).toBe(2);

    const rules = world.createsOf("OnCallDutyPolicyEscalationRule");
    const schedules: Array<OnCallDutyPolicySchedule> =
      world.dataOf<OnCallDutyPolicySchedule>("OnCallDutyPolicySchedule");
    const teamId: string = world.dataOf<Team>("Team")[0]!.id!.toString();

    const ids: (value: unknown) => Array<string> = (value: unknown) => {
      return ((value as Array<ObjectID>) || []).map((id: ObjectID) =>
        id.toString(),
      );
    };

    expect(
      rules.map((rule) => {
        const data: OnCallDutyPolicyEscalationRule =
          rule.data as OnCallDutyPolicyEscalationRule;

        return {
          policy: data.onCallDutyPolicyId?.toString(),
          order: data.order,
          wait: data.escalateAfterInMinutes,
          // Unnamed: the server names it "Level N".
          name: data.name,
          users: ids(rule.miscDataProps?.["users"]),
          teams: ids(rule.miscDataProps?.["teams"]),
          schedules: ids(rule.miscDataProps?.["onCallSchedules"]),
        };
      }),
    ).toEqual([
      {
        policy: created.id!.toString(),
        order: 1,
        wait: 5,
        name: undefined,
        users: [],
        teams: [],
        schedules: [schedules[0]!.id!.toString(), schedules[1]!.id!.toString()],
      },
      {
        policy: created.id!.toString(),
        order: 2,
        wait: 15,
        name: undefined,
        users: [world.userIdFor("bob@example.com")],
        teams: [teamId],
        schedules: [],
      },
    ]);

    expect(world.dataOf("OnCallDutyPolicyOwnerTeam")).toHaveLength(1);
    expect(outcomeOf(report, "OnCallPolicy:escalation").outcome).toBe(
      ToolImportOutcome.Created,
    );
  });

  test("services, severities, states, roles and custom fields are created with what OneUptime needs of each", async () => {
    const world: ApplierWorld = new ApplierWorld();
    await runImport({});

    const createdService: ServiceModel = world.dataOf<ServiceModel>("Service")[0]!;
    expect(createdService.name).toBe("Checkout");
    expect(createdService.description).toBe("Takes the money");
    expect(world.dataOf("ServiceOwnerTeam")).toHaveLength(1);

    const createdSeverity: IncidentSeverity =
      world.dataOf<IncidentSeverity>("IncidentSeverity")[0]!;
    expect(createdSeverity.name).toBe("SEV1");
    // The most severe is red.
    expect(createdSeverity.color?.toString()).toBe("#ef4444");

    const createdState: IncidentState =
      world.dataOf<IncidentState>("IncidentState")[0]!;
    expect(createdState).toMatchObject({
      name: "Fixing",
      isCreatedState: false,
      isAcknowledgedState: false,
      isResolvedState: false,
    });
    expect(createdState.order).toBeUndefined();
    expect(createdState.color?.toString()).toMatch(/^#[0-9a-f]{6}$/i);

    const createdRole: IncidentRole = world.dataOf<IncidentRole>("IncidentRole")[0]!;
    expect(createdRole).toMatchObject({
      name: "Communications",
      isPrimaryRole: false,
      isDeleteable: true,
      canAssignMultipleUsers: false,
    });

    const createdField: IncidentCustomField =
      world.dataOf<IncidentCustomField>("IncidentCustomField")[0]!;
    expect(createdField).toMatchObject({
      name: "Affected Area",
      customFieldType: CustomFieldType.Dropdown,
      dropdownOptions: "Product\nBilling",
    });
  });

  test("people come first, then teams, and policies last", async () => {
    const world: ApplierWorld = new ApplierWorld();
    await runImport({});

    const order: Array<string> = world.creates.map((create) => create.service);
    const first: (service: string) => number = (service: string) =>
      order.indexOf(service);

    expect(first("TeamMember")).toBe(0);
    expect(first("Team")).toBeLessThan(first("Service"));
    expect(first("Service")).toBeLessThan(first("OnCallDutyPolicySchedule"));
    expect(first("OnCallDutyPolicySchedule")).toBeLessThan(
      first("OnCallDutyPolicy"),
    );
  });

  test("every record created is remembered by the tool's id, complete once its parts are made", async () => {
    const world: ApplierWorld = new ApplierWorld();
    await runImport({});

    expect(
      world.records.map((record: ToolImportRecord) => {
        return [record.kind, record.sourceId, record.isComplete];
      }),
    ).toEqual([
      [ToolImportResourceKind.Person, "alice", true],
      [ToolImportResourceKind.Person, "bob", true],
      [ToolImportResourceKind.Person, "carl", true],
      [ToolImportResourceKind.Team, "platform", true],
      [ToolImportResourceKind.Service, "checkout", true],
      [ToolImportResourceKind.IncidentSeverity, "critical", true],
      [ToolImportResourceKind.IncidentState, "fixing", true],
      [ToolImportResourceKind.IncidentRole, "comms", true],
      [ToolImportResourceKind.IncidentCustomField, "area", true],
      [ToolImportResourceKind.OnCallSchedule, "primary", true],
      [ToolImportResourceKind.OnCallSchedule, "primary#2", true],
      [ToolImportResourceKind.OnCallSchedule, "hours", true],
      [ToolImportResourceKind.OnCallPolicy, "escalation", true],
    ]);

    for (const record of world.records) {
      expect(record.source).toBe(ToolImportSource.OpsGenie);
      expect(record.projectId?.toString()).toBe(PROJECT_ID.toString());
      expect(record.toolImportRunId?.toString()).toBe(RUN_ID.toString());
    }
  });

  test("progress counts the ticked items to the end", async () => {
    new ApplierWorld();
    const { progress, plan } = await runImport({});

    const total: number = plan.items.filter(
      (item: ToolImportPlanItem) => item.isSelectable,
    ).length;

    expect(progress[0]).toEqual({ done: 0, total: total, kind: undefined });
    expect(progress[progress.length - 1]!.done).toBe(total);
    expect(
      progress.every((entry: ToolImportProgress, index: number) => {
        return index === 0 || entry.done >= progress[index - 1]!.done;
      }),
    ).toBe(true);
  });
});

describe("ToolImportApplier: what was not ticked, and what was not brought over", () => {
  test("an unticked item is skipped as not chosen; what names it leaves it out, and says who", async () => {
    const world: ApplierWorld = new ApplierWorld();
    const { report } = await runImport({
      selectedKeys: (plan: ToolImportPlan) => {
        return plan.items
          .filter((item: ToolImportPlanItem) => item.isSelectable)
          .map((item: ToolImportPlanItem) => item.key)
          .filter((key: string) => key !== "Person:bob" && key !== "OnCallSchedule:primary");
      },
    });

    expect(outcomeOf(report, "Person:bob")).toMatchObject({
      outcome: ToolImportOutcome.Skipped,
      reason: { code: ToolImportNoteCode.NotSelected },
    });
    expect(outcomeOf(report, "Team:platform").notes).toEqual([
      { code: ToolImportNoteCode.PersonLeftOut, values: { name: "bob@example.com" } },
    ]);
    expect(outcomeOf(report, "OnCallPolicy:escalation").notes).toEqual(
      expect.arrayContaining([
        { code: ToolImportNoteCode.ScheduleLeftOut, values: { name: "Primary" } },
        { code: ToolImportNoteCode.PersonLeftOut, values: { name: "bob@example.com" } },
        { code: ToolImportNoteCode.PolicyLevelLeftOut, values: { level: 1 } },
      ]),
    );

    // Level 1 paged only the schedule that was left out, so one rule is made.
    expect(world.createsOf("OnCallDutyPolicyEscalationRule")).toHaveLength(1);
    expect(
      world.dataOf<OnCallDutyPolicyEscalationRule>(
        "OnCallDutyPolicyEscalationRule",
      )[0]!.order,
    ).toBe(1);
  });

  test("with no team to invite to, nobody new is invited; layers keep the members, and a rotation of nobody is left out", async () => {
    const world: ApplierWorld = new ApplierWorld();
    const { report } = await runImport({ inviteTeamId: null });

    expect(
      world.createsOf("TeamMember").filter((create) => create.miscDataProps),
    ).toEqual([]);
    expect(outcomeOf(report, "Person:alice")).toMatchObject({
      outcome: ToolImportOutcome.Skipped,
      reason: { code: ToolImportNoteCode.PersonNotInvited },
    });

    const hours: ToolImportReportItem = outcomeOf(report, "OnCallSchedule:hours");

    expect(hours.outcome).toBe(ToolImportOutcome.Created);
    expect(hours.notes).toEqual(
      expect.arrayContaining([
        { code: ToolImportNoteCode.RotationNobody, values: { rotation: "business" } },
        { code: ToolImportNoteCode.RotationNobody, values: { rotation: "after" } },
      ]),
    );

    // The shadow rotation is Mia's, who is a member: it is still a layer.
    expect(
      world
        .dataOf<OnCallDutyPolicyScheduleLayer>("OnCallDutyPolicyScheduleLayer")
        .map((layer) => layer.name),
    ).toEqual(["shadow"]);
  });

  test("a policy whose levels page nobody brought over is not created", async () => {
    const world: ApplierWorld = new ApplierWorld();
    const { report } = await runImport({
      snapshot: snapshot({
        people: [person("ghost")],
        policies: [policy("lonely", "Lonely", [level({ people: ["ghost"] })])],
      }),
      state: projectState(),
      selectedKeys: () => ["OnCallPolicy:lonely"],
    });

    expect(outcomeOf(report, "OnCallPolicy:lonely")).toMatchObject({
      outcome: ToolImportOutcome.Skipped,
      reason: { code: ToolImportNoteCode.NothingToPage },
      notes: [{ code: ToolImportNoteCode.PersonLeftOut, values: { name: "ghost@example.com" } }],
    });
    expect(world.createsOf("OnCallDutyPolicy")).toEqual([]);
  });

  test("on the Free plan only a policy's first level is made", async () => {
    const world: ApplierWorld = new ApplierWorld();
    await runImport({ isLimitedToOneLevelPerPolicy: true });

    expect(world.createsOf("OnCallDutyPolicyEscalationRule")).toHaveLength(1);
  });

  test("a matched record is what the import's records name", async () => {
    const world: ApplierWorld = new ApplierWorld();
    const existingScheduleId: string = ObjectID.generate().toString();

    await runImport({
      state: projectState({
        memberUserIdsByEmail: new Map([["mia@example.com", MEMBER_USER_ID]]),
        existingByKind: new Map([
          [
            ToolImportResourceKind.OnCallSchedule,
            [{ id: existingScheduleId, name: "Primary" }],
          ],
        ]),
      }),
    });

    const rule = world.createsOf("OnCallDutyPolicyEscalationRule")[0]!;

    expect(
      (rule.miscDataProps?.["onCallSchedules"] as Array<ObjectID>).map(
        (id: ObjectID) => id.toString(),
      ),
    ).toEqual([existingScheduleId]);
    expect(
      world
        .dataOf<OnCallDutyPolicySchedule>("OnCallDutyPolicySchedule")
        .map((created) => created.name),
    ).toEqual(["Hours"]);
  });

  test("two items of the same unique name: the second names what the first became", async () => {
    const world: ApplierWorld = new ApplierWorld();
    const { report } = await runImport({
      snapshot: snapshot({
        incidentSeverities: [severity("a", "Major", 1), severity("b", "MAJOR", 2)],
      }),
      state: projectState(),
    });

    const createdId: string = world
      .dataOf<IncidentSeverity>("IncidentSeverity")[0]!
      .id!.toString();

    expect(world.createsOf("IncidentSeverity")).toHaveLength(1);
    expect(outcomeOf(report, "IncidentSeverity:b")).toMatchObject({
      outcome: ToolImportOutcome.Matched,
      recordIds: [createdId],
    });
  });
});

describe("ToolImportApplier: when OneUptime refuses", () => {
  test("a refused create fails that item with OneUptime's words, and the import goes on", async () => {
    const world: ApplierWorld = new ApplierWorld().refuse("Team", () => {
      return new NotAuthorizedException(
        "Cannot create teams while SCIM Push Groups is enabled for this project.",
      );
    });

    const { report } = await runImport({});

    expect(outcomeOf(report, "Team:platform")).toMatchObject({
      outcome: ToolImportOutcome.Failed,
      recordIds: [],
      error:
        "Cannot create teams while SCIM Push Groups is enabled for this project.",
    });

    // Everything else was still made, without the team.
    expect(outcomeOf(report, "OnCallPolicy:escalation")).toMatchObject({
      outcome: ToolImportOutcome.Created,
      notes: expect.arrayContaining([
        { code: ToolImportNoteCode.TeamLeftOut, values: { name: "Platform" } },
      ]),
    });
    expect(world.createsOf("OnCallDutyPolicyOwnerTeam")).toEqual([]);
  });

  test("a part OneUptime refuses (an owner team) is noted on its record, which is kept", async () => {
    new ApplierWorld().refuse("ServiceOwnerTeam", () => {
      return new BadDataException("Owner teams need the Growth plan.");
    });

    const { report } = await runImport({});

    expect(outcomeOf(report, "Service:checkout")).toMatchObject({
      outcome: ToolImportOutcome.Created,
      notes: [
        {
          code: ToolImportNoteCode.PartNotAdded,
          values: {
            name: "Platform",
            error: "Owner teams need the Growth plan.",
          },
        },
      ],
    });
  });

  test("someone invited by somebody else while the import ran is matched, not failed", async () => {
    const world: ApplierWorld = new ApplierWorld().refuse(
      "TeamMember",
      (data) => {
        return (data as TeamMember).userId
          ? null
          : new BadDataException(Errors.TeamMemberService.ALREADY_INVITED);
      },
    );
    world.members.set("alice@example.com", "alice-user-id");

    const { report } = await runImport({
      snapshot: snapshot({ people: [person("alice")] }),
      state: projectState(),
      selectedKeys: () => ["Person:alice"],
    });

    expect(outcomeOf(report, "Person:alice")).toMatchObject({
      outcome: ToolImportOutcome.Matched,
      recordIds: ["alice-user-id"],
      reason: { code: ToolImportNoteCode.PersonAlreadyMember },
    });
  });

  test("an invitation refused for another reason fails the person", async () => {
    new ApplierWorld().refuse("TeamMember", () => {
      return new BadDataException("You have reached the member limit.");
    });

    const { report } = await runImport({
      snapshot: snapshot({ people: [person("alice")] }),
      state: projectState(),
      selectedKeys: () => ["Person:alice"],
    });

    expect(outcomeOf(report, "Person:alice")).toMatchObject({
      outcome: ToolImportOutcome.Failed,
      error: "You have reached the member limit.",
    });
  });
});

describe("ToolImportApplier: never twice", () => {
  function remembered(
    world: ApplierWorld,
    data: {
      kind: ToolImportResourceKind;
      sourceId: string;
      runId: ObjectID;
      isComplete: boolean;
    },
  ): string {
    const record: ToolImportRecord = new ToolImportRecord();
    record.id = ObjectID.generate();
    record.projectId = PROJECT_ID;
    record.source = ToolImportSource.OpsGenie;
    record.kind = data.kind;
    record.sourceId = data.sourceId;
    record.recordId = ObjectID.generate();
    record.isComplete = data.isComplete;
    record.toolImportRunId = data.runId;
    world.records.push(record);
    return record.recordId.toString();
  }

  test("an item this run already made (before its worker stopped) is reported, not made again", async () => {
    const world: ApplierWorld = new ApplierWorld();
    const teamId: string = remembered(world, {
      kind: ToolImportResourceKind.Team,
      sourceId: "platform",
      runId: RUN_ID,
      isComplete: true,
    });

    const { report } = await runImport({});

    expect(world.createsOf("Team")).toEqual([]);
    expect(outcomeOf(report, "Team:platform")).toMatchObject({
      outcome: ToolImportOutcome.Created,
      recordIds: [teamId],
    });

    // What names the team still names it.
    expect(
      (
        world.createsOf("OnCallDutyPolicyEscalationRule")[1]!.miscDataProps?.[
          "teams"
        ] as Array<ObjectID>
      ).map((id: ObjectID) => id.toString()),
    ).toEqual([teamId]);
  });

  test("an item this run left half made is reported as stopped part way, never duplicated", async () => {
    const world: ApplierWorld = new ApplierWorld();
    const scheduleId: string = remembered(world, {
      kind: ToolImportResourceKind.OnCallSchedule,
      sourceId: "hours",
      runId: RUN_ID,
      isComplete: false,
    });

    const { report } = await runImport({});

    expect(outcomeOf(report, "OnCallSchedule:hours")).toMatchObject({
      outcome: ToolImportOutcome.Failed,
      recordIds: [scheduleId],
      reason: { code: ToolImportNoteCode.StoppedPartWay },
    });
    expect(
      world
        .dataOf<OnCallDutyPolicySchedule>("OnCallDutyPolicySchedule")
        .map((created) => created.name),
    ).toEqual(["Primary", "Primary (shadow)"]);
  });

  test("a record an earlier import remembered, deleted in OneUptime since, is forgotten and made again", async () => {
    const world: ApplierWorld = new ApplierWorld();
    remembered(world, {
      kind: ToolImportResourceKind.Service,
      sourceId: "checkout",
      runId: ObjectID.generate(),
      isComplete: true,
    });
    const staleRecordId: string = world.records[0]!.id!.toString();

    // The plan saw the service gone (previousRecords.stillExists false).
    const { report } = await runImport({
      state: projectState({
        memberUserIdsByEmail: new Map([["mia@example.com", MEMBER_USER_ID]]),
        previousRecords: [
          {
            kind: ToolImportResourceKind.Service,
            sourceId: "checkout",
            recordId: ObjectID.generate().toString(),
            isComplete: true,
            stillExists: false,
          },
        ],
      }),
    });

    expect(world.deletedRecordIds).toEqual([staleRecordId]);
    expect(world.createsOf("Service")).toHaveLength(1);
    expect(outcomeOf(report, "Service:checkout").outcome).toBe(
      ToolImportOutcome.Created,
    );
  });

  test("a second import of the same tool finds everything the first made, and makes nothing", async () => {
    const first: ApplierWorld = new ApplierWorld();
    const firstRun: Run = await runImport({});
    const createdCount: number = first.creates.length;

    // What the first import remembered, as the second one's state reads it.
    const previous: ToolImportProjectState = state();
    previous.previousRecords = first.records.map((record: ToolImportRecord) => {
      return {
        kind: record.kind!,
        sourceId: record.sourceId!,
        recordId: record.recordId!.toString(),
        isComplete: true,
        stillExists: true,
      };
    });
    for (const item of firstRun.report.items) {
      if (item.kind === ToolImportResourceKind.Person && item.recordIds[0]) {
        previous.memberUserIdsByEmail.set(
          `${item.sourceId}@example.com`,
          item.recordIds[0],
        );
      }
    }

    const secondPlan: ToolImportPlan = buildToolImportPlan({
      snapshot: account(),
      state: previous,
      access: access(),
    });

    expect(
      secondPlan.items.filter(
        (item: ToolImportPlanItem) =>
          item.action === ToolImportAction.Create ||
          item.action === ToolImportAction.Invite,
      ),
    ).toEqual([]);

    jest.restoreAllMocks();
    const second: ApplierWorld = new ApplierWorld();
    const secondRun: Run = await runImport({ state: previous });

    expect(createdCount).toBeGreaterThan(0);
    expect(second.creates).toEqual([]);
    expect(
      secondRun.report.items
        .filter((item: ToolImportReportItem) => item.kind !== ToolImportResourceKind.Person)
        .every(
          (item: ToolImportReportItem) =>
            item.outcome === ToolImportOutcome.AlreadyImported,
        ),
    ).toBe(true);
  });
});

describe("toErrorMessage", () => {
  test("is OneUptime's own words, cut short", () => {
    expect(toErrorMessage(new BadDataException("No."))).toBe("No.");
    expect(toErrorMessage("plain")).toBe("plain");
    expect(toErrorMessage(42)).toBe("Something went wrong.");
    expect(toErrorMessage(new Error("x".repeat(900))).length).toBe(500);
  });
});
