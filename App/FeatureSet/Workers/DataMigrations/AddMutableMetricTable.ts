import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableManagement from "../Utils/AnalyticsDatabase/TableManegement";
import logger from "Common/Server/Utils/Logger";

export default class AddMutableMetricTable extends DataMigrationBase {
  public constructor() {
    super("AddMutableMetricTable");
  }

  public override async migrate(): Promise<void> {
    logger.info(
      "Creating MutableMetricItem analytics table. Historical MetricItemV3 rows are intentionally not backfilled.",
    );

    await AnalyticsTableManagement.createTables();
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
