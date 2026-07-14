/*
 * Database engines a SQL Query monitor can target. Only the engines listed
 * in SqlDatabaseTypeUtil.getSupportedDatabaseTypes() are executable today —
 * any engine added to the enum but not returned there is reserved so the type
 * system and stored config are forward compatible when its probe executor
 * ships.
 */
enum SqlDatabaseType {
  PostgreSQL = "PostgreSQL",
  MySQL = "MySQL",
  MicrosoftSqlServer = "Microsoft SQL Server",
}

export default SqlDatabaseType;

export class SqlDatabaseTypeUtil {
  /**
   * Engines the probe can actually connect to and query today. Each has a
   * vetted, pure-JS driver in the probe (`pg`, `mysql2`, `mssql`) and a
   * read-only executor. An engine added to the enum but omitted here is not
   * offered in the dashboard and is rejected by the probe, so we never surface
   * a database type the probe cannot run.
   */
  public static getSupportedDatabaseTypes(): Array<SqlDatabaseType> {
    return [
      SqlDatabaseType.PostgreSQL,
      SqlDatabaseType.MySQL,
      SqlDatabaseType.MicrosoftSqlServer,
    ];
  }

  public static isSupported(databaseType: SqlDatabaseType): boolean {
    return this.getSupportedDatabaseTypes().includes(databaseType);
  }

  /** Default port for a database engine, used to seed the config form. */
  public static getDefaultPort(databaseType: SqlDatabaseType): number {
    switch (databaseType) {
      case SqlDatabaseType.PostgreSQL:
        return 5432;
      case SqlDatabaseType.MySQL:
        return 3306;
      case SqlDatabaseType.MicrosoftSqlServer:
        return 1433;
      default:
        return 5432;
    }
  }
}
