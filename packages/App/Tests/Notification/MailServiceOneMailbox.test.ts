import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import Path from "path";
import Handlebars from "handlebars";
import nodemailer, { Transporter } from "nodemailer";
import Hostname from "Common/Types/API/Hostname";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import BadDataException from "Common/Types/Exception/BadDataException";
import Port from "Common/Types/Port";
import MailService from "../../FeatureSet/Notification/Services/MailService";
import "../../FeatureSet/Notification/Utils/Handlebars";

/*
 * ONE EMAIL GOES TO ONE MAILBOX.
 *
 * Every address written now is one mailbox (Email.isValid), but a row
 * stored before that can still hold a list, or a name with an address;
 * Email reads such a value back so the row still renders, and marks it.
 * MailService.send is where every email of the instance leaves - the
 * /send route, the broadcast to every user, a test email - so it refuses
 * such an address there, before any transport could deliver to each
 * address in it, and sends an ordinary one exactly as before. Only
 * infrastructure and the transport are mocked, as in
 * MailServiceProductBranding.test.ts.
 */
jest.mock("../../FeatureSet/Notification/Config", () => {
  return {
    getEmailServerType: jest
      .fn<() => Promise<string>>()
      .mockResolvedValue("Custom SMTP"),
    getGlobalSMTPConfig: jest.fn(),
    getSendgridConfig: jest.fn(),
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  return { IsDevelopment: false };
});

jest.mock("Common/Server/Services/EmailLogService", () => {
  return { __esModule: true, default: { create: jest.fn() } };
});

jest.mock("Common/Server/Services/UserOnCallLogTimelineService", () => {
  return { __esModule: true, default: { updateOneById: jest.fn() } };
});

jest.mock("Common/Models/DatabaseModels/EmailLog", () => {
  return { __esModule: true, default: jest.fn() };
});

jest.mock("Common/Models/DatabaseModels/GlobalConfig", () => {
  return {
    EmailServerType: { Sendgrid: "Sendgrid", CustomSMTP: "Custom SMTP" },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/DataSource/EgressGuard", () => {
  return { __esModule: true, default: { assertHostnameAllowed: jest.fn() } };
});

jest.mock("Common/Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationCounter: () => {
        return { add: jest.fn() };
      },
      getNotificationDuration: () => {
        return { record: jest.fn() };
      },
    },
  };
});

jest.mock("nodemailer", () => {
  return { __esModule: true, default: { createTransport: jest.fn() } };
});

jest.mock("@sendgrid/mail", () => {
  return {
    __esModule: true,
    default: { setApiKey: jest.fn(), send: jest.fn() },
  };
});

jest.mock(
  "../../FeatureSet/Notification/Services/MailProviders/MicrosoftGraphMailProvider",
  () => {
    return { __esModule: true, default: jest.fn() };
  },
);

jest.mock("../../FeatureSet/Notification/Services/SMTPOAuthService", () => {
  return { __esModule: true, default: { getAccessToken: jest.fn() } };
});

interface CapturedMail {
  to: string;
}

type SendMail = (mail: CapturedMail) => Promise<{ messageId: string }>;

const sendMail: ReturnType<typeof jest.fn<SendMail>> = jest.fn<SendMail>();

const SMTP_SERVER: EmailServer = {
  host: new Hostname("smtp.example.test"),
  port: new Port(587),
  secure: true,
  username: undefined,
  password: undefined,
  fromName: "Alerts",
  fromEmail: new Email("alerts@example.test"),
};

const messageTo: (toEmail: Email) => EmailMessage = (
  toEmail: Email,
): EmailMessage => {
  return {
    toEmail,
    subject: "Hello",
    isSubjectLiteral: true,
    templateType: EmailTemplateType.SimpleMessage,
    vars: { subject: "Hello", message: "Hi" },
    body: "",
  };
};

beforeAll(async () => {
  const partialsDir: string = Path.resolve(
    __dirname,
    "../../FeatureSet/Notification/Templates/Partials",
  );
  const partialNames: Array<string> = fs
    .readdirSync(partialsDir)
    .filter((name: string): boolean => {
      return name.endsWith(".hbs");
    })
    .map((name: string): string => {
      return name.slice(0, -4);
    });
  const deadline: number = Date.now() + 15000;

  // The production util registers its partials asynchronously; wait for them.
  while (
    partialNames.some((name: string): boolean => {
      return typeof Handlebars.partials[name] !== "function";
    })
  ) {
    if (Date.now() >= deadline) {
      throw new Error("Production email partial registration did not finish");
    }

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 10);
    });
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  sendMail.mockResolvedValue({ messageId: "mocked-delivery" });
  jest.mocked(nodemailer.createTransport).mockReturnValue({
    sendMail,
    close: jest.fn(),
  } as unknown as Transporter);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await MailService.cleanup();
});

describe("MailService.send delivers to one mailbox", () => {
  test("an ordinary address is sent to, as it always was", async () => {
    await MailService.send(messageTo(new Email("alice@example.test")), {
      emailServer: SMTP_SERVER,
    });

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]![0].to).toBe("alice@example.test");
  });

  test.each([
    ["a list", "alice@example.test,bob@example.test"],
    ["a list split by semicolons", "alice@example.test;bob@example.test"],
    ["a name with an address", "Alice <alice@example.test>"],
    ["a group", "team: alice@example.test, bob@example.test;"],
    ["an address with text after it", "alice@example.test bob@example.test"],
  ])(
    "a stored value that is %s is refused, never handed to a transport",
    async (_label: string, stored: string) => {
      const legacy: Email | null = Email.fromDatabase(stored);

      expect(legacy).not.toBeNull();
      expect(legacy!.isMalformed()).toBe(true);

      await expect(
        MailService.send(messageTo(legacy!), { emailServer: SMTP_SERVER }),
      ).rejects.toBeInstanceOf(BadDataException);

      expect(nodemailer.createTransport).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
    },
  );
});
