jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("ERROR"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import Express, {
  ExpressApplication,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import { REQUEST_BODY_REFUSAL_MESSAGES } from "../../../Server/Utils/RequestBodyRefusal";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import {
  UNEXPLAINED_ERROR_MESSAGES,
  readUnexplainedError,
} from "../../../Types/Exception/UnexplainedError";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import crypto from "crypto";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";
import zlib from "zlib";

/*
 * WHAT A ROUTE TAKES, OVER HTTP, THROUGH THE APP'S OWN MIDDLEWARE (#10183).
 *
 * StartServer's middleware, as every OneUptime service mounts it, behind a
 * real socket, with routes standing in for the App's after it: an ordinary
 * API route, the file upload, a probe's report, a vCenter collection and
 * Stripe's webhook. Every route used to parse up to 50 MiB of JSON before
 * anyone was signed in, and 50 MiB of "[]," - 50 KB gzipped - parsed into
 * 17 million arrays. JSON.parse is watched: a refused body never reaches it.
 */

// jsdom has no setImmediate, and Express needs it.
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

const MIB: number = 1024 * 1024;

// The most an ordinary route takes (RequestBodyLimit).
const ORDINARY_BYTES: number = MIB;

interface HttpResult {
  status: number;
  body: Record<string, unknown>;
}

let server: http.Server;
let port: number;

// What the routes below were handed, by path.
const reached: Array<string> = [];

function post(data: {
  path: string;
  body: Buffer | string;
  headers?: Record<string, string> | undefined;
}): Promise<HttpResult> {
  const payload: Buffer = Buffer.isBuffer(data.body)
    ? data.body
    : Buffer.from(data.body);

  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (err: Error) => void) => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: port,
          path: data.path,
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(data.headers || {}),
            "content-length": String(payload.length),
          },
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.on("end", () => {
            const text: string = Buffer.concat(chunks).toString("utf8");
            let body: Record<string, unknown> = {};

            try {
              body = JSON.parse(text) as Record<string, unknown>;
            } catch {
              body = { raw: text };
            }

            resolve({ status: response.statusCode || 0, body });
          });
        },
      );

      /*
       * A server that answered before reading the whole body may close the
       * socket under the rest of it; the answer has arrived by then.
       */
      request.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code !== "EPIPE" && err.code !== "ECONNRESET") {
          reject(err);
        }
      });
      request.end(payload);
    },
  );
}

// "[[],[],...]", `bytes` long: what parsed into 17 million arrays.
function emptyArrays(bytes: number): string {
  return `[${"[],".repeat(Math.floor((bytes - 4) / 3))}[]]`;
}

// A JSON object whose text is about `bytes` long, in one string.
function oneString(bytes: number): string {
  return `{"text":"${"x".repeat(bytes - 12)}"}`;
}

/*
 * The JSON.parse calls a body of at least `bytes` reached: the parsers'
 * own parse, and any route's.
 */
let parseSpy: ReturnType<typeof jest.spyOn>;

function parsesOfAtLeast(bytes: number): number {
  return parseSpy.mock.calls.filter((call: Array<unknown>): boolean => {
    return typeof call[0] === "string" && call[0].length >= bytes;
  }).length;
}

function describeBody(req: express.Request): Record<string, unknown> {
  const body: unknown = req.body;

  return {
    isBuffer: Buffer.isBuffer(body),
    bytes: Buffer.isBuffer(body) ? body.length : undefined,
    keys:
      body && typeof body === "object" && !Buffer.isBuffer(body)
        ? Object.keys(body as Record<string, unknown>)
        : [],
  };
}

beforeAll(async () => {
  /*
   * The App's own express app: importing StartServer mounts its middleware
   * on it - the gzip reader, the JSON, form and protobuf parsers, and the
   * limit each path is held to.
   */
  const app: ExpressApplication = Express.getExpressApp();

  // An ordinary API route: a list query.
  app.post(
    "/api/monitor/get-list",
    (req: express.Request, res: express.Response) => {
      reached.push(req.path);
      res.send(describeBody(req));
    },
  );

  // The Dashboard's file upload (nginx sends /file here).
  app.post("/api/file", (req: express.Request, res: express.Response) => {
    reached.push(req.path);

    const file: { value?: { data?: Array<number> } } | undefined = (
      req.body as { data?: { file?: { value?: { data?: Array<number> } } } }
    )?.data?.file;

    res.send({ fileBytes: file?.value?.data?.length || 0 });
  });

  // A probe's monitor result.
  app.post(
    "/probe-ingest/probe/response/ingest",
    (req: express.Request, res: express.Response) => {
      reached.push(req.path);
      res.send(describeBody(req));
    },
  );

  // A vCenter's collection, gzip-compressed: left to the route as its bytes.
  app.post(
    "/probe-ingest/probe/vmware/collection",
    (req: express.Request, res: express.Response) => {
      reached.push(req.path);
      res.send(describeBody(req));
    },
  );

  // Stripe's webhook: a signature over the body's exact text.
  app.post(
    "/api/billing/webhook",
    (req: express.Request, res: express.Response) => {
      reached.push(req.path);

      const rawBody: string | undefined = (req as OneUptimeRequest).rawBody;

      res.send({
        rawBody: rawBody,
        signature: crypto
          .createHmac("sha256", "whsec_test")
          .update(rawBody || "")
          .digest("hex"),
      });
    },
  );

  // Slack's slash commands and buttons: a signed form on an ordinary route.
  app.post(
    "/api/slack/command",
    (req: express.Request, res: express.Response) => {
      reached.push(req.path);
      res.send({
        rawBody: (req as OneUptimeRequest).rawBody,
        rawFormUrlEncodedBody: (req as OneUptimeRequest).rawFormUrlEncodedBody,
        keys: Object.keys(req.body || {}),
      });
    },
  );

  app.use(expressErrorHandler);

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
  jest.clearAllMocks();
  reached.length = 0;
  parseSpy?.mockRestore();
  parseSpy = jest.spyOn(JSON, "parse");
});

function expectNoServerFault(result: HttpResult): void {
  expect(JSON.stringify(result.body)).not.toContain(
    "The server ran into a problem it could not explain",
  );
  expect(result.body["reference"]).toBeUndefined();
  expect(logger.error).not.toHaveBeenCalled();
}

const TOO_LARGE_FOR_ROUTE: string =
  "What was sent is larger than the 1 MB OneUptime takes in one request to this address, so this did not finish. Try again with less at once.";

const TOO_MANY_VALUES_FOR_ROUTE: string =
  "The request body holds more than 100,000 JSON values (objects, arrays, strings and numbers), the most OneUptime reads in one request to this address, so this did not finish. Send less in each request.";

describe("an ordinary API route", () => {
  test("refuses 50 MiB of empty arrays with 413, and JSON.parse never sees it", async () => {
    const result: HttpResult = await post({
      path: "/api/monitor/get-list",
      body: emptyArrays(50 * MIB),
    });

    expect(result).toEqual({
      status: 413,
      body: { error: TOO_LARGE_FOR_ROUTE },
    });
    expect(reached).toEqual([]);
    expect(parsesOfAtLeast(ORDINARY_BYTES)).toBe(0);
    expectNoServerFault(result);
  }, 120000);

  test("refuses the same 50 MiB gzipped - 50 KB on the wire - with 413, after inflating a fraction of it", async () => {
    const wire: Buffer = zlib.gzipSync(Buffer.from(emptyArrays(50 * MIB)));

    // Small on the wire: nginx's client_max_body_size never sees it.
    expect(wire.length).toBeLessThan(100 * 1024);

    const started: number = Date.now();
    const result: HttpResult = await post({
      path: "/api/monitor/get-list",
      body: wire,
      headers: { "content-encoding": "gzip" },
    });

    expect(result).toEqual({
      status: 413,
      body: { error: TOO_MANY_VALUES_FOR_ROUTE },
    });
    expect(reached).toEqual([]);
    expect(parsesOfAtLeast(100 * 1024)).toBe(0);
    // It used to take three seconds and 667 MiB of heap to parse.
    expect(Date.now() - started).toBeLessThan(1000);
    expectNoServerFault(result);
  }, 120000);

  test("refuses a body under 1 MiB that holds more than 100,000 values, before it is parsed", async () => {
    const body: string = emptyArrays(900 * 1024);

    const result: HttpResult = await post({
      path: "/api/monitor/get-list",
      body: body,
    });

    expect(result).toEqual({
      status: 413,
      body: { error: TOO_MANY_VALUES_FOR_ROUTE },
    });
    expect(reached).toEqual([]);
    expect(parsesOfAtLeast(body.length)).toBe(0);
  });

  test("refuses a deflate body past 100,000 values too, which body-parser inflates itself", async () => {
    const result: HttpResult = await post({
      path: "/api/monitor/get-list",
      body: zlib.deflateSync(Buffer.from(emptyArrays(900 * 1024))),
      headers: { "content-encoding": "deflate" },
    });

    expect(result.status).toBe(413);
    expect(result.body).toEqual({ error: TOO_MANY_VALUES_FOR_ROUTE });
    expect(parsesOfAtLeast(100 * 1024)).toBe(0);
  });

  test("still parses a normal body", async () => {
    const result: HttpResult = await post({
      path: "/api/monitor/get-list",
      body: JSON.stringify({
        query: { name: "Checkout API", labels: ["a", "b"] },
        select: { _id: true, name: true },
        limit: 10,
      }),
    });

    expect(result).toEqual({
      status: 200,
      body: { isBuffer: false, keys: ["query", "select", "limit"] },
    });
  });

  test("still parses a body just under 1 MiB, and a gzip one", async () => {
    const body: string = oneString(ORDINARY_BYTES - 1024);

    expect(await post({ path: "/api/monitor/get-list", body: body })).toEqual({
      status: 200,
      body: { isBuffer: false, keys: ["text"] },
    });

    // A gzip body is the route's to read: it gets the bytes, inflated.
    expect(
      await post({
        path: "/api/monitor/get-list",
        body: zlib.gzipSync(Buffer.from(body)),
        headers: { "content-encoding": "gzip" },
      }),
    ).toEqual({
      status: 200,
      body: { isBuffer: true, bytes: body.length, keys: [] },
    });
  });

  test("refuses a body over 1 MiB in words that say the limit, which the front ends show as they are", async () => {
    const result: HttpResult = await post({
      path: "/api/monitor/get-list",
      body: oneString(ORDINARY_BYTES + 1024),
    });

    expect(result).toEqual({
      status: 413,
      body: { error: TOO_LARGE_FOR_ROUTE },
    });
    // Not the sentence a proxy's 413 gets: no admin is sent to raise one.
    expect(readUnexplainedError(TOO_LARGE_FOR_ROUTE)).toBeNull();
  });

  test("refuses a gzip body that inflates past 1 MiB", async () => {
    const result: HttpResult = await post({
      path: "/api/monitor/get-list",
      body: zlib.gzipSync(Buffer.from(oneString(2 * MIB))),
      headers: { "content-encoding": "gzip" },
    });

    expect(result.status).toBe(413);
    expect(result.body["message"]).toBe(
      `Request body too large. The decompressed body of a gzip-encoded request may not exceed ${ORDINARY_BYTES} bytes.`,
    );
    expect(reached).toEqual([]);
  });

  test("refuses a JSON body in another charset than UTF-8 with 415", async () => {
    const result: HttpResult = await post({
      path: "/api/monitor/get-list",
      body: Buffer.from(JSON.stringify(["[],[]"]), "utf16le"),
      headers: { "content-type": "application/json; charset=utf-16le" },
    });

    expect(result).toEqual({
      status: 415,
      body: { error: REQUEST_BODY_REFUSAL_MESSAGES.charsetUnsupported },
    });
  });
});

describe("the routes that take large bodies take what they are sent", () => {
  test("a 10 MB file, as the Dashboard sends it: 36 MB of JSON, a number for each byte", async () => {
    const file: Buffer = crypto.randomBytes(10 * MIB);
    const body: string = JSON.stringify({
      data: {
        name: "outage.png",
        file: { _type: "Buffer", value: file.toJSON() },
        fileType: "image/png",
      },
      miscDataProps: {},
    });

    expect(body.length).toBeGreaterThan(30 * MIB);

    const result: HttpResult = await post({ path: "/api/file", body: body });

    expect(result).toEqual({ status: 200, body: { fileBytes: file.length } });
  }, 120000);

  test("but not 50 MiB of empty arrays: no more objects, arrays and strings than a large route", async () => {
    const result: HttpResult = await post({
      path: "/api/file",
      body: emptyArrays(50 * MIB - 1024),
    });

    expect(result.status).toBe(413);
    expect(result.body["error"]).toBe(
      "The request body holds more than 1,000,000 JSON objects, arrays and strings, the most OneUptime reads in one request to this address, so this did not finish. Send less in each request.",
    );
    expect(reached).toEqual([]);
    expect(parsesOfAtLeast(MIB)).toBe(0);
  }, 120000);

  test("a probe's monitor result with two 10 MB screenshots", async () => {
    const screenshot: string = crypto.randomBytes(7.5 * MIB).toString("base64");

    const result: HttpResult = await post({
      path: "/probe-ingest/probe/response/ingest",
      body: JSON.stringify({
        probeId: "probe",
        probeKey: "key",
        probeMonitorResponse: {
          syntheticMonitorResponse: [
            { screenshots: { desktop: screenshot, mobile: screenshot } },
          ],
        },
      }),
    });

    expect(result).toEqual({
      status: 200,
      body: {
        isBuffer: false,
        keys: ["probeId", "probeKey", "probeMonitorResponse"],
      },
    });
  }, 120000);

  test("a vCenter's collection gzip-compressed: millions of values, which an ordinary route refuses", async () => {
    const dataPoint: string = JSON.stringify({
      attributes: [{ key: "vcenter.vm.name", value: { stringValue: "vm-1" } }],
      timeUnixNano: "1700000000000000000",
      asDouble: 12.5,
    });
    const report: string = `{"probeId":"p","probeKey":"k","resourceMetrics":[${Array.from(
      { length: 200000 },
      (): string => {
        return dataPoint;
      },
    ).join(",")}]}`;
    const wire: Buffer = zlib.gzipSync(Buffer.from(report));

    // More values than an ordinary route reads, fewer than a report takes.
    expect(report.length).toBeGreaterThan(20 * MIB);

    const result: HttpResult = await post({
      path: "/probe-ingest/probe/vmware/collection",
      body: wire,
      headers: { "content-encoding": "gzip" },
    });

    expect(result).toEqual({
      status: 200,
      body: { isBuffer: true, bytes: report.length, keys: [] },
    });

    const ordinary: HttpResult = await post({
      path: "/api/monitor/get-list",
      body: wire,
      headers: { "content-encoding": "gzip" },
    });

    expect(ordinary.status).toBe(413);
  }, 120000);
});

describe("a webhook's signature check still sees the body's exact text", () => {
  test("Stripe's: rawBody is the text sent, byte for byte", async () => {
    const text: string =
      '{ "id": "evt_1", "type": "invoice.paid",\n  "data": { "object": { "customer": "Grüße 東京 🚀" } } }';

    const result: HttpResult = await post({
      path: "/api/billing/webhook",
      body: text,
    });

    expect(result).toEqual({
      status: 200,
      body: {
        rawBody: text,
        signature: crypto
          .createHmac("sha256", "whsec_test")
          .update(text)
          .digest("hex"),
      },
    });
  });

  test("Slack's form: rawBody and rawFormUrlEncodedBody are the text sent", async () => {
    const text: string = "token=abc&team_id=T1&text=Gr%C3%BC%C3%9Fe+hi";

    const result: HttpResult = await post({
      path: "/api/slack/command",
      body: text,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });

    expect(result).toEqual({
      status: 200,
      body: {
        rawBody: text,
        rawFormUrlEncodedBody: text,
        keys: ["token", "team_id", "text"],
      },
    });
  });

  test("Slack's JSON events, on an ordinary route: rawBody is the text sent", async () => {
    const text: string = '{"type":"url_verification","challenge":"x"}';

    const result: HttpResult = await post({
      path: "/api/slack/command",
      body: text,
    });

    expect(result.status).toBe(200);
    expect(result.body["rawBody"]).toBe(text);
    expect(result.body["rawFormUrlEncodedBody"]).toBeUndefined();
  });
});

describe("the 50 MB a large route takes is still said as the front ends read it back", () => {
  test("a body over 50 MiB to a large route", async () => {
    const result: HttpResult = await post({
      path: "/probe-ingest/probe/response/ingest",
      body: oneString(50 * MIB + 1024),
    });

    expect(result).toEqual({
      status: 413,
      body: { error: UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime },
    });
  }, 120000);
});
