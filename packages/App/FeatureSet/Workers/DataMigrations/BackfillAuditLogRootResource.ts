import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import { MigrationExecuteOptions } from "Common/Server/Services/AnalyticsDatabaseService";
import AuditLogService from "Common/Server/Services/AuditLogService";
import {
  getStorageTableName,
  onClusterClause,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import logger from "Common/Server/Utils/Logger";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";

export const ROOT_RESOURCE_COLUMN_KEYS: ReadonlyArray<string> = [
  "rootResourceType",
  "rootResourceId",
];

/**
 * Points every AuditLog row written before the root-resource columns existed
 * at itself:
 *
 *   rootResourceType = resourceType, rootResourceId = resourceId
 *
 * A resource's audit page (the SLO's, first) now filters on rootResourceId so
 * it can list the history of the rows it owns. Rows written before the columns
 * existed carry NULL there and would vanish from those pages - up to 180 days
 * of history, the longest retention a project can choose. Every such row
 * belongs to a top-level resource (no child model was audited before the
 * columns), so pointing it at itself is exactly what AuditLogService writes
 * for the same change today.
 *
 * Safe to run twice, and concurrently (the runner does not serialize):
 *   - the columns are added with ADD COLUMN IF NOT EXISTS when boot
 *     schema-sync has not already added them;
 *   - the mutation only touches rows whose rootResourceId is still NULL, so a
 *     second run - or a row written by current code, child rows included -
 *     is left alone.
 *
 * The mutation targets the local storage table ON CLUSTER, like every data
 * mutation on the clustered analytics schema, and is queued asynchronously
 * (ClickHouse's default mutations_sync = 0): this migration returns once the
 * mutation is registered, and parts are rewritten in the background.
 */
export default class BackfillAuditLogRootResource extends DataMigrationBase {
  public constructor() {
    super("BackfillAuditLogRootResource");
  }

  public static getBackfillStatement(tableName: string): string {
    return `ALTER TABLE ${getStorageTableName(tableName)}${onClusterClause()} UPDATE rootResourceType = resourceType, rootResourceId = resourceId WHERE rootResourceId IS NULL`;
  }

  public override async migrate(): Promise<void> {
    const model: AuditLog = new AuditLog();
    const storageTableName: string = getStorageTableName(model.tableName);

    /*
     * Boot and the migrate Job both create the analytics tables before data
     * migrations run, so a missing table means there is nothing to backfill:
     * the table will be created with the columns already in place. Skip
     * rather than throw - the runner halts the whole chain at the first
     * failure.
     */
    if (!(await ClickHouseMigrationUtil.tableExists(storageTableName))) {
      logger.info(
        `BackfillAuditLogRootResource: ${storageTableName} does not exist; nothing to backfill.`,
      );
      return;
    }

    for (const key of ROOT_RESOURCE_COLUMN_KEYS) {
      const column: AnalyticsTableColumn | undefined = model.tableColumns.find(
        (item: AnalyticsTableColumn) => {
          return item.key === key;
        },
      );

      if (!column) {
        /*
         * Only possible if the column is removed from the model later, in
         * which case there is nothing left to backfill. Skip, never throw, for
         * the same chain-halting reason as above.
         */
        logger.warn(
          `BackfillAuditLogRootResource: ${model.tableName} does not declare ${key}; skipping the backfill.`,
        );
        return;
      }

      if (!(await AuditLogService.doesColumnExist(key))) {
        // Idempotent: ADD COLUMN IF NOT EXISTS, plus the column's skip index.
        await AuditLogService.addColumnInDatabase(column);
        logger.info(
          `BackfillAuditLogRootResource: added ${model.tableName}.${key}`,
        );
      }
    }

    await AuditLogService.execute(
      BackfillAuditLogRootResource.getBackfillStatement(model.tableName),
      MigrationExecuteOptions,
    );

    logger.info(
      `BackfillAuditLogRootResource: queued the root-resource backfill of ${storageTableName}`,
    );
  }

  public override async rollback(): Promise<void> {
    /*
     * Deliberately a no-op. The pointers it wrote are exactly what current
     * code writes for the same rows, and clearing them would hide that
     * history from resource audit pages again.
     */
    return;
  }
}
