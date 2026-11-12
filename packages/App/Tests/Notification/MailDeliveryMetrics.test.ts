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
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import OnCallTimelineRows, {
  StoredOnCallNotification,
} from "Common/Tests/Server/TestingUtils/OnCallTimelineRows";
import { STUCK_NOTIFICATION_STATUS_MESSAGE } from "Common/Server/Utils/OnCall/OnCallNotificationStatus";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import Port from "Common/Types/Port";
import { SERVER_EMAIL_NOT_SET_UP_MESSAGE } from "Common/Types/ServerSending/ServerSendingWords";
import MailService from "../../FeatureSet/Notification/Services/MailService";
import { EMAIL_SENT_STATUS_MESSAGE } from "../../FeatureSet/Notification/Utils/EmailStatusMessage";
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
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), updateOneBy: jest.fn() },
  };
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

// The page's on-call log row (OnCallTimelineRows).
let timeline: OnCallTimelineRows;

beforeEach(() => {
  // The page's on-call log row, written over Sending only (recordSendResult).
  timeline = new OnCallTimelineRows();
  timeline.add(TIMELINE_ID, UserNotificationStatus.Sending);
  timeline.standIn(UserOnCallLogTimelineService);

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
      SERVER_EMAIL_NOT_SET_UP_MESSAGE,
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
      SERVER_EMAIL_NOT_SET_UP_MESSAGE,
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

/*
 * THE PAGE'S ON-CALL TIMELINE ENTRY (issue #7082). The send's result is
 * written over Sending only - or over the stuck check's verdict, the
 * result come late - at the version it read (recordSendResult): the person
 * may have acknowledged or escalated the page meanwhile, from another of
 * its messages, and their answer stays.
 */
describe("an email's on-call timeline entry", () => {
  // What the person answered the page with, from another of its messages.
  const ANSWERS: Array<{ status: UserNotificationStatus; message: string }> = [
    {
      status: UserNotificationStatus.Acknowledged,
      message: "Notification Acknowledged",
    },
    {
      status: UserNotificationStatus.PassedOn,
      message: "Escalated from this notification.",
    },
  ];

  interface MailOutcome {
    name: string;
    // The mail server answers so, and the email is sent.
    send: () => Promise<void>;
    status: UserNotificationStatus;
    statusMessage: string;
  }

  const OUTCOMES: Array<MailOutcome> = [
    {
      name: "taken by the mail server",
      send: async (): Promise<void> => {
        await MailService.send(message(), {
          emailServer: smtpServer("smtp.project.example.test"),
          userOnCallLogTimelineId: TIMELINE_ID,
        });
      },
      status: UserNotificationStatus.Sent,
      statusMessage: EMAIL_SENT_STATUS_MESSAGE,
    },
    /*
     * A failure the send does not retry. A mail server's refusal is retried
     * for seconds (MailService.transportMail): it has tests of its own,
     * below.
     */
    {
      name: "not sent: the installation's mail server is not set up",
      send: async (): Promise<void> => {
        (getGlobalSMTPConfig as unknown as jest.Mock).mockResolvedValue(
          null as never,
        );

        await expect(
          MailService.send(message(), {
            userOnCallLogTimelineId: TIMELINE_ID,
          }),
        ).rejects.toThrow(SERVER_EMAIL_NOT_SET_UP_MESSAGE);
      },
      status: UserNotificationStatus.Error,
      statusMessage: SERVER_EMAIL_NOT_SET_UP_MESSAGE,
    },
  ];

  // The project's mail server refuses every attempt at the email.
  function refuseEveryAttempt(onAttempt?: () => void): void {
    sendMail.mockImplementation(async (): Promise<{ messageId: string }> => {
      if (onAttempt) {
        onAttempt();
      }

      throw new Error("550 Mailbox unavailable");
    });
  }

  function sendThroughTheProjectsServer(): Promise<void> {
    return MailService.send(message(), {
      emailServer: smtpServer("smtp.project.example.test"),
      userOnCallLogTimelineId: TIMELINE_ID,
    });
  }

  test("an email the mail server refuses, while its entry still says Sending: Error, in the mail server's words", async () => {
    refuseEveryAttempt();

    await expect(sendThroughTheProjectsServer()).rejects.toThrow("550");

    expect(timeline.get(TIMELINE_ID)).toMatchObject({
      status: UserNotificationStatus.Error,
      statusMessage: "550 Mailbox unavailable",
      version: 2,
    });
    expect(timeline.writes).toHaveLength(1);
  }, 20000);

  test("an email the mail server refuses, the person having acknowledged the page from another message while it was retried: the acknowledgement stays", async () => {
    let attempts: number = 0;

    refuseEveryAttempt((): void => {
      attempts++;

      // The person's acknowledgement lands as the first attempt is refused.
      if (attempts === 1) {
        const row: StoredOnCallNotification = timeline.get(TIMELINE_ID)!;
        row.status = UserNotificationStatus.Acknowledged;
        row.statusMessage = "Notification Acknowledged";
        row.version++;
      }
    });

    await expect(sendThroughTheProjectsServer()).rejects.toThrow("550");

    expect(attempts).toBeGreaterThan(1);
    expect(timeline.get(TIMELINE_ID)).toMatchObject({
      status: UserNotificationStatus.Acknowledged,
      statusMessage: "Notification Acknowledged",
      version: 2,
    });
    expect(timeline.writes).toEqual([]);
  }, 20000);

  test.each(OUTCOMES)(
    "an email $name, while its entry still says Sending: the entry says so",
    async (outcome: MailOutcome) => {
      await outcome.send();

      expect(timeline.get(TIMELINE_ID)).toMatchObject({
        status: outcome.status,
        statusMessage: outcome.statusMessage,
        version: 2,
      });
      expect(timeline.writes).toEqual([
        {
          id: TIMELINE_ID.toString(),
          data: {
            status: outcome.status,
            statusMessage: outcome.statusMessage,
          },
        },
      ]);
    },
  );

  test.each(
    ANSWERS.flatMap(
      (answer: { status: UserNotificationStatus; message: string }) => {
        return OUTCOMES.map((outcome: MailOutcome) => {
          return {
            answer: answer.status,
            answerMessage: answer.message,
            outcomeName: outcome.name,
            outcome: outcome,
          };
        });
      },
    ),
  )(
    "a page already $answer, then an email $outcomeName: the answer stays",
    async (row: {
      answer: UserNotificationStatus;
      answerMessage: string;
      outcome: MailOutcome;
    }) => {
      timeline.add(TIMELINE_ID, row.answer, {
        statusMessage: row.answerMessage,
      });

      await row.outcome.send();

      expect(timeline.get(TIMELINE_ID)).toMatchObject({
        status: row.answer,
        statusMessage: row.answerMessage,
        version: 1,
      });
      expect(timeline.writes).toEqual([]);
    },
  );

  test.each(OUTCOMES)(
    "an email $name after the stuck check settled its entry: its own result, come late, replaces the verdict",
    async (outcome: MailOutcome) => {
      timeline.add(TIMELINE_ID, UserNotificationStatus.Error, {
        statusMessage: STUCK_NOTIFICATION_STATUS_MESSAGE,
      });

      await outcome.send();

      expect(timeline.get(TIMELINE_ID)).toMatchObject({
        status: outcome.status,
        statusMessage: outcome.statusMessage,
        version: 2,
      });
    },
  );

  test.each(OUTCOMES)(
    "an email $name, acknowledged between the send's read of its entry and its write: the acknowledgement stays",
    async (outcome: MailOutcome) => {
      timeline.whenRead((row: StoredOnCallNotification) => {
        row.status = UserNotificationStatus.Acknowledged;
        row.statusMessage = "Notification Acknowledged";
      });

      await outcome.send();

      expect(timeline.get(TIMELINE_ID)).toMatchObject({
        status: UserNotificationStatus.Acknowledged,
        statusMessage: "Notification Acknowledged",
      });
      expect(timeline.writes).toEqual([]);
    },
  );
});
