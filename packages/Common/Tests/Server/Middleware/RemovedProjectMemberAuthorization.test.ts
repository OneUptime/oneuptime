import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import ProjectMiddleware from "../../../Server/Middleware/ProjectAuthorization";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import UserService from "../../../Server/Services/UserService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import Response from "../../../Server/Utils/Response";
import Email from "../../../Types/Email";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import HashedString from "../../../Types/HashedString";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The customer's report, end to end through the request middleware: a user who
 * is signed in and is then removed from a project must be refused on their
 * next request to it, not served the role they had as a member.
 *
 * The middleware, AccessTokenService, UserPermissionUtil and the membership
 * refresh are real. Postgres (TeamMember and TeamPermission reads) and Redis
 * (GlobalCache) are in-memory stand-ins; token decoding and the error response
 * are mocked at the module boundary, as in UserAuthorization.test.ts.
 */

interface Membership {
  userId: ObjectID;
  projectId: ObjectID;
  teamId: ObjectID;
}

const mockStore: Map<string, string> = new Map<string, string>();
const mockSetJSON: jest.Mock = jest.fn();
const mockGetJSONObject: jest.Mock = jest.fn();
const mockDeleteKey: jest.Mock = jest.fn();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the compiled
 * requires, so naming the mocks directly would capture them before their
 * initializers have run.
 */
jest.mock("../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      setJSON: (...args: Array<unknown>) => {
        return mockSetJSON(...args);
      },
      getJSONObject: (...args: Array<unknown>) => {
        return mockGetJSONObject(...args);
      },
      deleteKey: (...args: Array<unknown>) => {
        return mockDeleteKey(...args);
      },
    },
  };
});
jest.mock("../../../Server/Utils/Logger");
jest.mock("../../../Server/Middleware/ProjectAuthorization");
jest.mock("../../../Server/Utils/JsonWebToken");
jest.mock("../../../Server/Utils/Response");
// See UserAuthorization.test.ts: replaced with a factory so its file is never required.
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

const projectId: ObjectID = ObjectID.generate();
const aliceId: ObjectID = ObjectID.generate();
const bobId: ObjectID = ObjectID.generate();
const membersTeamId: ObjectID = ObjectID.generate();

// The default Members team: enough to acknowledge, resolve and post public notes.
const MEMBER_ROLE: Array<Permission> = [
  Permission.ProjectMember,
  Permission.EditProjectIncident,
  Permission.CreateIncidentPublicNote,
];

const memberships: Array<Membership> = [];

type ValuesOfFunction = (queryValue: unknown) => Array<string>;

/*
 * A query column is either a plain value or QueryHelper.any(...), a TypeORM
 * Raw operator that carries its values as a named parameter.
 */
const valuesOf: ValuesOfFunction = (queryValue: unknown): Array<string> => {
  const parameters: Record<string, unknown> | undefined = (
    queryValue as { objectLiteralParameters?: Record<string, unknown> }
  )?.objectLiteralParameters;

  const values: Array<unknown> | undefined = Object.values(
    parameters || {},
  ).find((parameter: unknown) => {
    return Array.isArray(parameter);
  }) as Array<unknown> | undefined;

  return (values || [queryValue]).map((value: unknown) => {
    return String(value);
  });
};

type MembershipsOfFunction = (query: {
  userId?: ObjectID;
  projectId?: ObjectID;
}) => Array<Membership>;

const membershipsOf: MembershipsOfFunction = (query: {
  userId?: ObjectID;
  projectId?: ObjectID;
}): Array<Membership> => {
  return memberships.filter((membership: Membership) => {
    return (
      (query.userId === undefined ||
        membership.userId.toString() === query.userId.toString()) &&
      (query.projectId === undefined ||
        membership.projectId.toString() === query.projectId.toString())
    );
  });
};

type RemoveFromProjectFunction = (userId: ObjectID) => void;

const deleteMembershipRows: RemoveFromProjectFunction = (
  userId: ObjectID,
): void => {
  for (const membership of membershipsOf({ userId, projectId })) {
    memberships.splice(memberships.indexOf(membership), 1);
  }
};

type MakeRequestFunction = (userId: ObjectID) => ExpressRequest;

const makeRequest: MakeRequestFunction = (userId: ObjectID): ExpressRequest => {
  return {
    headers: { tenantid: projectId.toString() },
    cookies: { "user-token": `token-of-${userId.toString()}` },
    query: {},
    body: {},
  } as unknown as ExpressRequest;
};

interface RequestOutcome {
  req: OneUptimeRequest;
  passedAuthentication: boolean;
  passedPermissionCheck: boolean;
  headers: Map<string, string>;
}

type SendFunction = (userId: ObjectID) => Promise<RequestOutcome>;

/*
 * One dashboard request: getUserMiddleware, then the permission check a route
 * that edits incidents puts in front of its handler.
 */
const send: SendFunction = async (
  userId: ObjectID,
): Promise<RequestOutcome> => {
  const req: ExpressRequest = makeRequest(userId);
  const headers: Map<string, string> = new Map<string, string>();
  const res: ExpressResponse = {
    set: (name: string, value: string): void => {
      headers.set(name, value);
    },
  } as unknown as ExpressResponse;

  jest.mocked(JSONWebToken.decode).mockReturnValue({
    userId: userId,
    email: new Email("member@example.com"),
    name: undefined,
    isMasterAdmin: false,
    isGlobalLogin: true,
  } as unknown as JSONWebTokenData);

  let passedAuthentication: boolean = false;
  await UserMiddleware.getUserMiddleware(req, res, (() => {
    passedAuthentication = true;
  }) as NextFunction);

  let passedPermissionCheck: boolean = false;
  if (passedAuthentication) {
    await UserMiddleware.requirePermission({
      permissions: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.EditProjectIncident,
      ],
    })(req, res, (() => {
      passedPermissionCheck = true;
    }) as NextFunction);
  }

  return {
    req: req as OneUptimeRequest,
    passedAuthentication,
    passedPermissionCheck,
    headers,
  };
};

type ProjectPermissionNamesFunction = (
  outcome: RequestOutcome,
) => Array<Permission>;

const projectPermissionNames: ProjectPermissionNamesFunction = (
  outcome: RequestOutcome,
): Array<Permission> => {
  return (
    outcome.req.userTenantAccessPermission?.[projectId.toString()]
      ?.permissions || []
  ).map((row: UserPermission) => {
    return row.permission;
  });
};

type SignInFunction = (userId: ObjectID) => Promise<void>;

const signIn: SignInFunction = async (userId: ObjectID): Promise<void> => {
  await AccessTokenService.refreshUserAllPermissions(userId);
};

describe("UserMiddleware - a user removed from a project is refused on their next request", () => {
  beforeEach(() => {
    memberships.length = 0;
    mockStore.clear();
    jest.clearAllMocks();

    mockSetJSON.mockImplementation((async (
      namespace: string,
      key: string,
      value: JSONObject,
    ): Promise<void> => {
      mockStore.set(
        `${namespace}-${key}`,
        JSON.stringify(JSONFunctions.serialize(value)),
      );
    }) as never);

    mockDeleteKey.mockImplementation((async (
      namespace: string,
      key: string,
    ): Promise<void> => {
      mockStore.delete(`${namespace}-${key}`);
    }) as never);

    mockGetJSONObject.mockImplementation((async (
      namespace: string,
      key: string,
    ): Promise<JSONObject | null> => {
      const raw: string | undefined = mockStore.get(`${namespace}-${key}`);

      if (!raw) {
        return null;
      }

      return JSONFunctions.deserialize(JSONFunctions.parse(raw) as JSONObject);
    }) as never);

    jest.mocked(ProjectMiddleware.getProjectId).mockReturnValue(projectId);
    jest.mocked(ProjectMiddleware.hasApiKey).mockReturnValue(false);

    jest.spyOn(TeamMemberService, "findBy").mockImplementation((async (data: {
      query: {
        userId?: ObjectID;
        projectId?: ObjectID;
        hasAcceptedInvitation?: boolean;
      };
      skip?: number;
      limit?: number;
    }): Promise<Array<TeamMember>> => {
      const skip: number = Number(data.skip || 0);

      // Pages like Postgres does, so findAllBy's batching runs for real.
      return membershipsOf(data.query)
        .slice(skip, data.limit === undefined ? undefined : skip + data.limit)
        .map((membership: Membership) => {
          const teamMember: TeamMember = new TeamMember();
          teamMember.userId = membership.userId;
          teamMember.projectId = membership.projectId;
          teamMember.teamId = membership.teamId;
          teamMember.hasAcceptedInvitation = true;
          return teamMember;
        });
    }) as never);

    jest
      .spyOn(TeamMemberService, "getTeamIdsForUser")
      .mockImplementation(
        async (
          userId: ObjectID,
          forProjectId: ObjectID,
        ): Promise<Array<ObjectID>> => {
          return membershipsOf({ userId, projectId: forProjectId }).map(
            (membership: Membership) => {
              return membership.teamId;
            },
          );
        },
      );

    jest
      .spyOn(TeamPermissionService, "findBy")
      .mockImplementation((async (data: {
        query: { teamId: unknown };
      }): Promise<Array<TeamPermission>> => {
        return valuesOf(data.query.teamId).includes(membersTeamId.toString())
          ? MEMBER_ROLE.map((permission: Permission) => {
              const teamPermission: TeamPermission = new TeamPermission();
              teamPermission.permission = permission;
              teamPermission.labels = [];
              teamPermission.isBlockPermission = false;
              return teamPermission;
            })
          : [];
      }) as never);

    jest
      .spyOn(ProjectService, "getRequireSsoForLogin")
      .mockResolvedValue(false);
    jest.spyOn(ProjectService, "updateLastActive").mockResolvedValue(undefined);
    jest.spyOn(UserService, "updateLastActive").mockResolvedValue(undefined);
    /*
     * getUserMiddleware refuses a user a master admin has blocked, and asks
     * UserService - a Postgres read - on every request. Nobody here is
     * blocked; a blocked user's token is BlockedUserMiddleware.test.ts.
     */
    jest.spyOn(UserService, "isUserBlocked").mockResolvedValue(false);
    jest
      .spyOn(GlobalConfigService, "getRequireSsoForLogin")
      .mockResolvedValue(false);
    jest.spyOn(HashedString, "hashValue").mockResolvedValue("hash");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a member's request carries their role and passes the permission check", async () => {
    memberships.push({ userId: aliceId, projectId, teamId: membersTeamId });
    await signIn(aliceId);

    const outcome: RequestOutcome = await send(aliceId);

    expect(outcome.passedAuthentication).toBe(true);
    expect(outcome.passedPermissionCheck).toBe(true);
    expect(projectPermissionNames(outcome)).toEqual(
      expect.arrayContaining(MEMBER_ROLE),
    );
    expect(outcome.headers.has("project-permissions")).toBe(true);
  });

  test("after Remove from Project the same signed-in user is refused", async () => {
    memberships.push({ userId: aliceId, projectId, teamId: membersTeamId });
    await signIn(aliceId);
    expect((await send(aliceId)).passedPermissionCheck).toBe(true);

    // TeamMemberService.deleteBy, then its delete hook's permission refresh.
    deleteMembershipRows(aliceId);
    await TeamMemberService.refreshTokens(aliceId, projectId);

    const outcome: RequestOutcome = await send(aliceId);

    expect(outcome.req.userTenantAccessPermission).toBeUndefined();
    expect(outcome.passedPermissionCheck).toBe(false);
    expect(Response.sendErrorResponse).toHaveBeenCalledWith(
      outcome.req,
      expect.anything(),
      new NotAuthorizedException(
        "You do not have permission to access this project.",
      ),
    );
  });

  test("the removed user's browser is not sent a project role any more", async () => {
    memberships.push({ userId: aliceId, projectId, teamId: membersTeamId });
    await signIn(aliceId);

    deleteMembershipRows(aliceId);
    await TeamMemberService.refreshTokens(aliceId, projectId);

    const outcome: RequestOutcome = await send(aliceId);

    expect(outcome.headers.has("project-permissions")).toBe(false);
  });

  /*
   * Users removed before this fix still have their old entry in Redis, and no
   * refresh will ever touch it again. The request itself has to refuse it.
   */
  test("a user removed before the fix, whose old entry is still cached, is refused", async () => {
    memberships.push({ userId: aliceId, projectId, teamId: membersTeamId });
    await signIn(aliceId);

    // A removal as the code used to run it: only the global entry was updated.
    deleteMembershipRows(aliceId);
    await AccessTokenService.refreshUserGlobalAccessPermission(aliceId);
    expect(
      mockStore.has(
        `project-permissions-${aliceId.toString()}:${projectId.toString()}`,
      ),
    ).toBe(true);

    const outcome: RequestOutcome = await send(aliceId);

    expect(outcome.req.userTenantAccessPermission).toBeUndefined();
    expect(outcome.passedPermissionCheck).toBe(false);
    expect(
      mockStore.has(
        `project-permissions-${aliceId.toString()}:${projectId.toString()}`,
      ),
    ).toBe(false);
  });

  test("a member of the same project is still let in after another member is removed", async () => {
    memberships.push({ userId: aliceId, projectId, teamId: membersTeamId });
    memberships.push({ userId: bobId, projectId, teamId: membersTeamId });
    await signIn(aliceId);
    await signIn(bobId);

    deleteMembershipRows(aliceId);
    await TeamMemberService.refreshTokens(aliceId, projectId);

    const outcome: RequestOutcome = await send(bobId);

    expect(outcome.passedPermissionCheck).toBe(true);
    expect(projectPermissionNames(outcome)).toEqual(
      expect.arrayContaining(MEMBER_ROLE),
    );
  });

  // The membership check reuses the global entry the middleware already reads.
  test("a member's request reads the global entry once", async () => {
    memberships.push({ userId: aliceId, projectId, teamId: membersTeamId });
    await signIn(aliceId);
    mockGetJSONObject.mockClear();

    await send(aliceId);

    expect(
      mockGetJSONObject.mock.calls.filter((call: Array<unknown>) => {
        return call[0] === "user";
      }),
    ).toHaveLength(1);
  });
});
