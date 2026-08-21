import CommonAPI from "../../../Server/API/CommonAPI";
import LogAggregationService, {
  ErrorPatternTimelineRequest,
  TopErrorPatternsRequest,
} from "../../../Server/Services/LogAggregationService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The two endpoints behind the Logs Insights page: the Top Errors list and
 * the correlation drill-down for one of its rows.
 *
 * What is worth pinning at this layer, rather than in the aggregation
 * suite, is everything that happens between an untrusted request body and
 * the service call: the read guard, the window defaults, the shapes a
 * browser can send for each field, and the promise that a correlation panel
 * degrades section by section instead of failing whole.
 */

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

type RecordedRoute = {
  method: string;
  uri: string;
  handlers: Array<RouterFunction>;
};

const recordedRoutes: Array<RecordedRoute> = [];

type RecordRouteFunction = (
  method: string,
) => (uri: string, ...handlers: Array<RouterFunction>) => void;

const recordRoute: RecordRouteFunction = (method: string) => {
  return (uri: string, ...handlers: Array<RouterFunction>): void => {
    recordedRoutes.push({
      method: method.toUpperCase(),
      uri: uri,
      handlers: handlers,
    });
  };
};

const telemetryRouter: JSONObject = {
  get: recordRoute("get"),
  post: recordRoute("post"),
  put: recordRoute("put"),
  delete: recordRoute("delete"),
} as unknown as JSONObject;

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return telemetryRouter;
    },
    getClientIp: () => {
      return "203.0.113.7";
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

const PATTERNS_ROUTE: string = "/telemetry/logs/error-patterns";
const CORRELATION_ROUTE: string = "/telemetry/logs/error-pattern-correlation";

function findRoute(uri: string): RecordedRoute {
  const route: RecordedRoute | undefined = recordedRoutes.find(
    (candidate: RecordedRoute): boolean => {
      return candidate.method === "POST" && candidate.uri === uri;
    },
  );

  if (!route) {
    throw new Error(`Route not registered: ${uri}`);
  }

  return route;
}

type CallResult = {
  /** Exception handed to Response.sendErrorResponse by a guard or handler. */
  deniedWith: Exception | undefined;
  /** Exception thrown out of the handler into express' error path. */
  thrownToNext: unknown;
  /** True when the final route handler was actually entered. */
  reachedHandler: boolean;
  jsonBody: JSONObject | undefined;
};

/*
 * Runs a recorded route's middleware chain for real, starting at
 * requireUserAuthentication. Index 0 is getUserMiddleware, whose only job
 * is to populate the session fields these fixtures set directly — running
 * it would need a live session store and prove nothing about
 * authorization.
 */
async function callRoute(data: {
  uri: string;
  request: JSONObject;
  body: JSONObject;
}): Promise<CallResult> {
  const route: RecordedRoute = findRoute(data.uri);

  const req: ExpressRequest = {
    ...data.request,
    body: data.body,
    params: {},
    query: {},
    headers: { "user-agent": "jest-agent" },
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    setHeader: (): void => {
      // no-op
    },
    send: (): void => {
      // no-op
    },
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as ExpressResponse;

  /*
   * Held in a const container rather than in loop-scoped `let`s so the
   * per-iteration `next` closures never capture a mutable outer binding.
   */
  const outcome: { thrownToNext: unknown; reachedHandler: boolean } = {
    thrownToNext: undefined,
    reachedHandler: false,
  };

  for (let index: number = 1; index < route.handlers.length; index++) {
    const handler: RouterFunction | undefined = route.handlers[index];

    if (!handler) {
      break;
    }

    if (index === route.handlers.length - 1) {
      outcome.reachedHandler = true;
    }

    const step: { calledNext: boolean } = { calledNext: false };

    const next: NextFunction = ((error?: unknown): void => {
      step.calledNext = true;

      if (error) {
        outcome.thrownToNext = error;
      }
    }) as unknown as NextFunction;

    await handler(req, res, next);

    // A guard that answered the request itself never calls next.
    if (!step.calledNext) {
      break;
    }
  }

  const sendErrorResponse: jest.Mock =
    Response.sendErrorResponse as unknown as jest.Mock;
  const sendJsonObjectResponse: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  const errorCall: Array<unknown> | undefined = sendErrorResponse.mock
    .calls[0] as Array<unknown> | undefined;
  const jsonCall: Array<unknown> | undefined = sendJsonObjectResponse.mock
    .calls[0] as Array<unknown> | undefined;

  return {
    deniedWith: errorCall ? (errorCall[2] as Exception) : undefined,
    thrownToNext: outcome.thrownToNext,
    reachedHandler: outcome.reachedHandler,
    jsonBody: jsonCall ? (jsonCall[2] as JSONObject) : undefined,
  };
}

function buildPrincipal(data: {
  projectId: ObjectID;
  userId: ObjectID;
  permissions: Array<Permission>;
}): {
  request: JSONObject;
  databaseProps: DatabaseCommonInteractionProps;
} {
  /*
   * isBlockPermission must be an explicit false:
   * DatabaseCommonInteractionPropsUtil.getUserPermissions filters tenant
   * permissions with a strict `=== false`, so an undefined would silently
   * drop every permission the fixture grants.
   */
  const userPermissions: Array<UserPermission> = data.permissions.map(
    (permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    },
  );

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: data.projectId,
    permissions: userPermissions,
  };

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[data.projectId.toString()] = tenantPermission;

  return {
    request: {
      userType: UserType.User,
      tenantId: data.projectId,
      userTenantAccessPermission: permissionMap,
      userAuthorization: { userId: data.userId },
    } as unknown as JSONObject,
    databaseProps: {
      tenantId: data.projectId,
      userId: data.userId,
      userType: UserType.User,
      userTenantAccessPermission: permissionMap,
    },
  };
}

describe("Log error pattern API", () => {
  let projectId: ObjectID;
  let userId: ObjectID;

  /*
   * A structural view of the spies rather than jest's own SpyInstance
   * alias. spyOn returns a type carrying the spied method's exact
   * signature, which neither assigns to the bare alias nor survives an
   * explicit generic instantiation across jest type versions — and every
   * assertion below only needs the three members named here.
   */
  interface AggregationSpy {
    mock: { calls: Array<Array<unknown>> };
    mockResolvedValue: (value: Array<unknown>) => unknown;
    mockRejectedValue: (value: unknown) => unknown;
  }

  function spyOnAggregation(
    method: keyof typeof LogAggregationService,
  ): AggregationSpy {
    const spy: AggregationSpy = jest.spyOn(
      LogAggregationService,
      method as never,
    ) as unknown as AggregationSpy;

    // Default every read to "no rows"; individual tests override.
    spy.mockResolvedValue([]);

    return spy;
  }

  function firstRequest(spy: AggregationSpy): JSONObject {
    return spy.mock.calls[0]?.[0] as JSONObject;
  }

  interface AggregationSpies {
    topErrors: AggregationSpy;
    timeline: AggregationSpy;
    coOccurrence: AggregationSpy;
    attributes: AggregationSpy;
    resources: AggregationSpy;
    traces: AggregationSpy;
    samples: AggregationSpy;
  }

  let spies: AggregationSpies;

  beforeAll(() => {
    recordedRoutes.length = 0;
    /*
     * Loaded lazily rather than with a top-level import: TelemetryAPI calls
     * Express.getRouter() at module scope, so a static import would run the
     * mock factory before `telemetryRouter` is initialised and die in the
     * temporal dead zone.
     */
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../../../Server/API/TelemetryAPI");
  });

  beforeEach(() => {
    jest.clearAllMocks();

    projectId = ObjectID.generate();
    userId = ObjectID.generate();

    spies = {
      topErrors: spyOnAggregation("getTopErrorPatterns"),
      timeline: spyOnAggregation("getErrorPatternTimeline"),
      coOccurrence: spyOnAggregation("getErrorPatternCoOccurrences"),
      attributes: spyOnAggregation("getErrorPatternAttributes"),
      resources: spyOnAggregation("getErrorPatternResources"),
      traces: spyOnAggregation("getErrorPatternTraces"),
      samples: spyOnAggregation("getErrorPatternSamples"),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockProps(props: DatabaseCommonInteractionProps): void {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props);
  }

  function asViewer(): JSONObject {
    const principal: {
      request: JSONObject;
      databaseProps: DatabaseCommonInteractionProps;
    } = buildPrincipal({
      projectId,
      userId,
      permissions: [Permission.ProjectMember, Permission.TelemetryViewer],
    });

    mockProps(principal.databaseProps);

    return principal.request;
  }

  describe("route registration and access control", () => {
    test("both routes are registered as POST", () => {
      expect(findRoute(PATTERNS_ROUTE)).toBeDefined();
      expect(findRoute(CORRELATION_ROUTE)).toBeDefined();
    });

    test("both routes sit behind the same guard chain as the other log reads", () => {
      const patterns: RecordedRoute = findRoute(PATTERNS_ROUTE);
      const correlation: RecordedRoute = findRoute(CORRELATION_ROUTE);
      const histogram: RecordedRoute = findRoute("/telemetry/logs/histogram");

      /*
       * Compared against the existing histogram route rather than a
       * hardcoded count: these endpoints read the same table, so they must
       * be guarded by the same middleware, whatever that chain becomes.
       */
      expect(patterns.handlers.length).toBe(histogram.handlers.length);
      expect(correlation.handlers.length).toBe(histogram.handlers.length);

      for (
        let index: number = 0;
        index < histogram.handlers.length - 1;
        index++
      ) {
        expect(patterns.handlers[index]).toBe(histogram.handlers[index]);
        expect(correlation.handlers[index]).toBe(histogram.handlers[index]);
      }
    });

    test.each([PATTERNS_ROUTE, CORRELATION_ROUTE])(
      "%s denies a principal with no telemetry read permission",
      async (uri: string) => {
        const principal: {
          request: JSONObject;
          databaseProps: DatabaseCommonInteractionProps;
        } = buildPrincipal({
          projectId,
          userId,
          permissions: [Permission.CreateProjectApiKey],
        });

        mockProps(principal.databaseProps);

        const result: CallResult = await callRoute({
          uri,
          request: principal.request,
          body: { pattern: "boom" },
        });

        expect(result.reachedHandler).toBe(false);
        expect(result.deniedWith).toBeDefined();
        expect(spies.topErrors.mock.calls.length).toBe(0);
        expect(spies.timeline.mock.calls.length).toBe(0);
      },
    );

    test.each([PATTERNS_ROUTE, CORRELATION_ROUTE])(
      "%s refuses a session with no project",
      async (uri: string) => {
        const principal: {
          request: JSONObject;
          databaseProps: DatabaseCommonInteractionProps;
        } = buildPrincipal({
          projectId,
          userId,
          permissions: [Permission.ProjectMember, Permission.TelemetryViewer],
        });

        mockProps({
          ...principal.databaseProps,
          tenantId: undefined,
        } as DatabaseCommonInteractionProps);

        const result: CallResult = await callRoute({
          uri,
          request: principal.request,
          body: { pattern: "boom" },
        });

        expect(result.deniedWith?.message).toBe("Invalid Project ID");
        expect(spies.topErrors.mock.calls.length).toBe(0);
      },
    );
  });

  describe("POST /telemetry/logs/error-patterns", () => {
    test("defaults to a 24 hour window ending now", async () => {
      const before: number = Date.now();

      await callRoute({ uri: PATTERNS_ROUTE, request: asViewer(), body: {} });

      const request: TopErrorPatternsRequest = firstRequest(
        spies.topErrors,
      ) as unknown as TopErrorPatternsRequest;

      /*
       * A day, not the histogram's hour: "top errors" is a question about a
       * period long enough for a pattern to establish itself, and an hour
       * of a quiet service routinely has nothing in it.
       */
      const spanMs: number =
        request.endTime.getTime() - request.startTime.getTime();

      expect(spanMs).toBe(24 * 60 * 60 * 1000);
      expect(request.endTime.getTime()).toBeGreaterThanOrEqual(before);
      expect(request.projectId.toString()).toBe(projectId.toString());
    });

    test("an explicit window is used verbatim", async () => {
      await callRoute({
        uri: PATTERNS_ROUTE,
        request: asViewer(),
        body: {
          startTime: "2026-08-01T00:00:00.000Z",
          endTime: "2026-08-02T00:00:00.000Z",
        },
      });

      const request: TopErrorPatternsRequest = firstRequest(
        spies.topErrors,
      ) as unknown as TopErrorPatternsRequest;

      expect(request.startTime.toISOString()).toBe("2026-08-01T00:00:00.000Z");
      expect(request.endTime.toISOString()).toBe("2026-08-02T00:00:00.000Z");
    });

    test("a start time alone anchors its 24 hours to now", async () => {
      await callRoute({
        uri: PATTERNS_ROUTE,
        request: asViewer(),
        body: { startTime: "2026-08-01T00:00:00.000Z" },
      });

      const request: TopErrorPatternsRequest = firstRequest(
        spies.topErrors,
      ) as unknown as TopErrorPatternsRequest;

      expect(request.startTime.toISOString()).toBe("2026-08-01T00:00:00.000Z");
      expect(request.endTime.getTime()).toBeGreaterThan(
        new Date("2026-08-01T00:00:00.000Z").getTime(),
      );
    });

    test("threads scope fields through and maps service ids to ObjectIDs", async () => {
      const serviceId: ObjectID = ObjectID.generate();

      await callRoute({
        uri: PATTERNS_ROUTE,
        request: asViewer(),
        body: {
          serviceIds: [serviceId.toString()],
          severityTexts: ["Warning"],
          entityKeys: ["host-key-1"],
          traceIds: ["trace-1"],
          spanIds: ["span-1"],
          sessionIds: ["sess-1"],
          bodySearchText: "refused",
          attributes: { "host.name": "web-3" },
          limit: 7,
        },
      });

      const request: TopErrorPatternsRequest = firstRequest(
        spies.topErrors,
      ) as unknown as TopErrorPatternsRequest;

      expect(
        request.serviceIds?.map((id: ObjectID): string => {
          return id.toString();
        }),
      ).toEqual([serviceId.toString()]);
      expect(request.severityTexts).toEqual(["Warning"]);
      expect(request.entityKeys).toEqual(["host-key-1"]);
      expect(request.traceIds).toEqual(["trace-1"]);
      expect(request.spanIds).toEqual(["span-1"]);
      expect(request.sessionIds).toEqual(["sess-1"]);
      expect(request.bodySearchText).toBe("refused");
      expect(request.attributes).toEqual({ "host.name": "web-3" });
      expect(request.limit).toBe(7);
    });

    test("empty and malformed array fields become 'no filter', never an empty predicate", async () => {
      await callRoute({
        uri: PATTERNS_ROUTE,
        request: asViewer(),
        body: {
          serviceIds: [],
          severityTexts: [""],
          traceIds: "trace-1",
          spanIds: [42, null],
          sessionIds: null,
          bodySearchText: "   ",
          limit: "10",
        },
      });

      const request: TopErrorPatternsRequest = firstRequest(
        spies.topErrors,
      ) as unknown as TopErrorPatternsRequest;

      /*
       * Every one of these must be undefined. An empty array reaching
       * `IN ()` or a blank string reaching `ILIKE '%%'` would silently
       * change which logs the page describes.
       */
      expect(request.serviceIds).toBeUndefined();
      expect(request.severityTexts).toBeUndefined();
      expect(request.traceIds).toBeUndefined();
      expect(request.spanIds).toBeUndefined();
      expect(request.sessionIds).toBeUndefined();
      expect(request.bodySearchText).toBeUndefined();
      // A stringly-typed limit is not a limit.
      expect(request.limit).toBeUndefined();
    });

    test("returns the service's patterns under `patterns`", async () => {
      spies.topErrors.mockResolvedValue([
        {
          pattern: "connection refused to <ip>",
          sampleBody: "connection refused to 10.0.0.4",
          count: 30,
          firstSeenAt: "2026-08-19 03:00:00.000000000",
          lastSeenAt: "2026-08-20 22:14:02.000000000",
          resourceCount: 1,
          resourceIds: ["svc-a"],
          severities: ["Error"],
          traceCount: 2,
          sampleTraceIds: ["t1"],
        },
      ]);

      const result: CallResult = await callRoute({
        uri: PATTERNS_ROUTE,
        request: asViewer(),
        body: {},
      });

      expect(result.reachedHandler).toBe(true);
      expect(
        (result.jsonBody?.["patterns"] as Array<JSONObject>)[0]?.["count"],
      ).toBe(30);
    });

    test("a failing aggregation reaches the error handler rather than a half-empty page", async () => {
      spies.topErrors.mockRejectedValue(new Error("clickhouse is down"));

      const result: CallResult = await callRoute({
        uri: PATTERNS_ROUTE,
        request: asViewer(),
        body: {},
      });

      /*
       * Unlike the correlation panel's sections, the list IS the page —
       * showing "no errors" when the query failed would be a lie.
       */
      expect(result.thrownToNext).toBeInstanceOf(Error);
      expect(result.jsonBody).toBeUndefined();
    });
  });

  describe("POST /telemetry/logs/error-pattern-correlation", () => {
    test("requires a pattern", async () => {
      for (const body of [
        {},
        { pattern: "" },
        { pattern: "   " },
        { pattern: 7 },
      ]) {
        jest.clearAllMocks();

        const result: CallResult = await callRoute({
          uri: CORRELATION_ROUTE,
          request: asViewer(),
          body: body as JSONObject,
        });

        expect(result.deniedWith?.message).toBe("pattern is required");
        expect(spies.timeline.mock.calls.length).toBe(0);
      }
    });

    test("runs all six correlation reads against one identical request", async () => {
      const serviceId: ObjectID = ObjectID.generate();

      await callRoute({
        uri: CORRELATION_ROUTE,
        request: asViewer(),
        body: {
          pattern: "boom <num>",
          serviceIds: [serviceId.toString()],
          startTime: "2026-08-01T00:00:00.000Z",
          endTime: "2026-08-02T00:00:00.000Z",
        },
      });

      const detailSpies: Array<AggregationSpy> = [
        spies.timeline,
        spies.coOccurrence,
        spies.attributes,
        spies.resources,
        spies.traces,
        spies.samples,
      ];

      const requests: Array<ErrorPatternTimelineRequest> = detailSpies.map(
        (spy: AggregationSpy): ErrorPatternTimelineRequest => {
          expect(spy.mock.calls.length).toBe(1);
          return firstRequest(spy) as unknown as ErrorPatternTimelineRequest;
        },
      );

      /*
       * Every section must describe the same population. A drill-down that
       * saw a different window or a different service scope than its
       * siblings would draw correlations that do not exist.
       */
      for (const request of requests) {
        expect(request).toBe(requests[0]);
      }

      expect(requests[0]!.pattern).toBe("boom <num>");
      expect(requests[0]!.startTime.toISOString()).toBe(
        "2026-08-01T00:00:00.000Z",
      );
      expect(
        requests[0]!.serviceIds?.map((id: ObjectID): string => {
          return id.toString();
        }),
      ).toEqual([serviceId.toString()]);
    });

    test("derives a bucket size from the window when the client does not name one", async () => {
      await callRoute({
        uri: CORRELATION_ROUTE,
        request: asViewer(),
        body: {
          pattern: "boom",
          startTime: "2026-08-01T00:00:00.000Z",
          endTime: "2026-08-01T01:00:00.000Z",
        },
      });

      const request: ErrorPatternTimelineRequest = firstRequest(
        spies.timeline,
      ) as unknown as ErrorPatternTimelineRequest;

      // One hour of window buckets by the minute, as the histogram does.
      expect(request.bucketSizeInMinutes).toBe(1);
    });

    test("honours an explicit bucket size and rejects an unusable one", async () => {
      await callRoute({
        uri: CORRELATION_ROUTE,
        request: asViewer(),
        body: { pattern: "boom", bucketSizeInMinutes: 30 },
      });

      expect(
        (firstRequest(spies.timeline) as unknown as ErrorPatternTimelineRequest)
          .bucketSizeInMinutes,
      ).toBe(30);

      jest.clearAllMocks();

      await callRoute({
        uri: CORRELATION_ROUTE,
        request: asViewer(),
        body: { pattern: "boom", bucketSizeInMinutes: 0 },
      });

      /*
       * Zero would compile to `INTERVAL 0 SECOND`, which ClickHouse
       * rejects — fall back to the window-derived size instead.
       */
      expect(
        (firstRequest(spies.timeline) as unknown as ErrorPatternTimelineRequest)
          .bucketSizeInMinutes,
      ).toBeGreaterThan(0);
    });

    test("returns every section plus the pattern and bucket size it used", async () => {
      spies.timeline.mockResolvedValue([{ time: "t", count: 3 }]);
      spies.coOccurrence.mockResolvedValue([
        { pattern: "other", sampleBody: "other", count: 2 },
      ]);
      spies.attributes.mockResolvedValue([
        { key: "host.name", value: "web-3", count: 30 },
      ]);

      const result: CallResult = await callRoute({
        uri: CORRELATION_ROUTE,
        request: asViewer(),
        body: { pattern: "boom", bucketSizeInMinutes: 15 },
      });

      expect(result.jsonBody?.["pattern"]).toBe("boom");
      expect(result.jsonBody?.["bucketSizeInMinutes"]).toBe(15);
      expect(result.jsonBody?.["timeline"]).toHaveLength(1);
      expect(result.jsonBody?.["coOccurringPatterns"]).toHaveLength(1);
      expect(result.jsonBody?.["attributes"]).toHaveLength(1);
      expect(result.jsonBody?.["resources"]).toEqual([]);
      expect(result.jsonBody?.["traces"]).toEqual([]);
      expect(result.jsonBody?.["samples"]).toEqual([]);
    });

    test("one failing section degrades to empty without taking the panel down", async () => {
      /*
       * The correlation panel is supplementary information. A slow or
       * unlucky sub-query should cost the user that one section, not the
       * whole drill-down.
       */
      spies.coOccurrence.mockRejectedValue(new Error("timed out"));
      spies.timeline.mockResolvedValue([{ time: "t", count: 3 }]);

      const result: CallResult = await callRoute({
        uri: CORRELATION_ROUTE,
        request: asViewer(),
        body: { pattern: "boom" },
      });

      expect(result.thrownToNext).toBeUndefined();
      expect(result.jsonBody?.["coOccurringPatterns"]).toEqual([]);
      expect(result.jsonBody?.["timeline"]).toHaveLength(1);
    });

    test("every section failing still answers, with empty sections", async () => {
      spies.timeline.mockRejectedValue(new Error("clickhouse is down"));
      spies.coOccurrence.mockRejectedValue(new Error("clickhouse is down"));
      spies.attributes.mockRejectedValue(new Error("clickhouse is down"));
      spies.resources.mockRejectedValue(new Error("clickhouse is down"));
      spies.traces.mockRejectedValue(new Error("clickhouse is down"));
      spies.samples.mockRejectedValue(new Error("clickhouse is down"));

      const result: CallResult = await callRoute({
        uri: CORRELATION_ROUTE,
        request: asViewer(),
        body: { pattern: "boom" },
      });

      expect(result.thrownToNext).toBeUndefined();
      expect(result.jsonBody?.["timeline"]).toEqual([]);
      expect(result.jsonBody?.["samples"]).toEqual([]);
    });
  });
});
