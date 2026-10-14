import CommonAPI from "../../../Server/API/CommonAPI";
import MonitorAPI from "../../../Server/API/MonitorAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ActiveMonitorLimit from "../../../Server/Utils/Billing/ActiveMonitorLimit";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ActiveMonitorLimitUtil, {
  ActiveMonitorLimitKind,
  ActiveMonitorLimitStatus,
  NO_ACTIVE_MONITOR_LIMIT,
} from "../../../Types/Monitor/ActiveMonitorLimit";
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
  test,
} from "@jest/globals";

/*
 * GET /monitor/active-monitor-limit
 *
 * The project's limit on active monitors and, when it has one, how many it
 * has - what the monitor list and the Create Monitor page say before anyone
 * fills in a form the server would refuse (ActiveMonitorLimit.getStatus).
 * It counts as root, so the route itself asks for an authenticated member
 * of the tenant who may read its monitors, before it counts anything; it
 * answers only the tenant's own project, and is never cached.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

const ROUTE: string = "/monitor/active-monitor-limit";

const PERMISSION_MESSAGE: string =
  "You do not have permission to read this project's monitors.";

function buildProps(data: {
  projectId: ObjectID;
  userId: ObjectID;
  permissions: Array<Permission>;
  blocks?: Array<Permission> | undefined;
}): DatabaseCommonInteractionProps {
  const grants: Array<UserPermission> = [
    ...data.permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
    ...(data.blocks || []).map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: true,
      };
    }),
  ];

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: data.projectId,
    permissions: grants,
  };

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[data.projectId.toString()] = tenantPermission;

  return {
    tenantId: data.projectId,
    userId: data.userId,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
  };
}

interface RouteCallResult {
  thrownToNext: unknown;
  nextCallCount: number;
  req: ExpressRequest;
  res: ExpressResponse;
}

async function callRoute(): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    body: {},
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("GET", ROUTE)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
    req: req,
    res: res,
  };
}

describe("GET /monitor/active-monitor-limit", () => {
  let projectId: ObjectID;
  let userId: ObjectID;
  let propsSpy: jest.SpyInstance;
  let statusSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new MonitorAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    projectId = ObjectID.generate();
    userId = ObjectID.generate();

    propsSpy = jest.spyOn(CommonAPI, "getDatabaseCommonInteractionProps");
    statusSpy = jest
      .spyOn(ActiveMonitorLimit, "getStatus")
      .mockResolvedValue(NO_ACTIVE_MONITOR_LIMIT);

    mockCaller([Permission.MonitorViewer]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockCaller(
    permissions: Array<Permission>,
    blocks?: Array<Permission>,
  ): void {
    propsSpy.mockResolvedValue(
      buildProps({
        projectId: projectId,
        userId: userId,
        permissions: permissions,
        blocks: blocks,
      }),
    );
  }

  function sentBody(): JSONObject {
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    return (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
      .calls[0]![2] as JSONObject;
  }

  function expectNothingCounted(): void {
    expect(statusSpy).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  }

  test("is mounted behind getUserMiddleware", () => {
    expect(mockRouter.match("GET", ROUTE).middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
    ]);
  });

  /*
   * The support report's project: a plan of 500, 2,881 active monitors.
   * The dashboard reads it back with ActiveMonitorLimitUtil.fromJSON.
   */
  test("tells a member who may read monitors the tenant's limit and how many it has, uncached", async () => {
    const status: ActiveMonitorLimitStatus = {
      limit: { limit: 500, kind: ActiveMonitorLimitKind.Plan },
      activeMonitors: 2881,
    };
    statusSpy.mockResolvedValue(status);

    const result: RouteCallResult = await callRoute();

    expect(result.nextCallCount).toBe(0);
    expect(statusSpy).toHaveBeenCalledTimes(1);
    expect((statusSpy.mock.calls[0]![0] as ObjectID).toString()).toBe(
      projectId.toString(),
    );
    expect(Response.setNoCacheHeaders).toHaveBeenCalledWith(result.res);

    const body: JSONObject = sentBody();
    expect(body).toEqual({
      limit: { limit: 500, kind: "Plan" },
      activeMonitors: 2881,
    });
    expect(ActiveMonitorLimitUtil.fromJSON(body)).toEqual(status);
  });

  test("tells a project with no limit so", async () => {
    await callRoute();

    expect(sentBody()).toEqual({ limit: null, activeMonitors: null });
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.MonitorAdmin,
    Permission.MonitorMember,
  ])("answers a %s", async (permission: Permission) => {
    mockCaller([permission]);

    const result: RouteCallResult = await callRoute();

    expect(result.nextCallCount).toBe(0);
    expect(statusSpy).toHaveBeenCalledTimes(1);
  });

  test("refuses an unauthenticated caller before counting anything", async () => {
    propsSpy.mockResolvedValue({});

    const result: RouteCallResult = await callRoute();

    expect(result.thrownToNext).toBeInstanceOf(NotAuthenticatedException);
    expectNothingCounted();
  });

  test("refuses a caller with no project before counting anything", async () => {
    propsSpy.mockResolvedValue({ userId: userId, userType: UserType.User });

    const result: RouteCallResult = await callRoute();

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect((result.thrownToNext as Exception).message).toBe(
      "Project ID is required",
    );
    expectNothingCounted();
  });

  test("refuses someone who is not a member of the project they named", async () => {
    const props: DatabaseCommonInteractionProps = buildProps({
      projectId: ObjectID.generate(),
      userId: userId,
      permissions: [Permission.ProjectOwner],
    });
    props.tenantId = projectId;
    propsSpy.mockResolvedValue(props);

    const result: RouteCallResult = await callRoute();

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expectNothingCounted();
  });

  test("refuses a member who may not read monitors", async () => {
    mockCaller([Permission.ReadProjectIncident]);

    const result: RouteCallResult = await callRoute();

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as Exception).message).toBe(PERMISSION_MESSAGE);
    expectNothingCounted();
  });

  test("refuses a member whose team is blocked from reading monitors", async () => {
    mockCaller([Permission.MonitorViewer], [Permission.MonitorViewer]);

    const result: RouteCallResult = await callRoute();

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expectNothingCounted();
  });
});
