import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import {
  buildOtpauthUri,
  conformingAppCode,
  googleAuthenticatorCode,
} from "Common/Tests/Server/TestingUtils/AuthenticatorApp";
import UserService from "Common/Server/Services/UserService";
import PasswordHash from "Common/Server/Utils/PasswordHash";
import TotpAuth from "Common/Server/Utils/TotpAuth";
import User from "Common/Models/DatabaseModels/User";
import UserTotpAuth from "Common/Models/DatabaseModels/UserTotpAuth";
import Email from "Common/Types/Email";
import Exception from "Common/Types/Exception/Exception";
import HashedString from "Common/Types/HashedString";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

/*
 * ---------------------------------------------------------------------------
 * POST /verify-totp-auth — the second half of a two-factor login, exercised
 * through the real handler.
 *
 * The setup endpoint (POST /user-totp-auth/validate) is the one issue #3275
 * was reported against, but it is not the dangerous half. Enrolment failing is
 * an annoyance; THIS route failing is a lockout — the password has already
 * been accepted, the account already has `enableTwoFactorAuth` on, and there
 * is no way back into it from the browser. Both routes call the same
 * TotpAuth.verifyToken, so an algorithm change made for one silently decides
 * the fate of the other, and that coupling is what these tests hold down.
 *
 * TotpAuth is not mocked. Codes come from TestingUtils/AuthenticatorApp, which
 * derives them from the RFCs with Node crypto rather than from the library the
 * server verifies with — including `googleAuthenticatorCode`, which models a
 * phone ignoring the URL's `algorithm` parameter, the behaviour that caused
 * the bug. Everything else the handler reaches (sessions, cookies, mail,
 * tokens) is mocked, because none of it is what is under test.
 * ---------------------------------------------------------------------------
 */

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
    },
  };
});

jest.mock("Common/Server/Services/UserWebAuthnService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (): Array<unknown> => {
        return [];
      },
      verifyAuthentication: jest.fn(),
    },
  };
});

/*
 * The two factor CHALLENGE branch of /login also reports how many backup codes
 * the account has left, so the sign-in page knows whether to offer "use a
 * backup code". Un-mocked, the real service reaches a repository this suite
 * does not connect, and every challenge test fails with "Database not
 * connected" rather than anything to do with what it was checking.
 *
 * Zero, because none of the tests here are about recovery codes -- that is
 * App/Tests/FeatureSet/Identity/BackupCodeLoginVerification.test.ts.
 */
jest.mock("Common/Server/Services/UserTwoFactorBackupCodeService", () => {
  return {
    __esModule: true,
    default: {
      countUnusedForUser: (): Promise<number> => {
        return Promise.resolve(0);
      },
      consumeCode: (): Promise<boolean> => {
        return Promise.resolve(false);
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

jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: { sendVerificationEmail: jest.fn() },
  };
});

const debugLog: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: (...args: Array<unknown>): unknown => {
        return debugLog(...args);
      },
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
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: (...args: Array<unknown>): unknown => {
        return sendEntityResponse(...args);
      },
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/Authentication";

const PASSWORD: string = "correct horse battery staple";
const USER_EMAIL: string = "totp.user@example.com";
const TOTP_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

type InvokeResult = { nextError: Exception | null };

type InvokeFunction = (uri: string, body: unknown) => Promise<InvokeResult>;

const invoke: InvokeFunction = async (
  uri: string,
  body: unknown,
): Promise<InvokeResult> => {
  const handler: RouteHandler = mockRouter.match("post", uri);
  const req: ExpressRequest = buildRequest(body);
  const res: ExpressResponse = buildResponse();

  let nextError: Exception | null = null;

  const next: NextFunction = ((err?: Exception): void => {
    if (err) {
      nextError = err;
    }
  }) as unknown as NextFunction;

  await handler(req, res, next);

  return { nextError };
};

/*
 * An account with 2FA switched on, stored the way Postgres would hand it back.
 */
type StoredUserFunction = () => Promise<User>;

const storedUser: StoredUserFunction = async (): Promise<User> => {
  const salt: string = PasswordHash.generateSalt();

  const user: User = new User();
  user._id = ObjectID.generate().toString();
  user.email = new Email(USER_EMAIL);
  user.isEmailVerified = true;
  user.isMasterAdmin = false;
  user.enableTwoFactorAuth = true;
  user.passwordSalt = salt;
  user.password = new HashedString(
    await PasswordHash.hash({ plainValue: PASSWORD, salt: salt }),
    true,
  );

  return user;
};

/*
 * A verified enrolment. `algorithm` selects what the QR code the user scanned
 * said: today's SHA1, or the SHA256 the old code used to issue.
 *
 * Two ways to read the code off it: `codeFromTheAuthenticatorApp` is an app
 * that honours the URL's algorithm (1Password, Bitwarden), and
 * `codeFromAPhone` is Google Authenticator, which does not.
 */
type EnrolmentFunction = (options?: { algorithm?: string }) => {
  row: UserTotpAuth;
  codeFromTheAuthenticatorApp: () => string;
  codeFromAPhone: () => string;
};

const enrolment: EnrolmentFunction = (options?: { algorithm?: string }) => {
  const secret: string = TotpAuth.generateSecret();

  const otpUrl: string = buildOtpauthUri({
    secret: secret,
    label: USER_EMAIL,
    algorithm: options?.algorithm || "SHA1",
  });

  const row: UserTotpAuth = new UserTotpAuth();
  row.id = TOTP_ID;
  row.twoFactorSecret = secret;
  row.twoFactorOtpUrl = otpUrl;
  row.isVerified = true;

  return {
    row: row,
    codeFromTheAuthenticatorApp: (): string => {
      return conformingAppCode(otpUrl);
    },
    codeFromAPhone: (): string => {
      return googleAuthenticatorCode(otpUrl);
    },
  };
};

type VerifyTotpFunction = (data: {
  code: string;
  twoFactorAuthId?: string;
  password?: string;
}) => Promise<InvokeResult>;

const verifyTotp: VerifyTotpFunction = (data: {
  code: string;
  twoFactorAuthId?: string;
  password?: string;
}): Promise<InvokeResult> => {
  /*
   * The shape the login page posts: everything, including the code and the id
   * of the factor being used, nested under `data`. See
   * App/FeatureSet/Accounts/src/Pages/Login.tsx.
   */
  return invoke("/verify-totp-auth", {
    data: {
      email: USER_EMAIL,
      password: {
        _type: "HashedString",
        value: data.password === undefined ? PASSWORD : data.password,
      },
      code: data.code,
      twoFactorAuthId:
        data.twoFactorAuthId === undefined
          ? TOTP_ID.toString()
          : data.twoFactorAuthId,
    },
  });
};

type LoginSucceededFunction = () => boolean;

const loginSucceeded: LoginSucceededFunction = (): boolean => {
  return (
    sendEntityResponse.mock.calls.length > 0 &&
    sendErrorResponse.mock.calls.length === 0
  );
};

type LoginErrorMessageFunction = () => string | undefined;

const loginErrorMessage: LoginErrorMessageFunction = (): string | undefined => {
  const call: Array<unknown> | undefined = sendErrorResponse.mock.calls[0] as
    | Array<unknown>
    | undefined;

  return (call?.[2] as Exception | undefined)?.message;
};

beforeEach(() => {
  jest.clearAllMocks();

  createSession.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
  } as never);

  totpFindBy.mockResolvedValue([] as never);
  totpFindOneBy.mockResolvedValue(null as never);

  jest.spyOn(UserService, "updateOneById").mockResolvedValue(1 as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /verify-totp-auth — the code from the user's authenticator", () => {
  it("logs the user in when the code matches the QR they scanned", async () => {
    const user: User = await storedUser();
    const totp: ReturnType<EnrolmentFunction> = enrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(totp.row as never);

    await verifyTotp({ code: totp.codeFromTheAuthenticatorApp() });

    expect(loginSucceeded()).toBe(true);
  });

  /*
   * The lockout half of issue #3275: an enrolment created before the fix is
   * SHA256, and dropping SHA256 from verification would shut those accounts
   * out of a login they had been completing successfully every day.
   */
  it("still logs in an account enrolled with a legacy SHA256 QR code", async () => {
    const user: User = await storedUser();

    const totp: ReturnType<EnrolmentFunction> = enrolment({
      algorithm: "SHA256",
    });

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(totp.row as never);

    await verifyTotp({ code: totp.codeFromTheAuthenticatorApp() });

    expect(loginSucceeded()).toBe(true);
  });

  /*
   * A phone reading a QR code that still says SHA256 — the state every stuck
   * user is in until the migration rewrites their URL. The phone ignores the
   * parameter and emits SHA1, and SHA1 is what the verifier tries first, so
   * the login works without the stored URL having to be touched at all.
   */
  it("logs in from a phone reading a QR code that still says SHA256", async () => {
    const user: User = await storedUser();

    const totp: ReturnType<EnrolmentFunction> = enrolment({
      algorithm: "SHA256",
    });

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(totp.row as never);

    await verifyTotp({ code: totp.codeFromAPhone() });

    expect(loginSucceeded()).toBe(true);
  });

  it("accepts the code with the space the phone's clipboard leaves in", async () => {
    const user: User = await storedUser();
    const totp: ReturnType<EnrolmentFunction> = enrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(totp.row as never);

    const code: string = totp.codeFromTheAuthenticatorApp();

    await verifyTotp({ code: `${code.slice(0, 3)} ${code.slice(3)}` });

    expect(loginSucceeded()).toBe(true);
  });

  it("only considers enrolments that were verified, and that belong to this user", async () => {
    const user: User = await storedUser();
    const totp: ReturnType<EnrolmentFunction> = enrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(totp.row as never);

    await verifyTotp({ code: totp.codeFromTheAuthenticatorApp() });

    expect(totpFindOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          _id: TOTP_ID.toString(),
          isVerified: true,
        }),
      }),
    );

    const query: JSONObject = (
      totpFindOneBy.mock.calls[0] as Array<{ query: JSONObject }>
    )[0]!.query;

    expect(query["userId"]).toBeDefined();
  });
});

describe("POST /verify-totp-auth — what it refuses", () => {
  it("refuses a wrong code", async () => {
    const user: User = await storedUser();
    const totp: ReturnType<EnrolmentFunction> = enrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(totp.row as never);

    await verifyTotp({ code: "000000" });

    expect(loginSucceeded()).toBe(false);
    expect(loginErrorMessage()).toBe("Invalid code.");
  });

  /*
   * The code alone must never be enough. If the password check were skipped on
   * this route, a stolen phone would be a full account takeover.
   */
  it("refuses a correct code when the password is wrong", async () => {
    const user: User = await storedUser();
    const totp: ReturnType<EnrolmentFunction> = enrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(totp.row as never);

    await verifyTotp({
      code: totp.codeFromTheAuthenticatorApp(),
      password: "not the password",
    });

    expect(loginSucceeded()).toBe(false);
    expect(totpFindOneBy).not.toHaveBeenCalled();
  });

  it("refuses a code aimed at an enrolment that does not exist", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(null as never);

    await verifyTotp({ code: "123456" });

    expect(loginSucceeded()).toBe(false);
    expect(loginErrorMessage()).toBe("Invalid two factor auth id.");
  });

  it("refuses a code that is valid for a different account's secret", async () => {
    const user: User = await storedUser();
    const theirs: ReturnType<EnrolmentFunction> = enrolment();
    const someoneElse: ReturnType<EnrolmentFunction> = enrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(theirs.row as never);

    await verifyTotp({ code: someoneElse.codeFromTheAuthenticatorApp() });

    expect(loginSucceeded()).toBe(false);
  });

  it.each(["", "12345", "abcdef"])(
    "refuses the malformed code %p",
    async (code: string) => {
      const user: User = await storedUser();
      const totp: ReturnType<EnrolmentFunction> = enrolment();

      jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
      totpFindOneBy.mockResolvedValue(totp.row as never);

      await verifyTotp({ code: code });

      expect(loginSucceeded()).toBe(false);
    },
  );
});

describe("POST /login — reaching the second factor at all", () => {
  /*
   * Password login for a 2FA account must stop and hand back the list of
   * factors rather than issuing a session. The list is what the browser needs
   * in order to ask for a code at all.
   */
  it("stops at the second factor instead of issuing a session", async () => {
    const user: User = await storedUser();
    const totp: ReturnType<EnrolmentFunction> = enrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindBy.mockResolvedValue([totp.row] as never);

    await invoke("/login", {
      data: {
        email: USER_EMAIL,
        password: { _type: "HashedString", value: PASSWORD },
      },
    });

    expect(createSession).not.toHaveBeenCalled();

    const miscData: JSONObject = (
      sendEntityResponse.mock.calls[0] as Array<unknown>
    )[4] as JSONObject;

    expect((miscData["miscData"] as JSONObject)["totpAuthList"]).toHaveLength(
      1,
    );
  });

  /*
   * The secret must not travel to the browser with that list. It is the whole
   * of the second factor; anyone who reads it can generate codes forever.
   */
  it("does not ship the TOTP secret to the browser with that list", async () => {
    const user: User = await storedUser();
    const totp: ReturnType<EnrolmentFunction> = enrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindBy.mockResolvedValue([totp.row] as never);

    await invoke("/login", {
      data: {
        email: USER_EMAIL,
        password: { _type: "HashedString", value: PASSWORD },
      },
    });

    expect(totpFindBy).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({ twoFactorSecret: true }),
      }),
    );
  });

  /*
   * The TOTP step is a continuation of a login whose captcha was already
   * solved, so re-running it here would fail a user who simply took longer
   * than the token's lifetime to read a code off their phone.
   */
  it("does not demand a fresh captcha at the second factor", async () => {
    const user: User = await storedUser();
    const totp: ReturnType<EnrolmentFunction> = enrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(totp.row as never);

    await verifyTotp({ code: totp.codeFromTheAuthenticatorApp() });

    expect(verifyCaptcha).not.toHaveBeenCalled();
  });

  /*
   * The body of this request carries a plaintext password and a live TOTP
   * code. Debug logging goes to stdout, the recent-log buffer and telemetry at
   * once, so the body must never appear in it.
   */
  it("never logs the submitted code or password", async () => {
    const user: User = await storedUser();
    const totp: ReturnType<EnrolmentFunction> = enrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(totp.row as never);

    const code: string = totp.codeFromTheAuthenticatorApp();

    await verifyTotp({ code: code });

    const logged: string = JSON.stringify(debugLog.mock.calls);

    expect(logged).not.toContain(code);
    expect(logged).not.toContain(PASSWORD);
    expect(logged).not.toContain(totp.row.twoFactorSecret);
  });
});
