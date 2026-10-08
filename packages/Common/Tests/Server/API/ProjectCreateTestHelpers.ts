import DatabaseConfig from "../../../Server/DatabaseConfig";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import Response from "../../../Server/Utils/Response";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import Dictionary from "../../../Types/Dictionary";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { mockRouter } from "./Helpers";
import { getJestSpyOn } from "../../Spy";
import { expect, jest } from "@jest/globals";

/*
 * Sends POST /api/project the way a signed-in user's request reaches it:
 * through the route ProjectAPI registers, the real user middleware (which is
 * what turns a `tenantid` / `projectid` header into the request's tenant),
 * BaseAPI.createItem and ProjectService.create.
 *
 * The test file mocks Server/Utils/Express (getRouter -> mockRouter) and
 * Server/Utils/Response, and constructs ProjectAPI once, as the other API
 * tests do. What is stubbed here are the lookups around the create - the
 * signed-in user, their permissions, SSO - and the seeding that follows it
 * (default teams, states, severities: a dozen other tables).
 */

export function ownerOf(projectId: ObjectID): UserTenantAccessPermission {
  return {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.ProjectOwner,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  };
}

export function globalPermissionFor(
  ownedProjectId: ObjectID,
): UserGlobalAccessPermission {
  return {
    _type: "UserGlobalAccessPermission",
    projectIds: [ownedProjectId],
    globalPermissions: [Permission.Public, Permission.User],
  };
}

// A signed-in user who owns one project and belongs to no other.
export function stubSignedInUser(data: {
  userId: ObjectID;
  ownedProjectId: ObjectID;
}): void {
  getJestSpyOn(JSONWebToken, "decode").mockReturnValue({
    userId: data.userId,
    isMasterAdmin: false,
  } as JSONWebTokenData);
  getJestSpyOn(UserService, "isUserBlocked").mockResolvedValue(false as never);
  getJestSpyOn(UserService, "updateLastActive").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(ProjectService, "updateLastActive").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(
    AccessTokenService,
    "getUserGlobalAccessPermission",
  ).mockResolvedValue(globalPermissionFor(data.ownedProjectId) as never);
  getJestSpyOn(
    AccessTokenService,
    "getUserTenantAccessPermission",
  ).mockImplementation((async (
    _userId: ObjectID,
    projectId: ObjectID,
  ): Promise<UserTenantAccessPermission | null> => {
    return projectId.toString().toLowerCase() ===
      data.ownedProjectId.toString().toLowerCase()
      ? ownerOf(data.ownedProjectId)
      : null;
  }) as never);
  getJestSpyOn(ProjectService, "getRequireSsoForLogin").mockResolvedValue(
    false as never,
  );
  getJestSpyOn(GlobalConfigService, "getRequireSsoForLogin").mockResolvedValue(
    false as never,
  );
  getJestSpyOn(TeamMemberService, "getTeamIdsForUser").mockResolvedValue(
    [] as never,
  );

  // Read by ProjectService.onBeforeCreate for the owner's name and attribution.
  getJestSpyOn(UserService, "findOneById").mockResolvedValue(
    new User() as never,
  );
}

/*
 * Stands in for anything that writes onto the entity after create()'s
 * up-front id check - a service hook, or the old tenant stamp - by putting
 * the given id on the project once ProjectService's real hook has run.
 */
export function putIdOnProjectAfterTheHooks(id: unknown): void {
  type OnBeforeCreate = (
    createBy: CreateBy<Project>,
  ) => Promise<OnCreate<Project>>;

  const realOnBeforeCreate: OnBeforeCreate = (
    ProjectService as unknown as { onBeforeCreate: OnBeforeCreate }
  ).onBeforeCreate.bind(ProjectService);

  getJestSpyOn(ProjectService, "onBeforeCreate").mockImplementation((async (
    createBy: CreateBy<Project>,
  ): Promise<OnCreate<Project>> => {
    const onCreate: OnCreate<Project> = await realOnBeforeCreate(createBy);
    (onCreate.createBy.data as unknown as Dictionary<unknown>)["_id"] = id;
    return onCreate;
  }) as never);
}

export function stubProjectCreateSideEffects(): void {
  getJestSpyOn(
    DatabaseConfig,
    "shouldDisableUserProjectCreation",
  ).mockResolvedValue(false as never);

  /*
   * The server does not require SSO for everyone, so a new project needs no
   * provider (SsoRequirementChanges.beforeProjectCreate reads the rule).
   */
  getJestSpyOn(GlobalConfigService, "findOneBy").mockResolvedValue(
    new GlobalConfig() as never,
  );

  getJestSpyOn(ProjectService, "onCreateSuccess").mockImplementation((async (
    _onCreate: OnCreate<Project>,
    createdItem: Project,
  ): Promise<Project> => {
    return createdItem;
  }) as never);
}

export type ProjectRouteResult = {
  // Passed to next() by the route: what the error handler would answer with.
  forwardedError: unknown;
  // The project sent back by Response.sendEntityResponse.
  sentProject: Project | undefined;
};

export async function postProject(
  headers: Dictionary<string>,
): Promise<ProjectRouteResult> {
  const req: ExpressRequest = {
    method: "POST",
    params: {},
    query: {},
    cookies: {},
    headers: {
      authorization: "Bearer a-signed-in-user",
      ...headers,
    },
    body: { data: { name: "x" } },
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    set: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    send: jest.fn(),
  } as unknown as ExpressResponse;

  jest.mocked(Response.sendEntityResponse).mockClear();
  jest.mocked(Response.sendErrorResponse).mockClear();

  const route: (typeof mockRouter.routes)[number] = mockRouter.match(
    "post",
    "/project",
  );

  // The real user middleware: this is where the header becomes the tenant.
  const middlewareNext: NextFunction = jest.fn();

  for (const middleware of route.middlewares) {
    await middleware(req, res, middlewareNext);
  }

  expect(Response.sendErrorResponse).not.toHaveBeenCalled();
  expect(middlewareNext).toHaveBeenCalledWith();

  let forwardedError: unknown = undefined;

  await route.handlerFunction(req, res, ((error: unknown) => {
    forwardedError = error;
  }) as NextFunction);

  return {
    forwardedError,
    sentProject: jest.mocked(Response.sendEntityResponse).mock.calls[0]?.[2] as
      | Project
      | undefined,
  };
}
