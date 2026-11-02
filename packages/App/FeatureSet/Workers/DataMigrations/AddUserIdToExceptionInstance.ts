import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import { getStorageTableName } from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import logger from "Common/Server/Utils/Logger";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";

/*
 * The column to add. Declared on the ExceptionInstance model as a required
 * String with a '' default, so every occurrence stored before this migration
 * reads '' - "names no user", which is what it was stored with.
 */
export const EXCEPTION_INSTANCE_USER_ID_COLUMN_KEY: string = "userId";

/**
 * Adds the column that says which user an exception's occurrence happened
 * to, the one the exceptions list counts as the row's affected users:
 *
 *   ExceptionInstance: userId String DEFAULT ''
 *
 * Metadata-only and idempotent: ADD COLUMN IF NOT EXISTS, no part rewritten,
 * nothing backfilled. Modelled on AddAuditLogMcpClientColumns, and the same
 * two facts apply:
 *
 *  1. `runsInClusterMode()` is false, so the runner RECORDS this migration as
 *     executed without running it: the analytics schema is always a cluster,
 *     and single-node DDL against the Distributed / *Local split would fail.
 *     What actually adds the column to an existing install is boot
 *     schema-sync (AnalyticsTableManagement.createTables -> reconcileColumns),
 *     which issues the additive ADD COLUMN for every column a model declares.
 *     This migration is the record of the change in the migration history,
 *     and `migrate()` is what an operator can run by hand to make the table
 *     converge without a restart.
 *
 *  2. The data-migration runner HALTS THE ENTIRE CHAIN at the first failure,
 *     so a column the model does not (yet) declare, or a table that does not
 *     exist yet, is skipped with a warning rather than thrown over: a missing
 *     column costs the list its affected users, and freezing every later
 *     migration in the repo over that is the wrong trade.
 */
export default class AddUserIdToExceptionInstance extends DataMigrationBase {
  public constructor() {
    super("AddUserIdToExceptionInstance");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  public override async migrate(): Promise<void> {
    const model: ExceptionInstance = new ExceptionInstance();
    const storageTableName: string = getStorageTableName(model.tableName);

    /*
     * Boot and the migrate Job both create the analytics tables before data
     * migrations run, so a missing table will be created with the column
     * already in place. Skip rather than throw (see 2. above).
     */
    if (!(await ClickHouseMigrationUtil.tableExists(storageTableName))) {
      logger.info(
        `AddUserIdToExceptionInstance: ${storageTableName} does not exist; nothing to add.`,
      );
      return;
    }

    const column: AnalyticsTableColumn | undefined = model.tableColumns.find(
      (item: AnalyticsTableColumn) => {
        return item.key === EXCEPTION_INSTANCE_USER_ID_COLUMN_KEY;
      },
    );

    if (!column) {
      logger.warn(
        `AddUserIdToExceptionInstance: ${model.tableName} does not declare ${EXCEPTION_INSTANCE_USER_ID_COLUMN_KEY}; skipping (boot schema-sync adds it once the model declares it).`,
      );
      return;
    }

    try {
      if (
        await ExceptionInstanceService.doesColumnExist(
          EXCEPTION_INSTANCE_USER_ID_COLUMN_KEY,
        )
      ) {
        logger.info(
          `AddUserIdToExceptionInstance: ${model.tableName}.${EXCEPTION_INSTANCE_USER_ID_COLUMN_KEY} already present`,
        );
        return;
      }

      // Idempotent: ADD COLUMN IF NOT EXISTS.
      await ExceptionInstanceService.addColumnInDatabase(column);

      logger.info(
        `AddUserIdToExceptionInstance: added ${model.tableName}.${EXCEPTION_INSTANCE_USER_ID_COLUMN_KEY}`,
      );
    } catch (err) {
      logger.error(
        `AddUserIdToExceptionInstance: failed on ${model.tableName}.${EXCEPTION_INSTANCE_USER_ID_COLUMN_KEY}:`,
      );
      logger.error(err as Error);
      throw new Error(
        `AddUserIdToExceptionInstance: ${model.tableName}.${EXCEPTION_INSTANCE_USER_ID_COLUMN_KEY}: ${(err as Error).message}`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    /*
     * Deliberately a no-op. Dropping the column would discard who every
     * occurrence since happened to, to undo a metadata-only add, and a
     * re-run of migrate() is idempotent anyway.
     */
    return;
  }
}
