import { JSONObject } from "../../../Types/JSON";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../DataSource/HttpFetch";

/*
 * MICROSOFT DATAVERSE, OVER ITS WEB API AND ITS READ-ONLY SQL ENDPOINT.
 *
 * A Dataverse environment is a store, its tables in the schema dbo, as its
 * SQL endpoint names them. OneUptime signs in as an application through
 * Microsoft Entra ID: the app's client ID and secret buy a token for the
 * environment, kept until a minute before it ends. The app is an
 * application user of the environment, with a security role that may read
 * the tables. The tenant may be left out: an environment says which tenant
 * it is in when it is asked without a token.
 *
 * Each collection asks the Web API for:
 *  - the table definitions (EntityDefinitions), which read no rows;
 *  - the rows of every watched table, in one call per fifty tables
 *    (RetrieveTotalRecordCount), from a snapshot Dataverse takes once a day,
 *    so a table's rows lag by up to a day;
 *  - each watched table's newest modifiedon: its one newest row, of which
 *    only that time is read;
 *  - once an hour, the watched tables' columns (their attribute
 *    definitions), twenty tables a call.
 * Every call counts against the app's service protection limits (6,000
 * requests in five minutes, per user): a 429 stops the reads of the
 * collection that met it, and the rest wait for the next.
 *
 * Not every table is watched. An environment holds hundreds of tables
 * before anyone adds one, most of them Dataverse's own, and every watched
 * table is billed. So the default is the core business tables
 * (DATAVERSE_CORE_TABLES) and the environment's own custom tables, leaving
 * out those of Microsoft's apps (msdyn_, adx_ and the other ms prefixes).
 * The connection names any other table to watch in "tables".
 *
 * A data check reads rows, so it runs on the environment's TDS endpoint:
 * read-only SQL in a subset of SQL Server's dialect, signed in with the
 * same token (TableHealthCollector's DataverseCatalog). Its values are
 * written in as N'...' strings (inlineDataverseSqlParameters).
 */

export interface DataverseConnection {
  // The environment's host: contoso.crm.dynamics.com.
  host: string;
  // The Entra ID tenant, a GUID or a domain; null to ask the environment.
  tenantId: string | null;
  clientId: string;
  clientSecret: string;
  // Tables named to watch besides the default ones: logical names, in lower case.
  tables: Array<string>;
  // The SQL endpoint's port when the connection names one; null tries 1433, then 5558.
  sqlPort: number | null;
}

export type DataverseTransport = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;

// A table a collection reads.
export interface DataverseTable {
  logicalName: string;
  // Its collection in the Web API's URLs: accounts for account.
  entitySetName: string;
  // Standard, Activity, Elastic or Virtual.
  tableType: string;
}

export interface DataverseTableSelection {
  tables: Array<DataverseTable>;
  // Tables the connection names that the environment has none of, or that cannot be watched.
  unknownNames: Array<string>;
}

// The Web API's version: every Dataverse environment online serves it.
const WEB_API_PATH: string = "/api/data/v9.2";

export const DATAVERSE_REQUEST_TIMEOUT_IN_MS: number = 60_000;

// The SQL endpoint's ports: 1433, and 5558 where 1433 is closed.
export const DATAVERSE_SQL_PORTS: ReadonlyArray<number> = [1433, 5558];

// How many tables one RetrieveTotalRecordCount call counts.
export const DATAVERSE_TABLES_PER_COUNT: number = 50;

// How many tables one EntityDefinitions call reads the columns of.
export const DATAVERSE_TABLES_PER_COLUMN_READ: number = 20;

// The most tables a connection may name.
export const MAX_NAMED_DATAVERSE_TABLES: number = 500;

/*
 * The business tables most environments hold, watched without being named:
 * those that come with Dataverse itself (accounts, contacts, activities and
 * notes) and with Dynamics 365's Sales and Customer Service apps. One the
 * environment does not have is left out.
 */
export const DATAVERSE_CORE_TABLES: ReadonlyArray<string> = [
  "account",
  "contact",
  "lead",
  "opportunity",
  "quote",
  "salesorder",
  "invoice",
  "product",
  "incident",
  "email",
  "phonecall",
  "appointment",
  "task",
  "annotation",
];

/*
 * A custom table of one of Microsoft's own apps: Dynamics 365's (msdyn_,
 * msdynmkt_, msdyncrm_), Power Pages' (mspp_, adx_) and the others, whose
 * publishers' prefixes start with ms. Hundreds of them come with the apps.
 */
const MICROSOFT_TABLE_PREFIX: RegExp = /^(?:ms[a-z0-9]*|adx)_/;

// An environment's host in each Microsoft cloud, and where its apps sign in.
const CLOUDS: ReadonlyArray<{ suffix: RegExp; authority: string }> = [
  // Commercial, every region (crm, crm2 ... crm21), and GCC (crm9).
  {
    suffix: /\.crm\d{0,3}\.dynamics\.com$/,
    authority: "login.microsoftonline.com",
  },
  // GCC High.
  {
    suffix: /\.crm\.microsoftdynamics\.us$/,
    authority: "login.microsoftonline.us",
  },
  // DoD.
  { suffix: /\.crm\.appsplatform\.us$/, authority: "login.microsoftonline.us" },
  // China, operated by 21Vianet.
  { suffix: /\.crm\.dynamics\.cn$/, authority: "login.chinacloudapi.cn" },
];

const ORGANIZATION_LABEL: RegExp = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TENANT_PATTERN: RegExp = /^[a-z0-9](?:[a-z0-9.-]{0,98}[a-z0-9])?$/i;
const CLIENT_ID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A table's logical name: lower-case letters, digits and underscores.
const LOGICAL_NAME_PATTERN: RegExp = /^[a-z][a-z0-9_]{0,127}$/;
const TENANT_IN_CHALLENGE: RegExp =
  /authorization_uri="?https:\/\/[^/"\s]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const MISSING_PROPERTY: RegExp = /could not find a property named/i;
// A character a SQL name or variable may hold: one beside @p0 makes it no placeholder.
const NAME_CHARACTER: RegExp = /[A-Za-z0-9_@#$]/;
const DIGIT: RegExp = /[0-9]/;
const SENTENCE_END: RegExp = /[.!?]$/;

function readText(value: unknown, maxLength: number = 2_000): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function readArray(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : [];
}

// The host an environment's URL names, in lower case: contoso.crm.dynamics.com.
function readHost(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .toLowerCase();
}

// Where an environment's apps sign in; null when the host is no Dataverse environment's.
export function getDataverseAuthority(host: string): string | null {
  const lower: string = host.toLowerCase();

  for (const cloud of CLOUDS) {
    // The cloud's own suffix pattern, written above, asked of the host.
    const match: RegExpExecArray | null = cloud.suffix.exec(lower);

    if (match) {
      const organization: string = lower.slice(0, match.index);

      return ORGANIZATION_LABEL.test(organization) ? cloud.authority : null;
    }
  }

  return null;
}

// The organization's name: the host's first label, contoso for contoso.crm.dynamics.com.
export function getDataverseOrganization(host: string): string {
  return host.split(".")[0] || host;
}

function readTables(value: unknown): Array<string> {
  const names: Array<unknown> = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,]+/)
      : [];
  const tables: Array<string> = [];

  for (const name of names) {
    const table: string = readText(name, 200).toLowerCase();

    if (!table) {
      continue;
    }

    if (!LOGICAL_NAME_PATTERN.test(table)) {
      throw new Error(
        `"${table.slice(0, 60)}" is not a table's logical name. Name tables to watch by their logical names, such as msdyn_workorder.`,
      );
    }

    if (!tables.includes(table)) {
      tables.push(table);
    }
  }

  if (tables.length > MAX_NAMED_DATAVERSE_TABLES) {
    throw new Error(
      `The connection names ${tables.length} tables: name at most ${MAX_NAMED_DATAVERSE_TABLES}.`,
    );
  }

  return tables;
}

/*
 * The keys and values of a Dataverse connection string, the kind its SDKs
 * take: AuthType=ClientSecret;Url=https://contoso.crm.dynamics.com;
 * ClientId=...;ClientSecret=... A value in quotes may hold a semicolon.
 */
function readConnectionStringPairs(value: string): JSONObject {
  const pairs: JSONObject = {};
  let index: number = 0;

  while (index < value.length) {
    const equals: number = value.indexOf("=", index);

    if (equals < 0) {
      break;
    }

    const key: string = value.slice(index, equals).trim().toLowerCase();
    let cursor: number = equals + 1;

    while (cursor < value.length && value[cursor] === " ") {
      cursor++;
    }

    let item: string = "";
    const quote: string | undefined = value[cursor];

    if (quote === '"' || quote === "'") {
      const close: number = value.indexOf(quote, cursor + 1);
      const end: number = close < 0 ? value.length : close;

      item = value.slice(cursor + 1, end);
      const semicolon: number = value.indexOf(";", end);

      index = semicolon < 0 ? value.length : semicolon + 1;
    } else {
      const semicolon: number = value.indexOf(";", cursor);
      const end: number = semicolon < 0 ? value.length : semicolon;

      item = value.slice(cursor, end).trim();
      index = end + 1;
    }

    if (key) {
      pairs[key] = item;
    }
  }

  return pairs;
}

function firstOf(raw: Record<string, unknown>, keys: Array<string>): unknown {
  for (const key of keys) {
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== "") {
      return raw[key];
    }
  }

  return undefined;
}

/*
 * The connection a store's string describes: JSON - { environmentUrl,
 * tenantId, clientId, clientSecret, tables } - or a Dataverse connection
 * string with AuthType=ClientSecret. Throws, saying what is missing, when it
 * describes none.
 */
export function readDataverseConnection(value: string): DataverseConnection {
  const text: string = (value || "").trim();
  let raw: Record<string, unknown> = {};

  if (text.startsWith("{")) {
    try {
      raw = readObject(JSON.parse(text));
    } catch {
      raw = {};
    }
  } else if (text.includes("=")) {
    const pairs: JSONObject = readConnectionStringPairs(text);
    const authType: string = readText(pairs["authtype"]).toLowerCase();

    if (authType && authType !== "clientsecret") {
      throw new Error(
        `OneUptime signs in to Dataverse as an application: use AuthType=ClientSecret, not ${authType.slice(0, 40)}.`,
      );
    }

    raw = {
      environmentUrl: firstOf(pairs, ["url", "serviceuri", "server"]),
      tenantId: firstOf(pairs, ["tenantid", "tenant"]),
      clientId: firstOf(pairs, ["clientid", "appid", "applicationid"]),
      clientSecret: firstOf(pairs, ["clientsecret", "secret"]),
      tables: pairs["tables"],
      sqlPort: pairs["sqlport"],
    };
  }

  const host: string = readHost(
    readText(
      firstOf(raw, [
        "environmentUrl",
        "url",
        "environment",
        "organizationUrl",
        "resource",
        "host",
      ]),
    ),
  );

  if (!host || !getDataverseAuthority(host)) {
    throw new Error(
      "The Dataverse connection needs the environment's URL, such as https://contoso.crm.dynamics.com.",
    );
  }

  const tenantId: string = readText(firstOf(raw, ["tenantId", "tenant"]), 200);

  if (tenantId && !TENANT_PATTERN.test(tenantId)) {
    throw new Error(
      "The Dataverse connection's tenantId must be the tenant's ID or domain, such as contoso.onmicrosoft.com.",
    );
  }

  const clientId: string = readText(
    firstOf(raw, ["clientId", "client_id", "appId", "applicationId"]),
    200,
  );
  const clientSecret: string = readText(
    firstOf(raw, ["clientSecret", "client_secret", "secret"]),
  );

  if (!CLIENT_ID_PATTERN.test(clientId) || !clientSecret) {
    throw new Error(
      "The Dataverse connection needs the app's client ID and client secret, from its app registration in Microsoft Entra ID.",
    );
  }

  const portValue: unknown = firstOf(raw, ["sqlPort", "tdsPort"]);
  const sqlPort: number | null =
    portValue === undefined ? null : Number(portValue);

  if (sqlPort !== null && !DATAVERSE_SQL_PORTS.includes(sqlPort)) {
    throw new Error(
      "Dataverse's SQL endpoint listens on port 1433 or 5558: leave sqlPort out to try both.",
    );
  }

  return {
    host,
    tenantId: tenantId || null,
    clientId: clientId.toLowerCase(),
    clientSecret,
    tables: readTables(raw["tables"]),
    sqlPort,
  };
}

/*
 * The tables a collection reads, by their definitions: the core business
 * tables and the environment's own custom tables, and the tables the
 * connection names. A private, logical or intersect table is never one
 * of the default ones, and nor is a business process flow's or a virtual
 * table, whose rows live outside Dataverse; a private or logical table
 * cannot be named either.
 */
export function selectDataverseTables(
  definitions: Array<JSONObject>,
  named: Array<string>,
): DataverseTableSelection {
  const wanted: Set<string> = new Set(named);
  const core: Set<string> = new Set(DATAVERSE_CORE_TABLES);
  const found: Set<string> = new Set();
  const tables: Array<DataverseTable> = [];

  for (const definition of definitions) {
    const logicalName: string = readText(
      definition["LogicalName"],
      200,
    ).toLowerCase();
    const entitySetName: string = readText(definition["EntitySetName"], 200);

    if (
      !LOGICAL_NAME_PATTERN.test(logicalName) ||
      !entitySetName ||
      definition["IsPrivate"] === true ||
      definition["IsLogicalEntity"] === true
    ) {
      continue;
    }

    const tableType: string =
      readText(definition["TableType"], 40) || "Standard";
    const isNamed: boolean = wanted.has(logicalName);
    const isOwnCustomTable: boolean =
      definition["IsCustomEntity"] === true &&
      !MICROSOFT_TABLE_PREFIX.test(logicalName);
    const isDefault: boolean =
      (core.has(logicalName) || isOwnCustomTable) &&
      definition["IsIntersect"] !== true &&
      definition["IsActivityParty"] !== true &&
      definition["IsBPFEntity"] !== true &&
      tableType.toLowerCase() !== "virtual";

    if (!isNamed && !isDefault) {
      continue;
    }

    if (found.has(logicalName)) {
      continue;
    }

    found.add(logicalName);
    tables.push({ logicalName, entitySetName, tableType });
  }

  // In code point order: logical names are lower-case ASCII, so every run sorts alike.
  tables.sort((a: DataverseTable, b: DataverseTable): number => {
    return a.logicalName < b.logicalName
      ? -1
      : a.logicalName > b.logicalName
        ? 1
        : 0;
  });

  return {
    tables,
    unknownNames: named.filter((name: string): boolean => {
      return !found.has(name);
    }),
  };
}

// Whether Dataverse keeps a row count of a table: an elastic or virtual table's are not counted.
export function isCountedDataverseTable(table: DataverseTable): boolean {
  const type: string = table.tableType.toLowerCase();

  return type === "standard" || type === "activity";
}

/*
 * A check's values written into its statement, each as an N'...' string, in
 * place of the @p0, @p1, ... SQL Server's dialect binds: the SQL endpoint is
 * read here with no parameters. A name in brackets or double quotes, a
 * string and a comment are copied as they are, so a column named "@p0"
 * stays a name.
 */
export function inlineDataverseSqlParameters(
  sql: string,
  params: Array<string>,
): string {
  if (params.length === 0) {
    return sql;
  }

  let out: string = "";
  let index: number = 0;

  // The end of a span opened at start that closes with close, a doubled close staying inside it.
  const spanEnd: (start: number, close: string) => number = (
    start: number,
    close: string,
  ): number => {
    let cursor: number = start + 1;

    while (cursor < sql.length) {
      if (sql[cursor] === close) {
        if (sql[cursor + 1] === close) {
          cursor += 2;
          continue;
        }

        return cursor + 1;
      }

      cursor++;
    }

    return sql.length;
  };

  while (index < sql.length) {
    const character: string = sql[index]!;

    if (character === "[") {
      const end: number = spanEnd(index, "]");

      out += sql.slice(index, end);
      index = end;
      continue;
    }

    if (character === "'" || character === '"') {
      const end: number = spanEnd(index, character);

      out += sql.slice(index, end);
      index = end;
      continue;
    }

    if (character === "-" && sql[index + 1] === "-") {
      const newline: number = sql.indexOf("\n", index);
      const end: number = newline < 0 ? sql.length : newline;

      out += sql.slice(index, end);
      index = end;
      continue;
    }

    if (character === "/" && sql[index + 1] === "*") {
      const close: number = sql.indexOf("*/", index + 2);
      const end: number = close < 0 ? sql.length : close + 2;

      out += sql.slice(index, end);
      index = end;
      continue;
    }

    const before: string = index > 0 ? sql[index - 1]! : "";

    if (
      character === "@" &&
      sql[index + 1] === "p" &&
      !NAME_CHARACTER.test(before)
    ) {
      let cursor: number = index + 2;

      while (cursor < sql.length && DIGIT.test(sql[cursor]!)) {
        cursor++;
      }

      const digits: string = sql.slice(index + 2, cursor);
      const after: string = cursor < sql.length ? sql[cursor]! : "";

      if (digits && !NAME_CHARACTER.test(after)) {
        const value: string | undefined = params[Number(digits)];

        if (value === undefined) {
          throw new Error(`The check has no value for @p${digits}.`);
        }

        out += `N'${value.replace(/'/g, "''")}'`;
        index = cursor;
        continue;
      }
    }

    out += character;
    index++;
  }

  return out;
}

// Raised when Dataverse asks the app to slow down (429): the reads after it wait for the next collection.
export class DataverseThrottledError extends Error {
  public readonly retryAfterInSeconds: number | null;

  public constructor(retryAfterInSeconds: number | null) {
    super(
      `Dataverse asked OneUptime to slow down (429)${retryAfterInSeconds !== null ? `, for ${retryAfterInSeconds} seconds` : ""}: the app has made too many requests in the last five minutes.`,
    );
    this.retryAfterInSeconds = retryAfterInSeconds;
  }
}

// The first line of what Dataverse or Entra ID said went wrong.
function errorOf(body: JSONObject, fallback: string): string {
  const error: JSONObject = readObject(body["error"]);

  return (
    readText(error["message"]) ||
    readText(body["error_description"]) ||
    readText(body["message"]) ||
    readText(body["error"]) ||
    fallback
  )
    .split(/\r?\n/)[0]!
    .trim()
    .slice(0, 300);
}

// A message ending in a full stop, so a sentence can follow it.
export function asSentence(text: string): string {
  const trimmed: string = text.trim();

  return !trimmed || SENTENCE_END.test(trimmed) ? trimmed : `${trimmed}.`;
}

// One OData query string, its option names as written ($select) and its values encoded.
function oDataQuery(options: Array<[string, string]>): string {
  return options
    .map(([name, value]: [string, string]): string => {
      return `${name}=${encodeURIComponent(value)}`;
    })
    .join("&");
}

export default class DataverseApi {
  private readonly connection: DataverseConnection;
  private readonly transport: DataverseTransport;
  private readonly now: () => number;
  private tenantId: string | null;
  private accessToken: { value: string; expiresAt: number } | null = null;

  public constructor(data: {
    connection: DataverseConnection;
    transport?: DataverseTransport | undefined;
    now?: (() => number) | undefined;
  }) {
    this.connection = data.connection;
    this.tenantId = data.connection.tenantId;
    this.transport =
      data.transport || DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch);
    this.now =
      data.now ||
      ((): number => {
        return Date.now();
      });
  }

  public get host(): string {
    return this.connection.host;
  }

  public get namedTables(): Array<string> {
    return this.connection.tables;
  }

  // The SQL endpoint's ports to try, in order.
  public get sqlPorts(): Array<number> {
    return this.connection.sqlPort !== null
      ? [this.connection.sqlPort]
      : [...DATAVERSE_SQL_PORTS];
  }

  private get environmentUrl(): string {
    return `https://${this.connection.host}`;
  }

  /*
   * The tenant the environment is in: asked without a token, the Web API
   * answers 401 with a challenge whose authorization_uri names it.
   */
  public async getTenantId(): Promise<string> {
    if (this.tenantId) {
      return this.tenantId;
    }

    const response: DataSourceHttpResponse = await this.transport({
      method: "GET",
      url: `${this.environmentUrl}${WEB_API_PATH}/`,
      headers: { Accept: "application/json" },
      timeoutInMs: DATAVERSE_REQUEST_TIMEOUT_IN_MS,
      acceptAnyStatus: true,
    } as DataSourceHttpRequest);
    const challenge: string = String(
      response.headers?.["www-authenticate"] || "",
    );
    const match: RegExpMatchArray | null = challenge.match(TENANT_IN_CHALLENGE);

    if (!match) {
      throw new Error(
        "Dataverse did not say which Microsoft Entra ID tenant the environment is in: add tenantId to the connection.",
      );
    }

    this.tenantId = match[1]!.toLowerCase();

    return this.tenantId;
  }

  // A token for the environment, bought with the app's client ID and secret, kept until a minute before it ends.
  public async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt - 60_000 > this.now()) {
      return this.accessToken.value;
    }

    const authority: string | null = getDataverseAuthority(
      this.connection.host,
    );
    const tenantId: string = await this.getTenantId();
    const response: DataSourceHttpResponse = await this.transport({
      method: "POST",
      url: `https://${authority}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
      headers: { Accept: "application/json" },
      body: {
        grant_type: "client_credentials",
        client_id: this.connection.clientId,
        client_secret: this.connection.clientSecret,
        scope: `${this.environmentUrl}/.default`,
      },
      formUrlEncoded: true,
      timeoutInMs: DATAVERSE_REQUEST_TIMEOUT_IN_MS,
      acceptAnyStatus: true,
    } as DataSourceHttpRequest);
    const body: JSONObject = readObject(response.bodyJson);
    const token: string = readText(body["access_token"], 20_000);

    if (response.statusCode >= 400 || !token) {
      throw new Error(
        `Microsoft Entra ID refused the app (${response.statusCode}): ${errorOf(body, "no token was given")}`,
      );
    }

    const lifetime: number = Number(body["expires_in"]) || 3600;

    this.accessToken = {
      value: token,
      expiresAt: this.now() + lifetime * 1000,
    };

    return token;
  }

  // One Web API request; a 429 is a DataverseThrottledError, any other failure says why.
  private async request(path: string): Promise<DataSourceHttpResponse> {
    const response: DataSourceHttpResponse = await this.transport({
      method: "GET",
      url: `${this.environmentUrl}${WEB_API_PATH}${path}`,
      headers: {
        Authorization: `Bearer ${await this.getAccessToken()}`,
        Accept: "application/json",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        Prefer: 'odata.include-annotations="none"',
      },
      timeoutInMs: DATAVERSE_REQUEST_TIMEOUT_IN_MS,
      acceptAnyStatus: true,
    } as DataSourceHttpRequest);

    if (response.statusCode === 429) {
      const retryAfter: number = Number(response.headers?.["retry-after"]);

      throw new DataverseThrottledError(
        Number.isFinite(retryAfter) && retryAfter >= 0
          ? Math.round(retryAfter)
          : null,
      );
    }

    return response;
  }

  private async send(path: string): Promise<JSONObject> {
    const response: DataSourceHttpResponse = await this.request(path);
    const body: JSONObject = readObject(response.bodyJson);

    if (response.statusCode === 401 || response.statusCode === 403) {
      throw new Error(
        `Dataverse refused the app (${response.statusCode}): ${asSentence(errorOf(body, "not allowed"))} Add it to the environment as an application user, with a security role that may read the tables.`,
      );
    }

    if (response.statusCode >= 400) {
      throw new Error(
        `Dataverse answered ${response.statusCode}: ${errorOf(body, response.bodyText.slice(0, 300))}`,
      );
    }

    return body;
  }

  // Every table's definition: no rows are read, and every table comes back at once.
  public async listTables(): Promise<Array<JSONObject>> {
    const body: JSONObject = await this.send(
      `/EntityDefinitions?${oDataQuery([
        [
          "$select",
          "LogicalName,EntitySetName,TableType,IsCustomEntity,IsIntersect,IsPrivate,IsLogicalEntity,IsActivityParty,IsBPFEntity",
        ],
      ])}`,
    );

    return readArray(body["value"]).map(readObject);
  }

  /*
   * Each table's rows, from the snapshot Dataverse takes once a day, fifty
   * tables a call. A table the snapshot does not hold is left out.
   */
  public async countRows(
    logicalNames: Array<string>,
  ): Promise<Map<string, number>> {
    const counts: Map<string, number> = new Map();

    for (
      let start: number = 0;
      start < logicalNames.length;
      start += DATAVERSE_TABLES_PER_COUNT
    ) {
      const names: Array<string> = logicalNames.slice(
        start,
        start + DATAVERSE_TABLES_PER_COUNT,
      );
      const body: JSONObject = await this.send(
        `/RetrieveTotalRecordCount(EntityNames=@p1)?${oDataQuery([
          ["@p1", JSON.stringify(names)],
        ])}`,
      );
      const collection: JSONObject = readObject(
        body["EntityRecordCountCollection"],
      );
      const keys: Array<unknown> = readArray(collection["Keys"]);
      const values: Array<unknown> = readArray(collection["Values"]);

      keys.forEach((key: unknown, index: number) => {
        const name: string = readText(key, 200).toLowerCase();
        const count: number = Number(values[index]);

        if (name && Number.isFinite(count) && count >= 0) {
          counts.set(name, Math.floor(count));
        }
      });
    }

    return counts;
  }

  /*
   * When a table last took a row or a change: its newest row's modifiedon,
   * of which nothing else is read - or createdon, for a table that keeps
   * no modifiedon. Null for a table with no rows, or with neither column.
   */
  public async readNewestChange(entitySetName: string): Promise<Date | null> {
    for (const column of ["modifiedon", "createdon"]) {
      const response: DataSourceHttpResponse = await this.request(
        `/${encodeURIComponent(entitySetName)}?${oDataQuery([
          ["$select", column],
          ["$orderby", `${column} desc`],
          ["$top", "1"],
        ])}`,
      );
      const body: JSONObject = readObject(response.bodyJson);

      if (
        response.statusCode === 400 &&
        MISSING_PROPERTY.test(errorOf(body, ""))
      ) {
        continue;
      }

      if (response.statusCode >= 400) {
        throw new Error(
          `Dataverse answered ${response.statusCode}: ${errorOf(body, response.bodyText.slice(0, 300))}`,
        );
      }

      const row: JSONObject = readObject(readArray(body["value"])[0]);
      const time: number = new Date(readText(row[column], 100)).getTime();

      return readText(row[column], 100) && Number.isFinite(time)
        ? new Date(time)
        : null;
    }

    return null;
  }

  /*
   * The tables' column definitions, twenty tables a call: each table's
   * attributes, by its logical name. A table Dataverse does not return is
   * left out.
   */
  public async listColumns(
    logicalNames: Array<string>,
  ): Promise<Map<string, Array<JSONObject>>> {
    const columns: Map<string, Array<JSONObject>> = new Map();

    for (
      let start: number = 0;
      start < logicalNames.length;
      start += DATAVERSE_TABLES_PER_COLUMN_READ
    ) {
      const names: Array<string> = logicalNames
        .slice(start, start + DATAVERSE_TABLES_PER_COLUMN_READ)
        .filter((name: string): boolean => {
          return LOGICAL_NAME_PATTERN.test(name);
        });

      if (names.length === 0) {
        continue;
      }

      const body: JSONObject = await this.send(
        `/EntityDefinitions?${oDataQuery([
          ["$select", "LogicalName"],
          [
            "$filter",
            names
              .map((name: string): string => {
                return `LogicalName eq '${name}'`;
              })
              .join(" or "),
          ],
          [
            "$expand",
            "Attributes($select=LogicalName,AttributeType,AttributeTypeName,AttributeOf,IsValidForRead,RequiredLevel,ColumnNumber)",
          ],
        ])}`,
      );

      for (const value of readArray(body["value"])) {
        const definition: JSONObject = readObject(value);
        const name: string = readText(
          definition["LogicalName"],
          200,
        ).toLowerCase();

        if (name) {
          columns.set(
            name,
            readArray(definition["Attributes"]).map(readObject),
          );
        }
      }
    }

    return columns;
  }
}
