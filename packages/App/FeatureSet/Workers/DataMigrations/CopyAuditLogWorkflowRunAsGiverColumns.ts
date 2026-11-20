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

// An audit-log column under its first name, and the name it has now.
export interface RenamedAuditLogColumn {
  from: string;
  to: string;
}

/*
 * The columns that say whose permissions a workflow's step ran with
 * (#9766), under the names AddAuditLogWorkflowRunAsColumns first gave them
 * and the names the AuditLog model gives them now.
 */
export const AUDIT_LOG_WORKFLOW_RUN_AS_GIVER_RENAMES: ReadonlyArray<RenamedAuditLogColumn> =
  [
    { from: "workflowRunAsGivenByUserId", to: "workflowRunAsGiverUserId" },
    {
      from: "workflowRunAsGivenByApiKeyId",
      to: "workflowRunAsGiverApiKeyId",
    },
    { from: "workflowRunAsGivenByName", to: "workflowRunAsGiverName" },
  ];

/**
 * Copies whose permissions a workflow's step ran with, as an install
 * recorded it, into the columns that say it now:
 *
 *   workflowRunAsGivenByUserId   -> workflowRunAsGiverUserId
 *   workflowRunAsGivenByApiKeyId -> workflowRunAsGiverApiKeyId
 *   workflowRunAsGivenByName     -> workflowRunAsGiverName
 *
 * No analytics model names a column "<act> by user": the rule that closes
 * such a column to every write is the database models' own
 * (UserAttributionColumns), so the giver's columns are named for the giver,
 * as userId and apiKeyId are for whoever made the change. An install that
 * ran a build with the first names (main after #9791) recorded entries
 * under them. Boot schema-sync adds the new columns, empty. Without this,
 * those entries would stop saying whose permissions their workflow ran
 * with, in the table, its filters and the export.
 *
 * Safe to run twice, and concurrently, as the runner allows:
 *   - an install that never had the first names (one upgraded from a
 *     release before them, or a new one) has nothing to copy, and nothing
 *     is queued;
 *   - a new column the model declares is added with ADD COLUMN IF NOT
 *     EXISTS when boot schema-sync has not added it yet;
 *   - each value is copied only into a column that holds none
 *     (coalesce), so a second run, or a row written by current code, keeps
 *     what it has.
 *
 * The mutation targets the local storage table ON CLUSTER, like every data
 * mutation on the clustered analytics schema, and is queued asynchronously
 * (ClickHouse's default mutations_sync = 0), as BackfillAuditLogRootResource
 * is. The first names' columns stay, holding what they held: dropping them
 * while the copy is queued would lose it, and nothing reads them.
 */
export default class CopyAuditLogWorkflowRunAsGiverColumns extends DataMigrationBase {
  public constructor() {
    super("CopyAuditLogWorkflowRunAsGiverColumns");
  }

  /*
   * The copy of `renames` - the ones an install has under their first
   * names - on the storage table of `tableName`.
   */
  public static getCopyStatement(data: {
    tableName: string;
    renames: ReadonlyArray<RenamedAuditLogColumn>;
  }): string {
    const assignments: string = data.renames
      .map((rename: RenamedAuditLogColumn): string => {
        return `${rename.to} = coalesce(${rename.to}, ${rename.from})`;
      })
      .join(", ");
    const recordedUnderFirstNames: string = data.renames
      .map((rename: RenamedAuditLogColumn): string => {
        return `${rename.from} IS NOT NULL`;
      })
      .join(" OR ");

    return `ALTER TABLE ${getStorageTableName(data.tableName)}${onClusterClause()} UPDATE ${assignments} WHERE ${recordedUnderFirstNames}`;
  }

  public override async migrate(): Promise<void> {
    const model: AuditLog = new AuditLog();
    const storageTableName: string = getStorageTableName(model.tableName);

    /*
     * Boot and the migrate Job both create the analytics tables before data
     * migrations run, so a missing table has nothing recorded in it: it is
     * created with the new columns. Skip rather than throw - the runner
     * halts the whole chain at the first failure.
     */
    if (!(await ClickHouseMigrationUtil.tableExists(storageTableName))) {
      logger.info(
        `CopyAuditLogWorkflowRunAsGiverColumns: ${storageTableName} does not exist; nothing to copy.`,
      );
      return;
    }

    const renames: Array<RenamedAuditLogColumn> = [];

    for (const rename of AUDIT_LOG_WORKFLOW_RUN_AS_GIVER_RENAMES) {
      if (await AuditLogService.doesColumnExist(rename.from)) {
        renames.push(rename);
      }
    }

    if (renames.length === 0) {
      logger.info(
        `CopyAuditLogWorkflowRunAsGiverColumns: ${storageTableName} never had the first names; nothing to copy.`,
      );
      return;
    }

    for (const rename of renames) {
      const column: AnalyticsTableColumn | undefined = model.tableColumns.find(
        (item: AnalyticsTableColumn) => {
          return item.key === rename.to;
        },
      );

      if (!column) {
        /*
         * Only possible if the column leaves the model later, and then
         * there is nowhere to copy to. Skip, never throw, for the same
         * chain-halting reason as above.
         */
        logger.warn(
          `CopyAuditLogWorkflowRunAsGiverColumns: ${model.tableName} does not declare ${rename.to}; skipping the copy.`,
        );
        return;
      }

      if (!(await AuditLogService.doesColumnExist(rename.to))) {
        // Idempotent: ADD COLUMN IF NOT EXISTS.
        await AuditLogService.addColumnInDatabase(column);
        logger.info(
          `CopyAuditLogWorkflowRunAsGiverColumns: added ${model.tableName}.${rename.to}`,
        );
      }
    }

    await AuditLogService.execute(
      CopyAuditLogWorkflowRunAsGiverColumns.getCopyStatement({
        tableName: model.tableName,
        renames: renames,
      }),
      MigrationExecuteOptions,
    );

    logger.info(
      `CopyAuditLogWorkflowRunAsGiverColumns: queued the copy of ${renames
        .map((rename: RenamedAuditLogColumn): string => {
          return rename.from;
        })
        .join(", ")} on ${storageTableName}`,
    );
  }

  public override async rollback(): Promise<void> {
    /*
     * Deliberately a no-op. The first names' columns were left as they
     * were, and clearing the copies would hide whose permissions those
     * entries' workflows ran with.
     */
    return;
  }
}
