import getTestDataSourceOptions from "../Postgres/TestDataSourceOptions";
import { PostgresAppInstance } from "../../../../Server/Infrastructure/PostgresDatabase";
import Redis from "../../../../Server/Infrastructure/Redis";
import getTestRedisConnectionOptions from "../Redis/TestRedisOptions";

export class TestDatabaseMock {
  public static async connectDbMock(): Promise<void> {
    const testDataSourceOptions = getTestDataSourceOptions();

    PostgresAppInstance.getDatasourceOptions = () => {
      return testDataSourceOptions;
    }

    Redis.getRedisOptions = () => {
      return getTestRedisConnectionOptions();
    };
    
    await Redis.connect();
    await PostgresAppInstance.createAndConnect();
  }

  public static async disconnectDbMock(): Promise<void> {
    
    await PostgresAppInstance.disconnectAndDropDatabase();
    await Redis.disconnect();
  }
}
