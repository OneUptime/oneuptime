import PostgresAppInstance, {
  DatabaseSource,
} from "../../Infrastructure/PostgresDatabase";
import DatabaseNotConnectedException from "../../../Types/Exception/DatabaseNotConnectedException";
import ObjectID from "../../../Types/ObjectID";
import { MonitorFeedEventType } from "../../../Models/DatabaseModels/MonitorFeed";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * A "stale open row" is a MonitorStatusTimeline row with endsAt IS NULL for which a row
 * with a strictly later startsAt exists on the same monitor.
 *
 * These are produced by a write-path race: two probe results for the same monitor can be
 * processed near-simultaneously, both resolve the same predecessor row, and both INSERT a
 * new status row milliseconds apart. Only the later one is ever closed, because every
 * subsequent writer resolves its predecessor with ORDER BY startsAt DESC LIMIT 1 and so
 * permanently shadows the earlier one. The earlier row keeps endsAt = NULL forever.
 *
 * An open row with no successor is the monitor's legitimate current-state row and MUST be
 * left open. Only rows that have been superseded are repaired here.
 *
 * The repaired endsAt is the MIN startsAt among strictly later rows on the same monitor -
 * i.e. the moment the row was actually superseded. It is deliberately NOT "now" and NOT the
 * startsAt of the newest row: closing an orphan at the newest row's startsAt would convert a
 * near-zero-duration orphan into a multi-month closed downtime row, which is unrecoverable
 * and strictly worse than leaving it open.
 */

export interface RepairStaleOpenRowsOptions {
  // Maximum number of open rows examined per monitor per round trip.
  batchSize?: number | undefined;
  // When set, only this monitor is reconciled. When unset, every affected monitor is.
  monitorId?: ObjectID | undefined;
}

export interface RepairStaleOpenRowsResult {
  // Open rows examined across every batch of this run.
  scanned: number;
  // Open rows that were given an endsAt by this run.
  repaired: number;
  // Monitors that had at least one stale open row when the run started.
  monitorsWithStaleRows: number;
  // Monitors that had at least one row repaired. Callers may want to refresh their current status.
  repairedMonitorIds: Array<ObjectID>;
  // Monitors whose repair threw. They are skipped, not retried, so one failure cannot abort a run.
  failedMonitorIds: Array<ObjectID>;
}

interface RepairBatchResult {
  scanned: number;
  repaired: number;
}

/*
 * Bounded so a single run never loads a pathological monitor's whole backlog into memory.
 * Production currently has ~67.5k stale rows, ~56k of them on ONE monitor.
 */
export const DEFAULT_STALE_OPEN_ROW_BATCH_SIZE: number = 1000;

const MIN_BATCH_SIZE: number = 1;
const MAX_BATCH_SIZE: number = 10000;

/*
 * Pure runaway guard. Every non-terminal round repairs exactly batchSize rows, so the loop
 * is already guaranteed to terminate; this only bounds a run if that invariant is ever broken.
 */
const MAX_ROUNDS: number = 100000;

/*
 * A MONITOR WITH NO STATUS TIMELINE LEFT.
 *
 * A status page draws a monitor's bars and uptime from its status timeline, so a monitor
 * with no row left is grey there - "no data" - even when it has been Operational all along.
 * Two things left monitors that way:
 *
 *   - OneUptime Cloud's retention purge, from December 2023 to March 2025, deleted every
 *     status timeline row whose startsAt was more than 120 days old. A monitor that had not
 *     changed status for 120 days lost its only row, its CURRENT status, and turned grey for
 *     good. Deletes by query now never take a monitor's current status
 *     (Types/StateTimeline/RowsKeptOnDelete), but the monitors already emptied stay grey.
 *   - A monitor whose first status row could not be written when it was created
 *     (MonitorService.createStatusTimelineWithRetry gives up after three lock failures). A
 *     Manual monitor is never probed, so nothing else ever writes one.
 *
 * The monitor itself still says what its status is (currentMonitorStatusId), so that status
 * is recorded again as one open row: from the last status change OneUptime has a record of
 * (the newest MonitorStatusChanged item of the monitor's feed), or else from when the monitor
 * was created - never later than now, never before the monitor existed. The row says what
 * happened in its root cause, notifies nobody (isOwnerNotified), and writes no feed item: no
 * status changed.
 *
 * Left alone: a deleted monitor, a monitor with no current status, one whose status is no
 * longer its project's (the row would name a status the monitor's project does not have), and
 * a monitor created in the last RESTORE_GRACE_PERIOD_IN_MINUTES, which may still be writing its
 * first row.
 */
export const RESTORED_STATUS_EVENT_ROOT_CAUSE: string =
  "Restored by OneUptime. This monitor's status history had been deleted, so OneUptime recorded its current status again, from the last status change it has a record of (or from when the monitor was created).";

// A monitor this new may still be writing its first status row (MonitorService.onCreateSuccess).
export const RESTORE_GRACE_PERIOD_IN_MINUTES: number = 60;

export const DEFAULT_RESTORE_BATCH_SIZE: number = 1000;

export interface RestoreMissingStatusTimelinesOptions {
  // Monitors restored per statement.
  batchSize?: number | undefined;
  // The clock, unless a test holds it.
  now?: Date | undefined;
}

export interface RestoreMissingStatusTimelinesResult {
  // Monitors given their current status back as a status timeline row.
  restored: number;
  restoredMonitorIds: Array<ObjectID>;
}

export default class MonitorStatusTimelineReconciler {
  /*
   * Finds and repairs stale open rows. Idempotent: a second run over the same data repairs
   * nothing, because a repaired row no longer matches endsAt IS NULL.
   *
   * Monitors are processed round-robin, one batch each per round, so a monitor with tens of
   * thousands of stale rows cannot starve the rest of the fleet.
   */
  @CaptureSpan()
  public static async repairStaleOpenRows(
    options: RepairStaleOpenRowsOptions = {},
  ): Promise<RepairStaleOpenRowsResult> {
    const batchSize: number = this.getBatchSize(options.batchSize);

    const monitorIds: Array<ObjectID> = options.monitorId
      ? [options.monitorId]
      : await this.getMonitorIdsWithStaleOpenRows();

    const result: RepairStaleOpenRowsResult = {
      scanned: 0,
      repaired: 0,
      monitorsWithStaleRows: monitorIds.length,
      repairedMonitorIds: [],
      failedMonitorIds: [],
    };

    if (monitorIds.length === 0) {
      logger.debug(
        "MonitorStatusTimelineReconciler: no monitors have stale open status timeline rows.",
      );
      return result;
    }

    logger.debug(
      `MonitorStatusTimelineReconciler: ${monitorIds.length} monitor(s) have stale open status timeline rows. Batch size ${batchSize}.`,
    );

    const repairedMonitorIds: Set<string> = new Set<string>();
    const failedMonitorIds: Set<string> = new Set<string>();

    let pendingMonitorIds: Array<ObjectID> = monitorIds;
    let round: number = 0;

    while (pendingMonitorIds.length > 0) {
      round++;

      if (round > MAX_ROUNDS) {
        logger.error(
          `MonitorStatusTimelineReconciler: aborting after ${MAX_ROUNDS} rounds with ${pendingMonitorIds.length} monitor(s) still pending. This should be unreachable.`,
        );
        break;
      }

      const stillPendingMonitorIds: Array<ObjectID> = [];

      for (const monitorId of pendingMonitorIds) {
        /*
         * Per-monitor try/catch, matching the sibling KeepCurrentStateConsistent jobs: one bad
         * monitor is skipped for the remainder of the run instead of aborting it. It is not
         * re-queued, so a monitor that fails deterministically cannot spin forever.
         */
        try {
          const batch: RepairBatchResult = await this.repairStaleOpenRowsBatch({
            monitorId: monitorId,
            batchSize: batchSize,
          });

          result.scanned += batch.scanned;
          result.repaired += batch.repaired;

          if (batch.repaired > 0) {
            repairedMonitorIds.add(monitorId.toString());
          }

          /*
           * A full batch of repairs means there may be more stale rows on this monitor. Anything
           * short of a full batch means every open row on this monitor has now been examined -
           * whatever is still open has no strictly later row and is therefore legitimate.
           */
          if (batch.repaired >= batchSize) {
            stillPendingMonitorIds.push(monitorId);
          }
        } catch (err) {
          failedMonitorIds.add(monitorId.toString());
          logger.error(
            `MonitorStatusTimelineReconciler: failed to repair stale open rows for monitor ${monitorId.toString()}.`,
          );
          logger.error(err);
          continue;
        }
      }

      pendingMonitorIds = stillPendingMonitorIds;
    }

    result.repairedMonitorIds = Array.from(repairedMonitorIds).map(
      (id: string) => {
        return new ObjectID(id);
      },
    );

    result.failedMonitorIds = Array.from(failedMonitorIds).map((id: string) => {
      return new ObjectID(id);
    });

    return result;
  }

  /*
   * Counts stale open rows without repairing anything. Useful for telemetry and for asserting
   * that a repair run actually converged.
   */
  @CaptureSpan()
  public static async countStaleOpenRows(
    options: { monitorId?: ObjectID | undefined } = {},
  ): Promise<number> {
    const dataSource: DatabaseSource = this.getDataSource();

    const parameters: Array<string> = [];
    let monitorFilter: string = "";

    if (options.monitorId) {
      monitorFilter = `AND t."monitorId" = $1::uuid`;
      parameters.push(options.monitorId.toString());
    }

    const sql: string = `
      SELECT COUNT(*)::int AS "staleCount"
      FROM "MonitorStatusTimeline" t
      WHERE t."endsAt" IS NULL
        AND t."deletedAt" IS NULL
        AND t."startsAt" IS NOT NULL
        ${monitorFilter}
        AND EXISTS (
          SELECT 1
          FROM "MonitorStatusTimeline" n
          WHERE n."monitorId" = t."monitorId"
            AND n."deletedAt" IS NULL
            AND n."startsAt" > t."startsAt"
        )
    `;

    const rows: Array<{ staleCount: number }> = await dataSource.query(
      sql,
      parameters,
    );

    return rows[0]?.staleCount || 0;
  }

  /*
   * The set of monitors that currently have at least one stale open row.
   *
   * Note this is deliberately NOT "monitors with more than one open row". A monitor can have
   * exactly one open row that is still stale, if the newest row on the monitor happens to be
   * closed. Encoding the definition directly keeps both cases covered.
   */
  private static async getMonitorIdsWithStaleOpenRows(): Promise<
    Array<ObjectID>
  > {
    const dataSource: DatabaseSource = this.getDataSource();

    const sql: string = `
      SELECT DISTINCT t."monitorId" AS "monitorId"
      FROM "MonitorStatusTimeline" t
      WHERE t."endsAt" IS NULL
        AND t."deletedAt" IS NULL
        AND t."startsAt" IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM "MonitorStatusTimeline" n
          WHERE n."monitorId" = t."monitorId"
            AND n."deletedAt" IS NULL
            AND n."startsAt" > t."startsAt"
        )
      ORDER BY t."monitorId" ASC
    `;

    const rows: Array<{ monitorId: string }> = await dataSource.query(sql);

    return rows.map((row: { monitorId: string }) => {
      return new ObjectID(row.monitorId);
    });
  }

  /*
   * Repairs up to batchSize stale open rows on a single monitor, oldest first.
   *
   * Ordering is by startsAt, NEVER createdAt. createdAt is assigned DB-side by now() while
   * startsAt is assigned by the worker pod's clock, so the two orderings genuinely disagree on
   * real data. Two earlier migrations ordered by createdAt and produced wrong results.
   */
  private static async repairStaleOpenRowsBatch(data: {
    monitorId: ObjectID;
    batchSize: number;
  }): Promise<RepairBatchResult> {
    const dataSource: DatabaseSource = this.getDataSource();

    /*
     * candidates is materialised once (a data-modifying CTE forces materialisation), so the
     * counts below and the UPDATE all see the same snapshot and one round trip yields both the
     * scanned and the repaired count.
     *
     * nextStartsAt is NULL for an open row with no strictly later row. Those rows are the
     * legitimate current-state row (or a startsAt tie at the head of the timeline) and are
     * excluded from the UPDATE, so they stay open.
     *
     * The UPDATE re-checks m."endsAt" IS NULL even though candidates already filtered on it:
     * the reconciler runs WITHOUT the per-monitor mutex, and under READ COMMITTED a live
     * writer can close a candidate row between this statement's snapshot and the UPDATE
     * taking the row lock. Postgres then re-evaluates only the UPDATE's own WHERE against
     * the new row version (EvalPlanQual), so the openness check must live in the UPDATE
     * itself - otherwise the reconciler would overwrite the endsAt the writer just committed
     * with its stale snapshot-time value.
     */
    const sql: string = `
      WITH candidates AS (
        SELECT
          t."_id" AS "_id",
          (
            SELECT MIN(n."startsAt")
            FROM "MonitorStatusTimeline" n
            WHERE n."monitorId" = t."monitorId"
              AND n."deletedAt" IS NULL
              AND n."startsAt" > t."startsAt"
          ) AS "nextStartsAt"
        FROM "MonitorStatusTimeline" t
        WHERE t."monitorId" = $1::uuid
          AND t."endsAt" IS NULL
          AND t."deletedAt" IS NULL
          AND t."startsAt" IS NOT NULL
        ORDER BY t."startsAt" ASC
        LIMIT $2
      ),
      repaired AS (
        UPDATE "MonitorStatusTimeline" m
        SET "endsAt" = c."nextStartsAt",
            "updatedAt" = NOW(),
            "version" = m."version" + 1
        FROM candidates c
        WHERE m."_id" = c."_id"
          AND m."endsAt" IS NULL
          AND c."nextStartsAt" IS NOT NULL
        RETURNING m."_id"
      )
      SELECT
        (SELECT COUNT(*) FROM candidates)::int AS "scanned",
        (SELECT COUNT(*) FROM repaired)::int AS "repaired"
    `;

    const rows: Array<{ scanned: number; repaired: number }> =
      await dataSource.query(sql, [
        data.monitorId.toString(),
        data.batchSize.toString(),
      ]);

    const scanned: number = rows[0]?.scanned || 0;
    const repaired: number = rows[0]?.repaired || 0;

    if (repaired > 0) {
      logger.debug(
        `MonitorStatusTimelineReconciler: repaired ${repaired} of ${scanned} open row(s) examined on monitor ${data.monitorId.toString()}.`,
      );
    }

    return {
      scanned: scanned,
      repaired: repaired,
    };
  }

  /*
   * Gives every monitor with no status timeline left its current status back as one row (see
   * RESTORED_STATUS_EVENT_ROOT_CAUSE above). Idempotent: a restored monitor has a row, so a
   * second run restores nothing. Batched, a statement per batch, until a batch comes back short.
   */
  @CaptureSpan()
  public static async restoreMissingStatusTimelines(
    options: RestoreMissingStatusTimelinesOptions = {},
  ): Promise<RestoreMissingStatusTimelinesResult> {
    const batchSize: number = this.getBatchSize(
      options.batchSize || DEFAULT_RESTORE_BATCH_SIZE,
    );

    const now: Date = options.now || new Date();

    const createdBefore: Date = new Date(
      now.getTime() - RESTORE_GRACE_PERIOD_IN_MINUTES * 60 * 1000,
    );

    const restoredMonitorIds: Array<ObjectID> = [];

    for (let round: number = 1; round <= MAX_ROUNDS; round++) {
      const restored: Array<ObjectID> =
        await this.restoreMissingStatusTimelinesBatch({
          batchSize: batchSize,
          createdBefore: createdBefore,
          now: now,
        });

      restoredMonitorIds.push(...restored);

      if (restored.length < batchSize) {
        break;
      }
    }

    if (restoredMonitorIds.length > 0) {
      logger.debug(
        `MonitorStatusTimelineReconciler: restored the current status of ${restoredMonitorIds.length} monitor(s) that had no status timeline left.`,
      );
    }

    return {
      restored: restoredMonitorIds.length,
      restoredMonitorIds: restoredMonitorIds,
    };
  }

  /*
   * One statement: up to batchSize monitors with no live status timeline row, each given one.
   *
   * Two runs at once - two workers starting together - must not both restore the same monitor:
   * the second row would be an open twin of the first, with the same start, which nothing
   * closes. So the statement takes a transaction-level advisory lock first, and does nothing
   * when another statement holds it; the next batch, or the next run, sees what the first one
   * committed. NOT EXISTS reads the live rows only: a row deleted before is no status.
   *
   * The (monitorId, startsAt) index answers each NOT EXISTS, so a run costs a probe per
   * monitor; only a monitor that has no row left has its feed read, through its monitorId.
   */
  private static async restoreMissingStatusTimelinesBatch(data: {
    batchSize: number;
    createdBefore: Date;
    now: Date;
  }): Promise<Array<ObjectID>> {
    const dataSource: DatabaseSource = this.getDataSource();

    const sql: string = `
      WITH run AS (
        SELECT pg_try_advisory_xact_lock(
          hashtext('MonitorStatusTimelineReconciler.restoreMissingStatusTimelines')
        ) AS "mayRun"
      ),
      missing AS (
        SELECT m."_id" AS "monitorId",
               m."projectId" AS "projectId",
               m."currentMonitorStatusId" AS "monitorStatusId",
               m."createdAt" AS "monitorCreatedAt"
        FROM "Monitor" m
        WHERE (SELECT "mayRun" FROM run)
          AND m."deletedAt" IS NULL
          AND m."currentMonitorStatusId" IS NOT NULL
          AND m."createdAt" < $1
          AND NOT EXISTS (
            SELECT 1
            FROM "MonitorStatusTimeline" t
            WHERE t."monitorId" = m."_id"
              AND t."deletedAt" IS NULL
          )
          AND EXISTS (
            SELECT 1
            FROM "MonitorStatus" s
            WHERE s."_id" = m."currentMonitorStatusId"
              AND s."projectId" = m."projectId"
              AND s."deletedAt" IS NULL
          )
        ORDER BY m."_id" ASC
        LIMIT $2
      )
      INSERT INTO "MonitorStatusTimeline" (
        "projectId",
        "monitorId",
        "monitorStatusId",
        "isOwnerNotified",
        "rootCause",
        "startsAt",
        "version"
      )
      SELECT missing."projectId",
             missing."monitorId",
             missing."monitorStatusId",
             TRUE,
             $3,
             LEAST(
               GREATEST(
                 (
                   SELECT MAX(COALESCE(f."postedAt", f."createdAt"))
                   FROM "MonitorFeed" f
                   WHERE f."monitorId" = missing."monitorId"
                     AND f."monitorFeedEventType" = $4
                     AND f."deletedAt" IS NULL
                 ),
                 missing."monitorCreatedAt"
               ),
               $5::timestamptz
             ),
             1
      FROM missing
      RETURNING "monitorId"
    `;

    const rows: Array<{ monitorId: string }> = await dataSource.query(sql, [
      data.createdBefore,
      data.batchSize,
      RESTORED_STATUS_EVENT_ROOT_CAUSE,
      MonitorFeedEventType.MonitorStatusChanged,
      data.now,
    ]);

    return rows.map((row: { monitorId: string }): ObjectID => {
      return new ObjectID(row.monitorId);
    });
  }

  private static getBatchSize(batchSize?: number | undefined): number {
    if (
      !batchSize ||
      !Number.isFinite(batchSize) ||
      batchSize < MIN_BATCH_SIZE
    ) {
      return DEFAULT_STALE_OPEN_ROW_BATCH_SIZE;
    }

    return Math.min(Math.floor(batchSize), MAX_BATCH_SIZE);
  }

  private static getDataSource(): DatabaseSource {
    const dataSource: DatabaseSource | null =
      PostgresAppInstance.getDataSource();

    if (!dataSource) {
      throw new DatabaseNotConnectedException();
    }

    return dataSource;
  }
}
