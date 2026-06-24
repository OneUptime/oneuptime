import DataMigrationBase from "./DataMigrationBase";
import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";

/**
 * Converts the remaining `Int128` nano columns to `UInt64` (halving width).
 * The monotonic end/observed *timestamps* also get `DoubleDelta`; the
 * non-monotonic durations/period/value keep plain `ZSTD` (DoubleDelta gives
 * no benefit on non-monotonic data). New installs get this from the models;
 * this migration applies it to already-created `…V3` tables. Idempotent.
 */
export default class AddUInt64ToRemainingTelemetryColumns extends DataMigrationBase {
  public constructor() {
    super("AddUInt64ToRemainingTelemetryColumns");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  public override async migrate(): Promise<void> {
    // [table, column, full type incl. nullability, CODEC clause]
    const alters: Array<[string, string, string, string]> = [
      // monotonic timestamps -> DoubleDelta
      [
        "LogItemV3",
        "observedTimeUnixNano",
        "Nullable(UInt64)",
        "CODEC(DoubleDelta, ZSTD(1))",
      ],
      [
        "SpanItemV3",
        "endTimeUnixNano",
        "UInt64",
        "CODEC(DoubleDelta, ZSTD(1))",
      ],
      [
        "ProfileItemV3",
        "endTimeUnixNano",
        "UInt64",
        "CODEC(DoubleDelta, ZSTD(1))",
      ],
      /*
       * non-monotonic durations / values -> plain ZSTD
       * NOTE: SpanItemV3.durationUnixNano is intentionally left Int128 — it is
       * aggregated as AggregateFunction(avg, Int128) inside proj_agg_by_service,
       * and ClickHouse cannot convert that projection state to UInt64 in place.
       */
      ["ProfileItemV3", "durationNano", "UInt64", "CODEC(ZSTD(1))"],
      ["ProfileItemV3", "period", "Nullable(UInt64)", "CODEC(ZSTD(1))"],
      ["ProfileSampleItemV3", "value", "UInt64", "CODEC(ZSTD(1))"],
    ];
    for (const [table, column, type, codec] of alters) {
      try {
        await MetricService.execute(
          `ALTER TABLE ${table} MODIFY COLUMN ${column} ${type} ${codec}`,
        );
        logger.info(
          `AddUInt64ToRemainingTelemetryColumns: ${table}.${column} -> ${type}`,
        );
      } catch (err) {
        logger.error(
          `AddUInt64ToRemainingTelemetryColumns: failed on ${table}.${column}:`,
        );
        logger.error(err as Error);
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
