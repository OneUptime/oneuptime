import PrivateUserEmailAddressChangedNotice, {
  PRIVATE_USER_EMAIL_ADDRESS_CHANGED_TIMEOUT_IN_MS,
  PrivateUserEmailAddressChangedEvent,
} from "../../../../Server/Utils/StatusPage/PrivateUserEmailAddressChangedNotice";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import MailService from "../../../../Server/Services/MailService";
import ProjectSMTPConfigService from "../../../../Server/Services/ProjectSmtpConfigService";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import logger from "../../../../Server/Utils/Logger";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import EmptyResponseData from "../../../../Types/API/EmptyResponse";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import Hostname from "../../../../Types/API/Hostname";
import Protocol from "../../../../Types/API/Protocol";
import { maskEmailAddress } from "../../../../Types/Accounts/EmailAddressChangedEmail";
import Email from "../../../../Types/Email";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import ObjectID from "../../../../Types/ObjectID";
import { PrivateUserEmailAddressChangedBy } from "../../../../Types/StatusPage/PrivateUserEmailAddressChangedEmail";
import fs from "fs";
import Path from "path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * TELLING A STATUS PAGE PRIVATE USER'S OLD ADDRESS THAT IT CHANGED (#10156).
 *
 * PrivateUserEmailAddressChangedNotice.send, for StatusPagePrivateUserService:
 * one email to the address the user had, in the status page's branding and
 * default language, through the page's own mail server, saying to which
 * address (masked), when and who; and never in the write's way - it never
 * throws, and logs a failure by the private user's id, never an address.
 */

const PRIVATE_USER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

const OLD_EMAIL: string = "river@old-mailbox.example.com";
const NEW_EMAIL: string = "river@new-mailbox.example.com";
const STATUS_PAGE_URL: string = "https://status.acme.test/";

interface SentMail {
  toEmail: Email;
  subject: string;
  isSubjectLiteral?: boolean;
  templateType: EmailTemplateType;
  vars: Record<string, string>;
  language?: string;
}

interface MailOptions {
  projectId?: ObjectID;
  statusPageId?: ObjectID;
  mailServer?: unknown;
  timeoutInMs?: number;
}

// A column left out is written as undefined, as a read that did not select it leaves it.
type StatusPageColumns = {
  [K in keyof StatusPage]?: StatusPage[K] | undefined;
};

function statusPage(overrides: StatusPageColumns = {}): StatusPage {
  const page: StatusPage = new StatusPage();
  page.id = STATUS_PAGE_ID;
  page._id = STATUS_PAGE_ID.toString();
  page.projectId = PROJECT_ID;
  page.name = "acme-internal";
  page.pageTitle = "Acme Status";
  Object.assign(page, overrides);
  return page;
}

function event(
  overrides: Partial<PrivateUserEmailAddressChangedEvent> = {},
): PrivateUserEmailAddressChangedEvent {
  return {
    privateUserId: PRIVATE_USER_ID,
    statusPageId: STATUS_PAGE_ID,
    previousEmail: new Email(OLD_EMAIL),
    newEmail: new Email(NEW_EMAIL),
    changedBy: PrivateUserEmailAddressChangedBy.StatusPageTeam,
    at: new Date("2026-11-20T09:15:00.000Z"),
    ...overrides,
  };
}

function serverWords(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(
      Path.resolve(
        __dirname,
        "..",
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

let findPage: jest.SpyInstance;
let sendMail: jest.SpyInstance;
let logged: jest.SpyInstance;

function sent(): SentMail {
  expect(sendMail).toHaveBeenCalledTimes(1);
  return sendMail.mock.calls[0]![0] as SentMail;
}

function sentWith(): MailOptions {
  return sendMail.mock.calls[0]![1] as MailOptions;
}

function everythingLogged(): string {
  return JSON.stringify(
    logged.mock.calls.map((call: Array<unknown>): Array<string> => {
      return call.map((value: unknown): string => {
        return value instanceof Error ? value.message : String(value);
      });
    }),
  );
}

beforeEach(() => {
  findPage = jest
    .spyOn(StatusPageService, "findOneById")
    .mockResolvedValue(statusPage() as never);
  jest
    .spyOn(StatusPageService, "getStatusPageURL")
    .mockResolvedValue(STATUS_PAGE_URL as never);
  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(Hostname.fromString("oneuptime.test"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);
  sendMail = jest
    .spyOn(MailService, "sendMail")
    .mockResolvedValue(
      new HTTPResponse<EmptyResponseData>(200, {}, {}) as never,
    );
  logged = jest.spyOn(logger, "error").mockImplementation((() => {}) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the email", () => {
  test("to the address the user had, never the new one, saying so in the page's name", async () => {
    await expect(
      PrivateUserEmailAddressChangedNotice.send(event()),
    ).resolves.toBe(true);

    const mail: SentMail = sent();

    expect(mail.toEmail.toString()).toBe(OLD_EMAIL);
    expect(mail.templateType).toBe(
      EmailTemplateType.StatusPagePrivateUserEmailAddressChanged,
    );
    expect(mail.isSubjectLiteral).toBe(true);
    expect(mail.subject).toBe("Your email address for Acme Status was changed");
    // An English page: no language on the email.
    expect(mail.language).toBeUndefined();
  });

  test("the new address masked, when, who, and the page's own address and name", async () => {
    await PrivateUserEmailAddressChangedNotice.send(event());

    const vars: Record<string, string> = sent().vars;

    expect(vars["newEmailAddress"]).toBe(maskEmailAddress(NEW_EMAIL));
    expect(JSON.stringify(vars)).not.toContain(NEW_EMAIL);
    expect(JSON.stringify(vars)).not.toContain(OLD_EMAIL);
    expect(vars["changedAt"]).toContain("2026");
    expect(vars["changedByStatusPageTeam"]).toBe("true");
    expect(vars["statusPageName"]).toBe("Acme Status");
    expect(vars["homeURL"]).toBe(STATUS_PAGE_URL);
  });

  test("the identity provider's change says so", async () => {
    await PrivateUserEmailAddressChangedNotice.send(
      event({ changedBy: PrivateUserEmailAddressChangedBy.IdentityProvider }),
    );

    expect(sent().vars["changedByIdentityProvider"]).toBe("true");
    expect(sent().vars["changedByStatusPageTeam"]).toBeUndefined();
  });

  test("a page with no title goes by its name", async () => {
    findPage.mockResolvedValue(statusPage({ pageTitle: undefined }) as never);

    await PrivateUserEmailAddressChangedNotice.send(event());

    expect(sent().vars["statusPageName"]).toBe("acme-internal");
    expect(sent().subject).toBe(
      "Your email address for acme-internal was changed",
    );
  });

  test("through the page's own mail server, for its project, in good time", async () => {
    const mailServer: { sentinel: string } = { sentinel: "page smtp" };
    const toEmailServer: jest.SpyInstance = jest
      .spyOn(ProjectSMTPConfigService, "toEmailServer")
      .mockReturnValue(mailServer as never);

    await PrivateUserEmailAddressChangedNotice.send(event());

    expect(toEmailServer).toHaveBeenCalledTimes(1);
    expect(sentWith().mailServer).toBe(mailServer);
    expect(sentWith().projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(sentWith().statusPageId?.toString()).toBe(STATUS_PAGE_ID.toString());
    expect(sentWith().timeoutInMs).toBe(
      PRIVATE_USER_EMAIL_ADDRESS_CHANGED_TIMEOUT_IN_MS,
    );
  });

  test("the page is read as OneUptime, for its logo, name, language and mail server", async () => {
    await PrivateUserEmailAddressChangedNotice.send(event());

    const read: {
      id: ObjectID;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    } = findPage.mock.calls[0]![0] as {
      id: ObjectID;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    };

    expect(read.id.toString()).toBe(STATUS_PAGE_ID.toString());
    expect(read.props["isRoot"]).toBe(true);
    for (const column of [
      "name",
      "pageTitle",
      "defaultLanguage",
      "smtpConfig",
      "logoFileId",
      "projectId",
    ]) {
      expect(read.select[column]).toBeTruthy();
    }
  });
});

describe("in the page's default language", () => {
  test("German: its subject and the email's words", async () => {
    findPage.mockResolvedValue(statusPage({ defaultLanguage: "de" }) as never);

    await PrivateUserEmailAddressChangedNotice.send(event());

    const english: string = "Your email address for {{statusPage}} was changed";
    const german: string | undefined = serverWords("de")[english];

    expect(german).toBeTruthy();
    expect(german).not.toBe(english);
    expect(sent().language).toBe("de");
    expect(sent().subject).toBe(
      german!.replace("{{statusPage}}", "Acme Status"),
    );
  });

  test("Persian and Arabic are named for the email to lay out from the right", async () => {
    for (const language of ["fa", "ar"]) {
      sendMail.mockClear();
      findPage.mockResolvedValue(
        statusPage({ defaultLanguage: language }) as never,
      );

      await PrivateUserEmailAddressChangedNotice.send(event());

      expect(sent().language).toBe(language);
      expect(sent().subject).not.toContain("was changed");
      expect(sent().subject).toContain("Acme Status");
    }
  });

  test("a language OneUptime does not write in is English", async () => {
    findPage.mockResolvedValue(
      statusPage({ defaultLanguage: "xx-YY" }) as never,
    );

    await PrivateUserEmailAddressChangedNotice.send(event());

    expect(sent().language).toBeUndefined();
    expect(sent().subject).toBe(
      "Your email address for Acme Status was changed",
    );
  });
});

describe("never in the write's way", () => {
  test("no status page: nothing is sent", async () => {
    findPage.mockResolvedValue(null as never);

    await expect(
      PrivateUserEmailAddressChangedNotice.send(event()),
    ).resolves.toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("no address to tell: nothing is read or sent", async () => {
    await expect(
      PrivateUserEmailAddressChangedNotice.send(
        event({ previousEmail: undefined as unknown as Email }),
      ),
    ).resolves.toBe(false);
    expect(findPage).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("a mail service that refuses it: false, logged by the user's id, never an address", async () => {
    sendMail.mockResolvedValue(
      new HTTPErrorResponse(500, { message: "refused" }, {}) as never,
    );

    await expect(
      PrivateUserEmailAddressChangedNotice.send(event()),
    ).resolves.toBe(false);
    expect(everythingLogged()).toContain(PRIVATE_USER_ID.toString());
    expect(everythingLogged()).not.toContain(OLD_EMAIL);
    expect(everythingLogged()).not.toContain(NEW_EMAIL);
  });

  test("a failure anywhere: false, never thrown, never an address in the log", async () => {
    sendMail.mockRejectedValue(new Error("SMTP is down"));

    await expect(
      PrivateUserEmailAddressChangedNotice.send(event()),
    ).resolves.toBe(false);

    findPage.mockRejectedValue(new Error("database is down"));

    await expect(
      PrivateUserEmailAddressChangedNotice.send(event()),
    ).resolves.toBe(false);
    expect(everythingLogged()).toContain(PRIVATE_USER_ID.toString());
    expect(everythingLogged()).not.toContain(OLD_EMAIL);
    expect(everythingLogged()).not.toContain(NEW_EMAIL);
  });
});
