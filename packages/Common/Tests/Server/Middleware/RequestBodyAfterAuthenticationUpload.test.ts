jest.mock("../../../Server/Utils/Logger", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/Logger",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import MultipartFormDataMiddleware, {
  getMultipartFormDataMiddleware,
} from "../../../Server/Middleware/MultipartFormData";
import RequestBodyAfterAuthentication, {
  UploadBodyReaders,
} from "../../../Server/Middleware/RequestBodyAfterAuthentication";
import UnreadRequestBody, {
  UNREAD_BODY_READ_OFF_BYTES,
} from "../../../Server/Middleware/UnreadRequestBody";
import {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
  RequestHandler,
  createExpressApp,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import {
  LARGE_REQUEST_BODY_LIMIT,
  RequestBodyLimit,
} from "../../../Server/Utils/RequestBodyLimit";
import {
  REQUEST_BODY_REFUSAL_MESSAGES,
  getTooLargeForRouteMessage,
  getTooManyJsonValuesMessage,
} from "../../../Server/Utils/RequestBodyRefusal";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import { JsonElementLimit } from "../../../Utils/JsonElementCount";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import {
  BodyServer,
  CONNECTIONS,
  Connection,
  KIB,
  MIB,
  READ_OR_TWO,
  SentRequest,
  sendOverHttp,
  startBodyServer,
} from "../TestingUtils/RequestBodyOverHttp";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Readable } from "stream";
import timers from "timers";
import zlib from "zlib";

/*
 * multer calls `setImmediate` internally, and Common's jest environment is
 * jsdom, which does not expose it: without it multer never hands a parsed
 * form on. Lent the real one from Node, as MultipartFormData.test.ts does.
 */
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * AN UPLOAD, READ ONCE ITS CALLER'S KEY IS CHECKED (#10673), over HTTP:
 * RequestBodyAfterAuthentication.readUpload behind a key check, as
 * Pyroscope's /ingest, source maps and dSYMs mount it. StartServer leaves
 * these routes' bodies unread (RequestBodyLimit), so what is read of one is
 * what readUpload reads, after the key - here, with the real multipart
 * middleware and StartServer's own error handler, and the connection-closing
 * StartServer mounts first (UnreadRequestBody).
 *
 *   - a request the key check refuses has nothing of its body read;
 *   - a gzip body is inflated first, whatever its type, as StartServer
 *     inflated it before routing; then a multipart form is parsed, JSON is
 *     (where the route takes it) counted and parsed, and any other body is
 *     (where the route takes its bytes) read as them;
 *   - a body of a type the route takes none of is left unread;
 *   - each is held to the reader's limit, as sent and once inflated.
 */

jest.setTimeout(300000);

const KEY: string = "the-right-key";

const BOUNDARY: string = "----read-upload-10673";

const MULTIPART_TYPE: string = `multipart/form-data; boundary=${BOUNDARY}`;

// The limit of the routes whose readers are held to less than a large one.
const SMALL: RequestBodyLimit = {
  bytes: MIB,
  values: 1000,
  objectsArraysAndStrings: 1000,
};

interface Part {
  name: string;
  value: Buffer;
  filename?: string;
}

function multipart(parts: Array<Part>): Buffer {
  const chunks: Array<Buffer> = [];

  for (const part of parts) {
    const disposition: string = part.filename
      ? `form-data; name="${part.name}"; filename="${part.filename}"`
      : `form-data; name="${part.name}"`;

    chunks.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: ${disposition}\r\n\r\n`,
      ),
      part.value,
      Buffer.from("\r\n"),
    );
  }

  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));

  return Buffer.concat(chunks as unknown as Array<Uint8Array>);
}

// Bytes drawn from the shared seeded generator: they do not compress.
function noise(bytes: number, random: SeededRandom): Buffer {
  const buffer: Buffer = Buffer.alloc(bytes);

  for (let offset: number = 0; offset + 4 <= bytes; offset += 4) {
    buffer.writeUInt32LE(random(4294967296), offset);
  }

  return buffer;
}

const RANDOM: SeededRandom = seededRandom(73);

const FILE: Buffer = noise(200 * KIB, RANDOM);

const FORM: Buffer = multipart([
  { name: "serviceName", value: Buffer.from("my-web-app") },
  { name: "upload", value: FILE, filename: "upload.bin" },
]);

/*
 * The routes, each behind the same key check - a header, nothing else - and
 * each answering with what reached it.
 */
const ROUTES: Record<string, UploadBodyReaders> = {
  // Pyroscope's: a multipart form, or the profile's bytes.
  "/profile": {
    limit: LARGE_REQUEST_BODY_LIMIT,
    multipart: MultipartFormDataMiddleware,
    bytes: true,
  },
  // dSYMs': a multipart form, or JSON.
  "/symbols": {
    limit: LARGE_REQUEST_BODY_LIMIT,
    multipart: getMultipartFormDataMiddleware({ maxFiles: 3 }),
    json: true,
  },
  // A multipart form alone, held to 1 MB.
  "/small": {
    limit: SMALL,
    multipart: MultipartFormDataMiddleware,
    json: true,
  },
};

// What a route found of its body.
interface Found {
  files: Array<{ fieldname: string; size: number; sameBytes: boolean }>;
  fields: Array<string>;
  kind: "none" | "bytes" | "parsed";
  bytes?: number;
  json?: unknown;
  limit?: number | undefined;
}

const checkKey: RequestHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): void => {
  if (req.headers["x-test-key"] !== KEY) {
    res.status(401).json({ refused: "no key" });
    return;
  }

  next();
};

const answerWhatArrived: RequestHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
): void => {
  const files: Array<{ fieldname: string; size: number; buffer: Buffer }> =
    (
      req as unknown as {
        files?: Array<{ fieldname: string; size: number; buffer: Buffer }>;
      }
    ).files || [];
  const body: unknown = req.body;
  const isBytes: boolean = Buffer.isBuffer(body);
  const isParsed: boolean =
    !isBytes &&
    body !== undefined &&
    body !== null &&
    typeof body === "object" &&
    Object.keys(body as Record<string, unknown>).length > 0;

  const found: Found = {
    files: files.map(
      (file: { fieldname: string; size: number; buffer: Buffer }) => {
        return {
          fieldname: file.fieldname,
          size: file.size,
          sameBytes: file.buffer.equals(FILE as unknown as Uint8Array),
        };
      },
    ),
    fields: isParsed ? Object.keys(body as Record<string, unknown>) : [],
    kind: isBytes ? "bytes" : isParsed ? "parsed" : "none",
    ...(isBytes ? { bytes: (body as Buffer).length } : {}),
    ...(isParsed && files.length === 0 ? { json: body } : {}),
    limit: (req as OneUptimeRequest).requestBodyLimit?.bytes,
  };

  res.json(found);
};

/*
 * What zlib inflated, counted where its streams hand their output on (its
 * own functions are read-only).
 */
const watched: { inflated: number } = { inflated: 0 };

const readablePush: Readable["push"] = Readable.prototype.push;

const ZLIB_STREAMS: Array<{ push: Readable["push"] }> = [
  (zlib as unknown as { Gunzip: { prototype: { push: Readable["push"] } } })
    .Gunzip.prototype,
  (zlib as unknown as { Inflate: { prototype: { push: Readable["push"] } } })
    .Inflate.prototype,
];

let watchers: Array<ReturnType<typeof jest.spyOn>> = [];
let jsonParse: ReturnType<typeof jest.spyOn>;

// The longest text JSON.parse was handed since the test began.
function longestJsonParsed(): number {
  return (jsonParse.mock.calls as Array<Array<unknown>>).reduce(
    (longest: number, call: Array<unknown>): number => {
      return typeof call[0] === "string"
        ? Math.max(longest, call[0].length)
        : longest;
    },
    0,
  );
}

let server: BodyServer;

beforeAll(async () => {
  const app: ExpressApplication = createExpressApp();

  // As StartServer mounts it first: an answer to a body unread closes it.
  app.use(UnreadRequestBody.closeConnectionInstead);

  for (const [path, readers] of Object.entries(ROUTES)) {
    app.post(
      path,
      checkKey,
      RequestBodyAfterAuthentication.readUpload(readers),
      answerWhatArrived,
    );
  }

  // A body read before this ran - by a test, here - is left as it is.
  app.post(
    "/read-before",
    (req: ExpressRequest, _res: ExpressResponse, next: NextFunction) => {
      req.body = Buffer.from("read before");
      next();
    },
    RequestBodyAfterAuthentication.readUpload(ROUTES["/profile"]!),
    answerWhatArrived,
  );

  app.use(expressErrorHandler);

  server = await startBodyServer(app);
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  (logger.error as unknown as jest.Mock).mockClear();
  watched.inflated = 0;
  watchers = ZLIB_STREAMS.map(
    (prototype: { push: Readable["push"] }): ReturnType<typeof jest.spyOn> => {
      return jest.spyOn(prototype, "push").mockImplementation(function (
        this: Readable,
        chunk: unknown,
        encoding?: Parameters<Readable["push"]>[1],
      ): boolean {
        if (Buffer.isBuffer(chunk)) {
          watched.inflated += chunk.length;
        }

        return readablePush.call(this, chunk, encoding);
      });
    },
  );
  jsonParse = jest.spyOn(JSON, "parse");
});

afterEach(() => {
  for (const watcher of watchers) {
    watcher.mockRestore();
  }

  watchers = [];
  jsonParse.mockRestore();
});

const KEYED: Record<string, string> = { "x-test-key": KEY };

function found(sent: SentRequest): Found {
  expect(sent.answer.status).toBe(200);

  return sent.answer.json as Found;
}

describe("a request its key check refuses", () => {
  test.each([...CONNECTIONS])(
    "has nothing of its body read, declared or chunked, multipart, JSON or bytes, gzip-encoded or not (%s)",
    async (connection: Connection) => {
      const forty: Buffer = noise(40 * MIB, RANDOM);
      const bodies: Array<{ headers: Record<string, string>; body: Buffer }> = [
        {
          headers: { "content-type": MULTIPART_TYPE },
          body: multipart([{ name: "upload", value: forty, filename: "big" }]),
        },
        {
          headers: {
            "content-type": MULTIPART_TYPE,
            "content-encoding": "gzip",
          },
          body: zlib.gzipSync(
            multipart([
              {
                name: "upload",
                value: Buffer.alloc(40 * MIB, 0x61),
                filename: "big",
              },
            ]),
          ),
        },
        {
          headers: { "content-type": "application/octet-stream" },
          body: forty,
        },
      ];

      for (const path of Object.keys(ROUTES)) {
        for (const { headers, body } of bodies) {
          for (const chunked of [false, true]) {
            const sent: SentRequest = await sendOverHttp(server, {
              path: path,
              headers: headers,
              connection: connection,
              chunked: chunked,
              body: body,
            });

            expect(sent.answer.status).toBe(401);
            expect(sent.answer.clientError).toBeNull();

            /*
             * Closed under the rest, which is never read - but for a body
             * that declares no more than 64 KiB (the gzip one, here), which
             * Node reads off to keep the connection (UnreadRequestBody).
             */
            if (chunked || body.length > UNREAD_BODY_READ_OFF_BYTES) {
              expect(sent.answer.connection).toBe("close");
            }

            expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(
              READ_OR_TWO,
            );
          }
        }
      }

      expect(watched.inflated).toBe(0);
      expect(longestJsonParsed()).toBeLessThan(READ_OR_TWO);
    },
  );
});

describe("a multipart form, once the key is right", () => {
  test.each([
    ["as it is", undefined, FORM],
    ["gzip-encoded, inflated first", "gzip", zlib.gzipSync(FORM)],
    ["deflate-encoded", "deflate", zlib.deflateSync(FORM)],
  ])(
    "%s, is parsed: its file and its fields, whole, declared and chunked",
    async (_how: string, encoding: string | undefined, body: Buffer) => {
      for (const path of Object.keys(ROUTES)) {
        for (const chunked of [false, true]) {
          const sent: SentRequest = await sendOverHttp(server, {
            path: path,
            headers: {
              "content-type": MULTIPART_TYPE,
              ...(encoding ? { "content-encoding": encoding } : {}),
              ...KEYED,
            },
            chunked: chunked,
            body: body,
          });

          expect(found(sent)).toMatchObject({
            files: [
              { fieldname: "upload", size: FILE.length, sameBytes: true },
            ],
            fields: ["serviceName"],
          });
        }
      }

      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  test("is held to the reader's own limit, whatever its encoding, not the most any route takes", async () => {
    const overSmall: Buffer = multipart([
      { name: "upload", value: noise(SMALL.bytes + 1, RANDOM), filename: "x" },
    ]);

    for (const encoding of [undefined, "gzip"]) {
      const sent: SentRequest = await sendOverHttp(server, {
        path: "/small",
        headers: {
          "content-type": MULTIPART_TYPE,
          ...(encoding ? { "content-encoding": encoding } : {}),
          ...KEYED,
        },
        body: encoding ? zlib.gzipSync(overSmall) : overSmall,
      });

      expect(sent.answer.status).toBe(413);
      // The same words, gzip or not.
      expect(sent.answer.json).toEqual({
        error: getTooLargeForRouteMessage(SMALL.bytes),
      });
    }
  });

  test("past a large route's 50 MB, is refused 413 unread when declared, at the limit when chunked, and a gzip bomb as it inflates", async () => {
    const over: Buffer = multipart([
      { name: "upload", value: Buffer.alloc(64 * MIB, 0x61), filename: "x" },
    ]);

    const declared: SentRequest = await sendOverHttp(server, {
      path: "/profile",
      headers: { "content-type": MULTIPART_TYPE, ...KEYED },
      body: over,
    });

    expect(declared.answer.status).toBe(413);
    expect(declared.answer.json).toEqual({
      error: REQUEST_BODY_REFUSAL_MESSAGES.tooLargeForOneUptime,
    });
    expect(await server.readInAll(declared.tag)).toBeLessThanOrEqual(
      READ_OR_TWO,
    );

    const chunked: SentRequest = await sendOverHttp(server, {
      path: "/profile",
      headers: { "content-type": MULTIPART_TYPE, ...KEYED },
      chunked: true,
      body: over,
    });

    expect(chunked.answer.status).toBe(413);

    const read: number = await server.readInAll(chunked.tag);

    expect(read).toBeGreaterThan(LARGE_REQUEST_BODY_LIMIT.bytes);
    expect(read).toBeLessThanOrEqual(
      LARGE_REQUEST_BODY_LIMIT.bytes + READ_OR_TWO,
    );

    const bomb: SentRequest = await sendOverHttp(server, {
      path: "/profile",
      headers: {
        "content-type": MULTIPART_TYPE,
        "content-encoding": "gzip",
        ...KEYED,
      },
      chunked: true,
      body: zlib.gzipSync(over),
    });

    expect(bomb.answer.status).toBe(413);
    // In the words a body uncompressed over the same limit is told.
    expect(bomb.answer.json).toEqual(declared.answer.json);
    expect(await server.readInAll(bomb.tag)).toBeLessThanOrEqual(READ_OR_TWO);
  });

  test("one multer refuses is answered in its words, and nothing after it runs", async () => {
    const files: Buffer = multipart(
      Array.from({ length: 4 }, (_v: unknown, index: number): Part => {
        return { name: `f${index}`, value: Buffer.from("x"), filename: "x" };
      }),
    );

    // The dSYM route's multipart reader takes three files.
    const sent: SentRequest = await sendOverHttp(server, {
      path: "/symbols",
      headers: { "content-type": MULTIPART_TYPE, ...KEYED },
      body: files,
    });

    expect(sent.answer.status).toBe(413);
    expect(sent.answer.json).toEqual({
      error: "Multipart request rejected: LIMIT_FILE_COUNT.",
    });

    const malformed: SentRequest = await sendOverHttp(server, {
      path: "/symbols",
      headers: { "content-type": MULTIPART_TYPE, ...KEYED },
      body: Buffer.from("this is no multipart form"),
    });

    expect(malformed.answer.status).toBe(400);
    expect(malformed.answer.json).toEqual({
      error: REQUEST_BODY_REFUSAL_MESSAGES.multipartMalformed,
    });
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("JSON, on a route that takes it", () => {
  const SYMBOLS: Buffer = Buffer.from(
    JSON.stringify({ appName: "storefront-ios", symbolFiles: [{ a: 1 }] }),
  );

  test("is parsed, as it is or gzip-encoded, declared and chunked", async () => {
    for (const encoding of [undefined, "gzip", "deflate"]) {
      for (const chunked of [false, true]) {
        const sent: SentRequest = await sendOverHttp(server, {
          path: "/symbols",
          headers: {
            "content-type": "application/json",
            ...(encoding ? { "content-encoding": encoding } : {}),
            ...KEYED,
          },
          chunked: chunked,
          body:
            encoding === "gzip"
              ? zlib.gzipSync(SYMBOLS)
              : encoding === "deflate"
                ? zlib.deflateSync(SYMBOLS)
                : SYMBOLS,
        });

        expect(found(sent)).toMatchObject({
          kind: "parsed",
          json: JSON.parse(SYMBOLS.toString()),
        });
      }
    }
  });

  test("holding more values than its limit, is refused 413 before JSON.parse sees it, as it is or gzipped", async () => {
    const values: Buffer = Buffer.from(`[${"0,".repeat(SMALL.values)}0]`);

    for (const encoding of [undefined, "gzip"]) {
      const sent: SentRequest = await sendOverHttp(server, {
        path: "/small",
        headers: {
          "content-type": "application/json",
          ...(encoding ? { "content-encoding": encoding } : {}),
          ...KEYED,
        },
        body: encoding ? zlib.gzipSync(values) : values,
      });

      expect(sent.answer.status).toBe(413);
      expect(sent.answer.json).toEqual({
        error: getTooManyJsonValuesMessage(
          JsonElementLimit.Values,
          SMALL.values,
        ),
      });
    }

    expect(longestJsonParsed()).toBeLessThan(values.length);
  });

  test("that is no JSON, is refused 400 in its sentence", async () => {
    const sent: SentRequest = await sendOverHttp(server, {
      path: "/symbols",
      headers: { "content-type": "application/json", ...KEYED },
      body: Buffer.from("{ not json"),
    });

    expect(sent.answer.status).toBe(400);
    expect(sent.answer.json).toEqual({
      error: REQUEST_BODY_REFUSAL_MESSAGES.invalidJson,
    });
  });

  test("on a route that takes the bytes and no JSON, is read as its bytes", async () => {
    const sent: SentRequest = await sendOverHttp(server, {
      path: "/profile",
      headers: { "content-type": "application/json", ...KEYED },
      body: SYMBOLS,
    });

    expect(found(sent)).toMatchObject({
      kind: "bytes",
      bytes: SYMBOLS.length,
    });
  });
});

describe("a body of any other type", () => {
  test.each([
    ["application/octet-stream"],
    ["binary/octet-stream"],
    ["text/plain"],
    ["application/x-protobuf"],
  ])(
    "%s, on a route that takes the bytes, is read as them: as it is, gzip- or deflate-encoded",
    async (contentType: string) => {
      for (const encoding of [undefined, "gzip", "deflate"]) {
        const sent: SentRequest = await sendOverHttp(server, {
          path: "/profile",
          headers: {
            "content-type": contentType,
            ...(encoding ? { "content-encoding": encoding } : {}),
            ...KEYED,
          },
          body:
            encoding === "gzip"
              ? zlib.gzipSync(FILE)
              : encoding === "deflate"
                ? zlib.deflateSync(FILE)
                : FILE,
        });

        expect(found(sent)).toMatchObject({
          kind: "bytes",
          bytes: FILE.length,
          limit: LARGE_REQUEST_BODY_LIMIT.bytes,
        });
      }
    },
  );

  test.each([...CONNECTIONS])(
    "on a route that takes none of it, is left unread: the route finds no body, and the connection is closed under the rest (%s)",
    async (connection: Connection) => {
      const sent: SentRequest = await sendOverHttp(server, {
        path: "/symbols",
        headers: { "content-type": "application/octet-stream", ...KEYED },
        connection: connection,
        bytes: 40 * MIB,
      });

      expect(found(sent)).toMatchObject({ kind: "none", files: [] });
      expect(sent.answer.connection).toBe("close");
      expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(READ_OR_TWO);
    },
  );

  test("gzip-encoded, on a route that takes none of it, is inflated as StartServer inflated it, and reaches it as its bytes", async () => {
    const sent: SentRequest = await sendOverHttp(server, {
      path: "/symbols",
      headers: {
        "content-type": "text/plain",
        "content-encoding": "gzip",
        ...KEYED,
      },
      body: zlib.gzipSync(FILE),
    });

    expect(found(sent)).toMatchObject({ kind: "bytes", bytes: FILE.length });
  });
});

describe("a body read before readUpload runs", () => {
  test("is left as it is", async () => {
    const sent: SentRequest = await sendOverHttp(server, {
      path: "/read-before",
      headers: { "content-type": "application/octet-stream", ...KEYED },
      body: Buffer.from("never read"),
    });

    expect(found(sent)).toMatchObject({
      kind: "bytes",
      bytes: Buffer.from("read before").length,
    });
  });
});
