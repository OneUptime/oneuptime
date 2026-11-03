import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
  sentEntityBody,
} from "./IdentityRouterTestUtil";
import FakeCounterRedis from "Common/Tests/Server/TestingUtils/Redis/FakeCounterRedis";
import PublicMessageRateLimit, {
  PublicMessageKind,
} from "Common/Server/Utils/RateLimit/PublicMessageRateLimit";
import { EncryptionSecret } from "Common/Server/EnvironmentConfig";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import Exception from "Common/Types/Exception/Exception";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import HashedString from "Common/Types/HashedString";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  STATUS_PAGE_MAGIC_LINK_EXPIRY_MINUTES,
  STATUS_PAGE_MAGIC_LINK_INVALID_MESSAGE,
  STATUS_PAGE_MAGIC_LINK_NOT_AVAILABLE_MESSAGE,
  STATUS_PAGE_MAGIC_LINK_SSO_REQUIRED_MESSAGE,
  STATUS_PAGE_MAGIC_LINK_TURNED_OFF_MESSAGE,
} from "Common/Types/StatusPage/StatusPageMagicLink";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A PRIVATE STATUS PAGE'S SIGN-IN LINKS (#5600).
 *
 * POST /status-page/send-magic-link emails a private user a link that signs
 * them in without their password; POST /status-page/login-with-magic-link/
 * :statusPageId spends it and signs them in. Driven here through the real
 * router, with a counter store that counts the way Redis does:
 *
 *  - the email: to the private user's own address, a link to the page's
 *    /magic-link-login/<token> that works for fifteen minutes, the token
 *    stored only as its hash, each new link replacing the last;
 *  - asking says nothing about who may sign in: an address that is not a
 *    private user gets the same answer and is counted the same, and nothing
 *    is sent or written for it;
 *  - ten links to one address in an hour, thirty from one caller in a
 *    quarter of an hour, and the email still goes out while the counter
 *    cannot be reached;
 *  - only a page whose visitors sign in, that does not require SSO, with
 *    the switch on, sends or takes a link - asked again when a link is used,
 *    and refused before the link is spent;
 *  - signing in spends the link through the service (one use), opens a
 *    session no SSO provider signed in, sets the page's cookies and answers
 *    with who signed in, never a credential.
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
      return "203.0.113.7";
    },
    extractDeviceInfo: (): Record<string, unknown> => {
      return { deviceName: "Firefox on Linux" };
    },
    headerValueToString: (): string => {
      return "Mozilla/5.0";
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "55000000-0000-4000-8000-000000000001",
);
const PAGE_ID: string = "55000000-0000-4000-8000-000000000100";
const OTHER_PAGE_ID: string = "55000000-0000-4000-8000-000000000101";
const READER_ID: ObjectID = new ObjectID(
  "55000000-0000-4000-8000-0000000000aa",
);
const READER_EMAIL: string = "reader@example.com";
const CALLER: string = "203.0.113.7";
const STATUS_PAGE_URL: string = "https://status.example.com";
const SMTP_SERVER: Record<string, unknown> = { hostname: "smtp.acme.test" };

interface PageState {
  isPublicStatusPage: boolean;
  enableMasterPassword: boolean;
  masterPassword: unknown;
  requireSsoForLogin: boolean;
  enableMagicLinkLogin: boolean | undefined;
  isArchived: boolean;
  exists: boolean;
}

const SIGN_IN_PAGE: PageState = {
  isPublicStatusPage: false,
  enableMasterPassword: false,
  masterPassword: undefined,
  requireSsoForLogin: false,
  enableMagicLinkLogin: true,
  isArchived: false,
  exists: true,
};

let page: PageState = { ...SIGN_IN_PAGE };
const pageSelects: Array<Record<string, unknown>> = [];

jest.mock("Common/Server/Services/StatusPageService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (data: {
        id: ObjectID;
        select: Record<string, unknown>;
      }): Promise<unknown> => {
        pageSelects.push(data.select);

        if (!page.exists) {
          return Promise.resolve(null);
        }

        return Promise.resolve({
          id: data.id,
          _id: data.id.toString(),
          name: "Acme",
          pageTitle: "Acme Status",
          projectId: PROJECT_ID,
          smtpConfig: { _id: "smtp" },
          isPublicStatusPage: page.isPublicStatusPage,
          enableMasterPassword: page.enableMasterPassword,
          masterPassword: page.masterPassword,
          requireSsoForLogin: page.requireSsoForLogin,
          enableMagicLinkLogin: page.enableMagicLinkLogin,
          isArchived: page.isArchived,
        });
      },
      getStatusPageURL: (): Promise<string> => {
        return Promise.resolve(STATUS_PAGE_URL);
      },
    },
  };
});

// The private users, by page and address.
const readers: Set<string> = new Set<string>();
const readerUpdateOneBy: jest.Mock = jest.fn();
const consumeMagicLinkToken: jest.Mock = jest.fn();

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
                _id: READER_ID.toString(),
                id: READER_ID,
                email: new Email(String(data.query.email)),
              }
            : null,
        );
      },
      updateOneBy: (...args: Array<unknown>): Promise<number> => {
        readerUpdateOneBy(...args);
        return Promise.resolve(1);
      },
      updateOneById: jest.fn(),
      findOneById: jest.fn(),
      consumeMagicLinkToken: (...args: Array<unknown>): Promise<unknown> => {
        return consumeMagicLinkToken(...args) as Promise<unknown>;
      },
    },
  };
});

const createSession: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/StatusPagePrivateUserSessionService", () => {
  return {
    __esModule: true,
    SIGN_IN_NO_LONGER_ACCEPTED_REASON: "no longer accepted",
    default: {
      createSession: (...args: Array<unknown>): Promise<unknown> => {
        return createSession(...args) as Promise<unknown>;
      },
      findActiveSessionByRefreshToken: jest.fn(),
      isLoginCodeSession: jest.fn(),
      exchangeLoginCode: jest.fn(),
      revokeSessionById: jest.fn(),
      revokeSessionByRefreshToken: jest.fn(),
      renewSessionWithNewRefreshToken: jest.fn(),
      doesSignInStillCount: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProjectSmtpConfigService", () => {
  return {
    __esModule: true,
    default: {
      toEmailServer: (): unknown => {
        return SMTP_SERVER;
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
            return "oneuptime.test";
          },
        });
      },
      getHttpProtocol: (): Promise<unknown> => {
        return Promise.resolve({
          toString: (): string => {
            return "https://";
          },
        });
      },
    },
  };
});

const setStatusPagePrivateUserCookie: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Cookie", () => {
  return {
    __esModule: true,
    default: {
      setStatusPagePrivateUserCookie: (...args: Array<unknown>): string => {
        setStatusPagePrivateUserCookie(...args);
        return "issued-access-token";
      },
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
const sendEntityResponse: jest.Mock = jest.fn();
const setNoCacheHeaders: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
      sendEmptySuccessResponse: (...args: Array<unknown>): void => {
        sendEmptySuccessResponse(...args);
      },
      sendEntityResponse: (...args: Array<unknown>): void => {
        sendEntityResponse(...args);
      },
      sendJsonObjectResponse: jest.fn(),
      setNoCacheHeaders: (...args: Array<unknown>): void => {
        setNoCacheHeaders(...args);
      },
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/StatusPageAuthentication";

interface Answer {
  error: Exception | null;
  retryAfter: string | undefined;
  res: ExpressResponse;
}

async function invoke(
  handler: RouteHandler,
  req: ExpressRequest,
): Promise<Answer> {
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

  return { error: error, retryAfter: headers["Retry-After"], res: res };
}

async function sendMagicLink(
  email: unknown,
  options: { from?: string; pageId?: string; body?: unknown } = {},
): Promise<Answer> {
  return await invoke(
    mockRouter.match("post", "/send-magic-link"),
    buildRequest(
      options.body !== undefined
        ? options.body
        : { data: { email: email, statusPageId: options.pageId || PAGE_ID } },
      {
        headers: { "x-forwarded-for": options.from || CALLER },
        socketAddress: "10.0.0.2",
      },
    ),
  );
}

async function loginWithMagicLink(
  token: unknown,
  pageId: string = PAGE_ID,
): Promise<Answer> {
  const req: ExpressRequest = buildRequest(
    { token: token },
    { headers: { "x-forwarded-for": CALLER }, socketAddress: "10.0.0.2" },
  );
  (req as unknown as { params: Record<string, string> }).params = {
    statuspageid: pageId,
  };

  return await invoke(
    mockRouter.match("post", "/login-with-magic-link/:statuspageid"),
    req,
  );
}

function addReader(email: string, pageId: string = PAGE_ID): void {
  readers.add(`${pageId}:${email}`);
}

// The link the latest email carries, and its token.
function sentLink(callIndex: number = 0): { url: string; token: string } {
  const message: { vars: Record<string, string> } = sendMail.mock.calls[
    callIndex
  ]![0] as { vars: Record<string, string> };
  const url: string = message.vars["tokenVerifyUrl"]!;
  const token: string = url.slice(url.lastIndexOf("/") + 1);

  return { url: url, token: token };
}

function storedLink(callIndex: number = 0): {
  magicLinkToken: string;
  magicLinkExpires: Date;
} {
  const update: { data: { magicLinkToken: string; magicLinkExpires: Date } } =
    readerUpdateOneBy.mock.calls[callIndex]![0] as {
      data: { magicLinkToken: string; magicLinkExpires: Date };
    };

  return update.data;
}

function signedInUser(): StatusPagePrivateUser {
  const user: StatusPagePrivateUser = new StatusPagePrivateUser();
  user._id = READER_ID.toString();
  user.email = new Email(READER_EMAIL);
  user.statusPageId = new ObjectID(PAGE_ID);
  user.projectId = PROJECT_ID;
  return user;
}

const LINKS_FOR_ADDRESS: string =
  "Too many sign-in links asked for this email address in the last hour. Please use the link in the latest email, or try again later.";
const LINKS_FROM_NETWORK: string =
  "Too many sign-in links asked for from your network. Please wait a few minutes and try again.";

let currentTime: number;
let testIndex: number = 0;

beforeEach(() => {
  jest.clearAllMocks();
  redisClient.reset();
  isRedisConnected = true;
  page = { ...SIGN_IN_PAGE };
  pageSelects.length = 0;
  readers.clear();
  addReader(READER_EMAIL);

  consumeMagicLinkToken.mockResolvedValue(signedInUser());
  createSession.mockResolvedValue({
    session: { id: new ObjectID("55000000-0000-4000-8000-0000000000bb") },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(Date.UTC(2031, 1, 1)),
  });

  // Each test in a window of its own, so no count carries over.
  testIndex++;
  currentTime = Date.UTC(2031, 0, 1) + testIndex * 24 * 60 * 60 * 1000;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return currentTime;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /status-page/send-magic-link", () => {
  it("emails the private user a link to the page's sign-in link route", async () => {
    const answer: Answer = await sendMagicLink(READER_EMAIL);

    expect(answer.error).toBeNull();
    expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(1);

    const [message, options] = sendMail.mock.calls[0] as [
      {
        toEmail: Email;
        subject: string;
        isSubjectLiteral: boolean;
        templateType: EmailTemplateType;
        vars: Record<string, string>;
      },
      Record<string, unknown>,
    ];

    expect(message.toEmail.toString()).toBe(READER_EMAIL);
    expect(message.subject).toBe("Log in to Acme Status");
    expect(message.isSubjectLiteral).toBe(true);
    expect(message.templateType).toBe(EmailTemplateType.StatusPageMagicLink);
    expect(message.vars["statusPageName"]).toBe("Acme Status");
    expect(message.vars["homeURL"]).toBe(STATUS_PAGE_URL);
    expect(message.vars["expiresInMinutes"]).toBe(
      String(STATUS_PAGE_MAGIC_LINK_EXPIRY_MINUTES),
    );

    const { url, token } = sentLink();

    expect(url).toBe(`${STATUS_PAGE_URL}/magic-link-login/${token}`);
    expect(ObjectID.isValidUUID(token)).toBe(true);

    // From the page's own mail server, for its project and page.
    expect(options["projectId"]).toEqual(PROJECT_ID);
    expect(options["mailServer"]).toBe(SMTP_SERVER);
    expect(options["statusPageId"]?.toString()).toBe(PAGE_ID);
  });

  it("stores only the hash of the link's token, on the private user it signs in", async () => {
    await sendMagicLink(READER_EMAIL);

    const { token } = sentLink();
    const stored: { magicLinkToken: string } = storedLink();

    expect(readerUpdateOneBy).toHaveBeenCalledTimes(1);
    expect(
      (readerUpdateOneBy.mock.calls[0]![0] as { query: JSONObject }).query,
    ).toEqual({ _id: READER_ID.toString() });
    expect(stored.magicLinkToken).not.toBe(token);
    expect(stored.magicLinkToken).not.toContain(token);
    expect(stored.magicLinkToken).toBe(
      await HashedString.hashValue(token, EncryptionSecret),
    );
  });

  it("makes the link work for fifteen minutes", async () => {
    await sendMagicLink(READER_EMAIL);

    // The clock is the test's (Date.now, above), and so is the expiry.
    expect(storedLink().magicLinkExpires.getTime()).toBe(
      Date.now() + STATUS_PAGE_MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000,
    );
  });

  it("each link asked for replaces the last, with a token of its own", async () => {
    await sendMagicLink(READER_EMAIL);
    await sendMagicLink(READER_EMAIL);

    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sentLink(0).token).not.toBe(sentLink(1).token);
    expect(storedLink(0).magicLinkToken).not.toBe(
      storedLink(1).magicLinkToken,
    );
    expect(storedLink(1).magicLinkToken).toBe(
      await HashedString.hashValue(sentLink(1).token, EncryptionSecret),
    );
  });

  it("answers an address that is not a private user of the page exactly as one that is, sending and writing nothing", async () => {
    const stranger: Answer = await sendMagicLink("stranger@example.com");

    expect(stranger.error).toBeNull();
    expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(sendMail).not.toHaveBeenCalled();
    expect(readerUpdateOneBy).not.toHaveBeenCalled();
  });

  it("a reader of another page is not a reader of this one", async () => {
    addReader("elsewhere@example.com", OTHER_PAGE_ID);

    expect((await sendMagicLink("elsewhere@example.com")).error).toBeNull();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("counts an address that is not a private user like one that is, so a refusal says nothing about who may sign in", async () => {
    const answersFor: (email: string) => Promise<Array<Answer>> = async (
      email: string,
    ): Promise<Array<Answer>> => {
      const answers: Array<Answer> = [];

      for (let index: number = 0; index < 12; index++) {
        answers.push(await sendMagicLink(email));
      }

      return answers;
    };

    const strangerAnswers: Array<Answer> = await answersFor(
      "stranger@example.com",
    );
    const readerAnswers: Array<Answer> = await answersFor(READER_EMAIL);

    const shapeOf: (answers: Array<Answer>) => Array<string | null> = (
      answers: Array<Answer>,
    ): Array<string | null> => {
      return answers.map((answer: Answer): string | null => {
        return answer.error ? answer.error.message : null;
      });
    };

    expect(shapeOf(strangerAnswers)).toEqual(shapeOf(readerAnswers));
    expect(shapeOf(readerAnswers).slice(0, 10)).toEqual(
      new Array(10).fill(null),
    );
    expect(shapeOf(readerAnswers)[10]).toBe(LINKS_FOR_ADDRESS);
  });

  it("one caller asking again and again for one reader's link: ten emails in the hour, then refused, and the latest link still works", async () => {
    const refusals: Array<Answer> = [];

    for (let index: number = 0; index < 50; index++) {
      const answer: Answer = await sendMagicLink(READER_EMAIL);

      if (answer.error) {
        refusals.push(answer);
      }
    }

    expect(sendMail).toHaveBeenCalledTimes(10);
    expect(readerUpdateOneBy).toHaveBeenCalledTimes(10);
    expect(refusals).toHaveLength(40);
    expect(refusals[0]!.error?.code).toBe(
      ExceptionCode.TooManyRequestsException,
    );
    expect(refusals[0]!.error?.message).toBe(LINKS_FOR_ADDRESS);
    expect(refusals[0]!.retryAfter).toMatch(/^[1-9][0-9]*$/);
  });

  it("one caller asking for address after address: thirty, then refused", async () => {
    let accepted: number = 0;
    let firstRefusal: Answer | null = null;

    for (let index: number = 0; index < 40; index++) {
      const answer: Answer = await sendMagicLink(
        `someone${index}@example.com`,
      );

      if (answer.error) {
        firstRefusal = firstRefusal || answer;
      } else {
        accepted++;
      }
    }

    expect(accepted).toBe(30);
    expect(firstRefusal?.error?.message).toBe(LINKS_FROM_NETWORK);
  });

  it("is held to PublicMessageRateLimit's limits for sign-in links", () => {
    expect(
      PublicMessageRateLimit.getConfig().kinds[
        PublicMessageKind.StatusPageMagicLink
      ],
    ).toEqual({ perClientLimit: 30, perContactLimit: 10 });
  });

  it("refuses a list of addresses rather than mailing each of them", async () => {
    addReader("a@example.com,b@example.com");

    const answer: Answer = await sendMagicLink("a@example.com,b@example.com");

    expect(answer.error?.code).toBe(ExceptionCode.BadDataException);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("while the counter cannot be reached, the email still goes out", async () => {
    isRedisConnected = false;

    expect((await sendMagicLink(READER_EMAIL)).error).toBeNull();
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no body at all", {}],
    ["no data", { data: undefined }],
    ["no email", { data: { statusPageId: PAGE_ID } }],
    ["an empty email", { data: { email: "", statusPageId: PAGE_ID } }],
    ["no status page", { data: { email: READER_EMAIL } }],
  ])(
    "refuses a request with %s, sending nothing",
    async (_name: string, body: unknown) => {
      const answer: Answer = await sendMagicLink(undefined, { body: body });

      expect(answer.error?.code).toBe(ExceptionCode.BadDataException);
      expect(sendMail).not.toHaveBeenCalled();
      expect(readerUpdateOneBy).not.toHaveBeenCalled();
      expect(redisClient.keys()).toEqual([]);
    },
  );

  it.each([
    [
      "requires SSO",
      { requireSsoForLogin: true },
      STATUS_PAGE_MAGIC_LINK_SSO_REQUIRED_MESSAGE,
    ],
    [
      "has sign-in links turned off",
      { enableMagicLinkLogin: false },
      STATUS_PAGE_MAGIC_LINK_TURNED_OFF_MESSAGE,
    ],
    [
      "was read without the switch",
      { enableMagicLinkLogin: undefined },
      STATUS_PAGE_MAGIC_LINK_TURNED_OFF_MESSAGE,
    ],
    [
      "is public",
      { isPublicStatusPage: true },
      STATUS_PAGE_MAGIC_LINK_NOT_AVAILABLE_MESSAGE,
    ],
    [
      "asks visitors for its master password",
      { enableMasterPassword: true, masterPassword: "stored-hash" },
      STATUS_PAGE_MAGIC_LINK_NOT_AVAILABLE_MESSAGE,
    ],
    ["is archived", { isArchived: true }, "Status Page not found"],
    ["does not exist", { exists: false }, "Status Page not found"],
  ])(
    "a page that %s sends no link, and counts against nobody",
    async (
      _name: string,
      state: Partial<PageState>,
      message: string,
    ): Promise<void> => {
      page = { ...SIGN_IN_PAGE, ...state };

      const answer: Answer = await sendMagicLink(READER_EMAIL);

      expect(answer.error?.code).toBe(ExceptionCode.BadDataException);
      expect(answer.error?.message).toBe(message);
      expect(sendMail).not.toHaveBeenCalled();
      expect(readerUpdateOneBy).not.toHaveBeenCalled();
      expect(redisClient.keys()).toEqual([]);
    },
  );

  it("a private page with the master password switch on but no password set is a sign-in page, and sends the link", async () => {
    page = { ...SIGN_IN_PAGE, enableMasterPassword: true };

    expect((await sendMagicLink(READER_EMAIL)).error).toBeNull();
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("reads every column that decides whether the page takes sign-in links", async () => {
    await sendMagicLink(READER_EMAIL);

    expect(pageSelects[0]).toMatchObject({
      isPublicStatusPage: true,
      enableMasterPassword: true,
      masterPassword: true,
      requireSsoForLogin: true,
      enableMagicLinkLogin: true,
      isArchived: true,
    });
  });
});

describe("POST /status-page/login-with-magic-link/:statusPageId", () => {
  const TOKEN: string = "6f1c7e4a-2b3d-4c5e-8f90-a1b2c3d4e5f6";

  it("spends the link and signs the private user in", async () => {
    const answer: Answer = await loginWithMagicLink(TOKEN);

    expect(answer.error).toBeNull();
    expect(consumeMagicLinkToken).toHaveBeenCalledTimes(1);

    const consumed: { statusPageId: ObjectID; token: string } =
      consumeMagicLinkToken.mock.calls[0]![0] as {
        statusPageId: ObjectID;
        token: string;
      };

    expect(consumed.statusPageId.toString()).toBe(PAGE_ID);
    expect(consumed.token).toBe(TOKEN);

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(setStatusPagePrivateUserCookie).toHaveBeenCalledTimes(1);
    expect(sendEntityResponse).toHaveBeenCalledTimes(1);
  });

  it("opens a session for the user, on their page and project, that no SSO provider signed in", async () => {
    await loginWithMagicLink(TOKEN);

    const session: Record<string, unknown> = createSession.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(session["statusPagePrivateUserId"]?.toString()).toBe(
      READER_ID.toString(),
    );
    expect(session["statusPageId"]?.toString()).toBe(PAGE_ID);
    expect(session["projectId"]?.toString()).toBe(PROJECT_ID.toString());
    expect(session["statusPageSsoId"]).toBeUndefined();
    expect(session["statusPageOidcId"]).toBeUndefined();
    expect(session["ipAddress"]).toBe("203.0.113.7");
    expect(session["userAgent"]).toBe("Mozilla/5.0");
  });

  it("sets the page's sign-in cookies for that session", async () => {
    await loginWithMagicLink(TOKEN);

    const cookie: Record<string, unknown> = setStatusPagePrivateUserCookie.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(cookie["statusPageId"]?.toString()).toBe(PAGE_ID);
    expect(cookie["refreshToken"]).toBe("refresh-token");
    expect(cookie["sessionId"]?.toString()).toBe(
      "55000000-0000-4000-8000-0000000000bb",
    );
  });

  it("answers with who signed in and nothing else: no token, no credential", async () => {
    await loginWithMagicLink(TOKEN);

    const body: JSONObject = sentEntityBody(sendEntityResponse.mock.calls[0]!);
    const text: string = JSON.stringify(body);

    expect(body["_id"]).toBe(READER_ID.toString());
    expect(text).toContain(READER_EMAIL);
    expect(text).not.toContain("issued-access-token");
    expect(text).not.toContain("refresh-token");
    expect(text).not.toContain(TOKEN);
    expect(body).not.toHaveProperty("password");
    expect(body).not.toHaveProperty("magicLinkToken");
    expect(body).not.toHaveProperty("magicLinkExpires");
    expect(sendEntityResponse.mock.calls[0]![4]).toBeUndefined();
  });

  it("is never cached", async () => {
    await loginWithMagicLink(TOKEN);

    expect(setNoCacheHeaders).toHaveBeenCalledTimes(1);
  });

  it("a link that is not one - used, expired, replaced or never sent - signs nobody in", async () => {
    consumeMagicLinkToken.mockResolvedValue(null);

    const answer: Answer = await loginWithMagicLink(TOKEN);

    expect(answer.error?.code).toBe(ExceptionCode.BadDataException);
    expect(answer.error?.message).toBe(STATUS_PAGE_MAGIC_LINK_INVALID_MESSAGE);
    expect(createSession).not.toHaveBeenCalled();
    expect(setStatusPagePrivateUserCookie).not.toHaveBeenCalled();
  });

  it("the same link twice: the second finds it spent", async () => {
    consumeMagicLinkToken
      .mockResolvedValueOnce(signedInUser())
      .mockResolvedValueOnce(null);

    expect((await loginWithMagicLink(TOKEN)).error).toBeNull();

    const second: Answer = await loginWithMagicLink(TOKEN);

    expect(second.error?.message).toBe(STATUS_PAGE_MAGIC_LINK_INVALID_MESSAGE);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no token", undefined],
    ["an empty token", ""],
    ["a number", 42],
    ["an object", { $ne: null }],
    ["an array", [TOKEN]],
    ["a token that is not a UUID", "not-a-token"],
    ["a token with more after it", `${TOKEN}x`],
  ])(
    "%s is no link at all: the link is not looked up",
    async (_name: string, token: unknown) => {
      const answer: Answer = await loginWithMagicLink(token);

      expect(answer.error?.code).toBe(ExceptionCode.BadDataException);
      expect(answer.error?.message).toBe(
        STATUS_PAGE_MAGIC_LINK_INVALID_MESSAGE,
      );
      expect(consumeMagicLinkToken).not.toHaveBeenCalled();
      expect(createSession).not.toHaveBeenCalled();
    },
  );

  it("a status page id that is not one is refused before anything is read", async () => {
    const answer: Answer = await loginWithMagicLink(TOKEN, "not-an-id");

    expect(answer.error?.code).toBe(ExceptionCode.BadDataException);
    expect(pageSelects).toHaveLength(0);
    expect(consumeMagicLinkToken).not.toHaveBeenCalled();
  });

  it.each([
    [
      "now requires SSO",
      { requireSsoForLogin: true },
      STATUS_PAGE_MAGIC_LINK_SSO_REQUIRED_MESSAGE,
    ],
    [
      "has turned sign-in links off",
      { enableMagicLinkLogin: false },
      STATUS_PAGE_MAGIC_LINK_TURNED_OFF_MESSAGE,
    ],
    [
      "is public now",
      { isPublicStatusPage: true },
      STATUS_PAGE_MAGIC_LINK_NOT_AVAILABLE_MESSAGE,
    ],
    [
      "asks for its master password now",
      { enableMasterPassword: true, masterPassword: "stored-hash" },
      STATUS_PAGE_MAGIC_LINK_NOT_AVAILABLE_MESSAGE,
    ],
    ["is archived", { isArchived: true }, "Status Page not found"],
    ["is gone", { exists: false }, "Status Page not found"],
  ])(
    "a link to a page that %s signs nobody in, and is not spent",
    async (
      _name: string,
      state: Partial<PageState>,
      message: string,
    ): Promise<void> => {
      page = { ...SIGN_IN_PAGE, ...state };

      const answer: Answer = await loginWithMagicLink(TOKEN);

      expect(answer.error?.code).toBe(ExceptionCode.BadDataException);
      expect(answer.error?.message).toBe(message);
      expect(consumeMagicLinkToken).not.toHaveBeenCalled();
      expect(createSession).not.toHaveBeenCalled();
    },
  );

  it("is not attempt-limited like a password, and takes no address to count", async () => {
    // A UUID from the CSPRNG, used once, for minutes: nothing to guess.
    const handlers: Array<RouteHandler> = mockRouter.matchAll(
      "post",
      "/login-with-magic-link/:statuspageid",
    );

    expect(handlers).toHaveLength(1);
  });
});
