import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it; nothing password-related is under
 * test here, so it is replaced with a factory.
 */
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

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
    },
  };
});

import McpDelegationAuthorization from "../../../Server/Middleware/McpDelegationAuthorization";
import ProjectMiddleware from "../../../Server/Middleware/ProjectAuthorization";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import CookieUtil from "../../../Server/Utils/Cookie";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import McpDelegationToken, {
  McpDelegationClaims,
} from "../../../Server/Utils/Mcp/McpDelegationToken";
import McpOAuthConfig from "../../../Server/Utils/Mcp/McpOAuthConfig";
import Response from "../../../Server/Utils/Response";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";

/*
 * The first thing UserMiddleware does with a request is ask whether it carries
 * an MCP delegation token, and if so hand the WHOLE request to
 * McpDelegationAuthorization.
 *
 * Why the order is the security property. Every other way in is more
 * generous than a delegation: a session cookie is the member in all their
 * projects (and a master admin's is the instance), an API key is whatever the
 * key is, and no credential at all is "Public", which several routes serve.
 * If a request that PRESENTS a delegation token could fall through to any of
 * those - because the token did not verify, or because another credential was
 * sitting beside it - then a bad token would be worth more than a good one.
 * So the header claims the request: it is answered as a delegation, or it is
 * refused.
 *
 * The middleware runs for real here (both of its entry points), with real
 * tokens of both kinds. Only the services that reach Postgres are stubbed.
 */

type SpyInstance = ReturnType<typeof getJestSpyOn>;
type MockedFn = ReturnType<typeof jest.fn>;

type Middleware = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

const sendErrorResponseMock: MockedFn =
  Response.sendErrorResponse as unknown as MockedFn;

const HEADER: string = "x-oneuptime-mcp-delegation";

const MEMBER_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ADMIN_ID: ObjectID = new ObjectID("99999999-9999-4999-8999-999999999999");
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const GRANT_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

const delegationToken: (overrides?: Partial<McpDelegationClaims>) => string = (
  overrides: Partial<McpDelegationClaims> = {},
): string => {
  return McpDelegationToken.sign({
    userId: MEMBER_ID,
    userEmail: new Email("member@example.com"),
    userName: "Mia Member",
    projectId: PROJECT_ID,
    grantId: GRANT_ID,
    clientId: "https://claude.ai/oauth/mcp-client-metadata",
    clientName: "Claude",
    canWrite: true,
    ...overrides,
  });
};

/*
 * A real dashboard session token - and a master admin's, the most valuable
 * credential a request could be mistaken for.
 */
const masterAdminSessionToken: () => string = (): string => {
  return JSONWebToken.signUserLoginToken({
    tokenData: {
      userId: ADMIN_ID,
      email: new Email("admin@example.com"),
      name: new Name("Ada Admin"),
      timezone: null,
      isMasterAdmin: true,
      isGlobalLogin: true,
      sessionId: ObjectID.generate(),
    },
    expiresInSeconds: 15 * 60,
  });
};

const buildRequest: (parts: {
  headers?: Record<string, string | Array<string>>;
  cookies?: Record<string, string>;
}) => ExpressRequest = (parts: {
  headers?: Record<string, string | Array<string>>;
  cookies?: Record<string, string>;
}): ExpressRequest => {
  return {
    headers: parts.headers || {},
    cookies: parts.cookies || {},
    body: {},
    params: {},
    query: {},
  } as unknown as ExpressRequest;
};

const sessionCookie: () => Record<string, string> = (): Record<
  string,
  string
> => {
  return { [CookieUtil.getUserTokenKey()]: masterAdminSessionToken() };
};

const ENTRY_POINTS: Array<[string, Middleware]> = [
  [
    "getUserMiddleware",
    (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      return UserMiddleware.getUserMiddleware(req, res, next);
    },
  ],
  [
    "getPublicRouteUserMiddleware",
    (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      return UserMiddleware.getPublicRouteUserMiddleware(req, res, next);
    },
  ],
];

describe("UserMiddleware hands a request with an MCP delegation token to McpDelegationAuthorization, and to nothing else", () => {
  let res: ExpressResponse;
  let next: MockedFn;

  let jwtDecodeSpy: SpyInstance;
  let apiKeyMiddlewareSpy: SpyInstance;
  let getProjectIdSpy: SpyInstance;
  let projectLastActiveSpy: SpyInstance;
  let isUserBlockedSpy: SpyInstance;
  let tenantPermissionSpy: SpyInstance;

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.ProjectMember,
        labelIds: [],
      },
    ],
  };

  const globalPermission: UserGlobalAccessPermission = {
    _type: "UserGlobalAccessPermission",
    projectIds: [PROJECT_ID, OTHER_PROJECT_ID],
    globalPermissions: [
      Permission.Public,
      Permission.User,
      Permission.CurrentUser,
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();

    res = { set: jest.fn() } as unknown as ExpressResponse;
    next = jest.fn();

    getJestSpyOn(McpOAuthConfig, "isEnabled").mockReturnValue(true);

    jwtDecodeSpy = getJestSpyOn(JSONWebToken, "decode");
    apiKeyMiddlewareSpy = getJestSpyOn(
      ProjectMiddleware,
      "isValidProjectIdAndApiKeyMiddleware",
    ).mockImplementation(
      async (
        _req: ExpressRequest,
        _res: ExpressResponse,
        nextFn: NextFunction,
      ): Promise<void> => {
        nextFn();
      },
    );
    getProjectIdSpy = getJestSpyOn(ProjectMiddleware, "getProjectId");

    projectLastActiveSpy = getJestSpyOn(
      ProjectService,
      "updateLastActive",
    ).mockResolvedValue(undefined);
    getJestSpyOn(UserService, "updateLastActive").mockResolvedValue(undefined);
    isUserBlockedSpy = getJestSpyOn(
      UserService,
      "isUserBlocked",
    ).mockResolvedValue(false);
    getJestSpyOn(
      AccessTokenService,
      "getUserGlobalAccessPermission",
    ).mockResolvedValue(globalPermission);
    tenantPermissionSpy = getJestSpyOn(
      AccessTokenService,
      "getUserTenantAccessPermission",
    ).mockResolvedValue(tenantPermission);
    getJestSpyOn(TeamMemberService, "getTeamIdsForUser").mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const run: (
    middleware: Middleware,
    req: ExpressRequest,
  ) => Promise<void> = async (
    middleware: Middleware,
    req: ExpressRequest,
  ): Promise<void> => {
    await middleware(req, res, next as unknown as NextFunction);
  };

  const refusal: () => Exception = (): Exception => {
    expect(sendErrorResponseMock).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();

    return sendErrorResponseMock.mock.calls[0]![2] as Exception;
  };

  const expectAnsweredAsNobody: (req: ExpressRequest) => void = (
    req: ExpressRequest,
  ): void => {
    const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

    // Not Public, not the cookie's user, not an API caller: nothing at all.
    expect(oneuptimeRequest.userType).toBeUndefined();
    expect(oneuptimeRequest.userAuthorization).toBeUndefined();
    expect(oneuptimeRequest.tenantId).toBeUndefined();
    expect(oneuptimeRequest.userTenantAccessPermission).toBeUndefined();
    expect(oneuptimeRequest.userGlobalAccessPermission).toBeUndefined();
  };

  describe.each(ENTRY_POINTS)("%s", (_name: string, middleware: Middleware) => {
    describe("a delegation token that does not verify", () => {
      test("with nothing else on the request: 401, NOT an anonymous (Public) request", async () => {
        const req: ExpressRequest = buildRequest({
          headers: { [HEADER]: "not-a-token" },
        });

        await run(middleware, req);

        expect(refusal()).toBeInstanceOf(NotAuthenticatedException);
        expectAnsweredAsNobody(req);
      });

      test("beside a perfectly valid master-admin session cookie: 401, and the cookie is never even read", async () => {
        const req: ExpressRequest = buildRequest({
          headers: { [HEADER]: "not-a-token" },
          cookies: sessionCookie(),
        });

        await run(middleware, req);

        expect(refusal()).toBeInstanceOf(NotAuthenticatedException);
        expectAnsweredAsNobody(req);
        // The session token was not decoded: it had no say in the answer.
        expect(jwtDecodeSpy).not.toHaveBeenCalled();
      });

      test("beside a valid session token in Authorization: Bearer (the mobile flow): 401", async () => {
        const req: ExpressRequest = buildRequest({
          headers: {
            [HEADER]: "not-a-token",
            authorization: `Bearer ${masterAdminSessionToken()}`,
          },
        });

        await run(middleware, req);

        expect(refusal()).toBeInstanceOf(NotAuthenticatedException);
        expectAnsweredAsNobody(req);
        expect(jwtDecodeSpy).not.toHaveBeenCalled();
      });

      test("an EMPTY delegation header beside a valid session cookie is still refused", async () => {
        const req: ExpressRequest = buildRequest({
          headers: { [HEADER]: "" },
          cookies: sessionCookie(),
        });

        await run(middleware, req);

        expect(refusal()).toBeInstanceOf(NotAuthenticatedException);
        expectAnsweredAsNobody(req);
      });

      test("an expired delegation token beside a valid session cookie is still refused", async () => {
        const expired: string = McpDelegationToken.sign(
          {
            userId: MEMBER_ID,
            userEmail: new Email("member@example.com"),
            userName: "Mia Member",
            projectId: PROJECT_ID,
            grantId: GRANT_ID,
            clientId: "client",
            clientName: "Client",
            canWrite: true,
          },
          new Date(Date.now() - 2 * 60 * 1000),
        );

        const req: ExpressRequest = buildRequest({
          headers: { [HEADER]: expired },
          cookies: sessionCookie(),
        });

        await run(middleware, req);

        expect(refusal()).toBeInstanceOf(NotAuthenticatedException);
        expectAnsweredAsNobody(req);
      });
    });

    describe("a delegation token beside an API key", () => {
      test("is refused as two credentials, and the API-key middleware never runs", async () => {
        const req: ExpressRequest = buildRequest({
          headers: {
            [HEADER]: delegationToken(),
            apikey: ObjectID.generate().toString(),
          },
        });

        await run(middleware, req);

        expect(refusal()).toBeInstanceOf(BadDataException);
        expect(apiKeyMiddlewareSpy).not.toHaveBeenCalled();
        expectAnsweredAsNobody(req);
      });

      test("a bad delegation token beside an API key does not fall back to the key", async () => {
        const req: ExpressRequest = buildRequest({
          headers: {
            [HEADER]: "not-a-token",
            apikey: ObjectID.generate().toString(),
          },
        });

        await run(middleware, req);

        expect(sendErrorResponseMock).toHaveBeenCalledTimes(1);
        expect(next).not.toHaveBeenCalled();
        expect(apiKeyMiddlewareSpy).not.toHaveBeenCalled();
      });
    });

    describe("a valid delegation token", () => {
      test("beside a master admin's session cookie: the request is the delegated MEMBER's, never the admin's", async () => {
        const req: ExpressRequest = buildRequest({
          headers: { [HEADER]: delegationToken() },
          cookies: sessionCookie(),
        });

        await run(middleware, req);

        expect(sendErrorResponseMock).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledTimes(1);

        const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

        expect(oneuptimeRequest.userAuthorization?.userId.toString()).toBe(
          MEMBER_ID.toString(),
        );
        expect(oneuptimeRequest.userAuthorization?.userId.toString()).not.toBe(
          ADMIN_ID.toString(),
        );
        expect(oneuptimeRequest.userType).toBe(UserType.User);
        expect(oneuptimeRequest.userAuthorization?.isMasterAdmin).toBe(false);
        expect(jwtDecodeSpy).not.toHaveBeenCalled();

        // Blocked status and permissions were read for the member, not the admin.
        expect(
          (isUserBlockedSpy.mock.calls[0]![0] as ObjectID).toString(),
        ).toBe(MEMBER_ID.toString());
        expect(
          (tenantPermissionSpy.mock.calls[0]![0] as ObjectID).toString(),
        ).toBe(MEMBER_ID.toString());
      });

      test("the tenant header is not read at all: the project is the token's, and only it is marked active", async () => {
        const req: ExpressRequest = buildRequest({
          headers: {
            [HEADER]: delegationToken(),
            tenantid: OTHER_PROJECT_ID.toString(),
          },
        });

        await run(middleware, req);

        expect(next).toHaveBeenCalledTimes(1);
        expect((req as OneUptimeRequest).tenantId?.toString()).toBe(
          PROJECT_ID.toString(),
        );

        // The dispatch comes before the tenant header is looked at.
        expect(getProjectIdSpy).not.toHaveBeenCalled();
        expect(projectLastActiveSpy).toHaveBeenCalledTimes(1);
        expect(
          (projectLastActiveSpy.mock.calls[0]![0] as ObjectID).toString(),
        ).toBe(PROJECT_ID.toString());
      });

      test("does not send the dashboard's permission-hash response headers", async () => {
        await run(
          middleware,
          buildRequest({ headers: { [HEADER]: delegationToken() } }),
        );

        expect(next).toHaveBeenCalledTimes(1);
        expect(
          (res as unknown as { set: MockedFn }).set,
        ).not.toHaveBeenCalled();
      });
    });

    describe("a request WITHOUT the delegation header never reaches McpDelegationAuthorization", () => {
      let authorizeSpy: SpyInstance;

      beforeEach(() => {
        authorizeSpy = getJestSpyOn(McpDelegationAuthorization, "authorize");
      });

      test("no credentials at all: anonymous, as before", async () => {
        const req: ExpressRequest = buildRequest({});

        await run(middleware, req);

        expect(authorizeSpy).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledTimes(1);
        expect((req as OneUptimeRequest).userType).toBe(UserType.Public);
      });

      test("an API key: the API-key middleware, as before", async () => {
        const req: ExpressRequest = buildRequest({
          headers: { apikey: ObjectID.generate().toString() },
        });

        await run(middleware, req);

        expect(authorizeSpy).not.toHaveBeenCalled();
        expect(apiKeyMiddlewareSpy).toHaveBeenCalledTimes(1);
      });

      test("a session cookie: the session, as before - master admin and all", async () => {
        const req: ExpressRequest = buildRequest({ cookies: sessionCookie() });

        await run(middleware, req);

        expect(authorizeSpy).not.toHaveBeenCalled();
        expect(sendErrorResponseMock).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledTimes(1);

        const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

        expect(oneuptimeRequest.userAuthorization?.userId.toString()).toBe(
          ADMIN_ID.toString(),
        );
        expect(oneuptimeRequest.userType).toBe(UserType.MasterAdmin);
        expect(oneuptimeRequest.mcpOAuth).toBeUndefined();
      });

      test("a header with a similar name is not the delegation header", async () => {
        const req: ExpressRequest = buildRequest({
          headers: { "x-oneuptime-mcp-delegation-token": delegationToken() },
        });

        await run(middleware, req);

        expect(authorizeSpy).not.toHaveBeenCalled();
        expect((req as OneUptimeRequest).userType).toBe(UserType.Public);
      });
    });
  });

  test("the dispatch is by the header McpDelegationToken names", () => {
    expect(McpDelegationToken.HEADER_NAME).toBe(HEADER);
    expect(
      McpDelegationAuthorization.hasDelegationToken(
        buildRequest({ headers: { [HEADER]: "anything" } }),
      ),
    ).toBe(true);
  });
});
