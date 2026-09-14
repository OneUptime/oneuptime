// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

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
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import metricsRouter from "../../API/Metrics";

/*
 * GET /queue-size is read by KEDA, and KEDA is the only consumer that will
 * ever see it. That single fact decides every assertion here: an autoscaler
 * does not interpret an error, it just stops scaling, so the endpoint's job is
 * to answer a NUMBER whenever it honestly can and to be loudly broken when it
 * cannot.
 *
 * The interesting cases are all about what the upstream ProbeIngest API is
 * allowed to say:
 *
 *   - a probe that has not registered yet has no id to ask about. Answering 0
 *     is what stops a cold start from erroring KEDA out on every poll during
 *     the seconds before registration completes.
 *
 *   - the count comes back over HTTP and JSON, so it can arrive as a string.
 *     Reading "7" as a number is the difference between scaling to seven
 *     workers and scaling to none.
 *
 *   - a count that is not a number at all must become 0, not NaN. NaN in a
 *     scaling metric is not a smaller number, it is an unusable one.
 *
 *   - a genuine upstream failure goes to next(err) rather than being smoothed
 *     into a 0, because a persistent 0 and a healthy empty queue are
 *     indistinguishable to KEDA, and silently never scaling up is exactly the
 *     failure an autoscaler exists to prevent.
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

type GetQueueSizeHandlerFunction = () => ExpressRouteHandler;

/*
 * Read off the router the module actually builds, so the path and the method
 * are under test too - a handler imported directly would keep passing after
 * the route was renamed out from under KEDA.
 */
const getQueueSizeHandler: GetQueueSizeHandlerFunction =
  (): ExpressRouteHandler => {
    const layers: Array<ExpressRouterLayer> = (
      metricsRouter as unknown as { stack: Array<ExpressRouterLayer> }
    ).stack;

    const route: ExpressRouterLayer["route"] | undefined = layers.find(
      (candidate: ExpressRouterLayer) => {
        return (
          candidate.route?.path === "/queue-size" &&
          candidate.route?.methods["get"] === true
        );
      },
    )?.route;

    if (!route) {
      throw new Error(
        "GET /queue-size is not registered on the metrics router",
      );
    }

    return route.stack[route.stack.length - 1]!.handle;
  };

interface CapturedResponse {
  body: JSONObject | null;
  statusCode: number | null;
}

type CallQueueSizeFunction = () => Promise<{
  captured: CapturedResponse;
  nextError: unknown;
}>;

const callQueueSize: CallQueueSizeFunction = async (): Promise<{
  captured: CapturedResponse;
  nextError: unknown;
}> => {
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

  await getQueueSizeHandler()(
    { headers: {}, body: {}, query: {}, params: {} },
    res,
    (err?: unknown): void => {
      nextError = err;
    },
  );

  return { captured: captured, nextError: nextError };
};

/*
 * jest.spyOn's inferred type for API.fetch (a generic method) does not line up
 * with jest.SpiedFunction under this TypeScript version, so the spy is held
 * through the small surface these tests actually use.
 */
interface ApiFetchSpy {
  mock: { calls: Array<Array<unknown>> };
}

type MockUpstreamCountFunction = (data: JSONObject) => void;

const mockUpstreamCount: MockUpstreamCountFunction = (
  data: JSONObject,
): void => {
  jest
    .spyOn(API, "fetch")
    .mockResolvedValue(new HTTPResponse<JSONObject>(200, data, {}) as never);
};

describe("GET /queue-size", () => {
  beforeEach(() => {
    LocalCache.setString("PROBE", "PROBE_ID", "probe-id-from-cache");
  });

  afterEach(() => {
    jest.restoreAllMocks();
    LocalCache.setString("PROBE", "PROBE_ID", "");
  });

  describe("a probe that has not registered yet", () => {
    test("answers 0 instead of erroring KEDA out during a cold start", async () => {
      LocalCache.setString("PROBE", "PROBE_ID", "");
      const originalProbeId: string | undefined = process.env["PROBE_ID"];
      delete process.env["PROBE_ID"];

      const fetchSpy: ApiFetchSpy = jest.spyOn(
        API,
        "fetch",
      ) as unknown as ApiFetchSpy;

      try {
        const result: { captured: CapturedResponse; nextError: unknown } =
          await callQueueSize();

        expect(result.captured.body).toEqual({ queueSize: 0 });
        expect(result.nextError).toBeUndefined();

        // And it does not go asking the control plane about a probe with no id.
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        if (originalProbeId) {
          process.env["PROBE_ID"] = originalProbeId;
        }
      }
    });

    test("falls back to the PROBE_ID environment variable when the cache is cold", async () => {
      LocalCache.setString("PROBE", "PROBE_ID", "");
      mockUpstreamCount({ count: 3 });

      const result: { captured: CapturedResponse; nextError: unknown } =
        await callQueueSize();

      expect(result.captured.body).toEqual({ queueSize: 3 });
    });
  });

  describe("the count the control plane reports", () => {
    test("passes a plain number through", async () => {
      mockUpstreamCount({ count: 42 });

      expect((await callQueueSize()).captured.body).toEqual({ queueSize: 42 });
    });

    test("reports an empty queue as 0", async () => {
      mockUpstreamCount({ count: 0 });

      expect((await callQueueSize()).captured.body).toEqual({ queueSize: 0 });
    });

    /*
     * The count crosses a JSON boundary, and a server that renders a bigint or
     * a formatted counter as a string is entirely within its rights. Reading
     * "7" as 0 would scale the deployment to nothing while seven monitors sat
     * unprobed.
     */
    test("parses a numeric string", async () => {
      mockUpstreamCount({ count: "7" });

      expect((await callQueueSize()).captured.body).toEqual({ queueSize: 7 });
    });

    test("parses a numeric string with surrounding whitespace", async () => {
      mockUpstreamCount({ count: " 12 " });

      expect((await callQueueSize()).captured.body).toEqual({ queueSize: 12 });
    });

    test("answers 0 rather than NaN for a string that is not a number", async () => {
      mockUpstreamCount({ count: "not-a-number" });

      const body: JSONObject | null = (await callQueueSize()).captured.body;

      expect(body).toEqual({ queueSize: 0 });
      expect(Number.isNaN(body?.["queueSize"])).toBe(false);
    });

    test("answers 0 when the upstream body carries no count at all", async () => {
      mockUpstreamCount({});

      expect((await callQueueSize()).captured.body).toEqual({ queueSize: 0 });
    });

    test("answers 0 when the count is null", async () => {
      mockUpstreamCount({ count: null });

      expect((await callQueueSize()).captured.body).toEqual({ queueSize: 0 });
    });

    test("never answers a NaN, whatever the upstream said", async () => {
      for (const count of ["", "abc", null, undefined, "NaN"]) {
        jest.restoreAllMocks();
        mockUpstreamCount({ count: count as never });

        const body: JSONObject | null = (await callQueueSize()).captured.body;

        expect(Number.isNaN(body?.["queueSize"])).toBe(false);
      }
    });
  });

  describe("when the control plane cannot be reached", () => {
    /*
     * Deliberately NOT smoothed into a 0. A persistent 0 is indistinguishable
     * from a healthy empty queue, so an endpoint that swallowed this would
     * leave the deployment scaled to nothing with every probe queue full and
     * nothing anywhere reporting a fault.
     */
    test("hands the failure to the error middleware rather than reporting 0", async () => {
      jest
        .spyOn(API, "fetch")
        .mockResolvedValue(
          new HTTPErrorResponse(500, { message: "upstream down" }, {}) as never,
        );

      const result: { captured: CapturedResponse; nextError: unknown } =
        await callQueueSize();

      expect(result.nextError).toBeDefined();
      expect(result.captured.body).toBeNull();
    });

    test("hands a thrown transport error to the error middleware too", async () => {
      jest
        .spyOn(API, "fetch")
        .mockRejectedValue(new Error("ECONNREFUSED") as never);

      const result: { captured: CapturedResponse; nextError: unknown } =
        await callQueueSize();

      expect(result.nextError).toBeDefined();
      expect(result.captured.body).toBeNull();
    });
  });

  describe("the request it makes to the control plane", () => {
    test("authenticates as this probe", async () => {
      const fetchSpy: ApiFetchSpy = jest
        .spyOn(API, "fetch")
        .mockResolvedValue(
          new HTTPResponse<JSONObject>(200, { count: 1 }, {}) as never,
        ) as unknown as ApiFetchSpy;

      await callQueueSize();

      const call: Record<string, unknown> = fetchSpy.mock
        .calls[0]![0] as unknown as Record<string, unknown>;
      const data: JSONObject = call["data"] as JSONObject;

      expect(data["probeKey"]).toBe("test-probe-key");
      expect(data["probeId"]).toBeTruthy();
    });

    test("asks the pending-count route, not some other endpoint", async () => {
      const fetchSpy: ApiFetchSpy = jest
        .spyOn(API, "fetch")
        .mockResolvedValue(
          new HTTPResponse<JSONObject>(200, { count: 1 }, {}) as never,
        ) as unknown as ApiFetchSpy;

      await callQueueSize();

      const call: Record<string, unknown> = fetchSpy.mock
        .calls[0]![0] as unknown as Record<string, unknown>;

      expect(String(call["url"])).toContain("/monitor/pending-count");
    });
  });
});
