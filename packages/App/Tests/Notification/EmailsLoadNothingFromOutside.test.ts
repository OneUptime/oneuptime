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
import { ProductBranding } from "Common/Types/Branding/ProductBranding";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import MailTransportType from "Common/Types/Email/MailTransportType";
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import {
  CarriedLogo,
  CarriedLogoReader,
  toCarriedLogo,
} from "Common/Server/Utils/Mail/EmailCarriedLogos";
import EmailLogo, { EMAIL_LOGO_PATH } from "Common/Server/Utils/Mail/EmailLogo";
import { markupAsSpacesWithOutlookContent } from "Common/Tests/Helpers/HtmlText";
import {
  MarkupReference,
  addressHost,
  describeReference,
  readMarkupReferences,
} from "Common/Tests/Helpers/MarkupReferences";
import {
  getEmailServerType,
  getGlobalSMTPConfig,
  getSendgridConfig,
} from "../../FeatureSet/Notification/Config";
import MailService, {
  RenderedEmail,
} from "../../FeatureSet/Notification/Services/MailService";
import SMTPOAuthService from "../../FeatureSet/Notification/Services/SMTPOAuthService";
import { BRAND_VARIABLE_NAMES } from "../../FeatureSet/Notification/Utils/EmailBranding";
import "../../FeatureSet/Notification/Utils/Handlebars";
import {
  VariableSet,
  variableSetsFor,
} from "./Fixtures/EmailTemplateVariables";

/*
 * EVERY EMAIL CARRIES ITS OWN LOGO, AND LOADS NOTHING FROM OUTSIDE THE
 * INSTALLATION (issue #5124).
 *
 * The header of every email that shows OneUptime's branding loaded its logo
 * from res.cloudinary.com. On a network without the internet every email
 * showed a broken image there; everywhere else, every email opened asked a
 * third party for it, telling it who opened which email, and when, and a
 * mail gateway could flag the remote image.
 *
 * Now OneUptime's logo is the image itself: render() writes it as a data:
 * URL, which a browser shows (a preview), and send() moves it into an inline
 * attachment the HTML points at by Content-ID, on every way the
 * installation sends email. A logo the installation's operator uploaded -
 * its own, or a status page's - is rendered from the installation's own
 * address, and goes out inside the email too, in that address's place,
 * when every mail client draws it and it is small enough
 * (EmailCarriedLogos); otherwise it keeps the address. A renamed
 * installation still shows its name.
 *
 * This suite renders and sends through the real MailService - production
 * Handlebars helpers and partials, every template file, every transport's
 * payload - with only infrastructure and the network mocked:
 *
 *   - the header, for each way an installation shows itself, with HOST set
 *     and unset, and with a logo file that cannot be read;
 *   - every template, rendered with every way its rows come and go, loads
 *     nothing but an image the email carries or one on the installation's
 *     own host, and links nowhere but there, OneUptime's site (not renamed)
 *     and the website the operator set (renamed);
 *   - every template, as sent, carries OneUptime's logo exactly when its
 *     header shows it, and then loads nothing from any host at all;
 *   - the installation's own logo and every status page template's logo
 *     go out inside the email, and keep their address when they cannot;
 *   - the logo goes out over the installation's SMTP server, a project's,
 *     SMTP with OAuth, Microsoft Graph and SendGrid, and in the MIME message
 *     nodemailer writes.
 */

jest.mock("../../FeatureSet/Notification/Config", () => {
  return {
    getEmailServerType: jest.fn(),
    getGlobalSMTPConfig: jest.fn(),
    getSendgridConfig: jest.fn(),
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    IsDevelopment: false,
    Host: "oneuptime.example.test",
    HttpProtocol: "https://",
  };
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

jest.mock("../../FeatureSet/Notification/Services/SMTPOAuthService", () => {
  return { __esModule: true, default: { getAccessToken: jest.fn() } };
});

// The installation's own host (HOST, mocked above).
const INSTALL_HOST: string = "oneuptime.example.test";

const environment: { Host: string } = jest.requireMock(
  "Common/Server/EnvironmentConfig",
) as { Host: string };

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);

const LOGO: string = fs.readFileSync(EMAIL_LOGO_PATH).toString("base64");
const LOGO_DATA_URL: string = `data:image/png;base64,${LOGO}`;
const LOGO_FILE_NAME: string = "oneuptime-logo.png";

const CUSTOM_LOGO_PATH: string = "/api/branding/logo?v=7";
const CUSTOM_LOGO_URL: string = `https://${INSTALL_HOST}${CUSTOM_LOGO_PATH}`;
const ACME_WEBSITE_HOST: string = "ops.acme.example.test";

/*
 * The installation's own logo, as the enterprise module hands its bytes
 * over: a GIF, so the attachment's type is the bytes', not a default.
 */
const CUSTOM_LOGO_BYTES: Buffer = Buffer.concat([
  Buffer.from("GIF89a", "latin1"),
  Buffer.alloc(1200, 0x2a),
]);

// A status page's logo, on the page's logo route on this host.
const STATUS_PAGE_ID: string = "2b0f6f3f-6c11-4bd1-8bb0-0d3b1c0e58f1";
const STATUS_PAGE_LOGO_URL: string = `https://${INSTALL_HOST}/status-page-api/logo/${STATUS_PAGE_ID}`;
const STATUS_PAGE_LOGO_BYTES: Buffer = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(2400, 0x3c),
]);

// The installation's own logo bytes, as the enterprise module hands them over.
const carryProductLogo: (bytes: Buffer | null) => void = (
  bytes: Buffer | null,
): void => {
  jest
    .spyOn(EnterpriseEdition, "getProductBrandingLogo")
    .mockReturnValue(bytes);
};

/*
 * A status page logo reader, as the notification service registers one
 * when it starts (Notification/Index.ts, StatusPageCarriedLogo): this one
 * knows the page above, and records what it is asked.
 */
const statusPageLogoReader: () => {
  read: CarriedLogoReader;
  asked: Array<string>;
} = (): { read: CarriedLogoReader; asked: Array<string> } => {
  const asked: Array<string> = [];

  return {
    asked: asked,
    read: async (address: string): Promise<CarriedLogo | null> => {
      asked.push(address);

      return address === STATUS_PAGE_LOGO_URL
        ? toCarriedLogo(STATUS_PAGE_LOGO_BYTES, "logo")
        : null;
    },
  };
};

// The SMTP attachment a carried logo goes out as.
const smtpCarriedLogo: (
  contentId: string,
  bytes: Buffer,
) => Record<string, unknown> = (
  contentId: string,
  bytes: Buffer,
): Record<string, unknown> => {
  const logo: CarriedLogo = toCarriedLogo(bytes, "logo") as CarriedLogo;
  const type: string = logo.dataUri.slice(
    "data:".length,
    logo.dataUri.indexOf(";"),
  );

  return {
    filename: logo.fileName,
    content: bytes.toString("base64"),
    encoding: "base64",
    contentType: type,
    contentDisposition: "inline",
    cid: contentId,
  };
};

interface BrandingCase {
  label: string;
  branding: ProductBranding | null;
  // Hosts the email may link to besides the installation's own.
  linkHosts: Array<string>;
  // Whether its header shows OneUptime's logo.
  showsOneUptimeLogo: boolean;
}

const BRANDING_CASES: Array<BrandingCase> = [
  {
    label: "OneUptime's own branding",
    branding: null,
    linkHosts: ["oneuptime.com"],
    showsOneUptimeLogo: true,
  },
  {
    label: "a logo of the installation's own",
    branding: { logoUrl: CUSTOM_LOGO_PATH, isLogoEmailSafe: true },
    linkHosts: ["oneuptime.com"],
    showsOneUptimeLogo: false,
  },
  {
    label: "a renamed product",
    branding: {
      productName: "Acme Ops",
      websiteUrl: `https://${ACME_WEBSITE_HOST}`,
    },
    linkHosts: [ACME_WEBSITE_HOST],
    showsOneUptimeLogo: false,
  },
  {
    label: "a renamed product with a logo of its own",
    branding: {
      productName: "Acme Ops",
      websiteUrl: `https://${ACME_WEBSITE_HOST}`,
      logoUrl: CUSTOM_LOGO_PATH,
      isLogoEmailSafe: true,
    },
    linkHosts: [ACME_WEBSITE_HOST],
    showsOneUptimeLogo: false,
  },
];

const SMTP_SERVER: EmailServer = {
  host: new Hostname("smtp.example.test"),
  port: new Port(587),
  secure: true,
  username: "notifications@example.test",
  password: "password",
  fromName: "OneUptime Notifications",
  fromEmail: new Email("notifications@example.test"),
};

const PROJECT_SMTP_SERVER: EmailServer = {
  ...SMTP_SERVER,
  id: ObjectID.generate(),
  host: new Hostname("smtp.acme.example.test"),
  fromName: "Acme Status",
  fromEmail: new Email("status@acme.example.test"),
};

const OAUTH_SMTP_SERVER: EmailServer = {
  ...SMTP_SERVER,
  id: ObjectID.generate(),
  host: new Hostname("smtp.office365.com"),
  username: "sender@contoso.com",
  password: undefined,
  fromEmail: new Email("sender@contoso.com"),
  authType: SMTPAuthenticationType.OAuth,
  clientId: "client-id",
  clientSecret: "client-secret",
  tokenUrl: URL.fromString(
    "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
  ),
  scope: "https://outlook.office365.com/.default",
  oauthProviderType: OAuthProviderType.ClientCredentials,
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

const CID_SOURCE: string = 'src="cid:';

// The Content-IDs an email's images point at, in order.
const contentIdsIn: (html: string) => Array<string> = (
  html: string,
): Array<string> => {
  return html
    .split(CID_SOURCE)
    .slice(1)
    .map((rest: string): string => {
      return rest.slice(0, rest.indexOf('"'));
    });
};

const WHITESPACE_RUN: RegExp = /\s+/g;

// The words of an email in every client, what only Outlook shows included.
const textOf: (html: string) => string = (html: string): string => {
  return markupAsSpacesWithOutlookContent(html)
    .replace(WHITESPACE_RUN, " ")
    .trim();
};

const brandAs: (branding: ProductBranding | null) => void = (
  branding: ProductBranding | null,
): void => {
  jest.spyOn(EnterpriseEdition, "getProductBranding").mockReturnValue(branding);
};

const readTemplate: (name: string) => string = (name: string): string => {
  return fs.readFileSync(Path.join(TEMPLATES_DIR, name), "utf8");
};

const catalog: Array<string> = fs
  .readdirSync(TEMPLATES_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".hbs");
  })
  .sort();

// Whether a template's header is OneUptime's (the Logo partial).
const showsLogoPartial: (name: string) => boolean = (name: string): boolean => {
  return readTemplate(name).includes("{{> Logo");
};

// An invitation: a template whose header is OneUptime's, with a home link.
const invitation: () => EmailMessage = (): EmailMessage => {
  return {
    toEmail: new Email("alice@example.test"),
    subject: "You have been invited to {{projectName}}",
    templateType: EmailTemplateType.InviteMember,
    vars: {
      homeURL: `https://${INSTALL_HOST}`,
      isInvitationAccepted: "false",
      isNewUser: "false",
      projectName: "Production",
      registerLink: `https://${INSTALL_HOST}/accounts/register`,
      signInLink: `https://${INSTALL_HOST}/accounts`,
    } as EmailMessage["vars"],
  };
};

const templateEmail: (
  name: string,
  variables: Record<string, unknown>,
) => EmailMessage = (
  name: string,
  variables: Record<string, unknown>,
): EmailMessage => {
  return {
    toEmail: new Email("alice@example.test"),
    subject: "A notification",
    isSubjectLiteral: true,
    templateType: name as EmailTemplateType,
    vars: variables as EmailMessage["vars"],
  };
};

/*
 * What an email loads from anywhere but the installation, and the hosts it
 * links to that `linkHosts` does not allow, one message a problem.
 */
const outsideReferences: (
  html: string,
  linkHosts: ReadonlyArray<string>,
) => Array<string> = (
  html: string,
  linkHosts: ReadonlyArray<string>,
): Array<string> => {
  const problems: Array<string> = [];

  for (const reference of readMarkupReferences(html)) {
    const host: string | null = addressHost(reference.value);
    const value: string = reference.value.trim().toLowerCase();

    if (reference.loads) {
      const isCarried: boolean =
        value.startsWith("cid:") || value.startsWith("data:");

      if (!isCarried && host !== INSTALL_HOST) {
        problems.push(`${describeReference(reference)} loads from outside`);
      }

      continue;
    }

    if (host !== null && host !== INSTALL_HOST && !linkHosts.includes(host)) {
      problems.push(`${describeReference(reference)} links to ${host}`);
    }
  }

  return problems;
};

// What an email loads, as written.
const loadedValues: (html: string) => Array<string> = (
  html: string,
): Array<string> => {
  return readMarkupReferences(html)
    .filter((reference: MarkupReference): boolean => {
      return reference.loads;
    })
    .map((reference: MarkupReference): string => {
      return reference.value;
    });
};

async function deliverOverSmtp(
  mail: EmailMessage,
  server: EmailServer = SMTP_SERVER,
): Promise<CapturedSmtpMail> {
  sendMail.mockClear();

  await MailService.send(mail, { emailServer: server });

  expect(sendMail).toHaveBeenCalledTimes(1);

  return sendMail.mock.calls[0]![0];
}

// The SMTP attachment OneUptime's logo goes out as.
const smtpLogo: (contentId: string) => Record<string, unknown> = (
  contentId: string,
): Record<string, unknown> => {
  return {
    filename: LOGO_FILE_NAME,
    content: LOGO,
    encoding: "base64",
    contentType: "image/png",
    contentDisposition: "inline",
    cid: contentId,
  };
};

beforeAll(async () => {
  const partialNames: Array<string> = fs
    .readdirSync(Path.join(TEMPLATES_DIR, "Partials"))
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
  environment.Host = INSTALL_HOST;
  brandAs(null);
  jest.mocked(getEmailServerType).mockResolvedValue("Custom SMTP" as never);
  sendMail.mockResolvedValue({ messageId: "mocked-delivery" });
  jest.mocked(nodemailer.createTransport).mockReturnValue({
    sendMail,
    close: jest.fn(),
  } as unknown as Transporter);
  jest
    .mocked(SMTPOAuthService.getAccessToken)
    .mockResolvedValue("oauth-access-token");
});

afterEach(async () => {
  jest.restoreAllMocks();
  environment.Host = INSTALL_HOST;
  MailService.carryStatusPageLogosWith(null);
  await MailService.cleanup();
});

describe("the header, for each way an installation shows itself", () => {
  test("OneUptime's own: its logo, the image itself, beside its name", async () => {
    const rendered: RenderedEmail = await MailService.render(invitation());

    expect(rendered.body).toContain(
      `<img src="${LOGO_DATA_URL}" width="32" height="32" alt="OneUptime" style="display: block; width: 32px; height: 32px; border-radius: 6px;">`,
    );
    expect(rendered.body).toContain(">OneUptime</td>");
    // The logo still links home, as it did.
    expect(rendered.body).toContain(
      `<a href="https://${INSTALL_HOST}" style="text-decoration: none;">`,
    );
  });

  test("OneUptime's own, sent: the image goes out inside the email, by Content-ID", async () => {
    const payload: CapturedSmtpMail = await deliverOverSmtp(invitation());
    const contentIds: Array<string> = contentIdsIn(payload.html);

    expect(contentIds).toHaveLength(1);
    expect(payload.html).toContain(
      `<img src="cid:${contentIds[0]}" width="32" height="32" alt="OneUptime"`,
    );
    expect(payload.attachments).toEqual([smtpLogo(contentIds[0]!)]);
    expect(payload.html).not.toContain("data:image");
  });

  test("a logo of the installation's own, rendered: shown from its own address, as a preview shows it", async () => {
    brandAs({ logoUrl: CUSTOM_LOGO_PATH, isLogoEmailSafe: true });
    carryProductLogo(CUSTOM_LOGO_BYTES);

    const rendered: RenderedEmail = await MailService.render(invitation());

    expect(rendered.body).toContain(
      `<img src="${Handlebars.escapeExpression(CUSTOM_LOGO_URL)}" height="32" alt="OneUptime" style="display: block; height: 32px; width: auto; max-width: 200px; border: 0;">`,
    );
  });

  test("a logo of the installation's own, sent: the logo itself goes out inside the email, by Content-ID", async () => {
    brandAs({ logoUrl: CUSTOM_LOGO_PATH, isLogoEmailSafe: true });
    carryProductLogo(CUSTOM_LOGO_BYTES);

    const payload: CapturedSmtpMail = await deliverOverSmtp(invitation());
    const contentIds: Array<string> = contentIdsIn(payload.html);

    expect(contentIds).toHaveLength(1);
    expect(payload.html).toContain(
      `<img src="cid:${contentIds[0]}" height="32" alt="OneUptime" style="display: block; height: 32px; width: auto; max-width: 200px; border: 0;">`,
    );
    expect(payload.attachments).toEqual([
      smtpCarriedLogo(contentIds[0]!, CUSTOM_LOGO_BYTES),
    ]);
    // Nothing is loaded from anywhere when it is opened, the address included.
    expect(loadedValues(payload.html)).toEqual([`cid:${contentIds[0]}`]);
    expect(payload.html).not.toContain(CUSTOM_LOGO_PATH);
    expect(payload.html).not.toContain("data:image");
  });

  test("a logo of the installation's own that cannot go inside the email: shown from its own address, as before", async () => {
    brandAs({ logoUrl: CUSTOM_LOGO_PATH, isLogoEmailSafe: true });

    // The enterprise module hands over no bytes, then too many.
    for (const bytes of [
      null,
      Buffer.concat([CUSTOM_LOGO_BYTES, Buffer.alloc(512 * 1024)]),
    ]) {
      carryProductLogo(bytes);

      const payload: CapturedSmtpMail = await deliverOverSmtp(invitation());

      expect(loadedValues(payload.html)).toEqual([
        Handlebars.escapeExpression(CUSTOM_LOGO_URL),
      ]);
      expect(payload.attachments).toBeUndefined();
    }
  });

  test("a renamed product: its name, no image and nothing attached", async () => {
    brandAs({ productName: "Acme Ops" });

    const payload: CapturedSmtpMail = await deliverOverSmtp(invitation());

    expect(loadedValues(payload.html)).toEqual([]);
    expect(payload.attachments).toBeUndefined();
    expect(textOf(payload.html).startsWith("Acme Ops")).toBe(true);
  });

  test("a renamed product with a logo of its own: that logo, named after it, inside the email", async () => {
    brandAs({
      productName: "Acme Ops",
      logoUrl: CUSTOM_LOGO_PATH,
      isLogoEmailSafe: true,
    });
    carryProductLogo(CUSTOM_LOGO_BYTES);

    const payload: CapturedSmtpMail = await deliverOverSmtp(invitation());
    const contentIds: Array<string> = contentIdsIn(payload.html);

    expect(payload.html).toContain(
      `<img src="cid:${contentIds[0]}" height="32" alt="Acme Ops"`,
    );
    expect(payload.attachments).toEqual([
      smtpCarriedLogo(contentIds[0]!, CUSTOM_LOGO_BYTES),
    ]);
  });

  describe("with HOST unset", () => {
    test("OneUptime's logo needs no host: it is still in the email", async () => {
      environment.Host = "";

      const payload: CapturedSmtpMail = await deliverOverSmtp(invitation());

      expect(payload.attachments).toEqual([
        smtpLogo(contentIdsIn(payload.html)[0]!),
      ]);
    });

    test("a logo of its own it cannot address gives way to OneUptime's, carried", async () => {
      environment.Host = "";
      brandAs({ logoUrl: CUSTOM_LOGO_PATH, isLogoEmailSafe: true });

      const payload: CapturedSmtpMail = await deliverOverSmtp(invitation());

      expect(payload.html).not.toContain(CUSTOM_LOGO_PATH);
      expect(payload.attachments).toEqual([
        smtpLogo(contentIdsIn(payload.html)[0]!),
      ]);
    });

    test("a renamed product with a logo it cannot address shows its name", async () => {
      environment.Host = "";
      brandAs({
        productName: "Acme Ops",
        logoUrl: CUSTOM_LOGO_PATH,
        isLogoEmailSafe: true,
      });

      const payload: CapturedSmtpMail = await deliverOverSmtp(invitation());

      expect(loadedValues(payload.html)).toEqual([]);
      expect(payload.attachments).toBeUndefined();
      expect(textOf(payload.html).startsWith("Acme Ops")).toBe(true);
    });
  });

  test("a logo file that cannot be read: OneUptime's name alone, never a broken image, and every email still goes", async () => {
    jest.spyOn(EmailLogo, "getDataUrl").mockReturnValue(null);

    const payload: CapturedSmtpMail = await deliverOverSmtp(invitation());

    expect(loadedValues(payload.html)).toEqual([]);
    expect(payload.attachments).toBeUndefined();
    expect(textOf(payload.html).startsWith("OneUptime")).toBe(true);
  });
});

/*
 * A status page's emails show its logo by its address on the page's logo
 * route (StatusPageEmailLogo). Just before one goes out, the logo itself
 * goes in that address's place, read by the reader the notification
 * service registers when it starts (StatusPageCarriedLogo).
 */
describe("a status page's logo goes inside the emails that show it", () => {
  // Every template whose header is the status page's own (CustomLogo).
  const statusPageTemplates: Array<string> = catalog.filter(
    (name: string): boolean => {
      return readTemplate(name).includes("{{> CustomLogo");
    },
  );

  const subscriberEmail: (name: string) => EmailMessage = (
    name: string,
  ): EmailMessage => {
    const everything: VariableSet = variableSetsFor(readTemplate(name), {
      leaveOut: BRAND_VARIABLE_NAMES,
    })[0]!;

    return templateEmail(name, {
      ...everything.variables,
      logoUrl: STATUS_PAGE_LOGO_URL,
      statusPageName: "Acme Status",
    });
  };

  test("twenty-odd templates show a status page's header: enough for this to mean something", () => {
    expect(statusPageTemplates.length).toBeGreaterThan(20);
  });

  test("rendered, the email shows the logo from its address, as a preview shows it", async () => {
    MailService.carryStatusPageLogosWith(statusPageLogoReader().read);

    const rendered: RenderedEmail = await MailService.render(
      subscriberEmail("SubscriberIncidentCreated.hbs"),
    );

    expect(loadedValues(rendered.body)).toEqual([STATUS_PAGE_LOGO_URL]);
  });

  test.each(statusPageTemplates)(
    "%s, sent: the page's logo inside the email, and nothing loaded when it is opened",
    async (name: string) => {
      const reader: { read: CarriedLogoReader; asked: Array<string> } =
        statusPageLogoReader();
      MailService.carryStatusPageLogosWith(reader.read);

      const payload: CapturedSmtpMail = await deliverOverSmtp(
        subscriberEmail(name),
      );
      const contentIds: Array<string> = contentIdsIn(payload.html);

      expect(reader.asked).toContain(STATUS_PAGE_LOGO_URL);
      expect(contentIds).toHaveLength(1);
      expect(payload.html).toContain(
        `<img src="cid:${contentIds[0]}" height="40" alt="Acme Status"`,
      );
      expect(payload.attachments).toEqual([
        smtpCarriedLogo(contentIds[0]!, STATUS_PAGE_LOGO_BYTES),
      ]);
      expect(
        loadedValues(payload.html).filter((value: string): boolean => {
          return !value.startsWith("cid:");
        }),
      ).toEqual([]);
    },
  );

  test("a logo the reader cannot carry keeps its address, as before", async () => {
    MailService.carryStatusPageLogosWith(async (): Promise<null> => {
      return null;
    });

    const payload: CapturedSmtpMail = await deliverOverSmtp(
      subscriberEmail("SubscriberIncidentCreated.hbs"),
    );

    expect(loadedValues(payload.html)).toEqual([STATUS_PAGE_LOGO_URL]);
    expect(payload.attachments).toBeUndefined();
  });

  test("a reader that fails keeps the address, and the email still goes", async () => {
    MailService.carryStatusPageLogosWith(async (): Promise<null> => {
      throw new Error("Database not connected");
    });

    const payload: CapturedSmtpMail = await deliverOverSmtp(
      subscriberEmail("SubscriberIncidentCreated.hbs"),
    );

    expect(loadedValues(payload.html)).toEqual([STATUS_PAGE_LOGO_URL]);
    expect(payload.attachments).toBeUndefined();
  });

  test("before the notification service registers its reader, the address stays", async () => {
    const payload: CapturedSmtpMail = await deliverOverSmtp(
      subscriberEmail("SubscriberIncidentCreated.hbs"),
    );

    expect(loadedValues(payload.html)).toEqual([STATUS_PAGE_LOGO_URL]);
    expect(payload.attachments).toBeUndefined();
  });

  test("a project's own SMTP server carries it too", async () => {
    MailService.carryStatusPageLogosWith(statusPageLogoReader().read);

    const payload: CapturedSmtpMail = await deliverOverSmtp(
      subscriberEmail("SubscriberIncidentCreated.hbs"),
      PROJECT_SMTP_SERVER,
    );

    expect(payload.from).toBe("Acme Status <status@acme.example.test>");
    expect(payload.attachments).toEqual([
      smtpCarriedLogo(contentIdsIn(payload.html)[0]!, STATUS_PAGE_LOGO_BYTES),
    ]);
  });

  test("a mail service that refuses the email for its images gets it again with the address", async () => {
    MailService.carryStatusPageLogosWith(statusPageLogoReader().read);
    sendMail.mockRejectedValueOnce(
      Object.assign(new Error("552 5.3.4 Message size exceeds fixed limit"), {
        responseCode: 552,
      }) as never,
    );

    await MailService.send(subscriberEmail("SubscriberIncidentCreated.hbs"), {
      emailServer: SMTP_SERVER,
    });

    expect(sendMail).toHaveBeenCalledTimes(2);

    const retry: CapturedSmtpMail = sendMail.mock.calls[1]![0];

    expect(retry.attachments).toBeUndefined();
    expect(loadedValues(retry.html)).toEqual([STATUS_PAGE_LOGO_URL]);
  });
});

describe("a logo the email carries goes out on every way the installation sends email", () => {
  beforeEach(() => {
    brandAs({ logoUrl: CUSTOM_LOGO_PATH, isLogoEmailSafe: true });
    carryProductLogo(CUSTOM_LOGO_BYTES);
  });

  test("Microsoft Graph: an inline file attachment the body points at", async () => {
    const requests: Array<{ url: string; body: string }> = [];

    jest.spyOn(globalThis, "fetch").mockImplementation((async (
      url: string,
      init?: { body?: string },
    ): Promise<Response> => {
      requests.push({ url: String(url), body: String(init?.body) });

      return new Response(null, { status: 202 });
    }) as typeof fetch);

    await MailService.send(invitation(), {
      emailServer: GRAPH_SERVER,
      timeout: 5000,
    });

    const message: {
      body: { content: string };
      attachments: Array<Record<string, unknown>>;
    } = (
      JSON.parse(requests[0]!.body) as {
        message: {
          body: { content: string };
          attachments: Array<Record<string, unknown>>;
        };
      }
    ).message;

    expect(message.attachments).toEqual([
      {
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: "logo.gif",
        contentType: "image/gif",
        contentBytes: CUSTOM_LOGO_BYTES.toString("base64"),
        contentId: contentIdsIn(message.body.content)[0],
        isInline: true,
      },
    ]);
    expect(message.body.content).not.toContain(CUSTOM_LOGO_PATH);
  });

  test("SendGrid: an inline attachment with its Content-ID", async () => {
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

    await MailService.send(invitation());

    const message: {
      html: string;
      attachments?: Array<Record<string, unknown>>;
    } = jest.mocked(SendgridMail.send).mock.calls[0]![0] as never;

    expect(message.attachments).toEqual([
      {
        content: CUSTOM_LOGO_BYTES.toString("base64"),
        filename: "logo.gif",
        type: "image/gif",
        disposition: "inline",
        content_id: contentIdsIn(message.html)[0],
      },
    ]);
  });

  test("the message nodemailer writes holds it as an inline part, and no address of it", async () => {
    const payload: CapturedSmtpMail = await deliverOverSmtp(invitation());
    const contentId: string = contentIdsIn(payload.html)[0]!;

    const realNodemailer: typeof nodemailer = (
      jest.requireActual("nodemailer") as { default: typeof nodemailer }
    ).default;
    const transport: Transporter = realNodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      newline: "unix",
    });
    const raw: string = (
      (await transport.sendMail(payload)) as unknown as { message: Buffer }
    ).message.toString("utf8");

    expect(raw).toContain(
      [
        "Content-Type: image/gif; name=logo.gif",
        `Content-ID: <${contentId}>`,
        "Content-Transfer-Encoding: base64",
        "Content-Disposition: inline; filename=logo.gif",
      ].join("\n"),
    );
    expect(raw).not.toContain(CUSTOM_LOGO_PATH);
  });
});

describe("every template, as MailService renders it, loads nothing from outside the installation", () => {
  /*
   * Rendered with every way its rows come and go (Fixtures/
   * EmailTemplateVariables), each value that is an address on the
   * installation's own host, as the senders build them: then the only
   * addresses that can name another host are ones a template or a partial
   * writes itself. Every branding renders the email's three main shapes
   * (every variable, none, every one empty); OneUptime's renders them all.
   */
  const CORE_SETS: ReadonlyArray<string> = [
    "every variable",
    "no variables",
    "every variable empty",
  ];

  test.each(catalog)("%s", async (name: string) => {
    const sets: Array<VariableSet> = variableSetsFor(readTemplate(name), {
      leaveOut: BRAND_VARIABLE_NAMES,
    });

    expect(sets.length).toBeGreaterThanOrEqual(3);

    const problems: Array<string> = [];

    for (const brandingCase of BRANDING_CASES) {
      brandAs(brandingCase.branding);

      for (const set of sets) {
        if (brandingCase.branding !== null && !CORE_SETS.includes(set.name)) {
          continue;
        }

        const rendered: RenderedEmail = await MailService.render(
          templateEmail(name, { ...set.variables }),
        );

        for (const problem of outsideReferences(
          rendered.body,
          brandingCase.linkHosts,
        )) {
          problems.push(`${brandingCase.label}, ${set.name}: ${problem}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });
});

describe("every template, as sent, carries OneUptime's logo exactly when its header shows it", () => {
  test("seventy-odd templates show OneUptime's header: enough for this to mean something", () => {
    expect(catalog.filter(showsLogoPartial).length).toBeGreaterThan(70);
  });

  test.each(catalog)("%s", async (name: string) => {
    const everything: VariableSet = variableSetsFor(readTemplate(name), {
      leaveOut: BRAND_VARIABLE_NAMES,
    })[0]!;

    expect(everything.name).toBe("every variable");

    const payload: CapturedSmtpMail = await deliverOverSmtp(
      templateEmail(name, { ...everything.variables }),
    );

    if (showsLogoPartial(name)) {
      const contentIds: Array<string> = contentIdsIn(payload.html);

      expect(payload.attachments).toEqual([smtpLogo(contentIds[0]!)]);
      // Then it loads nothing from any host at all: only what it carries.
      expect(
        loadedValues(payload.html).filter((value: string): boolean => {
          return !value.startsWith("cid:");
        }),
      ).toEqual([]);
    } else {
      expect(payload.attachments).toBeUndefined();
    }

    expect(outsideReferences(payload.html, ["oneuptime.com"])).toEqual([]);
  });
});

describe("OneUptime's logo goes out on every way the installation sends email", () => {
  test("the installation's own SMTP server", async () => {
    jest.mocked(getGlobalSMTPConfig).mockResolvedValue(SMTP_SERVER);

    await MailService.send(invitation());

    expect(sendMail).toHaveBeenCalledTimes(1);

    const payload: CapturedSmtpMail = sendMail.mock.calls[0]![0];

    expect(payload.attachments).toEqual([
      smtpLogo(contentIdsIn(payload.html)[0]!),
    ]);
  });

  test("a project's own SMTP server", async () => {
    const payload: CapturedSmtpMail = await deliverOverSmtp(
      invitation(),
      PROJECT_SMTP_SERVER,
    );

    expect(payload.from).toBe("Acme Status <status@acme.example.test>");
    expect(payload.attachments).toEqual([
      smtpLogo(contentIdsIn(payload.html)[0]!),
    ]);
  });

  test("SMTP, signing in with OAuth", async () => {
    const payload: CapturedSmtpMail = await deliverOverSmtp(
      invitation(),
      OAUTH_SMTP_SERVER,
    );

    expect(
      jest.mocked(nodemailer.createTransport).mock.calls[0]![0],
    ).toMatchObject({ authMethod: "XOAUTH2" });
    expect(payload.attachments).toEqual([
      smtpLogo(contentIdsIn(payload.html)[0]!),
    ]);
  });

  test("Microsoft Graph: an inline file attachment the body points at", async () => {
    const requests: Array<{ url: string; body: string }> = [];

    jest.spyOn(globalThis, "fetch").mockImplementation((async (
      url: string,
      init?: { body?: string },
    ): Promise<Response> => {
      requests.push({ url: String(url), body: String(init?.body) });

      return new Response(null, { status: 202 });
    }) as typeof fetch);

    await MailService.send(invitation(), {
      emailServer: GRAPH_SERVER,
      timeout: 5000,
    });

    expect(requests).toHaveLength(1);

    const message: {
      body: { content: string };
      attachments: Array<Record<string, unknown>>;
    } = (
      JSON.parse(requests[0]!.body) as {
        message: {
          body: { content: string };
          attachments: Array<Record<string, unknown>>;
        };
      }
    ).message;
    const contentIds: Array<string> = contentIdsIn(message.body.content);

    expect(contentIds).toHaveLength(1);
    expect(message.attachments).toEqual([
      {
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: LOGO_FILE_NAME,
        contentType: "image/png",
        contentBytes: LOGO,
        contentId: contentIds[0],
        isInline: true,
      },
    ]);
  });

  // In SendGrid's own word for it, content_id (issue #5308).
  test("SendGrid: an inline attachment with its Content-ID", async () => {
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

    await MailService.send(invitation());

    expect(sendMail).not.toHaveBeenCalled();

    const message: {
      html: string;
      attachments?: Array<Record<string, unknown>>;
    } = jest.mocked(SendgridMail.send).mock.calls[0]![0] as never;

    expect(message.attachments).toEqual([
      {
        content: LOGO,
        filename: LOGO_FILE_NAME,
        type: "image/png",
        disposition: "inline",
        content_id: contentIdsIn(message.html)[0],
      },
    ]);
  });

  test("the message nodemailer writes holds the logo as an inline part of a multipart/related message", async () => {
    const payload: CapturedSmtpMail = await deliverOverSmtp(invitation());
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
        `Content-Type: image/png; name=${LOGO_FILE_NAME}`,
        `Content-ID: <${contentId}>`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: inline; filename=${LOGO_FILE_NAME}`,
      ].join("\n"),
    );
    expect(raw.replace(/\n/g, "")).toContain(LOGO);
  });

  test("each email has a Content-ID of its own", async () => {
    const first: CapturedSmtpMail = await deliverOverSmtp(invitation());
    const second: CapturedSmtpMail = await deliverOverSmtp(invitation());

    expect(contentIdsIn(first.html)[0]).not.toBe(contentIdsIn(second.html)[0]);
  });
});
