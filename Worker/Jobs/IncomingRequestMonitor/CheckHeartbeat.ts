import RunCron from "../../Utils/Cron";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import { CheckOn } from "Common/Types/Monitor/CriteriaFilter";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
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
  "IncomingRequestMonitor:CheckHeartbeat",
  { schedule: EVERY_THIRTY_SECONDS, runOnStartup: false },
  async () => {
    logger.debug(
      "Checking IncomingRequestMonitor:CheckHeartbeat at " +
        OneUptimeDate.getDateAsLocalFormattedString(
          OneUptimeDate.getCurrentDate(),
        ),
    );

    const newIncomingRequestMonitors: Array<Monitor> =
      await MonitorService.findBy({
        query: {
          ...MonitorService.getEnabledMonitorQuery(),
          monitorType: MonitorType.IncomingRequest,
          project: {
            ...ProjectService.getActiveProjectStatusQuery(),
          },
          incomingRequestMonitorHeartbeatCheckedAt: QueryHelper.isNull(),
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          monitorSteps: true,
          incomingRequestReceivedAt: true,
          incomingRequestMonitorHeartbeatCheckedAt: true,
          createdAt: true,
        },
        sort: {
          createdAt: SortOrder.Ascending,
        },
        limit: LIMIT_MAX,
        skip: 0,
      });

    const incomingRequestMonitors: Array<Monitor> = await MonitorService.findBy(
      {
        query: {
          ...MonitorService.getEnabledMonitorQuery(),
          monitorType: MonitorType.IncomingRequest,
          project: {
            ...ProjectService.getActiveProjectStatusQuery(),
          },
          incomingRequestMonitorHeartbeatCheckedAt: QueryHelper.notNull(),
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          monitorSteps: true,
          incomingRequestReceivedAt: true,
          incomingRequestMonitorHeartbeatCheckedAt: true,
          createdAt: true,
        },
        sort: {
          incomingRequestMonitorHeartbeatCheckedAt: SortOrder.Ascending,
        },
        limit: LIMIT_MAX,
        skip: 0,
      },
    );

    const totalIncomingRequestMonitors: Array<Monitor> = [
      ...newIncomingRequestMonitors,
      ...incomingRequestMonitors,
    ];

    logger.debug(
      `Found ${totalIncomingRequestMonitors.length} incoming request monitors`,
    );

    logger.debug(totalIncomingRequestMonitors);

    for (const monitor of totalIncomingRequestMonitors) {
      try {
        logger.debug(
          `Processing incoming request monitor: ${monitor.id?.toString()}`,
        );

        if (!monitor.monitorSteps) {
          logger.debug("Monitor has no steps. Skipping...");
          continue;
        }

        await MonitorService.updateOneById({
          id: monitor.id!,
          data: {
            incomingRequestMonitorHeartbeatCheckedAt:
              OneUptimeDate.getCurrentDate(),
          },
          props: {
            isRoot: true,
          },
        });

        logger.debug(
          `Updated incoming request monitor heartbeat checked at: ${monitor.id?.toString()}`,
        );

        const processRequest: boolean = shouldProcessRequest(monitor);

        logger.debug(
          `Monitor: ${monitor.id} should process request: ${processRequest}`,
        );

        if (!processRequest) {
          continue;
        }

        const incomingRequest: IncomingMonitorRequest = {
          monitorId: monitor.id!,
          requestHeaders: undefined,
          requestBody: undefined,
          requestMethod: undefined,
          incomingRequestReceivedAt:
            monitor.incomingRequestReceivedAt || monitor.createdAt!,
          onlyCheckForIncomingRequestReceivedAt: true,
        };

        logger.debug(
          `Processing incoming request monitor: ${monitor.id?.toString()}`,
        );

        await MonitorResourceUtil.monitorResource(incomingRequest);

        logger.debug(
          `Processed incoming request monitor: ${monitor.id?.toString()}`,
        );
      } catch (error) {
        logger.error(
          `Error while processing incoming request monitor: ${monitor.id?.toString()}`,
        );
        logger.error(error);
      }
    }
  },
);

type ShouldProcessRequestFunction = (monitor: Monitor) => boolean;

const shouldProcessRequest: ShouldProcessRequestFunction = (
  monitor: Monitor,
): boolean => {
  // check if any criteria has request time step. If yes, then process the request. If no then skip the request.
  // We dont want Incoming Request Monitor to process the request if there is no criteria that checks for incoming request.
  // Those monitors criteria should be checked if the request is receievd from the API and not through the worker.

  let shouldWeProcessRequest: boolean = false;

  for (const steps of monitor.monitorSteps?.data?.monitorStepsInstanceArray ||
    []) {
    if (steps.data?.monitorCriteria.data?.monitorCriteriaInstanceArray) {
      for (const criteria of steps.data?.monitorCriteria.data
        ?.monitorCriteriaInstanceArray || []) {
        for (const filters of criteria.data?.filters || []) {
          if (filters.checkOn === CheckOn.IncomingRequest) {
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
