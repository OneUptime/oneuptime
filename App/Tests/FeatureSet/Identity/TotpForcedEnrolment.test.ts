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
import UserWebAuthn from "Common/Models/DatabaseModels/UserWebAuthn";
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
 * ADMIN-MANDATED TWO FACTOR AUTH: the forced enrolment login flow.
 *
 * A master admin can now switch `enableTwoFactorAuth` on for somebody who has
 * never enrolled a factor. Before this change that combination was a dead end
 * ("Please contact your server admin to disable two factor auth") which made
 * the mandate unusable for exactly the people it was meant for. Now POST
 * /login answers such an account with a QR code, and POST
 * /verify-totp-enrolment finishes the setup and signs them in.
 *
 * That reshapes the login state machine, and the dangerous half of the reshape
 * is the first one: /login now returns a 200 with a body to a request that has
 * NOT completed authentication. If a refactor ever lets that branch fall
 * through to `finalizeUserLogin`, the product ships an endpoint where the
 * password alone mints a full-privilege session for an account whose whole
 * point is that the password is not enough. `CookieUtil.setUserCookie` writes
 * a JWT at path "/" that `UserAuthorization` validates statelessly, without
 * ever re-reading `enableTwoFactorAuth` -- so there is no later gate to catch
 * it. The tests below hold both halves down: a QR code is not an
 * authorization, and the only path to a session runs through a code that
 * verified against the secret the server issued.
 *
 * The second dangerous half is /verify-totp-enrolment itself. It writes a
 * *new* credential onto an account, authenticated by the password alone, so
 * without its two front guards (the account must be under a mandate, and it
 * must have no verified factor yet) a stolen password would let an attacker
 * bolt their own authenticator onto the victim's account and lock the real
 * owner out behind it.
 *
 * TotpAuth is NOT mocked. Codes come from TestingUtils/AuthenticatorApp, which
 * derives them from RFC 4226/6238 with Node crypto rather than from `otpauth`,
 * the library the server verifies with -- a test that generates its expected
 * codes with the same library proves only that the library agrees with itself.
 * Everything else the handler reaches (sessions, cookies, mail, tokens) is
 * mocked, because none of it is what is under test.
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

const refreshUserAllPermissions: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/AccessTokenService", () => {
  return {
    __esModule: true,
    default: {
      refreshUserAllPermissions: (...args: Array<unknown>): unknown => {
        return refreshUserAllPermissions(...args);
      },
    },
  };
});

const totpFindBy: jest.Mock = jest.fn();
const totpFindOneBy: jest.Mock = jest.fn();
const totpCreate: jest.Mock = jest.fn();
const totpUpdateOneById: jest.Mock = jest.fn();
const totpDeleteBy: jest.Mock = jest.fn();

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
      create: (...args: Array<unknown>): unknown => {
        return totpCreate(...args);
      },
      updateOneById: (...args: Array<unknown>): unknown => {
        return totpUpdateOneById(...args);
      },
      deleteBy: (...args: Array<unknown>): unknown => {
        return totpDeleteBy(...args);
      },
    },
  };
});

const webAuthnFindBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserWebAuthnService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (...args: Array<unknown>): unknown => {
        return webAuthnFindBy(...args);
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
const USER_EMAIL: string = "mandated.user@example.com";
const PENDING_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

const LOGIN_URI: string = "/login";
const ENROLMENT_URI: string = "/verify-totp-enrolment";

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
 * An account an admin has put under a two factor mandate, stored the way
 * Postgres would hand it back. `enableTwoFactorAuth` is the mandate; whether
 * anything is set up behind it is decided separately, by what the
 * UserTotpAuth/UserWebAuthn mocks return.
 */
type StoredUserFunction = (options?: {
  enableTwoFactorAuth?: boolean;
  isEmailVerified?: boolean;
}) => Promise<User>;

const storedUser: StoredUserFunction = async (options?: {
  enableTwoFactorAuth?: boolean;
  isEmailVerified?: boolean;
}): Promise<User> => {
  const salt: string = PasswordHash.generateSalt();

  const user: User = new User();
  user._id = ObjectID.generate().toString();
  user.email = new Email(USER_EMAIL);
  user.isEmailVerified = options?.isEmailVerified !== false;
  user.isMasterAdmin = false;
  user.enableTwoFactorAuth = options?.enableTwoFactorAuth !== false;
  user.passwordSalt = salt;
  user.password = new HashedString(
    await PasswordHash.hash({ plainValue: PASSWORD, salt: salt }),
    true,
  );

  return user;
};

/*
 * A pending (unverified) enrolment row, of the shape
 * UserTotpAuthService.onBeforeCreate produces: the server mints the secret and
 * the otpauth:// URL, and the row stays `isVerified: false` until a code
 * proves the user actually scanned it.
 *
 * `algorithm` selects what the QR code says, so the two readers below can
 * disagree the way real apps do: `codeFromTheAuthenticatorApp` honours the
 * URL's algorithm (1Password, Bitwarden), `codeFromAPhone` is Google
 * Authenticator, which ignores it and computes SHA1 regardless.
 */
type PendingEnrolment = {
  row: UserTotpAuth;
  secret: string;
  otpUrl: string;
  codeFromTheAuthenticatorApp: () => string;
  codeFromAPhone: () => string;
};

type PendingEnrolmentFunction = (options?: {
  algorithm?: string;
  id?: ObjectID;
  isVerified?: boolean;
}) => PendingEnrolment;

const pendingEnrolment: PendingEnrolmentFunction = (options?: {
  algorithm?: string;
  id?: ObjectID;
  isVerified?: boolean;
}): PendingEnrolment => {
  const secret: string = TotpAuth.generateSecret();

  const otpUrl: string = buildOtpauthUri({
    secret: secret,
    label: USER_EMAIL,
    algorithm: options?.algorithm || "SHA1",
  });

  const row: UserTotpAuth = new UserTotpAuth();
  row.id = options?.id || PENDING_ID;
  row.name = "Authenticator App";
  row.twoFactorSecret = secret;
  row.twoFactorOtpUrl = otpUrl;
  row.isVerified = options?.isVerified === true;

  return {
    row: row,
    secret: secret,
    otpUrl: otpUrl,
    codeFromTheAuthenticatorApp: (): string => {
      return conformingAppCode(otpUrl);
    },
    codeFromAPhone: (): string => {
      return googleAuthenticatorCode(otpUrl);
    },
  };
};

type PostLoginFunction = (options?: {
  password?: string;
}) => Promise<InvokeResult>;

const postLogin: PostLoginFunction = (options?: {
  password?: string;
}): Promise<InvokeResult> => {
  return invoke(LOGIN_URI, {
    data: {
      email: USER_EMAIL,
      password: {
        _type: "HashedString",
        value: options?.password === undefined ? PASSWORD : options.password,
      },
    },
  });
};

/*
 * The shape the login page posts to finish a forced enrolment. Everything --
 * including the credentials, because this stage holds no session -- is nested
 * under `data`. See App/FeatureSet/Accounts/src/Pages/Login.tsx.
 *
 * `omitCode` / `omitTwoFactorAuthId` drop the key entirely rather than sending
 * an empty string, which is what a hand-rolled request would do and what the
 * CredentialGuard tests below need.
 */
type PostEnrolmentInput = {
  code?: string;
  twoFactorAuthId?: string;
  password?: string;
  omitCode?: boolean;
  omitTwoFactorAuthId?: boolean;
};

type PostEnrolmentFunction = (
  input: PostEnrolmentInput,
) => Promise<InvokeResult>;

const postEnrolment: PostEnrolmentFunction = (
  input: PostEnrolmentInput,
): Promise<InvokeResult> => {
  const data: JSONObject = {
    email: USER_EMAIL,
    password: {
      _type: "HashedString",
      value: input.password === undefined ? PASSWORD : input.password,
    },
  };

  if (!input.omitCode) {
    data["code"] = input.code === undefined ? "000000" : input.code;
  }

  if (!input.omitTwoFactorAuthId) {
    data["twoFactorAuthId"] =
      input.twoFactorAuthId === undefined
        ? PENDING_ID.toString()
        : input.twoFactorAuthId;
  }

  return invoke(ENROLMENT_URI, { data: data });
};

/*
 * "No session was issued" is the single most important assertion in this file,
 * and it is two separate facts: no row in the session table, and no cookie on
 * the response. Either one alone is an authorization -- the cookie is a
 * self-contained JWT that `UserAuthorization` accepts without consulting the
 * session table at all -- so both are checked, and both are named when they
 * fail.
 */
type SessionViolationsFunction = () => Array<string>;

const sessionViolations: SessionViolationsFunction = (): Array<string> => {
  const violations: Array<string> = [];

  if (createSession.mock.calls.length > 0) {
    violations.push("UserSessionService.createSession was called");
  }

  if (setUserCookie.mock.calls.length > 0) {
    violations.push("CookieUtil.setUserCookie was called");
  }

  return violations;
};

type LoginSucceededFunction = () => boolean;

const loginSucceeded: LoginSucceededFunction = (): boolean => {
  return (
    sendEntityResponse.mock.calls.length > 0 &&
    sendErrorResponse.mock.calls.length === 0
  );
};

/*
 * A refusal reaches the caller down one of two roads. Most are an explicit
 * `Response.sendErrorResponse`, but anything CredentialGuard throws travels up
 * through the handler's `catch` into `next(err)` instead. Both are refusals as
 * far as the browser is concerned, so both are read here -- a predicate that
 * only knew about one of them would report "no error" for the other and let a
 * broken guard look like a pass.
 */
type RefusalMessageFunction = (result: InvokeResult) => string | undefined;

const refusalMessage: RefusalMessageFunction = (
  result: InvokeResult,
): string | undefined => {
  const call: Array<unknown> | undefined = sendErrorResponse.mock.calls[0] as
    | Array<unknown>
    | undefined;

  if (call) {
    return (call[2] as Exception | undefined)?.message;
  }

  return result.nextError ? result.nextError.message : undefined;
};

/*
 * The `miscData` bag `Response.sendEntityResponse` was handed -- argument 5 of
 * (req, res, item, type, miscDataWrapper), unwrapped one level. Everything the
 * login page reads out of a forced-enrolment response lives in here.
 */
type ResponseMiscDataFunction = () => JSONObject;

const responseMiscData: ResponseMiscDataFunction = (): JSONObject => {
  const call: Array<unknown> = sendEntityResponse.mock
    .calls[0] as Array<unknown>;

  return (call[4] as JSONObject)["miscData"] as JSONObject;
};

type ResponseModelFunction = () => JSONObject;

const responseModel: ResponseModelFunction = (): JSONObject => {
  const call: Array<unknown> = sendEntityResponse.mock
    .calls[0] as Array<unknown>;

  return call[2] as unknown as JSONObject;
};

beforeEach(() => {
  jest.clearAllMocks();

  createSession.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
  } as never);

  /*
   * The default world: an account under a mandate with nothing set up behind
   * it, and no pending enrolment lying around yet.
   */
  totpFindBy.mockResolvedValue([] as never);
  webAuthnFindBy.mockResolvedValue([] as never);
  totpFindOneBy.mockResolvedValue(null as never);
  totpCreate.mockResolvedValue(pendingEnrolment().row as never);
  totpUpdateOneById.mockResolvedValue(1 as never);
  totpDeleteBy.mockResolvedValue(1 as never);
  refreshUserAllPermissions.mockResolvedValue(undefined as never);

  jest.spyOn(UserService, "updateOneById").mockResolvedValue(1 as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /login when an admin requires 2FA and nothing is set up", () => {
  /*
   * THE SECURITY CORE. The account has a mandate and no factor behind it, so
   * the password is explicitly not sufficient to log in -- and yet this branch
   * answers 200 with a body. The body is a QR code, which is not a credential:
   * it is shown to somebody who has already proved the password and a verified
   * email, and who could therefore enrol anyway.
   *
   * What must never happen is the branch drifting into `finalizeUserLogin`. If
   * it does, the mandate becomes a no-op that is invisible from the outside:
   * the login page would keep rendering its enrolment screen while the same
   * response quietly carried a full-privilege cookie that answers curl.
   */
  it("issues no session and sets no cookie -- a QR code is not an authorization", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

    await postLogin();

    expect(sessionViolations()).toEqual([]);
  });

  it("tells the login page that enrolment is required", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

    await postLogin();

    expect(responseMiscData()["twoFactorEnrolmentRequired"]).toBe(true);
  });

  /*
   * The two things the enrolment screen cannot be drawn without: the URL a QR
   * code is rendered from, and the id to quote back with the first code. A
   * response missing either is a blank screen the user cannot get past.
   */
  it("carries the pending enrolment's id and otpauth URL", async () => {
    const user: User = await storedUser();
    const enrolment: PendingEnrolment = pendingEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpCreate.mockResolvedValue(enrolment.row as never);

    await postLogin();

    const miscData: JSONObject = responseMiscData();

    expect(miscData["twoFactorAuthId"]).toBe(PENDING_ID.toString());
    expect(miscData["twoFactorOtpUrl"]).toBe(enrolment.otpUrl);
  });

  /*
   * The raw base32 secret is never a separate field in the response, and the
   * reuse lookup never even selects the column.
   *
   * The otpauth:// URL does of course embed the same bytes -- a QR code has to
   * contain the secret or it cannot be scanned -- so the assertion here is
   * precise about which appearance is legitimate: blank out the URL, and the
   * secret must not survive anywhere else in the payload. A response that also
   * shipped `twoFactorSecret` as a plain field would put a bare, copy-pasteable
   * second factor in the browser's network tab for no additional capability.
   */
  it("does not ship the raw base32 secret alongside the QR URL", async () => {
    const user: User = await storedUser();
    const enrolment: PendingEnrolment = pendingEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpCreate.mockResolvedValue(enrolment.row as never);

    await postLogin();

    const miscData: JSONObject = responseMiscData();

    const violations: Array<string> = [];

    if (Object.keys(miscData).includes("twoFactorSecret")) {
      violations.push("miscData carried a twoFactorSecret field");
    }

    const withoutTheQrUrl: JSONObject = {
      ...miscData,
      twoFactorOtpUrl: "",
    };

    if (JSON.stringify(withoutTheQrUrl).includes(enrolment.secret)) {
      violations.push("the secret appeared outside the otpauth URL");
    }

    if (JSON.stringify(responseModel()).includes(enrolment.secret)) {
      violations.push("the secret appeared on the serialized user model");
    }

    expect(violations).toEqual([]);
  });

  /*
   * Both halves of the reuse lookup's select, because each is load-bearing in
   * the opposite direction and only one of them is a secret.
   *
   * `twoFactorSecret` must NOT be selected: this lookup exists to draw a QR
   * code, and the URL alone is enough for that.
   *
   * `twoFactorOtpUrl` MUST be selected, and asserting that is not decoration:
   * `getOrCreatePendingTotpEnrolment` only returns the existing row when
   * `existingPendingEnrolment.twoFactorOtpUrl` is truthy, so a select that
   * stopped carrying the column would silently turn reuse back into
   * always-create -- a brand new secret at every page load, invalidating the
   * QR code the user has already scanned into their phone. Nothing else in
   * this file can see that: `totpFindOneBy` is a mock that returns a fully
   * populated row no matter what columns were asked for, so "reuses an
   * existing unverified enrolment" below would stay green throughout.
   */
  it("selects the QR URL but never the twoFactorSecret column when looking for a reusable enrolment", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

    await postLogin();

    expect(totpFindOneBy).toHaveBeenCalledTimes(1);

    const select: JSONObject = (
      totpFindOneBy.mock.calls[0] as Array<{ select: JSONObject }>
    )[0]!.select;

    const violations: Array<string> = [];

    if (!select) {
      violations.push("the reuse lookup passed no select at all");
    } else {
      if (select["twoFactorSecret"]) {
        violations.push("the reuse lookup selected twoFactorSecret");
      }

      if (select["twoFactorOtpUrl"] !== true) {
        violations.push(
          "the reuse lookup did not select twoFactorOtpUrl -- reuse degrades to always-create",
        );
      }

      if (select["_id"] !== true) {
        violations.push(
          "the reuse lookup did not select _id -- the row cannot be quoted back",
        );
      }
    }

    expect(violations).toEqual([]);
  });

  /*
   * `sendEntityResponse` serializes whatever happens to be set on the model,
   * with no regard for read permissions -- and this handler deliberately
   * SELECTS `password` and `passwordSalt` so it can verify the login. Without
   * the scrub before the response, the enrolment reply would hand the browser
   * the account's password hash and its salt, which is an offline cracking kit
   * for the very account the mandate is trying to protect.
   */
  it("scrubs password and passwordSalt off the model it responds with", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

    await postLogin();

    const model: JSONObject = responseModel();

    const violations: Array<string> = [];

    if (model["password"] !== undefined) {
      violations.push("password survived onto the response model");
    }

    if (model["passwordSalt"] !== undefined) {
      violations.push("passwordSalt survived onto the response model");
    }

    expect(violations).toEqual([]);
  });

  /*
   * The regression this whole feature exists to undo. This case used to answer
   * "Please contact your server admin to disable two factor auth", which meant
   * an admin could only mandate two factor auth from users who had already
   * volunteered for it -- and a user whose device was reset had no way back in
   * at all. It must be a success response now, not an error.
   */
  it("no longer dead-ends with a contact-your-admin error", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

    await postLogin();

    expect(sendErrorResponse).not.toHaveBeenCalled();
    expect(sendEntityResponse).toHaveBeenCalledTimes(1);
  });

  /*
   * `UserTotpAuthService.onBeforeCreate` reads the owner out of the PROPS, not
   * out of the data, and refuses the create without it -- so `props.userId` is
   * load-bearing, not decoration. And `UserTotpAuth.name` is NOT NULL while
   * this user never gets to type one (they are being marched through setup,
   * not browsing a settings page), so a missing name is a database error at
   * the single worst moment: the first login after an admin locked the account
   * behind a factor it does not have.
   */
  it("creates the pending row with an owner in props and a non-empty name", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

    await postLogin();

    expect(totpCreate).toHaveBeenCalledTimes(1);

    const call: { data: UserTotpAuth; props: JSONObject } = (
      totpCreate.mock.calls[0] as Array<{
        data: UserTotpAuth;
        props: JSONObject;
      }>
    )[0]!;

    const violations: Array<string> = [];

    if (call.props["isRoot"] !== true) {
      violations.push("props.isRoot was not true");
    }

    if (!call.props["userId"]) {
      violations.push("props.userId was missing");
    } else if (String(call.props["userId"]) !== user.id!.toString()) {
      violations.push("props.userId was not the logged-in user");
    }

    if (!call.data.name || call.data.name.trim().length === 0) {
      violations.push("data.name was empty -- UserTotpAuth.name is NOT NULL");
    }

    expect(violations).toEqual([]);
  });

  /*
   * Reuse, not always-create. The user scans the QR code with their phone and
   * then goes back to the browser; anything that reloads the login page in
   * between -- a refresh, a back button, a second tab -- must not invalidate
   * the code their authenticator is already showing. Always-create would also
   * leave a trail of orphaned secrets behind a user who opened the page five
   * times.
   */
  it("reuses an existing unverified enrolment instead of minting a new one", async () => {
    const user: User = await storedUser();

    const alreadyScanned: PendingEnrolment = pendingEnrolment({
      id: new ObjectID("88888888-8888-4888-8888-888888888888"),
    });

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(alreadyScanned.row as never);

    await postLogin();

    const miscData: JSONObject = responseMiscData();

    expect(totpCreate).not.toHaveBeenCalled();
    expect(miscData["twoFactorOtpUrl"]).toBe(alreadyScanned.otpUrl);
    expect(miscData["twoFactorAuthId"]).toBe(alreadyScanned.row.id!.toString());
  });

  /*
   * The reuse lookup is scoped to `isVerified: false` and to this user. Drop
   * the isVerified predicate and the lookup would happily return a VERIFIED
   * factor and hand it back as a "pending enrolment" -- meaning the login page
   * would draw a QR code for a credential the user already relies on, and
   * /verify-totp-enrolment (which requires the row to be unverified) would
   * then reject every code they typed.
   */
  it("scopes the reuse lookup to this user's unverified rows", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

    await postLogin();

    const query: JSONObject = (
      totpFindOneBy.mock.calls[0] as Array<{ query: JSONObject }>
    )[0]!.query;

    const violations: Array<string> = [];

    if (query["isVerified"] !== false) {
      violations.push("the reuse lookup did not require isVerified: false");
    }

    if (!query["userId"]) {
      violations.push("the reuse lookup was not scoped to a user");
    } else if (String(query["userId"]) !== user.id!.toString()) {
      violations.push("the reuse lookup was scoped to the wrong user");
    }

    expect(violations).toEqual([]);
  });

  /*
   * The enrolment branch sits BEHIND the password check, and has to stay
   * there. In front of it, /login would mint and hand out a QR code to anybody
   * who could name an email address -- and since the row it creates is the one
   * /verify-totp-enrolment later accepts, an attacker could pre-seed a secret
   * of their own and wait for the real user to be forced through enrolment.
   */
  it("never reaches enrolment when the password is wrong", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

    const result: InvokeResult = await postLogin({
      password: "not the password",
    });

    const violations: Array<string> = sessionViolations();

    if (totpCreate.mock.calls.length > 0) {
      violations.push("a pending enrolment was created for a wrong password");
    }

    expect(violations).toEqual([]);
    expect(refusalMessage(result)).toBe(
      "Invalid login: Email or password does not match.",
    );
  });

  /*
   * An unverified email is checked before the password, and before this too.
   * Someone who signed up with an address they do not own must not be able to
   * make the server write credential rows against it.
   */
  it("never reaches enrolment when the email is not verified", async () => {
    const user: User = await storedUser({ isEmailVerified: false });

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

    const result: InvokeResult = await postLogin();

    expect(totpCreate).not.toHaveBeenCalled();
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(refusalMessage(result)).toContain("Email is not verified.");
  });

  /*
   * No mandate, no enrolment. An account that has simply never turned two
   * factor auth on gets an ordinary session -- the forced-enrolment branch
   * must not leak out and start conscripting every user on the instance.
   */
  it("gives an ordinary login to an account with no mandate", async () => {
    const user: User = await storedUser({ enableTwoFactorAuth: false });

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

    await postLogin();

    expect(loginSucceeded()).toBe(true);
    expect(totpCreate).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(responseMiscData()["twoFactorEnrolmentRequired"]).toBeUndefined();
  });

  /*
   * The pre-existing path must be untouched: a user who already has a verified
   * authenticator gets the challenge list, not a fresh QR code. Getting this
   * backwards would offer every 2FA user a brand new secret at every login --
   * an enrolment endpoint that overwrites the factor it was supposed to
   * verify.
   */
  it("challenges a user who already has a verified TOTP instead of enrolling them", async () => {
    const user: User = await storedUser();
    const existing: PendingEnrolment = pendingEnrolment({ isVerified: true });

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindBy.mockResolvedValue([existing.row] as never);

    await postLogin();

    const miscData: JSONObject = responseMiscData();

    expect(miscData["totpAuthList"]).toHaveLength(1);
    expect(miscData["twoFactorEnrolmentRequired"]).toBeUndefined();
    expect(totpCreate).not.toHaveBeenCalled();
    expect(sessionViolations()).toEqual([]);

    /*
     * "Already has a factor" means a VERIFIED one, and that word lives in the
     * query rather than in anything the mocks can express: `totpFindBy` and
     * `webAuthnFindBy` here hand back whatever they were told to, whatever was
     * asked for. So the predicate is read off the call instead.
     *
     * Drop `isVerified: true` and a half-finished enrolment -- a row this very
     * feature creates, on purpose, for users who have nothing set up -- starts
     * counting as an existing factor. Forced enrolment then becomes
     * unfinishable for everybody: /login writes the pending row, and the
     * /verify-totp-enrolment that follows sees it in this list and answers
     * "Two factor authentication is already set up for this account."
     */
    const violations: Array<string> = [];

    const totpQuery: JSONObject = (
      totpFindBy.mock.calls[0] as Array<{ query: JSONObject }>
    )[0]!.query;

    const webAuthnQuery: JSONObject = (
      webAuthnFindBy.mock.calls[0] as Array<{ query: JSONObject }>
    )[0]!.query;

    if (totpQuery["isVerified"] !== true) {
      violations.push("the TOTP lookup did not require isVerified: true");
    }

    if (String(totpQuery["userId"]) !== user.id!.toString()) {
      violations.push("the TOTP lookup was not scoped to this user");
    }

    if (webAuthnQuery["isVerified"] !== true) {
      violations.push("the WebAuthn lookup did not require isVerified: true");
    }

    if (String(webAuthnQuery["userId"]) !== user.id!.toString()) {
      violations.push("the WebAuthn lookup was not scoped to this user");
    }

    expect(violations).toEqual([]);
  });

  /*
   * A guard for the readers above. `responseMiscData` digs argument 5 out of a
   * mock call and unwraps one level; if the handler ever stopped passing a
   * miscData bag, every assertion phrased as "field X is undefined" would go
   * on passing while saying nothing. This test fails loudly instead.
   */
  it("really does hand sendEntityResponse a miscData bag to read", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

    await postLogin();

    expect(sendEntityResponse).toHaveBeenCalledTimes(1);

    const call: Array<unknown> = sendEntityResponse.mock
      .calls[0] as Array<unknown>;

    expect(call).toHaveLength(5);
    expect((call[4] as JSONObject)["miscData"]).toBeDefined();
    expect(Object.keys(responseMiscData()).length).toBeGreaterThan(0);
  });

  /*
   * The password is in this request body and the otpauth URL (secret and all)
   * is in the response. DEBUG output goes to stdout, the recent-log buffer and
   * telemetry at once, so a single `logger.debug(req.body)` added for
   * convenience would publish both.
   */
  it("logs neither the password nor the secret it just issued", async () => {
    const user: User = await storedUser();
    const enrolment: PendingEnrolment = pendingEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpCreate.mockResolvedValue(enrolment.row as never);

    await postLogin();

    const logged: string = JSON.stringify(debugLog.mock.calls);

    const violations: Array<string> = [];

    if (logged.includes(PASSWORD)) {
      violations.push("the password was written to the debug log");
    }

    if (logged.includes(enrolment.secret)) {
      violations.push("the TOTP secret was written to the debug log");
    }

    if (logged.includes("otpauth://")) {
      violations.push("the otpauth URL was written to the debug log");
    }

    expect(violations).toEqual([]);
  });

  /*
   * A haystack guard for the assertion directly above, and it is a DIFFERENT
   * haystack from the one the enrolment describe guards. Those are
   * "needle is not in this string" checks, which pass trivially against an
   * empty string: unwire the Logger mock, or stop logging on the password
   * stage, and the test above goes green having searched nothing at all.
   *
   * The sibling guard at the end of this file only proves the
   * "totp-enrolment" stage is logged, which a plain password login never
   * emits -- so it cannot stand in for this one. The handler deliberately
   * logs the STAGE instead of the body, which is exactly why there is always
   * something here to search.
   */
  it("does log the password stage, so the no-secrets-in-logs assertion has a haystack", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

    await postLogin();

    expect(debugLog.mock.calls.length).toBeGreaterThan(0);
    expect(JSON.stringify(debugLog.mock.calls)).toContain("stage: password");
  });
});

describe("POST /verify-totp-enrolment", () => {
  it("is registered on the router", () => {
    const registered: Array<string> = mockRouter.routes.map(
      (route: { method: string; uri: string }): string => {
        return `${route.method} ${route.uri}`;
      },
    );

    expect(registered).toContain(`POST ${ENROLMENT_URI}`);
  });

  /*
   * The other half of the security core: this is the ONLY way an account under
   * a mandate with nothing set up reaches `finalizeUserLogin`, and it gets
   * there only once a code has verified against the secret the server issued.
   * The response carries the tokens because mobile clients read them out of
   * the body rather than out of the cookie.
   */
  it("issues the session once a correct code proves the enrolment", async () => {
    const user: User = await storedUser();
    const enrolment: PendingEnrolment = pendingEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);

    await postEnrolment({ code: enrolment.codeFromTheAuthenticatorApp() });

    expect(loginSucceeded()).toBe(true);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(setUserCookie).toHaveBeenCalledTimes(1);

    const miscData: JSONObject = responseMiscData();

    const violations: Array<string> = [];

    for (const field of [
      "accessToken",
      "refreshToken",
      "refreshTokenExpiresAt",
    ]) {
      if (!miscData[field]) {
        violations.push(`the response did not carry ${field}`);
      }
    }

    expect(violations).toEqual([]);
  });

  /*
   * Order matters, not just occurrence. The row must be flipped to verified
   * BEFORE the session is minted, because the write is the thing that makes
   * the mandate satisfiable at all: if the session were issued first and the
   * update then failed, the user would be logged in exactly once and locked
   * out of every subsequent login, with a factor the server still considers
   * pending.
   */
  it("marks the enrolment verified before it mints the session", async () => {
    const user: User = await storedUser();
    const enrolment: PendingEnrolment = pendingEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);

    await postEnrolment({ code: enrolment.codeFromTheAuthenticatorApp() });

    expect(totpUpdateOneById).toHaveBeenCalledTimes(1);

    const update: { id: ObjectID; data: JSONObject } = (
      totpUpdateOneById.mock.calls[0] as Array<{
        id: ObjectID;
        data: JSONObject;
      }>
    )[0]!;

    expect(update.data["isVerified"]).toBe(true);
    expect(update.id.toString()).toBe(enrolment.row.id!.toString());

    expect(totpUpdateOneById.mock.invocationCallOrder[0]!).toBeLessThan(
      createSession.mock.invocationCallOrder[0]!,
    );
  });

  it("refuses a wrong code and issues no session", async () => {
    const user: User = await storedUser();
    const enrolment: PendingEnrolment = pendingEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);

    const result: InvokeResult = await postEnrolment({ code: "000000" });

    expect(sessionViolations()).toEqual([]);
    expect(refusalMessage(result)).toBe("Invalid code.");
    expect(totpUpdateOneById).not.toHaveBeenCalled();
  });

  /*
   * Junk of every shape must fall out without a session. The empty and
   * whitespace-only cases are refused by CredentialGuard before any query runs
   * (an undefined-shaped predicate would be DROPPED by TypeORM rather than
   * matching nothing); the rest reach TotpAuth, which rejects anything that is
   * not exactly six digits after non-digits are stripped.
   */
  it.each(["", "12345", "1234567", "abcdef", "   "])(
    "refuses the malformed code %p",
    async (code: string) => {
      const user: User = await storedUser();
      const enrolment: PendingEnrolment = pendingEnrolment();

      jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
      totpFindOneBy.mockResolvedValue(enrolment.row as never);

      const result: InvokeResult = await postEnrolment({ code: code });

      const violations: Array<string> = sessionViolations();

      if (totpUpdateOneById.mock.calls.length > 0) {
        violations.push("the enrolment was marked verified anyway");
      }

      if (!refusalMessage(result)) {
        violations.push("the request was not refused at all");
      }

      expect(violations).toEqual([]);
    },
  );

  /*
   * The QR code the server draws says SHA1 today, but the verifier must keep
   * accepting what a PHONE computes rather than what the URL claims: Google
   * Authenticator and Microsoft Authenticator parse the otpauth:// URI, ignore
   * its `algorithm` parameter and compute SHA1 regardless. This test hands the
   * user a SHA256 URI and enrols them with the SHA1 code their phone shows --
   * which is precisely the state issue #3275 left every affected account in.
   * If it ever fails, forced enrolment becomes impossible to complete on the
   * two most widely installed authenticator apps.
   */
  it("accepts the code a phone shows for a QR that still says SHA256", async () => {
    const user: User = await storedUser();

    const enrolment: PendingEnrolment = pendingEnrolment({
      algorithm: "SHA256",
    });

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);

    await postEnrolment({ code: enrolment.codeFromAPhone() });

    expect(loginSucceeded()).toBe(true);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  /*
   * Google Authenticator renders a code as "123 456" and both mobile
   * clipboards keep the space. Rejecting the paste would be a self-inflicted
   * "Invalid code" for a user who supplied exactly the right secret material
   * -- during a setup they were forced into and cannot skip.
   */
  it("accepts the code with the space a phone's clipboard leaves in", async () => {
    const user: User = await storedUser();
    const enrolment: PendingEnrolment = pendingEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);

    const code: string = enrolment.codeFromTheAuthenticatorApp();

    await postEnrolment({ code: `${code.slice(0, 3)} ${code.slice(3)}` });

    expect(loginSucceeded()).toBe(true);
  });

  /*
   * The code alone is never enough. This stage holds no session, so the
   * password in the body IS the authentication for it -- skip that check and
   * anybody who could reach the endpoint could enrol a factor onto any
   * mandated account by naming its email address.
   */
  it("refuses a correct code submitted with the wrong password", async () => {
    const user: User = await storedUser();
    const enrolment: PendingEnrolment = pendingEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);

    const result: InvokeResult = await postEnrolment({
      code: enrolment.codeFromTheAuthenticatorApp(),
      password: "not the password",
    });

    expect(sessionViolations()).toEqual([]);
    expect(totpFindOneBy).not.toHaveBeenCalled();
    expect(totpUpdateOneById).not.toHaveBeenCalled();
    expect(refusalMessage(result)).toBe(
      "Invalid login: Email or password does not match.",
    );
  });

  /*
   * The lookup is scoped by `userId`, so an id belonging to somebody else's
   * pending enrolment matches nothing. Without that predicate the caller could
   * point this endpoint at another account's row and have the server mark THAT
   * row verified -- completing a stranger's enrolment with a secret of the
   * attacker's choosing.
   */
  it("refuses a twoFactorAuthId that belongs to a different user", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(null as never);

    const result: InvokeResult = await postEnrolment({
      code: "123456",
      twoFactorAuthId: "99999999-9999-4999-8999-999999999999",
    });

    expect(sessionViolations()).toEqual([]);
    expect(refusalMessage(result)).toBe("Invalid two factor auth id.");

    const query: JSONObject = (
      totpFindOneBy.mock.calls[0] as Array<{ query: JSONObject }>
    )[0]!.query;

    expect(query["_id"]).toBe("99999999-9999-4999-8999-999999999999");
    expect(String(query["userId"])).toBe(user.id!.toString());
  });

  /*
   * A body with no `twoFactorAuthId` must be refused OUTRIGHT rather than
   * falling back to "whichever pending enrolment this account happens to
   * have".
   *
   * That fallback is not hypothetical, it is the default behaviour of the
   * stack: `BaseModel.fromJSON` yields `undefined` for an absent key without
   * complaining, `QueryUtil.serializeQuery` has no undefined handling, and
   * TypeORM's `invalidWhereValuesBehavior.undefined` defaults to "ignore" --
   * so the predicate is DROPPED rather than matching nothing. `_findBy` then
   * sorts `createdAt` descending with limit 1, which turns
   * `findOneBy({ _id: undefined })` from "the row with this id" into "the
   * newest row in the table". CredentialGuard.assertAllPresent is what stops
   * that; see App/FeatureSet/Identity/Utils/CredentialGuard.ts.
   */
  it("refuses a missing twoFactorAuthId instead of matching the newest row", async () => {
    const user: User = await storedUser();
    const enrolment: PendingEnrolment = pendingEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);

    const result: InvokeResult = await postEnrolment({
      code: enrolment.codeFromTheAuthenticatorApp(),
      omitTwoFactorAuthId: true,
    });

    const violations: Array<string> = sessionViolations();

    if (totpFindOneBy.mock.calls.length > 0) {
      violations.push("a lookup ran with no id predicate at all");
    }

    if (totpUpdateOneById.mock.calls.length > 0) {
      violations.push("an enrolment was marked verified with no id supplied");
    }

    expect(violations).toEqual([]);
    expect(refusalMessage(result)).toBe("Two factor auth id is required.");
  });

  it("refuses a missing code before any verification is attempted", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

    const result: InvokeResult = await postEnrolment({ omitCode: true });

    expect(sessionViolations()).toEqual([]);
    expect(totpFindOneBy).not.toHaveBeenCalled();
    expect(refusalMessage(result)).toBe("Code is required.");
  });

  /*
   * The lookup requires `isVerified: false`, so an id that names an
   * ALREADY-VERIFIED factor matches nothing. Drop that predicate and this
   * endpoint becomes a way to re-run the enrolment write against a live
   * credential; it is also what keeps /verify-totp-enrolment and
   * /verify-totp-auth from being interchangeable, since the latter requires
   * exactly the opposite.
   */
  it("refuses an id that names an already-verified factor", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

    /*
     * Nothing matches, because the row the caller named is verified and the
     * query asks for unverified rows only.
     */
    totpFindOneBy.mockResolvedValue(null as never);

    const result: InvokeResult = await postEnrolment({ code: "123456" });

    expect(refusalMessage(result)).toBe("Invalid two factor auth id.");
    expect(sessionViolations()).toEqual([]);

    const query: JSONObject = (
      totpFindOneBy.mock.calls[0] as Array<{ query: JSONObject }>
    )[0]!.query;

    expect(query["isVerified"]).toBe(false);
  });

  /*
   * PRIVILEGE ESCALATION GUARD.
   *
   * Enrolment is only ever the completion of a requirement the SERVER imposed.
   * Without this refusal, anybody holding a stolen password could bolt their
   * own authenticator onto an account that never asked for two factor auth --
   * and since the account's `enableTwoFactorAuth` would then be the only thing
   * standing between the owner and their own login, the real owner ends up
   * locked out behind a factor they have never seen. Nothing may be written
   * and no session may be issued.
   */
  it("refuses to enrol an account that is not under a mandate", async () => {
    const user: User = await storedUser({ enableTwoFactorAuth: false });
    const enrolment: PendingEnrolment = pendingEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);

    const result: InvokeResult = await postEnrolment({
      code: enrolment.codeFromTheAuthenticatorApp(),
    });

    const violations: Array<string> = sessionViolations();

    if (totpUpdateOneById.mock.calls.length > 0) {
      violations.push("a factor was marked verified on an unmandated account");
    }

    if (totpCreate.mock.calls.length > 0) {
      violations.push("a factor was created on an unmandated account");
    }

    expect(violations).toEqual([]);
    expect(refusalMessage(result)).toBe(
      "Two factor authentication is not required for this account.",
    );
  });

  /*
   * An account that already has a working factor belongs on
   * /verify-totp-auth. Allowing enrolment here would mean a password alone
   * could add a SECOND factor and then satisfy the challenge with it, stepping
   * straight around the first one -- the second factor stops being a second
   * factor.
   */
  it("refuses when a verified TOTP already exists", async () => {
    const user: User = await storedUser();
    const enrolment: PendingEnrolment = pendingEnrolment();
    const existing: PendingEnrolment = pendingEnrolment({ isVerified: true });

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindBy.mockResolvedValue([existing.row] as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);

    const result: InvokeResult = await postEnrolment({
      code: enrolment.codeFromTheAuthenticatorApp(),
    });

    expect(sessionViolations()).toEqual([]);
    expect(totpUpdateOneById).not.toHaveBeenCalled();
    expect(refusalMessage(result)).toBe(
      "Two factor authentication is already set up for this account.",
    );
  });

  /*
   * The same refusal must fire for a security key. The check has to consult
   * BOTH lists: a user whose only factor is WebAuthn has a perfectly working
   * second factor, and a check that only looked at the TOTP table would see
   * "nothing set up" and let a password alone graft a new authenticator on
   * beside it.
   */
  it("refuses when a verified WebAuthn credential already exists", async () => {
    const user: User = await storedUser();
    const enrolment: PendingEnrolment = pendingEnrolment();

    const securityKey: UserWebAuthn = new UserWebAuthn();
    securityKey.id = new ObjectID("55555555-5555-4555-8555-555555555555");
    securityKey.name = "YubiKey";
    securityKey.isVerified = true;

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindBy.mockResolvedValue([] as never);
    webAuthnFindBy.mockResolvedValue([securityKey] as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);

    const result: InvokeResult = await postEnrolment({
      code: enrolment.codeFromTheAuthenticatorApp(),
    });

    expect(sessionViolations()).toEqual([]);
    expect(totpUpdateOneById).not.toHaveBeenCalled();
    expect(refusalMessage(result)).toBe(
      "Two factor authentication is already set up for this account.",
    );
  });

  /*
   * Every OTHER half-finished enrolment is swept once one succeeds. Each is an
   * abandoned scan still holding a live secret for this account, and a later
   * admin-driven reset that handed one of them back would give the user a
   * stale QR code that no longer matches anything on their phone.
   */
  it("sweeps this user's other pending enrolments after success", async () => {
    const user: User = await storedUser();
    const enrolment: PendingEnrolment = pendingEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);

    await postEnrolment({ code: enrolment.codeFromTheAuthenticatorApp() });

    expect(totpDeleteBy).toHaveBeenCalledTimes(1);

    const query: JSONObject = (
      totpDeleteBy.mock.calls[0] as Array<{ query: JSONObject }>
    )[0]!.query;

    const violations: Array<string> = [];

    if (query["isVerified"] !== false) {
      violations.push("the sweep was not restricted to unverified rows");
    }

    if (String(query["userId"]) !== user.id!.toString()) {
      violations.push("the sweep was not restricted to this user");
    }

    expect(violations).toEqual([]);
  });

  /*
   * No captcha at this stage. hCaptcha tokens are single use, so the token the
   * password step already spent cannot be replayed here -- demanding a fresh
   * one would mean rendering a second challenge in the middle of an
   * authentication the user has almost finished, and would fail anyone who
   * took longer than the token's lifetime to scan a QR code with their phone.
   */
  it("does not demand a captcha to finish the enrolment", async () => {
    const user: User = await storedUser();
    const enrolment: PendingEnrolment = pendingEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);

    await postEnrolment({ code: enrolment.codeFromTheAuthenticatorApp() });

    expect(verifyCaptcha).not.toHaveBeenCalled();
  });

  /*
   * This body carries a plaintext password AND a live TOTP code, and the row
   * it reads carries the secret both are derived from. DEBUG output fans out
   * to stdout, the recent-log buffer and telemetry at once, so a body-dump
   * added here would publish a permanently valid second factor next to the
   * password it is supposed to be independent of.
   */
  it("never logs the submitted code, the password, or the secret", async () => {
    const user: User = await storedUser();
    const enrolment: PendingEnrolment = pendingEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);

    const code: string = enrolment.codeFromTheAuthenticatorApp();

    await postEnrolment({ code: code });

    const logged: string = JSON.stringify(debugLog.mock.calls);

    const violations: Array<string> = [];

    if (logged.includes(code)) {
      violations.push("the submitted code was written to the debug log");
    }

    if (logged.includes(PASSWORD)) {
      violations.push("the password was written to the debug log");
    }

    if (logged.includes(enrolment.secret)) {
      violations.push("the TOTP secret was written to the debug log");
    }

    if (logged.includes("otpauth://")) {
      violations.push("the otpauth URL was written to the debug log");
    }

    expect(violations).toEqual([]);
  });

  /*
   * A guard for the log assertions above. They are "haystack does not contain
   * needle" checks, which pass trivially against an empty haystack -- if
   * `logger.debug` were dropped from this handler, or the Logger mock stopped
   * being wired up, those tests would go green while checking nothing. The
   * handler does log the login STAGE (deliberately, instead of the body), so
   * there is always something to search.
   */
  it("does log the stage, so the no-secrets-in-logs assertions have a haystack", async () => {
    const user: User = await storedUser();
    const enrolment: PendingEnrolment = pendingEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);

    await postEnrolment({ code: enrolment.codeFromTheAuthenticatorApp() });

    expect(debugLog.mock.calls.length).toBeGreaterThan(0);
    expect(JSON.stringify(debugLog.mock.calls)).toContain("totp-enrolment");
  });

  /*
   * The success response is built from a model the handler SELECTED password
   * and passwordSalt onto, and `sendEntityResponse` serializes whatever is set
   * without consulting read permissions. The scrub has to happen on this path
   * too, not only on the enrolment-required one.
   */
  it("scrubs password and passwordSalt off the success response", async () => {
    const user: User = await storedUser();
    const enrolment: PendingEnrolment = pendingEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);

    await postEnrolment({ code: enrolment.codeFromTheAuthenticatorApp() });

    const model: JSONObject = responseModel();

    const violations: Array<string> = [];

    if (model["password"] !== undefined) {
      violations.push("password survived onto the response model");
    }

    if (model["passwordSalt"] !== undefined) {
      violations.push("passwordSalt survived onto the response model");
    }

    expect(violations).toEqual([]);
  });

  /*
   * A code that is valid for SOMEBODY ELSE'S secret is still a wrong code
   * here. This is the assertion that fails if the verification ever stops
   * being bound to the row that was looked up -- for instance if a refactor
   * verified against a freshly generated secret rather than the pending one.
   */
  it("refuses a code that is valid for a different enrolment's secret", async () => {
    const user: User = await storedUser();
    const theirs: PendingEnrolment = pendingEnrolment();
    const someoneElse: PendingEnrolment = pendingEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(theirs.row as never);

    const result: InvokeResult = await postEnrolment({
      code: someoneElse.codeFromTheAuthenticatorApp(),
    });

    expect(sessionViolations()).toEqual([]);
    expect(refusalMessage(result)).toBe("Invalid code.");
  });

  /*
   * The enrolment lookup must not select the secret it does not need... except
   * that here it genuinely does need it, to verify the code. What it must NOT
   * do is let that secret escape: the row is read with `twoFactorSecret`, and
   * the success response must still not contain it. Reading a secret to
   * compare against is fine; echoing it back is how a second factor becomes a
   * value sitting in a browser's network tab.
   */
  it("reads the secret to verify but never returns it", async () => {
    const user: User = await storedUser();
    const enrolment: PendingEnrolment = pendingEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);

    await postEnrolment({ code: enrolment.codeFromTheAuthenticatorApp() });

    /*
     * The "reads it" half, asserted on the query rather than inferred from the
     * fact that the code verified. `totpFindOneBy` is a mock that returns a
     * fully populated row whatever columns were asked for, so every success
     * case in this describe would stay green with `twoFactorSecret` dropped
     * from the select -- while the real handler got a row whose
     * `twoFactorSecret` is undefined and rejected every code any user could
     * possibly type, permanently, on the one login they cannot skip.
     */
    const select: JSONObject = (
      totpFindOneBy.mock.calls[0] as Array<{ select: JSONObject }>
    )[0]!.select;

    expect(select["twoFactorSecret"]).toBe(true);

    const responded: string = JSON.stringify([
      responseModel(),
      responseMiscData(),
    ]);

    expect(responded).not.toContain(enrolment.secret);
    expect(responded).not.toContain("otpauth://");
  });
});
