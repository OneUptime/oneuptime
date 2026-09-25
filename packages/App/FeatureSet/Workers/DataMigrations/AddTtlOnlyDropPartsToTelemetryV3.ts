import DataMigrationBase from "./DataMigrationBase";
import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";

/**
 * Sets `ttl_only_drop_parts = 1` on the time-partitioned V3 telemetry tables
 * + metric MVs. With daily/monthly partitions this makes TTL drop whole
 * expired partitions (a cheap metadata op) instead of rewriting parts to
 * evict expired rows. New installs get this from the model `tableSettings`
 * at CREATE time; this migration applies it to already-created tables.
 *
 * Safe to re-run (MODIFY SETTING is idempotent). Only the time-partitioned
 * tables are touched — applying this to a sipHash-partitioned table would
 * effectively disable row-level TTL (no partition ever fully expires).
 *
 * No metric table is in the list any more. MetricItemV3 and MetricItemAggMV1m
 * were removed because a metric partition is time-uniform but NOT
 * lifetime-uniform: monitor metrics write into it with a retention of their
 * own, so a part never expires as a whole and TTL stops dropping anything.
 * DropTtlOnlyDropPartsFromMetricTables runs later in the chain and clears the
 * setting on installs this migration already touched; the models no longer
 * carry it for fresh installs. MetricItemAggMV1mByHost was never here: it is
 * sipHash-partitioned and DropUnusedTelemetryTables drops it later in the
 * chain (or the operator renames it to `…_backup` pre-upgrade); fresh V3
 * installs use the model-owned …ByHostV2 instead.
 */
export default class AddTtlOnlyDropPartsToTelemetryV3 extends DataMigrationBase {
  public constructor() {
    super("AddTtlOnlyDropPartsToTelemetryV3");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  public override async migrate(): Promise<void> {
    const tables: Array<string> = [
      "LogItemV3",
      "SpanItemV3",
      "ExceptionItemV3",
      "ProfileItemV3",
      "ProfileSampleItemV3",
      "MetricBaselineHourly",
    ];
    for (const table of tables) {
      try {
        await MetricService.execute(
          `ALTER TABLE ${table} MODIFY SETTING ttl_only_drop_parts = 1`,
        );
        logger.info(
          `AddTtlOnlyDropPartsToTelemetryV3: set ttl_only_drop_parts=1 on ${table}`,
        );
      } catch (err) {
        logger.error(`AddTtlOnlyDropPartsToTelemetryV3: failed on ${table}:`);
        logger.error(err as Error);
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
