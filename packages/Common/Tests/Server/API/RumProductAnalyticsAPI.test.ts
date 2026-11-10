import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import RumApplicationService from "../../../Server/Services/RumApplicationService";
import RumApplicationOwnerUserService from "../../../Server/Services/RumApplicationOwnerUserService";
import RumApplicationOwnerTeamService from "../../../Server/Services/RumApplicationOwnerTeamService";
import RumProductAnalyticsSessionService from "../../../Server/Services/RumProductAnalyticsSessionService";
import RumProductAnalyticsReadService from "../../../Server/Utils/RumProductAnalytics/RumProductAnalyticsReadService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import Label from "../../../Models/DatabaseModels/Label";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import {
  DEFAULT_PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS,
  DEFAULT_PRODUCT_ANALYTICS_PEOPLE_LIMIT,
  DEFAULT_PRODUCT_ANALYTICS_PERSON_SESSIONS_LIMIT,
  MAX_PRODUCT_ANALYTICS_OFFSET,
  MAX_PRODUCT_ANALYTICS_PEOPLE_LIMIT,
  MAX_PRODUCT_ANALYTICS_PERSON_SESSIONS_LIMIT,
  PRODUCT_ANALYTICS_BREAKDOWN_ROUTE,
  PRODUCT_ANALYTICS_DIMENSIONS,
  PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS_OPTIONS,
  PRODUCT_ANALYTICS_MAX_RANGE_DAYS,
  PRODUCT_ANALYTICS_PEOPLE_FILTERS,
  PRODUCT_ANALYTICS_PEOPLE_ROUTE,
  PRODUCT_ANALYTICS_PERSON_ROUTE,
  PRODUCT_ANALYTICS_SEARCH_MAX_LENGTH,
  PRODUCT_ANALYTICS_SUMMARY_ROUTE,
  PRODUCT_ANALYTICS_TREND_ROUTE,
  ProductAnalyticsDimension,
  ProductAnalyticsPeopleFilter,
} from "../../../Types/Rum/ProductAnalytics";
import {
  isTestBillingEnabled,
  setTestBillingEnabled,
} from "../Enterprise/TestBillingFlag";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * The five product analytics routes (issue #6444): who uses a RUM
 * application and how their sessions go.
 *
 * They read what the session list reads - who came, on what, for how long -
 * so each carries the list's guard, its plan gate and its label-scoped
 * application check, and names a signed-in user's reference only where the
 * list would. These tests run each route's middleware chain for real, with
 * ClickHouse answered in memory, and pin all of it: who is refused and how,
 * what every body value may be, and what reaches the read service.
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

const productAnalyticsRouter: JSONObject = {
  get: recordRoute("get"),
  post: recordRoute("post"),
  put: recordRoute("put"),
  delete: recordRoute("delete"),
} as unknown as JSONObject;

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return productAnalyticsRouter;
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

/* The plan gate reads IsBillingEnabled: a live switch, starting from the environment. */
jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  billingFlag.setTestBillingEnabled(actual["IsBillingEnabled"] === true);

  return billingFlag.withLiveBillingFlag(actual);
});

const LIST_ROUTE: string = "/telemetry/rum/session-replay/list";

const ALL_ROUTES: Array<string> = [
  PRODUCT_ANALYTICS_SUMMARY_ROUTE,
  PRODUCT_ANALYTICS_TREND_ROUTE,
  PRODUCT_ANALYTICS_BREAKDOWN_ROUTE,
  PRODUCT_ANALYTICS_PEOPLE_ROUTE,
  PRODUCT_ANALYTICS_PERSON_ROUTE,
];

const USER_KEY: string = "ab".repeat(32);
const VISITOR_ID: string = "0123456789abcdef0123456789abcdef";
const DAY_MS: number = 24 * 60 * 60 * 1000;

/* The smallest body each route takes, beside rumApplicationId. */
function minimalBody(uri: string): JSONObject {
  if (uri === PRODUCT_ANALYTICS_BREAKDOWN_ROUTE) {
    return { dimension: ProductAnalyticsDimension.DeviceType };
  }

  if (uri === PRODUCT_ANALYTICS_PERSON_ROUTE) {
    return { personKey: `u:${USER_KEY}` };
  }

  return {};
}

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
  /* Exception handed to Response.sendErrorResponse by a guard. */
  deniedWith: Exception | undefined;
  /* Exception the handler passed to express' error path. */
  thrownToNext: unknown;
  reachedHandler: boolean;
  jsonBody: JSONObject | undefined;
};

/*
 * Runs a route's chain from requireUserAuthentication on. Index 0,
 * getUserMiddleware, only loads the session into the fields the fixtures
 * set directly; its presence is asserted on its own.
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
    setHeader: jest.fn(),
    send: jest.fn(),
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

    if (!step.calledNext) {
      break;
    }
  }

  const errorCall: Array<unknown> | undefined = (
    Response.sendErrorResponse as unknown as jest.Mock
  ).mock.calls[0] as Array<unknown> | undefined;

  const jsonCall: Array<unknown> | undefined = (
    Response.sendJsonObjectResponse as unknown as jest.Mock
  ).mock.calls[0] as Array<unknown> | undefined;

  return {
    deniedWith: errorCall ? (errorCall[2] as Exception) : undefined,
    thrownToNext: outcome.thrownToNext,
    reachedHandler: outcome.reachedHandler,
    jsonBody: jsonCall ? (jsonCall[2] as JSONObject) : undefined,
  };
}

interface Principal {
  request: JSONObject;
  databaseProps: DatabaseCommonInteractionProps;
}

function buildPrincipal(data: {
  projectId: ObjectID;
  userId: ObjectID;
  permissions: Array<Permission>;
  labelIds?: Array<ObjectID> | undefined;
}): Principal {
  /* isBlockPermission must be an explicit false (see SessionReplayAPI.test.ts). */
  const userPermissions: Array<UserPermission> = data.permissions.map(
    (permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: data.labelIds || [],
        isBlockPermission: false,
      };
    },
  );

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[data.projectId.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: data.projectId,
    permissions: userPermissions,
  };

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

function fakeResultSet(rows: Array<JSONObject>): unknown {
  return {
    json: async (): Promise<JSONObject> => {
      return { data: rows } as unknown as JSONObject;
    },
  };
}

function queriesOf(spy: jest.SpyInstance): Array<Statement> {
  return spy.mock.calls.map((call: Array<unknown>): Statement => {
    return call[0] as Statement;
  });
}

describe("Product analytics API", () => {
  let projectId: ObjectID;
  let userId: ObjectID;
  let applicationAId: ObjectID;
  let applicationBId: ObjectID;
  let labelAId: ObjectID;
  let labelBId: ObjectID;

  let querySpy: jest.SpyInstance;
  let findOneBySpy: jest.SpyInstance;
  let findBySpy: jest.SpyInstance;

  beforeAll(() => {
    recordedRoutes.length = 0;
    /*
     * Loaded lazily: TelemetryAPI calls Express.getRouter() at module
     * scope, which would otherwise run the mock factory before the router
     * above exists.
     */
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../../../Server/API/TelemetryAPI");
  });

  beforeEach(() => {
    jest.clearAllMocks();

    projectId = ObjectID.generate();
    userId = ObjectID.generate();
    applicationAId = ObjectID.generate();
    applicationBId = ObjectID.generate();
    labelAId = ObjectID.generate();
    labelBId = ObjectID.generate();

    querySpy = jest
      .spyOn(RumProductAnalyticsSessionService, "executeQuery")
      .mockResolvedValue(fakeResultSet([]) as never);

    findOneBySpy = jest.spyOn(RumApplicationService, "findOneBy");
    findBySpy = jest.spyOn(RumApplicationService, "findBy");

    /* Nobody owns anything. */
    jest
      .spyOn(RumApplicationOwnerUserService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(RumApplicationOwnerTeamService, "findBy")
      .mockResolvedValue([] as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockProps(props: DatabaseCommonInteractionProps): void {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props);
  }

  function mockApplication(data: {
    id: ObjectID;
    labelIds: Array<ObjectID>;
  }): void {
    const application: RumApplication = new RumApplication();
    application.id = data.id;
    application.projectId = projectId;
    application.labels = data.labelIds.map((labelId: ObjectID): Label => {
      const label: Label = new Label();
      label.id = labelId;
      return label;
    });

    findOneBySpy.mockResolvedValue(application);
    findBySpy.mockImplementation(async (findBy: unknown) => {
      const labelFilter: unknown = (
        findBy as { query?: { labels?: unknown } } | undefined
      )?.query?.labels;

      if (Array.isArray(labelFilter)) {
        const wanted: Array<string> = labelFilter.map((id: unknown) => {
          return String(id);
        });

        return data.labelIds.some((labelId: ObjectID): boolean => {
          return wanted.includes(labelId.toString());
        })
          ? [application]
          : [];
      }

      return [application];
    });
  }

  function principalWith(
    permissions: Array<Permission>,
    labelIds?: Array<ObjectID>,
  ): Principal {
    const principal: Principal = buildPrincipal({
      projectId: projectId,
      userId: userId,
      permissions: permissions,
      labelIds: labelIds,
    });

    mockProps(principal.databaseProps);
    mockApplication({ id: applicationAId, labelIds: [] });

    return principal;
  }

  async function callAsOwner(
    uri: string,
    body: JSONObject,
  ): Promise<CallResult> {
    const principal: Principal = principalWith([Permission.ProjectOwner]);

    return await callRoute({
      uri: uri,
      request: principal.request,
      body: { rumApplicationId: applicationAId.toString(), ...body },
    });
  }

  /* What the handler handed the read service, from a spy on it. */
  function argumentOf(spy: jest.SpyInstance): Record<string, unknown> {
    expect(spy).toHaveBeenCalledTimes(1);
    return spy.mock.calls[0]![0] as Record<string, unknown>;
  }

  describe("registration", () => {
    test("the five routes are POSTs at the paths the Dashboard calls, behind the session list's own guard", () => {
      const listGuard: RouterFunction | undefined =
        findRoute(LIST_ROUTE).handlers[2];

      expect(listGuard).toBeDefined();

      expect(ALL_ROUTES).toEqual([
        "/telemetry/rum/product-analytics/summary",
        "/telemetry/rum/product-analytics/trend",
        "/telemetry/rum/product-analytics/breakdown",
        "/telemetry/rum/product-analytics/people",
        "/telemetry/rum/product-analytics/person",
      ]);

      for (const uri of ALL_ROUTES) {
        const route: RecordedRoute = findRoute(uri);

        expect(route.handlers).toHaveLength(4);
        expect(route.handlers[0]).toBe(UserMiddleware.getUserMiddleware);
        expect(route.handlers[1]).toBe(
          UserMiddleware.requireUserAuthentication,
        );
        expect(route.handlers[2]).toBe(listGuard);
      }
    });

    test("no other product analytics route is registered", () => {
      const registered: Array<string> = recordedRoutes
        .map((route: RecordedRoute): string => {
          return route.uri;
        })
        .filter((uri: string): boolean => {
          return uri.startsWith("/telemetry/rum/product-analytics/");
        });

      expect([...registered].sort()).toEqual([...ALL_ROUTES].sort());
    });
  });

  describe("who is refused", () => {
    test.each(ALL_ROUTES)(
      "%s asks a caller with no session to sign in, and reads nothing",
      async (uri: string) => {
        const result: CallResult = await callRoute({
          uri: uri,
          request: {
            userType: UserType.Public,
            tenantId: projectId,
          } as unknown as JSONObject,
          body: {
            rumApplicationId: applicationAId.toString(),
            ...minimalBody(uri),
          },
        });

        expect(result.deniedWith).toBeInstanceOf(NotAuthenticatedException);
        expect(result.reachedHandler).toBe(false);
        expect(querySpy).not.toHaveBeenCalled();
      },
    );

    test.each(ALL_ROUTES)(
      "%s refuses a Viewer and a project member: they may not list sessions",
      async (uri: string) => {
        for (const permission of [
          Permission.Viewer,
          Permission.ProjectMember,
        ]) {
          jest.clearAllMocks();

          const principal: Principal = principalWith([permission]);

          const result: CallResult = await callRoute({
            uri: uri,
            request: principal.request,
            body: {
              rumApplicationId: applicationAId.toString(),
              ...minimalBody(uri),
            },
          });

          expect(result.deniedWith).toBeInstanceOf(NotAuthorizedException);
          expect(result.reachedHandler).toBe(false);
          expect(querySpy).not.toHaveBeenCalled();
        }
      },
    );

    test.each(ALL_ROUTES)(
      "%s admits a session replay lister and a watcher",
      async (uri: string) => {
        for (const permission of [
          Permission.ReadRumSessionReplay,
          Permission.ReadRumSessionReplayPayload,
          Permission.TelemetryAdmin,
          Permission.ProjectAdmin,
        ]) {
          jest.clearAllMocks();

          const principal: Principal = principalWith([permission]);

          const result: CallResult = await callRoute({
            uri: uri,
            request: principal.request,
            body: {
              rumApplicationId: applicationAId.toString(),
              ...minimalBody(uri),
            },
          });

          expect(result.deniedWith).toBeUndefined();
          expect(result.thrownToNext).toBeUndefined();
          expect(result.jsonBody).toBeDefined();
          expect(querySpy).toHaveBeenCalled();
        }
      },
    );

    test.each(ALL_ROUTES)(
      "%s refuses an application outside the caller's labels before any query",
      async (uri: string) => {
        const principal: Principal = buildPrincipal({
          projectId: projectId,
          userId: userId,
          permissions: [Permission.ReadRumSessionReplay],
          labelIds: [labelAId],
        });

        mockProps(principal.databaseProps);
        mockApplication({ id: applicationBId, labelIds: [labelBId] });

        const result: CallResult = await callRoute({
          uri: uri,
          request: principal.request,
          body: {
            rumApplicationId: applicationBId.toString(),
            ...minimalBody(uri),
          },
        });

        expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
        expect(querySpy).not.toHaveBeenCalled();
      },
    );

    test.each(ALL_ROUTES)(
      "%s reads an application inside the caller's labels",
      async (uri: string) => {
        const principal: Principal = buildPrincipal({
          projectId: projectId,
          userId: userId,
          permissions: [Permission.ReadRumSessionReplay],
          labelIds: [labelAId],
        });

        mockProps(principal.databaseProps);
        mockApplication({ id: applicationAId, labelIds: [labelAId] });

        const result: CallResult = await callRoute({
          uri: uri,
          request: principal.request,
          body: {
            rumApplicationId: applicationAId.toString(),
            ...minimalBody(uri),
          },
        });

        expect(result.thrownToNext).toBeUndefined();
        expect(querySpy).toHaveBeenCalled();
      },
    );

    test.each(ALL_ROUTES)(
      "%s answers an application that is not in the project as one the caller may not read",
      async (uri: string) => {
        const principal: Principal = principalWith([Permission.ProjectOwner]);

        findOneBySpy.mockResolvedValue(null);

        const result: CallResult = await callRoute({
          uri: uri,
          request: principal.request,
          body: {
            rumApplicationId: applicationBId.toString(),
            ...minimalBody(uri),
          },
        });

        expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
        expect(querySpy).not.toHaveBeenCalled();
      },
    );

    test.each(ALL_ROUTES)(
      "%s is behind the session replay plan, checked before any lookup",
      async (uri: string) => {
        const principal: Principal = principalWith([Permission.ProjectOwner]);

        principal.databaseProps.currentPlan = PlanType.Free;

        const planCheck: jest.SpyInstance = jest
          .spyOn(SubscriptionPlan, "isFeatureAccessibleOnCurrentPlan")
          .mockReturnValue(false);

        const wasBillingEnabled: boolean = isTestBillingEnabled();

        setTestBillingEnabled(true);

        try {
          const result: CallResult = await callRoute({
            uri: uri,
            request: principal.request,
            body: {
              rumApplicationId: applicationAId.toString(),
              ...minimalBody(uri),
            },
          });

          expect(result.thrownToNext).toBeInstanceOf(PaymentRequiredException);
          expect(planCheck).toHaveBeenCalledWith(
            PlanType.Growth,
            PlanType.Free,
            expect.anything(),
          );
          expect(findOneBySpy).not.toHaveBeenCalled();
          expect(querySpy).not.toHaveBeenCalled();
        } finally {
          setTestBillingEnabled(wasBillingEnabled);
        }
      },
    );

    test.each(ALL_ROUTES)(
      "%s is open on a self-hosted install, where billing is off",
      async (uri: string) => {
        const principal: Principal = principalWith([Permission.ProjectOwner]);

        principal.databaseProps.currentPlan = PlanType.Free;

        const wasBillingEnabled: boolean = isTestBillingEnabled();

        setTestBillingEnabled(false);

        try {
          const result: CallResult = await callRoute({
            uri: uri,
            request: principal.request,
            body: {
              rumApplicationId: applicationAId.toString(),
              ...minimalBody(uri),
            },
          });

          expect(result.thrownToNext).toBeUndefined();
          expect(querySpy).toHaveBeenCalled();
        } finally {
          setTestBillingEnabled(wasBillingEnabled);
        }
      },
    );

    test.each(ALL_ROUTES)(
      "%s needs a well-formed application id",
      async (uri: string) => {
        for (const rumApplicationId of [undefined, "", "not-a-uuid", 42]) {
          jest.clearAllMocks();

          const principal: Principal = principalWith([Permission.ProjectOwner]);

          const body: JSONObject = { ...minimalBody(uri) };

          if (rumApplicationId !== undefined) {
            body["rumApplicationId"] = rumApplicationId as never;
          }

          const result: CallResult = await callRoute({
            uri: uri,
            request: principal.request,
            body: body,
          });

          expect(result.thrownToNext).toBeInstanceOf(BadDataException);
          expect(findOneBySpy).not.toHaveBeenCalled();
          expect(querySpy).not.toHaveBeenCalled();
        }
      },
    );
  });

  describe("the range", () => {
    test("is the last seven days by default", async () => {
      const summary: jest.SpyInstance = jest.spyOn(
        RumProductAnalyticsReadService,
        "getSummary",
      );

      const before: number = Date.now();
      await callAsOwner(PRODUCT_ANALYTICS_SUMMARY_ROUTE, {});
      const after: number = Date.now();

      const argument: Record<string, unknown> = argumentOf(summary);
      const startTime: Date = argument["startTime"] as Date;
      const endTime: Date = argument["endTime"] as Date;

      expect(endTime.getTime()).toBeGreaterThanOrEqual(before);
      expect(endTime.getTime()).toBeLessThanOrEqual(after);
      /* Seven calendar days: an hour either way across a clock change. */
      expect(
        Math.abs(endTime.getTime() - startTime.getTime() - 7 * DAY_MS),
      ).toBeLessThanOrEqual(60 * 60 * 1000);
      expect(argument["projectId"]).toEqual(projectId);
      expect(argument["rumApplicationId"]).toEqual(applicationAId);
    });

    test("takes ISO timestamps and epoch milliseconds", async () => {
      const summary: jest.SpyInstance = jest.spyOn(
        RumProductAnalyticsReadService,
        "getSummary",
      );

      await callAsOwner(PRODUCT_ANALYTICS_SUMMARY_ROUTE, {
        startTime: "2026-03-01T00:00:00.000Z",
        endTime: Date.parse("2026-03-31T00:00:00.000Z"),
      });

      const argument: Record<string, unknown> = argumentOf(summary);

      expect((argument["startTime"] as Date).toISOString()).toBe(
        "2026-03-01T00:00:00.000Z",
      );
      expect((argument["endTime"] as Date).toISOString()).toBe(
        "2026-03-31T00:00:00.000Z",
      );
    });

    test("reaches back seven days from a given end when no start is given", async () => {
      const trend: jest.SpyInstance = jest.spyOn(
        RumProductAnalyticsReadService,
        "getTrend",
      );

      await callAsOwner(PRODUCT_ANALYTICS_TREND_ROUTE, {
        endTime: "2026-03-31T00:00:00.000Z",
      });

      const argument: Record<string, unknown> = argumentOf(trend);

      expect((argument["startTime"] as Date).toISOString()).toBe(
        "2026-03-24T00:00:00.000Z",
      );
    });

    test.each([
      PRODUCT_ANALYTICS_SUMMARY_ROUTE,
      PRODUCT_ANALYTICS_TREND_ROUTE,
      PRODUCT_ANALYTICS_BREAKDOWN_ROUTE,
      PRODUCT_ANALYTICS_PEOPLE_ROUTE,
    ])(
      "%s refuses an inverted range, one too long and one it cannot read, before any query",
      async (uri: string) => {
        for (const range of [
          {
            startTime: "2026-03-08T00:00:00.000Z",
            endTime: "2026-03-01T00:00:00.000Z",
          },
          {
            startTime: new Date(
              Date.parse("2026-03-01T00:00:00.000Z") -
                PRODUCT_ANALYTICS_MAX_RANGE_DAYS * DAY_MS -
                1,
            ).toISOString(),
            endTime: "2026-03-01T00:00:00.000Z",
          },
          { endTime: "last tuesday" },
          { startTime: { year: 2026 } },
        ]) {
          jest.clearAllMocks();

          const result: CallResult = await callAsOwner(uri, {
            ...minimalBody(uri),
            ...(range as JSONObject),
          });

          expect(result.thrownToNext).toBeInstanceOf(BadDataException);
          expect(querySpy).not.toHaveBeenCalled();
        }
      },
    );

    test("takes a range of exactly the longest span", async () => {
      const result: CallResult = await callAsOwner(
        PRODUCT_ANALYTICS_SUMMARY_ROUTE,
        {
          startTime: new Date(
            Date.parse("2026-03-01T00:00:00.000Z") -
              PRODUCT_ANALYTICS_MAX_RANGE_DAYS * DAY_MS,
          ).toISOString(),
          endTime: "2026-03-01T00:00:00.000Z",
        },
      );

      expect(result.thrownToNext).toBeUndefined();
      expect(querySpy).toHaveBeenCalled();
    });

    test("an inverted range names the field that is wrong", async () => {
      const result: CallResult = await callAsOwner(
        PRODUCT_ANALYTICS_SUMMARY_ROUTE,
        {
          startTime: "2026-03-08T00:00:00.000Z",
          endTime: "2026-03-01T00:00:00.000Z",
        },
      );

      expect((result.thrownToNext as Error).message).toContain("startTime");
    });
  });

  describe("summary", () => {
    test("takes each dormant window the page offers, 30 days by default", async () => {
      const summary: jest.SpyInstance = jest.spyOn(
        RumProductAnalyticsReadService,
        "getSummary",
      );

      await callAsOwner(PRODUCT_ANALYTICS_SUMMARY_ROUTE, {});

      expect(argumentOf(summary)["dormantAfterDays"]).toBe(
        DEFAULT_PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS,
      );
      expect(DEFAULT_PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS).toBe(30);

      for (const days of PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS_OPTIONS) {
        summary.mockClear();

        await callAsOwner(PRODUCT_ANALYTICS_SUMMARY_ROUTE, {
          dormantAfterDays: days,
        });

        expect(argumentOf(summary)["dormantAfterDays"]).toBe(days);
      }
    });

    test.each([45, 0, -30, "30", 30.5, true])(
      "refuses dormantAfterDays %p before any query",
      async (days: unknown) => {
        const result: CallResult = await callAsOwner(
          PRODUCT_ANALYTICS_SUMMARY_ROUTE,
          { dormantAfterDays: days as number },
        );

        expect(result.thrownToNext).toBeInstanceOf(BadDataException);
        expect((result.thrownToNext as Error).message).toContain(
          "dormantAfterDays",
        );
        expect(querySpy).not.toHaveBeenCalled();
      },
    );

    test("answers with what the read service found", async () => {
      const dto: JSONObject = { totalUsers: 12, dormantUsers: 3 };

      jest
        .spyOn(RumProductAnalyticsReadService, "getSummary")
        .mockResolvedValue(dto as never);

      const result: CallResult = await callAsOwner(
        PRODUCT_ANALYTICS_SUMMARY_ROUTE,
        {},
      );

      expect(result.jsonBody).toBe(dto);
    });

    test("every statement is bound to the project and the application, under the interactive time limit, and never names who anyone is", async () => {
      const result: CallResult = await callAsOwner(
        PRODUCT_ANALYTICS_SUMMARY_ROUTE,
        {},
      );

      expect(result.thrownToNext).toBeUndefined();

      const statements: Array<Statement> = queriesOf(querySpy);

      expect(statements.length).toBeGreaterThan(0);

      for (const statement of statements) {
        expect(Object.values(statement.query_params)).toContain(
          projectId.toString(),
        );
        expect(Object.values(statement.query_params)).toContain(
          applicationAId.toString(),
        );
        expect(statement.query).toContain("timeout_overflow_mode = 'throw'");
        expect(statement.query).not.toContain("identifiedUserLabel");
      }
    });
  });

  describe("trend", () => {
    /*
     * A zone is handed on as the runtime names it - "europe/berlin" as
     * Europe/Berlin, Asia/Kolkata as its canonical Asia/Calcutta - because
     * ClickHouse's names are case sensitive. RumProductAnalyticsClickhouse
     * checks ClickHouse knows every name the runtime can give.
     */
    test("counts days in UTC unless told a zone, and passes a zone it is told, as the runtime names it", async () => {
      const trend: jest.SpyInstance = jest.spyOn(
        RumProductAnalyticsReadService,
        "getTrend",
      );

      await callAsOwner(PRODUCT_ANALYTICS_TREND_ROUTE, {});
      expect(argumentOf(trend)["timeZone"]).toBe("UTC");

      for (const timeZone of [
        "Europe/Berlin",
        "europe/berlin",
        "America/Argentina/Buenos_Aires",
        "Asia/Kolkata",
        "Etc/GMT+5",
      ]) {
        trend.mockClear();

        await callAsOwner(PRODUCT_ANALYTICS_TREND_ROUTE, {
          timeZone: timeZone,
        });

        expect(argumentOf(trend)["timeZone"]).toBe(
          new Intl.DateTimeFormat("en-US", {
            timeZone: timeZone,
          }).resolvedOptions().timeZone,
        );
      }

      trend.mockClear();
      await callAsOwner(PRODUCT_ANALYTICS_TREND_ROUTE, {
        timeZone: "europe/berlin",
      });
      expect(argumentOf(trend)["timeZone"]).toBe("Europe/Berlin");
    });

    test.each([
      "Mars/Olympus_Mons",
      "../../etc/passwd",
      "Europe/Berlin'; DROP TABLE x; --",
      "",
      42,
      ["UTC"],
    ])("refuses timeZone %p before any query", async (timeZone: unknown) => {
      const result: CallResult = await callAsOwner(
        PRODUCT_ANALYTICS_TREND_ROUTE,
        { timeZone: timeZone as string },
      );

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect((result.thrownToNext as Error).message).toContain("timeZone");
      expect(querySpy).not.toHaveBeenCalled();
    });

    test("binds the zone as a value, never as SQL", async () => {
      await callAsOwner(PRODUCT_ANALYTICS_TREND_ROUTE, {
        timeZone: "Europe/Berlin",
      });

      const statements: Array<Statement> = queriesOf(querySpy);

      expect(statements.length).toBeGreaterThan(0);

      for (const statement of statements) {
        expect(statement.query).not.toContain("Europe/Berlin");
        expect(statement.query).not.toContain("identifiedUserLabel");
      }

      expect(
        statements.some((statement: Statement): boolean => {
          return Object.values(statement.query_params).includes(
            "Europe/Berlin",
          );
        }),
      ).toBe(true);
    });
  });

  describe("breakdown", () => {
    test.each(PRODUCT_ANALYTICS_DIMENSIONS)(
      "reads dimension %s",
      async (dimension: ProductAnalyticsDimension) => {
        const breakdown: jest.SpyInstance = jest.spyOn(
          RumProductAnalyticsReadService,
          "getBreakdown",
        );

        const result: CallResult = await callAsOwner(
          PRODUCT_ANALYTICS_BREAKDOWN_ROUTE,
          { dimension: dimension },
        );

        expect(result.thrownToNext).toBeUndefined();
        expect(argumentOf(breakdown)["dimension"]).toBe(dimension);

        for (const statement of queriesOf(querySpy)) {
          expect(statement.query).not.toContain("identifiedUserLabel");
        }
      },
    );

    test.each([undefined, "", "identifiedUserLabel", "deviceType; --", 3])(
      "refuses dimension %p before any query",
      async (dimension: unknown) => {
        const body: JSONObject = {};

        if (dimension !== undefined) {
          body["dimension"] = dimension as never;
        }

        const result: CallResult = await callAsOwner(
          PRODUCT_ANALYTICS_BREAKDOWN_ROUTE,
          body,
        );

        expect(result.thrownToNext).toBeInstanceOf(BadDataException);
        expect((result.thrownToNext as Error).message).toContain("dimension");
        expect(querySpy).not.toHaveBeenCalled();
      },
    );
  });

  describe("people", () => {
    test("lists the range's active people by default, a page of 50 from the top", async () => {
      const people: jest.SpyInstance = jest.spyOn(
        RumProductAnalyticsReadService,
        "listPeople",
      );

      await callAsOwner(PRODUCT_ANALYTICS_PEOPLE_ROUTE, {});

      const argument: Record<string, unknown> = argumentOf(people);

      expect(argument["filter"]).toBe(ProductAnalyticsPeopleFilter.Active);
      expect(argument["limit"]).toBe(DEFAULT_PRODUCT_ANALYTICS_PEOPLE_LIMIT);
      expect(DEFAULT_PRODUCT_ANALYTICS_PEOPLE_LIMIT).toBe(50);
      expect(argument["offset"]).toBe(0);
      expect(argument["dormantAfterDays"]).toBe(30);
      expect(argument["search"]).toBeUndefined();
      expect(argument["now"]).toBeInstanceOf(Date);
    });

    test.each(PRODUCT_ANALYTICS_PEOPLE_FILTERS)(
      "takes filter %s",
      async (filter: ProductAnalyticsPeopleFilter) => {
        const people: jest.SpyInstance = jest.spyOn(
          RumProductAnalyticsReadService,
          "listPeople",
        );

        const result: CallResult = await callAsOwner(
          PRODUCT_ANALYTICS_PEOPLE_ROUTE,
          { filter: filter, dormantAfterDays: 90 },
        );

        expect(result.thrownToNext).toBeUndefined();
        expect(argumentOf(people)["filter"]).toBe(filter);
        expect(argumentOf(people)["dormantAfterDays"]).toBe(90);
      },
    );

    test.each(["Everyone", "Active", "", 1])(
      "refuses filter %p before any query",
      async (filter: unknown) => {
        const result: CallResult = await callAsOwner(
          PRODUCT_ANALYTICS_PEOPLE_ROUTE,
          { filter: filter as string },
        );

        expect(result.thrownToNext).toBeInstanceOf(BadDataException);
        expect((result.thrownToNext as Error).message).toContain("filter");
        expect(querySpy).not.toHaveBeenCalled();
      },
    );

    test("caps a page at 200 and pages as deep as 10000", async () => {
      const people: jest.SpyInstance = jest.spyOn(
        RumProductAnalyticsReadService,
        "listPeople",
      );

      await callAsOwner(PRODUCT_ANALYTICS_PEOPLE_ROUTE, {
        limit: 5000,
        offset: MAX_PRODUCT_ANALYTICS_OFFSET,
      });

      expect(argumentOf(people)["limit"]).toBe(
        MAX_PRODUCT_ANALYTICS_PEOPLE_LIMIT,
      );
      expect(MAX_PRODUCT_ANALYTICS_PEOPLE_LIMIT).toBe(200);
      expect(argumentOf(people)["offset"]).toBe(10000);
    });

    test.each([
      { limit: 0 },
      { limit: 2.5 },
      { limit: "20" },
      { offset: -1 },
      { offset: 1.5 },
      { offset: MAX_PRODUCT_ANALYTICS_OFFSET + 1 },
      { offset: "50" },
    ])("refuses %p before any query", async (paging: JSONObject) => {
      const result: CallResult = await callAsOwner(
        PRODUCT_ANALYTICS_PEOPLE_ROUTE,
        paging,
      );

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(querySpy).not.toHaveBeenCalled();
    });

    test("a reader who may see who signed-in users are gets their names, and can search them", async () => {
      const people: jest.SpyInstance = jest.spyOn(
        RumProductAnalyticsReadService,
        "listPeople",
      );

      const result: CallResult = await callAsOwner(
        PRODUCT_ANALYTICS_PEOPLE_ROUTE,
        { search: "  Alice@Example.com  " },
      );

      expect(result.thrownToNext).toBeUndefined();

      const argument: Record<string, unknown> = argumentOf(people);

      expect(argument["includeLabel"]).toBe(true);
      expect(argument["search"]).toBe("Alice@Example.com");

      /*
       * The search reads a name only from the recordings still kept: the
       * product analytics tables keep no names.
       */
      const searched: Statement | undefined = queriesOf(querySpy).find(
        (statement: Statement): boolean => {
          return statement.query.includes("identifiedUserLabel");
        },
      );

      expect(searched).toBeDefined();
      expect(searched!.query).toContain("retentionDate >= now()");
      expect(searched!.query).not.toContain("Alice@Example.com");
      expect(Object.values(searched!.query_params)).toContain(
        "Alice@Example.com",
      );
    });

    test("a blank search is no search", async () => {
      const people: jest.SpyInstance = jest.spyOn(
        RumProductAnalyticsReadService,
        "listPeople",
      );

      await callAsOwner(PRODUCT_ANALYTICS_PEOPLE_ROUTE, { search: "   " });

      expect(argumentOf(people)["search"]).toBeUndefined();
    });

    test.each([
      "x".repeat(PRODUCT_ANALYTICS_SEARCH_MAX_LENGTH + 1),
      42,
      ["alice"],
    ])("refuses search %p before any query", async (search: unknown) => {
      const result: CallResult = await callAsOwner(
        PRODUCT_ANALYTICS_PEOPLE_ROUTE,
        { search: search as string },
      );

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect((result.thrownToNext as Error).message).toContain("search");
      expect(querySpy).not.toHaveBeenCalled();
    });

    test("takes a search of exactly the longest length", async () => {
      const result: CallResult = await callAsOwner(
        PRODUCT_ANALYTICS_PEOPLE_ROUTE,
        { search: "x".repeat(PRODUCT_ANALYTICS_SEARCH_MAX_LENGTH) },
      );

      expect(result.thrownToNext).toBeUndefined();
    });

    test("a lister who may not see who users are gets the list without names, and nothing names them", async () => {
      const people: jest.SpyInstance = jest.spyOn(
        RumProductAnalyticsReadService,
        "listPeople",
      );

      /* Someone came: the list would name them, were names allowed. */
      querySpy.mockResolvedValue(
        fakeResultSet([
          {
            paPersonKey: `u:${USER_KEY}`,
            paActive: 1,
            paFirstSeenAt: 1700000000000,
            paLastSeenAt: 1700000600000,
            paSessionsInRange: 2,
            paTotalSessions: 4,
            paDeviceType: "desktop",
            paCountryCode: "GB",
            paIsNew: 0,
          },
        ]) as never,
      );

      const principal: Principal = principalWith([
        Permission.ReadRumSessionReplay,
      ]);

      const result: CallResult = await callRoute({
        uri: PRODUCT_ANALYTICS_PEOPLE_ROUTE,
        request: principal.request,
        body: {
          rumApplicationId: applicationAId.toString(),
          filter: ProductAnalyticsPeopleFilter.All,
        },
      });

      expect(result.thrownToNext).toBeUndefined();
      expect(argumentOf(people)["includeLabel"]).toBe(false);

      for (const statement of queriesOf(querySpy)) {
        expect(statement.query).not.toContain("identifiedUserLabel");
      }

      const rows: Array<JSONObject> = (result.jsonBody as JSONObject)[
        "people"
      ] as unknown as Array<JSONObject>;

      expect(rows).toHaveLength(1);
      expect(rows[0]!["personKey"]).toBe(`u:${USER_KEY}`);
      expect(rows[0]!["identifiedUserLabel"]).toBeUndefined();
    });

    test("such a lister's search is refused, not quietly ignored", async () => {
      const principal: Principal = principalWith([
        Permission.ReadRumSessionReplay,
      ]);

      const result: CallResult = await callRoute({
        uri: PRODUCT_ANALYTICS_PEOPLE_ROUTE,
        request: principal.request,
        body: {
          rumApplicationId: applicationAId.toString(),
          search: "alice",
        },
      });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect((result.thrownToNext as Error).message).toContain(
        "cannot search them by name",
      );
      expect(querySpy).not.toHaveBeenCalled();
    });

    test("a watch grant scoped to another application's labels does not name this application's users", async () => {
      const people: jest.SpyInstance = jest.spyOn(
        RumProductAnalyticsReadService,
        "listPeople",
      );

      const principal: Principal = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplayPayload],
        labelIds: [labelBId],
      });

      /* An unscoped list grant on top: they may list every application. */
      principal.databaseProps.userTenantAccessPermission![
        projectId.toString()
      ]!.permissions.push({
        _type: "UserPermission",
        permission: Permission.ReadRumSessionReplay,
        labelIds: [],
        isBlockPermission: false,
      });

      mockProps(principal.databaseProps);
      mockApplication({ id: applicationAId, labelIds: [labelAId] });

      const result: CallResult = await callRoute({
        uri: PRODUCT_ANALYTICS_PEOPLE_ROUTE,
        request: principal.request,
        body: { rumApplicationId: applicationAId.toString() },
      });

      expect(result.thrownToNext).toBeUndefined();
      expect(argumentOf(people)["includeLabel"]).toBe(false);
    });
  });

  describe("person", () => {
    test.each([`u:${USER_KEY}`, `v:${VISITOR_ID}`])(
      "reads person %s, a page of 50 of their sessions by default",
      async (personKey: string) => {
        const person: jest.SpyInstance = jest.spyOn(
          RumProductAnalyticsReadService,
          "getPerson",
        );

        const result: CallResult = await callAsOwner(
          PRODUCT_ANALYTICS_PERSON_ROUTE,
          { personKey: personKey },
        );

        expect(result.thrownToNext).toBeUndefined();

        const argument: Record<string, unknown> = argumentOf(person);

        expect(argument["personKey"]).toBe(personKey);
        expect(argument["limit"]).toBe(
          DEFAULT_PRODUCT_ANALYTICS_PERSON_SESSIONS_LIMIT,
        );
        expect(argument["offset"]).toBe(0);
        expect(argument["includeLabel"]).toBe(true);
      },
    );

    test("caps a page of sessions at 200", async () => {
      const person: jest.SpyInstance = jest.spyOn(
        RumProductAnalyticsReadService,
        "getPerson",
      );

      await callAsOwner(PRODUCT_ANALYTICS_PERSON_ROUTE, {
        personKey: `v:${VISITOR_ID}`,
        limit: 1000,
        offset: 200,
      });

      expect(argumentOf(person)["limit"]).toBe(
        MAX_PRODUCT_ANALYTICS_PERSON_SESSIONS_LIMIT,
      );
      expect(argumentOf(person)["offset"]).toBe(200);
    });

    test.each([
      undefined,
      "",
      USER_KEY,
      `u:${USER_KEY.slice(1)}`,
      `u:${USER_KEY.toUpperCase()}`,
      `v:${VISITOR_ID}0`,
      `x:${VISITOR_ID}`,
      `u:${USER_KEY}' OR 1=1 --`,
      42,
    ])("refuses personKey %p before any query", async (personKey: unknown) => {
      const body: JSONObject = {};

      if (personKey !== undefined) {
        body["personKey"] = personKey as never;
      }

      const result: CallResult = await callAsOwner(
        PRODUCT_ANALYTICS_PERSON_ROUTE,
        body,
      );

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect((result.thrownToNext as Error).message).toContain("personKey");
      expect(querySpy).not.toHaveBeenCalled();
    });

    test("a lister who may not see who users are reads a person without a name, and nothing names them", async () => {
      const person: jest.SpyInstance = jest.spyOn(
        RumProductAnalyticsReadService,
        "getPerson",
      );

      const principal: Principal = principalWith([
        Permission.ReadRumSessionReplay,
      ]);

      const result: CallResult = await callRoute({
        uri: PRODUCT_ANALYTICS_PERSON_ROUTE,
        request: principal.request,
        body: {
          rumApplicationId: applicationAId.toString(),
          personKey: `u:${USER_KEY}`,
        },
      });

      expect(result.thrownToNext).toBeUndefined();
      expect(argumentOf(person)["includeLabel"]).toBe(false);

      for (const statement of queriesOf(querySpy)) {
        expect(statement.query).not.toContain("identifiedUserLabel");
      }
    });

    test("binds the person's key as a value, scoped to the project and application", async () => {
      await callAsOwner(PRODUCT_ANALYTICS_PERSON_ROUTE, {
        personKey: `u:${USER_KEY}`,
      });

      const statements: Array<Statement> = queriesOf(querySpy);

      expect(statements.length).toBeGreaterThan(0);

      for (const statement of statements) {
        expect(statement.query).not.toContain(USER_KEY);
        expect(Object.values(statement.query_params)).toContain(
          projectId.toString(),
        );
        expect(Object.values(statement.query_params)).toContain(
          applicationAId.toString(),
        );
      }
    });
  });

  test("a read that fails is an error for the error handler, not an answer", async () => {
    querySpy.mockRejectedValue(new Error("ClickHouse is unavailable"));

    for (const uri of ALL_ROUTES) {
      jest.clearAllMocks();

      const result: CallResult = await callAsOwner(uri, minimalBody(uri));

      expect(String(result.thrownToNext)).toContain(
        "ClickHouse is unavailable",
      );
      expect(result.jsonBody).toBeUndefined();
    }
  });
});
