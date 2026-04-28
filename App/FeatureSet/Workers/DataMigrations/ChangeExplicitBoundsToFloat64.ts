import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import MetricService from "Common/Server/Services/MetricService";
import Metric from "Common/Models/AnalyticsModels/Metric";
import logger from "Common/Server/Utils/Logger";

/**
 * Convert oneuptime.MetricItemV2.explicitBounds from Array(Int64) to
 * Array(Float64).
 *
 * Sub-integer bucket boundaries are common in HTTP histograms (e.g.
 * `[0.005, 0.01, 0.025, 0.05, ...]`). With the old Int64 storage every
 * bound below 1 was floored to 0, which made every bucket appear to
 * cover the same range and ruined any percentile derived from
 * `bucketCounts + explicitBounds`. Now that ArrayDecimal exists we can
 * store the real Float64 bounds.
 *
 * Existing rows already lost their sub-integer precision at ingest time
 * (the integers we floored to are still in the column), so this
 * migration drops the column and re-adds it with the correct type. New
 * histogram writes will land losslessly. Old rows lose their
 * already-lossy bounds — this is acceptable because they were already
 * unusable for percentile computation; in exchange every future
 * percentile is correct.
 */
export default class ChangeExplicitBoundsToFloat64 extends DataMigrationBase {
  public constructor() {
    super("ChangeExplicitBoundsToFloat64");
  }

  public override async migrate(): Promise<void> {
    const column: AnalyticsTableColumn | undefined =
      new Metric().tableColumns.find((c: AnalyticsTableColumn) => {
        return c.key === "explicitBounds";
      });

    if (!column) {
      logger.warn(
        "ChangeExplicitBoundsToFloat64: explicitBounds column missing from Metric model, skipping",
      );
      return;
    }

    if (column.type !== TableColumnType.ArrayDecimal) {
      logger.warn(
        `ChangeExplicitBoundsToFloat64: model column type is ${column.type}, expected ArrayDecimal. Migration is a no-op.`,
      );
      return;
    }

    const existingType: TableColumnType | null =
      await MetricService.getColumnTypeInDatabase(column);

    if (existingType === TableColumnType.ArrayDecimal) {
      // Already migrated.
      return;
    }

    if (existingType) {
      await MetricService.dropColumnInDatabase(column.key);
    }

    await MetricService.addColumnInDatabase(column);
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
