import { MAX_SESSION_REPLAY_CHUNK_BYTES } from "Common/Types/Rum/SessionReplay";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  headerValueToString,
} from "Common/Server/Utils/Express";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import logger, {
  getLogAttributesFromRequest,
} from "Common/Server/Utils/Logger";

/*
 * Read a session-replay chunk POST into a raw Buffer, with the byte cap the
 * OTLP equivalent (OtelRequestMiddleware.parseBody) does not have.
 *
 * Two things this deliberately does NOT do:
 *
 *  - It does not gunzip. Decompression is CPU-bound and belongs in the
 *    worker; the HTTP path stages opaque bytes and answers 202.
 *  - It does not destroy the socket on an oversized body. See below.
 */
export default class SessionReplayRequestMiddleware {
  @CaptureSpan()
  public static async parseBody(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      /*
       * Early-out kept from the OTLP middleware: something upstream already
       * produced a body. On this route that can only happen if the
       * StartServer bypass predicate stopped matching, which is a
       * misconfiguration - the gzip fast-path there has no size limit at
       * all, so the cap below would silently never run. Log loudly rather
       * than proceeding as if all is well.
       */
      if (req.body !== undefined && req.body !== null) {
        logger.warn(
          "SessionReplayRequestMiddleware: request body was already parsed upstream, so the session replay byte cap did not run. Check the body-parser bypass predicates in StartServer.",
          getLogAttributesFromRequest(req as any),
        );
        return next();
      }

      /*
       * Cheap pre-check before reading a single byte. Content-Length is
       * advisory (a chunked request has none) but when it is present and
       * over the cap there is no reason to read the body at all.
       */
      const contentLengthHeader: string | undefined = headerValueToString(
        req.headers["content-length"],
      );

      if (contentLengthHeader) {
        const declaredLength: number = parseInt(contentLengthHeader, 10);

        if (
          !isNaN(declaredLength) &&
          declaredLength > MAX_SESSION_REPLAY_CHUNK_BYTES
        ) {
          SessionReplayRequestMiddleware.rejectTooLarge(res, declaredLength);
          return;
        }
      }

      const result: Buffer | null = await new Promise<Buffer | null>(
        (
          resolve: (value: Buffer | null) => void,
          reject: (err: Error) => void,
        ) => {
          const chunks: Array<Uint8Array> = [];
          let receivedBytes: number = 0;
          let rejected: boolean = false;

          const onData: (chunk: Buffer | string) => void = (
            chunk: Buffer | string,
          ): void => {
            if (rejected) {
              return;
            }

            const asBuffer: Buffer = Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk, "utf-8");

            receivedBytes += asBuffer.length;

            if (receivedBytes > MAX_SESSION_REPLAY_CHUNK_BYTES) {
              rejected = true;

              /*
               * ORDER MATTERS. Send the 413 FIRST, and never req.destroy().
               *
               * Destroying the socket makes the client see a network error
               * rather than a status code. The recorder classifies network
               * errors as retryable and 413 as terminal-drop, so a teardown
               * would have it retry the same oversized chunk forever while
               * we never even tell it what went wrong.
               *
               * After answering we stop accumulating and drain the rest of
               * the request. Draining (rather than ignoring) lets Node
               * finish the request cleanly so the keep-alive connection
               * stays usable for the next, correctly-sized, chunk.
               */
              SessionReplayRequestMiddleware.rejectTooLarge(res, receivedBytes);

              chunks.length = 0;

              req.removeListener("data", onData);
              req.resume();

              resolve(null);
              return;
            }

            chunks.push(new Uint8Array(asBuffer));
          };

          req.on("data", onData);

          req.on("end", () => {
            if (rejected) {
              return;
            }

            resolve(Buffer.concat(chunks));
          });

          req.on("error", (err: Error) => {
            if (rejected) {
              return;
            }

            reject(err);
          });
        },
      );

      if (result === null) {
        // Already answered with 413. Do not continue down the stack.
        return;
      }

      req.body = result;

      next();
    } catch (err) {
      return next(err);
    }
  }

  private static rejectTooLarge(res: ExpressResponse, bytes: number): void {
    if (res.headersSent) {
      return;
    }

    res.status(413).json({
      error: "payload-too-large",
      message: `A session replay chunk request may not exceed ${MAX_SESSION_REPLAY_CHUNK_BYTES} bytes. Received at least ${bytes}.`,
    });
  }
}
