import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import nodemailer, { Transporter } from "nodemailer";
import { mockRouter } from "Common/Tests/Server/API/Helpers";
import CommonMailService from "Common/Server/Services/MailService";
import { Service as SubscriberTemplateService } from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import Markdown from "Common/Server/Types/Markdown";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Hostname from "Common/Types/API/Hostname";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import Port from "Common/Types/Port";
import API from "Common/Utils/API";
import MailService from "../../FeatureSet/Notification/Services/MailService";
import "../../FeatureSet/Notification/API/Mail";

/*
 * A subscriber email's subject is finished text by the time it is sent. The
 * worker fills the status page's custom subject with compileTemplate, and the
 * values include the incident description as plain text - text the author
 * wrote, which may quote template syntax. The mailer used to compile that
 * finished subject through Handlebars a second time, so a description quoting
 * "{{ .Values.image.tag }}" failed to parse and the subscriber got no email,
 * and one containing "{{ x }}" lost those words from the subject.
 *
 * Each test sends one subject along the production path: Markdown to plain
 * text, compileTemplate, the Common mail client, the notification API's /send
 * route and MailService.send, to the subject the SMTP transport receives. Only
 * infrastructure and the transport are mocked; the request body is put through
 * JSON as it would be on the wire.
 */
jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Middleware/ClusterKeyAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getClusterKeyHeaders: jest.fn(() => {
        return {};
      }),
      isAuthorizedServiceMiddleware: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return { __esModule: true, default: { sendEmptySuccessResponse: jest.fn() } };
});

jest.mock("Common/Utils/API", () => {
  return { __esModule: true, default: { post: jest.fn() } };
});

jest.mock("Common/Server/Services/DatabaseService", () => {
  return { __esModule: true, default: class DatabaseServiceMock {} };
});

jest.mock(
  "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate",
  () => {
    return { __esModule: true, default: class SubscriberTemplateModelMock {} };
  },
);

jest.mock(
  "Common/Server/Services/StatusPageSubscriberNotificationTemplateStatusPageService",
  () => {
    return { __esModule: true, default: {} };
  },
);

jest.mock("../../FeatureSet/Notification/Config", () => {
  return {
    getEmailServerType: jest
      .fn<() => Promise<string>>()
      .mockResolvedValue("Custom SMTP"),
    getGlobalSMTPConfig: jest.fn(),
    getSendgridConfig: jest.fn(),
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  return { IsDevelopment: false, AppApiHostname: "app" };
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
    default: { debug: jest.fn(), error: jest.fn() },
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

interface CapturedMail {
  to: string;
  subject: string;
  html: string;
}

type SendMail = (mail: CapturedMail) => Promise<{ messageId: string }>;

const sendMail: ReturnType<typeof jest.fn<SendMail>> = jest.fn<SendMail>();

// A status page's custom SMTP server, which is what enables custom templates.
const SMTP_SERVER: EmailServer = {
  host: new Hostname("smtp.acme.test"),
  port: new Port(587),
  secure: true,
  username: "status-mailer",
  password: "smtp-password",
  fromName: "Acme Status",
  fromEmail: new Email("status@acme.test"),
};

const SUBSCRIBER_EMAIL: string = "subscriber@example.test";

// The status page's custom subject for the incident email.
const SUBJECT_TEMPLATE: string =
  "[{{statusPageName}}] {{incidentTitle}}: {{incidentDescription}}";

interface DescriptionCase {
  name: string;
  // The incident description as its author wrote it, in Markdown.
  description: string;
  // What the subject says for it: the description as plain text.
  subjectText: string;
}

const DESCRIPTION_CASES: Array<DescriptionCase> = [
  {
    name: "a bare expression",
    description: "Deploy blocked on {{ x }} in the release pipeline",
    subjectText: "Deploy blocked on {{ x }} in the release pipeline",
  },
  {
    name: "a quoted Helm value",
    description: "Helm upgrade failed: `{{ .Values.image.tag }}` was empty",
    subjectText: "Helm upgrade failed: {{ .Values.image.tag }} was empty",
  },
  {
    name: "a lone opening pair of braces",
    description: "Config parser stopped at {{ on line 3",
    subjectText: "Config parser stopped at {{ on line 3",
  },
];

/*
 * Sends the mail as a worker does, then hands the request the Common client
 * made to the notification API's /send route, and returns what reached SMTP.
 */
async function sendThroughNotificationApi(
  mail: EmailMessage,
): Promise<CapturedMail> {
  await CommonMailService.sendMail(mail, { mailServer: SMTP_SERVER });

  const request: { data: JSONObject } | undefined = jest.mocked(API.post).mock
    .calls[0]?.[0] as { data: JSONObject } | undefined;
  expect(request).toBeDefined();

  const next: ReturnType<typeof jest.fn> = jest.fn();
  await mockRouter.match("post", "/send").handlerFunction(
    {
      body: JSON.parse(JSON.stringify(request!.data)),
    } as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );
  expect(next).not.toHaveBeenCalled();

  expect(sendMail).toHaveBeenCalledTimes(1);
  const payload: CapturedMail = sendMail.mock.calls[0]![0];
  expect(payload.to).toBe(SUBSCRIBER_EMAIL);

  return payload;
}

// The custom-template email a subscriber job sends.
function customTemplateEmail(subject: string): EmailMessage {
  return {
    toEmail: new Email(SUBSCRIBER_EMAIL),
    templateType: EmailTemplateType.BlankTemplate,
    vars: { body: "<p>Checkout requests are failing.</p>" },
    subject: subject,
    isSubjectLiteral: true,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  sendMail.mockResolvedValue({ messageId: "mocked-delivery" });
  jest.mocked(nodemailer.createTransport).mockReturnValue({
    sendMail,
    close: jest.fn(),
  } as unknown as Transporter);
});

afterEach(async () => {
  await MailService.cleanup();
});

describe("a subscriber email subject rendered from the incident description", () => {
  test.each(DESCRIPTION_CASES)(
    "with $name reaches the subscriber as written",
    async ({ description, subjectText }: DescriptionCase) => {
      const plainText: string = Markdown.convertToPlainText(description);
      expect(plainText).toBe(subjectText);

      const subject: string = SubscriberTemplateService.compileTemplate(
        SUBJECT_TEMPLATE,
        {
          statusPageName: "Acme Status",
          incidentTitle: "Checkout failing",
          incidentDescription: plainText,
        },
      );

      const delivered: CapturedMail = await sendThroughNotificationApi(
        customTemplateEmail(subject),
      );

      expect(delivered.subject).toBe(
        `[Acme Status] Checkout failing: ${subjectText}`,
      );
      expect(delivered.html).toBe("<p>Checkout requests are failing.</p>");
    },
  );

  test("a default subject built from an incident title is sent as written", async () => {
    const delivered: CapturedMail = await sendThroughNotificationApi(
      customTemplateEmail(
        "[Identified Incident] Rollout of {{ .Values.image.tag }} stalled",
      ),
    );

    expect(delivered.subject).toBe(
      "[Identified Incident] Rollout of {{ .Values.image.tag }} stalled",
    );
  });

  test("a placeholder the status page has no variable for stays as written, as it does in the body", async () => {
    const subject: string = SubscriberTemplateService.compileTemplate(
      "{{incidentTitle}} ({{incidentNumber}})",
      { incidentTitle: "Checkout failing" },
    );

    const delivered: CapturedMail = await sendThroughNotificationApi(
      customTemplateEmail(subject),
    );

    expect(delivered.subject).toBe("Checkout failing ({{incidentNumber}})");
  });
});

describe("a subject that is still a template", () => {
  test("is compiled against the email's variables, as a custom report subject is", async () => {
    const delivered: CapturedMail = await sendThroughNotificationApi({
      toEmail: new Email(SUBSCRIBER_EMAIL),
      body: "<p>{{statusPageName}} report</p>",
      vars: { statusPageName: "Acme Status" },
      subject: "[Report] {{statusPageName}}",
    });

    expect(delivered.subject).toBe("[Report] Acme Status");
    expect(delivered.html).toBe("<p>Acme Status report</p>");
  });
});
