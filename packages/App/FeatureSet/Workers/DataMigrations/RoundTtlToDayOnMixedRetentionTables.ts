import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "Common/Models/AnalyticsModels/Log";
import Metric from "Common/Models/AnalyticsModels/Metric";
import MetricItemAggMV1m from "Common/Models/AnalyticsModels/MetricItemAggMV1m";
import {
  ClickhouseExecuteOptions,
  MigrationExecuteOptions,
} from "Common/Server/Services/AnalyticsDatabaseService";
import MetricService from "Common/Server/Services/MetricService";
import {
  getStorageTableName,
  onClusterClause,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import logger from "Common/Server/Utils/Logger";

type ModelType = { new (): AnalyticsBaseModel };

/*
 * The tables whose TTL this rounds, as models: the TTL each one gets is the
 * one its model declares, so a repaired install ends up like a fresh one.
 */
export const DAY_ROUNDED_TTL_MODELS: Array<ModelType> = [
  Metric,
  MetricItemAggMV1m,
  Log,
];

/*
 * MODIFY TTL materializes the new TTL by default: a MATERIALIZE TTL mutation
 * that rewrites every part of the table, right away. Here that would be the
 * whole of the metric and log tables, so it is switched off. A part keeps the
 * TTL bounds it was written with until its next TTL merge, which applies the
 * new expression and stores the new bounds - the setting travels with the
 * ON CLUSTER task, so every host alters its tables this way.
 *
 * (`materialize_ttl_recalculate_only = 1` would make that mutation read only
 * the columns the TTL uses, and spare each old partition its one later
 * rewrite. It is not used: it takes a per-replica table setting and a
 * mutation across every part, to save a rewrite the old TTL would have
 * repeated six or seven times.)
 */
export const ModifyTtlWithoutRewriteOptions: ClickhouseExecuteOptions = {
  ...MigrationExecuteOptions,
  clickhouseSettings: {
    ...MigrationExecuteOptions.clickhouseSettings,
    materialize_ttl_after_modify: 0,
  },
};

/**
 * Rounds the TTL of the telemetry tables whose partitions mix retentions -
 * MetricItemV3, MetricItemAggMV1m and LogItemV3 - up to the midnight after
 * each row's retentionDate (RetentionTtl has the expressions and the why).
 *
 * DropTtlOnlyDropPartsFromMixedRetentionTables made these tables expire rows
 * one at a time instead of a whole part at a time. With `retentionDate
 * DELETE` that rewrites a daily partition six or seven times per retention
 * it holds, every merge_with_ttl_timeout while its rows expire; rounded, the
 * rows of one retention expire together and a partition's last ones go as
 * a part drop. Models declare the new TTL, but boot schema-sync never
 * changes the TTL of a table that exists, so an existing install only gets
 * it from here.
 *
 * Nothing is rewritten when it runs (ModifyTtlWithoutRewriteOptions). The
 * parts already written keep the TTL bounds they were written with, and
 * each one is rewritten once when the earliest of its rows reaches its
 * retentionDate, under the new expression - which usually removes nothing
 * yet and only stores the new bounds. A partition that held data before
 * the change is rewritten once for it, instead of six or seven times per
 * retention under the old TTL. Parts written afterwards have the new TTL
 * from the start.
 *
 * Cluster-aware (`runsInClusterMode` left at true): the analytics schema is
 * always a cluster, and a migration that opted out would be baselined and
 * never reach an existing install. It alters the local storage table, ON
 * CLUSTER so every shard does.
 *
 * Safe to run again: the same TTL again changes nothing, and no mutation
 * is queued either way.
 */
export default class RoundTtlToDayOnMixedRetentionTables extends DataMigrationBase {
  public constructor() {
    super("RoundTtlToDayOnMixedRetentionTables");
  }

  public static getStatement(model: AnalyticsBaseModel): string {
    return `ALTER TABLE ${getStorageTableName(model.tableName)}${onClusterClause()} MODIFY TTL ${model.ttlExpression}`;
  }

  public override async migrate(): Promise<void> {
    const failures: Array<string> = [];

    for (const modelType of DAY_ROUNDED_TTL_MODELS) {
      const model: AnalyticsBaseModel = new modelType();
      const storageTable: string = getStorageTableName(model.tableName);

      try {
        /*
         * Boot and the migrate Job both create the analytics tables before
         * data migrations run, from models that already declare the rounded
         * TTL, so a table that does not exist has nothing to change.
         */
        if (!(await ClickHouseMigrationUtil.tableExists(storageTable))) {
          logger.info(
            `RoundTtlToDayOnMixedRetentionTables: ${storageTable} does not exist; nothing to change.`,
          );
          continue;
        }

        await MetricService.execute(
          RoundTtlToDayOnMixedRetentionTables.getStatement(model),
          ModifyTtlWithoutRewriteOptions,
        );

        logger.info(
          `RoundTtlToDayOnMixedRetentionTables: rounded the TTL of ${storageTable} up to the day`,
        );
      } catch (err) {
        logger.error(
          `RoundTtlToDayOnMixedRetentionTables: failed on ${storageTable}:`,
        );
        logger.error(err as Error);

        failures.push(
          `${storageTable}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    /*
     * Every table is tried before failing, and then the migration does fail
     * rather than be recorded as done with a table left on the old TTL. The
     * runner halts the chain here and the next run retries it; tables that
     * were changed are simply changed again.
     */
    if (failures.length > 0) {
      throw new Error(
        `RoundTtlToDayOnMixedRetentionTables: could not round the TTL of ${failures.join("; ")}`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    /*
     * Deliberately a no-op. Going back would only bring the rewrites back -
     * the old TTL deletes the same rows, just sooner - and a re-run of
     * migrate() is idempotent anyway.
     */
    return;
  }
}
