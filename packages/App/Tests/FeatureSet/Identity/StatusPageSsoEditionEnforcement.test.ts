import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import { EnterpriseLicenseStatus } from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import Exception from "Common/Types/Exception/Exception";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import {
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

/*
 * ---------------------------------------------------------------------------------------------
 * A private status page's "Require SSO" by edition (design v2 section 0).
 *
 * The three password surfaces of a status page - /login, /forgot-password and
 * /reset-password - refuse with "Status Page supports authentication by SSO" when the page
 * requires SSO. That refusal is an Enterprise Edition control:
 *
 *   - Enterprise Edition loaded: the refusal holds whatever the license says (valid, grace,
 *     expired, missing, invalid). A lapsed license must never re-open password sign-in on a
 *     page whose owner requires SSO.
 *   - Community Edition: the status page SSO login routes do not exist, so the refusal would
 *     lock every private user out. The requirement is relaxed and the password flow runs as
 *     on any other page.
 * ---------------------------------------------------------------------------------------------
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

const privateUserFindOneBy: jest.Mock = jest.fn();
const privateUserUpdateOneBy: jest.Mock = jest.fn();
const privateUserUpdateOneById: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/StatusPagePrivateUserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return privateUserFindOneBy(...args);
      },
      findOneById: jest.fn(),
      updateOneBy: (...args: Array<unknown>): unknown => {
        return privateUserUpdateOneBy(...args);
      },
      updateOneById: (...args: Array<unknown>): unknown => {
        return privateUserUpdateOneById(...args);
      },
      verifyHashedColumnValue: jest.fn(),
    },
  };
});

const statusPageFindOneById: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/StatusPageService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>): unknown => {
        return statusPageFindOneById(...args);
      },
      getStatusPageURL: (): Promise<string> => {
        return Promise.resolve("https://status.example.com");
      },
    },
  };
});

jest.mock("Common/Server/Services/StatusPagePrivateUserSessionService", () => {
  return {
    __esModule: true,
    default: {
      createSession: jest.fn(),
      findActiveSessionByRefreshToken: jest.fn(),
      revokeSessionById: jest.fn(),
      revokeSessionByRefreshToken: jest.fn(),
      renewSessionWithNewRefreshToken: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProjectSmtpConfigService", () => {
  return {
    __esModule: true,
    default: {
      toEmailServer: (): undefined => {
        return undefined;
      },
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
      setStatusPagePrivateUserCookie: (): string => {
        return "status-page-access-token";
      },
      setUserCookie: jest.fn(),
      removeAllCookies: jest.fn(),
      removeCookie: jest.fn(),
      removeStatusPageMasterPasswordCookie: jest.fn(),
      getCookieFromExpressRequest: jest.fn(),
      getRefreshTokenFromExpressRequest: jest.fn(),
      getUserTokenKey: jest.fn(),
      getRefreshTokenKey: jest.fn(),
      getStatusPageMasterPasswordKey: jest.fn(),
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
      signStatusPageLoginToken: (): string => {
        return "signed-status-page-token";
      },
      decode: jest.fn(),
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

const sendEmptySuccessResponse: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
      sendEmptySuccessResponse: (...args: Array<unknown>): unknown => {
        return sendEmptySuccessResponse(...args);
      },
      sendEntityResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/StatusPageAuthentication";

const STATUS_PAGE_ID: string = "e7f4d2a0-1b3c-4d5e-8f90-a1b2c3d4e5f6";
const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const USER_ID: string = "33333333-3333-4333-8333-333333333333";
const USER_EMAIL: string = "subscriber@example.com";

const SSO_REFUSAL: string =
  "Status Page supports authentication by SSO. You cannot use email and password for authentication.";

const ENTERPRISE_STATUSES: ReadonlyArray<EnterpriseLicenseStatus> = [
  "valid",
  "grace",
  "expired",
  "missing",
  "invalid",
];

type InvokeResult = {
  nextError: Exception | null;
};

const invoke: (uri: string, body: unknown) => Promise<InvokeResult> = async (
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

const login: () => Promise<InvokeResult> = async (): Promise<InvokeResult> => {
  return await invoke("/login", {
    data: {
      statusPageId: STATUS_PAGE_ID,
      email: USER_EMAIL,
      password: { _type: "HashedString", value: "a-password" },
    },
  });
};

const forgotPassword: () => Promise<InvokeResult> =
  async (): Promise<InvokeResult> => {
    return await invoke("/forgot-password", {
      data: {
        statusPageId: STATUS_PAGE_ID,
        email: USER_EMAIL,
      },
    });
  };

const resetPassword: () => Promise<InvokeResult> =
  async (): Promise<InvokeResult> => {
    return await invoke("/reset-password", {
      data: {
        statusPageId: STATUS_PAGE_ID,
        resetPasswordToken: "a-reset-token",
        password: { _type: "HashedString", value: "a-new-password" },
      },
    });
  };

type Scenario = {
  label: string;
  run: () => Promise<InvokeResult>;
  // Evidence that the password flow ran past the SSO check.
  expectPasswordFlowRan: (result: InvokeResult) => void;
  expectPasswordFlowStopped: () => void;
};

const SCENARIOS: Array<Scenario> = [
  {
    label: "POST /login",
    run: login,
    expectPasswordFlowRan: (result: InvokeResult): void => {
      // No such user here, so the ordinary credential refusal - not the SSO one.
      expect(privateUserFindOneBy).toHaveBeenCalledTimes(1);
      expect(result.nextError?.message).not.toBe(SSO_REFUSAL);
    },
    expectPasswordFlowStopped: (): void => {
      expect(privateUserFindOneBy).not.toHaveBeenCalled();
    },
  },
  {
    label: "POST /forgot-password",
    run: forgotPassword,
    expectPasswordFlowRan: (result: InvokeResult): void => {
      expect(result.nextError).toBeNull();
      expect(privateUserUpdateOneBy).toHaveBeenCalledTimes(1);
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    },
    expectPasswordFlowStopped: (): void => {
      expect(privateUserFindOneBy).not.toHaveBeenCalled();
      expect(privateUserUpdateOneBy).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
    },
  },
  {
    label: "POST /reset-password",
    run: resetPassword,
    expectPasswordFlowRan: (result: InvokeResult): void => {
      expect(result.nextError).toBeNull();
      expect(privateUserUpdateOneById).toHaveBeenCalledTimes(1);
      expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    },
    expectPasswordFlowStopped: (): void => {
      expect(privateUserUpdateOneById).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
    },
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  uninstallEnterpriseModule();

  statusPageFindOneById.mockResolvedValue({
    id: new ObjectID(STATUS_PAGE_ID),
    _id: STATUS_PAGE_ID,
    name: "Customer Status",
    projectId: new ObjectID(PROJECT_ID),
    requireSsoForLogin: true,
  });

  privateUserFindOneBy.mockImplementation(
    async (...args: Array<unknown>): Promise<unknown> => {
      const input: { query: Record<string, unknown> } = args[0] as {
        query: Record<string, unknown>;
      };

      // /login looks the user up by email: pretend there is none.
      if (input.query["email"] && !input.query["resetPasswordToken"]) {
        return (input as unknown as { select: Record<string, unknown> }).select[
          "passwordSalt"
        ]
          ? null
          : {
              _id: USER_ID,
              id: new ObjectID(USER_ID),
              email: new Email(USER_EMAIL),
            };
      }

      // /reset-password looks the user up by the token's digest.
      return {
        _id: USER_ID,
        id: new ObjectID(USER_ID),
        email: new Email(USER_EMAIL),
        resetPasswordExpires: OneUptimeDate.getOneDayAfter(),
      };
    },
  );
  privateUserUpdateOneBy.mockResolvedValue(1);
  privateUserUpdateOneById.mockResolvedValue(1);
});

afterEach(() => {
  uninstallEnterpriseModule();
});

describe("status page password surfaces when the page requires SSO", () => {
  for (const scenario of SCENARIOS) {
    describe(scenario.label, () => {
      for (const status of ENTERPRISE_STATUSES) {
        it(`is refused on the Enterprise Edition with a ${status} license`, async () => {
          installFakeEnterpriseModule({
            snapshot: createLicenseSnapshotWithStatus(status),
          });

          const result: InvokeResult = await scenario.run();

          expect(result.nextError?.message).toBe(SSO_REFUSAL);
          scenario.expectPasswordFlowStopped();
        });
      }

      it("is refused on the Enterprise Edition before its first license load", async () => {
        installFakeEnterpriseModule({ snapshot: null });

        const result: InvokeResult = await scenario.run();

        expect(result.nextError?.message).toBe(SSO_REFUSAL);
        scenario.expectPasswordFlowStopped();
      });

      it("runs the password flow on the Community Edition, where status page SSO does not exist", async () => {
        const result: InvokeResult = await scenario.run();

        expect(result.nextError?.message).not.toBe(SSO_REFUSAL);
        scenario.expectPasswordFlowRan(result);
      });
    });
  }

  it("a page that does not require SSO runs the password flow on both editions", async () => {
    statusPageFindOneById.mockResolvedValue({
      id: new ObjectID(STATUS_PAGE_ID),
      _id: STATUS_PAGE_ID,
      name: "Customer Status",
      projectId: new ObjectID(PROJECT_ID),
      requireSsoForLogin: false,
    });

    installFakeEnterpriseModule();

    const onEnterprise: InvokeResult = await forgotPassword();

    expect(onEnterprise.nextError).toBeNull();

    uninstallEnterpriseModule();
    jest.clearAllMocks();
    privateUserUpdateOneBy.mockResolvedValue(1);

    const onCommunity: InvokeResult = await forgotPassword();

    expect(onCommunity.nextError).toBeNull();
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});
