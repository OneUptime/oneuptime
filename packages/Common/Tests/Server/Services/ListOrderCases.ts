import DatabaseService from "../../../Server/Services/DatabaseService";
import AIPostmortemRuleService from "../../../Server/Services/AIPostmortemRuleService";
import AlertGroupingRuleService from "../../../Server/Services/AlertGroupingRuleService";
import AlertIncidentRuleService from "../../../Server/Services/AlertIncidentRuleService";
import AlertMeasurementService from "../../../Server/Services/AlertMeasurementService";
import AlertReminderRuleService from "../../../Server/Services/AlertReminderRuleService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import HostCollectorConfigService from "../../../Server/Services/HostCollectorConfigService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import IncidentGroupingRuleService from "../../../Server/Services/IncidentGroupingRuleService";
import IncidentMeasurementService from "../../../Server/Services/IncidentMeasurementService";
import IncidentPostmortemStatusService from "../../../Server/Services/IncidentPostmortemStatusService";
import IncidentReminderRuleService from "../../../Server/Services/IncidentReminderRuleService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import IncidentSlaRuleService from "../../../Server/Services/IncidentSlaRuleService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncomingCallPolicyEscalationRuleService from "../../../Server/Services/IncomingCallPolicyEscalationRuleService";
import LogDropFilterService from "../../../Server/Services/LogDropFilterService";
import LogPipelineProcessorService from "../../../Server/Services/LogPipelineProcessorService";
import LogPipelineService from "../../../Server/Services/LogPipelineService";
import LogScrubRuleService from "../../../Server/Services/LogScrubRuleService";
import MetricPipelineRuleService from "../../../Server/Services/MetricPipelineRuleService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import NetworkDeviceNamingRuleService from "../../../Server/Services/NetworkDeviceNamingRuleService";
import NetworkDeviceRoleService from "../../../Server/Services/NetworkDeviceRoleService";
import NetworkSiteAssignmentRuleService from "../../../Server/Services/NetworkSiteAssignmentRuleService";
import PublicNoteApprovalStepService from "../../../Server/Services/PublicNoteApprovalStepService";
import ScheduledMaintenanceMeasurementService from "../../../Server/Services/ScheduledMaintenanceMeasurementService";
import ScheduledMaintenanceReminderRuleService from "../../../Server/Services/ScheduledMaintenanceReminderRuleService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import SecurityCasePriorityService from "../../../Server/Services/SecurityCasePriorityService";
import SecurityCaseStatusService from "../../../Server/Services/SecurityCaseStatusService";
import StatusPageFooterLinkService from "../../../Server/Services/StatusPageFooterLinkService";
import StatusPageHeaderLinkService from "../../../Server/Services/StatusPageHeaderLinkService";
import StatusPageHistoryChartBarColorRuleService from "../../../Server/Services/StatusPageHistoryChartBarColorRuleService";
import TraceDropFilterService from "../../../Server/Services/TraceDropFilterService";
import TracePipelineProcessorService from "../../../Server/Services/TracePipelineProcessorService";
import TracePipelineService from "../../../Server/Services/TracePipelineService";
import TraceScrubRuleService from "../../../Server/Services/TraceScrubRuleService";
import TeamComplianceSettingService from "../../../Server/Services/TeamComplianceSettingService";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ListOrderSettings } from "../../../Types/Database/ListOrderColumn";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import ObjectID from "../../../Types/ObjectID";
import Color from "../../../Types/Color";
import { getJestSpyOn } from "../../Spy";
import { InMemoryTable, StoredRow } from "../TestingUtils/InMemoryRepository";
import {
  OTHER_PROJECT_ID,
  PROJECT_ID,
  memberProps,
} from "./ContiguousOrderCases";
import Permission from "../../../Types/Permission";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";

/*
 * EVERY LIST PEOPLE PUT IN ORDER BY DRAGGING ITS ROWS (@ListOrderColumn), FOR
 * THE SUITES THAT DRIVE THEIR SERVICES OVER AN IN-MEMORY TABLE (issue
 * #9609).
 *
 * Severities, states, monitor statuses, custom fields, rules, pipelines,
 * filters, status page links: each model's service, and where its list is.
 * The list a row is in is read off the model's own @ListOrderColumn - its
 * number column and the columns that name its list - so a model that gains
 * the decorator is a case here once its service is listed (ListOrderConverges
 * pins the two together). Most lists are a project's rows; the others are a
 * parent's (a status page's links, a pipeline's processors, an incoming call
 * policy's rules) or a project's rows of one kind (a public note approval
 * step's event type).
 */

// The list under test, and a list of another project's.
export const LIST_ID: string = "9b000000-0000-4000-8000-0000000000c1";
export const OTHER_LIST_ID: string = "9b000000-0000-4000-8000-0000000000c2";

export interface ListOrderCase {
  // The model's table, which names the case.
  label: string;
  service: DatabaseService<BaseModel>;
  // The number column, the columns naming the list, and which end is the top.
  settings: ListOrderSettings;
  /*
   * The columns a create of a row needs besides its list and its number,
   * for the lists a suite creates rows of. Left out: the suite only renumbers
   * and moves the rows the table starts with.
   */
  newRowData?: (() => StoredRow) | undefined;
  // The collaborators the service calls that are not under test.
  stubCollaborators?: (() => void) | undefined;
}

// A member who may edit every list: a project admin of PROJECT_ID.
export const listAdminProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return memberProps([Permission.ProjectAdmin]);
  };

// What a project's state, severity or status needs to be created.
const VALUE_DATA: (name: string) => () => StoredRow = (
  name: string,
): (() => StoredRow) => {
  return (): StoredRow => {
    return {
      name: name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      color: new Color("#336699"),
      isArchived: false,
    };
  };
};

// The services, by their model's table.
const SERVICES: Record<string, DatabaseService<BaseModel>> = {
  AIPostmortemRule:
    AIPostmortemRuleService as unknown as DatabaseService<BaseModel>,
  AlertGroupingRule:
    AlertGroupingRuleService as unknown as DatabaseService<BaseModel>,
  AlertIncidentRule:
    AlertIncidentRuleService as unknown as DatabaseService<BaseModel>,
  AlertMeasurement:
    AlertMeasurementService as unknown as DatabaseService<BaseModel>,
  AlertReminderRule:
    AlertReminderRuleService as unknown as DatabaseService<BaseModel>,
  AlertSeverity: AlertSeverityService as unknown as DatabaseService<BaseModel>,
  AlertState: AlertStateService as unknown as DatabaseService<BaseModel>,
  HostCollectorConfig:
    HostCollectorConfigService as unknown as DatabaseService<BaseModel>,
  IncidentCustomField:
    IncidentCustomFieldService as unknown as DatabaseService<BaseModel>,
  IncidentGroupingRule:
    IncidentGroupingRuleService as unknown as DatabaseService<BaseModel>,
  IncidentMeasurement:
    IncidentMeasurementService as unknown as DatabaseService<BaseModel>,
  IncidentPostmortemStatus:
    IncidentPostmortemStatusService as unknown as DatabaseService<BaseModel>,
  IncidentReminderRule:
    IncidentReminderRuleService as unknown as DatabaseService<BaseModel>,
  IncidentSeverity:
    IncidentSeverityService as unknown as DatabaseService<BaseModel>,
  IncidentSlaRule:
    IncidentSlaRuleService as unknown as DatabaseService<BaseModel>,
  IncidentState: IncidentStateService as unknown as DatabaseService<BaseModel>,
  IncomingCallPolicyEscalationRule:
    IncomingCallPolicyEscalationRuleService as unknown as DatabaseService<BaseModel>,
  LogDropFilter: LogDropFilterService as unknown as DatabaseService<BaseModel>,
  LogPipeline: LogPipelineService as unknown as DatabaseService<BaseModel>,
  LogPipelineProcessor:
    LogPipelineProcessorService as unknown as DatabaseService<BaseModel>,
  LogScrubRule: LogScrubRuleService as unknown as DatabaseService<BaseModel>,
  MetricPipelineRule:
    MetricPipelineRuleService as unknown as DatabaseService<BaseModel>,
  MonitorStatus: MonitorStatusService as unknown as DatabaseService<BaseModel>,
  NetworkDeviceNamingRule:
    NetworkDeviceNamingRuleService as unknown as DatabaseService<BaseModel>,
  NetworkDeviceRole:
    NetworkDeviceRoleService as unknown as DatabaseService<BaseModel>,
  NetworkSiteAssignmentRule:
    NetworkSiteAssignmentRuleService as unknown as DatabaseService<BaseModel>,
  PublicNoteApprovalStep:
    PublicNoteApprovalStepService as unknown as DatabaseService<BaseModel>,
  ScheduledMaintenanceMeasurement:
    ScheduledMaintenanceMeasurementService as unknown as DatabaseService<BaseModel>,
  ScheduledMaintenanceReminderRule:
    ScheduledMaintenanceReminderRuleService as unknown as DatabaseService<BaseModel>,
  ScheduledMaintenanceState:
    ScheduledMaintenanceStateService as unknown as DatabaseService<BaseModel>,
  SecurityCasePriority:
    SecurityCasePriorityService as unknown as DatabaseService<BaseModel>,
  SecurityCaseStatus:
    SecurityCaseStatusService as unknown as DatabaseService<BaseModel>,
  StatusPageFooterLink:
    StatusPageFooterLinkService as unknown as DatabaseService<BaseModel>,
  StatusPageHeaderLink:
    StatusPageHeaderLinkService as unknown as DatabaseService<BaseModel>,
  StatusPageHistoryChartBarColorRule:
    StatusPageHistoryChartBarColorRuleService as unknown as DatabaseService<BaseModel>,
  TraceDropFilter:
    TraceDropFilterService as unknown as DatabaseService<BaseModel>,
  TracePipeline: TracePipelineService as unknown as DatabaseService<BaseModel>,
  TracePipelineProcessor:
    TracePipelineProcessorService as unknown as DatabaseService<BaseModel>,
  TraceScrubRule:
    TraceScrubRuleService as unknown as DatabaseService<BaseModel>,
};

/*
 * What a create of a row needs, for the lists the suites create rows of:
 * one of each kind - a project's list kept by the state rules
 * (StateOrderGuard), a monitor status (a new one goes above the offline
 * status), a plain rule list, a pipeline, a parent's list and a list that
 * counts down. (A status page keeps three header links and three footer
 * links at most, so those lists are only renumbered and moved.)
 */
const NEW_ROW_DATA: Record<string, () => StoredRow> = {
  IncidentSeverity: VALUE_DATA("Sev"),
  AlertSeverity: VALUE_DATA("Sev"),
  MonitorStatus: VALUE_DATA("Status"),
  IncidentState: VALUE_DATA("Investigating"),
  StatusPageHistoryChartBarColorRule: (): StoredRow => {
    return {
      uptimePercentGreaterThanOrEqualTo: 99,
      barColor: new Color("#22c55e"),
    };
  },
  LogPipeline: (): StoredRow => {
    return { name: "Pipeline", isEnabled: true };
  },
  TracePipeline: (): StoredRow => {
    return { name: "Pipeline", isEnabled: true };
  },
  AlertGroupingRule: (): StoredRow => {
    return { name: "Rule", isEnabled: true };
  },
  IncidentSlaRule: (): StoredRow => {
    return { name: "SLA", isEnabled: true, atRiskThresholdInPercentage: 80 };
  },
  NetworkSiteAssignmentRule: (): StoredRow => {
    return {
      siteId: new ObjectID("9b000000-0000-4000-8000-0000000000e1"),
      subnetCidr: "10.0.0.0/8",
    };
  },
};

// A severity's delete asks which compliance rules it leaves without one.
const stubComplianceRules: () => void = (): void => {
  getJestSpyOn(
    TeamComplianceSettingService,
    "getRulesScopedToAnyOf",
  ).mockResolvedValue([]);
};

// The collaborators a service calls around a write that are not under test.
const STUBS: Record<string, () => void> = {
  IncidentSeverity: stubComplianceRules,
  AlertSeverity: stubComplianceRules,
  // A deleted status's monitors are pointed elsewhere, in their own table.
  MonitorStatus: (): void => {
    getJestSpyOn(
      MonitorStatusService,
      "clearDeletedMonitorReferences",
    ).mockResolvedValue(undefined);
  },
  // A rule's site is looked up in its own table.
  NetworkSiteAssignmentRule: (): void => {
    getJestSpyOn(
      NetworkSiteAssignmentRuleService,
      "assertSiteBelongsToProject",
    ).mockResolvedValue(undefined);
  },
  IncidentReminderRule: (): void => {
    getJestSpyOn(
      IncidentReminderRuleService,
      "refreshSchedulesForOpenIncidents",
    ).mockResolvedValue(undefined);
  },
  AlertReminderRule: (): void => {
    getJestSpyOn(
      AlertReminderRuleService,
      "refreshSchedulesForOpenAlerts",
    ).mockResolvedValue(undefined);
  },
  ScheduledMaintenanceReminderRule: (): void => {
    getJestSpyOn(
      ScheduledMaintenanceReminderRuleService,
      "refreshSchedulesForOpenScheduledMaintenances",
    ).mockResolvedValue(undefined);
  },
};

function settingsOf(service: DatabaseService<BaseModel>): ListOrderSettings {
  const settings: ListOrderSettings | null = service.getModel().getListOrder();

  if (!settings) {
    throw new Error(`${service.getModel().tableName} is not a list.`);
  }

  return settings;
}

export const LIST_ORDER_CASES: Array<ListOrderCase> = Object.entries(
  SERVICES,
).map(([label, service]: [string, DatabaseService<BaseModel>]) => {
  return {
    label: label,
    service: service,
    settings: settingsOf(service),
    newRowData: NEW_ROW_DATA[label],
    stubCollaborators: STUBS[label],
  };
});

// The tables of the models the cases cover.
export function getCoveredTables(): Array<string> {
  return Object.keys(SERVICES);
}

/*
 * The value a list column holds for the list under test (or another
 * project's list): the project, the parent's id, or the first of the
 * values a kind takes.
 */
function listValueOf(data: {
  listCase: ListOrderCase;
  column: string;
  isOtherList: boolean;
}): unknown {
  const model: BaseModel = data.listCase.service.getModel();

  if (data.column === "projectId") {
    return (data.isOtherList ? OTHER_PROJECT_ID : PROJECT_ID).toString();
  }

  const metadata: TableColumnMetadata | undefined =
    model.getTableColumnMetadata(data.column);

  if (metadata?.type === TableColumnType.ObjectID) {
    return data.isOtherList ? OTHER_LIST_ID : LIST_ID;
  }

  return (metadata?.allowedValues || [])[0];
}

// The columns naming a list's rows: the list under test, or another project's.
export function listColumnsOf(
  listCase: ListOrderCase,
  isOtherList: boolean = false,
): StoredRow {
  const values: StoredRow = {
    projectId: (isOtherList ? OTHER_PROJECT_ID : PROJECT_ID).toString(),
  };

  for (const scopeColumn of listCase.settings.scopeColumns) {
    values[scopeColumn] = listValueOf({
      listCase: listCase,
      column: scopeColumn,
      isOtherList: isOtherList,
    });
  }

  return values;
}

// When the n-th row of a list was created: the first row first.
export function createdAtOf(n: number): Date {
  return new Date(Date.UTC(2026, 0, 1, 0, n));
}

// A row of the list (or another project's), at `order`.
export function listRow(data: {
  listCase: ListOrderCase;
  id: string;
  order: number | null;
  n: number;
  isOtherList?: boolean | undefined;
}): StoredRow {
  return {
    _id: data.id,
    ...listColumnsOf(data.listCase, Boolean(data.isOtherList)),
    name: `Row ${data.id.slice(-4)}`,
    title: `Row ${data.id.slice(-4)}`,
    createdAt: createdAtOf(data.n),
    [data.listCase.settings.column]: data.order,
  };
}

// The rows of a list, by id, with their numbers.
export function numbersById(
  table: InMemoryTable,
  listCase: ListOrderCase,
  isOtherList: boolean = false,
): Record<string, number | null> {
  const list: StoredRow = listColumnsOf(listCase, isOtherList);
  const result: Record<string, number | null> = {};

  for (const row of table.rows) {
    const inList: boolean = Object.entries(list).every(
      ([key, value]: [string, unknown]): boolean => {
        return (
          String(row[key] ?? "").toLowerCase() ===
          String(value ?? "").toLowerCase()
        );
      },
    );

    if (!inList) {
      continue;
    }

    const value: unknown = row[listCase.settings.column];

    result[String(row["_id"])] =
      value === null || value === undefined ? null : Number(value);
  }

  return result;
}

// A new row of the list, at `order` (or none).
export function newListRow(
  listCase: ListOrderCase,
  order: number | undefined,
  label: string,
): BaseModel {
  const model: BaseModel = new listCase.service.modelType();
  const record: StoredRow = model as unknown as StoredRow;

  for (const [key, value] of Object.entries(
    listCase.newRowData ? listCase.newRowData() : {},
  )) {
    record[key] = value;
  }

  for (const [key, value] of Object.entries(listColumnsOf(listCase))) {
    record[key] =
      key === "projectId" ||
      model.getTableColumnMetadata(key)?.type === TableColumnType.ObjectID
        ? new ObjectID(String(value))
        : value;
  }

  for (const key of ["name", "title"]) {
    if (typeof record[key] === "string") {
      record[key] = `${record[key]} ${label}`;
    }
  }

  if (typeof record["slug"] === "string") {
    record["slug"] = `${record["slug"]}-${label.toLowerCase()}`;
  }

  if (order !== undefined) {
    record[listCase.settings.column] = order;
  }

  return model;
}
