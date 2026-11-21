import { JsonElementTally } from "../../Utils/JsonElementCount";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
  RequestHandler,
  headerValueToString,
} from "../Utils/Express";
import { RequestBodyLimit } from "../Utils/RequestBodyLimit";
import {
  APP_REQUEST_BODY_LIMIT_FIELD,
  createTooManyJsonValuesError,
} from "../Utils/RequestBodyRefusal";
import { isJsonContentType } from "./GzipRequestBody";
import RequestBodyAfterAuthentication, {
  createJsonParseFailedError,
} from "./RequestBodyAfterAuthentication";
import { PassThrough, Transform, TransformOptions } from "stream";
import zlib from "zlib";

/*
 * A BODY WHOSE SENDER IS NAMED AT ITS START, READ NO FURTHER THAN THAT
 * UNTIL IT IS CHECKED (#10260).
 *
 * A route that takes millions of JSON values checks its caller's key before
 * it reads the body (RequestBodyAfterAuthentication). An older probe sends
 * its key only inside its vCenter or OpenStack collection, at the start of
 * the report (ProbeReportOpening), so such a body had to be read whole -
 * 50 MiB inflated and 8,000,000 values counted - before anyone knew who sent
 * it. A client with no key could have the App inflate, count and hold that
 * much for a few hundred KB of gzip.
 *
 * Here the body is read in two steps:
 *
 *   1. Its opening: the first `openingBytes` of it as it inflates (or all of
 *      it, when it is shorter), from at most MAX_BYTES_READ_FOR_OPENING
 *      bytes as sent. A chunk is read off the socket only once the one
 *      before it is through the inflate, so no more is read or inflated
 *      than the opening takes: a socket read's worth as sent (64 KiB), and
 *      as inflated one zlib output chunk past the opening and one more the
 *      inflate holds (16 KiB each). Nothing is counted or parsed, so neither
 *      the shape of the body - a bomb, a body nested a million deep - nor
 *      its size costs more. Then the request is paused, and `check` reads
 *      the opening.
 *   2. The rest, only when the check lets it through: held to `limit` from
 *      the first byte - its size as sent and inflated, and its values as
 *      they inflate when it is JSON - as RequestBodyAfterAuthentication
 *      reads a body whose caller its headers named.
 *
 * When the check refuses the body, it answers the request itself, and not a
 * byte more is read. Any other refusal here - a body over the limit, a
 * Content-Encoding no parser reads, a compressed body that does not inflate
 * - is handed on as body-parser's error for it, which expressErrorHandler
 * answers in RequestBodyRefusal's words, again with the rest unread.
 *
 * A refused body's connection is closed once its answer is sent
 * ("Connection: close"), whatever the client asked for. Left to itself, Node
 * keeps a keep-alive connection whose body was paused unread open until its
 * keep-alive timeout, and drains one whose body was never touched - reads
 * every byte the client sends - to keep it usable (measured on Node 26). A
 * body the check lets through keeps its connection as the client asked.
 *
 * Bodies are inflated as body-parser inflates them: gzip and deflate.
 */

/*
 * The most bytes read off the wire, as sent, for an opening: a socket's
 * read. Any compressor writes a few kilobytes of opening in a few kilobytes
 * (stored as it is, deflate adds five bytes in 65,535), so only a body made
 * to inflate to nothing - padding in a gzip header, empty gzip members -
 * reaches this, and its opening is then what those bytes inflated to.
 */
export const MAX_BYTES_READ_FOR_OPENING: number = 64 * 1024;

export interface RequestBodyOpeningCheck {
  req: ExpressRequest;
  res: ExpressResponse;
  // The body's first bytes, inflated: at most the opening's bytes.
  opening: Buffer;
}

export interface RequestBodyOpeningOptions {
  // How many of the body's first bytes, inflated, the check reads.
  openingBytes: number;
  // What the whole body is held to once the check lets it through.
  limit: RequestBodyLimit;
  /*
   * Reads the opening, with the request paused: resolves true when the rest
   * may be read, false when it answered the request - a refusal - and then
   * not a byte more is read.
   */
  check: (data: RequestBodyOpeningCheck) => Promise<boolean>;
}

/*
 * body-parser's errors, shaped as it raises them (a type, a 4xx status,
 * exposed), so expressErrorHandler answers each as it answers body-parser's
 * own (RequestBodyRefusal).
 */
const createBodyError: (
  message: string,
  status: number,
  fields: Record<string, unknown>,
) => Error = (
  message: string,
  status: number,
  fields: Record<string, unknown>,
): Error => {
  return Object.assign(new Error(message), {
    ...fields,
    status: status,
    statusCode: status,
    expose: true,
  });
};

/*
 * Over the limit's bytes: as sent, as declared, or as it inflates. Marked as
 * the App's own limit, as StartServer marks body-parser's, so the answer says
 * it.
 */
export const createTooLargeError: (limit: number, bytes: number) => Error = (
  limit: number,
  bytes: number,
): Error => {
  return createBodyError("request entity too large", 413, {
    type: "entity.too.large",
    limit: limit,
    length: bytes,
    [APP_REQUEST_BODY_LIMIT_FIELD]: limit,
  });
};

// A Content-Encoding other than gzip, deflate or identity.
export const createEncodingUnsupportedError: (encoding: string) => Error = (
  encoding: string,
): Error => {
  return createBodyError(`unsupported content encoding "${encoding}"`, 415, {
    type: "encoding.unsupported",
    encoding: encoding,
  });
};

/*
 * Has the answer close its connection once it is sent (see above): Node
 * then answers "Connection: close" and ends the connection, nothing more of
 * the body read and nothing waiting on the rest. Returns whether the
 * connection was to be kept, for a check that lets the body through after
 * all: set back, the answer is the usual keep-alive one.
 */
const closeConnectionAfterAnswer: (res: ExpressResponse) => boolean = (
  res: ExpressResponse,
): boolean => {
  const wasKept: boolean = Boolean(res.shouldKeepAlive);

  if (!res.headersSent) {
    res.shouldKeepAlive = false;
  }

  return wasKept;
};

// The client went away, or its stream broke, before the body was in.
const createAbortedError: (cause: unknown) => Error = (
  cause: unknown,
): Error => {
  return createBodyError(
    cause instanceof Error ? cause.message : "request aborted",
    400,
    { type: "request.aborted", code: "ECONNABORTED" },
  );
};

/*
 * What an inflate may hold, inflated, while the check runs: one zlib output
 * chunk (16 KiB). Past it, the inflate waits for the check instead of
 * inflating on - Node's default, 64 KiB since Node 22, would let it run on
 * four times as far.
 */
const DECODER_HIGH_WATER_MARK: number = 16 * 1024;

/*
 * What a body sent with a Content-Encoding is read through: inflated, for
 * gzip (as RequestBodyAfterAuthentication reads it: any encoding that names
 * it) and deflate, and as it is for none. Null for any other.
 */
const decoderFor: (encoding: string) => Transform | null = (
  encoding: string,
): Transform | null => {
  // zlib hands its options to its Transform, highWaterMark among them.
  const options: zlib.ZlibOptions & TransformOptions = {
    highWaterMark: DECODER_HIGH_WATER_MARK,
  };

  if (encoding.includes("gzip")) {
    return zlib.createGunzip(options);
  }

  if (encoding === "deflate") {
    return zlib.createInflate(options);
  }

  if (encoding === "identity") {
    return new PassThrough(options);
  }

  return null;
};

type Step = "opening" | "checking" | "rest" | "settled";

// One body, read through its two steps (see above).
class OpeningFirstRead {
  private step: Step = "opening";

  // What the body inflated to so far, in order.
  private readonly decoded: Array<Buffer> = [];
  private bytesRead: number = 0;
  private bytesDecoded: number = 0;

  // The values counted once the rest is read, when the body is JSON.
  private tally: JsonElementTally | null = null;

  // A chunk is in the decoder: the next is read once it is through.
  private isWriting: boolean = false;
  private hasRequestEnded: boolean = false;
  private hasDecoderEnded: boolean = false;

  // A decoder error while the check ran, answered once it is done.
  private decoderErrorDuringCheck: Error | null = null;

  public constructor(
    private readonly req: ExpressRequest,
    private readonly res: ExpressResponse,
    private readonly next: NextFunction,
    private readonly options: RequestBodyOpeningOptions,
    private readonly decoder: Transform,
    private readonly countsValues: boolean,
  ) {}

  public start(): void {
    this.req.on("data", this.onRequestData);
    this.req.on("end", this.onRequestEnd);
    this.req.on("error", this.onRequestError);
    this.req.on("close", this.onRequestClose);

    this.decoder.on("data", this.onDecoded);
    this.decoder.on("end", this.onDecoderEnd);
    this.decoder.on("error", this.onDecoderError);
  }

  private onRequestData = (chunk: Buffer | string): void => {
    if (this.step === "settled") {
      return;
    }

    const bytes: Buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk, "utf-8");

    this.bytesRead += bytes.length;

    if (this.bytesRead > this.options.limit.bytes) {
      this.refuse(
        createTooLargeError(this.options.limit.bytes, this.bytesRead),
      );
      return;
    }

    /*
     * One chunk in the decoder at a time: the socket is read again once this
     * one is through, so the opening is decided before more is read, and a
     * bomb is refused while most of it is still on the wire.
     */
    this.pauseRequest();
    this.isWriting = true;
    this.decoder.write(bytes, this.onWritten);
  };

  private onWritten = (): void => {
    this.isWriting = false;

    if (this.step === "opening") {
      // As much as an opening may take was read, and inflated to too little.
      if (this.bytesRead >= MAX_BYTES_READ_FOR_OPENING) {
        this.startCheck();
        return;
      }

      this.resumeRequest();
      return;
    }

    if (this.step === "rest" && !this.hasRequestEnded) {
      this.resumeRequest();
    }
  };

  private onDecoded = (chunk: Buffer): void => {
    if (this.step === "settled") {
      return;
    }

    this.bytesDecoded += chunk.length;

    if (this.step === "rest") {
      if (this.bytesDecoded > this.options.limit.bytes) {
        this.refuse(
          createTooLargeError(this.options.limit.bytes, this.bytesDecoded),
        );
        return;
      }

      if (this.tally && !this.tally.add(chunk)) {
        this.refuse(
          createTooManyJsonValuesError(
            this.tally.getCount(),
            this.options.limit,
          ),
        );
        return;
      }

      this.decoded.push(chunk);
      return;
    }

    // Kept, and counted once the check lets the body through.
    this.decoded.push(chunk);

    if (
      this.step === "opening" &&
      this.bytesDecoded >= this.options.openingBytes
    ) {
      this.startCheck();
    }
  };

  private onRequestEnd = (): void => {
    this.hasRequestEnded = true;

    if (this.step === "settled") {
      return;
    }

    /*
     * Nothing was sent. An empty gzip or deflate stream raises "unexpected
     * end of file": it is the empty body it is.
     */
    if (this.bytesRead === 0) {
      this.onDecoderEnd();
      return;
    }

    this.decoder.end();
  };

  private onDecoderEnd = (): void => {
    this.hasDecoderEnded = true;

    if (this.step === "opening") {
      // The whole body is shorter than an opening: it is the opening.
      this.startCheck();
      return;
    }

    if (this.step === "rest") {
      this.finish();
    }
  };

  private onDecoderError = (error: Error): void => {
    if (this.step === "settled") {
      return;
    }

    // The check may be answering the request: refused once it is done.
    if (this.step === "checking") {
      this.decoderErrorDuringCheck = error;
      return;
    }

    this.refuse(createJsonParseFailedError(error));
  };

  /*
   * The client went away, or its stream broke. There is nobody left to
   * answer while the check may be answering; otherwise the error is
   * body-parser's for it, answered at debug, as any refused body is.
   */
  private onRequestError = (error: Error): void => {
    if (this.step === "checking") {
      this.settle((): void => {});
      return;
    }

    this.settle((): void => {
      this.next(createAbortedError(error));
    });
  };

  // The client hung up mid-body: nothing is left to read or answer.
  private onRequestClose = (): void => {
    if (this.hasRequestEnded) {
      return;
    }

    this.settle((): void => {});
  };

  /*
   * The opening is in hand: the request is paused, the decoder holds what it
   * has inflated past it, and the check reads it. Its answer, should it
   * refuse the body, closes the connection: marked before it runs, and
   * unmarked when it lets the body through.
   */
  private startCheck(): void {
    this.step = "checking";
    this.pauseRequest();
    this.decoder.pause();

    const decodedSoFar: Buffer = Buffer.concat(
      this.decoded as unknown as Array<Uint8Array>,
    );
    const opening: Buffer = decodedSoFar.subarray(
      0,
      Math.min(decodedSoFar.length, this.options.openingBytes),
    );

    const wasConnectionKept: boolean = closeConnectionAfterAnswer(this.res);

    let checked: Promise<boolean>;

    try {
      checked = this.options.check({
        req: this.req,
        res: this.res,
        opening: opening,
      });
    } catch (err) {
      checked = Promise.reject(err);
    }

    checked.then(
      (isAccepted: boolean): void => {
        if (this.step === "settled") {
          return;
        }

        if (!isAccepted) {
          // Answered by the check: the rest stays unread.
          this.settle((): void => {
            this.stopReading();
          });
          return;
        }

        // Let through: its connection is kept, or not, as the client asked.
        if (!this.res.headersSent) {
          this.res.shouldKeepAlive = wasConnectionKept;
        }

        this.startRest();
      },
      (error: unknown): void => {
        if (this.step === "settled") {
          return;
        }

        this.settle((): void => {
          this.stopReading();
          this.next(error);
        });
      },
    );
  }

  // The check let the body through: the rest, held to the limit.
  private startRest(): void {
    this.step = "rest";

    const limit: RequestBodyLimit = this.options.limit;
    (this.req as OneUptimeRequest).requestBodyLimit = limit;

    if (this.decoderErrorDuringCheck) {
      this.refuse(createJsonParseFailedError(this.decoderErrorDuringCheck));
      return;
    }

    if (this.bytesDecoded > limit.bytes) {
      this.refuse(createTooLargeError(limit.bytes, this.bytesDecoded));
      return;
    }

    // What inflated before the check is the body's start: counted first.
    if (this.countsValues) {
      this.tally = new JsonElementTally(limit);

      for (const chunk of this.decoded) {
        if (!this.tally.add(chunk)) {
          this.refuse(
            createTooManyJsonValuesError(this.tally.getCount(), limit),
          );
          return;
        }
      }
    }

    if (this.hasDecoderEnded) {
      this.finish();
      return;
    }

    this.decoder.resume();

    if (!this.isWriting && !this.hasRequestEnded) {
      this.resumeRequest();
    }
  }

  private finish(): void {
    const body: Buffer = Buffer.concat(
      this.decoded as unknown as Array<Uint8Array>,
    );

    this.settle((): void => {
      (this.req as { body?: unknown }).body = body;
      this.next();
    });
  }

  // Refused here: the rest stays unread, and the error is answered.
  private refuse(error: Error): void {
    this.settle((): void => {
      this.stopReading();
      this.next(error);
    });
  }

  private settle(then: () => void): void {
    if (this.step === "settled") {
      return;
    }

    this.step = "settled";

    this.req.removeListener("data", this.onRequestData);
    this.req.removeListener("end", this.onRequestEnd);
    this.req.removeListener("error", this.onRequestError);
    this.req.removeListener("close", this.onRequestClose);

    /*
     * A stream that emits "error" with no listener throws: nothing can
     * consume one after this, so it is swallowed rather than left bare.
     */
    this.decoder.removeAllListeners();
    this.decoder.on("error", (): void => {});
    this.decoder.destroy();

    this.decoded.length = 0;

    then();
  }

  /*
   * Stops reading rather than draining, and has the connection closed once
   * the answer is sent, the rest of the body unread (see above).
   */
  private stopReading(): void {
    this.pauseRequest();
    closeConnectionAfterAnswer(this.res);
  }

  private pauseRequest(): void {
    if (typeof this.req.pause === "function") {
      this.req.pause();
    }
  }

  private resumeRequest(): void {
    if (typeof this.req.resume === "function") {
      this.req.resume();
    }
  }
}

export default class RequestBodyOpening {
  /*
   * Reads a body's opening, has `check` read it, and reads the rest into
   * req.body - its bytes, inflated, unparsed - only when the check lets it
   * through (see above).
   *
   * A body something read before is not read again: its bytes have their
   * opening checked the same way, and a body parsed already goes on as it
   * is, for the route to read its caller from.
   */
  public static readBytes(options: RequestBodyOpeningOptions): RequestHandler {
    return (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): void => {
      RequestBodyOpening.read(req, res, next, options);
    };
  }

  public static read(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
    options: RequestBodyOpeningOptions,
  ): void {
    if (RequestBodyAfterAuthentication.isRead(req)) {
      RequestBodyOpening.checkReadBody(req, res, next, options);
      return;
    }

    const limit: RequestBodyLimit = options.limit;

    /*
     * Content-Length is advisory (a chunked request carries none), but one
     * over the limit is refused before a byte is read.
     */
    const declaredLength: number = parseInt(
      headerValueToString(req.headers["content-length"]) || "",
      10,
    );

    if (!isNaN(declaredLength) && declaredLength > limit.bytes) {
      closeConnectionAfterAnswer(res);
      next(createTooLargeError(limit.bytes, declaredLength));
      return;
    }

    const encoding: string = (
      headerValueToString(req.headers["content-encoding"]) || "identity"
    )
      .trim()
      .toLowerCase();

    const decoder: Transform | null = decoderFor(encoding);

    if (!decoder) {
      closeConnectionAfterAnswer(res);
      next(createEncodingUnsupportedError(encoding));
      return;
    }

    new OpeningFirstRead(
      req,
      res,
      next,
      options,
      decoder,
      isJsonContentType(headerValueToString(req.headers["content-type"])),
    ).start();
  }

  // A body read before: its bytes' opening checked, anything else as it is.
  private static checkReadBody(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
    options: RequestBodyOpeningOptions,
  ): void {
    const body: unknown = (req as { body?: unknown }).body;

    if (!(Buffer.isBuffer(body) || body instanceof Uint8Array)) {
      next();
      return;
    }

    const bytes: Buffer = Buffer.from(
      body.buffer,
      body.byteOffset,
      body.byteLength,
    );

    let checked: Promise<boolean>;

    try {
      checked = options.check({
        req: req,
        res: res,
        opening: bytes.subarray(
          0,
          Math.min(bytes.length, options.openingBytes),
        ),
      });
    } catch (err) {
      checked = Promise.reject(err);
    }

    checked.then(
      (isAccepted: boolean): void => {
        if (isAccepted) {
          next();
        }
      },
      (error: unknown): void => {
        next(error);
      },
    );
  }
}
