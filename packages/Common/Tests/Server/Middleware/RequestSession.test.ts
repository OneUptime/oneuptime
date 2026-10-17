import UserMiddleware, {
  RequestSession,
} from "../../../Server/Middleware/UserAuthorization";
import UserService from "../../../Server/Services/UserService";
import CookieUtil from "../../../Server/Utils/Cookie";
import { ExpressRequest } from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import Email from "../../../Types/Email";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * A REQUEST'S SESSION IS READ ONE WAY, WHEREVER IT IS READ.
 *
 * UserMiddleware.readRequestSession is what the API's middleware answers
 * every request from (resolveRequestUser), and getSessionUser is what a
 * route that only needs to know who is asking reads - the image routes
 * (FileViewerAccess). Both go through the same steps: the access token from
 * the cookie or the bearer header, verified, of a user who is not blocked -
 * and a master admin's only while their account still is one. Tokens are
 * signed and verified for real; only the account lookups are stubbed.
 */

const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

const SESSION_ID: ObjectID = new ObjectID(
  "45454545-4545-4545-8545-454545454545",
);

function sessionToken(
  expiresInSeconds: number = 15 * 60,
  isMasterAdmin: boolean = false,
): string {
  return JSONWebToken.signUserLoginToken({
    tokenData: {
      userId: USER_ID,
      email: new Email("someone@example.com"),
      name: new Name("Someone"),
      timezone: null,
      isMasterAdmin: isMasterAdmin,
      isGlobalLogin: true,
      sessionId: SESSION_ID,
    },
    expiresInSeconds: expiresInSeconds,
  });
}

// A session signed while its person was a master admin.
function masterAdminSessionToken(): string {
  return sessionToken(15 * 60, true);
}

function request(data: { cookie?: string; bearer?: string }): ExpressRequest {
  return {
    cookies: data.cookie ? { [CookieUtil.getUserTokenKey()]: data.cookie } : {},
    headers: data.bearer ? { authorization: `Bearer ${data.bearer}` } : {},
  } as unknown as ExpressRequest;
}

let isUserBlocked: ReturnType<typeof jest.spyOn>;
let isUserMasterAdmin: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  isUserBlocked = jest
    .spyOn(UserService, "isUserBlocked")
    .mockResolvedValue(false as never);
  isUserMasterAdmin = jest
    .spyOn(UserService, "isUserMasterAdmin")
    .mockResolvedValue(true as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("UserMiddleware.readRequestSession", () => {
  test("none, without a token", async () => {
    expect(await UserMiddleware.readRequestSession(request({}))).toEqual({
      kind: "none",
    });
    expect(isUserBlocked).not.toHaveBeenCalled();
  });

  test("a user's, from the session cookie or the bearer header", async () => {
    for (const transport of ["cookie", "bearer"]) {
      const read: RequestSession = await UserMiddleware.readRequestSession(
        request({ [transport]: sessionToken() }),
      );

      expect(read.kind).toBe("user");
      expect(
        (read as { session: JSONWebTokenData }).session.userId.toString(),
      ).toBe(USER_ID.toString());
    }
  });

  test("invalid, for a token that has expired or was not signed by OneUptime", async () => {
    for (const token of [sessionToken(-60), "not-a-token"]) {
      expect(
        (await UserMiddleware.readRequestSession(request({ cookie: token })))
          .kind,
      ).toBe("invalid");
    }

    expect(isUserBlocked).not.toHaveBeenCalled();
  });

  test("blocked, for a blocked user's token", async () => {
    isUserBlocked.mockResolvedValue(true as never);

    expect(
      (
        await UserMiddleware.readRequestSession(
          request({ cookie: sessionToken() }),
        )
      ).kind,
    ).toBe("blocked");
  });

  test("throws when whether the user is blocked cannot be looked up", async () => {
    isUserBlocked.mockRejectedValue(
      new Error("the database is unreachable") as never,
    );

    await expect(
      UserMiddleware.readRequestSession(request({ cookie: sessionToken() })),
    ).rejects.toThrow("the database is unreachable");
  });
});

/*
 * A session's token says whether its person was a master admin when it was
 * signed, up to 15 minutes ago. Another master admin may have removed the
 * access since; the session is a master admin's only while the person's
 * account still says so. The whole path over HTTP is
 * Tests/Server/API/MasterAdminRemovalOverHttp.test.ts.
 */
describe("UserMiddleware.readRequestSession - a master admin's session", () => {
  test("is a master admin's while their account still is one", async () => {
    for (const transport of ["cookie", "bearer"]) {
      const read: RequestSession = await UserMiddleware.readRequestSession(
        request({ [transport]: masterAdminSessionToken() }),
      );

      expect(read.kind).toBe("user");
      expect(
        (read as { session: JSONWebTokenData }).session.isMasterAdmin,
      ).toBe(true);
    }

    expect(isUserMasterAdmin).toHaveBeenCalledWith(USER_ID);
  });

  test("is a user's, no master admin's, once their access was removed", async () => {
    isUserMasterAdmin.mockResolvedValue(false as never);

    const read: RequestSession = await UserMiddleware.readRequestSession(
      request({ cookie: masterAdminSessionToken() }),
    );

    expect(read.kind).toBe("user");

    const session: JSONWebTokenData = (read as { session: JSONWebTokenData })
      .session;

    expect(session.isMasterAdmin).toBe(false);

    // Nobody is signed out: the same person, in the same session.
    expect(session.userId.toString()).toBe(USER_ID.toString());
    expect(session.sessionId?.toString()).toBe(SESSION_ID.toString());
    expect(session.email.toString()).toBe("someone@example.com");
    expect(session.isGlobalLogin).toBe(true);
  });

  test("asks the session's own person, once", async () => {
    await UserMiddleware.readRequestSession(
      request({ cookie: masterAdminSessionToken() }),
    );

    expect(isUserMasterAdmin).toHaveBeenCalledTimes(1);
    expect((isUserMasterAdmin.mock.calls[0]![0] as ObjectID).toString()).toBe(
      USER_ID.toString(),
    );
  });

  /*
   * Only ever taken away: a session that does not say master admin is never
   * made one by its account, so nothing is asked for it. Someone made a
   * master admin is one from their next sign-in or the session's renewal.
   */
  test("that never said master admin is not made one, and nothing is asked", async () => {
    const read: RequestSession = await UserMiddleware.readRequestSession(
      request({ cookie: sessionToken() }),
    );

    expect(read.kind).toBe("user");
    expect((read as { session: JSONWebTokenData }).session.isMasterAdmin).toBe(
      false,
    );
    expect(isUserMasterAdmin).not.toHaveBeenCalled();
  });

  test("of a blocked person is blocked, without asking more", async () => {
    isUserBlocked.mockResolvedValue(true as never);

    expect(
      (
        await UserMiddleware.readRequestSession(
          request({ cookie: masterAdminSessionToken() }),
        )
      ).kind,
    ).toBe("blocked");
    expect(isUserMasterAdmin).not.toHaveBeenCalled();
  });

  test("throws when whether they are still a master admin cannot be looked up", async () => {
    isUserMasterAdmin.mockRejectedValue(
      new Error("the database is unreachable") as never,
    );

    await expect(
      UserMiddleware.readRequestSession(
        request({ cookie: masterAdminSessionToken() }),
      ),
    ).rejects.toThrow("the database is unreachable");
  });

  test("of an expired or forged token is invalid, without asking anything", async () => {
    expect(
      (
        await UserMiddleware.readRequestSession(
          request({ cookie: "not-a-token" }),
        )
      ).kind,
    ).toBe("invalid");
    expect(isUserMasterAdmin).not.toHaveBeenCalled();
  });
});

describe("UserMiddleware.getSessionUser", () => {
  test("the user of a valid session", async () => {
    expect(
      (
        await UserMiddleware.getSessionUser(request({ cookie: sessionToken() }))
      )?.userId.toString(),
    ).toBe(USER_ID.toString());
  });

  test("no one without a session, with one that does not verify, or for a blocked user", async () => {
    expect(await UserMiddleware.getSessionUser(request({}))).toBeNull();
    expect(
      await UserMiddleware.getSessionUser(request({ cookie: "not-a-token" })),
    ).toBeNull();

    isUserBlocked.mockResolvedValue(true as never);

    expect(
      await UserMiddleware.getSessionUser(request({ cookie: sessionToken() })),
    ).toBeNull();
  });

  // The image routes see a server admin only while the account is one.
  test("the user, no master admin, once their master admin access was removed", async () => {
    isUserMasterAdmin.mockResolvedValue(false as never);

    const user: JSONWebTokenData | null = await UserMiddleware.getSessionUser(
      request({ cookie: masterAdminSessionToken() }),
    );

    expect(user?.userId.toString()).toBe(USER_ID.toString());
    expect(user?.isMasterAdmin).toBe(false);
  });
});
