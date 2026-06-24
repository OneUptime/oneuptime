import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import Redis from "Common/Server/Infrastructure/Redis";
import {
  ClickhouseAppInstance,
  ClickhouseIngestInstance,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import RunDatabaseMigrations from "./FeatureSet/Workers/Utils/DataMigration";
import AnalyticsTableManagement from "./FeatureSet/Workers/Utils/AnalyticsDatabase/TableManegement";
import logger from "Common/Server/Utils/Logger";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";

/*
 * One-shot migration runner. Runs the SAME schema + data migrations the app
 * normally runs on boot, but as a single dedicated process (a Helm
 * pre-upgrade / post-install Job) instead of on every replica. This is what
 * lets the runtime pods be gated off (RUN_DATABASE_MIGRATIONS_ON_BOOT=false)
 * so the data-migration session advisory lock never runs on a pooled
 * connection — making PgBouncer transaction-mode pooling safe.
 *
 * Connect to the backend DIRECTLY (the chart points this Job at the real
 * database, bypassing PgBouncer) so migrations never depend on the pooler.
 */

const APP_NAME: string = "migrate";

const migrate: PromiseVoidFunction = async (): Promise<void> => {
  logger.debug(
    `${APP_NAME}: connecting to Postgres (applies schema migrations)`,
  );
  /*
   * migrationsRun on this DataSource applies all pending TypeORM schema
   * migrations during initialize(). RUN_DATABASE_MIGRATIONS_ON_BOOT is left
   * unset (true) for this process, so schema migrations run here.
   */
  await PostgresAppInstance.connect();

  /*
   * Data migrations write through the Service layer, which emits realtime
   * events (Redis) and reads/writes ClickHouse — connect the same datastores a
   * normal app boot would, so migrations behave identically.
   */
  await Redis.connect();
  await ClickhouseAppInstance.connect(
    ClickhouseAppInstance.getDatasourceOptions(),
  );
  await ClickhouseIngestInstance.connect(
    ClickhouseIngestInstance.getDatasourceOptions(),
  );

  /*
   * Ensure the ClickHouse analytics tables + materialized views exist BEFORE
   * running data migrations — mirrors the worker boot order (Workers/Index.ts).
   * Several data migrations ALTER ClickHouse tables and would throw
   * UNKNOWN_TABLE on a fresh ClickHouse if the tables aren't created first.
   * Both are idempotent (CREATE ... IF NOT EXISTS), so this is safe on upgrades.
   */
  logger.debug(`${APP_NAME}: ensuring ClickHouse tables + materialized views`);
  await AnalyticsTableManagement.createTables();
  await AnalyticsTableManagement.createMaterializedViews();

  logger.debug(`${APP_NAME}: running data migrations`);
  await RunDatabaseMigrations();

  logger.debug(`${APP_NAME}: migrations complete`);
};

migrate()
  .then(() => {
    return process.exit(0);
  })
  .catch((err: Error) => {
    logger.error("Migrate failed:");
    logger.error(err);
    return process.exit(1);
  });
