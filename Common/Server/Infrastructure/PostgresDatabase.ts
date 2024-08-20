import logger from "../Utils/Logger";
import DatabaseDataSourceOptions from "./Postgres/DataSourceOptions";
import Sleep from "Common/Types/Sleep";
import { DataSource, DataSourceOptions } from "typeorm";
import { createDatabase, dropDatabase } from "typeorm-extension";

export type DatabaseSourceOptions = DataSourceOptions;
export type DatabaseSource = DataSource;

export default class Database {
  protected static dataSourceOptions: DataSourceOptions | null = null;
  protected static dataSource: DataSource | null = null;

  public static getDatasourceOptions(): DataSourceOptions {
    this.dataSourceOptions = DatabaseDataSourceOptions;
    return this.dataSourceOptions;
  }

  public static getDataSource(): DataSource | null {
    return this.dataSource;
  }

  public static isConnected(): boolean {
    return Boolean(this.dataSource);
  }

  public static async connect(): Promise<DataSource> {
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

      return await connectToDatabase();
    } catch (err) {
      logger.error("Postgres Database Connection Failed");
      logger.error(err);
      throw err;
    }
  }

  public static async disconnect(): Promise<void> {
    if (this.dataSource) {
      await this.dataSource.destroy();
      this.dataSource = null;
    }
  }

  public static async checkConnnectionStatus(): Promise<boolean> {
    // check popstgres connection to see if it is still alive

    try {
      const result: any = await this.dataSource?.query(
        `SELECT COUNT(domain) FROM "AcmeChallenge"`,
      ); // this is a dummy query to check if the connection is still alive

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

  public static async dropDatabase(): Promise<void> {
    await dropDatabase({
      options: this.getDatasourceOptions(),
    });
    this.dataSource = null;
    this.dataSourceOptions = null;
  }

  public static async createDatabase(): Promise<void> {
    await createDatabase({
      options: this.getDatasourceOptions(),
      ifNotExist: true,
    });
  }

  public static async createAndConnect(): Promise<void> {
    await this.createDatabase();
    await this.connect();
  }

  public static async disconnectAndDropDatabase(): Promise<void> {
    // Drop the database. Since this is the in-mem db, it will be destroyed.
    await this.disconnect();
    await this.dropDatabase();
  }
}
