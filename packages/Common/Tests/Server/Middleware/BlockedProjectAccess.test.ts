jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import McpDelegationAuthorization from "../../../Server/Middleware/McpDelegationAuthorization";
import ProjectMiddleware from "../../../Server/Middleware/ProjectAuthorization";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import ApiKeyPermissionService from "../../../Server/Services/ApiKeyPermissionService";
import ApiKeyService from "../../../Server/Services/ApiKeyService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import PlanCutoffCredentialAccess from "../../../Server/Utils/Billing/PlanCutoffCredentialAccess";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import McpDelegationToken from "../../../Server/Utils/Mcp/McpDelegationToken";
import McpOAuthConfig from "../../../Server/Utils/Mcp/McpOAuthConfig";
import Response from "../../../Server/Utils/Response";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import User from "../../../Models/DatabaseModels/User";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import Exception from "../../../Types/Exception/Exception";
import ExceptionMessages from "../../../Types/Exception/ExceptionMessages";
import ProjectBlockedException from "../../../Types/Exception/ProjectBlockedException";
import ServerException from "../../../Types/Exception/ServerException";
import SsoAuthorizationException from "../../../Types/Exception/SsoAuthorizationException";
import HashedString from "../../../Types/HashedString";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A BLOCKED PROJECT REFUSES EVERYONE BUT A MASTER ADMIN.
 *
 * A master admin blocks a project (Admin Dashboard > Projects) and its
 * members "lose access until unblocked". Every door into the project's API
 * says so with a 403 (ProjectBlockedException): a member's session, the
 * project's API keys, an MCP client acting for a member. A master admin's
 * session still reads and writes it, to look into it and clean it up. A
 * request across projects leaves it out. Whether a project is blocked is
 * ProjectService.isProjectBlocked, stubbed here (its cache is
 * ProjectServiceBlockedProject.test.ts); a lookup that fails is an error,
 * never a pass.
 *
 * The real middlewares, tokens signed and verified for real; the services
 * that read Postgres are stubbed.
 * ---------------------------------------------------------------------------
 */

const USER_ID: ObjectID = new ObjectID("b1000000-0000-4000-8000-000000000001");
const BLOCKED_PROJECT_ID: ObjectID = new ObjectID(
  "b1000000-0000-4000-8000-0000000000b1",
);
const LIVE_PROJECT_ID: ObjectID = new ObjectID(
  "b1000000-0000-4000-8000-0000000000a1",
);
const API_KEY_VALUE: ObjectID = new ObjectID(
  "b1000000-0000-4000-8000-000000000002",
);
const API_KEY_ID: ObjectID = new ObjectID(
  "b1000000-0000-4000-8000-000000000003",
);
const MASTER_ADMIN_ID: ObjectID = new ObjectID(
  "b1000000-0000-4000-8000-000000000004",
);
const GRANT_ID: ObjectID = new ObjectID("b1000000-0000-4000-8000-000000000005");

const isBlockedProject: (projectId: ObjectID) => boolean = (
  projectId: ObjectID,
): boolean => {
  return projectId.toString() === BLOCKED_PROJECT_ID.toString();
};

const tenantPermissionIn: (
  projectId: ObjectID,
) => UserTenantAccessPermission = (
  projectId: ObjectID,
): UserTenantAccessPermission => {
  return {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.ProjectMember,
        labelIds: [],
      },
    ],
  };
};

const GLOBAL_PERMISSION: UserGlobalAccessPermission = {
  _type: "UserGlobalAccessPermission",
  projectIds: [BLOCKED_PROJECT_ID, LIVE_PROJECT_ID],
  globalPermissions: [Permission.Public, Permission.User],
};

type SignTokenFunction = (data?: { isMasterAdmin?: boolean }) => string;

const signToken: SignTokenFunction = (data?: {
  isMasterAdmin?: boolean;
}): string => {
  return JSONWebToken.signUserLoginToken({
    tokenData: {
      userId: USER_ID,
      email: new Email("member@example.com"),
      name: new Name("Mia Member"),
      timezone: null,
      isMasterAdmin: Boolean(data?.isMasterAdmin),
      isGlobalLogin: true,
      sessionId: ObjectID.generate(),
    },
    expiresInSeconds: 15 * 60,
  });
};

type BuildRequestFunction = (data: {
  cookies?: Dictionary<string>;
  headers?: Dictionary<string>;
}) => OneUptimeRequest;

const buildRequest: BuildRequestFunction = (data: {
  cookies?: Dictionary<string>;
  headers?: Dictionary<string>;
}): OneUptimeRequest => {
  return {
    params: {},
    query: {},
    body: {},
    cookies: data.cookies || {},
    headers: { ...(data.headers || {}) },
  } as unknown as OneUptimeRequest;
};

interface Outcome {
  next: MockFunction;
  sentError: Exception | undefined;
}

type RunMiddlewareFunction = (
  middleware: (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void>,
  req: OneUptimeRequest,
) => Promise<Outcome>;

// The middleware as Express runs it: it never rejects.
const runMiddleware: RunMiddlewareFunction = async (
  middleware: (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void>,
  req: OneUptimeRequest,
): Promise<Outcome> => {
  const next: MockFunction = getJestMockFunction();
  const res: ExpressResponse = {
    set: jest.fn(),
  } as unknown as ExpressResponse;

  await expect(
    middleware(
      req as unknown as ExpressRequest,
      res,
      next as unknown as NextFunction,
    ),
  ).resolves.toBeUndefined();

  const errorCalls: Array<Array<unknown>> = (
    Response.sendErrorResponse as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  return {
    next: next,
    sentError: errorCalls[0]?.[2] as Exception | undefined,
  };
};

const expectProjectBlocked: (error: unknown) => void = (
  error: unknown,
): void => {
  expect(error).toBeInstanceOf(ProjectBlockedException);
  expect((error as Exception).code).toBe(403);
  expect((error as Exception).message).toBe(ExceptionMessages.ProjectBlocked);
};

let isProjectBlocked: ReturnType<typeof getJestSpyOn>;
let getRequireSsoForLogin: ReturnType<typeof getJestSpyOn>;
let getUserTenantAccessPermission: ReturnType<typeof getJestSpyOn>;

beforeEach(() => {
  jest.clearAllMocks();

  getJestSpyOn(Response, "sendErrorResponse").mockImplementation(() => {
    return undefined as never;
  });

  isProjectBlocked = getJestSpyOn(
    ProjectService,
    "isProjectBlocked",
  ).mockImplementation(async (projectId: ObjectID): Promise<boolean> => {
    return isBlockedProject(projectId);
  });

  getRequireSsoForLogin = getJestSpyOn(
    ProjectService,
    "getRequireSsoForLogin",
  ).mockResolvedValue(false);
  getJestSpyOn(ProjectService, "updateLastActive").mockResolvedValue(undefined);
  getJestSpyOn(UserService, "updateLastActive").mockResolvedValue(undefined);
  getJestSpyOn(UserService, "isUserBlocked").mockResolvedValue(false);
  getJestSpyOn(GlobalConfigService, "getRequireSsoForLogin").mockResolvedValue(
    false,
  );
  getJestSpyOn(
    AccessTokenService,
    "getUserGlobalAccessPermission",
  ).mockResolvedValue(GLOBAL_PERMISSION);
  getUserTenantAccessPermission = getJestSpyOn(
    AccessTokenService,
    "getUserTenantAccessPermission",
  ).mockImplementation(
    async (
      _userId: ObjectID,
      projectId: ObjectID,
    ): Promise<UserTenantAccessPermission> => {
      return tenantPermissionIn(projectId);
    },
  );
  getJestSpyOn(TeamMemberService, "getTeamIdsForUser").mockResolvedValue([]);
  getJestSpyOn(HashedString, "hashValue").mockResolvedValue("hash");
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a member's session in a blocked project", () => {
  test("is refused with a 403 that says the project is blocked", async () => {
    const req: OneUptimeRequest = buildRequest({
      cookies: { "user-token": signToken() },
      headers: { tenantid: BLOCKED_PROJECT_ID.toString() },
    });

    const outcome: Outcome = await runMiddleware(
      UserMiddleware.getUserMiddleware,
      req,
    );

    expect(outcome.next).not.toHaveBeenCalled();
    expectProjectBlocked(outcome.sentError);
    expect(isProjectBlocked).toHaveBeenCalledWith(BLOCKED_PROJECT_ID);
    expect(req.userTenantAccessPermission).toBeUndefined();
  });

  test("is refused before the project's sign-in rules are asked", async () => {
    // Signing in with SSO would not let them in: they are told why instead.
    getRequireSsoForLogin.mockResolvedValue(true);

    const outcome: Outcome = await runMiddleware(
      UserMiddleware.getUserMiddleware,
      buildRequest({
        cookies: { "user-token": signToken() },
        headers: { tenantid: BLOCKED_PROJECT_ID.toString() },
      }),
    );

    expectProjectBlocked(outcome.sentError);
    expect(outcome.sentError).not.toBeInstanceOf(SsoAuthorizationException);
  });

  test("someone who is not a member is not told the project exists, let alone that it is blocked", async () => {
    getUserTenantAccessPermission.mockResolvedValue(null);

    const req: OneUptimeRequest = buildRequest({
      cookies: { "user-token": signToken() },
      headers: { tenantid: BLOCKED_PROJECT_ID.toString() },
    });

    const outcome: Outcome = await runMiddleware(
      UserMiddleware.getUserMiddleware,
      req,
    );

    // As before: no permissions in the project, refused where they are needed.
    expect(outcome.sentError).toBeUndefined();
    expect(outcome.next.mock.calls).toEqual([[]]);
    expect(req.userTenantAccessPermission).toBeUndefined();
  });

  test("the same member opens a project that is not blocked", async () => {
    const req: OneUptimeRequest = buildRequest({
      cookies: { "user-token": signToken() },
      headers: { tenantid: LIVE_PROJECT_ID.toString() },
    });

    const outcome: Outcome = await runMiddleware(
      UserMiddleware.getUserMiddleware,
      req,
    );

    expect(outcome.sentError).toBeUndefined();
    expect(outcome.next.mock.calls).toEqual([[]]);
    expect(
      req.userTenantAccessPermission?.[LIVE_PROJECT_ID.toString()],
    ).toBeDefined();
  });

  test("a lookup that fails is an error, not a pass", async () => {
    const failure: ServerException = new ServerException(
      "database unavailable",
    );
    isProjectBlocked.mockRejectedValue(failure);

    const req: OneUptimeRequest = buildRequest({
      cookies: { "user-token": signToken() },
      headers: { tenantid: LIVE_PROJECT_ID.toString() },
    });

    const outcome: Outcome = await runMiddleware(
      UserMiddleware.getUserMiddleware,
      req,
    );

    expect(outcome.next).not.toHaveBeenCalled();
    expect(outcome.sentError).toBe(failure);
    expect(req.userTenantAccessPermission).toBeUndefined();
  });
});

describe("a master admin's session in a blocked project", () => {
  test("still reads and writes it: the block is not asked", async () => {
    const req: OneUptimeRequest = buildRequest({
      cookies: { "user-token": signToken({ isMasterAdmin: true }) },
      headers: { tenantid: BLOCKED_PROJECT_ID.toString() },
    });

    const outcome: Outcome = await runMiddleware(
      UserMiddleware.getUserMiddleware,
      req,
    );

    expect(outcome.sentError).toBeUndefined();
    expect(outcome.next.mock.calls).toEqual([[]]);
    expect(req.userType).toBe(UserType.MasterAdmin);
    expect(isProjectBlocked).not.toHaveBeenCalled();
  });
});

describe("a request across projects", () => {
  const multiTenantRequest: (isMasterAdmin: boolean) => OneUptimeRequest = (
    isMasterAdmin: boolean,
  ): OneUptimeRequest => {
    return buildRequest({
      cookies: { "user-token": signToken({ isMasterAdmin }) },
      headers: { "is-multi-tenant-query": "true" },
    });
  };

  test("leaves a member's blocked project out, and keeps the others", async () => {
    const req: OneUptimeRequest = multiTenantRequest(false);

    const outcome: Outcome = await runMiddleware(
      UserMiddleware.getUserMiddleware,
      req,
    );

    expect(outcome.next.mock.calls).toEqual([[]]);
    expect(Object.keys(req.userTenantAccessPermission || {})).toEqual([
      LIVE_PROJECT_ID.toString(),
    ]);
    // Its permissions are not even read.
    expect(
      getUserTenantAccessPermission.mock.calls.some(
        (call: Array<unknown>): boolean => {
          return String(call[1]) === BLOCKED_PROJECT_ID.toString();
        },
      ),
    ).toBe(false);
  });

  test("keeps it for a master admin", async () => {
    const req: OneUptimeRequest = multiTenantRequest(true);

    await runMiddleware(UserMiddleware.getUserMiddleware, req);

    expect(Object.keys(req.userTenantAccessPermission || {}).sort()).toEqual(
      [BLOCKED_PROJECT_ID.toString(), LIVE_PROJECT_ID.toString()].sort(),
    );
  });

  test("a lookup that fails answers an error instead of leaving the request hanging", async () => {
    const failure: ServerException = new ServerException(
      "database unavailable",
    );
    isProjectBlocked.mockRejectedValue(failure);

    const outcome: Outcome = await runMiddleware(
      UserMiddleware.getUserMiddleware,
      multiTenantRequest(false),
    );

    expect(outcome.next).not.toHaveBeenCalled();
    expect(outcome.sentError).toBe(failure);
  });
});

describe("an API key of a blocked project", () => {
  let getPlanRefusal: ReturnType<typeof getJestSpyOn>;
  let findApiKeyPermissions: ReturnType<typeof getJestSpyOn>;
  let keyProjectId: ObjectID;

  beforeEach(() => {
    keyProjectId = BLOCKED_PROJECT_ID;

    getJestSpyOn(ApiKeyService, "findApiKey").mockImplementation(async () => {
      return {
        id: API_KEY_ID,
        projectId: keyProjectId,
        name: "Terraform",
      };
    });
    findApiKeyPermissions = getJestSpyOn(
      ApiKeyPermissionService,
      "findPermissionsByApiKeyId",
    ).mockResolvedValue([
      {
        permission: Permission.ProjectAdmin,
        labelIds: [],
        isBlockPermission: false,
      },
    ]);
    getPlanRefusal = getJestSpyOn(
      PlanCutoffCredentialAccess,
      "getRefusal",
    ).mockResolvedValue(null);
    getJestSpyOn(GlobalConfigService, "findOneBy").mockResolvedValue(null);
    getJestSpyOn(UserService, "findOneBy").mockResolvedValue(null);
  });

  const authenticate: (
    headers: Dictionary<string>,
  ) => Promise<{ error: unknown; req: OneUptimeRequest }> = async (
    headers: Dictionary<string>,
  ): Promise<{ error: unknown; req: OneUptimeRequest }> => {
    const req: OneUptimeRequest = buildRequest({ headers });
    const outcome: Outcome = await runMiddleware(
      ProjectMiddleware.isValidProjectIdAndApiKeyMiddleware.bind(
        ProjectMiddleware,
      ),
      req,
    );

    expect(outcome.next).toHaveBeenCalledTimes(1);

    return { error: outcome.next.mock.calls[0]![0], req: req };
  };

  test("is refused with a 403, before its plan or permissions are read", async () => {
    const outcome: { error: unknown; req: OneUptimeRequest } =
      await authenticate({
        apikey: API_KEY_VALUE.toString(),
      });

    expectProjectBlocked(outcome.error);
    expect(getPlanRefusal).not.toHaveBeenCalled();
    expect(findApiKeyPermissions).not.toHaveBeenCalled();
    expect(outcome.req.userType).toBeUndefined();
    expect(outcome.req.userTenantAccessPermission).toBeUndefined();
  });

  test("asks about the key's own project, whatever project the caller names", async () => {
    await authenticate({
      apikey: API_KEY_VALUE.toString(),
      tenantid: LIVE_PROJECT_ID.toString(),
    });

    expect(isProjectBlocked).toHaveBeenCalledTimes(1);
    expect(String(isProjectBlocked.mock.calls[0]![0])).toBe(
      BLOCKED_PROJECT_ID.toString(),
    );
  });

  test("a key of a project that is not blocked works as before", async () => {
    keyProjectId = LIVE_PROJECT_ID;

    const outcome: { error: unknown; req: OneUptimeRequest } =
      await authenticate({
        apikey: API_KEY_VALUE.toString(),
      });

    expect(outcome.error).toBeUndefined();
    expect(outcome.req.userType).toBe(UserType.API);
    expect(outcome.req.tenantId?.toString()).toBe(LIVE_PROJECT_ID.toString());
  });

  test("a lookup that fails is an error, not a pass", async () => {
    const failure: ServerException = new ServerException(
      "database unavailable",
    );
    isProjectBlocked.mockRejectedValue(failure);

    const outcome: { error: unknown; req: OneUptimeRequest } =
      await authenticate({
        apikey: API_KEY_VALUE.toString(),
      });

    expect(outcome.error).toBe(failure);
    expect(outcome.req.userType).toBeUndefined();
  });

  test("the instance's master key is no project's key, and is let through", async () => {
    getJestSpyOn(ApiKeyService, "findApiKey").mockResolvedValue(null);
    getJestSpyOn(GlobalConfigService, "findOneBy").mockResolvedValue(
      new GlobalConfig(),
    );
    const masterAdmin: User = new User();
    masterAdmin._id = MASTER_ADMIN_ID.toString();
    masterAdmin.email = new Email("admin@example.com");
    masterAdmin.name = new Name("Ada Admin");
    getJestSpyOn(UserService, "findOneBy").mockResolvedValue(masterAdmin);

    const outcome: { error: unknown; req: OneUptimeRequest } =
      await authenticate({
        apikey: API_KEY_VALUE.toString(),
        tenantid: BLOCKED_PROJECT_ID.toString(),
      });

    expect(outcome.error).toBeUndefined();
    expect(outcome.req.userType).toBe(UserType.MasterAdmin);
    expect(isProjectBlocked).not.toHaveBeenCalled();
  });
});

describe("an MCP client acting for a member in a blocked project", () => {
  beforeEach(() => {
    getJestSpyOn(McpOAuthConfig, "isEnabled").mockReturnValue(true);
  });

  const delegatedRequest: (projectId: ObjectID) => OneUptimeRequest = (
    projectId: ObjectID,
  ): OneUptimeRequest => {
    return buildRequest({
      headers: {
        [McpDelegationToken.HEADER_NAME]: McpDelegationToken.sign({
          userId: USER_ID,
          userEmail: new Email("member@example.com"),
          userName: "Mia Member",
          projectId: projectId,
          grantId: GRANT_ID,
          clientId: "https://claude.ai/oauth/mcp-client-metadata",
          clientName: "Claude",
          canWrite: true,
        }),
      },
    });
  };

  test("is refused with a 403, and nothing is read for it", async () => {
    const req: OneUptimeRequest = delegatedRequest(BLOCKED_PROJECT_ID);

    const outcome: Outcome = await runMiddleware(
      McpDelegationAuthorization.authorize,
      req,
    );

    expect(outcome.next).not.toHaveBeenCalled();
    expectProjectBlocked(outcome.sentError);
    expect(getUserTenantAccessPermission).not.toHaveBeenCalled();
    expect(req.userAuthorization).toBeUndefined();
  });

  test("goes through the user middleware the same way", async () => {
    const outcome: Outcome = await runMiddleware(
      UserMiddleware.getUserMiddleware,
      delegatedRequest(BLOCKED_PROJECT_ID),
    );

    expectProjectBlocked(outcome.sentError);
  });

  test("a project that is not blocked is let through", async () => {
    const req: OneUptimeRequest = delegatedRequest(LIVE_PROJECT_ID);

    const outcome: Outcome = await runMiddleware(
      McpDelegationAuthorization.authorize,
      req,
    );

    expect(outcome.sentError).toBeUndefined();
    expect(outcome.next.mock.calls).toEqual([[]]);
    expect(req.tenantId?.toString()).toBe(LIVE_PROJECT_ID.toString());
  });
});
