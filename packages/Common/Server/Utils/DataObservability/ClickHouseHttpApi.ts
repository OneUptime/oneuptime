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
  readRequestIdHeader,
  unreachedError,
} from "../DataSource/HttpFailure";
import DataSourceHttpRetry, {
  HttpRetryExchange,
  HttpRetryReason,
  HttpRetryVerdict,
} from "../DataSource/HttpRetry";

/*
 * CLICKHOUSE, OVER ITS HTTP INTERFACE.
 *
 * No driver: each statement is one POST to the server's HTTP interface
 * (8443 with TLS, 8123 without), the login in a Basic header, the answer
 * as JSON. A statement is read-only twice over: the login should be one
 * that may only read, and each statement asks for readonly=2 - reads, and
 * a session's own limits, but no change - with max_execution_time as its
 * timeout. A login whose profile is readonly=1 already may change no
 * setting at all, so for it statements go without (they are read-only
 * anyway). A value is bound as a query parameter ({p1:String}), never
 * written into the SQL.
 *
 * The connection is a URL - clickhouse://user:password@host:8443/database
 * (?secure=true|false), https://user:password@host:8443/database - or
 * JSON: { host, port, user, password, database, secure }. A database in it
 * limits the collection to that database; without one, every database
 * but the server's own (system, INFORMATION_SCHEMA) is read.
 *
 * An answer that may pass is asked again (DataSourceHttpRetry): a 503, the
 * status the server gives a socket timeout or a task it could not schedule
 * (exceptionCodeToHTTPStatus), and that ClickHouse's own clients retry;
 * TOO_MANY_SIMULTANEOUS_QUERIES (202), which the server raises when the
 * query is admitted, before it runs; NETWORK_ERROR (210); and a 429, 502
 * or 504 of a proxy in front of the server, which carries no exception. A
 * query past max_execution_time (TIMEOUT_EXCEEDED, a 408) is not: it would
 * time out again. Every statement reads, so each is safe to send again.
 */

export interface ClickHouseConnection {
  secure: boolean;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string | null;
}

export type ClickHouseTransport = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;

// How long one statement may run on the server, in seconds.
export const CLICKHOUSE_STATEMENT_TIMEOUT_IN_SECONDS: number = 30;

const SECURE_PORT: number = 8443;
const PLAIN_PORT: number = 8123;
// The native protocol's ports: a client of the HTTP interface cannot speak it.
const NATIVE_PORTS: ReadonlyArray<number> = [9000, 9440];

const URL_SCHEME: RegExp = /^[a-z][a-z0-9+.-]*:\/\//i;
const CLICKHOUSE_URL: RegExp = /^(clickhouses?|https?):\/\//i;
const HOST_PATTERN: RegExp = /^(\[[0-9a-f:.]+\]|[a-z0-9_.-]{1,253})$/i;
const DATABASE_PATTERN: RegExp = /^[^\s/?#`"\\]{1,240}$/;

// A login whose profile is readonly=1 may not set readonly=2, nor a timeout.
const READONLY_REFUSAL: RegExp = /\(READONLY\)|in readonly mode/i;

// ClickHouse's exception codes a collection asks again after.
const TOO_MANY_SIMULTANEOUS_QUERIES: number = 202;
const NETWORK_ERROR: number = 210;
// How ClickHouse writes an exception: "Code: 202. DB::Exception: <message> (NAME) (version 24.3.1)".
const EXCEPTION_HEAD: RegExp = /^Code:\s*(\d+)\.\s*(?:DB::Exception:\s*)?/;
const EXCEPTION_VERSION: RegExp =
  /\s*\(version [^()]*(?:\([^()]*\))?[^()]*\)\s*$/;
const EXCEPTION_NAME: RegExp = /\s*\(([A-Z][A-Z0-9_]{2,80})\)\s*$/;

export interface ClickHouseException {
  // Its code (202); null when the answer is no ClickHouse exception.
  code: number | null;
  // Its name (TOO_MANY_SIMULTANEOUS_QUERIES); null when the answer gives none.
  name: string | null;
  // Its message's first line, without its code, name and the server's version.
  message: string;
}

/*
 * A ClickHouse exception, from the X-ClickHouse-Exception-Code header the
 * server sends with it and its body's "Code: N. DB::Exception: ..." line.
 */
export function readClickHouseException(
  response: DataSourceHttpResponse,
): ClickHouseException {
  const line: string = readBodyText(response.bodyText || "");
  const head: RegExpMatchArray | null = line.match(EXCEPTION_HEAD);
  const headerCode: number = Number(
    response.headers?.["x-clickhouse-exception-code"],
  );
  const code: number | null =
    Number.isInteger(headerCode) && headerCode > 0
      ? headerCode
      : head
        ? Number(head[1])
        : null;
  let message: string = head ? line.slice(head[0].length) : line;

  message = message.replace(EXCEPTION_VERSION, "");

  const name: RegExpMatchArray | null = message.match(EXCEPTION_NAME);

  if (name) {
    message = message.slice(0, message.length - name[0].length);
  }

  return { code, name: name ? name[1]! : null, message: message.trim() };
}

/*
 * The answers of ClickHouse's HTTP interface worth asking again: too many
 * queries at once (202), turned away before the query ran; a network error
 * (210) and any 503, both of which ClickHouse's own clients retry; and a
 * 429, 502 or 504 that carries no exception, from a proxy in front of the
 * server, such as ClickHouse Cloud's while a service wakes.
 */
export function classifyClickHouseAnswer(
  response: DataSourceHttpResponse,
): HttpRetryVerdict | null {
  if (response.statusCode < 400) {
    return null;
  }

  const exception: ClickHouseException = readClickHouseException(response);

  if (exception.code === TOO_MANY_SIMULTANEOUS_QUERIES) {
    return { reason: HttpRetryReason.Throttled };
  }

  if (exception.code === NETWORK_ERROR || response.statusCode === 503) {
    return { reason: HttpRetryReason.Unavailable };
  }

  if (exception.code === null) {
    if (response.statusCode === 429) {
      return { reason: HttpRetryReason.Throttled };
    }

    if (response.statusCode === 502 || response.statusCode === 504) {
      return { reason: HttpRetryReason.Unavailable };
    }
  }

  return null;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readSecure(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  const text: string = String(value ?? "")
    .trim()
    .toLowerCase();

  if (["true", "1", "yes", "on"].includes(text)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(text)) {
    return false;
  }

  return null;
}

function fromUrl(value: string): JSONObject {
  const url: URL = new URL(value);
  const scheme: string = url.protocol.replace(/:$/, "").toLowerCase();
  const database: string = decodeURIComponent(
    url.pathname.replace(/^\/+/, "").split("/")[0] || "",
  );

  return {
    host: url.hostname,
    port: url.port,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: database || url.searchParams.get("database") || "",
    secure:
      scheme === "https" || scheme === "clickhouses"
        ? true
        : scheme === "http"
          ? false
          : url.searchParams.get("secure") || "",
  };
}

// The connection a store's string describes; why not, when it describes none.
export function readClickHouseConnection(value: string): ClickHouseConnection {
  const text: string = (value || "").trim();
  let raw: JSONObject = {};

  try {
    if (text.startsWith("{")) {
      const json: JSONObject = JSON.parse(text) as JSONObject;
      const host: string = readText(json["host"]);

      // A host written as a URL brings its scheme and port; the rest of the JSON wins.
      raw = URL_SCHEME.test(host) ? fromUrl(host) : { host };

      for (const key of [
        "port",
        "user",
        "username",
        "password",
        "database",
        "secure",
      ]) {
        if (json[key] !== undefined && json[key] !== null && json[key] !== "") {
          raw[key] = json[key];
        }
      }
    } else if (CLICKHOUSE_URL.test(text)) {
      raw = fromUrl(text);
    }
  } catch {
    raw = {};
  }

  const host: string = readText(raw["host"]);
  const explicitPort: number = Number(raw["port"] || 0);
  const secureFlag: boolean | null = readSecure(raw["secure"]);
  const secure: boolean =
    secureFlag !== null
      ? secureFlag
      : explicitPort === SECURE_PORT || explicitPort === 443;
  const port: number =
    Number.isInteger(explicitPort) && explicitPort > 0 && explicitPort < 65536
      ? explicitPort
      : secure
        ? SECURE_PORT
        : PLAIN_PORT;
  const database: string = readText(raw["database"]);

  if (!host || !HOST_PATTERN.test(host)) {
    throw new Error(
      "The ClickHouse connection needs the server's host, such as clickhouse://reader:password@abc123.us-east-1.aws.clickhouse.cloud:8443/default.",
    );
  }

  if (NATIVE_PORTS.includes(port)) {
    throw new Error(
      `Port ${port} is ClickHouse's native protocol; OneUptime reads over HTTP: use port 8443 with TLS, or 8123 without.`,
    );
  }

  if (database && !DATABASE_PATTERN.test(database)) {
    throw new Error(
      "The ClickHouse connection names a database that is not one.",
    );
  }

  return {
    secure,
    host,
    port,
    user: readText(raw["user"] ?? raw["username"]) || "default",
    password:
      typeof raw["password"] === "string" ? (raw["password"] as string) : "",
    database: database || null,
  };
}

// A JSON answer's rows: { meta, data: [{ column: value }], rows }.
export function readClickHouseRows(
  body: unknown,
): Array<Record<string, unknown>> {
  const data: unknown =
    body && typeof body === "object" ? (body as JSONObject)["data"] : null;

  if (!Array.isArray(data)) {
    throw new Error("ClickHouse did not answer with rows.");
  }

  return data.filter((row: unknown): boolean => {
    return Boolean(row) && typeof row === "object" && !Array.isArray(row);
  }) as Array<Record<string, unknown>>;
}

// A statement as it is sent: its rows as JSON, unless it says otherwise.
export function withJsonFormat(statement: string): string {
  return `${statement.trim().replace(/;\s*$/, "").trim()}\nFORMAT JSON`;
}

export default class ClickHouseHttpApi {
  private readonly connection: ClickHouseConnection;
  // Every request of the collection, asked again within one budget (DataSourceHttpRetry).
  private readonly retry: DataSourceHttpRetry;
  // Whether statements may set readonly and a timeout: not for a readonly=1 login.
  private sendsSettings: boolean = true;

  public constructor(data: {
    connection: ClickHouseConnection;
    transport?: ClickHouseTransport | undefined;
    sleep?: ((ms: number) => Promise<void>) | undefined;
  }) {
    this.connection = data.connection;
    this.retry = new DataSourceHttpRetry({
      transport:
        data.transport || DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
      classify: classifyClickHouseAnswer,
      provider: "ClickHouse",
      ...(data.sleep ? { sleep: data.sleep } : {}),
    });
  }

  // What an error may never repeat: the login with its password, as a URL writes them, then the password alone.
  private secrets(): Array<string> {
    return [
      `${this.connection.user}:${this.connection.password}`,
      this.connection.password,
    ];
  }

  private origin(): string {
    const host: string = this.connection.host;

    return `${this.connection.secure ? "https" : "http"}://${host}:${this.connection.port}`;
  }

  private url(params: Array<string>): string {
    const search: URLSearchParams = new URLSearchParams();

    if (this.connection.database) {
      search.set("database", this.connection.database);
    }

    params.forEach((value: string, index: number) => {
      search.set(`param_p${index + 1}`, value);
    });

    if (this.sendsSettings) {
      search.set("readonly", "2");
      search.set(
        "max_execution_time",
        String(CLICKHOUSE_STATEMENT_TIMEOUT_IN_SECONDS),
      );
      // The whole answer is made before it is sent, so an error is a status, not a cut-off body.
      search.set("wait_end_of_query", "1");
    }

    return `${this.origin()}/?${search.toString()}`;
  }

  /*
   * One statement's rows, its values bound in order to {p1:String},
   * {p2:String}, ...
   */
  public async query(data: {
    statement: string;
    params?: Array<string> | undefined;
    // What the statement reads, as a failure says it: "listing the tables (system.tables)".
    operation?: string | undefined;
  }): Promise<Array<Record<string, unknown>>> {
    const params: Array<string> = data.params || [];
    const operation: string = data.operation || "running a query";
    let exchange: HttpRetryExchange;

    try {
      exchange = await this.retry.exchange({
        build: (): DataSourceHttpRequest => {
          return {
            method: "POST",
            url: this.url(params),
            headers: {
              Authorization: `Basic ${Buffer.from(
                `${this.connection.user}:${this.connection.password}`,
              ).toString("base64")}`,
              "Content-Type": "text/plain; charset=utf-8",
            },
            body: withJsonFormat(data.statement),
            timeoutInMs: (CLICKHOUSE_STATEMENT_TIMEOUT_IN_SECONDS + 15) * 1000,
            acceptAnyStatus: true,
          };
        },
        // Every statement reads: readonly=2, or a login that may only read.
        isSafeToRepeat: true,
      });
    } catch (error) {
      // A failure of the request's own making (a sign-in refused) says itself.
      if (!(error instanceof DataSourceUnreachedError)) {
        throw error;
      }

      throw unreachedError({
        provider: "ClickHouse",
        operation,
        error,
        secrets: this.secrets(),
      });
    }

    const response: DataSourceHttpResponse = exchange.response;

    if (response.statusCode >= 400) {
      const message: string = (response.bodyText || "").trim();

      if (this.sendsSettings && READONLY_REFUSAL.test(message)) {
        this.sendsSettings = false;

        return await this.query(data);
      }

      const exception: ClickHouseException = readClickHouseException(response);

      throw failedAnswerError({
        provider: "ClickHouse",
        statusCode: response.statusCode,
        errorCode: readErrorCode(
          exception.name ||
            (exception.code !== null ? String(exception.code) : ""),
        ),
        operation,
        message: exception.message,
        attempts: exchange.attempts,
        requestId: readRequestIdHeader(response.headers, [
          "x-clickhouse-query-id",
        ]),
        requestIdLabel: "Query ID",
        refused: { who: "the login" },
        secrets: this.secrets(),
      });
    }

    return readClickHouseRows(response.bodyJson);
  }
}
