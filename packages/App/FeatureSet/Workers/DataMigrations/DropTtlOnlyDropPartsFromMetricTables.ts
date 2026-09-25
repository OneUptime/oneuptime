import DataMigrationBase from "./DataMigrationBase";
import MetricService from "Common/Server/Services/MetricService";
import {
  getStorageTableName,
  onClusterClause,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import logger from "Common/Server/Utils/Logger";

/**
 * Clears `ttl_only_drop_parts` on the two metric tables that AddTtlOnly
 * DropPartsToTelemetryV3 used to set it on, and that the models no longer
 * declare it for.
 *
 * The setting drops a part only once EVERY row in it has expired. That holds
 * for the other telemetry tables, whose daily partition is uniform in lifetime
 * in practice — but not for metrics. Telemetry metrics take their retention per
 * service (`retainTelemetryDataForDays`); monitor metrics bypass that entirely
 * for `GlobalConfig.monitorMetricRetentionInDays` (MonitorMetricUtil) and write
 * into the same `toYYYYMMDD(time)` partition. One day therefore holds rows whose
 * retentions differ by an order of magnitude, the part never expires as a whole,
 * and TTL stops evicting anything at all.
 *
 * It is not a corner case: on a production install not one metric partition had
 * ever been dropped, the oldest still being day one. ~69k monitor rows a day
 * pinned ~52 GiB a day of long-expired telemetry, until the disk filled.
 *
 * Cluster-aware on purpose (`runsInClusterMode` left at true): the analytics
 * schema is always a cluster now, so a migration that opted out would be
 * baselined and never repair an existing install — which is exactly the
 * population that needs repairing. Fresh installs get the right setting from the
 * model `tableSettings`; this is for the tables already created with it.
 *
 * MODIFY SETTING is metadata-only and idempotent. The first TTL merge after it
 * rewrites each poisoned partition once, evicting the expired rows and keeping
 * the long-lived ones; merges are paced by `merge_with_ttl_timeout`, so this
 * does not storm.
 */
export default class DropTtlOnlyDropPartsFromMetricTables extends DataMigrationBase {
  public constructor() {
    super("DropTtlOnlyDropPartsFromMetricTables");
  }

  public override async migrate(): Promise<void> {
    const tables: Array<string> = ["MetricItemV3", "MetricItemAggMV1m"];

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
          `DropTtlOnlyDropPartsFromMetricTables: cleared ttl_only_drop_parts on ${storageTable}`,
        );
      } catch (err) {
        logger.error(
          `DropTtlOnlyDropPartsFromMetricTables: failed on ${storageTable}:`,
        );
        logger.error(err as Error);
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
