import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import Exception from "Common/Types/Exception/Exception";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * ON THE HOSTED SERVICE, A NEW ACCOUNT PROVES ITS ADDRESS BEFORE IT GETS IN.
 *
 * /signup used to create the account unverified, mail a "please verify" link,
 * and then sign the caller straight in anyway. The session it minted is a
 * full-privilege JWT that UserAuthorization validates without ever looking at
 * `isEmailVerified`, so the verification mail was a formality: anybody could
 * sign up as any address and use the product under it for as long as they
 * liked. Only the NEXT password login was gated.
 *
 * The assertions that matter here are therefore about what was NOT handed
 * out: no session, no cookie, no token -- and about the two ways in that must
 * still work: the welcome link, and signing in afterwards.
 *
 * Also pinned here, because each is part of the same gate:
 *
 *   - self-hosted installs (billing off) keep signing people straight in.
 *     Many have no working SMTP, so their addresses are verified by fiat;
 *   - a claimed invitation keeps signing people straight in. Its registration
 *     token travelled inside an email, so the mailbox is already proven;
 *   - /login checks the password BEFORE it looks at verification, so only the
 *     account holder can make it send mail or learn the address is unverified;
 *   - /reset-password verifies the address, because its token proves the
 *     mailbox exactly as the welcome link does.
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

let mockBillingEnabled: boolean = true;

/*
 * Served through a getter so one file can run as both deployment shapes. See
 * SignupMasterAdminElection.test.ts for why defineProperty, not a spread.
 */
jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual, __esModule: true };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return mockBillingEnabled;
    },
  });

  return mocked;
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

const createEmailVerificationToken: jest.Mock = jest.fn();
const findEmailVerificationToken: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/EmailVerificationTokenService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return findEmailVerificationToken(...args);
      },
      create: (...args: Array<unknown>): unknown => {
        return createEmailVerificationToken(...args);
      },
      deleteOneBy: jest.fn(),
    },
  };
});

const userFindOneBy: jest.Mock = jest.fn();
const userUpdateOneBy: jest.Mock = jest.fn();
const userUpdateOneById: jest.Mock = jest.fn();
const userUpdateOneByIdAndFetch: jest.Mock = jest.fn();
const userCreateUserOnSignup: jest.Mock = jest.fn();
const userVerifyHashedColumnValue: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return userFindOneBy(...args);
      },
      updateOneBy: (...args: Array<unknown>): unknown => {
        return userUpdateOneBy(...args);
      },
      updateOneById: (...args: Array<unknown>): unknown => {
        return userUpdateOneById(...args);
      },
      updateOneByIdAndFetch: (...args: Array<unknown>): unknown => {
        return userUpdateOneByIdAndFetch(...args);
      },
      create: jest.fn(),
      createUserOnSignup: (...args: Array<unknown>): unknown => {
        return userCreateUserOnSignup(...args);
      },
      verifyHashedColumnValue: (...args: Array<unknown>): unknown => {
        return userVerifyHashedColumnValue(...args);
      },
      countBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn() },
  };
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
      findBy: (): Array<unknown> => {
        return [];
      },
      findOneBy: jest.fn(),
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

// The load-bearing "was anybody signed in?" probes: the session row...
const createSession: jest.Mock = jest.fn();
const revokeAllSessionsByUserId: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: {
      createSession: (...args: Array<unknown>): unknown => {
        return createSession(...args);
      },
      revokeAllSessionsByUserId: (...args: Array<unknown>): unknown => {
        return revokeAllSessionsByUserId(...args);
      },
      findActiveSessionByRefreshToken: jest.fn(),
      revokeSessionById: jest.fn(),
      revokeSessionByRefreshToken: jest.fn(),
      renewSessionWithNewRefreshToken: jest.fn(),
    },
  };
});

const sendMail: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/MailService", () => {
  return {
    __esModule: true,
    default: {
      sendMail: (...args: Array<unknown>): Promise<void> => {
        sendMail(...args);
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
        const hostname: typeof import("Common/Types/API/Hostname") =
          jest.requireActual("Common/Types/API/Hostname");

        return Promise.resolve(new hostname.default("oneuptime.test"));
      },
      getHttpProtocol: (): Promise<unknown> => {
        const protocol: typeof import("Common/Types/API/Protocol") =
          jest.requireActual("Common/Types/API/Protocol");

        return Promise.resolve(protocol.default.HTTPS);
      },
    },
  };
});

// ...the cookie...
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

// ...and the bearer token the mobile app would take away instead.
const signUserLoginToken: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/JsonWebToken", () => {
  return {
    __esModule: true,
    default: {
      sign: (): string => {
        return "signed-token";
      },
      signUserLoginToken: (...args: Array<unknown>): string => {
        signUserLoginToken(...args);
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
      sendCompleteRegistrationEmail: jest.fn(),
    },
  };
});

const consumeRegistrationToken: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/UserRegistrationToken", () => {
  return {
    __esModule: true,
    REGISTRATION_TOKEN_EXPIRY_IN_DAYS: 7,
    default: {
      consumeRegistrationToken: (...args: Array<unknown>): unknown => {
        return consumeRegistrationToken(...args);
      },
      generateRegistrationToken: jest.fn(),
      generateRegistrationLink: jest.fn(),
      getRegistrationLink: jest.fn(),
    },
  };
});

const apiPost: jest.Mock = jest.fn();

jest.mock("Common/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): Promise<unknown> => {
        apiPost(...args);
        return Promise.resolve({});
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
const sendEmptySuccessResponse: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: (...args: Array<unknown>): unknown => {
        return sendErrorResponse(...args);
      },
      sendEmptySuccessResponse: (...args: Array<unknown>): unknown => {
        return sendEmptySuccessResponse(...args);
      },
      sendEntityResponse: (...args: Array<unknown>): unknown => {
        return sendEntityResponse(...args);
      },
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/Authentication";

const NEW_USER_ID: string = "22222222-2222-4222-8222-222222222222";
const NEW_USER_EMAIL: string = "new-user@example.com";
const E2E_FLAG: string = "EXPOSE_VERIFICATION_CODE_IN_API_RESPONSE_FOR_E2E";

type InvokeResult = {
  nextError: Exception | null;
};

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

type SignupBodyFunction = (
  data?: Record<string, unknown>,
  miscDataProps?: Record<string, unknown>,
) => unknown;

const signupBody: SignupBodyFunction = (
  data?: Record<string, unknown>,
  miscDataProps?: Record<string, unknown>,
): unknown => {
  return {
    data: {
      email: { _type: "Email", value: NEW_USER_EMAIL },
      password: { _type: "HashedString", value: "violet river lantern" },
      name: { _type: "Name", value: "New User" },
      companyName: "Example Inc",
      ...(data || {}),
    },
    ...(miscDataProps ? { miscDataProps } : {}),
  };
};

type CreatedUserFunction = () => Record<string, any>;

// The model the route handed to UserService.createUserOnSignup.
const createdUser: CreatedUserFunction = (): Record<string, any> => {
  const call: Record<string, any> = userCreateUserOnSignup.mock
    .calls[0]![0] as Record<string, any>;

  return call["user"] as Record<string, any>;
};

type EntityResponseFunction = () => {
  entity: unknown;
  miscData: Record<string, any>;
};

const entityResponse: EntityResponseFunction = (): {
  entity: unknown;
  miscData: Record<string, any>;
} => {
  expect(sendEntityResponse).toHaveBeenCalledTimes(1);

  const args: Array<unknown> = sendEntityResponse.mock.calls[0]!;
  const options: Record<string, any> = (args[4] || {}) as Record<string, any>;

  return {
    entity: args[2],
    miscData: (options["miscData"] || {}) as Record<string, any>,
  };
};

// Every way a session can leave this handler, checked together.
function expectNobodySignedIn(): void {
  expect(createSession).not.toHaveBeenCalled();
  expect(setUserCookie).not.toHaveBeenCalled();
  expect(signUserLoginToken).not.toHaveBeenCalled();
}

function expectSignedIn(): void {
  expect(createSession).toHaveBeenCalledTimes(1);
  expect(setUserCookie).toHaveBeenCalledTimes(1);
  expect(signUserLoginToken).toHaveBeenCalledTimes(1);
}

type CreatedTokenFunction = () => Record<string, any>;

// The EmailVerificationToken row the welcome email's link points at.
const createdToken: CreatedTokenFunction = (): Record<string, any> => {
  expect(createEmailVerificationToken).toHaveBeenCalledTimes(1);

  const call: Record<string, any> = createEmailVerificationToken.mock
    .calls[0]![0] as Record<string, any>;

  return call["data"] as Record<string, any>;
};

type WelcomeMailFunction = () => Record<string, any>;

const welcomeMail: WelcomeMailFunction = (): Record<string, any> => {
  expect(sendMail).toHaveBeenCalledTimes(1);

  return sendMail.mock.calls[0]![0] as Record<string, any>;
};

let savedE2eFlag: string | undefined;

beforeEach(() => {
  jest.clearAllMocks();

  mockBillingEnabled = true;
  savedE2eFlag = process.env[E2E_FLAG];
  delete process.env[E2E_FLAG];

  userFindOneBy.mockResolvedValue(null);
  createEmailVerificationToken.mockResolvedValue(null);
  sendVerificationEmail.mockResolvedValue(undefined);
  createSession.mockResolvedValue({
    session: { id: new ObjectID("11111111-1111-4111-8111-111111111111") },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
  });

  userCreateUserOnSignup.mockImplementation(
    async (data: Record<string, any>): Promise<unknown> => {
      // Stands in for the service: the row comes back with its new id.
      const user: Record<string, any> = data["user"] as Record<string, any>;
      user["_id"] = NEW_USER_ID;
      return user;
    },
  );
});

afterEach(() => {
  if (savedE2eFlag === undefined) {
    delete process.env[E2E_FLAG];
  } else {
    process.env[E2E_FLAG] = savedE2eFlag;
  }
});

describe("POST /signup on the hosted service (billing enabled)", () => {
  it("creates the account with its address unverified", async () => {
    await invoke("/signup", signupBody());

    expect(userCreateUserOnSignup).toHaveBeenCalledTimes(1);
    expect(createdUser()["isEmailVerified"]).toBe(false);
  });

  it("does not sign the new account in -- no session, no cookie, no token", async () => {
    /*
     * The regression test for the reported behaviour: sign up, land on the
     * dashboard, never open the email.
     */
    const result: InvokeResult = await invoke("/signup", signupBody());

    expect(result.nextError).toBeNull();
    expectNobodySignedIn();
  });

  it("cannot be talked into a session by a client that marks itself verified", async () => {
    /*
     * isEmailVerified is not something a request gets to assert. Signup
     * writes with isRoot, which bypasses column access control, so the route
     * has to overwrite it -- and it does, before the gate reads it.
     */
    await invoke(
      "/signup",
      signupBody({ isEmailVerified: true, isMasterAdmin: true }),
    );

    expect(createdUser()["isEmailVerified"]).toBe(false);
    expectNobodySignedIn();
  });

  it("tells the page to ask for the email to be checked", async () => {
    await invoke("/signup", signupBody());

    expect(entityResponse().miscData["emailVerificationRequired"]).toBe(true);
  });

  it("returns no account in the body, because nobody is signed in", async () => {
    await invoke("/signup", signupBody());

    /*
     * The entity a signed-in response carries is the caller's own account. A
     * caller who has proved nothing yet gets no description of the row, and
     * certainly not its password hash.
     */
    expect(entityResponse().entity).toBeNull();
  });

  it("mints a verification token bound to the new account and its address", async () => {
    await invoke("/signup", signupBody());

    const token: Record<string, any> = createdToken();

    expect(token["userId"].toString()).toBe(NEW_USER_ID);
    expect(token["email"].toString()).toBe(NEW_USER_EMAIL);
    expect(token["token"]).toBeInstanceOf(ObjectID);
  });

  it("gives the token a one-day life", async () => {
    const before: Date = OneUptimeDate.getCurrentDate();

    await invoke("/signup", signupBody());

    const expires: Date = createdToken()["expires"] as Date;
    const hours: number =
      (expires.getTime() - before.getTime()) / (60 * 60 * 1000);

    expect(hours).toBeGreaterThan(23);
    expect(hours).toBeLessThanOrEqual(24.1);
  });

  it("mails the welcome-and-verify link to the address that signed up", async () => {
    await invoke("/signup", signupBody());

    const mail: Record<string, any> = welcomeMail();
    const token: string = createdToken()["token"].toString();

    expect(mail["toEmail"].toString()).toBe(NEW_USER_EMAIL);
    expect(mail["vars"]["tokenVerifyUrl"]).toBe(
      "https://oneuptime.test/accounts/verify-email/" + token,
    );
  });

  it("never puts the verification token in the response", async () => {
    await invoke("/signup", signupBody());

    const token: string = createdToken()["token"].toString();
    const args: Array<unknown> = sendEntityResponse.mock.calls[0]!;
    const body: string = JSON.stringify([args[2], args[4]]);

    /*
     * The token IS the proof. Handing it to whoever made the request would let
     * them "verify" an address that is not theirs by reading the reply.
     */
    expect(body).not.toContain(token);
    expect(entityResponse().miscData["emailVerificationToken"]).toBeUndefined();
  });

  it.each(["", "false", "1", "TRUE", "yes"])(
    "keeps the token out of the response when the e2e flag is %p",
    async (value: string) => {
      process.env[E2E_FLAG] = value;

      await invoke("/signup", signupBody());

      const token: string = createdToken()["token"].toString();

      expect(
        JSON.stringify(sendEntityResponse.mock.calls[0]![4]),
      ).not.toContain(token);
    },
  );

  it("hands the token to the e2e stack only when its flag is exactly 'true'", async () => {
    /*
     * The CI end-to-end stack has no mailbox. This is the same narrow,
     * default-off seam UserEmailService uses for the same reason.
     */
    process.env[E2E_FLAG] = "true";

    await invoke("/signup", signupBody());

    const token: string = createdToken()["token"].toString();
    const { miscData } = entityResponse();

    expect(miscData["emailVerificationRequired"]).toBe(true);
    expect(miscData["emailVerificationToken"]).toBe(token);
    expectNobodySignedIn();
  });

  it("does not phone the self-hosted registry, even when asked to", async () => {
    await invoke(
      "/signup",
      signupBody(undefined, {
        notifySelfHosted: true,
      }),
    );

    expect(apiPost).not.toHaveBeenCalled();
  });

  it("still refuses an address that has already registered", async () => {
    userFindOneBy.mockResolvedValue({
      _id: NEW_USER_ID,
      id: new ObjectID(NEW_USER_ID),
      password: "$argon2id$already-set",
    });

    await invoke("/signup", signupBody());

    expect(sendErrorResponse).toHaveBeenCalledTimes(1);
    expect(userCreateUserOnSignup).not.toHaveBeenCalled();
    expect(createEmailVerificationToken).not.toHaveBeenCalled();
    expectNobodySignedIn();
  });
});

describe("POST /signup on a self-hosted install (billing disabled)", () => {
  beforeEach(() => {
    mockBillingEnabled = false;
  });

  it("marks the address verified up front", async () => {
    await invoke("/signup", signupBody());

    expect(createdUser()["isEmailVerified"]).toBe(true);
  });

  it("signs the new account straight in, as before", async () => {
    /*
     * Plenty of self-hosted installs have no working SMTP at all. Holding
     * their first user at "check your email" would lock them out of their own
     * instance.
     */
    await invoke("/signup", signupBody());

    expectSignedIn();
  });

  it("returns the account and no verification prompt", async () => {
    await invoke("/signup", signupBody());

    const { entity, miscData } = entityResponse();

    expect(entity).not.toBeNull();
    expect(miscData["emailVerificationRequired"]).toBeUndefined();
  });

  it("never exposes the token, even with the e2e flag on", async () => {
    process.env[E2E_FLAG] = "true";

    await invoke("/signup", signupBody());

    expect(entityResponse().miscData["emailVerificationToken"]).toBeUndefined();
  });

  it("still registers with the self-hosted registry when asked to", async () => {
    await invoke(
      "/signup",
      signupBody(undefined, {
        notifySelfHosted: true,
      }),
    );

    expect(apiPost).toHaveBeenCalledTimes(1);
  });
});

describe("POST /signup claiming an invitation on the hosted service", () => {
  const INVITED_USER_ID: string = "33333333-3333-4333-8333-333333333333";

  beforeEach(() => {
    userFindOneBy.mockResolvedValue({
      _id: INVITED_USER_ID,
      id: new ObjectID(INVITED_USER_ID),
      password: undefined,
    });

    consumeRegistrationToken.mockResolvedValue(true);

    userUpdateOneByIdAndFetch.mockResolvedValue({
      _id: INVITED_USER_ID,
      id: new ObjectID(INVITED_USER_ID),
      email: {
        toString: (): string => {
          return "invited@example.com";
        },
      },
      isMasterAdmin: false,
    });
  });

  it("signs the invited person in, because the invitation proved the mailbox", async () => {
    await invoke(
      "/signup",
      signupBody(undefined, {
        registrationToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
    );

    expect(
      (userUpdateOneByIdAndFetch.mock.calls[0]![0] as Record<string, any>)[
        "data"
      ]["isEmailVerified"],
    ).toBe(true);
    expectSignedIn();
    expect(entityResponse().miscData["emailVerificationRequired"]).toBe(
      undefined,
    );
  });

  it("does not ask them to verify again", async () => {
    await invoke(
      "/signup",
      signupBody(undefined, {
        registrationToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
    );

    expect(createEmailVerificationToken).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("gives an invitation claimed WITHOUT its token nothing at all", async () => {
    consumeRegistrationToken.mockResolvedValue(false);

    await invoke("/signup", signupBody());

    expect(userUpdateOneByIdAndFetch).not.toHaveBeenCalled();
    expectNobodySignedIn();
  });
});

/*
 * ---------------------------------------------------------------------------
 * /login is where an unverified account is held, and where it asks for a fresh
 * link. The password is checked first.
 * ---------------------------------------------------------------------------
 */

type StoredUserFunction = (
  overrides?: Record<string, unknown>,
) => Record<string, unknown>;

const storedUser: StoredUserFunction = (
  overrides?: Record<string, unknown>,
): Record<string, unknown> => {
  return {
    _id: NEW_USER_ID,
    id: new ObjectID(NEW_USER_ID),
    email: {
      toString: (): string => {
        return NEW_USER_EMAIL;
      },
    },
    name: {
      toString: (): string => {
        return "New User";
      },
    },
    password: "$argon2id$stored",
    passwordSalt: "salt",
    isMasterAdmin: false,
    isEmailVerified: false,
    isBlocked: false,
    enableTwoFactorAuth: false,
    ...(overrides || {}),
  };
};

const loginBody: () => unknown = (): unknown => {
  return {
    data: {
      email: NEW_USER_EMAIL,
      password: "violet river lantern",
    },
  };
};

type RefusalMessageFunction = () => string;

const refusalMessage: RefusalMessageFunction = (): string => {
  expect(sendErrorResponse).toHaveBeenCalledTimes(1);

  return (sendErrorResponse.mock.calls[0]![2] as Exception).message;
};

describe("POST /login with an unverified address", () => {
  it("does not mail a link, or say the address is unverified, for a wrong password", async () => {
    /*
     * The ordering this change fixed. Checked ahead of the password, anyone
     * who knew an address could make it send its owner mail on demand, and
     * the refusal told them the account existed and was still unverified.
     */
    userFindOneBy.mockResolvedValue(storedUser());
    userVerifyHashedColumnValue.mockResolvedValue(false);

    await invoke("/login", loginBody());

    expect(sendVerificationEmail).not.toHaveBeenCalled();
    expect(refusalMessage()).toBe(
      "Invalid login: Email or password does not match.",
    );
    expectNobodySignedIn();
  });

  it("mails a fresh link and refuses when the password is right", async () => {
    userFindOneBy.mockResolvedValue(storedUser());
    userVerifyHashedColumnValue.mockResolvedValue(true);

    await invoke("/login", loginBody());

    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(
      (sendVerificationEmail.mock.calls[0]![0] as Record<string, any>)[
        "id"
      ].toString(),
    ).toBe(NEW_USER_ID);
    expect(refusalMessage()).toContain("Email is not verified.");
    expectNobodySignedIn();
  });

  it("reports a block ahead of verification, and mails nothing to a blocked account", async () => {
    userFindOneBy.mockResolvedValue(storedUser({ isBlocked: true }));
    userVerifyHashedColumnValue.mockResolvedValue(true);

    await invoke("/login", loginBody());

    expect(refusalMessage()).toBe(ExceptionMessages.UserBlocked);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
    expectNobodySignedIn();
  });

  it.each([
    "/verify-totp-auth",
    "/verify-webauthn-auth",
    "/verify-backup-code",
  ])("is refused on the %s second step too", async (uri: string) => {
    userFindOneBy.mockResolvedValue(storedUser({ enableTwoFactorAuth: true }));
    userVerifyHashedColumnValue.mockResolvedValue(true);

    await invoke(uri, loginBody());

    expect(refusalMessage()).toContain("Email is not verified.");
    expectNobodySignedIn();
  });

  it("signs a verified account in with the right password", async () => {
    userFindOneBy.mockResolvedValue(storedUser({ isEmailVerified: true }));
    userVerifyHashedColumnValue.mockResolvedValue(true);

    await invoke("/login", loginBody());

    expect(sendVerificationEmail).not.toHaveBeenCalled();
    expect(sendErrorResponse).not.toHaveBeenCalled();
    expectSignedIn();
  });

  it("mails nothing for an address nobody has registered", async () => {
    userFindOneBy.mockResolvedValue(null);

    await invoke("/login", loginBody());

    expect(sendVerificationEmail).not.toHaveBeenCalled();
    expectNobodySignedIn();
  });
});

describe("POST /verify-email -- the welcome link", () => {
  const TOKEN: string = "44444444-4444-4444-8444-444444444444";

  const verifyBody: () => unknown = (): unknown => {
    return {
      data: {
        token: { _type: "ObjectID", value: TOKEN },
      },
    };
  };

  it("verifies the address the token was minted for", async () => {
    findEmailVerificationToken.mockResolvedValue({
      _id: "token-row",
      userId: new ObjectID(NEW_USER_ID),
      email: NEW_USER_EMAIL,
      expires: OneUptimeDate.getOneDayAfter(),
    });
    userFindOneBy.mockResolvedValue(storedUser());

    await invoke("/verify-email", verifyBody());

    expect(userUpdateOneBy).toHaveBeenCalledTimes(1);

    const update: Record<string, any> = userUpdateOneBy.mock
      .calls[0]![0] as Record<string, any>;

    expect(update["query"]["_id"]).toBe(NEW_USER_ID);
    expect(update["data"]["isEmailVerified"]).toBe(true);
    expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
  });

  it("does not sign anybody in -- the next step is the sign-in page", async () => {
    /*
     * The link is a bearer secret sitting in an inbox, and mail scanners
     * follow links. Making it a login link as well would turn every forwarded
     * or scanned welcome email into a session.
     */
    findEmailVerificationToken.mockResolvedValue({
      _id: "token-row",
      userId: new ObjectID(NEW_USER_ID),
      email: NEW_USER_EMAIL,
      expires: OneUptimeDate.getOneDayAfter(),
    });
    userFindOneBy.mockResolvedValue(storedUser());

    await invoke("/verify-email", verifyBody());

    expectNobodySignedIn();
  });

  it("refuses an expired link and verifies nothing", async () => {
    findEmailVerificationToken.mockResolvedValue({
      _id: "token-row",
      userId: new ObjectID(NEW_USER_ID),
      email: NEW_USER_EMAIL,
      expires: OneUptimeDate.getSomeDaysAgo(2),
    });

    await invoke("/verify-email", verifyBody());

    expect(refusalMessage()).toContain("Link expired.");
    expect(userUpdateOneBy).not.toHaveBeenCalled();
  });

  it("refuses an unknown link and verifies nothing", async () => {
    findEmailVerificationToken.mockResolvedValue(null);

    await invoke("/verify-email", verifyBody());

    expect(refusalMessage()).toContain("Invalid link.");
    expect(userUpdateOneBy).not.toHaveBeenCalled();
  });
});

describe("POST /reset-password -- the other emailed proof of the mailbox", () => {
  const resetBody: () => unknown = (): unknown => {
    return {
      data: {
        resetPasswordToken: "55555555-5555-4555-8555-555555555555",
        password: { _type: "HashedString", value: "violet river lantern" },
      },
    };
  };

  it("verifies the address along with setting the new password", async () => {
    /*
     * A person who never found their welcome email recovers through
     * forgot-password. Leaving the address unverified would send them round
     * again: reset, sign in, "please verify your email".
     */
    userFindOneBy.mockResolvedValue({
      ...storedUser(),
      resetPasswordExpires: OneUptimeDate.getOneDayAfter(),
    });

    await invoke("/reset-password", resetBody());

    expect(userUpdateOneById).toHaveBeenCalledTimes(1);

    const update: Record<string, any> = userUpdateOneById.mock
      .calls[0]![0] as Record<string, any>;

    expect(update["id"].toString()).toBe(NEW_USER_ID);
    expect(update["data"]["isEmailVerified"]).toBe(true);
    expect(update["data"]["password"]).toBeDefined();
    expect(update["data"]["resetPasswordToken"]).toBeNull();
  });

  it("still signs nobody in, and ends every other session", async () => {
    userFindOneBy.mockResolvedValue({
      ...storedUser(),
      resetPasswordExpires: OneUptimeDate.getOneDayAfter(),
    });

    await invoke("/reset-password", resetBody());

    expectNobodySignedIn();
    expect(revokeAllSessionsByUserId).toHaveBeenCalledTimes(1);
  });

  it("verifies nothing for an expired reset link", async () => {
    userFindOneBy.mockResolvedValue({
      ...storedUser(),
      resetPasswordExpires: OneUptimeDate.getSomeDaysAgo(2),
    });

    await invoke("/reset-password", resetBody());

    expect(refusalMessage()).toContain("Expired link.");
    expect(userUpdateOneById).not.toHaveBeenCalled();
  });

  it("verifies nothing for a reset link that matches no account", async () => {
    userFindOneBy.mockResolvedValue(null);

    await invoke("/reset-password", resetBody());

    expect(refusalMessage()).toContain("Invalid link.");
    expect(userUpdateOneById).not.toHaveBeenCalled();
  });
});
