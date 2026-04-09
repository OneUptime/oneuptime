import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import MetricService from "Common/Server/Services/MetricService";
import Metric from "Common/Models/AnalyticsModels/Metric";

const metricService: MetricService = new MetricService();

export default class AddTraceIdAndSpanIdToMetricTable extends DataMigrationBase {
  public constructor() {
    super("AddTraceIdAndSpanIdToMetricTable");
  }

  public override async migrate(): Promise<void> {
    const metricModel: Metric = new Metric();

    // Add traceId column
    const hasTraceIdColumn: boolean =
      await metricService.doesColumnExistInDatabase("traceId");

    const traceIdColumn: AnalyticsTableColumn | undefined =
      metricModel.tableColumns.find((column: AnalyticsTableColumn) => {
        return column.key === "traceId";
      });

    if (!hasTraceIdColumn && traceIdColumn) {
      await metricService.addColumnInDatabase(traceIdColumn);
    }

    // Add spanId column
    const hasSpanIdColumn: boolean =
      await metricService.doesColumnExistInDatabase("spanId");

    const spanIdColumn: AnalyticsTableColumn | undefined =
      metricModel.tableColumns.find((column: AnalyticsTableColumn) => {
        return column.key === "spanId";
      });

    if (!hasSpanIdColumn && spanIdColumn) {
      await metricService.addColumnInDatabase(spanIdColumn);
    }
  }

  public override async rollback(): Promise<void> {
    const hasTraceIdColumn: boolean =
      await metricService.doesColumnExistInDatabase("traceId");

    if (hasTraceIdColumn) {
      await metricService.dropColumnInDatabase("traceId");
    }

    const hasSpanIdColumn: boolean =
      await metricService.doesColumnExistInDatabase("spanId");

    if (hasSpanIdColumn) {
      await metricService.dropColumnInDatabase("spanId");
    }
  }
}
