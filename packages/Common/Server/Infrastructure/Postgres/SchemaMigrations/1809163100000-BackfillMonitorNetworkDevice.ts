import {
  MONITOR_NETWORK_DEVICE_IDS_FUNCTION,
  NETWORK_DEVICE_MONITOR_TYPE,
} from "./1809163000000-AddMonitorNetworkDevice";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Writes the MonitorNetworkDevice rows of the Network Device monitors that
 * existed before AddMonitorNetworkDevice: from here on its triggers keep
 * them. A schema migration, not a data migration, on purpose: the servers of
 * this release read the table on every device poll, and they start only
 * once the schema migrations have run (SchemaMigrationWait). A data
 * migration may run after they start, and until it had, every hand-made
 * monitor would have missed its device's polls and traps.
 *
 * In pages of BACKFILL_PAGE_SIZE monitors, by id, one INSERT ... SELECT
 * each: the migration connection carries the app's statement timeouts, and
 * its client-side one (DATABASE_QUERY_TIMEOUT_MS) cannot be raised from
 * here, so no single statement may read every monitor's steps. A page reads
 * "Monitor" with ACCESS SHARE, which no writer of "Monitor" waits for, in a
 * transaction of its own after the one that created the triggers, so writes
 * go on meanwhile - and each one that changes a monitor's steps has the
 * trigger write that monitor's rows. Rows the trigger has written already
 * are left as they are (ON CONFLICT DO NOTHING). A monitor whose steps
 * change while this runs may be left a row for the device its steps named
 * before as well; that row costs its device's polls one extra read of the
 * monitor, whose steps then name no step to evaluate, and goes the next time
 * the monitor's steps change. A row is never missing.
 *
 * Safe to run again: it only adds rows that are not there.
 */

export const BACKFILL_PAGE_SIZE: number = 1000;

/*
 * One page: the next BACKFILL_PAGE_SIZE Network Device monitors after $1 (or
 * from the first, when $1 is null), their rows written, and the last id of
 * the page and how many monitors it held read back.
 */
export const BACKFILL_MONITOR_NETWORK_DEVICE_PAGE: string = `WITH "page" AS (
  SELECT "Monitor"."_id", "Monitor"."projectId", "Monitor"."monitorSteps"
  FROM "Monitor"
  WHERE "Monitor"."monitorType" = '${NETWORK_DEVICE_MONITOR_TYPE}'
    AND "Monitor"."deletedAt" IS NULL
    AND "Monitor"."projectId" IS NOT NULL
    AND ($1::uuid IS NULL OR "Monitor"."_id" > $1::uuid)
  ORDER BY "Monitor"."_id"
  LIMIT ${BACKFILL_PAGE_SIZE}
), "written" AS (
  INSERT INTO "MonitorNetworkDevice" ("projectId", "monitorId", "networkDeviceId", "version")
  SELECT "page"."projectId", "page"."_id", device_id, 1
  FROM "page"
  CROSS JOIN LATERAL "${MONITOR_NETWORK_DEVICE_IDS_FUNCTION}"("page"."monitorSteps") AS device_id
  ON CONFLICT ("monitorId", "networkDeviceId") DO NOTHING
  RETURNING 1
)
SELECT
  (SELECT "_id" FROM "page" ORDER BY "_id" DESC LIMIT 1) AS "lastId",
  (SELECT count(*) FROM "page") AS "monitors",
  (SELECT count(*) FROM "written") AS "rows"`;

export class BackfillMonitorNetworkDevice1809163100000
  implements MigrationInterface
{
  public name: string = "BackfillMonitorNetworkDevice1809163100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    let after: string | null = null;

    for (;;) {
      const result: Array<{
        lastId: string | null;
        monitors: string | number;
      }> = await queryRunner.query(BACKFILL_MONITOR_NETWORK_DEVICE_PAGE, [
        after,
      ]);

      const lastId: string | null = result?.[0]?.lastId || null;

      if (!lastId || lastId === after) {
        return;
      }

      after = lastId;

      if (Number(result[0]!.monitors) < BACKFILL_PAGE_SIZE) {
        return;
      }
    }
  }

  /*
   * Nothing to undo: the rows are what the triggers would have written, and
   * AddMonitorNetworkDevice's down() drops the table with them.
   */
  public async down(_queryRunner: QueryRunner): Promise<void> {
    return Promise.resolve();
  }
}
