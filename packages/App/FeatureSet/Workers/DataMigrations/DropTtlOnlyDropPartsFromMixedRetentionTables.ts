import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import { MigrationExecuteOptions } from "Common/Server/Services/AnalyticsDatabaseService";
import MetricService from "Common/Server/Services/MetricService";
import {
  getStorageTableName,
  onClusterClause,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import logger from "Common/Server/Utils/Logger";

/*
 * The tables this clears the setting on, by the name their models give them
 * (the Distributed table the app reads and writes through). The models no
 * longer declare the setting, so a fresh install creates them without it.
 */
export const MIXED_RETENTION_TELEMETRY_TABLES: Array<string> = [
  "MetricItemV3",
  "MetricItemAggMV1m",
  "LogItemV3",
];

/**
 * Clears `ttl_only_drop_parts` on the telemetry tables whose partitions are
 * uniform in time but NOT in lifetime. The models used to declare it for them,
 * and AddTtlOnlyDropPartsToTelemetryV3 used to set it on them.
 *
 * The setting drops a part only once EVERY row in it has expired. That is a
 * cheap and correct optimisation for a part whose rows share one retention.
 * These tables' rows do not:
 *
 * - MetricItemV3 (daily partitions, `toYYYYMMDD(time)`) and the
 *   MetricItemAggMV1m rollup fed from it (monthly partitions,
 *   `toYYYYMM(bucketTime)`) - telemetry metrics take their retention per
 *   service (`retainTelemetryDataForDays`), while monitor metrics, and the
 *   other series the platform writes itself (SLO, incident and alert,
 *   session replay budget), take `GlobalConfig.monitorMetricRetentionInDays`
 *   instead. On defaults that is 15 days next to 30.
 * - LogItemV3 (daily partitions) - `TelemetryRetentionConfig` lets a project
 *   override retention per severity (`logs.bySeverity`) on top of the
 *   per-service value, so the longest-lived severity pins the whole day.
 *
 * In both cases a part keeps every row until its longest-lived row expires,
 * and TTL evicts nothing before then. It is not a corner case. On a
 * production install not one metric partition had ever been dropped, the
 * oldest still being day one: ~69k monitor rows a day pinned ~52 GiB a day
 * of long-expired telemetry. On the same install 456 Fatal log rows a day -
 * 0.0002% of that day's 267M - held the full ~40 GiB a day for 30 days
 * instead of 15, and six already written partitions kept 202.7 GiB alive an
 * extra two weeks after the override was lowered, because `retentionDate` is
 * fixed at ingest. The disk filled.
 *
 * Left alone here: SpanItemV3, ExceptionItemV3, the profile tables and the
 * per-dimension metric rollups (…ByService / …ByHostV2 / …ByContainer /
 * …ByK8sCluster). The monitor-retention series never reach those rollups,
 * which keep only rows carrying their dimension, so the case measured above
 * does not apply to them. But any of these tables mixes lifetimes as soon as
 * two services keep data for different lengths of time, or a per-status
 * override is set (`traces.byStatus`). The hazard is the same, only nobody
 * has measured it hurting there yet. Removing the setting from one of them
 * takes the model's `tableSettings` and a migration like this one.
 *
 * Cluster-aware on purpose (`runsInClusterMode` left at true): the analytics
 * schema is always a cluster now, so a migration that opted out would be
 * baselined and never repair an existing install - which is exactly the
 * population that needs repairing. It ALTERs the local storage table, where
 * the setting lives, and it has to go ON CLUSTER: unlike a TTL or column
 * change, a settings change on a ReplicatedMergeTree is not replicated
 * through Keeper, each replica only changes its own copy.
 *
 * MODIFY SETTING is metadata-only and idempotent, and two runners racing on
 * it is harmless. What it sets off is the real work: every part still
 * holding expired rows becomes due for a TTL merge, which rewrites it with
 * the survivors only. ClickHouse runs two of those at a time
 * (`max_number_of_merges_with_ttl_in_pool`) and repeats one on the same
 * partition at most every `merge_with_ttl_timeout` (4 hours by default), so
 * an install with weeks of pinned data works it off over hours rather than
 * all at once, and cheaply: a pinned partition is nearly all expired, and
 * one merge keeps only the rest.
 *
 * From then on rows go as they expire, which is not free either.
 * `retentionDate` is stamped per row at ingest, so a day's rows expire over
 * a whole day, and while they do the partition is rewritten each time the
 * timeout allows - six or seven rewrites per retention it holds, each
 * smaller than the last, roughly three times the partition's size in all.
 * That is the price of retention that can differ by service, severity and
 * monitor; keeping the setting cost a disk.
 */
export default class DropTtlOnlyDropPartsFromMixedRetentionTables extends DataMigrationBase {
  public constructor() {
    super("DropTtlOnlyDropPartsFromMixedRetentionTables");
  }

  public static getStatement(tableName: string): string {
    return `ALTER TABLE ${getStorageTableName(tableName)}${onClusterClause()} MODIFY SETTING ttl_only_drop_parts = 0`;
  }

  public override async migrate(): Promise<void> {
    const failures: Array<string> = [];

    for (const table of MIXED_RETENTION_TELEMETRY_TABLES) {
      const storageTable: string = getStorageTableName(table);

      try {
        /*
         * Boot and the migrate Job both create the analytics tables before
         * data migrations run, from models that no longer declare the
         * setting, so a table that does not exist has nothing to clear.
         */
        if (!(await ClickHouseMigrationUtil.tableExists(storageTable))) {
          logger.info(
            `DropTtlOnlyDropPartsFromMixedRetentionTables: ${storageTable} does not exist; nothing to clear.`,
          );
          continue;
        }

        await MetricService.execute(
          DropTtlOnlyDropPartsFromMixedRetentionTables.getStatement(table),
          MigrationExecuteOptions,
        );

        logger.info(
          `DropTtlOnlyDropPartsFromMixedRetentionTables: cleared ttl_only_drop_parts on ${storageTable}`,
        );
      } catch (err) {
        logger.error(
          `DropTtlOnlyDropPartsFromMixedRetentionTables: failed on ${storageTable}:`,
        );
        logger.error(err as Error);

        failures.push(
          `${storageTable}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    /*
     * Every table is tried before failing, and then the migration does fail:
     * a migration that returns is recorded as done for good, and a table
     * that kept the setting keeps filling the disk. The runner halts the
     * chain here and the next run retries it, while the admin health page
     * says why. A slow cluster does not count as a failure
     * (MigrationExecuteOptions waits for the DDL, then leaves it queued),
     * so what does fail here would stop the ClickHouse migrations after it
     * too. Tables that were cleared are simply cleared again.
     */
    if (failures.length > 0) {
      throw new Error(
        `DropTtlOnlyDropPartsFromMixedRetentionTables: could not clear ttl_only_drop_parts on ${failures.join("; ")}`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    /*
     * Deliberately a no-op. Setting it again would freeze retention on these
     * tables again, and a re-run of migrate() is idempotent anyway.
     */
    return;
  }
}
