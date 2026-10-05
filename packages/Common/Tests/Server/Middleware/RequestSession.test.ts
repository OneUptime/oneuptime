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
 * the cookie or the bearer header, verified, of a user who is not blocked.
 * Tokens are signed and verified for real; only the blocked-user lookup is
 * stubbed.
 */

const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

function sessionToken(expiresInSeconds: number = 15 * 60): string {
  return JSONWebToken.signUserLoginToken({
    tokenData: {
      userId: USER_ID,
      email: new Email("someone@example.com"),
      name: new Name("Someone"),
      timezone: null,
      isMasterAdmin: false,
      isGlobalLogin: true,
      sessionId: ObjectID.generate(),
    },
    expiresInSeconds: expiresInSeconds,
  });
}

function request(data: { cookie?: string; bearer?: string }): ExpressRequest {
  return {
    cookies: data.cookie ? { [CookieUtil.getUserTokenKey()]: data.cookie } : {},
    headers: data.bearer ? { authorization: `Bearer ${data.bearer}` } : {},
  } as unknown as ExpressRequest;
}

let isUserBlocked: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  isUserBlocked = jest
    .spyOn(UserService, "isUserBlocked")
    .mockResolvedValue(false as never);
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
});
