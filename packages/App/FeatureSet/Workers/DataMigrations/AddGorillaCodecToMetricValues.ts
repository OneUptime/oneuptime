import DataMigrationBase from "./DataMigrationBase";
import MetricService from "Common/Server/Services/MetricService";
import { MigrationExecuteOptions } from "Common/Server/Services/AnalyticsDatabaseService";
import logger from "Common/Server/Utils/Logger";

/**
 * Switches the metric value columns (`value`/`sum`/`min`/`max`, all
 * `Nullable(Float64)`) from `ZSTD` to `Gorilla, ZSTD` — Gorilla is the
 * float-time-series codec and compresses slowly-changing metric values far
 * better than ZSTD alone. New installs get this from the model `codec`;
 * this migration applies it to already-created `MetricItemV3` tables.
 *
 * Codec-only ALTER (type is unchanged), so it does not touch sort keys or
 * skip indexes. Safe to re-run.
 */
export default class AddGorillaCodecToMetricValues extends DataMigrationBase {
  public constructor() {
    super("AddGorillaCodecToMetricValues");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  public override async migrate(): Promise<void> {
    for (const column of ["value", "sum", "min", "max"]) {
      try {
        await MetricService.execute(
          `ALTER TABLE MetricItemV3 MODIFY COLUMN ${column} Nullable(Float64) CODEC(Gorilla, ZSTD(1))`,
          MigrationExecuteOptions,
        );
        logger.info(
          `AddGorillaCodecToMetricValues: applied Gorilla codec to MetricItemV3.${column}`,
        );
      } catch (err) {
        logger.error(
          `AddGorillaCodecToMetricValues: failed on MetricItemV3.${column}:`,
        );
        logger.error(err as Error);
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
