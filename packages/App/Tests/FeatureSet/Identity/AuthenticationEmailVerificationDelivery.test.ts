import AuthenticationEmail from "../../../FeatureSet/Identity/Utils/AuthenticationEmail";
import { VERIFICATION_EMAIL_RESEND_UNAVAILABLE_MESSAGE } from "Common/Server/Middleware/IdentityRateLimit";
import EmailVerificationToken from "Common/Models/DatabaseModels/EmailVerificationToken";
import User from "Common/Models/DatabaseModels/User";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import Exception from "Common/Types/Exception/Exception";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import ServiceUnavailableException from "Common/Types/Exception/ServiceUnavailableException";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A VERIFICATION MAIL THAT DID NOT GO OUT MUST NOT BE REPORTED AS SENT -- BUT
 * ONLY WHERE THE CALLER HAS SAID SO.
 *
 * AuthenticationEmail.sendVerificationEmail mints a token row and mails its
 * link. Sign-in has always fired that mail and forgotten it: "we have sent you
 * a link" goes back whether or not SMTP is up, and nothing here may change
 * that. /resend-verification-email is different. Its reply says, in so many
 * words, that a mail went out, and its caps count every token row as a mail
 * sent -- so it passes `awaitDelivery`, and then:
 *
 *   - the call does not resolve until the mail service has answered;
 *
 *   - a send that fails fails the call, whether the mail service threw or
 *     ANSWERED with an error status. The shared API client returns error
 *     statuses rather than throwing them, so an await alone would read every
 *     refusal the mail service actually sends back as a success;
 *
 *   - the failure takes its own token row with it -- that row and no other --
 *     so an outage cannot spend a user's resends on mail that never left;
 *
 *   - what the caller is told is one fixed 503. The mail service's own error
 *     text goes to the log, never to an anonymous caller.
 *
 * This is the REAL class. Only its collaborators -- the mail service, the
 * token table, the host config and the logger -- are replaced, so every
 * promise the tests hand it is one it genuinely waits on (or does not).
 * ---------------------------------------------------------------------------
 */

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

const createEmailVerificationToken: jest.Mock = jest.fn();
const deleteEmailVerificationToken: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/EmailVerificationTokenService", () => {
  return {
    __esModule: true,
    default: {
      create: (...args: Array<unknown>): unknown => {
        return createEmailVerificationToken(...args);
      },
      deleteOneBy: (...args: Array<unknown>): unknown => {
        return deleteEmailVerificationToken(...args);
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

// Every log line is captured, so the tests can prove where the error text went.
const loggerInfo: jest.Mock = jest.fn();
const loggerError: jest.Mock = jest.fn();
const loggerWarn: jest.Mock = jest.fn();
const loggerDebug: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: (...args: Array<unknown>): void => {
        loggerInfo(...args);
      },
      error: (...args: Array<unknown>): void => {
        loggerError(...args);
      },
      warn: (...args: Array<unknown>): void => {
        loggerWarn(...args);
      },
      debug: (...args: Array<unknown>): void => {
        loggerDebug(...args);
      },
    },
    getLogAttributesFromRequest: (): Record<string, unknown> => {
      return {};
    },
  };
});

const USER_ID: string = "22222222-2222-4222-8222-222222222222";
const USER_EMAIL: string = "new-user@example.com";

/*
 * What the mail service might say about itself on the way down: internal
 * host names, a relay account, an SMTP reply. The log may have it; the
 * anonymous caller may not.
 */
const MAIL_SERVICE_ERROR_TEXT: string =
  "smtp-relay.internal.example:587 refused notifier@internal.example: 535 5.7.8 authentication failed";

const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LOG_CONTEXT: JSONObject = { userId: USER_ID, service: "identity" };

type SendOptions = { awaitDelivery?: boolean | undefined } | undefined;

type TestUserFunction = () => User;

// The account as the route hands it over: id, stored address and name.
const testUser: TestUserFunction = (): User => {
  const user: User = new User();
  user._id = USER_ID;
  user.email = new Email(USER_EMAIL);
  user.name = new Name("New User");

  return user;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

type DeferredFunction = <T>() => Deferred<T>;

/*
 * A mail send the test settles by hand -- or never, which is how the tests
 * prove what is and is not waited on.
 */
const deferred: DeferredFunction = <T>(): Deferred<T> => {
  let resolveDeferred!: (value: T) => void;
  let rejectDeferred!: (reason: unknown) => void;

  const promise: Promise<T> = new Promise<T>(
    (resolve: (value: T) => void, reject: (reason: unknown) => void) => {
      resolveDeferred = resolve;
      rejectDeferred = reject;
    },
  );

  return { promise, resolve: resolveDeferred, reject: rejectDeferred };
};

type SettleFunction = () => Promise<void>;

/*
 * Lets every promise chain that CAN run, run: a handful of macrotask turns,
 * each of which drains the microtask queue behind it.
 */
const settle: SettleFunction = async (): Promise<void> => {
  for (let turn: number = 0; turn < 10; turn++) {
    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });
  }
};

type Tracked = {
  state: "pending" | "resolved" | "rejected";
  error: unknown;
  done: Promise<void>;
};

type TrackFunction = (promise: Promise<void>) => Tracked;

// Watches a call without awaiting it, so a test can ask "has it finished yet?".
const track: TrackFunction = (promise: Promise<void>): Tracked => {
  const tracked: Tracked = {
    state: "pending",
    error: null,
    done: Promise.resolve(),
  };

  tracked.done = promise.then(
    () => {
      tracked.state = "resolved";
    },
    (err: unknown) => {
      tracked.state = "rejected";
      tracked.error = err;
    },
  );

  return tracked;
};

type CaptureFailureFunction = (options: SendOptions) => Promise<unknown>;

// The error the call rejects with; fails the test if it resolves instead.
const captureFailure: CaptureFailureFunction = async (
  options: SendOptions,
): Promise<unknown> => {
  const tracked: Tracked = track(
    AuthenticationEmail.sendVerificationEmail(testUser(), options),
  );

  await tracked.done;

  expect(tracked.state).toBe("rejected");

  return tracked.error;
};

type CreatedRowFunction = () => EmailVerificationToken;

// The one token row the call wrote.
const createdRow: CreatedRowFunction = (): EmailVerificationToken => {
  expect(createEmailVerificationToken).toHaveBeenCalledTimes(1);

  return (
    createEmailVerificationToken.mock.calls[0]![0] as {
      data: EmailVerificationToken;
    }
  ).data;
};

type CreatedTokenFunction = () => string;

const createdToken: CreatedTokenFunction = (): string => {
  return createdRow().token!.toString();
};

type SentMailFunction = () => Record<string, any>;

// The one mail the call asked the mail service to send.
const sentMail: SentMailFunction = (): Record<string, any> => {
  expect(sendMail).toHaveBeenCalledTimes(1);

  return sendMail.mock.calls[0]![0] as Record<string, any>;
};

type ExpectUnavailableFunction = (error: unknown) => void;

/*
 * The one failure a caller of awaitDelivery ever sees: a 503 carrying the
 * fixed resend wording, whatever actually went wrong underneath.
 */
const expectUnavailable: ExpectUnavailableFunction = (error: unknown): void => {
  expect(error).toBeInstanceOf(ServiceUnavailableException);
  expect((error as Exception).code).toBe(
    ExceptionCode.ServiceUnavailableException,
  );
  expect((error as Exception).code).toBe(503);
  expect((error as Exception).message).toBe(
    VERIFICATION_EMAIL_RESEND_UNAVAILABLE_MESSAGE,
  );
};

type ExpectRowRemovedFunction = () => void;

// Exactly the row this call created -- by its token, as root, and nothing else.
const expectOwnRowRemoved: ExpectRowRemovedFunction = (): void => {
  expect(deleteEmailVerificationToken).toHaveBeenCalledTimes(1);

  const deletion: Record<string, any> = deleteEmailVerificationToken.mock
    .calls[0]![0] as Record<string, any>;

  /*
   * Only `token`. A delete keyed on the user would take the account's whole
   * send history with it -- every row the caps count -- and hand an outage a
   * way to reset them.
   */
  expect(Object.keys(deletion).sort()).toEqual(["props", "query"]);
  expect(Object.keys(deletion["query"])).toEqual(["token"]);
  expect(deletion["query"]["token"]).toBeInstanceOf(ObjectID);
  expect(deletion["query"]["token"].toString()).toBe(createdToken());
  expect(deletion["props"]).toEqual({ isRoot: true });

  // Written before the send, removed after it: never the other way round.
  expect(
    createEmailVerificationToken.mock.invocationCallOrder[0]!,
  ).toBeLessThan(sendMail.mock.invocationCallOrder[0]!);
  expect(sendMail.mock.invocationCallOrder[0]!).toBeLessThan(
    deleteEmailVerificationToken.mock.invocationCallOrder[0]!,
  );
};

type OneLocalDayAfterFunction = (epochMs: number) => number;

/*
 * The same calendar day tomorrow, in local time -- which is what the row's
 * expiry is (a moment `add(1, "days")`), and which is 23 or 25 hours across a
 * daylight-saving change rather than 24.
 */
const oneLocalDayAfter: OneLocalDayAfterFunction = (
  epochMs: number,
): number => {
  const date: Date = new Date(epochMs);
  date.setDate(date.getDate() + 1);

  return date.getTime();
};

type FailureCase = [string, () => Promise<unknown>];

/*
 * Every way the mail service can fail to send. Each returns a FRESH promise:
 * a rejected one made up front and left unobserved would be reported by Node
 * as unhandled before the code under test ever reached it.
 */
const FAILURES: Array<FailureCase> = [
  [
    "the mail service throws",
    (): Promise<unknown> => {
      return Promise.reject(new Error(MAIL_SERVICE_ERROR_TEXT));
    },
  ],
  [
    "the mail service answers 500",
    (): Promise<unknown> => {
      return Promise.resolve(
        new HTTPErrorResponse(500, { error: MAIL_SERVICE_ERROR_TEXT }, {}),
      );
    },
  ],
  [
    "the mail service answers 400",
    (): Promise<unknown> => {
      return Promise.resolve(
        new HTTPErrorResponse(400, { message: MAIL_SERVICE_ERROR_TEXT }, {}),
      );
    },
  ],
];

beforeEach(() => {
  jest.clearAllMocks();

  createEmailVerificationToken.mockResolvedValue(null);
  deleteEmailVerificationToken.mockResolvedValue(undefined);
  sendMail.mockImplementation((): Promise<unknown> => {
    return Promise.resolve(new HTTPResponse(200, {}, {}));
  });
});

describe("the token row it mints", () => {
  it("writes one row for the account's id and stored address, as root, expiring a day out", async () => {
    const before: number = Date.now();
    await AuthenticationEmail.sendVerificationEmail(testUser());
    const after: number = Date.now();

    expect(createEmailVerificationToken).toHaveBeenCalledTimes(1);

    const creation: Record<string, any> = createEmailVerificationToken.mock
      .calls[0]![0] as Record<string, any>;
    const row: EmailVerificationToken = createdRow();

    expect(row).toBeInstanceOf(EmailVerificationToken);
    expect(creation["props"]).toEqual({ isRoot: true });
    expect(row.userId!.toString()).toBe(USER_ID);
    expect(row.email!.toString()).toBe(USER_EMAIL);
    expect(row.token).toBeInstanceOf(ObjectID);
    expect(row.token!.toString()).toMatch(UUID_PATTERN);

    const expiresAt: number = new Date(row.expires!).getTime();

    expect(expiresAt).toBeGreaterThanOrEqual(oneLocalDayAfter(before));
    expect(expiresAt).toBeLessThanOrEqual(oneLocalDayAfter(after));
  });

  it("mints a different token on every call", async () => {
    await AuthenticationEmail.sendVerificationEmail(testUser());
    await AuthenticationEmail.sendVerificationEmail(testUser(), {
      awaitDelivery: true,
    });

    expect(createEmailVerificationToken).toHaveBeenCalledTimes(2);

    const tokens: Array<string> = (
      createEmailVerificationToken.mock.calls as Array<Array<unknown>>
    ).map((call: Array<unknown>) => {
      return (
        call[0] as { data: EmailVerificationToken }
      ).data.token!.toString();
    });

    expect(tokens[0]).not.toBe(tokens[1]);
  });

  it.each([
    ["by default", undefined],
    ["with awaitDelivery", { awaitDelivery: true }],
  ])(
    "mails nothing when the row cannot be written, %s",
    async (_label: string, options: SendOptions) => {
      /*
       * A link with no row behind it would be a dead link in somebody's
       * inbox; the write failing is the caller's failure to handle.
       */
      const writeFailure: Error = new Error("could not write the token row");
      createEmailVerificationToken.mockRejectedValue(writeFailure);

      expect(await captureFailure(options)).toBe(writeFailure);
      expect(sendMail).not.toHaveBeenCalled();
      expect(deleteEmailVerificationToken).not.toHaveBeenCalled();
    },
  );
});

describe("the mail it sends", () => {
  it.each([
    ["by default", undefined],
    ["with awaitDelivery", { awaitDelivery: true }],
  ])(
    "goes to the stored address with a link to the token it just wrote, %s",
    async (_label: string, options: SendOptions) => {
      const user: User = testUser();

      await AuthenticationEmail.sendVerificationEmail(user, options);

      const mail: Record<string, any> = sentMail();

      expect(mail["toEmail"]).toBe(user.email);
      expect(mail["toEmail"].toString()).toBe(USER_EMAIL);
      expect(mail["subject"]).toBe("Please verify email.");
      expect(mail["isSubjectLiteral"]).toBe(true);
      expect(mail["templateType"]).toBe(EmailTemplateType.SignupWelcomeEmail);
      expect(mail["vars"]["name"]).toBe("New User");

      // The link is the row's token, on the host the install is configured for.
      expect(mail["vars"]["tokenVerifyUrl"]).toBe(
        `https://oneuptime.test/accounts/verify-email/${createdToken()}`,
      );
      expect(mail["vars"]["homeUrl"]).toMatch(/^https:\/\/oneuptime\.test\/?$/);
    },
  );

  it("sends the mail only after its row is written", async () => {
    await AuthenticationEmail.sendVerificationEmail(testUser(), {
      awaitDelivery: true,
    });

    expect(
      createEmailVerificationToken.mock.invocationCallOrder[0]!,
    ).toBeLessThan(sendMail.mock.invocationCallOrder[0]!);
  });
});

describe("by default -- fire and forget, as sign-in has always had it", () => {
  const DEFAULT_OPTIONS: Array<[string, SendOptions]> = [
    ["no options", undefined],
    ["empty options", {}],
    ["awaitDelivery: false", { awaitDelivery: false }],
    ["awaitDelivery: undefined", { awaitDelivery: undefined }],
  ];

  it.each(DEFAULT_OPTIONS)(
    "resolves before the mail has settled, given %s",
    async (_label: string, options: SendOptions) => {
      const mail: Deferred<unknown> = deferred<unknown>();
      sendMail.mockReturnValue(mail.promise);

      const call: Tracked = track(
        AuthenticationEmail.sendVerificationEmail(testUser(), options),
      );

      await settle();

      // The send was started, and nobody is waiting on it.
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(call.state).toBe("resolved");

      mail.resolve(new HTTPResponse(200, {}, {}));
      await settle();
    },
  );

  it.each(DEFAULT_OPTIONS)(
    "still resolves, keeps its row and logs the error when the mail throws, given %s",
    async (_label: string, options: SendOptions) => {
      const mailFailure: Error = new Error(MAIL_SERVICE_ERROR_TEXT);
      sendMail.mockImplementation((): Promise<unknown> => {
        return Promise.reject(mailFailure);
      });

      const call: Tracked = track(
        AuthenticationEmail.sendVerificationEmail(testUser(), options),
      );

      await settle();

      expect(call.state).toBe("resolved");
      expect(deleteEmailVerificationToken).not.toHaveBeenCalled();
      expect(loggerError).toHaveBeenCalledWith(mailFailure, LOG_CONTEXT);
    },
  );

  it.each(DEFAULT_OPTIONS)(
    "still resolves and keeps its row when the mail service answers with an error, given %s",
    async (_label: string, options: SendOptions) => {
      sendMail.mockResolvedValue(
        new HTTPErrorResponse(500, { error: MAIL_SERVICE_ERROR_TEXT }, {}),
      );

      const call: Tracked = track(
        AuthenticationEmail.sendVerificationEmail(testUser(), options),
      );

      await settle();

      expect(call.state).toBe("resolved");
      expect(deleteEmailVerificationToken).not.toHaveBeenCalled();
    },
  );

  it("resolves even when the mail never answers at all", async () => {
    sendMail.mockReturnValue(deferred<unknown>().promise);

    const call: Tracked = track(
      AuthenticationEmail.sendVerificationEmail(testUser()),
    );

    await settle();

    expect(call.state).toBe("resolved");
  });
});

describe("with awaitDelivery -- what /resend-verification-email uses", () => {
  it("does not resolve until the mail service has answered", async () => {
    const mail: Deferred<unknown> = deferred<unknown>();
    sendMail.mockReturnValue(mail.promise);

    const call: Tracked = track(
      AuthenticationEmail.sendVerificationEmail(testUser(), {
        awaitDelivery: true,
      }),
    );

    await settle();

    // The send is in flight, and the call is still waiting on it.
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(call.state).toBe("pending");

    mail.resolve(new HTTPResponse(200, {}, {}));
    await call.done;

    expect(call.state).toBe("resolved");
  });

  it("keeps its row and logs no error once the mail is accepted", async () => {
    await AuthenticationEmail.sendVerificationEmail(testUser(), {
      awaitDelivery: true,
    });

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(deleteEmailVerificationToken).not.toHaveBeenCalled();
    expect(loggerError).not.toHaveBeenCalled();
    expect(loggerDebug).toHaveBeenCalledWith(
      "Verification email sent",
      LOG_CONTEXT,
    );
  });

  it.each(FAILURES)(
    "rejects with the fixed 503 when %s",
    async (_label: string, failingSend: () => Promise<unknown>) => {
      sendMail.mockImplementation(failingSend);

      expectUnavailable(await captureFailure({ awaitDelivery: true }));
    },
  );

  it.each(FAILURES)(
    "removes the row it just wrote -- that row only -- when %s",
    async (_label: string, failingSend: () => Promise<unknown>) => {
      sendMail.mockImplementation(failingSend);

      await captureFailure({ awaitDelivery: true });

      expectOwnRowRemoved();
    },
  );

  it.each(FAILURES)(
    "logs what the mail service said, and tells the caller none of it, when %s",
    async (_label: string, failingSend: () => Promise<unknown>) => {
      sendMail.mockImplementation(failingSend);

      const error: unknown = await captureFailure({ awaitDelivery: true });

      // The log gets the real failure, against the account id only.
      expect(loggerError).toHaveBeenCalledTimes(1);

      const [logged, context] = loggerError.mock.calls[0]! as [
        unknown,
        unknown,
      ];

      expect(context).toEqual(LOG_CONTEXT);
      expect(
        logged instanceof Error
          ? logged.message
          : (logged as HTTPErrorResponse).message,
      ).toBe(MAIL_SERVICE_ERROR_TEXT);

      // The caller gets the fixed wording, and nothing that came with it.
      const exception: Exception = error as Exception;

      expect(exception.message).not.toContain(MAIL_SERVICE_ERROR_TEXT);
      expect(String(exception)).not.toContain(MAIL_SERVICE_ERROR_TEXT);
      expect(exception.stack || "").not.toContain(MAIL_SERVICE_ERROR_TEXT);
      expect(JSON.stringify(exception)).not.toContain("smtp-relay");
      expect(
        (exception as unknown as { cause?: unknown }).cause,
      ).toBeUndefined();
    },
  );

  it.each(FAILURES)(
    "still rejects with the fixed 503 -- not the delete's error -- when the row cannot be removed either, and %s",
    async (_label: string, failingSend: () => Promise<unknown>) => {
      const deleteFailure: Error = new Error("could not delete the token row");
      sendMail.mockImplementation(failingSend);
      deleteEmailVerificationToken.mockRejectedValue(deleteFailure);

      const error: unknown = await captureFailure({ awaitDelivery: true });

      expectUnavailable(error);
      expect(error).not.toBe(deleteFailure);
      expect((error as Exception).message).not.toContain(
        "could not delete the token row",
      );

      // The removal was attempted on the right row, and its failure logged.
      expectOwnRowRemoved();
      expect(loggerError).toHaveBeenCalledWith(deleteFailure, LOG_CONTEXT);
    },
  );

  it("does not settle until the row has been removed", async () => {
    /*
     * The route releases its fence -- and the user may press "resend" again
     * -- the moment this rejects. The row has to be gone by then, or the
     * next request counts a mail that never left.
     */
    const removal: Deferred<unknown> = deferred<unknown>();
    sendMail.mockImplementation((): Promise<unknown> => {
      return Promise.reject(new Error(MAIL_SERVICE_ERROR_TEXT));
    });
    deleteEmailVerificationToken.mockReturnValue(removal.promise);

    const call: Tracked = track(
      AuthenticationEmail.sendVerificationEmail(testUser(), {
        awaitDelivery: true,
      }),
    );

    await settle();

    expect(deleteEmailVerificationToken).toHaveBeenCalledTimes(1);
    expect(call.state).toBe("pending");

    removal.resolve(undefined);
    await call.done;

    expectUnavailable(call.error);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["false", false],
  ])(
    "treats a send rejected with %s as a failure too",
    async (_label: string, reason: unknown) => {
      /*
       * A rejection is a failed send whatever it carries. A check on the
       * rejection's VALUE, rather than on the fact of it, would read a bare
       * `Promise.reject()` as a mail that went out.
       */
      sendMail.mockImplementation((): Promise<unknown> => {
        return Promise.reject(reason);
      });

      expectUnavailable(await captureFailure({ awaitDelivery: true }));
      expectOwnRowRemoved();
    },
  );
});
