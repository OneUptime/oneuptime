import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import CookieUtil from "../../../Server/Utils/Cookie";
import { ExpressRequest } from "../../../Server/Utils/Express";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import User from "../../../Models/DatabaseModels/User";
import { describe, expect, test, jest } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * Tests for UserMiddleware.doesSsoTokenForProjectExist's `requiredSsoProviderId`
 * param. When provided, an SSO token only satisfies the project if it ALSO
 * carries a matching `ssoProviderId` discriminator. Legacy tokens (no
 * discriminator) must pass when no provider is required but fail a
 * specific-provider requirement.
 *
 * These use REAL tokens minted by CookieUtil.getSSOToken and the REAL
 * JSONWebToken.decode() path (no mocking) so they verify the full production
 * wiring end to end — including that decode() surfaces ssoProviderId.
 */
describe("UserMiddleware.doesSsoTokenForProjectExist - requiredSsoProviderId", () => {
  const projectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const ssoProviderId: ObjectID = ObjectID.generate();
  const otherProviderId: ObjectID = ObjectID.generate();

  const buildUser: () => User = (): User => {
    const u: User = new User();
    u.id = userId;
    u.email = new Email("sso-user@oneuptime.com");
    return u;
  };

  /*
   * Build a request whose cookies carry a real `sso-<projectId>` token.
   *
   * The type defaults to ProjectSSO because that is what a PROJECT SSO login
   * actually mints, and the project-scoped slot now refuses Global-typed
   * credentials outright - see the "legacy Global-typed token" block below for
   * why, and for the tests that pin it.
   */
  const buildRequestWithSsoToken: (data: {
    tokenProjectId: ObjectID;
    discriminatorProviderId?: ObjectID | undefined;
    ssoProviderType?: SsoProviderType | undefined;
  }) => ExpressRequest = (data: {
    tokenProjectId: ObjectID;
    discriminatorProviderId?: ObjectID | undefined;
    ssoProviderType?: SsoProviderType | undefined;
  }): ExpressRequest => {
    const token: string = CookieUtil.getSSOToken({
      user: buildUser(),
      projectId: data.tokenProjectId,
      ssoProviderId: data.discriminatorProviderId,
      ssoProviderType: data.discriminatorProviderId
        ? data.ssoProviderType || SsoProviderType.ProjectSSO
        : undefined,
    });

    return {
      cookies: {
        [CookieUtil.getUserSSOKey(data.tokenProjectId)]: token,
      },
      headers: {},
    } as unknown as ExpressRequest;
  };

  test("matching project+user, NO requiredProviderId -> true", () => {
    const req: ExpressRequest = buildRequestWithSsoToken({
      tokenProjectId: projectId,
      discriminatorProviderId: ssoProviderId,
    });

    expect(
      UserMiddleware.doesSsoTokenForProjectExist(req, projectId, userId),
    ).toBe(true);
  });

  test("matching project+user, requiredProviderId EQUALS token's ssoProviderId -> true", () => {
    const req: ExpressRequest = buildRequestWithSsoToken({
      tokenProjectId: projectId,
      discriminatorProviderId: ssoProviderId,
    });

    expect(
      UserMiddleware.doesSsoTokenForProjectExist(
        req,
        projectId,
        userId,
        ssoProviderId,
      ),
    ).toBe(true);
  });

  test("matching project+user, requiredProviderId DIFFERENT from token's ssoProviderId -> false", () => {
    const req: ExpressRequest = buildRequestWithSsoToken({
      tokenProjectId: projectId,
      discriminatorProviderId: ssoProviderId,
    });

    expect(
      UserMiddleware.doesSsoTokenForProjectExist(
        req,
        projectId,
        userId,
        otherProviderId,
      ),
    ).toBe(false);
  });

  test("legacy token (NO discriminator) + requiredProviderId given -> false", () => {
    const req: ExpressRequest = buildRequestWithSsoToken({
      tokenProjectId: projectId,
      // no discriminatorProviderId -> legacy token shape
    });

    expect(
      UserMiddleware.doesSsoTokenForProjectExist(
        req,
        projectId,
        userId,
        ssoProviderId,
      ),
    ).toBe(false);
  });

  test("legacy token (NO discriminator) + NO requiredProviderId -> true (backwards compatible)", () => {
    const req: ExpressRequest = buildRequestWithSsoToken({
      tokenProjectId: projectId,
    });

    expect(
      UserMiddleware.doesSsoTokenForProjectExist(req, projectId, userId),
    ).toBe(true);
  });

  test("wrong userId -> false (even with matching provider)", () => {
    const req: ExpressRequest = buildRequestWithSsoToken({
      tokenProjectId: projectId,
      discriminatorProviderId: ssoProviderId,
    });

    const differentUserId: ObjectID = ObjectID.generate();

    expect(
      UserMiddleware.doesSsoTokenForProjectExist(
        req,
        projectId,
        differentUserId,
        ssoProviderId,
      ),
    ).toBe(false);
  });

  test("no sso cookie for the project -> false", () => {
    const req: ExpressRequest = {
      cookies: {},
      headers: {},
    } as unknown as ExpressRequest;

    expect(
      UserMiddleware.doesSsoTokenForProjectExist(
        req,
        projectId,
        userId,
        ssoProviderId,
      ),
    ).toBe(false);
  });
});

/*
 * A single Global SSO token (minted by a Global SSO/OIDC login) is NOT bound to
 * a project: it satisfies SSO enforcement for ANY project the user belongs to,
 * including projects created after login. It still carries the provider
 * discriminator so a project pinned to a specific provider is only satisfied by
 * a matching token. The token is sourced from the `global-sso-token` cookie
 * (web) or the `x-global-sso-token` header (mobile).
 */
/*
 * A Global-typed credential must never be accepted from the per-project slot.
 *
 * Before the single-token redesign, the Global SSO router fanned out one
 * per-project `sso-<projectId>` cookie per project the user belonged to, typed
 * GlobalSSO and signed for 30 days. Those are still in browsers, and the
 * mobile app still replays every non-expired stored token as `x-sso-tokens`.
 * If the project slot accepted them, they would short-circuit past the
 * provider-trust check - so disabling a provider would still not revoke them,
 * for up to a month. They are refused here instead, which sends the user
 * through a fresh global login that mints a properly-typed token.
 */
describe("UserMiddleware.doesSsoTokenForProjectExist - legacy Global-typed token in the project slot", () => {
  const legacyProjectId: ObjectID = ObjectID.generate();
  const legacyUserId: ObjectID = ObjectID.generate();
  const legacyProviderId: ObjectID = ObjectID.generate();

  const buildLegacyRequest: (
    ssoProviderType: SsoProviderType,
  ) => ExpressRequest = (ssoProviderType: SsoProviderType): ExpressRequest => {
    const user: User = new User();
    user.id = legacyUserId;
    user.email = new Email("legacy-sso-user@oneuptime.com");

    const token: string = CookieUtil.getSSOToken({
      user,
      projectId: legacyProjectId,
      ssoProviderId: legacyProviderId,
      ssoProviderType,
    });

    return {
      cookies: {
        [CookieUtil.getUserSSOKey(legacyProjectId)]: token,
      },
      headers: {},
    } as unknown as ExpressRequest;
  };

  test("a GlobalSSO-typed token in the project slot is refused", () => {
    expect(
      UserMiddleware.doesSsoTokenForProjectExist(
        buildLegacyRequest(SsoProviderType.GlobalSSO),
        legacyProjectId,
        legacyUserId,
      ),
    ).toBe(false);
  });

  test("a GlobalOIDC-typed token in the project slot is refused", () => {
    expect(
      UserMiddleware.doesSsoTokenForProjectExist(
        buildLegacyRequest(SsoProviderType.GlobalOIDC),
        legacyProjectId,
        legacyUserId,
      ),
    ).toBe(false);
  });

  test("the SAME token typed ProjectSSO is accepted, so the refusal is about the type and nothing else", () => {
    expect(
      UserMiddleware.doesSsoTokenForProjectExist(
        buildLegacyRequest(SsoProviderType.ProjectSSO),
        legacyProjectId,
        legacyUserId,
      ),
    ).toBe(true);
  });

  test("a ProjectOIDC-typed token in the project slot is accepted", () => {
    expect(
      UserMiddleware.doesSsoTokenForProjectExist(
        buildLegacyRequest(SsoProviderType.ProjectOIDC),
        legacyProjectId,
        legacyUserId,
      ),
    ).toBe(true);
  });
});

describe("UserMiddleware.doesSsoTokenForProjectExist - global SSO token", () => {
  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const globalProviderId: ObjectID = ObjectID.generate();
  const otherProviderId: ObjectID = ObjectID.generate();

  const buildUser: () => User = (): User => {
    const u: User = new User();
    u.id = userId;
    u.email = new Email("global-sso-user@oneuptime.com");
    return u;
  };

  const buildRequestWithGlobalToken: (data: {
    providerType: SsoProviderType;
    providerId?: ObjectID;
    viaHeader?: boolean;
  }) => ExpressRequest = (data: {
    providerType: SsoProviderType;
    providerId?: ObjectID;
    viaHeader?: boolean;
  }): ExpressRequest => {
    const token: string = CookieUtil.getGlobalSSOToken({
      user: buildUser(),
      ssoProviderId: data.providerId ?? globalProviderId,
      ssoProviderType: data.providerType,
    });

    if (data.viaHeader) {
      return {
        cookies: {},
        headers: { "x-global-sso-token": token },
      } as unknown as ExpressRequest;
    }

    return {
      cookies: { [CookieUtil.getGlobalSSOKey()]: token },
      headers: {},
    } as unknown as ExpressRequest;
  };

  test("global token (cookie), NO requiredProviderId -> true", () => {
    const req: ExpressRequest = buildRequestWithGlobalToken({
      providerType: SsoProviderType.GlobalSSO,
    });

    expect(
      UserMiddleware.doesSsoTokenForProjectExist(req, projectId, userId),
    ).toBe(true);
  });

  test("global token satisfies a project with NO per-project token (mid-session/new project) -> true", () => {
    const req: ExpressRequest = buildRequestWithGlobalToken({
      providerType: SsoProviderType.GlobalSSO,
    });

    // A different project the token was never minted for is still satisfied.
    expect(
      UserMiddleware.doesSsoTokenForProjectExist(req, otherProjectId, userId),
    ).toBe(true);
  });

  test("global token, requiredProviderId EQUALS token's provider -> true", () => {
    const req: ExpressRequest = buildRequestWithGlobalToken({
      providerType: SsoProviderType.GlobalOIDC,
      providerId: globalProviderId,
    });

    expect(
      UserMiddleware.doesSsoTokenForProjectExist(
        req,
        projectId,
        userId,
        globalProviderId,
      ),
    ).toBe(true);
  });

  test("global token, requiredProviderId DIFFERENT from token's provider -> false", () => {
    const req: ExpressRequest = buildRequestWithGlobalToken({
      providerType: SsoProviderType.GlobalSSO,
      providerId: globalProviderId,
    });

    expect(
      UserMiddleware.doesSsoTokenForProjectExist(
        req,
        projectId,
        userId,
        otherProviderId,
      ),
    ).toBe(false);
  });

  test("global token, wrong userId -> false", () => {
    const req: ExpressRequest = buildRequestWithGlobalToken({
      providerType: SsoProviderType.GlobalSSO,
    });

    const differentUserId: ObjectID = ObjectID.generate();

    expect(
      UserMiddleware.doesSsoTokenForProjectExist(
        req,
        projectId,
        differentUserId,
      ),
    ).toBe(false);
  });

  test("global token via x-global-sso-token header (mobile) -> true", () => {
    const req: ExpressRequest = buildRequestWithGlobalToken({
      providerType: SsoProviderType.GlobalSSO,
      viaHeader: true,
    });

    expect(
      UserMiddleware.doesSsoTokenForProjectExist(req, projectId, userId),
    ).toBe(true);
  });

  test("project-typed token in the global cookie slot is ignored -> false", () => {
    // Only Global provider types are accepted via the global-token path.
    const token: string = CookieUtil.getSSOToken({
      user: buildUser(),
      projectId: projectId,
      ssoProviderId: globalProviderId,
      ssoProviderType: SsoProviderType.ProjectSSO,
    });

    const req: ExpressRequest = {
      cookies: { [CookieUtil.getGlobalSSOKey()]: token },
      headers: {},
    } as unknown as ExpressRequest;

    // No per-project cookie (sso-<projectId>) is present, so this must fail.
    expect(
      UserMiddleware.doesSsoTokenForProjectExist(req, otherProjectId, userId),
    ).toBe(false);
  });
});
