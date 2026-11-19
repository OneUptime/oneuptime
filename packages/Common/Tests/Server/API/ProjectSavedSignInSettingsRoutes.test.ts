import CommonAPI from "../../../Server/API/CommonAPI";
import ProjectAPI from "../../../Server/API/ProjectAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import ProjectSignInClearing from "../../../Server/Utils/ProjectSignInClearing";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
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
import {
  CLEAR_PROJECT_SIGN_IN_NEEDS_MANAGED_SSO_MESSAGE,
  CLEAR_PROJECT_SIGN_IN_OWNERS_ONLY_MESSAGE,
  getProjectClearSavedSignInSettingsRoute,
  getProjectSavedSignInSettingsRoute,
  PROJECT_CLEAR_SAVED_SIGN_IN_SETTINGS_ACTION,
  PROJECT_SAVED_SIGN_IN_SETTINGS_ACTION,
} from "../../../Types/SSO/LocalSignInClearing";
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
 * GET  /project/:id/saved-sign-in-settings
 * POST /project/:id/saved-sign-in-settings/clear
 *
 * An organization's own clear of the sign-in settings its people saved
 * before its projects managed sign-in with SSO (#9820,
 * Server/Utils/ProjectSignInClearing, whose suite pins who is cleared).
 * These pin who may ask: a signed-in Project Owner of the project in the
 * path - never without credentials, never a project API key, never a
 * member who is only an admin, never by master-admin standing, never for
 * another project's id - and that nothing is counted or cleared for
 * anybody else. The owner the rule runs for is the session's own person.
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

const COUNT_ROUTE: string = `/project/:id/${PROJECT_SAVED_SIGN_IN_SETTINGS_ACTION}`;
const CLEAR_ROUTE: string = `/project/:id/${PROJECT_CLEAR_SAVED_SIGN_IN_SETTINGS_ACTION}`;

const OWNER_ID: ObjectID = new ObjectID("0a000000-0000-4000-8000-0000000000aa");

function rows(
  permissions: Array<Permission>,
  isBlockPermission: boolean,
): Array<UserPermission> {
  return permissions.map((permission: Permission): UserPermission => {
    return {
      _type: "UserPermission",
      permission: permission,
      labelIds: [],
      isBlockPermission: isBlockPermission,
    };
  });
}

function buildProps(data: {
  projectId: ObjectID;
  permissions: Array<Permission>;
  blocks?: Array<Permission> | undefined;
  isApiKey?: boolean | undefined;
  isMasterAdmin?: boolean | undefined;
  isAnonymous?: boolean | undefined;
}): DatabaseCommonInteractionProps {
  if (data.isAnonymous) {
    return { tenantId: data.projectId };
  }

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[data.projectId.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: data.projectId,
    permissions: [
      ...rows(data.permissions, false),
      ...rows(data.blocks || [], true),
    ],
  };

  if (data.isApiKey) {
    return {
      tenantId: data.projectId,
      userType: UserType.API,
      userTenantAccessPermission: permissionMap,
    };
  }

  return {
    tenantId: data.projectId,
    userId: OWNER_ID,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
    ...(data.isMasterAdmin ? { isMasterAdmin: true } : {}),
  };
}

interface RouteCallResult {
  thrownToNext: unknown;
  nextCallCount: number;
  res: ExpressResponse;
}

async function callRoute(
  method: "GET" | "POST",
  route: string,
  id: string,
): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: { id: id },
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
    .match(method, route)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
    res: res,
  };
}

describe("the routes of an organization's own clear", () => {
  let projectId: ObjectID;
  let propsSpy: jest.SpyInstance;
  let countSpy: jest.SpyInstance;
  let clearSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new ProjectAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    projectId = ObjectID.generate();

    propsSpy = jest.spyOn(CommonAPI, "getDatabaseCommonInteractionProps");
    countSpy = jest
      .spyOn(ProjectSignInClearing, "countClearablePeople")
      .mockResolvedValue(7);
    clearSpy = jest
      .spyOn(ProjectSignInClearing, "clearForProject")
      .mockResolvedValue(7);

    caller({ permissions: [Permission.ProjectOwner] });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function caller(data: {
    permissions: Array<Permission>;
    blocks?: Array<Permission>;
    isApiKey?: boolean;
    isMasterAdmin?: boolean;
    isAnonymous?: boolean;
  }): void {
    propsSpy.mockResolvedValue(buildProps({ projectId: projectId, ...data }));
  }

  function sentBody(): JSONObject {
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    return (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
      .calls[0]![2] as JSONObject;
  }

  function expectNothingDone(): void {
    expect(countSpy).not.toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  }

  test("the routes the Dashboard calls are the routes the server mounts", () => {
    expect(getProjectSavedSignInSettingsRoute(projectId.toString())).toBe(
      `/project/${projectId.toString()}/saved-sign-in-settings`,
    );
    expect(getProjectClearSavedSignInSettingsRoute(projectId.toString())).toBe(
      `/project/${projectId.toString()}/saved-sign-in-settings/clear`,
    );
  });

  test("both are mounted behind getUserMiddleware", () => {
    expect(mockRouter.match("GET", COUNT_ROUTE).middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
    ]);
    expect(mockRouter.match("POST", CLEAR_ROUTE).middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
    ]);
  });

  test("an owner is told how many they may clear, uncached, for themselves and this project", async () => {
    const result: RouteCallResult = await callRoute(
      "GET",
      COUNT_ROUTE,
      projectId.toString(),
    );

    expect(result.nextCallCount).toBe(0);
    expect(sentBody()).toEqual({ peopleCount: 7 });
    expect(Response.setNoCacheHeaders).toHaveBeenCalledWith(result.res);

    const asked: { projectId: ObjectID; ownerUserId: ObjectID } = countSpy.mock
      .calls[0]![0] as { projectId: ObjectID; ownerUserId: ObjectID };
    expect(asked.projectId.toString()).toBe(projectId.toString());
    expect(asked.ownerUserId.toString()).toBe(OWNER_ID.toString());
  });

  test("an owner clears them, and is told how many", async () => {
    const result: RouteCallResult = await callRoute(
      "POST",
      CLEAR_ROUTE,
      projectId.toString(),
    );

    expect(result.nextCallCount).toBe(0);
    expect(sentBody()).toEqual({ peopleCleared: 7 });

    const asked: { projectId: ObjectID; ownerUserId: ObjectID } = clearSpy.mock
      .calls[0]![0] as { projectId: ObjectID; ownerUserId: ObjectID };
    expect(asked.projectId.toString()).toBe(projectId.toString());
    expect(asked.ownerUserId.toString()).toBe(OWNER_ID.toString());
  });

  test("names the project the same however its id is cased", async () => {
    const result: RouteCallResult = await callRoute(
      "GET",
      COUNT_ROUTE,
      projectId.toString().toUpperCase(),
    );

    expect(result.nextCallCount).toBe(0);
    expect(countSpy).toHaveBeenCalledTimes(1);
  });

  describe.each([
    ["GET", COUNT_ROUTE],
    ["POST", CLEAR_ROUTE],
  ])("%s %s refuses", (method: string, route: string) => {
    const call: (id?: string) => Promise<RouteCallResult> = async (
      id?: string,
    ): Promise<RouteCallResult> => {
      return await callRoute(
        method as "GET" | "POST",
        route,
        id || projectId.toString(),
      );
    };

    test("a caller with no credentials: 401, so a session that ran out is renewed", async () => {
      caller({ permissions: [], isAnonymous: true });

      const result: RouteCallResult = await call();

      expect(result.thrownToNext).toBeInstanceOf(NotAuthenticatedException);
      expectNothingDone();
    });

    test("a project API key, even one that holds Project Owner: a leaked key never strips people's sign-in", async () => {
      caller({ permissions: [Permission.ProjectOwner], isApiKey: true });

      const result: RouteCallResult = await call();

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expectNothingDone();
    });

    test.each([
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProject,
      Permission.Viewer,
    ])(
      "a member who holds %s but not Project Owner",
      async (permission: Permission) => {
        caller({ permissions: [permission] });

        const result: RouteCallResult = await call();

        expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
        expect((result.thrownToNext as Error).message).toBe(
          CLEAR_PROJECT_SIGN_IN_OWNERS_ONLY_MESSAGE,
        );
        expectNothingDone();
      },
    );

    test("an owner whose Project Owner a team blocks", async () => {
      caller({
        permissions: [Permission.ProjectOwner],
        blocks: [Permission.ProjectOwner],
      });

      const result: RouteCallResult = await call();

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expectNothingDone();
    });

    test("a master admin who is not an owner: their standing is not ownership", async () => {
      caller({ permissions: [Permission.ProjectMember], isMasterAdmin: true });

      const result: RouteCallResult = await call();

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expectNothingDone();
    });

    test("another project's id in the path: an owner of one project never reaches another's", async () => {
      const result: RouteCallResult = await call(
        ObjectID.generate().toString(),
      );

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expectNothingDone();
    });

    test("a path that names no project", async () => {
      const result: RouteCallResult = await call("not-a-project");

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expectNothingDone();
    });
  });

  test("a clear the rule refuses is told, never answered as done", async () => {
    clearSpy.mockRejectedValue(
      new BadDataException(CLEAR_PROJECT_SIGN_IN_NEEDS_MANAGED_SSO_MESSAGE),
    );

    const result: RouteCallResult = await callRoute(
      "POST",
      CLEAR_ROUTE,
      projectId.toString(),
    );

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect((result.thrownToNext as Error).message).toBe(
      CLEAR_PROJECT_SIGN_IN_NEEDS_MANAGED_SSO_MESSAGE,
    );
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
