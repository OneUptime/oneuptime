import "./Helpers/TestSupport";
import assert from "assert";
import { after, before, describe, test } from "node:test";
import { Client as PgClient } from "pg";
import mysql from "mysql2/promise";
import { NODE_DATABASE_DRIVERS } from "../Executors/Database/DatabaseDrivers";
import IngestClient from "../IngestClient";
import { AgentSession } from "../Registration";
import DataObservabilityCollector from "../DataObservability/DataObservabilityCollector";
import {
  DataObservabilitySettings,
  resolveDataObservabilitySettings,
} from "../DataObservability/DataObservabilitySettings";
import {
  MySqlReadOnlySession,
  PostgresReadOnlySession,
  ReadOnlySession,
  collectDatabase,
  openReadOnlySession,
} from "../DataObservability/DataObservabilityReader";
import FakeOneUptime from "./Helpers/FakeOneUptime";
import {
  DatabaseAgentCheck,
  DatabaseAgentCheckResult,
  DatabaseAgentEngine,
  DatabaseAgentReport,
  DatabaseAgentSnapshot,
  DatabaseAgentTable,
  DatabaseAgentWork,
} from "../Common/Utils/DataObservability/DatabaseAgent/DatabaseAgentWork";
import { CUSTOM_SQL_OFF_REFUSAL } from "../Common/Utils/DataObservability/DatabaseAgent/DatabaseAgentStatements";
import { DataCheckType } from "../Common/Types/DataObservability/DataCheckType";
import DataAssetKind from "../Common/Types/DataObservability/DataAssetKind";

/*
 * A DATABASE AGENT READING REAL DATABASES FOR DATA OBSERVABILITY (#11148).
 *
 * Each engine is seeded with small tables whose answers are known, and read
 * through the agent's own reader with two logins of the least privilege the
 * docs tell a customer to make: one that may read the catalog and nothing
 * of the rows, and one that may also SELECT the checked tables. What this
 * holds, against PostgreSQL, MySQL and MariaDB:
 *
 *   - the catalog - tables, views, columns, row counts, view lineage - comes
 *     back with the catalog login alone, which cannot read a row;
 *   - every kind of check comes back with the number the data says, over
 *     the checks login: separate credentials per capability;
 *   - a check naming a table or column the catalog does not have, a name
 *     written to break out of its quotes, or a table the catalog leaves out
 *     (pg_catalog's), is refused on the agent, and nothing runs for it;
 *   - Custom SQL is refused until the agent's owner allows it, and then a
 *     query that writes - even one that reads like a SELECT, as nextval()
 *     does - is stopped by the read-only transaction;
 *   - nothing reported holds a password, a wrong one included;
 *   - the loop asks a OneUptime for work and reports with the agent's id and
 *     key, carrying no login.
 *
 * Skipped unless asked for, because CI has no database servers:
 *
 *   docker run -d --name <yours>-pg -e POSTGRES_PASSWORD='<pw>' -p 127.0.0.1:15148:5432 postgres:16
 *   docker run -d --name <yours>-mysql -e MYSQL_ROOT_PASSWORD='<pw>' -p 127.0.0.1:13148:3306 mysql:8.4
 *   docker run -d --name <yours>-mariadb -e MARIADB_ROOT_PASSWORD='<pw>' -p 127.0.0.1:13149:3306 mariadb:11
 *
 *   TZ=UTC RUN_DATA_OBSERVABILITY_AGENT_LIVE_TESTS=true \
 *   DATA_OBSERVABILITY_AGENT_LIVE_PASSWORD='<pw>' \
 *   DATA_OBSERVABILITY_AGENT_LIVE_POSTGRES_PORT=15148 \
 *   DATA_OBSERVABILITY_AGENT_LIVE_MYSQL_PORT=13148 \
 *   DATA_OBSERVABILITY_AGENT_LIVE_MARIADB_PORT=13149 \
 *   npm test
 *
 * An engine whose port is not given is skipped. The tests make their own
 * database and logins, and drop them first when an earlier run left them.
 */

const LIVE: boolean =
  process.env["RUN_DATA_OBSERVABILITY_AGENT_LIVE_TESTS"] === "true";
const ADMIN_PASSWORD: string =
  process.env["DATA_OBSERVABILITY_AGENT_LIVE_PASSWORD"] || "";
const HOST: string =
  process.env["DATA_OBSERVABILITY_AGENT_LIVE_HOST"] || "127.0.0.1";

// The two logins' passwords: long enough to be masked, never reported.
const CATALOG_PASSWORD: string = "Catalog-Pw-11148";
const CHECKS_PASSWORD: string = "Checks-Pw-11148";
const DATABASE: string = "oneuptime_agent_live";

const CHECK_IDS: Record<string, string> = {
  rowCount: "00000000-0000-4000-8000-000000000001",
  rowsByStatus: "00000000-0000-4000-8000-000000000002",
  nullPercent: "00000000-0000-4000-8000-000000000003",
  duplicatePercent: "00000000-0000-4000-8000-000000000004",
  distinctCount: "00000000-0000-4000-8000-000000000005",
  minimum: "00000000-0000-4000-8000-000000000006",
  maximum: "00000000-0000-4000-8000-000000000007",
  average: "00000000-0000-4000-8000-000000000008",
  sum: "00000000-0000-4000-8000-000000000009",
  invalidPercent: "00000000-0000-4000-8000-000000000010",
  formatMismatch: "00000000-0000-4000-8000-000000000011",
  orphanCount: "00000000-0000-4000-8000-000000000012",
  customSql: "00000000-0000-4000-8000-000000000013",
  failingRows: "00000000-0000-4000-8000-000000000014",
  missingColumn: "00000000-0000-4000-8000-000000000015",
  missingTable: "00000000-0000-4000-8000-000000000016",
  breakOut: "00000000-0000-4000-8000-000000000017",
  systemTable: "00000000-0000-4000-8000-000000000018",
  writingQuery: "00000000-0000-4000-8000-000000000019",
  whoRuns: "00000000-0000-4000-8000-000000000020",
};

const STORE_ID: string = "11111111-1111-4111-8111-111111111111";

interface LiveEngine {
  name: string;
  engine: DatabaseAgentEngine;
  port: number;
  system: string;
  // The tables' schema as the catalog names it.
  schema: string;
  setUp: () => Promise<void>;
  // One statement as the admin, in the test database.
  admin: (sql: string) => Promise<Array<Record<string, unknown>>>;
  tearDown: () => Promise<void>;
}

function portOf(variable: string): number {
  return Number(process.env[variable] || 0);
}

function check(
  id: string,
  type: DataCheckType,
  fields: Partial<DatabaseAgentCheck> & { tableName: string; schemaName: string },
): DatabaseAgentCheck {
  return {
    checkId: id,
    type,
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

function checksFor(live: LiveEngine): Array<DatabaseAgentCheck> {
  const orders: { schemaName: string; tableName: string } = {
    schemaName: live.schema,
    tableName: "orders",
  };
  const customers: { schemaName: string; tableName: string } = {
    schemaName: live.schema,
    tableName: "customers",
  };
  const userFunction: string =
    live.engine === "postgresql" ? "current_user" : "SUBSTRING_INDEX(CURRENT_USER(), '@', 1)";

  return [
    check(CHECK_IDS["rowCount"]!, DataCheckType.RowCount, orders),
    check(CHECK_IDS["rowsByStatus"]!, DataCheckType.RowCount, {
      ...orders,
      segmentColumn: "status",
    }),
    check(CHECK_IDS["nullPercent"]!, DataCheckType.NullPercent, {
      ...orders,
      columnName: "customer_id",
    }),
    check(CHECK_IDS["duplicatePercent"]!, DataCheckType.DuplicatePercent, {
      ...orders,
      columnName: "customer_id",
    }),
    check(CHECK_IDS["distinctCount"]!, DataCheckType.DistinctCount, {
      ...orders,
      columnName: "status",
    }),
    check(CHECK_IDS["minimum"]!, DataCheckType.Minimum, {
      ...orders,
      columnName: "amount",
    }),
    check(CHECK_IDS["maximum"]!, DataCheckType.Maximum, {
      ...orders,
      columnName: "amount",
    }),
    check(CHECK_IDS["average"]!, DataCheckType.Average, {
      ...orders,
      columnName: "amount",
    }),
    check(CHECK_IDS["sum"]!, DataCheckType.Sum, {
      ...orders,
      columnName: "amount",
    }),
    check(CHECK_IDS["invalidPercent"]!, DataCheckType.InvalidPercent, {
      ...orders,
      columnName: "status",
      acceptedValues: ["paid", "open"],
    }),
    check(CHECK_IDS["formatMismatch"]!, DataCheckType.FormatMismatchPercent, {
      ...customers,
      columnName: "email",
      pattern: "^[^@]+@[^@]+$",
    }),
    check(CHECK_IDS["orphanCount"]!, DataCheckType.OrphanCount, {
      ...orders,
      columnName: "customer_id",
      referenceSchemaName: live.schema,
      referenceTableName: "customers",
      referenceColumnName: "id",
    }),
    check(CHECK_IDS["customSql"]!, DataCheckType.CustomSql, {
      ...orders,
      customSql: "SELECT COUNT(*) FROM orders WHERE amount > 25",
    }),
    check(CHECK_IDS["failingRows"]!, DataCheckType.FailingRows, {
      ...orders,
      customSql: "SELECT * FROM orders WHERE status = 'refunded'",
    }),
    check(CHECK_IDS["missingColumn"]!, DataCheckType.NullPercent, {
      ...orders,
      columnName: "no_such_column",
    }),
    check(CHECK_IDS["missingTable"]!, DataCheckType.RowCount, {
      schemaName: live.schema,
      tableName: "no_such_table",
    }),
    check(CHECK_IDS["breakOut"]!, DataCheckType.NullPercent, {
      ...orders,
      columnName:
        live.engine === "postgresql"
          ? 'amount"; DROP TABLE orders; --'
          : "amount`; DROP TABLE orders; --",
    }),
    check(CHECK_IDS["systemTable"]!, DataCheckType.RowCount, {
      schemaName: live.engine === "postgresql" ? "pg_catalog" : "mysql",
      tableName: live.engine === "postgresql" ? "pg_authid" : "user",
    }),
    check(CHECK_IDS["writingQuery"]!, DataCheckType.CustomSql, {
      ...orders,
      customSql:
        live.engine === "postgresql"
          ? "SELECT nextval('orders_id_seq')"
          : "SELECT GET_LOCK('oneuptime_live', 0)",
    }),
    check(CHECK_IDS["whoRuns"]!, DataCheckType.CustomSql, {
      ...orders,
      customSql: `SELECT CASE WHEN ${userFunction} = 'do_checks' THEN 1 ELSE 0 END AS checks_login`,
    }),
  ];
}

function workFor(
  live: LiveEngine,
  overrides: Partial<DatabaseAgentWork> = {},
): DatabaseAgentWork {
  return {
    dataStoreId: STORE_ID,
    engine: live.engine,
    databaseName: DATABASE,
    maxTables: 100,
    maxColumns: 1000,
    exclusions: [],
    checks: checksFor(live),
    freshnessReads: [
      {
        tableKey: `${live.schema}.orders`,
        schemaName: live.schema,
        tableName: "orders",
        columnName: "created_at",
      },
    ],
    waitWhenBusy: false,
    readsViewLineage: true,
    ...overrides,
  };
}

function settingsFor(
  live: LiveEngine,
  extra: Record<string, string> = {},
): DataObservabilitySettings {
  return resolveDataObservabilitySettings({
    DATABASE_SYSTEM: live.system,
    DATABASE_ENDPOINT: `${HOST}:${live.port}`,
    DATABASE_TLS_INSECURE: "true",
    ONEUPTIME_DATA_OBSERVABILITY: "true",
    ONEUPTIME_DATA_OBSERVABILITY_DATABASE_USERNAME: "do_catalog",
    ONEUPTIME_DATA_OBSERVABILITY_DATABASE_PASSWORD: CATALOG_PASSWORD,
    ONEUPTIME_DATA_OBSERVABILITY_CHECKS_USERNAME: "do_checks",
    ONEUPTIME_DATA_OBSERVABILITY_CHECKS_PASSWORD: CHECKS_PASSWORD,
    ...extra,
  });
}

async function collect(
  live: LiveEngine,
  settings: DataObservabilitySettings,
  work: DatabaseAgentWork = workFor(live),
): Promise<DatabaseAgentReport> {
  return await collectDatabase({
    work,
    settings,
    drivers: NODE_DATABASE_DRIVERS,
    target: { host: "db.example.internal", port: live.port },
  });
}

function resultOf(
  snapshot: DatabaseAgentSnapshot | undefined,
  checkId: string,
): DatabaseAgentCheckResult {
  const result: DatabaseAgentCheckResult | undefined = (
    snapshot?.checkResults || []
  ).find((candidate: DatabaseAgentCheckResult): boolean => {
    return candidate.checkId === checkId;
  });

  assert.ok(result, `no result for check ${checkId}`);
  return result;
}

function valueOf(snapshot: DatabaseAgentSnapshot | undefined, checkId: string): number {
  const result: DatabaseAgentCheckResult = resultOf(snapshot, checkId);

  assert.strictEqual(result.error, null, `check ${checkId}: ${result.error}`);
  assert.strictEqual(result.values.length, 1);
  return result.values[0]!.value;
}

function tableOf(
  snapshot: DatabaseAgentSnapshot | undefined,
  name: string,
): DatabaseAgentTable {
  const table: DatabaseAgentTable | undefined = (snapshot?.tables || []).find(
    (candidate: DatabaseAgentTable): boolean => {
      return candidate.name === name;
    },
  );

  assert.ok(table, `no table ${name}`);
  return table;
}

// ---- PostgreSQL ----------------------------------------------------------------

async function pgAs(
  port: number,
  database: string,
  work: (client: PgClient) => Promise<Array<Record<string, unknown>>>,
): Promise<Array<Record<string, unknown>>> {
  const client: PgClient = new PgClient({
    host: HOST,
    port,
    user: "postgres",
    password: ADMIN_PASSWORD,
    database,
  });

  await client.connect();

  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

function postgres(): LiveEngine {
  const port: number = portOf("DATA_OBSERVABILITY_AGENT_LIVE_POSTGRES_PORT");
  const admin: (sql: string) => Promise<Array<Record<string, unknown>>> = (
    sql: string,
  ) => {
    return pgAs(port, DATABASE, async (client: PgClient) => {
      return (await client.query(sql)).rows;
    });
  };

  return {
    name: "PostgreSQL",
    engine: "postgresql",
    port,
    system: "postgresql",
    schema: "public",
    admin,
    setUp: async (): Promise<void> => {
      await pgAs(port, "postgres", async (client: PgClient) => {
        await client.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
        await client.query("DROP ROLE IF EXISTS do_catalog");
        await client.query("DROP ROLE IF EXISTS do_checks");
        await client.query(`CREATE DATABASE ${DATABASE}`);
        await client.query(
          `CREATE ROLE do_catalog LOGIN PASSWORD '${CATALOG_PASSWORD}'`,
        );
        await client.query(
          `CREATE ROLE do_checks LOGIN PASSWORD '${CHECKS_PASSWORD}'`,
        );
        return [];
      });
      await admin(`
        REVOKE ALL ON SCHEMA public FROM PUBLIC;
        GRANT CONNECT ON DATABASE ${DATABASE} TO do_catalog, do_checks;
        GRANT USAGE ON SCHEMA public TO do_catalog, do_checks;
        CREATE TABLE customers (id integer PRIMARY KEY, email text NOT NULL);
        CREATE TABLE orders (
          id serial PRIMARY KEY,
          customer_id integer,
          status text NOT NULL,
          amount numeric(10, 2) NOT NULL,
          created_at timestamptz NOT NULL
        );
        CREATE VIEW open_orders AS SELECT id, amount FROM orders WHERE status = 'open';
        CREATE TABLE "odd ""name""" ("odd ""column""" integer);
        INSERT INTO "odd ""name""" VALUES (1), (NULL);
        INSERT INTO customers VALUES (1, 'a@x.io'), (2, 'b@x.io'), (3, 'not-an-email');
        INSERT INTO orders (customer_id, status, amount, created_at) VALUES
          (1, 'paid', 10.00, now() - interval '1 hour'),
          (1, 'paid', 20.00, now() - interval '2 hours'),
          (2, 'open', 30.00, now() - interval '3 hours'),
          (NULL, 'open', 40.00, now() - interval '4 hours'),
          (99, 'refunded', 50.00, now() - interval '5 hours');
        GRANT SELECT ON orders, customers, open_orders, "odd ""name""" TO do_checks;
        GRANT USAGE ON SEQUENCE orders_id_seq TO do_checks;
        ANALYZE;
      `);
    },
    tearDown: async (): Promise<void> => {
      await pgAs(port, "postgres", async (client: PgClient) => {
        await client.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
        await client.query("DROP ROLE IF EXISTS do_catalog");
        await client.query("DROP ROLE IF EXISTS do_checks");
        return [];
      });
    },
  };
}

// ---- MySQL and MariaDB ---------------------------------------------------------

function mysqlLike(data: {
  name: string;
  port: number;
  system: string;
}): LiveEngine {
  const run: (
    sql: string,
    database?: string,
  ) => Promise<Array<Record<string, unknown>>> = async (
    sql: string,
    database?: string,
  ) => {
    const connection: mysql.Connection = await mysql.createConnection({
      host: HOST,
      port: data.port,
      user: "root",
      password: ADMIN_PASSWORD,
      multipleStatements: true,
      ...(database ? { database } : {}),
    });

    try {
      const [rows] = await connection.query(sql);
      return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
    } finally {
      await connection.end();
    }
  };

  return {
    name: data.name,
    engine: "mysql",
    port: data.port,
    system: data.system,
    schema: DATABASE,
    admin: (sql: string) => {
      return run(sql, DATABASE);
    },
    setUp: async (): Promise<void> => {
      await run(`
        DROP DATABASE IF EXISTS ${DATABASE};
        DROP USER IF EXISTS 'do_catalog'@'%';
        DROP USER IF EXISTS 'do_checks'@'%';
        CREATE DATABASE ${DATABASE};
        CREATE USER 'do_catalog'@'%' IDENTIFIED BY '${CATALOG_PASSWORD}';
        CREATE USER 'do_checks'@'%' IDENTIFIED BY '${CHECKS_PASSWORD}';
      `);
      await run(
        `
        CREATE TABLE customers (id INT PRIMARY KEY, email VARCHAR(200) NOT NULL);
        CREATE TABLE orders (
          id INT AUTO_INCREMENT PRIMARY KEY,
          customer_id INT NULL,
          status VARCHAR(20) NOT NULL,
          amount DECIMAL(10, 2) NOT NULL,
          created_at DATETIME NOT NULL
        );
        CREATE VIEW open_orders AS SELECT id, amount FROM orders WHERE status = 'open';
        INSERT INTO customers VALUES (1, 'a@x.io'), (2, 'b@x.io'), (3, 'not-an-email');
        INSERT INTO orders (customer_id, status, amount, created_at) VALUES
          (1, 'paid', 10.00, UTC_TIMESTAMP() - INTERVAL 1 HOUR),
          (1, 'paid', 20.00, UTC_TIMESTAMP() - INTERVAL 2 HOUR),
          (2, 'open', 30.00, UTC_TIMESTAMP() - INTERVAL 3 HOUR),
          (NULL, 'open', 40.00, UTC_TIMESTAMP() - INTERVAL 4 HOUR),
          (99, 'refunded', 50.00, UTC_TIMESTAMP() - INTERVAL 5 HOUR);
        GRANT SHOW VIEW, REFERENCES ON ${DATABASE}.* TO 'do_catalog'@'%', 'do_checks'@'%';
        GRANT SELECT ON ${DATABASE}.orders TO 'do_checks'@'%';
        GRANT SELECT ON ${DATABASE}.customers TO 'do_checks'@'%';
        ANALYZE TABLE orders, customers;
      `,
        DATABASE,
      );
      // MariaDB has no table_io_waits_summary_by_table grant to give when performance_schema is off.
      await run(
        `GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'do_catalog'@'%'`,
      ).catch((): Array<Record<string, unknown>> => {
        return [];
      });
    },
    tearDown: async (): Promise<void> => {
      await run(`
        DROP DATABASE IF EXISTS ${DATABASE};
        DROP USER IF EXISTS 'do_catalog'@'%';
        DROP USER IF EXISTS 'do_checks'@'%';
      `);
    },
  };
}

const ENGINES: Array<LiveEngine> = [
  postgres(),
  mysqlLike({
    name: "MySQL",
    port: portOf("DATA_OBSERVABILITY_AGENT_LIVE_MYSQL_PORT"),
    system: "mysql",
  }),
  mysqlLike({
    name: "MariaDB",
    port: portOf("DATA_OBSERVABILITY_AGENT_LIVE_MARIADB_PORT"),
    system: "mariadb",
  }),
];

for (const live of ENGINES) {
  describe(
    `Data Observability through the Database Agent: ${live.name}`,
    { skip: !LIVE || !live.port },
    () => {
      let report: DatabaseAgentReport;
      let snapshot: DatabaseAgentSnapshot | undefined;

      before(async () => {
        await live.setUp();
        report = await collect(
          live,
          settingsFor(live, {
            ONEUPTIME_DATA_OBSERVABILITY_ALLOW_CUSTOM_SQL: "true",
          }),
        );
        snapshot = report.snapshot;
      });

      after(async () => {
        await live.tearDown();
      });

      test("reads the catalog with a login that cannot read a row", () => {
        assert.strictEqual(report.error, undefined, report.error || "");
        assert.ok(snapshot);
        assert.strictEqual(snapshot.engine, live.engine);
        assert.strictEqual(snapshot.isComplete, true);

        const orders: DatabaseAgentTable = tableOf(snapshot, "orders");
        const view: DatabaseAgentTable = tableOf(snapshot, "open_orders");

        assert.strictEqual(orders.schema, live.schema);
        assert.strictEqual(orders.kind, DataAssetKind.Table);
        assert.strictEqual(view.kind, DataAssetKind.View);
        assert.deepStrictEqual(
          (orders.columns || []).map((column: { name: string }): string => {
            return column.name;
          }),
          ["id", "customer_id", "status", "amount", "created_at"],
        );
        assert.strictEqual(
          (orders.columns || []).find((column: { name: string }) => {
            return column.name === "customer_id";
          })?.isNullable,
          true,
        );
        assert.strictEqual(
          (orders.columns || []).find((column: { name: string }) => {
            return column.name === "status";
          })?.isNullable,
          false,
        );
        assert.ok(
          orders.estimatedRows === null || orders.estimatedRows >= 0,
          "a row estimate, or none",
        );
        // The catalog says the target the way the applications name it.
        assert.deepStrictEqual(snapshot.target, {
          databaseName: DATABASE,
          host: "db.example.internal",
          port: live.port,
        });
      });

      test("says which views read which tables", async (t: {
        skip: (why: string) => void;
      }) => {
        if (live.name === "MariaDB") {
          t.skip("MariaDB keeps no view's tables (VIEW_TABLE_USAGE)");
          return;
        }

        const readsOpenOrders: (
          read: DatabaseAgentSnapshot | undefined,
        ) => boolean = (read: DatabaseAgentSnapshot | undefined): boolean => {
          return (read?.lineage || []).some(
            (edge: { upstreamTable: string; downstreamTable: string }) => {
              return (
                edge.upstreamTable === "orders" &&
                edge.downstreamTable === "open_orders"
              );
            },
          );
        };

        if (live.engine === "postgresql") {
          // pg_depend is every login's to read: the catalog login sees it.
          assert.ok(readsOpenOrders(snapshot), JSON.stringify(snapshot?.lineage));
          return;
        }

        /*
         * MySQL shows a view's tables (VIEW_TABLE_USAGE) only to a login that
         * may SELECT the view: the catalog login sees none until given it.
         */
        assert.strictEqual(readsOpenOrders(snapshot), false);
        assert.strictEqual(snapshot?.isViewLineageComplete, true);

        await live.admin(
          `GRANT SELECT ON ${DATABASE}.open_orders TO 'do_catalog'@'%'`,
        );

        try {
          const withView: DatabaseAgentReport = await collect(
            live,
            settingsFor(live),
          );

          assert.ok(
            readsOpenOrders(withView.snapshot),
            JSON.stringify(withView.snapshot?.lineage),
          );
        } finally {
          await live.admin(
            `REVOKE SELECT ON ${DATABASE}.open_orders FROM 'do_catalog'@'%'`,
          );
        }
      });

      test("runs every kind of check over the checks login, with the number the data says", () => {
        assert.strictEqual(valueOf(snapshot, CHECK_IDS["rowCount"]!), 5);
        assert.strictEqual(valueOf(snapshot, CHECK_IDS["nullPercent"]!), 20);
        assert.strictEqual(
          valueOf(snapshot, CHECK_IDS["duplicatePercent"]!),
          25,
        );
        assert.strictEqual(valueOf(snapshot, CHECK_IDS["distinctCount"]!), 3);
        assert.strictEqual(valueOf(snapshot, CHECK_IDS["minimum"]!), 10);
        assert.strictEqual(valueOf(snapshot, CHECK_IDS["maximum"]!), 50);
        assert.strictEqual(valueOf(snapshot, CHECK_IDS["average"]!), 30);
        assert.strictEqual(valueOf(snapshot, CHECK_IDS["sum"]!), 150);
        assert.strictEqual(valueOf(snapshot, CHECK_IDS["invalidPercent"]!), 20);
        assert.ok(
          Math.abs(valueOf(snapshot, CHECK_IDS["formatMismatch"]!) - 100 / 3) <
            0.01,
        );
        assert.strictEqual(valueOf(snapshot, CHECK_IDS["orphanCount"]!), 1);
        assert.strictEqual(valueOf(snapshot, CHECK_IDS["customSql"]!), 3);
        assert.strictEqual(valueOf(snapshot, CHECK_IDS["failingRows"]!), 1);
        // Run as the checks login, not the catalog's.
        assert.strictEqual(valueOf(snapshot, CHECK_IDS["whoRuns"]!), 1);

        const byStatus: DatabaseAgentCheckResult = resultOf(
          snapshot,
          CHECK_IDS["rowsByStatus"]!,
        );

        assert.strictEqual(byStatus.error, null);
        assert.deepStrictEqual(
          Object.fromEntries(
            byStatus.values.map(
              (value: { segment: string | null; value: number }) => {
                return [value.segment, value.value];
              },
            ),
          ),
          { paid: 2, open: 2, refunded: 1 },
        );
      });

      test("refuses on the agent what the catalog does not have, and runs nothing for it", async () => {
        for (const id of [
          CHECK_IDS["missingColumn"]!,
          CHECK_IDS["missingTable"]!,
          CHECK_IDS["breakOut"]!,
          CHECK_IDS["systemTable"]!,
        ]) {
          const result: DatabaseAgentCheckResult = resultOf(snapshot, id);

          assert.deepStrictEqual(result.values, []);
          assert.match(
            result.error || "",
            /as the Database Agent read it, so the check was not run\./,
          );
        }

        // The table the break-out named is there, untouched.
        const [row] = await live.admin("SELECT COUNT(*) AS rows_left FROM orders");
        assert.strictEqual(Number(row?.["rows_left"]), 5);
      });

      test("a name is data: a table and column named with quotes are read as names", async (t: {
        skip: (why: string) => void;
      }) => {
        if (live.engine !== "postgresql") {
          t.skip("seeded on PostgreSQL");
          return;
        }

        const odd: DatabaseAgentReport = await collect(
          live,
          settingsFor(live),
          workFor(live, {
            checks: [
              check(CHECK_IDS["nullPercent"]!, DataCheckType.NullPercent, {
                schemaName: "public",
                tableName: 'odd "name"',
                columnName: 'odd "column"',
              }),
            ],
            freshnessReads: [],
          }),
        );

        assert.strictEqual(valueOf(odd.snapshot, CHECK_IDS["nullPercent"]!), 50);
      });

      test("the read-only transaction stops a query that writes, even one that reads like a SELECT", async () => {
        const result: DatabaseAgentCheckResult = resultOf(
          snapshot,
          CHECK_IDS["writingQuery"]!,
        );

        if (live.engine === "postgresql") {
          assert.match(
            result.error || "",
            /read-only transaction/,
            "nextval() is refused in a READ ONLY transaction",
          );

          const [sequence] = await live.admin(
            "SELECT last_value FROM orders_id_seq",
          );
          assert.strictEqual(Number(sequence?.["last_value"]), 5);
        } else {
          // GET_LOCK writes nothing; it runs, and its session is gone with the connection.
          assert.strictEqual(result.error, null);
        }

        // Even a login that may write cannot through the agent's session.
        const session: ReadOnlySession = await openReadOnlySession({
          drivers: NODE_DATABASE_DRIVERS,
          engine: live.engine,
          database: settingsFor(live).database!,
          login: {
            username: live.engine === "postgresql" ? "postgres" : "root",
            password: ADMIN_PASSWORD,
            source: "test",
          },
          databaseName: DATABASE,
        });

        assert.ok(
          session instanceof
            (live.engine === "postgresql"
              ? PostgresReadOnlySession
              : MySqlReadOnlySession),
        );

        try {
          await assert.rejects(
            session.rows(
              "INSERT INTO customers (id, email) VALUES (4, 'd@x.io')",
            ),
            /cannot execute INSERT in a read-only transaction|Cannot execute statement in a READ ONLY transaction/,
          );
          await assert.rejects(
            session.rows("DROP TABLE customers"),
            /cannot execute DROP TABLE in a read-only transaction|Cannot execute statement in a READ ONLY transaction/,
          );
        } finally {
          await session.close();
        }

        const [count] = await live.admin("SELECT COUNT(*) AS customers FROM customers");
        assert.strictEqual(Number(count?.["customers"]), 3);
      });

      test("runs no Custom SQL until the agent's owner allows it", async () => {
        const off: DatabaseAgentReport = await collect(live, settingsFor(live));

        for (const id of [CHECK_IDS["customSql"]!, CHECK_IDS["failingRows"]!]) {
          const result: DatabaseAgentCheckResult = resultOf(off.snapshot, id);

          assert.strictEqual(result.error, CUSTOM_SQL_OFF_REFUSAL);
          assert.deepStrictEqual(result.values, []);
        }

        // Every other type still runs.
        assert.strictEqual(valueOf(off.snapshot, CHECK_IDS["rowCount"]!), 5);
      });

      test("the catalog login alone reads the catalog, and its checks fail on the rows it may not read", async () => {
        const catalogOnly: DatabaseAgentReport = await collect(
          live,
          resolveDataObservabilitySettings({
            DATABASE_SYSTEM: live.system,
            DATABASE_ENDPOINT: `${HOST}:${live.port}`,
            ONEUPTIME_DATA_OBSERVABILITY: "true",
            ONEUPTIME_DATA_OBSERVABILITY_DATABASE_USERNAME: "do_catalog",
            ONEUPTIME_DATA_OBSERVABILITY_DATABASE_PASSWORD: CATALOG_PASSWORD,
          }),
        );

        assert.strictEqual(catalogOnly.error, undefined);
        assert.ok(tableOf(catalogOnly.snapshot, "orders"));

        const rowCount: DatabaseAgentCheckResult = resultOf(
          catalogOnly.snapshot,
          CHECK_IDS["rowCount"]!,
        );

        assert.deepStrictEqual(rowCount.values, []);
        assert.match(rowCount.error || "", /denied/i);
      });

      test("reads a table's freshness column, as the age of its newest value", () => {
        const orders: DatabaseAgentTable = tableOf(snapshot, "orders");

        assert.strictEqual(orders.isChangeTimeFromData, true);
        assert.ok(
          orders.secondsSinceChange !== null &&
            Math.abs(orders.secondsSinceChange - 3600) < 300,
          `about an hour, read ${orders.secondsSinceChange}`,
        );
      });

      test("leaves excluded tables out, and refuses the checks that read them", async () => {
        const excluded: DatabaseAgentReport = await collect(
          live,
          settingsFor(live),
          workFor(live, { exclusions: ["customers"], freshnessReads: [] }),
        );

        assert.ok(
          !(excluded.snapshot?.tables || []).some((table: DatabaseAgentTable) => {
            return table.name === "customers";
          }),
        );
        assert.match(
          resultOf(excluded.snapshot, CHECK_IDS["formatMismatch"]!).error || "",
          /customers is not in this database's catalog/,
        );
        assert.match(
          resultOf(excluded.snapshot, CHECK_IDS["orphanCount"]!).error || "",
          /customers is not in this database's catalog/,
        );
      });

      test("reports no password, and none from a wrong one", async () => {
        assert.ok(!JSON.stringify(report).includes(CATALOG_PASSWORD));
        assert.ok(!JSON.stringify(report).includes(CHECKS_PASSWORD));

        const wrong: DatabaseAgentReport = await collect(
          live,
          resolveDataObservabilitySettings({
            DATABASE_SYSTEM: live.system,
            DATABASE_ENDPOINT: `${HOST}:${live.port}`,
            ONEUPTIME_DATA_OBSERVABILITY: "true",
            ONEUPTIME_DATA_OBSERVABILITY_DATABASE_USERNAME: "do_catalog",
            ONEUPTIME_DATA_OBSERVABILITY_DATABASE_PASSWORD: "Wrong-Pw-11148",
          }),
        );

        assert.ok(wrong.error, "a refused login is the report's error");
        assert.strictEqual(wrong.snapshot, undefined);
        assert.ok(!JSON.stringify(wrong).includes("Wrong-Pw-11148"));
      });

      test("asks a OneUptime for work and reports with the agent's id and key, carrying no login", async () => {
        const server: FakeOneUptime = new FakeOneUptime();

        await server.start();

        try {
          server.setDefault("/data-observability/work", {
            json: {
              stores: [
                {
                  ...workFor(live, {
                    checks: checksFor(live).slice(0, 2),
                    freshnessReads: [],
                  }),
                  // What an older or a hostile server might add: never read.
                  connectionString: "postgres://stolen:secret@elsewhere/db",
                  sql: "DROP TABLE orders",
                },
              ],
            },
          });
          server.setDefault("/data-observability/result", {
            json: { accepted: true },
          });

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
          const collector: DataObservabilityCollector =
            new DataObservabilityCollector({
              env: {
                DATABASE_SYSTEM: live.system,
                DATABASE_ENDPOINT: `${HOST}:${live.port}`,
                DATABASE_SERVER_ADDRESS: "db.example.internal",
                DATABASE_SERVER_PORT: String(live.port),
                ONEUPTIME_DATA_OBSERVABILITY: "true",
                ONEUPTIME_DATA_OBSERVABILITY_DATABASE_USERNAME: "do_catalog",
                ONEUPTIME_DATA_OBSERVABILITY_DATABASE_PASSWORD:
                  CATALOG_PASSWORD,
                ONEUPTIME_DATA_OBSERVABILITY_CHECKS_USERNAME: "do_checks",
                ONEUPTIME_DATA_OBSERVABILITY_CHECKS_PASSWORD: CHECKS_PASSWORD,
              },
              client: new IngestClient({
                oneuptimeUrl: server.url,
                apiKey: "ingestion-key",
              }),
              session,
              logger: {
                debug: () => {},
                info: () => {},
                warn: () => {},
                error: () => {},
              } as never,
            });

          await collector.tick();

          const asked: Array<{ body: Record<string, unknown> }> =
            server.requestsTo("/data-observability/work");
          const reported: Array<{ body: Record<string, unknown>; rawBody: string }> =
            server.requestsTo("/data-observability/result");

          assert.strictEqual(asked.length, 1);
          assert.deepStrictEqual(asked[0]!.body, {
            agentId: "agent-1",
            agentKey: "key-1",
          });
          assert.strictEqual(reported.length, 1);
          assert.strictEqual(reported[0]!.body["agentId"], "agent-1");
          assert.strictEqual(reported[0]!.body["dataStoreId"], STORE_ID);

          const sent: DatabaseAgentSnapshot = reported[0]!.body[
            "snapshot"
          ] as unknown as DatabaseAgentSnapshot;

          assert.ok(tableOf(sent, "orders"));
          assert.strictEqual(valueOf(sent, CHECK_IDS["rowCount"]!), 5);

          for (const secret of [
            CATALOG_PASSWORD,
            CHECKS_PASSWORD,
            "ingestion-key",
            "do_catalog",
            "do_checks",
          ]) {
            assert.ok(
              !reported[0]!.rawBody.includes(secret),
              `the report holds ${secret}`,
            );
          }

          // The orders table is still there: what the server slipped in was never run.
          const [row] = await live.admin("SELECT COUNT(*) AS rows_left FROM orders");
          assert.strictEqual(Number(row?.["rows_left"]), 5);
        } finally {
          await server.stop();
        }
      });
    },
  );
}
