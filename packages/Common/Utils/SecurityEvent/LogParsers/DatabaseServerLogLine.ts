import { MAX_JSON_LINE_LENGTH } from "./SecurityLogLine";

/*
 * A DATABASE SERVER'S OWN LOG LINE: ClickHouse's or PostgreSQL's.
 *
 * A database server writes down the queries it runs. ClickHouse logs a
 * failed query's whole text with its parameters filled in ("(in query:
 * SELECT ...)"), and PostgreSQL logs the statement that failed
 * ("STATEMENT:  SELECT ..."). A query holds whatever its client sent: a
 * security tool's search for "${jndi:" and "union select", an
 * application's own UNION ALL SELECT, someone's search for a sign-in line.
 * None of it is a request the server served, a sign-in to it or a command
 * run on it. So no parser reads such a line for a security record
 * (SecurityLogParser). All a parser would find in it is somebody's query,
 * and the server's version number ("26.7.38.18") would read as the address
 * the attack came from (issue #6419).
 *
 * A line is one only when it STARTS the way the server starts every line
 * it writes:
 *
 *   ClickHouse:  2026.11.08 10:00:00.123456 [ 1234 ] {query-id} <Error> executeQuery: ...
 *   PostgreSQL:  2026-11-08 10:00:00.123 UTC [1234] ERROR:  ...
 *
 * or when it is one of their JSON records, holding nothing but the
 * server's own fields: ClickHouse's json log format, PostgreSQL's jsonlog,
 * CloudNativePG's. A container runtime's prefix ("2026-11-08T10:00:00.123Z
 * stderr F ") is read past. An access log line starts with its client and
 * an application's line with the application's own prefix. So a request
 * that holds these words, even one that spells a whole server line in its
 * URL, is read as before. PostgreSQL's prefix is its operator's to choose,
 * so its line is one only with a zone after the time ("UTC") and the
 * severity before anything a prefix never writes - a quote, a brace, a
 * query string: an application's line that starts with a time and then
 * holds a client's "ERROR:  ${jndi:..." is read as before too.
 *
 * Read with indexOf and character checks, never a regular expression with
 * a repeat, as every parser reads a line (SecurityLogLine).
 */

// The furthest past the zone PostgreSQL's log_line_prefix is looked through for the severity.
const MAX_POSTGRES_PREFIX_LENGTH: number = 160;

// The longest query id ClickHouse's line is read across.
const MAX_CLICKHOUSE_QUERY_ID_LENGTH: number = 256;

const CLICKHOUSE_LEVELS: ReadonlyArray<string> = [
  "Fatal",
  "Critical",
  "Error",
  "Warning",
  "Notice",
  "Information",
  "Debug",
  "Trace",
  "Test",
];

// PostgreSQL's severities, as it writes them before its colon and two spaces.
const POSTGRES_SEVERITIES: ReadonlyArray<string> = [
  "DEBUG",
  "DEBUG1",
  "DEBUG2",
  "DEBUG3",
  "DEBUG4",
  "DEBUG5",
  "LOG",
  "INFO",
  "NOTICE",
  "WARNING",
  "ERROR",
  "FATAL",
  "PANIC",
  "DETAIL",
  "HINT",
  "QUERY",
  "CONTEXT",
  "LOCATION",
  "STATEMENT",
];

// The fields of ClickHouse's json log format (<formatting><type>json</type>).
const CLICKHOUSE_JSON_FIELDS: ReadonlyArray<string> = [
  "date_time_utc",
  "date_time",
  "thread_name",
  "thread_id",
  "level",
  "query_id",
  "logger_name",
  "message",
  "source_file",
  "source_line",
];

// The fields of PostgreSQL's jsonlog (log_destination = 'jsonlog').
const POSTGRES_JSON_FIELDS: ReadonlyArray<string> = [
  "timestamp",
  "user",
  "dbname",
  "pid",
  "remote_host",
  "remote_port",
  "session_id",
  "line_num",
  "ps",
  "session_start",
  "vxid",
  "txid",
  "error_severity",
  "state_code",
  "message",
  "detail",
  "hint",
  "internal_query",
  "internal_position",
  "context",
  "statement",
  "cursor_position",
  "func_name",
  "file_name",
  "file_line_num",
  "application_name",
  "backend_type",
  "leader_pid",
  "query_id",
];

// The fields of a CloudNativePG instance's own record, around PostgreSQL's.
const CLOUDNATIVE_PG_FIELDS: ReadonlyArray<string> = [
  "level",
  "ts",
  "logger",
  "msg",
  "logging_pod",
  "record",
];

// The CloudNativePG loggers that carry PostgreSQL's own lines.
const CLOUDNATIVE_PG_LOGGERS: ReadonlyArray<string> = ["postgres", "pgaudit"];

function isDigitAt(text: string, index: number): boolean {
  const code: number = text.charCodeAt(index);

  return code >= 48 && code <= 57;
}

function isWordCharacterAt(text: string, index: number): boolean {
  const code: number = text.charCodeAt(index);

  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95
  );
}

// The index past `count` digits from `from`, else -1.
function readDigits(text: string, from: number, count: number): number {
  for (let index: number = from; index < from + count; index++) {
    if (!isDigitAt(text, index)) {
      return -1;
    }
  }

  return from + count;
}

// The index past one to `max` digits from `from`, else -1.
function readSomeDigits(text: string, from: number, max: number): number {
  let index: number = from;

  while (index < text.length && index - from < max && isDigitAt(text, index)) {
    index++;
  }

  return index > from ? index : -1;
}

/*
 * The index past a "YYYY<sep>MM<sep>DD hh:mm:ss" at `from`, else -1:
 * ClickHouse separates its date with dots, PostgreSQL with dashes.
 */
function readDateTime(text: string, from: number, separator: string): number {
  // Each part: the character before it, and how many digits it has.
  const parts: ReadonlyArray<{ before: string; digits: number }> = [
    { before: separator, digits: 2 },
    { before: separator, digits: 2 },
    { before: " ", digits: 2 },
    { before: ":", digits: 2 },
    { before: ":", digits: 2 },
  ];
  let index: number = readDigits(text, from, 4);

  for (const part of parts) {
    if (index === -1 || text[index] !== part.before) {
      return -1;
    }

    index = readDigits(text, index + 1, part.digits);
  }

  return index;
}

/*
 * Where the line itself starts, past a container runtime's prefix when it
 * has one: "2026-11-08T10:00:00.123456789Z stderr F " (CRI).
 */
export function skipContainerRuntimePrefix(text: string): number {
  if (!isDigitAt(text, 0) || text[10] !== "T") {
    return 0;
  }

  const timeEnd: number = text.indexOf(" ");

  if (timeEnd === -1 || timeEnd > 40) {
    return 0;
  }

  const stream: string = text.slice(timeEnd + 1, timeEnd + 8);

  if (stream !== "stdout " && stream !== "stderr ") {
    return 0;
  }

  const tagStart: number = timeEnd + 8;
  const tag: string = text[tagStart] || "";

  if ((tag !== "F" && tag !== "P") || text[tagStart + 1] !== " ") {
    return 0;
  }

  return tagStart + 2;
}

/*
 * "2026.11.08 10:00:00.123456 [ 1234 ] {query-id} <Error> logger: ..." -
 * ClickHouse's (and ClickHouse Keeper's) line. Versions before query ids
 * were logged leave the braces out.
 */
export function isClickHouseServerLine(text: string, from: number): boolean {
  let index: number = readDateTime(text, from, ".");

  if (index === -1) {
    return false;
  }

  if (text[index] === ".") {
    index = readSomeDigits(text, index + 1, 9);

    if (index === -1) {
      return false;
    }
  }

  if (!text.startsWith(" [", index)) {
    return false;
  }

  index += 2;

  while (text[index] === " " && index < text.length) {
    index++;
  }

  index = readSomeDigits(text, index, 20);

  if (index === -1) {
    return false;
  }

  while (text[index] === " " && index < text.length) {
    index++;
  }

  if (!text.startsWith("] ", index)) {
    return false;
  }

  index += 2;

  if (text[index] === "{") {
    const queryIdEnd: number = text.indexOf("} ", index);

    if (
      queryIdEnd === -1 ||
      queryIdEnd - index > MAX_CLICKHOUSE_QUERY_ID_LENGTH
    ) {
      return false;
    }

    index = queryIdEnd + 2;
  }

  if (text[index] !== "<") {
    return false;
  }

  const levelEnd: number = text.indexOf("> ", index);

  if (levelEnd === -1 || levelEnd - index > 16) {
    return false;
  }

  return CLICKHOUSE_LEVELS.includes(text.slice(index + 1, levelEnd));
}

/*
 * The zone after the time ("UTC", "CEST", "+05", "-0330"): every escape of
 * log_line_prefix that writes a time (%m, %t, %s) writes its zone after
 * it, and an application's own line rarely does. Read from a list, so a
 * syslog host name ("PROD") or a log level ("INFO") is never one.
 */
const POSTGRES_ZONE_NAMES: ReadonlyArray<string> = [
  "UTC",
  "GMT",
  "WET",
  "WEST",
  "BST",
  "IST",
  "CET",
  "CEST",
  "MET",
  "MEST",
  "EET",
  "EEST",
  "MSK",
  "SAST",
  "WAT",
  "CAT",
  "EAT",
  "PKT",
  "WIB",
  "WITA",
  "WIT",
  "ICT",
  "HKT",
  "SGT",
  "PHT",
  "PST",
  "PDT",
  "MST",
  "MDT",
  "CST",
  "CDT",
  "EST",
  "EDT",
  "AST",
  "ADT",
  "NST",
  "NDT",
  "AKST",
  "AKDT",
  "HST",
  "JST",
  "KST",
  "AWST",
  "ACST",
  "ACDT",
  "AEST",
  "AEDT",
  "NZST",
  "NZDT",
];

/*
 * What a log_line_prefix never writes but an application's line about a
 * request usually holds before its client's text: quotes, braces, a query
 * string. The severity must come before any of them.
 */
const NOT_IN_POSTGRES_PREFIX: string = "\"'`${}<>\\?&;%";

// The index past the zone at `from`, else -1.
function readPostgresZone(text: string, from: number): number {
  if (text[from] === "+" || text[from] === "-") {
    const end: number = readSomeDigits(text, from + 1, 4);

    return end === -1 || isWordCharacterAt(text, end) ? -1 : end;
  }

  let end: number = from;

  while (end - from < 4 && end < text.length && isWordCharacterAt(text, end)) {
    end++;
  }

  if (isWordCharacterAt(text, end)) {
    return -1;
  }

  return POSTGRES_ZONE_NAMES.includes(text.slice(from, end)) ? end : -1;
}

/*
 * "2026-11-08 10:00:00.123 UTC [1234] ERROR:  ..." - PostgreSQL's line,
 * whatever else its log_line_prefix puts between the zone and the severity
 * ("[1234] user@db ", RDS's ":10.0.0.5(5432):user@db:[1234]:", Cloud
 * SQL's "[1234]: [1-1] db=app,user=app "). The severity, and the two
 * spaces PostgreSQL always writes after its colon, end the prefix.
 */
export function isPostgresServerLine(text: string, from: number): boolean {
  let index: number = readDateTime(text, from, "-");

  if (index === -1) {
    return false;
  }

  if (text[index] === ".") {
    index = readSomeDigits(text, index + 1, 6);

    if (index === -1) {
      return false;
    }
  }

  if (text[index] !== " ") {
    return false;
  }

  index = readPostgresZone(text, index + 1);

  if (index === -1) {
    return false;
  }

  let prefixEnd: number = Math.min(
    text.length,
    index + MAX_POSTGRES_PREFIX_LENGTH,
  );

  for (let at: number = index; at < prefixEnd; at++) {
    if (NOT_IN_POSTGRES_PREFIX.includes(text[at]!)) {
      prefixEnd = at;
      break;
    }
  }

  const prefix: string = text.slice(0, prefixEnd);
  let colon: number = prefix.indexOf(":  ", index);

  while (colon !== -1) {
    let wordStart: number = colon;

    while (wordStart > index && isWordCharacterAt(prefix, wordStart - 1)) {
      wordStart--;
    }

    if (POSTGRES_SEVERITIES.includes(prefix.slice(wordStart, colon))) {
      return true;
    }

    colon = prefix.indexOf(":  ", colon + 1);
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Whether a record holds `required` and no field but `allowed`.
function holdsOnlyFields(
  record: Record<string, unknown>,
  allowed: ReadonlyArray<string>,
  required: ReadonlyArray<string>,
): boolean {
  for (const field of required) {
    if (!(field in record)) {
      return false;
    }
  }

  return Object.keys(record).every((field: string): boolean => {
    return allowed.includes(field);
  });
}

/*
 * A database server's JSON record: every field one the server writes,
 * which an application's log line - holding its own fields too, whatever
 * a request put beside them - never is.
 */
export function isDatabaseServerJsonRecord(text: string): boolean {
  if (!text.startsWith("{") || text.length > MAX_JSON_LINE_LENGTH) {
    return false;
  }

  if (
    text.indexOf('"logger_name"') === -1 &&
    text.indexOf('"error_severity"') === -1
  ) {
    return false;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }

  if (!isRecord(parsed)) {
    return false;
  }

  if (
    typeof parsed["logger_name"] === "string" &&
    holdsOnlyFields(parsed, CLICKHOUSE_JSON_FIELDS, [
      "logger_name",
      "query_id",
      "thread_id",
      "source_file",
    ])
  ) {
    return true;
  }

  if (
    typeof parsed["error_severity"] === "string" &&
    holdsOnlyFields(parsed, POSTGRES_JSON_FIELDS, [
      "error_severity",
      "session_id",
      "backend_type",
    ])
  ) {
    return true;
  }

  const record: unknown = parsed["record"];

  return (
    typeof parsed["logger"] === "string" &&
    CLOUDNATIVE_PG_LOGGERS.includes(parsed["logger"]) &&
    isRecord(record) &&
    typeof record["error_severity"] === "string" &&
    holdsOnlyFields(parsed, CLOUDNATIVE_PG_FIELDS, ["logger", "record"])
  );
}

// Whether a log line is a database server's own (see the top of this file).
export function isDatabaseServerLogLine(body: string): boolean {
  const text: string = (body || "").trimStart();

  if (!text) {
    return false;
  }

  const from: number = skipContainerRuntimePrefix(text);

  if (text[from] === "{") {
    return isDatabaseServerJsonRecord(from === 0 ? text : text.slice(from));
  }

  return isClickHouseServerLine(text, from) || isPostgresServerLine(text, from);
}
