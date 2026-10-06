import logger from "../Utils/Logger";
import DatabaseDataSourceOptions from "./Postgres/DataSourceOptions";
import SchemaMigrationRunner, {
  SchemaMigrationLockTimeoutError,
} from "./Postgres/SchemaMigrationRunner";
import SchemaMigrationWait, {
  SchemaMigrationWaitTimeoutError,
} from "./Postgres/SchemaMigrationWait";
import { recordSchemaMigrationFailureBestEffort } from "../Utils/Database/MigrationFailureLog";
import Sleep from "../../Types/Sleep";
import { DataSource, DataSourceOptions, QueryRunner } from "typeorm";
import { createDatabase, dropDatabase } from "typeorm-extension";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import GracefulShutdown, { ShutdownPriority } from "../Utils/GracefulShutdown";

export type DatabaseSourceOptions = DataSourceOptions;
export type DatabaseSource = DataSource;
export type DatabaseQueryRunner = QueryRunner;

export default class Database {
  protected static dataSourceOptions: DataSourceOptions | null = null;
  protected static dataSource: DataSource | null = null;

  @CaptureSpan()
  public static getDatasourceOptions(): DataSourceOptions {
    this.dataSourceOptions = DatabaseDataSourceOptions;
    return this.dataSourceOptions;
  }

  @CaptureSpan()
  public static getDataSource(): DataSource | null {
    return this.dataSource;
  }

  @CaptureSpan()
  public static isConnected(): boolean {
    return Boolean(this.dataSource);
  }

  @CaptureSpan()
  public static async connect(): Promise<DataSource> {
    /*
     * Idempotent: a second connect() must not overwrite (and thereby orphan)
     * the existing pool. Return the live DataSource instead of building a new
     * one.
     */
    if (this.dataSource) {
      return this.dataSource;
    }

    let retry: number = 0;

    const dataSourceOptions: DataSourceOptions = this.getDatasourceOptions();

    /*
     * Whether this process applies the schema migrations (see
     * RunDatabaseMigrationsOnBoot). They are applied by SchemaMigrationRunner
     * on a connection of its own, with a bounded lock wait and retries, never
     * by initialize() on this pool: `migrationsRun` is switched off below. A
     * process that does not apply them waits for them instead.
     */
    const runsSchemaMigrations: boolean =
      (dataSourceOptions as { migrationsRun?: boolean }).migrationsRun === true;

    try {
      type ConnectToDatabaseFunction = () => Promise<DataSource>;

      const connectToDatabase: ConnectToDatabaseFunction =
        async (): Promise<DataSource> => {
          let dataSource: DataSource | null = null;

          try {
            dataSource = await new DataSource({
              ...dataSourceOptions,
              migrationsRun: false,
            } as DataSourceOptions).initialize();

            if (runsSchemaMigrations) {
              await SchemaMigrationRunner.runPendingMigrations(
                dataSourceOptions,
              );
            } else {
              /*
               * Someone else applies them - in the Helm chart the migrate
               * Job, which by default runs while the new pods start. Code
               * running on the older schema fails every query that needs
               * what the missing migrations add, so hold the boot until they
               * are applied (bounded: DATABASE_MIGRATION_WAIT_TIMEOUT_MS).
               * The pool is not handed out meanwhile, so the process is not
               * connected, not started and not ready.
               */
              await SchemaMigrationWait.waitForPendingMigrations(dataSource);
            }

            logger.debug("Postgres Database Connected");
            this.dataSource = dataSource;
            return dataSource;
          } catch (err) {
            /*
             * As initialize() did when a migration failed: drop the pool,
             * without letting a failure to close it replace the real error.
             */
            if (dataSource?.isInitialized) {
              await dataSource.destroy().catch((destroyError: unknown) => {
                logger.warn(
                  "Could not close the Postgres pool after a failure",
                );
                logger.warn(destroyError);
              });
            }

            /*
             * The runner already spent its whole retry window on a lock, or
             * the wait its whole timeout; three more rounds of either would
             * only hold the deploy longer.
             */
            if (
              retry < 3 &&
              !(err instanceof SchemaMigrationLockTimeoutError) &&
              !(err instanceof SchemaMigrationWaitTimeoutError)
            ) {
              logger.debug(
                "Cannot connect to Postgres. Retrying again in 5 seconds",
              );
              // sleep for 5 seconds.

              await Sleep.sleep(5000);

              retry++;
              return await connectToDatabase();
            }
            throw err;
          }
        };

      const dataSource: DataSource = await connectToDatabase();

      /*
       * Drain the pool on shutdown. Registered here (after a successful
       * connect) so we never register cleanup for a pool that was never
       * created, and — thanks to GracefulShutdown deduping by name — exactly
       * once even if connect() is somehow reached twice.
       */
      GracefulShutdown.registerHandler(
        "PostgresDatabase",
        ShutdownPriority.DataStores,
        () => {
          return this.disconnect();
        },
      );

      return dataSource;
    } catch (err) {
      logger.error("Postgres Database Connection Failed");
      logger.error(err);

      /*
       * When this process runs schema migrations on boot (migrationsRun=true),
       * connect() also fails if a migration threw. Record which migration
       * failed and why — on a throwaway connection, since the DataSource above
       * is unusable — so the admin health page can explain the pending schema.
       * Best-effort and self-contained: it never throws and never masks `err`.
       */
      await recordSchemaMigrationFailureBestEffort(dataSourceOptions, err);

      throw err;
    }
  }

  @CaptureSpan()
  public static async disconnect(): Promise<void> {
    if (this.dataSource) {
      await this.dataSource.destroy();
      this.dataSource = null;
    }
  }

  @CaptureSpan()
  public static async checkConnnectionStatus(): Promise<boolean> {
    // SELECT 1 round-trips a connection without scanning any user table.
    try {
      const result: any = await this.dataSource?.query(`SELECT 1`);

      if (!result) {
        return false;
      }

      return true;
    } catch (err) {
      logger.error("Postgres Connection Lost");
      logger.error(err);
      return false;
    }
  }

  @CaptureSpan()
  public static async dropDatabase(): Promise<void> {
    await dropDatabase({
      options: this.getDatasourceOptions(),
    });
    this.dataSource = null;
    this.dataSourceOptions = null;
  }

  @CaptureSpan()
  public static async createDatabase(): Promise<void> {
    await createDatabase({
      options: this.getDatasourceOptions(),
      ifNotExist: true,
    });
  }

  @CaptureSpan()
  public static async createAndConnect(): Promise<void> {
    await this.createDatabase();
    await this.connect();
  }

  @CaptureSpan()
  public static async disconnectAndDropDatabase(): Promise<void> {
    // Drop the database. Since this is the in-mem db, it will be destroyed.
    await this.disconnect();
    await this.dropDatabase();
  }
}
