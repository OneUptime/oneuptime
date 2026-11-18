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
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import NetworkDeviceNamingRuleService from "../../../Server/Services/NetworkDeviceNamingRuleService";
import NetworkDeviceRoleService from "../../../Server/Services/NetworkDeviceRoleService";
import NetworkSiteAssignmentRuleService from "../../../Server/Services/NetworkSiteAssignmentRuleService";
import PublicNoteApprovalStepService from "../../../Server/Services/PublicNoteApprovalStepService";
import ScheduledMaintenanceMeasurementService from "../../../Server/Services/ScheduledMaintenanceMeasurementService";
import ScheduledMaintenanceReminderRuleService from "../../../Server/Services/ScheduledMaintenanceReminderRuleService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import SecurityCasePriorityService from "../../../Server/Services/SecurityCasePriorityService";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import SecurityCaseStatusService from "../../../Server/Services/SecurityCaseStatusService";
import SecurityPlaybookService from "../../../Server/Services/SecurityPlaybookService";
import StatusPageFooterLinkService from "../../../Server/Services/StatusPageFooterLinkService";
import StatusPageHeaderLinkService from "../../../Server/Services/StatusPageHeaderLinkService";
import StatusPageHistoryChartBarColorRuleService from "../../../Server/Services/StatusPageHistoryChartBarColorRuleService";
import TeamComplianceSettingService from "../../../Server/Services/TeamComplianceSettingService";
import TraceDropFilterService from "../../../Server/Services/TraceDropFilterService";
import TracePipelineProcessorService from "../../../Server/Services/TracePipelineProcessorService";
import TracePipelineService from "../../../Server/Services/TracePipelineService";
import TraceScrubRuleService from "../../../Server/Services/TraceScrubRuleService";
import PublicNoteApprovalPolicy from "../../../Server/Utils/Notes/PublicNoteApprovalPolicy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { ListOrderSettings } from "../../../Types/Database/ListOrderColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { PublicNoteApprovalEventType } from "../../../Types/StatusPage/PublicNoteApproval";
import { InMemoryTable, StoredRow } from "../TestingUtils/InMemoryRepository";
import { getJestSpyOn } from "../../Spy";
import {
  OTHER_PROJECT_ID,
  PROJECT_ID,
  memberProps,
} from "./ContiguousOrderCases";

/*
 * THE DRAG-ORDERED LISTS (@ListOrderColumn), FOR THE SUITES THAT DRIVE THEIR
 * SERVICES OVER AN IN-MEMORY TABLE (issue #9609).
 *
 * Every model marked @ListOrderColumn - severities, states, monitor
 * statuses, custom fields, a status page's links, pipelines and their
 * processors, drop and scrub filters, rules of every kind - with the
 * service that keeps it: which column numbers a row, which columns name its
 * list, and which end of the numbers is the top. Read from the model's own
 * decorator, so a list added later is covered the day it is marked; the
 * suite fails while one has no service here.
 *
 * ListOrderColumnConverges and ListOrderColumnWrites drive them.
 */

export interface ListOrderCase {
  label: string;
  service: DatabaseService<BaseModel>;
  // The number column, and the columns naming a row's list besides its project.
  column: string;
  scopeColumns: Array<string>;
  sortOrder: SortOrder;
  // The collaborators the service calls that are not under test.
  stubCollaborators: () => void;
}

// The list a suite numbers, and another list of another project's.
export const LIST_ID: string = "1d000000-0000-4000-8000-0000000000c1";
export const OTHER_LIST_ID: string = "1d000000-0000-4000-8000-0000000000c2";

export { OTHER_PROJECT_ID, PROJECT_ID };

// What stays the same in every case: nothing to stub.
const NOTHING_TO_STUB: () => void = (): void => {};

/*
 * A reminder rule's write works out again when each open incident, alert or
 * event is reminded next; those records are not under test.
 */
const stubReminderSchedules: (
  service: DatabaseService<BaseModel>,
  method: string,
) => () => void = (
  service: DatabaseService<BaseModel>,
  method: string,
): (() => void) => {
  return (): void => {
    getJestSpyOn(service, method as never).mockResolvedValue(
      undefined as never,
    );
  };
};

/*
 * A security case status or priority is deleted only while no case (or
 * playbook) is at it; those tables are not under test, and hold none.
 */
const stubSecurityCaseUses: () => void = (): void => {
  for (const service of [SecurityCaseService, SecurityPlaybookService]) {
    getJestSpyOn(service, "countBy").mockResolvedValue(
      new PositiveNumber(0) as never,
    );
  }
};

/*
 * A severity is deleted only once the compliance rules scoped to it are
 * paused; none is, here.
 */
const stubComplianceRules: () => void = (): void => {
  getJestSpyOn(
    TeamComplianceSettingService,
    "getRulesScopedToAnyOf",
  ).mockResolvedValue([] as never);
};

// A deleted monitor status is taken off the monitors at it: none are.
const stubMonitorsAtStatus: () => void = (): void => {
  getJestSpyOn(
    MonitorService,
    "repointDeletedMonitorsAwayFromStatuses",
  ).mockResolvedValue(undefined as never);
};

/*
 * A project that does not ask for its public notes to be approved: its
 * last step may go.
 */
const stubApprovalNotRequired: () => void = (): void => {
  getJestSpyOn(PublicNoteApprovalPolicy, "isRequired").mockResolvedValue(
    false as never,
  );
};

const SERVICES: Array<{
  service: DatabaseService<BaseModel>;
  stubCollaborators?: () => void;
}> = [
  { service: AIPostmortemRuleService },
  { service: AlertGroupingRuleService },
  { service: AlertIncidentRuleService },
  { service: AlertMeasurementService },
  {
    service: AlertReminderRuleService,
    stubCollaborators: stubReminderSchedules(
      AlertReminderRuleService,
      "refreshSchedulesForOpenAlerts",
    ),
  },
  { service: AlertSeverityService, stubCollaborators: stubComplianceRules },
  { service: AlertStateService },
  { service: HostCollectorConfigService },
  { service: IncidentCustomFieldService },
  { service: IncidentGroupingRuleService },
  { service: IncidentMeasurementService },
  { service: IncidentPostmortemStatusService },
  {
    service: IncidentReminderRuleService,
    stubCollaborators: stubReminderSchedules(
      IncidentReminderRuleService,
      "refreshSchedulesForOpenIncidents",
    ),
  },
  {
    service: IncidentSeverityService,
    stubCollaborators: stubComplianceRules,
  },
  { service: IncidentSlaRuleService },
  { service: IncidentStateService },
  { service: IncomingCallPolicyEscalationRuleService },
  { service: LogDropFilterService },
  { service: LogPipelineService },
  { service: LogPipelineProcessorService },
  { service: LogScrubRuleService },
  { service: MetricPipelineRuleService },
  { service: MonitorStatusService, stubCollaborators: stubMonitorsAtStatus },
  { service: NetworkDeviceNamingRuleService },
  { service: NetworkDeviceRoleService },
  { service: NetworkSiteAssignmentRuleService },
  {
    service: PublicNoteApprovalStepService,
    stubCollaborators: stubApprovalNotRequired,
  },
  { service: ScheduledMaintenanceMeasurementService },
  {
    service: ScheduledMaintenanceReminderRuleService,
    stubCollaborators: stubReminderSchedules(
      ScheduledMaintenanceReminderRuleService,
      "refreshSchedulesForOpenScheduledMaintenances",
    ),
  },
  { service: ScheduledMaintenanceStateService },
  {
    service: SecurityCasePriorityService,
    stubCollaborators: stubSecurityCaseUses,
  },
  {
    service: SecurityCaseStatusService,
    stubCollaborators: stubSecurityCaseUses,
  },
  { service: StatusPageFooterLinkService },
  { service: StatusPageHeaderLinkService },
  { service: StatusPageHistoryChartBarColorRuleService },
  { service: TraceDropFilterService },
  { service: TracePipelineService },
  { service: TracePipelineProcessorService },
  { service: TraceScrubRuleService },
] as Array<{
  service: DatabaseService<BaseModel>;
  stubCollaborators?: () => void;
}>;

type ModelType = { new (): BaseModel; name: string };

// The name of every model marked @ListOrderColumn.
export const LIST_ORDER_MODEL_NAMES: Array<string> = (
  AllModelTypes as unknown as Array<ModelType>
)
  .filter((modelType: ModelType): boolean => {
    return Boolean(new modelType().getListOrder());
  })
  .map((modelType: ModelType): string => {
    return new modelType().tableName || modelType.name;
  })
  .sort();

export const LIST_ORDER_CASES: Array<ListOrderCase> = SERVICES.map(
  (entry: {
    service: DatabaseService<BaseModel>;
    stubCollaborators?: () => void;
  }): ListOrderCase => {
    const model: BaseModel = entry.service.getModel();
    const settings: ListOrderSettings = model.getListOrder()!;

    return {
      label: model.tableName || "",
      service: entry.service,
      column: settings.column,
      scopeColumns: settings.scopeColumns.filter((column: string) => {
        return column !== "projectId";
      }),
      sortOrder: settings.sortOrder,
      stubCollaborators: entry.stubCollaborators || NOTHING_TO_STUB,
    };
  },
);

// A member of the project with the project's admin role, as a configuration's key.
export const adminProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return memberProps([Permission.ProjectAdmin]);
  };

/*
 * The value of one of a list's columns, for the list `listId`: an id column
 * holds the list's id; the one text column (a public note approval step's
 * event type) one of its kinds.
 */
export function scopeValue(
  listOrderCase: ListOrderCase,
  column: string,
  listId: string,
): string {
  const type: TableColumnType | undefined = listOrderCase.service
    .getModel()
    .getTableColumnMetadata(column)?.type;

  if (type === TableColumnType.ObjectID) {
    return listId;
  }

  return listId === LIST_ID
    ? PublicNoteApprovalEventType.Incident
    : PublicNoteApprovalEventType.ScheduledMaintenance;
}

// A row of the case's list `listId`, in `projectId`, at `order`.
export function rowInList(data: {
  listOrderCase: ListOrderCase;
  id: string;
  order: number;
  listId?: string | undefined;
  projectId?: ObjectID | undefined;
}): StoredRow {
  const listId: string = data.listId || LIST_ID;
  const row: StoredRow = {
    _id: data.id,
    projectId: (data.projectId || PROJECT_ID).toString(),
    name: `Row ${data.id.slice(-4)}`,
    title: `Row ${data.id.slice(-4)}`,
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    [data.listOrderCase.column]: data.order,
  };

  for (const column of data.listOrderCase.scopeColumns) {
    row[column] = scopeValue(data.listOrderCase, column, listId);
  }

  return row;
}

// Whether a stored row is in the case's list `listId` of `projectId`.
export function isInList(data: {
  listOrderCase: ListOrderCase;
  row: StoredRow;
  listId: string;
  projectId: ObjectID;
}): boolean {
  if (
    String(data.row["projectId"]).toLowerCase() !==
    data.projectId.toString().toLowerCase()
  ) {
    return false;
  }

  return data.listOrderCase.scopeColumns.every((column: string): boolean => {
    return (
      String(data.row[column]).toLowerCase() ===
      scopeValue(data.listOrderCase, column, data.listId).toLowerCase()
    );
  });
}

// Each row of the list, by id, with its number.
export function numbersById(data: {
  table: InMemoryTable;
  listOrderCase: ListOrderCase;
  listId?: string | undefined;
  projectId?: ObjectID | undefined;
}): Record<string, number> {
  const result: Record<string, number> = {};

  for (const row of data.table.rows) {
    if (
      isInList({
        listOrderCase: data.listOrderCase,
        row: row,
        listId: data.listId || LIST_ID,
        projectId: data.projectId || PROJECT_ID,
      })
    ) {
      result[String(row["_id"]).toLowerCase()] = Number(
        row[data.listOrderCase.column],
      );
    }
  }

  return result;
}

/*
 * The hook-free write of one row's column (updateColumnsByIdWithoutHooks),
 * answered from the in-memory table: what the server uses to put a row at
 * the end of its list, and what it used to step the rows in the way aside.
 */
export function useInMemoryHookFreeWrites(data: {
  service: DatabaseService<BaseModel>;
  table: InMemoryTable;
}): Array<{ id: string; data: StoredRow }> {
  const written: Array<{ id: string; data: StoredRow }> = [];

  getJestSpyOn(
    data.service,
    "updateColumnsByIdWithoutHooks",
  ).mockImplementation((async (input: {
    id: ObjectID;
    data: StoredRow;
  }): Promise<void> => {
    const row: StoredRow | undefined = data.table.get(input.id);

    written.push({ id: input.id.toString(), data: { ...input.data } });

    if (row) {
      Object.assign(row, input.data);
    }
  }) as never);

  return written;
}
