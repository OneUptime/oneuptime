import ServerException from "../../Types/Exception/ServerException";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
  headerValueToString,
} from "../Utils/Express";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import Response from "../Utils/Response";
import zlib from "zlib";

/*
 * Ceilings for the global `Content-Encoding: gzip` request path.
 *
 * Both are 50 MiB, which is exactly what body-parser is given for the
 * identity path (`jsonBodyParserOptions.limit` / `urlEncodedBodyParserOptions.limit`,
 * and `bytes("50mb")` is 1024-based too). Announcing gzip must not buy a
 * caller more room than sending the same body uncompressed.
 *
 * They are two constants because they bound two different things and
 * neither alone is sufficient:
 *
 *   - COMPRESSED bounds what arrives on the socket, so a client cannot
 *     stream unbounded bytes into the process.
 *   - DECOMPRESSED bounds what the inflate produces. gzip of repeated
 *     bytes reaches four figures of amplification: 130,479 bytes of gzip
 *     inflates to 134,217,728 bytes (1,029x, measured), so the compressed
 *     cap on its own leaves ~50 GB of expansion on the table.
 */
export const MAX_COMPRESSED_REQUEST_BODY_BYTES: number = 50 * 1024 * 1024;
export const MAX_DECOMPRESSED_REQUEST_BODY_BYTES: number = 50 * 1024 * 1024;

/*
 * Inflate a `Content-Encoding: gzip` request body under hard limits, and
 * hand the decompressed bytes on as `req.body` (a Buffer, which is what
 * this path has always produced).
 *
 * This middleware runs BEFORE routing and therefore before authentication,
 * so every limit here is an unauthenticated-attacker limit.
 *
 * Two implementation notes that are easy to get wrong:
 *
 *   1. It streams. Buffering the whole compressed body and then calling
 *      `zlib.gunzip` would hold the compressed cap AND the decompressed cap
 *      at once, and would not notice a bomb until the last byte arrived.
 *      Feeding a `createGunzip` stream instead trips the cap after ~64 KiB
 *      of a 128 MiB bomb (measured), before most of the body is even sent.
 *
 *   2. It counts the output itself. `maxOutputLength` looks like the right
 *      knob but Node only honours it on the convenience methods
 *      (`zlib.gunzip` / `gunzipSync`); on a `createGunzip` STREAM it is
 *      silently ignored - a stream with `maxOutputLength: 1 MiB` happily
 *      emits 128 MiB. Verified against Node 24. Setting it here would read
 *      as protection while providing none, so the running total below is
 *      what actually enforces the ceiling.
 */
export default class GzipRequestBodyMiddleware {
  public static parseBody(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): void {
    /*
     * Cheap pre-check before a byte is read. Content-Length is advisory (a
     * chunked request carries none) but when it is present and already over
     * the cap there is no reason to accept the body at all.
     */
    const contentLengthHeader: string | undefined = headerValueToString(
      req.headers["content-length"],
    );

    if (contentLengthHeader) {
      const declaredLength: number = parseInt(contentLengthHeader, 10);

      if (
        !isNaN(declaredLength) &&
        declaredLength > MAX_COMPRESSED_REQUEST_BODY_BYTES
      ) {
        GzipRequestBodyMiddleware.rejectTooLarge(
          req,
          res,
          "compressed",
          declaredLength,
          MAX_COMPRESSED_REQUEST_BODY_BYTES,
        );
        return;
      }
    }

    const inflate: zlib.Gunzip = zlib.createGunzip();

    const decoded: Array<Buffer> = [];

    let compressedBytes: number = 0;
    let decompressedBytes: number = 0;
    let requestEnded: boolean = false;
    let awaitingDrain: boolean = false;
    let settled: boolean = false;

    const settle: (finish: () => void) => void = (finish: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;

      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onRequestError);
      req.removeListener("close", onClose);

      inflate.removeAllListeners();

      /*
       * A stream that emits "error" with no listener throws, and an
       * uncaught throw here would turn a memory-exhaustion fix into a
       * process-exit one. Nothing can consume a post-teardown error, so
       * swallow it explicitly rather than leaving the stream bare.
       */
      inflate.on("error", (): void => {});
      inflate.destroy();

      decoded.length = 0;

      finish();
    };

    /*
     * Stop reading rather than draining. The session replay middleware
     * deliberately drains its oversized bodies to keep the keep-alive
     * connection usable for the next chunk, but that is a cooperative
     * first-party client sending a 4 MiB cap's worth of bytes. Here the
     * body we are refusing may be gigabytes from someone who wants us to
     * read them, so we pause: Node flushes the response we already wrote
     * and then closes the connection because the request was never
     * consumed, which is precisely the outcome we want.
     */
    const stopReading: () => void = (): void => {
      if (typeof req.pause === "function") {
        req.pause();
      }
    };

    const onData: (chunk: Buffer | string) => void = (
      chunk: Buffer | string,
    ): void => {
      const asBuffer: Buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk, "utf-8");

      compressedBytes += asBuffer.length;

      if (compressedBytes > MAX_COMPRESSED_REQUEST_BODY_BYTES) {
        settle((): void => {
          stopReading();
          GzipRequestBodyMiddleware.rejectTooLarge(
            req,
            res,
            "compressed",
            compressedBytes,
            MAX_COMPRESSED_REQUEST_BODY_BYTES,
          );
        });
        return;
      }

      /*
       * Honour the inflate's backpressure. zlib does its work on the
       * threadpool, so a socket that is faster than the inflate will
       * otherwise pile the whole compressed body into the writable queue -
       * which is the unbounded buffering this middleware exists to remove,
       * just one object further down. Pausing also means the caps below get
       * to see the output before we accept the next chunk, so a bomb is
       * refused while most of it is still on the wire.
       */
      if (!inflate.write(asBuffer) && !awaitingDrain) {
        awaitingDrain = true;

        if (typeof req.pause === "function") {
          req.pause();
        }

        inflate.once("drain", (): void => {
          awaitingDrain = false;

          if (!settled && typeof req.resume === "function") {
            req.resume();
          }
        });
      }
    };

    const onEnd: () => void = (): void => {
      requestEnded = true;

      /*
       * A request that announced gzip and then sent nothing. `inflate.end()`
       * on an empty stream raises "unexpected end of file", which used to
       * turn every such request - including a bare GET carrying the header -
       * into a 500 plus an error-level log line. Treat it as the empty body
       * it is and let the route decide.
       */
      if (compressedBytes === 0) {
        settle((): void => {
          req.body = Buffer.alloc(0);
          next();
        });
        return;
      }

      inflate.end();
    };

    const onRequestError: (err: Error) => void = (err: Error): void => {
      settle((): void => {
        next(err);
      });
    };

    /*
     * The client hung up mid-body. There is nobody left to answer, so drop
     * the inflate and everything it is holding instead of waiting for a
     * `end` that will never come. `close` also fires on the happy path,
     * after `end`, which is what `requestEnded` guards.
     */
    const onClose: () => void = (): void => {
      if (requestEnded) {
        return;
      }

      settle((): void => {});
    };

    inflate.on("data", (chunk: Buffer): void => {
      decompressedBytes += chunk.length;

      if (decompressedBytes > MAX_DECOMPRESSED_REQUEST_BODY_BYTES) {
        settle((): void => {
          stopReading();
          GzipRequestBodyMiddleware.rejectTooLarge(
            req,
            res,
            "decompressed",
            decompressedBytes,
            MAX_DECOMPRESSED_REQUEST_BODY_BYTES,
          );
        });
        return;
      }

      decoded.push(chunk);
    });

    inflate.on("end", (): void => {
      const body: Buffer = Buffer.concat(
        decoded as unknown as Array<Uint8Array>,
      );

      settle((): void => {
        req.body = body;
        next();
      });
    });

    inflate.on("error", (err: Error): void => {
      settle((): void => {
        logger.error(err, getLogAttributesFromRequest(req as OneUptimeRequest));

        Response.sendErrorResponse(
          req,
          res,
          new ServerException("Error decompressing data"),
        );
      });
    });

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onRequestError);
    req.on("close", onClose);
  }

  private static rejectTooLarge(
    req: ExpressRequest,
    res: ExpressResponse,
    stage: "compressed" | "decompressed",
    bytes: number,
    limit: number,
  ): void {
    if (res.headersSent) {
      return;
    }

    /*
     * debug, not warn or error. This path is unauthenticated, so a level
     * that reaches the log sink by default would hand the same attacker a
     * log-amplification vector in place of the memory one - while still
     * leaving an operator something to turn on when a legitimate client
     * starts getting 413s.
     */
    logger.debug(
      `Rejected a gzip request body: ${stage} size reached ${bytes} bytes, limit is ${limit}.`,
      getLogAttributesFromRequest(req as OneUptimeRequest),
    );

    res.status(413).json({
      message: `Request body too large. The ${stage} body of a gzip-encoded request may not exceed ${limit} bytes.`,
    });
  }
}
