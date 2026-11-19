import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
  withSecretColumns,
} from "./IdentityRouterTestUtil";
import { IdentityRateLimitBucket } from "Common/Server/Middleware/IdentityRateLimit";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import User from "Common/Models/DatabaseModels/User";
import { SIGN_UP_TURNED_OFF_MESSAGE } from "Common/Types/Accounts/SignInMessages";
import Email from "Common/Types/Email";
import BadDataException from "Common/Types/Exception/BadDataException";
import Exception from "Common/Types/Exception/Exception";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * SIGNING UP SAYS NOTHING ABOUT WHICH ADDRESSES HAVE AN ACCOUNT (#9816).
 *
 * POST /signup told anyone, with no account and only a captcha in the way:
 *
 *   - an address that had signed up: 400 "An account with ... already
 *     exists", before any limit was counted;
 *   - an invitation nobody had claimed: 200 `registrationEmailSent`, a
 *     "check your email" of its own;
 *   - a new address: 200 `emailVerificationRequired` on Cloud - after a
 *     password hash and two writes the others never did;
 *   - while sign-up was turned off: a refusal for everyone but an address
 *     with an invitation waiting, which went on.
 *
 * Wherever the server can prove an address by email - OneUptime Cloud, and
 * a self-hosted server that can send email, after its first account - every
 * address now gets one answer, sent before anything that depends on the
 * address is done, and what happened is said only in an email to the
 * address (Identity/Utils/EmailProvedSignUp). This suite drives the real
 * handler and holds:
 *
 *   - the status, the body and the headers of the answer are the same for a
 *     new address, an account that has signed up (verified or not) and an
 *     invitation nobody has claimed;
 *   - the answer is sent before the address is acted on, and so takes as
 *     long whatever the address: timed, with acting on the address made
 *     slow and different for each;
 *   - what each address is sent, after the answer;
 *   - sign-up turned off: one refusal for every address, timed alike, and
 *     an invitation's link emailed after it;
 *   - what is refused before the answer is refused alike: a value too long,
 *     a server with no seat left;
 *   - a self-hosted server that cannot email the address, and its first
 *     account: signed in at once, a taken address refused as taken - the
 *     documented exception;
 *   - the sign-up limiter is the route's first handler.
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

let mockBillingEnabled: boolean = true;
let mockSignUpTurnedOff: boolean = false;
let mockCanSendEmail: boolean = true;
let mockAwaitingFirstAccount: boolean = false;

type TaggedLimiter = RouteHandler & { bucket?: string };

jest.mock("Common/Server/Middleware/IdentityRateLimit", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Middleware/IdentityRateLimit",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      getMiddleware: (bucket: string): unknown => {
        const limiter: (
          req: unknown,
          res: unknown,
          next: () => void,
        ) => Promise<void> = (
          _req: unknown,
          _res: unknown,
          next: () => void,
        ): Promise<void> => {
          next();
          return Promise.resolve();
        };

        (limiter as unknown as { bucket: string }).bucket = bucket;

        return limiter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/SsoRequiredSignIn", () => {
  return (
    jest.requireActual(
      "./SsoNotRequiredStandIn",
    ) as typeof import("./SsoNotRequiredStandIn")
  ).ssoNotRequired();
});

jest.mock("Common/Server/Utils/SsoManagedSignIn", () => {
  return (
    jest.requireActual(
      "./SsoManagedSignInStandIn",
    ) as typeof import("./SsoManagedSignInStandIn")
  ).ssoManagesNobody();
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

  Object.defineProperty(mocked, "DisableInstanceCheckIn", {
    get: (): boolean => {
      return true;
    },
  });

  return mocked;
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
      return {};
    },
    headerValueToString: (): string => {
      return "";
    },
  };
});

const userFindOneBy: jest.Mock = jest.fn();
const userCreateUserOnSignup: jest.Mock = jest.fn();
const userUpdateOneByIdAndFetch: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return userFindOneBy(...args);
      },
      createUserOnSignup: (...args: Array<unknown>): unknown => {
        return userCreateUserOnSignup(...args);
      },
      updateOneByIdAndFetch: (...args: Array<unknown>): unknown => {
        return userUpdateOneByIdAndFetch(...args);
      },
      updateOneBy: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

const createEmailVerificationToken: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/EmailVerificationTokenService", () => {
  return {
    __esModule: true,
    default: {
      create: (...args: Array<unknown>): unknown => {
        return createEmailVerificationToken(...args);
      },
      findOneBy: jest.fn(),
      findBy: jest.fn(),
    },
  };
});

const teamMemberFindOneBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return teamMemberFindOneBy(...args);
      },
    },
  };
});

jest.mock("Common/Server/Services/AccessTokenService", () => {
  return {
    __esModule: true,
    default: { refreshUserAllPermissions: jest.fn() },
  };
});

const createSession: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: {
      createSession: (...args: Array<unknown>): unknown => {
        return createSession(...args);
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
        return Promise.resolve(mockSignUpTurnedOff);
      },
      getHost: (): Promise<unknown> => {
        const hostname: typeof import("Common/Types/API/Hostname") =
          jest.requireActual("Common/Types/API/Hostname");

        return Promise.resolve(new hostname.default("oneuptime.test"));
      },
      getHttpProtocol: (): Promise<unknown> => {
        const protocol: typeof import("Common/Types/API/Protocol") =
          jest.requireActual("Common/Types/API/Protocol");

        return Promise.resolve(protocol.default.HTTPS);
      },
    },
  };
});

jest.mock("Common/Server/Utils/ServerSending/ServerSendingStatus", () => {
  return {
    __esModule: true,
    default: {
      canSendEmailPublicly: (): Promise<boolean> => {
        return Promise.resolve(mockCanSendEmail);
      },
      isEmailKnownNotSetUp: (): Promise<boolean> => {
        return Promise.resolve(!mockCanSendEmail);
      },
    },
  };
});

jest.mock("../../../FeatureSet/Identity/Utils/FirstAccount", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../FeatureSet/Identity/Utils/FirstAccount",
  ) as Record<string, unknown>;

  return {
    ...actual,
    isWaitingForFirstAccount: (): Promise<boolean> => {
      return Promise.resolve(mockAwaitingFirstAccount);
    },
  };
});

const assertSeatAvailableForNewUser: jest.Mock = jest.fn();

jest.mock("Common/Server/Enterprise/EnterpriseEdition", () => {
  const actual: { default: Record<string, unknown> } = jest.requireActual(
    "Common/Server/Enterprise/EnterpriseEdition",
  ) as { default: Record<string, unknown> };

  /*
   * The real class, with only the seat check stood in: the rest - the
   * product's name in an email, above all - is read as it always is.
   */
  const standIn: Record<string, unknown> = Object.create(actual.default);

  standIn["assertSeatAvailableForNewUser"] = (
    ...args: Array<unknown>
  ): unknown => {
    return assertSeatAvailableForNewUser(...args);
  };

  return { ...actual, __esModule: true, default: standIn };
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

const verifyCaptcha: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Captcha", () => {
  return {
    __esModule: true,
    default: {
      verifyCaptcha: (...args: Array<unknown>): Promise<void> => {
        verifyCaptcha(...args);
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

const sendAccountAlreadyExistsEmail: jest.Mock = jest.fn();
const sendCompleteRegistrationEmail: jest.Mock = jest.fn();

jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: {
      sendAccountAlreadyExistsEmail: (...args: Array<unknown>): unknown => {
        return sendAccountAlreadyExistsEmail(...args);
      },
      sendCompleteRegistrationEmail: (...args: Array<unknown>): unknown => {
        return sendCompleteRegistrationEmail(...args);
      },
      sendVerificationEmail: jest.fn(),
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
    },
  };
});

const assertMaySend: jest.Mock = jest.fn();
const giveBack: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/RateLimit/PublicMessageRateLimit", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/RateLimit/PublicMessageRateLimit",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      assertMaySend: (...args: Array<unknown>): unknown => {
        return assertMaySend(...args);
      },
      forEmail: (email: unknown): unknown => {
        return { email: String(email) };
      },
      setRetryAfterFor: jest.fn(),
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

/*
 * When each answer went out, measured from the start of its request: what
 * a caller timing the route sees. Not when the handler finished, which
 * includes what it did with the address after answering.
 */
let requestStartedAt: number = 0;
let answeredAfterMs: number | null = null;

const markAnswered: () => void = (): void => {
  if (answeredAfterMs === null) {
    answeredAfterMs = performance.now() - requestStartedAt;
  }
};

const sendErrorResponse: jest.Mock = jest.fn();
const sendEntityResponse: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: (...args: Array<unknown>): unknown => {
        markAnswered();
        return sendErrorResponse(...args);
      },
      sendEntityResponse: (...args: Array<unknown>): unknown => {
        markAnswered();
        return sendEntityResponse(...args);
      },
      sendJsonObjectResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/Authentication";

const ADDRESS: string = "someone@example.com";
const MEMBER_ID: string = "11111111-1111-4111-8111-111111111111";
const INVITED_ID: string = "22222222-2222-4222-8222-222222222222";
const NEW_ID: string = "33333333-3333-4333-8333-333333333333";

const ATTEMPT_NAMESPACE: string = "identity-sign-up-attempt";

let attempts: Map<string, string>;

type Answer = {
  nextError: Exception | null;
  // How long until the answer went out, in milliseconds.
  answeredAfterMs: number | null;
  // How long until the handler had finished with the address too.
  finishedAfterMs: number;
  headers: Record<string, unknown>;
};

async function signUp(
  options: {
    address?: string;
    miscDataProps?: JSONObject;
    name?: string;
  } = {},
): Promise<Answer> {
  const handler: RouteHandler = mockRouter.match("post", "/signup");
  const req: ExpressRequest = buildRequest({
    data: {
      email: { _type: "Email", value: options.address || ADDRESS },
      password: { _type: "HashedString", value: "violet river lantern" },
      name: { _type: "Name", value: options.name || "Some One" },
    },
    ...(options.miscDataProps ? { miscDataProps: options.miscDataProps } : {}),
  });
  const res: ExpressResponse = buildResponse();
  const headers: Record<string, unknown> = {};

  (res as unknown as { setHeader: jest.Mock }).setHeader = jest.fn(
    (name: string, value: unknown): void => {
      headers[name.toLowerCase()] = value;
    },
  );

  let nextError: Exception | null = null;

  answeredAfterMs = null;
  requestStartedAt = performance.now();

  await handler(req, res, ((err?: Exception): void => {
    if (err) {
      nextError = err;
      markAnswered();
    }
  }) as unknown as NextFunction);

  return {
    nextError,
    answeredAfterMs: answeredAfterMs,
    finishedAfterMs: performance.now() - requestStartedAt,
    headers: headers,
  };
}

// The account at the address, as the sign-up's read hands it back.
function member(options: { isEmailVerified?: boolean } = {}): User {
  const user: User = new User();
  user._id = MEMBER_ID;
  user.email = new Email(ADDRESS);
  user.name = new Name("A Member");
  user.isEmailVerified = options.isEmailVerified !== false;
  return withSecretColumns(user);
}

function invited(): User {
  const user: User = new User();
  user._id = INVITED_ID;
  user.email = new Email(ADDRESS);
  return user;
}

type AddressKind = "new" | "member" | "unverified member" | "invitation";

const ADDRESS_KINDS: Array<AddressKind> = [
  "new",
  "member",
  "unverified member",
  "invitation",
];

function addressIs(kind: AddressKind): void {
  if (kind === "new") {
    userFindOneBy.mockResolvedValue(null);
  } else if (kind === "member") {
    userFindOneBy.mockResolvedValue(member());
  } else if (kind === "unverified member") {
    userFindOneBy.mockResolvedValue(member({ isEmailVerified: false }));
  } else {
    userFindOneBy.mockResolvedValue(invited());
  }
}

interface Seen {
  status: string;
  name: string;
  message: string | null;
  bodyEntity: unknown;
  miscDataKeys: Array<string>;
  emailVerificationRequired: unknown;
  resendAvailableInSeconds: unknown;
  tokenVersion: string | null;
  headers: Record<string, unknown>;
}

// What a caller can see of an answer, the token's own bytes aside.
function seen(answer: Answer): Seen {
  if (sendErrorResponse.mock.calls.length > 0 || answer.nextError) {
    const error: Exception = (sendErrorResponse.mock.calls[0]?.[2] ||
      answer.nextError) as Exception;

    return {
      status: "refused",
      name: error.constructor.name,
      message: error.message,
      bodyEntity: null,
      miscDataKeys: [],
      emailVerificationRequired: undefined,
      resendAvailableInSeconds: undefined,
      tokenVersion: null,
      headers: answer.headers,
    };
  }

  const call: Array<unknown> = sendEntityResponse.mock
    .calls[0] as Array<unknown>;
  const miscData: JSONObject = ((call[4] as JSONObject | undefined)?.[
    "miscData"
  ] || {}) as JSONObject;

  return {
    status: "answered",
    name: "",
    message: null,
    bodyEntity: call[2],
    miscDataKeys: Object.keys(miscData).sort(),
    emailVerificationRequired: miscData["emailVerificationRequired"],
    resendAvailableInSeconds:
      miscData["verificationEmailResendAvailableInSeconds"],
    tokenVersion:
      typeof miscData["verificationEmailResendToken"] === "string"
        ? (miscData["verificationEmailResendToken"] as string).split(".")[0]!
        : null,
    headers: answer.headers,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
}

beforeEach(() => {
  jest.clearAllMocks();

  mockBillingEnabled = true;
  mockSignUpTurnedOff = false;
  mockCanSendEmail = true;
  mockAwaitingFirstAccount = false;

  attempts = new Map<string, string>();

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(
      async (namespace: string, key: string): Promise<string | null> => {
        return namespace === ATTEMPT_NAMESPACE
          ? attempts.get(key) || null
          : null;
      },
    );
  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        if (namespace === ATTEMPT_NAMESPACE) {
          attempts.set(key, value);
        }
      },
    );

  userFindOneBy.mockResolvedValue(null);
  userCreateUserOnSignup.mockImplementation(
    async (data: Record<string, any>): Promise<unknown> => {
      const user: User = data["user"] as User;
      user._id = NEW_ID;
      return withSecretColumns(user);
    },
  );
  userUpdateOneByIdAndFetch.mockImplementation(async (): Promise<unknown> => {
    const user: User = invited();
    user.isMasterAdmin = false;
    return user;
  });
  createEmailVerificationToken.mockResolvedValue(null);
  teamMemberFindOneBy.mockResolvedValue(null);
  consumeRegistrationToken.mockResolvedValue(false);
  assertMaySend.mockResolvedValue({ giveBack: giveBack });
  giveBack.mockResolvedValue(undefined);
  assertSeatAvailableForNewUser.mockResolvedValue(undefined);
  sendAccountAlreadyExistsEmail.mockResolvedValue(undefined);
  sendCompleteRegistrationEmail.mockResolvedValue(undefined);
  createSession.mockResolvedValue({
    session: { id: new ObjectID("44444444-4444-4444-8444-444444444444") },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env["EXPOSE_VERIFICATION_CODE_IN_API_RESPONSE_FOR_E2E"];
});

describe("POST /signup - the route", () => {
  it("counts every request on the sign-up limiter, its first handler, before anything else", () => {
    const handlers: Array<TaggedLimiter> = mockRouter.matchAll(
      "post",
      "/signup",
    ) as Array<TaggedLimiter>;

    expect(handlers).toHaveLength(2);
    expect(handlers[0]!.bucket).toBe(IdentityRateLimitBucket.SignUp);
  });
});

describe.each([
  ["OneUptime Cloud", true],
  ["a self-hosted server that can send email", false],
])(
  "POST /signup on %s - one answer for every address",
  (_where: string, billingEnabled: boolean) => {
    beforeEach(() => {
      mockBillingEnabled = billingEnabled;
      mockCanSendEmail = true;
    });

    it("answers a new address, a member's (verified or not) and an invitation's alike: status, body and headers (the regression)", async () => {
      const answers: Array<Seen> = [];

      for (const kind of ADDRESS_KINDS) {
        jest.clearAllMocks();
        assertMaySend.mockResolvedValue({ giveBack: giveBack });
        addressIs(kind);

        answers.push(seen(await signUp()));
      }

      expect(answers[0]).toEqual({
        status: "answered",
        name: "",
        message: null,
        bodyEntity: null,
        miscDataKeys: [
          "emailVerificationRequired",
          "verificationEmailResendAvailableInSeconds",
          "verificationEmailResendToken",
        ],
        emailVerificationRequired: true,
        resendAvailableInSeconds: 60,
        tokenVersion: "v2",
        headers: {},
      });

      for (const each of answers) {
        expect(each).toEqual(answers[0]);
      }
    });

    it("signs nobody in, whatever the address", async () => {
      for (const kind of ADDRESS_KINDS) {
        addressIs(kind);
        await signUp();
      }

      expect(createSession).not.toHaveBeenCalled();
    });

    it("counts every address's sign-up email before the address is read", async () => {
      for (const kind of ADDRESS_KINDS) {
        jest.clearAllMocks();
        assertMaySend.mockResolvedValue({ giveBack: giveBack });
        addressIs(kind);

        await signUp();

        expect(assertMaySend).toHaveBeenCalledTimes(1);
        expect(firstArgs(assertMaySend)["contacts"]).toEqual([
          { email: ADDRESS },
        ]);
      }
    });

    it("refuses a caller over the address's count alike, whoever has the address", async () => {
      const refusals: Array<Seen> = [];

      for (const kind of ADDRESS_KINDS) {
        jest.clearAllMocks();
        addressIs(kind);
        assertMaySend.mockRejectedValue(
          new BadDataException("Too many sign-up emails."),
        );

        refusals.push(seen(await signUp()));
      }

      for (const each of refusals) {
        expect(each).toEqual(refusals[0]);
      }

      expect(userCreateUserOnSignup).not.toHaveBeenCalled();
      expect(sendAccountAlreadyExistsEmail).not.toHaveBeenCalled();
    });
  },
);

function firstArgs(mock: jest.Mock): Record<string, any> {
  expect(mock).toHaveBeenCalled();
  return mock.mock.calls[0]![0] as Record<string, any>;
}

describe("POST /signup - what each address is sent, after the answer", () => {
  it("a new address: an unverified account, its welcome, and nothing for anyone else", async () => {
    await signUp();

    expect(userCreateUserOnSignup).toHaveBeenCalledTimes(1);
    expect(
      (firstArgs(userCreateUserOnSignup)["user"] as User).isEmailVerified,
    ).toBe(false);
    expect(createEmailVerificationToken).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]![0]).toMatchObject({
      toEmail: new Email(ADDRESS),
    });
    expect(sendAccountAlreadyExistsEmail).not.toHaveBeenCalled();
    expect(sendCompleteRegistrationEmail).not.toHaveBeenCalled();
  });

  it("a member's address: nothing created or changed; the member is told, with where the sign-up came from", async () => {
    addressIs("member");

    await signUp();

    expect(userCreateUserOnSignup).not.toHaveBeenCalled();
    expect(userUpdateOneByIdAndFetch).not.toHaveBeenCalled();
    expect(createEmailVerificationToken).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
    expect(sendAccountAlreadyExistsEmail).toHaveBeenCalledTimes(1);
    expect(
      (firstArgs(sendAccountAlreadyExistsEmail)["user"] as User).id!.toString(),
    ).toBe(MEMBER_ID);
    expect(firstArgs(sendAccountAlreadyExistsEmail)["origin"]).toBeDefined();
  });

  it("an unverified member's address: told the same, never sent a link to verify an account it did not just make", async () => {
    addressIs("unverified member");

    await signUp();

    expect(sendAccountAlreadyExistsEmail).toHaveBeenCalledTimes(1);
    expect(createEmailVerificationToken).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("an invitation's address without its token: its link, and nothing claimed", async () => {
    addressIs("invitation");

    await signUp();

    expect(sendCompleteRegistrationEmail).toHaveBeenCalledTimes(1);
    expect(firstArgs(sendCompleteRegistrationEmail)["userId"].toString()).toBe(
      INVITED_ID,
    );
    expect(userUpdateOneByIdAndFetch).not.toHaveBeenCalled();
  });

  it("a new account that cannot be saved gives the address its count back, after the answer", async () => {
    userCreateUserOnSignup.mockRejectedValue(new Error("database is down"));

    const answer: Answer = await signUp();

    expect(answer.nextError).toBeNull();
    expect(giveBack).toHaveBeenCalledTimes(1);
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("POST /signup - timing: the answer does not wait on the address", () => {
  /*
   * Wall-clock. Acting on each address is made slow, and slow by a
   * different amount: making a new account 60 ms, telling a member 120 ms,
   * an invitation's link 180 ms - far more than anything the answer itself
   * costs here. Answered alike in time means answered before any of it.
   */
  const ROUNDS: number = 5;

  beforeEach(() => {
    userCreateUserOnSignup.mockImplementation(
      async (data: Record<string, any>): Promise<unknown> => {
        await sleep(60);
        const user: User = data["user"] as User;
        user._id = NEW_ID;
        return withSecretColumns(user);
      },
    );
    sendAccountAlreadyExistsEmail.mockImplementation(async () => {
      await sleep(120);
    });
    sendCompleteRegistrationEmail.mockImplementation(async () => {
      await sleep(180);
    });
  });

  it("a new address, a member's and an invitation's are answered in the same time", async () => {
    const answered: Record<string, Array<number>> = {};
    const finished: Record<string, Array<number>> = {};

    for (let round: number = 0; round < ROUNDS; round++) {
      for (const kind of ADDRESS_KINDS) {
        jest.clearAllMocks();
        assertMaySend.mockResolvedValue({ giveBack: giveBack });
        addressIs(kind);

        const answer: Answer = await signUp();

        (answered[kind] = answered[kind] || []).push(answer.answeredAfterMs!);
        (finished[kind] = finished[kind] || []).push(answer.finishedAfterMs);
      }
    }

    const median: (times: Array<number>) => number = (
      times: Array<number>,
    ): number => {
      const sorted: Array<number> = [...times].sort(
        (a: number, b: number): number => {
          return a - b;
        },
      );
      return sorted[Math.floor(sorted.length / 2)]!;
    };

    // The work on each address did happen, and took as long as it was made to...
    expect(median(finished["new"]!)).toBeGreaterThanOrEqual(55);
    expect(median(finished["member"]!)).toBeGreaterThanOrEqual(115);
    expect(median(finished["invitation"]!)).toBeGreaterThanOrEqual(175);

    // ...after the answer, which took the same time for every address.
    const answerTimes: Array<number> = ADDRESS_KINDS.map(
      (kind: AddressKind): number => {
        return median(answered[kind]!);
      },
    );
    const fastest: number = Math.min(...answerTimes);
    const slowest: number = Math.max(...answerTimes);

    expect(slowest).toBeLessThan(50);
    expect(slowest - fastest).toBeLessThan(25);
  }, 60000);
});

describe("POST /signup - what is refused before the answer is refused alike", () => {
  it("a name longer than an account holds, whoever has the address", async () => {
    const refusals: Array<Seen> = [];

    for (const kind of ADDRESS_KINDS) {
      jest.clearAllMocks();
      addressIs(kind);

      refusals.push(seen(await signUp({ name: "n".repeat(500) })));
    }

    expect(refusals[0]!.status).toBe("refused");
    expect(refusals[0]!.message).toMatch(
      /can be at most \d+ characters long\. Shorten it and try again\.$/,
    );

    for (const each of refusals) {
      expect(each).toEqual(refusals[0]);
    }

    expect(userCreateUserOnSignup).not.toHaveBeenCalled();
    expect(sendAccountAlreadyExistsEmail).not.toHaveBeenCalled();
  });

  it("a server with no seat left, whoever has the address", async () => {
    assertSeatAvailableForNewUser.mockRejectedValue(
      new BadDataException("This server has no seats left."),
    );

    const refusals: Array<Seen> = [];

    for (const kind of ADDRESS_KINDS) {
      jest.clearAllMocks();
      addressIs(kind);
      assertSeatAvailableForNewUser.mockRejectedValue(
        new BadDataException("This server has no seats left."),
      );

      refusals.push(seen(await signUp()));
    }

    for (const each of refusals) {
      expect(each).toEqual(refusals[0]);
    }

    expect(refusals[0]!.message).toBe("This server has no seats left.");
  });
});

describe("POST /signup - an invitation's link still signs its person in", () => {
  it("a valid registration token claims the invitation, with a session", async () => {
    addressIs("invitation");
    consumeRegistrationToken.mockResolvedValue(true);

    await signUp({
      miscDataProps: {
        registrationToken: "55555555-5555-4555-8555-555555555555",
      },
    });

    expect(userUpdateOneByIdAndFetch).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("a token that claims nothing is answered as every address is", async () => {
    const answers: Array<Seen> = [];

    for (const kind of ADDRESS_KINDS) {
      jest.clearAllMocks();
      assertMaySend.mockResolvedValue({ giveBack: giveBack });
      consumeRegistrationToken.mockResolvedValue(false);
      addressIs(kind);

      answers.push(
        seen(
          await signUp({
            miscDataProps: {
              registrationToken: "55555555-5555-4555-8555-555555555555",
            },
          }),
        ),
      );
    }

    for (const each of answers) {
      expect(each).toEqual(answers[0]);
    }

    expect(answers[0]!.emailVerificationRequired).toBe(true);
  });
});

describe("POST /signup - sign-up turned off", () => {
  beforeEach(() => {
    mockSignUpTurnedOff = true;
  });

  it("refuses every address alike, an invitation's included (the regression)", async () => {
    const refusals: Array<Seen> = [];

    for (const kind of ADDRESS_KINDS) {
      jest.clearAllMocks();
      addressIs(kind);
      teamMemberFindOneBy.mockResolvedValue(
        kind === "invitation" ? { _id: "a-pending-invitation" } : null,
      );

      refusals.push(seen(await signUp()));
    }

    expect(refusals[0]).toMatchObject({
      status: "refused",
      message: SIGN_UP_TURNED_OFF_MESSAGE,
    });

    for (const each of refusals) {
      expect(each).toEqual(refusals[0]);
    }

    expect(userCreateUserOnSignup).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("emails an invitation waiting at the address its link, after the refusal", async () => {
    addressIs("invitation");
    teamMemberFindOneBy.mockResolvedValue({ _id: "a-pending-invitation" });

    await signUp();

    expect(sendCompleteRegistrationEmail).toHaveBeenCalledTimes(1);
    expect(sendErrorResponse.mock.invocationCallOrder[0]!).toBeLessThan(
      sendCompleteRegistrationEmail.mock.invocationCallOrder[0]!,
    );
  });

  it("emails nobody else: a new address, a member, an account with no invitation waiting", async () => {
    for (const kind of ["new", "member"] as Array<AddressKind>) {
      addressIs(kind);
      await signUp();
    }

    addressIs("invitation");
    teamMemberFindOneBy.mockResolvedValue(null);
    await signUp();

    expect(sendCompleteRegistrationEmail).not.toHaveBeenCalled();
    expect(sendAccountAlreadyExistsEmail).not.toHaveBeenCalled();
  });

  it("refuses in the same time, an invitation's link or not", async () => {
    sendCompleteRegistrationEmail.mockImplementation(async () => {
      await sleep(150);
    });

    const times: Record<string, Array<number>> = { invited: [], other: [] };

    for (let round: number = 0; round < 3; round++) {
      addressIs("invitation");
      teamMemberFindOneBy.mockResolvedValue({ _id: "a-pending-invitation" });
      times["invited"]!.push((await signUp()).answeredAfterMs!);

      addressIs("new");
      teamMemberFindOneBy.mockResolvedValue(null);
      times["other"]!.push((await signUp()).answeredAfterMs!);
    }

    const slowest: number = Math.max(...times["invited"]!, ...times["other"]!);

    expect(slowest).toBeLessThan(50);
  }, 30000);

  it("asks nothing of the password before refusing", async () => {
    const handler: RouteHandler = mockRouter.match("post", "/signup");

    await handler(
      buildRequest({ data: { email: { _type: "Email", value: ADDRESS } } }),
      buildResponse(),
      jest.fn() as unknown as NextFunction,
    );

    expect((sendErrorResponse.mock.calls[0]![2] as Exception).message).toBe(
      SIGN_UP_TURNED_OFF_MESSAGE,
    );
  });

  it("still lets an invited person claim their account with their link's token", async () => {
    addressIs("invitation");
    consumeRegistrationToken.mockResolvedValue(true);

    await signUp({
      miscDataProps: {
        registrationToken: "55555555-5555-4555-8555-555555555555",
      },
    });

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(sendErrorResponse).not.toHaveBeenCalled();
  });
});

describe("POST /signup where the address cannot be proved by email (self-hosted)", () => {
  /*
   * The documented exception: a self-hosted server with no email that works
   * signs a new account in at once, so a taken address can only be refused
   * as taken. Pinned, so changing it is a decision rather than an accident.
   */
  beforeEach(() => {
    mockBillingEnabled = false;
    mockCanSendEmail = false;
  });

  it("signs a new account straight in, verified, as before", async () => {
    await signUp();

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(
      (firstArgs(userCreateUserOnSignup)["user"] as User).isEmailVerified,
    ).toBe(true);
  });

  it("refuses a member's address as taken: there is no email to say it in", async () => {
    addressIs("member");

    const refusal: Seen = seen(await signUp());

    expect(refusal.message).toBe(
      `An account with ${ADDRESS} already exists. Sign in instead, or reset your password if you have forgotten it.`,
    );
    expect(sendAccountAlreadyExistsEmail).not.toHaveBeenCalled();
  });

  it("the first account of a server that can send email still signs straight in", async () => {
    mockCanSendEmail = true;
    mockAwaitingFirstAccount = true;

    await signUp();

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(
      (firstArgs(userCreateUserOnSignup)["user"] as User).isEmailVerified,
    ).toBe(true);
  });

  it("a server whose sending status cannot be read signs in as before", async () => {
    mockCanSendEmail = true;

    const ServerSendingStatus: {
      default: { canSendEmailPublicly: () => Promise<boolean> };
    } = jest.requireMock(
      "Common/Server/Utils/ServerSending/ServerSendingStatus",
    );
    jest
      .spyOn(ServerSendingStatus.default, "canSendEmailPublicly")
      .mockRejectedValue(new Error("database is down"));

    await signUp();

    expect(createSession).toHaveBeenCalledTimes(1);
  });
});

describe("POST /signup - the test-only seam", () => {
  it("with it on, acts on the address before answering, and hands a new address its welcome token", async () => {
    process.env["EXPOSE_VERIFICATION_CODE_IN_API_RESPONSE_FOR_E2E"] = "true";

    await signUp();

    const welcome: string = (
      createEmailVerificationToken.mock.calls[0]![0] as Record<string, any>
    )["data"]["token"].toString();
    const miscData: JSONObject = (
      sendEntityResponse.mock.calls[0]![4] as JSONObject
    )["miscData"] as JSONObject;

    expect(miscData["emailVerificationToken"]).toBe(welcome);
    expect(
      createEmailVerificationToken.mock.invocationCallOrder[0]!,
    ).toBeLessThan(sendEntityResponse.mock.invocationCallOrder[0]!);
  });

  it("is off unless switched on", async () => {
    await signUp();

    const miscData: JSONObject = (
      sendEntityResponse.mock.calls[0]![4] as JSONObject
    )["miscData"] as JSONObject;

    expect(miscData).not.toHaveProperty("emailVerificationToken");
  });
});

describe("the sign-up source says nothing more", () => {
  const source: string = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "FeatureSet",
      "Identity",
      "API",
      "Authentication.ts",
    ),
    "utf8",
  );

  it("answers a taken address as taken only where the address cannot be proved by email", () => {
    expect(source.split("getAccountAlreadyExistsMessage(").length - 1).toBe(1);
    expect(source).toContain("signUpWithoutProvingTheAddress");
  });

  it("no longer goes on for an address with a pending invitation while sign-up is turned off", () => {
    expect(source).not.toContain("hasInvitation = true");
  });
});
