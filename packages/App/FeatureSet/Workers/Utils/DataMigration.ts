import DataMigrations from "../DataMigrations/Index";
import OneUptimeDate from "Common/Types/Date";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import DataMigrationService from "Common/Server/Services/DataMigrationService";
import {
  MigrationFailureType,
  recordMigrationFailure,
} from "Common/Server/Utils/Database/MigrationFailureLog";
import logger from "Common/Server/Utils/Logger";
import DataMigration from "Common/Models/DatabaseModels/DataMigration";
import PostgresDatabase, {
  DatabaseSource,
} from "Common/Server/Infrastructure/PostgresDatabase";

/*
 * THIS RUNNER IS NOT SERIALIZED ACROSS PROCESSES.
 *
 * It used to hold a session-level Postgres advisory lock
 * (`oneuptime:data-migration-runner`) for the whole loop. That lock is gone:
 * under the default Helm deployment a single migrate Job (`migrate.enabled`,
 * on by default) owns migrations and the runtime pods are gated off with
 * RUN_DATABASE_MIGRATIONS_ON_BOOT=false, and one runner needs no mutex.
 *
 * The configurations that do start several runners at once are therefore
 * unserialized, and two of them can both read a migration as "not executed"
 * and both call migrate():
 *
 *   - docker-compose, where RUN_DATABASE_MIGRATIONS_ON_BOOT is left at its
 *     default of true and both the app and worker containers call this on boot.
 *   - `migrate.enabled: false` (the legacy boot-migration path), where every
 *     replica of every deployment calls this on boot.
 *
 * So: WRITE MIGRATIONS THAT ARE SAFE TO RUN TWICE CONCURRENTLY. A migration
 * that assumes it is the only one running is a bug in the migration — this
 * runner will not catch it for you any more.
 */
const RunDatabaseMigrations: PromiseVoidFunction = async (): Promise<void> => {
  const dataSource: DatabaseSource | null = PostgresDatabase.getDataSource();

  if (!dataSource) {
    logger.error(
      "Skipping data migrations: Postgres DataSource is not connected.",
    );
    return;
  }

  /*
   * Records the first migration that threw. The runner deliberately stops
   * the chain at the first failure (see the `break` below), but it must
   * also SURFACE that failure to its callers: the dedicated migrate Job
   * (App/Migrate.ts) awaits this function and exits non-zero only if it
   * rejects. Without re-throwing, a failed data migration was swallowed
   * here, the Job exited 0, and the broken/blocked schema looked like a
   * successful deploy. We re-throw after the loop rather than from inside it
   * so the chain always stops cleanly at the first failure.
   */
  let firstFailure: { name: string; error: unknown } | null = null;

  for (const migration of DataMigrations) {
    try {
      // check if this migration has already been run
      const existingMigration: DataMigration | null =
        await DataMigrationService.findOneBy({
          query: {
            name: migration.name,
            executed: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (existingMigration) {
        logger.debug("Skipping Database Migration:" + migration.name, {
          service: "workers",
        });
        continue;
      }

      /*
       * Baseline legacy ClickHouse schema migrations: the analytics schema is
       * always a cluster (Distributed over local ReplicatedMergeTree) and the
       * boot schema-sync already builds it, so running these historical
       * single-node DDL migrations against the Distributed / *Local tables
       * would fail and halt the chain. Record them as executed without running
       * them; the ConvertAnalyticsTablesToCluster migration handles any
       * existing data.
       */
      if (!migration.runsInClusterMode()) {
        logger.info(
          "Baselining Database Migration on clustered ClickHouse (recorded without running): " +
            migration.name,
        );
        const baselined: DataMigration = new DataMigration();
        baselined.name = migration.name;
        baselined.executed = true;
        baselined.executedAt = OneUptimeDate.getCurrentDate();
        await DataMigrationService.create({
          data: baselined,
          props: {
            isRoot: true,
          },
        });
        continue;
      }

      logger.debug("Running Database Migration:" + migration.name, {
        service: "workers",
      });

      await migration.migrate();

      logger.debug("Database Migration Complete:" + migration.name, {
        service: "workers",
      });

      // add it to the database.
      const dataMigration: DataMigration = new DataMigration();
      dataMigration.name = migration.name;
      dataMigration.executed = true;
      dataMigration.executedAt = OneUptimeDate.getCurrentDate();

      await DataMigrationService.create({
        data: dataMigration,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      logger.error("Database Migration Failed:" + migration.name, {
        service: "workers",
      });
      logger.error(err, { service: "workers" });

      /*
       * Persist the failure so the admin health page can explain why this
       * (and every migration after it) is pending. Best-effort — the helper
       * never throws — so it can't stop us from halting the chain below.
       */
      await recordMigrationFailure(dataSource, {
        migrationName: migration.name,
        migrationType: MigrationFailureType.DataMigration,
        error: err,
      });

      logger.debug("Rolling back Database Migration:" + migration.name, {
        service: "workers",
      });

      try {
        await migration.rollback();
      } catch (err) {
        logger.error("Database Migration Rollback Failed:" + migration.name, {
          service: "workers",
        });
        logger.error(err, { service: "workers" });
      }

      firstFailure = { name: migration.name, error: err };
      break; // Stop running migrations
    }
  }

  /*
   * Propagate the failure now the chain has halted. The migrate Job's
   * .catch() turns this into process.exit(1), failing the Helm Job/hook so
   * the deploy surfaces the broken migration instead of silently shipping a
   * schema that is frozen at this migration. On runtime pods the on-boot
   * call is fire-and-forget with its own .catch (Workers/Index.ts), so this
   * only logs there and never crashes the pod.
   */
  if (firstFailure) {
    const underlying: Error =
      firstFailure.error instanceof Error
        ? firstFailure.error
        : new Error(String(firstFailure.error));

    throw new Error(
      `Data migration "${firstFailure.name}" failed; halting the migration chain (every migration after it is skipped until this one succeeds). Underlying error: ${underlying.message}`,
    );
  }
};

export default RunDatabaseMigrations;
