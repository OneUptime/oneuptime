import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import Exception from "Common/Types/Exception/Exception";
import ObjectID from "Common/Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * FORGOT PASSWORD MAILS NO LINK TO SOMEBODY WHOSE SIGN-IN SSO MANAGES (#9688).
 *
 * While the whole server requires single sign-on, everyone but a master
 * admin is refused every sign-in that is not SSO, and sets no password in
 * OneUptime (Types/SSO/SsoManagedSignIn): a password could only lie there
 * until the requirement was turned off. POST /forgot-password used to mail
 * them a reset link all the same - or, for an account made by SSO or SCIM,
 * which has a random password nobody knows, a perfectly working one.
 *
 * This drives the real route, with the real rule (SsoManagedSignIn,
 * SsoRequiredSignIn), and holds:
 *
 *   - an account the rule covers is mailed nothing and gets no token, with
 *     a password or without one (an invitation nobody claimed);
 *   - a master admin is mailed their link while the server requires SSO,
 *     without the rule even being read: it is their way back in when the
 *     identity provider is down;
 *   - everyone is mailed theirs while the server does not require SSO;
 *   - a rule that cannot be read mails a non-admin nothing, and is never
 *     told to the caller;
 *   - the answer is the same in every case, and the same as for an address
 *     nobody has, so asking still says nothing about who has an account.
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

// The server's Require SSO to Sign In: what each test says, or a failed read.
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

// No counter store: each email goes out uncounted.
jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return null;
      },
      isConnected: (): boolean => {
        return false;
      },
    },
  };
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
  };
});

jest.mock("Common/Server/Services/EmailVerificationTokenService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn(), create: jest.fn() },
  };
});

const ACCOUNT_ID: ObjectID = new ObjectID(
  "9d000000-0000-4000-8000-0000000000aa",
);
const ACCOUNT_EMAIL: string = "ada@example.com";

type AccountRow = {
  isMasterAdmin: boolean;
  hasPassword: boolean;
};

let account: AccountRow | null = null;

// The account as each read selects it.
function asUser(row: AccountRow): Record<string, unknown> {
  return {
    id: ACCOUNT_ID,
    _id: ACCOUNT_ID.toString(),
    ...(row.hasPassword ? { password: "stored-password-hash" } : {}),
    isMasterAdmin: row.isMasterAdmin,
    email: new Email(ACCOUNT_EMAIL),
  };
}

const userFindOneBy: jest.Mock = jest.fn();
const userFindOneById: jest.Mock = jest.fn();
const userUpdateOneBy: jest.Mock = jest.fn();
const sendPasswordResetLink: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        userFindOneBy(...args);
        return Promise.resolve(account ? asUser(account) : null);
      },
      findOneById: (...args: Array<unknown>): unknown => {
        userFindOneById(...args);
        return Promise.resolve(account ? asUser(account) : null);
      },
      updateOneBy: (...args: Array<unknown>): unknown => {
        userUpdateOneBy(...args);
        return Promise.resolve(1);
      },
      updateOneById: jest.fn(),
      sendPasswordResetLink: (...args: Array<unknown>): unknown => {
        sendPasswordResetLink(...args);
        return Promise.resolve(new Email(ACCOUNT_EMAIL));
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
  const HostnameType: typeof import("Common/Types/API/Hostname").default =
    jest.requireActual("Common/Types/API/Hostname").default;
  const ProtocolType: typeof import("Common/Types/API/Protocol").default =
    jest.requireActual("Common/Types/API/Protocol").default;

  return {
    __esModule: true,
    default: {
      getHost: (): Promise<unknown> => {
        return Promise.resolve(new HostnameType("oneuptime.example.com"));
      },
      getHttpProtocol: (): Promise<unknown> => {
        return Promise.resolve(ProtocolType.HTTPS);
      },
    },
  };
});

const loggerError: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      error: (...args: Array<unknown>): void => {
        loggerError(...args);
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
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/Authentication";

async function forgotPassword(): Promise<Exception | null> {
  const handler: RouteHandler = mockRouter.match("post", "/forgot-password");
  const req: ExpressRequest = buildRequest(
    { data: { email: ACCOUNT_EMAIL } },
    { socketAddress: "10.0.0.2" },
  );
  const res: ExpressResponse = buildResponse();

  let error: Exception | null = null;

  await handler(req, res, ((err?: Exception): void => {
    if (err) {
      error = err;
    }
  }) as unknown as NextFunction);

  // The link email for an account with no password is sent without waiting.
  await new Promise<void>((resolve: () => void): void => {
    setImmediate(resolve);
  });

  return error;
}

// Whether a reset link was minted: its token written on the account.
function wasTokenWritten(): boolean {
  return userUpdateOneBy.mock.calls.some((call: Array<unknown>): boolean => {
    const data: Record<string, unknown> =
      ((call[0] as Record<string, unknown>)["data"] as Record<
        string,
        unknown
      >) || {};
    return typeof data["resetPasswordToken"] === "string";
  });
}

function resetEmails(): Array<unknown> {
  return sendMail.mock.calls.filter((call: Array<unknown>): boolean => {
    return (
      (call[0] as { templateType: EmailTemplateType }).templateType ===
      EmailTemplateType.ForgotPassword
    );
  });
}

// Nothing reached the account: no token, no reset email, no first-password link.
function expectNothingSent(): void {
  expect(wasTokenWritten()).toBe(false);
  expect(resetEmails()).toHaveLength(0);
  expect(sendMail).not.toHaveBeenCalled();
  expect(sendPasswordResetLink).not.toHaveBeenCalled();
}

// The answer every address gets.
function expectTheUsualAnswer(error: Exception | null): void {
  expect(error).toBeNull();
  expect(sendErrorResponse).not.toHaveBeenCalled();
  expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
}

describe("POST /forgot-password while the server requires SSO (#9688)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getRequireSsoForLogin.mockResolvedValue(true);
    account = { isMasterAdmin: false, hasPassword: true };
  });

  it("mails an account the rule covers no reset link, and writes no token", async () => {
    const error: Exception | null = await forgotPassword();

    expectTheUsualAnswer(error);
    expectNothingSent();
    expect(getRequireSsoForLogin).toHaveBeenCalledTimes(1);
  });

  it("mails an account with no password yet no link to set its first one either", async () => {
    account = { isMasterAdmin: false, hasPassword: false };

    const error: Exception | null = await forgotPassword();

    expectTheUsualAnswer(error);
    expectNothingSent();
  });

  it("mails a master admin their link, without the rule being read: their way back in", async () => {
    account = { isMasterAdmin: true, hasPassword: true };

    const error: Exception | null = await forgotPassword();

    expectTheUsualAnswer(error);
    expect(getRequireSsoForLogin).not.toHaveBeenCalled();
    expect(wasTokenWritten()).toBe(true);
    expect(resetEmails()).toHaveLength(1);
  });

  it("a rule that cannot be read mails a non-admin nothing, logs it, and tells the caller nothing", async () => {
    getRequireSsoForLogin.mockRejectedValue(new Error("connection refused"));

    const error: Exception | null = await forgotPassword();

    expectTheUsualAnswer(error);
    expectNothingSent();
    expect(loggerError).toHaveBeenCalled();
  });

  it("a rule that cannot be read still mails a master admin, who is never asked about it", async () => {
    getRequireSsoForLogin.mockRejectedValue(new Error("connection refused"));
    account = { isMasterAdmin: true, hasPassword: true };

    const error: Exception | null = await forgotPassword();

    expectTheUsualAnswer(error);
    expect(resetEmails()).toHaveLength(1);
  });

  it("an address nobody has gets the same answer, and the rule is not read for it", async () => {
    account = null;

    const error: Exception | null = await forgotPassword();

    expectTheUsualAnswer(error);
    expectNothingSent();
    expect(getRequireSsoForLogin).not.toHaveBeenCalled();
  });
});

describe("POST /forgot-password while the server does not require SSO", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getRequireSsoForLogin.mockResolvedValue(false);
  });

  it("mails an account with a password its reset link, as always", async () => {
    account = { isMasterAdmin: false, hasPassword: true };

    const error: Exception | null = await forgotPassword();

    expectTheUsualAnswer(error);
    expect(wasTokenWritten()).toBe(true);
    expect(resetEmails()).toHaveLength(1);
  });

  it("sends an account with no password yet its first-password link, as always", async () => {
    account = { isMasterAdmin: false, hasPassword: false };

    const error: Exception | null = await forgotPassword();

    expectTheUsualAnswer(error);
    expect(sendPasswordResetLink).toHaveBeenCalledTimes(1);
  });

  it("mails a master admin their link", async () => {
    account = { isMasterAdmin: true, hasPassword: true };

    const error: Exception | null = await forgotPassword();

    expectTheUsualAnswer(error);
    expect(resetEmails()).toHaveLength(1);
  });
});
