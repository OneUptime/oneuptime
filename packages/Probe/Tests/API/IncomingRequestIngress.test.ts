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
import ingressRouter from "../../API/IncomingRequestIngress";

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
