import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";

export default class AddColumnsToExceptionInstance extends DataMigrationBase {
  public constructor() {
    super("AddColumnsToExceptionInstance");
  }

  public override async migrate(): Promise<void> {
    const columnKeys: string[] = ["release", "environment", "parsedFrames"];

    for (const key of columnKeys) {
      const hasColumn: boolean =
        await ExceptionInstanceService.doesColumnExistInDatabase(key);

      if (!hasColumn) {
        const column: AnalyticsTableColumn | undefined =
          new ExceptionInstance().tableColumns.find(
            (col: AnalyticsTableColumn) => {
              return col.key === key;
            },
          );

        if (column) {
          await ExceptionInstanceService.addColumnInDatabase(column);
        }
      }
    }
  }

  public override async rollback(): Promise<void> {
    const columnKeys: string[] = ["release", "environment", "parsedFrames"];

    for (const key of columnKeys) {
      const hasColumn: boolean =
        await ExceptionInstanceService.doesColumnExistInDatabase(key);

      if (hasColumn) {
        await ExceptionInstanceService.dropColumnInDatabase(key);
      }
    }
  }
}
