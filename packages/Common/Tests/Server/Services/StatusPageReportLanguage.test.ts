import ProjectSmtpConfig from "../../../Models/DatabaseModels/ProjectSmtpConfig";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import StatusPageSubscriberNotificationTemplate from "../../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import MailService from "../../../Server/Services/MailService";
import ProjectSmtpConfigService from "../../../Server/Services/ProjectSmtpConfigService";
import StatusPageService, {
  Service as StatusPageServiceClass,
} from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService from "../../../Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import Hostname from "../../../Types/API/Hostname";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Protocol from "../../../Types/API/Protocol";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { StatusPageReport } from "../../../Types/StatusPage/StatusPageReport";
import StatusPageReportPeriodType from "../../../Types/StatusPage/StatusPageReportPeriodType";
import Timezone from "../../../Types/Timezone";
import StatusPageReportTreeUtil, {
  StatusPageReportStructure,
} from "../../../Utils/StatusPage/Report";
import StatusPageReportPeriodUtil, {
  StatusPageReportPeriod,
} from "../../../Utils/StatusPage/ReportPeriod";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE UPTIME REPORT, IN EACH SUBSCRIBER'S LANGUAGE.
 *
 * StatusPageService.sendEmailReport builds the report once, in English,
 * and sends each email subscriber the built-in report in their language -
 * their own, else the page's default (SubscriberLanguage): its subject, the
 * template's words (the envelope's language) and the report's figures
 * (Utils/StatusPage/ReportText). A test report is the page's default
 * language, as the page's subscribers without one of their own read it. A
 * custom report template is the team's own words: the report it is filled
 * with is the page's default language, and it is sent without a language
 * of its own. English reads exactly as it always has.
 *
 * The database is stubbed: the page, its report, its template and its
 * subscribers are what the loaders give, and the mailer records each email.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000002",
);
const STATUS_PAGE_URL: string = "https://status.acme.com";

function accepted(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, {}, {});
}

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
}

// July 2026, as a monthly report sent on August 1st covers it.
function julyPeriod(): StatusPageReportPeriod {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = EventInterval.Month;
  recurring.intervalCount = new PositiveNumber(1);

  return StatusPageReportPeriodUtil.getReportPeriod({
    periodType: StatusPageReportPeriodType.PreviousCalendarPeriod,
    reportRecurringInterval: recurring,
    timezone: Timezone.UTC,
    sentAt: OneUptimeDate.fromString("2026-08-01T09:00:00.000Z"),
  });
}

// The English report getReportByStatusPage builds: one resource.
function englishReport(period: StatusPageReportPeriod): StatusPageReport {
  const resource: StatusPageResource = new StatusPageResource();
  resource.displayName = "Website";

  const structure: StatusPageReportStructure = StatusPageReportTreeUtil.build({
    entries: [
      {
        statusPageResource: resource,
        reportItem: {
          resourceName: "Website",
          totalIncidentCount: 2,
          uptimePercent: 99.95,
          uptimePercentAsString: "99.95%",
          downtimeInHoursAndMinutes: "21 minutes",
          downtimeInMinutes: 21,
        },
      },
    ],
    statusPageGroups: [],
    groupMetricsByGroupId: {},
  });

  return {
    reportDates: period.reportDates,
    reportPeriodName: period.periodName,
    reportStartDate: "Jul 1, 2026",
    reportEndDate: "Jul 31, 2026",
    reportTimezone: period.timezone,
    totalResources: 1,
    totalIncidents: 2,
    averageUptimePercent: "99.95%",
    totalDowntimeInHoursAndMinutes: "21 minutes",
    totalDowntimeInMinutes: 21,
    resources: structure.resources,
    groups: structure.groups,
    ungroupedResources: structure.resourcesWithoutGroup,
    rows: structure.rows,
    hasGroups: false,
  };
}

function statusPage(options?: {
  defaultLanguage?: string | undefined;
  withSmtp?: boolean | undefined;
}): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID.toString();
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  page.pageTitle = "Acme Status";
  page.isPublicStatusPage = true;

  if (options?.defaultLanguage) {
    page.defaultLanguage = options.defaultLanguage;
  }

  if (options?.withSmtp) {
    const smtp: ProjectSmtpConfig = new ProjectSmtpConfig();
    smtp._id = new ObjectID("50000000-0000-4000-8000-000000000005").toString();
    page.smtpConfig = smtp;
  }

  return page;
}

function subscriber(index: number, language?: string): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row._id = new ObjectID(
    `30000000-0000-4000-8000-00000000000${index}`,
  ).toString();
  row.projectId = PROJECT_ID;
  row.statusPageId = STATUS_PAGE_ID;
  row.subscriberEmail = new Email(`subscriber-${index}@example.com`);
  row.isSubscriptionConfirmed = true;
  row.isUnsubscribed = false;
  row.unsubscribeToken = `${index}a`.repeat(32);

  if (language) {
    row.language = language;
  }

  return row;
}

// Each email the mailer was handed, with its address.
function sentMail(): Array<EmailEnvelope & { toEmail: Email }> {
  return mock(MailService.sendMail).mock.calls.map((call: Array<unknown>) => {
    return call[0] as EmailEnvelope & { toEmail: Email };
  });
}

function sentTo(index: number): EmailEnvelope & { toEmail: Email } {
  const mail: (EmailEnvelope & { toEmail: Email }) | undefined =
    sentMail().find((sent: EmailEnvelope & { toEmail: Email }): boolean => {
      return sent.toEmail.toString() === `subscriber-${index}@example.com`;
    });

  expect(mail).toBeDefined();

  return mail!;
}

function reportOf(mail: EmailEnvelope): StatusPageReport {
  return (mail.vars as unknown as { report: StatusPageReport }).report;
}

let report: StatusPageReport;

function given(data: {
  page: StatusPage;
  subscribers?: Array<StatusPageSubscriber> | undefined;
  template?: StatusPageSubscriberNotificationTemplate | null | undefined;
}): void {
  jest
    .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
    .mockResolvedValue([data.page]);
  jest
    .spyOn(StatusPageSubscriberService, "getSubscribersByStatusPage")
    .mockResolvedValue(data.subscribers || []);
  jest
    .spyOn(
      StatusPageSubscriberNotificationTemplateService,
      "getTemplateForStatusPage",
    )
    .mockResolvedValue(data.template || null);
}

beforeEach(() => {
  const period: StatusPageReportPeriod = julyPeriod();
  report = englishReport(period);

  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.acme.com"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);
  jest
    .spyOn(StatusPageService, "getStatusPageURL")
    .mockResolvedValue(STATUS_PAGE_URL);
  jest
    .spyOn(StatusPageServiceClass, "getReportPeriodForStatusPage")
    .mockReturnValue(period);
  jest.spyOn(StatusPageService, "getReportByStatusPage").mockResolvedValue(report);
  jest
    .spyOn(ProjectSmtpConfigService, "toEmailServer")
    .mockReturnValue(undefined);
  jest.spyOn(MailService, "sendMail").mockResolvedValue(accepted());
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("StatusPageService.sendEmailReport, in each subscriber's language", () => {
  test("a subscriber with no language of their own is written to in the page's default", async () => {
    given({
      page: statusPage({ defaultLanguage: "de" }),
      subscribers: [subscriber(1)],
    });

    await StatusPageService.sendEmailReport({ statusPageId: STATUS_PAGE_ID });

    const mail: EmailEnvelope = sentTo(1);

    expect(mail.templateType).toBe(EmailTemplateType.StatusPageSubscriberReport);
    expect(mail.language).toBe("de");
    expect(mail.subject).toBe("[Bericht] Acme Status");
    expect(mail.isSubjectLiteral).toBe(true);
    expect(reportOf(mail).reportPeriodName).toBe("Juli 2026");
    expect(reportOf(mail).reportStartDate).toBe("1. Juli 2026");
    expect(reportOf(mail).totalDowntimeInHoursAndMinutes).toBe("21 Minuten");
    expect(reportOf(mail).averageUptimePercent).not.toBe("99.95%");
  });

  test("a subscriber's own language wins over the page's", async () => {
    given({
      page: statusPage({ defaultLanguage: "de" }),
      subscribers: [subscriber(1, "fr")],
    });

    await StatusPageService.sendEmailReport({ statusPageId: STATUS_PAGE_ID });

    const mail: EmailEnvelope = sentTo(1);

    expect(mail.language).toBe("fr");
    expect(mail.subject).toBe("[Rapport] Acme Status");
    expect(reportOf(mail).reportPeriodName).toBe("juillet 2026");
    expect(reportOf(mail).totalDowntimeInHoursAndMinutes).toBe("21 minutes");
  });

  test("an English subscriber's email reads exactly as it always has", async () => {
    given({
      page: statusPage({ defaultLanguage: "de" }),
      subscribers: [subscriber(1, "en")],
    });

    await StatusPageService.sendEmailReport({ statusPageId: STATUS_PAGE_ID });

    const mail: EmailEnvelope = sentTo(1);

    expect(mail.language).toBeUndefined();
    expect(Object.keys(mail)).not.toContain("language");
    expect(mail.subject).toBe("[Report] Acme Status");
    // The report as it was built, not a copy.
    expect(reportOf(mail)).toBe(report);
  });

  test("a page without a default language writes everyone in English", async () => {
    given({ page: statusPage(), subscribers: [subscriber(1)] });

    await StatusPageService.sendEmailReport({ statusPageId: STATUS_PAGE_ID });

    const mail: EmailEnvelope = sentTo(1);

    expect(mail.language).toBeUndefined();
    expect(mail.subject).toBe("[Report] Acme Status");
    expect(reportOf(mail).reportPeriodName).toBe("July 2026");
  });

  test("subscribers of one page in several languages each get their own", async () => {
    given({
      page: statusPage({ defaultLanguage: "ja" }),
      subscribers: [
        subscriber(1),
        subscriber(2, "de"),
        subscriber(3, "en"),
        subscriber(4, "fa"),
      ],
    });

    await StatusPageService.sendEmailReport({ statusPageId: STATUS_PAGE_ID });

    expect(
      [1, 2, 3, 4].map((index: number): string => {
        return sentTo(index).language || "en";
      }),
    ).toEqual(["ja", "de", "en", "fa"]);

    expect(sentTo(1).subject).toBe("[レポート] Acme Status");
    expect(reportOf(sentTo(1)).reportPeriodName).toBe("2026年7月");
    // In Persian the page's name is set apart in the subject.
    expect(withoutIsolateMarks(sentTo(4).subject)).toBe("[گزارش] Acme Status");
    expect(reportOf(sentTo(4)).averageUptimePercent).toBe("۹۹٫۹۵٪");
  });

  test("each language's report is written once, whoever reads it", async () => {
    given({
      page: statusPage({ defaultLanguage: "de" }),
      subscribers: [subscriber(1), subscriber(2), subscriber(3, "de")],
    });

    await StatusPageService.sendEmailReport({ statusPageId: STATUS_PAGE_ID });

    expect(reportOf(sentTo(2))).toBe(reportOf(sentTo(1)));
    expect(reportOf(sentTo(3))).toBe(reportOf(sentTo(1)));
  });

  test("leaves the report it built in English, and English dates to English", async () => {
    given({
      page: statusPage({ defaultLanguage: "de" }),
      subscribers: [subscriber(1)],
    });

    await StatusPageService.sendEmailReport({ statusPageId: STATUS_PAGE_ID });

    expect(report.reportPeriodName).toBe("July 2026");
    expect(OneUptimeDate.convertMinutesToDaysHoursAndMinutes(21)).toBe(
      "21 minutes",
    );
  });
});

describe("Send Test Report", () => {
  test("goes to the address it is given, in the page's default language", async () => {
    given({
      page: statusPage({ defaultLanguage: "es" }),
      subscribers: [subscriber(1, "fr")],
    });

    await StatusPageService.sendEmailReport({
      statusPageId: STATUS_PAGE_ID,
      email: new Email("team@acme.com"),
    });

    expect(sentMail()).toHaveLength(1);

    const mail: EmailEnvelope & { toEmail: Email } = sentMail()[0]!;

    expect(mail.toEmail.toString()).toBe("team@acme.com");
    expect(mail.language).toBe("es");
    expect(mail.subject).toBe("[Informe] Acme Status");
    expect(reportOf(mail).reportPeriodName).toBe("julio de 2026");
    // A test has no subscriber to unsubscribe.
    expect((mail.vars as JSONObject)["unsubscribeUrl"]).toBe("");
  });

  test("is English for a page without a default language", async () => {
    given({ page: statusPage() });

    await StatusPageService.sendEmailReport({
      statusPageId: STATUS_PAGE_ID,
      email: new Email("team@acme.com"),
    });

    expect(sentMail()[0]!.language).toBeUndefined();
    expect(sentMail()[0]!.subject).toBe("[Report] Acme Status");
  });
});

describe("a page's custom report template", () => {
  function template(subject?: string): StatusPageSubscriberNotificationTemplate {
    const value: StatusPageSubscriberNotificationTemplate =
      new StatusPageSubscriberNotificationTemplate();
    value.templateBody =
      "<p>{{report.reportPeriodName}}: {{report.averageUptimePercent}}</p>";

    if (subject) {
      value.emailSubject = subject;
    }

    return value;
  }

  test("is filled in the page's default language, whatever the subscriber's", async () => {
    given({
      page: statusPage({ defaultLanguage: "de", withSmtp: true }),
      subscribers: [subscriber(1, "fr"), subscriber(2)],
      template: template(),
    });

    await StatusPageService.sendEmailReport({ statusPageId: STATUS_PAGE_ID });

    for (const index of [1, 2]) {
      const mail: EmailEnvelope = sentTo(index);

      expect(mail.templateType).toBeUndefined();
      expect(mail.body).toBe(
        "<p>{{report.reportPeriodName}}: {{report.averageUptimePercent}}</p>",
      );
      expect(reportOf(mail).reportPeriodName).toBe("Juli 2026");
      // The team's own words: sent as written, with no language of its own.
      expect(mail.language).toBeUndefined();
    }
  });

  test("without a subject of its own, gets OneUptime's in the subscriber's language", async () => {
    given({
      page: statusPage({ defaultLanguage: "de", withSmtp: true }),
      subscribers: [subscriber(1, "fr"), subscriber(2)],
      template: template(),
    });

    await StatusPageService.sendEmailReport({ statusPageId: STATUS_PAGE_ID });

    expect(sentTo(1).subject).toBe("[Rapport] Acme Status");
    expect(sentTo(1).isSubjectLiteral).toBe(true);
    expect(sentTo(2).subject).toBe("[Bericht] Acme Status");
  });

  test("with a subject of its own, sends it as the template it is", async () => {
    given({
      page: statusPage({ defaultLanguage: "de", withSmtp: true }),
      subscribers: [subscriber(1, "fr")],
      template: template("Monatsbericht {{statusPageName}}"),
    });

    await StatusPageService.sendEmailReport({ statusPageId: STATUS_PAGE_ID });

    expect(sentTo(1).subject).toBe("Monatsbericht {{statusPageName}}");
    expect(sentTo(1).isSubjectLiteral).toBe(false);
  });

  test("is not used on a page without its own SMTP server: the built-in report, in the reader's language", async () => {
    given({
      page: statusPage({ defaultLanguage: "de" }),
      subscribers: [subscriber(1, "fr")],
      template: template(),
    });

    await StatusPageService.sendEmailReport({ statusPageId: STATUS_PAGE_ID });

    expect(sentTo(1).templateType).toBe(
      EmailTemplateType.StatusPageSubscriberReport,
    );
    expect(sentTo(1).language).toBe("fr");
    expect(reportOf(sentTo(1)).reportPeriodName).toBe("juillet 2026");
  });
});
