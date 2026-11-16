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
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import { EmailServerType } from "Common/Models/DatabaseModels/GlobalConfig";
import {
  getEmailServerType,
  getGlobalEmailProviderServer,
  getGlobalSMTPConfig,
  getSendgridConfig,
} from "../../FeatureSet/Notification/Config";
import MailService from "../../FeatureSet/Notification/Services/MailService";
import SMTPOAuthService from "../../FeatureSet/Notification/Services/SMTPOAuthService";
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
  mailgunMimeOf,
  sendAmazonSesTo,
  sendMailgunTo,
  sendMicrosoftGraphTo,
  sendPostmarkTo,
  sendResendTo,
  sendSendGridTo,
  startFakeAmazonSes,
  startFakeMailgun,
  startFakeMicrosoftGraph,
  startFakePostmark,
  startFakeResend,
  startFakeSendGrid,
  startFakeSmtpServer,
} from "./Fixtures/FakeMailServices";
import { MimeEntity, readMimeEntity } from "./Fixtures/MimeMessage";

/*
 * EVERY WAY ONEUPTIME SENDS EMAIL COPIES WHOM IT IS ASKED TO, AND SENDS A
 * REPLY WHERE IT IS ASKED TO (issue #8893).
 *
 * Give Feedback is emailed to the team that reads it (support@oneuptime.com
 * on OneUptime Cloud, a self-hosted server's admins), copies the person who
 * wrote it (Cc), and asks that a reply go to them (Reply-To): the team's
 * answer reaches the person, not the server's no-reply address. Every
 * transport names these in words of its own, and a transport that dropped
 * them would leave the person with no copy and the team with nobody to
 * answer, with no error anywhere.
 *
 * So, as InlineImagesOnEveryMailTransport does for images, these send real
 * emails through each transport's real client, to a stand-in for its
 * service (Fixtures/FakeMailServices) that checks the fields as the service
 * does, and read who the service was told to send to:
 *
 *   - SendGrid: personalizations[0].to and .cc, and reply_to - the server's
 *     shared client and a project config's own alike;
 *   - Microsoft Graph: toRecipients, ccRecipients and replyTo;
 *   - Amazon SES: Destination.ToAddresses and .CcAddresses, ReplyToAddresses;
 *   - Mailgun: the form's `to` (every mailbox it delivers to) and the MIME's
 *     To, Cc and Reply-To;
 *   - Postmark: To, Cc and ReplyTo; Resend: to, cc and reply_to;
 *   - SMTP: the envelope (RCPT TO) and the message's To, Cc and Reply-To.
 *
 * And an email that copies nobody - every other email OneUptime sends - is
 * sent exactly as before: no Cc, no Reply-To.
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

const SENDER: Email = new Email("notifications@example.test");
const TEAM: string = "support@oneuptime.test";
const PERSON: string = "jane@acme.test";

// Give Feedback's email: to the team, the person copied and replied to.
function feedbackEmail(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    toEmail: new Email(TEAM),
    ccEmails: [new Email(PERSON)],
    replyToEmail: new Email(PERSON),
    subject: "Feedback (Something's broken): The SLO page shows no budget",
    isSubjectLiteral: true,
    templateType: EmailTemplateType.SimpleMessage,
    vars: {
      title: "Feedback from Jane Doe",
      message: "The SLO page shows no budget.",
    },
    ...overrides,
  };
}

// An email that copies nobody: a password reset, as every other email is.
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

// Who a service was told an email goes to.
interface ArrivedAddresses {
  to: Array<string>;
  cc: Array<string>;
  replyTo: Array<string>;
  /*
   * Every mailbox the service delivers to, where it is told apart from the
   * headers: the SMTP envelope, Mailgun's `to`. Null where the fields above
   * are what it delivers to.
   */
  deliveredTo: Array<string> | null;
  // Whether the request named a copy or a reply address at all.
  namesCopiesOrReplies: boolean;
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

function globalSmtpServer(): EmailServer {
  return {
    host: new Hostname("127.0.0.1"),
    port: new Port(smtp.port),
    secure: false,
    username: "apikey",
    password: "smtp-password",
    fromName: "OneUptime",
    fromEmail: SENDER,
    authType: SMTPAuthenticationType.UsernamePassword,
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

const lower: (values: Array<string> | undefined) => Array<string> = (
  values: Array<string> | undefined,
): Array<string> => {
  return (values || []).map((value: string): string => {
    return value.trim().toLowerCase();
  });
};

// "a@x.test, Jane <b@y.test>" as the addresses in it.
const addressesIn: (header: string | undefined) => Array<string> = (
  header: string | undefined,
): Array<string> => {
  if (!header) {
    return [];
  }

  return header
    .split(",")
    .map((part: string): string => {
      const bracketed: RegExpMatchArray | null = part.match(/<([^>]+)>/);

      return (bracketed ? bracketed[1]! : part).trim().toLowerCase();
    })
    .filter(Boolean);
};

const asList: (value: Array<string> | string | undefined) => Array<string> = (
  value: Array<string> | string | undefined,
): Array<string> => {
  if (value === undefined) {
    return [];
  }

  return lower(Array.isArray(value) ? value : [value]);
};

function arrivedOverSendGrid(): ArrivedAddresses {
  const json: SendGridMailSendJson = lastRequest(sendGrid)
    .json as SendGridMailSendJson;
  const personalization: SendGridMailSendJson["personalizations"][number] =
    json.personalizations[0]!;

  return {
    to: lower(
      personalization.to.map((item: { email: string }): string => {
        return item.email;
      }),
    ),
    cc: lower(
      (personalization.cc || []).map((item: { email: string }): string => {
        return item.email;
      }),
    ),
    replyTo: json.reply_to ? lower([json.reply_to.email]) : [],
    deliveredTo: null,
    namesCopiesOrReplies:
      personalization.cc !== undefined || json.reply_to !== undefined,
  };
}

function arrivedOverMicrosoftGraph(): ArrivedAddresses {
  const json: GraphSendMailJson = lastRequest(graph).json as GraphSendMailJson;
  const addressOf: (recipient: {
    emailAddress: { address: string };
  }) => string = (recipient: { emailAddress: { address: string } }): string => {
    return recipient.emailAddress.address;
  };

  return {
    to: lower(json.message.toRecipients.map(addressOf)),
    cc: lower((json.message.ccRecipients || []).map(addressOf)),
    replyTo: lower((json.message.replyTo || []).map(addressOf)),
    deliveredTo: null,
    namesCopiesOrReplies:
      json.message.ccRecipients !== undefined ||
      json.message.replyTo !== undefined,
  };
}

function arrivedOverAmazonSes(): ArrivedAddresses {
  const json: AmazonSesSendEmailJson = lastRequest(ses)
    .json as AmazonSesSendEmailJson;

  return {
    to: lower(json.Destination.ToAddresses),
    cc: lower(json.Destination.CcAddresses),
    replyTo: lower(json.ReplyToAddresses),
    deliveredTo: null,
    namesCopiesOrReplies:
      json.Destination.CcAddresses !== undefined ||
      json.ReplyToAddresses !== undefined,
  };
}

function arrivedOverPostmark(): ArrivedAddresses {
  const json: PostmarkEmailJson = lastRequest(postmark)
    .json as PostmarkEmailJson;

  return {
    to: addressesIn(json.To),
    cc: addressesIn(json.Cc),
    replyTo: addressesIn(json.ReplyTo),
    deliveredTo: null,
    namesCopiesOrReplies: json.Cc !== undefined || json.ReplyTo !== undefined,
  };
}

function arrivedOverResend(): ArrivedAddresses {
  const json: ResendEmailJson = lastRequest(resend).json as ResendEmailJson;

  return {
    to: asList(json.to),
    cc: asList(json.cc),
    replyTo: asList(json.reply_to),
    deliveredTo: null,
    namesCopiesOrReplies: json.cc !== undefined || json.reply_to !== undefined,
  };
}

// A MIME message's headers, as a mail client reads them.
function addressedInMime(data: string): Omit<ArrivedAddresses, "deliveredTo"> {
  const message: MimeEntity = readMimeEntity(data);

  return {
    to: addressesIn(message.headers.get("to")),
    cc: addressesIn(message.headers.get("cc")),
    replyTo: addressesIn(message.headers.get("reply-to")),
    namesCopiesOrReplies:
      message.headers.has("cc") || message.headers.has("reply-to"),
  };
}

function arrivedOverSmtp(): ArrivedAddresses {
  expect(smtp.messages.length).toBeGreaterThan(0);

  const message: { data: string; recipients: Array<string> } =
    smtp.messages[smtp.messages.length - 1]!;

  return {
    ...addressedInMime(message.data),
    // RCPT TO:<address>, one command per mailbox.
    deliveredTo: message.recipients.flatMap(addressesIn).sort(),
  };
}

function arrivedOverMailgun(): ArrivedAddresses {
  const request: RecordedHttpRequest = lastRequest(mailgun);

  return {
    ...addressedInMime(mailgunMimeOf(request)),
    deliveredTo: addressesIn(String(request.form?.get("to") || "")).sort(),
  };
}

interface TransportCase {
  name: string;
  send: (mail: EmailMessage) => Promise<ArrivedAddresses>;
}

const globalProviderCase: (
  serverType: EmailServerType,
  transport: MailTransportType,
  arrived: () => ArrivedAddresses,
) => TransportCase = (
  serverType: EmailServerType,
  transport: MailTransportType,
  arrived: () => ArrivedAddresses,
): TransportCase => {
  return {
    name: `${transport}'s API (Email Server Type: ${serverType})`,
    send: async (mail: EmailMessage): Promise<ArrivedAddresses> => {
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

const projectProviderCase: (
  transport: MailTransportType,
  arrived: () => ArrivedAddresses,
) => TransportCase = (
  transport: MailTransportType,
  arrived: () => ArrivedAddresses,
): TransportCase => {
  return {
    name: `${transport}'s API (Transport: ${transport})`,
    send: async (mail: EmailMessage): Promise<ArrivedAddresses> => {
      await MailService.send(mail, {
        emailServer: apiProviderServer(transport, { isProjectConfig: true }),
        projectId: ObjectID.generate(),
      });

      return arrived();
    },
  };
};

const TRANSPORT_CASES: Array<TransportCase> = [
  {
    name: "SendGrid's API (Email Server Type: SendGrid)",
    send: async (mail: EmailMessage): Promise<ArrivedAddresses> => {
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
  {
    name: "an SMTP server (Transport: SMTP)",
    send: async (mail: EmailMessage): Promise<ArrivedAddresses> => {
      jest
        .mocked(getEmailServerType)
        .mockResolvedValue(EmailServerType.CustomSMTP);
      jest.mocked(getGlobalSMTPConfig).mockResolvedValue(globalSmtpServer());

      await MailService.send(mail);

      return arrivedOverSmtp();
    },
  },
  {
    name: "Microsoft Graph (Transport: Microsoft Graph)",
    send: async (mail: EmailMessage): Promise<ArrivedAddresses> => {
      await MailService.send(mail, {
        emailServer: GRAPH_SERVER,
        projectId: ObjectID.generate(),
      });

      return arrivedOverMicrosoftGraph();
    },
  },
  globalProviderCase(
    EmailServerType.AmazonSES,
    MailTransportType.AmazonSES,
    arrivedOverAmazonSes,
  ),
  globalProviderCase(
    EmailServerType.Mailgun,
    MailTransportType.Mailgun,
    arrivedOverMailgun,
  ),
  globalProviderCase(
    EmailServerType.Postmark,
    MailTransportType.Postmark,
    arrivedOverPostmark,
  ),
  globalProviderCase(
    EmailServerType.Resend,
    MailTransportType.Resend,
    arrivedOverResend,
  ),
  projectProviderCase(MailTransportType.AmazonSES, arrivedOverAmazonSes),
  projectProviderCase(MailTransportType.SendGrid, arrivedOverSendGrid),
  projectProviderCase(MailTransportType.Mailgun, arrivedOverMailgun),
  projectProviderCase(MailTransportType.Postmark, arrivedOverPostmark),
  projectProviderCase(MailTransportType.Resend, arrivedOverResend),
];

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

describe.each(TRANSPORT_CASES)("$name", (transport: TransportCase) => {
  test("Give Feedback's email goes to the team, copies the person, and a reply goes to them", async () => {
    const arrived: ArrivedAddresses = await transport.send(feedbackEmail());

    expect(arrived.to).toEqual([TEAM]);
    expect(arrived.cc).toEqual([PERSON]);
    expect(arrived.replyTo).toEqual([PERSON]);

    if (arrived.deliveredTo) {
      // Delivered to both: a copy named only in a header reaches nobody.
      expect(arrived.deliveredTo).toEqual([PERSON, TEAM].sort());
    }
  });

  test("an email that copies nobody is sent as before: no Cc, no Reply-To", async () => {
    const arrived: ArrivedAddresses = await transport.send(passwordReset());

    expect(arrived.to).toEqual(["alice@example.test"]);
    expect(arrived.cc).toEqual([]);
    expect(arrived.replyTo).toEqual([]);
    expect(arrived.namesCopiesOrReplies).toBe(false);

    if (arrived.deliveredTo) {
      expect(arrived.deliveredTo).toEqual(["alice@example.test"]);
    }
  });

  test("the To copied again, and one person copied twice, are each sent once (SendGrid refuses a repeat)", async () => {
    const arrived: ArrivedAddresses = await transport.send(
      feedbackEmail({
        // A self-hosted admin who sends feedback to their own address.
        ccEmails: [new Email(TEAM.toUpperCase()), new Email(PERSON)],
      }),
    );

    expect(arrived.to).toEqual([TEAM]);
    expect(arrived.cc).toEqual([PERSON]);

    if (arrived.deliveredTo) {
      expect(arrived.deliveredTo).toEqual([PERSON, TEAM].sort());
    }
  });

  test("only the copy, or only the reply address, is sent as asked", async () => {
    const onlyReply: ArrivedAddresses = await transport.send(
      feedbackEmail({ ccEmails: undefined }),
    );

    expect(onlyReply.cc).toEqual([]);
    expect(onlyReply.replyTo).toEqual([PERSON]);

    const onlyCopy: ArrivedAddresses = await transport.send(
      feedbackEmail({ replyToEmail: undefined }),
    );

    expect(onlyCopy.cc).toEqual([PERSON]);
    expect(onlyCopy.replyTo).toEqual([]);
  });
});
