import { afterEach, describe, expect, jest, test } from "@jest/globals";
import AthenaApi, {
  athenaStringLiteral,
  readAthenaConnection,
  readAthenaRows,
} from "../../../../Server/Utils/DataObservability/AthenaApi";
import {
  collectTableHealth,
  readGlueKind,
  readGlueTable,
  TableHealthSnapshot,
} from "../../../../Server/Utils/DataObservability/TableHealthCollector";
import { readConnectionTarget } from "../../../../Server/Utils/DataObservability/TableHealthTarget";
import { buildDataCheckStatement } from "../../../../Server/Utils/DataObservability/DataCheckSql";
import { parseDatasetName } from "../../../../Server/Utils/DataObservability/OpenLineageEvent";
import { getDbtDataset } from "../../../../Server/Utils/DataObservability/DbtArtifacts";
import { DataCheckType } from "../../../../Types/DataObservability/DataCheckType";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../../Types/JSON";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";

/*
 * Amazon Athena is read a Glue database at a time: the catalog from Glue's
 * API (no data read, nothing billed), each Iceberg table's last commit
 * from its Glue table, and data checks as Athena queries.
 */

const CONNECTION: string = JSON.stringify({
  region: "us-east-1",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "secret/key",
  database: "analytics",
  workgroup: "checks",
  outputLocation: "s3://acme-athena-results/oneuptime/",
});

const NOW: Date = new Date("2026-11-04T12:00:00.000Z");

function json(body: unknown, statusCode: number = 200): DataSourceHttpResponse {
  return { statusCode, bodyText: JSON.stringify(body), bodyJson: body };
}

// The AWS JSON target a request asked for.
function targetOf(request: DataSourceHttpRequest): string {
  const headers: Record<string, string> = (request.headers || {}) as Record<
    string,
    string
  >;

  return headers["X-Amz-Target"] || headers["x-amz-target"] || "";
}

describe("readAthenaConnection", () => {
  test("the Region, the keys, the Glue database and the workgroup", () => {
    expect(readAthenaConnection(CONNECTION)).toEqual({
      region: "us-east-1",
      credentials: {
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: "secret/key",
      },
      database: "analytics",
      catalog: "AwsDataCatalog",
      workgroup: "checks",
      outputLocation: "s3://acme-athena-results/oneuptime/",
    });
  });

  test("what is missing is said", () => {
    expect(() => {
      return readAthenaConnection(
        JSON.stringify({
          accessKeyId: "a",
          secretAccessKey: "b",
          database: "d",
        }),
      );
    }).toThrow(/AWS Region/);
    expect(() => {
      return readAthenaConnection(
        JSON.stringify({ region: "us-east-1", database: "d" }),
      );
    }).toThrow(/access key ID/);
    expect(() => {
      return readAthenaConnection(
        JSON.stringify({
          region: "us-east-1",
          accessKeyId: "a",
          secretAccessKey: "b",
          database: "d",
          outputLocation: "https://x",
        }),
      );
    }).toThrow(/s3:\/\//);
  });
});

describe("the Glue catalog", () => {
  test("an Iceberg table's last commit is when it changed; a Hive table's update is not", () => {
    const iceberg: ReturnType<typeof readGlueTable> = readGlueTable(
      {
        Name: "orders",
        DatabaseName: "analytics",
        TableType: "EXTERNAL_TABLE",
        UpdateTime: NOW.getTime() / 1000 - 300,
        Parameters: {
          table_type: "ICEBERG",
          metadata_location: "s3://x/metadata/1.json",
          numRows: "1200",
        },
        StorageDescriptor: { Columns: [{ Name: "id", Type: "bigint" }] },
        PartitionKeys: [{ Name: "dt", Type: "string" }],
      } as JSONObject,
      NOW,
    );

    expect(iceberg!.table).toMatchObject({
      schema: "analytics",
      name: "orders",
      kind: DataAssetKind.Table,
      estimatedRows: 1200,
      secondsSinceChange: 300,
    });
    expect(
      iceberg!.columns.map(
        (column: { column: { name: string; position: number } }) => {
          return `${column.column.name}:${column.column.position}`;
        },
      ),
    ).toEqual(["id:1", "dt:2"]);

    expect(
      readGlueTable(
        {
          Name: "events",
          DatabaseName: "analytics",
          UpdateTime: NOW.getTime() / 1000 - 60,
          Parameters: { totalSize: "4096" },
        } as JSONObject,
        NOW,
      )!.table,
    ).toMatchObject({ secondsSinceChange: null, sizeInBytes: 4096 });
    expect(readGlueKind("VIRTUAL_VIEW")).toBe(DataAssetKind.View);
  });
});

describe("AthenaApi", () => {
  test("a check's values written in as quoted strings, followed until it ends, its header row skipped", async () => {
    const requests: Array<DataSourceHttpRequest> = [];
    let polls: number = 0;
    const api: AthenaApi = new AthenaApi({
      connection: readAthenaConnection(CONNECTION),
      wait: async (): Promise<void> => {},
      transport: async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        requests.push(request);

        switch (targetOf(request)) {
          case "AmazonAthena.StartQueryExecution":
            return json({ QueryExecutionId: "q1" });
          case "AmazonAthena.GetQueryExecution":
            polls++;
            return json({
              QueryExecution: {
                Status: { State: polls < 2 ? "RUNNING" : "SUCCEEDED" },
              },
            });
          default:
            return json({
              ResultSet: {
                ResultSetMetadata: { ColumnInfo: [{ Name: "value" }] },
                Rows: [
                  { Data: [{ VarCharValue: "value" }] },
                  { Data: [{ VarCharValue: "3" }] },
                ],
              },
            });
        }
      },
    });

    expect(
      await api.query({
        statement:
          'SELECT COUNT(*) AS value FROM "analytics"."orders" WHERE status NOT IN (?)',
        params: ["it's"],
      }),
    ).toEqual([{ value: "3" }]);

    const start: JSONObject = JSON.parse(
      String(requests[0]!.body),
    ) as JSONObject;

    expect(start["QueryString"]).toBe(
      "SELECT COUNT(*) AS value FROM \"analytics\".\"orders\" WHERE status NOT IN ('it''s')",
    );
    expect(start["WorkGroup"]).toBe("checks");
    expect(start["QueryExecutionContext"]).toEqual({
      Database: "analytics",
      Catalog: "AwsDataCatalog",
    });
    expect(
      String(
        requests[0]!.headers!["Authorization"] ||
          requests[0]!.headers!["authorization"],
      ),
    ).toContain("AWS4-HMAC-SHA256");
    expect(polls).toBe(2);
  });

  test("a failed query says why", async () => {
    const api: AthenaApi = new AthenaApi({
      connection: readAthenaConnection(CONNECTION),
      transport: async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        return targetOf(request) === "AmazonAthena.StartQueryExecution"
          ? json({ QueryExecutionId: "q2" })
          : json({
              QueryExecution: {
                Status: {
                  State: "FAILED",
                  StateChangeReason: "TABLE_NOT_FOUND: orders",
                },
              },
            });
      },
    });

    await expect(api.query({ statement: "SELECT 1" })).rejects.toThrow(
      "The Athena query failed: TABLE_NOT_FOUND: orders",
    );
  });

  test("strings are quoted with their quotes doubled; rows read without a header when asked", () => {
    expect(athenaStringLiteral("a'b")).toBe("'a''b'");
    expect(
      readAthenaRows(
        {
          ResultSetMetadata: {
            ColumnInfo: [{ Name: "SEGMENT" }, { Name: "value" }],
          },
          Rows: [{ Data: [{ VarCharValue: "eu" }, {}] }],
        },
        false,
      ),
    ).toEqual([{ segment: "eu", value: null }]);
  });
});

describe("collecting a Glue database", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("its tables from Glue, with no query run", async () => {
    const targets: Array<string> = [];

    jest
      .spyOn(DataSourceHttpFetch, "fetch")
      .mockImplementation(
        async (
          request: DataSourceHttpRequest,
        ): Promise<DataSourceHttpResponse> => {
          targets.push(targetOf(request));

          if (targetOf(request) === "AWSGlue.GetDatabase") {
            return json({ Database: { Name: "analytics" } });
          }

          return json({
            TableList: [
              {
                Name: "orders",
                DatabaseName: "analytics",
                UpdateTime: Date.now() / 1000 - 120,
                Parameters: { table_type: "ICEBERG" },
                StorageDescriptor: {
                  Columns: [{ Name: "id", Type: "bigint" }],
                },
              },
              {
                Name: "orders_v",
                DatabaseName: "analytics",
                TableType: "VIRTUAL_VIEW",
              },
            ],
          });
        },
      );

    const snapshot: TableHealthSnapshot = await collectTableHealth({
      engine: "athena",
      connectionString: CONNECTION,
    });

    expect(targets).toEqual(["AWSGlue.GetDatabase", "AWSGlue.GetTables"]);
    expect(
      snapshot.tables.map((table: { name: string; kind: DataAssetKind }) => {
        return `${table.name}:${table.kind}`;
      }),
    ).toEqual(["orders:Table", "orders_v:View"]);
    expect(snapshot.tables[0]!.secondsSinceChange).toBeGreaterThanOrEqual(119);
    expect(snapshot.target).toEqual({
      databaseName: "analytics",
      host: "athena.us-east-1.amazonaws.com",
      port: 443,
    });
  });
});

describe("Athena elsewhere", () => {
  test("a check in Trino's SQL: VARCHAR, DOUBLE and regexp_like", () => {
    expect(
      buildDataCheckStatement("athena", {
        type: DataCheckType.FormatMismatchPercent,
        schemaName: "analytics",
        tableName: "users",
        columnName: "email",
        pattern: "@",
      }).sql,
    ).toContain('NOT regexp_like(CAST("email" AS VARCHAR), ?)');
    expect(
      buildDataCheckStatement("athena", {
        type: DataCheckType.Average,
        schemaName: "analytics",
        tableName: "orders",
        columnName: "total",
      }).sql,
    ).toBe(
      'SELECT AVG(CAST("total" AS DOUBLE)) AS value FROM "analytics"."orders"',
    );
  });

  test("OpenLineage's and dbt's catalog.database.table is the Glue database's table", () => {
    expect(
      parseDatasetName({
        namespace: "awsathena://athena.us-east-1.amazonaws.com",
        name: "awsdatacatalog.analytics.orders",
      }),
    ).toEqual({
      kind: DataStoreKind.AwsAthena,
      host: "athena.us-east-1.amazonaws.com",
      database: "analytics",
      schema: "analytics",
      table: "orders",
    });
    expect(
      getDbtDataset("athena", {
        uniqueId: "model.shop.orders",
        resourceType: "model",
        name: "orders",
        database: "awsdatacatalog",
        schema: "analytics",
        relation: "orders",
        materialization: "table",
        description: null,
        owner: null,
        tags: [],
        upstreamUniqueIds: [],
      } as never),
    ).toEqual({
      namespace: "awsathena://",
      name: "awsdatacatalog.analytics.orders",
    });
  });

  test("the target never holds the keys", () => {
    expect(
      JSON.stringify(
        readConnectionTarget({
          engine: "athena",
          connectionString: CONNECTION,
        }),
      ),
    ).not.toContain("secret");
  });
});
