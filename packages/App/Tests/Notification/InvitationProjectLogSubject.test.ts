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
import { mockRouter } from "Common/Tests/Server/API/Helpers";
import { visibleText } from "Common/Tests/Helpers/HtmlText";
import CommonMailService from "Common/Server/Services/MailService";
import EmailLogService from "Common/Server/Services/EmailLogService";
import ServerEmailLogRecorder from "Common/Server/Utils/ServerSending/ServerEmailLogRecorder";
import { getServerTranslator } from "Common/Server/Utils/ServerTranslation";
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
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import { getInvitationSubject } from "Common/Types/Team/InvitationEmailWords";
import API from "Common/Utils/API";
import { getGlobalSMTPConfig } from "../../FeatureSet/Notification/Config";
import MailService from "../../FeatureSet/Notification/Services/MailService";
import "../../FeatureSet/Notification/API/Mail";
import "../../FeatureSet/Notification/Utils/Handlebars";

/*
 * THE PROJECT'S EMAIL LOG KEEPS AN INVITATION'S SUBJECT IN THE INVITER'S
 * LANGUAGE (#9897).
 *
 * An invitation is written in the invitee's own language when their account
 * picked one (Common/Types/Team/InvitationEmailWords). The project's email
 * log, which its members and viewers read, must not say which language
 * that was: an account an invitation makes has none, so a German subject
 * there would tell the inviting project that the address already had an
 * account, and that it reads German - what #9823 keeps from it. So the
 * invitation carries the subject the log keeps (EmailEnvelope
 * .projectLogSubject): the one it has for an invitee with no language of
 * their own, the inviter's.
 *
 * Here the email goes the way an invitation goes: through Common's mail
 * client (CommonMailService.sendMail, which posts it), over the wire to the
 * Notification service's /send route (API/Mail.ts), and through MailService
 * to the mail transport - with the database and the transport stood in for.
 * What the invitee is sent, what the project's log keeps, and what the
 * server's own log keeps are read where each is written.
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
    getGlobalEmailProviderServer: jest.fn(),
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    IsDevelopment: false,
    IsBillingEnabled: false,
    AppApiHostname: "app",
  };
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
    default: { findOneById: jest.fn(), updateOneById: jest.fn() },
  };
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
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => {
      return {};
    }),
  };
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

const PROJECT_ID: ObjectID = new ObjectID(
  "98970000-0000-4000-8000-000000000001",
);
const INVITEE_ID: ObjectID = new ObjectID(
  "98970000-0000-4000-8000-000000000002",
);
const INVITEE: string = "grete@firma.example";
const PROJECT: string = "Acme Production";
const INVITER: string = "Ada Walker";

// The subject, as TeamMemberService writes it in a language.
function subjectIn(language: string): string {
  return getInvitationSubject(getServerTranslator(language), {
    projectName: PROJECT,
    inviterName: INVITER,
    isAccepted: false,
  });
}

/*
 * The invitation, as TeamMemberService.buildInvitationEmail builds it for a
 * German invitee invited by someone who picked no language: German, with
 * the log's subject in English.
 */
function germanInvitation(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    toEmail: new Email(INVITEE),
    templateType: EmailTemplateType.InviteMember,
    vars: {
      signInLink: "https://oneuptime.test/accounts",
      registerLink: "https://oneuptime.test/accounts/register",
      isNewUser: "false",
      isInvitationAccepted: "false",
      isSsoSignIn: "false",
      ssoSignInLink: "https://oneuptime.test/accounts/sso",
      projectName: PROJECT,
      homeUrl: "https://oneuptime.test",
      inviterLabel: `${INVITER} (ada@walk.example)`,
      inviterName: INVITER,
    },
    subject: subjectIn("de"),
    projectLogSubject: subjectIn("en"),
    isSubjectLiteral: true,
    language: "de",
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

// Sends `mail` the way an invitation goes, through the wire.
async function sendThroughTheWire(mail: EmailMessage): Promise<NextMock> {
  await CommonMailService.sendMail(mail, {
    projectId: PROJECT_ID,
    userId: INVITEE_ID,
  });

  return await deliver(requestBody());
}

function deliveredMail(): CapturedMail {
  expect(sendMail).toHaveBeenCalledTimes(1);
  return sendMail.mock.calls[0]![0];
}

// The subjects of the project's Email Log rows written.
function projectLogSubjects(): Array<unknown> {
  return (
    jest.mocked(EmailLogService.create).mock.calls as Array<Array<unknown>>
  ).map((call: Array<unknown>): unknown => {
    return (call[0] as { data: Record<string, unknown> }).data["subject"];
  });
}

// The subjects the server's own email log was handed.
function serverLogSubjects(
  record: jest.SpiedFunction<typeof ServerEmailLogRecorder.record>,
): Array<string> {
  return record.mock.calls.map(
    (call: [Parameters<typeof ServerEmailLogRecorder.record>[0]]): string => {
      return call[0].subject;
    },
  );
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

let record: jest.SpiedFunction<typeof ServerEmailLogRecorder.record>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getGlobalSMTPConfig).mockResolvedValue(INSTANCE_SMTP);
  jest.mocked(API.post).mockResolvedValue({} as never);

  sendMail.mockResolvedValue({ messageId: "mocked-delivery" });
  jest.mocked(nodemailer.createTransport).mockReturnValue({
    sendMail,
    close: jest.fn(),
  } as unknown as Transporter);

  record = jest
    .spyOn(ServerEmailLogRecorder, "record")
    .mockResolvedValue(undefined);
});

afterEach(async () => {
  record.mockRestore();
  await MailService.cleanup();
});

describe("an invitation written in the invitee's language", () => {
  test("the subjects differ: German for the invitee, English for the log", () => {
    expect(subjectIn("de")).toBe(
      "Ada Walker hat Sie zu Acme Production eingeladen",
    );
    expect(subjectIn("en")).toBe("Ada Walker invited you to Acme Production");
  });

  test("Common's mail client posts the log's subject beside the one sent", async () => {
    await CommonMailService.sendMail(germanInvitation(), {
      projectId: PROJECT_ID,
      userId: INVITEE_ID,
    });

    const body: JSONObject = requestBody();

    expect(body["subject"]).toBe(subjectIn("de"));
    expect(body["projectLogSubject"]).toBe(subjectIn("en"));
    expect(body["language"]).toBe("de");
    expect(body["projectId"]).toBe(PROJECT_ID.toString());
  });

  test("the invitee is sent the German email, under its German subject", async () => {
    const next: NextMock = await sendThroughTheWire(germanInvitation());

    expect(next).not.toHaveBeenCalled();

    const mail: CapturedMail = deliveredMail();

    expect(mail.to).toBe(INVITEE);
    expect(mail.subject).toBe(subjectIn("de"));
    expect(mail.html).toContain('lang="de"');
    expect(visibleText(mail.html)).toContain(
      "Ada Walker (ada@walk.example) hat Sie eingeladen, Acme Production auf OneUptime beizutreten.",
    );
    expect(visibleText(mail.html)).not.toContain("invited you to join");
  });

  test("the project's email log keeps the English subject, never the German", async () => {
    await sendThroughTheWire(germanInvitation());

    expect(projectLogSubjects()).toEqual([subjectIn("en")]);
    expect(JSON.stringify(projectLogSubjects())).not.toContain("eingeladen");
  });

  test("the server's own log, read by master admins, keeps the subject sent", async () => {
    await sendThroughTheWire(germanInvitation());

    expect(serverLogSubjects(record)).toEqual([subjectIn("de")]);
  });

  test("so does the project's log of an invitation the mail service refused: still the English subject", async () => {
    sendMail.mockRejectedValue(new Error("535 5.7.8 Authentication failed"));

    await sendThroughTheWire(germanInvitation());

    expect(projectLogSubjects()).toEqual([subjectIn("en")]);
    expect(serverLogSubjects(record)).toEqual([subjectIn("de")]);
  });

  test("the log's subject is held to the same redaction as any subject", async () => {
    const link: string = `https://status.example.test/unsubscribe/${ObjectID.generate().toString()}-${"a".repeat(64)}`;

    await sendThroughTheWire(
      germanInvitation({ projectLogSubject: `Unsubscribe: ${link}` }),
    );

    const logged: string = String(projectLogSubjects()[0]);

    expect(logged).toContain("[redacted]");
    expect(logged).not.toContain("a".repeat(64));
  });
});

describe("every other email", () => {
  test("is posted with no log subject, exactly as before", async () => {
    const mail: EmailMessage = germanInvitation();
    delete mail.projectLogSubject;
    delete mail.language;

    await CommonMailService.sendMail(mail, {
      projectId: PROJECT_ID,
      userId: INVITEE_ID,
    });

    expect(Object.keys(requestBody())).not.toContain("projectLogSubject");
  });

  test("keeps the subject sent in the project's log", async () => {
    await sendThroughTheWire(
      germanInvitation({ projectLogSubject: undefined }),
    );

    expect(projectLogSubjects()).toEqual([subjectIn("de")]);
  });

  test.each([
    ["that is empty", ""],
    ["of spaces", "   "],
  ])(
    "a log subject %s is none: the log keeps the subject sent",
    async (_case: string, projectLogSubject: string) => {
      await sendThroughTheWire(
        germanInvitation({ projectLogSubject: projectLogSubject }),
      );

      expect(projectLogSubjects()).toEqual([subjectIn("de")]);
    },
  );
});

describe("the /send route reads the log's subject only as text", () => {
  test.each([
    ["a number", 42],
    ["an object", { value: "Ada Walker invited you to Acme Production" }],
    ["a list", ["Ada Walker invited you to Acme Production"]],
    ["null", null],
  ])(
    "one that is %s is none, and the log keeps the subject sent",
    async (_case: string, value: unknown) => {
      const next: NextMock = await deliver({
        toEmail: INVITEE,
        subject: subjectIn("de"),
        projectLogSubject: value as unknown as string,
        isSubjectLiteral: true,
        templateType: EmailTemplateType.InviteMember,
        vars: germanInvitation().vars as JSONObject,
        language: "de",
        projectId: PROJECT_ID.toString(),
      });

      expect(next).not.toHaveBeenCalled();
      expect(projectLogSubjects()).toEqual([subjectIn("de")]);
    },
  );

  test("text is read: the log keeps it", async () => {
    await deliver({
      toEmail: INVITEE,
      subject: subjectIn("de"),
      projectLogSubject: subjectIn("en"),
      isSubjectLiteral: true,
      templateType: EmailTemplateType.InviteMember,
      vars: germanInvitation().vars as JSONObject,
      language: "de",
      projectId: PROJECT_ID.toString(),
    });

    expect(projectLogSubjects()).toEqual([subjectIn("en")]);
    expect(deliveredMail().subject).toBe(subjectIn("de"));
  });
});

describe("MailService.getProjectLogSubject", () => {
  test("is the log's subject when given, else the subject sent", () => {
    expect(
      MailService.getProjectLogSubject({
        subject: "Sent",
        projectLogSubject: "Logged",
        vars: {},
      }),
    ).toBe("Logged");
    expect(
      MailService.getProjectLogSubject({ subject: "Sent", vars: {} }),
    ).toBe("Sent");
    expect(
      MailService.getProjectLogSubject({
        subject: "Sent",
        projectLogSubject: " ",
        vars: {},
      }),
    ).toBe("Sent");
  });
});
