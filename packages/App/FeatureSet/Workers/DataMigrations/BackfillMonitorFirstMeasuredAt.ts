import DataMigrationBase from "./DataMigrationBase";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import MonitorService from "Common/Server/Services/MonitorService";
import logger from "Common/Server/Utils/Logger";
import MonitorType from "Common/Types/Monitor/MonitorType";

/*
 * Stamps Monitor.firstMeasuredAt on every monitor that had been measured
 * before the column existed (issue #8899).
 *
 * The column is empty while nothing has measured a monitor, and the
 * Monitors list, the Monitor List widget and status pages say such a
 * monitor is waiting for its first check instead of Operational. A monitor
 * that is checked stamps it on its next result (MonitorFirstMeasured); this
 * is for the rest, and for the minutes before that next result: a monitor
 * whose monitoring is off, one paused by an incident or a maintenance
 * event, one whose probes are gone, one on a long schedule.
 *
 * A monitor counts as measured when anything left a trace of it:
 *
 *   - a manual monitor, always: its status is the one a person sets;
 *   - a probe's result on one of its probe rows (MonitorProbe
 *     .lastMonitoringLog), the time the page itself reads a probe check's
 *     results from;
 *   - an incoming request, an email or a server report that arrived (the
 *     latest is kept on the row), or an incoming request the secret check
 *     saw;
 *   - an evaluation of its telemetry the scheduler queued
 *     (telemetryMonitorLastMonitorAt);
 *   - a second event on its status timeline: something moved its status
 *     after it was created, which for a monitor something checks is that
 *     check, and for any other is a status that was recorded.
 *
 * Wrongly taken for measured, a monitor reads as it always did; wrongly
 * taken for never measured, it would say it is waiting until its next
 * result. So anything that may have measured a monitor counts. What is left
 * empty has nothing: no probe result, no heartbeat, no evaluation queued,
 * no status change - a monitor no probe ever checked, say, which said
 * Operational for good.
 *
 * It is stamped with the time the monitor was created: the upgrade knows it
 * had been measured, not when first, and its first check came after that.
 *
 * Paged on the id, so each statement writes a few hundred rows at most and
 * holds no lock for long on a table every heartbeat writes. Idempotent, and
 * safe to run twice at once: a monitor is written only while its column is
 * still empty, so a monitor stamped by its own result, or by the other run,
 * keeps that time.
 */

// Taken from Common's service so App does not resolve its own typeorm copy.
type ModelRepository = ReturnType<DatabaseService<BaseModel>["getRepository"]>;

interface MonitorIdRow {
  _id: string;
}

export const PAGE_SIZE: number = 500;

/*
 * The stamp, for one page of monitor ids ($1): every monitor of the page
 * whose column is empty and that left a trace of being measured.
 */
export const STAMP_MEASURED_MONITORS_SQL: string = `UPDATE "Monitor" AS "monitor" SET "firstMeasuredAt" = COALESCE("monitor"."createdAt", now()) WHERE "monitor"."_id" = ANY($1::uuid[]) AND "monitor"."firstMeasuredAt" IS NULL AND ("monitor"."monitorType" = '${MonitorType.Manual}' OR "monitor"."serverMonitorRequestReceivedAt" IS NOT NULL OR "monitor"."incomingMonitorRequest" IS NOT NULL OR "monitor"."incomingRequestWithSecretAt" IS NOT NULL OR "monitor"."incomingRequestWithoutSecretAt" IS NOT NULL OR "monitor"."incomingEmailMonitorLastEmailReceivedAt" IS NOT NULL OR "monitor"."incomingEmailMonitorRequest" IS NOT NULL OR "monitor"."telemetryMonitorLastMonitorAt" IS NOT NULL OR EXISTS (SELECT 1 FROM "MonitorProbe" AS "probe" WHERE "probe"."monitorId" = "monitor"."_id" AND "probe"."lastMonitoringLog" IS NOT NULL AND "probe"."lastMonitoringLog" <> '{}'::jsonb AND "probe"."lastMonitoringLog" <> 'null'::jsonb) OR EXISTS (SELECT 1 FROM "MonitorStatusTimeline" AS "timeline" WHERE "timeline"."monitorId" = "monitor"."_id" OFFSET 1 LIMIT 1)) RETURNING "monitor"."_id"`;

export default class BackfillMonitorFirstMeasuredAt extends DataMigrationBase {
  public constructor() {
    super("BackfillMonitorFirstMeasuredAt");
  }

  public override async migrate(): Promise<void> {
    const repository: ModelRepository = (
      MonitorService as unknown as DatabaseService<BaseModel>
    ).getRepository();
    let lastId: string | null = null;
    let read: number = 0;
    let stamped: number = 0;
    let failed: number = 0;

    while (true) {
      /*
       * Every monitor, deleted ones too: one restored later keeps what it
       * was measured by. Read by id alone, so the page is the same however
       * the stamps below change the rows.
       */
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
        stamped += BackfillMonitorFirstMeasuredAt.countRows(
          await repository.manager.query(STAMP_MEASURED_MONITORS_SQL, [
            rows.map((row: MonitorIdRow): string => {
              return row._id;
            }),
          ]),
        );
      } catch (err) {
        /*
         * A page that fails holds no other back: its monitors stamp
         * themselves on their next result, as a new monitor does.
         */
        failed += rows.length;
        logger.error(
          `BackfillMonitorFirstMeasuredAt: the monitors after ${lastId || "the first"} were not stamped.`,
        );
        logger.error(err);
      }

      if (rows.length < PAGE_SIZE) {
        break;
      }

      lastId = rows[rows.length - 1]!._id;
    }

    logger.info(
      `BackfillMonitorFirstMeasuredAt: ${stamped} of ${read} monitors had been measured, ${failed} could not be read.`,
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
