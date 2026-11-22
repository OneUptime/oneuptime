import { UNEXPLAINED_ERROR_MESSAGES } from "../../Types/Exception/UnexplainedError";
import {
  JsonElementLimit,
  JsonElementLimits,
  JsonElementTallyCount,
} from "../../Utils/JsonElementCount";
import { ExpressRequest, ExpressResponse } from "./Express";
import { Socket } from "net";

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
 *
 * A third (#10597): a body whose Content-Encoding says gzip or deflate, and
 * that does not inflate ("entity.inflate.failed") - not gzip at all, cut off,
 * or with bytes after its end. It used to be a 500 and an error-level log
 * line, from any client, with no key: the gzip reader runs before routing.
 *
 * And two for a multipart body (MultipartFormData, #10643), which multer
 * refuses with errors of its own: one over a limit of multer's - more files,
 * fields or parts, or a larger file or field, than OneUptime reads in one
 * request ("multipart.limit", 413) - and one that is not the multipart form
 * its Content-Type says it is, or names a part in a way multer refuses
 * ("multipart.malformed", 400). Each was an error-level log line, and a
 * malformed body a 500, from any client: Pyroscope, source maps and dSYMs
 * read their multipart bodies before their keys are checked. Each is
 * answered in the error's own words, as it was, and logged at debug.
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
 * The type of the error a body that does not inflate is refused with: its
 * Content-Encoding says gzip or deflate, and its bytes are not (#10597).
 */
export const INFLATE_FAILED_TYPE: string = "entity.inflate.failed";

/*
 * The types of the errors a multipart body is refused with (see above): over
 * one of multer's limits, and not a multipart form multer reads.
 */
export const MULTIPART_LIMIT_TYPE: string = "multipart.limit";
export const MULTIPART_MALFORMED_TYPE: string = "multipart.malformed";

/*
 * Set on the error a parser StartServer runs raises for a body over the
 * route's limit: its bytes, so the answer can say the limit OneUptime held
 * it to (see readRequestBodyRefusal).
 */
export const APP_REQUEST_BODY_LIMIT_FIELD: string =
  "appRequestBodyLimitInBytes";

/*
 * How long the connection of a body refused unread is kept once its answer is
 * sent, before it is closed under the client (closeConnectionAfterAnswer):
 * half-closed - the answer and the end of the stream are on their way - with
 * not a byte more of the body read. Long enough for the answer to cross a
 * slow link and be read; a client that reads it and hangs up ends it sooner.
 * A client can hold a connection longer than this for free (an idle
 * keep-alive one is kept for over a minute), so it buys nobody more.
 */
export const UNREAD_BODY_CONNECTION_GRACE_MS: number = 2000;

/*
 * Has a socket's end, once an answer has been written (Node calls
 * destroySoon then), be a half-close: the answer is flushed and followed by
 * the end of the stream, and the socket is destroyed only after the grace,
 * or as soon as the client goes away. Nothing reads from it meanwhile.
 */
const closeSocketGracefully: (socket: Socket | null | undefined) => void = (
  socket: Socket | null | undefined,
): void => {
  if (!socket || typeof socket.end !== "function") {
    return;
  }

  socket.destroySoon = function destroyAfterGrace(this: Socket): void {
    if (this.writable) {
      this.end();
    }

    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
      this.destroy();
    }, UNREAD_BODY_CONNECTION_GRACE_MS);

    // A connection on its way out does not hold the process open.
    (timer as { unref?: () => void }).unref?.();

    this.once("close", (): void => {
      clearTimeout(timer);
    });
  };
};

/*
 * Has the answer to a body refused unread, or part-read, close its connection
 * once it is sent (#10260, #10598), with not a byte more of the body read, and
 * the answer still read by the client. Measured on Node 26, over loopback:
 *
 *   - Left to itself, Node drains a body nobody read once the answer is sent
 *     (IncomingMessage._dump): every byte the client goes on sending is read
 *     and thrown away, to keep the connection usable. A keep-alive connection
 *     whose body was paused instead was held open, unread, until its
 *     keep-alive timeout.
 *   - Told not to keep the connection, Node answers "Connection: close" - but
 *     it destroys the socket as soon as the answer is written. With the
 *     client's body unread, the kernel resets the connection, and Node's own
 *     http client and fetch - the probe, the CLI, an OpenTelemetry exporter
 *     in Node - reported EPIPE instead of the 413 nearly every time, 64 MiB
 *     sent with a Content-Length or chunked, on keep-alive connections and
 *     not. (curl and Python's requests read the answer either way.)
 *
 * So the answer says "Connection: close"; once it is written, the socket is
 * half-closed and destroyed only after UNREAD_BODY_CONNECTION_GRACE_MS, or
 * when the client hangs up; and the body is never drained - not now, not
 * after the answer. Each of those clients then reads the 413. Returns whether
 * the connection was to be kept, for a reader that takes the body after all
 * (RequestBodyOpening): setting res.shouldKeepAlive back is all it needs, as
 * a body read whole leaves nothing to drain or to reset.
 */
export const closeConnectionAfterAnswer: (res: ExpressResponse) => boolean = (
  res: ExpressResponse,
): boolean => {
  const wasKept: boolean = Boolean(res.shouldKeepAlive);

  if (!res.headersSent) {
    res.shouldKeepAlive = false;
  }

  const req: ExpressRequest | undefined = (
    res as { req?: ExpressRequest | undefined }
  ).req;

  if (req) {
    // Node drains a body nobody read once the answer is sent: not this one.
    (req as unknown as { _dump: () => void })._dump = (): void => {};
  }

  closeSocketGracefully(res.socket as Socket | null | undefined);

  return wasKept;
};

/*
 * Stops reading a request's body for good, for a reader that refuses it: the
 * request is paused, and its answer closes the connection without a byte more
 * of the body read (closeConnectionAfterAnswer).
 */
export const stopReadingRequestBody: (
  req: ExpressRequest,
  res: ExpressResponse,
) => void = (req: ExpressRequest, res: ExpressResponse): void => {
  if (typeof req.pause === "function") {
    req.pause();
  }

  closeConnectionAfterAnswer(res);
};

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

/*
 * A body over the limit a reader holds it to - as declared, as sent, or as it
 * inflates: body-parser's error for it (entity.too.large, with the limit in
 * bytes), marked as the App's own limit, as StartServer marks body-parser's,
 * so the answer says that limit.
 */
export const createTooLargeError: (limit: number, bytes: number) => Error = (
  limit: number,
  bytes: number,
): Error => {
  return Object.assign(new Error("request entity too large"), {
    type: "entity.too.large",
    status: 413,
    statusCode: 413,
    expose: true,
    limit: limit,
    length: bytes,
    [APP_REQUEST_BODY_LIMIT_FIELD]: limit,
  });
};

/*
 * The `next` of a reader held to the App's own limit for the request (its
 * route's, RequestBodyLimit): a body over it, refused by body-parser
 * (entity.too.large, with the limit in bytes), is marked as that limit, so
 * the answer says it (readRequestBodyRefusal) and is not read as a proxy's.
 */
export const withAppRequestBodyLimit: (
  next: (err?: unknown) => void,
  bytes: number,
) => (err?: unknown) => void = (
  next: (err?: unknown) => void,
  bytes: number,
): ((err?: unknown) => void) => {
  return (err?: unknown): void => {
    if (
      err &&
      typeof err === "object" &&
      (err as { type?: unknown }).type === "entity.too.large"
    ) {
      (err as Record<string, unknown>)[APP_REQUEST_BODY_LIMIT_FIELD] = bytes;
    }

    next(err);
  };
};

/*
 * A body whose client went away before it was in: body-parser's error for it
 * (raw-body's request.aborted), which is answered as one cut off mid-body is.
 * For a request whose client had gone before a parser came to read it, where
 * body-parser's own "stream is not readable" was a 500 (RequestBodyParser).
 */
export const createCutOffError: () => Error = (): Error => {
  return Object.assign(new Error("request aborted"), {
    type: "request.aborted",
    code: "ECONNABORTED",
    status: 400,
    statusCode: 400,
    expose: true,
  });
};

/*
 * Set on a refusal of the code's own (markAsRequestBodyRefusal): the words it
 * is answered in. body-parser's errors carry none, so a library's message is
 * never what a client is told.
 */
export const REFUSAL_ANSWER_FIELD: string = "refusalAnswer";

/*
 * An error of the code's own, marked as a refusal of the client's body: the
 * type it is refused as and its status, so expressErrorHandler answers it in
 * its own message, with that status, and logs it at debug. For a multipart
 * body's refusals (MULTIPART_LIMIT_TYPE, MULTIPART_MALFORMED_TYPE), which
 * stay the Exceptions their callers read.
 */
export const markAsRequestBodyRefusal: <T extends Error>(
  error: T,
  type: string,
  status: number,
) => T = <T extends Error>(error: T, type: string, status: number): T => {
  return Object.assign(error, {
    type: type,
    status: status,
    statusCode: status,
    expose: true,
    [REFUSAL_ANSWER_FIELD]: error.message,
  });
};

/*
 * Whether an error is zlib's for bytes that do not inflate ("incorrect header
 * check", "unexpected end of file"...): zlib's errno, and its "Z_" code. As
 * body-parser hands one on, it is that error, with a 400 status added.
 */
export const isInflateError: (error: unknown) => boolean = (
  error: unknown,
): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate: { code?: unknown; errno?: unknown } = error as {
    code?: unknown;
    errno?: unknown;
  };

  return (
    typeof candidate.code === "string" &&
    candidate.code.startsWith("Z_") &&
    typeof candidate.errno === "number"
  );
};

/*
 * The error a body that does not inflate is refused with (#10597): shaped as
 * body-parser's own, so expressErrorHandler answers it 400 in its sentence,
 * and logs it at debug - any client can send one, before any key is checked.
 */
export const createInflateFailedError: (cause: unknown) => Error = (
  cause: unknown,
): Error => {
  return Object.assign(
    new Error(
      cause instanceof Error && cause.message
        ? cause.message
        : "The request body does not inflate.",
    ),
    {
      type: INFLATE_FAILED_TYPE,
      status: 400,
      statusCode: 400,
      expose: true,
    },
  );
};

export const REQUEST_BODY_REFUSAL_MESSAGES: {
  tooLargeForOneUptime: string;
  tooLarge: string;
  tooManyFields: string;
  invalidJson: string;
  cutOff: string;
  sizeMismatch: string;
  encodingUnsupported: string;
  notInflated: string;
  charsetUnsupported: string;
  tooDeep: string;
  tooManyJsonValues: string;
  multipartTooLarge: string;
  multipartMalformed: string;
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
  notInflated:
    "The request body is not the gzip or deflate data its Content-Encoding header says it is, so this did not finish. Compress the body as the header says, or send it uncompressed without the header.",
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
  /*
   * A multipart body over one of multer's limits, when the error does not
   * say which (MultipartFormData's own refusals name the limit they hit).
   */
  multipartTooLarge:
    "The form sent holds more files or fields, or larger ones, than OneUptime reads in one request, so this did not finish. Send fewer or smaller files at once.",
  multipartMalformed:
    "The request body is not the multipart form its Content-Type header says it is, so this did not finish. Check the body and the boundary its Content-Type names, then send the request again.",
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
  /*
   * A gzip or deflate body that does not inflate (#10597): the gzip reader's,
   * the opening reader's and body-parser's alike. OneUptime's own type.
   */
  [INFLATE_FAILED_TYPE]: {
    status: 400,
    message: REQUEST_BODY_REFUSAL_MESSAGES.notInflated,
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
  /*
   * A multipart body multer refused (MultipartFormData): over one of its
   * limits, or no multipart form it reads. OneUptime's own types.
   */
  [MULTIPART_LIMIT_TYPE]: {
    status: 413,
    message: REQUEST_BODY_REFUSAL_MESSAGES.multipartTooLarge,
  },
  [MULTIPART_MALFORMED_TYPE]: {
    status: 400,
    message: REQUEST_BODY_REFUSAL_MESSAGES.multipartMalformed,
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
  // A refusal of the code's own, in the words it was made with.
  const ownAnswer: unknown = (error as Record<string, unknown>)[
    REFUSAL_ANSWER_FIELD
  ];

  if (typeof ownAnswer === "string" && ownAnswer.trim()) {
    return ownAnswer;
  }

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
