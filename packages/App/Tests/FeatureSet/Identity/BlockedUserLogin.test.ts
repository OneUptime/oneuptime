import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import User from "Common/Models/DatabaseModels/User";
import Email from "Common/Types/Email";
import Exception from "Common/Types/Exception/Exception";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A USER BLOCKED BY A MASTER ADMIN CANNOT SIGN IN OR KEEP A SESSION ALIVE.
 *
 * The Admin Dashboard's Block action promises exactly that, and until this
 * fix only the two passkey routes read `User.isBlocked`. Everything else that
 * mints a session let a blocked user straight back in:
 *
 *   - POST /login, and the four second steps that finish it (TOTP, WebAuthn,
 *     backup code, forced TOTP enrolment), all of which end in
 *     finalizeUserLogin;
 *   - POST /refresh-token, which rotates a 30-day refresh token into a fresh
 *     access token for as long as the session lives;
 *   - POST /signup claiming an invited account, which also ends in a session.
 *
 * Every route is driven through its real handler. UserService is mocked, but
 * its lookups honour `select`: a handler that stops SELECTING isBlocked reads
 * it as undefined and would sail through, and these tests have to catch that
 * rather than be fooled by a fixture that carries every column.
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

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
const USER_EMAIL: string = "blocked.user@example.com";
const USER_ID: string = "55555555-5555-4555-8555-555555555555";
const VALID_REGISTRATION_TOKEN: string = "66666666-6666-4666-8666-666666666666";

/*
 * The user row as Postgres holds it. Every lookup hands back only the
 * columns it selected, exactly as TypeORM would.
 */
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
const userFindOneById: jest.Mock = jest.fn();
const userUpdateOneByIdAndFetch: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return userFindOneBy(...args);
      },
      findOneById: (...args: Array<unknown>): unknown => {
        return userFindOneById(...args);
      },
      updateOneByIdAndFetch: (...args: Array<unknown>): unknown => {
        return userUpdateOneByIdAndFetch(...args);
      },
      verifyHashedColumnValue: (data: {
        plainValue: string;
      }): Promise<boolean> => {
        return Promise.resolve(data.plainValue === PASSWORD);
      },
      updateOneBy: jest.fn(),
      updateOneById: jest.fn(),
      createUserOnSignup: jest.fn(),
    },
  };
});

const consumeRegistrationToken: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/UserRegistrationToken", () => {
  return {
    __esModule: true,
    default: {
      consumeRegistrationToken: (...args: Array<unknown>): unknown => {
        return consumeRegistrationToken(...args);
      },
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
const totpCreate: jest.Mock = jest.fn();

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
      updateOneById: jest.fn(),
      deleteBy: jest.fn(),
    },
  };
});

const webAuthnVerifyAuthentication: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserWebAuthnService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
      verifyAuthentication: (...args: Array<unknown>): unknown => {
        return webAuthnVerifyAuthentication(...args);
      },
    },
  };
});

const consumeBackupCode: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserTwoFactorBackupCodeService", () => {
  return {
    __esModule: true,
    default: {
      countUnusedForUser: (): Promise<number> => {
        return Promise.resolve(0);
      },
      consumeCode: (...args: Array<unknown>): unknown => {
        return consumeBackupCode(...args);
      },
      generateForUserIfNone: jest.fn(),
    },
  };
});

const createSession: jest.Mock = jest.fn();
const findActiveSessionByRefreshToken: jest.Mock = jest.fn();
const revokeSessionById: jest.Mock = jest.fn();
const renewSessionWithNewRefreshToken: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: {
      createSession: (...args: Array<unknown>): unknown => {
        return createSession(...args);
      },
      findActiveSessionByRefreshToken: (...args: Array<unknown>): unknown => {
        return findActiveSessionByRefreshToken(...args);
      },
      revokeSessionById: (...args: Array<unknown>): unknown => {
        return revokeSessionById(...args);
      },
      renewSessionWithNewRefreshToken: (...args: Array<unknown>): unknown => {
        return renewSessionWithNewRefreshToken(...args);
      },
      revokeAllSessionsByUserId: jest.fn(),
      revokeSessionByRefreshToken: jest.fn(),
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
const removeAllCookies: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Cookie", () => {
  return {
    __esModule: true,
    default: {
      setUserCookie: (...args: Array<unknown>): unknown => {
        return setUserCookie(...args);
      },
      removeAllCookies: (...args: Array<unknown>): unknown => {
        return removeAllCookies(...args);
      },
      removeCookie: jest.fn(),
      getRefreshTokenFromExpressRequest: (): undefined => {
        return undefined;
      },
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

const signUserLoginToken: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/JsonWebToken", () => {
  return {
    __esModule: true,
    default: {
      sign: (): string => {
        return "signed-token";
      },
      signUserLoginToken: (...args: Array<unknown>): unknown => {
        return signUserLoginToken(...args);
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
      sendEntityResponse: (...args: Array<unknown>): unknown => {
        return sendEntityResponse(...args);
      },
      sendJsonObjectResponse: (...args: Array<unknown>): unknown => {
        return sendJsonObjectResponse(...args);
      },
      sendEmptySuccessResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/Authentication";

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

type StoreUserFunction = (data: {
  isBlocked: boolean;
  enableTwoFactorAuth?: boolean;
  password?: string | null;
}) => void;

const storeUser: StoreUserFunction = (data: {
  isBlocked: boolean;
  enableTwoFactorAuth?: boolean;
  password?: string | null;
}): void => {
  storedRow = {
    _id: USER_ID,
    email: new Email(USER_EMAIL),
    name: "Blocked User",
    password: data.password === undefined ? "stored-hash" : data.password,
    passwordSalt: "stored-salt",
    isEmailVerified: true,
    isMasterAdmin: false,
    isBlocked: data.isBlocked,
    enableTwoFactorAuth: Boolean(data.enableTwoFactorAuth),
    timezone: null,
  };
};

// Exactly what the sign-in page posts: everything nested under `data`.
function credentials(extra: JSONObject = {}, password?: string): JSONObject {
  return {
    data: {
      email: USER_EMAIL,
      password: {
        _type: "HashedString",
        value: password === undefined ? PASSWORD : password,
      },
      ...extra,
    },
  };
}

function sentError(): Exception | undefined {
  return (
    sendErrorResponse.mock.calls[0] as Array<unknown> | undefined
  )?.[2] as Exception | undefined;
}

/*
 * The refusal, and the absence of everything a sign-in hands out. Checked
 * together: an error response sent AFTER a cookie was set would still leave
 * the blocked user holding a session.
 */
function expectBlockedAndNoSession(): void {
  expect(sendErrorResponse).toHaveBeenCalledTimes(1);
  expect(sentError()?.message).toBe(ExceptionMessages.UserBlocked);
  expect(createSession).not.toHaveBeenCalled();
  expect(setUserCookie).not.toHaveBeenCalled();
  expect(signUserLoginToken).not.toHaveBeenCalled();
  expect(sendEntityResponse).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.clearAllMocks();

  storeUser({ isBlocked: false });

  userFindOneBy.mockImplementation((data: { select: JSONObject }) => {
    return Promise.resolve(projectOntoSelect(data.select));
  });
  userFindOneById.mockImplementation((data: { select: JSONObject }) => {
    return Promise.resolve(projectOntoSelect(data.select));
  });
  userUpdateOneByIdAndFetch.mockImplementation(
    (data: { select: JSONObject }) => {
      return Promise.resolve(projectOntoSelect(data.select));
    },
  );

  createSession.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
  });
  renewSessionWithNewRefreshToken.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "rotated-refresh-token",
    refreshTokenExpiresAt: new Date(),
  });
  signUserLoginToken.mockReturnValue("signed-user-token");

  totpFindBy.mockResolvedValue([]);
  totpFindOneBy.mockResolvedValue(null);
  consumeBackupCode.mockResolvedValue(true);
  consumeRegistrationToken.mockResolvedValue(true);
});

describe("POST /login — a blocked user", () => {
  it("is refused with the correct password, and gets no session", async () => {
    storeUser({ isBlocked: true });

    await invoke("/login", credentials());

    expectBlockedAndNoSession();
  });

  it("reads isBlocked from the columns the lookup selected", async () => {
    storeUser({ isBlocked: true });

    await invoke("/login", credentials());

    const select: JSONObject = (
      userFindOneBy.mock.calls[0]![0] as { select: JSONObject }
    ).select;

    expect(select["isBlocked"]).toBe(true);
  });

  // The block is disclosed only to somebody who has proved the password.
  it("gets the ordinary wrong-password answer with the wrong password", async () => {
    storeUser({ isBlocked: true });

    await invoke("/login", credentials({}, "a wrong password"));

    expect(sendErrorResponse).toHaveBeenCalledTimes(1);
    expect(sentError()?.message).toBe(
      "Invalid login: Email or password does not match.",
    );
    expect(createSession).not.toHaveBeenCalled();
  });

  it("is not shown the two factor challenge", async () => {
    storeUser({ isBlocked: true, enableTwoFactorAuth: true });
    totpFindBy.mockResolvedValue([{ _id: ObjectID.generate().toString() }]);

    await invoke("/login", credentials());

    expectBlockedAndNoSession();
    expect(totpFindBy).not.toHaveBeenCalled();
  });

  // Two factor auth required, nothing enrolled: /login would otherwise start an enrolment.
  it("does not have a TOTP enrolment created for them", async () => {
    storeUser({ isBlocked: true, enableTwoFactorAuth: true });

    await invoke("/login", credentials());

    expectBlockedAndNoSession();
    expect(totpCreate).not.toHaveBeenCalled();
  });
});

describe("the second steps of a login — a blocked user", () => {
  it("POST /verify-totp-auth is refused before the code is checked", async () => {
    storeUser({ isBlocked: true, enableTwoFactorAuth: true });

    await invoke(
      "/verify-totp-auth",
      credentials({
        code: "123456",
        twoFactorAuthId: ObjectID.generate().toString(),
      }),
    );

    expectBlockedAndNoSession();
    expect(totpFindOneBy).not.toHaveBeenCalled();
  });

  it("POST /verify-webauthn-auth is refused before the assertion is checked", async () => {
    storeUser({ isBlocked: true, enableTwoFactorAuth: true });

    await invoke("/verify-webauthn-auth", credentials({ credential: {} }));

    expectBlockedAndNoSession();
    expect(webAuthnVerifyAuthentication).not.toHaveBeenCalled();
  });

  // A spent backup code is gone for good; a blocked account must not burn one.
  it("POST /verify-backup-code is refused without spending the code", async () => {
    storeUser({ isBlocked: true, enableTwoFactorAuth: true });

    await invoke(
      "/verify-backup-code",
      credentials({ backupCode: "ABCDE-FGHJK" }),
    );

    expectBlockedAndNoSession();
    expect(consumeBackupCode).not.toHaveBeenCalled();
  });

  it("POST /verify-totp-enrolment is refused before the enrolment is looked at", async () => {
    storeUser({ isBlocked: true, enableTwoFactorAuth: true });

    await invoke(
      "/verify-totp-enrolment",
      credentials({
        code: "123456",
        twoFactorAuthId: ObjectID.generate().toString(),
      }),
    );

    expectBlockedAndNoSession();
    expect(totpFindOneBy).not.toHaveBeenCalled();
  });
});

describe("POST /login — a user who is not blocked", () => {
  it("still signs in", async () => {
    storeUser({ isBlocked: false });

    await invoke("/login", credentials());

    expect(sendErrorResponse).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(sendEntityResponse).toHaveBeenCalledTimes(1);
  });
});

describe("POST /refresh-token", () => {
  function activeSession(): Record<string, unknown> {
    return {
      id: new ObjectID("77777777-7777-4777-8777-777777777777"),
      userId: new ObjectID(USER_ID),
      refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(10),
      additionalInfo: { isGlobalLogin: true },
    };
  }

  beforeEach(() => {
    findActiveSessionByRefreshToken.mockResolvedValue(activeSession());
  });

  it("refuses a blocked user's refresh token and mints nothing", async () => {
    storeUser({ isBlocked: true });

    await invoke("/refresh-token", { refreshToken: "live-refresh-token" });

    expect(sendErrorResponse).toHaveBeenCalledTimes(1);
    expect(sentError()).toBeInstanceOf(NotAuthenticatedException);
    expect(sentError()?.message).toBe(ExceptionMessages.UserBlocked);

    expect(renewSessionWithNewRefreshToken).not.toHaveBeenCalled();
    expect(setUserCookie).not.toHaveBeenCalled();
    expect(signUserLoginToken).not.toHaveBeenCalled();
    expect(sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  it("revokes the session the refresh token belonged to, and clears the cookies", async () => {
    storeUser({ isBlocked: true });

    await invoke("/refresh-token", { refreshToken: "live-refresh-token" });

    expect(revokeSessionById).toHaveBeenCalledTimes(1);
    expect((revokeSessionById.mock.calls[0]![0] as ObjectID).toString()).toBe(
      "77777777-7777-4777-8777-777777777777",
    );
    expect(revokeSessionById.mock.calls[0]![1]).toEqual({
      reason: "User blocked",
    });
    expect(removeAllCookies).toHaveBeenCalledTimes(1);
  });

  it("reads isBlocked from the columns the lookup selected", async () => {
    storeUser({ isBlocked: true });

    await invoke("/refresh-token", { refreshToken: "live-refresh-token" });

    const select: JSONObject = (
      userFindOneById.mock.calls[0]![0] as { select: JSONObject }
    ).select;

    expect(select["isBlocked"]).toBe(true);
  });

  it("still renews the session of a user who is not blocked", async () => {
    storeUser({ isBlocked: false });

    await invoke("/refresh-token", { refreshToken: "live-refresh-token" });

    expect(sendErrorResponse).not.toHaveBeenCalled();
    expect(renewSessionWithNewRefreshToken).toHaveBeenCalledTimes(1);
    expect(sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    expect(revokeSessionById).not.toHaveBeenCalled();
  });
});

describe("POST /signup — claiming the invitation of a blocked account", () => {
  function claimBody(): JSONObject {
    return {
      data: {
        email: USER_EMAIL,
        password: "attacker-chosen-passphrase",
        name: "Whoever",
      },
      miscDataProps: { registrationToken: VALID_REGISTRATION_TOKEN },
    };
  }

  it("sets no password and issues no session", async () => {
    storeUser({ isBlocked: true, password: null });

    await invoke("/signup", claimBody());

    expect(consumeRegistrationToken).toHaveBeenCalledTimes(1);
    expect(sendErrorResponse).toHaveBeenCalledTimes(1);
    expect(sentError()?.message).toBe(ExceptionMessages.UserBlocked);
    expect(userUpdateOneByIdAndFetch).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(setUserCookie).not.toHaveBeenCalled();
  });

  // Without the invitation's token, the caller learns nothing about the account.
  it("does not disclose the block to a caller without the invitation's token", async () => {
    storeUser({ isBlocked: true, password: null });
    consumeRegistrationToken.mockResolvedValue(false);

    await invoke("/signup", claimBody());

    expect(sendErrorResponse).not.toHaveBeenCalled();
    expect(userUpdateOneByIdAndFetch).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("still lets the invited user of an account that is not blocked claim it", async () => {
    storeUser({ isBlocked: false, password: null });

    await invoke("/signup", claimBody());

    expect(sendErrorResponse).not.toHaveBeenCalled();
    expect(userUpdateOneByIdAndFetch).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledTimes(1);
  });
});
