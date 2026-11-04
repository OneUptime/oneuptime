import { afterEach, describe, expect, jest, test } from "@jest/globals";
import DatabricksApi, {
  DatabricksConnection,
  readDatabricksConnection,
  readDatabricksRows,
  readWarehouseId,
} from "../../../../Server/Utils/DataObservability/DatabricksApi";
import {
  buildDatabricksLineageQuery,
  collectTableHealth,
  readDatabricksKind,
  readDatabricksLineageRows,
  readDatabricksTable,
  TableHealthSnapshot,
} from "../../../../Server/Utils/DataObservability/TableHealthCollector";
import { readConnectionTarget } from "../../../../Server/Utils/DataObservability/TableHealthTarget";
import { buildDataCheckStatement } from "../../../../Server/Utils/DataObservability/DataCheckSql";
import { getUpstreamDataset } from "../../../../Server/Utils/DataObservability/CollectedLineage";
import {
  getConnectionSecrets,
  sanitizeErrorMessage,
} from "../../../../Server/Utils/DataSecurity/Content/DatabaseSampler";
import { DataCheckType } from "../../../../Types/DataObservability/DataCheckType";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import DataAssetLineageSource from "../../../../Types/DataObservability/DataAssetLineageSource";
import { JSONObject } from "../../../../Types/JSON";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";

/*
 * Databricks is read a Unity Catalog catalog at a time: the catalog from
 * Unity Catalog's REST API with no warehouse, each Delta table's last
 * commit from its properties, and checks and lineage on a SQL warehouse.
 */

const HOST: string = "adb-1234567890123456.7.azuredatabricks.net";
const NOW: Date = new Date("2026-11-04T12:00:00.000Z");

function connection(
  overrides: Partial<DatabricksConnection> = {},
): DatabricksConnection {
  return {
    host: HOST,
    token: "dapi0123456789abcdef",
    clientId: null,
    clientSecret: null,
    catalog: "main",
    warehouseId: "abc123def456",
    ...overrides,
  };
}

function json(body: unknown, statusCode: number = 200): DataSourceHttpResponse {
  return { statusCode, bodyText: JSON.stringify(body), bodyJson: body };
}

describe("readDatabricksConnection", () => {
  test("JSON with a personal access token", () => {
    expect(
      readDatabricksConnection(
        JSON.stringify({
          host: `https://${HOST}/`,
          token: "dapi0123456789abcdef",
          catalog: "main",
          warehouseId: "abc123def456",
        }),
      ),
    ).toEqual(connection());
  });

  test("JSON for a service principal, the warehouse from its HTTP path", () => {
    expect(
      readDatabricksConnection(
        JSON.stringify({
          host: HOST,
          clientId: "sp-client",
          clientSecret: "sp-secret",
          catalog: "main",
          httpPath: "/sql/1.0/warehouses/abc123def456",
        }),
      ),
    ).toEqual(
      connection({
        token: null,
        clientId: "sp-client",
        clientSecret: "sp-secret",
      }),
    );
  });

  test("the URL Databricks' drivers take", () => {
    expect(
      readDatabricksConnection(
        `databricks://token:dapi0123456789abcdef@${HOST}?http_path=%2Fsql%2F1.0%2Fwarehouses%2Fabc123def456&catalog=main`,
      ),
    ).toEqual(connection());
  });

  test("no warehouse is allowed: the catalog is read without one", () => {
    expect(
      readDatabricksConnection(
        JSON.stringify({
          host: HOST,
          token: "dapi0123456789abcdef",
          catalog: "main",
        }),
      ).warehouseId,
    ).toBe(null);
  });

  test("what is missing is said", () => {
    expect(() => {
      return readDatabricksConnection(
        JSON.stringify({ token: "x", catalog: "main" }),
      );
    }).toThrow(/workspace's host/);
    expect(() => {
      return readDatabricksConnection(
        JSON.stringify({ host: HOST, token: "x" }),
      );
    }).toThrow(/catalog to watch/);
    expect(() => {
      return readDatabricksConnection(
        JSON.stringify({ host: HOST, catalog: "main" }),
      );
    }).toThrow(/personal access token, or a service principal/);
  });

  test("a warehouse's ID, from itself or its path", () => {
    expect(readWarehouseId("abc123def456")).toBe("abc123def456");
    expect(readWarehouseId("/sql/1.0/endpoints/abc123def456")).toBe(
      "abc123def456",
    );
    expect(readWarehouseId("not a warehouse!")).toBe(null);
  });
});

describe("DatabricksApi", () => {
  test("a service principal's token is bought once, then sent", async () => {
    const requests: Array<DataSourceHttpRequest> = [];
    const api: DatabricksApi = new DatabricksApi({
      connection: connection({
        token: null,
        clientId: "sp-client",
        clientSecret: "sp-secret",
      }),
      transport: async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        requests.push(request);
        return request.url.endsWith("/oidc/v1/token")
          ? json({ access_token: "oauth-token", expires_in: 3600 })
          : json({ name: "main" });
      },
    });

    await api.getCatalog();
    await api.getCatalog();

    expect(
      requests.map((request: DataSourceHttpRequest): string => {
        return request.url;
      }),
    ).toEqual([
      `https://${HOST}/oidc/v1/token`,
      `https://${HOST}/api/2.1/unity-catalog/catalogs/main`,
      `https://${HOST}/api/2.1/unity-catalog/catalogs/main`,
    ]);
    expect(requests[0]!.body).toEqual({
      grant_type: "client_credentials",
      scope: "all-apis",
    });
    expect(requests[0]!.headers!["Authorization"]).toBe(
      `Basic ${Buffer.from("sp-client:sp-secret").toString("base64")}`,
    );
    expect(requests[2]!.headers!["Authorization"]).toBe("Bearer oauth-token");
  });

  test("a statement still running is followed, then its chunks read", async () => {
    const requests: Array<DataSourceHttpRequest> = [];
    const manifest: JSONObject = {
      schema: { columns: [{ name: "VALUE" }] },
    };
    const api: DatabricksApi = new DatabricksApi({
      connection: connection(),
      wait: async (): Promise<void> => {},
      transport: async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        requests.push(request);

        if (request.method === "POST") {
          return json({ statement_id: "st-1", status: { state: "PENDING" } });
        }

        if (request.url.endsWith("/result/chunks/1")) {
          return json({ data_array: [["2"]] });
        }

        return json({
          statement_id: "st-1",
          status: { state: "SUCCEEDED" },
          manifest,
          result: { data_array: [["1"]], next_chunk_index: 1 },
        });
      },
    });

    expect(
      await api.query({ statement: "SELECT :p1 AS value", params: ["x"] }),
    ).toEqual([{ value: "1" }, { value: "2" }]);

    const body: JSONObject = JSON.parse(
      String(requests[0]!.body),
    ) as JSONObject;

    expect(body).toMatchObject({
      statement: "SELECT :p1 AS value",
      warehouse_id: "abc123def456",
      catalog: "main",
      parameters: [{ name: "p1", value: "x", type: "STRING" }],
      on_wait_timeout: "CONTINUE",
      disposition: "INLINE",
      format: "JSON_ARRAY",
    });
    expect(requests[1]!.url).toBe(
      `https://${HOST}/api/2.0/sql/statements/st-1`,
    );
  });

  test("a failed statement says why", async () => {
    const api: DatabricksApi = new DatabricksApi({
      connection: connection(),
      transport: async (): Promise<DataSourceHttpResponse> => {
        return json({
          statement_id: "st-2",
          status: {
            state: "FAILED",
            error: { message: "[TABLE_OR_VIEW_NOT_FOUND] main.sales.nope" },
          },
        });
      },
    });

    await expect(api.query({ statement: "SELECT 1" })).rejects.toThrow(
      "The Databricks statement failed: [TABLE_OR_VIEW_NOT_FOUND] main.sales.nope",
    );
  });

  test("a check without a warehouse says to name one", async () => {
    const api: DatabricksApi = new DatabricksApi({
      connection: connection({ warehouseId: null }),
      transport: async (): Promise<DataSourceHttpResponse> => {
        throw new Error("never sent");
      },
    });

    await expect(api.query({ statement: "SELECT 1" })).rejects.toThrow(
      /Name a SQL warehouse/,
    );
  });

  test("rows are keyed by their columns' names in lower case", () => {
    expect(
      readDatabricksRows(
        { schema: { columns: [{ name: "Segment" }, { name: "VALUE" }] } },
        [
          ["eu", "3"],
          ["us", null],
        ],
      ),
    ).toEqual([
      { segment: "eu", value: "3" },
      { segment: "us", value: null },
    ]);
  });
});

describe("the Databricks catalog", () => {
  test("each table type's kind", () => {
    expect(readDatabricksKind("MANAGED")).toBe(DataAssetKind.Table);
    expect(readDatabricksKind("STREAMING_TABLE")).toBe(DataAssetKind.Table);
    expect(readDatabricksKind("VIEW")).toBe(DataAssetKind.View);
    expect(readDatabricksKind("MATERIALIZED_VIEW")).toBe(
      DataAssetKind.MaterializedView,
    );
    expect(readDatabricksKind("FOREIGN")).toBe(DataAssetKind.ForeignTable);
    expect(readDatabricksKind(undefined)).toBe(null);
  });

  test("a Delta table's last commit, statistics and columns", () => {
    expect(
      readDatabricksTable(
        {
          name: "orders",
          schema_name: "sales",
          table_type: "MANAGED",
          properties: {
            "delta.lastCommitTimestamp": String(NOW.getTime() - 90_000),
            "delta.lastUpdateVersion": "41",
            "spark.sql.statistics.numRows": "1000",
            "spark.sql.statistics.totalSize": "4096",
          },
          columns: [
            { name: "id", type_text: "bigint", nullable: false, position: 0 },
            { name: "Note", type_text: "STRING", position: 1 },
          ],
        },
        NOW,
      ),
    ).toEqual({
      table: {
        schema: "sales",
        name: "orders",
        kind: DataAssetKind.Table,
        estimatedRows: 1000,
        sizeInBytes: 4096,
        writeCount: 41,
        secondsSinceChange: 90,
        readCount: null,
        secondsSinceRead: null,
      },
      columns: [
        {
          schema: "sales",
          table: "orders",
          column: {
            name: "id",
            dataType: "bigint",
            isNullable: false,
            position: 1,
          },
        },
        {
          schema: "sales",
          table: "orders",
          column: {
            name: "Note",
            dataType: "string",
            isNullable: true,
            position: 2,
          },
        },
      ],
      viewSources: [],
    });
  });

  test("a view's dependencies are its sources; its updated_at is never a change", () => {
    const read: ReturnType<typeof readDatabricksTable> = readDatabricksTable(
      {
        name: "orders_v",
        schema_name: "sales",
        table_type: "VIEW",
        updated_at: NOW.getTime() - 1000,
        view_dependencies: {
          dependencies: [
            { table: { table_full_name: "main.sales.orders" } },
            { function: { function_full_name: "main.sales.f" } },
          ],
        },
      },
      NOW,
    );

    expect(read!.table.secondsSinceChange).toBe(null);
    expect(read!.viewSources).toEqual([
      { database: "main", schema: "sales", table: "orders" },
    ]);
  });

  test("the lineage table: edges, last writes and last reads", () => {
    const read: ReturnType<typeof readDatabricksLineageRows> =
      readDatabricksLineageRows(
        [
          {
            source_catalog: "main",
            source_schema: "raw",
            source_table: "events",
            target_catalog: "main",
            target_schema: "sales",
            target_table: "orders",
            seconds_since_seen: "300",
            seen_by: "etl@acme.com",
          },
          {
            source_catalog: "other",
            source_schema: "ref",
            source_table: "fx",
            target_catalog: "main",
            target_schema: "sales",
            target_table: "orders",
            seconds_since_seen: "600",
            seen_by: "etl@acme.com",
          },
          {
            source_catalog: "main",
            source_schema: "sales",
            source_table: "orders",
            target_catalog: null,
            target_schema: null,
            target_table: null,
            seconds_since_seen: "60",
            seen_by: "analyst@acme.com",
          },
        ],
        "main",
      );

    expect(read.edges).toEqual([
      {
        source: DataAssetLineageSource.QueryHistory,
        upstreamDatabase: null,
        upstreamSchema: "raw",
        upstreamTable: "events",
        downstreamSchema: "sales",
        downstreamTable: "orders",
        secondsSinceSeen: 300,
        seenBy: "etl@acme.com",
      },
      {
        source: DataAssetLineageSource.QueryHistory,
        upstreamDatabase: "other",
        upstreamSchema: "ref",
        upstreamTable: "fx",
        downstreamSchema: "sales",
        downstreamTable: "orders",
        secondsSinceSeen: 600,
        seenBy: "etl@acme.com",
      },
    ]);
    expect(read.writtenAgo.get("sales\u0000orders")).toBe(300);
    expect(read.readAgo.get("sales\u0000orders")).toBe(60);
    expect(read.readAgo.get("raw\u0000events")).toBe(300);
  });

  test("the lineage query binds the catalog and leaves OneUptime's own reads out", () => {
    const sql: string = buildDatabricksLineageQuery(3600);

    expect(sql).toContain("FROM system.access.table_lineage");
    expect(sql).toContain(
      "source_table_catalog = :catalog OR target_table_catalog = :catalog",
    );
    expect(sql).toContain("TIMESTAMPADD(SECOND, -3600, CURRENT_TIMESTAMP())");
    expect(sql).toContain("created_by <> current_user()");
  });
});

describe("collecting a Databricks catalog", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function workspace(statements: Array<JSONObject>): void {
    jest
      .spyOn(DataSourceHttpFetch, "fetch")
      .mockImplementation(
        async (
          request: DataSourceHttpRequest,
        ): Promise<DataSourceHttpResponse> => {
          const url: URL = new URL(request.url);

          if (url.pathname === "/api/2.1/unity-catalog/catalogs/main") {
            return json({ name: "main" });
          }

          if (url.pathname === "/api/2.1/unity-catalog/schemas") {
            return json({
              schemas: [{ name: "information_schema" }, { name: "sales" }],
            });
          }

          if (url.pathname === "/api/2.1/unity-catalog/tables") {
            expect(url.searchParams.get("schema_name")).toBe("sales");

            return json({
              tables: [
                {
                  name: "orders",
                  schema_name: "sales",
                  table_type: "MANAGED",
                  properties: {
                    "delta.lastCommitTimestamp": String(Date.now() - 120_000),
                    "delta.lastUpdateVersion": "7",
                  },
                  columns: [{ name: "id", type_text: "bigint", position: 0 }],
                },
                {
                  name: "refunds",
                  schema_name: "sales",
                  table_type: "EXTERNAL",
                  properties: {},
                  columns: [],
                },
                {
                  name: "orders_v",
                  schema_name: "sales",
                  table_type: "VIEW",
                  view_dependencies: {
                    dependencies: [
                      { table: { table_full_name: "main.sales.orders" } },
                    ],
                  },
                },
              ],
            });
          }

          if (url.pathname === "/api/2.0/sql/statements/") {
            statements.push(JSON.parse(String(request.body)) as JSONObject);

            return json({
              statement_id: "st-1",
              status: { state: "SUCCEEDED" },
              manifest: {
                schema: {
                  columns: [
                    { name: "source_catalog" },
                    { name: "source_schema" },
                    { name: "source_table" },
                    { name: "target_catalog" },
                    { name: "target_schema" },
                    { name: "target_table" },
                    { name: "seconds_since_seen" },
                    { name: "seen_by" },
                  ],
                },
              },
              result: {
                data_array: [
                  [
                    "main",
                    "sales",
                    "orders",
                    "main",
                    "sales",
                    "refunds",
                    "900",
                    "etl",
                  ],
                ],
              },
            });
          }

          throw new Error(`Unexpected request: ${request.url}`);
        },
      );
  }

  test("every 5 minutes: the catalog alone, with no warehouse started", async () => {
    const statements: Array<JSONObject> = [];

    workspace(statements);

    const snapshot: TableHealthSnapshot = await collectTableHealth({
      engine: "databricks",
      connectionString: JSON.stringify({
        host: HOST,
        token: "dapi0123456789abcdef",
        catalog: "main",
        warehouseId: "abc123def456",
      }),
    });

    expect(statements).toEqual([]);
    expect(
      snapshot.tables.map((table: { name: string; kind: DataAssetKind }) => {
        return `${table.name}:${table.kind}`;
      }),
    ).toEqual(["orders:Table", "refunds:Table", "orders_v:View"]);
    expect(snapshot.tables[0]!.writeCount).toBe(7);
    expect(snapshot.tables[0]!.secondsSinceChange).toBeGreaterThanOrEqual(119);
    expect(snapshot.tables[1]!.secondsSinceChange).toBe(null);
    expect(snapshot.lineage).toEqual([
      {
        source: DataAssetLineageSource.ViewDefinition,
        upstreamDatabase: null,
        upstreamSchema: "sales",
        upstreamTable: "orders",
        downstreamSchema: "sales",
        downstreamTable: "orders_v",
        secondsSinceSeen: null,
        seenBy: null,
      },
    ]);
    expect(snapshot.target).toEqual({
      databaseName: "main",
      host: HOST,
      port: 443,
    });
  });

  test("once an hour: lineage, and last writes where no commit is known, on the warehouse", async () => {
    const statements: Array<JSONObject> = [];

    workspace(statements);

    const snapshot: TableHealthSnapshot = await collectTableHealth(
      {
        engine: "databricks",
        connectionString: JSON.stringify({
          host: HOST,
          token: "dapi0123456789abcdef",
          catalog: "main",
          warehouseId: "abc123def456",
        }),
      },
      {
        maxTables: 100,
        maxColumns: 1000,
        exclusions: [],
        queryHistoryLookbackInSeconds: 3600,
      },
    );

    expect(statements).toHaveLength(1);
    expect(statements[0]!["parameters"]).toEqual([
      { name: "catalog", value: "main", type: "STRING" },
    ]);
    // refunds has no commit in its properties: the lineage table says when it was written.
    expect(snapshot.tables[1]!.secondsSinceChange).toBe(900);
    expect(snapshot.tables[0]!.secondsSinceRead).toBe(900);
    expect(
      snapshot.lineage!.map(
        (edge: {
          upstreamTable: string;
          downstreamTable: string;
          source: string;
        }) => {
          return `${edge.upstreamTable} -> ${edge.downstreamTable} (${edge.source})`;
        },
      ),
    ).toEqual([
      "orders -> orders_v (View Definition)",
      "orders -> refunds (Query History)",
    ]);
  });

  test("once an hour without a warehouse: the catalog, and what lineage needs", async () => {
    workspace([]);

    const snapshot: TableHealthSnapshot = await collectTableHealth(
      {
        engine: "databricks",
        connectionString: JSON.stringify({
          host: HOST,
          token: "dapi0123456789abcdef",
          catalog: "main",
        }),
      },
      {
        maxTables: 100,
        maxColumns: 1000,
        exclusions: [],
        queryHistoryLookbackInSeconds: 3600,
      },
    );

    expect(snapshot.tables).toHaveLength(3);
    expect(snapshot.warnings).toEqual([
      "Lineage from query history, and when each table was last read, need a SQL warehouse in the Databricks connection.",
    ]);
  });
});

describe("Databricks elsewhere", () => {
  test("a token in a JSON connection never reaches an error", () => {
    const connectionString: string = JSON.stringify({
      host: HOST,
      token: "dapi0123456789abcdef",
      catalog: "main",
    });

    expect(
      sanitizeErrorMessage(
        new Error("401 for token dapi0123456789abcdef"),
        getConnectionSecrets(connectionString),
      ),
    ).toBe("401 for token ****");
  });

  test("the target is the workspace and the catalog", () => {
    expect(
      readConnectionTarget({
        engine: "databricks",
        connectionString: JSON.stringify({
          host: HOST,
          clientId: "sp",
          clientSecret: "secret",
          catalog: "main",
        }),
      }),
    ).toEqual({ databaseName: "main", host: HOST, port: 443 });
  });

  test("an upstream table of another catalog may be another store's", () => {
    expect(
      getUpstreamDataset("databricks", {
        source: DataAssetLineageSource.QueryHistory,
        upstreamDatabase: "other",
        upstreamSchema: "ref",
        upstreamTable: "fx",
        downstreamSchema: "sales",
        downstreamTable: "orders",
        secondsSinceSeen: 1,
        seenBy: null,
      }),
    ).toEqual({ namespace: "databricks://", name: "other.ref.fx" });
  });

  test("a check quotes with backticks and binds by name", () => {
    const statement: { sql: string; params: Array<string> } =
      buildDataCheckStatement("databricks", {
        type: DataCheckType.InvalidPercent,
        schemaName: "sales",
        tableName: "orders",
        columnName: "status",
        acceptedValues: ["paid", "refunded"],
      });

    expect(statement.sql).toBe(
      "SELECT 100.0 * SUM(CASE WHEN `status` IS NOT NULL AND CAST(`status` AS STRING) NOT IN (:p1, :p2) THEN 1 ELSE 0 END) / NULLIF(COUNT(`status`), 0) AS value FROM `sales`.`orders`",
    );
    expect(statement.params).toEqual(["paid", "refunded"]);
  });

  test("a pattern searches each value with RLIKE", () => {
    expect(
      buildDataCheckStatement("databricks", {
        type: DataCheckType.FormatMismatchPercent,
        schemaName: "sales",
        tableName: "users",
        columnName: "email",
        pattern: "@",
      }).sql,
    ).toContain("NOT (CAST(`email` AS STRING) RLIKE :p1)");
  });
});
