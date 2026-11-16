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
import { getGlobalSMTPConfig } from "../../FeatureSet/Notification/Config";
import MailService from "../../FeatureSet/Notification/Services/MailService";
import "../../FeatureSet/Notification/API/Mail";

/*
 * WHO IS COPIED, AND WHERE A REPLY GOES, CROSSES TO THE NOTIFICATION
 * SERVICE AS TEXT (issue #8893).
 *
 * A server sends an email by posting it to the notification service's
 * /send route (Common's MailService), which hands it to a transport. Give
 * Feedback's email copies the person who wrote it and asks that a reply go
 * to them; an Email object would cross JSON as an object of its own, and a
 * route that read only the fields it always read would drop both without a
 * word. Each test posts along the production path - the Common client, the
 * request body through JSON as on the wire, the /send route, MailService
 * and nodemailer - and reads what the transport was handed. Only
 * infrastructure and the transport are mocked, as in
 * OwnerEmailSubjectLiteral.test.ts.
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

jest.mock(
  "Common/Server/Utils/Notification/BlockedProjectNotifications",
  () => {
    return {
      __esModule: true,
      default: {
        getRefusal: jest.fn<() => Promise<null>>().mockResolvedValue(null),
      },
    };
  },
);

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

interface CapturedMail {
  to: string;
  cc?: Array<string>;
  replyTo?: string;
  subject: string;
}

type SendMail = (mail: CapturedMail) => Promise<{ messageId: string }>;

const sendMail: ReturnType<typeof jest.fn<SendMail>> = jest.fn<SendMail>();

type NextMock = ReturnType<typeof jest.fn<NextFunction>>;

const INSTANCE_SMTP: EmailServer = {
  host: new Hostname("smtp.oneuptime.test"),
  port: new Port(587),
  secure: true,
  username: "oneuptime",
  password: "smtp-password",
  fromName: "OneUptime",
  fromEmail: new Email("notifications@oneuptime.test"),
};

const TEAM: string = "support@oneuptime.test";
const PERSON: string = "jane@acme.test";

function feedbackEmail(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    toEmail: new Email(TEAM),
    ccEmails: [new Email(PERSON)],
    replyToEmail: new Email(PERSON),
    templateType: EmailTemplateType.BlankTemplate,
    vars: { body: "<p>The SLO page shows no budget.</p>" },
    subject: "Feedback (Something's broken): The SLO page shows no budget",
    isSubjectLiteral: true,
    ...overrides,
  };
}

function requestBody(): JSONObject {
  expect(API.post).toHaveBeenCalledTimes(1);

  return (jest.mocked(API.post).mock.calls[0]![0] as { data: JSONObject }).data;
}

// Hands `body` to the /send route as JSON, as the wire would.
async function deliver(body: JSONObject): Promise<NextMock> {
  const next: NextMock = jest.fn<NextFunction>();

  await mockRouter.match("post", "/send").handlerFunction(
    { body: JSON.parse(JSON.stringify(body)) } as ExpressRequest,
    {} as ExpressResponse,
    // Express's NextFunction is overloaded, which a plain mock cannot satisfy.
    next as unknown as NextFunction,
  );

  return next;
}

function deliveredMail(): CapturedMail {
  expect(sendMail).toHaveBeenCalledTimes(1);
  return sendMail.mock.calls[0]![0];
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getGlobalSMTPConfig).mockResolvedValue(INSTANCE_SMTP);
  jest.mocked(API.post).mockResolvedValue({} as never);

  sendMail.mockResolvedValue({ messageId: "mocked-delivery" });
  jest.mocked(nodemailer.createTransport).mockReturnValue({
    sendMail,
    close: jest.fn(),
  } as unknown as Transporter);
});

afterEach(async () => {
  await MailService.cleanup();
});

describe("a server's email that copies someone and names a reply address", () => {
  test("is posted with the copy and the reply address as text", async () => {
    await CommonMailService.sendMail(feedbackEmail());

    const body: JSONObject = requestBody();

    expect(body["toEmail"]).toBe(TEAM);
    expect(body["ccEmails"]).toEqual([PERSON]);
    expect(body["replyToEmail"]).toBe(PERSON);
  });

  test("reaches the transport with both, through the /send route", async () => {
    await CommonMailService.sendMail(feedbackEmail());

    const next: NextMock = await deliver(requestBody());

    expect(next).not.toHaveBeenCalled();

    const mail: CapturedMail = deliveredMail();

    expect(mail.to).toBe(TEAM);
    expect(mail.cc).toEqual([PERSON]);
    expect(mail.replyTo).toBe(PERSON);
  });

  test("the To copied again is left out of the copies before it is posted", async () => {
    await CommonMailService.sendMail(
      feedbackEmail({ ccEmails: [new Email(TEAM), new Email(PERSON)] }),
    );

    expect(requestBody()["ccEmails"]).toEqual([PERSON]);
  });
});

describe("every other email", () => {
  test("is posted with no copy and no reply address, exactly as before", async () => {
    await CommonMailService.sendMail(
      feedbackEmail({ ccEmails: undefined, replyToEmail: undefined }),
    );

    const body: JSONObject = requestBody();

    expect(Object.keys(body)).not.toContain("ccEmails");
    expect(Object.keys(body)).not.toContain("replyToEmail");

    await deliver(body);

    const mail: CapturedMail = deliveredMail();

    expect(mail).not.toHaveProperty("cc");
    expect(mail).not.toHaveProperty("replyTo");
  });
});

describe("the /send route reads only addresses that are one mailbox each", () => {
  test.each([
    ["a list", "jane@acme.test, mallory@evil.test"],
    ["a name with an address", "Jane <jane@acme.test>"],
    ["no address at all", "jane"],
    ["an object, as an Email crosses JSON", { _type: "Email", value: PERSON }],
  ])(
    "a copy that is %s is left out, and the email still goes",
    async (_name: string, value: unknown) => {
      const next: NextMock = await deliver({
        toEmail: TEAM,
        subject: "Feedback",
        isSubjectLiteral: true,
        templateType: EmailTemplateType.BlankTemplate,
        vars: { body: "<p>Words.</p>" },
        ccEmails: [value, PERSON] as unknown as JSONObject,
        replyToEmail: value as unknown as string,
      });

      expect(next).not.toHaveBeenCalled();

      const mail: CapturedMail = deliveredMail();

      expect(mail.to).toBe(TEAM);
      expect(mail.cc).toEqual([PERSON]);
      expect(mail).not.toHaveProperty("replyTo");
    },
  );

  test("copies that are not a list are no copies", async () => {
    await deliver({
      toEmail: TEAM,
      subject: "Feedback",
      isSubjectLiteral: true,
      templateType: EmailTemplateType.BlankTemplate,
      vars: { body: "<p>Words.</p>" },
      ccEmails: PERSON,
    });

    expect(deliveredMail()).not.toHaveProperty("cc");
  });
});
