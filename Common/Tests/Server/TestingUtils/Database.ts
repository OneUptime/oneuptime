import PostgresDatabase, {
  DatabaseSourceOptions,
} from "../../../Server/Infrastructure/PostgresDatabase";
import getTestDataSourceOptions from "../../../Server/Infrastructure/Postgres/TestDataSourceOptions";

export default class TestDatabase extends PostgresDatabase {
  public override getDatasourceOptions(): DatabaseSourceOptions {
    if (this.dataSourceOptions) {
      return this.dataSourceOptions;
    }

    this.dataSourceOptions = getTestDataSourceOptions();

    return this.dataSourceOptions;
  }
}
