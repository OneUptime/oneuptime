import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import FakeCounterRedis from "Common/Tests/Server/TestingUtils/Redis/FakeCounterRedis";
import PublicMessageRateLimit, {
  PublicMessageKind,
} from "Common/Server/Utils/RateLimit/PublicMessageRateLimit";
import Exception from "Common/Types/Exception/Exception";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import ObjectID from "Common/Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A STATUS PAGE PRIVATE USER'S PASSWORD RESETS ARE LIMITED PER CALLER AND PER
 * ADDRESS.
 *
 * POST /status-page/forgot-password emails a reset link to the private user
 * the request names, through the page's own mail server when it has one.
 * Nothing counted, so anyone could fill a reader's inbox with them. It now
 * asks PublicMessageRateLimit right before it sends, and this suite drives
 * it through the real router, with a counter store that counts the way
 * Redis does:
 *
 *  - five reset emails to one address in an hour, from every caller and
 *    every status page together, then refused - leaving the link of the
 *    latest email working;
 *  - thirty from one caller in a quarter of an hour;
 *  - an address that is not a private user of the page, and a page that
 *    signs its readers in by SSO, are answered as before and not counted;
 *  - while the counter cannot be reached, the reset email goes out as it
 *    always did.
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

const redisClient: FakeCounterRedis = new FakeCounterRedis();
let isRedisConnected: boolean = true;

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return isRedisConnected ? redisClient : null;
      },
      isConnected: (): boolean => {
        return isRedisConnected;
      },
    },
  };
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

let requireSsoForLogin: boolean = false;

jest.mock("Common/Server/Services/StatusPageService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (data: { id: ObjectID }): Promise<unknown> => {
        return Promise.resolve({
          id: data.id,
          _id: data.id.toString(),
          name: "Acme",
          pageTitle: "Acme Status",
          projectId: new ObjectID("54000000-0000-4000-8000-000000000001"),
          requireSsoForLogin: requireSsoForLogin,
        });
      },
      getStatusPageURL: (): Promise<string> => {
        return Promise.resolve("https://status.example.com");
      },
    },
  };
});

/*
 * The private users, by page and address. Each page's readers are its own:
 * one address can be a reader of several pages.
 */
const readers: Set<string> = new Set<string>();
const readerUpdateOneBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/StatusPagePrivateUserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (data: {
        query: { email?: unknown; statusPageId?: unknown };
      }): Promise<unknown> => {
        const key: string = `${String(data.query.statusPageId)}:${String(
          data.query.email,
        )}`;

        return Promise.resolve(
          readers.has(key)
            ? {
                _id: "54000000-0000-4000-8000-0000000000aa",
                id: new ObjectID("54000000-0000-4000-8000-0000000000aa"),
                password: "$scrypt$stored-hash",
                email: {
                  toString: (): string => {
                    return String(data.query.email);
                  },
                },
              }
            : null,
        );
      },
      updateOneBy: (...args: Array<unknown>): Promise<number> => {
        readerUpdateOneBy(...args);
        return Promise.resolve(1);
      },
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/StatusPagePrivateUserSessionService", () => {
  return {
    __esModule: true,
    default: {
      createSession: jest.fn(),
      findActiveSessionByRefreshToken: jest.fn(),
      isLoginCodeSession: jest.fn(),
      exchangeLoginCode: jest.fn(),
      revokeSessionById: jest.fn(),
      revokeSessionByRefreshToken: jest.fn(),
      renewSessionWithNewRefreshToken: jest.fn(),
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

const sendMail: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/MailService", () => {
  return {
    __esModule: true,
    default: {
      sendMail: (...args: Array<unknown>): Promise<void> => {
        sendMail(...args);
        return Promise.resolve();
      },
    },
  };
});

jest.mock("Common/Server/DatabaseConfig", () => {
  return {
    __esModule: true,
    default: {
      getHost: (): Promise<unknown> => {
        return Promise.resolve({
          toString: (): string => {
            return "localhost";
          },
        });
      },
      getHttpProtocol: (): Promise<unknown> => {
        return Promise.resolve({
          toString: (): string => {
            return "http://";
          },
        });
      },
    },
  };
});

jest.mock("Common/Server/Utils/Cookie", () => {
  return {
    __esModule: true,
    default: {
      setStatusPagePrivateUserCookie: jest.fn(),
      setUserCookie: jest.fn(),
      removeAllCookies: jest.fn(),
      removeCookie: jest.fn(),
      removeStatusPageMasterPasswordCookie: jest.fn(),
      getCookieFromExpressRequest: jest.fn(),
      getRefreshTokenFromExpressRequest: jest.fn(),
      getUserTokenKey: jest.fn(),
      getRefreshTokenKey: jest.fn(),
      getStatusPageMasterPasswordKey: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/JsonWebToken", () => {
  return {
    __esModule: true,
    default: {
      sign: (): string => {
        return "signed-token";
      },
      signStatusPageLoginToken: (): string => {
        return "signed-status-page-token";
      },
      decode: jest.fn(),
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

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/StatusPageAuthentication";

// Page `index` of the project's status pages.
function pageIdOf(index: number): string {
  return `54000000-0000-4000-8000-${String(100 + index).padStart(12, "0")}`;
}

const PAGE_ID: string = pageIdOf(0);
const READER_EMAIL: string = "reader@example.com";
const CALLER: string = "203.0.113.7";

interface Answer {
  error: Exception | null;
  retryAfter: string | undefined;
}

async function forgotPassword(
  email: string,
  from: string,
  pageId: string = PAGE_ID,
): Promise<Answer> {
  const handler: RouteHandler = mockRouter.match("post", "/forgot-password");
  const req: ExpressRequest = buildRequest(
    { data: { email: email, statusPageId: pageId } },
    { headers: { "x-forwarded-for": from }, socketAddress: "10.0.0.2" },
  );
  const headers: Record<string, string> = {};
  const res: ExpressResponse = buildResponse();
  (res as unknown as { setHeader: unknown }).setHeader = (
    name: string,
    value: string,
  ): void => {
    headers[name] = value;
  };

  let error: Exception | null = null;

  await handler(req, res, ((err?: Exception): void => {
    if (err) {
      error = err;
    }
  }) as unknown as NextFunction);

  return { error: error, retryAfter: headers["Retry-After"] };
}

function addReader(email: string, pageId: string = PAGE_ID): void {
  readers.add(`${pageId}:${email}`);
}

async function acceptedOf(
  count: number,
  request: (index: number) => Promise<Answer>,
): Promise<{ accepted: number; refusals: Array<Answer> }> {
  let accepted: number = 0;
  const refusals: Array<Answer> = [];

  for (let index: number = 0; index < count; index++) {
    const answer: Answer = await request(index);

    if (answer.error) {
      refusals.push(answer);
    } else {
      accepted++;
    }
  }

  return { accepted: accepted, refusals: refusals };
}

function expectRefused(answer: Answer | undefined, message: string): void {
  expect(answer?.error?.code).toBe(ExceptionCode.TooManyRequestsException);
  expect(answer?.error?.message).toBe(message);
  expect(answer?.retryAfter).toMatch(/^[1-9][0-9]*$/);
}

const RESET_FROM_NETWORK: string =
  "Too many password resets asked for from your network. Please wait a few minutes and try again.";
const RESET_FOR_ADDRESS: string =
  "Too many password resets asked for this email address in the last hour. Please use the link in the latest email, or try again later.";

let currentTime: number;
let testIndex: number = 0;

beforeEach(() => {
  jest.clearAllMocks();
  redisClient.reset();
  isRedisConnected = true;
  requireSsoForLogin = false;
  readers.clear();
  addReader(READER_EMAIL);

  testIndex++;
  currentTime = Date.UTC(2031, 0, 1) + testIndex * 24 * 60 * 60 * 1000;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return currentTime;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /status-page/forgot-password", () => {
  it("one caller asking again and again for one reader's reset: five emails in the hour, then refused, and the latest link still works", async () => {
    const { accepted, refusals } = await acceptedOf(200, () => {
      return forgotPassword(READER_EMAIL, CALLER);
    });

    // Before these limits: 200 reset emails to one reader.
    expect(accepted).toBe(5);
    expect(sendMail).toHaveBeenCalledTimes(5);
    expect(readerUpdateOneBy).toHaveBeenCalledTimes(5);
    expectRefused(refusals[0], RESET_FOR_ADDRESS);
  });

  it("one address, a reader of page after page, is sent no more than five in the hour from all of them", async () => {
    for (let index: number = 0; index < 8; index++) {
      addReader(READER_EMAIL, pageIdOf(index));
    }

    const { accepted } = await acceptedOf(8, (index: number) => {
      return forgotPassword(
        READER_EMAIL,
        `192.0.2.${index + 1}`,
        pageIdOf(index),
      );
    });

    expect(accepted).toBe(5);
  });

  it("one caller asking for reader after reader's reset: thirty, then refused", async () => {
    for (let index: number = 0; index < 40; index++) {
      addReader(`reader${index}@example.com`);
    }

    const { accepted, refusals } = await acceptedOf(40, (index: number) => {
      return forgotPassword(`reader${index}@example.com`, CALLER);
    });

    expect(accepted).toBe(30);
    expectRefused(refusals[0], RESET_FROM_NETWORK);
  });

  it("an address that is not a reader of the page is answered as before, and counts against nobody", async () => {
    const answer: Answer = await forgotPassword("stranger@example.com", CALLER);

    expect(answer.error?.code).toBe(ExceptionCode.BadDataException);
    expect(answer.error?.message).toBe(
      "No user is registered with stranger@example.com",
    );
    expect(redisClient.keys()).toEqual([]);
  });

  it("a page that signs its readers in by SSO is answered as before, and counts against nobody", async () => {
    requireSsoForLogin = true;

    const answer: Answer = await forgotPassword(READER_EMAIL, CALLER);

    expect(answer.error?.code).toBe(ExceptionCode.BadDataException);
    expect(redisClient.keys()).toEqual([]);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("a reader whose address has an apostrophe in it is sent a reset like anyone", async () => {
    addReader("o'brien@example.com");

    expect(
      (await forgotPassword("o'brien@example.com", CALLER)).error,
    ).toBeNull();
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("while the counter cannot be reached, the reset email goes out as it always did", async () => {
    isRedisConnected = false;

    expect((await forgotPassword(READER_EMAIL, CALLER)).error).toBeNull();
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("is held to PublicMessageRateLimit's limits for a status page's password resets", () => {
    expect(
      PublicMessageRateLimit.getConfig().kinds[
        PublicMessageKind.StatusPagePasswordReset
      ],
    ).toEqual({ perClientLimit: 30, perContactLimit: 5 });
  });
});
