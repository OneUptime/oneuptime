import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import UserService from "Common/Server/Services/UserService";
import { IdentityRateLimitBucket } from "Common/Server/Middleware/IdentityRateLimit";
import PasswordHash from "Common/Server/Utils/PasswordHash";
import User from "Common/Models/DatabaseModels/User";
import { SECURITY_KEY_SIGN_IN_OPTIONS_ROUTE } from "Common/Types/Accounts/SecurityKeySignIn";
import { SignInFailureReason } from "Common/Types/AuditLog/AuditLogSignInFailure";
import Email from "Common/Types/Email";
import BadDataException from "Common/Types/Exception/BadDataException";
import Exception from "Common/Types/Exception/Exception";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import HashedString from "Common/Types/HashedString";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SSO_REQUIRED_SIGN_IN_MESSAGE } from "Common/Types/SSO/SignInMethods";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A SECURITY KEY'S SIGN-IN OPTIONS SAY NOTHING ABOUT AN ADDRESS (#9822).
 *
 * The options for a security key's prompt came from an anonymous route that
 * took an email address alone (POST /api/user-webauthn/
 * generate-authentication-options):
 *
 *   - an address with no account, or an account with no key: 400 "No
 *     security key is available for this account.";
 *   - an account with a key: 200, its credential ids and transports, and a
 *     challenge written over the one its own sign-in was about to sign.
 *
 * They now come from the sign-in: POST /identity/security-key-sign-in-
 * options carries the email and password again (or the sign-in link's
 * token), as every second step does, and goes through login(). What this
 * suite holds, through the real handler with real password hashing:
 *
 *   - an address with no account, an account with no password yet, and an
 *     account with or without a key whose password is wrong all get one
 *     refusal: the same status, class and words, after the same work - one
 *     scrypt derivation, timed alike - and no options, no challenge;
 *   - the right password gets the options for that account alone, and signs
 *     nobody in; the account named is the one the password proved, never
 *     one the body names;
 *   - only the password holder is told the account has no key, or no second
 *     step at all;
 *   - a blocked account, an unverified address and a server that requires
 *     single sign-on are refused as /login refuses them, before any key is
 *     asked for;
 *   - a sign-in link stands in for the password and is not spent;
 *   - the route sits on the second step's limiter and asks no captcha.
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

// Each limiter the router builds, tagged with its bucket.
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

const assertNonSsoSignInAllowed: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/SsoRequiredSignIn", () => {
  return {
    __esModule: true,
    default: {
      isNonSsoSignInRefused: (): Promise<boolean> => {
        return Promise.resolve(false);
      },
      assertNonSsoSignInAllowed: (...args: Array<unknown>): unknown => {
        return assertNonSsoSignInAllowed(...args);
      },
      isSsoRequired: (): Promise<boolean> => {
        return Promise.resolve(false);
      },
      assertSignUpAllowed: (): Promise<void> => {
        return Promise.resolve();
      },
    },
  };
});

jest.mock("Common/Server/Utils/SsoManagedSignIn", () => {
  return {
    __esModule: true,
    default: {
      assertMayChangeLocalSignInFor: (): Promise<void> => {
        return Promise.resolve();
      },
      isManagedBySsoFor: (): Promise<boolean> => {
        return Promise.resolve(false);
      },
    },
  };
});

jest.mock("Common/Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: {
      getMagicLinkLoginTurnedOff: (): Promise<boolean> => {
        return Promise.resolve(false);
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
    default: { findOneBy: jest.fn(), create: jest.fn() },
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

jest.mock("Common/Server/Services/UserTotpAuthService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
      findOneBy: jest.fn(),
      deleteBy: jest.fn(),
      create: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

// The ceremony: the options, made for whichever account they are asked for.
const generateAuthenticationOptions: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserWebAuthnService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
      generateAuthenticationOptions: (...args: Array<unknown>): unknown => {
        return generateAuthenticationOptions(...args);
      },
      verifyAuthentication: jest.fn(),
      generateRegistrationOptions: jest.fn(),
      verifyRegistration: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/UserTwoFactorBackupCodeService", () => {
  return {
    __esModule: true,
    default: {
      countUnusedForUser: (): Promise<number> => {
        return Promise.resolve(0);
      },
      consumeCode: jest.fn(),
      generateForUserIfNone: jest.fn(),
    },
  };
});

const forgetWrongCodes: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/TwoFactorWrongCodes", () => {
  const standIn: Record<string, unknown> & {
    default: Record<string, unknown>;
  } = (
    jest.requireActual("./TwoFactorWrongCodesStandIn") as {
      letEveryCodeBeChecked: () => Record<string, unknown> & {
        default: Record<string, unknown>;
      };
    }
  ).letEveryCodeBeChecked();

  return {
    ...standIn,
    default: {
      ...standIn.default,
      forget: (...args: Array<unknown>): unknown => {
        return forgetWrongCodes(...args);
      },
    },
  };
});

const recordFailedSignIn: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/AuditLog/FailedSignInAuditLog", () => {
  return {
    __esModule: true,
    default: {
      record: (...args: Array<unknown>): unknown => {
        return recordFailedSignIn(...args);
      },
    },
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

jest.mock("Common/Server/Services/MailService", () => {
  return {
    __esModule: true,
    default: {
      sendMail: (): Promise<void> => {
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

const setUserCookie: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Cookie", () => {
  return {
    __esModule: true,
    default: {
      setUserCookie: (...args: Array<unknown>): unknown => {
        return setUserCookie(...args);
      },
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

const sendVerificationEmail: jest.Mock = jest.fn();

jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: {
      sendVerificationEmail: (...args: Array<unknown>): unknown => {
        return sendVerificationEmail(...args);
      },
    },
  };
});

jest.mock("Common/Server/Utils/RateLimit/PublicMessageRateLimit", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/RateLimit/PublicMessageRateLimit",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      assertMaySend: (): Promise<unknown> => {
        return Promise.resolve({ giveBack: jest.fn() });
      },
      forEmail: (): unknown => {
        return {};
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

const sendErrorResponse: jest.Mock = jest.fn();
const sendEntityResponse: jest.Mock = jest.fn();
const sendJsonObjectResponse: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: (...args: Array<unknown>): unknown => {
        return sendErrorResponse(...args);
      },
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: (...args: Array<unknown>): unknown => {
        return sendEntityResponse(...args);
      },
      sendJsonObjectResponse: (...args: Array<unknown>): unknown => {
        return sendJsonObjectResponse(...args);
      },
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/Authentication";

const PASSWORD: string = "correct horse battery staple";
const USER_EMAIL: string = "has.a.key@example.com";
const OTHER_USER_ID: string = "0ddba11c-0000-4000-8000-00000000cafe";
const LINK_TOKEN: string = "5ec0dd1c-1111-4111-8111-111111111111";

// What the browser's prompt is handed for an account with a key.
const AUTHENTICATION_OPTIONS: JSONObject = {
  challenge: "c2lnbi1pbi1jaGFsbGVuZ2U",
  rpId: "localhost",
  allowCredentials: [
    { id: "a2V5LWlk", type: "public-key", transports: ["usb"] },
  ],
  userVerification: "preferred",
};

const NO_KEY_REFUSAL: string =
  "No security key is available for this account. Choose another way to sign in.";

type Answer = { nextError: Exception | null };

async function askForOptions(data: JSONObject): Promise<Answer> {
  const handler: RouteHandler = mockRouter.match(
    "post",
    SECURITY_KEY_SIGN_IN_OPTIONS_ROUTE,
  );
  const req: ExpressRequest = buildRequest({ data: data });
  const res: ExpressResponse = buildResponse();

  let nextError: Exception | null = null;

  await handler(req, res, ((err?: Exception): void => {
    if (err) {
      nextError = err;
    }
  }) as unknown as NextFunction);

  return { nextError };
}

// The account at the address, as Postgres would hand it back; null for none.
let account: User | null = null;

async function storedUser(options?: {
  hasPassword?: boolean;
  enableTwoFactorAuth?: boolean;
  isEmailVerified?: boolean;
  isBlocked?: boolean;
}): Promise<User> {
  const salt: string = PasswordHash.generateSalt();

  const user: User = new User();
  user._id = ObjectID.generate().toString();
  user.email = new Email(USER_EMAIL);
  user.isEmailVerified = options?.isEmailVerified !== false;
  user.isBlocked = options?.isBlocked === true;
  user.isMasterAdmin = false;
  user.enableTwoFactorAuth = options?.enableTwoFactorAuth !== false;

  if (options?.hasPassword !== false) {
    user.passwordSalt = salt;
    user.password = new HashedString(
      await PasswordHash.hash({ plainValue: PASSWORD, salt: salt }),
      true,
    );
  }

  return user;
}

function withPassword(password: string = PASSWORD): JSONObject {
  return {
    email: USER_EMAIL,
    password: { _type: "HashedString", value: password },
  };
}

interface Refusal {
  status: number | undefined;
  name: string;
  message: string;
}

// The one refusal sent, as the browser reads it.
function refusal(answer: Answer): Refusal {
  const sent: Exception | undefined = (
    sendErrorResponse.mock.calls[0] as Array<unknown> | undefined
  )?.[2] as Exception | undefined;

  const error: Exception | null = sent || answer.nextError;

  if (!error) {
    throw new Error("Expected a refusal, and the options were answered");
  }

  return {
    status: (error as unknown as { code?: number }).code,
    name: error.constructor.name,
    message: error.message,
  };
}

function expectNoOptionsAndNobodySignedIn(): void {
  expect(generateAuthenticationOptions).not.toHaveBeenCalled();
  expect(sendJsonObjectResponse).not.toHaveBeenCalled();
  expect(createSession).not.toHaveBeenCalled();
  expect(setUserCookie).not.toHaveBeenCalled();
}

let spendVerificationTime: jest.SpiedFunction<
  typeof PasswordHash.spendVerificationTime
>;
let verifyHashedColumnValue: jest.SpiedFunction<
  typeof UserService.verifyHashedColumnValue
>;

beforeEach(async () => {
  jest.clearAllMocks();

  account = await storedUser();

  jest.spyOn(UserService, "findOneBy").mockImplementation(((data: {
    query: JSONObject;
  }) => {
    return Promise.resolve(
      account && String(data.query["email"]) === USER_EMAIL ? account : null,
    );
  }) as never);
  jest.spyOn(UserService, "updateOneById").mockResolvedValue(1 as never);

  // Real work, counted: a derivation spent in place of a check, or a check.
  spendVerificationTime = jest.spyOn(PasswordHash, "spendVerificationTime");
  verifyHashedColumnValue = jest.spyOn(UserService, "verifyHashedColumnValue");

  assertNonSsoSignInAllowed.mockResolvedValue(undefined as never);
  forgetWrongCodes.mockResolvedValue(undefined as never);

  generateAuthenticationOptions.mockResolvedValue({
    options: AUTHENTICATION_OPTIONS,
    challenge: AUTHENTICATION_OPTIONS["challenge"],
  } as never);

  createSession.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe(`POST ${SECURITY_KEY_SIGN_IN_OPTIONS_ROUTE} - the route`, () => {
  it("is the identity server's own, under the name the sign-in page posts to", () => {
    expect(SECURITY_KEY_SIGN_IN_OPTIONS_ROUTE).toBe(
      "/security-key-sign-in-options",
    );
  });

  it("sits behind the second step's limiter, first, as /verify-webauthn-auth does", () => {
    const handlers: Array<TaggedLimiter> = mockRouter.matchAll(
      "post",
      SECURITY_KEY_SIGN_IN_OPTIONS_ROUTE,
    ) as Array<TaggedLimiter>;

    expect(handlers).toHaveLength(2);
    expect(handlers[0]!.bucket).toBe(IdentityRateLimitBucket.TwoFactor);
    expect(handlers[0]!.bucket).toBe(
      (
        mockRouter.matchAll(
          "post",
          "/verify-webauthn-auth",
        ) as Array<TaggedLimiter>
      )[0]!.bucket,
    );
  });

  it("asks for no captcha: the password step already spent it", async () => {
    await askForOptions(withPassword());

    expect(verifyCaptcha).not.toHaveBeenCalled();
  });
});

describe("one refusal for every address, without the password (the regression)", () => {
  it("an address with no account: the wrong-password refusal, after a password check's worth of work", async () => {
    account = null;

    const answer: Answer = await askForOptions(withPassword());

    expect(refusal(answer)).toEqual({
      status: 400,
      name: BadDataException.name,
      message: "Email or password does not match.",
    });
    expect(spendVerificationTime).toHaveBeenCalledTimes(1);
    expect(verifyHashedColumnValue).not.toHaveBeenCalled();
    expectNoOptionsAndNobodySignedIn();
  });

  it("an account nobody has set a password on: the same refusal, after the same work", async () => {
    account = await storedUser({ hasPassword: false });

    const answer: Answer = await askForOptions(withPassword());

    expect(refusal(answer).message).toBe("Email or password does not match.");
    expect(spendVerificationTime).toHaveBeenCalledTimes(1);
    expectNoOptionsAndNobodySignedIn();
  });

  it("an account with a key and a wrong password: the same refusal, after one real check", async () => {
    const answer: Answer = await askForOptions(
      withPassword("not the password"),
    );

    expect(refusal(answer).message).toBe("Email or password does not match.");
    expect(verifyHashedColumnValue).toHaveBeenCalledTimes(1);
    expect(spendVerificationTime).not.toHaveBeenCalled();
    expectNoOptionsAndNobodySignedIn();
  });

  it("an account with no second step and a wrong password: the same refusal", async () => {
    account = await storedUser({ enableTwoFactorAuth: false });

    const answer: Answer = await askForOptions(
      withPassword("not the password"),
    );

    expect(refusal(answer).message).toBe("Email or password does not match.");
    expectNoOptionsAndNobodySignedIn();
  });

  it("the four refusals cannot be told apart by status, class or words", async () => {
    const refusals: Array<Refusal> = [];

    account = null;
    refusals.push(refusal(await askForOptions(withPassword())));

    sendErrorResponse.mockClear();
    account = await storedUser({ hasPassword: false });
    refusals.push(refusal(await askForOptions(withPassword())));

    sendErrorResponse.mockClear();
    account = await storedUser();
    refusals.push(refusal(await askForOptions(withPassword("wrong"))));

    sendErrorResponse.mockClear();
    account = await storedUser({ enableTwoFactorAuth: false });
    refusals.push(refusal(await askForOptions(withPassword("wrong"))));

    for (const each of refusals) {
      expect(each).toEqual(refusals[0]);
    }
  });

  it("an address with no account writes nothing anywhere: no challenge, no failed sign-in", async () => {
    account = null;

    await askForOptions(withPassword());

    expect(generateAuthenticationOptions).not.toHaveBeenCalled();
    expect(recordFailedSignIn).not.toHaveBeenCalled();
  });

  it("a wrong password for a real account is a failed sign-in for its owner, and writes no challenge", async () => {
    await askForOptions(withPassword("wrong"));

    expect(generateAuthenticationOptions).not.toHaveBeenCalled();
    expect(recordFailedSignIn).toHaveBeenCalledTimes(1);
    expect(
      (recordFailedSignIn.mock.calls[0]![0] as { reason: SignInFailureReason })
        .reason,
    ).toBe(SignInFailureReason.WrongPassword);
  });
});

describe("timing: refusals take as long whether or not the address has an account", () => {
  /*
   * Wall-clock, with real scrypt and every other store mocked away, so
   * what is timed is the work the handler chooses to do. Interleaved, so a
   * slow stretch of the machine falls on both sides, and compared by their
   * medians. Before #9745 an address with no account was refused with no
   * derivation at all: tens of milliseconds against well under one.
   */
  const SAMPLES: number = 7;

  async function medianMs(run: () => Promise<void>): Promise<number> {
    const times: Array<number> = [];

    for (let i: number = 0; i < SAMPLES; i++) {
      const started: number = performance.now();
      await run();
      times.push(performance.now() - started);
    }

    times.sort((a: number, b: number) => {
      return a - b;
    });

    return times[Math.floor(SAMPLES / 2)]!;
  }

  it("an unknown address, no password yet, and a wrong password are refused in the same time", async () => {
    const withKey: User = await storedUser();
    const noPassword: User = await storedUser({ hasPassword: false });

    const unknown: Array<number> = [];
    const unclaimed: Array<number> = [];
    const wrongPassword: Array<number> = [];

    // Interleaved rounds: one of each per round.
    for (let round: number = 0; round < 3; round++) {
      account = null;
      unknown.push(
        await medianMs(async () => {
          await askForOptions(withPassword());
        }),
      );

      account = noPassword;
      unclaimed.push(
        await medianMs(async () => {
          await askForOptions(withPassword());
        }),
      );

      account = withKey;
      wrongPassword.push(
        await medianMs(async () => {
          await askForOptions(withPassword("not the password"));
        }),
      );
    }

    const best: (times: Array<number>) => number = (
      times: Array<number>,
    ): number => {
      return Math.min(...times);
    };

    const unknownMs: number = best(unknown);
    const unclaimedMs: number = best(unclaimed);
    const wrongPasswordMs: number = best(wrongPassword);

    // Each did real work: a derivation, not a database read's worth.
    expect(unknownMs).toBeGreaterThan(5);

    /*
     * Alike within a tolerance: a third of the slower, or 15 ms, whichever
     * is more. A refusal with no derivation would be a small fraction of
     * one with a derivation, far outside either.
     */
    const tolerance: (a: number, b: number) => number = (
      a: number,
      b: number,
    ): number => {
      return Math.max(15, Math.max(a, b) / 3);
    };

    expect(Math.abs(unknownMs - wrongPasswordMs)).toBeLessThan(
      tolerance(unknownMs, wrongPasswordMs),
    );
    expect(Math.abs(unclaimedMs - wrongPasswordMs)).toBeLessThan(
      tolerance(unclaimedMs, wrongPasswordMs),
    );
  }, 120000);
});

describe("the right password: the options for that account, and nobody signed in", () => {
  it("hands the browser the options for the account the password proved", async () => {
    await askForOptions(withPassword());

    expect(generateAuthenticationOptions).toHaveBeenCalledTimes(1);
    expect(
      (
        generateAuthenticationOptions.mock.calls[0]![0] as { userId: ObjectID }
      ).userId.toString(),
    ).toBe(account!.id!.toString());

    expect(sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    expect(sendJsonObjectResponse.mock.calls[0]![2]).toEqual({
      options: AUTHENTICATION_OPTIONS,
    });
    expect(sendErrorResponse).not.toHaveBeenCalled();
  });

  it("answers the options alone: never the account's id, nor the challenge apart", async () => {
    await askForOptions(withPassword());

    const body: JSONObject = sendJsonObjectResponse.mock
      .calls[0]![2] as JSONObject;

    expect(Object.keys(body)).toEqual(["options"]);
    expect(JSON.stringify(body)).not.toContain(account!.id!.toString());
  });

  it("an account named in the body is ignored: the options are the proved account's", async () => {
    await askForOptions({
      ...withPassword(),
      userId: OTHER_USER_ID,
      _id: OTHER_USER_ID,
    });

    expect(
      (
        generateAuthenticationOptions.mock.calls[0]![0] as { userId: ObjectID }
      ).userId.toString(),
    ).not.toBe(OTHER_USER_ID);
  });

  it("signs nobody in, forgets no wrong codes, and records no failure", async () => {
    await askForOptions(withPassword());

    expect(createSession).not.toHaveBeenCalled();
    expect(setUserCookie).not.toHaveBeenCalled();
    expect(sendEntityResponse).not.toHaveBeenCalled();
    expect(forgetWrongCodes).not.toHaveBeenCalled();
    expect(recordFailedSignIn).not.toHaveBeenCalled();
  });

  it("tells the password holder, and only them, that the account has no key", async () => {
    generateAuthenticationOptions.mockRejectedValue(
      new BadDataException(NO_KEY_REFUSAL) as never,
    );

    const answer: Answer = await askForOptions(withPassword());

    expect(refusal(answer).message).toBe(NO_KEY_REFUSAL);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("tells the password holder an account with no second step that it has none", async () => {
    account = await storedUser({ enableTwoFactorAuth: false });

    const answer: Answer = await askForOptions(withPassword());

    expect(refusal(answer).message).toBe(
      "Two factor authentication is not enabled for this account.",
    );
    expectNoOptionsAndNobodySignedIn();
  });
});

describe("the checks /login makes come first", () => {
  it("a blocked account is refused as blocked, before any key is asked for", async () => {
    account = await storedUser({ isBlocked: true });

    const answer: Answer = await askForOptions(withPassword());

    expect(refusal(answer).message).toBe(ExceptionMessages.UserBlocked);
    expectNoOptionsAndNobodySignedIn();
  });

  it("an unverified address is sent its link, and gets no options", async () => {
    account = await storedUser({ isEmailVerified: false });

    await askForOptions(withPassword());

    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
    expectNoOptionsAndNobodySignedIn();
  });

  it("a server that requires single sign-on refuses before any key is asked for", async () => {
    assertNonSsoSignInAllowed.mockRejectedValue(
      new BadDataException(SSO_REQUIRED_SIGN_IN_MESSAGE) as never,
    );

    const answer: Answer = await askForOptions(withPassword());

    expect(refusal(answer).message).toBe(SSO_REQUIRED_SIGN_IN_MESSAGE);
    expectNoOptionsAndNobodySignedIn();
  });
});

describe("a sign-in begun with an emailed link", () => {
  it("stands in for the password, and is not spent: the key's answer finishes the sign-in", async () => {
    jest
      .spyOn(UserService, "findByMagicLinkToken")
      .mockResolvedValue(account as never);
    const consumeMagicLinkToken: jest.SpiedFunction<
      typeof UserService.consumeMagicLinkToken
    > = jest
      .spyOn(UserService, "consumeMagicLinkToken")
      .mockResolvedValue(true as never);

    await askForOptions({ magicLinkToken: LINK_TOKEN });

    expect(generateAuthenticationOptions).toHaveBeenCalledTimes(1);
    expect(consumeMagicLinkToken).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });
});
