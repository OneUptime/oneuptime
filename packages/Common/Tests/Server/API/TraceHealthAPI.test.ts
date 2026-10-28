import CommonAPI from "../../../Server/API/CommonAPI";
import TraceHealthService, {
  TraceHealthRequest,
} from "../../../Server/Services/TraceHealthService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { TRACE_HEALTH_MAX_WINDOW_MS } from "../../../Server/Utils/Telemetry/TraceHealth";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  TRACE_HEALTH_ROUTE,
  TraceHealthReport,
} from "../../../Types/Telemetry/TraceHealth";
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
 * POST /telemetry/traces/health - the "Trace health" card at the top of a
 * service's Traces page. The guard chain and the handler run for real; only
 * the read it ends in (TraceHealthService.getReport) is answered here. These
 * pin what the route accepts and what reaches the read: the service, the
 * window (the last hour by default, at most a day), and the span and log
 * filters of the caller's read scope. The harness mirrors
 * LogHistogramAPI.test.ts.
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

const PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();

const REPORT: TraceHealthReport = {
  startTime: "2026-10-27T10:00:00.000Z",
  endTime: "2026-10-27T11:00:00.000Z",
  samplePercent: 10,
  spanCount: 1200,
  traceCount: 300,
  orphanSpanShare: 0.01,
  singleSpanTraceShare: 0.2,
  logCount: 40,
  logsLinkedShare: 0.75,
  hints: [],
};

interface Principal {
  request: JSONObject;
  props: DatabaseCommonInteractionProps;
}

// A caller holding these permissions over the whole project.
function principalWith(permissions: Array<Permission>): Principal {
  // isBlockPermission must be an explicit false; see LogErrorPatternAPI.test.ts.
  const userPermissions: Array<UserPermission> = permissions.map(
    (permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    },
  );

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[PROJECT_ID.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: userPermissions,
  };

  return {
    request: {
      userType: UserType.User,
      tenantId: PROJECT_ID,
      userTenantAccessPermission: permissionMap,
      userAuthorization: { userId: USER_ID },
    } as unknown as JSONObject,
    props: {
      tenantId: PROJECT_ID,
      userId: USER_ID,
      userType: UserType.User,
      userTenantAccessPermission: permissionMap,
    },
  };
}

interface CallResult {
  json: JSONObject | undefined;
  thrownToNext: unknown;
  errorResponse: unknown;
}

/*
 * Runs the route's middleware chain from index 1 (index 0 only populates
 * the session fields the fixtures set directly).
 */
async function callHealth(data: {
  principal: Principal;
  body: JSONObject;
}): Promise<CallResult> {
  const route: RecordedRoute | undefined = recordedRoutes.find(
    (candidate: RecordedRoute): boolean => {
      return (
        candidate.method === "POST" && candidate.uri === TRACE_HEALTH_ROUTE
      );
    },
  );

  if (!route) {
    throw new Error(`Route not registered: ${TRACE_HEALTH_ROUTE}`);
  }

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(data.principal.props);

  const req: ExpressRequest = {
    ...data.principal.request,
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

  const outcome: CallResult = {
    json: undefined,
    thrownToNext: undefined,
    errorResponse: undefined,
  };

  for (let index: number = 1; index < route.handlers.length; index++) {
    const handler: RouterFunction | undefined = route.handlers[index];

    if (!handler) {
      break;
    }

    const step: { calledNext: boolean } = { calledNext: false };

    const next: NextFunction = ((error?: unknown): void => {
      step.calledNext = true;

      if (error) {
        outcome.thrownToNext = error;
      }
    }) as unknown as NextFunction;

    await handler(req, res, next);

    if (!step.calledNext || outcome.thrownToNext) {
      break;
    }
  }

  const jsonCall: Array<unknown> | undefined = (
    Response.sendJsonObjectResponse as unknown as jest.Mock
  ).mock.calls[0] as Array<unknown> | undefined;
  const errorCall: Array<unknown> | undefined = (
    Response.sendErrorResponse as unknown as jest.Mock
  ).mock.calls[0] as Array<unknown> | undefined;

  outcome.json = jsonCall ? (jsonCall[2] as JSONObject) : undefined;
  outcome.errorResponse = errorCall ? errorCall[2] : undefined;

  return outcome;
}

describe("POST /telemetry/traces/health", () => {
  interface ReportSpy {
    mock: { calls: Array<Array<unknown>> };
    mockResolvedValue: (value: TraceHealthReport) => unknown;
  }

  let getReport: ReportSpy;

  const VIEWER: Array<Permission> = [
    Permission.ProjectMember,
    Permission.TelemetryViewer,
  ];

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

    getReport = jest.spyOn(
      TraceHealthService,
      "getReport" as never,
    ) as unknown as ReportSpy;
    getReport.mockResolvedValue(REPORT);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function readRequest(): TraceHealthRequest {
    return getReport.mock.calls[0]![0] as TraceHealthRequest;
  }

  function ids(values: Array<ObjectID> | undefined): Array<string> {
    return (values || []).map((value: ObjectID): string => {
      return value.toString();
    });
  }

  test("is registered next to the trace histogram", () => {
    const uris: Array<string> = recordedRoutes.map(
      (route: RecordedRoute): string => {
        return route.uri;
      },
    );

    expect(uris.indexOf(TRACE_HEALTH_ROUTE)).toBe(
      uris.indexOf("/telemetry/traces/histogram") + 1,
    );
  });

  test("answers with the report the read made", async () => {
    const result: CallResult = await callHealth({
      principal: principalWith(VIEWER),
      body: { serviceId: SERVICE_ID.toString() },
    });

    expect(result.thrownToNext).toBeUndefined();
    expect(result.errorResponse).toBeUndefined();
    expect(result.json).toEqual(REPORT);
  });

  test("reads the service on the page, in the caller's project, under their span and log scope", async () => {
    await callHealth({
      principal: principalWith(VIEWER),
      body: { serviceId: SERVICE_ID.toString() },
    });

    const request: TraceHealthRequest = readRequest();

    expect(request.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(ids(request.spanFilter.serviceIds)).toEqual([SERVICE_ID.toString()]);
    expect(ids(request.logFilter?.serviceIds)).toEqual([SERVICE_ID.toString()]);
  });

  test("a caller who may read the traces but not the logs gets no log read", async () => {
    await callHealth({
      principal: principalWith([Permission.ReadTelemetryServiceTraces]),
      body: { serviceId: SERVICE_ID.toString() },
    });

    const request: TraceHealthRequest = readRequest();

    expect(ids(request.spanFilter.serviceIds)).toEqual([SERVICE_ID.toString()]);
    expect(request.logFilter).toBeNull();
  });

  test("is refused to a caller who may not read traces", async () => {
    const result: CallResult = await callHealth({
      principal: principalWith([Permission.ReadTelemetryServiceLog]),
      body: { serviceId: SERVICE_ID.toString() },
    });

    expect(result.errorResponse).toBeInstanceOf(NotAuthorizedException);
    expect(getReport.mock.calls).toHaveLength(0);
  });

  test("measures the last hour by default, from one reading of the clock", async () => {
    let tick: number = Date.parse("2026-10-27T11:00:00.000Z");

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(tick++);
    });

    await callHealth({
      principal: principalWith(VIEWER),
      body: { serviceId: SERVICE_ID.toString() },
    });

    const request: TraceHealthRequest = readRequest();

    expect(request.endTime.toISOString()).toBe("2026-10-27T11:00:00.000Z");
    expect(request.endTime.getTime() - request.startTime.getTime()).toBe(
      60 * 60 * 1000,
    );
  });

  test("measures the window the body names, cut to its last 24 hours", async () => {
    await callHealth({
      principal: principalWith(VIEWER),
      body: {
        serviceId: SERVICE_ID.toString(),
        startTime: "2026-10-20T00:00:00.000Z",
        endTime: "2026-10-27T00:00:00.000Z",
      },
    });

    const request: TraceHealthRequest = readRequest();

    expect(request.endTime.toISOString()).toBe("2026-10-27T00:00:00.000Z");
    expect(request.endTime.getTime() - request.startTime.getTime()).toBe(
      TRACE_HEALTH_MAX_WINDOW_MS,
    );
  });

  const REFUSED_BODIES: Array<[string, JSONObject]> = [
    ["no service", {}],
    ["a service that is not an id", { serviceId: "checkout" }],
    [
      "a start that is not a date",
      { serviceId: SERVICE_ID.toString(), startTime: "soon" },
    ],
    [
      "an end that is not a date",
      { serviceId: SERVICE_ID.toString(), endTime: 1761559200000 },
    ],
    [
      "a start after its end",
      {
        serviceId: SERVICE_ID.toString(),
        startTime: "2026-10-27T11:00:00.000Z",
        endTime: "2026-10-27T10:00:00.000Z",
      },
    ],
  ];

  test.each(REFUSED_BODIES)(
    "refuses %s before anything is read",
    async (_label: string, body: JSONObject) => {
      const result: CallResult = await callHealth({
        principal: principalWith(VIEWER),
        body: body,
      });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(result.json).toBeUndefined();
      expect(getReport.mock.calls).toHaveLength(0);
    },
  );

  test("refuses a request with no project", async () => {
    const principal: Principal = principalWith(VIEWER);

    const result: CallResult = await callHealth({
      principal: {
        request: principal.request,
        props: { ...principal.props, tenantId: undefined },
      },
      body: { serviceId: SERVICE_ID.toString() },
    });

    expect(result.errorResponse).toBeInstanceOf(BadDataException);
    expect((result.errorResponse as BadDataException).message).toBe(
      "Invalid Project ID",
    );
    expect(getReport.mock.calls).toHaveLength(0);
  });
});
