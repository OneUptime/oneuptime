import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import CookieUtil from "../../../Server/Utils/Cookie";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import CookieName from "../../../Types/CookieName";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import User from "../../../Models/DatabaseModels/User";
import { describe, expect, jest, test } from "@jest/globals";
import jwt from "jsonwebtoken";

jest.mock("../../../Server/Utils/Logger");

/*
 * The Global SSO token is the credential a Global (instance-wide) SAML/OIDC
 * login mints. Unlike the per-project `sso-<projectId>` token it carries NO
 * project binding, which is exactly what lets one token satisfy SSO
 * enforcement for every project the user belongs to.
 *
 * These tests run REAL JWT signing and verification (no mocks). The JWT secret
 * falls back to EncryptionSecret = "secret" when ENCRYPTION_SECRET is unset
 * (see Common/Server/EnvironmentConfig.ts), so no env setup is required.
 *
 * The happy path of UserMiddleware.doesSsoTokenForProjectExist accepting a
 * global token from the `global-sso-token` cookie and from the
 * `x-global-sso-token` header already lives in
 * Common/Tests/Server/Middleware/UserAuthorizationSSOProvider.test.ts and is
 * deliberately not repeated here. What follows is the payload/TTL contract and
 * the rejection paths around it.
 */

const THIRTY_DAYS_IN_SECONDS: number = 30 * 24 * 60 * 60;
const THIRTY_DAYS_IN_MILLISECONDS: number = THIRTY_DAYS_IN_SECONDS * 1000;

const buildUser: (userId: ObjectID) => User = (userId: ObjectID): User => {
  const user: User = new User();
  user.id = userId;
  user.name = new Name("Global SSO User");
  user.email = new Email("global-sso@oneuptime.com");
  return user;
};

const buildCookieRequest: (token: string) => ExpressRequest = (
  token: string,
): ExpressRequest => {
  return {
    cookies: { [CookieUtil.getGlobalSSOKey()]: token },
    headers: {},
  } as unknown as ExpressRequest;
};

const buildHeaderRequest: (token: string) => ExpressRequest = (
  token: string,
): ExpressRequest => {
  return {
    cookies: {},
    headers: { "x-global-sso-token": token },
  } as unknown as ExpressRequest;
};

/*
 * Re-encodes a JWT's payload while keeping the ORIGINAL signature, which is
 * what an attacker editing a token in transit (or in their own browser) would
 * produce. The signature no longer covers the payload, so verification must
 * fail.
 */
const tamperWithPayload: (
  token: string,
  mutate: (payload: JSONObject) => void,
) => string = (
  token: string,
  mutate: (payload: JSONObject) => void,
): string => {
  const parts: Array<string> = token.split(".");

  const payload: JSONObject = JSON.parse(
    Buffer.from(parts[1] as string, "base64url").toString("utf8"),
  ) as JSONObject;

  mutate(payload);

  const rewrittenPayload: string = Buffer.from(
    JSON.stringify(payload),
    "utf8",
  ).toString("base64url");

  return `${parts[0]}.${rewrittenPayload}.${parts[2]}`;
};

describe("CookieUtil.getGlobalSSOToken - payload", () => {
  test("pins every claim the global token carries", () => {
    const userId: ObjectID = ObjectID.generate();
    const ssoProviderId: ObjectID = ObjectID.generate();
    const user: User = buildUser(userId);

    const token: string = CookieUtil.getGlobalSSOToken({
      user,
      ssoProviderId,
      ssoProviderType: SsoProviderType.GlobalSSO,
    });

    const payload: JSONObject = JSONWebToken.decodeJsonPayload(token);

    expect(payload["userId"]).toBe(userId.toString());
    expect(payload["name"]).toBe("Global SSO User");
    expect(payload["email"]).toBe("global-sso@oneuptime.com");
    expect(payload["isMasterAdmin"]).toBe(false);
    expect(payload["isGeneralLogin"]).toBe(false);
    expect(payload["ssoProviderId"]).toBe(ssoProviderId.toString());
    expect(payload["ssoProviderType"]).toBe(SsoProviderType.GlobalSSO);
  });

  test("carries NO projectId binding - that is what makes it global", () => {
    const userId: ObjectID = ObjectID.generate();
    const user: User = buildUser(userId);

    const token: string = CookieUtil.getGlobalSSOToken({
      user,
      ssoProviderId: ObjectID.generate(),
      ssoProviderType: SsoProviderType.GlobalOIDC,
    });

    /*
     * JSONWebToken.sign normalises an absent projectId to an empty string, so
     * assert on "no usable project id" rather than on strict absence. Either
     * way there is nothing on the wire that could scope this token to a
     * project.
     */
    const payload: JSONObject = JSONWebToken.decodeJsonPayload(token);
    expect(payload["projectId"] || undefined).toBeUndefined();

    // And the decoded view the middleware actually consumes has no project.
    const decoded: JSONWebTokenData = JSONWebToken.decode(token);
    expect(decoded.projectId).toBeUndefined();

    // Contrast: a per-project token DOES bind a project.
    const projectId: ObjectID = ObjectID.generate();
    const projectToken: string = CookieUtil.getSSOToken({
      user,
      projectId,
      ssoProviderId: ObjectID.generate(),
      ssoProviderType: SsoProviderType.ProjectSSO,
    });
    expect(JSONWebToken.decode(projectToken).projectId?.toString()).toBe(
      projectId.toString(),
    );
  });

  test("both Global provider types round-trip through the token", () => {
    const userId: ObjectID = ObjectID.generate();
    const user: User = buildUser(userId);

    const globalProviderTypes: Array<SsoProviderType> = [
      SsoProviderType.GlobalSSO,
      SsoProviderType.GlobalOIDC,
    ];

    for (const providerType of globalProviderTypes) {
      const ssoProviderId: ObjectID = ObjectID.generate();

      const token: string = CookieUtil.getGlobalSSOToken({
        user,
        ssoProviderId,
        ssoProviderType: providerType,
      });

      const decoded: JSONWebTokenData = JSONWebToken.decode(token);

      expect(decoded.ssoProviderType).toBe(providerType);
      expect(decoded.ssoProviderId?.toString()).toBe(ssoProviderId.toString());
      expect(decoded.userId.toString()).toBe(userId.toString());
    }
  });
});

/*
 * The mobile app decodes the `exp` claim of exactly this token
 * (MobileApp/src/utils/jwt.ts) to decide when to re-authenticate, so the TTL is
 * part of the contract and not just a server-side detail.
 */
describe("CookieUtil.getGlobalSSOToken - 30 day TTL", () => {
  test("exp is 30 days after iat", () => {
    const token: string = CookieUtil.getGlobalSSOToken({
      user: buildUser(ObjectID.generate()),
      ssoProviderId: ObjectID.generate(),
      ssoProviderType: SsoProviderType.GlobalSSO,
    });

    const payload: JSONObject = JSONWebToken.decodeJsonPayload(token);

    expect(typeof payload["iat"]).toBe("number");
    expect(typeof payload["exp"]).toBe("number");
    expect((payload["exp"] as number) - (payload["iat"] as number)).toBe(
      THIRTY_DAYS_IN_SECONDS,
    );
  });

  test("exp is ~30 days out from wall-clock now (within tolerance)", () => {
    const nowInSeconds: number = Math.floor(Date.now() / 1000);

    const token: string = CookieUtil.getGlobalSSOToken({
      user: buildUser(ObjectID.generate()),
      ssoProviderId: ObjectID.generate(),
      ssoProviderType: SsoProviderType.GlobalOIDC,
    });

    const payload: JSONObject = JSONWebToken.decodeJsonPayload(token);
    const expiresAt: number = payload["exp"] as number;

    const toleranceInSeconds: number = 60;

    expect(expiresAt).toBeGreaterThanOrEqual(
      nowInSeconds + THIRTY_DAYS_IN_SECONDS - toleranceInSeconds,
    );
    expect(expiresAt).toBeLessThanOrEqual(
      nowInSeconds + THIRTY_DAYS_IN_SECONDS + toleranceInSeconds,
    );
  });
});

describe("CookieUtil.setGlobalSSOCookie", () => {
  test("writes the token under CookieName.GlobalSSOToken, httpOnly, 30 day maxAge in ms", () => {
    const userId: ObjectID = ObjectID.generate();
    const ssoProviderId: ObjectID = ObjectID.generate();

    const cookieCalls: Array<Array<unknown>> = [];
    const res: ExpressResponse = {
      cookie: (...args: Array<unknown>): void => {
        cookieCalls.push(args);
      },
    } as unknown as ExpressResponse;

    CookieUtil.setGlobalSSOCookie({
      user: buildUser(userId),
      expressResponse: res,
      ssoProviderId,
      ssoProviderType: SsoProviderType.GlobalSSO,
    });

    expect(cookieCalls.length).toBe(1);

    const callArgs: Array<unknown> = cookieCalls[0] as Array<unknown>;

    expect(callArgs[0]).toBe(CookieName.GlobalSSOToken);
    expect(callArgs[0]).toBe("global-sso-token");

    expect(callArgs[2]).toEqual({
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      maxAge: THIRTY_DAYS_IN_MILLISECONDS,
    });

    // The value written is a real, verifiable global token for this user.
    const decoded: JSONWebTokenData = JSONWebToken.decode(
      callArgs[1] as string,
    );
    expect(decoded.userId.toString()).toBe(userId.toString());
    expect(decoded.ssoProviderId?.toString()).toBe(ssoProviderId.toString());
    expect(decoded.ssoProviderType).toBe(SsoProviderType.GlobalSSO);
    expect(decoded.projectId).toBeUndefined();
  });

  test("the global cookie name does not collide with the per-project sso- prefix", () => {
    /*
     * getSsoTokens() keys every cookie starting with `sso-` by the projectId
     * inside it. The global token has no projectId, so it must never be picked
     * up by that parser.
     */
    expect(CookieUtil.getGlobalSSOKey()).toBe(CookieName.GlobalSSOToken);
    expect(
      CookieUtil.getGlobalSSOKey().startsWith(CookieUtil.getSSOKey()),
    ).toBe(false);

    const token: string = CookieUtil.getGlobalSSOToken({
      user: buildUser(ObjectID.generate()),
      ssoProviderId: ObjectID.generate(),
      ssoProviderType: SsoProviderType.GlobalSSO,
    });

    expect(UserMiddleware.getSsoTokens(buildCookieRequest(token))).toEqual({});
  });
});

describe("UserMiddleware.doesSsoTokenForProjectExist - global token expiry", () => {
  const projectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const ssoProviderId: ObjectID = ObjectID.generate();

  const mintExpiredGlobalToken: () => string = (): string => {
    return JSONWebToken.sign({
      data: {
        userId: userId,
        name: new Name("Global SSO User"),
        email: new Email("global-sso@oneuptime.com"),
        isMasterAdmin: false,
        isGeneralLogin: false,
        ssoProviderId: ssoProviderId.toString(),
        ssoProviderType: SsoProviderType.GlobalSSO.toString(),
      },
      expiresInSeconds: -60,
    });
  };

  test("the minted token really is expired (guards the fixture itself)", () => {
    const payload: JSONObject = jwt.decode(
      mintExpiredGlobalToken(),
    ) as unknown as JSONObject;

    expect((payload["exp"] as number) * 1000).toBeLessThan(Date.now());
  });

  test("expired global token in the cookie -> false", () => {
    const req: ExpressRequest = buildCookieRequest(mintExpiredGlobalToken());

    expect(UserMiddleware.getGlobalSsoTokenData(req)).toBeNull();
    expect(
      UserMiddleware.doesSsoTokenForProjectExist(req, projectId, userId),
    ).toBe(false);
  });

  test("expired global token in the x-global-sso-token header (mobile) -> false", () => {
    const req: ExpressRequest = buildHeaderRequest(mintExpiredGlobalToken());

    expect(
      UserMiddleware.doesSsoTokenForProjectExist(req, projectId, userId),
    ).toBe(false);
  });
});

describe("UserMiddleware.doesSsoTokenForProjectExist - global token tampering", () => {
  const projectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const ssoProviderId: ObjectID = ObjectID.generate();

  const mintValidGlobalToken: () => string = (): string => {
    return CookieUtil.getGlobalSSOToken({
      user: buildUser(userId),
      ssoProviderId,
      ssoProviderType: SsoProviderType.GlobalSSO,
    });
  };

  test("payload edited to point at another user -> false", () => {
    const victimUserId: ObjectID = ObjectID.generate();

    const forged: string = tamperWithPayload(
      mintValidGlobalToken(),
      (payload: JSONObject): void => {
        payload["userId"] = victimUserId.toString();
      },
    );

    const req: ExpressRequest = buildCookieRequest(forged);

    expect(UserMiddleware.getGlobalSsoTokenData(req)).toBeNull();
    expect(
      UserMiddleware.doesSsoTokenForProjectExist(req, projectId, victimUserId),
    ).toBe(false);
    // The original owner does not get in with it either.
    expect(
      UserMiddleware.doesSsoTokenForProjectExist(req, projectId, userId),
    ).toBe(false);
  });

  test("payload edited to claim a different SSO provider -> false", () => {
    const requiredProviderId: ObjectID = ObjectID.generate();

    const forged: string = tamperWithPayload(
      mintValidGlobalToken(),
      (payload: JSONObject): void => {
        payload["ssoProviderId"] = requiredProviderId.toString();
      },
    );

    expect(
      UserMiddleware.doesSsoTokenForProjectExist(
        buildCookieRequest(forged),
        projectId,
        userId,
        requiredProviderId,
      ),
    ).toBe(false);
  });

  test("payload edited to stretch the expiry -> false", () => {
    const forged: string = tamperWithPayload(
      mintValidGlobalToken(),
      (payload: JSONObject): void => {
        payload["exp"] =
          Math.floor(Date.now() / 1000) + 10 * THIRTY_DAYS_IN_SECONDS;
      },
    );

    expect(
      UserMiddleware.doesSsoTokenForProjectExist(
        buildCookieRequest(forged),
        projectId,
        userId,
      ),
    ).toBe(false);
  });

  test("token signed with a different secret -> false", () => {
    const foreignToken: string = jwt.sign(
      {
        userId: userId.toString(),
        name: "Global SSO User",
        email: "global-sso@oneuptime.com",
        isMasterAdmin: false,
        isGeneralLogin: false,
        ssoProviderId: ssoProviderId.toString(),
        ssoProviderType: SsoProviderType.GlobalSSO,
      },
      `${EncryptionSecret.toString()}-not-the-real-secret`,
      { expiresIn: THIRTY_DAYS_IN_SECONDS },
    );

    // Sanity: the same payload signed with the real secret WOULD be accepted.
    expect(
      UserMiddleware.doesSsoTokenForProjectExist(
        buildCookieRequest(mintValidGlobalToken()),
        projectId,
        userId,
      ),
    ).toBe(true);

    expect(
      UserMiddleware.doesSsoTokenForProjectExist(
        buildCookieRequest(foreignToken),
        projectId,
        userId,
      ),
    ).toBe(false);
    expect(
      UserMiddleware.doesSsoTokenForProjectExist(
        buildHeaderRequest(foreignToken),
        projectId,
        userId,
      ),
    ).toBe(false);
  });

  test("syntactically broken tokens are rejected and do not throw out of the middleware", () => {
    const brokenTokens: Array<string> = [
      "not-a-jwt",
      "",
      "a.b.c",
      "eyJhbGciOiJIUzI1NiJ9..",
      `${mintValidGlobalToken()}-extra`,
    ];

    for (const brokenToken of brokenTokens) {
      for (const req of [
        buildCookieRequest(brokenToken),
        buildHeaderRequest(brokenToken),
      ]) {
        const evaluate: () => boolean = (): boolean => {
          return UserMiddleware.doesSsoTokenForProjectExist(
            req,
            projectId,
            userId,
          );
        };

        expect(evaluate).not.toThrow();
        expect(evaluate()).toBe(false);
      }
    }
  });
});

describe("UserMiddleware.doesSsoTokenForProjectExist - global slot type confusion", () => {
  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const ssoProviderId: ObjectID = ObjectID.generate();

  /*
   * UserAuthorizationSSOProvider.test.ts already covers a ProjectSSO-typed
   * token sitting in the global COOKIE slot. These cover the remaining
   * directions: the ProjectOIDC type, the mobile header slot, and a token with
   * no provider type at all.
   */

  test("ProjectOIDC-typed token in the global cookie slot is ignored -> false", () => {
    const token: string = CookieUtil.getSSOToken({
      user: buildUser(userId),
      projectId,
      ssoProviderId,
      ssoProviderType: SsoProviderType.ProjectOIDC,
    });

    const req: ExpressRequest = buildCookieRequest(token);

    expect(UserMiddleware.getGlobalSsoTokenData(req)).toBeNull();
    // otherProjectId has no per-project cookie, so only the global path could help.
    expect(
      UserMiddleware.doesSsoTokenForProjectExist(req, otherProjectId, userId),
    ).toBe(false);
  });

  test("project-typed token in the x-global-sso-token header is ignored -> false", () => {
    const token: string = CookieUtil.getSSOToken({
      user: buildUser(userId),
      projectId,
      ssoProviderId,
      ssoProviderType: SsoProviderType.ProjectSSO,
    });

    const req: ExpressRequest = buildHeaderRequest(token);

    expect(UserMiddleware.getGlobalSsoTokenData(req)).toBeNull();
    expect(
      UserMiddleware.doesSsoTokenForProjectExist(req, otherProjectId, userId),
    ).toBe(false);
  });

  test("token with NO ssoProviderType in the global slot is ignored -> false", () => {
    const token: string = JSONWebToken.sign({
      data: {
        userId: userId,
        name: new Name("Global SSO User"),
        email: new Email("global-sso@oneuptime.com"),
        isMasterAdmin: false,
        isGeneralLogin: false,
        ssoProviderId: ssoProviderId.toString(),
      },
      expiresInSeconds: THIRTY_DAYS_IN_SECONDS,
    });

    // The token itself verifies fine - it is the missing type that disqualifies it.
    expect(JSONWebToken.decode(token).ssoProviderType).toBeUndefined();

    for (const req of [buildCookieRequest(token), buildHeaderRequest(token)]) {
      expect(UserMiddleware.getGlobalSsoTokenData(req)).toBeNull();
      expect(
        UserMiddleware.doesSsoTokenForProjectExist(req, otherProjectId, userId),
      ).toBe(false);
    }
  });
});

/*
 * Identity: UserAuthorizationSSOProvider.test.ts already covers the wrong-user
 * global token arriving via the COOKIE. This covers the mobile header path,
 * which is the transport Global SSO now uses from the app.
 */
describe("UserMiddleware.doesSsoTokenForProjectExist - global token identity", () => {
  const projectId: ObjectID = ObjectID.generate();
  const tokenOwnerId: ObjectID = ObjectID.generate();

  test("valid global token for a DIFFERENT user, sent via header -> false", () => {
    const token: string = CookieUtil.getGlobalSSOToken({
      user: buildUser(tokenOwnerId),
      ssoProviderId: ObjectID.generate(),
      ssoProviderType: SsoProviderType.GlobalOIDC,
    });

    const req: ExpressRequest = buildHeaderRequest(token);

    // The token is valid and readable...
    const globalTokenData: JSONWebTokenData | null =
      UserMiddleware.getGlobalSsoTokenData(req);
    expect(globalTokenData?.userId.toString()).toBe(tokenOwnerId.toString());

    // ...but it only satisfies the user it was minted for.
    const otherUserId: ObjectID = ObjectID.generate();
    expect(
      UserMiddleware.doesSsoTokenForProjectExist(req, projectId, otherUserId),
    ).toBe(false);
    expect(
      UserMiddleware.doesSsoTokenForProjectExist(req, projectId, tokenOwnerId),
    ).toBe(true);
  });
});
