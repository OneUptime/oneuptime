import TelemetryAttributeService from "../../../Server/Services/TelemetryAttributeService";
import ProjectService from "../../../Server/Services/ProjectService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Dictionary from "../../../Types/Dictionary";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
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
 * ---------------------------------------------------------------------------
 * /telemetry/security-events/get-attributes[-values]
 * ---------------------------------------------------------------------------
 *
 * These back the "Add Attribute Column" search on the security events table:
 * the keys inside an event's `attributes` map differ per event class and per
 * source, so the UI has to ask which ones exist.
 *
 * They do not go through BaseAnalyticsAPI, so nothing downstream re-checks
 * authorization - the tenantId arrives in a caller-controlled header and
 * UserMiddleware lets tokenless requests through as Public. The guard on the
 * route IS the access control, and it has to stay exactly as permissive as
 * the SecurityEvent model's own read list, no more. That parity is the main
 * thing pinned here.
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

const KEYS_ROUTE: string = "/telemetry/security-events/get-attributes";
const VALUES_ROUTE: string = "/telemetry/security-events/get-attribute-values";

type FindRouteFunction = (uri: string) => RecordedRoute;

const findRoute: FindRouteFunction = (uri: string): RecordedRoute => {
  const route: RecordedRoute | undefined = recordedRoutes.find(
    (candidate: RecordedRoute): boolean => {
      return candidate.method === "POST" && candidate.uri === uri;
    },
  );

  if (!route) {
    throw new Error(`Route not registered: ${uri}`);
  }

  return route;
};

type CallResult = {
  deniedWith: Exception | undefined;
  thrownToNext: unknown;
  reachedHandler: boolean;
  jsonBody: JSONObject | undefined;
};

/*
 * Runs a recorded route's middleware chain for real, starting at
 * requireUserAuthentication. Index 0 is getUserMiddleware, whose only job is
 * to populate the session fields these fixtures set directly - running it
 * would need a live session store and prove nothing about authorization.
 */
type CallRouteFunction = (data: {
  uri: string;
  request: JSONObject;
  body: JSONObject;
}) => Promise<CallResult>;

const callRoute: CallRouteFunction = async (data: {
  uri: string;
  request: JSONObject;
  body: JSONObject;
}): Promise<CallResult> => {
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
};

type BuildPrincipalFunction = (data: {
  projectId: ObjectID;
  userId: ObjectID;
  permissions: Array<Permission>;
}) => JSONObject;

const buildPrincipal: BuildPrincipalFunction = (data: {
  projectId: ObjectID;
  userId: ObjectID;
  permissions: Array<Permission>;
}): JSONObject => {
  /*
   * isBlockPermission must be an explicit false: getUserPermissions filters
   * tenant permissions with a strict `=== false`, so undefined would silently
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
    userType: UserType.User,
    tenantId: data.projectId,
    userTenantAccessPermission: permissionMap,
    userAuthorization: { userId: data.userId },
  } as unknown as JSONObject;
};

describe("Security event attribute API", () => {
  let projectId: ObjectID;
  let userId: ObjectID;

  interface ServiceSpy {
    mock: { calls: Array<Array<unknown>> };
    mockResolvedValue: (value: Array<string>) => unknown;
    mockRejectedValue: (value: unknown) => unknown;
  }

  let fetchAttributes: ServiceSpy;
  let fetchAttributeValues: ServiceSpy;

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

    /*
     * CI runs the Common suite with BILLING_ENABLED=true (see test-setup.sh),
     * so getDatabaseCommonInteractionProps resolves the caller's plan through
     * ProjectService.getCurrentPlan. These fixtures use a project that never
     * exists in the database, so the real lookup throws "Project ID is invalid"
     * and the handler's error path swallows the request before it ever reaches
     * the attribute service. Billing is orthogonal to what this file pins, so
     * stub the plan lookup to a benign value and let the rest run for real.
     */
    jest
      .spyOn(ProjectService, "getCurrentPlan")
      .mockResolvedValue({ plan: null, isSubscriptionUnpaid: false });

    fetchAttributes = jest.spyOn(
      TelemetryAttributeService,
      "fetchAttributes" as never,
    ) as unknown as ServiceSpy;
    fetchAttributes.mockResolvedValue([]);

    fetchAttributeValues = jest.spyOn(
      TelemetryAttributeService,
      "fetchAttributeValues" as never,
    ) as unknown as ServiceSpy;
    fetchAttributeValues.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("route registration", () => {
    test("both routes exist as POST", () => {
      expect(findRoute(KEYS_ROUTE).uri).toBe(KEYS_ROUTE);
      expect(findRoute(VALUES_ROUTE).uri).toBe(VALUES_ROUTE);
    });

    /*
     * getUserMiddleware, requireUserAuthentication, requirePermission, then
     * the handler. A route registered without the guard chain would still
     * "work" for the UI and be wide open.
     */
    test("both routes carry a guard chain in front of the handler", () => {
      expect(findRoute(KEYS_ROUTE).handlers.length).toBe(4);
      expect(findRoute(VALUES_ROUTE).handlers.length).toBe(4);
    });
  });

  describe("access control", () => {
    test("an unauthenticated caller is refused", async () => {
      const result: CallResult = await callRoute({
        uri: KEYS_ROUTE,
        request: { userType: UserType.Public, tenantId: projectId },
        body: {},
      });

      expect(result.reachedHandler).toBe(false);
      expect(result.deniedWith).toBeDefined();
      expect(fetchAttributes.mock.calls).toHaveLength(0);
    });

    test("a project member without any security read permission is refused", async () => {
      const result: CallResult = await callRoute({
        uri: KEYS_ROUTE,
        request: buildPrincipal({
          projectId,
          userId,
          permissions: [Permission.ReadProject],
        }),
        body: {},
      });

      expect(result.reachedHandler).toBe(false);
      expect(result.deniedWith).toBeDefined();
      expect(fetchAttributes.mock.calls).toHaveLength(0);
    });

    test("ReadSecurityEvent alone is enough", async () => {
      const result: CallResult = await callRoute({
        uri: KEYS_ROUTE,
        request: buildPrincipal({
          projectId,
          userId,
          permissions: [Permission.ReadSecurityEvent],
        }),
        body: {},
      });

      expect(result.reachedHandler).toBe(true);
      expect(result.deniedWith).toBeUndefined();
    });

    /*
     * The guard has to mirror the model's table-level read list exactly, or
     * these routes end up either stricter or looser than the CRUD API for the
     * same rows. Every permission the model grants a read to is exercised.
     */
    test.each([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.SecurityViewer,
      Permission.ReadSecurityEvent,
    ])("%s can read attribute keys", async (permission: Permission) => {
      const result: CallResult = await callRoute({
        uri: KEYS_ROUTE,
        request: buildPrincipal({
          projectId,
          userId,
          permissions: [permission],
        }),
        body: {},
      });

      expect(result.reachedHandler).toBe(true);
    });

    /*
     * These routes do not go through BaseAnalyticsAPI, so this guard IS the
     * access control - and until the Security tiers landed it was built from
     * createTelemetryReadAccessGuard, which admits ProjectMember, the
     * project-wide Viewer and the Telemetry tiers. Leaving it that way would
     * have made the split cosmetic: the CRUD API would refuse a Telemetry Admin
     * the rows while this route handed them every attribute key in the SIEM and
     * every value ever seen for it - usernames, hostnames, source IPs. That is
     * most of what the table holds, reached without reading a single row.
     */
    test.each([
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.MonitorAdmin,
    ])("%s cannot read attribute keys", async (permission: Permission) => {
      const result: CallResult = await callRoute({
        uri: KEYS_ROUTE,
        request: buildPrincipal({
          projectId,
          userId,
          permissions: [permission],
        }),
        body: {},
      });

      expect(result.reachedHandler).toBe(false);
      expect(result.deniedWith).toBeDefined();
      expect(fetchAttributes.mock.calls).toHaveLength(0);
    });

    test.each([Permission.TelemetryAdmin, Permission.ProjectMember])(
      "%s cannot read attribute values either",
      async (permission: Permission) => {
        const result: CallResult = await callRoute({
          uri: VALUES_ROUTE,
          request: buildPrincipal({
            projectId,
            userId,
            permissions: [permission],
          }),
          body: { attributeKey: "device.hostname" },
        });

        expect(result.reachedHandler).toBe(false);
        expect(result.deniedWith).toBeDefined();
        expect(fetchAttributeValues.mock.calls).toHaveLength(0);
      },
    );

    /*
     * Parity with the model, asserted both ways round: every permission the
     * route accepts is one the model would accept for the same rows, and the
     * counts match so neither list can grow a member the other does not have.
     */
    test("the model's read list and the guard have not drifted apart", () => {
      const modelReadPermissions: Array<Permission> =
        new SecurityEvent().getReadPermissions();

      expect(modelReadPermissions).toEqual(
        expect.arrayContaining([
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.SecurityAdmin,
          Permission.SecurityMember,
          Permission.SecurityViewer,
          Permission.ReadSecurityEvent,
        ]),
      );
      expect(modelReadPermissions).toHaveLength(6);

      /*
       * And the roles the split exists to exclude are not hiding in the model
       * list either - the route parity above would happily hold with both
       * lists wrong in the same way.
       */
      for (const permission of [
        Permission.ProjectMember,
        Permission.ProjectUser,
        Permission.Viewer,
        Permission.TelemetryAdmin,
        Permission.TelemetryMember,
        Permission.TelemetryViewer,
      ]) {
        expect(modelReadPermissions).not.toContain(permission);
      }
    });

    test("the values route is guarded the same way", async () => {
      const result: CallResult = await callRoute({
        uri: VALUES_ROUTE,
        request: { userType: UserType.Public, tenantId: projectId },
        body: { attributeKey: "device.hostname" },
      });

      expect(result.reachedHandler).toBe(false);
      expect(result.deniedWith).toBeDefined();
    });
  });

  describe("attribute keys", () => {
    type CallKeysFunction = (body?: JSONObject) => Promise<CallResult>;

    const callKeys: CallKeysFunction = (
      body: JSONObject = {},
    ): Promise<CallResult> => {
      return callRoute({
        uri: KEYS_ROUTE,
        request: buildPrincipal({
          projectId,
          userId,
          permissions: [Permission.ReadSecurityEvent],
        }),
        body: body,
      });
    };

    /*
     * The whole point of the new source: asking for Log attributes here would
     * return the wrong project's-worth of keys from the wrong table, and look
     * entirely plausible in the picker.
     */
    test("asks the attribute service for SECURITY EVENT attributes", async () => {
      await callKeys();

      expect(fetchAttributes.mock.calls[0]![0]).toMatchObject({
        telemetryType: TelemetryType.SecurityEvent,
      });
    });

    test("scopes the lookup to the caller's project", async () => {
      await callKeys();

      const request: JSONObject = fetchAttributes.mock
        .calls[0]![0] as JSONObject;

      expect((request["projectId"] as ObjectID).toString()).toBe(
        projectId.toString(),
      );
    });

    test("returns the keys under an `attributes` field", async () => {
      fetchAttributes.mockResolvedValue(["class_uid", "device.hostname"]);

      const result: CallResult = await callKeys();

      expect(result.jsonBody).toEqual({
        attributes: ["class_uid", "device.hostname"],
      });
    });

    test("no keys is an empty list, not an error", async () => {
      const result: CallResult = await callKeys();

      expect(result.jsonBody).toEqual({ attributes: [] });
    });

    test("a service failure goes to the error handler rather than a 200", async () => {
      fetchAttributes.mockRejectedValue(new Error("clickhouse said no"));

      const result: CallResult = await callKeys();

      expect(result.thrownToNext).toBeDefined();
      expect(result.jsonBody).toBeUndefined();
    });
  });

  describe("attribute values", () => {
    type CallValuesFunction = (body: JSONObject) => Promise<CallResult>;

    const callValues: CallValuesFunction = (
      body: JSONObject,
    ): Promise<CallResult> => {
      return callRoute({
        uri: VALUES_ROUTE,
        request: buildPrincipal({
          projectId,
          userId,
          permissions: [Permission.ReadSecurityEvent],
        }),
        body: body,
      });
    };

    test("asks for SECURITY EVENT values for the requested key", async () => {
      await callValues({ attributeKey: "device.hostname" });

      expect(fetchAttributeValues.mock.calls[0]![0]).toMatchObject({
        telemetryType: TelemetryType.SecurityEvent,
        attributeKey: "device.hostname",
      });
    });

    test("passes the search text through so the narrowing happens server-side", async () => {
      await callValues({ attributeKey: "device.hostname", searchText: "web" });

      expect(fetchAttributeValues.mock.calls[0]![0]).toMatchObject({
        searchText: "web",
      });
    });

    test("a missing attribute key is a bad request, not an unbounded scan", async () => {
      const result: CallResult = await callValues({});

      expect(result.deniedWith).toBeDefined();
      expect(fetchAttributeValues.mock.calls).toHaveLength(0);
    });

    /*
     * The body is caller-controlled JSON, so a non-string is not a key.
     * Reading it as one would put a non-string into the SQL parameter.
     */
    test("a non-string attribute key is rejected", async () => {
      const result: CallResult = await callValues({ attributeKey: 42 });

      expect(result.deniedWith).toBeDefined();
      expect(fetchAttributeValues.mock.calls).toHaveLength(0);
    });

    test("returns the values under a `values` field", async () => {
      fetchAttributeValues.mockResolvedValue(["web-1", "web-2"]);

      const result: CallResult = await callValues({
        attributeKey: "device.hostname",
      });

      expect(result.jsonBody).toEqual({ values: ["web-1", "web-2"] });
    });
  });
});
