import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import Span from "Common/Models/AnalyticsModels/Span";
import SpanService from "Common/Server/Services/SpanService";
import logger from "Common/Server/Utils/Logger";

export default class AddIsRootSpanToSpanTable extends DataMigrationBase {
  public constructor() {
    super("AddIsRootSpanToSpanTable");
  }

  public override async migrate(): Promise<void> {
    // Step 1: Add isRootSpan column if it doesn't exist
    const hasColumnAlready: boolean =
      await SpanService.doesColumnExist("isRootSpan");

    if (!hasColumnAlready) {
      const model: Span = new Span();
      const isRootSpanColumn: AnalyticsTableColumn | undefined =
        model.tableColumns.find((item: AnalyticsTableColumn) => {
          return item.key === "isRootSpan";
        });

      if (isRootSpanColumn) {
        await SpanService.addColumnInDatabase(isRootSpanColumn);
        logger.info("Added isRootSpan column to SpanItemV2", {
          service: "workers",
        });
      }
    } else {
      logger.info(
        "isRootSpan column already exists on SpanItemV2, skipping add",
        { service: "workers" },
      );
    }

    // Step 2: Backfill isRootSpan for existing rows where parentSpanId is empty or null
    await SpanService.execute(
      `ALTER TABLE SpanItemV2 UPDATE isRootSpan = 1 WHERE (parentSpanId = '' OR parentSpanId IS NULL) AND isRootSpan = 0 SETTINGS mutations_sync=0`,
    );
    logger.info(
      "Started async backfill of isRootSpan for existing SpanItemV2 rows",
      { service: "workers" },
    );
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
