import BadRequestException from "../../Types/Exception/BadRequestException";
import PayloadTooLargeException from "../../Types/Exception/PayloadTooLargeException";
import {
  ExpressRaw,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import { LARGE_REQUEST_BODY_BYTES } from "../Utils/RequestBodyLimit";
import {
  MULTIPART_LIMIT_TYPE,
  MULTIPART_MALFORMED_TYPE,
  REQUEST_BODY_REFUSAL_MESSAGES,
  markAsRequestBodyRefusal,
  withAppRequestBodyLimit,
} from "../Utils/RequestBodyRefusal";
import RequestBodyParser from "./RequestBodyParser";
import multer from "multer";
import { RequestHandler } from "express";

/*
 * Ceilings for multipart bodies.
 *
 * memoryStorage means every part is buffered in the process, and
 * Pyroscope ingest, source maps and dSYMs mount this middleware BEFORE
 * their auth check (TelemetryIngest). So these are the limits an
 * unauthenticated caller is held to, and multer's defaults leave most of
 * them at Infinity: file size, file count, field count and part count are
 * all unbounded out of the box (only fieldSize has a default, 1 MB). The
 * SendGrid inbound email webhook reads a body only once its request has
 * shown the installation's webhook secret (refuseUnlessFromMailProvider).
 *
 * The sizes match the 50 MiB body-parser limit the rest of the app uses,
 * and nginx cuts the shipped deployment lower still (50M on
 * /incoming-email, /source-maps and /dsyms, 16M on /pyroscope). The
 * COUNTS are the part that was genuinely missing: without them a body of
 * ten thousand one-byte parts costs ten thousand allocations and passes
 * every size check.
 *
 * THE BODY AS A WHOLE IS HELD TO ITS ROUTE'S LIMIT, AS EVERY BODY IS (#10643).
 * multer used to read the request itself, and nothing held the body as a
 * whole: fifty files of 50 MiB each passed every limit above and were held
 * in memory, before any key was checked. A body it refused - a file one
 * byte over, a file too many - was then read to its end before the 413 was
 * sent (multer drains the request first), and logged; a gzip body, which
 * StartServer had already inflated, was read again from its spent stream,
 * and a deflate or malformed one was not read at all: each a 500 with an
 * error-level log line, from any client. Now the body is read as every
 * other is (RequestBodyParser), and multer parses the bytes read:
 *
 *   - held to what its route takes, as sent and once inflated
 *     (RequestBodyLimit, as StartServer set it for the request: 50 MiB on
 *     every route that mounts this), and refused past it without the rest
 *     read, the connection closed once the 413 is sent - as nginx refuses
 *     more than its 50M before the App sees it. A file at the 50 MiB file
 *     limit does not fit in a 50 MiB body with its part's headers, as it
 *     never fitted through nginx;
 *   - a gzip body from the bytes StartServer inflated, a deflate body
 *     inflated as body-parser inflates it, any other encoding refused 415;
 *   - what multer refuses, and a body that is no multipart form, answered
 *     4xx as before, in the same words, and logged at debug like every
 *     other refused body (RequestBodyRefusal): never drained, never a 500.
 *
 * Parsing from bytes read whole holds the body and its parts at once - up
 * to twice the route's limit for as long as multer takes - where nothing
 * held the parts at all before.
 */
export const MAX_MULTIPART_FILE_BYTES: number = 50 * 1024 * 1024;
export const MAX_MULTIPART_FIELD_BYTES: number = 25 * 1024 * 1024;
export const MAX_MULTIPART_FILES: number = 50;
export const MAX_MULTIPART_FIELDS: number = 200;

/*
 * Every multipart protocol that uses this shared pre-auth parser has flat
 * field names. Multer 2.3 provides these opt-in guards for append-field:
 * without them, one deeply nested name or a maximum-length numeric array
 * index can consume CPU and memory before authentication. Zero is the minimum
 * each protocol needs and rejects bracket notation before append-field expands it.
 * The array-index limit is defense in depth if a future protocol deliberately
 * raises the nesting depth to accept one bracket group.
 */
export const MAX_MULTIPART_FIELD_NESTING_DEPTH: number = 0;
export const MAX_MULTIPART_FIELD_ARRAY_INDEX: number = 0;

/*
 * busboy's SIZE limits and its `parts` counter are EXCLUSIVE: each fires
 * the moment the counter REACHES the limit, so handing it N admits only
 * N-1. Its `files` and `fields` counters are INCLUSIVE -- N admits N.
 *
 * Multer 2.5 normalizes `fileSize`, `fieldSize` and `parts` to inclusive
 * application limits before it calls busboy: it hands busboy each one plus
 * one. So the INCLUSIVE maxima above - the ones this app documents and that
 * callers range-check against (`file.buffer.length >
 * MAX_SOURCE_MAP_SIZE_IN_BYTES` and friends) - go to Multer as they are.
 * package.json requires multer ^2.5.0 for that reason.
 *
 * Each conversion has caused a live boundary bug when it was made twice or
 * not at all. A file of exactly 50 MiB must remain accepted by multer (in a
 * body its route lets through: see above), but adding one here as well as
 * in Multer would admit 50 MiB + 1. Multer 2.3 and 2.4
 * normalized `fileSize` only, and this module added the one to `fieldSize`
 * and `parts` itself; under 2.5 that admitted a field value one byte over
 * the limit. And `parts`, whose whole job is to allow the file and field
 * allowances in full, once rejected a body carrying exactly both with
 * LIMIT_PART_COUNT.
 */

/* Installed DefinitelyTyped definitions do not declare these options yet. */
type HardenedMulterLimits = NonNullable<multer.Options["limits"]> & {
  fieldNestingDepth: number;
  fieldArrayIndexLimit: number;
};

// busboy as multer hands it to a stream handler: what the bytes are written to.
interface BusboyWritable {
  end: (chunk?: Buffer) => void;
}

type HardenedMulterOptions = multer.Options & {
  // Multer 2.5's: what feeds busboy the body, in place of `req.pipe(busboy)`.
  streamHandler: (req: ExpressRequest, busboy: BusboyWritable) => void;
};

// The bytes of a body read (see above), where multer's stream handler finds them.
const MULTIPART_BYTES: unique symbol = Symbol("MultipartFormData.bytes");

type RequestWithBytes = ExpressRequest & { [MULTIPART_BYTES]?: Buffer };

/*
 * multer's stream handler: busboy is given the bytes read, all at once, and
 * never the request - which is all read by now, so nothing multer does once
 * it refuses a body (it drains the request before it answers) reads any more
 * of it.
 */
const feedReadBytes: (req: ExpressRequest, busboy: BusboyWritable) => void = (
  req: ExpressRequest,
  busboy: BusboyWritable,
): void => {
  const bytes: Buffer | undefined = (req as RequestWithBytes)[MULTIPART_BYTES];

  delete (req as RequestWithBytes)[MULTIPART_BYTES];

  busboy.end(bytes || Buffer.alloc(0));
};

/*
 * Configure multer for handling multipart/form-data
 * Uses memory storage to store files in memory as Buffer objects
 */
const buildUploadAny: (maxFiles: number) => RequestHandler = (
  maxFiles: number,
): RequestHandler => {
  const limits: HardenedMulterLimits = {
    fileSize: MAX_MULTIPART_FILE_BYTES,
    fieldSize: MAX_MULTIPART_FIELD_BYTES,
    files: maxFiles,
    fields: MAX_MULTIPART_FIELDS,
    fieldNestingDepth: MAX_MULTIPART_FIELD_NESTING_DEPTH,
    fieldArrayIndexLimit: MAX_MULTIPART_FIELD_ARRAY_INDEX,
    /*
     * Parts are files + fields, so this has to allow both in full or it
     * would be the effective limit and the two above would never fire.
     */
    parts: maxFiles + MAX_MULTIPART_FIELDS,
  };

  const options: HardenedMulterOptions = {
    storage: multer.memoryStorage(),
    limits: limits,
    streamHandler: feedReadBytes,
  };

  const upload: multer.Multer = multer(options);

  return upload.any() as unknown as RequestHandler;
};

const uploadAny: RequestHandler = buildUploadAny(MAX_MULTIPART_FILES);

/*
 * The LIMIT_* codes that mean "you sent too much". LIMIT_UNEXPECTED_FILE
 * is deliberately absent: it means the body named a field the route did
 * not ask for, which is a malformed request rather than an oversized one.
 * (`.any()` accepts every field name, so it should not arise here - the
 * distinction is kept so this stays correct if the mount ever narrows.)
 */
const TOO_LARGE_CODES: Set<string> = new Set<string>([
  "LIMIT_PART_COUNT",
  "LIMIT_FILE_SIZE",
  "LIMIT_FILE_COUNT",
  "LIMIT_FIELD_KEY",
  "LIMIT_FIELD_VALUE",
  "LIMIT_FIELD_COUNT",
  "LIMIT_FIELD_NESTING",
  "LIMIT_FIELD_ARRAY_INDEX",
]);

/*
 * What busboy says of a body that is no multipart form it can read - plain
 * Errors, which multer hands on as they are: a Content-Type it cannot read
 * or with no boundary (thrown as busboy is made), a part's header it cannot
 * read, a body or a file that ends before its closing boundary. Each is the
 * client's, and was a 500. Only these: any other error is still the server's.
 */
export const BUSBOY_MALFORMED_BODY_ERRORS: ReadonlySet<string> =
  new Set<string>([
    "Malformed content type",
    "Missing Content-Type",
    "Multipart: Boundary not found",
    "Malformed part header",
    "Unexpected end of form",
    "Unexpected end of file",
  ]);

// busboy's word for a Content-Type it has no parser for, which it names.
const BUSBOY_UNSUPPORTED_TYPE_PREFIX: string = "Unsupported content type: ";

export const isMalformedMultipartBodyError: (err: unknown) => boolean = (
  err: unknown,
): boolean => {
  if (!(err instanceof Error) || err instanceof multer.MulterError) {
    return false;
  }

  return (
    BUSBOY_MALFORMED_BODY_ERRORS.has(err.message) ||
    err.message.startsWith(BUSBOY_UNSUPPORTED_TYPE_PREFIX)
  );
};

/*
 * A limit breach must answer 413 rather than 500. multer signals every limit
 * with a MulterError whose `code` is one of the LIMIT_* values, and nothing
 * downstream knows what those mean - the generic error handler would turn a
 * caller's oversized upload into a server error and page whoever is on call
 * for it. Shared by every middleware this module builds.
 *
 * Each refusal stays the Exception it was, in the same words, and is marked
 * as the client's body refused (RequestBodyRefusal): expressErrorHandler
 * answers it with its status and message, as before, and logs it at debug,
 * as it logs every refused body - not at error, for anyone to fill the log
 * with, before any key is checked.
 */
const handleMulterError: (err: unknown, next: NextFunction) => void = (
  err: unknown,
  next: NextFunction,
): void => {
  if (err instanceof multer.MulterError) {
    const message: string = `Multipart request rejected: ${err.code}.`;

    return next(
      TOO_LARGE_CODES.has(err.code)
        ? markAsRequestBodyRefusal(
            new PayloadTooLargeException(message),
            MULTIPART_LIMIT_TYPE,
            413,
          )
        : markAsRequestBodyRefusal(
            new BadRequestException(message),
            MULTIPART_MALFORMED_TYPE,
            400,
          ),
    );
  }

  if (isMalformedMultipartBodyError(err)) {
    return next(
      markAsRequestBodyRefusal(
        new BadRequestException(
          REQUEST_BODY_REFUSAL_MESSAGES.multipartMalformed,
        ),
        MULTIPART_MALFORMED_TYPE,
        400,
      ),
    );
  }

  return next(err);
};

/*
 * The bytes of a multipart body, read as every body is (RequestBodyParser):
 * held to `bytes` as sent and once inflated, refused past it without the
 * rest read; a gzip body from the bytes StartServer inflated, a deflate one
 * inflated here. One reader per limit, made the first time it is needed.
 */
const MULTIPART_CONTENT_TYPE: string = "multipart/*";

const multipartReaders: Map<number, RequestHandler> = new Map();

const multipartReaderFor: (bytes: number) => RequestHandler = (
  bytes: number,
): RequestHandler => {
  let reader: RequestHandler | undefined = multipartReaders.get(bytes);

  if (!reader) {
    reader = RequestBodyParser.create(ExpressRaw, {
      type: MULTIPART_CONTENT_TYPE,
      limit: bytes,
    });
    multipartReaders.set(bytes, reader);
  }

  return reader;
};

/*
 * What a multipart body is held to as a whole: its route's limit, as
 * StartServer set it for the request (RequestBodyLimit), or the most any
 * route takes when nothing set one.
 */
export const getMultipartBodyLimit: (req: ExpressRequest) => number = (
  req: ExpressRequest,
): number => {
  return (
    (req as OneUptimeRequest).requestBodyLimit?.bytes ||
    LARGE_REQUEST_BODY_BYTES
  );
};

/*
 * Reads a multipart body's bytes (see above), then has `upload` - one of
 * multer's - parse them. A body of another type is passed on as it is.
 */
const readThenParse: (upload: RequestHandler) => RequestHandler = (
  upload: RequestHandler,
): RequestHandler => {
  return (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): void => {
    const limit: number = getMultipartBodyLimit(req);
    const refuse: (err?: unknown) => void = withAppRequestBodyLimit(
      next,
      limit,
    );

    multipartReaderFor(limit)(req, res, ((err?: unknown): void => {
      if (err) {
        return refuse(err);
      }

      const bytes: unknown = req.body;

      // No body was read: none of a type multer parses.
      if (!Buffer.isBuffer(bytes)) {
        return next();
      }

      (req as RequestWithBytes)[MULTIPART_BYTES] = bytes;

      upload(req, res, (uploadErr: unknown): void => {
        delete (req as RequestWithBytes)[MULTIPART_BYTES];

        return handleMulterError(uploadErr, next);
      });
    }) as NextFunction);
  };
};

/*
 * Middleware for handling any file uploads (multipart/form-data)
 * This is useful for webhooks that send data as multipart/form-data (e.g., SendGrid inbound email)
 */
const MultipartFormDataMiddleware: RequestHandler = readThenParse(uploadAny);

/**
 * A multipart middleware for a route that wants a LOWER file count than the
 * shared default.
 *
 * Only downward: maxFiles is clamped to MAX_MULTIPART_FILES. Every route that
 * mounts this middleware parses the body before its own auth check runs, so
 * the shared ceiling is the limit an unauthenticated caller is held to across
 * all of them. A per-route knob that could raise it would widen the pre-auth
 * memory surface of every OTHER route's neighbours by proxy of a config
 * change made for one — so it cannot.
 *
 * Routes that are happy with the default should keep using the default
 * export; this builds a second multer instance, so call it once at module
 * scope and never per request.
 */
export const getMultipartFormDataMiddleware: (options: {
  maxFiles: number;
}) => RequestHandler = (options: { maxFiles: number }): RequestHandler => {
  /*
   * Clamp the DOMAIN as well as the range. busboy compares `files === limit`,
   * which never matches a fractional or NaN limit — so a non-integer would
   * not narrow anything, it would remove the file bound entirely and leave
   * the pre-auth parse unbounded. That is the exact widening this function
   * exists to prevent, so anything not a finite number falls back to the
   * shared ceiling rather than being passed through.
   */
  const requestedMaxFiles: number = options.maxFiles;

  const maxFiles: number = Number.isFinite(requestedMaxFiles)
    ? Math.max(1, Math.min(Math.floor(requestedMaxFiles), MAX_MULTIPART_FILES))
    : MAX_MULTIPART_FILES;

  if (maxFiles === MAX_MULTIPART_FILES) {
    return MultipartFormDataMiddleware;
  }

  return readThenParse(buildUploadAny(maxFiles));
};

export default MultipartFormDataMiddleware;
