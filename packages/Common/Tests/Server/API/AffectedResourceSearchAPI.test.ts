import AffectedResourceSearchAPI from "../../../Server/API/AffectedResourceSearchAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AffectedResourceSearch from "../../../Server/Utils/AffectedResources/AffectedResourceSearch";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import {
  AFFECTED_RESOURCE_SEARCH_ROUTE,
  AffectedResourceKind,
  AffectedResourceSearchRequest,
  AffectedResourceSearchResult,
} from "../../../Types/AffectedResources/AffectedResourceSearch";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
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
 * POST /affected-resources/search (issue #5341)
 *
 * The Affected Resources picker's one request: what was typed, found
 * across every kind of resource it asks for. The route asks for an
 * authenticated member of the project, or a project API key, and a
 * well-formed request before anything is read; the kinds are then read
 * with the caller's own props (AffectedResourceSearch), never as root, and
 * the answer is never cached.
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
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    setNoCacheHeaders: jest.fn(),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

const HOST_ID: string = "33333333-3333-4333-8333-333333333333";
const DEVICE_ID: string = "44444444-4444-4444-8444-444444444444";

const ANSWER: AffectedResourceSearchResult = {
  kinds: [
    {
      kind: AffectedResourceKind.NetworkDevice,
      count: 2,
      matches: [{ _id: DEVICE_ID, name: "WAN-RTR-01", detail: "10.0.0.1" }],
    },
    {
      kind: AffectedResourceKind.Host,
      count: 1,
      matches: [{ _id: HOST_ID, name: "wan-proxy" }],
    },
  ],
  counts: [{ kind: AffectedResourceKind.Monitor, count: 3 }],
  unreadableKinds: [AffectedResourceKind.DatabaseServer],
};

function buildProps(data: {
  projectId: ObjectID;
  userId?: ObjectID | undefined;
  userType?: UserType | undefined;
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
    userType: data.userType || UserType.User,
    userTenantAccessPermission: permissionMap,
  } as DatabaseCommonInteractionProps;
}

interface RouteCallResult {
  thrownToNext: unknown;
  nextCallCount: number;
  res: ExpressResponse;
}

async function callRoute(body: unknown): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    body: body,
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("POST", AFFECTED_RESOURCE_SEARCH_ROUTE)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
    res: res,
  };
}

describe("POST /affected-resources/search", () => {
  let projectId: ObjectID;
  let userId: ObjectID;
  let propsSpy: jest.SpyInstance;
  let searchSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new AffectedResourceSearchAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    projectId = ObjectID.generate();
    userId = ObjectID.generate();

    propsSpy = jest.spyOn(CommonAPI, "getDatabaseCommonInteractionProps");
    searchSpy = jest
      .spyOn(AffectedResourceSearch, "search")
      .mockResolvedValue(ANSWER);

    propsSpy.mockResolvedValue(
      buildProps({
        projectId,
        userId,
        permissions: [Permission.ProjectMember],
      }),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function expectNothingRead(): void {
    expect(searchSpy).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  }

  function searchCall(): {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    request: AffectedResourceSearchRequest;
  } {
    return searchSpy.mock.calls[0]![0] as {
      projectId: ObjectID;
      props: DatabaseCommonInteractionProps;
      request: AffectedResourceSearchRequest;
    };
  }

  test("is mounted at the route the picker asks, behind getUserMiddleware", () => {
    expect(AFFECTED_RESOURCE_SEARCH_ROUTE).toBe("/affected-resources/search");
    expect(
      mockRouter.match("POST", AFFECTED_RESOURCE_SEARCH_ROUTE).middlewares,
    ).toEqual([UserMiddleware.getUserMiddleware]);
  });

  test("answers a member with every kind read with their own props, uncached", async () => {
    const result: RouteCallResult = await callRoute({
      search: "  wan ",
      kinds: ["NetworkDevice", "Host"],
      limitPerKind: 15,
      countKinds: ["Monitor"],
    });

    expect(result.nextCallCount).toBe(0);
    expect(searchSpy).toHaveBeenCalledTimes(1);

    const call: {
      projectId: ObjectID;
      props: DatabaseCommonInteractionProps;
      request: AffectedResourceSearchRequest;
    } = searchCall();

    expect(call.projectId.toString()).toBe(projectId.toString());
    expect(call.props.userId?.toString()).toBe(userId.toString());
    expect(call.props.isRoot).toBeFalsy();
    // The request as the contract reads it: trimmed, checked.
    expect(call.request).toEqual({
      search: "wan",
      kinds: [AffectedResourceKind.NetworkDevice, AffectedResourceKind.Host],
      limitPerKind: 15,
      countKinds: [AffectedResourceKind.Monitor],
    });

    expect(Response.setNoCacheHeaders).toHaveBeenCalledWith(result.res);
    expect(
      (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
        .calls[0]![2] as JSONObject,
    ).toEqual({
      kinds: [
        {
          kind: "NetworkDevice",
          count: 2,
          matches: [{ _id: DEVICE_ID, name: "WAN-RTR-01", detail: "10.0.0.1" }],
        },
        {
          kind: "Host",
          count: 1,
          matches: [{ _id: HOST_ID, name: "wan-proxy" }],
        },
      ],
      counts: [{ kind: "Monitor", count: 3 }],
      unreadableKinds: ["DatabaseServer"],
    });
  });

  test("a project API key is answered too, read with the key's own permissions", async () => {
    const props: DatabaseCommonInteractionProps = buildProps({
      projectId,
      userType: UserType.API,
      permissions: [Permission.ReadNetworkDevice],
    });
    propsSpy.mockResolvedValue(props);

    const result: RouteCallResult = await callRoute({
      kinds: ["NetworkDevice"],
    });

    expect(result.nextCallCount).toBe(0);
    expect(searchCall().props).toBe(props);
  });

  test("refuses an unauthenticated caller before reading anything", async () => {
    propsSpy.mockResolvedValue({});

    const result: RouteCallResult = await callRoute({ kinds: ["Host"] });

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

    const result: RouteCallResult = await callRoute({ kinds: ["Host"] });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expectNothingRead();
  });

  test.each([
    ["no body", undefined, "The search must be a JSON object"],
    ["no kinds", { search: "x" }, "kinds must name at least one kind"],
    ["an unknown kind", { kinds: ["Router"] }, 'kinds lists "Router"'],
    [
      "a search that is not text",
      { search: 5, kinds: ["Host"] },
      "search must be text.",
    ],
  ])(
    "refuses a request with %s, naming what to send, before reading anything",
    async (_what: string, body: unknown, message: string) => {
      const result: RouteCallResult = await callRoute(body);

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect((result.thrownToNext as Error).message).toContain(message);
      expectNothingRead();
    },
  );

  test("a search that fails is handed on, and nothing is sent", async () => {
    searchSpy.mockRejectedValue(new Error("database down"));

    const result: RouteCallResult = await callRoute({ kinds: ["Host"] });

    expect((result.thrownToNext as Error).message).toBe("database down");
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

describe("the route is mounted with the other API routes", () => {
  test("BaseAPI mounts it", () => {
    const fs: typeof import("fs") = jest.requireActual("fs");
    const path: typeof import("path") = jest.requireActual("path");
    const source: string = fs.readFileSync(
      path.resolve(__dirname, "../../../../App/FeatureSet/BaseAPI/Index.ts"),
      "utf8",
    );

    expect(source).toMatch(
      /import AffectedResourceSearchAPI from "Common\/Server\/API\/AffectedResourceSearchAPI";/,
    );
    expect(source).toMatch(/new AffectedResourceSearchAPI\(\)\.getRouter\(\)/);
  });
});
