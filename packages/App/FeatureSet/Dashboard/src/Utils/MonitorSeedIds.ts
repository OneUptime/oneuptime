import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The project's statuses and severities a monitor built for someone is
 * given: what Monitor Create's prefills (an AI insight's monitor, a host
 * service's) build their criteria with, so the criteria pick what the
 * steps form would. Statuses may be null and the severity lists empty - a
 * project missing one gets criteria that leave that part off rather than
 * criteria that cannot be saved.
 */
export interface MonitorSeedIds {
  operationalMonitorStatusId: ObjectID | null;
  offlineMonitorStatusId: ObjectID | null;
  // Most severe first (the API sorts by `order`).
  rankedIncidentSeverityIds: Array<ObjectID>;
  rankedAlertSeverityIds: Array<ObjectID>;
}

// No statuses and no severities: what a prefill falls back to when the read fails.
export const EMPTY_MONITOR_SEED_IDS: MonitorSeedIds = {
  operationalMonitorStatusId: null,
  offlineMonitorStatusId: null,
  rankedIncidentSeverityIds: [],
  rankedAlertSeverityIds: [],
};

function toIds(rows: Array<{ id: ObjectID | null }>): Array<ObjectID> {
  return rows
    .map((row: { id: ObjectID | null }): ObjectID | null => {
      return row.id;
    })
    .filter((id: ObjectID | null): id is ObjectID => {
      return Boolean(id);
    });
}

/*
 * Sorted the way MonitorService.onBeforeCreate and the steps form sort them
 * - priority for statuses, order for severities - so the status a criteria
 * picks is the one the server stamps, and the first severity is the most
 * severe. Archived values are left out: a new monitor is set up with values
 * that can be picked.
 */
export async function fetchMonitorSeedIds(): Promise<MonitorSeedIds> {
  const [monitorStatuses, incidentSeverities, alertSeverities]: [
    ListResult<MonitorStatus>,
    ListResult<IncidentSeverity>,
    ListResult<AlertSeverity>,
  ] = await Promise.all([
    ModelAPI.getList<MonitorStatus>({
      modelType: MonitorStatus,
      query: { isArchived: false },
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
      query: { isArchived: false },
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
      query: { isArchived: false },
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
    operationalMonitorStatusId:
      monitorStatuses.data.find((status: MonitorStatus) => {
        return status.isOperationalState;
      })?.id || null,
    offlineMonitorStatusId:
      monitorStatuses.data.find((status: MonitorStatus) => {
        return status.isOfflineState;
      })?.id || null,
    rankedIncidentSeverityIds: toIds(incidentSeverities.data),
    rankedAlertSeverityIds: toIds(alertSeverities.data),
  };
}
