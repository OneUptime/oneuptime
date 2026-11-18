import { JSONObject } from "../../../Types/JSON";
import RetryAfter from "../../../Utils/RetryAfter";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../DataSource/HttpFetch";
import logger from "../Logger";

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
 *  - the table definitions (EntityDefinitions), which read no rows: one
 *    request, which Dataverse never pages. When it fails that request, the
 *    tables watched by default and by name are read twenty at a time, and
 *    the custom tables on their own (TableHealthCollector's DataverseCatalog);
 *  - the rows of every watched table, in one call per fifty tables
 *    (RetrieveTotalRecordCount), from a snapshot Dataverse takes once a day,
 *    so a table's rows lag by up to a day;
 *  - each watched table's newest modifiedon: its one newest row, of which
 *    only that time is read;
 *  - once an hour, the watched tables' columns (their attribute
 *    definitions), twenty tables a call.
 * A group of tables Dataverse fails is asked again in smaller parts - one
 * table at a time, or in halves for the counts - so a table it cannot read
 * leaves out only itself, and the collection says which and why, in
 * Dataverse's own words: its error code and message.
 *
 * Every request carries the headers Microsoft documents for the Web API
 * (Accept, OData-MaxVersion, OData-Version and If-None-Match) and no
 * Prefer. The odata.include-annotations="none" this client once sent is no
 * pattern Dataverse's OData library accepts - a pattern names a namespace
 * and a term (Microsoft.Dynamics.CRM.*), or is * - so Dataverse answered
 * every request that carried it with an empty 500, and no collection ever
 * read a table (issue #9506). Without the preference, no annotation is
 * returned anyway.
 *
 * Every call counts against the app's service protection limits (6,000
 * requests in five minutes, per user). A 429, a 408 or a 5xx is asked
 * again, twice at most, after the Retry-After it gives or a backoff of two
 * then four seconds; a 429 holds back every request of the collection, not
 * only its own. A wait of more than thirty seconds, or past a minute of
 * waiting in one collection, is not waited out: a 429 then stops the reads
 * of the collection that met it, and the rest wait for the next.
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

// How many tables one EntityDefinitions call reads the definitions of, when the whole list failed.
export const DATAVERSE_TABLES_PER_DEFINITION_READ: number = 20;

// The most times one request is sent: once, and twice more for an answer that may pass.
export const DATAVERSE_MAX_ATTEMPTS: number = 3;

// The longest one wait between tries: a Retry-After past it is left to the next collection.
export const DATAVERSE_MAX_RETRY_WAIT_IN_MS: number = 30_000;

// The most one collection waits between tries in all, so a struggling environment cannot hold it up.
export const DATAVERSE_RETRY_BUDGET_IN_MS: number = 60_000;

// The first backoff when Dataverse names no Retry-After, doubled at each try after it.
export const DATAVERSE_FIRST_BACKOFF_IN_MS: number = 2_000;

/*
 * Answers worth asking again: a request that timed out, a throttle, and a
 * server or gateway that failed for now. Microsoft's own Web API sample
 * retries the same (its WebAPIService's retry policy).
 */
const RETRYABLE_STATUS_CODES: ReadonlyArray<number> = [
  408, 429, 500, 502, 503, 504,
];

// After this many tables in a row fail one at a time, the rest of their group is not asked one by one.
const MAX_TABLES_FAILED_IN_A_ROW: number = 3;

// The most pages one list follows (@odata.nextLink); Dataverse pages no metadata list at all.
const MAX_LIST_PAGES: number = 100;

/*
 * The headers of every Web API request, as Microsoft's "Compose HTTP
 * requests and handle errors" lists them. If-None-Match keeps an expanded
 * collection (a table's columns) from coming back from a cache, stale.
 * Never a Prefer: see the top of this file (issue #9506).
 */
const WEB_API_HEADERS: Readonly<Record<string, string>> = {
  Accept: "application/json",
  "OData-MaxVersion": "4.0",
  "OData-Version": "4.0",
  "If-None-Match": "null",
};

// What a table's definition is read for: whether, and how, it is watched.
const DEFINITION_PROPERTIES: string =
  "LogicalName,EntitySetName,TableType,IsCustomEntity,IsIntersect,IsPrivate,IsLogicalEntity,IsActivityParty,IsBPFEntity";

// What a table's columns are read for: their names, types, order and whether they may be empty.
const COLUMN_EXPANSION: string =
  "Attributes($select=LogicalName,AttributeType,AttributeTypeName,AttributeOf,IsValidForRead,RequiredLevel,ColumnNumber)";

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
// A request ID, as Dataverse's x-ms-service-request-id and REQ_ID headers give it.
const GUID: RegExp =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// Dataverse's own error code, such as 0x80040216.
const ERROR_CODE: RegExp = /^[A-Za-z0-9_.-]{1,40}$/;
// The code Dataverse gives when it has none.
const EMPTY_ERROR_CODE: RegExp = /^(?:0x)?0+$/i;
// A body that is an HTML page, as a gateway or a proxy answers: never Dataverse's own error.
const HTML_PAGE: RegExp = /^<(?:!doctype|html|head|body|\?xml)/i;
const HTML_TITLE: RegExp = /<title[^>]*>([\s\S]*?)<\/title>/i;
const HTML_HIDDEN: RegExp = /<(script|style)[^>]*>[\s\S]*?<\/\1>/gi;
const HTML_TAG: RegExp = /<[^>]*>/g;
// Credentials an answer could repeat: a bearer token, or a JSON web token on its own.
const BEARER_TOKEN: RegExp = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const JSON_WEB_TOKEN: RegExp =
  /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g;
// The most of Dataverse's own message an error keeps, so the whole sentence around it fits.
const MAX_ERROR_MESSAGE_LENGTH: number = 130;
// The longest name of a table's collection an error names.
const MAX_NAME_IN_ERROR_LENGTH: number = 60;

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

// Raised when Dataverse asks the app to slow down (429) for longer than a collection waits: the reads after it wait for the next collection.
export class DataverseThrottledError extends Error {
  public readonly retryAfterInSeconds: number | null;

  public constructor(retryAfterInSeconds: number | null) {
    super(
      `Dataverse asked OneUptime to slow down (429)${retryAfterInSeconds !== null ? `, for ${retryAfterInSeconds} seconds` : ""}: the app has made too many requests in the last five minutes.`,
    );
    this.retryAfterInSeconds = retryAfterInSeconds;
  }
}

/*
 * An answer of Dataverse's that is no success: its status, its own error
 * code (0x80040216), and the request ID Microsoft support traces it by.
 * The message says what was being read and what Dataverse answered, short
 * enough to be kept whole; reason says only the answer, for a warning that
 * names the tables itself. Neither ever holds a token or the app's secret.
 */
export class DataverseRequestError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string | null;
  public readonly requestId: string | null;
  public readonly attempts: number;
  public readonly reason: string;

  public constructor(data: {
    message: string;
    reason: string;
    statusCode: number;
    errorCode: string | null;
    requestId: string | null;
    attempts: number;
  }) {
    super(data.message);
    this.reason = data.reason;
    this.statusCode = data.statusCode;
    this.errorCode = data.errorCode;
    this.requestId = data.requestId;
    this.attempts = data.attempts;
  }
}

/*
 * Whether a read that failed leaves out only the tables it asked about:
 * Dataverse answered about them (a 400, a 403 for a table the app's role
 * may not read, a 500). A 401, a throttle, a token Entra ID refused or a
 * network that failed would fail every other read as well.
 */
export function isTableLevelDataverseError(
  error: unknown,
): error is DataverseRequestError {
  return error instanceof DataverseRequestError && error.statusCode !== 401;
}

/*
 * Whether Dataverse itself failed a read, for now or for this request's
 * size: a 5xx, or a request that timed out (408). Smaller requests may
 * still be answered; a refusal (401, 403) or a wrong request (400) would
 * be refused again.
 */
export function isServerSideDataverseError(
  error: unknown,
): error is DataverseRequestError {
  return (
    error instanceof DataverseRequestError &&
    (error.statusCode >= 500 || error.statusCode === 408)
  );
}

// Tables a read left out, and Dataverse's answer about them.
export interface DataverseSkippedTables {
  logicalNames: Array<string>;
  reason: string;
}

/*
 * What a read of many tables got: its result for the tables it could read,
 * the tables it could not and why, and the throttle that stopped it part
 * way, if one did - the tables after it are simply not in the result.
 */
export interface DataverseTablesRead<T> {
  result: T;
  skipped: Array<DataverseSkippedTables>;
  throttle: DataverseThrottledError | null;
}

// A message ending in a full stop, so a sentence can follow it.
export function asSentence(text: string): string {
  const trimmed: string = text.trim();

  return !trimmed || SENTENCE_END.test(trimmed) ? trimmed : `${trimmed}.`;
}

// The words of a body that is no JSON: an HTML page's title (a gateway's 502), else its first line.
function readBodyText(text: string): string {
  const trimmed: string = (text || "").trim();

  if (!HTML_PAGE.test(trimmed)) {
    return trimmed.split(/\r?\n/)[0]!.trim();
  }

  const title: string | undefined = HTML_TITLE.exec(trimmed)?.[1];

  return (
    title !== undefined
      ? title
      : trimmed.replace(HTML_HIDDEN, " ").replace(HTML_TAG, " ")
  )
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// The first line of what Dataverse or Entra ID said went wrong, in its own words; "" when it said nothing.
function messageOf(response: DataSourceHttpResponse): string {
  const body: JSONObject = readObject(response.bodyJson);
  const error: JSONObject = readObject(body["error"]);

  return (
    readText(error["message"]) ||
    readText(body["error_description"]) ||
    readText(body["message"]) ||
    readText(body["error"]) ||
    (response.bodyJson === undefined ? readBodyText(response.bodyText) : "")
  )
    .split(/\r?\n/)[0]!
    .trim();
}

// Dataverse's own code for the error (0x80040216); null when it gave none.
function errorCodeOf(response: DataSourceHttpResponse): string | null {
  const code: string = readText(
    readObject(readObject(response.bodyJson)["error"])["code"],
    100,
  );

  return ERROR_CODE.test(code) && !EMPTY_ERROR_CODE.test(code) ? code : null;
}

// The ID Microsoft support finds a request by: Dataverse's, or Entra ID's.
function requestIdOf(response: DataSourceHttpResponse): string | null {
  const headers: Record<string, string> = response.headers || {};

  for (const name of [
    "x-ms-service-request-id",
    "req_id",
    "x-ms-request-id",
    "request-id",
  ]) {
    const match: RegExpExecArray | null = GUID.exec(
      String(headers[name] || ""),
    );

    if (match) {
      return match[0].toLowerCase();
    }
  }

  return null;
}

// One OData query string, its option names as written ($select) and its values encoded.
function oDataQuery(options: Array<[string, string]>): string {
  return options
    .map(([name, value]: [string, string]): string => {
      return `${name}=${encodeURIComponent(value)}`;
    })
    .join("&");
}

// A filter on the tables' logical names, which LOGICAL_NAME_PATTERN keeps free of quotes.
function logicalNameFilter(names: Array<string>): string {
  return names
    .map((name: string): string => {
      return `LogicalName eq '${name}'`;
    })
    .join(" or ");
}

function isLogicalName(name: string): boolean {
  return LOGICAL_NAME_PATTERN.test(name);
}

export default class DataverseApi {
  private readonly connection: DataverseConnection;
  private readonly transport: DataverseTransport;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private tenantId: string | null;
  private accessToken: { value: string; expiresAt: number } | null = null;
  // Until when every Web API request waits, as a 429 asked.
  private throttledUntil: number = 0;
  // How long this client has waited between tries, held to DATAVERSE_RETRY_BUDGET_IN_MS.
  private waitedInMs: number = 0;

  // How the client waits between tries; replaced in tests.
  public static sleep(ms: number): Promise<void> {
    return new Promise((resolve: () => void) => {
      setTimeout(resolve, ms);
    });
  }

  public constructor(data: {
    connection: DataverseConnection;
    transport?: DataverseTransport | undefined;
    now?: (() => number) | undefined;
    sleep?: ((ms: number) => Promise<void>) | undefined;
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
    this.sleep =
      data.sleep ||
      ((ms: number): Promise<void> => {
        return DataverseApi.sleep(ms);
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

    const { response, attempts } = await this.exchange(
      async (): Promise<DataSourceHttpRequest> => {
        return {
          method: "GET",
          url: `${this.environmentUrl}${WEB_API_PATH}/`,
          headers: { Accept: "application/json" },
          timeoutInMs: DATAVERSE_REQUEST_TIMEOUT_IN_MS,
          acceptAnyStatus: true,
        };
      },
      false,
    );
    const challenge: string = String(
      response.headers?.["www-authenticate"] || "",
    );
    const match: RegExpMatchArray | null = challenge.match(TENANT_IN_CHALLENGE);

    if (!match) {
      // An environment that failed to answer has not said it names no tenant.
      if (RETRYABLE_STATUS_CODES.includes(response.statusCode)) {
        throw this.failure(
          response,
          "asking which tenant the environment is in",
          attempts,
        );
      }

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
    const { response, attempts } = await this.exchange(
      async (): Promise<DataSourceHttpRequest> => {
        return {
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
        };
      },
      false,
    );
    const body: JSONObject = readObject(response.bodyJson);
    const token: string = readText(body["access_token"], 20_000);

    if (response.statusCode >= 400 || !token) {
      const message: string = this.redact(
        messageOf(response) || "no token was given",
      ).slice(0, MAX_ERROR_MESSAGE_LENGTH);
      const isOutage: boolean = RETRYABLE_STATUS_CODES.includes(
        response.statusCode,
      );

      throw new Error(
        `Microsoft Entra ID ${isOutage ? "could not sign the app in" : "refused the app"} (${response.statusCode}): ${asSentence(message)}${attempts > 1 ? ` Tried ${attempts} times.` : ""}`,
      );
    }

    const lifetime: number = Number(body["expires_in"]) || 3600;

    this.accessToken = {
      value: token,
      expiresAt: this.now() + lifetime * 1000,
    };

    return token;
  }

  /*
   * One request, asked again when its answer may pass (a 429, a 408 or a
   * 5xx), after the Retry-After the answer gives or a doubling backoff,
   * DATAVERSE_MAX_ATTEMPTS times at most and within the collection's
   * budget for waiting. The last answer is returned, whatever it is. A 429
   * of the Web API holds back every Web API request of this client: the
   * limit is the app's, not the request's.
   */
  private async exchange(
    build: () => Promise<DataSourceHttpRequest>,
    isWebApi: boolean,
  ): Promise<{ response: DataSourceHttpResponse; attempts: number }> {
    for (let attempts: number = 1; ; attempts++) {
      if (isWebApi) {
        await this.waitOutThrottle();
      }

      const request: DataSourceHttpRequest = await build();
      const response: DataSourceHttpResponse = await this.transport(request);
      const waitInMs: number | null =
        attempts < DATAVERSE_MAX_ATTEMPTS
          ? this.reserveWait(response, attempts)
          : null;

      if (waitInMs === null) {
        return { response, attempts };
      }

      logger.debug(
        `Dataverse: ${request.method} ${request.url.split("?")[0]} answered ${response.statusCode}; asking again in ${Math.ceil(waitInMs / 1000)} seconds (try ${attempts + 1} of ${DATAVERSE_MAX_ATTEMPTS}).`,
      );

      if (isWebApi && response.statusCode === 429) {
        this.throttledUntil = Math.max(
          this.throttledUntil,
          this.now() + waitInMs,
        );
      } else {
        await this.sleep(waitInMs);
      }
    }
  }

  /*
   * How long to wait before asking again, taken from the collection's
   * budget; null when the answer is not worth asking again, or the wait is
   * longer than a collection waits.
   */
  private reserveWait(
    response: DataSourceHttpResponse,
    attempts: number,
  ): number | null {
    if (!RETRYABLE_STATUS_CODES.includes(response.statusCode)) {
      return null;
    }

    const waitInMs: number =
      RetryAfter.msFromHeaders(response.headers, { nowMs: this.now() }) ??
      DATAVERSE_FIRST_BACKOFF_IN_MS * 2 ** (attempts - 1);

    if (
      waitInMs > DATAVERSE_MAX_RETRY_WAIT_IN_MS ||
      this.waitedInMs + waitInMs > DATAVERSE_RETRY_BUDGET_IN_MS
    ) {
      return null;
    }

    this.waitedInMs += waitInMs;

    return waitInMs;
  }

  // Waits until a 429 said the app may ask again.
  private async waitOutThrottle(): Promise<void> {
    const waitInMs: number = this.throttledUntil - this.now();

    if (waitInMs > 0) {
      await this.sleep(waitInMs);
    }
  }

  // Text from an answer with any token or the app's secret in it taken out.
  private redact(text: string): string {
    let redacted: string = text
      .replace(BEARER_TOKEN, "Bearer ****")
      .replace(JSON_WEB_TOKEN, "****");

    for (const secret of [
      this.connection.clientSecret,
      this.accessToken?.value || "",
    ]) {
      if (secret.length >= 3) {
        redacted = redacted.split(secret).join("****");
      }
    }

    return redacted;
  }

  /*
   * What an answer that is no success says, as an error: what was being
   * read, Dataverse's status, code and message, how many times it was
   * asked, and the request ID Microsoft support traces it by.
   */
  private failure(
    response: DataSourceHttpResponse,
    operation: string,
    attempts: number,
  ): DataverseRequestError {
    const statusCode: number = response.statusCode;
    const errorCode: string | null = errorCodeOf(response);
    const requestId: string | null = requestIdOf(response);
    const message: string = asSentence(
      this.redact(messageOf(response))
        .slice(0, MAX_ERROR_MESSAGE_LENGTH)
        .trim(),
    );
    const isRefusal: boolean = statusCode === 401 || statusCode === 403;
    const answer: string = isRefusal
      ? `Dataverse refused the app (${statusCode}${errorCode ? `, ${errorCode}` : ""})`
      : `Dataverse answered ${statusCode}${errorCode ? ` (${errorCode})` : ""}`;
    const said: string = message
      ? `: ${message}`
      : isRefusal
        ? "."
        : ", with no error message.";
    const reason: string = `${answer}${said}`;
    const parts: Array<string> = [`${answer} while ${operation}${said}`];

    if (isRefusal) {
      parts.push(
        "Add it to the environment as an application user, with a security role that may read the tables.",
      );
    } else {
      if (attempts > 1) {
        parts.push(`Tried ${attempts} times.`);
      }

      if (requestId) {
        parts.push(`Request ID: ${requestId}.`);
      }
    }

    logger.debug(
      `Dataverse: ${parts.join(" ")}${requestId && isRefusal ? ` Request ID: ${requestId}.` : ""}`,
    );

    return new DataverseRequestError({
      message: parts.join(" "),
      reason,
      statusCode,
      errorCode,
      requestId,
      attempts,
    });
  }

  /*
   * One Web API read - a path under the Web API, or a page Dataverse named
   * - sent with the app's token and the documented headers. A 429 it
   * cannot wait out is a DataverseThrottledError; any other answer that is
   * no success says why, as a DataverseRequestError.
   */
  private async readJson(
    target: string,
    operation: string,
  ): Promise<{ body: JSONObject; response: DataSourceHttpResponse }> {
    const url: string = target.startsWith("https://")
      ? target
      : `${this.environmentUrl}${WEB_API_PATH}${target}`;
    const { response, attempts } = await this.exchange(
      async (): Promise<DataSourceHttpRequest> => {
        return {
          method: "GET",
          url,
          headers: {
            Authorization: `Bearer ${await this.getAccessToken()}`,
            ...WEB_API_HEADERS,
          },
          timeoutInMs: DATAVERSE_REQUEST_TIMEOUT_IN_MS,
          acceptAnyStatus: true,
        };
      },
      true,
    );

    if (response.statusCode === 429) {
      // Whole seconds or an HTTP-date, as RFC 9110 writes them (RetryAfter).
      throw new DataverseThrottledError(
        RetryAfter.secondsFromHeaders(response.headers, {
          nowMs: this.now(),
        }) ?? null,
      );
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw this.failure(response, operation, attempts);
    }

    return { body: readObject(response.bodyJson), response };
  }

  /*
   * Every row of a list, following each page Dataverse names on this
   * environment's Web API. A list that is not one, or a next page
   * elsewhere, is an error, never a short list: a table missing from a
   * list it read would be taken for dropped.
   */
  private async readList(
    path: string,
    operation: string,
  ): Promise<Array<JSONObject>> {
    const rows: Array<JSONObject> = [];
    let target: string = path;

    for (let page: number = 1; ; page++) {
      const { body, response } = await this.readJson(target, operation);

      if (!Array.isArray(body["value"])) {
        throw new DataverseRequestError({
          message: `Dataverse answered ${response.statusCode} while ${operation}, but with no list of results: ${asSentence(readBodyText(response.bodyText).slice(0, 80)) || "an empty body."}`,
          reason: `Dataverse answered ${response.statusCode}, but with no list of results.`,
          statusCode: response.statusCode,
          errorCode: null,
          requestId: requestIdOf(response),
          attempts: 1,
        });
      }

      rows.push(...body["value"].map(readObject));

      const next: string = readText(body["@odata.nextLink"], 8_000);

      if (!next) {
        return rows;
      }

      if (page >= MAX_LIST_PAGES || !this.isOwnPage(next)) {
        throw new DataverseRequestError({
          message: `Dataverse named a next page OneUptime does not follow while ${operation}: the list was not read whole.`,
          reason: "Dataverse named a next page OneUptime does not follow.",
          statusCode: response.statusCode,
          errorCode: null,
          requestId: requestIdOf(response),
          attempts: 1,
        });
      }

      target = next;
    }
  }

  // Whether a page Dataverse named is on this environment's Web API, the only place its token is sent.
  private isOwnPage(link: string): boolean {
    try {
      const url: URL = new URL(link);

      return (
        url.protocol === "https:" &&
        url.hostname.toLowerCase() === this.connection.host &&
        url.pathname.startsWith(`${WEB_API_PATH}/`)
      );
    } catch {
      return false;
    }
  }

  /*
   * Reads tables a group at a time. A group Dataverse answers with an
   * error about its tables is asked again in smaller parts, so a table it
   * cannot read leaves out only itself:
   *  - one by one, for definitions and columns, which Dataverse answers
   *    for one table as for many; after MAX_TABLES_FAILED_IN_A_ROW fail in
   *    a row, the rest of the group is left out with its answer;
   *  - in halves, for the counts, a half that fails halved again: when both
   *    halves fail, the fault is the read's, not one table's, and the whole
   *    part is left out.
   * A throttle stops the reads, and is handed back with what was read;
   * anything else that would fail every read (a 401, a network down) is
   * thrown.
   */
  private async readInGroups(data: {
    names: Array<string>;
    groupSize: number;
    isolate: "one by one" | "in halves";
    read: (names: Array<string>) => Promise<void>;
  }): Promise<Omit<DataverseTablesRead<void>, "result">> {
    const skipped: Array<DataverseSkippedTables> = [];
    const skip: (names: Array<string>, reason: string) => void = (
      names: Array<string>,
      reason: string,
    ): void => {
      if (names.length > 0) {
        skipped.push({ logicalNames: names, reason });
      }
    };
    // Null once the tables are read; Dataverse's answer when it failed them.
    const attempt: (
      names: Array<string>,
    ) => Promise<DataverseRequestError | null> = async (
      names: Array<string>,
    ): Promise<DataverseRequestError | null> => {
      try {
        await data.read(names);

        return null;
      } catch (error) {
        if (isTableLevelDataverseError(error)) {
          return error;
        }

        throw error;
      }
    };
    const halve: (
      names: Array<string>,
      failed: DataverseRequestError,
    ) => Promise<void> = async (
      names: Array<string>,
      failed: DataverseRequestError,
    ): Promise<void> => {
      if (names.length === 1) {
        skip(names, failed.reason);

        return;
      }

      const middle: number = Math.ceil(names.length / 2);
      const halves: Array<Array<string>> = [
        names.slice(0, middle),
        names.slice(middle),
      ];
      const errors: Array<DataverseRequestError | null> = [
        await attempt(halves[0]!),
        await attempt(halves[1]!),
      ];

      if (errors[0] && errors[1]) {
        skip(names, errors[0].reason);

        return;
      }

      for (let index: number = 0; index < 2; index++) {
        if (errors[index]) {
          await halve(halves[index]!, errors[index]!);
        }
      }
    };
    const oneByOne: (
      names: Array<string>,
      failed: DataverseRequestError,
    ) => Promise<void> = async (
      names: Array<string>,
      failed: DataverseRequestError,
    ): Promise<void> => {
      let failedInARow: number = 0;

      for (let index: number = 0; index < names.length; index++) {
        const error: DataverseRequestError | null = await attempt([
          names[index]!,
        ]);

        if (!error) {
          failedInARow = 0;
          continue;
        }

        skip([names[index]!], error.reason);
        failedInARow++;

        if (failedInARow >= MAX_TABLES_FAILED_IN_A_ROW) {
          skip(names.slice(index + 1), failed.reason);

          return;
        }
      }
    };

    try {
      for (
        let start: number = 0;
        start < data.names.length;
        start += data.groupSize
      ) {
        const group: Array<string> = data.names.slice(
          start,
          start + data.groupSize,
        );
        const error: DataverseRequestError | null = await attempt(group);

        if (!error) {
          continue;
        }

        if (group.length === 1) {
          skip(group, error.reason);
        } else if (data.isolate === "in halves") {
          await halve(group, error);
        } else {
          await oneByOne(group, error);
        }
      }
    } catch (error) {
      if (error instanceof DataverseThrottledError) {
        return { skipped, throttle: error };
      }

      throw error;
    }

    return { skipped, throttle: null };
  }

  // Every table's definition: no rows are read, and every table comes back at once.
  public async listTables(): Promise<Array<JSONObject>> {
    return await this.readList(
      `/EntityDefinitions?${oDataQuery([["$select", DEFINITION_PROPERTIES]])}`,
      "listing the tables (EntityDefinitions)",
    );
  }

  /*
   * The definitions of the tables named, twenty a call - for when the
   * whole list failed. A table the environment has not is not in the
   * result; one Dataverse could not describe is in skipped.
   */
  public async readTableDefinitions(
    logicalNames: Array<string>,
  ): Promise<DataverseTablesRead<Array<JSONObject>>> {
    const definitions: Array<JSONObject> = [];
    const read: Omit<
      DataverseTablesRead<void>,
      "result"
    > = await this.readInGroups({
      names: Array.from(new Set(logicalNames.filter(isLogicalName))),
      groupSize: DATAVERSE_TABLES_PER_DEFINITION_READ,
      isolate: "one by one",
      read: async (names: Array<string>): Promise<void> => {
        definitions.push(
          ...(await this.readList(
            `/EntityDefinitions?${oDataQuery([
              ["$select", DEFINITION_PROPERTIES],
              ["$filter", logicalNameFilter(names)],
            ])}`,
            names.length === 1
              ? `reading the definition of ${names[0]} (EntityDefinitions)`
              : "reading table definitions (EntityDefinitions)",
          )),
        );
      },
    });

    return { result: definitions, ...read };
  }

  // The definitions of the environment's custom tables alone - for when the whole list failed.
  public async listCustomTables(): Promise<Array<JSONObject>> {
    return await this.readList(
      `/EntityDefinitions?${oDataQuery([
        ["$select", DEFINITION_PROPERTIES],
        ["$filter", "IsCustomEntity eq true"],
      ])}`,
      "listing the custom tables (EntityDefinitions)",
    );
  }

  /*
   * Each table's rows, from the snapshot Dataverse takes once a day, fifty
   * tables a call. A table the snapshot does not hold is left out; a group
   * Dataverse fails is halved until the tables it cannot count are found.
   */
  public async countRows(
    logicalNames: Array<string>,
  ): Promise<DataverseTablesRead<Map<string, number>>> {
    const counts: Map<string, number> = new Map();
    const read: Omit<
      DataverseTablesRead<void>,
      "result"
    > = await this.readInGroups({
      names: logicalNames.filter(isLogicalName),
      groupSize: DATAVERSE_TABLES_PER_COUNT,
      isolate: "in halves",
      read: async (names: Array<string>): Promise<void> => {
        const { body } = await this.readJson(
          `/RetrieveTotalRecordCount(EntityNames=@p1)?${oDataQuery([
            ["@p1", JSON.stringify(names)],
          ])}`,
          names.length === 1
            ? `counting the rows of ${names[0]} (RetrieveTotalRecordCount)`
            : "counting rows (RetrieveTotalRecordCount)",
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
      },
    });

    return { result: counts, ...read };
  }

  /*
   * When a table last took a row or a change: its newest row's modifiedon,
   * of which nothing else is read - or createdon, for a table that keeps
   * no modifiedon. Null for a table with no rows, or with neither column.
   */
  public async readNewestChange(entitySetName: string): Promise<Date | null> {
    const operation: string = `reading the newest row of ${entitySetName.slice(0, MAX_NAME_IN_ERROR_LENGTH)}`;

    for (const column of ["modifiedon", "createdon"]) {
      let body: JSONObject;

      try {
        body = (
          await this.readJson(
            `/${encodeURIComponent(entitySetName)}?${oDataQuery([
              ["$select", column],
              ["$orderby", `${column} desc`],
              ["$top", "1"],
            ])}`,
            operation,
          )
        ).body;
      } catch (error) {
        // A table that keeps no such column is asked for the next.
        if (
          error instanceof DataverseRequestError &&
          error.statusCode === 400 &&
          MISSING_PROPERTY.test(error.reason)
        ) {
          continue;
        }

        throw error;
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
   * left out; a group it fails is read again one table at a time.
   */
  public async listColumns(
    logicalNames: Array<string>,
  ): Promise<DataverseTablesRead<Map<string, Array<JSONObject>>>> {
    const columns: Map<string, Array<JSONObject>> = new Map();
    const read: Omit<
      DataverseTablesRead<void>,
      "result"
    > = await this.readInGroups({
      names: logicalNames.filter(isLogicalName),
      groupSize: DATAVERSE_TABLES_PER_COLUMN_READ,
      isolate: "one by one",
      read: async (names: Array<string>): Promise<void> => {
        const definitions: Array<JSONObject> = await this.readList(
          `/EntityDefinitions?${oDataQuery([
            ["$select", "LogicalName"],
            ["$filter", logicalNameFilter(names)],
            ["$expand", COLUMN_EXPANSION],
          ])}`,
          names.length === 1
            ? `reading the columns of ${names[0]} (EntityDefinitions)`
            : "reading columns (EntityDefinitions)",
        );

        for (const definition of definitions) {
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
      },
    });

    return { result: columns, ...read };
  }
}
