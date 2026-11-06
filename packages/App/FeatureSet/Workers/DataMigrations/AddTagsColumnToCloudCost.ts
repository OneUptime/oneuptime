import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import CloudCost from "Common/Models/AnalyticsModels/CloudCost";
import CloudCostService from "Common/Server/Services/CloudCostService";
import { getStorageTableName } from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import logger from "Common/Server/Utils/Logger";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";

// The column to add: each cost's tags, as CloudCost declares it.
export const CLOUD_COST_TAGS_COLUMN_KEY: string = "tags";

/**
 * Adds the tags column to the cloud costs table:
 *
 *   CloudCostV1: tags Map(String, String) DEFAULT {}
 *
 * Each cost keeps the tags of what it is for - a Google Cloud billing
 * export's labels, else the tags of the resource it is billed to - so
 * Cloud > Costs breaks the spend down by a tag. Rows written before read no
 * tags, which is what they were stored knowing; the costs lane reads its
 * accounts' costs again as far back as a first read does, once, so the
 * days it reads take their tags (CLOUD_COSTS_READ_VERSION).
 *
 * Metadata-only and idempotent: ADD COLUMN IF NOT EXISTS, no part rewritten,
 * nothing backfilled. Modelled on AddProcessColumnsToSecurityEvent, and the
 * same two facts apply:
 *
 *  1. `runsInClusterMode()` is false, so the runner RECORDS this migration
 *     as executed without running it: the analytics schema is always a
 *     cluster, and single-node DDL against the Distributed / *Local split
 *     would fail. What actually adds the column to an existing install is
 *     boot schema-sync (AnalyticsTableManagement.createTables ->
 *     reconcileColumns), which issues the additive ADD COLUMN for every
 *     column a model declares. This migration is the record of the change in
 *     the migration history, and `migrate()` is what an operator can run by
 *     hand to make a table converge without a restart.
 *
 *  2. The data-migration runner HALTS THE ENTIRE CHAIN at the first failure,
 *     so a column the model does not (yet) declare, or a table that does not
 *     exist yet, is skipped with a warning rather than thrown over.
 */
export default class AddTagsColumnToCloudCost extends DataMigrationBase {
  public constructor() {
    super("AddTagsColumnToCloudCost");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  public override async migrate(): Promise<void> {
    const model: CloudCost = new CloudCost();
    const storageTableName: string = getStorageTableName(model.tableName);

    /*
     * Boot and the migrate Job both create the analytics tables before data
     * migrations run, so a missing table will be created with the column
     * already in place. Skip rather than throw (see 2. above).
     */
    if (!(await ClickHouseMigrationUtil.tableExists(storageTableName))) {
      logger.info(
        `AddTagsColumnToCloudCost: ${storageTableName} does not exist; nothing to add.`,
      );
      return;
    }

    const column: AnalyticsTableColumn | undefined = model.tableColumns.find(
      (item: AnalyticsTableColumn) => {
        return item.key === CLOUD_COST_TAGS_COLUMN_KEY;
      },
    );

    if (!column) {
      logger.warn(
        `AddTagsColumnToCloudCost: ${model.tableName} does not declare ${CLOUD_COST_TAGS_COLUMN_KEY}; skipping (boot schema-sync adds it once the model declares it).`,
      );
      return;
    }

    try {
      if (await CloudCostService.doesColumnExist(CLOUD_COST_TAGS_COLUMN_KEY)) {
        logger.info(
          `AddTagsColumnToCloudCost: ${model.tableName}.${CLOUD_COST_TAGS_COLUMN_KEY} already present`,
        );
        return;
      }

      // Idempotent: ADD COLUMN IF NOT EXISTS.
      await CloudCostService.addColumnInDatabase(column);

      logger.info(
        `AddTagsColumnToCloudCost: added ${model.tableName}.${CLOUD_COST_TAGS_COLUMN_KEY}`,
      );
    } catch (err) {
      logger.error(
        `AddTagsColumnToCloudCost: failed on ${model.tableName}.${CLOUD_COST_TAGS_COLUMN_KEY}:`,
      );
      logger.error(err as Error);
      throw new Error(
        `AddTagsColumnToCloudCost: ${model.tableName}.${CLOUD_COST_TAGS_COLUMN_KEY}: ${(err as Error).message}`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    /*
     * Deliberately a no-op. Dropping the column would discard the tags of
     * every cost read since, to undo a metadata-only add, and a re-run of
     * migrate() is idempotent anyway.
     */
    return;
  }
}
