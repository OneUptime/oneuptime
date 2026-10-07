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
jest.mock("../../../../Server/Utils/PasswordHash", () => {
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

jest.mock("../../../../Server/Utils/Logger");

import McpOAuthGrant from "../../../../Models/DatabaseModels/McpOAuthGrant";
import User from "../../../../Models/DatabaseModels/User";
import UserMiddleware from "../../../../Server/Middleware/UserAuthorization";
import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import { McpOAuthGrantSsoEvidence } from "../../../../Server/Services/McpOAuthGrantService";
import ProjectService from "../../../../Server/Services/ProjectService";
import UserService from "../../../../Server/Services/UserService";
import McpOAuthConfig from "../../../../Server/Utils/Mcp/McpOAuthConfig";
import ProjectMembership from "../../../../Server/Utils/TeamMember/ProjectMembership";
import McpOAuthGrantAccess, {
  McpOAuthGrantAccessResult,
  McpOAuthGrantRefusal,
  McpOAuthGrantUser,
  McpOAuthPrincipal,
} from "../../../../Server/Utils/Mcp/McpOAuthGrantAccess";
import Email from "../../../../Types/Email";
import BadDataException from "../../../../Types/Exception/BadDataException";
import JSONWebTokenData from "../../../../Types/JsonWebTokenData";
import McpOAuthScope from "../../../../Types/Mcp/McpOAuthScope";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import SsoProviderType from "../../../../Types/SSO/SsoProviderType";
import { getJestSpyOn } from "../../../Spy";

/*
 * "May this grant be used right now, and as whom?" - asked on every MCP
 * request a connected client makes and every token it exchanges.
 *
 * A grant is a standing permission, and everything it rests on can change
 * while it stands without the grant row changing at all: the instance can
 * switch OAuth off, the member can be blocked or leave the project, an
 * administrator can block their team from connecting clients, the project can
 * start requiring SSO, the sign-in the grant was approved under can lapse.
 * Each of those is one refusal, and each is pinned here from both sides: the
 * condition refuses, and the SAME grant with only that condition corrected is
 * allowed. An implementation that refused everything would fail this file.
 *
 * Only the lookups that reach Postgres are stubbed; the SSO rules run for
 * real (McpOAuthSso), so what is tested is the wiring of a grant's columns
 * into them.
 */

type SpyInstance = ReturnType<typeof getJestSpyOn>;

const GRANT_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const PROVIDER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const OTHER_PROVIDER_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const LABEL_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");

const NOW: Date = new Date("2026-10-01T12:00:00.000Z");
const ONE_HOUR_MS: number = 60 * 60 * 1000;
const ONE_DAY_MS: number = 24 * ONE_HOUR_MS;
const USER_CACHE_TTL_MS: number = 60 * 1000;

const CLIENT_ID: string = "https://claude.ai/oauth/mcp-client-metadata";

type GrantFields = {
  id: ObjectID | undefined;
  projectId: ObjectID | undefined;
  userId: ObjectID | undefined;
  clientId: string | undefined;
  name: string | undefined;
  scope: string | undefined;
  resource: string | undefined;
  activatedAt: Date | undefined;
  expiresAt: Date | undefined;
  ssoProviderType: SsoProviderType | undefined;
  ssoProviderId: ObjectID | undefined;
  ssoExpiresAt: Date | undefined;
  createdAt: Date | undefined;
};

/*
 * A grant in good standing: activated an hour ago, good for another day, for
 * this instance's MCP endpoint. Overrides replace a field; an override of
 * `undefined` removes it, which is how "the column is NULL" is expressed.
 */
const grantWith: (overrides?: Partial<GrantFields>) => McpOAuthGrant = (
  overrides: Partial<GrantFields> = {},
): McpOAuthGrant => {
  const fields: GrantFields = {
    id: GRANT_ID,
    projectId: PROJECT_ID,
    userId: USER_ID,
    clientId: CLIENT_ID,
    name: "Claude",
    scope: "mcp:read mcp:write",
    resource: McpOAuthConfig.getResource(),
    activatedAt: new Date(NOW.getTime() - ONE_HOUR_MS),
    expiresAt: new Date(NOW.getTime() + ONE_DAY_MS),
    ssoProviderType: undefined,
    ssoProviderId: undefined,
    ssoExpiresAt: undefined,
    createdAt: undefined,
    ...overrides,
  };

  const grant: McpOAuthGrant = new McpOAuthGrant();

  if (fields.id) {
    grant._id = fields.id.toString();
  }

  if (fields.projectId) {
    grant.projectId = fields.projectId;
  }

  if (fields.userId) {
    grant.userId = fields.userId;
  }

  if (fields.clientId !== undefined) {
    grant.clientId = fields.clientId;
  }

  if (fields.name !== undefined) {
    grant.name = fields.name;
  }

  if (fields.scope !== undefined) {
    grant.scope = fields.scope;
  }

  if (fields.resource !== undefined) {
    grant.resource = fields.resource;
  }

  if (fields.activatedAt) {
    grant.activatedAt = fields.activatedAt;
  }

  if (fields.expiresAt) {
    grant.expiresAt = fields.expiresAt;
  }

  if (fields.ssoProviderType) {
    grant.ssoProviderType = fields.ssoProviderType;
  }

  if (fields.ssoProviderId) {
    grant.ssoProviderId = fields.ssoProviderId;
  }

  if (fields.ssoExpiresAt) {
    grant.ssoExpiresAt = fields.ssoExpiresAt;
  }

  if (fields.createdAt) {
    grant.createdAt = fields.createdAt;
  }

  return grant;
};

const userRow: (overrides?: {
  email?: string | undefined;
  name?: string | undefined;
  isMasterAdmin?: boolean;
}) => User = (
  overrides: {
    email?: string | undefined;
    name?: string | undefined;
    isMasterAdmin?: boolean;
  } = {},
): User => {
  const user: User = new User();

  user._id = USER_ID.toString();

  const email: string | undefined =
    "email" in overrides ? overrides.email : "member@example.com";
  const name: string | undefined =
    "name" in overrides ? overrides.name : "Mia Member";

  if (email) {
    user.email = new Email(email);
  }

  if (name) {
    user.name = new Name(name);
  }

  user.isMasterAdmin = overrides.isMasterAdmin === true;

  return user;
};

const permissionRow: (
  permission: Permission,
  overrides?: { isBlockPermission?: boolean; labelIds?: Array<ObjectID> },
) => UserPermission = (
  permission: Permission,
  overrides: { isBlockPermission?: boolean; labelIds?: Array<ObjectID> } = {},
): UserPermission => {
  return {
    _type: "UserPermission",
    permission,
    labelIds: overrides.labelIds || [],
    ...(overrides.isBlockPermission !== undefined
      ? { isBlockPermission: overrides.isBlockPermission }
      : {}),
  };
};

const tenantPermission: (
  permissions?: Array<UserPermission>,
) => UserTenantAccessPermission = (
  permissions: Array<UserPermission> = [
    permissionRow(Permission.ProjectMember),
  ],
): UserTenantAccessPermission => {
  return {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions,
  };
};

const refusalOf: (
  result: McpOAuthGrantAccessResult,
) => McpOAuthGrantRefusal | null = (
  result: McpOAuthGrantAccessResult,
): McpOAuthGrantRefusal | null => {
  return result.isAllowed ? null : result.refusal;
};

const principalOf: (result: McpOAuthGrantAccessResult) => McpOAuthPrincipal = (
  result: McpOAuthGrantAccessResult,
): McpOAuthPrincipal => {
  if (!result.isAllowed) {
    throw new Error(`Expected the grant to be allowed, got ${result.refusal}`);
  }

  return result.principal;
};

describe("McpOAuthGrantAccess", () => {
  let isEnabled: SpyInstance;
  let findUser: SpyInstance;
  let isUserBlocked: SpyInstance;
  let membershipLookup: SpyInstance;
  let tenantPermissionLookup: SpyInstance;
  let projectRequireSso: SpyInstance;
  let projectRequiredProvider: SpyInstance;
  let globalRequireSso: SpyInstance;
  let globalTokenAuthorized: SpyInstance;
  let projectProviderAuthorized: SpyInstance;

  beforeEach(() => {
    McpOAuthGrantAccess.clearCache();

    isEnabled = getJestSpyOn(McpOAuthConfig, "isEnabled").mockReturnValue(true);
    findUser = getJestSpyOn(UserService, "findOneById").mockResolvedValue(
      userRow(),
    );
    isUserBlocked = getJestSpyOn(
      UserService,
      "isUserBlocked",
    ).mockResolvedValue(false);
    membershipLookup = getJestSpyOn(
      ProjectMembership,
      "isMember",
    ).mockResolvedValue(true);
    tenantPermissionLookup = getJestSpyOn(
      AccessTokenService,
      "getUserTenantAccessPermission",
    ).mockResolvedValue(tenantPermission());
    projectRequireSso = getJestSpyOn(
      ProjectService,
      "getRequireSsoForLogin",
    ).mockResolvedValue(false);
    projectRequiredProvider = getJestSpyOn(
      ProjectService,
      "getRequireSsoWithSsoProviderId",
    ).mockResolvedValue(null);
    globalRequireSso = getJestSpyOn(
      GlobalConfigService,
      "getRequireSsoForLogin",
    ).mockResolvedValue(false);
    globalTokenAuthorized = getJestSpyOn(
      UserMiddleware,
      "isGlobalSsoTokenAuthorizedForProject",
    ).mockResolvedValue(true);
    /*
     * Whether the project's own provider still vouches for the sign-in the
     * grant copied. Default: yes. The tests about it narrow the answer;
     * McpOAuthSso.test runs it for real.
     */
    projectProviderAuthorized = getJestSpyOn(
      UserMiddleware,
      "isProjectScopedSsoSignInAuthorizedForProject",
    ).mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    McpOAuthGrantAccess.clearCache();
  });

  const evaluate: (
    grant: McpOAuthGrant,
    options?: { requireActivated?: boolean; now?: Date },
  ) => Promise<McpOAuthGrantAccessResult> = async (
    grant: McpOAuthGrant,
    options: { requireActivated?: boolean; now?: Date } = {},
  ): Promise<McpOAuthGrantAccessResult> => {
    return await McpOAuthGrantAccess.evaluate({
      grant,
      ...("requireActivated" in options
        ? { requireActivated: options.requireActivated }
        : {}),
      now: options.now || NOW,
    });
  };

  const expectNothingLookedUp: () => void = (): void => {
    expect(findUser).not.toHaveBeenCalled();
    expect(isUserBlocked).not.toHaveBeenCalled();
    expect(membershipLookup).not.toHaveBeenCalled();
    expect(tenantPermissionLookup).not.toHaveBeenCalled();
    expect(projectRequireSso).not.toHaveBeenCalled();
  };

  describe("evaluate - a grant in good standing", () => {
    test("is allowed", async () => {
      const result: McpOAuthGrantAccessResult = await evaluate(grantWith());

      expect(result.isAllowed).toBe(true);
    });

    test("the principal is the grant itself, the member it was made by, and the scopes it carries", async () => {
      const grant: McpOAuthGrant = grantWith();
      const principal: McpOAuthPrincipal = principalOf(await evaluate(grant));

      expect(principal.grant).toBe(grant);
      expect(principal.user.id.toString()).toBe(USER_ID.toString());
      expect(principal.user.email).toBeInstanceOf(Email);
      expect(principal.user.email.toString()).toBe("member@example.com");
      expect(principal.user.name).toBe("Mia Member");
      expect(principal.user.isMasterAdmin).toBe(false);
      expect(principal.scopes).toEqual([
        McpOAuthScope.Read,
        McpOAuthScope.Write,
      ]);
    });

    const scopeCases: Array<[string | undefined, Array<McpOAuthScope>]> = [
      ["mcp:read", [McpOAuthScope.Read]],
      ["mcp:read mcp:write", [McpOAuthScope.Read, McpOAuthScope.Write]],
      [
        "mcp:read mcp:write offline_access",
        [McpOAuthScope.Read, McpOAuthScope.Write, McpOAuthScope.OfflineAccess],
      ],
      // Whatever order the column holds, the principal's is canonical.
      [
        "offline_access mcp:read",
        [McpOAuthScope.Read, McpOAuthScope.OfflineAccess],
      ],
      // A scope this version does not issue grants nothing.
      ["mcp:read mcp:admin", [McpOAuthScope.Read]],
      [undefined, []],
      ["", []],
    ];

    test.each(scopeCases)(
      "a grant whose scope column is %p carries %p",
      async (scope: string | undefined, expected: Array<McpOAuthScope>) => {
        const principal: McpOAuthPrincipal = principalOf(
          await evaluate(grantWith({ scope })),
        );

        expect(principal.scopes).toEqual(expected);
      },
    );

    test("a read-only grant never yields write", async () => {
      const principal: McpOAuthPrincipal = principalOf(
        await evaluate(grantWith({ scope: "mcp:read offline_access" })),
      );

      expect(principal.scopes).not.toContain(McpOAuthScope.Write);
    });

    test("the member is looked up by the grant's user, and their standing by the grant's user and project", async () => {
      await evaluate(grantWith());

      expect(
        (findUser.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
      ).toBe(USER_ID.toString());
      expect((isUserBlocked.mock.calls[0]![0] as ObjectID).toString()).toBe(
        USER_ID.toString(),
      );
      expect(
        (tenantPermissionLookup.mock.calls[0]![0] as ObjectID).toString(),
      ).toBe(USER_ID.toString());
      expect(
        (tenantPermissionLookup.mock.calls[0]![1] as ObjectID).toString(),
      ).toBe(PROJECT_ID.toString());
    });

    test("a master admin's grant says so on the principal (it decides the instance-wide SSO exemption, nothing else)", async () => {
      findUser.mockResolvedValue(userRow({ isMasterAdmin: true }));

      const principal: McpOAuthPrincipal = principalOf(
        await evaluate(grantWith()),
      );

      expect(principal.user.isMasterAdmin).toBe(true);
    });

    test("a member with no name is still a principal, with an empty name", async () => {
      findUser.mockResolvedValue(userRow({ name: undefined }));

      const principal: McpOAuthPrincipal = principalOf(
        await evaluate(grantWith()),
      );

      expect(principal.user.name).toBe("");
    });

    test("needs no ALLOW row for AuthorizeMcpClient: every project member may connect a client", async () => {
      tenantPermissionLookup.mockResolvedValue(
        tenantPermission([permissionRow(Permission.ProjectMember)]),
      );

      expect((await evaluate(grantWith())).isAllowed).toBe(true);
    });

    test("a member with no permission rows at all is still a member", async () => {
      tenantPermissionLookup.mockResolvedValue(tenantPermission([]));

      expect((await evaluate(grantWith())).isAllowed).toBe(true);
    });
  });

  describe("evaluate - the refusals, in the order they are checked", () => {
    test("each condition refuses in turn, and correcting it reveals the next", async () => {
      // Everything that can be wrong, is.
      isEnabled.mockReturnValue(false);
      findUser.mockResolvedValue(null);
      isUserBlocked.mockResolvedValue(true);
      tenantPermissionLookup.mockResolvedValue(null);
      projectRequireSso.mockResolvedValue(true);

      const fields: Partial<GrantFields> = {
        activatedAt: undefined,
        expiresAt: new Date(NOW.getTime() - 1),
        resource: "https://somewhere-else.example.com/mcp",
      };

      const next: () => Promise<McpOAuthGrantRefusal | null> =
        async (): Promise<McpOAuthGrantRefusal | null> => {
          McpOAuthGrantAccess.clearCache();
          return refusalOf(await evaluate(grantWith(fields)));
        };

      expect(await next()).toBe(McpOAuthGrantRefusal.OAuthDisabled);

      isEnabled.mockReturnValue(true);
      expect(await next()).toBe(McpOAuthGrantRefusal.NotActivated);

      fields.activatedAt = new Date(NOW.getTime() - ONE_HOUR_MS);
      expect(await next()).toBe(McpOAuthGrantRefusal.Expired);

      fields.expiresAt = new Date(NOW.getTime() + ONE_DAY_MS);
      expect(await next()).toBe(McpOAuthGrantRefusal.WrongResource);

      fields.resource = McpOAuthConfig.getResource();
      expect(await next()).toBe(McpOAuthGrantRefusal.UserUnavailable);

      // The account exists, but is blocked: still unavailable.
      findUser.mockResolvedValue(userRow());
      expect(await next()).toBe(McpOAuthGrantRefusal.UserUnavailable);

      isUserBlocked.mockResolvedValue(false);
      expect(await next()).toBe(McpOAuthGrantRefusal.NotAProjectMember);

      tenantPermissionLookup.mockResolvedValue(
        tenantPermission([
          permissionRow(Permission.ProjectMember),
          permissionRow(Permission.AuthorizeMcpClient, {
            isBlockPermission: true,
          }),
        ]),
      );
      expect(await next()).toBe(McpOAuthGrantRefusal.BlockedByPermission);

      tenantPermissionLookup.mockResolvedValue(tenantPermission());
      expect(await next()).toBe(McpOAuthGrantRefusal.SsoRequired);

      fields.ssoProviderType = SsoProviderType.ProjectSSO;
      fields.ssoProviderId = PROVIDER_ID;
      fields.ssoExpiresAt = new Date(NOW.getTime() + ONE_DAY_MS);
      expect(await next()).toBeNull();
    });

    describe("OAuth switched off for the instance", () => {
      test("refuses a grant that is otherwise perfect", async () => {
        isEnabled.mockReturnValue(false);

        expect(refusalOf(await evaluate(grantWith()))).toBe(
          McpOAuthGrantRefusal.OAuthDisabled,
        );
      });

      test("refuses before anything is looked up", async () => {
        isEnabled.mockReturnValue(false);

        await evaluate(grantWith());

        expectNothingLookedUp();
      });

      test("the same grant works again when it is switched back on - nothing was deleted", async () => {
        const grant: McpOAuthGrant = grantWith();

        isEnabled.mockReturnValue(false);
        expect((await evaluate(grant)).isAllowed).toBe(false);

        isEnabled.mockReturnValue(true);
        expect((await evaluate(grant)).isAllowed).toBe(true);
      });
    });

    describe("a grant missing who or where it is for", () => {
      const missing: Array<[string, Partial<GrantFields>]> = [
        ["no id", { id: undefined }],
        ["no user", { userId: undefined }],
        ["no project", { projectId: undefined }],
      ];

      test.each(missing)(
        "%s: refused, and nothing is looked up",
        async (_label: string, overrides: Partial<GrantFields>) => {
          expect(refusalOf(await evaluate(grantWith(overrides)))).toBe(
            McpOAuthGrantRefusal.NotActivated,
          );
          expectNothingLookedUp();
        },
      );

      test.each(missing)(
        "%s: refused even for the code exchange, which accepts a pending grant",
        async (_label: string, overrides: Partial<GrantFields>) => {
          expect(
            refusalOf(
              await evaluate(grantWith(overrides), { requireActivated: false }),
            ),
          ).toBe(McpOAuthGrantRefusal.NotActivated);
        },
      );
    });

    describe("a grant the client never collected (pending)", () => {
      const pending: () => McpOAuthGrant = (): McpOAuthGrant => {
        return grantWith({ activatedAt: undefined });
      };

      test("is refused by default", async () => {
        expect(refusalOf(await evaluate(pending()))).toBe(
          McpOAuthGrantRefusal.NotActivated,
        );
        expectNothingLookedUp();
      });

      test("is refused when requireActivated is explicitly true", async () => {
        expect(
          refusalOf(await evaluate(pending(), { requireActivated: true })),
        ).toBe(McpOAuthGrantRefusal.NotActivated);
      });

      test("is accepted ONLY when the caller says requireActivated: false - the code exchange that activates it", async () => {
        expect(
          (await evaluate(pending(), { requireActivated: false })).isAllowed,
        ).toBe(true);
      });

      test("requireActivated: false waives nothing else", async () => {
        isUserBlocked.mockResolvedValue(true);

        expect(
          refusalOf(await evaluate(pending(), { requireActivated: false })),
        ).toBe(McpOAuthGrantRefusal.UserUnavailable);
      });

      test("a pending grant that has also expired is reported as expired to the code exchange", async () => {
        const grant: McpOAuthGrant = grantWith({
          activatedAt: undefined,
          expiresAt: new Date(NOW.getTime() - 1),
        });

        expect(
          refusalOf(await evaluate(grant, { requireActivated: false })),
        ).toBe(McpOAuthGrantRefusal.Expired);
      });
    });

    describe("expiry", () => {
      test("a grant is expired AT its expiry instant", async () => {
        expect(
          refusalOf(
            await evaluate(grantWith({ expiresAt: new Date(NOW.getTime()) })),
          ),
        ).toBe(McpOAuthGrantRefusal.Expired);
      });

      test("a grant is good until the millisecond before", async () => {
        expect(
          (
            await evaluate(
              grantWith({ expiresAt: new Date(NOW.getTime() + 1) }),
            )
          ).isAllowed,
        ).toBe(true);
      });

      test("a grant past its expiry is expired", async () => {
        expect(
          refusalOf(
            await evaluate(
              grantWith({ expiresAt: new Date(NOW.getTime() - ONE_DAY_MS) }),
            ),
          ),
        ).toBe(McpOAuthGrantRefusal.Expired);
      });

      test("a grant with NO expiry is expired - never 'good for ever'", async () => {
        expect(
          refusalOf(await evaluate(grantWith({ expiresAt: undefined }))),
        ).toBe(McpOAuthGrantRefusal.Expired);
      });

      test("an expiry that came back from the database as a string is read as a date", async () => {
        const grant: McpOAuthGrant = grantWith();

        (grant as unknown as { expiresAt: string }).expiresAt = new Date(
          NOW.getTime() - 1,
        ).toISOString();

        expect(refusalOf(await evaluate(grant))).toBe(
          McpOAuthGrantRefusal.Expired,
        );
      });

      test("is refused before anything is looked up", async () => {
        await evaluate(grantWith({ expiresAt: new Date(NOW.getTime() - 1) }));

        expectNothingLookedUp();
      });

      test("`now` is honoured: the same grant is good a moment before its expiry and expired at it", async () => {
        const expiresAt: Date = new Date(NOW.getTime() + 30 * ONE_DAY_MS);
        const grant: McpOAuthGrant = grantWith({ expiresAt });

        expect(
          (await evaluate(grant, { now: new Date(expiresAt.getTime() - 1) }))
            .isAllowed,
        ).toBe(true);
        expect(refusalOf(await evaluate(grant, { now: expiresAt }))).toBe(
          McpOAuthGrantRefusal.Expired,
        );
      });

      test("without `now`, it is measured against the current time", async () => {
        const live: McpOAuthGrantAccessResult =
          await McpOAuthGrantAccess.evaluate({
            grant: grantWith({ expiresAt: new Date(Date.now() + ONE_HOUR_MS) }),
          });
        const dead: McpOAuthGrantAccessResult =
          await McpOAuthGrantAccess.evaluate({
            grant: grantWith({ expiresAt: new Date(Date.now() - ONE_HOUR_MS) }),
          });

        expect(live.isAllowed).toBe(true);
        expect(refusalOf(dead)).toBe(McpOAuthGrantRefusal.Expired);
      });
    });

    describe("a grant made out to a different MCP endpoint", () => {
      const wrongResources: Array<[string, string | undefined]> = [
        ["another host", "https://somewhere-else.example.com/mcp"],
        ["another path on this host", `${McpOAuthConfig.getOrigin()}/api`],
        ["this host with no path", McpOAuthConfig.getOrigin()],
        ["no resource at all", undefined],
        ["an empty resource", ""],
        ["something that is not a URL", "mcp"],
        [
          "the right endpoint with a query",
          `${McpOAuthConfig.getResource()}?x=1`,
        ],
      ];

      test.each(wrongResources)(
        "%s: refused, before the member is looked up",
        async (_label: string, resource: string | undefined) => {
          expect(refusalOf(await evaluate(grantWith({ resource })))).toBe(
            McpOAuthGrantRefusal.WrongResource,
          );
          expectNothingLookedUp();
        },
      );

      test("the configured endpoint is accepted", async () => {
        expect(
          (
            await evaluate(
              grantWith({ resource: McpOAuthConfig.getResource() }),
            )
          ).isAllowed,
        ).toBe(true);
      });

      test("a trailing slash is the same endpoint", async () => {
        expect(
          (
            await evaluate(
              grantWith({ resource: `${McpOAuthConfig.getResource()}/` }),
            )
          ).isAllowed,
        ).toBe(true);
      });
    });

    describe("the member's account", () => {
      test("an account that no longer exists refuses the grant", async () => {
        findUser.mockResolvedValue(null);

        expect(refusalOf(await evaluate(grantWith()))).toBe(
          McpOAuthGrantRefusal.UserUnavailable,
        );
      });

      test("for a missing account nothing further is looked up", async () => {
        findUser.mockResolvedValue(null);

        await evaluate(grantWith());

        expect(isUserBlocked).not.toHaveBeenCalled();
        expect(tenantPermissionLookup).not.toHaveBeenCalled();
      });

      test("an account with no email address cannot be a principal", async () => {
        findUser.mockResolvedValue(userRow({ email: undefined }));

        expect(refusalOf(await evaluate(grantWith()))).toBe(
          McpOAuthGrantRefusal.UserUnavailable,
        );
      });

      test("a blocked account refuses the grant", async () => {
        isUserBlocked.mockResolvedValue(true);

        expect(refusalOf(await evaluate(grantWith()))).toBe(
          McpOAuthGrantRefusal.UserUnavailable,
        );
      });

      test("for a blocked account the project is not consulted", async () => {
        isUserBlocked.mockResolvedValue(true);

        await evaluate(grantWith());

        expect(tenantPermissionLookup).not.toHaveBeenCalled();
        expect(projectRequireSso).not.toHaveBeenCalled();
      });

      test("the same grant works again once the account is unblocked", async () => {
        const grant: McpOAuthGrant = grantWith();

        isUserBlocked.mockResolvedValue(true);
        expect((await evaluate(grant)).isAllowed).toBe(false);

        isUserBlocked.mockResolvedValue(false);
        expect((await evaluate(grant)).isAllowed).toBe(true);
      });

      test("a blocked-lookup that fails is an error, not a pass and not a refusal", async () => {
        isUserBlocked.mockRejectedValue(new Error("database unavailable"));

        await expect(evaluate(grantWith())).rejects.toThrow(
          "database unavailable",
        );
      });
    });

    describe("the member's standing in the project", () => {
      test("a member who has left the project is refused", async () => {
        tenantPermissionLookup.mockResolvedValue(null);

        expect(refusalOf(await evaluate(grantWith()))).toBe(
          McpOAuthGrantRefusal.NotAProjectMember,
        );
      });

      test("somebody who has left is refused even while a cached permission set still lists the project", async () => {
        // The database says they have left; a cached set says otherwise.
        membershipLookup.mockResolvedValue(false);
        tenantPermissionLookup.mockResolvedValue(
          tenantPermission([permissionRow(Permission.ProjectOwner)]),
        );

        expect(refusalOf(await evaluate(grantWith()))).toBe(
          McpOAuthGrantRefusal.NotAProjectMember,
        );

        // Refused before the permission set is consulted, or SSO.
        expect(tenantPermissionLookup).not.toHaveBeenCalled();
        expect(projectRequireSso).not.toHaveBeenCalled();
      });

      test("membership is read from the database on every use, for the grant's own person and project", async () => {
        const grant: McpOAuthGrant = grantWith();

        await evaluate(grant);
        await evaluate(grant);
        await evaluate(grant);

        expect(membershipLookup).toHaveBeenCalledTimes(3);

        for (const call of membershipLookup.mock.calls) {
          expect(call[0]).toEqual({ projectId: PROJECT_ID, userId: USER_ID });
        }
      });

      test("a grant of one project is refused for somebody who left it, whatever their other projects", async () => {
        membershipLookup.mockImplementation(
          async (data: { projectId: ObjectID }): Promise<boolean> => {
            // A member of another project only.
            return data.projectId.toString() !== PROJECT_ID.toString();
          },
        );

        expect(refusalOf(await evaluate(grantWith()))).toBe(
          McpOAuthGrantRefusal.NotAProjectMember,
        );
      });

      test("a database membership read that fails is an error, never a pass", async () => {
        membershipLookup.mockRejectedValue(new Error("database unavailable"));

        await expect(evaluate(grantWith())).rejects.toThrow(
          "database unavailable",
        );
      });

      test("the same grant works again once they are a member again", async () => {
        const grant: McpOAuthGrant = grantWith();

        membershipLookup.mockResolvedValue(false);
        expect((await evaluate(grant)).isAllowed).toBe(false);

        membershipLookup.mockResolvedValue(true);
        expect((await evaluate(grant)).isAllowed).toBe(true);
      });

      test("the consent screen asks the same: a project they have left cannot be chosen", async () => {
        membershipLookup.mockResolvedValue(false);
        tenantPermissionLookup.mockResolvedValue(tenantPermission());

        await expect(
          McpOAuthGrantAccess.getProjectRefusal({
            userId: USER_ID,
            projectId: PROJECT_ID,
          }),
        ).resolves.toBe(McpOAuthGrantRefusal.NotAProjectMember);

        membershipLookup.mockResolvedValue(true);

        await expect(
          McpOAuthGrantAccess.getProjectRefusal({
            userId: USER_ID,
            projectId: PROJECT_ID,
          }),
        ).resolves.toBeNull();
      });

      test("for a non-member the SSO rules are not consulted", async () => {
        tenantPermissionLookup.mockResolvedValue(null);

        await evaluate(grantWith());

        expect(projectRequireSso).not.toHaveBeenCalled();
      });

      test("a BLOCK row for Authorize MCP Client on any of the member's teams refuses the grant", async () => {
        tenantPermissionLookup.mockResolvedValue(
          tenantPermission([
            permissionRow(Permission.ProjectMember),
            permissionRow(Permission.AuthorizeMcpClient, {
              isBlockPermission: true,
            }),
          ]),
        );

        expect(refusalOf(await evaluate(grantWith()))).toBe(
          McpOAuthGrantRefusal.BlockedByPermission,
        );
      });

      test("the block wins over the highest role: an owner whose team is blocked is still blocked", async () => {
        tenantPermissionLookup.mockResolvedValue(
          tenantPermission([
            permissionRow(Permission.ProjectOwner),
            permissionRow(Permission.AuthorizeMcpClient, {
              isBlockPermission: true,
            }),
          ]),
        );

        expect(refusalOf(await evaluate(grantWith()))).toBe(
          McpOAuthGrantRefusal.BlockedByPermission,
        );
      });

      test("the block wins over an ALLOW row for the same permission", async () => {
        tenantPermissionLookup.mockResolvedValue(
          tenantPermission([
            permissionRow(Permission.AuthorizeMcpClient, {
              isBlockPermission: false,
            }),
            permissionRow(Permission.AuthorizeMcpClient, {
              isBlockPermission: true,
            }),
          ]),
        );

        expect(refusalOf(await evaluate(grantWith()))).toBe(
          McpOAuthGrantRefusal.BlockedByPermission,
        );
      });

      test("labels on the block row are ignored: a grant has no labels for them to select", async () => {
        tenantPermissionLookup.mockResolvedValue(
          tenantPermission([
            permissionRow(Permission.AuthorizeMcpClient, {
              isBlockPermission: true,
              labelIds: [LABEL_ID],
            }),
          ]),
        );

        expect(refusalOf(await evaluate(grantWith()))).toBe(
          McpOAuthGrantRefusal.BlockedByPermission,
        );
      });

      test("an ALLOW row for Authorize MCP Client does not refuse", async () => {
        tenantPermissionLookup.mockResolvedValue(
          tenantPermission([
            permissionRow(Permission.AuthorizeMcpClient, {
              isBlockPermission: false,
            }),
          ]),
        );

        expect((await evaluate(grantWith())).isAllowed).toBe(true);
      });

      const otherBlocks: Array<Permission> = [
        Permission.ReadMcpClientAuthorization,
        Permission.DeleteMcpClientAuthorization,
        Permission.CreateProjectApiKey,
        Permission.ReadProjectIncident,
      ];

      test.each(otherBlocks)(
        "a BLOCK row for %s - some OTHER permission - does not refuse",
        async (permission: Permission) => {
          tenantPermissionLookup.mockResolvedValue(
            tenantPermission([
              permissionRow(Permission.ProjectMember),
              permissionRow(permission, { isBlockPermission: true }),
            ]),
          );

          expect((await evaluate(grantWith())).isAllowed).toBe(true);
        },
      );

      test("the same grant works again once the block is removed", async () => {
        const grant: McpOAuthGrant = grantWith();

        tenantPermissionLookup.mockResolvedValue(
          tenantPermission([
            permissionRow(Permission.AuthorizeMcpClient, {
              isBlockPermission: true,
            }),
          ]),
        );
        expect((await evaluate(grant)).isAllowed).toBe(false);

        tenantPermissionLookup.mockResolvedValue(tenantPermission());
        expect((await evaluate(grant)).isAllowed).toBe(true);
      });

      test("membership is read on every use, never remembered", async () => {
        const grant: McpOAuthGrant = grantWith();

        await evaluate(grant);
        await evaluate(grant);
        await evaluate(grant);

        expect(tenantPermissionLookup).toHaveBeenCalledTimes(3);
      });

      test("a membership lookup that fails is an error", async () => {
        tenantPermissionLookup.mockRejectedValue(
          new Error("database unavailable"),
        );

        await expect(evaluate(grantWith())).rejects.toThrow(
          "database unavailable",
        );
      });
    });

    describe("single sign-on", () => {
      const goodEvidence: Partial<GrantFields> = {
        ssoProviderType: SsoProviderType.ProjectSSO,
        ssoProviderId: PROVIDER_ID,
        ssoExpiresAt: new Date(NOW.getTime() + ONE_DAY_MS),
      };

      test("a project that does not require SSO asks for no evidence", async () => {
        expect((await evaluate(grantWith())).isAllowed).toBe(true);
      });

      test("a project that requires SSO refuses a grant with no evidence", async () => {
        projectRequireSso.mockResolvedValue(true);

        expect(refusalOf(await evaluate(grantWith()))).toBe(
          McpOAuthGrantRefusal.SsoRequired,
        );
      });

      test("a project that STARTS requiring SSO refuses grants made before it did", async () => {
        const grant: McpOAuthGrant = grantWith();

        expect((await evaluate(grant)).isAllowed).toBe(true);

        projectRequireSso.mockResolvedValue(true);

        expect(refusalOf(await evaluate(grant))).toBe(
          McpOAuthGrantRefusal.SsoRequired,
        );
      });

      test("a grant with current evidence is allowed", async () => {
        projectRequireSso.mockResolvedValue(true);

        expect((await evaluate(grantWith(goodEvidence))).isAllowed).toBe(true);
      });

      test("a grant whose SSO sign-in has lapsed is refused, though the grant itself has not expired", async () => {
        projectRequireSso.mockResolvedValue(true);

        const grant: McpOAuthGrant = grantWith({
          ...goodEvidence,
          ssoExpiresAt: new Date(NOW.getTime() - 1),
          expiresAt: new Date(NOW.getTime() + 30 * ONE_DAY_MS),
        });

        expect(refusalOf(await evaluate(grant))).toBe(
          McpOAuthGrantRefusal.SsoRequired,
        );
      });

      test("the SSO evidence lapses at ITS expiry: good a moment before, refused at it", async () => {
        projectRequireSso.mockResolvedValue(true);

        const ssoExpiresAt: Date = new Date(NOW.getTime() + ONE_HOUR_MS);
        const grant: McpOAuthGrant = grantWith({
          ...goodEvidence,
          ssoExpiresAt,
        });

        expect(
          (await evaluate(grant, { now: new Date(ssoExpiresAt.getTime() - 1) }))
            .isAllowed,
        ).toBe(true);
        expect(refusalOf(await evaluate(grant, { now: ssoExpiresAt }))).toBe(
          McpOAuthGrantRefusal.SsoRequired,
        );
      });

      test("evidence with a provider type but no expiry is no evidence", async () => {
        projectRequireSso.mockResolvedValue(true);

        expect(
          refusalOf(
            await evaluate(
              grantWith({ ...goodEvidence, ssoExpiresAt: undefined }),
            ),
          ),
        ).toBe(McpOAuthGrantRefusal.SsoRequired);
      });

      test("evidence with an expiry but no provider type is no evidence", async () => {
        projectRequireSso.mockResolvedValue(true);

        expect(
          refusalOf(
            await evaluate(
              grantWith({ ...goodEvidence, ssoProviderType: undefined }),
            ),
          ),
        ).toBe(McpOAuthGrantRefusal.SsoRequired);
      });

      test("a project pinned to one provider refuses evidence from another", async () => {
        projectRequireSso.mockResolvedValue(true);
        projectRequiredProvider.mockResolvedValue(OTHER_PROVIDER_ID);

        expect(refusalOf(await evaluate(grantWith(goodEvidence)))).toBe(
          McpOAuthGrantRefusal.SsoRequired,
        );

        projectRequiredProvider.mockResolvedValue(PROVIDER_ID);

        expect((await evaluate(grantWith(goodEvidence))).isAllowed).toBe(true);
      });

      test("the instance-wide requirement applies to an ordinary member", async () => {
        globalRequireSso.mockResolvedValue(true);

        expect(refusalOf(await evaluate(grantWith()))).toBe(
          McpOAuthGrantRefusal.SsoRequired,
        );
        expect((await evaluate(grantWith(goodEvidence))).isAllowed).toBe(true);
      });

      test("a master admin is exempt from the INSTANCE-wide requirement", async () => {
        globalRequireSso.mockResolvedValue(true);
        findUser.mockResolvedValue(userRow({ isMasterAdmin: true }));

        expect((await evaluate(grantWith())).isAllowed).toBe(true);
      });

      test("a master admin is NOT exempt from a project's own requirement", async () => {
        projectRequireSso.mockResolvedValue(true);
        findUser.mockResolvedValue(userRow({ isMasterAdmin: true }));

        expect(refusalOf(await evaluate(grantWith()))).toBe(
          McpOAuthGrantRefusal.SsoRequired,
        );
      });

      test("the SSO rules are read for the grant's project", async () => {
        projectRequireSso.mockResolvedValue(true);

        await evaluate(grantWith(goodEvidence));

        expect(
          (projectRequireSso.mock.calls[0]![0] as ObjectID).toString(),
        ).toBe(PROJECT_ID.toString());
      });

      describe("evidence from the project's own provider", () => {
        const capturedAt: Date = new Date(NOW.getTime() - 3 * ONE_HOUR_MS);

        beforeEach(() => {
          projectRequireSso.mockResolvedValue(true);
        });

        test("is re-checked against the provider today, with the grant's creation as the latest its sign-in was given", async () => {
          expect(
            (
              await evaluate(
                grantWith({ ...goodEvidence, createdAt: capturedAt }),
              )
            ).isAllowed,
          ).toBe(true);

          expect(projectProviderAuthorized).toHaveBeenCalledTimes(1);

          const asked: {
            ssoProviderType: SsoProviderType;
            ssoProviderId: ObjectID | null;
            issuedAtMs: number | null;
            projectId: ObjectID;
          } = projectProviderAuthorized.mock.calls[0]![0] as {
            ssoProviderType: SsoProviderType;
            ssoProviderId: ObjectID | null;
            issuedAtMs: number | null;
            projectId: ObjectID;
          };

          expect(asked.ssoProviderType).toBe(SsoProviderType.ProjectSSO);
          expect(asked.ssoProviderId?.toString()).toBe(PROVIDER_ID.toString());
          expect(asked.issuedAtMs).toBe(capturedAt.getTime());
          expect(asked.projectId.toString()).toBe(PROJECT_ID.toString());
          // A project's provider is never asked about as a Global one.
          expect(globalTokenAuthorized).not.toHaveBeenCalled();
        });

        test("is refused once the provider is turned off or deleted, though the grant and its sign-in have not expired", async () => {
          projectProviderAuthorized.mockResolvedValue(false);

          expect(
            refusalOf(
              await evaluate(
                grantWith({ ...goodEvidence, createdAt: capturedAt }),
              ),
            ),
          ).toBe(McpOAuthGrantRefusal.SsoRequired);
        });

        test("a grant read without its creation date is asked about with no date: it counts only for a provider never turned off", async () => {
          await evaluate(grantWith(goodEvidence));

          expect(
            (
              projectProviderAuthorized.mock.calls[0]![0] as {
                issuedAtMs: number | null;
              }
            ).issuedAtMs,
          ).toBeNull();
        });

        test("'could not find out' is an error - never a refusal, never a pass", async () => {
          projectProviderAuthorized.mockRejectedValue(
            new Error("database unavailable"),
          );

          await expect(evaluate(grantWith(goodEvidence))).rejects.toThrow(
            "database unavailable",
          );
        });

        test("is not looked up at all when the project does not require SSO", async () => {
          projectRequireSso.mockResolvedValue(false);

          await evaluate(grantWith(goodEvidence));

          expect(projectProviderAuthorized).not.toHaveBeenCalled();
        });

        test("a project pinned to another provider is refused before the provider is asked", async () => {
          projectRequiredProvider.mockResolvedValue(OTHER_PROVIDER_ID);

          expect(refusalOf(await evaluate(grantWith(goodEvidence)))).toBe(
            McpOAuthGrantRefusal.SsoRequired,
          );
          expect(projectProviderAuthorized).not.toHaveBeenCalled();
        });
      });

      describe("evidence from an instance-wide (Global) provider", () => {
        const globalEvidence: Partial<GrantFields> = {
          ssoProviderType: SsoProviderType.GlobalOIDC,
          ssoProviderId: PROVIDER_ID,
          ssoExpiresAt: new Date(NOW.getTime() + ONE_DAY_MS),
        };

        beforeEach(() => {
          projectRequireSso.mockResolvedValue(true);
        });

        test("is re-checked against the provider's standing today, for this project", async () => {
          expect((await evaluate(grantWith(globalEvidence))).isAllowed).toBe(
            true,
          );

          const asked: {
            globalSsoTokenData: JSONWebTokenData;
            projectId: ObjectID;
          } = globalTokenAuthorized.mock.calls[0]![0] as {
            globalSsoTokenData: JSONWebTokenData;
            projectId: ObjectID;
          };

          expect(asked.projectId.toString()).toBe(PROJECT_ID.toString());
          expect(asked.globalSsoTokenData.ssoProviderType).toBe(
            SsoProviderType.GlobalOIDC,
          );
          expect(asked.globalSsoTokenData.ssoProviderId?.toString()).toBe(
            PROVIDER_ID.toString(),
          );
        });

        test("is refused once the provider is disabled or stops governing the project", async () => {
          globalTokenAuthorized.mockResolvedValue(false);

          expect(refusalOf(await evaluate(grantWith(globalEvidence)))).toBe(
            McpOAuthGrantRefusal.SsoRequired,
          );
        });

        test("'could not find out' is an error - never a refusal, never a pass", async () => {
          globalTokenAuthorized.mockRejectedValue(
            new Error("database unavailable"),
          );

          await expect(evaluate(grantWith(globalEvidence))).rejects.toThrow(
            "database unavailable",
          );
        });

        test("is not looked up at all when the project does not require SSO", async () => {
          projectRequireSso.mockResolvedValue(false);

          await evaluate(grantWith(globalEvidence));

          expect(globalTokenAuthorized).not.toHaveBeenCalled();
        });
      });

      test("a project that no longer exists is an error, as it is for a browser request", async () => {
        projectRequireSso.mockRejectedValue(
          new BadDataException("Project not found"),
        );

        await expect(evaluate(grantWith())).rejects.toThrow(
          "Project not found",
        );
      });
    });
  });

  describe("getProjectRefusal", () => {
    const refusal: () => Promise<McpOAuthGrantRefusal | null> =
      async (): Promise<McpOAuthGrantRefusal | null> => {
        return await McpOAuthGrantAccess.getProjectRefusal({
          userId: USER_ID,
          projectId: PROJECT_ID,
        });
      };

    test("a member with no block may connect a client", async () => {
      await expect(refusal()).resolves.toBeNull();
    });

    test("is asked for this user in this project", async () => {
      await refusal();

      expect(tenantPermissionLookup).toHaveBeenCalledTimes(1);
      expect(
        (tenantPermissionLookup.mock.calls[0]![0] as ObjectID).toString(),
      ).toBe(USER_ID.toString());
      expect(
        (tenantPermissionLookup.mock.calls[0]![1] as ObjectID).toString(),
      ).toBe(PROJECT_ID.toString());
    });

    test("somebody who is not a member may not", async () => {
      tenantPermissionLookup.mockResolvedValue(null);

      await expect(refusal()).resolves.toBe(
        McpOAuthGrantRefusal.NotAProjectMember,
      );
    });

    test("a member whose team blocks Authorize MCP Client may not", async () => {
      tenantPermissionLookup.mockResolvedValue(
        tenantPermission([
          permissionRow(Permission.AuthorizeMcpClient, {
            isBlockPermission: true,
          }),
        ]),
      );

      await expect(refusal()).resolves.toBe(
        McpOAuthGrantRefusal.BlockedByPermission,
      );
    });

    test("a permission set with no `permissions` list at all is a member with no block", async () => {
      tenantPermissionLookup.mockResolvedValue({
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
      } as unknown as UserTenantAccessPermission);

      await expect(refusal()).resolves.toBeNull();
    });

    test("only these two reasons exist here: the plan and SSO are the consent screen's to decide", async () => {
      projectRequireSso.mockResolvedValue(true);
      globalRequireSso.mockResolvedValue(true);

      await expect(refusal()).resolves.toBeNull();
      expect(projectRequireSso).not.toHaveBeenCalled();
    });
  });

  describe("getSsoEvidence", () => {
    test("a grant with no SSO columns has no evidence", () => {
      expect(McpOAuthGrantAccess.getSsoEvidence(grantWith())).toBeNull();
    });

    test("a provider type without an expiry is no evidence", () => {
      expect(
        McpOAuthGrantAccess.getSsoEvidence(
          grantWith({ ssoProviderType: SsoProviderType.ProjectSSO }),
        ),
      ).toBeNull();
    });

    test("an expiry without a provider type is no evidence", () => {
      expect(
        McpOAuthGrantAccess.getSsoEvidence(
          grantWith({ ssoExpiresAt: new Date(NOW.getTime() + ONE_DAY_MS) }),
        ),
      ).toBeNull();
    });

    test("type, provider and expiry are read off the grant", () => {
      const ssoExpiresAt: Date = new Date(NOW.getTime() + ONE_DAY_MS);

      const evidence: McpOAuthGrantSsoEvidence | null =
        McpOAuthGrantAccess.getSsoEvidence(
          grantWith({
            ssoProviderType: SsoProviderType.GlobalSSO,
            ssoProviderId: PROVIDER_ID,
            ssoExpiresAt,
          }),
        );

      expect(evidence).toEqual({
        ssoProviderType: SsoProviderType.GlobalSSO,
        ssoProviderId: PROVIDER_ID,
        expiresAt: ssoExpiresAt,
      });
    });

    test("the grant's creation is when its sign-in was captured", () => {
      const createdAt: Date = new Date(NOW.getTime() - ONE_DAY_MS);

      const evidence: McpOAuthGrantSsoEvidence | null =
        McpOAuthGrantAccess.getSsoEvidence(
          grantWith({
            ssoProviderType: SsoProviderType.ProjectOIDC,
            ssoProviderId: PROVIDER_ID,
            ssoExpiresAt: new Date(NOW.getTime() + ONE_DAY_MS),
            createdAt: createdAt,
          }),
        );

      expect(evidence!.capturedAt).toBeInstanceOf(Date);
      expect(evidence!.capturedAt!.getTime()).toBe(createdAt.getTime());
    });

    test("no provider id on the grant is a null provider, not a missing key", () => {
      const evidence: McpOAuthGrantSsoEvidence | null =
        McpOAuthGrantAccess.getSsoEvidence(
          grantWith({
            ssoProviderType: SsoProviderType.ProjectSSO,
            ssoExpiresAt: new Date(NOW.getTime() + ONE_DAY_MS),
          }),
        );

      expect(evidence).not.toBeNull();
      expect(evidence!.ssoProviderId).toBeNull();
    });

    test("an expiry that came back from the database as a string becomes a Date", () => {
      const ssoExpiresAt: Date = new Date(NOW.getTime() + ONE_DAY_MS);
      const grant: McpOAuthGrant = grantWith({
        ssoProviderType: SsoProviderType.ProjectSSO,
      });

      (grant as unknown as { ssoExpiresAt: string }).ssoExpiresAt =
        ssoExpiresAt.toISOString();

      const evidence: McpOAuthGrantSsoEvidence | null =
        McpOAuthGrantAccess.getSsoEvidence(grant);

      expect(evidence!.expiresAt).toBeInstanceOf(Date);
      expect(evidence!.expiresAt.getTime()).toBe(ssoExpiresAt.getTime());
    });
  });

  describe("getUser and its cache", () => {
    let nowSpy: ReturnType<typeof jest.spyOn>;
    let currentTime: number;

    beforeEach(() => {
      currentTime = 1_800_000_000_000;
      nowSpy = jest.spyOn(Date, "now").mockImplementation((): number => {
        return currentTime;
      });
    });

    afterEach(() => {
      nowSpy.mockRestore();
    });

    test("reads only what labels the request, as root", async () => {
      await McpOAuthGrantAccess.getUser(USER_ID);

      const call: {
        id: ObjectID;
        select: Record<string, unknown>;
        props: Record<string, unknown>;
      } = findUser.mock.calls[0]![0] as {
        id: ObjectID;
        select: Record<string, unknown>;
        props: Record<string, unknown>;
      };

      expect(call.id.toString()).toBe(USER_ID.toString());
      expect(call.select).toEqual({
        _id: true,
        email: true,
        name: true,
        isMasterAdmin: true,
      });
      expect(call.props).toEqual({ isRoot: true });
    });

    test("returns who the id is", async () => {
      const user: McpOAuthGrantUser | null =
        await McpOAuthGrantAccess.getUser(USER_ID);

      expect(user?.id.toString()).toBe(USER_ID.toString());
      expect(user?.email.toString()).toBe("member@example.com");
      expect(user?.name).toBe("Mia Member");
      expect(user?.isMasterAdmin).toBe(false);
    });

    test("one database read per user per minute, however many requests", async () => {
      for (let index: number = 0; index < 25; index++) {
        await McpOAuthGrantAccess.getUser(USER_ID);
      }

      expect(findUser).toHaveBeenCalledTimes(1);
    });

    test("the cached answer is the same answer", async () => {
      const first: McpOAuthGrantUser | null =
        await McpOAuthGrantAccess.getUser(USER_ID);

      findUser.mockResolvedValue(userRow({ name: "Renamed Member" }));

      const second: McpOAuthGrantUser | null =
        await McpOAuthGrantAccess.getUser(USER_ID);

      expect(second).toEqual(first);
      expect(second?.email).toBeInstanceOf(Email);
    });

    test("is read again once the minute is up, and a rename is then picked up", async () => {
      await McpOAuthGrantAccess.getUser(USER_ID);

      findUser.mockResolvedValue(userRow({ name: "Renamed Member" }));

      currentTime += USER_CACHE_TTL_MS;
      expect((await McpOAuthGrantAccess.getUser(USER_ID))?.name).toBe(
        "Mia Member",
      );
      expect(findUser).toHaveBeenCalledTimes(1);

      currentTime += 1;
      expect((await McpOAuthGrantAccess.getUser(USER_ID))?.name).toBe(
        "Renamed Member",
      );
      expect(findUser).toHaveBeenCalledTimes(2);
    });

    test("users are cached apart", async () => {
      await McpOAuthGrantAccess.getUser(USER_ID);
      await McpOAuthGrantAccess.getUser(OTHER_USER_ID);
      await McpOAuthGrantAccess.getUser(USER_ID);

      expect(findUser).toHaveBeenCalledTimes(2);
    });

    test("'no such account' is cached too: a stream of requests for a deleted user costs one read", async () => {
      findUser.mockResolvedValue(null);

      await expect(McpOAuthGrantAccess.getUser(USER_ID)).resolves.toBeNull();
      await expect(McpOAuthGrantAccess.getUser(USER_ID)).resolves.toBeNull();
      await expect(McpOAuthGrantAccess.getUser(USER_ID)).resolves.toBeNull();

      expect(findUser).toHaveBeenCalledTimes(1);
    });

    test("clearCache forgets everything", async () => {
      await McpOAuthGrantAccess.getUser(USER_ID);

      McpOAuthGrantAccess.clearCache();
      findUser.mockResolvedValue(userRow({ name: "Renamed Member" }));

      expect((await McpOAuthGrantAccess.getUser(USER_ID))?.name).toBe(
        "Renamed Member",
      );
      expect(findUser).toHaveBeenCalledTimes(2);
    });

    test("a failed read is not cached: the next request tries again", async () => {
      findUser.mockRejectedValueOnce(new Error("database unavailable"));

      await expect(McpOAuthGrantAccess.getUser(USER_ID)).rejects.toThrow(
        "database unavailable",
      );
      await expect(
        McpOAuthGrantAccess.getUser(USER_ID),
      ).resolves.not.toBeNull();

      expect(findUser).toHaveBeenCalledTimes(2);
    });

    test("evaluate uses the cache: many requests under one grant cost one user read", async () => {
      const grant: McpOAuthGrant = grantWith();

      for (let index: number = 0; index < 10; index++) {
        expect((await evaluate(grant)).isAllowed).toBe(true);
      }

      expect(findUser).toHaveBeenCalledTimes(1);
    });

    test("being BLOCKED is never served from that cache: it is asked on every use, and takes effect on the next one", async () => {
      const grant: McpOAuthGrant = grantWith();

      // Warm the user cache with an allowed request.
      expect((await evaluate(grant)).isAllowed).toBe(true);

      // The member is blocked. No time passes; the user cache is still warm.
      isUserBlocked.mockResolvedValue(true);

      expect(refusalOf(await evaluate(grant))).toBe(
        McpOAuthGrantRefusal.UserUnavailable,
      );

      expect(findUser).toHaveBeenCalledTimes(1);
      expect(isUserBlocked).toHaveBeenCalledTimes(2);
    });

    test("leaving the project is not served from the cache either", async () => {
      const grant: McpOAuthGrant = grantWith();

      expect((await evaluate(grant)).isAllowed).toBe(true);

      tenantPermissionLookup.mockResolvedValue(null);

      expect(refusalOf(await evaluate(grant))).toBe(
        McpOAuthGrantRefusal.NotAProjectMember,
      );
      expect(findUser).toHaveBeenCalledTimes(1);
    });
  });
});
