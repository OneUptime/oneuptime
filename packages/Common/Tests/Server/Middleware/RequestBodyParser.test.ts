import GzipRequestBodyMiddleware from "../../../Server/Middleware/GzipRequestBody";
import RequestBodyParser, {
  RequestBodyParserOptions,
  parseBodyLimit,
} from "../../../Server/Middleware/RequestBodyParser";
import {
  ExpressJson,
  ExpressRaw,
  ExpressRequest,
  ExpressResponse,
  ExpressText,
  ExpressUrlEncoded,
  NextFunction,
  OneUptimeRequest,
  RequestHandler,
} from "../../../Server/Utils/Express";
import readRequestBodyRefusal, {
  APP_REQUEST_BODY_LIMIT_FIELD,
  INFLATE_FAILED_TYPE,
  REQUEST_BODY_REFUSAL_MESSAGES,
  TOO_MANY_JSON_VALUES_TYPE,
} from "../../../Server/Utils/RequestBodyRefusal";
import {
  createJsonBodyParserOptions,
  createUrlEncodedBodyParserOptions,
} from "../../../Server/Utils/StartServer";
import GenericFunction from "../../../Types/GenericFunction";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";
import { Readable } from "stream";
import timers from "timers";
import zlib from "zlib";

/*
 * BODY-PARSER, READING NO FURTHER THAN ITS LIMIT (#10598), on a stream whose
 * chunks the test hands over one at a time.
 *
 * body-parser refused a body over its limit and then read the whole request
 * off before it answered: 64 MiB sent to a route held to 1 MB were read,
 * every byte. RequestBodyParser reads the body itself and has body-parser
 * parse it: so here,
 *
 *   - what body-parser made of a body, it still makes, the same way, however
 *     the body is cut, with verify given the request itself;
 *   - a body whose Content-Length is over the limit is refused before a byte
 *     of it is read, and one that grows past it at the chunk that does;
 *   - anything body-parser refuses part-way - a deflate body inflating past
 *     the limit, or not inflating - leaves the rest unread;
 *   - every refused body's answer closes the connection, with nothing more
 *     read (closeConnectionAfterAnswer);
 *   - a body that does not inflate is refused as the client's, 400, where
 *     body-parser's zlib error was a 500.
 *
 * Over a socket, with real clients: RequestBodyParserOverHttp.test.ts.
 */

const KIB: number = 1024;
const MIB: number = 1024 * 1024;

// jsdom has no setImmediate, and body-parser needs it.
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * A request as the HTTP server hands it over, without a socket: the body
 * arrives as the test sends it, and is read off a chunk at a time, only when
 * whoever reads the request asks for more - as a socket's is. `taken` is
 * what was read off: what a socket would have had read.
 */
class StreamRequest extends Readable {
  public headers: Record<string, string | undefined>;
  public method: string = "POST";
  public url: string = "/";
  public body?: unknown;
  public _body?: boolean;
  public rawBody?: string;
  public taken: number = 0;

  private readonly arrived: Array<Buffer> = [];
  private hasArrivedWhole: boolean = false;
  private isAsked: boolean = false;

  public constructor(headers: Record<string, string>) {
    super({ highWaterMark: 16 * KIB });
    /*
     * A body with no Content-Length comes chunked: that header is how the
     * parsers know there is one.
     */
    this.headers =
      headers["content-length"] === undefined
        ? { ...headers, "transfer-encoding": "chunked" }
        : headers;
  }

  // A chunk the client sent.
  public send(chunk: Buffer): void {
    this.arrived.push(chunk);
    this.handOver();
  }

  // The client sent the last of it.
  public sendEnd(): void {
    this.hasArrivedWhole = true;
    this.handOver();
  }

  // What the client sent that was not read off yet.
  public get waiting(): number {
    return this.arrived.length;
  }

  public override _read(): void {
    this.isAsked = true;
    this.handOver();
  }

  private handOver(): void {
    while (this.isAsked && this.arrived.length > 0) {
      const chunk: Buffer = this.arrived.shift()!;

      this.taken += chunk.length;
      this.isAsked = this.push(chunk);
    }

    if (this.isAsked && this.arrived.length === 0 && this.hasArrivedWhole) {
      this.isAsked = false;
      this.push(null);
    }
  }
}

function streamRequest(headers: Record<string, string>): StreamRequest {
  return new StreamRequest(headers);
}

interface Answer {
  shouldKeepAlive: boolean;
  headersSent: boolean;
  req?: StreamRequest | undefined;
}

interface Outcome {
  error: unknown;
  req: StreamRequest;
  res: Answer;
}

// The next turn of the event loop, and those body-parser takes after it.
function settle(): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    timers.setTimeout(resolve, 20);
  });
}

/*
 * Runs `parser` on a request: writes the chunks into it one at a time, each
 * only once the one before was read off, until the parser answers - and then
 * no more. Resolves with what the parser handed on.
 */
async function run(data: {
  parser: RequestHandler;
  headers: Record<string, string>;
  chunks: Array<Buffer>;
  end?: boolean;
}): Promise<Outcome> {
  const req: StreamRequest = streamRequest(data.headers);
  const res: Answer = { shouldKeepAlive: true, headersSent: false, req: req };

  let answered: boolean = false;
  let error: unknown = undefined;

  const done: Promise<void> = new Promise<void>((resolve: () => void) => {
    data.parser(
      req as unknown as ExpressRequest,
      res as unknown as ExpressResponse,
      ((err?: unknown): void => {
        answered = true;
        error = err;
        resolve();
      }) as NextFunction,
    );
  });

  for (const chunk of data.chunks) {
    if (answered) {
      break;
    }

    req.send(chunk);

    // The next chunk is sent once this one was read, as a socket would.
    for (let wait: number = 0; wait < 200 && req.waiting > 0; wait++) {
      if (answered) {
        break;
      }

      await settle();
    }

    // Read no further: whatever reads the request has stopped.
    if (req.waiting > 0) {
      break;
    }
  }

  if (!answered && data.end !== false) {
    req.sendEnd();
  }

  await Promise.race([
    done,
    new Promise<void>((resolve: () => void) => {
      timers.setTimeout(resolve, 5000);
    }),
  ]);

  return { error: error, req: req, res: res };
}

function cut(buffer: Buffer, size: number): Array<Buffer> {
  const chunks: Array<Buffer> = [];

  for (let offset: number = 0; offset < buffer.length; offset += size) {
    chunks.push(buffer.subarray(offset, offset + size));
  }

  return chunks;
}

// The body cut where the generator chooses, as sockets cut it.
function cutAtRandom(buffer: Buffer, random: SeededRandom): Array<Buffer> {
  const chunks: Array<Buffer> = [];
  let offset: number = 0;

  while (offset < buffer.length) {
    const size: number = 1 + random(Math.min(8 * KIB, buffer.length - offset));
    chunks.push(buffer.subarray(offset, offset + size));
    offset += size;
  }

  return chunks;
}

// Bytes that compress poorly, from the shared seeded generator.
function noise(bytes: number, random: SeededRandom): Buffer {
  const buffer: Buffer = Buffer.alloc(bytes);

  for (let index: number = 0; index < bytes; index++) {
    buffer[index] = 97 + random(26);
  }

  return buffer;
}

function bounded(
  create: GenericFunction,
  options: RequestBodyParserOptions,
): RequestHandler {
  return RequestBodyParser.create(create, options);
}

const ROUTE_LIMIT: number = MIB;

const json: RequestHandler = bounded(ExpressJson, { limit: ROUTE_LIMIT });

const JSON_HEADERS: Record<string, string> = {
  "content-type": "application/json",
};

describe("parseBodyLimit reads a limit as body-parser does", () => {
  test.each([
    [1048576, 1048576],
    ["50mb", 52428800],
    ["100kb", 102400],
    ["1.5mb", 1572864],
    ["2KB", 2048],
    ["512", 512],
    ["7b", 7],
    [undefined, 102400],
  ])("%s is %d bytes", (limit: unknown, bytes: number) => {
    expect(parseBodyLimit(limit as number | string | undefined)).toBe(bytes);
  });

  test.each([["fifty megabytes"], ["-1mb"], [-1], [Number.NaN]])(
    "%s is not a size",
    (limit: unknown) => {
      expect(() => {
        return parseBodyLimit(limit as number | string);
      }).toThrow(TypeError);
    },
  );
});

describe("what body-parser made of a body, it still makes", () => {
  test("JSON, cut anywhere, parses to what body-parser alone made of it", async () => {
    const random: SeededRandom = seededRandom(10598);
    const document: Record<string, unknown> = {
      monitor: { name: "API", tags: ["a", "b", "ü"], interval: 60 },
      rows: Array.from({ length: 2000 }, (_: unknown, index: number) => {
        return { index: index, text: `row ${index} ✓` };
      }),
    };
    const body: Buffer = Buffer.from(JSON.stringify(document));

    for (let attempt: number = 0; attempt < 12; attempt++) {
      const outcome: Outcome = await run({
        parser: json,
        headers: { ...JSON_HEADERS, "content-length": String(body.length) },
        chunks: cutAtRandom(body, random),
      });

      expect(outcome.error).toBeUndefined();
      expect(outcome.req.body).toEqual(document);
      expect(outcome.req._body).toBe(true);
      expect(outcome.req.taken).toBe(body.length);
      expect(outcome.res.shouldKeepAlive).toBe(true);
    }
  });

  test("a form, the raw bytes of a protobuf body, and a text", async () => {
    const form: Outcome = await run({
      parser: bounded(ExpressUrlEncoded, { extended: true, limit: "1mb" }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      chunks: [Buffer.from("name=API&tags[0]=a&tags[1]=b")],
    });

    expect(form.error).toBeUndefined();
    expect(form.req.body).toEqual({ name: "API", tags: ["a", "b"] });

    const bytes: Buffer = Buffer.from([0x0a, 0x03, 0x41, 0x50, 0x49, 0x00]);
    const raw: Outcome = await run({
      parser: bounded(ExpressRaw, {
        type: ["application/x-protobuf"],
        limit: ROUTE_LIMIT,
      }),
      headers: { "content-type": "application/x-protobuf" },
      chunks: [bytes],
    });

    expect(raw.error).toBeUndefined();
    expect(Buffer.isBuffer(raw.req.body)).toBe(true);
    expect((raw.req.body as Buffer).equals(bytes)).toBe(true);

    const text: Outcome = await run({
      parser: bounded(ExpressText, { type: ["text/plain"], limit: "50mb" }),
      headers: { "content-type": "text/plain; charset=utf-8" },
      chunks: [Buffer.from("backup "), Buffer.from("failed ✗")],
    });

    expect(text.error).toBeUndefined();
    expect(text.req.body).toBe("backup failed ✗");
  });

  test("a deflate or gzip body is inflated as body-parser inflates it", async () => {
    const document: Record<string, unknown> = { rows: [1, 2, 3], ok: true };
    const text: Buffer = Buffer.from(JSON.stringify(document));

    for (const [encoding, body] of [
      ["deflate", zlib.deflateSync(text)],
      ["gzip", zlib.gzipSync(text)],
    ] as Array<[string, Buffer]>) {
      const outcome: Outcome = await run({
        parser: json,
        headers: { ...JSON_HEADERS, "content-encoding": encoding },
        chunks: cut(body, 7),
      });

      expect(outcome.error).toBeUndefined();
      expect(outcome.req.body).toEqual(document);
    }
  });

  test("verify is given the request itself: the raw body is kept where the route reads it", async () => {
    const body: string = '{"type":"url_verification","challenge":"abc"}';
    const parser: RequestHandler = RequestBodyParser.create(
      ExpressJson,
      createJsonBodyParserOptions({
        bytes: ROUTE_LIMIT,
        values: 1000,
        objectsArraysAndStrings: 1000,
      }),
    );

    const outcome: Outcome = await run({
      parser: parser,
      headers: JSON_HEADERS,
      chunks: [Buffer.from(body)],
    });

    expect(outcome.error).toBeUndefined();
    expect(outcome.req.rawBody).toBe(body);

    const form: Outcome = await run({
      parser: RequestBodyParser.create(
        ExpressUrlEncoded,
        createUrlEncodedBodyParserOptions({
          bytes: ROUTE_LIMIT,
          values: 1000,
          objectsArraysAndStrings: 1000,
        }),
      ),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      chunks: [Buffer.from("payload=%7B%7D")],
    });

    expect(form.error).toBeUndefined();
    expect(
      (form.req as unknown as OneUptimeRequest).rawFormUrlEncodedBody,
    ).toBe("payload=%7B%7D");
  });

  test("a body of a type the parser does not read is left unread, as body-parser leaves it", async () => {
    const outcome: Outcome = await run({
      parser: json,
      headers: { "content-type": "text/plain", "content-length": "11" },
      chunks: [Buffer.from("backup done")],
      end: false,
    });

    expect(outcome.error).toBeUndefined();
    expect(outcome.req.body).toEqual({});
    expect(outcome.req._body).toBeUndefined();
    expect(outcome.req.taken).toBe(0);
    expect(outcome.req.readableFlowing).toBeNull();
    expect(outcome.res.shouldKeepAlive).toBe(true);
  });

  test("a body read before is passed over, as body-parser passes over it", async () => {
    const req: StreamRequest = streamRequest(JSON_HEADERS);

    req._body = true;
    req.body = { parsed: "before" };

    const errors: Array<unknown> = [];

    json(
      req as unknown as ExpressRequest,
      {} as ExpressResponse,
      ((err?: unknown): void => {
        errors.push(err);
      }) as NextFunction,
    );

    expect(errors).toEqual([undefined]);
    expect(req.body).toEqual({ parsed: "before" });
  });

  test("JSON that does not parse is refused 400 once it is in, its connection kept", async () => {
    const outcome: Outcome = await run({
      parser: json,
      headers: JSON_HEADERS,
      chunks: [Buffer.from('{"a":')],
    });

    expect(readRequestBodyRefusal(outcome.error)?.message).toBe(
      REQUEST_BODY_REFUSAL_MESSAGES.invalidJson,
    );
    expect(outcome.res.shouldKeepAlive).toBe(true);
  });

  test("a verify that refuses the body hands its refusal on, as it did", async () => {
    const parser: RequestHandler = RequestBodyParser.create(
      ExpressJson,
      createJsonBodyParserOptions({
        bytes: ROUTE_LIMIT,
        values: 10,
        objectsArraysAndStrings: 10,
      }),
    );

    const outcome: Outcome = await run({
      parser: parser,
      headers: JSON_HEADERS,
      chunks: [Buffer.from(JSON.stringify(Array.from({ length: 50 })))],
    });

    expect((outcome.error as { type?: unknown }).type).toBe(
      TOO_MANY_JSON_VALUES_TYPE,
    );
    expect(readRequestBodyRefusal(outcome.error)?.status).toBe(413);
  });
});

describe("a body over the limit is not read past it", () => {
  test("a Content-Length over the limit is refused before a byte is read", async () => {
    const outcome: Outcome = await run({
      parser: json,
      headers: {
        ...JSON_HEADERS,
        "content-length": String(64 * MIB),
      },
      chunks: cut(Buffer.alloc(256 * KIB, 0x20), 64 * KIB),
      end: false,
    });

    expect(outcome.error).toMatchObject({
      type: "entity.too.large",
      status: 413,
      limit: ROUTE_LIMIT,
      length: 64 * MIB,
      [APP_REQUEST_BODY_LIMIT_FIELD]: ROUTE_LIMIT,
    });
    expect(outcome.req.taken).toBe(0);
    expect(outcome.res.shouldKeepAlive).toBe(false);
  });

  test("a body that grows past the limit is refused at the chunk that does, and no more is read", async () => {
    const outcome: Outcome = await run({
      parser: json,
      headers: JSON_HEADERS,
      chunks: cut(Buffer.alloc(8 * MIB, 0x20), 64 * KIB),
      end: false,
    });

    expect(outcome.error).toMatchObject({
      type: "entity.too.large",
      status: 413,
      limit: ROUTE_LIMIT,
      [APP_REQUEST_BODY_LIMIT_FIELD]: ROUTE_LIMIT,
    });
    expect(outcome.req.taken).toBeGreaterThan(ROUTE_LIMIT);
    expect(outcome.req.taken).toBeLessThanOrEqual(ROUTE_LIMIT + 64 * KIB);
    expect(outcome.res.shouldKeepAlive).toBe(false);
    expect(outcome.req.readableFlowing).toBe(false);
  });

  test("the limit is the parser's own, whatever its size", async () => {
    for (const limit of [16 * KIB, 100 * KIB, 3 * MIB]) {
      const outcome: Outcome = await run({
        parser: bounded(ExpressRaw, {
          type: (): boolean => {
            return true;
          },
          limit: limit,
        }),
        headers: { "content-type": "application/octet-stream" },
        chunks: cut(Buffer.alloc(limit * 3, 1), 4 * KIB),
        end: false,
      });

      expect((outcome.error as { limit?: unknown }).limit).toBe(limit);
      expect(outcome.req.taken).toBeLessThanOrEqual(limit + 4 * KIB);
    }
  });

  test("a body exactly at the limit is read whole", async () => {
    const body: Buffer = Buffer.alloc(ROUTE_LIMIT, 0x20);
    body[0] = 0x5b; // [
    body[ROUTE_LIMIT - 1] = 0x5d; // ]

    const outcome: Outcome = await run({
      parser: json,
      headers: { ...JSON_HEADERS, "content-length": String(ROUTE_LIMIT) },
      chunks: cut(body, 64 * KIB),
    });

    expect(outcome.error).toBeUndefined();
    expect(outcome.req.body).toEqual([]);
    expect(outcome.req.taken).toBe(ROUTE_LIMIT);
  });

  test("a deflate body inflating past the limit is refused with the rest of it unread", async () => {
    const random: SeededRandom = seededRandom(5980);
    const compressed: Buffer = zlib.deflateSync(
      Buffer.concat([Buffer.from('{"text":"'), noise(6 * MIB, random)]),
    );

    expect(compressed.length).toBeGreaterThan(3 * MIB);

    const outcome: Outcome = await run({
      parser: json,
      headers: { ...JSON_HEADERS, "content-encoding": "deflate" },
      chunks: cut(compressed, 64 * KIB),
      end: false,
    });

    expect(readRequestBodyRefusal(outcome.error)?.status).toBe(413);
    // What inflated to the limit, and what the inflate held: not the rest.
    expect(outcome.req.taken).toBeLessThan(2 * MIB);
    expect(outcome.res.shouldKeepAlive).toBe(false);
  });

  test("a deflate body declared over the limit is refused before a byte is read", async () => {
    const outcome: Outcome = await run({
      parser: json,
      headers: {
        ...JSON_HEADERS,
        "content-encoding": "deflate",
        "content-length": String(ROUTE_LIMIT + 1),
      },
      chunks: [zlib.deflateSync(Buffer.from("[]"))],
      end: false,
    });

    expect(readRequestBodyRefusal(outcome.error)?.status).toBe(413);
    expect(outcome.req.taken).toBe(0);
  });

  test.each([["deflate"], ["gzip"]])(
    "a %s body that does not inflate is refused 400 as the client's, with the rest unread",
    async (encoding: string) => {
      const outcome: Outcome = await run({
        parser: json,
        headers: { ...JSON_HEADERS, "content-encoding": encoding },
        chunks: [
          Buffer.from(`this is not ${encoding}`),
          ...cut(Buffer.alloc(4 * MIB, 1), 64 * KIB),
        ],
        end: false,
      });

      expect(readRequestBodyRefusal(outcome.error)).toEqual({
        type: INFLATE_FAILED_TYPE,
        status: 400,
        message: REQUEST_BODY_REFUSAL_MESSAGES.notInflated,
      });
      expect(outcome.req.taken).toBeLessThan(512 * KIB);
      expect(outcome.res.shouldKeepAlive).toBe(false);
    },
  );

  test.each([["deflate"], ["gzip"]])(
    "a %s body cut off before its end is refused 400, once it is in",
    async (encoding: string) => {
      const text: Buffer = Buffer.from(JSON.stringify({ rows: [1, 2, 3] }));
      const whole: Buffer =
        encoding === "gzip" ? zlib.gzipSync(text) : zlib.deflateSync(text);

      const outcome: Outcome = await run({
        parser: json,
        headers: { ...JSON_HEADERS, "content-encoding": encoding },
        chunks: [whole.subarray(0, whole.length - 6)],
      });

      expect(readRequestBodyRefusal(outcome.error)?.type).toBe(
        INFLATE_FAILED_TYPE,
      );
      // Read whole: nothing is left to close the connection over.
      expect(outcome.res.shouldKeepAlive).toBe(true);
    },
  );

  test("a Content-Encoding no parser reads is refused 415 before a byte is read", async () => {
    const outcome: Outcome = await run({
      parser: json,
      headers: { ...JSON_HEADERS, "content-encoding": "br" },
      chunks: [Buffer.from("{}")],
      end: false,
    });

    expect(readRequestBodyRefusal(outcome.error)?.status).toBe(415);
    expect(outcome.req.taken).toBe(0);
    expect(outcome.res.shouldKeepAlive).toBe(false);
  });

  test("a charset no parser reads is refused 415 before a byte is read", async () => {
    const outcome: Outcome = await run({
      parser: json,
      headers: { "content-type": "application/json; charset=latin1" },
      chunks: [Buffer.from("{}")],
      end: false,
    });

    expect(readRequestBodyRefusal(outcome.error)?.status).toBe(415);
    expect(outcome.req.taken).toBe(0);
    expect(outcome.res.shouldKeepAlive).toBe(false);
  });

  test("a client that went away mid-body is told to the parser, which refuses it as it did", async () => {
    const req: StreamRequest = streamRequest(JSON_HEADERS);
    const res: Answer = { shouldKeepAlive: true, headersSent: false, req: req };

    const refused: Promise<unknown> = new Promise<unknown>(
      (resolve: (err: unknown) => void) => {
        json(
          req as unknown as ExpressRequest,
          res as unknown as ExpressResponse,
          resolve as NextFunction,
        );
      },
    );

    req.send(Buffer.from('{"rows":['));
    await settle();
    req.emit("aborted");

    expect(readRequestBodyRefusal(await refused)?.message).toBe(
      REQUEST_BODY_REFUSAL_MESSAGES.cutOff,
    );
  });
});

/*
 * A REQUEST WHOSE BODY WAS READ BEFORE (#10643).
 *
 * StartServer reads every gzip body before routing (GzipRequestBody): it
 * inflates it under the route's limit and leaves the inflated bytes in
 * req.body, unparsed, its stream read to the end. A route that parses its
 * own body handed its parser that request, and body-parser, seeing it
 * unmarked, read the spent stream again through a fresh gunzip: zlib's
 * "unexpected end of file", a 500 with an error-level log line, for a valid
 * body. Here such a request is parsed from the bytes kept, as the same body
 * sent uncompressed would have been, and nothing more is read off it.
 */

// A request as GzipRequestBody leaves one: read to its end, its bytes kept.
async function spentRequest(
  headers: Record<string, string>,
  kept?: Buffer | Uint8Array | undefined,
): Promise<StreamRequest> {
  const req: StreamRequest = streamRequest(headers);

  req.sendEnd();
  req.resume();
  await new Promise<void>((resolve: () => void) => {
    req.once("end", resolve);
  });

  if (kept !== undefined) {
    req.body = kept;
  }

  return req;
}

// Runs `parser` on a request already in hand, once: what it handed on.
function parseOnce(
  parser: RequestHandler,
  req: StreamRequest,
): Promise<Outcome> {
  const res: Answer = { shouldKeepAlive: true, headersSent: false, req: req };

  return new Promise<Outcome>((resolve: (outcome: Outcome) => void) => {
    parser(
      req as unknown as ExpressRequest,
      res as unknown as ExpressResponse,
      ((err?: unknown): void => {
        resolve({ error: err, req: req, res: res });
      }) as NextFunction,
    );
  });
}

// What the client sent: gzip, chunked, as most clients that compress send it.
const GZIP_JSON_HEADERS: Record<string, string> = {
  ...JSON_HEADERS,
  "content-encoding": "gzip",
};

describe("a body read before, its bytes kept, is parsed from them (#10643)", () => {
  const document: Record<string, unknown> = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "list_monitors", arguments: { query: { name: "API ✓" } } },
  };
  const bytes: Buffer = Buffer.from(JSON.stringify(document));

  test("JSON the gzip reader inflated parses to what the same JSON sent uncompressed does", async () => {
    const uncompressed: Outcome = await run({
      parser: json,
      headers: { ...JSON_HEADERS, "content-length": String(bytes.length) },
      chunks: [bytes],
    });

    const kept: Outcome = await parseOnce(
      json,
      await spentRequest(GZIP_JSON_HEADERS, bytes),
    );

    expect(kept.error).toBeUndefined();
    expect(kept.req.body).toEqual(uncompressed.req.body);
    expect(kept.req.body).toEqual(document);
    expect(kept.req._body).toBe(true);
    // Nothing more is read off the request: it was all in.
    expect(kept.req.taken).toBe(0);
    expect(kept.res.shouldKeepAlive).toBe(true);
  });

  test("through the gzip reader itself: inflated there, parsed here, once", async () => {
    const gzipThenJson: RequestHandler = (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): void => {
      GzipRequestBodyMiddleware.parseBody(
        req,
        res,
        ((err?: unknown): void => {
          if (err) {
            return next(err);
          }

          json(req, res, next);
        }) as NextFunction,
        { bytes: ROUTE_LIMIT, values: 1000, objectsArraysAndStrings: 1000 },
      );
    };

    const parses: Array<string> = [];
    const realParse: typeof JSON.parse = JSON.parse;

    JSON.parse = ((text: string, reviver?: never): unknown => {
      parses.push(text);
      return realParse(text, reviver);
    }) as typeof JSON.parse;

    let outcome: Outcome;

    try {
      outcome = await run({
        parser: gzipThenJson,
        headers: GZIP_JSON_HEADERS,
        chunks: cut(zlib.gzipSync(bytes), 7),
      });
    } finally {
      JSON.parse = realParse;
    }

    expect(outcome.error).toBeUndefined();
    expect(outcome.req.body).toEqual(document);
    expect(parses).toEqual([bytes.toString()]);
  });

  test("a form, the raw bytes of a protobuf body and a text, kept, parse as each does sent as it is", async () => {
    const form: Outcome = await parseOnce(
      bounded(ExpressUrlEncoded, { extended: false, limit: "64kb" }),
      await spentRequest(
        {
          "content-type": "application/x-www-form-urlencoded",
          "content-encoding": "gzip",
        },
        Buffer.from("grant_type=authorization_code&code=abc&state=%E2%9C%93"),
      ),
    );

    expect(form.error).toBeUndefined();
    expect(form.req.body).toEqual({
      grant_type: "authorization_code",
      code: "abc",
      state: "✓",
    });

    const protobuf: Buffer = Buffer.from([0x0a, 0x03, 0x41, 0x50, 0x49]);
    const raw: Outcome = await parseOnce(
      bounded(ExpressRaw, {
        type: ["application/x-protobuf"],
        limit: "1mb",
      }),
      await spentRequest(
        {
          "content-type": "application/x-protobuf",
          "content-encoding": "gzip",
        },
        protobuf,
      ),
    );

    expect(raw.error).toBeUndefined();
    expect(Buffer.isBuffer(raw.req.body)).toBe(true);
    expect((raw.req.body as Buffer).equals(protobuf)).toBe(true);
    expect(raw.req._body).toBe(true);

    const text: Outcome = await parseOnce(
      bounded(ExpressText, { type: ["text/plain"], limit: "1mb" }),
      await spentRequest(
        { "content-type": "text/plain", "content-encoding": "gzip" },
        Buffer.from("backup done ✓"),
      ),
    );

    expect(text.error).toBeUndefined();
    expect(text.req.body).toBe("backup done ✓");
  });

  test("a Uint8Array kept is bytes too", async () => {
    const outcome: Outcome = await parseOnce(
      json,
      await spentRequest(GZIP_JSON_HEADERS, new Uint8Array(bytes)),
    );

    expect(outcome.error).toBeUndefined();
    expect(outcome.req.body).toEqual(document);
  });

  test("verify is given the request itself and the bytes as inflated: the raw body kept, the values counted", async () => {
    const parser: RequestHandler = RequestBodyParser.create(
      ExpressJson,
      createJsonBodyParserOptions({
        bytes: ROUTE_LIMIT,
        values: 1000,
        objectsArraysAndStrings: 1000,
      }),
    );

    const kept: Outcome = await parseOnce(
      parser,
      await spentRequest(GZIP_JSON_HEADERS, bytes),
    );

    expect(kept.error).toBeUndefined();
    expect(kept.req.rawBody).toBe(bytes.toString());

    // Counted against the request's own limit, as StartServer counts one.
    const tooMany: StreamRequest = await spentRequest(
      GZIP_JSON_HEADERS,
      Buffer.from(
        JSON.stringify(
          Array.from({ length: 50 }, () => {
            return [1];
          }),
        ),
      ),
    );

    (tooMany as unknown as OneUptimeRequest).requestBodyLimit = {
      bytes: ROUTE_LIMIT,
      values: 10,
      objectsArraysAndStrings: 10,
    };

    const refused: Outcome = await parseOnce(parser, tooMany);

    expect(readRequestBodyRefusal(refused.error)?.type).toBe(
      TOO_MANY_JSON_VALUES_TYPE,
    );
    expect(readRequestBodyRefusal(refused.error)?.status).toBe(413);
  });

  test("bytes of a type the parser does not read are left as they are, for a parser of their type", async () => {
    const text: Buffer = Buffer.from("backup done");
    const req: StreamRequest = await spentRequest(
      { "content-type": "text/plain", "content-encoding": "gzip" },
      text,
    );

    const passed: Outcome = await parseOnce(json, req);

    expect(passed.error).toBeUndefined();
    expect(passed.req.body).toBe(text);
    expect(passed.req._body).toBeUndefined();

    const read: Outcome = await parseOnce(
      bounded(ExpressText, { type: ["text/plain"], limit: "1mb" }),
      req,
    );

    expect(read.error).toBeUndefined();
    expect(read.req.body).toBe("backup done");
    expect(read.req._body).toBe(true);
  });

  test("parsed once: a parser after it passes over the body it parsed", async () => {
    const req: StreamRequest = await spentRequest(GZIP_JSON_HEADERS, bytes);

    await parseOnce(json, req);

    const parsed: unknown = req.body;
    const again: Outcome = await parseOnce(
      bounded(ExpressJson, { limit: ROUTE_LIMIT }),
      req,
    );

    expect(again.error).toBeUndefined();
    expect(again.req.body).toBe(parsed);
  });

  test("bytes over the parser's own limit, as inflated, are refused 413, the connection kept: they are all in", async () => {
    const outcome: Outcome = await parseOnce(
      bounded(ExpressJson, { limit: "2kb" }),
      await spentRequest(
        GZIP_JSON_HEADERS,
        Buffer.from(JSON.stringify({ comment: "x".repeat(4 * KIB) })),
      ),
    );

    expect(readRequestBodyRefusal(outcome.error)).toEqual({
      type: "entity.too.large",
      status: 413,
      message: REQUEST_BODY_REFUSAL_MESSAGES.tooLarge,
    });
    expect(outcome.res.shouldKeepAlive).toBe(true);
  });

  test("bytes exactly at the parser's limit are parsed", async () => {
    const atLimit: Buffer = Buffer.from(
      JSON.stringify({ comment: "x".repeat(2 * KIB - 14) }),
    );

    expect(atLimit.length).toBe(2 * KIB);

    const outcome: Outcome = await parseOnce(
      bounded(ExpressJson, { limit: "2kb" }),
      await spentRequest(GZIP_JSON_HEADERS, atLimit),
    );

    expect(outcome.error).toBeUndefined();
  });

  test("kept JSON that does not parse is refused 400; none at all is an empty object, as body-parser reads one", async () => {
    const broken: Outcome = await parseOnce(
      json,
      await spentRequest(GZIP_JSON_HEADERS, Buffer.from('{"jsonrpc":')),
    );

    expect(readRequestBodyRefusal(broken.error)?.message).toBe(
      REQUEST_BODY_REFUSAL_MESSAGES.invalidJson,
    );

    const empty: Outcome = await parseOnce(
      json,
      await spentRequest(GZIP_JSON_HEADERS, Buffer.alloc(0)),
    );

    expect(empty.error).toBeUndefined();
    expect(empty.req.body).toEqual({});
  });

  test("kept JSON in a charset no parser reads is refused 415", async () => {
    const outcome: Outcome = await parseOnce(
      json,
      await spentRequest(
        {
          "content-type": "application/json; charset=latin1",
          "content-encoding": "gzip",
        },
        bytes,
      ),
    );

    expect(readRequestBodyRefusal(outcome.error)?.status).toBe(415);
  });

  test("a body parsed before into something else is passed over, its bytes unread", async () => {
    const req: StreamRequest = await spentRequest(GZIP_JSON_HEADERS);

    req.body = { parsed: "before" };
    req._body = true;

    const outcome: Outcome = await parseOnce(json, req);

    expect(outcome.error).toBeUndefined();
    expect(outcome.req.body).toEqual({ parsed: "before" });
  });
});

describe("a request with nothing left to read (#10643)", () => {
  test("read whole by something that kept nothing: passed on as it is, never handed to body-parser", async () => {
    /*
     * body-parser read such a stream again: "stream is not readable", a
     * 500, for identity; zlib's "unexpected end of file", a 500, for gzip.
     */
    for (const headers of [JSON_HEADERS, GZIP_JSON_HEADERS]) {
      const req: StreamRequest = await spentRequest(headers);

      const outcome: Outcome = await parseOnce(json, req);

      expect(outcome.error).toBeUndefined();
      expect(outcome.req.body).toBeUndefined();
      expect(outcome.req._body).toBeUndefined();
    }
  });

  test("its client gone before it was read: refused as cut off, 400, as one gone mid-body is", async () => {
    const req: StreamRequest = streamRequest(JSON_HEADERS);

    req.destroy();
    await settle();

    const outcome: Outcome = await parseOnce(json, req);

    expect(readRequestBodyRefusal(outcome.error)).toEqual({
      type: "request.aborted",
      status: 400,
      message: REQUEST_BODY_REFUSAL_MESSAGES.cutOff,
    });
  });
});
