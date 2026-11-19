import CommonAPI from "../../../Server/API/CommonAPI";
import TeamMemberAPI from "../../../Server/API/TeamMemberAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import InviteSuggestions from "../../../Server/Utils/Team/InviteSuggestions";
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
  INVITE_SUGGESTIONS_ROUTE,
  InviteSuggestion,
  InviteSuggestionStanding,
  InviteSuggestionsRequest,
} from "../../../Types/Team/InviteSuggestions";
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
 * POST /team-member/invite-suggestions (#9701): the people an
 * invitation's email box suggests as it is typed in.
 *
 * The route asks for an authenticated member of the project, or a project
 * API key, and at least two letters, before anything is read; the project
 * is the request's own, never one the body names; the team, when named, is
 * an id; the suggestions are read with the caller's own props
 * (InviteSuggestions), never as root; and the answer is never cached.
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

const ADA: InviteSuggestion = {
  userId: "6a1f0a0e-3333-4c1e-9a1e-0000000000a1",
  name: "Ada Lovelace",
  email: "ada@acme.test",
  standing: InviteSuggestionStanding.Invited,
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
    .match("POST", INVITE_SUGGESTIONS_ROUTE)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
    res: res,
  };
}

describe("POST /team-member/invite-suggestions", () => {
  let projectId: ObjectID;
  let userId: ObjectID;
  let propsSpy: jest.SpyInstance;
  let suggestSpy: jest.SpyInstance;

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
          permissions: [Permission.ProjectAdmin],
        }),
      );
    suggestSpy = jest
      .spyOn(InviteSuggestions, "suggest")
      .mockResolvedValue([ADA]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function expectNothingRead(): void {
    expect(suggestSpy).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  }

  test("is mounted beside the team member routes, behind getUserMiddleware", () => {
    expect(INVITE_SUGGESTIONS_ROUTE).toBe(
      `${new TeamMember().getCrudApiPath()!.toString()}/invite-suggestions`,
    );
    expect(
      mockRouter.match("POST", INVITE_SUGGESTIONS_ROUTE).middlewares,
    ).toEqual([UserMiddleware.getUserMiddleware]);
  });

  test("answers with the suggestions, read with the caller's own props, uncached", async () => {
    const teamId: ObjectID = ObjectID.generate();
    const result: RouteCallResult = await callRoute({
      text: "  ada  ",
      teamId: teamId.toString(),
    });

    expect(result.nextCallCount).toBe(0);
    expect(suggestSpy).toHaveBeenCalledTimes(1);

    const call: {
      projectId: ObjectID;
      request: InviteSuggestionsRequest;
      props: DatabaseCommonInteractionProps;
    } = suggestSpy.mock.calls[0]![0];

    expect(call.projectId.toString()).toBe(projectId.toString());
    expect(call.request.text).toBe("ada");
    expect(call.request.teamId?.toString()).toBe(teamId.toString());
    expect(call.props.userId?.toString()).toBe(userId.toString());
    expect(call.props.isRoot).toBeFalsy();

    expect(Response.setNoCacheHeaders).toHaveBeenCalledWith(result.res);
    expect(
      (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
        .calls[0]![2] as JSONObject,
    ).toEqual({
      people: [
        {
          userId: ADA.userId,
          name: "Ada Lovelace",
          email: "ada@acme.test",
          standing: "Invited",
        },
      ],
    });
  });

  test("asks in the request's own project, whatever the body names", async () => {
    await callRoute({ text: "ada", projectId: ObjectID.generate().toString() });

    expect(suggestSpy.mock.calls[0]![0].projectId.toString()).toBe(
      projectId.toString(),
    );
  });

  test("with no team named, asks for the project", async () => {
    await callRoute({ text: "ada" });

    expect(suggestSpy.mock.calls[0]![0].request.teamId).toBeNull();
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
    expect(suggestSpy.mock.calls[0]![0].props).toBe(props);
  });

  test.each([
    ["one letter", { text: "a" }],
    ["spaces", { text: "   " }],
    ["no text", {}],
    ["a team that is no id", { text: "ada", teamId: "Platform" }],
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

  test("a refusal of the read is handed on, and nothing is sent", async () => {
    suggestSpy.mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permission to see this project's members.",
      ),
    );

    const result: RouteCallResult = await callRoute({ text: "ada" });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
