import SqlDatabaseType from "./SqlDatabaseType";

/*
 * The connection half of a SQL-speaking monitor's configuration.
 *
 * Extracted so the SQL Query monitor and the Database Health monitor can
 * share one implementation of the fiddly parts - TLS options, and especially
 * the SQL Server integrated-authentication path, which has to detect the
 * host's ODBC driver and build a connection string by hand. Duplicating that
 * for a second monitor type would guarantee the two drift.
 *
 * Both MonitorStepSqlMonitor and MonitorStepDatabaseMonitor extend this, so
 * anything that only needs to CONNECT should take this type rather than
 * either step type.
 */
export default interface SqlConnectionConfig {
  databaseType: SqlDatabaseType;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  // Raw password OR a {{monitorSecrets.name}} reference resolved server-side.
  password: string;
  /*
   * Microsoft SQL Server only: authenticate as the identity the probe runs
   * as (SSPI on Windows, Kerberos elsewhere).
   */
  useWindowsIntegratedAuthentication: boolean;
  useSsl: boolean;
  rejectUnauthorizedSsl: boolean;
}
