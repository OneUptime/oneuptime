import {
  buildRequest,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import StatusPagePrivateUserSession from "Common/Models/DatabaseModels/StatusPagePrivateUserSession";
import CookieUtil, {
  SESSION_SIGN_OUT_COOKIE_NAME,
  STATUS_PAGE_SIGN_OUT_COOKIE_PATH_PREFIX,
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
import ObjectID from "Common/Types/ObjectID";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A STATUS PAGE READER'S SIGN-OUT AFTER A LOST RENEWAL ENDS THEIR SESSION
 * (issue #8671).
 *
 * A private status page's session is renewed at
 * POST /status-page-identity-api/refresh-token/<page>, which rotates its
 * refresh token and keeps only the new one. When a renewal's answer never
 * reaches the browser, the browser keeps the refresh token the renewal
 * replaced, which matches no session, and the page's sign-out
 * (POST /status-page-identity-api/logout/<page>) read nothing else: the
 * session stayed signed in on the server though its reader signed out.
 *
 * Every status page sign-in and renewal now also leaves the page's sign-out
 * cookie, which names the session for that page's sign-out only: HttpOnly,
 * SameSite=Strict, sent only to that page's sign-out, for as long as the
 * refresh token. These play every order against the real /refresh-token
 * and /logout handlers and the real CookieUtil, with real tokens and the
 * clock under fake timers, and a browser's cookie jar that keeps what each
 * answer set - when the answer reaches it - and sends each request the
 * cookies that have not run out and whose path the request's path matches
 * (RFC 6265, 5.1.4). The session table is a stand-in: each session's one
 * current refresh token, rotated at each renewal, and whether, why and how
 * often it ended.
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

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

const PAGE_ID: string = "8a8a0000-0000-4000-8000-0000000000a1";
const OTHER_PAGE_ID: string = "8a8a0000-0000-4000-8000-0000000000a2";
const READER_ID: string = "8a8a0000-0000-4000-8000-0000000000b1";
const OTHER_READER_ID: string = "8a8a0000-0000-4000-8000-0000000000b2";
const SESSION_ID: string = "8a8a0000-0000-4000-8000-0000000000c1";
const OTHER_BROWSER_SESSION_ID: string = "8a8a0000-0000-4000-8000-0000000000c2";
const OTHER_READERS_SESSION_ID: string = "8a8a0000-0000-4000-8000-0000000000c3";
const OTHER_PAGE_SESSION_ID: string = "8a8a0000-0000-4000-8000-0000000000c4";
const PROJECT_ID: string = "8a8a0000-0000-4000-8000-0000000000d1";

const MINUTE_IN_MS: number = 60 * 1000;
const DAY_IN_MS: number = 24 * 60 * MINUTE_IN_MS;

const SIGNED_OUT: string = "User logged out";

// The readers the stand-in user table knows, by id; each on the page it is a reader of.
jest.mock("Common/Server/Services/StatusPagePrivateUserService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (options: { id: { toString: () => string } }) => {
        const { default: PrivateUserModel } = jest.requireActual(
          "Common/Models/DatabaseModels/StatusPagePrivateUser",
        ) as { default: typeof StatusPagePrivateUser };
        const { default: EmailType } = jest.requireActual(
          "Common/Types/Email",
        ) as { default: typeof Email };
        const { default: ObjectIDType } = jest.requireActual(
          "Common/Types/ObjectID",
        ) as { default: typeof ObjectID };
        const id: string = options.id.toString();
        const reader: StatusPagePrivateUser = new PrivateUserModel();
        reader._id = id;
        reader.email = new EmailType(`reader-${id}@example.com`);
        // The page signIn made the reader's session on (__readerPages).
        reader.statusPageId = new ObjectIDType(
          (globalThis as { __readerPages?: Dictionary<string> })
            .__readerPages?.[id] || "8a8a0000-0000-4000-8000-0000000000a1",
        );
        reader.projectId = new ObjectIDType(
          "8a8a0000-0000-4000-8000-0000000000d1",
        );
        return Promise.resolve(reader);
      },
      findOneBy: jest.fn(),
      updateOneById: jest.fn(),
      updateOneBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/StatusPageService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      getStatusPageURL: (): Promise<string> => {
        return Promise.resolve("https://status.example.com");
      },
    },
  };
});

jest.mock("Common/Server/Services/ProjectSmtpConfigService", () => {
  return {
    __esModule: true,
    default: {
      toEmailServer: (): undefined => {
        return undefined;
      },
    },
  };
});

jest.mock("Common/Server/Services/MailService", () => {
  return {
    __esModule: true,
    default: {
      sendMail: jest.fn(),
    },
  };
});

jest.mock("Common/Server/DatabaseConfig", () => {
  return {
    __esModule: true,
    default: {
      getHost: jest.fn(),
      getHttpProtocol: jest.fn(),
    },
  };
});

// One row of the page sessions table: its one current refresh token, and how it ended.
interface SessionRow {
  id: string;
  statusPageId: string;
  readerId: string;
  refreshToken: string;
  createdAt: Date;
  isRevoked: boolean;
  endedBy: "refresh-token" | "session-id" | "elsewhere" | null;
  reason: string | null;
  // How many times something ended it: a sign-out ends a session once.
  ends: number;
}

const table: Array<SessionRow> = [];

let rotations: number = 0;

function live(row: SessionRow | undefined): SessionRow | undefined {
  return row && !row.isRevoked ? row : undefined;
}

function toModel(row: SessionRow): StatusPagePrivateUserSession {
  const session: StatusPagePrivateUserSession =
    new StatusPagePrivateUserSession();
  session.id = new ObjectID(row.id);
  session.statusPageId = new ObjectID(row.statusPageId);
  session.statusPagePrivateUserId = new ObjectID(row.readerId);
  session.projectId = new ObjectID(PROJECT_ID);
  session.createdAt = row.createdAt;
  session.refreshTokenExpiresAt = OneUptimeDate.getSomeDaysAfter(30);
  return session;
}

// What a page's sign-out asked to end by a session's id.
const revokeLiveSessionCalls: Array<{
  statusPageId: string;
  readerId: string;
  sessionId: string;
}> = [];

/*
 * What each sign-out handed the revocation besides its reason: where its
 * request came from, which the audit log's Sign Out says (issue #6790).
 */
const signOutOrigins: Array<unknown> = [];

jest.mock("Common/Server/Services/StatusPagePrivateUserSessionService", () => {
  return {
    __esModule: true,
    SIGN_IN_NO_LONGER_ACCEPTED_REASON:
      "Its sign-in is no longer accepted by the status page",
    default: {
      findActiveSessionByRefreshToken: async (
        refreshToken: string,
      ): Promise<StatusPagePrivateUserSession | null> => {
        const row: SessionRow | undefined = live(
          table.find((candidate: SessionRow): boolean => {
            return candidate.refreshToken === refreshToken;
          }),
        );
        return row ? toModel(row) : null;
      },
      isLoginCodeSession: (): boolean => {
        return false;
      },
      doesSignInStillCount: async (): Promise<boolean> => {
        return true;
      },
      // Rotates the refresh token, as the real write does; nothing for a session that ended.
      renewSessionWithNewRefreshToken: async (options: {
        session: StatusPagePrivateUserSession;
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
        row.refreshToken = `rotated-page-refresh-token-${rotations}`;

        return {
          session: toModel(row),
          refreshToken: row.refreshToken,
          refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(30),
        };
      },
      revokeSessionById: async (
        sessionId: ObjectID,
        options: { reason: string },
      ): Promise<void> => {
        const row: SessionRow | undefined = table.find(
          (candidate: SessionRow): boolean => {
            return candidate.id === sessionId.toString();
          },
        );

        if (row) {
          row.isRevoked = true;
          row.endedBy = "elsewhere";
          row.reason = options.reason;
          row.ends++;
        }
      },
      revokeSessionByRefreshToken: async (
        refreshToken: string,
        options: { reason: string; requestOrigin?: unknown },
      ): Promise<boolean> => {
        signOutOrigins.push(options.requestOrigin);

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
        row.reason = options.reason;
        row.ends++;
        return true;
      },
      // Only a live session of that reader on that page, as the real query asks.
      revokeLiveSessionOfPrivateUser: async (
        data: {
          statusPageId: ObjectID;
          statusPagePrivateUserId: ObjectID;
          sessionId: ObjectID;
        },
        options: { reason: string; requestOrigin?: unknown },
      ): Promise<boolean> => {
        signOutOrigins.push(options.requestOrigin);
        revokeLiveSessionCalls.push({
          statusPageId: data.statusPageId.toString(),
          readerId: data.statusPagePrivateUserId.toString(),
          sessionId: data.sessionId.toString(),
        });

        const row: SessionRow | undefined = live(
          table.find((candidate: SessionRow): boolean => {
            return (
              candidate.id === data.sessionId.toString() &&
              candidate.statusPageId === data.statusPageId.toString() &&
              candidate.readerId === data.statusPagePrivateUserId.toString()
            );
          }),
        );

        if (!row) {
          return false;
        }

        row.isRevoked = true;
        row.endedBy = "session-id";
        row.reason = options.reason;
        row.ends++;
        return true;
      },
      createSession: jest.fn(),
      exchangeLoginCode: jest.fn(),
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
const sendEmptySuccessResponse: jest.Mock = jest.fn();
const sendEntityResponse: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: (...args: Array<unknown>): unknown => {
        return sendErrorResponse(...args);
      },
      sendEmptySuccessResponse: (...args: Array<unknown>): unknown => {
        return sendEmptySuccessResponse(...args);
      },
      sendEntityResponse: (...args: Array<unknown>): unknown => {
        return sendEntityResponse(...args);
      },
      sendJsonObjectResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/StatusPageAuthentication";

const NOW: Date = new Date("2026-11-15T09:00:00.000Z");

// Where a status page renews and signs out, on whichever host serves it.
function renewalPath(pageId: string = PAGE_ID): string {
  return `/status-page-identity-api/refresh-token/${pageId}`;
}

function signOutPath(pageId: string = PAGE_ID): string {
  return `/status-page-identity-api/logout/${pageId}`;
}

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

function readerOf(readerId: string, pageId: string): StatusPagePrivateUser {
  const reader: StatusPagePrivateUser = new StatusPagePrivateUser();
  reader.id = new ObjectID(readerId);
  reader.email = new Email(`reader-${readerId}@example.com`);
  reader.statusPageId = new ObjectID(pageId);
  reader.projectId = new ObjectID(PROJECT_ID);
  return reader;
}

/*
 * A sign-in to a status page from this browser: a session with its first
 * refresh token, and the cookies every status page sign-in hands a browser
 * (CookieUtil.setStatusPagePrivateUserCookie).
 */
function signIn(
  browser: Browser,
  data: { sessionId?: string; readerId?: string; pageId?: string } = {},
): { refreshToken: string } {
  const sessionId: string = data.sessionId || SESSION_ID;
  const readerId: string = data.readerId || READER_ID;
  const pageId: string = data.pageId || PAGE_ID;
  const refreshToken: string = `page-refresh-token-of-${sessionId}`;

  (globalThis as { __readerPages?: Dictionary<string> }).__readerPages = {
    ...((globalThis as { __readerPages?: Dictionary<string> }).__readerPages ||
      {}),
    [readerId]: pageId,
  };

  table.push({
    id: sessionId,
    statusPageId: pageId,
    readerId,
    refreshToken,
    createdAt: new Date(Date.now()),
    isRevoked: false,
    endedBy: null,
    reason: null,
    ends: 0,
  });

  const writes: Array<CookieWrite> = [];

  CookieUtil.setStatusPagePrivateUserCookie({
    expressResponse: recorder(writes),
    user: readerOf(readerId, pageId),
    statusPageId: new ObjectID(pageId),
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
  renewed: boolean;
  signedOut: boolean;
  // The cookies the request carried.
  sent: Dictionary<string>;
  writes: Array<CookieWrite>;
}

/*
 * A request to a status page's identity API, as `browser` sends it: its
 * cookies for the route's path, unless `cookies` says exactly what goes.
 * The answer reaches the browser unless `isLost`.
 */
async function send(
  uri: "/refresh-token/:statuspageid" | "/logout/:statuspageid",
  data: {
    pageId?: string;
    browser?: Browser;
    cookies?: Dictionary<string>;
    body?: JSONObject;
    headers?: Record<string, string>;
    isLost?: boolean;
  },
): Promise<Answer> {
  sendErrorResponse.mockClear();
  sendEmptySuccessResponse.mockClear();
  sendEntityResponse.mockClear();

  const pageId: string = data.pageId || PAGE_ID;
  const requestPath: string =
    uri === "/logout/:statuspageid" ? signOutPath(pageId) : renewalPath(pageId);
  const sent: Dictionary<string> =
    data.cookies || data.browser?.cookiesFor(requestPath) || {};

  const handler: RouteHandler = mockRouter.match("post", uri);
  const req: ExpressRequest = buildRequest(data.body || {}, {
    headers: data.headers || {},
  });
  (req as unknown as { cookies: Dictionary<string> }).cookies = { ...sent };
  (req as unknown as { params: Dictionary<string> }).params = {
    statuspageid: pageId,
  };

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

  return {
    refused:
      sendErrorResponse.mock.calls.length > 0
        ? (sendErrorResponse.mock.calls[0]![2] as Exception)
        : null,
    nextError,
    renewed: sendEntityResponse.mock.calls.length > 0,
    signedOut: sendEmptySuccessResponse.mock.calls.length > 0,
    sent,
    writes,
  };
}

async function renew(
  browser: Browser,
  options: { isLost?: boolean; pageId?: string } = {},
): Promise<Answer> {
  return await send("/refresh-token/:statuspageid", {
    browser,
    ...(options.pageId ? { pageId: options.pageId } : {}),
    isLost: options.isLost === true,
  });
}

// The page's sign-out (UserUtil.logout in the status page): a POST with its cookies, and nothing else.
async function signOut(browser: Browser, pageId?: string): Promise<Answer> {
  return await send("/logout/:statuspageid", {
    browser,
    ...(pageId ? { pageId } : {}),
  });
}

async function signOutWith(
  cookies: Dictionary<string>,
  pageId?: string,
): Promise<Answer> {
  return await send("/logout/:statuspageid", {
    cookies,
    ...(pageId ? { pageId } : {}),
  });
}

/*
 * A lost renewal, as the browser lives it: the refresh token is rotated,
 * and the answer - with the cookies that would replace the browser's -
 * never arrives.
 */
async function loseARenewal(browser: Browser, pageId?: string): Promise<void> {
  const before: number = rotations;
  const lost: Answer = await renew(browser, {
    isLost: true,
    ...(pageId ? { pageId } : {}),
  });

  expect(lost.refused).toBeNull();
  expect(lost.renewed).toBe(true);
  expect(rotations).toBe(before + 1);
}

function signOutKey(pageId: string = PAGE_ID): string {
  return CookieUtil.getStatusPageSessionSignOutKey(new ObjectID(pageId));
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

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({
    now: NOW,
    // Only the clock: Date, which the tokens and the jar read.
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

  table.length = 0;
  rotations = 0;
  revokeLiveSessionCalls.length = 0;
  signOutOrigins.length = 0;
  (globalThis as { __readerPages?: Dictionary<string> }).__readerPages = {};
});

afterEach(() => {
  jest.useRealTimers();
});

describe("a renewal whose answer was lost, then the reader signs out of the page", () => {
  it("after the page's access-token cookie has gone: the sign-out cookie names the session, and it ends, as a sign-out", async () => {
    const browser: Browser = new Browser();
    const { refreshToken } = signIn(browser);

    later(10 * MINUTE_IN_MS);
    await loseARenewal(browser);

    later(20 * MINUTE_IN_MS);
    expect(
      browser.cookie(CookieUtil.getUserTokenKey(new ObjectID(PAGE_ID))),
    ).toBeUndefined();

    const answer: Answer = await signOut(browser);

    expect(
      answer.sent[CookieUtil.getRefreshTokenKey(new ObjectID(PAGE_ID))],
    ).toBe(refreshToken);
    expect(answer.sent[signOutKey()]).toBeTruthy();
    expect(answer.nextError).toBeNull();
    expect(answer.signedOut).toBe(true);
    expect(row()).toEqual(
      expect.objectContaining({
        isRevoked: true,
        endedBy: "session-id",
        reason: SIGNED_OUT,
        ends: 1,
      }),
    );
    expect(revokeLiveSessionCalls).toEqual([
      { statusPageId: PAGE_ID, readerId: READER_ID, sessionId: SESSION_ID },
    ]);
    /*
     * Each way it tried to end the session said where the sign-out came
     * from - as RequestOriginUtil reads it, empty for this stand-in request.
     */
    expect(signOutOrigins.length).toBeGreaterThan(0);

    for (const origin of signOutOrigins) {
      expect(origin).toBeDefined();
      expect(Object.keys(origin as Record<string, unknown>).sort()).toEqual([
        "device",
        "ipAddress",
        "location",
      ]);
    }
  });

  it("an hour, or 29 days, on: still ended, as long as the refresh token would have lasted", async () => {
    for (const after of [60 * MINUTE_IN_MS, 29 * DAY_IN_MS]) {
      table.length = 0;
      const browser: Browser = new Browser();
      signIn(browser);
      await loseARenewal(browser);

      later(after);
      await signOut(browser);

      expect({ after, ended: row().isRevoked }).toEqual({ after, ended: true });
    }
  });

  it("with the page's access-token cookie still there, ended the same way, once", async () => {
    const browser: Browser = new Browser();
    signIn(browser);

    later(5 * MINUTE_IN_MS);
    await loseARenewal(browser);
    later(5 * MINUTE_IN_MS);

    const answer: Answer = await signOut(browser);

    expect(
      answer.sent[CookieUtil.getUserTokenKey(new ObjectID(PAGE_ID))],
    ).toBeTruthy();
    expect(row()).toEqual(
      expect.objectContaining({ isRevoked: true, ends: 1 }),
    );
    expect(revokeLiveSessionCalls).toHaveLength(1);
  });

  it("before this fix the same sign-out ended nothing: a browser without the sign-out cookie names no session", async () => {
    const browser: Browser = new Browser();
    signIn(browser);
    // As a browser signed in before this release holds its cookies.
    browser.forget(signOutKey());

    await loseARenewal(browser);
    later(20 * MINUTE_IN_MS);

    const answer: Answer = await signOut(browser);

    expect(answer.signedOut).toBe(true);
    expect(row().isRevoked).toBe(false);
    expect(revokeLiveSessionCalls).toEqual([]);
  });

  it("a browser signed in before this release gets the cookie at its next renewal, and is covered from then on", async () => {
    const browser: Browser = new Browser();
    signIn(browser);
    browser.forget(signOutKey());

    later(10 * MINUTE_IN_MS);
    const renewed: Answer = await renew(browser);

    expect(renewed.renewed).toBe(true);
    expect(browser.cookie(signOutKey())).toBeDefined();

    later(10 * MINUTE_IN_MS);
    await loseARenewal(browser);
    later(20 * MINUTE_IN_MS);
    await signOut(browser);

    expect(row().isRevoked).toBe(true);
  });

  /*
   * What a status page usually does after a lost renewal: its next renewal,
   * with the refresh token the lost one replaced, is refused - and clears
   * the page's cookies - and the page signs its reader out at once
   * (the status page's API.logoutUser). The sign-out cookie is never sent
   * to a renewal, so it is still there for that sign-out.
   */
  it("the sign-out the page sends itself, right after its next renewal was refused, ends the session", async () => {
    const browser: Browser = new Browser();
    signIn(browser);

    later(10 * MINUTE_IN_MS);
    await loseARenewal(browser);
    later(10 * MINUTE_IN_MS);

    const refused: Answer = await renew(browser);

    expect(refused.refused?.message).toBe(
      "Session expired. Please sign in again.",
    );
    expect(refused.sent[signOutKey()]).toBeUndefined();
    expect(
      refused.writes.filter((write: CookieWrite): boolean => {
        return write.name === signOutKey();
      }),
    ).toEqual([]);
    expect(
      browser.cookie(CookieUtil.getRefreshTokenKey(new ObjectID(PAGE_ID))),
    ).toBeUndefined();
    expect(browser.cookie(signOutKey())).toBeDefined();

    const answer: Answer = await signOut(browser);

    expect(Object.keys(answer.sent)).toEqual([signOutKey()]);
    expect(row()).toEqual(
      expect.objectContaining({
        isRevoked: true,
        endedBy: "session-id",
        reason: SIGNED_OUT,
        ends: 1,
      }),
    );
  });
});

describe("after the page's sign-out", () => {
  it("neither the refresh token the browser had nor the one the lost answer carried renews the session", async () => {
    const browser: Browser = new Browser();
    const { refreshToken } = signIn(browser);
    await loseARenewal(browser);
    const lostRefreshToken: string = row().refreshToken;

    later(20 * MINUTE_IN_MS);
    await signOut(browser);

    for (const token of [refreshToken, lostRefreshToken]) {
      const answer: Answer = await send("/refresh-token/:statuspageid", {
        cookies: {
          [CookieUtil.getRefreshTokenKey(new ObjectID(PAGE_ID))]: token,
        },
      });

      expect(answer.refused?.message).toBe(
        "Session expired. Please sign in again.",
      );
      expect(answer.renewed).toBe(false);
    }

    expect(row()).toEqual(
      expect.objectContaining({ isRevoked: true, ends: 1 }),
    );
  });

  it("the sign-out replayed with a copy of every cookie it carried ends nothing more, and still answers", async () => {
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
  });

  it("the sign-out cleared the page's sign-out cookie on its own path: the browser holds no token of the session any more", async () => {
    const browser: Browser = new Browser();
    signIn(browser);
    await loseARenewal(browser);
    later(20 * MINUTE_IN_MS);

    const answer: Answer = await signOut(browser);

    expect(
      answer.writes.filter((write: CookieWrite): boolean => {
        return write.name === signOutKey();
      }),
    ).toEqual([
      expect.objectContaining({
        kind: "clear",
        options: expect.objectContaining({ path: signOutPath() }),
      }),
    ]);
    expect(browser.cookiesFor(signOutPath())).toEqual({});
    expect(browser.cookiesFor(renewalPath())).toEqual({});
  });
});

describe("other browsers, readers and pages", () => {
  it("the same reader's other browser stays signed in, whichever of the two signs out", async () => {
    const thisBrowser: Browser = new Browser();
    const otherBrowser: Browser = new Browser();
    signIn(thisBrowser);
    signIn(otherBrowser, { sessionId: OTHER_BROWSER_SESSION_ID });

    await loseARenewal(thisBrowser);
    later(20 * MINUTE_IN_MS);

    await renew(otherBrowser);
    await signOut(otherBrowser);

    expect(row(OTHER_BROWSER_SESSION_ID).isRevoked).toBe(true);
    expect(row().isRevoked).toBe(false);

    await signOut(thisBrowser);

    expect(row()).toEqual(
      expect.objectContaining({ isRevoked: true, endedBy: "session-id" }),
    );
    expect(row(OTHER_BROWSER_SESSION_ID).ends).toBe(1);
  });

  it("a session ended some other way stays as it ended", async () => {
    const browser: Browser = new Browser();
    signIn(browser);
    await loseARenewal(browser);
    later(20 * MINUTE_IN_MS);

    row().isRevoked = true;
    row().endedBy = "elsewhere";
    row().reason = "The reader set a new password";
    row().ends = 1;

    const answer: Answer = await signOut(browser);

    expect(answer.signedOut).toBe(true);
    expect(row()).toEqual(
      expect.objectContaining({
        endedBy: "elsewhere",
        reason: "The reader set a new password",
        ends: 1,
      }),
    );
  });

  it("another reader's sign-out never ends this reader's session", async () => {
    const thisBrowser: Browser = new Browser();
    const theirBrowser: Browser = new Browser();
    signIn(thisBrowser);
    signIn(theirBrowser, {
      sessionId: OTHER_READERS_SESSION_ID,
      readerId: OTHER_READER_ID,
    });

    await loseARenewal(thisBrowser);
    await loseARenewal(theirBrowser);
    later(20 * MINUTE_IN_MS);

    await signOut(theirBrowser);

    expect(row(OTHER_READERS_SESSION_ID).isRevoked).toBe(true);
    expect(row().isRevoked).toBe(false);
  });

  it("each page's sign-out cookie goes to that page's sign-out only, and one page's sign-out never ends another page's session", async () => {
    const browser: Browser = new Browser();
    signIn(browser);
    signIn(browser, {
      sessionId: OTHER_PAGE_SESSION_ID,
      readerId: OTHER_READER_ID,
      pageId: OTHER_PAGE_ID,
    });

    // Two pages on one host: each sends its own cookie to its own sign-out.
    expect(Object.keys(browser.cookiesFor(signOutPath()))).toContain(
      signOutKey(),
    );
    expect(Object.keys(browser.cookiesFor(signOutPath()))).not.toContain(
      signOutKey(OTHER_PAGE_ID),
    );

    await loseARenewal(browser);
    later(20 * MINUTE_IN_MS);
    await signOut(browser);

    expect(row().isRevoked).toBe(true);
    expect(row(OTHER_PAGE_SESSION_ID).isRevoked).toBe(false);
  });

  it("a page's cookie sent to another page's sign-out ends nothing there, nor its own session", async () => {
    const browser: Browser = new Browser();
    const { refreshToken } = signIn(browser);
    await loseARenewal(browser);
    later(20 * MINUTE_IN_MS);

    const thisPagesCookie: string = browser.cookie(signOutKey())!.value;

    for (const cookies of [
      // Under the other page's own name.
      { [signOutKey(OTHER_PAGE_ID)]: thisPagesCookie },
      // Under its own name, to the other page's sign-out.
      { [signOutKey()]: thisPagesCookie },
    ]) {
      await signOutWith(
        {
          [CookieUtil.getRefreshTokenKey(new ObjectID(OTHER_PAGE_ID))]:
            refreshToken,
          ...cookies,
        },
        OTHER_PAGE_ID,
      );
    }

    expect(row().isRevoked).toBe(false);
  });
});

describe("what the page's sign-out cookie can end, and what it cannot", () => {
  // A sign-out after a lost renewal, the access cookie gone, with this in place of its sign-out cookie.
  async function signOutHolding(signOutCookie: string): Promise<Answer> {
    const browser: Browser = new Browser();
    const { refreshToken } = signIn(browser);
    await loseARenewal(browser);
    later(20 * MINUTE_IN_MS);

    return await signOutWith({
      [CookieUtil.getRefreshTokenKey(new ObjectID(PAGE_ID))]: refreshToken,
      [signOutKey()]: signOutCookie,
    });
  }

  it("a cookie signed with another key, naming the session, ends nothing", async () => {
    const answer: Answer = await signOutHolding(
      signedWithAnotherKey({
        userId: READER_ID,
        statusPageId: PAGE_ID,
        sessionId: SESSION_ID,
        purpose: "status-page-session-sign-out",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60 * 60,
      }),
    );

    expect(answer.signedOut).toBe(true);
    expect(answer.nextError).toBeNull();
    expect(row().isRevoked).toBe(false);
    expect(revokeLiveSessionCalls).toEqual([]);
  });

  it("this server's own token pairing this reader with another reader's session ends neither", async () => {
    signIn(new Browser(), {
      sessionId: OTHER_READERS_SESSION_ID,
      readerId: OTHER_READER_ID,
    });

    const mismatched: string = JSONWebToken.signStatusPageSessionSignOutToken({
      statusPageId: new ObjectID(PAGE_ID),
      userId: new ObjectID(READER_ID),
      sessionId: new ObjectID(OTHER_READERS_SESSION_ID),
      expiresInSeconds: 60 * 60,
    });

    await signOutHolding(mismatched);

    expect(row(OTHER_READERS_SESSION_ID).isRevoked).toBe(false);
    expect(row().isRevoked).toBe(false);
  });

  it("a token that is not this page's sign-out cookie ends nothing in its place: the page's access token, the dashboard's sign-out cookie, garbage, nothing", async () => {
    const pageAccessToken: string = CookieUtil.setStatusPagePrivateUserCookie({
      expressResponse: recorder([]),
      user: readerOf(READER_ID, PAGE_ID),
      statusPageId: new ObjectID(PAGE_ID),
      sessionId: new ObjectID(SESSION_ID),
      refreshToken: "refresh-token",
      refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(30),
    });

    for (const token of [
      pageAccessToken,
      JSONWebToken.signSessionSignOutToken({
        userId: new ObjectID(READER_ID),
        sessionId: new ObjectID(SESSION_ID),
        expiresInSeconds: 60 * 60,
      }),
      "not-a-token",
      "",
    ]) {
      table.length = 0;
      revokeLiveSessionCalls.length = 0;

      const answer: Answer = await signOutHolding(token);

      expect(answer.signedOut).toBe(true);
      expect({ token, ended: row().isRevoked }).toEqual({
        token,
        ended: false,
      });
      expect(revokeLiveSessionCalls).toEqual([]);
    }
  });

  it("a sign-out cookie that has run out ends nothing", async () => {
    const browser: Browser = new Browser();
    const { refreshToken } = signIn(browser);
    await loseARenewal(browser);

    const shortLived: string = JSONWebToken.signStatusPageSessionSignOutToken({
      statusPageId: new ObjectID(PAGE_ID),
      userId: new ObjectID(READER_ID),
      sessionId: new ObjectID(SESSION_ID),
      expiresInSeconds: 60,
    });

    later(2 * MINUTE_IN_MS);

    await signOutWith({
      [CookieUtil.getRefreshTokenKey(new ObjectID(PAGE_ID))]: refreshToken,
      [signOutKey()]: shortLived,
    });

    expect(row().isRevoked).toBe(false);
    expect(revokeLiveSessionCalls).toEqual([]);
  });

  it("it renews nothing: a renewal never reads it, whatever else it is sent", async () => {
    const browser: Browser = new Browser();
    const { refreshToken } = signIn(browser);
    await loseARenewal(browser);
    later(20 * MINUTE_IN_MS);

    const signOutCookie: string = browser.cookie(signOutKey())!.value;

    for (const cookies of [
      { [signOutKey()]: signOutCookie },
      {
        [signOutKey()]: signOutCookie,
        [CookieUtil.getRefreshTokenKey(new ObjectID(PAGE_ID))]: refreshToken,
      },
      {
        [CookieUtil.getRefreshTokenKey(new ObjectID(PAGE_ID))]: signOutCookie,
      },
    ]) {
      const answer: Answer = await send("/refresh-token/:statuspageid", {
        cookies,
      });

      expect(answer.refused).not.toBeNull();
      expect(answer.renewed).toBe(false);
      expect(
        answer.writes.filter((write: CookieWrite): boolean => {
          return write.kind === "set";
        }),
      ).toEqual([]);
    }

    expect(row()).toEqual(
      expect.objectContaining({ isRevoked: false, ends: 0 }),
    );
    expect(rotations).toBe(1);
  });

  // A cross-site POST carries no SameSite cookie, and the token is taken from nowhere else.
  it("it is read from its cookie only: in a body or a header, it ends nothing", async () => {
    const browser: Browser = new Browser();
    const { refreshToken } = signIn(browser);
    await loseARenewal(browser);
    later(20 * MINUTE_IN_MS);

    const signOutCookie: string = browser.cookie(signOutKey())!.value;

    for (const request of [
      { body: { refreshToken: signOutCookie } },
      { body: { [signOutKey()]: signOutCookie } },
      { headers: { authorization: `Bearer ${signOutCookie}` } },
      { headers: { [signOutKey()]: signOutCookie } },
      {
        cookies: {
          [CookieUtil.getRefreshTokenKey(new ObjectID(PAGE_ID))]: refreshToken,
          // The dashboard's sign-out cookie name, on this page's sign-out.
          [SESSION_SIGN_OUT_COOKIE_NAME]: signOutCookie,
        },
      },
    ]) {
      const answer: Answer = await send("/logout/:statuspageid", request);

      expect(answer.signedOut).toBe(true);
    }

    expect(row().isRevoked).toBe(false);
    expect(revokeLiveSessionCalls).toEqual([]);
  });

  it("a current refresh token still ends the session by itself, and the sign-out cookie is not read", async () => {
    const browser: Browser = new Browser();
    signIn(browser);
    later(10 * MINUTE_IN_MS);
    await renew(browser);
    later(20 * MINUTE_IN_MS);

    await signOut(browser);

    expect(row()).toEqual(
      expect.objectContaining({
        isRevoked: true,
        endedBy: "refresh-token",
        reason: SIGNED_OUT,
      }),
    );
    expect(revokeLiveSessionCalls).toEqual([]);
  });

  it("nothing at all: nothing ended, and the sign-out still answers", async () => {
    signIn(new Browser());

    const answer: Answer = await signOutWith({});

    expect(answer.signedOut).toBe(true);
    expect(row().isRevoked).toBe(false);
  });
});

describe("how a page's sign-out is reached, and kept from other sites", () => {
  it("the page's sign-out is answered for a POST only", () => {
    expect(
      mockRouter.routes
        .filter((route: { uri: string }): boolean => {
          return route.uri === "/logout/:statuspageid";
        })
        .map((route: { method: string }): string => {
          return route.method;
        }),
    ).toEqual(["POST"]);
  });

  it("every renewal hands the browser the page's sign-out cookie as strictly as the page's refresh token, or more", async () => {
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

    const signOutCookie: CookieWrite = set[signOutKey()]!;
    const refreshCookie: CookieWrite =
      set[CookieUtil.getRefreshTokenKey(new ObjectID(PAGE_ID))]!;

    expect(signOutCookie.options).toEqual(
      expect.objectContaining({
        httpOnly: true,
        sameSite: "strict",
        path: signOutPath(),
        maxAge: refreshCookie.options["maxAge"],
      }),
    );
    expect(refreshCookie.options).toEqual(
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    );
    expect(
      JSONWebToken.decodeStatusPageSessionToSignOut(
        signOutCookie.value,
      ).sessionId.toString(),
    ).toBe(SESSION_ID);
  });

  it("the browser sends it to the page's sign-out, and to nothing else", () => {
    const browser: Browser = new Browser();
    signIn(browser);

    expect(browser.cookiesFor(signOutPath())).toHaveProperty(signOutKey());

    for (const elsewhere of [
      renewalPath(),
      "/",
      `/status-page-api/overview/${PAGE_ID}`,
      `/status-page/${PAGE_ID}/logout`,
      signOutPath(OTHER_PAGE_ID),
      `${signOutPath()}x`,
      "/identity/logout",
    ]) {
      expect({
        elsewhere,
        sent: Object.keys(browser.cookiesFor(elsewhere)).includes(signOutKey()),
      }).toEqual({ elsewhere, sent: false });
    }

    expect(signOutPath()).toBe(
      `${STATUS_PAGE_SIGN_OUT_COOKIE_PATH_PREFIX}/${PAGE_ID}`,
    );
  });
});

/*
 * Read from the code by TypeScript's own parser: a page's sign-out cookie
 * is read in that page's sign-out handler and nowhere else in the product.
 */
describe("only the page's sign-out reads its sign-out cookie", () => {
  const STATUS_PAGE_AUTHENTICATION: string =
    "packages/App/FeatureSet/Identity/API/StatusPageAuthentication.ts";

  const CODE_FILE: RegExp = /\.(?:ts|tsx)$/;

  const READS: Array<[string, string]> = [
    ["JSONWebToken", "decodeStatusPageSessionToSignOut"],
    ["CookieUtil", "getStatusPageSessionSignOutTokenFromExpressRequest"],
  ];

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

  it('in StatusPageAuthentication.ts, both reads sit inside router.post("/logout/:statuspageid", ...)', () => {
    const sourceFile: ts.SourceFile = ts.createSourceFile(
      "StatusPageAuthentication.ts",
      fs.readFileSync(
        path.join(REPOSITORY_DIRECTORY, STATUS_PAGE_AUTHENTICATION),
        "utf8",
      ),
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
          "/logout/:statuspageid"
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
        read: "CookieUtil.getStatusPageSessionSignOutTokenFromExpressRequest",
        insideLogout: true,
      },
      {
        read: "JSONWebToken.decodeStatusPageSessionToSignOut",
        insideLogout: true,
      },
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

    expect(readers).toEqual([STATUS_PAGE_AUTHENTICATION]);
  });
});
