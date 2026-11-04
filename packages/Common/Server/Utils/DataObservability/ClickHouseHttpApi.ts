import { JSONObject } from "../../../Types/JSON";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../DataSource/HttpFetch";

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
  private readonly transport: ClickHouseTransport;
  // Whether statements may set readonly and a timeout: not for a readonly=1 login.
  private sendsSettings: boolean = true;

  public constructor(data: {
    connection: ClickHouseConnection;
    transport?: ClickHouseTransport | undefined;
  }) {
    this.connection = data.connection;
    this.transport =
      data.transport || DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch);
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
  }): Promise<Array<Record<string, unknown>>> {
    const params: Array<string> = data.params || [];
    const response: DataSourceHttpResponse = await this.transport({
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
    } as DataSourceHttpRequest);

    if (response.statusCode >= 400) {
      const message: string = (response.bodyText || "").trim();

      if (this.sendsSettings && READONLY_REFUSAL.test(message)) {
        this.sendsSettings = false;

        return await this.query(data);
      }

      throw new Error(
        `ClickHouse answered ${response.statusCode}: ${message.split("\n")[0]!.slice(0, 300)}`,
      );
    }

    return readClickHouseRows(response.bodyJson);
  }
}
