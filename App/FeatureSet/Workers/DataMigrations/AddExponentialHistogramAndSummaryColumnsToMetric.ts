import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import MetricService from "Common/Server/Services/MetricService";
import Metric from "Common/Models/AnalyticsModels/Metric";

/**
 * Adds the columns required to ingest OTLP `ExponentialHistogram` and
 * `Summary` metric types into oneuptime.MetricItemV2 without dropping data.
 *
 * Before this migration the OTLP ingest at OtelMetricsIngestService only
 * branched on `sum`/`gauge`/`histogram`, silently dropping the other two
 * metric types defined by the OTLP proto (we'd log a generic
 * "Unknown metric type" warning and move on).
 *
 * The new columns are nullable-default (Int32/Int64 default to 0,
 * Array(...) defaults to []) so existing rows are unaffected and existing
 * queries that only read sum/gauge/histogram fields keep working.
 */
const NEW_COLUMN_KEYS: Array<string> = [
  "scale",
  "zeroCount",
  "positiveOffset",
  "positiveBucketCounts",
  "negativeOffset",
  "negativeBucketCounts",
  "summaryQuantiles",
  "summaryValues",
];

export default class AddExponentialHistogramAndSummaryColumnsToMetric extends DataMigrationBase {
  public constructor() {
    super("AddExponentialHistogramAndSummaryColumnsToMetric");
  }

  public override async migrate(): Promise<void> {
    const allColumns: Array<AnalyticsTableColumn> = new Metric().tableColumns;

    for (const key of NEW_COLUMN_KEYS) {
      const column: AnalyticsTableColumn | undefined = allColumns.find(
        (c: AnalyticsTableColumn) => {
          return c.key === key;
        },
      );

      if (!column) {
        // Column missing from the model - nothing to do here.
        continue;
      }

      const columnType: TableColumnType | null =
        await MetricService.getColumnTypeInDatabase(column);

      if (!columnType) {
        // Column does not exist yet - create it.
        await MetricService.addColumnInDatabase(column);
        continue;
      }

      if (columnType !== column.type) {
        /*
         * Column exists with the wrong type (e.g. earlier partial migration).
         * Drop and re-add with the correct type. ClickHouse will repopulate
         * existing rows with the column default.
         */
        await MetricService.dropColumnInDatabase(column.key);
        await MetricService.addColumnInDatabase(column);
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
