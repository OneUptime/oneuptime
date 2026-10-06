import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Metric from "../../../Models/AnalyticsModels/Metric";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  PermissionProps,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The /telemetry/metrics/* routes - a metric's attribute keys and values,
 * the metrics explorer's facets, and the metrics recorded with a trace - do
 * not go through BaseAnalyticsAPI, so their guard is the access control,
 * and it lets in exactly who the Metric model's own read list lets in:
 * the Telemetry Service Metrics permission or a role that reads telemetry.
 * The trace and log permissions, which the model's lists used to name, are
 * refused here as they are on the model.
 *
 * Only the guards run (requireUserAuthentication, requirePermission); the
 * handlers behind them are another suite's.
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

const METRIC_ROUTES: Array<string> = [
  "/telemetry/metrics/get-attributes",
  "/telemetry/metrics/get-attribute-values",
  "/telemetry/metrics/facets",
  "/telemetry/metrics/for-trace",
];

const GRANTABLE: Array<Permission> = PermissionHelper.getTenantPermissionProps()
  .map((props: PermissionProps) => {
    return props.permission;
  })
  .sort();

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

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

function requestWith(
  permissions: Array<Permission>,
  blocked: Array<Permission> = [],
): ExpressRequest {
  const row: (
    isBlockPermission: boolean,
  ) => (permission: Permission) => UserPermission = (
    isBlockPermission: boolean,
  ): ((permission: Permission) => UserPermission) => {
    return (permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: isBlockPermission,
      };
    };
  };

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: [...permissions.map(row(false)), ...blocked.map(row(true))],
  };

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[projectId.toString()] = tenantPermission;

  return {
    userType: UserType.User,
    tenantId: projectId,
    userTenantAccessPermission: permissionMap,
    userAuthorization: { userId: userId },
    body: {},
    params: {},
    query: {},
    headers: { "user-agent": "jest-agent" },
  } as unknown as ExpressRequest;
}

/*
 * Runs the route's guards - everything between getUserMiddleware (index 0,
 * which only fills in the session fields set here directly) and the
 * handler - and says whether the request got through them.
 */
async function passesGuards(
  uri: string,
  permissions: Array<Permission>,
  blocked: Array<Permission> = [],
): Promise<boolean> {
  const route: RecordedRoute = findRoute(uri);
  const req: ExpressRequest = requestWith(permissions, blocked);
  const res: ExpressResponse = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
  } as unknown as ExpressResponse;

  for (let index: number = 1; index < route.handlers.length - 1; index++) {
    const step: { calledNext: boolean; error: unknown } = {
      calledNext: false,
      error: undefined,
    };

    await route.handlers[index]!(req, res, ((error?: unknown): void => {
      step.calledNext = true;
      step.error = error;
    }) as unknown as NextFunction);

    if (!step.calledNext || step.error) {
      return false;
    }
  }

  return true;
}

describe("the metric routes read with the metric permissions", () => {
  beforeAll(() => {
    recordedRoutes.length = 0;
    /*
     * Loaded lazily: TelemetryAPI calls Express.getRouter() at module scope,
     * so a static import would run the mock factory before
     * `telemetryRouter` is initialised.
     */
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../../../Server/API/TelemetryAPI");
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each(METRIC_ROUTES)(
    "%s carries a guard chain in front of its handler",
    (uri: string) => {
      // getUserMiddleware, requireUserAuthentication, requirePermission, handler.
      expect(findRoute(uri).handlers.length).toBe(4);
    },
  );

  test.each(METRIC_ROUTES)(
    "%s lets in exactly who the Metric model's read list lets in",
    async (uri: string) => {
      const admitted: Array<Permission> = [];

      for (const permission of GRANTABLE) {
        if (await passesGuards(uri, [permission])) {
          admitted.push(permission);
        }
      }

      expect(admitted).toEqual([...new Metric().getReadPermissions()].sort());
      expect(admitted).toContain(Permission.ReadTelemetryServiceMetrics);
    },
  );

  test.each(METRIC_ROUTES)(
    "%s refuses the trace and log permissions, alone or together",
    async (uri: string) => {
      for (const permissions of [
        [Permission.ReadTelemetryServiceTraces],
        [Permission.ReadTelemetryServiceLog],
        [
          Permission.ReadTelemetryServiceTraces,
          Permission.ReadTelemetryServiceLog,
        ],
      ]) {
        expect([permissions, await passesGuards(uri, permissions)]).toEqual([
          permissions,
          false,
        ]);
      }

      expect(Response.sendErrorResponse).toHaveBeenCalled();
    },
  );

  /*
   * A block row names a permission in order to deny it. The metric
   * permission held only as a block - set on a team to keep it away from
   * metrics - opens none of these routes.
   */
  test.each(METRIC_ROUTES)(
    "%s is refused to the metric permission held only as a block",
    async (uri: string) => {
      expect(
        await passesGuards(uri, [], [Permission.ReadTelemetryServiceMetrics]),
      ).toBe(false);
      expect(
        await passesGuards(
          uri,
          [Permission.ReadTelemetryServiceLog],
          [Permission.ReadTelemetryServiceMetrics],
        ),
      ).toBe(false);
    },
  );

  test("a block next to an allow of the same permission leaves the allow standing", async () => {
    expect(
      await passesGuards(
        "/telemetry/metrics/get-attributes",
        [Permission.ReadTelemetryServiceMetrics],
        [Permission.ReadTelemetryServiceMetrics],
      ),
    ).toBe(true);
  });

  test("no route of the file counts a block row as holding its permission", async () => {
    expect(
      await passesGuards(
        "/telemetry/traces/get-attributes",
        [],
        [Permission.ReadTelemetryServiceTraces],
      ),
    ).toBe(false);
    expect(
      await passesGuards(
        "/telemetry/traces/get-attributes",
        [],
        [Permission.ProjectOwner],
      ),
    ).toBe(false);
  });

  test("the trace routes still read with the trace permission", async () => {
    expect(
      await passesGuards("/telemetry/traces/get-attributes", [
        Permission.ReadTelemetryServiceTraces,
      ]),
    ).toBe(true);
    expect(
      await passesGuards("/telemetry/traces/get-attributes", [
        Permission.ReadTelemetryServiceMetrics,
      ]),
    ).toBe(false);
  });
});
