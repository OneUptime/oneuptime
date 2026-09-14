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
import { JSONObject } from "Common/Types/JSON";
import Email from "Common/Types/Email";
import ObjectID from "Common/Types/ObjectID";
import HashedString from "Common/Types/HashedString";
import { EncryptionSecret } from "Common/Server/EnvironmentConfig";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

/*
 * ---------------------------------------------------------------------------------------------
 * Regression test for the status page invite link that was dead on arrival.
 *
 * `StatusPagePrivateUserService.onCreateSuccess` mints a token when somebody is invited to a
 * private status page, and mails it as `<statusPageUrl>/reset-password/<token>`. It used to
 * store that token RAW.
 *
 * `POST /status-page-api/reset-password` redeems the other way round: it hashes whatever the
 * link carried and queries `{ statusPageId, resetPasswordToken: SHA256(secret + token) }`. So a
 * raw token in the column matches nothing, and every invited user's welcome link answered
 * "Invalid link. Please go to forgot password page again and request a new link."
 *
 * `POST /status-page-api/forgot-password` had it right all along -- it persists the digest and
 * mails the raw token -- which is what made the two paths disagree.
 *
 * `resetPasswordToken` carries no hashing transformer (only `password` does, see
 * StatusPagePrivateUser.ts), so nothing in the ORM was going to reconcile them.
 *
 * The service is deliberately NOT `jest.mock`ed here. "The link the invite mailed is redeemable"
 * is an assertion about the real hash agreeing with the real lookup, not about a stub agreeing
 * with itself -- so the hook and the endpoint run for real against one shared in-memory row.
 *
 * Related: the /reset-password query shape is pinned in StatusPageAuthenticationBypass.test.ts,
 * and the same service's email-change token expiry in
 * Common/Tests/Server/Services/StatusPagePrivateUserEmailChangePasswordResetExpiry.test.ts.
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
      isLoginCodeSession: jest.fn(),
      exchangeLoginCode: jest.fn(),
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
      setStatusPagePrivateUserCookie: jest.fn(),
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

const sendErrorResponse: jest.Mock = jest.fn();
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
      sendEntityResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

/*
 * The service under test is imported for real -- see the header. Everything it touches on the
 * way to the mail is mocked above.
 */
import StatusPagePrivateUserService from "Common/Server/Services/StatusPagePrivateUserService";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/StatusPageAuthentication";

const STATUS_PAGE_ID: string = "e7f4d2a0-1b3c-4d5e-8f90-a1b2c3d4e5f6";
const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const OTHER_STATUS_PAGE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const USER_EMAIL: string = "invited@example.com";
const NEW_PASSWORD: string = "aVeryG00dPassword!";

/*
 * The one row both the create hook and the endpoint read and write.
 * `resetPasswordToken` holds exactly what the column holds.
 */
type Row = {
  id: ObjectID;
  email: string;
  password: string | null;
  resetPasswordToken: string | null;
  resetPasswordExpires: Date | null;
};

let row: Row;

/* Every row id `updateOneById` was aimed at, in call order. */
let updatedIds: Array<string | undefined>;

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

type InviteFunction = (options?: {
  isSsoUser?: boolean;
}) => Promise<string | null>;

/*
 * Drive the real create hook -- what runs when somebody is invited to a private status page --
 * and pull the raw token back out of the link it mailed, which is all the invited user has.
 */
const invite: InviteFunction = async (options?: {
  isSsoUser?: boolean;
}): Promise<string | null> => {
  sendMail.mockClear();

  const createdItem: StatusPagePrivateUser = new StatusPagePrivateUser();
  createdItem.id = USER_ID;
  createdItem._id = USER_ID.toString();
  createdItem.email = new Email(USER_EMAIL);
  createdItem.statusPageId = new ObjectID(STATUS_PAGE_ID);
  createdItem.isSsoUser = options?.isSsoUser === true;

  await (
    StatusPagePrivateUserService as unknown as {
      onCreateSuccess: (
        onCreate: unknown,
        createdItem: StatusPagePrivateUser,
      ) => Promise<StatusPagePrivateUser>;
    }
  ).onCreateSuccess({}, createdItem);

  if (sendMail.mock.calls.length === 0) {
    return null;
  }

  const vars: JSONObject = (
    sendMail.mock.calls[0]![0] as unknown as { vars: JSONObject }
  ).vars;

  const tokenVerifyUrl: string = vars["tokenVerifyUrl"] as string;

  return tokenVerifyUrl.split("/reset-password/")[1] as string;
};

type RedeemFunction = (token: string) => Promise<InvokeResult>;

const redeem: RedeemFunction = async (token: string): Promise<InvokeResult> => {
  return await invoke("/reset-password", {
    data: {
      statusPageId: STATUS_PAGE_ID,
      resetPasswordToken: token,
      password: { _type: "HashedString", value: NEW_PASSWORD },
    },
  });
};

describe("Status page invite mints a redeemable, hashed reset token", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    updatedIds = [];

    row = {
      id: USER_ID,
      email: USER_EMAIL,
      password: null,
      resetPasswordToken: null,
      resetPasswordExpires: null,
    };

    statusPageFindOneById.mockResolvedValue({
      id: new ObjectID(STATUS_PAGE_ID),
      _id: STATUS_PAGE_ID,
      name: "Status",
      pageTitle: "Status",
      requireSsoForLogin: false,
      projectId: new ObjectID(PROJECT_ID),
    });

    /*
     * The target row id is honoured, not ignored. A write aimed at any other row must miss --
     * otherwise a hook that hashed the token correctly but stamped it onto the wrong row would
     * still satisfy every assertion below.
     */
    jest
      .spyOn(StatusPagePrivateUserService, "updateOneById")
      .mockImplementation(((updateBy: {
        id: ObjectID;
        data: Record<string, unknown>;
      }): Promise<number> => {
        updatedIds.push(updateBy.id?.toString());

        if (updateBy.id?.toString() !== row.id.toString()) {
          return Promise.resolve(0);
        }

        const data: Record<string, unknown> = updateBy.data;

        if ("resetPasswordToken" in data) {
          row.resetPasswordToken = data["resetPasswordToken"] as string | null;
        }

        if ("resetPasswordExpires" in data) {
          row.resetPasswordExpires = data[
            "resetPasswordExpires"
          ] as Date | null;
        }

        if ("password" in data) {
          row.password = String(data["password"]);
        }

        return Promise.resolve(1);
      }) as never);

    /*
     * Matches the way the endpoint queries: by token digest AND status page. Both predicates are
     * enforced here, so dropping either one in the handler would fail these tests rather than
     * pass them quietly. A row whose column does not equal the value queried is simply not found
     * -- which is exactly how the raw-token bug surfaced.
     */
    jest
      .spyOn(StatusPagePrivateUserService, "findOneBy")
      .mockImplementation(((findBy: {
        query: Record<string, unknown>;
      }): Promise<StatusPagePrivateUser | null> => {
        const query: Record<string, unknown> = findBy.query;

        if (
          query["statusPageId"] === undefined ||
          String(query["statusPageId"]) !== STATUS_PAGE_ID
        ) {
          return Promise.resolve(null);
        }

        if (
          row.resetPasswordToken === null ||
          query["resetPasswordToken"] === undefined ||
          String(query["resetPasswordToken"]) !== row.resetPasswordToken
        ) {
          return Promise.resolve(null);
        }

        return Promise.resolve({
          id: row.id,
          _id: row.id.toString(),
          email: new Email(row.email),
          resetPasswordExpires: row.resetPasswordExpires,
        } as unknown as StatusPagePrivateUser);
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("stores only a hash of the invite token, never the link's own token", async () => {
    const token: string | null = await invite();

    expect(token).not.toBeNull();
    expect(row.resetPasswordToken).not.toBe(token);
    expect(row.resetPasswordToken).toBe(
      await HashedString.hashValue(token as string, EncryptionSecret),
    );
  });

  it("stamps the digest on the invited user's own row, not any other", async () => {
    await invite();

    expect(updatedIds).toEqual([USER_ID.toString()]);
  });

  it("will not redeem an invite token against a different status page", async () => {
    const token: string | null = await invite();

    const result: InvokeResult = await invoke("/reset-password", {
      data: {
        statusPageId: OTHER_STATUS_PAGE_ID,
        resetPasswordToken: token,
        password: { _type: "HashedString", value: NEW_PASSWORD },
      },
    });

    expect(sendEmptySuccessResponse).not.toHaveBeenCalled();
    expect((result.nextError as unknown as Exception).message).toBe(
      "Invalid link. Please go to forgot password page again and request a new link.",
    );
    expect(row.password).toBeNull();
    expect(row.resetPasswordToken).not.toBeNull();
  });

  it("mints a link the status page reset-password endpoint accepts", async () => {
    const token: string | null = await invite();

    const result: InvokeResult = await redeem(token as string);

    expect(result.nextError).toBeNull();
    expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(row.password).toBe(NEW_PASSWORD);
  });

  it("spends the invite link, so it cannot be replayed", async () => {
    const token: string | null = await invite();

    await redeem(token as string);

    expect(row.resetPasswordToken).toBeNull();
    expect(row.resetPasswordExpires).toBeNull();

    sendEmptySuccessResponse.mockClear();

    const replay: InvokeResult = await redeem(token as string);

    expect(sendEmptySuccessResponse).not.toHaveBeenCalled();
    expect((replay.nextError as unknown as Exception).message).toBe(
      "Invalid link. Please go to forgot password page again and request a new link.",
    );
  });

  it("refuses an invite link whose token does not hash to the stored digest", async () => {
    await invite();

    const result: InvokeResult = await redeem(
      new ObjectID("44444444-4444-4444-8444-444444444444").toString(),
    );

    expect(sendEmptySuccessResponse).not.toHaveBeenCalled();
    expect((result.nextError as unknown as Exception).message).toBe(
      "Invalid link. Please go to forgot password page again and request a new link.",
    );
    expect(row.password).toBeNull();
  });

  it("refuses an invite link past its expiry", async () => {
    const token: string | null = await invite();

    row.resetPasswordExpires = new Date(Date.now() - 60 * 1000);

    const result: InvokeResult = await redeem(token as string);

    expect(sendEmptySuccessResponse).not.toHaveBeenCalled();
    expect((result.nextError as unknown as Exception).message).toBe(
      "Expired link. Please go to forgot password page again and request a new link.",
    );
    expect(row.password).toBeNull();
  });

  it("still hashes the token for an SSO user, who is never mailed a link", async () => {
    const token: string | null = await invite({ isSsoUser: true });

    expect(token).toBeNull();
    expect(sendMail).not.toHaveBeenCalled();
    expect(row.resetPasswordToken).not.toBeNull();
    expect(row.resetPasswordToken).toHaveLength(64);
  });
});
