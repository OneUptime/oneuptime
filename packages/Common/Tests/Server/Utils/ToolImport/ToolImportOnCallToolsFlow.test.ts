import { afterEach, describe, expect, jest, test } from "@jest/globals";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import ServiceModel from "../../../../Models/DatabaseModels/Service";
import GrafanaOnCallAdapter from "../../../../Server/Utils/ToolImport/Adapters/GrafanaOnCall/GrafanaOnCallAdapter";
import PagerDutyAdapter from "../../../../Server/Utils/ToolImport/Adapters/PagerDuty/PagerDutyAdapter";
import SplunkOnCallAdapter from "../../../../Server/Utils/ToolImport/Adapters/SplunkOnCall/SplunkOnCallAdapter";
import ToolImportApplier from "../../../../Server/Utils/ToolImport/ToolImportApplier";
import { buildToolImportPlan } from "../../../../Server/Utils/ToolImport/ToolImportPlanner";
import {
  ToolImportAdapter,
  ToolImportReadSettings,
} from "../../../../Server/Utils/ToolImport/Types";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { ToolImportNoteCode } from "../../../../Types/ToolImport/ToolImportNote";
import {
  ToolImportAction,
  ToolImportOutcome,
  ToolImportPlan,
  ToolImportPlanItem,
  ToolImportReport,
  ToolImportReportItem,
} from "../../../../Types/ToolImport/ToolImportPlan";
import ToolImportResourceKind, {
  getToolImportItemKey,
} from "../../../../Types/ToolImport/ToolImportResourceKind";
import { ToolImportSnapshot } from "../../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../../Types/ToolImport/ToolImportSource";
import * as Grafana from "./GrafanaOnCallFixtures";
import * as PagerDuty from "./PagerDutyFixtures";
import * as Splunk from "./SplunkOnCallFixtures";
import { ApplierWorld, RecordedCreate } from "./ToolImportApplierWorld";
import { FixtureApi, RecordingSleep } from "./ToolImportFixtureTransport";
import { fullAccess, projectState } from "./ToolImportSnapshotFixtures";

/*
 * Each new tool, from its API to OneUptime: the real adapter reads its
 * fixture API, the real planner works out the preview, and the real
 * applier imports everything that can be ticked, with OneUptime's services
 * stood in for (ApplierWorld). What each tool's ideas become - above all,
 * that PagerDuty's layers stay one schedule in their order, Splunk On-Call
 * shifts on call together split, and Grafana OnCall's higher layers sit on
 * top of every part - is checked on what the import creates.
 */

const NOW: number = Date.parse("2026-10-08T12:00:00Z");
const PROJECT_ID: ObjectID = ObjectID.generate();
const RUN_ID: ObjectID = ObjectID.generate();
const INVITE_TEAM_ID: string = ObjectID.generate().toString();

const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: ObjectID.generate(),
};

interface Flow {
  snapshot: ToolImportSnapshot;
  plan: ToolImportPlan;
  report: ToolImportReport;
  world: ApplierWorld;
}

async function importAll(data: {
  adapter: ToolImportAdapter;
  settings: ToolImportReadSettings;
  api: FixtureApi;
}): Promise<Flow> {
  const sleep: RecordingSleep = new RecordingSleep({ now: NOW });
  const snapshot: ToolImportSnapshot = await data.adapter.read(data.settings, {
    transport: data.api.transport,
    sleep: sleep.sleep,
    now: (): number => {
      return sleep.clock.now;
    },
    maxRequests: 500,
    deadlineAt: NOW + 15 * 60 * 1000,
  });

  const plan: ToolImportPlan = buildToolImportPlan({
    snapshot: snapshot,
    state: projectState(),
    access: fullAccess({
      inviteTeams: [{ id: INVITE_TEAM_ID, name: "Members" }],
      defaultInviteTeamId: INVITE_TEAM_ID,
    }),
  });

  const world: ApplierWorld = new ApplierWorld();

  const report: ToolImportReport = await ToolImportApplier.apply({
    runId: RUN_ID,
    projectId: PROJECT_ID,
    source: data.settings.source,
    snapshot: snapshot,
    plan: plan,
    selection: {
      selectedKeys: plan.items
        .filter((item: ToolImportPlanItem): boolean => {
          return item.isSelectable;
        })
        .map((item: ToolImportPlanItem): string => {
          return item.key;
        }),
      inviteTeamId: INVITE_TEAM_ID,
    },
    props: PROPS,
    isLimitedToOneLevelPerPolicy: false,
    now: new Date(NOW),
    onProgress: async (): Promise<void> => {},
  });

  return { snapshot, plan, report, world };
}

function itemOf(
  plan: ToolImportPlan,
  kind: ToolImportResourceKind,
  sourceId: string,
): ToolImportPlanItem {
  const key: string = getToolImportItemKey(kind, sourceId);
  const item: ToolImportPlanItem | undefined = plan.items.find(
    (candidate: ToolImportPlanItem): boolean => {
      return candidate.key === key;
    },
  );

  if (!item) {
    throw new Error(`No plan item ${key}`);
  }

  return item;
}

function reportOf(report: ToolImportReport, key: string): ToolImportReportItem {
  const item: ToolImportReportItem | undefined = report.items.find(
    (candidate: ToolImportReportItem): boolean => {
      return candidate.key === key;
    },
  );

  if (!item) {
    throw new Error(`No report item ${key}`);
  }

  return item;
}

// The schedules created, each with its layers in order and their people.
function schedulesOf(world: ApplierWorld): Array<{
  name: string;
  timezone: string;
  layers: Array<{ name: string; order: number; users: Array<string> }>;
}> {
  const layerUsers: Array<OnCallDutyPolicyScheduleLayerUser> =
    world.dataOf<OnCallDutyPolicyScheduleLayerUser>(
      "OnCallDutyPolicyScheduleLayerUser",
    );

  return world
    .dataOf<OnCallDutyPolicySchedule>("OnCallDutyPolicySchedule")
    .map((schedule: OnCallDutyPolicySchedule) => {
      return {
        name: schedule.name!,
        timezone: String(schedule.timezone),
        layers: world
          .dataOf<OnCallDutyPolicyScheduleLayer>(
            "OnCallDutyPolicyScheduleLayer",
          )
          .filter((layer: OnCallDutyPolicyScheduleLayer): boolean => {
            return (
              layer.onCallDutyPolicyScheduleId?.toString() ===
              schedule.id!.toString()
            );
          })
          .map((layer: OnCallDutyPolicyScheduleLayer) => {
            return {
              name: layer.name!,
              order: layer.order!,
              users: layerUsers
                .filter((user: OnCallDutyPolicyScheduleLayerUser) => {
                  return (
                    user.onCallDutyPolicyScheduleLayerId?.toString() ===
                    layer.id!.toString()
                  );
                })
                .sort(
                  (
                    first: OnCallDutyPolicyScheduleLayerUser,
                    second: OnCallDutyPolicyScheduleLayerUser,
                  ): number => {
                    return first.order! - second.order!;
                  },
                )
                .map((user: OnCallDutyPolicyScheduleLayerUser): string => {
                  return user.userId!.toString();
                }),
            };
          }),
      };
    });
}

function scheduleIdsNamed(world: ApplierWorld, prefix: string): Array<string> {
  return world
    .dataOf<OnCallDutyPolicySchedule>("OnCallDutyPolicySchedule")
    .filter((schedule: OnCallDutyPolicySchedule): boolean => {
      return schedule.name!.startsWith(prefix);
    })
    .map((schedule: OnCallDutyPolicySchedule): string => {
      return schedule.id!.toString();
    });
}

// The rules of the policy named `name`, with what each pages.
function rulesOf(
  world: ApplierWorld,
  name: string,
): Array<{
  escalateAfterInMinutes: number;
  users: Array<string>;
  teams: number;
  schedules: Array<string>;
}> {
  const policy: OnCallDutyPolicy = world
    .dataOf<OnCallDutyPolicy>("OnCallDutyPolicy")
    .find((candidate: OnCallDutyPolicy): boolean => {
      return candidate.name === name;
    })!;

  return world
    .createsOf("OnCallDutyPolicyEscalationRule")
    .filter((create: RecordedCreate): boolean => {
      return (
        (
          create.data as OnCallDutyPolicyEscalationRule
        ).onCallDutyPolicyId?.toString() === policy.id!.toString()
      );
    })
    .map((create: RecordedCreate) => {
      const misc: JSONObject = create.miscDataProps || {};
      const ids: (field: string) => Array<string> = (field: string) => {
        return ((misc[field] as Array<ObjectID> | undefined) || []).map(
          (id: ObjectID): string => {
            return id.toString();
          },
        );
      };

      return {
        escalateAfterInMinutes: (create.data as OnCallDutyPolicyEscalationRule)
          .escalateAfterInMinutes!,
        users: ids("users"),
        teams: ids("teams").length,
        schedules: ids("onCallSchedules"),
      };
    });
}

function userIdOf(world: ApplierWorld, email: string): string {
  return world.userIdFor(email);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a PagerDuty account, imported", () => {
  async function flow(): Promise<Flow> {
    return await importAll({
      adapter: new PagerDutyAdapter(),
      settings: {
        source: ToolImportSource.PagerDuty,
        apiKey: PagerDuty.PAGERDUTY_KEY,
        region: "US",
      },
      api: PagerDuty.pagerDutyApi(),
    });
  }

  test("the preview: layers that override one another are one schedule each; a disabled service and a policy that pages nothing are said so", async () => {
    const { plan } = await flow();

    expect(
      itemOf(
        plan,
        ToolImportResourceKind.OnCallSchedule,
        PagerDuty.PRIMARY_SCHEDULE_ID,
      ).summary,
    ).toMatchObject({
      scheduleCount: 1,
      layerCount: 2,
      timezone: "America/New_York",
    });
    expect(
      itemOf(
        plan,
        ToolImportResourceKind.OnCallSchedule,
        PagerDuty.BUSINESS_SCHEDULE_ID,
      ).summary,
    ).toMatchObject({
      scheduleCount: 1,
      layerCount: 2,
      timezone: "Europe/London",
    });

    for (const item of plan.items) {
      expect(
        item.notes.some((note: { code: ToolImportNoteCode }) => {
          return note.code === ToolImportNoteCode.ScheduleSplit;
        }),
      ).toBe(false);
    }

    const legacy: ToolImportPlanItem = itemOf(
      plan,
      ToolImportResourceKind.Service,
      PagerDuty.LEGACY_SERVICE_ID,
    );
    expect(legacy.action).toBe(ToolImportAction.Create);
    expect(legacy.isSelectedByDefault).toBe(false);
    expect(
      itemOf(
        plan,
        ToolImportResourceKind.Service,
        PagerDuty.CHECKOUT_SERVICE_ID,
      ).isSelectedByDefault,
    ).toBe(true);

    const shiftBased: ToolImportPlanItem = itemOf(
      plan,
      ToolImportResourceKind.OnCallPolicy,
      PagerDuty.SHIFT_BASED_POLICY_ID,
    );
    expect(shiftBased.action).toBe(ToolImportAction.Skip);
    expect(shiftBased.reason?.code).toBe(ToolImportNoteCode.NothingToPage);
    expect(shiftBased.notes).toContainEqual({
      code: ToolImportNoteCode.PolicyScheduleNotRead,
    });
    expect(plan.notes).toEqual([
      { code: ToolImportNoteCode.ShiftBasedSchedulesNotRead },
    ]);
  });

  test("the import: one schedule per PagerDuty schedule, its layers in PagerDuty's order with their people", async () => {
    const { world } = await flow();
    const alice: string = userIdOf(world, "alice@example.com");
    const bob: string = userIdOf(world, "bob@example.com");
    const carol: string = userIdOf(world, "carol@example.com");

    expect(schedulesOf(world)).toEqual([
      {
        name: "Primary",
        timezone: "America/New_York",
        layers: [
          { name: "Weekend cover", order: 1, users: [carol] },
          { name: "Layer 1", order: 2, users: [alice, bob] },
        ],
      },
      {
        name: "Business hours",
        timezone: "Europe/London",
        layers: [
          { name: "Next quarter", order: 1, users: [bob, alice] },
          { name: "Nine to six", order: 2, users: [bob] },
        ],
      },
      {
        name: "Backup",
        timezone: "UTC",
        layers: [{ name: "Half days", order: 1, users: [bob, alice] }],
      },
    ]);
  });

  test("the import: each escalation rule is a rule that waits its delay; the policy loops twice; services keep their team", async () => {
    const { world, report } = await flow();

    expect(rulesOf(world, "Platform EP")).toEqual([
      {
        escalateAfterInMinutes: 15,
        users: [],
        teams: 0,
        schedules: scheduleIdsNamed(world, "Primary"),
      },
      {
        escalateAfterInMinutes: 30,
        users: [userIdOf(world, "bob@example.com")],
        teams: 0,
        schedules: [],
      },
    ]);

    const platform: OnCallDutyPolicy = world
      .dataOf<OnCallDutyPolicy>("OnCallDutyPolicy")
      .find((policy: OnCallDutyPolicy): boolean => {
        return policy.name === "Platform EP";
      })!;
    expect(platform.repeatPolicyIfNoOneAcknowledges).toBe(true);
    expect(platform.repeatPolicyIfNoOneAcknowledgesNoOfTimes).toBe(2);

    expect(
      world.dataOf<ServiceModel>("Service").map((service: ServiceModel) => {
        return service.name;
      }),
    ).toEqual(["Checkout API", "Legacy batch"]);
    expect(world.createsOf("ServiceOwnerTeam")).toHaveLength(1);

    expect(
      reportOf(
        report,
        getToolImportItemKey(
          ToolImportResourceKind.OnCallPolicy,
          PagerDuty.SHIFT_BASED_POLICY_ID,
        ),
      ).outcome,
    ).toBe(ToolImportOutcome.Skipped);
  });
});

describe("a Splunk On-Call organisation, imported", () => {
  async function flow(): Promise<Flow> {
    return await importAll({
      adapter: new SplunkOnCallAdapter(),
      settings: {
        source: ToolImportSource.SplunkOnCall,
        apiKey: Splunk.SPLUNK_KEY,
        apiKeyId: Splunk.SPLUNK_API_ID,
        region: "",
      },
      api: Splunk.splunkOnCallApi(),
    });
  }

  test("the preview: shifts that take turns share a schedule; shifts on call together split, and say so", async () => {
    const { plan } = await flow();

    expect(
      itemOf(
        plan,
        ToolImportResourceKind.OnCallSchedule,
        Splunk.PRIMARY_ROTATION_SLUG,
      ).summary,
    ).toMatchObject({ scheduleCount: 1, layerCount: 2 });

    for (const slug of [
      Splunk.SUN_ROTATION_SLUG,
      Splunk.PAYMENTS_ROTATION_SLUG,
    ]) {
      const item: ToolImportPlanItem = itemOf(
        plan,
        ToolImportResourceKind.OnCallSchedule,
        slug,
      );

      expect(item.summary).toMatchObject({ scheduleCount: 2, layerCount: 2 });
      expect(item.notes).toContainEqual({
        code: ToolImportNoteCode.ScheduleSplit,
        values: { count: 2 },
      });
    }

    // dave has no email address: not invited.
    const dave: ToolImportPlanItem = itemOf(
      plan,
      ToolImportResourceKind.Person,
      "dave",
    );
    expect(dave.action).toBe(ToolImportAction.Skip);
    expect(dave.reason?.code).toBe(ToolImportNoteCode.PersonNoEmail);
  });

  test("the import: a policy that pages a rotation that split pages every part of it", async () => {
    const { world } = await flow();
    const payments: Array<string> = scheduleIdsNamed(world, "Payments 24/7");

    expect(payments).toHaveLength(2);
    expect(rulesOf(world, "Payments escalation")).toEqual([
      { escalateAfterInMinutes: 30, users: [], teams: 0, schedules: payments },
    ]);

    expect(rulesOf(world, "Platform escalation")).toEqual([
      {
        escalateAfterInMinutes: 15,
        users: [],
        teams: 0,
        schedules: scheduleIdsNamed(world, "Primary"),
      },
      {
        escalateAfterInMinutes: 10,
        users: [
          userIdOf(world, "bob@example.com"),
          userIdOf(world, "alice@example.com"),
        ],
        teams: 0,
        schedules: [],
      },
      {
        escalateAfterInMinutes: 30,
        users: [],
        teams: 0,
        schedules: scheduleIdsNamed(world, "Primary"),
      },
    ]);
  });

  test("the import: the day and night shifts are one schedule's two layers, lined up with who is on call", async () => {
    const { world } = await flow();
    const alice: string = userIdOf(world, "alice@example.com");
    const bob: string = userIdOf(world, "bob@example.com");
    const carol: string = userIdOf(world, "carol@example.com");

    expect(
      schedulesOf(world).find((schedule: { name: string }) => {
        return schedule.name === "Primary";
      }),
    ).toEqual({
      name: "Primary",
      timezone: "America/Denver",
      layers: [
        { name: "Business hours", order: 1, users: [bob, alice] },
        { name: "After hours", order: 2, users: [carol, alice] },
      ],
    });
  });
});

describe("a Grafana OnCall organisation, imported", () => {
  async function flow(): Promise<Flow> {
    return await importAll({
      adapter: new GrafanaOnCallAdapter(),
      settings: {
        source: ToolImportSource.GrafanaOnCall,
        apiKey: Grafana.GRAFANA_TOKEN,
        apiUrl: Grafana.GRAFANA_API_URL,
        region: "",
      },
      api: Grafana.grafanaOnCallApi(),
    });
  }

  test("the preview: a pair on call together splits the schedule in two; an iCal schedule comes over empty, with why", async () => {
    const { plan } = await flow();

    expect(
      itemOf(
        plan,
        ToolImportResourceKind.OnCallSchedule,
        Grafana.WEB_SCHEDULE_ID,
      ).summary,
    ).toMatchObject({
      scheduleCount: 2,
      layerCount: 4,
      timezone: "Europe/Berlin",
    });

    const ical: ToolImportPlanItem = itemOf(
      plan,
      ToolImportResourceKind.OnCallSchedule,
      Grafana.ICAL_SCHEDULE_ID,
    );
    expect(ical.action).toBe(ToolImportAction.Create);
    expect(ical.summary).toMatchObject({ scheduleCount: 1, layerCount: 0 });
    expect(ical.notes).toContainEqual({
      code: ToolImportNoteCode.ScheduleFromCalendarLink,
    });
  });

  test("the import: the higher layers sit on top of both parts, and the second part is named after its own layer", async () => {
    const { world } = await flow();
    const alice: string = userIdOf(world, "alice@example.com");
    const bob: string = userIdOf(world, "bob@example.com");
    const carol: string = userIdOf(world, "carol@example.com");

    expect(schedulesOf(world)).toEqual([
      {
        name: "Platform primary",
        timezone: "Europe/Berlin",
        layers: [
          { name: "Office hours", order: 1, users: [carol, alice] },
          { name: "Night and weekend", order: 2, users: [alice, bob] },
          { name: "Pair support (1)", order: 3, users: [alice] },
        ],
      },
      {
        name: "Platform primary (Pair support (2))",
        timezone: "Europe/Berlin",
        layers: [
          { name: "Office hours", order: 1, users: [carol, alice] },
          { name: "Night and weekend", order: 2, users: [alice, bob] },
          { name: "Pair support (2)", order: 3, users: [bob] },
        ],
      },
      {
        name: "Payments API",
        timezone: "America/New_York",
        layers: [{ name: "Payments days", order: 1, users: [carol, bob] }],
      },
      { name: "Legacy calendar", timezone: "UTC", layers: [] },
    ]);
  });

  test("the import: a chain's levels page both parts of a split schedule, a team, and people; it repeats five times", async () => {
    const { world } = await flow();

    expect(rulesOf(world, "Platform critical")).toEqual([
      {
        escalateAfterInMinutes: 5,
        users: [userIdOf(world, "bob@example.com")],
        teams: 0,
        schedules: scheduleIdsNamed(world, "Platform primary"),
      },
      { escalateAfterInMinutes: 10, users: [], teams: 1, schedules: [] },
      {
        escalateAfterInMinutes: 30,
        users: [
          userIdOf(world, "alice@example.com"),
          userIdOf(world, "carol@example.com"),
        ],
        teams: 0,
        schedules: [],
      },
    ]);
    expect(scheduleIdsNamed(world, "Platform primary")).toHaveLength(2);

    const critical: OnCallDutyPolicy = world
      .dataOf<OnCallDutyPolicy>("OnCallDutyPolicy")
      .find((policy: OnCallDutyPolicy): boolean => {
        return policy.name === "Platform critical";
      })!;
    expect(critical.repeatPolicyIfNoOneAcknowledgesNoOfTimes).toBe(5);
  });
});
