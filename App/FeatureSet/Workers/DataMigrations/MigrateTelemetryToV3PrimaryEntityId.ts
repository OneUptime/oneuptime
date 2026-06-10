import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import AnalyticsTableManagement from "../Utils/AnalyticsDatabase/TableManegement";
import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";

/**
 * Telemetry V3 cut.
 *
 * The analytics models were (a) renamed `serviceId`/`serviceType` →
 * `primaryEntityId`/`primaryEntityType` and (b) switched from
 * `sipHash64(projectId) % 16` to time-based partitioning. Neither can be
 * applied in place — `serviceId` is part of the ClickHouse sort key and
 * the partition key is fixed at table creation — so the signal tables are
 * cut to a new `…V3` name and data is copied across.
 *
 * Steps:
 *   1. Drop the 3 stale metric MVs (old `serviceId` column + sipHash
 *      partition, reading `FROM MetricItemV2`). Skipped on a retry once the
 *      views already read `FROM MetricItemV3`.
 *   2. Recreate every analytics table + MV from the updated models via the
 *      schema-sync helpers — creating the `…V3` signal tables and rebuilding
 *      the MVs (`FROM MetricItemV3`). Idempotent.
 *   3. Copy each `…V2` → `…V3` partition-by-partition with an explicit,
 *      NAME-BASED column mapping (`serviceId`→`primaryEntityId`,
 *      `serviceType`→`primaryEntityType`). A positional `SELECT *` is NOT
 *      safe: `serviceType` was appended to the V2 tables by an earlier ALTER,
 *      so it sits last in V2's physical column order whereas V3 places
 *      `primaryEntityType` second. Only V3 columns whose source column exists
 *      on V2 are copied — V3-only columns (e.g. `entityKeys`) fall back to
 *      their table DEFAULT. Per-partition progress lands in
 *      `TelemetryV3CopyProgress`, and any copy failure is re-thrown at the
 *      end so the migration is NOT marked executed and the next boot resumes
 *      from the partitions that are still missing.
 *
 * The `…V2` tables are intentionally retained (rollback window; they
 * self-drain via their `retentionDate` TTL). A follow-up migration can DROP
 * them once V3 is confirmed.
 *
 * All statements run through `MetricService` — every analytics service shares
 * one ClickHouse connection, and each statement names its own table.
 */

export default class MigrateTelemetryToV3PrimaryEntityId extends DataMigrationBase {
  public constructor() {
    super("MigrateTelemetryToV3PrimaryEntityId");
  }

  public override async migrate(): Promise<void> {
    /*
     * 1. Drop the stale MV triggers + target tables — but only while the
     *    view does not yet read `FROM MetricItemV3`. This migration
     *    legitimately re-runs after a partial copy failure (see step 3), and
     *    the rebuilt views/tables must survive a retry: dropping the rebuilt
     *    target tables would silently discard the aggregates the MVs already
     *    produced for the copied (and on retry skipped) partitions.
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

    /*
     * 3. Copy historical signal data V2 -> V3 with a name-based column map,
     *    one partition at a time, resuming from the progress marker on retry.
     */
    const copies: Array<[string, string]> = [
      ["LogItemV2", "LogItemV3"],
      ["MetricItemV2", "MetricItemV3"],
      ["SpanItemV2", "SpanItemV3"],
      ["ExceptionItemV2", "ExceptionItemV3"],
      ["ProfileItemV2", "ProfileItemV3"],
      ["ProfileSampleItemV2", "ProfileSampleItemV3"],
    ];

    /*
     * Map the two renamed columns back to their V2 source names; everything
     * else maps by identical name.
     */
    const renameMap: Record<string, string> = {
      primaryEntityId: "serviceId",
      primaryEntityType: "serviceType",
    };

    const errors: Array<string> = [];

    for (const [v2, v3] of copies) {
      if (!(await ClickHouseMigrationUtil.tableExists(v2))) {
        logger.info(
          `MigrateTelemetryToV3: ${v2} not present (fresh install) — skipping copy.`,
        );
        continue;
      }

      errors.push(
        ...(await ClickHouseMigrationUtil.copyTablePartitionwise({
          sourceTable: v2,
          destinationTable: v3,
          renameMap: renameMap,
          logPrefix: "MigrateTelemetryToV3",
        })),
      );
    }

    /*
     * Throw on any failed copy so the runner does NOT mark this migration
     * executed — the next boot retries it, and the progress marker limits
     * the rework to the partitions that are still missing.
     */
    if (errors.length > 0) {
      throw new Error(
        `MigrateTelemetryToV3: ${errors.length} copy step(s) failed:\n${errors.join("\n")}`,
      );
    }
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
