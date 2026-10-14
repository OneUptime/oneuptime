import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import {
  ClickhouseExecuteOptions,
  MigrationExecuteOptions,
} from "Common/Server/Services/AnalyticsDatabaseService";
import MetricService from "Common/Server/Services/MetricService";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import {
  getStorageTableName,
  onClusterClause,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import logger from "Common/Server/Utils/Logger";
import { ATTRIBUTE_VALUES_INDEX_NAME } from "Common/Types/AnalyticsDatabase/AttributeValueIndex";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";

type ModelType = { new (): AnalyticsBaseModel };

/*
 * The tables whose models declare idx_attribute_values (AttributeValueIndex
 * says why these two and no others).
 */
export const ATTRIBUTE_VALUES_INDEX_MODELS: Array<ModelType> = [Log, Span];

/*
 * Queue the mutation and return: it runs in ClickHouse's background pool,
 * beside the merges, at its own pace. Waiting for it here would hold the
 * upgrade for as long as it takes to read every row's attributes once.
 * (mutations_sync is 0 by default; set anyway, so a server profile that
 * raised it cannot turn the upgrade into that wait.)
 */
export const MaterializeInBackgroundOptions: ClickhouseExecuteOptions = {
  ...MigrationExecuteOptions,
  clickhouseSettings: {
    ...MigrationExecuteOptions.clickhouseSettings,
    mutations_sync: "0",
  },
};

/**
 * Builds idx_attribute_values - the bloom filter over every attribute value
 * of LogItemV3 and SpanItemV3 - for the rows an install already has, so a
 * search for an attribute value skips the granules that cannot hold it over
 * the whole retention, not only over the days written after the upgrade
 * (#4706).
 *
 * Boot schema-sync (AnalyticsTableManagement.reconcileSkipIndexes) adds the
 * index DEFINITION to an existing table: metadata only, nothing is read or
 * rewritten, and every part written from then on carries the index. The
 * parts already on disk do not, and the parts of a day that is over are
 * rarely merged again, so without this a search over the days before the
 * upgrade would read every row of them - and stop at the 45 s limit - until
 * they aged out.
 *
 * What it does, per table:
 *   1. ADD INDEX IF NOT EXISTS - the model's own definition. A no-op after
 *      boot schema-sync; here so a definition boot failed to add is not
 *      taken for done.
 *   2. MATERIALIZE INDEX - a mutation queued in the background
 *      (MaterializeInBackgroundOptions). It reads the `attributes` column of
 *      every part that has no index yet, once, and writes the index next to
 *      it; no other column is read or rewritten. Measured on ClickHouse 26.7:
 *      20 million log lines with ~2 KB of attributes each took 11 seconds on
 *      8 cores, the cost of one unindexed search over the same rows. A part
 *      that already has the index - written after the upgrade, or built by
 *      an earlier run - is not read again.
 *
 * Cluster-aware (`runsInClusterMode` left at true): the analytics schema is
 * always a cluster, and a migration that opted out would be baselined and
 * never reach an existing install. Both statements target the local storage
 * table, ON CLUSTER, so every shard indexes its own rows.
 *
 * Safe to run again: the definition is added only if missing, and a second
 * MATERIALIZE INDEX reads nothing.
 */
export default class MaterializeAttributeValuesIndex extends DataMigrationBase {
  public constructor() {
    super("MaterializeAttributeValuesIndex");
  }

  // The model's attributes column, which declares the index.
  public static getIndexedColumn(
    model: AnalyticsBaseModel,
  ): AnalyticsTableColumn | undefined {
    return model.tableColumns.find((column: AnalyticsTableColumn): boolean => {
      return column.skipIndex?.name === ATTRIBUTE_VALUES_INDEX_NAME;
    });
  }

  public static getAddIndexStatement(
    model: AnalyticsBaseModel,
    column: AnalyticsTableColumn,
  ): string {
    return `ALTER TABLE ${getStorageTableName(model.tableName)}${onClusterClause()} ADD INDEX IF NOT EXISTS ${StatementGenerator.toSkipIndexDefinition(column)}`;
  }

  public static getMaterializeStatement(model: AnalyticsBaseModel): string {
    return `ALTER TABLE ${getStorageTableName(model.tableName)}${onClusterClause()} MATERIALIZE INDEX ${ATTRIBUTE_VALUES_INDEX_NAME}`;
  }

  public override async migrate(): Promise<void> {
    const failures: Array<string> = [];

    for (const modelType of ATTRIBUTE_VALUES_INDEX_MODELS) {
      const model: AnalyticsBaseModel = new modelType();
      const storageTable: string = getStorageTableName(model.tableName);
      const column: AnalyticsTableColumn | undefined =
        MaterializeAttributeValuesIndex.getIndexedColumn(model);

      if (!column) {
        /*
         * Every model listed declares it (a test holds them to it); if one
         * ever stops, there is nothing to build for it.
         */
        logger.warn(
          `MaterializeAttributeValuesIndex: ${model.tableName} does not declare ${ATTRIBUTE_VALUES_INDEX_NAME}; skipping.`,
        );
        continue;
      }

      try {
        /*
         * Boot and the migrate Job both create the analytics tables before
         * data migrations run, from models that already declare the index,
         * so a table that does not exist has nothing to build.
         */
        if (!(await ClickHouseMigrationUtil.tableExists(storageTable))) {
          logger.info(
            `MaterializeAttributeValuesIndex: ${storageTable} does not exist; nothing to build.`,
          );
          continue;
        }

        await MetricService.execute(
          MaterializeAttributeValuesIndex.getAddIndexStatement(model, column),
          MigrationExecuteOptions,
        );

        await MetricService.execute(
          MaterializeAttributeValuesIndex.getMaterializeStatement(model),
          MaterializeInBackgroundOptions,
        );

        logger.info(
          `MaterializeAttributeValuesIndex: queued the build of ${ATTRIBUTE_VALUES_INDEX_NAME} on ${storageTable}; it runs in the background (system.mutations).`,
        );
      } catch (err) {
        logger.error(
          `MaterializeAttributeValuesIndex: failed on ${storageTable}:`,
        );
        logger.error(err as Error);

        failures.push(
          `${storageTable}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    /*
     * Every table is tried before failing, and then the migration does fail
     * rather than be recorded as done with a table left without the index on
     * its older rows. The runner halts the chain here and the next run
     * retries it; a table already queued is queued again at no cost.
     */
    if (failures.length > 0) {
      throw new Error(
        `MaterializeAttributeValuesIndex: could not build ${ATTRIBUTE_VALUES_INDEX_NAME} on ${failures.join("; ")}`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    /*
     * Deliberately a no-op. Dropping the index would only bring back the
     * searches that read every row, and a re-run of migrate() is idempotent
     * anyway.
     */
    return;
  }
}
