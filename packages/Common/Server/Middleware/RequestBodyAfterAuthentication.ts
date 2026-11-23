import {
  ExpressRaw,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
  RequestHandler,
  headerValueToString,
} from "../Utils/Express";
import RequestBodyJson, { isNdjsonContentType } from "../Utils/RequestBodyJson";
import { RequestBodyLimit } from "../Utils/RequestBodyLimit";
import { withAppRequestBodyLimit } from "../Utils/RequestBodyRefusal";
import AppBodyParsers, { keepRawBody } from "./AppBodyParsers";
import GzipRequestBodyMiddleware, {
  isJsonContentType,
} from "./GzipRequestBody";
import RequestBodyParser from "./RequestBodyParser";

/*
 * A BODY READ ONCE ITS CALLER IS KNOWN (#10222).
 *
 * StartServer reads every request's body before routing, so before any key
 * is checked: whatever a route takes, it takes from anyone. A route that
 * takes millions of JSON values - a probe's collection, a forwarding pod's
 * ClickHouse rows - is listed as checking its caller's key before it parses
 * the body (RequestBodyLimit, readsBodyAfterAuthentication). StartServer
 * leaves its body unread, and the route reads it here, once a key in its
 * headers is checked:
 *
 *   - readBytes leaves the body's bytes in req.body, unparsed: a gzip body
 *     inflated by GzipRequestBody (bounded, and its values counted as it
 *     inflates when it is JSON), any other as it was sent. Both are held to
 *     the limit's bytes. A probe's collection reads them this way once its
 *     headers named the probe. An older probe names itself only at the
 *     start of its report, and its body is read no further than that until
 *     the key there is checked (RequestBodyOpening, #10260).
 *   - readJson reads them and parses them, counted first (RequestBodyJson),
 *     for a route whose caller's key is in its headers, checked before
 *     this runs.
 *   - readUpload reads an upload (#10673) - a Pyroscope profile, source maps,
 *     dSYMs - in each of the forms its route takes: a multipart form, JSON,
 *     or the bytes themselves.
 *   - readBody reads it as StartServer reads every other route's before
 *     routing (AppBodyParsers, #10702): JSON and forms parsed, protobuf and
 *     a gzip body as their bytes, anything else left unread. The telemetry
 *     that collectors, agents and CI send - Fluent Bit and Fluentd, syslog,
 *     Pyroscope's push and the rest - is read this way once its key is
 *     right, and its handler gets the very body it got before.
 *
 * A body something already read - StartServer's parsers, a test's - is left
 * as it is: a stream is read once.
 */

/*
 * The bytes of a body of any type, one reader per size. A body compressed
 * another way than gzip is inflated by body-parser itself, held to the same
 * size, or refused (415) when it is no way it reads. A body over the size is
 * refused without the rest of it read (RequestBodyParser, #10598).
 */
const rawReaders: Map<number, RequestHandler> = new Map();

const rawReaderFor: (bytes: number) => RequestHandler = (
  bytes: number,
): RequestHandler => {
  let reader: RequestHandler | undefined = rawReaders.get(bytes);

  if (!reader) {
    reader = RequestBodyParser.create(ExpressRaw, {
      type: (): boolean => {
        return true;
      },
      limit: bytes,
    });
    rawReaders.set(bytes, reader);
  }

  return reader;
};

/*
 * JSON that does not parse, shaped as body-parser's own error for it, so
 * expressErrorHandler answers it as it always has: 400, in
 * RequestBodyRefusal's words.
 */
export const createJsonParseFailedError: (cause: unknown) => Error = (
  cause: unknown,
): Error => {
  return Object.assign(
    new Error(
      cause instanceof Error ? cause.message : "The body is not valid JSON.",
    ),
    {
      type: "entity.parse.failed",
      status: 400,
      statusCode: 400,
      expose: true,
    },
  );
};

// A body parsed, or the error it is refused with.
export type ParsedRequestBody = { body: unknown } | { error: Error };

// How readBody reads what StartServer's own parsers leave as bytes, or unread.
export interface ReadBodyOptions {
  // A gzip JSON body parsed too, for a route that takes JSON alone.
  parseGzipJson?: boolean | undefined;
  /*
   * Newline-delimited JSON read as its values a line at a time, and a text
   * body as its bytes: for a route that takes records a line at a time.
   */
  readLines?: boolean | undefined;
}

// Whether a Content-Type is a text type (text/plain, text/csv...), in any case.
export const isTextContentType: (contentType: string | undefined) => boolean = (
  contentType: string | undefined,
): boolean => {
  if (!contentType) {
    return false;
  }

  return contentType.split(";")[0]!.trim().toLowerCase().startsWith("text/");
};

// What an upload's route takes (readUpload).
export interface UploadBodyReaders {
  // What the body is held to, as sent and once inflated.
  limit: RequestBodyLimit;
  // The route's multipart reader (MultipartFormData's), held to `limit`.
  multipart: RequestHandler;
  // JSON is parsed: the dSYMs the CLI sends.
  json?: boolean | undefined;
  // A body of any other type is read as its bytes: a raw profile.
  bytes?: boolean | undefined;
}

// Runs the handlers in turn, each once the one before it went on.
const inTurn: (handlers: ReadonlyArray<RequestHandler>) => RequestHandler = (
  handlers: ReadonlyArray<RequestHandler>,
): RequestHandler => {
  return (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): void => {
    const runFrom: (index: number) => void = (index: number): void => {
      const handler: RequestHandler | undefined = handlers[index];

      if (!handler) {
        return next();
      }

      handler(req, res, ((err?: unknown): void => {
        if (err) {
          return next(err);
        }

        runFrom(index + 1);
      }) as NextFunction);
    };

    runFrom(0);
  };
};

export default class RequestBodyAfterAuthentication {
  /*
   * Whether a request's body was read already: StartServer's gzip reader
   * leaves a Buffer, and body-parser marks what it read.
   */
  public static isRead(req: ExpressRequest): boolean {
    const body: unknown = (req as { body?: unknown }).body;

    return (
      Buffer.isBuffer(body) ||
      body instanceof Uint8Array ||
      (req as { _body?: unknown })._body === true ||
      Boolean((req as { readableEnded?: unknown }).readableEnded)
    );
  }

  // Reads the body's bytes into req.body, held to `limit` (see above).
  public static readBytes(limit: RequestBodyLimit): RequestHandler {
    return (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): void => {
      if (RequestBodyAfterAuthentication.isRead(req)) {
        return next();
      }

      (req as OneUptimeRequest).requestBodyLimit = limit;

      if (
        headerValueToString(req.headers["content-encoding"])?.includes("gzip")
      ) {
        return GzipRequestBodyMiddleware.parseBody(req, res, next, limit);
      }

      /*
       * A body over the limit is marked as the App's own limit, as StartServer
       * marks it, so the answer says it.
       */
      return rawReaderFor(limit.bytes)(
        req,
        res,
        withAppRequestBodyLimit(next, limit.bytes) as NextFunction,
      );
    };
  }

  /*
   * The bytes readBytes left in req.body, parsed as JSON: counted first, and
   * refused with 413 past `limit` before JSON.parse sees them, or with 400
   * when they are no JSON. An empty body is an empty object, as body-parser
   * reads one. A body that is not bytes - parsed already - is left as it is.
   */
  public static parseJson(
    req: ExpressRequest,
    limit: RequestBodyLimit,
  ): ParsedRequestBody {
    const body: unknown = (req as { body?: unknown }).body;

    if (!(Buffer.isBuffer(body) || body instanceof Uint8Array)) {
      return { body: body };
    }

    if (body.byteLength === 0) {
      return { body: {} };
    }

    try {
      return { body: RequestBodyJson.parse(body, limit) };
    } catch (err) {
      if (RequestBodyJson.isTooManyValuesError(err)) {
        return { error: err as Error };
      }

      return { error: createJsonParseFailedError(err) };
    }
  }

  /*
   * Reads the body and parses it as JSON (readBytes, then parseJson), held
   * to `limit`: for a route whose caller's key is in its headers, mounted
   * after the middleware that checks it.
   */
  public static readJson(limit: RequestBodyLimit): RequestHandler {
    const readBytes: RequestHandler =
      RequestBodyAfterAuthentication.readBytes(limit);

    return (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): void => {
      readBytes(req, res, ((err?: unknown): void => {
        if (err) {
          return next(err);
        }

        const parsed: ParsedRequestBody =
          RequestBodyAfterAuthentication.parseJson(req, limit);

        if ("error" in parsed) {
          return next(parsed.error);
        }

        (req as { body?: unknown }).body = parsed.body;

        return next();
      }) as NextFunction);
    };
  }

  /*
   * A BODY READ ONCE ITS CALLER'S KEY IS CHECKED, AS STARTSERVER READS ONE
   * BEFORE ROUTING (#10702), held to `limit` as it is sent and once it
   * inflates:
   *
   *   - JSON parsed, its values counted first, its text kept as rawBody
   *     (what an ingestion budget measures, and a signature is checked over);
   *   - a form parsed, its text kept as rawBody and rawFormUrlEncodedBody;
   *   - protobuf kept as its bytes, in req.body;
   *   - a gzip body inflated and kept as its bytes, whatever its type, a
   *     JSON one's values counted as it inflates (GzipRequestBody);
   *   - any other body left unread, as StartServer left it: the route finds
   *     no body, and the connection is closed once it answers
   *     (UnreadRequestBody).
   *
   * `parseGzipJson`, for a route that takes JSON alone: a gzip JSON body is
   * parsed too, once inflated, as the same body sent uncompressed is - its
   * values counted first, its inflated text kept as rawBody, refused 400
   * when it is no JSON. StartServer hands every route a gzip JSON body as
   * its bytes, which such a route read as no body at all.
   *
   * `readLines`, for a route that takes records a line at a time (#10769):
   *
   *   - newline-delimited JSON (application/x-ndjson, application/jsonl:
   *     NDJSON_CONTENT_TYPES) is read as its values, a line at a time, each
   *     counted before it is parsed (RequestBodyJson.parseLines), and its
   *     text kept as rawBody, so an ingestion budget measures what was sent.
   *     No parser StartServer runs reads that type: sent as it is, it was
   *     left unread, and the route found no body;
   *   - a text body (text/*) is read as its bytes, as a gzip one is already.
   *
   * Either way the same, sent as it is or gzip-compressed (or deflate).
   *
   * For a route whose key is in its headers or its path, checked before
   * this runs (TelemetryIngest.forSurface takes it, to read the body between
   * the key and the ingestion budget). A request refused before it - no
   * key, a wrong one - has nothing of its body read, inflated or parsed:
   * UnreadRequestBody closes the connection once the refusal is sent, which
   * the client still reads.
   */
  public static readBody(
    limit: RequestBodyLimit,
    options?: ReadBodyOptions | undefined,
  ): RequestHandler {
    const parseGzipJson: boolean = Boolean(options?.parseGzipJson);
    const readLines: boolean = Boolean(options?.readLines);

    return (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): void => {
      if (RequestBodyAfterAuthentication.isRead(req)) {
        return next();
      }

      AppBodyParsers.read(
        req,
        res,
        ((err?: unknown): void => {
          if (err) {
            return next(err);
          }

          AppBodyParsers.readForm(
            req,
            res,
            ((formErr?: unknown): void => {
              if (formErr) {
                return next(formErr);
              }

              const contentType: string | undefined = headerValueToString(
                req.headers["content-type"],
              );

              if (
                readLines &&
                (isNdjsonContentType(contentType) ||
                  isTextContentType(contentType))
              ) {
                return RequestBodyAfterAuthentication.readLineBody(
                  req,
                  res,
                  next,
                  limit,
                );
              }

              if (!parseGzipJson) {
                return next();
              }

              return next(
                RequestBodyAfterAuthentication.parseInflatedJson(req, limit),
              );
            }) as NextFunction,
            limit,
          );
        }) as NextFunction,
        limit,
      );
    };
  }

  /*
   * A body of lines (readBody's readLines): its bytes - a gzip body's,
   * inflated already, or read now, held to `limit` - and, for
   * newline-delimited JSON, the values of its lines in their place.
   */
  private static readLineBody(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
    limit: RequestBodyLimit,
  ): void {
    RequestBodyAfterAuthentication.readBytes(limit)(req, res, ((
      err?: unknown,
    ): void => {
      if (err) {
        return next(err);
      }

      const body: unknown = (req as { body?: unknown }).body;

      if (
        !(Buffer.isBuffer(body) || body instanceof Uint8Array) ||
        !isNdjsonContentType(headerValueToString(req.headers["content-type"]))
      ) {
        return next();
      }

      const bytes: Buffer = Buffer.isBuffer(body)
        ? body
        : Buffer.from(body.buffer, body.byteOffset, body.byteLength);

      let values: Array<unknown>;

      try {
        values = RequestBodyJson.parseLines(bytes, limit);
      } catch (parseErr) {
        return next(parseErr);
      }

      keepRawBody(req as OneUptimeRequest, bytes, ["rawBody"]);
      (req as { body?: unknown }).body = values;

      return next();
    }) as NextFunction);
  }

  /*
   * A gzip JSON body readBody left as its inflated bytes, parsed in place
   * (parseJson) and its text kept as rawBody, as StartServer's JSON parser
   * keeps it. Answers the error it is refused with, or nothing. Any other
   * body - parsed already, protobuf, of no JSON type - is left as it is.
   */
  private static parseInflatedJson(
    req: ExpressRequest,
    limit: RequestBodyLimit,
  ): Error | undefined {
    const body: unknown = (req as { body?: unknown }).body;

    if (
      !(Buffer.isBuffer(body) || body instanceof Uint8Array) ||
      !isJsonContentType(headerValueToString(req.headers["content-type"]))
    ) {
      return undefined;
    }

    const parsed: ParsedRequestBody = RequestBodyAfterAuthentication.parseJson(
      req,
      limit,
    );

    if ("error" in parsed) {
      return parsed.error;
    }

    keepRawBody(
      req as OneUptimeRequest,
      Buffer.isBuffer(body)
        ? body
        : Buffer.from(body.buffer, body.byteOffset, body.byteLength),
      ["rawBody"],
    );
    (req as { body?: unknown }).body = parsed.body;

    return undefined;
  }

  /*
   * AN UPLOAD, READ ONCE ITS CALLER'S KEY IS CHECKED (#10673): a Pyroscope
   * profile, source maps, an iOS app's dSYMs. Their clients send the key in a
   * header, so nothing in the body is needed to check it: StartServer leaves
   * the body unread (readsBodyAfterAuthentication), the route checks the key,
   * and this reads, after it, what StartServer and the route read before it -
   * held to `limit`, as sent and once inflated:
   *
   *   - a gzip body inflated first, whatever its type (GzipRequestBody), as
   *     StartServer inflated it before routing;
   *   - a multipart form parsed by `multipart` (MultipartFormData), from those
   *     bytes, or off the request as it comes;
   *   - JSON, on a route that takes it, counted and parsed (readJson);
   *   - a body of any other type, on a route that takes the bytes
   *     themselves, read as them (readBytes).
   *
   * A body of a type the route takes none of is left unread, and the route
   * finds it empty, as it did. A request refused before this runs - no key,
   * a wrong one - has nothing of its body read: UnreadRequestBody closes the
   * connection once the refusal is sent, which the client still reads.
   */
  public static readUpload(readers: UploadBodyReaders): RequestHandler {
    const limit: RequestBodyLimit = readers.limit;
    const readBytes: RequestHandler =
      RequestBodyAfterAuthentication.readBytes(limit);
    const readJson: RequestHandler =
      RequestBodyAfterAuthentication.readJson(limit);

    const inflateGzip: RequestHandler = (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): void => {
      // What the route's readers hold the body to (MultipartFormData's too).
      (req as OneUptimeRequest).requestBodyLimit = limit;

      if (
        headerValueToString(req.headers["content-encoding"])?.includes("gzip")
      ) {
        return readBytes(req, res, next);
      }

      return next();
    };

    const readJsonBody: RequestHandler = (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): void => {
      if (
        !isJsonContentType(headerValueToString(req.headers["content-type"]))
      ) {
        return next();
      }

      return readJson(req, res, next);
    };

    return inTurn([
      inflateGzip,
      readers.multipart,
      ...(readers.json ? [readJsonBody] : []),
      ...(readers.bytes ? [readBytes] : []),
    ]);
  }
}
