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
 * Both routes mount it BEFORE their auth check - Pyroscope before
 * isAuthorizedServiceMiddleware, SendGrid before the webhook secret is
 * verified - and it uses multer's memoryStorage, so every part it accepts
 * is buffered in the process on behalf of a caller who has not proved
 * anything yet.
 *
 * multer's defaults leave almost all of that unbounded: fileSize, files,
 * fields and parts are all Infinity out of the box, and only fieldSize
 * has a default at all. These tests pin the limits and the status code a
 * breach produces, because the failure mode of getting this wrong is
 * silent - an unbounded upload looks exactly like a working one until the
 * pod dies.
 */

import MultipartFormDataMiddleware, {
  getMultipartFormDataMiddleware,
  MAX_MULTIPART_FIELDS,
  MAX_MULTIPART_FIELD_BYTES,
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
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import { Readable } from "stream";

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

  const body: Buffer = buildMultipartBody(parts);

  const req: Readable & {
    headers: Record<string, string>;
    body?: unknown;
    files?: unknown;
  } = Readable.from([body]) as never;

  req.headers = {
    "content-type":
      options && options.contentType
        ? options.contentType
        : `multipart/form-data; boundary=${BOUNDARY}`,
    "content-length": String(body.length),
  };

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
      { name: "attachment1", value: Buffer.from("PDF"), filename: "a.pdf" },
    ]);

    expect(outcome.error).toBeUndefined();
    expect((outcome.req.body as Record<string, string>)["from"]).toBe(
      "someone@example.com",
    );
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
    const outcome: Outcome = await run([
      {
        name: "big",
        value: Buffer.alloc(MAX_MULTIPART_FILE_BYTES + 1),
        filename: "big.bin",
      },
    ]);

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

  test("one field value over the size limit", async () => {
    const outcome: Outcome = await run([
      { name: "html", value: Buffer.alloc(MAX_MULTIPART_FIELD_BYTES + 1) },
    ]);

    expect((outcome.error as Exception).code).toBe(
      ExceptionCode.PayloadTooLargeException,
    );
    expect((outcome.error as Exception).message).toContain("LIMIT_FIELD_VALUE");
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
      { middleware: narrow },
    );

    expect((outcome.error as Exception).code).toBe(
      ExceptionCode.PayloadTooLargeException,
    );
    expect((outcome.error as Exception).message).toContain("LIMIT_FILE_SIZE");
  });

  test("the shared size ceiling is INCLUSIVE, and a narrowed instance lands on the same byte", async () => {
    /*
     * busboy truncates a file the moment its byte count REACHES fileSize,
     * so the middleware hands it MAX_MULTIPART_FILE_BYTES + 1 to make the
     * constant itself an inclusive maximum.
     *
     * Worth pinning rather than glossing: EnvironmentConfig clamps
     * SOURCE_MAP_MAX_FILE_SIZE_BYTES to exactly MAX_MULTIPART_FILE_BYTES and
     * SourceMapIngestService rejects only what is STRICTLY over it, so a map
     * of precisely that many bytes is one the service means to accept -- and
     * before the +1 the parser killed it first, turning the 400 the endpoint
     * documents into a 413 it never saw. Narrowing the file COUNT must not
     * move that boundary either.
     */
    // One allocation, driven through both instances - it is 50 MiB.
    const atLimit: Buffer = Buffer.alloc(MAX_MULTIPART_FILE_BYTES);

    const atCeiling: Outcome = await run(
      [{ name: "atlimit", value: atLimit, filename: "atlimit.bin" }],
      { middleware: narrow },
    );

    expect(atCeiling.error).toBeUndefined();
    expect(files(atCeiling)[0]!.buffer.length).toBe(MAX_MULTIPART_FILE_BYTES);

    // The shared instance is the baseline the narrowed one must match.
    const sharedAtCeiling: Outcome = await run([
      { name: "atlimit", value: atLimit, filename: "atlimit.bin" },
    ]);

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
      { middleware: narrow },
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

  test("a non-multer error passes straight through instead of becoming a 413", async () => {
    /*
     * A multipart Content-Type with no boundary makes busboy throw during
     * construction, which multer hands to next() as a plain Error. That is a
     * malformed request, not an oversized one, and the error mapping both
     * instances share must not launder it into a PayloadTooLargeException -
     * doing so would report every parser failure as "you sent too much".
     */
    const outcome: Outcome = await run(tinyFiles(1), {
      middleware: narrow,
      contentType: "multipart/form-data",
    });

    expect(outcome.error).toBeInstanceOf(Error);
    expect(outcome.error).not.toBeInstanceOf(Exception);
    expect((outcome.error as Error).message).toContain("Boundary not found");
    expect(outcome.nextCalls).toBe(1);
  });

  test("the default middleware treats that same non-multer error identically", async () => {
    const outcome: Outcome = await run(tinyFiles(1), {
      contentType: "multipart/form-data",
    });

    expect(outcome.error).toBeInstanceOf(Error);
    expect(outcome.error).not.toBeInstanceOf(Exception);
    expect((outcome.error as Error).message).toContain("Boundary not found");
  });
});
