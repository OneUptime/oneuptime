import {
  ExpressJson,
  ExpressRaw,
  ExpressRequest,
  ExpressResponse,
  ExpressUrlEncoded,
  NextFunction,
  OneUptimeRequest,
  RequestHandler,
  headerValueToString,
} from "../Utils/Express";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import RequestBodyJson from "../Utils/RequestBodyJson";
import {
  LARGE_REQUEST_BODY_LIMIT,
  RequestBodyLimit,
} from "../Utils/RequestBodyLimit";
import { withAppRequestBodyLimit } from "../Utils/RequestBodyRefusal";
import GzipRequestBodyMiddleware from "./GzipRequestBody";
import RequestBodyParser from "./RequestBodyParser";

/*
 * THE APP'S OWN BODY PARSERS, HELD TO A ROUTE'S LIMIT (RequestBodyLimit).
 *
 * How the App reads a request's body: JSON and forms parsed, protobuf kept as
 * its bytes, a gzip body inflated and its bytes kept, each held to the
 * route's limit as it is sent and once it inflates. Any other body is left
 * unread, for a route that reads it itself.
 *
 *   - StartServer reads every route's body with these before routing, so
 *     before any key is checked (read, then readForm).
 *   - A route that checks its caller's key first (RequestBodyLimit's
 *     readsBodyAfterAuthentication) reads its body with the very same ones
 *     once the key is right (RequestBodyAfterAuthentication.readBody,
 *     #10702): its handler gets the body it got when StartServer read it,
 *     and a request with no key or a wrong one has nothing of it read.
 *
 * They lived in StartServer, which only one of the two could import.
 */

export type BodyParserVerify = (
  req: ExpressRequest,
  res: ExpressResponse,
  buf: Buffer,
  encoding?: string,
) => void;

export interface BodyParserOptions {
  // The most bytes body-parser reads, as sent and once inflated.
  limit: number;
  extended: boolean;
  verify: BodyParserVerify;
}

export type RawBodyField = "rawBody" | "rawFormUrlEncodedBody";

/*
 * A body's text, for the routes that check a signature over it (Slack,
 * Stripe, GitHub, Zoom, WhatsApp, Huntress, Vercel, an incoming request
 * monitor's, a runbook's webhook...): set on each field named, as the text
 * body-parser read. It used to be decoded and kept for every JSON and form
 * request - a second copy of every body, up to 50 MB, while nearly every
 * route never looks at it. Now the bytes body-parser read are kept, and
 * decoded once, as UTF-8, the first time a route reads one of the fields.
 * A field a route sets is kept as it set it.
 */
export const keepRawBody: (
  req: OneUptimeRequest,
  buf: Buffer,
  fields: ReadonlyArray<RawBodyField>,
) => void = (
  req: OneUptimeRequest,
  buf: Buffer,
  fields: ReadonlyArray<RawBodyField>,
): void => {
  let text: string | undefined = undefined;

  const read: () => string = (): string => {
    if (text === undefined) {
      text = buf.toString();
    }

    return text;
  };

  for (const field of fields) {
    Object.defineProperty(req, field, {
      configurable: true,
      enumerable: true,
      get: read,
      set: (value: string | undefined): void => {
        Object.defineProperty(req, field, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: value,
        });
      },
    });
  }
};

/*
 * The JSON parser's options for a route's limit (RequestBodyLimit). Its
 * verify sees the bytes before body-parser decodes and parses them, and
 * refuses, with a 413 expressErrorHandler answers, a body with more values
 * than the route reads (#10183): counted, 50 MiB of "[]," is refused after
 * its first million values, in milliseconds, where JSON.parse took three
 * seconds and 667 MiB of heap.
 */
export const createJsonBodyParserOptions: (
  limit: RequestBodyLimit,
) => BodyParserOptions = (limit: RequestBodyLimit): BodyParserOptions => {
  return {
    limit: limit.bytes,
    extended: true,
    verify: (
      req: ExpressRequest,
      _res: ExpressResponse,
      buf: Buffer,
      encoding?: string,
    ): void => {
      if (!RequestBodyJson.isUtf8(encoding)) {
        throw RequestBodyJson.createCharsetUnsupportedError(encoding || "");
      }

      RequestBodyJson.assertWithinLimit(
        buf,
        (req as OneUptimeRequest).requestBodyLimit || limit,
      );

      keepRawBody(req as OneUptimeRequest, buf, ["rawBody"]);
      logger.debug(
        `Raw JSON Body for signature verification captured`,
        getLogAttributesFromRequest(req as OneUptimeRequest),
      );
    },
  };
};

/*
 * The form parser's options for a route's limit. A form's fields are held
 * by the parser's own parameterLimit (1,000), so only its size is the
 * route's. One text serves both raw fields.
 */
export const createUrlEncodedBodyParserOptions: (
  limit: RequestBodyLimit,
) => BodyParserOptions = (limit: RequestBodyLimit): BodyParserOptions => {
  return {
    limit: limit.bytes,
    extended: true,
    verify: (req: ExpressRequest, _res: ExpressResponse, buf: Buffer): void => {
      keepRawBody(req as OneUptimeRequest, buf, [
        "rawFormUrlEncodedBody",
        "rawBody",
      ]);
      logger.debug(
        `Raw Form Url Encoded Body for signature verification captured`,
        getLogAttributesFromRequest(req as OneUptimeRequest),
      );
    },
  };
};

/*
 * The options a large route's parsers take (LARGE_REQUEST_BODY_LIMIT), for
 * the tests and helpers that build a parser of their own as the App's.
 */
export const jsonBodyParserOptions: BodyParserOptions =
  createJsonBodyParserOptions(LARGE_REQUEST_BODY_LIMIT);

export const urlEncodedBodyParserOptions: BodyParserOptions =
  createUrlEncodedBodyParserOptions(LARGE_REQUEST_BODY_LIMIT);

/*
 * Parse protobuf (binary) bodies for non-OTLP routes.
 * OTLP HTTP ingestion bypasses the global body parsers and handles raw/gzip
 * payloads in the telemetry router to avoid conflicts with the merged app stack.
 *
 * "application/proto" is the Connect protocol's spelling. Grafana Alloy's
 * pyroscope.write and pyroscope-dotnet v0.14+ post their push.v1 requests
 * with it, uncompressed; without it here the body fell through to the JSON
 * parser, stayed {} and every such push was answered 400.
 */
export const PROTOBUF_CONTENT_TYPES: Array<string> = [
  "application/x-protobuf",
  "application/protobuf",
  "application/proto",
];

export const isProtobufContentType: (
  contentType: string | undefined,
) => boolean = (contentType: string | undefined): boolean => {
  if (!contentType) {
    return false;
  }

  // Media types are case-insensitive, and may carry parameters.
  const mediaType: string = contentType.split(";")[0]!.trim().toLowerCase();

  return PROTOBUF_CONTENT_TYPES.includes(mediaType);
};

/*
 * One parser per size limit, made the first time a route of that size
 * needs it: what the body is counted against, the route's own limit, is
 * read from the request (OneUptimeRequest.requestBodyLimit).
 *
 * Each is body-parser's, reading no further than its limit
 * (RequestBodyParser, #10598): a body whose Content-Length is over it is
 * refused before a byte is read, one that grows past it at the chunk that
 * does, and the connection is closed once the 413 is sent, the rest of the
 * body unread. body-parser alone read every byte the client sent first.
 */
const parserForLimit: (
  create: (limit: RequestBodyLimit) => RequestHandler,
) => (limit: RequestBodyLimit) => RequestHandler = (
  create: (limit: RequestBodyLimit) => RequestHandler,
): ((limit: RequestBodyLimit) => RequestHandler) => {
  const parsers: Map<number, RequestHandler> = new Map();

  return (limit: RequestBodyLimit): RequestHandler => {
    let parser: RequestHandler | undefined = parsers.get(limit.bytes);

    if (!parser) {
      parser = create(limit);
      parsers.set(limit.bytes, parser);
    }

    return parser;
  };
};

const jsonParserFor: (limit: RequestBodyLimit) => RequestHandler =
  parserForLimit((limit: RequestBodyLimit): RequestHandler => {
    return RequestBodyParser.create(
      ExpressJson,
      createJsonBodyParserOptions(limit),
    );
  });

const urlEncodedParserFor: (limit: RequestBodyLimit) => RequestHandler =
  parserForLimit((limit: RequestBodyLimit): RequestHandler => {
    return RequestBodyParser.create(
      ExpressUrlEncoded,
      createUrlEncodedBodyParserOptions(limit),
    );
  });

const protobufParserFor: (limit: RequestBodyLimit) => RequestHandler =
  parserForLimit((limit: RequestBodyLimit): RequestHandler => {
    return RequestBodyParser.create(ExpressRaw, {
      type: PROTOBUF_CONTENT_TYPES,
      limit: limit.bytes,
    });
  });

/*
 * A body over the route's limit is refused by body-parser (entity.too.large,
 * with the limit in bytes). Marked as the App's own limit, so the answer
 * says it (RequestBodyRefusal), and is not read as a proxy's.
 */
const markAppLimit: (
  next: NextFunction,
  limit: RequestBodyLimit,
) => NextFunction = (
  next: NextFunction,
  limit: RequestBodyLimit,
): NextFunction => {
  return withAppRequestBodyLimit(next, limit.bytes) as NextFunction;
};

const isGzip: (req: ExpressRequest) => boolean = (
  req: ExpressRequest,
): boolean => {
  return Boolean(
    headerValueToString(req.headers["content-encoding"])?.includes("gzip"),
  );
};

export default class AppBodyParsers {
  /*
   * A body held to `limit`, which is kept on the request: the parsers'
   * verify, the form parser after this and a route that parses an inflated
   * body itself count against it.
   *
   *   - gzip: inflated, bounded on both sides, and its bytes kept in
   *     req.body; a JSON body's values counted as it inflates
   *     (GzipRequestBody). This used to buffer the whole compressed body and
   *     hand it to an unbounded zlib.gunzip, which turned 130 KB of
   *     anonymous request into 128 MiB of resident Buffer.
   *   - protobuf: its bytes, in req.body.
   *   - JSON: parsed, its values counted first, its text kept as rawBody.
   *   - anything else is passed on, for readForm, or for the route.
   */
  public static read(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
    limit: RequestBodyLimit,
  ): void {
    (req as OneUptimeRequest).requestBodyLimit = limit;

    if (isGzip(req)) {
      return GzipRequestBodyMiddleware.parseBody(req, res, next, limit);
    }

    if (
      isProtobufContentType(headerValueToString(req.headers["content-type"]))
    ) {
      return protobufParserFor(limit)(req, res, markAppLimit(next, limit));
    }

    return jsonParserFor(limit)(req, res, markAppLimit(next, limit));
  }

  /*
   * After read: a form, parsed, its text kept as rawFormUrlEncodedBody and
   * rawBody. A gzip body is read already, as its bytes.
   */
  public static readForm(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
    limit: RequestBodyLimit,
  ): void {
    if (isGzip(req)) {
      return next();
    }

    return urlEncodedParserFor(limit)(req, res, markAppLimit(next, limit));
  }
}
