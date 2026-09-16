import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import { ScheduledMaintenanceFeedEventType } from "Common/Models/DatabaseModels/ScheduledMaintenanceFeed";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import URL from "Common/Types/API/URL";
import { Blue500, Yellow500 } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberNotificationTemplateChannels from "Common/Types/StatusPage/SubscriberNotificationTemplateChannels";
import SubscriberNotificationTemplateVariables from "Common/Types/StatusPage/SubscriberNotificationTemplateVariables";

/*
 * Scheduled maintenance state change subscriber notifications. Each test
 * drives one tick of the job against fakes and checks what subscribers
 * receive on every channel, which status the state timeline row ends up in,
 * and what lands in the scheduled maintenance feed.
 *
 * Custom Webhook templates go through the real
 * StatusPageSubscriberWebhookTemplate, so what is asserted here is the body a
 * webhook subscriber would actually be sent.
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
    EXTERNAL_FAULT: { faultMarker: "external" },
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

jest.mock("Common/Server/Utils/StatusPageResource", () => {
  return {
    __esModule: true,
    default: {
      getResourcesGroupedByGroupName: jest.fn(() => {
        return "Checkout API";
      }),
    },
  };
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
      Service: {
        compileTemplate: (
          template: string,
          variables: Record<string, string>,
        ): string => {
          let compiled: string = template;
          for (const [key, value] of Object.entries(variables)) {
            compiled = compiled.replace(
              new RegExp(`{{\\s*${key}\\s*}}`, "g"),
              value || "",
            );
          }
          return compiled;
        },
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
    default: {
      toTwilioConfig: jest.fn((config: unknown) => {
        return config ? { twilio: "custom" } : undefined;
      }),
    },
  };
});

jest.mock("Common/Server/Services/ProjectSmtpConfigService", () => {
  return {
    __esModule: true,
    default: {
      toEmailServer: jest.fn((config: unknown) => {
        return config ? { smtp: "custom" } : undefined;
      }),
    },
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
import StatusPageSubscriberNotificationTemplateService from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import StatusPageResourceUtil from "Common/Server/Utils/StatusPageResource";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
import StatusPageSubscriberWebhookTemplate from "Common/Server/Utils/StatusPageSubscriberWebhookTemplate";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import { getDefaultSubscriberNotificationTemplate } from "../../../../FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateDefaults";
import "../../../../FeatureSet/Workers/Jobs/ScheduledMaintenanceStateTimeline/SendNotificationToSubscribers";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const JOB: string =
  "ScheduledMaintenanceStateTimeline:SendNotificationToSubscribers";

const EVENT: StatusPageSubscriberNotificationEventType =
  StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceStateChanged;

const WEBHOOK_EVENT_TYPE: string = "ScheduledMaintenanceStateChanged";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SECOND_STATUS_PAGE_ID: ObjectID = new ObjectID(
  "23232323-2323-4323-8323-232323232323",
);
const SCHEDULED_MAINTENANCE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const SECOND_TIMELINE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const STATE_ID: ObjectID = new ObjectID("12121212-1212-4212-8212-121212121212");
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const SECOND_SUBSCRIBER_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const LOGO_FILE_ID: ObjectID = new ObjectID(
  "abababab-abab-4bab-8bab-abababababab",
);

const STATUS_PAGE_URL: string = "https://status.acme.com";
const SECOND_STATUS_PAGE_URL: string = "https://status.other.com";
const DETAILS_URL: string = `${STATUS_PAGE_URL}/scheduled-events/${SCHEDULED_MAINTENANCE_ID.toString()}`;
const UNSUBSCRIBE_URL: string = `${STATUS_PAGE_URL}/update-subscription/${SUBSCRIBER_ID.toString()}`;
const DASHBOARD_URL: string =
  "https://oneuptime.acme.com/dashboard/scheduled-maintenance/12";
const WEBHOOK_URL: string = "https://hooks.acme.com/status";
const SLACK_URL: string = "https://hooks.slack.com/services/T000/B000/XXXX";
const TEAMS_URL: string = "https://outlook.office.com/webhook/abc";

const EVENT_TITLE: string = "Database upgrade";
// Descriptions are markdown and may span lines.
const EVENT_DESCRIPTION: string =
  "We are upgrading the **primary** database.\nExpect short interruptions.";
const STATE_NAME: string = "Ongoing";
const STARTS_AT: Date = new Date("2026-05-06T07:08:09.000Z");
const SCHEDULED_AT_TEXT: string =
  OneUptimeDate.getDateAsUserFriendlyFormattedString(STARTS_AT);

const SUCCESS_WRITE: JSONObject = {
  subscriberNotificationStatus: StatusPageSubscriberNotificationStatus.Success,
  subscriberNotificationStatusMessage:
    "Notifications sent successfully to all subscribers",
};

const IN_PROGRESS_WRITE: JSONObject = {
  subscriberNotificationStatus:
    StatusPageSubscriberNotificationStatus.InProgress,
};

const ALL_METHODS: Array<StatusPageSubscriberNotificationMethod> = [
  StatusPageSubscriberNotificationMethod.Email,
  StatusPageSubscriberNotificationMethod.SMS,
  StatusPageSubscriberNotificationMethod.Slack,
  StatusPageSubscriberNotificationMethod.MicrosoftTeams,
  StatusPageSubscriberNotificationMethod.Webhook,
];

let pendingTimelines: Array<ScheduledMaintenanceStateTimeline> = [];
let storedEvent: ScheduledMaintenance | null = null;

interface TimelineOverrides {
  id?: ObjectID;
  withoutScheduledMaintenanceId?: boolean;
  withoutStateId?: boolean;
  withoutState?: boolean;
  stateName?: string;
  isScheduledState?: boolean;
}

interface ScheduledMaintenanceOverrides {
  isVisibleOnStatusPage?: boolean;
  withoutMonitors?: boolean;
  withoutDescription?: boolean;
  withoutNumberPrefix?: boolean;
  withoutNumber?: boolean;
  title?: string;
  description?: string;
}

function stateTimeline(
  overrides?: TimelineOverrides,
): ScheduledMaintenanceStateTimeline {
  const row: ScheduledMaintenanceStateTimeline =
    new ScheduledMaintenanceStateTimeline();
  row._id = (overrides?.id || TIMELINE_ID).toString();

  if (!overrides?.withoutScheduledMaintenanceId) {
    row.scheduledMaintenanceId = SCHEDULED_MAINTENANCE_ID;
  }

  if (!overrides?.withoutStateId) {
    row.scheduledMaintenanceStateId = STATE_ID;
  }

  if (!overrides?.withoutState) {
    const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
    state.name = overrides?.stateName ?? STATE_NAME;
    state.isScheduledState = overrides?.isScheduledState === true;
    row.scheduledMaintenanceState = state;
  }

  return row;
}

function scheduledMaintenance(
  overrides?: ScheduledMaintenanceOverrides,
): ScheduledMaintenance {
  const row: ScheduledMaintenance = new ScheduledMaintenance();
  row._id = SCHEDULED_MAINTENANCE_ID.toString();
  row.title = overrides?.title ?? EVENT_TITLE;
  if (!overrides?.withoutDescription) {
    row.description = overrides?.description ?? EVENT_DESCRIPTION;
  }
  row.startsAt = STARTS_AT;
  row.projectId = PROJECT_ID;
  row.isVisibleOnStatusPage = overrides?.isVisibleOnStatusPage !== false;
  if (!overrides?.withoutNumber) {
    row.scheduledMaintenanceNumber = 12;
  }
  if (!overrides?.withoutNumberPrefix) {
    row.scheduledMaintenanceNumberWithPrefix = "SM-12";
  }

  if (overrides?.withoutMonitors) {
    row.monitors = [];
  } else {
    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID.toString();
    row.monitors = [monitor];
  }

  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID.toString();
  row.statusPages = [page];

  return row;
}

function statusPage(overrides?: {
  id?: ObjectID;
  withoutId?: boolean;
  showScheduledMaintenanceEventsOnStatusPage?: boolean;
  withSmtpConfig?: boolean;
  withCallSmsConfig?: boolean;
  withLogo?: boolean;
  isPublicStatusPage?: boolean;
  pageTitle?: string;
}): StatusPage {
  const page: StatusPage = new StatusPage();
  if (!overrides?.withoutId) {
    page._id = (overrides?.id || STATUS_PAGE_ID).toString();
  }
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  page.pageTitle = overrides?.pageTitle ?? "Acme Status";
  page.isPublicStatusPage = overrides?.isPublicStatusPage !== false;
  page.showScheduledMaintenanceEventsOnStatusPage =
    overrides?.showScheduledMaintenanceEventsOnStatusPage !== false;
  if (overrides?.withSmtpConfig) {
    (page as unknown as JSONObject)["smtpConfig"] = { _id: "smtp" };
  }
  if (overrides?.withCallSmsConfig) {
    (page as unknown as JSONObject)["callSmsConfig"] = { _id: "sms" };
  }
  if (overrides?.withLogo) {
    page.logoFileId = LOGO_FILE_ID;
  }
  return page;
}

function resource(statusPageId?: ObjectID): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = statusPageId
    ? "89898989-8989-4989-8989-898989898989"
    : "88888888-8888-4888-8888-888888888888";
  row.statusPageId = statusPageId || STATUS_PAGE_ID;
  row.displayName = "Checkout API";
  return row;
}

function subscriber(
  id?: ObjectID,
  channels?: {
    email?: boolean;
    phone?: boolean;
    slack?: boolean;
    teams?: boolean;
    webhook?: boolean;
  },
): StatusPageSubscriber {
  const all: boolean = !channels;
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row._id = (id || SUBSCRIBER_ID).toString();
  if (all || channels?.email) {
    row.subscriberEmail = new Email("customer@example.com");
  }
  if (all || channels?.phone) {
    row.subscriberPhone = new Phone("+15555550100");
  }
  if (all || channels?.slack) {
    row.slackIncomingWebhookUrl = URL.fromString(SLACK_URL);
  }
  if (all || channels?.teams) {
    row.microsoftTeamsIncomingWebhookUrl = URL.fromString(TEAMS_URL);
  }
  if (all || channels?.webhook) {
    row.subscriberWebhook = URL.fromString(WEBHOOK_URL);
  }
  return row;
}

function unsubscribeUrlFor(id: ObjectID, statusPageUrl?: string): string {
  return `${statusPageUrl || STATUS_PAGE_URL}/update-subscription/${id.toString()}`;
}

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
}

function statusWriteCalls(): Array<JSONObject> {
  return mock(
    ScheduledMaintenanceStateTimelineService.updateOneById,
  ).mock.calls.map((call: Array<unknown>): JSONObject => {
    return call[0] as JSONObject;
  });
}

function statusWrites(): Array<JSONObject> {
  return statusWriteCalls().map((call: JSONObject): JSONObject => {
    return call["data"] as JSONObject;
  });
}

function writesFor(id: ObjectID): Array<JSONObject> {
  return statusWriteCalls()
    .filter((call: JSONObject): boolean => {
      return (call["id"] as ObjectID).toString() === id.toString();
    })
    .map((call: JSONObject): JSONObject => {
      return call["data"] as JSONObject;
    });
}

function lastStatusWrite(): JSONObject {
  const writes: Array<JSONObject> = statusWrites();
  return writes[writes.length - 1]!;
}

function sentMail(): Array<JSONObject> {
  return mock(MailService.sendMail).mock.calls.map(
    (call: Array<unknown>): JSONObject => {
      return call[0] as JSONObject;
    },
  );
}

function sentMailOptions(): Array<JSONObject> {
  return mock(MailService.sendMail).mock.calls.map(
    (call: Array<unknown>): JSONObject => {
      return call[1] as JSONObject;
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

function webhookUrls(): Array<string> {
  return mock(
    StatusPageSubscriberWebhookUtil.sendWebhookNotification,
  ).mock.calls.map((call: Array<unknown>): string => {
    return (call[0] as { webhookUrl: URL }).webhookUrl.toString();
  });
}

function templateLookups(): Array<JSONObject> {
  return mock(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
  ).mock.calls.map((call: Array<unknown>): JSONObject => {
    return call[0] as JSONObject;
  });
}

function warnings(): Array<string> {
  return mock(logger.warn).mock.calls.map((call: Array<unknown>): string => {
    return String(call[0]);
  });
}

function feedItems(): Array<JSONObject> {
  return mock(
    ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem,
  ).mock.calls.map((call: Array<unknown>): JSONObject => {
    return call[0] as JSONObject;
  });
}

// Lets the fire-and-forget sends settle, including their .catch handlers.
async function flushPromises(): Promise<void> {
  await new Promise((resolve: (value: unknown) => void) => {
    setImmediate(resolve);
  });
}

/*
 * Serves a custom template per channel; channels left out have none. Every
 * lookup still happens, so tests can also check what was asked for.
 */
function useCustomTemplates(
  templates: Partial<
    Record<
      StatusPageSubscriberNotificationMethod,
      { templateBody: string; emailSubject?: string }
    >
  >,
): void {
  mock(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
  ).mockImplementation(async (args: unknown) => {
    const method: StatusPageSubscriberNotificationMethod = (
      args as { notificationMethod: StatusPageSubscriberNotificationMethod }
    ).notificationMethod;

    return templates[method] || null;
  });
}

function useStatusPage(page: StatusPage): void {
  mock(
    StatusPageSubscriberService.getStatusPagesToSendNotification,
  ).mockResolvedValue([page] as never);
}

function useTwoSubscribers(): void {
  mock(
    StatusPageSubscriberService.getSubscribersByStatusPage,
  ).mockResolvedValue([
    subscriber(SUBSCRIBER_ID),
    subscriber(SECOND_SUBSCRIBER_ID),
  ] as never);
  mock(StatusPageSubscriberService.getUnsubscribeLink).mockImplementation(
    (url: unknown, id: unknown): URL => {
      return URL.fromString(
        unsubscribeUrlFor(id as ObjectID, (url as URL).toString()),
      );
    },
  );
}

/*
 * The per-subscriber values the job fills in for every custom template
 * (Email, SMS, Slack, Teams and Webhook all get the same set).
 */
function expectedVariables(overrides?: {
  unsubscribeUrl?: string;
  scheduledMaintenanceDescription?: string;
}): Record<string, string> {
  return {
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    statusPageId: STATUS_PAGE_ID.toString(),
    unsubscribeUrl: overrides?.unsubscribeUrl ?? UNSUBSCRIBE_URL,
    resourcesAffected: "Checkout API",
    scheduledMaintenanceId: SCHEDULED_MAINTENANCE_ID.toString(),
    scheduledMaintenanceTitle: EVENT_TITLE,
    scheduledMaintenanceDescription:
      overrides?.scheduledMaintenanceDescription ?? EVENT_DESCRIPTION,
    scheduledMaintenanceState: STATE_NAME,
    detailsUrl: DETAILS_URL,
    scheduledAt: SCHEDULED_AT_TEXT,
  };
}

// The payload webhook subscribers have always received for a state change.
function defaultWebhookPayload(overrides?: {
  unsubscribeUrl?: string;
  scheduledMaintenanceTitle?: string;
}): JSONObject {
  return {
    eventType: WEBHOOK_EVENT_TYPE,
    statusPageId: STATUS_PAGE_ID.toString(),
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    unsubscribeUrl: overrides?.unsubscribeUrl ?? UNSUBSCRIBE_URL,
    data: {
      scheduledMaintenanceId: SCHEDULED_MAINTENANCE_ID.toString(),
      scheduledMaintenanceTitle:
        overrides?.scheduledMaintenanceTitle ?? EVENT_TITLE,
      scheduledMaintenanceState: STATE_NAME,
      resourcesAffected: "Checkout API",
      detailsUrl: DETAILS_URL,
    },
  };
}

// A text template naming every variable of the event as "name=[{{name}}]".
function everyVariableTextTemplate(): string {
  return SubscriberNotificationTemplateVariables.getVariableNames(EVENT)
    .map((name: string): string => {
      return `${name}=[{{${name}}}]`;
    })
    .join("\n");
}

// A Webhook template with one string property per variable of the event.
function everyVariableWebhookTemplate(): string {
  const body: JSONObject = {};

  for (const name of SubscriberNotificationTemplateVariables.getVariableNames(
    EVENT,
  )) {
    body[name] = `{{${name}}}`;
  }

  return JSON.stringify(body, null, 2);
}

function expectEveryVariableFilled(
  text: string,
  expected: Record<string, string>,
): void {
  expect(text).not.toContain("{{");

  for (const name of SubscriberNotificationTemplateVariables.getVariableNames(
    EVENT,
  )) {
    expect(expected[name]).toBeDefined();
    expect(text).toContain(`${name}=[${expected[name]}]`);
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

function dashboardDefault(
  method: StatusPageSubscriberNotificationMethod,
): string {
  const template: string =
    getDefaultSubscriberNotificationTemplate(EVENT, method)?.body || "";
  const variables: Record<string, string> = expectedVariables();

  return template.replace(/{{\s*(\w+)\s*}}/g, (_match: string, key: string) => {
    return variables[key] ?? "";
  });
}

function expectDefaultTextChannels(): void {
  expect(sentSms()).toEqual([
    dashboardDefault(StatusPageSubscriberNotificationMethod.SMS),
  ]);
  expect(sentSlack()).toEqual([
    dashboardDefault(StatusPageSubscriberNotificationMethod.Slack),
  ]);
  expect(sentTeams()).toEqual([
    dashboardDefault(StatusPageSubscriberNotificationMethod.MicrosoftTeams),
  ]);
  expect(sentMail()).toHaveLength(1);
  expect(sentMail()[0]!["templateType"]).toBe(
    EmailTemplateType.SubscriberScheduledMaintenanceEventStateChanged,
  );
}

async function runJob(): Promise<void> {
  expect(mockCapturedJobs[JOB]).toBeDefined();
  await mockCapturedJobs[JOB]!();
}

beforeEach(() => {
  jest.clearAllMocks();

  pendingTimelines = [stateTimeline()];
  storedEvent = scheduledMaintenance();

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
  describe("picking up work", () => {
    test("is registered as a cron job", () => {
      expect(mockCapturedJobs[JOB]).toBeDefined();
    });

    test("looks only for pending timeline rows whose author asked to notify", async () => {
      await runJob();

      const args: { query: JSONObject; select: JSONObject; props: JSONObject } =
        mock(ScheduledMaintenanceStateTimelineService.findAllBy).mock
          .calls[0]![0] as {
          query: JSONObject;
          select: JSONObject;
          props: JSONObject;
        };

      expect(args.query).toEqual({
        subscriberNotificationStatus:
          StatusPageSubscriberNotificationStatus.Pending,
        shouldStatusPageSubscribersBeNotified: true,
      });
      expect(args.props).toEqual({ isRoot: true });
      expect(args.select["scheduledMaintenanceId"]).toBe(true);
      expect(args.select["scheduledMaintenanceStateId"]).toBe(true);
      expect(args.select["scheduledMaintenanceState"]).toEqual({
        name: true,
        isScheduledState: true,
      });
    });

    test("does nothing when no timeline row is pending", async () => {
      pendingTimelines = [];

      await runJob();

      nothingSent();
      expect(statusWrites()).toEqual([]);
      expect(ScheduledMaintenanceService.findOneById).not.toHaveBeenCalled();
      expect(feedItems()).toEqual([]);
    });

    test("selects the scheduled maintenance fields the messages need, description included", async () => {
      await runJob();

      const args: { id: ObjectID; select: JSONObject } = mock(
        ScheduledMaintenanceService.findOneById,
      ).mock.calls[0]![0] as { id: ObjectID; select: JSONObject };

      expect(args.id.toString()).toBe(SCHEDULED_MAINTENANCE_ID.toString());
      expect(args.select).toEqual(
        expect.objectContaining({
          _id: true,
          title: true,
          description: true,
          startsAt: true,
          projectId: true,
          monitors: { _id: true },
          statusPages: { _id: true },
          isVisibleOnStatusPage: true,
          scheduledMaintenanceNumber: true,
          scheduledMaintenanceNumberWithPrefix: true,
        }),
      );
    });
  });

  describe("status bookkeeping and skip paths", () => {
    test("records progress and then success, without hooks", async () => {
      await runJob();

      expect(statusWrites()).toEqual([IN_PROGRESS_WRITE, SUCCESS_WRITE]);

      for (const call of statusWriteCalls()) {
        expect((call["id"] as ObjectID).toString()).toBe(
          TIMELINE_ID.toString(),
        );
        expect(call["props"]).toEqual({ isRoot: true, ignoreHooks: true });
      }
    });

    test.each<[string, TimelineOverrides]>([
      [
        "the scheduled maintenance reference",
        { withoutScheduledMaintenanceId: true },
      ],
      ["the state reference", { withoutStateId: true }],
    ])(
      "skips a row missing %s",
      async (_label: string, overrides: TimelineOverrides) => {
        pendingTimelines = [stateTimeline(overrides)];

        await runJob();

        nothingSent();
        expect(ScheduledMaintenanceService.findOneById).not.toHaveBeenCalled();
        expect(feedItems()).toEqual([]);
        expect(statusWrites()).toEqual([
          IN_PROGRESS_WRITE,
          {
            subscriberNotificationStatus:
              StatusPageSubscriberNotificationStatus.Skipped,
            subscriberNotificationStatusMessage:
              "Missing scheduled maintenance or state reference. Skipping notifications.",
          },
        ]);
      },
    );

    test.each<[string, TimelineOverrides]>([
      ["has no state loaded", { withoutState: true }],
      ["has a state with an empty name", { stateName: "" }],
    ])(
      "skips a row that %s",
      async (_label: string, overrides: TimelineOverrides) => {
        pendingTimelines = [stateTimeline(overrides)];

        await runJob();

        nothingSent();
        expect(ScheduledMaintenanceService.findOneById).not.toHaveBeenCalled();
        expect(statusWrites()).toEqual([
          IN_PROGRESS_WRITE,
          {
            subscriberNotificationStatus:
              StatusPageSubscriberNotificationStatus.Skipped,
            subscriberNotificationStatusMessage:
              "Scheduled maintenance state has no name. Skipping notifications.",
          },
        ]);
      },
    );

    test("skips the scheduled state, which was announced when the event was created", async () => {
      pendingTimelines = [stateTimeline({ isScheduledState: true })];

      await runJob();

      nothingSent();
      expect(ScheduledMaintenanceService.findOneById).not.toHaveBeenCalled();
      expect(statusWrites()).toEqual([
        IN_PROGRESS_WRITE,
        {
          subscriberNotificationStatus:
            StatusPageSubscriberNotificationStatus.Skipped,
          subscriberNotificationStatusMessage:
            "Notification already sent when the scheduled maintenance was created. So, maintenance event state change notifiction is skipped.",
        },
      ]);
    });

    test("skips when the scheduled maintenance has been deleted", async () => {
      storedEvent = null;

      await runJob();

      nothingSent();
      expect(feedItems()).toEqual([]);
      expect(statusWrites()).toEqual([
        IN_PROGRESS_WRITE,
        {
          subscriberNotificationStatus:
            StatusPageSubscriberNotificationStatus.Skipped,
          subscriberNotificationStatusMessage:
            "Related scheduled maintenance not found. Skipping notifications.",
        },
      ]);
    });

    test("skips when the scheduled maintenance is not visible on status pages", async () => {
      storedEvent = scheduledMaintenance({ isVisibleOnStatusPage: false });

      await runJob();

      nothingSent();
      expect(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).not.toHaveBeenCalled();
      expect(feedItems()).toEqual([]);
      expect(statusWrites()).toEqual([
        IN_PROGRESS_WRITE,
        {
          subscriberNotificationStatus:
            StatusPageSubscriberNotificationStatus.Skipped,
          subscriberNotificationStatusMessage:
            "Scheduled maintenance is not visible on status page. Skipping notifications.",
        },
      ]);
    });

    test("marks the row Failed with the reason when something breaks", async () => {
      mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mockRejectedValue(new Error("status pages unavailable") as never);

      await runJob();

      nothingSent();
      expect(feedItems()).toEqual([]);
      expect(statusWrites()).toEqual([
        IN_PROGRESS_WRITE,
        {
          subscriberNotificationStatus:
            StatusPageSubscriberNotificationStatus.Failed,
          subscriberNotificationStatusMessage: "status pages unavailable",
        },
      ]);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(TIMELINE_ID.toString()),
      );
    });

    test("handles each row on its own in a multi-row tick", async () => {
      pendingTimelines = [
        stateTimeline({ isScheduledState: true }),
        stateTimeline({ id: SECOND_TIMELINE_ID }),
      ];

      await runJob();

      expect(
        writesFor(TIMELINE_ID).map((write: JSONObject) => {
          return write["subscriberNotificationStatus"];
        }),
      ).toEqual([
        StatusPageSubscriberNotificationStatus.InProgress,
        StatusPageSubscriberNotificationStatus.Skipped,
      ]);
      expect(writesFor(SECOND_TIMELINE_ID)).toEqual([
        IN_PROGRESS_WRITE,
        SUCCESS_WRITE,
      ]);
      expect(sentMail()).toHaveLength(1);
    });

    test("keeps going after one row fails", async () => {
      pendingTimelines = [
        stateTimeline(),
        stateTimeline({ id: SECOND_TIMELINE_ID }),
      ];
      mock(ScheduledMaintenanceService.findOneById).mockRejectedValueOnce(
        new Error("database hiccup") as never,
      );

      await expect(runJob()).resolves.toBeUndefined();

      expect(writesFor(TIMELINE_ID)).toEqual([
        IN_PROGRESS_WRITE,
        {
          subscriberNotificationStatus:
            StatusPageSubscriberNotificationStatus.Failed,
          subscriberNotificationStatusMessage: "database hiccup",
        },
      ]);
      expect(writesFor(SECOND_TIMELINE_ID)).toEqual([
        IN_PROGRESS_WRITE,
        SUCCESS_WRITE,
      ]);
      expect(sentMail()).toHaveLength(1);
      expect(sentWebhooks()).toHaveLength(1);
    });
  });

  describe("status pages, resources and subscribers", () => {
    test("asks for the status pages the scheduled maintenance is on", async () => {
      await runJob();

      const ids: Array<ObjectID> = mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mock.calls[0]![0] as Array<ObjectID>;

      expect(
        ids.map((id: ObjectID): string => {
          return id.toString();
        }),
      ).toEqual([STATUS_PAGE_ID.toString()]);
    });

    test("looks up the resources of the scheduled maintenance's monitors", async () => {
      await runJob();

      const args: { monitors: Array<Monitor>; select: JSONObject } = mock(
        StatusPageResourceService.findByMonitors,
      ).mock.calls[0]![0] as { monitors: Array<Monitor>; select: JSONObject };

      expect(args.monitors).toHaveLength(1);
      expect(args.monitors[0]!.id!.toString()).toBe(MONITOR_ID.toString());
      expect(args.select["statusPageId"]).toBe(true);
      expect(args.select["displayName"]).toBe(true);
    });

    test("passes only this status page's resources on", async () => {
      mock(StatusPageResourceService.findByMonitors).mockResolvedValue([
        resource(),
        resource(SECOND_STATUS_PAGE_ID),
      ] as never);

      await runJob();

      const grouped: Array<StatusPageResource> = mock(
        StatusPageResourceUtil.getResourcesGroupedByGroupName,
      ).mock.calls[0]![0] as Array<StatusPageResource>;

      expect(grouped).toHaveLength(1);
      expect(grouped[0]!.statusPageId!.toString()).toBe(
        STATUS_PAGE_ID.toString(),
      );
      expect(
        mock(StatusPageResourceUtil.getResourcesGroupedByGroupName).mock
          .calls[0]![1],
      ).toBe("");

      const shouldSendArgs: JSONObject = mock(
        StatusPageSubscriberService.shouldSendNotification,
      ).mock.calls[0]![0] as JSONObject;

      expect(shouldSendArgs["statusPageResources"]).toEqual(grouped);
      expect(shouldSendArgs["eventType"]).toBe(
        StatusPageEventType.ScheduledEvent,
      );
      expect(
        (shouldSendArgs["subscriber"] as StatusPageSubscriber).id!.toString(),
      ).toBe(SUBSCRIBER_ID.toString());
    });

    test("still notifies when the scheduled maintenance has no monitors", async () => {
      storedEvent = scheduledMaintenance({ withoutMonitors: true });
      mock(
        StatusPageResourceUtil.getResourcesGroupedByGroupName,
      ).mockReturnValueOnce("");

      await runJob();

      expect(StatusPageResourceService.findByMonitors).not.toHaveBeenCalled();
      expect(
        mock(StatusPageResourceUtil.getResourcesGroupedByGroupName).mock
          .calls[0]![0],
      ).toEqual([]);
      expect(sentWebhooks()).toHaveLength(1);
      expect(
        (sentWebhooks()[0]!["data"] as JSONObject)["resourcesAffected"],
      ).toBe("");
      expect(lastStatusWrite()).toEqual(SUCCESS_WRITE);
    });

    test("does not notify subscribers of a status page that hides scheduled maintenance", async () => {
      useStatusPage(
        statusPage({ showScheduledMaintenanceEventsOnStatusPage: false }),
      );

      await runJob();

      nothingSent();
      expect(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).not.toHaveBeenCalled();
      expect(templateLookups()).toEqual([]);
      expect(lastStatusWrite()).toEqual(SUCCESS_WRITE);
    });

    test("ignores a status page without an id", async () => {
      useStatusPage(statusPage({ withoutId: true }));

      await runJob();

      nothingSent();
      expect(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).not.toHaveBeenCalled();
      expect(lastStatusWrite()).toEqual(SUCCESS_WRITE);
    });

    test("does not notify subscribers whose preferences exclude this event", async () => {
      mock(StatusPageSubscriberService.shouldSendNotification).mockReturnValue(
        false,
      );

      await runJob();

      nothingSent();
      expect(lastStatusWrite()).toEqual(SUCCESS_WRITE);
    });

    test("ignores a subscriber without an id", async () => {
      const withoutId: StatusPageSubscriber = subscriber();
      delete withoutId._id;
      mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mockResolvedValue([withoutId] as never);

      await runJob();

      nothingSent();
      expect(
        StatusPageSubscriberService.shouldSendNotification,
      ).not.toHaveBeenCalled();
    });

    test("loads subscribers as root without hooks", async () => {
      await runJob();

      const args: Array<unknown> = mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mock.calls[0]!;

      expect((args[0] as ObjectID).toString()).toBe(STATUS_PAGE_ID.toString());
      expect(args[1]).toEqual({ isRoot: true, ignoreHooks: true });
    });

    test("sends only on the channels a subscriber signed up with", async () => {
      mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mockResolvedValue([
        subscriber(SUBSCRIBER_ID, { email: true }),
        subscriber(SECOND_SUBSCRIBER_ID, { webhook: true }),
      ] as never);

      await runJob();

      expect(sentMail()).toHaveLength(1);
      expect(sentWebhooks()).toHaveLength(1);
      expect(SmsService.sendSms).not.toHaveBeenCalled();
      expect(
        SlackUtil.sendMessageToChannelViaIncomingWebhook,
      ).not.toHaveBeenCalled();
      expect(
        MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
      ).not.toHaveBeenCalled();
    });
  });

  describe("scheduled maintenance feed", () => {
    test("records that subscribers were notified", async () => {
      await runJob();

      expect(feedItems()).toHaveLength(1);

      const item: JSONObject = feedItems()[0]!;

      expect((item["scheduledMaintenanceId"] as ObjectID).toString()).toBe(
        SCHEDULED_MAINTENANCE_ID.toString(),
      );
      expect((item["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(item["scheduledMaintenanceFeedEventType"]).toBe(
        ScheduledMaintenanceFeedEventType.SubscriberNotificationSent,
      );
      expect(item["displayColor"]).toBe(Blue500);
      expect(item["feedInfoInMarkdown"]).toBe(
        `📧 **Status Page Subscribers have been notified** about the state change of the [Scheduled Maintenance SM-12](${DASHBOARD_URL}) to **${STATE_NAME}**`,
      );
      expect(item["workspaceNotification"]).toEqual({
        sendWorkspaceNotification: true,
      });
    });

    test("records that no subscriber was notified", async () => {
      mock(StatusPageSubscriberService.shouldSendNotification).mockReturnValue(
        false,
      );

      await runJob();

      expect(feedItems()).toHaveLength(1);

      const item: JSONObject = feedItems()[0]!;

      expect(item["displayColor"]).toBe(Yellow500);
      expect(item["feedInfoInMarkdown"]).toBe(
        `📧 **No notification sent to subscribers** for the state change of [Scheduled Maintenance SM-12](${DASHBOARD_URL}) to **${STATE_NAME}**`,
      );
      expect(item["moreInformationInMarkdown"]).toBe(
        "Subscriber notifications were skipped because all associated status pages either hide scheduled maintenance events or had no matching subscribers.",
      );
      expect(item["workspaceNotification"]).toEqual({
        sendWorkspaceNotification: false,
      });
    });

    test.each<[string, ScheduledMaintenanceOverrides, string]>([
      ["the number without prefix", { withoutNumberPrefix: true }, "12"],
      [
        "a placeholder without any number",
        { withoutNumberPrefix: true, withoutNumber: true },
        " - ",
      ],
    ])(
      "falls back to %s",
      async (
        _label: string,
        overrides: ScheduledMaintenanceOverrides,
        expected: string,
      ) => {
        storedEvent = scheduledMaintenance(overrides);

        await runJob();

        expect(feedItems()[0]!["feedInfoInMarkdown"]).toContain(
          `[Scheduled Maintenance ${expected}](${DASHBOARD_URL})`,
        );
      },
    );

    test("links the feed item to the scheduled maintenance in the dashboard", async () => {
      await runJob();

      const args: Array<unknown> = mock(
        ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard,
      ).mock.calls[0]!;

      expect((args[0] as ObjectID).toString()).toBe(PROJECT_ID.toString());
      expect((args[1] as ObjectID).toString()).toBe(
        SCHEDULED_MAINTENANCE_ID.toString(),
      );
    });
  });

  describe("with no custom templates", () => {
    test("emails the default state change template with every value it always had", async () => {
      await runJob();

      expect(sentMail()).toHaveLength(1);
      expect(sentMail()[0]!["toEmail"]!.toString()).toBe(
        "customer@example.com",
      );
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
        resourcesAffected: "Checkout API",
        eventState: STATE_NAME,
        scheduledAt: SCHEDULED_AT_TEXT,
        eventTitle: EVENT_TITLE,
        unsubscribeUrl: UNSUBSCRIBE_URL,
        subscriberEmailNotificationFooterText: "Footer text",
      });
      expect(sentMailOptions()[0]).toEqual({
        mailServer: undefined,
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        scheduledMaintenanceId: SCHEDULED_MAINTENANCE_ID,
      });
    });

    test("capitalises the state in the default email subject", async () => {
      pendingTimelines = [stateTimeline({ stateName: "completed" })];

      await runJob();

      expect(sentMail()[0]!["subject"]).toBe(
        `[Completed Scheduled Maintenance] ${EVENT_TITLE}`,
      );
      expect((sentMail()[0]!["vars"] as JSONObject)["eventState"]).toBe(
        "completed",
      );
    });

    test("puts the status page logo and private flag in the default email", async () => {
      useStatusPage(statusPage({ withLogo: true, isPublicStatusPage: false }));

      await runJob();

      const vars: JSONObject = sentMail()[0]!["vars"] as JSONObject;

      expect(vars["logoUrl"]).toBe(
        `https://oneuptime.acme.com/status-page-api/logo/${STATUS_PAGE_ID.toString()}`,
      );
      expect(vars["isPublicStatusPage"]).toBe("false");
    });

    test("uses the status page name when it has no page title", async () => {
      useStatusPage(statusPage({ pageTitle: "" }));

      await runJob();

      expect((sentMail()[0]!["vars"] as JSONObject)["statusPageName"]).toBe(
        "Acme",
      );
      expect(sentWebhooks()[0]!["statusPageName"]).toBe("Acme");
    });

    test("sends the default SMS, identical to the dashboard's SMS starter", async () => {
      await runJob();

      expect(sentSms()).toEqual([
        `Maintenance ${EVENT_TITLE} on Acme Status is ${STATE_NAME}. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
      ]);
      expect(sentSms()[0]).toBe(
        dashboardDefault(StatusPageSubscriberNotificationMethod.SMS),
      );

      const [sms, options]: Array<unknown> = mock(SmsService.sendSms).mock
        .calls[0]!;

      expect((sms as { to: Phone }).to.toString()).toBe("+15555550100");
      expect(options).toEqual({
        projectId: PROJECT_ID,
        customTwilioConfig: undefined,
        statusPageId: STATUS_PAGE_ID,
        scheduledMaintenanceId: SCHEDULED_MAINTENANCE_ID,
      });
    });

    test("sends the default Slack message, identical to the dashboard's Slack starter", async () => {
      await runJob();

      const expected: string = dashboardDefault(
        StatusPageSubscriberNotificationMethod.Slack,
      );

      expect(sentSlack()).toEqual([expected]);
      expect(expected).toContain(`**State Changed To:** ${STATE_NAME}`);
      expect(SlackUtil.convertMarkdownToSlackRichText).toHaveBeenCalledWith(
        expected,
      );
      expect(
        (
          mock(SlackUtil.sendMessageToChannelViaIncomingWebhook).mock
            .calls[0]![0] as { url: URL }
        ).url.toString(),
      ).toBe(SLACK_URL);
    });

    test("sends the default Teams message as-is, identical to the dashboard's Teams starter", async () => {
      await runJob();

      const expected: string = dashboardDefault(
        StatusPageSubscriberNotificationMethod.MicrosoftTeams,
      );

      expect(sentTeams()).toEqual([expected]);
      expect(expected).toContain(`**State Changed To:** ${STATE_NAME}`);
      // Teams gets markdown; only Slack goes through the rich-text conversion.
      expect(SlackUtil.convertMarkdownToSlackRichText).toHaveBeenCalledTimes(1);
      expect(
        (
          mock(MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook).mock
            .calls[0]![0] as { url: URL }
        ).url.toString(),
      ).toBe(TEAMS_URL);
    });

    test("sends the fixed webhook payload, key for key", async () => {
      await runJob();

      expect(webhookUrls()).toEqual([WEBHOOK_URL]);
      expect(sentWebhooks()).toHaveLength(1);

      const payload: JSONObject = sentWebhooks()[0]!;

      expect(Object.keys(payload).sort()).toEqual(
        [
          "data",
          "eventType",
          "statusPageId",
          "statusPageName",
          "statusPageUrl",
          "unsubscribeUrl",
        ].sort(),
      );
      expect(payload["eventType"]).toBe(WEBHOOK_EVENT_TYPE);
      expect(payload["statusPageId"]).toBe(STATUS_PAGE_ID.toString());
      expect(payload["statusPageName"]).toBe("Acme Status");
      expect(payload["statusPageUrl"]).toBe(STATUS_PAGE_URL);
      expect(payload["unsubscribeUrl"]).toBe(UNSUBSCRIBE_URL);
      expect(payload["data"]).toEqual({
        scheduledMaintenanceId: SCHEDULED_MAINTENANCE_ID.toString(),
        scheduledMaintenanceTitle: EVENT_TITLE,
        scheduledMaintenanceState: STATE_NAME,
        resourcesAffected: "Checkout API",
        detailsUrl: DETAILS_URL,
      });
      expect(payload).toEqual(defaultWebhookPayload());
    });

    test("does not add the description to the default webhook payload", async () => {
      await runJob();

      expect(
        Object.keys(sentWebhooks()[0]!["data"] as JSONObject),
      ).not.toContain("scheduledMaintenanceDescription");
      expect(JSON.stringify(sentWebhooks()[0])).not.toContain("primary");
    });

    test("sends exactly what the dashboard's Webhook starter compiles to", async () => {
      await runJob();

      const starter: string =
        getDefaultSubscriberNotificationTemplate(
          EVENT,
          StatusPageSubscriberNotificationMethod.Webhook,
        )?.body || "";

      expect(starter).not.toBe("");
      expect(sentWebhooks()[0]).toEqual(
        StatusPageSubscriberWebhookTemplate.compile(
          starter,
          expectedVariables(),
        ),
      );
    });

    test("sends a webhook with empty values when the title is missing", async () => {
      storedEvent = scheduledMaintenance({ title: "" });

      await runJob();

      expect(sentWebhooks()).toEqual([
        defaultWebhookPayload({ scheduledMaintenanceTitle: "" }),
      ]);
    });

    test("logs no template warning or error and records success", async () => {
      await runJob();
      await flushPromises();

      expect(warnings()).toEqual([]);
      expect(logger.error).not.toHaveBeenCalled();
      expect(lastStatusWrite()).toEqual(SUCCESS_WRITE);
    });
  });

  describe("template lookups", () => {
    test("asks for one template per channel, Webhook included, for this event and status page", async () => {
      await runJob();

      const lookups: Array<JSONObject> = templateLookups();

      expect(lookups).toHaveLength(5);
      expect(
        lookups
          .map((lookup: JSONObject): string => {
            return lookup["notificationMethod"] as string;
          })
          .sort(),
      ).toEqual([...ALL_METHODS].sort());

      for (const lookup of lookups) {
        expect(lookup["eventType"]).toBe(EVENT);
        expect((lookup["statusPageId"] as ObjectID).toString()).toBe(
          STATUS_PAGE_ID.toString(),
        );
      }
    });

    test("asks only for channels that can send this event", async () => {
      await runJob();

      expect(
        templateLookups()
          .map((lookup: JSONObject): string => {
            return lookup["notificationMethod"] as string;
          })
          .sort(),
      ).toEqual(
        SubscriberNotificationTemplateChannels.getSupportedNotificationMethods(
          EVENT,
        ).sort(),
      );
    });

    test("looks the templates up once per status page, not once per subscriber", async () => {
      useTwoSubscribers();

      await runJob();

      expect(templateLookups()).toHaveLength(5);
      expect(sentWebhooks()).toHaveLength(2);
      expect(sentSms()).toHaveLength(2);
    });

    test("looks up each status page's own templates and fills in its own id", async () => {
      mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mockResolvedValue([
        statusPage(),
        statusPage({ id: SECOND_STATUS_PAGE_ID, pageTitle: "Other Status" }),
      ] as never);
      mock(StatusPageService.getStatusPageURL).mockImplementation(
        async (id: unknown) => {
          return (id as ObjectID).toString() === STATUS_PAGE_ID.toString()
            ? STATUS_PAGE_URL
            : SECOND_STATUS_PAGE_URL;
        },
      );
      mock(
        StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
      ).mockImplementation(async (args: unknown) => {
        const lookup: JSONObject = args as JSONObject;

        if (
          lookup["notificationMethod"] !==
          StatusPageSubscriberNotificationMethod.Webhook
        ) {
          return null;
        }

        return (lookup["statusPageId"] as ObjectID).toString() ===
          STATUS_PAGE_ID.toString()
          ? { templateBody: '{"first": "{{statusPageId}}"}' }
          : {
              templateBody:
                '{"second": "{{statusPageId}}", "name": "{{statusPageName}}", "url": "{{detailsUrl}}"}',
            };
      });

      await runJob();

      const lookedUpPages: Array<string> = templateLookups().map(
        (lookup: JSONObject): string => {
          return (lookup["statusPageId"] as ObjectID).toString();
        },
      );

      expect(lookedUpPages).toHaveLength(10);
      expect(
        lookedUpPages.filter((id: string): boolean => {
          return id === STATUS_PAGE_ID.toString();
        }),
      ).toHaveLength(5);
      expect(
        lookedUpPages.filter((id: string): boolean => {
          return id === SECOND_STATUS_PAGE_ID.toString();
        }),
      ).toHaveLength(5);

      expect(sentWebhooks()).toEqual([
        { first: STATUS_PAGE_ID.toString() },
        {
          second: SECOND_STATUS_PAGE_ID.toString(),
          name: "Other Status",
          url: `${SECOND_STATUS_PAGE_URL}/scheduled-events/${SCHEDULED_MAINTENANCE_ID.toString()}`,
        },
      ]);
    });
  });

  describe("with a custom Webhook template", () => {
    test("sends the compiled JSON object instead of the default payload", async () => {
      useCustomTemplates({
        [StatusPageSubscriberNotificationMethod.Webhook]: {
          templateBody: `{
  "kind": "maintenance-state",
  "maintenance": {
    "id": "{{scheduledMaintenanceId}}",
    "title": "{{scheduledMaintenanceTitle}}",
    "description": "{{scheduledMaintenanceDescription}}",
    "state": "{{ scheduledMaintenanceState }}",
    "startsAt": "{{scheduledAt}}"
  },
  "page": { "id": "{{statusPageId}}", "name": "{{statusPageName}}" },
  "links": ["{{detailsUrl}}", "{{statusPageUrl}}", "{{unsubscribeUrl}}"],
  "resources": "{{resourcesAffected}}",
  "count": 1
}`,
        },
      });

      await runJob();

      expect(webhookUrls()).toEqual([WEBHOOK_URL]);
      expect(sentWebhooks()).toEqual([
        {
          kind: "maintenance-state",
          maintenance: {
            id: SCHEDULED_MAINTENANCE_ID.toString(),
            title: EVENT_TITLE,
            description: EVENT_DESCRIPTION,
            state: STATE_NAME,
            startsAt: SCHEDULED_AT_TEXT,
          },
          page: { id: STATUS_PAGE_ID.toString(), name: "Acme Status" },
          links: [DETAILS_URL, STATUS_PAGE_URL, UNSUBSCRIBE_URL],
          resources: "Checkout API",
          count: 1,
        },
      ]);
      expect(warnings()).toEqual([]);
    });

    test("keeps quotes, backslashes and newlines intact", async () => {
      const trickyTitle: string = 'Upgrade "EU" \\ database $& 100%';
      const trickyDescription: string =
        'Line one\nLine "two" with C:\\path\\ and a tab\there\r\nend {{scheduledMaintenanceDescription}}';

      storedEvent = scheduledMaintenance({
        title: trickyTitle,
        description: trickyDescription,
      });
      useCustomTemplates({
        [StatusPageSubscriberNotificationMethod.Webhook]: {
          templateBody:
            '{"title": "{{scheduledMaintenanceTitle}}", "description": "{{scheduledMaintenanceDescription}}", "state": "{{scheduledMaintenanceState}}"}',
        },
      });

      await runJob();

      const expected: JSONObject = {
        title: trickyTitle,
        description: trickyDescription,
        state: STATE_NAME,
      };

      expect(sentWebhooks()).toEqual([expected]);
      expect(JSON.parse(JSON.stringify(sentWebhooks()[0]))).toEqual(expected);
      expect(warnings()).toEqual([]);
    });

    test.each([
      [
        "an unquoted text variable",
        '{"title": {{scheduledMaintenanceTitle}}, "state": "{{scheduledMaintenanceState}}"}',
      ],
      [
        "text that is not JSON at all",
        "Maintenance {{scheduledMaintenanceTitle}} is {{scheduledMaintenanceState}}",
      ],
      ["a missing closing brace", '{"title": "{{scheduledMaintenanceTitle}}"'],
      ["a JSON array", '[{"title": "{{scheduledMaintenanceTitle}}"}]'],
      ["a JSON string", '"{{scheduledMaintenanceTitle}}"'],
      ["JSON null", "null"],
    ])(
      "falls back to the default payload and warns for %s",
      async (_label: string, templateBody: string) => {
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Webhook]: {
            templateBody: templateBody,
          },
        });

        await runJob();
        await flushPromises();

        expect(sentWebhooks()).toEqual([defaultWebhookPayload()]);
        expect(warnings()).toHaveLength(1);
        expect(warnings()[0]).toContain(STATUS_PAGE_ID.toString());
        expect(warnings()[0]).toContain(WEBHOOK_EVENT_TYPE);

        // The other channels and the job itself are unaffected.
        expectDefaultTextChannels();
        expect(logger.error).not.toHaveBeenCalled();
        expect(lastStatusWrite()).toEqual(SUCCESS_WRITE);
        expect(feedItems()).toHaveLength(1);
      },
    );

    test("warns once per subscriber when a broken template falls back", async () => {
      useTwoSubscribers();
      useCustomTemplates({
        [StatusPageSubscriberNotificationMethod.Webhook]: {
          templateBody: "not json",
        },
      });

      await runJob();

      expect(sentWebhooks()).toEqual([
        defaultWebhookPayload({
          unsubscribeUrl: unsubscribeUrlFor(SUBSCRIBER_ID),
        }),
        defaultWebhookPayload({
          unsubscribeUrl: unsubscribeUrlFor(SECOND_SUBSCRIBER_ID),
        }),
      ]);
      expect(warnings()).toHaveLength(2);
    });

    test("sends the default payload for an empty template body", async () => {
      useCustomTemplates({
        [StatusPageSubscriberNotificationMethod.Webhook]: {
          templateBody: "",
        },
      });

      await runJob();

      expect(sentWebhooks()).toEqual([defaultWebhookPayload()]);
      expect(warnings()).toEqual([]);
    });

    test("leaves Email, SMS, Slack and Teams on their defaults", async () => {
      useStatusPage(
        statusPage({ withSmtpConfig: true, withCallSmsConfig: true }),
      );
      useCustomTemplates({
        [StatusPageSubscriberNotificationMethod.Webhook]: {
          templateBody: '{"custom": "{{scheduledMaintenanceTitle}}"}',
        },
      });

      await runJob();

      expect(sentWebhooks()).toEqual([{ custom: EVENT_TITLE }]);
      expectDefaultTextChannels();
      expect(sentMail()[0]!["subject"]).toBe(
        `[${STATE_NAME} Scheduled Maintenance] ${EVENT_TITLE}`,
      );
    });

    test("fills each subscriber's own unsubscribe link and the raw markdown description", async () => {
      useTwoSubscribers();
      useCustomTemplates({
        [StatusPageSubscriberNotificationMethod.Webhook]: {
          templateBody:
            '{"description": "{{scheduledMaintenanceDescription}}", "unsubscribeUrl": "{{unsubscribeUrl}}"}',
        },
      });

      await runJob();

      expect(sentWebhooks()).toEqual([
        {
          description: EVENT_DESCRIPTION,
          unsubscribeUrl: unsubscribeUrlFor(SUBSCRIBER_ID),
        },
        {
          description: EVENT_DESCRIPTION,
          unsubscribeUrl: unsubscribeUrlFor(SECOND_SUBSCRIBER_ID),
        },
      ]);
      expect(webhookUrls()).toEqual([WEBHOOK_URL, WEBHOOK_URL]);
    });

    test("does not need custom SMTP or SMS configuration", async () => {
      useCustomTemplates({
        [StatusPageSubscriberNotificationMethod.Webhook]: {
          templateBody: '{"custom": "{{scheduledMaintenanceState}}"}',
        },
      });

      await runJob();

      expect(sentWebhooks()).toEqual([{ custom: STATE_NAME }]);
    });
  });

  describe("every template variable is provided", () => {
    test("the event documents the variables this job fills", () => {
      expect(
        SubscriberNotificationTemplateVariables.getVariableNames(EVENT).sort(),
      ).toEqual(
        [
          "statusPageName",
          "statusPageUrl",
          "statusPageId",
          "unsubscribeUrl",
          "resourcesAffected",
          "scheduledMaintenanceId",
          "scheduledMaintenanceTitle",
          "scheduledMaintenanceDescription",
          "scheduledMaintenanceState",
          "detailsUrl",
        ].sort(),
      );
    });

    test("in a custom Email template (custom SMTP)", async () => {
      useStatusPage(statusPage({ withSmtpConfig: true }));
      useCustomTemplates({
        [StatusPageSubscriberNotificationMethod.Email]: {
          templateBody: everyVariableTextTemplate(),
          emailSubject: everyVariableTextTemplate(),
        },
      });

      await runJob();

      expect(sentMail()).toHaveLength(1);
      expect(sentMail()[0]!["templateType"]).toBe(
        EmailTemplateType.BlankTemplate,
      );

      const body: string = (sentMail()[0]!["vars"] as JSONObject)[
        "body"
      ] as string;

      expectEveryVariableFilled(body, expectedVariables());
      expectEveryVariableFilled(
        sentMail()[0]!["subject"] as string,
        expectedVariables(),
      );
      expect(sentMailOptions()[0]).toEqual({
        mailServer: { smtp: "custom" },
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        scheduledMaintenanceId: SCHEDULED_MAINTENANCE_ID,
      });
    });

    test("in a custom SMS template (custom SMS config)", async () => {
      useStatusPage(statusPage({ withCallSmsConfig: true }));
      useCustomTemplates({
        [StatusPageSubscriberNotificationMethod.SMS]: {
          templateBody: everyVariableTextTemplate(),
        },
      });

      await runJob();

      expect(sentSms()).toHaveLength(1);
      expectEveryVariableFilled(sentSms()[0]!, expectedVariables());
      expect(
        (mock(SmsService.sendSms).mock.calls[0]![1] as JSONObject)[
          "customTwilioConfig"
        ],
      ).toEqual({ twilio: "custom" });
    });

    test("in a custom Slack template", async () => {
      useCustomTemplates({
        [StatusPageSubscriberNotificationMethod.Slack]: {
          templateBody: everyVariableTextTemplate(),
        },
      });

      await runJob();

      expect(sentSlack()).toHaveLength(1);
      expectEveryVariableFilled(sentSlack()[0]!, expectedVariables());
    });

    test("in a custom Microsoft Teams template", async () => {
      useCustomTemplates({
        [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
          templateBody: everyVariableTextTemplate(),
        },
      });

      await runJob();

      expect(sentTeams()).toHaveLength(1);
      expectEveryVariableFilled(sentTeams()[0]!, expectedVariables());
    });

    test("in a custom Webhook template", async () => {
      useCustomTemplates({
        [StatusPageSubscriberNotificationMethod.Webhook]: {
          templateBody: everyVariableWebhookTemplate(),
        },
      });

      await runJob();

      const expected: Record<string, string> = expectedVariables();
      const names: Array<string> =
        SubscriberNotificationTemplateVariables.getVariableNames(EVENT);

      expect(sentWebhooks()).toHaveLength(1);
      expect(Object.keys(sentWebhooks()[0]!).sort()).toEqual([...names].sort());
      for (const name of names) {
        expect(sentWebhooks()[0]![name]).toBe(expected[name]);
      }
      expect(JSON.stringify(sentWebhooks()[0])).not.toContain("{{");
      expect(warnings()).toEqual([]);
    });

    test("fills the ids and description with their real values", async () => {
      useCustomTemplates({
        [StatusPageSubscriberNotificationMethod.Slack]: {
          templateBody:
            "{{statusPageId}}|{{scheduledMaintenanceId}}|{{scheduledMaintenanceDescription}}",
        },
      });

      await runJob();

      expect(sentSlack()).toEqual([
        `${STATUS_PAGE_ID.toString()}|${SCHEDULED_MAINTENANCE_ID.toString()}|${EVENT_DESCRIPTION}`,
      ]);
    });

    test("keeps the scheduledAt variable it already provided", async () => {
      useCustomTemplates({
        [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
          templateBody: "Starts {{scheduledAt}}",
        },
        [StatusPageSubscriberNotificationMethod.Webhook]: {
          templateBody: '{"startsAt": "{{scheduledAt}}"}',
        },
      });

      await runJob();

      expect(SCHEDULED_AT_TEXT).toContain("2026");
      expect(sentTeams()).toEqual([`Starts ${SCHEDULED_AT_TEXT}`]);
      expect(sentWebhooks()).toEqual([{ startsAt: SCHEDULED_AT_TEXT }]);
    });

    test("leaves the description empty when the scheduled maintenance has none", async () => {
      storedEvent = scheduledMaintenance({ withoutDescription: true });
      useCustomTemplates({
        [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
          templateBody: "Description: [{{scheduledMaintenanceDescription}}]",
        },
        [StatusPageSubscriberNotificationMethod.Webhook]: {
          templateBody:
            '{"description": "{{scheduledMaintenanceDescription}}"}',
        },
      });

      await runJob();

      expect(sentTeams()).toEqual(["Description: []"]);
      expect(sentWebhooks()).toEqual([{ description: "" }]);
    });

    test("falls back to the custom-template email subject when the template has none", async () => {
      useStatusPage(statusPage({ withSmtpConfig: true }));
      useCustomTemplates({
        [StatusPageSubscriberNotificationMethod.Email]: {
          templateBody: "<p>{{scheduledMaintenanceDescription}}</p>",
        },
      });

      await runJob();

      expect(sentMail()[0]!["templateType"]).toBe(
        EmailTemplateType.BlankTemplate,
      );
      expect(sentMail()[0]!["subject"]).toBe(
        `[Scheduled Maintenance ${STATE_NAME}] ${EVENT_TITLE}`,
      );
      expect(sentMail()[0]!["vars"]).toEqual({
        body: `<p>${EVENT_DESCRIPTION}</p>`,
      });
    });

    test("compiles a custom email subject", async () => {
      useStatusPage(statusPage({ withSmtpConfig: true }));
      useCustomTemplates({
        [StatusPageSubscriberNotificationMethod.Email]: {
          templateBody: "<p>{{scheduledMaintenanceTitle}}</p>",
          emailSubject:
            "{{scheduledMaintenanceState}}: {{scheduledMaintenanceTitle}}",
        },
      });

      await runJob();

      expect(sentMail()[0]!["subject"]).toBe(`${STATE_NAME}: ${EVENT_TITLE}`);
      expect(sentMail()[0]!["vars"]).toEqual({
        body: `<p>${EVENT_TITLE}</p>`,
      });
    });

    test("keeps custom Email and SMS templates off without custom SMTP and SMS config", async () => {
      useCustomTemplates({
        [StatusPageSubscriberNotificationMethod.Email]: {
          templateBody: everyVariableTextTemplate(),
        },
        [StatusPageSubscriberNotificationMethod.SMS]: {
          templateBody: everyVariableTextTemplate(),
        },
      });

      await runJob();

      expect(sentMail()[0]!["templateType"]).toBe(
        EmailTemplateType.SubscriberScheduledMaintenanceEventStateChanged,
      );
      expect(sentSms()).toEqual([
        dashboardDefault(StatusPageSubscriberNotificationMethod.SMS),
      ]);
    });
  });

  describe("failure isolation", () => {
    test("a rejected webhook send does not stop other channels or subscribers, or fail the job", async () => {
      useTwoSubscribers();
      mock(
        StatusPageSubscriberWebhookUtil.sendWebhookNotification,
      ).mockRejectedValue(new Error("webhook down") as never);

      await expect(runJob()).resolves.toBeUndefined();
      await flushPromises();

      expect(sentWebhooks()).toHaveLength(2);
      expect(sentMail()).toHaveLength(2);
      expect(sentSms()).toHaveLength(2);
      expect(sentSlack()).toHaveLength(2);
      expect(sentTeams()).toHaveLength(2);
      expect(logger.error).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: "webhook down" }),
        EXTERNAL_FAULT,
      );
      expect(lastStatusWrite()).toEqual(SUCCESS_WRITE);
      expect(feedItems()).toHaveLength(1);
      expect(feedItems()[0]!["displayColor"]).toBe(Blue500);
    });

    test("a rejected webhook send with a custom template does not fail the job", async () => {
      useCustomTemplates({
        [StatusPageSubscriberNotificationMethod.Webhook]: {
          templateBody: '{"title": "{{scheduledMaintenanceTitle}}"}',
        },
      });
      mock(
        StatusPageSubscriberWebhookUtil.sendWebhookNotification,
      ).mockRejectedValue(new Error("webhook down") as never);

      await runJob();
      await flushPromises();

      expect(sentWebhooks()).toEqual([{ title: EVENT_TITLE }]);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: "webhook down" }),
        EXTERNAL_FAULT,
      );
      expect(lastStatusWrite()).toEqual(SUCCESS_WRITE);
    });

    test("a rejected Teams send does not stop other channels or subscribers, or fail the job", async () => {
      useTwoSubscribers();
      mock(
        MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
      ).mockRejectedValue(new Error("teams down") as never);

      await expect(runJob()).resolves.toBeUndefined();
      await flushPromises();

      expect(sentTeams()).toHaveLength(2);
      expect(sentWebhooks()).toHaveLength(2);
      expect(sentMail()).toHaveLength(2);
      expect(sentSms()).toHaveLength(2);
      expect(sentSlack()).toHaveLength(2);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: "teams down" }),
        EXTERNAL_FAULT,
      );
      expect(lastStatusWrite()).toEqual(SUCCESS_WRITE);
    });

    test("every channel rejecting still records success", async () => {
      mock(MailService.sendMail).mockRejectedValue(
        new Error("mail down") as never,
      );
      mock(SmsService.sendSms).mockRejectedValue(
        new Error("sms down") as never,
      );
      mock(SlackUtil.sendMessageToChannelViaIncomingWebhook).mockRejectedValue(
        new Error("slack down") as never,
      );
      mock(
        MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
      ).mockRejectedValue(new Error("teams down") as never);
      mock(
        StatusPageSubscriberWebhookUtil.sendWebhookNotification,
      ).mockRejectedValue(new Error("webhook down") as never);

      await expect(runJob()).resolves.toBeUndefined();
      await flushPromises();

      const messages: Array<string> = mock(logger.error)
        .mock.calls.map((call: Array<unknown>): string => {
          return (call[0] as Error).message;
        })
        .sort();

      expect(messages).toEqual(
        [
          "mail down",
          "sms down",
          "slack down",
          "teams down",
          "webhook down",
        ].sort(),
      );
      for (const call of mock(logger.error).mock.calls) {
        expect(call[1]).toBe(EXTERNAL_FAULT);
      }
      expect(lastStatusWrite()).toEqual(SUCCESS_WRITE);
    });

    test("a failed template lookup marks the row Failed without sending anything", async () => {
      mock(
        StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
      ).mockRejectedValue(new Error("template lookup failed") as never);

      await runJob();

      nothingSent();
      expect(feedItems()).toEqual([]);
      expect(lastStatusWrite()).toEqual({
        subscriberNotificationStatus:
          StatusPageSubscriberNotificationStatus.Failed,
        subscriberNotificationStatusMessage: "template lookup failed",
      });
    });

    test("a failed feed write marks the row Failed after the messages went out", async () => {
      mock(
        ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem,
      ).mockRejectedValue(new Error("feed unavailable") as never);

      await runJob();

      expect(sentWebhooks()).toHaveLength(1);
      expect(lastStatusWrite()).toEqual({
        subscriberNotificationStatus:
          StatusPageSubscriberNotificationStatus.Failed,
        subscriberNotificationStatusMessage: "feed unavailable",
      });
    });
  });
});
