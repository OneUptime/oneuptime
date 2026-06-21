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
 * App/FeatureSet/Docs/Content/en/installation/upgrading.md ('Upgrading from OneUptime 10 → 11') (the native protocol has no
 * idle-timeout problem, and the V3 tables' dedup windows make a re-run
 * with the documented token settings safe).
 *
 * Steps:
 *   1. Drop the 3 stale metric MVs (old `serviceId` column + sipHash
 *      partition, reading `FROM MetricItemV2`) and any pre-V3 target
 *      table still missing `primaryEntityId`. The view drop is skipped on
 *      a retry once the views already read `FROM MetricItemV3`; the table
 *      drop is keyed off the column, so a rebuilt V3 table survives a
 *      retry while a drifted old-schema table is still repaired.
 *   2. Recreate every analytics table + MV from the updated models via
 *      the schema-sync helpers — creating the `…V3` signal tables and
 *      rebuilding the MVs (`FROM MetricItemV3`). Idempotent.
 *
 * The `…V2` tables are not touched here — DropUnusedTelemetryTables
 * (later in the chain) drops them. Operators who want the optional
 * manual history copy rename them to `…_backup` names BEFORE upgrading,
 * as documented in the upgrade guide.
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
     * 1. Drop the stale MV triggers and the pre-V3 target tables. The
     *    view drop is gated on the view still reading `FROM MetricItemV2`
     *    (a retry that already re-pointed it to MetricItemV3 leaves it
     *    alone); the table drop is gated on the table still lacking
     *    `primaryEntityId` (see the per-table comment below). Keying the
     *    table drop off the column — not the view's source string — means
     *    a rebuilt V3 table survives a retry (its aggregates are
     *    preserved) while a table that drifted to a V3-pointed MV but kept
     *    the old `serviceId` schema is still repaired.
     */
    /*
     * MetricItemAggMV1mByHost is deliberately VIEW-ONLY here (dropTable:
     * false): a manual V2 -> V3 raw-metric copy stamps hostEntityKey = ''
     * (V2 has no such column), so the ByHostV2 MV cannot rebuild per-host
     * rollup history from copied rows — the frozen old table (renamed to
     * `…_backup` before the upgrade) is the ONLY source for the optional
     * per-host history backfill in the upgrade guide. The un-renamed
     * leftover is dropped by DropUnusedTelemetryTables later in the
     * chain. MV1m/Baseline targets ARE droppable: a manual raw-metric
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

      if (dropTable) {
        /*
         * Drop the target table only while it is still the pre-V3 schema,
         * detected by the actual column set (the renamed `serviceId` →
         * `primaryEntityId`) rather than the MV's source string. The view
         * and the target table schema are independent — keying the table
         * drop off the column means a retry that has already rebuilt the
         * V3 table is correctly left alone (preserving the aggregates its
         * MV produced), while a table that drifted to a V3-pointed MV but
         * kept the old `serviceId` schema is still repaired here instead
         * of silently surviving. A genuinely-absent table reports no
         * columns and is left for createTables() below to create.
         */
        const tableColumns: Array<string> =
          await ClickHouseMigrationUtil.getColumns(table);
        const tableIsPreV3: boolean =
          tableColumns.length > 0 && !tableColumns.includes("primaryEntityId");

        if (tableIsPreV3) {
          await this.safeExec(`DROP TABLE IF EXISTS ${table}`);
        }
      }
    }

    // 2. Recreate tables + MVs from the updated models.
    await AnalyticsTableManagement.createTables();
    await AnalyticsTableManagement.createMaterializedViews();

    logger.info(
      "MigrateTelemetryToV3: DDL complete. V3 tables start fresh (forward-only cut); to carry V2 history forward manually, see the v11 upgrade guide: https://oneuptime.com/docs/installation/upgrading",
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
