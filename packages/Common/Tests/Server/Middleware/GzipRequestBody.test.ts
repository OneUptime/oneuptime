import { describe, expect, jest, test } from "@jest/globals";

/*
 * The global `Content-Encoding: gzip` request reader (GHSA-cp58-wc9q-qv53).
 *
 * This middleware runs in StartServer BEFORE routing, so it sees every
 * request to every service on every path, authenticated or not. It used to
 * accumulate the whole compressed body in an unbounded array and hand it to
 * an unbounded `zlib.gunzip` - a decompression bomb requiring no work at all
 * from the attacker: the fixture below turns ~51 KB of anonymous request
 * into 50 MiB of resident Buffer, and the trick scales linearly.
 *
 * There are two ceilings, and most of the tests here exist to show that
 * neither one subsumes the other:
 *
 *   - Drop the DECOMPRESSED cap and 51 KB buys 50 MiB.
 *   - Drop the COMPRESSED cap and 51 MiB of concatenated EMPTY gzip members -
 *     which inflate to exactly zero bytes, so the decompressed cap can never
 *     fire - streams straight into the process.
 */

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

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
    },
  };
});

import GzipRequestBodyMiddleware, {
  MAX_COMPRESSED_REQUEST_BODY_BYTES,
  MAX_DECOMPRESSED_REQUEST_BODY_BYTES,
} from "../../../Server/Middleware/GzipRequestBody";
import Response from "../../../Server/Utils/Response";
import logger from "../../../Server/Utils/Logger";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import zlib from "zlib";

/*
 * The caps under test are 50 MiB, so the fixtures that probe them are 50 MiB
 * of real gzip and real inflation. That does not fit in jest's 5s default.
 */
jest.setTimeout(300_000);

type JestMock = {
  mock: { calls: Array<Array<unknown>> };
  mockClear: () => void;
};

const sendErrorResponseMock: JestMock =
  Response.sendErrorResponse as unknown as JestMock;

function loggerMock(level: "debug" | "warn" | "error"): JestMock {
  return logger[level] as unknown as JestMock;
}

/*
 * Response.sendErrorResponse is a module mock, so the drivers below cannot
 * each attach to it. One shared implementation fans out to whichever driver
 * is currently waiting.
 */
const errorResponseListeners: Set<() => void> = new Set();

(
  Response.sendErrorResponse as unknown as {
    mockImplementation: (fn: () => void) => void;
  }
).mockImplementation((): void => {
  for (const listener of Array.from(errorResponseListeners)) {
    listener();
  }
});

/*
 * A request that models the one property this middleware depends on: a
 * paused socket stops delivering. The driver waits while `paused` is set, so
 * backpressure is exercised rather than ignored.
 */
interface FakeRequest extends EventEmitter {
  body?: unknown;
  headers: Record<string, string>;
  destroy: () => void;
  pause: () => void;
  resume: () => void;
  destroyed: boolean;
  paused: boolean;
}

interface FakeResponse {
  statusCode: number;
  headersSent: boolean;
  jsonBody: unknown;
  status: (code: number) => FakeResponse;
  json: (body: unknown) => FakeResponse;
}

function buildResponse(onJson?: () => void): FakeResponse {
  const res: FakeResponse = {
    statusCode: 0,
    headersSent: false,
    jsonBody: undefined,
    status: (code: number): FakeResponse => {
      res.statusCode = code;
      return res;
    },
    json: (body: unknown): FakeResponse => {
      res.jsonBody = body;
      res.headersSent = true;

      if (onJson) {
        onJson();
      }

      return res;
    },
  };

  return res;
}

/* Let anything that WOULD have happened, happen, before asserting it did not. */
function quietPeriod(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 100);
  });
}

/*
 * Deliberately event-driven rather than a poll loop. The inflate runs on the
 * threadpool, and under jsdom a `setTimeout(0)` poll competes with its
 * callbacks for the event loop - polling turned a 50 MiB inflate into half a
 * minute. The 250 ms timer is only a safety net for a wake-up that never
 * arrives.
 */
class Driver {
  public req: FakeRequest;
  public res: FakeResponse;
  public nextCalls: Array<unknown> = [];
  public fedBytes: number = 0;

  private waiters: Array<() => void> = [];
  private errorResponsesAtStart: number;

  private wake: () => void = (): void => {
    for (const waiter of this.waiters.splice(0)) {
      waiter();
    }
  };

  public constructor(headers?: Record<string, string>) {
    const req: FakeRequest = new EventEmitter() as FakeRequest;

    req.headers = headers || {};
    req.destroyed = false;
    req.paused = false;
    req.destroy = (): void => {
      req.destroyed = true;
    };
    req.pause = (): void => {
      req.paused = true;
    };
    req.resume = (): void => {
      req.paused = false;
      this.wake();
    };

    this.req = req;
    this.res = buildResponse(this.wake);
    this.errorResponsesAtStart = sendErrorResponseMock.mock.calls.length;

    errorResponseListeners.add(this.wake);

    GzipRequestBodyMiddleware.parseBody(
      this.req as unknown as ExpressRequest,
      this.res as unknown as ExpressResponse,
      ((err?: unknown): void => {
        this.nextCalls.push(err);
        this.wake();
      }) as NextFunction,
    );
  }

  public isSettled(): boolean {
    return (
      this.nextCalls.length > 0 ||
      this.res.statusCode !== 0 ||
      sendErrorResponseMock.mock.calls.length > this.errorResponsesAtStart
    );
  }

  public errorResponse(): Exception | undefined {
    const calls: Array<Array<unknown>> = sendErrorResponseMock.mock.calls.slice(
      this.errorResponsesAtStart,
    );

    return calls.length > 0 ? (calls[0]![2] as Exception) : undefined;
  }

  public async waitForOutcome(timeoutMs: number = 120000): Promise<boolean> {
    const startedAt: number = Date.now();

    while (!this.isSettled()) {
      if (Date.now() - startedAt > timeoutMs) {
        return false;
      }

      await this.waitForWake();
    }

    errorResponseListeners.delete(this.wake);

    return true;
  }

  /* Feed chunks the way a socket would: stop while paused, stop once answered. */
  public async feed(chunks: Array<Buffer>): Promise<void> {
    for (const chunk of chunks) {
      while (this.req.paused && !this.isSettled()) {
        await this.waitForWake();
      }

      if (this.isSettled()) {
        return;
      }

      this.req.emit("data", chunk);
      this.fedBytes += chunk.length;
    }
  }

  public end(): void {
    this.req.emit("end");
  }

  private waitForWake(): Promise<void> {
    return new Promise<void>((resolve: () => void): void => {
      this.waiters.push(resolve);
      setTimeout(resolve, 250);
    });
  }
}

function gzip(buffer: Buffer): Buffer {
  return zlib.gzipSync(buffer as unknown as Uint8Array);
}

function chunked(buffer: Buffer, size: number): Array<Buffer> {
  const out: Array<Buffer> = [];

  for (let offset: number = 0; offset < buffer.length; offset += size) {
    out.push(buffer.subarray(offset, offset + size));
  }

  return out;
}

/*
 * A block of concatenated EMPTY gzip members. Each member is 20 valid bytes
 * that inflate to nothing, so a stream of these is arbitrarily large on the
 * wire and exactly zero bytes of output - the shape that makes a
 * decompressed-only cap useless.
 */
function emptyMemberBlock(approximateBytes: number): Buffer {
  const member: Buffer = gzip(Buffer.alloc(0));
  const count: number = Math.floor(approximateBytes / member.length);

  return Buffer.concat(
    Array.from({ length: count }, (): Uint8Array => {
      return member as unknown as Uint8Array;
    }),
  );
}

/* Built once - the 50 MiB fixtures are the slow part of this suite. */
const oneMiBOfEmptyMembers: Buffer = emptyMemberBlock(1024 * 1024);

describe("GzipRequestBodyMiddleware - the happy path still works", () => {
  test("inflates a gzip body and hands it on as a Buffer", async () => {
    const payload: Buffer = Buffer.from(
      JSON.stringify({ hello: "world", n: 42 }),
    );

    const driver: Driver = new Driver();

    await driver.feed([gzip(payload)]);
    driver.end();

    expect(await driver.waitForOutcome()).toBe(true);

    expect(driver.nextCalls).toEqual([undefined]);
    expect(Buffer.isBuffer(driver.req.body)).toBe(true);
    expect((driver.req.body as Buffer).toString()).toBe(payload.toString());
    expect(driver.res.statusCode).toBe(0);
  });

  test("reassembles a body split across many socket-sized chunks", async () => {
    const payload: Buffer = Buffer.from("x".repeat(300_000));

    const driver: Driver = new Driver();

    await driver.feed(chunked(gzip(payload), 512));
    driver.end();

    expect(await driver.waitForOutcome()).toBe(true);

    expect(driver.nextCalls).toHaveLength(1);
    expect((driver.req.body as Buffer).length).toBe(payload.length);
    expect((driver.req.body as Buffer).equals(payload as never)).toBe(true);
  });

  test("a body exactly ON the decompressed limit is accepted", async () => {
    const payload: Buffer = Buffer.alloc(MAX_DECOMPRESSED_REQUEST_BODY_BYTES);

    const driver: Driver = new Driver();

    await driver.feed(chunked(gzip(payload), 16 * 1024));
    driver.end();

    expect(await driver.waitForOutcome()).toBe(true);

    expect(driver.res.statusCode).toBe(0);
    expect(driver.nextCalls).toHaveLength(1);
    expect((driver.req.body as Buffer).length).toBe(
      MAX_DECOMPRESSED_REQUEST_BODY_BYTES,
    );
  });

  test("a declared Content-Length under the cap is not treated as a rejection", async () => {
    const compressed: Buffer = gzip(Buffer.from("small"));

    const driver: Driver = new Driver({
      "content-length": String(compressed.length),
    });

    await driver.feed([compressed]);
    driver.end();

    expect(await driver.waitForOutcome()).toBe(true);

    expect(driver.res.statusCode).toBe(0);
    expect(driver.nextCalls).toHaveLength(1);
  });

  test("a garbage Content-Length is ignored rather than trusted", async () => {
    const driver: Driver = new Driver({ "content-length": "not-a-number" });

    await driver.feed([gzip(Buffer.from("ok"))]);
    driver.end();

    expect(await driver.waitForOutcome()).toBe(true);

    expect(driver.res.statusCode).toBe(0);
    expect(driver.nextCalls).toHaveLength(1);
  });
});

describe("GzipRequestBodyMiddleware - decompression bombs (GHSA-cp58-wc9q-qv53)", () => {
  test("one byte over the decompressed cap is a 413, and next() never runs", async () => {
    const payload: Buffer = Buffer.alloc(
      MAX_DECOMPRESSED_REQUEST_BODY_BYTES + 1,
    );
    const compressed: Buffer = gzip(payload);

    /* The amplification the advisory is about, measured on the fixture. */
    expect(compressed.length).toBeLessThan(payload.length / 500);

    const driver: Driver = new Driver();

    await driver.feed(chunked(compressed, 16 * 1024));
    driver.end();

    expect(await driver.waitForOutcome()).toBe(true);

    expect(driver.res.statusCode).toBe(413);
    expect(driver.nextCalls).toHaveLength(0);
    expect(driver.req.body).toBeUndefined();
    expect(
      String((driver.res.jsonBody as { message: string }).message),
    ).toContain("decompressed");
  });

  test("the bomb is refused mid-stream, not after the last byte arrives", async () => {
    /*
     * 64 MiB of output hidden in ~65 KB, followed by 4 MiB of padding that
     * inflates to nothing. The 50 MiB ceiling is therefore crossed inside
     * the first fraction of the request, and everything after it should
     * never be read. The old code read all of it and then allocated the
     * whole 64 MiB.
     */
    const bomb: Buffer = gzip(Buffer.alloc(64 * 1024 * 1024));
    const padding: Buffer = Buffer.concat(
      Array.from({ length: 4 }, (): Uint8Array => {
        return oneMiBOfEmptyMembers as unknown as Uint8Array;
      }),
    );
    const compressed: Buffer = Buffer.concat([
      bomb as unknown as Uint8Array,
      padding as unknown as Uint8Array,
    ]);

    expect(compressed.length).toBeGreaterThan(4 * 1024 * 1024);

    const driver: Driver = new Driver();

    await driver.feed(chunked(compressed, 16 * 1024));

    expect(await driver.waitForOutcome()).toBe(true);

    expect(driver.res.statusCode).toBe(413);
    expect(driver.nextCalls).toHaveLength(0);

    /*
     * How much INPUT we had to accept before answering is the number that
     * decides whether this is still a denial of service. 512 KiB of a 4 MiB
     * request is a generous bound; the observed figure is far under it.
     */
    expect(driver.fedBytes).toBeLessThan(512 * 1024);

    /* It stopped reading rather than draining, and left the socket alone. */
    expect(driver.req.paused).toBe(true);
    expect(driver.req.destroyed).toBe(false);
  });

  test("51 MiB of EMPTY gzip members is refused even though it inflates to nothing", async () => {
    /*
     * Zero output, so the decompressed cap can never fire. Without the
     * compressed cap this request is unbounded.
     */
    const driver: Driver = new Driver();

    await driver.feed(
      Array.from({ length: 52 }, (): Buffer => {
        return oneMiBOfEmptyMembers;
      }),
    );

    expect(await driver.waitForOutcome()).toBe(true);

    expect(driver.res.statusCode).toBe(413);
    expect(driver.nextCalls).toHaveLength(0);
    expect(
      String((driver.res.jsonBody as { message: string }).message),
    ).toContain("compressed");
    expect(driver.req.paused).toBe(true);
  });

  test("an over-cap Content-Length is refused before a single byte is read", async () => {
    const driver: Driver = new Driver({
      "content-length": String(MAX_COMPRESSED_REQUEST_BODY_BYTES + 1),
    });

    expect(driver.res.statusCode).toBe(413);
    expect(driver.nextCalls).toHaveLength(0);

    /*
     * No listeners were attached at all, so the body is never consumed -
     * the cheapest possible refusal.
     */
    expect(driver.req.listenerCount("data")).toBe(0);
    expect(driver.req.listenerCount("end")).toBe(0);
  });

  test("both caps are pinned to the identity path's 50 MiB body-parser limit", () => {
    expect(MAX_COMPRESSED_REQUEST_BODY_BYTES).toBe(50 * 1024 * 1024);
    expect(MAX_DECOMPRESSED_REQUEST_BODY_BYTES).toBe(50 * 1024 * 1024);
  });
});

describe("GzipRequestBodyMiddleware - one outcome per request", () => {
  test("data arriving after a 413 does not produce a second response", async () => {
    const driver: Driver = new Driver();

    await driver.feed(
      Array.from({ length: 52 }, (): Buffer => {
        return oneMiBOfEmptyMembers;
      }),
    );

    expect(await driver.waitForOutcome()).toBe(true);
    expect(driver.res.statusCode).toBe(413);

    const firstBody: unknown = driver.res.jsonBody;

    /* Keep shouting at a middleware that has already answered. */
    driver.res.statusCode = 0;
    driver.req.emit("data", oneMiBOfEmptyMembers);
    driver.req.emit("end");
    driver.req.emit("close");

    await quietPeriod();

    expect(driver.res.statusCode).toBe(0);
    expect(driver.res.jsonBody).toBe(firstBody);
    expect(driver.nextCalls).toHaveLength(0);
  });

  test("a response that already has headers is not written to again", () => {
    const req: EventEmitter = new EventEmitter();
    (req as unknown as { headers: Record<string, string> }).headers = {
      "content-length": String(MAX_COMPRESSED_REQUEST_BODY_BYTES + 1),
    };

    const res: FakeResponse = buildResponse();

    res.headersSent = true;

    GzipRequestBodyMiddleware.parseBody(
      req as unknown as ExpressRequest,
      res as unknown as ExpressResponse,
      ((): void => {}) as NextFunction,
    );

    expect(res.statusCode).toBe(0);
    expect(res.jsonBody).toBeUndefined();
  });
});

describe("GzipRequestBodyMiddleware - malformed and truncated input", () => {
  test("a body that is not gzip at all is a 500, exactly as before", async () => {
    const driver: Driver = new Driver();

    await driver.feed([Buffer.from("this is not gzip")]);
    driver.end();

    expect(await driver.waitForOutcome()).toBe(true);

    expect(driver.nextCalls).toHaveLength(0);

    const error: Exception | undefined = driver.errorResponse();

    expect(error).toBeDefined();
    expect(error!.code).toBe(ExceptionCode.ServerException);
    expect(error!.message).toBe("Error decompressing data");
  });

  test("a truncated gzip body is a 500 and never reaches the route", async () => {
    const compressed: Buffer = gzip(Buffer.from("x".repeat(100_000)));

    const driver: Driver = new Driver();

    await driver.feed([
      compressed.subarray(0, Math.floor(compressed.length / 2)),
    ]);
    driver.end();

    expect(await driver.waitForOutcome()).toBe(true);

    expect(driver.nextCalls).toHaveLength(0);
    expect(driver.req.body).toBeUndefined();
    expect(driver.errorResponse()).toBeDefined();
  });

  test("an empty body is an empty body, not a 500", async () => {
    /*
     * A bare `Content-Encoding: gzip` header with no body - which any client
     * can put on a GET - used to reach zlib as an empty stream, fail with
     * "unexpected end of file", and cost a 500 plus an error-level log line
     * on every request.
     */
    const driver: Driver = new Driver();

    driver.end();

    expect(await driver.waitForOutcome()).toBe(true);

    expect(driver.nextCalls).toEqual([undefined]);
    expect(Buffer.isBuffer(driver.req.body)).toBe(true);
    expect((driver.req.body as Buffer).length).toBe(0);
    expect(driver.errorResponse()).toBeUndefined();
  });

  test("a request error is handed to Express rather than swallowed", async () => {
    const driver: Driver = new Driver();

    const failure: Error = new Error("ECONNRESET");

    await driver.feed([gzip(Buffer.from("partial")).subarray(0, 4)]);
    driver.req.emit("error", failure);

    expect(await driver.waitForOutcome()).toBe(true);

    expect(driver.nextCalls).toEqual([failure]);
    expect(driver.res.statusCode).toBe(0);
  });

  test("a client that hangs up mid-body gets no response and no next()", async () => {
    const compressed: Buffer = gzip(Buffer.alloc(2 * 1024 * 1024));

    const driver: Driver = new Driver();

    await driver.feed(chunked(compressed, 512).slice(0, 2));
    driver.req.emit("close");

    await quietPeriod();

    expect(driver.nextCalls).toHaveLength(0);
    expect(driver.res.statusCode).toBe(0);
    expect(driver.req.body).toBeUndefined();
    expect(driver.errorResponse()).toBeUndefined();
  });

  test("the normal close that follows a completed request is not treated as an abort", async () => {
    const driver: Driver = new Driver();

    await driver.feed([gzip(Buffer.from("done"))]);
    driver.end();
    /* Node emits this straight after "end" on a completed request. */
    driver.req.emit("close");

    expect(await driver.waitForOutcome()).toBe(true);

    expect(driver.nextCalls).toHaveLength(1);
    expect((driver.req.body as Buffer).toString()).toBe("done");
  });
});

describe("GzipRequestBodyMiddleware - rejections do not become a log flood", () => {
  test("a 413 is logged at debug, never at warn or error", () => {
    loggerMock("debug").mockClear();
    loggerMock("warn").mockClear();
    loggerMock("error").mockClear();

    /* eslint-disable-next-line no-new */
    new Driver({
      "content-length": String(MAX_COMPRESSED_REQUEST_BODY_BYTES + 1),
    });

    expect(loggerMock("error").mock.calls).toHaveLength(0);
    expect(loggerMock("warn").mock.calls).toHaveLength(0);
    expect(loggerMock("debug").mock.calls).toHaveLength(1);
  });
});

/*
 * The reason the middleware counts output bytes by hand instead of handing
 * zlib a `maxOutputLength`. If a future Node starts honouring the option on
 * streams this test fails and the manual counter can be reconsidered - until
 * then, setting the option would look like a limit while being none.
 */
describe("zlib.createGunzip ignores maxOutputLength (why the counter is manual)", () => {
  test("a stream capped at 1 MiB still emits 8 MiB", async () => {
    const compressed: Buffer = gzip(Buffer.alloc(8 * 1024 * 1024));

    const emitted: number = await new Promise<number>(
      (resolve: (value: number) => void): void => {
        const stream: zlib.Gunzip = zlib.createGunzip({
          maxOutputLength: 1024 * 1024,
        });

        let out: number = 0;

        stream.on("data", (chunk: Buffer): void => {
          out += chunk.length;
        });
        stream.on("error", (): void => {
          resolve(-1);
        });
        stream.on("end", (): void => {
          resolve(out);
        });

        stream.end(compressed as unknown as Uint8Array);
      },
    );

    expect(emitted).toBe(8 * 1024 * 1024);
  });

  test("the same option on the convenience method DOES fire", () => {
    const compressed: Buffer = gzip(Buffer.alloc(8 * 1024 * 1024));

    expect(() => {
      zlib.gunzipSync(compressed as unknown as Uint8Array, {
        maxOutputLength: 1024 * 1024,
      });
    }).toThrow();
  });
});

/*
 * Source-level assertion, for the same reason the session replay suite has
 * one: a jest test cannot stand up the real Express stack, and this failure
 * mode is silent. If StartServer ever goes back to inflating inline, every
 * limit in this file stops running with no visible symptom.
 */
describe("StartServer routes the gzip branch through this middleware", () => {
  const startServerSource: string = fs.readFileSync(
    path.join(__dirname, "../../../Server/Utils/StartServer.ts"),
    "utf-8",
  );

  test("the gzip branch calls GzipRequestBodyMiddleware.parseBody", () => {
    expect(startServerSource).toContain(
      "GzipRequestBodyMiddleware.parseBody(req, res, next)",
    );
  });

  test("StartServer no longer inflates a request body itself", () => {
    expect(startServerSource).not.toContain("zlib.gunzip(");
    expect(startServerSource).not.toMatch(/^import zlib from "zlib";$/m);
  });
});
