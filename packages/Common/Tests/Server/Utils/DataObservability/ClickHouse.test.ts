import { afterEach, describe, expect, jest, test } from "@jest/globals";
import ClickHouseHttpApi, {
  readClickHouseConnection,
  readClickHouseRows,
  withJsonFormat,
} from "../../../../Server/Utils/DataObservability/ClickHouseHttpApi";
import {
  collectTableHealth,
  readClickHouseInsertLineage,
  readClickHouseKind,
  readInsertTarget,
  readMaterializedViewTarget,
  TableHealthSnapshot,
} from "../../../../Server/Utils/DataObservability/TableHealthCollector";
import { readConnectionTarget } from "../../../../Server/Utils/DataObservability/TableHealthTarget";
import { buildDataCheckStatement } from "../../../../Server/Utils/DataObservability/DataCheckSql";
import { getUpstreamDataset } from "../../../../Server/Utils/DataObservability/CollectedLineage";
import { parseDatasetName } from "../../../../Server/Utils/DataObservability/OpenLineageEvent";
import { DataCheckType } from "../../../../Types/DataObservability/DataCheckType";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import DataAssetLineageSource from "../../../../Types/DataObservability/DataAssetLineageSource";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";

/*
 * ClickHouse is read over its HTTP interface: every statement read-only,
 * its values bound as query parameters, inserts counted by block numbers
 * a merge never moves, and lineage from materialized views and the query
 * log.
 */

const URL_CONNECTION: string =
  "clickhouse://oneuptime_reader:s3cret@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics";

function json(body: unknown, statusCode: number = 200): DataSourceHttpResponse {
  return {
    statusCode,
    bodyText: typeof body === "string" ? body : JSON.stringify(body),
    bodyJson: typeof body === "string" ? undefined : body,
  };
}

describe("readClickHouseConnection", () => {
  test("a clickhouse:// URL on the TLS port is secure, and names its database", () => {
    expect(readClickHouseConnection(URL_CONNECTION)).toEqual({
      secure: true,
      host: "abc123.us-east-1.aws.clickhouse.cloud",
      port: 8443,
      user: "oneuptime_reader",
      password: "s3cret",
      database: "analytics",
    });
  });

  test("an http:// URL is plain, on 8123 unless it says otherwise", () => {
    expect(
      readClickHouseConnection("http://reader:pw@clickhouse.internal"),
    ).toMatchObject({ secure: false, port: 8123, database: null });
    expect(
      readClickHouseConnection(
        "clickhouse://reader:pw@clickhouse.internal:8124/?secure=true",
      ),
    ).toMatchObject({ secure: true, port: 8124 });
  });

  test("JSON, its host a URL or a name, the login defaulting to default", () => {
    expect(
      readClickHouseConnection(
        JSON.stringify({
          host: "https://abc123.clickhouse.cloud:8443",
          password: "pw",
          database: "events",
        }),
      ),
    ).toEqual({
      secure: true,
      host: "abc123.clickhouse.cloud",
      port: 8443,
      user: "default",
      password: "pw",
      database: "events",
    });
    expect(
      readClickHouseConnection(
        JSON.stringify({ host: "10.0.0.5", user: "reader", secure: false }),
      ),
    ).toMatchObject({ host: "10.0.0.5", port: 8123, secure: false });
  });

  test("the native protocol's ports are refused with what to use", () => {
    expect(() => {
      return readClickHouseConnection("clickhouse://reader:pw@host:9000/db");
    }).toThrow(/8443 with TLS, or 8123/);
  });

  test("no host is no connection", () => {
    expect(() => {
      return readClickHouseConnection("not a url");
    }).toThrow(/needs the server's host/);
  });
});

describe("ClickHouseHttpApi", () => {
  test("a statement goes read-only, timed, bound and as JSON", async () => {
    const requests: Array<DataSourceHttpRequest> = [];
    const api: ClickHouseHttpApi = new ClickHouseHttpApi({
      connection: readClickHouseConnection(URL_CONNECTION),
      transport: async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        requests.push(request);
        return json({ meta: [], data: [{ value: "42" }], rows: 1 });
      },
    });

    expect(
      await api.query({
        statement: "SELECT count() AS value FROM `t` WHERE x = {p1:String};",
        params: ["it's"],
      }),
    ).toEqual([{ value: "42" }]);

    const url: URL = new URL(requests[0]!.url);

    expect(url.origin).toBe(
      "https://abc123.us-east-1.aws.clickhouse.cloud:8443",
    );
    expect(url.searchParams.get("readonly")).toBe("2");
    expect(url.searchParams.get("max_execution_time")).toBe("30");
    expect(url.searchParams.get("database")).toBe("analytics");
    expect(url.searchParams.get("param_p1")).toBe("it's");
    expect(requests[0]!.body).toBe(
      "SELECT count() AS value FROM `t` WHERE x = {p1:String}\nFORMAT JSON",
    );
    expect(requests[0]!.headers!["Authorization"]).toBe(
      `Basic ${Buffer.from("oneuptime_reader:s3cret").toString("base64")}`,
    );
  });

  test("a login that is readonly=1 already gets statements with no setting", async () => {
    const urls: Array<string> = [];
    const api: ClickHouseHttpApi = new ClickHouseHttpApi({
      connection: readClickHouseConnection(URL_CONNECTION),
      transport: async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        urls.push(request.url);
        return urls.length === 1
          ? json(
              "Code: 164. DB::Exception: Cannot modify 'readonly' setting in readonly mode. (READONLY)",
              500,
            )
          : json({ data: [{ reachable: 1 }] });
      },
    });

    await api.query({ statement: "SELECT 1 AS reachable" });
    await api.query({ statement: "SELECT 1 AS reachable" });

    expect(urls).toHaveLength(3);
    expect(new URL(urls[1]!).searchParams.has("readonly")).toBe(false);
    expect(new URL(urls[2]!).searchParams.has("max_execution_time")).toBe(
      false,
    );
  });

  test("an error says ClickHouse's own first line", async () => {
    const api: ClickHouseHttpApi = new ClickHouseHttpApi({
      connection: readClickHouseConnection(URL_CONNECTION),
      transport: async (): Promise<DataSourceHttpResponse> => {
        return json(
          "Code: 60. DB::Exception: Table analytics.nope does not exist. (UNKNOWN_TABLE)\nstack",
          404,
        );
      },
    });

    await expect(api.query({ statement: "SELECT 1" })).rejects.toThrow(
      "ClickHouse answered 404: Code: 60. DB::Exception: Table analytics.nope does not exist. (UNKNOWN_TABLE)",
    );
  });

  test("an answer with no rows is not taken for an empty table", () => {
    expect(() => {
      return readClickHouseRows("Code: 241. DB::Exception: Memory limit");
    }).toThrow(/did not answer with rows/);
    expect(withJsonFormat("SELECT 1 ;")).toBe("SELECT 1\nFORMAT JSON");
  });
});

describe("the ClickHouse catalog", () => {
  test("each engine's kind; inner tables and dictionaries are none", () => {
    expect(readClickHouseKind("ReplicatedMergeTree", "orders")).toBe(
      DataAssetKind.Table,
    );
    expect(readClickHouseKind("Distributed", "orders_all")).toBe(
      DataAssetKind.Table,
    );
    expect(readClickHouseKind("View", "v")).toBe(DataAssetKind.View);
    expect(readClickHouseKind("MaterializedView", "mv")).toBe(
      DataAssetKind.MaterializedView,
    );
    expect(readClickHouseKind("PostgreSQL", "pg_orders")).toBe(
      DataAssetKind.ForeignTable,
    );
    expect(readClickHouseKind("MergeTree", ".inner_id.1234")).toBe(null);
    expect(readClickHouseKind("Dictionary", "countries")).toBe(null);
  });

  test("the table an INSERT wrote, quoted or bare, in its query's database", () => {
    expect(
      readInsertTarget(
        "INSERT INTO analytics.daily SELECT * FROM raw.events",
        "",
      ),
    ).toEqual({ schema: "analytics", table: "daily" });
    expect(
      readInsertTarget("insert into table `my db`.`daily orders` select 1", ""),
    ).toEqual({ schema: "my db", table: "daily orders" });
    expect(readInsertTarget("INSERT INTO daily SELECT 1", "analytics")).toEqual(
      {
        schema: "analytics",
        table: "daily",
      },
    );
    expect(readInsertTarget("SELECT 1", "analytics")).toBe(null);
  });

  test("the table a materialized view writes to", () => {
    expect(
      readMaterializedViewTarget(
        "CREATE MATERIALIZED VIEW analytics.orders_mv TO analytics.orders_daily (`day` Date) AS SELECT toDate(ts) AS day FROM analytics.orders",
        "analytics",
      ),
    ).toEqual({ schema: "analytics", table: "orders_daily" });
    expect(
      readMaterializedViewTarget(
        "CREATE MATERIALIZED VIEW analytics.mv ENGINE = MergeTree ORDER BY x AS SELECT 1 AS x",
        "analytics",
      ),
    ).toBe(null);
  });

  test("an INSERT ... SELECT is an edge from each table it read to the one it wrote", () => {
    expect(
      readClickHouseInsertLineage([
        {
          query_text:
            "INSERT INTO analytics.daily SELECT * FROM raw.events JOIN raw.users USING id",
          tables: ["analytics.daily", "raw.events", "raw.users"],
          current_database: "default",
          seen_by: "etl",
          seconds_since_seen: "120",
        },
      ]),
    ).toEqual([
      {
        source: DataAssetLineageSource.QueryHistory,
        upstreamDatabase: null,
        upstreamSchema: "raw",
        upstreamTable: "events",
        downstreamSchema: "analytics",
        downstreamTable: "daily",
        secondsSinceSeen: 120,
        seenBy: "etl",
      },
      {
        source: DataAssetLineageSource.QueryHistory,
        upstreamDatabase: null,
        upstreamSchema: "raw",
        upstreamTable: "users",
        downstreamSchema: "analytics",
        downstreamTable: "daily",
        secondsSinceSeen: 120,
        seenBy: "etl",
      },
    ]);
  });
});

describe("collecting a ClickHouse server", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("tables with their rows, inserts and columns; views' lineage; no part log needed", async () => {
    const statements: Array<string> = [];

    jest
      .spyOn(DataSourceHttpFetch, "fetch")
      .mockImplementation(
        async (
          request: DataSourceHttpRequest,
        ): Promise<DataSourceHttpResponse> => {
          const sql: string = String(request.body);

          statements.push(sql);

          if (sql.startsWith("SELECT 1 AS reachable")) {
            return json({ data: [{ reachable: 1 }] });
          }

          if (sql.includes("FROM system.part_log")) {
            return json(
              "Code: 60. DB::Exception: Table system.part_log does not exist. (UNKNOWN_TABLE)",
              404,
            );
          }

          if (sql.includes("FROM system.tables AS t")) {
            return json({
              data: [
                {
                  table_schema: "analytics",
                  table_name: "orders",
                  engine: "ReplicatedMergeTree",
                  total_rows: "1200",
                  total_bytes: "65536",
                  parts_table: "orders",
                  write_count: "37",
                },
                {
                  table_schema: "analytics",
                  table_name: "orders_daily_mv",
                  engine: "MaterializedView",
                  total_rows: null,
                  total_bytes: null,
                  parts_table: "",
                  write_count: "0",
                },
                {
                  table_schema: "analytics",
                  table_name: ".inner_id.5f",
                  engine: "MergeTree",
                  total_rows: "5",
                  total_bytes: "10",
                  parts_table: ".inner_id.5f",
                  write_count: "1",
                },
              ],
            });
          }

          if (sql.includes("FROM system.columns")) {
            return json({
              data: [
                {
                  table_schema: "analytics",
                  table_name: "orders",
                  column_name: "id",
                  data_type: "UInt64",
                  ordinal_position: 1,
                  is_nullable: "NO",
                },
                {
                  table_schema: "analytics",
                  table_name: "orders",
                  column_name: "coupon",
                  data_type: "Nullable(String)",
                  ordinal_position: 2,
                  is_nullable: "YES",
                },
              ],
            });
          }

          if (sql.includes("length(dependencies_table) > 0")) {
            return json({
              data: [
                {
                  database: "analytics",
                  name: "orders",
                  dependencies_database: ["analytics"],
                  dependencies_table: ["orders_daily_mv"],
                },
              ],
            });
          }

          if (sql.includes("engine = 'MaterializedView'")) {
            return json({
              data: [
                {
                  database: "analytics",
                  name: "orders_daily_mv",
                  definition:
                    "CREATE MATERIALIZED VIEW analytics.orders_daily_mv TO analytics.orders_daily AS SELECT 1",
                },
              ],
            });
          }

          throw new Error(`Unexpected statement: ${sql.slice(0, 80)}`);
        },
      );

    const snapshot: TableHealthSnapshot = await collectTableHealth({
      engine: "clickhouse",
      connectionString: URL_CONNECTION,
    });

    expect(snapshot.engine).toBe("clickhouse");
    expect(snapshot.warnings).toEqual([]);
    expect(snapshot.target).toEqual({
      databaseName: "analytics",
      host: "abc123.us-east-1.aws.clickhouse.cloud",
      port: 8443,
    });
    expect(snapshot.tables).toEqual([
      {
        schema: "analytics",
        name: "orders",
        kind: DataAssetKind.Table,
        estimatedRows: 1200,
        sizeInBytes: 65536,
        writeCount: 37,
        secondsSinceChange: null,
        readCount: null,
        secondsSinceRead: null,
        columns: [
          { name: "id", dataType: "uint64", isNullable: false, position: 1 },
          {
            name: "coupon",
            dataType: "nullable(string)",
            isNullable: true,
            position: 2,
          },
        ],
      },
      {
        schema: "analytics",
        name: "orders_daily_mv",
        kind: DataAssetKind.MaterializedView,
        estimatedRows: null,
        sizeInBytes: null,
        writeCount: null,
        secondsSinceChange: null,
        readCount: null,
        secondsSinceRead: null,
        columns: [],
      },
    ]);
    expect(
      snapshot.lineage!.map(
        (edge: { upstreamTable: string; downstreamTable: string }) => {
          return `${edge.upstreamTable} -> ${edge.downstreamTable}`;
        },
      ),
    ).toEqual(["orders -> orders_daily_mv", "orders_daily_mv -> orders_daily"]);
    expect(snapshot.isViewLineageComplete).toBe(true);
    // Only the connection's database is read, bound as a value.
    expect(
      statements.some((sql: string) => {
        return sql.includes("t.database = {p1:String}");
      }),
    ).toBe(true);
    // No query history is read outside an hourly collection.
    expect(
      statements.some((sql: string) => {
        return sql.includes("system.query_log");
      }),
    ).toBe(false);
  });

  test("an error never carries the password", async () => {
    jest
      .spyOn(DataSourceHttpFetch, "fetch")
      .mockImplementation(async (): Promise<DataSourceHttpResponse> => {
        throw new Error(
          "connect ECONNREFUSED for oneuptime_reader:s3cret@abc123 (s3cret)",
        );
      });

    await expect(
      collectTableHealth({
        engine: "clickhouse",
        connectionString: URL_CONNECTION,
      }),
    ).rejects.toThrow("connect ECONNREFUSED for ****@abc123 (****)");
  });
});

describe("ClickHouse elsewhere", () => {
  test("the target is the host, port and database, never the login", () => {
    const target: unknown = readConnectionTarget({
      engine: "clickhouse",
      connectionString: URL_CONNECTION,
    });

    expect(target).toEqual({
      databaseName: "analytics",
      host: "abc123.us-east-1.aws.clickhouse.cloud",
      port: 8443,
    });
    expect(JSON.stringify(target)).not.toContain("s3cret");
  });

  test("an OpenLineage dataset is database.table, as MySQL's", () => {
    expect(
      parseDatasetName({
        namespace: "clickhouse://abc123.clickhouse.cloud:8443",
        name: "analytics.orders",
      }),
    ).toEqual({
      kind: DataStoreKind.ClickHouse,
      host: "abc123.clickhouse.cloud",
      database: "analytics",
      schema: "analytics",
      table: "orders",
    });
  });

  test("an upstream table of another database may be another store's", () => {
    expect(
      getUpstreamDataset("clickhouse", {
        source: DataAssetLineageSource.QueryHistory,
        upstreamDatabase: null,
        upstreamSchema: "raw",
        upstreamTable: "events",
        downstreamSchema: "analytics",
        downstreamTable: "daily",
        secondsSinceSeen: 1,
        seenBy: null,
      }),
    ).toEqual({ namespace: "clickhouse://", name: "raw.events" });
  });

  test("a check quotes with backticks and binds as a query parameter", () => {
    const statement: { sql: string; params: Array<string> } =
      buildDataCheckStatement("clickhouse", {
        type: DataCheckType.FormatMismatchPercent,
        schemaName: "analytics",
        tableName: "users",
        columnName: "email",
        pattern: "@",
      });

    expect(statement.sql).toBe(
      "SELECT 100.0 * SUM(CASE WHEN `email` IS NOT NULL AND NOT match(toString(`email`), {p1:String}) THEN 1 ELSE 0 END) / NULLIF(COUNT(`email`), 0) AS value FROM `analytics`.`users`",
    );
    expect(statement.params).toEqual(["@"]);
  });

  test("an orphan is a value NOT IN the referenced column: a LEFT JOIN fills defaults", () => {
    expect(
      buildDataCheckStatement("clickhouse", {
        type: DataCheckType.OrphanCount,
        schemaName: "analytics",
        tableName: "orders",
        columnName: "user_id",
        referenceSchemaName: "analytics",
        referenceTableName: "users",
        referenceColumnName: "id",
      }).sql,
    ).toBe(
      "SELECT COUNT(*) AS value FROM `analytics`.`orders` AS checked WHERE checked.`user_id` IS NOT NULL AND checked.`user_id` NOT IN (SELECT `id` FROM `analytics`.`users`)",
    );
  });

  test("numbers and text keep a NULL a NULL", () => {
    expect(
      buildDataCheckStatement("clickhouse", {
        type: DataCheckType.Average,
        schemaName: "analytics",
        tableName: "orders",
        columnName: "total",
      }).sql,
    ).toBe("SELECT AVG(toFloat64(`total`)) AS value FROM `analytics`.`orders`");
  });
});
