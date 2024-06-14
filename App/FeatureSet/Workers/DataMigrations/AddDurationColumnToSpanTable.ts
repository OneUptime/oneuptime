import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import SpanService from "CommonServer/Services/SpanService";
import Span from "Model/AnalyticsModels/Span";

export default class AddDurationColumnToSpanTable extends DataMigrationBase {
  public constructor() {
    super("AddDurationColumnToSpanTable");
  }

  public override async migrate(): Promise<void> {
    const hasDurationColumn: boolean =
      await SpanService.doesColumnExistInDatabase("durationUnixNano");

    const durationColumn: AnalyticsTableColumn = new Span().tableColumns.find(
      (column: AnalyticsTableColumn) => {
        return column.key === "durationUnixNano";
      },
    )!;

    if (!hasDurationColumn && durationColumn) {
      await SpanService.addColumnInDatabase(durationColumn);
    }
  }

  public override async rollback(): Promise<void> {
    const hasDurationColumn: boolean =
      await SpanService.doesColumnExistInDatabase("durationUnixNano");

    if (hasDurationColumn) {
      await SpanService.dropColumnInDatabase("durationUnixNano");
    }
  }
}
