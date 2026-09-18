import RunCron from "../../Utils/Cron";
import runMonitorSweep from "../../Utils/MonitorSweep";
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
import QueryHelper from "Common/Server/Types/Database/QueryHelper";

RunCron(
  "IncomingRequestMonitor:CheckHeartbeat",
  { schedule: EVERY_THIRTY_SECONDS, runOnStartup: false },
  async () => {
    logger.debug(
      "Checking IncomingRequestMonitor:CheckHeartbeat at " +
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          OneUptimeDate.getCurrentDate(),
        ),
    );

    const sweepStartedAt: Date = OneUptimeDate.getCurrentDate();

    await runMonitorSweep({
      jobName: "IncomingRequestMonitor:CheckHeartbeat",
      queries: [
        {
          ...MonitorService.getEnabledMonitorQuery(),
          monitorType: MonitorType.IncomingRequest,
          project: { ...ProjectService.getActiveProjectStatusQuery() },
          incomingRequestMonitorHeartbeatCheckedAt: QueryHelper.isNull(),
        },
        {
          ...MonitorService.getEnabledMonitorQuery(),
          monitorType: MonitorType.IncomingRequest,
          project: { ...ProjectService.getActiveProjectStatusQuery() },
          // Exclude monitors stamped in the never-checked phase above.
          incomingRequestMonitorHeartbeatCheckedAt:
            QueryHelper.lessThan(sweepStartedAt),
        },
      ],
      select: {
        _id: true,
        monitorSteps: true,
        incomingMonitorRequest: true,
        createdAt: true,
        projectId: true,
      },
      processMonitor: checkHeartBeat,
    });
  },
);

const checkHeartBeat: (monitor: Monitor) => Promise<void> = async (
  monitor: Monitor,
): Promise<void> => {
  try {
    logger.debug(
      `Processing incoming request monitor: ${monitor.id?.toString()}`,
    );

    if (!monitor.monitorSteps) {
      logger.debug("Monitor has no steps. Skipping...");
      return;
    }

    logger.debug(
      `Updating incoming request monitor heartbeat checked at: ${monitor.id?.toString()}`,
    );

    /*
     * Heartbeat bookkeeping stamp, written for EVERY incoming-request
     * monitor every 30 seconds. The full updateOneById pipeline costs ~3
     * SELECTs + UPDATE and — because Monitor has @EnableWorkflow +
     * @EnableAuditLog — fires an on-update workflow HTTP trigger and an
     * audit-log row per monitor per tick. A scheduler timestamp should do
     * none of that; single-statement UPDATE, same pattern as the heartbeat
     * writes in MonitorResource.ts.
     */
    await MonitorService.updateColumnsByIdWithoutHooks({
      id: monitor.id!,
      data: {
        incomingRequestMonitorHeartbeatCheckedAt:
          OneUptimeDate.getCurrentDate(),
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
      return;
    }

    const incomingRequest: IncomingMonitorRequest = {
      ...(monitor.incomingMonitorRequest! || {}),
      incomingRequestReceivedAt:
        monitor.incomingMonitorRequest?.incomingRequestReceivedAt ||
        monitor.createdAt!,
      onlyCheckForIncomingRequestReceivedAt: true,
      monitorId: monitor.id!,
      projectId: monitor.projectId!,
      checkedAt: OneUptimeDate.getCurrentDate(),
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
};

type ShouldProcessRequestFunction = (monitor: Monitor) => boolean;

const shouldProcessRequest: ShouldProcessRequestFunction = (
  monitor: Monitor,
): boolean => {
  /*
   * check if any criteria has request time step. If yes, then process the request. If no then skip the request.
   * We dont want Incoming Request Monitor to process the request if there is no criteria that checks for incoming request.
   * Those monitors criteria should be checked if the request is receievd from the API and not through the worker.
   */

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
