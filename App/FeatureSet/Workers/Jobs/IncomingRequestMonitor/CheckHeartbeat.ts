import RunCron from "../../Utils/Cron";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import { CheckOn } from "Common/Types/Monitor/CriteriaFilter";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import MonitorService from "Common/Server/Services/MonitorService";
import logger from "Common/Server/Utils/Logger";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import Monitor from "Common/Models/DatabaseModels/Monitor";

RunCron(
  "IncomingRequestMonitor:CheckHeartbeat",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    logger.debug("Checking IncomingRequestMonitor:CheckHeartbeat");

    const incomingRequestMonitors: Array<Monitor> = await MonitorService.findBy(
      {
        query: {
          monitorType: MonitorType.IncomingRequest,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          monitorSteps: true,
          incomingRequestReceivedAt: true,
          createdAt: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
      },
    );

    logger.debug(
      `Found ${incomingRequestMonitors.length} incoming request monitors`,
    );

    logger.debug(incomingRequestMonitors);

    for (const monitor of incomingRequestMonitors) {
      try {
        if (!monitor.monitorSteps) {
          logger.debug("Monitor has no steps. Skipping...");
          continue;
        }

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

        await MonitorResourceUtil.monitorResource(incomingRequest);
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
