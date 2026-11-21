import {
  ExpressRaw,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
  RequestHandler,
  headerValueToString,
} from "../Utils/Express";
import RequestBodyJson from "../Utils/RequestBodyJson";
import { RequestBodyLimit } from "../Utils/RequestBodyLimit";
import { APP_REQUEST_BODY_LIMIT_FIELD } from "../Utils/RequestBodyRefusal";
import GzipRequestBodyMiddleware from "./GzipRequestBody";

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
 *
 * A body something already read - StartServer's parsers, a test's - is left
 * as it is: a stream is read once.
 */

/*
 * The bytes of a body of any type, one reader per size. A body compressed
 * another way than gzip is inflated by body-parser itself, held to the same
 * size, or refused (415) when it is no way it reads.
 */
const rawReaders: Map<number, RequestHandler> = new Map();

const rawReaderFor: (bytes: number) => RequestHandler = (
  bytes: number,
): RequestHandler => {
  let reader: RequestHandler | undefined = rawReaders.get(bytes);

  if (!reader) {
    reader = ExpressRaw({
      type: (): boolean => {
        return true;
      },
      limit: bytes,
    }) as RequestHandler;
    rawReaders.set(bytes, reader);
  }

  return reader;
};

/*
 * A body over the limit is refused by body-parser (entity.too.large): marked
 * as the App's own limit, as StartServer marks it, so the answer says it.
 */
const markAppLimit: (next: NextFunction, bytes: number) => NextFunction = (
  next: NextFunction,
  bytes: number,
): NextFunction => {
  return ((err?: unknown): void => {
    if (
      err &&
      typeof err === "object" &&
      (err as { type?: unknown }).type === "entity.too.large"
    ) {
      (err as Record<string, unknown>)[APP_REQUEST_BODY_LIMIT_FIELD] = bytes;
    }

    next(err);
  }) as NextFunction;
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

      return rawReaderFor(limit.bytes)(
        req,
        res,
        markAppLimit(next, limit.bytes),
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
}
