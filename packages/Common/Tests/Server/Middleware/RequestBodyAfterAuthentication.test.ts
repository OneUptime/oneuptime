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

import RequestBodyAfterAuthentication from "../../../Server/Middleware/RequestBodyAfterAuthentication";
import {
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  createExpressApp,
} from "../../../Server/Utils/Express";
import {
  REPORT_REQUEST_BODY_LIMIT,
  RequestBodyLimit,
} from "../../../Server/Utils/RequestBodyLimit";
import {
  APP_REQUEST_BODY_LIMIT_FIELD,
  TOO_MANY_JSON_VALUES_TYPE,
} from "../../../Server/Utils/RequestBodyRefusal";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import http from "http";
import { AddressInfo } from "net";
import zlib from "zlib";

/*
 * A BODY READ ONCE ITS CALLER IS KNOWN (#10222), over HTTP.
 *
 * The routes that take millions of JSON values - a probe's collection, a
 * forwarding pod's rows - check their caller's key first, and read their
 * body after, here: StartServer leaves it unread. A request refused by the
 * key check never has its body read; one let through has it read under the
 * route's limit, counted before JSON.parse sees it.
 */

const MIB: number = 1024 * 1024;

// A key check standing in for the cluster key's: a header, and nothing else.
const KEY: string = "the-right-key";

const checkKey: (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): void => {
  if (req.headers["x-test-key"] !== KEY) {
    res.status(400).json({ refused: "wrong key" });
    return;
  }

  next();
};

const SMALL_LIMIT: RequestBodyLimit = {
  bytes: MIB,
  values: 1000,
  objectsArraysAndStrings: 1000,
};

interface Answer {
  status: number;
  body: Record<string, unknown>;
}

let server: http.Server;
let port: number;

// What reached each handler.
const reached: Array<Record<string, unknown>> = [];

function describeBody(body: unknown): Record<string, unknown> {
  if (Buffer.isBuffer(body)) {
    return { isBuffer: true, bytes: body.length, text: body.toString("utf8") };
  }

  return {
    isBuffer: false,
    keys:
      body && typeof body === "object"
        ? Object.keys(body as Record<string, unknown>)
        : [],
  };
}

beforeAll(async () => {
  const app: ExpressApplication = createExpressApp();

  // A route whose key is checked before its JSON is read.
  app.post(
    "/insert",
    checkKey,
    RequestBodyAfterAuthentication.readJson(REPORT_REQUEST_BODY_LIMIT),
    (req: ExpressRequest, res: ExpressResponse) => {
      reached.push(describeBody(req.body));
      res.json({ reached: true, ...describeBody(req.body) });
    },
  );

  // The same, with a small limit.
  app.post(
    "/small",
    RequestBodyAfterAuthentication.readJson(SMALL_LIMIT),
    (req: ExpressRequest, res: ExpressResponse) => {
      res.json(describeBody(req.body));
    },
  );

  // A route that takes the bytes, to parse them itself.
  app.post(
    "/bytes",
    RequestBodyAfterAuthentication.readBytes(SMALL_LIMIT),
    (req: ExpressRequest, res: ExpressResponse) => {
      res.json(describeBody(req.body));
    },
  );

  // A body something read before: left as it is.
  app.post(
    "/parsed-before",
    ExpressJson(),
    RequestBodyAfterAuthentication.readJson(SMALL_LIMIT),
    (req: ExpressRequest, res: ExpressResponse) => {
      res.json(describeBody(req.body));
    },
  );

  app.use(
    (
      err: Record<string, unknown>,
      _req: ExpressRequest,
      res: ExpressResponse,
      _next: NextFunction,
    ): void => {
      res.status(Number(err["status"]) || 500).json({
        type: err["type"],
        appLimit: err[APP_REQUEST_BODY_LIMIT_FIELD],
        limit: err["limit"],
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

let jsonParse: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  reached.length = 0;
  jsonParse?.mockRestore();
  jsonParse = jest.spyOn(JSON, "parse");
});

// The JSON.parse calls a text of at least `bytes` reached.
function parsesOfAtLeast(bytes: number): number {
  return jsonParse.mock.calls.filter((call: Array<unknown>): boolean => {
    return typeof call[0] === "string" && call[0].length >= bytes;
  }).length;
}

function post(data: {
  path: string;
  body: Buffer | string;
  headers?: Record<string, string>;
}): Promise<Answer> {
  const payload: Buffer = Buffer.isBuffer(data.body)
    ? data.body
    : Buffer.from(data.body);

  return new Promise<Answer>(
    (resolve: (answer: Answer) => void, reject: (err: Error) => void) => {
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

            resolve({
              status: response.statusCode || 0,
              body: text
                ? (JSON.parse(text) as Record<string, unknown>)
                : {},
            });
          });
        },
      );

      // A server that answered before reading the body may close under it.
      request.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code !== "EPIPE" && err.code !== "ECONNRESET") {
          reject(err);
        }
      });
      request.end(payload);
    },
  );
}

// "[{},{},...]": `count` empty objects, three bytes each.
function emptyObjects(count: number): string {
  return `[${"{},".repeat(count - 1)}{}]`;
}

describe("a route that checks its caller's key before it reads the body", () => {
  test("refuses a wrong key with the body unread: 23 MiB of eight million objects never reach JSON.parse", async () => {
    const body: string = emptyObjects(7900000);

    for (const headers of [{}, { "x-test-key": "a-wrong-key" }]) {
      const started: number = Date.now();
      const answer: Answer = await post({
        path: "/insert",
        body: body,
        headers: headers,
      });

      expect(answer).toEqual({ status: 400, body: { refused: "wrong key" } });
      expect(Date.now() - started).toBeLessThan(2000);
    }

    expect(reached).toEqual([]);
    expect(parsesOfAtLeast(MIB)).toBe(0);
  }, 120000);

  test("reads and parses the body once the key is right, up to its limit's millions of values", async () => {
    const rows: Array<Record<string, unknown>> = Array.from(
      { length: 300000 },
      (_value: unknown, index: number) => {
        return { _id: `row-${index}`, value: index, at: "2026-11-20" };
      },
    );
    const body: string = JSON.stringify({ tableName: "Log", rows: rows });

    const answer: Answer = await post({
      path: "/insert",
      body: body,
      headers: { "x-test-key": KEY },
    });

    expect(answer).toEqual({
      status: 200,
      body: { reached: true, isBuffer: false, keys: ["tableName", "rows"] },
    });
  }, 120000);

  test("reads a gzip body the same way", async () => {
    const answer: Answer = await post({
      path: "/insert",
      body: zlib.gzipSync(Buffer.from(JSON.stringify({ rows: [1, 2, 3] }))),
      headers: { "x-test-key": KEY, "content-encoding": "gzip" },
    });

    expect(answer).toEqual({
      status: 200,
      body: { reached: true, isBuffer: false, keys: ["rows"] },
    });
  });
});

describe("readJson", () => {
  test("refuses a body past its limit's values with 413, before JSON.parse sees it", async () => {
    const body: string = emptyObjects(5000);

    for (const sent of [
      { body: Buffer.from(body), headers: {} },
      {
        body: zlib.gzipSync(Buffer.from(body)),
        headers: { "content-encoding": "gzip" },
      },
      {
        body: zlib.deflateSync(Buffer.from(body)),
        headers: { "content-encoding": "deflate" },
      },
    ]) {
      const answer: Answer = await post({ path: "/small", ...sent });

      expect(answer.status).toBe(413);
      expect(answer.body["type"]).toBe(TOO_MANY_JSON_VALUES_TYPE);
    }

    expect(parsesOfAtLeast(body.length)).toBe(0);
  });

  test("refuses a body that is not JSON with 400, as body-parser does", async () => {
    const answer: Answer = await post({ path: "/small", body: "{not json" });

    expect(answer).toEqual({
      status: 400,
      body: { type: "entity.parse.failed" },
    });
  });

  test("refuses a body over its limit's bytes with 413, marked as the App's own limit", async () => {
    const answer: Answer = await post({
      path: "/small",
      body: `{"text":"${"x".repeat(MIB)}"}`,
    });

    expect(answer).toEqual({
      status: 413,
      body: { type: "entity.too.large", appLimit: MIB, limit: MIB },
    });
  });

  test("reads an empty body as an empty object, as body-parser does", async () => {
    expect(await post({ path: "/small", body: "" })).toEqual({
      status: 200,
      body: { isBuffer: false, keys: [] },
    });
  });

  test("reads JSON whatever the Content-Type said", async () => {
    expect(
      await post({
        path: "/small",
        body: '{"a":1,"b":2}',
        headers: { "content-type": "text/plain" },
      }),
    ).toEqual({ status: 200, body: { isBuffer: false, keys: ["a", "b"] } });
  });

  test("leaves a body something parsed before it as it is", async () => {
    expect(
      await post({ path: "/parsed-before", body: '{"already":"parsed"}' }),
    ).toEqual({ status: 200, body: { isBuffer: false, keys: ["already"] } });
  });
});

describe("readBytes", () => {
  test("leaves a body's bytes, as sent, of any type", async () => {
    for (const contentType of ["application/json", "text/plain", ""]) {
      expect(
        await post({
          path: "/bytes",
          body: '{"probeKey":"k"}',
          headers: contentType ? { "content-type": contentType } : {},
        }),
      ).toEqual({
        status: 200,
        body: { isBuffer: true, bytes: 16, text: '{"probeKey":"k"}' },
      });
    }
  });

  test("inflates a gzip body, and counts its values as it inflates when it is JSON", async () => {
    expect(
      await post({
        path: "/bytes",
        body: zlib.gzipSync(Buffer.from('{"probeKey":"k"}')),
        headers: { "content-encoding": "gzip" },
      }),
    ).toEqual({
      status: 200,
      body: { isBuffer: true, bytes: 16, text: '{"probeKey":"k"}' },
    });

    const bomb: Answer = await post({
      path: "/bytes",
      body: zlib.gzipSync(Buffer.from(emptyObjects(5000))),
      headers: { "content-encoding": "gzip" },
    });

    expect(bomb.status).toBe(413);
    expect(bomb.body["type"]).toBe(TOO_MANY_JSON_VALUES_TYPE);
  });

  test("refuses a gzip body that inflates past its limit's bytes", async () => {
    const answer: Answer = await post({
      path: "/bytes",
      body: zlib.gzipSync(Buffer.alloc(2 * MIB, "x")),
      headers: {
        "content-encoding": "gzip",
        "content-type": "application/octet-stream",
      },
    });

    expect(answer.status).toBe(413);
  });
});

describe("a body already read", () => {
  test("is never read again: a stream is read once", () => {
    for (const req of [
      { body: Buffer.from("{}") },
      { body: new Uint8Array([123, 125]) },
      { body: {}, _body: true },
      { body: undefined, readableEnded: true },
    ]) {
      expect(
        RequestBodyAfterAuthentication.isRead(req as unknown as ExpressRequest),
      ).toBe(true);
    }

    expect(
      RequestBodyAfterAuthentication.isRead({
        body: undefined,
        readableEnded: false,
      } as unknown as ExpressRequest),
    ).toBe(false);
  });
});
