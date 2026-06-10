import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import AnalyticsTableManagement from "../Utils/AnalyticsDatabase/TableManegement";
import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";

/**
 * Telemetry V3 cut — DDL ONLY.
 *
 * The analytics models were (a) renamed `serviceId`/`serviceType` →
 * `primaryEntityId`/`primaryEntityType` and (b) switched from
 * `sipHash64(projectId) % 16` to time-based partitioning. Neither can be
 * applied in place — `serviceId` is part of the ClickHouse sort key and
 * the partition key is fixed at table creation — so the signal tables are
 * cut to a new `…V3` name.
 *
 * This migration deliberately does NOT copy data. The historical V2 → V3
 * copy is hours-to-days of work at production scale and used to run
 * inline here, which blocked the boot migration runner (and, before the
 * chunked copy engine existed, kept timing out client-side at the 58s
 * socket idle limit and re-running whole partitions on every boot —
 * duplicating rows and double-firing the metric MVs). The copy is now
 * owned by the `Telemetry:BackfillTelemetryV3` cron
 * (App/FeatureSet/Workers/Jobs/Telemetry/BackfillTelemetryV3.ts), which
 * resumes chunk-by-chunk from the `TelemetryV3CopyProgress` marker table
 * this migration creates. This migration only runs fast, idempotent DDL
 * and completes in seconds, so the ~23 migrations behind it are never
 * blocked.
 *
 * Steps:
 *   1. Drop the 3 stale metric MVs (old `serviceId` column + sipHash
 *      partition, reading `FROM MetricItemV2`). Skipped on a retry once
 *      the views already read `FROM MetricItemV3`.
 *   2. Recreate every analytics table + MV from the updated models via
 *      the schema-sync helpers — creating the `…V3` signal tables and
 *      rebuilding the MVs (`FROM MetricItemV3`). Idempotent. The MVs
 *      MUST exist before any data lands in MetricItemV3 — the backfill
 *      cron double-checks this before copying.
 *   3. Ensure the `TelemetryV3CopyProgress` marker table exists so the
 *      backfill cron (and the remaining inline copies in later
 *      migrations) can record progress.
 *
 * The `…V2` tables are intentionally retained (the backfill cron reads
 * them; they self-drain via their `retentionDate` TTL). A follow-up
 * migration can DROP them once every table carries the cron's
 * '__completed__' marker.
 *
 * All statements run through `MetricService` — every analytics service
 * shares one ClickHouse connection, and each statement names its own
 * table.
 */
export default class MigrateTelemetryToV3PrimaryEntityId extends DataMigrationBase {
  public constructor() {
    super("MigrateTelemetryToV3PrimaryEntityId");
  }

  public override async migrate(): Promise<void> {
    /*
     * 1. Drop the stale MV triggers + target tables — but only while the
     *    view does not yet read `FROM MetricItemV3`: the rebuilt
     *    views/tables must survive a retry, and dropping the rebuilt
     *    target tables would silently discard the aggregates the MVs
     *    already produced.
     */
    const staleMvPairs: Array<[string, string]> = [
      ["MetricItemAggMV1m_mv", "MetricItemAggMV1m"],
      ["MetricItemAggMV1mByHost_mv", "MetricItemAggMV1mByHost"],
      ["MetricBaselineHourly_mv", "MetricBaselineHourly"],
    ];
    for (const [view, table] of staleMvPairs) {
      const viewCreateQuery: string | null =
        await ClickHouseMigrationUtil.getCreateQuery(view);
      const viewIsStale: boolean =
        viewCreateQuery !== null && !viewCreateQuery.includes("MetricItemV3");

      if (viewIsStale) {
        await this.safeExec(`DROP VIEW IF EXISTS ${view}`);
      }
      /*
       * No view (never created, or a prior run crashed between the two
       * drops) means the target table cannot be receiving rows — it is
       * either the stale one or new-but-empty, so dropping is safe.
       */
      if (viewIsStale || viewCreateQuery === null) {
        await this.safeExec(`DROP TABLE IF EXISTS ${table}`);
      }
    }

    // 2. Recreate tables + MVs from the updated models.
    await AnalyticsTableManagement.createTables();
    await AnalyticsTableManagement.createMaterializedViews();

    // 3. Marker table for the backfill cron's chunk progress.
    await ClickHouseMigrationUtil.ensureCopyProgressTable();

    logger.info(
      "MigrateTelemetryToV3: DDL complete. Historical V2 -> V3 data copy is handled incrementally by the Telemetry:BackfillTelemetryV3 cron.",
    );
  }

  private async safeExec(sql: string): Promise<void> {
    try {
      await MetricService.execute(sql);
    } catch (err) {
      logger.error(err as Error);
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
