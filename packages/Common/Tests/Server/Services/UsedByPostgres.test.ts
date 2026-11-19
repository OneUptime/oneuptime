import Entities from "../../../Models/DatabaseModels/Index";
import AIPostmortemRule from "../../../Models/DatabaseModels/AIPostmortemRule";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisodeOnCallRule from "../../../Models/DatabaseModels/AlertEpisodeOnCallRule";
import AlertGroupingRule from "../../../Models/DatabaseModels/AlertGroupingRule";
import AlertIncidentRule from "../../../Models/DatabaseModels/AlertIncidentRule";
import AlertLabelRule from "../../../Models/DatabaseModels/AlertLabelRule";
import AlertOnCallRule from "../../../Models/DatabaseModels/AlertOnCallRule";
import AlertOwnerRule from "../../../Models/DatabaseModels/AlertOwnerRule";
import AlertPrivacyRule from "../../../Models/DatabaseModels/AlertPrivacyRule";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import CloudBudget from "../../../Models/DatabaseModels/CloudBudget";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisodeOnCallRule from "../../../Models/DatabaseModels/IncidentEpisodeOnCallRule";
import IncidentGroupingRule from "../../../Models/DatabaseModels/IncidentGroupingRule";
import IncidentLabelRule from "../../../Models/DatabaseModels/IncidentLabelRule";
import IncidentOnCallRule from "../../../Models/DatabaseModels/IncidentOnCallRule";
import IncidentOwnerRule from "../../../Models/DatabaseModels/IncidentOwnerRule";
import IncidentPrivacyRule from "../../../Models/DatabaseModels/IncidentPrivacyRule";
import IncidentSlaRule from "../../../Models/DatabaseModels/IncidentSlaRule";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorGroup from "../../../Models/DatabaseModels/MonitorGroup";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import RunbookRule from "../../../Models/DatabaseModels/RunbookRule";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceLabelRule from "../../../Models/DatabaseModels/ScheduledMaintenanceLabelRule";
import ScheduledMaintenanceOwnerRule from "../../../Models/DatabaseModels/ScheduledMaintenanceOwnerRule";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import Service from "../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ServiceLevelObjectiveErrorBudgetPolicyTier from "../../../Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncementTemplate from "../../../Models/DatabaseModels/StatusPageAnnouncementTemplate";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import UsedByService, {
  getListJoinTable,
} from "../../../Server/Services/UsedByService";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import {
  USED_BY_PREVIEW_ROW_COUNT,
  USED_BY_RELATIONS,
  UsedByBulkSummary,
  UsedByCounts,
  UsedByGroup,
  UsedByGroupPart,
  UsedByPage,
  UsedByRecordKind,
  UsedByRelation,
  UsedByRelationDescription,
  UsedByRow,
  UsedByRowKind,
  UsedBySummary,
} from "../../../Types/UsedBy/UsedBy";
import UserType from "../../../Types/UserType";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { DataSource, Logger as TypeOrmLogger } from "typeorm";

/*
 * "USED BY" (#6813, #7436), EXECUTED against Postgres - not string matched.
 *
 * UsedByService.test checks every relation's SQL as text with the services
 * stubbed. Here each relation runs through the real services on a real
 * database, against rows written the way the product writes them - a
 * status page lists a monitor in StatusPageResource, a rule names it in
 * its monitors list, a team owns a record through its owner table - never
 * derived from the plan under test, so a relation that reads the wrong
 * table or column finds nothing and fails:
 *
 *   - every relation of every kind counts exactly the rows that refer to
 *     the record in its project: not a row that refers to another record
 *     of the project, not one of another project that names the record
 *     (the summary, then every row through getPage);
 *   - a selection is counted once for all its records;
 *   - a reader whose role is limited to a label, or blocked from one, sees
 *     the rows the label allows, and is told how many more there are
 *     without their names;
 *   - a record 5,000 rows refer to is summed up in three reads of the
 *     table that refers - two counts and one page of three rows - however
 *     many there are (counted with a TypeORM logger).
 *
 * The open incidents a status page shows run through IncidentStatusPageScope
 * here too (IncidentStatusPageScopePostgres covers its scope rules alone):
 * open, shown on status pages, not private, and scoped to no page or to
 * this one.
 *
 * Opt in with RUN_POSTGRES_USED_BY_TESTS=true against a Postgres migrated
 * to the current head (the clones copy public.<table>) - the Postgres
 * Schema Drift workflow's database right after its drift check.
 * Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * USED_BY_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * USED_BY_TEST_DATABASE_HOST / _PORT (default localhost:5400). Every table
 * and row lives in a unique schema that is dropped afterwards; search_path
 * holds only that schema, so a statement naming a table that was not
 * cloned fails loudly instead of touching real data.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_USED_BY_TESTS"] === "true"
    ? describe
    : describe.skip;

type ModelType = { new (): BaseModel };

// Every statement the services send while `recording` is on.
class RecordingLogger implements TypeOrmLogger {
  public recording: boolean = false;
  public queries: Array<string> = [];

  public logQuery(query: string): void {
    if (this.recording) {
      this.queries.push(query);
    }
  }

  public logQueryError(): void {
    return undefined;
  }

  public logQuerySlow(): void {
    return undefined;
  }

  public logSchemaBuild(): void {
    return undefined;
  }

  public logMigration(): void {
    return undefined;
  }

  public log(): void {
    return undefined;
  }
}

// A read of the status pages themselves, its table named with its schema or not.
const STATUS_PAGE_READ: RegExp =
  /FROM (?:"[^"]+"\.)?"StatusPage" "StatusPage"/u;
// A count, as TypeORM writes one.
const COUNT_READ: RegExp = /^SELECT COUNT\(/u;

const newId: () => string = (): string => {
  return ObjectID.generate().toString();
};

function tableOf(model: ModelType): string {
  return new model().tableName as string;
}

// A record that refers through one of its lists, named by `nameColumn`.
interface Referrer {
  model: ModelType;
  nameColumn: string;
  values?: Dictionary<unknown> | undefined;
}

function named(model: ModelType, nameColumn: string = "name"): Referrer {
  return { model: model, nameColumn: nameColumn };
}

// The rules that can be limited to monitors, each by its monitors list.
const MONITOR_RULES: Array<Referrer> = [
  named(IncidentOnCallRule),
  named(AlertOnCallRule),
  named(IncidentGroupingRule),
  named(AlertGroupingRule),
  named(IncidentOwnerRule),
  named(AlertOwnerRule),
  named(IncidentLabelRule),
  named(AlertLabelRule),
  named(IncidentPrivacyRule),
  named(AlertPrivacyRule),
  named(IncidentSlaRule),
  named(AlertIncidentRule),
  { ...named(AutoRemediationRule), values: { triggerEntityType: "Incident" } },
  { ...named(RunbookRule), values: { triggerEntityType: "Incident" } },
  named(AIPostmortemRule),
  named(ScheduledMaintenanceOwnerRule),
  named(ScheduledMaintenanceLabelRule),
];

const MONITOR_TEMPLATES: Array<Referrer> = [
  named(IncidentTemplate, "templateName"),
  named(ScheduledMaintenanceTemplate, "templateName"),
  named(StatusPageAnnouncementTemplate, "templateName"),
];

// The on-call rules that page a policy, each by its policies list.
const POLICY_RULES: Array<Referrer> = [
  named(IncidentOnCallRule),
  named(AlertOnCallRule),
  named(IncidentEpisodeOnCallRule),
  named(AlertEpisodeOnCallRule),
];

/*
 * What else pages a policy, each by the list it pages it through: a
 * burn-rate rule and an error budget tier page it for the alerts they
 * open, or for the incidents they declare - a list each.
 */
const POLICY_OTHERS: Array<{ referrer: Referrer; list: string }> = [
  {
    referrer: named(IncidentTemplate, "templateName"),
    list: "onCallDutyPolicies",
  },
  { referrer: named(IncidentGroupingRule), list: "onCallDutyPolicies" },
  { referrer: named(AlertGroupingRule), list: "onCallDutyPolicies" },
  {
    referrer: named(ServiceLevelObjectiveBurnRateRule),
    list: "incidentOnCallDutyPolicies",
  },
  {
    referrer: named(ServiceLevelObjectiveErrorBudgetPolicyTier),
    list: "onCallDutyPolicies",
  },
  { referrer: named(CloudBudget), list: "onCallDutyPolicies" },
];

// Both lists a burn-rate rule and a tier page a policy through.
const SLO_PAGING_LISTS: Array<string> = [
  "onCallDutyPolicies",
  "incidentOnCallDutyPolicies",
];

/*
 * The owner tables of a team the card lists on lines of their own; every
 * other one is a part of "everything else the team owns".
 */
const OWNED_ON_THEIR_OWN_LINES: Partial<Record<UsedByRelation, string>> = {
  [UsedByRelation.TeamOwnedMonitors]: "MonitorOwnerTeam",
  [UsedByRelation.TeamOwnedStatusPages]: "StatusPageOwnerTeam",
  [UsedByRelation.TeamOwnedServices]: "ServiceOwnerTeam",
  [UsedByRelation.TeamOwnedOnCallPolicies]: "OnCallDutyPolicyOwnerTeam",
  [UsedByRelation.TeamOwnedSchedules]: "OnCallDutyPolicyScheduleOwnerTeam",
};

// A team owns a record through "<Kind>OwnerTeam": its teamId and one more id.
interface OwnerTable {
  ownerTable: string;
  ownedTable: string;
  // The columns naming the record owned: exactly one, for a real owner table.
  ownedColumns: Array<string>;
  nameColumn: string;
}

const OWNER_TABLE_SHARED_COLUMNS: Array<string> = [
  "teamId",
  "projectId",
  "createdByUserId",
  "deletedByUserId",
];

const NAMED_BY_TITLE: Array<string> = [
  "Incident",
  "Alert",
  "IncidentEpisode",
  "AlertEpisode",
  "ScheduledMaintenance",
];

const NAMED_BY_TEMPLATE_NAME: Array<string> = [
  "IncidentTemplate",
  "ScheduledMaintenanceTemplate",
];

// A data pipeline is named by its OpenLineage job.
const NAMED_BY_JOB_NAME: Array<string> = ["DataPipeline"];

/*
 * What a record of an owned kind needs beside its name, where its table asks
 * for more: a pipeline's job runs in a namespace, and the two together are
 * its key, once in a project.
 */
const OWNED_RECORD_VALUES: Partial<
  Record<string, (name: string) => Dictionary<unknown>>
> = {
  DataPipeline: (name: string): Dictionary<unknown> => {
    return { jobNamespace: "warehouse", pipelineKey: `warehouse/${name}` };
  },
};

function ownerTableOf(model: ModelType): OwnerTable | null {
  const instance: BaseModel = new model();
  const ownerTable: string | null = instance.tableName;

  if (!ownerTable || !ownerTable.endsWith("OwnerTeam")) {
    return null;
  }

  const ownedTable: string = ownerTable.slice(0, -"OwnerTeam".length);

  return {
    ownerTable: ownerTable,
    ownedTable: ownedTable,
    ownedColumns: Object.keys(instance).filter((key: string): boolean => {
      return (
        key.endsWith("Id") &&
        !OWNER_TABLE_SHARED_COLUMNS.includes(key) &&
        instance.hasColumn(key)
      );
    }),
    nameColumn: NAMED_BY_TITLE.includes(ownedTable)
      ? "title"
      : NAMED_BY_TEMPLATE_NAME.includes(ownedTable)
        ? "templateName"
        : NAMED_BY_JOB_NAME.includes(ownedTable)
          ? "jobName"
          : "name",
  };
}

const OWNER_TABLES: Array<OwnerTable> = (Entities as Array<ModelType>)
  .map(ownerTableOf)
  .filter((table: OwnerTable | null): table is OwnerTable => {
    return table !== null;
  });

const OTHER_OWNER_TABLES: Array<OwnerTable> = OWNER_TABLES.filter(
  (table: OwnerTable): boolean => {
    return !Object.values(OWNED_ON_THEIR_OWN_LINES).includes(table.ownerTable);
  },
);

// What carries a label, by its labels list.
const LABELLED: Partial<Record<UsedByRelation, Referrer>> = {
  [UsedByRelation.LabelMonitors]: named(Monitor),
  [UsedByRelation.LabelMonitorGroups]: named(MonitorGroup),
  [UsedByRelation.LabelStatusPages]: named(StatusPage),
  [UsedByRelation.LabelServices]: named(Service),
  [UsedByRelation.LabelIncidents]: named(Incident, "title"),
  [UsedByRelation.LabelAlerts]: named(Alert, "title"),
  [UsedByRelation.LabelScheduledMaintenance]: named(
    ScheduledMaintenance,
    "title",
  ),
  [UsedByRelation.LabelOnCallPolicies]: named(OnCallDutyPolicy),
  [UsedByRelation.LabelOnCallSchedules]: named(OnCallDutyPolicySchedule),
  [UsedByRelation.LabelSlos]: named(ServiceLevelObjective),
  [UsedByRelation.LabelWorkflows]: named(Workflow),
  [UsedByRelation.LabelDashboards]: named(Dashboard),
};

// The record each kind asks about, as its own table holds it.
const RECORD_TABLES: Record<UsedByRecordKind, string> = {
  [UsedByRecordKind.Monitor]: "Monitor",
  [UsedByRecordKind.OnCallSchedule]: "OnCallDutyPolicySchedule",
  [UsedByRecordKind.Service]: "Service",
  [UsedByRecordKind.StatusPage]: "StatusPage",
  [UsedByRecordKind.Team]: "Team",
  [UsedByRecordKind.Label]: "Label",
  [UsedByRecordKind.OnCallPolicy]: "OnCallDutyPolicy",
  [UsedByRecordKind.MonitorGroup]: "MonitorGroup",
  [UsedByRecordKind.Slo]: "ServiceLevelObjective",
};

// Every table the fixtures write and the services read.
function tablesToClone(): Array<string> {
  const tables: Set<string> = new Set<string>([
    ...Object.values(RECORD_TABLES),
    "MonitorGroupResource",
    "StatusPageResource",
    "StatusPageGroup",
    "IncidentState",
    "ScheduledMaintenanceState",
    "OnCallDutyPolicyEscalationRule",
    "OnCallDutyPolicyEscalationRuleSchedule",
    "OnCallDutyPolicyEscalationRuleTeam",
    "ScheduledMaintenance",
    "Workflow",
    "Dashboard",
  ]);

  const addList: (model: ModelType, list: string) => void = (
    model: ModelType,
    list: string,
  ): void => {
    tables.add(tableOf(model));
    tables.add(getListJoinTable(model, list).joinTableName);
  };

  addList(StatusPage, "labels");
  addList(Monitor, "labels");
  addList(ServiceLevelObjective, "monitors");
  addList(ScheduledMaintenance, "monitors");
  addList(ScheduledMaintenance, "statusPages");
  addList(Incident, "monitors");
  addList(Incident, "statusPages");
  addList(Monitor, "dependsOnMonitors");
  addList(Monitor, "services");

  for (const referrer of [...MONITOR_RULES, ...MONITOR_TEMPLATES]) {
    addList(referrer.model, "monitors");
  }

  for (const referrer of POLICY_RULES) {
    addList(referrer.model, "onCallDutyPolicies");
  }

  for (const other of POLICY_OTHERS) {
    addList(other.referrer.model, other.list);
  }

  for (const model of [
    ServiceLevelObjectiveBurnRateRule,
    ServiceLevelObjectiveErrorBudgetPolicyTier,
  ]) {
    for (const list of SLO_PAGING_LISTS) {
      addList(model, list);
    }
  }

  for (const referrer of Object.values(LABELLED) as Array<Referrer>) {
    addList(referrer.model, "labels");
  }

  for (const owner of OWNER_TABLES) {
    tables.add(owner.ownerTable);
    tables.add(owner.ownedTable);
  }

  return Array.from(tables).sort();
}

// Written on every record that has the column, as the product writes them.
const LIVE_RECORD: () => Dictionary<unknown> = (): Dictionary<unknown> => {
  return {
    isArchived: false,
    isEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  };
};

describePostgres("what uses a record, counted by Postgres (#7436)", () => {
  const schema: string = `used_by_${newId().replace(/-/g, "")}`;
  const queryLog: RecordingLogger = new RecordingLogger();
  let database: DataSource;
  // The columns of each cloned table, so a fixture names only real ones.
  const columnsOf: Map<string, Set<string>> = new Map<string, Set<string>>();
  // The maintenance states of each project, written once.
  const statesOf: Map<string, { scheduled: string; ended: string }> = new Map<
    string,
    { scheduled: string; ended: string }
  >();
  // The incident states of each project, written once.
  const incidentStatesOf: Map<string, { open: string; resolved: string }> =
    new Map<string, { open: string; resolved: string }>();

  const hasColumn: (table: string, column: string) => boolean = (
    table: string,
    column: string,
  ): boolean => {
    return Boolean(columnsOf.get(table)?.has(column));
  };

  // A row of `table`: every value must be one of its columns.
  const insert: (
    table: string,
    values: Dictionary<unknown>,
  ) => Promise<void> = async (
    table: string,
    values: Dictionary<unknown>,
  ): Promise<void> => {
    const columns: Set<string> | undefined = columnsOf.get(table);

    if (!columns) {
      throw new Error(`${table} was not cloned.`);
    }

    const keys: Array<string> = Object.keys(values);
    const unknown: Array<string> = keys.filter((key: string): boolean => {
      return !columns.has(key);
    });

    if (unknown.length > 0) {
      throw new Error(`${table} has no ${unknown.join(", ")}.`);
    }

    await database.query(
      `INSERT INTO "${schema}"."${table}" (${keys
        .map((key: string): string => {
          return `"${key}"`;
        })
        .join(", ")}) VALUES (${keys
        .map((_key: string, index: number): string => {
          return `$${index + 1}`;
        })
        .join(", ")})`,
      keys.map((key: string): unknown => {
        const value: unknown = values[key];
        return value !== null &&
          typeof value === "object" &&
          !(value instanceof Date)
          ? JSON.stringify(value)
          : value;
      }),
    );
  };

  // A live record of `table` in the project; returns its id.
  const insertRecord: (
    table: string,
    projectId: string,
    values: Dictionary<unknown>,
  ) => Promise<string> = async (
    table: string,
    projectId: string,
    values: Dictionary<unknown>,
  ): Promise<string> => {
    const rowId: string = newId();
    const live: Dictionary<unknown> = LIVE_RECORD();

    await insert(table, {
      ...Object.fromEntries(
        Object.keys(live)
          .filter((column: string): boolean => {
            return hasColumn(table, column);
          })
          .map((column: string): [string, unknown] => {
            return [column, live[column]];
          }),
      ),
      ...values,
      _id: rowId,
      projectId: projectId,
    });

    return rowId;
  };

  // The list `list` of `ownerId` holds `listedId`: a row of its join table.
  const link: (
    model: ModelType,
    list: string,
    ownerId: string,
    listedId: string,
  ) => Promise<void> = async (
    model: ModelType,
    list: string,
    ownerId: string,
    listedId: string,
  ): Promise<void> => {
    const joinTable: {
      joinTableName: string;
      ownerColumnName: string;
      relationColumnName: string;
    } = getListJoinTable(model, list);

    await insert(joinTable.joinTableName, {
      [joinTable.ownerColumnName]: ownerId,
      [joinTable.relationColumnName]: listedId,
    });
  };

  const insertReferrer: (
    referrer: Referrer,
    projectId: string,
    name: string,
  ) => Promise<string> = async (
    referrer: Referrer,
    projectId: string,
    name: string,
  ): Promise<string> => {
    return await insertRecord(tableOf(referrer.model), projectId, {
      [referrer.nameColumn]: name,
      ...(referrer.values || {}),
    });
  };

  // The four built-in maintenance states of a project, by what they mean.
  const statesFor: (
    projectId: string,
  ) => Promise<{ scheduled: string; ended: string }> = async (
    projectId: string,
  ): Promise<{ scheduled: string; ended: string }> => {
    const written: { scheduled: string; ended: string } | undefined =
      statesOf.get(projectId);

    if (written) {
      return written;
    }

    const scheduled: string = await insertRecord(
      "ScheduledMaintenanceState",
      projectId,
      { name: "Scheduled", isScheduledState: true, order: 1 },
    );
    await insertRecord("ScheduledMaintenanceState", projectId, {
      name: "Ongoing",
      isOngoingState: true,
      order: 2,
    });
    const ended: string = await insertRecord(
      "ScheduledMaintenanceState",
      projectId,
      { name: "Ended", isEndedState: true, order: 3 },
    );
    await insertRecord("ScheduledMaintenanceState", projectId, {
      name: "Completed",
      isResolvedState: true,
      order: 4,
    });

    const states: { scheduled: string; ended: string } = {
      scheduled: scheduled,
      ended: ended,
    };
    statesOf.set(projectId, states);
    return states;
  };

  // A project's incident states: Identified, then Resolved.
  const incidentStatesFor: (
    projectId: string,
  ) => Promise<{ open: string; resolved: string }> = async (
    projectId: string,
  ): Promise<{ open: string; resolved: string }> => {
    const written: { open: string; resolved: string } | undefined =
      incidentStatesOf.get(projectId);

    if (written) {
      return written;
    }

    const states: { open: string; resolved: string } = {
      open: await insertRecord("IncidentState", projectId, {
        name: "Identified",
        isCreatedState: true,
        order: 1,
      }),
      resolved: await insertRecord("IncidentState", projectId, {
        name: "Resolved",
        isResolvedState: true,
        order: 2,
      }),
    };
    incidentStatesOf.set(projectId, states);
    return states;
  };

  // An incident on `monitorId`, as a monitor or a person declares it.
  const insertIncident: (data: {
    projectId: string;
    monitorId: string;
    title: string;
    stateId: string;
    values?: Dictionary<unknown> | undefined;
    scopedTo?: Array<string> | undefined;
  }) => Promise<string> = async (data: {
    projectId: string;
    monitorId: string;
    title: string;
    stateId: string;
    values?: Dictionary<unknown> | undefined;
    scopedTo?: Array<string> | undefined;
  }): Promise<string> => {
    const incidentId: string = await insertRecord("Incident", data.projectId, {
      title: data.title,
      currentIncidentStateId: data.stateId,
      isVisibleOnStatusPage: true,
      isPrivate: false,
      isScopedToStatusPages: Boolean(data.scopedTo),
      ...(data.values || {}),
    });
    await link(Incident, "monitors", incidentId, data.monitorId);

    for (const statusPageId of data.scopedTo || []) {
      await link(Incident, "statusPages", incidentId, statusPageId);
    }

    return incidentId;
  };

  // The team owns one record of `owner`'s kind.
  const writeOwned: (
    owner: OwnerTable,
    teamId: string,
    projectId: string,
    name: string,
  ) => Promise<string> = async (
    owner: OwnerTable,
    teamId: string,
    projectId: string,
    name: string,
  ): Promise<string> => {
    const ownedName: string = `${name} ${owner.ownedTable}`;
    const ownedId: string = await insertRecord(owner.ownedTable, projectId, {
      ...(OWNED_RECORD_VALUES[owner.ownedTable]?.(ownedName) || {}),
      [owner.nameColumn]: ownedName,
    });
    await insertRecord(owner.ownerTable, projectId, {
      teamId: teamId,
      [owner.ownedColumns[0] as string]: ownedId,
    });
    return ownedId;
  };

  interface EscalationRule {
    name: string;
    order: number;
  }

  // A policy whose escalation rules page the record through `table`.
  const writePagingPolicy: (data: {
    table: string;
    column: string;
    recordId: string;
    projectId: string;
    name: string;
    rules?: Array<EscalationRule> | undefined;
  }) => Promise<string> = async (data: {
    table: string;
    column: string;
    recordId: string;
    projectId: string;
    name: string;
    rules?: Array<EscalationRule> | undefined;
  }): Promise<string> => {
    const policyId: string = await insertRecord(
      "OnCallDutyPolicy",
      data.projectId,
      { name: data.name },
    );

    for (const rule of data.rules || [{ name: "Primary", order: 1 }]) {
      const ruleId: string = await insertRecord(
        "OnCallDutyPolicyEscalationRule",
        data.projectId,
        { name: rule.name, order: rule.order, onCallDutyPolicyId: policyId },
      );
      await insertRecord(data.table, data.projectId, {
        onCallDutyPolicyId: policyId,
        onCallDutyPolicyEscalationRuleId: ruleId,
        [data.column]: data.recordId,
      });
    }

    return policyId;
  };

  /*
   * Writes what refers to `recordId` by `relation`, in `projectId`, the way
   * the product writes it, and returns the ids of the rows that refer - one
   * per kind of a family, in its order. Rows that look like they refer but
   * do not (an event that is over, one kept off status pages) are written
   * alongside, and not returned.
   */
  const writeReferrers: (data: {
    relation: UsedByRelation;
    recordId: string;
    projectId: string;
    tag: string;
  }) => Promise<Array<string>> = async (data: {
    relation: UsedByRelation;
    recordId: string;
    projectId: string;
    tag: string;
  }): Promise<Array<string>> => {
    const recordId: string = data.recordId;
    const projectId: string = data.projectId;
    const name: string = `${data.relation} ${data.tag}`;

    switch (data.relation) {
      case UsedByRelation.MonitorStatusPages: {
        // One page lists the monitor; another, a group it is in.
        const direct: string = await insertRecord("StatusPage", projectId, {
          name: `${name} direct`,
        });
        await insertRecord("StatusPageResource", projectId, {
          statusPageId: direct,
          monitorId: recordId,
        });
        const groupId: string = await insertRecord("MonitorGroup", projectId, {
          name: `${name} group`,
        });
        await insertRecord("MonitorGroupResource", projectId, {
          monitorGroupId: groupId,
          monitorId: recordId,
        });
        const throughGroup: string = await insertRecord(
          "StatusPage",
          projectId,
          { name: `${name} through its group` },
        );
        await insertRecord("StatusPageResource", projectId, {
          statusPageId: throughGroup,
          monitorGroupId: groupId,
        });
        return [direct, throughGroup];
      }
      case UsedByRelation.MonitorGroups: {
        const groupId: string = await insertRecord("MonitorGroup", projectId, {
          name: name,
        });
        await insertRecord("MonitorGroupResource", projectId, {
          monitorGroupId: groupId,
          monitorId: recordId,
        });
        return [groupId];
      }
      case UsedByRelation.MonitorSlos: {
        const sloId: string = await insertRecord(
          "ServiceLevelObjective",
          projectId,
          { name: name },
        );
        await link(ServiceLevelObjective, "monitors", sloId, recordId);
        return [sloId];
      }
      case UsedByRelation.MonitorScheduledMaintenance: {
        const states: { scheduled: string; ended: string } =
          await statesFor(projectId);
        const coming: string = await insertRecord(
          "ScheduledMaintenance",
          projectId,
          { title: name, currentScheduledMaintenanceStateId: states.scheduled },
        );
        await link(ScheduledMaintenance, "monitors", coming, recordId);
        // An event that has ended names it too, and is no longer counted.
        const over: string = await insertRecord(
          "ScheduledMaintenance",
          projectId,
          {
            title: `${name} over`,
            currentScheduledMaintenanceStateId: states.ended,
          },
        );
        await link(ScheduledMaintenance, "monitors", over, recordId);
        return [coming];
      }
      case UsedByRelation.MonitorDependents: {
        const dependent: string = await insertRecord("Monitor", projectId, {
          name: name,
        });
        await link(Monitor, "dependsOnMonitors", dependent, recordId);
        return [dependent];
      }
      case UsedByRelation.MonitorWorkflows:
      case UsedByRelation.OnCallPolicyWorkflows: {
        // A step's arguments name the record.
        const workflowId: string = await insertRecord("Workflow", projectId, {
          name: name,
          graph: {
            nodes: [{ id: "step-1", data: { arguments: { id: recordId } } }],
          },
        });
        return [workflowId];
      }
      case UsedByRelation.MonitorDashboards:
      case UsedByRelation.SloDashboards: {
        // A widget's filter names the record.
        const dashboardId: string = await insertRecord("Dashboard", projectId, {
          name: name,
          dashboardViewConfig: {
            components: [{ arguments: { filter: { id: recordId } } }],
          },
        });
        return [dashboardId];
      }
      case UsedByRelation.MonitorRules: {
        const rows: Array<string> = [];
        for (const referrer of MONITOR_RULES) {
          const ruleId: string = await insertReferrer(
            referrer,
            projectId,
            name,
          );
          await link(referrer.model, "monitors", ruleId, recordId);
          rows.push(ruleId);
        }
        return rows;
      }
      case UsedByRelation.MonitorTemplates: {
        const rows: Array<string> = [];
        for (const referrer of MONITOR_TEMPLATES) {
          const templateId: string = await insertReferrer(
            referrer,
            projectId,
            name,
          );
          await link(referrer.model, "monitors", templateId, recordId);
          rows.push(templateId);
        }
        return rows;
      }
      case UsedByRelation.ScheduleOnCallPolicies: {
        return [
          await writePagingPolicy({
            table: "OnCallDutyPolicyEscalationRuleSchedule",
            column: "onCallDutyPolicyScheduleId",
            recordId: recordId,
            projectId: projectId,
            name: name,
          }),
        ];
      }
      case UsedByRelation.TeamOnCallPolicies: {
        return [
          await writePagingPolicy({
            table: "OnCallDutyPolicyEscalationRuleTeam",
            column: "teamId",
            recordId: recordId,
            projectId: projectId,
            name: name,
          }),
        ];
      }
      case UsedByRelation.ServiceMonitors: {
        const monitorId: string = await insertRecord("Monitor", projectId, {
          name: name,
        });
        await link(Monitor, "services", monitorId, recordId);
        return [monitorId];
      }
      case UsedByRelation.ServiceSlos: {
        const watcher: string = await insertRecord("Monitor", projectId, {
          name: `${name} watcher`,
        });
        await link(Monitor, "services", watcher, recordId);
        const sloId: string = await insertRecord(
          "ServiceLevelObjective",
          projectId,
          { name: name },
        );
        await link(ServiceLevelObjective, "monitors", sloId, watcher);
        return [sloId];
      }
      case UsedByRelation.StatusPageMaintenance: {
        const states: { scheduled: string; ended: string } =
          await statesFor(projectId);
        const shown: string = await insertRecord(
          "ScheduledMaintenance",
          projectId,
          {
            title: name,
            currentScheduledMaintenanceStateId: states.scheduled,
            isVisibleOnStatusPage: true,
          },
        );
        await link(ScheduledMaintenance, "statusPages", shown, recordId);
        // Named on the page, but kept off status pages: not shown on it.
        const hidden: string = await insertRecord(
          "ScheduledMaintenance",
          projectId,
          {
            title: `${name} hidden`,
            currentScheduledMaintenanceStateId: states.scheduled,
            isVisibleOnStatusPage: false,
          },
        );
        await link(ScheduledMaintenance, "statusPages", hidden, recordId);
        // Published on status pages only tomorrow: not shown yet.
        const later: string = await insertRecord(
          "ScheduledMaintenance",
          projectId,
          {
            title: `${name} published later`,
            currentScheduledMaintenanceStateId: states.scheduled,
            isVisibleOnStatusPage: true,
            publishOnStatusPageAt: new Date(Date.now() + 86_400_000),
          },
        );
        await link(ScheduledMaintenance, "statusPages", later, recordId);
        return [shown];
      }
      case UsedByRelation.StatusPageOpenIncidents: {
        const states: { open: string; resolved: string } =
          await incidentStatesFor(projectId);
        // A monitor the page lists, and one in a group the page lists.
        const listed: string = await insertRecord("Monitor", projectId, {
          name: `${name} listed`,
        });
        await insertRecord("StatusPageResource", projectId, {
          statusPageId: recordId,
          monitorId: listed,
        });
        const inGroup: string = await insertRecord("Monitor", projectId, {
          name: `${name} in a group`,
        });
        const groupId: string = await insertRecord("MonitorGroup", projectId, {
          name: `${name} group`,
        });
        await insertRecord("MonitorGroupResource", projectId, {
          monitorGroupId: groupId,
          monitorId: inGroup,
        });
        await insertRecord("StatusPageResource", projectId, {
          statusPageId: recordId,
          monitorGroupId: groupId,
        });

        const shown: Array<string> = [
          await insertIncident({
            projectId: projectId,
            monitorId: listed,
            title: name,
            stateId: states.open,
          }),
          await insertIncident({
            projectId: projectId,
            monitorId: inGroup,
            title: `${name} in the group`,
            stateId: states.open,
          }),
          // Scoped to this page: shown on it.
          await insertIncident({
            projectId: projectId,
            monitorId: listed,
            title: `${name} scoped here`,
            stateId: states.open,
            scopedTo: [recordId],
          }),
        ];

        // On a monitor it lists, yet not shown on it.
        await insertIncident({
          projectId: projectId,
          monitorId: listed,
          title: `${name} resolved`,
          stateId: states.resolved,
        });
        await insertIncident({
          projectId: projectId,
          monitorId: listed,
          title: `${name} kept off status pages`,
          stateId: states.open,
          values: { isVisibleOnStatusPage: false },
        });
        // Private: never shown, even were it stored visible.
        await insertIncident({
          projectId: projectId,
          monitorId: listed,
          title: `${name} private`,
          stateId: states.open,
          values: { isPrivate: true },
        });
        await insertIncident({
          projectId: projectId,
          monitorId: listed,
          title: `${name} scoped to another page`,
          stateId: states.open,
          scopedTo: [newId()],
        });
        return shown;
      }
      case UsedByRelation.TeamOwnedOther: {
        const rows: Array<string> = [];
        for (const owner of OTHER_OWNER_TABLES) {
          rows.push(await writeOwned(owner, recordId, projectId, name));
        }
        return rows;
      }
      case UsedByRelation.OnCallPolicyRules: {
        const rows: Array<string> = [];
        for (const referrer of POLICY_RULES) {
          const ruleId: string = await insertReferrer(
            referrer,
            projectId,
            name,
          );
          await link(referrer.model, "onCallDutyPolicies", ruleId, recordId);
          rows.push(ruleId);
        }
        return rows;
      }
      case UsedByRelation.OnCallPolicyMonitors: {
        // A criteria's incident pages the policy.
        const monitorId: string = await insertRecord("Monitor", projectId, {
          name: name,
          monitorSteps: {
            monitorStepsInstanceArray: [
              {
                monitorCriteria: {
                  monitorCriteriaInstanceArray: [
                    { incidents: [{ onCallPolicyIds: [recordId] }] },
                  ],
                },
              },
            ],
          },
        });
        return [monitorId];
      }
      case UsedByRelation.OnCallPolicyOther: {
        const rows: Array<string> = [];
        for (const other of POLICY_OTHERS) {
          const rowId: string = await insertReferrer(
            other.referrer,
            projectId,
            name,
          );
          await link(other.referrer.model, other.list, rowId, recordId);
          rows.push(rowId);
        }
        return rows;
      }
      case UsedByRelation.MonitorGroupStatusPages: {
        const pageId: string = await insertRecord("StatusPage", projectId, {
          name: name,
        });
        await insertRecord("StatusPageResource", projectId, {
          statusPageId: pageId,
          monitorGroupId: recordId,
        });
        return [pageId];
      }
      case UsedByRelation.MonitorGroupSlos: {
        const member: string = await insertRecord("Monitor", projectId, {
          name: `${name} member`,
        });
        await insertRecord("MonitorGroupResource", projectId, {
          monitorGroupId: recordId,
          monitorId: member,
        });
        const sloId: string = await insertRecord(
          "ServiceLevelObjective",
          projectId,
          { name: name },
        );
        await link(ServiceLevelObjective, "monitors", sloId, member);
        return [sloId];
      }
      case UsedByRelation.SloBurnRateRules:
      case UsedByRelation.SloErrorBudgetPolicies: {
        const table: string = tableOf(
          data.relation === UsedByRelation.SloBurnRateRules
            ? ServiceLevelObjectiveBurnRateRule
            : ServiceLevelObjectiveErrorBudgetPolicyTier,
        );
        return [
          await insertRecord(table, projectId, {
            name: name,
            serviceLevelObjectiveId: recordId,
          }),
        ];
      }
      default: {
        const ownerTable: string | undefined =
          OWNED_ON_THEIR_OWN_LINES[data.relation];

        if (ownerTable) {
          const owner: OwnerTable | undefined = OWNER_TABLES.find(
            (each: OwnerTable): boolean => {
              return each.ownerTable === ownerTable;
            },
          );

          if (!owner) {
            throw new Error(`${ownerTable} is not a model.`);
          }

          return [await writeOwned(owner, recordId, projectId, name)];
        }

        const labelled: Referrer | undefined = LABELLED[data.relation];

        if (!labelled) {
          throw new Error(`No fixture says how ${data.relation} refers.`);
        }

        const rowId: string = await insertReferrer(labelled, projectId, name);
        await link(labelled.model, "labels", rowId, recordId);
        return [rowId];
      }
    }
  };

  interface Grant {
    permission: Permission;
    labelIds?: Array<string> | undefined;
    isBlockPermission?: boolean | undefined;
  }

  // A member of the project holding `grants`, as a request carries them.
  const readerOf: (
    projectId: string,
    grants: Array<Grant>,
  ) => DatabaseCommonInteractionProps = (
    projectId: string,
    grants: Array<Grant>,
  ): DatabaseCommonInteractionProps => {
    const tenantId: ObjectID = new ObjectID(projectId);

    return {
      tenantId: tenantId,
      userId: ObjectID.generate(),
      userType: UserType.User,
      ...ON_HIGHEST_PLAN,
      userTenantAccessPermission: {
        [projectId]: {
          _type: "UserTenantAccessPermission",
          projectId: tenantId,
          permissions: grants.map((grant: Grant): UserPermission => {
            return {
              _type: "UserPermission",
              permission: grant.permission,
              labelIds: (grant.labelIds || []).map(
                (labelId: string): ObjectID => {
                  return new ObjectID(labelId);
                },
              ),
              isBlockPermission: Boolean(grant.isBlockPermission),
            };
          }),
        },
      },
    };
  };

  const ownerOf: (projectId: string) => DatabaseCommonInteractionProps = (
    projectId: string,
  ): DatabaseCommonInteractionProps => {
    return readerOf(projectId, [{ permission: Permission.ProjectOwner }]);
  };

  function groupOf<TGroup extends UsedByCounts>(
    groups: Array<TGroup>,
    relation: UsedByRelation,
  ): TGroup {
    const group: TGroup | undefined = groups.find((each: TGroup): boolean => {
      return each.relation === relation;
    });

    if (!group) {
      throw new Error(`The summary has no ${relation}.`);
    }

    return group;
  }

  const idsOf: (rows: Array<UsedByRow>) => Array<string> = (
    rows: Array<UsedByRow>,
  ): Array<string> => {
    return rows
      .map((row: UsedByRow): string => {
        return row.id;
      })
      .sort();
  };

  interface Asked {
    kind: UsedByRecordKind;
    recordId: string;
    projectId: string;
  }

  const summaryOf: (
    asked: Asked,
    props?: DatabaseCommonInteractionProps,
  ) => Promise<UsedBySummary> = async (
    asked: Asked,
    props?: DatabaseCommonInteractionProps,
  ): Promise<UsedBySummary> => {
    return await UsedByService.getSummary({
      recordKind: asked.kind,
      recordId: new ObjectID(asked.recordId),
      projectId: new ObjectID(asked.projectId),
      props: props || ownerOf(asked.projectId),
    });
  };

  // Every row of one relation, as its dialog pages them (100 at most).
  const pageOf: (
    asked: Asked,
    relation: UsedByRelation,
  ) => Promise<UsedByPage> = async (
    asked: Asked,
    relation: UsedByRelation,
  ): Promise<UsedByPage> => {
    return await UsedByService.getPage({
      recordKind: asked.kind,
      recordId: new ObjectID(asked.recordId),
      relation: relation,
      projectId: new ObjectID(asked.projectId),
      props: ownerOf(asked.projectId),
      limit: 100,
    });
  };

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["USED_BY_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["USED_BY_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["USED_BY_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema: schema,
      synchronize: false,
      logging: ["query"],
      logger: queryLog,
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    // public.<table>'s columns, defaults, NOT NULLs and indexes - no keys.
    for (const table of tablesToClone()) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );

      const columns: Array<{
        column_name: string;
        is_nullable: string;
        in_primary_key: boolean;
      }> = await database.query(
        `SELECT c.column_name, c.is_nullable,
                EXISTS (
                  SELECT 1
                    FROM information_schema.table_constraints t
                    JOIN information_schema.key_column_usage k
                      ON k.constraint_name = t.constraint_name
                     AND k.table_schema = t.table_schema
                     AND k.table_name = t.table_name
                   WHERE t.table_schema = c.table_schema
                     AND t.table_name = c.table_name
                     AND t.constraint_type = 'PRIMARY KEY'
                     AND k.column_name = c.column_name
                ) AS in_primary_key
           FROM information_schema.columns c
          WHERE c.table_schema = $1 AND c.table_name = $2`,
        [schema, table],
      );

      columnsOf.set(
        table,
        new Set<string>(
          columns.map((column: { column_name: string }): string => {
            return column.column_name;
          }),
        ),
      );

      // A fixture writes only what the SQL under test reads (a key, always).
      for (const column of columns) {
        if (column.is_nullable === "NO" && !column.in_primary_key) {
          await database.query(
            `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
          );
        }
      }
    }
  }, 600_000);

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(() => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    queryLog.recording = false;
    queryLog.queries = [];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const RELATIONS: Array<{
    kind: UsedByRecordKind;
    relation: UsedByRelation;
    description: UsedByRelationDescription;
  }> = Object.values(UsedByRecordKind).flatMap((kind: UsedByRecordKind) => {
    return USED_BY_RELATIONS[kind].map(
      (description: UsedByRelationDescription) => {
        return {
          kind: kind,
          relation: description.relation,
          description: description,
        };
      },
    );
  });

  test("every owner table of a team names one record, of a kind that is a table", () => {
    const tables: Array<string> = (Entities as Array<ModelType>).map(tableOf);

    expect(
      OWNER_TABLES.filter((owner: OwnerTable): boolean => {
        return (
          owner.ownedColumns.length !== 1 || !tables.includes(owner.ownedTable)
        );
      }),
    ).toEqual([]);
    // Five on lines of their own, every other one a part of the rest.
    expect(OTHER_OWNER_TABLES).toHaveLength(
      OWNER_TABLES.length - Object.keys(OWNED_ON_THEIR_OWN_LINES).length,
    );
  });

  test.each(RELATIONS)(
    "$kind: $relation counts what refers to the record in its project, and nothing else",
    async ({
      kind,
      description,
    }: {
      kind: UsedByRecordKind;
      description: UsedByRelationDescription;
    }) => {
      const projectId: string = newId();
      const recordTable: string = RECORD_TABLES[kind];
      // A page shows incidents and maintenance only while it shows them at all.
      const recordValues: Dictionary<unknown> =
        kind === UsedByRecordKind.StatusPage
          ? {
              showIncidentsOnStatusPage: true,
              onlyShowScopedIncidents: false,
              showScheduledMaintenanceEventsOnStatusPage: true,
            }
          : {};

      const recordId: string = await insertRecord(recordTable, projectId, {
        name: `${description.relation} record`,
        ...recordValues,
      });
      const otherRecordId: string = await insertRecord(recordTable, projectId, {
        name: `${description.relation} other record`,
        ...recordValues,
      });

      const referring: Array<string> = await writeReferrers({
        relation: description.relation,
        recordId: recordId,
        projectId: projectId,
        tag: "refers",
      });
      // What refers to another record of the project.
      await writeReferrers({
        relation: description.relation,
        recordId: otherRecordId,
        projectId: projectId,
        tag: "refers to another record",
      });
      // Rows of another project that name the record's id.
      await writeReferrers({
        relation: description.relation,
        recordId: recordId,
        projectId: newId(),
        tag: "in another project",
      });

      const asked: Asked = {
        kind: kind,
        recordId: recordId,
        projectId: projectId,
      };
      const group: UsedByGroup = groupOf(
        (await summaryOf(asked)).groups,
        description.relation,
      );

      expect({ count: group.count, hiddenCount: group.hiddenCount }).toEqual({
        count: referring.length,
        hiddenCount: 0,
      });
      expect(group.rows).toHaveLength(
        Math.min(referring.length, USED_BY_PREVIEW_ROW_COUNT),
      );

      // Every one of them, as its dialog lists them: each once.
      const page: UsedByPage = await pageOf(asked, description.relation);

      expect(page.count).toBe(referring.length);
      expect(idsOf(page.rows)).toEqual([...referring].sort());

      if (description.family) {
        // Each kind of a family counted apart, once.
        expect(
          (group.parts || []).map((part: UsedByGroupPart): number => {
            return part.count;
          }),
        ).toEqual(
          referring.map((): number => {
            return 1;
          }),
        );
      }
    },
    300_000,
  );

  test.each([
    {
      kind: UsedByRecordKind.OnCallSchedule,
      recordTable: "OnCallDutyPolicySchedule",
      table: "OnCallDutyPolicyEscalationRuleSchedule",
      column: "onCallDutyPolicyScheduleId",
      relation: UsedByRelation.ScheduleOnCallPolicies,
    },
    {
      kind: UsedByRecordKind.Team,
      recordTable: "Team",
      table: "OnCallDutyPolicyEscalationRuleTeam",
      column: "teamId",
      relation: UsedByRelation.TeamOnCallPolicies,
    },
  ])(
    "$kind: a policy says which of its escalation rules page it, in their order",
    async (paged: {
      kind: UsedByRecordKind;
      recordTable: string;
      table: string;
      column: string;
      relation: UsedByRelation;
    }) => {
      const projectId: string = newId();
      const recordId: string = await insertRecord(
        paged.recordTable,
        projectId,
        { name: "Weekend rota" },
      );
      const policyId: string = await writePagingPolicy({
        table: paged.table,
        column: paged.column,
        recordId: recordId,
        projectId: projectId,
        name: "Payments on-call",
        // Written last first: the detail follows the order they escalate in.
        rules: [
          { name: "Second line", order: 2 },
          { name: "Primary", order: 1 },
        ],
      });

      const policies: UsedByGroup = groupOf(
        (
          await summaryOf({
            kind: paged.kind,
            recordId: recordId,
            projectId: projectId,
          })
        ).groups,
        paged.relation,
      );

      // One policy, however many of its rules page the record.
      expect(policies.count).toBe(1);
      expect(policies.rows).toEqual([
        expect.objectContaining({
          id: policyId,
          name: "Payments on-call",
          detail: "Primary, Second line",
        }),
      ]);
    },
  );

  test("a rule switched off, and an AI rule for alerts, say so on their rows", async () => {
    const projectId: string = newId();
    const monitorId: string = await insertRecord("Monitor", projectId, {
      name: "Checkout",
    });
    const off: string = await insertRecord(
      tableOf(IncidentOnCallRule),
      projectId,
      { name: "Night paging", isEnabled: false },
    );
    await link(IncidentOnCallRule, "monitors", off, monitorId);
    const forAlerts: string = await insertRecord(
      tableOf(AutoRemediationRule),
      projectId,
      { name: "Restart on alert", triggerEntityType: "Alert" },
    );
    await link(AutoRemediationRule, "monitors", forAlerts, monitorId);

    const page: UsedByPage = await pageOf(
      { kind: UsedByRecordKind.Monitor, recordId: monitorId, projectId },
      UsedByRelation.MonitorRules,
    );
    const rowOf: (id: string) => UsedByRow | undefined = (
      id: string,
    ): UsedByRow | undefined => {
      return page.rows.find((row: UsedByRow): boolean => {
        return row.id === id;
      });
    };

    expect(rowOf(off)).toEqual(
      expect.objectContaining({
        rowKind: UsedByRowKind.IncidentOnCallRule,
        isOff: true,
      }),
    );
    expect(rowOf(forAlerts)).toEqual(
      expect.objectContaining({ rowKind: UsedByRowKind.AlertAiRule }),
    );
    expect(rowOf(forAlerts)?.isOff).toBeFalsy();
  });

  test("an SLO's burn-rate rule that pages a policy opens its SLO's page", async () => {
    const projectId: string = newId();
    const policyId: string = await insertRecord("OnCallDutyPolicy", projectId, {
      name: "SRE on-call",
    });
    const sloId: string = await insertRecord(
      "ServiceLevelObjective",
      projectId,
      { name: "Checkout availability" },
    );
    const ruleId: string = await insertRecord(
      tableOf(ServiceLevelObjectiveBurnRateRule),
      projectId,
      { name: "Fast burn", serviceLevelObjectiveId: sloId },
    );
    await link(
      ServiceLevelObjectiveBurnRateRule,
      "onCallDutyPolicies",
      ruleId,
      policyId,
    );

    const page: UsedByPage = await pageOf(
      { kind: UsedByRecordKind.OnCallPolicy, recordId: policyId, projectId },
      UsedByRelation.OnCallPolicyOther,
    );

    expect(page.rows).toEqual([
      expect.objectContaining({
        id: ruleId,
        name: "Fast burn",
        rowKind: UsedByRowKind.SloBurnRateRule,
        linkId: sloId,
      }),
    ]);
  });

  test("a selection is counted once for all its records: a page that shows two of them is one page", async () => {
    const projectId: string = newId();
    const first: string = await insertRecord("Monitor", projectId, {
      name: "Selected one",
    });
    const second: string = await insertRecord("Monitor", projectId, {
      name: "Selected two",
    });
    const both: string = await insertRecord("StatusPage", projectId, {
      name: "Shows both",
    });

    for (const monitorId of [first, second]) {
      await insertRecord("StatusPageResource", projectId, {
        statusPageId: both,
        monitorId: monitorId,
      });
    }

    const onlySecond: string = await insertRecord("StatusPage", projectId, {
      name: "Shows the second",
    });
    await insertRecord("StatusPageResource", projectId, {
      statusPageId: onlySecond,
      monitorId: second,
    });

    // A monitor of another project, selected too: not counted.
    const elsewhere: string = await insertRecord("Monitor", newId(), {
      name: "Another project's",
    });

    const summary: UsedByBulkSummary = await UsedByService.getSummaries({
      recordKind: UsedByRecordKind.Monitor,
      recordIds: [first, second, elsewhere].map((id: string): ObjectID => {
        return new ObjectID(id);
      }),
      projectId: new ObjectID(projectId),
      props: ownerOf(projectId),
    });

    expect(summary.recordCount).toBe(2);
    expect(
      groupOf(summary.groups, UsedByRelation.MonitorStatusPages),
    ).toMatchObject({ count: 2, hiddenCount: 0 });
  });

  describe("a reader whose role a label decides", () => {
    interface Seeded {
      projectId: string;
      monitorId: string;
      labelId: string;
      labelled: string;
      plain: string;
    }

    // A monitor two status pages show, one of them carrying the label.
    const seed: () => Promise<Seeded> = async (): Promise<Seeded> => {
      const projectId: string = newId();
      const labelId: string = await insertRecord("Label", projectId, {
        name: "payments",
      });
      const monitorId: string = await insertRecord("Monitor", projectId, {
        name: "Checkout",
      });
      const labelled: string = await insertRecord("StatusPage", projectId, {
        name: "Payments status",
      });
      await link(StatusPage, "labels", labelled, labelId);
      const plain: string = await insertRecord("StatusPage", projectId, {
        name: "Public status",
      });

      for (const pageId of [labelled, plain]) {
        await insertRecord("StatusPageResource", projectId, {
          statusPageId: pageId,
          monitorId: monitorId,
        });
      }

      return {
        projectId: projectId,
        monitorId: monitorId,
        labelId: labelId,
        labelled: labelled,
        plain: plain,
      };
    };

    const pagesSeenBy: (
      seeded: Seeded,
      grants: Array<Grant>,
    ) => Promise<UsedByGroup> = async (
      seeded: Seeded,
      grants: Array<Grant>,
    ): Promise<UsedByGroup> => {
      return groupOf(
        (
          await summaryOf(
            {
              kind: UsedByRecordKind.Monitor,
              recordId: seeded.monitorId,
              projectId: seeded.projectId,
            },
            readerOf(seeded.projectId, grants),
          )
        ).groups,
        UsedByRelation.MonitorStatusPages,
      );
    };

    test("limited to the label: sees the page that carries it, and is told of the other without its name", async () => {
      const seeded: Seeded = await seed();
      // The monitor carries it too, so the reader may ask about it at all.
      await link(Monitor, "labels", seeded.monitorId, seeded.labelId);

      const pages: UsedByGroup = await pagesSeenBy(seeded, [
        { permission: Permission.ProjectMember, labelIds: [seeded.labelId] },
      ]);

      expect({ count: pages.count, hiddenCount: pages.hiddenCount }).toEqual({
        count: 1,
        hiddenCount: 1,
      });
      expect(idsOf(pages.rows)).toEqual([seeded.labelled]);
    });

    test("blocked from the label: sees the page without it, and is told of the other without its name", async () => {
      const seeded: Seeded = await seed();

      const pages: UsedByGroup = await pagesSeenBy(seeded, [
        { permission: Permission.ProjectMember },
        {
          permission: Permission.ProjectMember,
          labelIds: [seeded.labelId],
          isBlockPermission: true,
        },
      ]);

      expect({ count: pages.count, hiddenCount: pages.hiddenCount }).toEqual({
        count: 1,
        hiddenCount: 1,
      });
      expect(idsOf(pages.rows)).toEqual([seeded.plain]);
    });
  });

  test("a monitor 5,000 status pages show: two counts and one page of three of them", async () => {
    const projectId: string = newId();
    const monitorId: string = await insertRecord("Monitor", projectId, {
      name: "Popular",
    });
    const valueOf: Dictionary<string> = {
      _id: "gen_random_uuid()",
      projectId: "$1::uuid",
      name: "'Page ' || n",
      isArchived: "false",
      version: "1",
    };
    const pageColumns: Array<string> = Object.keys(valueOf).filter(
      (column: string): boolean => {
        return hasColumn("StatusPage", column);
      },
    );

    await database.query(
      `INSERT INTO "${schema}"."StatusPage" (${pageColumns
        .map((column: string): string => {
          return `"${column}"`;
        })
        .join(", ")}) SELECT ${pageColumns
        .map((column: string): string => {
          return valueOf[column] as string;
        })
        .join(", ")} FROM generate_series(1, 5000) AS n`,
      [projectId],
    );
    await database.query(
      `INSERT INTO "${schema}"."StatusPageResource" ("_id", "projectId", "statusPageId", "monitorId")
       SELECT gen_random_uuid(), $1::uuid, "_id", $2::uuid FROM "${schema}"."StatusPage" WHERE "projectId" = $1::uuid`,
      [projectId, monitorId],
    );

    queryLog.recording = true;
    const summary: UsedBySummary = await summaryOf({
      kind: UsedByRecordKind.Monitor,
      recordId: monitorId,
      projectId: projectId,
    });
    queryLog.recording = false;

    const pages: UsedByGroup = groupOf(
      summary.groups,
      UsedByRelation.MonitorStatusPages,
    );

    expect(pages.count).toBe(5000);
    expect(pages.rows).toHaveLength(USED_BY_PREVIEW_ROW_COUNT);

    // The reads of the status pages themselves: two counts, then one page.
    expect(
      queryLog.queries
        .filter((query: string): boolean => {
          return STATUS_PAGE_READ.test(query);
        })
        .map((query: string): string => {
          return COUNT_READ.test(query) ? "count" : "page";
        }),
    ).toEqual(["count", "count", "page"]);
  }, 300_000);
});
