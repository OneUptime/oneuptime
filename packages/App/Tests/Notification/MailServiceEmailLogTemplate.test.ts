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
import ColumnLength from "Common/Types/Database/ColumnLength";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import MailStatus from "Common/Types/Mail/MailStatus";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import EmailLogService from "Common/Server/Services/EmailLogService";
import MailService from "../../FeatureSet/Notification/Services/MailService";
import "../../FeatureSet/Notification/Utils/Handlebars";

/*
 * A PROJECT'S EMAIL LOG KEEPS WHICH EMAIL EACH ROW WAS (#9511).
 *
 * The Users list says when a pending person's latest invitation email was
 * not sent, and finds their invitation emails in the project's Email Logs
 * by the template they were written from - as the server's email log
 * already names a row (ServerEmailLog.templateType). So every row of a
 * project's email keeps its template, whether the email went or failed;
 * an email written without one keeps none.
 *
 * MailService runs as it is; the mail transport, the database and the
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
  "95110000-0000-4000-8000-000000000001",
);
const INVITEE_ID: ObjectID = new ObjectID(
  "95110000-0000-4000-8000-000000000002",
);
const RECIPIENT: string = "grace@example.test";

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

// The invitation email, as TeamMemberService sends it.
function invitation(): EmailMessage {
  return {
    toEmail: new Email(RECIPIENT),
    subject: "Ada Lovelace invited you to Acme",
    isSubjectLiteral: true,
    templateType: EmailTemplateType.InviteMember,
    vars: {
      signInLink: "https://oneuptime.example.test/accounts",
      registerLink: "https://oneuptime.example.test/accounts/register",
      isNewUser: "true",
      isInvitationAccepted: "false",
      projectName: "Acme",
      homeUrl: "https://oneuptime.example.test",
    },
    body: "",
  };
}

// The project's Email Log rows written, as the database would get them.
function emailLogRows(): Array<Record<string, unknown>> {
  return (
    jest.mocked(EmailLogService.create).mock.calls as Array<Array<unknown>>
  ).map((call: Array<unknown>): Record<string, unknown> => {
    const data: Record<string, unknown> = (
      call[0] as { data: Record<string, unknown> }
    ).data;

    return {
      projectId: data["projectId"]?.toString(),
      userId: data["userId"]?.toString(),
      toEmail: data["toEmail"]?.toString(),
      templateType: data["templateType"],
      status: data["status"],
      statusMessage: data["statusMessage"],
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

describe("a project's Email Log row", () => {
  test("keeps the invitation's template when the invitation went", async () => {
    await MailService.send(invitation(), {
      projectId: PROJECT_ID,
      userId: INVITEE_ID,
    });

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(emailLogRows()).toEqual([
      {
        projectId: PROJECT_ID.toString(),
        userId: INVITEE_ID.toString(),
        toEmail: RECIPIENT,
        templateType: EmailTemplateType.InviteMember,
        status: MailStatus.Success,
        statusMessage: expect.any(String),
      },
    ]);
  });

  test("keeps it when the mail service refused the invitation, beside the mail service's answer", async () => {
    sendMail.mockRejectedValue(new Error("535 5.7.8 Authentication failed"));

    await expect(
      MailService.send(invitation(), {
        projectId: PROJECT_ID,
        userId: INVITEE_ID,
      }),
    ).rejects.toThrow("535");

    expect(emailLogRows()).toEqual([
      {
        projectId: PROJECT_ID.toString(),
        userId: INVITEE_ID.toString(),
        toEmail: RECIPIENT,
        templateType: EmailTemplateType.InviteMember,
        status: MailStatus.Error,
        statusMessage: "535 5.7.8 Authentication failed",
      },
    ]);
  });

  test("keeps it for a project's own mail server too", async () => {
    await MailService.send(invitation(), {
      projectId: PROJECT_ID,
      userId: INVITEE_ID,
      emailServer: smtpServer("smtp.project.example.test"),
    });

    expect(emailLogRows()[0]?.["templateType"]).toBe(
      EmailTemplateType.InviteMember,
    );
  });

  test("keeps any other email's own template, so it is never taken for an invitation", async () => {
    await MailService.send(
      {
        ...invitation(),
        subject: "Set up how you are paged",
        templateType: EmailTemplateType.SimpleMessage,
        vars: { subject: "Set up how you are paged", message: "Hello" },
      },
      { projectId: PROJECT_ID, userId: INVITEE_ID },
    );

    expect(emailLogRows()[0]?.["templateType"]).toBe(
      EmailTemplateType.SimpleMessage,
    );
  });

  test("keeps no template for an email written without one", async () => {
    await MailService.send(
      {
        toEmail: new Email(RECIPIENT),
        subject: "A workflow's email",
        isSubjectLiteral: true,
        body: "<p>Hello</p>",
      },
      { projectId: PROJECT_ID },
    );

    expect(emailLogRows()).toHaveLength(1);
    expect(emailLogRows()[0]?.["templateType"]).toBeUndefined();
  });

  test("a template is kept to the column's length", async () => {
    const longTemplate: string = `${"A".repeat(ColumnLength.ShortText + 20)}.hbs`;

    await MailService.send(
      {
        ...invitation(),
        templateType: longTemplate as EmailTemplateType,
      },
      { projectId: PROJECT_ID },
    ).catch(() => {
      // A template that does not exist is refused; its row is still written.
    });

    const kept: unknown = emailLogRows()[0]?.["templateType"];

    expect(typeof kept).toBe("string");
    expect((kept as string).length).toBeLessThanOrEqual(ColumnLength.ShortText);
  });
});
