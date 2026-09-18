import RunCron from "../../Utils/Cron";
import runMonitorSweep from "../../Utils/MonitorSweep";
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
import QueryHelper from "Common/Server/Types/Database/QueryHelper";

RunCron(
  "IncomingEmailMonitor:CheckOnlineStatus",
  { schedule: EVERY_THIRTY_SECONDS, runOnStartup: false },
  async () => {
    logger.debug(
      "Checking IncomingEmailMonitor:CheckOnlineStatus at " +
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          OneUptimeDate.getCurrentDate(),
        ),
    );

    const sweepStartedAt: Date = OneUptimeDate.getCurrentDate();

    await runMonitorSweep({
      jobName: "IncomingEmailMonitor:CheckOnlineStatus",
      queries: [
        {
          ...MonitorService.getEnabledMonitorQuery(),
          monitorType: MonitorType.IncomingEmail,
          project: { ...ProjectService.getActiveProjectStatusQuery() },
          incomingEmailMonitorHeartbeatCheckedAt: QueryHelper.isNull(),
        },
        {
          ...MonitorService.getEnabledMonitorQuery(),
          monitorType: MonitorType.IncomingEmail,
          project: { ...ProjectService.getActiveProjectStatusQuery() },
          // Exclude monitors stamped in the never-checked phase above.
          incomingEmailMonitorHeartbeatCheckedAt:
            QueryHelper.lessThan(sweepStartedAt),
        },
      ],
      select: {
        _id: true,
        monitorSteps: true,
        incomingEmailMonitorRequest: true,
        createdAt: true,
        projectId: true,
      },
      processMonitor: checkOnlineStatus,
    });
  },
);

const checkOnlineStatus: (monitor: Monitor) => Promise<void> = async (
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

    /*
     * Heartbeat bookkeeping stamp, written for EVERY incoming-email monitor
     * every 30 seconds. The full updateOneById pipeline costs ~3 SELECTs +
     * UPDATE and — because Monitor has @EnableWorkflow + @EnableAuditLog —
     * fires an on-update workflow HTTP trigger and an audit-log row per
     * monitor per tick. A scheduler timestamp should do none of that;
     * single-statement UPDATE, same pattern as the heartbeat writes in
     * MonitorResource.ts.
     */
    await MonitorService.updateColumnsByIdWithoutHooks({
      id: monitor.id!,
      data: {
        incomingEmailMonitorHeartbeatCheckedAt: OneUptimeDate.getCurrentDate(),
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

    logger.debug(`Processed incoming email monitor: ${monitor.id?.toString()}`);
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
