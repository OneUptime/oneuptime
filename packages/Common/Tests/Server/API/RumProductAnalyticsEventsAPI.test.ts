import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import RumApplicationService from "../../../Server/Services/RumApplicationService";
import RumApplicationOwnerUserService from "../../../Server/Services/RumApplicationOwnerUserService";
import RumApplicationOwnerTeamService from "../../../Server/Services/RumApplicationOwnerTeamService";
import RumProductAnalyticsEventService from "../../../Server/Services/RumProductAnalyticsEventService";
import RumProductAnalyticsSessionService from "../../../Server/Services/RumProductAnalyticsSessionService";
import RumProductAnalyticsEventReadService from "../../../Server/Utils/RumProductAnalytics/RumProductAnalyticsEventReadService";
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
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import { PRODUCT_ANALYTICS_MAX_RANGE_DAYS } from "../../../Types/Rum/ProductAnalytics";
import { ProductAnalyticsEventKind } from "../../../Types/Rum/ProductAnalyticsEvents";
import {
  DEFAULT_PRODUCT_ANALYTICS_FUNNEL_WINDOW_MS,
  PRODUCT_ANALYTICS_EVENT_BREAKDOWN_ROUTE,
  PRODUCT_ANALYTICS_EVENT_FIELDS,
  PRODUCT_ANALYTICS_EVENT_NAMES_ROUTE,
  PRODUCT_ANALYTICS_EVENT_PROPERTIES_ROUTE,
  PRODUCT_ANALYTICS_EVENT_TREND_ROUTE,
  PRODUCT_ANALYTICS_FUNNEL_MAX_STEPS,
  PRODUCT_ANALYTICS_FUNNEL_ROUTE,
  PRODUCT_ANALYTICS_FUNNEL_WINDOWS_MS,
  PRODUCT_ANALYTICS_MAX_SEGMENT_FILTERS,
  PRODUCT_ANALYTICS_RETENTION_PERIODS,
  PRODUCT_ANALYTICS_RETENTION_ROUTE,
  ProductAnalyticsEventField,
  ProductAnalyticsRetentionPeriod,
  isProductAnalyticsKeyedField,
} from "../../../Types/Rum/ProductAnalyticsEventReads";
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
 * The six product analytics event routes (issue #6444, part two): the
 * events a RUM application's recorders send from every session, read as
 * the Events, Funnels and Retention pages read them.
 *
 * They count what the session list's readers may count, so each carries
 * the list's guard, its plan gate and its label-scoped application check,
 * as part one's five routes do (RumProductAnalyticsAPI.test.ts). These
 * tests run each route's middleware chain for real, with ClickHouse
 * answered in memory, and pin who is refused and how, every body value
 * each route takes or refuses, and what reaches the read service.
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

const eventsRouter: JSONObject = {
  get: recordRoute("get"),
  post: recordRoute("post"),
  put: recordRoute("put"),
  delete: recordRoute("delete"),
} as unknown as JSONObject;

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return eventsRouter;
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

const EVENT_ROUTES: Array<string> = [
  PRODUCT_ANALYTICS_EVENT_NAMES_ROUTE,
  PRODUCT_ANALYTICS_EVENT_TREND_ROUTE,
  PRODUCT_ANALYTICS_EVENT_BREAKDOWN_ROUTE,
  PRODUCT_ANALYTICS_EVENT_PROPERTIES_ROUTE,
  PRODUCT_ANALYTICS_FUNNEL_ROUTE,
  PRODUCT_ANALYTICS_RETENTION_ROUTE,
];

/* The routes that read one event, under "event". */
const ONE_EVENT_ROUTES: Array<string> = [
  PRODUCT_ANALYTICS_EVENT_TREND_ROUTE,
  PRODUCT_ANALYTICS_EVENT_BREAKDOWN_ROUTE,
  PRODUCT_ANALYTICS_EVENT_PROPERTIES_ROUTE,
];

/* The routes a segment narrows. */
const SEGMENT_ROUTES: Array<string> = [
  PRODUCT_ANALYTICS_EVENT_TREND_ROUTE,
  PRODUCT_ANALYTICS_EVENT_BREAKDOWN_ROUTE,
  PRODUCT_ANALYTICS_FUNNEL_ROUTE,
  PRODUCT_ANALYTICS_RETENTION_ROUTE,
];

const SIGNED_UP: JSONObject = {
  kind: ProductAnalyticsEventKind.Custom,
  name: "Signed up",
};
const SESSION_START: JSONObject = { kind: ProductAnalyticsEventKind.Session };
const PRICING_PAGE: JSONObject = {
  kind: ProductAnalyticsEventKind.Page,
  name: "/pricing",
};
const DAY_MS: number = 24 * 60 * 60 * 1000;

/* The smallest body each route takes, beside rumApplicationId. */
function minimalBody(uri: string): JSONObject {
  if (uri === PRODUCT_ANALYTICS_EVENT_BREAKDOWN_ROUTE) {
    return {
      event: SIGNED_UP,
      breakdown: { field: ProductAnalyticsEventField.DeviceType },
    };
  }

  if (ONE_EVENT_ROUTES.includes(uri)) {
    return { event: SIGNED_UP };
  }

  if (uri === PRODUCT_ANALYTICS_FUNNEL_ROUTE) {
    return { steps: [SESSION_START, SIGNED_UP] };
  }

  if (uri === PRODUCT_ANALYTICS_RETENTION_ROUTE) {
    return { startEvent: SESSION_START, returnEvent: SIGNED_UP };
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

describe("Product analytics event API", () => {
  let projectId: ObjectID;
  let userId: ObjectID;
  let applicationAId: ObjectID;
  let applicationBId: ObjectID;
  let labelAId: ObjectID;
  let labelBId: ObjectID;

  let querySpy: jest.SpyInstance;
  let sessionQuerySpy: jest.SpyInstance;
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
      .spyOn(RumProductAnalyticsEventService, "executeQuery")
      .mockResolvedValue(fakeResultSet([]) as never);
    /* Part one's table: no event read reaches it. */
    sessionQuerySpy = jest
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

  async function expectRefused(
    uri: string,
    body: JSONObject,
    field: string,
  ): Promise<void> {
    jest.clearAllMocks();

    const result: CallResult = await callAsOwner(uri, body);

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect((result.thrownToNext as Error).message).toContain(field);
    expect(result.jsonBody).toBeUndefined();
    expect(querySpy).not.toHaveBeenCalled();
  }

  describe("registration", () => {
    test("the six routes are POSTs at the paths the Dashboard calls, behind the session list's own guard", () => {
      const listGuard: RouterFunction | undefined =
        findRoute(LIST_ROUTE).handlers[2];

      expect(listGuard).toBeDefined();

      expect(EVENT_ROUTES).toEqual([
        "/telemetry/rum/product-analytics/event-names",
        "/telemetry/rum/product-analytics/event-trend",
        "/telemetry/rum/product-analytics/event-breakdown",
        "/telemetry/rum/product-analytics/event-properties",
        "/telemetry/rum/product-analytics/funnel",
        "/telemetry/rum/product-analytics/retention",
      ]);

      for (const uri of EVENT_ROUTES) {
        const route: RecordedRoute = findRoute(uri);

        expect(route.handlers).toHaveLength(4);
        expect(route.handlers[0]).toBe(UserMiddleware.getUserMiddleware);
        expect(route.handlers[1]).toBe(
          UserMiddleware.requireUserAuthentication,
        );
        expect(route.handlers[2]).toBe(listGuard);
      }
    });
  });

  describe("who is refused", () => {
    test.each(EVENT_ROUTES)(
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

    test.each(EVENT_ROUTES)(
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

    test.each(EVENT_ROUTES)(
      "%s admits a session replay lister, a watcher and the admins",
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

    test.each(EVENT_ROUTES)(
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

    test.each(EVENT_ROUTES)(
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

    test.each(EVENT_ROUTES)(
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

    test.each(EVENT_ROUTES)(
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

    test.each(EVENT_ROUTES)(
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

    test.each(EVENT_ROUTES)(
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

  describe("what every read is bound to", () => {
    test.each(EVENT_ROUTES)(
      "%s binds every statement to the project and the application, under the interactive time limit, on the events table alone",
      async (uri: string) => {
        const result: CallResult = await callAsOwner(uri, minimalBody(uri));

        expect(result.thrownToNext).toBeUndefined();

        const statements: Array<Statement> = queriesOf(querySpy);

        expect(statements.length).toBeGreaterThan(0);

        for (const statement of statements) {
          const values: Array<unknown> = Object.values(statement.query_params);

          /* getPeriods computes calendar periods and reads no table. */
          if (!values.includes(AnalyticsTableName.RumProductAnalyticsEvent)) {
            expect(statement.query).toContain("paPeriods");
            expect(values).not.toContain(projectId.toString());
            continue;
          }

          expect(Object.values(statement.query_params)).toContain(
            projectId.toString(),
          );
          expect(Object.values(statement.query_params)).toContain(
            applicationAId.toString(),
          );
          expect(statement.query).toContain("timeout_overflow_mode = 'throw'");
          expect(statement.query).not.toContain("identifiedUserLabel");
        }

        expect(sessionQuerySpy).not.toHaveBeenCalled();
      },
    );

    test.each(EVENT_ROUTES)(
      "%s refuses an inverted range and one too long before any query",
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

    test("a read that fails is an error for the error handler, not an answer", async () => {
      querySpy.mockRejectedValue(new Error("ClickHouse is unavailable"));

      for (const uri of EVENT_ROUTES) {
        jest.clearAllMocks();

        const result: CallResult = await callAsOwner(uri, minimalBody(uri));

        expect(String(result.thrownToNext)).toContain(
          "ClickHouse is unavailable",
        );
        expect(result.jsonBody).toBeUndefined();
      }
    });
  });

  describe("event names", () => {
    test("lists every kind by default, and one kind when asked", async () => {
      const names: jest.SpyInstance = jest.spyOn(
        RumProductAnalyticsEventReadService,
        "listEventNames",
      );

      await callAsOwner(PRODUCT_ANALYTICS_EVENT_NAMES_ROUTE, {});
      expect(argumentOf(names)["kind"]).toBeUndefined();
      expect(argumentOf(names)["projectId"]).toEqual(projectId);
      expect(argumentOf(names)["rumApplicationId"]).toEqual(applicationAId);

      for (const kind of [
        ProductAnalyticsEventKind.Session,
        ProductAnalyticsEventKind.Page,
        ProductAnalyticsEventKind.Custom,
      ]) {
        names.mockClear();
        await callAsOwner(PRODUCT_ANALYTICS_EVENT_NAMES_ROUTE, { kind: kind });
        expect(argumentOf(names)["kind"]).toBe(kind);
      }
    });

    test.each(["screen", "", "Custom", 3, { kind: "custom" }])(
      "refuses kind %p before any query",
      async (kind: unknown) => {
        await expectRefused(
          PRODUCT_ANALYTICS_EVENT_NAMES_ROUTE,
          { kind: kind as never },
          "kind",
        );
      },
    );

    test("answers with what the read service found", async () => {
      const dto: JSONObject = {
        events: [],
        hasMore: false,
        dataStartedAt: null,
      };

      jest
        .spyOn(RumProductAnalyticsEventReadService, "listEventNames")
        .mockResolvedValue(dto as never);

      const result: CallResult = await callAsOwner(
        PRODUCT_ANALYTICS_EVENT_NAMES_ROUTE,
        {},
      );

      expect(result.jsonBody).toBe(dto);
    });
  });

  describe("the event a read is about", () => {
    test.each(ONE_EVENT_ROUTES)(
      "%s takes a session's start, a page and a custom event",
      async (uri: string) => {
        for (const event of [SESSION_START, PRICING_PAGE, SIGNED_UP]) {
          jest.clearAllMocks();

          const result: CallResult = await callAsOwner(uri, {
            ...minimalBody(uri),
            event: event,
          });

          expect(result.thrownToNext).toBeUndefined();
          expect(querySpy).toHaveBeenCalled();
        }
      },
    );

    test.each(ONE_EVENT_ROUTES)(
      "%s refuses a missing event, an unknown kind and a nameless custom event",
      async (uri: string) => {
        for (const event of [
          undefined,
          null,
          "Signed up",
          { kind: "screen", name: "Home" },
          { kind: ProductAnalyticsEventKind.Custom },
          { kind: ProductAnalyticsEventKind.Custom, name: "" },
          { kind: ProductAnalyticsEventKind.Custom, name: " \u0007 " },
          { kind: ProductAnalyticsEventKind.Page, name: 42 },
          [SIGNED_UP],
        ]) {
          const body: JSONObject = { ...minimalBody(uri) };

          if (event === undefined) {
            delete body["event"];
          } else {
            body["event"] = event as never;
          }

          await expectRefused(uri, body, "event");
        }
      },
    );

    test("binds an event's name as a value, never as SQL", async () => {
      const name: string = "Signed up'); DROP TABLE RumProductAnalyticsEvent; --";

      const result: CallResult = await callAsOwner(
        PRODUCT_ANALYTICS_EVENT_TREND_ROUTE,
        { event: { kind: ProductAnalyticsEventKind.Custom, name: name } },
      );

      expect(result.thrownToNext).toBeUndefined();

      const statements: Array<Statement> = queriesOf(querySpy);

      expect(statements.length).toBeGreaterThan(0);

      for (const statement of statements) {
        expect(statement.query).not.toContain("DROP TABLE");
      }

      expect(
        statements.some((statement: Statement): boolean => {
          return Object.values(statement.query_params).includes(name);
        }),
      ).toBe(true);
    });
  });

  describe("segments", () => {
    test.each(SEGMENT_ROUTES)(
      "%s reads everyone without filters, and hands each filter on",
      async (uri: string) => {
        const methods: Record<string, keyof typeof RumProductAnalyticsEventReadService> =
          {
            [PRODUCT_ANALYTICS_EVENT_TREND_ROUTE]: "getEventTrend",
            [PRODUCT_ANALYTICS_EVENT_BREAKDOWN_ROUTE]: "getEventBreakdown",
            [PRODUCT_ANALYTICS_FUNNEL_ROUTE]: "getFunnel",
            [PRODUCT_ANALYTICS_RETENTION_ROUTE]: "getRetention",
          };
        const read: jest.SpyInstance = jest.spyOn(
          RumProductAnalyticsEventReadService,
          methods[uri] as never,
        );

        await callAsOwner(uri, minimalBody(uri));
        expect(argumentOf(read)["filters"]).toEqual([]);

        read.mockClear();

        await callAsOwner(uri, {
          ...minimalBody(uri),
          filters: [
            { field: ProductAnalyticsEventField.Country, value: "DE" },
            {
              field: ProductAnalyticsEventField.UserProperty,
              key: "plan",
              value: "pro",
            },
          ],
        });

        expect(argumentOf(read)["filters"]).toEqual([
          { field: ProductAnalyticsEventField.Country, key: "", value: "DE" },
          {
            field: ProductAnalyticsEventField.UserProperty,
            key: "plan",
            value: "pro",
          },
        ]);
      },
    );

    test.each(SEGMENT_ROUTES)(
      "%s refuses a segment it cannot read before any query",
      async (uri: string) => {
        const tooMany: Array<JSONObject> = [];

        for (
          let index: number = 0;
          index <= PRODUCT_ANALYTICS_MAX_SEGMENT_FILTERS;
          index++
        ) {
          tooMany.push({
            field: ProductAnalyticsEventField.Country,
            value: `C${index}`,
          });
        }

        for (const filters of [
          "country=DE",
          { field: ProductAnalyticsEventField.Country, value: "DE" },
          tooMany,
          [{ field: "identifiedUserLabel", value: "ada" }],
          [{ field: ProductAnalyticsEventField.Property, value: "pro" }],
          [{ field: ProductAnalyticsEventField.Country }],
          [{ field: ProductAnalyticsEventField.Country, value: 42 }],
          [null],
        ]) {
          await expectRefused(
            uri,
            { ...minimalBody(uri), filters: filters as never },
            "filter",
          );
        }
      },
    );

    test("a filter's value is bound as a value, never as SQL", async () => {
      const value: string = "pro' OR 1=1 --";

      await callAsOwner(PRODUCT_ANALYTICS_EVENT_TREND_ROUTE, {
        event: SIGNED_UP,
        filters: [
          {
            field: ProductAnalyticsEventField.Property,
            key: "plan",
            value: value,
          },
        ],
      });

      const statements: Array<Statement> = queriesOf(querySpy);

      expect(statements.length).toBeGreaterThan(0);

      for (const statement of statements) {
        expect(statement.query).not.toContain("OR 1=1");
      }

      /* Bound as a parameter: a value with a quote travels hex-encoded. */
      const encoded: string = Buffer.from(value, "utf8").toString("hex");

      expect(
        statements.some((statement: Statement): boolean => {
          return Object.values(statement.query_params).includes(encoded);
        }),
      ).toBe(true);
    });
  });

  describe("event trend", () => {
    test("counts days in UTC unless told a zone", async () => {
      const trend: jest.SpyInstance = jest.spyOn(
        RumProductAnalyticsEventReadService,
        "getEventTrend",
      );

      await callAsOwner(PRODUCT_ANALYTICS_EVENT_TREND_ROUTE, {
        event: SIGNED_UP,
      });
      expect(argumentOf(trend)["timeZone"]).toBe("UTC");

      trend.mockClear();

      await callAsOwner(PRODUCT_ANALYTICS_EVENT_TREND_ROUTE, {
        event: SIGNED_UP,
        timeZone: "europe/berlin",
      });
      expect(argumentOf(trend)["timeZone"]).toBe("Europe/Berlin");
      expect(argumentOf(trend)["event"]).toEqual({
        kind: ProductAnalyticsEventKind.Custom,
        name: "Signed up",
      });
    });

    test.each([
      "Mars/Olympus_Mons",
      "Europe/Berlin'; DROP TABLE x; --",
      "",
      42,
    ])("refuses timeZone %p before any query", async (timeZone: unknown) => {
      await expectRefused(
        PRODUCT_ANALYTICS_EVENT_TREND_ROUTE,
        { event: SIGNED_UP, timeZone: timeZone as never },
        "timeZone",
      );
    });
  });

  describe("event breakdown", () => {
    test.each(
      PRODUCT_ANALYTICS_EVENT_FIELDS.map(
        (field: ProductAnalyticsEventField): JSONObject => {
          return isProductAnalyticsKeyedField(field)
            ? { field: field, key: "plan" }
            : { field: field };
        },
      ),
    )("breaks an event down by %p", async (breakdown: JSONObject) => {
      const read: jest.SpyInstance = jest.spyOn(
        RumProductAnalyticsEventReadService,
        "getEventBreakdown",
      );

      const result: CallResult = await callAsOwner(
        PRODUCT_ANALYTICS_EVENT_BREAKDOWN_ROUTE,
        { event: SIGNED_UP, breakdown: breakdown },
      );

      expect(result.thrownToNext).toBeUndefined();
      expect(argumentOf(read)["breakdown"]).toEqual({
        field: breakdown["field"],
        key: breakdown["key"] || "",
      });
    });

    test.each([
      undefined,
      "deviceType",
      { field: "identifiedUserLabel" },
      { field: ProductAnalyticsEventField.Property },
      { field: ProductAnalyticsEventField.UserProperty, key: "" },
      { field: ProductAnalyticsEventField.Property, key: "   " },
    ])("refuses breakdown %p before any query", async (breakdown: unknown) => {
      const body: JSONObject = { event: SIGNED_UP };

      if (breakdown !== undefined) {
        body["breakdown"] = breakdown as never;
      }

      await expectRefused(
        PRODUCT_ANALYTICS_EVENT_BREAKDOWN_ROUTE,
        body,
        "breakdown",
      );
    });

    test("binds a property's key as a value, never as SQL", async () => {
      const key: string = "plan']) OR 1=1 --";

      await callAsOwner(PRODUCT_ANALYTICS_EVENT_BREAKDOWN_ROUTE, {
        event: SIGNED_UP,
        breakdown: { field: ProductAnalyticsEventField.Property, key: key },
      });

      const statements: Array<Statement> = queriesOf(querySpy);

      expect(statements.length).toBeGreaterThan(0);

      for (const statement of statements) {
        expect(statement.query).not.toContain("OR 1=1");
      }
    });
  });

  describe("funnel", () => {
    test("reads two to six steps in order, within a day by default, up to now", async () => {
      const funnel: jest.SpyInstance = jest.spyOn(
        RumProductAnalyticsEventReadService,
        "getFunnel",
      );

      const before: number = Date.now();
      await callAsOwner(PRODUCT_ANALYTICS_FUNNEL_ROUTE, {
        steps: [SESSION_START, PRICING_PAGE, SIGNED_UP],
      });
      const after: number = Date.now();

      const argument: Record<string, unknown> = argumentOf(funnel);

      expect(argument["steps"]).toEqual([
        { kind: ProductAnalyticsEventKind.Session, name: "" },
        { kind: ProductAnalyticsEventKind.Page, name: "/pricing" },
        { kind: ProductAnalyticsEventKind.Custom, name: "Signed up" },
      ]);
      expect(argument["windowMs"]).toBe(
        DEFAULT_PRODUCT_ANALYTICS_FUNNEL_WINDOW_MS,
      );
      expect((argument["now"] as Date).getTime()).toBeGreaterThanOrEqual(
        before,
      );
      expect((argument["now"] as Date).getTime()).toBeLessThanOrEqual(after);
    });

    test.each(PRODUCT_ANALYTICS_FUNNEL_WINDOWS_MS)(
      "takes the window the page offers: %p ms",
      async (windowMs: number) => {
        const funnel: jest.SpyInstance = jest.spyOn(
          RumProductAnalyticsEventReadService,
          "getFunnel",
        );

        await callAsOwner(PRODUCT_ANALYTICS_FUNNEL_ROUTE, {
          steps: [SESSION_START, SIGNED_UP],
          windowMs: windowMs,
        });

        expect(argumentOf(funnel)["windowMs"]).toBe(windowMs);
      },
    );

    test.each([0, 1000, -1, 90 * DAY_MS, "86400000", 86400000.5])(
      "refuses windowMs %p before any query",
      async (windowMs: unknown) => {
        await expectRefused(
          PRODUCT_ANALYTICS_FUNNEL_ROUTE,
          { steps: [SESSION_START, SIGNED_UP], windowMs: windowMs as never },
          "windowMs",
        );
      },
    );

    test("takes six steps, the most a funnel has", async () => {
      const steps: Array<JSONObject> = [];

      for (
        let index: number = 0;
        index < PRODUCT_ANALYTICS_FUNNEL_MAX_STEPS;
        index++
      ) {
        steps.push({
          kind: ProductAnalyticsEventKind.Custom,
          name: `Step ${index}`,
        });
      }

      const result: CallResult = await callAsOwner(
        PRODUCT_ANALYTICS_FUNNEL_ROUTE,
        { steps: steps },
      );

      expect(result.thrownToNext).toBeUndefined();
      expect(querySpy).toHaveBeenCalled();
    });

    test("refuses too few steps, too many, and a step that is not an event", async () => {
      const seven: Array<JSONObject> = [];

      for (
        let index: number = 0;
        index <= PRODUCT_ANALYTICS_FUNNEL_MAX_STEPS;
        index++
      ) {
        seven.push(SIGNED_UP);
      }

      for (const steps of [undefined, [], [SIGNED_UP], seven, "Signed up"]) {
        const body: JSONObject = {};

        if (steps !== undefined) {
          body["steps"] = steps as never;
        }

        await expectRefused(PRODUCT_ANALYTICS_FUNNEL_ROUTE, body, "steps");
      }

      await expectRefused(
        PRODUCT_ANALYTICS_FUNNEL_ROUTE,
        { steps: [SESSION_START, { kind: "screen", name: "Home" }] },
        "Step 2",
      );
    });

    test("answers each step with its people, shares, drop-off and median time", async () => {
      querySpy.mockResolvedValue(
        fakeResultSet([
          {
            paPeople0: 200,
            paPeople1: 120,
            paMedian1: 90500,
            paPeople2: 30,
            paMedian2: 3600000,
          },
        ]) as never,
      );

      const result: CallResult = await callAsOwner(
        PRODUCT_ANALYTICS_FUNNEL_ROUTE,
        { steps: [SESSION_START, PRICING_PAGE, SIGNED_UP] },
      );

      expect(result.jsonBody).toEqual({
        windowMs: DEFAULT_PRODUCT_ANALYTICS_FUNNEL_WINDOW_MS,
        steps: [
          {
            kind: ProductAnalyticsEventKind.Session,
            name: "",
            people: 200,
            conversionFromStart: 1,
            conversionFromPrevious: 1,
            droppedOff: 0,
            medianMsFromPrevious: null,
          },
          {
            kind: ProductAnalyticsEventKind.Page,
            name: "/pricing",
            people: 120,
            conversionFromStart: 0.6,
            conversionFromPrevious: 0.6,
            droppedOff: 80,
            medianMsFromPrevious: 90500,
          },
          {
            kind: ProductAnalyticsEventKind.Custom,
            name: "Signed up",
            people: 30,
            conversionFromStart: 0.15,
            conversionFromPrevious: 0.25,
            droppedOff: 90,
            medianMsFromPrevious: 3600000,
          },
        ],
      });
    });

    test("a funnel nobody started answers zeros, never a division by zero", async () => {
      const result: CallResult = await callAsOwner(
        PRODUCT_ANALYTICS_FUNNEL_ROUTE,
        { steps: [SESSION_START, SIGNED_UP] },
      );

      expect(result.jsonBody).toEqual({
        windowMs: DEFAULT_PRODUCT_ANALYTICS_FUNNEL_WINDOW_MS,
        steps: [
          {
            kind: ProductAnalyticsEventKind.Session,
            name: "",
            people: 0,
            conversionFromStart: 0,
            conversionFromPrevious: 1,
            droppedOff: 0,
            medianMsFromPrevious: null,
          },
          {
            kind: ProductAnalyticsEventKind.Custom,
            name: "Signed up",
            people: 0,
            conversionFromStart: 0,
            conversionFromPrevious: 0,
            droppedOff: 0,
            medianMsFromPrevious: null,
          },
        ],
      });
    });
  });

  describe("retention", () => {
    test("reads weekly cohorts in UTC by default", async () => {
      const retention: jest.SpyInstance = jest.spyOn(
        RumProductAnalyticsEventReadService,
        "getRetention",
      );

      await callAsOwner(PRODUCT_ANALYTICS_RETENTION_ROUTE, {
        startEvent: SESSION_START,
        returnEvent: SIGNED_UP,
      });

      const argument: Record<string, unknown> = argumentOf(retention);

      expect(argument["period"]).toBe(ProductAnalyticsRetentionPeriod.Week);
      expect(argument["timeZone"]).toBe("UTC");
      expect(argument["startEvent"]).toEqual({
        kind: ProductAnalyticsEventKind.Session,
        name: "",
      });
      expect(argument["returnEvent"]).toEqual({
        kind: ProductAnalyticsEventKind.Custom,
        name: "Signed up",
      });
    });

    test.each(PRODUCT_ANALYTICS_RETENTION_PERIODS)(
      "takes period %p",
      async (period: ProductAnalyticsRetentionPeriod) => {
        const retention: jest.SpyInstance = jest.spyOn(
          RumProductAnalyticsEventReadService,
          "getRetention",
        );

        await callAsOwner(PRODUCT_ANALYTICS_RETENTION_ROUTE, {
          ...minimalBody(PRODUCT_ANALYTICS_RETENTION_ROUTE),
          period: period,
        });

        expect(argumentOf(retention)["period"]).toBe(period);
      },
    );

    test.each(["year", "", "Week", 7])(
      "refuses period %p before any query",
      async (period: unknown) => {
        await expectRefused(
          PRODUCT_ANALYTICS_RETENTION_ROUTE,
          {
            ...minimalBody(PRODUCT_ANALYTICS_RETENTION_ROUTE),
            period: period as never,
          },
          "period",
        );
      },
    );

    test("refuses a missing start or return event", async () => {
      await expectRefused(
        PRODUCT_ANALYTICS_RETENTION_ROUTE,
        { returnEvent: SIGNED_UP },
        "startEvent",
      );
      await expectRefused(
        PRODUCT_ANALYTICS_RETENTION_ROUTE,
        { startEvent: SESSION_START, returnEvent: { kind: "custom" } },
        "returnEvent",
      );
    });

    test("a range with more periods than the table holds is refused, and says what to do", async () => {
      /* The periods read answers 32 days: one more than a day table holds. */
      const days: Array<string> = [];

      for (let index: number = 1; index <= 32; index++) {
        days.push(`2026-03-${String(index).padStart(2, "0")}`);
      }

      querySpy.mockResolvedValue(
        fakeResultSet([{ paPeriods: days }]) as never,
      );

      const result: CallResult = await callAsOwner(
        PRODUCT_ANALYTICS_RETENTION_ROUTE,
        {
          ...minimalBody(PRODUCT_ANALYTICS_RETENTION_ROUTE),
          period: ProductAnalyticsRetentionPeriod.Day,
        },
      );

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect((result.thrownToNext as Error).message).toContain(
        "longer period",
      );
      /* Only the periods were read. */
      expect(querySpy).toHaveBeenCalledTimes(1);
    });

    test("answers a cohort a row, null for a period not yet begun", async () => {
      querySpy.mockImplementation(async (statement: unknown) => {
        const query: string = (statement as Statement).query;

        if (query.includes("paPeriods")) {
          return fakeResultSet([
            { paPeriods: ["2026-03-02", "2026-03-09", "2026-03-16"] },
          ]);
        }

        return fakeResultSet([
          { paCohortText: "2026-03-02", paOffsetValue: -1, paPeople: 10 },
          { paCohortText: "2026-03-02", paOffsetValue: 0, paPeople: 10 },
          { paCohortText: "2026-03-02", paOffsetValue: 2, paPeople: 4 },
          { paCohortText: "2026-03-09", paOffsetValue: -1, paPeople: 5 },
          { paCohortText: "2026-03-09", paOffsetValue: 1, paPeople: 2 },
        ]);
      });

      const result: CallResult = await callAsOwner(
        PRODUCT_ANALYTICS_RETENTION_ROUTE,
        {
          ...minimalBody(PRODUCT_ANALYTICS_RETENTION_ROUTE),
          timeZone: "Europe/Berlin",
        },
      );

      expect(result.jsonBody).toEqual({
        period: ProductAnalyticsRetentionPeriod.Week,
        timeZone: "Europe/Berlin",
        cohorts: [
          { start: "2026-03-02", people: 10, returning: [10, 0, 4] },
          { start: "2026-03-09", people: 5, returning: [0, 2, null] },
          { start: "2026-03-16", people: 0, returning: [0, null, null] },
        ],
      });
    });
  });
});
