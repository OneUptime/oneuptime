// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";
// Keep the backoff arithmetic honest but the suite fast.
process.env["PROBE_INGRESS_FORWARD_RETRY_LIMIT"] = "2";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Headers from "Common/Types/API/Headers";
import { JSONObject } from "Common/Types/JSON";
import Sleep from "Common/Types/Sleep";
import API from "Common/Utils/API";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import ingressRouter, {
  createIngressApp,
  getForwardUrl,
  INGRESS_BODY_LIMIT,
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
}) => Promise<{ captured: CapturedResponse; nextError: unknown }>;

const callIngress: CallIngressFunction = async (data?: {
  path?: string;
  method?: string;
  params?: Record<string, string>;
  headers?: Record<string, string | Array<string> | undefined>;
  body?: unknown;
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
   * A device that posts text/plain is not a device to reject. Wrapping the
   * text under a known key keeps it addressable by an incoming-request
   * criterion instead of arriving as an unparseable body.
   */
  test("wraps a plain-text body under _raw", async () => {
    const spy: ApiFetchSpy = mockForwardSucceeds();

    await callIngress({ body: "backup finished" });
    await flush();

    expect(readForward(spy)["data"]).toEqual({ _raw: "backup finished" });
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
   * OneUptime reads only JSON and form bodies, so any other body reaches the
   * monitor empty. The listener used to read application/octet-stream too,
   * under express.raw's 100 KB default: a larger one was answered 413, not
   * the 200 a device is promised, and was never forwarded at all.
   */
  test.each([
    ["application/octet-stream", 200 * 1024],
    ["text/plain", 200 * 1024],
    ["application/octet-stream", 16],
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
