import OpenTelemetryAPI, {
  Attributes,
  Span,
  SpanKind,
  SpanStatusCode,
  Tracer,
} from "@opentelemetry/api";
import Telemetry from "../Telemetry";

/*
 * CLIENT spans for OneUptime's own calls to its datastores - Postgres
 * (PostgresQuerySpans), Valkey (RedisCommandSpans) and ClickHouse
 * (ClickhouseQuerySpans) - so that a request's or a job's trace shows the
 * statements and commands it waited on. Before them a trace held only
 * @CaptureSpan frames, and every millisecond spent waiting on a datastore
 * showed as "self time" of whichever method awaited it.
 *
 * Placed by hand on the clients OneUptime owns rather than through the
 * OpenTelemetry contrib instrumentations, because:
 *
 *   - those patch a module as it is first required, and every OneUptime
 *     process has required ioredis, typeorm and @clickhouse/client before
 *     Telemetry.init runs (App/Index.ts calls it from init(), after its
 *     imports), so they would see nothing;
 *   - instrumentation-pg patches pg.Client itself, which would also trace
 *     what the probe's database monitors and the Postgres data sources send
 *     to customers' databases, their SQL included;
 *   - ClickHouse has none: its client speaks HTTP, and an HTTP
 *     instrumentation injects `traceparent` into every outgoing request,
 *     customer-bound ones included (TraceContextPropagation says why those
 *     go out exactly as configured).
 *
 * Every span made here:
 *
 *   - exists only inside a trace, and only when spans are exported. A call
 *     made outside every span (a timer, a health check) would be a trace of
 *     one span: volume, not insight.
 *   - follows the database semantic conventions: named "<operation>
 *     <collection>" ("SELECT Monitor", "GET"), with db.system.name,
 *     db.namespace, db.operation.name, db.collection.name, db.query.text,
 *     server.address and server.port - the attributes trace ingest reads to
 *     find a service's databases (DatabaseTelemetryResolver).
 *   - never carries an "exception" event. Ingest makes an Issue of every such
 *     event, and a datastore's error is its caller's to report: the
 *     @CaptureSpan frame it reaches records it, classified. A failure here is
 *     ERROR status, error.type and the database's own status code
 *     (db.response.status_code: a SQLSTATE, a ClickHouse error code, a Redis
 *     error prefix).
 */

const TRACER_NAME: string = "oneuptime-db";

/*
 * Statements longer than this keep their start and their end: the start says
 * what is read or written, the end holds the WHERE / ORDER BY / LIMIT, and a
 * TypeORM SELECT's column list in between can run to kilobytes. The same cap
 * as the `db.statement` Telemetry records on a failed query.
 */
export const MAX_QUERY_TEXT_LENGTH: number = 2000;
const QUERY_TEXT_ELISION: string = " … ";

/*
 * How far into a statement its operation and main table are looked for. A
 * bulk INSERT's VALUES or a long IN list can make a statement megabytes long;
 * the table is always named well before this.
 */
export const MAX_SUMMARY_SCAN_LENGTH: number = 64 * 1024;

// The longest table name kept, quotes and schema included.
const MAX_COLLECTION_NAME_LENGTH: number = 256;

// A status message is a summary; the statement is in db.query.text.
const MAX_STATUS_MESSAGE_LENGTH: number = 500;

export enum DatabaseSystemName {
  Postgres = "postgresql",
  Redis = "redis",
  ClickHouse = "clickhouse",
}

export interface DatabaseServer {
  address?: string | undefined;
  port?: number | undefined;
  // The database: its name for Postgres and ClickHouse, its index for Redis.
  namespace?: string | undefined;
}

export interface DatabaseCall {
  system: DatabaseSystemName;
  server: DatabaseServer;
  operation: string | null;
  collection?: string | null | undefined;
  queryText?: string | undefined;
  // The number of commands in a pipeline or transaction sent as one.
  batchSize?: number | undefined;
}

export interface StatementSummary {
  operation: string | null;
  collection: string | null;
}

export interface DatabaseErrorDescription {
  type: string;
  statusCode: string | null;
}

/*
 * Whether a datastore call made now gets a span: spans are exported, and the
 * call is part of a trace.
 */
export function isTracingDatabaseCalls(): boolean {
  if (!Telemetry.isSpanExportEnabled()) {
    return false;
  }

  return (
    OpenTelemetryAPI.trace.getSpan(OpenTelemetryAPI.context.active()) !==
    undefined
  );
}

function getTracer(): Tracer {
  return OpenTelemetryAPI.trace.getTracer(TRACER_NAME);
}

/*
 * A CLIENT span for one call, a child of the active span. Not made active
 * itself: nothing the call does is traced inside it. Callers check
 * isTracingDatabaseCalls first, so that a statement is only summarized when
 * a span will carry the summary.
 */
export function startDatabaseClientSpan(call: DatabaseCall): Span {
  const summary: string = call.operation
    ? call.collection
      ? `${call.operation} ${call.collection}`
      : call.operation
    : call.system;

  const attributes: Attributes = {
    "db.system.name": call.system,
  };

  if (call.server.namespace) {
    attributes["db.namespace"] = call.server.namespace;
  }

  if (call.operation) {
    attributes["db.operation.name"] = call.operation;
    attributes["db.query.summary"] = summary;
  }

  if (call.collection) {
    attributes["db.collection.name"] = call.collection;
  }

  if (call.queryText) {
    attributes["db.query.text"] = formatQueryText(call.queryText);
  }

  if (call.batchSize !== undefined && call.batchSize > 1) {
    attributes["db.operation.batch.size"] = call.batchSize;
  }

  if (call.server.address) {
    attributes["server.address"] = call.server.address;
  }

  if (call.server.port) {
    attributes["server.port"] = call.server.port;
  }

  return getTracer().startSpan(summary, {
    kind: SpanKind.CLIENT,
    attributes: attributes,
  });
}

/*
 * End a call's span: OK, or ERROR with what the database said. Never throws -
 * it runs on the path that hands a query's error back to its caller.
 */
export function endDatabaseClientSpan(
  span: Span,
  system: DatabaseSystemName,
  error?: unknown,
): void {
  try {
    if (error !== undefined) {
      const described: DatabaseErrorDescription = describeDatabaseError(
        system,
        error,
      );

      span.setAttribute("error.type", described.type);

      if (described.statusCode) {
        span.setAttribute("db.response.status_code", described.statusCode);
      }

      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: truncate(messageOf(error), MAX_STATUS_MESSAGE_LENGTH),
      });
    }
  } catch {
    // An unreadable error still ends its span below.
  }

  span.end();
}

/*
 * Run a promise-returning call inside a span when one is due. The caller
 * gets a promise that settles as the call's did, so an error it never
 * handles is still reported as unhandled.
 */
export function traceDatabaseCall<T>(
  describe: () => DatabaseCall,
  run: () => Promise<T>,
): Promise<T> {
  if (!isTracingDatabaseCalls()) {
    return run();
  }

  let call: DatabaseCall;

  try {
    call = describe();
  } catch {
    // A call that cannot be described is still made, untraced.
    return run();
  }

  const span: Span = startDatabaseClientSpan(call);

  let result: Promise<T>;

  try {
    result = run();
  } catch (error) {
    endDatabaseClientSpan(span, call.system, error);
    throw error;
  }

  return Promise.resolve(result).then(
    (value: T) => {
      endDatabaseClientSpan(span, call.system);
      return value;
    },
    (error: unknown) => {
      endDatabaseClientSpan(span, call.system, error);
      throw error;
    },
  );
}

// The statement as a span carries it: whole, or its start and its end.
export function formatQueryText(text: string): string {
  if (text.length <= MAX_QUERY_TEXT_LENGTH) {
    return text;
  }

  const kept: number = Math.floor(
    (MAX_QUERY_TEXT_LENGTH - QUERY_TEXT_ELISION.length) / 2,
  );

  return (
    text.slice(0, kept) + QUERY_TEXT_ELISION + text.slice(text.length - kept)
  );
}

/*
 * A statement's operation ("SELECT", "INSERT", "START TRANSACTION") and the
 * table it reads or writes, for the span's name. Read with a single pass of
 * index arithmetic over at most MAX_SUMMARY_SCAN_LENGTH characters - never a
 * regular expression, since statements can be megabytes long (AGENTS.md,
 * "Megabyte-long values"). Strings, quoted identifiers, comments and
 * parenthesised subqueries are stepped over, so the table is the statement's
 * own: `SELECT (SELECT 1 FROM "A") FROM "B"` reads B. Anything it cannot read
 * is null, never an error.
 */
export function summarizeStatement(text: string): StatementSummary {
  if (typeof text !== "string" || text.length === 0) {
    return { operation: null, collection: null };
  }

  const end: number = Math.min(text.length, MAX_SUMMARY_SCAN_LENGTH);
  const scanner: StatementScanner = new StatementScanner(text, end);

  scanner.skipInsignificant(true);
  const firstWord: string | null = scanner.readWord();

  if (!firstWord) {
    return { operation: null, collection: null };
  }

  let operation: string = firstWord.toUpperCase();

  if (operation === "START") {
    scanner.skipInsignificant(false);
    const secondWord: string | null = scanner.readWord();
    if (secondWord && secondWord.toUpperCase() === "TRANSACTION") {
      operation = "START TRANSACTION";
    }
  }

  let collection: string | null = null;

  if (operation === "SELECT" || operation === "DELETE") {
    collection = scanner.findTopLevelKeyword("FROM")
      ? scanner.readIdentifier()
      : null;
  } else if (operation === "INSERT") {
    collection = scanner.findTopLevelKeyword("INTO")
      ? scanner.readIdentifier()
      : null;
  } else if (operation === "UPDATE") {
    scanner.skipInsignificant(false);
    const position: number = scanner.position;
    const word: string | null = scanner.readWord();
    if (!word || word.toUpperCase() !== "ONLY") {
      scanner.position = position;
    }
    collection = scanner.readIdentifier();
  }

  return { operation: operation, collection: collection };
}

/*
 * What a datastore's error is called on its span: error.type, and the
 * status code the database answered with when it answered at all. A
 * connection that failed has no status code, only its error's name.
 */
export function describeDatabaseError(
  system: DatabaseSystemName,
  error: unknown,
): DatabaseErrorDescription {
  const fallbackType: string = typeNameOf(error);

  if (!error || typeof error !== "object") {
    return { type: fallbackType, statusCode: null };
  }

  // TypeORM wraps the driver's error in a QueryFailedError.
  const driverError: unknown = (error as { driverError?: unknown }).driverError;
  const source: Record<string, unknown> = (
    driverError && typeof driverError === "object" ? driverError : error
  ) as Record<string, unknown>;
  const code: unknown = source["code"];

  if (system === DatabaseSystemName.Postgres) {
    // A SQLSTATE is five characters; anything else came from the socket.
    if (typeof code === "string" && code.length === 5) {
      return { type: code, statusCode: code };
    }
    return {
      type: isDescriptiveCode(code) ? (code as string) : fallbackType,
      statusCode: null,
    };
  }

  if (system === DatabaseSystemName.ClickHouse) {
    const type: unknown = source["type"];
    if (
      (typeof code === "string" && code.length > 0) ||
      typeof code === "number"
    ) {
      const statusCode: string = String(code);
      return {
        type: typeof type === "string" && type.length > 0 ? type : statusCode,
        statusCode: statusCode,
      };
    }
    return {
      type: isDescriptiveCode(code) ? (code as string) : fallbackType,
      statusCode: null,
    };
  }

  // Redis answers an error with its kind first: "WRONGTYPE Operation...".
  const prefix: string | null = redisErrorPrefix(messageOf(error));
  if (prefix) {
    return { type: prefix, statusCode: prefix };
  }

  return {
    type: isDescriptiveCode(code) ? (code as string) : fallbackType,
    statusCode: null,
  };
}

// "ECONNRESET" says something; a bare number or an empty string does not.
function isDescriptiveCode(code: unknown): boolean {
  if (typeof code !== "string" || code.length === 0 || code.length > 64) {
    return false;
  }

  for (let index: number = 0; index < code.length; index++) {
    const character: number = code.charCodeAt(index);
    const isUpperCaseLetter: boolean = character >= 65 && character <= 90;
    const isDigit: boolean = character >= 48 && character <= 57;
    const isUnderscore: boolean = character === 95;
    if (!isUpperCaseLetter && !isDigit && !isUnderscore) {
      return false;
    }
  }

  return !isAllDigits(code);
}

function isAllDigits(value: string): boolean {
  for (let index: number = 0; index < value.length; index++) {
    const character: number = value.charCodeAt(index);
    if (character < 48 || character > 57) {
      return false;
    }
  }
  return value.length > 0;
}

// The upper-case word a Redis error reply starts with, if it starts with one.
function redisErrorPrefix(message: string): string | null {
  let length: number = 0;

  while (length < message.length && length <= 32) {
    const character: number = message.charCodeAt(length);
    if (character < 65 || character > 90) {
      break;
    }
    length++;
  }

  if (length < 2 || length > 32) {
    return null;
  }

  // The word must be the whole first token.
  if (length < message.length && message.charCodeAt(length) !== 32) {
    return null;
  }

  return message.slice(0, length);
}

function typeNameOf(error: unknown): string {
  try {
    if (error && typeof error === "object") {
      const name: unknown = (error as { name?: unknown }).name;
      if (typeof name === "string" && name.length > 0 && name !== "Error") {
        return name;
      }
      const constructorName: unknown = (
        error as { constructor?: { name?: unknown } }
      ).constructor?.name;
      if (
        typeof constructorName === "string" &&
        constructorName.length > 0 &&
        constructorName !== "Object"
      ) {
        return constructorName;
      }
    }
  } catch {
    // An exotic thrown value; the generic name below will do.
  }

  return "Error";
}

function messageOf(error: unknown): string {
  try {
    if (error && typeof error === "object") {
      const message: unknown = (error as { message?: unknown }).message;
      if (typeof message === "string") {
        return message;
      }
    }
    if (typeof error === "string") {
      return error;
    }
  } catch {
    // Fall through to the empty message.
  }

  return "";
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

const SINGLE_QUOTE: number = 39;
const DOUBLE_QUOTE: number = 34;
const BACKTICK: number = 96;
const OPEN_PARENTHESIS: number = 40;
const CLOSE_PARENTHESIS: number = 41;
const DASH: number = 45;
const SLASH: number = 47;
const ASTERISK: number = 42;
const DOT: number = 46;
const NEW_LINE: number = 10;

function isWordCharacter(character: number): boolean {
  return (
    (character >= 65 && character <= 90) ||
    (character >= 97 && character <= 122) ||
    character === 95
  );
}

function isIdentifierCharacter(character: number): boolean {
  return (
    isWordCharacter(character) ||
    (character >= 48 && character <= 57) ||
    character === 36
  );
}

function isWhitespace(character: number): boolean {
  return (
    character === 32 ||
    character === 9 ||
    character === NEW_LINE ||
    character === 13 ||
    character === 12
  );
}

/*
 * A cursor over the first `end` characters of a statement. Every method
 * moves forward only, so a summary costs one pass at most.
 */
class StatementScanner {
  public position: number = 0;

  public constructor(
    private readonly text: string,
    private readonly end: number,
  ) {}

  // Whitespace and comments - and, at the statement's start, "(".
  public skipInsignificant(skipParentheses: boolean): void {
    while (this.position < this.end) {
      const character: number = this.text.charCodeAt(this.position);

      if (
        isWhitespace(character) ||
        (skipParentheses && character === OPEN_PARENTHESIS)
      ) {
        this.position++;
      } else if (!this.skipComment()) {
        return;
      }
    }
  }

  public readWord(): string | null {
    const start: number = this.position;

    while (
      this.position < this.end &&
      isWordCharacter(this.text.charCodeAt(this.position))
    ) {
      this.position++;
    }

    return this.position > start ? this.text.slice(start, this.position) : null;
  }

  /*
   * Move just past the first occurrence of `keyword` that is a word of the
   * statement itself: not inside a string, a quoted identifier, a comment or
   * parentheses. False when there is none within the scanned length.
   */
  public findTopLevelKeyword(keyword: string): boolean {
    let depth: number = 0;

    while (this.position < this.end) {
      const character: number = this.text.charCodeAt(this.position);

      if (
        character === SINGLE_QUOTE ||
        character === DOUBLE_QUOTE ||
        character === BACKTICK
      ) {
        this.skipQuoted(character);
      } else if (this.skipComment()) {
        continue;
      } else if (character === OPEN_PARENTHESIS) {
        depth++;
        this.position++;
      } else if (character === CLOSE_PARENTHESIS) {
        depth = Math.max(0, depth - 1);
        this.position++;
      } else if (isIdentifierCharacter(character)) {
        const start: number = this.position;
        while (
          this.position < this.end &&
          isIdentifierCharacter(this.text.charCodeAt(this.position))
        ) {
          this.position++;
        }
        if (
          depth === 0 &&
          this.position - start === keyword.length &&
          this.text.slice(start, this.position).toUpperCase() === keyword
        ) {
          return true;
        }
      } else {
        this.position++;
      }
    }

    return false;
  }

  /*
   * A table name, schema-qualified or not, with its quotes taken off:
   * `"public"."Monitor"` reads public.Monitor. Null when what follows is not
   * a name (a subquery, a function call's parenthesis, the end).
   */
  public readIdentifier(): string | null {
    this.skipInsignificant(false);

    const parts: Array<string> = [];
    let length: number = 0;

    while (this.position < this.end) {
      const character: number = this.text.charCodeAt(this.position);
      let part: string | null = null;

      if (character === DOUBLE_QUOTE || character === BACKTICK) {
        const start: number = this.position + 1;
        this.skipQuoted(character);
        // The closing quote is gone; a doubled quote inside stays doubled.
        part = this.text.slice(start, Math.max(start, this.position - 1));
      } else if (isIdentifierCharacter(character)) {
        const start: number = this.position;
        while (
          this.position < this.end &&
          isIdentifierCharacter(this.text.charCodeAt(this.position))
        ) {
          this.position++;
        }
        part = this.text.slice(start, this.position);
      }

      if (!part) {
        break;
      }

      parts.push(part);
      length += part.length + 1;

      if (length > MAX_COLLECTION_NAME_LENGTH) {
        return null;
      }

      if (
        this.position < this.end &&
        this.text.charCodeAt(this.position) === DOT
      ) {
        this.position++;
        continue;
      }

      break;
    }

    return parts.length > 0 ? parts.join(".") : null;
  }

  // Past a quoted run that starts here; a doubled quote is an escaped one.
  private skipQuoted(quote: number): void {
    this.position++;

    while (this.position < this.end) {
      const character: number = this.text.charCodeAt(this.position);
      this.position++;

      if (character === quote) {
        if (
          this.position < this.end &&
          this.text.charCodeAt(this.position) === quote
        ) {
          this.position++;
          continue;
        }
        return;
      }
    }
  }

  // Past a comment that starts here, if one does.
  private skipComment(): boolean {
    if (this.position + 1 >= this.end) {
      return false;
    }

    const character: number = this.text.charCodeAt(this.position);
    const next: number = this.text.charCodeAt(this.position + 1);

    if (character === DASH && next === DASH) {
      const lineEnd: number = this.text.indexOf("\n", this.position + 2);
      this.position =
        lineEnd === -1 || lineEnd >= this.end ? this.end : lineEnd + 1;
      return true;
    }

    if (character === SLASH && next === ASTERISK) {
      const commentEnd: number = this.text.indexOf("*/", this.position + 2);
      this.position =
        commentEnd === -1 || commentEnd >= this.end ? this.end : commentEnd + 2;
      return true;
    }

    return false;
  }
}
