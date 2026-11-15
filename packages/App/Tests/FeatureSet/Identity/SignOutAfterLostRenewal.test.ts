import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import User from "Common/Models/DatabaseModels/User";
import UserSession from "Common/Models/DatabaseModels/UserSession";
import CookieUtil from "Common/Server/Utils/Cookie";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import Email from "Common/Types/Email";
import Exception from "Common/Types/Exception/Exception";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import { SessionEndCause } from "Common/Types/UserSession/SessionEndCause";
import crypto from "crypto";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A SIGN-OUT AFTER A RENEWAL WHOSE ANSWER WAS LOST ENDS THE SESSION
 * (issue #8592).
 *
 * The server rotates the refresh token at every renewal
 * (POST /refresh-token) and keeps only the new one. When the answer never
 * reaches the client - a timeout after the server had committed, a phone
 * going into a tunnel - the client still holds the refresh token the
 * renewal replaced, which matches no session. A sign-out with it
 * (POST /logout) used to end nothing, and the session stayed signed in on
 * the server until it ran out: a session its person believed they had
 * ended. Now the sign-out falls back to the session its own access token
 * names - verified with the server's signature, taken expired, only that
 * user's live session.
 *
 * Every order is played against the real /refresh-token and /logout
 * handlers, with real tokens and a real clock read through fake timers. The
 * session table is a stand-in: each session's one current refresh token,
 * rotated at each renewal, and whether and how it ended.
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

jest.mock("Common/Server/Utils/SsoRequiredSignIn", () => {
  return (
    jest.requireActual(
      "./SsoNotRequiredStandIn",
    ) as typeof import("./SsoNotRequiredStandIn")
  ).ssoNotRequired();
});

jest.mock("Common/Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      getRouter: (): MockIdentityRouter => {
        return mockRouter;
      },
    },
    getClientIp: (): string => {
      return "127.0.0.1";
    },
    extractDeviceInfo: (): Record<string, unknown> => {
      return {};
    },
    headerValueToString: (): string => {
      return "";
    },
  };
});

const USER_ID: string = "5e550000-0000-4000-8000-0000000000b1";
const OTHER_USER_ID: string = "5e550000-0000-4000-8000-0000000000b2";
const SESSION_ID: string = "5e550000-0000-4000-8000-0000000000c1";
const OTHER_DEVICE_SESSION_ID: string = "5e550000-0000-4000-8000-0000000000c2";
const OTHER_USERS_SESSION_ID: string = "5e550000-0000-4000-8000-0000000000c3";

const MINUTE_IN_MS: number = 60 * 1000;

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (): Promise<unknown> => {
        const { default: UserModel } = jest.requireActual(
          "Common/Models/DatabaseModels/User",
        ) as { default: typeof User };
        const { default: EmailType } = jest.requireActual(
          "Common/Types/Email",
        ) as { default: typeof Email };
        const user: User = new UserModel();
        user._id = "5e550000-0000-4000-8000-0000000000b1";
        user.email = new EmailType("fox.mulder@example.com");
        user.name = "Fox Mulder" as never;
        user.isMasterAdmin = false;
        user.isBlocked = false;
        return Promise.resolve(user);
      },
      isUserBlocked: (): Promise<boolean> => {
        return Promise.resolve(false);
      },
      isUserMasterAdmin: (): Promise<boolean> => {
        return Promise.resolve(false);
      },
      findOneBy: jest.fn(),
      updateOneById: jest.fn(),
      updateOneBy: jest.fn(),
    },
  };
});

// One row of the session table: its one current refresh token, and how it ended.
interface SessionRow {
  id: string;
  userId: string;
  refreshToken: string;
  createdAt: Date;
  lastActiveAt: Date;
  isRevoked: boolean;
  endedBy: "refresh-token" | "access-token" | null;
  cause: unknown;
}

const table: Array<SessionRow> = [];

let rotations: number = 0;

function live(row: SessionRow | undefined): SessionRow | undefined {
  return row && !row.isRevoked ? row : undefined;
}

function toModel(row: SessionRow): UserSession {
  const session: UserSession = new UserSession();
  session.id = new ObjectID(row.id);
  session.userId = new ObjectID(row.userId);
  session.createdAt = row.createdAt;
  session.lastActiveAt = row.lastActiveAt;
  session.refreshTokenExpiresAt = OneUptimeDate.getSomeDaysAfter(30);
  session.additionalInfo = { isGlobalLogin: true };
  return session;
}

const revokeLiveSessionOfUserCalls: Array<unknown> = [];

jest.mock("Common/Server/Services/UserSessionService", () => {
  const actual: {
    default: {
      decideRenewal: (data: unknown) => Promise<unknown>;
    };
  } = jest.requireActual("Common/Server/Services/UserSessionService") as {
    default: {
      decideRenewal: (data: unknown) => Promise<unknown>;
    };
  };

  return {
    ...actual,
    __esModule: true,
    default: {
      decideRenewal: (data: unknown): Promise<unknown> => {
        return actual.default.decideRenewal(data);
      },
      findActiveSessionByRefreshToken: async (
        refreshToken: string,
      ): Promise<UserSession | null> => {
        const row: SessionRow | undefined = live(
          table.find((candidate: SessionRow): boolean => {
            return candidate.refreshToken === refreshToken;
          }),
        );
        return row ? toModel(row) : null;
      },
      // Rotates the refresh token, as the real write does; nothing for a session that ended.
      renewSessionWithNewRefreshToken: async (options: {
        session: UserSession;
        lastActiveAt: Date;
      }): Promise<unknown> => {
        const row: SessionRow | undefined = live(
          table.find((candidate: SessionRow): boolean => {
            return candidate.id === options.session.id!.toString();
          }),
        );

        if (!row) {
          return null;
        }

        rotations++;
        row.refreshToken = `rotated-refresh-token-${rotations}`;
        row.lastActiveAt = options.lastActiveAt;

        return {
          session: toModel(row),
          refreshToken: row.refreshToken,
          refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(30),
          signedInAt: row.createdAt,
          lastActiveAt: options.lastActiveAt,
          accessTokenExpiresInSeconds: 15 * 60,
          ssoSignInExpiresInSeconds: 30 * 24 * 60 * 60,
        };
      },
      revokeSessionByRefreshToken: async (
        refreshToken: string,
        options: { cause: unknown },
      ): Promise<boolean> => {
        const row: SessionRow | undefined = live(
          table.find((candidate: SessionRow): boolean => {
            return candidate.refreshToken === refreshToken;
          }),
        );

        if (!row) {
          return false;
        }

        row.isRevoked = true;
        row.endedBy = "refresh-token";
        row.cause = options.cause;
        return true;
      },
      revokeLiveSessionOfUser: async (
        data: { userId: ObjectID; sessionId: ObjectID },
        options: { cause: unknown },
      ): Promise<boolean> => {
        revokeLiveSessionOfUserCalls.push(data);

        const row: SessionRow | undefined = live(
          table.find((candidate: SessionRow): boolean => {
            return (
              candidate.id === data.sessionId.toString() &&
              candidate.userId === data.userId.toString()
            );
          }),
        );

        if (!row) {
          return false;
        }

        row.isRevoked = true;
        row.endedBy = "access-token";
        row.cause = options.cause;
        return true;
      },
      getSessionLengthEndReason: async (): Promise<null> => {
        return null;
      },
      endSessionByLength: jest.fn(),
      revokeSessionById: jest.fn(),
      revokeAllSessionsByUserId: jest.fn(),
      createSession: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    },
    getLogAttributesFromRequest: (): Record<string, unknown> => {
      return {};
    },
  };
});

const sendErrorResponse: jest.Mock = jest.fn();
const sendJsonObjectResponse: jest.Mock = jest.fn();
const sendEmptySuccessResponse: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: (...args: Array<unknown>): unknown => {
        return sendErrorResponse(...args);
      },
      sendJsonObjectResponse: (...args: Array<unknown>): unknown => {
        return sendJsonObjectResponse(...args);
      },
      sendEmptySuccessResponse: (...args: Array<unknown>): unknown => {
        return sendEmptySuccessResponse(...args);
      },
      sendEntityResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/Authentication";

const NOW: Date = new Date("2026-11-15T09:00:00.000Z");

// A session's access token, as a sign-in or a renewal signs it, at the time it is now.
function accessTokenOf(
  sessionId: string,
  userId: string = USER_ID,
  expiresInSeconds: number = 15 * 60,
): string {
  return JSONWebToken.signUserLoginToken({
    tokenData: {
      userId: new ObjectID(userId),
      email: new Email("fox.mulder@example.com"),
      name: new Name("Fox Mulder"),
      timezone: null,
      isMasterAdmin: false,
      isGlobalLogin: true,
      sessionId: new ObjectID(sessionId),
    },
    expiresInSeconds,
  });
}

// A sign-in: a session with its first refresh token, and the access token it hands out.
function signIn(
  sessionId: string = SESSION_ID,
  userId: string = USER_ID,
): { refreshToken: string; accessToken: string } {
  const refreshToken: string = `refresh-token-of-${sessionId}`;

  table.push({
    id: sessionId,
    userId,
    refreshToken,
    createdAt: new Date(Date.now()),
    lastActiveAt: new Date(Date.now()),
    isRevoked: false,
    endedBy: null,
    cause: null,
  });

  return { refreshToken, accessToken: accessTokenOf(sessionId, userId) };
}

// A JWT with these claims, signed HS256 with a key that is not the server's.
function signedWithAnotherKey(claims: JSONObject): string {
  const encode: (value: JSONObject) => string = (value: JSONObject): string => {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
  };
  const unsigned: string = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}`;
  const signature: string = crypto
    .createHmac("sha256", "not-the-servers-key")
    .update(unsigned)
    .digest("base64url");

  return `${unsigned}.${signature}`;
}

function row(sessionId: string = SESSION_ID): SessionRow {
  return table.find((candidate: SessionRow): boolean => {
    return candidate.id === sessionId;
  })!;
}

function later(ms: number): void {
  jest.setSystemTime(new Date(Date.now() + ms));
}

interface Answer {
  refused: Exception | null;
  nextError: unknown;
  // What a renewal handed back, which the client may never read.
  refreshToken: string | null;
  accessToken: string | null;
  signedOut: boolean;
  cleared: Array<string>;
}

async function call(
  uri: "/refresh-token" | "/logout",
  data: {
    body?: JSONObject;
    cookies?: Dictionary<string>;
    bearer?: string;
  },
): Promise<Answer> {
  sendErrorResponse.mockClear();
  sendJsonObjectResponse.mockClear();
  sendEmptySuccessResponse.mockClear();

  const handler: RouteHandler = mockRouter.match("post", uri);
  const req: ExpressRequest = buildRequest(data.body || {}, {
    headers: data.bearer ? { authorization: `Bearer ${data.bearer}` } : {},
  });
  (req as unknown as { cookies: Dictionary<string> }).cookies =
    data.cookies || {};
  const res: ExpressResponse = buildResponse();

  let nextError: unknown = null;
  const next: NextFunction = ((err?: unknown): void => {
    if (err) {
      nextError = err;
    }
  }) as unknown as NextFunction;

  await handler(req, res, next);

  const body: JSONObject | null =
    sendJsonObjectResponse.mock.calls.length > 0
      ? (sendJsonObjectResponse.mock.calls[0]![2] as JSONObject)
      : null;

  return {
    refused:
      sendErrorResponse.mock.calls.length > 0
        ? (sendErrorResponse.mock.calls[0]![2] as Exception)
        : null,
    nextError,
    refreshToken: body ? (body["refreshToken"] as string) : null,
    accessToken: body ? (body["accessToken"] as string) : null,
    signedOut: sendEmptySuccessResponse.mock.calls.length > 0,
    cleared: (res.clearCookie as unknown as jest.Mock).mock.calls.map(
      (args: Array<unknown>): string => {
        return args[0] as string;
      },
    ),
  };
}

// The mobile app's renewal: the refresh token in the body, no cookies.
async function renew(refreshToken: string): Promise<Answer> {
  return await call("/refresh-token", { body: { refreshToken } });
}

// The mobile app's sign-out: the refresh token in the body, its access token as a bearer.
async function signOut(data: {
  refreshToken?: string;
  bearer?: string;
}): Promise<Answer> {
  return await call("/logout", {
    body: data.refreshToken ? { refreshToken: data.refreshToken } : {},
    ...(data.bearer ? { bearer: data.bearer } : {}),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({
    now: NOW,
    // Only the clock: Date, which the decision and the tokens read.
    doNotFake: [
      "hrtime",
      "performance",
      "nextTick",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
      "queueMicrotask",
    ],
  });

  installFakeEnterpriseModule({ userSessionLengths: null });

  table.length = 0;
  rotations = 0;
  revokeLiveSessionOfUserCalls.length = 0;
});

afterEach(() => {
  uninstallEnterpriseModule();
  jest.useRealTimers();
});

describe("a renewal whose answer was lost, then a sign-out", () => {
  it("ends the session, as a sign-out, by the access token the app still holds - expired by then", async () => {
    const { refreshToken, accessToken } = signIn();

    // The renewal goes through at the server; its answer never reaches the app.
    later(14 * MINUTE_IN_MS);
    const lost: Answer = await renew(refreshToken);

    expect(lost.refreshToken).toBe("rotated-refresh-token-1");
    expect(row().refreshToken).not.toBe(refreshToken);

    // Twenty minutes on, the person signs out with what the app holds.
    later(20 * MINUTE_IN_MS);
    const answer: Answer = await signOut({ refreshToken, bearer: accessToken });

    expect(answer.nextError).toBeNull();
    expect(answer.signedOut).toBe(true);
    expect(row()).toEqual(
      expect.objectContaining({
        isRevoked: true,
        endedBy: "access-token",
        cause: SessionEndCause.SignedOut,
      }),
    );
  });

  it("before this fix the same sign-out ended nothing: the refresh token it sends matches no session", async () => {
    const { refreshToken } = signIn();

    await renew(refreshToken);
    // A client that sends no access token: only the refresh token decides, as before.
    await signOut({ refreshToken });

    expect(row().isRevoked).toBe(false);
  });

  it("then neither the token the app had nor the one the lost answer carried renews the session", async () => {
    const { refreshToken, accessToken } = signIn();
    const lost: Answer = await renew(refreshToken);

    await signOut({ refreshToken, bearer: accessToken });

    for (const token of [refreshToken, lost.refreshToken!]) {
      const answer: Answer = await renew(token);

      expect(answer.refused?.message).toBe(
        "Session expired. Please login again.",
      );
      expect(answer.refreshToken).toBeNull();
    }
  });

  it("a renewal that was still on its way lands after the sign-out and is refused", async () => {
    const { refreshToken, accessToken } = signIn();
    const lost: Answer = await renew(refreshToken);

    await signOut({ refreshToken, bearer: accessToken });

    // The app retries with the token the lost answer would have given it.
    const replayed: Answer = await renew(lost.refreshToken!);

    expect(replayed.refused).not.toBeNull();
    expect(row().isRevoked).toBe(true);
  });

  it("the sign-out replayed afterwards ends nothing more, and still answers", async () => {
    const { refreshToken, accessToken } = signIn();
    await renew(refreshToken);
    await signOut({ refreshToken, bearer: accessToken });

    const firstEnd: SessionRow = { ...row() };
    const replay: Answer = await signOut({ refreshToken, bearer: accessToken });

    expect(replay.signedOut).toBe(true);
    expect(replay.nextError).toBeNull();
    expect(row()).toEqual(firstEnd);
  });

  it("the browser does the same with its cookies: the refresh cookie the lost answer would have replaced, and its access cookie", async () => {
    const { refreshToken, accessToken } = signIn();

    await renew(refreshToken);

    const answer: Answer = await call("/logout", {
      cookies: {
        [CookieUtil.getRefreshTokenKey()]: refreshToken,
        [CookieUtil.getUserTokenKey()]: accessToken,
      },
    });

    expect(answer.signedOut).toBe(true);
    expect(row()).toEqual(
      expect.objectContaining({ isRevoked: true, endedBy: "access-token" }),
    );
    expect(answer.cleared).toContain(CookieUtil.getRefreshTokenKey());
  });
});

describe("the token a renewal replaced is good for signing out only", () => {
  it("never renews: the old refresh token is refused, and the session goes on with the new one", async () => {
    const { refreshToken } = signIn();
    const lost: Answer = await renew(refreshToken);

    const again: Answer = await renew(refreshToken);

    expect(again.refused).not.toBeNull();
    expect(row().isRevoked).toBe(false);

    const withTheNewOne: Answer = await renew(lost.refreshToken!);

    expect(withTheNewOne.refused).toBeNull();
    expect(withTheNewOne.refreshToken).toBe("rotated-refresh-token-2");
  });

  it("the access token alone renews nothing either", async () => {
    const { refreshToken, accessToken } = signIn();
    await renew(refreshToken);

    const answer: Answer = await call("/refresh-token", {
      bearer: accessToken,
    });

    expect(answer.refused).not.toBeNull();
    expect(row().isRevoked).toBe(false);
  });
});

describe("what the access token can end, and what it cannot", () => {
  it("a sign-out with the session's current refresh token ends it by that token, as always, without reading the access token", async () => {
    const { refreshToken, accessToken } = signIn();
    const renewed: Answer = await renew(refreshToken);

    await signOut({ refreshToken: renewed.refreshToken!, bearer: accessToken });

    expect(row()).toEqual(
      expect.objectContaining({ isRevoked: true, endedBy: "refresh-token" }),
    );
    expect(revokeLiveSessionOfUserCalls).toEqual([]);
  });

  it("only the session it names: the same person's other device stays signed in", async () => {
    const thisPhone: { refreshToken: string; accessToken: string } = signIn();
    signIn(OTHER_DEVICE_SESSION_ID);

    await renew(thisPhone.refreshToken);
    await signOut({
      refreshToken: thisPhone.refreshToken,
      bearer: thisPhone.accessToken,
    });

    expect(row().isRevoked).toBe(true);
    expect(row(OTHER_DEVICE_SESSION_ID).isRevoked).toBe(false);
  });

  it("a token signed with another key, naming the session, ends nothing", async () => {
    const { refreshToken } = signIn();
    await renew(refreshToken);

    const forged: string = signedWithAnotherKey({
      userId: USER_ID,
      sessionId: SESSION_ID,
      purpose: "UserSession",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const answer: Answer = await signOut({ refreshToken, bearer: forged });

    expect(answer.signedOut).toBe(true);
    expect(answer.nextError).toBeNull();
    expect(row().isRevoked).toBe(false);
    expect(revokeLiveSessionOfUserCalls).toEqual([]);
  });

  it("a session's token never ends another person's session: the user must be the token's own", async () => {
    signIn(OTHER_USERS_SESSION_ID, OTHER_USER_ID);

    // A real token of this person, naming the other person's session.
    const mismatched: string = accessTokenOf(OTHER_USERS_SESSION_ID, USER_ID);

    await signOut({ refreshToken: "stale-refresh-token", bearer: mismatched });

    expect(row(OTHER_USERS_SESSION_ID).isRevoked).toBe(false);
  });

  it("an SSO sign-in's token, or anything that is not a session's, ends nothing", async () => {
    const { refreshToken } = signIn();
    await renew(refreshToken);

    const user: User = new User();
    user._id = USER_ID;
    user.email = new Email("fox.mulder@example.com");
    user.name = new Name("Fox Mulder");

    for (const token of [
      CookieUtil.getSSOToken({
        user,
        projectId: ObjectID.generate(),
        ssoProviderId: ObjectID.generate(),
        ssoProviderType: SsoProviderType.ProjectSSO,
      }),
      "not-a-token",
    ]) {
      const answer: Answer = await signOut({ refreshToken, bearer: token });

      expect(answer.signedOut).toBe(true);
      expect(answer.nextError).toBeNull();
    }

    expect(row().isRevoked).toBe(false);
  });

  it("a session that ended some other way stays as it ended", async () => {
    const { refreshToken, accessToken } = signIn();
    await renew(refreshToken);

    row().isRevoked = true;
    row().cause = "Signed out on another device";

    await signOut({ refreshToken, bearer: accessToken });

    expect(row().cause).toBe("Signed out on another device");
    expect(row().endedBy).toBeNull();
  });

  it("a client that holds only its access token signs out by it", async () => {
    signIn();
    const accessToken: string = accessTokenOf(SESSION_ID);

    later(60 * MINUTE_IN_MS);
    const answer: Answer = await signOut({ bearer: accessToken });

    expect(answer.signedOut).toBe(true);
    expect(row()).toEqual(
      expect.objectContaining({ isRevoked: true, endedBy: "access-token" }),
    );
  });

  it("nothing at all: nothing ended, and the sign-out still answers", async () => {
    signIn();

    const answer: Answer = await signOut({});

    expect(answer.signedOut).toBe(true);
    expect(row().isRevoked).toBe(false);
  });
});
