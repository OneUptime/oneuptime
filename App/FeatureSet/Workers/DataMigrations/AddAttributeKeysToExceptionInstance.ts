import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import logger from "Common/Server/Utils/Logger";

export default class AddAttributeKeysToExceptionInstance extends DataMigrationBase {
  public constructor() {
    super("AddAttributeKeysToExceptionInstance");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  public override async migrate(): Promise<void> {
    const model: ExceptionInstance = new ExceptionInstance();
    const column: AnalyticsTableColumn | undefined = model.tableColumns.find(
      (item: AnalyticsTableColumn) => {
        return item.key === "attributeKeys";
      },
    );

    if (!column) {
      throw new Error("attributeKeys is not declared on ExceptionInstance");
    }

    try {
      await ExceptionInstanceService.addColumnInDatabase(column);
      logger.info(
        "AddAttributeKeysToExceptionInstance: ensured attributeKeys on ExceptionInstance",
      );
    } catch (err) {
      logger.error(
        "AddAttributeKeysToExceptionInstance: failed to add attributeKeys:",
      );
      logger.error(err as Error);
      throw err;
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
