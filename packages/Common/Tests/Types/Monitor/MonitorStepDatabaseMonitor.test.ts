import { DatabaseMetricGroup } from "../../../Types/Monitor/DatabaseMetricCatalog";
import { JSONObject } from "../../../Types/JSON";
import MonitorStepDatabaseMonitor, {
  DEFAULT_DATABASE_CONNECTION_TIMEOUT_IN_MS,
  DEFAULT_DATABASE_METRIC_GROUPS,
  DEFAULT_DATABASE_STATEMENT_TIMEOUT_IN_MS,
  MonitorStepDatabaseMonitorUtil,
} from "../../../Types/Monitor/MonitorStepDatabaseMonitor";
import {
  MAX_SQL_CONNECTION_TIMEOUT_IN_MS,
  MAX_SQL_STATEMENT_TIMEOUT_IN_MS,
} from "../../../Types/Monitor/MonitorStepSqlMonitor";
import SqlDatabaseType from "../../../Types/Monitor/SqlDatabaseType";
import { describe, expect, test } from "@jest/globals";

describe("MonitorStepDatabaseMonitorUtil", () => {
  describe("getDefault", () => {
    test("starts on PostgreSQL with its own port and validated TLS", () => {
      const config: MonitorStepDatabaseMonitor =
        MonitorStepDatabaseMonitorUtil.getDefault();

      expect(config.databaseType).toBe(SqlDatabaseType.PostgreSQL);
      expect(config.port).toBe(5432);
      // Opting out of chain validation must be a decision, never a default.
      expect(config.rejectUnauthorizedSsl).toBe(true);
      expect(config.useWindowsIntegratedAuthentication).toBe(false);
    });

    test("collects every metric group by default", () => {
      /*
       * Safe to default on only because a group the login cannot read
       * reports itself unavailable instead of failing the check. If that
       * contract ever changes, this default has to change with it.
       */
      const config: MonitorStepDatabaseMonitor =
        MonitorStepDatabaseMonitorUtil.getDefault();

      expect(config.enabledMetricGroups).toEqual(
        DEFAULT_DATABASE_METRIC_GROUPS,
      );
      expect(config.enabledMetricGroups).toHaveLength(
        Object.values(DatabaseMetricGroup).length,
      );
    });

    test("returns a fresh group array each time", () => {
      // A shared array would let one monitor's edit reconfigure every other.
      const first: MonitorStepDatabaseMonitor =
        MonitorStepDatabaseMonitorUtil.getDefault();
      const second: MonitorStepDatabaseMonitor =
        MonitorStepDatabaseMonitorUtil.getDefault();

      first.enabledMetricGroups.pop();

      expect(second.enabledMetricGroups).toEqual(
        DEFAULT_DATABASE_METRIC_GROUPS,
      );
      expect(DEFAULT_DATABASE_METRIC_GROUPS).toHaveLength(
        Object.values(DatabaseMetricGroup).length,
      );
    });

    test("defaults to a tighter statement timeout than a user query would get", () => {
      /*
       * Health queries are introspection and should return in milliseconds.
       * If pg_stat_activity takes ten seconds the useful signal is "this
       * server is in trouble", not a longer wait.
       */
      const config: MonitorStepDatabaseMonitor =
        MonitorStepDatabaseMonitorUtil.getDefault();

      expect(config.statementTimeoutInMs).toBe(
        DEFAULT_DATABASE_STATEMENT_TIMEOUT_IN_MS,
      );
      expect(config.statementTimeoutInMs).toBeLessThan(
        MAX_SQL_STATEMENT_TIMEOUT_IN_MS,
      );
      expect(config.connectionTimeoutInMs).toBe(
        DEFAULT_DATABASE_CONNECTION_TIMEOUT_IN_MS,
      );
    });
  });

  describe("sanitizeMetricGroups", () => {
    test("keeps recognized groups and drops anything else", () => {
      expect(
        MonitorStepDatabaseMonitorUtil.sanitizeMetricGroups([
          DatabaseMetricGroup.Locks,
          "Telepathy",
          DatabaseMetricGroup.Storage,
          42,
          null,
        ]),
        // Canonical order, not input order: Locks precedes Storage.
      ).toEqual([DatabaseMetricGroup.Locks, DatabaseMetricGroup.Storage]);
    });

    test("normalizes to the canonical order regardless of input order", () => {
      // Keeps the config form and the collector iterating in one order.
      expect(
        MonitorStepDatabaseMonitorUtil.sanitizeMetricGroups([
          DatabaseMetricGroup.Maintenance,
          DatabaseMetricGroup.Connections,
        ]),
      ).toEqual([
        DatabaseMetricGroup.Connections,
        DatabaseMetricGroup.Maintenance,
      ]);
    });

    test("de-duplicates repeated groups", () => {
      expect(
        MonitorStepDatabaseMonitorUtil.sanitizeMetricGroups([
          DatabaseMetricGroup.Locks,
          DatabaseMetricGroup.Locks,
        ]),
      ).toEqual([DatabaseMetricGroup.Locks]);
    });

    test.each([
      ["an empty list", []],
      ["a list of only unknown values", ["nope", "also-nope"]],
      ["a non-array", "Locks"],
      ["undefined", undefined],
      ["null", null],
    ])("falls back to every group for %s", (_label: string, input: unknown) => {
      /*
       * A monitor that silently collects nothing is worse than one that
       * collects what it can, so an unusable list means "everything"
       * rather than "nothing".
       */
      expect(
        MonitorStepDatabaseMonitorUtil.sanitizeMetricGroups(input),
      ).toEqual(DEFAULT_DATABASE_METRIC_GROUPS);
    });
  });

  describe("fromJSON", () => {
    test("round-trips a full configuration through toJSON", () => {
      const config: MonitorStepDatabaseMonitor = {
        ...MonitorStepDatabaseMonitorUtil.getDefault(),
        databaseType: SqlDatabaseType.MicrosoftSqlServer,
        host: "sql.internal",
        port: 1433,
        databaseName: "orders",
        username: "monitoring",
        password: "{{monitorSecrets.dbPassword}}",
        useSsl: true,
        enabledMetricGroups: [
          DatabaseMetricGroup.Connections,
          DatabaseMetricGroup.Replication,
        ],
      };

      const restored: MonitorStepDatabaseMonitor =
        MonitorStepDatabaseMonitorUtil.fromJSON(
          MonitorStepDatabaseMonitorUtil.toJSON(config),
        );

      expect(restored).toEqual(config);
    });

    test("preserves a monitor-secret reference verbatim", () => {
      /*
       * The server resolves {{monitorSecrets.name}} on the way to the probe.
       * Any mangling here turns into an authentication failure that looks
       * like a wrong password.
       */
      const restored: MonitorStepDatabaseMonitor =
        MonitorStepDatabaseMonitorUtil.fromJSON({
          host: "db.internal",
          password: "{{monitorSecrets.dbPassword}}",
        } as JSONObject);

      expect(restored.password).toBe("{{monitorSecrets.dbPassword}}");
    });

    test("clamps timeouts to the shared SQL ceilings", () => {
      const restored: MonitorStepDatabaseMonitor =
        MonitorStepDatabaseMonitorUtil.fromJSON({
          statementTimeoutInMs: 999999,
          connectionTimeoutInMs: 999999,
        } as JSONObject);

      expect(restored.statementTimeoutInMs).toBe(
        MAX_SQL_STATEMENT_TIMEOUT_IN_MS,
      );
      expect(restored.connectionTimeoutInMs).toBe(
        MAX_SQL_CONNECTION_TIMEOUT_IN_MS,
      );
    });

    test("falls back to safe values for an empty payload", () => {
      const restored: MonitorStepDatabaseMonitor =
        MonitorStepDatabaseMonitorUtil.fromJSON({});

      expect(restored.databaseType).toBe(SqlDatabaseType.PostgreSQL);
      expect(restored.rejectUnauthorizedSsl).toBe(true);
      expect(restored.enabledMetricGroups).toEqual(
        DEFAULT_DATABASE_METRIC_GROUPS,
      );
    });

    test("treats an explicitly false rejectUnauthorizedSsl as a real choice", () => {
      /*
       * Distinguishing "absent" from "false" matters: absent must default to
       * validating the chain, but a user who turned validation off for a
       * self-signed certificate must keep that setting.
       */
      expect(
        MonitorStepDatabaseMonitorUtil.fromJSON({
          rejectUnauthorizedSsl: false,
        } as JSONObject).rejectUnauthorizedSsl,
      ).toBe(false);

      expect(
        MonitorStepDatabaseMonitorUtil.fromJSON({}).rejectUnauthorizedSsl,
      ).toBe(true);
    });

    test("normalizes an unusable group list rather than trusting it", () => {
      expect(
        MonitorStepDatabaseMonitorUtil.fromJSON({
          enabledMetricGroups: ["Locks", "not-a-group"],
        } as JSONObject).enabledMetricGroups,
      ).toEqual([DatabaseMetricGroup.Locks]);
    });
  });

  describe("toJSON", () => {
    test("copies the group array instead of aliasing it", () => {
      const config: MonitorStepDatabaseMonitor =
        MonitorStepDatabaseMonitorUtil.getDefault();

      const json: JSONObject = MonitorStepDatabaseMonitorUtil.toJSON(config);
      (json["enabledMetricGroups"] as Array<DatabaseMetricGroup>).pop();

      expect(config.enabledMetricGroups).toEqual(
        DEFAULT_DATABASE_METRIC_GROUPS,
      );
    });
  });
});
