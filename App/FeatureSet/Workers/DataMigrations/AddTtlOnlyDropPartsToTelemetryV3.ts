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
 */
export default class AddTtlOnlyDropPartsToTelemetryV3 extends DataMigrationBase {
  public constructor() {
    super("AddTtlOnlyDropPartsToTelemetryV3");
  }

  public override async migrate(): Promise<void> {
    const tables: Array<string> = [
      "LogItemV3",
      "MetricItemV3",
      "SpanItemV3",
      "ExceptionItemV3",
      "ProfileItemV3",
      "ProfileSampleItemV3",
      "MetricItemAggMV1m",
      "MetricItemAggMV1mByHost",
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
