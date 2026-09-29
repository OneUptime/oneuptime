import CommonAPI from "../../../Server/API/CommonAPI";
import LogAggregationService, {
  HistogramRequest,
} from "../../../Server/Services/LogAggregationService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
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
 * POST /telemetry/logs/histogram - the Log Volume chart above the logs list.
 *
 * Issue #3914: a bucket comes back labelled with its START only, so a click
 * on one bar could only ever zoom from that start to the same start - a
 * window zero seconds wide that holds no logs. The response now says how
 * wide the buckets are; these pin that it is the width the query really
 * used. The route harness mirrors LogErrorPatternAPI.test.ts: the guard
 * chain runs for real, the aggregation is spied on.
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

const HISTOGRAM_ROUTE: string = "/telemetry/logs/histogram";

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

/*
 * Runs the route's middleware chain from index 1 (index 0 only populates
 * the session fields the fixtures set directly) and returns the JSON body
 * the handler answered with.
 */
async function callHistogram(data: {
  request: JSONObject;
  body: JSONObject;
}): Promise<JSONObject | undefined> {
  const route: RecordedRoute = findRoute(HISTOGRAM_ROUTE);

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
      throw step.error;
    }

    if (!step.calledNext) {
      break;
    }
  }

  const sendJsonObjectResponse: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  const jsonCall: Array<unknown> | undefined = sendJsonObjectResponse.mock
    .calls[0] as Array<unknown> | undefined;

  return jsonCall ? (jsonCall[2] as JSONObject) : undefined;
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

describe("POST /telemetry/logs/histogram", () => {
  interface HistogramSpy {
    mock: { calls: Array<Array<unknown>> };
    mockResolvedValue: (value: Array<unknown>) => unknown;
  }

  let histogram: HistogramSpy;
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

    histogram = jest.spyOn(
      LogAggregationService,
      "getHistogram" as never,
    ) as unknown as HistogramSpy;
    histogram.mockResolvedValue([
      { time: "2026-09-17 10:15:00", severity: "Error", count: 4 },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function queriedBucketSize(): number {
    const request: HistogramRequest = histogram.mock
      .calls[0]?.[0] as HistogramRequest;

    return request.bucketSizeInMinutes;
  }

  test("still answers with the buckets", async () => {
    const body: JSONObject | undefined = await callHistogram({
      request: viewer,
      body: {
        startTime: "2026-09-17T10:00:00.000Z",
        endTime: "2026-09-17T11:00:00.000Z",
      },
    });

    expect(body?.["buckets"]).toEqual([
      { time: "2026-09-17 10:15:00", severity: "Error", count: 4 },
    ]);
  });

  test.each([
    ["one hour", "2026-09-17T10:00:00.000Z", "2026-09-17T11:00:00.000Z", 1],
    ["six hours", "2026-09-17T05:00:00.000Z", "2026-09-17T11:00:00.000Z", 5],
    ["one day", "2026-09-16T11:00:00.000Z", "2026-09-17T11:00:00.000Z", 15],
    ["one week", "2026-09-10T11:00:00.000Z", "2026-09-17T11:00:00.000Z", 60],
  ])(
    "reports the bucket width it used for %s",
    async (
      _label: string,
      startTime: string,
      endTime: string,
      size: number,
    ) => {
      const body: JSONObject | undefined = await callHistogram({
        request: viewer,
        body: { startTime: startTime, endTime: endTime },
      });

      expect(body?.["bucketSizeInMinutes"]).toBe(size);
      expect(queriedBucketSize()).toBe(size);
    },
  );

  /*
   * A zoom into one 1-minute bar asks for a one-minute window, which must
   * still be bucketed by the minute rather than fall through to something
   * coarser.
   */
  test("reports one minute for a window one bar wide", async () => {
    const body: JSONObject | undefined = await callHistogram({
      request: viewer,
      body: {
        startTime: "2026-09-17T10:15:00.000Z",
        endTime: "2026-09-17T10:16:00.000Z",
      },
    });

    expect(body?.["bucketSizeInMinutes"]).toBe(1);
  });

  test("reports the bucket width a caller asked for", async () => {
    const body: JSONObject | undefined = await callHistogram({
      request: viewer,
      body: {
        startTime: "2026-09-17T10:00:00.000Z",
        endTime: "2026-09-17T11:00:00.000Z",
        bucketSizeInMinutes: 10,
      },
    });

    expect(body?.["bucketSizeInMinutes"]).toBe(10);
    expect(queriedBucketSize()).toBe(10);
  });

  /*
   * The default window is "the past hour". It used to read the clock twice,
   * once per edge; when the two readings straddled a millisecond the window
   * came out 60m + 1ms long and was bucketed by five minutes instead of one.
   * A clock that ticks on every read makes that straddle certain.
   */
  test("buckets the default one-hour window by the minute even when the clock ticks between reads", async () => {
    let tick: number = Date.parse("2026-09-17T11:00:00.000Z");

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(tick++);
    });

    const body: JSONObject | undefined = await callHistogram({
      request: viewer,
      body: {},
    });

    const request: HistogramRequest = histogram.mock
      .calls[0]?.[0] as HistogramRequest;

    expect(request.endTime.getTime() - request.startTime.getTime()).toBe(
      60 * 60 * 1000,
    );
    expect(body?.["bucketSizeInMinutes"]).toBe(1);
  });
});
