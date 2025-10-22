import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import Metric from "Common/Models/AnalyticsModels/Metric";
import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import MetricService from "Common/Server/Services/MetricService";

export default class AddAttributeKeysColumnToTelemetryTables extends DataMigrationBase {
  public constructor() {
    super("AddAttributeKeysColumnToTelemetryTables");
  }

  public override async migrate(): Promise<void> {
    await this.addAttributeKeysColumnToLog();
    await this.addAttributeKeysColumnToSpan();
    await this.addAttributeKeysColumnToMetric();
  }

  private async addAttributeKeysColumnToLog(): Promise<void> {
    const column: AnalyticsTableColumn | undefined =
      new Log().tableColumns.find((item: AnalyticsTableColumn) => {
        return item.key === "attributeKeys";
      });

    if (!column) {
      return;
    }

    const columnType: TableColumnType | null =
      await LogService.getColumnTypeInDatabase(column);

    if (!columnType) {
      await LogService.dropColumnInDatabase("attributeKeys");
      await LogService.addColumnInDatabase(column);
    }
  }

  private async addAttributeKeysColumnToSpan(): Promise<void> {
    const column: AnalyticsTableColumn | undefined =
      new Span().tableColumns.find((item: AnalyticsTableColumn) => {
        return item.key === "attributeKeys";
      });

    if (!column) {
      return;
    }

    const columnType: TableColumnType | null =
      await SpanService.getColumnTypeInDatabase(column);

    if (!columnType) {
      await SpanService.dropColumnInDatabase("attributeKeys");
      await SpanService.addColumnInDatabase(column);
    }
  }

  private async addAttributeKeysColumnToMetric(): Promise<void> {
    const column: AnalyticsTableColumn | undefined =
      new Metric().tableColumns.find((item: AnalyticsTableColumn) => {
        return item.key === "attributeKeys";
      });

    if (!column) {
      return;
    }

    const columnType: TableColumnType | null =
      await MetricService.getColumnTypeInDatabase(column);

    if (!columnType) {
      await MetricService.dropColumnInDatabase("attributeKeys");
      await MetricService.addColumnInDatabase(column);
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
