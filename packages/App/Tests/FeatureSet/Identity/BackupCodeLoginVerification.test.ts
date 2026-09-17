import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import UserService from "Common/Server/Services/UserService";
import PasswordHash from "Common/Server/Utils/PasswordHash";
import User from "Common/Models/DatabaseModels/User";
import UserTotpAuth from "Common/Models/DatabaseModels/UserTotpAuth";
import UserWebAuthn from "Common/Models/DatabaseModels/UserWebAuthn";
import Email from "Common/Types/Email";
import Exception from "Common/Types/Exception/Exception";
import HashedString from "Common/Types/HashedString";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

/*
 * ---------------------------------------------------------------------------
 * POST /verify-backup-code -- the way back in when the second factor itself is
 * gone, exercised through the real login() handler.
 *
 * THE TWO FAILURE MODES THIS FILE GUARDS ARE MIRROR IMAGES, AND BOTH ARE
 * TERMINAL.
 *
 * Refuse a code that should work and the account is simply lost: everyone
 * reaching this route has already established that the authenticator app or
 * the security key cannot be produced, so there is no other door left to try
 * and no second step to fall back to -- only a master admin, who is exactly
 * the person a self-service recovery route exists to avoid needing at 2am.
 *
 * Accept something that should not work and the route is a 2FA bypass. It
 * mints a full session from material that is not a device the user is holding
 * but a string somebody could have photographed off a printed list, so the
 * ORDER of its gates is the whole security design and is what most of the
 * tests below pin down: the password is verified before the code is even
 * looked at, the account must actually be under a two factor mandate with a
 * verified factor behind it before a code can be spent, and the id the code is
 * spent against comes from the account the password matched -- never from the
 * request body.
 *
 * WHAT IS MOCKED, AND WHAT IS DELIBERATELY NOT
 *
 * UserTwoFactorBackupCodeService IS mocked, on purpose. The credential
 * arithmetic it performs -- Crockford-alphabet normalization, the HMAC keyed
 * by the instance EncryptionSecret, and the single conditional UPDATE that
 * makes a code single-use -- is the subject of its own tests and needs a
 * database to mean anything. What is under test HERE is the route around it:
 * which refusals happen before `consumeCode` is reached at all, that whatever
 * the user typed reaches it untouched (normalization belongs to the service,
 * and a route that pre-mangled the string would diverge from the digest that
 * was stored), and what the handler does with the boolean it gets back.
 *
 * Password hashing is NOT mocked. `UserService.verifyHashedColumnValue` runs
 * for real against a real per-user salt, because "the password gate sits in
 * front of the code" is an assertion about the real comparison, not about a
 * stub agreeing with itself.
 *
 * Everything else the handler reaches -- sessions, cookies, mail, tokens,
 * captcha -- is mocked, because none of it is what is under test.
 *
 * SIBLINGS, SO NOTHING HERE IS DUPLICATED
 *
 *  - TotpLoginVerification.test.ts covers /verify-totp-auth, the second step
 *    for a user who still HAS their authenticator, including the real TOTP
 *    algorithm.
 *  - TotpForcedEnrolment.test.ts covers /verify-totp-enrolment and the /login
 *    branch that hands back a QR code, including "a QR code is not an
 *    authorization".
 *  - IdentityRateLimit.test.ts owns the limiter budgets themselves -- how many
 *    attempts a bucket allows and what happens when Redis is down. This file
 *    asserts only that the new route was registered BEHIND that middleware,
 *    which is the half that a newly added route can get wrong.
 *  - CredentialGuard.test.ts owns the guard's own semantics; here it is only
 *    observed through the message an empty submission produces.
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
 * The service is stubbed down to the two calls the login path makes.
 * `consumeCode` is the credential decision -- it returns a bare boolean, and
 * every refusal reason (unknown code, already spent, somebody else's) arrives
 * here as the same `false`, which is what keeps the route from being an
 * enumeration oracle.
 */
const consumeCode: jest.Mock = jest.fn();
const countUnusedForUser: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserTwoFactorBackupCodeService", () => {
  return {
    __esModule: true,
    default: {
      consumeCode: (...args: Array<unknown>): unknown => {
        return consumeCode(...args);
      },
      countUnusedForUser: (...args: Array<unknown>): unknown => {
        return countUnusedForUser(...args);
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
const sendTwoFactorBackupCodeUsedEmail: jest.Mock = jest.fn();

jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: {
      sendVerificationEmail: (...args: Array<unknown>): unknown => {
        return sendVerificationEmail(...args);
      },
      /*
       * Must hand back a real promise: the handler calls this
       * fire-and-forget and attaches `.catch(...)` to whatever it returns, so
       * a mock returning `undefined` would crash the login it is meant to be
       * a harmless notification for.
       */
      sendTwoFactorBackupCodeUsedEmail: (
        ...args: Array<unknown>
      ): Promise<void> => {
        return sendTwoFactorBackupCodeUsedEmail(...args) as Promise<void>;
      },
    },
  };
});

const debugLog: jest.Mock = jest.fn();
const infoLog: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: (...args: Array<unknown>): unknown => {
        return infoLog(...args);
      },
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
const USER_EMAIL: string = "locked.out@example.com";

/*
 * A code in the shape `formatForDisplay` produces, which is the shape the user
 * is looking at when they type it back in.
 */
const VALID_CODE: string = "AB3D5-9XZQ2";

/*
 * How many codes the account has left after spending one. Non-zero and
 * non-trivial so that a hard-coded count in the notification would stand out.
 */
const REMAINING_CODE_COUNT: number = 7;

/*
 * The id an attacker would put in the request body hoping the handler spends a
 * code against it instead of against the account the password actually
 * matched.
 */
const SOMEBODY_ELSE_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);

const BACKUP_CODE_URI: string = "/verify-backup-code";
const LOGIN_URI: string = "/login";

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
 * The account this whole route exists for: two factor auth is on, so the
 * password alone is explicitly not enough. Whether anything is set up BEHIND
 * that mandate is decided separately, by what the UserTotpAuth/UserWebAuthn
 * mocks return -- the two states lead to different refusals below.
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
 * A finished TOTP enrolment. Its presence is what makes a backup code
 * meaningful: the code stands in for a factor the account HAS and cannot
 * currently reach.
 */
type VerifiedTotpRowFunction = () => UserTotpAuth;

const verifiedTotpRow: VerifiedTotpRowFunction = (): UserTotpAuth => {
  const row: UserTotpAuth = new UserTotpAuth();
  row.id = ObjectID.generate();
  row.name = "Authenticator App";
  row.isVerified = true;

  return row;
};

/*
 * A finished security key registration. Kept separate from the TOTP row
 * because the lost-key case is the other half of what this route recovers
 * from, and the handler has to accept either one as "a factor exists".
 */
type VerifiedWebAuthnRowFunction = () => UserWebAuthn;

const verifiedWebAuthnRow: VerifiedWebAuthnRowFunction = (): UserWebAuthn => {
  const row: UserWebAuthn = new UserWebAuthn();
  row.id = ObjectID.generate();
  row.name = "Security Key";
  row.isVerified = true;

  return row;
};

/*
 * The shape the login page posts to spend a backup code. The credentials ride
 * along because this stage holds no session at all -- see
 * App/FeatureSet/Accounts/src/Pages/Login.tsx.
 *
 * `omitBackupCode` drops the key entirely rather than sending an empty string,
 * which is what `JSON.stringify` does with an undefined value and therefore
 * what a real client produces. `extraData` is for the tests that plant
 * attacker-chosen fields in the body to prove they are ignored.
 */
type PostBackupCodeInput = {
  backupCode?: unknown;
  omitBackupCode?: boolean;
  password?: string;
  extraData?: JSONObject;
};

type PostBackupCodeFunction = (
  input?: PostBackupCodeInput,
) => Promise<InvokeResult>;

const postBackupCode: PostBackupCodeFunction = (
  input?: PostBackupCodeInput,
): Promise<InvokeResult> => {
  const data: JSONObject = {
    email: USER_EMAIL,
    password: {
      _type: "HashedString",
      value: input?.password === undefined ? PASSWORD : input.password,
    },
    ...(input?.extraData || {}),
  };

  if (!input?.omitBackupCode) {
    data["backupCode"] = (
      input?.backupCode === undefined ? VALID_CODE : input.backupCode
    ) as JSONValue;
  }

  return invoke(BACKUP_CODE_URI, { data: data });
};

/*
 * Let the DETACHED notification chain run to completion.
 *
 * Everything after the code is spent -- the remaining-count read, the mail and
 * the log line -- is deliberately not awaited by the handler, because a
 * failure there must not fail a login whose single-use credential is already
 * gone (see the branch in App/FeatureSet/Identity/API/Authentication.ts).
 *
 * That makes it invisible to a plain `await` on the handler. Today the chain
 * happens to settle before the handler returns, because the handler awaits
 * several other mocked promises on its way out -- but that is scheduling
 * luck, not a guarantee, and a test that depends on it goes flaky the moment
 * one of those awaits is removed. Draining the queue explicitly is the
 * difference between asserting on the notification and asserting on the
 * event loop.
 */
type FlushDetachedWorkFunction = () => Promise<void>;

const flushDetachedWork: FlushDetachedWorkFunction =
  async (): Promise<void> => {
    for (let tick: number = 0; tick < 10; tick++) {
      await Promise.resolve();
    }
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
 * "No session was issued" is two separate facts, and either one alone is an
 * authorization: a row in the session table, and the cookie on the response --
 * which is a self-contained JWT that `UserAuthorization` accepts without ever
 * consulting the session table or `enableTwoFactorAuth` again. Both are
 * checked, and both are named when they fail, because a refusal that
 * nevertheless set the cookie would read as a pass on the message assertion
 * alone.
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

/*
 * The `miscData` bag `Response.sendEntityResponse` was handed -- argument 5 of
 * (req, res, item, type, miscDataWrapper), unwrapped one level.
 */
type ResponseMiscDataFunction = () => JSONObject;

const responseMiscData: ResponseMiscDataFunction = (): JSONObject => {
  const call: Array<unknown> = sendEntityResponse.mock
    .calls[0] as Array<unknown>;

  return (call[4] as JSONObject)["miscData"] as JSONObject;
};

type ConsumeCodeArgs = { userId: ObjectID; code: string };

type FirstConsumeCallFunction = () => ConsumeCodeArgs;

const firstConsumeCall: FirstConsumeCallFunction = (): ConsumeCodeArgs => {
  return (consumeCall(0) as Array<ConsumeCodeArgs>)[0] as ConsumeCodeArgs;
};

type ConsumeCallFunction = (index: number) => Array<unknown>;

const consumeCall: ConsumeCallFunction = (index: number): Array<unknown> => {
  return consumeCode.mock.calls[index] as Array<unknown>;
};

type BackupCodeEmailArgsFunction = () => {
  user: User;
  remainingCodeCount: number;
};

const backupCodeEmailArgs: BackupCodeEmailArgsFunction = (): {
  user: User;
  remainingCodeCount: number;
} => {
  const call: Array<unknown> = sendTwoFactorBackupCodeUsedEmail.mock
    .calls[0] as Array<unknown>;

  return call[0] as { user: User; remainingCodeCount: number };
};

beforeEach(() => {
  jest.clearAllMocks();

  createSession.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
  } as never);

  /*
   * The default world is the one the route was built for: a mandated account
   * that HAS a verified authenticator, holding recovery codes, submitting one
   * that the service accepts. Every refusal test below moves exactly one thing
   * out of this state, so the thing that moved is the thing that caused the
   * refusal.
   */
  totpFindBy.mockResolvedValue([verifiedTotpRow()] as never);
  webAuthnFindBy.mockResolvedValue([] as never);
  totpFindOneBy.mockResolvedValue(null as never);
  consumeCode.mockResolvedValue(true as never);
  countUnusedForUser.mockResolvedValue(REMAINING_CODE_COUNT as never);
  refreshUserAllPermissions.mockResolvedValue(undefined as never);
  sendTwoFactorBackupCodeUsedEmail.mockResolvedValue(undefined as never);

  jest.spyOn(UserService, "updateOneById").mockResolvedValue(1 as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /verify-backup-code -- signing in when the factor is unreachable", () => {
  /*
   * The whole reason the feature exists. If this stops working, an account
   * whose phone is gone has no remaining route back in that does not involve
   * another human being.
   */
  it("signs the user in when the service accepts the code", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

    await postBackupCode();

    expect(loginSucceeded()).toBe(true);
    expect(createSession).toHaveBeenCalledTimes(1);

    const miscData: JSONObject = responseMiscData();

    expect(miscData["accessToken"]).toBeDefined();
    expect(miscData["refreshToken"]).toBeDefined();
  });

  /*
   * The lost SECURITY KEY case. The front guard asks whether any verified
   * factor exists, and reading only the TOTP list would refuse recovery to
   * every WebAuthn-only account -- the users least likely to have a second
   * way in, since a key is a physical object with no cloud backup.
   */
  it("signs in an account whose only verified factor is a security key", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindBy.mockResolvedValue([] as never);
    webAuthnFindBy.mockResolvedValue([verifiedWebAuthnRow()] as never);

    await postBackupCode();

    expect(loginSucceeded()).toBe(true);
    expect(consumeCode).toHaveBeenCalledTimes(1);
  });

  /*
   * Normalization -- the hyphen, the lowercase, the spaces a password manager
   * pastes in -- belongs to the service, because that is where the digest the
   * code is compared against is computed. A route that trimmed or uppercased
   * on its own would be a second, divergent canonicaliser: the day the two
   * disagree, a user typing a perfectly correct code is told it is invalid.
   */
  it.each(["AB3D5-9XZQ2", "ab3d59xzq2", "  AB3D5 9XZQ2  ", "AB3D59XZQ2"])(
    "hands the service exactly what the user typed for %p",
    async (submitted: string) => {
      const user: User = await storedUser();

      jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

      await postBackupCode({ backupCode: submitted });

      expect(loginSucceeded()).toBe(true);
      expect(firstConsumeCall().code).toBe(submitted);
    },
  );

  /*
   * The code is spent against the account the PASSWORD matched, never against
   * an id the caller supplied. Reading the owner from the body would make this
   * route a way to burn -- or, worse, to test -- codes belonging to somebody
   * else's account while holding only your own credentials.
   */
  it("spends the code against the authenticated user's own id", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

    await postBackupCode({
      extraData: {
        userId: SOMEBODY_ELSE_ID.toString(),
        _id: SOMEBODY_ELSE_ID.toString(),
      },
    });

    const violations: Array<string> = [];

    if (firstConsumeCall().userId.toString() !== user.id!.toString()) {
      violations.push(
        "consumeCode was called with an id that is not the authenticated user's",
      );
    }

    if (JSON.stringify(consumeCall(0)).includes(SOMEBODY_ELSE_ID.toString())) {
      violations.push("the id from the request body reached consumeCode");
    }

    expect(violations).toEqual([]);
  });
});

describe("POST /verify-backup-code -- what it refuses", () => {
  /*
   * The refusal that carries the security of the whole route. `consumeCode`
   * returning false is the only thing standing between a caller holding a
   * stolen password and a session, so a handler that fell through to
   * `finalizeUserLogin` here would turn the recovery route into a 2FA bypass
   * that the login page would keep rendering as if nothing were wrong.
   */
  it("refuses when the service rejects the code, and issues no session", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    consumeCode.mockResolvedValue(false as never);

    const result: InvokeResult = await postBackupCode();

    expect(loginSucceeded()).toBe(false);
    expect(refusalMessage(result)).toBe("Invalid backup code.");
    expect(sessionViolations()).toEqual([]);
  });

  /*
   * Every rejection reason reaches the handler as the same `false` and must
   * leave by the same door. A message that distinguished "no such code" from
   * "already used" would let somebody holding a photograph of a printed list
   * work out which lines are still live before spending an attempt on one.
   */
  it.each([
    "a code that was never issued",
    "a code that has already been spent",
    "a code belonging to a different account",
  ])("gives nothing away about %s", async (_reason: string) => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    consumeCode.mockResolvedValue(false as never);

    const result: InvokeResult = await postBackupCode();

    expect(refusalMessage(result)).toBe("Invalid backup code.");
  });

  /*
   * The password gate must sit IN FRONT of the code. A backup code is a string
   * off a printed list with no device behind it, so a route that accepted one
   * without the password would make a photographed list a complete credential
   * -- strictly worse than the authenticator it stands in for.
   *
   * `consumeCode` not being reached is the sharper half of the assertion: a
   * handler that checked the password only AFTER spending the code would still
   * refuse the login, while quietly burning one of the ten codes the real
   * owner is saving, on every guess an attacker makes.
   */
  it("refuses a correct code when the password is wrong, without touching the code", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

    await postBackupCode({ password: "not the password" });

    expect(loginSucceeded()).toBe(false);
    expect(consumeCode).not.toHaveBeenCalled();
    expect(sessionViolations()).toEqual([]);
  });

  /*
   * An account with no two factor mandate has no second step to recover from
   * -- /login would have signed this caller straight in. Accepting a code here
   * would spend one of a finite, unrecoverable set to buy the user nothing,
   * quietly eroding the reserve they were keeping for the day they do need it.
   */
  it("refuses an account that does not have two factor auth enabled", async () => {
    const user: User = await storedUser({ enableTwoFactorAuth: false });

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

    const result: InvokeResult = await postBackupCode();

    expect(loginSucceeded()).toBe(false);
    expect(refusalMessage(result)).toBe(
      "Two factor authentication is not enabled for this account.",
    );
    expect(consumeCode).not.toHaveBeenCalled();
  });

  /*
   * A mandated account with nothing set up behind the mandate is not at the
   * challenge screen at all -- /login sends it through enrolment, which needs
   * only the password. Accepting a code here would let such a user spend one
   * code per sign-in forever, never being prompted to enrol the replacement
   * factor, until the set runs out and the account is genuinely lost.
   */
  it("refuses an account with no verified factor behind the mandate", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    totpFindBy.mockResolvedValue([] as never);
    webAuthnFindBy.mockResolvedValue([] as never);

    const result: InvokeResult = await postBackupCode();

    expect(loginSucceeded()).toBe(false);
    expect(refusalMessage(result)).toBe(
      "Two factor authentication is not set up for this account.",
    );
    expect(consumeCode).not.toHaveBeenCalled();
  });

  /*
   * An absent code must be named as absent. It would normalize to the empty
   * string and `consumeCode` refuses that on its own, so the login is refused
   * either way -- but "Invalid backup code." tells a user whose form did not
   * submit the field that their printed codes have stopped working, which is
   * the moment they give up and open a support ticket.
   */
  it.each([
    ["the key omitted entirely", { omitBackupCode: true }],
    ["an empty string", { backupCode: "" }],
    ["whitespace a copy-paste left behind", { backupCode: "   " }],
    ["a JSON null", { backupCode: null }],
  ] as Array<[string, PostBackupCodeInput]>)(
    "refuses %s before the code is ever looked up",
    async (_description: string, input: PostBackupCodeInput) => {
      const user: User = await storedUser();

      jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

      const result: InvokeResult = await postBackupCode(input);

      expect(loginSucceeded()).toBe(false);
      expect(refusalMessage(result)).toBe("Backup code is required.");
      expect(consumeCode).not.toHaveBeenCalled();
      expect(sessionViolations()).toEqual([]);
    },
  );
});

describe("the notification that a backup code was spent", () => {
  /*
   * THE COMPENSATING CONTROL FOR THE WHOLE FEATURE. A backup code turns
   * "password plus a device you are holding" into "password plus a string
   * somebody could have photographed", so the owner has to learn about it
   * through a channel the person who used the code does not control. The
   * remaining count travels with it because "you have 2 left" is what turns a
   * vague unease about an unfamiliar sign-in into an action.
   */
  it("mails the account holder, with the count that is actually left", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

    await postBackupCode();
    await flushDetachedWork();

    expect(sendTwoFactorBackupCodeUsedEmail).toHaveBeenCalledTimes(1);

    const violations: Array<string> = [];
    const mailed: { user: User; remainingCodeCount: number } =
      backupCodeEmailArgs();

    if (mailed.remainingCodeCount !== REMAINING_CODE_COUNT) {
      violations.push(
        `the mail carried a remaining count of ${String(
          mailed.remainingCodeCount,
        )} rather than the ${String(REMAINING_CODE_COUNT)} the service reported`,
      );
    }

    if (mailed.user.email?.toString() !== USER_EMAIL) {
      violations.push(
        "the mail was addressed to something other than the account's own email",
      );
    }

    if (countUnusedForUser.mock.calls.length === 0) {
      violations.push("the remaining count was never read from the service");
    }

    expect(violations).toEqual([]);
  });

  /*
   * A refused attempt spent nothing, so there is nothing to notify about.
   * Mailing here would be worse than noise: an attacker guessing codes could
   * flood the owner's inbox until the real notification -- the one that says a
   * code actually worked -- is indistinguishable from the failures.
   */
  it("sends nothing when the code was refused", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    consumeCode.mockResolvedValue(false as never);

    await postBackupCode();
    await flushDetachedWork();

    expect(sendTwoFactorBackupCodeUsedEmail).not.toHaveBeenCalled();
  });

  /*
   * The user has already proved the password and spent a real, single-use
   * code by the time the mail is attempted -- and the code does not come back.
   * Failing the login because SMTP is unreachable would lock them out with the
   * notification that says they are not locked out, and would cost them
   * another code on every retry.
   */
  it("still signs the user in when the notification cannot be sent", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    sendTwoFactorBackupCodeUsedEmail.mockRejectedValue(
      new Error("SMTP is unreachable") as never,
    );

    const result: InvokeResult = await postBackupCode();
    await flushDetachedWork();

    expect(loginSucceeded()).toBe(true);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(result.nextError).toBeNull();
  });

  /*
   * THE SAME HAZARD ONE STEP EARLIER, and the one that actually bites. The
   * remaining-count read is a database round trip, and it happens AFTER the
   * conditional UPDATE that spends the code has already committed.
   *
   * If it were on the critical path, a transient database failure there would
   * answer a successful authentication with a 500 while the credential that
   * bought it no longer exists -- and the user's only recourse would be to try
   * the next code off their printed list, and burn that one the same way, all
   * the way down to none. A user recovering a locked-out account is exactly
   * the person who cannot afford that.
   *
   * So the count, the mail and the log line run detached, and this is the test
   * that keeps them there: awaiting any of them again turns this red.
   */
  it("still signs the user in when the remaining count cannot be read", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    countUnusedForUser.mockRejectedValue(
      new Error("Database not connected") as never,
    );

    const result: InvokeResult = await postBackupCode();
    await flushDetachedWork();

    const violations: Array<string> = [];

    if (!loginSucceeded()) {
      violations.push(
        "a login whose code was already spent was refused because a bookkeeping read failed",
      );
    }

    if (createSession.mock.calls.length !== 1) {
      violations.push("no session was issued");
    }

    if (result.nextError) {
      violations.push(
        `the failure escaped to the error handler: ${String(
          (result.nextError as Error).message,
        )}`,
      );
    }

    // The mail cannot be sent without the count, but the sign-in stands.
    if (sendTwoFactorBackupCodeUsedEmail.mock.calls.length !== 0) {
      violations.push("a notification was sent with no count to report");
    }

    expect(violations).toEqual([]);
  });
});

describe("POST /login -- offering the recovery route at the challenge screen", () => {
  /*
   * The challenge screen can only offer "use a backup code" if it is told
   * whether there are any. Offering it to a user with none sends them, at the
   * moment they are already locked out and panicking, to a route that can only
   * refuse them; withholding it from a user who HAS codes hides the only door
   * they have left.
   */
  it("reports how many codes are left, alongside the factors themselves", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);
    webAuthnFindBy.mockResolvedValue([verifiedWebAuthnRow()] as never);
    countUnusedForUser.mockResolvedValue(4 as never);

    await postLogin();

    const violations: Array<string> = [];
    const miscData: JSONObject = responseMiscData();

    if (miscData["backupCodeCount"] !== 4) {
      violations.push(
        `backupCodeCount was ${String(
          miscData["backupCodeCount"],
        )} rather than the 4 countUnusedForUser reported`,
      );
    }

    if ((miscData["totpAuthList"] as Array<unknown>).length !== 1) {
      violations.push("the TOTP list did not survive alongside the count");
    }

    if ((miscData["webAuthnList"] as Array<unknown>).length !== 1) {
      violations.push("the WebAuthn list did not survive alongside the count");
    }

    // The challenge screen is not a login -- no session may exist yet.
    expect(sessionViolations()).toEqual([]);
    expect(violations).toEqual([]);
  });

  /*
   * A COUNT, never the codes. Whoever reaches this response has proved a
   * password and nothing else, and the entire premise of a backup code is that
   * holding the password is not enough.
   */
  it("does not ship any code material with that count", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

    await postLogin();

    const serialized: string = JSON.stringify(responseMiscData());

    expect(serialized).not.toContain("codeHash");
    expect(serialized).not.toContain("backupCodes");
  });
});

describe("the route's own guards", () => {
  /*
   * The backup code step continues a login whose captcha was already solved,
   * and hCaptcha tokens are single use. Demanding a fresh one would fail the
   * user who took a minute to find the piece of paper their codes are printed
   * on -- which is the ONLY user this route ever serves.
   */
  it("does not demand a fresh captcha", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

    await postBackupCode();

    expect(verifyCaptcha).not.toHaveBeenCalled();
  });

  /*
   * The body of this request carries a plaintext password and a live,
   * still-unspent recovery code. Log output reaches stdout, the recent-log
   * buffer and telemetry at once, so a code that appears there has been
   * published to every operator and every log sink at the instant it was
   * still valid.
   */
  it("never logs the submitted code or the password", async () => {
    const user: User = await storedUser();

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

    await postBackupCode();

    const violations: Array<string> = [];
    const debugOutput: string = JSON.stringify(debugLog.mock.calls);
    const infoOutput: string = JSON.stringify(infoLog.mock.calls);

    /*
     * Checked first so the assertions below cannot pass vacuously. A handler
     * that logged nothing at all would satisfy every "does not contain" test
     * here forever, and the next person to add a log line would inherit a
     * guard that had quietly stopped guarding anything.
     */
    if (!debugOutput.includes("backup-code")) {
      violations.push(
        "the handler logged no stage line, so this test proves nothing about what it logs",
      );
    }

    if (debugOutput.includes(VALID_CODE)) {
      violations.push("the backup code appeared in debug output");
    }

    if (debugOutput.includes(PASSWORD)) {
      violations.push("the password appeared in debug output");
    }

    if (infoOutput.includes(VALID_CODE)) {
      violations.push("the backup code appeared in info output");
    }

    if (infoOutput.includes(PASSWORD)) {
      violations.push("the password appeared in info output");
    }

    expect(violations).toEqual([]);
  });

  /*
   * Registration ORDER is the point. This route re-submits the email and
   * password and runs the same `verifyHashedColumnValue` as /login, so it is a
   * password oracle in its own right, and an unlimited one is a hole in the
   * fence rather than merely an unguarded route -- an attacker refused at
   * /login simply points the same guesses here. A limiter registered BEHIND
   * the handler would count attempts it had already served, which is not a
   * limit.
   *
   * IdentityRateLimit.test.ts owns what the bucket actually permits; this is
   * only the assertion that the new route was not registered bare.
   */
  it("registers the two factor rate limiter in front of the handler", () => {
    const handlers: Array<RouteHandler> = mockRouter.matchAll(
      "post",
      BACKUP_CODE_URI,
    );

    expect(handlers.length).toBeGreaterThan(1);
    expect(handlers[handlers.length - 1]).toBe(
      mockRouter.match("post", BACKUP_CODE_URI),
    );
  });
});
