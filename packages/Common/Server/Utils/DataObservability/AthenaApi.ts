import crypto from "crypto";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import {
  awsErrorCodeOf,
  AwsCredentials,
  classifyAwsAnswer,
  signAwsRequest,
} from "../CloudConnection/Aws/AwsApi";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../DataSource/HttpFetch";
import {
  DataSourceUnreachedError,
  failedAnswerError,
  readBodyText,
  readErrorCode,
  readRequestIdHeader,
  unreachedError,
} from "../DataSource/HttpFailure";
import DataSourceHttpRetry, {
  HttpRetryExchange,
} from "../DataSource/HttpRetry";

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
 *
 * An answer that may pass is asked again (DataSourceHttpRetry), read as the
 * AWS SDKs' standard retry mode reads it, by the classifier every AWS call
 * of OneUptime shares (AwsApi's classifyAwsAnswer): a throttling error code
 * (Athena's TooManyRequestsException, Glue's ThrottlingException, which
 * come as 400s, and the others the SDKs list) is waited out, and a
 * transient one - an InternalServerException, a ServiceUnavailable, any
 * 500, 502, 503 or 504 - is asked again with backoff. Every call reads, but StartQueryExecution,
 * which starts a query: it carries a ClientRequestToken, kept for every
 * sending, so Athena starts the query once and answers again with the same
 * QueryExecutionId. Without one, Athena's reference says, a caller that is
 * not an AWS SDK is refused.
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
const GLUE_TITLE: string = "AWS Glue";

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

// Why a check was stopped, in the setting's own words.
export function describeScanLimit(maxBytesScanned: number): string {
  const gigabytes: number = Math.round(maxBytesScanned / (1024 * 1024 * 1024));

  return `This check would read more than the ${gigabytes} GB a check may read, so it was stopped. Sample it, or raise the limit in Data Observability's Settings.`;
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
  private readonly now: () => number;
  private readonly wait: (ms: number) => Promise<void>;
  // Every request of the collection, asked again within one budget (DataSourceHttpRetry).
  private readonly retry: DataSourceHttpRetry;

  public constructor(data: {
    connection: AthenaConnection;
    transport?: AthenaTransport | undefined;
    now?: (() => number) | undefined;
    wait?: ((ms: number) => Promise<void>) | undefined;
  }) {
    this.connection = data.connection;
    this.now =
      data.now ||
      ((): number => {
        return Date.now();
      });
    this.wait =
      data.wait ||
      ((ms: number): Promise<void> => {
        return DataSourceHttpRetry.sleep(ms);
      });
    this.retry = new DataSourceHttpRetry({
      transport:
        data.transport || DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
      classify: classifyAwsAnswer,
      provider: PROVIDER_TITLE,
      now: this.now,
      sleep: this.wait,
    });
  }

  public get database(): string {
    return this.connection.database;
  }

  // What an answer could repeat that no error may: the secret key and the session token.
  private secrets(): Array<string> {
    return [
      this.connection.credentials.secretAccessKey,
      this.connection.credentials.sessionToken || "",
    ];
  }

  /*
   * One call of Athena's or Glue's API, signed again for each try and asked
   * again while its answer may pass. Every call is a read or idempotent
   * (StartQueryExecution's ClientRequestToken, StopQueryExecution), so each
   * is safe to send again. An answer that is no success says what was being
   * read, AWS's error code and message, and its request ID.
   */
  private async call(
    service: "glue" | "athena",
    target: string,
    body: JSONObject,
    operation: string,
  ): Promise<JSONObject> {
    const provider: string = service === "glue" ? GLUE_TITLE : PROVIDER_TITLE;
    const action: string = target.split(".").pop() || target;
    const said: string = `${operation} (${action})`;
    let exchange: HttpRetryExchange;

    try {
      exchange = await this.retry.exchange({
        build: (): DataSourceHttpRequest => {
          const signed: {
            url: string;
            headers: Dictionary<string>;
            body: string;
          } = signAwsRequest({
            credentials: this.connection.credentials,
            service,
            region: this.connection.region,
            target,
            jsonVersion: "1.1",
            body,
            now: (): Date => {
              return new Date(this.now());
            },
          });

          return {
            method: "POST",
            url: signed.url,
            headers: signed.headers,
            body: signed.body,
            acceptAnyStatus: true,
          };
        },
        isSafeToRepeat: true,
      });
    } catch (error) {
      // A failure of the request's own making (a sign-in refused) says itself.
      if (!(error instanceof DataSourceUnreachedError)) {
        throw error;
      }

      throw unreachedError({
        provider,
        operation: said,
        error,
        secrets: this.secrets(),
      });
    }

    const response: DataSourceHttpResponse = exchange.response;
    const json: JSONObject =
      response.bodyJson &&
      typeof response.bodyJson === "object" &&
      !Array.isArray(response.bodyJson)
        ? (response.bodyJson as JSONObject)
        : {};

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw failedAnswerError({
        provider,
        statusCode: response.statusCode,
        errorCode: readErrorCode(awsErrorCodeOf(response.bodyText || "")),
        operation: said,
        message:
          readText(json["message"]) ||
          readText(json["Message"]) ||
          (response.bodyJson === undefined
            ? readBodyText(response.bodyText)
            : ""),
        attempts: exchange.attempts,
        requestId: readRequestIdHeader(response.headers, [
          "x-amzn-requestid",
          "x-amz-request-id",
        ]),
        secrets: this.secrets(),
      });
    }

    return json;
  }

  // The Glue database itself: a connection that cannot read it cannot collect.
  public async getDatabase(): Promise<JSONObject> {
    return await this.call(
      "glue",
      "AWSGlue.GetDatabase",
      { Name: this.connection.database },
      "reading the Glue database",
    );
  }

  // Every table and view of the Glue database, with its columns and parameters.
  public async listTables(maxTables: number): Promise<Array<JSONObject>> {
    const tables: Array<JSONObject> = [];
    let nextToken: string = "";

    for (let page: number = 0; page < MAX_TABLE_PAGES; page++) {
      const body: JSONObject = await this.call(
        "glue",
        "AWSGlue.GetTables",
        {
          DatabaseName: this.connection.database,
          MaxResults: 100,
          ...(nextToken ? { NextToken: nextToken } : {}),
        },
        "listing the tables",
      );

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
    // Athena has no limit to send with a query: it is followed, and stopped past this.
    maxBytesScanned?: number | undefined;
    // What the query reads, as a failure says it: "running a check".
    operation?: string | undefined;
  }): Promise<Array<Record<string, unknown>>> {
    const operation: string = data.operation || "running a query";
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
        // The same for every sending of this query: Athena starts it once.
        ClientRequestToken: crypto.randomUUID(),
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
      operation,
    );
    const executionId: string = readText(started["QueryExecutionId"]);
    const startedAt: number = this.now();

    for (;;) {
      const execution: JSONObject = readObject(
        (
          await this.call(
            "athena",
            "AmazonAthena.GetQueryExecution",
            { QueryExecutionId: executionId },
            operation,
          )
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

      const scanned: number = Number(
        readObject(execution["Statistics"])["DataScannedInBytes"],
      );
      const isOverLimit: boolean =
        Boolean(data.maxBytesScanned) &&
        Number.isFinite(scanned) &&
        scanned > data.maxBytesScanned!;

      if (isOverLimit || this.now() - startedAt > ATHENA_QUERY_DEADLINE_IN_MS) {
        try {
          await this.call(
            "athena",
            "AmazonAthena.StopQueryExecution",
            { QueryExecutionId: executionId },
            "stopping a query",
          );
        } catch {
          // The workgroup's own limit ends it either way.
        }

        throw new Error(
          isOverLimit
            ? describeScanLimit(data.maxBytesScanned!)
            : "The Athena query did not finish in time.",
        );
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
        operation,
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
