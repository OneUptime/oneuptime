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
import Timezone from "../../../Types/Timezone";
import { EmailAddressChangedBy } from "../../../Types/Accounts/EmailAddressChangedEmail";
import logger from "../../../Server/Utils/Logger";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import fs from "fs";
import Path from "path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

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
 *   - each in its reader's language and time zone (#10157): the link in the
 *     asking account's, word that the address is taken in the account's
 *     that has it; their subjects too.
 *   - sendVerificationOfNewAddress: the link to an address written straight
 *     away (EmailChanged), saying who made the change and when, in the
 *     account's language (#10157).
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
  counters = {};
  countLikeRedis();
  jest
    .spyOn(ServerSendingStatus, "canSendEmailPublicly")
    .mockResolvedValue(true);
});

afterEach(() => {
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

  test("the link ends when the account says its change does (#9908)", async () => {
    const linkExpires: Date = new Date(Date.now() + 23 * 60 * 60 * 1000);

    await EmailChangeConfirmation.sendForPendingChange({
      userId: USER_ID,
      newEmail: NEW_EMAIL,
      isTaken: false,
      linkExpires: linkExpires,
    });

    const row: EmailVerificationToken = (
      createToken.mock.calls[0]![0] as { data: EmailVerificationToken }
    ).data;

    expect(row.expires!.getTime()).toBe(linkExpires.getTime());
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

/*
 * The server's own words for a subject, from the locale files it ships:
 * what the server writes in that language, and never the English. A subject
 * read from the right holds the product's Latin name in isolate marks, so
 * the comparison reads it without them (withoutIsolateMarks).
 */
function serverWords(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(
      Path.resolve(
        __dirname,
        "..",
        "..",
        "..",
        "Server",
        "Locales",
        `${language}.json`,
      ),
      { encoding: "utf8" },
    ),
  ) as Record<string, string>;
}

function translatedSubject(language: string, english: string): string {
  const words: string | undefined = serverWords(language)[english];

  expect(words).toBeTruthy();
  expect(words).not.toBe(english);

  return words!.replace("{{product}}", "OneUptime");
}

interface SentMail {
  toEmail: Email;
  subject: string;
  templateType: EmailTemplateType;
  vars: Record<string, string>;
  language?: string;
}

const AT: Date = new Date("2026-11-20T09:15:00.000Z");

const ORIGIN: {
  ipAddress: string;
  location: string;
  device: string;
} = {
  ipAddress: "203.0.113.7",
  location: "Berlin, Germany",
  device: "Firefox on Linux",
};

describe("each email in its reader's language and time zone (#10157)", () => {
  let sendMail: jest.SpyInstance;

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
    jest
      .spyOn(EmailVerificationTokenService, "create")
      .mockImplementation((async (args: {
        data: EmailVerificationToken;
      }): Promise<EmailVerificationToken> => {
        return args.data;
      }) as never);
  });

  function sent(): SentMail {
    expect(sendMail).toHaveBeenCalledTimes(1);
    return sendMail.mock.calls[0]![0] as SentMail;
  }

  test("an account with no language: English, as before, with no language on the email", async () => {
    await EmailChangeConfirmation.sendForPendingChange({
      userId: USER_ID,
      newEmail: NEW_EMAIL,
      isTaken: false,
      language: null,
    });

    expect(sent().language).toBeUndefined();
    expect(sent().subject).toBe("Confirm your new OneUptime email address");
  });

  test("the link: in the asking account's language, its subject too, the request's rows as they are", async () => {
    await EmailChangeConfirmation.sendForPendingChange({
      userId: USER_ID,
      newEmail: NEW_EMAIL,
      isTaken: false,
      origin: ORIGIN,
      language: "de",
      timezone: Timezone.EuropeBerlin,
      holder: { language: "ja", timezone: Timezone.AsiaTokyo },
    });

    const mail: SentMail = sent();

    expect(mail.templateType).toBe(EmailTemplateType.ConfirmEmailChange);
    expect(mail.language).toBe("de");
    expect(withoutIsolateMarks(mail.subject)).toBe(
      translatedSubject("de", "Confirm your new {{product}} email address"),
    );
    expect(mail.vars["requestIpAddress"]).toBe("203.0.113.7");
    expect(mail.vars["requestDevice"]).toBe("Firefox on Linux");
  });

  test("word that the address is taken: in the language of the account that has it, not the asker's", async () => {
    await EmailChangeConfirmation.sendForPendingChange({
      userId: USER_ID,
      newEmail: NEW_EMAIL,
      isTaken: true,
      origin: ORIGIN,
      language: "de",
      timezone: Timezone.EuropeBerlin,
      holder: { language: "fa", timezone: Timezone.AsiaTehran },
    });

    const mail: SentMail = sent();

    expect(mail.templateType).toBe(EmailTemplateType.EmailChangeAddressTaken);
    expect(mail.language).toBe("fa");
    expect(withoutIsolateMarks(mail.subject)).toBe(
      translatedSubject("fa", "This address already has a {{product}} account"),
    );
  });

  test("a holder with no language is English, whatever the asker's", async () => {
    await EmailChangeConfirmation.sendForPendingChange({
      userId: USER_ID,
      newEmail: NEW_EMAIL,
      isTaken: true,
      language: "de",
      holder: { language: null },
    });

    expect(sent().language).toBeUndefined();
    expect(sent().subject).toBe("This address already has a OneUptime account");
  });

  test("an unnamed device is named in the reader's words", async () => {
    await EmailChangeConfirmation.sendForPendingChange({
      userId: USER_ID,
      newEmail: NEW_EMAIL,
      isTaken: false,
      origin: { ipAddress: "203.0.113.7" },
      language: "de",
    });

    expect(sent().vars["requestDevice"]).toBe(
      serverWords("de")["Unknown device"],
    );
  });

  test("Arabic: named for the email to lay out from the right", async () => {
    await EmailChangeConfirmation.sendForPendingChange({
      userId: USER_ID,
      newEmail: NEW_EMAIL,
      isTaken: false,
      language: "ar",
    });

    expect(sent().language).toBe("ar");
    expect(withoutIsolateMarks(sent().subject)).toBe(
      translatedSubject("ar", "Confirm your new {{product}} email address"),
    );
  });

  test("a language OneUptime does not write in is English", async () => {
    await EmailChangeConfirmation.sendForPendingChange({
      userId: USER_ID,
      newEmail: NEW_EMAIL,
      isTaken: false,
      language: "xx-YY",
    });

    expect(sent().language).toBeUndefined();
    expect(sent().subject).toBe("Confirm your new OneUptime email address");
  });
});

describe("the request's time, in the reader's time zone (#10157)", () => {
  let sendMail: jest.SpyInstance;

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
    jest
      .spyOn(EmailVerificationTokenService, "create")
      .mockImplementation((async (args: {
        data: EmailVerificationToken;
      }): Promise<EmailVerificationToken> => {
        return args.data;
      }) as never);
  });

  async function requestedAtFor(data: {
    isTaken: boolean;
    timezone: Timezone;
    holderTimezone: Timezone;
  }): Promise<string> {
    sendMail.mockClear();

    await EmailChangeConfirmation.sendForPendingChange({
      userId: USER_ID,
      newEmail: NEW_EMAIL,
      isTaken: data.isTaken,
      origin: ORIGIN,
      timezone: data.timezone,
      holder: { timezone: data.holderTimezone },
    });

    return (sendMail.mock.calls[0]![0] as SentMail).vars["requestedAt"]!;
  }

  test("the link: the asking account's zone; word that it is taken: the holder's", async () => {
    const berlin: string = await requestedAtFor({
      isTaken: false,
      timezone: Timezone.EuropeBerlin,
      holderTimezone: Timezone.AsiaTokyo,
    });
    const tokyoForTheLink: string = await requestedAtFor({
      isTaken: false,
      timezone: Timezone.AsiaTokyo,
      holderTimezone: Timezone.EuropeBerlin,
    });
    const tokyoForTheHolder: string = await requestedAtFor({
      isTaken: true,
      timezone: Timezone.EuropeBerlin,
      holderTimezone: Timezone.AsiaTokyo,
    });

    // The same moment, written in the zone of whoever reads it.
    expect(berlin).not.toBe(tokyoForTheLink);
    expect(tokyoForTheHolder).toBe(tokyoForTheLink);
  });
});

describe("sendVerificationOfNewAddress", () => {
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

  function sent(): SentMail {
    expect(sendMail).toHaveBeenCalledTimes(1);
    return sendMail.mock.calls[0]![0] as SentMail;
  }

  function changersSaid(): Array<string> {
    return Object.keys(sent().vars).filter((name: string): boolean => {
      return name.startsWith("changedBy");
    });
  }

  test("a link minted for this account and address, for a day, to the new address", async () => {
    const before: number = Date.now();

    await EmailChangeConfirmation.sendVerificationOfNewAddress({
      userId: USER_ID,
      newEmail: NEW_EMAIL,
      changedBy: EmailAddressChangedBy.ServerAdmin,
      at: AT,
    });

    const row: EmailVerificationToken = (
      createToken.mock.calls[0]![0] as { data: EmailVerificationToken }
    ).data;

    expect(row.userId?.toString()).toBe(USER_ID.toString());
    expect(row.email?.toString()).toBe(NEW_EMAIL.toString());
    expect(ObjectID.isValidUUID(row.token!.toString())).toBe(true);

    const hoursLeft: number =
      (row.expires!.getTime() - before) / (60 * 60 * 1000);

    expect(hoursLeft).toBeGreaterThan(23.9);
    expect(hoursLeft).toBeLessThanOrEqual(24.1);

    const mail: SentMail = sent();

    expect(mail.toEmail.toString()).toBe(NEW_EMAIL.toString());
    expect(mail.templateType).toBe(EmailTemplateType.EmailChanged);
    expect(mail.vars["tokenVerifyUrl"]).toBe(
      `https://oneuptime.test/accounts/verify-email/${row.token!.toString()}`,
    );
    expect(mail.subject).toBe(
      "Verify the new email address of your OneUptime account",
    );
    expect(mail.language).toBeUndefined();
    expect(mail.vars["changedAt"]).toBeTruthy();
  });

  test.each([
    [EmailAddressChangedBy.ServerAdmin, "changedByServerAdmin"],
    [EmailAddressChangedBy.IdentityProvider, "changedByIdentityProvider"],
    [EmailAddressChangedBy.AccountOwner, "changedByAccountOwner"],
    // Nobody named: the email says only that this is the address now.
    [EmailAddressChangedBy.OneUptime, "changedByOneUptime"],
  ])(
    "says who made the change - %s - and only that one",
    async (changedBy: EmailAddressChangedBy, flag: string) => {
      await EmailChangeConfirmation.sendVerificationOfNewAddress({
        userId: USER_ID,
        newEmail: NEW_EMAIL,
        changedBy: changedBy,
      });

      expect(changersSaid()).toEqual([flag]);
    },
  );

  test("in the account's language, its subject too, and its time in its zone", async () => {
    await EmailChangeConfirmation.sendVerificationOfNewAddress({
      userId: USER_ID,
      newEmail: NEW_EMAIL,
      changedBy: EmailAddressChangedBy.IdentityProvider,
      at: AT,
      language: "fa",
      timezone: Timezone.EuropeBerlin,
    });

    const persian: SentMail = sent();

    expect(persian.language).toBe("fa");
    expect(withoutIsolateMarks(persian.subject)).toBe(
      translatedSubject(
        "fa",
        "Verify the new email address of your {{product}} account",
      ),
    );

    sendMail.mockClear();

    await EmailChangeConfirmation.sendVerificationOfNewAddress({
      userId: USER_ID,
      newEmail: NEW_EMAIL,
      changedBy: EmailAddressChangedBy.IdentityProvider,
      at: AT,
      timezone: Timezone.AsiaTokyo,
    });

    // The same moment, in another zone, reads differently.
    expect(sent().vars["changedAt"]).not.toBe(persian.vars["changedAt"]);
  });

  test("a link that cannot be made throws, so the address is not marked waiting for one", async () => {
    createToken.mockRejectedValue(new Error("database is down"));

    await expect(
      EmailChangeConfirmation.sendVerificationOfNewAddress({
        userId: USER_ID,
        newEmail: NEW_EMAIL,
        changedBy: EmailAddressChangedBy.ServerAdmin,
      }),
    ).rejects.toThrow("database is down");
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("the email is not waited for, and a failure to send it is logged by the account, never thrown", async () => {
    const logged: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((() => {}) as never);
    sendMail.mockRejectedValue(new Error("SMTP is down"));

    await expect(
      EmailChangeConfirmation.sendVerificationOfNewAddress({
        userId: USER_ID,
        newEmail: NEW_EMAIL,
        changedBy: EmailAddressChangedBy.ServerAdmin,
      }),
    ).resolves.toBeUndefined();

    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });

    expect(logged).toHaveBeenCalledWith(expect.any(Error), {
      userId: USER_ID.toString(),
    });
  });
});
