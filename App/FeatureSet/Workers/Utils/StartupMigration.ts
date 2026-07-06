import StartupMigrations from "../StartupMigrations/Index";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import logger from "Common/Server/Utils/Logger";
import PostgresDatabase, {
  DatabaseQueryRunner,
  DatabaseSource,
} from "Common/Server/Infrastructure/PostgresDatabase";

/*
 * Advisory-lock label for the startup-migration runner. Startup migrations
 * run on EVERY boot — unlike data migrations they are not tracked in the
 * DataMigration table — so the lock only serializes concurrent boots
 * (several replicas starting at once); it never skips work.
 */
const STARTUP_MIGRATION_LOCK_LABEL: string =
  "oneuptime:startup-migration-runner";

const RunStartupMigrations: PromiseVoidFunction = async (): Promise<void> => {
  const dataSource: DatabaseSource | null = PostgresDatabase.getDataSource();

  if (!dataSource) {
    logger.error(
      "Skipping startup migrations: Postgres DataSource is not connected.",
    );
    return;
  }

  const queryRunner: DatabaseQueryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();

  try {
    /*
     * Serialize concurrent boots with a TRANSACTION-scoped advisory lock held
     * on this pinned connection. Unlike the data-migration runner (which is
     * gated off PgBouncer-pooled connections and can use a session-level
     * lock), this runner ALSO runs on runtime pods that may connect through
     * PgBouncer in transaction pool mode — where a session-level
     * pg_advisory_lock leaks: the unlock can be routed to a different pooled
     * backend. An explicit transaction pins the client to a single backend
     * even through transaction pooling, and pg_advisory_xact_lock releases
     * automatically on commit/rollback/disconnect, so it can never leak. The
     * migrations' own queries run on other pooled connections; only this
     * small lock-holder transaction stays pinned while the loop runs.
     */
    await queryRunner.startTransaction();
    await queryRunner.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      STARTUP_MIGRATION_LOCK_LABEL,
    ]);

    for (const migration of StartupMigrations) {
      try {
        logger.debug("Running Startup Migration: " + migration.name, {
          service: "workers",
        });

        await migration.migrate();

        logger.debug("Startup Migration Complete: " + migration.name, {
          service: "workers",
        });
      } catch (err) {
        /*
         * Startup migrations sync env-driven state; a failure must never
         * crash the pod or block boot, so log and continue with the next one.
         */
        logger.error("Startup Migration Failed: " + migration.name, {
          service: "workers",
        });
        logger.error(err, { service: "workers" });
      }
    }
  } finally {
    /*
     * Committing (or rolling back) ends the transaction and releases the
     * xact-scoped advisory lock; releasing the runner alone would also drop
     * it, but end the transaction explicitly so the connection is returned
     * to the pool clean.
     */
    try {
      if (queryRunner.isTransactionActive) {
        await queryRunner.commitTransaction();
      }
    } catch (err) {
      logger.error("Failed to end the startup-migration lock transaction");
      logger.error(err, { service: "workers" });
      try {
        await queryRunner.rollbackTransaction();
      } catch (rollbackErr) {
        logger.error(rollbackErr, { service: "workers" });
      }
    }

    await queryRunner.release();
  }
};

export default RunStartupMigrations;
