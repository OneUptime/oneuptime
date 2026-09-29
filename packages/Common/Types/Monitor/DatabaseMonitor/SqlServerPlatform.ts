/*
 * Which Microsoft SQL Server platform a Database Health monitor is talking
 * to, and the grant each one needs.
 *
 * SQL Server, Azure SQL Managed Instance and Azure SQL Database all speak the
 * same protocol and answer the same DMV queries, but they do not share a
 * permission model. On SQL Server and Managed Instance the DMVs are gated by
 * the SERVER-level VIEW SERVER STATE. Azure SQL Database has no server-level
 * permissions a customer can grant - `GRANT VIEW SERVER STATE` fails there -
 * so the same DMVs are gated by the DATABASE-level VIEW DATABASE STATE
 * instead. Telling an Azure SQL Database operator to run the SQL Server grant
 * sends them to a statement that errors (issue #3913).
 *
 * The probe reads SERVERPROPERTY('EngineEdition') to decide, rather than
 * the version: Azure SQL Database reports ProductVersion 12.0.2000.8
 * whatever it actually runs, which reads as SQL Server 2014.
 *
 * The grant strings live here, not in the probe, so the probe's per-group
 * remediation, the monitor form's setup block and the documentation can be
 * checked against one another instead of drifting apart.
 */

/*
 * SERVERPROPERTY('EngineEdition'), as documented by Microsoft. Only the
 * values the monitor behaves differently for are named; every other value
 * is treated as SQL Server.
 */
export enum SqlServerEngineEdition {
  AzureSqlDatabase = 5,
  AzureSqlManagedInstance = 8,
  AzureSqlEdge = 9,
}

/*
 * SQL Server and Azure SQL Managed Instance. VIEW SERVER STATE covers every
 * DMV the monitor reads on every supported version; on SQL Server 2022 and
 * later the narrower VIEW SERVER PERFORMANCE STATE is enough (verified on
 * 2022 with each grant alone). A server-scope grant only runs while the
 * current database is master: anywhere else it fails with Msg 4621
 * (verified on 2017 and 2022).
 */
export const SQL_SERVER_MONITORING_GRANT: string =
  "GRANT VIEW SERVER STATE TO [<monitoring_login>];";

/*
 * Azure SQL Database, run in the MONITORED database (it cannot be granted in
 * master). Microsoft documents it as enough for every DMV the monitor reads
 * on vCore and on DTU S2 and above.
 */
export const AZURE_SQL_DATABASE_MONITORING_GRANT: string =
  "GRANT VIEW DATABASE STATE TO [<monitoring_user>];";

/*
 * Azure SQL Database on Basic, S0 and S1, and any database in an elastic
 * pool: there the DMVs admit only the server admin, the Microsoft Entra
 * admin or a member of this server role, whatever the database grants say
 * (the Permissions section of sys.dm_os_sys_info, sys.dm_os_waiting_tasks,
 * sys.dm_os_performance_counters, sys.dm_tran_* and sys.dm_db_*_space_usage).
 * Run in master, by the server admin, for a server LOGIN - the role reaches
 * each database where that login has a user. It is also the grant that
 * works on every tier, which is why it is the fallback when the database
 * grant turns out not to be enough.
 */
export const AZURE_SQL_DATABASE_SERVER_STATE_READER_GRANT: string =
  "ALTER SERVER ROLE ##MS_ServerStateReader## ADD MEMBER [<monitoring_login>];";

/*
 * What the probe attaches to a SQL Server permission failure. The operator
 * reading it is usually connected to the monitored database, where the
 * statement fails - hence where to run it.
 */
export const SQL_SERVER_MONITORING_REMEDIATION: string = `${SQL_SERVER_MONITORING_GRANT} -- run in master`;

/*
 * What the probe attaches to the same failure on Azure SQL Database: two
 * statements for two databases, one per line, each under a comment line
 * saying where it runs. Not one line with the fallback trailing in a `--`
 * comment - the summary renders a remediation as copyable code, and a
 * statement inside a comment is one that never runs when copied. Every line
 * is either a comment or a complete statement, so the block is valid SQL as
 * a whole; the view shows each statement separately.
 */
export const AZURE_SQL_DATABASE_MONITORING_REMEDIATION: string = [
  "-- In the monitored database:",
  AZURE_SQL_DATABASE_MONITORING_GRANT,
  "-- Basic, S0, S1, elastic pools, or if that is not enough: in master, for the login:",
  AZURE_SQL_DATABASE_SERVER_STATE_READER_GRANT,
].join("\n");

export default class SqlServerPlatformUtil {
  public static isAzureSqlDatabase(
    engineEdition: number | null | undefined,
  ): boolean {
    return engineEdition === SqlServerEngineEdition.AzureSqlDatabase;
  }

  /*
   * The product name shown next to the version on the monitor summary.
   * Anything unrecognised - including no value at all, from a probe query
   * that did not carry the edition - is SQL Server, which is what the
   * version number alone always implied.
   */
  public static getPlatformName(
    engineEdition: number | null | undefined,
  ): string {
    switch (engineEdition) {
      case SqlServerEngineEdition.AzureSqlDatabase:
        return "Azure SQL Database";
      case SqlServerEngineEdition.AzureSqlManagedInstance:
        return "Azure SQL Managed Instance";
      case SqlServerEngineEdition.AzureSqlEdge:
        return "Azure SQL Edge";
      default:
        return "SQL Server";
    }
  }
}
