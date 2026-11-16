import RunCron from "../../Utils/Cron";
import runMonitorSweep from "../../Utils/MonitorSweep";
import { CheckOn } from "Common/Types/Monitor/CriteriaFilter";
import IncomingEmailMonitorRequest from "Common/Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { EVERY_THIRTY_SECONDS } from "Common/Utils/CronTime";
import MonitorService from "Common/Server/Services/MonitorService";
import logger from "Common/Server/Utils/Logger";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import { logMonitorEvaluationError } from "Common/Server/Utils/Monitor/NonActionableIngestError";
import MonitorHeartbeatState, {
  HeartbeatKind,
  HeartbeatWrite,
} from "Common/Server/Utils/Monitor/MonitorHeartbeatState";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ProjectService from "Common/Server/Services/ProjectService";
import OneUptimeDate from "Common/Types/Date";

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

    await runMonitorSweep({
      jobName: "IncomingEmailMonitor:CheckOnlineStatus",
      /*
       * Every enabled incoming email monitor of an active project, once:
       * the sweep's ID cursor visits each monitor once. Monitors used to be
       * stamped as they were visited, and queried by that stamp so none was
       * visited twice; the stamp is now written only every few minutes
       * (stampStatusCheckedAt), so it no longer says who was visited.
       */
      queries: [
        {
          ...MonitorService.getEnabledMonitorQuery(),
          monitorType: MonitorType.IncomingEmail,
          project: { ...ProjectService.getActiveProjectStatusQuery() },
        },
      ],
      select: {
        _id: true,
        monitorSteps: true,
        incomingEmailMonitorRequest: true,
        createdAt: true,
        projectId: true,
        // What its last evaluation found (MonitorHeartbeatState).
        currentMonitorStatusId: true,
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

    await stampStatusCheckedAt(monitor);

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

    /*
     * Evaluated only once a heartbeat window can have turned: a monitor
     * whose latest email was already evaluated - against these criteria, at
     * this status - and whose shortest "received in N minutes" window has
     * not passed since would be judged exactly as it was
     * (MonitorHeartbeatState.canSkipEvaluation). Every sweep after the
     * window has passed evaluates it, as before, and so does a new email.
     */
    if (
      await MonitorHeartbeatState.canSkipEvaluation({
        kind: HeartbeatKind.IncomingEmail,
        monitorId: monitor.id!,
        receivedAt: incomingEmailRequest.emailReceivedAt,
        monitorSteps: monitor.monitorSteps,
        monitorStatusId: monitor.currentMonitorStatusId,
        now: incomingEmailRequest.checkedAt!,
      })
    ) {
      logger.debug(
        `Incoming email monitor ${monitor.id?.toString()}: its latest email was evaluated and no heartbeat window has passed since. Skipping.`,
      );
      return;
    }

    logger.debug(
      `Processing incoming email monitor: ${monitor.id?.toString()}`,
    );

    await MonitorResourceUtil.monitorResource(incomingEmailRequest);

    logger.debug(`Processed incoming email monitor: ${monitor.id?.toString()}`);
  } catch (error) {
    /*
     * A monitor paused, archived or disabled since the sweep read it is
     * refused, as expected: logged at debug, and the sweep goes on
     * (logMonitorEvaluationError, issue #8069).
     */
    logMonitorEvaluationError({
      error: error,
      message: `Error while processing incoming email monitor: ${monitor.id?.toString()}`,
      attributes: { projectId: monitor.projectId?.toString() },
    });
  }
};

/*
 * "Monitor Status Check At", as the Dashboard shows it: written for every
 * monitor every 30 seconds, it was a Monitor row write per monitor per
 * sweep (single statement, no hooks). Now at most every few minutes
 * (MonitorHeartbeatState.CHECK_STAMP_WRITE_EVERY_SECONDS) - an email the
 * monitor receives also writes it, with the email.
 */
const stampStatusCheckedAt: (monitor: Monitor) => Promise<void> = async (
  monitor: Monitor,
): Promise<void> => {
  if (
    !(await MonitorHeartbeatState.isWriteDue({
      monitorId: monitor.id!,
      write: HeartbeatWrite.IncomingEmailCheck,
    }))
  ) {
    return;
  }

  await MonitorService.updateColumnsByIdWithoutHooks({
    id: monitor.id!,
    data: {
      incomingEmailMonitorHeartbeatCheckedAt: OneUptimeDate.getCurrentDate(),
    },
  });

  await MonitorHeartbeatState.markWritten({
    monitorId: monitor.id!,
    write: HeartbeatWrite.IncomingEmailCheck,
    everySeconds: MonitorHeartbeatState.CHECK_STAMP_WRITE_EVERY_SECONDS,
  });
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
