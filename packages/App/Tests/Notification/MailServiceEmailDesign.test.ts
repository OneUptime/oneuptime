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
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import Port from "Common/Types/Port";
import MailService from "../../FeatureSet/Notification/Services/MailService";
import MicrosoftGraphMailProvider from "../../FeatureSet/Notification/Services/MailProviders/MicrosoftGraphMailProvider";
import SMTPOAuthService from "../../FeatureSet/Notification/Services/SMTPOAuthService";
import "../../FeatureSet/Notification/Utils/Handlebars";

/*
 * Exercise the public delivery pipeline, including the real production
 * Handlebars initializer, filesystem template reads, subject compilation,
 * default variables and SMTP payload construction. Only infrastructure and
 * transport boundaries are mocked. No helper or partial is registered here.
 *
 * EmailDesign.test.ts covers the catalog's layout; MailServiceTemplateCache
 * covers compile counts. This suite verifies that the redesigned content
 * reaches the correct recipient through the actual send path.
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
const closeTransport: ReturnType<typeof jest.fn<() => void>> =
  jest.fn<() => void>();
const HOME_URL: string = "https://oneuptime.example.test";
const STATUS_URL: string = "https://status.example.test";
const ACTION_URL: string = `${HOME_URL}/accounts/reset-password?token=recipient-token&source=email`;
const PREFERENCES_URL: string = `${HOME_URL}/dashboard/project/user-settings/email-preferences`;
const SMTP_SERVER: EmailServer = {
  host: new Hostname("smtp.example.test"),
  port: new Port(587),
  secure: true,
  username: undefined,
  password: undefined,
  fromName: "OneUptime Notifications",
  fromEmail: new Email("notifications@example.test"),
};

function message(
  templateType: EmailTemplateType,
  vars: Record<string, unknown>,
  recipient: string = "alice@example.test",
  subject: string = "Update for {{recipientName}}",
): EmailMessage {
  return {
    toEmail: new Email(recipient),
    subject,
    templateType,
    vars: {
      homeURL: HOME_URL,
      recipientName: "Alice",
      ...vars,
    } as EmailMessage["vars"],
  };
}

async function deliver(
  mail: EmailMessage,
  server: EmailServer = SMTP_SERVER,
): Promise<CapturedMail> {
  await MailService.send(mail, { emailServer: server });
  const payload: CapturedMail | undefined =
    sendMail.mock.calls[sendMail.mock.calls.length - 1]?.[0];

  expect(payload).toBeDefined();
  expect(payload?.subject).not.toContain("{{");

  return payload!;
}

function expectLink(html: string, url: string): void {
  expect(html).toContain(`href="${Handlebars.escapeExpression(url)}"`);
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

  /*
   * The production initializer performs asynchronous file reads without a
   * readiness export. Wait for those actual registrations, rather than
   * replacing them with test-local copies or relying on a fixed sleep.
   */
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
    close: closeTransport,
  } as unknown as Transporter);
});

afterEach(async () => {
  await MailService.cleanup();
  expect(SendgridMail.send).not.toHaveBeenCalled();
  expect(MicrosoftGraphMailProvider).not.toHaveBeenCalled();
  expect(SMTPOAuthService.getAccessToken).not.toHaveBeenCalled();
});

describe("account emails through MailService.send", () => {
  test("the transport receives the complete document, rendered subject and recipient", async () => {
    const mail: EmailMessage = message(EmailTemplateType.ForgotPassword, {
      tokenVerifyUrl: ACTION_URL,
    });
    const payload: CapturedMail = await deliver(mail);

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(payload.to).toBe("alice@example.test");
    expect(payload.from).toBe(
      "OneUptime Notifications <notifications@example.test>",
    );
    expect(payload.subject).toBe("Update for Alice");
    expect(payload.html).toContain("<!DOCTYPE html>");
    expect(payload.html).toContain("</html>");
    expect(payload.html).toMatch(/<h1\b[^>]*>Reset Your Password<\/h1>/);
    expectLink(payload.html, ACTION_URL);
    expect(
      payload.html.split(`href="${Handlebars.escapeExpression(ACTION_URL)}"`),
    ).toHaveLength(3);
    expect(mail.vars["year"]).toBe(OneUptimeDate.getCurrentYear().toString());
    expect(payload.html).not.toContain('href=""');
    expect(payload.html).not.toContain("{{");
  });

  test("registration keeps trusted expiry content and the recipient's full token URL", async () => {
    const url: string = `${HOME_URL}/accounts/register?email=alice%40example.test&token=alice-only`;
    const expiryNote: string =
      "<strong>Note:</strong> This link expires in 7 days.";
    const payload: CapturedMail = await deliver(
      message(EmailTemplateType.CompleteRegistration, {
        registrationLink: url,
        expiryNote,
      }),
    );

    expect(payload.html).toContain("Finish Setting Up Your Account");
    expect(payload.html).toContain(expiryNote);
    expectLink(payload.html, url);
    expect(payload.html).toContain(`>${Handlebars.escapeExpression(url)}</a>`);
    expect(payload.html).not.toContain("&amp;amp;");
  });

  test.each([
    ["true", "true", "Added", "Create Your Account", "register"],
    ["true", "false", "Added", "Sign In to OneUptime", "accounts"],
    ["false", "true", "Invited", "Create Your Account", "register"],
    ["false", "false", "Invited", "Sign In to OneUptime", "accounts"],
  ])(
    "production helpers select the accepted=%s / new-user=%s invitation branch",
    async (
      accepted: string,
      newUser: string,
      headline: string,
      action: string,
      route: string,
    ) => {
      const payload: CapturedMail = await deliver(
        message(EmailTemplateType.InviteMember, {
          isInvitationAccepted: accepted,
          isNewUser: newUser,
          projectName: "Acme Production",
          registerLink: `${HOME_URL}/register`,
          signInLink: `${HOME_URL}/accounts`,
        }),
      );

      expect(payload.html).toContain(headline);
      expect(payload.html).toContain("Acme Production");
      expect(payload.html).toContain(action);
      expectLink(payload.html, `${HOME_URL}/${route}`);
      expect(payload.html).not.toContain(
        newUser === "true" ? "Sign In to OneUptime" : "Create Your Account",
      );
    },
  );

  test("concurrent recipients keep their own subject, action token and footer year", async () => {
    const recipients: Array<{
      name: string;
      email: string;
      token: string;
      year: string;
    }> = [
      {
        name: "Alice",
        email: "alice@example.test",
        token: "alice-only",
        year: "2024",
      },
      {
        name: "Bob",
        email: "bob@example.test",
        token: "bob-only",
        year: "2025",
      },
      {
        name: "Casey",
        email: "casey@example.test",
        token: "casey-only",
        year: "2026",
      },
    ];

    await Promise.all(
      recipients.map(
        async (recipient: (typeof recipients)[number]): Promise<void> => {
          await MailService.send(
            message(
              EmailTemplateType.ForgotPassword,
              {
                recipientName: recipient.name,
                tokenVerifyUrl: `${HOME_URL}/reset/${recipient.token}`,
                year: recipient.year,
              },
              recipient.email,
            ),
            { emailServer: SMTP_SERVER },
          );
        },
      ),
    );

    expect(sendMail).toHaveBeenCalledTimes(recipients.length);

    for (const recipient of recipients) {
      const payload: CapturedMail | undefined = sendMail.mock.calls
        .map((call: [CapturedMail]): CapturedMail => {
          return call[0];
        })
        .find((candidate: CapturedMail): boolean => {
          return candidate.to === recipient.email;
        });

      expect(payload?.subject).toBe(`Update for ${recipient.name}`);
      expect(payload?.html).toContain(recipient.year);
      expectLink(payload!.html, `${HOME_URL}/reset/${recipient.token}`);

      for (const other of recipients.filter(
        (candidate: (typeof recipients)[number]): boolean => {
          return candidate !== recipient;
        },
      )) {
        expect(payload?.html).not.toContain(other.token);
      }
    }
  });

  test("the real variadic concat and rich-content slots survive delivery", async () => {
    const title: string = 'Checkout <strong>API</strong> & "Payments"';
    const rootCause: string =
      "<p>Investigating:</p><ul><li>Connection pool exhaustion</li></ul>";
    const payload: CapturedMail = await deliver(
      message(EmailTemplateType.AcknowledgeIncident, {
        incidentNumber: "INC-123",
        incidentTitle: title,
        projectName: "Acme Production",
        currentState: "Investigating",
        incidentSeverity: "Critical",
        resourcesAffected: "Checkout API",
        rootCause,
        acknowledgeIncidentLink: ACTION_URL,
      }),
    );

    expect(payload.html).toContain(
      `Incident INC-123: ${Handlebars.escapeExpression(title)}`,
    );
    expect(payload.html).not.toContain(title);
    expect(payload.html).toContain(
      "A new incident has been created in the project - Acme Production",
    );
    expect(payload.html).toContain(rootCause);
    expectLink(payload.html, ACTION_URL);
  });
});

describe("subscriber emails through MailService.send", () => {
  test("a cached subscriber template keeps each customer's branding and subscription destination", async () => {
    const first: CapturedMail = await deliver(
      message(EmailTemplateType.SubscriberIncidentCreated, {
        homeURL: undefined,
        statusPageName: "Acme Status",
        statusPageUrl: STATUS_URL,
        logoUrl: `${STATUS_URL}/acme-logo.png`,
        incidentTitle: "Checkout unavailable",
        detailsUrl: `${STATUS_URL}/incidents/acme-incident`,
        unsubscribeUrl: `${STATUS_URL}/manage/alice`,
        subscriberEmailNotificationFooterText:
          "<p>Acme support is here to help.</p>",
      }),
    );
    const second: CapturedMail = await deliver(
      message(
        EmailTemplateType.SubscriberIncidentCreated,
        {
          homeURL: undefined,
          statusPageName: "Beta Status",
          statusPageUrl: "https://beta-status.example.test",
          incidentTitle: "Database maintenance",
          unsubscribeUrl: "https://beta-status.example.test/manage/bob",
          recipientName: "Bob",
        },
        "bob@example.test",
      ),
    );

    expect(first.html).toContain(`src="${STATUS_URL}/acme-logo.png"`);
    expect(first.html).toContain('alt="Acme Status"');
    expect(first.html).toContain("<p>Acme support is here to help.</p>");
    expectLink(first.html, `${STATUS_URL}/manage/alice`);
    expectLink(first.html, `${STATUS_URL}/incidents/acme-incident`);
    expect(second.to).toBe("bob@example.test");
    expect(second.html).toContain("Beta Status");
    expectLink(second.html, "https://beta-status.example.test");
    expectLink(second.html, "https://beta-status.example.test/manage/bob");
    expect(second.html).not.toContain("Acme");
    expect(second.html).not.toContain("/manage/alice");
    expect(second.html).not.toMatch(/<img\b[^>]*src="\s*"/);
    expect(second.html).not.toContain('href=""');
  });

  test("a reused SMTP pool does not retain the first customer's sender identity", async () => {
    const first: CapturedMail = await deliver(
      message(EmailTemplateType.SimpleMessage, { message: "First update" }),
    );
    const second: CapturedMail = await deliver(
      message(EmailTemplateType.SimpleMessage, { message: "Second update" }),
      {
        ...SMTP_SERVER,
        fromName: "Beta Support",
        fromEmail: new Email("support@beta.example.test"),
      },
    );

    expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
    expect(first.from).toBe(
      "OneUptime Notifications <notifications@example.test>",
    );
    expect(second.from).toBe("Beta Support <support@beta.example.test>");
    expect(second.html).toContain("Second update");
    expect(second.html).not.toContain("First update");
  });

  test.each([true, false])(
    "the actual delivery pipeline renders grouped-report hasGroups=%s",
    async (hasGroups: boolean) => {
      const payload: CapturedMail = await deliver(
        message(
          EmailTemplateType.StatusPageSubscriberReport,
          {
            homeURL: undefined,
            statusPageName: "Acme Status",
            statusPageUrl: STATUS_URL,
            unsubscribeUrl: `${STATUS_URL}/manage/alice`,
            hasResources: "true",
            report: {
              reportPeriodName: "August 2026",
              reportStartDate: "Aug 1, 2026",
              reportEndDate: "Aug 31, 2026",
              reportTimezone: "UTC",
              averageUptimePercent: "99.95%",
              totalResources: 1,
              totalIncidents: 2,
              totalDowntimeInHoursAndMinutes: "22 minutes",
              hasGroups,
              rows: [
                ...(hasGroups
                  ? [
                      {
                        name: "Europe",
                        isGroup: true,
                        indentInPixels: 0,
                        totalResources: 1,
                        uptimePercentAsString: "99.95%",
                        totalIncidentCount: 2,
                      },
                    ]
                  : []),
                {
                  name: "Checkout API",
                  isGroup: false,
                  indentInPixels: hasGroups ? 64 : 0,
                  uptimePercentAsString: "99.95%",
                  downtimeInHoursAndMinutes: "22 minutes",
                  totalIncidentCount: 2,
                },
              ],
            },
          },
          "alice@example.test",
          "{{statusPageName}} — {{report.reportPeriodName}}",
        ),
      );

      expect(payload.subject).toBe("Acme Status — August 2026");
      expect(payload.html).toContain(
        hasGroups ? "Breakdown by group" : "Per-resource breakdown",
      );
      expect(payload.html).toContain("99.95%");
      expect(payload.html).toContain("Checkout API");
      expect(payload.html).toContain("22 minutes");
      expectLink(payload.html, STATUS_URL);
      expectLink(payload.html, `${STATUS_URL}/manage/alice`);
      expect(payload.html).not.toContain("{{");
    },
  );

  test("an empty report remains actionable without leaking an earlier report's rows", async () => {
    const payload: CapturedMail = await deliver(
      message(EmailTemplateType.StatusPageSubscriberReport, {
        statusPageName: "Empty Status",
        statusPageUrl: STATUS_URL,
        hasResources: "false",
        unsubscribeUrl: `${STATUS_URL}/manage/empty`,
      }),
    );

    expect(payload.html).toContain("No resources have been added");
    expect(payload.html).not.toContain("Checkout API");
    expect(payload.html).not.toContain("Breakdown by group");
    expectLink(payload.html, STATUS_URL);
    expectLink(payload.html, `${STATUS_URL}/manage/empty`);
  });
});

describe("digests and custom email bodies through MailService.send", () => {
  test.each(["true", "false"])(
    "digest rows and hasMore=%s reach the captured message",
    async (hasMore: string) => {
      const rowLink: string = `${HOME_URL}/dashboard/project/incidents/123`;
      const payload: CapturedMail = await deliver(
        message(
          EmailTemplateType.NotificationRollup,
          {
            rollupTitle: "2 notifications from Acme",
            rollupIntroHtml:
              "<p>Recent updates from <strong>Acme</strong>.</p>",
            summaryCount: "2 notifications",
            summaryWindow: "12:00 UTC to 12:05 UTC",
            categoryCounts: "2 Incidents",
            projectHomeLink: `${HOME_URL}/dashboard/project`,
            preferencesLink: PREFERENCES_URL,
            preferencesHtml:
              "<p>Your recent updates are grouped into one email.</p>",
            hasMore,
            moreTextHtml: "7 more updates are not listed here.",
            rows: [
              {
                isSectionStart: "true",
                sectionLabel: "Incidents",
                sectionCount: "2 updates",
                rowBackground: "#ffffff",
                hasLink: "true",
                link: rowLink,
                title: "Checkout <strong>API</strong>",
                metaLabel: "12:00 UTC",
              },
              {
                isSectionStart: "false",
                rowBackground: "#f7f9fc",
                hasLink: "false",
                title: "An update with no resource link",
                metaLabel: "12:05 UTC",
              },
            ],
          },
          "alice@example.test",
          "{{rollupTitle}}",
        ),
      );

      expect(payload.subject).toBe("2 notifications from Acme");
      expect(payload.html).toContain("<strong>Acme</strong>");
      expect(payload.html).toContain(
        "Checkout &lt;strong&gt;API&lt;/strong&gt;",
      );
      expect(payload.html).toContain("An update with no resource link");
      expect(payload.html.includes("7 more updates are not listed here.")).toBe(
        hasMore === "true",
      );
      expectLink(payload.html, rowLink);
      expectLink(payload.html, PREFERENCES_URL);
      expect(payload.html).not.toContain('href=""');
    },
  );

  test("a complete custom HTML document reaches transport byte-for-byte unchanged", async () => {
    const body: string =
      "<!doctype html><html><head><style>.custom { padding: 19px; }</style></head><body><h1>Customer layout</h1><p>{{literal_customer_placeholder}}</p><p>A &amp; B</p></body></html>";
    const payload: CapturedMail = await deliver(
      message(
        EmailTemplateType.BlankTemplate,
        {
          body,
          literal_customer_placeholder: "This must not be recursively expanded",
        },
        "alice@example.test",
        "Custom update for {{recipientName}}",
      ),
    );

    expect(payload.html).toBe(body);
    expect(payload.subject).toBe("Custom update for Alice");
    expect(payload.html).not.toContain("st-Wrapper");
    expect(payload.html).not.toContain("Powered by");
  });

  test("a body without a named template still interpolates its recipient variables", async () => {
    const payload: CapturedMail = await deliver({
      toEmail: new Email("bob@example.test"),
      subject: "Message for {{recipientName}}",
      body: '<h1>Hello {{recipientName}}</h1><a href="{{detailsUrl}}">Read update</a>',
      vars: { recipientName: "Bob", detailsUrl: ACTION_URL },
    });

    expect(payload.subject).toBe("Message for Bob");
    expect(payload.html).toContain("<h1>Hello Bob</h1>");
    expectLink(payload.html, ACTION_URL);
    expect(payload.html).not.toContain("st-Wrapper");
  });

  test("a missing template fails before a mailer is created or any payload is delivered", async () => {
    const mail: EmailMessage = message(
      "MissingEmailDesignFixture.hbs" as EmailTemplateType,
      {},
    );

    await expect(
      MailService.send(mail, { emailServer: SMTP_SERVER }),
    ).rejects.toThrow("ENOENT");
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("a subject rendering error cannot deliver an otherwise valid redesigned body", async () => {
    const mail: EmailMessage = message(
      EmailTemplateType.ForgotPassword,
      {
        tokenVerifyUrl: ACTION_URL,
      },
      "alice@example.test",
      "{{missingEmailDesignHelper recipientName}}",
    );

    await expect(
      MailService.send(mail, { emailServer: SMTP_SERVER }),
    ).rejects.toThrow("Missing helper");
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });
});
