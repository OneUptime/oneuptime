import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";

/*
 * Scheduled maintenance state change subscriber notifications. These tests
 * drive a tick of the job against fakes and check what each channel
 * receives, with and without the status page's custom templates.
 *
 * The resource list is formatted by the real StatusPageResourceUtil, so the
 * grouped-resource tests see the same "<br/>" and "; " separators that
 * production does.
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
      // The real substitution, recorded so tests can read the variables.
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
const STATE_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const MONITOR_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

const STATUS_PAGE_URL: string = "https://status.acme.com";
const DETAILS_URL: string = `${STATUS_PAGE_URL}/scheduled-events/${EVENT_ID.toString()}`;
const UNSUBSCRIBE_URL: string = `${STATUS_PAGE_URL}/update-subscription/${SUBSCRIBER_ID.toString()}`;
const DASHBOARD_URL: string =
  "https://oneuptime.acme.com/dashboard/scheduled-maintenance/1";

const EVENT_TITLE: string = "Database engine upgrade";
const STARTS_AT: Date = new Date("2026-09-20T02:00:00.000Z");
// Capitalised like the built-in states, so the subject's uppercasing is a no-op.
const STATE_NAME: string = "Ongoing";

const GROUPED_RESOURCES_HTML: string =
  "Europe: Primary database<br/>Americas: Replica database";
const GROUPED_RESOURCES_TEXT: string =
  "Europe: Primary database; Americas: Replica database";

/*
 * One custom template per channel. Each echoes the state and the resource
 * list, so the message shows which format that channel was given.
 */
const CUSTOM_EMAIL_BODY: string =
  "<div>{{scheduledMaintenanceState}}</div><div>{{resourcesAffected}}</div>";
const CUSTOM_EMAIL_SUBJECT: string =
  "{{scheduledMaintenanceTitle}} is {{scheduledMaintenanceState}} ({{resourcesAffected}})";
const CUSTOM_SMS_BODY: string =
  "SMS {{scheduledMaintenanceState}} ({{resourcesAffected}})";
const CUSTOM_SLACK_BODY: string =
  "Slack {{scheduledMaintenanceState}} ({{resourcesAffected}})";
const CUSTOM_TEAMS_BODY: string =
  "Teams {{scheduledMaintenanceState}} ({{resourcesAffected}})";

let pendingTimelines: Array<ScheduledMaintenanceStateTimeline> = [];
let storedEvent: ScheduledMaintenance | null = null;

function stateTimeline(): ScheduledMaintenanceStateTimeline {
  const row: ScheduledMaintenanceStateTimeline =
    new ScheduledMaintenanceStateTimeline();
  row._id = TIMELINE_ID.toString();
  row.projectId = PROJECT_ID;
  row.scheduledMaintenanceId = EVENT_ID;
  row.scheduledMaintenanceStateId = STATE_ID;

  const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  state._id = STATE_ID.toString();
  state.name = STATE_NAME;
  state.isScheduledState = false;
  row.scheduledMaintenanceState = state;

  return row;
}

function scheduledEvent(): ScheduledMaintenance {
  const event: ScheduledMaintenance = new ScheduledMaintenance();
  event._id = EVENT_ID.toString();
  event.title = EVENT_TITLE;
  event.description = "The database engine will be upgraded.";
  event.projectId = PROJECT_ID;
  event.startsAt = STARTS_AT;
  event.isVisibleOnStatusPage = true;
  event.scheduledMaintenanceNumber = 12;

  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  event.monitors = [monitor];

  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID.toString();
  event.statusPages = [page];

  return event;
}

function statusPage(): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID.toString();
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  page.pageTitle = "Acme Status";
  page.isPublicStatusPage = true;
  page.showScheduledMaintenanceEventsOnStatusPage = true;
  return page;
}

function resource(): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = "88888888-8888-4888-8888-888888888888";
  row.statusPageId = STATUS_PAGE_ID;
  row.displayName = "Primary database";
  return row;
}

function resourceInGroup(
  id: string,
  displayName: string,
  groupName: string,
): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = id;
  row.statusPageId = STATUS_PAGE_ID;
  row.displayName = displayName;
  row.statusPageGroupId = ObjectID.generate();
  const group: StatusPageGroup = new StatusPageGroup();
  group.name = groupName;
  row.statusPageGroup = group;
  return row;
}

function groupedResources(): Array<StatusPageResource> {
  return [
    resourceInGroup(
      "88888888-8888-4888-8888-888888888888",
      "Primary database",
      "Europe",
    ),
    resourceInGroup(
      "99999999-9999-4999-8999-999999999999",
      "Replica database",
      "Americas",
    ),
  ];
}

// A page with its own SMTP and Twilio, and a custom template on every channel.
function useCustomTemplatesOnEveryChannel(): void {
  const page: StatusPage = statusPage();
  (page as unknown as JSONObject)["smtpConfig"] = { _id: "smtp" };
  (page as unknown as JSONObject)["callSmsConfig"] = { _id: "twilio" };
  mock(
    StatusPageSubscriberService.getStatusPagesToSendNotification,
  ).mockResolvedValue([page] as never);

  const bodies: Record<string, string> = {
    [StatusPageSubscriberNotificationMethod.Email]: CUSTOM_EMAIL_BODY,
    [StatusPageSubscriberNotificationMethod.SMS]: CUSTOM_SMS_BODY,
    [StatusPageSubscriberNotificationMethod.Slack]: CUSTOM_SLACK_BODY,
    [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: CUSTOM_TEAMS_BODY,
  };

  mock(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
  ).mockImplementation(async (args: unknown) => {
    const method: string = (args as JSONObject)["notificationMethod"] as string;
    return {
      templateBody: bodies[method],
      emailSubject:
        method === StatusPageSubscriberNotificationMethod.Email
          ? CUSTOM_EMAIL_SUBJECT
          : undefined,
    };
  });
}

// The variables the job handed to compileTemplate for this template.
function variablesCompiledInto(template: string): Record<string, string> {
  const calls: Array<Array<unknown>> = mock(
    StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate,
  ).mock.calls.filter((call: Array<unknown>): boolean => {
    return call[0] === template;
  });

  expect(calls).toHaveLength(1);
  return calls[0]![1] as Record<string, string>;
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

function dashboardDefault(
  eventType: StatusPageSubscriberNotificationEventType,
  method: StatusPageSubscriberNotificationMethod,
): string {
  const template: string =
    getDefaultSubscriberNotificationTemplate(eventType, method)?.body || "";
  const variables: Record<string, string> = {
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    detailsUrl: DETAILS_URL,
    unsubscribeUrl: UNSUBSCRIBE_URL,
    scheduledMaintenanceTitle: EVENT_TITLE,
    scheduledMaintenanceState: STATE_NAME,
    resourcesAffected: "Primary database",
  };

  return template.replace(/{{\s*(\w+)\s*}}/g, (_match: string, key: string) => {
    return variables[key] ?? "";
  });
}

// The job formats startsAt in the local timezone, so the tests do too.
function scheduledAt(): string {
  return OneUptimeDate.getDateAsUserFriendlyFormattedString(STARTS_AT);
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
    resource(),
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
  mock(StatusPageSubscriberService.getUnsubscribeLink).mockReturnValue(
    URL.fromString(UNSUBSCRIBE_URL),
  );
  mock(StatusPageService.getStatusPageURL).mockResolvedValue(
    STATUS_PAGE_URL as never,
  );
  mock(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
  ).mockResolvedValue(null as never);

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
  test("sends the default state-change messages when the page has no custom templates", async () => {
    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberScheduledMaintenanceEventStateChanged,
    );
    expect(sentMail()[0]!["subject"]).toBe(
      `[${STATE_NAME} Scheduled Maintenance] ${EVENT_TITLE}`,
    );
    expect(sentMail()[0]!["vars"]).toEqual(
      expect.objectContaining({
        eventTitle: EVENT_TITLE,
        eventState: STATE_NAME,
        scheduledAt: scheduledAt(),
        resourcesAffected: "Primary database",
        detailsUrl: DETAILS_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
      }),
    );

    expect(sentSms()).toEqual([
      `Maintenance ${EVENT_TITLE} on Acme Status is ${STATE_NAME}. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
    ]);
    expect(sentSlack()).toHaveLength(1);
    expect(sentSlack()[0]).toContain(
      "## Scheduled Maintenance State Update - Acme Status",
    );
    expect(sentTeams()).toHaveLength(1);
    expect(sentTeams()[0]).toContain(
      "## Scheduled Maintenance State Update - Acme Status",
    );
  });

  test("matches the dashboard's SMS, Slack and Teams defaults", async () => {
    await runJob();

    const event: StatusPageSubscriberNotificationEventType =
      StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceStateChanged;

    expect(sentSms()[0]).toBe(
      dashboardDefault(event, StatusPageSubscriberNotificationMethod.SMS),
    );
    expect(sentSlack()[0]).toBe(
      dashboardDefault(event, StatusPageSubscriberNotificationMethod.Slack),
    );
    expect(sentTeams()[0]).toBe(
      dashboardDefault(
        event,
        StatusPageSubscriberNotificationMethod.MicrosoftTeams,
      ),
    );
  });
});

describe("ScheduledMaintenanceStateTimeline job, with custom templates and grouped resources", () => {
  beforeEach(() => {
    useCustomTemplatesOnEveryChannel();
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
      groupedResources() as never,
    );
  });

  test("renders HTML in the email body, and plain text in SMS, the subject and chat", async () => {
    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.BlankTemplate,
    );
    expect(sentMail()[0]!["vars"]).toEqual({
      body: `<div>${STATE_NAME}</div><div>${GROUPED_RESOURCES_HTML}</div>`,
    });
    expect(sentMail()[0]!["subject"]).toBe(
      `${EVENT_TITLE} is ${STATE_NAME} (${GROUPED_RESOURCES_TEXT})`,
    );
    expect(sentSms()).toEqual([
      `SMS ${STATE_NAME} (${GROUPED_RESOURCES_TEXT})`,
    ]);
    expect(sentSlack()).toEqual([
      `Slack ${STATE_NAME} (${GROUPED_RESOURCES_TEXT})`,
    ]);
    expect(sentTeams()).toEqual([
      `Teams ${STATE_NAME} (${GROUPED_RESOURCES_TEXT})`,
    ]);
  });

  test("hands each channel's template the same variables, in that channel's format", async () => {
    await runJob();

    const shared: Record<string, string> = {
      statusPageName: "Acme Status",
      statusPageUrl: STATUS_PAGE_URL,
      detailsUrl: DETAILS_URL,
      scheduledMaintenanceTitle: EVENT_TITLE,
      scheduledMaintenanceState: STATE_NAME,
      scheduledAt: scheduledAt(),
      unsubscribeUrl: UNSUBSCRIBE_URL,
    };
    const html: Record<string, string> = {
      ...shared,
      resourcesAffected: GROUPED_RESOURCES_HTML,
    };
    const plainText: Record<string, string> = {
      ...shared,
      resourcesAffected: GROUPED_RESOURCES_TEXT,
    };

    expect(variablesCompiledInto(CUSTOM_EMAIL_BODY)).toEqual(html);
    expect(variablesCompiledInto(CUSTOM_EMAIL_SUBJECT)).toEqual(plainText);
    expect(variablesCompiledInto(CUSTOM_SMS_BODY)).toEqual(plainText);
    expect(variablesCompiledInto(CUSTOM_SLACK_BODY)).toEqual(plainText);
    expect(variablesCompiledInto(CUSTOM_TEAMS_BODY)).toEqual(plainText);
  });

  test("sends webhooks a plain-text resource list", async () => {
    await runJob();

    expect(sentWebhooks()).toHaveLength(1);
    expect(sentWebhooks()[0]!["eventType"]).toBe(
      "ScheduledMaintenanceStateChanged",
    );
    expect(sentWebhooks()[0]!["data"]).toEqual({
      scheduledMaintenanceId: EVENT_ID.toString(),
      scheduledMaintenanceTitle: EVENT_TITLE,
      scheduledMaintenanceState: STATE_NAME,
      resourcesAffected: GROUPED_RESOURCES_TEXT,
      detailsUrl: DETAILS_URL,
    });
  });
});

describe("ScheduledMaintenanceStateTimeline default email, with grouped resources", () => {
  test("still gets HTML for the resource list", async () => {
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
      groupedResources() as never,
    );

    await runJob();

    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberScheduledMaintenanceEventStateChanged,
    );
    expect(sentMail()[0]!["vars"]).toEqual(
      expect.objectContaining({
        resourcesAffected: GROUPED_RESOURCES_HTML,
      }),
    );
  });
});
