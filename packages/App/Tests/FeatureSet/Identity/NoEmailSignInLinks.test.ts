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
  PASSWORD_RESET_CANNOT_BE_EMAILED_MESSAGE,
  REGISTRATION_LINK_CANNOT_BE_EMAILED_MESSAGE,
  SIGN_IN_LINK_CANNOT_BE_EMAILED_MESSAGE,
} from "Common/Types/ServerSending/ServerSendingWords";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A SERVER THAT CANNOT SEND EMAIL NEVER SAYS IT SENT ONE (#6825).
 *
 * Forgot password, a sign-in link, and a sign-up that has to email its link
 * to finish (an invited account claimed without its token) each used to
 * answer "sent" on a server with no email set up, and the person waited for
 * nothing. Now, while the server's email is known not to be set up
 * (ServerSendingStatus.isEmailKnownNotSetUp), each is refused with who can
 * let the person in - asked BEFORE any address is looked up, so every
 * address, with an account or without, gets the same answer, and nothing is
 * minted, written or mailed. Where email is set up, or whether it is cannot
 * be read, each goes on exactly as before.
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

const isEmailKnownNotSetUp: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/ServerSending/ServerSendingStatus", () => {
  return {
    __esModule: true,
    default: {
      isEmailKnownNotSetUp: (...args: Array<unknown>): unknown => {
        return isEmailKnownNotSetUp(...args);
      },
    },
  };
});

jest.mock("Common/Server/Utils/SsoRequiredSignIn", () => {
  return (
    jest.requireActual(
      "./SsoNotRequiredStandIn",
    ) as typeof import("./SsoNotRequiredStandIn")
  ).ssoNotRequired();
});

// No counter store: the emails go out uncounted.
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

jest.mock("Common/Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: {
      getMagicLinkLoginTurnedOff: (): Promise<boolean> => {
        return Promise.resolve(false);
      },
      getRequireSsoForLogin: (): Promise<boolean> => {
        return Promise.resolve(false);
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

jest.mock("Common/Server/Services/EmailVerificationTokenService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      create: jest.fn(),
      deleteOneBy: jest.fn(),
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
      generateRegistrationLink: jest.fn(),
    },
  };
});

const sendCompleteRegistrationEmail: jest.Mock = jest.fn();

jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: {
      sendVerificationEmail: jest.fn(),
      sendTwoFactorBackupCodeUsedEmail: jest.fn(),
      sendTwoFactorWrongCodesEmail: jest.fn(),
      sendCompleteRegistrationEmail: (...args: Array<unknown>): unknown => {
        sendCompleteRegistrationEmail(...args);
        return Promise.resolve();
      },
    },
  };
});

type AccountRow = {
  id: ObjectID;
  email: string;
  // An invitation nobody has claimed has no password.
  password: string | undefined;
};

const REGISTERED: AccountRow = {
  id: new ObjectID("68250000-0000-4000-8000-0000000000b1"),
  email: "owner@example.com",
  password: "stored-password-hash",
};

const INVITED: AccountRow = {
  id: new ObjectID("68250000-0000-4000-8000-0000000000b2"),
  email: "invited@example.com",
  password: undefined,
};

let accounts: Array<AccountRow> = [REGISTERED, INVITED];

function asUser(row: AccountRow): Record<string, unknown> {
  return {
    id: row.id,
    _id: row.id.toString(),
    password: row.password,
    name: undefined,
    isMasterAdmin: false,
    isBlocked: false,
    timezone: undefined,
    email: new Email(row.email),
  };
}

const userFindOneBy: jest.Mock = jest.fn();
const userUpdateOneBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (args: { query: { email?: Email } }): unknown => {
        userFindOneBy(args);
        const email: string = args.query.email?.toString().toLowerCase() || "";
        const row: AccountRow | undefined = accounts.find(
          (account: AccountRow): boolean => {
            return account.email === email;
          },
        );
        return Promise.resolve(row ? asUser(row) : null);
      },
      updateOneBy: (...args: Array<unknown>): unknown => {
        userUpdateOneBy(...args);
        return Promise.resolve(1);
      },
      updateOneById: jest.fn(),
      createUserOnSignup: jest.fn(),
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
      shouldDisableSignup: (): Promise<boolean> => {
        return Promise.resolve(false);
      },
      getHost: (): Promise<unknown> => {
        return Promise.resolve(new HostnameType("oneuptime.example.com"));
      },
      getHttpProtocol: (): Promise<unknown> => {
        return Promise.resolve(ProtocolType.HTTPS);
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
const sendEmptySuccessResponse: jest.Mock = jest.fn();
const sendEntityResponse: jest.Mock = jest.fn();

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
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/Authentication";

interface Answer {
  // What the caller was told: the error, or "sent".
  error: string | null;
  isSuccess: boolean;
}

async function post(uri: string, body: unknown): Promise<Answer> {
  const handler: RouteHandler = mockRouter.match("post", uri);
  const req: ExpressRequest = buildRequest(body, {
    headers: {},
    socketAddress: "203.0.113.9",
  });
  const res: ExpressResponse = buildResponse();

  let nextError: Exception | null = null;

  sendErrorResponse.mockClear();
  sendEmptySuccessResponse.mockClear();
  sendEntityResponse.mockClear();

  await handler(req, res, ((err?: Exception): void => {
    if (err) {
      nextError = err;
    }
  }) as unknown as NextFunction);

  const responded: unknown = sendErrorResponse.mock.calls[0]?.[2];
  const error: Error | null =
    (nextError as Error | null) || (responded as Error | undefined) || null;

  return {
    error: error ? error.message : null,
    isSuccess:
      !error &&
      (sendEmptySuccessResponse.mock.calls.length > 0 ||
        sendEntityResponse.mock.calls.length > 0),
  };
}

function forgotPassword(email: string): Promise<Answer> {
  return post("/forgot-password", { data: { email: email } });
}

function sendMagicLink(email: string): Promise<Answer> {
  return post("/send-magic-link", { data: { email: email } });
}

function signUp(email: string): Promise<Answer> {
  return post("/signup", {
    data: {
      email: email,
      name: "New Person",
      password: { _type: "HashedString", value: "a long enough password 1!" },
    },
    miscDataProps: {},
  });
}

beforeEach(() => {
  accounts = [REGISTERED, INVITED];
  isEmailKnownNotSetUp.mockReset();
  isEmailKnownNotSetUp.mockResolvedValue(false);
  consumeRegistrationToken.mockReset();
  consumeRegistrationToken.mockResolvedValue(false);
  userFindOneBy.mockClear();
  userUpdateOneBy.mockClear();
  sendMail.mockClear();
  sendCompleteRegistrationEmail.mockClear();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("on a server with no email set up", () => {
  beforeEach(() => {
    isEmailKnownNotSetUp.mockResolvedValue(true);
  });

  it("Forgot password says who can reset it - for an account, and for an address with none, alike", async () => {
    const forAccount: Answer = await forgotPassword(REGISTERED.email);
    const forNobody: Answer = await forgotPassword("nobody@example.com");

    expect(forAccount).toEqual({
      error: PASSWORD_RESET_CANNOT_BE_EMAILED_MESSAGE,
      isSuccess: false,
    });
    expect(forNobody).toEqual(forAccount);
  });

  it("Forgot password looks nobody up, mints no token and mails nothing", async () => {
    await forgotPassword(REGISTERED.email);

    expect(userFindOneBy).not.toHaveBeenCalled();
    expect(userUpdateOneBy).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("a sign-in link is refused the same way, for every address, before any is looked up", async () => {
    const forAccount: Answer = await sendMagicLink(REGISTERED.email);
    const forNobody: Answer = await sendMagicLink("nobody@example.com");

    expect(forAccount).toEqual({
      error: SIGN_IN_LINK_CANNOT_BE_EMAILED_MESSAGE,
      isSuccess: false,
    });
    expect(forNobody).toEqual(forAccount);
    expect(userFindOneBy).not.toHaveBeenCalled();
    expect(userUpdateOneBy).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("an invited person who signs up without their link is told to ask for it, not to check their inbox", async () => {
    const answer: Answer = await signUp(INVITED.email);

    expect(answer).toEqual({
      error: REGISTRATION_LINK_CANNOT_BE_EMAILED_MESSAGE,
      isSuccess: false,
    });
    expect(sendCompleteRegistrationEmail).not.toHaveBeenCalled();
    // The invitation is left exactly as it was: nothing written.
    expect(userUpdateOneBy).not.toHaveBeenCalled();
  });
});

describe("on a server whose email is set up, or cannot be read", () => {
  it.each([["set up"], ["unknown"]])(
    "email %s: Forgot password goes on and mails the reset link, as before",
    async () => {
      const answer: Answer = await forgotPassword(REGISTERED.email);

      expect(answer.isSuccess).toBe(true);
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(
        (sendMail.mock.calls[0]![0] as { templateType: string }).templateType,
      ).toBe(EmailTemplateType.ForgotPassword);
    },
  );

  it("a sign-in link goes out, as before", async () => {
    const answer: Answer = await sendMagicLink(REGISTERED.email);

    expect(answer.isSuccess).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(
      (sendMail.mock.calls[0]![0] as { templateType: string }).templateType,
    ).toBe(EmailTemplateType.MagicLink);
  });

  it("an invited person who signs up without their link is sent a fresh one, as before", async () => {
    const answer: Answer = await signUp(INVITED.email);

    expect(answer.error).toBeNull();
    expect(sendCompleteRegistrationEmail).toHaveBeenCalledTimes(1);
  });
});
