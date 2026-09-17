import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import GlobalOidcProjectService from "../../../Server/Services/GlobalOidcProjectService";
import GlobalOidcService from "../../../Server/Services/GlobalOidcService";
import GlobalSsoProjectService from "../../../Server/Services/GlobalSsoProjectService";
import GlobalSsoService from "../../../Server/Services/GlobalSsoService";
import CookieUtil from "../../../Server/Utils/Cookie";
import { ExpressRequest } from "../../../Server/Utils/Express";
import { GlobalProviderTrust } from "../../../Server/Utils/GlobalSsoAuthorization";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import Email from "../../../Types/Email";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import User from "../../../Models/DatabaseModels/User";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../Server/Utils/Logger");

/*
 * A Global SSO/OIDC token is a 30-day JWT with NO project binding, so by
 * itself it only proves "this person authenticated against SOME instance-wide
 * identity provider at some point in the last month". Enforcement therefore
 * has two halves:
 *
 *   STATELESS  - signature, expiry, Global provider type, matching user, and
 *                the project's pinned-provider discriminator.
 *   STATEFUL   - is the provider still trusted (exists AND enabled), and -
 *                only when the admin opted in - does it govern this project.
 *
 * `UserMiddleware.isSsoSatisfiedForProject` is THE enforcement entry point and
 * runs both. `UserMiddleware.doesSsoTokenForProjectExist` is the stateless
 * half only, and is deliberately NOT enforcement (see the final describe).
 *
 * These tests mint REAL tokens through CookieUtil (real signing, real
 * verification) and stub ONLY the four service methods that reach Postgres,
 * so the middleware's own routing, ordering and AND-ing logic runs for real.
 *
 * Deliberately NOT repeated here, because it is already covered:
 *   - Common/Tests/Server/Middleware/UserAuthorizationSSOProvider.test.ts -
 *     the full `requiredSsoProviderId` discriminator matrix, the cookie vs
 *     `x-global-sso-token` header transports, and the sync-level refusal of
 *     Global-typed tokens in the per-project slot.
 *   - Common/Tests/Server/Utils/GlobalSSOToken.test.ts - the global token's
 *     payload/TTL contract, wrong-secret and syntactic tampering, and
 *     project-typed tokens sitting in the global slot.
 *   - Common/Tests/Server/Utils/GlobalSsoAuthorization.test.ts - the
 *     attachment/cache primitives underneath the services.
 * What this file adds is the DATABASE-backed half of the decision, and proof
 * that every stateless rejection happens BEFORE the database is consulted.
 *
 * Every "refused" assertion below is paired with an "allowed" assertion over
 * the SAME setup with only the single thing under test corrected. An
 * implementation that simply returned false everywhere would fail this file.
 */

const THIRTY_DAYS_IN_SECONDS: number = 30 * 24 * 60 * 60;

const TRUSTED_AND_UNRESTRICTED: GlobalProviderTrust = {
  isUsable: true,
  restrictToAttachedProjects: false,
};

const TRUSTED_AND_RESTRICTED: GlobalProviderTrust = {
  isUsable: true,
  restrictToAttachedProjects: true,
};

const REVOKED: GlobalProviderTrust = {
  isUsable: false,
  restrictToAttachedProjects: false,
};

type TrustSpy = SpyInstance<
  (providerId: ObjectID) => Promise<GlobalProviderTrust>
>;

type SsoGovernSpy = SpyInstance<
  (data: { globalSsoId: ObjectID; projectId: ObjectID }) => Promise<boolean>
>;

type OidcGovernSpy = SpyInstance<
  (data: { globalOidcId: ObjectID; projectId: ObjectID }) => Promise<boolean>
>;

let ssoTrustSpy: TrustSpy;
let oidcTrustSpy: TrustSpy;
let ssoGovernsSpy: SsoGovernSpy;
let oidcGovernsSpy: OidcGovernSpy;

const buildUser: (userId: ObjectID) => User = (userId: ObjectID): User => {
  const user: User = new User();
  user.id = userId;
  user.name = new Name("Global SSO User");
  user.email = new Email("global-sso@oneuptime.com");
  return user;
};

/** A real Global SSO/OIDC token, exactly as a global login mints it. */
const mintGlobalToken: (data: {
  userId: ObjectID;
  providerId: ObjectID;
  providerType: SsoProviderType;
}) => string = (data: {
  userId: ObjectID;
  providerId: ObjectID;
  providerType: SsoProviderType;
}): string => {
  return CookieUtil.getGlobalSSOToken({
    user: buildUser(data.userId),
    ssoProviderId: data.providerId,
    ssoProviderType: data.providerType,
  });
};

/** A real per-project `sso-<projectId>` token. */
const mintProjectToken: (data: {
  userId: ObjectID;
  projectId: ObjectID;
  providerId: ObjectID;
  providerType: SsoProviderType;
}) => string = (data: {
  userId: ObjectID;
  projectId: ObjectID;
  providerId: ObjectID;
  providerType: SsoProviderType;
}): string => {
  return CookieUtil.getSSOToken({
    user: buildUser(data.userId),
    projectId: data.projectId,
    ssoProviderId: data.providerId,
    ssoProviderType: data.providerType,
  });
};

const decodeToken: (token: string) => JSONWebTokenData = (
  token: string,
): JSONWebTokenData => {
  return JSONWebToken.decode(token);
};

interface RequestParts {
  globalToken?: string | undefined;
  projectTokens?: Array<{ projectId: ObjectID; token: string }> | undefined;
}

const buildRequest: (parts: RequestParts) => ExpressRequest = (
  parts: RequestParts,
): ExpressRequest => {
  const cookies: Record<string, string> = {};

  if (parts.globalToken) {
    cookies[CookieUtil.getGlobalSSOKey()] = parts.globalToken;
  }

  for (const entry of parts.projectTokens || []) {
    cookies[CookieUtil.getUserSSOKey(entry.projectId)] = entry.token;
  }

  return {
    cookies: cookies,
    headers: {},
  } as unknown as ExpressRequest;
};

/*
 * "The database was never asked." Used by every test that claims a decision
 * was reached statelessly - a stateless gate that silently started issuing
 * queries would be a performance regression on the hottest path in the
 * product, and a gate that ran AFTER the lookup would leak provider existence.
 */
const expectNoDatabaseLookups: () => void = (): void => {
  expect(ssoTrustSpy).not.toHaveBeenCalled();
  expect(oidcTrustSpy).not.toHaveBeenCalled();
  expect(ssoGovernsSpy).not.toHaveBeenCalled();
  expect(oidcGovernsSpy).not.toHaveBeenCalled();
};

beforeEach(() => {
  ssoTrustSpy = jest.spyOn(GlobalSsoService, "getProviderTrust");
  oidcTrustSpy = jest.spyOn(GlobalOidcService, "getProviderTrust");
  ssoGovernsSpy = jest.spyOn(
    GlobalSsoProjectService,
    "doesProviderGovernProject",
  );
  oidcGovernsSpy = jest.spyOn(
    GlobalOidcProjectService,
    "doesProviderGovernProject",
  );

  /*
   * Default: a healthy, enabled, unrestricted provider that governs
   * everything - i.e. what an existing installation looks like on upgrade.
   * Each test narrows only the answer it is about.
   */
  ssoTrustSpy.mockResolvedValue(TRUSTED_AND_UNRESTRICTED);
  oidcTrustSpy.mockResolvedValue(TRUSTED_AND_UNRESTRICTED);
  ssoGovernsSpy.mockResolvedValue(true);
  oidcGovernsSpy.mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * The provider-trust check is what makes the admin "Enabled" toggle mean
 * something. A Global SSO token carries no revocation and lives for 30 days,
 * so if this check were conditional - skipped for unrestricted providers, or
 * short-circuited when governance already said yes - turning a provider off
 * (or deleting it) would change nothing for anyone already signed in, for up
 * to a month.
 */
describe("isGlobalSsoTokenAuthorizedForProject - provider trust is unconditional", () => {
  const projectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const providerId: ObjectID = ObjectID.generate();

  const samlTokenData: () => JSONWebTokenData = (): JSONWebTokenData => {
    return decodeToken(
      mintGlobalToken({
        userId,
        providerId,
        providerType: SsoProviderType.GlobalSSO,
      }),
    );
  };

  const oidcTokenData: () => JSONWebTokenData = (): JSONWebTokenData => {
    return decodeToken(
      mintGlobalToken({
        userId,
        providerId,
        providerType: SsoProviderType.GlobalOIDC,
      }),
    );
  };

  test("SAML: a disabled or deleted provider refuses an otherwise perfect token", async () => {
    ssoTrustSpy.mockResolvedValue(REVOKED);

    await expect(
      UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
        globalSsoTokenData: samlTokenData(),
        projectId,
      }),
    ).resolves.toBe(false);

    // Trust said no, so there is nothing left to ask.
    expect(ssoGovernsSpy).not.toHaveBeenCalled();
  });

  test("SAML: the SAME token is allowed the moment the provider is enabled again", async () => {
    ssoTrustSpy.mockResolvedValue(TRUSTED_AND_UNRESTRICTED);

    await expect(
      UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
        globalSsoTokenData: samlTokenData(),
        projectId,
      }),
    ).resolves.toBe(true);
  });

  test("OIDC: a disabled or deleted provider refuses an otherwise perfect token", async () => {
    oidcTrustSpy.mockResolvedValue(REVOKED);

    await expect(
      UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
        globalSsoTokenData: oidcTokenData(),
        projectId,
      }),
    ).resolves.toBe(false);

    expect(oidcGovernsSpy).not.toHaveBeenCalled();
  });

  test("OIDC: the SAME token is allowed the moment the provider is enabled again", async () => {
    oidcTrustSpy.mockResolvedValue(TRUSTED_AND_UNRESTRICTED);

    await expect(
      UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
        globalSsoTokenData: oidcTokenData(),
        projectId,
      }),
    ).resolves.toBe(true);
  });

  test("a disabled provider is refused EVEN when it governs the project - trust is not skippable", async () => {
    // Restriction on, attachment present: governance would happily say yes.
    ssoTrustSpy.mockResolvedValue({
      isUsable: false,
      restrictToAttachedProjects: true,
    });
    ssoGovernsSpy.mockResolvedValue(true);

    await expect(
      UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
        globalSsoTokenData: samlTokenData(),
        projectId,
      }),
    ).resolves.toBe(false);

    // Same setup, only `isUsable` flipped -> allowed.
    ssoTrustSpy.mockResolvedValue(TRUSTED_AND_RESTRICTED);

    await expect(
      UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
        globalSsoTokenData: samlTokenData(),
        projectId,
      }),
    ).resolves.toBe(true);
  });

  test("the whole enforcement entry point refuses a request once the provider is disabled", async () => {
    ssoTrustSpy.mockResolvedValue(REVOKED);

    const req: ExpressRequest = buildRequest({
      globalToken: mintGlobalToken({
        userId,
        providerId,
        providerType: SsoProviderType.GlobalSSO,
      }),
    });

    await expect(
      UserMiddleware.isSsoSatisfiedForProject({ req, projectId, userId }),
    ).resolves.toBe(false);

    ssoTrustSpy.mockResolvedValue(TRUSTED_AND_UNRESTRICTED);

    await expect(
      UserMiddleware.isSsoSatisfiedForProject({ req, projectId, userId }),
    ).resolves.toBe(true);
  });
});

/*
 * THE HEADLINE BEHAVIOUR.
 *
 * The attachment rows (GlobalSsoProject / GlobalOidcProject) were introduced
 * as the PROVISIONING allow-list, and the login routers grant a session on
 * membership of ANY project. Reading them as an access boundary by default
 * would deny existing users the projects they legitimately reach today, the
 * instant they upgraded, with nothing inside the product to recover with. So
 * the boundary is OPT-IN per provider, via `restrictToAttachedProjects`, and
 * with it off the attachment table is not even consulted.
 */
describe("isGlobalSsoTokenAuthorizedForProject - project governance is opt-in", () => {
  const projectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const providerId: ObjectID = ObjectID.generate();

  const samlTokenData: () => JSONWebTokenData = (): JSONWebTokenData => {
    return decodeToken(
      mintGlobalToken({
        userId,
        providerId,
        providerType: SsoProviderType.GlobalSSO,
      }),
    );
  };

  test("restrictToAttachedProjects FALSE -> allowed WITHOUT ever asking the attachment table", async () => {
    ssoTrustSpy.mockResolvedValue(TRUSTED_AND_UNRESTRICTED);
    /*
     * Rigged to deny. If the implementation consulted it anyway, the result
     * would be false and this test would fail - which is exactly the
     * upgrade-day lockout being guarded against.
     */
    ssoGovernsSpy.mockResolvedValue(false);

    await expect(
      UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
        globalSsoTokenData: samlTokenData(),
        projectId,
      }),
    ).resolves.toBe(true);

    expect(ssoGovernsSpy).not.toHaveBeenCalled();
    expect(oidcGovernsSpy).not.toHaveBeenCalled();
  });

  test("restrictToAttachedProjects FALSE -> every project the user reaches is satisfied, not just one", async () => {
    ssoTrustSpy.mockResolvedValue(TRUSTED_AND_UNRESTRICTED);
    ssoGovernsSpy.mockResolvedValue(false);

    const otherProjectId: ObjectID = ObjectID.generate();
    const thirdProjectId: ObjectID = ObjectID.generate();

    for (const candidateProjectId of [
      projectId,
      otherProjectId,
      thirdProjectId,
    ]) {
      await expect(
        UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
          globalSsoTokenData: samlTokenData(),
          projectId: candidateProjectId,
        }),
      ).resolves.toBe(true);
    }

    expect(ssoGovernsSpy).not.toHaveBeenCalled();
  });

  test("restrictToAttachedProjects TRUE + provider governs the project -> allowed", async () => {
    ssoTrustSpy.mockResolvedValue(TRUSTED_AND_RESTRICTED);
    ssoGovernsSpy.mockResolvedValue(true);

    await expect(
      UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
        globalSsoTokenData: samlTokenData(),
        projectId,
      }),
    ).resolves.toBe(true);

    expect(ssoGovernsSpy).toHaveBeenCalledTimes(1);
  });

  test("restrictToAttachedProjects TRUE + provider does NOT govern the project -> refused", async () => {
    ssoTrustSpy.mockResolvedValue(TRUSTED_AND_RESTRICTED);
    ssoGovernsSpy.mockResolvedValue(false);

    await expect(
      UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
        globalSsoTokenData: samlTokenData(),
        projectId,
      }),
    ).resolves.toBe(false);

    expect(ssoGovernsSpy).toHaveBeenCalledTimes(1);
  });

  test("flipping ONLY restrictToAttachedProjects turns a non-governed project from allowed to refused", async () => {
    ssoGovernsSpy.mockResolvedValue(false);

    ssoTrustSpy.mockResolvedValue(TRUSTED_AND_UNRESTRICTED);
    await expect(
      UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
        globalSsoTokenData: samlTokenData(),
        projectId,
      }),
    ).resolves.toBe(true);

    ssoTrustSpy.mockResolvedValue(TRUSTED_AND_RESTRICTED);
    await expect(
      UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
        globalSsoTokenData: samlTokenData(),
        projectId,
      }),
    ).resolves.toBe(false);
  });

  test("governance flows through the enforcement entry point too, both ways", async () => {
    const req: ExpressRequest = buildRequest({
      globalToken: mintGlobalToken({
        userId,
        providerId,
        providerType: SsoProviderType.GlobalSSO,
      }),
    });

    ssoTrustSpy.mockResolvedValue(TRUSTED_AND_RESTRICTED);

    ssoGovernsSpy.mockResolvedValue(false);
    await expect(
      UserMiddleware.isSsoSatisfiedForProject({ req, projectId, userId }),
    ).resolves.toBe(false);

    ssoGovernsSpy.mockResolvedValue(true);
    await expect(
      UserMiddleware.isSsoSatisfiedForProject({ req, projectId, userId }),
    ).resolves.toBe(true);
  });
});

/*
 * Global SAML and Global OIDC are different tables, different services, and
 * different provider-id namespaces - an id from one must never be resolved
 * against the other, or a disabled SAML provider could be vouched for by an
 * unrelated OIDC row that happens to share its id.
 */
describe("isGlobalSsoTokenAuthorizedForProject - SAML vs OIDC routing", () => {
  const projectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const providerId: ObjectID = ObjectID.generate();

  test("a GlobalSSO token consults the SSO service and NOT the OIDC one", async () => {
    ssoTrustSpy.mockResolvedValue(TRUSTED_AND_RESTRICTED);
    ssoGovernsSpy.mockResolvedValue(true);
    // Rigged the other way, so any cross-talk changes the answer.
    oidcTrustSpy.mockResolvedValue(REVOKED);
    oidcGovernsSpy.mockResolvedValue(false);

    await expect(
      UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
        globalSsoTokenData: decodeToken(
          mintGlobalToken({
            userId,
            providerId,
            providerType: SsoProviderType.GlobalSSO,
          }),
        ),
        projectId,
      }),
    ).resolves.toBe(true);

    expect(ssoTrustSpy).toHaveBeenCalledTimes(1);
    expect(ssoGovernsSpy).toHaveBeenCalledTimes(1);
    expect(oidcTrustSpy).not.toHaveBeenCalled();
    expect(oidcGovernsSpy).not.toHaveBeenCalled();
  });

  test("a GlobalOIDC token consults the OIDC service and NOT the SSO one", async () => {
    oidcTrustSpy.mockResolvedValue(TRUSTED_AND_RESTRICTED);
    oidcGovernsSpy.mockResolvedValue(true);
    ssoTrustSpy.mockResolvedValue(REVOKED);
    ssoGovernsSpy.mockResolvedValue(false);

    await expect(
      UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
        globalSsoTokenData: decodeToken(
          mintGlobalToken({
            userId,
            providerId,
            providerType: SsoProviderType.GlobalOIDC,
          }),
        ),
        projectId,
      }),
    ).resolves.toBe(true);

    expect(oidcTrustSpy).toHaveBeenCalledTimes(1);
    expect(oidcGovernsSpy).toHaveBeenCalledTimes(1);
    expect(ssoTrustSpy).not.toHaveBeenCalled();
    expect(ssoGovernsSpy).not.toHaveBeenCalled();
  });

  test("a disabled SAML provider is NOT rescued by an enabled OIDC row of the same id", async () => {
    ssoTrustSpy.mockResolvedValue(REVOKED);
    oidcTrustSpy.mockResolvedValue(TRUSTED_AND_UNRESTRICTED);

    await expect(
      UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
        globalSsoTokenData: decodeToken(
          mintGlobalToken({
            userId,
            providerId,
            providerType: SsoProviderType.GlobalSSO,
          }),
        ),
        projectId,
      }),
    ).resolves.toBe(false);

    expect(oidcTrustSpy).not.toHaveBeenCalled();
  });

  test("a disabled OIDC provider is NOT rescued by an enabled SAML row of the same id", async () => {
    oidcTrustSpy.mockResolvedValue(REVOKED);
    ssoTrustSpy.mockResolvedValue(TRUSTED_AND_UNRESTRICTED);

    await expect(
      UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
        globalSsoTokenData: decodeToken(
          mintGlobalToken({
            userId,
            providerId,
            providerType: SsoProviderType.GlobalOIDC,
          }),
        ),
        projectId,
      }),
    ).resolves.toBe(false);

    expect(ssoTrustSpy).not.toHaveBeenCalled();
  });
});

/*
 * The decision has to be made about the provider named by THIS token and the
 * project named by THIS request. Passing the wrong id - a hard-coded one, the
 * required-provider id, the user id - would produce answers that look right in
 * a single-provider install and are wrong everywhere else.
 */
describe("isGlobalSsoTokenAuthorizedForProject - the ids handed to the services", () => {
  const projectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const providerId: ObjectID = ObjectID.generate();

  test("SAML: the token's provider id and the request's project id are the ones queried", async () => {
    ssoTrustSpy.mockResolvedValue(TRUSTED_AND_RESTRICTED);
    ssoGovernsSpy.mockResolvedValue(true);

    await UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
      globalSsoTokenData: decodeToken(
        mintGlobalToken({
          userId,
          providerId,
          providerType: SsoProviderType.GlobalSSO,
        }),
      ),
      projectId,
    });

    expect(ssoTrustSpy).toHaveBeenCalledTimes(1);
    expect(ssoTrustSpy.mock.calls[0]?.[0]?.toString()).toBe(
      providerId.toString(),
    );

    expect(ssoGovernsSpy).toHaveBeenCalledTimes(1);
    expect(ssoGovernsSpy.mock.calls[0]?.[0]?.globalSsoId.toString()).toBe(
      providerId.toString(),
    );
    expect(ssoGovernsSpy.mock.calls[0]?.[0]?.projectId.toString()).toBe(
      projectId.toString(),
    );
  });

  test("OIDC: the token's provider id and the request's project id are the ones queried", async () => {
    oidcTrustSpy.mockResolvedValue(TRUSTED_AND_RESTRICTED);
    oidcGovernsSpy.mockResolvedValue(true);

    await UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
      globalSsoTokenData: decodeToken(
        mintGlobalToken({
          userId,
          providerId,
          providerType: SsoProviderType.GlobalOIDC,
        }),
      ),
      projectId,
    });

    expect(oidcTrustSpy.mock.calls[0]?.[0]?.toString()).toBe(
      providerId.toString(),
    );
    expect(oidcGovernsSpy.mock.calls[0]?.[0]?.globalOidcId.toString()).toBe(
      providerId.toString(),
    );
    expect(oidcGovernsSpy.mock.calls[0]?.[0]?.projectId.toString()).toBe(
      projectId.toString(),
    );
  });

  test("each project in a multi-project fan-out is queried with its OWN id", async () => {
    ssoTrustSpy.mockResolvedValue(TRUSTED_AND_RESTRICTED);
    ssoGovernsSpy.mockResolvedValue(true);

    const projectA: ObjectID = ObjectID.generate();
    const projectB: ObjectID = ObjectID.generate();

    const tokenData: JSONWebTokenData = decodeToken(
      mintGlobalToken({
        userId,
        providerId,
        providerType: SsoProviderType.GlobalSSO,
      }),
    );

    await UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
      globalSsoTokenData: tokenData,
      projectId: projectA,
    });
    await UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
      globalSsoTokenData: tokenData,
      projectId: projectB,
    });

    expect(ssoGovernsSpy.mock.calls[0]?.[0]?.projectId.toString()).toBe(
      projectA.toString(),
    );
    expect(ssoGovernsSpy.mock.calls[1]?.[0]?.projectId.toString()).toBe(
      projectB.toString(),
    );
  });
});

/*
 * "This provider is not allowed here" and "we could not find out" are
 * different answers, and the code must not conflate them.
 *
 * If a failed lookup were caught and turned into `false`, a database blip - a
 * dropped connection, a statement timeout, a failover - would look exactly
 * like a deliberate permission decision. On the multi-tenant permission path
 * that means the request still succeeds, with 200 and an empty permission
 * set: the UI silently loses every button instead of showing an error, and
 * nothing in the logs distinguishes it from a correctly-revoked user. Letting
 * it throw turns an infrastructure fault into an infrastructure-shaped
 * failure that alerts, retries, and gets fixed.
 */
describe("isGlobalSsoTokenAuthorizedForProject - a failed lookup THROWS, it does not deny", () => {
  const projectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const providerId: ObjectID = ObjectID.generate();

  const samlTokenData: () => JSONWebTokenData = (): JSONWebTokenData => {
    return decodeToken(
      mintGlobalToken({
        userId,
        providerId,
        providerType: SsoProviderType.GlobalSSO,
      }),
    );
  };

  const buildGlobalRequest: (
    providerType: SsoProviderType,
  ) => ExpressRequest = (providerType: SsoProviderType): ExpressRequest => {
    return buildRequest({
      globalToken: mintGlobalToken({ userId, providerId, providerType }),
    });
  };

  test("SAML trust lookup rejects -> the decision rejects rather than resolving false", async () => {
    ssoTrustSpy.mockRejectedValue(new Error("connection terminated"));

    await expect(
      UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
        globalSsoTokenData: samlTokenData(),
        projectId,
      }),
    ).rejects.toThrow("connection terminated");

    /*
     * And the same lookup succeeding is a plain "allowed" - so the rejection
     * above is about the failure and nothing else.
     */
    ssoTrustSpy.mockResolvedValue(TRUSTED_AND_UNRESTRICTED);

    await expect(
      UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
        globalSsoTokenData: samlTokenData(),
        projectId,
      }),
    ).resolves.toBe(true);
  });

  test("OIDC trust lookup rejects -> the decision rejects rather than resolving false", async () => {
    oidcTrustSpy.mockRejectedValue(new Error("statement timeout"));

    await expect(
      UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
        globalSsoTokenData: decodeToken(
          mintGlobalToken({
            userId,
            providerId,
            providerType: SsoProviderType.GlobalOIDC,
          }),
        ),
        projectId,
      }),
    ).rejects.toThrow("statement timeout");
  });

  test("governance lookup rejects under restrict-on -> the decision rejects", async () => {
    ssoTrustSpy.mockResolvedValue(TRUSTED_AND_RESTRICTED);
    ssoGovernsSpy.mockRejectedValue(new Error("attachment read failed"));

    await expect(
      UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
        globalSsoTokenData: samlTokenData(),
        projectId,
      }),
    ).rejects.toThrow("attachment read failed");

    // Same restrict-on setup, lookup healthy -> allowed.
    ssoGovernsSpy.mockResolvedValue(true);

    await expect(
      UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
        globalSsoTokenData: samlTokenData(),
        projectId,
      }),
    ).resolves.toBe(true);
  });

  test("OIDC governance lookup rejects under restrict-on -> the decision rejects", async () => {
    oidcTrustSpy.mockResolvedValue(TRUSTED_AND_RESTRICTED);
    oidcGovernsSpy.mockRejectedValue(new Error("oidc attachment read failed"));

    await expect(
      UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
        globalSsoTokenData: decodeToken(
          mintGlobalToken({
            userId,
            providerId,
            providerType: SsoProviderType.GlobalOIDC,
          }),
        ),
        projectId,
      }),
    ).rejects.toThrow("oidc attachment read failed");
  });

  test("the enforcement entry point propagates the failure instead of denying", async () => {
    const req: ExpressRequest = buildGlobalRequest(SsoProviderType.GlobalSSO);

    ssoTrustSpy.mockRejectedValue(new Error("connection terminated"));

    await expect(
      UserMiddleware.isSsoSatisfiedForProject({ req, projectId, userId }),
    ).rejects.toThrow("connection terminated");

    ssoTrustSpy.mockResolvedValue(TRUSTED_AND_UNRESTRICTED);

    await expect(
      UserMiddleware.isSsoSatisfiedForProject({ req, projectId, userId }),
    ).resolves.toBe(true);
  });

  test("the enforcement entry point propagates a failed governance lookup too", async () => {
    const req: ExpressRequest = buildGlobalRequest(SsoProviderType.GlobalSSO);

    ssoTrustSpy.mockResolvedValue(TRUSTED_AND_RESTRICTED);
    ssoGovernsSpy.mockRejectedValue(new Error("attachment read failed"));

    await expect(
      UserMiddleware.isSsoSatisfiedForProject({ req, projectId, userId }),
    ).rejects.toThrow("attachment read failed");
  });
});

/*
 * A Global-typed token with no `ssoProviderId` cannot be checked against
 * either question, so it cannot be trusted for a project. That is a DECISION -
 * `false` - not a failure. It must not throw, and it must not spend a query
 * finding out, because the answer is fully determined by the token.
 */
describe("isGlobalSsoTokenAuthorizedForProject - a token with no provider id", () => {
  const projectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const providerId: ObjectID = ObjectID.generate();

  const mintProviderlessGlobalToken: () => string = (): string => {
    return JSONWebToken.sign({
      data: {
        userId: userId,
        name: new Name("Global SSO User"),
        email: new Email("global-sso@oneuptime.com"),
        isMasterAdmin: false,
        isGeneralLogin: false,
        // No ssoProviderId at all - the shape a pre-discriminator token had.
        ssoProviderType: SsoProviderType.GlobalSSO.toString(),
      },
      expiresInSeconds: THIRTY_DAYS_IN_SECONDS,
    });
  };

  test("the fixture really is a Global token with no provider id", () => {
    const decoded: JSONWebTokenData = decodeToken(
      mintProviderlessGlobalToken(),
    );

    expect(decoded.ssoProviderType).toBe(SsoProviderType.GlobalSSO);
    expect(decoded.ssoProviderId).toBeUndefined();
  });

  test("resolves false, and never touches the database", async () => {
    await expect(
      UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
        globalSsoTokenData: decodeToken(mintProviderlessGlobalToken()),
        projectId,
      }),
    ).resolves.toBe(false);

    expectNoDatabaseLookups();
  });

  test("the same token WITH a provider id is allowed - the refusal is about the missing id", async () => {
    ssoTrustSpy.mockResolvedValue(TRUSTED_AND_UNRESTRICTED);

    await expect(
      UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
        globalSsoTokenData: decodeToken(
          mintGlobalToken({
            userId,
            providerId,
            providerType: SsoProviderType.GlobalSSO,
          }),
        ),
        projectId,
      }),
    ).resolves.toBe(true);

    expect(ssoTrustSpy).toHaveBeenCalledTimes(1);
  });

  test("through the enforcement entry point: refused, with no database lookups", async () => {
    const req: ExpressRequest = buildRequest({
      globalToken: mintProviderlessGlobalToken(),
    });

    await expect(
      UserMiddleware.isSsoSatisfiedForProject({ req, projectId, userId }),
    ).resolves.toBe(false);

    expectNoDatabaseLookups();
  });
});

/*
 * A per-project SSO token is bound to one project by a login that already
 * proved the project's own provider trusts this user. It is decided
 * statelessly and short-circuits the whole stateful path - which is what
 * keeps a project-SSO-only installation from paying for Global SSO queries it
 * has no use for.
 */
describe("isSsoSatisfiedForProject - the per-project token short-circuits", () => {
  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const providerId: ObjectID = ObjectID.generate();

  test("a valid ProjectSSO token for THIS project -> true, with no global lookups", async () => {
    // Rigged so any fall-through to the global path would refuse.
    ssoTrustSpy.mockResolvedValue(REVOKED);
    oidcTrustSpy.mockResolvedValue(REVOKED);

    const req: ExpressRequest = buildRequest({
      projectTokens: [
        {
          projectId,
          token: mintProjectToken({
            userId,
            projectId,
            providerId,
            providerType: SsoProviderType.ProjectSSO,
          }),
        },
      ],
    });

    await expect(
      UserMiddleware.isSsoSatisfiedForProject({ req, projectId, userId }),
    ).resolves.toBe(true);

    expectNoDatabaseLookups();
  });

  test("a valid ProjectOIDC token for THIS project -> true, with no global lookups", async () => {
    ssoTrustSpy.mockResolvedValue(REVOKED);
    oidcTrustSpy.mockResolvedValue(REVOKED);

    const req: ExpressRequest = buildRequest({
      projectTokens: [
        {
          projectId,
          token: mintProjectToken({
            userId,
            projectId,
            providerId,
            providerType: SsoProviderType.ProjectOIDC,
          }),
        },
      ],
    });

    await expect(
      UserMiddleware.isSsoSatisfiedForProject({ req, projectId, userId }),
    ).resolves.toBe(true);

    expectNoDatabaseLookups();
  });

  test("a per-project token for a DIFFERENT project does not short-circuit - the global path decides", async () => {
    const req: ExpressRequest = buildRequest({
      globalToken: mintGlobalToken({
        userId,
        providerId,
        providerType: SsoProviderType.GlobalSSO,
      }),
      projectTokens: [
        {
          projectId: otherProjectId,
          token: mintProjectToken({
            userId,
            projectId: otherProjectId,
            providerId,
            providerType: SsoProviderType.ProjectSSO,
          }),
        },
      ],
    });

    /*
     * The global provider is disabled, so the unrelated project token must
     * not carry this request.
     */
    ssoTrustSpy.mockResolvedValue(REVOKED);

    await expect(
      UserMiddleware.isSsoSatisfiedForProject({ req, projectId, userId }),
    ).resolves.toBe(false);

    expect(ssoTrustSpy).toHaveBeenCalledTimes(1);

    // The project the token IS for still short-circuits, disabled or not.
    ssoTrustSpy.mockClear();

    await expect(
      UserMiddleware.isSsoSatisfiedForProject({
        req,
        projectId: otherProjectId,
        userId,
      }),
    ).resolves.toBe(true);

    expectNoDatabaseLookups();
  });

  test("with the global provider healthy, the other project is satisfied by the global token", async () => {
    const req: ExpressRequest = buildRequest({
      globalToken: mintGlobalToken({
        userId,
        providerId,
        providerType: SsoProviderType.GlobalSSO,
      }),
      projectTokens: [
        {
          projectId: otherProjectId,
          token: mintProjectToken({
            userId,
            projectId: otherProjectId,
            providerId,
            providerType: SsoProviderType.ProjectSSO,
          }),
        },
      ],
    });

    ssoTrustSpy.mockResolvedValue(TRUSTED_AND_UNRESTRICTED);

    await expect(
      UserMiddleware.isSsoSatisfiedForProject({ req, projectId, userId }),
    ).resolves.toBe(true);

    expect(ssoTrustSpy).toHaveBeenCalledTimes(1);
  });
});

/*
 * THE UPGRADE HAZARD.
 *
 * Before the single-token redesign the Global SSO router minted one
 * per-project token PER PROJECT, typed GlobalSSO/GlobalOIDC and signed for 30
 * days. Those are still sitting in browsers as `sso-<projectId>` cookies and
 * in the mobile app's AsyncStorage, replayed on every request. If the
 * per-project slot accepted them they would short-circuit past the
 * provider-trust check - so an admin disabling a provider would still not
 * revoke them, for up to a month. The slot refuses them by TYPE, which sends
 * the user through a fresh global login that mints a properly-typed token.
 */
describe("isSsoSatisfiedForProject - a legacy Global-typed token in the per-project slot", () => {
  const projectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const providerId: ObjectID = ObjectID.generate();

  const buildLegacyRequest: (data: {
    projectSlotType: SsoProviderType;
    alsoInGlobalSlot: boolean;
  }) => ExpressRequest = (data: {
    projectSlotType: SsoProviderType;
    alsoInGlobalSlot: boolean;
  }): ExpressRequest => {
    return buildRequest({
      globalToken: data.alsoInGlobalSlot
        ? mintGlobalToken({
            userId,
            providerId,
            providerType: SsoProviderType.GlobalSSO,
          })
        : undefined,
      projectTokens: [
        {
          projectId,
          token: mintProjectToken({
            userId,
            projectId,
            providerId,
            providerType: data.projectSlotType,
          }),
        },
      ],
    });
  };

  test("with the provider disabled, the legacy GlobalSSO-typed token no longer buys 30 days of access", async () => {
    ssoTrustSpy.mockResolvedValue(REVOKED);

    await expect(
      UserMiddleware.isSsoSatisfiedForProject({
        req: buildLegacyRequest({
          projectSlotType: SsoProviderType.GlobalSSO,
          alsoInGlobalSlot: true,
        }),
        projectId,
        userId,
      }),
    ).resolves.toBe(false);

    // It really did go through the stateful path rather than being dropped.
    expect(ssoTrustSpy).toHaveBeenCalledTimes(1);
  });

  test("the SAME request with the project-slot token typed ProjectSSO short-circuits and is allowed", async () => {
    /*
     * The pairing that keeps the test above honest: a blanket-deny
     * implementation would fail here. A properly project-typed token is a
     * project login, decided statelessly, so the disabled GLOBAL provider is
     * irrelevant to it.
     */
    ssoTrustSpy.mockResolvedValue(REVOKED);

    await expect(
      UserMiddleware.isSsoSatisfiedForProject({
        req: buildLegacyRequest({
          projectSlotType: SsoProviderType.ProjectSSO,
          alsoInGlobalSlot: true,
        }),
        projectId,
        userId,
      }),
    ).resolves.toBe(true);

    expectNoDatabaseLookups();
  });

  test("a legacy GlobalOIDC-typed token in the project slot is refused the same way", async () => {
    oidcTrustSpy.mockResolvedValue(REVOKED);

    const req: ExpressRequest = buildRequest({
      globalToken: mintGlobalToken({
        userId,
        providerId,
        providerType: SsoProviderType.GlobalOIDC,
      }),
      projectTokens: [
        {
          projectId,
          token: mintProjectToken({
            userId,
            projectId,
            providerId,
            providerType: SsoProviderType.GlobalOIDC,
          }),
        },
      ],
    });

    await expect(
      UserMiddleware.isSsoSatisfiedForProject({ req, projectId, userId }),
    ).resolves.toBe(false);

    expect(oidcTrustSpy).toHaveBeenCalledTimes(1);
  });

  test("a legacy Global-typed token ALONE in the project slot is not a credential at all", async () => {
    // Provider perfectly healthy - the refusal is about the slot and type.
    ssoTrustSpy.mockResolvedValue(TRUSTED_AND_UNRESTRICTED);

    await expect(
      UserMiddleware.isSsoSatisfiedForProject({
        req: buildLegacyRequest({
          projectSlotType: SsoProviderType.GlobalSSO,
          alsoInGlobalSlot: false,
        }),
        projectId,
        userId,
      }),
    ).resolves.toBe(false);

    // There was no global token to check, so nothing was looked up.
    expectNoDatabaseLookups();
  });

  test("moving that same credential into the global slot makes it work again", async () => {
    ssoTrustSpy.mockResolvedValue(TRUSTED_AND_UNRESTRICTED);

    await expect(
      UserMiddleware.isSsoSatisfiedForProject({
        req: buildRequest({
          globalToken: mintGlobalToken({
            userId,
            providerId,
            providerType: SsoProviderType.GlobalSSO,
          }),
        }),
        projectId,
        userId,
      }),
    ).resolves.toBe(true);

    expect(ssoTrustSpy).toHaveBeenCalledTimes(1);
  });
});

/*
 * Every stateless gate must be decided BEFORE the database is consulted. Two
 * reasons: a forged or expired token should never cost a query (this path runs
 * on every authenticated request), and a lookup that ran first would make the
 * request's fate depend on database health for tokens that were never valid
 * in the first place.
 */
describe("isSsoSatisfiedForProject - stateless gates run before the database", () => {
  const projectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const providerId: ObjectID = ObjectID.generate();

  const validGlobalToken: () => string = (): string => {
    return mintGlobalToken({
      userId,
      providerId,
      providerType: SsoProviderType.GlobalSSO,
    });
  };

  test("no token at all -> false, no lookups", async () => {
    await expect(
      UserMiddleware.isSsoSatisfiedForProject({
        req: buildRequest({}),
        projectId,
        userId,
      }),
    ).resolves.toBe(false);

    expectNoDatabaseLookups();
  });

  test("a token belonging to a DIFFERENT user -> false, no lookups", async () => {
    const req: ExpressRequest = buildRequest({
      globalToken: validGlobalToken(),
    });
    const otherUserId: ObjectID = ObjectID.generate();

    await expect(
      UserMiddleware.isSsoSatisfiedForProject({
        req,
        projectId,
        userId: otherUserId,
      }),
    ).resolves.toBe(false);

    expectNoDatabaseLookups();

    // The user it was minted for still gets in, via the stateful path.
    await expect(
      UserMiddleware.isSsoSatisfiedForProject({ req, projectId, userId }),
    ).resolves.toBe(true);

    expect(ssoTrustSpy).toHaveBeenCalledTimes(1);
  });

  test("an expired token -> false, no lookups", async () => {
    const expiredToken: string = JSONWebToken.sign({
      data: {
        userId: userId,
        name: new Name("Global SSO User"),
        email: new Email("global-sso@oneuptime.com"),
        isMasterAdmin: false,
        isGeneralLogin: false,
        ssoProviderId: providerId.toString(),
        ssoProviderType: SsoProviderType.GlobalSSO.toString(),
      },
      expiresInSeconds: -60,
    });

    await expect(
      UserMiddleware.isSsoSatisfiedForProject({
        req: buildRequest({ globalToken: expiredToken }),
        projectId,
        userId,
      }),
    ).resolves.toBe(false);

    expectNoDatabaseLookups();

    // The identical payload, unexpired, is allowed.
    await expect(
      UserMiddleware.isSsoSatisfiedForProject({
        req: buildRequest({ globalToken: validGlobalToken() }),
        projectId,
        userId,
      }),
    ).resolves.toBe(true);
  });

  test("a token whose payload was edited after signing -> false, no lookups", async () => {
    const genuine: string = validGlobalToken();
    const parts: Array<string> = genuine.split(".");

    const payload: Record<string, unknown> = JSON.parse(
      Buffer.from(parts[1] as string, "base64url").toString("utf8"),
    ) as Record<string, unknown>;

    // Re-point the token at a provider the attacker would rather use.
    payload["ssoProviderId"] = ObjectID.generate().toString();

    const forged: string = `${parts[0]}.${Buffer.from(
      JSON.stringify(payload),
      "utf8",
    ).toString("base64url")}.${parts[2]}`;

    await expect(
      UserMiddleware.isSsoSatisfiedForProject({
        req: buildRequest({ globalToken: forged }),
        projectId,
        userId,
      }),
    ).resolves.toBe(false);

    expectNoDatabaseLookups();

    // The untampered token is allowed, so the refusal is about the edit.
    await expect(
      UserMiddleware.isSsoSatisfiedForProject({
        req: buildRequest({ globalToken: genuine }),
        projectId,
        userId,
      }),
    ).resolves.toBe(true);
  });

  test("a project pinned to a DIFFERENT provider -> false, no lookups", async () => {
    const req: ExpressRequest = buildRequest({
      globalToken: validGlobalToken(),
    });
    const requiredProviderId: ObjectID = ObjectID.generate();

    await expect(
      UserMiddleware.isSsoSatisfiedForProject({
        req,
        projectId,
        userId,
        requiredSsoProviderId: requiredProviderId,
      }),
    ).resolves.toBe(false);

    expectNoDatabaseLookups();

    // Pinned to the provider the token actually carries -> allowed.
    await expect(
      UserMiddleware.isSsoSatisfiedForProject({
        req,
        projectId,
        userId,
        requiredSsoProviderId: providerId,
      }),
    ).resolves.toBe(true);

    expect(ssoTrustSpy).toHaveBeenCalledTimes(1);
  });

  test("a project-typed token sitting in the global slot -> false, no lookups", async () => {
    const req: ExpressRequest = buildRequest({
      globalToken: mintProjectToken({
        userId,
        projectId,
        providerId,
        providerType: SsoProviderType.ProjectSSO,
      }),
    });

    await expect(
      UserMiddleware.isSsoSatisfiedForProject({ req, projectId, userId }),
    ).resolves.toBe(false);

    expectNoDatabaseLookups();
  });
});

/*
 * `doesSsoTokenForProjectExist` is the STATELESS half only. It is kept for the
 * existing suites and for callers that just want to know whether a credential
 * is present and well-formed - it is NOT enforcement, and this test exists so
 * that anyone tempted to wire a middleware back to it sees the divergence
 * spelled out: it answers "yes" for a token whose provider an admin revoked
 * an hour ago.
 */
describe("doesSsoTokenForProjectExist is NOT the enforcement entry point", () => {
  const projectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const providerId: ObjectID = ObjectID.generate();

  test("the sync check says yes where the enforcement check refuses (disabled provider)", async () => {
    const req: ExpressRequest = buildRequest({
      globalToken: mintGlobalToken({
        userId,
        providerId,
        providerType: SsoProviderType.GlobalSSO,
      }),
    });

    ssoTrustSpy.mockResolvedValue(REVOKED);

    // Stateless: the token is genuine, unexpired, and for this user.
    expect(
      UserMiddleware.doesSsoTokenForProjectExist(req, projectId, userId),
    ).toBe(true);

    // Stateful: the provider behind it is gone, so the request is refused.
    await expect(
      UserMiddleware.isSsoSatisfiedForProject({ req, projectId, userId }),
    ).resolves.toBe(false);
  });

  test("the sync check says yes where the enforcement check refuses (restrict-on, unattached project)", async () => {
    const req: ExpressRequest = buildRequest({
      globalToken: mintGlobalToken({
        userId,
        providerId,
        providerType: SsoProviderType.GlobalSSO,
      }),
    });

    ssoTrustSpy.mockResolvedValue(TRUSTED_AND_RESTRICTED);
    ssoGovernsSpy.mockResolvedValue(false);

    expect(
      UserMiddleware.doesSsoTokenForProjectExist(req, projectId, userId),
    ).toBe(true);

    await expect(
      UserMiddleware.isSsoSatisfiedForProject({ req, projectId, userId }),
    ).resolves.toBe(false);
  });

  test("the two agree whenever the provider is healthy - the divergence is only about revocation", async () => {
    const req: ExpressRequest = buildRequest({
      globalToken: mintGlobalToken({
        userId,
        providerId,
        providerType: SsoProviderType.GlobalSSO,
      }),
    });

    ssoTrustSpy.mockResolvedValue(TRUSTED_AND_UNRESTRICTED);

    expect(
      UserMiddleware.doesSsoTokenForProjectExist(req, projectId, userId),
    ).toBe(true);

    await expect(
      UserMiddleware.isSsoSatisfiedForProject({ req, projectId, userId }),
    ).resolves.toBe(true);
  });
});
