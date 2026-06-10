import DataMigrationBase from "./DataMigrationBase";
import MetricBaselineService from "Common/Server/Services/MetricBaselineService";
import logger from "Common/Server/Utils/Logger";

/**
 * Switches MetricBaselineHourly's quantile states from
 * `quantile(0.5/0.95)` (reservoir-sampling sketch, ~8 KB state per cell)
 * to `quantileBFloat16(0.5/0.95)` (fixed-size bfloat16 histogram —
 * compact, cheap to merge, ~0.4% relative precision, far inside anomaly
 * -baseline noise).
 *
 * AggregatingMergeTree state columns cannot be ALTERed to a different
 * aggregate function — the serialized states are incompatible — so this
 * DROPs and recreates both the target table and its MV from the updated
 * MetricBaselineHourly model.
 *
 * DATA LOSS, accepted: existing baseline cells are discarded and
 * re-learn from new ingest. The V3 table cut already reset baselines
 * days before this migration, so the discarded history is hours-to-days
 * deep — well under the 14-day learning window the evaluator already
 * tolerates (cells below minSamples read as "Learning", they don't
 * misfire).
 *
 * Read side ships in the same release:
 * MetricBaselineService now finalizes via quantileBFloat16Merge.
 *
 * Drop order (MV first) means no insert can target the table while it is
 * being swapped. Recreating from the model (not inline SQL) keeps this
 * migration in lockstep with the boot-time schema-sync, which would
 * otherwise recreate a diverging definition. Idempotent: every statement
 * is IF [NOT] EXISTS, and a re-run after the swap just re-drops and
 * re-creates empty objects.
 */
export default class RebuildMetricBaselineHourlyWithBFloat16Quantiles extends DataMigrationBase {
  public constructor() {
    super("RebuildMetricBaselineHourlyWithBFloat16Quantiles");
  }

  public override async migrate(): Promise<void> {
    /*
     * If the live medianState is already quantileBFloat16 (fresh install
     * where boot-time createTables built the table from the updated
     * model), skip the rebuild so accumulated baselines survive.
     */
    const medianStateType: string =
      await MetricBaselineService.getColumnDatabaseType("medianState");
    if (medianStateType.includes("quantileBFloat16")) {
      logger.info(
        "RebuildMetricBaselineHourlyWithBFloat16Quantiles: medianState is already quantileBFloat16 — skipping rebuild.",
      );
      /*
       * The MV may still be the legacy quantileState one (created by
       * AddMetricBaselineHourlyMV against a model-created table); make
       * sure the model's definition is the one attached.
       */
      await MetricBaselineService.execute(
        `DROP VIEW IF EXISTS MetricBaselineHourly_mv`,
      );
      await MetricBaselineService.execute(
        MetricBaselineService.model.materializedViews[0]!.query,
      );
      return;
    }

    // 1. Detach the write path first so nothing inserts mid-swap.
    await MetricBaselineService.execute(
      `DROP VIEW IF EXISTS MetricBaselineHourly_mv`,
    );
    logger.info(
      "RebuildMetricBaselineHourlyWithBFloat16Quantiles: dropped MetricBaselineHourly_mv",
    );

    // 2. Drop the legacy-typed table (this is the accepted data loss).
    await MetricBaselineService.execute(
      `DROP TABLE IF EXISTS MetricBaselineHourly`,
    );
    logger.info(
      "RebuildMetricBaselineHourlyWithBFloat16Quantiles: dropped MetricBaselineHourly",
    );

    // 3. Recreate table + MV from the updated model.
    await MetricBaselineService.execute(
      MetricBaselineService.statementGenerator.toTableCreateStatement(),
    );
    await MetricBaselineService.execute(
      MetricBaselineService.model.materializedViews[0]!.query,
    );
    logger.info(
      "RebuildMetricBaselineHourlyWithBFloat16Quantiles: recreated MetricBaselineHourly + MV with quantileBFloat16 states",
    );
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
