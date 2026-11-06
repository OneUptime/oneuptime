import DataBiTool from "../../../../Types/DataObservability/DataBiTool";
import { JSONObject } from "../../../../Types/JSON";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../DataSource/HttpFetch";

/*
 * EACH BI TOOL'S DASHBOARDS, AND THE TABLES BEHIND THEM.
 *
 * One reader per tool, over its own API, with credentials that may read
 * its dashboards and what they query:
 *
 *   - Metabase: an API key (or a user and password). Every table it knows
 *     (/api/table), every dashboard, and each card's table, or the tables
 *     its native SQL names.
 *   - Superset: a user and password. Every dashboard, and the datasets each
 *     one charts: a table, or a virtual dataset's SQL.
 *   - Tableau: a personal access token. The Metadata API names each
 *     dashboard's upstream tables itself.
 *   - Looker: an API client ID and secret. Each dashboard's tiles query an
 *     explore, whose base view's sql_table_name is the table.
 *   - Power BI: a service principal allowed to use the admin APIs. A scan
 *     of the workspaces says each dataset's tables, from their Power Query
 *     sources; a report charts its dataset.
 *   - Hightouch: an API key. Each sync's model is a table, or SQL naming them.
 *   - Census: a workspace API key. Each sync's source is a table.
 *
 * A reverse ETL tool's sync is read as one more thing that depends on a table:
 * its name says where the rows go.
 *
 * A table is named as the tool names it - its database, schema and name,
 * and the engine when the tool says - and matched to a watched table
 * afterwards (BiMatching). Only names and links are read, never a row.
 */

export interface BiTableRef {
  database: string | null;
  schema: string | null;
  table: string;
  // The engine as the tool names it: postgres, snowflake, bigquery...
  engine: string | null;
  host: string | null;
}

export interface BiDashboardRead {
  externalId: string;
  name: string;
  url: string | null;
  folder: string | null;
  owner: string | null;
  changedAt: Date | null;
  tables: Array<BiTableRef>;
}

export type BiTransport = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;

export interface BiReadInput {
  baseUrl: string;
  credentials: JSONObject;
  transport?: BiTransport | undefined;
}

// The most dashboards read from one tool, and tables kept of one.
export const MAX_BI_DASHBOARDS: number = 2_000;
const MAX_TABLES_PER_DASHBOARD: number = 200;
const REQUEST_TIMEOUT_IN_MS: number = 30_000;
const MAX_NAME_LENGTH: number = 240;
const POWER_BI_API: string = "https://api.powerbi.com/v1.0/myorg";
const HIGHTOUCH_API: string = "https://api.hightouch.com/api/v1";
const HIGHTOUCH_PAGE_SIZE: number = 100;
const CENSUS_API: string = "https://app.getcensus.com/api/v1";
const CENSUS_EU_API: string = "https://app-eu.getcensus.com/api/v1";
const CENSUS_PAGE_SIZE: number = 100;
const REVERSE_ETL_FOLDER: string = "Reverse ETL";
const POWER_BI_SCAN_POLLS: number = 30;
const POWER_BI_SCAN_WAIT_IN_MS: number = 2_000;

function readText(value: unknown, maxLength: number = MAX_NAME_LENGTH): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim().slice(0, maxLength)
    : "";
}

function readObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function readArray(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : [];
}

function readDate(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function requireText(
  credentials: JSONObject,
  key: string,
  tool: string,
): string {
  const value: string = readText(credentials[key], 4_096);

  if (!value) {
    throw new Error(`The ${tool} credentials need "${key}".`);
  }

  return value;
}

// A name as SQL writes it: bare, or quoted with "", `` or [].
const IDENT: string =
  '(?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[A-Za-z_][A-Za-z0-9_$]*)';
const QUALIFIED: string = `${IDENT}(?:\\s*\\.\\s*${IDENT}){0,2}`;
const FROM_OR_JOIN: RegExp = new RegExp(
  `\\b(?:FROM|JOIN)\\s+(${QUALIFIED})`,
  "gi",
);
const CTE_NAME: RegExp =
  /(?:\bWITH\s+(?:RECURSIVE\s+)?|,\s*)([A-Za-z_][A-Za-z0-9_]*)\s+AS\s*\(/gi;

// A name in quotes, backticks or brackets.
const QUOTED_START: RegExp = /^["`[]/;

function unquote(part: string): string {
  const trimmed: string = part.trim();

  return trimmed.length >= 2 && QUOTED_START.test(trimmed)
    ? trimmed.slice(1, -1)
    : trimmed;
}

/*
 * A qualified name as its parts, the last the table: db.schema.table,
 * schema.table or table. A BigQuery name in one pair of backticks
 * (`project.dataset.table`) is split on its dots.
 */
export function readQualifiedName(
  value: string,
  defaults: {
    database?: string | null;
    engine?: string | null;
    host?: string | null;
  } = {},
): BiTableRef | null {
  const parts: Array<string> = (value.match(new RegExp(IDENT, "g")) || [])
    .map(unquote)
    .flatMap((part: string): Array<string> => {
      return part.includes(".") ? part.split(".") : [part];
    })
    .filter(Boolean);

  if (parts.length === 0 || parts.length > 3) {
    return null;
  }

  const table: string = parts[parts.length - 1]!.slice(0, MAX_NAME_LENGTH);

  return {
    database:
      parts.length === 3
        ? parts[0]!.slice(0, MAX_NAME_LENGTH)
        : defaults.database || null,
    schema:
      parts.length >= 2
        ? parts[parts.length - 2]!.slice(0, MAX_NAME_LENGTH)
        : null,
    table,
    engine: defaults.engine || null,
    host: defaults.host || null,
  };
}

/*
 * The tables a query reads: every name after FROM or JOIN, but a common
 * table expression's own name. Template tags ({{...}}) and subqueries are
 * not names.
 */
export function readSqlTables(
  sql: string,
  defaults: {
    database?: string | null;
    engine?: string | null;
    host?: string | null;
  } = {},
): Array<BiTableRef> {
  const text: string = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\{[^}]*\}\}/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
  const ctes: Set<string> = new Set(
    Array.from(text.matchAll(CTE_NAME)).map(
      (match: RegExpMatchArray): string => {
        return match[1]!.toLowerCase();
      },
    ),
  );
  const tables: Array<BiTableRef> = [];

  for (const match of text.matchAll(FROM_OR_JOIN)) {
    const ref: BiTableRef | null = readQualifiedName(match[1]!, defaults);

    if (ref && !(ref.schema === null && ctes.has(ref.table.toLowerCase()))) {
      tables.push(ref);
    }
  }

  return tables;
}

// Each table once, by its parts in lower case.
export function uniqueTables(tables: Array<BiTableRef>): Array<BiTableRef> {
  const seen: Set<string> = new Set();

  return tables
    .filter((ref: BiTableRef): boolean => {
      const key: string = [ref.database, ref.schema, ref.table]
        .map((part: string | null): string => {
          return (part || "").toLowerCase();
        })
        .join("\u0000");

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .slice(0, MAX_TABLES_PER_DASHBOARD);
}

// One JSON request to a tool: its body, or an error naming the tool and status.
async function requestJson(data: {
  transport: BiTransport;
  tool: string;
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string> | undefined;
  body?: string | Record<string, string> | undefined;
  formUrlEncoded?: boolean | undefined;
}): Promise<unknown> {
  const response: DataSourceHttpResponse = await data.transport({
    method: data.method,
    url: data.url,
    headers: { Accept: "application/json", ...(data.headers || {}) },
    ...(data.body !== undefined ? { body: data.body } : {}),
    ...(data.formUrlEncoded ? { formUrlEncoded: true } : {}),
    timeoutInMs: REQUEST_TIMEOUT_IN_MS,
    acceptAnyStatus: true,
  } as DataSourceHttpRequest);

  if (response.statusCode >= 400) {
    const body: JSONObject = readObject(response.bodyJson);
    const message: string =
      readText(body["message"], 300) ||
      readText(body["error_description"], 300) ||
      readText(readObject(body["error"])["message"], 300) ||
      readText(body["error"], 300) ||
      (response.bodyText || "").slice(0, 200);

    throw new Error(`${data.tool} answered ${response.statusCode}: ${message}`);
  }

  return response.bodyJson;
}

function transportOf(input: BiReadInput): BiTransport {
  return input.transport || DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch);
}

// The database a Metabase database's details name: its dbname, db, catalog or project.
function readMetabaseDatabase(database: JSONObject): string | null {
  const details: JSONObject = readObject(database["details"]);

  return (
    readText(details["dbname"]) ||
    readText(details["db"]) ||
    readText(details["catalog"]) ||
    readText(details["project-id"]) ||
    readText(database["name"]) ||
    null
  );
}

export class MetabaseConnector {
  public static async read(
    input: BiReadInput,
  ): Promise<Array<BiDashboardRead>> {
    const transport: BiTransport = transportOf(input);
    const base: string = input.baseUrl;
    const tool: string = DataBiTool.Metabase;
    let headers: Record<string, string>;

    if (readText(input.credentials["apiKey"], 4_096)) {
      headers = { "x-api-key": readText(input.credentials["apiKey"], 4_096) };
    } else {
      const session: JSONObject = readObject(
        await requestJson({
          transport,
          tool,
          method: "POST",
          url: `${base}/api/session`,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: requireText(input.credentials, "username", tool),
            password: requireText(input.credentials, "password", tool),
          }),
        }),
      );

      headers = { "X-Metabase-Session": readText(session["id"], 200) };
    }

    const get: (path: string) => Promise<unknown> = (
      path: string,
    ): Promise<unknown> => {
      return requestJson({
        transport,
        tool,
        method: "GET",
        url: `${base}${path}`,
        headers,
      });
    };

    // Newer versions wrap lists in { data }.
    const listOf: (value: unknown) => Array<unknown> = (
      value: unknown,
    ): Array<unknown> => {
      return Array.isArray(value)
        ? value
        : readArray(readObject(value)["data"]);
    };

    const databases: Map<
      string,
      { database: string | null; engine: string | null; host: string | null }
    > = new Map();

    for (const value of listOf(await get("/api/database"))) {
      const database: JSONObject = readObject(value);

      databases.set(readText(database["id"]), {
        database: readMetabaseDatabase(database),
        engine: readText(database["engine"]) || null,
        host: readText(readObject(database["details"])["host"]) || null,
      });
    }

    const tables: Map<string, BiTableRef> = new Map();

    for (const value of listOf(await get("/api/table"))) {
      const table: JSONObject = readObject(value);
      const database:
        | {
            database: string | null;
            engine: string | null;
            host: string | null;
          }
        | undefined = databases.get(readText(table["db_id"]));
      const name: string = readText(table["name"]);

      if (name) {
        tables.set(readText(table["id"]), {
          database: database?.database || null,
          schema: readText(table["schema"]) || null,
          table: name,
          engine: database?.engine || null,
          host: database?.host || null,
        });
      }
    }

    const collections: Map<string, string> = new Map();

    try {
      for (const value of listOf(await get("/api/collection"))) {
        const collection: JSONObject = readObject(value);

        collections.set(
          readText(collection["id"]),
          readText(collection["name"]),
        );
      }
    } catch {
      // A key that may not list collections still reads dashboards.
    }

    const dashboards: Array<BiDashboardRead> = [];

    for (const value of listOf(await get("/api/dashboard/")).slice(
      0,
      MAX_BI_DASHBOARDS,
    )) {
      const summary: JSONObject = readObject(value);
      const id: string = readText(summary["id"]);

      if (!id || summary["archived"] === true) {
        continue;
      }

      const dashboard: JSONObject = readObject(
        await get(`/api/dashboard/${encodeURIComponent(id)}`),
      );
      const refs: Array<BiTableRef> = [];

      for (const dashcard of [
        ...readArray(dashboard["dashcards"]),
        ...readArray(dashboard["ordered_cards"]),
      ]) {
        const card: JSONObject = readObject(readObject(dashcard)["card"]);
        const query: JSONObject = readObject(card["dataset_query"]);
        const table: BiTableRef | undefined = tables.get(
          readText(card["table_id"]),
        );

        if (table) {
          refs.push(table);
        }

        const native: string = readText(
          readObject(query["native"])["query"],
          100_000,
        );

        if (native) {
          const database:
            | {
                database: string | null;
                engine: string | null;
                host: string | null;
              }
            | undefined = databases.get(readText(query["database"]));

          refs.push(...readSqlTables(native, database || {}));
        }
      }

      dashboards.push({
        externalId: id,
        name:
          readText(dashboard["name"] ?? summary["name"]) || `Dashboard ${id}`,
        url: `${base}/dashboard/${encodeURIComponent(id)}`,
        folder:
          collections.get(
            readText(dashboard["collection_id"] ?? summary["collection_id"]),
          ) || null,
        owner:
          readText(readObject(dashboard["creator"])["common_name"]) ||
          readText(readObject(summary["creator"])["common_name"]) ||
          null,
        changedAt: readDate(dashboard["updated_at"] ?? summary["updated_at"]),
        tables: uniqueTables(refs),
      });
    }

    return dashboards;
  }
}

export class SupersetConnector {
  public static async read(
    input: BiReadInput,
  ): Promise<Array<BiDashboardRead>> {
    const transport: BiTransport = transportOf(input);
    const base: string = input.baseUrl;
    const tool: string = DataBiTool.Superset;
    const login: JSONObject = readObject(
      await requestJson({
        transport,
        tool,
        method: "POST",
        url: `${base}/api/v1/security/login`,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: requireText(input.credentials, "username", tool),
          password: requireText(input.credentials, "password", tool),
          provider: readText(input.credentials["provider"]) || "db",
          refresh: false,
        }),
      }),
    );
    const headers: Record<string, string> = {
      Authorization: `Bearer ${readText(login["access_token"], 8_192)}`,
    };
    const dashboards: Array<BiDashboardRead> = [];

    for (let page: number = 0; dashboards.length < MAX_BI_DASHBOARDS; page++) {
      const list: JSONObject = readObject(
        await requestJson({
          transport,
          tool,
          method: "GET",
          url: `${base}/api/v1/dashboard/?q=${encodeURIComponent(`(page:${page},page_size:100)`)}`,
          headers,
        }),
      );
      const rows: Array<unknown> = readArray(list["result"]);

      for (const value of rows) {
        const dashboard: JSONObject = readObject(value);
        const id: string = readText(dashboard["id"]);

        if (!id) {
          continue;
        }

        const datasets: JSONObject = readObject(
          await requestJson({
            transport,
            tool,
            method: "GET",
            url: `${base}/api/v1/dashboard/${encodeURIComponent(id)}/datasets`,
            headers,
          }),
        );
        const refs: Array<BiTableRef> = [];

        for (const datasetValue of readArray(datasets["result"])) {
          const dataset: JSONObject = readObject(datasetValue);
          const database: JSONObject = readObject(dataset["database"]);
          const defaults: { database: string | null; engine: string | null } = {
            database: readText(database["database_name"]) || null,
            engine: readText(database["backend"]) || null,
          };
          const sql: string = readText(dataset["sql"], 100_000);

          if (sql) {
            refs.push(...readSqlTables(sql, defaults));
          } else if (readText(dataset["table_name"])) {
            refs.push({
              ...defaults,
              schema: readText(dataset["schema"]) || null,
              table: readText(dataset["table_name"]),
              host: null,
            });
          }
        }

        const owners: Array<string> = readArray(dashboard["owners"]).map(
          (owner: unknown): string => {
            const value: JSONObject = readObject(owner);

            return `${readText(value["first_name"])} ${readText(value["last_name"])}`.trim();
          },
        );
        const path: string = readText(dashboard["url"], 1_000);

        dashboards.push({
          externalId: id,
          name: readText(dashboard["dashboard_title"]) || `Dashboard ${id}`,
          url: path
            ? `${base}${path.startsWith("/") ? path : `/${path}`}`
            : `${base}/superset/dashboard/${encodeURIComponent(id)}/`,
          folder: null,
          owner: owners.filter(Boolean)[0] || null,
          changedAt: readDate(dashboard["changed_on_utc"]),
          tables: uniqueTables(refs),
        });
      }

      if (rows.length < 100) {
        break;
      }
    }

    return dashboards.slice(0, MAX_BI_DASHBOARDS);
  }
}

const TABLEAU_API_VERSION: string = "3.19";
const TABLEAU_DASHBOARDS_QUERY: string = `query OneUptimeDashboards($after: String) {
  dashboardsConnection(first: 100, after: $after) {
    nodes {
      luid
      name
      path
      updatedAt
      workbook { name projectName owner { name } }
      upstreamTables { name schema fullName database { name connectionType } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export class TableauConnector {
  public static async read(
    input: BiReadInput,
  ): Promise<Array<BiDashboardRead>> {
    const transport: BiTransport = transportOf(input);
    const base: string = input.baseUrl;
    const tool: string = DataBiTool.Tableau;
    const site: string = readText(input.credentials["site"]);
    const signIn: JSONObject = readObject(
      readObject(
        await requestJson({
          transport,
          tool,
          method: "POST",
          url: `${base}/api/${TABLEAU_API_VERSION}/auth/signin`,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            credentials: {
              personalAccessTokenName: requireText(
                input.credentials,
                "tokenName",
                tool,
              ),
              personalAccessTokenSecret: requireText(
                input.credentials,
                "tokenSecret",
                tool,
              ),
              site: { contentUrl: site },
            },
          }),
        }),
      )["credentials"],
    );
    const headers: Record<string, string> = {
      "X-Tableau-Auth": readText(signIn["token"], 8_192),
      "Content-Type": "application/json",
    };
    const dashboards: Array<BiDashboardRead> = [];
    let after: string | null = null;

    do {
      const body: JSONObject = readObject(
        await requestJson({
          transport,
          tool,
          method: "POST",
          url: `${base}/api/metadata/graphql`,
          headers,
          body: JSON.stringify({
            query: TABLEAU_DASHBOARDS_QUERY,
            variables: { after },
          }),
        }),
      );
      const errors: Array<unknown> = readArray(body["errors"]);

      if (errors.length > 0 && !body["data"]) {
        throw new Error(
          `Tableau's Metadata API answered: ${readText(readObject(errors[0])["message"], 300)}`,
        );
      }

      const connection: JSONObject = readObject(
        readObject(body["data"])["dashboardsConnection"],
      );

      for (const value of readArray(connection["nodes"])) {
        const dashboard: JSONObject = readObject(value);
        const workbook: JSONObject = readObject(dashboard["workbook"]);
        const path: string = readText(dashboard["path"], 2_000);
        const id: string = readText(dashboard["luid"]) || path;

        if (!id) {
          continue;
        }

        dashboards.push({
          externalId: id,
          name: readText(dashboard["name"]) || id,
          url: path
            ? `${base}/#/${site ? `site/${encodeURIComponent(site)}/` : ""}views/${path}`
            : null,
          folder: readText(workbook["projectName"]) || null,
          owner: readText(readObject(workbook["owner"])["name"]) || null,
          changedAt: readDate(dashboard["updatedAt"]),
          tables: uniqueTables(
            readArray(dashboard["upstreamTables"])
              .map((tableValue: unknown): BiTableRef | null => {
                const table: JSONObject = readObject(tableValue);
                const database: JSONObject = readObject(table["database"]);
                const name: string = readText(table["name"]);

                return name
                  ? {
                      database: readText(database["name"]) || null,
                      schema: readText(table["schema"]) || null,
                      table: name,
                      engine: readText(database["connectionType"]) || null,
                      host: null,
                    }
                  : null;
              })
              .filter((ref: BiTableRef | null): ref is BiTableRef => {
                return ref !== null;
              }),
          ),
        });
      }

      const pageInfo: JSONObject = readObject(connection["pageInfo"]);

      after =
        pageInfo["hasNextPage"] === true &&
        dashboards.length < MAX_BI_DASHBOARDS
          ? readText(pageInfo["endCursor"], 1_000) || null
          : null;
    } while (after);

    return dashboards.slice(0, MAX_BI_DASHBOARDS);
  }
}

export class LookerConnector {
  public static async read(
    input: BiReadInput,
  ): Promise<Array<BiDashboardRead>> {
    const transport: BiTransport = transportOf(input);
    const base: string = input.baseUrl;
    const tool: string = DataBiTool.Looker;
    const login: JSONObject = readObject(
      await requestJson({
        transport,
        tool,
        method: "POST",
        url: `${base}/api/4.0/login`,
        body: {
          client_id: requireText(input.credentials, "clientId", tool),
          client_secret: requireText(input.credentials, "clientSecret", tool),
        },
        formUrlEncoded: true,
      }),
    );
    const headers: Record<string, string> = {
      Authorization: `token ${readText(login["access_token"], 8_192)}`,
    };
    const get: (path: string) => Promise<unknown> = (
      path: string,
    ): Promise<unknown> => {
      return requestJson({
        transport,
        tool,
        method: "GET",
        url: `${base}${path}`,
        headers,
      });
    };
    const explores: Map<string, BiTableRef | null> = new Map();
    const exploreTable: (
      model: string,
      explore: string,
    ) => Promise<BiTableRef | null> = async (
      model: string,
      explore: string,
    ): Promise<BiTableRef | null> => {
      const key: string = `${model}\u0000${explore}`;

      if (!explores.has(key)) {
        try {
          const found: JSONObject = readObject(
            await get(
              `/api/4.0/lookml_models/${encodeURIComponent(model)}/explores/${encodeURIComponent(explore)}?fields=sql_table_name`,
            ),
          );
          const sqlTableName: string = readText(found["sql_table_name"], 1_000);

          explores.set(
            key,
            sqlTableName ? readQualifiedName(sqlTableName) : null,
          );
        } catch {
          explores.set(key, null);
        }
      }

      return explores.get(key) || null;
    };
    const dashboards: Array<BiDashboardRead> = [];

    for (const value of readArray(
      await get("/api/4.0/dashboards?fields=id,title"),
    ).slice(0, MAX_BI_DASHBOARDS)) {
      const id: string = readText(readObject(value)["id"]);

      if (!id) {
        continue;
      }

      const dashboard: JSONObject = readObject(
        await get(
          `/api/4.0/dashboards/${encodeURIComponent(id)}?fields=id,title,folder(name),user_name,updated_at,dashboard_elements(query(model,view),look(query(model,view)),result_maker(query(model,view)))`,
        ),
      );
      const refs: Array<BiTableRef> = [];

      for (const elementValue of readArray(dashboard["dashboard_elements"])) {
        const element: JSONObject = readObject(elementValue);

        for (const query of [
          readObject(element["query"]),
          readObject(readObject(element["look"])["query"]),
          readObject(readObject(element["result_maker"])["query"]),
        ]) {
          const model: string = readText(query["model"]);
          const explore: string = readText(query["view"]);

          if (model && explore) {
            const ref: BiTableRef | null = await exploreTable(model, explore);

            if (ref) {
              refs.push(ref);
            }
          }
        }
      }

      dashboards.push({
        externalId: id,
        name: readText(dashboard["title"]) || `Dashboard ${id}`,
        url: `${base}/dashboards/${encodeURIComponent(id)}`,
        folder: readText(readObject(dashboard["folder"])["name"]) || null,
        owner: readText(dashboard["user_name"]) || null,
        changedAt: readDate(dashboard["updated_at"]),
        tables: uniqueTables(refs),
      });
    }

    return dashboards;
  }
}

/*
 * The tables a Power Query expression reads: a database's navigation steps
 * ([Schema="dbo",Item="orders"], or [Name="ORDERS",Kind="Table"] with its
 * schema and database steps), and a native query's SQL.
 */
export function readPowerQueryTables(expression: string): Array<BiTableRef> {
  const refs: Array<BiTableRef> = [];
  const sqlDatabase: RegExpMatchArray | null = expression.match(
    /Sql\.Databases?\(\s*"([^"]+)"\s*(?:,\s*"([^"]+)")?/i,
  );
  const host: string | null = sqlDatabase ? sqlDatabase[1]! : null;
  let database: string | null = sqlDatabase?.[2] || null;
  let schema: string | null = null;

  for (const match of expression.matchAll(
    /\[Schema\s*=\s*"([^"]+)"\s*,\s*Item\s*=\s*"([^"]+)"\]/gi,
  )) {
    refs.push({
      database,
      schema: match[1]!,
      table: match[2]!,
      engine: sqlDatabase ? "sqlserver" : null,
      host,
    });
  }

  for (const match of expression.matchAll(
    /\[Name\s*=\s*"([^"]+)"\s*,\s*Kind\s*=\s*"(Database|Schema|Table|View)"\]/gi,
  )) {
    const kind: string = match[2]!.toLowerCase();

    if (kind === "database") {
      database = match[1]!;
    } else if (kind === "schema") {
      schema = match[1]!;
    } else {
      refs.push({ database, schema, table: match[1]!, engine: null, host });
    }
  }

  const native: RegExpMatchArray | null = expression.match(
    /Value\.NativeQuery\([^,]+,\s*"((?:[^"]|"")*)"/i,
  );

  if (native) {
    refs.push(
      ...readSqlTables(
        native[1]!.replace(/""/g, '"').replace(/#\(lf\)/g, "\n"),
        {
          database,
          host,
        },
      ),
    );
  }

  return refs;
}

export class PowerBiConnector {
  public static async read(
    input: BiReadInput & { wait?: ((ms: number) => Promise<void>) | undefined },
  ): Promise<Array<BiDashboardRead>> {
    const transport: BiTransport = transportOf(input);
    const tool: string = DataBiTool.PowerBI;
    const tenantId: string = requireText(input.credentials, "tenantId", tool);
    const token: JSONObject = readObject(
      await requestJson({
        transport,
        tool,
        method: "POST",
        url: `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
        body: {
          grant_type: "client_credentials",
          client_id: requireText(input.credentials, "clientId", tool),
          client_secret: requireText(input.credentials, "clientSecret", tool),
          scope: "https://analysis.windows.net/powerbi/api/.default",
        },
        formUrlEncoded: true,
      }),
    );
    const headers: Record<string, string> = {
      Authorization: `Bearer ${readText(token["access_token"], 8_192)}`,
      "Content-Type": "application/json",
    };
    const wait: (ms: number) => Promise<void> =
      input.wait ||
      ((ms: number): Promise<void> => {
        return new Promise((resolve: () => void) => {
          setTimeout(resolve, ms);
        });
      });
    const workspaceIds: Array<string> = readArray(
      await requestJson({
        transport,
        tool,
        method: "GET",
        url: `${POWER_BI_API}/admin/workspaces/modified?excludePersonalWorkspaces=true`,
        headers,
      }),
    )
      .map((value: unknown): string => {
        return readText(readObject(value)["id"], 100);
      })
      .filter(Boolean);
    const dashboards: Array<BiDashboardRead> = [];

    for (let start: number = 0; start < workspaceIds.length; start += 100) {
      const scan: JSONObject = readObject(
        await requestJson({
          transport,
          tool,
          method: "POST",
          url: `${POWER_BI_API}/admin/workspaces/getInfo?lineage=True&datasourceDetails=True&datasetSchema=True&datasetExpressions=True`,
          headers,
          body: JSON.stringify({
            workspaces: workspaceIds.slice(start, start + 100),
          }),
        }),
      );
      const scanId: string = readText(scan["id"], 100);

      for (let poll: number = 0; ; poll++) {
        const status: JSONObject = readObject(
          await requestJson({
            transport,
            tool,
            method: "GET",
            url: `${POWER_BI_API}/admin/workspaces/scanStatus/${encodeURIComponent(scanId)}`,
            headers,
          }),
        );

        if (readText(status["status"]) === "Succeeded") {
          break;
        }

        if (
          poll >= POWER_BI_SCAN_POLLS ||
          readText(status["status"]) === "Failed"
        ) {
          throw new Error("Power BI's workspace scan did not finish.");
        }

        await wait(POWER_BI_SCAN_WAIT_IN_MS);
      }

      const result: JSONObject = readObject(
        await requestJson({
          transport,
          tool,
          method: "GET",
          url: `${POWER_BI_API}/admin/workspaces/scanResult/${encodeURIComponent(scanId)}`,
          headers,
        }),
      );

      for (const workspaceValue of readArray(result["workspaces"])) {
        const workspace: JSONObject = readObject(workspaceValue);
        const workspaceId: string = readText(workspace["id"], 100);
        const datasetTables: Map<string, Array<BiTableRef>> = new Map();

        for (const datasetValue of readArray(workspace["datasets"])) {
          const dataset: JSONObject = readObject(datasetValue);
          const refs: Array<BiTableRef> = [];

          for (const tableValue of readArray(dataset["tables"])) {
            for (const source of readArray(readObject(tableValue)["source"])) {
              refs.push(
                ...readPowerQueryTables(
                  readText(readObject(source)["expression"], 100_000),
                ),
              );
            }
          }

          datasetTables.set(readText(dataset["id"], 100), refs);
        }

        for (const reportValue of readArray(workspace["reports"])) {
          const report: JSONObject = readObject(reportValue);
          const id: string = readText(report["id"], 100);

          if (!id || dashboards.length >= MAX_BI_DASHBOARDS) {
            continue;
          }

          dashboards.push({
            externalId: id,
            name: readText(report["name"]) || `Report ${id}`,
            url: `https://app.powerbi.com/groups/${encodeURIComponent(workspaceId)}/reports/${encodeURIComponent(id)}`,
            folder: readText(workspace["name"]) || null,
            owner:
              readText(report["modifiedBy"]) ||
              readText(report["createdBy"]) ||
              null,
            changedAt: readDate(report["modifiedDateTime"]),
            tables: uniqueTables(
              datasetTables.get(readText(report["datasetId"], 100)) || [],
            ),
          });
        }
      }
    }

    return dashboards;
  }
}

// A tool's dashboards, by the tool's own reader.
/*
 * Hightouch: a sync copies a model into a destination. A model is a table, or
 * SQL naming its tables; a dbt or visual model says neither, so it names none.
 */
export class HightouchConnector {
  public static async read(
    input: BiReadInput,
  ): Promise<Array<BiDashboardRead>> {
    const apiKey: string = requireText(
      input.credentials,
      "apiKey",
      "Hightouch",
    );
    const transport: BiTransport = transportOf(input);
    const list: (path: string) => Promise<Array<JSONObject>> = async (
      path: string,
    ): Promise<Array<JSONObject>> => {
      const items: Array<JSONObject> = [];

      for (let offset: number = 0; offset < MAX_BI_DASHBOARDS; ) {
        const page: JSONObject = readObject(
          await requestJson({
            transport,
            tool: "Hightouch",
            method: "GET",
            url: `${HIGHTOUCH_API}/${path}?limit=${HIGHTOUCH_PAGE_SIZE}&offset=${offset}`,
            headers: { Authorization: `Bearer ${apiKey}` },
          }),
        );
        const data: Array<unknown> = readArray(page["data"]);

        items.push(...data.map(readObject));
        offset += HIGHTOUCH_PAGE_SIZE;

        if (page["hasMore"] !== true || data.length === 0) {
          break;
        }
      }

      return items;
    };
    const byId: (items: Array<JSONObject>) => Map<string, JSONObject> = (
      items: Array<JSONObject>,
    ): Map<string, JSONObject> => {
      return new Map(
        items.map((item: JSONObject): [string, JSONObject] => {
          return [readText(item["id"]), item];
        }),
      );
    };
    const [syncs, models, destinations]: [
      Array<JSONObject>,
      Map<string, JSONObject>,
      Map<string, JSONObject>,
    ] = [
      await list("syncs"),
      byId(await list("models")),
      byId(await list("destinations")),
    ];

    return syncs.map((sync: JSONObject): BiDashboardRead => {
      const model: JSONObject =
        models.get(readText(sync["modelId"])) || ({} as JSONObject);
      const destination: JSONObject =
        destinations.get(readText(sync["destinationId"])) || ({} as JSONObject);
      const from: string = readText(model["name"]) || readText(sync["slug"]);
      const to: string = readText(destination["name"]);

      return {
        externalId: readText(sync["id"]),
        name: to ? `${from} to ${to}` : from,
        url: null,
        folder: REVERSE_ETL_FOLDER,
        owner: null,
        changedAt: readDate(sync["lastRunAt"]),
        tables: uniqueTables(readHightouchModelTables(model)),
      };
    });
  }
}

export function readHightouchModelTables(model: JSONObject): Array<BiTableRef> {
  const table: string = readText(readObject(model["table"])["name"]);

  if (table) {
    const ref: BiTableRef | null = readQualifiedName(table);

    return ref ? [ref] : [];
  }

  const sql: string = readText(readObject(model["raw"])["sql"], 100_000);

  return sql ? readSqlTables(sql) : [];
}

// Census: a sync's source is a table, its destination an object in another tool.
export class CensusConnector {
  public static async read(
    input: BiReadInput,
  ): Promise<Array<BiDashboardRead>> {
    const apiKey: string = requireText(input.credentials, "apiKey", "Census");
    const transport: BiTransport = transportOf(input);
    const api: string =
      readText(input.credentials["region"]).toLowerCase() === "eu"
        ? CENSUS_EU_API
        : CENSUS_API;
    const dashboards: Array<BiDashboardRead> = [];

    for (let page: number | null = 1; page; ) {
      const answer: JSONObject = readObject(
        await requestJson({
          transport,
          tool: "Census",
          method: "GET",
          url: `${api}/syncs?page=${page}&per_page=${CENSUS_PAGE_SIZE}`,
          headers: { Authorization: `Bearer ${apiKey}` },
        }),
      );

      for (const raw of readArray(answer["data"])) {
        dashboards.push(readCensusSync(readObject(raw)));
      }

      const next: unknown = readObject(answer["pagination"])["next_page"];

      page =
        typeof next === "number" && dashboards.length < MAX_BI_DASHBOARDS
          ? next
          : null;
    }

    return dashboards;
  }
}

export function readCensusSync(sync: JSONObject): BiDashboardRead {
  const source: JSONObject = readObject(
    readObject(sync["source_attributes"])["object"],
  );
  const table: string = readText(source["table_name"]);
  const to: string = readText(
    readObject(sync["destination_attributes"])["object"],
  );

  return {
    externalId: readText(sync["id"]),
    name: readText(sync["label"]) || (to ? `${table} to ${to}` : table),
    url: null,
    folder: REVERSE_ETL_FOLDER,
    owner: null,
    changedAt: readDate(sync["updated_at"]),
    tables: table
      ? [
          {
            database: readText(source["table_catalog"]) || null,
            schema: readText(source["table_schema"]) || null,
            table,
            engine: null,
            host: null,
          },
        ]
      : [],
  };
}

export async function readBiDashboards(
  tool: DataBiTool,
  input: BiReadInput,
): Promise<Array<BiDashboardRead>> {
  switch (tool) {
    case DataBiTool.Metabase:
      return await MetabaseConnector.read(input);
    case DataBiTool.Superset:
      return await SupersetConnector.read(input);
    case DataBiTool.Tableau:
      return await TableauConnector.read(input);
    case DataBiTool.Looker:
      return await LookerConnector.read(input);
    case DataBiTool.PowerBI:
      return await PowerBiConnector.read(input);
    case DataBiTool.Hightouch:
      return await HightouchConnector.read(input);
    case DataBiTool.Census:
      return await CensusConnector.read(input);
    default:
      throw new Error(`OneUptime cannot read ${String(tool)} yet.`);
  }
}
