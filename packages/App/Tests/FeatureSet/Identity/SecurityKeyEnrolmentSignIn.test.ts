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
import TwoFactorBackupCode from "Common/Server/Utils/TwoFactorBackupCode";
import User from "Common/Models/DatabaseModels/User";
import UserTotpAuth from "Common/Models/DatabaseModels/UserTotpAuth";
import UserWebAuthn from "Common/Models/DatabaseModels/UserWebAuthn";
import { MAGIC_LINK_INVALID_MESSAGE } from "Common/Types/Accounts/MagicLink";
import {
  SECURITY_KEY_ENROLMENT_OPTIONS_ROUTE,
  SIGN_IN_SECURITY_KEY_NAME,
  VERIFY_SECURITY_KEY_ENROLMENT_ROUTE,
} from "Common/Types/Accounts/SecondStepEnrolment";
import { SignInFailureReason } from "Common/Types/AuditLog/AuditLogSignInFailure";
import Email from "Common/Types/Email";
import BadDataException from "Common/Types/Exception/BadDataException";
import Exception from "Common/Types/Exception/Exception";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import HashedString from "Common/Types/HashedString";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SSO_REQUIRED_SIGN_IN_MESSAGE } from "Common/Types/SSO/SignInMethods";
import { SSO_MANAGED_SIGN_IN_MESSAGE } from "Common/Types/SSO/SsoManagedSignIn";
import {
  SecondFactor,
  SignInMethod,
} from "Common/Types/UserSession/SessionSignIn";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A SECURITY KEY, NOT ONLY AN AUTHENTICATOR APP, WHEN SIGN-IN ASKS SOMEBODY
 * TO SET UP TWO-FACTOR AUTHENTICATION (issue #9764).
 *
 * An account required to use two-factor authentication with nothing set up
 * behind it is walked through setting up a second step when it signs in with
 * its password or a sign-in link. It used to be offered an authenticator app
 * alone (/verify-totp-enrolment); now it can register a security key - a USB
 * or NFC key, or the device's own fingerprint, face or screen lock - in two
 * requests (Types/Accounts/SecondStepEnrolment):
 *
 *   POST /identity/security-key-enrolment-options   the browser's prompt
 *   POST /identity/verify-security-key-enrolment    the key's answer
 *
 * Both write a NEW credential onto an account on the strength of its
 * password alone, so they are held to everything the authenticator app's
 * enrolment is held to, and this suite pins each of those holds through the
 * real handlers:
 *
 *   - both sit behind the second step's limiter, first, and ask no captcha;
 *   - a wrong password, a blocked account, an unverified address and a
 *     server that requires single sign-on are refused exactly as for the
 *     app, before anything about a key is asked;
 *   - an account not required to use two-factor authentication, or one with
 *     an app or a key already set up, is refused before any key is asked
 *     for: a password alone must never bolt a factor onto an account that
 *     does not need one, or add one beside the factor it has;
 *   - an account whose sign-in single sign-on manages (#9763) is refused
 *     with that reason, recorded as a sign-in that needed SSO;
 *   - the options are for the account the password proved, as a security
 *     key, and sign nobody in;
 *   - the answer registers the key for that account and no other, under the
 *     name the profile lists, then sweeps half-finished apps, mints and
 *     shows the backup codes a first second step comes with, forgets the
 *     wrong codes and signs in - with the key as the second factor;
 *   - a key refused is a failed sign-in, recorded so; a database that broke
 *     is not, and neither signs anybody in;
 *   - a sign-in begun with a link spends the link before the key is checked,
 *     and the options never spend it.
 *
 * Password hashing is real. The WebAuthn ceremony itself
 * (UserWebAuthnService's generateRegistrationOptions and verifyRegistration)
 * is stood in: what it does with a credential is its own suites' subject,
 * and what is under test here is who it is asked for, when, and what the
 * route does with its answer. Everything else the handler reaches -
 * sessions, cookies, mail, tokens - is mocked.
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

/*
 * Each limiter the router builds, tagged with its bucket: which bucket a
 * route's first handler counts on is what "behind the second step's
 * limiter" means. What each bucket allows is IdentityRateLimit.test.ts.
 */
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

// The server's requirement of single sign-on: not, unless a test says so.
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

/*
 * Whether single sign-on manages the person's sign-in (#9763,
 * SsoManagedSignIn): not, unless a test says so. Its own rule - the server,
 * the person's projects, master admins - is SignInMatrixSsoAndTwoFactor
 * .test.ts and Common's SsoManagedSignIn suites.
 */
const assertMayChangeLocalSignInFor: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/SsoManagedSignIn", () => {
  return {
    __esModule: true,
    default: {
      assertMayChangeLocalSignInFor: (...args: Array<unknown>): unknown => {
        return assertMayChangeLocalSignInFor(...args);
      },
      isManagedBySsoFor: (): Promise<boolean> => {
        return Promise.resolve(false);
      },
    },
  };
});

// Sign-in links are on: a step begun with one carries its token again.
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

// Authenticator apps: the verified ones, and the sweep of unfinished ones.
const totpFindBy: jest.Mock = jest.fn();
const totpDeleteBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserTotpAuthService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (...args: Array<unknown>): unknown => {
        return totpFindBy(...args);
      },
      deleteBy: (...args: Array<unknown>): unknown => {
        return totpDeleteBy(...args);
      },
      findOneBy: jest.fn(),
      create: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

// Security keys and passkeys: the verified ones, and the registration ceremony.
const webAuthnFindBy: jest.Mock = jest.fn();
const generateRegistrationOptions: jest.Mock = jest.fn();
const verifyRegistration: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserWebAuthnService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (...args: Array<unknown>): unknown => {
        return webAuthnFindBy(...args);
      },
      generateRegistrationOptions: (...args: Array<unknown>): unknown => {
        return generateRegistrationOptions(...args);
      },
      verifyRegistration: (...args: Array<unknown>): unknown => {
        return verifyRegistration(...args);
      },
      verifyAuthentication: jest.fn(),
    },
  };
});

const generateForUserIfNone: jest.Mock = jest.fn();
const regenerateForUser: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserTwoFactorBackupCodeService", () => {
  return {
    __esModule: true,
    default: {
      generateForUserIfNone: (...args: Array<unknown>): unknown => {
        return generateForUserIfNone(...args);
      },
      regenerateForUser: (...args: Array<unknown>): unknown => {
        return regenerateForUser(...args);
      },
      countUnusedForUser: (): Promise<number> => {
        return Promise.resolve(0);
      },
      consumeCode: (): Promise<boolean> => {
        return Promise.resolve(false);
      },
    },
  };
});

// The owner's email about the codes minted behind their new second step.
const notifyCodesCreated: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/TwoFactorBackupCodeNotification", () => {
  return {
    __esModule: true,
    default: {
      notifyCodesCreated: (...args: Array<unknown>): unknown => {
        return notifyCodesCreated(...args);
      },
    },
  };
});

/*
 * Every code is let through to its check, as in the suites about something
 * else; what is asked here is whether a first second step forgets the
 * account's wrong codes. The count is TwoFactorWrongCodesSignIn.test.ts.
 */
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

// What the routes tell the audit log of a failed sign-in.
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
      revokeAllSessionsByUserId: (): Promise<void> => {
        return Promise.resolve();
      },
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

// What the browser's prompt is handed: the ceremony's options, as generated.
const REGISTRATION_OPTIONS: JSONObject = {
  challenge: "c2lnbi1pbi1jaGFsbGVuZ2U",
  rp: { name: "OneUptime", id: "localhost" },
  user: { id: "dXNlcg", name: USER_EMAIL, displayName: USER_EMAIL },
};

// The key's answer, as the browser posts it.
const CREDENTIAL: JSONObject = {
  id: "a2V5LWlk",
  rawId: "a2V5LWlk",
  type: "public-key",
  response: {
    clientDataJSON: "Y2xpZW50LWRhdGE",
    attestationObject: "YXR0ZXN0YXRpb24",
  },
};

const MINTED_CODES: Array<string> = [
  "aaaaabbbbb",
  "cccccddddd",
  "eeeeefffff",
  "ggggghhhhh",
  "iiiiijjjjj",
  "kkkkklllll",
  "mmmmmnnnnn",
  "ooooopppp0",
  "qqqqqrrrrr",
  "ssssstttt1",
];

type Answer = { nextError: Exception | null };

async function post(uri: string, data: JSONObject): Promise<Answer> {
  const handler: RouteHandler = mockRouter.match("post", uri);
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

// The account, stored the way Postgres would hand it back.
async function storedUser(options?: {
  enableTwoFactorAuth?: boolean;
  isEmailVerified?: boolean;
  isBlocked?: boolean;
  isMasterAdmin?: boolean;
}): Promise<User> {
  const salt: string = PasswordHash.generateSalt();

  const user: User = new User();
  user._id = ObjectID.generate().toString();
  user.email = new Email(USER_EMAIL);
  user.isEmailVerified = options?.isEmailVerified !== false;
  user.isBlocked = options?.isBlocked === true;
  user.isMasterAdmin = options?.isMasterAdmin === true;
  user.enableTwoFactorAuth = options?.enableTwoFactorAuth !== false;
  user.passwordSalt = salt;
  user.password = new HashedString(
    await PasswordHash.hash({ plainValue: PASSWORD, salt: salt }),
    true,
  );

  return user;
}

let account: User;

// The credentials a step without a session carries again.
function withPassword(extra: JSONObject = {}, password?: string): JSONObject {
  return {
    email: USER_EMAIL,
    password: {
      _type: "HashedString",
      value: password === undefined ? PASSWORD : password,
    },
    ...extra,
  };
}

// The sign-in link's token in place of the password.
function withLink(extra: JSONObject = {}): JSONObject {
  return { magicLinkToken: LINK_TOKEN, ...extra };
}

async function askForOptions(
  data: JSONObject = withPassword(),
): Promise<Answer> {
  return await post(SECURITY_KEY_ENROLMENT_OPTIONS_ROUTE, data);
}

async function answerWithKey(
  data: JSONObject = withPassword({ credential: CREDENTIAL }),
): Promise<Answer> {
  return await post(VERIFY_SECURITY_KEY_ENROLMENT_ROUTE, data);
}

// The refusal, whichever road it took: an error response, or next(err).
function refusal(answer: Answer): string | undefined {
  const sent: Exception | undefined = (
    sendErrorResponse.mock.calls[0] as Array<unknown> | undefined
  )?.[2] as Exception | undefined;

  return sent?.message || answer.nextError?.message;
}

function isSignedIn(): boolean {
  return (
    createSession.mock.calls.length === 1 &&
    setUserCookie.mock.calls.length === 1 &&
    sendEntityResponse.mock.calls.length === 1 &&
    sendErrorResponse.mock.calls.length === 0
  );
}

// Nothing that signs anybody in: no session row, and no cookie.
function expectNobodySignedIn(): void {
  expect(createSession).not.toHaveBeenCalled();
  expect(setUserCookie).not.toHaveBeenCalled();
}

// Nothing about a key was asked: no options, no registration.
function expectNoKeyAsked(): void {
  expect(generateRegistrationOptions).not.toHaveBeenCalled();
  expect(verifyRegistration).not.toHaveBeenCalled();
}

function signedInMisc(): JSONObject {
  const call: Array<unknown> = sendEntityResponse.mock
    .calls[0] as Array<unknown>;

  return (call[4] as JSONObject)["miscData"] as JSONObject;
}

// The attempts the routes handed the audit log, by why they failed.
function recordedReasons(): Array<SignInFailureReason> {
  return recordFailedSignIn.mock.calls.map(
    (call: Array<unknown>): SignInFailureReason => {
      return (call[0] as { reason: SignInFailureReason }).reason;
    },
  );
}

beforeEach(async () => {
  jest.clearAllMocks();

  account = await storedUser();

  jest.spyOn(UserService, "findOneBy").mockImplementation(((data: {
    query: JSONObject;
  }) => {
    return Promise.resolve(
      String(data.query["email"]) === USER_EMAIL ? account : null,
    );
  }) as never);
  jest.spyOn(UserService, "updateOneById").mockResolvedValue(1 as never);

  assertNonSsoSignInAllowed.mockResolvedValue(undefined as never);
  assertMayChangeLocalSignInFor.mockResolvedValue(undefined as never);

  // Required to use two-factor authentication, with nothing set up behind it.
  totpFindBy.mockResolvedValue([] as never);
  webAuthnFindBy.mockResolvedValue([] as never);
  totpDeleteBy.mockResolvedValue(0 as never);

  generateRegistrationOptions.mockResolvedValue({
    options: REGISTRATION_OPTIONS,
    challenge: REGISTRATION_OPTIONS["challenge"],
  } as never);
  verifyRegistration.mockResolvedValue(undefined as never);
  generateForUserIfNone.mockResolvedValue([...MINTED_CODES] as never);
  forgetWrongCodes.mockResolvedValue(undefined as never);

  createSession.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the two routes", () => {
  it.each([
    [SECURITY_KEY_ENROLMENT_OPTIONS_ROUTE],
    [VERIFY_SECURITY_KEY_ENROLMENT_ROUTE],
  ])(
    "%s is behind the second step's limiter, first, as the app's enrolment is",
    (uri: string) => {
      const handlers: Array<TaggedLimiter> = mockRouter.matchAll(
        "post",
        uri,
      ) as Array<TaggedLimiter>;

      expect(handlers).toHaveLength(2);
      expect(handlers[0]!.bucket).toBe(IdentityRateLimitBucket.TwoFactor);
      expect(handlers[0]!.bucket).toBe(
        (
          mockRouter.matchAll(
            "post",
            "/verify-totp-enrolment",
          ) as Array<TaggedLimiter>
        )[0]!.bucket,
      );
    },
  );

  it("are the identity server's own, under the names the sign-in page posts to", () => {
    expect(SECURITY_KEY_ENROLMENT_OPTIONS_ROUTE).toBe(
      "/security-key-enrolment-options",
    );
    expect(VERIFY_SECURITY_KEY_ENROLMENT_ROUTE).toBe(
      "/verify-security-key-enrolment",
    );
  });

  it("ask for no captcha: the password step already spent it", async () => {
    await askForOptions();
    await answerWithKey();

    expect(verifyCaptcha).not.toHaveBeenCalled();
  });
});

describe(`POST ${SECURITY_KEY_ENROLMENT_OPTIONS_ROUTE}`, () => {
  it("hands the browser the prompt's options for the account the password proved, as a security key", async () => {
    await askForOptions();

    expect(generateRegistrationOptions).toHaveBeenCalledTimes(1);

    const asked: { userId: ObjectID; isPasskey: boolean } =
      generateRegistrationOptions.mock.calls[0]![0] as {
        userId: ObjectID;
        isPasskey: boolean;
      };

    expect(asked.userId.toString()).toBe(account.id!.toString());
    // A second step after the password, which a key with no PIN can be.
    expect(asked.isPasskey).toBe(false);

    expect(sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    expect(sendJsonObjectResponse.mock.calls[0]![2]).toEqual({
      options: REGISTRATION_OPTIONS,
    });
  });

  it("signs nobody in: no session, no cookie, no token", async () => {
    await askForOptions();

    expectNobodySignedIn();
    expect(sendEntityResponse).not.toHaveBeenCalled();
    expect(
      JSON.stringify(sendJsonObjectResponse.mock.calls[0]![2]),
    ).not.toMatch(/accessToken|refreshToken|signed-user-token/);
  });

  it("asks for the account the password proved, whatever ids the body names", async () => {
    await askForOptions(
      withPassword({
        userId: OTHER_USER_ID,
        _id: OTHER_USER_ID,
        id: OTHER_USER_ID,
      }),
    );

    const asked: { userId: ObjectID } = generateRegistrationOptions.mock
      .calls[0]![0] as { userId: ObjectID };

    expect(asked.userId.toString()).toBe(account.id!.toString());
    expect(asked.userId.toString()).not.toBe(OTHER_USER_ID);
  });

  it("neither forgets the account's wrong codes nor saves anything: nothing was proved yet", async () => {
    await askForOptions();

    expect(forgetWrongCodes).not.toHaveBeenCalled();
    expect(verifyRegistration).not.toHaveBeenCalled();
    expect(totpDeleteBy).not.toHaveBeenCalled();
    expect(generateForUserIfNone).not.toHaveBeenCalled();
  });

  it("does not spend a sign-in link: only the key's answer finishes a sign-in", async () => {
    jest
      .spyOn(UserService, "findByMagicLinkToken")
      .mockResolvedValue(account as never);
    const consumeMagicLinkToken: jest.SpiedFunction<
      typeof UserService.consumeMagicLinkToken
    > = jest
      .spyOn(UserService, "consumeMagicLinkToken")
      .mockResolvedValue(true as never);

    await askForOptions(withLink());

    expect(generateRegistrationOptions).toHaveBeenCalledTimes(1);
    expect(consumeMagicLinkToken).not.toHaveBeenCalled();
    expectNobodySignedIn();
  });
});

/*
 * Every refusal the app's enrolment makes, made at both steps, before a key
 * is asked for and with nobody signed in.
 */
type RefusalCase = {
  name: string;
  arrange: () => Promise<void>;
  password?: string | undefined;
  message: string;
  recorded?: SignInFailureReason | undefined;
};

const REFUSALS: Array<RefusalCase> = [
  {
    name: "a wrong password",
    arrange: async (): Promise<void> => {
      // The account as it is.
    },
    password: "not the password",
    message: "Email or password does not match.",
    recorded: SignInFailureReason.WrongPassword,
  },
  {
    name: "a blocked account",
    arrange: async (): Promise<void> => {
      account = await storedUser({ isBlocked: true });
    },
    message: ExceptionMessages.UserBlocked,
    recorded: SignInFailureReason.AccountBlocked,
  },
  {
    name: "an address not verified yet",
    arrange: async (): Promise<void> => {
      account = await storedUser({ isEmailVerified: false });
    },
    message:
      "Email is not verified. We have sent you an email with the verification link. Please do not forget to check spam.",
    recorded: SignInFailureReason.EmailNotVerified,
  },
  {
    name: "a server that requires single sign-on",
    arrange: async (): Promise<void> => {
      assertNonSsoSignInAllowed.mockRejectedValue(
        new BadDataException(SSO_REQUIRED_SIGN_IN_MESSAGE) as never,
      );
    },
    message: SSO_REQUIRED_SIGN_IN_MESSAGE,
    recorded: SignInFailureReason.SingleSignOnRequired,
  },
  {
    name: "an account not required to use two-factor authentication",
    arrange: async (): Promise<void> => {
      account = await storedUser({ enableTwoFactorAuth: false });
    },
    message: "Two factor authentication is not required for this account.",
  },
  {
    name: "an account with an authenticator app already set up",
    arrange: async (): Promise<void> => {
      const app: UserTotpAuth = new UserTotpAuth();
      app.id = ObjectID.generate();
      app.name = "1Password";
      app.isVerified = true;
      totpFindBy.mockResolvedValue([app] as never);
    },
    message: "Two factor authentication is already set up for this account.",
  },
  {
    name: "an account with a security key already set up",
    arrange: async (): Promise<void> => {
      const key: UserWebAuthn = new UserWebAuthn();
      key.id = ObjectID.generate();
      key.name = "YubiKey";
      key.isVerified = true;
      webAuthnFindBy.mockResolvedValue([key] as never);
    },
    message: "Two factor authentication is already set up for this account.",
  },
  {
    name: "an account whose sign-in single sign-on manages (#9763)",
    arrange: async (): Promise<void> => {
      assertMayChangeLocalSignInFor.mockRejectedValue(
        new BadDataException(SSO_MANAGED_SIGN_IN_MESSAGE) as never,
      );
    },
    message: SSO_MANAGED_SIGN_IN_MESSAGE,
    recorded: SignInFailureReason.SingleSignOnRequired,
  },
];

describe.each([
  ["the options", SECURITY_KEY_ENROLMENT_OPTIONS_ROUTE],
  ["the key's answer", VERIFY_SECURITY_KEY_ENROLMENT_ROUTE],
])("%s are refused for", (_label: string, uri: string) => {
  it.each(REFUSALS)(
    "$name, before any key is asked for and with nobody signed in",
    async (testCase: RefusalCase) => {
      await testCase.arrange();

      const answer: Answer = await post(
        uri,
        withPassword({ credential: CREDENTIAL }, testCase.password),
      );

      expect(refusal(answer)).toBe(testCase.message);
      expectNoKeyAsked();
      expectNobodySignedIn();
      expect(totpDeleteBy).not.toHaveBeenCalled();
      expect(generateForUserIfNone).not.toHaveBeenCalled();
      expect(recordedReasons()).toEqual(
        testCase.recorded ? [testCase.recorded] : [],
      );
    },
  );
});

describe("the account's single sign-on, at both steps (#9763)", () => {
  it.each([
    [SECURITY_KEY_ENROLMENT_OPTIONS_ROUTE],
    [VERIFY_SECURITY_KEY_ENROLMENT_ROUTE],
  ])(
    "%s asks it with the account the password proved, and its master-admin standing",
    async (uri: string) => {
      account = await storedUser({ isMasterAdmin: true });

      await post(uri, withPassword({ credential: CREDENTIAL }));

      expect(assertMayChangeLocalSignInFor).toHaveBeenCalledTimes(1);

      const asked: { userId: ObjectID; isMasterAdmin: boolean } =
        assertMayChangeLocalSignInFor.mock.calls[0]![0] as {
          userId: ObjectID;
          isMasterAdmin: boolean;
        };

      expect(asked.userId.toString()).toBe(account.id!.toString());
      expect(asked.isMasterAdmin).toBe(true);
    },
  );

  it("is asked only of an account the enrolment's own refusals let through", async () => {
    account = await storedUser({ enableTwoFactorAuth: false });

    await askForOptions();

    expect(assertMayChangeLocalSignInFor).not.toHaveBeenCalled();
  });

  it("a rule that cannot be read refuses as well, and records no failed sign-in", async () => {
    assertMayChangeLocalSignInFor.mockRejectedValue(
      new Error("connection refused") as never,
    );

    const answer: Answer = await askForOptions();

    expect(refusal(answer)).toBe("connection refused");
    expectNoKeyAsked();
    expectNobodySignedIn();
    expect(recordFailedSignIn).not.toHaveBeenCalled();
  });
});

describe(`POST ${VERIFY_SECURITY_KEY_ENROLMENT_ROUTE}`, () => {
  it("registers the key for the account the password proved, under the name the profile lists it by", async () => {
    await answerWithKey();

    expect(verifyRegistration).toHaveBeenCalledTimes(1);

    const registered: {
      credential: unknown;
      name: string;
      props: { userId: ObjectID; isRoot: boolean };
    } = verifyRegistration.mock.calls[0]![0] as {
      credential: unknown;
      name: string;
      props: { userId: ObjectID; isRoot: boolean };
    };

    expect(registered.credential).toEqual(CREDENTIAL);
    expect(registered.name).toBe(SIGN_IN_SECURITY_KEY_NAME);
    expect(registered.props.userId.toString()).toBe(account.id!.toString());
    expect(registered.props.isRoot).toBe(true);
  });

  it("registers it for no account but the one being signed in, whatever ids the body names", async () => {
    await answerWithKey(
      withPassword({
        credential: CREDENTIAL,
        userId: OTHER_USER_ID,
        _id: OTHER_USER_ID,
        props: { userId: OTHER_USER_ID },
      }),
    );

    const registered: { props: { userId: ObjectID } } = verifyRegistration.mock
      .calls[0]![0] as { props: { userId: ObjectID } };

    expect(registered.props.userId.toString()).toBe(account.id!.toString());
  });

  it("registers nothing for another person's address: the password is that account's, or nothing", async () => {
    const answer: Answer = await answerWithKey({
      email: "someone.else@example.com",
      password: { _type: "HashedString", value: PASSWORD },
      credential: CREDENTIAL,
    });

    expect(refusal(answer)).toBe("Email or password does not match.");
    expectNoKeyAsked();
    expectNobodySignedIn();
  });

  it("signs in once the key is saved, with the key as the second factor", async () => {
    await answerWithKey();

    expect(isSignedIn()).toBe(true);

    const session: { userId: ObjectID; signIn: unknown } = createSession.mock
      .calls[0]![0] as { userId: ObjectID; signIn: unknown };

    expect(session.userId.toString()).toBe(account.id!.toString());
    expect(session.signIn).toEqual({
      method: SignInMethod.Password,
      secondFactor: SecondFactor.SecurityKey,
    });

    for (const field of ["accessToken", "refreshToken"]) {
      expect(signedInMisc()[field]).toBeTruthy();
    }
  });

  it("saves the key before it makes the session", async () => {
    await answerWithKey();

    expect(verifyRegistration.mock.invocationCallOrder[0]!).toBeLessThan(
      createSession.mock.invocationCallOrder[0]!,
    );
  });

  it("sweeps the account's half-finished authenticator apps: the QR code /login drew is dead weight now", async () => {
    await answerWithKey();

    expect(totpDeleteBy).toHaveBeenCalledTimes(1);

    const sweep: { query: JSONObject } = totpDeleteBy.mock.calls[0]![0] as {
      query: JSONObject;
    };

    expect(sweep.query["isVerified"]).toBe(false);
    expect(String(sweep.query["userId"])).toBe(account.id!.toString());
    expect(totpDeleteBy.mock.invocationCallOrder[0]!).toBeGreaterThan(
      verifyRegistration.mock.invocationCallOrder[0]!,
    );
  });

  it("mints the backup codes a first second step comes with, and shows them once, in this answer", async () => {
    await answerWithKey();

    expect(generateForUserIfNone).toHaveBeenCalledTimes(1);
    expect(
      (
        generateForUserIfNone.mock.calls[0]![0] as { userId: ObjectID }
      ).userId.toString(),
    ).toBe(account.id!.toString());
    // Never the regenerate that throws away a set the person holds.
    expect(regenerateForUser).not.toHaveBeenCalled();

    expect(signedInMisc()["backupCodes"]).toEqual(
      MINTED_CODES.map((code: string): string => {
        return TwoFactorBackupCode.formatForDisplay(code);
      }),
    );
    expect(signedInMisc()["hasBackupCodes"]).toBeUndefined();
  });

  it("tells the owner, at their own address, that codes were made behind a new second step", async () => {
    await answerWithKey();

    expect(notifyCodesCreated).toHaveBeenCalledTimes(1);

    const notice: { userId: ObjectID; codeCount: number } = notifyCodesCreated
      .mock.calls[0]![0] as { userId: ObjectID; codeCount: number };

    expect(notice.userId.toString()).toBe(account.id!.toString());
    expect(notice.codeCount).toBe(MINTED_CODES.length);
  });

  it("says so when the account already had codes, and mints and mails none", async () => {
    generateForUserIfNone.mockResolvedValue(null as never);

    await answerWithKey();

    expect(isSignedIn()).toBe(true);
    expect(signedInMisc()["backupCodes"]).toBeUndefined();
    expect(signedInMisc()["hasBackupCodes"]).toBe(true);
    expect(notifyCodesCreated).not.toHaveBeenCalled();
  });

  it("a mint that fails never costs the sign-in: the key is saved and the password was right", async () => {
    generateForUserIfNone.mockRejectedValue(
      new Error("backup codes table is unavailable") as never,
    );

    await answerWithKey();

    expect(isSignedIn()).toBe(true);
    expect(signedInMisc()["backupCodes"]).toBeUndefined();
  });

  it("forgets the account's wrong codes, as every second step that passes does", async () => {
    await answerWithKey();

    expect(forgetWrongCodes).toHaveBeenCalledTimes(1);
    expect(String(forgetWrongCodes.mock.calls[0]![0])).toBe(
      account.id!.toString(),
    );
  });

  it("records no failed sign-in for a key that worked", async () => {
    await answerWithKey();

    expect(recordFailedSignIn).not.toHaveBeenCalled();
  });

  it("asks for the key's answer: one missing is refused before anything is spent", async () => {
    const answer: Answer = await answerWithKey(withPassword());

    expect(refusal(answer)).toBe("Security key is required.");
    expect(verifyRegistration).not.toHaveBeenCalled();
    expect(totpDeleteBy).not.toHaveBeenCalled();
    expectNobodySignedIn();
  });

  it("a key whose answer is refused signs nobody in, saves nothing more, and is a security key not accepted", async () => {
    verifyRegistration.mockRejectedValue(
      new BadDataException("Registration verification failed") as never,
    );

    const answer: Answer = await answerWithKey();

    expect(refusal(answer)).toBe("Registration verification failed");
    expectNobodySignedIn();
    expect(totpDeleteBy).not.toHaveBeenCalled();
    expect(generateForUserIfNone).not.toHaveBeenCalled();
    expect(forgetWrongCodes).not.toHaveBeenCalled();
    expect(recordedReasons()).toEqual([
      SignInFailureReason.SecurityKeyNotAccepted,
    ]);
  });

  it("a challenge that expired is a refused key too: the ceremony starts again", async () => {
    verifyRegistration.mockRejectedValue(
      new BadDataException(
        "WebAuthn challenge expired or was already used. Please try again.",
      ) as never,
    );

    await answerWithKey();

    expectNobodySignedIn();
    expect(recordedReasons()).toEqual([
      SignInFailureReason.SecurityKeyNotAccepted,
    ]);
  });

  it("a database that broke is no refused key: nothing recorded, nobody signed in", async () => {
    verifyRegistration.mockRejectedValue(
      new Error("connection reset") as never,
    );

    const answer: Answer = await answerWithKey();

    expect(refusal(answer)).toBe("connection reset");
    expectNobodySignedIn();
    expect(recordFailedSignIn).not.toHaveBeenCalled();
  });
});

describe("a sign-in begun with a link (Types/Accounts/MagicLink)", () => {
  let sequence: Array<string> = [];
  let consumeMagicLinkToken: jest.SpiedFunction<
    typeof UserService.consumeMagicLinkToken
  >;

  beforeEach(() => {
    sequence = [];

    jest
      .spyOn(UserService, "findByMagicLinkToken")
      .mockResolvedValue(account as never);

    consumeMagicLinkToken = jest
      .spyOn(UserService, "consumeMagicLinkToken")
      .mockImplementation((() => {
        sequence.push("spend the link");
        return Promise.resolve(true);
      }) as never);

    verifyRegistration.mockImplementation((() => {
      sequence.push("check the key");
      return Promise.resolve();
    }) as never);
  });

  it("spends the link before the key is checked, then signs in with the link", async () => {
    await answerWithKey(withLink({ credential: CREDENTIAL }));

    expect(sequence).toEqual(["spend the link", "check the key"]);
    expect(isSignedIn()).toBe(true);
    expect(
      (createSession.mock.calls[0]![0] as { signIn: unknown }).signIn,
    ).toEqual({
      method: SignInMethod.SignInLink,
      secondFactor: SecondFactor.SecurityKey,
    });
  });

  it("registers no key and signs nobody in for a link another request spent first", async () => {
    consumeMagicLinkToken.mockResolvedValue(false as never);

    const answer: Answer = await answerWithKey(
      withLink({ credential: CREDENTIAL }),
    );

    expect(refusal(answer)).toBe(MAGIC_LINK_INVALID_MESSAGE);
    expect(verifyRegistration).not.toHaveBeenCalled();
    expect(generateForUserIfNone).not.toHaveBeenCalled();
    expectNobodySignedIn();
  });

  it("keeps the link when no key's answer came with it", async () => {
    await answerWithKey(withLink());

    expect(consumeMagicLinkToken).not.toHaveBeenCalled();
    expectNobodySignedIn();
  });
});
