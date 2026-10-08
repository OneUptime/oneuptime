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
import SendgridMail from "@sendgrid/mail";
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
  getEmailServerType,
  getSendgridConfig,
} from "../../FeatureSet/Notification/Config";
import MailService, {
  RenderedEmail,
} from "../../FeatureSet/Notification/Services/MailService";
import MicrosoftGraphMailProvider from "../../FeatureSet/Notification/Services/MailProviders/MicrosoftGraphMailProvider";
import { MailProviderSendOptions } from "../../FeatureSet/Notification/Services/MailProviders/MailProvider";
import "../../FeatureSet/Notification/Utils/Handlebars";

/*
 * A synthetic monitor's screenshot in an incident description, through the
 * real send path: the on-call "Acknowledge Incident" template, MailService's
 * render and delivery, and each transport's payload. Since ea611c316 the
 * screenshot was dropped from the email altogether (issue #4532); before it,
 * it went out as a data: URL that Gmail and Outlook do not show. It now goes
 * out as an inline attachment the HTML points at by Content-ID.
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

// A real 1x1 PNG and JPEG, as the probe reports a screenshot.
const PNG: string =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG: string =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

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

// The description the template in issue #4532 renders for a failed check.
const SCREENSHOT_DESCRIPTION: string = `Timeout 30000ms exceeded\n![](data:image/png;base64,${PNG})`;

function contentIdsIn(html: string): Array<string> {
  return Array.from(
    html.matchAll(/src="cid:([^"]+)"/g),
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
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

describe("a screenshot in an incident description, over SMTP", () => {
  test("goes out as an inline attachment the HTML points at by Content-ID", async () => {
    const payload: CapturedSmtpMail = await deliverOverSmtp(
      await acknowledgeIncidentEmail(SCREENSHOT_DESCRIPTION),
    );

    const contentIds: Array<string> = contentIdsIn(payload.html);

    expect(contentIds).toHaveLength(1);
    expect(payload.attachments).toEqual([
      {
        filename: "image-1.png",
        content: PNG,
        encoding: "base64",
        contentType: "image/png",
        contentDisposition: "inline",
        cid: contentIds[0],
      },
    ]);
    expect(payload.html).not.toContain("data:image");
    expect(payload.html).toContain("Timeout 30000ms exceeded");
  });

  test("the rest of the email - the Acknowledge button included - is all there", async () => {
    const payload: CapturedSmtpMail = await deliverOverSmtp(
      await acknowledgeIncidentEmail(SCREENSHOT_DESCRIPTION),
    );

    expect(payload.to).toBe("oncall@example.test");
    expect(payload.subject).toBe(
      "ACTION REQUIRED: Incident #12 created - Checkout is down",
    );
    expect(payload.html).toContain("Acknowledge Incident");
    expect(payload.html).toContain(
      `href="${Handlebars.escapeExpression(ACKNOWLEDGE_URL)}"`,
    );
    expect(payload.html).toContain("</html>");
    // The body stays far below the size at which Gmail clips it.
    expect(payload.html.length).toBeLessThan(100 * 1024);
  });

  test("nodemailer builds a multipart/related message with the image as an inline part", async () => {
    const payload: CapturedSmtpMail = await deliverOverSmtp(
      await acknowledgeIncidentEmail(SCREENSHOT_DESCRIPTION),
    );
    const contentId: string = contentIdsIn(payload.html)[0]!;

    // The real nodemailer, writing the message instead of sending it.
    const realNodemailer: typeof nodemailer = (
      jest.requireActual("nodemailer") as { default: typeof nodemailer }
    ).default;
    const transport: Transporter = realNodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      newline: "unix",
    });
    const info: { message: Buffer } = (await transport.sendMail(
      payload,
    )) as unknown as { message: Buffer };
    const raw: string = info.message.toString("utf8");

    expect(raw).toMatch(/Content-Type: multipart\/related; type="text\/html"/);
    expect(raw).toContain(
      [
        "Content-Type: image/png; name=image-1.png",
        `Content-ID: <${contentId}>`,
        "Content-Transfer-Encoding: base64",
        "Content-Disposition: inline; filename=image-1.png",
      ].join("\n"),
    );
    expect(raw.replace(/\n/g, "")).toContain(PNG);
  });

  test("a JPEG screenshot in the usual image/png template is attached as a JPEG", async () => {
    const payload: CapturedSmtpMail = await deliverOverSmtp(
      await acknowledgeIncidentEmail(
        `![Checkout](data:image/png;base64,${JPEG})`,
      ),
    );

    expect(payload.attachments).toEqual([
      expect.objectContaining({
        filename: "image-1.jpg",
        contentType: "image/jpeg",
        content: JPEG,
      }),
    ]);
  });

  test("an email with no inline image is sent exactly as before, with no attachments", async () => {
    const payload: CapturedSmtpMail = await deliverOverSmtp(
      await acknowledgeIncidentEmail(
        "Timeout 30000ms exceeded\n\n![Graph](https://cdn.example.com/g.png)",
      ),
    );

    expect(Object.keys(payload).sort()).toEqual([
      "from",
      "html",
      "subject",
      "to",
    ]);
  });

  test("screenshots past what one email may carry are left out with a note, and the email still goes", async () => {
    const screenshot: (filler: number) => string = (filler: number): string => {
      return Buffer.concat([
        Buffer.from(PNG, "base64").subarray(0, 8),
        Buffer.alloc(900 * 1024, filler),
      ]).toString("base64");
    };

    const payload: CapturedSmtpMail = await deliverOverSmtp(
      await acknowledgeIncidentEmail(
        [0x41, 0x42, 0x43]
          .map((filler: number, index: number) => {
            return `![Run ${index + 1}](data:image/png;base64,${screenshot(filler)})`;
          })
          .join("\n\n"),
      ),
    );

    expect(payload.attachments).toHaveLength(2);
    expect(contentIdsIn(payload.html)).toHaveLength(2);
    expect(payload.html).toContain(
      "[Run 3: image too large to include in this email]",
    );
    expect(payload.html).not.toContain("data:image");
  });
});

describe("a screenshot in an incident description, over SendGrid", () => {
  test("goes out as an inline attachment with its Content-ID", async () => {
    jest.mocked(getEmailServerType).mockResolvedValue("Sendgrid" as never);
    jest.mocked(getSendgridConfig).mockResolvedValue({
      apiKey: "SG.test",
      fromEmail: new Email("notifications@example.test"),
      fromName: "OneUptime",
    } as never);
    jest
      .mocked(SendgridMail.send)
      .mockResolvedValue([
        { statusCode: 202, headers: {}, body: "" },
        {},
      ] as never);

    await MailService.send(
      await acknowledgeIncidentEmail(SCREENSHOT_DESCRIPTION),
    );

    expect(sendMail).not.toHaveBeenCalled();
    expect(SendgridMail.send).toHaveBeenCalledTimes(1);

    const message: {
      html: string;
      attachments?: Array<Record<string, unknown>>;
    } = jest.mocked(SendgridMail.send).mock.calls[0]![0] as never;
    const contentIds: Array<string> = contentIdsIn(message.html);

    expect(contentIds).toHaveLength(1);
    expect(message.attachments).toEqual([
      {
        content: PNG,
        filename: "image-1.png",
        type: "image/png",
        disposition: "inline",
        contentId: contentIds[0],
      },
    ]);
    expect(message.html).not.toContain("data:image");
  });

  test("an email with no inline image has no attachments", async () => {
    jest.mocked(getEmailServerType).mockResolvedValue("Sendgrid" as never);
    jest.mocked(getSendgridConfig).mockResolvedValue({
      apiKey: "SG.test",
      fromEmail: new Email("notifications@example.test"),
      fromName: "OneUptime",
    } as never);
    jest
      .mocked(SendgridMail.send)
      .mockResolvedValue([
        { statusCode: 202, headers: {}, body: "" },
        {},
      ] as never);

    await MailService.send(await acknowledgeIncidentEmail("Checkout is down."));

    const message: Record<string, unknown> = jest.mocked(SendgridMail.send).mock
      .calls[0]![0] as never;

    expect(Object.keys(message)).not.toContain("attachments");
  });
});

describe("a screenshot in an incident description, over Microsoft Graph", () => {
  test("is handed to the provider as an inline image the body points at", async () => {
    await MailService.send(
      await acknowledgeIncidentEmail(SCREENSHOT_DESCRIPTION),
      {
        emailServer: GRAPH_SERVER,
        timeout: 5000,
      },
    );

    expect(sendMail).not.toHaveBeenCalled();
    expect(graphSend).toHaveBeenCalledTimes(1);

    const [mail, server, options] = graphSend.mock.calls[0]!;
    const contentIds: Array<string> = contentIdsIn(mail.body || "");

    expect(server).toBe(GRAPH_SERVER);
    expect(contentIds).toHaveLength(1);
    expect(options?.timeoutMs).toBe(5000);
    expect(options?.inlineImages).toEqual([
      {
        contentId: contentIds[0],
        fileName: "image-1.png",
        mimeType: "image/png",
        base64: PNG,
        byteLength: Buffer.from(PNG, "base64").length,
      } as EmailInlineImage,
    ]);
    expect(mail.body).not.toContain("data:image");
  });
});

describe("previewing an email with a screenshot", () => {
  /*
   * A preview is shown in a browser, which shows a data: URL: it keeps the
   * image as written, and sending is what moves it into an attachment.
   */
  test("render() keeps the screenshot as the data: URL a browser shows", async () => {
    const rendered: RenderedEmail = await MailService.render(
      await acknowledgeIncidentEmail(SCREENSHOT_DESCRIPTION),
    );

    expect(rendered.body).toContain(
      `<img src="data:image/png;base64,${PNG}" alt="" style="max-width:100%;height:auto;">`,
    );
    expect(sendMail).not.toHaveBeenCalled();
  });
});
