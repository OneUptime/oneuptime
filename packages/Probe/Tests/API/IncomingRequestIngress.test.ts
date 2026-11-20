// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";
// Keep the backoff arithmetic honest but the suite fast.
process.env["PROBE_INGRESS_FORWARD_RETRY_LIMIT"] = "2";

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
import WebhookRequestBody from "Common/Server/Middleware/WebhookRequestBody";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  ExpressUrlEncoded,
  OneUptimeRequest,
} from "Common/Server/Utils/Express";
import IncomingRequestSignature from "Common/Server/Utils/Monitor/IncomingRequestSignature";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Headers from "Common/Types/API/Headers";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import {
  INCOMING_REQUEST_SIGNATURE_FORMATS,
  IncomingRequestSignatureFormat,
  IncomingRequestSignatureScheme,
} from "Common/Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import Sleep from "Common/Types/Sleep";
import API from "Common/Utils/API";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import ingressRouter, {
  createIngressApp,
  getForwardUrl,
  INGRESS_BODY_LIMIT,
  isRefusalNotWorthRetrying,
} from "../../API/IncomingRequestIngress";
import http from "http";
import { AddressInfo } from "net";
import zlib from "zlib";

/*
 * The probe's ingress is a PROXY sitting between a customer's device and
 * OneUptime, and it exists because the device is inside a network the control
 * plane cannot reach. Three properties follow from that, and none of them is
 * checked anywhere else:
 *
 *   IT ANSWERS FIRST AND FORWARDS AFTER. The caller is a cron job, a
 *   microcontroller, a backup script - something that will happily block on
 *   the socket, or give up and page somebody, if the answer waits on a round
 *   trip to the control plane. So the 200 is sent before the forward is even
 *   attempted, and the forward's outcome never changes the answer.
 *
 *   IT DOES NOT PASS ON HOP-BY-HOP HEADERS. `host` names the probe, not the
 *   control plane; `content-length` describes the body as it arrived, not as
 *   it is re-serialised. Forwarding either produces a request that is either
 *   misrouted or malformed, and both fail in ways that look like the
 *   customer's device is broken.
 *
 *   IT GIVES UP. A retry loop with no ceiling in a process that also runs
 *   monitors is a way to lose the monitors. The forward retries with capped
 *   exponential backoff and then stops, having logged.
 */

type ExpressRouteHandler = (
  req: unknown,
  res: unknown,
  next: (err?: unknown) => void,
) => Promise<void> | void;

type ExpressRouterLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: ExpressRouteHandler }>;
  };
};

type GetHandlerFunction = (path: string, method: string) => ExpressRouteHandler;

const getHandler: GetHandlerFunction = (
  path: string,
  method: string,
): ExpressRouteHandler => {
  const layers: Array<ExpressRouterLayer> = (
    ingressRouter as unknown as { stack: Array<ExpressRouterLayer> }
  ).stack;

  const route: ExpressRouterLayer["route"] | undefined = layers.find(
    (candidate: ExpressRouterLayer) => {
      return (
        candidate.route?.path === path &&
        candidate.route?.methods[method] === true
      );
    },
  )?.route;

  if (!route) {
    throw new Error(`${method.toUpperCase()} ${path} is not registered`);
  }

  return route.stack[route.stack.length - 1]!.handle;
};

interface CapturedResponse {
  body: JSONObject | null;
  statusCode: number | null;
}

interface ApiFetchSpy {
  mock: { calls: Array<Array<unknown>> };
}

type CallIngressFunction = (data?: {
  path?: string;
  method?: string;
  params?: Record<string, string>;
  headers?: Record<string, string | Array<string> | undefined>;
  body?: unknown;
  // The bytes the listener kept of a signed request's body, as it parsed it.
  rawBodyBytes?: Buffer;
}) => Promise<{ captured: CapturedResponse; nextError: unknown }>;

const callIngress: CallIngressFunction = async (data?: {
  path?: string;
  method?: string;
  params?: Record<string, string>;
  headers?: Record<string, string | Array<string> | undefined>;
  body?: unknown;
  rawBodyBytes?: Buffer;
}): Promise<{ captured: CapturedResponse; nextError: unknown }> => {
  const captured: CapturedResponse = { body: null, statusCode: null };
  let nextError: unknown = undefined;

  const res: Record<string, unknown> = {
    status: (code: number): unknown => {
      captured.statusCode = code;
      return res;
    },
    send: (body: JSONObject): unknown => {
      captured.body = body;
      return res;
    },
    json: (body: JSONObject): unknown => {
      captured.body = body;
      return res;
    },
    set: (): unknown => {
      return res;
    },
    setHeader: (): unknown => {
      return res;
    },
    removeHeader: (): unknown => {
      return res;
    },
    end: (): unknown => {
      return res;
    },
  };

  await getHandler(
    data?.path ?? "/incoming-request/:secretkey",
    data?.method ?? "post",
  )(
    {
      method: (data?.method ?? "post").toUpperCase(),
      params: data?.params ?? { secretkey: "super-secret-key" },
      headers: data?.headers ?? {},
      body: data && "body" in data ? data.body : { hello: "world" },
      rawBodyBytes: data?.rawBodyBytes,
      query: {},
    },
    res,
    (err?: unknown): void => {
      nextError = err;
    },
  );

  return { captured: captured, nextError: nextError };
};

type MockForwardFunction = () => ApiFetchSpy;

const mockForwardSucceeds: MockForwardFunction = (): ApiFetchSpy => {
  return jest
    .spyOn(API, "fetch")
    .mockResolvedValue(
      new HTTPResponse<JSONObject>(200, {}, {}) as never,
    ) as unknown as ApiFetchSpy;
};

type ReadForwardFunction = (spy: ApiFetchSpy) => Record<string, unknown>;

const readForward: ReadForwardFunction = (
  spy: ApiFetchSpy,
): Record<string, unknown> => {
  return spy.mock.calls[0]![0] as Record<string, unknown>;
};

// Let the fire-and-forget forward run to completion before asserting on it.
type FlushFunction = () => Promise<void>;

const flush: FlushFunction = async (): Promise<void> => {
  for (let i: number = 0; i < 20; i++) {
    await Promise.resolve();
  }
};

describe("the routes the ingress serves", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const ROUTES: Array<[string, string]> = [
    ["/incoming-request/:secretkey", "post"],
    ["/incoming-request/:secretkey", "get"],
    ["/heartbeat/:secretkey", "post"],
    ["/heartbeat/:secretkey", "get"],
  ];

  test.each(ROUTES)("serves %s over %s", (path: string, method: string) => {
    expect(getHandler(path, method)).toBeDefined();
  });

  /*
   * Heartbeat and incoming-request are the same monitor type on the server -
   * a heartbeat IS an incoming request - so both spellings forward to the
   * incoming-request route. Pinning this stops a well-meant "fix" that
   * forwards /heartbeat to a /heartbeat route the server does not serve.
   */
  test("a heartbeat forwards to the incoming-request route", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    await callIngress({ path: "/heartbeat/:secretkey", method: "post" });
    await flush();

    expect(String(readForward(spy)["url"])).toContain(
      "/incoming-request/super-secret-key",
    );
  });

  /*
   * The forward goes to the App's incoming-request route under its
   * "/incoming-request-ingest" prefix, which nginx routes to the App on every
   * installation. The bare "/incoming-request/<key>" has no nginx location:
   * with billing on (OneUptime Cloud) the catch-all sent it to the marketing
   * site, which answered 404, and every forwarded heartbeat was lost.
   */
  test.each(ROUTES)(
    "%s over %s forwards under the incoming-request-ingest prefix",
    async (path: string, method: string) => {
      const spy: ApiFetchSpy = mockForwardSucceeds();

      await callIngress({ path: path, method: method });
      await flush();

      expect(String(readForward(spy)["url"])).toBe(
        "https://oneuptime.example.com/incoming-request-ingest/incoming-request/super-secret-key",
      );
    },
  );

  test("the forward URL is ONEUPTIME_URL, the ingest prefix and the key, and never the bare route", () => {
    const url: string = getForwardUrl("another-key").toString();

    expect(url).toBe(
      "https://oneuptime.example.com/incoming-request-ingest/incoming-request/another-key",
    );
    expect(url).not.toMatch(/oneuptime\.example\.com\/incoming-request\//);
    expect(url).not.toContain("/heartbeat/");
  });
});

describe("the answer the customer's device gets", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is a 200, sent without waiting on the forward", async () => {
    /*
     * A forward that never settles. If the handler awaited it, this test
     * would time out instead of asserting.
     */
    jest.spyOn(API, "fetch").mockReturnValue(
      new Promise((): void => {
        // deliberately never resolves
      }) as never,
    );

    const result: { captured: CapturedResponse; nextError: unknown } =
      await callIngress();

    expect(result.captured.statusCode).toBe(200);
    expect(result.captured.body).toEqual({});
  });

  test("is still a 200 when the control plane refuses the forward", async () => {
    jest
      .spyOn(API, "fetch")
      .mockResolvedValue(
        new HTTPErrorResponse(500, { message: "nope" }, {}) as never,
      );
    jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined as never);

    const result: { captured: CapturedResponse; nextError: unknown } =
      await callIngress();
    await flush();

    expect(result.captured.statusCode).toBe(200);
  });

  test("is a client error when no secret key was supplied", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    const result: { captured: CapturedResponse; nextError: unknown } =
      await callIngress({ params: {} });

    expect(result.captured.statusCode).toBeGreaterThanOrEqual(400);
    expect(result.captured.statusCode).toBeLessThan(500);
    expect(spy.mock.calls.length).toBe(0);
  });
});

describe("the headers it passes on", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const HOP_BY_HOP: Array<string> = [
    "host",
    "connection",
    "content-length",
    "transfer-encoding",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "upgrade",
  ];

  test("strips every hop-by-hop header", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    const headers: Record<string, string> = { "x-custom": "keep-me" };
    for (const name of HOP_BY_HOP) {
      headers[name] = "should-not-be-forwarded";
    }

    await callIngress({ headers: headers });
    await flush();

    const forwarded: Headers = readForward(spy)["headers"] as Headers;

    for (const name of HOP_BY_HOP) {
      expect(forwarded[name]).toBeUndefined();
    }
    expect(forwarded["x-custom"]).toBe("keep-me");
  });

  test("strips them however the client capitalised them", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    await callIngress({
      headers: { Host: "probe.internal", "Content-Length": "42" },
    });
    await flush();

    const forwarded: Headers = readForward(spy)["headers"] as Headers;

    expect(forwarded["Host"]).toBeUndefined();
    expect(forwarded["Content-Length"]).toBeUndefined();
  });

  /*
   * The listener inflates a compressed body while it parses it, and the
   * forward carries the parsed body uncompressed. A copied
   * "Content-Encoding: gzip" made OneUptime try to gunzip plain JSON and
   * refuse it, so a compressed heartbeat was retried and then dropped.
   */
  test("strips Content-Encoding, because the body it forwards is never the compressed one", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    await callIngress({
      headers: {
        "content-encoding": "gzip",
        "Content-Encoding": "deflate",
        "content-type": "application/json",
      },
    });
    await flush();

    const forwarded: Headers = readForward(spy)["headers"] as Headers;

    expect(forwarded["content-encoding"]).toBeUndefined();
    expect(forwarded["Content-Encoding"]).toBeUndefined();
    expect(forwarded["content-type"]).toBe("application/json");
  });

  test("joins a repeated header rather than forwarding an array", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    await callIngress({ headers: { "x-multi": ["a", "b"] } });
    await flush();

    expect((readForward(spy)["headers"] as Headers)["x-multi"]).toBe("a, b");
  });

  test("drops a header the client sent with no value", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    await callIngress({ headers: { "x-empty": undefined, "x-real": "v" } });
    await flush();

    const forwarded: Headers = readForward(spy)["headers"] as Headers;

    expect("x-empty" in forwarded).toBe(false);
    expect(forwarded["x-real"]).toBe("v");
  });

  test("stamps the probe id so the server knows which probe relayed this", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    await callIngress();
    await flush();

    expect(
      (readForward(spy)["headers"] as Headers)["OneUptime-Probe-Id"],
    ).toBeTruthy();
  });

  /*
   * A probe that has not finished registering still has a customer's device
   * pointing at it. Dropping the request because the probe cannot name itself
   * would lose a heartbeat and open an incident.
   */
  test("still forwards when the probe cannot name itself yet", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    LocalCache.setString("PROBE", "PROBE_ID", "");
    const originalProbeId: string | undefined = process.env["PROBE_ID"];
    delete process.env["PROBE_ID"];

    try {
      await callIngress();
      await flush();

      expect(spy.mock.calls.length).toBe(1);
      expect(
        (readForward(spy)["headers"] as Headers)["OneUptime-Probe-Id"],
      ).toBeUndefined();
    } finally {
      if (originalProbeId) {
        process.env["PROBE_ID"] = originalProbeId;
      }
    }
  });
});

describe("the body it passes on", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("forwards a JSON object unchanged", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    await callIngress({ body: { status: "ok", count: 2 } });
    await flush();

    expect(readForward(spy)["data"]).toEqual({ status: "ok", count: 2 });
  });

  test("forwards a JSON array as an array", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    await callIngress({ body: [{ a: 1 }, { b: 2 }] });
    await flush();

    expect(readForward(spy)["data"]).toEqual([{ a: 1 }, { b: 2 }]);
  });

  /*
   * A text the listener holds as text is forwarded as its bytes, for
   * OneUptime to read as the text it is (#8430): it used to be wrapped as
   * { _raw }, which no monitor would have read as the text it was sent as.
   */
  test("forwards a text body as the bytes of the text", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    await callIngress({ body: "backup finished" });
    await flush();

    const data: unknown = readForward(spy)["data"];

    expect(Buffer.isBuffer(data)).toBe(true);
    expect((data as Buffer).toString("utf8")).toBe("backup finished");
  });

  test("forwards the bytes it read as they are", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();
    const bytes: Buffer = Buffer.from("café", "latin1");

    await callIngress({ body: bytes });
    await flush();

    expect(readForward(spy)["data"]).toBe(bytes);
  });

  test("forwards an empty object for a body-less request", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    await callIngress({ body: null });
    await flush();

    expect(readForward(spy)["data"]).toEqual({});
  });

  test("forwards an empty object when the body is undefined", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    await callIngress({ body: undefined });
    await flush();

    expect(readForward(spy)["data"]).toEqual({});
  });

  test("forwards the method the device used", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    await callIngress({ method: "get" });
    await flush();

    expect(String(readForward(spy)["method"])).toMatch(/get/i);
  });
});

/*
 * A signed request's body is passed on as the bytes that came (#8500): its
 * signature was made over them, and the JSON or form the listener parsed,
 * sent on re-encoded, would no longer match it.
 */
describe("a signed request's body", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const SPACED_JSON: Buffer = Buffer.from('{ "status" : "ok" }', "utf8");

  test.each(
    INCOMING_REQUEST_SIGNATURE_FORMATS.map(
      (format: IncomingRequestSignatureFormat): [string] => {
        return [format.header];
      },
    ),
  )(
    "signed in %s, is forwarded as the bytes that came, not as the listener parsed them",
    async (header: string) => {
      const spy: ApiFetchSpy = mockForwardSucceeds();

      await callIngress({
        headers: { [header.toLowerCase()]: "a signature" },
        body: { status: "ok" },
        rawBodyBytes: SPACED_JSON,
      });
      await flush();

      expect(readForward(spy)["data"]).toBe(SPACED_JSON);
    },
  );

  test("is the text that came, for a text body", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();
    const bytes: Buffer = Buffer.from("backup finished", "utf8");

    await callIngress({
      headers: { "x-oneuptime-signature": "a signature" },
      body: bytes,
    });
    await flush();

    expect(readForward(spy)["data"]).toBe(bytes);
  });

  test("is no body at all when the request came without one, never {}", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    await callIngress({
      method: "get",
      headers: { "x-hub-signature-256": "a signature" },
      body: undefined,
    });
    await flush();

    const data: unknown = readForward(spy)["data"];

    expect(Buffer.isBuffer(data)).toBe(true);
    expect((data as Buffer).length).toBe(0);
  });

  test("is still the JSON the listener parsed for a request sending a secret, not a signature", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    await callIngress({
      headers: { "x-oneuptime-secret": "one-of-the-project-secrets" },
      body: { status: "ok" },
      rawBodyBytes: SPACED_JSON,
    });
    await flush();

    expect(readForward(spy)["data"]).toEqual({ status: "ok" });
  });

  test("is still the JSON the listener parsed when the signature header is empty", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    await callIngress({
      headers: { "x-oneuptime-signature": "" },
      body: { status: "ok" },
      rawBodyBytes: SPACED_JSON,
    });
    await flush();

    expect(readForward(spy)["data"]).toEqual({ status: "ok" });
  });
});

describe("when the forward fails", () => {
  beforeEach(() => {
    jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("retries, and then gives up rather than looping forever", async () => {
    const spy: ApiFetchSpy = jest
      .spyOn(API, "fetch")
      .mockRejectedValue(
        new Error("ECONNREFUSED") as never,
      ) as unknown as ApiFetchSpy;

    await callIngress();
    await flush();

    // The first attempt plus PROBE_INGRESS_FORWARD_RETRY_LIMIT retries.
    expect(spy.mock.calls.length).toBe(3);
  });

  test("treats an error response from the control plane as a failure worth retrying", async () => {
    const spy: ApiFetchSpy = jest
      .spyOn(API, "fetch")
      .mockResolvedValue(
        new HTTPErrorResponse(503, { message: "unavailable" }, {}) as never,
      ) as unknown as ApiFetchSpy;

    await callIngress();
    await flush();

    expect(spy.mock.calls.length).toBeGreaterThan(1);
  });

  /*
   * A 4xx says the request itself is wrong - most often, now, that its
   * project requires an incoming request secret and the device sent none
   * (issue #7526). The same request is refused the same way every time, so
   * retrying it only keeps the probe busy through every backoff.
   */
  test.each([400, 401, 403, 404, 413, 422])(
    "does not retry a request OneUptime refused with %i",
    async (status: number) => {
      const spy: ApiFetchSpy = jest
        .spyOn(API, "fetch")
        .mockResolvedValue(
          new HTTPErrorResponse(
            status,
            { message: "This project requires a secret." },
            {},
          ) as never,
        ) as unknown as ApiFetchSpy;

      await callIngress();
      await flush();

      expect(spy.mock.calls.length).toBe(1);
    },
  );

  test.each([408, 429, 500, 502, 503])(
    "still retries %i, which is about the moment, not the request",
    async (status: number) => {
      const spy: ApiFetchSpy = jest
        .spyOn(API, "fetch")
        .mockResolvedValue(
          new HTTPErrorResponse(status, { message: "busy" }, {}) as never,
        ) as unknown as ApiFetchSpy;

      await callIngress();
      await flush();

      expect(spy.mock.calls.length).toBe(3);
    },
  );

  test("stops retrying as soon as one attempt succeeds", async () => {
    let attempt: number = 0;

    const spy: ApiFetchSpy = jest
      .spyOn(API, "fetch")
      .mockImplementation(async (): Promise<never> => {
        attempt++;
        if (attempt === 1) {
          throw new Error("transient");
        }
        return new HTTPResponse<JSONObject>(200, {}, {}) as never;
      }) as unknown as ApiFetchSpy;

    await callIngress();
    await flush();

    expect(spy.mock.calls.length).toBe(2);
  });

  /*
   * Backoff doubles and is capped. Uncapped doubling on a control plane that
   * is down for an hour would put a probe to sleep for longer than the
   * outage it is meant to be reporting.
   */
  test("backs off with capped exponential delays", async () => {
    const sleepSpy: ApiFetchSpy = jest
      .spyOn(Sleep, "sleep")
      .mockResolvedValue(undefined as never) as unknown as ApiFetchSpy;

    jest.spyOn(API, "fetch").mockRejectedValue(new Error("down") as never);

    await callIngress();
    await flush();

    const delays: Array<number> = sleepSpy.mock.calls.map(
      (call: Array<unknown>) => {
        return call[0] as number;
      },
    );

    expect(delays).toEqual([2000, 4000]);
    for (const delay of delays) {
      expect(delay).toBeLessThanOrEqual(15000);
    }
  });

  test("a failed forward never reaches the error middleware", async () => {
    jest.spyOn(API, "fetch").mockRejectedValue(new Error("down") as never);

    const result: { captured: CapturedResponse; nextError: unknown } =
      await callIngress();
    await flush();

    expect(result.nextError).toBeUndefined();
  });
});

/*
 * The listener as a device reaches it: the real app, on a port of its own,
 * with the body parsers it runs in production. The tests above call the
 * route handler with a body already in hand; these send bytes, so they hold
 * what the parsers do - which bodies are read, how large, and how a
 * compressed one is passed on - and which methods are answered at all.
 */
describe("the listener, over HTTP", () => {
  let server: http.Server;
  let port: number = 0;

  interface SentRequest {
    method: string;
    path?: string;
    headers?: Record<string, string>;
    body?: Buffer | string;
  }

  interface Answer {
    statusCode: number;
    body: string;
  }

  type SendFunction = (request: SentRequest) => Promise<Answer>;

  const send: SendFunction = (request: SentRequest): Promise<Answer> => {
    return new Promise(
      (resolve: (answer: Answer) => void, reject: (err: Error) => void) => {
        const outgoing: http.ClientRequest = http.request(
          {
            host: "127.0.0.1",
            port: port,
            method: request.method,
            path: request.path ?? "/heartbeat/super-secret-key",
            headers: request.headers ?? {},
          },
          (response: http.IncomingMessage) => {
            const chunks: Array<Buffer> = [];
            response.on("data", (chunk: Buffer) => {
              chunks.push(chunk);
            });
            response.on("end", () => {
              resolve({
                statusCode: response.statusCode ?? 0,
                body: Buffer.concat(chunks).toString("utf8"),
              });
            });
          },
        );
        outgoing.on("error", reject);
        if (request.body !== undefined) {
          outgoing.write(request.body);
        }
        outgoing.end();
      },
    );
  };

  // The forward is fire-and-forget: wait for it rather than for a fixed time.
  type ForwardedFunction = (
    spy: ApiFetchSpy,
  ) => Promise<Record<string, unknown>>;

  const forwarded: ForwardedFunction = async (
    spy: ApiFetchSpy,
  ): Promise<Record<string, unknown>> => {
    for (let i: number = 0; i < 200 && spy.mock.calls.length === 0; i++) {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 5);
      });
    }

    return readForward(spy);
  };

  beforeEach(async () => {
    server = createIngressApp().listen(0, "127.0.0.1");
    await new Promise((resolve: (value: unknown) => void) => {
      server.once("listening", resolve);
    });
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await new Promise((resolve: (value: unknown) => void) => {
      server.close(resolve);
    });
  });

  test("reads JSON and form bodies up to OneUptime's own 50 MB", () => {
    expect(INGRESS_BODY_LIMIT).toBe("50mb");
  });

  /*
   * #10183: the listener is reached before anything is checked, and parsed
   * 50 MB of "[]," into 17 million arrays. A JSON body is counted first, as
   * OneUptime counts one sent to the monitor directly, and one with more
   * values than OneUptime reads is refused, never parsed nor forwarded.
   */
  test("refuses a JSON body with more values than OneUptime reads, gzip-compressed or not, and forwards nothing", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();
    const bomb: string = `[${"[],".repeat(1100000)}[]]`;
    const jsonParse: ReturnType<typeof jest.spyOn> = jest.spyOn(
      JSON,
      "parse",
    );

    const plain: Answer = await send({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bomb,
    });
    const compressed: Answer = await send({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      },
      body: zlib.gzipSync(bomb),
    });

    expect(plain.statusCode).toBe(413);
    expect(compressed.statusCode).toBe(413);
    expect(
      jsonParse.mock.calls.some((call: Array<unknown>): boolean => {
        return typeof call[0] === "string" && call[0].length > 1024 * 1024;
      }),
    ).toBe(false);

    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 50);
    });
    expect(spy).not.toHaveBeenCalled();
  });

  test("still takes a JSON body of many values within OneUptime's limit", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();
    const values: Array<number> = Array.from(
      { length: 200000 },
      (_value: unknown, index: number): number => {
        return index;
      },
    );

    const answer: Answer = await send({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: values }),
    });

    expect(answer.statusCode).toBe(200);
    expect(
      ((await forwarded(spy))["data"] as { values: Array<number> }).values,
    ).toHaveLength(200000);
  });

  test("answers a JSON heartbeat with 200 and an empty JSON object, and forwards the body", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    const answer: Answer = await send({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "healthy", version: "1.2.3" }),
    });

    expect(answer.statusCode).toBe(200);
    expect(JSON.parse(answer.body)).toEqual({});
    expect((await forwarded(spy))["data"]).toEqual({
      status: "healthy",
      version: "1.2.3",
    });
  });

  test("inflates a gzip JSON body, and forwards it parsed and without Content-Encoding", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    const answer: Answer = await send({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      },
      body: zlib.gzipSync(JSON.stringify({ status: "healthy" })),
    });

    const forward: Record<string, unknown> = await forwarded(spy);
    const headerNames: Array<string> = Object.keys(
      forward["headers"] as Headers,
    ).map((name: string): string => {
      return name.toLowerCase();
    });

    expect(answer.statusCode).toBe(200);
    expect(forward["data"]).toEqual({ status: "healthy" });
    expect(headerNames).not.toContain("content-encoding");
    expect(headerNames).toContain("content-type");
  });

  test("reads a form body into its fields", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    await send({
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "status=healthy&version=1.2.3",
    });

    expect((await forwarded(spy))["data"]).toEqual({
      status: "healthy",
      version: "1.2.3",
    });
  });

  /*
   * Amazon SNS posts its subscription confirmations and notifications as
   * JSON labelled text/plain, and OneUptime reads that as the JSON it is
   * (WebhookRequestBody, #7723). The listener passes the text on as it
   * came, with its Content-Type, so a topic pointed at the probe reaches
   * the monitor as it would have directly.
   */
  test("forwards JSON sent as text/plain, as Amazon SNS sends it, as the text that came, with its type", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();
    const confirmation: Record<string, string> = {
      Type: "SubscriptionConfirmation",
      TopicArn: "arn:aws:sns:eu-west-1:123456789012:oneuptime-alerts",
      SubscribeURL:
        "https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn:aws:sns:eu-west-1:123456789012:oneuptime-alerts&Token=2336412f37fb687f",
      Token: "2336412f37fb687f",
    };

    const answer: Answer = await send({
      method: "POST",
      headers: {
        "Content-Type": "text/plain; charset=UTF-8",
        "x-amz-sns-message-type": "SubscriptionConfirmation",
      },
      body: JSON.stringify(confirmation),
    });

    const forward: Record<string, unknown> = await forwarded(spy);

    expect(answer.statusCode).toBe(200);
    expect((forward["data"] as Buffer).toString("utf8")).toBe(
      JSON.stringify(confirmation),
    );
    expect((forward["headers"] as Headers)["content-type"]).toBe(
      "text/plain; charset=UTF-8",
    );
  });

  test("inflates gzip JSON sent as text/plain, and forwards the text uncompressed", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    await send({
      method: "POST",
      headers: { "Content-Type": "text/plain", "Content-Encoding": "gzip" },
      body: zlib.gzipSync(JSON.stringify({ status: "healthy" })),
    });

    const forward: Record<string, unknown> = await forwarded(spy);

    expect((forward["data"] as Buffer).toString("utf8")).toBe(
      JSON.stringify({ status: "healthy" }),
    );
    expect(
      Object.keys(forward["headers"] as Headers).map((name: string) => {
        return name.toLowerCase();
      }),
    ).not.toContain("content-encoding");
  });

  /*
   * #8430: OneUptime reads plain text as the text it is, so the listener
   * forwards it - as the bytes that came, with the Content-Type that came,
   * so OneUptime decodes it in the charset the device named.
   */
  test("forwards plain text as the text it is, as OneUptime reads it", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    const answer: Answer = await send({
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "backup finished",
    });

    const forward: Record<string, unknown> = await forwarded(spy);

    expect(answer.statusCode).toBe(200);
    expect((forward["data"] as Buffer).toString("utf8")).toBe(
      "backup finished",
    );
    expect((forward["headers"] as Headers)["content-type"]).toBe("text/plain");
  });

  test("forwards text in another charset as its own bytes, with the charset it names", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();
    const latin1: Buffer = Buffer.from("café: sauvegarde échouée", "latin1");

    await send({
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=iso-8859-1" },
      body: latin1,
    });

    const forward: Record<string, unknown> = await forwarded(spy);

    expect((forward["data"] as Buffer).equals(latin1)).toBe(true);
    expect((forward["headers"] as Headers)["content-type"]).toBe(
      "text/plain; charset=iso-8859-1",
    );
  });

  test("forwards a CloudEvent, as Azure Event Grid delivers it, as the JSON text that came", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();
    const event: string = JSON.stringify({
      specversion: "1.0",
      type: "Microsoft.Storage.BlobCreated",
      id: "9aeb0fdf-c01e-0131-0922-9eb54906e209",
    });

    await send({
      method: "POST",
      headers: {
        "Content-Type": "application/cloudevents+json; charset=utf-8",
      },
      body: event,
    });

    expect(((await forwarded(spy))["data"] as Buffer).toString("utf8")).toBe(
      event,
    );
  });

  test("answers 200 to a large plain-text body and forwards all of it", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();
    const body: Buffer = Buffer.alloc(200 * 1024, "a");

    const answer: Answer = await send({
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: body,
    });

    expect(answer.statusCode).toBe(200);
    expect(((await forwarded(spy))["data"] as Buffer).equals(body)).toBe(true);
  });

  /*
   * OneUptime reads only JSON, form, text/plain and +json bodies, so any
   * other body reaches the monitor empty. The listener used to read
   * application/octet-stream too, under express.raw's 100 KB default: a
   * larger one was answered 413, not the 200 a device is promised, and was
   * never forwarded at all.
   */
  test.each([
    ["application/octet-stream", 200 * 1024],
    ["application/octet-stream", 16],
    ["application/xml", 16],
  ])(
    "answers 200 to a %s body of %i bytes and forwards it empty, as OneUptime would read it",
    async (contentType: string, size: number) => {
      const spy: ApiFetchSpy = mockForwardSucceeds();

      const answer: Answer = await send({
        method: "POST",
        headers: { "Content-Type": contentType },
        body: Buffer.alloc(size, 7),
      });

      expect(answer.statusCode).toBe(200);
      expect((await forwarded(spy))["data"]).toEqual({});
    },
  );

  /*
   * A signed request's body reaches OneUptime as the bytes that came
   * (#8500), whatever its type: the listener keeps them as it parses.
   */
  type ForwardedBytesFunction = (spy: ApiFetchSpy) => Promise<string>;

  const forwardedBytes: ForwardedBytesFunction = async (
    spy: ApiFetchSpy,
  ): Promise<string> => {
    const data: unknown = (await forwarded(spy))["data"];

    expect(Buffer.isBuffer(data)).toBe(true);

    return (data as Buffer).toString("latin1");
  };

  test("forwards a signed JSON body as the bytes that came, spacing and all", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();
    const body: string = '{ "status" : "healthy",\n  "emoji": "\\u2705" }';

    const answer: Answer = await send({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OneUptime-Signature": `t=1,v1=${"0".repeat(64)}`,
      },
      body: body,
    });

    expect(answer.statusCode).toBe(200);
    expect(await forwardedBytes(spy)).toBe(body);
  });

  test("forwards a signed form body as the bytes that came, in their order", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();
    const body: string = "token=abc&team_id=T1&text=hello%20world&a=1";

    await send({
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Slack-Signature": `v0=${"0".repeat(64)}`,
        "X-Slack-Request-Timestamp": "1",
      },
      body: body,
    });

    expect(await forwardedBytes(spy)).toBe(body);
  });

  test("inflates a signed gzip JSON body, and forwards the bytes it held without Content-Encoding", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();
    const body: string = '{\n  "id": "evt_1",\n  "type": "invoice.paid"\n}';

    await send({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
        "Stripe-Signature": `t=1,v1=${"0".repeat(64)}`,
      },
      body: zlib.gzipSync(body),
    });

    const forward: Record<string, unknown> = await forwarded(spy);
    const headerNames: Array<string> = Object.keys(
      forward["headers"] as Headers,
    ).map((name: string): string => {
      return name.toLowerCase();
    });

    expect((forward["data"] as Buffer).toString("utf8")).toBe(body);
    expect(headerNames).not.toContain("content-encoding");
  });

  test("reads a signed body of a type it would otherwise leave empty, and forwards its bytes", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();
    const body: Buffer = Buffer.from([0, 1, 2, 254, 255]);

    const answer: Answer = await send({
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Hub-Signature-256": `sha256=${"0".repeat(64)}`,
      },
      body: body,
    });

    expect(answer.statusCode).toBe(200);
    expect(Buffer.from(await forwardedBytes(spy), "latin1").equals(body)).toBe(
      true,
    );
  });

  test("still forwards the JSON it parsed for a request that sends a secret instead", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    await send({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OneUptime-Secret": "one-of-the-project-secrets",
      },
      body: '{ "status" : "healthy" }',
    });

    expect((await forwarded(spy))["data"]).toEqual({ status: "healthy" });
  });

  test("forwards a HEAD request as a GET", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    const answer: Answer = await send({ method: "HEAD" });

    expect(answer.statusCode).toBe(200);
    expect(String((await forwarded(spy))["method"])).toMatch(/^get$/i);
  });

  test.each(["PUT", "PATCH", "DELETE"])(
    "answers %s with a 404 and forwards nothing",
    async (method: string) => {
      const spy: ApiFetchSpy = mockForwardSucceeds();

      const answer: Answer = await send({ method: method });

      expect(answer.statusCode).toBe(404);
      expect(spy.mock.calls.length).toBe(0);
    },
  );

  test.each([
    "/heartbeat/super-secret-key",
    "/incoming-request/super-secret-key",
  ])(
    "forwards %s under the incoming-request-ingest prefix",
    async (path: string) => {
      const spy: ApiFetchSpy = mockForwardSucceeds();

      await send({ method: "GET", path: path });

      expect(String((await forwarded(spy))["url"])).toBe(
        "https://oneuptime.example.com/incoming-request-ingest/incoming-request/super-secret-key",
      );
    },
  );
});

describe("isRefusalNotWorthRetrying", () => {
  test("is true for a 4xx that would be refused again", () => {
    for (const status of [400, 401, 403, 404, 405, 413, 415, 422]) {
      expect(isRefusalNotWorthRetrying(status)).toBe(true);
    }
  });

  test("is false for a timeout, rate limiting, a 5xx or a success", () => {
    for (const status of [200, 204, 302, 408, 429, 500, 502, 503, 504]) {
      expect(isRefusalNotWorthRetrying(status)).toBe(false);
    }
  });
});

/*
 * What the probe forwards, read by the reader OneUptime's endpoint reads
 * with (WebhookRequestBody), reads exactly as the request sent to OneUptime
 * directly: a text as its text in the charset it named, JSON sent as text as
 * its JSON, a CloudEvent as its JSON (#8430, #8429).
 */
describe("a request relayed through the probe, as OneUptime reads it", () => {
  let listener: http.Server;
  let listenerPort: number = 0;
  let oneUptime: http.Server;
  let oneUptimePort: number = 0;

  interface Sent {
    headers: Record<string, string>;
    body: Buffer | string;
  }

  type PostFunction = (
    port: number,
    path: string,
    request: Sent,
  ) => Promise<string>;

  const post: PostFunction = (
    port: number,
    path: string,
    request: Sent,
  ): Promise<string> => {
    return new Promise(
      (resolve: (body: string) => void, reject: (err: Error) => void) => {
        const outgoing: http.ClientRequest = http.request(
          {
            host: "127.0.0.1",
            port: port,
            method: "POST",
            path: path,
            headers: request.headers,
          },
          (response: http.IncomingMessage) => {
            const chunks: Array<Buffer> = [];
            response.on("data", (chunk: Buffer) => {
              chunks.push(chunk);
            });
            response.on("end", () => {
              resolve(Buffer.concat(chunks).toString("utf8"));
            });
          },
        );
        outgoing.on("error", reject);
        outgoing.write(request.body);
        outgoing.end();
      },
    );
  };

  // What OneUptime's endpoint reads of a request: its body, as JSON.
  type ReadFunction = (request: Sent) => Promise<unknown>;

  const readDirectly: ReadFunction = async (
    request: Sent,
  ): Promise<unknown> => {
    return JSON.parse(
      await post(oneUptimePort, "/incoming-request/key", request),
    );
  };

  const readThroughProbe: ReadFunction = async (
    request: Sent,
  ): Promise<unknown> => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    await post(listenerPort, "/heartbeat/key", request);

    for (let i: number = 0; i < 200 && spy.mock.calls.length === 0; i++) {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 5);
      });
    }

    const forward: Record<string, unknown> = readForward(spy);
    const data: unknown = forward["data"];

    jest.restoreAllMocks();

    // As the forward sends it: bytes as they are, JSON stringified.
    return JSON.parse(
      await post(oneUptimePort, "/incoming-request/key", {
        headers: forward["headers"] as Record<string, string>,
        body: Buffer.isBuffer(data) ? data : JSON.stringify(data),
      }),
    );
  };

  beforeAll(async () => {
    listener = createIngressApp().listen(0, "127.0.0.1");
    await new Promise((resolve: (value: unknown) => void) => {
      listener.once("listening", resolve);
    });
    listenerPort = (listener.address() as AddressInfo).port;

    // OneUptime's endpoint, as StartServer and the route read a body.
    const app: ExpressApplication = createExpressApp();
    app.use(ExpressJson({ limit: "50mb" }));
    app.use(ExpressUrlEncoded({ extended: true, limit: "50mb" }));
    app.post(
      "/incoming-request/:secretkey",
      WebhookRequestBody.getReader("50mb"),
      (req: ExpressRequest, res: ExpressResponse) => {
        res.json(req.body);
      },
    );

    oneUptime = app.listen(0, "127.0.0.1");
    await new Promise((resolve: (value: unknown) => void) => {
      oneUptime.once("listening", resolve);
    });
    oneUptimePort = (oneUptime.address() as AddressInfo).port;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await new Promise((resolve: (value: unknown) => void) => {
      listener.close(resolve);
    });
    await new Promise((resolve: (value: unknown) => void) => {
      oneUptime.close(resolve);
    });
  });

  test.each([
    [
      "plain text",
      {
        headers: { "content-type": "text/plain" },
        body: "backup failed: error 42",
      },
      "backup failed: error 42",
    ],
    [
      "text in another charset",
      {
        headers: { "content-type": "text/plain; charset=iso-8859-1" },
        body: Buffer.from("café: sauvegarde échouée", "latin1"),
      },
      "café: sauvegarde échouée",
    ],
    [
      "JSON sent as text/plain, as Amazon SNS sends it",
      {
        headers: { "content-type": "text/plain; charset=UTF-8" },
        body: JSON.stringify({ Type: "Notification", Message: "ALARM" }),
      },
      { Type: "Notification", Message: "ALARM" },
    ],
    [
      "a CloudEvent, as Azure Event Grid delivers it",
      {
        headers: {
          "content-type": "application/cloudevents+json; charset=utf-8",
        },
        body: JSON.stringify({ specversion: "1.0", id: "1", type: "a.b" }),
      },
      { specversion: "1.0", id: "1", type: "a.b" },
    ],
    [
      "JSON",
      {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "healthy" }),
      },
      { status: "healthy" },
    ],
  ])(
    "%s reads the same as when sent directly",
    async (_label: string, request: Sent, expected: unknown) => {
      expect(await readDirectly(request)).toEqual(expected);
      expect(await readThroughProbe(request)).toEqual(expected);
    },
  );
});

/*
 * A signed request relayed through the probe is checked by OneUptime as it
 * would have been sent directly (#8500). The endpoint below reads a body as
 * StartServer and the incoming request route do - the JSON and form parsers
 * keeping the text that came, then the route's text and signed body readers
 * - and checks the signature with the project's secret, as the ingest
 * endpoint does.
 */
describe("a signed request relayed through the probe, as OneUptime checks it", () => {
  const SECRET: string = "a-project-secret-the-sender-signs-with";
  const SECRET_ID: string = "the-project-secret";
  const NOW_SECONDS: number = 1_800_000_000;

  let listener: http.Server;
  let listenerPort: number = 0;
  let oneUptime: http.Server;
  let oneUptimePort: number = 0;

  interface Sent {
    headers: Record<string, string>;
    body: Buffer | string;
  }

  type PostFunction = (
    port: number,
    path: string,
    request: Sent,
  ) => Promise<string>;

  const post: PostFunction = (
    port: number,
    path: string,
    request: Sent,
  ): Promise<string> => {
    return new Promise(
      (resolve: (body: string) => void, reject: (err: Error) => void) => {
        const outgoing: http.ClientRequest = http.request(
          {
            host: "127.0.0.1",
            port: port,
            method: "POST",
            path: path,
            headers: request.headers,
          },
          (response: http.IncomingMessage) => {
            const chunks: Array<Buffer> = [];
            response.on("data", (chunk: Buffer) => {
              chunks.push(chunk);
            });
            response.on("end", () => {
              resolve(Buffer.concat(chunks).toString("utf8"));
            });
          },
        );
        outgoing.on("error", reject);
        outgoing.write(request.body);
        outgoing.end();
      },
    );
  };

  // Which secret OneUptime finds made the request's signature, or null.
  type CheckFunction = (request: Sent) => Promise<string | null>;

  const checkDirectly: CheckFunction = async (
    request: Sent,
  ): Promise<string | null> => {
    return (
      JSON.parse(
        await post(oneUptimePort, "/incoming-request/key", request),
      ) as {
        matched: string | null;
      }
    ).matched;
  };

  const checkThroughProbe: CheckFunction = async (
    request: Sent,
  ): Promise<string | null> => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    await post(listenerPort, "/heartbeat/key", request);

    for (let i: number = 0; i < 200 && spy.mock.calls.length === 0; i++) {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 5);
      });
    }

    const forward: Record<string, unknown> = readForward(spy);
    const data: unknown = forward["data"];

    jest.restoreAllMocks();

    // As the forward sends it: bytes as they are, JSON stringified.
    return await checkDirectly({
      headers: forward["headers"] as Record<string, string>,
      body: Buffer.isBuffer(data) ? data : JSON.stringify(data),
    });
  };

  // A request as its sender makes it: the body, signed with the secret.
  type SignedFunction = (data: {
    scheme: IncomingRequestSignatureScheme;
    contentType: string;
    body: Buffer | string;
    signedBody?: Buffer | string;
  }) => Sent;

  const signed: SignedFunction = (data: {
    scheme: IncomingRequestSignatureScheme;
    contentType: string;
    body: Buffer | string;
    signedBody?: Buffer | string;
  }): Sent => {
    const format: IncomingRequestSignatureFormat =
      IncomingRequestSignature.formatOf(data.scheme);
    const headers: Record<string, string> = {
      "content-type": data.contentType,
      [format.header]: IncomingRequestSignature.sign({
        scheme: data.scheme,
        secret: SECRET,
        body: data.signedBody ?? data.body,
        timestampSeconds: NOW_SECONDS,
      }),
    };

    if (format.timestampHeader) {
      headers[format.timestampHeader] = String(NOW_SECONDS);
    }

    return { headers: headers, body: data.body };
  };

  beforeAll(async () => {
    listener = createIngressApp().listen(0, "127.0.0.1");
    await new Promise((resolve: (value: unknown) => void) => {
      listener.once("listening", resolve);
    });
    listenerPort = (listener.address() as AddressInfo).port;

    const keepText: (
      req: ExpressRequest,
      res: ExpressResponse,
      buf: Buffer,
    ) => void = (
      req: ExpressRequest,
      _res: ExpressResponse,
      buf: Buffer,
    ): void => {
      (req as OneUptimeRequest).rawBody = buf.toString();
    };

    const app: ExpressApplication = createExpressApp();
    app.use(ExpressJson({ limit: "50mb", verify: keepText }));
    app.use(
      ExpressUrlEncoded({ extended: true, limit: "50mb", verify: keepText }),
    );
    app.post(
      "/incoming-request/:secretkey",
      WebhookRequestBody.getReader("50mb"),
      WebhookRequestBody.getSignedBodyReader(
        "50mb",
        (req: ExpressRequest): boolean => {
          return (
            IncomingRequestSignature.readPresentedSignatures(
              req.headers as Dictionary<string | Array<string> | undefined>,
            ).length > 0
          );
        },
      ),
      (req: ExpressRequest, res: ExpressResponse) => {
        res.json({
          matched:
            IncomingRequestSignature.verify({
              signatures: IncomingRequestSignature.readPresentedSignatures(
                req.headers as Dictionary<string | Array<string> | undefined>,
              ),
              body: IncomingRequestSignature.getSignedBodyOf(
                req as OneUptimeRequest,
              ),
              secrets: [{ secretId: SECRET_ID, value: SECRET }],
              now: new Date(NOW_SECONDS * 1000),
            }).matchedSecretId ?? null,
        });
      },
    );

    oneUptime = app.listen(0, "127.0.0.1");
    await new Promise((resolve: (value: unknown) => void) => {
      oneUptime.once("listening", resolve);
    });
    oneUptimePort = (oneUptime.address() as AddressInfo).port;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await new Promise((resolve: (value: unknown) => void) => {
      listener.close(resolve);
    });
    await new Promise((resolve: (value: unknown) => void) => {
      oneUptime.close(resolve);
    });
  });

  test.each([
    [
      "JSON from your own code, with its own spacing",
      IncomingRequestSignatureScheme.OneUptime,
      "application/json",
      '{ "status" : "healthy",\n  "version": "1.2.3" }',
    ],
    [
      "a GitHub delivery as JSON, with an escaped character",
      IncomingRequestSignatureScheme.GitHub,
      "application/json",
      '{"zen":"Keep it logically awesome.","emoji":"\\u2705","hook_id":1}',
    ],
    [
      "a GitHub delivery as a form",
      IncomingRequestSignatureScheme.GitHub,
      "application/x-www-form-urlencoded",
      "payload=%7B%22zen%22%3A%22Keep%20it%20logically%20awesome.%22%7D",
    ],
    [
      "a Slack slash command",
      IncomingRequestSignatureScheme.Slack,
      "application/x-www-form-urlencoded",
      "token=gIkuvaNzQIHg97ATvDxqgjtO&team_id=T0001&text=94070",
    ],
    [
      "a Stripe event, as Stripe indents it",
      IncomingRequestSignatureScheme.Stripe,
      "application/json; charset=utf-8",
      '{\n  "id": "evt_1",\n  "type": "invoice.paid"\n}',
    ],
    [
      "JSON sent as text/plain, as Amazon SNS sends it",
      IncomingRequestSignatureScheme.OneUptime,
      "text/plain; charset=UTF-8",
      '{"Type": "Notification", "Message": "ALARM"}',
    ],
    [
      "a body of a type the monitor gets empty",
      IncomingRequestSignatureScheme.OneUptime,
      "application/octet-stream",
      Buffer.from([0, 1, 2, 254, 255]),
    ],
    [
      "an empty body",
      IncomingRequestSignatureScheme.OneUptime,
      "application/json",
      "",
    ],
  ])(
    "%s is accepted through the probe as it is when sent directly",
    async (
      _label: string,
      scheme: IncomingRequestSignatureScheme,
      contentType: string,
      body: Buffer | string,
    ) => {
      const request: Sent = signed({ scheme, contentType, body });

      expect(await checkDirectly(request)).toBe(SECRET_ID);
      expect(await checkThroughProbe(request)).toBe(SECRET_ID);
    },
  );

  test("a signature over another body is refused through the probe, as it is directly", async () => {
    const request: Sent = signed({
      scheme: IncomingRequestSignatureScheme.OneUptime,
      contentType: "application/json",
      body: '{"status":"offline"}',
      signedBody: '{"status":"healthy"}',
    });

    expect(await checkDirectly(request)).toBeNull();
    expect(await checkThroughProbe(request)).toBeNull();
  });
});
