import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import Exception from "Common/Types/Exception/Exception";
import ObjectID from "Common/Types/ObjectID";
import Timezone from "Common/Types/Timezone";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * THE PASSWORD RESET EMAIL SAYS WHERE THE REQUEST CAME FROM (issue #5599).
 *
 * Anybody who knows an address can ask for its password reset, and the email
 * goes to its owner. POST /forgot-password now hands that email when the
 * reset was asked for - in the owner's own time zone - the IP address it
 * came from, roughly where that is when the CDN in front of the installation
 * says so, and the device and browser. This drives the real routes through
 * the mock router and holds:
 *
 *  - the address is the one the bundled Nginx appended, not one the caller
 *    wrote at the front of X-Forwarded-For;
 *  - the device is named from the User-Agent, and a User-Agent of words the
 *    caller chose reaches the email as "Unknown device", never as written;
 *  - no place is named until the operator names the headers that carry it;
 *  - POST /reset-password hands the password's write where the reset came
 *    from - the write's hook mails "Your password was changed" with it - and
 *    no longer mails that email a second time itself.
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

let mockTrustedGeoHeaders: { country: string; region: string; city: string } = {
  country: "",
  region: "",
  city: "",
};

jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual, __esModule: true };

  Object.defineProperty(mocked, "TrustedGeoCountryHeader", {
    get: (): string => {
      return mockTrustedGeoHeaders.country;
    },
  });
  Object.defineProperty(mocked, "TrustedGeoRegionHeader", {
    get: (): string => {
      return mockTrustedGeoHeaders.region;
    },
  });
  Object.defineProperty(mocked, "TrustedGeoCityHeader", {
    get: (): string => {
      return mockTrustedGeoHeaders.city;
    },
  });

  return mocked;
});

jest.mock("Common/Server/Utils/SsoRequiredSignIn", () => {
  return (
    jest.requireActual(
      "./SsoNotRequiredStandIn",
    ) as typeof import("./SsoNotRequiredStandIn")
  ).ssoNotRequired();
});

// No counter store: the reset email goes out uncounted, as it did before.
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
    default: {
      findOneBy: jest.fn(),
      create: jest.fn(),
      deleteOneBy: jest.fn(),
    },
  };
});

type AccountRow = {
  id: ObjectID;
  email: string;
  timezone?: Timezone | undefined;
};

const ACCOUNT: AccountRow = {
  id: new ObjectID("55990000-0000-4000-8000-0000000000aa"),
  email: "owner@example.com",
};

let account: AccountRow | null = ACCOUNT;

function asUser(row: AccountRow): Record<string, unknown> {
  return {
    id: row.id,
    _id: row.id.toString(),
    password: "stored-password-hash",
    name: undefined,
    isMasterAdmin: false,
    timezone: row.timezone,
    resetPasswordExpires: new Date(Date.now() + 60 * 60 * 1000),
    email: new Email(row.email),
  };
}

const userFindOneBy: jest.Mock = jest.fn();
const userUpdateOneBy: jest.Mock = jest.fn();
const userUpdateOneById: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        userFindOneBy(...args);
        return Promise.resolve(account ? asUser(account) : null);
      },
      updateOneBy: (...args: Array<unknown>): unknown => {
        userUpdateOneBy(...args);
        return Promise.resolve(1);
      },
      updateOneById: (...args: Array<unknown>): unknown => {
        userUpdateOneById(...args);
        return Promise.resolve(1);
      },
    },
  };
});

const revokeAllSessionsByUserId: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: {
      revokeAllSessionsByUserId: (...args: Array<unknown>): unknown => {
        revokeAllSessionsByUserId(...args);
        return Promise.resolve();
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
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/Authentication";

const FIREFOX_WINDOWS: string =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0";

type SentMail = {
  toEmail: Email;
  subject: string;
  templateType: EmailTemplateType;
  vars: Record<string, string>;
};

function sentMails(): Array<SentMail> {
  return sendMail.mock.calls.map((call: Array<unknown>): SentMail => {
    return call[0] as SentMail;
  });
}

// One request as it reaches the app through the bundled Nginx.
async function post(
  uri: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<Exception | null> {
  const handler: RouteHandler = mockRouter.match("post", uri);
  const req: ExpressRequest = buildRequest(body, {
    headers: headers,
    socketAddress: "10.0.0.2",
  });
  const res: ExpressResponse = buildResponse();

  let error: Exception | null = null;

  await handler(req, res, ((err?: Exception): void => {
    if (err) {
      error = err;
    }
  }) as unknown as NextFunction);

  return error;
}

async function forgotPassword(
  headers: Record<string, string>,
): Promise<Exception | null> {
  return await post(
    "/forgot-password",
    { data: { email: ACCOUNT.email } },
    headers,
  );
}

async function resetPassword(
  headers: Record<string, string>,
): Promise<Exception | null> {
  return await post(
    "/reset-password",
    {
      data: {
        resetPasswordToken: "a-reset-token",
        password: { _type: "HashedString", value: "a brand new password" },
      },
    },
    headers,
  );
}

function resetEmail(): SentMail {
  const mails: Array<SentMail> = sentMails().filter(
    (mail: SentMail): boolean => {
      return mail.templateType === EmailTemplateType.ForgotPassword;
    },
  );

  expect(mails).toHaveLength(1);

  return mails[0]!;
}

beforeEach(() => {
  jest.clearAllMocks();
  account = { ...ACCOUNT };
  mockTrustedGeoHeaders = { country: "", region: "", city: "" };
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /forgot-password", () => {
  it("mails the owner their reset link, once, as it always did", async () => {
    expect(
      await forgotPassword({
        "x-forwarded-for": "203.0.113.7",
        "user-agent": FIREFOX_WINDOWS,
      }),
    ).toBeNull();

    const mail: SentMail = resetEmail();

    expect(mail.toEmail.toString()).toBe(ACCOUNT.email);
    expect(mail.subject).toBe("Password Reset Request for OneUptime");
    expect(
      new URL(mail.vars["tokenVerifyUrl"]!).pathname.startsWith(
        "/accounts/reset-password/",
      ),
    ).toBe(true);
    expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
  });

  it("says from which address, and on which device", async () => {
    await forgotPassword({
      "x-forwarded-for": "203.0.113.7",
      "user-agent": FIREFOX_WINDOWS,
    });

    const vars: Record<string, string> = resetEmail().vars;

    expect(vars["requestIpAddress"]).toBe("203.0.113.7");
    expect(vars["requestDevice"]).toBe("Firefox 132 on Windows");
  });

  it("the address is the one Nginx appended, not the one the caller wrote first", async () => {
    await forgotPassword({
      "x-forwarded-for": "198.51.100.66, 203.0.113.7",
      "user-agent": FIREFOX_WINDOWS,
    });

    expect(resetEmail().vars["requestIpAddress"]).toBe("203.0.113.7");
  });

  it("a User-Agent of the caller's own words is an unknown device, never those words", async () => {
    const injected: string =
      "Your account is locked. Call +1 800 555 0100 to unlock it.";

    await forgotPassword({
      "x-forwarded-for": "203.0.113.7",
      "user-agent": injected,
    });

    const vars: Record<string, string> = resetEmail().vars;

    expect(vars["requestDevice"]).toBe("Unknown device");

    for (const value of Object.values(vars)) {
      expect(value).not.toContain("Call +1");
    }
  });

  it("a request with no User-Agent at all is an unknown device", async () => {
    await forgotPassword({ "x-forwarded-for": "203.0.113.7" });

    expect(resetEmail().vars["requestDevice"]).toBe("Unknown device");
  });

  it("names no place until the operator names the headers that carry it", async () => {
    await forgotPassword({
      "x-forwarded-for": "203.0.113.7",
      "user-agent": FIREFOX_WINDOWS,
      "cf-ipcity": "A Place The Caller Chose",
      "cf-ipcountry": "DE",
    });

    expect(resetEmail().vars["requestLocation"]).toBe("");
  });

  it("names the place the CDN's headers carry, once the operator names them", async () => {
    mockTrustedGeoHeaders = {
      country: "cf-ipcountry",
      region: "cf-region",
      city: "cf-ipcity",
    };

    await forgotPassword({
      "x-forwarded-for": "203.0.113.7",
      "user-agent": FIREFOX_WINDOWS,
      "cf-ipcity": "Mumbai",
      "cf-region": "Maharashtra",
      "cf-ipcountry": "IN",
    });

    expect(resetEmail().vars["requestLocation"]).toBe(
      "Mumbai, Maharashtra, India",
    );
  });

  it("says when, in the owner's own time zone", async () => {
    account = { ...ACCOUNT, timezone: Timezone.AsiaKolkata };

    await forgotPassword({ "x-forwarded-for": "203.0.113.7" });

    expect(resetEmail().vars["requestedAt"]).toContain("IST");
    expect(userFindOneBy.mock.calls[0]![0]).toMatchObject({
      select: { timezone: true },
    });
  });

  it("an owner without a time zone of their own reads the time in UTC", async () => {
    await forgotPassword({ "x-forwarded-for": "203.0.113.7" });

    expect(resetEmail().vars["requestedAt"]).toContain("UTC");
  });

  it("an address with no account is sent nothing, as before", async () => {
    account = null;

    await forgotPassword({ "x-forwarded-for": "203.0.113.7" });

    expect(sentMails()).toHaveLength(0);
    expect(sendErrorResponse).toHaveBeenCalledTimes(1);
  });
});

describe("POST /reset-password", () => {
  it("hands the password's write where the reset came from", async () => {
    expect(
      await resetPassword({
        "x-forwarded-for": "203.0.113.7",
        "user-agent": FIREFOX_WINDOWS,
      }),
    ).toBeNull();

    expect(userUpdateOneById).toHaveBeenCalledTimes(1);

    const props: DatabaseCommonInteractionProps = (
      userUpdateOneById.mock.calls[0]![0] as {
        props: DatabaseCommonInteractionProps;
      }
    ).props;

    expect(props.isRoot).toBe(true);
    expect(props.requestOrigin).toEqual({
      ipAddress: "203.0.113.7",
      location: undefined,
      device: "Firefox 132 on Windows",
    });
  });

  /*
   * The write's own hook mails "Your password was changed"
   * (UserService.onUpdateSuccess; UserServicePasswordChangedEmail.test.ts),
   * as it does for every change of a password. The route used to mail it as
   * well, so every reset sent its owner the same email twice.
   */
  it("mails nothing itself: the write's hook sends the one email", async () => {
    await resetPassword({
      "x-forwarded-for": "203.0.113.7",
      "user-agent": FIREFOX_WINDOWS,
    });

    expect(sendMail).not.toHaveBeenCalled();
  });

  it("still signs every device out", async () => {
    await resetPassword({ "x-forwarded-for": "203.0.113.7" });

    expect(revokeAllSessionsByUserId).toHaveBeenCalledTimes(1);
    expect(revokeAllSessionsByUserId.mock.calls[0]![0]).toEqual(ACCOUNT.id);
  });
});
