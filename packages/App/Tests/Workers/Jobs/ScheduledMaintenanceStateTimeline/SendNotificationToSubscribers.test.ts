import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberNotificationTemplateVariables from "Common/Types/StatusPage/SubscriberNotificationTemplateVariables";

/*
 * Scheduled maintenance state change notifications. Custom templates for this
 * event are promised every variable SubscriberNotificationTemplateVariables
 * lists for it, on every channel that compiles one: email (with the page's own
 * SMTP), SMS (with the page's own Twilio), Slack and Microsoft Teams.
 * {{scheduledMaintenanceDescription}} used to be listed but never passed, so
 * it rendered as an empty string everywhere.
 *
 * Each channel gets the values in the format it renders: HTML in the custom
 * email body (it is wrapped only by BlankTemplate), plain text in SMS and the
 * email subject, and the Markdown as written in Slack and Teams. The resource
 * list is formatted by the real StatusPageResourceUtil, so the grouped
 * resource tests see the same "<br/>" and "; " separators production does.
 */

type CronHandler = () => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/DatabaseConfig", () => {
  return {
    __esModule: true,
    default: { getHost: jest.fn(), getHttpProtocol: jest.fn() },
  };
});

jest.mock(
  "Common/Server/Services/ScheduledMaintenanceStateTimelineService",
  () => {
    return {
      __esModule: true,
      default: { findAllBy: jest.fn(), updateOneById: jest.fn() },
    };
  },
);

jest.mock("Common/Server/Services/ScheduledMaintenanceService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      getScheduledMaintenanceLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ScheduledMaintenanceFeedService", () => {
  return {
    __esModule: true,
    default: { createScheduledMaintenanceFeedItem: jest.fn() },
  };
});

jest.mock("Common/Server/Services/StatusPageResourceService", () => {
  return { __esModule: true, default: { findByMonitors: jest.fn() } };
});

jest.mock("Common/Server/Services/StatusPageSubscriberService", () => {
  return {
    __esModule: true,
    default: {
      getStatusPagesToSendNotification: jest.fn(),
      getSubscribersByStatusPage: jest.fn(),
      shouldSendNotification: jest.fn(),
      getUnsubscribeLink: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/StatusPageService", () => {
  return {
    __esModule: true,
    default: { getStatusPageURL: jest.fn() },
    Service: {
      getSubscriberEmailFooterText: jest.fn(() => {
        return "Footer text";
      }),
    },
  };
});

jest.mock(
  "Common/Server/Services/StatusPageSubscriberNotificationTemplateService",
  () => {
    return {
      __esModule: true,
      default: { getTemplateForStatusPage: jest.fn() },
      /*
       * The real substitution: {{name}} -> value. A jest.fn so the tests can
       * read the variables each channel was given; clearAllMocks keeps the
       * implementation.
       */
      Service: {
        compileTemplate: jest.fn(
          (template: string, variables: Record<string, string>): string => {
            let compiled: string = template;
            for (const [key, value] of Object.entries(variables)) {
              compiled = compiled.replace(
                new RegExp(`{{\\s*${key}\\s*}}`, "g"),
                value || "",
              );
            }
            return compiled;
          },
        ),
      },
    };
  },
);

jest.mock("Common/Server/Services/MailService", () => {
  return { __esModule: true, default: { sendMail: jest.fn() } };
});

jest.mock("Common/Server/Services/SmsService", () => {
  return { __esModule: true, default: { sendSms: jest.fn() } };
});

jest.mock("Common/Server/Services/ProjectCallSMSConfigService", () => {
  return {
    __esModule: true,
    default: { toTwilioConfig: jest.fn(() => {}) },
  };
});

jest.mock("Common/Server/Services/ProjectSmtpConfigService", () => {
  return {
    __esModule: true,
    default: { toEmailServer: jest.fn(() => {}) },
  };
});

jest.mock("Common/Server/Types/Markdown", () => {
  return {
    __esModule: true,
    MarkdownContentType: { Email: "Email" },
    default: { convertToHTML: jest.fn(), convertToPlainText: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Workspace/Slack/Slack", () => {
  return {
    __esModule: true,
    default: {
      sendMessageToChannelViaIncomingWebhook: jest.fn(),
      convertMarkdownToSlackRichText: jest.fn((text: string) => {
        return text;
      }),
    },
  };
});

jest.mock("Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams", () => {
  return {
    __esModule: true,
    default: { sendMessageToChannelViaIncomingWebhook: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/StatusPageSubscriberWebhook", () => {
  return { __esModule: true, default: { sendWebhookNotification: jest.fn() } };
});

import DatabaseConfig from "Common/Server/DatabaseConfig";
import MailService from "Common/Server/Services/MailService";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "Common/Server/Services/ScheduledMaintenanceStateTimelineService";
import SmsService from "Common/Server/Services/SmsService";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService, {
  Service as StatusPageSubscriberNotificationTemplateServiceClass,
} from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import { getDefaultSubscriberNotificationTemplate } from "../../../../FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateDefaults";
import "../../../../FeatureSet/Workers/Jobs/ScheduledMaintenanceStateTimeline/SendNotificationToSubscribers";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const JOB: string =
  "ScheduledMaintenanceStateTimeline:SendNotificationToSubscribers";

const EVENT_TYPE: StatusPageSubscriberNotificationEventType =
  StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceStateChanged;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const EVENT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const TIMELINE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const OTHER_STATUS_PAGE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const STATE_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const CORE_GROUP_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

interface PageFixture {
  id: ObjectID;
  name: string;
  pageTitle: string;
  host: string;
  url: string;
}

const MAIN_PAGE: PageFixture = {
  id: STATUS_PAGE_ID,
  name: "Acme",
  pageTitle: "Acme Status",
  host: "status.acme.com",
  url: "https://status.acme.com",
};

// A second status page showing the same maintenance.
const OTHER_PAGE: PageFixture = {
  id: OTHER_STATUS_PAGE_ID,
  name: "Acme EU",
  pageTitle: "Acme EU Status",
  host: "status.acme.eu",
  url: "https://status.acme.eu",
};

const PAGES: Array<PageFixture> = [MAIN_PAGE, OTHER_PAGE];

function detailsUrlFor(page: PageFixture): string {
  return `${page.url}/scheduled-events/${EVENT_ID.toString()}`;
}

function unsubscribeUrlFor(page: PageFixture): string {
  return `${page.url}/update-subscription/${SUBSCRIBER_ID.toString()}`;
}

const STATUS_PAGE_URL: string = MAIN_PAGE.url;
const DETAILS_URL: string = detailsUrlFor(MAIN_PAGE);
const UNSUBSCRIBE_URL: string = unsubscribeUrlFor(MAIN_PAGE);
const DASHBOARD_URL: string =
  "https://oneuptime.acme.com/dashboard/scheduled-maintenance/12";

const EVENT_TITLE: string = "Payments cluster failover drill";
const DESCRIPTION: string =
  "Traffic moves to the **standby** region. See [the runbook](https://docs.acme.com/drill).";
const DESCRIPTION_HTML: string =
  '<p>Traffic moves to the <strong>standby</strong> region. See <a href="https://docs.acme.com/drill">the runbook</a>.</p>';
const DESCRIPTION_TEXT: string =
  "Traffic moves to the standby region. See the runbook.";

// What the mocked Markdown.convertToPlainText returns for each input.
const PLAIN_TEXT: Record<string, string> = {
  [DESCRIPTION]: DESCRIPTION_TEXT,
};

// What the mocked Markdown.convertToHTML returns for each email input.
const EMAIL_HTML: Record<string, string> = {
  [DESCRIPTION]: DESCRIPTION_HTML,
};

/*
 * The state this timeline row moved the maintenance to. The event itself is
 * given a different current state, so reading the state from the wrong place
 * shows up as a wrong value rather than a lucky match.
 */
const STATE_NAME: string = "Verifying Rollback";
const EVENT_CURRENT_STATE_NAME: string = "Completed";

const STARTS_AT: Date = new Date("2026-09-20T02:00:00.000Z");
const STARTS_AT_STRING: string =
  OneUptimeDate.getDateAsUserFriendlyFormattedString(STARTS_AT);

// The default fixture: one ungrouped resource on the main status page.
const DEFAULT_RESOURCES_AFFECTED: string = "Payments API";

/*
 * Two resources in the "Core" group and one ungrouped resource on the main
 * status page, and one resource on the other status page. Email bodies get
 * one group per line; every other channel gets them on one line.
 */
const GROUPED_RESOURCES_HTML: string =
  "Core: Payments API, Card vault<br/>Public website";
const GROUPED_RESOURCES_TEXT: string =
  "Core: Payments API, Card vault; Public website";
const OTHER_PAGE_RESOURCES_AFFECTED: string = "Billing API";

let pendingTimelines: Array<ScheduledMaintenanceStateTimeline> = [];
let storedEvent: ScheduledMaintenance | null = null;

function stateTimeline(overrides?: {
  isScheduledState?: boolean;
  withoutStateName?: boolean;
}): ScheduledMaintenanceStateTimeline {
  const timeline: ScheduledMaintenanceStateTimeline =
    new ScheduledMaintenanceStateTimeline();
  timeline._id = TIMELINE_ID.toString();
  timeline.scheduledMaintenanceId = EVENT_ID;
  timeline.scheduledMaintenanceStateId = STATE_ID;

  const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  if (!overrides?.withoutStateName) {
    state.name = STATE_NAME;
  }
  state.isScheduledState = Boolean(overrides?.isScheduledState);
  timeline.scheduledMaintenanceState = state;

  return timeline;
}

function scheduledEvent(overrides?: {
  withoutDescription?: boolean;
}): ScheduledMaintenance {
  const event: ScheduledMaintenance = new ScheduledMaintenance();
  event._id = EVENT_ID.toString();
  event.title = EVENT_TITLE;
  if (!overrides?.withoutDescription) {
    event.description = DESCRIPTION;
  }
  event.projectId = PROJECT_ID;
  event.startsAt = STARTS_AT;
  event.isVisibleOnStatusPage = true;
  event.scheduledMaintenanceNumber = 12;

  const currentState: ScheduledMaintenanceState =
    new ScheduledMaintenanceState();
  currentState.name = EVENT_CURRENT_STATE_NAME;
  event.currentScheduledMaintenanceState = currentState;

  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  event.monitors = [monitor];

  event.statusPages = PAGES.map((fixture: PageFixture): StatusPage => {
    const page: StatusPage = new StatusPage();
    page._id = fixture.id.toString();
    return page;
  });

  return event;
}

function statusPage(overrides?: {
  page?: PageFixture;
  // Custom SMTP and Twilio, so the custom email and SMS templates are used.
  withCustomDelivery?: boolean;
}): StatusPage {
  const fixture: PageFixture = overrides?.page || MAIN_PAGE;
  const page: StatusPage = new StatusPage();
  page._id = fixture.id.toString();
  page.projectId = PROJECT_ID;
  page.name = fixture.name;
  page.pageTitle = fixture.pageTitle;
  page.isPublicStatusPage = true;
  page.showScheduledMaintenanceEventsOnStatusPage = true;

  if (overrides?.withCustomDelivery) {
    (page as unknown as JSONObject)["smtpConfig"] = { _id: "smtp" };
    (page as unknown as JSONObject)["callSmsConfig"] = { _id: "twilio" };
  }

  return page;
}

function resource(data: {
  statusPageId: ObjectID;
  displayName: string;
  groupName?: string;
}): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = ObjectID.generate().toString();
  row.statusPageId = data.statusPageId;
  row.displayName = data.displayName;

  if (data.groupName) {
    const group: StatusPageGroup = new StatusPageGroup();
    group._id = CORE_GROUP_ID.toString();
    group.name = data.groupName;
    row.statusPageGroupId = CORE_GROUP_ID;
    row.statusPageGroup = group;
  }

  return row;
}

function groupedResources(): Array<StatusPageResource> {
  return [
    resource({
      statusPageId: STATUS_PAGE_ID,
      displayName: "Payments API",
      groupName: "Core",
    }),
    resource({
      statusPageId: STATUS_PAGE_ID,
      displayName: "Card vault",
      groupName: "Core",
    }),
    resource({
      statusPageId: STATUS_PAGE_ID,
      displayName: "Public website",
    }),
    resource({
      statusPageId: OTHER_STATUS_PAGE_ID,
      displayName: "Billing API",
    }),
  ];
}

function subscriber(): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row._id = SUBSCRIBER_ID.toString();
  row.subscriberEmail = new Email("customer@example.com");
  row.subscriberPhone = new Phone("+15555550100");
  row.slackIncomingWebhookUrl = URL.fromString(
    "https://hooks.slack.com/services/T000/B000/XXXX",
  );
  row.microsoftTeamsIncomingWebhookUrl = URL.fromString(
    "https://outlook.office.com/webhook/abc",
  );
  row.subscriberWebhook = URL.fromString("https://hooks.acme.com/status");
  return row;
}

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
}

function statusWrites(): Array<JSONObject> {
  return mock(
    ScheduledMaintenanceStateTimelineService.updateOneById,
  ).mock.calls.map((call: Array<unknown>): JSONObject => {
    return (call[0] as { data: JSONObject }).data;
  });
}

function sentMail(): Array<JSONObject> {
  return mock(MailService.sendMail).mock.calls.map(
    (call: Array<unknown>): JSONObject => {
      return call[0] as JSONObject;
    },
  );
}

function sentSms(): Array<string> {
  return mock(SmsService.sendSms).mock.calls.map(
    (call: Array<unknown>): string => {
      return (call[0] as { message: string }).message;
    },
  );
}

function sentSlack(): Array<string> {
  return mock(SlackUtil.sendMessageToChannelViaIncomingWebhook).mock.calls.map(
    (call: Array<unknown>): string => {
      return (call[0] as { text: string }).text;
    },
  );
}

function sentTeams(): Array<string> {
  return mock(
    MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
  ).mock.calls.map((call: Array<unknown>): string => {
    return (call[0] as { text: string }).text;
  });
}

function sentWebhooks(): Array<JSONObject> {
  return mock(
    StatusPageSubscriberWebhookUtil.sendWebhookNotification,
  ).mock.calls.map((call: Array<unknown>): JSONObject => {
    return (call[0] as { payload: JSONObject }).payload;
  });
}

function feedItems(): Array<JSONObject> {
  return mock(
    ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem,
  ).mock.calls.map((call: Array<unknown>): JSONObject => {
    return call[0] as JSONObject;
  });
}

interface CompileTemplateCall {
  // The channel the template belongs to: the label before the first "|".
  channel: string;
  template: string;
  variables: Record<string, string>;
}

// Every compileTemplate call, in order.
function compileTemplateCalls(): Array<CompileTemplateCall> {
  return mock(
    StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate,
  ).mock.calls.map((call: Array<unknown>): CompileTemplateCall => {
    const template: string = call[0] as string;
    return {
      channel: template.split("|")[0]!,
      template: template,
      variables: call[1] as Record<string, string>,
    };
  });
}

function compiledChannels(): Array<string> {
  return compileTemplateCalls()
    .map((call: CompileTemplateCall): string => {
      return call.channel;
    })
    .sort();
}

// The event type of every custom template lookup, in order.
function templateLookups(): Array<unknown> {
  return mock(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
  ).mock.calls.map((call: Array<unknown>): unknown => {
    return (call[0] as JSONObject)["eventType"];
  });
}

function queryArgs(fn: unknown): { query: JSONObject; select: JSONObject } {
  return mock(fn).mock.calls[0]![0] as {
    query: JSONObject;
    select: JSONObject;
  };
}

function customTemplate(
  body: string,
  emailSubject?: string,
): StatusPageSubscriberNotificationTemplate {
  const template: StatusPageSubscriberNotificationTemplate =
    new StatusPageSubscriberNotificationTemplate();
  template.templateBody = body;

  if (emailSubject) {
    template.emailSubject = emailSubject;
  }

  return template;
}

/*
 * Gives the status page a custom template on all four templated channels,
 * with the custom SMTP and Twilio config that email and SMS need to use them.
 * Each body starts with its channel's name so a test can tell which channel a
 * compiled message came from. The email template also has a custom subject
 * unless `withoutSubject` is set.
 *
 * The templates exist only for the state changed event. A lookup for any
 * other event finds nothing, so a job that asks for the wrong event's
 * templates sends the defaults and the test fails.
 */
function useCustomTemplates(data: {
  body: string;
  subject?: string;
  withoutSubject?: boolean;
}): void {
  mock(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
  ).mockImplementation(async (args: unknown) => {
    if ((args as JSONObject)["eventType"] !== EVENT_TYPE) {
      return null;
    }

    const method: StatusPageSubscriberNotificationMethod = (args as JSONObject)[
      "notificationMethod"
    ] as StatusPageSubscriberNotificationMethod;

    if (method === StatusPageSubscriberNotificationMethod.Email) {
      return customTemplate(
        `Email|${data.body}`,
        data.withoutSubject
          ? undefined
          : `Subject|${data.subject || data.body}`,
      );
    }

    return customTemplate(`${method}|${data.body}`);
  });

  mock(
    StatusPageSubscriberService.getStatusPagesToSendNotification,
  ).mockResolvedValue([statusPage({ withCustomDelivery: true })] as never);
}

// The email sent with a custom template: its compiled body and subject.
function sentCustomEmails(): Array<{ body: string; subject: string }> {
  return sentMail().map(
    (mail: JSONObject): { body: string; subject: string } => {
      expect(mail["templateType"]).toBe(EmailTemplateType.BlankTemplate);
      return {
        body: (mail["vars"] as JSONObject)["body"] as string,
        subject: mail["subject"] as string,
      };
    },
  );
}

/*
 * Every message a custom template produced, labelled by channel: the email
 * body, the email subject, SMS, Slack and Teams.
 */
function sentCustomMessages(): Array<string> {
  return [
    ...sentCustomEmails().flatMap(
      (email: { body: string; subject: string }): Array<string> => {
        return [email.body, email.subject];
      },
    ),
    ...sentSms(),
    ...sentSlack(),
    ...sentTeams(),
  ];
}

/*
 * The message each templated channel gets from a template rendering `body`,
 * in the order sentCustomMessages lists them. `body` is what Slack and Teams
 * render (the Markdown as written). `emailBody` is the HTML email body and
 * `plainTextBody` the email subject and SMS; each defaults to `body` for
 * templates whose values read the same in every format.
 */
function expectedCustomMessages(data: {
  body: string;
  emailBody?: string;
  plainTextBody?: string;
}): Array<string> {
  return [
    `Email|${data.emailBody ?? data.body}`,
    `Subject|${data.plainTextBody ?? data.body}`,
    `SMS|${data.plainTextBody ?? data.body}`,
    `Slack|${data.body}`,
    `Microsoft Teams|${data.body}`,
  ];
}

/*
 * The variables each templated channel must be given for the main status page
 * with the grouped resources, by channel label.
 */
function expectedVariablesByChannel(): Record<string, Record<string, string>> {
  const shared: Record<string, string> = {
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    unsubscribeUrl: UNSUBSCRIBE_URL,
    detailsUrl: DETAILS_URL,
    scheduledMaintenanceTitle: EVENT_TITLE,
    scheduledMaintenanceState: STATE_NAME,
    // Not advertised, but always passed, so existing templates keep it.
    scheduledAt: STARTS_AT_STRING,
  };
  const emailBody: Record<string, string> = {
    ...shared,
    resourcesAffected: GROUPED_RESOURCES_HTML,
    scheduledMaintenanceDescription: DESCRIPTION_HTML,
  };
  const plainText: Record<string, string> = {
    ...shared,
    resourcesAffected: GROUPED_RESOURCES_TEXT,
    scheduledMaintenanceDescription: DESCRIPTION_TEXT,
  };
  const markdown: Record<string, string> = {
    ...shared,
    resourcesAffected: GROUPED_RESOURCES_TEXT,
    scheduledMaintenanceDescription: DESCRIPTION,
  };

  return {
    Email: emailBody,
    Subject: plainText,
    SMS: plainText,
    Slack: markdown,
    "Microsoft Teams": markdown,
  };
}

// The description each channel's template is given.
function descriptionForChannel(channel: string): string {
  switch (channel) {
    case "Email":
      return DESCRIPTION_HTML;
    case "Subject":
    case "SMS":
      return DESCRIPTION_TEXT;
    case "Slack":
    case "Microsoft Teams":
      return DESCRIPTION;
    default:
      throw new Error(`Unexpected channel ${channel}`);
  }
}

function nothingSent(): void {
  expect(MailService.sendMail).not.toHaveBeenCalled();
  expect(SmsService.sendSms).not.toHaveBeenCalled();
  expect(
    SlackUtil.sendMessageToChannelViaIncomingWebhook,
  ).not.toHaveBeenCalled();
  expect(
    MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
  ).not.toHaveBeenCalled();
  expect(
    StatusPageSubscriberWebhookUtil.sendWebhookNotification,
  ).not.toHaveBeenCalled();
}

// The dashboard's starter template for a channel, rendered with the fixture.
function dashboardDefault(
  method: StatusPageSubscriberNotificationMethod,
): string {
  const template: string =
    getDefaultSubscriberNotificationTemplate(EVENT_TYPE, method)?.body || "";
  expect(template).not.toBe("");

  const variables: Record<string, string> = {
    statusPageName: MAIN_PAGE.pageTitle,
    statusPageUrl: STATUS_PAGE_URL,
    detailsUrl: DETAILS_URL,
    unsubscribeUrl: UNSUBSCRIBE_URL,
    resourcesAffected: DEFAULT_RESOURCES_AFFECTED,
    scheduledMaintenanceTitle: EVENT_TITLE,
    scheduledMaintenanceState: STATE_NAME,
  };

  return template.replace(/{{\s*(\w+)\s*}}/g, (_match: string, key: string) => {
    return variables[key] ?? "";
  });
}

async function runJob(): Promise<void> {
  expect(mockCapturedJobs[JOB]).toBeDefined();
  await mockCapturedJobs[JOB]!();
}

beforeEach(() => {
  jest.clearAllMocks();

  pendingTimelines = [stateTimeline()];
  storedEvent = scheduledEvent();

  mock(ScheduledMaintenanceStateTimelineService.findAllBy).mockImplementation(
    async (): Promise<Array<ScheduledMaintenanceStateTimeline>> => {
      return pendingTimelines;
    },
  );
  mock(
    ScheduledMaintenanceStateTimelineService.updateOneById,
  ).mockResolvedValue(1 as never);

  mock(ScheduledMaintenanceService.findOneById).mockImplementation(async () => {
    return storedEvent;
  });
  mock(
    ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard,
  ).mockResolvedValue(URL.fromString(DASHBOARD_URL) as never);
  mock(
    ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem,
  ).mockResolvedValue(undefined as never);

  mock(StatusPageResourceService.findByMonitors).mockResolvedValue([
    resource({
      statusPageId: STATUS_PAGE_ID,
      displayName: DEFAULT_RESOURCES_AFFECTED,
    }),
  ] as never);

  mock(DatabaseConfig.getHost).mockResolvedValue(
    Hostname.fromString("oneuptime.acme.com") as never,
  );
  mock(DatabaseConfig.getHttpProtocol).mockResolvedValue(
    Protocol.HTTPS as never,
  );

  mock(
    StatusPageSubscriberService.getStatusPagesToSendNotification,
  ).mockResolvedValue([statusPage()] as never);
  mock(
    StatusPageSubscriberService.getSubscribersByStatusPage,
  ).mockResolvedValue([subscriber()] as never);
  mock(StatusPageSubscriberService.shouldSendNotification).mockReturnValue(
    true,
  );
  // Each status page's unsubscribe link is on its own host.
  mock(StatusPageSubscriberService.getUnsubscribeLink).mockImplementation(
    (url: unknown, subscriberId: unknown): URL => {
      return URL.fromString(
        `https://${(url as URL).hostname.toString()}/update-subscription/${(subscriberId as ObjectID).toString()}`,
      );
    },
  );
  mock(StatusPageService.getStatusPageURL).mockImplementation(
    async (statusPageId: unknown): Promise<string> => {
      const page: PageFixture | undefined = PAGES.find(
        (fixture: PageFixture): boolean => {
          return (
            fixture.id.toString() === (statusPageId as ObjectID).toString()
          );
        },
      );
      return page!.url;
    },
  );
  mock(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
  ).mockResolvedValue(null as never);

  mock(Markdown.convertToPlainText).mockImplementation(
    (markdown: unknown): string => {
      return PLAIN_TEXT[markdown as string] ?? (markdown as string);
    },
  );
  mock(Markdown.convertToHTML).mockImplementation(
    async (markdown: unknown, contentType: unknown): Promise<string> => {
      if (contentType !== MarkdownContentType.Email) {
        return "HTML for the wrong content type";
      }
      return EMAIL_HTML[markdown as string] ?? "";
    },
  );

  mock(MailService.sendMail).mockResolvedValue(undefined as never);
  mock(SmsService.sendSms).mockResolvedValue(undefined as never);
  mock(SlackUtil.sendMessageToChannelViaIncomingWebhook).mockResolvedValue(
    undefined as never,
  );
  mock(
    MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
  ).mockResolvedValue(undefined as never);
  mock(
    StatusPageSubscriberWebhookUtil.sendWebhookNotification,
  ).mockResolvedValue(undefined as never);
});

describe("ScheduledMaintenanceStateTimeline:SendNotificationToSubscribers", () => {
  test("is registered", () => {
    expect(mockCapturedJobs[JOB]).toBeDefined();
  });

  test("looks for pending state changes whose author asked to notify", async () => {
    await runJob();

    const args: { query: JSONObject; select: JSONObject } = queryArgs(
      ScheduledMaintenanceStateTimelineService.findAllBy,
    );

    expect(args.query).toEqual({
      subscriberNotificationStatus:
        StatusPageSubscriberNotificationStatus.Pending,
      shouldStatusPageSubscribersBeNotified: true,
    });
    expect(args.select["scheduledMaintenanceState"]).toEqual({
      name: true,
      isScheduledState: true,
    });
  });

  test("sends the default SMS, Slack and Teams messages, matching the dashboard starters", async () => {
    await runJob();

    expect(compileTemplateCalls()).toEqual([]);

    expect(sentSms()).toEqual([
      `Maintenance ${EVENT_TITLE} on Acme Status is ${STATE_NAME}. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
    ]);
    expect(sentSms()[0]).toBe(
      dashboardDefault(StatusPageSubscriberNotificationMethod.SMS),
    );

    expect(sentSlack()).toEqual([
      `## Scheduled Maintenance State Update - Acme Status

**Event:** ${EVENT_TITLE}

**State Changed To:** ${STATE_NAME}

**Resources Affected:** ${DEFAULT_RESOURCES_AFFECTED}

[View Status Page](${STATUS_PAGE_URL}) | [Unsubscribe](${UNSUBSCRIBE_URL})`,
    ]);
    expect(sentSlack()[0]).toBe(
      dashboardDefault(StatusPageSubscriberNotificationMethod.Slack),
    );

    expect(sentTeams()).toEqual([
      `## Scheduled Maintenance State Update - Acme Status
**Event:** ${EVENT_TITLE}
**State Changed To:** ${STATE_NAME}
**Resources Affected:** ${DEFAULT_RESOURCES_AFFECTED}
[View Status Page](${STATUS_PAGE_URL}) | [Unsubscribe](${UNSUBSCRIBE_URL})`,
    ]);
    expect(sentTeams()[0]).toBe(
      dashboardDefault(StatusPageSubscriberNotificationMethod.MicrosoftTeams),
    );
  });

  test("sends the default state change email it always has", async () => {
    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberScheduledMaintenanceEventStateChanged,
    );
    expect(sentMail()[0]!["subject"]).toBe(
      `[${STATE_NAME} Scheduled Maintenance] ${EVENT_TITLE}`,
    );
    expect(sentMail()[0]!["vars"]).toEqual({
      statusPageName: "Acme Status",
      statusPageUrl: STATUS_PAGE_URL,
      detailsUrl: DETAILS_URL,
      logoUrl: "",
      isPublicStatusPage: "true",
      resourcesAffected: DEFAULT_RESOURCES_AFFECTED,
      eventState: STATE_NAME,
      scheduledAt: STARTS_AT_STRING,
      eventTitle: EVENT_TITLE,
      unsubscribeUrl: UNSUBSCRIBE_URL,
      subscriberEmailNotificationFooterText: "Footer text",
    });
  });

  test("sends the webhook payload it always has, plus the description as written", async () => {
    await runJob();

    expect(sentWebhooks()).toEqual([
      {
        eventType: "ScheduledMaintenanceStateChanged",
        statusPageId: STATUS_PAGE_ID.toString(),
        statusPageName: "Acme Status",
        statusPageUrl: STATUS_PAGE_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
        data: {
          scheduledMaintenanceId: EVENT_ID.toString(),
          scheduledMaintenanceTitle: EVENT_TITLE,
          scheduledMaintenanceDescription: DESCRIPTION,
          scheduledMaintenanceState: STATE_NAME,
          resourcesAffected: DEFAULT_RESOURCES_AFFECTED,
          detailsUrl: DETAILS_URL,
        },
      },
    ]);
  });

  test("sends webhooks the grouped resources as a plain-text list", async () => {
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
      groupedResources() as never,
    );

    await runJob();

    expect(sentWebhooks()).toHaveLength(1);
    expect(sentWebhooks()[0]!["eventType"]).toBe(
      "ScheduledMaintenanceStateChanged",
    );
    expect(sentWebhooks()[0]!["data"]).toEqual({
      scheduledMaintenanceId: EVENT_ID.toString(),
      scheduledMaintenanceTitle: EVENT_TITLE,
      scheduledMaintenanceDescription: DESCRIPTION,
      scheduledMaintenanceState: STATE_NAME,
      resourcesAffected: GROUPED_RESOURCES_TEXT,
      detailsUrl: DETAILS_URL,
    });
  });

  test("still gives the default email the grouped resources as HTML", async () => {
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
      groupedResources() as never,
    );

    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberScheduledMaintenanceEventStateChanged,
    );
    expect(sentMail()[0]!["vars"]).toEqual(
      expect.objectContaining({
        resourcesAffected: GROUPED_RESOURCES_HTML,
      }),
    );
  });

  test("records the notification in the feed and marks the state change sent", async () => {
    await runJob();

    expect(feedItems()).toHaveLength(1);
    expect(feedItems()[0]!["feedInfoInMarkdown"]).toBe(
      `📧 **Status Page Subscribers have been notified** about the state change of the [Scheduled Maintenance 12](${DASHBOARD_URL}) to **${STATE_NAME}**`,
    );
    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatus:
          StatusPageSubscriberNotificationStatus.InProgress,
      },
      {
        subscriberNotificationStatus:
          StatusPageSubscriberNotificationStatus.Success,
        subscriberNotificationStatusMessage:
          "Notifications sent successfully to all subscribers",
      },
    ]);
  });

  test("skips the move to the scheduled state, which the created notification covers", async () => {
    pendingTimelines = [stateTimeline({ isScheduledState: true })];

    await runJob();

    nothingSent();
    expect(ScheduledMaintenanceService.findOneById).not.toHaveBeenCalled();
    expect(statusWrites()[statusWrites().length - 1]).toEqual(
      expect.objectContaining({
        subscriberNotificationStatus:
          StatusPageSubscriberNotificationStatus.Skipped,
      }),
    );
  });

  test("marks the state change Failed with the reason when the description cannot be converted", async () => {
    useCustomTemplates({ body: "desc={{scheduledMaintenanceDescription}}" });
    mock(Markdown.convertToHTML).mockRejectedValue(
      new Error("markdown exploded") as never,
    );

    await runJob();

    nothingSent();
    expect(statusWrites()[statusWrites().length - 1]).toEqual({
      subscriberNotificationStatus:
        StatusPageSubscriberNotificationStatus.Failed,
      subscriberNotificationStatusMessage: "markdown exploded",
    });
  });

  test("skips a state with no name", async () => {
    pendingTimelines = [stateTimeline({ withoutStateName: true })];

    await runJob();

    nothingSent();
    expect(statusWrites()[statusWrites().length - 1]).toEqual({
      subscriberNotificationStatus:
        StatusPageSubscriberNotificationStatus.Skipped,
      subscriberNotificationStatusMessage:
        "Scheduled maintenance state has no name. Skipping notifications.",
    });
  });
});

/*
 * Custom templates can use every variable SubscriberNotificationTemplateVariables
 * advertises for the state changed event, on every templated channel.
 */
describe("ScheduledMaintenanceStateTimeline custom template variables", () => {
  test("looks up custom templates for the state changed event", async () => {
    await runJob();

    expect(templateLookups()).toEqual([
      EVENT_TYPE,
      EVENT_TYPE,
      EVENT_TYPE,
      EVENT_TYPE,
    ]);
  });

  test("passes every advertised variable to every custom template", async () => {
    useCustomTemplates({ body: "Hello", subject: "Subject" });

    await runJob();

    const names: Array<string> =
      SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
        EVENT_TYPE,
      );
    expect(names).toContain("scheduledMaintenanceDescription");
    expect(names).toContain("scheduledMaintenanceState");
    expect(names).toContain("resourcesAffected");

    const calls: Array<CompileTemplateCall> = compileTemplateCalls();

    // Email body, email subject, SMS, Slack and Teams: all four channels.
    expect(calls).toHaveLength(5);
    expect(compiledChannels()).toEqual([
      "Email",
      "Microsoft Teams",
      "SMS",
      "Slack",
      "Subject",
    ]);

    const missing: Array<string> = [];

    for (const call of calls) {
      for (const name of names) {
        if (
          !Object.prototype.hasOwnProperty.call(call.variables, name) ||
          typeof call.variables[name] !== "string"
        ) {
          missing.push(`${call.template}: ${name}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test("gives every channel the same variables, each in the format that channel renders", async () => {
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
      groupedResources() as never,
    );
    useCustomTemplates({ body: "Hello", subject: "Subject" });

    await runJob();

    const expected: Record<
      string,
      Record<string, string>
    > = expectedVariablesByChannel();

    const calls: Array<CompileTemplateCall> = compileTemplateCalls();
    expect(calls).toHaveLength(5);
    expect(compiledChannels()).toEqual(Object.keys(expected).sort());

    for (const call of calls) {
      expect({ channel: call.channel, variables: call.variables }).toEqual({
        channel: call.channel,
        variables: expected[call.channel],
      });
    }

    // Only the HTML email body gets "<br/>" or HTML markup.
    for (const call of calls) {
      if (call.channel === "Email") {
        continue;
      }
      for (const value of Object.values(call.variables)) {
        expect(value).not.toContain("<");
      }
    }
  });

  test("gives every channel the same variables, with only the description and the resource list's separator in each channel's format", async () => {
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
      groupedResources() as never,
    );
    useCustomTemplates({ body: "Hello", subject: "Subject" });

    await runJob();

    const expected: Record<string, string> = {
      statusPageName: "Acme Status",
      statusPageUrl: STATUS_PAGE_URL,
      unsubscribeUrl: UNSUBSCRIBE_URL,
      detailsUrl: DETAILS_URL,
      resourcesAffected: GROUPED_RESOURCES_TEXT,
      scheduledMaintenanceTitle: EVENT_TITLE,
      scheduledMaintenanceDescription: DESCRIPTION,
      scheduledMaintenanceState: STATE_NAME,
      // Not advertised, but always passed, so existing templates keep it.
      scheduledAt: STARTS_AT_STRING,
    };

    const calls: Array<CompileTemplateCall> = compileTemplateCalls();
    expect(calls).toHaveLength(5);

    for (const call of calls) {
      expect({ channel: call.channel, variables: call.variables }).toEqual({
        channel: call.channel,
        variables: {
          ...expected,
          // The email body lists the groups one per line ("<br/>").
          resourcesAffected:
            call.channel === "Email"
              ? GROUPED_RESOURCES_HTML
              : GROUPED_RESOURCES_TEXT,
          scheduledMaintenanceDescription: descriptionForChannel(call.channel),
        },
      });
    }

    const descriptions: Record<string, string> = {};
    for (const call of calls) {
      descriptions[call.channel] =
        call.variables["scheduledMaintenanceDescription"]!;
    }
    expect(descriptions).toEqual({
      Email: DESCRIPTION_HTML,
      Subject: DESCRIPTION_TEXT,
      SMS: DESCRIPTION_TEXT,
      Slack: DESCRIPTION,
      "Microsoft Teams": DESCRIPTION,
    });
  });

  test("renders HTML in the email body, plain text in SMS and the subject, and Markdown in chat", async () => {
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
      groupedResources() as never,
    );
    useCustomTemplates({
      body: "{{scheduledMaintenanceState}}: {{scheduledMaintenanceDescription}} ({{resourcesAffected}})",
      subject:
        "{{scheduledMaintenanceTitle}} is {{scheduledMaintenanceState}}: {{scheduledMaintenanceDescription}} ({{resourcesAffected}})",
    });

    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.BlankTemplate,
    );
    expect(sentMail()[0]!["vars"]).toEqual({
      body: `Email|${STATE_NAME}: ${DESCRIPTION_HTML} (${GROUPED_RESOURCES_HTML})`,
    });
    expect(sentMail()[0]!["subject"]).toBe(
      `Subject|${EVENT_TITLE} is ${STATE_NAME}: ${DESCRIPTION_TEXT} (${GROUPED_RESOURCES_TEXT})`,
    );
    expect(sentSms()).toEqual([
      `SMS|${STATE_NAME}: ${DESCRIPTION_TEXT} (${GROUPED_RESOURCES_TEXT})`,
    ]);
    expect(sentSlack()).toEqual([
      `Slack|${STATE_NAME}: ${DESCRIPTION} (${GROUPED_RESOURCES_TEXT})`,
    ]);
    expect(sentTeams()).toEqual([
      `Microsoft Teams|${STATE_NAME}: ${DESCRIPTION} (${GROUPED_RESOURCES_TEXT})`,
    ]);
  });

  test("renders a template that uses every advertised variable with nothing left over", async () => {
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
      groupedResources() as never,
    );

    const names: Array<string> =
      SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
        EVENT_TYPE,
      );
    const body: string = names
      .map((name: string): string => {
        return `${name}=[{{${name}}}]`;
      })
      .join("\n");

    useCustomTemplates({ body: body });

    await runJob();

    const messages: Array<string> = sentCustomMessages();
    expect(messages).toHaveLength(5);

    for (const message of messages) {
      expect(message).not.toMatch(/{{.*?}}/);

      for (const name of names) {
        expect(message).toContain(`${name}=[`);
        expect(message).not.toContain(`${name}=[]`);
      }
    }

    // The value each variable must render as in Slack and Teams.
    const values: Record<string, string> = {
      statusPageName: "Acme Status",
      statusPageUrl: STATUS_PAGE_URL,
      unsubscribeUrl: UNSUBSCRIBE_URL,
      resourcesAffected: GROUPED_RESOURCES_TEXT,
      scheduledMaintenanceTitle: EVENT_TITLE,
      scheduledMaintenanceDescription: DESCRIPTION,
      scheduledMaintenanceState: STATE_NAME,
      detailsUrl: DETAILS_URL,
    };
    // The email body gets HTML.
    const emailBodyValues: Record<string, string> = {
      ...values,
      resourcesAffected: GROUPED_RESOURCES_HTML,
      scheduledMaintenanceDescription: DESCRIPTION_HTML,
    };
    // SMS and the email subject get plain text.
    const plainTextValues: Record<string, string> = {
      ...values,
      scheduledMaintenanceDescription: DESCRIPTION_TEXT,
    };
    expect(Object.keys(values).sort()).toEqual([...names].sort());

    const render: (valuesToUse: Record<string, string>) => string = (
      valuesToUse: Record<string, string>,
    ): string => {
      return names
        .map((name: string): string => {
          return `${name}=[${valuesToUse[name]}]`;
        })
        .join("\n");
    };

    expect(messages).toEqual(
      expectedCustomMessages({
        body: render(values),
        emailBody: render(emailBodyValues),
        plainTextBody: render(plainTextValues),
      }),
    );
  });

  test("gives the description as HTML in the email body, plain text in SMS and the subject, and as written in chat", async () => {
    useCustomTemplates({ body: "desc={{scheduledMaintenanceDescription}}" });

    await runJob();

    expect(DESCRIPTION_TEXT).not.toBe(DESCRIPTION);
    expect(DESCRIPTION_HTML).not.toBe(DESCRIPTION);
    expect(sentCustomMessages()).toEqual(
      expectedCustomMessages({
        body: `desc=${DESCRIPTION}`,
        emailBody: `desc=${DESCRIPTION_HTML}`,
        plainTextBody: `desc=${DESCRIPTION_TEXT}`,
      }),
    );
    expect(Markdown.convertToPlainText).toHaveBeenCalledWith(DESCRIPTION);
    expect(Markdown.convertToHTML).toHaveBeenCalledWith(
      DESCRIPTION,
      MarkdownContentType.Email,
    );
    expect(
      queryArgs(ScheduledMaintenanceService.findOneById).select["description"],
    ).toBe(true);
  });

  test("gives the description as HTML in the email body, as plain text in the email subject and SMS, and as written in Slack and Teams", async () => {
    useCustomTemplates({ body: "desc={{scheduledMaintenanceDescription}}" });

    await runJob();

    expect(
      new Set([DESCRIPTION, DESCRIPTION_HTML, DESCRIPTION_TEXT]).size,
    ).toBe(3);
    expect(sentCustomMessages()).toEqual(
      expectedCustomMessages({
        body: `desc=${DESCRIPTION}`,
        emailBody: `desc=${DESCRIPTION_HTML}`,
        plainTextBody: `desc=${DESCRIPTION_TEXT}`,
      }),
    );
    expect(mock(Markdown.convertToHTML).mock.calls).toEqual([
      [DESCRIPTION, MarkdownContentType.Email],
    ]);
    expect(mock(Markdown.convertToPlainText).mock.calls).toEqual([
      [DESCRIPTION],
    ]);
    expect(
      queryArgs(ScheduledMaintenanceService.findOneById).select["description"],
    ).toBe(true);
  });

  test("renders an empty description when the maintenance has none", async () => {
    storedEvent = scheduledEvent({ withoutDescription: true });
    useCustomTemplates({ body: "desc=[{{scheduledMaintenanceDescription}}]" });

    await runJob();

    expect(sentCustomMessages()).toEqual(
      expectedCustomMessages({ body: "desc=[]" }),
    );

    const calls: Array<CompileTemplateCall> = compileTemplateCalls();
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.variables["scheduledMaintenanceDescription"]).toBe("");
    }
    expect(
      (sentWebhooks()[0]!["data"] as JSONObject)[
        "scheduledMaintenanceDescription"
      ],
    ).toBe("");
  });

  test("gives the state the maintenance moved to, not its current state or start date", async () => {
    useCustomTemplates({ body: "state={{scheduledMaintenanceState}}" });

    await runJob();

    expect(STATE_NAME).not.toBe(EVENT_CURRENT_STATE_NAME);
    expect(sentCustomMessages()).toEqual(
      expectedCustomMessages({ body: `state=${STATE_NAME}` }),
    );
    for (const message of sentCustomMessages()) {
      expect(message).not.toContain(EVENT_CURRENT_STATE_NAME);
      expect(message).not.toContain(STARTS_AT_STRING);
    }
  });

  test("lists the affected resources on this status page, by group", async () => {
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
      groupedResources() as never,
    );
    useCustomTemplates({ body: "resources={{resourcesAffected}}" });

    await runJob();

    // One group per line in the email body, all on one line elsewhere.
    expect(sentCustomMessages()).toEqual(
      expectedCustomMessages({
        body: `resources=${GROUPED_RESOURCES_TEXT}`,
        emailBody: `resources=${GROUPED_RESOURCES_HTML}`,
      }),
    );
    for (const message of sentCustomMessages()) {
      expect(message).not.toContain(OTHER_PAGE_RESOURCES_AFFECTED);
    }
    // Webhooks are not templated, but list the same resources, as plain text.
    expect(
      (sentWebhooks()[0]!["data"] as JSONObject)["resourcesAffected"],
    ).toBe(GROUPED_RESOURCES_TEXT);

    const args: { monitors: Array<Monitor>; select: JSONObject } = mock(
      StatusPageResourceService.findByMonitors,
    ).mock.calls[0]![0] as { monitors: Array<Monitor>; select: JSONObject };
    expect(
      args.monitors.map((monitor: Monitor): string => {
        return monitor._id!.toString();
      }),
    ).toEqual([MONITOR_ID.toString()]);
    expect(args.select["statusPageGroupId"]).toBe(true);
    expect(args.select["statusPageGroup"]).toEqual({ name: true });
  });

  test("renders no resources when the maintenance affects none on this status page", async () => {
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue([
      resource({
        statusPageId: OTHER_STATUS_PAGE_ID,
        displayName: OTHER_PAGE_RESOURCES_AFFECTED,
      }),
    ] as never);
    useCustomTemplates({ body: "resources=[{{resourcesAffected}}]" });

    await runJob();

    expect(sentCustomMessages()).toEqual(
      expectedCustomMessages({ body: "resources=[]" }),
    );
  });

  test("builds each status page's variables from that page", async () => {
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
      groupedResources() as never,
    );
    useCustomTemplates({ body: "Hello" });
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([
      statusPage({ page: MAIN_PAGE, withCustomDelivery: true }),
      statusPage({ page: OTHER_PAGE, withCustomDelivery: true }),
    ] as never);

    await runJob();

    // The email body gets the main page's groups one per line.
    const htmlResourcesByPage: Record<string, string> = {
      [MAIN_PAGE.url]: GROUPED_RESOURCES_HTML,
      [OTHER_PAGE.url]: OTHER_PAGE_RESOURCES_AFFECTED,
    };
    const plainTextResourcesByPage: Record<string, string> = {
      [MAIN_PAGE.url]: GROUPED_RESOURCES_TEXT,
      [OTHER_PAGE.url]: OTHER_PAGE_RESOURCES_AFFECTED,
    };

    const calls: Array<CompileTemplateCall> = compileTemplateCalls();
    // Five compiled messages for each of the two status pages.
    expect(calls).toHaveLength(10);

    const pagesSeen: Array<string> = [];

    for (const call of calls) {
      const page: PageFixture | undefined = PAGES.find(
        (fixture: PageFixture): boolean => {
          return fixture.url === call.variables["statusPageUrl"];
        },
      );
      expect(page).toBeDefined();
      pagesSeen.push(`${page!.pageTitle}:${call.channel}`);

      expect(call.variables).toEqual(
        expect.objectContaining({
          statusPageName: page!.pageTitle,
          statusPageUrl: page!.url,
          detailsUrl: detailsUrlFor(page!),
          unsubscribeUrl: unsubscribeUrlFor(page!),
          resourcesAffected:
            call.channel === "Email"
              ? htmlResourcesByPage[page!.url]
              : plainTextResourcesByPage[page!.url],
          scheduledMaintenanceTitle: EVENT_TITLE,
          scheduledMaintenanceDescription: descriptionForChannel(call.channel),
          scheduledMaintenanceState: STATE_NAME,
        }),
      );
    }

    expect(pagesSeen.sort()).toEqual(
      [
        "Acme EU Status:Email",
        "Acme EU Status:Microsoft Teams",
        "Acme EU Status:SMS",
        "Acme EU Status:Slack",
        "Acme EU Status:Subject",
        "Acme Status:Email",
        "Acme Status:Microsoft Teams",
        "Acme Status:SMS",
        "Acme Status:Slack",
        "Acme Status:Subject",
      ].sort(),
    );
    // The description is converted once for the state change, not per page.
    expect(Markdown.convertToHTML).toHaveBeenCalledTimes(1);
    expect(Markdown.convertToPlainText).toHaveBeenCalledTimes(1);
  });

  test("falls back to the default custom subject when the email template has none", async () => {
    useCustomTemplates({
      body: "desc={{scheduledMaintenanceDescription}}",
      withoutSubject: true,
    });

    await runJob();

    expect(sentCustomEmails()).toEqual([
      {
        body: `Email|desc=${DESCRIPTION_HTML}`,
        subject: `[Scheduled Maintenance ${STATE_NAME}] ${EVENT_TITLE}`,
      },
    ]);
    expect(compiledChannels()).toEqual([
      "Email",
      "Microsoft Teams",
      "SMS",
      "Slack",
    ]);
  });

  test("uses custom email and SMS templates only with the page's own SMTP and Twilio", async () => {
    useCustomTemplates({ body: "desc={{scheduledMaintenanceDescription}}" });
    // Custom email and SMS templates need the page's own SMTP and Twilio.
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([statusPage()] as never);

    await runJob();

    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberScheduledMaintenanceEventStateChanged,
    );
    expect(sentSms()).toEqual([
      dashboardDefault(StatusPageSubscriberNotificationMethod.SMS),
    ]);
    expect(sentSlack()).toEqual([`Slack|desc=${DESCRIPTION}`]);
    expect(sentTeams()).toEqual([`Microsoft Teams|desc=${DESCRIPTION}`]);
    expect(
      compileTemplateCalls().map((call: CompileTemplateCall): string => {
        return call.template;
      }),
    ).toEqual([
      "Slack|desc={{scheduledMaintenanceDescription}}",
      "Microsoft Teams|desc={{scheduledMaintenanceDescription}}",
    ]);
  });
});
