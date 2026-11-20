import { UNEXPLAINED_ERROR_MESSAGES } from "../../Types/Exception/UnexplainedError";
import {
  JsonElementLimit,
  JsonElementLimits,
  JsonElementTallyCount,
} from "../../Utils/JsonElementCount";

/**
 * A REQUEST BODY THE APP'S BODY PARSERS REFUSED IS THE CLIENT'S, NOT A FAULT
 * (#8419).
 *
 * express.json, express.urlencoded and express.raw (StartServer, and the MCP
 * OAuth routes' own) refuse a body they cannot take with an http-errors
 * error: a `type` that names what was wrong, a 4xx `status` and `expose`
 * set. None is one of OneUptime's Exceptions, so the last-resort handler
 * took each for a fault in the code: it logged an error and answered 500
 * with "The server ran into a problem it could not explain" and a reference
 * to hand to support - for a body over the 50 MB limit, for JSON that does
 * not parse. The person was told to report what they could fix themselves,
 * the on-call person read a code fault in the logs, and the API, the CLI and
 * Terraform read a 500 for their own mistake.
 *
 * Now each is answered with its own status and a sentence that says what
 * was wrong and what to do. A body over the App's own 50 MB is answered with
 * UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime, which the front ends read
 * back and draw in the reader's language - apart from a proxy's 413
 * (#8278), so a self-hosted admin is not sent to raise a proxy's limit that
 * refused nothing (#8567). The others are for whoever wrote the request - a
 * script, the CLI, an integration - since the front ends send none of them.
 *
 * Only these types: a parser's 500s ("stream.not.readable",
 * "stream.encoding.set") are faults in how the server wires its parsers, and
 * "entity.verify.failed" would be a verify function of ours that threw.
 * Those still answer 500 with a reference.
 *
 * Two more are OneUptime's own (#10183). A body over the limit StartServer
 * holds its route to (RequestBodyLimit) - 1 MB on most routes - says that
 * limit, as the 50 MB does: OneUptime refused it, and no proxy did. And a
 * JSON body with more values than its route reads ("entity.too.many.values")
 * is refused before it is parsed, with how many it may hold.
 */

/*
 * The limit StartServer gives its JSON, form and protobuf parsers ("50mb"),
 * in the bytes raw-body names on the error it raises past it.
 */
export const APP_BODY_LIMIT_IN_BYTES: number = 50 * 1024 * 1024;

/*
 * The type of the error StartServer's parsers raise for a JSON body with
 * more values than its route reads, counted before it is parsed.
 */
export const TOO_MANY_JSON_VALUES_TYPE: string = "entity.too.many.values";

/*
 * Set on the error a parser StartServer runs raises for a body over the
 * route's limit: its bytes, so the answer can say the limit OneUptime held
 * it to (see readRequestBodyRefusal).
 */
export const APP_REQUEST_BODY_LIMIT_FIELD: string =
  "appRequestBodyLimitInBytes";

// A size as the too-large sentences say one: "1 MB", "50 MB", "1.5 MB".
export const describeBodyLimit: (bytes: number) => string = (
  bytes: number,
): string => {
  const mebibytes: number = bytes / (1024 * 1024);

  if (mebibytes >= 1) {
    return `${Number(mebibytes.toFixed(1))} MB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

// "100,000": a count as an English sentence writes it.
const describeCount: (count: number) => string = (count: number): string => {
  return count.toLocaleString("en-US");
};

/*
 * What a body over the limit StartServer holds its route to says, when the
 * limit is not the 50 MB the front ends read back: the limit itself, and
 * that OneUptime takes no more there, so nobody raises a proxy's limit for
 * it (#8567). Shown as it is.
 */
export const getTooLargeForRouteMessage: (bytes: number) => string = (
  bytes: number,
): string => {
  return `What was sent is larger than the ${describeBodyLimit(bytes)} OneUptime takes in one request to this address, so this did not finish. Try again with less at once.`;
};

// What a JSON body over a limit on its values says, for the limit it passed.
export const getTooManyJsonValuesMessage: (
  passed: JsonElementLimit,
  limit: number,
) => string = (passed: JsonElementLimit, limit: number): string => {
  const what: string =
    passed === JsonElementLimit.ObjectsArraysAndStrings
      ? "JSON objects, arrays and strings"
      : "JSON values (objects, arrays, strings and numbers)";

  return `The request body holds more than ${describeCount(limit)} ${what}, the most OneUptime reads in one request to this address, so this did not finish. Send less in each request.`;
};

export interface TooManyJsonValuesError extends Error {
  type: string;
  status: number;
  statusCode: number;
  expose: boolean;
  // Which limit the body passed, and that limit.
  passed: JsonElementLimit;
  limit: number;
}

/*
 * The error a JSON body with more values than its limits is refused with:
 * shaped as body-parser's own (a type, a 4xx status, exposed), so
 * expressErrorHandler answers it as it answers theirs. Thrown from a
 * parser's verify, it is handed on by body-parser as it is.
 */
export const createTooManyJsonValuesError: (
  count: JsonElementTallyCount,
  limits: JsonElementLimits,
) => TooManyJsonValuesError = (
  count: JsonElementTallyCount,
  limits: JsonElementLimits,
): TooManyJsonValuesError => {
  const passed: JsonElementLimit = count.passed || JsonElementLimit.Values;
  const limit: number =
    passed === JsonElementLimit.ObjectsArraysAndStrings
      ? limits.objectsArraysAndStrings
      : limits.values;

  return Object.assign(new Error(getTooManyJsonValuesMessage(passed, limit)), {
    type: TOO_MANY_JSON_VALUES_TYPE,
    status: 413,
    statusCode: 413,
    expose: true,
    passed: passed,
    limit: limit,
  });
};

export const REQUEST_BODY_REFUSAL_MESSAGES: {
  tooLargeForOneUptime: string;
  tooLarge: string;
  tooManyFields: string;
  invalidJson: string;
  cutOff: string;
  sizeMismatch: string;
  encodingUnsupported: string;
  charsetUnsupported: string;
  tooDeep: string;
  tooManyJsonValues: string;
} = {
  // Over the App's own 50 MB: the front ends read it back (UnexplainedError).
  tooLargeForOneUptime: UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime,
  /*
   * Over another limit a route set for itself: the front ends' sentence for
   * any 413, which names no number.
   */
  tooLarge: UNEXPLAINED_ERROR_MESSAGES.tooLarge,
  tooManyFields:
    "The form sent has more fields than OneUptime reads in one request, so this did not finish. Send fewer fields at once, or send the body as JSON.",
  invalidJson:
    "The request body is not valid JSON, so this did not finish. Check the JSON, and that the Content-Type header names what the body is, then send the request again.",
  cutOff:
    "The request body did not arrive in full, so this did not finish. Send the request again.",
  sizeMismatch:
    "The request body was not the size its Content-Length header said, so this did not finish. Send the request again with the right Content-Length.",
  encodingUnsupported:
    "The request body is compressed in a way OneUptime does not read, so this did not finish. Send it uncompressed, or with a Content-Encoding of gzip or deflate.",
  charsetUnsupported:
    "The request body is in a character set OneUptime does not read, so this did not finish. Send it in UTF-8.",
  tooDeep:
    "The form sent nests its fields deeper than OneUptime reads, so this did not finish. Send it with fewer levels of nesting.",
  /*
   * A JSON body with more values than its route reads, when the error does
   * not say which limit it passed (getTooManyJsonValuesMessage says it).
   */
  tooManyJsonValues:
    "The request body holds more JSON values than OneUptime reads in one request to this address, so this did not finish. Send less in each request.",
};

interface RequestBodyRefusalRule {
  status: number;
  message: string;
}

// The `limit` raw-body names on an entity.too.large error, in bytes.
const limitOf: (error: unknown) => number | null = (
  error: unknown,
): number | null => {
  const limit: unknown = (error as { limit?: unknown } | null)?.limit;

  return typeof limit === "number" && Number.isFinite(limit) ? limit : null;
};

/*
 * The body parsers' error types (body-parser and raw-body, as express 4
 * ships them), each with the status it answers and its sentence.
 */
export const REQUEST_BODY_REFUSALS: Record<string, RequestBodyRefusalRule> = {
  /*
   * Over the parser's `limit`, counted after a deflate body inflates. The
   * App's 50 MB says so (readRequestBodyRefusal); this is any other limit.
   */
  "entity.too.large": {
    status: 413,
    message: REQUEST_BODY_REFUSAL_MESSAGES.tooLarge,
  },
  /*
   * A form with more fields than the urlencoded parser's parameterLimit.
   * Not a size, so neither too-large sentence, which say a size, is true.
   */
  "parameters.too.many": {
    status: 413,
    message: REQUEST_BODY_REFUSAL_MESSAGES.tooManyFields,
  },
  // JSON that does not parse, or whose top level is not an object or array.
  "entity.parse.failed": {
    status: 400,
    message: REQUEST_BODY_REFUSAL_MESSAGES.invalidJson,
  },
  // The client stopped sending before the body was in.
  "request.aborted": {
    status: 400,
    message: REQUEST_BODY_REFUSAL_MESSAGES.cutOff,
  },
  // Fewer or more bytes than Content-Length said.
  "request.size.invalid": {
    status: 400,
    message: REQUEST_BODY_REFUSAL_MESSAGES.sizeMismatch,
  },
  // A Content-Encoding other than gzip, deflate or identity ("br").
  "encoding.unsupported": {
    status: 415,
    message: REQUEST_BODY_REFUSAL_MESSAGES.encodingUnsupported,
  },
  // A charset the parser cannot decode.
  "charset.unsupported": {
    status: 415,
    message: REQUEST_BODY_REFUSAL_MESSAGES.charsetUnsupported,
  },
  // A urlencoded form nested past the parser's depth.
  "querystring.parse.rangeError": {
    status: 400,
    message: REQUEST_BODY_REFUSAL_MESSAGES.tooDeep,
  },
  /*
   * A JSON body with more values than its route reads, refused before it
   * is parsed (StartServer, GzipRequestBody). OneUptime's own type.
   */
  [TOO_MANY_JSON_VALUES_TYPE]: {
    status: 413,
    message: REQUEST_BODY_REFUSAL_MESSAGES.tooManyJsonValues,
  },
};

/*
 * The sentence an error says more than its type's: the limit it was held
 * to, when it names one. Null for the type's own sentence.
 */
const messageOf: (type: string, error: unknown) => string | null = (
  type: string,
  error: unknown,
): string | null => {
  if (type === TOO_MANY_JSON_VALUES_TYPE) {
    const candidate: { passed?: unknown; limit?: unknown } = error as {
      passed?: unknown;
      limit?: unknown;
    };

    const isLimitKnown: boolean =
      (candidate.passed === JsonElementLimit.Values ||
        candidate.passed === JsonElementLimit.ObjectsArraysAndStrings) &&
      typeof candidate.limit === "number" &&
      Number.isFinite(candidate.limit);

    return isLimitKnown
      ? getTooManyJsonValuesMessage(
          candidate.passed as JsonElementLimit,
          candidate.limit as number,
        )
      : null;
  }

  if (type !== "entity.too.large") {
    return null;
  }

  /*
   * Past the App's own 50 MB: OneUptime refused it, and says its limit
   * (#8567), in the sentence the front ends read back.
   */
  if (limitOf(error) === APP_BODY_LIMIT_IN_BYTES) {
    return REQUEST_BODY_REFUSAL_MESSAGES.tooLargeForOneUptime;
  }

  /*
   * Past a smaller limit StartServer holds the route to (1 MB on most
   * routes): OneUptime refused it too, and says that limit. A limit of
   * another size, which no StartServer parser named, is a route's own, and
   * keeps the sentence that names none.
   */
  const appLimit: unknown = (error as Record<string, unknown>)[
    APP_REQUEST_BODY_LIMIT_FIELD
  ];

  if (
    typeof appLimit === "number" &&
    Number.isFinite(appLimit) &&
    appLimit > 0 &&
    appLimit === limitOf(error)
  ) {
    return getTooLargeForRouteMessage(appLimit);
  }

  return null;
};

export interface RequestBodyRefusal {
  // The parser's own name for it, for the log line.
  type: string;
  status: number;
  message: string;
}

/*
 * What to answer for an error a body parser raised over the client's body,
 * or null for anything else, which the handler treats as before. A body
 * parser's error says so three ways at once: one of its types, a 4xx
 * status, and `expose` (http-errors sets it for every 4xx), so an error of
 * the code's own that happens to carry a `type` is not taken for one.
 */
export const readRequestBodyRefusal: (
  error: unknown,
) => RequestBodyRefusal | null = (
  error: unknown,
): RequestBodyRefusal | null => {
  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate: {
    type?: unknown;
    status?: unknown;
    statusCode?: unknown;
    expose?: unknown;
  } = error as {
    type?: unknown;
    status?: unknown;
    statusCode?: unknown;
    expose?: unknown;
  };

  const type: unknown = candidate.type;

  if (
    typeof type !== "string" ||
    !Object.prototype.hasOwnProperty.call(REQUEST_BODY_REFUSALS, type)
  ) {
    return null;
  }

  const status: unknown = candidate.status ?? candidate.statusCode;

  if (
    typeof status !== "number" ||
    !Number.isInteger(status) ||
    status < 400 ||
    status > 499 ||
    candidate.expose !== true
  ) {
    return null;
  }

  const rule: RequestBodyRefusalRule = REQUEST_BODY_REFUSALS[type]!;

  return {
    type: type,
    status: rule.status,
    message: messageOf(type, error) || rule.message,
  };
};

export default readRequestBodyRefusal;
