import logger from "../Utils/Logger";
import DatabaseDataSourceOptions from "./Postgres/DataSourceOptions";
import Sleep from "Common/Types/Sleep";
import { DataSource, DataSourceOptions } from "typeorm";
import { createDatabase, dropDatabase } from "typeorm-extension";

export type DatabaseSourceOptions = DataSourceOptions;
export type DatabaseSource = DataSource;

export default class Database {
  protected dataSourceOptions: DataSourceOptions | null = null;
  protected dataSource: DataSource | null = null;

  public getDatasourceOptions(): DataSourceOptions {
    this.dataSourceOptions = DatabaseDataSourceOptions;
    return this.dataSourceOptions;
  }

  public getDataSource(): DataSource | null {
    return this.dataSource;
  }

  public isConnected(): boolean {
    return Boolean(this.dataSource);
  }

  public async connect(): Promise<DataSource> {
    let retry: number = 0;

    try {
      type ConnectToDatabaseFunction = () => Promise<DataSource>;

      const connectToDatabase: ConnectToDatabaseFunction =
        async (): Promise<DataSource> => {
          try {
            const PostgresDataSource: DataSource = new DataSource(
              this.getDatasourceOptions(),
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

  public async disconnect(): Promise<void> {
    if (this.dataSource) {
      await this.dataSource.destroy();
      this.dataSource = null;
    }
  }

  public async checkConnnectionStatus(): Promise<boolean> {
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

  public async dropDatabase(): Promise<void> {
    await dropDatabase({
      options: this.getDatasourceOptions(),
    });
    this.dataSource = null;
    this.dataSourceOptions = null;
  }

  public async createDatabase(): Promise<void> {
    await createDatabase({
      options: this.getDatasourceOptions(),
      ifNotExist: true,
    });
  }

  public async createAndConnect(): Promise<void> {
    await this.createDatabase();
    await this.connect();
  }

  public async disconnectAndDropDatabase(): Promise<void> {
    // Drop the database. Since this is the in-mem db, it will be destroyed.
    await this.disconnect();
    await this.dropDatabase();
  }
}

export const PostgresAppInstance: Database = new Database();


