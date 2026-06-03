import DataMigrations from "../DataMigrations/Index";
import OneUptimeDate from "Common/Types/Date";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import DataMigrationService from "Common/Server/Services/DataMigrationService";
import logger from "Common/Server/Utils/Logger";
import DataMigration from "Common/Models/DatabaseModels/DataMigration";
import PostgresDatabase, {
  DatabaseQueryRunner,
  DatabaseSource,
} from "Common/Server/Infrastructure/PostgresDatabase";

/*
 * A fixed, app-specific label for the Postgres session-level advisory lock
 * that serializes this data-migration runner across processes. hashtext() maps
 * it to the bigint key pg_advisory_lock expects; the readable string keeps the
 * lock self-documenting and unlikely to collide with other advisory locks.
 */
const DATA_MIGRATION_LOCK_LABEL: string = "oneuptime:data-migration-runner";

const RunDatabaseMigrations: PromiseVoidFunction = async (): Promise<void> => {
  const dataSource: DatabaseSource | null = PostgresDatabase.getDataSource();

  if (!dataSource) {
    logger.error(
      "Skipping data migrations: Postgres DataSource is not connected.",
    );
    return;
  }

  /*
   * Serialize the whole migration loop across processes with a Postgres
   * session-level advisory lock. Several replicas (and, with the api/worker
   * split, several deployments) run this on boot; without a lock two pods can
   * both read a migration as "not executed" and run migrate() twice. We pin a
   * single connection via a dedicated QueryRunner because a session-level
   * advisory lock belongs to the connection that took it — releasing the
   * connection back to the pool does NOT drop the lock, so we unlock
   * explicitly below. pg_advisory_lock blocks until the lock is free, so other
   * pods wait their turn and then find every migration already executed; if the
   * holder dies its session ends and Postgres releases the lock automatically.
   */
  const queryRunner: DatabaseQueryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();

  try {
    await queryRunner.query("SELECT pg_advisory_lock(hashtext($1))", [
      DATA_MIGRATION_LOCK_LABEL,
    ]);

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

        break; // Stop running migrations
      }
    }
  } finally {
    // Release the advisory lock on the same connection that acquired it.
    try {
      await queryRunner.query("SELECT pg_advisory_unlock(hashtext($1))", [
        DATA_MIGRATION_LOCK_LABEL,
      ]);
    } catch (err) {
      logger.error("Failed to release data-migration advisory lock");
      logger.error(err, { service: "workers" });
    }

    await queryRunner.release();
  }
};

export default RunDatabaseMigrations;
