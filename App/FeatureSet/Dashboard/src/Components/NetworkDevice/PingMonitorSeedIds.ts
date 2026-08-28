import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { MonitorCriteriaSeedIds } from "Common/Utils/NetworkDiscovery/PingMonitorBuilder";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * Resolves the four project-scoped ids a monitor's default criteria are seeded
 * with, for the discovery import's "create a Ping monitor" option.
 *
 * These are properties of the PROJECT, not of any one host, so the import loop
 * resolves them ONCE and reuses the set for every device — a 14-host import
 * must not make 14 copies of these four queries.
 *
 * The operational-status lookup is sorted `priority ASC, createdAt ASC` on
 * purpose, matching MonitorService.onBeforeCreate exactly. A project can hold
 * more than one `isOperationalState` status, and an unsorted read falls back to
 * `createdAt DESC` — which is how monitors silently latched onto a fixture's
 * freshly-created "TF Operational" instead of the project's canonical one, and
 * then blocked its deletion through the currentMonitorStatusId foreign key.
 * Sorting the same way here keeps the criteria we seed and the status the
 * server stamps in agreement.
 */

/**
 * Thrown when the project is missing something a monitor cannot be built
 * without. The message is shown to the operator, so it names the fix.
 */
export class PingMonitorSeedIdsUnavailableError extends Error {}

export default class PingMonitorSeedIds {
  public static async resolve(): Promise<MonitorCriteriaSeedIds> {
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
        },
        sort: {
          order: SortOrder.Ascending,
        },
      }),
    ]);

    const onlineMonitorStatus: MonitorStatus | undefined =
      monitorStatuses.data.find((status: MonitorStatus) => {
        return status.isOperationalState;
      });

    const offlineMonitorStatus: MonitorStatus | undefined =
      monitorStatuses.data.find((status: MonitorStatus) => {
        return status.isOfflineState;
      });

    const incidentSeverity: IncidentSeverity | undefined =
      incidentSeverities.data[0];

    const alertSeverity: AlertSeverity | undefined = alertSeverities.data[0];

    if (!onlineMonitorStatus?.id || !offlineMonitorStatus?.id) {
      throw new PingMonitorSeedIdsUnavailableError(
        "This project needs both an operational and an offline monitor status before Ping monitors can be created. Add them under Project Settings, then import again.",
      );
    }

    if (!incidentSeverity?.id) {
      throw new PingMonitorSeedIdsUnavailableError(
        "This project needs at least one incident severity before Ping monitors can be created. Add one under Project Settings, then import again.",
      );
    }

    if (!alertSeverity?.id) {
      throw new PingMonitorSeedIdsUnavailableError(
        "This project needs at least one alert severity before Ping monitors can be created. Add one under Project Settings, then import again.",
      );
    }

    return {
      onlineMonitorStatusId: onlineMonitorStatus.id,
      offlineMonitorStatusId: offlineMonitorStatus.id,
      defaultIncidentSeverityId: incidentSeverity.id,
      defaultAlertSeverityId: alertSeverity.id,
    };
  }
}
