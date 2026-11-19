import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import User from "Common/Models/DatabaseModels/User";
import UserTotpAuth from "Common/Models/DatabaseModels/UserTotpAuth";
import { SignInFailureReason } from "Common/Types/AuditLog/AuditLogSignInFailure";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import Email from "Common/Types/Email";
import BadDataException from "Common/Types/Exception/BadDataException";
import Exception from "Common/Types/Exception/Exception";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SSO_REQUIRED_SIGN_IN_MESSAGE } from "Common/Types/SSO/SignInMethods";
import { SSO_MANAGED_SIGN_IN_MESSAGE } from "Common/Types/SSO/SsoManagedSignIn";
import { SignInMethod } from "Common/Types/UserSession/SessionSignIn";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * WHAT THE SIGN-IN ROUTES TELL THE AUDIT LOG OF A FAILED SIGN-IN (issue #6788).
 *
 * POST /login and its second steps hand FailedSignInAuditLog.record each
 * attempt on an existing account that fails - a wrong password, a wrong
 * authenticator code, backup code or security key, a code refused after
 * too many wrong ones, a blocked or unverified account, a password while
 * the server requires single sign-on - with the account, why it failed and
 * how it tried. record() itself leaves its work for after the answer
 * (FailedSignInAuditLog.test.ts); here, what the routes hand it:
 *
 *   - nothing for an address nobody has, and the answer to it is the very
 *     answer a wrong password gets, so neither the answer nor the audit log
 *     tells a stranger whether the account exists;
 *   - nothing for an attempt that succeeds, or for a refusal that is no
 *     failed credential (a rule the server could not read);
 *   - never what was typed.
 *
 * Each route runs through its real handler; the database, mail and the
 * response writer are stand-ins (the harness of SessionAuditLogRoutes.test.ts).
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

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
 * Whether single sign-on manages the person's sign-in (#9763), which a
 * first second step set up at sign-in asks: not, unless a test says so.
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

const PASSWORD: string = "correct horse battery staple";
const USER_EMAIL: string = "fox.mulder@example.com";
const UNKNOWN_EMAIL: string = "nobody.here@example.com";
const USER_ID: string = "6c7a0000-0000-4000-8000-0000000067a1";
const TOTP_ID: string = "6c7a0000-0000-4000-8000-0000000067a2";
const RIGHT_CODE: string = "123456";

// The user row as Postgres holds it; each test sets what it is about.
let storedRow: Record<string, unknown> = {};

function projectOntoSelect(select: Record<string, unknown>): User {
  const user: User = new User();

  for (const column of Object.keys(select)) {
    if (select[column] && storedRow[column] !== undefined) {
      (user as unknown as Record<string, unknown>)[column] = storedRow[column];
    }
  }

  return user;
}

const userFindOneBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return userFindOneBy(...args);
      },
      findOneById: jest.fn(),
      verifyHashedColumnValue: (data: {
        plainValue: string;
      }): Promise<boolean> => {
        return Promise.resolve(data.plainValue === PASSWORD);
      },
      isUserBlocked: (): Promise<boolean> => {
        return Promise.resolve(false);
      },
      updateOneByIdAndFetch: jest.fn(),
      updateOneBy: jest.fn(),
      updateOneById: jest.fn(),
      createUserOnSignup: jest.fn(),
      findByMagicLinkToken: jest.fn(),
      consumeMagicLinkToken: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/UserRegistrationToken", () => {
  return {
    __esModule: true,
    default: { consumeRegistrationToken: jest.fn() },
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

const totpFindBy: jest.Mock = jest.fn();
const totpFindOneBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserTotpAuthService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (...args: Array<unknown>): unknown => {
        return totpFindBy(...args);
      },
      findOneBy: (...args: Array<unknown>): unknown => {
        return totpFindOneBy(...args);
      },
      create: jest.fn(),
      updateOneById: jest.fn(),
      deleteBy: jest.fn(),
    },
  };
});

const verifyAuthentication: jest.Mock = jest.fn();
const verifyRegistration: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserWebAuthnService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
      verifyAuthentication: (...args: Array<unknown>): unknown => {
        return verifyAuthentication(...args);
      },
      generateRegistrationOptions: (): Promise<unknown> => {
        return Promise.resolve({ options: {}, challenge: "challenge" });
      },
      verifyRegistration: (...args: Array<unknown>): unknown => {
        return verifyRegistration(...args);
      },
    },
  };
});

const consumeCode: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserTwoFactorBackupCodeService", () => {
  return {
    __esModule: true,
    default: {
      countUnusedForUser: (): Promise<number> => {
        return Promise.resolve(3);
      },
      consumeCode: (...args: Array<unknown>): unknown => {
        return consumeCode(...args);
      },
      generateForUserIfNone: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/TotpAuth", () => {
  return {
    __esModule: true,
    default: {
      verifyToken: (data: { token: string }): boolean => {
        return data.token === "123456";
      },
    },
  };
});

let codeCheckOutcome: string = "allowed";

jest.mock("Common/Server/Utils/TwoFactorWrongCodes", () => {
  const actual: Record<string, unknown> & {
    default: Record<string, unknown>;
  } = jest.requireActual("Common/Server/Utils/TwoFactorWrongCodes");

  return {
    ...actual,
    __esModule: true,
    default: {
      startCheck: (): Promise<Record<string, unknown>> => {
        return Promise.resolve({
          outcome: codeCheckOutcome,
          wrongCodesInARow: codeCheckOutcome === "allowed" ? 1 : 6,
          waitSeconds: codeCheckOutcome === "waiting" ? 120 : 0,
        });
      },
      forget: (): Promise<void> => {
        return Promise.resolve();
      },
      shouldTellOwner: (): Promise<boolean> => {
        return Promise.resolve(false);
      },
      getWaitingMessage: actual.default["getWaitingMessage"],
      describeWait: actual.default["describeWait"],
    },
  };
});

const createSession: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: {
      ...(
        jest.requireActual(
          "./SessionLengthsNotSetStandIn",
        ) as typeof import("./SessionLengthsNotSetStandIn")
      ).sessionLengthsNotSet(),
      createSession: (...args: Array<unknown>): unknown => {
        return createSession(...args);
      },
      revokeAllSessionsByUserId: jest.fn(),
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

jest.mock("Common/Server/Utils/RateLimit/PublicMessageRateLimit", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/RateLimit/PublicMessageRateLimit",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      assertMaySend: (): Promise<void> => {
        return Promise.resolve();
      },
      forEmail: (email: string): Record<string, unknown> => {
        return { email };
      },
      setRetryAfterFor: jest.fn(),
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

jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: {
      sendVerificationEmail: jest.fn(),
      sendCompleteRegistrationEmail: jest.fn(),
      sendTwoFactorBackupCodeUsedEmail: jest.fn(),
      sendTwoFactorWrongCodesEmail: jest.fn(),
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

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: (...args: Array<unknown>): unknown => {
        return sendErrorResponse(...args);
      },
      sendEntityResponse: (...args: Array<unknown>): unknown => {
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

interface Outcome {
  // What the route answered: the error it sent, or the one it handed on.
  answered: Exception | null;
  req: ExpressRequest;
}

async function invoke(uri: string, data: JSONObject): Promise<Outcome> {
  const handler: RouteHandler = mockRouter.match("post", uri);
  const req: ExpressRequest = buildRequest({ data });
  (req as unknown as { headers: Dictionary<string> }).headers = {
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  };
  const res: ExpressResponse = buildResponse();

  let nextError: Exception | null = null;

  const next: NextFunction = ((err?: Exception): void => {
    if (err) {
      nextError = err;
    }
  }) as unknown as NextFunction;

  sendErrorResponse.mockClear();

  await handler(req, res, next);

  const sent: Exception | undefined = sendErrorResponse.mock.calls[0]?.[2] as
    | Exception
    | undefined;

  return { answered: sent || nextError, req };
}

function password(value: string = PASSWORD): JSONObject {
  return { _type: "HashedString", value };
}

function signInAs(
  email: string,
  value: string = PASSWORD,
  extra: JSONObject = {},
): JSONObject {
  return { email, password: password(value), ...extra };
}

// The one attempt the routes handed the audit log.
function recorded(): {
  userId: ObjectID;
  reason: SignInFailureReason;
  signIn: { method: SignInMethod };
  req: unknown;
} {
  expect(recordFailedSignIn).toHaveBeenCalledTimes(1);

  return recordFailedSignIn.mock.calls[0]![0] as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  codeCheckOutcome = "allowed";

  storedRow = {
    _id: USER_ID,
    email: new Email(USER_EMAIL),
    name: "Fox Mulder",
    password: "stored-hash",
    passwordSalt: "stored-salt",
    isEmailVerified: true,
    isMasterAdmin: false,
    isBlocked: false,
    enableTwoFactorAuth: false,
    timezone: null,
  };

  userFindOneBy.mockImplementation(
    (data: { query: JSONObject; select: JSONObject }) => {
      const email: string = String(data.query["email"]);

      return Promise.resolve(
        email === USER_EMAIL ? projectOntoSelect(data.select) : null,
      );
    },
  );

  assertNonSsoSignInAllowed.mockResolvedValue(undefined as never);
  assertMayChangeLocalSignInFor.mockResolvedValue(undefined as never);
  verifyRegistration.mockResolvedValue(undefined as never);

  const totp: UserTotpAuth = new UserTotpAuth();
  totp.id = new ObjectID(TOTP_ID);
  totp.twoFactorSecret = "JBSWY3DPEHPK3PXP";
  totp.isVerified = true;
  totpFindBy.mockResolvedValue([totp] as never);
  totpFindOneBy.mockResolvedValue(totp as never);

  verifyAuthentication.mockResolvedValue(new User() as never);
  consumeCode.mockResolvedValue(false as never);

  createSession.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(30),
  } as never);
});

describe("a wrong password", () => {
  it("is handed to the audit log: the account, why, and that it tried a password", async () => {
    const outcome: Outcome = await invoke(
      "/login",
      signInAs(USER_EMAIL, "wrong password"),
    );

    expect(outcome.answered?.message).toBe("Email or password does not match.");

    const attempt: ReturnType<typeof recorded> = recorded();

    expect(attempt.userId.toString()).toBe(USER_ID);
    expect(attempt.reason).toBe(SignInFailureReason.WrongPassword);
    expect(attempt.signIn).toEqual({ method: SignInMethod.Password });
    // The request, for where it came from - never the body that was typed.
    expect(attempt.req).toBe(outcome.req);
    expect(JSON.stringify(Object.keys(attempt))).not.toContain("password");
    expect(createSession).not.toHaveBeenCalled();
  });

  /*
   * An address nobody has cannot be recorded in any project. The answer is
   * the wrong password's own, word for word and of the same kind, so the
   * person signing in cannot tell the two apart.
   */
  it("on an address nobody has, is not recorded, and is answered exactly as a wrong password", async () => {
    const wrongPassword: Outcome = await invoke(
      "/login",
      signInAs(USER_EMAIL, "wrong password"),
    );

    recordFailedSignIn.mockClear();

    const nobody: Outcome = await invoke(
      "/login",
      signInAs(UNKNOWN_EMAIL, "wrong password"),
    );

    expect(recordFailedSignIn).not.toHaveBeenCalled();
    expect(nobody.answered?.message).toBe(wrongPassword.answered?.message);
    expect(nobody.answered?.constructor).toBe(
      wrongPassword.answered?.constructor,
    );
    expect(nobody.answered?.code).toBe(wrongPassword.answered?.code);
  });

  // Every second step checks the password again first.
  it("at a second step, is a wrong password too", async () => {
    storedRow["enableTwoFactorAuth"] = true;

    await invoke(
      "/verify-totp-auth",
      signInAs(USER_EMAIL, "wrong password", {
        code: RIGHT_CODE,
        twoFactorAuthId: TOTP_ID,
      }),
    );

    expect(recorded().reason).toBe(SignInFailureReason.WrongPassword);
  });
});

describe("what a correct password learns", () => {
  it("a sign-in that succeeds records no failure", async () => {
    const outcome: Outcome = await invoke("/login", signInAs(USER_EMAIL));

    expect(outcome.answered).toBeNull();
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(recordFailedSignIn).not.toHaveBeenCalled();
  });

  it("a blocked account is recorded as blocked", async () => {
    storedRow["isBlocked"] = true;

    await invoke("/login", signInAs(USER_EMAIL));

    expect(recorded().reason).toBe(SignInFailureReason.AccountBlocked);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("an address not yet verified is recorded as not verified", async () => {
    storedRow["isEmailVerified"] = false;

    await invoke("/login", signInAs(USER_EMAIL));

    expect(recorded().reason).toBe(SignInFailureReason.EmailNotVerified);
  });

  it("a password while the server requires single sign-on is recorded so", async () => {
    assertNonSsoSignInAllowed.mockRejectedValue(
      new BadDataException(SSO_REQUIRED_SIGN_IN_MESSAGE) as never,
    );

    const outcome: Outcome = await invoke("/login", signInAs(USER_EMAIL));

    expect(outcome.answered?.message).toBe(SSO_REQUIRED_SIGN_IN_MESSAGE);
    expect(recorded().reason).toBe(SignInFailureReason.SingleSignOnRequired);
  });

  // A rule that cannot be read refuses the sign-in, but nobody failed to sign in.
  it("a rule the server could not read refuses, and records nothing", async () => {
    assertNonSsoSignInAllowed.mockRejectedValue(
      new Error("Postgres is down") as never,
    );

    const outcome: Outcome = await invoke("/login", signInAs(USER_EMAIL));

    expect(outcome.answered?.message).toBe("Postgres is down");
    expect(recordFailedSignIn).not.toHaveBeenCalled();
  });
});

describe("a second step that fails", () => {
  beforeEach(() => {
    storedRow["enableTwoFactorAuth"] = true;
  });

  it("a wrong authenticator code", async () => {
    await invoke(
      "/verify-totp-auth",
      signInAs(USER_EMAIL, PASSWORD, {
        code: "654321",
        twoFactorAuthId: TOTP_ID,
      }),
    );

    expect(recorded().reason).toBe(SignInFailureReason.WrongAuthenticatorCode);
    expect(recorded().signIn).toEqual({ method: SignInMethod.Password });
  });

  it("an authenticator app that is not the account's counts as a wrong code", async () => {
    totpFindOneBy.mockResolvedValue(null as never);

    await invoke(
      "/verify-totp-auth",
      signInAs(USER_EMAIL, PASSWORD, {
        code: RIGHT_CODE,
        twoFactorAuthId: TOTP_ID,
      }),
    );

    expect(recorded().reason).toBe(SignInFailureReason.WrongAuthenticatorCode);
  });

  it("the right code records nothing", async () => {
    await invoke(
      "/verify-totp-auth",
      signInAs(USER_EMAIL, PASSWORD, {
        code: RIGHT_CODE,
        twoFactorAuthId: TOTP_ID,
      }),
    );

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(recordFailedSignIn).not.toHaveBeenCalled();
  });

  it("a code sent while the account waits is refused unchecked: too many wrong codes", async () => {
    codeCheckOutcome = "waiting";

    await invoke(
      "/verify-totp-auth",
      signInAs(USER_EMAIL, PASSWORD, {
        code: RIGHT_CODE,
        twoFactorAuthId: TOTP_ID,
      }),
    );

    expect(recorded().reason).toBe(SignInFailureReason.TooManyWrongCodes);
  });

  // Valkey cannot count: nobody's code was refused for being wrong.
  it("a code refused because the count cannot be read records nothing", async () => {
    codeCheckOutcome = "counter-unavailable";

    await invoke(
      "/verify-totp-auth",
      signInAs(USER_EMAIL, PASSWORD, {
        code: RIGHT_CODE,
        twoFactorAuthId: TOTP_ID,
      }),
    );

    expect(recordFailedSignIn).not.toHaveBeenCalled();
  });

  it("a wrong backup code", async () => {
    await invoke(
      "/verify-backup-code",
      signInAs(USER_EMAIL, PASSWORD, { backupCode: "abcd-efgh-ijkl" }),
    );

    expect(recorded().reason).toBe(SignInFailureReason.WrongBackupCode);
  });

  it("a backup code sent while the account waits: too many wrong codes", async () => {
    codeCheckOutcome = "waiting";

    await invoke(
      "/verify-backup-code",
      signInAs(USER_EMAIL, PASSWORD, { backupCode: "abcd-efgh-ijkl" }),
    );

    expect(recorded().reason).toBe(SignInFailureReason.TooManyWrongCodes);
  });

  it("a security key whose answer is refused", async () => {
    verifyAuthentication.mockRejectedValue(
      new BadDataException("Authentication verification failed") as never,
    );

    const outcome: Outcome = await invoke(
      "/verify-webauthn-auth",
      signInAs(USER_EMAIL, PASSWORD, { credential: { id: "key" } }),
    );

    expect(outcome.answered?.message).toBe(
      "Authentication verification failed",
    );
    expect(recorded().reason).toBe(SignInFailureReason.SecurityKeyNotAccepted);
  });

  it("a security key check that breaks is no refused key", async () => {
    verifyAuthentication.mockRejectedValue(
      new Error("connection reset") as never,
    );

    await invoke(
      "/verify-webauthn-auth",
      signInAs(USER_EMAIL, PASSWORD, { credential: { id: "key" } }),
    );

    expect(recordFailedSignIn).not.toHaveBeenCalled();
  });

  it("a wrong first code from a new authenticator app", async () => {
    // Required to use two factor, with nothing set up yet: an enrolment.
    const pending: UserTotpAuth = new UserTotpAuth();
    pending.id = new ObjectID(TOTP_ID);
    pending.twoFactorSecret = "JBSWY3DPEHPK3PXP";
    pending.isVerified = false;
    totpFindBy.mockResolvedValue([] as never);
    totpFindOneBy.mockResolvedValue(pending as never);

    await invoke(
      "/verify-totp-enrolment",
      signInAs(USER_EMAIL, PASSWORD, {
        code: "654321",
        twoFactorAuthId: TOTP_ID,
      }),
    );

    expect(recorded().reason).toBe(SignInFailureReason.WrongAuthenticatorCode);
  });
});

/*
 * A first second step set up at sign-in - an authenticator app, or a
 * security key (#9764) - for an account required to use two-factor
 * authentication with nothing set up behind it.
 */
describe("setting up a first second step that fails", () => {
  beforeEach(() => {
    storedRow["enableTwoFactorAuth"] = true;
    totpFindBy.mockResolvedValue([] as never);
  });

  /*
   * While single sign-on manages the person's sign-in (#9763), they set up
   * no second step in OneUptime: a sign-in that needed SSO, as a password
   * while the server requires it is.
   */
  it.each([
    ["/login", {}],
    ["/verify-totp-enrolment", { code: RIGHT_CODE, twoFactorAuthId: TOTP_ID }],
    ["/security-key-enrolment-options", {}],
    ["/verify-security-key-enrolment", { credential: { id: "key" } }],
  ])(
    "%s, while single sign-on manages the sign-in, is recorded as single sign-on required",
    async (uri: string, extra: JSONObject) => {
      assertMayChangeLocalSignInFor.mockRejectedValue(
        new BadDataException(SSO_MANAGED_SIGN_IN_MESSAGE) as never,
      );

      const outcome: Outcome = await invoke(
        uri,
        signInAs(USER_EMAIL, PASSWORD, extra),
      );

      expect(outcome.answered?.message).toBe(SSO_MANAGED_SIGN_IN_MESSAGE);
      expect(recorded().reason).toBe(SignInFailureReason.SingleSignOnRequired);
      expect(recorded().signIn).toEqual({ method: SignInMethod.Password });
      expect(createSession).not.toHaveBeenCalled();
    },
  );

  // Nobody failed to sign in when the rule itself could not be read.
  it("a rule that cannot be read refuses the setup, and records nothing", async () => {
    assertMayChangeLocalSignInFor.mockRejectedValue(
      new Error("Postgres is down") as never,
    );

    const outcome: Outcome = await invoke(
      "/security-key-enrolment-options",
      signInAs(USER_EMAIL),
    );

    expect(outcome.answered?.message).toBe("Postgres is down");
    expect(recordFailedSignIn).not.toHaveBeenCalled();
  });

  it("a security key whose answer is refused, at sign-in's setup (#9764)", async () => {
    verifyRegistration.mockRejectedValue(
      new BadDataException("Registration verification failed") as never,
    );

    const outcome: Outcome = await invoke(
      "/verify-security-key-enrolment",
      signInAs(USER_EMAIL, PASSWORD, { credential: { id: "key" } }),
    );

    expect(outcome.answered?.message).toBe("Registration verification failed");
    expect(recorded().reason).toBe(SignInFailureReason.SecurityKeyNotAccepted);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("a security key setup that breaks is no refused key", async () => {
    verifyRegistration.mockRejectedValue(
      new Error("connection reset") as never,
    );

    await invoke(
      "/verify-security-key-enrolment",
      signInAs(USER_EMAIL, PASSWORD, { credential: { id: "key" } }),
    );

    expect(recordFailedSignIn).not.toHaveBeenCalled();
  });

  it("a security key set up at sign-in records no failure", async () => {
    await invoke(
      "/verify-security-key-enrolment",
      signInAs(USER_EMAIL, PASSWORD, { credential: { id: "key" } }),
    );

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(recordFailedSignIn).not.toHaveBeenCalled();
  });
});
