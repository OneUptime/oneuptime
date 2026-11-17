import RunCron from "../../Utils/Cron";
import runMonitorSweep from "../../Utils/MonitorSweep";
import { CheckOn } from "Common/Types/Monitor/CriteriaFilter";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { EVERY_THIRTY_SECONDS } from "Common/Utils/CronTime";
import MonitorService from "Common/Server/Services/MonitorService";
import logger from "Common/Server/Utils/Logger";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import { logMonitorEvaluationError } from "Common/Server/Utils/Monitor/NonActionableIngestError";
import IncomingRequestReceivedAtStore from "Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore";
import MonitorHeartbeatState, {
  HeartbeatKind,
  HeartbeatWrite,
} from "Common/Server/Utils/Monitor/MonitorHeartbeatState";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ProjectService from "Common/Server/Services/ProjectService";
import OneUptimeDate from "Common/Types/Date";

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

    await runMonitorSweep({
      jobName: "IncomingRequestMonitor:CheckHeartbeat",
      /*
       * Every enabled incoming request monitor of an active project, once:
       * the sweep's ID cursor visits each monitor once. Monitors used to be
       * stamped as they were visited, and queried by that stamp so none was
       * visited twice; the stamp is now written only every few minutes
       * (stampStatusCheckedAt), so it no longer says who was visited.
       */
      queries: [
        {
          ...MonitorService.getEnabledMonitorQuery(),
          monitorType: MonitorType.IncomingRequest,
          project: { ...ProjectService.getActiveProjectStatusQuery() },
        },
      ],
      select: {
        _id: true,
        monitorSteps: true,
        /*
         * The latest request as it came, which this job judges again, and
         * not the copy people read beside it, which is cut. Every server
         * since 14.0.106 writes the two in one statement
         * (LatestIncomingRequest.toColumns), and 16 is upgraded to from 15
         * only, so no server that writes the copy alone runs beside this
         * one any more. One JSON column, read for every monitor every 30
         * seconds (#8906).
         */
        incomingMonitorRequestAsReceived: true,
        // Keys this monitor's arrivals in IncomingRequestReceivedAtStore.
        incomingRequestSecretKey: true,
        createdAt: true,
        projectId: true,
        // What its last evaluation found (MonitorHeartbeatState).
        currentMonitorStatusId: true,
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

    await stampStatusCheckedAt(monitor);

    const processRequest: boolean = shouldProcessRequest(monitor);

    logger.debug(
      `Monitor: ${monitor.id} should process request: ${processRequest}`,
    );

    if (!processRequest) {
      return;
    }

    /*
     * The request as the sender sent it, never the copy people read: that
     * one is cut, and a filter on the body or on a header needs what came.
     * A monitor no request has reached has none, and is judged on when it
     * was made and on the arrivals the store has (below).
     */
    const latestRequest: IncomingMonitorRequest | undefined =
      monitor.incomingMonitorRequestAsReceived || undefined;

    /*
     * Judge the latest ARRIVAL, not the last heartbeat a Telemetry worker
     * happened to persist. The persisted time trails arrivals by however far
     * behind the queue is, and coalescing can drop a monitor's newer requests
     * altogether, so judging it alone flipped every heartbeat monitor Offline
     * whenever the queue fell more than the window behind - while every
     * sender was still getting 2xx. The store has every arrival the endpoint
     * saw; the persisted time is only the floor (and the fallback when Redis
     * is unavailable).
     *
     * Read here, after the bookkeeping write above: that write can wait on a
     * busy database (behind a migration's lock, say) for minutes, and the
     * arrivals recorded during the wait are in the store, not in the page
     * this monitor was loaded with before it. This call also registers the
     * monitor's secret key, which is what lets the endpoint record arrivals
     * for it.
     */
    const latestReceivedAt: Date = await IncomingRequestReceivedAtStore.track({
      secretKey: monitor.incomingRequestSecretKey,
      receivedAt:
        latestRequest?.incomingRequestReceivedAt || monitor.createdAt!,
    });

    const checkedAt: Date = OneUptimeDate.getCurrentDate();

    const incomingRequest: IncomingMonitorRequest = {
      ...(latestRequest || {}),
      incomingRequestReceivedAt:
        IncomingRequestReceivedAtStore.getReceivedAtAsOf(
          latestReceivedAt,
          checkedAt,
        ),
      onlyCheckForIncomingRequestReceivedAt: true,
      monitorId: monitor.id!,
      projectId: monitor.projectId!,
      checkedAt: checkedAt,
    };

    /*
     * Evaluated only once a heartbeat window can have turned: a monitor
     * whose latest request was already evaluated - against these criteria,
     * at this status - and whose shortest "received in N minutes" window
     * has not passed since would be judged exactly as it was
     * (MonitorHeartbeatState.canSkipEvaluation). Every sweep after the
     * window has passed evaluates it, as before, and so does a new request.
     */
    if (
      await MonitorHeartbeatState.canSkipEvaluation({
        kind: HeartbeatKind.IncomingRequest,
        monitorId: monitor.id!,
        receivedAt: incomingRequest.incomingRequestReceivedAt,
        monitorSteps: monitor.monitorSteps,
        monitorStatusId: monitor.currentMonitorStatusId,
        now: checkedAt,
      })
    ) {
      logger.debug(
        `Incoming request monitor ${monitor.id?.toString()}: its latest request was evaluated and no heartbeat window has passed since. Skipping.`,
      );
      return;
    }

    logger.debug(
      `Processing incoming request monitor: ${monitor.id?.toString()}`,
    );

    await MonitorResourceUtil.monitorResource(incomingRequest);

    logger.debug(
      `Processed incoming request monitor: ${monitor.id?.toString()}`,
    );
  } catch (error) {
    /*
     * A monitor paused, archived or disabled since the sweep read it is
     * refused, as expected: logged at debug, and the sweep goes on
     * (logMonitorEvaluationError, issue #8069).
     */
    logMonitorEvaluationError({
      error: error,
      message: `Error while processing incoming request monitor: ${monitor.id?.toString()}`,
      attributes: { projectId: monitor.projectId?.toString() },
    });
  }
};

/*
 * "Monitor Status Check At", as the Dashboard shows it: written for every
 * monitor every 30 seconds, it was a Monitor row write per monitor per
 * sweep (single statement, no hooks). Now at most every few minutes
 * (MonitorHeartbeatState.CHECK_STAMP_WRITE_EVERY_SECONDS) - a request the
 * monitor receives also writes it, with the request.
 */
const stampStatusCheckedAt: (monitor: Monitor) => Promise<void> = async (
  monitor: Monitor,
): Promise<void> => {
  if (
    !(await MonitorHeartbeatState.isWriteDue({
      monitorId: monitor.id!,
      write: HeartbeatWrite.IncomingRequestCheck,
    }))
  ) {
    return;
  }

  await MonitorService.updateColumnsByIdWithoutHooks({
    id: monitor.id!,
    data: {
      incomingRequestMonitorHeartbeatCheckedAt: OneUptimeDate.getCurrentDate(),
    },
  });

  await MonitorHeartbeatState.markWritten({
    monitorId: monitor.id!,
    write: HeartbeatWrite.IncomingRequestCheck,
    everySeconds: MonitorHeartbeatState.CHECK_STAMP_WRITE_EVERY_SECONDS,
  });
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
