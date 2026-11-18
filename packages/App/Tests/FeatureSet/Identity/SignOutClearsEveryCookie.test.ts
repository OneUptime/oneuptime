import {
  buildRequest,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import BrowserCookieJar, {
  expectClearedAsSet,
  StoredCookie,
  WrittenResponse,
  writtenResponse,
} from "./BrowserCookieJar";
import User from "Common/Models/DatabaseModels/User";
import UserSession from "Common/Models/DatabaseModels/UserSession";
import { IdentityRoute } from "Common/ServiceRoute";
import CookieUtil, {
  SESSION_SIGN_OUT_COOKIE_NAME,
  SESSION_SIGN_OUT_COOKIE_PATH,
} from "Common/Server/Utils/Cookie";
import { ExpressRequest, NextFunction } from "Common/Server/Utils/Express";
import CookieName from "Common/Types/CookieName";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import Email from "Common/Types/Email";
import Exception from "Common/Types/Exception/Exception";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import { SessionEndCause } from "Common/Types/UserSession/SessionEndCause";
import Timezone from "Common/Types/Timezone";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A SIGN-OUT ENDS THE SESSION AND LEAVES THE BROWSER WITHOUT A COOKIE OF IT
 * (issue #9508).
 *
 * POST /identity/logout is what every dashboard's sign-out sends. It must
 * end the session itself - its refresh token renews nothing afterwards -
 * and its answer must clear every cookie the sign-in set, each with the
 * attributes it was set with, or the browser keeps it: a cookie is its name,
 * its domain and its path, and a clear sent over plain HTTP cannot touch a
 * Secure one. The session's tokens are HttpOnly; only this answer clears
 * them.
 *
 * Each sign-in here sets its cookies as the sign-in routes do (CookieUtil's
 * setUserCookie, setGlobalSSOCookie, setSSOCookie), written by Express into
 * real Set-Cookie headers and kept by a browser's cookie jar
 * (BrowserCookieJar). The sign-out is the real /logout handler, sent what
 * the browser sends it; the session table is a stand-in.
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

const USER_ID: string = "9a9a0000-0000-4000-8000-0000000000b1";
const SESSION_ID: string = "9a9a0000-0000-4000-8000-0000000000c1";
const PROJECT_ID: string = "9a9a0000-0000-4000-8000-0000000000d1";
const SSO_PROVIDER_ID: string = "9a9a0000-0000-4000-8000-0000000000e1";

const HOST: string = "oneuptime.example.com";

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

// The session table: each session's one current refresh token, and how it ended.
interface SessionRow {
  id: string;
  userId: string;
  refreshToken: string;
  isRevoked: boolean;
  cause: unknown;
  ends: number;
}

const table: Array<SessionRow> = [];

// When set, ending a session fails as a database out of reach does.
const database: { isDown: boolean } = { isDown: false };

function live(row: SessionRow | undefined): SessionRow | undefined {
  return row && !row.isRevoked ? row : undefined;
}

jest.mock("Common/Server/Services/UserSessionService", () => {
  const actual: {
    default: { decideRenewal: (data: unknown) => Promise<unknown> };
  } = jest.requireActual("Common/Server/Services/UserSessionService") as {
    default: { decideRenewal: (data: unknown) => Promise<unknown> };
  };

  const failIfTheDatabaseIsDown: () => void = (): void => {
    if (database.isDown) {
      throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
    }
  };

  const end: (row: SessionRow, cause: unknown) => void = (
    row: SessionRow,
    cause: unknown,
  ): void => {
    row.isRevoked = true;
    row.cause = cause;
    row.ends++;
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

        if (!row) {
          return null;
        }

        const { default: UserSessionModel } = jest.requireActual(
          "Common/Models/DatabaseModels/UserSession",
        ) as { default: typeof UserSession };
        const { default: ObjectIDType } = jest.requireActual(
          "Common/Types/ObjectID",
        ) as { default: typeof ObjectID };
        const session: UserSession = new UserSessionModel();
        session.id = new ObjectIDType(row.id);
        session.userId = new ObjectIDType(row.userId);
        session.createdAt = new Date();
        session.lastActiveAt = new Date();
        return session;
      },
      renewSessionWithNewRefreshToken: jest.fn(),
      revokeSessionByRefreshToken: async (
        refreshToken: string,
        options: { cause: unknown },
      ): Promise<boolean> => {
        failIfTheDatabaseIsDown();

        const row: SessionRow | undefined = live(
          table.find((candidate: SessionRow): boolean => {
            return candidate.refreshToken === refreshToken;
          }),
        );

        if (!row) {
          return false;
        }

        end(row, options.cause);
        return true;
      },
      revokeLiveSessionOfUser: async (
        data: { userId: ObjectID; sessionId: ObjectID },
        options: { cause: unknown },
      ): Promise<boolean> => {
        failIfTheDatabaseIsDown();

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

        end(row, options.cause);
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
const sendEmptySuccessResponse: jest.Mock = jest.fn();

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
      sendJsonObjectResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/Authentication";

const SIGN_OUT_PATH: string = `${IdentityRoute.toString()}/logout`;
const RENEWAL_PATH: string = `${IdentityRoute.toString()}/refresh-token`;

type SignInKind = "password" | "the server's SSO" | "a project's SSO";

const SIGN_IN_KINDS: Array<SignInKind> = [
  "password",
  "the server's SSO",
  "a project's SSO",
];

const TRANSPORTS: Array<{ name: string; isHttps: boolean }> = [
  { name: "HTTPS", isHttps: true },
  { name: "plain HTTP", isHttps: false },
];

function aRequest(data: {
  cookies: Dictionary<string>;
  isHttps: boolean;
}): ExpressRequest {
  const req: ExpressRequest = buildRequest({});

  (req as unknown as { cookies: Dictionary<string> }).cookies = {
    ...data.cookies,
  };
  (req as unknown as { secure: boolean }).secure = data.isHttps;
  (req as unknown as { headers: Dictionary<string> }).headers = { host: HOST };

  return req;
}

function person(): User {
  const user: User = new User();
  user.id = new ObjectID(USER_ID);
  user.email = new Email("person@example.com");
  user.name = new Name("A Person");
  user.timezone = Timezone.EuropeBerlin;
  user.profilePictureId = new ObjectID("9a9a0000-0000-4000-8000-0000000000f1");
  user.isMasterAdmin = true;
  return user;
}

/*
 * A sign-in of this kind from this browser: the session, and every cookie
 * the sign-in routes set for it. Returns the Set-Cookie headers it sent.
 */
function signIn(
  browser: BrowserCookieJar,
  kind: SignInKind,
  isHttps: boolean,
): Array<string> {
  const refreshToken: string = `refresh-token-${kind}`;

  table.push({
    id: SESSION_ID,
    userId: USER_ID,
    refreshToken,
    isRevoked: false,
    cause: null,
    ends: 0,
  });

  const written: WrittenResponse = writtenResponse(
    aRequest({ cookies: {}, isHttps }),
  );

  if (kind === "the server's SSO") {
    CookieUtil.setGlobalSSOCookie({
      user: person(),
      expressResponse: written.res,
      ssoProviderId: new ObjectID(SSO_PROVIDER_ID),
      ssoProviderType: SsoProviderType.GlobalOIDC,
    });
  }

  if (kind === "a project's SSO") {
    CookieUtil.setSSOCookie({
      user: person(),
      projectId: new ObjectID(PROJECT_ID),
      expressResponse: written.res,
      ssoProviderId: new ObjectID(SSO_PROVIDER_ID),
      ssoProviderType: SsoProviderType.ProjectOIDC,
    });
  }

  CookieUtil.setUserCookie({
    expressResponse: written.res,
    user: person(),
    isGlobalLogin: kind === "password",
    sessionId: new ObjectID(SESSION_ID),
    refreshToken,
    refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(30),
    accessTokenExpiresInSeconds: 15 * 60,
  });

  browser.take(written.setCookies(), {
    isHttps,
    requestPath: `${IdentityRoute.toString()}/login`,
  });

  return written.setCookies();
}

interface SignOutAnswer {
  setCookies: Array<string>;
  nextError: unknown;
  isAnsweredAsSignedOut: boolean;
}

// The browser's sign-out: a POST to /identity/logout with the cookies it sends there.
async function signOut(
  browser: BrowserCookieJar,
  isHttps: boolean,
): Promise<SignOutAnswer> {
  sendEmptySuccessResponse.mockClear();
  sendErrorResponse.mockClear();

  const req: ExpressRequest = aRequest({
    cookies: browser.cookiesFor(SIGN_OUT_PATH, { isHttps }),
    isHttps,
  });
  const written: WrittenResponse = writtenResponse(req);

  let nextError: unknown = null;

  const next: NextFunction = ((err?: unknown): void => {
    if (err) {
      nextError = err;
    }
  }) as unknown as NextFunction;

  const handler: RouteHandler = mockRouter.match("post", "/logout");

  await handler(req, written.res, next);

  browser.take(written.setCookies(), { isHttps, requestPath: SIGN_OUT_PATH });

  return {
    setCookies: written.setCookies(),
    nextError,
    isAnsweredAsSignedOut: sendEmptySuccessResponse.mock.calls.length > 0,
  };
}

// A renewal with the cookies this browser sends there: refused, or not.
async function renewalIsRefused(
  cookies: Dictionary<string>,
  isHttps: boolean,
): Promise<boolean> {
  sendErrorResponse.mockClear();

  const req: ExpressRequest = aRequest({ cookies, isHttps });
  const written: WrittenResponse = writtenResponse(req);
  const handler: RouteHandler = mockRouter.match("post", "/refresh-token");

  await handler(req, written.res, (() => {}) as unknown as NextFunction);

  return (
    sendErrorResponse.mock.calls.length > 0 &&
    (sendErrorResponse.mock.calls[0]![2] as Exception).message ===
      "Session expired. Please sign in again."
  );
}

function names(cookies: Array<StoredCookie>): Array<string> {
  return cookies
    .map((cookie: StoredCookie): string => {
      return `${cookie.name} (${cookie.path})`;
    })
    .sort();
}

beforeEach(() => {
  jest.clearAllMocks();
  installFakeEnterpriseModule({ userSessionLengths: null });
  table.length = 0;
  database.isDown = false;
});

afterEach(() => {
  uninstallEnterpriseModule();
});

describe("what a sign-in leaves in the browser", () => {
  it.each(SIGN_IN_KINDS)(
    "a sign-in with %s: the session's tokens, HttpOnly, its sign-out cookie on its own path, and what the dashboards read",
    (kind: SignInKind) => {
      const browser: BrowserCookieJar = new BrowserCookieJar(HOST);

      signIn(browser, kind, true);

      const expected: Array<string> = [
        `${CookieName.Token} (/)`,
        `${CookieName.RefreshToken} (/)`,
        `${SESSION_SIGN_OUT_COOKIE_NAME} (${SESSION_SIGN_OUT_COOKIE_PATH})`,
        `${CookieName.UserID} (/)`,
        `${CookieName.Email} (/)`,
        `${CookieName.Name} (/)`,
        `${CookieName.Timezone} (/)`,
        `${CookieName.IsMasterAdmin} (/)`,
        `${CookieName.ProfilePicID} (/)`,
      ];

      if (kind === "the server's SSO") {
        expected.push(`${CookieName.GlobalSSOToken} (/)`);
      }

      if (kind === "a project's SSO") {
        expected.push(
          `${CookieUtil.getUserSSOKey(new ObjectID(PROJECT_ID))} (/)`,
        );
      }

      expect(names(browser.all())).toEqual(expected.sort());

      for (const name of [
        CookieName.Token,
        CookieName.RefreshToken,
        SESSION_SIGN_OUT_COOKIE_NAME,
      ]) {
        expect({ name, httpOnly: browser.cookie(name)!.httpOnly }).toEqual({
          name,
          httpOnly: true,
        });
      }
    },
  );
});

describe("a sign-out", () => {
  for (const transport of TRANSPORTS) {
    describe(`over ${transport.name}`, () => {
      it.each(SIGN_IN_KINDS)(
        "after a sign-in with %s, leaves the browser without a single cookie, on any path",
        async (kind: SignInKind) => {
          const browser: BrowserCookieJar = new BrowserCookieJar(HOST);

          signIn(browser, kind, transport.isHttps);
          expect(browser.all().length).toBeGreaterThan(0);

          const answer: SignOutAnswer = await signOut(
            browser,
            transport.isHttps,
          );

          expect(answer.nextError).toBeNull();
          expect(answer.isAnsweredAsSignedOut).toBe(true);
          expect(names(browser.all())).toEqual([]);
        },
      );

      it.each(SIGN_IN_KINDS)(
        "after a sign-in with %s, clears each cookie with the path, Domain, Secure and SameSite it was set with",
        async (kind: SignInKind) => {
          const browser: BrowserCookieJar = new BrowserCookieJar(HOST);
          const set: Array<string> = signIn(browser, kind, transport.isHttps);

          const answer: SignOutAnswer = await signOut(
            browser,
            transport.isHttps,
          );

          expectClearedAsSet({ set, cleared: answer.setCookies });
        },
      );

      it.each(SIGN_IN_KINDS)(
        "after a sign-in with %s, ends the session itself, as a sign-out, once: its refresh token renews nothing afterwards",
        async (kind: SignInKind) => {
          const browser: BrowserCookieJar = new BrowserCookieJar(HOST);

          signIn(browser, kind, transport.isHttps);

          // What the browser held, kept by whoever copied it before the sign-out.
          const copied: Dictionary<string> = browser.cookiesFor(RENEWAL_PATH, {
            isHttps: transport.isHttps,
          });

          await signOut(browser, transport.isHttps);

          expect(table).toEqual([
            expect.objectContaining({
              id: SESSION_ID,
              isRevoked: true,
              cause: SessionEndCause.SignedOut,
              ends: 1,
            }),
          ]);

          await expect(
            renewalIsRefused(copied, transport.isHttps),
          ).resolves.toBe(true);
        },
      );
    });
  }

  it("that the database fails to record still leaves the browser without a cookie, and says it failed", async () => {
    const browser: BrowserCookieJar = new BrowserCookieJar(HOST);

    signIn(browser, "the server's SSO", true);
    database.isDown = true;

    const answer: SignOutAnswer = await signOut(browser, true);

    expect(answer.isAnsweredAsSignedOut).toBe(false);
    expect((answer.nextError as Error).message).toContain("ECONNREFUSED");
    expect(names(browser.all())).toEqual([]);
  });

  it("from a page that cleared what it can itself - as the dashboards do - clears the HttpOnly rest", async () => {
    const browser: BrowserCookieJar = new BrowserCookieJar(HOST);

    signIn(browser, "the server's SSO", true);

    // What UserUtil.logout clears before it sends the sign-out: the cookies a page can reach.
    browser.take(
      [
        CookieName.UserID,
        CookieName.Email,
        CookieName.Name,
        CookieName.Timezone,
        CookieName.IsMasterAdmin,
        CookieName.ProfilePicID,
      ].map((name: string): string => {
        return `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure`;
      }),
      { isHttps: true, requestPath: "/dashboard/logout" },
    );

    expect(
      browser.all().every((cookie: StoredCookie): boolean => {
        return cookie.httpOnly;
      }),
    ).toBe(true);

    await signOut(browser, true);

    expect(names(browser.all())).toEqual([]);
  });

  it("that never reached the server leaves every HttpOnly cookie - why the page must wait for it (issue #9508)", () => {
    const browser: BrowserCookieJar = new BrowserCookieJar(HOST);

    signIn(browser, "the server's SSO", true);

    // The page clears what it can; the sign-out it started is cancelled by the page change.
    browser.take(
      [CookieName.UserID, CookieName.Email, CookieName.Name].map(
        (name: string): string => {
          return `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure`;
        },
      ),
      { isHttps: true, requestPath: "/dashboard/logout" },
    );

    const left: Array<string> = names(browser.all());

    expect(left).toEqual(
      expect.arrayContaining([
        `${CookieName.Token} (/)`,
        `${CookieName.RefreshToken} (/)`,
        `${CookieName.GlobalSSOToken} (/)`,
      ]),
    );
    expect(table[0]!.isRevoked).toBe(false);
  });
});
