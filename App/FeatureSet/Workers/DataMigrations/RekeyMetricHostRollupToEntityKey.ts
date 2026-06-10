import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil, {
  ClickHouseJsonResult,
} from "./ClickHouseMigrationUtil";
import AnalyticsDatabaseService from "Common/Server/Services/AnalyticsDatabaseService";
import MetricService from "Common/Server/Services/MetricService";
import MetricItemAggMV1mByHostV2 from "Common/Models/AnalyticsModels/MetricItemAggMV1mByHostV2";
import logger from "Common/Server/Utils/Logger";

/**
 * Re-keys the per-host metric minute rollup from the raw
 * `attributes['resource.host.name']` spelling (`MetricItemAggMV1mByHost`,
 * keyed by `hostIdentifier`) to the stable 16-hex host entity key
 * (`MetricItemAggMV1mByHostV2`, keyed by `hostEntityKey` — see
 * Common/Utils/Telemetry/EntityKey.keyForHost). Phase 6 of
 * Internal/Docs/OpenTelemetryEntities.md.
 *
 * Ordering constraints:
 *   - AFTER AddScalarEntityKeysToTelemetryTables: the V2 MV reads the
 *     `hostEntityKey` scalar column off MetricItemV3.
 *   - The read-path switch (MetricService.tryBuildHostAggregateMVStatement
 *     now reads V2) ships in the same release as this migration.
 *
 * Step order is what makes the cutover lossless and double-count-free:
 *   1. Create the V2 table (from the model, so codecs/_id/TTL match).
 *   2. DROP the old MV — the old table is frozen from here on, so the
 *      backfill source can't grow under us.
 *   3. Create the V2 MV — new inserts start rolling into V2. The
 *      sub-second gap between 2 and 3 (plus the partial minute bucket
 *      that straddles it) is the only data loss, and only in the rollup;
 *      the raw MetricItemV3 rows are untouched.
 *   4. Backfill V2 from the frozen old table, computing the entity key
 *      in SQL. Partition-wise with a TelemetryV3CopyProgress marker per
 *      partition, so a partial failure resumes instead of double-copying
 *      (AggregateFunction state rows are merge-safe but NOT re-insert-safe
 *      — a duplicate partition would double every sum/count).
 *   5. DROP the old table once every partition is marked copied.
 *
 * SQL key computation (backfill only — the MV reads the ingest-stamped
 * column): replicates EntityKey.keyForHost byte-for-byte —
 * sha256(projectId + '|host|host.name=' + canonical(hostIdentifier))[:16]
 * where canonical = trim + lowercase (lower(trimBoth(...)) in SQL).
 * Verified byte-identical against keyForHost for sample hostnames on the
 * dev instance before shipping. CAVEAT: keyForHost backslash-escapes
 * `\`, `|` and `=` inside the value; this SQL does not. Hostnames
 * containing those characters are vanishingly rare (not RFC-952/1123
 * hostname characters) and would only mis-key backfilled history, not
 * new rows.
 *
 * Distinct raw spellings of the same canonical host collapse onto one
 * key; their partial aggregate states coexist as separate rows until the
 * AggregatingMergeTree merges them — reads always finalize with *Merge()
 * over GROUP BY, so results are correct from the first read.
 */
export default class RekeyMetricHostRollupToEntityKey extends DataMigrationBase {
  public constructor() {
    super("RekeyMetricHostRollupToEntityKey");
  }

  private static readonly oldTable: string = "MetricItemAggMV1mByHost";
  private static readonly oldView: string = "MetricItemAggMV1mByHost_mv";
  private static readonly newTable: string = "MetricItemAggMV1mByHostV2";
  private static readonly progressTable: string = "TelemetryV3CopyProgress";

  /*
   * Byte-identical to EntityKey.keyForHost (verified on the dev
   * instance) — see the header comment for the escaping caveat.
   */
  private static readonly hostEntityKeySql: string =
    "substring(lower(hex(SHA256(concat(projectId, '|host|host.name=', lower(trimBoth(hostIdentifier)))))), 1, 16)";

  public override async migrate(): Promise<void> {
    /*
     * The V2 model is not yet registered in AnalyticsServices (follow-up),
     * so build a throwaway service purely for its statement generator —
     * the CREATE TABLE then matches the model exactly (columns, codecs,
     * _id CODEC(ZSTD(1)), sort key, partition key, TTL).
     */
    const v2Service: AnalyticsDatabaseService<MetricItemAggMV1mByHostV2> =
      new AnalyticsDatabaseService<MetricItemAggMV1mByHostV2>({
        modelType: MetricItemAggMV1mByHostV2,
      });

    // 1. New target table (IF NOT EXISTS — safe on retry).
    await v2Service.execute(
      v2Service.statementGenerator.toTableCreateStatement(),
    );
    logger.info(
      `RekeyMetricHostRollupToEntityKey: ensured ${RekeyMetricHostRollupToEntityKey.newTable} table`,
    );

    // 2. Stop the old write path so the backfill source is frozen.
    await MetricService.execute(
      `DROP VIEW IF EXISTS ${RekeyMetricHostRollupToEntityKey.oldView}`,
    );
    logger.info(
      `RekeyMetricHostRollupToEntityKey: dropped ${RekeyMetricHostRollupToEntityKey.oldView}`,
    );

    // 3. Start the new write path (canonical definition on the V2 model).
    await MetricService.execute(v2Service.model.materializedViews[0]!.query);
    logger.info(
      `RekeyMetricHostRollupToEntityKey: ensured ${RekeyMetricHostRollupToEntityKey.newTable}_mv`,
    );

    // 4. Backfill from the frozen old table (resumable, partition-wise).
    const oldTableExists: boolean = await ClickHouseMigrationUtil.tableExists(
      RekeyMetricHostRollupToEntityKey.oldTable,
    );

    if (oldTableExists) {
      await this.backfillFromOldTable();

      // 5. Cutover complete — reclaim the old rollup's disk.
      await MetricService.execute(
        `DROP TABLE IF EXISTS ${RekeyMetricHostRollupToEntityKey.oldTable}`,
      );
      logger.info(
        `RekeyMetricHostRollupToEntityKey: dropped ${RekeyMetricHostRollupToEntityKey.oldTable}`,
      );
    } else {
      logger.info(
        `RekeyMetricHostRollupToEntityKey: ${RekeyMetricHostRollupToEntityKey.oldTable} does not exist — nothing to backfill`,
      );
    }
  }

  /**
   * Same mechanics as ClickHouseMigrationUtil.copyTablePartitionwise, but
   * with an expression-computed destination column (hostEntityKey from
   * hostIdentifier), which the generic column-intersection copier can't
   * express. Progress rows share the TelemetryV3CopyProgress marker table
   * keyed by the SOURCE table name. Throws on any partition failure so
   * the migration is not recorded and the next boot resumes from the
   * partitions that are still missing.
   */
  private async backfillFromOldTable(): Promise<void> {
    const src: string = RekeyMetricHostRollupToEntityKey.oldTable;
    const dst: string = RekeyMetricHostRollupToEntityKey.newTable;
    const progress: string = RekeyMetricHostRollupToEntityKey.progressTable;

    await MetricService.execute(
      `CREATE TABLE IF NOT EXISTS ${progress} (tableName String, \`partition\` String, copiedAt DateTime) ENGINE = MergeTree() ORDER BY (tableName, \`partition\`)`,
    );

    const partitionIds: Array<string> = await this.queryStrings(
      `SELECT DISTINCT partition_id AS value FROM system.parts WHERE database = currentDatabase() AND table = '${src}' AND active ORDER BY partition_id`,
    );
    const copiedPartitionIds: Set<string> = new Set(
      await this.queryStrings(
        `SELECT DISTINCT \`partition\` AS value FROM ${progress} WHERE tableName = '${src}'`,
      ),
    );

    if (partitionIds.length === 0) {
      logger.info(
        `RekeyMetricHostRollupToEntityKey: ${src} has no active partitions — nothing to copy.`,
      );
      return;
    }

    const errors: Array<string> = [];

    for (const partitionId of partitionIds) {
      /*
       * A crash after a partition's INSERT committed but before its
       * marker row was written can still duplicate that single partition
       * on the next run — same accepted tradeoff as
       * copyTablePartitionwise.
       */
      if (copiedPartitionIds.has(partitionId)) {
        logger.info(
          `RekeyMetricHostRollupToEntityKey: ${src} partition ${partitionId} already copied — skipping.`,
        );
        continue;
      }

      try {
        await MetricService.execute(
          `INSERT INTO ${dst} (projectId, name, hostEntityKey, bucketTime, valueSumState, valueCountState, valueMinState, valueMaxState, retentionDate)
           SELECT
             projectId,
             name,
             ${RekeyMetricHostRollupToEntityKey.hostEntityKeySql} AS hostEntityKey,
             bucketTime,
             valueSumState,
             valueCountState,
             valueMinState,
             valueMaxState,
             retentionDate
           FROM ${src}
           WHERE _partition_id = '${partitionId}'`,
        );
        await MetricService.execute(
          `INSERT INTO ${progress} (tableName, \`partition\`, copiedAt) VALUES ('${src}', '${partitionId}', now())`,
        );
        logger.info(
          `RekeyMetricHostRollupToEntityKey: copied ${src} partition ${partitionId} -> ${dst}.`,
        );
      } catch (err) {
        logger.error(
          `RekeyMetricHostRollupToEntityKey: failed copying ${src} partition ${partitionId} -> ${dst}:`,
        );
        logger.error(err as Error);
        errors.push(`partition ${partitionId}: ${(err as Error).message}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(
        `RekeyMetricHostRollupToEntityKey: backfill incomplete (${errors.length} partition(s) failed — old table retained, will resume on retry): ${errors.join("; ")}`,
      );
    }
  }

  private async queryStrings(sql: string): Promise<Array<string>> {
    const result: { json: () => Promise<unknown> } =
      await MetricService.executeQuery(sql);
    const json: ClickHouseJsonResult =
      (await result.json()) as ClickHouseJsonResult;
    return (json.data ?? []).map((r: Record<string, unknown>) => {
      return String(r["value"]);
    });
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
