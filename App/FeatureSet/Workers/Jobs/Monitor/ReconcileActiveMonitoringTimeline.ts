import MonitorActiveMonitoringTimelineReconciler, {
  ActiveMonitoringTimelineRepairResult,
} from "Common/Server/Utils/Monitor/MonitorActiveMonitoringTimelineReconciler";
import logger from "Common/Server/Utils/Logger";
import { EVERY_HOUR } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";

/*
 * Worker jobs are stopped by Promise.race without cancelling their bodies.
 * Bound the recurring safety sweep so a large rollout backlog cannot overrun
 * and overlap the next invocation. Repaired rows disappear from the mismatch
 * query, so later hourly runs naturally continue through the backlog. The
 * one-time data migration deliberately remains unbounded.
 */
const MAXIMUM_RECONCILIATION_BATCHES_PER_RUN: number = 5;

RunCron(
  "Monitor:ReconcileActiveMonitoringTimeline",
  { schedule: EVERY_HOUR, runOnStartup: true },
  async () => {
    try {
      const result: ActiveMonitoringTimelineRepairResult =
        await MonitorActiveMonitoringTimelineReconciler.repairMismatches({
          maximumBatches: MAXIMUM_RECONCILIATION_BATCHES_PER_RUN,
        });

      if (result.monitorsExamined > 0) {
        logger.warn(
          `Monitor:ReconcileActiveMonitoringTimeline - repaired active-monitoring timeline drift for ${result.monitorsExamined - result.failedMonitorIds.length} monitor(s): paused ${result.paused}, resumed ${result.resumed}, failed ${result.failedMonitorIds.length}.`,
        );
      } else {
        logger.debug(
          "Monitor:ReconcileActiveMonitoringTimeline - no active-monitoring timeline drift found.",
        );
      }
    } catch (error) {
      logger.error("Error in Monitor:ReconcileActiveMonitoringTimeline job");
      logger.error(error);
    }
  },
);
