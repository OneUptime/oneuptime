import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import MetricService from "CommonServer/Services/MetricService";
import Metric from "Common/AppModels/AnalyticsModels/Metric";

export default class AddIsMonotonicToMetric extends DataMigrationBase {
  public constructor() {
    super("AddIsMonotonicToMetric");
  }

  public override async migrate(): Promise<void> {
    const column: AnalyticsTableColumn | undefined =
      new Metric().tableColumns.find((column: AnalyticsTableColumn) => {
        return column.key === "isMonotonic";
      });

    if (!column) {
      return;
    }

    const columnType: TableColumnType | null =
      await MetricService.getColumnTypeInDatabase(column);

    if (!columnType) {
      await MetricService.dropColumnInDatabase("isMonotonic");
      await MetricService.addColumnInDatabase(column);
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
