import CommonAPI from "../../../Server/API/CommonAPI";
import MonitorAPI from "../../../Server/API/MonitorAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import CloudEndpointSuggestions from "../../../Server/Utils/CloudConnection/CloudEndpointSuggestions";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CloudEndpointSuggestion } from "../../../Types/Cloud/CloudEndpointMatch";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
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
  test,
} from "@jest/globals";

/*
 * GET /monitor/cloud-resource-suggestions/:monitorId
 *
 * The cloud resources a monitor seems to check by its host, for its Linked
 * Resources card. The route asks for an authenticated member of the tenant
 * who may read monitors and cloud resources and a well-formed id before
 * anything is read; the suggestions themselves are read with the caller's
 * props (CloudEndpointSuggestions), and never cached.
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

const ROUTE: string = "/monitor/cloud-resource-suggestions/:monitorId";

function buildProps(data: {
  projectId: ObjectID;
  userId: ObjectID;
  permissions: Array<Permission>;
}): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: data.projectId,
    permissions: data.permissions.map(
      (permission: Permission): UserPermission => {
        return {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
          isBlockPermission: false,
        };
      },
    ),
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
  res: ExpressResponse;
}

async function callRoute(monitorId: string): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: { monitorId },
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
    res: res,
  };
}

const SUGGESTION: CloudEndpointSuggestion = {
  cloudResourceId: "33333333-3333-4333-8333-333333333333",
  name: "web-alb",
  type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
  provider: "aws",
  endpoint: "web-alb-123.eu-west-1.elb.amazonaws.com",
  via: "shop.example.com",
};

describe("GET /monitor/cloud-resource-suggestions/:monitorId", () => {
  let projectId: ObjectID;
  let userId: ObjectID;
  let monitorId: ObjectID;
  let propsSpy: jest.SpyInstance;
  let suggestSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new MonitorAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    projectId = ObjectID.generate();
    userId = ObjectID.generate();
    monitorId = ObjectID.generate();

    propsSpy = jest.spyOn(CommonAPI, "getDatabaseCommonInteractionProps");
    suggestSpy = jest
      .spyOn(CloudEndpointSuggestions, "forMonitor")
      .mockResolvedValue([SUGGESTION]);

    mockCaller([Permission.ProjectMember]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockCaller(permissions: Array<Permission>): void {
    propsSpy.mockResolvedValue(buildProps({ projectId, userId, permissions }));
  }

  function expectNothingRead(): void {
    expect(suggestSpy).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  }

  test("is mounted behind getUserMiddleware", () => {
    expect(mockRouter.match("GET", ROUTE).middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
    ]);
  });

  test("answers a member with the suggestions read with their own props, uncached", async () => {
    const result: RouteCallResult = await callRoute(monitorId.toString());

    expect(result.nextCallCount).toBe(0);
    expect(suggestSpy).toHaveBeenCalledTimes(1);

    const call: {
      monitorId: ObjectID;
      projectId: ObjectID;
      props: DatabaseCommonInteractionProps;
    } = suggestSpy.mock.calls[0]![0] as {
      monitorId: ObjectID;
      projectId: ObjectID;
      props: DatabaseCommonInteractionProps;
    };
    expect(call.monitorId.toString()).toBe(monitorId.toString());
    expect(call.projectId.toString()).toBe(projectId.toString());
    expect(call.props.userId?.toString()).toBe(userId.toString());
    expect(call.props.isRoot).toBeFalsy();

    expect(Response.setNoCacheHeaders).toHaveBeenCalledWith(result.res);
    expect(
      (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
        .calls[0]![2] as JSONObject,
    ).toEqual({ suggestions: [SUGGESTION] });
  });

  test("refuses an unauthenticated caller before reading anything", async () => {
    propsSpy.mockResolvedValue({});

    const result: RouteCallResult = await callRoute(monitorId.toString());

    expect(result.thrownToNext).toBeInstanceOf(NotAuthenticatedException);
    expectNothingRead();
  });

  test("refuses someone who is not a member of the project they named", async () => {
    const props: DatabaseCommonInteractionProps = buildProps({
      projectId: ObjectID.generate(),
      userId,
      permissions: [Permission.ProjectOwner],
    });
    props.tenantId = projectId;
    propsSpy.mockResolvedValue(props);

    const result: RouteCallResult = await callRoute(monitorId.toString());

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expectNothingRead();
  });

  test("refuses an id that is not one", async () => {
    const result: RouteCallResult = await callRoute("not-a-monitor");

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expectNothingRead();
  });

  test("refuses a member who may read cloud resources but not monitors", async () => {
    mockCaller([Permission.ReadCloudResource]);

    const result: RouteCallResult = await callRoute(monitorId.toString());

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as Exception).message).toBe(
      "You do not have permission to read this project's monitors.",
    );
    expectNothingRead();
  });

  test("refuses a member who may read monitors but not cloud resources", async () => {
    mockCaller([Permission.MonitorViewer]);

    const result: RouteCallResult = await callRoute(monitorId.toString());

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as Exception).message).toBe(
      "You do not have permission to read this project's cloud resources.",
    );
    expectNothingRead();
  });

  test("a member who may read both is answered", async () => {
    mockCaller([Permission.MonitorViewer, Permission.ReadCloudResource]);

    const result: RouteCallResult = await callRoute(monitorId.toString());

    expect(result.nextCallCount).toBe(0);
    expect(suggestSpy).toHaveBeenCalledTimes(1);
  });
});
