import DataMigrationBase from ./DataMigrationBase;
import AnalyticsTableColumn from Common/Types/AnalyticsDatabase/TableColumn;
import TableColumnType from Common/Types/AnalyticsDatabase/TableColumnType;
import MetricService from CommonServer/Services/MetricService;
import Metric from Model/AnalyticsModels/Metric;

export default class AddAggregationTemporalityToMetric extends DataMigrationBase {
  public constructor() {
    super(AddAggregationTemporalityToMetric);
  }

  public override async migrate(): Promise<void> {
    const column = this.getAggregationTemporalityColumn();
    if (!column) {
      return;
    }

    const columnType = await this.getColumnTypeInDatabase(column);
    if (!columnType) {
      await this.dropColumnInDatabase(aggregationTemporality);
      await this.addColumnInDatabase(column);
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }

  private getAggregationTemporalityColumn(): AnalyticsTableColumn | undefined {
    return new Metric().tableColumns.find((column: AnalyticsTableColumn) => {
      return column.key === aggregationTemporality;
    });
  }

  private async getColumnTypeInDatabase(column: AnalyticsTableColumn): Promise<TableColumnType | null> {
    return MetricService.getColumnTypeInDatabase(column);
  }

  private async dropColumnInDatabase(columnName: string): Promise<void> {
    return MetricService.dropColumnInDatabase(columnName);
  }

  private async addColumnInDatabase(column: AnalyticsTableColumn): Promise<void> {
    return MetricService.addColumnInDatabase(column);
  }
}

