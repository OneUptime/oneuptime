import CommonAPI from "../../../Server/API/CommonAPI";
import TeamMemberAPI from "../../../Server/API/TeamMemberAPI";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ReadableTeamNames from "../../../Server/Utils/Team/ReadableTeamNames";
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
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  MAX_PEOPLE_PER_PROJECT_REMOVAL_REACH,
  PROJECT_REMOVAL_REACH_ROUTE,
} from "../../../Types/Team/ProjectRemovalReach";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

/*
 * POST /team-member/project-removal-reach (#6599): of the people on a page
 * of the Users list, the ones the caller's Remove from Project would leave
 * in the project, with the teams that keep them - by name only for a team
 * the caller may read. Asked with the caller's own permissions, in the
 * request's project, never as OneUptime: the lock it draws is the refusal
 * the removal would give.
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

const PROJECT_ID: ObjectID = new ObjectID(
  "6f100000-0000-4000-8000-000000000001",
);
const CALLER_ID: ObjectID = new ObjectID(
  "6f200000-0000-4000-8000-000000000001",
);
const GRACE: ObjectID = new ObjectID("6f300000-0000-4000-8000-000000000001");
const ALAN: ObjectID = new ObjectID("6f300000-0000-4000-8000-000000000002");
const PLATFORM: ObjectID = new ObjectID("6f400000-0000-4000-8000-000000000001");
const SECURITY: ObjectID = new ObjectID("6f400000-0000-4000-8000-000000000002");

function callerProps(): DatabaseCommonInteractionProps {
  const memberPermission: UserPermission = {
    _type: "UserPermission",
    permission: Permission.ProjectMember,
    labelIds: [],
  };

  const permissionMap: Dictionary<UserTenantAccessPermission> = {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: [memberPermission],
    },
  };

  return {
    tenantId: PROJECT_ID,
    userId: CALLER_ID,
    userTenantAccessPermission: permissionMap,
  };
}

async function callRoute(body: unknown): Promise<{ thrownToNext: unknown }> {
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

  const next: Mock = jest.fn();

  await mockRouter
    .match("POST", PROJECT_REMOVAL_REACH_ROUTE)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
  };
}

// What the route answered, as it sent it.
function answered(): JSONObject {
  const calls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as unknown as Mock
  ).mock.calls as Array<Array<unknown>>;

  expect(calls).toHaveLength(1);

  return calls[0]![2] as JSONObject;
}

describe("POST /team-member/project-removal-reach", () => {
  let reachSpy: SpyInstance<typeof TeamMemberService.getTeamsOutOfRemovalReach>;
  let namesSpy: SpyInstance<typeof ReadableTeamNames.read>;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new TeamMemberAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(callerProps());

    reachSpy = jest
      .spyOn(TeamMemberService, "getTeamsOutOfRemovalReach")
      .mockResolvedValue([
        {
          userId: GRACE,
          teamIds: [PLATFORM, SECURITY],
          membershipsWithoutTeam: 0,
          hasTeamInReach: true,
        },
      ]);

    // The caller may read Platform, not Security.
    namesSpy = jest
      .spyOn(ReadableTeamNames, "read")
      .mockResolvedValue(
        new Map<string, string>([
          [PLATFORM.toString().toLowerCase(), "Platform"],
        ]),
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is registered behind the user middleware, at the path the Dashboard asks", () => {
    const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
      "POST",
      PROJECT_REMOVAL_REACH_ROUTE,
    );

    expect(PROJECT_REMOVAL_REACH_ROUTE).toBe(
      "/team-member/project-removal-reach",
    );
    expect(route.middlewares).toContain(UserMiddleware.getUserMiddleware);
  });

  test("names whom the caller's Remove from Project would leave, with the teams the caller may read, the rest counted", async () => {
    await callRoute({ userIds: [GRACE.toString(), ALAN.toString()] });

    expect(answered()).toEqual({
      people: [
        {
          userId: GRACE.toString(),
          teamNames: ["Platform"],
          hiddenTeamCount: 1,
          hasTeamInReach: true,
        },
      ],
    });
    expect(Response.setNoCacheHeaders).toHaveBeenCalled();
  });

  test("asks with the caller's own permissions, in the request's project, about the people named", async () => {
    await callRoute({
      userIds: [GRACE.toString(), ALAN.toString(), GRACE.toString()],
      projectId: ObjectID.generate().toString(),
    });

    expect(reachSpy).toHaveBeenCalledTimes(1);
    const asked: {
      userIds: Array<ObjectID>;
      projectId: ObjectID;
      props: DatabaseCommonInteractionProps;
    } = reachSpy.mock.calls[0]![0] as {
      userIds: Array<ObjectID>;
      projectId: ObjectID;
      props: DatabaseCommonInteractionProps;
    };

    expect(
      asked.userIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([GRACE.toString(), ALAN.toString()]);
    // The tenant's, never a project the body names.
    expect(asked.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(asked.props.isRoot).toBeFalsy();
    expect(asked.props.userId?.toString()).toBe(CALLER_ID.toString());

    // The names are read with the same permissions, for the teams found.
    const read: {
      teamIds: Array<ObjectID>;
      projectId: ObjectID;
      props: DatabaseCommonInteractionProps;
    } = namesSpy.mock.calls[0]![0] as {
      teamIds: Array<ObjectID>;
      projectId: ObjectID;
      props: DatabaseCommonInteractionProps;
    };

    expect(
      read.teamIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([PLATFORM.toString(), SECURITY.toString()]);
    expect(read.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(read.props).toBe(asked.props);
  });

  test("counts a membership that names no team among the teams it cannot name", async () => {
    reachSpy.mockResolvedValue([
      {
        userId: GRACE,
        teamIds: [],
        membershipsWithoutTeam: 1,
        hasTeamInReach: false,
      },
    ]);

    await callRoute({ userIds: [GRACE.toString()] });

    expect(answered()).toEqual({
      people: [
        {
          userId: GRACE.toString(),
          teamNames: [],
          hiddenTeamCount: 1,
          hasTeamInReach: false,
        },
      ],
    });
  });

  test("answers nobody when the caller's Remove from Project would leave nobody", async () => {
    reachSpy.mockResolvedValue([]);

    await callRoute({ userIds: [GRACE.toString()] });

    expect(answered()).toEqual({ people: [] });
  });

  test.each([
    ["no list", {}],
    ["a list of something else", { userIds: [42] }],
    ["an id that is not one", { userIds: ["'; DROP TABLE TeamMember; --"] }],
    [
      "more people than a page holds",
      {
        userIds: Array.from(
          { length: MAX_PEOPLE_PER_PROJECT_REMOVAL_REACH + 1 },
          (): string => {
            return ObjectID.generate().toString();
          },
        ),
      },
    ],
  ])(
    "refuses %s, asking nothing",
    async (_case: string, body: Dictionary<unknown>) => {
      const result: { thrownToNext: unknown } = await callRoute(body);

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(reachSpy).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    },
  );

  test("refuses a caller who is no member of the request's project, asking nothing", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({
        tenantId: PROJECT_ID,
        userId: CALLER_ID,
        userTenantAccessPermission: {},
      });

    const result: { thrownToNext: unknown } = await callRoute({
      userIds: [GRACE.toString()],
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(reachSpy).not.toHaveBeenCalled();
  });

  test("passes on the permission check's refusal of a caller who may remove nobody", async () => {
    const refusal: NotAuthorizedException = new NotAuthorizedException(
      "You do not have permission to delete Team Member.",
    );
    reachSpy.mockRejectedValue(refusal as never);

    const result: { thrownToNext: unknown } = await callRoute({
      userIds: [GRACE.toString()],
    });

    expect(result.thrownToNext).toBe(refusal);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
