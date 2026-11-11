import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import DataBiConnection from "../../../../Models/DatabaseModels/DataBiConnection";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import DataBiTool from "../../../../Types/DataObservability/DataBiTool";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { buildDataBiRefreshMonitorStep } from "../../../../Types/Monitor/DataBiRefreshMonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import AlertSeverityService from "../../../Services/AlertSeverityService";
import DataBiConnectionService from "../../../Services/DataBiConnectionService";
import IncidentSeverityService from "../../../Services/IncidentSeverityService";
import MonitorService from "../../../Services/MonitorService";
import MonitorStatusService from "../../../Services/MonitorStatusService";

/*
 * A POWER BI TOOL'S ALERTS ON FAILED REFRESHES: ONE MONITOR, KEPT IN STEP.
 *
 * When a Power BI tool says to alert on failed refreshes, it has one Metrics
 * monitor over its datasets' oneuptime.data.bi.refresh_failed
 * (DataBiRefreshMonitorStep): one alert per dataset whose refresh failed,
 * resolved once a later refresh completes. When it stops saying so, the
 * monitor goes. The monitor is made and removed as the person who saved the
 * tool, with their own permissions - so who may not create monitors gets
 * the reason, and the monitor is billed like any other - and is an ordinary
 * monitor from then on: owners, on-call policies, maintenance windows. So
 * saving the tool again renames it with the tool and changes nothing else.
 * Deleting the tool deletes it (DataBiConnectionService).
 */

const MAX_MONITOR_NAME_LENGTH: number = 100;

interface ProjectSeed {
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  incidentSeverityId: ObjectID;
  alertSeverityId: ObjectID;
}

export function getDataBiRefreshMonitorName(toolName: string): string {
  return `${toolName || "Power BI"} - Failed Refreshes`.slice(
    0,
    MAX_MONITOR_NAME_LENGTH,
  );
}

export default class DataBiRefreshAlerts {
  public static async sync(data: {
    projectId: ObjectID;
    dataBiConnectionId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<{ monitorId: string | null }> {
    const connection: DataBiConnection | null =
      await DataBiConnectionService.findOneBy({
        query: { _id: data.dataBiConnectionId, projectId: data.projectId },
        select: {
          _id: true,
          name: true,
          tool: true,
          alertOnFailedRefreshes: true,
          refreshMonitorId: true,
        },
        props: { isRoot: true },
      });

    if (!connection?.id) {
      throw new BadDataException("No such BI tool in this project.");
    }

    const liveMonitor: Monitor | null = await this.readLiveMonitor(
      data.projectId,
      connection.refreshMonitorId,
    );

    if (
      connection.tool !== DataBiTool.PowerBI ||
      connection.alertOnFailedRefreshes !== true
    ) {
      if (liveMonitor?.id) {
        await MonitorService.deleteOneBy({
          query: { _id: liveMonitor.id, projectId: data.projectId },
          props: data.props,
        });
      }

      if (connection.refreshMonitorId) {
        await this.saveMonitorId(connection.id, null);
      }

      return { monitorId: null };
    }

    const name: string = getDataBiRefreshMonitorName(connection.name || "");

    if (liveMonitor?.id) {
      if (liveMonitor.name !== name) {
        await MonitorService.updateOneById({
          id: liveMonitor.id,
          data: { name } as never,
          props: data.props,
        });
      }

      return { monitorId: liveMonitor.id.toString() };
    }

    const seed: ProjectSeed = await this.readSeed(data.projectId);
    const steps: MonitorSteps = new MonitorSteps();

    steps.data = {
      monitorStepsInstanceArray: [
        buildDataBiRefreshMonitorStep({
          dataBiConnectionId: connection.id.toString(),
          toolName: connection.name || "Power BI",
          monitorName: name,
          onlineMonitorStatusId: seed.onlineMonitorStatusId,
          offlineMonitorStatusId: seed.offlineMonitorStatusId,
          defaultIncidentSeverityId: seed.incidentSeverityId,
          defaultAlertSeverityId: seed.alertSeverityId,
        }),
      ],
      defaultMonitorStatusId: seed.onlineMonitorStatusId,
    };

    const monitor: Monitor = new Monitor();
    monitor.projectId = data.projectId;
    monitor.name = name;
    monitor.description = `Opens an alert for each dataset of the Power BI tool "${connection.name || ""}" whose last refresh failed or was cancelled, and resolves it once a later refresh completes. From Data Observability.`;
    monitor.monitorType = MonitorType.Metrics;
    monitor.monitorSteps = steps;

    const created: Monitor = await MonitorService.create({
      data: monitor,
      props: data.props,
    });

    await this.saveMonitorId(connection.id, created.id!);

    return { monitorId: created.id!.toString() };
  }

  // The tool's monitor, unless someone deleted it on the Monitors page.
  private static async readLiveMonitor(
    projectId: ObjectID,
    monitorId: ObjectID | undefined,
  ): Promise<Monitor | null> {
    if (!monitorId) {
      return null;
    }

    return await MonitorService.findOneBy({
      query: { _id: monitorId, projectId },
      select: { _id: true, name: true },
      props: { isRoot: true },
    });
  }

  private static async saveMonitorId(
    dataBiConnectionId: ObjectID,
    monitorId: ObjectID | null,
  ): Promise<void> {
    await DataBiConnectionService.updateColumnsByIdWithoutHooks({
      id: dataBiConnectionId,
      data: { refreshMonitorId: monitorId } as never,
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
        "This project is missing an operational or offline monitor status, or an incident or alert severity. Add them in Settings, then save the BI tool again.",
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
