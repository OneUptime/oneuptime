import DataMigrationBase from "./DataMigrationBase";
import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";

/**
 * Converts the primary event-timestamp columns from `Int128` (16 bytes,
 * the `LongNumber` mapping) to `UInt64` (8 bytes) + `DoubleDelta` codec.
 * Nanosecond timestamps fit comfortably in UInt64 (good past year 2500),
 * so this halves the stored width and unlocks `DoubleDelta` — which Int128
 * could not use (Delta codecs require ≤8-byte types) — giving large
 * compression on these monotonic-ish, every-row columns.
 *
 * New installs get this from the model (`type: UInt64` + codec); this
 * migration applies it to already-created `…V3` tables. Type-change ALTER
 * (a column-rewrite mutation); ClickHouse casts the existing Int128 values.
 * Idempotent.
 */
export default class AddUInt64TimestampsToTelemetryV3 extends DataMigrationBase {
  public constructor() {
    super("AddUInt64TimestampsToTelemetryV3");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  public override async migrate(): Promise<void> {
    // [table, column, full type incl. nullability matching the model]
    const alters: Array<[string, string, string]> = [
      ["LogItemV3", "timeUnixNano", "UInt64"],
      ["MetricItemV3", "timeUnixNano", "UInt64"],
      ["MetricItemV3", "startTimeUnixNano", "Nullable(UInt64)"],
      ["ExceptionItemV3", "timeUnixNano", "UInt64"],
      ["SpanItemV3", "startTimeUnixNano", "UInt64"],
      ["ProfileItemV3", "startTimeUnixNano", "UInt64"],
      ["ProfileSampleItemV3", "timeUnixNano", "UInt64"],
    ];
    for (const [table, column, type] of alters) {
      try {
        await MetricService.execute(
          `ALTER TABLE ${table} MODIFY COLUMN ${column} ${type} CODEC(DoubleDelta, ZSTD(1))`,
        );
        logger.info(
          `AddUInt64TimestampsToTelemetryV3: ${table}.${column} -> ${type} + DoubleDelta`,
        );
      } catch (err) {
        logger.error(
          `AddUInt64TimestampsToTelemetryV3: failed on ${table}.${column}:`,
        );
        logger.error(err as Error);
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
