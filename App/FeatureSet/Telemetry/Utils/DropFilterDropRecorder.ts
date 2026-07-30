import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import logger from "Common/Server/Utils/Logger";
import AppMetrics from "Common/Server/Utils/Telemetry/AppMetrics";
import LogDropFilterService from "Common/Server/Services/LogDropFilterService";
import TraceDropFilterService from "Common/Server/Services/TraceDropFilterService";

/*
 * Makes drop-filter drops visible.
 *
 * A drop filter used to discard telemetry with no record of any kind: no
 * log line, no metric, no counter, and `totalLogsProcessed` counted only
 * survivors. When a customer reported missing logs there was nothing to
 * look at — support had to read the project's filter rows out of Postgres
 * by hand and reason about what they would have matched.
 *
 * Two outputs, for two different audiences:
 *
 *   - `oneuptime.telemetry.ingest.dropped.count` (OTel counter) — for whoever
 *     operates the OneUptime instance. Immediate, per-signal, per-project.
 *   - `droppedCount` / `lastDroppedAt` on the filter row — for the customer,
 *     rendered in the Drop Filters list and view pages so "is this filter
 *     eating my logs?" is answerable without opening a ticket.
 *
 * The hard constraint is that this sits on the per-record ingest path, so
 * it must not do IO per drop. Drops accumulate in memory keyed by filter
 * and are flushed to Postgres on a throttle, batching an arbitrary number
 * of dropped records into one atomic UPDATE per filter.
 *
 * Losing an in-memory delta on process exit is acceptable: these counters
 * exist to answer "is this filter matching, and roughly how much", not to
 * bill anyone. The metric is emitted synchronously and is unaffected.
 */

export enum DropFilterSignal {
  Logs = "logs",
  Traces = "traces",
}

export const FLUSH_INTERVAL_MS: number = 15 * 1000;

interface PendingDrops {
  projectId: ObjectID;
  filterId: ObjectID;
  signal: DropFilterSignal;
  count: number;
  lastDroppedAt: Date;
}

/*
 * Keyed by `${signal}:${filterId}`. A filter id is unique across the two
 * tables in practice, but the signal keeps the two flush destinations
 * unambiguous without relying on that.
 */
const pendingBySignalAndFilter: Map<string, PendingDrops> = new Map();

let lastFlushAt: number = 0;
let flushInFlight: boolean = false;

function keyFor(signal: DropFilterSignal, filterId: ObjectID): string {
  return `${signal}:${filterId.toString()}`;
}

/*
 * Record one dropped record. Cheap and synchronous: a metric add and a map
 * bump, plus a throttled fire-and-forget flush.
 */
export function recordDroppedRecord(input: {
  projectId: ObjectID;
  filterId: ObjectID;
  signal: DropFilterSignal;
  action: string;
  count?: number | undefined;
}): void {
  const count: number = input.count === undefined ? 1 : input.count;

  if (count <= 0) {
    return;
  }

  try {
    AppMetrics.getIngestDroppedCounter().add(count, {
      "telemetry.signal": input.signal,
      "oneuptime.drop_filter.action": input.action,
      "oneuptime.project.id": input.projectId.toString(),
      "oneuptime.drop_filter.id": input.filterId.toString(),
    });
  } catch (err) {
    /*
     * Telemetry about telemetry must never break ingest. If the meter
     * provider isn't wired up (unit tests, a partially booted process),
     * keep accumulating for the DB flush and move on.
     */
    logger.debug(
      `DropFilterDropRecorder: failed to emit dropped counter: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const key: string = keyFor(input.signal, input.filterId);
  const existing: PendingDrops | undefined = pendingBySignalAndFilter.get(key);

  if (existing) {
    existing.count += count;
    existing.lastDroppedAt = OneUptimeDate.getCurrentDate();
  } else {
    pendingBySignalAndFilter.set(key, {
      projectId: input.projectId,
      filterId: input.filterId,
      signal: input.signal,
      count: count,
      lastDroppedAt: OneUptimeDate.getCurrentDate(),
    });
  }

  maybeFlush();
}

function maybeFlush(): void {
  const now: number = Date.now();

  if (flushInFlight) {
    return;
  }

  /*
   * First drop after a quiet period should not wait a full interval — but
   * it must not flush on literally every drop either, so seed the clock on
   * the first call rather than treating lastFlushAt=0 as "long overdue".
   */
  if (lastFlushAt === 0) {
    lastFlushAt = now;
    return;
  }

  if (now - lastFlushAt < FLUSH_INTERVAL_MS) {
    return;
  }

  void flushDroppedCounts();
}

/*
 * Drain the accumulator into Postgres. Safe to call directly (tests, or a
 * shutdown hook); never throws.
 */
export async function flushDroppedCounts(): Promise<void> {
  if (flushInFlight) {
    return;
  }

  flushInFlight = true;
  lastFlushAt = Date.now();

  /*
   * Take the whole batch out of the map up front so drops that land while
   * we await are accumulated for the NEXT flush instead of being dropped
   * on the floor by a clear() after the fact.
   */
  const batch: Array<PendingDrops> = Array.from(
    pendingBySignalAndFilter.values(),
  );
  pendingBySignalAndFilter.clear();

  try {
    for (const pending of batch) {
      try {
        if (pending.signal === DropFilterSignal.Logs) {
          await LogDropFilterService.addToDroppedCount({
            id: pending.filterId,
            count: pending.count,
            lastDroppedAt: pending.lastDroppedAt,
          });
        } else {
          await TraceDropFilterService.addToDroppedCount({
            id: pending.filterId,
            count: pending.count,
            lastDroppedAt: pending.lastDroppedAt,
          });
        }
      } catch (err) {
        /*
         * A filter deleted between the drop and the flush is the expected
         * benign case (the UPDATE simply matches no rows, but a dead
         * connection or a lock timeout lands here too). Do not put the
         * delta back: retrying forever on an unwritable row would grow the
         * map without bound. Log and let the metric carry the signal.
         */
        logger.warn(
          `DropFilterDropRecorder: failed to persist ${pending.count} ${pending.signal} drops for filter ${pending.filterId.toString()}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  } finally {
    flushInFlight = false;
  }
}

/*
 * Test seam. Clears the accumulator and the throttle clock so each test
 * starts from a known state.
 */
export function resetDropRecorderForTests(): void {
  pendingBySignalAndFilter.clear();
  lastFlushAt = 0;
  flushInFlight = false;
}

/*
 * Test/diagnostic read of the un-flushed accumulator.
 */
export function getPendingDropCountForTests(
  signal: DropFilterSignal,
  filterId: ObjectID,
): number {
  return pendingBySignalAndFilter.get(keyFor(signal, filterId))?.count || 0;
}
