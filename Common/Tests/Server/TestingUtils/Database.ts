import PostgresDatabase, {
  DatabaseSource,
  DatabaseSourceOptions,
  DatabaseExtentions,
} from "../../../Server/Infrastructure/PostgresDatabase";

export default class DatabaseConnect {
  private database!: PostgresDatabase;
  private dataSourceOptions!: DatabaseSourceOptions;

  public constructor() {
    this.database = new PostgresDatabase();
  }

  public getDatabase(): PostgresDatabase {
    return this.database;
  }

  public async createAndConnect(): Promise<DatabaseSource> {
    const dataSourceOptions: DatabaseSourceOptions =
      await this.createDatabase();
    return await this.connectDatabase(dataSourceOptions);
  }

  public async disconnectAndDropDatabase(): Promise<void> {
    await this.disconnectDatabase();
    await this.dropDatabase();
  }

  public async createDatabase(): Promise<DatabaseSourceOptions> {
    const dataSourceOptions: DatabaseSourceOptions =
      this.database.getTestDatasourceOptions();
    this.dataSourceOptions = dataSourceOptions;
    await DatabaseExtentions.createDatabase({
      options: dataSourceOptions,
      ifNotExist: true,
    });

    return dataSourceOptions;
  }
  public async connectDatabase(
    dataSourceOptions: DatabaseSourceOptions,
  ): Promise<DatabaseSource> {
    const connection: DatabaseSource =
      await this.database.connect(dataSourceOptions);
    await connection.synchronize();
    return connection;
  }

  public async disconnectDatabase(): Promise<void> {
    await this.database.disconnect();
  }

  public async dropDatabase(): Promise<void> {
    await DatabaseExtentions.dropDatabase({
      options: this.dataSourceOptions,
      ifExist: true,
    });
  }
}
