import "./Helpers/TestSupport";
import assert from "assert";
import { after, before, describe, test } from "node:test";
import { SqlRow } from "../Executors/Database/DatabaseDrivers";
import IngestClient from "../IngestClient";
import { AgentSession } from "../Registration";
import { buildPosture, normalizeProbe } from "../Posture";
import { parseConfig } from "../Config";
import DataObservabilityCollector, {
  API_MISSING_RETRY_MS,
} from "../DataObservability/DataObservabilityCollector";
import {
  DataObservabilitySettings,
  getDataObservabilityPosture,
  resolveDataObservabilitySettings,
} from "../DataObservability/DataObservabilitySettings";
import {
  CHECKS_OFF_REFUSAL,
  collectDatabase,
  maskSecrets,
} from "../DataObservability/DataObservabilityReader";
import { FakeDrivers, FakeSqlConnection } from "./Helpers/FakeDatabase";
import FakeOneUptime from "./Helpers/FakeOneUptime";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";
import { parseResourceAiAgentPosture } from "../Common/Types/ResourceAiAgent/ResourceAiAccess";
import {
  DATABASE_AGENT_WORK_VERSION,
  DatabaseAgentCheck,
  DatabaseAgentReport,
  DatabaseAgentWork,
} from "../Common/Utils/DataObservability/DatabaseAgent/DatabaseAgentWork";
import {
  CUSTOM_SQL_OFF_REFUSAL,
  MYSQL_COLUMNS_SQL,
  MYSQL_COUNTERS_SQL,
  MYSQL_TABLES_SQL,
  MYSQL_UPTIME_SQL,
  POSTGRES_COLUMNS_SQL,
  POSTGRES_RECOVERY_SQL,
  POSTGRES_STATS_RESET_SQL,
  POSTGRES_VIEW_LINEAGE_SQL,
  getPostgresTablesSql,
} from "../Common/Utils/DataObservability/DatabaseAgent/DatabaseAgentStatements";
import { DataCheckType } from "../Common/Types/DataObservability/DataCheckType";

/*
 * THE DATABASE AGENT'S DATA OBSERVABILITY, WITHOUT A DATABASE (#11148).
 *
 * Over scripted drivers, so CI holds what the live suite holds against real
 * servers: what the agent's owner turns on and with which logins, what the
 * posture says (never a login), the exact statements a collection sends -
 * every one from this agent's own shapes, each read in a read-only
 * transaction of its own - which login each capability connects with, and
 * the loop's conversation with OneUptime.
 */

const BASE_ENV: NodeJS.ProcessEnv = {
  DATABASE_SYSTEM: "postgresql",
  DATABASE_ENDPOINT: "db.internal:5432",
  DATABASE_USERNAME: "monitor$$user",
  DATABASE_PASSWORD: "monitor-pa$$word",
  ONEUPTIME_AI_DATABASE_USERNAME: "ai_fixer",
  ONEUPTIME_AI_DATABASE_PASSWORD: "ai-fixer-password",
};

function settingsOf(extra: NodeJS.ProcessEnv = {}): DataObservabilitySettings {
  return resolveDataObservabilitySettings({ ...BASE_ENV, ...extra });
}

const ON: NodeJS.ProcessEnv = { ONEUPTIME_DATA_OBSERVABILITY: "true" };

describe("Data Observability on a Database Agent: its owner's settings", () => {
  test("is off unless its owner sets exactly true", () => {
    for (const value of [undefined, "", "false", "TRUE", "yes", "1", "true "]) {
      const settings: DataObservabilitySettings = settingsOf(
        value === undefined ? {} : { ONEUPTIME_DATA_OBSERVABILITY: value },
      );

      assert.strictEqual(
        settings.isOn,
        value === "true ",
        `ONEUPTIME_DATA_OBSERVABILITY=${String(value)}`,
      );
    }
  });

  test("reads the catalog with the collector's monitoring login, never the AI agent's", () => {
    const settings: DataObservabilitySettings = settingsOf(ON);

    assert.strictEqual(settings.isOn, true);
    assert.strictEqual(settings.engine, "postgresql");
    // The collector's login, its $$ halved as the collector reads it.
    assert.strictEqual(settings.catalogLogin?.username, "monitor$user");
    assert.strictEqual(settings.catalogLogin?.password, "monitor-pa$word");
    assert.strictEqual(
      settings.catalogLogin?.source,
      "DATABASE_USERNAME/DATABASE_PASSWORD",
    );
    // The checks read with it too, until they are given one of their own.
    assert.strictEqual(settings.checksLogin?.username, "monitor$user");
    // The AI agent's login, which may signal other sessions, is never used.
    assert.notStrictEqual(settings.catalogLogin?.username, "ai_fixer");
    assert.strictEqual(settings.database?.host, "db.internal");
    assert.strictEqual(settings.database?.port, 5432);
  });

  test("a login of its own for the catalog and another for the checks: least privilege for each", () => {
    const settings: DataObservabilitySettings = settingsOf({
      ...ON,
      ONEUPTIME_DATA_OBSERVABILITY_DATABASE_USERNAME: "do_catalog",
      ONEUPTIME_DATA_OBSERVABILITY_DATABASE_PASSWORD: "catalog-pa$$",
      ONEUPTIME_DATA_OBSERVABILITY_CHECKS_USERNAME: "do_checks",
      ONEUPTIME_DATA_OBSERVABILITY_CHECKS_PASSWORD: "checks-password",
    });

    assert.strictEqual(settings.catalogLogin?.username, "do_catalog");
    // Its own logins are read as written: no $$ halving.
    assert.strictEqual(settings.catalogLogin?.password, "catalog-pa$$");
    assert.strictEqual(settings.checksLogin?.username, "do_checks");
    assert.strictEqual(settings.checksLogin?.password, "checks-password");
  });

  test("runs the catalog alone when its owner turns checks off, and Custom SQL only when they allow it", () => {
    assert.strictEqual(settingsOf(ON).runsChecks, true);
    assert.strictEqual(settingsOf(ON).runsCustomSql, false);
    assert.strictEqual(
      settingsOf({
        ...ON,
        ONEUPTIME_DATA_OBSERVABILITY_ALLOW_CUSTOM_SQL: "true",
      }).runsCustomSql,
      true,
    );
    assert.strictEqual(
      settingsOf({
        ...ON,
        ONEUPTIME_DATA_OBSERVABILITY_ALLOW_CUSTOM_SQL: "yes",
      }).runsCustomSql,
      false,
    );

    const checksOff: DataObservabilitySettings = settingsOf({
      ...ON,
      ONEUPTIME_DATA_OBSERVABILITY_CHECKS: "false",
      ONEUPTIME_DATA_OBSERVABILITY_ALLOW_CUSTOM_SQL: "true",
    });

    assert.strictEqual(checksOff.runsChecks, false);
    assert.strictEqual(checksOff.runsCustomSql, false);
  });

  test("says why it is off when it was asked to be on", () => {
    const redis: DataObservabilitySettings = settingsOf({
      ...ON,
      DATABASE_SYSTEM: "redis",
    });

    assert.strictEqual(redis.isOn, false);
    assert.match(redis.offReason || "", /PostgreSQL, MySQL and MariaDB/);

    const noLogin: DataObservabilitySettings = resolveDataObservabilitySettings(
      {
        ...ON,
        DATABASE_SYSTEM: "mysql",
        DATABASE_ENDPOINT: "db:3306",
      },
    );

    assert.strictEqual(noLogin.isOn, false);
    assert.match(
      noLogin.offReason || "",
      /ONEUPTIME_DATA_OBSERVABILITY_DATABASE_USERNAME/,
    );

    assert.strictEqual(
      settingsOf({ ...ON, DATABASE_SYSTEM: "mariadb" }).engine,
      "mysql",
    );
  });

  test("the posture says what is on, and never a login or where the database is", () => {
    const settings: DataObservabilitySettings = settingsOf({
      ...ON,
      ONEUPTIME_DATA_OBSERVABILITY_CHECKS_USERNAME: "do_checks",
      ONEUPTIME_DATA_OBSERVABILITY_CHECKS_PASSWORD: "checks-password",
    });
    const posture: ReturnType<typeof buildPosture> = buildPosture({
      config: parseConfig({
        ONEUPTIME_URL: "https://oneuptime.example",
        ONEUPTIME_TELEMETRY_INGESTION_KEY: "k",
        ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "database",
        DATABASE_SYSTEM: "postgresql",
        DATABASE_SERVER_ADDRESS: "db.example.com",
        DATABASE_SERVER_PORT: "5432",
      }).config,
      resourceType: AiResourceType.DatabaseServer,
      resourceIdentifier: "postgresql://db.example.com:5432",
      probe: normalizeProbe({ reachable: true }),
      dataObservability: getDataObservabilityPosture(settings),
    });
    const serialized: string = JSON.stringify(posture);

    for (const secret of [
      "monitor$user",
      "monitor-pa$word",
      "do_checks",
      "checks-password",
      "db.internal",
    ]) {
      assert.ok(!serialized.includes(secret), `the posture holds ${secret}`);
    }

    // The server reads it back, strictly, as it was meant.
    assert.deepStrictEqual(
      parseResourceAiAgentPosture(JSON.parse(serialized))?.dataObservability,
      {
        isOn: true,
        setting: "true",
        offReason: null,
        engine: "postgresql",
        runsChecks: true,
        runsCustomSql: false,
        workVersion: DATABASE_AGENT_WORK_VERSION,
      },
    );
  });
});

const STORE_ID: string = "22222222-2222-4222-8222-222222222222";

function checkOf(
  fields: Partial<DatabaseAgentCheck> & {
    checkId: string;
    type: DataCheckType;
  },
): DatabaseAgentCheck {
  return {
    schemaName: "public",
    tableName: "orders",
    columnName: null,
    segmentColumn: null,
    acceptedValues: null,
    pattern: null,
    referenceSchemaName: null,
    referenceTableName: null,
    referenceColumnName: null,
    customSql: null,
    samplePercent: null,
    ...fields,
  };
}

function workOf(fields: Partial<DatabaseAgentWork> = {}): DatabaseAgentWork {
  return {
    dataStoreId: STORE_ID,
    engine: "postgresql",
    databaseName: "orders_db",
    maxTables: 5000,
    maxColumns: 200000,
    exclusions: [],
    checks: [],
    freshnessReads: [],
    waitWhenBusy: false,
    readsViewLineage: false,
    ...fields,
  };
}

// A PostgreSQL catalog of one table, orders(id, status), and one number per check.
function postgresResponder(sql: string): Array<SqlRow> {
  if (
    sql.startsWith(
      "SELECT n.nspname AS table_schema, c.relname AS table_name, c.relkind",
    )
  ) {
    return [
      {
        table_schema: "public",
        table_name: "orders",
        relkind: "r",
        estimated_rows: "5",
        size_bytes: "8192",
        write_count: "12",
        read_count: "3",
      },
    ];
  }

  if (sql === POSTGRES_RECOVERY_SQL) {
    return [{ in_recovery: false }];
  }

  if (sql === POSTGRES_STATS_RESET_SQL) {
    return [{ seconds: "3600" }];
  }

  if (sql === POSTGRES_COLUMNS_SQL) {
    return [
      {
        table_schema: "public",
        table_name: "orders",
        column_name: "id",
        data_type: "integer",
        is_nullable: false,
        ordinal_position: 1,
      },
      {
        table_schema: "public",
        table_name: "orders",
        column_name: "status",
        data_type: "text",
        is_nullable: true,
        ordinal_position: 2,
      },
    ];
  }

  if (sql.startsWith("SELECT ") && sql.includes(" AS value FROM ")) {
    return [{ value: "7" }];
  }

  return [];
}

describe("Data Observability on a Database Agent: one collection, over scripted drivers", () => {
  test("every statement is one of the agent's own shapes, each in a read-only transaction rolled back", async () => {
    const connection: FakeSqlConnection = new FakeSqlConnection(
      postgresResponder,
    );
    const drivers: FakeDrivers = new FakeDrivers(connection);
    const report: DatabaseAgentReport = await collectDatabase({
      work: workOf({
        checks: [
          checkOf({
            checkId: "00000000-0000-4000-8000-000000000001",
            type: DataCheckType.NullPercent,
            columnName: "status",
          }),
        ],
        readsViewLineage: true,
      }),
      settings: settingsOf(ON),
      drivers,
      target: { host: "db.example.com", port: 5432 },
    });

    assert.strictEqual(report.error, undefined, report.error || "");
    assert.strictEqual(report.snapshot?.tables[0]?.name, "orders");
    assert.deepStrictEqual(report.snapshot?.checkResults, [
      {
        checkId: "00000000-0000-4000-8000-000000000001",
        values: [{ segment: null, value: 7 }],
        error: null,
      },
    ]);

    const statements: Array<string> = connection.statements();
    const reads: Array<string> = statements.filter((sql: string): boolean => {
      return (
        sql !== "BEGIN READ ONLY" &&
        sql !== "ROLLBACK" &&
        !sql.startsWith("SELECT set_config('statement_timeout'")
      );
    });

    assert.deepStrictEqual(reads, [
      getPostgresTablesSql(true),
      POSTGRES_RECOVERY_SQL,
      POSTGRES_STATS_RESET_SQL,
      POSTGRES_COLUMNS_SQL,
      POSTGRES_VIEW_LINEAGE_SQL,
      'SELECT 100.0 * SUM(CASE WHEN "status" IS NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) AS value FROM "public"."orders"',
    ]);

    // Each read inside BEGIN READ ONLY, its time limits bound, then rolled back.
    for (const read of reads) {
      const at: number = statements.indexOf(read);

      assert.strictEqual(statements[at - 2], "BEGIN READ ONLY");
      assert.match(
        statements[at - 1] || "",
        /^SELECT set_config\('statement_timeout', \$1, true\)/,
      );
      assert.strictEqual(statements[at + 1], "ROLLBACK");
    }

    const limits: { sql: string; params: Array<unknown> } | undefined =
      connection.queries.find((query: { sql: string }): boolean => {
        return query.sql.startsWith("SELECT set_config('statement_timeout'");
      });

    assert.deepStrictEqual(limits?.params, ["30000", "5000"]);
    assert.strictEqual(connection.state.closed, true);

    // One connection, to the database named, as the catalog login.
    assert.strictEqual(drivers.connects.length, 1);
    assert.strictEqual(drivers.connects[0]!.options.database, "orders_db");
    assert.strictEqual(drivers.connects[0]!.options.username, "monitor$user");
    assert.strictEqual(
      drivers.connects[0]!.options.applicationName,
      "OneUptime Data Observability",
    );
  });

  test("the checks connect with a login of their own when they have one", async () => {
    const drivers: FakeDrivers = new FakeDrivers(
      new FakeSqlConnection(postgresResponder),
    );

    await collectDatabase({
      work: workOf({
        checks: [
          checkOf({
            checkId: "00000000-0000-4000-8000-000000000002",
            type: DataCheckType.RowCount,
          }),
        ],
      }),
      settings: settingsOf({
        ...ON,
        ONEUPTIME_DATA_OBSERVABILITY_CHECKS_USERNAME: "do_checks",
        ONEUPTIME_DATA_OBSERVABILITY_CHECKS_PASSWORD: "checks-password",
      }),
      drivers,
      target: { host: null, port: null },
    });

    assert.deepStrictEqual(
      drivers.connects.map((connect: { options: { username: string } }) => {
        return connect.options.username;
      }),
      ["monitor$user", "do_checks"],
    );
  });

  test("a check that names what the catalog lacks sends nothing, and Custom SQL waits for its owner", async () => {
    const connection: FakeSqlConnection = new FakeSqlConnection(
      postgresResponder,
    );
    const report: DatabaseAgentReport = await collectDatabase({
      work: workOf({
        checks: [
          checkOf({
            checkId: "00000000-0000-4000-8000-000000000003",
            type: DataCheckType.NullPercent,
            columnName: 'status"; DELETE FROM orders; --',
          }),
          checkOf({
            checkId: "00000000-0000-4000-8000-000000000004",
            type: DataCheckType.CustomSql,
            customSql: "SELECT 1",
          }),
          checkOf({
            checkId: "00000000-0000-4000-8000-000000000005",
            type: DataCheckType.RowCount,
            schemaName: "pg_catalog",
            tableName: "pg_authid",
          }),
        ],
      }),
      settings: settingsOf(ON),
      drivers: new FakeDrivers(connection),
      target: { host: null, port: null },
    });

    const errors: Array<string | null> = (
      report.snapshot?.checkResults || []
    ).map((result: { error: string | null }) => {
      return result.error;
    });

    assert.match(
      errors[0] || "",
      /is not in public\.orders as the Database Agent read it/,
    );
    assert.strictEqual(errors[1], CUSTOM_SQL_OFF_REFUSAL);
    assert.match(
      errors[2] || "",
      /pg_catalog\.pg_authid is not in this database's catalog/,
    );

    for (const sql of connection.statements()) {
      assert.ok(!sql.includes("DELETE"), sql);
      assert.ok(!sql.includes("pg_authid"), sql);
      assert.ok(!sql.includes("SELECT 1"), sql);
    }
  });

  test("checks its owner turned off are each said so, and the catalog is still read", async () => {
    const report: DatabaseAgentReport = await collectDatabase({
      work: workOf({
        checks: [
          checkOf({
            checkId: "00000000-0000-4000-8000-000000000006",
            type: DataCheckType.RowCount,
          }),
        ],
      }),
      settings: settingsOf({
        ...ON,
        ONEUPTIME_DATA_OBSERVABILITY_CHECKS: "false",
      }),
      drivers: new FakeDrivers(new FakeSqlConnection(postgresResponder)),
      target: { host: null, port: null },
    });

    assert.strictEqual(report.snapshot?.tables.length, 1);
    assert.strictEqual(
      report.snapshot?.checkResults?.[0]?.error,
      CHECKS_OFF_REFUSAL,
    );
  });

  test("MySQL: a read-only session with time limits, the database named, and each read in START TRANSACTION READ ONLY", async () => {
    const connection: FakeSqlConnection = new FakeSqlConnection(
      (sql: string): Array<SqlRow> => {
        if (sql === MYSQL_TABLES_SQL) {
          return [
            {
              table_schema: "shop",
              table_name: "orders",
              table_type: "BASE TABLE",
              estimated_rows: "5",
              size_bytes: "16384",
              seconds_since_change: "60",
            },
          ];
        }

        return [];
      },
    );
    const drivers: FakeDrivers = new FakeDrivers(connection);
    const report: DatabaseAgentReport = await collectDatabase({
      work: workOf({ engine: "mysql", databaseName: "shop" }),
      settings: settingsOf({ ...ON, DATABASE_SYSTEM: "mysql" }),
      drivers,
      target: { host: null, port: null },
    });

    assert.strictEqual(report.error, undefined, report.error || "");
    assert.strictEqual(drivers.connects[0]!.engine, "mysql");
    assert.strictEqual(drivers.connects[0]!.options.mysqlDatabase, "shop");

    const statements: Array<string> = connection.statements();

    assert.deepStrictEqual(statements.slice(0, 4), [
      "SET SESSION TRANSACTION READ ONLY",
      "SET SESSION lock_wait_timeout = ?",
      "SET SESSION MAX_EXECUTION_TIME = ?",
      "SET SESSION information_schema_stats_expiry = 0",
    ]);
    assert.deepStrictEqual(
      statements.filter((sql: string): boolean => {
        return (
          !sql.startsWith("SET SESSION") &&
          sql !== "START TRANSACTION READ ONLY" &&
          sql !== "ROLLBACK"
        );
      }),
      [
        MYSQL_TABLES_SQL,
        MYSQL_COUNTERS_SQL,
        MYSQL_UPTIME_SQL,
        MYSQL_COLUMNS_SQL,
      ],
    );
  });

  test("a work item for another engine is refused, and an agent that is off reads nothing", async () => {
    const drivers: FakeDrivers = new FakeDrivers();
    const mismatch: DatabaseAgentReport = await collectDatabase({
      work: workOf({ engine: "mysql" }),
      settings: settingsOf(ON),
      drivers,
      target: { host: null, port: null },
    });

    assert.match(mismatch.error || "", /reads PostgreSQL databases/);

    const off: DatabaseAgentReport = await collectDatabase({
      work: workOf(),
      settings: settingsOf({}),
      drivers,
      target: { host: null, port: null },
    });

    assert.match(off.error || "", /ONEUPTIME_DATA_OBSERVABILITY=true/);
    assert.strictEqual(drivers.connects.length, 0);
  });

  test("a password in a driver's message is masked before it is reported", async () => {
    const drivers: FakeDrivers = new FakeDrivers();

    drivers.connectAnswer = (): Error => {
      return new Error(
        "connect failed for monitor$user with password monitor-pa$word",
      );
    };

    const report: DatabaseAgentReport = await collectDatabase({
      work: workOf(),
      settings: settingsOf(ON),
      drivers,
      target: { host: null, port: null },
    });

    assert.ok(report.error);
    assert.ok(!report.error.includes("monitor-pa$word"), report.error);
    assert.match(report.error, /\[redacted\]/);
    assert.strictEqual(maskSecrets("abc", ["ab"], 100), "abc");
  });
});

describe("Data Observability on a Database Agent: the loop", () => {
  const server: FakeOneUptime = new FakeOneUptime();
  const session: AgentSession = {
    getIdentity: () => {
      return {
        agentId: "agent-1",
        agentKey: "key-1",
        resourceId: null,
        resourceName: null,
      };
    },
  } as unknown as AgentSession;
  const quiet: never = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  } as never;

  before(async () => {
    await server.start();
  });

  after(async () => {
    await server.stop();
  });

  function collectorOf(env: NodeJS.ProcessEnv): DataObservabilityCollector {
    return new DataObservabilityCollector({
      env,
      client: new IngestClient({ oneuptimeUrl: server.url, apiKey: "k" }),
      session,
      logger: quiet,
      drivers: new FakeDrivers(new FakeSqlConnection(postgresResponder)),
    });
  }

  test("an agent that is off asks OneUptime for nothing", async () => {
    server.reset();
    await collectorOf(BASE_ENV).tick();
    assert.strictEqual(server.requestsTo("/data-observability/work").length, 0);
  });

  test("asks with its id and key, reads each database handed out, and reports each", async () => {
    server.reset();
    server.setDefault("/data-observability/work", {
      json: {
        stores: [
          workOf(),
          // Malformed: no work, and never read.
          { dataStoreId: "not-an-id", engine: "postgresql", databaseName: "x" },
          workOf({
            dataStoreId: "33333333-3333-4333-8333-333333333333",
            databaseName: "../etc",
          }),
        ],
      },
    });
    server.setDefault("/data-observability/result", {
      json: { accepted: true },
    });

    await collectorOf({ ...BASE_ENV, ...ON }).tick();

    const reported: Array<{ body: Record<string, unknown> }> =
      server.requestsTo("/data-observability/result");

    assert.strictEqual(reported.length, 1);
    assert.strictEqual(reported[0]!.body["agentId"], "agent-1");
    assert.strictEqual(reported[0]!.body["agentKey"], "key-1");
    assert.strictEqual(reported[0]!.body["dataStoreId"], STORE_ID);
    assert.ok(reported[0]!.body["snapshot"]);
  });

  test("a OneUptime without the conversation is asked again only after a while", async () => {
    server.reset();
    server.setDefault("/data-observability/work", {
      status: 404,
      json: { message: "Not found" },
    });

    const collector: DataObservabilityCollector = collectorOf({
      ...BASE_ENV,
      ...ON,
    });

    await collector.tick();
    await collector.tick();

    assert.strictEqual(server.requestsTo("/data-observability/work").length, 1);
    assert.ok(API_MISSING_RETRY_MS >= 60_000);
  });
});
