import logger from "../Utils/Logger";
import DatabaseDataSourceOptions from "./Postgres/DataSourceOptions";
import Sleep from "../../Types/Sleep";
import { DataSource, DataSourceOptions } from "typeorm";
import { createDatabase, dropDatabase } from "typeorm-extension";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import GracefulShutdown, { ShutdownPriority } from "../Utils/GracefulShutdown";

export type DatabaseSourceOptions = DataSourceOptions;
export type DatabaseSource = DataSource;

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

    try {
      type ConnectToDatabaseFunction = () => Promise<DataSource>;

      const connectToDatabase: ConnectToDatabaseFunction =
        async (): Promise<DataSource> => {
          try {
            const PostgresDataSource: DataSource = new DataSource(
              dataSourceOptions,
            );
            const dataSource: DataSource =
              await PostgresDataSource.initialize();
            logger.debug("Postgres Database Connected");
            this.dataSource = dataSource;
            return dataSource;
          } catch (err) {
            if (retry < 3) {
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
