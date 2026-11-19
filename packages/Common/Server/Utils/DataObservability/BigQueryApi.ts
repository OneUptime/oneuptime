import crypto from "crypto";
import { JSONObject } from "../../../Types/JSON";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../DataSource/HttpFetch";
import {
  DataSourceUnreachedError,
  failedAnswerError,
  readBodyText,
  readErrorCode,
  unreachedError,
} from "../DataSource/HttpFailure";
import DataSourceHttpRetry, {
  busyOfExchange,
  HttpRetryExchange,
  HttpRetryReason,
  HttpRetryVerdict,
} from "../DataSource/HttpRetry";
import GoogleServiceAccountToken from "../LlmObservability/Connectors/GoogleVertexAI/GoogleServiceAccountToken";

/*
 * GOOGLE BIGQUERY, OVER ITS REST API, AS A SERVICE ACCOUNT.
 *
 * A dataset is a store: Data Security finds them from a Google Cloud
 * connection, and Data Observability collects each with that connection's
 * own service account (DataObservabilityRunner builds the connection when it
 * collects, and keeps it nowhere). A dataset can be connected by hand too,
 * with JSON: { projectId, dataset, location, serviceAccountJson }. Each
 * statement is a query job, followed to its last page; the service account
 * needs BigQuery Metadata Viewer for the catalog and BigQuery Job User to
 * run it, and Data Viewer on a table a check reads.
 *
 * An answer that may pass is asked again (DataSourceHttpRetry), as
 * BigQuery's error reference says: a 5xx (backendError, internalError, or a
 * proxy's) with truncated exponential backoff, and rateLimitExceeded (a 429,
 * or a 403 that says so) after slowing down. quotaExceeded, also a 403, is
 * not: asking again does not raise a quota. A query is sent again under the
 * requestId of its first sending, which makes jobs.query idempotent for 15
 * minutes, so a query that did start is not started twice. The sign-in to
 * Google is asked again the same way.
 */

export interface BigQueryConnection {
  projectId: string;
  dataset: string;
  location: string | null;
  serviceAccountJson: string;
}

export type BigQueryTransport = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;

const BIGQUERY_BASE_URL: string = "https://bigquery.googleapis.com/bigquery/v2";
const BIGQUERY_READ_SCOPE: string =
  "https://www.googleapis.com/auth/bigquery.readonly";
const PROVIDER_TITLE: string = "Google BigQuery";
const QUERY_WAIT_MS: number = 30_000;
const QUERY_MAX_ROWS: number = 10_000;
const MAX_CALLS: number = 30;

const PROJECT_PATTERN: RegExp = /^[a-z][a-z0-9:.-]{4,62}$/i;
// The 403 reason of a short-term rate limit, as opposed to a quota spent (quotaExceeded).
const RATE_LIMIT_REASONS: ReadonlyArray<string> = [
  "rateLimitExceeded",
  "userRateLimitExceeded",
];

/*
 * A query job BigQuery took and then failed for a moment (#9679): the
 * reasons its error reference ("Troubleshoot errors") says to retry the
 * job, with a new job ID - which a check started again gets, as each query
 * is sent under a requestId of its own. backendError and internalError ("a
 * temporary server failure"), jobBackendError and jobInternalError ("Retry
 * the job with a new jobId"), jobRateLimitExceeded and rateLimitExceeded
 * (a short-term limit) and tableUnavailable (a table another Google
 * product backs, for now). Never quotaExceeded (a quota spent for long),
 * resourcesExceeded or timeout (the job would do the same again), or
 * stopped.
 */
export const BIGQUERY_BUSY_JOB_REASONS: ReadonlyArray<string> = [
  "backendError",
  "internalError",
  "jobBackendError",
  "jobInternalError",
  "jobRateLimitExceeded",
  "rateLimitExceeded",
  "tableUnavailable",
];
const DATASET_PATTERN: RegExp = /^[A-Za-z0-9_]{1,1024}$/;

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

// The error Google's APIs answer with: { error: { code, message, status, errors: [{ reason }] } }.
function readGoogleError(response: DataSourceHttpResponse): {
  reason: string;
  status: string;
  message: string;
} {
  const error: JSONObject = readObject(readObject(response.bodyJson)["error"]);
  const first: JSONObject = readObject(readArray(error["errors"])[0]);

  return {
    reason: readText(first["reason"]),
    status: readText(error["status"]),
    message: readText(error["message"]) || readText(first["message"]),
  };
}

/*
 * The answers of BigQuery's REST API worth asking again, as its error
 * reference says: a 500, 502, 503 or 504 (backendError, internalError, or a
 * proxy's) with truncated exponential backoff; and a short-term rate limit,
 * rateLimitExceeded, which comes as a 429 or a 403, after slowing down.
 * Every other 403 (accessDenied, quotaExceeded) would be refused again.
 */
export function classifyBigQueryAnswer(
  response: DataSourceHttpResponse,
): HttpRetryVerdict | null {
  const status: number = response.statusCode;

  if (
    status === 429 ||
    (status === 403 &&
      RATE_LIMIT_REASONS.includes(readGoogleError(response).reason))
  ) {
    return { reason: HttpRetryReason.Throttled };
  }

  return [500, 502, 503, 504].includes(status)
    ? { reason: HttpRetryReason.Unavailable }
    : null;
}

export function readBigQueryConnection(value: string): BigQueryConnection {
  let raw: JSONObject = {};

  try {
    raw = readObject(JSON.parse((value || "").trim()));
  } catch {
    raw = {};
  }

  const serviceAccount: unknown = raw["serviceAccountJson"];
  const connection: BigQueryConnection = {
    projectId: readText(raw["projectId"]),
    dataset: readText(raw["dataset"]),
    location: readText(raw["location"]) || null,
    serviceAccountJson:
      typeof serviceAccount === "string"
        ? serviceAccount
        : serviceAccount && typeof serviceAccount === "object"
          ? JSON.stringify(serviceAccount)
          : "",
  };

  if (!PROJECT_PATTERN.test(connection.projectId)) {
    throw new Error("The BigQuery connection needs its projectId.");
  }

  if (!DATASET_PATTERN.test(connection.dataset)) {
    throw new Error("The BigQuery connection needs its dataset.");
  }

  if (!connection.serviceAccountJson.includes("private_key")) {
    throw new Error(
      "The BigQuery connection needs a service account key (serviceAccountJson).",
    );
  }

  return connection;
}

// The connection of a dataset a Google Cloud connection found, for one collection.
export function buildBigQueryConnectionString(
  connection: BigQueryConnection,
): string {
  return JSON.stringify(connection);
}

/*
 * A query's rows, each keyed by its field's name in lower case. A value is
 * its text, as BigQuery's REST API writes every value; a timestamp is
 * seconds since the epoch.
 */
export function readBigQueryRows(
  body: JSONObject,
): Array<Record<string, unknown>> {
  const names: Array<string> = readArray(
    readObject(body["schema"])["fields"],
  ).map((field: unknown): string => {
    return readText(readObject(field)["name"]).toLowerCase();
  });

  return readArray(body["rows"]).map(
    (row: unknown): Record<string, unknown> => {
      const cells: Array<unknown> = readArray(readObject(row)["f"]);
      const record: Record<string, unknown> = {};

      names.forEach((name: string, index: number) => {
        record[name] = readObject(cells[index])["v"] ?? null;
      });

      return record;
    },
  );
}

export default class BigQueryApi {
  private readonly connection: BigQueryConnection;
  // Every request of the collection, asked again within one budget (DataSourceHttpRetry).
  private readonly retry: DataSourceHttpRetry;
  private readonly token: GoogleServiceAccountToken;

  public constructor(data: {
    connection: BigQueryConnection;
    transport?: BigQueryTransport | undefined;
    sleep?: ((ms: number) => Promise<void>) | undefined;
  }) {
    this.connection = data.connection;
    this.retry = new DataSourceHttpRetry({
      transport:
        data.transport || DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
      classify: classifyBigQueryAnswer,
      provider: PROVIDER_TITLE,
      ...(data.sleep ? { sleep: data.sleep } : {}),
    });
    this.token = new GoogleServiceAccountToken({
      serviceAccountJson: data.connection.serviceAccountJson,
      scope: BIGQUERY_READ_SCOPE,
      // A sign-in does nothing twice, and its limits are Google's sign-in's.
      transport: this.retry.asTransport({
        isSafeToRepeat: (): boolean => {
          return true;
        },
        sharesThrottle: false,
      }),
      providerTitle: PROVIDER_TITLE,
    });
  }

  /*
   * One request, asked again while its answer may pass. Every request is a
   * read or a query under its requestId, so each is safe to send again. An
   * answer outside 2xx says what was being read and Google's own reason and
   * message, never the token.
   */
  private async request(data: {
    method: "GET" | "POST";
    url: string;
    body?: JSONObject | undefined;
    operation: string;
  }): Promise<JSONObject> {
    let accessToken: string = "";
    let exchange: HttpRetryExchange;

    try {
      exchange = await this.retry.exchange({
        build: async (): Promise<DataSourceHttpRequest> => {
          accessToken = await this.token.getAccessToken();

          return {
            method: data.method,
            url: data.url,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
              ...(data.body ? { "Content-Type": "application/json" } : {}),
            },
            ...(data.body ? { body: JSON.stringify(data.body) } : {}),
            timeoutInMs: QUERY_WAIT_MS + 15_000,
            acceptAnyStatus: true,
          };
        },
        isSafeToRepeat: true,
      });
    } catch (error) {
      // The sign-in says its own failure, in Google's words.
      if (!(error instanceof DataSourceUnreachedError)) {
        throw error;
      }

      throw unreachedError({
        provider: PROVIDER_TITLE,
        operation: data.operation,
        error,
        secrets: [accessToken],
      });
    }

    const response: DataSourceHttpResponse = exchange.response;
    const body: unknown = response.bodyJson;

    if (response.statusCode < 200 || response.statusCode >= 300) {
      const error: { reason: string; status: string; message: string } =
        readGoogleError(response);
      const errorCode: string | null = readErrorCode(
        error.reason || error.status,
      );

      throw failedAnswerError({
        provider: PROVIDER_TITLE,
        statusCode: response.statusCode,
        errorCode,
        operation: data.operation,
        message:
          error.message ||
          (body === undefined ? readBodyText(response.bodyText) : ""),
        attempts: exchange.attempts,
        requestId: null,
        refused: { who: "the service account" },
        secrets: [accessToken],
        // An answer whose tries ran out, or a query job that failed for a moment, may pass (#9679).
        busy:
          busyOfExchange(exchange, { code: errorCode, nowMs: Date.now() }) ||
          (BIGQUERY_BUSY_JOB_REASONS.includes(error.reason)
            ? { code: errorCode }
            : null),
      });
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error(
        `${PROVIDER_TITLE} answered ${response.statusCode} while ${data.operation}, but with no JSON object.`,
      );
    }

    return body as JSONObject;
  }

  // One query's rows, its parameters bound by position (?), every page.
  public async query(data: {
    statement: string;
    params?: Array<string> | undefined;
    // BigQuery refuses a query that would bill more, before it reads a byte.
    maximumBytesBilled?: number | undefined;
    // What the query reads, as a failure says it: "listing the tables (__TABLES__)".
    operation?: string | undefined;
  }): Promise<Array<Record<string, unknown>>> {
    const operation: string = data.operation || "running a query";
    const base: string = `${BIGQUERY_BASE_URL}/projects/${encodeURIComponent(
      this.connection.projectId,
    )}/queries`;
    let answer: JSONObject = await this.request({
      method: "POST",
      url: base,
      operation,
      body: {
        // The same for every sending of this query: BigQuery starts it once (jobs.query).
        requestId: crypto.randomUUID(),
        query: data.statement,
        useLegacySql: false,
        timeoutMs: QUERY_WAIT_MS,
        maxResults: QUERY_MAX_ROWS,
        ...(data.maximumBytesBilled
          ? { maximumBytesBilled: String(data.maximumBytesBilled) }
          : {}),
        ...(this.connection.location
          ? { location: this.connection.location }
          : {}),
        ...((data.params || []).length > 0
          ? {
              parameterMode: "POSITIONAL",
              queryParameters: (data.params || []).map(
                (value: string): JSONObject => {
                  return {
                    parameterType: { type: "STRING" },
                    parameterValue: { value },
                  };
                },
              ),
            }
          : {}),
      },
    });
    const job: JSONObject = readObject(answer["jobReference"]);
    const jobId: string = readText(job["jobId"]);
    const location: string = readText(job["location"]);
    const rows: Array<Record<string, unknown>> = [];
    let schema: JSONObject | undefined = undefined;

    for (let call: number = 0; call < MAX_CALLS; call++) {
      // An answer still running has no schema yet; a later page repeats it.
      const answerSchema: JSONObject = readObject(answer["schema"]);

      if (readArray(answerSchema["fields"]).length > 0) {
        schema = answerSchema;
      }

      if (answer["jobComplete"] !== false) {
        rows.push(...readBigQueryRows({ ...answer, schema }));

        const pageToken: string = readText(answer["pageToken"]);

        if (!pageToken) {
          return rows;
        }

        answer = await this.request({
          method: "GET",
          url: `${base}/${encodeURIComponent(jobId)}?${new URLSearchParams({
            location,
            pageToken,
            maxResults: String(QUERY_MAX_ROWS),
            timeoutMs: String(QUERY_WAIT_MS),
          }).toString()}`,
          operation,
        });
        continue;
      }

      // Still running: asked again, waiting up to QUERY_WAIT_MS.
      answer = await this.request({
        method: "GET",
        url: `${base}/${encodeURIComponent(jobId)}?${new URLSearchParams({
          location,
          maxResults: String(QUERY_MAX_ROWS),
          timeoutMs: String(QUERY_WAIT_MS),
        }).toString()}`,
        operation,
      });
    }

    throw new Error("The BigQuery query did not finish in time.");
  }
}
