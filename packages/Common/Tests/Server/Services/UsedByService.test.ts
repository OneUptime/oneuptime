/*
 * The services UsedByService reads through pull in MonitorTemplateUtil,
 * which loads the native isolated-vm addon through VMAPI. Nothing here runs
 * the sandbox, and the prebuilt binary cannot always load in a test.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../../Models/DatabaseModels/Alert";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import Incident from "../../../Models/DatabaseModels/Incident";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorGroup from "../../../Models/DatabaseModels/MonitorGroup";
import MonitorGroupResource from "../../../Models/DatabaseModels/MonitorGroupResource";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import Service from "../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import Team from "../../../Models/DatabaseModels/Team";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import AlertService from "../../../Server/Services/AlertService";
import DashboardService from "../../../Server/Services/DashboardService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import LabelService from "../../../Server/Services/LabelService";
import MonitorGroupResourceService from "../../../Server/Services/MonitorGroupResourceService";
import MonitorGroupService from "../../../Server/Services/MonitorGroupService";
import MonitorService from "../../../Server/Services/MonitorService";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import ServiceService from "../../../Server/Services/ServiceService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import TeamService from "../../../Server/Services/TeamService";
import UsedByService, {
  MONITOR_RULE_PLANS,
  MONITOR_TEMPLATE_PLANS,
  ON_CALL_POLICY_OTHER_PLANS,
  ON_CALL_POLICY_RULE_PLANS,
  TEAM_OWNED_OTHER_PLANS,
  USED_BY_FAMILY_CONCURRENCY,
  USED_BY_RECORD_SERVICES,
  USED_BY_RELATION_DEFINITIONS,
  UsedByReadContext,
  UsedByReadPlan,
  getListJoinTable,
  isReadRefusal,
  namedByRowsReferencing,
  uniqueIds,
  withoutArchived,
} from "../../../Server/Services/UsedByService";
import ServiceLevelObjectiveBurnRateRuleService from "../../../Server/Services/ServiceLevelObjectiveBurnRateRuleService";
import ServiceLevelObjectiveErrorBudgetPolicyTierService from "../../../Server/Services/ServiceLevelObjectiveErrorBudgetPolicyTierService";
import WorkflowService from "../../../Server/Services/WorkflowService";
import IncidentStatusPageScope from "../../../Server/Utils/StatusPage/IncidentStatusPageScope";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ServerException from "../../../Types/Exception/ServerException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  MONITOR_RULE_ROW_KINDS,
  MONITOR_TEMPLATE_ROW_KINDS,
  ON_CALL_POLICY_OTHER_ROW_KINDS,
  ON_CALL_POLICY_RULE_ROW_KINDS,
  TEAM_OWNED_OTHER_ROW_KINDS,
  USED_BY_BULK_MAX_RECORDS,
  USED_BY_MAX_PAGE_SIZE,
  USED_BY_PREVIEW_ROW_COUNT,
  USED_BY_RELATIONS,
  UsedByBulkSummary,
  UsedByCounts,
  UsedByGroup,
  UsedByPage,
  UsedByRecordKind,
  UsedByRelation,
  UsedByRelationDescription,
  UsedByRow,
  UsedByRowKind,
  UsedBySummary,
  getUsedByBulkRelations,
} from "../../../Types/UsedBy/UsedBy";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { FindOperator } from "typeorm";

/*
 * WHAT REFERS TO A RECORD (UsedByService, #6813), read through each model's
 * own service: every relation's query, the reader's permissions (what they
 * may not see is counted, never named), and reads that stay bounded however
 * many records refer to one.
 *
 * Every service read is a fake that answers by the model it is the service
 * of: a total as OneUptime, a count as the reader (or a refusal), and rows.
 * The queries handed to it are kept, and their conditions read back as the
 * SQL Postgres would run.
 */

const PROJECT: ObjectID = new ObjectID("68130000-0000-4000-8000-000000000001");
const RECORD: ObjectID = new ObjectID("68130000-0000-4000-8000-000000000002");
const GROUP_A: string = "68130000-0000-4000-8000-0000000000a1";
const WATCHER_1: string = "68130000-0000-4000-8000-0000000000b1";
const WATCHER_2: string = "68130000-0000-4000-8000-0000000000b2";
const SCHEDULED_STATE: string = "68130000-0000-4000-8000-0000000000c1";
const ONGOING_STATE: string = "68130000-0000-4000-8000-0000000000c2";
const ENDED_STATE: string = "68130000-0000-4000-8000-0000000000c3";
const UNRESOLVED_STATE: string = "68130000-0000-4000-8000-0000000000d1";

const READER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT,
  userId: new ObjectID("68130000-0000-4000-8000-0000000000e1"),
};

type AnyService = DatabaseService<BaseModel>;

interface Fake {
  // How many the project has, read as OneUptime.
  total: number;
  // How many the reader may read, or a refusal of the whole model.
  reader: number | "refuse";
  rows: Array<Record<string, unknown>>;
}

interface Read {
  table: string;
  method: "countBy" | "findBy" | "findOneBy";
  isRoot: boolean;
  query: Record<string, unknown>;
  select?: Record<string, unknown> | undefined;
  sort?: Record<string, unknown> | undefined;
  skip?: number | undefined;
  limit?: number | undefined;
}

const SERVICES: Array<{ service: AnyService; model: { new (): BaseModel } }> = [
  { service: MonitorService as unknown as AnyService, model: Monitor },
  {
    service: StatusPageService as unknown as AnyService,
    model: StatusPage,
  },
  {
    service: MonitorGroupService as unknown as AnyService,
    model: MonitorGroup,
  },
  {
    service: ServiceLevelObjectiveService as unknown as AnyService,
    model: ServiceLevelObjective,
  },
  {
    service: ScheduledMaintenanceService as unknown as AnyService,
    model: ScheduledMaintenance,
  },
  { service: WorkflowService as unknown as AnyService, model: Workflow },
  { service: DashboardService as unknown as AnyService, model: Dashboard },
  {
    service: OnCallDutyPolicyService as unknown as AnyService,
    model: OnCallDutyPolicy,
  },
  {
    service: OnCallDutyPolicyScheduleService as unknown as AnyService,
    model: OnCallDutyPolicySchedule,
  },
  { service: ServiceService as unknown as AnyService, model: Service },
  { service: IncidentService as unknown as AnyService, model: Incident },
  { service: AlertService as unknown as AnyService, model: Alert },
  { service: TeamService as unknown as AnyService, model: Team },
  { service: LabelService as unknown as AnyService, model: Label },
  {
    service: MonitorGroupResourceService as unknown as AnyService,
    model: MonitorGroupResource,
  },
  {
    service:
      OnCallDutyPolicyEscalationRuleScheduleService as unknown as AnyService,
    model: BaseModel,
  },
  {
    service: OnCallDutyPolicyEscalationRuleTeamService as unknown as AnyService,
    model: BaseModel,
  },
];

/*
 * The services a family's kinds are read through, from the plans
 * themselves: a kind added to a family is faked with it.
 */
const FAMILY_SERVICES: Array<AnyService> = uniqueServices(
  [
    ...MONITOR_RULE_PLANS,
    ...MONITOR_TEMPLATE_PLANS,
    ...TEAM_OWNED_OTHER_PLANS,
    ...ON_CALL_POLICY_RULE_PLANS,
    ...ON_CALL_POLICY_OTHER_PLANS,
  ].map((build: (context: UsedByReadContext) => UsedByReadPlan) => {
    return build({
      projectId: new ObjectID("68130000-0000-4000-8000-000000000001"),
      recordIds: [new ObjectID("68130000-0000-4000-8000-000000000002")],
      props: { isRoot: true },
      now: new Date("2026-11-12T10:00:00.000Z"),
    }).service;
  }),
);

function uniqueServices(services: Array<AnyService>): Array<AnyService> {
  return Array.from(new Set<AnyService>(services));
}

const EXTRA_SERVICES: Array<AnyService> = [
  ServiceLevelObjectiveBurnRateRuleService as unknown as AnyService,
  ServiceLevelObjectiveErrorBudgetPolicyTierService as unknown as AnyService,
];

let fakes: Map<string, Fake>;
let reads: Array<Read>;
// Whether the reader may read the record asked about.
let isRecordReadable: boolean;
let recordRefusal: Error | null;

function tableOf(service: AnyService): string {
  return service.getModel().tableName || "";
}

function fake(table: string, values: Partial<Fake>): void {
  fakes.set(table, {
    total: 0,
    reader: 0,
    rows: [],
    ...(fakes.get(table) || {}),
    ...values,
  });
}

function toModel(service: AnyService, row: Record<string, unknown>): BaseModel {
  // A fresh row each time: getModel() hands back the service's one instance.
  const model: BaseModel = new service.modelType();

  for (const key of Object.keys(row)) {
    (model as unknown as Record<string, unknown>)[key] = row[key];
  }

  return model;
}

// Fakes a service's reads with the tables the test set up.
function installFakesOf(service: AnyService): void {
  jest
    .spyOn(service, "countBy")
    .mockImplementation(async (args: any): Promise<PositiveNumber> => {
      const table: string = tableOf(service);
      reads.push({
        table,
        method: "countBy",
        isRoot: Boolean(args.props.isRoot),
        query: args.query,
      });
      countsInFlight += 1;
      mostCountsInFlight = Math.max(mostCountsInFlight, countsInFlight);
      await Promise.resolve();
      countsInFlight -= 1;
      const found: Fake = fakes.get(table) || {
        total: 0,
        reader: 0,
        rows: [],
      };

      if (args.props.isRoot) {
        return new PositiveNumber(found.total);
      }

      if (found.reader === "refuse") {
        throw new NotAuthorizedException(
          "You do not have permission to read these. Ask a Project Admin for access.",
        );
      }

      return new PositiveNumber(found.reader);
    });

  jest
    .spyOn(service, "findBy")
    .mockImplementation(async (args: any): Promise<Array<BaseModel>> => {
      const table: string = tableOf(service);
      reads.push({
        table,
        method: "findBy",
        isRoot: Boolean(args.props.isRoot),
        query: args.query,
        select: args.select,
        sort: args.sort,
        skip: Number(args.skip),
        limit: Number(args.limit),
      });
      const found: Fake = fakes.get(table) || {
        total: 0,
        reader: 0,
        rows: [],
      };

      if (!args.props.isRoot && found.reader === "refuse") {
        throw new NotAuthorizedException(
          "You do not have permission to read these. Ask a Project Admin for access.",
        );
      }

      return found.rows
        .slice(Number(args.skip) || 0)
        .slice(0, Number(args.limit))
        .map((row: Record<string, unknown>): BaseModel => {
          return toModel(service, row);
        });
    });

  jest
    .spyOn(service, "findOneBy")
    .mockImplementation(async (args: any): Promise<BaseModel | null> => {
      const table: string = tableOf(service);
      reads.push({
        table,
        method: "findOneBy",
        isRoot: Boolean(args.props.isRoot),
        query: args.query,
      });

      if (recordRefusal) {
        throw recordRefusal;
      }

      return isRecordReadable
        ? toModel(service, { _id: String(args.query._id) })
        : null;
    });
}

// The most counts a family had in flight at once, and how many are now.
let countsInFlight: number;
let mostCountsInFlight: number;

function installFakes(): void {
  for (const service of uniqueServices([
    ...SERVICES.map((each: { service: AnyService }): AnyService => {
      return each.service;
    }),
    ...FAMILY_SERVICES,
    ...EXTRA_SERVICES,
  ])) {
    installFakesOf(service);
  }

  jest
    .spyOn(ScheduledMaintenanceStateService, "getAllScheduledMaintenanceStates")
    .mockImplementation(async (): Promise<Array<ScheduledMaintenanceState>> => {
      return [
        { id: SCHEDULED_STATE, flags: { isScheduledState: true }, order: 1 },
        { id: ONGOING_STATE, flags: { isOngoingState: true }, order: 2 },
        { id: ENDED_STATE, flags: { isEndedState: true }, order: 3 },
      ].map(
        (state: {
          id: string;
          flags: Record<string, boolean>;
          order: number;
        }): ScheduledMaintenanceState => {
          const model: ScheduledMaintenanceState =
            new ScheduledMaintenanceState();
          model._id = state.id;
          model.order = state.order;
          model.isScheduledState = Boolean(state.flags["isScheduledState"]);
          model.isOngoingState = Boolean(state.flags["isOngoingState"]);
          model.isEndedState = Boolean(state.flags["isEndedState"]);
          model.isResolvedState = false;
          return model;
        },
      );
    });

  jest
    .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
    .mockResolvedValue([new ObjectID(UNRESOLVED_STATE)] as never);
}

// A condition the service wrote on a column, as the SQL it runs.
function sqlOf(value: unknown): { sql: string; parameters: string } {
  expect(value).toBeInstanceOf(FindOperator);
  const operator: FindOperator<unknown> = value as FindOperator<unknown>;
  const getSql: ((alias: string) => string) | undefined = operator.getSql;
  expect(typeof getSql).toBe("function");

  return {
    sql: (getSql as (alias: string) => string)('"Row"."column"'),
    parameters: JSON.stringify(operator.objectLiteralParameters || {}),
  };
}

function readsOf(
  table: string,
  method?: Read["method"] | undefined,
): Array<Read> {
  return reads.filter((read: Read): boolean => {
    return read.table === table && (!method || read.method === method);
  });
}

function groupOf(
  summary: UsedBySummary,
  relation: UsedByRelation,
): UsedByGroup {
  const found: UsedByGroup | undefined = summary.groups.find(
    (each: UsedByGroup): boolean => {
      return each.relation === relation;
    },
  );

  expect(found).toBeDefined();
  return found as UsedByGroup;
}

async function summaryOf(recordKind: UsedByRecordKind): Promise<UsedBySummary> {
  return await UsedByService.getSummary({
    recordKind: recordKind,
    recordId: RECORD,
    projectId: PROJECT,
    props: READER,
    now: new Date("2026-11-12T10:00:00.000Z"),
  });
}

function contextOf(recordIds: Array<ObjectID> = [RECORD]): UsedByReadContext {
  return {
    projectId: PROJECT,
    recordIds: recordIds,
    props: READER,
    now: new Date("2026-11-12T10:00:00.000Z"),
  };
}

async function planOf(
  relation: UsedByRelation,
  recordIds?: Array<ObjectID> | undefined,
): Promise<UsedByReadPlan> {
  const getPlan:
    | ((context: UsedByReadContext) => Promise<UsedByReadPlan>)
    | undefined = USED_BY_RELATION_DEFINITIONS[relation].getPlan;

  expect(getPlan).toBeDefined();

  return await (
    getPlan as (context: UsedByReadContext) => Promise<UsedByReadPlan>
  )(contextOf(recordIds));
}

async function familyPlansOf(
  relation: UsedByRelation,
  recordIds?: Array<ObjectID> | undefined,
): Promise<Array<UsedByReadPlan>> {
  const getFamilyPlans:
    | ((context: UsedByReadContext) => Promise<Array<UsedByReadPlan>>)
    | undefined = USED_BY_RELATION_DEFINITIONS[relation].getFamilyPlans;

  expect(getFamilyPlans).toBeDefined();

  return await (
    getFamilyPlans as (
      context: UsedByReadContext,
    ) => Promise<Array<UsedByReadPlan>>
  )(contextOf(recordIds));
}

// Every plan of a relation: its one, or its family's.
async function plansOf(
  relation: UsedByRelation,
): Promise<Array<UsedByReadPlan>> {
  return USED_BY_RELATION_DEFINITIONS[relation].getFamilyPlans
    ? await familyPlansOf(relation)
    : [await planOf(relation)];
}

beforeEach(() => {
  jest.restoreAllMocks();
  fakes = new Map();
  reads = [];
  countsInFlight = 0;
  mostCountsInFlight = 0;
  isRecordReadable = true;
  recordRefusal = null;
  installFakes();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("every relation is defined, in one place", () => {
  test("each relation a kind lists has a definition, and each definition is listed", () => {
    const listed: Array<UsedByRelation> = Object.values(UsedByRecordKind)
      .flatMap((kind: UsedByRecordKind) => {
        return USED_BY_RELATIONS[kind];
      })
      .map((description: UsedByRelationDescription): UsedByRelation => {
        return description.relation;
      })
      .sort();

    expect(Object.keys(USED_BY_RELATION_DEFINITIONS).sort()).toEqual(listed);

    for (const relation of listed) {
      expect(USED_BY_RELATION_DEFINITIONS[relation].relation).toBe(relation);
    }
  });

  test("each kind's record is read through its own service", () => {
    expect(USED_BY_RECORD_SERVICES[UsedByRecordKind.Monitor]).toBe(
      MonitorService,
    );
    expect(USED_BY_RECORD_SERVICES[UsedByRecordKind.OnCallSchedule]).toBe(
      OnCallDutyPolicyScheduleService,
    );
    expect(USED_BY_RECORD_SERVICES[UsedByRecordKind.Service]).toBe(
      ServiceService,
    );
    expect(USED_BY_RECORD_SERVICES[UsedByRecordKind.StatusPage]).toBe(
      StatusPageService,
    );
    expect(USED_BY_RECORD_SERVICES[UsedByRecordKind.Team]).toBe(TeamService);
    expect(USED_BY_RECORD_SERVICES[UsedByRecordKind.Label]).toBe(LabelService);
    expect(USED_BY_RECORD_SERVICES[UsedByRecordKind.OnCallPolicy]).toBe(
      OnCallDutyPolicyService,
    );
    expect(USED_BY_RECORD_SERVICES[UsedByRecordKind.MonitorGroup]).toBe(
      MonitorGroupService,
    );
    expect(USED_BY_RECORD_SERVICES[UsedByRecordKind.Slo]).toBe(
      ServiceLevelObjectiveService,
    );
  });

  test("a family is read as a family, and a relation of one kind as one plan", () => {
    for (const kind of Object.values(UsedByRecordKind)) {
      for (const description of USED_BY_RELATIONS[kind]) {
        const definition: (typeof USED_BY_RELATION_DEFINITIONS)[UsedByRelation] =
          USED_BY_RELATION_DEFINITIONS[description.relation];

        expect({
          relation: description.relation,
          isFamily: Boolean(definition.getFamilyPlans),
          hasPlan: Boolean(definition.getPlan),
        }).toEqual({
          relation: description.relation,
          isFamily: Boolean(description.family),
          hasPlan: !description.family,
        });
      }
    }
  });

  test("a family's kinds are read in its order, each saying what its rows are", async () => {
    for (const [relation, rowKinds] of [
      [UsedByRelation.MonitorRules, MONITOR_RULE_ROW_KINDS],
      [UsedByRelation.MonitorTemplates, MONITOR_TEMPLATE_ROW_KINDS],
      [UsedByRelation.TeamOwnedOther, TEAM_OWNED_OTHER_ROW_KINDS],
      [UsedByRelation.OnCallPolicyRules, ON_CALL_POLICY_RULE_ROW_KINDS],
      [UsedByRelation.OnCallPolicyOther, ON_CALL_POLICY_OTHER_ROW_KINDS],
    ] as Array<[UsedByRelation, ReadonlyArray<UsedByRowKind>]>) {
      const plans: Array<UsedByReadPlan> = await familyPlansOf(relation);
      // Each plan's kind, and the kinds a column can make its rows.
      const kindsRead: Array<UsedByRowKind> = [];

      for (const plan of plans) {
        expect(plan.rowKind).toBeDefined();

        for (const rowKind of [
          plan.rowKind as UsedByRowKind,
          ...Object.values(plan.rowKindByColumn?.rowKinds || {}),
        ]) {
          if (!kindsRead.includes(rowKind)) {
            kindsRead.push(rowKind);
          }
        }
      }

      expect({ relation, kinds: kindsRead }).toEqual({
        relation,
        kinds: [...rowKinds],
      });
    }
  });

  test("every relation's rows are read through the service of the kind of row it names", async () => {
    const tableOfRowKind: Record<UsedByRowKind, string> = {
      [UsedByRowKind.Monitor]: "Monitor",
      [UsedByRowKind.MonitorGroup]: "MonitorGroup",
      [UsedByRowKind.StatusPage]: "StatusPage",
      [UsedByRowKind.ServiceLevelObjective]: "ServiceLevelObjective",
      [UsedByRowKind.ScheduledMaintenance]: "ScheduledMaintenance",
      [UsedByRowKind.Workflow]: "Workflow",
      [UsedByRowKind.Dashboard]: "Dashboard",
      [UsedByRowKind.OnCallDutyPolicy]: "OnCallDutyPolicy",
      [UsedByRowKind.OnCallSchedule]: "OnCallDutyPolicySchedule",
      [UsedByRowKind.Service]: "Service",
      [UsedByRowKind.Incident]: "Incident",
      [UsedByRowKind.Alert]: "Alert",
      [UsedByRowKind.IncidentOnCallRule]: "IncidentOnCallRule",
      [UsedByRowKind.AlertOnCallRule]: "AlertOnCallRule",
      [UsedByRowKind.IncidentEpisodeOnCallRule]: "IncidentEpisodeOnCallRule",
      [UsedByRowKind.AlertEpisodeOnCallRule]: "AlertEpisodeOnCallRule",
      [UsedByRowKind.IncidentOwnerRule]: "IncidentOwnerRule",
      [UsedByRowKind.AlertOwnerRule]: "AlertOwnerRule",
      [UsedByRowKind.IncidentLabelRule]: "IncidentLabelRule",
      [UsedByRowKind.AlertLabelRule]: "AlertLabelRule",
      [UsedByRowKind.IncidentGroupingRule]: "IncidentGroupingRule",
      [UsedByRowKind.AlertGroupingRule]: "AlertGroupingRule",
      [UsedByRowKind.IncidentPrivacyRule]: "IncidentPrivacyRule",
      [UsedByRowKind.AlertPrivacyRule]: "AlertPrivacyRule",
      [UsedByRowKind.IncidentSlaRule]: "IncidentSlaRule",
      [UsedByRowKind.AlertIncidentRule]: "AlertIncidentRule",
      [UsedByRowKind.IncidentAiRule]: "AutoRemediationRule",
      [UsedByRowKind.AlertAiRule]: "AutoRemediationRule",
      [UsedByRowKind.IncidentRunbookRule]: "RunbookRule",
      [UsedByRowKind.AlertRunbookRule]: "RunbookRule",
      [UsedByRowKind.MaintenanceRunbookRule]: "RunbookRule",
      [UsedByRowKind.PostmortemRule]: "AIPostmortemRule",
      [UsedByRowKind.MaintenanceLabelRule]: "ScheduledMaintenanceLabelRule",
      [UsedByRowKind.MaintenanceOwnerRule]: "ScheduledMaintenanceOwnerRule",
      [UsedByRowKind.SloBurnRateRule]: "ServiceLevelObjectiveBurnRateRule",
      [UsedByRowKind.SloErrorBudgetPolicyTier]:
        "ServiceLevelObjectiveErrorBudgetPolicyTier",
      [UsedByRowKind.CloudBudget]: "CloudBudget",
      [UsedByRowKind.IncidentTemplate]: "IncidentTemplate",
      [UsedByRowKind.MaintenanceTemplate]: "ScheduledMaintenanceTemplate",
      [UsedByRowKind.AnnouncementTemplate]: "StatusPageAnnouncementTemplate",
      [UsedByRowKind.IncidentEpisode]: "IncidentEpisode",
      [UsedByRowKind.AlertEpisode]: "AlertEpisode",
      [UsedByRowKind.Runbook]: "Runbook",
      [UsedByRowKind.IncomingCallPolicy]: "IncomingCallPolicy",
      [UsedByRowKind.Team]: "Team",
      [UsedByRowKind.Host]: "Host",
      [UsedByRowKind.KubernetesCluster]: "KubernetesCluster",
      [UsedByRowKind.DockerHost]: "DockerHost",
      [UsedByRowKind.DockerSwarmCluster]: "DockerSwarmCluster",
      [UsedByRowKind.PodmanHost]: "PodmanHost",
      [UsedByRowKind.ProxmoxCluster]: "ProxmoxCluster",
      [UsedByRowKind.OpenStackCloud]: "OpenStackCloud",
      [UsedByRowKind.VMwareVCenter]: "VMwareVCenter",
      [UsedByRowKind.CephCluster]: "CephCluster",
      [UsedByRowKind.StorageArray]: "StorageArray",
      [UsedByRowKind.NetworkDevice]: "NetworkDevice",
      [UsedByRowKind.IoTFleet]: "IoTFleet",
      [UsedByRowKind.CloudResource]: "CloudResource",
      [UsedByRowKind.ServerlessFunction]: "ServerlessFunction",
      [UsedByRowKind.DatabaseServer]: "DatabaseServer",
      [UsedByRowKind.MessageQueue]: "MessageQueue",
      [UsedByRowKind.RumApplication]: "RumApplication",
      [UsedByRowKind.DataStore]: "DataStore",
      [UsedByRowKind.DataAsset]: "DataAsset",
      [UsedByRowKind.DataPipeline]: "DataPipeline",
      [UsedByRowKind.Probe]: "Probe",
      [UsedByRowKind.Runner]: "Runner",
      [UsedByRowKind.AIAgent]: "AIAgent",
    };

    jest.spyOn(StatusPageService, "findOneById").mockResolvedValue(null);

    for (const kind of Object.values(UsedByRecordKind)) {
      for (const description of USED_BY_RELATIONS[kind]) {
        for (const plan of await plansOf(description.relation)) {
          const rowKind: UsedByRowKind = plan.rowKind || description.rowKind;

          expect({
            relation: description.relation,
            rowKind: rowKind,
            table: plan.service.getModel().tableName,
          }).toEqual({
            relation: description.relation,
            rowKind: rowKind,
            table: tableOfRowKind[rowKind],
          });

          // A kind a column picks is a kind of the same table.
          for (const picked of Object.values(
            plan.rowKindByColumn?.rowKinds || {},
          )) {
            expect(tableOfRowKind[picked]).toBe(
              plan.service.getModel().tableName,
            );
          }
        }
      }
    }
  });
});

describe("how a list or a join model is read", () => {
  test("a list's join table comes from the model's own decorators", () => {
    expect(getListJoinTable(ServiceLevelObjective, "monitors")).toEqual({
      joinTableName: "ServiceLevelObjectiveMonitor",
      ownerColumnName: "serviceLevelObjectiveId",
      relationColumnName: "monitorId",
    });
    expect(getListJoinTable(Monitor, "services")).toEqual({
      joinTableName: "MonitorService",
      ownerColumnName: "monitorId",
      relationColumnName: "serviceId",
    });
    expect(getListJoinTable(Monitor, "dependsOnMonitors")).toEqual({
      joinTableName: "MonitorDependency",
      ownerColumnName: "monitorId",
      relationColumnName: "dependsOnMonitorId",
    });
    expect(getListJoinTable(Monitor, "labels")).toEqual({
      joinTableName: "MonitorLabel",
      ownerColumnName: "monitorId",
      relationColumnName: "labelId",
    });
  });

  test("every model a label relation reads keeps its labels in a join table", () => {
    for (const model of [
      Monitor,
      MonitorGroup,
      StatusPage,
      Service,
      Incident,
      Alert,
      ScheduledMaintenance,
      OnCallDutyPolicy,
      OnCallDutyPolicySchedule,
      ServiceLevelObjective,
      Workflow,
      Dashboard,
    ]) {
      expect(getListJoinTable(model, "labels").relationColumnName).toBe(
        "labelId",
      );
    }

    expect(
      getListJoinTable(ScheduledMaintenance, "statusPages").relationColumnName,
    ).toBe("statusPageId");
    expect(
      getListJoinTable(ScheduledMaintenance, "monitors").relationColumnName,
    ).toBe("monitorId");
  });

  test("a property that is no list is refused, not read as nothing", () => {
    expect(() => {
      return getListJoinTable(Monitor, "name");
    }).toThrow(ServerException);
  });

  test("a join model's rows name the records they point at", () => {
    const { sql, parameters } = sqlOf(
      namedByRowsReferencing({
        joinModel: StatusPageResource,
        ownerColumn: "statusPageId",
        referenceColumn: "monitorId",
        values: [RECORD],
      }),
    );

    expect(sql).toContain(
      'SELECT "StatusPageResource"."statusPageId" FROM "StatusPageResource" WHERE "StatusPageResource"."monitorId" IN',
    );
    expect(parameters).toContain(RECORD.toString());
  });

  test("a join model column that does not exist is refused", () => {
    expect(() => {
      return namedByRowsReferencing({
        joinModel: StatusPageResource,
        ownerColumn: "statusPageId",
        referenceColumn: "nothingHere",
        values: [RECORD],
      });
    }).toThrow(ServerException);
  });

  test("no values match nothing", () => {
    expect(
      sqlOf(
        namedByRowsReferencing({
          joinModel: StatusPageResource,
          ownerColumn: "statusPageId",
          referenceColumn: "monitorGroupId",
          values: [],
        }),
      ).sql,
    ).toBe("TRUE = FALSE");
  });

  test("archived records are left out of a model that can be archived, and only there", () => {
    expect(
      withoutArchived(MonitorService as unknown as AnyService, { a: 1 }),
    ).toEqual({ a: 1, isArchived: false });
    expect(
      withoutArchived(MonitorGroupService as unknown as AnyService, { a: 1 }),
    ).toEqual({ a: 1 });
  });

  test("a refusal to read is told from a failure", () => {
    expect(isReadRefusal(new NotAuthorizedException("No."))).toBe(true);
    expect(isReadRefusal(new ForbiddenException("No."))).toBe(true);
    expect(isReadRefusal(new PaymentRequiredException("No."))).toBe(true);
    expect(isReadRefusal(new BadDataException("No."))).toBe(false);
    expect(isReadRefusal(new Error("No."))).toBe(false);
  });
});

describe("a monitor's relations", () => {
  test("status pages that list it, or one of its monitor groups", async () => {
    fake("MonitorGroupResource", {
      rows: [{ monitorGroupId: new ObjectID(GROUP_A) }],
    });

    const plan: UsedByReadPlan = await planOf(
      UsedByRelation.MonitorStatusPages,
    );
    const query: Record<string, unknown> = plan.query as Record<
      string,
      unknown
    >;
    const { sql, parameters } = sqlOf(query["_id"]);

    expect(sql).toContain('"StatusPageResource"."monitorId" IN');
    expect(sql).toContain('"StatusPageResource"."monitorGroupId" IN');
    expect(sql).toContain(" OR ");
    expect(parameters).toContain(RECORD.toString());
    expect(parameters).toContain(GROUP_A);
    // An archived status page shows nothing.
    expect(query["isArchived"]).toBe(false);

    // The groups were read as OneUptime, for the project, by the monitor.
    const groupRead: Read | undefined = readsOf(
      "MonitorGroupResource",
      "findBy",
    )[0];
    expect(groupRead?.isRoot).toBe(true);
    expect(sqlOf(groupRead?.query["monitorId"]).parameters).toContain(
      RECORD.toString(),
    );
    expect(groupRead?.query["projectId"]).toBe(PROJECT);
  });

  test("a monitor in no group: only the pages that list it directly", async () => {
    const plan: UsedByReadPlan = await planOf(
      UsedByRelation.MonitorStatusPages,
    );
    const { sql } = sqlOf((plan.query as Record<string, unknown>)["_id"]);

    expect(sql).toContain('"StatusPageResource"."monitorId" IN');
    expect(sql).toContain("TRUE = FALSE");
  });

  test("monitor groups it is in", async () => {
    const plan: UsedByReadPlan = await planOf(UsedByRelation.MonitorGroups);
    const { sql, parameters } = sqlOf(
      (plan.query as Record<string, unknown>)["_id"],
    );

    expect(sql).toContain(
      'SELECT "MonitorGroupResource"."monitorGroupId" FROM "MonitorGroupResource" WHERE "MonitorGroupResource"."monitorId" IN',
    );
    expect(parameters).toContain(RECORD.toString());
  });

  test("SLOs that measure it, archived ones left out", async () => {
    const plan: UsedByReadPlan = await planOf(UsedByRelation.MonitorSlos);
    const query: Record<string, unknown> = plan.query as Record<
      string,
      unknown
    >;

    expect(sqlOf(query["_id"]).sql).toContain(
      'SELECT "ServiceLevelObjectiveMonitor"."serviceLevelObjectiveId" FROM "ServiceLevelObjectiveMonitor" WHERE "ServiceLevelObjectiveMonitor"."monitorId" IN',
    );
    expect(query["isArchived"]).toBe(false);
  });

  test("maintenance coming up or in progress that names it, soonest first", async () => {
    const plan: UsedByReadPlan = await planOf(
      UsedByRelation.MonitorScheduledMaintenance,
    );
    const query: Record<string, unknown> = plan.query as Record<
      string,
      unknown
    >;

    expect(sqlOf(query["_id"]).sql).toContain('"ScheduledMaintenanceMonitor"');

    const states: string = sqlOf(
      query["currentScheduledMaintenanceStateId"],
    ).parameters;
    expect(states).toContain(SCHEDULED_STATE);
    expect(states).toContain(ONGOING_STATE);
    expect(states).not.toContain(ENDED_STATE);
    expect(plan.nameColumn).toBe("title");
    expect(plan.numberColumn).toBe("scheduledMaintenanceNumberWithPrefix");
    expect(plan.sort).toEqual({ startsAt: "ASC" });
  });

  test("monitors that depend on it", async () => {
    const plan: UsedByReadPlan = await planOf(UsedByRelation.MonitorDependents);
    const query: Record<string, unknown> = plan.query as Record<
      string,
      unknown
    >;

    expect(sqlOf(query["_id"]).sql).toContain(
      'SELECT "MonitorDependency"."monitorId" FROM "MonitorDependency" WHERE "MonitorDependency"."dependsOnMonitorId" IN',
    );
    expect(query["isArchived"]).toBe(false);
  });

  test("workflows and dashboards whose saved text holds its id", async () => {
    const workflows: UsedByReadPlan = await planOf(
      UsedByRelation.MonitorWorkflows,
    );
    const dashboards: UsedByReadPlan = await planOf(
      UsedByRelation.MonitorDashboards,
    );

    const graph: { sql: string; parameters: string } = sqlOf(
      (workflows.query as Record<string, unknown>)["graph"],
    );
    expect(graph.sql).toContain("ILIKE ANY");
    expect(graph.parameters).toContain(`%${RECORD.toString()}%`);

    const layout: { sql: string; parameters: string } = sqlOf(
      (dashboards.query as Record<string, unknown>)["dashboardViewConfig"],
    );
    expect(layout.parameters).toContain(`%${RECORD.toString()}%`);
  });
});

describe("a schedule's, a service's and a team's relations", () => {
  test("the on-call policies with an escalation rule that pages the schedule", async () => {
    const plan: UsedByReadPlan = await planOf(
      UsedByRelation.ScheduleOnCallPolicies,
    );

    expect(sqlOf((plan.query as Record<string, unknown>)["_id"]).sql).toContain(
      'SELECT "OnCallDutyPolicyEscalationRuleSchedule"."onCallDutyPolicyId" FROM "OnCallDutyPolicyEscalationRuleSchedule" WHERE "OnCallDutyPolicyEscalationRuleSchedule"."onCallDutyPolicyScheduleId" IN',
    );
    expect(plan.getDetails).toBeDefined();
  });

  test("the on-call policies with an escalation rule that pages the team", async () => {
    const plan: UsedByReadPlan = await planOf(
      UsedByRelation.TeamOnCallPolicies,
    );

    expect(sqlOf((plan.query as Record<string, unknown>)["_id"]).sql).toContain(
      'FROM "OnCallDutyPolicyEscalationRuleTeam" WHERE "OnCallDutyPolicyEscalationRuleTeam"."teamId" IN',
    );
  });

  test("what the team owns, each through its owner table", async () => {
    const owned: Array<[UsedByRelation, string, string]> = [
      [UsedByRelation.TeamOwnedMonitors, "MonitorOwnerTeam", "monitorId"],
      [
        UsedByRelation.TeamOwnedStatusPages,
        "StatusPageOwnerTeam",
        "statusPageId",
      ],
      [UsedByRelation.TeamOwnedServices, "ServiceOwnerTeam", "serviceId"],
      [
        UsedByRelation.TeamOwnedOnCallPolicies,
        "OnCallDutyPolicyOwnerTeam",
        "onCallDutyPolicyId",
      ],
      [
        UsedByRelation.TeamOwnedSchedules,
        "OnCallDutyPolicyScheduleOwnerTeam",
        "onCallDutyPolicyScheduleId",
      ],
    ];

    for (const [relation, table, column] of owned) {
      const plan: UsedByReadPlan = await planOf(relation);

      expect(
        sqlOf((plan.query as Record<string, unknown>)["_id"]).sql,
      ).toContain(
        `SELECT "${table}"."${column}" FROM "${table}" WHERE "${table}"."teamId" IN`,
      );
    }
  });

  /*
   * A family's rows are read by the column that names them, and a column
   * the model does not have refuses the whole read: a data pipeline read by
   * a "name" it does not have refused a team's card of what it owns.
   */
  test("every kind of a family names and numbers its rows by columns its model has", () => {
    const context: UsedByReadContext = {
      projectId: new ObjectID("68130000-0000-4000-8000-000000000001"),
      recordIds: [new ObjectID("68130000-0000-4000-8000-000000000002")],
      props: { isRoot: true },
      now: new Date("2026-11-12T10:00:00.000Z"),
    };
    const missing: Array<string> = [];

    for (const build of [
      ...MONITOR_RULE_PLANS,
      ...MONITOR_TEMPLATE_PLANS,
      ...TEAM_OWNED_OTHER_PLANS,
      ...ON_CALL_POLICY_RULE_PLANS,
      ...ON_CALL_POLICY_OTHER_PLANS,
    ]) {
      const plan: UsedByReadPlan = build(context);
      const model: BaseModel = plan.service.getModel();

      for (const column of [plan.nameColumn, plan.numberColumn]) {
        if (column && !model.hasColumn(column)) {
          missing.push(`${model.tableName}.${column}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test("the monitors watching a service", async () => {
    const plan: UsedByReadPlan = await planOf(UsedByRelation.ServiceMonitors);

    expect(sqlOf((plan.query as Record<string, unknown>)["_id"]).sql).toContain(
      'SELECT "MonitorService"."monitorId" FROM "MonitorService" WHERE "MonitorService"."serviceId" IN',
    );
  });

  test("a service's SLOs are those that measure a monitor watching it", async () => {
    fake("Monitor", {
      rows: [{ _id: WATCHER_1 }, { _id: WATCHER_2 }],
    });

    const plan: UsedByReadPlan = await planOf(UsedByRelation.ServiceSlos);
    const { sql, parameters } = sqlOf(
      (plan.query as Record<string, unknown>)["_id"],
    );

    expect(sql).toContain('"ServiceLevelObjectiveMonitor"."monitorId" IN');
    expect(parameters).toContain(WATCHER_1);
    expect(parameters).toContain(WATCHER_2);

    // The watchers were read as OneUptime: only their ids, never shown.
    const watcherRead: Read | undefined = readsOf("Monitor", "findBy")[0];
    expect(watcherRead?.isRoot).toBe(true);
    expect(watcherRead?.select).toEqual({ _id: true });
    expect(watcherRead?.query["isArchived"]).toBe(false);
  });

  test("a service no monitor watches has no SLOs, and none is counted", async () => {
    const plan: UsedByReadPlan = await planOf(UsedByRelation.ServiceSlos);

    expect(plan.query).toBeNull();
  });

  test("a label's records, kind by kind", async () => {
    const plan: UsedByReadPlan = await planOf(UsedByRelation.LabelIncidents);

    expect(sqlOf((plan.query as Record<string, unknown>)["_id"]).sql).toContain(
      'SELECT "IncidentLabel"."incidentId" FROM "IncidentLabel" WHERE "IncidentLabel"."labelId" IN',
    );
    expect(plan.nameColumn).toBe("title");
    expect(plan.numberColumn).toBe("incidentNumberWithPrefix");
    expect(plan.sort).toEqual({ createdAt: "DESC" });
  });
});

describe("a status page's relations", () => {
  test("open incidents are the ones IncidentStatusPageScope says the page shows", async () => {
    jest.spyOn(StatusPageService, "findOneById").mockResolvedValue(
      Object.assign(new StatusPage(), {
        _id: RECORD.toString(),
        projectId: PROJECT,
        onlyShowScopedIncidents: false,
        showIncidentsOnStatusPage: true,
      }) as never,
    );
    jest
      .spyOn(StatusPageService, "getMonitorIdsOnStatusPage")
      .mockResolvedValue({
        monitorsOnStatusPage: [new ObjectID(WATCHER_1)],
        monitorsInGroup: {},
      } as never);
    const count: jest.SpyInstance = jest
      .spyOn(IncidentStatusPageScope, "countIncidentsForStatusPage")
      .mockImplementation(async (data: any): Promise<number> => {
        return data.props.isRoot ? 4 : 3;
      });
    const find: jest.SpyInstance = jest
      .spyOn(IncidentStatusPageScope, "findIncidentsForStatusPage")
      .mockImplementation(async (): Promise<Array<Incident>> => {
        return [
          Object.assign(new Incident(), {
            _id: "68130000-0000-4000-8000-0000000000f1",
            title: "Checkout is down",
            incidentNumberWithPrefix: "INC-18",
          }),
        ];
      });

    const summary: UsedBySummary = await summaryOf(UsedByRecordKind.StatusPage);
    const incidents: UsedByGroup = groupOf(
      summary,
      UsedByRelation.StatusPageOpenIncidents,
    );

    expect(incidents.count).toBe(3);
    expect(incidents.hiddenCount).toBe(1);
    expect(incidents.rows).toEqual([
      {
        id: "68130000-0000-4000-8000-0000000000f1",
        name: "Checkout is down",
        number: "INC-18",
      },
    ]);

    // Counted as OneUptime and as the reader; listed as the reader.
    expect(
      count.mock.calls.map((call: Array<any>): boolean => {
        return Boolean(call[0].props.isRoot);
      }),
    ).toEqual([true, false]);
    const query: Record<string, unknown> = count.mock.calls[0]?.[0].query;
    expect(query["monitors"]).toEqual([new ObjectID(WATCHER_1)]);
    expect(sqlOf(query["currentIncidentStateId"]).parameters).toContain(
      UNRESOLVED_STATE,
    );
    expect(find.mock.calls[0]?.[0].props).toBe(READER);
    expect(find.mock.calls[0]?.[0].limit).toBe(USED_BY_PREVIEW_ROW_COUNT);
    expect(find.mock.calls[0]?.[0].query["projectId"]).toBe(PROJECT);
    // Never a plain read of incidents that would skip the page's scope.
    expect(readsOf("Incident")).toEqual([]);
  });

  test("a page that shows no incidents shows no open incidents", async () => {
    jest.spyOn(StatusPageService, "findOneById").mockResolvedValue(
      Object.assign(new StatusPage(), {
        _id: RECORD.toString(),
        showIncidentsOnStatusPage: false,
        showScheduledMaintenanceEventsOnStatusPage: false,
      }) as never,
    );
    const monitorsOnPage: jest.SpyInstance = jest.spyOn(
      StatusPageService,
      "getMonitorIdsOnStatusPage",
    );
    const count: jest.SpyInstance = jest.spyOn(
      IncidentStatusPageScope,
      "countIncidentsForStatusPage",
    );

    const summary: UsedBySummary = await summaryOf(UsedByRecordKind.StatusPage);

    expect(groupOf(summary, UsedByRelation.StatusPageOpenIncidents).count).toBe(
      0,
    );
    expect(groupOf(summary, UsedByRelation.StatusPageMaintenance).count).toBe(
      0,
    );
    expect(monitorsOnPage).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
    expect(readsOf("ScheduledMaintenance")).toEqual([]);
  });

  test("a page with no monitors has no open incidents to count", async () => {
    jest.spyOn(StatusPageService, "findOneById").mockResolvedValue(
      Object.assign(new StatusPage(), {
        _id: RECORD.toString(),
        showIncidentsOnStatusPage: true,
      }) as never,
    );
    jest
      .spyOn(StatusPageService, "getMonitorIdsOnStatusPage")
      .mockResolvedValue({
        monitorsOnStatusPage: [],
        monitorsInGroup: {},
      } as never);
    const count: jest.SpyInstance = jest.spyOn(
      IncidentStatusPageScope,
      "countIncidentsForStatusPage",
    );

    const plan: UsedByReadPlan = await planOf(
      UsedByRelation.StatusPageOpenIncidents,
    );

    expect(plan.query).toBeNull();
    expect(count).not.toHaveBeenCalled();
  });

  test("maintenance the page shows: named on it, visible, published, coming up or in progress", async () => {
    // The page shows scheduled maintenance: read as OneUptime, by that switch.
    fake("StatusPage", { rows: [{ _id: RECORD.toString() }] });

    const plan: UsedByReadPlan = await planOf(
      UsedByRelation.StatusPageMaintenance,
    );
    const pageRead: Read | undefined = readsOf("StatusPage", "findBy")[0];

    expect(pageRead?.isRoot).toBe(true);
    expect(pageRead?.query["showScheduledMaintenanceEventsOnStatusPage"]).toBe(
      true,
    );
    expect(pageRead?.query["projectId"]).toBe(PROJECT);
    const query: Record<string, unknown> = plan.query as Record<
      string,
      unknown
    >;

    expect(sqlOf(query["_id"]).sql).toContain(
      'SELECT "ScheduledMaintenanceStatusPage"',
    );
    expect(query["isVisibleOnStatusPage"]).toBe(true);
    expect(sqlOf(query["publishOnStatusPageAt"]).parameters).toContain(
      "2026-11-12",
    );
    expect(
      sqlOf(query["currentScheduledMaintenanceStateId"]).parameters,
    ).not.toContain(ENDED_STATE);
  });
});

describe("what the reader may see", () => {
  test("counted as OneUptime for the project, then as the reader; the difference is hidden, never named", async () => {
    fake("StatusPage", {
      total: 5,
      reader: 3,
      rows: [
        { _id: "68130000-0000-4000-8000-000000000101", name: "Public" },
        { _id: "68130000-0000-4000-8000-000000000102", name: "Partners" },
        { _id: "68130000-0000-4000-8000-000000000103", name: "Internal" },
      ],
    });

    const summary: UsedBySummary = await summaryOf(UsedByRecordKind.Monitor);
    const pages: UsedByGroup = groupOf(
      summary,
      UsedByRelation.MonitorStatusPages,
    );

    expect(pages.count).toBe(3);
    expect(pages.hiddenCount).toBe(2);
    expect(
      pages.rows.map((row: { name: string }): string => {
        return row.name;
      }),
    ).toEqual(["Public", "Partners", "Internal"]);

    const counts: Array<Read> = readsOf("StatusPage", "countBy");
    expect(
      counts.map((read: Read): boolean => {
        return read.isRoot;
      }),
    ).toEqual([true, false]);

    // Both counts and the rows are narrowed to the project.
    for (const read of readsOf("StatusPage")) {
      if (read.method === "findOneBy") {
        continue;
      }

      expect(read.query["projectId"]).toBe(PROJECT);
    }

    // The rows are read as the reader, by name, a few of them.
    const rowRead: Read | undefined = readsOf("StatusPage", "findBy")[0];
    expect(rowRead?.isRoot).toBe(false);
    expect(rowRead?.limit).toBe(USED_BY_PREVIEW_ROW_COUNT);
    expect(rowRead?.sort).toEqual({ name: "ASC" });
    expect(rowRead?.select).toEqual({ _id: true, name: true });
  });

  test("a reader refused the model altogether sees none, and is told how many", async () => {
    fake("ServiceLevelObjective", { total: 2, reader: "refuse" });

    const summary: UsedBySummary = await summaryOf(UsedByRecordKind.Monitor);
    const slos: UsedByGroup = groupOf(summary, UsedByRelation.MonitorSlos);

    expect(slos).toEqual({
      relation: UsedByRelation.MonitorSlos,
      rowKind: UsedByRowKind.ServiceLevelObjective,
      count: 0,
      hiddenCount: 2,
      rows: [],
    });
    // No rows are asked for when the reader may see none.
    expect(readsOf("ServiceLevelObjective", "findBy")).toEqual([]);
  });

  test("nothing in the project refers: the reader's count and the rows are never read", async () => {
    const summary: UsedBySummary = await summaryOf(UsedByRecordKind.Monitor);

    for (const each of summary.groups) {
      expect(each.count + each.hiddenCount).toBe(0);
    }

    expect(
      reads.filter((read: Read): boolean => {
        return read.method === "countBy" && !read.isRoot;
      }),
    ).toEqual([]);
    expect(
      reads.filter((read: Read): boolean => {
        return read.method === "findBy" && !read.isRoot;
      }),
    ).toEqual([]);
  });

  test("a reader count above the total (a race) never makes a negative hidden count", async () => {
    fake("Workflow", { total: 1, reader: 3, rows: [] });

    const summary: UsedBySummary = await summaryOf(UsedByRecordKind.Monitor);

    expect(groupOf(summary, UsedByRelation.MonitorWorkflows)).toMatchObject({
      count: 1,
      hiddenCount: 0,
    });
  });

  test("a failure that is not a refusal is not hidden as one", async () => {
    jest
      .spyOn(DashboardService, "countBy")
      .mockRejectedValue(new BadDataException("The database said no."));

    await expect(summaryOf(UsedByRecordKind.Monitor)).rejects.toThrow(
      "The database said no.",
    );
  });

  test("a record the reader may not read is not found, and nothing about it is read", async () => {
    isRecordReadable = false;

    await expect(summaryOf(UsedByRecordKind.Monitor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(
      reads.filter((read: Read): boolean => {
        return read.method !== "findOneBy";
      }),
    ).toEqual([]);

    const recordRead: Read | undefined = readsOf("Monitor", "findOneBy")[0];
    expect(recordRead?.isRoot).toBe(false);
    expect(recordRead?.query["projectId"]).toBe(PROJECT);
    expect(recordRead?.query["_id"]).toBe(RECORD.toString());
  });

  test("a refusal to read the record is not found too", async () => {
    recordRefusal = new NotAuthorizedException("You may not read monitors.");

    await expect(summaryOf(UsedByRecordKind.Monitor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  test("the record is read through its kind's service: a team's through teams", async () => {
    await summaryOf(UsedByRecordKind.Team);

    expect(readsOf("Team", "findOneBy")).toHaveLength(1);
    expect(readsOf("Monitor", "findOneBy")).toHaveLength(0);
  });
});

describe("rows and their details", () => {
  test("a policy that pages a schedule says which escalation rules do, in order", async () => {
    fake("OnCallDutyPolicy", {
      total: 1,
      reader: 1,
      rows: [{ _id: "68130000-0000-4000-8000-000000000201", name: "Primary" }],
    });
    // The rules of the policy that name the schedule: one of them twice.
    const RULES: Array<{ id: string; name: string; order: number }> = [
      {
        id: "68130000-0000-4000-8000-000000000212",
        name: "Second line",
        order: 2,
      },
      {
        id: "68130000-0000-4000-8000-000000000211",
        name: "First line",
        order: 1,
      },
      {
        id: "68130000-0000-4000-8000-000000000211",
        name: "First line",
        order: 1,
      },
      { id: "68130000-0000-4000-8000-000000000213", name: "", order: 3 },
    ];
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
      .mockImplementation(async (args: any): Promise<Array<BaseModel>> => {
        reads.push({
          table: "OnCallDutyPolicyEscalationRuleSchedule",
          method: "findBy",
          isRoot: Boolean(args.props.isRoot),
          query: args.query,
          select: args.select,
        });

        return RULES.map(
          (rule: { id: string; name: string; order: number }): BaseModel => {
            return Object.assign(new BaseModel(), {
              onCallDutyPolicyId: new ObjectID(
                "68130000-0000-4000-8000-000000000201",
              ),
              onCallDutyPolicyEscalationRuleId: new ObjectID(rule.id),
            });
          },
        );
      });
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findBy")
      .mockImplementation(async (args: any): Promise<Array<any>> => {
        reads.push({
          table: "OnCallDutyPolicyEscalationRule",
          method: "findBy",
          isRoot: Boolean(args.props.isRoot),
          query: args.query,
          select: args.select,
          limit: args.limit,
        });

        return RULES.slice(0, 2)
          .concat([RULES[3]!])
          .map((rule: { id: string; name: string; order: number }) => {
            return Object.assign(new BaseModel(), {
              _id: rule.id,
              name: rule.name,
              order: rule.order,
            });
          });
      });

    const summary: UsedBySummary = await summaryOf(
      UsedByRecordKind.OnCallSchedule,
    );

    expect(
      groupOf(summary, UsedByRelation.ScheduleOnCallPolicies).rows,
    ).toEqual([
      {
        id: "68130000-0000-4000-8000-000000000201",
        name: "Primary",
        detail: "First line, Second line",
      },
    ]);

    // Which rules name the schedule: ids only, nothing through the relation.
    const linkRead: Read | undefined = readsOf(
      "OnCallDutyPolicyEscalationRuleSchedule",
    )[0];
    expect(linkRead?.isRoot).toBe(false);
    expect(
      sqlOf(linkRead?.query["onCallDutyPolicyScheduleId"]).parameters,
    ).toContain(RECORD.toString());
    expect(linkRead?.query["projectId"]).toBe(PROJECT);
    expect(linkRead?.select).toEqual({
      onCallDutyPolicyId: true,
      onCallDutyPolicyEscalationRuleId: true,
    });

    // The rules themselves, each once, read by id as the reader.
    const ruleRead: Read | undefined = readsOf(
      "OnCallDutyPolicyEscalationRule",
    )[0];
    expect(readsOf("OnCallDutyPolicyEscalationRule")).toHaveLength(1);
    expect(ruleRead?.isRoot).toBe(false);
    expect(ruleRead?.query["projectId"]).toBe(PROJECT);
    for (const ruleId of [
      "68130000-0000-4000-8000-000000000211",
      "68130000-0000-4000-8000-000000000212",
      "68130000-0000-4000-8000-000000000213",
    ]) {
      expect(sqlOf(ruleRead?.query["_id"]).parameters).toContain(ruleId);
    }
    expect(ruleRead?.limit).toBe(3);
    expect(ruleRead?.select).toEqual({ _id: true, name: true, order: true });
  });

  test("rules the reader may not read are left out of the detail, the rows kept", async () => {
    fake("OnCallDutyPolicy", {
      total: 1,
      reader: 1,
      rows: [{ _id: "68130000-0000-4000-8000-000000000201", name: "Primary" }],
    });
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
      .mockResolvedValue([
        Object.assign(new BaseModel(), {
          onCallDutyPolicyId: new ObjectID(
            "68130000-0000-4000-8000-000000000201",
          ),
          onCallDutyPolicyEscalationRuleId: new ObjectID(
            "68130000-0000-4000-8000-000000000211",
          ),
        }),
      ]);
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findBy")
      .mockRejectedValue(new NotAuthorizedException("No escalation rules."));

    const summary: UsedBySummary = await summaryOf(
      UsedByRecordKind.OnCallSchedule,
    );

    expect(
      groupOf(summary, UsedByRelation.ScheduleOnCallPolicies).rows,
    ).toEqual([
      { id: "68130000-0000-4000-8000-000000000201", name: "Primary" },
    ]);
  });

  test("details the reader may not read are left out, the rows kept", async () => {
    fake("OnCallDutyPolicy", {
      total: 1,
      reader: 1,
      rows: [{ _id: "68130000-0000-4000-8000-000000000201", name: "Primary" }],
    });
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "findBy")
      .mockRejectedValue(new NotAuthorizedException("No escalation rules."));

    const summary: UsedBySummary = await summaryOf(UsedByRecordKind.Team);

    expect(groupOf(summary, UsedByRelation.TeamOnCallPolicies).rows).toEqual([
      { id: "68130000-0000-4000-8000-000000000201", name: "Primary" },
    ]);
  });

  test("a numbered record keeps its number, and a row is listed once", async () => {
    fake("Incident", {
      total: 2,
      reader: 2,
      rows: [
        {
          _id: "68130000-0000-4000-8000-000000000301",
          title: "API down",
          incidentNumberWithPrefix: "INC-7",
        },
        {
          _id: "68130000-0000-4000-8000-000000000301",
          title: "API down",
          incidentNumberWithPrefix: "INC-7",
        },
      ],
    });

    const summary: UsedBySummary = await summaryOf(UsedByRecordKind.Label);

    expect(groupOf(summary, UsedByRelation.LabelIncidents).rows).toEqual([
      {
        id: "68130000-0000-4000-8000-000000000301",
        name: "API down",
        number: "INC-7",
      },
    ]);
    expect(readsOf("Incident", "findBy")[0]?.select).toEqual({
      _id: true,
      title: true,
      incidentNumberWithPrefix: true,
    });
  });
});

describe("a record used by thousands still loads in a few bounded reads", () => {
  function manyRows(count: number): Array<Record<string, unknown>> {
    return Array.from(
      { length: count },
      (_value: unknown, index: number): Record<string, unknown> => {
        return {
          _id: `68130000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          name: `Monitor ${index}`,
        };
      },
    );
  }

  test("a label on 5,000 monitors: counts first, three rows, never the 5,000", async () => {
    fake("Monitor", { total: 5000, reader: 4800, rows: manyRows(5000) });

    const summary: UsedBySummary = await summaryOf(UsedByRecordKind.Label);
    const monitors: UsedByGroup = groupOf(
      summary,
      UsedByRelation.LabelMonitors,
    );

    expect(monitors.count).toBe(4800);
    expect(monitors.hiddenCount).toBe(200);
    expect(monitors.rows).toHaveLength(USED_BY_PREVIEW_ROW_COUNT);

    // One count as OneUptime, one as the reader, one page of three rows.
    expect(readsOf("Monitor", "countBy")).toHaveLength(2);
    const rowReads: Array<Read> = readsOf("Monitor", "findBy");
    expect(rowReads).toHaveLength(1);
    expect(rowReads[0]?.limit).toBe(USED_BY_PREVIEW_ROW_COUNT);

    // Every relation of the kind: at most three reads each.
    const listed: number = USED_BY_RELATIONS[UsedByRecordKind.Label].length;
    expect(
      reads.filter((read: Read): boolean => {
        return read.method !== "findOneBy";
      }).length,
    ).toBeLessThanOrEqual(listed * 3);
  });

  test("a monitor shown on 3,000 status pages reads a bounded number of times, whatever the count", async () => {
    fake("StatusPage", { total: 3000, reader: 3000, rows: manyRows(3000) });

    await summaryOf(UsedByRecordKind.Monitor);
    const readsWithThousands: number = reads.length;

    reads = [];
    fake("StatusPage", { total: 3, reader: 3, rows: manyRows(3) });
    await summaryOf(UsedByRecordKind.Monitor);

    expect(readsWithThousands).toBe(reads.length);
  });

  test("See all reads one page at a time, never more than the largest page", async () => {
    fake("Monitor", { total: 5000, reader: 5000, rows: manyRows(5000) });

    const page: UsedByPage = await UsedByService.getPage({
      recordKind: UsedByRecordKind.Service,
      recordId: RECORD,
      relation: UsedByRelation.ServiceMonitors,
      projectId: PROJECT,
      props: READER,
      skip: "100",
      limit: "100000",
    });

    expect(page.count).toBe(5000);
    expect(page.pageStart).toBe(100);
    expect(page.pageSize).toBe(USED_BY_MAX_PAGE_SIZE);
    expect(page.rows).toHaveLength(USED_BY_MAX_PAGE_SIZE);
    expect(page.rows[0]?.name).toBe("Monitor 100");
    expect(page.rowKind).toBe(UsedByRowKind.Monitor);

    const rowRead: Read | undefined = readsOf("Monitor", "findBy").find(
      (read: Read): boolean => {
        return !read.isRoot;
      },
    );
    expect(rowRead?.skip).toBe(100);
    expect(rowRead?.limit).toBe(USED_BY_MAX_PAGE_SIZE);
  });

  test("a page past the end reads no rows", async () => {
    fake("Monitor", { total: 10, reader: 10, rows: manyRows(10) });

    const page: UsedByPage = await UsedByService.getPage({
      recordKind: UsedByRecordKind.Service,
      recordId: RECORD,
      relation: UsedByRelation.ServiceMonitors,
      projectId: PROJECT,
      props: READER,
      skip: 50,
    });

    expect(page.rows).toEqual([]);
    expect(
      readsOf("Monitor", "findBy").filter((read: Read): boolean => {
        return !read.isRoot;
      }),
    ).toEqual([]);
  });

  test("a page of a relation another kind lists is refused", async () => {
    await expect(
      UsedByService.getPage({
        recordKind: UsedByRecordKind.Service,
        recordId: RECORD,
        relation: UsedByRelation.MonitorStatusPages,
        projectId: PROJECT,
        props: READER,
      }),
    ).rejects.toBeInstanceOf(BadDataException);
  });
});

describe("the rules and templates that name a monitor (#7433)", () => {
  test("each kind of rule is read by its own monitors list, switched-off rules said so", async () => {
    const plans: Array<UsedByReadPlan> = await familyPlansOf(
      UsedByRelation.MonitorRules,
    );

    expect(plans).toHaveLength(17);

    for (const plan of plans) {
      const table: string = plan.service.getModel().tableName || "";
      const { sql, parameters } = sqlOf(
        (plan.query as Record<string, unknown>)["_id"],
      );

      expect(sql).toContain(
        `FROM "${table}Monitor" WHERE "${table}Monitor"."monitorId" IN`,
      );
      expect(parameters).toContain(RECORD.toString());
      expect(plan.nameColumn).toBe("name");
      expect(plan.offWhen).toEqual({ column: "isEnabled", value: false });
    }
  });

  test("an AI rule and a runbook rule open the page of what triggers them", async () => {
    const plans: Array<UsedByReadPlan> = await familyPlansOf(
      UsedByRelation.MonitorRules,
    );
    const runbookRules: UsedByReadPlan | undefined = plans.find(
      (plan: UsedByReadPlan): boolean => {
        return plan.service.getModel().tableName === "RunbookRule";
      },
    );
    const aiRules: UsedByReadPlan | undefined = plans.find(
      (plan: UsedByReadPlan): boolean => {
        return plan.service.getModel().tableName === "AutoRemediationRule";
      },
    );

    expect(runbookRules?.rowKindByColumn).toEqual({
      column: "triggerEntityType",
      rowKinds: {
        Incident: UsedByRowKind.IncidentRunbookRule,
        Alert: UsedByRowKind.AlertRunbookRule,
        ScheduledMaintenance: UsedByRowKind.MaintenanceRunbookRule,
      },
    });
    expect(aiRules?.rowKindByColumn?.rowKinds).toEqual({
      Incident: UsedByRowKind.IncidentAiRule,
      Alert: UsedByRowKind.AlertAiRule,
    });
  });

  test("templates are named by their template name", async () => {
    const plans: Array<UsedByReadPlan> = await familyPlansOf(
      UsedByRelation.MonitorTemplates,
    );

    expect(
      plans.map((plan: UsedByReadPlan): string => {
        return `${plan.service.getModel().tableName}.${plan.nameColumn}`;
      }),
    ).toEqual([
      "IncidentTemplate.templateName",
      "ScheduledMaintenanceTemplate.templateName",
      "StatusPageAnnouncementTemplate.templateName",
    ]);

    for (const plan of plans) {
      expect(
        sqlOf((plan.query as Record<string, unknown>)["_id"]).sql,
      ).toContain('"monitorId" IN');
      // A template has no switch: never said to be off.
      expect(plan.offWhen).toBeUndefined();
    }
  });

  test("a monitor named by an on-call rule and an incident template shows both, each row with its kind", async () => {
    fake("IncidentOnCallRule", {
      total: 1,
      reader: 1,
      rows: [
        {
          _id: "68130000-0000-4000-8000-000000000401",
          name: "Page the platform team",
          isEnabled: true,
        },
      ],
    });
    fake("AlertOwnerRule", {
      total: 1,
      reader: 1,
      rows: [
        {
          _id: "68130000-0000-4000-8000-000000000402",
          name: "Database alerts to DBAs",
          isEnabled: false,
        },
      ],
    });
    fake("IncidentTemplate", {
      total: 1,
      reader: 1,
      rows: [
        {
          _id: "68130000-0000-4000-8000-000000000403",
          templateName: "Database down",
        },
      ],
    });

    const summary: UsedBySummary = await summaryOf(UsedByRecordKind.Monitor);
    const rules: UsedByGroup = groupOf(summary, UsedByRelation.MonitorRules);
    const templates: UsedByGroup = groupOf(
      summary,
      UsedByRelation.MonitorTemplates,
    );

    expect(rules).toEqual({
      relation: UsedByRelation.MonitorRules,
      rowKind: UsedByRowKind.IncidentOnCallRule,
      count: 2,
      hiddenCount: 0,
      parts: [
        { rowKind: UsedByRowKind.IncidentOnCallRule, count: 1, hiddenCount: 0 },
        { rowKind: UsedByRowKind.AlertOwnerRule, count: 1, hiddenCount: 0 },
      ],
      rows: [
        {
          id: "68130000-0000-4000-8000-000000000401",
          name: "Page the platform team",
          rowKind: UsedByRowKind.IncidentOnCallRule,
        },
        {
          id: "68130000-0000-4000-8000-000000000402",
          name: "Database alerts to DBAs",
          rowKind: UsedByRowKind.AlertOwnerRule,
          isOff: true,
        },
      ],
    });
    expect(templates.rows).toEqual([
      {
        id: "68130000-0000-4000-8000-000000000403",
        name: "Database down",
        rowKind: UsedByRowKind.IncidentTemplate,
      },
    ]);

    // A rule's row reads its name and its switch, no more.
    expect(readsOf("IncidentOnCallRule", "findBy")[0]?.select).toEqual({
      _id: true,
      name: true,
      isEnabled: true,
    });
  });

  test("a reader who may not read rules sees how many, never their names", async () => {
    fake("IncidentOnCallRule", { total: 2, reader: "refuse" });

    const summary: UsedBySummary = await summaryOf(UsedByRecordKind.Monitor);
    const rules: UsedByGroup = groupOf(summary, UsedByRelation.MonitorRules);

    expect(rules.count).toBe(0);
    expect(rules.hiddenCount).toBe(2);
    expect(rules.rows).toEqual([]);
    expect(rules.parts).toEqual([
      { rowKind: UsedByRowKind.IncidentOnCallRule, count: 0, hiddenCount: 2 },
    ]);
    expect(readsOf("IncidentOnCallRule", "findBy")).toEqual([]);
  });

  test("a runbook rule triggered by an alert opens the alerts' runbook rules", async () => {
    fake("RunbookRule", {
      total: 2,
      reader: 2,
      rows: [
        {
          _id: "68130000-0000-4000-8000-000000000411",
          name: "Restart on alert",
          triggerEntityType: "Alert",
        },
        {
          _id: "68130000-0000-4000-8000-000000000412",
          name: "Something new",
          triggerEntityType: "SomethingNew",
        },
      ],
    });

    const summary: UsedBySummary = await summaryOf(UsedByRecordKind.Monitor);

    expect(
      groupOf(summary, UsedByRelation.MonitorRules).rows.map(
        (row: UsedByRow): UsedByRowKind | undefined => {
          return row.rowKind;
        },
      ),
    ).toEqual([
      UsedByRowKind.AlertRunbookRule,
      // A trigger the family does not know keeps the plan's own kind.
      UsedByRowKind.IncidentRunbookRule,
    ]);
  });
});

describe("everything a team owns (#7434)", () => {
  const DATABASE_MODELS: string = path.join(
    __dirname,
    "../../../Models/DatabaseModels",
  );

  const OWNER_TEAM_FILE: RegExp = /OwnerTeam\.ts$/u;

  // Every owner table of a team, as the models folder names them.
  const OWNER_TEAM_TABLES: Array<string> = fs
    .readdirSync(DATABASE_MODELS)
    .filter((file: string): boolean => {
      return OWNER_TEAM_FILE.test(file);
    })
    .map((file: string): string => {
      return file.replace(/\.ts$/u, "");
    })
    .sort();

  async function ownerTablesRead(): Promise<Array<string>> {
    const tables: Array<string> = [];

    for (const description of USED_BY_RELATIONS[UsedByRecordKind.Team]) {
      if (description.relation === UsedByRelation.TeamOnCallPolicies) {
        continue;
      }

      for (const plan of await plansOf(description.relation)) {
        const match: RegExpMatchArray | null = sqlOf(
          (plan.query as Record<string, unknown>)["_id"],
        ).sql.match(/FROM "(\w+OwnerTeam)"/u);

        expect(match).not.toBeNull();
        tables.push((match as RegExpMatchArray)[1] as string);
      }
    }

    return tables;
  }

  test("every owner table is read by exactly one of the team's relations", async () => {
    expect(OWNER_TEAM_TABLES.length).toBeGreaterThan(40);

    const tables: Array<string> = await ownerTablesRead();

    // Each once: no kind is counted twice on the card.
    expect(new Set(tables).size).toBe(tables.length);
    expect([...tables].sort()).toEqual(OWNER_TEAM_TABLES);
  });

  test("each kind it owns is read through its owner table, by the team", async () => {
    for (const plan of await familyPlansOf(UsedByRelation.TeamOwnedOther)) {
      const { sql, parameters } = sqlOf(
        (plan.query as Record<string, unknown>)["_id"],
      );

      expect(sql).toMatch(
        /^\(\S+ IN \(SELECT "(\w+)OwnerTeam"\."\w+" FROM "\1OwnerTeam" WHERE "\1OwnerTeam"\."teamId" IN/u,
      );
      expect(parameters).toContain(RECORD.toString());
    }
  });

  test("a team that owns an SLO and a dashboard says so, and its events come last", async () => {
    fake("ServiceLevelObjective", {
      total: 1,
      reader: 1,
      rows: [
        { _id: "68130000-0000-4000-8000-000000000501", name: "Checkout 99.9" },
      ],
    });
    fake("Dashboard", {
      total: 1,
      reader: 1,
      rows: [{ _id: "68130000-0000-4000-8000-000000000502", name: "Platform" }],
    });
    fake("Incident", {
      total: 340,
      reader: 300,
      rows: [
        {
          _id: "68130000-0000-4000-8000-000000000503",
          title: "API down",
          incidentNumberWithPrefix: "INC-12",
        },
      ],
    });

    const summary: UsedBySummary = await summaryOf(UsedByRecordKind.Team);
    const other: UsedByGroup = groupOf(summary, UsedByRelation.TeamOwnedOther);

    expect(other.count).toBe(302);
    expect(other.hiddenCount).toBe(40);
    expect(other.parts).toEqual([
      {
        rowKind: UsedByRowKind.ServiceLevelObjective,
        count: 1,
        hiddenCount: 0,
      },
      { rowKind: UsedByRowKind.Dashboard, count: 1, hiddenCount: 0 },
      { rowKind: UsedByRowKind.Incident, count: 300, hiddenCount: 40 },
    ]);
    expect(
      other.rows.map((row: UsedByRow): string => {
        return [row.rowKind, row.number, row.name]
          .filter((part: string | undefined): boolean => {
            return Boolean(part);
          })
          .join(" ");
      }),
    ).toEqual([
      "ServiceLevelObjective Checkout 99.9",
      "Dashboard Platform",
      "Incident INC-12 API down",
    ]);
  });
});

describe("what runs an on-call policy (#7758)", () => {
  test("the on-call rules of incidents, alerts and their episodes that page it", async () => {
    const plans: Array<UsedByReadPlan> = await familyPlansOf(
      UsedByRelation.OnCallPolicyRules,
    );

    expect(
      plans.map((plan: UsedByReadPlan): string => {
        return sqlOf((plan.query as Record<string, unknown>)["_id"]).sql.match(
          /FROM "(\w+)"/u,
        )?.[1] as string;
      }),
    ).toEqual([
      "IncidentOnCallRuleOnCallDutyPolicy",
      "AlertOnCallRuleOnCallDutyPolicy",
      "IncidentEpisodeOnCallRuleOnCallDutyPolicy",
      "AlertEpisodeOnCallRuleOnCallDutyPolicy",
    ]);

    for (const plan of plans) {
      expect(
        sqlOf((plan.query as Record<string, unknown>)["_id"]).parameters,
      ).toContain(RECORD.toString());
      expect(plan.offWhen).toEqual({ column: "isEnabled", value: false });
    }
  });

  test("the monitors whose criteria name it, an unchecked one said so", async () => {
    const plan: UsedByReadPlan = await planOf(
      UsedByRelation.OnCallPolicyMonitors,
    );
    const query: Record<string, unknown> = plan.query as Record<
      string,
      unknown
    >;
    const steps: { sql: string; parameters: string } = sqlOf(
      query["monitorSteps"],
    );

    expect(steps.sql).toContain("ILIKE ANY");
    expect(steps.parameters).toContain(`%${RECORD.toString()}%`);
    expect(query["isArchived"]).toBe(false);
    expect(plan.offWhen).toEqual({
      column: "disableActiveMonitoring",
      value: true,
    });
  });

  test("an SLO's rules page it for their alerts or their incidents, and open their SLO", async () => {
    const plans: Array<UsedByReadPlan> = await familyPlansOf(
      UsedByRelation.OnCallPolicyOther,
    );
    const sloRules: Array<UsedByReadPlan> = plans.filter(
      (plan: UsedByReadPlan): boolean => {
        return (
          plan.rowKind === UsedByRowKind.SloBurnRateRule ||
          plan.rowKind === UsedByRowKind.SloErrorBudgetPolicyTier
        );
      },
    );

    expect(sloRules).toHaveLength(2);

    for (const plan of sloRules) {
      const { sql } = sqlOf((plan.query as Record<string, unknown>)["_id"]);

      expect(sql).toContain(" OR ");
      expect(sql).toMatch(/OnCallDutyPolicy"\."onCallDutyPolicyId" IN/u);
      expect(sql).toMatch(
        /IncidentOnCallDutyPolicy"\."onCallDutyPolicyId" IN/u,
      );
      expect(plan.linkIdColumn).toBe("serviceLevelObjectiveId");
    }

    const template: UsedByReadPlan | undefined = plans.find(
      (plan: UsedByReadPlan): boolean => {
        return plan.rowKind === UsedByRowKind.IncidentTemplate;
      },
    );
    expect(template?.nameColumn).toBe("templateName");
    expect(
      sqlOf((template?.query as Record<string, unknown>)["_id"]).sql,
    ).toContain('FROM "IncidentTemplateOnCallDutyPolicy"');
  });

  test("a burn-rate rule's row opens its SLO's page, and a switched-off rule says so", async () => {
    fake("ServiceLevelObjectiveBurnRateRule", {
      total: 1,
      reader: 1,
      rows: [
        {
          _id: "68130000-0000-4000-8000-000000000601",
          name: "Fast burn",
          serviceLevelObjectiveId: new ObjectID(
            "68130000-0000-4000-8000-000000000602",
          ),
          isEnabled: false,
        },
      ],
    });

    const summary: UsedBySummary = await summaryOf(
      UsedByRecordKind.OnCallPolicy,
    );

    expect(groupOf(summary, UsedByRelation.OnCallPolicyOther).rows).toEqual([
      {
        id: "68130000-0000-4000-8000-000000000601",
        name: "Fast burn",
        rowKind: UsedByRowKind.SloBurnRateRule,
        linkId: "68130000-0000-4000-8000-000000000602",
        isOff: true,
      },
    ]);
  });

  test("a policy nothing runs: every line empty", async () => {
    const summary: UsedBySummary = await summaryOf(
      UsedByRecordKind.OnCallPolicy,
    );

    expect(
      summary.groups.map((group: UsedByGroup): string => {
        return `${group.relation} ${group.count + group.hiddenCount}`;
      }),
    ).toEqual([
      `${UsedByRelation.OnCallPolicyRules} 0`,
      `${UsedByRelation.OnCallPolicyMonitors} 0`,
      `${UsedByRelation.OnCallPolicyOther} 0`,
      `${UsedByRelation.OnCallPolicyWorkflows} 0`,
    ]);
  });
});

describe("a monitor group's and an SLO's relations (#7437)", () => {
  test("the status pages that show the group", async () => {
    const plan: UsedByReadPlan = await planOf(
      UsedByRelation.MonitorGroupStatusPages,
    );

    expect(sqlOf((plan.query as Record<string, unknown>)["_id"]).sql).toContain(
      'SELECT "StatusPageResource"."statusPageId" FROM "StatusPageResource" WHERE "StatusPageResource"."monitorGroupId" IN',
    );
  });

  test("the SLOs that measure the group's monitors, read as OneUptime", async () => {
    fake("MonitorGroupResource", {
      rows: [
        { monitorId: new ObjectID(WATCHER_1) },
        { monitorId: new ObjectID(WATCHER_2) },
        { monitorId: new ObjectID(WATCHER_1) },
      ],
    });

    const plan: UsedByReadPlan = await planOf(UsedByRelation.MonitorGroupSlos);
    const { sql, parameters } = sqlOf(
      (plan.query as Record<string, unknown>)["_id"],
    );

    expect(sql).toContain('"ServiceLevelObjectiveMonitor"."monitorId" IN');
    expect(parameters).toContain(WATCHER_1);
    expect(parameters).toContain(WATCHER_2);
    // Each monitor once.
    expect(parameters.split(WATCHER_1).length - 1).toBe(1);

    const groupRead: Read | undefined = readsOf(
      "MonitorGroupResource",
      "findBy",
    )[0];
    expect(groupRead?.isRoot).toBe(true);
    expect(groupRead?.select).toEqual({ monitorId: true });
  });

  test("a group with no monitors has no SLOs to count", async () => {
    const plan: UsedByReadPlan = await planOf(UsedByRelation.MonitorGroupSlos);

    expect(plan.query).toBeNull();
  });

  test("an SLO's burn-rate rules and policy tiers by their SLO, opening its pages", async () => {
    for (const relation of [
      UsedByRelation.SloBurnRateRules,
      UsedByRelation.SloErrorBudgetPolicies,
    ]) {
      const plan: UsedByReadPlan = await planOf(relation);
      const { parameters } = sqlOf(
        (plan.query as Record<string, unknown>)["serviceLevelObjectiveId"],
      );

      expect(parameters).toContain(RECORD.toString());
      expect(plan.linkIdColumn).toBe("serviceLevelObjectiveId");
      expect(plan.offWhen).toEqual({ column: "isEnabled", value: false });
    }
  });

  test("the dashboards whose widgets name the SLO", async () => {
    const plan: UsedByReadPlan = await planOf(UsedByRelation.SloDashboards);

    expect(
      sqlOf((plan.query as Record<string, unknown>)["dashboardViewConfig"])
        .parameters,
    ).toContain(`%${RECORD.toString()}%`);
  });
});

describe("a family's reads stay bounded", () => {
  function rowsOf(
    prefix: string,
    count: number,
  ): Array<Record<string, unknown>> {
    return Array.from(
      { length: count },
      (_value: unknown, index: number): Record<string, unknown> => {
        return {
          _id: `68130000-0000-4000-8000-${prefix}${String(index).padStart(12 - prefix.length, "0")}`,
          name: `${prefix} ${index}`,
        };
      },
    );
  }

  test("a monitor named by thousands of rules of every kind: counts per kind, three rows in all", async () => {
    for (const plan of await familyPlansOf(UsedByRelation.MonitorRules)) {
      fake(plan.service.getModel().tableName || "", {
        total: 3000,
        reader: 3000,
        rows: rowsOf("7", 3000),
      });
    }

    const summary: UsedBySummary = await summaryOf(UsedByRecordKind.Monitor);
    const rules: UsedByGroup = groupOf(summary, UsedByRelation.MonitorRules);

    expect(rules.count).toBe(17 * 3000);
    expect(rules.rows).toHaveLength(USED_BY_PREVIEW_ROW_COUNT);

    // The three rows come from the first kind, in one read of three.
    const rowReads: Array<Read> = reads.filter((read: Read): boolean => {
      return (
        read.method === "findBy" && !read.isRoot && read.table.endsWith("Rule")
      );
    });
    expect(rowReads).toHaveLength(1);
    expect(rowReads[0]?.table).toBe("IncidentOnCallRule");
    expect(rowReads[0]?.limit).toBe(USED_BY_PREVIEW_ROW_COUNT);

    // Two counts per kind: as OneUptime and as the reader.
    for (const plan of await familyPlansOf(UsedByRelation.MonitorRules)) {
      expect(
        readsOf(plan.service.getModel().tableName || "", "countBy").length,
      ).toBeLessThanOrEqual(2);
    }

    // A family's kinds are counted a few at a time.
    expect(mostCountsInFlight).toBeGreaterThan(0);
    expect(mostCountsInFlight).toBeLessThanOrEqual(
      USED_BY_FAMILY_CONCURRENCY *
        USED_BY_RELATIONS[UsedByRecordKind.Monitor].length,
    );
  });

  test("the first rows skip kinds the reader may see none of", async () => {
    fake("IncidentOnCallRule", { total: 4, reader: "refuse" });
    fake("AlertOnCallRule", { total: 1, reader: 1, rows: rowsOf("8", 1) });
    fake("IncidentOwnerRule", { total: 5, reader: 5, rows: rowsOf("9", 5) });

    const summary: UsedBySummary = await summaryOf(UsedByRecordKind.Monitor);
    const rules: UsedByGroup = groupOf(summary, UsedByRelation.MonitorRules);

    expect(
      rules.rows.map((row: UsedByRow): UsedByRowKind | undefined => {
        return row.rowKind;
      }),
    ).toEqual([
      UsedByRowKind.AlertOnCallRule,
      UsedByRowKind.IncidentOwnerRule,
      UsedByRowKind.IncidentOwnerRule,
    ]);
    expect(readsOf("IncidentOnCallRule", "findBy")).toEqual([]);
    expect(readsOf("AlertOnCallRule", "findBy")[0]?.limit).toBe(1);
    expect(readsOf("IncidentOwnerRule", "findBy")[0]?.limit).toBe(2);
    expect(rules.hiddenCount).toBe(4);
  });

  test("See all reads a family's page kind by kind, skipped over by their counts", async () => {
    fake("IncidentOnCallRule", { total: 2, reader: 2, rows: rowsOf("1", 2) });
    fake("AlertOnCallRule", { total: 5, reader: 5, rows: rowsOf("2", 5) });
    fake("IncidentGroupingRule", {
      total: 10,
      reader: 10,
      rows: rowsOf("3", 10),
    });

    const page: UsedByPage = await UsedByService.getPage({
      recordKind: UsedByRecordKind.Monitor,
      recordId: RECORD,
      relation: UsedByRelation.MonitorRules,
      projectId: PROJECT,
      props: READER,
      skip: 4,
      limit: 5,
    });

    expect(page.count).toBe(17);
    expect(
      page.rows.map((row: UsedByRow): string => {
        return row.name;
      }),
    ).toEqual(["2 2", "2 3", "2 4", "3 0", "3 1"]);
    expect(readsOf("IncidentOnCallRule", "findBy")).toEqual([]);
    expect(readsOf("AlertOnCallRule", "findBy")[0]).toMatchObject({
      skip: 2,
      limit: 3,
    });
    expect(readsOf("IncidentGroupingRule", "findBy")[0]).toMatchObject({
      skip: 0,
      limit: 2,
    });
  });
});

describe("several records at once, for a list's bulk Delete and Archive (#7435)", () => {
  const SECOND: ObjectID = new ObjectID("68130000-0000-4000-8000-000000000003");

  async function summariesOf(
    recordKind: UsedByRecordKind,
    recordIds: Array<ObjectID>,
  ): Promise<UsedByBulkSummary> {
    return await UsedByService.getSummaries({
      recordKind: recordKind,
      recordIds: recordIds,
      projectId: PROJECT,
      props: READER,
      now: new Date("2026-11-12T10:00:00.000Z"),
    });
  }

  function readable(table: string, ids: Array<ObjectID>): void {
    fake(table, {
      rows: ids.map((id: ObjectID): Record<string, unknown> => {
        return { _id: id.toString() };
      }),
    });
  }

  test("each relation is counted once for all of them, with no rows", async () => {
    readable("Monitor", [RECORD, SECOND]);
    fake("StatusPage", { total: 12, reader: 10 });

    const summary: UsedByBulkSummary = await summariesOf(
      UsedByRecordKind.Monitor,
      [RECORD, SECOND],
    );
    const pages: UsedByCounts | undefined = summary.groups.find(
      (group: UsedByCounts): boolean => {
        return group.relation === UsedByRelation.MonitorStatusPages;
      },
    );

    expect(summary.recordCount).toBe(2);
    expect(pages).toEqual({
      relation: UsedByRelation.MonitorStatusPages,
      rowKind: UsedByRowKind.StatusPage,
      count: 10,
      hiddenCount: 2,
    });
    expect(pages).not.toHaveProperty("rows");

    // One count as OneUptime and one as the reader, both ids in each.
    const counts: Array<Read> = readsOf("StatusPage", "countBy");
    expect(counts).toHaveLength(2);
    for (const count of counts) {
      const { parameters } = sqlOf(count.query["_id"]);
      expect(parameters).toContain(RECORD.toString());
      expect(parameters).toContain(SECOND.toString());
    }

    // No row of anything that refers is read.
    expect(readsOf("StatusPage", "findBy")).toEqual([]);
  });

  test("a family is counted kind by kind, with its parts", async () => {
    readable("Monitor", [RECORD, SECOND]);
    fake("IncidentOnCallRule", { total: 3, reader: 3 });
    fake("IncidentTemplate", { total: 1, reader: 0 });

    const summary: UsedByBulkSummary = await summariesOf(
      UsedByRecordKind.Monitor,
      [RECORD, SECOND],
    );

    expect(
      summary.groups.find((group: UsedByCounts): boolean => {
        return group.relation === UsedByRelation.MonitorRules;
      }),
    ).toEqual({
      relation: UsedByRelation.MonitorRules,
      rowKind: UsedByRowKind.IncidentOnCallRule,
      count: 3,
      hiddenCount: 0,
      parts: [
        { rowKind: UsedByRowKind.IncidentOnCallRule, count: 3, hiddenCount: 0 },
      ],
    });
    expect(
      summary.groups.find((group: UsedByCounts): boolean => {
        return group.relation === UsedByRelation.MonitorTemplates;
      })?.hiddenCount,
    ).toBe(1);
  });

  test("only the records the reader may read are counted", async () => {
    readable("Monitor", [SECOND]);

    const summary: UsedByBulkSummary = await summariesOf(
      UsedByRecordKind.Monitor,
      [RECORD, SECOND, SECOND],
    );

    expect(summary.recordCount).toBe(1);

    // The records were read as the reader, each asked about once.
    const recordRead: Read | undefined = readsOf("Monitor", "findBy").find(
      (read: Read): boolean => {
        return !read.isRoot;
      },
    );
    expect(recordRead?.limit).toBe(2);
    expect(recordRead?.query["projectId"]).toBe(PROJECT);

    // What refers is counted for the one the reader may read only.
    const { parameters } = sqlOf(
      readsOf("StatusPage", "countBy")[0]?.query["_id"],
    );
    expect(parameters).toContain(SECOND.toString());
    expect(parameters).not.toContain(RECORD.toString());
  });

  test("none the reader may read: nothing is counted", async () => {
    const summary: UsedBySummary | UsedByBulkSummary = await summariesOf(
      UsedByRecordKind.Monitor,
      [RECORD],
    );

    expect(summary.recordCount).toBe(0);
    expect(
      (summary as UsedByBulkSummary).groups.every(
        (group: UsedByCounts): boolean => {
          return group.count === 0 && group.hiddenCount === 0;
        },
      ),
    ).toBe(true);
    expect(
      reads.filter((read: Read): boolean => {
        return read.method === "countBy";
      }),
    ).toEqual([]);
  });

  test("a relation read one record at a time is left out", async () => {
    readable("StatusPage", [RECORD, SECOND]);

    const summary: UsedByBulkSummary = await summariesOf(
      UsedByRecordKind.StatusPage,
      [RECORD, SECOND],
    );

    expect(
      summary.groups.map((group: UsedByCounts): UsedByRelation => {
        return group.relation;
      }),
    ).toEqual(
      getUsedByBulkRelations(UsedByRecordKind.StatusPage).map(
        (description: UsedByRelationDescription): UsedByRelation => {
          return description.relation;
        },
      ),
    );
    expect(
      summary.groups.some((group: UsedByCounts): boolean => {
        return group.relation === UsedByRelation.StatusPageOpenIncidents;
      }),
    ).toBe(false);
  });

  test("the maintenance the selected pages show: only pages that show maintenance", async () => {
    const statusPageFindBy: jest.SpyInstance = jest
      .spyOn(StatusPageService, "findBy")
      .mockImplementation(async (args: any): Promise<Array<StatusPage>> => {
        if (!args.props.isRoot) {
          return [RECORD, SECOND].map((id: ObjectID): StatusPage => {
            return Object.assign(new StatusPage(), { _id: id.toString() });
          });
        }

        // Of the two, only SECOND shows scheduled maintenance.
        expect(args.query["showScheduledMaintenanceEventsOnStatusPage"]).toBe(
          true,
        );
        return [Object.assign(new StatusPage(), { _id: SECOND.toString() })];
      });

    await summariesOf(UsedByRecordKind.StatusPage, [RECORD, SECOND]);

    expect(statusPageFindBy).toHaveBeenCalled();
    const { parameters } = sqlOf(
      readsOf("ScheduledMaintenance", "countBy")[0]?.query["_id"],
    );
    expect(parameters).toContain(SECOND.toString());
    expect(parameters).not.toContain(RECORD.toString());
  });

  test("more records than a selection holds are refused before anything is read", async () => {
    const tooMany: Array<ObjectID> = Array.from(
      { length: USED_BY_BULK_MAX_RECORDS + 1 },
      (): ObjectID => {
        return ObjectID.generate();
      },
    );

    await expect(
      summariesOf(UsedByRecordKind.Monitor, tooMany),
    ).rejects.toBeInstanceOf(BadDataException);
    expect(reads).toEqual([]);
  });

  test("a reader refused the records altogether counts nothing", async () => {
    jest
      .spyOn(MonitorService, "findBy")
      .mockRejectedValue(new NotAuthorizedException("No monitors."));

    const summary: UsedByBulkSummary = await summariesOf(
      UsedByRecordKind.Monitor,
      [RECORD],
    );

    expect(summary.recordCount).toBe(0);
  });

  test("ids are counted once each, in their order", () => {
    expect(
      uniqueIds([RECORD, SECOND, new ObjectID(RECORD.toString())]).map(
        (id: ObjectID): string => {
          return id.toString();
        },
      ),
    ).toEqual([RECORD.toString(), SECOND.toString()]);
  });
});

describe("the summary's shape", () => {
  test("one group per relation of the kind, in its order, and the record it is about", async () => {
    const summary: UsedBySummary = await summaryOf(UsedByRecordKind.Monitor);

    expect(summary.recordKind).toBe(UsedByRecordKind.Monitor);
    expect(summary.recordId).toBe(RECORD.toString());
    expect(
      summary.groups.map((each: UsedByGroup): UsedByRelation => {
        return each.relation;
      }),
    ).toEqual(
      USED_BY_RELATIONS[UsedByRecordKind.Monitor].map(
        (description: UsedByRelationDescription): UsedByRelation => {
          return description.relation;
        },
      ),
    );
  });
});
