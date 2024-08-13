import TestDatabase, { TestPostgresAppInstance } from "../TestDatabase";

export class TestDatabaseMock {
  public static async getDbMock(): Promise<TestDatabase> {
    const testDatabase: TestDatabase = TestPostgresAppInstance;

    await testDatabase.createAndConnect();

    return testDatabase;
  }
}
