import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import Span from "Common/Models/AnalyticsModels/Span";
import SpanService from "Common/Server/Services/SpanService";
import logger from "Common/Server/Utils/Logger";

export default class AddIsRootSpanToSpanTable extends DataMigrationBase {
  public constructor() {
    super("AddIsRootSpanToSpanTable");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  public override async migrate(): Promise<void> {
    /*
     * Legacy V2-era migration. On fresh installs of the V3 cut SpanItemV2
     * never exists (models create SpanItemV3 with isRootSpan built in) and
     * the unguarded ALTER below would throw UNKNOWN_TABLE and wedge the
     * whole migration chain — skip entirely.
     */
    if (!(await ClickHouseMigrationUtil.tableExists("SpanItemV2"))) {
      logger.info(
        "AddIsRootSpanToSpanTable: SpanItemV2 not present (fresh V3 install) — skipping.",
        { service: "workers" },
      );
      return;
    }

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
