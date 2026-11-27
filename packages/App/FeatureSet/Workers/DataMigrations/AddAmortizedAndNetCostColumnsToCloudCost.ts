import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import CloudCost from "Common/Models/AnalyticsModels/CloudCost";
import CloudCostService from "Common/Server/Services/CloudCostService";
import { getStorageTableName } from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import logger from "Common/Server/Utils/Logger";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";

// The columns to add, in order: each cost amortized, and net, as CloudCost declares them.
export const CLOUD_COST_BASIS_COLUMN_KEYS: ReadonlyArray<string> = [
  "amortizedCost",
  "netCost",
];

/**
 * Adds the amortized and net figures to the cloud costs table (#11007):
 *
 *   CloudCostV1: amortizedCost Decimal DEFAULT cost
 *                netCost       Decimal DEFAULT cost
 *
 * Each cost is kept billed (cost), amortized - commitment fees spread over
 * the usage and days they cover - and net, less credits, refunds and
 * discounts, so Cloud > Costs shows the spend on the basis a person picks.
 * Rows written before read their billed figure in both (the DEFAULT, worked
 * out as they are read, so nothing is rewritten); the costs lane reads its
 * accounts' costs again as far back as a first read does, once, so the
 * days it reads take their own amortized and net figures
 * (CLOUD_COSTS_READ_VERSION).
 *
 * Metadata-only and idempotent: ADD COLUMN IF NOT EXISTS, no part rewritten,
 * nothing backfilled. Modelled on AddTagsColumnToCloudCost, and the same
 * two facts apply:
 *
 *  1. `runsInClusterMode()` is false, so the runner RECORDS this migration
 *     as executed without running it: the analytics schema is always a
 *     cluster, and single-node DDL against the Distributed / *Local split
 *     would fail. What actually adds the columns to an existing install is
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
export default class AddAmortizedAndNetCostColumnsToCloudCost extends DataMigrationBase {
  public constructor() {
    super("AddAmortizedAndNetCostColumnsToCloudCost");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  public override async migrate(): Promise<void> {
    const model: CloudCost = new CloudCost();
    const storageTableName: string = getStorageTableName(model.tableName);

    /*
     * Boot and the migrate Job both create the analytics tables before data
     * migrations run, so a missing table will be created with the columns
     * already in place. Skip rather than throw (see 2. above).
     */
    if (!(await ClickHouseMigrationUtil.tableExists(storageTableName))) {
      logger.info(
        `AddAmortizedAndNetCostColumnsToCloudCost: ${storageTableName} does not exist; nothing to add.`,
      );
      return;
    }

    for (const key of CLOUD_COST_BASIS_COLUMN_KEYS) {
      const column: AnalyticsTableColumn | undefined = model.tableColumns.find(
        (item: AnalyticsTableColumn) => {
          return item.key === key;
        },
      );

      if (!column) {
        logger.warn(
          `AddAmortizedAndNetCostColumnsToCloudCost: ${model.tableName} does not declare ${key}; skipping (boot schema-sync adds it once the model declares it).`,
        );
        continue;
      }

      try {
        if (await CloudCostService.doesColumnExist(key)) {
          logger.info(
            `AddAmortizedAndNetCostColumnsToCloudCost: ${model.tableName}.${key} already present`,
          );
          continue;
        }

        // Idempotent: ADD COLUMN IF NOT EXISTS.
        await CloudCostService.addColumnInDatabase(column);

        logger.info(
          `AddAmortizedAndNetCostColumnsToCloudCost: added ${model.tableName}.${key}`,
        );
      } catch (err) {
        logger.error(
          `AddAmortizedAndNetCostColumnsToCloudCost: failed on ${model.tableName}.${key}:`,
        );
        logger.error(err as Error);
        throw new Error(
          `AddAmortizedAndNetCostColumnsToCloudCost: ${model.tableName}.${key}: ${(err as Error).message}`,
        );
      }
    }
  }

  public override async rollback(): Promise<void> {
    /*
     * Deliberately a no-op. Dropping the columns would discard the amortized
     * and net figures of every cost read since, to undo a metadata-only
     * add, and a re-run of migrate() is idempotent anyway.
     */
    return;
  }
}
