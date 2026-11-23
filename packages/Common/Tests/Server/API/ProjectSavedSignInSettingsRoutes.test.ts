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
  CLEAR_PROJECT_PERSON_SIGN_IN_NOT_CLEARABLE_MESSAGE,
  CLEAR_PROJECT_SIGN_IN_NEEDS_MANAGED_SSO_MESSAGE,
  CLEAR_PROJECT_SIGN_IN_OWNERS_ONLY_MESSAGE,
  getProjectClearPersonSavedSignInSettingsRoute,
  getProjectClearSavedSignInSettingsRoute,
  getProjectSavedSignInSettingsOfPeopleRoute,
  getProjectSavedSignInSettingsRoute,
  NO_LOCAL_SIGN_IN_SETTINGS,
  PROJECT_CLEAR_PERSON_SAVED_SIGN_IN_SETTINGS_ACTION,
  PROJECT_CLEAR_SAVED_SIGN_IN_SETTINGS_ACTION,
  PROJECT_SAVED_SIGN_IN_SETTINGS_ACTION,
  PROJECT_SAVED_SIGN_IN_SETTINGS_OF_PEOPLE_ACTION,
  SAVED_SIGN_IN_SETTINGS_OF_PEOPLE_BAD_REQUEST_MESSAGE,
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
// One member at a time, from the Users list (#9993).
const PEOPLE_ROUTE: string = `/project/:id/${PROJECT_SAVED_SIGN_IN_SETTINGS_OF_PEOPLE_ACTION}`;
const CLEAR_PERSON_ROUTE: string = `/project/:id/${PROJECT_CLEAR_PERSON_SAVED_SIGN_IN_SETTINGS_ACTION}`;

const MEMBER_ID: string = "0b000000-0000-4000-8000-0000000000bb";

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
  extra?: { params?: Dictionary<string>; body?: unknown },
): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: { id: id, ...(extra?.params || {}) },
    query: {},
    body: extra && "body" in extra ? extra.body : {},
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
  let listSpy: jest.SpyInstance;
  let clearOneSpy: jest.SpyInstance;

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
    listSpy = jest
      .spyOn(ProjectSignInClearing, "readSavedSettingsOfMembers")
      .mockResolvedValue([
        {
          userId: MEMBER_ID,
          settings: { ...NO_LOCAL_SIGN_IN_SETTINGS, hasPassword: true },
        },
      ]);
    clearOneSpy = jest
      .spyOn(ProjectSignInClearing, "clearMember")
      .mockResolvedValue(1);

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
    expect(listSpy).not.toHaveBeenCalled();
    expect(clearOneSpy).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  }

  // What each route is called with when a test names no body or person.
  const extraFor: (route: string) => {
    params?: Dictionary<string>;
    body?: unknown;
  } = (route: string): { params?: Dictionary<string>; body?: unknown } => {
    if (route === PEOPLE_ROUTE) {
      return { body: { userIds: [MEMBER_ID] } };
    }

    if (route === CLEAR_PERSON_ROUTE) {
      return { params: { userId: MEMBER_ID } };
    }

    return {};
  };

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

  test("one member at a time (#9993): the routes the Users list calls are the ones mounted, behind getUserMiddleware", () => {
    expect(
      getProjectSavedSignInSettingsOfPeopleRoute(projectId.toString()),
    ).toBe(`/project/${projectId.toString()}/saved-sign-in-settings/people`);
    expect(
      getProjectClearPersonSavedSignInSettingsRoute(
        projectId.toString(),
        MEMBER_ID,
      ),
    ).toBe(
      `/project/${projectId.toString()}/saved-sign-in-settings/people/${MEMBER_ID}/clear`,
    );
    expect(mockRouter.match("POST", PEOPLE_ROUTE).middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
    ]);
    expect(mockRouter.match("POST", CLEAR_PERSON_ROUTE).middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
    ]);
  });

  test("an owner is told which of the people asked about they may clear, uncached, for themselves and this project", async () => {
    const other: string = ObjectID.generate().toString();

    const result: RouteCallResult = await callRoute(
      "POST",
      PEOPLE_ROUTE,
      projectId.toString(),
      { body: { userIds: [MEMBER_ID.toUpperCase(), other, MEMBER_ID] } },
    );

    expect(result.nextCallCount).toBe(0);
    expect(sentBody()).toEqual({
      people: [
        {
          userId: MEMBER_ID,
          settings: { ...NO_LOCAL_SIGN_IN_SETTINGS, hasPassword: true },
        },
      ],
    });
    expect(Response.setNoCacheHeaders).toHaveBeenCalledWith(result.res);

    const asked: {
      projectId: ObjectID;
      ownerUserId: ObjectID;
      userIds: Array<ObjectID>;
    } = listSpy.mock.calls[0]![0] as {
      projectId: ObjectID;
      ownerUserId: ObjectID;
      userIds: Array<ObjectID>;
    };
    expect(asked.projectId.toString()).toBe(projectId.toString());
    expect(asked.ownerUserId.toString()).toBe(OWNER_ID.toString());
    // Each person asked about once: nobody the page did not ask about.
    expect(
      asked.userIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([MEMBER_ID, other]);
  });

  test.each([
    ["no body", undefined],
    ["no ids", {}],
    ["an id that is not one", { userIds: ["everyone"] }],
  ])(
    "an owner's ask with %s is refused, and nothing is read",
    async (_label: string, body: unknown) => {
      const result: RouteCallResult = await callRoute(
        "POST",
        PEOPLE_ROUTE,
        projectId.toString(),
        { body: body },
      );

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect((result.thrownToNext as Error).message).toBe(
        SAVED_SIGN_IN_SETTINGS_OF_PEOPLE_BAD_REQUEST_MESSAGE,
      );
      expect(listSpy).not.toHaveBeenCalled();
    },
  );

  test("an owner clears one member, as themselves, in this project, and is told how many", async () => {
    const result: RouteCallResult = await callRoute(
      "POST",
      CLEAR_PERSON_ROUTE,
      projectId.toString(),
      { params: { userId: MEMBER_ID }, body: { ownerUserId: OWNER_ID } },
    );

    expect(result.nextCallCount).toBe(0);
    expect(sentBody()).toEqual({ peopleCleared: 1 });

    const asked: {
      projectId: ObjectID;
      ownerUserId: ObjectID;
      userId: ObjectID;
    } = clearOneSpy.mock.calls[0]![0] as {
      projectId: ObjectID;
      ownerUserId: ObjectID;
      userId: ObjectID;
    };
    expect(asked.projectId.toString()).toBe(projectId.toString());
    expect(asked.ownerUserId.toString()).toBe(OWNER_ID.toString());
    expect(asked.userId.toString()).toBe(MEMBER_ID);
  });

  test("who may ask comes before what is asked: no credentials and a broken body is a 401, not a 400", async () => {
    caller({ permissions: [], isAnonymous: true });

    const result: RouteCallResult = await callRoute(
      "POST",
      PEOPLE_ROUTE,
      projectId.toString(),
      { body: { userIds: "everyone" } },
    );

    expect(result.thrownToNext).toBeInstanceOf(NotAuthenticatedException);
    expectNothingDone();
  });

  test("a path that names no person is refused with the rule, and nothing is cleared", async () => {
    const result: RouteCallResult = await callRoute(
      "POST",
      CLEAR_PERSON_ROUTE,
      projectId.toString(),
      { params: { userId: "everyone" } },
    );

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect((result.thrownToNext as Error).message).toBe(
      CLEAR_PROJECT_PERSON_SIGN_IN_NOT_CLEARABLE_MESSAGE,
    );
    expect(clearOneSpy).not.toHaveBeenCalled();
  });

  test("a person the rule refuses is told, never answered as cleared", async () => {
    clearOneSpy.mockRejectedValue(
      new BadDataException(CLEAR_PROJECT_PERSON_SIGN_IN_NOT_CLEARABLE_MESSAGE),
    );

    const result: RouteCallResult = await callRoute(
      "POST",
      CLEAR_PERSON_ROUTE,
      projectId.toString(),
      { params: { userId: MEMBER_ID } },
    );

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
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
    ["POST", PEOPLE_ROUTE],
    ["POST", CLEAR_PERSON_ROUTE],
  ])("%s %s refuses", (method: string, route: string) => {
    const call: (id?: string) => Promise<RouteCallResult> = async (
      id?: string,
    ): Promise<RouteCallResult> => {
      return await callRoute(
        method as "GET" | "POST",
        route,
        id || projectId.toString(),
        extraFor(route),
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
