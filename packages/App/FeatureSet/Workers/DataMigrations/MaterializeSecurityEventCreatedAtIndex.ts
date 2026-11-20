import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import { MaterializeInBackgroundOptions } from "./MaterializeAttributeValuesIndex";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import SecurityEvent, {
  SECURITY_EVENT_CREATED_AT_INDEX_NAME,
} from "Common/Models/AnalyticsModels/SecurityEvent";
import { MigrationExecuteOptions } from "Common/Server/Services/AnalyticsDatabaseService";
import MetricService from "Common/Server/Services/MetricService";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import {
  getStorageTableName,
  onClusterClause,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import logger from "Common/Server/Utils/Logger";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";

/**
 * Builds idx_created_at - the minmax index on when each security event
 * arrived (SecurityEvent.createdAt) - for the rows an install already has.
 *
 * Scheduled detection rules judge the events that arrived since their last
 * run, whenever they happened (#10337), and the table is sorted by when
 * events happened, so a run reads the last day of a project's events by
 * that sort and the index skips every granule whose rows all arrived
 * outside the run. Boot schema-sync (AnalyticsTableManagement
 * .reconcileSkipIndexes) adds the index DEFINITION: metadata only, and
 * every part written from then on carries it. The parts already on disk do
 * not, so for the day after an upgrade every run would read every row of
 * them for the few that arrived since its last - this builds the index for
 * them instead.
 *
 * What it does:
 *   1. ADD INDEX IF NOT EXISTS - the model's own definition. A no-op after
 *      boot schema-sync; here so a definition boot failed to add is not
 *      taken for done.
 *   2. MATERIALIZE INDEX - a mutation queued in the background
 *      (MaterializeInBackgroundOptions). It reads the 4-byte createdAt
 *      column of every part that has no index yet, once, and writes the
 *      index beside it; nothing else is read or rewritten.
 *
 * Cluster-aware (`runsInClusterMode` left at true): the analytics schema is
 * always a cluster, and a migration that opted out would be baselined and
 * never reach an existing install. Both statements target the local storage
 * table, ON CLUSTER, so every shard indexes its own rows.
 *
 * Safe to run again: the definition is added only if missing, and a second
 * MATERIALIZE INDEX reads nothing.
 */
export default class MaterializeSecurityEventCreatedAtIndex extends DataMigrationBase {
  public constructor() {
    super("MaterializeSecurityEventCreatedAtIndex");
  }

  // The model's createdAt column, which declares the index.
  public static getIndexedColumn(
    model: AnalyticsBaseModel,
  ): AnalyticsTableColumn | undefined {
    return model.tableColumns.find((column: AnalyticsTableColumn): boolean => {
      return column.skipIndex?.name === SECURITY_EVENT_CREATED_AT_INDEX_NAME;
    });
  }

  public static getAddIndexStatement(
    model: AnalyticsBaseModel,
    column: AnalyticsTableColumn,
  ): string {
    return `ALTER TABLE ${getStorageTableName(model.tableName)}${onClusterClause()} ADD INDEX IF NOT EXISTS ${StatementGenerator.toSkipIndexDefinition(column)}`;
  }

  public static getMaterializeStatement(model: AnalyticsBaseModel): string {
    return `ALTER TABLE ${getStorageTableName(model.tableName)}${onClusterClause()} MATERIALIZE INDEX ${SECURITY_EVENT_CREATED_AT_INDEX_NAME}`;
  }

  public override async migrate(): Promise<void> {
    const model: SecurityEvent = new SecurityEvent();
    const storageTable: string = getStorageTableName(model.tableName);
    const column: AnalyticsTableColumn | undefined =
      MaterializeSecurityEventCreatedAtIndex.getIndexedColumn(model);

    if (!column) {
      // The model declares it (a test holds it to it); if it ever stops, there is nothing to build.
      logger.warn(
        `MaterializeSecurityEventCreatedAtIndex: ${model.tableName} does not declare ${SECURITY_EVENT_CREATED_AT_INDEX_NAME}; skipping.`,
      );
      return;
    }

    /*
     * Boot and the migrate Job both create the analytics tables before data
     * migrations run, from a model that already declares the index, so a
     * table that does not exist has nothing to build.
     */
    if (!(await ClickHouseMigrationUtil.tableExists(storageTable))) {
      logger.info(
        `MaterializeSecurityEventCreatedAtIndex: ${storageTable} does not exist; nothing to build.`,
      );
      return;
    }

    try {
      await MetricService.execute(
        MaterializeSecurityEventCreatedAtIndex.getAddIndexStatement(
          model,
          column,
        ),
        MigrationExecuteOptions,
      );

      await MetricService.execute(
        MaterializeSecurityEventCreatedAtIndex.getMaterializeStatement(model),
        MaterializeInBackgroundOptions,
      );
    } catch (err) {
      logger.error(
        `MaterializeSecurityEventCreatedAtIndex: failed on ${storageTable}:`,
      );
      logger.error(err as Error);

      /*
       * Failing rather than being recorded as done with the older rows left
       * without the index: the runner halts the chain here and the next run
       * retries it, and a table already queued is queued again at no cost.
       */
      throw new Error(
        `MaterializeSecurityEventCreatedAtIndex: could not build ${SECURITY_EVENT_CREATED_AT_INDEX_NAME} on ${storageTable}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    logger.info(
      `MaterializeSecurityEventCreatedAtIndex: queued the build of ${SECURITY_EVENT_CREATED_AT_INDEX_NAME} on ${storageTable}; it runs in the background (system.mutations).`,
    );
  }

  public override async rollback(): Promise<void> {
    /*
     * Deliberately a no-op. Dropping the index would only bring back the
     * runs that read a day of rows for the few that arrived, and a re-run of
     * migrate() is idempotent anyway.
     */
    return;
  }
}
