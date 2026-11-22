import { describe, expect, jest, test } from "@jest/globals";
import timers from "timers";

/*
 * multer calls `setImmediate` internally (make-middleware.js and
 * remove-uploaded-files.js), and Common's jest environment is jsdom, which
 * does not expose it. A `@jest-environment node` docblock is not an option
 * here - Common's shared jest.setup.ts touches `window`, which is why
 * EsbuildConfig.test.ts spawns a subprocess instead - so lend jsdom the
 * real one from Node.
 */
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * The limits under test are 25 and 50 MiB, so the fixtures that probe them
 * are 25 and 50 MiB of real multipart body parsed by the real busboy.
 * That does not fit in jest's 5s default.
 */
jest.setTimeout(180_000);

/*
 * The multipart reader used by Pyroscope ingest and the SendGrid inbound
 * email webhook.
 *
 * Pyroscope mounts it BEFORE its auth check (isAuthorizedServiceMiddleware),
 * and it uses multer's memoryStorage, so every part it accepts is buffered
 * in the process on behalf of a caller who has not proved anything yet. (The
 * SendGrid webhook mounts it after its webhook secret is checked.)
 *
 * multer's defaults leave almost all of that unbounded: fileSize, files,
 * fields and parts are all Infinity out of the box, and only fieldSize
 * has a default at all. These tests pin the limits and the status code a
 * breach produces, because the failure mode of getting this wrong is
 * silent - an unbounded upload looks exactly like a working one until the
 * pod dies.
 */

import MultipartFormDataMiddleware, {
  BUSBOY_MALFORMED_BODY_ERRORS,
  getMultipartBodyLimit,
  getMultipartFormDataMiddleware,
  isMalformedMultipartBodyError,
  MAX_MULTIPART_FIELD_ARRAY_INDEX,
  MAX_MULTIPART_FIELDS,
  MAX_MULTIPART_FIELD_BYTES,
  MAX_MULTIPART_FIELD_NESTING_DEPTH,
  MAX_MULTIPART_FILES,
  MAX_MULTIPART_FILE_BYTES,
} from "../../../Server/Middleware/MultipartFormData";
import {
  SourceMapMaxFilesPerRequest,
  SourceMapMaxFileSizeInBytes,
} from "../../../Server/EnvironmentConfig";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  RequestHandler,
} from "../../../Server/Utils/Express";
import {
  LARGE_REQUEST_BODY_BYTES,
  LARGE_REQUEST_BODY_LIMIT,
  RequestBodyLimit,
} from "../../../Server/Utils/RequestBodyLimit";
import readRequestBodyRefusal, {
  MULTIPART_LIMIT_TYPE,
  MULTIPART_MALFORMED_TYPE,
  REQUEST_BODY_REFUSAL_MESSAGES,
  getTooLargeForRouteMessage,
} from "../../../Server/Utils/RequestBodyRefusal";
import BadRequestException from "../../../Types/Exception/BadRequestException";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import PayloadTooLargeException from "../../../Types/Exception/PayloadTooLargeException";
import { UNEXPLAINED_ERROR_MESSAGES } from "../../../Types/Exception/UnexplainedError";
import fs from "fs";
import multer from "multer";
import path from "path";
import { Readable } from "stream";
import zlib from "zlib";

const BOUNDARY: string = "----oneuptimetestboundary";

interface MultipartPart {
  name: string;
  value: Buffer;
  filename?: string;
}

function buildMultipartBody(parts: Array<MultipartPart>): Buffer {
  const chunks: Array<Buffer> = [];

  for (const part of parts) {
    const disposition: string = part.filename
      ? `form-data; name="${part.name}"; filename="${part.filename}"`
      : `form-data; name="${part.name}"`;

    const header: string =
      `--${BOUNDARY}\r\n` +
      `Content-Disposition: ${disposition}\r\n` +
      (part.filename ? "Content-Type: application/octet-stream\r\n" : "") +
      "\r\n";

    chunks.push(Buffer.from(header));
    chunks.push(part.value);
    chunks.push(Buffer.from("\r\n"));
  }

  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));

  return Buffer.concat(chunks as unknown as Array<Uint8Array>);
}

interface Outcome {
  req: ExpressRequest;
  error: unknown;
  nextCalls: number;
}

interface RunOptions {
  /*
   * Which handler to drive. Defaults to the shared export, so every call
   * written before getMultipartFormDataMiddleware existed still reads as
   * "the middleware".
   */
  middleware?: RequestHandler;
  /*
   * Override the Content-Type header, for the one case that needs a
   * multipart request busboy cannot parse at all.
   */
  contentType?: string;
  /*
   * The bytes the request's route takes (RequestBodyLimit), as StartServer
   * sets it on every request it routes. None: the most any route takes.
   */
  bodyLimit?: number;
  // The body as sent, in place of the parts': a malformed one.
  rawBody?: Buffer;
  // The Content-Encoding the body is sent with.
  contentEncoding?: string;
}

const MIB: number = 1024 * 1024;

/*
 * A body limit with room for a file at multer's own file limit and its
 * part's headers: what the tests of multer's file limit run under. The
 * routes that mount the middleware take 50 MiB as a whole, so through them
 * a file at the file limit no longer fits (see "the body as a whole").
 */
const ROOM_FOR_A_FILE_AT_ITS_LIMIT: number = MAX_MULTIPART_FILE_BYTES + MIB;

function routeLimit(bytes: number): RequestBodyLimit {
  return {
    bytes: bytes,
    values: LARGE_REQUEST_BODY_LIMIT.values,
    objectsArraysAndStrings: LARGE_REQUEST_BODY_LIMIT.objectsArraysAndStrings,
  };
}

/*
 * Drive the middleware with a real multipart body over a real Readable, so
 * busboy does the parsing it does in production rather than being faked.
 */
function run(
  parts: Array<MultipartPart>,
  options?: RunOptions,
): Promise<Outcome> {
  const middleware: RequestHandler =
    options && options.middleware
      ? options.middleware
      : MultipartFormDataMiddleware;

  const body: Buffer =
    options && options.rawBody ? options.rawBody : buildMultipartBody(parts);

  const req: Readable & {
    headers: Record<string, string>;
    body?: unknown;
    files?: unknown;
    requestBodyLimit?: RequestBodyLimit;
  } = Readable.from([body]) as never;

  req.headers = {
    "content-type":
      options && options.contentType
        ? options.contentType
        : `multipart/form-data; boundary=${BOUNDARY}`,
    "content-length": String(body.length),
  };

  if (options && options.contentEncoding) {
    req.headers["content-encoding"] = options.contentEncoding;
  }

  if (options && options.bodyLimit !== undefined) {
    req.requestBodyLimit = routeLimit(options.bodyLimit);
  }

  const res: ExpressResponse = {
    status: (): unknown => {
      return { send: (): void => {}, json: (): void => {} };
    },
    headersSent: false,
  } as unknown as ExpressResponse;

  return new Promise<Outcome>((resolve: (value: Outcome) => void): void => {
    let nextCalls: number = 0;

    middleware(req as unknown as ExpressRequest, res, ((
      err?: unknown,
    ): void => {
      nextCalls++;
      resolve({
        req: req as unknown as ExpressRequest,
        error: err,
        nextCalls: nextCalls,
      });
    }) as NextFunction);
  });
}

/*
 * `count` one-byte files. The count limits are what these fixtures probe, so
 * the payload per file is deliberately trivial.
 */
function tinyFiles(count: number): Array<MultipartPart> {
  return Array.from(
    { length: count },
    (_v: unknown, i: number): MultipartPart => {
      return {
        name: `f${i}`,
        value: Buffer.from("x"),
        filename: `f${i}.bin`,
      };
    },
  );
}

function files(outcome: Outcome): Array<{ fieldname: string; buffer: Buffer }> {
  return (outcome.req.files || []) as Array<{
    fieldname: string;
    buffer: Buffer;
  }>;
}

describe("MultipartFormData - the limits are set where they were reasoned about", () => {
  test("sizes match the app-wide 50 MiB body-parser number", () => {
    expect(MAX_MULTIPART_FILE_BYTES).toBe(50 * 1024 * 1024);
    expect(MAX_MULTIPART_FIELD_BYTES).toBe(25 * 1024 * 1024);
  });

  test("counts are bounded at all, which is the part multer leaves at Infinity", () => {
    expect(MAX_MULTIPART_FILES).toBe(50);
    expect(MAX_MULTIPART_FIELDS).toBe(200);
    expect(Number.isFinite(MAX_MULTIPART_FILES)).toBe(true);
    expect(Number.isFinite(MAX_MULTIPART_FIELDS)).toBe(true);
  });

  test("append-field nesting and numeric indexes use the minimum flat-name limits", () => {
    expect(MAX_MULTIPART_FIELD_NESTING_DEPTH).toBe(0);
    expect(MAX_MULTIPART_FIELD_ARRAY_INDEX).toBe(0);
  });

  test("the source map env knobs cannot be configured past these two ceilings", () => {
    /*
     * Common/Server/EnvironmentConfig.ts clamps SOURCE_MAP_MAX_FILES_PER_REQUEST
     * to 50 and SOURCE_MAP_MAX_FILE_SIZE_BYTES to 50 MiB, and repeats both as
     * literals rather than importing them - config has no business pulling in
     * multer and express. That copy is the thing this pins: if either constant
     * here moves DOWN, the config default silently becomes unenforceable and
     * multer starts aborting requests the config layer thought it had accepted
     * (a 413 where the operator was promised a 400).
     */
    expect(SourceMapMaxFilesPerRequest).toBeLessThanOrEqual(
      MAX_MULTIPART_FILES,
    );
    expect(SourceMapMaxFileSizeInBytes).toBeLessThanOrEqual(
      MAX_MULTIPART_FILE_BYTES,
    );
  });
});

describe("MultipartFormData - normal bodies still parse", () => {
  test("a single file arrives as a Buffer on req.files", async () => {
    const outcome: Outcome = await run([
      { name: "profile", value: Buffer.from("pprof-bytes"), filename: "p.pb" },
    ]);

    expect(outcome.error).toBeUndefined();
    expect(files(outcome)).toHaveLength(1);
    expect(files(outcome)[0]!.fieldname).toBe("profile");
    expect(files(outcome)[0]!.buffer.toString()).toBe("pprof-bytes");
  });

  test("fields and files together, the SendGrid shape", async () => {
    const outcome: Outcome = await run([
      { name: "from", value: Buffer.from("someone@example.com") },
      { name: "subject", value: Buffer.from("hello") },
      { name: "attachment-info", value: Buffer.from("{}") },
      { name: "attachment1", value: Buffer.from("PDF"), filename: "a.pdf" },
    ]);

    expect(outcome.error).toBeUndefined();
    expect((outcome.req.body as Record<string, string>)["from"]).toBe(
      "someone@example.com",
    );
    expect(
      (outcome.req.body as Record<string, string>)["attachment-info"],
    ).toBe("{}");
    expect(files(outcome)).toHaveLength(1);
  });

  test("a body with no parts at all is fine", async () => {
    const outcome: Outcome = await run([]);

    expect(outcome.error).toBeUndefined();
    expect(files(outcome)).toHaveLength(0);
  });

  test("a file right at the count limit is accepted", async () => {
    const outcome: Outcome = await run(
      Array.from({ length: MAX_MULTIPART_FILES }, (_v: unknown, i: number) => {
        return {
          name: `f${i}`,
          value: Buffer.from("x"),
          filename: `f${i}.bin`,
        };
      }),
    );

    expect(outcome.error).toBeUndefined();
    expect(files(outcome)).toHaveLength(MAX_MULTIPART_FILES);
  });

  test("fields right at the count limit are accepted", async () => {
    const outcome: Outcome = await run(
      Array.from({ length: MAX_MULTIPART_FIELDS }, (_v: unknown, i: number) => {
        return { name: `k${i}`, value: Buffer.from("v") };
      }),
    );

    expect(outcome.error).toBeUndefined();
    expect(
      Object.keys(outcome.req.body as Record<string, unknown>),
    ).toHaveLength(MAX_MULTIPART_FIELDS);
  });
});

describe("MultipartFormData - breaches answer 413, not 500", () => {
  test("one file over the size limit", async () => {
    const outcome: Outcome = await run(
      [
        {
          name: "big",
          value: Buffer.alloc(MAX_MULTIPART_FILE_BYTES + 1),
          filename: "big.bin",
        },
      ],
      { bodyLimit: ROOM_FOR_A_FILE_AT_ITS_LIMIT },
    );

    expect(outcome.error).toBeInstanceOf(Exception);
    expect((outcome.error as Exception).code).toBe(
      ExceptionCode.PayloadTooLargeException,
    );
    expect((outcome.error as Exception).code).toBe(413);
    expect((outcome.error as Exception).message).toContain("LIMIT_FILE_SIZE");
  });

  test("one file too many", async () => {
    const outcome: Outcome = await run(
      Array.from(
        { length: MAX_MULTIPART_FILES + 1 },
        (_v: unknown, i: number) => {
          return {
            name: `f${i}`,
            value: Buffer.from("x"),
            filename: `f${i}.bin`,
          };
        },
      ),
    );

    expect((outcome.error as Exception).code).toBe(
      ExceptionCode.PayloadTooLargeException,
    );
    expect((outcome.error as Exception).message).toContain("LIMIT_FILE_COUNT");
  });

  test("one field too many - thousands of tiny parts is the cheap version of this attack", async () => {
    const outcome: Outcome = await run(
      Array.from(
        { length: MAX_MULTIPART_FIELDS + 1 },
        (_v: unknown, i: number) => {
          return { name: `k${i}`, value: Buffer.from("v") };
        },
      ),
    );

    expect((outcome.error as Exception).code).toBe(
      ExceptionCode.PayloadTooLargeException,
    );
    expect((outcome.error as Exception).message).toContain("LIMIT_FIELD_COUNT");
  });

  test("a field value right at the size limit is accepted", async () => {
    /*
     * The other side of the boundary below. Multer 2.5 adds the one busboy
     * needs to every size limit; a middleware that added it as well let a
     * value one byte over through, and one that added it under Multer 2.4
     * - which did not - rejected a value of exactly the limit.
     */
    const outcome: Outcome = await run([
      { name: "html", value: Buffer.alloc(MAX_MULTIPART_FIELD_BYTES) },
    ]);

    expect(outcome.error).toBeUndefined();
    expect((outcome.req.body as Record<string, string>)["html"]).toHaveLength(
      MAX_MULTIPART_FIELD_BYTES,
    );
  });

  test("one field value over the size limit", async () => {
    const outcome: Outcome = await run([
      { name: "html", value: Buffer.alloc(MAX_MULTIPART_FIELD_BYTES + 1) },
    ]);

    expect((outcome.error as Exception).code).toBe(
      ExceptionCode.PayloadTooLargeException,
    );
    expect((outcome.error as Exception).message).toContain("LIMIT_FIELD_VALUE");
  });

  test("deep field nesting is rejected before append-field expands it", async () => {
    const outcome: Outcome = await run([
      { name: "metadata[nested]", value: Buffer.from("value") },
    ]);

    expect((outcome.error as Exception).code).toBe(
      ExceptionCode.PayloadTooLargeException,
    );
    expect((outcome.error as Exception).message).toContain(
      "LIMIT_FIELD_NESTING",
    );
    expect(outcome.nextCalls).toBe(1);
  });

  test("the oversized array-index exploit shape is rejected before allocation", async () => {
    const outcome: Outcome = await run([
      { name: "items[4294967294]", value: Buffer.from("value") },
      { name: "items[label]", value: Buffer.from("trigger") },
    ]);

    expect((outcome.error as Exception).code).toBe(
      ExceptionCode.PayloadTooLargeException,
    );
    expect((outcome.error as Exception).message).toContain(
      "LIMIT_FIELD_NESTING",
    );
    expect(outcome.nextCalls).toBe(1);
  });

  test("next() is called exactly once on a breach", async () => {
    const outcome: Outcome = await run([
      {
        name: "big",
        value: Buffer.alloc(MAX_MULTIPART_FILE_BYTES + 1),
        filename: "big.bin",
      },
    ]);

    expect(outcome.nextCalls).toBe(1);
  });
});

/*
 * getMultipartFormDataMiddleware exists so the source map upload route can
 * hold itself to SOURCE_MAP_MAX_FILES_PER_REQUEST files instead of the shared
 * 50. Two properties matter more than the count itself:
 *
 *   - it is DOWNWARD only. Every route mounting this parses before its own
 *     auth check, so MAX_MULTIPART_FILES is the ceiling an unauthenticated
 *     caller is held to across all of them. A knob that could raise it would
 *     widen the pre-auth memory surface of routes that never asked for it.
 *   - narrowing is per route. It builds a SECOND multer instance rather than
 *     reconfiguring the shared one, so a tighter source map route must not
 *     make Pyroscope ingest or inbound email tighter by proxy.
 */
describe("getMultipartFormDataMiddleware - nothing to narrow means the shared instance", () => {
  test("asking for exactly the shared ceiling hands back the default export itself", () => {
    /*
     * Identity, not equivalence: a fresh middleware here would be a second
     * multer with a second memoryStorage for no behavioural difference, and
     * this function is documented as build-once-at-module-scope precisely
     * because instances are not free.
     */
    expect(
      getMultipartFormDataMiddleware({ maxFiles: MAX_MULTIPART_FILES }),
    ).toBe(MultipartFormDataMiddleware);
  });

  test("one file above the ceiling is clamped back onto the default export", () => {
    expect(
      getMultipartFormDataMiddleware({ maxFiles: MAX_MULTIPART_FILES + 1 }),
    ).toBe(MultipartFormDataMiddleware);
  });

  test("absurd, unbounded and fractional requests above the ceiling all clamp onto the default export", () => {
    /*
     * The clamp is what turns a misconfigured SOURCE_MAP_MAX_FILES_PER_REQUEST
     * into a no-op instead of a widened pre-auth surface, so every shape an
     * operator could plausibly produce has to land on the shared instance.
     *
     * Written against MAX_MULTIPART_FILES rather than the number it happens
     * to hold, so raising the shared ceiling does not quietly turn these into
     * assertions about a value that is no longer above it.
     */
    for (const attempted of [
      MAX_MULTIPART_FILES + 1,
      MAX_MULTIPART_FILES + 0.5,
      MAX_MULTIPART_FILES * 2,
      1000,
      Number.MAX_SAFE_INTEGER,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(getMultipartFormDataMiddleware({ maxFiles: attempted })).toBe(
        MultipartFormDataMiddleware,
      );
    }
  });

  test("no attempted value yields a middleware that accepts more than MAX_MULTIPART_FILES files", async () => {
    /*
     * The identity checks above prove the fast path was taken; this proves
     * the property those checks are a proxy for. If the clamp were ever
     * dropped, an instance built for 1000 files would happily buffer 51 of
     * them before auth - so drive the returned handler with one file more
     * than the shared ceiling and require the 413 either way.
     */
    for (const attempted of [
      MAX_MULTIPART_FILES + 1,
      MAX_MULTIPART_FILES * 2,
      MAX_MULTIPART_FILES * 10,
      Number.MAX_SAFE_INTEGER,
      Number.POSITIVE_INFINITY,
    ]) {
      const middleware: RequestHandler = getMultipartFormDataMiddleware({
        maxFiles: attempted,
      });

      const outcome: Outcome = await run(tinyFiles(MAX_MULTIPART_FILES + 1), {
        middleware: middleware,
      });

      expect((outcome.error as Exception).code).toBe(
        ExceptionCode.PayloadTooLargeException,
      );
      expect((outcome.error as Exception).message).toContain(
        "LIMIT_FILE_COUNT",
      );
    }
  });
});

describe("getMultipartFormDataMiddleware - a narrowed instance is narrower, and only for itself", () => {
  const narrow: RequestHandler = getMultipartFormDataMiddleware({
    maxFiles: 2,
  });

  test("a genuinely narrower request builds its own handler, not the shared one", () => {
    expect(narrow).not.toBe(MultipartFormDataMiddleware);
  });

  test("exactly its own file limit is accepted", async () => {
    const outcome: Outcome = await run(tinyFiles(2), { middleware: narrow });

    expect(outcome.error).toBeUndefined();
    expect(files(outcome)).toHaveLength(2);
  });

  test("one file under its limit is accepted", async () => {
    const outcome: Outcome = await run(tinyFiles(1), { middleware: narrow });

    expect(outcome.error).toBeUndefined();
    expect(files(outcome)).toHaveLength(1);
  });

  test("one file over its limit answers 413, not the shared 50-file limit", async () => {
    const outcome: Outcome = await run(tinyFiles(3), { middleware: narrow });

    expect(outcome.error).toBeInstanceOf(Exception);
    expect((outcome.error as Exception).code).toBe(
      ExceptionCode.PayloadTooLargeException,
    );
    expect((outcome.error as Exception).code).toBe(413);
    expect((outcome.error as Exception).message).toContain("LIMIT_FILE_COUNT");
  });

  test("the very same three files still pass the default middleware", async () => {
    /*
     * The regression this guards: narrowing one route by mutating the shared
     * multer's limits would look identical in the test above and quietly cut
     * Pyroscope ingest and SendGrid inbound email down to two files each.
     */
    const outcome: Outcome = await run(tinyFiles(3));

    expect(outcome.error).toBeUndefined();
    expect(files(outcome)).toHaveLength(3);
  });

  test("the default middleware still accepts a full 50 files after a narrower one exists", async () => {
    const outcome: Outcome = await run(tinyFiles(MAX_MULTIPART_FILES));

    expect(outcome.error).toBeUndefined();
    expect(files(outcome)).toHaveLength(MAX_MULTIPART_FILES);
  });

  test("the narrowed instance stays narrow after the default has been used", async () => {
    /*
     * The mirror image of the leak: two multer instances sharing mutable
     * limits would drift in whichever direction ran last, so re-drive the
     * narrow one after the 50-file body above.
     */
    const outcome: Outcome = await run(tinyFiles(3), { middleware: narrow });

    expect((outcome.error as Exception).message).toContain("LIMIT_FILE_COUNT");
  });
});

describe("getMultipartFormDataMiddleware - the low end clamps up to 1, never to zero", () => {
  test("maxFiles: 0 still accepts a file", async () => {
    /*
     * multer reads `files: 0` as "no files at all", which would turn a
     * misconfigured SOURCE_MAP_MAX_FILES_PER_REQUEST into a route that 413s
     * every upload. Clamping up to 1 keeps the route working, degraded, and
     * the parse still bounded.
     */
    const middleware: RequestHandler = getMultipartFormDataMiddleware({
      maxFiles: 0,
    });

    const outcome: Outcome = await run(tinyFiles(1), {
      middleware: middleware,
    });

    expect(outcome.error).toBeUndefined();
    expect(files(outcome)).toHaveLength(1);
  });

  test("maxFiles: 0 rejects the second file, so it clamped to 1 rather than to the default", async () => {
    const middleware: RequestHandler = getMultipartFormDataMiddleware({
      maxFiles: 0,
    });

    const outcome: Outcome = await run(tinyFiles(2), {
      middleware: middleware,
    });

    expect((outcome.error as Exception).code).toBe(
      ExceptionCode.PayloadTooLargeException,
    );
    expect((outcome.error as Exception).message).toContain("LIMIT_FILE_COUNT");
  });

  test("a negative maxFiles behaves exactly like 1", async () => {
    const middleware: RequestHandler = getMultipartFormDataMiddleware({
      maxFiles: -5,
    });

    const accepted: Outcome = await run(tinyFiles(1), {
      middleware: middleware,
    });
    const rejected: Outcome = await run(tinyFiles(2), {
      middleware: middleware,
    });

    expect(accepted.error).toBeUndefined();
    expect(files(accepted)).toHaveLength(1);
    expect((rejected.error as Exception).code).toBe(
      ExceptionCode.PayloadTooLargeException,
    );
  });

  test("clamped-up values are still their own handler, not the shared one", () => {
    expect(getMultipartFormDataMiddleware({ maxFiles: 0 })).not.toBe(
      MultipartFormDataMiddleware,
    );
    expect(getMultipartFormDataMiddleware({ maxFiles: -5 })).not.toBe(
      MultipartFormDataMiddleware,
    );
  });
});

/*
 * The DOMAIN is clamped, not only the range.
 *
 * busboy's file-count check is `files === filesLimit` - an equality against a
 * counter that only ever holds whole numbers. A fractional or NaN limit
 * therefore never matches anything: it does not narrow the parse, it removes
 * the file bound outright and leaves an unauthenticated caller free to send as
 * many files as it likes. That is the precise widening this function exists to
 * prevent, so Math.floor and the finite check are load-bearing rather than
 * defensive tidiness.
 *
 * Latent as things stand - the only caller passes the value through
 * parsePositiveIntegerFromEnv, which rejects "1.5" and garbage before it gets
 * here. Pinned anyway, because the function is exported and the next caller
 * may not come through the config layer at all.
 */
describe("getMultipartFormDataMiddleware - a non-integer maxFiles cannot unbound the parse", () => {
  test("a fractional maxFiles narrows to the whole number below it", async () => {
    const middleware: RequestHandler = getMultipartFormDataMiddleware({
      maxFiles: 2.5,
    });

    const accepted: Outcome = await run(tinyFiles(2), {
      middleware: middleware,
    });
    const rejected: Outcome = await run(tinyFiles(3), {
      middleware: middleware,
    });

    expect(accepted.error).toBeUndefined();
    expect(files(accepted)).toHaveLength(2);
    /*
     * The half is what matters: handed 2.5 straight to multer, this third
     * file arrives with no error at all.
     */
    expect((rejected.error as Exception).code).toBe(
      ExceptionCode.PayloadTooLargeException,
    );
    expect((rejected.error as Exception).message).toContain("LIMIT_FILE_COUNT");
  });

  test("a fractional maxFiles above the ceiling is still bounded by the ceiling", async () => {
    const middleware: RequestHandler = getMultipartFormDataMiddleware({
      maxFiles: MAX_MULTIPART_FILES + 0.5,
    });

    const outcome: Outcome = await run(tinyFiles(MAX_MULTIPART_FILES + 1), {
      middleware: middleware,
    });

    expect((outcome.error as Exception).code).toBe(
      ExceptionCode.PayloadTooLargeException,
    );
    expect((outcome.error as Exception).message).toContain("LIMIT_FILE_COUNT");
  });

  test("NaN falls back to the shared ceiling rather than removing the file bound", async () => {
    /*
     * NaN survives every comparison a naive clamp makes - Math.min(NaN, 50)
     * and Math.max(1, NaN) are both NaN - so it would reach multer intact and
     * silently uncap the route. It has to land on the shared instance instead.
     */
    const middleware: RequestHandler = getMultipartFormDataMiddleware({
      maxFiles: Number.NaN,
    });

    expect(middleware).toBe(MultipartFormDataMiddleware);

    const outcome: Outcome = await run(tinyFiles(MAX_MULTIPART_FILES + 1), {
      middleware: middleware,
    });

    expect((outcome.error as Exception).code).toBe(
      ExceptionCode.PayloadTooLargeException,
    );
    expect((outcome.error as Exception).message).toContain("LIMIT_FILE_COUNT");
  });
});

describe("getMultipartFormDataMiddleware - narrowing files changes nothing else", () => {
  const narrow: RequestHandler = getMultipartFormDataMiddleware({
    maxFiles: 2,
  });

  test("its own file-count limit does not relax the shared size ceiling", async () => {
    const outcome: Outcome = await run(
      [
        {
          name: "big",
          value: Buffer.alloc(MAX_MULTIPART_FILE_BYTES + 1),
          filename: "big.bin",
        },
      ],
      { middleware: narrow, bodyLimit: ROOM_FOR_A_FILE_AT_ITS_LIMIT },
    );

    expect((outcome.error as Exception).code).toBe(
      ExceptionCode.PayloadTooLargeException,
    );
    expect((outcome.error as Exception).message).toContain("LIMIT_FILE_SIZE");
  });

  test("the shared size ceiling is INCLUSIVE, and a narrowed instance lands on the same byte", async () => {
    /*
     * Multer 2.3 presents fileSize as an inclusive application limit and
     * performs the +1 conversion only in its busboy adapter. Handing Multer
     * the exact constant therefore accepts that byte and rejects the next.
     *
     * Worth pinning rather than glossing: EnvironmentConfig clamps
     * SOURCE_MAP_MAX_FILE_SIZE_BYTES to exactly MAX_MULTIPART_FILE_BYTES and
     * SourceMapIngestService rejects only what is STRICTLY over it, so a map
     * of precisely that many bytes is one the service means to accept -- and
     * before the +1 the parser killed it first, turning the 400 the endpoint
     * documents into a 413 it never saw. Narrowing the file COUNT must not
     * move that boundary either.
     *
     * Pinned in a body its route takes whole (ROOM_FOR_A_FILE_AT_ITS_LIMIT):
     * the routes that mount the middleware take 50 MiB as a whole, which a
     * file at the file limit, with its part's headers, does not fit in.
     */
    // One allocation, driven through both instances - it is 50 MiB.
    const atLimit: Buffer = Buffer.alloc(MAX_MULTIPART_FILE_BYTES);

    const atCeiling: Outcome = await run(
      [{ name: "atlimit", value: atLimit, filename: "atlimit.bin" }],
      { middleware: narrow, bodyLimit: ROOM_FOR_A_FILE_AT_ITS_LIMIT },
    );

    expect(atCeiling.error).toBeUndefined();
    expect(files(atCeiling)[0]!.buffer.length).toBe(MAX_MULTIPART_FILE_BYTES);

    // The shared instance is the baseline the narrowed one must match.
    const sharedAtCeiling: Outcome = await run(
      [{ name: "atlimit", value: atLimit, filename: "atlimit.bin" }],
      { bodyLimit: ROOM_FOR_A_FILE_AT_ITS_LIMIT },
    );

    expect(sharedAtCeiling.error).toBeUndefined();
    expect(files(sharedAtCeiling)[0]!.buffer.length).toBe(
      MAX_MULTIPART_FILE_BYTES,
    );

    const overCeiling: Outcome = await run(
      [
        {
          name: "overlimit",
          value: Buffer.alloc(MAX_MULTIPART_FILE_BYTES + 1),
          filename: "overlimit.bin",
        },
      ],
      { middleware: narrow, bodyLimit: ROOM_FOR_A_FILE_AT_ITS_LIMIT },
    );

    expect((overCeiling.error as Exception).code).toBe(
      ExceptionCode.PayloadTooLargeException,
    );
    expect((overCeiling.error as Exception).message).toContain(
      "LIMIT_FILE_SIZE",
    );
  });

  test("the shared field-value ceiling still applies", async () => {
    const outcome: Outcome = await run(
      [{ name: "html", value: Buffer.alloc(MAX_MULTIPART_FIELD_BYTES + 1) }],
      { middleware: narrow },
    );

    expect((outcome.error as Exception).code).toBe(
      ExceptionCode.PayloadTooLargeException,
    );
    expect((outcome.error as Exception).message).toContain("LIMIT_FIELD_VALUE");
  });

  test("the shared field-name hardening also protects a narrowed instance", async () => {
    const outcome: Outcome = await run(
      [
        { name: "items[4294967294]", value: Buffer.from("value") },
        { name: "items[label]", value: Buffer.from("trigger") },
      ],
      { middleware: narrow },
    );

    expect((outcome.error as Exception).code).toBe(
      ExceptionCode.PayloadTooLargeException,
    );
    expect((outcome.error as Exception).message).toContain(
      "LIMIT_FIELD_NESTING",
    );
    expect(outcome.nextCalls).toBe(1);
  });

  test("the whole shared field allowance still parses alongside its files", async () => {
    /*
     * `parts` is files + fields, so a narrowed instance has to carry the
     * field allowance over rather than deriving the part budget from its own
     * file count. Leaving parts at 2 - or at anything near it - would make
     * the part count the effective limit, and the source map route would
     * start 413ing bodies whose field count the shared config says are fine.
     */
    const outcome: Outcome = await run(
      [
        ...Array.from(
          { length: MAX_MULTIPART_FIELDS },
          (_v: unknown, i: number): MultipartPart => {
            return { name: `k${i}`, value: Buffer.from("v") };
          },
        ),
        ...tinyFiles(1),
      ],
      { middleware: narrow },
    );

    expect(outcome.error).toBeUndefined();
    expect(
      Object.keys(outcome.req.body as Record<string, unknown>),
    ).toHaveLength(MAX_MULTIPART_FIELDS);
    expect(files(outcome)).toHaveLength(1);
  });

  test("its full file count fits alongside one field short of the allowance", async () => {
    const outcome: Outcome = await run(
      [
        ...Array.from(
          { length: MAX_MULTIPART_FIELDS - 1 },
          (_v: unknown, i: number): MultipartPart => {
            return { name: `k${i}`, value: Buffer.from("v") };
          },
        ),
        ...tinyFiles(2),
      ],
      { middleware: narrow },
    );

    expect(outcome.error).toBeUndefined();
    expect(files(outcome)).toHaveLength(2);
  });

  test("the maximal body - the full file AND field allowance - is accepted", async () => {
    /*
     * busboy starts its part counter at -1 to account for the opening
     * boundary and then fires partsLimit when the counter REACHES the limit,
     * so a raw `parts: n` admits only n - 1. That used to reject a body
     * carrying the file limit AND the field limit in full with
     * LIMIT_PART_COUNT, though neither of those limits was breached -- the
     * exact thing the comment on `parts` says must not happen. The
     * middleware now converts it, so the maximal body parses.
     *
     * Pinned on BOTH instances so the narrowed one is provably no tighter
     * than the shared one: a narrowing that also stole a part would show up
     * here rather than in production.
     */
    const fields: (count: number) => Array<MultipartPart> = (
      count: number,
    ): Array<MultipartPart> => {
      return Array.from(
        { length: count },
        (_v: unknown, i: number): MultipartPart => {
          return { name: `k${i}`, value: Buffer.from("v") };
        },
      );
    };

    const narrowed: Outcome = await run(
      [...fields(MAX_MULTIPART_FIELDS), ...tinyFiles(2)],
      { middleware: narrow },
    );

    expect(narrowed.error).toBeUndefined();
    expect(files(narrowed)).toHaveLength(2);

    const shared: Outcome = await run([
      ...fields(MAX_MULTIPART_FIELDS),
      ...tinyFiles(MAX_MULTIPART_FILES),
    ]);

    expect(shared.error).toBeUndefined();
    expect(files(shared)).toHaveLength(MAX_MULTIPART_FILES);
  });

  test("one file past the maximal body is LIMIT_FILE_COUNT, not LIMIT_PART_COUNT", async () => {
    /*
     * The counts stay the limits that actually speak. Raising `parts` to
     * admit the maximal body must not push the parts limit down onto a body
     * that breaches the file allowance -- the caller needs to be told which
     * allowance they exceeded.
     */
    const outcome: Outcome = await run(
      Array.from(
        { length: MAX_MULTIPART_FIELDS },
        (_v: unknown, i: number): MultipartPart => {
          return { name: `k${i}`, value: Buffer.from("v") };
        },
      ).concat(tinyFiles(MAX_MULTIPART_FILES + 1)),
    );

    expect((outcome.error as Exception).code).toBe(
      ExceptionCode.PayloadTooLargeException,
    );
    expect((outcome.error as Exception).message).toContain("LIMIT_FILE_COUNT");
  });

  test("one field too many is still LIMIT_FIELD_COUNT, not LIMIT_PART_COUNT", async () => {
    const outcome: Outcome = await run(
      Array.from(
        { length: MAX_MULTIPART_FIELDS + 1 },
        (_v: unknown, i: number): MultipartPart => {
          return { name: `k${i}`, value: Buffer.from("v") };
        },
      ),
      { middleware: narrow },
    );

    expect((outcome.error as Exception).code).toBe(
      ExceptionCode.PayloadTooLargeException,
    );
    expect((outcome.error as Exception).message).toContain("LIMIT_FIELD_COUNT");
  });

  test("next() is called exactly once on a breach here too", async () => {
    const outcome: Outcome = await run(tinyFiles(3), { middleware: narrow });

    expect(outcome.nextCalls).toBe(1);
  });

  test("a body busboy cannot read is refused 400 as the client's, never as too large", async () => {
    /*
     * A multipart Content-Type with no boundary makes busboy throw during
     * construction, which multer hands to next() as a plain Error. That is a
     * malformed request, not an oversized one, and the error mapping both
     * instances share must not launder it into a PayloadTooLargeException -
     * doing so would report every parser failure as "you sent too much".
     * Nor is it the server's: handed on as it was, it was a 500 with an
     * error-level log line, for any client (#10643).
     */
    const outcome: Outcome = await run(tinyFiles(1), {
      middleware: narrow,
      contentType: "multipart/form-data",
    });

    expect(outcome.error).toBeInstanceOf(BadRequestException);
    expect(outcome.error).not.toBeInstanceOf(PayloadTooLargeException);
    expect(readRequestBodyRefusal(outcome.error)).toEqual({
      type: MULTIPART_MALFORMED_TYPE,
      status: 400,
      message: REQUEST_BODY_REFUSAL_MESSAGES.multipartMalformed,
    });
    expect(outcome.nextCalls).toBe(1);
  });

  test("the default middleware treats that same body identically", async () => {
    const outcome: Outcome = await run(tinyFiles(1), {
      contentType: "multipart/form-data",
    });

    expect(outcome.error).toBeInstanceOf(BadRequestException);
    expect(readRequestBodyRefusal(outcome.error)?.status).toBe(400);
  });
});

/*
 * A request whose body arrives a chunk at a time, read off only as it is
 * asked for - as a socket's is - counting what was read off (`taken`).
 */
class CountingRequest extends Readable {
  public headers: Record<string, string>;
  public body?: unknown;
  public files?: unknown;
  public _body?: boolean;
  public requestBodyLimit?: RequestBodyLimit;
  public taken: number = 0;
  private offset: number = 0;

  public constructor(
    private readonly bytes: Buffer,
    headers: Record<string, string>,
  ) {
    super({ highWaterMark: 64 * 1024 });
    this.headers = headers;
  }

  public override _read(): void {
    if (this.offset >= this.bytes.length) {
      this.push(null);
      return;
    }

    const chunk: Buffer = this.bytes.subarray(
      this.offset,
      this.offset + 64 * 1024,
    );

    this.offset += chunk.length;
    this.taken += chunk.length;
    this.push(chunk);
  }
}

interface Driven {
  error: unknown;
  nextCalls: number;
}

function drive(
  req: Readable,
  middleware: RequestHandler = MultipartFormDataMiddleware,
): Promise<Driven> {
  const res: ExpressResponse = {
    status: (): unknown => {
      return { send: (): void => {}, json: (): void => {} };
    },
    headersSent: false,
    shouldKeepAlive: true,
  } as unknown as ExpressResponse;

  return new Promise<Driven>((resolve: (value: Driven) => void) => {
    let nextCalls: number = 0;

    middleware(req as unknown as ExpressRequest, res, ((
      err?: unknown,
    ): void => {
      nextCalls++;
      resolve({ error: err, nextCalls: nextCalls });
    }) as NextFunction);
  });
}

const MULTIPART_HEADERS: Record<string, string> = {
  "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
};

/*
 * #10643: multer read the request itself, and nothing held a multipart body
 * as a whole - fifty files of 50 MiB each passed every limit of multer's,
 * held in memory before any key was checked - and a body multer refused was
 * read to its end before the answer. Now the body is read as every body is
 * (RequestBodyParser), held to what its route takes, and multer parses the
 * bytes read.
 */
describe("MultipartFormData - the body as a whole is held to its route's limit (#10643)", () => {
  test("the limit is the route's, as StartServer set it, else the most any route takes", () => {
    expect(getMultipartBodyLimit({} as ExpressRequest)).toBe(
      LARGE_REQUEST_BODY_BYTES,
    );
    expect(
      getMultipartBodyLimit({
        requestBodyLimit: routeLimit(MIB),
      } as unknown as ExpressRequest),
    ).toBe(MIB);
  });

  test("a body declared over its route's limit is refused 413 before a byte is read, and never parsed", async () => {
    const body: Buffer = buildMultipartBody([
      { name: "big", value: Buffer.alloc(2 * MIB, 1), filename: "big.bin" },
    ]);
    const req: CountingRequest = new CountingRequest(body, {
      ...MULTIPART_HEADERS,
      "content-length": String(body.length),
    });
    req.requestBodyLimit = routeLimit(MIB);

    const outcome: Driven = await drive(req);

    expect(readRequestBodyRefusal(outcome.error)).toEqual({
      type: "entity.too.large",
      status: 413,
      message: getTooLargeForRouteMessage(MIB),
    });
    expect(req.taken).toBe(0);
    expect(req.files).toBeUndefined();
    expect(outcome.nextCalls).toBe(1);
  });

  test("a chunked body growing past it is refused at the chunk that does, and no more is read", async () => {
    const body: Buffer = buildMultipartBody([
      { name: "big", value: Buffer.alloc(4 * MIB, 1), filename: "big.bin" },
    ]);
    const req: CountingRequest = new CountingRequest(body, {
      ...MULTIPART_HEADERS,
      "transfer-encoding": "chunked",
    });
    req.requestBodyLimit = routeLimit(MIB);

    const outcome: Driven = await drive(req);

    expect(readRequestBodyRefusal(outcome.error)?.status).toBe(413);
    expect(req.taken).toBeGreaterThan(MIB);
    expect(req.taken).toBeLessThanOrEqual(MIB + 256 * 1024);
    expect(req.files).toBeUndefined();
  });

  test("a body exactly at its route's limit is read whole and parsed", async () => {
    const parts: Array<MultipartPart> = [
      { name: "file", value: Buffer.alloc(MIB, 7), filename: "f.bin" },
    ];
    const body: Buffer = buildMultipartBody(parts);

    const outcome: Outcome = await run(parts, { bodyLimit: body.length });

    expect(outcome.error).toBeUndefined();
    expect(files(outcome)[0]!.buffer.length).toBe(MIB);
  });

  test("through a route of 50 MiB, a file at multer's file limit does not fit with its part's headers", async () => {
    const outcome: Outcome = await run([
      {
        name: "atlimit",
        value: Buffer.alloc(MAX_MULTIPART_FILE_BYTES),
        filename: "atlimit.bin",
      },
    ]);

    expect(readRequestBodyRefusal(outcome.error)).toEqual({
      type: "entity.too.large",
      status: 413,
      message: UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime,
    });
    expect(outcome.req.files).toBeUndefined();
  });

  test("files each within multer's limits pass while the body fits, and are refused once it does not", async () => {
    const megabyteFiles: Array<MultipartPart> = Array.from(
      { length: MAX_MULTIPART_FILES },
      (_v: unknown, i: number): MultipartPart => {
        return {
          name: `f${i}`,
          value: Buffer.alloc(MIB, i),
          filename: `f${i}.bin`,
        };
      },
    );

    const fits: Outcome = await run(megabyteFiles.slice(0, 40));

    expect(fits.error).toBeUndefined();
    expect(files(fits)).toHaveLength(40);

    const past: Outcome = await run(megabyteFiles, { bodyLimit: 40 * MIB });

    expect(readRequestBodyRefusal(past.error)?.status).toBe(413);
    expect(past.req.files).toBeUndefined();
  });
});

describe("MultipartFormData - a body sent compressed (#10643)", () => {
  const parts: Array<MultipartPart> = [
    { name: "name", value: Buffer.from("checkout") },
    {
      name: "profile",
      value: Buffer.from("pprof bytes"),
      filename: "cpu.pprof",
    },
  ];

  test("a gzip body StartServer inflated is parsed from the bytes it left, its spent stream never read again", async () => {
    /*
     * As GzipRequestBody leaves it: the stream read to its end, the inflated
     * bytes in req.body. multer used to pipe the spent stream into busboy:
     * "Unexpected end of form", a 500 and an error-level log line.
     */
    const req: Readable & {
      headers?: Record<string, string>;
      body?: unknown;
      files?: unknown;
      _body?: boolean;
    } = Readable.from([]);

    req.resume();
    await new Promise<void>((resolve: () => void) => {
      req.once("end", resolve);
    });

    const inflated: Buffer = buildMultipartBody(parts);

    // As the client sent it: gzip, with the length of the gzip.
    req.headers = {
      ...MULTIPART_HEADERS,
      "content-encoding": "gzip",
      "content-length": String(zlib.gzipSync(inflated).length),
    };
    req.body = inflated;

    const outcome: Driven = await drive(req);

    expect(outcome.error).toBeUndefined();
    expect(req.body).toEqual({ name: "checkout" });
    expect(
      (req.files as Array<{ fieldname: string; buffer: Buffer }>).map(
        (file: { fieldname: string; buffer: Buffer }): string => {
          return `${file.fieldname}=${file.buffer.toString()}`;
        },
      ),
    ).toEqual(["profile=pprof bytes"]);
    expect(req._body).toBe(true);
  });

  test("a deflate body is inflated as body-parser inflates one, then parsed", async () => {
    const outcome: Outcome = await run([], {
      rawBody: zlib.deflateSync(buildMultipartBody(parts)),
      contentEncoding: "deflate",
    });

    expect(outcome.error).toBeUndefined();
    expect(outcome.req.body).toEqual({ name: "checkout" });
    expect(
      files(outcome).map((file: { fieldname: string }): string => {
        return file.fieldname;
      }),
    ).toEqual(["profile"]);
  });

  test("a deflate body inflating past its route's limit is refused 413", async () => {
    const outcome: Outcome = await run([], {
      rawBody: zlib.deflateSync(
        buildMultipartBody([
          { name: "big", value: Buffer.alloc(4 * MIB), filename: "big.bin" },
        ]),
      ),
      contentEncoding: "deflate",
      bodyLimit: MIB,
    });

    expect(readRequestBodyRefusal(outcome.error)?.status).toBe(413);
    expect(outcome.req.files).toBeUndefined();
  });

  test("a Content-Encoding nothing reads is refused 415 before a byte is read", async () => {
    const body: Buffer = buildMultipartBody(parts);
    const req: CountingRequest = new CountingRequest(body, {
      ...MULTIPART_HEADERS,
      "content-length": String(body.length),
      "content-encoding": "br",
    });

    const outcome: Driven = await drive(req);

    expect(readRequestBodyRefusal(outcome.error)).toEqual({
      type: "encoding.unsupported",
      status: 415,
      message: REQUEST_BODY_REFUSAL_MESSAGES.encodingUnsupported,
    });
    expect(req.taken).toBe(0);
  });

  test("a body of another type is passed on unread, as multer passed it on", async () => {
    const body: Buffer = Buffer.from("main;work 12\n");
    const req: CountingRequest = new CountingRequest(body, {
      "content-type": "application/octet-stream",
      "content-length": String(body.length),
    });

    const outcome: Driven = await drive(req);

    expect(outcome.error).toBeUndefined();
    expect(req.taken).toBe(0);
    expect(req.files).toBeUndefined();
    expect(req._body).toBeUndefined();
  });
});

describe("MultipartFormData - a body that is no multipart form (#10643)", () => {
  test.each([
    ["no multipart form at all", Buffer.from("this is not a multipart body")],
    [
      "a part's header that never ends",
      Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="a"`),
    ],
    [
      "a file cut off before its closing boundary",
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="f"; filename="f.bin"\r\n\r\nhalf a fi`,
      ),
    ],
  ])(
    "%s: refused 400 as the client's, in a sentence of its own - not a 500",
    async (_kind: string, rawBody: Buffer) => {
      const outcome: Outcome = await run([], { rawBody: rawBody });

      expect(outcome.error).toBeInstanceOf(BadRequestException);
      expect(readRequestBodyRefusal(outcome.error)).toEqual({
        type: MULTIPART_MALFORMED_TYPE,
        status: 400,
        message: REQUEST_BODY_REFUSAL_MESSAGES.multipartMalformed,
      });
      expect(outcome.nextCalls).toBe(1);
    },
  );

  test("busboy's words for a body it cannot read are told apart, and nothing else is", () => {
    for (const message of BUSBOY_MALFORMED_BODY_ERRORS) {
      expect(isMalformedMultipartBodyError(new Error(message))).toBe(true);
    }

    expect(
      isMalformedMultipartBodyError(
        new Error("Unsupported content type: text/plain"),
      ),
    ).toBe(true);

    // The server's own faults stay the server's.
    expect(isMalformedMultipartBodyError(new Error("ECONNRESET"))).toBe(false);
    expect(
      isMalformedMultipartBodyError(
        new TypeError("Cannot read properties of undefined"),
      ),
    ).toBe(false);
    expect(
      isMalformedMultipartBodyError(
        new multer.MulterError("LIMIT_FILE_SIZE", "big"),
      ),
    ).toBe(false);
    expect(isMalformedMultipartBodyError("Unexpected end of form")).toBe(false);
    expect(isMalformedMultipartBodyError(undefined)).toBe(false);
  });

  test("every error busboy raises over a body's bytes is one of those", () => {
    /*
     * Read from the busboy installed, so an upgrade that words one anew
     * fails here rather than turning a client's body into a 500 again.
     */
    const directory: string = path.dirname(require.resolve("busboy"));
    const sources: string = [
      path.join(directory, "index.js"),
      path.join(directory, "types", "multipart.js"),
    ]
      .map((file: string): string => {
        return fs.readFileSync(file, "utf8");
      })
      .join("\n");

    const messages: Array<string> = Array.from(
      sources.matchAll(/new Error\(\s*['"`]([^'"`$]+)/g),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );

    expect(messages.length).toBeGreaterThan(4);

    for (const message of messages) {
      expect([
        message,
        BUSBOY_MALFORMED_BODY_ERRORS.has(message) ||
          message === "Unsupported content type: ",
      ]).toEqual([message, true]);
    }
  });
});

describe("MultipartFormData - multer's refusals are the client's body refused, in the same words (#10643)", () => {
  test("a limit multer refuses stays the 413 it was, and is a refusal the error handler logs at debug", async () => {
    const outcome: Outcome = await run(tinyFiles(MAX_MULTIPART_FILES + 1));

    expect(outcome.error).toBeInstanceOf(PayloadTooLargeException);
    expect((outcome.error as Exception).code).toBe(413);
    expect(readRequestBodyRefusal(outcome.error)).toEqual({
      type: MULTIPART_LIMIT_TYPE,
      status: 413,
      message: "Multipart request rejected: LIMIT_FILE_COUNT.",
    });
  });

  test("a part multer refuses for its name stays the 400 it was, in the same words", async () => {
    const outcome: Outcome = await run([], {
      rawBody: Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data\r\n\r\nvalue\r\n--${BOUNDARY}--\r\n`,
      ),
    });

    expect(outcome.error).toBeInstanceOf(BadRequestException);
    expect(readRequestBodyRefusal(outcome.error)).toEqual({
      type: MULTIPART_MALFORMED_TYPE,
      status: 400,
      message: "Multipart request rejected: MISSING_FIELD_NAME.",
    });
  });

  test("a refused body was read once, whole, and never drained after: multer was handed its bytes", async () => {
    const body: Buffer = buildMultipartBody(tinyFiles(MAX_MULTIPART_FILES + 1));
    const req: CountingRequest = new CountingRequest(body, {
      ...MULTIPART_HEADERS,
      "content-length": String(body.length),
    });

    const outcome: Driven = await drive(req);

    expect(readRequestBodyRefusal(outcome.error)?.type).toBe(
      MULTIPART_LIMIT_TYPE,
    );
    expect(req.taken).toBe(body.length);
    expect(outcome.nextCalls).toBe(1);
  });
});
