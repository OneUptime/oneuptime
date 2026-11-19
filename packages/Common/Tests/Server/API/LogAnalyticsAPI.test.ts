import CommonAPI from "../../../Server/API/CommonAPI";
import LogAggregationService, {
  AnalyticsRequest,
} from "../../../Server/Services/LogAggregationService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
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
 * POST /telemetry/logs/analytics - Logs → Analytics (#7716).
 *
 * The route takes the sum, average, minimum, maximum and percentiles of a
 * numeric attribute beside a count and a unique count, and hands each to
 * LogAggregationService with the field it reads. These pin what it takes,
 * what it refuses before any read, and how it reads its bucket size and its
 * limit - whole numbers in range, as the trace analytics read theirs. The
 * route harness mirrors LogHistogramAPI.test.ts: the guard chain runs for
 * real, the aggregation is spied on. TelemetryRoutesReadScope.test.ts holds
 * the same reads to the caller's read scope.
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

const ANALYTICS_ROUTE: string = "/telemetry/logs/analytics";

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

interface CallResult {
  json: JSONObject | undefined;
  error: unknown;
}

/*
 * Runs the route's middleware chain from index 1 (index 0 only populates
 * the session fields the fixtures set directly), and says what it answered:
 * its JSON, or the error it answered with or handed on.
 */
async function callAnalytics(data: {
  request: JSONObject;
  body: JSONObject;
}): Promise<CallResult> {
  const route: RecordedRoute = findRoute(ANALYTICS_ROUTE);

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

  let handedOn: unknown = undefined;

  for (let index: number = 1; index < route.handlers.length; index++) {
    const handler: RouterFunction | undefined = route.handlers[index];

    if (!handler) {
      break;
    }

    const step: { calledNext: boolean; error: unknown } = {
      calledNext: false,
      error: undefined,
    };

    const next: NextFunction = ((error?: unknown): void => {
      step.calledNext = true;
      step.error = error;
    }) as unknown as NextFunction;

    await handler(req, res, next);

    if (step.error) {
      handedOn = step.error;
      break;
    }

    if (!step.calledNext) {
      break;
    }
  }

  const jsonCall: Array<unknown> | undefined = (
    Response.sendJsonObjectResponse as unknown as jest.Mock
  ).mock.calls[0] as Array<unknown> | undefined;
  const errorCall: Array<unknown> | undefined = (
    Response.sendErrorResponse as unknown as jest.Mock
  ).mock.calls[0] as Array<unknown> | undefined;

  return {
    json: jsonCall ? (jsonCall[2] as JSONObject) : undefined,
    error: errorCall ? errorCall[2] : handedOn,
  };
}

function buildViewer(
  projectId: ObjectID,
  userId: ObjectID,
): {
  request: JSONObject;
  databaseProps: DatabaseCommonInteractionProps;
} {
  // isBlockPermission must be an explicit false; see LogErrorPatternAPI.test.ts.
  const userPermissions: Array<UserPermission> = [
    Permission.ProjectMember,
    Permission.TelemetryViewer,
  ].map((permission: Permission): UserPermission => {
    return {
      _type: "UserPermission",
      permission: permission,
      labelIds: [],
      isBlockPermission: false,
    };
  });

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[projectId.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: userPermissions,
  };

  return {
    request: {
      userType: UserType.User,
      tenantId: projectId,
      userTenantAccessPermission: permissionMap,
      userAuthorization: { userId: userId },
    } as unknown as JSONObject,
    databaseProps: {
      tenantId: projectId,
      userId: userId,
      userType: UserType.User,
      userTenantAccessPermission: permissionMap,
    },
  };
}

interface AnalyticsSpy {
  mock: { calls: Array<Array<unknown>> };
  mockResolvedValue: (value: Array<unknown>) => unknown;
}

const HOUR: JSONObject = {
  startTime: "2026-11-19T09:00:00.000Z",
  endTime: "2026-11-19T10:00:00.000Z",
};

const NUMERIC_AGGREGATIONS: Array<string> = [
  "sum",
  "avg",
  "p50",
  "p90",
  "p95",
  "p99",
  "min",
  "max",
];

describe("POST /telemetry/logs/analytics", () => {
  let timeseries: AnalyticsSpy;
  let topList: AnalyticsSpy;
  let table: AnalyticsSpy;
  let viewer: JSONObject;

  beforeAll(() => {
    recordedRoutes.length = 0;
    /*
     * Loaded lazily: TelemetryAPI calls Express.getRouter() at module scope,
     * and a static import would run the mock factory before
     * `telemetryRouter` is initialised.
     */
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../../../Server/API/TelemetryAPI");
  });

  beforeEach(() => {
    jest.clearAllMocks();

    const principal: {
      request: JSONObject;
      databaseProps: DatabaseCommonInteractionProps;
    } = buildViewer(ObjectID.generate(), ObjectID.generate());

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(principal.databaseProps);

    viewer = principal.request;

    timeseries = jest.spyOn(
      LogAggregationService,
      "getAnalyticsTimeseries" as never,
    ) as unknown as AnalyticsSpy;
    timeseries.mockResolvedValue([
      {
        time: "2026-11-19 09:00:00",
        count: 182.25,
        groupValues: { primaryEntityId: "a" },
      },
    ]);

    topList = jest.spyOn(
      LogAggregationService,
      "getAnalyticsTopList" as never,
    ) as unknown as AnalyticsSpy;
    topList.mockResolvedValue([{ value: "/checkout", count: 1250.75 }]);

    table = jest.spyOn(
      LogAggregationService,
      "getAnalyticsTable" as never,
    ) as unknown as AnalyticsSpy;
    table.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function readRequest(spy: AnalyticsSpy): AnalyticsRequest {
    return spy.mock.calls[0]?.[0] as AnalyticsRequest;
  }

  test.each(NUMERIC_AGGREGATIONS)(
    "hands a %s of an attribute to the read, with the attribute it reads",
    async (aggregation: string) => {
      const result: CallResult = await callAnalytics({
        request: viewer,
        body: {
          ...HOUR,
          chartType: "timeseries",
          aggregation,
          aggregationField: "duration_ms",
          groupBy: ["primaryEntityId"],
        },
      });

      expect(result.error).toBeUndefined();
      expect(readRequest(timeseries)).toMatchObject({
        chartType: "timeseries",
        aggregation,
        aggregationField: "duration_ms",
        groupBy: ["primaryEntityId"],
      });
      expect(result.json?.["data"]).toEqual([
        {
          time: "2026-11-19 09:00:00",
          count: 182.25,
          groupValues: { primaryEntityId: "a" },
        },
      ]);
    },
  );

  test("a top list of an average answers its values", async () => {
    const result: CallResult = await callAnalytics({
      request: viewer,
      body: {
        ...HOUR,
        chartType: "toplist",
        aggregation: "avg",
        aggregationField: "bytes",
        groupBy: ["http.route"],
      },
    });

    expect(readRequest(topList)).toMatchObject({
      chartType: "toplist",
      aggregation: "avg",
      aggregationField: "bytes",
    });
    expect(result.json?.["data"]).toEqual([
      { value: "/checkout", count: 1250.75 },
    ]);
  });

  test.each(NUMERIC_AGGREGATIONS)(
    "refuses a %s without the attribute it reads, before any read",
    async (aggregation: string) => {
      for (const aggregationField of [undefined, "", null]) {
        jest.clearAllMocks();

        const result: CallResult = await callAnalytics({
          request: viewer,
          body: {
            ...HOUR,
            chartType: "timeseries",
            aggregation,
            ...(aggregationField === undefined ? {} : { aggregationField }),
          },
        });

        expect(result.error).toBeInstanceOf(BadDataException);
        expect((result.error as Error).message).toBe(
          "A sum, an average, a minimum, a maximum or a percentile reads a numeric log attribute. Set aggregationField to its key, such as duration_ms.",
        );
        expect(timeseries.mock.calls).toHaveLength(0);
      }
    },
  );

  test("refuses an aggregation it does not know", async () => {
    for (const aggregation of ["median", "P95", "p75", "toString"]) {
      jest.clearAllMocks();

      const result: CallResult = await callAnalytics({
        request: viewer,
        body: { ...HOUR, aggregation, aggregationField: "duration_ms" },
      });

      expect(result.error).toBeInstanceOf(BadDataException);
      expect(timeseries.mock.calls).toHaveLength(0);
    }
  });

  test("a count and a unique count still read without a numeric attribute", async () => {
    await callAnalytics({ request: viewer, body: { ...HOUR } });

    expect(readRequest(timeseries)).toMatchObject({ aggregation: "count" });

    jest.clearAllMocks();

    await callAnalytics({
      request: viewer,
      body: { ...HOUR, aggregation: "unique", aggregationField: "user.id" },
    });

    expect(readRequest(timeseries)).toMatchObject({
      aggregation: "unique",
      aggregationField: "user.id",
    });
  });

  describe("the bucket size", () => {
    test.each([
      [15, 15],
      ["15", 15],
      [2.7, 2],
      [1, 1],
    ])(
      "reads %p as %p whole minutes",
      async (requested: number | string, expected: number) => {
        await callAnalytics({
          request: viewer,
          body: { ...HOUR, bucketSizeInMinutes: requested },
        });

        expect(readRequest(timeseries).bucketSizeInMinutes).toBe(expected);
      },
    );

    test.each([[0], [-5], [0.5], ["abc"], [null], [{}]])(
      "reads %p as the window's own bucket size, never an interval ClickHouse refuses",
      async (requested: unknown) => {
        await callAnalytics({
          request: viewer,
          body: { ...HOUR, bucketSizeInMinutes: requested as JSONObject },
        });

        // An hour's window is bucketed by the minute.
        expect(readRequest(timeseries).bucketSizeInMinutes).toBe(1);
      },
    );
  });

  describe("the limit", () => {
    test.each([
      [25, 25],
      ["25", 25],
      [10.9, 10],
      [-3, 1],
      [0, 1],
      [1000000000, 1000],
    ])(
      "reads %p as %p",
      async (requested: number | string, expected: number) => {
        await callAnalytics({
          request: viewer,
          body: {
            ...HOUR,
            chartType: "table",
            groupBy: ["severityText"],
            limit: requested,
          },
        });

        expect(readRequest(table).limit).toBe(expected);
      },
    );

    test.each([[undefined], [null], [""], ["abc"]])(
      "reads %p as no limit, so the read keeps its own",
      async (requested: unknown) => {
        await callAnalytics({
          request: viewer,
          body: {
            ...HOUR,
            chartType: "table",
            groupBy: ["severityText"],
            ...(requested === undefined
              ? {}
              : { limit: requested as JSONObject }),
          },
        });

        expect(readRequest(table).limit).toBeUndefined();
      },
    );
  });
});
