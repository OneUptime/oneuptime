import "../TestingUtils/Init";
import BaseAnalyticsAPI from "../../../Server/API/BaseAnalyticsAPI";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import AnalyticsDatabaseService from "../../../Server/Services/AnalyticsDatabaseService";
import ProjectService from "../../../Server/Services/ProjectService";
import ModelPermission from "../../../Server/Types/AnalyticsDatabase/ModelPermission";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Log from "../../../Models/AnalyticsModels/Log";
import MonitorLog from "../../../Models/AnalyticsModels/MonitorLog";
import { mockRouter } from "./Helpers";
import { getJestSpyOn } from "../../Spy";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * POST /<analytics-model>/aggregate keeps a short-lived cache in front of
 * AnalyticsDatabaseService.aggregateBy — and aggregateBy is where the read
 * check lives. A hit used to be answered before that check ever ran, keyed
 * only on the caller-supplied tenant plus the query. getUserMiddleware
 * accepts the `tenantid` header even from an anonymous caller, so for the
 * cache TTL anyone could read another user's Log / Span / Metric / AuditLog
 * aggregate for any project whose id they knew, and a member whose read was
 * narrower (no read on the model, Owned- or label-scoped) got the wider
 * result someone else had just cached.
 *
 * These tests pin the gate in front of the cache: the caller must pass the
 * same read check the live path runs before the cache is even consulted,
 * and the slot is keyed on the raw request plus the permission-scoped
 * query, so callers with different access never share one.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

/*
 * Billing on, so the unpaid-subscription gate in the read check is live.
 * It only fires when props.currentPlan is set, and every test except the
 * unpaid one gets plan: null from getCurrentPlan, which leaves it unset.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: true,
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "5f8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d",
);
const OWNED_SERVICE_ID: ObjectID = new ObjectID(
  "7b8c9d0e-1f2a-4b3c-8d4e-5f6a7b8c9d0e",
);

/*
 * What another user's earlier request left in the cache. The tests that
 * must not see it assert that neither this body nor anything else from the
 * cache reaches the response.
 */
const CACHED_BODY: JSONObject = {
  data: [{ timestamp: "2026-09-18T00:00:00.000Z", value: 4242 }],
  truncated: false,
};

const LIVE_BODY: JSONObject = {
  data: [{ timestamp: "2026-09-18T00:00:00.000Z", value: 7 }],
  truncated: false,
};

type SpyInstance = ReturnType<typeof getJestSpyOn>;

type CallResult = {
  thrownToNext: unknown;
  sentBody: JSONObject | undefined;
};

function buildAggregateBody(data: {
  aggregateColumnName: string;
  query?: JSONObject | undefined;
}): JSONObject {
  return {
    aggregateBy: JSONFunctions.serialize({
      aggregateColumnName: data.aggregateColumnName,
      aggregationType: AggregationType.Count,
      aggregationTimestampColumnName: "time",
      startTimestamp: new Date("2026-09-17T00:00:00.000Z"),
      endTimestamp: new Date("2026-09-18T00:00:00.000Z"),
      query: data.query || {},
      limit: 10,
      skip: 0,
    } as JSONObject),
  };
}

function buildTenantPermissions(
  projectId: ObjectID,
  permissions: Array<UserPermission>,
): UserTenantAccessPermission {
  return {
    _type: "UserTenantAccessPermission",
    projectId,
    permissions,
  };
}

function grant(
  permission: Permission,
  scope?: PermissionScope | undefined,
): UserPermission {
  return {
    _type: "UserPermission",
    permission,
    labelIds: [],
    isBlockPermission: false,
    ...(scope ? { scope } : {}),
  };
}

/*
 * The request as getUserMiddleware leaves it for a logged-in user: the
 * tenant from the header, the decoded token, and the permissions it loaded
 * from Postgres. Driving the real middleware here would need a signed JWT
 * and a database, and it is not what is under test.
 */
function buildMemberRequest(data: {
  body: JSONObject;
  tenantPermissions: Dictionary<UserTenantAccessPermission>;
  projectIds?: Array<ObjectID> | undefined;
  headers?: Dictionary<string> | undefined;
}): ExpressRequest {
  const globalPermission: UserGlobalAccessPermission = {
    _type: "UserGlobalAccessPermission",
    projectIds: data.projectIds || [PROJECT_ID],
    globalPermissions: [Permission.Public, Permission.User],
  };

  return {
    params: {},
    query: {},
    headers: { tenantid: PROJECT_ID.toString(), ...(data.headers || {}) },
    body: data.body,
    tenantId: PROJECT_ID,
    userType: UserType.User,
    userAuthorization: {
      userId: ObjectID.generate(),
      email: "member@example.com",
      name: "Member",
      isMasterAdmin: false,
    },
    userGlobalAccessPermission: globalPermission,
    userTenantAccessPermission: data.tenantPermissions,
    userTeamIds: [],
  } as unknown as ExpressRequest;
}

/*
 * The request as ProjectMiddleware leaves it for a project API key: the
 * tenant comes from the key itself, there is no user id, and the tenant
 * permissions are the grants configured on the key.
 */
function buildApiKeyRequest(data: {
  body: JSONObject;
  keyPermissions: Array<UserPermission>;
}): ExpressRequest {
  return {
    params: {},
    query: {},
    headers: { tenantid: PROJECT_ID.toString() },
    body: data.body,
    tenantId: PROJECT_ID,
    userType: UserType.API,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
        Permission.AuthenticatedRequest,
      ],
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: buildTenantPermissions(
        PROJECT_ID,
        data.keyPermissions,
      ),
    },
  } as unknown as ExpressRequest;
}

/*
 * A master admin: no membership in the project at all, which the read check
 * admits through its root branch.
 */
function buildMasterAdminRequest(data: { body: JSONObject }): ExpressRequest {
  return {
    params: {},
    query: {},
    headers: { tenantid: PROJECT_ID.toString() },
    body: data.body,
    tenantId: PROJECT_ID,
    userType: UserType.MasterAdmin,
    userAuthorization: {
      userId: ObjectID.generate(),
      email: "admin@example.com",
      name: "Admin",
      isMasterAdmin: true,
    },
  } as unknown as ExpressRequest;
}

async function callAggregateRoute(data: {
  uri: string;
  req: ExpressRequest;
  runUserMiddleware?: boolean | undefined;
}): Promise<CallResult> {
  const res: ExpressResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
    "POST",
    data.uri,
  );

  let thrownToNext: unknown = undefined;
  const handlerNext: NextFunction = ((err?: unknown) => {
    thrownToNext = err;
  }) as NextFunction;

  if (data.runUserMiddleware) {
    let reachedHandler: boolean = false;
    await route.middlewares[0]!(data.req, res, (() => {
      reachedHandler = true;
    }) as NextFunction);
    expect(reachedHandler).toBe(true);
  }

  await route.handlerFunction(data.req, res, handlerNext);

  const sendJsonObjectResponse: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  const lastCall: Array<unknown> | undefined =
    sendJsonObjectResponse.mock.calls[
      sendJsonObjectResponse.mock.calls.length - 1
    ];

  return {
    thrownToNext,
    sentBody: lastCall ? (lastCall[2] as JSONObject) : undefined,
  };
}

describe("BaseAnalyticsAPI aggregate cache authorization", () => {
  let monitorLogService: AnalyticsDatabaseService<MonitorLog>;
  let logService: AnalyticsDatabaseService<Log>;
  let cacheRead: SpyInstance;
  let cacheWrite: SpyInstance;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockRouter.routes = [];

    monitorLogService = new AnalyticsDatabaseService<MonitorLog>({
      modelType: MonitorLog,
    });
    logService = new AnalyticsDatabaseService<Log>({ modelType: Log });

    new BaseAnalyticsAPI<MonitorLog, AnalyticsDatabaseService<MonitorLog>>(
      MonitorLog,
      monitorLogService,
    );
    new BaseAnalyticsAPI<Log, AnalyticsDatabaseService<Log>>(Log, logService);

    // Never ClickHouse: a call here means the request got past the gate.
    getJestSpyOn(monitorLogService, "aggregateBy").mockResolvedValue(LIVE_BODY);
    getJestSpyOn(logService, "aggregateBy").mockResolvedValue(LIVE_BODY);

    getJestSpyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: null,
      isSubscriptionUnpaid: false,
    });
    getJestSpyOn(ProjectService, "updateLastActive").mockResolvedValue(
      undefined,
    );

    // A warm cache: every slot holds another user's result.
    cacheRead = getJestSpyOn(GlobalCache, "getJSONObject").mockResolvedValue(
      CACHED_BODY,
    );
    cacheWrite = getJestSpyOn(GlobalCache, "setJSON").mockResolvedValue(
      undefined,
    );
  });

  test("an anonymous caller with only a tenantid header gets 401 and the cache is never read", async () => {
    const req: ExpressRequest = {
      params: {},
      query: {},
      headers: { tenantid: PROJECT_ID.toString() },
      body: buildAggregateBody({ aggregateColumnName: "time" }),
    } as unknown as ExpressRequest;

    const result: CallResult = await callAggregateRoute({
      uri: "/monitor-log/aggregate",
      req,
      runUserMiddleware: true,
    });

    // The middleware really did take the tenant from the header.
    expect((req as unknown as { tenantId: ObjectID }).tenantId.toString()).toBe(
      PROJECT_ID.toString(),
    );

    expect(result.thrownToNext).toBeInstanceOf(NotAuthenticatedException);
    expect((result.thrownToNext as NotAuthenticatedException).code).toBe(401);
    expect(result.sentBody).toBeUndefined();
    expect(cacheRead).not.toHaveBeenCalled();
    expect(cacheWrite).not.toHaveBeenCalled();
    expect(monitorLogService.aggregateBy).not.toHaveBeenCalled();
  });

  test("a project member without read permission on the model gets 422 and the cache is never read", async () => {
    const tenantPermissions: Dictionary<UserTenantAccessPermission> = {
      [PROJECT_ID.toString()]: buildTenantPermissions(PROJECT_ID, [
        grant(Permission.ReadProjectIncident),
      ]),
    };

    const result: CallResult = await callAggregateRoute({
      uri: "/monitor-log/aggregate",
      req: buildMemberRequest({
        body: buildAggregateBody({ aggregateColumnName: "time" }),
        tenantPermissions,
      }),
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as NotAuthorizedException).code).toBe(422);
    expect(result.sentBody).toBeUndefined();
    expect(cacheRead).not.toHaveBeenCalled();
    expect(cacheWrite).not.toHaveBeenCalled();
    expect(monitorLogService.aggregateBy).not.toHaveBeenCalled();
  });

  test("a member with read permission is still served from the cache", async () => {
    const tenantPermissions: Dictionary<UserTenantAccessPermission> = {
      [PROJECT_ID.toString()]: buildTenantPermissions(PROJECT_ID, [
        grant(Permission.ProjectMember),
      ]),
    };

    const result: CallResult = await callAggregateRoute({
      uri: "/monitor-log/aggregate",
      req: buildMemberRequest({
        body: buildAggregateBody({ aggregateColumnName: "time" }),
        tenantPermissions,
      }),
    });

    expect(result.thrownToNext).toBeUndefined();
    expect(result.sentBody).toEqual(CACHED_BODY);
    expect(cacheRead).toHaveBeenCalledTimes(1);
    expect(cacheRead.mock.calls[0]![0]).toBe("MonitorLog-aggregate");
    expect(
      cacheRead.mock.calls[0]![1].startsWith(`${PROJECT_ID.toString()}:`),
    ).toBe(true);
    expect(monitorLogService.aggregateBy).not.toHaveBeenCalled();
  });

  test("two members with the same unrestricted read share one cache slot", async () => {
    const readers: Array<Permission> = [
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
    ];

    for (const permission of readers) {
      await callAggregateRoute({
        uri: "/monitor-log/aggregate",
        req: buildMemberRequest({
          body: buildAggregateBody({ aggregateColumnName: "time" }),
          tenantPermissions: {
            [PROJECT_ID.toString()]: buildTenantPermissions(PROJECT_ID, [
              grant(permission),
            ]),
          },
        }),
      });
    }

    expect(cacheRead).toHaveBeenCalledTimes(2);
    expect(cacheRead.mock.calls[0]![1]).toBe(cacheRead.mock.calls[1]![1]);
  });

  test("an Owned-scoped member does not get the slot an unrestricted member filled", async () => {
    /*
     * resolveOwnedParentIds reads ServiceOwnerUser / ServiceOwnerTeam from
     * Postgres; here the member owns exactly one service.
     */
    const resolveOwned: SpyInstance = getJestSpyOn(
      ModelPermission,
      "resolveOwnedParentIds",
    ).mockResolvedValue(new Set<string>([OWNED_SERVICE_ID.toString()]));

    // The unrestricted member misses, runs live, and fills their slot.
    cacheRead.mockResolvedValue(null);

    await callAggregateRoute({
      uri: "/logs/aggregate",
      req: buildMemberRequest({
        body: buildAggregateBody({ aggregateColumnName: "severityNumber" }),
        tenantPermissions: {
          [PROJECT_ID.toString()]: buildTenantPermissions(PROJECT_ID, [
            grant(Permission.ProjectMember),
          ]),
        },
      }),
    });

    expect(cacheWrite).toHaveBeenCalledTimes(1);
    const unrestrictedKey: string = cacheWrite.mock.calls[0]![1];
    expect(resolveOwned).not.toHaveBeenCalled();

    // From now on only that slot is warm.
    cacheRead.mockImplementation(
      async (_namespace: string, key: string): Promise<JSONObject | null> => {
        return key === unrestrictedKey ? CACHED_BODY : null;
      },
    );

    const result: CallResult = await callAggregateRoute({
      uri: "/logs/aggregate",
      req: buildMemberRequest({
        body: buildAggregateBody({ aggregateColumnName: "severityNumber" }),
        tenantPermissions: {
          [PROJECT_ID.toString()]: buildTenantPermissions(PROJECT_ID, [
            grant(Permission.ReadTelemetryServiceLog, PermissionScope.Owned),
          ]),
        },
      }),
    });

    expect(resolveOwned).toHaveBeenCalled();
    const ownedKey: string = cacheRead.mock.calls[1]![1];
    expect(ownedKey).not.toBe(unrestrictedKey);
    // The slot is keyed on what the member may actually see.
    expect(ownedKey).toContain(OWNED_SERVICE_ID.toString());

    expect(result.thrownToNext).toBeUndefined();
    expect(result.sentBody).toEqual(LIVE_BODY);
    expect(logService.aggregateBy).toHaveBeenCalledTimes(2);
  });

  test("a multi-tenant request does not share the slot of a single-project request for the same tenant", async () => {
    const tenantPermissions: Dictionary<UserTenantAccessPermission> = {
      [PROJECT_ID.toString()]: buildTenantPermissions(PROJECT_ID, [
        grant(Permission.ProjectMember),
      ]),
      [OTHER_PROJECT_ID.toString()]: buildTenantPermissions(OTHER_PROJECT_ID, [
        grant(Permission.ProjectMember),
      ]),
    };

    await callAggregateRoute({
      uri: "/monitor-log/aggregate",
      req: buildMemberRequest({
        body: buildAggregateBody({ aggregateColumnName: "time" }),
        tenantPermissions,
        projectIds: [PROJECT_ID, OTHER_PROJECT_ID],
        headers: { "is-multi-tenant-query": "true" },
      }),
    });

    await callAggregateRoute({
      uri: "/monitor-log/aggregate",
      req: buildMemberRequest({
        body: buildAggregateBody({ aggregateColumnName: "time" }),
        tenantPermissions: {
          [PROJECT_ID.toString()]: tenantPermissions[PROJECT_ID.toString()]!,
        },
      }),
    });

    expect(cacheRead).toHaveBeenCalledTimes(2);
    const multiTenantKey: string = cacheRead.mock.calls[0]![1];
    const singleProjectKey: string = cacheRead.mock.calls[1]![1];

    expect(multiTenantKey).toContain(OTHER_PROJECT_ID.toString());
    expect(singleProjectKey).not.toContain(OTHER_PROJECT_ID.toString());
    expect(multiTenantKey).not.toBe(singleProjectKey);
  });

  test("a member who can read the model but not the aggregated column gets 422 and the cache is never read", async () => {
    // retentionDate carries no read grants at all: only root may read it.
    const result: CallResult = await callAggregateRoute({
      uri: "/monitor-log/aggregate",
      req: buildMemberRequest({
        body: buildAggregateBody({ aggregateColumnName: "retentionDate" }),
        tenantPermissions: {
          [PROJECT_ID.toString()]: buildTenantPermissions(PROJECT_ID, [
            grant(Permission.ProjectMember),
          ]),
        },
      }),
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as NotAuthorizedException).code).toBe(422);
    expect(result.sentBody).toBeUndefined();
    expect(cacheRead).not.toHaveBeenCalled();
    expect(monitorLogService.aggregateBy).not.toHaveBeenCalled();
  });

  test("a member filtering on a column they cannot read gets 422 and the cache is never read", async () => {
    const result: CallResult = await callAggregateRoute({
      uri: "/monitor-log/aggregate",
      req: buildMemberRequest({
        body: buildAggregateBody({
          aggregateColumnName: "time",
          query: { retentionDate: new Date("2026-10-01T00:00:00.000Z") },
        }),
        tenantPermissions: {
          [PROJECT_ID.toString()]: buildTenantPermissions(PROJECT_ID, [
            grant(Permission.ProjectMember),
          ]),
        },
      }),
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as NotAuthorizedException).code).toBe(422);
    expect(cacheRead).not.toHaveBeenCalled();
    expect(monitorLogService.aggregateBy).not.toHaveBeenCalled();
  });

  test("a member of a project with an unpaid subscription gets 402 and the cache is never read", async () => {
    getJestSpyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Growth,
      isSubscriptionUnpaid: true,
    });

    const result: CallResult = await callAggregateRoute({
      uri: "/monitor-log/aggregate",
      req: buildMemberRequest({
        body: buildAggregateBody({ aggregateColumnName: "time" }),
        tenantPermissions: {
          [PROJECT_ID.toString()]: buildTenantPermissions(PROJECT_ID, [
            grant(Permission.ProjectMember),
          ]),
        },
      }),
    });

    expect(result.thrownToNext).toBeInstanceOf(PaymentRequiredException);
    expect((result.thrownToNext as PaymentRequiredException).code).toBe(402);
    expect(cacheRead).not.toHaveBeenCalled();
    expect(monitorLogService.aggregateBy).not.toHaveBeenCalled();
  });

  test("an API key with read permission is served from the same slot as a member", async () => {
    const body: JSONObject = buildAggregateBody({
      aggregateColumnName: "time",
    });

    await callAggregateRoute({
      uri: "/monitor-log/aggregate",
      req: buildMemberRequest({
        body,
        tenantPermissions: {
          [PROJECT_ID.toString()]: buildTenantPermissions(PROJECT_ID, [
            grant(Permission.ProjectMember),
          ]),
        },
      }),
    });

    const result: CallResult = await callAggregateRoute({
      uri: "/monitor-log/aggregate",
      req: buildApiKeyRequest({
        body,
        keyPermissions: [grant(Permission.ReadProjectMonitor)],
      }),
    });

    expect(result.thrownToNext).toBeUndefined();
    expect(result.sentBody).toEqual(CACHED_BODY);
    expect(cacheRead).toHaveBeenCalledTimes(2);
    expect(cacheRead.mock.calls[1]![1]).toBe(cacheRead.mock.calls[0]![1]);
    expect(monitorLogService.aggregateBy).not.toHaveBeenCalled();
  });

  test("an API key without read permission on the model gets 422 and the cache is never read", async () => {
    const result: CallResult = await callAggregateRoute({
      uri: "/monitor-log/aggregate",
      req: buildApiKeyRequest({
        body: buildAggregateBody({ aggregateColumnName: "time" }),
        keyPermissions: [grant(Permission.ReadProjectIncident)],
      }),
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as NotAuthorizedException).code).toBe(422);
    expect(cacheRead).not.toHaveBeenCalled();
    expect(monitorLogService.aggregateBy).not.toHaveBeenCalled();
  });

  test("a master admin who is not a project member is served from the same slot as an unrestricted member", async () => {
    const body: JSONObject = buildAggregateBody({
      aggregateColumnName: "time",
    });

    await callAggregateRoute({
      uri: "/monitor-log/aggregate",
      req: buildMemberRequest({
        body,
        tenantPermissions: {
          [PROJECT_ID.toString()]: buildTenantPermissions(PROJECT_ID, [
            grant(Permission.ProjectMember),
          ]),
        },
      }),
    });

    const result: CallResult = await callAggregateRoute({
      uri: "/monitor-log/aggregate",
      req: buildMasterAdminRequest({ body }),
    });

    expect(result.thrownToNext).toBeUndefined();
    expect(result.sentBody).toEqual(CACHED_BODY);
    expect(cacheRead).toHaveBeenCalledTimes(2);
    expect(cacheRead.mock.calls[1]![1]).toBe(cacheRead.mock.calls[0]![1]);
  });

  test("requests that scope to the same query but differ in the raw query never share a slot", async () => {
    /*
     * Scoping overwrites projectId, so both requests below scope to the
     * same query. MetricService still plans from the raw projectId (point
     * type, rollup routing), so they can compute different results and
     * must not share a slot.
     */
    const tenantPermissions: Dictionary<UserTenantAccessPermission> = {
      [PROJECT_ID.toString()]: buildTenantPermissions(PROJECT_ID, [
        grant(Permission.ProjectMember),
      ]),
    };

    cacheRead.mockResolvedValue(null);

    await callAggregateRoute({
      uri: "/monitor-log/aggregate",
      req: buildMemberRequest({
        body: buildAggregateBody({
          aggregateColumnName: "time",
          query: { projectId: PROJECT_ID },
        }),
        tenantPermissions,
      }),
    });

    expect(cacheWrite).toHaveBeenCalledTimes(1);
    const firstKey: string = cacheWrite.mock.calls[0]![1];

    cacheRead.mockImplementation(
      async (_namespace: string, key: string): Promise<JSONObject | null> => {
        return key === firstKey ? CACHED_BODY : null;
      },
    );

    const result: CallResult = await callAggregateRoute({
      uri: "/monitor-log/aggregate",
      req: buildMemberRequest({
        body: buildAggregateBody({
          aggregateColumnName: "time",
          query: { projectId: OTHER_PROJECT_ID },
        }),
        tenantPermissions,
      }),
    });

    expect(cacheRead.mock.calls[1]![1]).not.toBe(firstKey);
    expect(result.sentBody).toEqual(LIVE_BODY);
    expect(monitorLogService.aggregateBy).toHaveBeenCalledTimes(2);
  });
});
