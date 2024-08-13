import TestDatabase from "../TestDatabase";

export class TestDatabaseMock {
  public static async getDbMock(): Promise<TestDatabase> {
    const testDatabase: TestDatabase = new TestDatabase();

    jest.mock("../../../../Server/Infrastructure/PostgresDatabase", () => {
      const actualModule: any = jest.requireActual(
        "../../../Server/Infrastructure/PostgresDatabase",
      );
      return {
        __esModule: true,
        default: actualModule.default,
        PostgresAppInstance: {
          getDataSource: () => {
            return testDatabase.getDataSource();
          },
          isConnected: () => {
            return testDatabase.isConnected();
          },
        },
      };
    });

    await testDatabase.createAndConnect();

    return testDatabase;
  }
}
