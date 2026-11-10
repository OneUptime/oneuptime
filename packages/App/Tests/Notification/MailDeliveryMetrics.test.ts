import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import fs from "fs";
import Path from "path";
import Handlebars from "handlebars";
import nodemailer, { Transporter } from "nodemailer";
import Hostname from "Common/Types/API/Hostname";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import MailService from "../../FeatureSet/Notification/Services/MailService";
import SendGridMailProvider from "../../FeatureSet/Notification/Services/MailProviders/SendGridMailProvider";
import "../../FeatureSet/Notification/Utils/Handlebars";

/*
 * HOW EVERY EMAIL WENT, FOR THE PLATFORM'S OPERATOR (issue #6600).
 *
 * Each email is recorded once (notification.send.count and .duration) by
 * the transport that sent it - SMTP, SendGrid and the other mail services -
 * and by whose mail server it was: the installation's own, set in the Admin
 * Dashboard, or one a project or status page configured for itself, whose
 * failures are the project's to fix. MailService runs as it is; the mail
 * transports, the database and the metrics SDK are stood in for.
 */

interface RecordedCall {
  value: number;
  attributes: Record<string, string>;
}

const sendCounterCalls: Array<RecordedCall> = [];
const sendDurationCalls: Array<RecordedCall> = [];

jest.mock("Common/Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationCounter: () => {
        return {
          add: (value: number, attributes: Record<string, string>): void => {
            sendCounterCalls.push({ value, attributes });
          },
        };
      },
      getNotificationDuration: () => {
        return {
          record: (value: number, attributes: Record<string, string>): void => {
            sendDurationCalls.push({ value, attributes });
          },
        };
      },
    },
  };
});

jest.mock("../../FeatureSet/Notification/Config", () => {
  return {
    getEmailServerType: jest.fn(),
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
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/DataSource/EgressGuard", () => {
  return { __esModule: true, default: { assertHostnameAllowed: jest.fn() } };
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

import {
  getEmailServerType,
  getGlobalSMTPConfig,
  getSendgridConfig,
} from "../../FeatureSet/Notification/Config";

type SendMail = (mail: unknown) => Promise<{ messageId: string }>;

const sendMail: ReturnType<typeof jest.fn<SendMail>> = jest.fn<SendMail>();

const TIMELINE_ID: ObjectID = new ObjectID(
  "66009999-0000-4000-8000-000000000001",
);

function smtpServer(host: string): EmailServer {
  return {
    host: new Hostname(host),
    port: new Port(587),
    secure: true,
    username: undefined,
    password: undefined,
    fromName: "Alerts",
    fromEmail: new Email("alerts@example.test"),
  };
}

function message(
  toEmail: Email = new Email("alice@example.test"),
): EmailMessage {
  return {
    toEmail: toEmail,
    subject: "Incident #12: Checkout API is down",
    isSubjectLiteral: true,
    templateType: EmailTemplateType.SimpleMessage,
    vars: { subject: "Incident #12", message: "Checkout API is down" },
    body: "",
  };
}

function onlySend(): Record<string, string> {
  expect(sendCounterCalls).toHaveLength(1);
  expect(sendDurationCalls).toHaveLength(1);
  expect(sendDurationCalls[0]!.attributes).toEqual(
    sendCounterCalls[0]!.attributes,
  );
  return sendCounterCalls[0]!.attributes;
}

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
  sendCounterCalls.length = 0;
  sendDurationCalls.length = 0;

  sendMail.mockResolvedValue({ messageId: "mocked-delivery" });
  jest.mocked(nodemailer.createTransport).mockReturnValue({
    sendMail,
    close: jest.fn(),
  } as unknown as Transporter);

  (getEmailServerType as unknown as jest.Mock).mockResolvedValue(
    "Custom SMTP" as never,
  );
  (getGlobalSMTPConfig as unknown as jest.Mock).mockResolvedValue(
    smtpServer("smtp.installation.example.test") as never,
  );
  (getSendgridConfig as unknown as jest.Mock).mockResolvedValue(null as never);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await MailService.cleanup();
});

describe("an email", () => {
  test("through the installation's own SMTP server: a success through smtp, on the global account", async () => {
    await MailService.send(message(), {
      userOnCallLogTimelineId: TIMELINE_ID,
    });

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(onlySend()).toEqual({
      "notification.channel": "email",
      "notification.provider": "smtp",
      "notification.provider.config": "global",
      "notification.on_call_page": "true",
      outcome: "success",
    });
  });

  test("through a project's own SMTP server: counted as the project's", async () => {
    await MailService.send(message(), {
      emailServer: smtpServer("smtp.project.example.test"),
    });

    expect(onlySend()).toMatchObject({
      "notification.provider": "smtp",
      "notification.provider.config": "project",
      "notification.on_call_page": "false",
      outcome: "success",
    });
  });

  test("refused by the mail server: a failure, and the send still throws", async () => {
    sendMail.mockRejectedValue(new Error("550 Mailbox unavailable"));

    await expect(
      MailService.send(message(), {
        emailServer: smtpServer("smtp.project.example.test"),
      }),
    ).rejects.toThrow("550");

    expect(onlySend()).toMatchObject({
      "notification.provider": "smtp",
      "notification.provider.config": "project",
      outcome: "failure",
    });
  });

  test("through the installation's SendGrid: a success through sendgrid", async () => {
    (getEmailServerType as unknown as jest.Mock).mockResolvedValue(
      "Sendgrid" as never,
    );
    (getSendgridConfig as unknown as jest.Mock).mockResolvedValue({
      apiKey: "SG.key",
      fromEmail: new Email("alerts@example.test"),
      fromName: "Alerts",
    } as never);

    const sendGrid: SpyInstance<typeof SendGridMailProvider.prototype.send> =
      jest
        .spyOn(SendGridMailProvider.prototype, "send")
        .mockResolvedValue(undefined as never);

    await MailService.send(message());

    expect(sendGrid).toHaveBeenCalledTimes(1);
    expect(sendMail).not.toHaveBeenCalled();
    expect(onlySend()).toMatchObject({
      "notification.provider": "sendgrid",
      "notification.provider.config": "global",
      outcome: "success",
    });
  });

  test("SendGrid chosen but not set up: a failure through sendgrid", async () => {
    (getEmailServerType as unknown as jest.Mock).mockResolvedValue(
      "Sendgrid" as never,
    );

    await expect(MailService.send(message())).rejects.toThrow(
      "Sendgrid Config not found",
    );

    expect(onlySend()).toMatchObject({
      "notification.provider": "sendgrid",
      outcome: "failure",
    });
  });

  test("the installation's SMTP server not set up: a failure, handed to no provider", async () => {
    (getGlobalSMTPConfig as unknown as jest.Mock).mockResolvedValue(
      null as never,
    );

    await expect(MailService.send(message())).rejects.toThrow(
      "Global SMTP Config not found",
    );

    expect(onlySend()).toMatchObject({
      "notification.provider": "none",
      outcome: "failure",
    });
  });

  test("to an address that is not one mailbox: a failure, handed to no provider", async () => {
    // A list, as a row stored before addresses were held to one reads back.
    const legacy: Email | null = Email.fromDatabase(
      "alice@example.test,bob@example.test",
    );

    expect(legacy).not.toBeNull();

    await expect(MailService.send(message(legacy!))).rejects.toThrow(
      "not in valid format",
    );

    expect(sendMail).not.toHaveBeenCalled();
    expect(onlySend()).toMatchObject({
      "notification.provider": "none",
      outcome: "failure",
    });
  });
});
