import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import SecurityEventService from "Common/Server/Services/SecurityEventService";
import { getStorageTableName } from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import logger from "Common/Server/Utils/Logger";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";

/*
 * The columns to add: the process an event is about and its parent, which
 * Sigma's Image, CommandLine, ParentImage and ParentCommandLine read. All
 * six are declared on the SecurityEvent model as non-Nullable String with a
 * '' default, so every row written before this migration reads "the source
 * did not say" - which is what those rows were stored knowing.
 */
export const SECURITY_EVENT_PROCESS_COLUMN_KEYS: Array<string> = [
  "processName",
  "processPath",
  "processCommandLine",
  "parentProcessName",
  "parentProcessPath",
  "parentProcessCommandLine",
];

/**
 * Adds the process columns to the security events table:
 *
 *   SecurityEvent: processName              String DEFAULT ''
 *                  processPath              String DEFAULT ''
 *                  processCommandLine       String DEFAULT ''
 *                  parentProcessName        String DEFAULT ''
 *                  parentProcessPath        String DEFAULT ''
 *                  parentProcessCommandLine String DEFAULT ''
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
 *     column costs the endpoint rules their command lines until boot adds it,
 *     and freezing every later migration in the repo over that is the wrong
 *     trade.
 */
export default class AddProcessColumnsToSecurityEvent extends DataMigrationBase {
  public constructor() {
    super("AddProcessColumnsToSecurityEvent");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  public override async migrate(): Promise<void> {
    const model: SecurityEvent = new SecurityEvent();
    const storageTableName: string = getStorageTableName(model.tableName);

    /*
     * Boot and the migrate Job both create the analytics tables before data
     * migrations run, so a missing table will be created with these columns
     * already in place. Skip rather than throw (see 2. above).
     */
    if (!(await ClickHouseMigrationUtil.tableExists(storageTableName))) {
      logger.info(
        `AddProcessColumnsToSecurityEvent: ${storageTableName} does not exist; nothing to add.`,
      );
      return;
    }

    for (const key of SECURITY_EVENT_PROCESS_COLUMN_KEYS) {
      const column: AnalyticsTableColumn | undefined = model.tableColumns.find(
        (item: AnalyticsTableColumn) => {
          return item.key === key;
        },
      );

      if (!column) {
        logger.warn(
          `AddProcessColumnsToSecurityEvent: ${model.tableName} does not declare ${key}; skipping (boot schema-sync adds it once the model declares it).`,
        );
        continue;
      }

      try {
        if (await SecurityEventService.doesColumnExist(key)) {
          logger.info(
            `AddProcessColumnsToSecurityEvent: ${model.tableName}.${key} already present`,
          );
          continue;
        }

        // Idempotent: ADD COLUMN IF NOT EXISTS.
        await SecurityEventService.addColumnInDatabase(column);

        logger.info(
          `AddProcessColumnsToSecurityEvent: added ${model.tableName}.${key}`,
        );
      } catch (err) {
        logger.error(
          `AddProcessColumnsToSecurityEvent: failed on ${model.tableName}.${key}:`,
        );
        logger.error(err as Error);
        throw new Error(
          `AddProcessColumnsToSecurityEvent: ${model.tableName}.${key}: ${(err as Error).message}`,
        );
      }
    }
  }

  public override async rollback(): Promise<void> {
    /*
     * Deliberately a no-op. Dropping the columns would discard the process of
     * every event stored since, to undo a metadata-only add, and a re-run of
     * migrate() is idempotent anyway.
     */
    return;
  }
}
