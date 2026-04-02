import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import Log from "Common/Models/AnalyticsModels/Log";
import LogService from "Common/Server/Services/LogService";

export default class AddOtelFieldsToLogTable extends DataMigrationBase {
  public constructor() {
    super("AddOtelFieldsToLogTable");
  }

  public override async migrate(): Promise<void> {
    const columnKeys: string[] = [
      "observedTimeUnixNano",
      "droppedAttributesCount",
      "flags",
    ];

    for (const key of columnKeys) {
      const hasColumn: boolean =
        await LogService.doesColumnExistInDatabase(key);

      if (!hasColumn) {
        const column: AnalyticsTableColumn | undefined =
          new Log().tableColumns.find((col: AnalyticsTableColumn) => {
            return col.key === key;
          });

        if (column) {
          await LogService.addColumnInDatabase(column);
        }
      }
    }
  }

  public override async rollback(): Promise<void> {
    const columnKeys: string[] = [
      "observedTimeUnixNano",
      "droppedAttributesCount",
      "flags",
    ];

    for (const key of columnKeys) {
      const hasColumn: boolean =
        await LogService.doesColumnExistInDatabase(key);

      if (hasColumn) {
        await LogService.dropColumnInDatabase(key);
      }
    }
  }
}
