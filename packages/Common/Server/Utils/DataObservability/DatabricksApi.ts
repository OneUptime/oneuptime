import { JSONObject } from "../../../Types/JSON";
import RetryAfter from "../../../Utils/RetryAfter";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../DataSource/HttpFetch";
import {
  DataSourceBusyError,
  DataSourceUnreachedError,
  failedAnswerError,
  isRequestId,
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

/*
 * DATABRICKS, OVER ITS REST APIS: UNITY CATALOG, AND SQL STATEMENTS.
 *
 * A Unity Catalog catalog is a store. Its schemas, tables, views and
 * columns are read from Unity Catalog's own REST API, which needs no SQL
 * warehouse, so collecting a catalog costs no compute. A data check reads
 * a table's rows, and lineage is read from the system.access.table_lineage
 * system table, so both run on a SQL warehouse, over the SQL Statement
 * Execution API: one statement per request, polled while it runs, its
 * values bound as named parameters (:p1, :p2, ...).
 *
 * Signed in with a personal access token, or as a service principal
 * (OAuth machine-to-machine: its client ID and secret buy a token for an
 * hour, which is all that is sent after). The connection is JSON -
 * { host, token | clientId + clientSecret, catalog, warehouseId } - or a
 * URL as Databricks' own SQL drivers take it:
 * databricks://token:<token>@<host>?http_path=/sql/1.0/warehouses/<id>&catalog=main.
 *
 * An answer that may pass is asked again (DataSourceHttpRetry), as
 * Databricks' REST API error reference says: TEMPORARILY_UNAVAILABLE (503)
 * with backoff, waiting at least the retry_delay of its RetryInfo, and a
 * 429 or a 503 from the gateway in front of the API, which carries no
 * error_code. RESOURCE_EXHAUSTED (429) is a quota as often as a rate limit,
 * so it is asked again only when it says how long to wait; INTERNAL_ERROR
 * (500) and DEADLINE_EXCEEDED (504), which may have completed, never are.
 * A statement has no idempotency key, so it is sent again only when the
 * API answered that it did not accept it (a non-200 answer of its own) or
 * turned it away: the statement never started.
 */

export interface DatabricksConnection {
  // The workspace's host: adb-1234567890123456.7.azuredatabricks.net.
  host: string;
  token: string | null;
  clientId: string | null;
  clientSecret: string | null;
  catalog: string;
  warehouseId: string | null;
}

export type DatabricksTransport = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;

// How long a statement is waited for in its first request (the API's most is 50s).
const FIRST_WAIT_IN_SECONDS: number = 30;
// A stopped warehouse can take minutes to start: how long a statement is followed in all.
export const DATABRICKS_STATEMENT_DEADLINE_IN_MS: number = 4 * 60 * 1000;
const POLL_WAIT_IN_MS: number = 2_000;
const MAX_CHUNKS: number = 50;
const MAX_PAGES: number = 200;
const MAX_ROWS: number = 50_000;
const REQUEST_TIMEOUT_IN_MS: number = 60_000;

const HOST_PATTERN: RegExp = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const NAME_PATTERN: RegExp = /^[^\s.`"/]{1,255}$/;
const WAREHOUSE_PATTERN: RegExp = /^[a-z0-9]{6,64}$/i;
const WAREHOUSE_PATH: RegExp =
  /\/sql\/1\.0\/(?:warehouses|endpoints)\/([a-z0-9]+)/i;

const FINISHED_STATES: ReadonlyArray<string> = [
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
  "CLOSED",
];

/*
 * A statement Databricks took and then failed for a moment (#9679): its
 * status FAILED with one of these status.error.error_code values, which
 * may pass. The REST API error reference calls TEMPORARILY_UNAVAILABLE "a
 * transient condition that usually clears on its own", and says to retry
 * an ABORTED operation - a concurrency conflict - as a whole; the
 * Statement Execution API names a workspace that is so too
 * (WORKSPACE_TEMPORARILY_UNAVAILABLE) or under maintenance
 * (SERVICE_UNDER_MAINTENANCE). Never INTERNAL_ERROR (support's, the
 * reference says), DEADLINE_EXCEEDED (it may have completed, and would
 * time out again), RESOURCE_EXHAUSTED (a quota spent for hours) or a
 * request's own fault (BAD_REQUEST, NOT_FOUND...).
 */
export const DATABRICKS_BUSY_STATEMENT_CODES: ReadonlyArray<string> = [
  "TEMPORARILY_UNAVAILABLE",
  "WORKSPACE_TEMPORARILY_UNAVAILABLE",
  "SERVICE_UNDER_MAINTENANCE",
  "ABORTED",
];

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

function fromUrl(value: string): JSONObject {
  const url: URL = new URL(value);
  const user: string = decodeURIComponent(url.username);
  const password: string = decodeURIComponent(url.password);
  const path: string = decodeURIComponent(url.pathname.replace(/^\/+/, ""));

  return {
    host: url.hostname,
    // Databricks' drivers take a token as the password of the user "token".
    token: user === "token" || !user ? password : "",
    clientId: user && user !== "token" ? user : "",
    clientSecret: user && user !== "token" ? password : "",
    catalog:
      url.searchParams.get("catalog") ||
      url.searchParams.get("ConnCatalog") ||
      path.split("/")[0] ||
      "",
    warehouseId:
      url.searchParams.get("warehouse_id") ||
      url.searchParams.get("http_path") ||
      url.searchParams.get("httpPath") ||
      "",
  };
}

// A warehouse's ID, from itself or from its HTTP path (/sql/1.0/warehouses/<id>).
export function readWarehouseId(value: unknown): string | null {
  const text: string = readText(value);
  const fromPath: RegExpMatchArray | null = text.match(WAREHOUSE_PATH);
  const id: string = fromPath ? fromPath[1]! : text;

  return id && WAREHOUSE_PATTERN.test(id) ? id : null;
}

// The connection a store's string describes; why not, when it describes none.
export function readDatabricksConnection(value: string): DatabricksConnection {
  const text: string = (value || "").trim();
  let raw: JSONObject = {};

  try {
    raw = text.startsWith("{")
      ? (JSON.parse(text) as JSONObject)
      : text.toLowerCase().startsWith("databricks://")
        ? fromUrl(text)
        : {};
  } catch {
    raw = {};
  }

  const host: string = readText(raw["host"] ?? raw["workspaceUrl"])
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  const connection: DatabricksConnection = {
    host,
    token: readText(raw["token"] ?? raw["accessToken"]) || null,
    clientId: readText(raw["clientId"] ?? raw["client_id"]) || null,
    clientSecret: readText(raw["clientSecret"] ?? raw["client_secret"]) || null,
    catalog: readText(raw["catalog"]),
    warehouseId: readWarehouseId(
      raw["warehouseId"] ??
        raw["warehouse_id"] ??
        raw["httpPath"] ??
        raw["http_path"],
    ),
  };

  if (!HOST_PATTERN.test(connection.host)) {
    throw new Error(
      "The Databricks connection needs the workspace's host, such as adb-1234567890123456.7.azuredatabricks.net.",
    );
  }

  if (!NAME_PATTERN.test(connection.catalog)) {
    throw new Error(
      "The Databricks connection needs the Unity Catalog catalog to watch, such as main.",
    );
  }

  if (!connection.token && !(connection.clientId && connection.clientSecret)) {
    throw new Error(
      "The Databricks connection needs a personal access token, or a service principal's client ID and secret.",
    );
  }

  return connection;
}

/*
 * A statement's rows, each keyed by its column's name in lower case: the
 * manifest names the columns, the result's data_array holds the values.
 */
export function readDatabricksRows(
  manifest: JSONObject,
  dataArray: unknown,
): Array<Record<string, unknown>> {
  const names: Array<string> = readArray(
    readObject(readObject(manifest)["schema"])["columns"],
  ).map((column: unknown): string => {
    return readText(readObject(column)["name"]).toLowerCase();
  });
  const rows: Array<Record<string, unknown>> = [];

  for (const values of readArray(dataArray)) {
    if (!Array.isArray(values)) {
      continue;
    }

    const row: Record<string, unknown> = {};

    names.forEach((name: string, index: number) => {
      row[name] = values[index] ?? null;
    });
    rows.push(row);
  }

  return rows;
}

// A duration as Databricks writes one ("3.5s"), in milliseconds.
function readDuration(value: unknown): number | undefined {
  const match: RegExpMatchArray | null =
    readText(value).match(/^(\d+(?:\.\d+)?)s$/);
  const ms: number = match ? Math.round(Number(match[1]) * 1000) : NaN;

  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

// The details of an error of a kind: RetryInfo, RequestInfo.
function errorDetail(body: JSONObject, type: string): JSONObject {
  for (const detail of readArray(body["details"])) {
    const entry: JSONObject = readObject(detail);

    if (readText(entry["@type"]).endsWith(`.${type}`)) {
      return entry;
    }
  }

  return {};
}

/*
 * The answers of Databricks' REST APIs worth asking again, as its error
 * reference says: TEMPORARILY_UNAVAILABLE (503), retried with backoff and
 * at least its RetryInfo's retry_delay, which the API answers before
 * accepting the request; a 429 or a 503 of the gateway in front of the API,
 * which carries no error_code; and RESOURCE_EXHAUSTED (429) only when it
 * says how long to wait, short-term throttling rather than a quota spent
 * for hours. INTERNAL_ERROR (500) is support's, and DEADLINE_EXCEEDED (504)
 * may have completed: neither is asked again.
 */
export function classifyDatabricksAnswer(
  response: DataSourceHttpResponse,
): HttpRetryVerdict | null {
  const body: JSONObject = readObject(response.bodyJson);
  // A legacy endpoint's integer error_code is no code: its status says it.
  const errorCode: string =
    typeof body["error_code"] === "string" ? body["error_code"].trim() : "";
  const retryDelayInMs: number | undefined = readDuration(
    errorDetail(body, "RetryInfo")["retry_delay"],
  );

  if (response.statusCode === 503) {
    return {
      reason: HttpRetryReason.Unavailable,
      // The API's own 503 is a failure to accept the request: no statement started.
      isUndone: Boolean(errorCode),
      waitInMs: retryDelayInMs,
    };
  }

  if (response.statusCode === 429) {
    const saysHowLong: boolean =
      retryDelayInMs !== undefined ||
      RetryAfter.readHeader(response.headers) !== undefined;

    return !errorCode || saysHowLong
      ? { reason: HttpRetryReason.Throttled, waitInMs: retryDelayInMs }
      : null;
  }

  return null;
}

function errorOf(body: JSONObject, fallback: string): string {
  const status: JSONObject = readObject(body["status"]);
  const error: JSONObject = readObject(status["error"]);

  return (
    readText(error["message"]) ||
    readText(body["message"]) ||
    readText(body["error_description"]) ||
    readText(body["error"]) ||
    fallback
  ).slice(0, 300);
}

export default class DatabricksApi {
  private readonly connection: DatabricksConnection;
  private readonly now: () => number;
  private readonly wait: (ms: number) => Promise<void>;
  // Every request of the collection, asked again within one budget (DataSourceHttpRetry).
  private readonly retry: DataSourceHttpRetry;
  private accessToken: { value: string; expiresAt: number } | null = null;

  public constructor(data: {
    connection: DatabricksConnection;
    transport?: DatabricksTransport | undefined;
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
      classify: classifyDatabricksAnswer,
      provider: "Databricks",
      now: this.now,
      sleep: this.wait,
    });
  }

  public get warehouseId(): string | null {
    return this.connection.warehouseId;
  }

  public get catalog(): string {
    return this.connection.catalog;
  }

  // What an answer could repeat that no error may: the token and the service principal's secret.
  private secrets(): Array<string> {
    return [
      // As a databricks:// URL writes them, before the secret alone.
      this.connection.token ? `token:${this.connection.token}` : "",
      this.connection.clientSecret
        ? `${this.connection.clientId}:${this.connection.clientSecret}`
        : "",
      this.connection.token || "",
      this.connection.clientSecret || "",
      this.accessToken?.value || "",
    ];
  }

  // Who Databricks refuses: the access token, or the service principal it signed in.
  private get refusedWho(): string {
    return this.connection.token ? "the access token" : "the service principal";
  }

  // One request, asked again while its answer may pass; a request that got no answer says what was being read.
  private async exchange(data: {
    build: () => DataSourceHttpRequest | Promise<DataSourceHttpRequest>;
    isSafeToRepeat: boolean;
    sharesThrottle?: boolean | undefined;
    operation: string;
  }): Promise<HttpRetryExchange> {
    try {
      return await this.retry.exchange({
        build: data.build,
        isSafeToRepeat: data.isSafeToRepeat,
        sharesThrottle: data.sharesThrottle,
      });
    } catch (error) {
      // A failure of the request's own making (a sign-in refused) says itself.
      if (!(error instanceof DataSourceUnreachedError)) {
        throw error;
      }

      throw unreachedError({
        provider: "Databricks",
        operation: data.operation,
        error,
        secrets: this.secrets(),
      });
    }
  }

  // What an answer that is no success says: what was being read, Databricks' error_code and message, and its request ID.
  private failure(
    exchange: HttpRetryExchange,
    operation: string,
    fallback: string,
  ): Error {
    const body: JSONObject = readObject(exchange.response.bodyJson);
    const requestId: unknown = errorDetail(body, "RequestInfo")["request_id"];

    const errorCode: string | null = readErrorCode(
      body["error_code"] ?? body["error"],
    );

    return failedAnswerError({
      provider: "Databricks",
      statusCode: exchange.response.statusCode,
      errorCode,
      operation,
      message: errorOf(
        body,
        exchange.response.bodyJson === undefined
          ? readBodyText(exchange.response.bodyText)
          : fallback,
      ),
      attempts: exchange.attempts,
      requestId: isRequestId(requestId) ? requestId.trim() : null,
      refused: { who: this.refusedWho },
      secrets: this.secrets(),
      busy: busyOfExchange(exchange, { code: errorCode, nowMs: this.now() }),
    });
  }

  // A service principal's token, bought with its client ID and secret, kept until a minute before it ends.
  private async bearer(): Promise<string> {
    if (this.connection.token) {
      return this.connection.token;
    }

    if (this.accessToken && this.accessToken.expiresAt - 60_000 > this.now()) {
      return this.accessToken.value;
    }

    const operation: string = "signing in (oidc/v1/token)";
    const exchange: HttpRetryExchange = await this.exchange({
      build: (): DataSourceHttpRequest => {
        return {
          method: "POST",
          url: `https://${this.connection.host}/oidc/v1/token`,
          headers: {
            Authorization: `Basic ${Buffer.from(
              `${this.connection.clientId}:${this.connection.clientSecret}`,
            ).toString("base64")}`,
          },
          body: { grant_type: "client_credentials", scope: "all-apis" },
          formUrlEncoded: true,
          timeoutInMs: REQUEST_TIMEOUT_IN_MS,
          acceptAnyStatus: true,
        };
      },
      // A sign-in does nothing twice, and its limits are not the workspace API's.
      isSafeToRepeat: true,
      sharesThrottle: false,
      operation,
    });
    const body: JSONObject = readObject(exchange.response.bodyJson);
    const token: string = readText(body["access_token"]);

    if (exchange.response.statusCode >= 400 || !token) {
      throw this.failure(exchange, operation, "no token was given");
    }

    const lifetime: number = Number(body["expires_in"]) || 3600;

    this.accessToken = {
      value: token,
      expiresAt: this.now() + lifetime * 1000,
    };

    return token;
  }

  private async send(data: {
    method: "GET" | "POST";
    path: string;
    body?: JSONObject | undefined;
    operation: string;
    // A request that could start work twice (a statement): sent again only when Databricks did not take it.
    isSafeToRepeat?: boolean | undefined;
  }): Promise<JSONObject> {
    const exchange: HttpRetryExchange = await this.exchange({
      build: async (): Promise<DataSourceHttpRequest> => {
        return {
          method: data.method,
          url: `https://${this.connection.host}${data.path}`,
          headers: {
            Authorization: `Bearer ${await this.bearer()}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          ...(data.body ? { body: JSON.stringify(data.body) } : {}),
          timeoutInMs: REQUEST_TIMEOUT_IN_MS,
          acceptAnyStatus: true,
        };
      },
      isSafeToRepeat: data.isSafeToRepeat ?? data.method === "GET",
      operation: data.operation,
    });

    if (exchange.response.statusCode >= 400) {
      throw this.failure(exchange, data.operation, "");
    }

    return readObject(exchange.response.bodyJson);
  }

  // Every page of a Unity Catalog listing, to its last page or the most pages read.
  private async listPages(
    path: string,
    params: Record<string, string>,
    key: string,
    maxItems: number,
    operation: string,
  ): Promise<Array<JSONObject>> {
    const items: Array<JSONObject> = [];
    let pageToken: string = "";

    for (let page: number = 0; page < MAX_PAGES; page++) {
      const search: URLSearchParams = new URLSearchParams(params);

      if (pageToken) {
        search.set("page_token", pageToken);
      }

      const body: JSONObject = await this.send({
        method: "GET",
        path: `${path}?${search.toString()}`,
        operation,
      });

      for (const item of readArray(body[key])) {
        if (items.length >= maxItems) {
          return items;
        }

        items.push(readObject(item));
      }

      pageToken = readText(body["next_page_token"]);

      if (!pageToken) {
        break;
      }
    }

    return items;
  }

  // The catalog itself: a connection that cannot read it cannot collect.
  public async getCatalog(): Promise<JSONObject> {
    return await this.send({
      method: "GET",
      path: `/api/2.1/unity-catalog/catalogs/${encodeURIComponent(this.connection.catalog)}`,
      operation: `reading the catalog ${this.connection.catalog.slice(0, 60)}`,
    });
  }

  public async listSchemas(): Promise<Array<string>> {
    return (
      await this.listPages(
        "/api/2.1/unity-catalog/schemas",
        { catalog_name: this.connection.catalog, max_results: "0" },
        "schemas",
        10_000,
        "listing the schemas",
      )
    )
      .map((schema: JSONObject): string => {
        return readText(schema["name"]);
      })
      .filter(Boolean);
  }

  // A schema's tables and views, each with its columns and properties (TableInfo).
  public async listTables(
    schema: string,
    maxItems: number,
  ): Promise<Array<JSONObject>> {
    return await this.listPages(
      "/api/2.1/unity-catalog/tables",
      {
        catalog_name: this.connection.catalog,
        schema_name: schema,
        max_results: "0",
        include_delta_metadata: "true",
      },
      "tables",
      maxItems,
      `listing the tables of ${schema.slice(0, 60)}`,
    );
  }

  /*
   * One statement's rows, on the connection's warehouse, in the catalog.
   * A statement still running when the first request has waited is
   * followed until it ends, and cancelled past the deadline; a large
   * result comes in chunks after the first.
   */
  public async query(data: {
    statement: string;
    params?: Array<string> | undefined;
    namedParams?: Record<string, string> | undefined;
    // What the statement reads, as a failure says it: "running a check".
    operation?: string | undefined;
  }): Promise<Array<Record<string, unknown>>> {
    const operation: string = data.operation || "running a query";

    if (!this.connection.warehouseId) {
      throw new Error(
        "Name a SQL warehouse in the Databricks connection to run checks and read lineage: a query on a table's rows needs one.",
      );
    }

    const parameters: Array<JSONObject> = [
      ...(data.params || []).map((value: string, index: number): JSONObject => {
        return { name: `p${index + 1}`, value, type: "STRING" };
      }),
      ...Object.entries(data.namedParams || {}).map(
        ([name, value]: [string, string]): JSONObject => {
          return { name, value, type: "STRING" };
        },
      ),
    ];
    const startedAt: number = this.now();
    let answer: JSONObject = await this.send({
      method: "POST",
      path: "/api/2.0/sql/statements/",
      body: {
        statement: data.statement,
        warehouse_id: this.connection.warehouseId,
        catalog: this.connection.catalog,
        ...(parameters.length > 0 ? { parameters } : {}),
        wait_timeout: `${FIRST_WAIT_IN_SECONDS}s`,
        on_wait_timeout: "CONTINUE",
        disposition: "INLINE",
        format: "JSON_ARRAY",
        row_limit: MAX_ROWS,
      },
      // No idempotency key: sent again only when Databricks did not take it.
      isSafeToRepeat: false,
      operation,
    });
    const statementId: string = readText(answer["statement_id"]);

    while (
      !FINISHED_STATES.includes(
        readText(readObject(answer["status"])["state"]).toUpperCase(),
      )
    ) {
      if (!statementId) {
        throw new Error("Databricks did not say which statement it started.");
      }

      if (this.now() - startedAt > DATABRICKS_STATEMENT_DEADLINE_IN_MS) {
        try {
          await this.send({
            method: "POST",
            path: `/api/2.0/sql/statements/${encodeURIComponent(statementId)}/cancel`,
            // Cancelling twice cancels once.
            isSafeToRepeat: true,
            operation: "cancelling a statement",
          });
        } catch {
          // The statement ends with the warehouse's own timeout either way.
        }

        throw new Error(
          "The Databricks statement did not finish in time: is the SQL warehouse running?",
        );
      }

      await this.wait(POLL_WAIT_IN_MS);
      answer = await this.send({
        method: "GET",
        path: `/api/2.0/sql/statements/${encodeURIComponent(statementId)}`,
        operation,
      });
    }

    const state: string = readText(
      readObject(answer["status"])["state"],
    ).toUpperCase();

    if (state !== "SUCCEEDED") {
      const message: string = `The Databricks statement ${state.toLowerCase()}: ${errorOf(answer, "no reason given")}`;
      const errorCode: string = readText(
        readObject(readObject(answer["status"])["error"])["error_code"],
      ).toUpperCase();

      // The warehouse took it and failed it for a moment: a check starts it again (#9679).
      if (
        state === "FAILED" &&
        DATABRICKS_BUSY_STATEMENT_CODES.includes(errorCode)
      ) {
        throw new DataSourceBusyError(message, { code: errorCode });
      }

      throw new Error(message);
    }

    const manifest: JSONObject = readObject(answer["manifest"]);
    let result: JSONObject = readObject(answer["result"]);
    const rows: Array<Record<string, unknown>> = readDatabricksRows(
      manifest,
      result["data_array"],
    );

    for (
      let chunk: number = 1;
      chunk < MAX_CHUNKS &&
      result["next_chunk_index"] !== undefined &&
      result["next_chunk_index"] !== null;
      chunk++
    ) {
      result = await this.send({
        method: "GET",
        path: `/api/2.0/sql/statements/${encodeURIComponent(statementId)}/result/chunks/${encodeURIComponent(String(result["next_chunk_index"]))}`,
        operation,
      });
      rows.push(...readDatabricksRows(manifest, result["data_array"]));
    }

    return rows;
  }
}
