import { JSONObject } from "../JSON";
import { DatabaseMetricGroup } from "./DatabaseMetricCatalog";
import {
  clampSqlConnectionTimeoutInMs,
  clampSqlStatementTimeoutInMs,
} from "./MonitorStepSqlMonitor";
import SqlConnectionConfig from "./SqlConnectionConfig";
import SqlDatabaseType from "./SqlDatabaseType";

/*
 * Connection + collection configuration for a Database Health monitor.
 *
 * The connection block deliberately mirrors MonitorStepSqlMonitor field for
 * field: the two monitor types point at the same kind of server, and an
 * operator who has configured one should not have to learn a second form.
 * What differs is everything after the connection - there is no user query
 * here. The probe runs built-in read-only catalog queries chosen by engine,
 * grouped so a missing grant degrades one group instead of the monitor.
 *
 * As with the SQL Query monitor, `password` (or any other field) may hold a
 * {{monitorSecrets.name}} reference that the server resolves before the
 * config is handed to a probe. OneUptime never creates those secrets itself.
 */

/*
 * Health queries are introspection, not user workload: they should return in
 * milliseconds against a healthy server. A tighter default than the SQL Query
 * monitor's is deliberate - if pg_stat_activity takes ten seconds, the useful
 * signal is "this server is in trouble", and we want the check to say so
 * rather than to sit and wait.
 */
export const DEFAULT_DATABASE_STATEMENT_TIMEOUT_IN_MS: number = 10000;
export const DEFAULT_DATABASE_CONNECTION_TIMEOUT_IN_MS: number = 10000;

/*
 * Every group is on by default. A group whose grant is missing reports itself
 * as unavailable rather than failing the check, so a default-on configuration
 * degrades into "the metrics you are entitled to" instead of an error.
 */
export const DEFAULT_DATABASE_METRIC_GROUPS: Array<DatabaseMetricGroup> = [
  DatabaseMetricGroup.Connections,
  DatabaseMetricGroup.Activity,
  DatabaseMetricGroup.Throughput,
  DatabaseMetricGroup.Locks,
  DatabaseMetricGroup.Storage,
  DatabaseMetricGroup.Replication,
  DatabaseMetricGroup.Maintenance,
];

export default interface MonitorStepDatabaseMonitor
  extends SqlConnectionConfig {
  connectionTimeoutInMs: number;
  statementTimeoutInMs: number;
  /*
   * Which collection groups to run. Trimming this list is how an operator
   * opts out of a group they cannot grant, or one whose queries they would
   * rather not pay for on a busy server (Storage is the usual candidate -
   * summing information_schema.TABLES is not free on a large MySQL server).
   */
  enabledMetricGroups: Array<DatabaseMetricGroup>;
}

export class MonitorStepDatabaseMonitorUtil {
  public static getDefault(): MonitorStepDatabaseMonitor {
    return {
      databaseType: SqlDatabaseType.PostgreSQL,
      host: "",
      port: 5432,
      databaseName: "",
      username: "",
      password: "",
      useWindowsIntegratedAuthentication: false,
      useSsl: false,
      rejectUnauthorizedSsl: true,
      connectionTimeoutInMs: DEFAULT_DATABASE_CONNECTION_TIMEOUT_IN_MS,
      statementTimeoutInMs: DEFAULT_DATABASE_STATEMENT_TIMEOUT_IN_MS,
      enabledMetricGroups: [...DEFAULT_DATABASE_METRIC_GROUPS],
    };
  }

  /**
   * Keep only recognized groups. An unknown string (an older or newer
   * dashboard, a hand-written API call) is dropped rather than passed to the
   * probe, which would otherwise have to defend against it at collection
   * time. An empty or absent list falls back to every group, because a
   * monitor that silently collects nothing is worse than one that collects
   * what it can.
   */
  public static sanitizeMetricGroups(
    groups: unknown,
  ): Array<DatabaseMetricGroup> {
    if (!Array.isArray(groups)) {
      return [...DEFAULT_DATABASE_METRIC_GROUPS];
    }

    const validGroups: Array<DatabaseMetricGroup> =
      Object.values(DatabaseMetricGroup);

    const sanitized: Array<DatabaseMetricGroup> = groups.filter(
      (group: unknown) => {
        return validGroups.includes(group as DatabaseMetricGroup);
      },
    ) as Array<DatabaseMetricGroup>;

    // De-duplicate while preserving the canonical group order.
    const seen: Set<DatabaseMetricGroup> = new Set<DatabaseMetricGroup>(
      sanitized,
    );

    const ordered: Array<DatabaseMetricGroup> =
      DEFAULT_DATABASE_METRIC_GROUPS.filter((group: DatabaseMetricGroup) => {
        return seen.has(group);
      });

    if (ordered.length === 0) {
      return [...DEFAULT_DATABASE_METRIC_GROUPS];
    }

    return ordered;
  }

  public static fromJSON(json: JSONObject): MonitorStepDatabaseMonitor {
    return {
      databaseType:
        (json["databaseType"] as SqlDatabaseType) || SqlDatabaseType.PostgreSQL,
      host: (json["host"] as string) || "",
      port: (json["port"] as number) || 5432,
      databaseName: (json["databaseName"] as string) || "",
      username: (json["username"] as string) || "",
      password: (json["password"] as string) || "",
      useWindowsIntegratedAuthentication: Boolean(
        json["useWindowsIntegratedAuthentication"],
      ),
      useSsl: Boolean(json["useSsl"]),
      rejectUnauthorizedSsl:
        json["rejectUnauthorizedSsl"] === undefined ||
        json["rejectUnauthorizedSsl"] === null
          ? true
          : Boolean(json["rejectUnauthorizedSsl"]),
      connectionTimeoutInMs: clampSqlConnectionTimeoutInMs(
        (json["connectionTimeoutInMs"] as number) ||
          DEFAULT_DATABASE_CONNECTION_TIMEOUT_IN_MS,
      ),
      statementTimeoutInMs: clampSqlStatementTimeoutInMs(
        (json["statementTimeoutInMs"] as number) ||
          DEFAULT_DATABASE_STATEMENT_TIMEOUT_IN_MS,
      ),
      enabledMetricGroups: this.sanitizeMetricGroups(
        json["enabledMetricGroups"],
      ),
    };
  }

  public static toJSON(monitor: MonitorStepDatabaseMonitor): JSONObject {
    return {
      databaseType: monitor.databaseType,
      host: monitor.host,
      port: monitor.port,
      databaseName: monitor.databaseName,
      username: monitor.username,
      password: monitor.password,
      useWindowsIntegratedAuthentication:
        monitor.useWindowsIntegratedAuthentication,
      useSsl: monitor.useSsl,
      rejectUnauthorizedSsl: monitor.rejectUnauthorizedSsl,
      connectionTimeoutInMs: monitor.connectionTimeoutInMs,
      statementTimeoutInMs: monitor.statementTimeoutInMs,
      enabledMetricGroups: [...monitor.enabledMetricGroups],
    };
  }
}
