import JsonElementCounter, {
  JsonElementLimit,
  JsonElementTally,
  JsonElementTallyCount,
} from "../../Utils/JsonElementCount";
import { ExpressRequest, OneUptimeRequest } from "./Express";
import { RequestBodyLimit, getRequestBodyLimit } from "./RequestBodyLimit";
import {
  TOO_MANY_JSON_VALUES_TYPE,
  createTooManyJsonValuesError,
} from "./RequestBodyRefusal";

/*
 * The media types newline-delimited JSON is sent as (#10769): NDJSON's
 * application/x-ndjson - what Fluentd's HTTP output sends unless json_array
 * is set, and Fluent Bit's http output with format json_lines - the same
 * without its "x-", and JSON Lines' application/jsonl.
 */
export const NDJSON_CONTENT_TYPES: ReadonlyArray<string> = [
  "application/x-ndjson",
  "application/ndjson",
  "application/jsonl",
];

// Whether a Content-Type is newline-delimited JSON's, in any case, with any parameters.
export const isNdjsonContentType: (
  contentType: string | undefined,
) => boolean = (contentType: string | undefined): boolean => {
  if (!contentType) {
    return false;
  }

  const mediaType: string = contentType.split(";")[0]!.trim().toLowerCase();

  return NDJSON_CONTENT_TYPES.includes(mediaType);
};

/*
 * How many lines of one body may look like JSON and not parse before the
 * rest of its lines are kept as text, untried (RequestBodyJson.parseLines).
 * A line JSON.parse refuses costs ten times what one it reads does - it
 * builds a SyntaxError, 3.5 microseconds against 0.3 measured on Node 26 -
 * so a million of them, which the values limit lets through, took 3.5 s of
 * blocked event loop. This many take 3.5 ms. A collector's lines are its
 * records, every one JSON; a line of text rarely opens and closes as JSON
 * does.
 */
export const MAX_UNPARSED_JSON_LINES: number = 1000;

const LINE_FEED: number = 0x0a;
const CARRIAGE_RETURN: number = 0x0d;
const SPACE: number = 0x20;
const TAB: number = 0x09;
const QUOTE: number = 0x22;
const OPEN_BRACE: number = 0x7b;
const CLOSE_BRACE: number = 0x7d;
const OPEN_BRACKET: number = 0x5b;
const CLOSE_BRACKET: number = 0x5d;

// Space, a tab or a carriage return: what a line's ends are trimmed of.
const isLineSpace: (code: number | undefined) => boolean = (
  code: number | undefined,
): boolean => {
  return code === SPACE || code === TAB || code === CARRIAGE_RETURN;
};

/*
 * Whether bytes[from, to) open and close as a JSON object, array or string
 * do: the lines worth handing to JSON.parse. A number, true, false or null
 * reads the same kept as text, and a log line that is no JSON is text.
 */
const looksLikeJsonLine: (
  bytes: Uint8Array,
  from: number,
  to: number,
) => boolean = (bytes: Uint8Array, from: number, to: number): boolean => {
  if (to - from < 2) {
    return false;
  }

  const first: number = bytes[from]!;
  const last: number = bytes[to - 1]!;

  return (
    (first === OPEN_BRACE && last === CLOSE_BRACE) ||
    (first === OPEN_BRACKET && last === CLOSE_BRACKET) ||
    (first === QUOTE && last === QUOTE)
  );
};

/*
 * A JSON BODY, COUNTED BEFORE IT IS PARSED (#10183).
 *
 * StartServer counts every JSON body it parses (its parsers' verify) and
 * every JSON body a gzip request inflates to (GzipRequestBody), against the
 * limit of the route it is for (RequestBodyLimit). A route that parses JSON
 * itself - an inflated gzip body reaches the route as its bytes, whatever
 * its Content-Type said - counts it here first, so JSON.parse never sees a
 * body that would parse into more than the route reads.
 */
export default class RequestBodyJson {
  /*
   * What a request's body is held to: what StartServer held it to, or else
   * what its path takes.
   */
  public static getLimit(req: ExpressRequest): RequestBodyLimit {
    return (
      (req as OneUptimeRequest).requestBodyLimit ||
      getRequestBodyLimit(req.path || "")
    );
  }

  /*
   * Throws the 413 a body with more values than the limit is refused with
   * (createTooManyJsonValuesError), shaped as a body parser's error, so
   * expressErrorHandler answers it.
   */
  public static assertWithinLimit(
    bytes: Uint8Array,
    limit: RequestBodyLimit,
  ): void {
    const count: JsonElementTallyCount = JsonElementCounter.countBytes(
      bytes,
      limit,
    );

    if (count.passed) {
      throw createTooManyJsonValuesError(count, limit);
    }
  }

  // The same for text: false when it holds more values than the limit.
  public static isTextWithinLimit(
    text: string,
    limit: RequestBodyLimit,
  ): boolean {
    return !JsonElementCounter.countText(text, limit).passed;
  }

  // UTF-8 JSON bytes, counted and then parsed. JSON.parse's SyntaxError too.
  public static parse(bytes: Uint8Array, limit: RequestBodyLimit): unknown {
    RequestBodyJson.assertWithinLimit(bytes, limit);

    return JSON.parse(
      Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
        "utf8",
      ),
    );
  }

  /*
   * A BODY OF NEWLINE-DELIMITED JSON (NDJSON, JSON LINES), READ AS ITS
   * VALUES: one for each line that holds anything, in order (#10769).
   *
   *   - Every line is counted before JSON.parse sees it, against what the
   *     lines before it left of the limit - both counts, as parse holds a
   *     whole body to them - and the body is refused at the line that passes
   *     it (413, createTooManyJsonValuesError), with no line after it read.
   *     Counted a line at a time, never as one text: each line is parsed on
   *     its own, and one line's quote left open would hide every line after
   *     it from a count of the whole. A line counts as one value at least,
   *     so no body holds more lines than the limit has values.
   *   - A line that opens and closes as a JSON object, array or string does
   *     is parsed: its value. Any other line - a line of text, a number,
   *     JSON that does not parse - is kept as its text, trimmed: a log line
   *     that is not JSON is still a line. Past MAX_UNPARSED_JSON_LINES
   *     lines that did not parse, the rest are kept as text untried.
   *
   * Lines end at a line feed; a carriage return before it, spaces and tabs
   * are trimmed. The bytes are read as UTF-8, which the count reads too.
   */
  public static parseLines(
    bytes: Uint8Array,
    limit: RequestBodyLimit,
  ): Array<unknown> {
    const text: Buffer = Buffer.isBuffer(bytes)
      ? bytes
      : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const values: Array<unknown> = [];
    const used: { values: number; objectsArraysAndStrings: number } = {
      values: 0,
      objectsArraysAndStrings: 0,
    };
    let unparsed: number = 0;
    let start: number = 0;

    while (start < text.length) {
      const lineFeed: number = text.indexOf(LINE_FEED, start);
      const end: number = lineFeed === -1 ? text.length : lineFeed;
      let from: number = start;
      let to: number = end;

      start = end + 1;

      while (from < to && isLineSpace(text[from])) {
        from++;
      }

      while (to > from && isLineSpace(text[to - 1])) {
        to--;
      }

      if (from === to) {
        continue;
      }

      const tally: JsonElementTally = new JsonElementTally({
        values: limit.values - used.values,
        objectsArraysAndStrings:
          limit.objectsArraysAndStrings - used.objectsArraysAndStrings,
      });

      tally.add(text, from, to);

      const count: JsonElementTallyCount = tally.getCount();

      used.values += Math.max(count.values, 1);
      used.objectsArraysAndStrings += Math.max(count.objectsArraysAndStrings, 1);

      const passed: JsonElementLimit | null =
        count.passed ||
        (used.values > limit.values
          ? JsonElementLimit.Values
          : used.objectsArraysAndStrings > limit.objectsArraysAndStrings
            ? JsonElementLimit.ObjectsArraysAndStrings
            : null);

      if (passed) {
        throw createTooManyJsonValuesError(
          {
            values: used.values,
            objectsArraysAndStrings: used.objectsArraysAndStrings,
            passed: passed,
          },
          limit,
        );
      }

      const line: string = text.toString("utf8", from, to);

      if (
        unparsed < MAX_UNPARSED_JSON_LINES &&
        looksLikeJsonLine(text, from, to)
      ) {
        try {
          values.push(JSON.parse(line));
          continue;
        } catch {
          unparsed++;
        }
      }

      values.push(line);
    }

    return values;
  }

  // Whether an error is the refusal assertWithinLimit throws.
  public static isTooManyValuesError(error: unknown): boolean {
    return (
      Boolean(error) &&
      typeof error === "object" &&
      (error as { type?: unknown }).type === TOO_MANY_JSON_VALUES_TYPE
    );
  }

  /*
   * Whether body-parser decodes a JSON body as UTF-8: the charset it hands a
   * verify function (utf-8 when the request names none). JSON sent between
   * systems is UTF-8 (RFC 8259, section 8.1), and the count reads UTF-8.
   */
  public static isUtf8(encoding: string | null | undefined): boolean {
    if (!encoding) {
      return true;
    }

    const name: string = encoding.trim().toLowerCase();

    return name === "utf-8" || name === "utf8";
  }

  /*
   * The 415 for a JSON body in another charset, shaped as body-parser's own
   * (expressErrorHandler answers it in RequestBodyRefusal's words). A body
   * the count cannot read as it will be decoded is not parsed: in UTF-7 or
   * UTF-16, brackets need not be the bytes they are in UTF-8.
   */
  public static createCharsetUnsupportedError(encoding: string): Error {
    return Object.assign(
      new Error(`unsupported charset "${encoding.toUpperCase()}"`),
      {
        type: "charset.unsupported",
        charset: encoding.toLowerCase(),
        status: 415,
        statusCode: 415,
        expose: true,
      },
    );
  }
}
