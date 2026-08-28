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
 * MINTING A RECOVERY ROUTE AT FORCED ENROLMENT, and keeping the two factor
 * challenge alive when the backup code table is not readable.
 *
 * WHY THIS PARTICULAR HOOK IS THE ONE WORTH GUARDING
 *
 * Single-use backup codes shipped, and then essentially nobody had any,
 * because the only thing in the entire product that ever WROTE one was a
 * button on the profile page that a user had to go looking for. The sign-in
 * page then gated "use a backup code" on the count being non-zero, so the
 * recovery route existed and rendered for nobody. The fix mints codes at the
 * moments a second factor is set up, and POST /verify-totp-enrolment is the
 * sharpest of those moments.
 *
 * An account reaches forced enrolment in exactly two situations, and both are
 * the same story:
 *
 *  - an admin has just mandated two factor auth on somebody who had none, or
 *  - an admin has just RESET two factor auth for somebody who was locked out
 *    -- and `UserService.resetTwoFactorAuth` deletes the backup codes along
 *    with the factors it clears.
 *
 * Before this change both ended with the user signed in, holding a brand new
 * authenticator app and no recovery route whatsoever. The second case is the
 * cruel one: the user who had just been rescued from a lockout was returned to
 * the exact state that caused it, one lost phone away from needing an admin
 * again. So the assertions here are about the codes being minted on that path,
 * reaching the response the sign-in page shows them from, and being minted
 * NOWHERE ELSE -- a second step that quietly minted would be handing a user
 * codes on a screen that has no reason to display them, which is the
 * show-once guarantee broken in the direction nobody notices.
 *
 * THE OTHER HALF: A DEGRADED COUNT IS NOT A DEAD LOGIN
 *
 * The two factor CHALLENGE branch of /login reads `countUnusedForUser` to
 * decide whether to offer the recovery link. That await sits between an
 * accepted password and the response listing the user's factors, so before it
 * was wrapped, one bad index or one exhausted connection pool on the backup
 * code table turned EVERY two factor sign-in on the instance into a 500. The
 * recovery hint is the least important thing on that response; losing it costs
 * a locked-out user one sentence of guidance, and throwing costs every user
 * the ability to sign in at all.
 *
 * WHAT IS MOCKED, AND WHAT IS DELIBERATELY NOT
 *
 * UserTwoFactorBackupCodeService is mocked: what it does internally (the
 * count-then-write, the compensating delete by id) is the subject of its own
 * tests and needs a database. What is under test HERE is the route around it
 * -- when it is called, with what, and what the handler does with what comes
 * back, including a rejection.
 *
 * TotpAuth is NOT mocked, and password hashing is NOT mocked. The enrolment
 * codes come from Common/Tests/Server/TestingUtils/AuthenticatorApp, which
 * derives them from RFC 4226/6238 with Node crypto rather than from `otpauth`,
 * the library the server verifies with -- so "the mint happens only after a
 * code that really verified" is an assertion about the real verification.
 *
 * SIBLINGS, SO NOTHING HERE IS DUPLICATED
 *
 *  - TotpForcedEnrolment.test.ts owns the enrolment route's own security
 *    (a QR code is not an authorization, the two front guards, the sweep).
 *  - BackupCodeLoginVerification.test.ts owns /verify-backup-code's gates and
 *    the detached notification chain. This file only asks whether that route
 *    mints, which it must not.
 *  - Common/Tests/Server/Services/... owns generateForUserIfNone itself.
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
const verifyWebAuthnAuthentication: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserWebAuthnService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (...args: Array<unknown>): unknown => {
        return webAuthnFindBy(...args);
      },
      verifyAuthentication: (...args: Array<unknown>): unknown => {
        return verifyWebAuthnAuthentication(...args);
      },
    },
  };
});

/*
 * The whole subject of this file, stubbed down to the four entry points the
 * login handler can reach.
 *
 * `regenerateForUser` is stubbed even though no assertion here expects it to
 * run, precisely so that a route reaching for it instead of
 * `generateForUserIfNone` is caught as a call on a mock rather than as an
 * "is not a function" crash somewhere unrelated. The distinction is not
 * cosmetic: regenerate DELETES first, so an enrolment path that called it
 * would void a set the user is already holding -- and adding a second factor
 * to an account that already has one is an enrolment too.
 */
const generateForUserIfNone: jest.Mock = jest.fn();
const regenerateForUser: jest.Mock = jest.fn();
const countUnusedForUser: jest.Mock = jest.fn();
const consumeCode: jest.Mock = jest.fn();

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
      countUnusedForUser: (...args: Array<unknown>): unknown => {
        return countUnusedForUser(...args);
      },
      consumeCode: (...args: Array<unknown>): unknown => {
        return consumeCode(...args);
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

const sendTwoFactorBackupCodeUsedEmail: jest.Mock = jest.fn();

jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: {
      sendVerificationEmail: jest.fn(),
      /*
       * Must hand back a real promise: the backup code branch calls this
       * fire-and-forget and attaches `.catch(...)` to whatever it returns, so
       * a mock returning `undefined` would crash the login it is meant to be a
       * harmless notification for.
       */
      sendTwoFactorBackupCodeUsedEmail: (
        ...args: Array<unknown>
      ): Promise<void> => {
        return sendTwoFactorBackupCodeUsedEmail(...args) as Promise<void>;
      },
    },
  };
});

/*
 * `error` is captured rather than silenced because two of the assertions below
 * are ABOUT it. Both new try/catch blocks swallow their failure on purpose, so
 * the log line is the only remaining evidence that anything went wrong -- a
 * catch that swallowed silently would look identical from the outside to a
 * catch that never fired, and an operator would have no way to tell a healthy
 * instance from one quietly minting nothing.
 */
const errorLog: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      error: (...args: Array<unknown>): unknown => {
        return errorLog(...args);
      },
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
const USER_EMAIL: string = "just.reset@example.com";
const PENDING_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

const LOGIN_URI: string = "/login";
const ENROLMENT_URI: string = "/verify-totp-enrolment";
const TOTP_URI: string = "/verify-totp-auth";
const WEBAUTHN_URI: string = "/verify-webauthn-auth";
const BACKUP_CODE_URI: string = "/verify-backup-code";

/*
 * PLAINTEXT codes, exactly as `generateForUserIfNone` returns them: ten
 * characters from the Crockford-style alphabet, no separators. The service
 * never formats; formatting is the route's job, which is what the display
 * assertion below is pinning.
 */
const MINTED_CODES: Array<string> = ["AB3D59XZQ2", "7KMNP0TVW1", "ZQ4RS6TVW8"];

/*
 * The same three as the user reads them off the screen. Hard-coded rather than
 * computed with `TwoFactorBackupCode.formatForDisplay`, because a test that
 * derived its expectation from the very function under test would keep passing
 * if the grouping changed -- and the grouping is a promise to the user: these
 * are the characters they will be typing back into /verify-backup-code, which
 * normalizes the hyphen away again.
 */
const DISPLAYED_CODES: Array<string> = [
  "AB3D5-9XZQ2",
  "7KMNP-0TVW1",
  "ZQ4RS-6TVW8",
];

/*
 * How many codes an account that already has some reports. Non-zero and
 * non-trivial so a hard-coded or defaulted count would stand out against it.
 */
const REMAINING_CODE_COUNT: number = 6;

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
 * An account an admin has put under a two factor mandate. Whether anything is
 * set up behind the mandate is decided separately, by what the
 * UserTotpAuth/UserWebAuthn mocks return -- which is the difference between
 * the enrolment path and the challenge path.
 */
type StoredUserFunction = (options?: {
  enableTwoFactorAuth?: boolean;
}) => Promise<User>;

const storedUser: StoredUserFunction = async (options?: {
  enableTwoFactorAuth?: boolean;
}): Promise<User> => {
  const salt: string = PasswordHash.generateSalt();

  const user: User = new User();
  user._id = ObjectID.generate().toString();
  user.email = new Email(USER_EMAIL);
  user.isEmailVerified = true;
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
 * A pending (unverified) enrolment row of the shape
 * UserTotpAuthService.onBeforeCreate produces, plus a working authenticator
 * for it. `code()` is a real RFC 6238 code derived from the same QR URL the
 * server issued, computed by a different implementation than the one the
 * server verifies with.
 */
type Enrolment = {
  row: UserTotpAuth;
  code: () => string;
};

type PendingEnrolmentFunction = () => Enrolment;

const pendingEnrolment: PendingEnrolmentFunction = (): Enrolment => {
  const secret: string = TotpAuth.generateSecret();

  const otpUrl: string = buildOtpauthUri({
    secret: secret,
    label: USER_EMAIL,
    algorithm: "SHA1",
  });

  const row: UserTotpAuth = new UserTotpAuth();
  row.id = PENDING_ID;
  row.name = "Authenticator App";
  row.twoFactorSecret = secret;
  row.twoFactorOtpUrl = otpUrl;
  row.isVerified = false;

  return {
    row: row,
    code: (): string => {
      return conformingAppCode(otpUrl);
    },
  };
};

/*
 * A finished enrolment, for the second steps that are NOT enrolment: the
 * challenge screen, /verify-totp-auth and /verify-backup-code all require a
 * factor the account already has.
 */
type VerifiedEnrolmentFunction = () => Enrolment;

const verifiedEnrolment: VerifiedEnrolmentFunction = (): Enrolment => {
  const enrolment: Enrolment = pendingEnrolment();

  enrolment.row.isVerified = true;

  return enrolment;
};

type VerifiedWebAuthnRowFunction = () => UserWebAuthn;

const verifiedWebAuthnRow: VerifiedWebAuthnRowFunction = (): UserWebAuthn => {
  const row: UserWebAuthn = new UserWebAuthn();
  row.id = ObjectID.generate();
  row.name = "Security Key";
  row.isVerified = true;

  return row;
};

/*
 * The shape the login page posts to finish a forced enrolment. The credentials
 * ride along because this stage holds no session at all -- see
 * App/FeatureSet/Accounts/src/Pages/Login.tsx.
 */
type PostEnrolmentFunction = (input?: {
  code?: string;
}) => Promise<InvokeResult>;

const postEnrolment: PostEnrolmentFunction = (input?: {
  code?: string;
}): Promise<InvokeResult> => {
  return invoke(ENROLMENT_URI, {
    data: {
      email: USER_EMAIL,
      password: { _type: "HashedString", value: PASSWORD },
      code: input?.code === undefined ? "000000" : input.code,
      twoFactorAuthId: PENDING_ID.toString(),
    },
  });
};

type PostSecondStepFunction = (
  uri: string,
  extraData: JSONObject,
) => Promise<InvokeResult>;

const postSecondStep: PostSecondStepFunction = (
  uri: string,
  extraData: JSONObject,
): Promise<InvokeResult> => {
  return invoke(uri, {
    data: {
      email: USER_EMAIL,
      password: { _type: "HashedString", value: PASSWORD },
      ...extraData,
    },
  });
};

type PostLoginFunction = () => Promise<InvokeResult>;

const postLogin: PostLoginFunction = (): Promise<InvokeResult> => {
  return invoke(LOGIN_URI, {
    data: {
      email: USER_EMAIL,
      password: { _type: "HashedString", value: PASSWORD },
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

/*
 * The `miscData` bag `Response.sendEntityResponse` was handed -- argument 5 of
 * (req, res, item, type, miscDataWrapper), unwrapped one level. Everything the
 * sign-in page reads out of a login response lives in here.
 */
type ResponseMiscDataFunction = () => JSONObject;

const responseMiscData: ResponseMiscDataFunction = (): JSONObject => {
  const call: Array<unknown> = sendEntityResponse.mock
    .calls[0] as Array<unknown>;

  return (call[4] as JSONObject)["miscData"] as JSONObject;
};

/*
 * ABSENCE, not falsiness. The sign-in page decides which screen to draw from
 * whether `backupCodes` is there at all, so `{}` and `{ backupCodes: [] }` are
 * different answers: the first says "nothing was minted, carry on", the second
 * would send the user to a show-once screen listing no codes and a Continue
 * button they must tick a box to enable. `toBeUndefined()` cannot tell the two
 * apart -- reading the key list can.
 */
type ResponseMiscDataKeysFunction = () => Array<string>;

const responseMiscDataKeys: ResponseMiscDataKeysFunction =
  (): Array<string> => {
    return Object.keys(responseMiscData());
  };

/*
 * "No session was issued" is two separate facts, and either one alone is an
 * authorization: a row in the session table, and the cookie on the response --
 * a self-contained JWT that `UserAuthorization` accepts without consulting the
 * session table or `enableTwoFactorAuth` again.
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

type WasLoggedFunction = (thrown: Error) => boolean;

const wasLogged: WasLoggedFunction = (thrown: Error): boolean => {
  return errorLog.mock.calls.some((call: Array<unknown>): boolean => {
    return call[0] === thrown;
  });
};

type MintedForUserIdFunction = () => string | undefined;

const mintedForUserId: MintedForUserIdFunction = (): string | undefined => {
  const call: Array<unknown> | undefined = generateForUserIfNone.mock
    .calls[0] as Array<unknown> | undefined;

  return (call?.[0] as { userId?: ObjectID } | undefined)?.userId?.toString();
};

beforeEach(() => {
  jest.clearAllMocks();

  createSession.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
  } as never);

  /*
   * The default world is the one forced enrolment happens in: a mandated
   * account with nothing set up behind the mandate, and no codes either --
   * exactly what `UserService.resetTwoFactorAuth` leaves behind. Every test
   * moves one thing out of this state, so the thing that moved is the thing
   * that caused the difference.
   */
  totpFindBy.mockResolvedValue([] as never);
  webAuthnFindBy.mockResolvedValue([] as never);
  totpFindOneBy.mockResolvedValue(null as never);
  totpCreate.mockResolvedValue(pendingEnrolment().row as never);
  totpUpdateOneById.mockResolvedValue(1 as never);
  totpDeleteBy.mockResolvedValue(1 as never);
  verifyWebAuthnAuthentication.mockResolvedValue(undefined as never);
  refreshUserAllPermissions.mockResolvedValue(undefined as never);
  generateForUserIfNone.mockResolvedValue(MINTED_CODES as never);
  countUnusedForUser.mockResolvedValue(REMAINING_CODE_COUNT as never);
  consumeCode.mockResolvedValue(true as never);
  sendTwoFactorBackupCodeUsedEmail.mockResolvedValue(undefined as never);

  jest.spyOn(UserService, "updateOneById").mockResolvedValue(1 as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /verify-totp-enrolment -- minting the recovery route the user was about to need", () => {
  /*
   * The core of the fix. Without this call the two paths into forced enrolment
   * -- an admin mandating 2FA, and an admin RESETTING 2FA for somebody already
   * locked out -- both end with an account holding one authenticator app and
   * nothing else. Nothing else in the product mints without the user first
   * finding a button they have no reason to look for.
   */
  it("mints a set for the account that just enrolled", async () => {
    const user: User = await storedUser();
    const enrolment: Enrolment = pendingEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);

    await postEnrolment({ code: enrolment.code() });

    expect(generateForUserIfNone).toHaveBeenCalledTimes(1);
    expect(mintedForUserId()).toBe(user.id!.toString());
  });

  /*
   * "If none", never "regenerate". The two differ by a DELETE, and the delete
   * is what makes the wrong choice destructive: adding a factor to an account
   * that already holds a printed list of codes is an enrolment too, and
   * regenerating there would void the list while the user still believes in
   * it. Asserting the negative is the only way to catch the swap -- both
   * calls return codes, so the response would look identical.
   */
  it("never reaches for the replacing regenerate on an enrolment", async () => {
    const user: User = await storedUser();
    const enrolment: Enrolment = pendingEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);

    await postEnrolment({ code: enrolment.code() });

    expect(regenerateForUser).not.toHaveBeenCalled();
  });

  /*
   * The codes have to reach the browser on THIS response or they are lost:
   * only the keyed digests are stored, so nothing -- not the service, not a
   * master admin, not a database dump -- can produce them again. A mint whose
   * output never left the server would leave the user with ten codes they have
   * never seen, which reads on the profile page as "you are covered" and is
   * strictly worse than having none.
   *
   * Hyphenated, because that is what the user is copying down.
   */
  it("carries the minted codes to the sign-in page, hyphenated for display", async () => {
    const user: User = await storedUser();
    const enrolment: Enrolment = pendingEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);
    generateForUserIfNone.mockResolvedValue(MINTED_CODES as never);

    await postEnrolment({ code: enrolment.code() });

    expect(loginSucceeded()).toBe(true);
    expect(responseMiscData()["backupCodes"]).toEqual(DISPLAYED_CODES);
  });

  /*
   * The session is still the point. A response that showed codes but signed
   * nobody in would strand the user on a screen they cannot leave, holding a
   * factor they cannot use yet.
   */
  it("signs the user in on the same response that shows the codes", async () => {
    const user: User = await storedUser();
    const enrolment: Enrolment = pendingEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);

    await postEnrolment({ code: enrolment.code() });

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(setUserCookie).toHaveBeenCalledTimes(1);
    expect(responseMiscData()["accessToken"]).toBeTruthy();
  });

  /*
   * ABSENT, not empty. `generateForUserIfNone` returns null for an account
   * that already had codes -- the "added a second authenticator" case -- and
   * the sign-in page branches on the key existing. Ship `backupCodes: []` and
   * the page raises its show-once screen over an empty grid, with a Continue
   * button gated behind a checkbox reading "I have saved my backup codes",
   * for a user who has been given nothing to save.
   */
  it("omits the key entirely when the account already had codes", async () => {
    const user: User = await storedUser();
    const enrolment: Enrolment = pendingEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);
    generateForUserIfNone.mockResolvedValue(null as never);

    await postEnrolment({ code: enrolment.code() });

    expect(loginSucceeded()).toBe(true);
    expect(responseMiscDataKeys()).not.toContain("backupCodes");
  });

  /*
   * The same absence for the degenerate answer. A service returning an empty
   * array rather than null is not a state today, but it is one refactor away
   * -- and the guard the route uses (`length > 0`) is what keeps the two
   * answers indistinguishable to the page. Asserting it here means the guard
   * cannot quietly become a null check.
   */
  it("omits the key when the mint reports an empty set", async () => {
    const user: User = await storedUser();
    const enrolment: Enrolment = pendingEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);
    generateForUserIfNone.mockResolvedValue([] as never);

    await postEnrolment({ code: enrolment.code() });

    expect(loginSucceeded()).toBe(true);
    expect(responseMiscDataKeys()).not.toContain("backupCodes");
  });

  /*
   * A FAILED MINT MUST NOT FAIL THE LOGIN, and this is the assertion the whole
   * feature's reputation rests on. By this line the enrolment row is already
   * flipped to verified and the password has already been accepted: the user
   * has a working second factor whether or not the codes were written.
   * Throwing here would answer that with a 500 and leave them staring at a
   * login screen that refuses a password and a code that are both correct --
   * locking out the exact user the feature exists to let in, and doing it on
   * the retry too, because the enrolment no longer needs finishing.
   */
  it("still signs the user in when the mint throws", async () => {
    const user: User = await storedUser();
    const enrolment: Enrolment = pendingEnrolment();
    const thrown: Error = new Error("backup code table is unreachable");

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);
    generateForUserIfNone.mockRejectedValue(thrown as never);

    const result: InvokeResult = await postEnrolment({
      code: enrolment.code(),
    });

    const violations: Array<string> = [];

    if (result.nextError) {
      violations.push(
        `the failure escaped to next(): ${result.nextError.message}`,
      );
    }

    if (!loginSucceeded()) {
      violations.push("the login did not succeed");
    }

    if (createSession.mock.calls.length !== 1) {
      violations.push("no session was created");
    }

    if (setUserCookie.mock.calls.length !== 1) {
      violations.push("no cookie was set");
    }

    if (responseMiscDataKeys().includes("backupCodes")) {
      violations.push("the response claimed codes that were never written");
    }

    expect(violations).toEqual([]);
  });

  /*
   * The other half of swallowing: the swallow has to be audible. A silent
   * catch makes an instance where nobody is being given codes look exactly
   * like a healthy one, and the symptom -- users discovering they have no
   * recovery route -- only surfaces months later, one locked-out user at a
   * time.
   */
  it("logs the mint failure rather than swallowing it silently", async () => {
    const user: User = await storedUser();
    const enrolment: Enrolment = pendingEnrolment();
    const thrown: Error = new Error("backup code table is unreachable");

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);
    generateForUserIfNone.mockRejectedValue(thrown as never);

    await postEnrolment({ code: enrolment.code() });

    expect(wasLogged(thrown)).toBe(true);
  });

  /*
   * ORDER, not just occurrence. The mint sits behind the code check, and
   * moving it in front would write ten codes for every wrong guess at the
   * enrolment screen -- each one a set the caller is never shown, and the
   * first of which permanently blocks the real user's mint, because
   * `generateForUserIfNone` is a no-op for an account that already has rows.
   * The person who then finishes enrolling correctly would be handed no codes
   * at all and told nothing about it.
   */
  it("mints nothing when the submitted code does not verify", async () => {
    const user: User = await storedUser();
    const enrolment: Enrolment = pendingEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);

    await postEnrolment({ code: "000000" });

    expect(generateForUserIfNone).not.toHaveBeenCalled();
    expect(sessionViolations()).toEqual([]);
  });

  /*
   * And nothing when the route refuses outright. An account that already has a
   * verified factor is sent away from enrolment, and a mint that ran before
   * that refusal would hand codes to whoever is holding the password -- who
   * has, at that point, passed no second factor at all. The count check inside
   * the service is no defence here: an account with a factor and no codes is
   * ordinary, so the write would go through.
   */
  it("mints nothing when the enrolment is refused because a factor already exists", async () => {
    const user: User = await storedUser();
    const alreadyEnrolled: Enrolment = verifiedEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindBy.mockResolvedValue([alreadyEnrolled.row] as never);
    totpFindOneBy.mockResolvedValue(pendingEnrolment().row as never);

    await postEnrolment({ code: alreadyEnrolled.code() });

    expect(generateForUserIfNone).not.toHaveBeenCalled();
    expect(sessionViolations()).toEqual([]);
  });

  /*
   * The ordering as a chain: flip the enrolment verified, sweep the abandoned
   * scans, and only then mint.
   *
   * Occurrence alone is not enough, because the earlier steps are the ones
   * that can still fail. A mint hoisted above `updateOneById` would write ten
   * codes for an enrolment that then failed to be marked verified -- an
   * account holding a recovery set for a factor the server still considers
   * pending, and, because `generateForUserIfNone` is a no-op once any row
   * exists, an account that can never be minted for again.
   *
   * The sweep boundary is the subtler one. `deleteBy` removes every unverified
   * row for this user, so it is the last write this request makes to the
   * enrolment state the codes are being minted to accompany; minting in front
   * of it means the codes exist for a moment during which the request can
   * still take another database write and fail.
   *
   * Deliberately NOT asserted: that the mint precedes `createSession`. It does
   * today, and that direction is the arguable one -- see the note handed back
   * with this file.
   */
  it("mints after the code verified and after the stale-enrolment sweep", async () => {
    const user: User = await storedUser();
    const enrolment: Enrolment = pendingEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(enrolment.row as never);

    await postEnrolment({ code: enrolment.code() });

    const flippedVerified: number =
      totpUpdateOneById.mock.invocationCallOrder[0]!;
    const swept: number = totpDeleteBy.mock.invocationCallOrder[0]!;
    const minted: number = generateForUserIfNone.mock.invocationCallOrder[0]!;

    const violations: Array<string> = [];

    if (!(flippedVerified < minted)) {
      violations.push("the mint ran before the enrolment was marked verified");
    }

    if (!(swept < minted)) {
      violations.push("the mint ran before the stale enrolments were swept");
    }

    expect(violations).toEqual([]);
  });
});

describe("The other second steps never mint", () => {
  /*
   * ONLY enrolment mints, and the reason is the screen. The sign-in page shows
   * a show-once grid when the response carries codes, and it only has that
   * screen on the enrolment leg. A mint on an ordinary second step would
   * either write codes nobody is shown -- the "you have ten codes you have
   * never seen" state, which looks on the profile page exactly like being
   * covered -- or, worse, put a full set of recovery credentials in the
   * network tab of every routine sign-in.
   *
   * `generateForUserIfNone` returning a set here is deliberate: it makes these
   * three tests fail loudly if the call is ever added, rather than passing
   * because the stub happened to answer null.
   */
  it("a routine TOTP sign-in mints nothing and carries no codes", async () => {
    const user: User = await storedUser();
    const totp: Enrolment = verifiedEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindOneBy.mockResolvedValue(totp.row as never);

    await postSecondStep(TOTP_URI, {
      code: totp.code(),
      twoFactorAuthId: PENDING_ID.toString(),
    });

    expect(loginSucceeded()).toBe(true);
    expect(generateForUserIfNone).not.toHaveBeenCalled();
    expect(responseMiscDataKeys()).not.toContain("backupCodes");
  });

  it("a security key sign-in mints nothing and carries no codes", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    webAuthnFindBy.mockResolvedValue([verifiedWebAuthnRow()] as never);

    await postSecondStep(WEBAUTHN_URI, {
      credential: { id: "credential-id", response: {} },
    });

    expect(loginSucceeded()).toBe(true);
    expect(generateForUserIfNone).not.toHaveBeenCalled();
    expect(responseMiscDataKeys()).not.toContain("backupCodes");
  });

  /*
   * The backup code route least of all, and this one is not symmetry. Somebody
   * arriving here has just spent one of a dwindling list, so an automatic mint
   * looks helpful -- but `generateForUserIfNone` counts ROWS, not unused ones,
   * so it would be a no-op for exactly the user who needs it and would fire
   * only for an account whose set had been deleted out from under it. Handing
   * a fresh list to a caller who authenticated with a string off a photographed
   * printout, on a screen that is mid-redirect, is the wrong answer either way.
   */
  it("spending a backup code mints nothing and carries no codes", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindBy.mockResolvedValue([verifiedEnrolment().row] as never);

    await postSecondStep(BACKUP_CODE_URI, { backupCode: "AB3D5-9XZQ2" });

    expect(loginSucceeded()).toBe(true);
    expect(generateForUserIfNone).not.toHaveBeenCalled();
    expect(responseMiscDataKeys()).not.toContain("backupCodes");
  });

  /*
   * And a plain password login on an account with no mandate at all. This is
   * the overwhelming majority of sign-ins on any instance, so a mint reached
   * from here would not be a corner case: it would be a write per login, and a
   * set of recovery codes in the response body of every one of them.
   */
  it("an ordinary password login mints nothing and carries no codes", async () => {
    const user: User = await storedUser({ enableTwoFactorAuth: false });

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

    await postLogin();

    expect(loginSucceeded()).toBe(true);
    expect(generateForUserIfNone).not.toHaveBeenCalled();
    expect(responseMiscDataKeys()).not.toContain("backupCodes");
  });
});

describe("POST /login -- the two factor challenge when the backup code count cannot be read", () => {
  /*
   * The healthy reading first, so the degraded assertion below has something
   * to be different from. Without this, a route that hard-coded zero -- or one
   * where the count was dropped entirely -- would satisfy every other test in
   * this describe.
   */
  it("reports the real count when the table answers", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindBy.mockResolvedValue([verifiedEnrolment().row] as never);
    countUnusedForUser.mockResolvedValue(REMAINING_CODE_COUNT as never);

    await postLogin();

    expect(responseMiscData()["backupCodeCount"]).toBe(REMAINING_CODE_COUNT);
  });

  /*
   * THE BLAST RADIUS THIS GUARD EXISTS FOR. The count is read between an
   * accepted password and the response that lists the user's factors, so
   * unguarded, one bad index or one exhausted connection pool on the backup
   * code table did not degrade the recovery hint -- it took every two factor
   * sign-in on the instance down with it, with a 500 that says nothing about
   * backup codes to the operator reading it.
   *
   * Degrading costs a locked-out user one sentence of guidance. Throwing costs
   * every user the ability to sign in.
   */
  it("still answers the challenge screen when the count rejects", async () => {
    const user: User = await storedUser();
    const totp: Enrolment = verifiedEnrolment();
    const thrown: Error = new Error("relation index is corrupt");

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindBy.mockResolvedValue([totp.row] as never);
    countUnusedForUser.mockRejectedValue(thrown as never);

    const result: InvokeResult = await postLogin();

    const violations: Array<string> = [];

    if (result.nextError) {
      violations.push(
        `the failure escaped to next(): ${result.nextError.message}`,
      );
    }

    if (sendErrorResponse.mock.calls.length > 0) {
      violations.push("the login was refused");
    }

    if (sendEntityResponse.mock.calls.length === 0) {
      violations.push("no challenge response was sent");
    }

    expect(violations).toEqual([]);
  });

  /*
   * And the response still has to be USABLE. A 200 that lost the factor list
   * would draw a two factor screen with nothing to choose, which is the same
   * dead end as the 500 with a friendlier status code.
   *
   * The count is OMITTED rather than sent as zero, and that distinction is the
   * whole point of this test. Zero is a claim: the sign-in page renders "you
   * have no backup codes, ask an administrator to reset two factor auth" on
   * the strength of it. Making that claim because an index was briefly corrupt
   * would send a user holding ten printed codes off to find an administrator
   * instead of typing one in. An absent key means "unknown", which the page
   * renders as the code form -- a user with codes can still use them, and a
   * user without gets the refusal they would have got anyway.
   */
  it("lists the user's factors and omits the count when it cannot be read", async () => {
    const user: User = await storedUser();
    const totp: Enrolment = verifiedEnrolment();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindBy.mockResolvedValue([totp.row] as never);
    webAuthnFindBy.mockResolvedValue([verifiedWebAuthnRow()] as never);
    countUnusedForUser.mockRejectedValue(
      new Error("relation index is corrupt") as never,
    );

    await postLogin();

    const miscData: JSONObject = responseMiscData();

    const violations: Array<string> = [];

    if ("backupCodeCount" in miscData) {
      violations.push(
        `backupCodeCount was sent as ${String(
          miscData["backupCodeCount"],
        )} when it should have been omitted entirely`,
      );
    }

    if ((miscData["totpAuthList"] as Array<JSONObject>).length !== 1) {
      violations.push("the authenticator app was missing from the challenge");
    }

    if ((miscData["webAuthnList"] as Array<JSONObject>).length !== 1) {
      violations.push("the security key was missing from the challenge");
    }

    expect(violations).toEqual([]);
  });

  it("logs the count failure rather than swallowing it silently", async () => {
    const user: User = await storedUser();
    const thrown: Error = new Error("relation index is corrupt");

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindBy.mockResolvedValue([verifiedEnrolment().row] as never);
    countUnusedForUser.mockRejectedValue(thrown as never);

    await postLogin();

    expect(wasLogged(thrown)).toBe(true);
  });

  /*
   * Degrading must not turn into a bypass. This is a CHALLENGE response -- the
   * caller has proved a password and nothing else -- so the recovery from a
   * failed count must not drift into the success path that mints a session.
   * The cookie alone would be enough: it is a self-contained JWT that
   * `UserAuthorization` accepts without ever re-reading `enableTwoFactorAuth`,
   * so there would be no later gate to catch it.
   */
  it("issues no session while degrading -- the password is still not enough", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindBy.mockResolvedValue([verifiedEnrolment().row] as never);
    countUnusedForUser.mockRejectedValue(
      new Error("relation index is corrupt") as never,
    );

    await postLogin();

    expect(sessionViolations()).toEqual([]);
  });
});
