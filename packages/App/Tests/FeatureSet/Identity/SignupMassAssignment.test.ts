import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import { SIGNUP_USER_COLUMNS } from "../../../FeatureSet/Identity/Utils/SignupUser";
import Exception from "Common/Types/Exception/Exception";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import ObjectID from "Common/Types/ObjectID";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * /signup must not let the request body choose the row it writes, or any
 * column the server owns.
 *
 * The route used to build the new user with `BaseModel.fromJSON(req.body.data,
 * User)` and create it as root. Root skips column create permissions, and
 * `fromJSON` copies `_id` (mapping `id` onto it) like any other column. TypeORM's
 * save() UPDATEs the row an entity's id names, so
 *
 *     { _id: <victim's user id>, email: attacker@x, password: ... }
 *
 * rewrote the victim's email and password in place and signed the attacker in
 * to the victim's account. Every other User column in the body -- isBlocked,
 * resetPasswordToken, twoFactorAuthEnabled, createdByUserId, ... -- was written
 * verbatim too.
 *
 * The stand-in for UserService.createUserOnSignup below behaves like save():
 * a user that arrives with an `_id` keeps it. So a route that forwarded the
 * body's id would hand the victim's id to the session -- which is what these
 * tests would catch.
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

let mockBillingEnabled: boolean = false;

// See SignupMasterAdminElection.test.ts for why defineProperty, not a spread.
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

jest.mock("Common/Server/Services/EmailVerificationTokenService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      create: (...args: Array<unknown>): unknown => {
        return createEmailVerificationToken(...args);
      },
    },
  };
});

const userFindOneBy: jest.Mock = jest.fn();
const userUpdateOneByIdAndFetch: jest.Mock = jest.fn();
const userCreate: jest.Mock = jest.fn();
const userCreateUserOnSignup: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return userFindOneBy(...args);
      },
      updateOneBy: jest.fn(),
      updateOneById: jest.fn(),
      updateOneByIdAndFetch: (...args: Array<unknown>): unknown => {
        return userUpdateOneByIdAndFetch(...args);
      },
      create: (...args: Array<unknown>): unknown => {
        return userCreate(...args);
      },
      createUserOnSignup: (...args: Array<unknown>): unknown => {
        return userCreateUserOnSignup(...args);
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

const createSession: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: {
      createSession: (...args: Array<unknown>): unknown => {
        return createSession(...args);
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
      signUserLoginToken: (...args: Array<unknown>): string => {
        signUserLoginToken(...args);
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
    },
  };
});

jest.mock("Common/Server/Utils/UserRegistrationToken", () => {
  return {
    __esModule: true,
    REGISTRATION_TOKEN_EXPIRY_IN_DAYS: 7,
    default: {
      consumeRegistrationToken: (): Promise<boolean> => {
        return Promise.resolve(true);
      },
      generateRegistrationToken: jest.fn(),
      generateRegistrationLink: jest.fn(),
      getRegistrationLink: jest.fn(),
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

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/Authentication";

const VICTIM_ID: string = "33333333-3333-4333-8333-333333333333";
const NEW_USER_ID: string = "22222222-2222-4222-8222-222222222222";

type InvokeResult = {
  nextError: Exception | null;
};

type InvokeFunction = (body: unknown) => Promise<InvokeResult>;

const signup: InvokeFunction = async (body: unknown): Promise<InvokeResult> => {
  const handler: RouteHandler = mockRouter.match("post", "/signup");
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

type SignupBodyFunction = (data?: Record<string, unknown>) => unknown;

const signupBody: SignupBodyFunction = (
  data?: Record<string, unknown>,
): unknown => {
  return {
    data: {
      email: { _type: "Email", value: "attacker@example.com" },
      password: { _type: "HashedString", value: "correct-horse-battery" },
      name: { _type: "Name", value: "Attacker" },
      companyName: "Example Inc",
      ...(data || {}),
    },
  };
};

type CreatedUserFunction = () => Record<string, any>;

// The model instance the route handed to UserService.createUserOnSignup.
const createdUser: CreatedUserFunction = (): Record<string, any> => {
  const call: Record<string, any> = userCreateUserOnSignup.mock
    .calls[0]![0] as Record<string, any>;

  return call["user"] as Record<string, any>;
};

type SessionUserIdFunction = () => string | undefined;

// The account the session this request minted belongs to.
const sessionUserId: SessionUserIdFunction = (): string | undefined => {
  const tokenCall: Record<string, any> = signUserLoginToken.mock
    .calls[0]![0] as Record<string, any>;

  return tokenCall["tokenData"]["userId"]?.toString();
};

/*
 * Columns the server decides on every signup, whatever the body says. Present
 * on the handed-over user, but never from the request.
 */
const SERVER_SET_COLUMNS: Array<string> = ["isMasterAdmin", "isEmailVerified"];

describe("Identity /signup -- the body cannot pick the row or the privileged columns", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockBillingEnabled = false;

    userFindOneBy.mockResolvedValue(null);
    createEmailVerificationToken.mockResolvedValue(null);
    refreshUserAllPermissions.mockResolvedValue(null);
    createSession.mockResolvedValue({
      session: { id: new ObjectID("11111111-1111-4111-8111-111111111111") },
      refreshToken: "refresh-token",
      refreshTokenExpiresAt: new Date(),
    });

    /*
     * Like save(): an entity that already carries an id is written to (and
     * returned as) that row. Only an id-less one gets a fresh id.
     */
    userCreateUserOnSignup.mockImplementation(
      async (data: Record<string, any>): Promise<unknown> => {
        const user: Record<string, any> = data["user"] as Record<string, any>;
        user["_id"] = user["_id"] || NEW_USER_ID;
        return user;
      },
    );
  });

  describe.each([
    ["self-hosted (billing disabled)", false],
    ["hosted (billing enabled)", true],
  ])("%s", (_label: string, billingEnabled: boolean) => {
    beforeEach(() => {
      mockBillingEnabled = billingEnabled;
    });

    it("does not hand the service an `_id` from the body", async () => {
      const result: InvokeResult = await signup(signupBody({ _id: VICTIM_ID }));

      expect(result.nextError).toBeNull();
      expect(userCreateUserOnSignup).toHaveBeenCalledTimes(1);
      expect(createdUser()["_id"]).toBe(NEW_USER_ID);
    });

    it("does not hand the service an `id` from the body either", async () => {
      await signup(signupBody({ id: VICTIM_ID }));

      expect(userCreateUserOnSignup).toHaveBeenCalledTimes(1);
      expect(createdUser()["_id"]).toBe(NEW_USER_ID);
    });

    it("writes the welcome verification token against the new account, not the named one", async () => {
      await signup(signupBody({ _id: VICTIM_ID }));

      const tokenCall: Record<string, any> = createEmailVerificationToken.mock
        .calls[0]![0] as Record<string, any>;

      expect(tokenCall["data"]["userId"]?.toString()).toBe(NEW_USER_ID);
    });

    it("never updates an existing user", async () => {
      await signup(signupBody({ _id: VICTIM_ID }));

      expect(userUpdateOneByIdAndFetch).not.toHaveBeenCalled();
      expect(userCreate).not.toHaveBeenCalled();
    });

    it("hands over only allow-listed columns, plus the ones the server decides", async () => {
      await signup(
        signupBody({
          _id: VICTIM_ID,
          isMasterAdmin: true,
          isEmailVerified: true,
          isBlocked: false,
          isDisabled: false,
          twoFactorAuthEnabled: true,
          enableTwoFactorAuth: true,
          resetPasswordToken: "attacker-chosen-reset-token",
          resetPasswordExpires: "2099-01-01T00:00:00.000Z",
          paymentProviderCustomerId: "cus_attacker",
          promotionName: "free-forever",
          slug: "someone-elses-slug",
          passwordSalt: "attacker-chosen-salt",
          timezone: "Europe/London",
          profilePictureId: "44444444-4444-4444-8444-444444444444",
          createdByUserId: "55555555-5555-4555-8555-555555555555",
          newUnverifiedTemporaryEmail: "victim@example.com",
          webauthnAuthenticationChallenge: "attacker-challenge",
          deletedAt: "2000-01-01T00:00:00.000Z",
          version: 99,
        }),
      );

      const user: Record<string, any> = createdUser();

      const handedOver: Array<string> = (
        user as unknown as {
          getTableColumns: () => { columns: Array<string> };
        }
      )
        .getTableColumns()
        .columns.filter((column: string) => {
          // `_id` is the stand-in service's own, assigned after the route.
          return column !== "_id" && user[column] !== undefined;
        });

      for (const column of handedOver) {
        expect([...SIGNUP_USER_COLUMNS, ...SERVER_SET_COLUMNS]).toContain(
          column,
        );
      }

      expect(user["isMasterAdmin"]).toBe(false);
      expect(user["isEmailVerified"]).toBe(!billingEnabled);
    });

    it("still hands over what the Register page sends", async () => {
      await signup(
        signupBody({
          companyPhoneNumber: { _type: "Phone", value: "+11234567890" },
          utmSource: "newsletter",
          utmUrl: "https://oneuptime.com/?utm_source=newsletter",
          clickIds: { gclid: "gclid-value" },
          firstTouchAttribution: { utmSource: "newsletter" },
        }),
      );

      const user: Record<string, any> = createdUser();

      expect(user["email"]?.toString()).toBe("attacker@example.com");
      expect(user["name"]?.toString()).toBe("Attacker");
      expect(user["password"]?.toString()).toBe("correct-horse-battery");
      expect(user["companyName"]).toBe("Example Inc");
      expect(user["companyPhoneNumber"]?.toString()).toBe("+11234567890");
      expect(user["utmSource"]).toBe("newsletter");
      expect(user["utmUrl"]).toBe(
        "https://oneuptime.com/?utm_source=newsletter",
      );
      expect(user["clickIds"]).toEqual({ gclid: "gclid-value" });
      expect(user["firstTouchAttribution"]).toEqual({
        utmSource: "newsletter",
      });
    });
  });

  describe("self-hosted, where signup signs the caller straight in", () => {
    it("issues the session for the new account, never the one the body named", async () => {
      await signup(signupBody({ _id: VICTIM_ID }));

      expect(signUserLoginToken).toHaveBeenCalledTimes(1);
      expect(sessionUserId()).toBe(NEW_USER_ID);
      expect(refreshUserAllPermissions).toHaveBeenCalledWith(
        new ObjectID(NEW_USER_ID),
      );
    });
  });

  describe("invited user completing signup", () => {
    const INVITED_ID: string = "66666666-6666-4666-8666-666666666666";

    beforeEach(() => {
      userFindOneBy.mockResolvedValue({
        _id: INVITED_ID,
        id: new ObjectID(INVITED_ID),
        password: undefined,
      });

      userUpdateOneByIdAndFetch.mockResolvedValue({
        _id: INVITED_ID,
        id: new ObjectID(INVITED_ID),
        email: {
          toString: (): string => {
            return "invited@example.com";
          },
        },
        isMasterAdmin: false,
      });
    });

    it("updates the row found by email, whatever id the body names", async () => {
      await signup({
        ...(signupBody({
          email: "invited@example.com",
          _id: VICTIM_ID,
        }) as Record<string, unknown>),
        miscDataProps: {
          registrationToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        },
      });

      expect(userUpdateOneByIdAndFetch).toHaveBeenCalledTimes(1);

      const call: Record<string, any> = userUpdateOneByIdAndFetch.mock
        .calls[0]![0] as Record<string, any>;

      expect(call["id"]?.toString()).toBe(INVITED_ID);
      expect(userCreateUserOnSignup).not.toHaveBeenCalled();
    });
  });
});
