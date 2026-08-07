import DataMigrationBase from "./DataMigrationBase";
import logger from "Common/Server/Utils/Logger";
import MonitorActiveMonitoringTimelineReconciler, {
  ActiveMonitoringTimelineRepairResult,
} from "Common/Server/Utils/Monitor/MonitorActiveMonitoringTimelineReconciler";
import ObjectID from "Common/Types/ObjectID";

/**
 * Establish a no-data boundary for monitors that were already directly
 * disabled before pause/resume timeline handling was introduced.
 *
 * Monitor.updatedAt is the closest persisted boundary available for legacy
 * rows, so the shared reconciler uses it while re-reading the live flag under
 * the timeline mutex. This stops disabled monitors from accruing fabricated
 * green uptime after deployment. Runtime hooks record exact boundaries for new
 * transitions, and the startup/hourly reconciler covers writes from old pods
 * that race this migration during a rolling deployment.
 */
export default class CloseOpenMonitorStatusTimelinesForDisabledMonitors extends DataMigrationBase {
  public constructor() {
    super("CloseOpenMonitorStatusTimelinesForDisabledMonitors");
  }

  public override async migrate(): Promise<void> {
    const result: ActiveMonitoringTimelineRepairResult =
      await MonitorActiveMonitoringTimelineReconciler.repairMismatches();

    logger.debug(
      `CloseOpenMonitorStatusTimelinesForDisabledMonitors: examined ${result.monitorsExamined} mismatched monitor(s), paused ${result.paused}, resumed ${result.resumed}.`,
    );

    if (result.failedMonitorIds.length > 0) {
      throw new Error(
        `Failed to reconcile active-monitoring timelines for ${result.failedMonitorIds.length} monitor(s): ${result.failedMonitorIds
          .map((monitorId: ObjectID) => {
            return monitorId.toString();
          })
          .join(
            ", ",
          )}. Not marking this migration executed so it can be retried safely.`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    /*
     * Reopening these rows would turn disabled time back into fabricated
     * healthy/downtime history, and the original disable timestamp cannot be
     * recovered. The forward repair is intentionally irreversible.
     */
    return;
  }
}
