import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import nodemailer, { Transporter } from "nodemailer";
import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import MailTransportType from "Common/Types/Email/MailTransportType";
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import Port from "Common/Types/Port";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import { EmailInlineImage } from "Common/Server/Utils/Mail/EmailInlineImages";
import {
  MAX_EMAIL_BYTES,
  MAX_EMAIL_FIELD_HTML_BYTES,
} from "Common/Server/Utils/Mail/EmailSize";
import logger from "Common/Server/Utils/Logger";
import { getEmailServerType } from "../../FeatureSet/Notification/Config";
import MailService, {
  RenderedEmail,
} from "../../FeatureSet/Notification/Services/MailService";
import MicrosoftGraphMailProvider from "../../FeatureSet/Notification/Services/MailProviders/MicrosoftGraphMailProvider";
import { MailProviderSendOptions } from "../../FeatureSet/Notification/Services/MailProviders/MailProvider";
import "../../FeatureSet/Notification/Utils/Handlebars";

/*
 * AN EMAIL IS NEVER BIGGER THAN A MAIL SERVER TAKES.
 *
 * A mail server refuses a message over its limit - Postfix takes 10 MB
 * unless told otherwise, Microsoft Graph refuses a sendMail request over
 * 4 MB - and the notification is lost. A description can be megabytes, and
 * a table's HTML many times its Markdown. Through the real send path - the
 * on-call "Acknowledge Incident" template, MailService's render and
 * delivery, and each transport's payload - each Markdown field is held to
 * MAX_EMAIL_FIELD_HTML_BYTES and the whole email, its HTML and attachments,
 * to MAX_EMAIL_BYTES. A cut text ends with a note that links to the record.
 *
 * Only infrastructure and the transports themselves are mocked.
 */
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

// A real 1x1 PNG, as the probe reports a screenshot.
const PNG: string =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const ACKNOWLEDGE_URL: string =
  "https://oneuptime.example.test/api/user-on-call-log-timeline/acknowledge-page/abc";

const SMTP_SERVER: EmailServer = {
  host: new Hostname("smtp.example.test"),
  port: new Port(587),
  secure: true,
  username: undefined,
  password: undefined,
  fromName: "OneUptime Notifications",
  fromEmail: new Email("notifications@example.test"),
};

const GRAPH_SERVER: EmailServer = {
  transportType: MailTransportType.MicrosoftGraph,
  username: "sender@contoso.com",
  password: undefined,
  fromEmail: new Email("sender@contoso.com"),
  fromName: "OneUptime Alerts",
  authType: SMTPAuthenticationType.OAuth,
  clientId: "client-id",
  clientSecret: "client-secret",
  tokenUrl: URL.fromString(
    "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
  ),
  scope: "https://graph.microsoft.com/.default",
  oauthProviderType: OAuthProviderType.ClientCredentials,
};

interface CapturedSmtpMail {
  from: string;
  to: string;
  subject: string;
  html: string;
  attachments?: Array<Record<string, unknown>>;
}

type SendMail = (mail: CapturedSmtpMail) => Promise<{ messageId: string }>;

const sendMail: ReturnType<typeof jest.fn<SendMail>> = jest.fn<SendMail>();

type GraphSend = (
  mail: EmailMessage,
  server: EmailServer,
  options?: MailProviderSendOptions,
) => Promise<void>;

const graphSend: ReturnType<typeof jest.fn<GraphSend>> = jest.fn<GraphSend>();

// The on-call email for an incident whose description is `description`.
async function acknowledgeIncidentEmail(
  description: string,
): Promise<EmailMessage> {
  return {
    toEmail: new Email("oncall@example.test"),
    subject: "ACTION REQUIRED: Incident #12 created - Checkout is down",
    isSubjectLiteral: true,
    templateType: EmailTemplateType.AcknowledgeIncident,
    vars: {
      incidentTitle: "Checkout is down",
      incidentNumber: "#12",
      projectName: "Acme",
      currentState: "Identified",
      incidentSeverity: "Critical",
      resourcesAffected: "Checkout",
      rootCause: await Markdown.convertToHTML(
        "No root cause identified for this incident",
        MarkdownContentType.Email,
      ),
      incidentDescription: await Markdown.convertToHTML(
        description,
        MarkdownContentType.Email,
      ),
      incidentViewLink: "https://oneuptime.example.test/incidents/12",
      acknowledgeIncidentLink: ACKNOWLEDGE_URL,
    },
  };
}

async function deliverOverSmtp(mail: EmailMessage): Promise<CapturedSmtpMail> {
  await MailService.send(mail, { emailServer: SMTP_SERVER });

  expect(sendMail).toHaveBeenCalledTimes(1);

  return sendMail.mock.calls[0]![0];
}

beforeAll(async () => {
  const partialNames: Array<string> = fs
    .readdirSync(
      Path.resolve(
        __dirname,
        "../../FeatureSet/Notification/Templates/Partials",
      ),
    )
    .filter((name: string): boolean => {
      return name.endsWith(".hbs");
    })
    .map((name: string): string => {
      return name.slice(0, -4);
    });
  const deadline: number = Date.now() + 15000;

  // The production initializer registers the partials asynchronously.
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
  jest.mocked(getEmailServerType).mockResolvedValue("Custom SMTP" as never);
  sendMail.mockResolvedValue({ messageId: "mocked-delivery" });
  jest.mocked(nodemailer.createTransport).mockReturnValue({
    sendMail,
    close: jest.fn(),
  } as unknown as Transporter);
  graphSend.mockResolvedValue(undefined);
  jest.mocked(MicrosoftGraphMailProvider).mockImplementation((() => {
    return { send: graphSend };
  }) as unknown as () => MicrosoftGraphMailProvider);
});

afterEach(async () => {
  await MailService.cleanup();
});

const INCIDENT_LINK: string = "https://oneuptime.example.test/incidents/12";

// A PNG of about `kilobytes` KB, each `filler` a different image.
function screenshot(kilobytes: number, filler: number): string {
  return Buffer.concat([
    Buffer.from(PNG, "base64").subarray(0, 8),
    Buffer.alloc(kilobytes * 1024 - 8 - ((kilobytes * 1024 - 8) % 3), filler),
  ]).toString("base64");
}

function emailSize(payload: CapturedSmtpMail): number {
  return (
    Buffer.byteLength(payload.html, "utf8") +
    (payload.attachments || []).reduce(
      (total: number, attachment: Record<string, unknown>): number => {
        return total + String(attachment["content"]).length;
      },
      0,
    )
  );
}

const LINKED_NOTE: string = `<a href="${INCIDENT_LINK}" style="color:#64748b;">see OneUptime for the full text</a>`;

describe("an email is never bigger than a mail server takes", () => {
  test("a description of megabytes is cut, and its note links to the incident", async () => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {});

    const payload: CapturedSmtpMail = await deliverOverSmtp(
      await acknowledgeIncidentEmail(
        `**Response:**\n\n${"2026-10-08T10:00:00Z INFO GET /api 200 in 12 ms\n".repeat(120000)}`,
      ),
    );

    expect(emailSize(payload)).toBeLessThanOrEqual(MAX_EMAIL_BYTES);
    expect(Buffer.byteLength(payload.html, "utf8")).toBeLessThan(
      MAX_EMAIL_FIELD_HTML_BYTES + 100 * 1024,
    );
    expect(payload.html).toContain("<strong>Response:</strong>");
    expect(payload.html).toContain(LINKED_NOTE);
    // The rest of the email - the Acknowledge button included - is all there.
    expect(payload.html).toContain("Acknowledge Incident");
    expect(payload.html).toContain("</html>");
  });

  test("a description that fits is sent exactly as rendered", async () => {
    const mail: EmailMessage = await acknowledgeIncidentEmail(
      "The API is **down**.\n\n| Host | State |\n| --- | --- |\n| web-01 | down |",
    );
    const rendered: RenderedEmail = await MailService.render({ ...mail });

    const payload: CapturedSmtpMail = await deliverOverSmtp(mail);

    expect(payload.html).toBe(rendered.body);
    expect(payload.html).not.toContain("see OneUptime for the full text");
  });

  test("the preview shows the note as it is sent: linked to the incident", async () => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {});

    const rendered: RenderedEmail = await MailService.render(
      await acknowledgeIncidentEmail("word ".repeat(400000)),
    );

    expect(rendered.body).toContain(LINKED_NOTE);
  });

  test("screenshots that do not fit beside long fields are left out with a note, within the limit", async () => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {});

    const longText: string = "a log line of a response body\n".repeat(20000);
    // Two screenshots, within what an email may carry, before a long log.
    const mail: EmailMessage = await acknowledgeIncidentEmail(
      `![Run 1](data:image/png;base64,${screenshot(1000, 0x41)})\n\n![Run 2](data:image/png;base64,${screenshot(1000, 0x42)})\n\n${longText}`,
    );

    // A root cause of the same length: two fields as long as a field may be.
    mail.vars!["rootCause"] = await Markdown.convertToHTML(
      longText,
      MarkdownContentType.Email,
    );

    const payload: CapturedSmtpMail = await deliverOverSmtp(mail);

    expect(emailSize(payload)).toBeLessThanOrEqual(MAX_EMAIL_BYTES);
    expect(payload.attachments).toHaveLength(1);
    expect(payload.html).toContain(
      "[Run 2: image too large to include in this email]",
    );
    expect(payload.html).not.toContain("data:image");
    // Both fields are there, each cut with its note.
    expect(payload.html.split(LINKED_NOTE)).toHaveLength(3);
  });

  test("an email whose HTML alone is over the limit is cut, and its note links too", async () => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {});

    const payload: CapturedSmtpMail = await deliverOverSmtp({
      toEmail: new Email("oncall@example.test"),
      subject: "A very long message",
      isSubjectLiteral: true,
      body: `<p>${"x".repeat(4 * 1024 * 1024)}</p>`,
      vars: { incidentViewLink: INCIDENT_LINK },
    } as EmailMessage);

    expect(Buffer.byteLength(payload.html, "utf8")).toBeLessThanOrEqual(
      MAX_EMAIL_BYTES + 200,
    );
    expect(payload.html.endsWith(`${LINKED_NOTE})</p>`)).toBe(true);
  });

  test("over Microsoft Graph, the request is within its 4 MB", async () => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {});

    const mail: EmailMessage = await acknowledgeIncidentEmail(
      `![Run](data:image/png;base64,${screenshot(1800, 0x43)})\n\n${"a log line\n".repeat(200000)}`,
    );

    await MailService.send(mail, { emailServer: GRAPH_SERVER });

    expect(graphSend).toHaveBeenCalledTimes(1);

    const sent: EmailMessage = graphSend.mock.calls[0]![0];
    const options: MailProviderSendOptions | undefined =
      graphSend.mock.calls[0]![2];
    const imagesBase64: number = (options?.inlineImages || []).reduce(
      (total: number, image: EmailInlineImage): number => {
        return total + image.base64.length;
      },
      0,
    );

    expect(
      Buffer.byteLength(JSON.stringify(sent.body), "utf8") + imagesBase64,
    ).toBeLessThan(4 * 1000 * 1000);
    expect(imagesBase64).toBeGreaterThan(0);
  });
});
