import { ClickHouseError, ClickHouseSettings } from "@clickhouse/client";
import QueryTimeoutException from "../../../Types/Exception/QueryTimeoutException";
import ServerException from "../../../Types/Exception/ServerException";
import { JSONObject } from "../../../Types/JSON";
import { EventLoopBudget } from "../EventLoop";

/*
 * READING A CLICKHOUSE ANSWER (issue #4707).
 *
 * Every analytics read asks ClickHouse for FORMAT JSON: one document that is
 * only whole once the query has finished. A read can end early in more ways
 * than the client library knows about, and each used to reach the API as a
 * SyntaxError from JSON.parse — a 500 "Server Error" the reader could not
 * tell from a crash, recorded on the span as a code fault:
 *
 *   - timeout_overflow_mode 'break' (measured on ClickHouse 24.8 and 26.7):
 *     a grouped or sorted read stopped at its max_execution_time answers
 *     200 with an EMPTY body, and a read that was streaming rows answers 200
 *     with the document cut off mid-row. Never the partial result the mode
 *     is documented to give.
 *   - 'throw' once rows have been streamed: 26.x ends the body with an
 *     `__exception__` block and drops the connection; 24.x finishes the
 *     document with the rows it had and an `"exception"` member, which
 *     parses — partial rows that look complete.
 *   - 'throw' before any row: an HTTP error (408, code 159), which the
 *     client throws as a ClickHouseError.
 *
 * This module turns all of them into what happened: a read stopped at its
 * time limit is a QueryTimeoutException (504, "took longer than 45 seconds
 * ... try a shorter time range or more specific filters"); any other error
 * ClickHouse reports, before or after the rows, is a ClickHouseError with its
 * code and type, exactly as if it had come before the rows. A document is
 * only ever handed back when it is whole and carries no error.
 *
 * AnalyticsDatabaseService.executeQuery runs every read through it, and asks
 * ClickHouse to hold a time-limited read's answer until the query is done
 * (http_wait_end_of_query), so on 26.x a stop always arrives as an error and
 * never as rows followed by a dropped connection.
 */

/*
 * TIMEOUT_EXCEEDED (159): max_execution_time passed under
 * timeout_overflow_mode 'throw'. TOO_SLOW (160): the server estimated up
 * front that the read would not finish in time.
 */
const TIME_LIMIT_ERROR_CODES: ReadonlyArray<string> = ["159", "160"];
const TIME_LIMIT_ERROR_TYPES: ReadonlyArray<string> = [
  "TIMEOUT_EXCEEDED",
  "TOO_SLOW",
];

// How ClickHouse 25.x and later frame an error written after the rows.
const EXCEPTION_MARKER: string = "__exception__";

const MAX_EXECUTION_TIME_SETTING: string = "max_execution_time";

// An all-caps error type such as TIMEOUT_EXCEEDED, whole and nothing else.
const ERROR_TYPE_PATTERN: RegExp = /^[A-Z][A-Z0-9_]{2,}$/;

/*
 * READING AN ANSWER ROW BY ROW, AS IT ARRIVES (issue #10316).
 *
 * FORMAT JSON is one document, so a read of it is held in full three times
 * over - its text, the document parsed from it in one JSON.parse, and the
 * rows built from that - and the parse holds the event loop for as long as
 * the document takes: 50 to 75 ms for each 10 MB read of a grouped Metrics
 * monitor over 16,000 series (#10108). A read that asks for ROWS_FORMAT is
 * read line by line as its bytes come in (readRows): each row is parsed and
 * handed on, and the event loop is handed back between rows once the read
 * has used its budget, so no read holds it for longer than that and a row,
 * and no read is ever held in memory as text.
 *
 * JSONCompactEachRowWithNames: a line of column names, then a line per row
 * with its values in the same order and the same JSON FORMAT JSON writes
 * them with, measured on ClickHouse 24.8 and 26.7. The names line is written
 * even when there are no rows, so an empty body is still an answer that
 * never started, as it is for FORMAT JSON - a row format without it would
 * read the same as an answer with no rows.
 *
 * What ends such an answer early, measured on both:
 *
 *   - 26.x writes an error that came after the rows as the `__exception__`
 *     block (see readTrailingError), then drops the connection: the body
 *     ends in a socket error after the whole block has arrived.
 *   - 24.x writes it as a last row of one value, the error's text
 *     (`["Code: 159. DB::Exception: ... (TIMEOUT_EXCEEDED) ..."]`), and ends
 *     the body cleanly - even under http_wait_end_of_query, where 26.x
 *     answers with an HTTP error before any row.
 *   - A body cut off mid-row ends without the row's newline.
 *
 * Each becomes what readJson makes of the same answer: a stop at the time
 * limit is a QueryTimeoutException, any other error ClickHouse reports is a
 * ClickHouseError with its code and type, and an answer that ended before
 * it was complete is reported as one - its rows are never passed off as
 * the whole answer.
 */
export const ROWS_FORMAT: string = "JSONCompactEachRowWithNames";

const NEWLINE_BYTE: number = 0x0a;

export interface ClickhouseRowsReadOptions extends ClickhouseReadOptions {
  // The X-ClickHouse-Exception-Tag header, which frames a 26.x error block.
  exceptionTag?: string | undefined;
  /*
   * The budget the read hands the event loop back by: the caller's, so a
   * read and the work around it keep one clock. A new one when left out.
   */
  budget?: EventLoopBudget | undefined;
}

export interface ClickhouseRowsRead {
  // The answer's columns, in the order ClickHouse wrote them.
  columns: Array<string>;
  // How many rows were handed on.
  rowCount: number;
}

// Where a readRows has got to.
interface RowsReadState {
  // The names line, once it has come.
  columns: Array<string> | null;
  rowCount: number;
  // A 26.x error block, as its text from its opening marker on.
  errorBlock: string | null;
  // The bytes of a line whose newline has not come yet.
  partial: Array<Buffer>;
}

export interface ClickhouseErrorDetails {
  code: string;
  type: string;
  message: string;
}

export interface ClickhouseReadOptions {
  /*
   * The read's max_execution_time, in seconds, when it has one. Named in the
   * message a stopped read is reported with, and what lets an answer that
   * ended early be read as "stopped at the limit".
   */
  timeLimitInSeconds?: number | undefined;
}

type ResponseHeaderValues = Record<string, string | Array<string> | undefined>;

interface JsonReadableResultSet {
  json: () => Promise<unknown>;
  text?: (() => Promise<string>) | undefined;
  response_headers?: ResponseHeaderValues | undefined;
}

export default class ClickhouseReadResult {
  /*
   * Whether a failed read is ClickHouse refusing to finish in the time it was
   * given — the raw ClickHouseError, or the QueryTimeoutException this module
   * turned it into.
   */
  public static isTimeLimitError(error: unknown): boolean {
    if (error instanceof QueryTimeoutException) {
      return true;
    }

    if (!error || typeof error !== "object") {
      return false;
    }

    const code: unknown = (error as { code?: unknown }).code;
    const type: unknown = (error as { type?: unknown }).type;

    return (
      (typeof code === "string" && TIME_LIMIT_ERROR_CODES.includes(code)) ||
      (typeof type === "string" && TIME_LIMIT_ERROR_TYPES.includes(type))
    );
  }

  /*
   * The time limit a statement runs under, in seconds: the last
   * `max_execution_time = N` in its text (the SETTINGS clause getQuerySettings
   * appends, which wins over anything sent beside the query), else the one in
   * the per-call settings. Undefined when it has none.
   */
  public static getTimeLimitInSeconds(
    query: string,
    clickhouseSettings?: ClickHouseSettings | undefined,
  ): number | undefined {
    const fromQuery: number | undefined =
      ClickhouseReadResult.readSettingFromQuery(query);

    if (fromQuery !== undefined) {
      return fromQuery;
    }

    const fromSettings: unknown = clickhouseSettings?.max_execution_time;

    if (fromSettings === undefined || fromSettings === null) {
      return undefined;
    }

    const seconds: number = Number(fromSettings);

    return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
  }

  // What a reader is told when a read was stopped at its time limit.
  public static getTimeLimitMessage(timeLimitInSeconds?: number): string {
    const took: string =
      timeLimitInSeconds !== undefined
        ? `took longer than ${ClickhouseReadResult.formatSeconds(timeLimitInSeconds)}`
        : "took too long";

    return `This query ${took} and was stopped before it finished. Try a shorter time range or more specific filters.`;
  }

  public static toTimeLimitException(
    timeLimitInSeconds?: number,
  ): QueryTimeoutException {
    return new QueryTimeoutException(
      ClickhouseReadResult.getTimeLimitMessage(timeLimitInSeconds),
    );
  }

  /*
   * What a failed read is rethrown as: a stop at the time limit becomes a
   * QueryTimeoutException, everything else is left as it is.
   */
  public static toReadError(
    error: unknown,
    options: ClickhouseReadOptions = {},
  ): unknown {
    if (error instanceof QueryTimeoutException) {
      return error;
    }

    if (ClickhouseReadResult.isTimeLimitError(error)) {
      return ClickhouseReadResult.toTimeLimitException(
        options.timeLimitInSeconds,
      );
    }

    return error;
  }

  /*
   * The code, type and message of a ClickHouse error text —
   * "Code: 159. DB::Exception: Timeout exceeded: ... (TIMEOUT_EXCEEDED)
   * (version 26.7.13.12 (official build))". Null when the text is not one.
   * Read with indexOf, not a pattern: it can sit at the end of megabytes of
   * rows.
   */
  public static parseErrorText(text: string): ClickhouseErrorDetails | null {
    const codeStart: number = text.indexOf("Code: ");

    if (codeStart < 0) {
      return null;
    }

    let codeEnd: number = codeStart + "Code: ".length;
    let code: string = "";

    while (codeEnd < text.length) {
      const character: string = text.charAt(codeEnd);

      if (character < "0" || character > "9") {
        break;
      }

      code += character;
      codeEnd++;
    }

    if (!code) {
      return null;
    }

    return {
      code: code,
      type: ClickhouseReadResult.readErrorType(text, codeEnd),
      message: text.substring(codeStart).trim(),
    };
  }

  /*
   * One FORMAT JSON answer, read whole: the document when it is complete and
   * carries no error, otherwise the error that ended it (see the top of this
   * file). `exceptionTag` is the X-ClickHouse-Exception-Tag header, which
   * frames an error written after the rows.
   */
  public static readJson<T = unknown>(
    text: string,
    options: ClickhouseReadOptions & {
      exceptionTag?: string | undefined;
    } = {},
  ): T {
    let document: unknown = undefined;
    let isWhole: boolean = false;

    try {
      document = JSON.parse(text);
      isWhole = true;
    } catch {
      isWhole = false;
    }

    if (isWhole) {
      ClickhouseReadResult.throwIfDocumentCarriesError(document, options);
      return document as T;
    }

    const trailingError: ClickhouseErrorDetails | null =
      ClickhouseReadResult.readTrailingError(text, options.exceptionTag);

    if (trailingError) {
      throw ClickhouseReadResult.toReadError(
        ClickhouseReadResult.toClickhouseError(trailingError),
        options,
      );
    }

    throw ClickhouseReadResult.toIncompleteAnswerError(options);
  }

  /*
   * Makes a result set's json() read the answer the way readJson does. The
   * same object is handed back — its query_id, headers and stream untouched
   * — with json() replaced on the instance.
   */
  public static guard<TResultSet>(
    resultSet: TResultSet,
    options: ClickhouseReadOptions = {},
  ): TResultSet {
    if (!resultSet || typeof resultSet !== "object") {
      return resultSet;
    }

    const readable: JsonReadableResultSet =
      resultSet as unknown as JsonReadableResultSet;

    if (typeof readable.json !== "function") {
      return resultSet;
    }

    const readText: (() => Promise<string>) | null =
      typeof readable.text === "function"
        ? readable.text.bind(resultSet)
        : null;
    const readDocument: () => Promise<unknown> = readable.json.bind(resultSet);

    readable.json = async (): Promise<unknown> => {
      /*
       * A stand-in without text() (a test double) is read the old way, but a
       * broken answer still surfaces as what it is.
       */
      if (!readText) {
        let document: unknown;

        try {
          document = await readDocument();
        } catch (error) {
          throw error instanceof SyntaxError
            ? ClickhouseReadResult.toIncompleteAnswerError(options)
            : ClickhouseReadResult.toReadError(error, options);
        }

        ClickhouseReadResult.throwIfDocumentCarriesError(document, options);
        return document;
      }

      let text: string;

      try {
        text = await readText();
      } catch (error) {
        throw ClickhouseReadResult.toReadError(error, options);
      }

      return ClickhouseReadResult.readJson(text, {
        ...options,
        exceptionTag: ClickhouseReadResult.readHeader(
          readable.response_headers,
          "x-clickhouse-exception-tag",
        ),
      });
    };

    return resultSet;
  }

  /*
   * A read's text asking for ROWS_FORMAT, as the client's query() asks for
   * the format it is given: trailing semicolons taken off, then the clause.
   */
  public static withRowsFormat(query: string): string {
    let text: string = query.trim();

    while (text.endsWith(";")) {
      text = text.substring(0, text.length - 1).trimEnd();
    }

    return `${text}\nFORMAT ${ROWS_FORMAT}`;
  }

  /*
   * One ROWS_FORMAT answer, read as it arrives (see ROWS_FORMAT): each row,
   * keyed by its column names as a FORMAT JSON row is, handed to onRow in
   * the order ClickHouse wrote it, the event loop handed back between rows
   * once the budget is spent. Resolves once the answer is whole; otherwise
   * throws the error that ended it, as readJson would. `body` is the
   * response's bytes in the chunks they arrive in, split anywhere: inside a
   * row, inside a character.
   */
  public static async readRows(
    body: AsyncIterable<unknown>,
    onRow: (row: JSONObject) => void,
    options: ClickhouseRowsReadOptions = {},
  ): Promise<ClickhouseRowsRead> {
    const budget: EventLoopBudget = options.budget || new EventLoopBudget();
    const state: RowsReadState = {
      columns: null,
      rowCount: 0,
      errorBlock: null,
      partial: [],
    };
    const chunks: AsyncIterator<unknown> = body[Symbol.asyncIterator]();
    let isBodyOver: boolean = false;

    try {
      for (;;) {
        let next: IteratorResult<unknown>;

        try {
          next = await chunks.next();
        } catch (error) {
          isBodyOver = true;
          throw ClickhouseReadResult.toBodyError(error, state, options);
        }

        if (next.done) {
          isBodyOver = true;
          break;
        }

        const chunk: Buffer = ClickhouseReadResult.toBuffer(next.value);
        let start: number = 0;
        let newline: number = chunk.indexOf(NEWLINE_BYTE);

        while (newline !== -1) {
          ClickhouseReadResult.readLine(
            ClickhouseReadResult.takeLine(state, chunk, start, newline),
            state,
            onRow,
            options,
          );
          start = newline + 1;

          if (budget.isSpent()) {
            await budget.handBack();
          }

          newline = chunk.indexOf(NEWLINE_BYTE, start);
        }

        if (start < chunk.length) {
          state.partial.push(chunk.subarray(start));
        }
      }

      return ClickhouseReadResult.finishRows(state, options);
    } finally {
      if (!isBodyOver) {
        /*
         * Stopped before the body ended (an error, a row onRow refused):
         * the rest is not read, and the response is let go.
         */
        try {
          await chunks.return?.();
        } catch {
          // What it was stopped for is what is thrown.
        }
      }
    }
  }

  // A chunk of a response body as bytes.
  private static toBuffer(chunk: unknown): Buffer {
    if (Buffer.isBuffer(chunk)) {
      return chunk;
    }

    if (chunk instanceof Uint8Array) {
      return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    }

    return Buffer.from(String(chunk), "utf8");
  }

  /*
   * The text of the line that ends at `end` in `chunk`: what came of it in
   * earlier chunks, then this one's part. Lines are cut at their newline
   * byte, which UTF-8 never uses inside a character, and decoded whole.
   */
  private static takeLine(
    state: RowsReadState,
    chunk: Buffer,
    start: number,
    end: number,
  ): string {
    if (state.partial.length === 0) {
      return chunk.toString("utf8", start, end);
    }

    state.partial.push(chunk.subarray(start, end));
    const text: string = Buffer.concat(state.partial).toString("utf8");
    state.partial = [];

    return text;
  }

  private static readLine(
    text: string,
    state: RowsReadState,
    onRow: (row: JSONObject) => void,
    options: ClickhouseRowsReadOptions,
  ): void {
    if (state.errorBlock !== null) {
      state.errorBlock += `${text}\n`;
      return;
    }

    const line: string = text.endsWith("\r")
      ? text.substring(0, text.length - 1)
      : text;

    if (line === EXCEPTION_MARKER) {
      state.errorBlock = `${text}\n`;
      return;
    }

    // The line break a 26.x error block opens with: never a row.
    if (line.length === 0) {
      return;
    }

    let value: unknown;

    try {
      value = JSON.parse(line);
    } catch {
      throw ClickhouseReadResult.toIncompleteAnswerError(options);
    }

    if (state.columns === null) {
      if (!ClickhouseReadResult.isListOfText(value)) {
        throw ClickhouseReadResult.toIncompleteAnswerError(options);
      }

      state.columns = value;
      return;
    }

    if (Array.isArray(value) && value.length === state.columns.length) {
      onRow(ClickhouseReadResult.toRow(state.columns, value));
      state.rowCount++;
      return;
    }

    const lateError: ClickhouseErrorDetails | null =
      ClickhouseReadResult.readErrorRow(value);

    if (lateError) {
      throw ClickhouseReadResult.toReadError(
        ClickhouseReadResult.toClickhouseError(lateError),
        options,
      );
    }

    throw ClickhouseReadResult.toIncompleteAnswerError(options);
  }

  private static isListOfText(value: unknown): value is Array<string> {
    return (
      Array.isArray(value) &&
      value.every((item: unknown): boolean => {
        return typeof item === "string";
      })
    );
  }

  /*
   * A row as FORMAT JSON writes it: its values keyed by their columns, a
   * later column of the same name over an earlier one, as JSON.parse does.
   */
  private static toRow(
    columns: Array<string>,
    values: Array<unknown>,
  ): JSONObject {
    const row: JSONObject = {};

    for (let index: number = 0; index < columns.length; index++) {
      const column: string = columns[index]!;

      if (column === "__proto__") {
        // A key of its own, as JSON.parse makes it - never the prototype.
        Object.defineProperty(row, column, {
          value: values[index],
          enumerable: true,
          writable: true,
          configurable: true,
        });
        continue;
      }

      row[column] = values[index] as JSONObject[string];
    }

    return row;
  }

  /*
   * 24.x's error after the rows: a row of one value, the error's text - or,
   * in a format of objects, {"exception": "..."}. Null for anything else.
   */
  private static readErrorRow(value: unknown): ClickhouseErrorDetails | null {
    let text: unknown = undefined;

    if (Array.isArray(value)) {
      text = value.length === 1 ? value[0] : undefined;
    } else if (value && typeof value === "object") {
      text = (value as { exception?: unknown }).exception;
    }

    if (typeof text !== "string" || !text.trim()) {
      return null;
    }

    return ClickhouseReadResult.parseErrorText(text);
  }

  // The answer once its body has ended: whole, or the error that ended it.
  private static finishRows(
    state: RowsReadState,
    options: ClickhouseRowsReadOptions,
  ): ClickhouseRowsRead {
    const rest: string =
      state.partial.length > 0
        ? Buffer.concat(state.partial).toString("utf8")
        : "";
    state.partial = [];

    if (state.errorBlock !== null) {
      const details: ClickhouseErrorDetails | null =
        ClickhouseReadResult.readTrailingError(
          state.errorBlock + rest,
          options.exceptionTag,
        );

      throw details
        ? ClickhouseReadResult.toReadError(
            ClickhouseReadResult.toClickhouseError(details),
            options,
          )
        : ClickhouseReadResult.toIncompleteAnswerError(options);
    }

    /*
     * Every row ends in a newline: text after the last one is a row the
     * answer was cut off in, whether or not what came of it parses.
     */
    if (rest.trim().length > 0 || state.columns === null) {
      throw ClickhouseReadResult.toIncompleteAnswerError(options);
    }

    return { columns: state.columns, rowCount: state.rowCount };
  }

  /*
   * What a body that failed part way is reported as: the error ClickHouse
   * wrote before it let the connection go, when the whole of its block came
   * (26.x drops the connection right after it), else the failure itself.
   */
  private static toBodyError(
    error: unknown,
    state: RowsReadState,
    options: ClickhouseRowsReadOptions,
  ): unknown {
    if (state.errorBlock !== null) {
      const rest: string =
        state.partial.length > 0
          ? Buffer.concat(state.partial).toString("utf8")
          : "";
      const details: ClickhouseErrorDetails | null =
        ClickhouseReadResult.readTrailingError(
          state.errorBlock + rest,
          options.exceptionTag,
        );

      if (details) {
        return ClickhouseReadResult.toReadError(
          ClickhouseReadResult.toClickhouseError(details),
          options,
        );
      }
    }

    return ClickhouseReadResult.toReadError(error, options);
  }

  // 24.x writes an error that came after the rows into the document itself.
  private static throwIfDocumentCarriesError(
    document: unknown,
    options: ClickhouseReadOptions,
  ): void {
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      return;
    }

    const exception: unknown = (document as { exception?: unknown }).exception;

    if (typeof exception !== "string" || !exception.trim()) {
      return;
    }

    const details: ClickhouseErrorDetails = ClickhouseReadResult.parseErrorText(
      exception,
    ) || { code: "", type: "", message: exception.trim() };

    throw ClickhouseReadResult.toReadError(
      ClickhouseReadResult.toClickhouseError(details),
      options,
    );
  }

  /*
   * An answer that ended before its document did, with no error in it: what
   * 'break' sends for a read it stopped at the time limit. Without a time
   * limit there is no such stop, so it is not called one.
   */
  private static toIncompleteAnswerError(
    options: ClickhouseReadOptions,
  ): Error {
    if (options.timeLimitInSeconds !== undefined) {
      return ClickhouseReadResult.toTimeLimitException(
        options.timeLimitInSeconds,
      );
    }

    return new ServerException(
      "The database's answer to this query ended before it was complete.",
    );
  }

  /*
   * The error 25.x and later write after the rows (lines end in \r\n, the
   * message's own in \n):
   *
   *   __exception__
   *   <tag>
   *   Code: 159. DB::Exception: ... (TIMEOUT_EXCEEDED) (version ...)
   *   <length> <tag>
   *   __exception__
   *
   * It is only ever the end of the body, so only the end is read: the
   * nearest marker before the closing one opens it, as nothing in the block
   * can hold the marker. The tag, when the X-ClickHouse-Exception-Tag header
   * names it, has to frame the block on both sides, so a log line that ends
   * the body with the marker in it is not taken for an error.
   */
  private static readTrailingError(
    text: string,
    exceptionTag: string | undefined,
  ): ClickhouseErrorDetails | null {
    const body: string = text.trimEnd();

    if (!body.endsWith(EXCEPTION_MARKER)) {
      return null;
    }

    const closingMarker: number = body.length - EXCEPTION_MARKER.length;
    const openingMarker: number = body.lastIndexOf(
      EXCEPTION_MARKER,
      closingMarker - 1,
    );

    if (openingMarker < 0) {
      return null;
    }

    const lines: Array<string> = ClickhouseReadResult.toLines(
      body.substring(openingMarker + EXCEPTION_MARKER.length, closingMarker),
    );

    if (lines.length < 3) {
      return null;
    }

    if (
      exceptionTag &&
      (lines[0] !== exceptionTag ||
        !lines[lines.length - 1]!.endsWith(` ${exceptionTag}`))
    ) {
      return null;
    }

    return ClickhouseReadResult.parseErrorText(lines.slice(1, -1).join("\n"));
  }

  // Non-empty lines, each without the \r of a \r\n ending.
  private static toLines(text: string): Array<string> {
    return text
      .split("\n")
      .map((line: string): string => {
        return line.endsWith("\r") ? line.substring(0, line.length - 1) : line;
      })
      .filter((line: string): boolean => {
        return line.length > 0;
      });
  }

  private static toClickhouseError(
    details: ClickhouseErrorDetails,
  ): ClickHouseError {
    return new ClickHouseError({
      code: details.code,
      type: details.type,
      message: details.message,
    });
  }

  /*
   * The error type is the last all-caps word in parentheses: the message
   * itself can hold parentheses, and "(version ...)" follows the type.
   */
  private static readErrorType(text: string, from: number): string {
    let close: number = text.lastIndexOf(")");

    while (close > from) {
      const open: number = text.lastIndexOf("(", close);

      if (open < from) {
        return "";
      }

      const word: string = text.substring(open + 1, close);

      if (ERROR_TYPE_PATTERN.test(word)) {
        return word;
      }

      close = text.lastIndexOf(")", open);
    }

    return "";
  }

  private static readSettingFromQuery(query: string): number | undefined {
    const at: number = query.lastIndexOf(MAX_EXECUTION_TIME_SETTING);

    if (at < 0) {
      return undefined;
    }

    let index: number = at + MAX_EXECUTION_TIME_SETTING.length;

    while (query.charAt(index) === " ") {
      index++;
    }

    if (query.charAt(index) !== "=") {
      return undefined;
    }

    index++;

    while (query.charAt(index) === " ") {
      index++;
    }

    let digits: string = "";

    while (query.charAt(index) >= "0" && query.charAt(index) <= "9") {
      digits += query.charAt(index);
      index++;
    }

    const seconds: number = Number(digits);

    return digits && seconds > 0 ? seconds : undefined;
  }

  private static readHeader(
    headers: ResponseHeaderValues | undefined,
    name: string,
  ): string | undefined {
    const value: string | Array<string> | undefined = headers?.[name];

    if (Array.isArray(value)) {
      return value[0];
    }

    return value || undefined;
  }

  private static formatSeconds(seconds: number): string {
    return seconds === 1 ? "1 second" : `${seconds} seconds`;
  }
}
