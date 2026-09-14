import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
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
 * The other half of GitHub issue #3545.
 *
 * The worker jobs did not select `endsAt`, so this service received events
 * with the end time missing and rendered `{{scheduledEndTime}}` as an empty
 * string — while `{{scheduledStartTime}}` rendered fine, which is what made
 * the bug look like a template problem rather than a query problem.
 *
 * The worker suites pin that `endsAt` now arrives. This suite pins the
 * consequence: given an event that carries `endsAt`, every channel that
 * advertises `{{scheduledEndTime}}` to template authors — custom email, SMS
 * and Slack templates, plus the subscriber webhook payload — actually renders
 * the end time; and given an event without one, they degrade to an empty
 * string rather than printing "undefined" at a subscriber.
 *
 * Everything the service talks to is a `jest.spyOn`: no database, no mail
 * server, no Slack. What is under test is this service's own rendering, driven
 * through the real `compileTemplate`.
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
const ENDS_AT: Date = new Date("2024-03-04T08:00:00.000Z");

const TEMPLATE_BODY: string =
  "Start: {{scheduledStartTime}} | End: {{scheduledEndTime}}";

// What the template author expects to see rendered, in the service's own format.
const EXPECTED_END: string =
  OneUptimeDate.getDateAsUserFriendlyFormattedString(ENDS_AT);
const EXPECTED_START: string =
  OneUptimeDate.getDateAsUserFriendlyFormattedString(STARTS_AT);

// Every outbound channel here resolves an HTTPResponse rather than throwing.
function accepted(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, {}, {});
}

function scheduledEvent(endsAt?: Date): ScheduledMaintenance {
  const event: ScheduledMaintenance = new ScheduledMaintenance();

  event._id = EVENT_ID.toString();
  event.projectId = PROJECT_ID;
  event.title = "Quarterly database failover drill";
  event.description = "Failing over the primary.";
  event.startsAt = STARTS_AT;

  if (endsAt) {
    event.endsAt = endsAt;
  }

  const statusPage: StatusPage = new StatusPage();
  statusPage._id = STATUS_PAGE_ID.toString();
  event.statusPages = [statusPage];

  return event;
}

function statusPageWithCustomProviders(): StatusPage {
  const statusPage: StatusPage = new StatusPage();

  statusPage._id = STATUS_PAGE_ID.toString();
  statusPage.projectId = PROJECT_ID;
  statusPage.name = "Acme Status";
  statusPage.pageTitle = "Acme Status";
  statusPage.isPublicStatusPage = true;
  statusPage.showScheduledMaintenanceEventsOnStatusPage = true;
  statusPage.allowSubscribersToChooseResources = false;
  statusPage.allowSubscribersToChooseEventTypes = false;
  statusPage.subscriberTimezones = [];

  /*
   * Custom email and SMS templates are only honoured when the status page
   * brings its own SMTP/Twilio credentials, so both configs are required for
   * this suite to exercise the custom-template path at all.
   */
  const smtpConfig: ProjectSmtpConfig = new ProjectSmtpConfig();
  smtpConfig._id = "55555555-5555-4555-8555-555555555555";
  statusPage.smtpConfig = smtpConfig;

  const callSmsConfig: ProjectCallSMSConfig = new ProjectCallSMSConfig();
  callSmsConfig._id = "66666666-6666-4666-8666-666666666666";
  statusPage.callSmsConfig = callSmsConfig;

  return statusPage;
}

function subscriberOnEveryChannel(): StatusPageSubscriber {
  const subscriber: StatusPageSubscriber = new StatusPageSubscriber();

  subscriber._id = SUBSCRIBER_ID.toString();
  subscriber.statusPageId = STATUS_PAGE_ID;
  subscriber.isUnsubscribed = false;
  subscriber.isSubscribedToAllResources = true;
  subscriber.isSubscribedToAllEventTypes = true;
  subscriber.subscriberEmail = new Email("subscriber@example.com");
  subscriber.subscriberPhone = new Phone("+15558675309");
  subscriber.slackIncomingWebhookUrl = URL.fromString(
    "https://hooks.slack.com/services/T/B/X",
  );
  subscriber.subscriberWebhook = URL.fromString(
    "https://hooks.example.com/subscriber",
  );

  return subscriber;
}

function customTemplate(
  method: StatusPageSubscriberNotificationMethod,
): StatusPageSubscriberNotificationTemplate {
  const template: StatusPageSubscriberNotificationTemplate =
    new StatusPageSubscriberNotificationTemplate();

  template._id = `template-${method}`;
  template.templateBody = TEMPLATE_BODY;
  template.emailSubject = "Window ends {{scheduledEndTime}}";
  template.notificationMethod = method;

  return template;
}

// The rendered body of the one custom email this run produced.
function sentEmailBody(): string {
  const call: Array<unknown> = (MailService.sendMail as unknown as jest.Mock)
    .mock.calls[0]!;

  return String((call[0] as { vars: { body: string } }).vars.body);
}

function sentEmailSubject(): string {
  const call: Array<unknown> = (MailService.sendMail as unknown as jest.Mock)
    .mock.calls[0]!;

  return String((call[0] as { subject: string }).subject);
}

function sentSmsMessage(): string {
  const call: Array<unknown> = (SmsService.sendSms as unknown as jest.Mock).mock
    .calls[0]!;

  return String((call[0] as { message: string }).message);
}

function sentSlackMessage(): string {
  return String(
    (SlackUtil.convertMarkdownToSlackRichText as unknown as jest.Mock).mock
      .calls[0]![0],
  );
}

function sentWebhookPayload(): Record<string, string> {
  const call: Array<unknown> = (
    StatusPageSubscriberWebhookUtil.sendWebhookNotification as unknown as jest.Mock
  ).mock.calls[0]!;

  return (call[0] as { payload: { data: Record<string, string> } }).payload
    .data;
}

describe("scheduled maintenance subscriber notifications: {{scheduledEndTime}}", () => {
  beforeEach(() => {
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
      .mockResolvedValue([statusPageWithCustomProviders()]);

    jest
      .spyOn(StatusPageSubscriberService, "getSubscribersByStatusPage")
      .mockResolvedValue([subscriberOnEveryChannel()]);

    jest
      .spyOn(StatusPageService, "getStatusPageURL")
      .mockResolvedValue("https://status.example.com");

    jest
      .spyOn(
        StatusPageSubscriberNotificationTemplateService,
        "getTemplateForStatusPage",
      )
      .mockImplementation(
        async (data: {
          notificationMethod: StatusPageSubscriberNotificationMethod;
        }): Promise<StatusPageSubscriberNotificationTemplate | null> => {
          return customTemplate(data.notificationMethod);
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

  test("renders the end time in a custom email body", async () => {
    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
      scheduledEvent(ENDS_AT),
    ]);

    /*
     * Guards the fixture itself: an empty EXPECTED_END would make every
     * assertion in this file pass on the very bug it exists to catch.
     */
    expect(EXPECTED_END).not.toBe("");

    expect(MailService.sendMail).toHaveBeenCalledTimes(1);
    expect(sentEmailBody()).toBe(
      `Start: ${EXPECTED_START} | End: ${EXPECTED_END}`,
    );
  });

  test("renders the end time in a custom email subject", async () => {
    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
      scheduledEvent(ENDS_AT),
    ]);

    expect(sentEmailSubject()).toBe(`Window ends ${EXPECTED_END}`);
  });

  test("renders the end time in a custom SMS template", async () => {
    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
      scheduledEvent(ENDS_AT),
    ]);

    expect(SmsService.sendSms).toHaveBeenCalledTimes(1);
    expect(sentSmsMessage()).toBe(
      `Start: ${EXPECTED_START} | End: ${EXPECTED_END}`,
    );
  });

  test("renders the end time in a custom Slack template", async () => {
    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
      scheduledEvent(ENDS_AT),
    ]);

    expect(sentSlackMessage()).toBe(
      `Start: ${EXPECTED_START} | End: ${EXPECTED_END}`,
    );
  });

  test("sends the end time in the subscriber webhook payload", async () => {
    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
      scheduledEvent(ENDS_AT),
    ]);

    expect(sentWebhookPayload()["scheduledEndTime"]).toBe(EXPECTED_END);
    expect(sentWebhookPayload()["scheduledStartTime"]).toBe(EXPECTED_START);
  });

  test("renders an empty end time — never 'undefined' — for an open-ended event", async () => {
    /*
     * An event with no end time is legitimate. The subscriber should see a
     * blank, not the string "undefined": this is the behaviour the bug made
     * universal, and it has to survive as the genuine no-end-time case.
     */
    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
      scheduledEvent(undefined),
    ]);

    expect(sentEmailBody()).toBe(`Start: ${EXPECTED_START} | End: `);
    expect(sentSmsMessage()).toBe(`Start: ${EXPECTED_START} | End: `);
    expect(sentWebhookPayload()["scheduledEndTime"]).toBe("");
  });

  test("renders each event's own end time when several are notified at once", async () => {
    const laterEnd: Date = new Date("2024-03-05T09:30:00.000Z");

    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
      scheduledEvent(ENDS_AT),
      scheduledEvent(laterEnd),
    ]);

    const bodies: Array<string> = (
      MailService.sendMail as unknown as jest.Mock
    ).mock.calls.map((call: Array<unknown>) => {
      return String((call[0] as { vars: { body: string } }).vars.body);
    });

    expect(bodies).toEqual([
      `Start: ${EXPECTED_START} | End: ${EXPECTED_END}`,
      `Start: ${EXPECTED_START} | End: ${OneUptimeDate.getDateAsUserFriendlyFormattedString(
        laterEnd,
      )}`,
    ]);
  });
});
