import {
  BiTableDefaults,
  BiTableRef,
  MAX_BI_NAME_LENGTH,
  readSqlTables,
} from "./BiTables";

/*
 * THE TABLES A POWER QUERY (M) EXPRESSION READS.
 *
 * A Power BI dataset's tables each have a Power Query expression, which
 * Power BI's workspace scan returns (PowerBiScan). What it reads is said in
 * a few ways, all read here:
 *
 *  - A connector call names the server and, for most, the database:
 *    Sql.Database("sql01", "Sales"), PostgreSQL.Database("pg:5432", "shop"),
 *    AmazonRedshift.Database(...), Snowflake.Databases(account, warehouse),
 *    GoogleBigQuery.Database(), Databricks.Catalogs(host, path)...
 *  - Navigation steps then pick the table: Source{[Schema="dbo",Item=
 *    "Orders"]}[Data]; or [Name="ORDERS",Kind="Table"] after its database
 *    and schema steps; or, for Redshift and BigQuery's project, a Name with
 *    no Kind, which is the next level down.
 *  - Or SQL does: the Query option of a connector call (Sql.Database(server,
 *    database, [Query="SELECT ..."])), Value.NativeQuery(source, "SELECT
 *    ..."), or Odbc.Query.
 *
 * Dataverse is read through its SQL connector (CommonDataService.Database,
 * whose navigation names a table's logical name in the dbo schema) and its
 * OData ones: Cds.Entities(url) - Microsoft's own example navigates
 * Source{[Group="entities"]}[Data], then {[EntitySetName="accounts"]}[Data]
 * - and Dataverse.Contents(url). Their host is the environment URL's, and
 * their table an entity set (BiTableRef.isEntitySet), matched through the
 * environment's own entity set names (BiMatching).
 *
 * A dataset's shared expressions are read too: a parameter's value stands
 * wherever it is named (Sql.Database(ServerName, DatabaseName)), and a
 * staging query a table reads from (Source = #"Staging Orders") is read as
 * part of the table.
 *
 * The expression is read as a stream of M tokens, not evaluated: the steps
 * are read in order, each connector call starting over what a navigation
 * step means. Generated M reads the same way, step after step, and so does
 * nearly every hand-written query. Files, web pages and SharePoint lists
 * are no database table, and navigation after them is not read as one.
 *
 * A dataflow is read to its entity (#9551): PowerPlatform.Dataflows (or
 * PowerBI.Dataflows), then the workspace, the dataflow - each by id or by
 * name - and {[entity="Orders",version=""]}. The entity is no table
 * either, but the dataflow's own query of that name reads some
 * (PowerQueryRead.dataflowEntities, read through PowerBiDataflows).
 */

// A connector OneUptime reads a database's tables through.
interface PowerQueryConnector {
  // As BiTableRef names the engine.
  engine: string;
  hostArgument: number | null;
  databaseArgument: number | null;
  // Navigation starts above schemas: a Name with no Kind is a database first.
  navigatesDatabases: boolean;
  // The database Power Query navigates is not one OneUptime names (Athena's data catalog).
  keepsDatabase: boolean;
  /*
   * Dataverse's OData connectors: the host argument is the environment's
   * URL (https://org.crm.dynamics.com/), and a table is picked by its
   * entity set ({[EntitySetName="accounts"]}) after a group step.
   */
  readsEntitySets: boolean;
}

function connector(
  engine: string,
  data: Partial<Omit<PowerQueryConnector, "engine">> = {},
): PowerQueryConnector {
  return {
    engine,
    hostArgument: data.hostArgument === undefined ? 0 : data.hostArgument,
    databaseArgument:
      data.databaseArgument === undefined ? null : data.databaseArgument,
    navigatesDatabases: data.navigatesDatabases || false,
    keepsDatabase: data.keepsDatabase === undefined ? true : data.keepsDatabase,
    readsEntitySets: data.readsEntitySets || false,
  };
}

const URL_SCHEME: RegExp = /^[a-z][a-z0-9+.-]*:\/\//i;

// An environment's URL as its host: https://org.crm.dynamics.com/ is org.crm.dynamics.com.
export function hostOfUrl(value: string | null): string | null {
  const text: string = (value || "").trim();

  if (!text) {
    return null;
  }

  try {
    return (
      new URL(URL_SCHEME.test(text) ? text : `https://${text}`).hostname || null
    );
  } catch {
    return null;
  }
}

// By function name, in lower case.
const CONNECTORS: ReadonlyMap<string, PowerQueryConnector> = new Map([
  ["sql.database", connector("sqlserver", { databaseArgument: 1 })],
  ["sql.databases", connector("sqlserver", { navigatesDatabases: true })],
  ["postgresql.database", connector("postgresql", { databaseArgument: 1 })],
  ["mysql.database", connector("mysql", { databaseArgument: 1 })],
  ["oracle.database", connector("oracle")],
  ["amazonredshift.database", connector("redshift", { databaseArgument: 1 })],
  ["snowflake.databases", connector("snowflake", { navigatesDatabases: true })],
  [
    "googlebigquery.database",
    connector("bigquery", { hostArgument: null, navigatesDatabases: true }),
  ],
  [
    "googlebigqueryaad.database",
    connector("bigquery", { hostArgument: null, navigatesDatabases: true }),
  ],
  [
    "databricks.catalogs",
    connector("databricks", { navigatesDatabases: true }),
  ],
  [
    "databricks.contents",
    connector("databricks", { navigatesDatabases: true }),
  ],
  [
    "databricksmulticloud.catalogs",
    connector("databricks", { navigatesDatabases: true }),
  ],
  [
    "amazonathena.databases",
    connector("athena", { navigatesDatabases: true, keepsDatabase: false }),
  ],
  ["commondataservice.database", connector("dataverse")],
  // Dataverse's OData connectors: Common Data Service (Legacy), and Dataverse.Contents.
  ["cds.entities", connector("dataverse", { readsEntitySets: true })],
  ["cds.contents", connector("dataverse", { readsEntitySets: true })],
  ["dataverse.contents", connector("dataverse", { readsEntitySets: true })],
  ["teradata.database", connector("teradata")],
  ["db2.database", connector("db2", { databaseArgument: 1 })],
  ["sybase.database", connector("sybase", { databaseArgument: 1 })],
  ["saphana.database", connector("saphana")],
  ["informix.database", connector("informix", { databaseArgument: 1 })],
  ["vertica.database", connector("vertica", { databaseArgument: 1 })],
  ["impala.database", connector("impala", { navigatesDatabases: true })],
]);

// SQL handed to a source: Value.NativeQuery(source, sql), Odbc.Query(dsn, sql).
const NATIVE_QUERY: string = "value.nativequery";
const SQL_QUERIES: ReadonlySet<string> = new Set([
  "odbc.query",
  "oledb.query",
  "adodotnet.query",
]);

/*
 * Data that is not a database's table: navigation after these reads a
 * sheet, a file or a folder, never a table OneUptime could watch.
 */
const NOT_A_DATABASE: RegExp =
  /^(excel|csv|web|sharepoint|folder|file|json|xml|odata|text|lines|binary|pdf|access|azurestorage|azuredatalake|azureblobs|hdfs|parquet|powerplatform|powerbi|analysisservices|salesforce|exchange|activedirectory|lakehouse|warehouse|fabric|kusto|azuredataexplorer|cds|dataverse|dynamics|odbc|oledb|adodotnet|googleanalytics|googlesheets|smartsheet|quickbooks|zendesk|github|sharepointlist)\./i;

// What a dataset's expression might name: its parameters and shared queries.
export interface PowerQueryContext {
  // Each parameter's value, by its name.
  parameters?: ReadonlyMap<string, string> | undefined;
  // Each shared query, by its name: a step that names one starts where its navigation ends.
  queries?: ReadonlyMap<string, string> | undefined;
}

// Where each shared query's navigation ends, worked out once per read.
interface SharedNavigations {
  ended: Map<string, Navigation | null>;
  // Queries being read now: a query that reads itself ends nowhere.
  reading: Set<string>;
}

// A database a connector call names.
export interface PowerQuerySource {
  engine: string;
  host: string | null;
  database: string | null;
}

/*
 * A dataflow's entity a query reads (PowerPlatform.Dataflows, then the
 * workspace, the dataflow and the entity, each by id or by name): its own
 * tables are the dataflow's query of that name (PowerBiDataflows).
 */
export interface PowerQueryDataflowEntity {
  // In lower case.
  workspaceId: string | null;
  workspaceName: string | null;
  // In lower case.
  dataflowId: string | null;
  dataflowName: string | null;
  entity: string;
}

export interface PowerQueryRead {
  tables: Array<BiTableRef>;
  // Each database a connector call names, once.
  sources: Array<PowerQuerySource>;
  // Each dataflow entity it reads, once.
  dataflowEntities: Array<PowerQueryDataflowEntity>;
}

// Power BI's dataflow connectors: navigation after them picks a workspace, a dataflow and an entity.
const DATAFLOW_CONNECTORS: ReadonlySet<string> = new Set([
  "powerplatform.dataflows",
  "powerbi.dataflows",
]);

// Where a dataflow's navigation stands: the workspace and dataflow picked so far.
interface DataflowNavigation {
  workspaceId: string | null;
  workspaceName: string | null;
  dataflowId: string | null;
  dataflowName: string | null;
}

export function getPowerQueryDataflowEntityKey(
  entity: PowerQueryDataflowEntity,
): string {
  return [
    entity.workspaceId,
    entity.workspaceName,
    entity.dataflowId,
    entity.dataflowName,
    entity.entity,
  ]
    .map((part: string | null): string => {
      return (part || "").toLowerCase();
    })
    .join("\u0000");
}

// Each dataflow entity once.
export function uniqueDataflowEntities(
  entities: Array<PowerQueryDataflowEntity>,
): Array<PowerQueryDataflowEntity> {
  const seen: Set<string> = new Set();

  return entities.filter((entity: PowerQueryDataflowEntity): boolean => {
    const key: string = getPowerQueryDataflowEntityKey(entity);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

type TokenKind = "string" | "name" | "punct" | "number";

interface Token {
  kind: TokenKind;
  value: string;
  // A name written in quotes (#"Changed Type"): never a keyword.
  isQuoted?: boolean | undefined;
}

// M's keywords: names nothing defines.
const KEYWORDS: ReadonlySet<string> = new Set([
  "and",
  "as",
  "each",
  "else",
  "error",
  "false",
  "if",
  "in",
  "is",
  "let",
  "meta",
  "not",
  "null",
  "or",
  "otherwise",
  "section",
  "shared",
  "then",
  "true",
  "try",
  "type",
]);

const MAX_EXPRESSION_LENGTH: number = 200_000;
const MAX_TOKENS: number = 50_000;

// A character's code in an escape: four or eight hexadecimal digits.
const HEX_CODE: RegExp = /^[0-9a-f]{4}$|^[0-9a-f]{8}$/;
const WHITESPACE: RegExp = /\s/;

// #(cr), #(lf), #(tab), #(#), #(000D) and lists of them: #(cr,lf).
function decodeEscape(body: string): string | null {
  let text: string = "";

  for (const part of body.split(",")) {
    const code: string = part.trim().toLowerCase();

    if (code === "cr") {
      text += "\r";
    } else if (code === "lf") {
      text += "\n";
    } else if (code === "tab") {
      text += "\t";
    } else if (code === "#") {
      text += "#";
    } else if (HEX_CODE.test(code)) {
      const point: number = parseInt(code, 16);

      if (point > 0x10ffff) {
        return null;
      }

      text += String.fromCodePoint(point);
    } else {
      return null;
    }
  }

  return text;
}

// A string literal from its opening quote: its text, and where it ends.
function readStringLiteral(
  source: string,
  start: number,
): { text: string; end: number } {
  let text: string = "";
  let index: number = start + 1;

  while (index < source.length) {
    const char: string = source[index]!;

    if (char === '"') {
      if (source[index + 1] === '"') {
        text += '"';
        index += 2;
        continue;
      }

      return { text, end: index + 1 };
    }

    if (char === "#" && source[index + 1] === "(") {
      const close: number = source.indexOf(")", index + 2);
      const decoded: string | null =
        close > 0 ? decodeEscape(source.slice(index + 2, close)) : null;

      if (decoded !== null) {
        text += decoded;
        index = close + 1;
        continue;
      }
    }

    text += char;
    index++;
  }

  return { text, end: index };
}

const TWO_CHARACTER_PUNCTUATION: ReadonlySet<string> = new Set([
  "=>",
  "<=",
  ">=",
  "<>",
  "..",
  "??",
]);

// The expression as M tokens; comments and whitespace left out.
export function tokenizePowerQuery(expression: string): Array<Token> {
  const source: string = expression.slice(0, MAX_EXPRESSION_LENGTH);
  const tokens: Array<Token> = [];
  let index: number = 0;

  while (index < source.length && tokens.length < MAX_TOKENS) {
    const char: string = source[index]!;

    if (WHITESPACE.test(char)) {
      index++;
      continue;
    }

    if (char === "/" && source[index + 1] === "/") {
      const end: number = source.indexOf("\n", index);
      index = end < 0 ? source.length : end + 1;
      continue;
    }

    if (char === "/" && source[index + 1] === "*") {
      const end: number = source.indexOf("*/", index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }

    if (char === '"') {
      const literal: { text: string; end: number } = readStringLiteral(
        source,
        index,
      );

      tokens.push({ kind: "string", value: literal.text });
      index = literal.end;
      continue;
    }

    // A quoted name: #"Changed Type".
    if (char === "#" && source[index + 1] === '"') {
      const literal: { text: string; end: number } = readStringLiteral(
        source,
        index + 1,
      );

      tokens.push({ kind: "name", value: literal.text, isQuoted: true });
      index = literal.end;
      continue;
    }

    // A name, dotted ones included (Sql.Database), and #date, #table...
    const name: RegExpMatchArray | null = source
      .slice(index, index + 500)
      .match(/^#?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/);

    if (name) {
      tokens.push({ kind: "name", value: name[0] });
      index += name[0].length;
      continue;
    }

    const number: RegExpMatchArray | null = source
      .slice(index, index + 100)
      .match(/^(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);

    if (number) {
      tokens.push({ kind: "number", value: number[0] });
      index += number[0].length;
      continue;
    }

    const pair: string = source.slice(index, index + 2);

    if (TWO_CHARACTER_PUNCTUATION.has(pair)) {
      tokens.push({ kind: "punct", value: pair });
      index += 2;
      continue;
    }

    tokens.push({ kind: "punct", value: char });
    index++;
  }

  return tokens;
}

const OPENERS: Readonly<Record<string, string>> = {
  "(": ")",
  "[": "]",
  "{": "}",
};

function isPunct(token: Token | undefined, value: string): boolean {
  return Boolean(token && token.kind === "punct" && token.value === value);
}

// The token that closes the bracket at `open`, or the end.
function findClose(tokens: Array<Token>, open: number, end: number): number {
  const stack: Array<string> = [];

  for (let index: number = open; index < end; index++) {
    const token: Token = tokens[index]!;

    if (token.kind !== "punct") {
      continue;
    }

    if (OPENERS[token.value]) {
      stack.push(OPENERS[token.value]!);
    } else if (stack.length > 0 && token.value === stack[stack.length - 1]) {
      stack.pop();

      if (stack.length === 0) {
        return index;
      }
    }
  }

  return end;
}

// The top-level parts between `open` and `close`, split on commas, as [start, end) ranges.
function splitParts(
  tokens: Array<Token>,
  open: number,
  close: number,
): Array<[number, number]> {
  const parts: Array<[number, number]> = [];
  let start: number = open + 1;
  let depth: number = 0;

  for (let index: number = open + 1; index < close; index++) {
    const token: Token = tokens[index]!;

    if (token.kind === "punct" && OPENERS[token.value]) {
      depth++;
    } else if (
      token.kind === "punct" &&
      (token.value === ")" || token.value === "]" || token.value === "}")
    ) {
      depth--;
    } else if (depth === 0 && isPunct(token, ",")) {
      parts.push([start, index]);
      start = index + 1;
    }
  }

  if (start < close) {
    parts.push([start, close]);
  }

  return parts;
}

function lookUpParameter(
  name: string,
  context: PowerQueryContext,
): string | null {
  const parameters: ReadonlyMap<string, string> | undefined =
    context.parameters;

  if (!parameters) {
    return null;
  }

  if (parameters.has(name)) {
    return parameters.get(name)!;
  }

  // M names are case-sensitive, but a parameter is never two names apart by case alone.
  for (const [key, value] of parameters) {
    if (key.toLowerCase() === name.toLowerCase()) {
      return value;
    }
  }

  return null;
}

/*
 * A part as text, where it is one: a string, a parameter, or the two joined
 * with &. Anything else - a call, a step - is no text read here.
 */
function readText(
  tokens: Array<Token>,
  range: [number, number],
  context: PowerQueryContext,
): string | null {
  let text: string = "";
  let expectsValue: boolean = true;

  for (let index: number = range[0]; index < range[1]; index++) {
    const token: Token = tokens[index]!;

    if (expectsValue) {
      if (token.kind === "string") {
        text += token.value;
      } else if (token.kind === "name") {
        const value: string | null = lookUpParameter(token.value, context);

        if (value === null) {
          return null;
        }

        text += value;
      } else {
        return null;
      }

      expectsValue = false;
    } else if (isPunct(token, "&")) {
      expectsValue = true;
    } else {
      return null;
    }
  }

  return expectsValue ? null : text;
}

// A record literal's fields, by name in lower case, each as text where it is one.
function readRecord(
  tokens: Array<Token>,
  open: number,
  close: number,
  context: PowerQueryContext,
): Map<string, string | null> {
  const fields: Map<string, string | null> = new Map();

  for (const [start, end] of splitParts(tokens, open, close)) {
    const name: Token | undefined = tokens[start];

    if (!name || name.kind !== "name" || !isPunct(tokens[start + 1], "=")) {
      continue;
    }

    fields.set(
      name.value.toLowerCase(),
      readText(tokens, [start + 2, end], context),
    );
  }

  return fields;
}

/*
 * Where a navigation stands: a database's connector, and the database and
 * schema picked so far - or, after a dataflow connector, the workspace and
 * dataflow picked so far.
 */
interface Navigation {
  connector: PowerQueryConnector;
  host: string | null;
  database: string | null;
  schema: string | null;
  dataflow: DataflowNavigation | null;
}

// What a dataflow connector's navigation is read with: no engine OneUptime watches, no host.
const DATAFLOWS: PowerQueryConnector = connector("dataflows", {
  hostArgument: null,
});

// A navigation to go on from, never the one it was copied from.
function copyOf(navigation: Navigation): Navigation {
  return {
    ...navigation,
    dataflow: navigation.dataflow ? { ...navigation.dataflow } : null,
  };
}

function cut(value: string | null): string | null {
  const text: string = (value || "").trim();

  return text ? text.slice(0, MAX_BI_NAME_LENGTH) : null;
}

// The database SQL runs in, as its connector names it: as its server does. A dataflow is no database.
function defaultsOf(navigation: Navigation | null): BiTableDefaults {
  return navigation && !navigation.dataflow
    ? {
        database: navigation.connector.keepsDatabase
          ? cut(navigation.database)
          : null,
        engine: navigation.connector.engine,
        host: cut(navigation.host),
        isDatabaseExact: true,
      }
    : {};
}

// A table navigation picked: in MySQL a schema is a database, so the schema names both.
function tableOf(navigation: Navigation, table: string): BiTableRef {
  const schema: string | null = cut(navigation.schema);
  const database: string | null =
    navigation.connector.engine === "mysql" && schema
      ? schema
      : navigation.connector.keepsDatabase
        ? cut(navigation.database)
        : null;
  const ref: BiTableRef = {
    database,
    schema,
    table: table.slice(0, MAX_BI_NAME_LENGTH),
    engine: navigation.connector.engine,
    host: cut(navigation.host),
  };

  if (database) {
    ref.isDatabaseExact = true;
  }

  return ref;
}

const TABLE_KINDS: ReadonlySet<string> = new Set([
  "table",
  "view",
  "materializedview",
]);

class PowerQueryReader {
  private readonly tokens: Array<Token>;
  private readonly context: PowerQueryContext;
  private readonly shared: SharedNavigations;
  public navigation: Navigation | null = null;
  public readonly tables: Array<BiTableRef> = [];
  public readonly sources: Array<PowerQuerySource> = [];
  public readonly dataflowEntities: Array<PowerQueryDataflowEntity> = [];

  public constructor(
    tokens: Array<Token>,
    context: PowerQueryContext,
    shared: SharedNavigations,
  ) {
    this.tokens = tokens;
    this.context = context;
    this.shared = shared;
  }

  public read(start: number, end: number): void {
    let index: number = start;

    while (index < end) {
      const token: Token = this.tokens[index]!;
      const next: Token | undefined = this.tokens[index + 1];

      if (token.kind === "name" && isPunct(next, "(")) {
        index = this.readCall(token.value.toLowerCase(), index, end);
        continue;
      }

      // A shared query named as a value: the next step starts where its navigation ends.
      if (
        token.kind === "name" &&
        !isPunct(next, "=") &&
        this.context.queries?.has(token.value)
      ) {
        const ended: Navigation | null = this.navigationOf(token.value);

        if (ended) {
          this.navigation = copyOf(ended);
        }

        index++;
        continue;
      }

      // Item access on a value - Source{[Schema="dbo",Item="Orders"]} - not a list of records.
      if (
        isPunct(token, "{") &&
        isPunct(next, "[") &&
        index > start &&
        this.isValueBefore(index)
      ) {
        const close: number = findClose(this.tokens, index + 1, end);

        this.navigate(readRecord(this.tokens, index + 1, close, this.context));
        index = close + 1;
        continue;
      }

      index++;
    }
  }

  // Where a shared query's navigation ends: read once, and nowhere for a query that reads itself.
  private navigationOf(name: string): Navigation | null {
    if (this.shared.ended.has(name)) {
      return this.shared.ended.get(name) ?? null;
    }

    if (this.shared.reading.has(name)) {
      return null;
    }

    this.shared.reading.add(name);

    const tokens: Array<Token> = tokenizePowerQuery(
      this.context.queries?.get(name) || "",
    );
    const reader: PowerQueryReader = new PowerQueryReader(
      tokens,
      this.context,
      this.shared,
    );

    reader.read(0, tokens.length);
    this.shared.reading.delete(name);
    this.shared.ended.set(name, reader.navigation);

    return reader.navigation;
  }

  private isValueBefore(index: number): boolean {
    const before: Token | undefined = this.tokens[index - 1];

    return Boolean(
      before &&
        (before.kind === "name" ||
          isPunct(before, ")") ||
          isPunct(before, "]") ||
          isPunct(before, "}")),
    );
  }

  // A call at `index`: read as what it is, and the index after it.
  private readCall(name: string, index: number, end: number): number {
    const open: number = index + 1;
    const close: number = findClose(this.tokens, open, end);
    const parts: Array<[number, number]> = splitParts(this.tokens, open, close);
    const found: PowerQueryConnector | undefined = CONNECTORS.get(name);

    if (found) {
      this.connect(found, parts);
      return close + 1;
    }

    // A dataflow: its workspace, the dataflow and the entity are navigated next.
    if (DATAFLOW_CONNECTORS.has(name)) {
      this.navigation = {
        connector: DATAFLOWS,
        host: null,
        database: null,
        schema: null,
        dataflow: {
          workspaceId: null,
          workspaceName: null,
          dataflowId: null,
          dataflowName: null,
        },
      };

      return close + 1;
    }

    if (name === NATIVE_QUERY) {
      // The source first, so its navigation says which database the SQL runs in.
      if (parts[0]) {
        this.read(parts[0][0], parts[0][1]);
      }

      const sql: string | null = parts[1]
        ? readText(this.tokens, parts[1], this.context)
        : null;

      if (sql) {
        this.tables.push(...readSqlTables(sql, defaultsOf(this.navigation)));
      }

      return close + 1;
    }

    if (SQL_QUERIES.has(name)) {
      this.navigation = null;

      const sql: string | null = parts[1]
        ? readText(this.tokens, parts[1], this.context)
        : null;

      if (sql) {
        this.tables.push(...readSqlTables(sql));
      }

      return close + 1;
    }

    if (NOT_A_DATABASE.test(name)) {
      this.navigation = null;
    }

    // Any other call is read inside: its arguments can hold a source.
    return index + 1;
  }

  private connect(
    found: PowerQueryConnector,
    parts: Array<[number, number]>,
  ): void {
    const argument: (position: number | null) => string | null = (
      position: number | null,
    ): string | null => {
      return position !== null && parts[position]
        ? cut(readText(this.tokens, parts[position]!, this.context))
        : null;
    };
    const navigation: Navigation = {
      connector: found,
      host: found.readsEntitySets
        ? cut(hostOfUrl(argument(found.hostArgument)))
        : argument(found.hostArgument),
      database: argument(found.databaseArgument),
      schema: null,
      dataflow: null,
    };

    // The options record, where there is one: its SQL, and a default catalog and schema (Databricks).
    let sql: string | null = null;

    for (const [start, partEnd] of parts) {
      if (isPunct(this.tokens[start], "[")) {
        const close: number = findClose(this.tokens, start, partEnd);
        const options: Map<string, string | null> = readRecord(
          this.tokens,
          start,
          close,
          this.context,
        );

        sql = options.get("query") || sql;

        if (found.engine === "databricks") {
          navigation.database =
            cut(options.get("catalog") || null) || navigation.database;
          navigation.schema =
            cut(options.get("database") || null) || navigation.schema;
        }
      }
    }

    this.navigation = navigation;
    this.addSource({
      engine: found.engine,
      host: navigation.host,
      database: found.keepsDatabase ? navigation.database : null,
    });

    if (sql) {
      this.tables.push(...readSqlTables(sql, defaultsOf(navigation)));
    }
  }

  private addSource(source: PowerQuerySource): void {
    const key: string = [source.engine, source.host, source.database]
      .map((part: string | null): string => {
        return (part || "").toLowerCase();
      })
      .join("\u0000");

    if (
      !this.sources.some((known: PowerQuerySource): boolean => {
        return (
          [known.engine, known.host, known.database]
            .map((part: string | null): string => {
              return (part || "").toLowerCase();
            })
            .join("\u0000") === key
        );
      })
    ) {
      this.sources.push(source);
    }
  }

  /*
   * One navigation step of a dataflow: its workspace, the dataflow - each
   * by id or by name, as Power BI Desktop and parameters write them - or
   * the entity it reads. Any other step ({[Id="Workspaces"]}) is a level.
   */
  private navigateDataflow(
    dataflow: DataflowNavigation,
    fields: Map<string, string | null>,
  ): void {
    const workspaceId: string | null = cut(fields.get("workspaceid") || null);
    const workspaceName: string | null = cut(
      fields.get("workspacename") || null,
    );
    const dataflowId: string | null = cut(fields.get("dataflowid") || null);
    const dataflowName: string | null = cut(fields.get("dataflowname") || null);
    const entity: string | null = cut(fields.get("entity") || null);

    if (workspaceId || workspaceName) {
      dataflow.workspaceId = workspaceId ? workspaceId.toLowerCase() : null;
      dataflow.workspaceName = workspaceName;
      dataflow.dataflowId = null;
      dataflow.dataflowName = null;
      return;
    }

    if (dataflowId || dataflowName) {
      dataflow.dataflowId = dataflowId ? dataflowId.toLowerCase() : null;
      dataflow.dataflowName = dataflowName;
      return;
    }

    if (entity && (dataflow.dataflowId || dataflow.dataflowName)) {
      this.dataflowEntities.push({ ...dataflow, entity });
    }
  }

  // One navigation step of a database: a level down, or a table.
  private navigate(fields: Map<string, string | null>): void {
    const navigation: Navigation | null = this.navigation;

    if (!navigation) {
      return;
    }

    if (navigation.dataflow) {
      this.navigateDataflow(navigation.dataflow, fields);
      return;
    }

    const schema: string | null = fields.get("schema") || null;
    const item: string | null = fields.get("item") || null;
    const name: string | null = fields.get("name") || null;
    const kind: string = (fields.get("kind") || "").toLowerCase();

    // SQL Server, PostgreSQL, MySQL, Oracle, Teradata: the schema and the table in one step.
    if (schema && item) {
      this.tables.push(tableOf({ ...navigation, schema }, item));
      return;
    }

    /*
     * Dataverse's OData connectors pick a table by its entity set; any
     * other step - its group ({[Group="entities"]}) - picks none.
     */
    if (navigation.connector.readsEntitySets) {
      const entitySet: string | null = cut(fields.get("entitysetname") || null);

      if (entitySet) {
        this.tables.push({
          database: null,
          schema: null,
          table: entitySet,
          engine: navigation.connector.engine,
          host: cut(navigation.host),
          isEntitySet: true,
        });
      }

      return;
    }

    // A hierarchical navigation's schema step: its tables come next.
    if (schema && !name) {
      navigation.schema = schema;
      return;
    }

    const label: string | null = name || item;

    if (!label) {
      return;
    }

    if (kind === "database") {
      navigation.database = label;
      navigation.schema = null;
      return;
    }

    if (kind === "schema") {
      navigation.schema = label;
      return;
    }

    if (TABLE_KINDS.has(kind) || (!kind && item && !name)) {
      this.tables.push(tableOf(navigation, label));
      return;
    }

    if (kind) {
      // A function, a cube, a sheet: no table.
      return;
    }

    // A Name with no Kind (Redshift, BigQuery's project): the next level down.
    if (navigation.connector.navigatesDatabases && !navigation.database) {
      navigation.database = label;
    } else if (!navigation.schema && navigation.connector.engine !== "mysql") {
      navigation.schema = label;
    } else {
      this.tables.push(tableOf(navigation, label));
    }
  }
}

function readWith(
  expression: string,
  context: PowerQueryContext,
  shared: SharedNavigations,
): PowerQueryRead {
  const tokens: Array<Token> = tokenizePowerQuery(expression);
  const reader: PowerQueryReader = new PowerQueryReader(
    tokens,
    context,
    shared,
  );

  reader.read(0, tokens.length);

  return {
    tables: reader.tables,
    sources: reader.sources,
    dataflowEntities: uniqueDataflowEntities(reader.dataflowEntities),
  };
}

export function readPowerQuery(
  expression: string,
  context: PowerQueryContext = {},
): PowerQueryRead {
  return readWith(expression, context, {
    ended: new Map(),
    reading: new Set(),
  });
}

// The tables a Power Query expression reads.
export function readPowerQueryTables(
  expression: string,
  context: PowerQueryContext = {},
): Array<BiTableRef> {
  return readPowerQuery(expression, context).tables;
}

/*
 * A parameter's value, where the expression is a text parameter's:
 * "sql01.acme.com" meta [IsParameterQuery=true, Type="Text", ...].
 */
export function readPowerQueryParameter(expression: string): string | null {
  const tokens: Array<Token> = tokenizePowerQuery(expression);

  if (
    tokens[0]?.kind !== "string" ||
    tokens[1]?.kind !== "name" ||
    tokens[1].value.toLowerCase() !== "meta" ||
    !isPunct(tokens[2], "[")
  ) {
    return null;
  }

  const close: number = findClose(tokens, 2, tokens.length);
  const meta: Map<string, string | null> = new Map();

  for (const [start, end] of splitParts(tokens, 2, close)) {
    const name: Token | undefined = tokens[start];

    if (name?.kind === "name" && isPunct(tokens[start + 1], "=")) {
      const value: Token | undefined = tokens[start + 2];

      meta.set(
        name.value.toLowerCase(),
        end === start + 3 && value ? value.value.toLowerCase() : null,
      );
    }
  }

  return meta.get("isparameterquery") === "true" ? tokens[0].value : null;
}

/*
 * The names an expression reads that it does not define itself: the
 * queries, parameters and functions it uses (a step it defines is named
 * before an =).
 */
export function readPowerQueryReferences(expression: string): Array<string> {
  const tokens: Array<Token> = tokenizePowerQuery(expression);
  const defined: Set<string> = new Set();
  const used: Array<string> = [];

  tokens.forEach((token: Token, index: number): void => {
    if (
      token.kind !== "name" ||
      (!token.isQuoted && KEYWORDS.has(token.value))
    ) {
      return;
    }

    if (isPunct(tokens[index + 1], "=")) {
      defined.add(token.value);
    } else {
      used.push(token.value);
    }
  });

  return Array.from(new Set(used)).filter((name: string): boolean => {
    return !defined.has(name);
  });
}

export interface PowerQueryDataset {
  // Each table's source expressions.
  tables: Array<{ name: string; sources: Array<string> }>;
  // The dataset's shared expressions: parameters, and queries the tables read from.
  expressions: Array<{ name: string; expression: string }>;
}

// How many shared queries deep a table's reads are followed.
const MAX_REFERENCE_DEPTH: number = 10;

/*
 * The tables a dataset reads, from its tables' expressions and the shared
 * queries they read from, with its parameters standing where they are
 * named; and each database its connector calls name.
 */
export function readPowerQueryDataset(
  dataset: PowerQueryDataset,
): PowerQueryRead {
  const parameters: Map<string, string> = new Map();
  const queries: Map<string, string> = new Map();

  for (const shared of dataset.expressions) {
    if (!shared.name || !shared.expression) {
      continue;
    }

    const value: string | null = readPowerQueryParameter(shared.expression);

    if (value !== null) {
      parameters.set(shared.name, value);
    } else {
      queries.set(shared.name, shared.expression);
    }
  }

  const context: PowerQueryContext = { parameters, queries };
  const shared: SharedNavigations = { ended: new Map(), reading: new Set() };
  const tables: Array<BiTableRef> = [];
  const sources: Array<PowerQuerySource> = [];
  const dataflowEntities: Array<PowerQueryDataflowEntity> = [];
  const read: Set<string> = new Set();

  const readExpression: (expression: string, depth: number) => void = (
    expression: string,
    depth: number,
  ): void => {
    const found: PowerQueryRead = readWith(expression, context, shared);

    tables.push(...found.tables);
    sources.push(...found.sources);
    dataflowEntities.push(...found.dataflowEntities);

    if (depth >= MAX_REFERENCE_DEPTH) {
      return;
    }

    for (const name of readPowerQueryReferences(expression)) {
      const query: string | undefined = queries.get(name);

      if (query !== undefined && !read.has(name)) {
        read.add(name);
        readExpression(query, depth + 1);
      }
    }
  };

  for (const table of dataset.tables) {
    for (const source of table.sources) {
      readExpression(source, 0);
    }
  }

  return {
    tables,
    sources,
    dataflowEntities: uniqueDataflowEntities(dataflowEntities),
  };
}

// A section document's members: the most read, and the longest document read.
const MAX_SECTION_MEMBERS: number = 2_000;
const MAX_SECTION_LENGTH: number = 5_000_000;
const SECTION_NAME: RegExp = /^[A-Za-z_][A-Za-z0-9_.]*/;

/*
 * The queries of a section document, as a dataflow's definition keeps them
 * (its pbi:mashup document): "section Section1; shared Orders = let ...
 * in ...; shared #"Staging Orders" = ...;". Each member's name and its
 * expression, in order. A member ends at its semicolon - outside strings,
 * quoted names, comments and brackets - which nothing inside an expression
 * writes.
 */
export function readPowerQuerySection(
  document: string,
): Array<{ name: string; expression: string }> {
  const source: string = document.slice(0, MAX_SECTION_LENGTH);
  const members: Array<{ name: string; expression: string }> = [];
  let index: number = 0;

  // Past whitespace and comments.
  const skipSpace: () => void = (): void => {
    for (;;) {
      while (index < source.length && WHITESPACE.test(source[index]!)) {
        index++;
      }

      if (source.startsWith("//", index)) {
        const end: number = source.indexOf("\n", index);
        index = end < 0 ? source.length : end + 1;
      } else if (source.startsWith("/*", index)) {
        const end: number = source.indexOf("*/", index + 2);
        index = end < 0 ? source.length : end + 2;
      } else {
        return;
      }
    }
  };

  // To the semicolon that ends the member at `index`, outside strings, names, comments and brackets.
  const skipToEnd: () => number = (): number => {
    let depth: number = 0;

    while (index < source.length) {
      const char: string = source[index]!;

      if (char === '"' || (char === "#" && source[index + 1] === '"')) {
        index = readStringLiteral(source, char === "#" ? index + 1 : index).end;
        continue;
      }

      if (source.startsWith("//", index) || source.startsWith("/*", index)) {
        skipSpace();
        continue;
      }

      if (char === "(" || char === "[" || char === "{") {
        depth++;
      } else if (char === ")" || char === "]" || char === "}") {
        depth = Math.max(0, depth - 1);
      } else if (char === ";" && depth === 0) {
        return index;
      }

      index++;
    }

    return source.length;
  };

  skipSpace();

  if (source.startsWith("section", index)) {
    index = skipToEnd() + 1;
  }

  while (index < source.length && members.length < MAX_SECTION_MEMBERS) {
    skipSpace();

    // A member's attributes ([Description = "..."]) say nothing of what it reads.
    if (source[index] === "[") {
      const close: number = source.indexOf("]", index);
      index = close < 0 ? source.length : close + 1;
      skipSpace();
    }

    if (
      source.startsWith("shared", index) &&
      WHITESPACE.test(source[index + 6] || "")
    ) {
      index += 6;
      skipSpace();
    }

    let name: string = "";

    if (source.startsWith('#"', index)) {
      const literal: { text: string; end: number } = readStringLiteral(
        source,
        index + 1,
      );

      name = literal.text;
      index = literal.end;
    } else {
      const found: RegExpMatchArray | null = source
        .slice(index, index + 500)
        .match(SECTION_NAME);

      name = found ? found[0] : "";
      index += name.length;
    }

    skipSpace();

    if (!name || source[index] !== "=") {
      // Not a member: on to the next semicolon.
      index = skipToEnd() + 1;
      continue;
    }

    index++;

    const start: number = index;
    const end: number = skipToEnd();
    const expression: string = source.slice(start, end).trim();

    index = end + 1;

    if (expression) {
      members.push({ name, expression });
    }
  }

  return members;
}
