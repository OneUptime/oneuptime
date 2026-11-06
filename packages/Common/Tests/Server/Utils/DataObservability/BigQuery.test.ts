import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import BigQueryApi, {
  BigQueryConnection,
  buildBigQueryConnectionString,
  readBigQueryConnection,
  readBigQueryRows,
} from "../../../../Server/Utils/DataObservability/BigQueryApi";
import { readBigQueryKind } from "../../../../Server/Utils/DataObservability/TableHealthCollector";
import { readConnectionTarget } from "../../../../Server/Utils/DataObservability/TableHealthTarget";
import { buildDataCheckStatement } from "../../../../Server/Utils/DataObservability/DataCheckSql";
import { matchDataset } from "../../../../Server/Utils/DataObservability/DatasetMatching";
import {
  UsageAsset,
  UsageStore,
} from "../../../../Server/Utils/DataObservability/TableUsageMatching";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import { DataCheckType } from "../../../../Types/DataObservability/DataCheckType";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../../Types/JSON";

/*
 * A BigQuery dataset is collected with a service account - its Google Cloud
 * connection's, or one given by hand - as query jobs followed to their last
 * page; its tables match OpenLineage and dbt names by project, dataset and
 * table, whichever of a project's datasets holds them.
 */

const SERVICE_ACCOUNT: JSONObject = {
  type: "service_account",
  client_email: "oneuptime@my-project.iam.gserviceaccount.com",
  private_key: crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  }).privateKey,
  token_uri: "https://oauth2.googleapis.com/token",
};

function connection(): BigQueryConnection {
  return {
    projectId: "my-project",
    dataset: "analytics",
    location: "US",
    serviceAccountJson: JSON.stringify(SERVICE_ACCOUNT),
  };
}

function answer(body: JSONObject): DataSourceHttpResponse {
  return { statusCode: 200, bodyText: JSON.stringify(body), bodyJson: body };
}

describe("readBigQueryConnection", () => {
  test("reads the JSON, its key as an object or as text", () => {
    const fromObject: BigQueryConnection = readBigQueryConnection(
      JSON.stringify({
        projectId: "my-project",
        dataset: "analytics",
        location: "US",
        serviceAccountJson: SERVICE_ACCOUNT,
      }),
    );

    expect(fromObject).toEqual(connection());
    expect(
      readBigQueryConnection(buildBigQueryConnectionString(connection())),
    ).toEqual(connection());
  });

  test("says what is missing", () => {
    expect(() => {
      return readBigQueryConnection("{}");
    }).toThrow("projectId");
    expect(() => {
      return readBigQueryConnection(
        JSON.stringify({ projectId: "my-project", dataset: "analytics" }),
      );
    }).toThrow("service account key");
  });
});

describe("BigQueryApi", () => {
  test("a query's rows, keyed by field", () => {
    expect(
      readBigQueryRows({
        schema: { fields: [{ name: "table_id" }, { name: "row_count" }] },
        rows: [{ f: [{ v: "orders" }, { v: "120" }] }],
      }),
    ).toEqual([{ table_id: "orders", row_count: "120" }]);
  });

  test("signs in as the service account, waits for the job, and reads every page", async () => {
    const sent: Array<DataSourceHttpRequest> = [];
    const answers: Array<DataSourceHttpResponse> = [
      answer({ access_token: "token-1", expires_in: 3600 }),
      answer({
        jobComplete: false,
        jobReference: { jobId: "job-1", location: "US" },
      }),
      answer({
        jobComplete: true,
        jobReference: { jobId: "job-1", location: "US" },
        schema: { fields: [{ name: "value" }] },
        rows: [{ f: [{ v: "1" }] }],
        pageToken: "page-2",
      }),
      answer({ jobComplete: true, rows: [{ f: [{ v: "2" }] }] }),
    ];
    const api: BigQueryApi = new BigQueryApi({
      connection: connection(),
      transport: async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        sent.push(request);
        return answers.shift()!;
      },
    });

    const rows: Array<Record<string, unknown>> = await api.query({
      statement:
        "SELECT COUNT(*) AS value FROM `analytics`.`orders` WHERE s = ?",
      params: ["paid"],
    });

    expect(rows).toEqual([{ value: "1" }, { value: "2" }]);
    expect(sent[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(sent[1]!.url).toBe(
      "https://bigquery.googleapis.com/bigquery/v2/projects/my-project/queries",
    );
    expect(sent[1]!.headers?.["Authorization"]).toBe("Bearer token-1");
    expect(JSON.parse(String(sent[1]!.body))).toMatchObject({
      useLegacySql: false,
      location: "US",
      parameterMode: "POSITIONAL",
      queryParameters: [
        {
          parameterType: { type: "STRING" },
          parameterValue: { value: "paid" },
        },
      ],
    });
    expect(sent[3]!.url).toContain("pageToken=page-2");
  });
});

describe("the BigQuery catalog", () => {
  test("__TABLES__ types: 1 a table, 2 a view, the rest not watched", () => {
    expect(readBigQueryKind("1")).toBe(DataAssetKind.Table);
    expect(readBigQueryKind(2)).toBe(DataAssetKind.View);
    expect(readBigQueryKind("3")).toBe(null);
  });

  test("the target is the project, never the key", () => {
    const target: unknown = readConnectionTarget({
      engine: "bigquery",
      connectionString: buildBigQueryConnectionString(connection()),
    });

    expect(target).toEqual({
      databaseName: "my-project",
      host: null,
      port: null,
    });
    expect(JSON.stringify(target)).not.toContain("PRIVATE");
  });

  test("a check's names in backticks, its values by position, a pattern searched", () => {
    const statement: { sql: string; params: Array<string> } =
      buildDataCheckStatement("bigquery", {
        type: DataCheckType.FormatMismatchPercent,
        schemaName: "analytics",
        tableName: "orders",
        columnName: "email",
        pattern: "@",
      });

    expect(statement.sql).toContain(
      "NOT REGEXP_CONTAINS(CAST(`email` AS STRING), ?)",
    );
    expect(statement.sql).toContain("FROM `analytics`.`orders`");
    expect(statement.params).toEqual(["@"]);
  });
});

describe("matching a project's datasets", () => {
  const stores: Array<UsageStore> = [
    {
      dataStoreId: "store-analytics",
      kind: DataStoreKind.GcpBigQueryDataset,
      databaseName: "my-project",
      serverAddress: null,
    },
    {
      dataStoreId: "store-raw",
      kind: DataStoreKind.GcpBigQueryDataset,
      databaseName: "my-project",
      serverAddress: null,
    },
  ];
  const assets: Array<UsageAsset> = [
    {
      dataAssetId: "asset-orders",
      dataStoreId: "store-analytics",
      schemaName: "analytics",
      name: "orders",
    },
    {
      dataAssetId: "asset-events",
      dataStoreId: "store-raw",
      schemaName: "raw",
      name: "events",
    },
  ];

  test("each dataset is a store of the project: the table decides which", () => {
    expect(
      matchDataset({
        dataset: { namespace: "bigquery", name: "my-project.analytics.orders" },
        stores,
        assets,
      })?.dataAssetId,
    ).toBe("asset-orders");
    expect(
      matchDataset({
        dataset: { namespace: "bigquery", name: "my-project.raw.events" },
        stores,
        assets,
      })?.dataAssetId,
    ).toBe("asset-events");
    expect(
      matchDataset({
        dataset: { namespace: "bigquery", name: "other-project.raw.events" },
        stores,
        assets,
      }),
    ).toBe(null);
  });
});
