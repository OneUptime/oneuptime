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

import User from "../../../../Models/DatabaseModels/User";
import { EncryptionSecret } from "../../../../Server/EnvironmentConfig";
import UserMiddleware from "../../../../Server/Middleware/UserAuthorization";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import GlobalOidcProjectService from "../../../../Server/Services/GlobalOidcProjectService";
import GlobalOidcService from "../../../../Server/Services/GlobalOidcService";
import GlobalSsoProjectService from "../../../../Server/Services/GlobalSsoProjectService";
import GlobalSsoService from "../../../../Server/Services/GlobalSsoService";
import { McpOAuthGrantSsoEvidence } from "../../../../Server/Services/McpOAuthGrantService";
import ProjectOidcService from "../../../../Server/Services/ProjectOidcService";
import ProjectService from "../../../../Server/Services/ProjectService";
import ProjectSsoService from "../../../../Server/Services/ProjectSsoService";
import CookieUtil from "../../../../Server/Utils/Cookie";
import { ExpressRequest } from "../../../../Server/Utils/Express";
import JSONWebToken from "../../../../Server/Utils/JsonWebToken";
import McpOAuthSso, {
  McpOAuthSsoRequirement,
} from "../../../../Server/Utils/Mcp/McpOAuthSso";
import {
  PROVIDER_NOT_FOUND,
  ProjectSsoProviderStandingValue,
} from "../../../../Server/Utils/ProjectSsoProviderStanding";
import Email from "../../../../Types/Email";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import JSONWebTokenData from "../../../../Types/JsonWebTokenData";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import SsoProviderType from "../../../../Types/SSO/SsoProviderType";
import { getJestSpyOn } from "../../../Spy";
import jwt from "jsonwebtoken";

/*
 * Single sign-on for MCP clients that signed in with OAuth.
 *
 * A browser proves SSO on every request, with a cookie. An MCP client has no
 * cookies, so the proof is copied onto the grant when a member approves the
 * client (captureEvidence) and every later use of the grant is held to that
 * copy (isEvidenceSatisfied). Three things have to be true for that to be the
 * same rule a browser is held to, and they are what this suite pins:
 *
 *   1. WHETHER SSO is required is read exactly as UserMiddleware reads it -
 *      the project's switch, else the instance's, from which master admins
 *      are exempt (and from nothing else).
 *   2. WHAT COUNTS as proof is decided by UserMiddleware itself. This file
 *      only reads the provider and the expiry off the token that satisfied it.
 *      So the tokens here are REAL (minted through CookieUtil, verified for
 *      real) and UserMiddleware's stateless checks run unmocked.
 *   3. A copy never outlives the original: it expires when the token would
 *      have, and the provider that gave it - the project's own or a Global
 *      one - is re-checked against the database on every use: a provider
 *      turned off or deleted since vouches for nobody, and "could not find
 *      out" is an error, never a refusal and never a pass.
 */

type SpyInstance = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
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

const THIRTY_DAYS_MS: number = 30 * 24 * 60 * 60 * 1000;
const ONE_HOUR_MS: number = 60 * 60 * 1000;
const GLOBAL_SSO_TOKEN_HEADER: string = "x-global-sso-token";

const NOW: Date = new Date("2026-10-01T12:00:00.000Z");

// A project's own provider that is on and was never turned off.
const PROVIDER_ON: ProjectSsoProviderStandingValue = {
  isOn: true,
  signInsEndedAtMs: null,
};

const buildUser: (userId: ObjectID) => User = (userId: ObjectID): User => {
  const user: User = new User();
  user.id = userId;
  user.name = new Name("Sso User");
  user.email = new Email("sso-user@example.com");
  return user;
};

// A real per-project `sso-<projectId>` token, exactly as an SSO login mints it.
const mintProjectToken: (data?: {
  userId?: ObjectID;
  projectId?: ObjectID;
  providerId?: ObjectID | undefined;
  providerType?: SsoProviderType | undefined;
}) => string = (
  data: {
    userId?: ObjectID;
    projectId?: ObjectID;
    providerId?: ObjectID | undefined;
    providerType?: SsoProviderType | undefined;
  } = {},
): string => {
  return CookieUtil.getSSOToken({
    user: buildUser(data.userId || USER_ID),
    projectId: data.projectId || PROJECT_ID,
    ssoProviderId: "providerId" in data ? data.providerId : PROVIDER_ID,
    ssoProviderType:
      "providerType" in data ? data.providerType : SsoProviderType.ProjectSSO,
  });
};

// A real Global SSO/OIDC token, exactly as a global login mints it.
const mintGlobalToken: (data?: {
  userId?: ObjectID;
  providerId?: ObjectID;
  providerType?: SsoProviderType;
}) => string = (
  data: {
    userId?: ObjectID;
    providerId?: ObjectID;
    providerType?: SsoProviderType;
  } = {},
): string => {
  return CookieUtil.getGlobalSSOToken({
    user: buildUser(data.userId || USER_ID),
    ssoProviderId: data.providerId || PROVIDER_ID,
    ssoProviderType: data.providerType || SsoProviderType.GlobalSSO,
  });
};

/*
 * A token signed with the real secret but a payload no login would mint: the
 * shapes captureEvidence has to refuse, or read defensively.
 */
const mintCustomToken: (
  payload: JSONObject,
  options?: { withoutExpiry?: boolean },
) => string = (
  payload: JSONObject,
  options: { withoutExpiry?: boolean } = {},
): string => {
  if (options.withoutExpiry) {
    return jwt.sign(payload, EncryptionSecret.toString());
  }

  return JSONWebToken.signJsonPayload(payload, 30 * 24 * 60 * 60);
};

const projectTokenPayload: (overrides?: JSONObject) => JSONObject = (
  overrides: JSONObject = {},
): JSONObject => {
  return {
    userId: USER_ID.toString(),
    projectId: PROJECT_ID.toString(),
    name: "Sso User",
    email: "sso-user@example.com",
    isMasterAdmin: false,
    ssoProviderId: PROVIDER_ID.toString(),
    ssoProviderType: SsoProviderType.ProjectSSO,
    ...overrides,
  };
};

// When a token says it expires, read independently of the code under test.
const expiryOf: (token: string) => Date = (token: string): Date => {
  const payload: { exp?: number } = jwt.decode(token) as { exp?: number };

  return new Date(payload.exp! * 1000);
};

interface RequestParts {
  projectTokens?: Array<{ projectId: ObjectID; token: string }>;
  globalCookieToken?: string;
  headers?: Record<string, string>;
}

const buildRequest: (parts?: RequestParts) => ExpressRequest = (
  parts: RequestParts = {},
): ExpressRequest => {
  const cookies: Record<string, string> = {};

  for (const entry of parts.projectTokens || []) {
    cookies[CookieUtil.getUserSSOKey(entry.projectId)] = entry.token;
  }

  if (parts.globalCookieToken) {
    cookies[CookieUtil.getGlobalSSOKey()] = parts.globalCookieToken;
  }

  return {
    cookies,
    headers: parts.headers || {},
  } as unknown as ExpressRequest;
};

const requestWithProjectToken: (token: string) => ExpressRequest = (
  token: string,
): ExpressRequest => {
  return buildRequest({ projectTokens: [{ projectId: PROJECT_ID, token }] });
};

describe("McpOAuthSso", () => {
  let projectRequireSso: SpyInstance;
  let projectRequiredProvider: SpyInstance;
  let globalRequireSso: SpyInstance;
  let globalTokenAuthorized: SpyInstance;
  let projectSsoStanding: SpyInstance;
  let projectOidcStanding: SpyInstance;

  beforeEach(() => {
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

    /*
     * The one stateful question (is this Global provider still trusted, and
     * does it govern this project). Default: yes. The tests that are about
     * it narrow the answer; a few run it for real against stubbed services.
     */
    globalTokenAuthorized = getJestSpyOn(
      UserMiddleware,
      "isGlobalSsoTokenAuthorizedForProject",
    ).mockResolvedValue(true);

    /*
     * The other stateful question: whether a project's own provider still
     * vouches for a sign-in it gave (there, the project's, on, and turned
     * off no later than the sign-in). Default: on, never turned off. The
     * real check (UserMiddleware.isProjectScopedSsoSignInAuthorizedForProject)
     * runs against these two database reads.
     */
    projectSsoStanding = getJestSpyOn(
      ProjectSsoService,
      "getSignInStanding",
    ).mockResolvedValue(PROVIDER_ON);
    projectOidcStanding = getJestSpyOn(
      ProjectOidcService,
      "getSignInStanding",
    ).mockResolvedValue(PROVIDER_ON);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe("getRequirement", () => {
    /*
     * [project requires SSO, instance requires SSO, member is a master admin]
     * -> is SSO required of this member in this project.
     */
    const matrix: Array<[boolean, boolean, boolean, boolean]> = [
      [false, false, false, false],
      [false, false, true, false],
      [false, true, false, true],
      // Exempt from the INSTANCE switch: a broken global IdP cannot lock them out.
      [false, true, true, false],
      [true, false, false, true],
      // ...and from nothing else: the project's own switch still applies.
      [true, false, true, true],
      [true, true, false, true],
      [true, true, true, true],
    ];

    test.each(matrix)(
      "project=%s, instance=%s, master admin=%s -> required=%s",
      async (
        projectRequires: boolean,
        instanceRequires: boolean,
        isMasterAdmin: boolean,
        expected: boolean,
      ) => {
        projectRequireSso.mockResolvedValue(projectRequires);
        globalRequireSso.mockResolvedValue(instanceRequires);

        const requirement: McpOAuthSsoRequirement =
          await McpOAuthSso.getRequirement({
            projectId: PROJECT_ID,
            isMasterAdmin,
          });

        expect(requirement.isRequired).toBe(expected);
      },
    );

    test("asks about the project it was given", async () => {
      await McpOAuthSso.getRequirement({
        projectId: PROJECT_ID,
        isMasterAdmin: false,
      });

      expect(projectRequireSso).toHaveBeenCalledTimes(1);
      expect((projectRequireSso.mock.calls[0]![0] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
    });

    test("a project that requires SSO does not need the instance switch read at all", async () => {
      projectRequireSso.mockResolvedValue(true);

      await McpOAuthSso.getRequirement({
        projectId: PROJECT_ID,
        isMasterAdmin: false,
      });

      expect(globalRequireSso).not.toHaveBeenCalled();
    });

    test("for a master admin the instance switch is not even read", async () => {
      globalRequireSso.mockResolvedValue(true);

      const requirement: McpOAuthSsoRequirement =
        await McpOAuthSso.getRequirement({
          projectId: PROJECT_ID,
          isMasterAdmin: true,
        });

      expect(requirement).toEqual({
        isRequired: false,
        requiredSsoProviderId: null,
      });
      expect(globalRequireSso).not.toHaveBeenCalled();
    });

    test("nothing required: no provider is looked up, and none is reported", async () => {
      projectRequiredProvider.mockResolvedValue(PROVIDER_ID);

      const requirement: McpOAuthSsoRequirement =
        await McpOAuthSso.getRequirement({
          projectId: PROJECT_ID,
          isMasterAdmin: false,
        });

      expect(requirement).toEqual({
        isRequired: false,
        requiredSsoProviderId: null,
      });
      expect(projectRequiredProvider).not.toHaveBeenCalled();
    });

    test("required, any provider: the required provider is null", async () => {
      projectRequireSso.mockResolvedValue(true);

      const requirement: McpOAuthSsoRequirement =
        await McpOAuthSso.getRequirement({
          projectId: PROJECT_ID,
          isMasterAdmin: false,
        });

      expect(requirement).toEqual({
        isRequired: true,
        requiredSsoProviderId: null,
      });
    });

    test("required, one specific provider: its id is passed through", async () => {
      projectRequireSso.mockResolvedValue(true);
      projectRequiredProvider.mockResolvedValue(PROVIDER_ID);

      const requirement: McpOAuthSsoRequirement =
        await McpOAuthSso.getRequirement({
          projectId: PROJECT_ID,
          isMasterAdmin: false,
        });

      expect(requirement.isRequired).toBe(true);
      expect(requirement.requiredSsoProviderId?.toString()).toBe(
        PROVIDER_ID.toString(),
      );
      expect(
        (projectRequiredProvider.mock.calls[0]![0] as ObjectID).toString(),
      ).toBe(PROJECT_ID.toString());
    });

    test("required by the INSTANCE: the project's pinned provider still applies", async () => {
      globalRequireSso.mockResolvedValue(true);
      projectRequiredProvider.mockResolvedValue(PROVIDER_ID);

      const requirement: McpOAuthSsoRequirement =
        await McpOAuthSso.getRequirement({
          projectId: PROJECT_ID,
          isMasterAdmin: false,
        });

      expect(requirement.isRequired).toBe(true);
      expect(requirement.requiredSsoProviderId?.toString()).toBe(
        PROVIDER_ID.toString(),
      );
    });

    test("the provider lookup failing reads as 'any provider' - still required, never 'not required'", async () => {
      projectRequireSso.mockResolvedValue(true);
      projectRequiredProvider.mockRejectedValue(new Error("cache unavailable"));

      await expect(
        McpOAuthSso.getRequirement({
          projectId: PROJECT_ID,
          isMasterAdmin: false,
        }),
      ).resolves.toEqual({ isRequired: true, requiredSsoProviderId: null });
    });

    test("the instance switch failing to read is 'not set', as it is for a browser request", async () => {
      globalRequireSso.mockRejectedValue(new Error("database unavailable"));

      await expect(
        McpOAuthSso.getRequirement({
          projectId: PROJECT_ID,
          isMasterAdmin: false,
        }),
      ).resolves.toEqual({ isRequired: false, requiredSsoProviderId: null });
    });

    test("a project that does not exist throws: it is never 'no SSO required'", async () => {
      projectRequireSso.mockRejectedValue(
        new BadDataException("Project not found"),
      );

      await expect(
        McpOAuthSso.getRequirement({
          projectId: PROJECT_ID,
          isMasterAdmin: false,
        }),
      ).rejects.toThrow("Project not found");

      // A master admin is not exempt from a project being unknown either.
      await expect(
        McpOAuthSso.getRequirement({
          projectId: PROJECT_ID,
          isMasterAdmin: true,
        }),
      ).rejects.toThrow("Project not found");
    });

    test("any other failure reading the project's switch throws too", async () => {
      projectRequireSso.mockRejectedValue(new Error("database unavailable"));

      await expect(
        McpOAuthSso.getRequirement({
          projectId: PROJECT_ID,
          isMasterAdmin: false,
        }),
      ).rejects.toThrow("database unavailable");
    });
  });

  describe("captureEvidence", () => {
    const capture: (
      req: ExpressRequest,
      overrides?: {
        projectId?: ObjectID;
        userId?: ObjectID;
        requiredSsoProviderId?: ObjectID | null;
      },
    ) => Promise<McpOAuthGrantSsoEvidence | null> = async (
      req: ExpressRequest,
      overrides: {
        projectId?: ObjectID;
        userId?: ObjectID;
        requiredSsoProviderId?: ObjectID | null;
      } = {},
    ): Promise<McpOAuthGrantSsoEvidence | null> => {
      return await McpOAuthSso.captureEvidence({
        req,
        projectId: overrides.projectId || PROJECT_ID,
        userId: overrides.userId || USER_ID,
        requiredSsoProviderId: overrides.requiredSsoProviderId ?? null,
      });
    };

    describe("a project's own SSO sign-in", () => {
      test("is recorded with its provider type, its provider and the token's own expiry", async () => {
        const token: string = mintProjectToken();

        const evidence: McpOAuthGrantSsoEvidence | null = await capture(
          requestWithProjectToken(token),
        );

        expect(evidence).not.toBeNull();
        expect(evidence!.ssoProviderType).toBe(SsoProviderType.ProjectSSO);
        expect(evidence!.ssoProviderId?.toString()).toBe(
          PROVIDER_ID.toString(),
        );
        expect(evidence!.expiresAt.getTime()).toBe(expiryOf(token).getTime());
      });

      test("the expiry recorded is the token's - thirty days out - not 'now' and not for ever", async () => {
        const before: number = Date.now();

        const evidence: McpOAuthGrantSsoEvidence | null = await capture(
          requestWithProjectToken(mintProjectToken()),
        );

        // JWT expiries are whole seconds: allow one either side.
        expect(evidence!.expiresAt.getTime()).toBeGreaterThanOrEqual(
          before + THIRTY_DAYS_MS - 1000,
        );
        expect(evidence!.expiresAt.getTime()).toBeLessThanOrEqual(
          Date.now() + THIRTY_DAYS_MS + 1000,
        );
      });

      test("a project OIDC sign-in is recorded as OIDC", async () => {
        const evidence: McpOAuthGrantSsoEvidence | null = await capture(
          requestWithProjectToken(
            mintProjectToken({ providerType: SsoProviderType.ProjectOIDC }),
          ),
        );

        expect(evidence!.ssoProviderType).toBe(SsoProviderType.ProjectOIDC);
      });

      test("asks the provider that gave it, for this project - never the Global path", async () => {
        await capture(requestWithProjectToken(mintProjectToken()));

        expect(projectSsoStanding).toHaveBeenCalledTimes(1);

        const asked: { providerId: ObjectID; projectId: ObjectID } =
          projectSsoStanding.mock.calls[0]![0] as {
            providerId: ObjectID;
            projectId: ObjectID;
          };

        expect(asked.providerId.toString()).toBe(PROVIDER_ID.toString());
        expect(asked.projectId.toString()).toBe(PROJECT_ID.toString());
        expect(projectOidcStanding).not.toHaveBeenCalled();
        expect(globalTokenAuthorized).not.toHaveBeenCalled();
      });

      test("a project OIDC sign-in asks the OIDC provider, not a SAML one of the same id", async () => {
        await capture(
          requestWithProjectToken(
            mintProjectToken({ providerType: SsoProviderType.ProjectOIDC }),
          ),
        );

        expect(projectOidcStanding).toHaveBeenCalledTimes(1);
        expect(projectSsoStanding).not.toHaveBeenCalled();
      });

      test("a sign-in whose provider has been turned off is no evidence", async () => {
        projectSsoStanding.mockResolvedValue({
          isOn: false,
          signInsEndedAtMs: Date.now() - ONE_HOUR_MS,
        });

        await expect(
          capture(requestWithProjectToken(mintProjectToken())),
        ).resolves.toBeNull();
      });

      test("a sign-in whose provider has been deleted is no evidence", async () => {
        projectSsoStanding.mockResolvedValue(PROVIDER_NOT_FOUND);

        await expect(
          capture(requestWithProjectToken(mintProjectToken())),
        ).resolves.toBeNull();
      });

      test("a sign-in given before its provider was last turned off is no evidence, though the provider is on again", async () => {
        const token: string = mintProjectToken();

        projectSsoStanding.mockResolvedValue({
          isOn: true,
          // Turned off a minute after this sign-in, and on again since.
          signInsEndedAtMs: Date.now() + 60 * 1000,
        });

        await expect(capture(requestWithProjectToken(token))).resolves.toBe(
          null,
        );

        // A sign-in the provider gave after it was turned off counts.
        projectSsoStanding.mockResolvedValue({
          isOn: true,
          signInsEndedAtMs: Date.now() - ONE_HOUR_MS,
        });

        await expect(
          capture(requestWithProjectToken(token)),
        ).resolves.not.toBeNull();
      });

      test("'could not find out' about the provider is an error, not a missing sign-in", async () => {
        projectSsoStanding.mockRejectedValue(new Error("database unavailable"));

        await expect(
          capture(requestWithProjectToken(mintProjectToken())),
        ).rejects.toThrow("database unavailable");
      });

      test("is read from the x-sso-tokens header too (the mobile flow)", async () => {
        const token: string = mintProjectToken();

        const evidence: McpOAuthGrantSsoEvidence | null = await capture(
          buildRequest({
            headers: {
              "x-sso-tokens": JSON.stringify({
                [PROJECT_ID.toString()]: token,
              }),
            },
          }),
        );

        expect(evidence!.ssoProviderId?.toString()).toBe(
          PROVIDER_ID.toString(),
        );
        expect(evidence!.expiresAt.getTime()).toBe(expiryOf(token).getTime());
      });

      test("a token that names no provider is no evidence: no provider can vouch for it", async () => {
        const token: string = mintProjectToken({
          providerId: undefined,
          providerType: undefined,
        });

        await expect(
          capture(requestWithProjectToken(token)),
        ).resolves.toBeNull();
        expect(projectSsoStanding).not.toHaveBeenCalled();
        expect(projectOidcStanding).not.toHaveBeenCalled();
      });

      test("a legacy token does NOT satisfy a project that pins a specific provider", async () => {
        const evidence: McpOAuthGrantSsoEvidence | null = await capture(
          requestWithProjectToken(
            mintProjectToken({
              providerId: undefined,
              providerType: undefined,
            }),
          ),
          { requiredSsoProviderId: PROVIDER_ID },
        );

        expect(evidence).toBeNull();
      });

      test("the pinned provider is enforced: the wrong provider's token is no evidence", async () => {
        const req: ExpressRequest = requestWithProjectToken(
          mintProjectToken({ providerId: OTHER_PROVIDER_ID }),
        );

        await expect(
          capture(req, { requiredSsoProviderId: PROVIDER_ID }),
        ).resolves.toBeNull();

        // The same request against the provider it WAS issued by is evidence.
        const evidence: McpOAuthGrantSsoEvidence | null = await capture(req, {
          requiredSsoProviderId: OTHER_PROVIDER_ID,
        });

        expect(evidence!.ssoProviderId?.toString()).toBe(
          OTHER_PROVIDER_ID.toString(),
        );
      });

      test("a token for ANOTHER project is no evidence for this one", async () => {
        const req: ExpressRequest = buildRequest({
          projectTokens: [
            {
              projectId: OTHER_PROJECT_ID,
              token: mintProjectToken({ projectId: OTHER_PROJECT_ID }),
            },
          ],
        });

        await expect(capture(req)).resolves.toBeNull();
        // ...and it IS evidence for the project it was issued for.
        await expect(
          capture(req, { projectId: OTHER_PROJECT_ID }),
        ).resolves.not.toBeNull();
      });

      test("another project's token placed in this project's cookie is no evidence", async () => {
        const req: ExpressRequest = buildRequest({
          projectTokens: [
            {
              projectId: PROJECT_ID,
              token: mintProjectToken({ projectId: OTHER_PROJECT_ID }),
            },
          ],
        });

        await expect(capture(req)).resolves.toBeNull();
      });

      test("ANOTHER user's token is no evidence for this member", async () => {
        const req: ExpressRequest = requestWithProjectToken(
          mintProjectToken({ userId: OTHER_USER_ID }),
        );

        await expect(capture(req)).resolves.toBeNull();
        await expect(
          capture(req, { userId: OTHER_USER_ID }),
        ).resolves.not.toBeNull();
      });

      test("a token signed with some other secret is no evidence", async () => {
        const forged: string = jwt.sign(
          projectTokenPayload(),
          "not-the-encryption-secret",
          { expiresIn: 3600 },
        );

        await expect(
          capture(requestWithProjectToken(forged)),
        ).resolves.toBeNull();
      });

      test("an expired token is no evidence", async () => {
        const expired: string = jwt.sign(
          { ...projectTokenPayload(), exp: Math.floor(Date.now() / 1000) - 60 },
          EncryptionSecret.toString(),
        );

        await expect(
          capture(requestWithProjectToken(expired)),
        ).resolves.toBeNull();
      });

      test("a token with no expiry is no evidence: a copy that cannot say when it lapses would never lapse", async () => {
        const token: string = mintCustomToken(projectTokenPayload(), {
          withoutExpiry: true,
        });

        // The browser itself accepts this token...
        expect(
          UserMiddleware.doesProjectScopedSsoTokenExist(
            requestWithProjectToken(token),
            PROJECT_ID,
            USER_ID,
          ),
        ).toBe(true);

        // ...but it cannot be copied onto a grant.
        await expect(
          capture(requestWithProjectToken(token)),
        ).resolves.toBeNull();
      });

      test("a token naming a provider type this version does not know is no evidence", async () => {
        const token: string = mintCustomToken(
          projectTokenPayload({ ssoProviderType: "SomeFutureSSO" }),
        );

        await expect(
          capture(requestWithProjectToken(token)),
        ).resolves.toBeNull();
      });

      test("a provider id that is not a UUID is no evidence: no provider can vouch for it", async () => {
        const token: string = mintCustomToken(
          projectTokenPayload({ ssoProviderId: "not-a-uuid" }),
        );

        await expect(
          capture(requestWithProjectToken(token)),
        ).resolves.toBeNull();
        expect(projectSsoStanding).not.toHaveBeenCalled();
      });

      test("a Global-typed token sitting in the per-project cookie is not taken as a project sign-in", async () => {
        const token: string = mintCustomToken(
          projectTokenPayload({ ssoProviderType: SsoProviderType.GlobalSSO }),
        );

        await expect(
          capture(requestWithProjectToken(token)),
        ).resolves.toBeNull();
        expect(globalTokenAuthorized).not.toHaveBeenCalled();
      });
    });

    describe("an instance-wide (Global) SSO sign-in", () => {
      test("is recorded when the provider is still authorized for the project", async () => {
        const token: string = mintGlobalToken();

        const evidence: McpOAuthGrantSsoEvidence | null = await capture(
          buildRequest({ globalCookieToken: token }),
        );

        expect(evidence).toEqual({
          ssoProviderType: SsoProviderType.GlobalSSO,
          ssoProviderId: PROVIDER_ID,
          expiresAt: expiryOf(token),
        });
      });

      test("a Global OIDC sign-in is recorded as OIDC", async () => {
        const evidence: McpOAuthGrantSsoEvidence | null = await capture(
          buildRequest({
            globalCookieToken: mintGlobalToken({
              providerType: SsoProviderType.GlobalOIDC,
            }),
          }),
        );

        expect(evidence!.ssoProviderType).toBe(SsoProviderType.GlobalOIDC);
      });

      test("asks whether THIS provider is authorized for THIS project", async () => {
        await capture(buildRequest({ globalCookieToken: mintGlobalToken() }));

        expect(globalTokenAuthorized).toHaveBeenCalledTimes(1);

        const asked: {
          globalSsoTokenData: JSONWebTokenData;
          projectId: ObjectID;
        } = globalTokenAuthorized.mock.calls[0]![0] as {
          globalSsoTokenData: JSONWebTokenData;
          projectId: ObjectID;
        };

        expect(asked.projectId.toString()).toBe(PROJECT_ID.toString());
        expect(asked.globalSsoTokenData.ssoProviderId?.toString()).toBe(
          PROVIDER_ID.toString(),
        );
        expect(asked.globalSsoTokenData.ssoProviderType).toBe(
          SsoProviderType.GlobalSSO,
        );
        expect(asked.globalSsoTokenData.userId.toString()).toBe(
          USER_ID.toString(),
        );
      });

      test("is NO evidence when the provider is no longer authorized for the project", async () => {
        globalTokenAuthorized.mockResolvedValue(false);

        await expect(
          capture(buildRequest({ globalCookieToken: mintGlobalToken() })),
        ).resolves.toBeNull();
      });

      test("'could not find out' is an error, not a missing sign-in", async () => {
        globalTokenAuthorized.mockRejectedValue(
          new Error("database unavailable"),
        );

        await expect(
          capture(buildRequest({ globalCookieToken: mintGlobalToken() })),
        ).rejects.toThrow("database unavailable");
      });

      test("is read from the x-global-sso-token header when there is no cookie (the mobile flow)", async () => {
        const token: string = mintGlobalToken();

        const evidence: McpOAuthGrantSsoEvidence | null = await capture(
          buildRequest({ headers: { [GLOBAL_SSO_TOKEN_HEADER]: token } }),
        );

        expect(evidence).toEqual({
          ssoProviderType: SsoProviderType.GlobalSSO,
          ssoProviderId: PROVIDER_ID,
          expiresAt: expiryOf(token),
        });
      });

      test("the cookie is read before the header - the same token UserMiddleware judged", async () => {
        const evidence: McpOAuthGrantSsoEvidence | null = await capture(
          buildRequest({
            globalCookieToken: mintGlobalToken({ providerId: PROVIDER_ID }),
            headers: {
              [GLOBAL_SSO_TOKEN_HEADER]: mintGlobalToken({
                providerId: OTHER_PROVIDER_ID,
              }),
            },
          }),
        );

        expect(evidence!.ssoProviderId?.toString()).toBe(
          PROVIDER_ID.toString(),
        );

        const asked: { globalSsoTokenData: JSONWebTokenData } =
          globalTokenAuthorized.mock.calls[0]![0] as {
            globalSsoTokenData: JSONWebTokenData;
          };

        expect(asked.globalSsoTokenData.ssoProviderId?.toString()).toBe(
          PROVIDER_ID.toString(),
        );
      });

      test("ANOTHER user's Global token is no evidence, and the database is never asked", async () => {
        await expect(
          capture(
            buildRequest({
              globalCookieToken: mintGlobalToken({ userId: OTHER_USER_ID }),
            }),
          ),
        ).resolves.toBeNull();

        expect(globalTokenAuthorized).not.toHaveBeenCalled();
      });

      test("the pinned provider is enforced before the database is asked", async () => {
        const req: ExpressRequest = buildRequest({
          globalCookieToken: mintGlobalToken({ providerId: OTHER_PROVIDER_ID }),
        });

        await expect(
          capture(req, { requiredSsoProviderId: PROVIDER_ID }),
        ).resolves.toBeNull();
        expect(globalTokenAuthorized).not.toHaveBeenCalled();

        // Pinned to the provider that issued it: accepted.
        await expect(
          capture(req, { requiredSsoProviderId: OTHER_PROVIDER_ID }),
        ).resolves.not.toBeNull();
      });

      test("a PROJECT-typed token sitting in the global cookie is not a Global sign-in", async () => {
        await expect(
          capture(buildRequest({ globalCookieToken: mintProjectToken() })),
        ).resolves.toBeNull();

        expect(globalTokenAuthorized).not.toHaveBeenCalled();
      });

      test("a Global token with no expiry is no evidence", async () => {
        const token: string = mintCustomToken(
          {
            userId: USER_ID.toString(),
            name: "Sso User",
            email: "sso-user@example.com",
            isMasterAdmin: false,
            ssoProviderId: PROVIDER_ID.toString(),
            ssoProviderType: SsoProviderType.GlobalSSO,
          },
          { withoutExpiry: true },
        );

        await expect(
          capture(buildRequest({ globalCookieToken: token })),
        ).resolves.toBeNull();
      });
    });

    describe("both kinds on one request", () => {
      test("the project's own token wins, and the Global one is never consulted", async () => {
        const projectToken: string = mintProjectToken({
          providerId: PROVIDER_ID,
        });

        const evidence: McpOAuthGrantSsoEvidence | null = await capture(
          buildRequest({
            projectTokens: [{ projectId: PROJECT_ID, token: projectToken }],
            globalCookieToken: mintGlobalToken({
              providerId: OTHER_PROVIDER_ID,
            }),
          }),
        );

        expect(evidence!.ssoProviderType).toBe(SsoProviderType.ProjectSSO);
        expect(evidence!.ssoProviderId?.toString()).toBe(
          PROVIDER_ID.toString(),
        );
        expect(globalTokenAuthorized).not.toHaveBeenCalled();
      });

      test("a project token whose provider was turned off falls through to a Global one that is still on", async () => {
        projectSsoStanding.mockResolvedValue({
          isOn: false,
          signInsEndedAtMs: null,
        });

        const evidence: McpOAuthGrantSsoEvidence | null = await capture(
          buildRequest({
            projectTokens: [
              { projectId: PROJECT_ID, token: mintProjectToken() },
            ],
            globalCookieToken: mintGlobalToken({
              providerId: OTHER_PROVIDER_ID,
            }),
          }),
        );

        expect(evidence!.ssoProviderType).toBe(SsoProviderType.GlobalSSO);
        expect(globalTokenAuthorized).toHaveBeenCalledTimes(1);
      });

      test("a project token whose provider cannot be looked up gives way to a Global one that is still on", async () => {
        projectSsoStanding.mockRejectedValue(new Error("database unavailable"));

        const evidence: McpOAuthGrantSsoEvidence | null = await capture(
          buildRequest({
            projectTokens: [
              { projectId: PROJECT_ID, token: mintProjectToken() },
            ],
            globalCookieToken: mintGlobalToken({
              providerId: OTHER_PROVIDER_ID,
            }),
          }),
        );

        expect(evidence!.ssoProviderType).toBe(SsoProviderType.GlobalSSO);
        expect(evidence!.ssoProviderId?.toString()).toBe(
          OTHER_PROVIDER_ID.toString(),
        );
      });

      test("with a Global one that is no longer authorized, the failed lookup is the answer: an error", async () => {
        projectSsoStanding.mockRejectedValue(new Error("database unavailable"));
        globalTokenAuthorized.mockResolvedValue(false as never);

        await expect(
          capture(
            buildRequest({
              projectTokens: [
                { projectId: PROJECT_ID, token: mintProjectToken() },
              ],
              globalCookieToken: mintGlobalToken({
                providerId: OTHER_PROVIDER_ID,
              }),
            }),
          ),
        ).rejects.toThrow("database unavailable");
      });

      test("a project token that does not satisfy the pin falls through to a Global one that does", async () => {
        const evidence: McpOAuthGrantSsoEvidence | null = await capture(
          buildRequest({
            projectTokens: [
              {
                projectId: PROJECT_ID,
                token: mintProjectToken({ providerId: OTHER_PROVIDER_ID }),
              },
            ],
            globalCookieToken: mintGlobalToken({ providerId: PROVIDER_ID }),
          }),
          { requiredSsoProviderId: PROVIDER_ID },
        );

        expect(evidence!.ssoProviderType).toBe(SsoProviderType.GlobalSSO);
        expect(evidence!.ssoProviderId?.toString()).toBe(
          PROVIDER_ID.toString(),
        );
      });
    });

    describe("no SSO sign-in at all", () => {
      test("a request with no SSO token is no evidence", async () => {
        await expect(capture(buildRequest())).resolves.toBeNull();
        expect(globalTokenAuthorized).not.toHaveBeenCalled();
      });

      test("a request with no cookies object at all is no evidence", async () => {
        await expect(
          capture({ headers: {} } as unknown as ExpressRequest),
        ).resolves.toBeNull();
      });

      test("a dashboard session token is not an SSO sign-in", async () => {
        const sessionToken: string = JSONWebToken.signUserLoginToken({
          tokenData: {
            userId: USER_ID,
            email: new Email("sso-user@example.com"),
            name: new Name("Sso User"),
            timezone: null,
            isMasterAdmin: false,
            isGlobalLogin: true,
            sessionId: ObjectID.generate(),
          },
          expiresInSeconds: 900,
        });

        await expect(
          capture(
            buildRequest({
              globalCookieToken: sessionToken,
              headers: { authorization: `Bearer ${sessionToken}` },
            }),
          ),
        ).resolves.toBeNull();
      });
    });
  });

  describe("isEvidenceSatisfied", () => {
    const projectEvidence: (
      overrides?: Partial<McpOAuthGrantSsoEvidence>,
    ) => McpOAuthGrantSsoEvidence = (
      overrides: Partial<McpOAuthGrantSsoEvidence> = {},
    ): McpOAuthGrantSsoEvidence => {
      return {
        ssoProviderType: SsoProviderType.ProjectSSO,
        ssoProviderId: PROVIDER_ID,
        expiresAt: new Date(NOW.getTime() + ONE_HOUR_MS),
        ...overrides,
      };
    };

    const satisfied: (
      evidence: McpOAuthGrantSsoEvidence | null,
      overrides?: {
        requiredSsoProviderId?: ObjectID | null;
        now?: Date | undefined;
      },
    ) => Promise<boolean> = async (
      evidence: McpOAuthGrantSsoEvidence | null,
      overrides: {
        requiredSsoProviderId?: ObjectID | null;
        now?: Date | undefined;
      } = {},
    ): Promise<boolean> => {
      return await McpOAuthSso.isEvidenceSatisfied({
        evidence,
        projectId: PROJECT_ID,
        requiredSsoProviderId: overrides.requiredSsoProviderId ?? null,
        now: "now" in overrides ? overrides.now : NOW,
      });
    };

    test("no evidence never satisfies", async () => {
      await expect(satisfied(null)).resolves.toBe(false);
      expect(globalTokenAuthorized).not.toHaveBeenCalled();
    });

    describe("expiry", () => {
      test("evidence that lapses in the future satisfies", async () => {
        await expect(satisfied(projectEvidence())).resolves.toBe(true);
      });

      test("evidence lapses AT its expiry instant, not only after it", async () => {
        await expect(
          satisfied(projectEvidence({ expiresAt: new Date(NOW.getTime()) })),
        ).resolves.toBe(false);
      });

      test("evidence is good until the millisecond before", async () => {
        await expect(
          satisfied(
            projectEvidence({ expiresAt: new Date(NOW.getTime() + 1) }),
          ),
        ).resolves.toBe(true);
      });

      test("lapsed evidence does not satisfy", async () => {
        await expect(
          satisfied(
            projectEvidence({ expiresAt: new Date(NOW.getTime() - 1) }),
          ),
        ).resolves.toBe(false);
      });

      test("lapsed Global evidence is refused without asking the database", async () => {
        await expect(
          satisfied(
            projectEvidence({
              ssoProviderType: SsoProviderType.GlobalSSO,
              expiresAt: new Date(NOW.getTime() - 1),
            }),
          ),
        ).resolves.toBe(false);

        expect(globalTokenAuthorized).not.toHaveBeenCalled();
      });

      test("without `now`, it is measured against the current time", async () => {
        await expect(
          satisfied(
            projectEvidence({ expiresAt: new Date(Date.now() + ONE_HOUR_MS) }),
            { now: undefined },
          ),
        ).resolves.toBe(true);

        await expect(
          satisfied(
            projectEvidence({ expiresAt: new Date(Date.now() - ONE_HOUR_MS) }),
            { now: undefined },
          ),
        ).resolves.toBe(false);
      });

      test("an expiry stored as a string is read as a date", async () => {
        const evidence: McpOAuthGrantSsoEvidence = projectEvidence();

        (evidence as unknown as { expiresAt: string }).expiresAt = new Date(
          NOW.getTime() - 1,
        ).toISOString();

        await expect(satisfied(evidence)).resolves.toBe(false);
      });
    });

    describe("when the project pins one provider", () => {
      test("evidence from that provider satisfies", async () => {
        await expect(
          satisfied(projectEvidence(), { requiredSsoProviderId: PROVIDER_ID }),
        ).resolves.toBe(true);
      });

      test("evidence from another provider does not", async () => {
        await expect(
          satisfied(projectEvidence({ ssoProviderId: OTHER_PROVIDER_ID }), {
            requiredSsoProviderId: PROVIDER_ID,
          }),
        ).resolves.toBe(false);
      });

      test("evidence with no provider recorded does not", async () => {
        await expect(
          satisfied(projectEvidence({ ssoProviderId: null }), {
            requiredSsoProviderId: PROVIDER_ID,
          }),
        ).resolves.toBe(false);
      });

      test("a project that STARTS pinning a provider after the grant was made is enforced on the next use", async () => {
        const evidence: McpOAuthGrantSsoEvidence = projectEvidence({
          ssoProviderId: OTHER_PROVIDER_ID,
        });

        await expect(satisfied(evidence)).resolves.toBe(true);
        await expect(
          satisfied(evidence, { requiredSsoProviderId: PROVIDER_ID }),
        ).resolves.toBe(false);
      });

      test("the pin is checked before a Global provider's standing is looked up", async () => {
        await expect(
          satisfied(
            projectEvidence({
              ssoProviderType: SsoProviderType.GlobalSSO,
              ssoProviderId: OTHER_PROVIDER_ID,
            }),
            { requiredSsoProviderId: PROVIDER_ID },
          ),
        ).resolves.toBe(false);

        expect(globalTokenAuthorized).not.toHaveBeenCalled();
      });
    });

    describe("a project's own provider", () => {
      const projectTypes: Array<SsoProviderType> = [
        SsoProviderType.ProjectSSO,
        SsoProviderType.ProjectOIDC,
      ];

      // When the grant was made: its sign-in was given no later.
      const CAPTURED_AT: Date = new Date(NOW.getTime() - 2 * ONE_HOUR_MS);

      test.each(projectTypes)(
        "%s evidence is asked about the provider that gave it, today, for this project - never as a Global one",
        async (ssoProviderType: SsoProviderType) => {
          await expect(
            satisfied(projectEvidence({ ssoProviderType })),
          ).resolves.toBe(true);

          const standing: SpyInstance =
            ssoProviderType === SsoProviderType.ProjectOIDC
              ? projectOidcStanding
              : projectSsoStanding;

          expect(standing).toHaveBeenCalledTimes(1);

          const asked: { providerId: ObjectID; projectId: ObjectID } = standing
            .mock.calls[0]![0] as {
            providerId: ObjectID;
            projectId: ObjectID;
          };

          expect(asked.providerId.toString()).toBe(PROVIDER_ID.toString());
          expect(asked.projectId.toString()).toBe(PROJECT_ID.toString());
          expect(globalTokenAuthorized).not.toHaveBeenCalled();
        },
      );

      test.each(projectTypes)(
        "%s evidence is refused once its provider is turned off or deleted",
        async (ssoProviderType: SsoProviderType) => {
          const standing: SpyInstance =
            ssoProviderType === SsoProviderType.ProjectOIDC
              ? projectOidcStanding
              : projectSsoStanding;

          standing.mockResolvedValue({ isOn: false, signInsEndedAtMs: null });

          await expect(
            satisfied(projectEvidence({ ssoProviderType })),
          ).resolves.toBe(false);

          standing.mockResolvedValue(PROVIDER_NOT_FOUND);

          await expect(
            satisfied(projectEvidence({ ssoProviderType })),
          ).resolves.toBe(false);
        },
      );

      test("a provider turned off after the grant was made refuses it, even once it is on again", async () => {
        projectSsoStanding.mockResolvedValue({
          isOn: true,
          signInsEndedAtMs: CAPTURED_AT.getTime() + 60 * 1000,
        });

        await expect(
          satisfied(projectEvidence({ capturedAt: CAPTURED_AT })),
        ).resolves.toBe(false);
      });

      test("a provider turned off before the grant was made, and on again since, still satisfies it", async () => {
        projectSsoStanding.mockResolvedValue({
          isOn: true,
          signInsEndedAtMs: CAPTURED_AT.getTime() - 60 * 1000,
        });

        await expect(
          satisfied(projectEvidence({ capturedAt: CAPTURED_AT })),
        ).resolves.toBe(true);
      });

      test("evidence that does not say when it was captured counts only for a provider never turned off", async () => {
        await expect(satisfied(projectEvidence())).resolves.toBe(true);

        projectSsoStanding.mockResolvedValue({
          isOn: true,
          signInsEndedAtMs: CAPTURED_AT.getTime(),
        });

        await expect(satisfied(projectEvidence())).resolves.toBe(false);
      });

      test("with no provider recorded it satisfies nothing: no provider can vouch for it", async () => {
        await expect(
          satisfied(projectEvidence({ ssoProviderId: null })),
        ).resolves.toBe(false);
        expect(projectSsoStanding).not.toHaveBeenCalled();
      });

      test("a lookup that FAILS propagates: it is neither a refusal nor a pass", async () => {
        projectSsoStanding.mockRejectedValue(new Error("database unavailable"));

        await expect(satisfied(projectEvidence())).rejects.toThrow(
          "database unavailable",
        );
      });
    });

    describe("an instance-wide (Global) provider", () => {
      const globalTypes: Array<SsoProviderType> = [
        SsoProviderType.GlobalSSO,
        SsoProviderType.GlobalOIDC,
      ];

      test.each(globalTypes)(
        "%s evidence is re-checked on every use, with the provider's type and id and this project",
        async (ssoProviderType: SsoProviderType) => {
          await satisfied(projectEvidence({ ssoProviderType }));

          expect(globalTokenAuthorized).toHaveBeenCalledTimes(1);

          const asked: {
            globalSsoTokenData: JSONWebTokenData;
            projectId: ObjectID;
          } = globalTokenAuthorized.mock.calls[0]![0] as {
            globalSsoTokenData: JSONWebTokenData;
            projectId: ObjectID;
          };

          expect(asked.projectId.toString()).toBe(PROJECT_ID.toString());
          expect(asked.globalSsoTokenData.ssoProviderType).toBe(
            ssoProviderType,
          );
          expect(asked.globalSsoTokenData.ssoProviderId?.toString()).toBe(
            PROVIDER_ID.toString(),
          );
        },
      );

      test.each(globalTypes)(
        "%s evidence satisfies while the provider is still authorized",
        async (ssoProviderType: SsoProviderType) => {
          globalTokenAuthorized.mockResolvedValue(true);

          await expect(
            satisfied(projectEvidence({ ssoProviderType })),
          ).resolves.toBe(true);
        },
      );

      test.each(globalTypes)(
        "%s evidence stops satisfying the moment the provider is no longer authorized",
        async (ssoProviderType: SsoProviderType) => {
          globalTokenAuthorized.mockResolvedValue(false);

          await expect(
            satisfied(projectEvidence({ ssoProviderType })),
          ).resolves.toBe(false);
        },
      );

      test("a lookup that FAILS propagates: it is neither a refusal nor a pass", async () => {
        globalTokenAuthorized.mockRejectedValue(
          new Error("database unavailable"),
        );

        await expect(
          satisfied(
            projectEvidence({ ssoProviderType: SsoProviderType.GlobalSSO }),
          ),
        ).rejects.toThrow("database unavailable");
      });
    });

    /*
     * The stored copy holds two provider fields and nothing else. These run
     * UserMiddleware.isGlobalSsoTokenAuthorizedForProject FOR REAL, with only
     * the four service methods under it stubbed, to prove those two fields
     * are all it needs - a refactor that made it read a third would otherwise
     * silently turn every Global grant into "not authorized".
     */
    describe("against the real provider check", () => {
      let ssoTrust: SpyInstance;
      let oidcTrust: SpyInstance;
      let ssoGoverns: SpyInstance;
      let oidcGoverns: SpyInstance;

      beforeEach(() => {
        globalTokenAuthorized.mockRestore();

        ssoTrust = getJestSpyOn(
          GlobalSsoService,
          "getProviderTrust",
        ).mockResolvedValue({
          isUsable: true,
          restrictToAttachedProjects: false,
          signInsEndedAtMs: null,
        });
        oidcTrust = getJestSpyOn(
          GlobalOidcService,
          "getProviderTrust",
        ).mockResolvedValue({
          isUsable: true,
          restrictToAttachedProjects: false,
          signInsEndedAtMs: null,
        });
        ssoGoverns = getJestSpyOn(
          GlobalSsoProjectService,
          "doesProviderGovernProject",
        ).mockResolvedValue(true);
        oidcGoverns = getJestSpyOn(
          GlobalOidcProjectService,
          "doesProviderGovernProject",
        ).mockResolvedValue(true);
      });

      test("Global SAML evidence is checked against the SAML provider, by id", async () => {
        await expect(
          satisfied(
            projectEvidence({ ssoProviderType: SsoProviderType.GlobalSSO }),
          ),
        ).resolves.toBe(true);

        expect((ssoTrust.mock.calls[0]![0] as ObjectID).toString()).toBe(
          PROVIDER_ID.toString(),
        );
        expect(oidcTrust).not.toHaveBeenCalled();
      });

      test("Global OIDC evidence is checked against the OIDC provider, by id", async () => {
        await expect(
          satisfied(
            projectEvidence({ ssoProviderType: SsoProviderType.GlobalOIDC }),
          ),
        ).resolves.toBe(true);

        expect((oidcTrust.mock.calls[0]![0] as ObjectID).toString()).toBe(
          PROVIDER_ID.toString(),
        );
        expect(ssoTrust).not.toHaveBeenCalled();
      });

      test("a provider that was disabled or deleted after the grant was made refuses it", async () => {
        ssoTrust.mockResolvedValue({
          isUsable: false,
          restrictToAttachedProjects: false,
          signInsEndedAtMs: null,
        });

        await expect(
          satisfied(
            projectEvidence({ ssoProviderType: SsoProviderType.GlobalSSO }),
          ),
        ).resolves.toBe(false);
      });

      test("a provider restricted to attached projects refuses a project it no longer governs", async () => {
        oidcTrust.mockResolvedValue({
          isUsable: true,
          restrictToAttachedProjects: true,
          signInsEndedAtMs: null,
        });
        oidcGoverns.mockResolvedValue(false);

        await expect(
          satisfied(
            projectEvidence({ ssoProviderType: SsoProviderType.GlobalOIDC }),
          ),
        ).resolves.toBe(false);

        const asked: { globalOidcId: ObjectID; projectId: ObjectID } =
          oidcGoverns.mock.calls[0]![0] as {
            globalOidcId: ObjectID;
            projectId: ObjectID;
          };

        expect(asked.globalOidcId.toString()).toBe(PROVIDER_ID.toString());
        expect(asked.projectId.toString()).toBe(PROJECT_ID.toString());
        expect(ssoGoverns).not.toHaveBeenCalled();
      });

      test("Global evidence with no provider id cannot be checked, so it does not satisfy - and nothing is looked up", async () => {
        await expect(
          satisfied(
            projectEvidence({
              ssoProviderType: SsoProviderType.GlobalSSO,
              ssoProviderId: null,
            }),
          ),
        ).resolves.toBe(false);

        expect(ssoTrust).not.toHaveBeenCalled();
        expect(oidcTrust).not.toHaveBeenCalled();
      });

      test("a failing trust lookup propagates through the real check too", async () => {
        ssoTrust.mockRejectedValue(new Error("database unavailable"));

        await expect(
          satisfied(
            projectEvidence({ ssoProviderType: SsoProviderType.GlobalSSO }),
          ),
        ).rejects.toThrow("database unavailable");
      });
    });
  });

  describe("captured evidence satisfies the check it was captured for", () => {
    test("a project sign-in captured now satisfies until its token would have expired, and not after", async () => {
      const token: string = mintProjectToken();

      const evidence: McpOAuthGrantSsoEvidence | null =
        await McpOAuthSso.captureEvidence({
          req: requestWithProjectToken(token),
          projectId: PROJECT_ID,
          userId: USER_ID,
          requiredSsoProviderId: PROVIDER_ID,
        });

      const tokenExpiry: Date = expiryOf(token);

      await expect(
        McpOAuthSso.isEvidenceSatisfied({
          evidence,
          projectId: PROJECT_ID,
          requiredSsoProviderId: PROVIDER_ID,
          now: new Date(tokenExpiry.getTime() - 1),
        }),
      ).resolves.toBe(true);

      await expect(
        McpOAuthSso.isEvidenceSatisfied({
          evidence,
          projectId: PROJECT_ID,
          requiredSsoProviderId: PROVIDER_ID,
          now: tokenExpiry,
        }),
      ).resolves.toBe(false);
    });

    test("a Global sign-in captured now is still asked about the provider on every later use", async () => {
      const evidence: McpOAuthGrantSsoEvidence | null =
        await McpOAuthSso.captureEvidence({
          req: buildRequest({ globalCookieToken: mintGlobalToken() }),
          projectId: PROJECT_ID,
          userId: USER_ID,
          requiredSsoProviderId: null,
        });

      expect(globalTokenAuthorized).toHaveBeenCalledTimes(1);

      await McpOAuthSso.isEvidenceSatisfied({
        evidence,
        projectId: PROJECT_ID,
        requiredSsoProviderId: null,
      });
      await McpOAuthSso.isEvidenceSatisfied({
        evidence,
        projectId: PROJECT_ID,
        requiredSsoProviderId: null,
      });

      expect(globalTokenAuthorized).toHaveBeenCalledTimes(3);
    });
  });
});
