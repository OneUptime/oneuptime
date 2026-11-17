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
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import {
  ServerSendingChannel,
  ServerSendingFailureScope,
} from "Common/Types/ServerSending/ServerSendingStatus";
import { SERVER_EMAIL_NOT_SET_UP_MESSAGE } from "Common/Types/ServerSending/ServerSendingWords";
import ServerSendingOutcomes, {
  ServerSendingOutcome,
} from "Common/Server/Utils/ServerSending/ServerSendingOutcomes";
import EmailLogService from "Common/Server/Services/EmailLogService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import OnCallTimelineRows from "Common/Tests/Server/TestingUtils/OnCallTimelineRows";
import MailService from "../../FeatureSet/Notification/Services/MailService";
import SendGridMailProvider from "../../FeatureSet/Notification/Services/MailProviders/SendGridMailProvider";
import "../../FeatureSet/Notification/Utils/Handlebars";

/*
 * HOW THE SERVER'S OWN EMAILS WENT, AS MAILSERVICE TELLS IT (#6825).
 *
 *   - an email sent through the server's own settings tells
 *     ServerSendingOutcomes how it went: it went out, or the mail service
 *     refused it and why. That is what the banner and canSendEmail are
 *     worked out from;
 *   - an email through a project's own mail server tells nothing: its
 *     failures are the project's to fix;
 *   - an email that never reached a mail service - the server's settings
 *     left blank, or OneUptime's own template - tells nothing either:
 *     "not set up" is read from the settings;
 *   - while the server's settings are missing or incomplete, the error, the
 *     Email Log row a project's owners read and the on-call log all say so
 *     in their words, once - never "Global SMTP Config not found".
 *
 * MailService runs as it is; the mail transports, the database and the
 * server's settings are stood in for.
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
  return { IsDevelopment: false };
});

jest.mock("Common/Server/Services/EmailLogService", () => {
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
  getGlobalEmailProviderServer,
  getGlobalSMTPConfig,
  getSendgridConfig,
} from "../../FeatureSet/Notification/Config";

type SendMail = (mail: unknown) => Promise<{ messageId: string }>;

const sendMail: ReturnType<typeof jest.fn<SendMail>> = jest.fn<SendMail>();

const PROJECT_ID: ObjectID = new ObjectID(
  "68250000-0000-4000-8000-000000000001",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "68250000-0000-4000-8000-000000000002",
);

const outcomes: Array<ServerSendingOutcome> = [];

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

function message(): EmailMessage {
  return {
    toEmail: new Email("alice@example.test"),
    subject: "Incident #12: Checkout API is down",
    isSubjectLiteral: true,
    templateType: EmailTemplateType.SimpleMessage,
    vars: { subject: "Incident #12", message: "Checkout API is down" },
    body: "",
  };
}

// The Email Log rows written, as the project's owners read them.
function logRows(): Array<Record<string, unknown>> {
  return (
    jest.mocked(EmailLogService.create).mock.calls as Array<Array<unknown>>
  ).map((call: Array<unknown>): Record<string, unknown> => {
    return {
      ...((call[0] as { data: Record<string, unknown> }).data || {}),
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

// The page's on-call log row, written over Sending only (recordSendResult).
let timeline: OnCallTimelineRows;

beforeEach(() => {
  jest.clearAllMocks();
  outcomes.length = 0;

  timeline = new OnCallTimelineRows();
  timeline.add(TIMELINE_ID, UserNotificationStatus.Sending);
  timeline.standIn(UserOnCallLogTimelineService);

  ServerSendingOutcomes.register(
    async (outcome: ServerSendingOutcome): Promise<void> => {
      outcomes.push(outcome);
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
  ServerSendingOutcomes.register(null);
  jest.restoreAllMocks();
  await MailService.cleanup();
});

describe("the server's own mail server", () => {
  test("an email that went out says so", async () => {
    await MailService.send(message(), { projectId: PROJECT_ID });

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([
      {
        channel: ServerSendingChannel.Email,
        succeeded: true,
        recipient: "alice@example.test",
      },
    ]);
  });

  test("an email the mail server refused says why, and the send still throws", async () => {
    sendMail.mockRejectedValue(new Error("535 5.7.8 Authentication failed"));

    await expect(
      MailService.send(message(), { projectId: PROJECT_ID }),
    ).rejects.toThrow("535");

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      channel: ServerSendingChannel.Email,
      succeeded: false,
    });
    expect(outcomes[0]!.reason).toContain("535 5.7.8 Authentication failed");
  });

  test("the server's own SendGrid: an email that went out says so", async () => {
    (getEmailServerType as unknown as jest.Mock).mockResolvedValue(
      "Sendgrid" as never,
    );
    (getSendgridConfig as unknown as jest.Mock).mockResolvedValue({
      apiKey: "SG.key",
      fromEmail: new Email("alerts@example.test"),
      fromName: "Alerts",
    } as never);

    jest
      .spyOn(SendGridMailProvider.prototype, "send")
      .mockResolvedValue(undefined as never);

    await MailService.send(message());

    expect(outcomes).toEqual([
      {
        channel: ServerSendingChannel.Email,
        succeeded: true,
        recipient: "alice@example.test",
      },
    ]);
  });

  test("an email OneUptime could not render never reached a mail service, and says nothing", async () => {
    jest
      .spyOn(MailService, "render")
      .mockRejectedValue(new Error("template broke") as never);

    await expect(
      MailService.send(message(), { projectId: PROJECT_ID }),
    ).rejects.toThrow("template broke");

    expect(outcomes).toEqual([]);
  });
});

describe("a project's own mail server", () => {
  test("says nothing of the server's email, whether it goes out or not", async () => {
    await MailService.send(message(), {
      projectId: PROJECT_ID,
      emailServer: smtpServer("smtp.project.example.test"),
    });

    sendMail.mockRejectedValue(new Error("550 Mailbox unavailable"));

    await expect(
      MailService.send(message(), {
        projectId: PROJECT_ID,
        emailServer: smtpServer("smtp.project.example.test"),
      }),
    ).rejects.toThrow("550");

    expect(outcomes).toEqual([]);
  });
});

describe("the server's own settings missing or incomplete", () => {
  test.each([
    [
      "Custom SMTP never filled in",
      (): void => {
        (getGlobalSMTPConfig as unknown as jest.Mock).mockResolvedValue(
          null as never,
        );
      },
    ],
    [
      "Custom SMTP left incomplete",
      (): void => {
        (getGlobalSMTPConfig as unknown as jest.Mock).mockRejectedValue(
          new BadDataException(
            "SMTP Host not found. Please set this in the Admin Dashboard: http://localhost/admin",
          ) as never,
        );
      },
    ],
    [
      "SendGrid picked, its key left blank",
      (): void => {
        (getEmailServerType as unknown as jest.Mock).mockResolvedValue(
          "Sendgrid" as never,
        );
        (getSendgridConfig as unknown as jest.Mock).mockResolvedValue(
          null as never,
        );
      },
    ],
    [
      "Resend picked, its key left blank",
      (): void => {
        (getEmailServerType as unknown as jest.Mock).mockResolvedValue(
          "Resend" as never,
        );
        (
          getGlobalEmailProviderServer as unknown as jest.Mock
        ).mockRejectedValue(
          new BadDataException(
            "Email is configured to use Resend, but its API Key is not set. Please set it in the Admin Dashboard, under Settings > Emails: http://localhost/admin",
          ).asUserError() as never,
        );
      },
    ],
  ])(
    "%s: everyone is told the server has no email set up, once, and nothing is recorded as failing",
    async (_name: string, arrange: () => void) => {
      arrange();

      await expect(
        MailService.send(message(), {
          projectId: PROJECT_ID,
          userOnCallLogTimelineId: TIMELINE_ID,
        }),
      ).rejects.toThrow(SERVER_EMAIL_NOT_SET_UP_MESSAGE);

      expect(sendMail).not.toHaveBeenCalled();

      // One Email Log row, in the project owner's words.
      expect(logRows()).toHaveLength(1);
      expect(logRows()[0]).toMatchObject({
        status: "Error",
        statusMessage: SERVER_EMAIL_NOT_SET_UP_MESSAGE,
      });
      expect(JSON.stringify(logRows())).not.toMatch(
        /Global SMTP Config not found|SMTP settings are not configured|Sendgrid Settings/,
      );

      // And whoever waits on the on-call log reads the same.
      expect(timeline.get(TIMELINE_ID)).toMatchObject({
        status: UserNotificationStatus.Error,
        statusMessage: SERVER_EMAIL_NOT_SET_UP_MESSAGE,
      });

      // "Not set up" is read from the settings, never written as failing.
      expect(outcomes).toEqual([]);
    },
  );

  test("a read of the settings that fails for another reason is not called 'not set up'", async () => {
    (getGlobalSMTPConfig as unknown as jest.Mock).mockRejectedValue(
      new Error("connect ECONNREFUSED 10.0.0.5:5432") as never,
    );

    await expect(
      MailService.send(message(), { projectId: PROJECT_ID }),
    ).rejects.toThrow("ECONNREFUSED");

    expect(logRows()[0]?.["statusMessage"]).not.toBe(
      SERVER_EMAIL_NOT_SET_UP_MESSAGE,
    );
  });

  test("an email with no project writes no log row, and still says why", async () => {
    (getGlobalSMTPConfig as unknown as jest.Mock).mockResolvedValue(
      null as never,
    );

    await expect(MailService.send(message())).rejects.toThrow(
      SERVER_EMAIL_NOT_SET_UP_MESSAGE,
    );

    expect(logRows()).toEqual([]);
  });
});

/*
 * WHOSE FAILURE IT IS (#9217): one recipient's refusal is told as that
 * recipient's - and still written on the email's log row and the on-call
 * log - while a failure of the server's settings is the server's.
 */
describe("whose failure the server's own mail server says it is", () => {
  function smtpError(
    message: string,
    extra: Record<string, unknown>,
  ): Error & Record<string, unknown> {
    return Object.assign(new Error(message), extra);
  }

  test("the issue: an Amazon SES sandbox refusing one unverified recipient is that recipient's", async () => {
    const refusal: string =
      "Message failed: 554 Message rejected: Email address is not verified. The following identities failed the check in region AP-SOUTHEAST-1: alice@example.test";

    sendMail.mockRejectedValue(
      smtpError(refusal, {
        code: "EMESSAGE",
        responseCode: 554,
        command: "DATA",
      }),
    );

    await expect(
      MailService.send(message(), {
        projectId: PROJECT_ID,
        userOnCallLogTimelineId: TIMELINE_ID,
      }),
    ).rejects.toThrow("554");

    expect(outcomes).toEqual([
      {
        channel: ServerSendingChannel.Email,
        succeeded: false,
        reason: refusal,
        scope: ServerSendingFailureScope.Recipient,
        recipient: "alice@example.test",
      },
    ]);

    // Said where it can be acted on: the email's log row and the on-call log.
    expect(logRows()[0]).toMatchObject({
      status: "Error",
      statusMessage: refusal,
    });
    expect(timeline.get(TIMELINE_ID)).toMatchObject({
      status: UserNotificationStatus.Error,
    });
  });

  test("the sender not verified is the server's", async () => {
    sendMail.mockRejectedValue(
      smtpError(
        "Message failed: 554 Message rejected: Email address is not verified. The following identities failed the check in region US-EAST-1: alerts@example.test",
        { code: "EMESSAGE", responseCode: 554, command: "DATA" },
      ),
    );

    await expect(
      MailService.send(message(), { projectId: PROJECT_ID }),
    ).rejects.toThrow("554");

    expect(outcomes[0]).toMatchObject({
      succeeded: false,
      scope: ServerSendingFailureScope.Server,
    });
  });

  test("a login refused is the server's", async () => {
    sendMail.mockRejectedValue(
      smtpError("Invalid login: 535 5.7.8 Authentication failed", {
        code: "EAUTH",
        responseCode: 535,
        command: "AUTH PLAIN",
      }),
    );

    await expect(
      MailService.send(message(), { projectId: PROJECT_ID }),
    ).rejects.toThrow("535");

    expect(outcomes[0]).toMatchObject({
      succeeded: false,
      scope: ServerSendingFailureScope.Server,
      recipient: "alice@example.test",
    });
  });

  test("a mailbox that does not exist, refused at RCPT TO, is that recipient's", async () => {
    sendMail.mockRejectedValue(
      smtpError(
        "Can't send mail - all recipients were rejected: 550 5.1.1 <alice@example.test>: Recipient address rejected: User unknown",
        { code: "EENVELOPE", responseCode: 550, command: "RCPT TO" },
      ),
    );

    await expect(
      MailService.send(message(), { projectId: PROJECT_ID }),
    ).rejects.toThrow("550");

    expect(outcomes[0]).toMatchObject({
      succeeded: false,
      scope: ServerSendingFailureScope.Recipient,
      recipient: "alice@example.test",
    });
  });

  test("a project's own mail server still says nothing, whoever's it is", async () => {
    sendMail.mockRejectedValue(
      smtpError("550 5.1.1 User unknown", {
        code: "EENVELOPE",
        command: "RCPT TO",
      }),
    );

    await expect(
      MailService.send(message(), {
        projectId: PROJECT_ID,
        emailServer: smtpServer("smtp.project.example.test"),
      }),
    ).rejects.toThrow("550");

    expect(outcomes).toEqual([]);
  });
});
