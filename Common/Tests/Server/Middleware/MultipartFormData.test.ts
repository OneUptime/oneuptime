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
  MAX_MULTIPART_FIELDS,
  MAX_MULTIPART_FIELD_BYTES,
  MAX_MULTIPART_FILES,
  MAX_MULTIPART_FILE_BYTES,
} from "../../../Server/Middleware/MultipartFormData";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
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

/*
 * Drive the middleware with a real multipart body over a real Readable, so
 * busboy does the parsing it does in production rather than being faked.
 */
function run(parts: Array<MultipartPart>): Promise<Outcome> {
  const body: Buffer = buildMultipartBody(parts);

  const req: Readable & {
    headers: Record<string, string>;
    body?: unknown;
    files?: unknown;
  } = Readable.from([body]) as never;

  req.headers = {
    "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
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

    MultipartFormDataMiddleware(req as unknown as ExpressRequest, res, ((
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
