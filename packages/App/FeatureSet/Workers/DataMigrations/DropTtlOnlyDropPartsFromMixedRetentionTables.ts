import DataMigrationBase from "./DataMigrationBase";
import MetricService from "Common/Server/Services/MetricService";
import {
  getStorageTableName,
  onClusterClause,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import logger from "Common/Server/Utils/Logger";

/**
 * Clears `ttl_only_drop_parts` on the telemetry tables whose daily partition is
 * uniform in time but NOT in lifetime, and that the models no longer declare it
 * for. AddTtlOnlyDropPartsToTelemetryV3 used to set it on all of them.
 *
 * The setting drops a part only once EVERY row in it has expired. That is a
 * cheap and correct optimisation for a partition whose rows share one
 * retention. These two do not:
 *
 * - MetricItemV3 / MetricItemAggMV1m — telemetry metrics take their retention
 *   per service (`retainTelemetryDataForDays`), while monitor metrics bypass
 *   that entirely for `GlobalConfig.monitorMetricRetentionInDays`
 *   (MonitorMetricUtil) and write into the same `toYYYYMMDD(time)` partition.
 *   One day therefore holds rows whose retentions differ by an order of
 *   magnitude.
 * - LogItemV3 — `TelemetryRetentionConfig` lets a project override retention
 *   per severity (`logs.bySeverity`) on top of the per-service value, so the
 *   longest-lived severity pins the whole day.
 *
 * In both cases the part never expires as a whole and TTL stops evicting
 * anything at all. It is not a corner case. On a production install not one
 * metric partition had ever been dropped, the oldest still being day one:
 * ~69k monitor rows a day pinned ~52 GiB a day of long-expired telemetry. On
 * the same install 456 Fatal log rows a day — 0.0002% of that day's 267M —
 * held the full ~40 GiB a day for 30 days instead of 15, and six already
 * written partitions kept 202.7 GiB alive an extra two weeks after the
 * override was lowered, because `retentionDate` is fixed at ingest. The disk
 * filled.
 *
 * SpanItemV3, ExceptionItemV3 and the profile tables are left alone here. They
 * carry the same structural hazard the moment an install uses a per-status or
 * per-service override (`traces.byStatus` is exactly that), but no install has
 * been measured hitting it — their volume is orders of magnitude lower — and
 * widening a data migration on reasoning alone seemed worse than naming the
 * question. Maintainers who want the blanket removal need only extend the list
 * below and the matching model `tableSettings`.
 *
 * Cluster-aware on purpose (`runsInClusterMode` left at true): the analytics
 * schema is always a cluster now, so a migration that opted out would be
 * baselined and never repair an existing install — which is exactly the
 * population that needs repairing. Fresh installs get the right setting from
 * the model `tableSettings`; this is for the tables already created with it.
 *
 * MODIFY SETTING is metadata-only and idempotent. The first TTL merge after it
 * rewrites each poisoned partition once, evicting the expired rows and keeping
 * the long-lived ones; merges are paced by `merge_with_ttl_timeout`, so this
 * does not storm.
 */
export default class DropTtlOnlyDropPartsFromMixedRetentionTables extends DataMigrationBase {
  public constructor() {
    super("DropTtlOnlyDropPartsFromMixedRetentionTables");
  }

  public override async migrate(): Promise<void> {
    const tables: Array<string> = [
      "MetricItemV3",
      "MetricItemAggMV1m",
      "LogItemV3",
    ];

    for (const table of tables) {
      /*
       * The setting lives on the local ReplicatedMergeTree, not on the
       * Distributed wrapper the app writes through.
       */
      const storageTable: string = getStorageTableName(table);

      try {
        await MetricService.execute(
          `ALTER TABLE ${storageTable}${onClusterClause()} MODIFY SETTING ttl_only_drop_parts = 0`,
        );
        logger.info(
          `DropTtlOnlyDropPartsFromMixedRetentionTables: cleared ttl_only_drop_parts on ${storageTable}`,
        );
      } catch (err) {
        logger.error(
          `DropTtlOnlyDropPartsFromMixedRetentionTables: failed on ${storageTable}:`,
        );
        logger.error(err as Error);
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
