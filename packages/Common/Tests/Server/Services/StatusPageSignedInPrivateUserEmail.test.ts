import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPagePrivateUser from "../../../Models/DatabaseModels/StatusPagePrivateUser";
import StatusPagePrivateUserSession from "../../../Models/DatabaseModels/StatusPagePrivateUserSession";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPagePrivateUserSessionService from "../../../Server/Services/StatusPagePrivateUserSessionService";
import CookieUtil from "../../../Server/Utils/Cookie";
import { ExpressRequest } from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import logger from "../../../Server/Utils/Logger";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { SelectQueryBuilder } from "typeorm";

/*
 * WHO IS SIGNED IN TO A STATUS PAGE, BY EMAIL
 * (StatusPageService.getSignedInPrivateUserEmail): what a page that takes
 * only its private users as subscribers holds a sign-up to.
 *
 * It reads the same live session the page's read access does
 * (findSignedInSession, shared with hasReadAccess, whose own suite is
 * StatusPagePrivateUserReadAccess.test.ts) and takes the address from the
 * private user's row joined to it - never from the token, which a reader
 * renamed or removed since still carries. Anything wrong is no one.
 */

describe("the email of the reader signed in to a status page", () => {
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
        // What the token says: never what is answered.
        email: new Email("what-the-token-says@example.com"),
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

  async function signedIn(
    req: ExpressRequest = request(),
  ): Promise<string | null> {
    return StatusPageService.getSignedInPrivateUserEmail({ statusPageId, req });
  }

  beforeEach(() => {
    statusPage = new StatusPage();
    statusPage.id = statusPageId;
    statusPage.isPublicStatusPage = false;

    const privateUser: StatusPagePrivateUser = new StatusPagePrivateUser();
    privateUser.email = new Email("reader@acme.com");

    session = new StatusPagePrivateUserSession();
    session.id = sessionId;
    session.additionalInfo = {};
    session.statusPagePrivateUser = privateUser;

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

  test("is the private user's own address, read with their live session", async () => {
    expect(await signedIn()).toBe("reader@acme.com");

    expect(query.select).toHaveBeenCalledWith([
      "session._id",
      "session.additionalInfo",
      "privateUser.email",
    ]);
    expect(query.innerJoin).toHaveBeenCalledWith(
      "session.statusPagePrivateUser",
      "privateUser",
    );
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
    expect(query.andWhere).toHaveBeenCalledWith(
      "privateUser.deletedAt IS NULL",
    );
    expect(query.andWhere).toHaveBeenCalledWith("session.isRevoked = false");
  });

  test("is read under the page's sign-in rule: Require SSO for Login and Sign Readers Out After", async () => {
    const addSignInRule: jest.SpyInstance = jest.spyOn(
      StatusPagePrivateUserSessionService,
      "addSignInRule",
    );

    statusPage.requireSsoForLogin = true;
    statusPage.privateUserSessionLengthInHours = 8;

    expect(await signedIn()).toBe("reader@acme.com");
    expect(addSignInRule).toHaveBeenLastCalledWith(query, {
      requiresSso: true,
      sessionLengthInHours: 8,
    });
  });

  test("no one, when the session has ended - revoked, expired, signed out after the page's limit", async () => {
    getOne.mockResolvedValue(null);
    expect(await signedIn()).toBeNull();
  });

  test("no one, during a login-code exchange", async () => {
    session.additionalInfo = {
      oneuptimeStatusPageSessionPurpose: "login-code",
    };
    expect(await signedIn()).toBeNull();
  });

  test("no one, without the page's cookie", async () => {
    expect(await signedIn({ cookies: {} } as ExpressRequest)).toBeNull();
    expect(getOne).not.toHaveBeenCalled();
  });

  test("no one, with a token for another status page", async () => {
    expect(
      await signedIn(request({ statusPageId: ObjectID.generate() })),
    ).toBeNull();
    expect(getOne).not.toHaveBeenCalled();
  });

  test.each(["sessionId", "userId"])(
    "no one, with a token whose %s is no id",
    async (claim: string) => {
      expect(await signedIn(request({ [claim]: "not-a-uuid" }))).toBeNull();
      expect(getOne).not.toHaveBeenCalled();
    },
  );

  test("no one, with an expired or tampered token", async () => {
    expect(await signedIn(request({}, -1))).toBeNull();

    const tampered: ExpressRequest = request();
    tampered.cookies[CookieUtil.getUserTokenKey(statusPageId)] += "tampered";
    expect(await signedIn(tampered)).toBeNull();

    expect(getOne).not.toHaveBeenCalled();
  });

  test("no one, for a page that does not exist", async () => {
    jest.spyOn(StatusPageService, "findOneById").mockResolvedValue(null);
    expect(await signedIn()).toBeNull();
    expect(getOne).not.toHaveBeenCalled();
  });

  test("no one, when the private user has no address", async () => {
    session.statusPagePrivateUser = new StatusPagePrivateUser();
    expect(await signedIn()).toBeNull();
  });

  test("no one, when the database cannot be read - it fails closed", async () => {
    getOne.mockRejectedValue(new Error("Database unavailable"));
    expect(await signedIn()).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  test("the same session read still grants a private page's read access", async () => {
    expect(
      (await StatusPageService.hasReadAccess({ statusPageId, req: request() }))
        .hasReadAccess,
    ).toBe(true);
    expect(query.select).toHaveBeenLastCalledWith([
      "session._id",
      "session.additionalInfo",
    ]);
  });
});
