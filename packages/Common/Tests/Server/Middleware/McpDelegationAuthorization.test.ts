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
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import McpDelegationToken, {
  McpDelegationClaims,
} from "../../../Server/Utils/Mcp/McpDelegationToken";
import McpOAuthConfig from "../../../Server/Utils/Mcp/McpOAuthConfig";
import Response from "../../../Server/Utils/Response";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import ExceptionMessages from "../../../Types/Exception/ExceptionMessages";
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
 * How the API authorizes a request the MCP server makes for a member who
 * connected an MCP client with OAuth.
 *
 * The delegation token is the only thing standing between "an MCP client that
 * may read one project" and "a full session for that member", so this suite
 * pins both halves:
 *
 *   WHAT IS REFUSED - every way of presenting the header that is not a valid,
 *   current token minted by this server; a blocked member; a member who has
 *   left the project; the header together with an API key.
 *
 *   WHAT A VALID TOKEN IS WORTH - the member's identity, in exactly ONE
 *   project (the token's, whatever the request's own headers say), as a User
 *   and never a MasterAdmin, with the member's live permissions, read-only
 *   when the grant is.
 *
 * Tokens are minted with the real McpDelegationToken, so the verification
 * here is the real one. Only the services that reach Postgres are stubbed.
 */

type SpyInstance = ReturnType<typeof getJestSpyOn>;
type MockedFn = ReturnType<typeof jest.fn>;

const sendErrorResponseMock: MockedFn =
  Response.sendErrorResponse as unknown as MockedFn;

const HEADER: string = "x-oneuptime-mcp-delegation";

const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const THIRD_PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const GRANT_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const TEAM_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

const CLIENT_ID: string = "https://claude.ai/oauth/mcp-client-metadata";
const CLIENT_NAME: string = "Claude";

const claimsWith: (
  overrides?: Partial<McpDelegationClaims>,
) => McpDelegationClaims = (
  overrides: Partial<McpDelegationClaims> = {},
): McpDelegationClaims => {
  return {
    userId: USER_ID,
    userEmail: new Email("member@example.com"),
    userName: "Mia Member",
    projectId: PROJECT_ID,
    grantId: GRANT_ID,
    clientId: CLIENT_ID,
    clientName: CLIENT_NAME,
    canWrite: true,
    ...overrides,
  };
};

const mintToken: (
  overrides?: Partial<McpDelegationClaims>,
  now?: Date,
) => string = (
  overrides: Partial<McpDelegationClaims> = {},
  now?: Date,
): string => {
  return McpDelegationToken.sign(claimsWith(overrides), now);
};

const buildRequest: (
  headers: Record<string, string | Array<string>>,
  body?: Record<string, unknown>,
) => ExpressRequest = (
  headers: Record<string, string | Array<string>>,
  body: Record<string, unknown> = {},
): ExpressRequest => {
  return {
    headers,
    body,
    params: {},
    query: {},
    cookies: {},
  } as unknown as ExpressRequest;
};

const globalPermission: () => UserGlobalAccessPermission =
  (): UserGlobalAccessPermission => {
    return {
      _type: "UserGlobalAccessPermission",
      projectIds: [OTHER_PROJECT_ID, PROJECT_ID, THIRD_PROJECT_ID],
      globalPermissions: [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
      ],
    };
  };

const tenantPermission: () => UserTenantAccessPermission =
  (): UserTenantAccessPermission => {
    return {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectMember,
          labelIds: [],
        },
        {
          _type: "UserPermission",
          permission: Permission.ReadProjectIncident,
          labelIds: [],
        },
      ],
    };
  };

describe("McpDelegationAuthorization", () => {
  const res: ExpressResponse = {} as ExpressResponse;

  let next: MockedFn;
  let isEnabledSpy: SpyInstance;
  let isUserBlockedSpy: SpyInstance;
  let userLastActiveSpy: SpyInstance;
  let projectLastActiveSpy: SpyInstance;
  let globalPermissionSpy: SpyInstance;
  let tenantPermissionSpy: SpyInstance;
  let teamIdsSpy: SpyInstance;

  let cachedGlobalPermission: UserGlobalAccessPermission;
  let cachedTenantPermission: UserTenantAccessPermission;

  beforeEach(() => {
    jest.clearAllMocks();

    next = jest.fn();

    cachedGlobalPermission = globalPermission();
    cachedTenantPermission = tenantPermission();

    isEnabledSpy = getJestSpyOn(McpOAuthConfig, "isEnabled").mockReturnValue(
      true,
    );
    isUserBlockedSpy = getJestSpyOn(
      UserService,
      "isUserBlocked",
    ).mockResolvedValue(false);
    userLastActiveSpy = getJestSpyOn(
      UserService,
      "updateLastActive",
    ).mockResolvedValue(undefined);
    projectLastActiveSpy = getJestSpyOn(
      ProjectService,
      "updateLastActive",
    ).mockResolvedValue(undefined);
    globalPermissionSpy = getJestSpyOn(
      AccessTokenService,
      "getUserGlobalAccessPermission",
    ).mockResolvedValue(cachedGlobalPermission);
    tenantPermissionSpy = getJestSpyOn(
      AccessTokenService,
      "getUserTenantAccessPermission",
    ).mockResolvedValue(cachedTenantPermission);
    teamIdsSpy = getJestSpyOn(
      TeamMemberService,
      "getTeamIdsForUser",
    ).mockResolvedValue([TEAM_ID]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The middleware answers refusals itself (Response.sendErrorResponse) and
   * must never reject: Express 4 does not catch a rejected async middleware.
   */
  const authorize: (req: ExpressRequest) => Promise<void> = async (
    req: ExpressRequest,
  ): Promise<void> => {
    await expect(
      McpDelegationAuthorization.authorize(
        req,
        res,
        next as unknown as NextFunction,
      ),
    ).resolves.toBeUndefined();
  };

  const refusal: () => Exception = (): Exception => {
    expect(sendErrorResponseMock).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();

    return sendErrorResponseMock.mock.calls[0]![2] as Exception;
  };

  const expectNoIdentity: (req: ExpressRequest) => void = (
    req: ExpressRequest,
  ): void => {
    const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

    expect(oneuptimeRequest.userAuthorization).toBeUndefined();
    expect(oneuptimeRequest.userType).toBeUndefined();
    expect(oneuptimeRequest.tenantId).toBeUndefined();
    expect(oneuptimeRequest.mcpOAuth).toBeUndefined();
    expect(oneuptimeRequest.userGlobalAccessPermission).toBeUndefined();
    expect(oneuptimeRequest.userTenantAccessPermission).toBeUndefined();
    expect(oneuptimeRequest.userTeamIds).toBeUndefined();
  };

  const expectAccepted: () => void = (): void => {
    expect(sendErrorResponseMock).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    // next() with no argument: an argument would be routed as an error.
    expect(next.mock.calls[0]).toEqual([]);
  };

  describe("hasDelegationToken", () => {
    test("is true for a valid token", () => {
      expect(
        McpDelegationAuthorization.hasDelegationToken(
          buildRequest({ [HEADER]: mintToken() }),
        ),
      ).toBe(true);
    });

    const presentButUseless: Array<[string, string | Array<string>]> = [
      ["garbage", "not-a-token"],
      ["an empty value", ""],
      ["whitespace", "   "],
      ["a repeated header", ["a", "b"]],
    ];

    test.each(presentButUseless)(
      "is true for %s: presence, not validity, is what claims the request",
      (_label: string, value: string | Array<string>) => {
        expect(
          McpDelegationAuthorization.hasDelegationToken(
            buildRequest({ [HEADER]: value }),
          ),
        ).toBe(true);
      },
    );

    test("is false when the header was not sent", () => {
      expect(
        McpDelegationAuthorization.hasDelegationToken(
          buildRequest({ apikey: ObjectID.generate().toString() }),
        ),
      ).toBe(false);
    });

    test("is false for a request with no headers at all", () => {
      expect(
        McpDelegationAuthorization.hasDelegationToken(
          {} as unknown as ExpressRequest,
        ),
      ).toBe(false);
    });

    test("the header name is the one the MCP server sends, in lower case", () => {
      expect(McpDelegationToken.HEADER_NAME).toBe(HEADER);
    });
  });

  describe("authorize - what is refused", () => {
    test("OAuth switched off: 401, even for a token that would otherwise verify", async () => {
      isEnabledSpy.mockReturnValue(false);

      const req: ExpressRequest = buildRequest({ [HEADER]: mintToken() });

      await authorize(req);

      const error: Exception = refusal();

      expect(error).toBeInstanceOf(NotAuthenticatedException);
      expect(error.code).toBe(ExceptionCode.NotAuthenticatedException);
      expectNoIdentity(req);
      // Refused before anything is looked up.
      expect(isUserBlockedSpy).not.toHaveBeenCalled();
      expect(tenantPermissionSpy).not.toHaveBeenCalled();
    });

    test("the header together with an API key: 400, whichever of the two would have been good", async () => {
      const req: ExpressRequest = buildRequest({
        [HEADER]: mintToken(),
        apikey: ObjectID.generate().toString(),
      });

      await authorize(req);

      const error: Exception = refusal();

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.code).toBe(ExceptionCode.BadDataException);
      expectNoIdentity(req);
    });

    test("an EMPTY apikey header beside the token is still two credentials", async () => {
      const req: ExpressRequest = buildRequest({
        [HEADER]: mintToken(),
        apikey: "",
      });

      await authorize(req);

      expect(refusal()).toBeInstanceOf(BadDataException);
      expectNoIdentity(req);
    });

    const unusableTokens: Array<[string, () => string | Array<string>]> = [
      [
        "an empty header",
        (): string => {
          return "";
        },
      ],
      [
        "garbage",
        (): string => {
          return "not-a-token";
        },
      ],
      [
        "a token whose signature was altered",
        (): string => {
          const token: string = mintToken();
          const last: string = token.slice(-1) === "A" ? "B" : "A";

          return `${token.slice(0, -1)}${last}`;
        },
      ],
      [
        "a token whose payload was swapped for another project's",
        (): string => {
          const real: Array<string> = mintToken().split(".");
          const forged: Array<string> = mintToken({
            projectId: OTHER_PROJECT_ID,
          }).split(".");

          // Somebody else's payload under this token's signature.
          return `${real[0]}.${forged[1]}.${real[2]}`;
        },
      ],
      [
        "an expired token (minted two minutes ago; it lives for one)",
        (): string => {
          return mintToken({}, new Date(Date.now() - 2 * 60 * 1000));
        },
      ],
      [
        "a token dated an hour in the future",
        (): string => {
          return mintToken({}, new Date(Date.now() + 60 * 60 * 1000));
        },
      ],
      [
        "the header sent twice (an array)",
        (): Array<string> => {
          return [mintToken(), mintToken()];
        },
      ],
      [
        "a valid token with a Bearer prefix left on",
        (): string => {
          return `Bearer ${mintToken()}`;
        },
      ],
      [
        "a valid token with trailing whitespace",
        (): string => {
          return `${mintToken()} `;
        },
      ],
    ];

    test.each(unusableTokens)(
      "%s: 401, and the request leaves with no identity",
      async (_label: string, build: () => string | Array<string>) => {
        const req: ExpressRequest = buildRequest({ [HEADER]: build() });

        await authorize(req);

        const error: Exception = refusal();

        expect(error).toBeInstanceOf(NotAuthenticatedException);
        expect(error.code).toBe(ExceptionCode.NotAuthenticatedException);
        expectNoIdentity(req);
        // A token that does not verify names nobody: nothing is looked up.
        expect(isUserBlockedSpy).not.toHaveBeenCalled();
        expect(globalPermissionSpy).not.toHaveBeenCalled();
        expect(tenantPermissionSpy).not.toHaveBeenCalled();
        expect(teamIdsSpy).not.toHaveBeenCalled();
      },
    );

    test("a request with no delegation header at all, handed to this middleware anyway: 401", async () => {
      const req: ExpressRequest = buildRequest({});

      await authorize(req);

      const error: Exception = refusal();

      expect(error).toBeInstanceOf(NotAuthenticatedException);
      expectNoIdentity(req);
      expect(isUserBlockedSpy).not.toHaveBeenCalled();
    });

    test("a refusal never says why the token was no good", async () => {
      await authorize(buildRequest({ [HEADER]: "not-a-token" }));
      const garbageMessage: string = refusal().message;

      jest.clearAllMocks();

      await authorize(
        buildRequest({
          [HEADER]: mintToken({}, new Date(Date.now() - 2 * 60 * 1000)),
        }),
      );
      const expiredMessage: string = refusal().message;

      expect(expiredMessage).toBe(garbageMessage);
    });

    test("a session JWT in the delegation header is not a delegation token", async () => {
      /*
       * The reverse of the reason these are not JWTs: a credential of one
       * kind must not verify as the other, in either direction.
       */
      const jwtLike: string =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxIn0.c2lnbmF0dXJl";

      const req: ExpressRequest = buildRequest({ [HEADER]: jwtLike });

      await authorize(req);

      expect(refusal()).toBeInstanceOf(NotAuthenticatedException);
      expectNoIdentity(req);
    });

    test("a blocked member: 401 with the blocked message, and no permissions are loaded", async () => {
      isUserBlockedSpy.mockResolvedValue(true);

      const req: ExpressRequest = buildRequest({ [HEADER]: mintToken() });

      await authorize(req);

      const error: Exception = refusal();

      expect(error).toBeInstanceOf(NotAuthenticatedException);
      expect(error.message).toBe(ExceptionMessages.UserBlocked);
      expect(isUserBlockedSpy).toHaveBeenCalledTimes(1);
      expect((isUserBlockedSpy.mock.calls[0]![0] as ObjectID).toString()).toBe(
        USER_ID.toString(),
      );
      expect(globalPermissionSpy).not.toHaveBeenCalled();
      expect(tenantPermissionSpy).not.toHaveBeenCalled();
      expectNoIdentity(req);
    });

    test("a blocked-lookup that fails is an error, not a pass", async () => {
      const failure: Error = new Error("database unavailable");

      isUserBlockedSpy.mockRejectedValue(failure);

      const req: ExpressRequest = buildRequest({ [HEADER]: mintToken() });

      await authorize(req);

      expect(refusal()).toBe(failure);
      expectNoIdentity(req);
    });

    test("a member who has left the project (no tenant permission): 401, and next is never called", async () => {
      tenantPermissionSpy.mockResolvedValue(null);

      const req: ExpressRequest = buildRequest({ [HEADER]: mintToken() });

      await authorize(req);

      const error: Exception = refusal();

      expect(error).toBeInstanceOf(NotAuthenticatedException);
      expect(error.code).toBe(ExceptionCode.NotAuthenticatedException);
      expect(error.message).toContain("no longer a member");

      // No permission set is left on the request for a later handler to trust.
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

      expect(oneuptimeRequest.userTenantAccessPermission).toBeUndefined();
      expect(oneuptimeRequest.userGlobalAccessPermission).toBeUndefined();
      expect(oneuptimeRequest.userTeamIds).toBeUndefined();
    });

    test("a permission lookup that fails is an error, not a request with no permissions", async () => {
      const failure: Error = new Error("database unavailable");

      tenantPermissionSpy.mockRejectedValue(failure);

      await authorize(buildRequest({ [HEADER]: mintToken() }));

      expect(refusal()).toBe(failure);
    });
  });

  describe("authorize - what a valid token is worth", () => {
    const authorizeValid: (
      overrides?: Partial<McpDelegationClaims>,
      extraHeaders?: Record<string, string>,
      body?: Record<string, unknown>,
    ) => Promise<OneUptimeRequest> = async (
      overrides: Partial<McpDelegationClaims> = {},
      extraHeaders: Record<string, string> = {},
      body: Record<string, unknown> = {},
    ): Promise<OneUptimeRequest> => {
      const req: ExpressRequest = buildRequest(
        { [HEADER]: mintToken(overrides), ...extraHeaders },
        body,
      );

      await authorize(req);
      expectAccepted();

      return req as OneUptimeRequest;
    };

    test("the request is the member's: id, address and name come from the token", async () => {
      const req: OneUptimeRequest = await authorizeValid();

      expect(req.userAuthorization?.userId.toString()).toBe(USER_ID.toString());
      expect(req.userAuthorization?.email.toString()).toBe(
        "member@example.com",
      );
      expect(req.userAuthorization?.name).toBeInstanceOf(Name);
      expect(req.userAuthorization?.name?.toString()).toBe("Mia Member");
    });

    test("it is a User request and never a MasterAdmin one, whoever the member is", async () => {
      const req: OneUptimeRequest = await authorizeValid();

      /*
       * The token carries no master-admin claim and the middleware reads no
       * user row for one: an agent acting for an instance administrator gets
       * what that person's teams grant in the project.
       */
      expect(req.userType).toBe(UserType.User);
      expect(req.userType).not.toBe(UserType.MasterAdmin);
      expect(req.userAuthorization?.isMasterAdmin).toBe(false);
      expect(req.userAuthorization?.isGlobalLogin).toBe(false);
    });

    test("the tenant is the token's project", async () => {
      const req: OneUptimeRequest = await authorizeValid();

      expect(req.tenantId?.toString()).toBe(PROJECT_ID.toString());
    });

    const tenantOverrides: Array<[string, Record<string, string>]> = [
      ["a tenantid header", { tenantid: OTHER_PROJECT_ID.toString() }],
      ["a projectid header", { projectid: OTHER_PROJECT_ID.toString() }],
    ];

    test.each(tenantOverrides)(
      "%s naming another project is ignored: the project comes from the credential, never the caller",
      async (_label: string, headers: Record<string, string>) => {
        const req: OneUptimeRequest = await authorizeValid({}, headers);

        expect(req.tenantId?.toString()).toBe(PROJECT_ID.toString());
        expect(Object.keys(req.userTenantAccessPermission || {})).toEqual([
          PROJECT_ID.toString(),
        ]);
        expect(
          (tenantPermissionSpy.mock.calls[0]![1] as ObjectID).toString(),
        ).toBe(PROJECT_ID.toString());
      },
    );

    test("a projectId in the request body naming another project is ignored too", async () => {
      const req: OneUptimeRequest = await authorizeValid(
        {},
        {},
        { projectId: OTHER_PROJECT_ID.toString() },
      );

      expect(req.tenantId?.toString()).toBe(PROJECT_ID.toString());
    });

    test("records which grant and which client, for the audit trail", async () => {
      const req: OneUptimeRequest = await authorizeValid();

      expect(req.mcpOAuth?.grantId.toString()).toBe(GRANT_ID.toString());
      expect(req.mcpOAuth?.clientId).toBe(CLIENT_ID);
      expect(req.mcpOAuth?.clientName).toBe(CLIENT_NAME);
    });

    test("a grant that may write is not read-only", async () => {
      const req: OneUptimeRequest = await authorizeValid({ canWrite: true });

      expect(req.mcpOAuth?.isReadOnly).toBe(false);
    });

    test("a grant that may not write IS read-only", async () => {
      const req: OneUptimeRequest = await authorizeValid({ canWrite: false });

      expect(req.mcpOAuth?.isReadOnly).toBe(true);
    });

    test("it is not an API key request", async () => {
      const req: OneUptimeRequest = await authorizeValid();

      expect(req.apiKeyId).toBeUndefined();
      expect(req.apiKeyName).toBeUndefined();
    });

    test("strips the multi-tenant header, so nothing downstream can widen the request to every project", async () => {
      const req: OneUptimeRequest = await authorizeValid(
        {},
        { "is-multi-tenant-query": "true" },
      );

      expect(req.headers).not.toHaveProperty("is-multi-tenant-query");
    });

    test("the member's global permission is narrowed to the one project", async () => {
      const req: OneUptimeRequest = await authorizeValid();

      expect(
        req.userGlobalAccessPermission?.projectIds.map(
          (projectId: ObjectID): string => {
            return projectId.toString();
          },
        ),
      ).toEqual([PROJECT_ID.toString()]);

      // Everything else about it is the member's own.
      expect(req.userGlobalAccessPermission?.globalPermissions).toEqual([
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
      ]);
      expect(req.userGlobalAccessPermission?._type).toBe(
        "UserGlobalAccessPermission",
      );
    });

    test("narrowing copies: the cached permission object the service handed back still lists every project", async () => {
      await authorizeValid();

      expect(
        cachedGlobalPermission.projectIds.map((projectId: ObjectID): string => {
          return projectId.toString();
        }),
      ).toEqual([
        OTHER_PROJECT_ID.toString(),
        PROJECT_ID.toString(),
        THIRD_PROJECT_ID.toString(),
      ]);
    });

    test("carries the member's LIVE permissions in that project, keyed by the project", async () => {
      const req: OneUptimeRequest = await authorizeValid();

      expect(req.userTenantAccessPermission).toEqual({
        [PROJECT_ID.toString()]: cachedTenantPermission,
      });

      // Read for this member, in the token's project, on this request.
      expect(tenantPermissionSpy).toHaveBeenCalledTimes(1);
      expect(
        (tenantPermissionSpy.mock.calls[0]![0] as ObjectID).toString(),
      ).toBe(USER_ID.toString());
      expect(
        (tenantPermissionSpy.mock.calls[0]![1] as ObjectID).toString(),
      ).toBe(PROJECT_ID.toString());
    });

    test("the token grants no permission of its own: a member with fewer permissions gets fewer", async () => {
      const viewerOnly: UserTenantAccessPermission = {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [],
      };

      tenantPermissionSpy.mockResolvedValue(viewerOnly);

      const req: OneUptimeRequest = await authorizeValid({ canWrite: true });

      expect(
        req.userTenantAccessPermission?.[PROJECT_ID.toString()]?.permissions,
      ).toEqual([]);
    });

    test("carries the member's teams in that project, for owned-scope permissions", async () => {
      const req: OneUptimeRequest = await authorizeValid();

      expect(req.userTeamIds).toEqual([TEAM_ID]);
      expect((teamIdsSpy.mock.calls[0]![0] as ObjectID).toString()).toBe(
        USER_ID.toString(),
      );
      expect((teamIdsSpy.mock.calls[0]![1] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
    });

    test("the tenant lookup reuses the global permission already being fetched", async () => {
      await authorizeValid();

      expect(globalPermissionSpy).toHaveBeenCalledTimes(1);

      const options: {
        userGlobalAccessPermission?: unknown;
      } = tenantPermissionSpy.mock.calls[0]![2] as {
        userGlobalAccessPermission?: unknown;
      };

      await expect(options.userGlobalAccessPermission).resolves.toBe(
        cachedGlobalPermission,
      );
    });

    test("a member with no global permission cached still gets through on their tenant permission", async () => {
      globalPermissionSpy.mockResolvedValue(null);

      const req: OneUptimeRequest = await authorizeValid();

      expect(req.userGlobalAccessPermission).toBeUndefined();
      expect(req.userTenantAccessPermission).toEqual({
        [PROJECT_ID.toString()]: cachedTenantPermission,
      });
    });

    test("is asked whether the member is blocked on every request", async () => {
      await authorizeValid();
      jest.clearAllMocks();
      next = jest.fn();
      await authorizeValid();

      expect(isUserBlockedSpy).toHaveBeenCalledTimes(1);
    });

    test("marks the project and the member as active, as a session request does", async () => {
      await authorizeValid();

      expect(
        (projectLastActiveSpy.mock.calls[0]![0] as ObjectID).toString(),
      ).toBe(PROJECT_ID.toString());
      expect((userLastActiveSpy.mock.calls[0]![0] as ObjectID).toString()).toBe(
        USER_ID.toString(),
      );
    });

    test("a token for another project authorizes THAT project, and only it", async () => {
      const req: OneUptimeRequest = await authorizeValid({
        projectId: THIRD_PROJECT_ID,
      });

      expect(req.tenantId?.toString()).toBe(THIRD_PROJECT_ID.toString());
      expect(
        req.userGlobalAccessPermission?.projectIds.map(
          (projectId: ObjectID): string => {
            return projectId.toString();
          },
        ),
      ).toEqual([THIRD_PROJECT_ID.toString()]);
      expect(Object.keys(req.userTenantAccessPermission || {})).toEqual([
        THIRD_PROJECT_ID.toString(),
      ]);
    });

    test("a member with no name still gets a Name on the request", async () => {
      const req: OneUptimeRequest = await authorizeValid({ userName: "" });

      expect(req.userAuthorization?.name).toBeInstanceOf(Name);
      expect(req.userAuthorization?.name?.toString()).toBe("");
    });
  });
});
