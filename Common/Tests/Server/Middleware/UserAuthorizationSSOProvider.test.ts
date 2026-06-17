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

  // Build a request whose cookies carry a real `sso-<projectId>` token.
  const buildRequestWithSsoToken: (data: {
    tokenProjectId: ObjectID;
    discriminatorProviderId?: ObjectID | undefined;
  }) => ExpressRequest = (data: {
    tokenProjectId: ObjectID;
    discriminatorProviderId?: ObjectID | undefined;
  }): ExpressRequest => {
    const token: string = CookieUtil.getSSOToken({
      user: buildUser(),
      projectId: data.tokenProjectId,
      ssoProviderId: data.discriminatorProviderId,
      ssoProviderType: data.discriminatorProviderId
        ? SsoProviderType.GlobalSSO
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
