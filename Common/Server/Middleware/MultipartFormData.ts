import BadRequestException from "../../Types/Exception/BadRequestException";
import PayloadTooLargeException from "../../Types/Exception/PayloadTooLargeException";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import multer from "multer";
import { RequestHandler } from "express";

/*
 * Ceilings for multipart bodies.
 *
 * memoryStorage means every part is buffered in the process, and both
 * routes that mount this middleware run it BEFORE their auth check -
 * Pyroscope ingest before isAuthorizedServiceMiddleware, SendGrid inbound
 * before the webhook secret is verified. So these are the limits an
 * unauthenticated caller is held to, and multer's defaults leave most of
 * them at Infinity: file size, file count, field count and part count are
 * all unbounded out of the box (only fieldSize has a default, 1 MB).
 *
 * The sizes match the 50 MiB body-parser limit the rest of the app uses,
 * and nginx cuts the shipped deployment lower still (50M on
 * /incoming-email, its 1M default on /pyroscope). The COUNTS are the part
 * that was genuinely missing: without them a body of ten thousand
 * one-byte parts costs ten thousand allocations and passes every size
 * check.
 */
export const MAX_MULTIPART_FILE_BYTES: number = 50 * 1024 * 1024;
export const MAX_MULTIPART_FIELD_BYTES: number = 25 * 1024 * 1024;
export const MAX_MULTIPART_FILES: number = 50;
export const MAX_MULTIPART_FIELDS: number = 200;

/*
 * Configure multer for handling multipart/form-data
 * Uses memory storage to store files in memory as Buffer objects
 */
const buildUploadAny: (maxFiles: number) => RequestHandler = (
  maxFiles: number,
): RequestHandler => {
  const upload: multer.Multer = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_MULTIPART_FILE_BYTES,
      fieldSize: MAX_MULTIPART_FIELD_BYTES,
      files: maxFiles,
      fields: MAX_MULTIPART_FIELDS,
      /*
       * Parts are files + fields, so this has to allow both in full or it
       * would be the effective limit and the two above would never fire.
       */
      parts: maxFiles + MAX_MULTIPART_FIELDS,
    },
  });

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
]);

/*
 * A limit breach must answer 413 rather than 500. multer signals every limit
 * with a MulterError whose `code` is one of the LIMIT_* values, and nothing
 * downstream knows what those mean - the generic error handler would turn a
 * caller's oversized upload into a server error and page whoever is on call
 * for it. Shared by every middleware this module builds.
 */
const handleMulterError: (err: unknown, next: NextFunction) => void = (
  err: unknown,
  next: NextFunction,
): void => {
  if (err instanceof multer.MulterError) {
    const message: string = `Multipart request rejected: ${err.code}.`;

    return next(
      TOO_LARGE_CODES.has(err.code)
        ? new PayloadTooLargeException(message)
        : new BadRequestException(message),
    );
  }

  return next(err);
};

/*
 * Middleware for handling any file uploads (multipart/form-data)
 * This is useful for webhooks that send data as multipart/form-data (e.g., SendGrid inbound email)
 */
const MultipartFormDataMiddleware: RequestHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): void => {
  uploadAny(req, res, (err: unknown): void => {
    return handleMulterError(err, next);
  });
};

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

  const scopedUploadAny: RequestHandler = buildUploadAny(maxFiles);

  return (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): void => {
    scopedUploadAny(req, res, (err: unknown): void => {
      return handleMulterError(err, next);
    });
  };
};

export default MultipartFormDataMiddleware;
