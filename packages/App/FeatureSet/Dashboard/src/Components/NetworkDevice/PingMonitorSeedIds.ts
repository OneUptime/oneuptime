import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { MonitorCriteriaSeedIds } from "Common/Utils/NetworkDiscovery/PingMonitorBuilder";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  translateTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * Resolves the four project-scoped ids a monitor's default criteria are seeded
 * with, for every surface that provisions a Ping monitor - the device create
 * form, the device page's "Create Ping Monitor" button and the device list's
 * bulk action - and for the two that build the recommended Network Device
 * monitor template from them: the alert policies page and the discovery
 * import's monitoring step. The messages below say "try again" rather than
 * naming any one surface, and name what is being built.
 *
 * These are properties of the PROJECT, not of any one device, so a bulk
 * action resolves them ONCE and reuses the set for every device - a 14-device
 * action must not make 14 copies of these four queries.
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

// What the ids are for, which the sentences above name.
export enum SeedIdsPurpose {
  PingMonitors = "PingMonitors",
  RecommendedTemplate = "RecommendedTemplate",
}

// The sentences per purpose: whole sentences, each its own translation key.
const MISSING_SENTENCES: Record<
  SeedIdsPurpose,
  { statuses: string; incidentSeverity: string; alertSeverity: string }
> = {
  [SeedIdsPurpose.PingMonitors]: {
    statuses: translationKey(
      "This project needs both an operational and an offline monitor status before Ping monitors can be created. Add them under Monitors → Settings → Monitor Status, then try again.",
    ),
    incidentSeverity: translationKey(
      "This project needs at least one incident severity before Ping monitors can be created. Add one under Incidents → Settings → Incident Severity, then try again.",
    ),
    alertSeverity: translationKey(
      "This project needs at least one alert severity before Ping monitors can be created. Add one under Alerts → Settings → Alert Severity, then try again.",
    ),
  },
  [SeedIdsPurpose.RecommendedTemplate]: {
    statuses: translationKey(
      "This project needs both an operational and an offline monitor status before the recommended monitor template can be created. Add them under Monitors → Settings → Monitor Status, then try again.",
    ),
    incidentSeverity: translationKey(
      "This project needs at least one incident severity before the recommended monitor template can be created. Add one under Incidents → Settings → Incident Severity, then try again.",
    ),
    alertSeverity: translationKey(
      "This project needs at least one alert severity before the recommended monitor template can be created. Add one under Alerts → Settings → Alert Severity, then try again.",
    ),
  },
};

/*
 * The three lists the ids are picked from, as the server returned them:
 * monitor statuses sorted by priority, severities by order.
 */
export interface PingMonitorSeedLists {
  monitorStatuses: Array<MonitorStatus>;
  incidentSeverities: Array<IncidentSeverity>;
  alertSeverities: Array<AlertSeverity>;
}

export default class PingMonitorSeedIds {
  public static async resolve(
    purpose: SeedIdsPurpose = SeedIdsPurpose.PingMonitors,
  ): Promise<MonitorCriteriaSeedIds> {
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

    return PingMonitorSeedIds.fromLists(
      {
        monitorStatuses: monitorStatuses.data,
        incidentSeverities: incidentSeverities.data,
        alertSeverities: alertSeverities.data,
      },
      purpose,
    );
  }

  /*
   * The ids picked from lists a caller already holds, in the order resolve()
   * reads them - the Review dialog's monitoring step reads these lists with
   * their names for its template preview, and picks the ids from them
   * rather than asking for the same rows twice. Throws the same sentences.
   */
  public static fromLists(
    lists: PingMonitorSeedLists,
    purpose: SeedIdsPurpose = SeedIdsPurpose.PingMonitors,
  ): MonitorCriteriaSeedIds {
    const sentences: {
      statuses: string;
      incidentSeverity: string;
      alertSeverity: string;
    } = MISSING_SENTENCES[purpose];

    const onlineMonitorStatus: MonitorStatus | undefined =
      lists.monitorStatuses.find((status: MonitorStatus) => {
        return status.isOperationalState;
      });

    const offlineMonitorStatus: MonitorStatus | undefined =
      lists.monitorStatuses.find((status: MonitorStatus) => {
        return status.isOfflineState;
      });

    const incidentSeverity: IncidentSeverity | undefined =
      lists.incidentSeverities[0];

    const alertSeverity: AlertSeverity | undefined = lists.alertSeverities[0];

    if (!onlineMonitorStatus?.id || !offlineMonitorStatus?.id) {
      throw new PingMonitorSeedIdsUnavailableError(
        translateTemplate(sentences.statuses),
      );
    }

    if (!incidentSeverity?.id) {
      throw new PingMonitorSeedIdsUnavailableError(
        translateTemplate(sentences.incidentSeverity),
      );
    }

    if (!alertSeverity?.id) {
      throw new PingMonitorSeedIdsUnavailableError(
        translateTemplate(sentences.alertSeverity),
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
