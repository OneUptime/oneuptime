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
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import MailStatus from "Common/Types/Mail/MailStatus";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import { EmailServerType } from "Common/Models/DatabaseModels/GlobalConfig";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailLogService from "Common/Server/Services/EmailLogService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import EmailPlainText from "Common/Server/Utils/Mail/EmailPlainText";
import {
  getEmailServerType,
  getSendgridConfig,
} from "../../FeatureSet/Notification/Config";
import MailService, {
  EMAIL_SENT_STATUS_MESSAGE,
  getSentWithoutImagesStatusMessage,
} from "../../FeatureSet/Notification/Services/MailService";
import SMTPOAuthService from "../../FeatureSet/Notification/Services/SMTPOAuthService";
import "../../FeatureSet/Notification/Utils/Handlebars";
import {
  FakeMicrosoftGraph,
  FakeSendGrid,
  FakeSmtpServer,
  GraphSendMailJson,
  SENDGRID_UNAUTHORIZED_ANSWER,
  SMTP_QUEUED_REPLY,
  SendGridMailSendJson,
  contentIdsInHtml,
  sendGridContentIdRequired,
  sendMicrosoftGraphTo,
  sendSendGridTo,
  startFakeMicrosoftGraph,
  startFakeSendGrid,
  startFakeSmtpServer,
} from "./Fixtures/FakeMailServices";
import {
  MimeEntity,
  allMimeEntities,
  mimeEntitiesOfType,
  readMimeEntity,
} from "./Fixtures/MimeMessage";

/*
 * AN EMAIL IS WORTH MORE THAN ITS IMAGES.
 *
 * A mail service that will not take an email's inline images refuses the
 * whole email: for issue #5308 SendGrid refused every password reset and
 * every on-call page for the logo in its header. So when a service's answer
 * names the images as what it would not take (InlineImageRefusal), the same
 * email goes once more without them - its header showing the product's name
 * alone, each screenshot a short note - and the Email Log says it went
 * without its images, and why. Any other refusal is reported as it was, and
 * nothing is sent twice.
 *
 * Every send goes through the real client to a stand-in for its service
 * (Fixtures/FakeMailServices), which is told how to answer.
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

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: { errorClass: "user" },
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

// A real 1x1 PNG, as the probe reports a synthetic monitor's screenshot.
const SCREENSHOT: string =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const SENDER: Email = new Email("notifications@example.test");

const SCREENSHOT_NOTE: string =
  "[Checkout page: image could not be included in this email]";

/*
 * The header's name, standing alone and read aloud, as Logo.hbs draws it
 * without the logo - and the cell it is beside the logo, hidden from screen
 * readers because the logo's alt text says the name already.
 */
const NAME_ALONE_CELL: string =
  "<td style=\"font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 18px; line-height: 24px; font-weight: 700; letter-spacing: -0.5px; color: #0f172a;\">OneUptime</td>";
const NAME_BESIDE_LOGO_CELL_START: string =
  '<td aria-hidden="true" style="padding-left: 10px; font-family:';

// What SendGrid answered issue #5308's emails with, explained.
const SENDGRID_CONTENT_ID_REFUSAL: string =
  "SendGrid did not accept the email (HTTP 400 Bad Request). SendGrid said: The content_id parameter is required if disposition = 'inline'. (attachments.0.content_id)";

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

interface LoggedEmail {
  status?: string;
  statusMessage?: string;
}

// The Email Log rows written, in order.
function emailLogRows(): Array<LoggedEmail> {
  return jest
    .mocked(EmailLogService.create)
    .mock.calls.map((call: Array<unknown>): LoggedEmail => {
      return (call[0] as { data: LoggedEmail }).data;
    });
}

// The messages logger.error was given, with the attributes beside each.
function errorsLogged(): Array<[unknown, unknown]> {
  return jest
    .mocked(logger.error)
    .mock.calls.map((call: Array<unknown>): [unknown, unknown] => {
      return [call[0], call[1]];
    });
}

function imagesRefusalLogs(): Array<[unknown, unknown]> {
  return errorsLogged().filter((entry: [unknown, unknown]): boolean => {
    return (
      typeof entry[0] === "string" &&
      entry[0].startsWith(
        "The mail service refused an email for its inline images",
      )
    );
  });
}

// What a reader sees of an email sent without its images.
function expectSentWithoutImages(html: string): void {
  expect(contentIdsInHtml(html)).toEqual([]);
  expect(html).not.toContain("cid:");
  expect(html).not.toContain("data:image");
  // The header: the name, standing alone and read aloud, no broken image.
  expect(html).not.toContain('alt="OneUptime"');
  expect(html).toContain(NAME_ALONE_CELL);
  expect(html).not.toContain(NAME_BESIDE_LOGO_CELL_START);
  // The screenshot: a note with its alt text.
  expect(html).toContain(SCREENSHOT_NOTE);
  // The rest of the email, the Acknowledge button included.
  expect(html).toContain("Timeout 30000ms exceeded");
  expect(html).toContain("Acknowledge Incident");
}

let sendGrid: FakeSendGrid;
let graph: FakeMicrosoftGraph;
let smtp: FakeSmtpServer;

// How the SMTP stand-in answers each message at the end of DATA.
let answerSmtpMessage: (data: string) => string = (): string => {
  return SMTP_QUEUED_REPLY;
};

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

function smtpServer(): EmailServer {
  return {
    host: new Hostname("127.0.0.1"),
    port: new Port(smtp.port),
    secure: false,
    username: "user",
    password: "password",
    fromName: "OneUptime",
    fromEmail: SENDER,
    authType: SMTPAuthenticationType.UsernamePassword,
  };
}

function useSendGrid(): void {
  jest.mocked(getEmailServerType).mockResolvedValue(EmailServerType.Sendgrid);
  jest.mocked(getSendgridConfig).mockResolvedValue({
    apiKey: "SG.test-key",
    fromEmail: SENDER,
    fromName: "OneUptime",
  });
}

function sendGridJson(index: number): SendGridMailSendJson {
  return sendGrid.requests[index]!.json as SendGridMailSendJson;
}

function sendGridHtml(index: number): string {
  return (
    sendGridJson(index).content.find((block: { type: string }): boolean => {
      return block.type === "text/html";
    })?.value || ""
  );
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

  sendGrid = await startFakeSendGrid();
  graph = await startFakeMicrosoftGraph();
  smtp = await startFakeSmtpServer({
    answerMessage: (data: string): string => {
      return answerSmtpMessage(data);
    },
  });
});

afterAll(async () => {
  await sendGrid.close();
  await graph.close();
  await smtp.close();
});

beforeEach(() => {
  jest.clearAllMocks();
  sendGrid.requests.length = 0;
  graph.requests.length = 0;
  smtp.messages.length = 0;
  answerSmtpMessage = (): string => {
    return SMTP_QUEUED_REPLY;
  };
  sendSendGridTo(sendGrid);
  sendMicrosoftGraphTo(graph);
  jest.mocked(SMTPOAuthService.getAccessToken).mockResolvedValue("token-123");
});

afterEach(async () => {
  jest.restoreAllMocks();
  await MailService.cleanup();
});

describe("SendGrid refuses an email for its images", () => {
  test("it goes once more without them: the header's name alone, the screenshot a note", async () => {
    useSendGrid();
    sendGrid.answerNextWith({
      status: 400,
      body: { errors: [sendGridContentIdRequired(0)] },
    });

    await MailService.send(await incidentWithScreenshot());

    expect(sendGrid.requests).toHaveLength(2);
    expect(sendGridJson(0).attachments).toHaveLength(2);
    // The first, with its logo: the name beside it, hidden from screen readers.
    expect(sendGridHtml(0)).toContain(NAME_BESIDE_LOGO_CELL_START);
    expect(sendGridHtml(0)).not.toContain(NAME_ALONE_CELL);
    expect(Object.keys(sendGridJson(1))).not.toContain("attachments");
    expectSentWithoutImages(sendGridHtml(1));

    // Its text part reads as its HTML now does.
    expect(sendGridJson(1).content[0]).toEqual({
      type: "text/plain",
      value: EmailPlainText.fromHtml(sendGridHtml(1)),
    });
    expect(sendGridJson(1).content[0]!.value).toContain(SCREENSHOT_NOTE);
    expect(sendGridJson(1).subject).toBe(sendGridJson(0).subject);
  });

  test("the Email Log and the on-call timeline say it went without its images, and what SendGrid said", async () => {
    useSendGrid();
    sendGrid.answerNextWith({
      status: 400,
      body: { errors: [sendGridContentIdRequired(0)] },
    });

    const timelineId: ObjectID = ObjectID.generate();

    await MailService.send(await incidentWithScreenshot(), {
      projectId: ObjectID.generate(),
      userOnCallLogTimelineId: timelineId,
    });

    const expected: string = getSentWithoutImagesStatusMessage(
      SENDGRID_CONTENT_ID_REFUSAL,
    );

    expect(expected).toBe(
      "Email sent successfully without its images, which the mail service refused: SendGrid did not accept the email (HTTP 400 Bad Request). SendGrid said: The content_id parameter is required if disposition = 'inline'. (attachments.0.content_id). This does not mean the email was delivered. We do not track email delivery. If the email was not delivered - it is likely due to the email address being invalid, user has blocked sending domain, or it could have landed in spam.",
    );
    expect(emailLogRows()).toEqual([
      expect.objectContaining({
        status: MailStatus.Success,
        statusMessage: expected,
      }),
    ]);
    expect(UserOnCallLogTimelineService.updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: timelineId,
        data: {
          status: UserNotificationStatus.Sent,
          statusMessage: expected,
        },
      }),
    );
  });

  test("OneUptime's own fault is logged as one: our attachments, refused", async () => {
    useSendGrid();
    sendGrid.answerNextWith({
      status: 400,
      body: { errors: [sendGridContentIdRequired(0)] },
    });

    await MailService.send(passwordReset());

    expect(imagesRefusalLogs()).toEqual([
      [
        `The mail service refused an email for its inline images, so it is sent again without them: ${SENDGRID_CONTENT_ID_REFUSAL}`,
        undefined,
      ],
    ]);
  });

  test("a password reset, whose only image is the logo, still goes", async () => {
    useSendGrid();
    sendGrid.answerNextWith({
      status: 400,
      body: { errors: [sendGridContentIdRequired(0)] },
    });

    await MailService.send(passwordReset());

    expect(sendGrid.requests).toHaveLength(2);

    const html: string = sendGridHtml(1);

    expect(html).not.toContain("cid:");
    expect(html).toContain(NAME_ALONE_CELL);
    expect(html).toContain(
      "https://oneuptime.example.test/accounts/reset-password/token-123",
    );
  });

  test("too large for SendGrid (HTTP 413): it goes without them too", async () => {
    useSendGrid();
    sendGrid.answerNextWith({
      status: 413,
      body: {
        errors: [{ message: "Payload Too Large", field: null, help: null }],
      },
    });

    await MailService.send(await incidentWithScreenshot());

    expect(sendGrid.requests).toHaveLength(2);
    expectSentWithoutImages(sendGridHtml(1));
  });

  test("refused again without its images: that refusal is the email's, and nothing is tried a third time", async () => {
    useSendGrid();
    sendGrid.answerNextWith({
      status: 400,
      body: { errors: [sendGridContentIdRequired(0)] },
    });
    sendGrid.answerNextWith({
      status: 403,
      body: {
        errors: [
          {
            message:
              "The from address does not match a verified Sender Identity. Mail cannot be sent until this error is resolved.",
            field: "from",
            help: null,
          },
        ],
      },
    });

    const refusal: string =
      "SendGrid would not send this email (HTTP 403 Forbidden). The API key needs the Mail Send permission, and the From Email must be a sender verified in SendGrid. SendGrid said: The from address does not match a verified Sender Identity. Mail cannot be sent until this error is resolved. (from)";

    await expect(
      MailService.send(await incidentWithScreenshot(), {
        projectId: ObjectID.generate(),
      }),
    ).rejects.toThrow(refusal);

    expect(sendGrid.requests).toHaveLength(2);
    expect(emailLogRows()).toEqual([
      expect.objectContaining({
        status: MailStatus.Error,
        statusMessage: refusal,
      }),
    ]);
  });
});

describe("SendGrid refuses an email for anything else", () => {
  test("a key it does not take: one request, and the Email Log says to check the API key", async () => {
    useSendGrid();
    sendGrid.answerNextWith(SENDGRID_UNAUTHORIZED_ANSWER);

    const refusal: string =
      "SendGrid did not accept the API key (HTTP 401 Unauthorized). Check the SendGrid API Key in the admin dashboard, under Settings > Emails. SendGrid said: The provided authorization grant is invalid, expired, or revoked";

    await expect(
      MailService.send(await incidentWithScreenshot(), {
        projectId: ObjectID.generate(),
      }),
    ).rejects.toThrow(refusal);

    expect(sendGrid.requests).toHaveLength(1);
    expect(emailLogRows()).toEqual([
      expect.objectContaining({
        status: MailStatus.Error,
        statusMessage: refusal,
      }),
    ]);
    expect(imagesRefusalLogs()).toEqual([]);
  });

  test("an error on another field: the images stay, and the email is not sent again", async () => {
    useSendGrid();
    sendGrid.answerNextWith({
      status: 400,
      body: {
        errors: [
          {
            message: "Does not contain a valid address.",
            field: "personalizations.0.to.0.email",
            help: null,
          },
        ],
      },
    });

    await expect(MailService.send(passwordReset())).rejects.toThrow(
      "SendGrid did not accept the email (HTTP 400 Bad Request). SendGrid said: Does not contain a valid address. (personalizations.0.to.0.email)",
    );

    expect(sendGrid.requests).toHaveLength(1);
  });

  test("an email with no images, refused for its size: nothing to leave out, so it is not sent again", async () => {
    useSendGrid();
    sendGrid.answerNextWith({
      status: 413,
      body: {
        errors: [{ message: "Payload Too Large", field: null, help: null }],
      },
    });

    await expect(
      MailService.send({
        toEmail: new Email("alice@example.test"),
        subject: "Plain",
        isSubjectLiteral: true,
        vars: {},
        body: "<p>No images here.</p>",
      }),
    ).rejects.toThrow(
      "SendGrid did not accept the email (HTTP 413 Payload Too Large). SendGrid said: Payload Too Large",
    );

    expect(sendGrid.requests).toHaveLength(1);
    expect(sendGridJson(0).attachments).toBeUndefined();
  });
});

describe("Microsoft Graph refuses an email for its images", () => {
  const GRAPH_ATTACHMENT_REFUSAL: { code: string; message: string } = {
    code: "ErrorInvalidRequest",
    message: "The attachment with the contentId given is not valid.",
  };

  test("it goes once more without them, and the Email Log says what Graph said", async () => {
    graph.answerNextWith({
      status: 400,
      body: { error: GRAPH_ATTACHMENT_REFUSAL },
    });

    await MailService.send(await incidentWithScreenshot(), {
      emailServer: GRAPH_SERVER,
      projectId: ObjectID.generate(),
    });

    expect(graph.requests).toHaveLength(2);

    const first: GraphSendMailJson = graph.requests[0]!
      .json as GraphSendMailJson;
    const second: GraphSendMailJson = graph.requests[1]!
      .json as GraphSendMailJson;

    expect(first.message.attachments).toHaveLength(2);
    expect(Object.keys(second.message)).not.toContain("attachments");
    expectSentWithoutImages(second.message.body.content);

    expect(emailLogRows()).toEqual([
      expect.objectContaining({
        status: MailStatus.Success,
        statusMessage: getSentWithoutImagesStatusMessage(
          `Microsoft Graph sendMail failed with HTTP 400. ${GRAPH_ATTACHMENT_REFUSAL.code} ${GRAPH_ATTACHMENT_REFUSAL.message}`,
        ),
      }),
    ]);
    // Our attachments, refused: OneUptime's fault, not the tenant's.
    expect(imagesRefusalLogs()).toHaveLength(1);
    expect(imagesRefusalLogs()[0]![1]).toBeUndefined();
  });

  test("a sendMail too large (HTTP 413): it goes without them too", async () => {
    graph.answerNextWith({
      status: 413,
      body: {
        error: {
          code: "RequestEntityTooLarge",
          message: "The request is too large.",
        },
      },
    });

    await MailService.send(await incidentWithScreenshot(), {
      emailServer: GRAPH_SERVER,
    });

    expect(graph.requests).toHaveLength(2);
    expectSentWithoutImages(
      (graph.requests[1]!.json as GraphSendMailJson).message.body.content,
    );
  });

  test("a permission it lacks (HTTP 403) is not about the images: one request, reported as Graph said", async () => {
    graph.answerNextWith({
      status: 403,
      body: {
        error: {
          code: "ErrorAccessDenied",
          message: "Access is denied. Check credentials and try again.",
        },
      },
    });

    await expect(
      MailService.send(await incidentWithScreenshot(), {
        emailServer: GRAPH_SERVER,
        projectId: ObjectID.generate(),
      }),
    ).rejects.toThrow("Microsoft Graph denied the send (403 Forbidden).");

    expect(graph.requests).toHaveLength(1);
    expect(emailLogRows()).toEqual([
      expect.objectContaining({ status: MailStatus.Error }),
    ]);
    expect(imagesRefusalLogs()).toEqual([]);
  });
});

describe("an SMTP server refuses a message for its images", () => {
  const SIZE_REFUSAL: string =
    "552 5.3.4 Message size exceeds fixed maximum message size";

  // The server takes a message only without an inline image part in it.
  const refuseInlineImages: (data: string) => string = (
    data: string,
  ): string => {
    return data.indexOf("Content-ID:") === -1
      ? SMTP_QUEUED_REPLY
      : SIZE_REFUSAL;
  };

  test("too big with them (552 5.3.4): it goes once more without them, after one refusal, not three", async () => {
    answerSmtpMessage = refuseInlineImages;

    await MailService.send(await incidentWithScreenshot(), {
      emailServer: smtpServer(),
      projectId: ObjectID.generate(),
    });

    expect(
      smtp.messages.map((message: { reply: string }): string => {
        return message.reply;
      }),
    ).toEqual([SIZE_REFUSAL, SMTP_QUEUED_REPLY]);

    const sent: MimeEntity = readMimeEntity(smtp.messages[1]!.data);

    expect(
      allMimeEntities(sent).filter((part: MimeEntity): boolean => {
        return part.type.startsWith("image/");
      }),
    ).toEqual([]);
    expect(mimeEntitiesOfType(sent, "multipart/related")).toEqual([]);
    expectSentWithoutImages(
      mimeEntitiesOfType(sent, "text/html")[0]!.body.toString("utf8"),
    );
    expect(
      mimeEntitiesOfType(sent, "text/plain")[0]!.body.toString("utf8"),
    ).toContain(SCREENSHOT_NOTE);

    expect(emailLogRows()).toEqual([
      expect.objectContaining({
        status: MailStatus.Success,
        statusMessage: getSentWithoutImagesStatusMessage(
          `Message failed: ${SIZE_REFUSAL}`,
        ),
      }),
    ]);
  });

  test("the tenant's server set that limit: the refusal is logged as an outside fault", async () => {
    answerSmtpMessage = refuseInlineImages;

    await MailService.send(passwordReset(), { emailServer: smtpServer() });

    expect(imagesRefusalLogs()).toEqual([
      [
        `The mail service refused an email for its inline images, so it is sent again without them: Message failed: ${SIZE_REFUSAL}`,
        EXTERNAL_FAULT,
      ],
    ]);
  });

  test("an enhanced status of a media error (554 5.6.0) counts the same", async () => {
    answerSmtpMessage = (data: string): string => {
      return data.indexOf("Content-ID:") === -1
        ? SMTP_QUEUED_REPLY
        : "554 5.6.0 Message contains a part this server does not take";
    };

    await MailService.send(passwordReset(), { emailServer: smtpServer() });

    expect(smtp.messages).toHaveLength(2);
    expect(smtp.messages[1]!.reply).toBe(SMTP_QUEUED_REPLY);
  });

  test("a refusal of anything else (554 5.7.1) keeps the images and is tried as before, three times", async () => {
    const SPAM_REFUSAL: string = "554 5.7.1 Message rejected as spam";

    answerSmtpMessage = (): string => {
      return SPAM_REFUSAL;
    };

    await expect(
      MailService.send(passwordReset(), {
        emailServer: smtpServer(),
        projectId: ObjectID.generate(),
      }),
    ).rejects.toThrow(SPAM_REFUSAL);

    expect(smtp.messages).toHaveLength(3);

    for (const message of smtp.messages) {
      expect(message.data).toContain("Content-ID:");
    }

    expect(emailLogRows()).toEqual([
      expect.objectContaining({ status: MailStatus.Error }),
    ]);
    expect(imagesRefusalLogs()).toEqual([]);
  }, 20000);
});

describe("an email that goes as it is", () => {
  test("is sent once, with its images, and the Email Log says it went", async () => {
    useSendGrid();

    await MailService.send(await incidentWithScreenshot(), {
      projectId: ObjectID.generate(),
    });

    expect(sendGrid.requests).toHaveLength(1);
    expect(sendGridJson(0).attachments).toHaveLength(2);
    expect(emailLogRows()).toEqual([
      expect.objectContaining({
        status: MailStatus.Success,
        statusMessage: EMAIL_SENT_STATUS_MESSAGE,
      }),
    ]);
    expect(imagesRefusalLogs()).toEqual([]);
  });
});

describe("the Email Log's words for an email sent without its images", () => {
  test("the service's answer, as one sentence, then what every sent email says", () => {
    expect(getSentWithoutImagesStatusMessage("It said no.")).toBe(
      `Email sent successfully without its images, which the mail service refused: It said no. ${EMAIL_SENT_STATUS_MESSAGE.slice("Email sent successfully. ".length)}`,
    );
    expect(getSentWithoutImagesStatusMessage("  It said no  ")).toBe(
      getSentWithoutImagesStatusMessage("It said no."),
    );
    expect(getSentWithoutImagesStatusMessage("Too big (552)")).toContain(
      "refused: Too big (552). This does not mean",
    );
  });
});
