import { afterEach, describe, expect, jest, test } from "@jest/globals";
import crypto from "crypto";
import SnowflakeSqlApi, {
  classifySnowflakeAnswer,
  describeSnowflakeStatement,
  SnowflakeConnection,
} from "../../../../Server/Utils/DataObservability/SnowflakeSqlApi";
import DatabricksApi, {
  classifyDatabricksAnswer,
  readDatabricksConnection,
} from "../../../../Server/Utils/DataObservability/DatabricksApi";
import BigQueryApi, {
  classifyBigQueryAnswer,
  readBigQueryConnection,
} from "../../../../Server/Utils/DataObservability/BigQueryApi";
import AthenaApi, {
  readAthenaConnection,
} from "../../../../Server/Utils/DataObservability/AthenaApi";
import { classifyAwsAnswer } from "../../../../Server/Utils/CloudConnection/Aws/AwsApi";
import ClickHouseHttpApi, {
  classifyClickHouseAnswer,
  readClickHouseConnection,
  readClickHouseException,
} from "../../../../Server/Utils/DataObservability/ClickHouseHttpApi";
import {
  collectTableHealth,
  TableHealthSnapshot,
} from "../../../../Server/Utils/DataObservability/TableHealthCollector";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import DataSourceHttpRetry, {
  HttpRetryReason,
  HttpRetryVerdict,
} from "../../../../Server/Utils/DataSource/HttpRetry";
import { DataSourceRequestError } from "../../../../Server/Utils/DataSource/HttpFailure";
import { JSONObject } from "../../../../Types/JSON";

/*
 * ISSUE #9540: THE WAREHOUSE COLLECTORS ASKED NOTHING AGAIN.
 *
 * One 503 or 429 from Snowflake's SQL API, Databricks, BigQuery, Athena or
 * Glue, or ClickHouse failed a store's whole collection, which was then not
 * tried for 15 minutes and could trip the "collection stopped" alert. Each
 * collector now sends its requests through the client Dataverse's retries
 * moved to (DataSourceHttpRetry), with its provider's own rules. Held here,
 * for each:
 *
 *  - which answers are asked again, as the provider's docs list them, and
 *    which never are;
 *  - that nothing that could do its work twice is sent twice: a statement
 *    goes again under the request ID of its first sending (Snowflake,
 *    BigQuery, Athena), or only when the provider did not take it
 *    (Databricks);
 *  - the waits, and a throttle that holds the collection back;
 *  - what a failure says: what was being read, the provider's own code and
 *    message, the tries and the ID its support asks for, never a secret;
 *  - a whole collection that survives one transient failure.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

const KEY_PAIR: { privateKey: string } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

function json(
  body: unknown,
  statusCode: number = 200,
  headers: Record<string, string> = {},
): DataSourceHttpResponse {
  return {
    statusCode,
    bodyText: JSON.stringify(body),
    bodyJson: body,
    headers,
  };
}

function text(
  body: string,
  statusCode: number,
  headers: Record<string, string> = {},
): DataSourceHttpResponse {
  return { statusCode, bodyText: body, bodyJson: undefined, headers };
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }

  throw new Error("It did not fail.");
}

// The waits every collector's client makes in a whole collection, which builds its own client.
function recordWaits(): Array<number> {
  const waits: Array<number> = [];

  jest
    .spyOn(DataSourceHttpRetry, "sleep")
    .mockImplementation(async (ms: number): Promise<void> => {
      waits.push(ms);
    });

  return waits;
}

function verdictOf(
  classify: (
    response: DataSourceHttpResponse,
    request: DataSourceHttpRequest,
  ) => HttpRetryVerdict | null,
  response: DataSourceHttpResponse,
): HttpRetryReason | null {
  return (
    classify(response, { method: "GET", url: "https://example.test/" })
      ?.reason || null
  );
}

/*
 * ---------------------------------------------------------------------------
 * SNOWFLAKE
 * ---------------------------------------------------------------------------
 */

const SNOWFLAKE: SnowflakeConnection = {
  account: "myorg-myaccount",
  user: "oneuptime_reader",
  privateKey: KEY_PAIR.privateKey,
  database: "ANALYTICS",
  warehouse: "CHECKS_WH",
  role: null,
};

// A statement's answer: its rows under the columns named.
function snowflakeRows(
  columns: Array<string>,
  rows: Array<Array<unknown>>,
): DataSourceHttpResponse {
  return json({
    statementHandle: "01b2c3d4-0000-0001-0000-000000000001",
    resultSetMetaData: {
      rowType: columns.map((name: string): JSONObject => {
        return { name };
      }),
    },
    data: rows,
  });
}

function snowflake(
  answers: Array<DataSourceHttpResponse>,
  sent: Array<DataSourceHttpRequest>,
  waits: Array<number>,
): SnowflakeSqlApi {
  return new SnowflakeSqlApi({
    connection: SNOWFLAKE,
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      sent.push(request);
      return answers.shift() || snowflakeRows(["value"], [["1"]]);
    },
    sleep: async (ms: number): Promise<void> => {
      waits.push(ms);
    },
  });
}

describe("Snowflake asks again what its SQL API says may pass", () => {
  test.each([
    [429, HttpRetryReason.Throttled],
    [500, HttpRetryReason.Unavailable],
    [502, HttpRetryReason.Unavailable],
    [503, HttpRetryReason.Unavailable],
    [504, HttpRetryReason.Unavailable],
  ])("a %i may pass", (statusCode: number, reason: HttpRetryReason) => {
    expect(verdictOf(classifySnowflakeAnswer, json({}, statusCode))).toBe(
      reason,
    );
  });

  test.each([200, 202, 400, 401, 403, 404, 408, 415, 422])(
    "a %i never does",
    (statusCode: number) => {
      expect(verdictOf(classifySnowflakeAnswer, json({}, statusCode))).toBe(
        null,
      );
    },
  );

  test("a 503 was not processed, the reference says: it is undone", () => {
    expect(classifySnowflakeAnswer(json({}, 503))?.isUndone).toBe(true);
    expect(classifySnowflakeAnswer(json({}, 500))?.isUndone).toBeFalsy();
  });

  test("a statement sent again carries its first request ID and retry=true, so Snowflake runs it once", async () => {
    const sent: Array<DataSourceHttpRequest> = [];
    const waits: Array<number> = [];
    const api: SnowflakeSqlApi = snowflake(
      [json({ message: "Internal error" }, 500)],
      sent,
      waits,
    );

    expect(await api.query({ statement: "SELECT 1" })).toEqual([
      { value: "1" },
    ]);
    expect(sent).toHaveLength(2);
    expect(waits).toEqual([2_000]);

    const first: URL = new URL(sent[0]!.url);
    const second: URL = new URL(sent[1]!.url);

    expect(first.searchParams.get("requestId")).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.searchParams.get("requestId")).toBe(
      first.searchParams.get("requestId"),
    );
    expect(first.searchParams.has("retry")).toBe(false);
    expect(second.searchParams.get("retry")).toBe("true");
    // The statement itself is the same, word for word.
    expect(sent[1]!.body).toBe(sent[0]!.body);
  });

  test("each statement has a request ID of its own", async () => {
    const sent: Array<DataSourceHttpRequest> = [];
    const api: SnowflakeSqlApi = snowflake([], sent, []);

    await api.query({ statement: "SELECT 1" });
    await api.query({ statement: "SELECT 2" });

    expect(new URL(sent[0]!.url).searchParams.get("requestId")).not.toBe(
      new URL(sent[1]!.url).searchParams.get("requestId"),
    );
  });

  test("a 429 waits its Retry-After, and holds back the next statement", async () => {
    const sent: Array<DataSourceHttpRequest> = [];
    const waits: Array<number> = [];
    const api: SnowflakeSqlApi = new SnowflakeSqlApi({
      connection: SNOWFLAKE,
      now: (): Date => {
        return new Date("2026-11-19T12:00:00.000Z");
      },
      transport: (() => {
        let asked: number = 0;

        return async (
          request: DataSourceHttpRequest,
        ): Promise<DataSourceHttpResponse> => {
          sent.push(request);
          asked++;
          return asked === 1
            ? json({ message: "Too many requests" }, 429, {
                "retry-after": "4",
              })
            : snowflakeRows(["value"], [["1"]]);
        };
      })(),
      sleep: async (ms: number): Promise<void> => {
        waits.push(ms);
      },
    });

    await api.query({ statement: "SHOW TABLES IN DATABASE ANALYTICS" });
    expect(waits).toEqual([4_000]);

    // The clock stands still: the next statement waits for that time too.
    await api.query({ statement: "SHOW VIEWS IN DATABASE ANALYTICS" });
    expect(waits).toEqual([4_000, 4_000]);
    expect(sent).toHaveLength(3);
  });

  test("a statement that ran past its timeout (408) is never sent again", async () => {
    const sent: Array<DataSourceHttpRequest> = [];
    const error: Error = await rejectionOf(
      snowflake(
        [
          json(
            {
              code: "000630",
              message:
                "Statement reached its statement or warehouse timeout of 30 second(s) and was canceled.",
            },
            408,
          ),
        ],
        sent,
        [],
      ).query({ statement: "SELECT COUNT(*) FROM ORDERS" }),
    );

    expect(sent).toHaveLength(1);
    expect(error.message).toBe(
      "Snowflake answered 408 (000630) while running a query: Statement reached its statement or warehouse timeout of 30 second(s) and was canceled.",
    );
  });

  test("a failure says what was being read, Snowflake's code and message, the tries and the query ID", async () => {
    const failing: DataSourceHttpResponse = json(
      {
        code: "000603",
        message:
          "SQL execution internal error: Processing aborted due to error 300002:3.",
        statementHandle: "01b2c3d4-0000-0001-0000-000000000009",
      },
      500,
    );
    const error: Error = await rejectionOf(
      snowflake([failing, failing, failing], [], []).query({
        statement: "SHOW TABLES IN DATABASE ANALYTICS LIMIT 10",
        operation: "listing the tables (SHOW TABLES)",
      }),
    );

    expect(error).toBeInstanceOf(DataSourceRequestError);
    expect(error.message).toBe(
      "Snowflake answered 500 (000603) while listing the tables (SHOW TABLES): SQL execution internal error: Processing aborted due to error 300002:3. Tried 3 times. Query ID: 01b2c3d4-0000-0001-0000-000000000009.",
    );
  });

  test("a refusal says the user was refused, and never repeats the token it signed", async () => {
    const sent: Array<DataSourceHttpRequest> = [];
    const api: SnowflakeSqlApi = new SnowflakeSqlApi({
      connection: SNOWFLAKE,
      transport: async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        sent.push(request);
        const token: string = String(request.headers?.["Authorization"]).slice(
          "Bearer ".length,
        );

        return json(
          { code: "390144", message: `JWT token is invalid: ${token}` },
          401,
        );
      },
    });
    const error: Error = await rejectionOf(
      api.query({ statement: "SHOW TABLES IN DATABASE ANALYTICS" }),
    );

    expect(sent).toHaveLength(1);
    expect(error.message).toBe(
      "Snowflake refused the user (401, 390144) while running SHOW TABLES: JWT token is invalid: ****.",
    );
  });

  test("a statement's kind names what was read when the caller names nothing", () => {
    expect(
      describeSnowflakeStatement('  show columns in schema "DB"."S"'),
    ).toBe("running SHOW COLUMNS");
    expect(describeSnowflakeStatement("SELECT 1")).toBe("running a query");
  });

  test("a statement still running is followed after waits the client can be handed", async () => {
    const waits: Array<number> = [];
    const sent: Array<DataSourceHttpRequest> = [];
    const api: SnowflakeSqlApi = snowflake(
      [
        json({ statementHandle: "h-1" }, 202),
        snowflakeRows(["value"], [["7"]]),
      ],
      sent,
      waits,
    );

    expect(await api.query({ statement: "SELECT 7" })).toEqual([
      { value: "7" },
    ]);
    expect(waits).toEqual([500]);
    expect(sent[1]!.url).toBe(
      "https://myorg-myaccount.snowflakecomputing.com/api/v2/statements/h-1",
    );
  });

  test("a whole collection survives one 503 on the table list", async () => {
    const waits: Array<number> = recordWaits();
    let tablesAsked: number = 0;

    jest
      .spyOn(DataSourceHttpFetch, "fetch")
      .mockImplementation(
        async (
          request: DataSourceHttpRequest,
        ): Promise<DataSourceHttpResponse> => {
          const statement: string = String(
            (JSON.parse(String(request.body || "{}")) as JSONObject)[
              "statement"
            ] || "",
          );

          if (statement.startsWith("SHOW TABLES")) {
            tablesAsked++;

            return tablesAsked === 1
              ? json({ message: "Service unavailable" }, 503)
              : snowflakeRows(
                  ["kind", "schema_name", "name", "rows", "bytes"],
                  [["TABLE", "SALES", "ORDERS", "120", "4096"]],
                );
          }

          if (statement.startsWith("SHOW COLUMNS")) {
            return snowflakeRows(
              ["table_name", "column_name", "data_type"],
              [["ORDERS", "ID", '{"type":"FIXED","nullable":false}']],
            );
          }

          return snowflakeRows(["name"], []);
        },
      );

    const snapshot: TableHealthSnapshot = await collectTableHealth({
      engine: "snowflake",
      connectionString: JSON.stringify(SNOWFLAKE),
    });

    expect(
      snapshot.tables.map((table: { name: string }): string => {
        return table.name;
      }),
    ).toEqual(["ORDERS"]);
    expect(snapshot.warnings).toEqual([]);
    expect(tablesAsked).toBe(2);
    expect(waits).toEqual([2_000]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * DATABRICKS
 * ---------------------------------------------------------------------------
 */

const DATABRICKS_HOST: string = "adb-1234567890123456.7.azuredatabricks.net";
// Not shaped as a real token, so no secret scanner takes it for one.
const DATABRICKS_TOKEN: string = "test-token-for-a-fake-workspace";

function databricksError(
  statusCode: number,
  errorCode: string | null,
  message: string,
  details: Array<JSONObject> = [],
  headers: Record<string, string> = {},
): DataSourceHttpResponse {
  return json(
    {
      ...(errorCode ? { error_code: errorCode } : {}),
      message,
      ...(details.length > 0 ? { details } : {}),
    },
    statusCode,
    headers,
  );
}

const RETRY_INFO: JSONObject = {
  "@type": "type.googleapis.com/google.rpc.RetryInfo",
  retry_delay: "3.5s",
};

function databricks(
  answer: (request: DataSourceHttpRequest) => DataSourceHttpResponse,
  waits: Array<number>,
  connection: JSONObject = {},
): DatabricksApi {
  return new DatabricksApi({
    connection: readDatabricksConnection(
      JSON.stringify({
        host: DATABRICKS_HOST,
        token: DATABRICKS_TOKEN,
        catalog: "main",
        warehouseId: "abc123def456",
        ...connection,
      }),
    ),
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      return answer(request);
    },
    wait: async (ms: number): Promise<void> => {
      waits.push(ms);
    },
  });
}

const STATEMENT_DONE: JSONObject = {
  statement_id: "st-1",
  status: { state: "SUCCEEDED" },
  manifest: { schema: { columns: [{ name: "value" }] } },
  result: { data_array: [["1"]] },
};

describe("Databricks asks again what its error reference says may pass", () => {
  test("TEMPORARILY_UNAVAILABLE (503) may pass, waiting at least its RetryInfo's retry_delay, and the API did not take it", () => {
    expect(
      classifyDatabricksAnswer(
        databricksError(503, "TEMPORARILY_UNAVAILABLE", "Try again", [
          RETRY_INFO,
        ]),
      ),
    ).toEqual({
      reason: HttpRetryReason.Unavailable,
      isUndone: true,
      waitInMs: 3_500,
    });
  });

  test("a 429 or a 503 of the gateway, which carries no error_code, may pass", () => {
    expect(
      classifyDatabricksAnswer(text("<html>Too Many Requests</html>", 429)),
    ).toEqual({ reason: HttpRetryReason.Throttled, waitInMs: undefined });
    // The gateway may have handed the request on: not known to be undone.
    expect(classifyDatabricksAnswer(text("upstream unavailable", 503))).toEqual(
      {
        reason: HttpRetryReason.Unavailable,
        isUndone: false,
        waitInMs: undefined,
      },
    );
  });

  test("RESOURCE_EXHAUSTED (429) may pass only when it says how long to wait: else it is a quota", () => {
    expect(
      verdictOf(
        classifyDatabricksAnswer,
        databricksError(429, "RESOURCE_EXHAUSTED", "Quota exceeded"),
      ),
    ).toBe(null);
    expect(
      verdictOf(
        classifyDatabricksAnswer,
        databricksError(429, "RESOURCE_EXHAUSTED", "Slow down", [RETRY_INFO]),
      ),
    ).toBe(HttpRetryReason.Throttled);
    expect(
      verdictOf(
        classifyDatabricksAnswer,
        databricksError(429, "RESOURCE_EXHAUSTED", "Slow down", [], {
          "retry-after": "2",
        }),
      ),
    ).toBe(HttpRetryReason.Throttled);
  });

  test.each([
    [500, "INTERNAL_ERROR"],
    [504, "DEADLINE_EXCEEDED"],
    [400, "INVALID_PARAMETER_VALUE"],
    [401, "UNAUTHENTICATED"],
    [403, "PERMISSION_DENIED"],
    [404, "NOT_FOUND"],
    [409, "ABORTED"],
  ])("a %i %s never does", (statusCode: number, errorCode: string) => {
    expect(
      verdictOf(
        classifyDatabricksAnswer,
        databricksError(statusCode, errorCode, "No"),
      ),
    ).toBe(null);
  });

  test("a Unity Catalog listing that meets TEMPORARILY_UNAVAILABLE waits its retry_delay, then reads", async () => {
    const waits: Array<number> = [];
    let asked: number = 0;
    const api: DatabricksApi = databricks((): DataSourceHttpResponse => {
      asked++;
      return asked === 1
        ? databricksError(503, "TEMPORARILY_UNAVAILABLE", "Try again later", [
            RETRY_INFO,
          ])
        : json({ schemas: [{ name: "sales" }] });
    }, waits);

    expect(await api.listSchemas()).toEqual(["sales"]);
    expect(waits).toEqual([3_500]);
  });

  test("a statement is sent again when the API did not take it: TEMPORARILY_UNAVAILABLE, or a gateway's 429", async () => {
    for (const refusal of [
      databricksError(503, "TEMPORARILY_UNAVAILABLE", "Try again later"),
      text("Too Many Requests", 429),
    ]) {
      const statements: Array<string> = [];
      const api: DatabricksApi = databricks(
        (request: DataSourceHttpRequest): DataSourceHttpResponse => {
          statements.push(String(request.body));
          return statements.length === 1 ? refusal : json(STATEMENT_DONE);
        },
        [],
      );

      expect(await api.query({ statement: "SELECT 1" })).toEqual([
        { value: "1" },
      ]);
      expect(statements).toHaveLength(2);
    }
  });

  test("a statement is never sent again after a gateway's 503, which may have started it", async () => {
    const sent: Array<string> = [];
    const api: DatabricksApi = databricks(
      (request: DataSourceHttpRequest): DataSourceHttpResponse => {
        sent.push(request.url);
        return text("upstream connect error", 503);
      },
      [],
    );
    const error: Error = await rejectionOf(
      api.query({ statement: "SELECT 1", operation: "running a check" }),
    );

    expect(sent).toHaveLength(1);
    expect(error.message).toBe(
      "Databricks answered 503 while running a check: upstream connect error.",
    );
  });

  test("INTERNAL_ERROR is never asked again, and the failure names the request ID support asks for", async () => {
    const sent: Array<string> = [];
    const api: DatabricksApi = databricks(
      (request: DataSourceHttpRequest): DataSourceHttpResponse => {
        sent.push(request.url);
        return databricksError(500, "INTERNAL_ERROR", "Unexpected failure", [
          {
            "@type": "type.googleapis.com/google.rpc.RequestInfo",
            request_id: "01ef9a2c-0000-0000-0000-00000000d2b1",
          },
        ]);
      },
      [],
    );
    const error: Error = await rejectionOf(api.getCatalog());

    expect(sent).toHaveLength(1);
    expect(error.message).toBe(
      "Databricks answered 500 (INTERNAL_ERROR) while reading the catalog main: Unexpected failure. Request ID: 01ef9a2c-0000-0000-0000-00000000d2b1.",
    );
  });

  test("a refusal says the access token was refused, and never repeats it", async () => {
    const api: DatabricksApi = databricks((): DataSourceHttpResponse => {
      return databricksError(
        403,
        "PERMISSION_DENIED",
        `Token ${DATABRICKS_TOKEN} may not read catalog main`,
      );
    }, []);
    const error: Error = await rejectionOf(api.getCatalog());

    expect(error.message).toBe(
      "Databricks refused the access token (403, PERMISSION_DENIED) while reading the catalog main: Token **** may not read catalog main.",
    );
  });

  test("the service principal's sign-in is asked again when Databricks fails it for a moment; a refusal names the service principal", async () => {
    const waits: Array<number> = [];
    const signIns: Array<string> = [];
    const flaky: DatabricksApi = databricks(
      (request: DataSourceHttpRequest): DataSourceHttpResponse => {
        if (request.url.endsWith("/oidc/v1/token")) {
          signIns.push(request.url);
          return signIns.length === 1
            ? text("Service Unavailable", 503)
            : json({ access_token: "sp-token", expires_in: 3600 });
        }

        return json({ name: "main" });
      },
      waits,
      {
        token: undefined,
        clientId: "sp-client",
        clientSecret: "sp-secret-value",
      },
    );

    await flaky.getCatalog();
    expect(signIns).toHaveLength(2);
    expect(waits).toEqual([2_000]);

    const refused: DatabricksApi = databricks(
      (): DataSourceHttpResponse => {
        return json(
          {
            error: "invalid_client",
            error_description: "Client authentication failed",
          },
          401,
        );
      },
      [],
      {
        token: undefined,
        clientId: "sp-client",
        clientSecret: "sp-secret-value",
      },
    );

    expect((await rejectionOf(refused.getCatalog())).message).toBe(
      "Databricks refused the service principal (401, invalid_client) while signing in (oidc/v1/token): Client authentication failed.",
    );
  });

  test("a request that got no answer says what was being read", async () => {
    const api: DatabricksApi = databricks((): DataSourceHttpResponse => {
      throw new Error(
        "Could not reach data source: getaddrinfo ENOTFOUND adb-1234567890123456.7.azuredatabricks.net",
      );
    }, []);

    expect((await rejectionOf(api.listSchemas())).message).toBe(
      "Databricks could not be reached while listing the schemas: getaddrinfo ENOTFOUND adb-1234567890123456.7.azuredatabricks.net.",
    );
  });

  test("a whole collection survives TEMPORARILY_UNAVAILABLE on the schema list", async () => {
    const waits: Array<number> = recordWaits();
    let schemasAsked: number = 0;

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
            schemasAsked++;

            return schemasAsked === 1
              ? databricksError(503, "TEMPORARILY_UNAVAILABLE", "Try again")
              : json({ schemas: [{ name: "sales" }] });
          }

          return json({
            tables: [
              {
                name: "orders",
                schema_name: "sales",
                table_type: "MANAGED",
                properties: {},
                columns: [{ name: "id", type_text: "bigint", position: 0 }],
              },
            ],
          });
        },
      );

    const snapshot: TableHealthSnapshot = await collectTableHealth({
      engine: "databricks",
      connectionString: JSON.stringify({
        host: DATABRICKS_HOST,
        token: DATABRICKS_TOKEN,
        catalog: "main",
      }),
    });

    expect(
      snapshot.tables.map((table: { name: string }): string => {
        return table.name;
      }),
    ).toEqual(["orders"]);
    expect(schemasAsked).toBe(2);
    expect(waits).toEqual([2_000]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * BIGQUERY
 * ---------------------------------------------------------------------------
 */

const SERVICE_ACCOUNT: JSONObject = {
  type: "service_account",
  client_email: "oneuptime@my-project.iam.gserviceaccount.com",
  private_key: KEY_PAIR.privateKey,
  token_uri: "https://oauth2.googleapis.com/token",
};

const BIGQUERY_CONNECTION: string = JSON.stringify({
  projectId: "my-project",
  dataset: "analytics",
  location: "US",
  serviceAccountJson: JSON.stringify(SERVICE_ACCOUNT),
});

function googleError(
  statusCode: number,
  reason: string,
  message: string,
): DataSourceHttpResponse {
  return json(
    {
      error: {
        code: statusCode,
        message,
        errors: [{ message, domain: "global", reason }],
        status: "UNAVAILABLE",
      },
    },
    statusCode,
  );
}

const QUERY_DONE: JSONObject = {
  jobComplete: true,
  jobReference: { jobId: "job-1", location: "US" },
  schema: { fields: [{ name: "value" }] },
  rows: [{ f: [{ v: "1" }] }],
};

function bigQuery(
  answer: (request: DataSourceHttpRequest) => DataSourceHttpResponse,
  waits: Array<number>,
): BigQueryApi {
  return new BigQueryApi({
    connection: readBigQueryConnection(BIGQUERY_CONNECTION),
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      if (request.url === "https://oauth2.googleapis.com/token") {
        return json({ access_token: "ya29.token-value", expires_in: 3600 });
      }

      return answer(request);
    },
    sleep: async (ms: number): Promise<void> => {
      waits.push(ms);
    },
  });
}

describe("BigQuery asks again what its error reference says may pass", () => {
  test.each([
    [429, "rateLimitExceeded", HttpRetryReason.Throttled],
    [403, "rateLimitExceeded", HttpRetryReason.Throttled],
    [403, "userRateLimitExceeded", HttpRetryReason.Throttled],
    [500, "backendError", HttpRetryReason.Unavailable],
    [500, "internalError", HttpRetryReason.Unavailable],
    [502, "backendError", HttpRetryReason.Unavailable],
    [503, "backendError", HttpRetryReason.Unavailable],
    [504, "backendError", HttpRetryReason.Unavailable],
  ])(
    "a %i %s may pass",
    (statusCode: number, reason: string, verdict: HttpRetryReason) => {
      expect(
        verdictOf(classifyBigQueryAnswer, googleError(statusCode, reason, "x")),
      ).toBe(verdict);
    },
  );

  test.each([
    [403, "quotaExceeded"],
    [403, "accessDenied"],
    [400, "invalidQuery"],
    [400, "jobBackendError"],
    [404, "notFound"],
    [401, "authError"],
  ])("a %i %s never does", (statusCode: number, reason: string) => {
    expect(
      verdictOf(classifyBigQueryAnswer, googleError(statusCode, reason, "x")),
    ).toBe(null);
  });

  test("a query that meets a 503 is sent again under the same requestId, so BigQuery starts it once", async () => {
    const waits: Array<number> = [];
    const bodies: Array<JSONObject> = [];
    const api: BigQueryApi = bigQuery(
      (request: DataSourceHttpRequest): DataSourceHttpResponse => {
        bodies.push(JSON.parse(String(request.body)) as JSONObject);
        return bodies.length === 1
          ? googleError(503, "backendError", "Service unavailable")
          : json(QUERY_DONE);
      },
      waits,
    );

    expect(await api.query({ statement: "SELECT 1" })).toEqual([
      { value: "1" },
    ]);
    expect(waits).toEqual([2_000]);
    expect(bodies).toHaveLength(2);
    expect(String(bodies[0]!["requestId"])).toMatch(/^[0-9a-f-]{36}$/);
    expect(bodies[1]!["requestId"]).toBe(bodies[0]!["requestId"]);
  });

  test("Google's sign-in is asked again when it fails for a moment", async () => {
    const waits: Array<number> = [];
    let signIns: number = 0;
    const api: BigQueryApi = new BigQueryApi({
      connection: readBigQueryConnection(BIGQUERY_CONNECTION),
      transport: async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        if (request.url === "https://oauth2.googleapis.com/token") {
          signIns++;
          return signIns === 1
            ? text("Service Unavailable", 503)
            : json({ access_token: "ya29.token-value", expires_in: 3600 });
        }

        return json(QUERY_DONE);
      },
      sleep: async (ms: number): Promise<void> => {
        waits.push(ms);
      },
    });

    expect(await api.query({ statement: "SELECT 1" })).toEqual([
      { value: "1" },
    ]);
    expect(signIns).toBe(2);
    expect(waits).toEqual([2_000]);
  });

  test("a failure says what was being read, Google's reason and message and the tries, never the token", async () => {
    const api: BigQueryApi = bigQuery((): DataSourceHttpResponse => {
      return googleError(
        500,
        "backendError",
        "Backend error for token ya29.token-value",
      );
    }, []);
    const error: Error = await rejectionOf(
      api.query({
        statement: "SELECT 1",
        operation: "listing the tables (__TABLES__)",
      }),
    );

    expect(error.message).toBe(
      "Google BigQuery answered 500 (backendError) while listing the tables (__TABLES__): Backend error for token ****. Tried 3 times.",
    );
  });

  test("a quota spent is said at once, as the service account's refusal", async () => {
    let asked: number = 0;
    const api: BigQueryApi = bigQuery((): DataSourceHttpResponse => {
      asked++;
      return googleError(
        403,
        "quotaExceeded",
        "Quota exceeded: Your project exceeded quota for free query bytes scanned.",
      );
    }, []);
    const error: Error = await rejectionOf(
      api.query({ statement: "SELECT 1" }),
    );

    expect(asked).toBe(1);
    expect(error.message).toBe(
      "Google BigQuery refused the service account (403, quotaExceeded) while running a query: Quota exceeded: Your project exceeded quota for free query bytes scanned.",
    );
  });

  test("a whole collection survives one 503 on the table list", async () => {
    const waits: Array<number> = recordWaits();
    let tablesAsked: number = 0;

    jest
      .spyOn(DataSourceHttpFetch, "fetch")
      .mockImplementation(
        async (
          request: DataSourceHttpRequest,
        ): Promise<DataSourceHttpResponse> => {
          if (request.url === "https://oauth2.googleapis.com/token") {
            return json({ access_token: "ya29.token-value", expires_in: 3600 });
          }

          const query: string = String(
            (JSON.parse(String(request.body || "{}")) as JSONObject)["query"] ||
              "",
          );

          if (query.includes("__TABLES__")) {
            tablesAsked++;

            return tablesAsked === 1
              ? googleError(503, "backendError", "Service unavailable")
              : json({
                  jobComplete: true,
                  jobReference: { jobId: "job-1", location: "US" },
                  schema: {
                    fields: [
                      { name: "table_id" },
                      { name: "type" },
                      { name: "row_count" },
                      { name: "size_bytes" },
                      { name: "seconds_since_change" },
                    ],
                  },
                  rows: [
                    {
                      f: [
                        { v: "orders" },
                        { v: "1" },
                        { v: "120" },
                        { v: "4096" },
                        { v: "60" },
                      ],
                    },
                  ],
                });
          }

          return json({
            jobComplete: true,
            jobReference: { jobId: "job-2", location: "US" },
            schema: { fields: [{ name: "table_name" }] },
            rows: [],
          });
        },
      );

    const snapshot: TableHealthSnapshot = await collectTableHealth({
      engine: "bigquery",
      connectionString: BIGQUERY_CONNECTION,
    });

    expect(
      snapshot.tables.map((table: { name: string }): string => {
        return table.name;
      }),
    ).toEqual(["orders"]);
    expect(tablesAsked).toBe(2);
    expect(waits).toEqual([2_000]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * ATHENA AND GLUE
 * ---------------------------------------------------------------------------
 */

const ATHENA_CONNECTION: string = JSON.stringify({
  region: "us-east-1",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  database: "analytics",
  workgroup: "checks",
});

function awsError(
  statusCode: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): DataSourceHttpResponse {
  return json(
    { __type: `com.amazonaws.athena#${code}`, message },
    statusCode,
    headers,
  );
}

function targetOf(request: DataSourceHttpRequest): string {
  return String(request.headers?.["X-Amz-Target"] || "");
}

function athena(
  answer: (request: DataSourceHttpRequest) => DataSourceHttpResponse,
  waits: Array<number>,
  now?: () => number,
): AthenaApi {
  return new AthenaApi({
    connection: readAthenaConnection(ATHENA_CONNECTION),
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      return answer(request);
    },
    wait: async (ms: number): Promise<void> => {
      waits.push(ms);
    },
    ...(now ? { now } : {}),
  });
}

describe("Athena and Glue ask again what the AWS SDKs' standard retry mode does", () => {
  test.each([
    [400, "ThrottlingException", HttpRetryReason.Throttled],
    [400, "TooManyRequestsException", HttpRetryReason.Throttled],
    [400, "RequestLimitExceeded", HttpRetryReason.Throttled],
    // The code first: a 5xx with a throttling code is a throttle.
    [503, "ThrottlingException", HttpRetryReason.Throttled],
    [500, "InternalServerException", HttpRetryReason.Unavailable],
    [500, "InternalServiceException", HttpRetryReason.Unavailable],
    [500, "InternalFailure", HttpRetryReason.Unavailable],
    [503, "ServiceUnavailable", HttpRetryReason.Unavailable],
    [408, "RequestTimeoutException", HttpRetryReason.Unavailable],
    [400, "FederationSourceRetryableException", HttpRetryReason.Unavailable],
    [502, "", HttpRetryReason.Unavailable],
  ])(
    "a %i %s may pass",
    (statusCode: number, code: string, verdict: HttpRetryReason) => {
      expect(
        verdictOf(
          classifyAwsAnswer,
          code ? awsError(statusCode, code, "x") : text("Bad Gateway", 502),
        ),
      ).toBe(verdict);
    },
  );

  test.each([
    [400, "InvalidRequestException"],
    [400, "AccessDeniedException"],
    [403, "AccessDeniedException"],
    [400, "EntityNotFoundException"],
    [400, "InvalidInputException"],
    [400, "OperationTimeoutException"],
    [403, "UnrecognizedClientException"],
    [200, ""],
  ])("a %i %s never does", (statusCode: number, code: string) => {
    expect(
      verdictOf(
        classifyAwsAnswer,
        code ? awsError(statusCode, code, "x") : json({}, statusCode),
      ),
    ).toBe(null);
  });

  test("StartQueryExecution carries one ClientRequestToken, kept for every sending, so Athena starts the query once", async () => {
    const starts: Array<JSONObject> = [];
    const api: AthenaApi = athena(
      (request: DataSourceHttpRequest): DataSourceHttpResponse => {
        switch (targetOf(request)) {
          case "AmazonAthena.StartQueryExecution":
            starts.push(JSON.parse(String(request.body)) as JSONObject);
            return starts.length === 1
              ? awsError(500, "InternalServerException", "Internal error")
              : json({ QueryExecutionId: "q1" });
          case "AmazonAthena.GetQueryExecution":
            return json({
              QueryExecution: { Status: { State: "SUCCEEDED" } },
            });
          default:
            return json({
              ResultSet: {
                ResultSetMetadata: { ColumnInfo: [{ Name: "value" }] },
                Rows: [
                  { Data: [{ VarCharValue: "value" }] },
                  { Data: [{ VarCharValue: "4" }] },
                ],
              },
            });
        }
      },
      [],
    );

    expect(await api.query({ statement: "SELECT 4 AS value" })).toEqual([
      { value: "4" },
    ]);
    expect(starts).toHaveLength(2);

    const token: string = String(starts[0]!["ClientRequestToken"]);

    // Athena takes 32 to 128 characters.
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(token.length).toBeLessThanOrEqual(128);
    expect(starts[1]!["ClientRequestToken"]).toBe(token);
  });

  test("each try is signed again, so a retry is never refused as too old", async () => {
    const dates: Array<string> = [];
    let clock: number = Date.UTC(2026, 10, 19, 12, 0, 0);
    const api: AthenaApi = athena(
      (request: DataSourceHttpRequest): DataSourceHttpResponse => {
        dates.push(String(request.headers?.["X-Amz-Date"]));
        clock += 60_000;
        return dates.length === 1
          ? awsError(503, "ServiceUnavailable", "Try again later")
          : json({ Database: { Name: "analytics" } });
      },
      [],
      (): number => {
        return clock;
      },
    );

    await api.getDatabase();

    expect(dates).toEqual(["20261119T120000Z", "20261119T120100Z"]);
  });

  test("a Glue throttle is waited out, and holds back the next call", async () => {
    const waits: Array<number> = [];
    let asked: number = 0;
    const api: AthenaApi = athena(
      (request: DataSourceHttpRequest): DataSourceHttpResponse => {
        asked++;

        if (asked === 1) {
          return awsError(400, "ThrottlingException", "Rate exceeded", {
            "retry-after": "3",
          });
        }

        return targetOf(request) === "AWSGlue.GetDatabase"
          ? json({ Database: { Name: "analytics" } })
          : json({ TableList: [] });
      },
      waits,
      (): number => {
        return 1_000_000;
      },
    );

    await api.getDatabase();
    expect(waits).toEqual([3_000]);

    await api.listTables(10);
    expect(waits).toEqual([3_000, 3_000]);
  });

  test("a failure says what was being read, AWS's code and message and the request ID, never the secret key", async () => {
    const api: AthenaApi = athena((): DataSourceHttpResponse => {
      return awsError(
        500,
        "InternalServiceException",
        "Internal error reading wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        { "x-amzn-requestid": "c0ffee00-1111-2222-3333-444455556666" },
      );
    }, []);
    const error: Error = await rejectionOf(api.listTables(10));

    expect(error.message).toBe(
      "AWS Glue answered 500 (InternalServiceException) while listing the tables (GetTables): Internal error reading ****. Tried 3 times. Request ID: c0ffee00-1111-2222-3333-444455556666.",
    );
  });

  test("access denied is said at once, Athena's step and all", async () => {
    let asked: number = 0;
    const api: AthenaApi = athena((): DataSourceHttpResponse => {
      asked++;
      return awsError(
        400,
        "AccessDeniedException",
        "User is not authorized to perform: athena:StartQueryExecution",
      );
    }, []);
    const error: Error = await rejectionOf(
      api.query({ statement: "SELECT 1", operation: "running a check" }),
    );

    expect(asked).toBe(1);
    expect(error.message).toBe(
      "Amazon Athena answered 400 (AccessDeniedException) while running a check (StartQueryExecution): User is not authorized to perform: athena:StartQueryExecution.",
    );
  });

  test("a whole collection survives a throttled table list", async () => {
    const waits: Array<number> = recordWaits();
    let tablesAsked: number = 0;

    jest
      .spyOn(DataSourceHttpFetch, "fetch")
      .mockImplementation(
        async (
          request: DataSourceHttpRequest,
        ): Promise<DataSourceHttpResponse> => {
          if (targetOf(request) === "AWSGlue.GetDatabase") {
            return json({ Database: { Name: "analytics" } });
          }

          tablesAsked++;

          return tablesAsked === 1
            ? awsError(400, "ThrottlingException", "Rate exceeded")
            : json({
                TableList: [
                  {
                    Name: "orders",
                    DatabaseName: "analytics",
                    TableType: "EXTERNAL_TABLE",
                    StorageDescriptor: {
                      Columns: [{ Name: "id", Type: "bigint" }],
                    },
                  },
                ],
              });
        },
      );

    const snapshot: TableHealthSnapshot = await collectTableHealth({
      engine: "athena",
      connectionString: ATHENA_CONNECTION,
    });

    expect(
      snapshot.tables.map((table: { name: string }): string => {
        return table.name;
      }),
    ).toEqual(["orders"]);
    expect(tablesAsked).toBe(2);
    expect(waits).toEqual([2_000]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * CLICKHOUSE
 * ---------------------------------------------------------------------------
 */

const CLICKHOUSE_CONNECTION: string =
  "clickhouse://oneuptime_reader:s3cret-pass@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics";

function clickHouse(
  answer: (request: DataSourceHttpRequest) => DataSourceHttpResponse,
  waits: Array<number>,
): ClickHouseHttpApi {
  return new ClickHouseHttpApi({
    connection: readClickHouseConnection(CLICKHOUSE_CONNECTION),
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      return answer(request);
    },
    sleep: async (ms: number): Promise<void> => {
      waits.push(ms);
    },
  });
}

const ROWS: DataSourceHttpResponse = json({
  meta: [{ name: "value", type: "UInt8" }],
  data: [{ value: 1 }],
  rows: 1,
});

describe("ClickHouse asks again what the server says may pass", () => {
  test("an exception is read from its header and its line, without its name and the server's version", () => {
    expect(
      readClickHouseException(
        text(
          "Code: 202. DB::Exception: Too many simultaneous queries. Maximum: 100. (TOO_MANY_SIMULTANEOUS_QUERIES) (version 24.8.4.13 (official build))\n",
          500,
          { "x-clickhouse-exception-code": "202" },
        ),
      ),
    ).toEqual({
      code: 202,
      name: "TOO_MANY_SIMULTANEOUS_QUERIES",
      message: "Too many simultaneous queries. Maximum: 100.",
    });
    // A proxy's page is no exception: its title says it.
    expect(
      readClickHouseException(
        text("<html><head><title>502 Bad Gateway</title></head></html>", 502),
      ),
    ).toEqual({ code: null, name: null, message: "502 Bad Gateway" });
  });

  test.each([
    [
      500,
      "Code: 202. DB::Exception: Too many simultaneous queries. Maximum: 100. (TOO_MANY_SIMULTANEOUS_QUERIES)",
      HttpRetryReason.Throttled,
    ],
    [
      500,
      "Code: 210. DB::Exception: Connection refused (NETWORK_ERROR)",
      HttpRetryReason.Unavailable,
    ],
    [
      503,
      "Code: 209. DB::Exception: Timeout exceeded while reading from socket. (SOCKET_TIMEOUT)",
      HttpRetryReason.Unavailable,
    ],
    [503, "", HttpRetryReason.Unavailable],
    [429, "Too Many Requests", HttpRetryReason.Throttled],
    [
      502,
      "<html><head><title>502 Bad Gateway</title></head></html>",
      HttpRetryReason.Unavailable,
    ],
    [504, "upstream request timeout", HttpRetryReason.Unavailable],
  ])(
    "a %i '%s' may pass",
    (statusCode: number, body: string, verdict: HttpRetryReason) => {
      expect(verdictOf(classifyClickHouseAnswer, text(body, statusCode))).toBe(
        verdict,
      );
    },
  );

  test.each([
    [
      408,
      "Code: 159. DB::Exception: Timeout exceeded: elapsed 30 seconds. (TIMEOUT_EXCEEDED)",
    ],
    [404, "Code: 60. DB::Exception: Table x does not exist. (UNKNOWN_TABLE)"],
    [
      500,
      "Code: 241. DB::Exception: Memory limit (total) exceeded. (MEMORY_LIMIT_EXCEEDED)",
    ],
    [
      403,
      "Code: 516. DB::Exception: oneuptime_reader: Authentication failed. (AUTHENTICATION_FAILED)",
    ],
    [502, "Code: 62. DB::Exception: Syntax error. (SYNTAX_ERROR)"],
    [200, ""],
  ])("a %i '%s' never does", (statusCode: number, body: string) => {
    expect(verdictOf(classifyClickHouseAnswer, text(body, statusCode))).toBe(
      null,
    );
  });

  test("too many queries at once is waited out, and holds back the next statement", async () => {
    const waits: Array<number> = [];
    let asked: number = 0;
    const api: ClickHouseHttpApi = clickHouse((): DataSourceHttpResponse => {
      asked++;
      return asked === 1
        ? text(
            "Code: 202. DB::Exception: Too many simultaneous queries. Maximum: 100. (TOO_MANY_SIMULTANEOUS_QUERIES)",
            500,
          )
        : ROWS;
    }, waits);

    expect(await api.query({ statement: "SELECT 1 AS value" })).toEqual([
      { value: 1 },
    ]);
    expect(asked).toBe(2);
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBe(2_000);
  });

  test("a query past max_execution_time is said at once, with its query ID", async () => {
    let asked: number = 0;
    const api: ClickHouseHttpApi = clickHouse((): DataSourceHttpResponse => {
      asked++;
      return text(
        "Code: 159. DB::Exception: Timeout exceeded: elapsed 30.001 seconds, maximum: 30. (TIMEOUT_EXCEEDED) (version 24.8.4.13 (official build))",
        408,
        {
          "x-clickhouse-exception-code": "159",
          "x-clickhouse-query-id": "3f2a9c1e-7b1d-4c3e-9a55-0d9b6d1f0e42",
        },
      );
    }, []);
    const error: Error = await rejectionOf(
      api.query({
        statement: "SELECT count() FROM orders",
        operation: "running a check",
      }),
    );

    expect(asked).toBe(1);
    expect(error.message).toBe(
      "ClickHouse answered 408 (TIMEOUT_EXCEEDED) while running a check: Timeout exceeded: elapsed 30.001 seconds, maximum: 30. Query ID: 3f2a9c1e-7b1d-4c3e-9a55-0d9b6d1f0e42.",
    );
  });

  test("a refusal says the login was refused, never its password", async () => {
    const api: ClickHouseHttpApi = clickHouse((): DataSourceHttpResponse => {
      return text(
        "Code: 516. DB::Exception: oneuptime_reader: Authentication failed: password is incorrect, or there is no user with such name (s3cret-pass). (AUTHENTICATION_FAILED)",
        403,
      );
    }, []);
    const error: Error = await rejectionOf(
      api.query({ statement: "SELECT 1" }),
    );

    expect(error.message).toBe(
      "ClickHouse refused the login (403, AUTHENTICATION_FAILED) while running a query: oneuptime_reader: Authentication failed: password is incorrect, or there is no user with such name (****).",
    );
  });

  test("an outage is not asked again: after two statements fail every try, the rest are sent once", async () => {
    let asked: number = 0;
    const api: ClickHouseHttpApi = clickHouse((): DataSourceHttpResponse => {
      asked++;
      return text("Service Unavailable", 503);
    }, []);

    for (let statement: number = 0; statement < 4; statement++) {
      await rejectionOf(api.query({ statement: "SELECT 1" }));
    }

    expect(asked).toBe(3 + 3 + 1 + 1);
  });

  test("a whole collection survives one 503 while the server wakes", async () => {
    const waits: Array<number> = recordWaits();
    let reachableAsked: number = 0;

    jest
      .spyOn(DataSourceHttpFetch, "fetch")
      .mockImplementation(
        async (
          request: DataSourceHttpRequest,
        ): Promise<DataSourceHttpResponse> => {
          const statement: string = String(request.body || "");

          if (statement.includes("SELECT 1 AS reachable")) {
            reachableAsked++;

            return reachableAsked === 1
              ? text("Service is waking up", 503)
              : json({ data: [{ reachable: 1 }] });
          }

          if (statement.includes("FROM system.tables")) {
            return json({
              data: [
                {
                  table_schema: "analytics",
                  table_name: "orders",
                  engine: "MergeTree",
                  total_rows: "120",
                  total_bytes: "4096",
                },
              ],
            });
          }

          return json({ data: [] });
        },
      );

    const snapshot: TableHealthSnapshot = await collectTableHealth({
      engine: "clickhouse",
      connectionString: CLICKHOUSE_CONNECTION,
    });

    expect(
      snapshot.tables.map((table: { name: string }): string => {
        return table.name;
      }),
    ).toEqual(["orders"]);
    expect(reachableAsked).toBe(2);
    expect(waits).toEqual([2_000]);
  });
});
