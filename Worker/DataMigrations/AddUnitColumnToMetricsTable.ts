import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import MetricService from "Common/Server/Services/MetricService";
import Metric from "Common/Models/AnalyticsModels/Metric";

export default class AddUnitColumnToMetricsTable extends DataMigrationBase {
  public constructor() {
    super("AddUnitColumnToMetricsTable");
  }

  public override async migrate(): Promise<void> {
    await this.addUnitColumnToMetricsTable();
  }

  public async addUnitColumnToMetricsTable(): Promise<void> {
    // logs
    const unitColumn: AnalyticsTableColumn | undefined =
      new Metric().tableColumns.find((column: AnalyticsTableColumn) => {
        return column.key === "unit";
      });

    if (!unitColumn) {
      return;
    }

    const columnType: TableColumnType | null =
      await MetricService.getColumnTypeInDatabase(unitColumn);

    if (!columnType) {
      await MetricService.dropColumnInDatabase("unit");
      await MetricService.addColumnInDatabase(unitColumn);
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
