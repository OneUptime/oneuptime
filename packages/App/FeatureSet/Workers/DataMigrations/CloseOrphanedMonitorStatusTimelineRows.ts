import DataMigrationBase from "./DataMigrationBase";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import MonitorStatusTimelineReconciler, {
  DEFAULT_STALE_OPEN_ROW_BATCH_SIZE,
  RepairStaleOpenRowsResult,
} from "Common/Server/Utils/Monitor/MonitorStatusTimelineReconciler";

/*
 * Closes MonitorStatusTimeline rows that were orphaned with `endsAt = NULL`.
 *
 * Origin of the bad data: two probe results processed near-simultaneously both
 * resolved the SAME predecessor row, both passed the "status cannot be same as
 * previous" guard, and both INSERTed an open row milliseconds apart. Only the
 * later one was ever closed — every subsequent writer resolves its predecessor
 * with `ORDER BY startsAt DESC LIMIT 1`, which always returns the later row and
 * permanently shadows the earlier one. The earlier row stays open forever.
 *
 * Why this matters on the read path: the status page timeline query has no
 * lower date bound on open rows, so a single orphan from months ago is pulled
 * into every later report window and rendered as continuous downtime (the
 * customer-visible symptom was "113 days of downtime" inside a 31-day window).
 *
 * The repair itself lives in MonitorStatusTimelineReconciler.repairStaleOpenRows
 * so the read path, this migration and any future operator tooling all share ONE
 * implementation. Do NOT inline the SQL here — see the trap notes below.
 *
 * Traps this migration deliberately avoids (both existing
 * AddEndDateToMonitorStatusTimeline* migrations got these wrong and both
 * already ran in production):
 *
 *   - Chronology MUST be established with `startsAt`, never `createdAt`.
 *     `createdAt` is DB-side now(); `startsAt` is worker-pod moment(). They are
 *     different clocks with measured skew — in a 27-row sample, 12 rows had
 *     `createdAt > startsAt` and 15 the reverse. Ordering by `createdAt`
 *     produces confidently wrong pairings.
 *
 *   - A repaired row's `endsAt` MUST be the MIN `startsAt` of the row that
 *     follows it, never some other row's `startsAt`. Closing every older open
 *     row at the newest row's `startsAt` would convert ~8,041 near-zero-duration
 *     orphans into multi-month closed downtime rows — permanent, invisible to
 *     the read-path fix, and it would drive those resources to 0% uptime. That
 *     is strictly worse than the bug being fixed.
 *
 *   - The single latest open row per monitor is the monitor's CURRENT state and
 *     must be left open.
 *
 *   - Soft-deleted rows (`deletedAt IS NOT NULL`) are excluded.
 *
 * Batched and restartable by construction: repairStaleOpenRows commits per
 * batch and re-queries for remaining open rows, so a killed pod resumes where
 * it stopped. Idempotent: once a row is closed it no longer matches the
 * "open row that has a successor" predicate, so a re-run is a clean no-op.
 * This matters — 55,953 of the ~67,498 affected rows belong to a single monitor.
 */
export default class CloseOrphanedMonitorStatusTimelineRows extends DataMigrationBase {
  public constructor() {
    super("CloseOrphanedMonitorStatusTimelineRows");
  }

  public override async migrate(): Promise<void> {
    /*
     * No monitorId filter: this is the fleet-wide backfill. The reconciler's
     * default batch size keeps each round trip short so the single 55,953-row
     * monitor cannot hold locks on MonitorStatusTimeline long enough to stall
     * live probe writes, and it processes monitors round-robin so that monitor
     * cannot starve the rest of the fleet.
     */
    const result: RepairStaleOpenRowsResult =
      await MonitorStatusTimelineReconciler.repairStaleOpenRows({
        batchSize: DEFAULT_STALE_OPEN_ROW_BATCH_SIZE,
      });

    logger.debug(
      `CloseOrphanedMonitorStatusTimelineRows: scanned ${result.scanned} open row(s) across ${result.monitorsWithStaleRows} monitor(s), repaired ${result.repaired}.`,
    );

    /*
     * repairStaleOpenRows deliberately does NOT throw when an individual
     * monitor's repair fails — it collects the monitor and carries on, so one
     * bad monitor cannot abort a fleet-wide run. That is right for the runtime
     * caller, but wrong to ignore here: if this migration returned successfully
     * with monitors left unrepaired, the runner would record it as executed and
     * NEVER run it again, while duplicate open rows remained in the table — those
     * rows would keep corrupting uptime reports and the daily reconciler would be
     * the only thing left to clean them up.
     *
     * So: fail the migration instead. It is not recorded as executed, the chain
     * halts visibly, and because the repair is idempotent the retry is free.
     */
    if (result.failedMonitorIds.length > 0) {
      const failedIds: string = result.failedMonitorIds
        .map((id: ObjectID) => {
          return id.toString();
        })
        .join(", ");

      throw new Error(
        `Failed to repair stale open MonitorStatusTimeline rows for ${result.failedMonitorIds.length} monitor(s): ${failedIds}. Not marking this migration executed — the remaining open rows keep corrupting uptime reports until they are closed. Investigate those monitors and re-run (the repair is idempotent, so re-running is safe).`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    /*
     * Deliberately not reversible. The pre-migration state is "endsAt IS NULL"
     * for an unknown subset of the rows we just closed, and that subset is not
     * recoverable once written — re-opening rows by guessing would reintroduce
     * the phantom-downtime bug on the status pages this migration exists to fix.
     */
    return;
  }
}
