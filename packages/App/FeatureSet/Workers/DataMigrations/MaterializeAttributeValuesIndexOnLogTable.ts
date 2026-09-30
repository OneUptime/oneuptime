import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import Log from "Common/Models/AnalyticsModels/Log";
import { MigrationExecuteOptions } from "Common/Server/Services/AnalyticsDatabaseService";
import LogService from "Common/Server/Services/LogService";
import {
  getStorageTableName,
  onClusterClause,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import logger from "Common/Server/Utils/Logger";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";

export const ATTRIBUTE_VALUES_INDEX_NAME: string = "idx_attribute_values";

/**
 * Builds idx_attribute_values — the bloom filter over log attribute values
 * declared on Log.attributes — for the log parts written before the index
 * existed.
 *
 * Boot schema-sync adds the index definition
 * (AnalyticsTableManagement.reconcileSkipIndexes), but a definition only
 * covers parts written or merged after it. Every older part is still read in
 * full by an attribute filter, which is the slow path the index exists to
 * remove: a search filtered on attributes over more than a few hours hits
 * max_execution_time. MATERIALIZE INDEX builds the index files for those
 * parts in a background mutation (mutations_sync = 0). On a large log table
 * that takes a while; searches get faster as it proceeds. Progress shows in
 * system.mutations.
 *
 * Best-effort: the index only changes how fast a search is, never what it
 * returns, so a failure is logged with the statement to run by hand and
 * migrate() never throws — the runner would halt the whole migration chain,
 * and the deploy, over a speed-up.
 *
 * Runs in cluster mode (does not override runsInClusterMode) and targets the
 * local storage table ON CLUSTER, so every shard indexes its own parts.
 * Idempotent: ADD INDEX IF NOT EXISTS, and materializing an index that is
 * already built is a cheap no-op mutation.
 */
export default class MaterializeAttributeValuesIndexOnLogTable extends DataMigrationBase {
  public constructor() {
    super("MaterializeAttributeValuesIndexOnLogTable");
  }

  public static getMaterializeStatement(tableName: string): string {
    return `ALTER TABLE ${getStorageTableName(tableName)}${onClusterClause()} MATERIALIZE INDEX ${ATTRIBUTE_VALUES_INDEX_NAME} SETTINGS mutations_sync = 0`;
  }

  public override async migrate(): Promise<void> {
    const model: Log = new Log();
    const storageTableName: string = getStorageTableName(model.tableName);
    const materializeStatement: string =
      MaterializeAttributeValuesIndexOnLogTable.getMaterializeStatement(
        model.tableName,
      );

    const column: AnalyticsTableColumn | undefined = model.tableColumns.find(
      (item: AnalyticsTableColumn) => {
        return item.skipIndex?.name === ATTRIBUTE_VALUES_INDEX_NAME;
      },
    );

    if (!column) {
      // Only possible if the index is later removed from the model.
      logger.warn(
        `MaterializeAttributeValuesIndexOnLogTable: ${model.tableName} does not declare ${ATTRIBUTE_VALUES_INDEX_NAME}; nothing to materialize.`,
      );
      return;
    }

    try {
      /*
       * Boot and the migrate Job create the analytics tables before data
       * migrations run, so a missing table has no old parts to index.
       */
      if (!(await ClickHouseMigrationUtil.tableExists(storageTableName))) {
        logger.info(
          `MaterializeAttributeValuesIndexOnLogTable: ${storageTableName} does not exist; nothing to materialize.`,
        );
        return;
      }

      /*
       * Schema-sync has normally added the index already. Re-adding it covers
       * a boot where that ADD failed, which would otherwise fail MATERIALIZE
       * with an unknown index.
       */
      const addIndexStatement: Statement | null =
        LogService.statementGenerator.toAddSkipIndexStatement(column);

      if (addIndexStatement) {
        await LogService.execute(addIndexStatement, MigrationExecuteOptions);
      }

      await LogService.execute(materializeStatement, MigrationExecuteOptions);

      logger.info(
        `MaterializeAttributeValuesIndexOnLogTable: queued the build of ${ATTRIBUTE_VALUES_INDEX_NAME} on ${storageTableName}; follow it in system.mutations.`,
      );
    } catch (err) {
      logger.error(
        `MaterializeAttributeValuesIndexOnLogTable: could not queue the build of ${ATTRIBUTE_VALUES_INDEX_NAME}. Log parts written from now on are indexed; to index older parts run: ${materializeStatement}`,
      );
      logger.error(err as Error);
    }
  }

  public override async rollback(): Promise<void> {
    /*
     * No-op: the index belongs to the Log model, and boot schema-sync would
     * add it straight back.
     */
    return;
  }
}
