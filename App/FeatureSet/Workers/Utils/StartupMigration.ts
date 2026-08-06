import StartupMigrations from "../StartupMigrations/Index";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import logger from "Common/Server/Utils/Logger";
import PostgresDatabase, {
  DatabaseSource,
} from "Common/Server/Infrastructure/PostgresDatabase";

/*
 * THIS RUNNER IS NOT SERIALIZED ACROSS PROCESSES.
 *
 * It used to hold a transaction-scoped Postgres advisory lock
 * (`oneuptime:startup-migration-runner`) for the whole loop. That lock is gone.
 *
 * Note this runner is NOT the one the migrate Job owns: startup migrations are
 * deliberately not gated on RUN_DATABASE_MIGRATIONS_ON_BOOT (see
 * Workers/Index.ts), because pods that skip data migrations must still apply
 * env-driven state on boot. So every worker replica runs this on every boot,
 * and a rolling deploy runs it on N replicas at once.
 *
 * That is tolerable only because of what startup migrations ARE: declarative
 * syncs of env-driven state (the GLOBAL_LLM_PROVIDER_* seeded provider and
 * friends), which already run on every boot and are expected to be repeated.
 *
 * So: WRITE STARTUP MIGRATIONS THAT ARE SAFE TO RUN CONCURRENTLY WITH
 * THEMSELVES. Converging on the same value from several replicas is fine;
 * read-modify-write, allocating identifiers, or appending is not.
 */
const RunStartupMigrations: PromiseVoidFunction = async (): Promise<void> => {
  /*
   * Startup migrations write to Postgres. Bail out cleanly when it is not
   * connected rather than letting every migration in the list fail one by one
   * and bury the actual cause under N stack traces.
   */
  const dataSource: DatabaseSource | null = PostgresDatabase.getDataSource();

  if (!dataSource) {
    logger.error(
      "Skipping startup migrations: Postgres DataSource is not connected.",
    );
    return;
  }

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
};

export default RunStartupMigrations;
