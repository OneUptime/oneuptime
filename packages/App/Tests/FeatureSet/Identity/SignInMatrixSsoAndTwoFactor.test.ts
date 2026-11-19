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
import { SSO_REQUIRED_SIGN_IN_MESSAGE } from "Common/Types/SSO/SignInMethods";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * EVERY SIGN-IN, FOR EVERY ACCOUNT THESE CHANGES TOUCH (#9666, #9688).
 *
 * Neither issue changes who signs in, and this holds that, for every
 * combination of:
 *
 *   - the server requiring single sign-on, or not;
 *   - a master admin, or not;
 *   - two-factor authentication off, on with a second step set up, or on
 *     with none - the state a master admin's requirement creates, and the
 *     one the profile used to let anybody switch on (#9666);
 *
 * through a password (POST /login) and a passkey (POST /passkey-login),
 * driven through their real handlers with the real rule (SsoRequiredSignIn)
 * and only the server's setting and the account's rows stood in:
 *
 *   - while SSO is required, nobody but a master admin signs in without it,
 *     however their two-factor authentication stands - so a password or a
 *     passkey somebody set before is dormant, as SsoManagedSignIn says, and
 *     no challenge or enrolment is started for them;
 *   - a master admin is never kept out, while SSO is required or not: a
 *     password with nothing else signs in, one with a second step is asked
 *     for it, and one required to use it with nothing set up is walked
 *     through enrolment - never refused;
 *   - an account switched on with nothing set up is walked through
 *     enrolment, not locked out - the profile now says "Setup needed"
 *     about it, never "Enabled";
 *   - a passkey is a sign-in of its own, with no second step after it.
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

// The server's Require SSO to Sign In.
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
const USER_ID: string = "57575757-5757-4575-8575-575757575757";
const ORIGIN: string = "https://oneuptime.example.com";
const PASSKEY_COOKIE: string = "oneuptime-passkey-login";
const CHALLENGE_ID: string = "d".repeat(43);
const PENDING_ENROLMENT_ID: string = "58585858-5858-4585-8585-585858585858";

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

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (data: { select: Record<string, unknown> }): unknown => {
        return Promise.resolve(projectOntoSelect(data.select));
      },
      findOneById: (data: { select: Record<string, unknown> }): unknown => {
        return Promise.resolve(projectOntoSelect(data.select));
      },
      verifyHashedColumnValue: (data: {
        plainValue: string;
      }): Promise<boolean> => {
        return Promise.resolve(data.plainValue === PASSWORD);
      },
      updateOneBy: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/UserRegistrationToken", () => {
  return { __esModule: true, default: { consumeRegistrationToken: jest.fn() } };
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

// Authenticator apps: the verified ones (findBy), a pending enrolment (findOneBy, create).
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

// Security keys and passkeys: the verified ones (findBy), and a passkey's sign-in.
const webAuthnFindBy: jest.Mock = jest.fn();
const verifyPasskeyAuthentication: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserWebAuthnService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (...args: Array<unknown>): unknown => {
        return webAuthnFindBy(...args);
      },
      verifyAuthentication: jest.fn(),
      verifyPasskeyAuthentication: (...args: Array<unknown>): unknown => {
        return verifyPasskeyAuthentication(...args);
      },
    },
  };
});

jest.mock("Common/Server/Services/MobilePasskeyLoginService", () => {
  return {
    __esModule: true,
    default: {
      validateRequest: jest.fn(),
      storeChallengeContext: jest.fn(),
      consumeChallengeContext: (): Promise<null> => {
        return Promise.resolve(null);
      },
      createAuthorizationCode: jest.fn(),
      exchangeAuthorizationCode: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/UserTwoFactorBackupCodeService", () => {
  return {
    __esModule: true,
    default: {
      countUnusedForUser: (): Promise<number> => {
        return Promise.resolve(10);
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

enum TwoFactor {
  Off = "off",
  OnWithASecondStep = "on, with an authenticator app",
  OnWithNothingSetUp = "on, with nothing set up",
}

enum Outcome {
  SignedIn = "signed in",
  AskedForTheSecondStep = "asked for the second step",
  WalkedThroughEnrolment = "walked through enrolment",
  RefusedForSso = "refused: sign in with SSO",
}

type Answer = { error: Error | null };

async function invoke(
  uri: string,
  body: unknown,
  cookies: Record<string, string> = {},
): Promise<Answer> {
  const handler: RouteHandler = mockRouter.match("post", uri);
  const req: ExpressRequest = buildRequest(body, {
    headers: { origin: ORIGIN },
  });
  (req as unknown as { cookies: Record<string, string> }).cookies = cookies;
  const res: ExpressResponse = buildResponse();

  let error: Error | null = null;

  await handler(req, res, ((err?: Error): void => {
    if (err) {
      error = err;
    }
  }) as unknown as NextFunction);

  return { error };
}

function storeAccount(data: {
  isMasterAdmin: boolean;
  twoFactor: TwoFactor;
}): void {
  storedRow = {
    _id: USER_ID,
    email: new Email(USER_EMAIL),
    name: "Ada Lovelace",
    password: "stored-hash",
    passwordSalt: "stored-salt",
    isEmailVerified: true,
    isMasterAdmin: data.isMasterAdmin,
    isBlocked: false,
    enableTwoFactorAuth: data.twoFactor !== TwoFactor.Off,
    timezone: null,
  };

  // The verified authenticator apps a sign-in's second step can ask for.
  totpFindBy.mockResolvedValue(
    data.twoFactor === TwoFactor.OnWithASecondStep
      ? [{ _id: ObjectID.generate().toString(), name: "1Password" }]
      : [],
  );
}

// What the answer said, whichever way it came.
function outcome(answer: Answer): Outcome | string {
  const sentError: Exception | undefined = (
    sendErrorResponse.mock.calls[0] as Array<unknown> | undefined
  )?.[2] as Exception | undefined;
  const error: Error | undefined = sentError || answer.error || undefined;

  if (error) {
    return error.message === SSO_REQUIRED_SIGN_IN_MESSAGE
      ? Outcome.RefusedForSso
      : `refused: ${error.message}`;
  }

  const miscData: JSONObject =
    ((
      (sendEntityResponse.mock.calls[0] as Array<unknown> | undefined)?.[4] as
        | JSONObject
        | undefined
    )?.["miscData"] as JSONObject | undefined) || {};

  if (miscData["twoFactorEnrolmentRequired"] === true) {
    return Outcome.WalkedThroughEnrolment;
  }

  if (Array.isArray(miscData["totpAuthList"])) {
    return Outcome.AskedForTheSecondStep;
  }

  if (typeof miscData["accessToken"] === "string") {
    return Outcome.SignedIn;
  }

  return "no answer";
}

// A session is handed out exactly when somebody is signed in.
function expectSessionIf(signedIn: boolean): void {
  expect(createSession).toHaveBeenCalledTimes(signedIn ? 1 : 0);
  expect(setUserCookie).toHaveBeenCalledTimes(signedIn ? 1 : 0);
}

beforeEach(() => {
  jest.clearAllMocks();

  totpFindOneBy.mockResolvedValue(null);
  totpCreate.mockResolvedValue({
    id: new ObjectID(PENDING_ENROLMENT_ID),
    twoFactorOtpUrl:
      "otpauth://totp/OneUptime:ada%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=OneUptime",
  });
  webAuthnFindBy.mockResolvedValue([]);
  verifyPasskeyAuthentication.mockImplementation(() => {
    return Promise.resolve(projectOntoSelect({ _id: true }));
  });
  createSession.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
  });
});

type PasswordCase = {
  isSsoRequired: boolean;
  isMasterAdmin: boolean;
  twoFactor: TwoFactor;
  expected: Outcome;
};

const PASSWORD_CASES: Array<PasswordCase> = [];

for (const isSsoRequired of [false, true]) {
  for (const isMasterAdmin of [false, true]) {
    for (const twoFactor of [
      TwoFactor.Off,
      TwoFactor.OnWithASecondStep,
      TwoFactor.OnWithNothingSetUp,
    ]) {
      let expected: Outcome;

      if (isSsoRequired && !isMasterAdmin) {
        expected = Outcome.RefusedForSso;
      } else if (twoFactor === TwoFactor.Off) {
        expected = Outcome.SignedIn;
      } else if (twoFactor === TwoFactor.OnWithASecondStep) {
        expected = Outcome.AskedForTheSecondStep;
      } else {
        expected = Outcome.WalkedThroughEnrolment;
      }

      PASSWORD_CASES.push({
        isSsoRequired,
        isMasterAdmin,
        twoFactor,
        expected,
      });
    }
  }
}

describe("POST /login: a password, for every account", () => {
  it.each(PASSWORD_CASES)(
    "SSO required: $isSsoRequired, master admin: $isMasterAdmin, two-factor authentication $twoFactor -> $expected",
    async (testCase: PasswordCase) => {
      getRequireSsoForLogin.mockResolvedValue(testCase.isSsoRequired);
      storeAccount(testCase);

      const answer: Answer = await invoke("/login", {
        data: {
          email: USER_EMAIL,
          password: { _type: "HashedString", value: PASSWORD },
        },
      });

      expect(outcome(answer)).toBe(testCase.expected);
      expectSessionIf(testCase.expected === Outcome.SignedIn);

      // A master admin is let through without the rule even being read.
      if (testCase.isMasterAdmin) {
        expect(getRequireSsoForLogin).not.toHaveBeenCalled();
      }

      // Somebody refused is never started on a challenge or an enrolment.
      if (testCase.expected === Outcome.RefusedForSso) {
        expect(totpFindBy).not.toHaveBeenCalled();
        expect(totpCreate).not.toHaveBeenCalled();
      }
    },
  );

  it("an account on with nothing set up is handed a QR code to enrol, and nothing that signs it in", async () => {
    getRequireSsoForLogin.mockResolvedValue(false);
    storeAccount({
      isMasterAdmin: false,
      twoFactor: TwoFactor.OnWithNothingSetUp,
    });

    await invoke("/login", {
      data: {
        email: USER_EMAIL,
        password: { _type: "HashedString", value: PASSWORD },
      },
    });

    const miscData: JSONObject = (
      sendEntityResponse.mock.calls[0]![4] as JSONObject
    )["miscData"] as JSONObject;

    expect(miscData["twoFactorAuthId"]).toBe(PENDING_ENROLMENT_ID);
    expect(String(miscData["twoFactorOtpUrl"])).toMatch(/^otpauth:\/\/totp\//);
    expect(miscData["accessToken"]).toBeUndefined();
    expectSessionIf(false);
  });
});

type PasskeyCase = {
  isSsoRequired: boolean;
  isMasterAdmin: boolean;
  twoFactor: TwoFactor;
  expected: Outcome;
};

const PASSKEY_CASES: Array<PasskeyCase> = [];

for (const isSsoRequired of [false, true]) {
  for (const isMasterAdmin of [false, true]) {
    for (const twoFactor of [
      TwoFactor.Off,
      TwoFactor.OnWithASecondStep,
      TwoFactor.OnWithNothingSetUp,
    ]) {
      PASSKEY_CASES.push({
        isSsoRequired,
        isMasterAdmin,
        twoFactor,
        expected:
          isSsoRequired && !isMasterAdmin
            ? Outcome.RefusedForSso
            : Outcome.SignedIn,
      });
    }
  }
}

describe("POST /passkey-login: a passkey, for every account", () => {
  it.each(PASSKEY_CASES)(
    "SSO required: $isSsoRequired, master admin: $isMasterAdmin, two-factor authentication $twoFactor -> $expected",
    async (testCase: PasskeyCase) => {
      getRequireSsoForLogin.mockResolvedValue(testCase.isSsoRequired);
      storeAccount(testCase);

      const answer: Answer = await invoke(
        "/passkey-login",
        { credential: { id: "credential" } },
        { [PASSKEY_COOKIE]: CHALLENGE_ID },
      );

      expect(outcome(answer)).toBe(testCase.expected);
      expectSessionIf(testCase.expected === Outcome.SignedIn);
      // A passkey is a sign-in of its own: no second step, no enrolment.
      expect(totpFindBy).not.toHaveBeenCalled();
      expect(totpCreate).not.toHaveBeenCalled();
    },
  );
});
