/*
 * The recurrence cadence of a Network Device Discovery Scan: how often a
 * recurring scan re-runs, and when the next run is due.
 *
 * WHY IT LIVES IN Common
 *
 * Four places have an opinion about this number and they must not disagree:
 *
 *   - the create/edit form (App Dashboard, DiscoveryScanFormValidation) — so
 *     the operator is told the floor before they save, not after;
 *   - the write hooks (Common server service) — which derive `nextScanAt` on
 *     an edit, because the requeue worker only ever looks at that column and
 *     a NULL there means "never runs again";
 *   - the probe-ingest result endpoint (App Telemetry) — which stamps
 *     `nextScanAt` when a run finishes;
 *   - the requeue worker (App Workers) — which is sized against this floor.
 *
 * The floor and the clamp used to be written out three times, in three
 * packages, with three chances to drift. Same reason ScanTargetUtil and
 * ScanNameUtil sit next door.
 */

import OneUptimeDate from "../../Types/Date";

/*
 * The shortest cadence a recurring discovery scan may run at.
 *
 * A sweep is bounded but heavy: at the ScanTargetUtil.MAX_SCAN_HOSTS ceiling
 * (32,768 addresses) it can take the better part of an hour, and a probe runs
 * one sweep at a time. Re-queueing more often than this simply stacks scans on
 * the probe, which never catches up.
 */
export const MINIMUM_RESCAN_INTERVAL_IN_MINUTES: number = 15;

export type ClampRescanIntervalFunction = (
  intervalInMinutes: number | null | undefined,
) => number | null;

/*
 * The cadence a stored interval actually runs at.
 *
 * Clamped rather than rejected, and that is deliberate: rows written before
 * the form enforced a floor — and rows written by an API client, which the
 * server does not refuse — still recur, just no faster than the probe can
 * keep up with. Returns null for a value that does not describe a cadence at
 * all (absent, zero, negative, NaN), which is the caller's signal that there
 * is no next run to schedule.
 */
export const clampRescanIntervalInMinutes: ClampRescanIntervalFunction = (
  intervalInMinutes: number | null | undefined,
): number | null => {
  if (
    typeof intervalInMinutes !== "number" ||
    !isFinite(intervalInMinutes) ||
    intervalInMinutes <= 0
  ) {
    return null;
  }

  return Math.max(intervalInMinutes, MINIMUM_RESCAN_INTERVAL_IN_MINUTES);
};

/*
 * The scan state that decides when — or whether — a scan runs again. Kept
 * structural rather than typed as the model, so a partially-selected row
 * satisfies it and so this module does not drag a database model into the
 * Probe's bundle. Same shape rule as ScanNameUtil.
 */
export interface RescanScheduleInput {
  isRecurring?: boolean | null | undefined;
  rescanIntervalInMinutes?: number | null | undefined;
  /*
   * "Pending" / "In Progress" / "Completed" / "Failed". A run that is still
   * queued or in flight has no next run to schedule yet — the ingest endpoint
   * stamps one when it reports.
   */
  status?: string | null | undefined;
  // When the last run finished. The clock the next run is measured from.
  completedAt?: Date | null | undefined;
}

export type GetNextScanAtFunction = (
  scan: RescanScheduleInput,
  now: Date,
) => Date | null;

/*
 * When a scan is next due, derived from the scan itself.
 *
 * `nextScanAt` is not an independent fact, it is a function of the recurrence
 * settings and the last completion — which is exactly why it can be recomputed
 * when those settings change. Before it was derived, the only writer was the
 * result-ingest endpoint at the moment a run finished, so turning recurrence
 * ON for a scan that had already completed stamped nothing: the column stayed
 * NULL, `("nextScanAt" <= now)` is UNKNOWN for NULL, and the requeue worker
 * never matched the row again. The scan advertised "Every 60 min" in the list
 * and never ran (OneUptime issue #3444).
 *
 * The value returned for an unchanged, already-recurring scan is the same one
 * the ingest endpoint stamped (it wrote `completedAt + interval` too), so
 * recomputing is a no-op rather than a rescheduling.
 *
 *   - not recurring, or no usable interval -> null, i.e. never
 *   - still Pending or In Progress -> null; the run in flight will stamp it
 *   - Completed / Failed -> the moment one interval after it finished. Already
 *     in the past is fine and means "due now": the worker's predicate is
 *     `nextScanAt <= now`.
 */
export const getNextScanAt: GetNextScanAtFunction = (
  scan: RescanScheduleInput,
  now: Date,
): Date | null => {
  if (!scan.isRecurring) {
    return null;
  }

  const intervalInMinutes: number | null = clampRescanIntervalInMinutes(
    scan.rescanIntervalInMinutes,
  );

  if (intervalInMinutes === null) {
    return null;
  }

  if (scan.status !== "Completed" && scan.status !== "Failed") {
    return null;
  }

  /*
   * A Completed row without a completedAt should not exist — every writer of
   * one writes the other — but a row hand-edited or written by an older build
   * still deserves a next run rather than being stranded, so it is scheduled
   * from now.
   */
  const lastRunAt: Date = scan.completedAt || now;

  /*
   * Deliberately NOT clamped forward to `now`. A moment already in the past is
   * a correct answer — it means "due, and the worker has not got to it yet" —
   * and clamping would cost the property that makes this safe to re-derive on
   * every save: the same row always produces the same answer, so re-posting an
   * unchanged schedule writes nothing.
   */
  return OneUptimeDate.addRemoveMinutes(
    OneUptimeDate.fromString(lastRunAt),
    intervalInMinutes,
  );
};
