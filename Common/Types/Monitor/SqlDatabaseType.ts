/*
 * Database engines a SQL Query monitor can target. Only the engines listed
 * in SqlDatabaseTypeUtil.getSupportedDatabaseTypes() are executable today —
 * the rest are reserved so the type system and stored config are forward
 * compatible when their probe executors ship.
 */
enum SqlDatabaseType {
  PostgreSQL = "PostgreSQL",
  MySQL = "MySQL",
  MicrosoftSqlServer = "Microsoft SQL Server",
}

export default SqlDatabaseType;

export class SqlDatabaseTypeUtil {
  /**
   * Engines the probe can actually connect to and query today. PostgreSQL is
   * the v1 engine (its driver, `pg`, is already vetted in the monorepo). The
   * others are intentionally not returned here until their executor lands, so
   * the dashboard never offers a database type the probe cannot run.
   */
  public static getSupportedDatabaseTypes(): Array<SqlDatabaseType> {
    return [SqlDatabaseType.PostgreSQL];
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
