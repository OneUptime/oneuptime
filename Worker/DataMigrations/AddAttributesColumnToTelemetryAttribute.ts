import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import TelemetryAttributeService from "Common/Server/Services/TelemetryAttributeService";
import TelemetryAttribute from "Common/Models/AnalyticsModels/TelemetryAttribute";

export default class AddAttributesColumnToTelemetryAttribute extends DataMigrationBase {
  public constructor() {
    super("AddAttributesColumnToTelemetryAttribute");
  }

  public override async migrate(): Promise<void> {
    const column: AnalyticsTableColumn | undefined =
      new TelemetryAttribute().tableColumns.find(
        (column: AnalyticsTableColumn) => {
          return column.key === "attributes";
        },
      );

    if (!column) {
      return;
    }

    const columnType: TableColumnType | null =
      await TelemetryAttributeService.getColumnTypeInDatabase(column);

    if (!columnType) {
      await TelemetryAttributeService.dropColumnInDatabase("attribute");
      await TelemetryAttributeService.addColumnInDatabase(column);
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
