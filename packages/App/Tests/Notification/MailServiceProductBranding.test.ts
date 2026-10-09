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
import { ProductBranding } from "Common/Types/Branding/ProductBranding";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import Port from "Common/Types/Port";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import MailService from "../../FeatureSet/Notification/Services/MailService";
import "../../FeatureSet/Notification/Utils/Handlebars";

/*
 * MailService.render puts how the installation names and shows itself
 * (EnterpriseEdition.getProductBranding, Utils/EmailBranding.ts) into every
 * email it sends, through the real send path: production helpers and
 * partials, the template files, subject compilation and the SMTP payload.
 * Only infrastructure and transport are mocked, as in
 * MailServiceEmailDesign.test.ts.
 *
 * Pinned: an installation that is not renamed sends the email it always
 * did; a renamed one names itself in the email and in a subject template's
 * own words, never touching a literal subject; the brand variables are
 * MailService's alone, whatever a sender put in them.
 */
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

interface CapturedMail {
  from: string;
  to: string;
  subject: string;
  html: string;
}

type SendMail = (mail: CapturedMail) => Promise<{ messageId: string }>;

const sendMail: ReturnType<typeof jest.fn<SendMail>> = jest.fn<SendMail>();
const HOME_URL: string = "https://status.acme.example";
const SMTP_SERVER: EmailServer = {
  host: new Hostname("smtp.example.test"),
  port: new Port(587),
  secure: true,
  username: undefined,
  password: undefined,
  fromName: "Acme Alerts",
  fromEmail: new Email("alerts@example.test"),
};

const ACME: ProductBranding = {
  productName: "Acme & Co",
  websiteUrl: "https://acme.example",
};

const HTML_TAG: RegExp = /<[^>]+>/g;

const textOf: (html: string) => string = (html: string): string => {
  return html.replace(HTML_TAG, " ");
};

const brandAs: (branding: ProductBranding | null) => void = (
  branding: ProductBranding | null,
): void => {
  jest.spyOn(EnterpriseEdition, "getProductBranding").mockReturnValue(branding);
};

const deliver: (mail: EmailMessage) => Promise<CapturedMail> = async (
  mail: EmailMessage,
): Promise<CapturedMail> => {
  await MailService.send(mail, { emailServer: SMTP_SERVER });

  const payload: CapturedMail | undefined =
    sendMail.mock.calls[sendMail.mock.calls.length - 1]?.[0];

  expect(payload).toBeDefined();

  return payload!;
};

const invitation: (subject?: string) => EmailMessage = (
  subject: string = "You have been invited to {{projectName}}",
): EmailMessage => {
  return {
    toEmail: new Email("alice@example.test"),
    subject,
    templateType: EmailTemplateType.InviteMember,
    vars: {
      homeURL: HOME_URL,
      isInvitationAccepted: "false",
      isNewUser: "false",
      projectName: "Production",
      registerLink: `${HOME_URL}/accounts/register`,
      signInLink: `${HOME_URL}/accounts`,
    } as EmailMessage["vars"],
  };
};

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

beforeEach(() => {
  jest.clearAllMocks();
  sendMail.mockResolvedValue({ messageId: "mocked-delivery" });
  jest.mocked(nodemailer.createTransport).mockReturnValue({
    sendMail,
    close: jest.fn(),
  } as unknown as Transporter);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await MailService.cleanup();
});

describe("an installation that is not renamed", () => {
  test("sends OneUptime's email: its logo, its sign-in button, Powered by OneUptime", async () => {
    brandAs(null);

    const payload: CapturedMail = await deliver(invitation());

    expect(payload.html).toContain("Sign In to OneUptime");
    expect(payload.html).toContain('href="https://oneuptime.com"');
    expect(payload.html).toContain('alt="OneUptime"');
    expect(payload.subject).toBe("You have been invited to Production");
  });

  test("an empty branding (the license allows it, nothing set) changes nothing", async () => {
    brandAs(null);
    const before: CapturedMail = await deliver(invitation());

    brandAs({});
    const after: CapturedMail = await deliver(invitation());

    expect(after.html).toBe(before.html);
    expect(after.subject).toBe(before.subject);
  });
});

describe("a renamed installation", () => {
  test("names itself in the email, escaped once, and never OneUptime", async () => {
    brandAs(ACME);

    const payload: CapturedMail = await deliver(invitation());

    expect(payload.html).toContain("Sign In to Acme &amp; Co");
    // The sentence is printed as it is (info=): the name in it is escaped once.
    expect(payload.html).toContain(
      "You've been invited to join a project on Acme &amp; Co.",
    );
    expect(payload.html).toContain('href="https://acme.example"');
    expect(payload.html).not.toContain("oneuptime.com");
    expect(textOf(payload.html)).not.toContain("OneUptime");
    expect(payload.html).not.toContain("&amp;amp;");
  });

  test("names itself in a subject template's own words, as plain text", async () => {
    brandAs(ACME);

    const payload: CapturedMail = await deliver(
      invitation("Welcome to OneUptime: {{projectName}}"),
    );

    expect(payload.subject).toBe("Welcome to Acme & Co: Production");
  });

  test("leaves a literal subject exactly as the sender wrote it", async () => {
    brandAs(ACME);

    const mail: EmailMessage = {
      ...invitation("OneUptime {{projectName}} was written by a person"),
      isSubjectLiteral: true,
    };

    const payload: CapturedMail = await deliver(mail);

    expect(payload.subject).toBe(
      "OneUptime {{projectName}} was written by a person",
    );
  });

  test("shows the name where the logo would be when it has no logo an email can draw", async () => {
    brandAs({
      ...ACME,
      logoUrl: "/api/branding/logo?v=1",
      isLogoEmailSafe: false,
    });

    const payload: CapturedMail = await deliver(invitation());

    expect(payload.html).not.toContain("/api/branding/logo");
    expect(payload.html).not.toContain('alt="OneUptime"');
  });
});

describe("the brand variables belong to MailService", () => {
  test("whatever a sender put in them is replaced by the installation's", async () => {
    brandAs(null);

    const mail: EmailMessage = invitation();

    mail.vars = {
      ...mail.vars,
      brandProductName: "Someone Else",
      isBrandRenamed: "true",
      brandWebsiteUrl: "https://evil.example",
      brandLogoUrl: "https://evil.example/logo.png",
    } as EmailMessage["vars"];

    const payload: CapturedMail = await deliver(mail);

    expect(payload.html).not.toContain("Someone Else");
    expect(payload.html).not.toContain("evil.example");
    expect(payload.html).toContain("Sign In to OneUptime");
  });
});
