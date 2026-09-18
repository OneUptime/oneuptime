import { afterEach, describe, expect, jest, test } from "@jest/globals";
import HttpMetricsMiddleware from "../../../Server/Middleware/HttpMetricsMiddleware";
import AppMetrics from "../../../Server/Utils/Telemetry/AppMetrics";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";

/*
 * Every HTTP request the server handles passes through here, so two things
 * about it are disproportionately important.
 *
 * THE IN-FLIGHT GAUGE MUST BALANCE. It is incremented on the way in and
 * decremented on the way out, and Express fires BOTH `finish` and `close` for
 * most responses. A recorder that ran twice would decrement twice, and because
 * the gauge is cumulative the drift never washes out - it accumulates for the
 * life of the process until "active requests" is a large negative number and
 * every dashboard and alert built on it is worthless. `recorded` is the latch
 * that prevents it, and nothing else checks that the latch works.
 *
 * THE ROUTE LABEL MUST STAY LOW-CARDINALITY. It is a metric dimension, so a
 * raw URL would mint a new time series per distinct path - one scan of
 * /admin/<random> is enough to blow up the metric store. Express only
 * populates req.route once something MATCHED, so the unmatched case (which is
 * exactly the scanning case) has to fall back to a constant.
 */

interface RecordedCall {
  value: number;
  attributes: Record<string, string | number>;
}

interface Recorder {
  counter: Array<RecordedCall>;
  duration: Array<RecordedCall>;
  inFlight: Array<RecordedCall>;
}

type InstallRecorderFunction = () => Recorder;

const installRecorder: InstallRecorderFunction = (): Recorder => {
  const recorder: Recorder = { counter: [], duration: [], inFlight: [] };

  jest.spyOn(AppMetrics, "getHttpRequestCounter").mockReturnValue({
    add: (value: number, attributes: Record<string, string | number>): void => {
      recorder.counter.push({ value: value, attributes: attributes });
    },
  } as never);

  jest.spyOn(AppMetrics, "getHttpRequestDuration").mockReturnValue({
    record: (
      value: number,
      attributes: Record<string, string | number>,
    ): void => {
      recorder.duration.push({ value: value, attributes: attributes });
    },
  } as never);

  jest.spyOn(AppMetrics, "getHttpRequestsInFlight").mockReturnValue({
    add: (value: number, attributes: Record<string, string | number>): void => {
      recorder.inFlight.push({ value: value, attributes: attributes });
    },
  } as never);

  return recorder;
};

interface FakeResponse {
  statusCode: number;
  listeners: Record<string, Array<() => void>>;
  emit: (event: string) => void;
}

type BuildResponseFunction = (statusCode: number) => FakeResponse;

const buildResponse: BuildResponseFunction = (
  statusCode: number,
): FakeResponse => {
  const listeners: Record<string, Array<() => void>> = {};

  return {
    statusCode: statusCode,
    listeners: listeners,
    emit: (event: string): void => {
      for (const listener of listeners[event] ?? []) {
        listener();
      }
    },
    on: (event: string, listener: () => void): void => {
      listeners[event] = listeners[event] ?? [];
      listeners[event]!.push(listener);
    },
  } as unknown as FakeResponse;
};

type RunFunction = (data: {
  method?: string | undefined;
  route?: { path?: string } | undefined;
  baseUrl?: string;
  statusCode?: number;
  emit?: Array<string>;
}) => { recorder: Recorder; nextCalled: number };

const run: RunFunction = (data: {
  method?: string | undefined;
  route?: { path?: string } | undefined;
  baseUrl?: string;
  statusCode?: number;
  emit?: Array<string>;
}): { recorder: Recorder; nextCalled: number } => {
  const recorder: Recorder = installRecorder();
  const res: FakeResponse = buildResponse(data.statusCode ?? 200);

  let nextCalled: number = 0;

  const req: Record<string, unknown> = {
    method: data.method,
    route: data.route,
    baseUrl: data.baseUrl,
  };

  HttpMetricsMiddleware(
    req as unknown as ExpressRequest,
    res as unknown as ExpressResponse,
    ((): void => {
      nextCalled++;
    }) as never,
  );

  for (const event of data.emit ?? ["finish"]) {
    res.emit(event);
  }

  return { recorder: recorder, nextCalled: nextCalled };
};

describe("the middleware stays out of the way of the request", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("calls next exactly once, immediately", () => {
    expect(run({ method: "GET" }).nextCalled).toBe(1);
  });

  test("counts the request as in flight before the handler runs", () => {
    const recorder: Recorder = installRecorder();
    const res: FakeResponse = buildResponse(200);

    HttpMetricsMiddleware(
      { method: "GET" } as unknown as ExpressRequest,
      res as unknown as ExpressResponse,
      ((): void => {}) as never,
    );

    // Nothing has finished yet, so the only entry is the increment.
    expect(recorder.inFlight).toEqual([
      { value: 1, attributes: { "http.request.method": "GET" } },
    ]);
    expect(recorder.counter).toEqual([]);
  });
});

describe("the in-flight gauge balances", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("adds one on the way in and takes one back on the way out", () => {
    const recorder: Recorder = run({ method: "GET" }).recorder;

    expect(
      recorder.inFlight.map((call: RecordedCall) => {
        return call.value;
      }),
    ).toEqual([1, -1]);
  });

  /*
   * Express fires both events for an ordinary response. Recording on each
   * would decrement twice, and because the gauge is cumulative that error
   * never washes out - it accumulates for the life of the process.
   */
  test("records once even though both finish and close fire", () => {
    const recorder: Recorder = run({
      method: "GET",
      emit: ["finish", "close"],
    }).recorder;

    expect(recorder.counter.length).toBe(1);
    expect(recorder.duration.length).toBe(1);
    expect(
      recorder.inFlight.reduce((total: number, call: RecordedCall) => {
        return total + call.value;
      }, 0),
    ).toBe(0);
  });

  test("records once when only close fires - a client that hung up", () => {
    const recorder: Recorder = run({ method: "GET", emit: ["close"] }).recorder;

    expect(recorder.counter.length).toBe(1);
    expect(
      recorder.inFlight.reduce((total: number, call: RecordedCall) => {
        return total + call.value;
      }, 0),
    ).toBe(0);
  });

  test("stays balanced however many times the events are re-emitted", () => {
    const recorder: Recorder = run({
      method: "GET",
      emit: ["finish", "close", "finish", "close"],
    }).recorder;

    expect(recorder.counter.length).toBe(1);
    expect(
      recorder.inFlight.reduce((total: number, call: RecordedCall) => {
        return total + call.value;
      }, 0),
    ).toBe(0);
  });
});

describe("the route label stays low-cardinality", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("uses the route TEMPLATE, never the resolved path", () => {
    const recorder: Recorder = run({
      method: "GET",
      route: { path: "/users/:id" },
    }).recorder;

    expect(recorder.counter[0]!.attributes["http.route"]).toBe("/users/:id");
  });

  test("prefixes the router's mount point so two routers do not collide", () => {
    const recorder: Recorder = run({
      method: "GET",
      route: { path: "/users/:id" },
      baseUrl: "/api",
    }).recorder;

    expect(recorder.counter[0]!.attributes["http.route"]).toBe(
      "/api/users/:id",
    );
  });

  /*
   * The unmatched case IS the scanning case. Labelling it with the raw URL
   * would mint one time series per probe - which is the fastest way to lose a
   * metric store to somebody else's port scanner.
   */
  test("labels an unmatched request with a constant, not its URL", () => {
    const recorder: Recorder = run({ method: "GET" }).recorder;

    expect(recorder.counter[0]!.attributes["http.route"]).toBe("unmatched");
  });

  test("labels a route object with no path as unmatched too", () => {
    const recorder: Recorder = run({ method: "GET", route: {} }).recorder;

    expect(recorder.counter[0]!.attributes["http.route"]).toBe("unmatched");
  });

  test("carries no high-cardinality identifiers at all", () => {
    const recorder: Recorder = run({
      method: "GET",
      route: { path: "/users/:id" },
    }).recorder;

    expect(Object.keys(recorder.counter[0]!.attributes).sort()).toEqual([
      "http.request.method",
      "http.response.status_code",
      "http.route",
      "status_class",
    ]);
  });
});

describe("the labels it records", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("upper-cases the method", () => {
    const recorder: Recorder = run({ method: "post" }).recorder;

    expect(recorder.counter[0]!.attributes["http.request.method"]).toBe("POST");
  });

  test("labels a request with no method as UNKNOWN rather than blank", () => {
    const recorder: Recorder = run({ method: undefined }).recorder;

    expect(recorder.counter[0]!.attributes["http.request.method"]).toBe(
      "UNKNOWN",
    );
  });

  test("records the exact status code alongside its class", () => {
    const recorder: Recorder = run({
      method: "GET",
      statusCode: 404,
    }).recorder;

    expect(recorder.counter[0]!.attributes["http.response.status_code"]).toBe(
      404,
    );
    expect(recorder.counter[0]!.attributes["status_class"]).toBe("4xx");
  });

  const STATUS_CLASSES: Array<[number, string]> = [
    [200, "2xx"],
    [201, "2xx"],
    [301, "3xx"],
    [400, "4xx"],
    [401, "4xx"],
    [500, "5xx"],
    [503, "5xx"],
    [100, "1xx"],
  ];

  test.each(STATUS_CLASSES)(
    "buckets %i as %s",
    (statusCode: number, expected: string) => {
      const recorder: Recorder = run({
        method: "GET",
        statusCode: statusCode,
      }).recorder;

      expect(recorder.counter[0]!.attributes["status_class"]).toBe(expected);
    },
  );

  /*
   * A response that was never given a status - a socket that died before
   * anything was written - must not produce a "0xx" bucket nobody can
   * interpret.
   */
  test("buckets a status that never got set as unknown", () => {
    const recorder: Recorder = run({ method: "GET", statusCode: 0 }).recorder;

    expect(recorder.counter[0]!.attributes["status_class"]).toBe("unknown");
  });

  test("buckets an out-of-range status as unknown", () => {
    const recorder: Recorder = run({ method: "GET", statusCode: 999 }).recorder;

    expect(recorder.counter[0]!.attributes["status_class"]).toBe("unknown");
  });

  test("the duration and the count carry identical labels", () => {
    const recorder: Recorder = run({
      method: "GET",
      route: { path: "/users/:id" },
      statusCode: 201,
    }).recorder;

    expect(recorder.duration[0]!.attributes).toEqual(
      recorder.counter[0]!.attributes,
    );
  });

  test("records a duration in milliseconds, not nanoseconds", () => {
    const recorder: Recorder = run({ method: "GET" }).recorder;
    const durationMs: number = recorder.duration[0]!.value;

    expect(durationMs).toBeGreaterThanOrEqual(0);
    // A synchronous test cannot plausibly take a second.
    expect(durationMs).toBeLessThan(1000);
  });

  test("the in-flight gauge is labelled by method only", () => {
    const recorder: Recorder = run({
      method: "GET",
      route: { path: "/users/:id" },
    }).recorder;

    for (const call of recorder.inFlight) {
      expect(Object.keys(call.attributes)).toEqual(["http.request.method"]);
    }
  });
});
