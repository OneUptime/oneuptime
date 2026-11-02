import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import NetworkTrafficUsage from "Common/Models/AnalyticsModels/NetworkTrafficUsage";
import NetworkTrafficUsageService from "Common/Server/Services/NetworkTrafficUsageService";
import { getStorageTableName } from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import logger from "Common/Server/Utils/Logger";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";

/*
 * The columns to add. Both are declared on the NetworkTrafficUsage model as
 * optional, so ClickHouse creates them Nullable and every row written before
 * this migration reads NULL: "nothing measured here", which is true of all
 * of them.
 */
export const NETWORK_TRAFFIC_USAGE_UPLINK_HEALTH_COLUMN_KEYS: Array<string> = [
  "lossPercent",
  "latencyMs",
];

/**
 * Adds the columns that hold what Meraki measured on an appliance's uplinks
 * (the rows of kind uplinkHealth, issue #5377):
 *
 *   NetworkTrafficUsageV1: lossPercent Nullable(Double)
 *                          latencyMs   Nullable(Double)
 *
 * Metadata-only and idempotent: ADD COLUMN IF NOT EXISTS, no part rewritten,
 * nothing backfilled. Modelled on AddAuditLogMcpClientColumns, and the same
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
 *     exist yet, is skipped with a warning rather than thrown over: a missing
 *     column costs an uplink its loss and latency, and freezing every later
 *     migration in the repo over that is the wrong trade.
 */
export default class AddNetworkTrafficUsageUplinkHealthColumns extends DataMigrationBase {
  public constructor() {
    super("AddNetworkTrafficUsageUplinkHealthColumns");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  public override async migrate(): Promise<void> {
    const model: NetworkTrafficUsage = new NetworkTrafficUsage();
    const storageTableName: string = getStorageTableName(model.tableName);

    /*
     * Boot and the migrate Job both create the analytics tables before data
     * migrations run, so a missing table will be created with these columns
     * already in place. Skip rather than throw (see 2. above).
     */
    if (!(await ClickHouseMigrationUtil.tableExists(storageTableName))) {
      logger.info(
        `AddNetworkTrafficUsageUplinkHealthColumns: ${storageTableName} does not exist; nothing to add.`,
      );
      return;
    }

    for (const key of NETWORK_TRAFFIC_USAGE_UPLINK_HEALTH_COLUMN_KEYS) {
      const column: AnalyticsTableColumn | undefined = model.tableColumns.find(
        (item: AnalyticsTableColumn) => {
          return item.key === key;
        },
      );

      if (!column) {
        logger.warn(
          `AddNetworkTrafficUsageUplinkHealthColumns: ${model.tableName} does not declare ${key}; skipping (boot schema-sync adds it once the model declares it).`,
        );
        continue;
      }

      try {
        if (await NetworkTrafficUsageService.doesColumnExist(key)) {
          logger.info(
            `AddNetworkTrafficUsageUplinkHealthColumns: ${model.tableName}.${key} already present`,
          );
          continue;
        }

        // Idempotent: ADD COLUMN IF NOT EXISTS.
        await NetworkTrafficUsageService.addColumnInDatabase(column);

        logger.info(
          `AddNetworkTrafficUsageUplinkHealthColumns: added ${model.tableName}.${key}`,
        );
      } catch (err) {
        logger.error(
          `AddNetworkTrafficUsageUplinkHealthColumns: failed on ${model.tableName}.${key}:`,
        );
        logger.error(err as Error);
        throw new Error(
          `AddNetworkTrafficUsageUplinkHealthColumns: ${model.tableName}.${key}: ${(err as Error).message}`,
        );
      }
    }
  }

  public override async rollback(): Promise<void> {
    /*
     * Deliberately a no-op. Dropping the columns would discard every loss
     * and latency measured since, to undo a metadata-only add, and a re-run
     * of migrate() is idempotent anyway.
     */
    return;
  }
}
