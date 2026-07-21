import MonitorStepSqlMonitor, {
  MonitorStepSqlMonitorUtil,
  clampSqlConnectionTimeoutInMs,
  clampSqlMaxRows,
  clampSqlStatementTimeoutInMs,
  DEFAULT_SQL_CONNECTION_TIMEOUT_IN_MS,
  DEFAULT_SQL_MAX_ROWS,
  DEFAULT_SQL_STATEMENT_TIMEOUT_IN_MS,
  MAX_SQL_CONNECTION_TIMEOUT_IN_MS,
  MAX_SQL_MAX_ROWS,
  MAX_SQL_STATEMENT_TIMEOUT_IN_MS,
} from "../../../Types/Monitor/MonitorStepSqlMonitor";
import SqlDatabaseType from "../../../Types/Monitor/SqlDatabaseType";
import { JSONObject } from "../../../Types/JSON";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";

const getSqlMonitorStep: (
  overrides?: Partial<MonitorStepSqlMonitor>,
) => MonitorStep = (
  overrides: Partial<MonitorStepSqlMonitor> = {},
): MonitorStep => {
  const id: ObjectID = ObjectID.generate();
  const monitorStep: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorName: "SQL monitor",
    monitorType: MonitorType.SQLQuery,
    onlineMonitorStatusId: id,
    offlineMonitorStatusId: id,
    defaultIncidentSeverityId: id,
    defaultAlertSeverityId: id,
  });

  return monitorStep.setSqlMonitor({
    ...MonitorStepSqlMonitorUtil.getDefault(),
    host: "sql.internal",
    databaseName: "orders",
    query: "SELECT 1",
    ...overrides,
  });
};

describe("MonitorStepSqlMonitorUtil", () => {
  describe("getDefault", () => {
    test("returns a PostgreSQL default with safe caps", () => {
      const def: MonitorStepSqlMonitor = MonitorStepSqlMonitorUtil.getDefault();
      expect(def.databaseType).toBe(SqlDatabaseType.PostgreSQL);
      expect(def.port).toBe(5432);
      expect(def.useSsl).toBe(false);
      expect(def.useWindowsIntegratedAuthentication).toBe(false);
      expect(def.rejectUnauthorizedSsl).toBe(true);
      expect(def.statementTimeoutInMs).toBe(
        DEFAULT_SQL_STATEMENT_TIMEOUT_IN_MS,
      );
      expect(def.connectionTimeoutInMs).toBe(
        DEFAULT_SQL_CONNECTION_TIMEOUT_IN_MS,
      );
      expect(def.maxRows).toBe(DEFAULT_SQL_MAX_ROWS);
    });
  });

  describe("clamps", () => {
    test("statement timeout is clamped to the max and defaulted when invalid", () => {
      expect(clampSqlStatementTimeoutInMs(999999)).toBe(
        MAX_SQL_STATEMENT_TIMEOUT_IN_MS,
      );
      expect(clampSqlStatementTimeoutInMs(0)).toBe(
        DEFAULT_SQL_STATEMENT_TIMEOUT_IN_MS,
      );
      expect(clampSqlStatementTimeoutInMs(-5)).toBe(
        DEFAULT_SQL_STATEMENT_TIMEOUT_IN_MS,
      );
      expect(clampSqlStatementTimeoutInMs(8000)).toBe(8000);
    });

    test("connection timeout is clamped to the max", () => {
      expect(clampSqlConnectionTimeoutInMs(999999)).toBe(
        MAX_SQL_CONNECTION_TIMEOUT_IN_MS,
      );
      expect(clampSqlConnectionTimeoutInMs(5000)).toBe(5000);
    });

    test("maxRows is clamped, floored, and defaulted", () => {
      expect(clampSqlMaxRows(999999)).toBe(MAX_SQL_MAX_ROWS);
      expect(clampSqlMaxRows(0)).toBe(DEFAULT_SQL_MAX_ROWS);
      expect(clampSqlMaxRows(12.9)).toBe(12);
    });
  });

  describe("fromJSON/toJSON round-trip", () => {
    test("preserves values and clamps out-of-range inputs", () => {
      const json: JSONObject = {
        databaseType: SqlDatabaseType.MicrosoftSqlServer,
        host: "db.internal",
        port: 5433,
        databaseName: "orders",
        username: "readonly",
        password: "{{monitorSecrets.dbPass}}",
        useWindowsIntegratedAuthentication: true,
        useSsl: true,
        rejectUnauthorizedSsl: false,
        query: "SELECT COUNT(*) FROM orders",
        connectionTimeoutInMs: 999999,
        statementTimeoutInMs: 20000,
        maxRows: 999999,
      };

      const parsed: MonitorStepSqlMonitor =
        MonitorStepSqlMonitorUtil.fromJSON(json);

      expect(parsed.host).toBe("db.internal");
      expect(parsed.port).toBe(5433);
      expect(parsed.password).toBe("{{monitorSecrets.dbPass}}");
      expect(parsed.useWindowsIntegratedAuthentication).toBe(true);
      expect(parsed.useSsl).toBe(true);
      expect(parsed.rejectUnauthorizedSsl).toBe(false);
      // clamped
      expect(parsed.connectionTimeoutInMs).toBe(
        MAX_SQL_CONNECTION_TIMEOUT_IN_MS,
      );
      expect(parsed.maxRows).toBe(MAX_SQL_MAX_ROWS);

      const roundTripped: MonitorStepSqlMonitor =
        MonitorStepSqlMonitorUtil.fromJSON(
          MonitorStepSqlMonitorUtil.toJSON(parsed),
        );
      expect(roundTripped).toEqual(parsed);
    });

    test("defaults rejectUnauthorizedSsl to true when absent", () => {
      const parsed: MonitorStepSqlMonitor = MonitorStepSqlMonitorUtil.fromJSON({
        host: "h",
        databaseName: "d",
        query: "SELECT 1",
      });
      expect(parsed.rejectUnauthorizedSsl).toBe(true);
      expect(parsed.useSsl).toBe(false);
      expect(parsed.useWindowsIntegratedAuthentication).toBe(false);
    });

    test("serializes an explicit false value for older SQL monitor configurations", () => {
      const json: JSONObject = MonitorStepSqlMonitorUtil.toJSON(
        MonitorStepSqlMonitorUtil.getDefault(),
      );

      expect(json["useWindowsIntegratedAuthentication"]).toBe(false);
    });
  });

  describe("MonitorStep validation", () => {
    test("accepts integrated authentication for Microsoft SQL Server", () => {
      const monitorStep: MonitorStep = getSqlMonitorStep({
        databaseType: SqlDatabaseType.MicrosoftSqlServer,
        port: 1433,
        username: "",
        password: "",
        useWindowsIntegratedAuthentication: true,
      });

      expect(
        MonitorStep.getValidationError(monitorStep, MonitorType.SQLQuery),
      ).toBeNull();
    });

    test.each([SqlDatabaseType.PostgreSQL, SqlDatabaseType.MySQL])(
      "rejects integrated authentication for %s",
      (databaseType: SqlDatabaseType) => {
        const monitorStep: MonitorStep = getSqlMonitorStep({
          databaseType,
          useWindowsIntegratedAuthentication: true,
        });

        expect(
          MonitorStep.getValidationError(monitorStep, MonitorType.SQLQuery),
        ).toBe(
          "Windows Integrated Authentication is only supported for Microsoft SQL Server",
        );
      },
    );

    test("preserves validation compatibility for SQL-login monitors", () => {
      const monitorStep: MonitorStep = getSqlMonitorStep({
        databaseType: SqlDatabaseType.PostgreSQL,
        useWindowsIntegratedAuthentication: false,
      });

      expect(
        MonitorStep.getValidationError(monitorStep, MonitorType.SQLQuery),
      ).toBeNull();
    });
  });
});
