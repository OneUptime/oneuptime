import RunCron from "../../Utils/Cron";
import { CheckOn } from "Common/Types/Monitor/CriteriaFilter";
import IncomingEmailMonitorRequest from "Common/Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { EVERY_THIRTY_SECONDS } from "Common/Utils/CronTime";
import MonitorService from "Common/Server/Services/MonitorService";
import logger from "Common/Server/Utils/Logger";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ProjectService from "Common/Server/Services/ProjectService";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";

RunCron(
  "IncomingEmailMonitor:CheckHeartbeat",
  { schedule: EVERY_THIRTY_SECONDS, runOnStartup: false },
  async () => {
    logger.debug(
      "Checking IncomingEmailMonitor:CheckHeartbeat at " +
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          OneUptimeDate.getCurrentDate(),
        ),
    );

    const newIncomingEmailMonitors: Array<Monitor> =
      await MonitorService.findAllBy({
        query: {
          ...MonitorService.getEnabledMonitorQuery(),
          monitorType: MonitorType.IncomingEmail,
          project: {
            ...ProjectService.getActiveProjectStatusQuery(),
          },
          incomingEmailMonitorHeartbeatCheckedAt: QueryHelper.isNull(),
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          monitorSteps: true,
          incomingEmailMonitorRequest: true,
          incomingEmailMonitorHeartbeatCheckedAt: true,
          createdAt: true,
          projectId: true,
        },
        sort: {
          createdAt: SortOrder.Ascending,
        },
      });

    const incomingEmailMonitors: Array<Monitor> =
      await MonitorService.findAllBy({
        query: {
          ...MonitorService.getEnabledMonitorQuery(),
          monitorType: MonitorType.IncomingEmail,
          project: {
            ...ProjectService.getActiveProjectStatusQuery(),
          },
          incomingEmailMonitorHeartbeatCheckedAt: QueryHelper.notNull(),
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          monitorSteps: true,
          incomingEmailMonitorRequest: true,
          incomingEmailMonitorHeartbeatCheckedAt: true,
          createdAt: true,
          projectId: true,
        },
        sort: {
          incomingEmailMonitorHeartbeatCheckedAt: SortOrder.Ascending,
        },
      });

    const totalIncomingEmailMonitors: Array<Monitor> = [
      ...newIncomingEmailMonitors,
      ...incomingEmailMonitors,
    ];

    logger.debug(
      `Found ${totalIncomingEmailMonitors.length} incoming email monitors`,
    );

    logger.debug(totalIncomingEmailMonitors);

    for (const monitor of totalIncomingEmailMonitors) {
      checkHeartBeat(monitor).catch((error: Error) => {
        logger.error(
          `Error while processing incoming email monitor: ${monitor.id?.toString()}`,
        );
        logger.error(error);
      });
    }
  },
);

const checkHeartBeat: (monitor: Monitor) => Promise<void> = async (
  monitor: Monitor,
): Promise<void> => {
  try {
    logger.debug(
      `Processing incoming email monitor: ${monitor.id?.toString()}`,
    );

    if (!monitor.monitorSteps) {
      logger.debug("Monitor has no steps. Skipping...");
      return;
    }

    logger.debug(
      `Updating incoming email monitor heartbeat checked at: ${monitor.id?.toString()}`,
    );

    await MonitorService.updateOneById({
      id: monitor.id!,
      data: {
        incomingEmailMonitorHeartbeatCheckedAt: OneUptimeDate.getCurrentDate(),
      },
      props: {
        isRoot: true,
      },
    });

    logger.debug(
      `Updated incoming email monitor heartbeat checked at: ${monitor.id?.toString()}`,
    );

    const processRequest: boolean = shouldProcessRequest(monitor);

    logger.debug(
      `Monitor: ${monitor.id} should process request: ${processRequest}`,
    );

    if (!processRequest) {
      return;
    }

    const incomingEmailRequest: IncomingEmailMonitorRequest = {
      ...(monitor.incomingEmailMonitorRequest! || {}),
      emailReceivedAt:
        monitor.incomingEmailMonitorRequest?.emailReceivedAt ||
        monitor.createdAt!,
      onlyCheckForIncomingEmailReceivedAt: true,
      monitorId: monitor.id!,
      projectId: monitor.projectId!,
      checkedAt: OneUptimeDate.getCurrentDate(),
      emailFrom: monitor.incomingEmailMonitorRequest?.emailFrom || "",
      emailTo: monitor.incomingEmailMonitorRequest?.emailTo || "",
      emailSubject: monitor.incomingEmailMonitorRequest?.emailSubject || "",
      emailBody: monitor.incomingEmailMonitorRequest?.emailBody || "",
    };

    logger.debug(
      `Processing incoming email monitor: ${monitor.id?.toString()}`,
    );

    await MonitorResourceUtil.monitorResource(incomingEmailRequest);

    logger.debug(
      `Processed incoming email monitor: ${monitor.id?.toString()}`,
    );
  } catch (error) {
    logger.error(
      `Error while processing incoming email monitor: ${monitor.id?.toString()}`,
    );
    logger.error(error);
  }
};

type ShouldProcessRequestFunction = (monitor: Monitor) => boolean;

const shouldProcessRequest: ShouldProcessRequestFunction = (
  monitor: Monitor,
): boolean => {
  /*
   * check if any criteria has email received time step. If yes, then process the request. If no then skip the request.
   * We dont want Incoming Email Monitor to process the request if there is no criteria that checks for incoming email.
   * Those monitors criteria should be checked if the email is received from the webhook and not through the worker.
   */

  let shouldWeProcessRequest: boolean = false;

  for (const steps of monitor.monitorSteps?.data?.monitorStepsInstanceArray ||
    []) {
    if (steps.data?.monitorCriteria.data?.monitorCriteriaInstanceArray) {
      for (const criteria of steps.data?.monitorCriteria.data
        ?.monitorCriteriaInstanceArray || []) {
        for (const filters of criteria.data?.filters || []) {
          if (filters.checkOn === CheckOn.EmailReceivedAt) {
            shouldWeProcessRequest = true;
            break;
          }
        }

        if (shouldWeProcessRequest) {
          break;
        }
      }
    }

    if (shouldWeProcessRequest) {
      break;
    }
  }

  return shouldWeProcessRequest;
};
