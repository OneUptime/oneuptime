import EmailChangeConfirmation, {
  EMAIL_CHANGE_CANNOT_BE_EMAILED_MESSAGE,
  EMAIL_CHANGE_LINK_EXPIRY_IN_HOURS,
  EMAIL_CHANGE_TOO_MANY_MESSAGE,
  EMAIL_CHANGE_UNAVAILABLE_MESSAGE,
  EMAIL_CHANGES_PER_HOUR,
} from "../../../Server/Utils/EmailChange/EmailChangeConfirmation";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import EmailVerificationTokenService from "../../../Server/Services/EmailVerificationTokenService";
import MailService from "../../../Server/Services/MailService";
import ServerSendingStatus from "../../../Server/Utils/ServerSending/ServerSendingStatus";
import EmailVerificationToken from "../../../Models/DatabaseModels/EmailVerificationToken";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import Email from "../../../Types/Email";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import BadDataException from "../../../Types/Exception/BadDataException";
import DatabaseNotConnectedException from "../../../Types/Exception/DatabaseNotConnectedException";
import ServiceUnavailableException from "../../../Types/Exception/ServiceUnavailableException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import ObjectID from "../../../Types/ObjectID";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A OneUptime Cloud server can always send the confirming email
 * (canSendEmail asks nothing there), and CI's config.env sets
 * BILLING_ENABLED=true: billing is pinned off, for the self-hosted server
 * these tests are about, and on only where a test says so.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * EmailChangeConfirmation (#9821): what a person's own change of address
 * asks before it is held, and what it sends to the new address once the
 * request has been answered.
 *
 *   - assertMayAsk: a server that cannot send the confirming email refuses
 *     the change, with what to do instead; an account and a new address are
 *     each asked about a few times an hour, counted before anything about
 *     the address is read, so a refusal is the same for every address; and
 *     a refused account uses up nothing of the address's hour.
 *   - sendForPendingChange: a free address gets a link (a token row naming
 *     the account and the address, as /verify-email reads it); a taken one
 *     gets word that it has an account, and no token. It never throws.
 */

const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const NEW_EMAIL: Email = new Email("river@new-mailbox.example.com");

type Counters = Record<string, number>;

let counters: Counters;

function countLikeRedis(): void {
  jest.spyOn(GlobalCache, "incrementIfBelow").mockImplementation((async (
    namespace: string,
    key: string,
    options: { limit: number },
  ): Promise<number | null> => {
    const name: string = `${namespace}-${key}`;
    const current: number = counters[name] || 0;

    if (current >= options.limit) {
      return null;
    }

    counters[name] = current + 1;
    return counters[name]!;
  }) as never);
}

beforeEach(() => {
  setTestBillingEnabled(false);
  counters = {};
  countLikeRedis();
  jest
    .spyOn(ServerSendingStatus, "canSendEmailPublicly")
    .mockResolvedValue(true);
});

afterEach(() => {
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("assertMayAsk", () => {
  test("a server that cannot send email refuses the change, and says who can make it", async () => {
    (
      ServerSendingStatus.canSendEmailPublicly as unknown as jest.SpyInstance
    ).mockResolvedValue(false);

    const refusal: Promise<void> = EmailChangeConfirmation.assertMayAsk({
      userId: USER_ID,
      newEmail: NEW_EMAIL,
    });

    await expect(refusal).rejects.toBeInstanceOf(BadDataException);
    await expect(refusal).rejects.toThrow(
      EMAIL_CHANGE_CANNOT_BE_EMAILED_MESSAGE,
    );
    // Refused before anything is counted.
    expect(GlobalCache.incrementIfBelow).not.toHaveBeenCalled();
  });

  test("a status that cannot be read counts as a server that cannot send", async () => {
    (
      ServerSendingStatus.canSendEmailPublicly as unknown as jest.SpyInstance
    ).mockRejectedValue(new Error("settings unreadable"));

    await expect(EmailChangeConfirmation.canSendEmail()).resolves.toBe(false);
  });

  test("OneUptime Cloud can always send, without reading a status", async () => {
    setTestBillingEnabled(true);
    (
      ServerSendingStatus.canSendEmailPublicly as unknown as jest.SpyInstance
    ).mockResolvedValue(false);

    await expect(EmailChangeConfirmation.canSendEmail()).resolves.toBe(true);
    expect(ServerSendingStatus.canSendEmailPublicly).not.toHaveBeenCalled();
  });

  test(`an account may ask ${EMAIL_CHANGES_PER_HOUR} times an hour, then is told to wait`, async () => {
    for (let i: number = 0; i < EMAIL_CHANGES_PER_HOUR; i++) {
      await EmailChangeConfirmation.assertMayAsk({
        userId: USER_ID,
        newEmail: new Email(`river+${i}@new-mailbox.example.com`),
      });
    }

    const refusal: Promise<void> = EmailChangeConfirmation.assertMayAsk({
      userId: USER_ID,
      newEmail: new Email("river+last@new-mailbox.example.com"),
    });

    await expect(refusal).rejects.toBeInstanceOf(TooManyRequestsException);
    await expect(refusal).rejects.toThrow(EMAIL_CHANGE_TOO_MANY_MESSAGE);
  });

  test("one address is asked for a few times an hour, however many accounts ask", async () => {
    for (let i: number = 0; i < EMAIL_CHANGES_PER_HOUR; i++) {
      await EmailChangeConfirmation.assertMayAsk({
        userId: ObjectID.generate(),
        newEmail: NEW_EMAIL,
      });
    }

    await expect(
      EmailChangeConfirmation.assertMayAsk({
        userId: ObjectID.generate(),
        newEmail: new Email(NEW_EMAIL.toString().toUpperCase()),
      }),
    ).rejects.toThrow(EMAIL_CHANGE_TOO_MANY_MESSAGE);
  });

  test("a refused account uses up nothing of an address's hour", async () => {
    for (let i: number = 0; i < EMAIL_CHANGES_PER_HOUR; i++) {
      await EmailChangeConfirmation.assertMayAsk({
        userId: USER_ID,
        newEmail: new Email(`river+${i}@new-mailbox.example.com`),
      });
    }

    for (let i: number = 0; i < 20; i++) {
      await expect(
        EmailChangeConfirmation.assertMayAsk({
          userId: USER_ID,
          newEmail: NEW_EMAIL,
        }),
      ).rejects.toThrow(EMAIL_CHANGE_TOO_MANY_MESSAGE);
    }

    // Its owner still may.
    await expect(
      EmailChangeConfirmation.assertMayAsk({
        userId: ObjectID.generate(),
        newEmail: NEW_EMAIL,
      }),
    ).resolves.toBeUndefined();
  });

  test("no address is kept in the cache: its counter is named by a hash", async () => {
    await EmailChangeConfirmation.assertMayAsk({
      userId: USER_ID,
      newEmail: NEW_EMAIL,
    });

    const names: Array<string> = Object.keys(counters);

    expect(names).toHaveLength(2);
    for (const name of names) {
      expect(name).not.toContain("river");
      expect(name).not.toContain("example.com");
    }
  });

  test("with the cache unreachable the change is refused: nothing would bound it", async () => {
    (
      GlobalCache.incrementIfBelow as unknown as jest.SpyInstance
    ).mockRejectedValue(
      new DatabaseNotConnectedException("Cache is not connected"),
    );

    const refusal: Promise<void> = EmailChangeConfirmation.assertMayAsk({
      userId: USER_ID,
      newEmail: NEW_EMAIL,
    });

    await expect(refusal).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(refusal).rejects.toThrow(EMAIL_CHANGE_UNAVAILABLE_MESSAGE);
  });
});

describe("sendForPendingChange", () => {
  let sendMail: jest.SpyInstance;
  let createToken: jest.SpyInstance;

  beforeEach(() => {
    jest
      .spyOn(DatabaseConfig, "getHost")
      .mockResolvedValue(Hostname.fromString("oneuptime.test"));
    jest
      .spyOn(DatabaseConfig, "getHttpProtocol")
      .mockResolvedValue(Protocol.HTTPS);
    sendMail = jest
      .spyOn(MailService, "sendMail")
      .mockResolvedValue(undefined as never);
    createToken = jest
      .spyOn(EmailVerificationTokenService, "create")
      .mockImplementation((async (args: {
        data: EmailVerificationToken;
      }): Promise<EmailVerificationToken> => {
        return args.data;
      }) as never);
  });

  test("a free address is sent a link that confirms it, minted for this account and address", async () => {
    await EmailChangeConfirmation.sendForPendingChange({
      userId: USER_ID,
      newEmail: NEW_EMAIL,
      isTaken: false,
    });

    expect(createToken).toHaveBeenCalledTimes(1);

    const row: EmailVerificationToken = (
      createToken.mock.calls[0]![0] as { data: EmailVerificationToken }
    ).data;

    expect(row.userId?.toString()).toBe(USER_ID.toString());
    expect(row.email?.toString()).toBe(NEW_EMAIL.toString());
    expect(ObjectID.isValidUUID(row.token!.toString())).toBe(true);

    const hoursLeft: number =
      (row.expires!.getTime() - Date.now()) / (60 * 60 * 1000);

    expect(hoursLeft).toBeGreaterThan(EMAIL_CHANGE_LINK_EXPIRY_IN_HOURS - 0.1);
    expect(hoursLeft).toBeLessThanOrEqual(EMAIL_CHANGE_LINK_EXPIRY_IN_HOURS);

    const mail: {
      toEmail: Email;
      templateType: EmailTemplateType;
      vars: Record<string, string>;
    } = sendMail.mock.calls[0]![0] as {
      toEmail: Email;
      templateType: EmailTemplateType;
      vars: Record<string, string>;
    };

    expect(mail.toEmail.toString()).toBe(NEW_EMAIL.toString());
    expect(mail.templateType).toBe(EmailTemplateType.ConfirmEmailChange);
    expect(mail.vars["tokenVerifyUrl"]).toBe(
      `https://oneuptime.test/accounts/verify-email/${row.token!.toString()}`,
    );
    expect(mail.vars["expiresInHours"]).toBe(
      String(EMAIL_CHANGE_LINK_EXPIRY_IN_HOURS),
    );
  });

  test("each change gets a link of its own", async () => {
    await EmailChangeConfirmation.sendForPendingChange({
      userId: USER_ID,
      newEmail: NEW_EMAIL,
      isTaken: false,
    });
    await EmailChangeConfirmation.sendForPendingChange({
      userId: USER_ID,
      newEmail: NEW_EMAIL,
      isTaken: false,
    });

    const tokens: Array<string> = createToken.mock.calls.map(
      (call: Array<unknown>): string => {
        return (
          call[0] as { data: EmailVerificationToken }
        ).data.token!.toString();
      },
    );

    expect(new Set(tokens).size).toBe(2);
  });

  test("a taken address is told it has an account, with no link and no token", async () => {
    await EmailChangeConfirmation.sendForPendingChange({
      userId: USER_ID,
      newEmail: NEW_EMAIL,
      isTaken: true,
    });

    expect(createToken).not.toHaveBeenCalled();

    const mail: {
      toEmail: Email;
      templateType: EmailTemplateType;
      vars: Record<string, string>;
    } = sendMail.mock.calls[0]![0] as {
      toEmail: Email;
      templateType: EmailTemplateType;
      vars: Record<string, string>;
    };

    expect(mail.toEmail.toString()).toBe(NEW_EMAIL.toString());
    expect(mail.templateType).toBe(EmailTemplateType.EmailChangeAddressTaken);
    expect(mail.vars["signInLink"]).toBe(
      "https://oneuptime.test/accounts/login",
    );
    expect(JSON.stringify(mail.vars)).not.toContain("verify-email");
  });

  test("a failure is logged, never thrown: the person has had their answer", async () => {
    sendMail.mockRejectedValue(new Error("SMTP is down"));

    await expect(
      EmailChangeConfirmation.sendForPendingChange({
        userId: USER_ID,
        newEmail: NEW_EMAIL,
        isTaken: true,
      }),
    ).resolves.toBeUndefined();

    createToken.mockRejectedValue(new Error("database is down"));

    await expect(
      EmailChangeConfirmation.sendForPendingChange({
        userId: USER_ID,
        newEmail: NEW_EMAIL,
        isTaken: false,
      }),
    ).resolves.toBeUndefined();
  });
});
