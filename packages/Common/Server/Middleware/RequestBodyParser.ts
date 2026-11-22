import GenericFunction from "../../Types/GenericFunction";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  RequestHandler,
  headerValueToString,
} from "../Utils/Express";
import {
  createCutOffError,
  createInflateFailedError,
  createTooLargeError,
  isInflateError,
  stopReadingRequestBody,
} from "../Utils/RequestBodyRefusal";
import { IncomingHttpHeaders } from "http";
import { Readable } from "stream";

/*
 * A BODY PARSER THAT READS NO FURTHER THAN ITS LIMIT (#10598).
 *
 * body-parser - express.json, express.urlencoded, express.raw, express.text -
 * refuses a body over its limit (one whose Content-Length says more, or one
 * that grows past it as it comes), and then, before it hands the refusal on,
 * reads the whole request off the connection (body-parser's read.js, `dump`).
 * Measured on Node 26 with body-parser 1.20.9: 64 MiB sent to a route held to
 * 1 MB were read, every byte, before the 413 was sent, and a chunked body was
 * read for as long as its client went on sending. StartServer parses every
 * route's JSON, forms and protobuf this way before anyone is signed in, so
 * anyone could have the App read as much as they chose to send.
 *
 * Here body-parser only parses. It reads a stand-in for the request, which
 * this feeds from the request as the body comes, counting its bytes:
 *
 *   - A body whose Content-Length is over the limit is refused before a byte
 *     of it is read; one that grows past it, at the chunk that does.
 *   - Anything body-parser refuses part-way - a deflate body that inflates
 *     past the limit, or does not inflate - stops the reading too: it drains
 *     the stand-in, never the request.
 *
 * A refused body's connection is closed once its answer is sent, with not a
 * byte more read (stopReadingRequestBody), and the client still reads the
 * answer. Everything else is body-parser's, as it was: which bodies it reads
 * (by Content-Type), the inflating of deflate and gzip, the charset, verify,
 * parsing, and every error it raises - a gzip or deflate body that does not
 * inflate is refused as one (400, INFLATE_FAILED_TYPE), where body-parser's
 * zlib error was answered 500.
 *
 * A BODY READ BEFORE IS NEVER READ AGAIN (#10643). StartServer reads every
 * gzip body before routing (GzipRequestBody): it inflates it, held to the
 * route's limit as it comes and as it inflates, counts a JSON body's values,
 * and leaves the inflated bytes in req.body, unparsed. A route that parses
 * its own body - the MCP endpoint, the MCP OAuth endpoints, the docs'
 * feedback, a multipart upload - used to hand its parser that request, and
 * body-parser, seeing it unmarked, read the spent stream again through a
 * fresh gunzip: zlib's "unexpected end of file", answered 500 with an
 * error-level log line, for a valid body, from any client. Now:
 *
 *   - a body parsed before (body-parser marks what it read: StartServer's
 *     JSON, form and protobuf parsers, another of these) is passed over, as
 *     body-parser passes over it;
 *   - a body whose bytes something read and kept - the gzip reader's
 *     inflated bytes - is parsed from those bytes, as the same body sent
 *     uncompressed would have been: the parser's own types, limit (the bytes
 *     as inflated, which is what body-parser holds a compressed body to),
 *     charset, verify and errors. Parsed once, here: the gzip reader only
 *     inflated it;
 *   - a body read whole by something that kept nothing is passed on as it
 *     is: there is nothing left to parse, and nothing on the connection;
 *   - a request whose client went away before its body was read is refused
 *     as cut off (400, request.aborted), as one that goes away mid-body is.
 *     body-parser's own answer to it - "stream is not readable" - was a 500
 *     with an error-level log line, for a client that hung up.
 */

// The request a stand-in reads for: verify functions are given it.
const REQUEST_BEHIND: unique symbol = Symbol("RequestBodyParser.request");

// The options body-parser's parsers take, handed to them as they are.
export interface RequestBodyParserOptions {
  // As body-parser takes it: bytes, or a size such as "50mb".
  limit?: number | string | undefined;
  verify?:
    | ((
        req: ExpressRequest,
        res: ExpressResponse,
        buf: Buffer,
        encoding?: string,
      ) => void)
    | undefined;
  type?:
    | string
    | Array<string>
    | ((req: ExpressRequest) => boolean)
    | undefined;
  extended?: boolean | undefined;
  inflate?: boolean | undefined;
  strict?: boolean | undefined;
  parameterLimit?: number | undefined;
  defaultCharset?: string | undefined;
}

// body-parser's default limit, 100 KB.
const DEFAULT_LIMIT_BYTES: number = 100 * 1024;

const BYTE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
};

// A number of bytes, with a unit or none: "50mb", "1.5MB", "512".
const BYTE_LIMIT_PATTERN: RegExp = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i;

/*
 * A limit in bytes, read as body-parser reads it (the `bytes` package): a
 * number of bytes, or a number and a unit ("50mb", "100kb"), 1024 to a unit.
 */
export const parseBodyLimit: (limit: number | string | undefined) => number = (
  limit: number | string | undefined,
): number => {
  if (typeof limit === "number" && Number.isFinite(limit) && limit >= 0) {
    return Math.floor(limit);
  }

  if (typeof limit === "string") {
    const match: RegExpExecArray | null = BYTE_LIMIT_PATTERN.exec(limit.trim());

    if (match) {
      const unit: string = (match[2] || "b").toLowerCase();

      return Math.floor(Number(match[1]) * BYTE_UNITS[unit]!);
    }
  }

  if (limit === undefined) {
    return DEFAULT_LIMIT_BYTES;
  }

  throw new TypeError(`A body limit of "${String(limit)}" is not a size.`);
};

/*
 * The request as body-parser reads it: the request's headers (whose Content-
 * Type, Content-Encoding and Content-Length it reads), its body so far, and
 * the bytes this hands it. No socket: so when body-parser refuses a body and
 * goes to read the rest of it off before it answers (on-finished takes a
 * message with no socket for one already finished), it reads nothing more.
 */
class RequestStandIn extends Readable {
  public readonly headers: IncomingHttpHeaders;
  public body: unknown;
  public _body: boolean | undefined;
  // IncomingMessage's: false until the body is in (see above).
  public complete: boolean = false;
  public readonly [REQUEST_BEHIND]: ExpressRequest;

  public constructor(
    req: ExpressRequest,
    private readonly onRead: () => void,
    // The headers the parser reads, when they are not the request's own.
    headers?: IncomingHttpHeaders | undefined,
  ) {
    super();
    this.headers = headers || req.headers;
    this.body = (req as { body?: unknown }).body;
    this[REQUEST_BEHIND] = req;

    /*
     * The request's error is handed on as the stand-in's (the parser reads
     * it). A parser reading through a pipe - a deflate body's inflate -
     * listens there instead, and an "error" with no listener would throw.
     */
    this.on("error", (): void => {});
  }

  public override _read(): void {
    this.onRead();
  }
}

// The request a verify function is to be given: the one behind a stand-in.
const requestBehind: (req: ExpressRequest) => ExpressRequest = (
  req: ExpressRequest,
): ExpressRequest => {
  return (req as unknown as Partial<RequestStandIn>)[REQUEST_BEHIND] || req;
};

/*
 * What the parser made of the stand-in, handed to the request: its body, and
 * body-parser's mark that it read it, so no parser after it reads it again.
 */
const handBack: (standIn: RequestStandIn, req: ExpressRequest) => void = (
  standIn: RequestStandIn,
  req: ExpressRequest,
): void => {
  req.body = standIn.body;

  if (standIn._body) {
    (req as { _body?: boolean })._body = true;
  }
};

/*
 * The bytes of a body read before and kept, not yet parsed: the gzip
 * reader's, inflated (GzipRequestBody leaves them in req.body). Null for any
 * other body: one not read, or parsed already into something else.
 */
export const keptBodyBytesOf: (req: ExpressRequest) => Buffer | null = (
  req: ExpressRequest,
): Buffer | null => {
  if ((req as { _body?: unknown })._body === true) {
    return null;
  }

  const body: unknown = (req as { body?: unknown }).body;

  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }

  return null;
};

/*
 * The headers a kept body is parsed under: the request's, as if its bytes
 * had been sent as they are now - inflated, so with no Content-Encoding, and
 * as many of them as there are.
 */
const headersOfKeptBody: (
  headers: IncomingHttpHeaders,
  length: number,
) => IncomingHttpHeaders = (
  headers: IncomingHttpHeaders,
  length: number,
): IncomingHttpHeaders => {
  const kept: IncomingHttpHeaders = { ...headers };

  delete kept["content-encoding"];
  delete kept["transfer-encoding"];
  kept["content-length"] = String(length);

  return kept;
};

/*
 * A body read before, whose bytes were kept (see keptBodyBytesOf): handed to
 * the parser from those bytes, as the same body sent uncompressed. Nothing
 * more is read off the request: it is all in.
 */
class KeptBodyRead {
  private isSettled: boolean = false;
  private readonly standIn: RequestStandIn;

  public constructor(
    private readonly req: ExpressRequest,
    private readonly res: ExpressResponse,
    private readonly next: NextFunction,
    bytes: Buffer,
  ) {
    this.standIn = new RequestStandIn(
      req,
      (): void => {},
      headersOfKeptBody(req.headers, bytes.length),
    );
    this.standIn.complete = true;

    if (bytes.length > 0) {
      this.standIn.push(bytes);
    }

    this.standIn.push(null);
  }

  public start(parser: RequestHandler): void {
    parser(
      this.standIn as unknown as ExpressRequest,
      this.res,
      this.onParsed as NextFunction,
    );
  }

  private onParsed = (err?: unknown): void => {
    if (this.isSettled) {
      return;
    }

    this.isSettled = true;
    handBack(this.standIn, this.req);

    if (!err) {
      this.next();
      return;
    }

    this.next(isInflateError(err) ? createInflateFailedError(err) : err);
  };
}

// One request's body: fed to body-parser's stand-in, held to the limit.
class BoundedBodyRead {
  private isSettled: boolean = false;
  private isFeeding: boolean = false;
  private hasRequestEnded: boolean = false;
  private bytesRead: number = 0;
  private readonly standIn: RequestStandIn;

  public constructor(
    private readonly req: ExpressRequest,
    private readonly res: ExpressResponse,
    private readonly next: NextFunction,
    private readonly limitBytes: number,
  ) {
    this.standIn = new RequestStandIn(req, this.onStandInRead);
  }

  public start(parser: RequestHandler): void {
    parser(
      this.standIn as unknown as ExpressRequest,
      this.res,
      this.onParsed as NextFunction,
    );

    // Answered already: passed over, or refused before a byte was read.
    if (this.isSettled) {
      return;
    }

    // Not a body this parser reads: it is left for whatever reads it next.
    if (!this.standIn._body) {
      return;
    }

    /*
     * Content-Length is advisory (a chunked request carries none), but one
     * over the limit is refused before a byte is read.
     */
    const declaredLength: number = parseInt(
      headerValueToString(this.req.headers["content-length"]) || "",
      10,
    );

    if (!isNaN(declaredLength) && declaredLength > this.limitBytes) {
      this.refuse(createTooLargeError(this.limitBytes, declaredLength));
      return;
    }

    this.isFeeding = true;
    this.req.on("data", this.onRequestData);
    this.req.on("end", this.onRequestEnd);
    this.req.on("aborted", this.onRequestAborted);
    this.req.on("error", this.onRequestError);
    this.req.on("close", this.onRequestClose);
  }

  private onRequestData = (chunk: Buffer | string): void => {
    if (this.isSettled) {
      return;
    }

    const bytes: Buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk, "utf-8");

    this.bytesRead += bytes.length;

    // Refused at the chunk that passes the limit: it never reaches the parser.
    if (this.bytesRead > this.limitBytes) {
      this.refuse(createTooLargeError(this.limitBytes, this.bytesRead));
      return;
    }

    // The parser is behind (a deflate body inflating): wait for it.
    if (!this.standIn.push(bytes)) {
      this.req.pause();
    }
  };

  // The parser is ready for more.
  private onStandInRead = (): void => {
    if (this.isFeeding && !this.isSettled && !this.hasRequestEnded) {
      this.req.resume();
    }
  };

  private onRequestEnd = (): void => {
    this.hasRequestEnded = true;
    this.standIn.complete = true;

    if (!this.isSettled) {
      this.standIn.push(null);
    }
  };

  /*
   * The client went away, or its stream broke: told to the parser as the
   * request would have told it, which refuses the body as it always has.
   */
  private onRequestAborted = (): void => {
    if (!this.isSettled) {
      this.standIn.emit("aborted");
    }
  };

  private onRequestError = (error: Error): void => {
    if (!this.isSettled) {
      this.standIn.destroy(error);
    }
  };

  // Nothing came of it: there is nobody left to answer.
  private onRequestClose = (): void => {
    if (this.hasRequestEnded || this.isSettled) {
      return;
    }

    this.settle();
  };

  // body-parser is done: the body parsed, or refused.
  private onParsed = (err?: unknown): void => {
    if (this.isSettled) {
      return;
    }

    this.settle();
    handBack(this.standIn, this.req);

    if (!err) {
      this.next();
      return;
    }

    // Refused before the body was in: not a byte more of it is read.
    if (!this.hasRequestEnded) {
      stopReadingRequestBody(this.req, this.res);
    }

    this.next(isInflateError(err) ? createInflateFailedError(err) : err);
  };

  private refuse(error: Error): void {
    if (this.isSettled) {
      return;
    }

    this.settle();
    stopReadingRequestBody(this.req, this.res);

    // body-parser waits on the stand-in: nothing more comes to it.
    this.standIn.destroy();

    this.next(error);
  }

  private settle(): void {
    this.isSettled = true;

    if (this.isFeeding) {
      this.req.removeListener("data", this.onRequestData);
      this.req.removeListener("end", this.onRequestEnd);
      this.req.removeListener("aborted", this.onRequestAborted);
      this.req.removeListener("error", this.onRequestError);
      this.req.removeListener("close", this.onRequestClose);
    }
  }
}

export default class RequestBodyParser {
  /*
   * body-parser's `create` (express.json, express.urlencoded, express.raw,
   * express.text) made with `options`, reading no further than its limit (see
   * above). Its verify, if any, is given the request itself.
   */
  public static create(
    create: GenericFunction,
    options: RequestBodyParserOptions,
  ): RequestHandler {
    const limitBytes: number = parseBodyLimit(options.limit);
    const verify: RequestBodyParserOptions["verify"] = options.verify;

    const parser: RequestHandler = create({
      ...options,
      limit: limitBytes,
      verify: verify
        ? (
            req: ExpressRequest,
            res: ExpressResponse,
            buf: Buffer,
            encoding?: string,
          ): void => {
            verify(requestBehind(req), res, buf, encoding);
          }
        : undefined,
    }) as RequestHandler;

    return (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): void => {
      // Parsed before: body-parser passes it over, as it always has.
      if ((req as { _body?: unknown })._body === true) {
        parser(req, res, next);
        return;
      }

      // Read before, its bytes kept: parsed from them (see above).
      const kept: Buffer | null = keptBodyBytesOf(req);

      if (kept) {
        new KeptBodyRead(req, res, next, kept).start(parser);
        return;
      }

      // Read whole by something that kept nothing: there is nothing to parse.
      if (req.readableEnded) {
        next();
        return;
      }

      // Its client went away before it was read: cut off, as mid-body.
      if (req.destroyed || req.readable === false) {
        next(createCutOffError());
        return;
      }

      new BoundedBodyRead(req, res, next, limitBytes).start(parser);
    };
  }
}
