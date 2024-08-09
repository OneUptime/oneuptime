import PostgresDatabase, {
  DatabaseSource,
  DatabaseSourceOptions,
} from "../../../Server/Infrastructure/PostgresDatabase";
import { newDb } from "pg-mem";
import logger from "../../../Server/Utils/Logger";
import getTestDataSourceOptions from "../../../Server/Infrastructure/Postgres/TestDataSourceOptions";

export default class TestDatabase extends PostgresDatabase {
  public async createAndConnect(): Promise<void> {
    const testDatasourceOptions = getTestDataSourceOptions();
    await this.connect(testDatasourceOptions);
  }

  public override async connect(
    dataSourceOptions: DatabaseSourceOptions,
  ): Promise<DatabaseSource> {
    const db = newDb();
    const dataSource: DatabaseSource =
      db.adapters.createTypeormDataSource(dataSourceOptions);
    logger.debug("Postgres Database Connected");
    this.dataSource = dataSource;
    return dataSource;
  }

  public async disconnectAndDropDatabase(): Promise<void> {
    // Drop the database. Since this is the in-mem db, it will be destroyed.
  }
}

export const PostgresAppInstance: TestDatabase = new TestDatabase();
