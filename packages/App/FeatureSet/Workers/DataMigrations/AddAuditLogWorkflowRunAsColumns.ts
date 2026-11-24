import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import AuditLogService from "Common/Server/Services/AuditLogService";
import { getStorageTableName } from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import logger from "Common/Server/Utils/Logger";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import { WORKFLOW_RUN_AS_AUDIT_COLUMNS } from "Common/Types/Workflow/WorkflowRunAs";

/*
 * The columns to add: what the workflow whose step made a change ran as,
 * and with whose permissions (#9766). Each is declared on the AuditLog
 * model as optional, so ClickHouse creates them Nullable and every row
 * written before this migration reads NULL - which says nothing either way:
 * those entries were recorded before a step's audit entry said it.
 */
export const AUDIT_LOG_WORKFLOW_RUN_AS_COLUMN_KEYS: Array<string> = [
  ...WORKFLOW_RUN_AS_AUDIT_COLUMNS,
];

/**
 * Adds the audit-log columns that say what a workflow's step ran as:
 *
 *   AuditLogV2: workflowRunAs                Nullable(String)
 *               workflowRunAsCustomRoleName  Nullable(String)
 *               workflowRunAsGiverUserId     Nullable(String)
 *               workflowRunAsGiverApiKeyId   Nullable(String)
 *               workflowRunAsGiverName       Nullable(String)
 *
 * (The giver's three were named workflowRunAsGivenBy{UserId,ApiKeyId,Name}
 * when this was written; this adds what the model declares, and
 * CopyAuditLogWorkflowRunAsGiverColumns carries over what an install
 * recorded under the first names.)
 *
 * Metadata-only and idempotent: ADD COLUMN IF NOT EXISTS, no part
 * rewritten, nothing backfilled. Modelled on AddAuditLogWorkflowColumns,
 * and the same two facts apply:
 *
 *  1. `runsInClusterMode()` is false, so the runner RECORDS this migration
 *     as executed without running it: the analytics schema is always a
 *     cluster, and single-node DDL against the Distributed / *Local split
 *     would fail. What adds the columns to an existing install is boot
 *     schema-sync (AnalyticsTableManagement.createTables ->
 *     reconcileColumns), which issues the additive ADD COLUMN for every
 *     column a model declares. This migration is the record of the change,
 *     and `migrate()` is what an operator can run by hand to make a table
 *     converge without a restart.
 *
 *  2. The data-migration runner HALTS THE ENTIRE CHAIN at the first failure,
 *     so a column the model does not (yet) declare, or a table that does not
 *     exist yet, is skipped with a warning rather than thrown over: a missing
 *     column costs an audit entry what its workflow ran as, and freezing
 *     every later migration in the repo over that is the wrong trade.
 */
export default class AddAuditLogWorkflowRunAsColumns extends DataMigrationBase {
  public constructor() {
    super("AddAuditLogWorkflowRunAsColumns");
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
        `AddAuditLogWorkflowRunAsColumns: ${storageTableName} does not exist; nothing to add.`,
      );
      return;
    }

    for (const key of AUDIT_LOG_WORKFLOW_RUN_AS_COLUMN_KEYS) {
      const column: AnalyticsTableColumn | undefined = model.tableColumns.find(
        (item: AnalyticsTableColumn) => {
          return item.key === key;
        },
      );

      if (!column) {
        logger.warn(
          `AddAuditLogWorkflowRunAsColumns: ${model.tableName} does not declare ${key}; skipping (boot schema-sync adds it once the model declares it).`,
        );
        continue;
      }

      try {
        if (await AuditLogService.doesColumnExist(key)) {
          logger.info(
            `AddAuditLogWorkflowRunAsColumns: ${model.tableName}.${key} already present`,
          );
          continue;
        }

        // Idempotent: ADD COLUMN IF NOT EXISTS.
        await AuditLogService.addColumnInDatabase(column);

        logger.info(
          `AddAuditLogWorkflowRunAsColumns: added ${model.tableName}.${key}`,
        );
      } catch (err) {
        logger.error(
          `AddAuditLogWorkflowRunAsColumns: failed on ${model.tableName}.${key}:`,
        );
        logger.error(err as Error);
        throw new Error(
          `AddAuditLogWorkflowRunAsColumns: ${model.tableName}.${key}: ${(err as Error).message}`,
        );
      }
    }
  }

  public override async rollback(): Promise<void> {
    /*
     * Deliberately a no-op. Dropping the columns would discard what every
     * workflow change recorded since ran as, to undo a metadata-only add,
     * and a re-run of migrate() is idempotent anyway.
     */
    return;
  }
}
