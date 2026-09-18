import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPagePrivateUserSession from "../../../Models/DatabaseModels/StatusPagePrivateUserSession";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPagePrivateUserSessionService from "../../../Server/Services/StatusPagePrivateUserSessionService";
import CookieUtil from "../../../Server/Utils/Cookie";
import { ExpressRequest } from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import logger from "../../../Server/Utils/Logger";
import Email from "../../../Types/Email";
import HashedString from "../../../Types/HashedString";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
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
