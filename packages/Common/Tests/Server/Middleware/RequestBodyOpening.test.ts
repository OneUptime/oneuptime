jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import RequestBodyOpening, {
  MAX_BYTES_READ_FOR_OPENING,
  RequestBodyOpeningCheck,
  RequestBodyOpeningOptions,
} from "../../../Server/Middleware/RequestBodyOpening";
import {
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  createExpressApp,
} from "../../../Server/Utils/Express";
import {
  LARGE_REQUEST_BODY_BYTES,
  REPORT_REQUEST_BODY_LIMIT,
  RequestBodyLimit,
} from "../../../Server/Utils/RequestBodyLimit";
import readRequestBodyRefusal, {
  APP_REQUEST_BODY_LIMIT_FIELD,
  INFLATE_FAILED_TYPE,
  REQUEST_BODY_REFUSAL_MESSAGES,
  RequestBodyRefusal,
  TOO_MANY_JSON_VALUES_TYPE,
} from "../../../Server/Utils/RequestBodyRefusal";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
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
import http from "http";
import { AddressInfo } from "net";
import { PassThrough, Readable } from "stream";
import timers from "timers";
import zlib from "zlib";

/*
 * A BODY READ NO FURTHER THAN ITS OPENING UNTIL THE OPENING IS CHECKED
 * (#10260).
 *
 * An older probe names itself only at the start of its vCenter or OpenStack
 * collection, so a body with no key in its headers used to be read whole -
 * 50 MiB inflated, 8,000,000 values counted - before anyone looked at who
 * sent it. RequestBodyOpening reads such a body's first few kilobytes, has a
 * check read them with the request paused, and reads the rest only when the
 * check lets it through. Here, against a stand-in check (a body that opens
 * with {"key":"right" goes on; any other is answered 400 by the check):
 *
 *   - before the check, no more is read or inflated than the opening takes,
 *     however the body is compressed, sized, chunked or shaped;
 *   - a body the check refuses is answered by it, and not a byte more is
 *     read: the connection is closed under the rest;
 *   - a body the check lets through is read whole, held to the limit from
 *     its first byte - its size as sent and inflated, its values counted
 *     with the opening's among them;
 *   - every other refusal is body-parser's error, answered in
 *     RequestBodyRefusal's words, with the rest unread.
 */

const KIB: number = 1024;
const MIB: number = 1024 * 1024;

const OPENING_BYTES: number = 4096;

// What the stand-in check lets through: a body that opens with it.
const RIGHT_OPENING: Buffer = Buffer.from('{"key":"right"');

const SMALL_LIMIT: RequestBodyLimit = {
  bytes: MIB,
  values: 1000,
  objectsArraysAndStrings: 1000,
};

/*
 * What zlib inflated, counted where it hands its output on (push): what the
 * reader took and what the inflate holds for it alike. zlib's own functions
 * are read-only, so the count is on its streams' prototypes.
 */
const inflated: { bytes: number } = { bytes: 0 };

const readablePush: Readable["push"] = Readable.prototype.push;

const ZLIB_STREAMS: Array<{ push: Readable["push"] }> = [
  (zlib as unknown as { Gunzip: { prototype: { push: Readable["push"] } } })
    .Gunzip.prototype,
  (zlib as unknown as { Inflate: { prototype: { push: Readable["push"] } } })
    .Inflate.prototype,
];

beforeEach(() => {
  inflated.bytes = 0;

  for (const prototype of ZLIB_STREAMS) {
    jest.spyOn(prototype, "push").mockImplementation(function (
      this: Readable,
      chunk: unknown,
      encoding?: Parameters<Readable["push"]>[1],
    ): boolean {
      if (Buffer.isBuffer(chunk)) {
        inflated.bytes += chunk.length;
      }

      return readablePush.call(this, chunk, encoding);
    });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The next turn of the event loop: jsdom, Common's environment, has no setImmediate.
function nextTurn(): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    timers.setImmediate(resolve);
  });
}

// "[{},{},...]": `count` empty objects, three bytes each.
function emptyObjects(count: number): string {
  return `[${"{},".repeat(count - 1)}{}]`;
}

/*
 * A body that opens as the stand-in check wants, or with `key`, followed by
 * `points` values of about forty bytes each.
 */
function reportOf(key: string, points: number): Buffer {
  const point: string = '{"name":"cpu","value":42.5,"unit":"percent"}';

  return Buffer.from(
    `{"key":${JSON.stringify(key)},"points":[${Array.from(
      { length: points },
      (): string => {
        return point;
      },
    ).join(",")}]}`,
  );
}

// Text that compresses poorly: drawn from the shared seeded generator.
function noise(bytes: number, random: SeededRandom): Buffer {
  const alphabet: string =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const out: Buffer = Buffer.alloc(bytes);

  for (let index: number = 0; index < bytes; index++) {
    out[index] = alphabet.charCodeAt(random(alphabet.length));
  }

  return out;
}

function chunked(buffer: Buffer, size: number): Array<Buffer> {
  const out: Array<Buffer> = [];

  for (let offset: number = 0; offset < buffer.length; offset += size) {
    out.push(buffer.subarray(offset, offset + size));
  }

  return out;
}

// Concatenated empty gzip members: valid, and they inflate to nothing.
function emptyGzipMembers(approximateBytes: number): Buffer {
  const member: Buffer = zlib.gzipSync(Buffer.alloc(0));

  return Buffer.concat(
    Array.from(
      { length: Math.floor(approximateBytes / member.length) },
      (): Uint8Array => {
        return member as unknown as Uint8Array;
      },
    ),
  );
}

/*
 * ON A STREAM: the request is a stream the test writes chunks into, one
 * 'data' event each, so where the chunks are cut is the test's.
 */
describe("on a stream: what is read before the check", () => {
  interface CheckCall {
    opening: Buffer;
    isPaused: boolean;
    deliveredAtCheck: number;
  }

  interface Outcome {
    // "next": the reader handed on (error or not); "refused": the check answered.
    kind: "next" | "refused" | "timeout";
    error?: unknown;
  }

  interface StreamRead {
    req: PassThrough & { headers: Record<string, string>; body?: unknown };
    checks: Array<CheckCall>;
    // The bytes the reader was handed ('data' events), all told.
    delivered: () => number;
    outcome: Promise<Outcome>;
    feed: (chunks: Array<Buffer>, end?: boolean) => Promise<void>;
  }

  function startRead(data: {
    headers?: Record<string, string>;
    limit?: RequestBodyLimit;
    openingBytes?: number;
    // Overrides the stand-in check.
    check?: RequestBodyOpeningOptions["check"];
    body?: unknown;
  }): StreamRead {
    const req: StreamRead["req"] = new PassThrough() as StreamRead["req"];
    req.headers = {
      "content-type": "application/json",
      ...(data.headers || {}),
    };

    if (data.body !== undefined) {
      req.body = data.body;
    }

    let delivered: number = 0;
    const emit: PassThrough["emit"] = req.emit.bind(req);

    req.emit = (event: string | symbol, ...args: Array<unknown>): boolean => {
      if (event === "data" && Buffer.isBuffer(args[0])) {
        delivered += args[0].length;
      }

      return emit(event, ...args);
    };

    const checks: Array<CheckCall> = [];
    let settle: (outcome: Outcome) => void = (): void => {};

    const outcome: Promise<Outcome> = new Promise<Outcome>(
      (resolve: (outcome: Outcome) => void): void => {
        settle = resolve;
        setTimeout(() => {
          resolve({ kind: "timeout" });
        }, 20000);
      },
    );

    const check: RequestBodyOpeningOptions["check"] =
      data.check ||
      (async (call: RequestBodyOpeningCheck): Promise<boolean> => {
        checks.push({
          opening: Buffer.from(call.opening),
          isPaused: req.isPaused(),
          deliveredAtCheck: delivered,
        });

        if (
          call.opening
            .subarray(0, RIGHT_OPENING.length)
            .equals(RIGHT_OPENING as unknown as Uint8Array)
        ) {
          return true;
        }

        settle({ kind: "refused" });
        return false;
      });

    RequestBodyOpening.read(
      req as unknown as ExpressRequest,
      {} as ExpressResponse,
      ((error?: unknown): void => {
        settle({ kind: "next", error: error });
      }) as NextFunction,
      {
        openingBytes: data.openingBytes || OPENING_BYTES,
        limit: data.limit || REPORT_REQUEST_BODY_LIMIT,
        check: check,
      },
    );

    return {
      req: req,
      checks: checks,
      delivered: (): number => {
        return delivered;
      },
      outcome: outcome,
      feed: async (chunks: Array<Buffer>, end: boolean = true) => {
        for (const chunk of chunks) {
          req.write(chunk);
          // A chunk each turn, as a socket hands them on.
          await nextTurn();
        }

        if (end) {
          req.end();
        }
      },
    };
  }

  test("a gzip body: the check reads its first 4,096 bytes as they inflate, with the request paused, and a 40 MiB body is read and inflated no further than a few dozen kilobytes", async () => {
    const json: Buffer = reportOf("wrong", 900000);
    const body: Buffer = zlib.gzipSync(json);

    expect(json.length).toBeGreaterThan(38 * MIB);

    const read: StreamRead = startRead({
      headers: { "content-encoding": "gzip" },
    });

    // The body, and then more: the client keeps sending.
    read.feed(chunked(body, 64 * KIB), false);

    expect(await read.outcome).toEqual({ kind: "refused" });
    expect(read.checks).toHaveLength(1);
    expect(
      read.checks[0]!.opening.equals(json.subarray(0, OPENING_BYTES)),
    ).toBe(true);
    expect(read.checks[0]!.isPaused).toBe(true);

    /*
     * A socket read as sent; as inflated, the zlib output chunk that holds
     * the opening and the one the inflate holds past it (16 KiB each).
     */
    expect(read.delivered()).toBeLessThanOrEqual(64 * KIB);
    expect(inflated.bytes).toBeLessThanOrEqual(OPENING_BYTES + 48 * KIB);

    // Refused: nothing more is read or inflated, whatever keeps arriving.
    const deliveredAtRefusal: number = read.delivered();
    const inflatedAtRefusal: number = inflated.bytes;

    await read.feed(chunked(Buffer.alloc(256 * KIB, 7), 64 * KIB), false);
    expect(read.delivered()).toBe(deliveredAtRefusal);
    expect(inflated.bytes).toBe(inflatedAtRefusal);
  }, 60000);

  test("a body sent as it is, and one deflated: the same opening, the same bounds", async () => {
    const json: Buffer = reportOf("wrong", 200000);

    for (const sent of [
      { body: json, headers: {} },
      { body: json, headers: { "content-encoding": "identity" } },
      {
        body: zlib.deflateSync(json),
        headers: { "content-encoding": "deflate" },
      },
    ]) {
      inflated.bytes = 0;

      const read: StreamRead = startRead({ headers: sent.headers });

      read.feed(chunked(sent.body, 64 * KIB));

      expect(await read.outcome).toEqual({ kind: "refused" });
      expect(
        read.checks[0]!.opening.equals(json.subarray(0, OPENING_BYTES)),
      ).toBe(true);
      expect(read.delivered()).toBeLessThanOrEqual(64 * KIB);
      expect(inflated.bytes).toBeLessThanOrEqual(OPENING_BYTES + 48 * KIB);
    }
  }, 60000);

  test("the check reads the same opening, and a body it lets through arrives whole, wherever the chunks are cut", async () => {
    const random: SeededRandom = seededRandom(10260);
    const json: Buffer = reportOf("right", 3000);

    for (let run: number = 0; run < 24; run++) {
      const isGzip: boolean = run % 2 === 0;
      const sent: Buffer = isGzip ? zlib.gzipSync(json) : json;

      // Chunks from one byte to 9 KiB, cut where the stream draws.
      const chunks: Array<Buffer> = [];

      for (let offset: number = 0; offset < sent.length; ) {
        const size: number = 1 + random(9 * KIB);
        chunks.push(sent.subarray(offset, offset + size));
        offset += size;
      }

      const read: StreamRead = startRead({
        headers: isGzip ? { "content-encoding": "gzip" } : {},
      });

      read.feed(chunks);

      expect({ run, outcome: await read.outcome }).toEqual({
        run,
        outcome: { kind: "next", error: undefined },
      });
      expect(read.checks).toHaveLength(1);
      expect(
        read.checks[0]!.opening.equals(json.subarray(0, OPENING_BYTES)),
      ).toBe(true);
      expect(Buffer.isBuffer(read.req.body)).toBe(true);
      expect((read.req.body as Buffer).equals(json)).toBe(true);
    }
  }, 60000);

  test("a body shorter than an opening is the opening: the check reads all of it", async () => {
    const json: Buffer = Buffer.from('{"key":"right","status":"Failed"}');

    for (const isGzip of [true, false]) {
      const read: StreamRead = startRead({
        headers: isGzip ? { "content-encoding": "gzip" } : {},
      });

      read.feed([isGzip ? zlib.gzipSync(json) : json]);

      expect(await read.outcome).toEqual({ kind: "next", error: undefined });
      expect(read.checks[0]!.opening.equals(json)).toBe(true);
      expect((read.req.body as Buffer).equals(json)).toBe(true);
    }
  });

  test("an empty body, gzip announced or not, has an empty opening, and is no 'unexpected end of file'", async () => {
    for (const headers of [{ "content-encoding": "gzip" }, {}]) {
      const read: StreamRead = startRead({ headers: headers });

      read.feed([]);

      expect(await read.outcome).toEqual({ kind: "refused" });
      expect(read.checks[0]!.opening.length).toBe(0);
    }
  });

  test("a gzip body made to inflate to nothing is checked after a socket read's worth, with the nothing it inflated to", async () => {
    const padding: Buffer = emptyGzipMembers(8 * MIB);

    const read: StreamRead = startRead({
      headers: { "content-encoding": "gzip" },
    });

    read.feed(chunked(padding, 16 * KIB));

    expect(await read.outcome).toEqual({ kind: "refused" });
    expect(read.checks[0]!.opening.length).toBe(0);
    expect(read.delivered()).toBeGreaterThanOrEqual(MAX_BYTES_READ_FOR_OPENING);
    expect(read.delivered()).toBeLessThanOrEqual(
      MAX_BYTES_READ_FOR_OPENING + 16 * KIB,
    );
    expect(inflated.bytes).toBe(0);
  }, 60000);

  test("a body nested a million deep, or a bomb of empty objects, costs no more than any other before it is refused", async () => {
    for (const json of [
      Buffer.alloc(10 * MIB, "["),
      Buffer.from(emptyObjects(3000000)),
      Buffer.alloc(10 * MIB, " "),
      Buffer.concat([Buffer.from('"'), Buffer.alloc(10 * MIB, "a")]),
    ]) {
      inflated.bytes = 0;

      const read: StreamRead = startRead({
        headers: { "content-encoding": "gzip" },
      });

      read.feed([zlib.gzipSync(json)]);

      expect(await read.outcome).toEqual({ kind: "refused" });
      expect(
        read.checks[0]!.opening.equals(json.subarray(0, OPENING_BYTES)),
      ).toBe(true);
      expect(inflated.bytes).toBeLessThanOrEqual(OPENING_BYTES + 48 * KIB);
    }
  }, 60000);

  test("an opening split over a thousand one-byte chunks is read as one, and the check runs once", async () => {
    const json: Buffer = reportOf("right", 200);

    const read: StreamRead = startRead({});

    read.feed(chunked(json.subarray(0, 1000), 1).concat([json.subarray(1000)]));

    expect(await read.outcome).toEqual({ kind: "next", error: undefined });
    expect(read.checks).toHaveLength(1);
    expect((read.req.body as Buffer).equals(json)).toBe(true);
  });

  test("the request stays paused while the check runs: nothing is read until it answers", async () => {
    const json: Buffer = reportOf("right", 20000);
    const body: Buffer = zlib.gzipSync(json);
    let release: (isAccepted: boolean) => void = (): void => {};
    let deliveredAtCheck: number = -1;

    const read: StreamRead = startRead({
      headers: { "content-encoding": "gzip" },
      check: (): Promise<boolean> => {
        deliveredAtCheck = read.delivered();

        return new Promise<boolean>(
          (resolve: (isAccepted: boolean) => void) => {
            release = resolve;
          },
        );
      },
    });

    read.feed(chunked(body, 4 * KIB));

    // Long enough for every chunk to be written.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 300);
    });

    expect(deliveredAtCheck).toBeGreaterThan(0);
    expect(read.delivered()).toBe(deliveredAtCheck);
    expect(read.req.isPaused()).toBe(true);

    release(true);

    expect(await read.outcome).toEqual({ kind: "next", error: undefined });
    expect((read.req.body as Buffer).equals(json)).toBe(true);
  });
});

describe("on a stream: the rest, once the check lets the body through", () => {
  function run(data: {
    headers?: Record<string, string>;
    limit: RequestBodyLimit;
    body: Buffer;
    chunkBytes?: number;
  }): Promise<{ error: unknown; body: unknown }> {
    const req: PassThrough & {
      headers: Record<string, string>;
      body?: unknown;
    } = new PassThrough() as PassThrough & {
      headers: Record<string, string>;
      body?: unknown;
    };

    req.headers = {
      "content-type": "application/json",
      ...(data.headers || {}),
    };

    return new Promise<{ error: unknown; body: unknown }>(
      (resolve: (value: { error: unknown; body: unknown }) => void) => {
        RequestBodyOpening.read(
          req as unknown as ExpressRequest,
          {} as ExpressResponse,
          ((error?: unknown): void => {
            resolve({ error: error, body: req.body });
          }) as NextFunction,
          {
            openingBytes: OPENING_BYTES,
            limit: data.limit,
            check: async (): Promise<boolean> => {
              return true;
            },
          },
        );

        (async (): Promise<void> => {
          for (const chunk of chunked(data.body, data.chunkBytes || 64 * KIB)) {
            req.write(chunk);
            await nextTurn();
          }

          req.end();
        })();
      },
    );
  }

  test("its values are counted from its first byte: the opening's are among them", async () => {
    /*
     * Five values start in the opening - the object, "key", "right", "pad"
     * and the long string it runs into - and 2 + N past it: "rest", the
     * array and N objects. With N = 994 the part past the opening holds 996
     * values, under the limit's 1,000; the body holds 1,001.
     */
    const opening: string = `{"key":"right","pad":"${"x".repeat(OPENING_BYTES)}"`;

    const refused: { error: unknown } = await run({
      limit: SMALL_LIMIT,
      body: Buffer.from(`${opening},"rest":${emptyObjects(994)}}`),
    });

    expect((refused.error as { type?: string }).type).toBe(
      TOO_MANY_JSON_VALUES_TYPE,
    );
    expect((refused.error as { status?: number }).status).toBe(413);

    // One value fewer, 1,000 all told, and it is read.
    const accepted: { error: unknown; body: unknown } = await run({
      limit: SMALL_LIMIT,
      body: Buffer.from(`${opening},"rest":${emptyObjects(993)}}`),
    });

    expect(accepted.error).toBeUndefined();
    expect(Buffer.isBuffer(accepted.body)).toBe(true);
  });

  test("past its limit's values as it inflates, it is refused before the rest is inflated", async () => {
    const json: Buffer = Buffer.from(
      `{"key":"right","rest":${emptyObjects(2000000)}}`,
    );

    const refused: { error: unknown } = await run({
      headers: { "content-encoding": "gzip" },
      limit: SMALL_LIMIT,
      body: zlib.gzipSync(json),
    });

    expect((refused.error as { type?: string }).type).toBe(
      TOO_MANY_JSON_VALUES_TYPE,
    );
    expect(inflated.bytes).toBeLessThan(json.length / 10);
  }, 60000);

  test("a body that is not JSON by its type is not counted, as GzipRequestBody counts none", async () => {
    const result: { error: unknown; body: unknown } = await run({
      headers: { "content-type": "application/octet-stream" },
      limit: SMALL_LIMIT,
      body: Buffer.from(`{"key":"right","rest":${emptyObjects(5000)}}`),
    });

    expect(result.error).toBeUndefined();
  });

  test("past its limit's bytes, as sent or inflated, it is refused as body-parser refuses one, marked as the App's limit", async () => {
    for (const sent of [
      { headers: {}, body: reportOf("right", 30000) },
      {
        headers: { "content-encoding": "gzip" },
        body: zlib.gzipSync(reportOf("right", 30000)),
      },
    ]) {
      const refused: { error: unknown } = await run({
        headers: sent.headers,
        limit: {
          ...SMALL_LIMIT,
          values: 10000000,
          objectsArraysAndStrings: 10000000,
        },
        body: sent.body,
      });

      expect(refused.error).toMatchObject({
        type: "entity.too.large",
        status: 413,
        expose: true,
        limit: MIB,
        [APP_REQUEST_BODY_LIMIT_FIELD]: MIB,
      });
    }
  }, 60000);

  /*
   * As the gzip reader every other route reads such a body with refuses it
   * (#10597): the same bytes are answered the same way, key headers or not.
   */
  test("a gzip or deflate body that does not inflate is refused 400 as one, as the gzip reader refuses it", async () => {
    const whole: Buffer = zlib.gzipSync(reportOf("right", 3000));

    for (const [encoding, body] of [
      [
        "gzip",
        Buffer.concat([
          whole.subarray(0, 400),
          Buffer.from("this is not deflate"),
        ]),
      ],
      ["gzip", Buffer.from("this is not gzip at all")],
      ["deflate", Buffer.from("this is not deflate at all")],
    ] as Array<[string, Buffer]>) {
      const refused: { error: unknown } = await run({
        headers: { "content-encoding": encoding },
        limit: REPORT_REQUEST_BODY_LIMIT,
        body: body,
      });

      expect(refused.error).toMatchObject({
        type: INFLATE_FAILED_TYPE,
        status: 400,
        expose: true,
      });
      expect(readRequestBodyRefusal(refused.error)?.message).toBe(
        REQUEST_BODY_REFUSAL_MESSAGES.notInflated,
      );
    }
  });
});

describe("on a stream: a body already read", () => {
  test("has its bytes' opening checked, and goes on only when the check lets it", async () => {
    for (const [body, isAccepted] of [
      [reportOf("right", 10), true],
      [reportOf("wrong", 10), false],
    ] as Array<[Buffer, boolean]>) {
      const openings: Array<Buffer> = [];
      const next: ReturnType<typeof jest.fn> = jest.fn();

      await new Promise<void>((resolve: () => void) => {
        RequestBodyOpening.read(
          { headers: {}, body: body } as unknown as ExpressRequest,
          {} as ExpressResponse,
          next as unknown as NextFunction,
          {
            openingBytes: 64,
            limit: REPORT_REQUEST_BODY_LIMIT,
            check: async (call: RequestBodyOpeningCheck): Promise<boolean> => {
              openings.push(Buffer.from(call.opening));
              timers.setImmediate(resolve);
              return isAccepted;
            },
          },
        );
      });

      expect(openings).toEqual([body.subarray(0, 64)]);
      expect(next.mock.calls).toEqual(isAccepted ? [[]] : []);
    }
  });

  test("parsed already, it goes on as it is, for the route to read its caller from", () => {
    const next: ReturnType<typeof jest.fn> = jest.fn();
    const check: ReturnType<typeof jest.fn> = jest.fn();

    RequestBodyOpening.read(
      { headers: {}, body: {}, _body: true } as unknown as ExpressRequest,
      {} as ExpressResponse,
      next as unknown as NextFunction,
      {
        openingBytes: OPENING_BYTES,
        limit: REPORT_REQUEST_BODY_LIMIT,
        check: check as unknown as RequestBodyOpeningOptions["check"],
      },
    );

    expect(next).toHaveBeenCalledWith();
    expect(check).not.toHaveBeenCalled();
  });
});

/*
 * OVER HTTP: the reader mounted as a route mounts it, behind a stand-in
 * check, with an error handler that answers as expressErrorHandler does
 * (RequestBodyRefusal).
 */
describe("over HTTP", () => {
  interface Answer {
    status: number;
    connection: string | undefined;
    body: Record<string, unknown>;
  }

  let server: http.Server;
  let port: number;

  // What the server read off each request's socket by the time it answered.
  const bytesReadByRequest: Map<string, number> = new Map();
  const reached: Array<number> = [];
  let checks: number = 0;
  let checkGate: Promise<void> | null = null;

  const standInCheck: RequestBodyOpeningOptions["check"] = async (
    call: RequestBodyOpeningCheck,
  ): Promise<boolean> => {
    checks++;

    if (checkGate) {
      await checkGate;
    }

    if (
      call.opening
        .subarray(0, RIGHT_OPENING.length)
        .equals(RIGHT_OPENING as unknown as Uint8Array)
    ) {
      return true;
    }

    call.res.status(400).json({ refused: "opening" });
    return false;
  };

  beforeAll(async () => {
    const app: ExpressApplication = createExpressApp();

    app.use((req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
      const tag: string = String(req.headers["x-test"] || "");

      res.on("finish", () => {
        bytesReadByRequest.set(tag, req.socket.bytesRead);
      });

      next();
    });

    app.post(
      "/opening",
      RequestBodyOpening.readBytes({
        openingBytes: OPENING_BYTES,
        limit: REPORT_REQUEST_BODY_LIMIT,
        check: standInCheck,
      }),
      (req: ExpressRequest, res: ExpressResponse) => {
        const body: Buffer = req.body as Buffer;
        reached.push(body.length);
        res.json({ bytes: body.length, isBuffer: Buffer.isBuffer(body) });
      },
    );

    app.post(
      "/parsed-before",
      ExpressJson(),
      RequestBodyOpening.readBytes({
        openingBytes: OPENING_BYTES,
        limit: REPORT_REQUEST_BODY_LIMIT,
        check: standInCheck,
      }),
      (req: ExpressRequest, res: ExpressResponse) => {
        res.json({ keys: Object.keys(req.body as Record<string, unknown>) });
      },
    );

    // As expressErrorHandler answers a refused body.
    app.use(
      (
        err: Record<string, unknown>,
        _req: ExpressRequest,
        res: ExpressResponse,
        _next: NextFunction,
      ): void => {
        const refusal: RequestBodyRefusal | null = readRequestBodyRefusal(err);

        res.status(refusal ? refusal.status : 500).json({
          type: err["type"],
          error: refusal ? refusal.message : String(err["message"]),
        });
      },
    );

    server = http.createServer(app);

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  beforeEach(() => {
    reached.length = 0;
    checks = 0;
    checkGate = null;
  });

  /*
   * Each request on a connection of its own, which asks to be kept alive:
   * what the server read off it is this request's alone, and whether the
   * server closes it is the server's choice.
   */
  function post(data: {
    tag: string;
    path?: string;
    body: Buffer;
    headers?: Record<string, string>;
  }): Promise<Answer> {
    const agent: http.Agent = new http.Agent({ keepAlive: true });

    return new Promise<Answer>(
      (resolve: (answer: Answer) => void, reject: (err: Error) => void) => {
        const request: http.ClientRequest = http.request(
          {
            host: "127.0.0.1",
            port: port,
            path: data.path || "/opening",
            method: "POST",
            agent: agent,
            headers: {
              "content-type": "application/json",
              ...(data.headers || {}),
              "content-length": String(data.body.length),
              "x-test": data.tag,
            },
          },
          (response: http.IncomingMessage) => {
            const chunks: Array<Buffer> = [];

            response.on("data", (chunk: Buffer) => {
              chunks.push(chunk);
            });
            response.on("end", () => {
              const text: string = Buffer.concat(chunks).toString("utf8");

              agent.destroy();
              resolve({
                status: response.statusCode || 0,
                connection: response.headers["connection"],
                body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
              });
            });
          },
        );

        // A server that answered before reading the body closes under it.
        request.on("error", (err: NodeJS.ErrnoException) => {
          if (err.code !== "EPIPE" && err.code !== "ECONNRESET") {
            agent.destroy();
            reject(err);
          }
        });
        request.end(data.body);
      },
    );
  }

  test("a refused opening is answered by the check, the connection is closed, and of 40 MiB sent the server read a socket read or two", async () => {
    const body: Buffer = reportOf("wrong", 1000000);

    expect(body.length).toBeGreaterThan(40 * MIB);

    const answer: Answer = await post({ tag: "refused", body: body });

    expect(answer).toEqual({
      status: 400,
      connection: "close",
      body: { refused: "opening" },
    });
    expect(checks).toBe(1);
    expect(reached).toEqual([]);
    expect(bytesReadByRequest.get("refused")).toBeLessThanOrEqual(512 * KIB);
  }, 60000);

  test("the same for a gzip body that compresses poorly: 8 MiB sent, a fraction read", async () => {
    const random: SeededRandom = seededRandom(4242);
    const body: Buffer = zlib.gzipSync(
      Buffer.concat([
        Buffer.from('{"key":"wrong","noise":"'),
        noise(8 * MIB, random),
        Buffer.from('"}'),
      ]),
    );

    expect(body.length).toBeGreaterThan(5 * MIB);

    const answer: Answer = await post({
      tag: "refused-gzip",
      body: body,
      headers: { "content-encoding": "gzip" },
    });

    expect(answer.status).toBe(400);
    expect(answer.connection).toBe("close");
    expect(bytesReadByRequest.get("refused-gzip")).toBeLessThanOrEqual(
      512 * KIB,
    );
  }, 60000);

  test("a body the check lets through is read whole, and the connection kept", async () => {
    const json: Buffer = reportOf("right", 600000);

    for (const sent of [
      { headers: {}, body: json },
      { headers: { "content-encoding": "gzip" }, body: zlib.gzipSync(json) },
      {
        headers: { "content-encoding": "deflate" },
        body: zlib.deflateSync(json),
      },
    ]) {
      const answer: Answer = await post({
        tag: "accepted",
        body: sent.body,
        headers: sent.headers,
      });

      expect(answer.status).toBe(200);
      expect(answer.body).toEqual({ bytes: json.length, isBuffer: true });
      expect(answer.connection).toBe("keep-alive");
    }

    expect(checks).toBe(3);
  }, 60000);

  test("a Content-Length over the limit is refused before a byte is read, and the check never runs", async () => {
    const answer: Answer = await new Promise<Answer>(
      (resolve: (answer: Answer) => void, reject: (err: Error) => void) => {
        const request: http.ClientRequest = http.request(
          {
            host: "127.0.0.1",
            port: port,
            path: "/opening",
            method: "POST",
            agent: false,
            headers: {
              "content-type": "application/json",
              "content-length": String(LARGE_REQUEST_BODY_BYTES + 1),
            },
          },
          (response: http.IncomingMessage) => {
            const chunks: Array<Buffer> = [];
            response.on("data", (chunk: Buffer) => {
              chunks.push(chunk);
            });
            response.on("end", () => {
              resolve({
                status: response.statusCode || 0,
                connection: response.headers["connection"],
                body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
              });
            });
          },
        );

        request.on("error", (err: NodeJS.ErrnoException) => {
          if (err.code !== "EPIPE" && err.code !== "ECONNRESET") {
            reject(err);
          }
        });
        // Only a little is sent of the 50 MiB declared.
        request.write(Buffer.from(RIGHT_OPENING));
      },
    );

    expect(answer).toEqual({
      status: 413,
      connection: "close",
      body: {
        type: "entity.too.large",
        error: REQUEST_BODY_REFUSAL_MESSAGES.tooLargeForOneUptime,
      },
    });
    expect(checks).toBe(0);
  });

  test("a Content-Encoding no parser reads is refused with 415, as body-parser refuses it, and the check never runs", async () => {
    const answer: Answer = await post({
      tag: "brotli",
      body: zlib.brotliCompressSync(reportOf("right", 100)),
      headers: { "content-encoding": "br" },
    });

    expect(answer).toEqual({
      status: 415,
      connection: "close",
      body: {
        type: "encoding.unsupported",
        error: REQUEST_BODY_REFUSAL_MESSAGES.encodingUnsupported,
      },
    });
    expect(checks).toBe(0);
  });

  test("a body over its limit once let through is answered with the App's 50 MB sentence", async () => {
    const answer: Answer = await post({
      tag: "too-large",
      body: zlib.gzipSync(
        Buffer.concat([
          Buffer.from('{"key":"right","pad":"'),
          Buffer.alloc(LARGE_REQUEST_BODY_BYTES, "x"),
          Buffer.from('"}'),
        ]),
      ),
      headers: { "content-encoding": "gzip" },
    });

    expect(answer).toEqual({
      status: 413,
      connection: "close",
      body: {
        type: "entity.too.large",
        error: REQUEST_BODY_REFUSAL_MESSAGES.tooLargeForOneUptime,
      },
    });
  }, 60000);

  test("a client that hangs up while the check runs is neither answered nor read on", async () => {
    let releaseCheck: () => void = (): void => {};
    checkGate = new Promise<void>((resolve: () => void) => {
      releaseCheck = resolve;
    });

    const closed: Promise<void> = new Promise<void>(
      (resolve: () => void, reject: (err: Error) => void) => {
        const request: http.ClientRequest = http.request({
          host: "127.0.0.1",
          port: port,
          path: "/opening",
          method: "POST",
          agent: false,
          headers: {
            "content-type": "application/json",
            "content-length": String(10 * MIB),
          },
        });

        request.on("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "ECONNRESET" || err.code === "EPIPE") {
            resolve();
            return;
          }

          reject(err);
        });
        request.on("close", () => {
          resolve();
        });

        request.write(reportOf("right", 2000));

        // Once the check has started, the client goes away.
        const waitForCheck: () => void = (): void => {
          if (checks > 0) {
            request.destroy();
            return;
          }

          setTimeout(waitForCheck, 10);
        };

        waitForCheck();
      },
    );

    await closed;
    releaseCheck();

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 200);
    });

    expect(checks).toBe(1);
    expect(reached).toEqual([]);
  });

  test("a body something parsed before goes on as it is", async () => {
    const answer: Answer = await post({
      tag: "parsed",
      path: "/parsed-before",
      body: Buffer.from('{"probeKey":"k","probeId":"i"}'),
    });

    expect(answer).toEqual({
      status: 200,
      connection: "keep-alive",
      body: { keys: ["probeKey", "probeId"] },
    });
    expect(checks).toBe(0);
  });
});
