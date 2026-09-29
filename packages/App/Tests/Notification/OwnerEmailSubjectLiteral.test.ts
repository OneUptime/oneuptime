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
import UserNotificationEmailRollupItemService from "Common/Server/Services/UserNotificationEmailRollupItemService";
import EmailRollupWriter from "Common/Server/Utils/EmailRollup/EmailRollupWriter";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Hostname from "Common/Types/API/Hostname";
import Email from "Common/Types/Email";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import PositiveNumber from "Common/Types/PositiveNumber";
import API from "Common/Utils/API";
import { getGlobalSMTPConfig } from "../../FeatureSet/Notification/Config";
import MailService from "../../FeatureSet/Notification/Services/MailService";
import "../../FeatureSet/Notification/API/Mail";

/*
 * An owner notification's subject is finished text by the time it is sent:
 * the job interpolates the incident, alert or monitor title into it, and those
 * titles are typed by users. The mailer used to compile that finished subject
 * through Handlebars a second time, so a title quoting "{{ .Values.image.tag }}"
 * lost those words, and one with a lone "{{" failed to parse - the send threw,
 * the rollup writer's fire-and-forget catch logged it, and the owner got no
 * email.
 *
 * Each test sends one owner envelope along the production path: the rollup
 * writer (which sends it immediately below the burst threshold), the Common
 * mail client, the notification API's /send route and MailService.send, to the
 * subject the SMTP transport receives. Only infrastructure, the rollup ledger
 * and the transport are mocked; the request body is put through JSON as it
 * would be on the wire. The owner jobs' own tests pin that each job marks its
 * envelope this way.
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

// The rollup ledger: an address that has had no owner email recently.
jest.mock(
  "Common/Server/Services/UserNotificationEmailRollupItemService",
  () => {
    return {
      __esModule: true,
      default: { countBy: jest.fn(), create: jest.fn() },
    };
  },
);

jest.mock(
  "Common/Server/Services/UserNotificationEmailRollupSettingService",
  () => {
    return {
      __esModule: true,
      default: { isRollupEnabledForUser: jest.fn() },
    };
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

// What the /send route calls next() with when the send fails.
type NextMock = ReturnType<typeof jest.fn<NextFunction>>;

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const OWNER_ID: ObjectID = new ObjectID("user-1");
const OWNER_EMAIL: string = "owner@acme.test";

// Owner emails carry no SMTP server of their own, so the instance's is used.
const INSTANCE_SMTP: EmailServer = {
  host: new Hostname("smtp.oneuptime.test"),
  port: new Port(587),
  secure: true,
  username: "oneuptime",
  password: "smtp-password",
  fromName: "OneUptime",
  fromEmail: new Email("notifications@oneuptime.test"),
};

interface TitleCase {
  name: string;
  // The incident title as its author typed it.
  title: string;
}

const TITLE_CASES: Array<TitleCase> = [
  {
    name: "a quoted Helm value",
    title: "Rollout of {{ .Values.image.tag }} stalled",
  },
  {
    name: "a bare expression",
    title: "Deploy blocked on {{ x }}",
  },
  {
    name: "a lone opening pair of braces",
    title: "Config parser stopped at {{ on line 3",
  },
];

// The envelope IncidentOwner:SendCreatedResourceEmail builds for one owner.
function ownerEnvelope(title: string): EmailEnvelope {
  return {
    templateType: EmailTemplateType.BlankTemplate,
    vars: { body: "<p>Checkout requests are failing.</p>" },
    subject: `[New Incident #12] - ${title}`,
    isSubjectLiteral: true,
  };
}

/*
 * Resolves once the writer's fire-and-forget send has reached the Common mail
 * client. A macrotask rather than a fixed number of microtask hops, so it does
 * not depend on how deep the send's promise chain is.
 */
function flushPendingWork(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

/*
 * Hands the request the Common client made to the notification API's /send
 * route, as JSON, and returns what the route passed to next().
 */
async function deliverRequest(): Promise<NextMock> {
  expect(API.post).toHaveBeenCalledTimes(1);

  const request: { data: JSONObject } = jest.mocked(API.post).mock
    .calls[0]![0] as { data: JSONObject };

  const next: NextMock = jest.fn<NextFunction>();
  await mockRouter.match("post", "/send").handlerFunction(
    {
      body: JSON.parse(JSON.stringify(request.data)),
    } as ExpressRequest,
    {} as ExpressResponse,
    // Express's NextFunction is overloaded, which a plain mock cannot satisfy.
    next as unknown as NextFunction,
  );

  return next;
}

function requestBody(): JSONObject {
  return (jest.mocked(API.post).mock.calls[0]![0] as { data: JSONObject }).data;
}

function deliveredMail(): CapturedMail {
  expect(sendMail).toHaveBeenCalledTimes(1);
  const payload: CapturedMail = sendMail.mock.calls[0]![0];
  expect(payload.to).toBe(OWNER_EMAIL);
  return payload;
}

async function sendAsOwnerNotification(
  envelope: EmailEnvelope,
  options?: { forceImmediate?: boolean | undefined },
): Promise<NextMock> {
  await EmailRollupWriter.sendOrRollup({
    projectId: PROJECT_ID,
    userId: OWNER_ID,
    toEmail: new Email(OWNER_EMAIL),
    eventType:
      NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
    emailEnvelope: envelope,
    mailOptions: { projectId: PROJECT_ID },
    forceImmediate: options?.forceImmediate,
  });

  await flushPendingWork();

  return deliverRequest();
}

beforeEach(() => {
  jest.clearAllMocks();

  jest.mocked(getGlobalSMTPConfig).mockResolvedValue(INSTANCE_SMTP);

  jest
    .mocked(UserNotificationEmailRollupItemService.countBy)
    .mockResolvedValue(new PositiveNumber(0));

  sendMail.mockResolvedValue({ messageId: "mocked-delivery" });
  jest.mocked(nodemailer.createTransport).mockReturnValue({
    sendMail,
    close: jest.fn(),
  } as unknown as Transporter);
});

afterEach(async () => {
  await MailService.cleanup();
});

describe("an owner email whose subject quotes an incident title", () => {
  test.each(TITLE_CASES)(
    "with $name reaches the owner as written",
    async ({ title }: TitleCase) => {
      const next: NextMock = await sendAsOwnerNotification(
        ownerEnvelope(title),
      );

      expect(next).not.toHaveBeenCalled();
      expect(requestBody()["isSubjectLiteral"]).toBe(true);

      const delivered: CapturedMail = deliveredMail();
      expect(delivered.subject).toBe(`[New Incident #12] - ${title}`);
      expect(delivered.html).toBe("<p>Checkout requests are failing.</p>");
    },
  );

  test("reaches the owner as written when it bypasses the rollup, as an SLA breach does", async () => {
    const title: string = "Rollout of {{ .Values.image.tag }} stalled";

    const next: NextMock = await sendAsOwnerNotification(ownerEnvelope(title), {
      forceImmediate: true,
    });

    expect(next).not.toHaveBeenCalled();
    expect(deliveredMail().subject).toBe(`[New Incident #12] - ${title}`);
  });
});

/*
 * Pins why the flag is needed: without it the mailer still compiles the
 * subject, which is right for a template and wrong for finished text.
 */
describe("the same subject without the flag", () => {
  function unmarked(title: string): EmailEnvelope {
    const envelope: EmailEnvelope = ownerEnvelope(title);
    delete envelope.isSubjectLiteral;
    return envelope;
  }

  test("loses a bare expression from the subject", async () => {
    const next: NextMock = await sendAsOwnerNotification(
      unmarked("Deploy blocked on {{ x }}"),
    );

    expect(next).not.toHaveBeenCalled();
    expect(deliveredMail().subject).toBe(
      "[New Incident #12] - Deploy blocked on ",
    );
  });

  test("fails to parse a lone opening pair of braces, so nothing is sent", async () => {
    const next: NextMock = await sendAsOwnerNotification(
      unmarked("Config parser stopped at {{ on line 3"),
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(String(next.mock.calls[0]![0])).toContain("Parse error");
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("is compiled against the email's variables, as a template subject should be", async () => {
    const next: NextMock = await sendAsOwnerNotification({
      templateType: EmailTemplateType.BlankTemplate,
      vars: { body: "<p>Report</p>", statusPageName: "Acme Status" },
      subject: "[Report] {{statusPageName}}",
    });

    expect(next).not.toHaveBeenCalled();
    expect(deliveredMail().subject).toBe("[Report] Acme Status");
  });
});
