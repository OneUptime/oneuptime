import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import http from "http";
import { MongoClient, ObjectId } from "mongodb";
import * as mssql from "mssql";
import { createConnection as createMySqlConnection } from "mysql2/promise";
import oracledb from "oracledb";
import { Client as PostgresClient } from "pg";
import {
  DataCheckTarget,
  buildDataCheckSampleStatement,
  buildDataCheckStatement,
  buildFreshnessStatement,
} from "../../../../Server/Utils/DataObservability/DataCheckSql";
import {
  DataCheckRunResult,
  PlannedDataCheck,
} from "../../../../Server/Utils/DataObservability/DataCheckResults";
import { buildMongoCheckStatement } from "../../../../Server/Utils/DataObservability/MongoDbChecks";
import {
  CollectedTable,
  TableHealthCollectOptions,
  TableHealthSnapshot,
  collectTableHealth,
  isDatabaseBusy,
} from "../../../../Server/Utils/DataObservability/TableHealthCollector";
import DataSourceEgressGuard from "../../../../Server/Utils/DataSource/EgressGuard";
import { DatabaseEngine } from "../../../../Server/Utils/DataSecurity/Content/DatabaseSampler";
import { DataCheckType } from "../../../../Types/DataObservability/DataCheckType";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";

/*
 * EVERY ENGINE AGAINST A REAL SERVER - the check the unit tests cannot make.
 *
 * Each engine is seeded with the same small tables whose answers are known,
 * and read twice with the login Connect a Database tells a customer to make:
 * once with only the grants that page lists, which must read the catalog,
 * and once more with SELECT on the checked tables, when every kind of check
 * must come back with the number the data says. Skipped unless asked for,
 * because CI has no database servers:
 *
 *   docker run -d -e POSTGRES_PASSWORD='<pw>' -p 25432:5432 postgres:16
 *   docker run -d -e MYSQL_ROOT_PASSWORD='<pw>' -p 23306:3306 mysql:8.4
 *   docker run -d -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD='<pw>' -p 21433:1433 \
 *     mcr.microsoft.com/mssql/server:2022-latest
 *   docker run -d -e CLICKHOUSE_PASSWORD='<pw>' \
 *     -e CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 -p 28123:8123 \
 *     clickhouse/clickhouse-server:26.7
 *   docker run -d -e MONGO_INITDB_ROOT_USERNAME=root \
 *     -e MONGO_INITDB_ROOT_PASSWORD='<pw>' -p 27117:27017 mongo:8
 *   docker run -d -e ORACLE_PASSWORD='<pw>' -p 21521:1521 \
 *     gvenzl/oracle-free:23-slim
 *
 *   RUN_DATA_OBSERVABILITY_LIVE_TESTS=true DATA_OBSERVABILITY_LIVE_PASSWORD='<pw>' \
 *   DATA_OBSERVABILITY_LIVE_CLICKHOUSE_HOST="$(ipconfig getifaddr en0)" \
 *   npx jest --config jest.live.config.js
 *
 * DATA_OBSERVABILITY_LIVE_ENGINES narrows the run, such as "mongodb,oracle".
 * The tests make their own database and login and drop them first when an
 * earlier run left them.
 */

const LIVE: boolean =
  process.env["RUN_DATA_OBSERVABILITY_LIVE_TESTS"] === "true";
const PASSWORD: string = process.env["DATA_OBSERVABILITY_LIVE_PASSWORD"] || "";
const HOST: string = process.env["DATA_OBSERVABILITY_LIVE_HOST"] || "127.0.0.1";
/*
 * ClickHouse is read over HTTP, through the guard that refuses a loopback
 * address: give this machine's own address on its network.
 */
const CLICKHOUSE_HOST: string =
  process.env["DATA_OBSERVABILITY_LIVE_CLICKHOUSE_HOST"] || HOST;

/*
 * Where this machine cannot reach its own network address, the server is read
 * over loopback with the guard stood aside: this test is of the engine, and the
 * guard has tests of its own.
 */
const ALLOW_LOOPBACK: boolean =
  process.env["DATA_OBSERVABILITY_LIVE_ALLOW_LOOPBACK"] === "true";
const READER_PASSWORD: string = `${PASSWORD}Rd1`;
const DUMP_DIRECTORY: string =
  process.env["DATA_OBSERVABILITY_LIVE_DUMP"] || "";
const ONLY: Array<string> = (
  process.env["DATA_OBSERVABILITY_LIVE_ENGINES"] || ""
)
  .split(",")
  .map((engine: string): string => {
    return engine.trim();
  })
  .filter(Boolean);

function isRunning(engine: DatabaseEngine): boolean {
  return LIVE && (ONLY.length === 0 || ONLY.includes(engine));
}

const COLLECT: TableHealthCollectOptions = {
  maxTables: 100,
  maxColumns: 1000,
  exclusions: [],
  queryHistoryLookbackInSeconds: 3600,
};

// Every server starts slowly on a busy machine, and Oracle slowly on any.
const SLOW_IN_MS: number = 5 * 60 * 1000;

interface LiveEngine {
  engine: DatabaseEngine;
  schema: string;
  // A name as this engine keeps it: Oracle upper-cases what it is not told to quote.
  name: (value: string) => string;
  customCheck: string;
  connection: string;
  skips?: Array<string>;
}

interface PlannedCheck {
  checkId: string;
  target: DataCheckTarget;
  expected: number | Record<string, number>;
}

function planChecks(live: LiveEngine): Array<PlannedCheck> {
  const orders: Pick<DataCheckTarget, "schemaName" | "tableName"> = {
    schemaName: live.schema,
    tableName: live.name("orders"),
  };
  const customers: Pick<DataCheckTarget, "schemaName" | "tableName"> = {
    schemaName: live.schema,
    tableName: live.name("customers"),
  };
  const checks: Array<PlannedCheck> = [
    {
      checkId: "rows",
      target: { type: DataCheckType.RowCount, ...orders },
      expected: 6,
    },
    {
      checkId: "nulls",
      target: {
        type: DataCheckType.NullPercent,
        ...customers,
        columnName: live.name("email"),
      },
      expected: 20,
    },
    {
      checkId: "distinct",
      target: {
        type: DataCheckType.DistinctCount,
        ...customers,
        columnName: live.name("email"),
      },
      expected: 3,
    },
    {
      checkId: "duplicates",
      target: {
        type: DataCheckType.DuplicatePercent,
        ...customers,
        columnName: live.name("email"),
      },
      expected: 25,
    },
    {
      checkId: "minimum",
      target: {
        type: DataCheckType.Minimum,
        ...orders,
        columnName: live.name("total"),
      },
      expected: 10,
    },
    {
      checkId: "maximum",
      target: {
        type: DataCheckType.Maximum,
        ...orders,
        columnName: live.name("total"),
      },
      expected: 50,
    },
    {
      checkId: "average",
      target: {
        type: DataCheckType.Average,
        ...orders,
        columnName: live.name("total"),
      },
      expected: 30,
    },
    {
      checkId: "sum",
      target: {
        type: DataCheckType.Sum,
        ...orders,
        columnName: live.name("total"),
      },
      expected: 150,
    },
    {
      checkId: "invalid",
      target: {
        type: DataCheckType.InvalidPercent,
        ...orders,
        columnName: live.name("status"),
        acceptedValues: ["paid", "refunded"],
      },
      expected: 20,
    },
    {
      checkId: "format",
      target: {
        type: DataCheckType.FormatMismatchPercent,
        ...customers,
        columnName: live.name("email"),
        pattern: "@",
      },
      expected: 25,
    },
    {
      checkId: "orphans",
      target: {
        type: DataCheckType.OrphanCount,
        ...orders,
        columnName: live.name("customer_id"),
        referenceSchemaName: live.schema,
        referenceTableName: live.name("customers"),
        referenceColumnName: live.name("id"),
      },
      expected: 1,
    },
    {
      checkId: "segments",
      target: {
        type: DataCheckType.RowCount,
        ...orders,
        segmentColumn: live.name("region"),
      },
      expected: { eu: 2, us: 4 },
    },
    {
      checkId: "custom",
      target: {
        type: DataCheckType.CustomSql,
        ...orders,
        customSql: live.customCheck,
      },
      expected: 3,
    },
  ];

  return checks.filter((check: PlannedCheck): boolean => {
    return !(live.skips || []).includes(check.checkId);
  });
}

function dump(name: string, snapshot: TableHealthSnapshot): void {
  if (DUMP_DIRECTORY) {
    fs.writeFileSync(
      `${DUMP_DIRECTORY}/${name}.json`,
      JSON.stringify(snapshot, null, 2),
    );
  }
}

function findTable(
  snapshot: TableHealthSnapshot,
  live: LiveEngine,
  name: string,
): CollectedTable | undefined {
  return snapshot.tables.find((table: CollectedTable): boolean => {
    return table.schema === live.schema && table.name === live.name(name);
  });
}

// What the documented grants must read: the catalog, without a single row.
async function expectCatalog(live: LiveEngine): Promise<TableHealthSnapshot> {
  const snapshot: TableHealthSnapshot = await collectTableHealth(
    { engine: live.engine, connectionString: live.connection },
    COLLECT,
  );

  dump(`${live.engine}-catalog`, snapshot);

  const orders: CollectedTable | undefined = findTable(
    snapshot,
    live,
    "orders",
  );
  const view: CollectedTable | undefined = findTable(
    snapshot,
    live,
    "orders_v",
  );

  expect(orders).toBeDefined();
  expect(orders!.kind).toBe(DataAssetKind.Table);
  expect(view).toBeDefined();
  expect(view!.kind).toBe(DataAssetKind.View);
  expect(
    (orders!.columns || []).map((column: { name: string }): string => {
      return column.name;
    }),
  ).toEqual(
    expect.arrayContaining(
      ["id", "customer_id", "total", "status", "region"].map(live.name),
    ),
  );
  expect([HOST, CLICKHOUSE_HOST]).toContain(snapshot.target?.host);

  return snapshot;
}

// With SELECT on the checked tables: every check comes back with what the data says.
async function expectChecks(live: LiveEngine): Promise<void> {
  const planned: Array<PlannedCheck> = planChecks(live);
  const snapshot: TableHealthSnapshot = await collectTableHealth(
    { engine: live.engine, connectionString: live.connection },
    {
      ...COLLECT,
      checks: planned.map((check: PlannedCheck) => {
        const statement: ReturnType<typeof buildDataCheckStatement> =
          buildDataCheckStatement(live.engine, check.target);

        return {
          checkId: check.checkId,
          type: check.target.type,
          isSegmented: statement.isSegmented,
          sql: statement.sql,
          params: statement.params,
        };
      }),
    },
  );

  dump(`${live.engine}-checks`, snapshot);

  const answers: Record<string, unknown> = {};
  const expected: Record<string, unknown> = {};

  for (const check of planned) {
    const result:
      | {
          values: Array<{ segment: string | null; value: number }>;
          error: string | null;
        }
      | undefined = (snapshot.checkResults || []).find(
      (item: { checkId: string }): boolean => {
        return item.checkId === check.checkId;
      },
    );

    expected[check.checkId] = check.expected;

    if (result?.error) {
      answers[check.checkId] = result.error;
    } else if (typeof check.expected === "number") {
      answers[check.checkId] = result?.values[0]?.value;
    } else {
      const segments: Record<string, number> = {};

      for (const value of result?.values || []) {
        segments[value.segment || ""] = value.value;
      }

      answers[check.checkId] = segments;
    }
  }

  expect(answers).toEqual(expected);
}

/*
 * What a check can do beyond one number from every row, on this engine's own
 * syntax: count the rows a query returns, read a share of a table, read failing
 * rows, read a freshness column, and ask how busy the server is.
 */
async function expectCheckOptions(live: LiveEngine): Promise<void> {
  const orders: Pick<DataCheckTarget, "schemaName" | "tableName"> = {
    schemaName: live.schema,
    tableName: live.name("orders"),
  };
  const customers: Pick<DataCheckTarget, "schemaName" | "tableName"> = {
    schemaName: live.schema,
    tableName: live.name("customers"),
  };
  const failing: DataCheckTarget = {
    type: DataCheckType.FailingRows,
    ...orders,
    customSql: live.customCheck,
  };
  const invalid: DataCheckTarget = {
    type: DataCheckType.InvalidPercent,
    ...orders,
    columnName: live.name("status"),
    acceptedValues: ["paid", "refunded"],
  };
  const orphans: DataCheckTarget = {
    type: DataCheckType.OrphanCount,
    ...orders,
    columnName: live.name("customer_id"),
    referenceSchemaName: live.schema,
    referenceTableName: live.name("customers"),
    referenceColumnName: live.name("id"),
  };
  const sampled: DataCheckTarget = {
    type: DataCheckType.NullPercent,
    ...customers,
    columnName: live.name("email"),
    samplePercent: 50,
  };
  const plan: (checkId: string, target: DataCheckTarget) => PlannedDataCheck = (
    checkId: string,
    target: DataCheckTarget,
  ): PlannedDataCheck => {
    const statement: ReturnType<typeof buildDataCheckStatement> =
      buildDataCheckStatement(live.engine, target);
    const sample: ReturnType<typeof buildDataCheckSampleStatement> =
      buildDataCheckSampleStatement(live.engine, target);

    return {
      checkId,
      type: target.type,
      isSegmented: statement.isSegmented,
      sql: statement.sql,
      params: statement.params,
      ...(sample ? { sample: { ...sample, maskedColumns: {} } } : {}),
    };
  };
  const freshness: ReturnType<typeof buildFreshnessStatement> =
    buildFreshnessStatement(live.engine, {
      ...orders,
      columnName: live.name("total"),
    });
  const snapshot: TableHealthSnapshot = await collectTableHealth(
    { engine: live.engine, connectionString: live.connection },
    {
      ...COLLECT,
      waitWhenBusy: true,
      checks: [
        plan("failing", failing),
        plan("invalid", invalid),
        plan("orphans", orphans),
        plan("sampled", sampled),
      ],
      freshnessReads: [
        {
          tableKey: `${live.schema}.${live.name("orders")}`,
          sql: freshness.sql,
          params: freshness.params,
        },
      ],
    },
  );

  dump(`${live.engine}-options`, snapshot);

  const result: (checkId: string) => DataCheckRunResult | undefined = (
    checkId: string,
  ): DataCheckRunResult | undefined => {
    return (snapshot.checkResults || []).find((item: DataCheckRunResult) => {
      return item.checkId === checkId;
    });
  };

  // A share of a small table may read nothing, but it must read without an error.
  expect({
    failing: result("failing")?.error ?? null,
    invalid: result("invalid")?.error ?? null,
    orphans: result("orphans")?.error ?? null,
    sampled: result("sampled")?.error ?? null,
  }).toEqual({ failing: null, invalid: null, orphans: null, sampled: null });
  expect(result("failing")?.values[0]?.value).toBe(1);

  // MongoDB ends every check in a number, so it has no rows to name.
  if (live.engine !== "mongodb") {
    expect(result("failing")?.failingRows?.length).toBe(1);
    expect(result("invalid")?.failingRows?.length).toBeGreaterThan(0);
    expect(result("orphans")?.failingRows?.length).toBeGreaterThan(0);
  }

  const table: CollectedTable | undefined = findTable(snapshot, live, "orders");

  expect(table?.isChangeTimeFromData).toBe(true);
  expect(snapshot.warnings.join(" ")).not.toContain("freshness column");

  // An idle test server is not busy, and a query that fails would throw here.
  expect(
    await isDatabaseBusy({
      engine: live.engine,
      connectionString: live.connection,
    }),
  ).toBe(false);
}

describe("every engine against a real server", () => {
  (isRunning("postgresql") ? describe : describe.skip)("PostgreSQL", () => {
    const live: LiveEngine = {
      engine: "postgresql",
      schema: "public",
      name: (value: string): string => {
        return value;
      },
      customCheck: "SELECT COUNT(*) AS value FROM orders WHERE total > 25",
      connection: `postgres://oneuptime_reader:${READER_PASSWORD}@${HOST}:25432/shop`,
    };
    const admin: (database: string) => PostgresClient = (database: string) => {
      return new PostgresClient({
        host: HOST,
        port: 25432,
        user: "postgres",
        password: PASSWORD,
        database,
      });
    };

    beforeAll(async () => {
      const server: PostgresClient = admin("postgres");

      await server.connect();
      await server.query("DROP DATABASE IF EXISTS shop WITH (FORCE)");
      await server.query("DROP ROLE IF EXISTS oneuptime_reader");
      await server.query("CREATE DATABASE shop");
      await server.end();

      const shop: PostgresClient = admin("shop");

      await shop.connect();
      await shop.query(`
        CREATE TABLE customers (id INT PRIMARY KEY, email TEXT, region TEXT);
        CREATE TABLE orders (id INT PRIMARY KEY, customer_id INT, total NUMERIC(10,2), status TEXT, region TEXT, created_at TIMESTAMPTZ DEFAULT now());
        INSERT INTO customers VALUES (1,'a@example.com','eu'),(2,'b@example.com','eu'),(3,'b@example.com','us'),(4,NULL,'us'),(5,'not-an-email','us');
        INSERT INTO orders (id,customer_id,total,status,region) VALUES (1,1,10,'paid','eu'),(2,2,20,'paid','eu'),(3,3,30,'refunded','us'),(4,3,40,'paid','us'),(5,99,50,'bogus','us'),(6,NULL,NULL,NULL,'us');
        CREATE VIEW orders_v AS SELECT id, total FROM orders;
        CREATE ROLE oneuptime_reader LOGIN PASSWORD '${READER_PASSWORD}';
        GRANT CONNECT ON DATABASE shop TO oneuptime_reader;
        GRANT USAGE ON SCHEMA public TO oneuptime_reader;
      `);
      await shop.end();
    }, SLOW_IN_MS);

    test(
      "the documented grants read the catalog, its counters and view lineage",
      async () => {
        const snapshot: TableHealthSnapshot = await expectCatalog(live);
        const orders: CollectedTable = findTable(snapshot, live, "orders")!;

        expect(orders.sizeInBytes).toBeGreaterThan(0);
        expect(orders.writeCount).toBeGreaterThanOrEqual(0);
        expect(snapshot.lineage).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              upstreamTable: "orders",
              downstreamTable: "orders_v",
            }),
          ]),
        );
      },
      SLOW_IN_MS,
    );

    test(
      "with SELECT, every check says what the data says",
      async () => {
        const shop: PostgresClient = admin("shop");

        await shop.connect();
        await shop.query(
          "GRANT SELECT ON orders, customers TO oneuptime_reader",
        );
        await shop.end();
        await expectChecks(live);
        await expectCheckOptions(live);
      },
      SLOW_IN_MS,
    );
  });

  (isRunning("mysql") ? describe : describe.skip)("MySQL", () => {
    const live: LiveEngine = {
      engine: "mysql",
      schema: "shop",
      name: (value: string): string => {
        return value;
      },
      customCheck: "SELECT COUNT(*) AS value FROM orders WHERE total > 25",
      connection: `mysql://oneuptime_reader:${READER_PASSWORD}@${HOST}:23306/shop`,
    };
    const admin: () => ReturnType<typeof createMySqlConnection> = () => {
      return createMySqlConnection({
        host: HOST,
        port: 23306,
        user: "root",
        password: PASSWORD,
        multipleStatements: true,
      });
    };

    beforeAll(async () => {
      const server: Awaited<ReturnType<typeof createMySqlConnection>> =
        await admin();

      await server.query(`
        DROP DATABASE IF EXISTS shop;
        DROP USER IF EXISTS 'oneuptime_reader'@'%';
        CREATE DATABASE shop;
        USE shop;
        CREATE TABLE customers (id INT PRIMARY KEY, email VARCHAR(200), region VARCHAR(20));
        CREATE TABLE orders (id INT PRIMARY KEY, customer_id INT, total DECIMAL(10,2), status VARCHAR(20), region VARCHAR(20), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
        INSERT INTO customers VALUES (1,'a@example.com','eu'),(2,'b@example.com','eu'),(3,'b@example.com','us'),(4,NULL,'us'),(5,'not-an-email','us');
        INSERT INTO orders (id,customer_id,total,status,region) VALUES (1,1,10,'paid','eu'),(2,2,20,'paid','eu'),(3,3,30,'refunded','us'),(4,3,40,'paid','us'),(5,99,50,'bogus','us'),(6,NULL,NULL,NULL,'us');
        CREATE VIEW orders_v AS SELECT id, total FROM orders;
        CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '${READER_PASSWORD}';
        GRANT SHOW VIEW, REFERENCES ON shop.* TO 'oneuptime_reader'@'%';
        GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
      `);
      await server.end();
    }, SLOW_IN_MS);

    test(
      "the documented grants read the catalog",
      async () => {
        await expectCatalog(live);
      },
      SLOW_IN_MS,
    );

    test(
      "with SELECT, every check says what the data says, and writes are counted",
      async () => {
        const server: Awaited<ReturnType<typeof createMySqlConnection>> =
          await admin();

        await server.query(
          "GRANT SELECT ON shop.orders TO 'oneuptime_reader'@'%'; GRANT SELECT ON shop.customers TO 'oneuptime_reader'@'%'; GRANT SELECT ON shop.orders_v TO 'oneuptime_reader'@'%';",
        );
        await server.end();
        await expectChecks(live);
        await expectCheckOptions(live);

        const snapshot: TableHealthSnapshot = await expectCatalog(live);

        expect(snapshot.lineage).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              upstreamTable: "orders",
              downstreamTable: "orders_v",
            }),
          ]),
        );
        expect(findTable(snapshot, live, "orders")!.writeCount).toBeGreaterThan(
          0,
        );
      },
      SLOW_IN_MS,
    );
  });

  (isRunning("sqlserver") ? describe : describe.skip)("SQL Server", () => {
    const live: LiveEngine = {
      engine: "sqlserver",
      schema: "dbo",
      name: (value: string): string => {
        return value;
      },
      customCheck: "SELECT COUNT(*) AS value FROM dbo.orders WHERE total > 25",
      connection: `mssql://oneuptime_reader:${READER_PASSWORD}@${HOST}:21433/shop?encrypt=true&trustServerCertificate=true`,
      // SQL Server has no regular expressions: validation refuses this check.
      skips: ["format"],
    };
    const run: (
      statements: Array<string>,
      database: string,
    ) => Promise<void> = async (
      statements: Array<string>,
      database: string,
    ): Promise<void> => {
      const pool: mssql.ConnectionPool = new mssql.ConnectionPool({
        server: HOST,
        port: 21433,
        user: "sa",
        password: PASSWORD,
        database,
        options: { encrypt: true, trustServerCertificate: true },
      });

      await pool.connect();

      for (const statement of statements) {
        await pool.request().batch(statement);
      }

      await pool.close();
    };

    beforeAll(async () => {
      await run(
        [
          "IF DB_ID('shop') IS NOT NULL BEGIN ALTER DATABASE shop SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE shop; END",
          "IF SUSER_ID('oneuptime_reader') IS NOT NULL DROP LOGIN oneuptime_reader",
          "CREATE DATABASE shop",
          `CREATE LOGIN oneuptime_reader WITH PASSWORD = '${READER_PASSWORD}'`,
        ],
        "master",
      );
      await run(
        [
          "CREATE TABLE dbo.customers (id INT PRIMARY KEY, email NVARCHAR(200), region NVARCHAR(20))",
          "CREATE TABLE dbo.orders (id INT PRIMARY KEY, customer_id INT, total DECIMAL(10,2), status NVARCHAR(20), region NVARCHAR(20), created_at DATETIME2 DEFAULT SYSUTCDATETIME())",
          "INSERT INTO dbo.customers VALUES (1,'a@example.com','eu'),(2,'b@example.com','eu'),(3,'b@example.com','us'),(4,NULL,'us'),(5,'not-an-email','us')",
          "INSERT INTO dbo.orders (id,customer_id,total,status,region) VALUES (1,1,10,'paid','eu'),(2,2,20,'paid','eu'),(3,3,30,'refunded','us'),(4,3,40,'paid','us'),(5,99,50,'bogus','us'),(6,NULL,NULL,NULL,'us')",
          "CREATE VIEW dbo.orders_v AS SELECT id, total FROM dbo.orders",
          "CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader",
          "GRANT VIEW DEFINITION TO oneuptime_reader",
          "GRANT VIEW DATABASE STATE TO oneuptime_reader",
        ],
        "shop",
      );
    }, SLOW_IN_MS);

    test(
      "the documented grants read the catalog, last updates and view lineage",
      async () => {
        const snapshot: TableHealthSnapshot = await expectCatalog(live);

        expect(
          findTable(snapshot, live, "orders")!.sizeInBytes,
        ).toBeGreaterThan(0);
        expect(snapshot.lineage).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              upstreamTable: "orders",
              downstreamTable: "orders_v",
            }),
          ]),
        );
      },
      SLOW_IN_MS,
    );

    test(
      "with SELECT, every check says what the data says",
      async () => {
        await run(
          [
            "GRANT SELECT ON dbo.orders TO oneuptime_reader",
            "GRANT SELECT ON dbo.customers TO oneuptime_reader",
          ],
          "shop",
        );
        await expectChecks(live);
        await expectCheckOptions(live);
      },
      SLOW_IN_MS,
    );
  });

  (isRunning("clickhouse") ? describe : describe.skip)("ClickHouse", () => {
    if (ALLOW_LOOPBACK) {
      beforeAll(() => {
        jest
          .spyOn(DataSourceEgressGuard, "assertHostnameAllowed")
          .mockResolvedValue([]);
      });
    }

    const live: LiveEngine = {
      engine: "clickhouse",
      schema: "shop",
      name: (value: string): string => {
        return value;
      },
      customCheck: "SELECT count() AS value FROM shop.orders WHERE total > 25",
      connection: JSON.stringify({
        host: CLICKHOUSE_HOST,
        port: 28123,
        secure: false,
        user: "oneuptime_reader",
        password: READER_PASSWORD,
        database: "shop",
      }),
    };
    const run: (statement: string) => Promise<string> = (
      statement: string,
    ): Promise<string> => {
      return new Promise(
        (resolve: (text: string) => void, reject: (error: Error) => void) => {
          const request: http.ClientRequest = http.request(
            {
              host: HOST,
              port: 28123,
              method: "POST",
              path: "/",
              headers: {
                "X-ClickHouse-User": "default",
                "X-ClickHouse-Key": PASSWORD,
              },
            },
            (response: http.IncomingMessage) => {
              let text: string = "";

              response.on("data", (chunk: Buffer) => {
                text += chunk.toString();
              });
              response.on("end", () => {
                if (response.statusCode === 200) {
                  resolve(text);
                } else {
                  reject(new Error(text));
                }
              });
            },
          );

          request.on("error", reject);
          request.end(statement);
        },
      );
    };

    beforeAll(async () => {
      for (const statement of [
        "DROP DATABASE IF EXISTS shop",
        "DROP USER IF EXISTS oneuptime_reader",
        "CREATE DATABASE shop",
        "CREATE TABLE shop.customers (id Int32, email Nullable(String), region String) ENGINE = MergeTree ORDER BY id",
        "CREATE TABLE shop.orders (id Int32, customer_id Nullable(Int32), total Nullable(Decimal(10,2)), status Nullable(String), region String, created_at DateTime DEFAULT now()) ENGINE = MergeTree ORDER BY id",
        "INSERT INTO shop.customers (id,email,region) VALUES (1,'a@example.com','eu'),(2,'b@example.com','eu'),(3,'b@example.com','us'),(4,NULL,'us'),(5,'not-an-email','us')",
        "INSERT INTO shop.orders (id,customer_id,total,status,region) VALUES (1,1,10,'paid','eu'),(2,2,20,'paid','eu'),(3,3,30,'refunded','us'),(4,3,40,'paid','us'),(5,99,50,'bogus','us'),(6,NULL,NULL,NULL,'us')",
        "CREATE VIEW shop.orders_v AS SELECT id, total FROM shop.orders",
        `CREATE USER oneuptime_reader IDENTIFIED BY '${READER_PASSWORD}' SETTINGS readonly = 2`,
        "GRANT SHOW TABLES, SHOW COLUMNS ON *.* TO oneuptime_reader",
        "GRANT SELECT ON system.parts TO oneuptime_reader",
        "GRANT SELECT ON system.part_log TO oneuptime_reader",
        "GRANT SELECT ON system.query_log TO oneuptime_reader",
      ]) {
        await run(statement);
      }
    }, SLOW_IN_MS);

    test(
      "the documented grants read the catalog and each table's parts",
      async () => {
        const snapshot: TableHealthSnapshot = await expectCatalog(live);
        const orders: CollectedTable = findTable(snapshot, live, "orders")!;

        expect(orders.estimatedRows).toBe(6);
        expect(orders.sizeInBytes).toBeGreaterThan(0);
        expect(orders.secondsSinceChange).not.toBeNull();
      },
      SLOW_IN_MS,
    );

    test(
      "with SELECT, every check says what the data says",
      async () => {
        await run("GRANT SELECT ON shop.orders TO oneuptime_reader");
        await run("GRANT SELECT ON shop.customers TO oneuptime_reader");
        await expectChecks(live);
        await expectCheckOptions(live);
      },
      SLOW_IN_MS,
    );
  });

  (isRunning("oracle") ? describe : describe.skip)("Oracle", () => {
    const live: LiveEngine = {
      engine: "oracle",
      schema: "SALES",
      name: (value: string): string => {
        return value.toUpperCase();
      },
      customCheck:
        "SELECT COUNT(*) AS value FROM sales.orders WHERE total > 25",
      connection: `oracle://oneuptime_reader:${READER_PASSWORD}@${HOST}:21521/FREEPDB1`,
    };
    const run: (statements: Array<string>) => Promise<void> = async (
      statements: Array<string>,
    ): Promise<void> => {
      const connection: oracledb.Connection = await oracledb.getConnection({
        user: "system",
        password: PASSWORD,
        connectString: `${HOST}:21521/FREEPDB1`,
      });

      for (const statement of statements) {
        await connection.execute(statement, [], { autoCommit: true });
      }

      await connection.close();
    };

    beforeAll(async () => {
      await run([
        "BEGIN FOR u IN (SELECT username FROM all_users WHERE username IN ('SALES','ONEUPTIME_READER')) LOOP EXECUTE IMMEDIATE 'DROP USER ' || u.username || ' CASCADE'; END LOOP; END;",
        `CREATE USER sales IDENTIFIED BY "${READER_PASSWORD}" QUOTA UNLIMITED ON users`,
        "CREATE TABLE sales.customers (id NUMBER PRIMARY KEY, email VARCHAR2(200), region VARCHAR2(20))",
        "CREATE TABLE sales.orders (id NUMBER PRIMARY KEY, customer_id NUMBER, total NUMBER(10,2), status VARCHAR2(20), region VARCHAR2(20), created_at TIMESTAMP DEFAULT SYSTIMESTAMP)",
        "INSERT INTO sales.customers VALUES (1,'a@example.com','eu')",
        "INSERT INTO sales.customers VALUES (2,'b@example.com','eu')",
        "INSERT INTO sales.customers VALUES (3,'b@example.com','us')",
        "INSERT INTO sales.customers VALUES (4,NULL,'us')",
        "INSERT INTO sales.customers VALUES (5,'not-an-email','us')",
        "INSERT INTO sales.orders (id,customer_id,total,status,region) VALUES (1,1,10,'paid','eu')",
        "INSERT INTO sales.orders (id,customer_id,total,status,region) VALUES (2,2,20,'paid','eu')",
        "INSERT INTO sales.orders (id,customer_id,total,status,region) VALUES (3,3,30,'refunded','us')",
        "INSERT INTO sales.orders (id,customer_id,total,status,region) VALUES (4,3,40,'paid','us')",
        "INSERT INTO sales.orders (id,customer_id,total,status,region) VALUES (5,99,50,'bogus','us')",
        "INSERT INTO sales.orders (id,customer_id,total,status,region) VALUES (6,NULL,NULL,NULL,'us')",
        "CREATE VIEW sales.orders_v AS SELECT id, total FROM sales.orders",
        "BEGIN DBMS_STATS.GATHER_SCHEMA_STATS('SALES'); END;",
        "UPDATE sales.orders SET region = region WHERE id = 1",
        "BEGIN DBMS_STATS.FLUSH_DATABASE_MONITORING_INFO; END;",
        `CREATE USER oneuptime_reader IDENTIFIED BY "${READER_PASSWORD}"`,
        "GRANT CREATE SESSION TO oneuptime_reader",
        "GRANT READ ON sales.orders TO oneuptime_reader",
        "GRANT READ ON sales.customers TO oneuptime_reader",
        "GRANT READ ON sales.orders_v TO oneuptime_reader",
        "GRANT SELECT_CATALOG_ROLE TO oneuptime_reader",
      ]);
    }, SLOW_IN_MS);

    test(
      "the documented grants read the catalog, its modifications and view lineage",
      async () => {
        const snapshot: TableHealthSnapshot = await expectCatalog(live);
        const orders: CollectedTable = findTable(snapshot, live, "orders")!;

        expect(orders.estimatedRows).toBe(6);
        expect(orders.sizeInBytes).toBeGreaterThan(0);
        expect(orders.writeCount).toBeGreaterThan(0);
        expect(orders.secondsSinceChange).not.toBeNull();
        expect(snapshot.lineage).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              upstreamTable: "ORDERS",
              downstreamTable: "ORDERS_V",
            }),
          ]),
        );
      },
      SLOW_IN_MS,
    );

    test(
      "every check says what the data says, in a read-only transaction",
      async () => {
        await expectChecks(live);
        await expectCheckOptions(live);
      },
      SLOW_IN_MS,
    );
  });

  (isRunning("mongodb") ? describe : describe.skip)("MongoDB", () => {
    const live: LiveEngine = {
      engine: "mongodb",
      schema: "shop",
      name: (value: string): string => {
        return value;
      },
      customCheck: '[{"$match": {"total": {"$gt": 25}}}, {"$count": "value"}]',
      connection: `mongodb://oneuptime_reader:${READER_PASSWORD}@${HOST}:27117/?authSource=admin`,
    };
    const admin: () => MongoClient = () => {
      return new MongoClient(
        `mongodb://root:${PASSWORD}@${HOST}:27117/?authSource=admin`,
      );
    };

    beforeAll(async () => {
      const client: MongoClient = await admin().connect();
      const shop: ReturnType<MongoClient["db"]> = client.db("shop");

      await shop.dropDatabase();
      await client.db("other").dropDatabase();
      await client
        .db("admin")
        .command({ dropUser: "oneuptime_reader" })
        .catch(() => {
          return undefined;
        });
      await shop.createCollection("customers");
      await shop.collection("customers").insertMany([
        { id: 1, email: "a@example.com", region: "eu" },
        { id: 2, email: "b@example.com", region: "eu" },
        { id: 3, email: "b@example.com", region: "us" },
        { id: 4, email: null, region: "us" },
        { id: 5, email: "not-an-email", region: "us" },
      ]);
      await shop.collection("orders").insertMany([
        { id: 1, customer_id: 1, total: 10, status: "paid", region: "eu" },
        { id: 2, customer_id: 2, total: 20, status: "paid", region: "eu" },
        {
          id: 3,
          customer_id: 3,
          total: 30.0,
          status: "refunded",
          region: "us",
        },
        { id: 4, customer_id: 3, total: 40, status: "paid", region: "us" },
        { id: 5, customer_id: 99, total: 50, status: "bogus", region: "us" },
        // A document store: this one's fields are simply missing, or the wrong type.
        { id: 6, customer_id: null, region: "us", note: { nested: true } },
      ]);
      await shop.createCollection("orders_v", {
        viewOn: "orders",
        pipeline: [{ $project: { id: 1, total: 1 } }],
      });
      await shop.createCollection("metrics", {
        timeseries: { timeField: "ts", metaField: "host" },
      });
      await shop
        .collection("metrics")
        .insertOne({ ts: new Date(), host: "a", cpu: 1 });
      await shop.createCollection("validated", {
        validator: {
          $jsonSchema: {
            required: ["email"],
            properties: {
              email: { bsonType: "string" },
              age: { bsonType: ["int", "null"] },
            },
          },
        },
      });
      await client.db("admin").command({
        createUser: "oneuptime_reader",
        pwd: READER_PASSWORD,
        roles: [{ role: "readAnyDatabase", db: "admin" }],
      });
      await client.close();
    }, SLOW_IN_MS);

    test(
      "the documented login reads collections, views, time series and validators",
      async () => {
        const snapshot: TableHealthSnapshot = await expectCatalog(live);
        const orders: CollectedTable = findTable(snapshot, live, "orders")!;

        // The newest _id of ObjectIds says when; the write counter and size are the server's.
        expect(orders.estimatedRows).toBe(6);
        expect(orders.sizeInBytes).toBeGreaterThan(0);
        expect(orders.writeCount).toBeGreaterThan(0);
        expect(orders.secondsSinceChange).toBeLessThan(600);
        expect(orders.columns).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "_id", dataType: "objectid" }),
            expect.objectContaining({ name: "note", dataType: "object" }),
            expect.objectContaining({ name: "total", dataType: "number" }),
          ]),
        );
        expect(findTable(snapshot, live, "orders_v")!.columns).toBeNull();
        expect(findTable(snapshot, live, "validated")!.columns).toEqual([
          { name: "email", dataType: "string", isNullable: false, position: 1 },
          { name: "age", dataType: "number", isNullable: true, position: 2 },
        ]);

        const metrics: CollectedTable = findTable(snapshot, live, "metrics")!;

        expect(metrics.kind).toBe(DataAssetKind.Table);
        expect(metrics.sizeInBytes).not.toBeNull();
        expect(
          (metrics.columns || []).map((column: { name: string }): string => {
            return column.name;
          }),
        ).toEqual(["ts", "host"]);
        expect(snapshot.lineage).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              upstreamTable: "orders",
              downstreamTable: "orders_v",
            }),
          ]),
        );
        expect(ObjectId.isValid("65f0c0ffee0000000000abcd")).toBe(true);
      },
      SLOW_IN_MS,
    );

    test(
      "every check is a pipeline that says what the data says",
      async () => {
        // MongoDB's own builder, as buildDataCheckStatement delegates to it.
        expect(
          buildMongoCheckStatement({
            type: DataCheckType.RowCount,
            schemaName: "shop",
            tableName: "orders",
          }).isSegmented,
        ).toBe(false);
        await expectChecks(live);
        await expectCheckOptions(live);
      },
      SLOW_IN_MS,
    );
  });

  test("the suite says when it was not asked to run", () => {
    expect(typeof LIVE).toBe("boolean");
  });

  afterAll(() => {
    // Nothing to close: each test opens and closes its own connections.
  });
});
