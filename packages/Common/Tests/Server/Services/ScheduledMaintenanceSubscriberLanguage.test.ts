import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ProjectSmtpConfig from "../../../Models/DatabaseModels/ProjectSmtpConfig";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import StatusPageSubscriberNotificationTemplate from "../../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import MailService from "../../../Server/Services/MailService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import ProjectSmtpConfigService from "../../../Server/Services/ProjectSmtpConfigService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import SmsService from "../../../Server/Services/SmsService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService from "../../../Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import Markdown from "../../../Server/Types/Markdown";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import StatusPageSubscriberWebhookUtil from "../../../Server/Utils/StatusPageSubscriberWebhook";
import Hostname from "../../../Types/API/Hostname";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Protocol from "../../../Types/API/Protocol";
import URL from "../../../Types/API/URL";
import OneUptimeDate from "../../../Types/Date";
import { getDateDisplayLanguage } from "../../../Types/DateLanguage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import { JSONObject } from "../../../Types/JSON";
import Email from "../../../Types/Email";
import Phone from "../../../Types/Phone";
import ObjectID from "../../../Types/ObjectID";
import StatusPageSubscriberNotificationMethod from "../../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A SCHEDULED EVENT'S NOTIFICATIONS, IN EACH SUBSCRIBER'S LANGUAGE.
 *
 * ScheduledMaintenanceService tells a status page's subscribers an event is
 * scheduled. Each is written in the subscriber's language - their own, else
 * the page's default (SubscriberLanguage): the default email's subject, its
 * own words and when the event starts; the text message; the Slack
 * message's words and its date. A custom template is the team's own and
 * reads as it always did, its dates in English.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const EVENT_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

const STARTS_AT: Date = new Date("2024-03-04T06:08:00.000Z");
const STATUS_PAGE_URL: string = "https://status.example.com";
const DETAILS_URL: string = `${STATUS_PAGE_URL}/scheduled-events/${EVENT_ID.toString()}`;
const TITLE: string = "Quarterly database failover drill";

function accepted(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, {}, {});
}

function scheduledEvent(): ScheduledMaintenance {
  const event: ScheduledMaintenance = new ScheduledMaintenance();

  event._id = EVENT_ID.toString();
  event.projectId = PROJECT_ID;
  event.title = TITLE;
  event.description = "Failing over the primary.";
  event.startsAt = STARTS_AT;

  const statusPage: StatusPage = new StatusPage();
  statusPage._id = STATUS_PAGE_ID.toString();
  event.statusPages = [statusPage];

  return event;
}

function statusPage(options: {
  defaultLanguage?: string;
  smtp?: boolean;
}): StatusPage {
  const page: StatusPage = new StatusPage();

  page._id = STATUS_PAGE_ID.toString();
  page.projectId = PROJECT_ID;
  page.name = "Acme Status";
  page.pageTitle = "Acme Status";
  page.isPublicStatusPage = true;
  page.showScheduledMaintenanceEventsOnStatusPage = true;
  page.allowSubscribersToChooseResources = false;
  page.allowSubscribersToChooseEventTypes = false;
  page.subscriberTimezones = [];

  if (options.defaultLanguage) {
    page.defaultLanguage = options.defaultLanguage;
  }

  if (options.smtp) {
    const smtpConfig: ProjectSmtpConfig = new ProjectSmtpConfig();
    smtpConfig._id = "55555555-5555-4555-8555-555555555555";
    page.smtpConfig = smtpConfig;
  }

  return page;
}

function subscriber(language?: string): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();

  row._id = SUBSCRIBER_ID.toString();
  row.statusPageId = STATUS_PAGE_ID;
  row.isUnsubscribed = false;
  row.isSubscribedToAllResources = true;
  row.isSubscribedToAllEventTypes = true;
  row.subscriberEmail = new Email("subscriber@example.com");
  row.subscriberPhone = new Phone("+15558675309");
  row.slackIncomingWebhookUrl = URL.fromString(
    "https://hooks.slack.com/services/T/B/X",
  );
  row.unsubscribeToken = "7a".repeat(32);

  if (language) {
    row.language = language;
  }

  return row;
}

function sentMail(): JSONObject {
  return (MailService.sendMail as unknown as jest.Mock).mock
    .calls[0]![0] as JSONObject;
}

function sentSms(): string {
  return String(
    (
      (SmsService.sendSms as unknown as jest.Mock).mock.calls[0]![0] as {
        message: string;
      }
    ).message,
  );
}

function sentSlack(): string {
  return String(
    (SlackUtil.convertMarkdownToSlackRichText as unknown as jest.Mock).mock
      .calls[0]![0],
  );
}

let pages: Array<StatusPage> = [];
let subscribers: Array<StatusPageSubscriber> = [];
let customEmailTemplate: StatusPageSubscriberNotificationTemplate | null = null;

describe("a scheduled event's notifications, in the subscriber's language", () => {
  beforeEach(() => {
    pages = [statusPage({ defaultLanguage: "de" })];
    subscribers = [subscriber()];
    customEmailTemplate = null;

    jest
      .spyOn(DatabaseConfig, "getHost")
      .mockResolvedValue(new Hostname("oneuptime.com"));
    jest
      .spyOn(DatabaseConfig, "getHttpProtocol")
      .mockResolvedValue(Protocol.HTTPS);
    jest
      .spyOn(StatusPageResourceService, "findByMonitors")
      .mockResolvedValue([]);
    jest
      .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
      .mockImplementation(async (): Promise<Array<StatusPage>> => {
        return pages;
      });
    jest
      .spyOn(StatusPageSubscriberService, "getSubscribersByStatusPage")
      .mockImplementation(async (): Promise<Array<StatusPageSubscriber>> => {
        return subscribers;
      });
    jest
      .spyOn(StatusPageService, "getStatusPageURL")
      .mockResolvedValue(STATUS_PAGE_URL);
    jest
      .spyOn(
        StatusPageSubscriberNotificationTemplateService,
        "getTemplateForStatusPage",
      )
      .mockImplementation(
        async (data: {
          notificationMethod: StatusPageSubscriberNotificationMethod;
        }): Promise<StatusPageSubscriberNotificationTemplate | null> => {
          return data.notificationMethod ===
            StatusPageSubscriberNotificationMethod.Email
            ? customEmailTemplate
            : null;
        },
      );
    jest
      .spyOn(ProjectSmtpConfigService, "toEmailServer")
      .mockReturnValue(undefined);
    jest
      .spyOn(ProjectCallSMSConfigService, "toTwilioConfig")
      .mockReturnValue(undefined);
    jest
      .spyOn(Markdown, "convertToHTML")
      .mockImplementation(async (markdown: string): Promise<string> => {
        return markdown;
      });
    jest.spyOn(MailService, "sendMail").mockResolvedValue(accepted());
    jest.spyOn(SmsService, "sendSms").mockResolvedValue(accepted());
    jest
      .spyOn(SlackUtil, "sendMessageToChannelViaIncomingWebhook")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(SlackUtil, "convertMarkdownToSlackRichText")
      .mockImplementation((markdown: string): string => {
        return markdown;
      });
    jest
      .spyOn(StatusPageSubscriberWebhookUtil, "sendWebhookNotification")
      .mockResolvedValue(accepted());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the default email: German subject, its own words in German, the start date in German", async () => {
    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
      scheduledEvent(),
    ]);

    const mail: JSONObject = sentMail();

    expect(mail["templateType"]).toBe(
      EmailTemplateType.SubscriberScheduledMaintenanceEventCreated,
    );
    expect(mail["subject"]).toBe(`[Geplante Wartung] ${TITLE}`);
    expect(mail["language"]).toBe("de");
    expect(String((mail["vars"] as JSONObject)["scheduledAt"])).toContain(
      "März",
    );
  });

  test("the text message and the Slack message, in German", async () => {
    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
      scheduledEvent(),
    ]);

    expect(sentSms()).toContain(
      `Geplante Wartung: ${TITLE} auf Acme Status. Details: ${DETAILS_URL}. Abbestellen: `,
    );
    expect(sentSlack()).toContain(`## 🔧 Geplante Wartung - ${TITLE}`);
    expect(sentSlack()).toContain("**Geplanter Termin:**");
    expect(sentSlack()).toContain("März");
    expect(sentSlack()).toContain("Statusseite ansehen");
    // And every date after it is English again.
    expect(getDateDisplayLanguage()).toBe("en");
  });

  test("a subscriber's own language comes before the page's", async () => {
    subscribers = [subscriber("es")];

    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
      scheduledEvent(),
    ]);

    expect(sentMail()["subject"]).toBe(`[Mantenimiento programado] ${TITLE}`);
    expect(sentMail()["language"]).toBe("es");
    expect(sentSms()).toContain("Mantenimiento programado:");
  });

  test("an English page sends what it always has", async () => {
    pages = [statusPage({})];

    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
      scheduledEvent(),
    ]);

    expect(sentMail()["subject"]).toBe(`[Scheduled Maintenance] ${TITLE}`);
    expect(Object.keys(sentMail())).not.toContain("language");
    expect(String((sentMail()["vars"] as JSONObject)["scheduledAt"])).toBe(
      OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
        date: STARTS_AT,
        timezones: [],
        use12HourFormat: true,
      }),
    );
    expect(sentSms()).toContain(
      `Scheduled Maintenance: ${TITLE} on Acme Status. Details: ${DETAILS_URL}. Unsub: `,
    );
  });

  test("a custom template is the team's own: its dates as they always were", async () => {
    pages = [statusPage({ defaultLanguage: "de", smtp: true })];
    const template: StatusPageSubscriberNotificationTemplate =
      new StatusPageSubscriberNotificationTemplate();
    template._id = "template-email";
    template.templateBody = "Beginn: {{scheduledStartTime}}";
    customEmailTemplate = template;

    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
      scheduledEvent(),
    ]);

    const mail: JSONObject = sentMail();

    expect(mail["templateType"]).toBe(EmailTemplateType.BlankTemplate);
    expect(String((mail["vars"] as JSONObject)["body"])).toBe(
      `Beginn: ${OneUptimeDate.getDateAsUserFriendlyFormattedString(STARTS_AT)}`,
    );
    expect(Object.keys(mail)).not.toContain("language");
    // A subject OneUptime gives the template is in the subscriber's language.
    expect(mail["subject"]).toBe(`[Geplante Wartung] ${TITLE}`);
  });
});
