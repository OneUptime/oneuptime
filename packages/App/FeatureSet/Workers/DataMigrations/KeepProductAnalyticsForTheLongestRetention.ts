import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import { MaterializeInBackgroundOptions } from "./MaterializeAttributeValuesIndex";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import RumProductAnalyticsEvent from "Common/Models/AnalyticsModels/RumProductAnalyticsEvent";
import RumProductAnalyticsSession from "Common/Models/AnalyticsModels/RumProductAnalyticsSession";
import RumProductAnalyticsUser from "Common/Models/AnalyticsModels/RumProductAnalyticsUser";
import { MigrationExecuteOptions } from "Common/Server/Services/AnalyticsDatabaseService";
import MetricService from "Common/Server/Services/MetricService";
import {
  getStorageTableName,
  onClusterClause,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import logger from "Common/Server/Utils/Logger";

type ModelType = { new (): AnalyticsBaseModel };

/* The product analytics tables, as models: each gets the TTL its model declares. */
export const PRODUCT_ANALYTICS_RETENTION_MODELS: Array<ModelType> = [
  RumProductAnalyticsSession,
  RumProductAnalyticsUser,
  RumProductAnalyticsEvent,
];

/*
 * Issue #6626: each RUM application chooses how long product analytics keeps
 * its numbers - 3, 6, 13 or 25 months. The three tables kept 13 months for
 * everyone, each row dropped with its whole monthly part. They now keep the
 * longest choice, 25 months, and Rum:EnforceProductAnalyticsRetention
 * deletes an application's older rows every day, the default 13 months
 * included. The models declare the new TTL, but boot schema-sync never
 * changes the TTL of a table that exists, so an install that already has
 * the tables only gets it from here.
 *
 * A part keeps the expiry it was written with until something recalculates
 * it, and a ttl_only_drop_parts table drops a part by that stored expiry -
 * so a TTL raised without one would still drop every part written before
 * the upgrade at 13 months, the months an application that chose 25 wanted
 * kept among them. Per table, on every node:
 *
 *   1. MODIFY SETTING materialize_ttl_recalculate_only = 1, which the
 *      models now declare: a MATERIALIZE TTL then only recalculates each
 *      part's expiry from the one column the TTL names, and rewrites
 *      nothing else.
 *   2. MODIFY TTL to the model's, which queues that MATERIALIZE TTL in the
 *      background (MaterializeInBackgroundOptions) rather than holding the
 *      upgrade while it reads the parts.
 *
 * Nothing is deleted by either step: a TTL that grows only keeps more.
 * Cluster-aware (`runsInClusterMode` left at true): the analytics schema is
 * always a cluster, and a migration that opted out would be baselined and
 * never reach an existing install. It alters the local storage table, ON
 * CLUSTER so every shard does.
 *
 * Safe to run again: the same setting and the same TTL change nothing but
 * one more recalculation, which reads the one column again.
 */
export default class KeepProductAnalyticsForTheLongestRetention extends DataMigrationBase {
  public constructor() {
    super("KeepProductAnalyticsForTheLongestRetention");
  }

  public static getStatements(model: AnalyticsBaseModel): {
    setting: string;
    ttl: string;
  } {
    const storageTable: string = getStorageTableName(model.tableName);

    return {
      setting: `ALTER TABLE ${storageTable}${onClusterClause()} MODIFY SETTING materialize_ttl_recalculate_only = 1`,
      ttl: `ALTER TABLE ${storageTable}${onClusterClause()} MODIFY TTL ${model.ttlExpression}`,
    };
  }

  public override async migrate(): Promise<void> {
    const failures: Array<string> = [];

    for (const modelType of PRODUCT_ANALYTICS_RETENTION_MODELS) {
      const model: AnalyticsBaseModel = new modelType();
      const storageTable: string = getStorageTableName(model.tableName);

      try {
        /*
         * Boot and the migrate Job create the analytics tables before data
         * migrations run, from models that already declare the new TTL, so
         * a table that does not exist has nothing to change.
         */
        if (!(await ClickHouseMigrationUtil.tableExists(storageTable))) {
          logger.info(
            `KeepProductAnalyticsForTheLongestRetention: ${storageTable} does not exist; nothing to change.`,
          );
          continue;
        }

        const statements: { setting: string; ttl: string } =
          KeepProductAnalyticsForTheLongestRetention.getStatements(model);

        // The setting first, so the recalculation the TTL queues reads it.
        await MetricService.execute(
          statements.setting,
          MigrationExecuteOptions,
        );
        await MetricService.execute(
          statements.ttl,
          MaterializeInBackgroundOptions,
        );

        logger.info(
          `KeepProductAnalyticsForTheLongestRetention: ${storageTable} now keeps the longest retention; its parts' expiry is recalculated in the background.`,
        );
      } catch (err) {
        logger.error(
          `KeepProductAnalyticsForTheLongestRetention: failed on ${storageTable}:`,
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
        `KeepProductAnalyticsForTheLongestRetention: could not raise the TTL of ${failures.join("; ")}`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    /*
     * Deliberately a no-op: the old TTL would drop months an application
     * chose to keep, and a re-run of migrate() is idempotent anyway.
     */
    return;
  }
}
