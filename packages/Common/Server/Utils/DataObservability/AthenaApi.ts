import { JSONObject } from "../../../Types/JSON";
import { AwsCredentials, sendAwsRequest } from "../CloudConnection/Aws/AwsApi";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../DataSource/HttpFetch";

/*
 * AMAZON ATHENA AND THE AWS GLUE DATA CATALOG, OVER THEIR APIS.
 *
 * A Glue database is a store: its tables - Iceberg, Hive-style and views -
 * with their columns, last update and statistics, read from the Glue Data
 * Catalog's own API (GetTables), which reads no data and costs nothing. A
 * data check reads a table's rows, so it runs as an Athena query in the
 * connection's workgroup, followed until it ends. Every request is signed
 * with Signature Version 4, as every AWS call of OneUptime is.
 *
 * The connection is JSON: { region, accessKeyId, secretAccessKey,
 * sessionToken?, database, catalog?, workgroup?, outputLocation? } - the
 * keys of an IAM user or role that may read the Glue database and run
 * Athena queries in the workgroup.
 */

export interface AthenaConnection {
  region: string;
  credentials: AwsCredentials;
  database: string;
  // Athena's data catalog: AwsDataCatalog for Glue.
  catalog: string;
  workgroup: string;
  // Where Athena writes results, when the workgroup does not say.
  outputLocation: string | null;
}

export type AthenaTransport = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;

const PROVIDER_TITLE: string = "Amazon Athena";
const REGION_PATTERN: RegExp = /^[a-z]{2}(-[a-z]+)+-\d$/;
const NAME_PATTERN: RegExp = /^[A-Za-z0-9_-]{1,255}$/;
const MAX_TABLE_PAGES: number = 100;
// A query on a table's rows: how long it is followed, and how often asked after.
export const ATHENA_QUERY_DEADLINE_IN_MS: number = 4 * 60 * 1000;
const POLL_WAIT_IN_MS: number = 1_500;
const MAX_RESULT_PAGES: number = 20;

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function readArray(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : [];
}

// The connection a store's string describes; why not, when it describes none.
export function readAthenaConnection(value: string): AthenaConnection {
  let raw: JSONObject = {};

  try {
    raw = (value || "").trim().startsWith("{")
      ? (JSON.parse(value) as JSONObject)
      : {};
  } catch {
    raw = {};
  }

  const connection: AthenaConnection = {
    region: readText(raw["region"]).toLowerCase(),
    credentials: {
      accessKeyId: readText(raw["accessKeyId"]),
      secretAccessKey: readText(raw["secretAccessKey"]),
      ...(readText(raw["sessionToken"])
        ? { sessionToken: readText(raw["sessionToken"]) }
        : {}),
    },
    database: readText(raw["database"]),
    catalog: readText(raw["catalog"]) || "AwsDataCatalog",
    workgroup: readText(raw["workgroup"]) || "primary",
    outputLocation: readText(raw["outputLocation"]) || null,
  };

  if (!REGION_PATTERN.test(connection.region)) {
    throw new Error(
      "The Athena connection needs the AWS Region its Glue database is in, such as us-east-1.",
    );
  }

  if (
    !connection.credentials.accessKeyId ||
    !connection.credentials.secretAccessKey
  ) {
    throw new Error(
      "The Athena connection needs an access key ID and secret access key that may read the Glue database.",
    );
  }

  for (const [name, part] of [
    ["database", connection.database],
    ["catalog", connection.catalog],
    ["workgroup", connection.workgroup],
  ] as Array<[string, string]>) {
    if (!NAME_PATTERN.test(part)) {
      throw new Error(`The Athena connection needs its ${name}.`);
    }
  }

  if (
    connection.outputLocation &&
    !connection.outputLocation.startsWith("s3://")
  ) {
    throw new Error("The Athena output location must be an s3:// address.");
  }

  return connection;
}

// A value written into a query as Athena reads a string: quoted, its quotes doubled.
export function athenaStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// Athena's result rows, the header row skipped, each keyed by its column's name in lower case.
export function readAthenaRows(
  resultSet: JSONObject,
  skipHeader: boolean,
): Array<Record<string, unknown>> {
  const names: Array<string> = readArray(
    readObject(resultSet["ResultSetMetadata"])["ColumnInfo"],
  ).map((column: unknown): string => {
    return readText(readObject(column)["Name"]).toLowerCase();
  });
  const rows: Array<Record<string, unknown>> = [];

  readArray(resultSet["Rows"]).forEach((rowValue: unknown, index: number) => {
    if (skipHeader && index === 0) {
      return;
    }

    const data: Array<unknown> = readArray(readObject(rowValue)["Data"]);
    const row: Record<string, unknown> = {};

    names.forEach((name: string, column: number) => {
      const cell: JSONObject = readObject(data[column]);

      row[name] = "VarCharValue" in cell ? cell["VarCharValue"] : null;
    });
    rows.push(row);
  });

  return rows;
}

export default class AthenaApi {
  private readonly connection: AthenaConnection;
  private readonly transport: AthenaTransport;
  private readonly now: () => number;
  private readonly wait: (ms: number) => Promise<void>;

  public constructor(data: {
    connection: AthenaConnection;
    transport?: AthenaTransport | undefined;
    now?: (() => number) | undefined;
    wait?: ((ms: number) => Promise<void>) | undefined;
  }) {
    this.connection = data.connection;
    this.transport =
      data.transport || DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch);
    this.now =
      data.now ||
      ((): number => {
        return Date.now();
      });
    this.wait =
      data.wait ||
      ((ms: number): Promise<void> => {
        return new Promise((resolve: () => void) => {
          setTimeout(resolve, ms);
        });
      });
  }

  public get database(): string {
    return this.connection.database;
  }

  private async call(
    service: "glue" | "athena",
    target: string,
    body: JSONObject,
  ): Promise<JSONObject> {
    const answer: { json: JSONObject; text: string } = await sendAwsRequest({
      transport: this.transport,
      credentials: this.connection.credentials,
      service,
      region: this.connection.region,
      target,
      jsonVersion: "1.1",
      body,
      step: target,
      providerTitle: PROVIDER_TITLE,
    });

    return answer.json;
  }

  // The Glue database itself: a connection that cannot read it cannot collect.
  public async getDatabase(): Promise<JSONObject> {
    return await this.call("glue", "AWSGlue.GetDatabase", {
      Name: this.connection.database,
    });
  }

  // Every table and view of the Glue database, with its columns and parameters.
  public async listTables(maxTables: number): Promise<Array<JSONObject>> {
    const tables: Array<JSONObject> = [];
    let nextToken: string = "";

    for (let page: number = 0; page < MAX_TABLE_PAGES; page++) {
      const body: JSONObject = await this.call("glue", "AWSGlue.GetTables", {
        DatabaseName: this.connection.database,
        MaxResults: 100,
        ...(nextToken ? { NextToken: nextToken } : {}),
      });

      for (const table of readArray(body["TableList"])) {
        if (tables.length >= maxTables) {
          return tables;
        }

        tables.push(readObject(table));
      }

      nextToken = readText(body["NextToken"]);

      if (!nextToken) {
        break;
      }
    }

    return tables;
  }

  /*
   * One query's rows, in the workgroup, its values written in as quoted
   * strings in place of each ?: followed until it ends, and stopped past
   * the deadline.
   */
  public async query(data: {
    statement: string;
    params?: Array<string> | undefined;
  }): Promise<Array<Record<string, unknown>>> {
    const params: Array<string> = data.params || [];
    let index: number = 0;
    const statement: string = data.statement.replace(/\?/g, (): string => {
      const value: string | undefined = params[index++];

      return value === undefined ? "?" : athenaStringLiteral(value);
    });
    const started: JSONObject = await this.call(
      "athena",
      "AmazonAthena.StartQueryExecution",
      {
        QueryString: statement,
        QueryExecutionContext: {
          Database: this.connection.database,
          Catalog: this.connection.catalog,
        },
        WorkGroup: this.connection.workgroup,
        ...(this.connection.outputLocation
          ? {
              ResultConfiguration: {
                OutputLocation: this.connection.outputLocation,
              },
            }
          : {}),
      },
    );
    const executionId: string = readText(started["QueryExecutionId"]);
    const startedAt: number = this.now();

    for (;;) {
      const execution: JSONObject = readObject(
        (
          await this.call("athena", "AmazonAthena.GetQueryExecution", {
            QueryExecutionId: executionId,
          })
        )["QueryExecution"],
      );
      const status: JSONObject = readObject(execution["Status"]);
      const state: string = readText(status["State"]).toUpperCase();

      if (state === "SUCCEEDED") {
        break;
      }

      if (state === "FAILED" || state === "CANCELLED") {
        throw new Error(
          `The Athena query ${state.toLowerCase()}: ${readText(status["StateChangeReason"]).slice(0, 300) || "no reason given"}`,
        );
      }

      if (this.now() - startedAt > ATHENA_QUERY_DEADLINE_IN_MS) {
        try {
          await this.call("athena", "AmazonAthena.StopQueryExecution", {
            QueryExecutionId: executionId,
          });
        } catch {
          // The workgroup's own limit ends it either way.
        }

        throw new Error("The Athena query did not finish in time.");
      }

      await this.wait(POLL_WAIT_IN_MS);
    }

    const rows: Array<Record<string, unknown>> = [];
    let nextToken: string = "";

    for (let page: number = 0; page < MAX_RESULT_PAGES; page++) {
      const result: JSONObject = await this.call(
        "athena",
        "AmazonAthena.GetQueryResults",
        {
          QueryExecutionId: executionId,
          ...(nextToken ? { NextToken: nextToken } : {}),
        },
      );

      rows.push(...readAthenaRows(readObject(result["ResultSet"]), page === 0));
      nextToken = readText(result["NextToken"]);

      if (!nextToken) {
        break;
      }
    }

    return rows;
  }
}
