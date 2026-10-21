import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPagePrivateUserSession from "../../../Models/DatabaseModels/StatusPagePrivateUserSession";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPagePrivateUserSessionService from "../../../Server/Services/StatusPagePrivateUserSessionService";
import CookieUtil from "../../../Server/Utils/Cookie";
import { ExpressRequest } from "../../../Server/Utils/Express";
import JSONWebToken, {
  PURPOSE_CLAIM,
} from "../../../Server/Utils/JsonWebToken";
import logger from "../../../Server/Utils/Logger";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import HashedString from "../../../Types/HashedString";
import { JSONObject } from "../../../Types/JSON";
import JsonWebTokenPurpose from "../../../Types/JsonWebTokenPurpose";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import { MASTER_PASSWORD_COOKIE_IDENTIFIER } from "../../../Types/StatusPage/MasterPassword";
import { SelectQueryBuilder } from "typeorm";

describe("private status page access requires a live session", () => {
  const statusPageId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const sessionId: ObjectID = ObjectID.generate();
  let statusPage: StatusPage;
  let session: StatusPagePrivateUserSession;
  let getOne: jest.Mock;
  let query: SelectQueryBuilder<StatusPagePrivateUserSession>;

  function request(
    claims: JSONObject = {},
    expiresInSeconds: number = 900,
  ): ExpressRequest {
    const token: string = JSONWebToken.sign({
      data: {
        userId,
        email: new Email("private-user@example.com"),
        statusPageId,
        sessionId,
        ...claims,
      },
      expiresInSeconds,
      purpose: JsonWebTokenPurpose.StatusPageSession,
    });
    return {
      cookies: { [CookieUtil.getUserTokenKey(statusPageId)]: token },
    } as ExpressRequest;
  }

  async function hasAccess(req: ExpressRequest = request()): Promise<boolean> {
    return (await StatusPageService.hasReadAccess({ statusPageId, req }))
      .hasReadAccess;
  }

  beforeEach(() => {
    statusPage = new StatusPage();
    statusPage.id = statusPageId;
    statusPage.isPublicStatusPage = false;
    session = new StatusPagePrivateUserSession();
    session.id = sessionId;
    session.additionalInfo = {};
    getOne = jest.fn().mockResolvedValue(session);
    query = {
      select: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne,
    } as unknown as SelectQueryBuilder<StatusPagePrivateUserSession>;
    jest.spyOn(StatusPageService, "findOneById").mockResolvedValue(statusPage);
    jest
      .spyOn(StatusPagePrivateUserSessionService, "getQueryBuilder")
      .mockReturnValue(query);
    jest.spyOn(logger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("accepts a signed token backed by an active session", async () => {
    expect(await hasAccess()).toBe(true);
    expect(getOne).toHaveBeenCalledTimes(1);
    expect(query.where).toHaveBeenCalledWith("session._id = :sessionId", {
      sessionId: sessionId.toString(),
    });
    expect(query.andWhere).toHaveBeenCalledWith(
      "session.statusPagePrivateUserId = :userId",
      { userId: userId.toString() },
    );
    expect(query.andWhere).toHaveBeenCalledWith(
      "session.statusPageId = :statusPageId",
      { statusPageId: statusPageId.toString() },
    );
  });

  test("rejects a signed token without a live session", async () => {
    getOne.mockResolvedValue(null);
    expect(await hasAccess()).toBe(false);
  });

  /*
   * The page's cookie takes only the page's own sessions. Anything else
   * OneUptime signs with the same key - a dashboard session, an SSO
   * sign-in, a token naming this page and a session that says it is
   * something else - is refused before any session is read.
   */
  function dashboardUser(): User {
    const user: User = new User();
    user.id = userId;
    user.email = new Email("private-user@example.com");
    user.name = new Name("Private User");
    return user;
  }

  function withPageCookie(token: string): ExpressRequest {
    return {
      cookies: { [CookieUtil.getUserTokenKey(statusPageId)]: token },
    } as ExpressRequest;
  }

  // A token naming this page, its private user and its session, saying it is `purpose`.
  function signedForThisPage(purpose: string): string {
    return JSONWebToken.signJsonPayload(
      {
        userId: userId.toString(),
        email: "private-user@example.com",
        statusPageId: statusPageId.toString(),
        sessionId: sessionId.toString(),
        [PURPOSE_CLAIM]: purpose,
      },
      900,
    );
  }

  test("accepts the page's session as this release signs it, saying what it is", async () => {
    expect(
      await hasAccess(
        withPageCookie(
          signedForThisPage(JsonWebTokenPurpose.StatusPageSession),
        ),
      ),
    ).toBe(true);
    expect(getOne).toHaveBeenCalledTimes(1);
  });

  test("rejects a dashboard session in the page's cookie before reading sessions", async () => {
    const dashboardSession: string = JSONWebToken.signUserLoginToken({
      tokenData: {
        userId: userId,
        email: new Email("private-user@example.com"),
        name: new Name("Private User"),
        timezone: null,
        isMasterAdmin: false,
        isGlobalLogin: true,
        sessionId: sessionId,
      },
      expiresInSeconds: 900,
    });

    expect(await hasAccess(withPageCookie(dashboardSession))).toBe(false);
    expect(getOne).not.toHaveBeenCalled();
  });

  test("rejects an SSO sign-in in the page's cookie before reading sessions", async () => {
    for (const ssoSignIn of [
      CookieUtil.getSSOToken({
        user: dashboardUser(),
        projectId: ObjectID.generate(),
        ssoProviderId: ObjectID.generate(),
        ssoProviderType: SsoProviderType.ProjectSSO,
      }),
      CookieUtil.getGlobalSSOToken({
        user: dashboardUser(),
        ssoProviderId: ObjectID.generate(),
        ssoProviderType: SsoProviderType.GlobalOIDC,
      }),
    ]) {
      expect(await hasAccess(withPageCookie(ssoSignIn))).toBe(false);
    }

    expect(getOne).not.toHaveBeenCalled();
  });

  test.each([
    JsonWebTokenPurpose.UserSession,
    JsonWebTokenPurpose.SsoSignIn,
    "on-call-page",
  ])(
    "rejects a token naming this page and a session that says it is a %s, before reading sessions",
    async (purpose: string) => {
      expect(await hasAccess(withPageCookie(signedForThisPage(purpose)))).toBe(
        false,
      );
      expect(getOne).not.toHaveBeenCalled();
    },
  );

  test("reads the session under its sign-in rule, with the page's Require SSO for Login", async () => {
    /*
     * The rule (StatusPagePrivateUserSessionService.addSignInRule) counts a
     * session only while the provider that signed it in vouches for it,
     * and one no provider signed in only on a page that does not require
     * SSO. Its SQL is pinned against Postgres in
     * StatusPageSsoSessionsPostgres.test.ts.
     */
    const addSignInRule: jest.SpyInstance = jest.spyOn(
      StatusPagePrivateUserSessionService,
      "addSignInRule",
    );

    statusPage.requireSsoForLogin = true;
    expect(await hasAccess()).toBe(true);
    expect(addSignInRule).toHaveBeenLastCalledWith(query, {
      requiresSso: true,
      sessionLengthInHours: undefined,
    });

    statusPage.requireSsoForLogin = false;
    expect(await hasAccess()).toBe(true);
    expect(addSignInRule).toHaveBeenLastCalledWith(query, {
      requiresSso: false,
      sessionLengthInHours: undefined,
    });

    // The provider tables are joined into the one session read.
    expect(query.leftJoin).toHaveBeenCalled();
    expect(getOne).toHaveBeenCalledTimes(2);
  });

  test("reads the session within the page's Sign Readers Out After", async () => {
    /*
     * A session counts only while fewer hours than the page's limit have
     * passed since it signed in (StatusPagePrivateUserSessionLength.test.ts,
     * and against Postgres in StatusPagePrivateUserSessionLengthPostgres).
     */
    const addSignInRule: jest.SpyInstance = jest.spyOn(
      StatusPagePrivateUserSessionService,
      "addSignInRule",
    );
    const pageRead: jest.SpyInstance = jest.spyOn(
      StatusPageService,
      "findOneById",
    );

    statusPage.privateUserSessionLengthInHours = 12;
    expect(await hasAccess()).toBe(true);
    expect(addSignInRule).toHaveBeenLastCalledWith(query, {
      requiresSso: false,
      sessionLengthInHours: 12,
    });
    expect(query.andWhere).toHaveBeenCalledWith(
      "session.createdAt > NOW() - make_interval(hours => CAST(:sessionLengthInHours AS integer))",
      { sessionLengthInHours: 12 },
    );

    // The page is read with the limit, in the read that decides access.
    expect(pageRead).toHaveBeenLastCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          privateUserSessionLengthInHours: true,
        }),
      }),
    );

    // Past the limit the read finds no session, and access is refused.
    getOne.mockResolvedValue(null);
    expect(await hasAccess()).toBe(false);
  });

  test("does not cache successful authorization after revocation or deletion", async () => {
    const req: ExpressRequest = request();
    expect(await hasAccess(req)).toBe(true);
    getOne.mockResolvedValue(null);
    expect(await hasAccess(req)).toBe(false);
    expect(getOne).toHaveBeenCalledTimes(2);
  });

  test("rejects a login-code session even with a valid access token", async () => {
    session.additionalInfo = {
      oneuptimeStatusPageSessionPurpose: "login-code",
    };
    expect(await hasAccess()).toBe(false);
  });

  test.each(["sessionId", "userId", "statusPageId"])(
    "rejects a token missing %s before reading sessions",
    async (claim: string) => {
      expect(await hasAccess(request({ [claim]: null }))).toBe(false);
      expect(getOne).not.toHaveBeenCalled();
    },
  );

  test("rejects a token for another status page before reading sessions", async () => {
    expect(
      await hasAccess(request({ statusPageId: ObjectID.generate() })),
    ).toBe(false);
    expect(getOne).not.toHaveBeenCalled();
  });

  test.each(["sessionId", "userId"])(
    "rejects malformed %s before reading sessions",
    async (claim: string) => {
      expect(await hasAccess(request({ [claim]: "not-a-uuid" }))).toBe(false);
      expect(getOne).not.toHaveBeenCalled();
    },
  );

  test("rejects an expired JWT before reading sessions", async () => {
    expect(await hasAccess(request({}, -1))).toBe(false);
    expect(getOne).not.toHaveBeenCalled();
  });

  test("rejects a tampered JWT before reading sessions", async () => {
    const req: ExpressRequest = request();
    req.cookies[CookieUtil.getUserTokenKey(statusPageId)] += "tampered";
    expect(await hasAccess(req)).toBe(false);
    expect(getOne).not.toHaveBeenCalled();
  });

  test("fails closed if the session database lookup fails", async () => {
    getOne.mockRejectedValue(new Error("Database unavailable"));
    expect(await hasAccess()).toBe(false);
  });

  test("does not grant access to a missing status page", async () => {
    jest.spyOn(StatusPageService, "findOneById").mockResolvedValue(null);
    expect(await hasAccess()).toBe(false);
    expect(getOne).not.toHaveBeenCalled();
  });

  test("does not query sessions for public pages", async () => {
    statusPage.isPublicStatusPage = true;
    expect(await hasAccess()).toBe(true);
    expect(getOne).not.toHaveBeenCalled();
  });

  test("preserves independent master-password access", async () => {
    statusPage.enableMasterPassword = true;
    statusPage.masterPassword = new HashedString("configured");
    getOne.mockResolvedValue(null);
    const req: ExpressRequest = request();
    req.cookies[CookieUtil.getStatusPageMasterPasswordKey(statusPageId)] =
      JSONWebToken.signJsonPayload(
        {
          statusPageId: statusPageId.toString(),
          type: MASTER_PASSWORD_COOKIE_IDENTIFIER,
        },
        900,
      );
    expect(await hasAccess(req)).toBe(true);
  });
});
