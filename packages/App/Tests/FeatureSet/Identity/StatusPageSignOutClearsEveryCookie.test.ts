import {
  buildRequest,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import BrowserCookieJar, {
  expectClearedAsSet,
  parseSetCookie,
  SetCookie,
  StoredCookie,
  WrittenResponse,
  writtenResponse,
} from "./BrowserCookieJar";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import User from "Common/Models/DatabaseModels/User";
import CookieUtil from "Common/Server/Utils/Cookie";
import { ExpressRequest, NextFunction } from "Common/Server/Utils/Express";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A STATUS PAGE'S SIGN-OUT ENDS THE READER'S SESSION AND LEAVES THE BROWSER
 * WITHOUT A COOKIE OF IT (issue #9508).
 *
 * POST /status-page-identity-api/logout/<page> is what a private status
 * page's sign-out sends, on whichever host serves the page. It must end
 * the reader's session on that page, and its answer must clear every
 * cookie the reader's sign-in to the page set - the access token, the
 * refresh token, the page's sign-out cookie on its own path and the master
 * password - each with the attributes it was set with, so the browser
 * removes it; and nothing of another page's, or of the dashboards'.
 *
 * The cookies are set as the page's sign-in routes set them, written by
 * Express into real Set-Cookie headers and kept by a browser's cookie jar
 * (BrowserCookieJar); the sign-out is the real handler. The page sessions
 * table is a stand-in.
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

jest.mock("Common/Server/Services/StatusPagePrivateUserService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
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

const HOST: string = "oneuptime.example.com";

const PAGE_ID: string = "7b7b0000-0000-4000-8000-0000000000a1";
const OTHER_PAGE_ID: string = "7b7b0000-0000-4000-8000-0000000000a2";
const READER_ID: string = "7b7b0000-0000-4000-8000-0000000000b1";
const SESSION_ID: string = "7b7b0000-0000-4000-8000-0000000000c1";
const OTHER_SESSION_ID: string = "7b7b0000-0000-4000-8000-0000000000c2";
const USER_ID: string = "7b7b0000-0000-4000-8000-0000000000d1";
const DASHBOARD_SESSION_ID: string = "7b7b0000-0000-4000-8000-0000000000d2";

// The page sessions table: each session's one current refresh token, and how it ended.
interface SessionRow {
  id: string;
  statusPageId: string;
  refreshToken: string;
  isRevoked: boolean;
  reason: string | null;
  ends: number;
}

const table: Array<SessionRow> = [];

// When set, ending a session fails as a database out of reach does.
const database: { isDown: boolean } = { isDown: false };

jest.mock("Common/Server/Services/StatusPagePrivateUserSessionService", () => {
  const failIfTheDatabaseIsDown: () => void = (): void => {
    if (database.isDown) {
      throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
    }
  };

  return {
    __esModule: true,
    SIGN_IN_NO_LONGER_ACCEPTED_REASON:
      "Its sign-in is no longer accepted by the status page",
    default: {
      revokeSessionByRefreshToken: async (
        refreshToken: string,
        options: { reason: string },
      ): Promise<boolean> => {
        failIfTheDatabaseIsDown();

        const row: SessionRow | undefined = table.find(
          (candidate: SessionRow): boolean => {
            return (
              !candidate.isRevoked && candidate.refreshToken === refreshToken
            );
          },
        );

        if (!row) {
          return false;
        }

        row.isRevoked = true;
        row.reason = options.reason;
        row.ends++;
        return true;
      },
      revokeLiveSessionOfPrivateUser: async (): Promise<boolean> => {
        failIfTheDatabaseIsDown();
        return false;
      },
      findActiveSessionByRefreshToken: jest.fn(),
      renewSessionWithNewRefreshToken: jest.fn(),
      revokeSessionById: jest.fn(),
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

const sendEmptySuccessResponse: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
      sendEmptySuccessResponse: (...args: Array<unknown>): unknown => {
        return sendEmptySuccessResponse(...args);
      },
      sendEntityResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/StatusPageAuthentication";

const SIGNED_OUT: string = "User logged out";

// Where a status page signs out, on whichever host serves it.
function signOutPath(pageId: string): string {
  return `/status-page-identity-api/logout/${pageId}`;
}

const TRANSPORTS: Array<{ name: string; isHttps: boolean }> = [
  { name: "HTTPS", isHttps: true },
  { name: "plain HTTP", isHttps: false },
];

function aRequest(data: {
  cookies: Dictionary<string>;
  isHttps: boolean;
  pageId?: string;
}): ExpressRequest {
  const req: ExpressRequest = buildRequest({});

  (req as unknown as { cookies: Dictionary<string> }).cookies = {
    ...data.cookies,
  };
  (req as unknown as { secure: boolean }).secure = data.isHttps;
  (req as unknown as { headers: Dictionary<string> }).headers = { host: HOST };
  (req as unknown as { params: Dictionary<string> }).params = data.pageId
    ? { statuspageid: data.pageId }
    : {};

  return req;
}

function reader(): StatusPagePrivateUser {
  const privateUser: StatusPagePrivateUser = new StatusPagePrivateUser();
  privateUser.id = new ObjectID(READER_ID);
  privateUser.email = new Email("reader@example.com");
  return privateUser;
}

/*
 * A reader's sign-in to a page - its session, its cookies and, for a page
 * behind a master password, that cookie too. Returns the headers it sent.
 */
function signInToPage(
  browser: BrowserCookieJar,
  pageId: string,
  sessionId: string,
  isHttps: boolean,
): Array<string> {
  const refreshToken: string = `page-refresh-token-${pageId}`;

  table.push({
    id: sessionId,
    statusPageId: pageId,
    refreshToken,
    isRevoked: false,
    reason: null,
    ends: 0,
  });

  const written: WrittenResponse = writtenResponse(
    aRequest({ cookies: {}, isHttps }),
  );

  CookieUtil.setStatusPageMasterPasswordCookie({
    expressResponse: written.res,
    statusPageId: new ObjectID(pageId),
  });

  CookieUtil.setStatusPagePrivateUserCookie({
    expressResponse: written.res,
    user: reader(),
    statusPageId: new ObjectID(pageId),
    sessionId: new ObjectID(sessionId),
    refreshToken,
    refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(30),
  });

  browser.take(written.setCookies(), {
    isHttps,
    requestPath: `/status-page-identity-api/login/${pageId}`,
  });

  return written.setCookies();
}

// The same browser signed in to the dashboards, on the same host.
function signInToTheDashboards(
  browser: BrowserCookieJar,
  isHttps: boolean,
): void {
  const user: User = new User();
  user.id = new ObjectID(USER_ID);
  user.email = new Email("person@example.com");
  user.name = new Name("A Person");
  user.isMasterAdmin = false;

  const written: WrittenResponse = writtenResponse(
    aRequest({ cookies: {}, isHttps }),
  );

  CookieUtil.setUserCookie({
    expressResponse: written.res,
    user,
    isGlobalLogin: true,
    sessionId: new ObjectID(DASHBOARD_SESSION_ID),
    refreshToken: "dashboard-refresh-token",
    refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(30),
  });

  browser.take(written.setCookies(), {
    isHttps,
    requestPath: "/identity/login",
  });
}

interface SignOutAnswer {
  setCookies: Array<string>;
  nextError: unknown;
  isAnsweredAsSignedOut: boolean;
}

// The page's sign-out: a POST to its own sign-out address, with what the browser sends there.
async function signOutOfPage(
  browser: BrowserCookieJar,
  pageId: string,
  isHttps: boolean,
): Promise<SignOutAnswer> {
  sendEmptySuccessResponse.mockClear();

  const req: ExpressRequest = aRequest({
    cookies: browser.cookiesFor(signOutPath(pageId), { isHttps }),
    isHttps,
    pageId,
  });
  const written: WrittenResponse = writtenResponse(req);

  let nextError: unknown = null;

  const next: NextFunction = ((err?: unknown): void => {
    if (err) {
      nextError = err;
    }
  }) as unknown as NextFunction;

  const handler: RouteHandler = mockRouter.match(
    "post",
    "/logout/:statuspageid",
  );

  await handler(req, written.res, next);

  browser.take(written.setCookies(), {
    isHttps,
    requestPath: signOutPath(pageId),
  });

  return {
    setCookies: written.setCookies(),
    nextError,
    isAnsweredAsSignedOut: sendEmptySuccessResponse.mock.calls.length > 0,
  };
}

// The cookies a page's sign-in leaves: each name holds the page's id.
function cookiesOfPage(
  browser: BrowserCookieJar,
  pageId: string,
): Array<string> {
  return browser
    .all()
    .filter((cookie: StoredCookie): boolean => {
      return cookie.name.endsWith(pageId);
    })
    .map((cookie: StoredCookie): string => {
      return `${cookie.name} (${cookie.path})`;
    })
    .sort();
}

beforeEach(() => {
  jest.clearAllMocks();
  table.length = 0;
  database.isDown = false;
});

afterEach(() => {
  database.isDown = false;
});

describe("what a reader's sign-in to a page leaves in the browser", () => {
  it("the page's access token, refresh token and master password on /, and its sign-out cookie on its own sign-out's path", () => {
    const browser: BrowserCookieJar = new BrowserCookieJar(HOST);

    signInToPage(browser, PAGE_ID, SESSION_ID, true);

    expect(cookiesOfPage(browser, PAGE_ID)).toEqual(
      [
        `${CookieUtil.getUserTokenKey(new ObjectID(PAGE_ID))} (/)`,
        `${CookieUtil.getRefreshTokenKey(new ObjectID(PAGE_ID))} (/)`,
        `${CookieUtil.getStatusPageMasterPasswordKey(new ObjectID(PAGE_ID))} (/)`,
        `${CookieUtil.getStatusPageSessionSignOutKey(new ObjectID(PAGE_ID))} (${signOutPath(PAGE_ID)})`,
      ].sort(),
    );
  });
});

describe("a status page's sign-out", () => {
  for (const transport of TRANSPORTS) {
    describe(`over ${transport.name}`, () => {
      it("leaves the browser without a cookie of the page, on any path", async () => {
        const browser: BrowserCookieJar = new BrowserCookieJar(HOST);

        signInToPage(browser, PAGE_ID, SESSION_ID, transport.isHttps);

        const answer: SignOutAnswer = await signOutOfPage(
          browser,
          PAGE_ID,
          transport.isHttps,
        );

        expect(answer.nextError).toBeNull();
        expect(answer.isAnsweredAsSignedOut).toBe(true);
        expect(cookiesOfPage(browser, PAGE_ID)).toEqual([]);
      });

      it("clears each of the page's cookies with the path, Domain, Secure and SameSite it was set with", async () => {
        const browser: BrowserCookieJar = new BrowserCookieJar(HOST);
        const set: Array<string> = signInToPage(
          browser,
          PAGE_ID,
          SESSION_ID,
          transport.isHttps,
        );

        const answer: SignOutAnswer = await signOutOfPage(
          browser,
          PAGE_ID,
          transport.isHttps,
        );

        expectClearedAsSet({ set, cleared: answer.setCookies });
      });

      it("ends the reader's session on the page itself, as a sign-out, once", async () => {
        const browser: BrowserCookieJar = new BrowserCookieJar(HOST);

        signInToPage(browser, PAGE_ID, SESSION_ID, transport.isHttps);

        await signOutOfPage(browser, PAGE_ID, transport.isHttps);

        expect(table).toEqual([
          expect.objectContaining({
            id: SESSION_ID,
            isRevoked: true,
            reason: SIGNED_OUT,
            ends: 1,
          }),
        ]);
      });
    });
  }

  it("leaves another page's sign-in, and the dashboards', as they were", async () => {
    const browser: BrowserCookieJar = new BrowserCookieJar(HOST);

    signInToPage(browser, PAGE_ID, SESSION_ID, true);
    signInToPage(browser, OTHER_PAGE_ID, OTHER_SESSION_ID, true);
    signInToTheDashboards(browser, true);

    const before: Array<string> = browser
      .all()
      .filter((cookie: StoredCookie): boolean => {
        return !cookie.name.endsWith(PAGE_ID);
      })
      .map((cookie: StoredCookie): string => {
        return `${cookie.name}=${cookie.value} (${cookie.path})`;
      })
      .sort();

    const answer: SignOutAnswer = await signOutOfPage(browser, PAGE_ID, true);

    // Nothing it wrote names another page's cookie, or a dashboard's.
    expect(
      answer.setCookies
        .map((header: string): SetCookie => {
          return parseSetCookie(header);
        })
        .filter((setCookie: SetCookie): boolean => {
          return !setCookie.name.endsWith(PAGE_ID);
        }),
    ).toEqual([]);

    expect(cookiesOfPage(browser, PAGE_ID)).toEqual([]);
    expect(
      browser
        .all()
        .map((cookie: StoredCookie): string => {
          return `${cookie.name}=${cookie.value} (${cookie.path})`;
        })
        .sort(),
    ).toEqual(before);
    expect(
      table.find((row: SessionRow): boolean => {
        return row.id === OTHER_SESSION_ID;
      })!.isRevoked,
    ).toBe(false);
  });

  it("that the database fails to record still leaves the browser without a cookie of the page, and says it failed", async () => {
    const browser: BrowserCookieJar = new BrowserCookieJar(HOST);

    signInToPage(browser, PAGE_ID, SESSION_ID, true);
    database.isDown = true;

    const answer: SignOutAnswer = await signOutOfPage(browser, PAGE_ID, true);

    expect(answer.isAnsweredAsSignedOut).toBe(false);
    expect((answer.nextError as Error).message).toContain("ECONNREFUSED");
    expect(cookiesOfPage(browser, PAGE_ID)).toEqual([]);
  });

  it("that names no page clears nothing, and says why", async () => {
    const browser: BrowserCookieJar = new BrowserCookieJar(HOST);

    signInToPage(browser, PAGE_ID, SESSION_ID, true);

    const req: ExpressRequest = aRequest({ cookies: {}, isHttps: true });
    const written: WrittenResponse = writtenResponse(req);
    let nextError: unknown = null;

    await mockRouter.match("post", "/logout/:statuspageid")(req, written.res, ((
      err?: unknown,
    ): void => {
      nextError = err;
    }) as unknown as NextFunction);

    expect((nextError as Error).message).toBe("Status Page ID is required.");
    expect(written.setCookies()).toEqual([]);
  });
});
