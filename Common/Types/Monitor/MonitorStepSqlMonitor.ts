import { JSONObject } from "../JSON";
import SqlDatabaseType from "./SqlDatabaseType";

/*
 * Caps for SQL query execution. These are enforced server/probe-side and are
 * the safety envelope for running a customer-supplied query — a user cannot
 * raise them past these ceilings from the UI.
 */
export const MAX_SQL_STATEMENT_TIMEOUT_IN_MS: number = 60000; // 60 seconds
export const DEFAULT_SQL_STATEMENT_TIMEOUT_IN_MS: number = 15000; // 15 seconds
export const MAX_SQL_CONNECTION_TIMEOUT_IN_MS: number = 30000; // 30 seconds
export const DEFAULT_SQL_CONNECTION_TIMEOUT_IN_MS: number = 10000; // 10 seconds
export const MAX_SQL_MAX_ROWS: number = 1000;
export const DEFAULT_SQL_MAX_ROWS: number = 100;

export const clampSqlStatementTimeoutInMs: (value: number) => number = (
  value: number,
): number => {
  if (!value || value <= 0 || isNaN(value)) {
    return DEFAULT_SQL_STATEMENT_TIMEOUT_IN_MS;
  }
  if (value > MAX_SQL_STATEMENT_TIMEOUT_IN_MS) {
    return MAX_SQL_STATEMENT_TIMEOUT_IN_MS;
  }
  return value;
};

export const clampSqlConnectionTimeoutInMs: (value: number) => number = (
  value: number,
): number => {
  if (!value || value <= 0 || isNaN(value)) {
    return DEFAULT_SQL_CONNECTION_TIMEOUT_IN_MS;
  }
  if (value > MAX_SQL_CONNECTION_TIMEOUT_IN_MS) {
    return MAX_SQL_CONNECTION_TIMEOUT_IN_MS;
  }
  return value;
};

export const clampSqlMaxRows: (value: number) => number = (
  value: number,
): number => {
  if (!value || value <= 0 || isNaN(value)) {
    return DEFAULT_SQL_MAX_ROWS;
  }
  if (value > MAX_SQL_MAX_ROWS) {
    return MAX_SQL_MAX_ROWS;
  }
  return Math.floor(value);
};

/*
 * Connection + query configuration for a SQL Query monitor. Sensitive fields
 * (password, and optionally any other field) may contain a monitor-secret
 * reference like {{monitorSecrets.name}} — the server resolves these before
 * the config is handed to a probe. OneUptime never creates these secrets for
 * the user; referencing one is the user's choice.
 */
export default interface MonitorStepSqlMonitor {
  databaseType: SqlDatabaseType;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  // Raw password OR a {{monitorSecrets.name}} reference resolved server-side.
  password: string;
  useSsl: boolean;
  /*
   * When SSL is on, whether the server certificate chain must validate. Users
   * connecting to a DB with a self-signed cert set this to false.
   */
  rejectUnauthorizedSsl: boolean;
  // The read-only SQL query to run. A single statement is expected.
  query: string;
  connectionTimeoutInMs: number;
  statementTimeoutInMs: number;
  // Upper bound on rows read back from the DB (memory + payload guard).
  maxRows: number;
}

export class MonitorStepSqlMonitorUtil {
  public static getDefault(): MonitorStepSqlMonitor {
    return {
      databaseType: SqlDatabaseType.PostgreSQL,
      host: "",
      port: 5432,
      databaseName: "",
      username: "",
      password: "",
      useSsl: false,
      rejectUnauthorizedSsl: true,
      query: "",
      connectionTimeoutInMs: DEFAULT_SQL_CONNECTION_TIMEOUT_IN_MS,
      statementTimeoutInMs: DEFAULT_SQL_STATEMENT_TIMEOUT_IN_MS,
      maxRows: DEFAULT_SQL_MAX_ROWS,
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepSqlMonitor {
    return {
      databaseType:
        (json["databaseType"] as SqlDatabaseType) || SqlDatabaseType.PostgreSQL,
      host: (json["host"] as string) || "",
      port: (json["port"] as number) || 5432,
      databaseName: (json["databaseName"] as string) || "",
      username: (json["username"] as string) || "",
      password: (json["password"] as string) || "",
      useSsl: Boolean(json["useSsl"]),
      rejectUnauthorizedSsl:
        json["rejectUnauthorizedSsl"] === undefined ||
        json["rejectUnauthorizedSsl"] === null
          ? true
          : Boolean(json["rejectUnauthorizedSsl"]),
      query: (json["query"] as string) || "",
      connectionTimeoutInMs: clampSqlConnectionTimeoutInMs(
        json["connectionTimeoutInMs"] as number,
      ),
      statementTimeoutInMs: clampSqlStatementTimeoutInMs(
        json["statementTimeoutInMs"] as number,
      ),
      maxRows: clampSqlMaxRows(json["maxRows"] as number),
    };
  }

  public static toJSON(monitor: MonitorStepSqlMonitor): JSONObject {
    return {
      databaseType: monitor.databaseType,
      host: monitor.host,
      port: monitor.port,
      databaseName: monitor.databaseName,
      username: monitor.username,
      password: monitor.password,
      useSsl: monitor.useSsl,
      rejectUnauthorizedSsl: monitor.rejectUnauthorizedSsl,
      query: monitor.query,
      connectionTimeoutInMs: monitor.connectionTimeoutInMs,
      statementTimeoutInMs: monitor.statementTimeoutInMs,
      maxRows: monitor.maxRows,
    };
  }
}
