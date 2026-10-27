import type { SpanKind } from "Common/Models/AnalyticsModels/Span";
import {
  CLIENT_SPAN_KIND,
  MutableSpanAttributeMap,
  SpanAttributeMap,
  hasAnyValue,
  isObiSpan,
  readNonEmptyString,
} from "./ObiSpan";

/*
 * OBI (OpenTelemetry eBPF Instrumentation, the Kubernetes agent's tracer)
 * parses HTTP, but not what an HTTP API carries, so a client's call to
 * ClickHouse's HTTP interface is an HTTP span named after its bare request:
 * `POST /`. The statement is all there, in the query string the client
 * wrote — the ClickHouse clients put an INSERT, and any statement sent with
 * GET, in the `query` parameter, next to the server's own parameters and
 * settings — as OBI records it, from production:
 *
 *   url.query  query_id=1472fec1-bab2-4dbf-b613-b94c6d8bc0e2&async_insert=1
 *              &wait_for_async_insert=0&async_insert_deduplicate=1
 *              &insert_deduplication_token=fanin%3ALogItemV3%3A01a17c37-…
 *              &database=oneuptime&query=INSERT+INTO+LogItemV3+FORMAT
 *
 * Such a span is given what OTel's database conventions give a ClickHouse
 * call: db.system.name `clickhouse`, db.namespace from `database`, the decoded
 * statement as db.query.text, its first keyword as db.operation.name, the
 * table after INSERT INTO or FROM as db.collection.name, and the name OTel's
 * database conventions give it, `{db.operation.name} {db.collection.name}`
 * (`INSERT LogItemV3`), or the operation alone when no table can be read.
 * Then database discovery finds ClickHouse from these calls and the service
 * map draws it as a database: both read db.system.name before anything else,
 * and neither reads the HTTP attributes the span keeps. Everything OBI wrote
 * is left as it was.
 *
 * Conservative, because plenty of HTTP APIs take a `query` parameter (a
 * search, Prometheus' PromQL, QuestDB's SQL, GraphQL over GET). A span is
 * ClickHouse's only when all of these hold:
 *
 *   - it is OBI's (telemetry.distro.name), a CLIENT span, an HTTP GET or
 *     POST (http.request.method, the two methods ClickHouse runs a
 *     statement for), and names no database or messaging system yet;
 *   - its query string (url.query, else the part of url.full after "?") has
 *     a non-blank `query` parameter;
 *   - and at least one parameter only ClickHouse's HTTP interface reads
 *     (CLICKHOUSE_HTTP_PARAMETERS: `database`, `query_id`, `default_format`,
 *     the `async_insert` and session settings, …), as ClickHouse's clients
 *     send them: the JavaScript client sends `query_id` with every call;
 *   - and the statement starts with a ClickHouse statement keyword
 *     (CLICKHOUSE_STATEMENT_KEYWORDS), after any white space, comments and
 *     opening parentheses.
 *
 * Left alone: a call without a `query` parameter — a health check
 * (`GET /`, `GET /ping`), and a SELECT the clients send in the request body,
 * which OBI does not capture — and every server span, including the ones OBI
 * records inside ClickHouse itself.
 *
 * db.query.text holds nothing url.query does not: the statement as the URL
 * holds it, decoded. Ingest caps no attribute's length, so it is not capped
 * here either, and decoding only ever shortens it. OBI may cut a long URL
 * short, and then the statement too (the one above stops at FORMAT, its
 * format's name cut off); a cut escape is kept as it was written. Every pass
 * over the value is a single loop, so a value of any length costs time in
 * line with it.
 */

export const CLICKHOUSE_DB_SYSTEM_NAME: string = "clickhouse";

// The query-string parameter that carries the statement.
const QUERY_PARAMETER: string = "query";
const DATABASE_PARAMETER: string = "database";

/*
 * Parameters only ClickHouse's HTTP interface reads: its own (database,
 * query_id, default_format, the session ones, wait_end_of_query,
 * buffer_size) and the settings its clients put in the URL. Names generic
 * enough to mean something to another API (user, password, role, compress,
 * readonly, extremes) are not listed.
 */
export const CLICKHOUSE_HTTP_PARAMETERS: ReadonlySet<string> = new Set<string>([
  DATABASE_PARAMETER,
  "query_id",
  "default_format",
  "session_id",
  "session_timeout",
  "session_check",
  "wait_end_of_query",
  "buffer_size",
  "max_result_rows",
  "max_result_bytes",
  "result_overflow_mode",
  "async_insert",
  "wait_for_async_insert",
  "wait_for_async_insert_timeout",
  "async_insert_deduplicate",
  "insert_deduplicate",
  "insert_deduplication_token",
  "insert_quorum",
  "send_progress_in_http_headers",
  "http_headers_progress_interval_ms",
  "enable_http_compression",
  "http_zlib_compression_level",
  "output_format_json_quote_64bit_integers",
  "date_time_input_format",
  "date_time_output_format",
  "input_format_skip_unknown_fields",
  "max_execution_time",
  "max_block_size",
  "max_insert_block_size",
  "max_memory_usage",
  "quota_key",
  "log_comment",
]);

// The keywords a ClickHouse statement starts with, upper-cased.
export const CLICKHOUSE_STATEMENT_KEYWORDS: ReadonlySet<string> =
  new Set<string>([
    "SELECT",
    "WITH",
    "INSERT",
    "CREATE",
    "ALTER",
    "DROP",
    "UNDROP",
    "DETACH",
    "ATTACH",
    "TRUNCATE",
    "RENAME",
    "EXCHANGE",
    "OPTIMIZE",
    "DELETE",
    "UPDATE",
    "SHOW",
    "DESCRIBE",
    "DESC",
    "EXPLAIN",
    "EXISTS",
    "CHECK",
    "KILL",
    "SYSTEM",
    "SET",
    "USE",
    "GRANT",
    "REVOKE",
    "BACKUP",
    "RESTORE",
    "WATCH",
    "MOVE",
  ]);

/*
 * The statements whose first FROM, outside parentheses, names the table
 * they read or delete from. Elsewhere a FROM names something else (SHOW
 * TABLES FROM <database>).
 */
const FROM_TABLE_OPERATIONS: ReadonlySet<string> = new Set<string>([
  "SELECT",
  "WITH",
  "DELETE",
]);

// Keys as the ingest service's per-span attribute map holds them.
const HTTP_REQUEST_METHOD_ATTRIBUTE: string = "http.request.method";
const URL_QUERY_ATTRIBUTE: string = "url.query";
const URL_FULL_ATTRIBUTE: string = "url.full";
const DB_SYSTEM_NAME_ATTRIBUTE: string = "db.system.name";
const DB_NAMESPACE_ATTRIBUTE: string = "db.namespace";
const DB_QUERY_TEXT_ATTRIBUTE: string = "db.query.text";
const DB_OPERATION_NAME_ATTRIBUTE: string = "db.operation.name";
const DB_COLLECTION_NAME_ATTRIBUTE: string = "db.collection.name";

/*
 * The methods ClickHouse's HTTP interface runs a statement for, as OBI
 * writes them.
 */
const CLICKHOUSE_HTTP_METHODS: ReadonlySet<string> = new Set<string>([
  "GET",
  "POST",
]);

// A span that names one of these is already a database or messaging call.
const PROTOCOL_ATTRIBUTES: ReadonlyArray<string> = [
  DB_SYSTEM_NAME_ATTRIBUTE,
  "db.system",
  "messaging.system",
];

export interface ObiClickHouseQuery {
  // The statement, decoded.
  queryText: string;
  // Its first keyword, upper-cased: INSERT, SELECT, …
  operationName: string;
  // The table after INSERT INTO, or after FROM, when there is one.
  collectionName: string | null;
  // The `database` parameter, decoded, when it is set.
  namespace: string | null;
}

// ---- reading the query string -----------------------------------------------

const PERCENT_CODE: number = 0x25;
const EQUALS_CODE: number = 0x3d;
const QUESTION_MARK_CODE: number = 0x3f;

// The length of one %XX escape.
const ESCAPE_LENGTH: number = 3;

function isHexDigit(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x46) ||
    (code >= 0x61 && code <= 0x66)
  );
}

function isEscapeAt(text: string, index: number): boolean {
  return (
    index + 2 < text.length &&
    text.charCodeAt(index) === PERCENT_CODE &&
    isHexDigit(text.charCodeAt(index + 1)) &&
    isHexDigit(text.charCodeAt(index + 2))
  );
}

/*
 * How many bytes the UTF-8 character a lead byte starts holds; 1 for a byte
 * that starts none, which then fails to decode on its own.
 */
function utf8SequenceLength(leadByte: number): number {
  if (leadByte >= 0xf0 && leadByte <= 0xf4) {
    return 4;
  }
  if (leadByte >= 0xe0) {
    return leadByte <= 0xef ? 3 : 1;
  }
  if (leadByte >= 0xc2) {
    return 2;
  }
  return 1;
}

/*
 * Decodes one run of %XX escapes. A run that is no UTF-8 (a multi-byte
 * character OBI's cut left half of, a byte no UTF-8 holds) is decoded a
 * character at a time, and what still does not decode is kept as written.
 */
function decodeEscapeRun(run: string): string {
  try {
    return decodeURIComponent(run);
  } catch {
    // Read a character at a time below.
  }

  const parts: Array<string> = [];
  let index: number = 0;
  while (index < run.length) {
    const leadByte: number = parseInt(run.slice(index + 1, index + 3), 16);
    const length: number = Math.min(
      utf8SequenceLength(leadByte) * ESCAPE_LENGTH,
      run.length - index,
    );
    const character: string = run.slice(index, index + length);
    try {
      parts.push(decodeURIComponent(character));
      index += length;
    } catch {
      parts.push(run.slice(index, index + ESCAPE_LENGTH));
      index += ESCAPE_LENGTH;
    }
  }
  return parts.join("");
}

// Where `=` first is in text[start, end), or -1: never reads past `end`.
function indexOfEquals(text: string, start: number, end: number): number {
  for (let index: number = start; index < end; index++) {
    if (text.charCodeAt(index) === EQUALS_CODE) {
      return index;
    }
  }
  return -1;
}

/*
 * One component of a query string, decoded as a form is: "+" is a space,
 * %XX a byte, the bytes UTF-8. A "%" that starts no escape, or a run of
 * escapes that is no UTF-8, is kept as written. Each pass is linear: a
 * well-formed component is decoded by the runtime in one, and only one that
 * is not is read escape by escape.
 */
export function decodeQueryComponent(text: string): string {
  const spaced: string =
    text.indexOf("+") === -1 ? text : text.split("+").join(" ");
  if (spaced.indexOf("%") === -1) {
    return spaced;
  }

  try {
    return decodeURIComponent(spaced);
  } catch {
    // Some escape is malformed: read them one run at a time below.
  }

  const parts: Array<string> = [];
  let index: number = 0;
  let plainStart: number = 0;

  while (index < spaced.length) {
    if (isEscapeAt(spaced, index)) {
      parts.push(spaced.slice(plainStart, index));
      const runStart: number = index;
      while (isEscapeAt(spaced, index)) {
        index += ESCAPE_LENGTH;
      }
      parts.push(decodeEscapeRun(spaced.slice(runStart, index)));
      plainStart = index;
      continue;
    }

    index++;
  }

  parts.push(spaced.slice(plainStart));
  return parts.join("");
}

interface ClickHouseQueryParameters {
  query: string | null;
  database: string | null;
  hasClickHouseParameter: boolean;
}

/*
 * The `query` and `database` parameters (the first of each, decoded) and
 * whether a ClickHouse parameter is there. Names are decoded too, though no
 * client encodes them. One pass over the query string.
 */
function readClickHouseParameters(
  queryString: string,
): ClickHouseQueryParameters {
  const parameters: ClickHouseQueryParameters = {
    query: null,
    database: null,
    hasClickHouseParameter: false,
  };

  let start: number = queryString.charCodeAt(0) === QUESTION_MARK_CODE ? 1 : 0;
  while (start < queryString.length) {
    let end: number = queryString.indexOf("&", start);
    if (end === -1) {
      end = queryString.length;
    }

    if (end > start) {
      const equals: number = indexOfEquals(queryString, start, end);
      const name: string = decodeQueryComponent(
        queryString.slice(start, equals === -1 ? end : equals),
      );

      if (name === QUERY_PARAMETER) {
        if (parameters.query === null && equals !== -1) {
          parameters.query = decodeQueryComponent(
            queryString.slice(equals + 1, end),
          );
        }
      } else if (CLICKHOUSE_HTTP_PARAMETERS.has(name)) {
        parameters.hasClickHouseParameter = true;
        if (
          name === DATABASE_PARAMETER &&
          parameters.database === null &&
          equals !== -1
        ) {
          parameters.database = decodeQueryComponent(
            queryString.slice(equals + 1, end),
          );
        }
      }
    }

    start = end + 1;
  }

  return parameters;
}

// The query string OBI recorded: url.query, else url.full's after "?".
function readQueryString(attributes: SpanAttributeMap): string | null {
  const query: string | null = readNonEmptyString(
    attributes,
    URL_QUERY_ATTRIBUTE,
  );
  if (query !== null) {
    return query;
  }

  const full: string | null = readNonEmptyString(
    attributes,
    URL_FULL_ATTRIBUTE,
  );
  if (full === null) {
    return null;
  }
  const questionMark: number = full.indexOf("?");
  if (questionMark === -1) {
    return null;
  }
  const hash: number = full.indexOf("#", questionMark);
  return full.slice(questionMark + 1, hash === -1 ? full.length : hash);
}

// ---- reading the statement --------------------------------------------------

type SqlTokenType = "word" | "identifier" | "string" | "symbol";

interface SqlToken {
  type: SqlTokenType;
  // A word as written; a quoted identifier without its quotes.
  text: string;
}

function isWordCode(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x5f ||
    code === 0x24 ||
    code > 0x7f
  );
}

function isWhiteSpaceCode(code: number): boolean {
  return (
    code === 0x20 ||
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0d ||
    code === 0x0b ||
    code === 0x0c
  );
}

/*
 * Reads a statement a token at a time: words, quoted identifiers (`a`,
 * "a"), string literals and single symbols, with white space, line comments
 * (`--`, `#`) and block comments passed over. Every character is looked at
 * once.
 */
class SqlTokenReader {
  private readonly text: string;
  private index: number = 0;

  public constructor(text: string) {
    this.text = text;
  }

  public next(): SqlToken | null {
    this.skipWhiteSpaceAndComments();
    if (this.index >= this.text.length) {
      return null;
    }

    const start: number = this.index;
    const code: number = this.text.charCodeAt(start);

    if (isWordCode(code)) {
      while (
        this.index < this.text.length &&
        isWordCode(this.text.charCodeAt(this.index))
      ) {
        this.index++;
      }
      return { type: "word", text: this.text.slice(start, this.index) };
    }

    if (code === 0x60 || code === 0x22) {
      return { type: "identifier", text: this.readQuoted(code) };
    }

    if (code === 0x27) {
      return { type: "string", text: this.readQuoted(code) };
    }

    this.index++;
    return { type: "symbol", text: this.text.charAt(start) };
  }

  /*
   * A quoted run up to its closing quote (a doubled quote or a backslash
   * escapes one), without the quotes; to the end of the text when it never
   * closes.
   */
  private readQuoted(quote: number): string {
    const parts: Array<string> = [];
    this.index++;
    let start: number = this.index;
    while (this.index < this.text.length) {
      const code: number = this.text.charCodeAt(this.index);
      if (code === 0x5c && this.index + 1 < this.text.length) {
        parts.push(this.text.slice(start, this.index));
        start = this.index + 1;
        this.index += 2;
        continue;
      }
      if (code === quote) {
        if (this.text.charCodeAt(this.index + 1) === quote) {
          parts.push(this.text.slice(start, this.index + 1));
          this.index += 2;
          start = this.index;
          continue;
        }
        parts.push(this.text.slice(start, this.index));
        this.index++;
        return parts.join("");
      }
      this.index++;
    }
    parts.push(this.text.slice(start));
    return parts.join("");
  }

  private skipWhiteSpaceAndComments(): void {
    while (this.index < this.text.length) {
      const code: number = this.text.charCodeAt(this.index);
      if (isWhiteSpaceCode(code)) {
        this.index++;
        continue;
      }
      const nextCode: number = this.text.charCodeAt(this.index + 1);
      if ((code === 0x2d && nextCode === 0x2d) || code === 0x23) {
        const lineEnd: number = this.text.indexOf("\n", this.index);
        this.index = lineEnd === -1 ? this.text.length : lineEnd + 1;
        continue;
      }
      if (code === 0x2f && nextCode === 0x2a) {
        const commentEnd: number = this.text.indexOf("*/", this.index + 2);
        this.index = commentEnd === -1 ? this.text.length : commentEnd + 2;
        continue;
      }
      return;
    }
  }
}

function isKeyword(token: SqlToken | null, keyword: string): boolean {
  return Boolean(
    token && token.type === "word" && token.text.toUpperCase() === keyword,
  );
}

function isSymbol(token: SqlToken | null, symbol: string): boolean {
  return Boolean(token && token.type === "symbol" && token.text === symbol);
}

function isNamePart(token: SqlToken | null): token is SqlToken {
  return Boolean(
    token &&
      (token.type === "identifier" ||
        (token.type === "word" && token.text.length > 0)),
  );
}

/*
 * A table name, starting at `first`: one name or a dotted path of them
 * (`oneuptime.LogItemV3`), quotes dropped. Null for anything else: a
 * subquery, a `{name:Identifier}` parameter. With `functionsAreNoTable`, a
 * name followed by "(" is a table function (`numbers(10)`), not a table.
 */
function readTableName(
  reader: SqlTokenReader,
  first: SqlToken | null,
  functionsAreNoTable: boolean,
): string | null {
  if (!isNamePart(first)) {
    return null;
  }

  const parts: Array<string> = [first.text];
  let next: SqlToken | null = reader.next();
  while (isSymbol(next, ".")) {
    const part: SqlToken | null = reader.next();
    if (!isNamePart(part)) {
      return null;
    }
    parts.push(part.text);
    next = reader.next();
  }

  if (functionsAreNoTable && isSymbol(next, "(")) {
    return null;
  }

  const name: string = parts.join(".");
  return name.trim().length > 0 ? name : null;
}

// INSERT INTO [TABLE] <table>; INSERT INTO FUNCTION … names none.
function readInsertTable(reader: SqlTokenReader): string | null {
  if (!isKeyword(reader.next(), "INTO")) {
    return null;
  }
  let token: SqlToken | null = reader.next();
  if (isKeyword(token, "TABLE")) {
    token = reader.next();
  }
  if (isKeyword(token, "FUNCTION")) {
    return null;
  }
  return readTableName(reader, token, false);
}

// The table after the statement's first FROM outside parentheses.
function readFromTable(reader: SqlTokenReader): string | null {
  let depth: number = 0;
  for (
    let token: SqlToken | null = reader.next();
    token !== null;
    token = reader.next()
  ) {
    if (isSymbol(token, "(")) {
      depth++;
    } else if (isSymbol(token, ")")) {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && isKeyword(token, "FROM")) {
      return readTableName(reader, reader.next(), true);
    }
  }
  return null;
}

/*
 * The statement's first keyword (upper-cased) and the table it names, or
 * null when it starts with no statement keyword.
 */
export function readClickHouseStatement(
  queryText: string,
): { operationName: string; collectionName: string | null } | null {
  const reader: SqlTokenReader = new SqlTokenReader(queryText);
  let token: SqlToken | null = reader.next();
  while (isSymbol(token, "(")) {
    token = reader.next();
  }
  if (!token || token.type !== "word") {
    return null;
  }

  const operationName: string = token.text.toUpperCase();
  if (!CLICKHOUSE_STATEMENT_KEYWORDS.has(operationName)) {
    return null;
  }

  let collectionName: string | null = null;
  if (operationName === "INSERT") {
    collectionName = readInsertTable(reader);
  } else if (FROM_TABLE_OPERATIONS.has(operationName)) {
    collectionName = readFromTable(reader);
  }

  return { operationName, collectionName };
}

// ---- the rule ---------------------------------------------------------------

/**
 * The ClickHouse statement an OBI span of an HTTP call carries, or null when
 * the span is not such a call (see the rule above). Returns after a property
 * read or two for a span that is not OBI's, not CLIENT or not HTTP.
 */
export function readObiClickHouseHttpQuery(data: {
  kind: SpanKind;
  attributes: SpanAttributeMap | null | undefined;
}): ObiClickHouseQuery | null {
  const attributes: SpanAttributeMap | null | undefined = data.attributes;
  if (data.kind !== CLIENT_SPAN_KIND || !attributes || !isObiSpan(attributes)) {
    return null;
  }

  const method: unknown = attributes[HTTP_REQUEST_METHOD_ATTRIBUTE];
  if (
    typeof method !== "string" ||
    !CLICKHOUSE_HTTP_METHODS.has(method) ||
    hasAnyValue(attributes, PROTOCOL_ATTRIBUTES)
  ) {
    return null;
  }

  const queryString: string | null = readQueryString(attributes);
  if (queryString === null) {
    return null;
  }

  const parameters: ClickHouseQueryParameters =
    readClickHouseParameters(queryString);
  if (
    !parameters.hasClickHouseParameter ||
    parameters.query === null ||
    parameters.query.trim().length === 0
  ) {
    return null;
  }

  const statement: {
    operationName: string;
    collectionName: string | null;
  } | null = readClickHouseStatement(parameters.query);
  if (!statement) {
    return null;
  }

  const namespace: string | null =
    parameters.database !== null && parameters.database.trim().length > 0
      ? parameters.database
      : null;

  return {
    queryText: parameters.query,
    operationName: statement.operationName,
    collectionName: statement.collectionName,
    namespace: namespace,
  };
}

/*
 * OTel's database span name: `{db.operation.name} {db.collection.name}`, or
 * the operation alone when no table was read.
 */
export function getObiClickHouseSpanName(query: ObiClickHouseQuery): string {
  return query.collectionName
    ? `${query.operationName} ${query.collectionName}`
    : query.operationName;
}

/**
 * Gives an OBI span of a ClickHouse HTTP call its database attributes, and
 * returns the name it is stored under; null (and nothing changed) for any
 * other span.
 */
export function applyObiClickHouseHttpSpan(data: {
  kind: SpanKind;
  attributes: MutableSpanAttributeMap | null | undefined;
}): string | null {
  const query: ObiClickHouseQuery | null = readObiClickHouseHttpQuery(data);
  if (!query || !data.attributes) {
    return null;
  }

  const attributes: MutableSpanAttributeMap = data.attributes;
  attributes[DB_SYSTEM_NAME_ATTRIBUTE] = CLICKHOUSE_DB_SYSTEM_NAME;
  if (query.namespace !== null) {
    attributes[DB_NAMESPACE_ATTRIBUTE] = query.namespace;
  }
  attributes[DB_QUERY_TEXT_ATTRIBUTE] = query.queryText;
  attributes[DB_OPERATION_NAME_ATTRIBUTE] = query.operationName;
  if (query.collectionName !== null) {
    attributes[DB_COLLECTION_NAME_ATTRIBUTE] = query.collectionName;
  }

  return getObiClickHouseSpanName(query);
}
