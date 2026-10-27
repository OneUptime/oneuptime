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
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SSO_REQUIRED_SIGN_IN_MESSAGE,
  SSO_REQUIRED_SIGN_UP_MESSAGE,
} from "Common/Types/SSO/SignInMethods";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * WHILE THE WHOLE SERVER REQUIRES SSO, ONLY SINGLE SIGN-ON SIGNS ANYONE IN -
 * EXCEPT MASTER ADMINS.
 *
 * Require SSO for Login for the whole server makes every project require
 * SSO of everyone but master admins, so a sign-in that is not SSO would open
 * none of them (issue #5193: the sign-in page still offered a password).
 * Every route here mints a session that is not SSO, and each one is driven
 * through its real handler with the real rule (Common/Server/Utils/
 * SsoRequiredSignIn), only the server's setting (GlobalConfigService) stood
 * in:
 *
 *   - POST /login, and a second step that finishes one (/verify-totp-auth);
 *   - POST /passkey-login, and the mobile app's half (/mobile-passkey-exchange);
 *   - POST /signup, a new account and an invitation's claim alike.
 *
 * For each: refused while SSO is required, after the credential is proved
 * and before anything is handed out or sent; a master admin signs in all the
 * same, without the setting even being read (so a setting that cannot be
 * read never keeps one out); everyone else is refused when it cannot be
 * read; and nothing changes while SSO is not required.
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

// The passkey routes hold a request to the server's own origin.
jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    Host: "oneuptime.example.com",
    HttpProtocol: "https://",
  };
});

// The server's Require SSO for Login: what each test says, or a failed read.
const getRequireSsoForLogin: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: {
      getRequireSsoForLogin: (...args: Array<unknown>): unknown => {
        return getRequireSsoForLogin(...args);
      },
    },
  };
});

const PASSWORD: string = "correct horse battery staple";
const USER_EMAIL: string = "ada@example.com";
const USER_ID: string = "55555555-5555-4555-8555-555555555555";
const REGISTRATION_TOKEN: string = "66666666-6666-4666-8666-666666666666";
const ORIGIN: string = "https://oneuptime.example.com";
const PASSKEY_COOKIE: string = "oneuptime-passkey-login";
const CHALLENGE_ID: string = "c".repeat(43);

// The user row as Postgres holds it; each lookup hands back what it selected.
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
const createUserOnSignup: jest.Mock = jest.fn();

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
      createUserOnSignup: (...args: Array<unknown>): unknown => {
        return createUserOnSignup(...args);
      },
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

const verifyPasskeyAuthentication: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserWebAuthnService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
      verifyAuthentication: jest.fn(),
      verifyPasskeyAuthentication: (...args: Array<unknown>): unknown => {
        return verifyPasskeyAuthentication(...args);
      },
    },
  };
});

const consumeChallengeContext: jest.Mock = jest.fn();
const createAuthorizationCode: jest.Mock = jest.fn();
const exchangeAuthorizationCode: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/MobilePasskeyLoginService", () => {
  return {
    __esModule: true,
    default: {
      validateRequest: jest.fn(),
      storeChallengeContext: jest.fn(),
      consumeChallengeContext: (...args: Array<unknown>): unknown => {
        return consumeChallengeContext(...args);
      },
      createAuthorizationCode: (...args: Array<unknown>): unknown => {
        return createAuthorizationCode(...args);
      },
      exchangeAuthorizationCode: (...args: Array<unknown>): unknown => {
        return exchangeAuthorizationCode(...args);
      },
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

const createSession: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: {
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

const shouldDisableSignup: jest.Mock = jest.fn();

jest.mock("Common/Server/DatabaseConfig", () => {
  return {
    __esModule: true,
    default: {
      shouldDisableSignup: (...args: Array<unknown>): unknown => {
        return shouldDisableSignup(...args);
      },
      getHost: (): Promise<unknown> => {
        return Promise.resolve({
          toString: (): string => {
            return "oneuptime.example.com";
          },
        });
      },
      getHttpProtocol: (): Promise<unknown> => {
        return Promise.resolve({
          toString: (): string => {
            return "https://";
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
      setCookie: jest.fn(),
      getRefreshTokenFromExpressRequest: (): undefined => {
        return undefined;
      },
    },
  };
});

const verifyCaptcha: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Captcha", () => {
  return {
    __esModule: true,
    default: {
      verifyCaptcha: (...args: Array<unknown>): unknown => {
        return verifyCaptcha(...args);
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

const sendVerificationEmail: jest.Mock = jest.fn();

jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: {
      sendVerificationEmail: (...args: Array<unknown>): unknown => {
        return sendVerificationEmail(...args);
      },
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

type InvokeResult = { nextError: Error | null };

type InvokeFunction = (
  uri: string,
  body: unknown,
  options?: { cookies?: Record<string, string> | undefined },
) => Promise<InvokeResult>;

const invoke: InvokeFunction = async (
  uri: string,
  body: unknown,
  options?: { cookies?: Record<string, string> | undefined },
): Promise<InvokeResult> => {
  const handler: RouteHandler = mockRouter.match("post", uri);
  const req: ExpressRequest = buildRequest(body, {
    headers: { origin: ORIGIN },
  });
  (req as unknown as { cookies: Record<string, string> }).cookies =
    options?.cookies || {};
  const res: ExpressResponse = buildResponse();

  let nextError: Error | null = null;

  const next: NextFunction = ((err?: Error): void => {
    if (err) {
      nextError = err;
    }
  }) as unknown as NextFunction;

  await handler(req, res, next);

  return { nextError };
};

type StoreUserFunction = (data?: {
  isMasterAdmin?: boolean;
  isEmailVerified?: boolean;
  enableTwoFactorAuth?: boolean;
  password?: string | null;
}) => void;

const storeUser: StoreUserFunction = (data?: {
  isMasterAdmin?: boolean;
  isEmailVerified?: boolean;
  enableTwoFactorAuth?: boolean;
  password?: string | null;
}): void => {
  storedRow = {
    _id: USER_ID,
    email: new Email(USER_EMAIL),
    name: "Ada Lovelace",
    password: data?.password === undefined ? "stored-hash" : data.password,
    passwordSalt: "stored-salt",
    isEmailVerified:
      data?.isEmailVerified === undefined ? true : data.isEmailVerified,
    isMasterAdmin: Boolean(data?.isMasterAdmin),
    isBlocked: false,
    enableTwoFactorAuth: Boolean(data?.enableTwoFactorAuth),
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

// The error a route answered with: sent itself, or handed to Express.
function answeredError(result: InvokeResult): Error | undefined {
  const sent: Exception | undefined = (
    sendErrorResponse.mock.calls[0] as Array<unknown> | undefined
  )?.[2] as Exception | undefined;

  return sent || result.nextError || undefined;
}

// Nothing a sign-in hands out was handed out.
function expectNoSession(): void {
  expect(createSession).not.toHaveBeenCalled();
  expect(setUserCookie).not.toHaveBeenCalled();
  expect(signUserLoginToken).not.toHaveBeenCalled();
  expect(sendEntityResponse).not.toHaveBeenCalled();
  expect(createAuthorizationCode).not.toHaveBeenCalled();
}

function expectRefusedForSso(result: InvokeResult): void {
  expect(answeredError(result)?.message).toBe(SSO_REQUIRED_SIGN_IN_MESSAGE);
  expectNoSession();
}

const DATABASE_UNAVAILABLE: Error = new Error("connection terminated");

beforeEach(() => {
  jest.clearAllMocks();

  storeUser();
  getRequireSsoForLogin.mockResolvedValue(false);
  shouldDisableSignup.mockResolvedValue(false);

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
  createUserOnSignup.mockImplementation(() => {
    return Promise.resolve(projectOntoSelect({ _id: true, email: true }));
  });

  createSession.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
  });
  signUserLoginToken.mockReturnValue("signed-user-token");

  totpFindBy.mockResolvedValue([]);
  totpFindOneBy.mockResolvedValue(null);
  consumeRegistrationToken.mockResolvedValue(true);

  verifyPasskeyAuthentication.mockImplementation(() => {
    return Promise.resolve(projectOntoSelect({ _id: true }));
  });
  consumeChallengeContext.mockResolvedValue(null);
  createAuthorizationCode.mockResolvedValue("oneuptime://passkey?code=1");
  exchangeAuthorizationCode.mockResolvedValue(new ObjectID(USER_ID));
});

describe("POST /login while the server requires SSO", () => {
  beforeEach(() => {
    getRequireSsoForLogin.mockResolvedValue(true);
  });

  it("refuses the right password, and hands out nothing", async () => {
    const result: InvokeResult = await invoke("/login", credentials());

    expectRefusedForSso(result);
  });

  // Only the account's holder learns why: a wrong password is answered as always.
  it("answers a wrong password as always, without reading the rule", async () => {
    const result: InvokeResult = await invoke(
      "/login",
      credentials({}, "a wrong password"),
    );

    expect(answeredError(result)?.message).toBe(
      "Invalid login: Email or password does not match.",
    );
    expect(getRequireSsoForLogin).not.toHaveBeenCalled();
    expectNoSession();
  });

  it("starts no two factor challenge or enrolment for the account", async () => {
    storeUser({ enableTwoFactorAuth: true });
    totpFindBy.mockResolvedValue([{ _id: ObjectID.generate().toString() }]);

    const result: InvokeResult = await invoke("/login", credentials());

    expectRefusedForSso(result);
    expect(totpFindBy).not.toHaveBeenCalled();
  });

  // Not a verification link for a sign-in that cannot happen.
  it("mails an unverified address no verification link", async () => {
    storeUser({ isEmailVerified: false });

    const result: InvokeResult = await invoke("/login", credentials());

    expectRefusedForSso(result);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("refuses a second step started before SSO was required, before its code is checked", async () => {
    storeUser({ enableTwoFactorAuth: true });

    const result: InvokeResult = await invoke(
      "/verify-totp-auth",
      credentials({
        code: "123456",
        twoFactorAuthId: ObjectID.generate().toString(),
      }),
    );

    expectRefusedForSso(result);
    expect(totpFindOneBy).not.toHaveBeenCalled();
  });

  it("signs a master admin in with their password, without reading the rule", async () => {
    storeUser({ isMasterAdmin: true });

    const result: InvokeResult = await invoke("/login", credentials());

    expect(answeredError(result)).toBeUndefined();
    expect(getRequireSsoForLogin).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(sendEntityResponse).toHaveBeenCalledTimes(1);
  });
});

describe("POST /login when the rule cannot be read", () => {
  beforeEach(() => {
    getRequireSsoForLogin.mockRejectedValue(DATABASE_UNAVAILABLE);
  });

  // A failed read is never "not required".
  it("refuses everyone but master admins with the failure", async () => {
    const result: InvokeResult = await invoke("/login", credentials());

    expect(answeredError(result)).toBe(DATABASE_UNAVAILABLE);
    expectNoSession();
  });

  it("still signs a master admin in", async () => {
    storeUser({ isMasterAdmin: true });

    const result: InvokeResult = await invoke("/login", credentials());

    expect(answeredError(result)).toBeUndefined();
    expect(createSession).toHaveBeenCalledTimes(1);
  });
});

describe("POST /login while the server does not require SSO", () => {
  it("signs in as before", async () => {
    const result: InvokeResult = await invoke("/login", credentials());

    expect(answeredError(result)).toBeUndefined();
    expect(getRequireSsoForLogin).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(sendEntityResponse).toHaveBeenCalledTimes(1);
  });
});

describe("POST /passkey-login", () => {
  const passkeyCookies: Record<string, string> = {
    [PASSKEY_COOKIE]: CHALLENGE_ID,
  };

  it("refuses a verified passkey while the server requires SSO", async () => {
    getRequireSsoForLogin.mockResolvedValue(true);

    const result: InvokeResult = await invoke(
      "/passkey-login",
      { credential: { id: "credential" } },
      { cookies: passkeyCookies },
    );

    expect(verifyPasskeyAuthentication).toHaveBeenCalledTimes(1);
    expectRefusedForSso(result);
  });

  it("hands a mobile sign-in no code while the server requires SSO", async () => {
    getRequireSsoForLogin.mockResolvedValue(true);
    consumeChallengeContext.mockResolvedValue({ codeChallenge: "x" });

    const result: InvokeResult = await invoke(
      "/passkey-login",
      { credential: { id: "credential" } },
      { cookies: { [PASSKEY_COOKIE]: `mobile.${CHALLENGE_ID}` } },
    );

    expectRefusedForSso(result);
    expect(createAuthorizationCode).not.toHaveBeenCalled();
  });

  it("signs a master admin in, without reading the rule", async () => {
    getRequireSsoForLogin.mockResolvedValue(true);
    storeUser({ isMasterAdmin: true });

    const result: InvokeResult = await invoke(
      "/passkey-login",
      { credential: { id: "credential" } },
      { cookies: passkeyCookies },
    );

    expect(answeredError(result)).toBeUndefined();
    expect(getRequireSsoForLogin).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("signs in as before while the server does not require SSO", async () => {
    const result: InvokeResult = await invoke(
      "/passkey-login",
      { credential: { id: "credential" } },
      { cookies: passkeyCookies },
    );

    expect(answeredError(result)).toBeUndefined();
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("refuses everyone but master admins when the rule cannot be read", async () => {
    getRequireSsoForLogin.mockRejectedValue(DATABASE_UNAVAILABLE);

    const result: InvokeResult = await invoke(
      "/passkey-login",
      { credential: { id: "credential" } },
      { cookies: passkeyCookies },
    );

    expect(answeredError(result)).toBe(DATABASE_UNAVAILABLE);
    expectNoSession();
  });
});

describe("POST /mobile-passkey-exchange", () => {
  // A code handed out before SSO became required finishes nowhere.
  it("exchanges no code for a session while the server requires SSO", async () => {
    getRequireSsoForLogin.mockResolvedValue(true);

    const result: InvokeResult = await invoke("/mobile-passkey-exchange", {
      code: "authorization-code",
    });

    expect(exchangeAuthorizationCode).toHaveBeenCalledTimes(1);
    expectRefusedForSso(result);
  });

  it("still signs a master admin in to the app", async () => {
    getRequireSsoForLogin.mockResolvedValue(true);
    storeUser({ isMasterAdmin: true });

    const result: InvokeResult = await invoke("/mobile-passkey-exchange", {
      code: "authorization-code",
    });

    expect(answeredError(result)).toBeUndefined();
    expect(createSession).toHaveBeenCalledTimes(1);
  });
});

describe("POST /signup while the server requires SSO", () => {
  function signUpBody(miscDataProps: JSONObject = {}): JSONObject {
    return {
      data: {
        email: "newcomer@example.com",
        password: "a long enough passphrase for signup",
        name: "Newcomer",
      },
      miscDataProps: miscDataProps,
    };
  }

  beforeEach(() => {
    getRequireSsoForLogin.mockResolvedValue(true);
  });

  it("makes no account, and says to sign in with SSO", async () => {
    const result: InvokeResult = await invoke("/signup", signUpBody());

    expect(answeredError(result)?.message).toBe(SSO_REQUIRED_SIGN_UP_MESSAGE);
    expect(createUserOnSignup).not.toHaveBeenCalled();
    expectNoSession();
  });

  // Refused first: no sign-up check, no captcha, no lookup of the address.
  it("is refused before anything else is looked at", async () => {
    await invoke("/signup", signUpBody());

    expect(shouldDisableSignup).not.toHaveBeenCalled();
    expect(verifyCaptcha).not.toHaveBeenCalled();
    expect(userFindOneBy).not.toHaveBeenCalled();
  });

  // The invited person signs in with SSO instead: the invitation stays unspent.
  it("does not let an invitation be claimed with a password", async () => {
    storeUser({ password: null });

    const result: InvokeResult = await invoke(
      "/signup",
      signUpBody({ registrationToken: REGISTRATION_TOKEN }),
    );

    expect(answeredError(result)?.message).toBe(SSO_REQUIRED_SIGN_UP_MESSAGE);
    expect(consumeRegistrationToken).not.toHaveBeenCalled();
    expect(userUpdateOneByIdAndFetch).not.toHaveBeenCalled();
    expectNoSession();
  });

  it("makes no account when the rule cannot be read", async () => {
    getRequireSsoForLogin.mockRejectedValue(DATABASE_UNAVAILABLE);

    const result: InvokeResult = await invoke("/signup", signUpBody());

    expect(answeredError(result)).toBe(DATABASE_UNAVAILABLE);
    expect(createUserOnSignup).not.toHaveBeenCalled();
    expectNoSession();
  });
});

describe("POST /signup while the server does not require SSO", () => {
  it("goes on to the sign-up checks as before", async () => {
    await invoke("/signup", {
      data: {
        email: "newcomer@example.com",
        password: "a long enough passphrase for signup",
        name: "Newcomer",
      },
    });

    expect(getRequireSsoForLogin).toHaveBeenCalledTimes(1);
    expect(shouldDisableSignup).toHaveBeenCalledTimes(1);
    expect(verifyCaptcha).toHaveBeenCalledTimes(1);
  });
});
