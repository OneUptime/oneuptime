import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/InstanceReceivingPeriod";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import {
  RECEIVING_GAP_THRESHOLD_MS,
  ReceivingPeriod,
} from "../../Utils/Telemetry/ReceivingGaps";

/*
 * Receiving periods are kept this long. A row is written per outage, not per
 * heartbeat, so the table stays tiny; the bound only keeps an instance that
 * restarts all day long (a development stack) from growing it forever. Older
 * history reads as "unknown", which is how the time before the ledger
 * existed reads too: no gap is ever invented there.
 */
export const RECEIVING_PERIOD_RETENTION_IN_DAYS: number = 400;

// A window that is read never returns more rows than this.
const MAX_PERIODS_PER_READ: number = 10_000;

export interface ReceivingLedgerRead {
  /*
   * Every period overlapping the window, plus the nearest one on either side
   * of it - what ReceivingGapsUtil.gapsFromPeriods needs to find the gaps
   * that cross the window's edges.
   */
  periods: Array<ReceivingPeriod>;
  // The newest heartbeat in the whole ledger, or null when it is empty.
  latestReceivingAt: Date | null;
  // The database's clock when it was read: the same clock every row uses.
  now: Date;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * One receiving heartbeat: extend the current stretch, or start a new one
   * when nothing has been recorded for RECEIVING_GAP_THRESHOLD_MS.
   *
   * One statement, using the database's clock, so any number of replicas can
   * heartbeat at once without their own clocks splitting the timeline.
   * Replicas that all find the ledger stale after an outage may each start a
   * stretch; those overlap, and readers merge them. Returns true when this
   * heartbeat started a new stretch - the instance had stopped receiving and
   * now receives again.
   */
  @CaptureSpan()
  public async recordReceiving(): Promise<boolean> {
    const rows: Array<{ startedCount: number | string }> =
      await this.getRepository().manager.query(
        `WITH "fresh" AS (
          SELECT "_id" FROM "InstanceReceivingPeriod"
          WHERE "deletedAt" IS NULL
            AND "lastReceivingAt" >= now() - make_interval(secs => $1)
          ORDER BY "lastReceivingAt" DESC
          LIMIT 1
        ), "extended" AS (
          UPDATE "InstanceReceivingPeriod" AS "period"
          SET "lastReceivingAt" = GREATEST("period"."lastReceivingAt", now()),
              "updatedAt" = now()
          FROM "fresh"
          WHERE "period"."_id" = "fresh"."_id"
          RETURNING "period"."_id"
        ), "started" AS (
          INSERT INTO "InstanceReceivingPeriod" ("startedAt", "lastReceivingAt", "version")
          SELECT now(), now(), 1
          WHERE NOT EXISTS (SELECT 1 FROM "extended")
          RETURNING "_id"
        )
        SELECT (SELECT COUNT(*) FROM "started")::int AS "startedCount"`,
        [RECEIVING_GAP_THRESHOLD_MS / 1000],
      );

    return Number(rows?.[0]?.startedCount || 0) > 0;
  }

  /*
   * The periods around [startsAt, endsAt]: those overlapping it, the last
   * one that ended before it and the first one that started after it.
   */
  @CaptureSpan()
  public async readLedger(data: {
    startsAt: Date;
    endsAt: Date;
  }): Promise<ReceivingLedgerRead> {
    const periodRows: Array<{
      startedAt: Date | string;
      lastReceivingAt: Date | string;
    }> = await this.getRepository().manager.query(
      `(SELECT "startedAt", "lastReceivingAt" FROM "InstanceReceivingPeriod"
          WHERE "deletedAt" IS NULL AND "lastReceivingAt" < $1
          ORDER BY "lastReceivingAt" DESC
          LIMIT 1)
        UNION ALL
        (SELECT "startedAt", "lastReceivingAt" FROM "InstanceReceivingPeriod"
          WHERE "deletedAt" IS NULL AND "lastReceivingAt" >= $1 AND "startedAt" <= $2
          ORDER BY "startedAt" ASC
          LIMIT ${MAX_PERIODS_PER_READ})
        UNION ALL
        (SELECT "startedAt", "lastReceivingAt" FROM "InstanceReceivingPeriod"
          WHERE "deletedAt" IS NULL AND "startedAt" > $2
          ORDER BY "startedAt" ASC
          LIMIT 1)`,
      [data.startsAt, data.endsAt],
    );

    const summaryRows: Array<{
      latestReceivingAt: Date | string | null;
      now: Date | string;
    }> = await this.getRepository().manager.query(
      `SELECT MAX("lastReceivingAt") AS "latestReceivingAt", now() AS "now"
        FROM "InstanceReceivingPeriod"
        WHERE "deletedAt" IS NULL`,
    );

    const periods: Array<ReceivingPeriod> = [];

    for (const row of periodRows || []) {
      const startedAt: Date | null = toDate(row.startedAt);
      const lastReceivingAt: Date | null = toDate(row.lastReceivingAt);

      if (startedAt && lastReceivingAt) {
        periods.push({ startedAt, lastReceivingAt });
      }
    }

    return {
      periods,
      latestReceivingAt: toDate(summaryRows?.[0]?.latestReceivingAt),
      now: toDate(summaryRows?.[0]?.now) || new Date(),
    };
  }

  // Drops periods that ended more than the retention ago. Returns how many.
  @CaptureSpan()
  public async pruneOldPeriods(): Promise<number> {
    const rows: Array<{ deletedCount: number | string }> =
      await this.getRepository().manager.query(
        `WITH "deleted" AS (
          DELETE FROM "InstanceReceivingPeriod"
          WHERE "lastReceivingAt" < now() - make_interval(days => $1)
          RETURNING "_id"
        )
        SELECT COUNT(*)::int AS "deletedCount" FROM "deleted"`,
        [RECEIVING_PERIOD_RETENTION_IN_DAYS],
      );

    return Number(rows?.[0]?.deletedCount || 0);
  }
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  const date: Date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export default new Service();
