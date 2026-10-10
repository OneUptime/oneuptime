import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LlmMonitorSeedIds } from "./LlmMonitorPrefill";

/*
 * The network half of "Create alert" from an AI alert template: the
 * project's statuses and severities, read the way the monitor steps form
 * reads them (statuses by priority, severities by order, most severe
 * first), so the criteria are built with what the form would pick.
 */

export interface LlmMonitorStatusRow {
  id: ObjectID | null;
  isOperationalState?: boolean | undefined;
  isOfflineState?: boolean | undefined;
}

/*
 * The healthy status, and the status a monitor shows while answers are
 * bad: the first status (by priority) that is neither operational nor
 * offline - Degraded in a new project - else the offline one.
 */
export function pickLlmMonitorStatuses(statuses: Array<LlmMonitorStatusRow>): {
  operationalMonitorStatusId: ObjectID | null;
  unhealthyMonitorStatusId: ObjectID | null;
} {
  const operational: LlmMonitorStatusRow | undefined = statuses.find(
    (status: LlmMonitorStatusRow): boolean => {
      return Boolean(status.isOperationalState && status.id);
    },
  );

  const degraded: LlmMonitorStatusRow | undefined = statuses.find(
    (status: LlmMonitorStatusRow): boolean => {
      return Boolean(
        status.id && !status.isOperationalState && !status.isOfflineState,
      );
    },
  );

  const offline: LlmMonitorStatusRow | undefined = statuses.find(
    (status: LlmMonitorStatusRow): boolean => {
      return Boolean(status.isOfflineState && status.id);
    },
  );

  return {
    operationalMonitorStatusId: operational?.id || null,
    unhealthyMonitorStatusId: degraded?.id || offline?.id || null,
  };
}

function toIds(rows: Array<{ id: ObjectID | null }>): Array<ObjectID> {
  return rows
    .map((row: { id: ObjectID | null }): ObjectID | null => {
      return row.id;
    })
    .filter((id: ObjectID | null): id is ObjectID => {
      return Boolean(id);
    });
}

export async function fetchLlmMonitorSeedIds(): Promise<LlmMonitorSeedIds> {
  const [monitorStatuses, incidentSeverities, alertSeverities]: [
    ListResult<MonitorStatus>,
    ListResult<IncidentSeverity>,
    ListResult<AlertSeverity>,
  ] = await Promise.all([
    ModelAPI.getList<MonitorStatus>({
      modelType: MonitorStatus,
      query: {},
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        _id: true,
        isOperationalState: true,
        isOfflineState: true,
        priority: true,
      },
      sort: {
        priority: SortOrder.Ascending,
      },
    }),
    ModelAPI.getList<IncidentSeverity>({
      modelType: IncidentSeverity,
      query: {},
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        _id: true,
        order: true,
      },
      sort: {
        order: SortOrder.Ascending,
      },
    }),
    ModelAPI.getList<AlertSeverity>({
      modelType: AlertSeverity,
      query: {},
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        _id: true,
        order: true,
      },
      sort: {
        order: SortOrder.Ascending,
      },
    }),
  ]);

  return {
    ...pickLlmMonitorStatuses(
      monitorStatuses.data.map((status: MonitorStatus): LlmMonitorStatusRow => {
        return {
          id: status.id,
          isOperationalState: status.isOperationalState,
          isOfflineState: status.isOfflineState,
        };
      }),
    ),
    rankedIncidentSeverityIds: toIds(incidentSeverities.data),
    rankedAlertSeverityIds: toIds(alertSeverities.data),
  };
}
