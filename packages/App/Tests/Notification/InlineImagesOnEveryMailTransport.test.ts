import {
  afterAll,
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
import SendgridMail from "@sendgrid/mail";
import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import MailTransportType from "Common/Types/Email/MailTransportType";
import MailgunRegion from "Common/Types/Email/MailgunRegion";
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import MailStatus from "Common/Types/Mail/MailStatus";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import { EmailServerType } from "Common/Models/DatabaseModels/GlobalConfig";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailLogService from "Common/Server/Services/EmailLogService";
import DataSourceEgressGuard from "Common/Server/Utils/DataSource/EgressGuard";
import {
  EMAIL_LOGO_FILE_NAME,
  EMAIL_LOGO_PATH,
} from "Common/Server/Utils/Mail/EmailLogo";
import {
  getEmailServerType,
  getGlobalEmailProviderServer,
  getGlobalSMTPConfig,
  getSendgridConfig,
} from "../../FeatureSet/Notification/Config";
import MailService from "../../FeatureSet/Notification/Services/MailService";
import SMTPOAuthService from "../../FeatureSet/Notification/Services/SMTPOAuthService";
import { EMAIL_SENT_STATUS_MESSAGE } from "../../FeatureSet/Notification/Utils/EmailStatusMessage";
import "../../FeatureSet/Notification/Utils/Handlebars";
import {
  AmazonSesSendEmailJson,
  FakeAmazonSes,
  FakeMailgun,
  FakeMicrosoftGraph,
  FakePostmark,
  FakeResend,
  FakeSendGrid,
  FakeSmtpServer,
  GraphSendMailJson,
  PostmarkEmailJson,
  RecordedHttpRequest,
  ResendEmailJson,
  SendGridMailSendJson,
  contentIdsInHtml,
  mailgunMimeOf,
  sendAmazonSesTo,
  sendGridContentIdRequired,
  sendMailgunTo,
  sendMicrosoftGraphTo,
  sendPostmarkTo,
  sendResendTo,
  sendSendGridTo,
  checkAmazonSesSendEmail,
  checkPostmarkEmail,
  checkResendEmail,
  startFakeAmazonSes,
  startFakeMailgun,
  startFakeMicrosoftGraph,
  startFakePostmark,
  startFakeResend,
  startFakeSendGrid,
  startFakeSmtpServer,
} from "./Fixtures/FakeMailServices";
import {
  MimeEntity,
  allMimeEntities,
  contentIdOf,
  mimeEntitiesOfType,
  readMimeEntity,
} from "./Fixtures/MimeMessage";

/*
 * EVERY WAY ONEUPTIME SENDS EMAIL CARRIES ITS INLINE IMAGES AS ITS SERVICE
 * READS THEM.
 *
 * OneUptime's logo heads the emails it sends, as an inline image: an
 * attachment the HTML points at by Content-ID (EmailLogo). Each mail service
 * names that attachment's Content-ID in a word of its own, and SendGrid
 * refused every email with an image - from 14.0.82 nearly every email -
 * because MailService wrote the client library's typed name (contentId)
 * where SendGrid reads content_id (issue #5308). Every test of it mocked
 * the client and checked the name MailService handed it, so none could see
 * it.
 *
 * So these send real emails - a password reset, an on-call page with a
 * screenshot in it - through each transport's real client, to a stand-in for
 * its service (Fixtures/FakeMailServices) that checks a request as the
 * service does, and read what arrived as the service and a mail client
 * read it:
 *
 *   - SendGrid: @sendgrid/mail, its requests sent to a fake api.sendgrid.com
 *     - the server's shared client and a project config's own alike.
 *   - Microsoft Graph: MicrosoftGraphMailProvider, its fetch to
 *     graph.microsoft.com sent to a fake Graph.
 *   - Amazon SES: AmazonSesMailProvider, its signed SendEmail sent to a fake
 *     email.us-east-1.amazonaws.com that checks the signature.
 *   - Mailgun: MailgunMailProvider, its messages.mime sent to a fake
 *     api.mailgun.net, the MIME read as SMTP's is.
 *   - Postmark and Resend: their providers, sent to a fake
 *     api.postmarkapp.com and api.resend.com.
 *   - SMTP: nodemailer, to an SMTP server on a local port, the message read
 *     as MIME (Fixtures/MimeMessage).
 *
 * And every way the installation can send email must have its case here
 * (the last describe): a new transport cannot ship without one.
 *
 * Only infrastructure is mocked: settings, the database, logs, metrics, the
 * egress guard's answer for a project's SMTP host, and the OAuth token fetch.
 */

jest.mock("../../FeatureSet/Notification/Config", () => {
  return {
    getEmailServerType: jest.fn(),
    getGlobalEmailProviderServer: jest.fn(),
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

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
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

jest.mock("../../FeatureSet/Notification/Services/SMTPOAuthService", () => {
  return { __esModule: true, default: { getAccessToken: jest.fn() } };
});

// OneUptime's logo, as it ships: the image every email's header carries.
const LOGO: Buffer = fs.readFileSync(EMAIL_LOGO_PATH);

// A real 1x1 PNG, as the probe reports a synthetic monitor's screenshot.
const SCREENSHOT: string =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const SENDER: Email = new Email("notifications@example.test");

// The email of issue #5308: a password reset, which every user may need.
function passwordReset(): EmailMessage {
  return {
    toEmail: new Email("alice@example.test"),
    subject: "Password Reset Request for OneUptime",
    isSubjectLiteral: true,
    templateType: EmailTemplateType.ForgotPassword,
    vars: {
      homeURL: "https://oneuptime.example.test/",
      tokenVerifyUrl:
        "https://oneuptime.example.test/accounts/reset-password/token-123",
    },
  };
}

// The on-call email for an incident whose description holds a screenshot.
async function incidentWithScreenshot(): Promise<EmailMessage> {
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
        `Timeout 30000ms exceeded\n\n![Checkout page](data:image/png;base64,${SCREENSHOT})`,
        MarkdownContentType.Email,
      ),
      incidentViewLink: "https://oneuptime.example.test/incidents/12",
      acknowledgeIncidentLink:
        "https://oneuptime.example.test/api/user-on-call-log-timeline/acknowledge-page/abc",
    },
  };
}

// One inline image, as the service that took the email received it.
interface ArrivedImage {
  contentId: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  isInline: boolean;
}

// An email, as the service that took it received it.
interface ArrivedEmail {
  html: string;
  inlineImages: Array<ArrivedImage>;
}

let sendGrid: FakeSendGrid;
let graph: FakeMicrosoftGraph;
let smtp: FakeSmtpServer;
let ses: FakeAmazonSes;
let mailgun: FakeMailgun;
let postmark: FakePostmark;
let resend: FakeResend;

const SES_CREDENTIALS: {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
} = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
};

const MAILGUN_KEY: string = "key-0123456789abcdef";
const MAILGUN_DOMAIN: string = "mg.example.test";
const POSTMARK_TOKEN: string = "11111111-2222-4333-8444-555555555555";
const RESEND_KEY: string = "re_test_0123456789";

const SMTP_HOST_NAME: string = "smtp.inline-images.invalid";

function globalSmtpServer(overrides: Partial<EmailServer> = {}): EmailServer {
  return {
    host: new Hostname("127.0.0.1"),
    port: new Port(smtp.port),
    secure: false,
    username: "apikey",
    password: "smtp-password",
    fromName: "OneUptime",
    fromEmail: SENDER,
    authType: SMTPAuthenticationType.UsernamePassword,
    ...overrides,
  };
}

const GRAPH_SERVER: EmailServer = {
  id: ObjectID.generate(),
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

/*
 * A project's config of a provider with an HTTP API of its own, as
 * ProjectSmtpConfigService.toEmailServer makes it: its key alone, and the
 * sender. Without an id, it is the server's own settings for it, as
 * getGlobalEmailProviderServer makes them.
 */
function apiProviderServer(
  transportType: MailTransportType,
  options: { isProjectConfig: boolean },
): EmailServer {
  const base: EmailServer = {
    ...(options.isProjectConfig ? { id: ObjectID.generate() } : {}),
    transportType: transportType,
    username: undefined,
    password: undefined,
    fromEmail: SENDER,
    fromName: "OneUptime Alerts",
  };

  switch (transportType) {
    case MailTransportType.AmazonSES:
      return {
        ...base,
        awsAccessKeyId: SES_CREDENTIALS.accessKeyId,
        awsSecretAccessKey: SES_CREDENTIALS.secretAccessKey,
        awsRegion: SES_CREDENTIALS.region,
      };
    case MailTransportType.Mailgun:
      return {
        ...base,
        apiKey: MAILGUN_KEY,
        mailgunDomain: MAILGUN_DOMAIN,
        mailgunRegion: MailgunRegion.US,
      };
    case MailTransportType.Postmark:
      return { ...base, apiKey: POSTMARK_TOKEN };
    case MailTransportType.Resend:
      return { ...base, apiKey: RESEND_KEY };
    case MailTransportType.SendGrid:
      return { ...base, apiKey: "SG.project-key" };
    default:
      throw new Error(`${transportType} has no HTTP API of its own`);
  }
}

function lastRequest(fake: {
  requests: Array<RecordedHttpRequest>;
}): RecordedHttpRequest {
  expect(fake.requests.length).toBeGreaterThan(0);
  return fake.requests[fake.requests.length - 1]!;
}

function arrivedOverSendGrid(): ArrivedEmail {
  const json: SendGridMailSendJson = lastRequest(sendGrid)
    .json as SendGridMailSendJson;
  const html: { type: string; value: string } | undefined = json.content.find(
    (block: { type: string; value: string }): boolean => {
      return block.type === "text/html";
    },
  );

  return {
    html: html?.value || "",
    inlineImages: (json.attachments || []).map(
      (attachment: Record<string, unknown>): ArrivedImage => {
        return {
          contentId: String(attachment["content_id"]),
          fileName: String(attachment["filename"]),
          mimeType: String(attachment["type"]),
          bytes: Buffer.from(String(attachment["content"]), "base64"),
          isInline: attachment["disposition"] === "inline",
        };
      },
    ),
  };
}

function arrivedOverMicrosoftGraph(): ArrivedEmail {
  const json: GraphSendMailJson = lastRequest(graph).json as GraphSendMailJson;

  return {
    html: json.message.body.content,
    inlineImages: (json.message.attachments || []).map(
      (attachment: Record<string, unknown>): ArrivedImage => {
        return {
          contentId: String(attachment["contentId"]),
          fileName: String(attachment["name"]),
          mimeType: String(attachment["contentType"]),
          bytes: Buffer.from(String(attachment["contentBytes"]), "base64"),
          isInline: attachment["isInline"] === true,
        };
      },
    ),
  };
}

function arrivedOverAmazonSes(): ArrivedEmail {
  const json: AmazonSesSendEmailJson = lastRequest(ses)
    .json as AmazonSesSendEmailJson;

  return {
    html: json.Content.Simple.Body.Html?.Data || "",
    inlineImages: (json.Content.Simple.Attachments || []).map(
      (attachment: Record<string, unknown>): ArrivedImage => {
        return {
          contentId: String(attachment["ContentId"]),
          fileName: String(attachment["FileName"]),
          mimeType: String(attachment["ContentType"]),
          bytes: Buffer.from(String(attachment["RawContent"]), "base64"),
          isInline: attachment["ContentDisposition"] === "INLINE",
        };
      },
    ),
  };
}

function arrivedOverPostmark(): ArrivedEmail {
  const json: PostmarkEmailJson = lastRequest(postmark)
    .json as PostmarkEmailJson;

  return {
    html: json.HtmlBody,
    inlineImages: (json.Attachments || []).map(
      (attachment: Record<string, unknown>): ArrivedImage => {
        const contentId: string = String(attachment["ContentID"] || "");

        return {
          // Postmark's ContentID is written "cid:" and the id.
          contentId: contentId.startsWith("cid:")
            ? contentId.slice("cid:".length)
            : contentId,
          fileName: String(attachment["Name"]),
          mimeType: String(attachment["ContentType"]),
          bytes: Buffer.from(String(attachment["Content"]), "base64"),
          isInline: contentId.length > 0,
        };
      },
    ),
  };
}

function arrivedOverResend(): ArrivedEmail {
  const json: ResendEmailJson = lastRequest(resend).json as ResendEmailJson;

  return {
    html: json.html || "",
    inlineImages: (json.attachments || []).map(
      (attachment: Record<string, unknown>): ArrivedImage => {
        return {
          contentId: String(attachment["content_id"]),
          fileName: String(attachment["filename"]),
          mimeType: String(attachment["content_type"]),
          bytes: Buffer.from(String(attachment["content"]), "base64"),
          isInline: typeof attachment["content_id"] === "string",
        };
      },
    ),
  };
}

// A MIME message as a mail client reads it: the HTML, and its inline images.
function arrivedAsMime(data: string): ArrivedEmail {
  const message: MimeEntity = readMimeEntity(data);
  const html: MimeEntity | undefined = mimeEntitiesOfType(
    message,
    "text/html",
  )[0];

  return {
    html: html ? html.body.toString("utf8") : "",
    inlineImages: allMimeEntities(message)
      .filter((part: MimeEntity): boolean => {
        return part.type.startsWith("image/");
      })
      .map((part: MimeEntity): ArrivedImage => {
        return {
          contentId: contentIdOf(part) || "",
          fileName: part.parameters.get("name") || "",
          mimeType: part.type,
          bytes: part.body,
          isInline: (part.headers.get("content-disposition") || "").startsWith(
            "inline",
          ),
        };
      }),
  };
}

function arrivedOverSmtp(): ArrivedEmail {
  expect(smtp.messages.length).toBeGreaterThan(0);

  return arrivedAsMime(smtp.messages[smtp.messages.length - 1]!.data);
}

function arrivedOverMailgun(): ArrivedEmail {
  return arrivedAsMime(mailgunMimeOf(lastRequest(mailgun)));
}

/*
 * Each way the installation sends email: how it is set up, and what the
 * service received. Keyed by what an operator or a project picks - the
 * instance's Email Server Type, or an SMTP config's Transport.
 */
interface TransportCase {
  name: string;
  send: (mail: EmailMessage) => Promise<ArrivedEmail>;
}

/*
 * What a case is keyed by: the Email Server Type an operator picks for the
 * server's own email, or the Transport a project's config (or the server's
 * Custom SMTP settings) sends through. Amazon SES is both, by one name.
 */
const serverTypeCase: (serverType: EmailServerType) => string = (
  serverType: EmailServerType,
): string => {
  return `Email Server Type: ${serverType}`;
};

const transportCase: (transport: MailTransportType) => string = (
  transport: MailTransportType,
): string => {
  return `Transport: ${transport}`;
};

// The server's own settings for a provider with an HTTP API of its own.
const globalProviderCase: (
  serverType: EmailServerType,
  transport: MailTransportType,
  arrived: () => ArrivedEmail,
) => TransportCase = (
  serverType: EmailServerType,
  transport: MailTransportType,
  arrived: () => ArrivedEmail,
): TransportCase => {
  return {
    name: `${transport}'s API (Email Server Type: ${serverType})`,
    send: async (mail: EmailMessage): Promise<ArrivedEmail> => {
      jest.mocked(getEmailServerType).mockResolvedValue(serverType);
      jest
        .mocked(getGlobalEmailProviderServer)
        .mockResolvedValue(
          apiProviderServer(transport, { isProjectConfig: false }),
        );

      await MailService.send(mail);

      return arrived();
    },
  };
};

// A project's config of a provider with an HTTP API of its own.
const projectProviderCase: (
  transport: MailTransportType,
  arrived: () => ArrivedEmail,
) => TransportCase = (
  transport: MailTransportType,
  arrived: () => ArrivedEmail,
): TransportCase => {
  return {
    name: `${transport}'s API (Transport: ${transport})`,
    send: async (mail: EmailMessage): Promise<ArrivedEmail> => {
      await MailService.send(mail, {
        emailServer: apiProviderServer(transport, { isProjectConfig: true }),
        projectId: ObjectID.generate(),
      });

      return arrived();
    },
  };
};

const TRANSPORT_CASES: Record<string, TransportCase> = {
  [serverTypeCase(EmailServerType.Sendgrid)]: {
    name: "SendGrid's API (Email Server Type: SendGrid)",
    send: async (mail: EmailMessage): Promise<ArrivedEmail> => {
      jest
        .mocked(getEmailServerType)
        .mockResolvedValue(EmailServerType.Sendgrid);
      jest.mocked(getSendgridConfig).mockResolvedValue({
        apiKey: "SG.test-key",
        fromEmail: SENDER,
        fromName: "OneUptime",
      });

      await MailService.send(mail);

      return arrivedOverSendGrid();
    },
  },
  [transportCase(MailTransportType.SMTP)]: {
    name: "an SMTP server (Transport: SMTP)",
    send: async (mail: EmailMessage): Promise<ArrivedEmail> => {
      jest
        .mocked(getEmailServerType)
        .mockResolvedValue(EmailServerType.CustomSMTP);
      jest.mocked(getGlobalSMTPConfig).mockResolvedValue(globalSmtpServer());

      await MailService.send(mail);

      return arrivedOverSmtp();
    },
  },
  [transportCase(MailTransportType.MicrosoftGraph)]: {
    name: "Microsoft Graph (Transport: Microsoft Graph)",
    send: async (mail: EmailMessage): Promise<ArrivedEmail> => {
      await MailService.send(mail, {
        emailServer: GRAPH_SERVER,
        projectId: ObjectID.generate(),
      });

      return arrivedOverMicrosoftGraph();
    },
  },
  [serverTypeCase(EmailServerType.AmazonSES)]: globalProviderCase(
    EmailServerType.AmazonSES,
    MailTransportType.AmazonSES,
    arrivedOverAmazonSes,
  ),
  [serverTypeCase(EmailServerType.Mailgun)]: globalProviderCase(
    EmailServerType.Mailgun,
    MailTransportType.Mailgun,
    arrivedOverMailgun,
  ),
  [serverTypeCase(EmailServerType.Postmark)]: globalProviderCase(
    EmailServerType.Postmark,
    MailTransportType.Postmark,
    arrivedOverPostmark,
  ),
  [serverTypeCase(EmailServerType.Resend)]: globalProviderCase(
    EmailServerType.Resend,
    MailTransportType.Resend,
    arrivedOverResend,
  ),
  [transportCase(MailTransportType.AmazonSES)]: projectProviderCase(
    MailTransportType.AmazonSES,
    arrivedOverAmazonSes,
  ),
  [transportCase(MailTransportType.SendGrid)]: projectProviderCase(
    MailTransportType.SendGrid,
    arrivedOverSendGrid,
  ),
  [transportCase(MailTransportType.Mailgun)]: projectProviderCase(
    MailTransportType.Mailgun,
    arrivedOverMailgun,
  ),
  [transportCase(MailTransportType.Postmark)]: projectProviderCase(
    MailTransportType.Postmark,
    arrivedOverPostmark,
  ),
  [transportCase(MailTransportType.Resend)]: projectProviderCase(
    MailTransportType.Resend,
    arrivedOverResend,
  ),
};

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

  sendGrid = await startFakeSendGrid();
  graph = await startFakeMicrosoftGraph();
  smtp = await startFakeSmtpServer();
  ses = await startFakeAmazonSes(SES_CREDENTIALS);
  mailgun = await startFakeMailgun({
    apiKey: MAILGUN_KEY,
    domains: [MAILGUN_DOMAIN],
  });
  postmark = await startFakePostmark(POSTMARK_TOKEN);
  resend = await startFakeResend(RESEND_KEY);
});

afterAll(async () => {
  await sendGrid.close();
  await graph.close();
  await smtp.close();
  await ses.close();
  await mailgun.close();
  await postmark.close();
  await resend.close();
});

beforeEach(() => {
  jest.clearAllMocks();
  sendGrid.requests.length = 0;
  graph.requests.length = 0;
  smtp.messages.length = 0;
  smtp.commands.length = 0;
  ses.requests.length = 0;
  mailgun.requests.length = 0;
  postmark.requests.length = 0;
  resend.requests.length = 0;
  sendSendGridTo(sendGrid);
  sendMicrosoftGraphTo(graph);
  sendAmazonSesTo(ses);
  sendMailgunTo(mailgun);
  sendPostmarkTo(postmark);
  sendResendTo(resend);
  jest.mocked(SMTPOAuthService.getAccessToken).mockResolvedValue("token-123");
});

afterEach(async () => {
  jest.restoreAllMocks();
  await MailService.cleanup();
});

describe.each(Object.values(TRANSPORT_CASES))(
  "$name",
  (transport: TransportCase) => {
    test("a password reset goes, with OneUptime's logo as an inline image its HTML points at", async () => {
      const arrived: ArrivedEmail = await transport.send(passwordReset());
      const contentIds: Array<string> = contentIdsInHtml(arrived.html);

      expect(contentIds).toHaveLength(1);
      expect(arrived.inlineImages).toEqual([
        {
          contentId: contentIds[0],
          fileName: EMAIL_LOGO_FILE_NAME,
          mimeType: "image/png",
          bytes: LOGO,
          isInline: true,
        },
      ]);
      // The image itself, never its data: URL, which Gmail and Outlook hide.
      expect(arrived.html).not.toContain("data:image");
      expect(arrived.html).toContain("Password");
    });

    test("an on-call page with a screenshot: the logo, then the screenshot, each where the HTML points", async () => {
      const arrived: ArrivedEmail = await transport.send(
        await incidentWithScreenshot(),
      );
      const contentIds: Array<string> = contentIdsInHtml(arrived.html);

      expect(contentIds).toHaveLength(2);
      expect(new Set(contentIds).size).toBe(2);
      expect(
        arrived.inlineImages.map((image: ArrivedImage) => {
          return [
            image.contentId,
            image.fileName,
            image.mimeType,
            image.isInline,
          ];
        }),
      ).toEqual([
        [contentIds[0], EMAIL_LOGO_FILE_NAME, "image/png", true],
        [contentIds[1], "image-1.png", "image/png", true],
      ]);
      expect(arrived.inlineImages[1]!.bytes.toString("base64")).toBe(
        SCREENSHOT,
      );
      expect(arrived.html).toContain(
        `<img src="cid:${contentIds[1]}" alt="Checkout page"`,
      );
    });

    test("each email's images have Content-IDs of their own", async () => {
      const first: ArrivedEmail = await transport.send(passwordReset());
      const second: ArrivedEmail = await transport.send(passwordReset());

      expect(first.inlineImages[0]!.contentId).not.toBe(
        second.inlineImages[0]!.contentId,
      );
    });
  },
);

describe("SendGrid: what reaches api.sendgrid.com", () => {
  test("the Mail Send SendGrid takes: content_id beside filename, type and an inline disposition - and no contentId", async () => {
    await TRANSPORT_CASES[serverTypeCase(EmailServerType.Sendgrid)]!.send(
      passwordReset(),
    );

    expect(sendGrid.requests).toHaveLength(1);

    const request: RecordedHttpRequest = sendGrid.requests[0]!;
    const json: SendGridMailSendJson = request.json as SendGridMailSendJson;
    const contentId: string = contentIdsInHtml(json.content[1]!.value)[0]!;

    expect(request.method).toBe("POST");
    expect(request.path).toBe("/v3/mail/send");
    expect(request.headers.authorization).toBe("Bearer SG.test-key");
    expect(json.attachments).toEqual([
      {
        content: LOGO.toString("base64"),
        filename: EMAIL_LOGO_FILE_NAME,
        type: "image/png",
        disposition: "inline",
        content_id: contentId,
      },
    ]);
    expect(Object.keys(json.attachments![0]!)).not.toContain("contentId");
  });

  test("the message itself: to, from with its name, the subject, then the text before the HTML", async () => {
    await TRANSPORT_CASES[serverTypeCase(EmailServerType.Sendgrid)]!.send(
      passwordReset(),
    );

    const json: SendGridMailSendJson = lastRequest(sendGrid)
      .json as SendGridMailSendJson;

    expect(json.personalizations).toEqual([
      { to: [{ email: "alice@example.test" }] },
    ]);
    expect(json.from).toEqual({
      email: "notifications@example.test",
      name: "OneUptime",
    });
    expect(json.subject).toBe("Password Reset Request for OneUptime");
    expect(
      json.content.map((block: { type: string }): string => {
        return block.type;
      }),
    ).toEqual(["text/plain", "text/html"]);
    expect(json.content[0]!.value).toContain("Password");
  });

  test("an email whose HTML holds no words goes as HTML alone: SendGrid refuses an empty text part", async () => {
    jest.mocked(getEmailServerType).mockResolvedValue(EmailServerType.Sendgrid);
    jest.mocked(getSendgridConfig).mockResolvedValue({
      apiKey: "SG.test-key",
      fromEmail: SENDER,
      fromName: "OneUptime",
    });

    await MailService.send({
      toEmail: new Email("alice@example.test"),
      subject: "A blank page",
      isSubjectLiteral: true,
      vars: {},
      body: "<p></p>",
    });

    expect(sendGrid.requests).toHaveLength(1);
    expect(
      (lastRequest(sendGrid).json as SendGridMailSendJson).content,
    ).toEqual([{ type: "text/html", value: "<p></p>" }]);
  });

  test("a project's email log says it went", async () => {
    jest.mocked(getEmailServerType).mockResolvedValue(EmailServerType.Sendgrid);
    jest.mocked(getSendgridConfig).mockResolvedValue({
      apiKey: "SG.test-key",
      fromEmail: SENDER,
      fromName: "OneUptime",
    });

    await MailService.send(
      {
        toEmail: new Email("alice@example.test"),
        templateType: EmailTemplateType.VerificationCode,
        vars: { code: "482913", subject: "Verify this email address" },
        subject: "Verify this email address",
        isSubjectLiteral: true,
      },
      { projectId: ObjectID.generate() },
    );

    expect(EmailLogService.create).toHaveBeenCalledTimes(1);

    const log: { status?: string; statusMessage?: string } = jest.mocked(
      EmailLogService.create,
    ).mock.calls[0]![0].data as never;

    expect(log.status).toBe(MailStatus.Success);
    expect(log.statusMessage).toBe(EMAIL_SENT_STATUS_MESSAGE);
    expect(arrivedOverSendGrid().inlineImages).toHaveLength(1);
  });

  /*
   * Why InlineImageAttachments writes SendGrid's own name: the client sends
   * a plain attachment's fields exactly as they are written, so the name its
   * typings offer, contentId, reaches SendGrid unread - and SendGrid refuses
   * the email, as the stand-in does.
   */
  test("the client OneUptime ships passes an attachment's fields through as written: contentId is refused", async () => {
    SendgridMail.setApiKey("SG.test-key");

    let refusal: unknown = undefined;

    try {
      await SendgridMail.send({
        to: "alice@example.test",
        from: "OneUptime <notifications@example.test>",
        subject: "Logo",
        html: '<img src="cid:logo@oneuptime" alt="OneUptime">',
        attachments: [
          {
            content: LOGO.toString("base64"),
            filename: EMAIL_LOGO_FILE_NAME,
            type: "image/png",
            disposition: "inline",
            contentId: "logo@oneuptime",
          },
        ],
      });
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toMatchObject({
      code: 400,
      message: "Bad Request",
      response: { body: { errors: [sendGridContentIdRequired(0)] } },
    });

    const sent: Record<string, unknown> = (
      lastRequest(sendGrid).json as SendGridMailSendJson
    ).attachments![0]!;

    expect(sent["contentId"]).toBe("logo@oneuptime");
    expect(sent["content_id"]).toBeUndefined();
  });
});

describe("Microsoft Graph: what reaches graph.microsoft.com", () => {
  test("a sendMail as the sender, the logo a fileAttachment Graph defines: contentId and isInline", async () => {
    await TRANSPORT_CASES[
      transportCase(MailTransportType.MicrosoftGraph)
    ]!.send(passwordReset());

    expect(graph.requests).toHaveLength(1);

    const request: RecordedHttpRequest = graph.requests[0]!;
    const json: GraphSendMailJson = request.json as GraphSendMailJson;

    expect(request.method).toBe("POST");
    expect(request.path).toBe("/v1.0/users/sender%40contoso.com/sendMail");
    expect(request.headers.authorization).toBe("Bearer token-123");
    expect(json.message.body.contentType).toBe("HTML");
    expect(json.message.attachments).toEqual([
      {
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: EMAIL_LOGO_FILE_NAME,
        contentType: "image/png",
        contentBytes: LOGO.toString("base64"),
        contentId: contentIdsInHtml(json.message.body.content)[0],
        isInline: true,
      },
    ]);
  });

  test("the installation's own settings with Transport set to Microsoft Graph send the same way", async () => {
    jest
      .mocked(getEmailServerType)
      .mockResolvedValue(EmailServerType.CustomSMTP);
    jest.mocked(getGlobalSMTPConfig).mockResolvedValue({
      ...GRAPH_SERVER,
      id: undefined,
    });

    await MailService.send(passwordReset());

    expect(arrivedOverMicrosoftGraph().inlineImages).toHaveLength(1);
    expect(smtp.messages).toHaveLength(0);
    expect(sendGrid.requests).toHaveLength(0);
  });
});

describe("SMTP: the message nodemailer writes", () => {
  test("multipart/alternative: the text, then the HTML related to its logo, an inline part named by Content-ID", async () => {
    await TRANSPORT_CASES[transportCase(MailTransportType.SMTP)]!.send(
      passwordReset(),
    );

    expect(smtp.messages).toHaveLength(1);
    expect(smtp.messages[0]!.recipients).toEqual(["<alice@example.test>"]);

    const message: MimeEntity = readMimeEntity(smtp.messages[0]!.data);

    expect(message.type).toBe("multipart/alternative");
    expect(
      message.parts.map((part: MimeEntity): string => {
        return part.type;
      }),
    ).toEqual(["text/plain", "multipart/related"]);

    const related: MimeEntity = message.parts[1]!;

    expect(related.parameters.get("type")).toBe("text/html");
    expect(
      related.parts.map((part: MimeEntity): string => {
        return part.type;
      }),
    ).toEqual(["text/html", "image/png"]);

    const [html, logo] = related.parts as [MimeEntity, MimeEntity];

    expect(contentIdOf(logo)).toBe(
      contentIdsInHtml(html.body.toString("utf8"))[0],
    );
    expect(logo.headers.get("content-disposition")).toBe(
      `inline; filename=${EMAIL_LOGO_FILE_NAME}`,
    );
    expect(logo.headers.get("content-transfer-encoding")).toBe("base64");
    expect(logo.body.equals(LOGO)).toBe(true);
  });

  test("a project's own SMTP server, dialed at the address the egress guard approved, gets the same message", async () => {
    /*
     * The guard "resolves" the project's host to the local server: loopback
     * is the only address a test can listen on, and the real policy rightly
     * refuses it (SmtpServerPinning tests the policy itself).
     */
    jest
      .spyOn(DataSourceEgressGuard, "assertHostnameAllowed")
      .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);

    await MailService.send(passwordReset(), {
      emailServer: globalSmtpServer({
        id: ObjectID.generate(),
        host: new Hostname(SMTP_HOST_NAME),
      }),
      projectId: ObjectID.generate(),
    });

    expect(DataSourceEgressGuard.assertHostnameAllowed).toHaveBeenCalled();

    const arrived: ArrivedEmail = arrivedOverSmtp();

    expect(arrived.inlineImages).toHaveLength(1);
    expect(arrived.inlineImages[0]!.contentId).toBe(
      contentIdsInHtml(arrived.html)[0],
    );
  });

  test("SMTP signing in with OAuth (XOAUTH2) sends the same message", async () => {
    await MailService.send(passwordReset(), {
      emailServer: globalSmtpServer({
        username: "sender@contoso.com",
        password: undefined,
        authType: SMTPAuthenticationType.OAuth,
        clientId: "client-id",
        clientSecret: "client-secret",
        tokenUrl: URL.fromString(
          "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
        ),
        scope: "https://outlook.office365.com/.default",
        oauthProviderType: OAuthProviderType.ClientCredentials,
      }),
    });

    expect(
      smtp.commands.some((command: string): boolean => {
        return command.startsWith("AUTH XOAUTH2");
      }),
    ).toBe(true);

    const arrived: ArrivedEmail = arrivedOverSmtp();

    expect(arrived.inlineImages).toHaveLength(1);
    expect(arrived.inlineImages[0]!.bytes.equals(LOGO)).toBe(true);
  });
});

describe("the stand-ins refuse what their services refuse", () => {
  test("SendGrid: an inline attachment without content_id, with SendGrid's own answer", async () => {
    const response: Response = await fetch(`${sendGrid.url}/v3/mail/send`, {
      method: "POST",
      headers: {
        Authorization: "Bearer SG.test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: "alice@example.test" }] }],
        from: { email: "notifications@example.test" },
        subject: "Logo",
        content: [{ type: "text/html", value: "<p>Hi</p>" }],
        attachments: [
          {
            content: LOGO.toString("base64"),
            filename: EMAIL_LOGO_FILE_NAME,
            type: "image/png",
            disposition: "inline",
          },
        ],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      errors: [sendGridContentIdRequired(0)],
    });
  });

  test("Microsoft Graph: a fileAttachment property Graph does not define", async () => {
    const response: Response = await fetch(
      `${graph.url}/v1.0/users/sender%40contoso.com/sendMail`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token-123",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            subject: "Logo",
            body: { contentType: "HTML", content: "<p>Hi</p>" },
            toRecipients: [{ emailAddress: { address: "alice@example.test" } }],
            attachments: [
              {
                "@odata.type": "#microsoft.graph.fileAttachment",
                name: EMAIL_LOGO_FILE_NAME,
                contentType: "image/png",
                contentBytes: LOGO.toString("base64"),
                content_id: "logo@oneuptime",
                isInline: true,
              },
            ],
          },
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "RequestBodyRead",
        message:
          "The property 'content_id' does not exist on type 'microsoft.graph.fileAttachment'. Make sure to only use property names that are defined by the type or mark the type as open type.",
      },
    });
  });
});

describe("Amazon SES: what reaches email.us-east-1.amazonaws.com", () => {
  test("a SendEmail signed for ses in its Region, the logo an INLINE attachment by its ContentId", async () => {
    await TRANSPORT_CASES[transportCase(MailTransportType.AmazonSES)]!.send(
      passwordReset(),
    );

    expect(ses.requests).toHaveLength(1);

    const request: RecordedHttpRequest = ses.requests[0]!;
    const json: AmazonSesSendEmailJson = request.json as AmazonSesSendEmailJson;
    const html: string = json.Content.Simple.Body.Html!.Data;

    expect(request.method).toBe("POST");
    expect(request.path).toBe("/v2/email/outbound-emails");
    // The stand-in took the signature, so it is SES's for this body and host.
    expect(String(request.headers.authorization)).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/\d{8}\/us-east-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(json.FromEmailAddress).toBe(
      "OneUptime Alerts <notifications@example.test>",
    );
    expect(json.Destination).toEqual({ ToAddresses: ["alice@example.test"] });
    expect(json.Content.Simple.Subject).toEqual({
      Data: "Password Reset Request for OneUptime",
      Charset: "UTF-8",
    });
    expect(json.Content.Simple.Body.Html!.Charset).toBe("UTF-8");
    expect(json.Content.Simple.Body.Text!.Data).toContain("Password");
    expect(json.Content.Simple.Attachments).toEqual([
      {
        FileName: EMAIL_LOGO_FILE_NAME,
        RawContent: LOGO.toString("base64"),
        ContentDisposition: "INLINE",
        ContentId: contentIdsInHtml(html)[0],
        ContentTransferEncoding: "BASE64",
        ContentType: "image/png",
      },
    ]);
  });

  test("the server's own Amazon SES settings send the same way, from their own sender", async () => {
    await TRANSPORT_CASES[serverTypeCase(EmailServerType.AmazonSES)]!.send(
      passwordReset(),
    );

    expect(arrivedOverAmazonSes().inlineImages).toHaveLength(1);
    expect(smtp.messages).toHaveLength(0);
    expect(sendGrid.requests).toHaveLength(0);
    expect(getGlobalEmailProviderServer).toHaveBeenCalledWith(
      MailTransportType.AmazonSES,
    );
  });
});

describe("Mailgun: what reaches api.mailgun.net", () => {
  test("a messages.mime for the domain, signed in as api, carrying the MIME SMTP sends", async () => {
    await TRANSPORT_CASES[transportCase(MailTransportType.Mailgun)]!.send(
      passwordReset(),
    );

    const request: RecordedHttpRequest = lastRequest(mailgun);

    expect(request.method).toBe("POST");
    expect(request.path).toBe("/v3/mg.example.test/messages.mime");
    expect(request.headers.authorization).toBe(
      `Basic ${Buffer.from(`api:${MAILGUN_KEY}`).toString("base64")}`,
    );
    expect(request.form?.get("to")).toBe("alice@example.test");

    const message: MimeEntity = readMimeEntity(mailgunMimeOf(request));

    expect(message.headers.get("from")).toBe(
      "OneUptime Alerts <notifications@example.test>",
    );
    expect(message.headers.get("to")).toBe("alice@example.test");
    expect(message.type).toBe("multipart/alternative");
    expect(mimeEntitiesOfType(message, "text/plain")).toHaveLength(1);
    expect(mimeEntitiesOfType(message, "multipart/related")).toHaveLength(1);
  });

  test("a domain the account does not have is refused with Mailgun's 404, read as the region to check", async () => {
    await expect(
      MailService.send(passwordReset(), {
        emailServer: {
          ...apiProviderServer(MailTransportType.Mailgun, {
            isProjectConfig: true,
          }),
          mailgunDomain: "mg.unknown.test",
        },
        projectId: ObjectID.generate(),
      }),
    ).rejects.toThrow(
      "Mailgun has no domain mg.unknown.test in its US region (HTTP 404). Check the Mailgun Domain, and set the Mailgun Region to EU if the domain was made there. Mailgun said: Domain not found",
    );
  });
});

describe("Postmark: what reaches api.postmarkapp.com", () => {
  test("the server token and JSON headers Postmark asks for; the logo an attachment whose ContentID is cid: and its id", async () => {
    await TRANSPORT_CASES[transportCase(MailTransportType.Postmark)]!.send(
      passwordReset(),
    );

    const request: RecordedHttpRequest = lastRequest(postmark);
    const json: PostmarkEmailJson = request.json as PostmarkEmailJson;

    expect(request.path).toBe("/email");
    expect(request.headers["x-postmark-server-token"]).toBe(POSTMARK_TOKEN);
    expect(request.headers.accept).toBe("application/json");
    expect(json.From).toBe("OneUptime Alerts <notifications@example.test>");
    expect(json.To).toBe("alice@example.test");
    expect(json.Subject).toBe("Password Reset Request for OneUptime");
    expect(json.TextBody).toContain("Password");
    expect(json.Attachments).toEqual([
      {
        Name: EMAIL_LOGO_FILE_NAME,
        Content: LOGO.toString("base64"),
        ContentType: "image/png",
        ContentID: `cid:${contentIdsInHtml(json.HtmlBody)[0]}`,
      },
    ]);
  });
});

describe("Resend: what reaches api.resend.com", () => {
  test("the key as a bearer token, a User-Agent and one Idempotency-Key; the logo an attachment by its content_id", async () => {
    await TRANSPORT_CASES[transportCase(MailTransportType.Resend)]!.send(
      passwordReset(),
    );

    const request: RecordedHttpRequest = lastRequest(resend);
    const json: ResendEmailJson = request.json as ResendEmailJson;

    expect(request.path).toBe("/emails");
    expect(request.headers.authorization).toBe(`Bearer ${RESEND_KEY}`);
    expect(request.headers["user-agent"]).toBe("OneUptime Mail");
    expect(String(request.headers["idempotency-key"])).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(json.from).toBe("OneUptime Alerts <notifications@example.test>");
    expect(json.to).toEqual(["alice@example.test"]);
    expect(json.text).toContain("Password");
    expect(json.attachments).toEqual([
      {
        content: LOGO.toString("base64"),
        filename: EMAIL_LOGO_FILE_NAME,
        content_type: "image/png",
        content_id: contentIdsInHtml(json.html || "")[0],
      },
    ]);
  });
});

describe("a project's SendGrid config: its own client", () => {
  test("sends with its own key to api.sendgrid.com, not the server's", async () => {
    await TRANSPORT_CASES[transportCase(MailTransportType.SendGrid)]!.send(
      passwordReset(),
    );

    const request: RecordedHttpRequest = lastRequest(sendGrid);

    expect(request.headers.authorization).toBe("Bearer SG.project-key");
    expect(getSendgridConfig).not.toHaveBeenCalled();
  });
});

describe("the stand-ins refuse what their HTTP APIs refuse", () => {
  test("Amazon SES: a request signed with a secret that is not the key's", async () => {
    await expect(
      MailService.send(passwordReset(), {
        emailServer: {
          ...apiProviderServer(MailTransportType.AmazonSES, {
            isProjectConfig: true,
          }),
          awsSecretAccessKey: "not-the-secret-of-this-access-key",
        },
        projectId: ObjectID.generate(),
      }),
    ).rejects.toThrow(
      "Amazon SES did not accept the request's signature (HTTP 403 SignatureDoesNotMatch).",
    );
  });

  test("Amazon SES: an inline attachment's ContentId over 78 characters", () => {
    expect(
      checkAmazonSesSendEmail({
        FromEmailAddress: "a@example.test",
        Destination: { ToAddresses: ["b@example.test"] },
        Content: {
          Simple: {
            Subject: { Data: "Hi" },
            Body: { Html: { Data: "<p>Hi</p>" } },
            Attachments: [
              {
                FileName: "a.png",
                RawContent: SCREENSHOT,
                ContentDisposition: "INLINE",
                ContentId: "x".repeat(79),
              },
            ],
          },
        },
      })?.status,
    ).toBe(400);
  });

  test("Postmark: an inline image's ContentID without cid:", () => {
    expect(
      checkPostmarkEmail({
        From: "a@example.test",
        To: "b@example.test",
        HtmlBody: "<p>Hi</p>",
        Attachments: [
          {
            Name: "a.png",
            Content: SCREENSHOT,
            ContentType: "image/png",
            ContentID: "logo@oneuptime",
          },
        ],
      })?.status,
    ).toBe(422);
  });

  test("Resend: a content_id of 128 characters or more", () => {
    expect(
      checkResendEmail({
        from: "a@example.test",
        to: ["b@example.test"],
        subject: "Hi",
        html: "<p>Hi</p>",
        attachments: [
          {
            content: SCREENSHOT,
            filename: "a.png",
            content_id: "x".repeat(128),
          },
        ],
      })?.status,
    ).toBe(422);
  });
});

describe("every way the installation sends email has a case here", () => {
  /*
   * What an operator or a project can pick: every Email Server Type but
   * "Custom SMTP" (which sends through the instance's SMTP settings, and so
   * through a Transport), and every Transport. A new one sends no email
   * through MailService until its case above shows its inline images
   * arrive as its service reads them.
   */
  test("each Email Server Type and each Transport", () => {
    const transports: Array<string> = [
      ...Object.values(EmailServerType)
        .filter((type: EmailServerType): boolean => {
          return type !== EmailServerType.CustomSMTP;
        })
        .map(serverTypeCase),
      ...Object.values(MailTransportType).map(transportCase),
    ];

    expect(Object.keys(TRANSPORT_CASES).sort()).toEqual([...transports].sort());
  });
});
