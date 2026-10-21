import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import AuditLogService from "Common/Server/Services/AuditLogService";
import { getStorageTableName } from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import logger from "Common/Server/Utils/Logger";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";

/*
 * The columns to add. Both are declared on the AuditLog model as optional, so
 * ClickHouse creates them Nullable and every row written before this
 * migration reads NULL - "this change was not made through an MCP client",
 * which is true of all of them.
 */
export const AUDIT_LOG_MCP_CLIENT_COLUMN_KEYS: Array<string> = [
  "mcpOAuthGrantId",
  "mcpClientName",
];

/**
 * Adds the audit-log columns that record that a change was made through an
 * MCP client a member connected with OAuth, and which client:
 *
 *   AuditLogV2: mcpOAuthGrantId Nullable(String)
 *               mcpClientName   Nullable(String)
 *
 * Metadata-only and idempotent: ADD COLUMN IF NOT EXISTS, no part rewritten,
 * nothing backfilled. Modelled on AddSessionReplayVisitorIdColumn, and the
 * same two facts apply:
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
 *     column costs an audit entry its "via which client", and freezing every
 *     later migration in the repo over that is the wrong trade.
 */
export default class AddAuditLogMcpClientColumns extends DataMigrationBase {
  public constructor() {
    super("AddAuditLogMcpClientColumns");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  public override async migrate(): Promise<void> {
    const model: AuditLog = new AuditLog();
    const storageTableName: string = getStorageTableName(model.tableName);

    /*
     * Boot and the migrate Job both create the analytics tables before data
     * migrations run, so a missing table will be created with these columns
     * already in place. Skip rather than throw (see 2. above).
     */
    if (!(await ClickHouseMigrationUtil.tableExists(storageTableName))) {
      logger.info(
        `AddAuditLogMcpClientColumns: ${storageTableName} does not exist; nothing to add.`,
      );
      return;
    }

    for (const key of AUDIT_LOG_MCP_CLIENT_COLUMN_KEYS) {
      const column: AnalyticsTableColumn | undefined = model.tableColumns.find(
        (item: AnalyticsTableColumn) => {
          return item.key === key;
        },
      );

      if (!column) {
        logger.warn(
          `AddAuditLogMcpClientColumns: ${model.tableName} does not declare ${key}; skipping (boot schema-sync adds it once the model declares it).`,
        );
        continue;
      }

      try {
        if (await AuditLogService.doesColumnExist(key)) {
          logger.info(
            `AddAuditLogMcpClientColumns: ${model.tableName}.${key} already present`,
          );
          continue;
        }

        // Idempotent: ADD COLUMN IF NOT EXISTS.
        await AuditLogService.addColumnInDatabase(column);

        logger.info(
          `AddAuditLogMcpClientColumns: added ${model.tableName}.${key}`,
        );
      } catch (err) {
        logger.error(
          `AddAuditLogMcpClientColumns: failed on ${model.tableName}.${key}:`,
        );
        logger.error(err as Error);
        throw new Error(
          `AddAuditLogMcpClientColumns: ${model.tableName}.${key}: ${(err as Error).message}`,
        );
      }
    }
  }

  public override async rollback(): Promise<void> {
    /*
     * Deliberately a no-op. Dropping the columns would discard which client
     * made every change recorded since, to undo a metadata-only add, and a
     * re-run of migrate() is idempotent anyway.
     */
    return;
  }
}
