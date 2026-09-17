import {
  jsonBodyParserOptions,
  urlEncodedBodyParserOptions,
} from "../../../Server/Utils/StartServer";
import {
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  ExpressUrlEncoded,
  OneUptimeRequest,
  RequestHandler,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Readable } from "stream";
import fs from "fs";
import path from "path";

/*
 * The body-parser verify callbacks capture the raw request body for webhook
 * signature verification (Slack, WhatsApp, GitHub, billing). Every consumer
 * does a read-only string comparison against the captured value, so the
 * urlencoded path must alias ONE decoded string to both rawBody and
 * rawFormUrlEncodedBody instead of decoding the buffer twice, and neither
 * path may embed the body (which carries signing material) in its debug
 * message.
 */

type SpyLike = {
  mock: { calls: Array<Array<unknown>> };
  mockRestore: () => void;
};

type MockFn = ReturnType<typeof jest.fn>;

const JSON_DEBUG_MESSAGE: string =
  "Raw JSON Body for signature verification captured";
const URL_ENCODED_DEBUG_MESSAGE: string =
  "Raw Form Url Encoded Body for signature verification captured";

let debugSpy: SpyLike;

beforeEach(() => {
  debugSpy = jest
    .spyOn(logger, "debug")
    .mockImplementation((): void => {}) as unknown as SpyLike;
});

afterEach(() => {
  debugSpy.mockRestore();
});

type VerifyInvoker = (req: OneUptimeRequest, buf: Buffer) => void;

const invokeUrlEncodedVerify: VerifyInvoker = (
  req: OneUptimeRequest,
  buf: Buffer,
): void => {
  urlEncodedBodyParserOptions.verify(
    req as ExpressRequest,
    {} as ExpressResponse,
    buf,
  );
};

const invokeJsonVerify: VerifyInvoker = (
  req: OneUptimeRequest,
  buf: Buffer,
): void => {
  jsonBodyParserOptions.verify(
    req as ExpressRequest,
    {} as ExpressResponse,
    buf,
  );
};

describe("urlencoded verify: single decode aliased to both fields", () => {
  test("decodes the buffer exactly once", () => {
    const toString: MockFn = jest.fn().mockReturnValue("a=1&b=2");
    const req: OneUptimeRequest = {} as OneUptimeRequest;

    invokeUrlEncodedVerify(req, { toString } as unknown as Buffer);

    expect(toString).toHaveBeenCalledTimes(1);
  });

  test("both fields come from the SAME decode, not two independent copies", () => {
    /*
     * A buffer whose toString returns a different value on every call: with
     * one decode both fields hold the first value; the old two-decode code
     * would leave the second value on rawBody.
     */
    const toString: MockFn = jest
      .fn()
      .mockReturnValueOnce("first-decode")
      .mockReturnValue("second-decode");
    const req: OneUptimeRequest = {} as OneUptimeRequest;

    invokeUrlEncodedVerify(req, { toString } as unknown as Buffer);

    expect(req.rawFormUrlEncodedBody).toBe("first-decode");
    expect(req.rawBody).toBe("first-decode");
    expect(req.rawBody).toBe(req.rawFormUrlEncodedBody);
  });

  test("captures an ASCII body byte-identical to buf.toString()", () => {
    const body: string = "a=1&b=2&msg=hello+world&sig=abc123";
    const buf: Buffer = Buffer.from(body);
    const req: OneUptimeRequest = {} as OneUptimeRequest;

    invokeUrlEncodedVerify(req, buf);

    expect(req.rawFormUrlEncodedBody).toBe(buf.toString());
    expect(req.rawBody).toBe(buf.toString());
    expect(req.rawBody).toBe(body);
  });

  test("captures a multi-byte UTF-8 body byte-identical to buf.toString()", () => {
    const body: string = "name=Grüße&emoji=🚀🔥&city=東京&mixed=a™b";
    const buf: Buffer = Buffer.from(body, "utf8");
    const req: OneUptimeRequest = {} as OneUptimeRequest;

    invokeUrlEncodedVerify(req, buf);

    expect(req.rawFormUrlEncodedBody).toBe(buf.toString());
    expect(req.rawBody).toBe(buf.toString());
    expect(req.rawBody).toBe(body);
  });
});

describe("urlencoded verify: debug log is constant and body-free", () => {
  test("logs the constant message with request attributes, never the body", () => {
    const secret: string = "SlackSigningSecretMarker123";
    const req: OneUptimeRequest = {
      requestId: "req-123",
    } as OneUptimeRequest;

    invokeUrlEncodedVerify(req, Buffer.from(`token=${secret}&user=alice`));

    expect(debugSpy.mock.calls).toHaveLength(1);

    const message: unknown = debugSpy.mock.calls[0]![0];
    const attributes: unknown = debugSpy.mock.calls[0]![1];

    expect(message).toBe(URL_ENCODED_DEBUG_MESSAGE);
    expect(message as string).not.toContain(secret);
    expect(message as string).not.toContain("alice");
    expect(attributes).toEqual({ requestId: "req-123" });
  });
});

describe("json verify: regression guard", () => {
  test("sets rawBody to the exact body and leaves rawFormUrlEncodedBody unset", () => {
    const body: string = '{"alert":"CPU high","city":"東京","emoji":"🚀"}';
    const req: OneUptimeRequest = {} as OneUptimeRequest;

    invokeJsonVerify(req, Buffer.from(body, "utf8"));

    expect(req.rawBody).toBe(body);
    expect(req.rawFormUrlEncodedBody).toBeUndefined();
  });

  test("decodes the buffer exactly once", () => {
    const toString: MockFn = jest.fn().mockReturnValue("{}");
    const req: OneUptimeRequest = {} as OneUptimeRequest;

    invokeJsonVerify(req, { toString } as unknown as Buffer);

    expect(toString).toHaveBeenCalledTimes(1);
    expect(req.rawBody).toBe("{}");
  });

  test("logs the constant message with request attributes, never the body", () => {
    const secret: string = "GitHubWebhookSecretMarker456";
    const req: OneUptimeRequest = {
      requestId: "req-456",
    } as OneUptimeRequest;

    invokeJsonVerify(req, Buffer.from(`{"secret":"${secret}"}`));

    expect(debugSpy.mock.calls).toHaveLength(1);

    const message: unknown = debugSpy.mock.calls[0]![0];
    const attributes: unknown = debugSpy.mock.calls[0]![1];

    expect(message).toBe(JSON_DEBUG_MESSAGE);
    expect(message as string).not.toContain(secret);
    expect(attributes).toEqual({ requestId: "req-456" });
  });
});

/*
 * The exported options through the REAL express parsers, so the verify
 * contract (arguments, timing, the parsed body still coming out the other
 * end) is pinned against body-parser itself and not just against how these
 * tests call the callbacks.
 */
describe("options through the real express parsers", () => {
  type StreamRequestFactory = (
    body: string,
    contentType: string,
  ) => OneUptimeRequest;

  const createStreamRequest: StreamRequestFactory = (
    body: string,
    contentType: string,
  ): OneUptimeRequest => {
    const readable: Readable = new Readable({
      read(): void {},
    });
    readable.push(Buffer.from(body, "utf8"));
    readable.push(null);

    const req: OneUptimeRequest = readable as unknown as OneUptimeRequest;
    req.headers = {
      "content-type": contentType,
      "content-length": String(Buffer.byteLength(body, "utf8")),
    };

    return req;
  };

  type MiddlewareRunner = (
    middleware: RequestHandler,
    req: OneUptimeRequest,
  ) => Promise<void>;

  const runMiddleware: MiddlewareRunner = (
    middleware: RequestHandler,
    req: OneUptimeRequest,
  ): Promise<void> => {
    return new Promise<void>(
      (resolve: () => void, reject: (reason: unknown) => void) => {
        middleware(req, {} as ExpressResponse, (err?: unknown): void => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      },
    );
  };

  test("urlencoded: parses the body AND captures one raw copy on both fields", async () => {
    const body: string = "a=1&b=2&name=Gr%C3%BC%C3%9Fe";
    const req: OneUptimeRequest = createStreamRequest(
      body,
      "application/x-www-form-urlencoded",
    );
    const middleware: RequestHandler = ExpressUrlEncoded(
      urlEncodedBodyParserOptions,
    ) as RequestHandler;

    await runMiddleware(middleware, req);

    expect(req.body).toEqual({ a: "1", b: "2", name: "Grüße" });
    expect(req.rawBody).toBe(body);
    expect(req.rawFormUrlEncodedBody).toBe(body);
    expect(debugSpy.mock.calls).toHaveLength(1);
    expect(debugSpy.mock.calls[0]![0]).toBe(URL_ENCODED_DEBUG_MESSAGE);
  });

  test("json: parses the body AND captures the raw copy on rawBody", async () => {
    const body: string = '{"a":1,"city":"東京"}';
    const req: OneUptimeRequest = createStreamRequest(body, "application/json");
    const middleware: RequestHandler = ExpressJson(
      jsonBodyParserOptions,
    ) as RequestHandler;

    await runMiddleware(middleware, req);

    expect(req.body).toEqual({ a: 1, city: "東京" });
    expect(req.rawBody).toBe(body);
    expect(req.rawFormUrlEncodedBody).toBeUndefined();
    expect(debugSpy.mock.calls).toHaveLength(1);
    expect(debugSpy.mock.calls[0]![0]).toBe(JSON_DEBUG_MESSAGE);
  });
});

/*
 * Read rather than executed, following VendorAssets.test.ts: what matters is
 * only that StartServer builds its middlewares from these exact exported
 * option objects, so the behavioral tests above are testing what production
 * actually runs.
 */
describe("StartServer wires the exported options into its middlewares", () => {
  const startServerSource: string = fs.readFileSync(
    path.resolve(
      __dirname,
      "..",
      "..",
      "..",
      "Server",
      "Utils",
      "StartServer.ts",
    ),
    "utf8",
  );

  test("json middleware is built from jsonBodyParserOptions", () => {
    expect(startServerSource).toMatch(
      /ExpressJson\(\s*jsonBodyParserOptions,?\s*\)/,
    );
  });

  test("urlencoded middleware is built from urlEncodedBodyParserOptions", () => {
    expect(startServerSource).toMatch(
      /ExpressUrlEncoded\(\s*urlEncodedBodyParserOptions,?\s*\)/,
    );
  });

  /*
   * Large probe payloads depend on the 50mb limit; the express default is
   * 100kb, so a transcription slip in these exported objects would reject
   * real traffic while every tiny-body test here still passes.
   */
  test("both option objects keep the 50mb limit and extended parsing", () => {
    for (const options of [
      jsonBodyParserOptions,
      urlEncodedBodyParserOptions,
    ]) {
      expect(options.limit).toBe("50mb");
      expect(options.extended).toBe(true);
      expect(typeof options.verify).toBe("function");
    }
  });
});
