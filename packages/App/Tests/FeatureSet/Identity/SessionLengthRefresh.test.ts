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
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import SessionEndedException, {
  SESSION_ENDED_MESSAGES,
} from "Common/Types/Exception/SessionEndedException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  INACTIVE_FOR_IN_SECONDS_FIELD,
  SessionEndReason,
  SessionLengths,
} from "Common/Types/UserSession/SessionLength";
import FakeEnterpriseModule, {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * POST /refresh-token UNDER THE SESSION LENGTHS A MASTER ADMIN SETS.
 *
 * Admin Dashboard > Settings > Session Length (Enterprise) sets how long a
 * sign-in lasts: a session length since it signed in, and an idle timeout
 * since its person last used OneUptime - for every sign-in, and for SSO
 * sign-ins their own when the master admin sets them apart. A session's
 * access token lives 15 minutes; this renewal is where a session that has
 * reached either one ends, for good:
 *
 *   - refused with SessionEndedException - a 401, as every session that is
 *     over, whose message says which, so the Dashboard's sign-in page says
 *     why - its cookies cleared and the session revoked with its reason;
 *   - while an idle timeout is set, how long the Dashboard says its person
 *     has not clicked, typed or scrolled (inactiveForInSeconds) counts: a
 *     renewal in a tab left open in the background is no activity - but
 *     never further back than what the session already knew;
 *   - a refresh token whose session the change already ended (the sweep
 *     when a master admin shortens the lengths) says why too;
 *   - lengths that cannot be read refuse the renewal, never let it past
 *     them; without the Enterprise module nothing of this applies.
 *
 * The route runs through its real handler, with the real decision
 * (UserSessionService.decideRenewal), the real cookies and tokens; the
 * session service's database calls, the account lookup and the response
 * writer are stand-ins.
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

const USER_ID: string = "5e550000-0000-4000-8000-0000000000a1";
const SESSION_ID: string = "5e550000-0000-4000-8000-0000000000a2";
const RENEWED_SESSION_ID: string = "5e550000-0000-4000-8000-0000000000a3";

const MINUTE_IN_MS: number = 60 * 1000;
const HOUR_IN_MS: number = 60 * MINUTE_IN_MS;

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
        user._id = "5e550000-0000-4000-8000-0000000000a1";
        user.email = new EmailType("dana.scully@example.com");
        user.name = "Dana Scully" as never;
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

const findActiveSessionByRefreshToken: jest.Mock = jest.fn();
const renewSessionWithNewRefreshToken: jest.Mock = jest.fn();
const endSessionByLength: jest.Mock = jest.fn();
const getSessionLengthEndReason: jest.Mock = jest.fn();
const revokeSessionById: jest.Mock = jest.fn();

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
      // The real decision, under the lengths the fake Enterprise module holds.
      decideRenewal: (data: unknown): Promise<unknown> => {
        return actual.default.decideRenewal(data);
      },
      findActiveSessionByRefreshToken: (...args: Array<unknown>): unknown => {
        return findActiveSessionByRefreshToken(...args);
      },
      renewSessionWithNewRefreshToken: (...args: Array<unknown>): unknown => {
        return renewSessionWithNewRefreshToken(...args);
      },
      endSessionByLength: (...args: Array<unknown>): unknown => {
        return endSessionByLength(...args);
      },
      getSessionLengthEndReason: (...args: Array<unknown>): unknown => {
        return getSessionLengthEndReason(...args);
      },
      revokeSessionById: (...args: Array<unknown>): unknown => {
        return revokeSessionById(...args);
      },
      revokeAllSessionsByUserId: jest.fn(),
      revokeSessionByRefreshToken: jest.fn(),
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
      sendEntityResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/Authentication";

const NOW: Date = new Date("2026-11-02T09:00:00.000Z");

interface Outcome {
  refused: Exception | null;
  nextError: unknown;
  cleared: Array<string>;
  bodyAccessToken: string | null;
}

let fake: FakeEnterpriseModule;

// The session the refresh token belongs to, as Postgres holds it.
const sessionRow: (data: {
  signedInAgoMs: number;
  lastActiveAgoMs?: number | undefined;
  isSsoSignIn?: boolean | undefined;
}) => UserSession = (data: {
  signedInAgoMs: number;
  lastActiveAgoMs?: number | undefined;
  isSsoSignIn?: boolean | undefined;
}): UserSession => {
  const session: UserSession = new UserSession();
  session.id = new ObjectID(SESSION_ID);
  session.userId = new ObjectID(USER_ID);
  session.createdAt = new Date(NOW.getTime() - data.signedInAgoMs);
  session.lastActiveAt = new Date(
    NOW.getTime() - (data.lastActiveAgoMs ?? data.signedInAgoMs),
  );
  session.refreshTokenExpiresAt = OneUptimeDate.getSomeDaysAfter(30);
  session.additionalInfo = { isGlobalLogin: !data.isSsoSignIn };
  return session;
};

const lengthsOf: (
  standard: { length?: number; idle?: number },
  sso?: { length?: number; idle?: number },
) => SessionLengths = (
  standard: { length?: number; idle?: number },
  sso?: { length?: number; idle?: number },
): SessionLengths => {
  const ssoRule: { length?: number; idle?: number } = sso || standard;

  return {
    standard: {
      lengthInMinutes: standard.length ?? null,
      idleTimeoutInMinutes: standard.idle ?? null,
    },
    sso: {
      lengthInMinutes: ssoRule.length ?? null,
      idleTimeoutInMinutes: ssoRule.idle ?? null,
    },
  };
};

async function renew(body: JSONObject = {}): Promise<Outcome> {
  const handler: RouteHandler = mockRouter.match("post", "/refresh-token");
  const req: ExpressRequest = buildRequest(body);
  (req as unknown as { cookies: Dictionary<string> }).cookies = {
    [CookieUtil.getRefreshTokenKey()]: "refresh-token",
  };
  const res: ExpressResponse = buildResponse();

  let nextError: unknown = null;

  const next: NextFunction = ((err?: unknown): void => {
    if (err) {
      nextError = err;
    }
  }) as unknown as NextFunction;

  await handler(req, res, next);

  const refused: Exception | null =
    sendErrorResponse.mock.calls.length > 0
      ? (sendErrorResponse.mock.calls[0]![2] as Exception)
      : null;

  const cleared: Array<string> = (
    res.clearCookie as unknown as jest.Mock
  ).mock.calls.map((call: Array<unknown>): string => {
    return call[0] as string;
  });

  const bodyAccessToken: string | null =
    sendJsonObjectResponse.mock.calls.length > 0
      ? ((sendJsonObjectResponse.mock.calls[0]![2] as JSONObject)[
          "accessToken"
        ] as string)
      : null;

  return { refused, nextError, cleared, bodyAccessToken };
}

// What renewSessionWithNewRefreshToken was asked, and hands back.
function renewedWith(): {
  lastActiveAt: Date;
  lengths: SessionLengths | null;
} {
  expect(renewSessionWithNewRefreshToken).toHaveBeenCalledTimes(1);

  return renewSessionWithNewRefreshToken.mock.calls[0]![0] as {
    lastActiveAt: Date;
    lengths: SessionLengths | null;
  };
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

  fake = installFakeEnterpriseModule({ userSessionLengths: null });

  endSessionByLength.mockResolvedValue(undefined);
  getSessionLengthEndReason.mockResolvedValue(null);

  renewSessionWithNewRefreshToken.mockImplementation(
    async (options: { session: UserSession; lastActiveAt: Date }) => {
      return {
        session: { id: new ObjectID(RENEWED_SESSION_ID) },
        refreshToken: "rotated-refresh-token",
        refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(30),
        signedInAt: options.session.createdAt,
        lastActiveAt: options.lastActiveAt,
        accessTokenExpiresInSeconds: 600,
        ssoSignInExpiresInSeconds: 30 * 24 * 60 * 60,
      };
    },
  );
});

afterEach(() => {
  uninstallEnterpriseModule();
  jest.useRealTimers();
});

describe("a session past its length", () => {
  it("is ended for good: refused with why, revoked with its reason, its cookies cleared", async () => {
    fake.userSessionLengths = lengthsOf({ length: 8 * 60 });
    findActiveSessionByRefreshToken.mockResolvedValue(
      sessionRow({
        signedInAgoMs: 9 * HOUR_IN_MS,
        lastActiveAgoMs: MINUTE_IN_MS,
      }),
    );

    const outcome: Outcome = await renew();

    expect(outcome.nextError).toBeNull();
    expect(outcome.refused).toBeInstanceOf(SessionEndedException);
    expect(outcome.refused!.message).toBe(
      SESSION_ENDED_MESSAGES[SessionEndReason.LengthReached],
    );
    expect(endSessionByLength).toHaveBeenCalledTimes(1);
    expect(endSessionByLength.mock.calls[0]![0].toString()).toBe(SESSION_ID);
    expect(endSessionByLength.mock.calls[0]![1]).toBe(
      SessionEndReason.LengthReached,
    );
    expect(renewSessionWithNewRefreshToken).not.toHaveBeenCalled();
    // Every cookie the request carried (CookieUtil.removeAllCookies).
    expect(outcome.cleared).toContain(CookieUtil.getRefreshTokenKey());
    expect(outcome.bodyAccessToken).toBeNull();
  });

  it("however active its person is: the length counts from the sign-in", async () => {
    fake.userSessionLengths = lengthsOf({ length: 60 });
    findActiveSessionByRefreshToken.mockResolvedValue(
      sessionRow({ signedInAgoMs: 61 * MINUTE_IN_MS, lastActiveAgoMs: 0 }),
    );

    const outcome: Outcome = await renew({
      [INACTIVE_FOR_IN_SECONDS_FIELD]: 0,
    });

    expect(outcome.refused).toBeInstanceOf(SessionEndedException);
    expect(endSessionByLength.mock.calls[0]![1]).toBe(
      SessionEndReason.LengthReached,
    );
  });
});

describe("a session past its idle timeout", () => {
  it("is ended, and the refusal says it was the inactivity", async () => {
    fake.userSessionLengths = lengthsOf({ idle: 30 });
    findActiveSessionByRefreshToken.mockResolvedValue(
      sessionRow({
        signedInAgoMs: 3 * HOUR_IN_MS,
        lastActiveAgoMs: 45 * MINUTE_IN_MS,
      }),
    );

    const outcome: Outcome = await renew();

    expect(outcome.refused!.message).toBe(
      SESSION_ENDED_MESSAGES[SessionEndReason.Inactive],
    );
    expect(endSessionByLength.mock.calls[0]![1]).toBe(
      SessionEndReason.Inactive,
    );
    expect(renewSessionWithNewRefreshToken).not.toHaveBeenCalled();
  });

  it("a background renewal is no activity: the session keeps its person's own last activity", async () => {
    fake.userSessionLengths = lengthsOf({ idle: 30 });
    findActiveSessionByRefreshToken.mockResolvedValue(
      sessionRow({
        signedInAgoMs: 3 * HOUR_IN_MS,
        lastActiveAgoMs: 20 * MINUTE_IN_MS,
      }),
    );

    // The tab says its person has not used OneUptime for 5 minutes.
    const outcome: Outcome = await renew({
      [INACTIVE_FOR_IN_SECONDS_FIELD]: 5 * 60,
    });

    expect(outcome.refused).toBeNull();
    expect(renewedWith().lastActiveAt.getTime()).toBe(
      NOW.getTime() - 5 * MINUTE_IN_MS,
    );
  });

  it("a report never reaches further back than what the session already knew", async () => {
    fake.userSessionLengths = lengthsOf({ idle: 30 });
    findActiveSessionByRefreshToken.mockResolvedValue(
      sessionRow({
        signedInAgoMs: 3 * HOUR_IN_MS,
        lastActiveAgoMs: 20 * MINUTE_IN_MS,
      }),
    );

    const outcome: Outcome = await renew({
      [INACTIVE_FOR_IN_SECONDS_FIELD]: 25 * 60,
    });

    expect(outcome.refused).toBeNull();
    expect(renewedWith().lastActiveAt.getTime()).toBe(
      NOW.getTime() - 20 * MINUTE_IN_MS,
    );
  });

  it("a report that says nothing usable is no report: the renewal is the activity", async () => {
    fake.userSessionLengths = lengthsOf({ idle: 30 });
    findActiveSessionByRefreshToken.mockResolvedValue(
      sessionRow({
        signedInAgoMs: 3 * HOUR_IN_MS,
        lastActiveAgoMs: 20 * MINUTE_IN_MS,
      }),
    );

    for (const value of ["600", -1, 1e12, null]) {
      renewSessionWithNewRefreshToken.mockClear();

      const outcome: Outcome = await renew({
        [INACTIVE_FOR_IN_SECONDS_FIELD]: value,
      });

      expect(outcome.refused).toBeNull();
      expect(renewedWith().lastActiveAt.getTime()).toBe(NOW.getTime());
    }
  });

  it("without an idle timeout the report is not asked: every renewal is activity, as always", async () => {
    fake.userSessionLengths = lengthsOf({ length: 8 * 60 });
    findActiveSessionByRefreshToken.mockResolvedValue(
      sessionRow({
        signedInAgoMs: 2 * HOUR_IN_MS,
        lastActiveAgoMs: HOUR_IN_MS,
      }),
    );

    await renew({ [INACTIVE_FOR_IN_SECONDS_FIELD]: 3600 });

    expect(renewedWith().lastActiveAt.getTime()).toBe(NOW.getTime());
  });
});

describe("a session within the lengths", () => {
  it("is renewed under the lengths it was decided by, and its new token says when it signed in", async () => {
    const lengths: SessionLengths = lengthsOf({ length: 8 * 60, idle: 60 });
    fake.userSessionLengths = lengths;
    findActiveSessionByRefreshToken.mockResolvedValue(
      sessionRow({
        signedInAgoMs: 2 * HOUR_IN_MS,
        lastActiveAgoMs: 10 * MINUTE_IN_MS,
      }),
    );

    const outcome: Outcome = await renew({
      [INACTIVE_FOR_IN_SECONDS_FIELD]: 120,
    });

    expect(outcome.refused).toBeNull();
    expect(outcome.nextError).toBeNull();
    expect(endSessionByLength).not.toHaveBeenCalled();
    expect(renewedWith().lengths).toEqual(lengths);

    const claims: JSONObject = JSONWebToken.decodeJsonPayload(
      outcome.bodyAccessToken!,
    );

    expect(claims["sessionId"]).toBe(RENEWED_SESSION_ID);
    expect(claims["signedInAt"]).toBe(NOW.getTime() - 2 * HOUR_IN_MS);
    expect(claims["lastActiveAt"]).toBe(NOW.getTime() - 2 * MINUTE_IN_MS);
    // As long as the session service said it may live, not a fixed 15 minutes.
    expect((claims["exp"] as number) - (claims["iat"] as number)).toBe(600);
  });
});

describe("SSO sign-ins", () => {
  it("are held to their own lengths when the master admin set them apart", async () => {
    fake.userSessionLengths = lengthsOf({ length: 8 * 60 }, { length: 60 });

    findActiveSessionByRefreshToken.mockResolvedValue(
      sessionRow({ signedInAgoMs: 2 * HOUR_IN_MS, isSsoSignIn: true }),
    );

    const sso: Outcome = await renew();

    expect(sso.refused).toBeInstanceOf(SessionEndedException);

    jest.clearAllMocks();
    findActiveSessionByRefreshToken.mockResolvedValue(
      sessionRow({ signedInAgoMs: 2 * HOUR_IN_MS }),
    );

    const password: Outcome = await renew();

    expect(password.refused).toBeNull();
    expect(renewSessionWithNewRefreshToken).toHaveBeenCalledTimes(1);
  });
});

describe("a refresh token whose session is no longer there", () => {
  it("one the session lengths ended (the sweep, when a master admin shortened them) says why", async () => {
    findActiveSessionByRefreshToken.mockResolvedValue(null);
    getSessionLengthEndReason.mockResolvedValue(SessionEndReason.Inactive);

    const outcome: Outcome = await renew();

    expect(getSessionLengthEndReason).toHaveBeenCalledWith("refresh-token");
    expect(outcome.refused).toBeInstanceOf(SessionEndedException);
    expect(outcome.refused!.message).toBe(
      SESSION_ENDED_MESSAGES[SessionEndReason.Inactive],
    );
    expect(outcome.cleared).toContain(CookieUtil.getRefreshTokenKey());
  });

  it("one that ended any other way (signed out, a password changed) is refused as before", async () => {
    findActiveSessionByRefreshToken.mockResolvedValue(null);

    const outcome: Outcome = await renew();

    expect(outcome.refused).toBeInstanceOf(NotAuthenticatedException);
    expect(outcome.refused).not.toBeInstanceOf(SessionEndedException);
    expect(outcome.refused!.message).toBe(
      "Session expired. Please login again.",
    );
  });
});

describe("when the lengths cannot be decided", () => {
  it("lengths that cannot be read refuse the renewal: never a pass", async () => {
    fake.userSessionLengthsError = new Error("not read yet");
    findActiveSessionByRefreshToken.mockResolvedValue(
      sessionRow({ signedInAgoMs: HOUR_IN_MS }),
    );

    const outcome: Outcome = await renew();

    expect((outcome.nextError as Error).message).toBe("not read yet");
    expect(renewSessionWithNewRefreshToken).not.toHaveBeenCalled();
    expect(endSessionByLength).not.toHaveBeenCalled();
  });

  it("on the Community Edition there are none: a session renews as it always has", async () => {
    uninstallEnterpriseModule();
    findActiveSessionByRefreshToken.mockResolvedValue(
      sessionRow({
        signedInAgoMs: 200 * 24 * HOUR_IN_MS,
        lastActiveAgoMs: 14 * 24 * HOUR_IN_MS,
      }),
    );

    const outcome: Outcome = await renew({
      [INACTIVE_FOR_IN_SECONDS_FIELD]: 3600,
    });

    expect(outcome.refused).toBeNull();
    expect(renewedWith().lengths).toBeNull();
    expect(renewedWith().lastActiveAt.getTime()).toBe(NOW.getTime());
  });
});
