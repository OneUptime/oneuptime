import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import MetricService from "CommonServer/Services/MetricService";
import Metric from "Common/Models/AnalyticsModels/Metric";

export default class AddAggregationTemporalityToMetric extends DataMigrationBase {
  public constructor() {
    super("AddAggregationTemporalityToMetric");
  }

  public override async migrate(): Promise<void> {
    const column: AnalyticsTableColumn | undefined =
      new Metric().tableColumns.find((column: AnalyticsTableColumn) => {
        return column.key === "aggregationTemporality";
      });

    if (!column) {
      return;
    }

    const columnType: TableColumnType | null =
      await MetricService.getColumnTypeInDatabase(column);

    if (!columnType) {
      await MetricService.dropColumnInDatabase("aggregationTemporality");
      await MetricService.addColumnInDatabase(column);
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
