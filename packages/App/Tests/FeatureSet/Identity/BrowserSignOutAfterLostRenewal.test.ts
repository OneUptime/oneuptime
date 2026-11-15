import {
  buildRequest,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import User from "Common/Models/DatabaseModels/User";
import UserSession from "Common/Models/DatabaseModels/UserSession";
import { IdentityRoute } from "Common/ServiceRoute";
import CookieUtil, {
  SESSION_SIGN_OUT_COOKIE_NAME,
  SESSION_SIGN_OUT_COOKIE_PATH,
} from "Common/Server/Utils/Cookie";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import { listProductFiles } from "Common/Tests/Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "Common/Tests/Helpers/TagStripScan";
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
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A BROWSER'S SIGN-OUT AFTER A LOST RENEWAL ENDS ITS SESSION, ONCE ITS
 * ACCESS-TOKEN COOKIE HAS GONE TOO (issue #8638).
 *
 * The server rotates the refresh token at every renewal (POST
 * /refresh-token) and keeps only the new one. When a renewal's answer never
 * reaches the browser - a timeout after the server had committed, a dropped
 * connection - the browser keeps the refresh token the renewal replaced,
 * which matches no session. #8612 let a sign-out end the session its own
 * access token names, expired or not. But a browser keeps that token in a
 * cookie that lives fifteen minutes: a sign-out after that carried nothing
 * that named the session, and the session stayed signed in on the server
 * until its idle timeout or its length ended it.
 *
 * Every sign-in and renewal now also leaves a sign-out cookie, which names
 * the session for its sign-out only: HttpOnly, SameSite=Strict, sent only
 * to POST /identity/logout, for as long as the refresh token. These play
 * every order against the real /refresh-token and /logout handlers and the
 * real CookieUtil, with real tokens and the clock under fake timers, and a
 * browser's cookie jar that keeps what each answer set - when the answer
 * reaches it - and sends each request what a browser would: the cookies
 * that have not run out and whose path the request's path matches
 * (RFC 6265, 5.1.4). The session table is a stand-in: each session's one
 * current refresh token, rotated at each renewal, and whether, how and how
 * often it ended.
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

const USER_ID: string = "8f8f0000-0000-4000-8000-0000000000b1";
const OTHER_USER_ID: string = "8f8f0000-0000-4000-8000-0000000000b2";
const SESSION_ID: string = "8f8f0000-0000-4000-8000-0000000000c1";
const OTHER_BROWSER_SESSION_ID: string = "8f8f0000-0000-4000-8000-0000000000c2";
const OTHER_USERS_SESSION_ID: string = "8f8f0000-0000-4000-8000-0000000000c3";

const MINUTE_IN_MS: number = 60 * 1000;
const DAY_IN_MS: number = 24 * 60 * MINUTE_IN_MS;

// The people the stand-in user table knows, by id.
jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (options: { id: { toString: () => string } }) => {
        const { default: UserModel } = jest.requireActual(
          "Common/Models/DatabaseModels/User",
        ) as { default: typeof User };
        const { default: EmailType } = jest.requireActual(
          "Common/Types/Email",
        ) as { default: typeof Email };
        const user: User = new UserModel();
        user._id = options.id.toString();
        user.email = new EmailType(
          `person-${options.id.toString()}@example.com`,
        );
        user.name = "A Person" as never;
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
  endedBy: "refresh-token" | "session-id" | "elsewhere" | null;
  cause: unknown;
  // How many times something ended it: a sign-out ends a session once.
  ends: number;
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

// What /logout asked to end by a session's id: the access token's, or the sign-out cookie's.
const revokeLiveSessionOfUserCalls: Array<{
  userId: string;
  sessionId: string;
}> = [];

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
        row.ends++;
        return true;
      },
      // Only a live session of that user, as the real query asks.
      revokeLiveSessionOfUser: async (
        data: { userId: ObjectID; sessionId: ObjectID },
        options: { cause: unknown },
      ): Promise<boolean> => {
        revokeLiveSessionOfUserCalls.push({
          userId: data.userId.toString(),
          sessionId: data.sessionId.toString(),
        });

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
        row.endedBy = "session-id";
        row.cause = options.cause;
        row.ends++;
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

// Where the dashboards renew and sign out: IDENTITY_URL, then the route.
const RENEWAL_PATH: string = `${IdentityRoute.toString()}/refresh-token`;
const SIGN_OUT_PATH: string = `${IdentityRoute.toString()}/logout`;

// What an answer did to cookies, in the order it did it.
interface CookieWrite {
  kind: "set" | "clear";
  name: string;
  value: string;
  options: JSONObject;
}

interface JarCookie {
  name: string;
  value: string;
  path: string;
  expiresAtMs: number | null;
  httpOnly: boolean;
  sameSite: string | undefined;
}

/*
 * A browser's cookie jar, for one host. It keeps what an answer set and
 * clears what it cleared - a cookie is its name and its path - and sends a
 * request the cookies that have not run out and whose path matches.
 */
class Browser {
  private jar: Array<JarCookie> = [];

  // RFC 6265, 5.1.4.
  private static pathMatches(requestPath: string, cookiePath: string): boolean {
    if (requestPath === cookiePath) {
      return true;
    }

    return (
      requestPath.startsWith(cookiePath) &&
      (cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/")
    );
  }

  private unexpired(): Array<JarCookie> {
    const now: number = Date.now();

    this.jar = this.jar.filter((cookie: JarCookie): boolean => {
      return cookie.expiresAtMs === null || cookie.expiresAtMs > now;
    });

    return this.jar;
  }

  // Longer paths first (RFC 6265, 5.4): the first of a name is the one cookie-parser keeps.
  public cookiesFor(requestPath: string): Dictionary<string> {
    const sent: Dictionary<string> = {};

    const matching: Array<JarCookie> = this.unexpired()
      .filter((cookie: JarCookie): boolean => {
        return Browser.pathMatches(requestPath, cookie.path);
      })
      .sort((a: JarCookie, b: JarCookie): number => {
        return b.path.length - a.path.length;
      });

    for (const cookie of matching) {
      if (sent[cookie.name] === undefined) {
        sent[cookie.name] = cookie.value;
      }
    }

    return sent;
  }

  public take(writes: Array<CookieWrite>): void {
    for (const write of writes) {
      const cookiePath: string = (write.options["path"] as string) || "/";

      this.jar = this.jar.filter((cookie: JarCookie): boolean => {
        return !(cookie.name === write.name && cookie.path === cookiePath);
      });

      const maxAge: unknown = write.options["maxAge"];

      if (
        write.kind === "clear" ||
        (typeof maxAge === "number" && maxAge <= 0)
      ) {
        continue;
      }

      this.jar.push({
        name: write.name,
        value: write.value,
        path: cookiePath,
        expiresAtMs: typeof maxAge === "number" ? Date.now() + maxAge : null,
        httpOnly: write.options["httpOnly"] === true,
        sameSite: write.options["sameSite"] as string | undefined,
      });
    }
  }

  public cookie(name: string): JarCookie | undefined {
    return this.unexpired().find((cookie: JarCookie): boolean => {
      return cookie.name === name;
    });
  }

  public forget(name: string): void {
    this.jar = this.jar.filter((cookie: JarCookie): boolean => {
      return cookie.name !== name;
    });
  }

  public put(cookie: Omit<JarCookie, "expiresAtMs">): void {
    this.forget(cookie.name);
    this.jar.push({ ...cookie, expiresAtMs: Date.now() + 30 * DAY_IN_MS });
  }
}

function recorder(writes: Array<CookieWrite>): ExpressResponse {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    cookie: jest.fn((name: string, value: string, options: JSONObject) => {
      writes.push({ kind: "set", name, value, options: options || {} });
    }),
    clearCookie: jest.fn((name: string, options: JSONObject) => {
      writes.push({ kind: "clear", name, value: "", options: options || {} });
    }),
  } as unknown as ExpressResponse;
}

function person(userId: string): User {
  const user: User = new User();
  user.id = new ObjectID(userId);
  user.email = new Email(`person-${userId}@example.com`);
  user.name = new Name("A Person");
  user.isMasterAdmin = false;
  return user;
}

/*
 * A sign-in from this browser: a session with its first refresh token, and
 * the cookies every sign-in hands a browser (CookieUtil.setUserCookie).
 */
function signIn(
  browser: Browser,
  sessionId: string = SESSION_ID,
  userId: string = USER_ID,
): { refreshToken: string } {
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
    ends: 0,
  });

  const writes: Array<CookieWrite> = [];

  CookieUtil.setUserCookie({
    expressResponse: recorder(writes),
    user: person(userId),
    isGlobalLogin: true,
    sessionId: new ObjectID(sessionId),
    refreshToken,
    refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(30),
    accessTokenExpiresInSeconds: 15 * 60,
  });

  browser.take(writes);

  return { refreshToken };
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
  // What a renewal handed back, which the browser may never read.
  refreshToken: string | null;
  signedOut: boolean;
  // The cookies the request carried.
  sent: Dictionary<string>;
  writes: Array<CookieWrite>;
}

/*
 * A request to the identity API, as `browser` sends it: its cookies for the
 * route's path, unless `cookies` says exactly what goes. The answer reaches
 * the browser unless `isLost`.
 */
async function send(
  uri: "/refresh-token" | "/logout",
  data: {
    browser?: Browser;
    cookies?: Dictionary<string>;
    body?: JSONObject;
    headers?: Record<string, string>;
    isLost?: boolean;
  },
): Promise<Answer> {
  sendErrorResponse.mockClear();
  sendJsonObjectResponse.mockClear();
  sendEmptySuccessResponse.mockClear();

  const requestPath: string = uri === "/logout" ? SIGN_OUT_PATH : RENEWAL_PATH;
  const sent: Dictionary<string> =
    data.cookies || data.browser?.cookiesFor(requestPath) || {};

  const handler: RouteHandler = mockRouter.match("post", uri);
  const req: ExpressRequest = buildRequest(data.body || {}, {
    headers: data.headers || {},
  });
  (req as unknown as { cookies: Dictionary<string> }).cookies = { ...sent };

  const writes: Array<CookieWrite> = [];
  const res: ExpressResponse = recorder(writes);

  let nextError: unknown = null;
  const next: NextFunction = ((err?: unknown): void => {
    if (err) {
      nextError = err;
    }
  }) as unknown as NextFunction;

  await handler(req, res, next);

  if (data.browser && !data.isLost) {
    data.browser.take(writes);
  }

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
    signedOut: sendEmptySuccessResponse.mock.calls.length > 0,
    sent,
    writes,
  };
}

// The dashboard's renewal: its cookies, and what it reports of its person's activity.
async function renew(
  browser: Browser,
  options: { isLost?: boolean } = {},
): Promise<Answer> {
  return await send("/refresh-token", {
    browser,
    body: {},
    isLost: options.isLost === true,
  });
}

// The dashboard's sign-out (UserUtil.logout): a POST with its cookies, and nothing else.
async function signOut(browser: Browser): Promise<Answer> {
  return await send("/logout", { browser });
}

// A sign-out with exactly these cookies, as another browser, or a forger, would send it.
async function signOutWith(cookies: Dictionary<string>): Promise<Answer> {
  return await send("/logout", { cookies });
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

/*
 * A lost renewal, as the browser lives it: the server rotates the refresh
 * token, and the answer - with the cookies that would replace the
 * browser's - never arrives.
 */
async function loseARenewal(browser: Browser): Promise<Answer> {
  const lost: Answer = await renew(browser, { isLost: true });

  expect(lost.refused).toBeNull();
  expect(lost.refreshToken).toMatch(/^rotated-refresh-token-/);

  return lost;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({
    now: NOW,
    // Only the clock: Date, which the decision, the tokens and the jar read.
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

describe("a renewal whose answer was lost, then the browser signs out", () => {
  it("after its access-token cookie has gone: the sign-out cookie names the session, and it ends, as a sign-out", async () => {
    const browser: Browser = new Browser();
    const { refreshToken } = signIn(browser);

    later(10 * MINUTE_IN_MS);
    await loseARenewal(browser);

    // Twenty minutes on, the fifteen-minute access-token cookie has gone.
    later(20 * MINUTE_IN_MS);
    expect(browser.cookie(CookieUtil.getUserTokenKey())).toBeUndefined();

    const answer: Answer = await signOut(browser);

    // It carried the refresh token the renewal replaced, and no access token.
    expect(answer.sent[CookieUtil.getRefreshTokenKey()]).toBe(refreshToken);
    expect(answer.sent[CookieUtil.getUserTokenKey()]).toBeUndefined();
    expect(answer.sent[SESSION_SIGN_OUT_COOKIE_NAME]).toBeTruthy();

    expect(answer.nextError).toBeNull();
    expect(answer.signedOut).toBe(true);
    expect(row()).toEqual(
      expect.objectContaining({
        isRevoked: true,
        endedBy: "session-id",
        cause: SessionEndCause.SignedOut,
        ends: 1,
      }),
    );
    expect(revokeLiveSessionOfUserCalls).toEqual([
      { userId: USER_ID, sessionId: SESSION_ID },
    ]);
  });

  it("an hour, or a week, on: still ended, as long as the refresh token would have lasted", async () => {
    for (const after of [60 * MINUTE_IN_MS, 7 * DAY_IN_MS, 29 * DAY_IN_MS]) {
      table.length = 0;
      const browser: Browser = new Browser();
      signIn(browser);
      await loseARenewal(browser);

      later(after);
      await signOut(browser);

      expect({ after, ended: row().isRevoked }).toEqual({ after, ended: true });
    }
  });

  it("before this fix the same sign-out ended nothing: a browser without the sign-out cookie names no session", async () => {
    const browser: Browser = new Browser();
    signIn(browser);
    // As a browser signed in before this release holds its cookies.
    browser.forget(SESSION_SIGN_OUT_COOKIE_NAME);

    await loseARenewal(browser);
    later(20 * MINUTE_IN_MS);

    const answer: Answer = await signOut(browser);

    expect(answer.signedOut).toBe(true);
    expect(row().isRevoked).toBe(false);
    expect(revokeLiveSessionOfUserCalls).toEqual([]);
  });

  it("while its access-token cookie is still there, the access token ends it (issue #8592), once", async () => {
    const browser: Browser = new Browser();
    signIn(browser);

    later(5 * MINUTE_IN_MS);
    await loseARenewal(browser);
    later(5 * MINUTE_IN_MS);

    const answer: Answer = await signOut(browser);

    expect(answer.sent[CookieUtil.getUserTokenKey()]).toBeTruthy();
    expect(answer.sent[SESSION_SIGN_OUT_COOKIE_NAME]).toBeTruthy();
    expect(row()).toEqual(
      expect.objectContaining({
        isRevoked: true,
        cause: SessionEndCause.SignedOut,
        ends: 1,
      }),
    );
    // Asked once: the sign-out cookie is read only when nothing else ended it.
    expect(revokeLiveSessionOfUserCalls).toHaveLength(1);
  });

  it("a browser signed in before this release gets the cookie at its next renewal, and is covered from then on", async () => {
    const browser: Browser = new Browser();
    signIn(browser);
    browser.forget(SESSION_SIGN_OUT_COOKIE_NAME);

    later(10 * MINUTE_IN_MS);
    const renewed: Answer = await renew(browser);

    expect(renewed.refused).toBeNull();
    expect(browser.cookie(SESSION_SIGN_OUT_COOKIE_NAME)).toBeDefined();

    later(10 * MINUTE_IN_MS);
    await loseARenewal(browser);
    later(20 * MINUTE_IN_MS);
    await signOut(browser);

    expect(row().isRevoked).toBe(true);
  });

  /*
   * What a dashboard usually does after a lost renewal: its next renewal,
   * with the refresh token the lost one replaced, is refused - and clears
   * every cookie it was sent - and the dashboard signs out at once
   * (API.handleError, UserUtil.logout). The sign-out cookie is never sent
   * to a renewal, so it is still there for that sign-out.
   */
  it("the sign-out the dashboard sends itself, right after its next renewal was refused, ends the session", async () => {
    const browser: Browser = new Browser();
    signIn(browser);

    later(10 * MINUTE_IN_MS);
    await loseARenewal(browser);
    later(10 * MINUTE_IN_MS);

    const refused: Answer = await renew(browser);

    expect(refused.refused?.message).toBe(
      "Session expired. Please login again.",
    );
    // The renewal was never sent the sign-out cookie, and left it alone.
    expect(refused.sent[SESSION_SIGN_OUT_COOKIE_NAME]).toBeUndefined();
    expect(
      refused.writes.filter((write: CookieWrite): boolean => {
        return write.name === SESSION_SIGN_OUT_COOKIE_NAME;
      }),
    ).toEqual([]);
    expect(browser.cookie(CookieUtil.getRefreshTokenKey())).toBeUndefined();
    expect(browser.cookie(SESSION_SIGN_OUT_COOKIE_NAME)).toBeDefined();

    const answer: Answer = await signOut(browser);

    expect(Object.keys(answer.sent)).toEqual([SESSION_SIGN_OUT_COOKIE_NAME]);
    expect(row()).toEqual(
      expect.objectContaining({
        isRevoked: true,
        endedBy: "session-id",
        cause: SessionEndCause.SignedOut,
        ends: 1,
      }),
    );
  });

  it("a renewal still on its way, landing after the sign-out, is refused", async () => {
    const browser: Browser = new Browser();
    signIn(browser);
    const lost: Answer = await loseARenewal(browser);

    later(20 * MINUTE_IN_MS);
    await signOut(browser);

    // The renewal the lost answer would have let the browser send.
    const replayed: Answer = await send("/refresh-token", {
      cookies: { [CookieUtil.getRefreshTokenKey()]: lost.refreshToken! },
    });

    expect(replayed.refused).not.toBeNull();
    expect(replayed.refreshToken).toBeNull();
    expect(row()).toEqual(
      expect.objectContaining({ isRevoked: true, ends: 1 }),
    );
  });
});

describe("after the sign-out", () => {
  it("neither the refresh token the browser had nor the one the lost answer carried renews the session", async () => {
    const browser: Browser = new Browser();
    const { refreshToken } = signIn(browser);
    const lost: Answer = await loseARenewal(browser);

    later(20 * MINUTE_IN_MS);
    await signOut(browser);

    for (const token of [refreshToken, lost.refreshToken!]) {
      const answer: Answer = await send("/refresh-token", {
        cookies: { [CookieUtil.getRefreshTokenKey()]: token },
      });

      expect(answer.refused?.message).toBe(
        "Session expired. Please login again.",
      );
      expect(answer.refreshToken).toBeNull();
    }

    expect(row().isRevoked).toBe(true);
  });

  it("the sign-out replayed with a copy of every cookie it carried ends nothing more, records nothing, and still answers", async () => {
    const browser: Browser = new Browser();
    signIn(browser);
    await loseARenewal(browser);
    later(20 * MINUTE_IN_MS);

    const first: Answer = await signOut(browser);
    const firstEnd: SessionRow = { ...row() };

    later(MINUTE_IN_MS);
    const replay: Answer = await signOutWith(first.sent);

    expect(replay.signedOut).toBe(true);
    expect(replay.nextError).toBeNull();
    expect(row()).toEqual(firstEnd);
    expect(row().ends).toBe(1);
  });

  it("the browser holds no token of the session any more: the sign-out cleared the sign-out cookie on its own path", async () => {
    const browser: Browser = new Browser();
    signIn(browser);
    await loseARenewal(browser);
    later(20 * MINUTE_IN_MS);

    const answer: Answer = await signOut(browser);

    expect(
      answer.writes.filter((write: CookieWrite): boolean => {
        return write.name === SESSION_SIGN_OUT_COOKIE_NAME;
      }),
    ).toEqual([
      expect.objectContaining({
        kind: "clear",
        options: expect.objectContaining({
          path: SESSION_SIGN_OUT_COOKIE_PATH,
        }),
      }),
    ]);

    for (const name of [
      SESSION_SIGN_OUT_COOKIE_NAME,
      CookieUtil.getRefreshTokenKey(),
      CookieUtil.getUserTokenKey(),
    ]) {
      expect({ name, kept: browser.cookie(name) }).toEqual({
        name,
        kept: undefined,
      });
    }

    expect(browser.cookiesFor(SIGN_OUT_PATH)).toEqual({});
  });
});

describe("another browser", () => {
  it("the same person's other browser stays signed in, whichever of the two signs out", async () => {
    const thisBrowser: Browser = new Browser();
    const otherBrowser: Browser = new Browser();
    signIn(thisBrowser);
    signIn(otherBrowser, OTHER_BROWSER_SESSION_ID);

    await loseARenewal(thisBrowser);
    later(20 * MINUTE_IN_MS);

    // The other browser signs out: its own session ends, and only it.
    await renew(otherBrowser);
    await signOut(otherBrowser);

    expect(row(OTHER_BROWSER_SESSION_ID).isRevoked).toBe(true);
    expect(row().isRevoked).toBe(false);

    // This browser signs out: its own session ends.
    await signOut(thisBrowser);

    expect(row()).toEqual(
      expect.objectContaining({ isRevoked: true, endedBy: "session-id" }),
    );
    expect(row(OTHER_BROWSER_SESSION_ID).ends).toBe(1);
  });

  it("a session ended from another browser stays as that browser ended it", async () => {
    const browser: Browser = new Browser();
    signIn(browser);
    await loseARenewal(browser);
    later(20 * MINUTE_IN_MS);

    // Ended from the person's other browser: Sessions, then Sign out.
    row().isRevoked = true;
    row().endedBy = "elsewhere";
    row().cause = "Signed out from another browser";
    row().ends = 1;

    const answer: Answer = await signOut(browser);

    expect(answer.signedOut).toBe(true);
    expect(row()).toEqual(
      expect.objectContaining({
        endedBy: "elsewhere",
        cause: "Signed out from another browser",
        ends: 1,
      }),
    );
  });

  it("another person's sign-out never ends this person's session", async () => {
    const thisBrowser: Browser = new Browser();
    const theirBrowser: Browser = new Browser();
    signIn(thisBrowser);
    signIn(theirBrowser, OTHER_USERS_SESSION_ID, OTHER_USER_ID);

    await loseARenewal(thisBrowser);
    await loseARenewal(theirBrowser);
    later(20 * MINUTE_IN_MS);

    await signOut(theirBrowser);

    expect(row(OTHER_USERS_SESSION_ID).isRevoked).toBe(true);
    expect(row().isRevoked).toBe(false);
  });
});

describe("what the sign-out cookie can end, and what it cannot", () => {
  // A sign-out after a lost renewal, its access-token cookie gone, with this in place of its sign-out cookie.
  async function signOutHolding(signOutCookie: string): Promise<Answer> {
    const browser: Browser = new Browser();
    const { refreshToken } = signIn(browser);
    await loseARenewal(browser);
    later(20 * MINUTE_IN_MS);

    return await signOutWith({
      [CookieUtil.getRefreshTokenKey()]: refreshToken,
      [SESSION_SIGN_OUT_COOKIE_NAME]: signOutCookie,
    });
  }

  it("a cookie signed with another key, naming the session, ends nothing", async () => {
    const answer: Answer = await signOutHolding(
      signedWithAnotherKey({
        userId: USER_ID,
        sessionId: SESSION_ID,
        purpose: "user-session-sign-out",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60 * 60,
      }),
    );

    expect(answer.signedOut).toBe(true);
    expect(answer.nextError).toBeNull();
    expect(row().isRevoked).toBe(false);
    expect(revokeLiveSessionOfUserCalls).toEqual([]);
  });

  it("this server's own sign-out token, its claims swapped for another session's, ends nothing", async () => {
    const genuine: string = JSONWebToken.signSessionSignOutToken({
      userId: new ObjectID(USER_ID),
      sessionId: new ObjectID(SESSION_ID),
      expiresInSeconds: 60 * 60,
    });
    const [header, payload, signature] = genuine.split(".");
    const claims: JSONObject = JSON.parse(
      Buffer.from(payload!, "base64url").toString("utf8"),
    ) as JSONObject;
    const swapped: string = `${header}.${Buffer.from(
      JSON.stringify({ ...claims, sessionId: OTHER_USERS_SESSION_ID }),
    ).toString("base64url")}.${signature}`;

    signIn(new Browser(), OTHER_USERS_SESSION_ID, OTHER_USER_ID);

    await signOutHolding(swapped);

    expect(row(OTHER_USERS_SESSION_ID).isRevoked).toBe(false);
    expect(row().isRevoked).toBe(false);
  });

  it("a sign-out token that pairs this person with another person's session ends neither", async () => {
    signIn(new Browser(), OTHER_USERS_SESSION_ID, OTHER_USER_ID);

    // Signed by this server, which never makes one: the user must be the session's own.
    const mismatched: string = JSONWebToken.signSessionSignOutToken({
      userId: new ObjectID(USER_ID),
      sessionId: new ObjectID(OTHER_USERS_SESSION_ID),
      expiresInSeconds: 60 * 60,
    });

    await signOutHolding(mismatched);

    expect(row(OTHER_USERS_SESSION_ID).isRevoked).toBe(false);
    expect(row().isRevoked).toBe(false);
  });

  /*
   * A copy of a browser's cookie ends the session it names - its own - as
   * the refresh token beside it in the same jar would, and nothing else:
   * never the session of the browser it is put in.
   */
  it("another person's own sign-out cookie, put in this browser, ends only the session it names, theirs, and never this one", async () => {
    const theirBrowser: Browser = new Browser();
    signIn(theirBrowser, OTHER_USERS_SESSION_ID, OTHER_USER_ID);
    const theirs: string = theirBrowser.cookie(
      SESSION_SIGN_OUT_COOKIE_NAME,
    )!.value;

    await signOutHolding(theirs);

    expect(row().isRevoked).toBe(false);
    expect(row(OTHER_USERS_SESSION_ID)).toEqual(
      expect.objectContaining({ isRevoked: true, ends: 1 }),
    );
    expect(revokeLiveSessionOfUserCalls).toEqual([
      { userId: OTHER_USER_ID, sessionId: OTHER_USERS_SESSION_ID },
    ]);
  });

  it("a token that is not a sign-out cookie ends nothing in its place: the session's own access token, an SSO sign-in, garbage, nothing", async () => {
    const accessTokenOfTheSession: string = JSONWebToken.signUserLoginToken({
      tokenData: {
        userId: new ObjectID(USER_ID),
        email: new Email(`person-${USER_ID}@example.com`),
        name: new Name("A Person"),
        timezone: null,
        isMasterAdmin: false,
        isGlobalLogin: true,
        sessionId: new ObjectID(SESSION_ID),
      },
      expiresInSeconds: 15 * 60,
    });

    for (const token of [
      accessTokenOfTheSession,
      CookieUtil.getSSOToken({
        user: person(USER_ID),
        projectId: ObjectID.generate(),
        ssoProviderId: ObjectID.generate(),
        ssoProviderType: SsoProviderType.ProjectSSO,
      }),
      "not-a-token",
      "",
    ]) {
      table.length = 0;
      revokeLiveSessionOfUserCalls.length = 0;

      const answer: Answer = await signOutHolding(token);

      expect(answer.signedOut).toBe(true);
      expect(answer.nextError).toBeNull();
      expect({ token, ended: row().isRevoked }).toEqual({
        token,
        ended: false,
      });
      expect(revokeLiveSessionOfUserCalls).toEqual([]);
    }
  });

  it("a sign-out cookie that has run out ends nothing", async () => {
    const browser: Browser = new Browser();
    const { refreshToken } = signIn(browser);
    await loseARenewal(browser);

    const shortLived: string = JSONWebToken.signSessionSignOutToken({
      userId: new ObjectID(USER_ID),
      sessionId: new ObjectID(SESSION_ID),
      expiresInSeconds: 60,
    });

    later(2 * MINUTE_IN_MS);

    await signOutWith({
      [CookieUtil.getRefreshTokenKey()]: refreshToken,
      [SESSION_SIGN_OUT_COOKIE_NAME]: shortLived,
    });

    expect(row().isRevoked).toBe(false);
    expect(revokeLiveSessionOfUserCalls).toEqual([]);
  });

  it("once the refresh token's thirty days are over the browser sends nothing, and nothing is ended", async () => {
    const browser: Browser = new Browser();
    signIn(browser);
    await loseARenewal(browser);

    later(30 * DAY_IN_MS + MINUTE_IN_MS);

    const answer: Answer = await signOut(browser);

    expect(answer.sent).toEqual({});
    expect(answer.signedOut).toBe(true);
  });

  it("it renews nothing: a renewal never reads it, whatever else it is sent", async () => {
    const browser: Browser = new Browser();
    const { refreshToken } = signIn(browser);
    await loseARenewal(browser);
    later(20 * MINUTE_IN_MS);

    const signOutCookie: string = browser.cookie(
      SESSION_SIGN_OUT_COOKIE_NAME,
    )!.value;

    for (const cookies of [
      { [SESSION_SIGN_OUT_COOKIE_NAME]: signOutCookie },
      {
        [SESSION_SIGN_OUT_COOKIE_NAME]: signOutCookie,
        [CookieUtil.getRefreshTokenKey()]: refreshToken,
      },
      {
        [SESSION_SIGN_OUT_COOKIE_NAME]: signOutCookie,
        [CookieUtil.getRefreshTokenKey()]: signOutCookie,
      },
    ]) {
      const answer: Answer = await send("/refresh-token", { cookies });

      expect(answer.refused).not.toBeNull();
      expect(answer.refreshToken).toBeNull();
      expect(
        answer.writes.filter((write: CookieWrite): boolean => {
          return write.kind === "set";
        }),
      ).toEqual([]);
    }

    const asBody: Answer = await send("/refresh-token", {
      body: { refreshToken: signOutCookie },
    });

    expect(asBody.refused).not.toBeNull();
    // Nothing renewed it, and nothing ended it either.
    expect(row()).toEqual(
      expect.objectContaining({ isRevoked: false, ends: 0 }),
    );
    expect(rotations).toBe(1);
  });

  it("it is no access token: sent as one - the access-token cookie, or a bearer - it ends nothing", async () => {
    const browser: Browser = new Browser();
    const { refreshToken } = signIn(browser);
    await loseARenewal(browser);
    later(20 * MINUTE_IN_MS);

    const signOutCookie: string = browser.cookie(
      SESSION_SIGN_OUT_COOKIE_NAME,
    )!.value;

    await send("/logout", {
      cookies: {
        [CookieUtil.getRefreshTokenKey()]: refreshToken,
        [CookieUtil.getUserTokenKey()]: signOutCookie,
      },
    });
    await send("/logout", {
      body: { refreshToken },
      headers: { authorization: `Bearer ${signOutCookie}` },
    });

    expect(row().isRevoked).toBe(false);
    expect(revokeLiveSessionOfUserCalls).toEqual([]);
  });

  /*
   * How /logout is kept from a request another site makes: SameSite. A
   * cross-site POST carries no SameSite=Lax cookie - nor this one, which is
   * Strict - and the token is taken from nowhere else, so such a request
   * cannot carry it some other way.
   */
  it("it is read from its cookie only: in a body or a header, it ends nothing", async () => {
    const browser: Browser = new Browser();
    const { refreshToken } = signIn(browser);
    await loseARenewal(browser);
    later(20 * MINUTE_IN_MS);

    const signOutCookie: string = browser.cookie(
      SESSION_SIGN_OUT_COOKIE_NAME,
    )!.value;

    for (const request of [
      { body: { refreshToken: signOutCookie } },
      { body: { refreshToken, [SESSION_SIGN_OUT_COOKIE_NAME]: signOutCookie } },
      { body: { refreshToken, sessionSignOut: signOutCookie } },
      {
        body: { refreshToken },
        headers: { [SESSION_SIGN_OUT_COOKIE_NAME]: signOutCookie },
      },
      {
        body: { refreshToken },
        headers: { "x-oneuptime-sign-out": signOutCookie },
      },
    ]) {
      const answer: Answer = await send("/logout", request);

      expect(answer.signedOut).toBe(true);
    }

    expect(row().isRevoked).toBe(false);
    expect(revokeLiveSessionOfUserCalls).toEqual([]);
  });

  it("a current refresh token still ends the session by itself, and the sign-out cookie is not read", async () => {
    const browser: Browser = new Browser();
    signIn(browser);
    later(10 * MINUTE_IN_MS);
    await renew(browser);
    later(20 * MINUTE_IN_MS);

    await signOut(browser);

    expect(row()).toEqual(
      expect.objectContaining({ isRevoked: true, endedBy: "refresh-token" }),
    );
    expect(revokeLiveSessionOfUserCalls).toEqual([]);
  });

  it("nothing at all: nothing ended, and the sign-out still answers", async () => {
    signIn(new Browser());

    const answer: Answer = await signOutWith({});

    expect(answer.signedOut).toBe(true);
    expect(row().isRevoked).toBe(false);
  });
});

describe("how the sign-out is reached, and kept from other sites, is as it was", () => {
  it("/logout is answered for a POST only, as before", () => {
    expect(
      mockRouter.routes
        .filter((route: { uri: string }): boolean => {
          return route.uri === "/logout";
        })
        .map((route: { method: string }): string => {
          return route.method;
        }),
    ).toEqual(["POST"]);
  });

  it("every renewal hands the browser the sign-out cookie as strictly as the refresh token's own, or more", async () => {
    const browser: Browser = new Browser();
    signIn(browser);
    later(10 * MINUTE_IN_MS);

    const renewed: Answer = await renew(browser);
    const set: Dictionary<CookieWrite> = {};

    for (const write of renewed.writes) {
      if (write.kind === "set") {
        set[write.name] = write;
      }
    }

    const signOutCookie: CookieWrite = set[SESSION_SIGN_OUT_COOKIE_NAME]!;
    const refreshCookie: CookieWrite = set[CookieUtil.getRefreshTokenKey()]!;

    expect(signOutCookie.options).toEqual(
      expect.objectContaining({
        httpOnly: true,
        sameSite: "strict",
        path: SIGN_OUT_PATH,
        maxAge: refreshCookie.options["maxAge"],
      }),
    );
    expect(refreshCookie.options).toEqual(
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    );
    expect(
      JSONWebToken.decodeSessionToSignOut(
        signOutCookie.value,
      ).sessionId.toString(),
    ).toBe(SESSION_ID);
  });

  it("the browser sends it to the sign-out, and to nothing else", () => {
    const browser: Browser = new Browser();
    signIn(browser);

    expect(browser.cookiesFor(SIGN_OUT_PATH)).toHaveProperty(
      SESSION_SIGN_OUT_COOKIE_NAME,
    );

    for (const elsewhere of [
      RENEWAL_PATH,
      "/",
      "/api/project",
      "/dashboard/logout",
      `${IdentityRoute.toString()}/login`,
      `${IdentityRoute.toString()}/logoutx`,
      "/status-page-identity-api/logout/8f8f0000-0000-4000-8000-0000000000d1",
    ]) {
      expect({
        elsewhere,
        sent: Object.keys(browser.cookiesFor(elsewhere)).includes(
          SESSION_SIGN_OUT_COOKIE_NAME,
        ),
      }).toEqual({ elsewhere, sent: false });
    }
  });
});

/*
 * Read from the code by TypeScript's own parser: the sign-out cookie is
 * read in the /logout handler and nowhere else in the product.
 */
describe("only POST /logout reads the sign-out cookie", () => {
  const AUTHENTICATION: string =
    "packages/App/FeatureSet/Identity/API/Authentication.ts";

  const CODE_FILE: RegExp = /\.(?:ts|tsx)$/;

  // `<object>.<method>(...)`.
  function isCallOf(node: ts.Node, object: string, method: string): boolean {
    return (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === object &&
      node.expression.name.text === method
    );
  }

  function visit(node: ts.Node, onNode: (node: ts.Node) => void): void {
    onNode(node);
    ts.forEachChild(node, (child: ts.Node): void => {
      visit(child, onNode);
    });
  }

  const READS: Array<[string, string]> = [
    ["JSONWebToken", "decodeSessionToSignOut"],
    ["CookieUtil", "getSessionSignOutTokenFromExpressRequest"],
  ];

  it('in Authentication.ts, both reads sit inside router.post("/logout", ...)', () => {
    const sourceFile: ts.SourceFile = ts.createSourceFile(
      "Authentication.ts",
      fs.readFileSync(path.join(REPOSITORY_DIRECTORY, AUTHENTICATION), "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );

    const logoutRoutes: Array<ts.CallExpression> = [];
    const reads: Array<{ read: string; insideLogout: boolean }> = [];

    visit(sourceFile, (node: ts.Node): void => {
      if (
        isCallOf(node, "router", "post") &&
        ts.isStringLiteral((node as ts.CallExpression).arguments[0]!) &&
        ((node as ts.CallExpression).arguments[0] as ts.StringLiteral).text ===
          "/logout"
      ) {
        logoutRoutes.push(node as ts.CallExpression);
      }
    });

    expect(logoutRoutes).toHaveLength(1);

    visit(sourceFile, (node: ts.Node): void => {
      for (const [object, method] of READS) {
        if (isCallOf(node, object, method)) {
          let ancestor: ts.Node | undefined = node.parent;

          while (ancestor && ancestor !== logoutRoutes[0]) {
            ancestor = ancestor.parent;
          }

          reads.push({
            read: `${object}.${method}`,
            insideLogout: ancestor === logoutRoutes[0],
          });
        }
      }
    });

    expect(reads).toEqual([
      {
        read: "CookieUtil.getSessionSignOutTokenFromExpressRequest",
        insideLogout: true,
      },
      { read: "JSONWebToken.decodeSessionToSignOut", insideLogout: true },
    ]);
  });

  it("no other product file reads it", () => {
    const readers: Array<string> = [];

    for (const file of listProductFiles(REPOSITORY_DIRECTORY, [
      "packages",
      "ee",
    ])) {
      if (!CODE_FILE.test(file)) {
        continue;
      }

      const text: string = fs.readFileSync(
        path.join(REPOSITORY_DIRECTORY, file),
        "utf8",
      );

      if (
        !READS.some(([, method]: [string, string]): boolean => {
          return text.includes(method);
        })
      ) {
        continue;
      }

      let reads: boolean = false;

      // A call of either method, however it is reached: `<anything>.<method>(...)`.
      visit(
        ts.createSourceFile(
          path.basename(file),
          text,
          ts.ScriptTarget.Latest,
          true,
          file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        ),
        (node: ts.Node): void => {
          if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            READS.some(([, method]: [string, string]): boolean => {
              return (
                (node.expression as ts.PropertyAccessExpression).name.text ===
                method
              );
            })
          ) {
            reads = true;
          }
        },
      );

      if (reads) {
        readers.push(file);
      }
    }

    expect(readers).toEqual([AUTHENTICATION]);
  });
});
