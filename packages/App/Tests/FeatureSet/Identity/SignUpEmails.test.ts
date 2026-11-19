import AuthenticationEmail from "../../../FeatureSet/Identity/Utils/AuthenticationEmail";
import EmailProvedSignUp from "../../../FeatureSet/Identity/Utils/EmailProvedSignUp";
import SignUpAttempt, {
  SignUpAttemptKind,
  SignUpAttemptRecord,
} from "../../../FeatureSet/Identity/Utils/SignUpAttempt";
import { SIGN_UP_ATTEMPT_ID_PATTERN } from "../../../FeatureSet/Identity/Utils/VerificationEmailResendToken";
import { VERIFICATION_EMAIL_RESEND_UNAVAILABLE_MESSAGE } from "Common/Server/Middleware/IdentityRateLimit";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import User from "Common/Models/DatabaseModels/User";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import BadDataException from "Common/Types/Exception/BadDataException";
import DatabaseNotConnectedException from "Common/Types/Exception/DatabaseNotConnectedException";
import ServiceUnavailableException from "Common/Types/Exception/ServiceUnavailableException";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import RequestOrigin from "Common/Types/RequestOrigin";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * THE PIECES OF A SIGN-UP THAT SAYS NOTHING ABOUT ITS ADDRESS (#9816).
 *
 *   - AuthenticationEmail.sendAccountAlreadyExistsEmail: the email to an
 *     address that already has an account, where the page says only "check
 *     your email" - sent to the account's own address, with a way to sign in
 *     and to reset the password, and where the sign-up came from. With
 *     `awaitDelivery` (the resend button), a send that fails throws; without
 *     it (the sign-up, after its answer), it is logged and swallowed.
 *   - sendCompleteRegistrationEmail's `awaitDelivery`, for the same button.
 *   - SignUpAttempt: what a sign-up did with an address, kept in the cache for
 *     its credential's day, and each resend of it.
 *   - EmailProvedSignUp.isProvedByEmail: which servers answer every address
 *     alike - and assertFitsAnAccount, what is refused before the answer.
 *
 * The real classes; only their collaborators - the mail service, the cache,
 * the sending status - are stood in. The route that ties them together is
 * SignUpSaysNothingOfAccounts.test.ts and ResendVerificationEmail.test.ts.
 * ---------------------------------------------------------------------------
 */

let mockBillingEnabled: boolean = true;
let mockAwaitingFirstAccount: boolean = false;

jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual, __esModule: true };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      // Read by some services as the modules load, before the tests set it.
      try {
        return mockBillingEnabled;
      } catch {
        return true;
      }
    },
  });

  return mocked;
});

const sendMail: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/MailService", () => {
  return {
    __esModule: true,
    default: {
      sendMail: (...args: Array<unknown>): unknown => {
        return sendMail(...args);
      },
    },
  };
});

const generateRegistrationLink: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/UserRegistrationToken", () => {
  return {
    __esModule: true,
    REGISTRATION_TOKEN_EXPIRY_IN_DAYS: 7,
    default: {
      generateRegistrationLink: (...args: Array<unknown>): unknown => {
        return generateRegistrationLink(...args);
      },
    },
  };
});

jest.mock("Common/Server/DatabaseConfig", () => {
  return {
    __esModule: true,
    default: {
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

const canSendEmailPublicly: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/ServerSending/ServerSendingStatus", () => {
  return {
    __esModule: true,
    default: {
      canSendEmailPublicly: (...args: Array<unknown>): unknown => {
        return canSendEmailPublicly(...args);
      },
    },
  };
});

jest.mock("../../../FeatureSet/Identity/Utils/FirstAccount", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../FeatureSet/Identity/Utils/FirstAccount",
  ) as Record<string, unknown>;

  return {
    ...actual,
    isWaitingForFirstAccount: (): Promise<boolean> => {
      return Promise.resolve(mockAwaitingFirstAccount);
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

const MEMBER_ID: string = "11111111-1111-4111-8111-111111111111";
const ADDRESS: string = "member@example.com";

const ORIGIN: RequestOrigin = {
  ipAddress: "203.0.113.7",
  location: "Berlin, Germany",
  device: "Firefox on Linux",
} as unknown as RequestOrigin;

function member(): User {
  const user: User = new User();
  user._id = MEMBER_ID;
  user.email = new Email(ADDRESS);
  user.name = new Name("A Member");
  return user;
}

function sentMail(): JSONObject {
  expect(sendMail).toHaveBeenCalledTimes(1);
  return sendMail.mock.calls[0]![0] as JSONObject;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBillingEnabled = true;
  mockAwaitingFirstAccount = false;
  sendMail.mockResolvedValue(undefined);
  generateRegistrationLink.mockResolvedValue({
    toString: (): string => {
      return "https://oneuptime.test/accounts/register?token=t";
    },
  });
  canSendEmailPublicly.mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AuthenticationEmail.sendAccountAlreadyExistsEmail", () => {
  it("goes to the account's own address, as the 'you already have an account' email", async () => {
    await AuthenticationEmail.sendAccountAlreadyExistsEmail({
      user: member(),
      origin: ORIGIN,
    });

    const mail: JSONObject = sentMail();

    expect(String(mail["toEmail"])).toBe(ADDRESS);
    expect(mail["templateType"]).toBe(EmailTemplateType.AccountAlreadyExists);
    expect(mail["subject"]).toMatch(/^You already have a .+ account$/);
    expect(mail["isSubjectLiteral"]).toBe(true);
  });

  it("links to signing in and to resetting the password, on this server", async () => {
    await AuthenticationEmail.sendAccountAlreadyExistsEmail({
      user: member(),
      origin: ORIGIN,
    });

    const vars: JSONObject = sentMail()["vars"] as JSONObject;

    expect(vars["signInLink"]).toBe("https://oneuptime.test/accounts/login");
    expect(vars["forgotPasswordUrl"]).toBe(
      "https://oneuptime.test/accounts/forgot-password",
    );
    expect(vars["homeURL"]).toBe("https://oneuptime.test/");
  });

  it("says when and from where the sign-up came, so its owner can tell their own", async () => {
    await AuthenticationEmail.sendAccountAlreadyExistsEmail({
      user: member(),
      origin: ORIGIN,
    });

    const vars: JSONObject = sentMail()["vars"] as JSONObject;

    expect(vars["requestedAt"]).toEqual(expect.any(String));
  });

  it("sends nothing for an account with no address", async () => {
    const user: User = member();
    delete (user as unknown as Record<string, unknown>)["email"];

    await AuthenticationEmail.sendAccountAlreadyExistsEmail({ user: user });

    expect(sendMail).not.toHaveBeenCalled();
  });

  it("after a sign-up's answer, a send that fails is logged, never thrown", async () => {
    sendMail.mockRejectedValue(new Error("SMTP is down"));

    await expect(
      AuthenticationEmail.sendAccountAlreadyExistsEmail({ user: member() }),
    ).resolves.toBeUndefined();

    expect(loggerError).toHaveBeenCalled();
  });

  it.each([
    [
      "throws",
      (): void => {
        sendMail.mockRejectedValue(new Error("SMTP is down"));
      },
    ],
    [
      "answers with an error status",
      (): void => {
        sendMail.mockResolvedValue(
          new HTTPErrorResponse(502, { error: "Bad gateway" }, {}),
        );
      },
    ],
  ])(
    "for the resend button, a mail service that %s fails the send, with one fixed refusal",
    async (_how: string, setUp: () => void) => {
      setUp();

      let thrown: unknown = null;

      try {
        await AuthenticationEmail.sendAccountAlreadyExistsEmail({
          user: member(),
          awaitDelivery: true,
        });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(ServiceUnavailableException);
      expect((thrown as Error).message).toBe(
        VERIFICATION_EMAIL_RESEND_UNAVAILABLE_MESSAGE,
      );
    },
  );
});

describe("AuthenticationEmail.sendCompleteRegistrationEmail", () => {
  it("swallows a failed send by default: whoever typed the address must not learn of the invitation", async () => {
    sendMail.mockRejectedValue(new Error("SMTP is down"));

    await expect(
      AuthenticationEmail.sendCompleteRegistrationEmail({
        userId: new ObjectID(MEMBER_ID),
        email: new Email(ADDRESS),
      }),
    ).resolves.toBeUndefined();
  });

  it("fails the send for the resend button, which says a mail went out", async () => {
    sendMail.mockResolvedValue(
      new HTTPErrorResponse(500, { error: "Mail service failed" }, {}),
    );

    await expect(
      AuthenticationEmail.sendCompleteRegistrationEmail({
        userId: new ObjectID(MEMBER_ID),
        email: new Email(ADDRESS),
        awaitDelivery: true,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("still goes to the invited address, with its link", async () => {
    await AuthenticationEmail.sendCompleteRegistrationEmail({
      userId: new ObjectID(MEMBER_ID),
      email: new Email(ADDRESS),
      awaitDelivery: true,
    });

    const mail: JSONObject = sentMail();

    expect(String(mail["toEmail"])).toBe(ADDRESS);
    expect(mail["templateType"]).toBe(EmailTemplateType.CompleteRegistration);
    expect((mail["vars"] as JSONObject)["registrationLink"]).toBe(
      "https://oneuptime.test/accounts/register?token=t",
    );
  });
});

describe("SignUpAttempt - what a sign-up did, kept for its credential's day", () => {
  let store: Map<string, { value: string; expiresInSeconds: number }>;

  beforeEach(() => {
    store = new Map<string, { value: string; expiresInSeconds: number }>();

    jest
      .spyOn(GlobalCache, "setString")
      .mockImplementation(
        async (
          namespace: string,
          key: string,
          value: string,
          options?: { expiresInSeconds?: number },
        ) => {
          store.set(`${namespace}:${key}`, {
            value: value,
            expiresInSeconds: options?.expiresInSeconds || 0,
          });
        },
      );
    jest
      .spyOn(GlobalCache, "getString")
      .mockImplementation(
        async (namespace: string, key: string): Promise<string | null> => {
          return store.get(`${namespace}:${key}`)?.value || null;
        },
      );
  });

  it("mints ids nobody can guess, in the shape the credential carries", () => {
    const ids: Set<string> = new Set<string>();

    for (let index: number = 0; index < 50; index++) {
      const id: string = SignUpAttempt.newAttemptId();

      expect(id).toMatch(SIGN_UP_ATTEMPT_ID_PATTERN);
      ids.add(id);
    }

    expect(ids.size).toBe(50);
  });

  it.each([
    [SignUpAttemptKind.NewAccount],
    [SignUpAttemptKind.ExistingAccount],
    [SignUpAttemptKind.UnclaimedAccount],
  ])(
    "keeps a %s attempt for a day, and reads it back",
    async (kind: SignUpAttemptKind) => {
      const attemptId: string = SignUpAttempt.newAttemptId();

      await SignUpAttempt.record({
        attemptId: attemptId,
        userId: new ObjectID(MEMBER_ID),
        kind: kind,
      });

      const kept: { value: string; expiresInSeconds: number } = store.get(
        `identity-sign-up-attempt:${attemptId}`,
      )!;

      expect(kept.expiresInSeconds).toBe(24 * 60 * 60);

      const record: SignUpAttemptRecord | null =
        await SignUpAttempt.read(attemptId);

      expect(record!.userId.toString()).toBe(MEMBER_ID);
      expect(record!.kind).toBe(kind);
      expect(record!.resentAt).toEqual([]);
    },
  );

  it("adds each resend, and keeps it only until the credential stops working", async () => {
    const attemptId: string = SignUpAttempt.newAttemptId();

    await SignUpAttempt.record({
      attemptId: attemptId,
      userId: new ObjectID(MEMBER_ID),
      kind: SignUpAttemptKind.ExistingAccount,
    });

    const at: Date = new Date("2026-11-19T10:00:00.000Z");

    await SignUpAttempt.noteResend({
      attemptId: attemptId,
      record: (await SignUpAttempt.read(attemptId))!,
      at: at,
      expiresAt: new Date(at.getTime() + 3 * 60 * 60 * 1000),
    });

    const record: SignUpAttemptRecord | null =
      await SignUpAttempt.read(attemptId);

    expect(
      record!.resentAt.map((time: Date) => {
        return time.getTime();
      }),
    ).toEqual([at.getTime()]);
    expect(
      store.get(`identity-sign-up-attempt:${attemptId}`)!.expiresInSeconds,
    ).toBe(3 * 60 * 60);
  });

  it("keeps nothing for a credential that has already stopped working", async () => {
    const attemptId: string = SignUpAttempt.newAttemptId();
    const at: Date = new Date();

    await SignUpAttempt.noteResend({
      attemptId: attemptId,
      record: {
        userId: new ObjectID(MEMBER_ID),
        kind: SignUpAttemptKind.NewAccount,
        resentAt: [],
      },
      at: at,
      expiresAt: new Date(at.getTime() - 1),
    });

    expect(store.size).toBe(0);
  });

  it.each([
    ["nothing kept", null],
    ["not JSON", "{not json"],
    ["a list", "[]"],
    ["an account id that is not one", '{"u":"x","k":"new-account","r":[]}'],
    [
      "a kind that is not one",
      `{"u":"${MEMBER_ID}","k":"administrator","r":[]}`,
    ],
    ["no resends list", `{"u":"${MEMBER_ID}","k":"new-account"}`],
  ])(
    "reads %s as nothing kept",
    async (_case: string, value: string | null) => {
      const attemptId: string = SignUpAttempt.newAttemptId();

      if (value !== null) {
        store.set(`identity-sign-up-attempt:${attemptId}`, {
          value: value,
          expiresInSeconds: 60,
        });
      }

      expect(await SignUpAttempt.read(attemptId)).toBeNull();
    },
  );

  it("lets a cache that cannot be reached say so, for the route to answer as an outage", async () => {
    jest
      .spyOn(GlobalCache, "getString")
      .mockRejectedValue(new DatabaseNotConnectedException("down"));

    await expect(
      SignUpAttempt.read(SignUpAttempt.newAttemptId()),
    ).rejects.toBeInstanceOf(DatabaseNotConnectedException);
  });
});

describe("EmailProvedSignUp.isProvedByEmail - which servers answer every address alike", () => {
  it("OneUptime Cloud always does, without asking anything else", async () => {
    mockBillingEnabled = true;

    expect(await EmailProvedSignUp.isProvedByEmail()).toBe(true);
    expect(canSendEmailPublicly).not.toHaveBeenCalled();
  });

  it("a self-hosted server does while it can send email", async () => {
    mockBillingEnabled = false;
    canSendEmailPublicly.mockResolvedValue(true);

    expect(await EmailProvedSignUp.isProvedByEmail()).toBe(true);
  });

  it("a self-hosted server that cannot send email does not: its new accounts sign in at once", async () => {
    mockBillingEnabled = false;
    canSendEmailPublicly.mockResolvedValue(false);

    expect(await EmailProvedSignUp.isProvedByEmail()).toBe(false);
  });

  it("never for a self-hosted server's first account, which becomes its admin", async () => {
    mockBillingEnabled = false;
    mockAwaitingFirstAccount = true;
    canSendEmailPublicly.mockResolvedValue(true);

    expect(await EmailProvedSignUp.isProvedByEmail()).toBe(false);
  });

  it("a sending status that cannot be read counts as 'cannot send'", async () => {
    mockBillingEnabled = false;
    canSendEmailPublicly.mockRejectedValue(new Error("database is down"));

    expect(await EmailProvedSignUp.isProvedByEmail()).toBe(false);
  });
});

describe("EmailProvedSignUp.assertFitsAnAccount - refused before the answer", () => {
  it("lets a form that fits through", () => {
    const user: User = member();

    expect(() => {
      EmailProvedSignUp.assertFitsAnAccount(user);
    }).not.toThrow();
  });

  it("refuses a value longer than its column, with what to do next", () => {
    const user: User = member();
    user.companyName = "c".repeat(1000);

    let thrown: unknown = null;

    try {
      EmailProvedSignUp.assertFitsAnAccount(user);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(BadDataException);
    expect((thrown as Error).message).toMatch(
      /^.+ can be at most \d+ characters long\. Shorten it and try again\.$/,
    );
  });
});
