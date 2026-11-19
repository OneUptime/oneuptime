import { afterEach, describe, expect, jest, test } from "@jest/globals";
import crypto from "crypto";
import AthenaApi, {
  readAthenaConnection,
} from "../../../../Server/Utils/DataObservability/AthenaApi";
import BigQueryApi, {
  readBigQueryConnection,
} from "../../../../Server/Utils/DataObservability/BigQueryApi";
import ClickHouseHttpApi, {
  readClickHouseConnection,
} from "../../../../Server/Utils/DataObservability/ClickHouseHttpApi";
import DataCheckRestarts, {
  DATA_CHECK_RESTART_BUDGET_IN_MS,
  DATA_CHECK_RESTART_WAIT_IN_MS,
  DataCheckRestartFailedError,
  DataCheckRun,
  describeCheckFailure,
  MAX_DATA_CHECK_RESTART_WAIT_IN_MS,
} from "../../../../Server/Utils/DataObservability/DataCheckRestart";
import { DataCheckRunResult } from "../../../../Server/Utils/DataObservability/DataCheckResults";
import { getLastRunMessage } from "../../../../Server/Utils/DataObservability/DataCheckIngest";
import DatabricksApi, {
  readDatabricksConnection,
} from "../../../../Server/Utils/DataObservability/DatabricksApi";
import { readCheckResults } from "../../../../Server/Utils/DataObservability/DataObservabilityProbeCollect";
import SnowflakeSqlApi from "../../../../Server/Utils/DataObservability/SnowflakeSqlApi";
import {
  collectTableHealth,
  TableHealthSnapshot,
} from "../../../../Server/Utils/DataObservability/TableHealthCollector";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import {
  DataSourceBusy,
  DataSourceBusyError,
  DataSourceRequestError,
  readDataSourceBusy,
} from "../../../../Server/Utils/DataSource/HttpFailure";
import DataSourceHttpRetry from "../../../../Server/Utils/DataSource/HttpRetry";
import { DataCheckType } from "../../../../Types/DataObservability/DataCheckType";
import { JSONObject } from "../../../../Types/JSON";

/*
 * ISSUE #9679: A CHECK THE WAREHOUSE FAILED FOR A MOMENT WAS "COULD NOT RUN".
 *
 * The shared retry (#9540) asks a request again while a warehouse turns it
 * away for a moment, but a statement the warehouse took and then failed
 * for a moment - a Databricks statement FAILED with TEMPORARILY_UNAVAILABLE,
 * a BigQuery job's jobBackendError, an Athena query whose error is
 * Retryable - failed its check at once, and so did a request whose tries
 * ran out while a warehouse was away for its maintenance minute. A check
 * whose warehouse's own docs call its failure passing is now started again
 * once, after a short wait (DataCheckRestart). Held here:
 *
 *  - the rule: once, after 10 seconds or the wait the warehouse asked for
 *    (up to 30), within a minute per collection, never after the warehouse
 *    failed a second time, never for a failure that would fail again, and
 *    never because of what a check read;
 *  - each warehouse's passing failures, as its own docs list them, through
 *    its real client and a fake service: Databricks, Snowflake, BigQuery,
 *    Athena and ClickHouse;
 *  - a whole collection whose check is started again, its result saying
 *    so, through the probe's report and on the check.
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

// What a client's failure says of passing: the busy reason, or null.
async function busyOf(
  promise: Promise<unknown>,
): Promise<DataSourceBusy | null> {
  return readDataSourceBusy(await rejectionOf(promise));
}

function busyStatement(code: string = "TEMPORARILY_UNAVAILABLE"): Error {
  return new DataSourceBusyError(
    `The Databricks statement failed: The workspace is ${code}.`,
    { code },
  );
}

function refusal(): Error {
  return new DataSourceRequestError({
    message:
      "Databricks answered 403 (PERMISSION_DENIED) while running a check: No access.",
    reason: "Databricks answered 403 (PERMISSION_DENIED): No access.",
    statusCode: 403,
    errorCode: "PERMISSION_DENIED",
    requestId: null,
    attempts: 1,
  });
}

// A read that fails as told, then answers.
function reads(...failures: Array<Error>): {
  read: () => Promise<number>;
  asked: () => number;
} {
  let asked: number = 0;

  return {
    read: async (): Promise<number> => {
      asked++;

      const failure: Error | undefined = failures[asked - 1];

      if (failure) {
        throw failure;
      }

      return 42;
    },
    asked: (): number => {
      return asked;
    },
  };
}

function restarts(waits: Array<number>): DataCheckRestarts {
  return new DataCheckRestarts(async (ms: number): Promise<void> => {
    waits.push(ms);
  });
}

describe("a check the warehouse failed for a moment is started again once", () => {
  test("a check that ran is never started again, whatever it read", async () => {
    const waits: Array<number> = [];
    const check: ReturnType<typeof reads> = reads();
    const run: DataCheckRun<number> = await restarts(waits).run(check.read);

    expect(run).toEqual({ value: 42, restartedAfter: null });
    expect(check.asked()).toBe(1);
    expect(waits).toEqual([]);
  });

  test("a failure its warehouse's docs call passing: started again after 10 seconds, its result saying why the first try failed", async () => {
    const waits: Array<number> = [];
    const check: ReturnType<typeof reads> = reads(busyStatement());
    const run: DataCheckRun<number> = await restarts(waits).run(check.read);

    expect(run).toEqual({
      value: 42,
      restartedAfter:
        "The Databricks statement failed: The workspace is TEMPORARILY_UNAVAILABLE.",
    });
    expect(check.asked()).toBe(2);
    expect(waits).toEqual([DATA_CHECK_RESTART_WAIT_IN_MS]);
  });

  test("an answer whose tries ran out says the provider's answer alone, not what was being read", async () => {
    const run: DataCheckRun<number> = await restarts([]).run(
      reads(
        new DataSourceRequestError({
          message:
            "Snowflake answered 503 (390600) while running a check: Service unavailable. Tried 3 times. Query ID: 01b2.",
          reason: "Snowflake answered 503 (390600): Service unavailable.",
          statusCode: 503,
          errorCode: "390600",
          requestId: "01b2",
          attempts: 3,
          busy: { code: "390600" },
        }),
      ).read,
    );

    expect(run.restartedAfter).toBe(
      "Snowflake answered 503 (390600): Service unavailable.",
    );
  });

  test("the wait the warehouse asked for is waited, up to 30 seconds; one longer is left to the next collection", async () => {
    const waits: Array<number> = [];
    const longer: DataSourceBusyError = new DataSourceBusyError("Busy.", {
      code: "TEMPORARILY_UNAVAILABLE",
      waitInMs: 25_000,
    });

    await restarts(waits).run(reads(longer).read);
    expect(waits).toEqual([25_000]);

    const tooLong: DataSourceBusyError = new DataSourceBusyError("Busy.", {
      code: "rateLimitExceeded",
      waitInMs: MAX_DATA_CHECK_RESTART_WAIT_IN_MS + 1,
    });
    const check: ReturnType<typeof reads> = reads(tooLong);

    expect(await rejectionOf(restarts(waits).run(check.read))).toBe(tooLong);
    expect(check.asked()).toBe(1);
  });

  test("a failure that would fail again is never started again: a refusal, a query error, no answer", async () => {
    for (const failure of [
      refusal(),
      new Error("The Databricks statement failed: [PARSE_SYNTAX_ERROR]"),
      new Error(
        "The Databricks statement did not finish in time: is the SQL warehouse running?",
      ),
    ]) {
      const waits: Array<number> = [];
      const check: ReturnType<typeof reads> = reads(failure);

      expect(await rejectionOf(restarts(waits).run(check.read))).toBe(failure);
      expect(check.asked()).toBe(1);
      expect(waits).toEqual([]);
    }
  });

  test("one that fails again says it was started again; the warehouse is down, so no other check of the collection is", async () => {
    const waits: Array<number> = [];
    const collection: DataCheckRestarts = restarts(waits);
    const failed: Error = await rejectionOf(
      collection.run(reads(busyStatement(), busyStatement()).read),
    );

    expect(failed).toBeInstanceOf(DataCheckRestartFailedError);
    expect(failed.message).toBe(
      "The Databricks statement failed: The workspace is TEMPORARILY_UNAVAILABLE. The check was started again 10 seconds after its first try failed for a moment, and failed again.",
    );

    const next: ReturnType<typeof reads> = reads(busyStatement());

    await rejectionOf(collection.run(next.read));
    expect(next.asked()).toBe(1);
    expect(waits).toEqual([DATA_CHECK_RESTART_WAIT_IN_MS]);
  });

  test("a second try that fails otherwise says so too, and the warehouse is not taken for down", async () => {
    const collection: DataCheckRestarts = restarts([]);
    const failed: Error = await rejectionOf(
      collection.run(reads(busyStatement(), refusal()).read),
    );

    expect(failed.message).toContain("No access.");
    expect(failed.message).toContain(
      "The check was started again 10 seconds after its first try failed for a moment, and failed again.",
    );

    const next: ReturnType<typeof reads> = reads(busyStatement());

    await collection.run(next.read);
    expect(next.asked()).toBe(2);
  });

  test("a collection waits a minute at most in all to start checks again", async () => {
    const waits: Array<number> = [];
    const collection: DataCheckRestarts = restarts(waits);

    for (let check: number = 0; check < 10; check++) {
      try {
        await collection.run(reads(busyStatement()).read);
      } catch {
        // Past the budget: left to the next collection.
      }
    }

    expect(waits).toEqual(
      Array(
        DATA_CHECK_RESTART_BUDGET_IN_MS / DATA_CHECK_RESTART_WAIT_IN_MS,
      ).fill(DATA_CHECK_RESTART_WAIT_IN_MS),
    );
    expect(collection.totalWaitInMs).toBe(DATA_CHECK_RESTART_BUDGET_IN_MS);
  });

  test("the result keeps the note whole, after as much of the failure as fits", () => {
    const failed: DataCheckRestartFailedError = new DataCheckRestartFailedError(
      new Error(`The Databricks statement failed: ${"x".repeat(600)}`),
      DATA_CHECK_RESTART_WAIT_IN_MS,
    );
    const said: string = describeCheckFailure({
      error: failed,
      sanitize: (error: unknown): string => {
        return (error as Error).message;
      },
      maxLength: 500,
    });

    expect(said.length).toBeLessThanOrEqual(500);
    expect(said.endsWith(failed.note)).toBe(true);
    expect(
      describeCheckFailure({
        error: refusal(),
        sanitize: (error: unknown): string => {
          return (error as Error).message;
        },
        maxLength: 19,
      }),
    ).toBe("Databricks answered");
  });
});

/*
 * ---------------------------------------------------------------------------
 * EACH WAREHOUSE'S OWN PASSING FAILURES, THROUGH ITS REAL CLIENT
 * ---------------------------------------------------------------------------
 */

const DATABRICKS_HOST: string = "adb-1234567890123456.7.azuredatabricks.net";
// Not shaped as a real token, so no secret scanner takes it for one.
const DATABRICKS_TOKEN: string = "test-token-for-a-fake-workspace";
const DATABRICKS_CONNECTION: JSONObject = {
  host: DATABRICKS_HOST,
  token: DATABRICKS_TOKEN,
  catalog: "main",
  warehouseId: "abc123def456",
};

function databricks(
  answer: (request: DataSourceHttpRequest) => DataSourceHttpResponse,
): DatabricksApi {
  return new DatabricksApi({
    connection: readDatabricksConnection(JSON.stringify(DATABRICKS_CONNECTION)),
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      return answer(request);
    },
    wait: async (): Promise<void> => {},
  });
}

function failedStatement(
  errorCode: string,
  state: string = "FAILED",
): JSONObject {
  return {
    statement_id: "st-1",
    status: {
      state,
      error: { error_code: errorCode, message: `Failed with ${errorCode}.` },
    },
  };
}

describe("Databricks: a statement FAILED with a code its references call passing", () => {
  test.each([
    "TEMPORARILY_UNAVAILABLE",
    "WORKSPACE_TEMPORARILY_UNAVAILABLE",
    "SERVICE_UNDER_MAINTENANCE",
    "ABORTED",
  ])("%s may pass", async (errorCode: string) => {
    expect(
      await busyOf(
        databricks((): DataSourceHttpResponse => {
          return json(failedStatement(errorCode));
        }).query({ statement: "SELECT 1" }),
      ),
    ).toEqual({ code: errorCode });
  });

  test.each([
    "INTERNAL_ERROR",
    "DEADLINE_EXCEEDED",
    "RESOURCE_EXHAUSTED",
    "BAD_REQUEST",
    "NOT_FOUND",
    "UNKNOWN",
  ])("%s never does", async (errorCode: string) => {
    const error: Error = await rejectionOf(
      databricks((): DataSourceHttpResponse => {
        return json(failedStatement(errorCode));
      }).query({ statement: "SELECT 1" }),
    );

    expect(error.message).toBe(
      `The Databricks statement failed: Failed with ${errorCode}.`,
    );
    expect(readDataSourceBusy(error)).toBeNull();
  });

  test("a statement cancelled never does", async () => {
    expect(
      await busyOf(
        databricks((): DataSourceHttpResponse => {
          return json(failedStatement("TEMPORARILY_UNAVAILABLE", "CANCELED"));
        }).query({ statement: "SELECT 1" }),
      ),
    ).toBeNull();
  });

  test("a gateway's 503 the statement was not sent again after - it may have started - may pass: a check reads only", async () => {
    let sent: number = 0;

    expect(
      await busyOf(
        databricks((): DataSourceHttpResponse => {
          sent++;

          return text("Service Unavailable", 503);
        }).query({ statement: "SELECT 1" }),
      ),
    ).toEqual({ code: null });
    expect(sent).toBe(1);
  });

  test("INTERNAL_ERROR answered to the request never does", async () => {
    expect(
      await busyOf(
        databricks((): DataSourceHttpResponse => {
          return json({ error_code: "INTERNAL_ERROR", message: "Oops." }, 500);
        }).query({ statement: "SELECT 1" }),
      ),
    ).toBeNull();
  });
});

const SNOWFLAKE_ACCOUNT: string = "myorg-myaccount";

function snowflake(
  answer: (request: DataSourceHttpRequest) => DataSourceHttpResponse,
): SnowflakeSqlApi {
  return new SnowflakeSqlApi({
    connection: {
      account: SNOWFLAKE_ACCOUNT,
      user: "oneuptime_reader",
      privateKey: KEY_PAIR.privateKey,
      database: "ANALYTICS",
      warehouse: "CHECKS_WH",
      role: null,
    },
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      return answer(request);
    },
    sleep: async (): Promise<void> => {},
  });
}

describe("Snowflake: a 429 or a 5xx whose tries ran out; no statement error, as its SQL API names none", () => {
  test("a 503 to every try may pass, with Snowflake's code", async () => {
    expect(
      await busyOf(
        snowflake((): DataSourceHttpResponse => {
          return json({ code: "390600", message: "Service unavailable." }, 503);
        }).query({ statement: "SELECT 1" }),
      ),
    ).toEqual({ code: "390600" });
  });

  test("a 429 asking for longer than a collection waits may pass, and says how long", async () => {
    expect(
      await busyOf(
        snowflake((): DataSourceHttpResponse => {
          return json({ message: "Too many requests." }, 429, {
            "retry-after": "45",
          });
        }).query({ statement: "SELECT 1" }),
      ),
    ).toEqual({ code: null, waitInMs: 45_000 });
  });

  test.each([
    [422, "002003", "SQL compilation error: Object does not exist."],
    [408, "000630", "Statement reached its statement or warehouse timeout."],
    [403, "390101", "Not authorized."],
  ])(
    "a %i never does",
    async (statusCode: number, code: string, message: string) => {
      expect(
        await busyOf(
          snowflake((): DataSourceHttpResponse => {
            return json({ code, message }, statusCode);
          }).query({ statement: "SELECT 1" }),
        ),
      ).toBeNull();
    },
  );
});

const SERVICE_ACCOUNT: JSONObject = {
  type: "service_account",
  client_email: "oneuptime@my-project.iam.gserviceaccount.com",
  private_key: KEY_PAIR.privateKey,
  token_uri: "https://oauth2.googleapis.com/token",
};

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
      },
    },
    statusCode,
  );
}

function bigQuery(
  answer: (request: DataSourceHttpRequest) => DataSourceHttpResponse,
): { api: BigQueryApi; requestIds: Array<string> } {
  const requestIds: Array<string> = [];

  return {
    requestIds,
    api: new BigQueryApi({
      connection: readBigQueryConnection(
        JSON.stringify({
          projectId: "my-project",
          dataset: "analytics",
          location: "US",
          serviceAccountJson: JSON.stringify(SERVICE_ACCOUNT),
        }),
      ),
      transport: async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        if (request.url === "https://oauth2.googleapis.com/token") {
          return json({ access_token: "ya29.token-value", expires_in: 3600 });
        }

        if (request.method === "POST") {
          requestIds.push(
            String(
              (JSON.parse(String(request.body)) as JSONObject)["requestId"],
            ),
          );
        }

        return answer(request);
      },
      sleep: async (): Promise<void> => {},
    }),
  };
}

describe("BigQuery: a query job its error reference says to retry", () => {
  test.each([
    [400, "jobBackendError"],
    [400, "jobInternalError"],
    [400, "jobRateLimitExceeded"],
    [400, "tableUnavailable"],
  ])(
    "a %i %s - the job failed, and a new one may pass",
    async (statusCode: number, reason: string) => {
      expect(
        await busyOf(
          bigQuery((): DataSourceHttpResponse => {
            return googleError(statusCode, reason, "Retry the job.");
          }).api.query({ statement: "SELECT 1" }),
        ),
      ).toEqual({ code: reason });
    },
  );

  test("a 503 backendError to every try may pass", async () => {
    expect(
      await busyOf(
        bigQuery((): DataSourceHttpResponse => {
          return googleError(503, "backendError", "Backend error.");
        }).api.query({ statement: "SELECT 1" }),
      ),
    ).toEqual({ code: "backendError" });
  });

  test.each([
    [400, "invalidQuery"],
    [403, "quotaExceeded"],
    [400, "resourcesExceeded"],
    [403, "accessDenied"],
    [404, "notFound"],
  ])("a %i %s never does", async (statusCode: number, reason: string) => {
    expect(
      await busyOf(
        bigQuery((): DataSourceHttpResponse => {
          return googleError(statusCode, reason, "No.");
        }).api.query({ statement: "SELECT 1" }),
      ),
    ).toBeNull();
  });

  test("a query started again is a new job: its requestId is its own, so BigQuery does not answer the failed one again", async () => {
    let posted: number = 0;
    const fake: ReturnType<typeof bigQuery> = bigQuery(
      (): DataSourceHttpResponse => {
        posted++;

        return posted === 1
          ? googleError(400, "jobBackendError", "Retry the job.")
          : json({
              jobComplete: true,
              jobReference: { jobId: "job-2", location: "US" },
              schema: { fields: [{ name: "value" }] },
              rows: [{ f: [{ v: "1" }] }],
            });
      },
    );
    const run: DataCheckRun<Array<Record<string, unknown>>> = await restarts(
      [],
    ).run((): Promise<Array<Record<string, unknown>>> => {
      return fake.api.query({ statement: "SELECT 1 AS value" });
    });

    expect(run.value).toEqual([{ value: "1" }]);
    expect(fake.requestIds).toHaveLength(2);
    expect(fake.requestIds[0]).not.toBe(fake.requestIds[1]);
  });
});

function athena(
  answer: (target: string, body: JSONObject) => DataSourceHttpResponse,
): { api: AthenaApi; tokens: Array<string> } {
  const tokens: Array<string> = [];

  return {
    tokens,
    api: new AthenaApi({
      connection: readAthenaConnection(
        JSON.stringify({
          region: "us-east-1",
          accessKeyId: "AKIAEXAMPLE",
          secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
          database: "analytics",
          workgroup: "checks",
        }),
      ),
      transport: async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        const target: string = String(request.headers?.["X-Amz-Target"] || "");
        const body: JSONObject = JSON.parse(String(request.body)) as JSONObject;

        if (target.endsWith("StartQueryExecution")) {
          tokens.push(String(body["ClientRequestToken"]));
        }

        return answer(target, body);
      },
      wait: async (): Promise<void> => {},
    }),
  };
}

function athenaQuery(
  state: string,
  athenaError?: JSONObject | undefined,
): (target: string) => DataSourceHttpResponse {
  return (target: string): DataSourceHttpResponse => {
    if (target.endsWith("StartQueryExecution")) {
      return json({ QueryExecutionId: "q-1" });
    }

    if (target.endsWith("GetQueryExecution")) {
      return json({
        QueryExecution: {
          Status: {
            State: state,
            StateChangeReason: "It stopped.",
            ...(athenaError ? { AthenaError: athenaError } : {}),
          },
        },
      });
    }

    return json({
      ResultSet: {
        ResultSetMetadata: { ColumnInfo: [{ Name: "value" }] },
        Rows: [
          { Data: [{ VarCharValue: "value" }] },
          { Data: [{ VarCharValue: "1" }] },
        ],
      },
    });
  };
}

describe("Athena: a query FAILED with an error it calls Retryable", () => {
  test("Retryable may pass, with its error type", async () => {
    expect(
      await busyOf(
        athena(
          athenaQuery("FAILED", {
            ErrorCategory: 1,
            ErrorType: 1404,
            Retryable: true,
            ErrorMessage: "Query failed due to Amazon Athena throttling",
          }),
        ).api.query({ statement: "SELECT 1" }),
      ),
    ).toEqual({ code: "ErrorType 1404" });
  });

  test.each([
    [
      "not Retryable",
      "FAILED",
      { ErrorCategory: 2, ErrorType: 1006, Retryable: false },
    ],
    [
      "timed out (206)",
      "FAILED",
      { ErrorCategory: 1, ErrorType: 206, Retryable: true },
    ],
    [
      "timed out (210)",
      "FAILED",
      { ErrorCategory: 1, ErrorType: 210, Retryable: true },
    ],
    [
      "cancelled",
      "CANCELLED",
      { ErrorCategory: 3, ErrorType: 1011, Retryable: true },
    ],
    ["saying nothing of it", "FAILED", undefined],
  ])(
    "one %s never does",
    async (_: string, state: string, athenaError: JSONObject | undefined) => {
      expect(
        await busyOf(
          athena(athenaQuery(state, athenaError)).api.query({
            statement: "SELECT 1",
          }),
        ),
      ).toBeNull();
    },
  );

  test("a throttle whose tries ran out may pass", async () => {
    expect(
      await busyOf(
        athena((): DataSourceHttpResponse => {
          return json(
            {
              __type: "com.amazonaws.athena#TooManyRequestsException",
              message: "Rate exceeded",
            },
            400,
          );
        }).api.query({ statement: "SELECT 1" }),
      ),
    ).toEqual({ code: "TooManyRequestsException" });
  });

  test("a query started again carries a ClientRequestToken of its own, as the first would answer the failed query", async () => {
    let started: number = 0;
    const fake: ReturnType<typeof athena> = athena(
      (target: string): DataSourceHttpResponse => {
        if (target.endsWith("StartQueryExecution")) {
          started++;
        }

        return athenaQuery(
          started === 1 ? "FAILED" : "SUCCEEDED",
          started === 1
            ? { ErrorCategory: 1, ErrorType: 1404, Retryable: true }
            : undefined,
        )(target);
      },
    );
    const run: DataCheckRun<Array<Record<string, unknown>>> = await restarts(
      [],
    ).run((): Promise<Array<Record<string, unknown>>> => {
      return fake.api.query({ statement: "SELECT 1 AS value" });
    });

    expect(run.value).toEqual([{ value: "1" }]);
    expect(fake.tokens).toHaveLength(2);
    expect(fake.tokens[0]).not.toBe(fake.tokens[1]);
  });
});

const CLICKHOUSE_CONNECTION: string =
  "clickhouse://oneuptime_reader:s3cret-pass@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics";

function clickHouse(
  answer: (request: DataSourceHttpRequest) => DataSourceHttpResponse,
): ClickHouseHttpApi {
  return new ClickHouseHttpApi({
    connection: readClickHouseConnection(CLICKHOUSE_CONNECTION),
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      return answer(request);
    },
    sleep: async (): Promise<void> => {},
  });
}

function clickHouseException(
  code: number,
  name: string,
  statusCode: number,
): DataSourceHttpResponse {
  return text(
    `Code: ${code}. DB::Exception: It failed. (${name}) (version 24.8.1.1)`,
    statusCode,
    { "x-clickhouse-exception-code": String(code) },
  );
}

describe("ClickHouse: the answers its server says may pass, once their tries ran out", () => {
  test.each([
    [202, "TOO_MANY_SIMULTANEOUS_QUERIES", 500],
    [209, "SOCKET_TIMEOUT", 503],
    [439, "CANNOT_SCHEDULE_TASK", 503],
    [210, "NETWORK_ERROR", 500],
  ])(
    "%i %s may pass",
    async (code: number, name: string, statusCode: number) => {
      expect(
        await busyOf(
          clickHouse((): DataSourceHttpResponse => {
            return clickHouseException(code, name, statusCode);
          }).query({ statement: "SELECT 1" }),
        ),
      ).not.toBeNull();
    },
  );

  test.each([
    [159, "TIMEOUT_EXCEEDED", 408],
    [62, "SYNTAX_ERROR", 400],
    [60, "UNKNOWN_TABLE", 404],
    [241, "MEMORY_LIMIT_EXCEEDED", 500],
  ])(
    "%i %s never does",
    async (code: number, name: string, statusCode: number) => {
      expect(
        await busyOf(
          clickHouse((): DataSourceHttpResponse => {
            return clickHouseException(code, name, statusCode);
          }).query({ statement: "SELECT 1" }),
        ),
      ).toBeNull();
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * A WHOLE COLLECTION: THE CHECK'S RESULT SAYS IT WAS STARTED AGAIN
 * ---------------------------------------------------------------------------
 */

const CHECK_ID: string = "11111111-2222-4333-8444-555555555555";

function recordRestartWaits(): Array<number> {
  const waits: Array<number> = [];

  jest
    .spyOn(DataCheckRestarts, "sleep")
    .mockImplementation(async (ms: number): Promise<void> => {
      waits.push(ms);
    });
  jest.spyOn(DataSourceHttpRetry, "sleep").mockResolvedValue(undefined);

  return waits;
}

// A Databricks workspace whose check statement fails as told, then answers 7.
function useDatabricks(failures: Array<JSONObject>): () => number {
  let statements: number = 0;

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
          return json({ schemas: [{ name: "sales" }] });
        }

        if (url.pathname === "/api/2.1/unity-catalog/tables") {
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
        }

        if (url.pathname === "/api/2.0/sql/statements/") {
          statements++;

          return json(
            failures[statements - 1] || {
              statement_id: `st-${statements}`,
              status: { state: "SUCCEEDED" },
              manifest: { schema: { columns: [{ name: "value" }] } },
              result: { data_array: [["7"]] },
            },
          );
        }

        throw new Error(`Unexpected request: ${request.url}`);
      },
    );

  return (): number => {
    return statements;
  };
}

async function collectWithCheck(): Promise<TableHealthSnapshot> {
  return await collectTableHealth(
    {
      engine: "databricks",
      connectionString: JSON.stringify(DATABRICKS_CONNECTION),
    },
    {
      maxTables: 100,
      maxColumns: 1000,
      exclusions: [],
      checks: [
        {
          checkId: CHECK_ID,
          type: DataCheckType.RowCount,
          isSegmented: false,
          sql: "SELECT COUNT(*) AS value FROM main.sales.orders",
          params: [],
        },
      ],
    },
  );
}

describe("a whole collection whose check the warehouse failed for a moment", () => {
  test("the check is started again, ran, and its result says why its first try failed", async () => {
    const waits: Array<number> = recordRestartWaits();
    const statements: () => number = useDatabricks([
      failedStatement("TEMPORARILY_UNAVAILABLE"),
    ]);
    const snapshot: TableHealthSnapshot = await collectWithCheck();

    expect(statements()).toBe(2);
    expect(waits).toEqual([DATA_CHECK_RESTART_WAIT_IN_MS]);
    expect(snapshot.checkResults).toEqual([
      {
        checkId: CHECK_ID,
        values: [{ segment: null, value: 7 }],
        error: null,
        restartedAfter:
          "The Databricks statement failed: Failed with TEMPORARILY_UNAVAILABLE.",
      },
    ]);
  });

  test("one that fails again could not run, and says it was started again", async () => {
    recordRestartWaits();
    useDatabricks([
      failedStatement("TEMPORARILY_UNAVAILABLE"),
      failedStatement("SERVICE_UNDER_MAINTENANCE"),
    ]);

    const snapshot: TableHealthSnapshot = await collectWithCheck();

    expect(snapshot.checkResults).toEqual([
      {
        checkId: CHECK_ID,
        values: [],
        error:
          "The Databricks statement failed: Failed with SERVICE_UNDER_MAINTENANCE. The check was started again 10 seconds after its first try failed for a moment, and failed again.",
      },
    ]);
  });

  test("one that failed for good is not started again", async () => {
    const waits: Array<number> = recordRestartWaits();
    const statements: () => number = useDatabricks([
      failedStatement("BAD_REQUEST"),
    ]);
    const snapshot: TableHealthSnapshot = await collectWithCheck();

    expect(statements()).toBe(1);
    expect(waits).toEqual([]);
    expect(snapshot.checkResults![0]!.error).toBe(
      "The Databricks statement failed: Failed with BAD_REQUEST.",
    );
  });

  test("a probe's report carries it, and the check says it ran at its second try", async () => {
    recordRestartWaits();
    useDatabricks([failedStatement("TEMPORARILY_UNAVAILABLE")]);

    const snapshot: TableHealthSnapshot = await collectWithCheck();
    const read: Array<DataCheckRunResult> = readCheckResults(
      JSON.parse(JSON.stringify(snapshot.checkResults)),
    );

    expect(read[0]!.restartedAfter).toBe(
      "The Databricks statement failed: Failed with TEMPORARILY_UNAVAILABLE.",
    );
    expect(getLastRunMessage(read[0]!)).toBe(
      "Ran at its second try, started again after its first failed for a moment: The Databricks statement failed: Failed with TEMPORARILY_UNAVAILABLE.",
    );
  });
});

describe("what a check's result says beside its status", () => {
  test("why it could not run; that it ran at its second try; that it read no value; or nothing", () => {
    const ran: DataCheckRunResult = {
      checkId: CHECK_ID,
      values: [{ segment: null, value: 7 }],
      error: null,
    };

    expect(getLastRunMessage(ran)).toBeNull();
    expect(getLastRunMessage({ ...ran, error: "It failed." })).toBe(
      "It failed.",
    );
    expect(
      getLastRunMessage({
        ...ran,
        values: [],
        restartedAfter: "ClickHouse answered 503: Service is waking up.",
      }),
    ).toBe(
      "Ran at its second try, started again after its first failed for a moment: ClickHouse answered 503: Service is waking up. The check read no value: the table, or the rows it reads, are empty.",
    );
  });

  test("an older probe says nothing of it, and a failed check's restart is in its error", () => {
    const [older, failed]: Array<DataCheckRunResult> = readCheckResults([
      { checkId: CHECK_ID, values: [{ segment: null, value: 1 }], error: null },
      {
        checkId: CHECK_ID,
        values: [],
        error: "It failed.",
        restartedAfter: "Ignored: a check that failed did not run.",
      },
    ]);

    expect(older).not.toHaveProperty("restartedAfter");
    expect(failed).not.toHaveProperty("restartedAfter");
  });
});
