import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
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
 * GHSA-3qqq-hprx-g2jw -- the /signup end of the first-Master-Admin election.
 *
 * The route used to decide the outcome itself:
 *
 *     const userCount = await UserService.countBy({ query: {} });
 *     partialUser.isMasterAdmin = userCount.isZero();
 *
 * A count read here and an insert issued later are two separate statements with
 * nothing between them, so two signups arriving together both read zero and both
 * became Master Admin. The decision now belongs to
 * UserService.createUserOnSignup, which makes it under a Redis mutex that also
 * covers the insert (see
 * Common/Tests/Server/Services/UserServiceFirstMasterAdminElection.test.ts).
 *
 * What has to hold at THIS layer, and is what these tests pin:
 *
 *   - the route hands the decision over instead of making one. Any surviving
 *     count-then-assign here would re-open the race no matter how well the
 *     service is locked, so "createUserOnSignup was called and create was not"
 *     is the load-bearing assertion.
 *   - the route hard-clears isMasterAdmin off the request body. Signup creates
 *     with isRoot, which bypasses the column's empty `create: []` access
 *     control -- an isMasterAdmin the client sent would otherwise be persisted
 *     verbatim.
 *   - the invited-user branch, which UPDATEs an existing row rather than
 *     inserting, never touches the column at all.
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

let mockBillingEnabled: boolean = false;

/*
 * IsBillingEnabled is a module-level constant read from process.env at import
 * time, and the test runner exports BILLING_ENABLED=true. Both deployment
 * shapes have to be reachable from one file, so it is served through a getter
 * instead -- Authentication.ts reads it as a property off the module object on
 * every request, so a getter is enough to flip the deployment shape per test.
 *
 * defineProperty rather than `{ ...actual, get IsBillingEnabled() {} }`: at
 * target ES2017 the object spread downlevels to Object.assign, which would
 * evaluate the getter once and copy the resulting value as a plain property.
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
const userCountBy: jest.Mock = jest.fn();

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
      countBy: (...args: Array<unknown>): unknown => {
        return userCountBy(...args);
      },
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

/*
 * Claiming an invited account needs a registration token from the invitation
 * email (GHSA-qg84-6hrg-mr5g). Held true here so the update path stays
 * reachable -- what this file is about is which fields that update writes, not
 * how the claim is authorized. InvitedAccountClaim.test.ts covers the gate.
 */
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
      email: { _type: "Email", value: "new-user@example.com" },
      password: { _type: "HashedString", value: "correct-horse-battery" },
      name: { _type: "Name", value: "New User" },
      companyName: "Example Inc",
      ...(data || {}),
    },
  };
};

/*
 * The same body plus the registration token an invited person carries over
 * from their invitation email. The value only has to be a well-formed id --
 * the route checks the shape before handing it to UserRegistrationToken, which
 * is stubbed to accept it above.
 */
const invitedSignupBody: SignupBodyFunction = (
  data?: Record<string, unknown>,
): unknown => {
  return {
    ...(signupBody(data) as Record<string, unknown>),
    miscDataProps: {
      registrationToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
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

describe("Identity /signup -- Master Admin is never decided by the route", () => {
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

    userCreateUserOnSignup.mockImplementation(
      async (data: Record<string, any>): Promise<unknown> => {
        // Stands in for the service: the elected value comes back on the row.
        const user: Record<string, any> = data["user"] as Record<string, any>;
        user["_id"] = "22222222-2222-4222-8222-222222222222";
        return user;
      },
    );
  });

  describe("self-hosted (billing disabled)", () => {
    it("routes a new signup through the atomic election, not a bare create", async () => {
      await signup(signupBody());

      expect(userCreateUserOnSignup).toHaveBeenCalledTimes(1);

      /*
       * UserService.create bypasses the election entirely -- it would persist
       * whatever isMasterAdmin the row happened to carry, with no lock.
       */
      expect(userCreate).not.toHaveBeenCalled();
    });

    it("does not count users itself, which is the read half of the race", async () => {
      await signup(signupBody());

      /*
       * A count here is only ever used to decide isMasterAdmin, and a count
       * taken outside the lock is exactly the vulnerable pattern. There is no
       * legitimate reason for this route to run one again.
       */
      expect(userCountBy).not.toHaveBeenCalled();
    });

    it("hands over a user with isMasterAdmin already cleared", async () => {
      await signup(signupBody());

      expect(createdUser()["isMasterAdmin"]).toBe(false);
    });

    it("clears an isMasterAdmin sent in the request body", async () => {
      await signup(signupBody({ isMasterAdmin: true }));

      expect(createdUser()["isMasterAdmin"]).toBe(false);
    });

    it("clears a string-typed isMasterAdmin sent in the request body", async () => {
      await signup(signupBody({ isMasterAdmin: "true" }));

      expect(createdUser()["isMasterAdmin"]).toBe(false);
    });

    it("clears isMasterAdmin even when the body also spoofs other privileged columns", async () => {
      await signup(
        signupBody({
          isMasterAdmin: true,
          isBlocked: false,
          isDisabled: false,
        }),
      );

      expect(createdUser()["isMasterAdmin"]).toBe(false);
    });

    it("marks the email verified when there is no billing to gate on", async () => {
      await signup(signupBody());

      expect(createdUser()["isEmailVerified"]).toBe(true);
    });

    it("logs the caller in with the isMasterAdmin the service actually persisted", async () => {
      userCreateUserOnSignup.mockImplementation(
        async (data: Record<string, any>): Promise<unknown> => {
          const user: Record<string, any> = data["user"] as Record<string, any>;
          user["_id"] = "22222222-2222-4222-8222-222222222222";
          // The election ran and this caller won.
          user["isMasterAdmin"] = true;
          return user;
        },
      );

      await signup(signupBody());

      expect(signUserLoginToken).toHaveBeenCalledTimes(1);

      const tokenCall: Record<string, any> = signUserLoginToken.mock
        .calls[0]![0] as Record<string, any>;

      /*
       * The claim has to follow the persisted row, not the request. Reading it
       * back off `partialUser` would hand out a master-admin JWT to whichever
       * racer lost.
       */
      expect(tokenCall["tokenData"]["isMasterAdmin"]).toBe(true);
      expect(sendEntityResponse).toHaveBeenCalled();
    });

    it("gives the loser of an election an ordinary, non-master-admin session", async () => {
      await signup(signupBody());

      const tokenCall: Record<string, any> = signUserLoginToken.mock
        .calls[0]![0] as Record<string, any>;

      expect(tokenCall["tokenData"]["isMasterAdmin"]).toBe(false);
    });

    it("propagates a failed election instead of falling back to an unlocked create", async () => {
      userCreateUserOnSignup.mockRejectedValue(
        new Error("canceling statement due to lock timeout"),
      );

      const result: InvokeResult = await signup(signupBody());

      expect(result.nextError).toBeInstanceOf(Error);
      expect(userCreate).not.toHaveBeenCalled();
      expect(signUserLoginToken).not.toHaveBeenCalled();
    });
  });

  describe("hosted (billing enabled)", () => {
    beforeEach(() => {
      mockBillingEnabled = true;
    });

    it("still routes through the election helper", async () => {
      await signup(signupBody());

      expect(userCreateUserOnSignup).toHaveBeenCalledTimes(1);
      expect(userCreate).not.toHaveBeenCalled();
    });

    it("clears isMasterAdmin from the body", async () => {
      await signup(signupBody({ isMasterAdmin: true }));

      expect(createdUser()["isMasterAdmin"]).toBe(false);
    });

    it("leaves the email unverified so the verification mail still gates the account", async () => {
      await signup(signupBody());

      expect(createdUser()["isEmailVerified"]).toBe(false);
    });
  });

  describe("invited user completing signup (existing row, no password)", () => {
    beforeEach(() => {
      userFindOneBy.mockResolvedValue({
        _id: "33333333-3333-4333-8333-333333333333",
        id: new ObjectID("33333333-3333-4333-8333-333333333333"),
        password: undefined,
      });

      userUpdateOneByIdAndFetch.mockResolvedValue({
        _id: "33333333-3333-4333-8333-333333333333",
        id: new ObjectID("33333333-3333-4333-8333-333333333333"),
        email: {
          toString: (): string => {
            return "invited@example.com";
          },
        },
        isMasterAdmin: false,
      });
    });

    it("updates the existing row instead of creating one", async () => {
      await signup(invitedSignupBody({ email: "invited@example.com" }));

      expect(userUpdateOneByIdAndFetch).toHaveBeenCalledTimes(1);
      expect(userCreateUserOnSignup).not.toHaveBeenCalled();
      expect(userCreate).not.toHaveBeenCalled();
    });

    it("never writes isMasterAdmin on the update path", async () => {
      await signup(invitedSignupBody({ isMasterAdmin: true }));

      const call: Record<string, any> = userUpdateOneByIdAndFetch.mock
        .calls[0]![0] as Record<string, any>;

      /*
       * There is nothing to elect here: a row already existing means the
       * instance is not empty. The update must carry only the fields signup
       * fills in, so an invited account can never be promoted by re-signing up.
       *
       * isEmailVerified is on that list because the registration token this
       * request spent arrived by email, which is the same proof /verify-email
       * asks for.
       */
      expect(Object.keys(call["data"])).toEqual([
        "password",
        "name",
        "companyPhoneNumber",
        "companyName",
        "isEmailVerified",
      ]);
      expect(call["data"]["isMasterAdmin"]).toBeUndefined();
    });
  });

  describe("existing user with a password", () => {
    it("is rejected without creating or electing anything", async () => {
      userFindOneBy.mockResolvedValue({
        _id: "44444444-4444-4444-8444-444444444444",
        id: new ObjectID("44444444-4444-4444-8444-444444444444"),
        password: "already-hashed",
      });

      await signup(signupBody());

      expect(sendErrorResponse).toHaveBeenCalled();
      expect(userCreateUserOnSignup).not.toHaveBeenCalled();
      expect(userCreate).not.toHaveBeenCalled();
      expect(userUpdateOneByIdAndFetch).not.toHaveBeenCalled();
    });
  });
});
