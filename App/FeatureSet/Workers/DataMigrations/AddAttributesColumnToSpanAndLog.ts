import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import LogService from "CommonServer/Services/LogService";
import SpanService from "CommonServer/Services/SpanService";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";

export default class AddAttributeColumnToSpanAndLog extends DataMigrationBase {
  public constructor() {
    super("AddAttributeColumnToSpanAndLog");
  }

  public override async migrate(): Promise<void> {
    await this.addAttributesColumnToLog();
    await this.addAttributesColumnToSpan();
  }

  public async addAttributesColumnToLog(): Promise<void> {
    // logs
    const logsAttributesColumn: AnalyticsTableColumn | undefined =
      new Log().tableColumns.find((column: AnalyticsTableColumn) => {
        return column.key === "attributes";
      });

    if (!logsAttributesColumn) {
      return;
    }

    const columnType: TableColumnType | null =
      await LogService.getColumnTypeInDatabase(logsAttributesColumn);

    if (!columnType) {
      await LogService.dropColumnInDatabase("attributes");
      await LogService.addColumnInDatabase(logsAttributesColumn);
    }
  }

  public async addAttributesColumnToSpan(): Promise<void> {
    // spans

    const spansAttributesColumn: AnalyticsTableColumn | undefined =
      new Span().tableColumns.find((column: AnalyticsTableColumn) => {
        return column.key === "attributes";
      });

    if (!spansAttributesColumn) {
      return;
    }

    const spansColumnType: TableColumnType | null =
      await SpanService.getColumnTypeInDatabase(spansAttributesColumn);

    if (!spansColumnType) {
      await SpanService.dropColumnInDatabase("attributes");
      await SpanService.addColumnInDatabase(spansAttributesColumn);
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
