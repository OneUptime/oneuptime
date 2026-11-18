import UserMiddleware, {
  RequestSession,
  SESSION_ENDED_TOKEN_MESSAGE,
} from "../../../Server/Middleware/UserAuthorization";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import UserSessionService from "../../../Server/Services/UserSessionService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import CookieUtil from "../../../Server/Utils/Cookie";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import RealtimeAccessChanges, {
  RealtimeAccessChangeKind,
} from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import Response from "../../../Server/Utils/Response";
import UserSession from "../../../Models/DatabaseModels/UserSession";
import Email from "../../../Types/Email";
import Exception from "../../../Types/Exception/Exception";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import ServerException from "../../../Types/Exception/ServerException";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { UserGlobalAccessPermission } from "../../../Types/Permission";
import { SessionEndCause } from "../../../Types/UserSession/SessionEndCause";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * ---------------------------------------------------------------------------
 * A SIGNED-OUT OR REVOKED SESSION'S ACCESS TOKEN STOPS WORKING AT ONCE (#9534).
 *
 * Signing out (POST /identity/logout), revoking a session, a new password,
 * a block and the session lengths end a session in the database, so its
 * refresh token is refused. Its access token is a stateless JWT in the
 * user-token cookie, signed for 15 minutes, and every route took it until
 * it expired: readRequestSession checked its signature, the session
 * lengths, whether its person was blocked and whether they were still a
 * master admin - never whether the session it names was still live. So:
 *
 *   - a sign-out whose answer never reached the browser (a dropped
 *     connection, a proxy's timeout, #9508) left the next person at a
 *     shared computer signed in as the last one, for up to 15 minutes;
 *   - a session revoked from another device kept its access to the API;
 *   - a copied access token kept working after its sign-out.
 *
 * Now the session the token names must be live, read per server
 * (UserSessionService.isSessionLive) and dropped on every server when it
 * ends. Tokens are signed and verified for real, the API's middleware and
 * the sign-out's revocation run for real; only the database is a stand-in:
 * one session row, which the revocation writes.
 * ---------------------------------------------------------------------------
 */

const USER_ID: ObjectID = new ObjectID("71717171-7171-4171-8171-717171717171");

function signSessionToken(sessionId: ObjectID): string {
  return JSONWebToken.signUserLoginToken({
    tokenData: {
      userId: USER_ID,
      email: new Email("night.shift@example.com"),
      name: new Name("Night Shift"),
      timezone: null,
      isMasterAdmin: false,
      isGlobalLogin: true,
      sessionId: sessionId,
    },
    expiresInSeconds: 15 * 60,
  });
}

// No tenant, so the permission path stays on the global lookup.
function buildRequest(data: {
  cookie?: string;
  bearer?: string;
}): OneUptimeRequest {
  return {
    params: {},
    query: {},
    body: {},
    cookies: data.cookie ? { [CookieUtil.getUserTokenKey()]: data.cookie } : {},
    headers: {
      tenantid: "",
      ...(data.bearer ? { authorization: `Bearer ${data.bearer}` } : {}),
    },
  } as unknown as OneUptimeRequest;
}

interface MiddlewareCallResult {
  wasLetThrough: boolean;
  sentError: Exception | undefined;
}

async function callApi(req: OneUptimeRequest): Promise<MiddlewareCallResult> {
  (Response.sendErrorResponse as unknown as jest.Mock).mockClear();

  const res: ExpressResponse = { set: jest.fn() } as unknown as ExpressResponse;
  const next: jest.Mock = jest.fn();

  await UserMiddleware.getUserMiddleware(
    req as ExpressRequest,
    res,
    next as unknown as NextFunction,
  );

  const errorCalls: Array<Array<unknown>> = (
    Response.sendErrorResponse as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  return {
    wasLetThrough: next.mock.calls.length === 1 && errorCalls.length === 0,
    sentError: errorCalls[0]?.[2] as Exception | undefined,
  };
}

/*
 * A 401 specifically: the browser answers a 401 by asking /refresh-token for
 * a new session, which is refused for a session that has ended, and that
 * refusal sends it to the sign-in page, which says why.
 */
function expectRefusedAsExpired(result: MiddlewareCallResult): void {
  expect(result.wasLetThrough).toBe(false);
  expect(result.sentError).toBeInstanceOf(NotAuthenticatedException);
  expect(result.sentError?.code).toBe(401);
}

// The session table, as far as these requests read and write it.
const revokedSessionIds: Set<string> = new Set<string>();

let findOneById: jest.SpyInstance;
let isUserBlocked: jest.SpyInstance;

interface UserSessionServiceInternals {
  onUpdateSuccess: (
    onUpdate: OnUpdate<UserSession>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<UserSession>>;
}

beforeEach(() => {
  revokedSessionIds.clear();

  jest.spyOn(Response, "sendErrorResponse").mockImplementation((() => {
    return undefined;
  }) as never);

  isUserBlocked = jest
    .spyOn(UserService, "isUserBlocked")
    .mockResolvedValue(false as never);
  jest
    .spyOn(UserService, "isUserMasterAdmin")
    .mockResolvedValue(false as never);
  jest
    .spyOn(UserService, "updateLastActive")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectService, "updateLastActive")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
    .mockResolvedValue({
      _type: "UserGlobalAccessPermission",
      projectIds: [],
      globalPermissions: [],
    } as UserGlobalAccessPermission as never);

  // A session row: the user's, revoked once a revocation wrote it.
  findOneById = jest
    .spyOn(UserSessionService, "findOneById")
    .mockImplementation((async (data: { id: ObjectID }) => {
      const session: UserSession = new UserSession();
      session.id = data.id;
      session.userId = USER_ID;
      session.isRevoked = revokedSessionIds.has(
        data.id.toString().toLowerCase(),
      );
      return session;
    }) as never);

  /*
   * The revocation's write, as the database applies it: the row is revoked,
   * and the service's own hook runs after it, as DatabaseService runs it
   * after every update.
   */
  jest
    .spyOn(UserSessionService, "updateOneById")
    .mockImplementation((async (data: {
      id: ObjectID;
      data: Record<string, unknown>;
      props: UpdateBy<UserSession>["props"];
    }) => {
      if (data.data["isRevoked"] === true) {
        revokedSessionIds.add(data.id.toString().toLowerCase());
      }

      await (
        UserSessionService as unknown as UserSessionServiceInternals
      ).onUpdateSuccess(
        {
          updateBy: {
            query: {
              _id: data.id.toString(),
            } as unknown as UpdateBy<UserSession>["query"],
            data: data.data as unknown as UpdateBy<UserSession>["data"],
            props: data.props,
            limit: 1,
            skip: 0,
          },
          carryForward: null,
        },
        [data.id],
      );
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("after a sign-out, the session's access token is refused at once", () => {
  /*
   * The regression: the copied token - or the cookie a lost sign-out left
   * in the browser - worked until it expired, up to 15 minutes later.
   */
  test("a request with a copied access token gets a 401 straight after the sign-out", async () => {
    const sessionId: ObjectID = ObjectID.generate();
    const copiedToken: string = signSessionToken(sessionId);

    expect(
      (await callApi(buildRequest({ cookie: copiedToken }))).wasLetThrough,
    ).toBe(true);

    // POST /identity/logout ends the session it names.
    await UserSessionService.revokeSessionById(sessionId, {
      cause: SessionEndCause.SignedOut,
    });

    expectRefusedAsExpired(
      await callApi(buildRequest({ cookie: copiedToken })),
    );
    expectRefusedAsExpired(
      await callApi(buildRequest({ bearer: copiedToken })),
    );
  });

  test("the refusal says the session ended, as an expired token", async () => {
    const sessionId: ObjectID = ObjectID.generate();
    const token: string = signSessionToken(sessionId);

    await UserMiddleware.readRequestSession(buildRequest({ cookie: token }));

    await UserSessionService.revokeSessionById(sessionId, {
      cause: SessionEndCause.SignedOut,
    });

    const read: RequestSession = await UserMiddleware.readRequestSession(
      buildRequest({ cookie: token }),
    );

    expect(read.kind).toBe("invalid");
    expect((read as { error: Exception }).error).toBeInstanceOf(
      NotAuthenticatedException,
    );
    expect((read as { error: Exception }).error.message).toBe(
      SESSION_ENDED_TOKEN_MESSAGE,
    );
  });

  // Every other way a session ends goes through the same revocation.
  test.each([
    ["revoked from another device", SessionEndCause.SignedOut],
    ["a new password", SessionEndCause.PasswordChanged],
    ["a password reset", SessionEndCause.PasswordReset],
    ["a block", SessionEndCause.AccountBlocked],
    ["two factor auth reset by a master admin", SessionEndCause.TwoFactorReset],
    [
      "two factor auth required by a master admin",
      SessionEndCause.TwoFactorRequired,
    ],
    [
      "a master admin ending the sessions signed in without SSO",
      SessionEndCause.SignedInWithoutSso,
    ],
    ["the session length", SessionEndCause.LengthReached],
    ["the idle timeout", SessionEndCause.IdleTimeout],
  ])(
    "and after its session ends otherwise: %s",
    async (_: string, cause: SessionEndCause) => {
      const sessionId: ObjectID = ObjectID.generate();
      const token: string = signSessionToken(sessionId);

      expect(
        (await callApi(buildRequest({ cookie: token }))).wasLetThrough,
      ).toBe(true);

      await UserSessionService.revokeSessionById(sessionId, {
        cause: cause as never,
      });

      expectRefusedAsExpired(await callApi(buildRequest({ cookie: token })));
    },
  );

  test("signing out one device leaves the others signed in", async () => {
    const laptopSessionId: ObjectID = ObjectID.generate();
    const phoneSessionId: ObjectID = ObjectID.generate();

    await UserSessionService.revokeSessionById(laptopSessionId, {
      cause: SessionEndCause.SignedOut,
    });

    expectRefusedAsExpired(
      await callApi(
        buildRequest({ cookie: signSessionToken(laptopSessionId) }),
      ),
    );
    expect(
      (
        await callApi(
          buildRequest({ cookie: signSessionToken(phoneSessionId) }),
        )
      ).wasLetThrough,
    ).toBe(true);
  });
});

describe("a session ended on one server is refused on another", () => {
  /*
   * This server read the session as live and keeps that for a minute. The
   * sign-out was answered by another server, which tells every server; the
   * row still reads live here only to show that the message, not a read,
   * refuses it.
   */
  test("as soon as this server hears of it", async () => {
    const sessionId: ObjectID = ObjectID.generate();
    const token: string = signSessionToken(sessionId);

    expect((await callApi(buildRequest({ cookie: token }))).wasLetThrough).toBe(
      true,
    );

    RealtimeAccessChanges.receive(
      JSON.stringify({
        origin: ObjectID.generate().toString(),
        change: {
          kind: RealtimeAccessChangeKind.SessionsEnded,
          sessionIds: [sessionId.toString()],
        },
      }),
    );

    expectRefusedAsExpired(await callApi(buildRequest({ cookie: token })));
    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("and every session of a person whose account was deleted", async () => {
    const sessionId: ObjectID = ObjectID.generate();
    const token: string = signSessionToken(sessionId);

    expect((await callApi(buildRequest({ cookie: token }))).wasLetThrough).toBe(
      true,
    );

    // The account's sessions went with it (ON DELETE CASCADE).
    findOneById.mockResolvedValue(null as never);

    RealtimeAccessChanges.receive(
      JSON.stringify({
        origin: ObjectID.generate().toString(),
        change: {
          kind: RealtimeAccessChangeKind.SessionsEnded,
          userId: USER_ID.toString(),
        },
      }),
    );

    expectRefusedAsExpired(await callApi(buildRequest({ cookie: token })));
  });
});

describe("a live session costs no database read per request", () => {
  test("the session is read once, however many requests its token makes", async () => {
    const sessionId: ObjectID = ObjectID.generate();
    const token: string = signSessionToken(sessionId);

    for (let request: number = 0; request < 25; request++) {
      expect(
        (await callApi(buildRequest({ cookie: token }))).wasLetThrough,
      ).toBe(true);
    }

    expect(findOneById).toHaveBeenCalledTimes(1);
  });
});

describe("what does not change", () => {
  /*
   * An access token an earlier release signed with no session in it was
   * never a session (JSONWebToken.isFor), and is refused as before, without
   * a session read.
   */
  test("a token that names no session is answered as it is today", async () => {
    const tokenWithoutSession: string = JSONWebToken.signJsonPayload(
      {
        userId: USER_ID.toString(),
        email: "night.shift@example.com",
        name: "Night Shift",
        isMasterAdmin: false,
        isGlobalLogin: true,
      },
      15 * 60,
    );

    const read: RequestSession = await UserMiddleware.readRequestSession(
      buildRequest({ cookie: tokenWithoutSession }),
    );

    expect(read.kind).toBe("invalid");
    expect(findOneById).not.toHaveBeenCalled();
  });

  // What a session decoded without one reads as, as some callers stub it.
  test("a decoded session with no session id is not asked about one", async () => {
    jest.spyOn(JSONWebToken, "decode").mockReturnValue({
      userId: USER_ID,
      isMasterAdmin: false,
    } as JSONWebTokenData);

    const read: RequestSession = await UserMiddleware.readRequestSession(
      buildRequest({ cookie: "a-token" }),
    );

    expect(read.kind).toBe("user");
    expect(findOneById).not.toHaveBeenCalled();
  });

  // Blocked says more than ended: the person is told they are blocked.
  test("a blocked user's token is answered as blocked, before its session is read", async () => {
    isUserBlocked.mockResolvedValue(true as never);

    const read: RequestSession = await UserMiddleware.readRequestSession(
      buildRequest({ cookie: signSessionToken(ObjectID.generate()) }),
    );

    expect(read.kind).toBe("blocked");
    expect(findOneById).not.toHaveBeenCalled();
  });

  test("a token that has expired is refused before its session is read", async () => {
    const expiredToken: string = JSONWebToken.signUserLoginToken({
      tokenData: {
        userId: USER_ID,
        email: new Email("night.shift@example.com"),
        name: new Name("Night Shift"),
        timezone: null,
        isMasterAdmin: false,
        isGlobalLogin: true,
        sessionId: ObjectID.generate(),
      },
      expiresInSeconds: -60,
    });

    expect(
      (
        await UserMiddleware.readRequestSession(
          buildRequest({ cookie: expiredToken }),
        )
      ).kind,
    ).toBe("invalid");
    expect(findOneById).not.toHaveBeenCalled();
  });
});

describe("a public route", () => {
  // A public route serves an anonymous visitor rather than a reload loop.
  test("a public route serves an ended session's token anonymously", async () => {
    const sessionId: ObjectID = ObjectID.generate();
    const token: string = signSessionToken(sessionId);

    await UserSessionService.revokeSessionById(sessionId, {
      cause: SessionEndCause.SignedOut,
    });

    const req: OneUptimeRequest = buildRequest({ cookie: token });
    const next: jest.Mock = jest.fn();

    await UserMiddleware.getPublicRouteUserMiddleware(
      req as ExpressRequest,
      { set: jest.fn() } as unknown as ExpressResponse,
      next as unknown as NextFunction,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userAuthorization).toBeUndefined();
  });
});

describe("when the session cannot be read", () => {
  // "We could not find out" is not "live".
  test("the request is refused, and nothing is let through", async () => {
    const lookupFailure: ServerException = new ServerException(
      "database unavailable",
    );
    findOneById.mockRejectedValue(lookupFailure as never);

    const result: MiddlewareCallResult = await callApi(
      buildRequest({ cookie: signSessionToken(ObjectID.generate()) }),
    );

    expect(result.wasLetThrough).toBe(false);
    expect(result.sentError).toBe(lookupFailure);
  });

  test("readRequestSession throws", async () => {
    findOneById.mockRejectedValue(new Error("database unavailable") as never);

    await expect(
      UserMiddleware.readRequestSession(
        buildRequest({ cookie: signSessionToken(ObjectID.generate()) }),
      ),
    ).rejects.toThrow("database unavailable");
  });
});
