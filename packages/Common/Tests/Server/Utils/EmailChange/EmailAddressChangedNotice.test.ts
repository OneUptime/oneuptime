import EmailAddressChangedNotice, {
  EMAIL_ADDRESS_CHANGED_TIMEOUT_IN_MS,
  EmailAddressChangedEvent,
} from "../../../../Server/Utils/EmailChange/EmailAddressChangedNotice";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import MailService from "../../../../Server/Services/MailService";
import logger from "../../../../Server/Utils/Logger";
import { EmailAddressChangedBy } from "../../../../Types/Accounts/EmailAddressChangedEmail";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import Hostname from "../../../../Types/API/Hostname";
import Protocol from "../../../../Types/API/Protocol";
import Email from "../../../../Types/Email";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import ObjectID from "../../../../Types/ObjectID";
import Timezone from "../../../../Types/Timezone";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * TELLING AN ACCOUNT'S OLD ADDRESS THAT THE ACCOUNT MOVED (#9907):
 * EmailAddressChangedNotice, the sender UserService calls once per account
 * whose address a write changed. It is sent to the address the account had,
 * never the new one; in the language on the account, its time in the
 * account's zone; with the new address masked; from where only for the
 * account's own change; and it never throws, logging a failure by the
 * account's id and never by an address. What each way an address changes
 * hands it is pinned in Server/Services/UserServiceEmailAddressChangedNotice.
 */

const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OLD_EMAIL: string = "river@old-mailbox.example.com";
const NEW_EMAIL: string = "river@new-mailbox.example.com";
const CHANGED_AT: Date = new Date("2026-11-20T09:15:00.000Z");

const ORIGIN: EmailAddressChangedEvent["origin"] = {
  ipAddress: "203.0.113.7",
  location: "Berlin, Germany",
  device: "Firefox on Linux",
};

interface SentMail {
  toEmail: Email;
  subject: string;
  isSubjectLiteral: boolean;
  templateType: EmailTemplateType;
  vars: Record<string, string>;
  language?: string;
}

let sendMail: jest.SpyInstance;
let logError: jest.SpyInstance;

const event: (
  overrides?: Partial<EmailAddressChangedEvent>,
) => EmailAddressChangedEvent = (
  overrides?: Partial<EmailAddressChangedEvent>,
): EmailAddressChangedEvent => {
  return {
    userId: USER_ID,
    previousEmail: new Email(OLD_EMAIL),
    newEmail: new Email(NEW_EMAIL),
    changedBy: EmailAddressChangedBy.AccountOwner,
    origin: ORIGIN,
    at: CHANGED_AT,
    language: null,
    timezone: null,
    ...overrides,
  };
};

const sent: () => SentMail = (): SentMail => {
  expect(sendMail).toHaveBeenCalledTimes(1);
  return sendMail.mock.calls[0]![0] as SentMail;
};

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
  logError = jest.spyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who is told", () => {
  test("the address the account had, once, and never the new one", async () => {
    await expect(EmailAddressChangedNotice.send(event())).resolves.toBe(true);

    const mail: SentMail = sent();

    expect(mail.toEmail.toString()).toBe(OLD_EMAIL);
    expect(mail.templateType).toBe(EmailTemplateType.EmailAddressChanged);
    expect(mail.isSubjectLiteral).toBe(true);
    expect(mail.subject).toBe("Your OneUptime email address was changed");
  });

  test("the account's id goes with it, for the email log, and the hand-off is bounded", async () => {
    await EmailAddressChangedNotice.send(event());

    const options: { userId: ObjectID; timeoutInMs: number } = sendMail.mock
      .calls[0]![1] as { userId: ObjectID; timeoutInMs: number };

    expect(options.userId.toString()).toBe(USER_ID.toString());
    expect(options.timeoutInMs).toBe(EMAIL_ADDRESS_CHANGED_TIMEOUT_IN_MS);
  });

  test("nothing is sent without an address to send it to", async () => {
    await expect(
      EmailAddressChangedNotice.send(
        event({ previousEmail: undefined as unknown as Email }),
      ),
    ).resolves.toBe(false);
    await expect(
      EmailAddressChangedNotice.send(
        event({ newEmail: undefined as unknown as Email }),
      ),
    ).resolves.toBe(false);

    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("what it says", () => {
  test("the new address masked, never whole, anywhere in what is sent", async () => {
    await EmailAddressChangedNotice.send(event());

    const mail: SentMail = sent();

    expect(mail.vars["newEmailAddress"]).toBe("r•••@n•••.com");
    expect(JSON.stringify(mail)).not.toContain("new-mailbox");
  });

  test("the account's own change: when, and from where", async () => {
    await EmailAddressChangedNotice.send(event());

    const vars: Record<string, string> = sent().vars;

    expect(vars["changedByAccountOwner"]).toBe("true");
    expect(vars["changedAt"]).toContain("2026");
    expect(vars["changedAt"]).toContain("UTC");
    expect(vars["requestIpAddress"]).toBe("203.0.113.7");
    expect(vars["requestLocation"]).toBe("Berlin, Germany");
    expect(vars["requestDevice"]).toBe("Firefox on Linux");
    expect(vars["homeURL"]).toBe("https://oneuptime.test/");
    expect(vars["productName"]).toBe("OneUptime");
  });

  test("a server admin's change says when alone, whatever request made it", async () => {
    await EmailAddressChangedNotice.send(
      event({ changedBy: EmailAddressChangedBy.ServerAdmin }),
    );

    const vars: Record<string, string> = sent().vars;

    expect(vars["changedByServerAdmin"]).toBe("true");
    expect(vars["requestIpAddress"]).toBe("");
    expect(vars["requestLocation"]).toBe("");
    expect(vars["requestDevice"]).toBe("");
    expect(JSON.stringify(vars)).not.toContain("203.0.113.7");
  });

  test("an identity provider's change says when alone", async () => {
    await EmailAddressChangedNotice.send(
      event({
        changedBy: EmailAddressChangedBy.IdentityProvider,
        origin: undefined,
      }),
    );

    const vars: Record<string, string> = sent().vars;

    expect(vars["changedByIdentityProvider"]).toBe("true");
    expect(vars["changedAt"]).toBeTruthy();
    expect(vars["requestDevice"]).toBe("");
  });

  test("a change no request made has no request rows", async () => {
    await EmailAddressChangedNotice.send(event({ origin: undefined }));

    const vars: Record<string, string> = sent().vars;

    expect(vars["requestIpAddress"]).toBe("");
    expect(vars["requestDevice"]).toBe("");
  });

  test("a device the request did not name is said in the reader's words", async () => {
    await EmailAddressChangedNotice.send(
      event({ origin: { ipAddress: "203.0.113.7" }, language: "de" }),
    );

    expect(sent().vars["requestDevice"]).toBe("Unbekanntes Gerät");
  });

  test("the time is in the account's own time zone", async () => {
    await EmailAddressChangedNotice.send(
      event({ timezone: Timezone.AsiaKolkata }),
    );

    const changedAt: string = sent().vars["changedAt"]!;

    expect(changedAt).not.toContain("UTC");
    // 09:15 UTC is 2:45 PM in Kolkata.
    expect(changedAt).toContain("2:45");
  });

  test("no link, token or password goes with it", async () => {
    await EmailAddressChangedNotice.send(event());

    const vars: Record<string, string> = sent().vars;
    const urls: Array<string> = Object.values(vars).filter(
      (value: string): boolean => {
        return value.startsWith("http://") || value.startsWith("https://");
      },
    );

    // The logo's link home, and nothing that does anything.
    expect(urls).toEqual(["https://oneuptime.test/"]);
    expect(
      Object.keys(vars)
        .filter((name: string): boolean => {
          return name !== "homeURL";
        })
        .join(" "),
    ).not.toMatch(/token|password|url|link/i);
  });
});

describe("in the account's language", () => {
  test("English for an account with none, with no language on the email", async () => {
    await EmailAddressChangedNotice.send(event({ language: null }));

    expect(sent().language).toBeUndefined();
  });

  test("the account's own: its subject, and the email's words", async () => {
    await EmailAddressChangedNotice.send(event({ language: "de" }));

    const mail: SentMail = sent();

    expect(mail.language).toBe("de");
    expect(mail.subject).toBe("Ihre OneUptime-E-Mail-Adresse wurde geändert");
  });

  test("a language read from the right is still named for the email to lay out", async () => {
    await EmailAddressChangedNotice.send(event({ language: "fa" }));

    const mail: SentMail = sent();

    expect(mail.language).toBe("fa");
    expect(mail.subject).not.toContain("was changed");
    expect(mail.subject).toContain("OneUptime");
  });

  test("a language OneUptime does not write in is English", async () => {
    await EmailAddressChangedNotice.send(event({ language: "xx-YY" }));

    const mail: SentMail = sent();

    expect(mail.language).toBeUndefined();
    expect(mail.subject).toBe("Your OneUptime email address was changed");
  });
});

describe("never in the write's way", () => {
  test("a mail service that throws is logged by the account's id, and never by an address", async () => {
    sendMail.mockRejectedValue(new Error(`could not deliver to ${OLD_EMAIL}`));

    await expect(EmailAddressChangedNotice.send(event())).resolves.toBe(false);

    const firstLine: string = String(logError.mock.calls[0]![0]);

    expect(firstLine).toContain(USER_ID.toString());
    expect(firstLine).not.toContain(OLD_EMAIL);
    expect(firstLine).not.toContain(NEW_EMAIL);
  });

  test("a mail service that refuses it is logged, with its status", async () => {
    sendMail.mockResolvedValue(
      new HTTPErrorResponse(503, { error: "busy" }, {}) as never,
    );

    await expect(EmailAddressChangedNotice.send(event())).resolves.toBe(false);

    const line: string = String(logError.mock.calls[0]![0]);

    expect(line).toContain(USER_ID.toString());
    expect(line).toContain("503");
    expect(line).not.toContain(OLD_EMAIL);
  });

  test("a host that cannot be read is no throw either", async () => {
    (DatabaseConfig.getHost as unknown as jest.SpyInstance).mockRejectedValue(
      new Error("settings unreadable"),
    );

    await expect(EmailAddressChangedNotice.send(event())).resolves.toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("an event that is not one is no throw", async () => {
    await expect(
      EmailAddressChangedNotice.send(
        undefined as unknown as EmailAddressChangedEvent,
      ),
    ).resolves.toBe(false);
  });
});
