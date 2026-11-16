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

import { ExpressJson, ExpressUrlEncoded } from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import { REQUEST_BODY_REFUSAL_MESSAGES } from "../../../Server/Utils/RequestBodyRefusal";
import {
  expressErrorHandler,
  jsonBodyParserOptions,
  urlEncodedBodyParserOptions,
} from "../../../Server/Utils/StartServer";
import {
  UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedErrorKind,
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
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";
import zlib from "zlib";

/*
 * THE APP'S OWN BODY PARSERS, OVER HTTP (#8419).
 *
 * The parsers StartServer mounts - express.json and express.urlencoded with
 * its own options, the 50 MB limit included - and its last-resort error
 * handler, behind a real socket. A body over the limit was answered 500 with
 * "The server ran into a problem it could not explain" and a reference, and
 * JSON that does not parse the same; now each is a 4xx that says what to do,
 * and the front ends read the 413 as too large.
 */

// jsdom has no setImmediate, and Express needs it.
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

const FIFTY_MB: number = 50 * 1024 * 1024;

interface HttpResult {
  status: number;
  body: Record<string, unknown>;
}

let server: http.Server;
let port: number;

function post(data: {
  body: Buffer | string;
  headers: Record<string, string>;
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
          path: "/api/echo",
          method: "POST",
          headers: {
            ...data.headers,
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

      request.on("error", reject);
      request.end(payload);
    },
  );
}

function postJson(
  body: Buffer | string,
  headers: Record<string, string> = {},
): Promise<HttpResult> {
  return post({
    body,
    headers: { "content-type": "application/json", ...headers },
  });
}

function postForm(body: string): Promise<HttpResult> {
  return post({
    body,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
}

// A JSON object whose text is `bytes` long, give or take its quotes.
function jsonOfSize(bytes: number): string {
  return `{"text":"${"x".repeat(bytes)}"}`;
}

beforeAll(async () => {
  const app: express.Express = express();
  app.use(ExpressJson(jsonBodyParserOptions));
  app.use(ExpressUrlEncoded(urlEncodedBodyParserOptions));
  app.post("/api/echo", (req: express.Request, res: express.Response) => {
    res.send({ keys: Object.keys(req.body || {}).length });
  });
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
});

function expectNoServerFault(result: HttpResult): void {
  expect(JSON.stringify(result.body)).not.toContain(
    "The server ran into a problem it could not explain",
  );
  expect(result.body["reference"]).toBeUndefined();
  expect(logger.error).not.toHaveBeenCalled();
}

describe("what the parsers still take", () => {
  test("a JSON body is parsed as before", async () => {
    const result: HttpResult = await postJson('{"a":1,"b":2}');

    expect(result).toEqual({ status: 200, body: { keys: 2 } });
  });

  test("a form body is parsed as before", async () => {
    const result: HttpResult = await postForm("a=1&b=2&c=3");

    expect(result).toEqual({ status: 200, body: { keys: 3 } });
  });

  test("a deflate body that inflates under the limit is parsed", async () => {
    const result: HttpResult = await postJson(
      zlib.deflateSync(Buffer.from(jsonOfSize(1024 * 1024))),
      { "content-encoding": "deflate" },
    );

    expect(result).toEqual({ status: 200, body: { keys: 1 } });
  });
});

describe("a body over the 50 MB limit is answered 413, with OneUptime's own limit", () => {
  test("a JSON body over 50 MB (before: 500, could not explain)", async () => {
    const result: HttpResult = await postJson(jsonOfSize(FIFTY_MB + 1));

    expect(result.status).toBe(413);
    expect(result.body).toEqual({
      error: UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime,
    });
    expectNoServerFault(result);
  }, 60000);

  test("the front ends read the answer as OneUptime's own limit, not a proxy's or a failure with a reference", async () => {
    const result: HttpResult = await postJson(jsonOfSize(FIFTY_MB + 1));

    expect(readUnexplainedError(result.body["error"] as string)).toEqual({
      kind: UnexplainedErrorKind.TooLargeForOneUptime,
      reference: null,
    });
  }, 60000);

  test("a deflate body under the limit on the wire and over it once inflated", async () => {
    const wire: Buffer = zlib.deflateSync(
      Buffer.from(jsonOfSize(FIFTY_MB + 1024)),
    );

    // Small on the wire: nginx's client_max_body_size never sees it.
    expect(wire.length).toBeLessThan(1024 * 1024);

    const result: HttpResult = await postJson(wire, {
      "content-encoding": "deflate",
    });

    expect(result.status).toBe(413);
    expect(result.body).toEqual({
      error: UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime,
    });
    expectNoServerFault(result);
  }, 60000);

  test("a form over 50 MB", async () => {
    const result: HttpResult = await postForm(`a=${"x".repeat(FIFTY_MB + 1)}`);

    expect(result.status).toBe(413);
    expect(result.body).toEqual({
      error: UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime,
    });
  }, 60000);

  test("a form with more fields than the parser takes", async () => {
    const fields: Array<string> = [];

    for (let index: number = 0; index < 1500; index++) {
      fields.push(`field${index}=1`);
    }

    const result: HttpResult = await postForm(fields.join("&"));

    expect(result.status).toBe(413);
    expect(result.body).toEqual({
      error: REQUEST_BODY_REFUSAL_MESSAGES.tooManyFields,
    });
    expectNoServerFault(result);
  });

  test("the refusal is logged at debug, with what it was", async () => {
    await postJson(jsonOfSize(FIFTY_MB + 1));

    expect(logger.error).not.toHaveBeenCalled();
    expect(
      (logger.debug as jest.Mock).mock.calls.some(
        (call: Array<unknown>): boolean => {
          return String(call[0]).includes("entity.too.large");
        },
      ),
    ).toBe(true);
  }, 60000);
});

describe("a body the parsers cannot read is answered as the client's", () => {
  test.each([
    ["a missing value", '{"a":}'],
    ["a trailing comma", '{"a":1,}'],
    ["a single quote", "{'a':1}"],
    ["half a body", '{"a":'],
    ["a string at the top, which strict JSON refuses", '"hello"'],
  ])(
    "JSON that does not parse (%s): 400, not 500",
    async (_shape: string, body: string) => {
      const result: HttpResult = await postJson(body);

      expect(result.status).toBe(400);
      expect(result.body).toEqual({
        error: REQUEST_BODY_REFUSAL_MESSAGES.invalidJson,
      });
      expectNoServerFault(result);
    },
  );

  test("a form sent as JSON: 400, with what to check", async () => {
    const result: HttpResult = await postJson("a=1&b=2");

    expect(result.status).toBe(400);
    expect(result.body["error"]).toContain("Content-Type");
  });

  test("a Content-Encoding the parsers do not read: 415", async () => {
    const result: HttpResult = await postJson(
      zlib.brotliCompressSync(Buffer.from('{"a":1}')),
      { "content-encoding": "br" },
    );

    expect(result.status).toBe(415);
    expect(result.body).toEqual({
      error: REQUEST_BODY_REFUSAL_MESSAGES.encodingUnsupported,
    });
    expectNoServerFault(result);
  });

  test("a charset the JSON parser does not read: 415", async () => {
    const result: HttpResult = await post({
      body: '{"a":1}',
      headers: { "content-type": "application/json; charset=iso-8859-1" },
    });

    expect(result.status).toBe(415);
    expect(result.body).toEqual({
      error: REQUEST_BODY_REFUSAL_MESSAGES.charsetUnsupported,
    });
    expectNoServerFault(result);
  });

  test("a form nested deeper than the parser reads: 400", async () => {
    let key: string = "a";

    for (let depth: number = 0; depth < 40; depth++) {
      key += `[k${depth}]`;
    }

    const result: HttpResult = await postForm(`${key}=1`);

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: REQUEST_BODY_REFUSAL_MESSAGES.tooDeep,
    });
    expectNoServerFault(result);
  });
});
