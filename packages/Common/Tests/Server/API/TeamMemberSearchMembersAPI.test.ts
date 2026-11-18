import CommonAPI from "../../../Server/API/CommonAPI";
import TeamMemberAPI from "../../../Server/API/TeamMemberAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import ProjectMemberSearch from "../../../Server/Utils/Team/ProjectMemberSearch";
import { mockRouter } from "./Helpers";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
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
  PROJECT_MEMBER_SEARCH_ROUTE,
  ProjectMemberSearchMatch,
} from "../../../Types/Team/ProjectMemberSearch";
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
 * POST /team-member/search-members (#7036): Search's people.
 *
 * The route asks for an authenticated member of the project, or a project
 * API key, and at least two letters, before anything is read; the project
 * is the request's own, never one the body names; the search runs with the
 * caller's own props (ProjectMemberSearch), never as root; a reader who may
 * not see the project's people is refused; and the answer is never cached.
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
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

const ADA: ProjectMemberSearchMatch = {
  userId: "6a1f0a0e-3333-4c1e-9a1e-0000000000a1",
  name: "Ada Lovelace",
  email: "ada@acme.test",
};

function buildProps(data: {
  projectId: ObjectID;
  userId?: ObjectID | undefined;
  userType?: UserType | undefined;
  permissions: Array<Permission>;
}): DatabaseCommonInteractionProps {
  const permissionMap: Dictionary<UserTenantAccessPermission> = {
    [data.projectId.toString()]: {
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
    },
  };

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
    .match("POST", PROJECT_MEMBER_SEARCH_ROUTE)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
    res: res,
  };
}

describe("POST /team-member/search-members", () => {
  let projectId: ObjectID;
  let userId: ObjectID;
  let propsSpy: jest.SpyInstance;
  let searchSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new TeamMemberAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    projectId = ObjectID.generate();
    userId = ObjectID.generate();

    propsSpy = jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(
        buildProps({
          projectId,
          userId,
          permissions: [Permission.ProjectMember],
        }),
      );
    searchSpy = jest
      .spyOn(ProjectMemberSearch, "search")
      .mockResolvedValue([ADA]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function expectNothingRead(): void {
    expect(searchSpy).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  }

  test("is mounted beside the team member routes, behind getUserMiddleware", () => {
    expect(PROJECT_MEMBER_SEARCH_ROUTE).toBe(
      `${new TeamMember().getCrudApiPath()!.toString()}/search-members`,
    );
    expect(
      mockRouter.match("POST", PROJECT_MEMBER_SEARCH_ROUTE).middlewares,
    ).toEqual([UserMiddleware.getUserMiddleware]);
  });

  test("answers a member with the project's people, searched with their own props, uncached", async () => {
    const result: RouteCallResult = await callRoute({ text: "  ada  " });

    expect(result.nextCallCount).toBe(0);
    expect(searchSpy).toHaveBeenCalledTimes(1);

    const call: {
      projectId: ObjectID;
      text: string;
      props: DatabaseCommonInteractionProps;
    } = searchSpy.mock.calls[0]![0];

    expect(call.projectId.toString()).toBe(projectId.toString());
    expect(call.text).toBe("ada");
    expect(call.props.userId?.toString()).toBe(userId.toString());
    expect(call.props.isRoot).toBeFalsy();

    expect(Response.setNoCacheHeaders).toHaveBeenCalledWith(result.res);
    expect(
      (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
        .calls[0]![2] as JSONObject,
    ).toEqual({
      members: [
        {
          userId: ADA.userId,
          name: "Ada Lovelace",
          email: "ada@acme.test",
        },
      ],
    });
  });

  test("searches the request's own project, whatever the body names", async () => {
    const otherProject: ObjectID = ObjectID.generate();

    await callRoute({ text: "ada", projectId: otherProject.toString() });

    expect(searchSpy.mock.calls[0]![0].projectId.toString()).toBe(
      projectId.toString(),
    );
  });

  test("a search that finds nobody answers an empty list", async () => {
    searchSpy.mockResolvedValue([]);

    await callRoute({ text: "nobody@nowhere.test" });

    expect(
      (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
        .calls[0]![2] as JSONObject,
    ).toEqual({ members: [] });
  });

  test("a project API key is answered with the key's own permissions", async () => {
    const props: DatabaseCommonInteractionProps = buildProps({
      projectId,
      userType: UserType.API,
      permissions: [Permission.ReadProjectTeam],
    });
    propsSpy.mockResolvedValue(props);

    const result: RouteCallResult = await callRoute({ text: "ada" });

    expect(result.nextCallCount).toBe(0);
    expect(searchSpy.mock.calls[0]![0].props).toBe(props);
  });

  test.each([
    ["one letter", { text: "a" }],
    ["spaces", { text: "   " }],
    ["no text", {}],
    ["a number", { text: 7 }],
    ["no body", undefined],
  ])(
    "refuses %s, before reading anything",
    async (_what: string, body: unknown) => {
      const result: RouteCallResult = await callRoute(body);

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expectNothingRead();
    },
  );

  test("refuses an unauthenticated caller before reading anything", async () => {
    propsSpy.mockResolvedValue({} as DatabaseCommonInteractionProps);

    const result: RouteCallResult = await callRoute({ text: "ada" });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthenticatedException);
    expectNothingRead();
  });

  test("refuses someone who is not a member of the project they asked in", async () => {
    const props: DatabaseCommonInteractionProps = buildProps({
      projectId: ObjectID.generate(),
      userId,
      permissions: [Permission.ProjectOwner],
    });
    props.tenantId = projectId;
    propsSpy.mockResolvedValue(props);

    const result: RouteCallResult = await callRoute({ text: "ada" });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expectNothingRead();
  });

  test("a member who may not see the project's people is refused, and nothing is read", async () => {
    searchSpy.mockRestore();
    const findBySpy: jest.SpyInstance = jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValue([]);
    propsSpy.mockResolvedValue(
      buildProps({ projectId, userId, permissions: [Permission.ReadService] }),
    );

    const result: RouteCallResult = await callRoute({ text: "ada" });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(findBySpy).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("a search that fails is handed on, and nothing is sent", async () => {
    searchSpy.mockRejectedValue(new Error("database down"));

    const result: RouteCallResult = await callRoute({ text: "ada" });

    expect((result.thrownToNext as Error).message).toBe("database down");
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
