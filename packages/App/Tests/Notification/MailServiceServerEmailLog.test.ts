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
import MailStatus from "Common/Types/Mail/MailStatus";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import { SERVER_EMAIL_NOT_SET_UP_MESSAGE } from "Common/Types/ServerSending/ServerSendingWords";
import ServerEmailLogRecorder, {
  ServerEmailLogFacts,
} from "Common/Server/Utils/ServerSending/ServerEmailLogRecorder";
import ServerEmailLogWriter from "Common/Server/Utils/ServerSending/ServerEmailLogWriter";
import ServerEmailLogService from "Common/Server/Services/ServerEmailLogService";
import logger from "Common/Server/Utils/Logger";
import MailService from "../../FeatureSet/Notification/Services/MailService";
import "../../FeatureSet/Notification/Utils/Handlebars";

/*
 * THE SERVER'S EMAIL LOG, AS MAILSERVICE KEEPS IT (#6878).
 *
 *   - every email through the server's own settings that belongs to no
 *     project leaves a row, sent or not: a password reset that went, one the
 *     mail server refused with its answer, one that never went because
 *     email is not set up;
 *   - a project's email through those settings leaves one only when it
 *     failed - one that went is in the project's Email Logs;
 *   - an email through a project's own mail server never leaves one;
 *   - a row never holds the message, or the reset link and its token: what
 *     a row stores is checked as the database would get it;
 *   - a row that cannot be written never stops the email, and the line that
 *     says so never names whom it was for.
 *
 * MailService runs as it is, with the real writer; the mail transport, the
 * database and the server's settings are stood in for.
 */

jest.mock("../../FeatureSet/Notification/Config", () => {
  return {
    getEmailServerType: jest.fn(),
    getGlobalSMTPConfig: jest.fn(),
    getSendgridConfig: jest.fn(),
    getGlobalEmailProviderServer: jest.fn(),
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  return { IsDevelopment: false, IsBillingEnabled: false };
});

jest.mock("Common/Server/Services/EmailLogService", () => {
  return { __esModule: true, default: { create: jest.fn() } };
});

jest.mock("Common/Server/Services/ServerEmailLogService", () => {
  return { __esModule: true, default: { create: jest.fn() } };
});

jest.mock("Common/Server/Services/UserOnCallLogTimelineService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), updateOneBy: jest.fn() },
  };
});

jest.mock("Common/Models/DatabaseModels/EmailLog", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => {
      return {};
    }),
  };
});

jest.mock("Common/Models/DatabaseModels/GlobalConfig", () => {
  return {
    EmailServerType: {
      Sendgrid: "Sendgrid",
      CustomSMTP: "Custom SMTP",
      AmazonSES: "Amazon SES",
      Mailgun: "Mailgun",
      Postmark: "Postmark",
      Resend: "Resend",
    },
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

const PROJECT_ID: ObjectID = new ObjectID(
  "68780000-0000-4000-8000-000000000001",
);

// The reset token: a password until it is spent.
const RESET_TOKEN: string = "6f1c2a7e-93b4-4d2f-8a51-0c7e9d3b2f64";
const RESET_URL: string = `https://oneuptime.example.test/accounts/reset-password/${RESET_TOKEN}`;
const RECIPIENT: string = "alice@example.test";

function smtpServer(host: string): EmailServer {
  return {
    host: new Hostname(host),
    port: new Port(587),
    secure: true,
    username: undefined,
    password: undefined,
    fromName: "OneUptime",
    fromEmail: new Email("noreply@example.test"),
  };
}

// The password reset email, as Identity's Forgot Password sends it.
function passwordReset(): EmailMessage {
  return {
    toEmail: new Email(RECIPIENT),
    subject: "Password Reset Request for OneUptime",
    isSubjectLiteral: true,
    templateType: EmailTemplateType.ForgotPassword,
    vars: {
      homeURL: "https://oneuptime.example.test",
      tokenVerifyUrl: RESET_URL,
    },
    body: "",
  };
}

// A project's email: an incident, sent for a project.
function incidentEmail(): EmailMessage {
  return {
    toEmail: new Email(RECIPIENT),
    subject: "Incident #12: Checkout API is down",
    isSubjectLiteral: true,
    templateType: EmailTemplateType.SimpleMessage,
    vars: { subject: "Incident #12", message: "Checkout API is down" },
    body: "",
  };
}

// What MailService told the log of each email.
const told: Array<ServerEmailLogFacts> = [];

// The rows written, as the database would get them.
function rowsWritten(): Array<Record<string, unknown>> {
  return (
    jest.mocked(ServerEmailLogService.create).mock.calls as Array<
      Array<unknown>
    >
  ).map((call: Array<unknown>): Record<string, unknown> => {
    const data: Record<string, unknown> = (
      call[0] as { data: Record<string, unknown> }
    ).data;

    return {
      toEmail: data["toEmail"]?.toString(),
      subject: data["subject"],
      templateType: data["templateType"],
      status: data["status"],
      statusMessage: data["statusMessage"],
      projectId: data["projectId"]?.toString(),
    };
  });
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
  told.length = 0;

  // The real writer, as the Notification service registers it - watched.
  ServerEmailLogRecorder.register(
    async (facts: ServerEmailLogFacts): Promise<void> => {
      told.push(facts);
      await ServerEmailLogWriter.write(facts);
    },
  );

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
  ServerEmailLogRecorder.register(null);
  jest.restoreAllMocks();
  await MailService.cleanup();
});

describe("an email that belongs to no project", () => {
  test("a password reset that went out leaves one row: to whom, its subject and template, sent", async () => {
    await MailService.send(passwordReset());

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(rowsWritten()).toEqual([
      {
        toEmail: RECIPIENT,
        subject: "Password Reset Request for OneUptime",
        templateType: EmailTemplateType.ForgotPassword,
        status: MailStatus.Success,
        statusMessage: expect.any(String),
        projectId: undefined,
      },
    ]);
  });

  test("the row holds neither the message nor the reset link and its token", async () => {
    await MailService.send(passwordReset());

    // The email itself carried the link: this is what must not be kept.
    const sent: string = JSON.stringify(sendMail.mock.calls[0]?.[0]);
    expect(sent).toContain(RESET_TOKEN);

    const stored: string = JSON.stringify(
      jest.mocked(ServerEmailLogService.create).mock.calls,
    );

    expect(stored).not.toContain(RESET_TOKEN);
    expect(stored).not.toContain("reset-password");
    expect(stored).not.toContain("<html");
    expect(stored).not.toMatch(/"body"|"html"|"text"|"vars"/);

    // And MailService never handed the log the message or its variables.
    expect(Object.keys(told[0]!).sort()).toEqual(
      [
        "isSent",
        "isServerSettings",
        "projectId",
        "statusMessage",
        "subject",
        "templateType",
        "toEmail",
      ].sort(),
    );
  });

  test("a password reset the mail server refused leaves a failed row with the mail server's answer", async () => {
    sendMail.mockRejectedValue(
      new Error("550 5.1.1 <alice@example.test>: Recipient address rejected"),
    );

    await expect(MailService.send(passwordReset())).rejects.toThrow("550");

    expect(rowsWritten()).toEqual([
      {
        toEmail: RECIPIENT,
        subject: "Password Reset Request for OneUptime",
        templateType: EmailTemplateType.ForgotPassword,
        status: MailStatus.Error,
        statusMessage:
          "550 5.1.1 <alice@example.test>: Recipient address rejected",
        projectId: undefined,
      },
    ]);
    expect(
      JSON.stringify(jest.mocked(ServerEmailLogService.create).mock.calls),
    ).not.toContain(RESET_TOKEN);
  });

  test("a password reset on a server with no email set up leaves a failed row that says so", async () => {
    (getGlobalSMTPConfig as unknown as jest.Mock).mockResolvedValue(
      null as never,
    );

    await expect(MailService.send(passwordReset())).rejects.toThrow(
      SERVER_EMAIL_NOT_SET_UP_MESSAGE,
    );

    expect(sendMail).not.toHaveBeenCalled();
    expect(rowsWritten()).toEqual([
      expect.objectContaining({
        toEmail: RECIPIENT,
        status: MailStatus.Error,
        statusMessage: SERVER_EMAIL_NOT_SET_UP_MESSAGE,
      }),
    ]);
  });

  test("a link a subject carries is taken out of the row", async () => {
    const mail: EmailMessage = {
      ...passwordReset(),
      subject: `Finish signing up: ${RESET_URL}`,
    };

    await MailService.send(mail);

    expect(rowsWritten()[0]?.["subject"]).toBe("Finish signing up: [link]");
  });
});

describe("a project's email through the server's own settings", () => {
  test("one that went leaves no row: it is in the project's Email Logs", async () => {
    await MailService.send(incidentEmail(), { projectId: PROJECT_ID });

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(rowsWritten()).toEqual([]);
  });

  test("one that failed leaves a row with its project and template, never its subject", async () => {
    sendMail.mockRejectedValue(new Error("535 5.7.8 Authentication failed"));

    await expect(
      MailService.send(incidentEmail(), { projectId: PROJECT_ID }),
    ).rejects.toThrow("535");

    expect(rowsWritten()).toEqual([
      {
        toEmail: RECIPIENT,
        subject: undefined,
        templateType: EmailTemplateType.SimpleMessage,
        status: MailStatus.Error,
        statusMessage: "535 5.7.8 Authentication failed",
        projectId: PROJECT_ID.toString(),
      },
    ]);
    expect(
      JSON.stringify(jest.mocked(ServerEmailLogService.create).mock.calls),
    ).not.toContain("Checkout API");
  });
});

describe("an email through a project's own mail server", () => {
  test("leaves no row, whether it went or not", async () => {
    await MailService.send(incidentEmail(), {
      projectId: PROJECT_ID,
      emailServer: smtpServer("smtp.project.example.test"),
    });

    sendMail.mockRejectedValue(new Error("550 Mailbox unavailable"));

    await expect(
      MailService.send(incidentEmail(), {
        projectId: PROJECT_ID,
        emailServer: smtpServer("smtp.project.example.test"),
      }),
    ).rejects.toThrow("550");

    expect(rowsWritten()).toEqual([]);
  });
});

describe("a row that cannot be written", () => {
  test("never stops the email, and its log line never names the recipient", async () => {
    jest
      .mocked(ServerEmailLogService.create)
      .mockRejectedValue(
        new Error(
          `value too long for type character varying(100): ${RECIPIENT}`,
        ) as never,
      );

    await MailService.send(passwordReset());

    expect(sendMail).toHaveBeenCalledTimes(1);

    const lines: string = JSON.stringify(jest.mocked(logger.error).mock.calls);

    expect(lines).toContain("The server's email log could not keep");
    expect(lines).not.toContain(RECIPIENT);
  });

  test("a refused email still throws the mail server's error, not the log's", async () => {
    jest
      .mocked(ServerEmailLogService.create)
      .mockRejectedValue(new Error("database is down") as never);
    sendMail.mockRejectedValue(new Error("421 Service not available"));

    await expect(MailService.send(passwordReset())).rejects.toThrow("421");
  });
});
