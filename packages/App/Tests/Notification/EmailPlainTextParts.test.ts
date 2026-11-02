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
import Color from "Common/Types/Color";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import MailTransportType from "Common/Types/Email/MailTransportType";
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import Port from "Common/Types/Port";
import Timezone from "Common/Types/Timezone";
import ObjectID from "Common/Types/ObjectID";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import { StatusPageReport } from "Common/Types/StatusPage/StatusPageReport";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import StatusPageReportTreeUtil, {
  StatusPageReportResourceEntry,
  StatusPageReportStructure,
} from "Common/Utils/StatusPage/Report";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import IncidentSlaBreachNotice, {
  IncidentSlaBreachMessages,
} from "Common/Server/Utils/Incident/IncidentSlaBreachNotice";
import EmailPlainText, {
  MAX_EMAIL_TEXT_PART_LENGTH,
} from "Common/Server/Utils/Mail/EmailPlainText";
import { EMAIL_TRUNCATED_TEXT_NOTE } from "Common/Server/Utils/Mail/EmailSize";
import { decodeHtmlEntities } from "Common/Tests/Helpers/HtmlText";
import { readMarkupReferences } from "Common/Tests/Helpers/MarkupReferences";
import { screenReaderText } from "Common/Tests/Helpers/ScreenReaderText";
import {
  getEmailServerType,
  getSendgridConfig,
} from "../../FeatureSet/Notification/Config";
import MailService, {
  RenderedEmail,
} from "../../FeatureSet/Notification/Services/MailService";
import SMTPOAuthService from "../../FeatureSet/Notification/Services/SMTPOAuthService";
import { BRAND_VARIABLE_NAMES } from "../../FeatureSet/Notification/Utils/EmailBranding";
import "../../FeatureSet/Notification/Utils/Handlebars";
import { getDefaultSubscriberNotificationTemplate } from "../../FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateDefaults";
import {
  VariableSet,
  variableSetsFor,
} from "./Fixtures/EmailTemplateVariables";

/*
 * EVERY EMAIL CARRIES ITS OWN TEXT (EmailPlainText).
 *
 * Every email OneUptime sent was HTML alone: a text-only mail client, a
 * watch or a gateway's preview had nothing to read, and SpamAssassin scored
 * every email MIME_HTML_ONLY. Now SMTP (the installation's own server, a
 * project's, OAuth) and SendGrid send each email as multipart/alternative:
 * the text, written from the HTML it is sent with, and that HTML. A
 * Microsoft Graph request takes one body, and stays the HTML.
 *
 * Here: the text as each transport sends it, the message nodemailer writes,
 * and every template's text - rendered with every way its rows come and go
 * (Fixtures/EmailTemplateVariables), under every branding - read for what a
 * text part must never hold (markup, template syntax, an image's data, a
 * character reference), for every link the email offers, for every value
 * the email shows, and for a header that names the sender once.
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

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);

const CUSTOM_LOGO_PATH: string = "/api/branding/logo?v=7";

interface BrandingCase {
  label: string;
  branding: ProductBranding | null;
  // The name the email's header gives the sender.
  productName: string;
}

const BRANDING_CASES: Array<BrandingCase> = [
  {
    label: "OneUptime's own branding",
    branding: null,
    productName: "OneUptime",
  },
  {
    label: "a logo of the installation's own",
    branding: { logoUrl: CUSTOM_LOGO_PATH, isLogoEmailSafe: true },
    productName: "OneUptime",
  },
  {
    label: "a renamed product",
    branding: {
      productName: "Acme Ops",
      websiteUrl: "https://ops.acme.example.test",
    },
    productName: "Acme Ops",
  },
  {
    label: "a renamed product with a logo of its own",
    branding: {
      productName: "Acme Ops",
      websiteUrl: "https://ops.acme.example.test",
      logoUrl: CUSTOM_LOGO_PATH,
      isLogoEmailSafe: true,
    },
    productName: "Acme Ops",
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
  text?: string;
  html: string;
  attachments?: Array<Record<string, unknown>>;
}

type SendMail = (mail: CapturedSmtpMail) => Promise<{ messageId: string }>;

const sendMail: ReturnType<typeof jest.fn<SendMail>> = jest.fn<SendMail>();

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

async function deliverOverSmtp(
  mail: EmailMessage,
  server: EmailServer = SMTP_SERVER,
): Promise<CapturedSmtpMail> {
  sendMail.mockClear();

  await MailService.send(mail, { emailServer: server });

  expect(sendMail).toHaveBeenCalledTimes(1);

  return sendMail.mock.calls[0]![0];
}

const MARKUP_START: RegExp = /<[A-Za-z!/?]/;
const CHARACTER_REFERENCE: RegExp = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i;
const WEB_ADDRESS: RegExp = /^https?:\/\//i;
const MAIL_ADDRESS: RegExp = /^mailto:/i;
const SAMPLE_VALUE_PREFIX: string = "Sample ";

// Every string a set of variables holds, its lists' items' fields included.
const stringsIn: (value: unknown) => Array<string> = (
  value: unknown,
): Array<string> => {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(stringsIn);
  }

  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(stringsIn);
  }

  return [];
};

/*
 * What is wrong with `text` as the text part of the email whose HTML is
 * `html`, rendered from `variables`, one message a problem.
 */
const textProblems: (
  html: string,
  text: string,
  variables: Record<string, unknown>,
) => Array<string> = (
  html: string,
  text: string,
  variables: Record<string, unknown>,
): Array<string> => {
  const problems: Array<string> = [];
  // What the email says, as a screen reader says it.
  const said: string = screenReaderText(html);

  if (text.trim() === "") {
    return said === "" ? [] : ["has no text, though the email has words"];
  }

  if (text !== text.trim()) {
    problems.push("starts or ends with spaces");
  }

  const markup: RegExpExecArray | null = MARKUP_START.exec(text);

  if (markup) {
    problems.push(
      `holds markup: ${JSON.stringify(text.slice(markup.index, markup.index + 40))}`,
    );
  }

  if (text.includes("{{") || text.includes("}}")) {
    problems.push("holds template syntax");
  }

  for (const word of ["data:", "cid:"]) {
    if (text.toLowerCase().includes(word)) {
      problems.push(`holds an image's ${word}`);
    }
  }

  const reference: RegExpExecArray | null = CHARACTER_REFERENCE.exec(text);

  if (reference) {
    problems.push(`holds the character reference ${reference[0]}`);
  }

  if (text.includes("\n\n\n")) {
    problems.push("has two blank lines in a row");
  }

  for (const line of text.split("\n")) {
    if (line !== line.trimEnd()) {
      problems.push(`has a line ending in a space: ${JSON.stringify(line)}`);
    }
  }

  // Every address it links to.
  for (const link of readMarkupReferences(html)) {
    if (link.element !== "a" || link.attribute !== "href") {
      continue;
    }

    const address: string = decodeHtmlEntities(link.value).trim();
    const shown: string | null = WEB_ADDRESS.test(address)
      ? address
      : MAIL_ADDRESS.test(address)
        ? address.slice("mailto:".length)
        : null;

    if (shown !== null && !text.includes(shown)) {
      problems.push(`leaves out the link to ${shown}`);
    }
  }

  // Every value it says.
  for (const value of new Set<string>(stringsIn(variables))) {
    if (
      value.startsWith(SAMPLE_VALUE_PREFIX) &&
      said.includes(value) &&
      !text.includes(value)
    ) {
      problems.push(`leaves out ${JSON.stringify(value)}`);
    }
  }

  return problems;
};

/*
 * Whether an email's first line names its sender once: the name alone, or
 * the logo's alt text with the address the logo links to.
 */
const namesSenderOnce: (firstLine: string, productName: string) => boolean = (
  firstLine: string,
  productName: string,
): boolean => {
  if (!firstLine.startsWith(productName)) {
    return false;
  }

  const rest: string = firstLine.slice(productName.length);

  return (
    rest === "" ||
    (rest.startsWith(" (https://") &&
      rest.endsWith(")") &&
      !rest.slice(2).includes(" "))
  );
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
  await MailService.cleanup();
});

// The invitation's text, as a text-only mail client shows it.
const INVITATION_TEXT: string = [
  `OneUptime (https://${INSTALL_HOST})`,
  "",
  "You're Invited to Production",
  "",
  "You've been invited to join a project on OneUptime. Sign in to view and manage your invitations.",
  "",
  `Sign In to OneUptime (https://${INSTALL_HOST}/accounts)`,
  "",
  "Or copy and paste this link into your browser:",
  `https://${INSTALL_HOST}/accounts`,
  "",
  "If you don't have an account yet, you'll be redirected to create one first.",
  "",
  "Need help? Contact support (support@oneuptime.com)",
  "",
  `Powered by OneUptime (https://oneuptime.com) \u{00B7} \u{00A9} ${new Date().getFullYear()} OneUptime`,
].join("\n");

/*
 * The part of a message nodemailer wrote whose Content-Type starts with
 * `contentType`: its headers, and its body decoded.
 */
interface MimePart {
  headers: string;
  body: string;
}

const HEX_BYTE: RegExp = /^[0-9A-F]{2}$/;

const decodeQuotedPrintable: (encoded: string) => string = (
  encoded: string,
): string => {
  const bytes: Array<number> = [];
  const joined: string = encoded.split("=\n").join("");

  for (let index: number = 0; index < joined.length; index++) {
    const pair: string = joined.slice(index + 1, index + 3);

    if (joined[index] === "=" && HEX_BYTE.test(pair)) {
      bytes.push(parseInt(pair, 16));
      index += 2;
    } else {
      bytes.push(joined.charCodeAt(index));
    }
  }

  return Buffer.from(bytes).toString("utf8");
};

const mimePart: (raw: string, contentType: string) => MimePart = (
  raw: string,
  contentType: string,
): MimePart => {
  const start: number = raw.indexOf(`Content-Type: ${contentType}`);

  expect(start).toBeGreaterThan(-1);

  const headersEnd: number = raw.indexOf("\n\n", start);
  const bodyEnd: number = raw.indexOf("\n--", headersEnd);
  const headers: string = raw.slice(start, headersEnd);
  const encoded: string = raw.slice(headersEnd + 2, bodyEnd);

  if (headers.includes("Content-Transfer-Encoding: quoted-printable")) {
    return { headers, body: decodeQuotedPrintable(encoded) };
  }

  if (headers.includes("Content-Transfer-Encoding: base64")) {
    return {
      headers,
      body: Buffer.from(encoded, "base64").toString("utf8"),
    };
  }

  return { headers, body: encoded };
};

describe("as sent: the HTML, and the same email as text beside it", () => {
  test("over SMTP, the text part is what the HTML sent beside it reads", async () => {
    const payload: CapturedSmtpMail = await deliverOverSmtp(invitation());

    expect(payload.text).toBe(INVITATION_TEXT);
    // Written from the HTML that goes, its logo by Content-ID included.
    expect(payload.text).toBe(EmailPlainText.fromHtml(payload.html));
    expect(payload.html).toContain('src="cid:');
  });

  test("SMTP signing in with OAuth sends it too", async () => {
    const payload: CapturedSmtpMail = await deliverOverSmtp(invitation(), {
      ...SMTP_SERVER,
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
    });

    expect(payload.text).toBe(INVITATION_TEXT);
  });

  test("the message nodemailer writes: multipart/alternative, the text first, then the HTML with its logo", async () => {
    const payload: CapturedSmtpMail = await deliverOverSmtp(invitation());

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

    const alternative: number = raw.indexOf(
      "Content-Type: multipart/alternative;",
    );
    const text: number = raw.indexOf("Content-Type: text/plain");
    const related: number = raw.indexOf(
      'Content-Type: multipart/related; type="text/html"',
    );
    const html: number = raw.indexOf("Content-Type: text/html");
    const logo: number = raw.indexOf("Content-Type: image/png");

    // A client shows the last alternative it can: the HTML, else the text.
    expect(alternative).toBeGreaterThan(-1);
    expect(text).toBeGreaterThan(alternative);
    expect(related).toBeGreaterThan(text);
    expect(html).toBeGreaterThan(related);
    expect(logo).toBeGreaterThan(html);

    const textPart: MimePart = mimePart(raw, "text/plain");

    expect(textPart.headers).toContain("charset=utf-8");
    expect(textPart.body.trimEnd()).toBe(INVITATION_TEXT);
  });

  test("SendGrid sends the text beside the HTML", async () => {
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

    const message: { html: string; text?: string } = jest.mocked(
      SendgridMail.send,
    ).mock.calls[0]![0] as never;

    expect(message.text).toBe(INVITATION_TEXT);
    expect(message.text).toBe(EmailPlainText.fromHtml(message.html));
  });

  test("Microsoft Graph takes one body: the HTML, as before", async () => {
    const requests: Array<string> = [];

    jest.spyOn(globalThis, "fetch").mockImplementation((async (
      _url: string,
      init?: { body?: string },
    ): Promise<Response> => {
      requests.push(String(init?.body));

      return new Response(null, { status: 202 });
    }) as typeof fetch);

    await MailService.send(invitation(), {
      emailServer: GRAPH_SERVER,
      timeout: 5000,
    });

    expect(requests).toHaveLength(1);

    const body: Record<string, unknown> = (
      JSON.parse(requests[0]!) as {
        message: { body: Record<string, unknown> };
      }
    ).message.body;

    expect(Object.keys(body).sort()).toEqual(["content", "contentType"]);
    expect(body["contentType"]).toBe("HTML");
  });

  test("a text past half a megabyte is cut at a line and says so, and the email still goes", async () => {
    const line: string =
      "<p>A line of a very long log the incident's description quoted, with its words.</p>";
    const payload: CapturedSmtpMail = await deliverOverSmtp({
      toEmail: new Email("alice@example.test"),
      subject: "A long email",
      isSubjectLiteral: true,
      body: line.repeat(Math.ceil((1024 * 1024) / line.length)),
      vars: {},
    });

    expect(payload.text!.length).toBeLessThanOrEqual(
      MAX_EMAIL_TEXT_PART_LENGTH,
    );
    expect(payload.text!.endsWith("\n\n" + EMAIL_TRUNCATED_TEXT_NOTE)).toBe(
      true,
    );
    expect(payload.text).toContain(
      "A line of a very long log the incident's description quoted, with its words.\n\nA line",
    );
  });

  test("the SLA breached email, as a text-only mail client shows it", async () => {
    const messages: IncidentSlaBreachMessages =
      IncidentSlaBreachNotice.getMessages({
        facts: {
          breachType: "resolution",
          deadline: new Date("2026-10-26T11:59:00.000Z"),
          slaRuleName: "P1 customer SLA",
          incidentTitle: "Checkout API is down",
          incidentNumber: 42,
          incidentNumberWithPrefix: "INC-42",
          projectName: "Acme Prod",
          currentStateName: "Investigating",
          currentStateColor: new Color("#f59e0b"),
          severityName: "Critical",
          severityColor: new Color("#dc2626"),
          openedAt: new Date("2026-10-26T09:30:00.000Z"),
          incidentViewLink: `https://${INSTALL_HOST}/dashboard/p/incidents/i`,
          now: new Date("2026-10-26T12:00:00.000Z"),
        },
        recipient: { isOwner: true, timezone: Timezone.EuropeLondon },
      });

    const payload: CapturedSmtpMail = await deliverOverSmtp({
      toEmail: new Email("alice@example.test"),
      ...messages.emailEnvelope,
      vars: { ...messages.emailEnvelope.vars, year: "2026" },
    });

    expect(payload.text).toBe(
      [
        "OneUptime",
        "",
        "SLA breached - Incident INC-42: Checkout API is down",
        "",
        "This incident was not resolved before its SLA resolution deadline.",
        "",
        "Here are the details:",
        "",
        "Incident Title: Checkout API is down",
        "Resolution Deadline: Oct 26 2026, 11:59 AM GMT",
        "SLA Rule: P1 customer SLA",
        "Current State: Investigating",
        "Open For: 2 hours, 30 minutes",
        "Severity: Critical",
        "Project: Acme Prod",
        "",
        "You can view this incident by clicking on the button below -",
        "",
        `View on Dashboard (https://${INSTALL_HOST}/dashboard/p/incidents/i)`,
        "",
        "You can also copy and paste this link:",
        `https://${INSTALL_HOST}/dashboard/p/incidents/i`,
        "",
        "Why am I receiving this email?",
        "",
        "You are receiving this email because you are the owner of this resource.",
        "",
        "Want fewer notification emails?",
        "Go to OneUptime Dashboard > User Settings > Notification Settings to choose which notification emails you receive.",
        "",
        "Powered by OneUptime (https://oneuptime.com) \u{00B7} \u{00A9} 2026 OneUptime",
      ].join("\n"),
    );
  });
});

/*
 * The status page uptime report: its four stat tiles - Average Uptime, then
 * Downtime, Incidents and Resources - each name what they count before the
 * number (st-Stat-label), so the text part, like a screen reader, says
 * "Downtime: 4 hours, 39 minutes" on one line. The three smaller tiles drew
 * the number first, and the text part read "4 hours, 39 minutes", a blank
 * line, then "Downtime" (#5294).
 */
describe("the uptime report, as a text-only mail client shows it", () => {
  const groupId: (n: number) => ObjectID = (n: number): ObjectID => {
    return new ObjectID(`${String(n).repeat(8)}-1111-4111-8111-111111111111`);
  };

  const buildReport: () => StatusPageReport = (): StatusPageReport => {
    const group: (
      n: number,
      name: string,
      parent?: number,
    ) => StatusPageGroup = (
      n: number,
      name: string,
      parent?: number,
    ): StatusPageGroup => {
      const made: StatusPageGroup = new StatusPageGroup();
      made._id = groupId(n).toString();
      made.name = name;
      made.order = n;

      if (parent !== undefined) {
        made.parentStatusPageGroupId = groupId(parent);
      }

      return made;
    };

    const entry: (
      name: string,
      inGroup: number,
      uptimePercent: number,
      incidents: number,
      downtime: string,
    ) => StatusPageReportResourceEntry = (
      name: string,
      inGroup: number,
      uptimePercent: number,
      incidents: number,
      downtime: string,
    ): StatusPageReportResourceEntry => {
      const resource: StatusPageResource = new StatusPageResource();
      resource.displayName = name;
      resource.statusPageGroupId = groupId(inGroup);

      return {
        statusPageResource: resource,
        reportItem: {
          resourceName: name,
          totalIncidentCount: incidents,
          uptimePercent: uptimePercent,
          uptimePercentAsString: `${uptimePercent}%`,
          downtimeInHoursAndMinutes: downtime,
        },
      };
    };

    const structure: StatusPageReportStructure = StatusPageReportTreeUtil.build(
      {
        entries: [
          entry("Checkout API", 2, 99.95, 1, "21 minutes"),
          entry("Marketing website", 3, 99.4, 2, "4 hours, 18 minutes"),
        ],
        statusPageGroups: [
          group(1, "Acme"),
          group(2, "Platform", 1),
          group(3, "Web", 1),
        ],
        groupMetricsByGroupId: {},
      },
    );

    return {
      reportDates: "Oct 1, 2026 - Oct 31, 2026",
      reportPeriodName: "October 2026",
      reportStartDate: "Oct 1, 2026",
      reportEndDate: "Oct 31, 2026",
      reportTimezone: "UTC",
      totalResources: structure.resources.length,
      totalIncidents: 3,
      averageUptimePercent: "99.84%",
      totalDowntimeInHoursAndMinutes: "4 hours, 39 minutes",
      resources: structure.resources,
      groups: structure.groups,
      ungroupedResources: structure.resourcesWithoutGroup,
      rows: structure.rows,
      hasGroups: structure.groups.length > 0,
    };
  };

  const reportVariables: () => Record<string, unknown> = (): Record<
    string,
    unknown
  > => {
    return {
      statusPageName: "Acme Status",
      subscriberEmailNotificationFooterText: "",
      statusPageUrl: "https://status.acme.example.test",
      detailsUrl: "https://status.acme.example.test",
      hasResources: "true",
      report: buildReport(),
      logoUrl: "",
      isPublicStatusPage: "true",
      unsubscribeUrl: `https://${INSTALL_HOST}/status-page-api/unsubscribe/abc`,
    };
  };

  // The lines from the first tile through the last, as the text part reads them.
  const statLines: (text: string) => Array<string> = (
    text: string,
  ): Array<string> => {
    const lines: Array<string> = text.split("\n");
    const first: number = lines.findIndex((line: string): boolean => {
      return line.startsWith("Average Uptime");
    });
    const last: number = lines.findIndex((line: string): boolean => {
      return line.startsWith("Resources");
    });

    expect(first).toBeGreaterThanOrEqual(0);
    expect(last).toBeGreaterThan(first);

    return lines.slice(first, last + 1);
  };

  const STAT_LINES: Array<string> = [
    "Average Uptime: 99.84%",
    "",
    "Oct 1, 2026 \u{2013} Oct 31, 2026 (UTC)",
    "",
    "Downtime: 4 hours, 39 minutes",
    "Incidents: 3",
    "Resources: 2",
  ];

  test("the built-in report: each stat named before its number, a stat a line", async () => {
    const payload: CapturedSmtpMail = await deliverOverSmtp({
      toEmail: new Email("alice@example.test"),
      subject: "[Report] Acme Status",
      isSubjectLiteral: true,
      templateType: EmailTemplateType.StatusPageSubscriberReport,
      vars: reportVariables() as EmailMessage["vars"],
    });

    expect(statLines(payload.text!)).toEqual(STAT_LINES);
    // The rest of the report follows, as before.
    expect(payload.text).toContain(
      "Group / Resource | Uptime | Downtime | Incidents",
    );
    expect(payload.text).toContain("Checkout API | 99.95% | 21 minutes | 1");
  });

  test("the starter a status page is offered for its own report reads the same", async () => {
    const starter: string | undefined =
      getDefaultSubscriberNotificationTemplate(
        StatusPageSubscriberNotificationEventType.SubscriberReport,
        StatusPageSubscriberNotificationMethod.Email,
      )?.body;

    expect(starter).toBeTruthy();

    const payload: CapturedSmtpMail = await deliverOverSmtp({
      toEmail: new Email("alice@example.test"),
      subject: "[Report] Acme Status",
      isSubjectLiteral: true,
      body: starter!,
      vars: reportVariables() as EmailMessage["vars"],
    });

    expect(statLines(payload.text!)).toEqual(STAT_LINES);
  });

  test("a screen reader says each stat's name before its number too", async () => {
    const rendered: RenderedEmail = await MailService.render({
      subject: "[Report] Acme Status",
      isSubjectLiteral: true,
      templateType: EmailTemplateType.StatusPageSubscriberReport,
      vars: reportVariables() as EmailMessage["vars"],
    });
    const spoken: string = screenReaderText(rendered.body);

    for (const [label, value] of [
      ["Average Uptime", "99.84%"],
      ["Downtime", "4 hours, 39 minutes"],
      ["Incidents", "3"],
      ["Resources", "2"],
    ] as Array<[string, string]>) {
      expect(spoken).toContain(`${label} ${value}`);
    }
  });
});

describe("every template's text part reads as its email does", () => {
  /*
   * Rendered with every way its rows come and go under OneUptime's own
   * branding, and with the three main shapes (every variable, none, every
   * one empty) under every other.
   */
  const CORE_SETS: ReadonlyArray<string> = [
    "every variable",
    "no variables",
    "every variable empty",
  ];

  test("a hundred-odd templates: enough for this to mean something", () => {
    expect(catalog.length).toBeGreaterThan(100);
    expect(catalog.filter(showsLogoPartial).length).toBeGreaterThan(70);
  });

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
        const text: string = EmailPlainText.fromHtml(rendered.body);
        const found: Array<string> = textProblems(
          rendered.body,
          text,
          set.variables,
        );

        if (
          showsLogoPartial(name) &&
          !namesSenderOnce(text.split("\n")[0]!, brandingCase.productName)
        ) {
          found.push(
            `starts ${JSON.stringify(text.split("\n")[0])}, not with ${brandingCase.productName} once`,
          );
        }

        for (const problem of found) {
          problems.push(`${brandingCase.label}, ${set.name}: ${problem}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });
});
