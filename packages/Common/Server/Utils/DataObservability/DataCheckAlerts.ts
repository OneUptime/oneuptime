import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { getDataTableKey } from "../../../Types/DataObservability/DataObservabilityMetric";
import {
  DataCheckAlertCondition,
  DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES,
} from "../../../Types/DataObservability/DataCheckType";
import BadDataException from "../../../Types/Exception/BadDataException";
import { buildDataCheckMonitorStep } from "../../../Types/Monitor/DataCheckMonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import AlertSeverityService from "../../Services/AlertSeverityService";
import DataAssetService from "../../Services/DataAssetService";
import DataCheckService from "../../Services/DataCheckService";
import IncidentSeverityService from "../../Services/IncidentSeverityService";
import MonitorService from "../../Services/MonitorService";
import MonitorStatusService from "../../Services/MonitorStatusService";

/*
 * A DATA CHECK'S ALERT: ONE METRICS MONITOR, KEPT IN STEP WITH THE CHECK.
 *
 * When a check says when it should alert, it has a monitor over its metric
 * (DataCheckMonitorStep); when it stops saying so, the monitor goes. A
 * check turned off keeps its monitor, quiet while no value is written. The monitor is made, changed and removed as the person who
 * saved the check, with their own permissions - so who may not create
 * monitors gets the reason, and a monitor is billed like any other - and is
 * an ordinary monitor from then on: owners, on-call, maintenance, status
 * pages.
 */

// The longest monitor name kept.
const MAX_MONITOR_NAME_LENGTH: number = 100;

interface ProjectSeed {
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  incidentSeverityId: ObjectID;
  alertSeverityId: ObjectID;
}

export default class DataCheckAlerts {
  public static async sync(data: {
    projectId: ObjectID;
    checkId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<{ monitorId: string | null }> {
    const check: DataCheck | null = await DataCheckService.findOneBy({
      query: { _id: data.checkId, projectId: data.projectId },
      select: {
        _id: true,
        name: true,
        dataAssetId: true,
        isEnabled: true,
        intervalInMinutes: true,
        alertCondition: true,
        alertThreshold: true,
        monitorId: true,
      },
      props: { isRoot: true },
    });

    if (!check?.id) {
      throw new BadDataException("Data check not found.");
    }

    const liveMonitorId: ObjectID | null = await this.readLiveMonitorId(
      data.projectId,
      check.monitorId,
    );

    /*
     * A check turned off keeps its monitor: it writes no value, so the
     * monitor goes quiet, and turning it back on brings its alert back.
     */
    if (check.isEnabled === false) {
      return { monitorId: liveMonitorId ? liveMonitorId.toString() : null };
    }

    if (!check.alertCondition) {
      if (liveMonitorId) {
        await MonitorService.deleteOneBy({
          query: { _id: liveMonitorId, projectId: data.projectId },
          props: data.props,
        });
      }

      await this.saveMonitorId(check.id, null);
      return { monitorId: null };
    }

    const asset: DataAsset | null = await DataAssetService.findOneBy({
      query: { _id: check.dataAssetId!, projectId: data.projectId },
      select: { _id: true, schemaName: true, name: true },
      props: { isRoot: true },
    });
    const tableKey: string = asset
      ? getDataTableKey(asset.schemaName || "", asset.name || "")
      : "table";
    const seed: ProjectSeed = await this.readSeed(data.projectId);
    const monitorName: string =
      `${check.name || "Data check"} - ${tableKey}`.slice(
        0,
        MAX_MONITOR_NAME_LENGTH,
      );
    const steps: MonitorSteps = new MonitorSteps();

    steps.data = {
      monitorStepsInstanceArray: [
        buildDataCheckMonitorStep({
          checkId: check.id.toString(),
          checkName: check.name || "Data check",
          tableKey,
          condition: check.alertCondition as DataCheckAlertCondition,
          threshold:
            check.alertThreshold === undefined || check.alertThreshold === null
              ? null
              : Number(check.alertThreshold),
          intervalInMinutes:
            check.intervalInMinutes || DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES,
          onlineMonitorStatusId: seed.onlineMonitorStatusId,
          offlineMonitorStatusId: seed.offlineMonitorStatusId,
          defaultIncidentSeverityId: seed.incidentSeverityId,
          defaultAlertSeverityId: seed.alertSeverityId,
          monitorName,
        }),
      ],
      defaultMonitorStatusId: seed.onlineMonitorStatusId,
    };

    if (liveMonitorId) {
      await MonitorService.updateOneById({
        id: liveMonitorId,
        data: { name: monitorName, monitorSteps: steps } as never,
        props: data.props,
      });

      return { monitorId: liveMonitorId.toString() };
    }

    const monitor: Monitor = new Monitor();
    monitor.projectId = data.projectId;
    monitor.name = monitorName;
    monitor.description = `Alerts on the data check "${check.name || ""}" of ${tableKey}, from Data Observability.`;
    monitor.monitorType = MonitorType.Metrics;
    monitor.monitorSteps = steps;

    const created: Monitor = await MonitorService.create({
      data: monitor,
      props: data.props,
    });

    await this.saveMonitorId(check.id, created.id!);

    return { monitorId: created.id!.toString() };
  }

  // The check's monitor, unless someone deleted it on the Monitors page.
  private static async readLiveMonitorId(
    projectId: ObjectID,
    monitorId: ObjectID | undefined,
  ): Promise<ObjectID | null> {
    if (!monitorId) {
      return null;
    }

    const monitor: Monitor | null = await MonitorService.findOneBy({
      query: { _id: monitorId, projectId },
      select: { _id: true },
      props: { isRoot: true },
    });

    return monitor?.id || null;
  }

  private static async saveMonitorId(
    checkId: ObjectID,
    monitorId: ObjectID | null,
  ): Promise<void> {
    await DataCheckService.updateColumnsByIdWithoutHooks({
      id: checkId,
      data: { monitorId } as never,
    });
  }

  private static async readSeed(projectId: ObjectID): Promise<ProjectSeed> {
    const sort: { priority: SortOrder; createdAt: SortOrder } = {
      priority: SortOrder.Ascending,
      createdAt: SortOrder.Ascending,
    };
    const online: MonitorStatus | null = await MonitorStatusService.findOneBy({
      query: { projectId, isOperationalState: true },
      select: { _id: true },
      sort,
      props: { isRoot: true },
    });
    const offline: MonitorStatus | null = await MonitorStatusService.findOneBy({
      query: { projectId, isOfflineState: true },
      select: { _id: true },
      sort,
      props: { isRoot: true },
    });
    const incidentSeverity: IncidentSeverity | null =
      await IncidentSeverityService.findOneBy({
        query: { projectId },
        select: { _id: true },
        sort: { order: SortOrder.Ascending },
        props: { isRoot: true },
      });
    const alertSeverity: AlertSeverity | null =
      await AlertSeverityService.findOneBy({
        query: { projectId },
        select: { _id: true },
        sort: { order: SortOrder.Ascending },
        props: { isRoot: true },
      });

    if (
      !online?.id ||
      !offline?.id ||
      !incidentSeverity?.id ||
      !alertSeverity?.id
    ) {
      throw new BadDataException(
        "This project is missing an operational or offline monitor status, or an incident or alert severity. Add them in Settings, then save the check again.",
      );
    }

    return {
      onlineMonitorStatusId: online.id,
      offlineMonitorStatusId: offline.id,
      incidentSeverityId: incidentSeverity.id,
      alertSeverityId: alertSeverity.id,
    };
  }
}
