import DataMigrationBase from "./DataMigrationBase";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import MonitorService from "Common/Server/Services/MonitorService";
import { FIRST_MEASURED_AT_UPTIME_HISTORY_MIGRATION_NAME } from "Common/Server/Services/MonitorStatusTimelineService";
import logger from "Common/Server/Utils/Logger";
import MonitorType from "Common/Types/Monitor/MonitorType";

/*
 * Makes Monitor.firstMeasuredAt safe for a monitor's uptime HISTORY (issue
 * #8960), after BackfillMonitorFirstMeasuredAt has stamped it.
 *
 * Since #8960 a monitor's uptime bars and percentages leave out the time
 * before its first check: every monitor is created in the operational
 * status, which nothing stands behind until something has measured it. For
 * a monitor created before the column existed, the time "before its first
 * check" is only what the column says, and two kinds of monitor were left
 * with a time later than their real first check:
 *
 *   - Monitors a result stamped during the upgrade. The column is added,
 *     the app starts, and every result that comes back stamps its monitor
 *     with now (MonitorFirstMeasured) - before BackfillMonitorFirstMeasuredAt,
 *     which runs with the other data migrations, can stamp it with its
 *     creation. Nearly every monitor that is checked every minute: read
 *     as it is, its history before the upgrade would read as no data.
 *   - Monitors OneUptime measures itself, which leave no trace the backfill
 *     reads: a Probe Status monitor, evaluated every minute from the probes'
 *     connection, and a Network Device monitor, evaluated on every poll of
 *     its device. An always-up one has one status event and nothing else.
 *
 * Each such monitor created before the backfill finished is stamped with
 * the time it was created, as the backfill stamps every monitor it knows
 * was measured: one stamped no later than the backfill finished (a result
 * got there first), a Probe Status monitor, and a Network Device monitor
 * whose device has been polled. A monitor stamped after the backfill
 * finished was first measured then - nothing had measured it before - and
 * keeps that time; so does a manual monitor, and one the backfill stamped.
 *
 * The uptime statements leave nothing out until this has run
 * (MonitorStatusTimelineService.getMeasuredFromCte reads its DataMigrations
 * row), so no history reads as no data while it is still being put right.
 *
 * Paged on the id, as the backfill is, so each statement writes a few
 * hundred rows at most. Idempotent: a monitor stamped with its creation is
 * not written again.
 */

// Taken from Common's service so App does not resolve its own typeorm copy.
type ModelRepository = ReturnType<DatabaseService<BaseModel>["getRepository"]>;

interface MonitorIdRow {
  _id: string;
}

interface ExecutedAtRow {
  executedAt: Date | string | null;
}

export const PAGE_SIZE: number = 500;

// The backfill this follows, whose finishing time it reads.
export const BACKFILL_MIGRATION_NAME: string = "BackfillMonitorFirstMeasuredAt";

export const BACKFILL_FINISHED_AT_SQL: string = `SELECT MIN("executedAt") AS "executedAt" FROM "DataMigrations" WHERE "name" = $1 AND "executed" = true AND "deletedAt" IS NULL`;

/*
 * For one page of monitor ids ($1), the backfill having finished at $2:
 * every monitor of the page, created before then, whose column is empty or
 * later than its creation, and that was measured before then.
 */
export const STAMP_MONITORS_MEASURED_BEFORE_SQL: string = `UPDATE "Monitor" AS "monitor" SET "firstMeasuredAt" = "monitor"."createdAt" WHERE "monitor"."_id" = ANY($1::uuid[]) AND "monitor"."monitorType" <> '${MonitorType.Manual}' AND "monitor"."createdAt" IS NOT NULL AND "monitor"."createdAt" < $2::timestamptz AND ("monitor"."firstMeasuredAt" IS NULL OR "monitor"."firstMeasuredAt" > "monitor"."createdAt") AND (("monitor"."firstMeasuredAt" IS NOT NULL AND "monitor"."firstMeasuredAt" <= $2::timestamptz) OR "monitor"."monitorType" = '${MonitorType.ProbeStatus}' OR ("monitor"."monitorType" = '${MonitorType.NetworkDevice}' AND EXISTS (SELECT 1 FROM "MonitorNetworkDevice" AS "link" JOIN "NetworkDevice" AS "device" ON "device"."_id" = "link"."networkDeviceId" WHERE "link"."monitorId" = "monitor"."_id" AND ("device"."lastPolledAt" IS NOT NULL OR "device"."lastPollReceivedAt" IS NOT NULL OR "device"."lastSeenAt" IS NOT NULL)))) RETURNING "monitor"."_id"`;

export default class BackfillMonitorFirstMeasuredAtForUptimeHistory extends DataMigrationBase {
  public constructor() {
    super(FIRST_MEASURED_AT_UPTIME_HISTORY_MIGRATION_NAME);
  }

  public override async migrate(): Promise<void> {
    const repository: ModelRepository = (
      MonitorService as unknown as DatabaseService<BaseModel>
    ).getRepository();

    const finished: Array<ExecutedAtRow> = (await repository.manager.query(
      BACKFILL_FINISHED_AT_SQL,
      [BACKFILL_MIGRATION_NAME],
    )) as Array<ExecutedAtRow>;

    const backfillFinishedAt: Date | null = finished[0]?.executedAt
      ? new Date(finished[0].executedAt)
      : null;

    /*
     * The runner runs this after the backfill, and stops the chain at a
     * failure, so the backfill has finished. Without its row there is no
     * upgrade to put right.
     */
    if (!backfillFinishedAt || Number.isNaN(backfillFinishedAt.getTime())) {
      logger.info(
        `${FIRST_MEASURED_AT_UPTIME_HISTORY_MIGRATION_NAME}: ${BACKFILL_MIGRATION_NAME} has not run, so no monitor was stamped during an upgrade.`,
      );
      return;
    }

    let lastId: string | null = null;
    let read: number = 0;
    let stamped: number = 0;
    let failed: number = 0;

    while (true) {
      // Every monitor, deleted ones too, as the backfill reads them.
      const rows: Array<MonitorIdRow> = (await repository.manager.query(
        `SELECT "_id" FROM "Monitor"${
          lastId ? ` WHERE "_id" > $2` : ""
        } ORDER BY "_id" ASC LIMIT $1`,
        lastId ? [PAGE_SIZE, lastId] : [PAGE_SIZE],
      )) as Array<MonitorIdRow>;

      if (rows.length === 0) {
        break;
      }

      read += rows.length;

      try {
        stamped += BackfillMonitorFirstMeasuredAtForUptimeHistory.countRows(
          await repository.manager.query(STAMP_MONITORS_MEASURED_BEFORE_SQL, [
            rows.map((row: MonitorIdRow): string => {
              return row._id;
            }),
            backfillFinishedAt,
          ]),
        );
      } catch (err) {
        /*
         * A page that fails holds no other back: its monitors keep the time
         * their first result stamped, and their history reads from it.
         */
        failed += rows.length;
        logger.error(
          `${FIRST_MEASURED_AT_UPTIME_HISTORY_MIGRATION_NAME}: the monitors after ${lastId || "the first"} were not stamped.`,
        );
        logger.error(err);
      }

      if (rows.length < PAGE_SIZE) {
        break;
      }

      lastId = rows[rows.length - 1]!._id;
    }

    logger.info(
      `${FIRST_MEASURED_AT_UPTIME_HISTORY_MIGRATION_NAME}: ${stamped} of ${read} monitors measured before ${backfillFinishedAt.toISOString()} now count from their creation, ${failed} could not be read.`,
    );
  }

  public override async rollback(): Promise<void> {
    return;
  }

  /*
   * TypeORM answers an UPDATE ... RETURNING on Postgres with [rows, count];
   * a driver that hands back the rows alone is counted by them.
   */
  public static countRows(result: unknown): number {
    if (
      Array.isArray(result) &&
      result.length === 2 &&
      Array.isArray(result[0]) &&
      typeof result[1] === "number"
    ) {
      return result[1];
    }

    if (Array.isArray(result)) {
      return result.length;
    }

    return 0;
  }
}
