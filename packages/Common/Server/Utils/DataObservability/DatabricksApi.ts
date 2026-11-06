import { JSONObject } from "../../../Types/JSON";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../DataSource/HttpFetch";

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
  private readonly transport: DatabricksTransport;
  private readonly now: () => number;
  private readonly wait: (ms: number) => Promise<void>;
  private accessToken: { value: string; expiresAt: number } | null = null;

  public constructor(data: {
    connection: DatabricksConnection;
    transport?: DatabricksTransport | undefined;
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

  public get warehouseId(): string | null {
    return this.connection.warehouseId;
  }

  public get catalog(): string {
    return this.connection.catalog;
  }

  // A service principal's token, bought with its client ID and secret, kept until a minute before it ends.
  private async bearer(): Promise<string> {
    if (this.connection.token) {
      return this.connection.token;
    }

    if (this.accessToken && this.accessToken.expiresAt - 60_000 > this.now()) {
      return this.accessToken.value;
    }

    const response: DataSourceHttpResponse = await this.transport({
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
    } as DataSourceHttpRequest);
    const body: JSONObject = readObject(response.bodyJson);
    const token: string = readText(body["access_token"]);

    if (response.statusCode >= 400 || !token) {
      throw new Error(
        `Databricks refused the service principal (${response.statusCode}): ${errorOf(body, "no token")}`,
      );
    }

    const lifetime: number = Number(body["expires_in"]) || 3600;

    this.accessToken = {
      value: token,
      expiresAt: this.now() + lifetime * 1000,
    };

    return token;
  }

  private async send(
    method: "GET" | "POST",
    path: string,
    body?: JSONObject,
  ): Promise<JSONObject> {
    const response: DataSourceHttpResponse = await this.transport({
      method,
      url: `https://${this.connection.host}${path}`,
      headers: {
        Authorization: `Bearer ${await this.bearer()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      timeoutInMs: REQUEST_TIMEOUT_IN_MS,
      acceptAnyStatus: true,
    } as DataSourceHttpRequest);
    const json: JSONObject = readObject(response.bodyJson);

    if (response.statusCode >= 400) {
      throw new Error(
        `Databricks answered ${response.statusCode}: ${errorOf(json, response.bodyText.slice(0, 300))}`,
      );
    }

    return json;
  }

  // Every page of a Unity Catalog listing, to its last page or the most pages read.
  private async listPages(
    path: string,
    params: Record<string, string>,
    key: string,
    maxItems: number,
  ): Promise<Array<JSONObject>> {
    const items: Array<JSONObject> = [];
    let pageToken: string = "";

    for (let page: number = 0; page < MAX_PAGES; page++) {
      const search: URLSearchParams = new URLSearchParams(params);

      if (pageToken) {
        search.set("page_token", pageToken);
      }

      const body: JSONObject = await this.send(
        "GET",
        `${path}?${search.toString()}`,
      );

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
    return await this.send(
      "GET",
      `/api/2.1/unity-catalog/catalogs/${encodeURIComponent(this.connection.catalog)}`,
    );
  }

  public async listSchemas(): Promise<Array<string>> {
    return (
      await this.listPages(
        "/api/2.1/unity-catalog/schemas",
        { catalog_name: this.connection.catalog, max_results: "0" },
        "schemas",
        10_000,
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
  }): Promise<Array<Record<string, unknown>>> {
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
    let answer: JSONObject = await this.send(
      "POST",
      "/api/2.0/sql/statements/",
      {
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
    );
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
          await this.send(
            "POST",
            `/api/2.0/sql/statements/${encodeURIComponent(statementId)}/cancel`,
          );
        } catch {
          // The statement ends with the warehouse's own timeout either way.
        }

        throw new Error(
          "The Databricks statement did not finish in time: is the SQL warehouse running?",
        );
      }

      await this.wait(POLL_WAIT_IN_MS);
      answer = await this.send(
        "GET",
        `/api/2.0/sql/statements/${encodeURIComponent(statementId)}`,
      );
    }

    const state: string = readText(
      readObject(answer["status"])["state"],
    ).toUpperCase();

    if (state !== "SUCCEEDED") {
      throw new Error(
        `The Databricks statement ${state.toLowerCase()}: ${errorOf(answer, "no reason given")}`,
      );
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
      result = await this.send(
        "GET",
        `/api/2.0/sql/statements/${encodeURIComponent(statementId)}/result/chunks/${encodeURIComponent(String(result["next_chunk_index"]))}`,
      );
      rows.push(...readDatabricksRows(manifest, result["data_array"]));
    }

    return rows;
  }
}
