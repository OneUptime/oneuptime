import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
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
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberNotificationTemplateChannels from "Common/Types/StatusPage/SubscriberNotificationTemplateChannels";
import SubscriberNotificationTemplateVariables from "Common/Types/StatusPage/SubscriberNotificationTemplateVariables";
import SubscriberUpdateNotification from "Common/Types/StatusPage/SubscriberUpdateNotification";

/*
 * Scheduled maintenance public note notifications: "note posted" and the new
 * "note updated" job share one send path. A maintenance note is where a moved
 * window or a changed scope is usually announced, which is exactly the edit
 * subscribers most need to hear about.
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
  "Common/Server/Services/ScheduledMaintenancePublicNoteService",
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
  return { __esModule: true, default: { findAllBy: jest.fn() } };
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
import ScheduledMaintenancePublicNoteService from "Common/Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import SmsService from "Common/Server/Services/SmsService";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import Markdown from "Common/Server/Types/Markdown";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
import StatusPageSubscriberWebhookTemplate from "Common/Server/Utils/StatusPageSubscriberWebhookTemplate";
import logger from "Common/Server/Utils/Logger";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import { getDefaultSubscriberNotificationTemplate } from "../../../../FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateDefaults";
import "../../../../FeatureSet/Workers/Jobs/ScheduledMaintenancePublicNote/SendNotificationToSubscribers";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const CREATED_JOB: string =
  "ScheduledMaintenancePublicNote:SendNotificationToSubscribers";
const UPDATED_JOB: string =
  "ScheduledMaintenancePublicNote:SendUpdateNotificationToSubscribers";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SECOND_STATUS_PAGE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const EVENT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const NOTE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const SECOND_SUBSCRIBER_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

const STATUS_PAGE_URL: string = "https://status.acme.com";
const SECOND_STATUS_PAGE_URL: string = "https://status.other.com";
const DETAILS_URL: string = `${STATUS_PAGE_URL}/scheduled-events/${EVENT_ID.toString()}`;
const UNSUBSCRIBE_URL: string = `${STATUS_PAGE_URL}/update-subscription/${SUBSCRIBER_ID.toString()}`;
const DASHBOARD_URL: string =
  "https://oneuptime.acme.com/dashboard/scheduled-maintenance/1";
const WEBHOOK_URL: string = "https://hooks.acme.com/status";

const EVENT_TITLE: string = "Database engine upgrade";
const EVENT_DESCRIPTION: string = "The database engine will be **upgraded**.";
const EVENT_DESCRIPTION_TEXT: string = "The database engine will be upgraded.";
const EVENT_STATE: string = "Ongoing";
const NOTE: string = "The window moved to **Sunday 02:00 UTC**.";
const NOTE_HTML: string =
  "<p>The window moved to <strong>Sunday 02:00 UTC</strong>.</p>";
const NOTE_TEXT: string = "The window moved to Sunday 02:00 UTC.";

// When the event starts, when the note says it was posted, and a later "now".
const STARTS_AT: Date = new Date("2026-09-20T02:00:00.000Z");
const POSTED_AT: Date = new Date("2026-03-04T05:06:07.000Z");
const JOB_RAN_AT: Date = new Date("2031-11-12T13:14:15.000Z");
const STARTS_AT_TEXT: string =
  OneUptimeDate.getDateAsUserFriendlyFormattedString(STARTS_AT);
const POSTED_AT_TEXT: string =
  OneUptimeDate.getDateAsUserFriendlyFormattedString(POSTED_AT);
const JOB_RAN_AT_TEXT: string =
  OneUptimeDate.getDateAsUserFriendlyFormattedString(JOB_RAN_AT);

const PLAIN_TEXT: Record<string, string> = {
  [NOTE]: NOTE_TEXT,
  [EVENT_DESCRIPTION]: EVENT_DESCRIPTION_TEXT,
};

const ALL_METHODS: Array<StatusPageSubscriberNotificationMethod> = [
  StatusPageSubscriberNotificationMethod.Email,
  StatusPageSubscriberNotificationMethod.SMS,
  StatusPageSubscriberNotificationMethod.Slack,
  StatusPageSubscriberNotificationMethod.MicrosoftTeams,
  StatusPageSubscriberNotificationMethod.Webhook,
];

let createdNotes: Array<ScheduledMaintenancePublicNote> = [];
let updatedNotes: Array<ScheduledMaintenancePublicNote> = [];
let storedEvent: ScheduledMaintenance | null = null;

function publicNote(overrides?: {
  subscriberNotificationStatusOnNoteCreated?: StatusPageSubscriberNotificationStatus;
  note?: string;
  withoutPostedAt?: boolean;
}): ScheduledMaintenancePublicNote {
  const note: ScheduledMaintenancePublicNote =
    new ScheduledMaintenancePublicNote();
  note._id = NOTE_ID.toString();
  note.note = overrides?.note ?? NOTE;
  note.scheduledMaintenanceId = EVENT_ID;
  if (!overrides?.withoutPostedAt) {
    note.postedAt = POSTED_AT;
  }
  note.subscriberNotificationStatusOnNoteCreated =
    overrides?.subscriberNotificationStatusOnNoteCreated ||
    StatusPageSubscriberNotificationStatus.Success;
  return note;
}

function scheduledEvent(overrides?: {
  isVisibleOnStatusPage?: boolean;
  withoutStatusPages?: boolean;
  withoutState?: boolean;
  withoutMonitors?: boolean;
  title?: string;
  description?: string;
}): ScheduledMaintenance {
  const event: ScheduledMaintenance = new ScheduledMaintenance();
  event._id = EVENT_ID.toString();
  event.title = overrides?.title ?? EVENT_TITLE;
  event.description = overrides?.description ?? EVENT_DESCRIPTION;
  event.projectId = PROJECT_ID;
  event.startsAt = STARTS_AT;
  event.isVisibleOnStatusPage = overrides?.isVisibleOnStatusPage !== false;
  event.scheduledMaintenanceNumber = 12;

  if (!overrides?.withoutState) {
    const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
    state.name = EVENT_STATE;
    event.currentScheduledMaintenanceState = state;
  }

  if (!overrides?.withoutMonitors) {
    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID.toString();
    event.monitors = [monitor];
  } else {
    event.monitors = [];
  }

  if (!overrides?.withoutStatusPages) {
    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID.toString();
    event.statusPages = [page];
  } else {
    event.statusPages = [];
  }

  return event;
}

function statusPage(overrides?: {
  id?: ObjectID;
  showScheduledMaintenanceEventsOnStatusPage?: boolean;
  withSmtpConfig?: boolean;
  withCallSmsConfig?: boolean;
}): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = (overrides?.id || STATUS_PAGE_ID).toString();
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  page.pageTitle = "Acme Status";
  page.isPublicStatusPage = true;
  page.showScheduledMaintenanceEventsOnStatusPage =
    overrides?.showScheduledMaintenanceEventsOnStatusPage !== false;
  if (overrides?.withSmtpConfig) {
    (page as unknown as JSONObject)["smtpConfig"] = { _id: "smtp" };
  }
  if (overrides?.withCallSmsConfig) {
    (page as unknown as JSONObject)["callSmsConfig"] = { _id: "sms" };
  }
  return page;
}

function resource(displayName?: string): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = "88888888-8888-4888-8888-888888888888";
  row.statusPageId = STATUS_PAGE_ID;
  row.displayName = displayName ?? "Primary database";
  return row;
}

function subscriber(id?: ObjectID): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row._id = (id || SUBSCRIBER_ID).toString();
  row.subscriberEmail = new Email("customer@example.com");
  row.subscriberPhone = new Phone("+15555550100");
  row.slackIncomingWebhookUrl = URL.fromString(
    "https://hooks.slack.com/services/T000/B000/XXXX",
  );
  row.microsoftTeamsIncomingWebhookUrl = URL.fromString(
    "https://outlook.office.com/webhook/abc",
  );
  row.subscriberWebhook = URL.fromString(WEBHOOK_URL);
  return row;
}

function unsubscribeUrlFor(id: ObjectID): string {
  return `${STATUS_PAGE_URL}/update-subscription/${id.toString()}`;
}

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
}

function statusWrites(): Array<JSONObject> {
  return mock(
    ScheduledMaintenancePublicNoteService.updateOneById,
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

/*
 * Structurally typed rather than as jest.SpiedFunction: @jest/globals and
 * @types/jest disagree on the spy's shape.
 */
type ClockSpy = { mockRestore: () => void };

// Makes "now" JOB_RAN_AT until the returned spy is restored.
function stopClockAtJobRun(): ClockSpy {
  return jest
    .spyOn(OneUptimeDate, "getCurrentDate")
    .mockReturnValue(JOB_RAN_AT) as unknown as ClockSpy;
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

function useStatusPages(pages: Array<StatusPage>): void {
  mock(
    StatusPageSubscriberService.getStatusPagesToSendNotification,
  ).mockResolvedValue(pages as never);
}

/*
 * The per-subscriber values the job fills in for Email, Slack, Teams and
 * Webhook templates (SMS gets the note and description as plain text).
 */
function expectedVariables(overrides?: {
  unsubscribeUrl?: string;
  note?: string;
  scheduledMaintenanceDescription?: string;
}): Record<string, string> {
  return {
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    statusPageId: STATUS_PAGE_ID.toString(),
    unsubscribeUrl: overrides?.unsubscribeUrl ?? UNSUBSCRIBE_URL,
    resourcesAffected: "Primary database",
    scheduledMaintenanceId: EVENT_ID.toString(),
    scheduledMaintenanceTitle: EVENT_TITLE,
    scheduledMaintenanceDescription:
      overrides?.scheduledMaintenanceDescription ?? EVENT_DESCRIPTION,
    scheduledMaintenanceState: EVENT_STATE,
    postedAt: POSTED_AT_TEXT,
    note: overrides?.note ?? NOTE,
    detailsUrl: DETAILS_URL,
  };
}

function expectedSmsVariables(): Record<string, string> {
  return expectedVariables({
    note: NOTE_TEXT,
    scheduledMaintenanceDescription: EVENT_DESCRIPTION_TEXT,
  });
}

// The payload webhook subscribers have always received for a note.
function defaultWebhookPayload(
  webhookEventType: string,
  overrides?: {
    unsubscribeUrl?: string;
    resourcesAffected?: string;
  },
): JSONObject {
  return {
    eventType: webhookEventType,
    statusPageId: STATUS_PAGE_ID.toString(),
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    unsubscribeUrl: overrides?.unsubscribeUrl ?? UNSUBSCRIBE_URL,
    data: {
      scheduledMaintenanceId: EVENT_ID.toString(),
      scheduledMaintenanceTitle: EVENT_TITLE,
      scheduledMaintenanceDescription: EVENT_DESCRIPTION,
      resourcesAffected: overrides?.resourcesAffected ?? "Primary database",
      note: NOTE,
      detailsUrl: DETAILS_URL,
    },
  };
}

// A text template naming every variable of the event as "name=[{{name}}]".
function everyVariableTextTemplate(
  event: StatusPageSubscriberNotificationEventType,
): string {
  return SubscriberNotificationTemplateVariables.getVariableNames(event)
    .map((name: string): string => {
      return `${name}=[{{${name}}}]`;
    })
    .join("\n");
}

// A Webhook template with one string property per variable of the event.
function everyVariableWebhookTemplate(
  event: StatusPageSubscriberNotificationEventType,
): string {
  const body: JSONObject = {};

  for (const name of SubscriberNotificationTemplateVariables.getVariableNames(
    event,
  )) {
    body[name] = `{{${name}}}`;
  }

  return JSON.stringify(body, null, 2);
}

function expectEveryVariableFilled(
  text: string,
  event: StatusPageSubscriberNotificationEventType,
  expected: Record<string, string>,
): void {
  expect(text).not.toContain("{{");

  for (const name of SubscriberNotificationTemplateVariables.getVariableNames(
    event,
  )) {
    expect(expected[name]).toBeDefined();
    expect(text).toContain(`${name}=[${expected[name]}]`);
  }
}

function dashboardDefault(
  eventType: StatusPageSubscriberNotificationEventType,
  method: StatusPageSubscriberNotificationMethod,
): string {
  const template: string =
    getDefaultSubscriberNotificationTemplate(eventType, method)?.body || "";
  const variables: Record<string, string> = expectedVariables();

  return template.replace(/{{\s*(\w+)\s*}}/g, (_match: string, key: string) => {
    return variables[key] ?? "";
  });
}

async function runJob(name: string): Promise<void> {
  expect(mockCapturedJobs[name]).toBeDefined();
  await mockCapturedJobs[name]!();
}

beforeEach(() => {
  jest.clearAllMocks();

  createdNotes = [];
  updatedNotes = [];
  storedEvent = scheduledEvent();

  mock(ScheduledMaintenancePublicNoteService.findAllBy).mockImplementation(
    async (args: unknown): Promise<Array<ScheduledMaintenancePublicNote>> => {
      const query: JSONObject = (args as { query: JSONObject }).query;

      return query["subscriberNotificationStatusOnNoteUpdated"]
        ? updatedNotes
        : createdNotes;
    },
  );
  mock(ScheduledMaintenancePublicNoteService.updateOneById).mockResolvedValue(
    1 as never,
  );

  mock(ScheduledMaintenanceService.findOneById).mockImplementation(async () => {
    return storedEvent;
  });
  mock(
    ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard,
  ).mockResolvedValue(URL.fromString(DASHBOARD_URL) as never);
  mock(
    ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem,
  ).mockResolvedValue(undefined as never);

  mock(StatusPageResourceService.findAllBy).mockResolvedValue([
    resource(),
  ] as never);

  mock(DatabaseConfig.getHost).mockResolvedValue(
    Hostname.fromString("oneuptime.acme.com") as never,
  );
  mock(DatabaseConfig.getHttpProtocol).mockResolvedValue(
    Protocol.HTTPS as never,
  );

  useStatusPages([statusPage()]);
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

  mock(Markdown.convertToHTML).mockResolvedValue(NOTE_HTML as never);
  mock(Markdown.convertToPlainText).mockImplementation((text: unknown) => {
    return PLAIN_TEXT[text as string] ?? (text as string);
  });

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

describe("ScheduledMaintenancePublicNote:SendUpdateNotificationToSubscribers", () => {
  test("is registered next to the created job", () => {
    expect(mockCapturedJobs[UPDATED_JOB]).toBeDefined();
    expect(mockCapturedJobs[CREATED_JOB]).toBeDefined();
  });

  test("looks only for notes with a pending update notification", async () => {
    await runJob(UPDATED_JOB);

    const args: { query: JSONObject; select: JSONObject } = mock(
      ScheduledMaintenancePublicNoteService.findAllBy,
    ).mock.calls[0]![0] as { query: JSONObject; select: JSONObject };

    expect(args.query).toEqual({
      subscriberNotificationStatusOnNoteUpdated:
        StatusPageSubscriberNotificationStatus.Pending,
    });
    expect(args.select["subscriberNotificationStatusOnNoteCreated"]).toBe(true);
    expect(DatabaseConfig.getHost).not.toHaveBeenCalled();
  });

  test.each([
    StatusPageSubscriberNotificationStatus.Pending,
    StatusPageSubscriberNotificationStatus.InProgress,
  ])(
    "skips while the note's original notification is %s",
    async (originalStatus: StatusPageSubscriberNotificationStatus) => {
      updatedNotes = [
        publicNote({
          subscriberNotificationStatusOnNoteCreated: originalStatus,
        }),
      ];

      await runJob(UPDATED_JOB);

      nothingSent();
      expect(ScheduledMaintenanceService.findOneById).not.toHaveBeenCalled();
      expect(statusWrites()).toEqual([
        {
          subscriberNotificationStatusOnNoteUpdated:
            StatusPageSubscriberNotificationStatus.Skipped,
          subscriberNotificationStatusMessageOnNoteUpdated:
            SubscriberUpdateNotification.notYetNotifiedMessage,
        },
      ]);
    },
  );

  test("emails the updated-note template with an update subject", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberScheduledMaintenanceEventNoteUpdated,
    );
    expect(sentMail()[0]!["subject"]).toBe(
      `[Scheduled Maintenance Note Updated] ${EVENT_TITLE}`,
    );
    expect(sentMail()[0]!["vars"]).toEqual(
      expect.objectContaining({
        note: NOTE_HTML,
        eventTitle: EVENT_TITLE,
        eventDescription: EVENT_DESCRIPTION,
        resourcesAffected: "Primary database",
        detailsUrl: DETAILS_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
      }),
    );
  });

  test("uses the update wording on SMS, Slack and Teams, matching the dashboard defaults", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    const event: StatusPageSubscriberNotificationEventType =
      StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteUpdated;

    expect(sentSms()).toEqual([
      `Maintenance note updated: ${EVENT_TITLE} on Acme Status. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
    ]);
    expect(sentSms()[0]).toBe(
      dashboardDefault(event, StatusPageSubscriberNotificationMethod.SMS),
    );
    expect(sentSlack()[0]).toContain("**Note Updated**");
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

  test("tells webhook subscribers it is a ScheduledMaintenanceNoteUpdated event", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    expect(sentWebhooks()[0]!["eventType"]).toBe(
      "ScheduledMaintenanceNoteUpdated",
    );
    expect(sentWebhooks()[0]!["data"]).toEqual({
      scheduledMaintenanceId: EVENT_ID.toString(),
      scheduledMaintenanceTitle: EVENT_TITLE,
      scheduledMaintenanceDescription: EVENT_DESCRIPTION,
      resourcesAffected: "Primary database",
      note: NOTE,
      detailsUrl: DETAILS_URL,
    });
  });

  test("looks up custom templates for the updated event", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    const lookups: Array<unknown> = templateLookups().map(
      (lookup: JSONObject): unknown => {
        return lookup["eventType"];
      },
    );

    expect(lookups).toEqual([
      StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteUpdated,
      StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteUpdated,
      StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteUpdated,
      StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteUpdated,
      StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteUpdated,
    ]);
  });

  test("records in the maintenance feed that subscribers were told about an edited note", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    expect(feedItems()[0]!["feedInfoInMarkdown"]).toBe(
      `📧 **Notification sent to subscribers** because a public note was updated on this [Scheduled Maintenance 12](${DASHBOARD_URL}).`,
    );
  });

  test("records progress and success on the update columns only", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatusOnNoteUpdated:
          StatusPageSubscriberNotificationStatus.InProgress,
      },
      {
        subscriberNotificationStatusOnNoteUpdated:
          StatusPageSubscriberNotificationStatus.Success,
        subscriberNotificationStatusMessageOnNoteUpdated:
          SubscriberUpdateNotification.sentMessage,
      },
    ]);
  });

  test("skips the update when the event is hidden from the status page", async () => {
    updatedNotes = [publicNote()];
    storedEvent = scheduledEvent({ isVisibleOnStatusPage: false });

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(statusWrites()[statusWrites().length - 1]).toEqual({
      subscriberNotificationStatusOnNoteUpdated:
        StatusPageSubscriberNotificationStatus.Skipped,
      subscriberNotificationStatusMessageOnNoteUpdated:
        "Notifications skipped as scheduled maintenance is not visible on status page.",
    });
  });

  test("skips the update when the event has been deleted", async () => {
    updatedNotes = [publicNote()];
    storedEvent = null;

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatusOnNoteUpdated:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessageOnNoteUpdated:
          "Related scheduled maintenance not found. Skipping notifications to subscribers.",
      },
    ]);
  });

  test("skips the update when no status page shows the event", async () => {
    updatedNotes = [publicNote()];
    useStatusPages([]);

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(statusWrites()[statusWrites().length - 1]).toEqual({
      subscriberNotificationStatusOnNoteUpdated:
        StatusPageSubscriberNotificationStatus.Skipped,
      subscriberNotificationStatusMessageOnNoteUpdated:
        "No status pages are configured for this scheduled maintenance. Skipping notifications.",
    });
  });

  test("respects a status page that hides scheduled events", async () => {
    updatedNotes = [publicNote()];
    useStatusPages([
      statusPage({ showScheduledMaintenanceEventsOnStatusPage: false }),
    ]);

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(feedItems()[0]!["feedInfoInMarkdown"]).toContain(
      "for the updated public note on [Scheduled Maintenance 12]",
    );
  });

  test("marks the update Failed with the reason when sending breaks", async () => {
    updatedNotes = [publicNote()];
    mock(Markdown.convertToHTML).mockRejectedValue(
      new Error("markdown exploded") as never,
    );

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(statusWrites()[statusWrites().length - 1]).toEqual({
      subscriberNotificationStatusOnNoteUpdated:
        StatusPageSubscriberNotificationStatus.Failed,
      subscriberNotificationStatusMessageOnNoteUpdated: "markdown exploded",
    });
  });
});

describe("ScheduledMaintenancePublicNote:SendNotificationToSubscribers (created)", () => {
  test("still only picks up notes whose author asked to notify", async () => {
    await runJob(CREATED_JOB);

    expect(
      (
        mock(ScheduledMaintenancePublicNoteService.findAllBy).mock
          .calls[0]![0] as { query: JSONObject }
      ).query,
    ).toEqual({
      subscriberNotificationStatusOnNoteCreated:
        StatusPageSubscriberNotificationStatus.Pending,
      shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true,
    });
  });

  test("sends the new-note messages it always has", async () => {
    createdNotes = [publicNote()];

    await runJob(CREATED_JOB);

    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberScheduledMaintenanceEventNoteCreated,
    );
    expect(sentMail()[0]!["subject"]).toBe(
      `[Update Scheduled Maintenance] ${EVENT_TITLE}`,
    );
    expect(sentSms()[0]).toBe(
      `Maintenance update: ${EVENT_TITLE} on Acme Status. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
    );
    expect(sentSlack()[0]).toContain("**New Note Added**");
    expect(sentWebhooks()[0]!["eventType"]).toBe(
      "ScheduledMaintenanceNoteCreated",
    );
    expect(feedItems()[0]!["feedInfoInMarkdown"]).toContain(
      "because a public note is added to this [Scheduled Maintenance 12]",
    );
  });

  test("still matches the dashboard's created defaults", async () => {
    createdNotes = [publicNote()];

    await runJob(CREATED_JOB);

    const event: StatusPageSubscriberNotificationEventType =
      StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteCreated;

    expect(sentSms()[0]).toBe(
      dashboardDefault(event, StatusPageSubscriberNotificationMethod.SMS),
    );
    expect(sentSlack()[0]).toBe(
      dashboardDefault(event, StatusPageSubscriberNotificationMethod.Slack),
    );
  });

  test("records its status on the original columns only", async () => {
    createdNotes = [publicNote()];

    await runJob(CREATED_JOB);

    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.InProgress,
      },
      {
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.Success,
        subscriberNotificationStatusMessage:
          "Notifications sent successfully to all subscribers",
      },
    ]);
  });
});

/*
 * Everything below runs for both triggers: the "note posted" and "note
 * updated" jobs share one send path, so each must fill the same variables,
 * look up the same templates and send the same Webhook bodies.
 */
interface TriggerCase {
  name: string;
  job: string;
  event: StatusPageSubscriberNotificationEventType;
  webhookEventType: string;
  emailTemplateType: EmailTemplateType;
  emailSubject: string;
  customEmailSubject: string;
  smsPrefix: string;
  chatSentence: string;
  successWrite: JSONObject;
  queue: (notes: Array<ScheduledMaintenancePublicNote>) => void;
}

const TRIGGER_CASES: Array<TriggerCase> = [
  {
    name: "created",
    job: CREATED_JOB,
    event:
      StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteCreated,
    webhookEventType: "ScheduledMaintenanceNoteCreated",
    emailTemplateType:
      EmailTemplateType.SubscriberScheduledMaintenanceEventNoteCreated,
    emailSubject: `[Update Scheduled Maintenance] ${EVENT_TITLE}`,
    customEmailSubject: `[Scheduled Maintenance Update] ${EVENT_TITLE}`,
    smsPrefix: "Maintenance update:",
    chatSentence: "New Note Added",
    successWrite: {
      subscriberNotificationStatusOnNoteCreated:
        StatusPageSubscriberNotificationStatus.Success,
      subscriberNotificationStatusMessage:
        "Notifications sent successfully to all subscribers",
    },
    queue: (notes: Array<ScheduledMaintenancePublicNote>): void => {
      createdNotes = notes;
    },
  },
  {
    name: "updated",
    job: UPDATED_JOB,
    event:
      StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteUpdated,
    webhookEventType: "ScheduledMaintenanceNoteUpdated",
    emailTemplateType:
      EmailTemplateType.SubscriberScheduledMaintenanceEventNoteUpdated,
    emailSubject: `[Scheduled Maintenance Note Updated] ${EVENT_TITLE}`,
    customEmailSubject: `[Scheduled Maintenance Note Updated] ${EVENT_TITLE}`,
    smsPrefix: "Maintenance note updated:",
    chatSentence: "Note Updated",
    successWrite: {
      subscriberNotificationStatusOnNoteUpdated:
        StatusPageSubscriberNotificationStatus.Success,
      subscriberNotificationStatusMessageOnNoteUpdated:
        SubscriberUpdateNotification.sentMessage,
    },
    queue: (notes: Array<ScheduledMaintenancePublicNote>): void => {
      updatedNotes = notes;
    },
  },
];

describe.each(TRIGGER_CASES)(
  "ScheduledMaintenancePublicNote subscriber notification ($name)",
  (tc: TriggerCase) => {
    function useTwoSubscribers(): void {
      mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mockResolvedValue([
        subscriber(SUBSCRIBER_ID),
        subscriber(SECOND_SUBSCRIBER_ID),
      ] as never);
      mock(StatusPageSubscriberService.getUnsubscribeLink).mockImplementation(
        (_url: unknown, id: unknown): URL => {
          return URL.fromString(unsubscribeUrlFor(id as ObjectID));
        },
      );
    }

    function expectDefaultTextChannels(): void {
      expect(sentSms()).toEqual([
        dashboardDefault(tc.event, StatusPageSubscriberNotificationMethod.SMS),
      ]);
      expect(sentSlack()).toEqual([
        dashboardDefault(
          tc.event,
          StatusPageSubscriberNotificationMethod.Slack,
        ),
      ]);
      expect(sentTeams()).toEqual([
        dashboardDefault(
          tc.event,
          StatusPageSubscriberNotificationMethod.MicrosoftTeams,
        ),
      ]);
      expect(sentMail()).toHaveLength(1);
      expect(sentMail()[0]!["templateType"]).toBe(tc.emailTemplateType);
    }

    beforeEach(() => {
      tc.queue([publicNote()]);
    });

    describe("with no custom templates", () => {
      test("emails the default note template with every value it always had", async () => {
        await runJob(tc.job);

        expect(sentMail()).toHaveLength(1);
        expect(sentMail()[0]!["toEmail"]!.toString()).toBe(
          "customer@example.com",
        );
        expect(sentMail()[0]!["templateType"]).toBe(tc.emailTemplateType);
        expect(sentMail()[0]!["subject"]).toBe(tc.emailSubject);
        expect(sentMail()[0]!["vars"]).toEqual({
          note: NOTE_HTML,
          statusPageName: "Acme Status",
          statusPageUrl: STATUS_PAGE_URL,
          detailsUrl: DETAILS_URL,
          logoUrl: "",
          isPublicStatusPage: "true",
          resourcesAffected: "Primary database",
          scheduledAt: STARTS_AT_TEXT,
          eventTitle: EVENT_TITLE,
          eventDescription: EVENT_DESCRIPTION,
          unsubscribeUrl: UNSUBSCRIBE_URL,
          subscriberEmailNotificationFooterText: "Footer text",
        });
      });

      test("sends the default SMS, identical to the dashboard's SMS starter", async () => {
        await runJob(tc.job);

        expect(sentSms()).toEqual([
          `${tc.smsPrefix} ${EVENT_TITLE} on Acme Status. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
        ]);
        expect(sentSms()[0]).toBe(
          dashboardDefault(
            tc.event,
            StatusPageSubscriberNotificationMethod.SMS,
          ),
        );
        expect(
          (
            mock(SmsService.sendSms).mock.calls[0]![0] as { to: Phone }
          ).to.toString(),
        ).toBe("+15555550100");
      });

      test("sends the default Slack message, identical to the dashboard's Slack starter", async () => {
        await runJob(tc.job);

        const expected: string = dashboardDefault(
          tc.event,
          StatusPageSubscriberNotificationMethod.Slack,
        );

        expect(sentSlack()).toEqual([expected]);
        expect(expected).toContain(`**${tc.chatSentence}**`);
        expect(expected).toContain(`**Note:** ${NOTE}`);
        expect(SlackUtil.convertMarkdownToSlackRichText).toHaveBeenCalledWith(
          expected,
        );
      });

      test("sends the default Teams message as-is, identical to the dashboard's Teams starter", async () => {
        await runJob(tc.job);

        const expected: string = dashboardDefault(
          tc.event,
          StatusPageSubscriberNotificationMethod.MicrosoftTeams,
        );

        expect(sentTeams()).toEqual([expected]);
        expect(expected).toContain(`**${tc.chatSentence}**`);
        // Teams gets markdown; only Slack goes through the rich-text conversion.
        expect(SlackUtil.convertMarkdownToSlackRichText).toHaveBeenCalledTimes(
          1,
        );
        expect(
          (
            mock(MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook).mock
              .calls[0]![0] as { url: URL }
          ).url.toString(),
        ).toBe("https://outlook.office.com/webhook/abc");
      });

      test("sends the fixed webhook payload, key for key", async () => {
        await runJob(tc.job);

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
        expect(payload["eventType"]).toBe(tc.webhookEventType);
        expect(payload["statusPageId"]).toBe(STATUS_PAGE_ID.toString());
        expect(payload["statusPageName"]).toBe("Acme Status");
        expect(payload["statusPageUrl"]).toBe(STATUS_PAGE_URL);
        expect(payload["unsubscribeUrl"]).toBe(UNSUBSCRIBE_URL);
        expect(payload["data"]).toEqual({
          scheduledMaintenanceId: EVENT_ID.toString(),
          scheduledMaintenanceTitle: EVENT_TITLE,
          scheduledMaintenanceDescription: EVENT_DESCRIPTION,
          resourcesAffected: "Primary database",
          note: NOTE,
          detailsUrl: DETAILS_URL,
        });
        expect(payload).toEqual(defaultWebhookPayload(tc.webhookEventType));
      });

      test("sends exactly what the dashboard's Webhook starter compiles to", async () => {
        await runJob(tc.job);

        const starter: string =
          getDefaultSubscriberNotificationTemplate(
            tc.event,
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

      test("keeps an empty resources list in the default payload when the event has no monitors", async () => {
        storedEvent = scheduledEvent({ withoutMonitors: true });

        await runJob(tc.job);

        expect(StatusPageResourceService.findAllBy).not.toHaveBeenCalled();
        expect(sentWebhooks()).toEqual([
          defaultWebhookPayload(tc.webhookEventType, {
            resourcesAffected: "",
          }),
        ]);
        expect(
          (sentMail()[0]!["vars"] as JSONObject)["resourcesAffected"],
        ).toBe("");
      });

      test("logs no template warning and records success", async () => {
        await runJob(tc.job);
        await flushPromises();

        expect(warnings()).toEqual([]);
        expect(logger.error).not.toHaveBeenCalled();
        expect(statusWrites()[statusWrites().length - 1]).toEqual(
          tc.successWrite,
        );
      });
    });

    describe("template lookups", () => {
      test("asks for one template per channel, Webhook included, for this event and status page", async () => {
        await runJob(tc.job);

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
          expect(lookup["eventType"]).toBe(tc.event);
          expect((lookup["statusPageId"] as ObjectID).toString()).toBe(
            STATUS_PAGE_ID.toString(),
          );
        }
      });

      test("asks only for channels that can send this event", async () => {
        await runJob(tc.job);

        expect(
          templateLookups()
            .map((lookup: JSONObject): string => {
              return lookup["notificationMethod"] as string;
            })
            .sort(),
        ).toEqual(
          SubscriberNotificationTemplateChannels.getSupportedNotificationMethods(
            tc.event,
          ).sort(),
        );
      });

      test("looks the templates up once per status page, not once per subscriber", async () => {
        useTwoSubscribers();

        await runJob(tc.job);

        expect(templateLookups()).toHaveLength(5);
        expect(sentWebhooks()).toHaveLength(2);
        expect(sentSms()).toHaveLength(2);
      });

      test("looks the templates up for each status page with that page's own values", async () => {
        const secondPage: StatusPage = statusPage({
          id: SECOND_STATUS_PAGE_ID,
        });
        secondPage.pageTitle = "Other Status";

        useStatusPages([statusPage(), secondPage]);
        mock(StatusPageService.getStatusPageURL).mockImplementation(
          async (id: unknown): Promise<string> => {
            return (id as ObjectID).toString() ===
              SECOND_STATUS_PAGE_ID.toString()
              ? SECOND_STATUS_PAGE_URL
              : STATUS_PAGE_URL;
          },
        );
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Webhook]: {
            templateBody:
              '{"page": "{{statusPageId}}", "name": "{{statusPageName}}", "resources": "{{resourcesAffected}}", "details": "{{detailsUrl}}"}',
          },
        });

        await runJob(tc.job);

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

        // The monitor's resource is only on the first status page.
        expect(sentWebhooks()).toEqual([
          {
            page: STATUS_PAGE_ID.toString(),
            name: "Acme Status",
            resources: "Primary database",
            details: DETAILS_URL,
          },
          {
            page: SECOND_STATUS_PAGE_ID.toString(),
            name: "Other Status",
            resources: "",
            details: `${SECOND_STATUS_PAGE_URL}/scheduled-events/${EVENT_ID.toString()}`,
          },
        ]);
      });
    });

    describe("with a custom Webhook template", () => {
      test("sends the compiled JSON object instead of the default payload", async () => {
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Webhook]: {
            templateBody: `{
  "kind": "maintenance-note",
  "maintenance": {
    "id": "{{scheduledMaintenanceId}}",
    "title": "{{scheduledMaintenanceTitle}}",
    "description": "{{scheduledMaintenanceDescription}}",
    "state": "{{scheduledMaintenanceState}}"
  },
  "note": "{{note}}",
  "postedAt": "{{ postedAt }}",
  "page": { "id": "{{statusPageId}}", "name": "{{statusPageName}}" },
  "links": ["{{detailsUrl}}", "{{statusPageUrl}}", "{{unsubscribeUrl}}"],
  "resources": "{{resourcesAffected}}"
}`,
          },
        });

        await runJob(tc.job);

        expect(webhookUrls()).toEqual([WEBHOOK_URL]);
        expect(sentWebhooks()).toEqual([
          {
            kind: "maintenance-note",
            maintenance: {
              id: EVENT_ID.toString(),
              title: EVENT_TITLE,
              description: EVENT_DESCRIPTION,
              state: EVENT_STATE,
            },
            note: NOTE,
            postedAt: POSTED_AT_TEXT,
            page: { id: STATUS_PAGE_ID.toString(), name: "Acme Status" },
            links: [DETAILS_URL, STATUS_PAGE_URL, UNSUBSCRIBE_URL],
            resources: "Primary database",
          },
        ]);
        expect(warnings()).toEqual([]);
      });

      test("keeps quotes, backslashes and newlines intact", async () => {
        const trickyTitle: string = 'Upgrade "EU" \\ primary $& 100%';
        const trickyDescription: string =
          'Runs C:\\tools\\upgrade.exe\nthen "verifies"\t{{title}}';
        const trickyNote: string =
          'Line one\nLine "two" with C:\\path\\ and a tab\there\r\nend {{note}}';

        storedEvent = scheduledEvent({
          title: trickyTitle,
          description: trickyDescription,
        });
        tc.queue([publicNote({ note: trickyNote })]);
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Webhook]: {
            templateBody:
              '{"title": "{{scheduledMaintenanceTitle}}", "description": "{{scheduledMaintenanceDescription}}", "note": "{{note}}", "state": "{{scheduledMaintenanceState}}"}',
          },
        });

        await runJob(tc.job);

        const expected: JSONObject = {
          title: trickyTitle,
          description: trickyDescription,
          note: trickyNote,
          state: EVENT_STATE,
        };

        expect(sentWebhooks()).toEqual([expected]);
        expect(JSON.parse(JSON.stringify(sentWebhooks()[0]))).toEqual(expected);
        expect(warnings()).toEqual([]);
      });

      test.each([
        [
          "an unquoted text variable",
          '{"title": {{scheduledMaintenanceTitle}}, "note": "{{note}}"}',
        ],
        [
          "text that is not JSON at all",
          "Maintenance {{scheduledMaintenanceTitle}} updated",
        ],
        [
          "a missing closing brace",
          '{"title": "{{scheduledMaintenanceTitle}}"',
        ],
        ["a JSON array", '[{"title": "{{scheduledMaintenanceTitle}}"}]'],
        ["a JSON string", '"{{scheduledMaintenanceTitle}}"'],
      ])(
        "falls back to the default payload and warns for %s",
        async (_label: string, templateBody: string) => {
          useCustomTemplates({
            [StatusPageSubscriberNotificationMethod.Webhook]: {
              templateBody: templateBody,
            },
          });

          await runJob(tc.job);
          await flushPromises();

          expect(sentWebhooks()).toEqual([
            defaultWebhookPayload(tc.webhookEventType),
          ]);
          expect(warnings()).toHaveLength(1);
          expect(warnings()[0]).toContain(STATUS_PAGE_ID.toString());
          expect(warnings()[0]).toContain(tc.webhookEventType);

          // The other channels and the job itself are unaffected.
          expectDefaultTextChannels();
          expect(statusWrites()[statusWrites().length - 1]).toEqual(
            tc.successWrite,
          );
        },
      );

      test("sends the default payload for an empty template body", async () => {
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Webhook]: {
            templateBody: "",
          },
        });

        await runJob(tc.job);

        expect(sentWebhooks()).toEqual([
          defaultWebhookPayload(tc.webhookEventType),
        ]);
        expect(warnings()).toEqual([]);
      });

      test("leaves Email, SMS, Slack and Teams on their defaults", async () => {
        useStatusPages([
          statusPage({ withSmtpConfig: true, withCallSmsConfig: true }),
        ]);
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Webhook]: {
            templateBody: '{"custom": "{{scheduledMaintenanceTitle}}"}',
          },
        });

        await runJob(tc.job);

        expect(sentWebhooks()).toEqual([{ custom: EVENT_TITLE }]);
        expectDefaultTextChannels();
        expect(sentMail()[0]!["subject"]).toBe(tc.emailSubject);
      });

      test("fills each subscriber's own unsubscribe link and the raw markdown note and description", async () => {
        useTwoSubscribers();
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Webhook]: {
            templateBody:
              '{"note": "{{note}}", "description": "{{scheduledMaintenanceDescription}}", "unsubscribeUrl": "{{unsubscribeUrl}}"}',
          },
        });

        await runJob(tc.job);

        // Not the SMS plain text or the email HTML.
        expect(sentWebhooks()).toEqual([
          {
            note: NOTE,
            description: EVENT_DESCRIPTION,
            unsubscribeUrl: unsubscribeUrlFor(SUBSCRIBER_ID),
          },
          {
            note: NOTE,
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

        await runJob(tc.job);

        expect(sentWebhooks()).toEqual([{ custom: EVENT_STATE }]);
      });
    });

    describe("every template variable is provided", () => {
      test("in a custom Email template (custom SMTP)", async () => {
        useStatusPages([statusPage({ withSmtpConfig: true })]);
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Email]: {
            templateBody: everyVariableTextTemplate(tc.event),
            emailSubject: everyVariableTextTemplate(tc.event),
          },
        });

        await runJob(tc.job);

        expect(sentMail()).toHaveLength(1);
        expect(sentMail()[0]!["templateType"]).toBe(
          EmailTemplateType.BlankTemplate,
        );

        const body: string = (sentMail()[0]!["vars"] as JSONObject)[
          "body"
        ] as string;

        expectEveryVariableFilled(body, tc.event, expectedVariables());
        expectEveryVariableFilled(
          sentMail()[0]!["subject"] as string,
          tc.event,
          expectedVariables(),
        );
      });

      test("in a custom SMS template (custom SMS config), with the note and description as plain text", async () => {
        useStatusPages([statusPage({ withCallSmsConfig: true })]);
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.SMS]: {
            templateBody: everyVariableTextTemplate(tc.event),
          },
        });

        await runJob(tc.job);

        expect(sentSms()).toHaveLength(1);
        expectEveryVariableFilled(
          sentSms()[0]!,
          tc.event,
          expectedSmsVariables(),
        );
        expect(sentSms()[0]).not.toContain("**");
      });

      test("in a custom Slack template", async () => {
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Slack]: {
            templateBody: everyVariableTextTemplate(tc.event),
          },
        });

        await runJob(tc.job);

        expect(sentSlack()).toHaveLength(1);
        expectEveryVariableFilled(
          sentSlack()[0]!,
          tc.event,
          expectedVariables(),
        );
      });

      test("in a custom Microsoft Teams template", async () => {
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
            templateBody: everyVariableTextTemplate(tc.event),
          },
        });

        await runJob(tc.job);

        expect(sentTeams()).toHaveLength(1);
        expectEveryVariableFilled(
          sentTeams()[0]!,
          tc.event,
          expectedVariables(),
        );
      });

      test("in a custom Webhook template", async () => {
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Webhook]: {
            templateBody: everyVariableWebhookTemplate(tc.event),
          },
        });

        await runJob(tc.job);

        const expected: Record<string, string> = expectedVariables();
        const names: Array<string> =
          SubscriberNotificationTemplateVariables.getVariableNames(tc.event);

        expect(sentWebhooks()).toHaveLength(1);
        expect(Object.keys(sentWebhooks()[0]!).sort()).toEqual(
          [...names].sort(),
        );
        for (const name of names) {
          expect(sentWebhooks()[0]![name]).toBe(expected[name]);
        }
        expect(JSON.stringify(sentWebhooks()[0])).not.toContain("{{");
        expect(warnings()).toEqual([]);
      });

      test("fills the ids, description, resources, state and posting time with their real values", async () => {
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Slack]: {
            templateBody:
              "{{statusPageId}}|{{scheduledMaintenanceId}}|{{scheduledMaintenanceDescription}}|{{resourcesAffected}}|{{scheduledMaintenanceState}}|{{postedAt}}",
          },
        });

        await runJob(tc.job);

        expect(sentSlack()).toEqual([
          `${STATUS_PAGE_ID.toString()}|${EVENT_ID.toString()}|${EVENT_DESCRIPTION}|Primary database|${EVENT_STATE}|${POSTED_AT_TEXT}`,
        ]);
        expect(POSTED_AT_TEXT).toContain("2026");
      });

      test("keeps custom Email and SMS templates off without custom SMTP and SMS config", async () => {
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Email]: {
            templateBody: everyVariableTextTemplate(tc.event),
          },
          [StatusPageSubscriberNotificationMethod.SMS]: {
            templateBody: everyVariableTextTemplate(tc.event),
          },
        });

        await runJob(tc.job);

        expect(sentMail()[0]!["templateType"]).toBe(tc.emailTemplateType);
        expect(sentSms()).toEqual([
          dashboardDefault(
            tc.event,
            StatusPageSubscriberNotificationMethod.SMS,
          ),
        ]);
      });

      test("falls back to the trigger's subject for a custom email template without one", async () => {
        useStatusPages([statusPage({ withSmtpConfig: true })]);
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Email]: {
            templateBody: "<p>{{scheduledMaintenanceState}}: {{note}}</p>",
          },
        });

        await runJob(tc.job);

        expect(sentMail()[0]!["templateType"]).toBe(
          EmailTemplateType.BlankTemplate,
        );
        expect(sentMail()[0]!["subject"]).toBe(tc.customEmailSubject);
        expect(sentMail()[0]!["vars"]).toEqual({
          body: `<p>${EVENT_STATE}: ${NOTE}</p>`,
        });
      });

      test("joins every resource of the status page into resourcesAffected", async () => {
        mock(StatusPageResourceService.findAllBy).mockResolvedValue([
          resource("Primary database"),
          resource("Read replica"),
        ] as never);
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
            templateBody: "Affected: {{resourcesAffected}}",
          },
        });

        await runJob(tc.job);

        expect(sentTeams()).toEqual([
          "Affected: Primary database, Read replica",
        ]);
        expect(
          (sentWebhooks()[0]!["data"] as JSONObject)["resourcesAffected"],
        ).toBe("Primary database, Read replica");
        expect(
          (sentMail()[0]!["vars"] as JSONObject)["resourcesAffected"],
        ).toBe("Primary database, Read replica");
      });
    });

    describe("maintenance state (regression)", () => {
      test("fills scheduledMaintenanceState with the event's current state, not its start date", async () => {
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Slack]: {
            templateBody: "State: {{scheduledMaintenanceState}}",
          },
          [StatusPageSubscriberNotificationMethod.Webhook]: {
            templateBody: '{"state": "{{scheduledMaintenanceState}}"}',
          },
        });

        await runJob(tc.job);

        expect(sentSlack()).toEqual([`State: ${EVENT_STATE}`]);
        expect(sentWebhooks()).toEqual([{ state: EVENT_STATE }]);
        expect(sentSlack()[0]).not.toContain(STARTS_AT_TEXT);
      });

      test("leaves scheduledMaintenanceState empty when the event has no current state", async () => {
        storedEvent = scheduledEvent({ withoutState: true });
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
            templateBody: "State: [{{scheduledMaintenanceState}}]",
          },
          [StatusPageSubscriberNotificationMethod.Webhook]: {
            templateBody: '{"state": "{{scheduledMaintenanceState}}"}',
          },
        });

        await runJob(tc.job);

        expect(sentTeams()).toEqual(["State: []"]);
        expect(sentWebhooks()).toEqual([{ state: "" }]);
      });

      test("selects the event's current state name and description", async () => {
        await runJob(tc.job);

        const eventArgs: { select: JSONObject } = mock(
          ScheduledMaintenanceService.findOneById,
        ).mock.calls[0]![0] as { select: JSONObject };

        expect(eventArgs.select["currentScheduledMaintenanceState"]).toEqual({
          name: true,
        });
        expect(eventArgs.select["description"]).toBe(true);
        expect(eventArgs.select["title"]).toBe(true);
        expect(eventArgs.select["startsAt"]).toBe(true);
      });
    });

    describe("posting time (regression)", () => {
      test("uses the note's postedAt rather than the time the job ran", async () => {
        const clock: ClockSpy = stopClockAtJobRun();

        try {
          useCustomTemplates({
            [StatusPageSubscriberNotificationMethod.Slack]: {
              templateBody: "Posted {{postedAt}}",
            },
            [StatusPageSubscriberNotificationMethod.Webhook]: {
              templateBody: '{"postedAt": "{{postedAt}}"}',
            },
          });

          await runJob(tc.job);
        } finally {
          clock.mockRestore();
        }

        expect(POSTED_AT_TEXT).not.toBe(JOB_RAN_AT_TEXT);
        expect(sentSlack()).toEqual([`Posted ${POSTED_AT_TEXT}`]);
        expect(sentWebhooks()).toEqual([{ postedAt: POSTED_AT_TEXT }]);
      });

      test("falls back to the current date when the note has no postedAt", async () => {
        tc.queue([publicNote({ withoutPostedAt: true })]);

        const clock: ClockSpy = stopClockAtJobRun();

        try {
          useCustomTemplates({
            [StatusPageSubscriberNotificationMethod.Webhook]: {
              templateBody: '{"postedAt": "{{postedAt}}"}',
            },
          });

          await runJob(tc.job);
        } finally {
          clock.mockRestore();
        }

        expect(sentWebhooks()).toEqual([{ postedAt: JOB_RAN_AT_TEXT }]);
      });

      test("selects the note's postedAt", async () => {
        await runJob(tc.job);

        const findArgs: { select: JSONObject } = mock(
          ScheduledMaintenancePublicNoteService.findAllBy,
        ).mock.calls[0]![0] as { select: JSONObject };

        expect(findArgs.select["postedAt"]).toBe(true);
        expect(findArgs.select["note"]).toBe(true);
        expect(findArgs.select["scheduledMaintenanceId"]).toBe(true);
      });
    });

    describe("failure isolation", () => {
      test("a rejected webhook send does not stop other channels or subscribers, or fail the job", async () => {
        useTwoSubscribers();
        mock(
          StatusPageSubscriberWebhookUtil.sendWebhookNotification,
        ).mockRejectedValue(new Error("webhook down") as never);

        await expect(runJob(tc.job)).resolves.toBeUndefined();
        await flushPromises();

        expect(sentWebhooks()).toHaveLength(2);
        expect(sentMail()).toHaveLength(2);
        expect(sentSms()).toHaveLength(2);
        expect(sentSlack()).toHaveLength(2);
        expect(sentTeams()).toHaveLength(2);
        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ message: "webhook down" }),
          expect.anything(),
        );
        expect(statusWrites()[statusWrites().length - 1]).toEqual(
          tc.successWrite,
        );
        expect(feedItems()).toHaveLength(1);
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

        await runJob(tc.job);
        await flushPromises();

        expect(sentWebhooks()).toEqual([{ title: EVENT_TITLE }]);
        expect(statusWrites()[statusWrites().length - 1]).toEqual(
          tc.successWrite,
        );
      });

      test("a rejected Teams send does not stop other channels or subscribers, or fail the job", async () => {
        useTwoSubscribers();
        mock(
          MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
        ).mockRejectedValue(new Error("teams down") as never);

        await expect(runJob(tc.job)).resolves.toBeUndefined();
        await flushPromises();

        expect(sentTeams()).toHaveLength(2);
        expect(sentWebhooks()).toHaveLength(2);
        expect(sentMail()).toHaveLength(2);
        expect(sentSms()).toHaveLength(2);
        expect(sentSlack()).toHaveLength(2);
        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ message: "teams down" }),
          expect.anything(),
        );
        expect(statusWrites()[statusWrites().length - 1]).toEqual(
          tc.successWrite,
        );
      });

      test("a failed template lookup marks the job Failed without sending anything", async () => {
        mock(
          StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
        ).mockRejectedValue(new Error("template lookup failed") as never);

        await runJob(tc.job);

        nothingSent();
        const lastWrite: JSONObject =
          statusWrites()[statusWrites().length - 1]!;
        expect(Object.values(lastWrite)).toEqual([
          StatusPageSubscriberNotificationStatus.Failed,
          "template lookup failed",
        ]);
      });
    });
  },
);
