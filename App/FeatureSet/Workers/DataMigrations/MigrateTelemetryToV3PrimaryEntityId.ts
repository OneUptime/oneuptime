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
 * This migration deliberately does NOT copy data — the V3 cut is
 * FORWARD-ONLY by decision (2026-06-11). V3 tables start fresh; history
 * ages in over the retention window. An in-app copy was tried twice and
 * removed: inline it blocked the boot migration runner and kept timing
 * out client-side at the 58s socket idle limit (re-running whole
 * partitions every boot — duplicating rows and double-firing the metric
 * MVs), and the background-cron replacement was machinery nobody needs
 * by default. Operators who want to carry history forward run the
 * documented per-partition clickhouse-client queries instead:
 * Internal/Docs/TelemetryV3UpgradeGuide.md (the native protocol has no
 * idle-timeout problem, and the V3 tables' dedup windows make a re-run
 * with the documented token settings safe).
 *
 * Steps:
 *   1. Drop the 3 stale metric MVs (old `serviceId` column + sipHash
 *      partition, reading `FROM MetricItemV2`). Skipped on a retry once
 *      the views already read `FROM MetricItemV3`.
 *   2. Recreate every analytics table + MV from the updated models via
 *      the schema-sync helpers — creating the `…V3` signal tables and
 *      rebuilding the MVs (`FROM MetricItemV3`). Idempotent.
 *
 * The `…V2` tables are intentionally retained: they self-drain via their
 * `retentionDate` TTL, and they are the source for the optional manual
 * history copy in the upgrade guide (which also documents dropping them
 * early to reclaim disk).
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
    /*
     * MetricItemAggMV1mByHost is deliberately VIEW-ONLY here (dropTable:
     * false): a manual V2 -> V3 raw-metric copy stamps hostEntityKey = ''
     * (V2 has no such column), so the ByHostV2 MV cannot rebuild per-host
     * rollup history from copied rows — the frozen old table is the ONLY
     * source for the optional per-host history backfill in the upgrade
     * guide. It self-drains via TTL; the guide documents dropping it
     * early. MV1m/Baseline targets ARE droppable: a manual raw-metric
     * copy re-fires their MVs via primaryEntityId, which copied rows do
     * carry.
     */
    const staleMvPairs: Array<
      [view: string, table: string, dropTable: boolean]
    > = [
      ["MetricItemAggMV1m_mv", "MetricItemAggMV1m", true],
      ["MetricItemAggMV1mByHost_mv", "MetricItemAggMV1mByHost", false],
      ["MetricBaselineHourly_mv", "MetricBaselineHourly", true],
    ];
    for (const [view, table, dropTable] of staleMvPairs) {
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
      if (dropTable && (viewIsStale || viewCreateQuery === null)) {
        await this.safeExec(`DROP TABLE IF EXISTS ${table}`);
      }
    }

    // 2. Recreate tables + MVs from the updated models.
    await AnalyticsTableManagement.createTables();
    await AnalyticsTableManagement.createMaterializedViews();

    logger.info(
      "MigrateTelemetryToV3: DDL complete. V3 tables start fresh (forward-only cut); to carry V2 history forward manually, see Internal/Docs/TelemetryV3UpgradeGuide.md.",
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
