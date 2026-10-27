import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import FakeCounterRedis from "Common/Tests/Server/TestingUtils/Redis/FakeCounterRedis";
import { getIpv6NetworkRateLimit } from "Common/Server/Utils/ClientIp";
import PublicMessageRateLimit, {
  PUBLIC_MESSAGE_ONE_EMAIL_ADDRESS_MESSAGE,
  PublicMessageKind,
} from "Common/Server/Utils/RateLimit/PublicMessageRateLimit";
import BadDataException from "Common/Types/Exception/BadDataException";
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
 * PASSWORD RESETS AND THE EMAILS A SIGN-UP SENDS ARE LIMITED PER CALLER AND
 * PER ADDRESS.
 *
 * POST /forgot-password emails a reset link to any account's address the
 * request names, and POST /signup emails the address it signs up - a new
 * account's welcome, or, for an invitation nobody has claimed, a fresh
 * registration link, as often as it is asked. Neither counted anything, so
 * anyone could send any account holder as many reset emails as they liked,
 * and send a registration email to an invited address again and again.
 *
 * Both now ask PublicMessageRateLimit right before they send, and this suite
 * drives them through the real router, with a counter store that counts the
 * way Redis does. It holds:
 *
 *  - five reset emails to one address in an hour, from every caller
 *    together, and thirty from one caller in a quarter of an hour;
 *  - that a refused reset leaves the reset link of the latest email working;
 *  - an address with no account is answered as before, and not counted;
 *  - sixty sign-ups that send an email from one caller in a quarter of an
 *    hour, and five registration emails to one invited address in an hour;
 *  - that a refused sign-up creates no account, and that claiming an
 *    invitation with its token - which sends nothing - is never counted;
 *  - that a sign-up whose account cannot be created gives its address the
 *    count back (only emails sent count against an address), while the
 *    caller's own count stays spent;
 *  - that signing in to an address not verified yet - which emails it a
 *    fresh link - shares the address's five with its sign-up;
 *  - that a list of addresses is refused rather than sent to;
 *  - and, while the counter cannot be reached, that the emails go out
 *    uncounted, as they did before.
 *
 * Both deployment shapes are run: on the hosted service (billing on) a new
 * account waits for its address to be verified; self-hosted it is signed in.
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

let mockBillingEnabled: boolean = true;

/*
 * The server does not require single sign-on here: every sign-in and sign-up
 * asks SsoRequiredSignIn first, which reads GlobalConfig. Driven for real in
 * SsoRequiredSignInRoutes.test.ts.
 */
jest.mock("Common/Server/Utils/SsoRequiredSignIn", () => {
  return jest
    .requireActual<typeof import("./SsoNotRequiredStandIn")>(
      "./SsoNotRequiredStandIn",
    )
    .ssoNotRequired();
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual, __esModule: true };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return mockBillingEnabled;
    },
  });

  return mocked;
});

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

jest.mock("Common/Server/Services/EmailVerificationTokenService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      create: (): Promise<null> => {
        return Promise.resolve(null);
      },
      deleteOneBy: jest.fn(),
    },
  };
});

/*
 * The accounts, by address, as the user table holds them: a password on a
 * registered account, none on an invitation nobody has claimed.
 */
type UserRow = {
  id: ObjectID;
  email: string;
  password: string | null;
};

const users: Map<string, UserRow> = new Map<string, UserRow>();
const ACCOUNT_PASSWORD: string = "violet river lantern";
const userUpdateOneBy: jest.Mock = jest.fn();
const userCreateUserOnSignup: jest.Mock = jest.fn();
const userUpdateOneByIdAndFetch: jest.Mock = jest.fn();

function asUser(row: UserRow): Record<string, unknown> {
  return {
    id: row.id,
    _id: row.id.toString(),
    password: row.password,
    name: undefined,
    isMasterAdmin: false,
    isBlocked: false,
    email: {
      toString: (): string => {
        return row.email;
      },
    },
  };
}

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (data: { query: { email?: unknown } }): unknown => {
        const row: UserRow | undefined = users.get(
          String(data.query.email ?? ""),
        );

        return Promise.resolve(row ? asUser(row) : null);
      },
      updateOneBy: (...args: Array<unknown>): unknown => {
        userUpdateOneBy(...args);
        return Promise.resolve(1);
      },
      updateOneById: jest.fn(),
      updateOneByIdAndFetch: (...args: Array<unknown>): unknown => {
        return userUpdateOneByIdAndFetch(...args);
      },
      create: jest.fn(),
      createUserOnSignup: (...args: Array<unknown>): unknown => {
        return userCreateUserOnSignup(...args);
      },
      // The one password every account here has.
      verifyHashedColumnValue: (data: {
        plainValue?: unknown;
      }): Promise<boolean> => {
        return Promise.resolve(data.plainValue === ACCOUNT_PASSWORD);
      },
      countBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});

jest.mock("Common/Server/Services/AccessTokenService", () => {
  return {
    __esModule: true,
    default: { refreshUserAllPermissions: jest.fn() },
  };
});

jest.mock("Common/Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: {
      createSession: (): Promise<unknown> => {
        return Promise.resolve({
          session: {
            id: new ObjectID("53000000-0000-4000-8000-000000000001"),
          },
          refreshToken: "refresh-token",
          refreshTokenExpiresAt: new Date(),
        });
      },
      revokeAllSessionsByUserId: jest.fn(),
      findActiveSessionByRefreshToken: jest.fn(),
      revokeSessionById: jest.fn(),
      revokeSessionByRefreshToken: jest.fn(),
      renewSessionWithNewRefreshToken: jest.fn(),
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
      shouldDisableSignup: (): Promise<boolean> => {
        return Promise.resolve(false);
      },
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
      setUserCookie: jest.fn(),
      removeAllCookies: jest.fn(),
      removeCookie: jest.fn(),
      getRefreshTokenFromExpressRequest: jest.fn(),
      getUserTokenKey: jest.fn(),
      getRefreshTokenKey: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Captcha", () => {
  return {
    __esModule: true,
    default: {
      verifyCaptcha: (): Promise<void> => {
        return Promise.resolve();
      },
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
      signUserLoginToken: (): string => {
        return "signed-user-token";
      },
    },
  };
});

const sendCompleteRegistrationEmail: jest.Mock = jest.fn();
const sendVerificationEmail: jest.Mock = jest.fn();

jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: {
      sendVerificationEmail: (...args: Array<unknown>): unknown => {
        sendVerificationEmail(...args);
        return Promise.resolve();
      },
      sendCompleteRegistrationEmail: (...args: Array<unknown>): unknown => {
        sendCompleteRegistrationEmail(...args);
        return Promise.resolve();
      },
    },
  };
});

const consumeRegistrationToken: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/UserRegistrationToken", () => {
  return {
    __esModule: true,
    REGISTRATION_TOKEN_EXPIRY_IN_DAYS: 7,
    default: {
      consumeRegistrationToken: (...args: Array<unknown>): unknown => {
        return consumeRegistrationToken(...args);
      },
      generateRegistrationToken: jest.fn(),
      generateRegistrationLink: jest.fn(),
      getRegistrationLink: jest.fn(),
    },
  };
});

jest.mock("Common/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (): Promise<unknown> => {
        return Promise.resolve({});
      },
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

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: (...args: Array<unknown>): unknown => {
        return sendErrorResponse(...args);
      },
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/Authentication";

const VICTIM_EMAIL: string = "victim@example.com";
const VICTIM_ID: ObjectID = new ObjectID(
  "53000000-0000-4000-8000-0000000000aa",
);
const CALLER: string = "203.0.113.7";
const INVITATION_TOKEN: string = "53000000-0000-4000-8000-0000000000bb";

interface Answer {
  error: Exception | null;
  retryAfter: string | undefined;
}

// One request as it reaches the app through the bundled Nginx.
async function post(uri: string, body: unknown, from: string): Promise<Answer> {
  const handler: RouteHandler = mockRouter.match("post", uri);
  const req: ExpressRequest = buildRequest(body, {
    headers: { "x-forwarded-for": from },
    socketAddress: "10.0.0.2",
  });
  const headers: Record<string, string> = {};
  const res: ExpressResponse = buildResponse();
  (res as unknown as { setHeader: unknown }).setHeader = (
    name: string,
    value: string,
  ): void => {
    headers[name] = value;
  };

  let error: Exception | null = null;
  const answeredBefore: number = sendErrorResponse.mock.calls.length;

  await handler(req, res, ((err?: Exception): void => {
    if (err) {
      error = err;
    }
  }) as unknown as NextFunction);

  // Some refusals are answered by the handler itself, not passed on.
  if (!error && sendErrorResponse.mock.calls.length > answeredBefore) {
    error = sendErrorResponse.mock.calls[
      sendErrorResponse.mock.calls.length - 1
    ]![2] as Exception;
  }

  return { error: error, retryAfter: headers["Retry-After"] };
}

async function forgotPassword(email: string, from: string): Promise<Answer> {
  return await post("/forgot-password", { data: { email: email } }, from);
}

function signUpBody(email: string, registrationToken?: string): unknown {
  return {
    data: {
      email: { _type: "Email", value: email },
      password: { _type: "HashedString", value: "violet river lantern" },
      name: { _type: "Name", value: "New User" },
      companyName: "Example Inc",
    },
    ...(registrationToken
      ? { miscDataProps: { registrationToken: registrationToken } }
      : {}),
  };
}

async function signUp(
  email: string,
  from: string,
  registrationToken?: string,
): Promise<Answer> {
  return await post("/signup", signUpBody(email, registrationToken), from);
}

// Runs `count` requests one after another and tells how many went through.
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

function register(email: string, password: string | null): UserRow {
  const row: UserRow = {
    id: new ObjectID(
      `53000000-0000-4000-8000-${String(users.size + 1).padStart(12, "0")}`,
    ),
    email: email,
    password: password,
  };

  users.set(email, row);

  return row;
}

let currentTime: number;
let testIndex: number = 0;

beforeEach(() => {
  jest.clearAllMocks();
  redisClient.reset();
  isRedisConnected = true;
  mockBillingEnabled = true;
  users.clear();

  register(VICTIM_EMAIL, "$scrypt$stored-hash").id = VICTIM_ID;

  consumeRegistrationToken.mockImplementation(
    async (data: { token: ObjectID }): Promise<boolean> => {
      return data.token.toString() === INVITATION_TOKEN;
    },
  );
  userCreateUserOnSignup.mockImplementation(
    async (data: Record<string, any>): Promise<unknown> => {
      const user: Record<string, any> = data["user"] as Record<string, any>;
      user["_id"] = "53000000-0000-4000-8000-0000000000cc";
      return user;
    },
  );
  userUpdateOneByIdAndFetch.mockImplementation(async (): Promise<unknown> => {
    return {
      _id: "53000000-0000-4000-8000-0000000000dd",
      id: new ObjectID("53000000-0000-4000-8000-0000000000dd"),
      email: {
        toString: (): string => {
          return "invited@example.com";
        },
      },
    };
  });

  // The start of an hour, a day further on for each test.
  testIndex++;
  currentTime = Date.UTC(2031, 0, 1) + testIndex * 24 * 60 * 60 * 1000;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return currentTime;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const RESET_FROM_NETWORK: string =
  "Too many password resets asked for from your network. Please wait a few minutes and try again.";
const RESET_FOR_ADDRESS: string =
  "Too many password resets asked for this email address in the last hour. Please use the link in the latest email, or try again later.";

describe("POST /forgot-password", () => {
  it("one caller asking again and again for one account's reset: five emails in the hour, then refused", async () => {
    const { accepted, refusals } = await acceptedOf(200, () => {
      return forgotPassword(VICTIM_EMAIL, CALLER);
    });

    // Before these limits: 200 reset emails to one inbox.
    expect(accepted).toBe(5);
    expect(sendMail).toHaveBeenCalledTimes(5);
    expectRefused(refusals[0], RESET_FOR_ADDRESS);
  });

  it("a refused request does not replace the reset token: the link in the latest email still works", async () => {
    await acceptedOf(5, () => {
      return forgotPassword(VICTIM_EMAIL, CALLER);
    });

    expect(userUpdateOneBy).toHaveBeenCalledTimes(5);

    expectRefused(
      await forgotPassword(VICTIM_EMAIL, "198.51.100.9"),
      RESET_FOR_ADDRESS,
    );
    expect(userUpdateOneBy).toHaveBeenCalledTimes(5);
  });

  it("callers on address after address get no more than five to one account", async () => {
    const { accepted } = await acceptedOf(50, (index: number) => {
      return forgotPassword(VICTIM_EMAIL, `192.0.2.${index + 1}`);
    });

    expect(accepted).toBe(5);
  });

  it("one caller asking for account after account's reset: thirty, then refused", async () => {
    for (let index: number = 0; index < 40; index++) {
      register(`member${index}@example.com`, "$scrypt$stored-hash");
    }

    const { accepted, refusals } = await acceptedOf(40, (index: number) => {
      return forgotPassword(`member${index}@example.com`, CALLER);
    });

    expect(accepted).toBe(30);
    expect(sendMail).toHaveBeenCalledTimes(30);
    expectRefused(refusals[0], RESET_FROM_NETWORK);
  });

  it("an address with no account is answered as before, and counts against nobody", async () => {
    const answer: Answer = await forgotPassword("nobody@example.com", CALLER);

    expect(answer.error?.code).toBe(ExceptionCode.BadDataException);
    expect(answer.error?.message).toBe(
      "No user is registered with nobody@example.com. Please sign up for a new account.",
    );
    expect(redisClient.keys()).toEqual([]);
  });

  it("the hosts of one IPv6 /64 ask for ten addresses' worth of resets", async () => {
    const networkLimit: number = getIpv6NetworkRateLimit(30);

    for (let index: number = 0; index < networkLimit + 10; index++) {
      register(`member${index}@example.com`, "$scrypt$stored-hash");
    }

    const { accepted, refusals } = await acceptedOf(
      networkLimit + 10,
      (index: number) => {
        return forgotPassword(
          `member${index}@example.com`,
          `2001:db8:5:6:0:${index.toString(16)}:a:b`,
        );
      },
    );

    expect(accepted).toBe(networkLimit);
    expectRefused(refusals[0], RESET_FROM_NETWORK);
  });

  it("an account whose address has an apostrophe in it is sent its reset like any other", async () => {
    register("o'brien@example.com", "$scrypt$stored-hash");

    expect(
      (await forgotPassword("o'brien@example.com", CALLER)).error,
    ).toBeNull();
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("an hour on, the account's owner is sent a reset again", async () => {
    await acceptedOf(6, () => {
      return forgotPassword(VICTIM_EMAIL, CALLER);
    });

    currentTime += 60 * 60 * 1000;

    expect((await forgotPassword(VICTIM_EMAIL, CALLER)).error).toBeNull();
    expect(sendMail).toHaveBeenCalledTimes(6);
  });

  it("while the counter cannot be reached, the reset email goes out as it always did", async () => {
    isRedisConnected = false;

    expect((await forgotPassword(VICTIM_EMAIL, CALLER)).error).toBeNull();
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});

const SIGN_UP_FROM_NETWORK: string =
  "Too many sign-ups from your network. Please wait a few minutes and try again.";
const SIGN_UP_FOR_ADDRESS: string =
  "Too many sign-up emails asked for this email address in the last hour. Please use the link in the latest one, or try again later.";

describe.each([
  ["on the hosted service", true],
  ["self-hosted", false],
])("POST /signup %s", (_where: string, billingEnabled: boolean) => {
  beforeEach(() => {
    mockBillingEnabled = billingEnabled;
  });

  it("sixty new accounts from one network in a quarter hour - a class signing up together - then refused, and a refused sign-up creates nothing", async () => {
    const { accepted, refusals } = await acceptedOf(70, (index: number) => {
      return signUp(`student${index}@example.com`, CALLER);
    });

    expect(accepted).toBe(60);
    expect(userCreateUserOnSignup).toHaveBeenCalledTimes(60);
    expect(sendMail).toHaveBeenCalledTimes(60);
    expectRefused(refusals[0], SIGN_UP_FROM_NETWORK);
  });

  it("an invitation nobody has claimed: five registration emails in the hour, then refused", async () => {
    register("invited@example.com", null);

    const { accepted, refusals } = await acceptedOf(100, (index: number) => {
      return signUp("invited@example.com", `192.0.2.${(index % 50) + 1}`);
    });

    // Before these limits: one registration email per request.
    expect(accepted).toBe(5);
    expect(sendCompleteRegistrationEmail).toHaveBeenCalledTimes(5);
    expectRefused(refusals[0], SIGN_UP_FOR_ADDRESS);
  });

  it("claiming the invitation with its token sends nothing and is never counted, even once the network is out of sign-ups", async () => {
    await acceptedOf(61, (index: number) => {
      return signUp(`student${index}@example.com`, CALLER);
    });

    register("invited@example.com", null);
    const keysBefore: Array<string> = redisClient.keys();

    const claim: Answer = await signUp(
      "invited@example.com",
      CALLER,
      INVITATION_TOKEN,
    );

    expect(claim.error).toBeNull();
    expect(userUpdateOneByIdAndFetch).toHaveBeenCalledTimes(1);
    expect(redisClient.keys()).toEqual(keysBefore);
  });

  it("an address that already has an account is answered as before, and counts against nobody", async () => {
    const answer: Answer = await signUp(VICTIM_EMAIL, CALLER);

    expect(answer.error?.message).toBe(
      `User with email ${VICTIM_EMAIL} already exists.`,
    );
    expect(redisClient.keys()).toEqual([]);
  });

  it("a list of addresses is refused, and no account is created or emailed", async () => {
    const answer: Answer = await signUp(
      "first@example.com,second@example.com",
      CALLER,
    );

    expect(answer.error?.code).toBe(ExceptionCode.BadDataException);
    expect(answer.error?.message).toBe(
      PUBLIC_MESSAGE_ONE_EMAIL_ADDRESS_MESSAGE,
    );
    expect(userCreateUserOnSignup).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("an address written as a group is refused, and no account is created or emailed; one with an apostrophe signs up", async () => {
    for (const email of [
      "x:newcomer@example.com",
      "a:b:newcomer@example.com",
    ]) {
      const answer: Answer = await signUp(email, CALLER);

      expect([email, answer.error?.message]).toEqual([
        email,
        PUBLIC_MESSAGE_ONE_EMAIL_ADDRESS_MESSAGE,
      ]);
    }

    expect(userCreateUserOnSignup).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();

    expect((await signUp("o'brien@example.com", CALLER)).error).toBeNull();
    expect(userCreateUserOnSignup).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("while the counter cannot be reached, a new account is created and welcomed as it always was", async () => {
    isRedisConnected = false;

    expect((await signUp("new@example.com", CALLER)).error).toBeNull();
    expect(userCreateUserOnSignup).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});

describe.each([
  ["on the hosted service", true],
  ["self-hosted", false],
])(
  "POST /signup %s, when the account cannot be created",
  (_where: string, billingEnabled: boolean) => {
    beforeEach(() => {
      mockBillingEnabled = billingEnabled;
      userCreateUserOnSignup.mockRejectedValue(
        new BadDataException(
          "companyName length cannot be more than 100 characters",
        ),
      );
    });

    it("sends nothing, and the address keeps its five sign-up emails", async () => {
      for (let index: number = 0; index < 20; index++) {
        const answer: Answer = await signUp(
          "newcomer@example.com",
          `192.0.2.${index + 1}`,
        );

        expect(answer.error?.message).toBe(
          "companyName length cannot be more than 100 characters",
        );
      }

      expect(sendMail).not.toHaveBeenCalled();

      userCreateUserOnSignup.mockImplementation(
        async (data: Record<string, any>): Promise<unknown> => {
          const user: Record<string, any> = data["user"] as Record<string, any>;
          user["_id"] = "53000000-0000-4000-8000-0000000000ee";
          return user;
        },
      );

      const { accepted, refusals } = await acceptedOf(6, (index: number) => {
        return signUp("newcomer@example.com", `198.51.100.${index + 1}`);
      });

      expect(accepted).toBe(5);
      expect(sendMail).toHaveBeenCalledTimes(5);
      expectRefused(refusals[0], SIGN_UP_FOR_ADDRESS);
    });

    it("the caller's own count is spent all the same", async () => {
      await acceptedOf(60, (index: number) => {
        return signUp(`failing${index}@example.com`, CALLER);
      });

      expectRefused(
        await signUp("one-more@example.com", CALLER),
        SIGN_UP_FROM_NETWORK,
      );
    });
  },
);

describe("POST /login to an address not verified yet", () => {
  async function signIn(
    email: string,
    from: string,
    password: string = ACCOUNT_PASSWORD,
  ): Promise<Answer> {
    return await post(
      "/login",
      { data: { email: email, password: password } },
      from,
    );
  }

  beforeEach(() => {
    // Signed up on the hosted service, its welcome link not followed yet.
    register("unverified@example.com", "$scrypt$stored-hash");
  });

  it("mails a fresh link on each sign-in: five in the hour, from caller after caller, then refused with when to come back", async () => {
    const { accepted, refusals } = await acceptedOf(20, (index: number) => {
      return signIn("unverified@example.com", `192.0.2.${index + 1}`);
    });

    // Every sign-in is refused - the address is not verified - but only five mailed it.
    expect(accepted).toBe(0);
    expect(sendVerificationEmail).toHaveBeenCalledTimes(5);
    expect(refusals.slice(0, 5)).toEqual(
      Array(5).fill({
        error: expect.objectContaining({
          message: expect.stringContaining("Email is not verified."),
        }),
        retryAfter: undefined,
      }),
    );
    expectRefused(refusals[5], SIGN_UP_FOR_ADDRESS);
    expectRefused(refusals[19], SIGN_UP_FOR_ADDRESS);
  });

  it("shares the address's five with the email its sign-up sent", async () => {
    users.delete("unverified@example.com");

    expect((await signUp("unverified@example.com", CALLER)).error).toBeNull();
    expect(sendMail).toHaveBeenCalledTimes(1);

    register("unverified@example.com", "$scrypt$stored-hash");

    await acceptedOf(10, (index: number) => {
      return signIn("unverified@example.com", `198.51.100.${index + 1}`);
    });

    expect(sendVerificationEmail).toHaveBeenCalledTimes(4);
  });

  it("a wrong password mails nothing and counts nothing", async () => {
    for (let index: number = 0; index < 20; index++) {
      const answer: Answer = await signIn(
        "unverified@example.com",
        `192.0.2.${index + 1}`,
        "a wrong guess",
      );

      expect(answer.error?.message).toBe(
        "Invalid login: Email or password does not match.",
      );
    }

    expect(sendVerificationEmail).not.toHaveBeenCalled();
    expect(redisClient.keys()).toEqual([]);
  });

  it("while the counter cannot be reached, the link goes out as it always did", async () => {
    isRedisConnected = false;

    for (let index: number = 0; index < 8; index++) {
      await signIn("unverified@example.com", CALLER);
    }

    expect(sendVerificationEmail).toHaveBeenCalledTimes(8);
  });
});

describe("the limits these routes are held to", () => {
  it("are PublicMessageRateLimit's for password resets and sign-up emails", () => {
    expect(
      PublicMessageRateLimit.getConfig().kinds[PublicMessageKind.PasswordReset],
    ).toEqual({ perClientLimit: 30, perContactLimit: 5 });
    expect(
      PublicMessageRateLimit.getConfig().kinds[PublicMessageKind.SignUpEmail],
    ).toEqual({ perClientLimit: 60, perContactLimit: 5 });
  });
});
