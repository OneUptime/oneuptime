import { EVERY_DAY } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorStatusTimelineReconciler, {
  RepairStaleOpenRowsResult,
} from "Common/Server/Utils/Monitor/MonitorStatusTimelineReconciler";
import ObjectID from "Common/Types/ObjectID";

/*
 * Repairs MonitorStatusTimeline rows that were left open (endsAt IS NULL) even though a later
 * row exists on the same monitor. These are produced by a race on the write path: two probe
 * results for the same monitor resolve the same predecessor and both INSERT a status row
 * milliseconds apart, and only the later one is ever closed.
 *
 * An orphaned open row poisons everything downstream of it:
 *   - status page uptime queries pull open rows in with no lower date bound, so a months-old
 *     orphan lands inside a 30 day report window,
 *   - uptime math treats an open row as running until the next event, so a single orphan can
 *     render as months of phantom downtime.
 *
 * It also breaks this job's original purpose. MonitorService.refreshMonitorCurrentStatus
 * resolves the current status with findOneBy({ monitorId, endsAt: isNull() }) and no sort,
 * which falls back to ORDER BY createdAt DESC. While several open rows exist that query can
 * return the orphan rather than the true current row - createdAt is DB-side now() and startsAt
 * is the worker pod's clock, and on real data the two orderings disagree. So refreshing a
 * monitor's current status is only safe AFTER its stale rows are closed, at which point exactly
 * one open row remains and the lookup is unambiguous. That is the order used below, and the
 * refresh is deliberately limited to monitors this run actually repaired.
 */

RunCron(
  "Monitor:KeepCurrentStateConsistent",
  { schedule: EVERY_DAY, runOnStartup: true },
  async () => {
    try {
      const result: RepairStaleOpenRowsResult =
        await MonitorStatusTimelineReconciler.repairStaleOpenRows({});

      if (result.repaired > 0) {
        /*
         * Warn rather than log: once the backlog has been cleared, a steady state run should
         * repair nothing. A non-zero count on a later run means the write path is still leaking
         * orphaned open rows and someone should look at it.
         */
        logger.warn(
          `Monitor:KeepCurrentStateConsistent - repaired ${result.repaired} stale open monitor status timeline row(s) across ${result.repairedMonitorIds.length} monitor(s) (${result.scanned} open row(s) examined, ${result.monitorsWithStaleRows} monitor(s) affected). A non-zero count once the backlog is cleared means the write path is still creating orphaned rows.`,
        );
      } else {
        logger.debug(
          `Monitor:KeepCurrentStateConsistent - no stale open monitor status timeline rows found (${result.scanned} open row(s) examined).`,
        );
      }

      if (result.failedMonitorIds.length > 0) {
        logger.error(
          `Monitor:KeepCurrentStateConsistent - failed to reconcile ${result.failedMonitorIds.length} monitor(s): ${result.failedMonitorIds
            .map((monitorId: ObjectID) => {
              return monitorId.toString();
            })
            .join(", ")}`,
        );
      }

      /*
       * Now that each repaired monitor has exactly one open row, its current status can be
       * resolved unambiguously. Monitors that failed to reconcile are intentionally skipped -
       * they still have several open rows, so refreshing them could pin the wrong status.
       *
       * A monitor can be in BOTH sets: repairedMonitorIds records any successful batch, and a
       * multi-batch backlog that fails in a LATER round leaves the monitor repaired-then-failed
       * with open rows remaining. Those must be skipped too, so failed always wins.
       */
      const failedMonitorIdSet: Set<string> = new Set<string>(
        result.failedMonitorIds.map((monitorId: ObjectID) => {
          return monitorId.toString();
        }),
      );

      const monitorIdsSafeToRefresh: Array<ObjectID> =
        result.repairedMonitorIds.filter((monitorId: ObjectID) => {
          return !failedMonitorIdSet.has(monitorId.toString());
        });

      for (const monitorId of monitorIdsSafeToRefresh) {
        try {
          await MonitorService.refreshMonitorCurrentStatus(monitorId);
        } catch (err) {
          logger.error(
            `Error in Monitor:KeepCurrentStateConsistent job while refreshing current status for monitor ${monitorId.toString()}`,
          );
          logger.error(err);
          continue;
        }
      }
    } catch (err) {
      logger.error("Error in Monitor:KeepCurrentStateConsistent job");
      logger.error(err);
    }
  },
);
