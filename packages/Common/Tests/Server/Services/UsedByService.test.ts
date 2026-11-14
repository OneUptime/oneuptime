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
  USED_BY_RECORD_SERVICES,
  USED_BY_RELATION_DEFINITIONS,
  UsedByReadContext,
  UsedByReadPlan,
  getListJoinTable,
  isReadRefusal,
  namedByRowsReferencing,
  withoutArchived,
} from "../../../Server/Services/UsedByService";
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
  USED_BY_MAX_PAGE_SIZE,
  USED_BY_PREVIEW_ROW_COUNT,
  USED_BY_RELATIONS,
  UsedByGroup,
  UsedByPage,
  UsedByRecordKind,
  UsedByRelation,
  UsedByRelationDescription,
  UsedByRowKind,
  UsedBySummary,
} from "../../../Types/UsedBy/UsedBy";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
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
          "You do not have permission to read these. Ask a project admin for access.",
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
          "You do not have permission to read these. Ask a project admin for access.",
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

function installFakes(): void {
  for (const each of SERVICES) {
    installFakesOf(each.service);
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

async function planOf(relation: UsedByRelation): Promise<UsedByReadPlan> {
  const context: UsedByReadContext = {
    projectId: PROJECT,
    recordId: RECORD,
    props: READER,
    now: new Date("2026-11-12T10:00:00.000Z"),
  };

  return await USED_BY_RELATION_DEFINITIONS[relation].getPlan(context);
}

beforeEach(() => {
  jest.restoreAllMocks();
  fakes = new Map();
  reads = [];
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
    };

    jest.spyOn(StatusPageService, "findOneById").mockResolvedValue(null);

    for (const kind of Object.values(UsedByRecordKind)) {
      for (const description of USED_BY_RELATIONS[kind]) {
        const plan: UsedByReadPlan = await planOf(description.relation);

        expect({
          relation: description.relation,
          table: plan.service.getModel().tableName,
        }).toEqual({
          relation: description.relation,
          table: tableOfRowKind[description.rowKind],
        });
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
    expect(groupRead?.query["monitorId"]).toBe(RECORD);
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
    jest.spyOn(StatusPageService, "findOneById").mockResolvedValue(
      Object.assign(new StatusPage(), {
        _id: RECORD.toString(),
        showScheduledMaintenanceEventsOnStatusPage: true,
      }) as never,
    );

    const plan: UsedByReadPlan = await planOf(
      UsedByRelation.StatusPageMaintenance,
    );
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
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
      .mockImplementation(async (args: any): Promise<Array<BaseModel>> => {
        reads.push({
          table: "OnCallDutyPolicyEscalationRuleSchedule",
          method: "findBy",
          isRoot: Boolean(args.props.isRoot),
          query: args.query,
        });

        return [
          { name: "Second line", order: 2 },
          { name: "First line", order: 1 },
          { name: "First line", order: 1 },
          { name: "", order: 3 },
        ].map((rule: { name: string; order: number }): BaseModel => {
          return Object.assign(new BaseModel(), {
            onCallDutyPolicyId: new ObjectID(
              "68130000-0000-4000-8000-000000000201",
            ),
            onCallDutyPolicyEscalationRule: rule,
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

    const detailRead: Read | undefined = readsOf(
      "OnCallDutyPolicyEscalationRuleSchedule",
    )[0];
    expect(detailRead?.isRoot).toBe(false);
    expect(detailRead?.query["onCallDutyPolicyScheduleId"]).toBe(RECORD);
    expect(detailRead?.query["projectId"]).toBe(PROJECT);
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
