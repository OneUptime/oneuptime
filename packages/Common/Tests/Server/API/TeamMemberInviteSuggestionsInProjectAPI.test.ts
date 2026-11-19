import CommonAPI from "../../../Server/API/CommonAPI";
import TeamMemberAPI from "../../../Server/API/TeamMemberAPI";
import MasterAdminAuthorization from "../../../Server/Middleware/MasterAdminAuthorization";
import ProjectMiddleware from "../../../Server/Middleware/ProjectAuthorization";
import UserMiddleware, {
  RequestSession,
} from "../../../Server/Middleware/UserAuthorization";
import ProjectService from "../../../Server/Services/ProjectService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import InviteSuggestions from "../../../Server/Utils/Team/InviteSuggestions";
import { mockRouter } from "./Helpers";
import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  INVITE_SUGGESTIONS_IN_PROJECT_ROUTE,
  INVITE_SUGGESTIONS_ROUTE,
  InviteSuggestion,
  InviteSuggestionStanding,
  InviteSuggestionsRequest,
  getInviteSuggestionsInProjectRoute,
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
 * POST /team-member/invite-suggestions-in-project/:id (#9826): the Admin
 * Dashboard's invitation forms suggest people as an address is typed, as
 * the Dashboard's do.
 *
 * The Admin Dashboard works in no project, and its reader is a master admin
 * who is usually no member of the project the page is about. So:
 *
 *   - the project is the one the path names, never the request's tenant -
 *     a tenant would hold the master admin to the project's own sign-in
 *     rules, and answer a project that is gone with the 405 the browser
 *     signs out on;
 *   - only a master admin may ask (MasterAdminAuthorization), and is read
 *     with their own props, in that project;
 *   - a project that does not exist is refused, never answered with nobody;
 *   - who is suggested is InviteSuggestions' rule, as for everyone (its own
 *     suites say who: the server's accounts on a server somebody runs,
 *     never on OneUptime Cloud).
 *
 * The Dashboard's route, POST /team-member/invite-suggestions, is
 * unchanged: a master admin who is no member is refused there, as before.
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

const PROJECT_ID: string = "98260000-0000-4000-8000-000000000001";
const OTHER_PROJECT_ID: string = "98260000-0000-4000-8000-000000000002";
const TEAM_ID: string = "98260000-0000-4000-8000-000000000003";
const ADMIN_ID: ObjectID = new ObjectID("98260000-0000-4000-8000-000000000004");

// The route as it is registered: the project's id is its one parameter.
const REGISTERED_ROUTE: string = `${INVITE_SUGGESTIONS_IN_PROJECT_ROUTE}/:id`;

const ADA_BYRON: InviteSuggestion = {
  userId: "98260000-0000-4000-8000-0000000000a1",
  name: "Ada Byron",
  email: "ada.byron@other.test",
  standing: InviteSuggestionStanding.NotInProject,
};

// A master admin of the server, in no project: the Admin Dashboard's reader.
function masterAdminProps(): DatabaseCommonInteractionProps {
  return {
    userId: ADMIN_ID,
    userType: UserType.MasterAdmin,
    isMasterAdmin: true,
  };
}

interface RouteCallResult {
  thrownToNext: unknown;
  nextCallCount: number;
  res: ExpressResponse;
}

async function callRoute(data: {
  route?: string | undefined;
  params?: Dictionary<string> | undefined;
  body: unknown;
}): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: data.params === undefined ? { id: PROJECT_ID } : data.params,
    query: {},
    body: data.body,
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("POST", data.route || REGISTERED_ROUTE)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
    res: res,
  };
}

function existingProject(): Project {
  const project: Project = new Project();
  project._id = PROJECT_ID;
  return project;
}

type SuggestCall = {
  projectId: ObjectID;
  request: InviteSuggestionsRequest;
  props: DatabaseCommonInteractionProps;
};

beforeAll(() => {
  mockRouter.routes.length = 0;
  new TeamMemberAPI();
});

describe("POST /team-member/invite-suggestions-in-project/:id", () => {
  let propsSpy: jest.SpyInstance;
  let projectSpy: jest.SpyInstance;
  let suggestSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    propsSpy = jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(masterAdminProps());
    projectSpy = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(existingProject());
    suggestSpy = jest
      .spyOn(InviteSuggestions, "suggest")
      .mockResolvedValue([ADA_BYRON]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function suggestCall(): SuggestCall {
    expect(suggestSpy).toHaveBeenCalledTimes(1);
    return suggestSpy.mock.calls[0]![0] as SuggestCall;
  }

  function expectNothingRead(): void {
    expect(projectSpy).not.toHaveBeenCalled();
    expect(suggestSpy).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  }

  describe("the route", () => {
    test("is the Admin Dashboard's own, beside the team member routes, for master admins only", () => {
      expect(INVITE_SUGGESTIONS_IN_PROJECT_ROUTE).toBe(
        `${new TeamMember().getCrudApiPath()!.toString()}/invite-suggestions-in-project`,
      );
      expect(getInviteSuggestionsInProjectRoute(PROJECT_ID)).toBe(
        `/team-member/invite-suggestions-in-project/${PROJECT_ID}`,
      );
      expect(getInviteSuggestionsInProjectRoute(new ObjectID(PROJECT_ID))).toBe(
        `/team-member/invite-suggestions-in-project/${PROJECT_ID}`,
      );

      expect(mockRouter.match("POST", REGISTERED_ROUTE).middlewares).toEqual([
        UserMiddleware.getUserMiddleware,
        MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      ]);
    });

    test("is registered once, and leaves the Dashboard's route as it was", () => {
      expect(
        mockRouter.routes.filter(
          (route: { method: string; uri: string }): boolean => {
            return route.method === "POST" && route.uri === REGISTERED_ROUTE;
          },
        ),
      ).toHaveLength(1);

      // The Dashboard's: a member of the request's project, or its API key.
      expect(
        mockRouter.match("POST", INVITE_SUGGESTIONS_ROUTE).middlewares,
      ).toEqual([UserMiddleware.getUserMiddleware]);
    });

    /*
     * UserMiddleware reads a tenant from a path's projectId or tenantid
     * (ProjectMiddleware.getProjectId), and a tenant brings the project's
     * own sign-in rules and its 405 for a project that is gone. The path's
     * parameter is "id", which it never reads.
     */
    test("names the project in a parameter UserMiddleware never takes for a tenant", () => {
      expect(REGISTERED_ROUTE.endsWith("/:id")).toBe(true);
      expect(
        ProjectMiddleware.getProjectId({
          params: { id: PROJECT_ID },
          query: {},
          headers: {},
          body: { text: "ada", teamId: TEAM_ID },
        } as unknown as ExpressRequest),
      ).toBeNull();
    });
  });

  describe("a master admin", () => {
    test("is answered about a project they are no member of, read with their own props in that project, uncached", async () => {
      const result: RouteCallResult = await callRoute({
        body: { text: "  ada  ", teamId: TEAM_ID },
      });

      expect(result.nextCallCount).toBe(0);

      const call: SuggestCall = suggestCall();

      expect(call.projectId.toString()).toBe(PROJECT_ID);
      expect(call.request.text).toBe("ada");
      expect(call.request.teamId?.toString()).toBe(TEAM_ID);
      expect(call.props.isMasterAdmin).toBe(true);
      expect(call.props.userId?.toString()).toBe(ADMIN_ID.toString());
      // Their own props, never root, and no membership of the project.
      expect(call.props.isRoot).toBeFalsy();
      expect(call.props.userTenantAccessPermission).toBeUndefined();
      // In the project the path names.
      expect(call.props.tenantId?.toString()).toBe(PROJECT_ID);

      expect(Response.setNoCacheHeaders).toHaveBeenCalledWith(result.res);
      expect(
        (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
          .calls[0]![2] as JSONObject,
      ).toEqual({
        people: [
          {
            userId: ADA_BYRON.userId,
            name: "Ada Byron",
            email: "ada.byron@other.test",
            standing: "NotInProject",
          },
        ],
      });
    });

    test("with no team named, is answered for the project", async () => {
      await callRoute({ body: { text: "ada" } });

      expect(suggestCall().request.teamId).toBeNull();
    });

    test("is read in the project the path names, whatever tenant the request named, and never one the body names", async () => {
      propsSpy.mockResolvedValue({
        ...masterAdminProps(),
        tenantId: new ObjectID(OTHER_PROJECT_ID),
      });

      await callRoute({
        body: { text: "ada", projectId: OTHER_PROJECT_ID },
      });

      const call: SuggestCall = suggestCall();

      expect(call.projectId.toString()).toBe(PROJECT_ID);
      expect(call.props.tenantId?.toString()).toBe(PROJECT_ID);
    });

    test("the project is looked for as it is, before anything else is read", async () => {
      await callRoute({ body: { text: "ada" } });

      expect(projectSpy).toHaveBeenCalledTimes(1);

      const lookup: {
        id: ObjectID;
        props: DatabaseCommonInteractionProps;
      } = projectSpy.mock.calls[0]![0];

      expect(lookup.id.toString()).toBe(PROJECT_ID);
      expect(lookup.props).toEqual({ isRoot: true });
      expect(projectSpy.mock.invocationCallOrder[0]!).toBeLessThan(
        suggestSpy.mock.invocationCallOrder[0]!,
      );
    });
  });

  describe("what is refused", () => {
    test("a project that does not exist: refused, never answered with nobody", async () => {
      projectSpy.mockResolvedValue(null);

      const result: RouteCallResult = await callRoute({
        body: { text: "ada" },
      });

      expect(result.thrownToNext).toBeInstanceOf(NotFoundException);
      expect((result.thrownToNext as Exception).message).toBe(
        "This project does not exist. It may have been deleted: open another one from the Projects list.",
      );
      expect(suggestSpy).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });

    test.each([
      ["a name", { id: "Acme" }],
      ["nothing", { id: "" }],
      ["no parameter", {}],
    ])(
      "a path that names no project's ID (%s), before anything is read",
      async (_what: string, params: Dictionary<string>) => {
        const result: RouteCallResult = await callRoute({
          params: params,
          body: { text: "ada" },
        });

        expect(result.thrownToNext).toBeInstanceOf(BadDataException);
        expectNothingRead();
      },
    );

    test.each([
      ["one letter", { text: "a" }],
      ["spaces", { text: "   " }],
      ["no text", {}],
      ["a team that is no id", { text: "ada", teamId: "Platform" }],
      ["no body", undefined],
    ])("%s, before anything is read", async (_what: string, body: unknown) => {
      const result: RouteCallResult = await callRoute({ body: body });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expectNothingRead();
    });

    test("a refusal of the read - a team of another project - is handed on, and nothing is sent", async () => {
      suggestSpy.mockRejectedValue(
        new BadDataException(
          "This team no longer exists in this project. Reload the page and pick another team.",
        ),
      );

      const result: RouteCallResult = await callRoute({
        body: { text: "ada", teamId: TEAM_ID },
      });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });
  });
});

/*
 * MasterAdminAuthorization, ahead of the handler, as the route runs it:
 * everyone but a master admin is refused before anything is read. The
 * session is the one reader's (UserMiddleware.readRequestSession), here
 * standing in for a cookie.
 */
describe("who reaches it", () => {
  let next: jest.Mock;
  let res: ExpressResponse;

  beforeEach(() => {
    jest.clearAllMocks();
    next = jest.fn();
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function runGate(
    session: RequestSession,
    headers: Dictionary<string> = {},
  ): Promise<void> {
    jest.spyOn(UserMiddleware, "readRequestSession").mockResolvedValue(session);

    const gate: (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ) => void | Promise<void> = mockRouter.match("POST", REGISTERED_ROUTE)
      .middlewares[1]!;

    await gate(
      {
        params: { id: PROJECT_ID },
        query: {},
        headers: headers,
        body: { text: "ada" },
      } as unknown as ExpressRequest,
      res,
      next as unknown as NextFunction,
    );
  }

  function refusal(): Exception {
    const calls: Array<Array<unknown>> = (
      Response.sendErrorResponse as unknown as jest.Mock
    ).mock.calls as Array<Array<unknown>>;

    expect(calls).toHaveLength(1);

    return calls[0]![2] as Exception;
  }

  test("a master admin goes on to the handler", async () => {
    await runGate({
      kind: "user",
      session: {
        userId: ADMIN_ID,
        isMasterAdmin: true,
      } as unknown as JSONWebTokenData,
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(Response.sendErrorResponse).not.toHaveBeenCalled();
  });

  test("anyone else signed in - a member, a Project Owner - is refused", async () => {
    await runGate({
      kind: "user",
      session: {
        userId: ObjectID.generate(),
        isMasterAdmin: false,
      } as unknown as JSONWebTokenData,
    });

    expect(next).not.toHaveBeenCalled();
    expect(refusal()).toBeInstanceOf(NotAuthorizedException);
  });

  test("a project API key, which is no person's session, is refused", async () => {
    await runGate({ kind: "none" }, { apikey: ObjectID.generate().toString() });

    expect(next).not.toHaveBeenCalled();
    expect(refusal()).toBeInstanceOf(NotAuthenticatedException);
  });

  test("nobody signed in (a tab left open) is asked to sign in again", async () => {
    await runGate({ kind: "none" });

    expect(next).not.toHaveBeenCalled();
    expect(refusal()).toBeInstanceOf(NotAuthenticatedException);
  });
});

/*
 * The Dashboard's route keeps its rule: the request's own project, for a
 * signed-in member or the project's API key. A master admin who is no
 * member is refused there as before - the Admin Dashboard asks through its
 * own route.
 */
describe("POST /team-member/invite-suggestions, as it was", () => {
  let suggestSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    suggestSpy = jest
      .spyOn(InviteSuggestions, "suggest")
      .mockResolvedValue([ADA_BYRON]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function membershipOf(
    projectId: string,
    permissions: Array<Permission>,
  ): Dictionary<UserTenantAccessPermission> {
    return {
      [projectId]: {
        _type: "UserTenantAccessPermission",
        projectId: new ObjectID(projectId),
        permissions: permissions.map(
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
  }

  test("refuses a master admin who is no member of the project the request is in", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({
        ...masterAdminProps(),
        tenantId: new ObjectID(PROJECT_ID),
      });

    const result: RouteCallResult = await callRoute({
      route: INVITE_SUGGESTIONS_ROUTE,
      params: {},
      body: { text: "ada" },
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(suggestSpy).not.toHaveBeenCalled();
  });

  test("refuses someone who is no member of the project, whatever they hold in another", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({
        userId: ObjectID.generate(),
        userType: UserType.User,
        tenantId: new ObjectID(PROJECT_ID),
        userTenantAccessPermission: membershipOf(OTHER_PROJECT_ID, [
          Permission.ProjectOwner,
        ]),
      });

    const result: RouteCallResult = await callRoute({
      route: INVITE_SUGGESTIONS_ROUTE,
      params: {},
      body: { text: "ada" },
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(suggestSpy).not.toHaveBeenCalled();
  });

  test("answers a member, and the project's API key, in the request's own project", async () => {
    for (const userType of [UserType.User, UserType.API]) {
      suggestSpy.mockClear();

      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue({
          ...(userType === UserType.User
            ? { userId: ObjectID.generate() }
            : {}),
          userType: userType,
          tenantId: new ObjectID(PROJECT_ID),
          userTenantAccessPermission: membershipOf(PROJECT_ID, [
            Permission.ProjectAdmin,
          ]),
        });

      const result: RouteCallResult = await callRoute({
        route: INVITE_SUGGESTIONS_ROUTE,
        params: {},
        body: { text: "ada" },
      });

      expect({ userType, thrown: result.thrownToNext }).toEqual({
        userType,
        thrown: undefined,
      });
      expect(
        (suggestSpy.mock.calls[0]![0] as SuggestCall).projectId.toString(),
      ).toBe(PROJECT_ID);
    }
  });
});
