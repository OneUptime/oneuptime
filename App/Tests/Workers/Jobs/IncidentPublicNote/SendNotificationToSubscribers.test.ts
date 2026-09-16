import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Monitor from "Common/Models/DatabaseModels/Monitor";
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
 * Incident public note subscriber notifications: the "note posted" job and
 * the new "note updated" job share one send path. These tests drive a tick of
 * each against fakes and check what subscribers receive, which status columns
 * are written, and what lands in the incident feed.
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

jest.mock("Common/Server/Services/IncidentPublicNoteService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/IncidentService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      getIncidentLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentFeedService", () => {
  return { __esModule: true, default: { createIncidentFeedItem: jest.fn() } };
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
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import IncidentPublicNoteService from "Common/Server/Services/IncidentPublicNoteService";
import IncidentService from "Common/Server/Services/IncidentService";
import MailService from "Common/Server/Services/MailService";
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
import "../../../../FeatureSet/Workers/Jobs/IncidentPublicNote/SendNotificationToSubscribers";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const CREATED_JOB: string = "IncidentPublicNote:SendNotificationToSubscribers";
const UPDATED_JOB: string =
  "IncidentPublicNote:SendUpdateNotificationToSubscribers";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const NOTE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const SECOND_NOTE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
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
const DETAILS_URL: string = `${STATUS_PAGE_URL}/incidents/${INCIDENT_ID.toString()}`;
const UNSUBSCRIBE_URL: string = `${STATUS_PAGE_URL}/update-subscription/${SUBSCRIBER_ID.toString()}`;
const DASHBOARD_URL: string = "https://oneuptime.acme.com/dashboard/incident/1";

const INCIDENT_TITLE: string = "Checkout requests failing";
const NOTE: string = "Traffic moved to the **standby** region.";
const NOTE_HTML: string =
  "<p>Traffic moved to the <strong>standby</strong> region.</p>";
const NOTE_TEXT: string = "Traffic moved to the standby region.";
const INCIDENT_STATE: string = "Investigating";
const WEBHOOK_URL: string = "https://hooks.acme.com/status";

// When the note says it was posted, and a clearly different "now".
const POSTED_AT: Date = new Date("2026-03-04T05:06:07.000Z");
const JOB_RAN_AT: Date = new Date("2031-11-12T13:14:15.000Z");
const POSTED_AT_TEXT: string =
  OneUptimeDate.getDateAsUserFriendlyFormattedString(POSTED_AT);
const JOB_RAN_AT_TEXT: string =
  OneUptimeDate.getDateAsUserFriendlyFormattedString(JOB_RAN_AT);

const ALL_METHODS: Array<StatusPageSubscriberNotificationMethod> = [
  StatusPageSubscriberNotificationMethod.Email,
  StatusPageSubscriberNotificationMethod.SMS,
  StatusPageSubscriberNotificationMethod.Slack,
  StatusPageSubscriberNotificationMethod.MicrosoftTeams,
  StatusPageSubscriberNotificationMethod.Webhook,
];

let createdNotes: Array<IncidentPublicNote> = [];
let updatedNotes: Array<IncidentPublicNote> = [];
let storedIncident: Incident | null = null;

function publicNote(overrides?: {
  id?: ObjectID;
  subscriberNotificationStatusOnNoteCreated?: StatusPageSubscriberNotificationStatus;
  note?: string;
  withoutPostedAt?: boolean;
}): IncidentPublicNote {
  const note: IncidentPublicNote = new IncidentPublicNote();
  note._id = (overrides?.id || NOTE_ID).toString();
  note.note = overrides?.note ?? NOTE;
  note.incidentId = INCIDENT_ID;
  note.projectId = PROJECT_ID;
  if (!overrides?.withoutPostedAt) {
    note.postedAt = POSTED_AT;
  }
  note.subscriberNotificationStatusOnNoteCreated =
    overrides?.subscriberNotificationStatusOnNoteCreated ||
    StatusPageSubscriberNotificationStatus.Success;
  return note;
}

function incident(overrides?: {
  isVisibleOnStatusPage?: boolean;
  withoutMonitors?: boolean;
  withoutState?: boolean;
  title?: string;
}): Incident {
  const row: Incident = new Incident();
  row._id = INCIDENT_ID.toString();
  row.title = overrides?.title ?? INCIDENT_TITLE;
  row.description = "Payments fail in Europe.";
  row.projectId = PROJECT_ID;
  row.isVisibleOnStatusPage = overrides?.isVisibleOnStatusPage !== false;
  row.incidentNumber = 7;
  row.incidentNumberWithPrefix = "INC-7";

  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical";
  row.incidentSeverity = severity;

  if (!overrides?.withoutState) {
    const state: IncidentState = new IncidentState();
    state.name = INCIDENT_STATE;
    row.currentIncidentState = state;
  }

  if (!overrides?.withoutMonitors) {
    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID.toString();
    row.monitors = [monitor];
  } else {
    row.monitors = [];
  }

  return row;
}

function statusPage(overrides?: {
  showIncidentsOnStatusPage?: boolean;
  withSmtpConfig?: boolean;
  withCallSmsConfig?: boolean;
}): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID.toString();
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  page.pageTitle = "Acme Status";
  page.isPublicStatusPage = true;
  page.showIncidentsOnStatusPage =
    overrides?.showIncidentsOnStatusPage !== false;
  if (overrides?.withSmtpConfig) {
    (page as unknown as JSONObject)["smtpConfig"] = { _id: "smtp" };
  }
  if (overrides?.withCallSmsConfig) {
    (page as unknown as JSONObject)["callSmsConfig"] = { _id: "sms" };
  }
  return page;
}

function resource(): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = "88888888-8888-4888-8888-888888888888";
  row.statusPageId = STATUS_PAGE_ID;
  row.displayName = "Checkout API";
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
  return mock(IncidentPublicNoteService.updateOneById).mock.calls.map(
    (call: Array<unknown>): JSONObject => {
      return (call[0] as { data: JSONObject }).data;
    },
  );
}

function writesFor(id: ObjectID): Array<JSONObject> {
  return mock(IncidentPublicNoteService.updateOneById)
    .mock.calls.filter((call: Array<unknown>): boolean => {
      return (call[0] as { id: ObjectID }).id.toString() === id.toString();
    })
    .map((call: Array<unknown>): JSONObject => {
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

/*
 * The per-subscriber values the job fills in for Email, Slack, Teams and
 * Webhook templates (SMS gets the note as plain text instead).
 */
function expectedVariables(overrides?: {
  unsubscribeUrl?: string;
  note?: string;
}): Record<string, string> {
  return {
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    statusPageId: STATUS_PAGE_ID.toString(),
    unsubscribeUrl: overrides?.unsubscribeUrl ?? UNSUBSCRIBE_URL,
    resourcesAffected: "Checkout API",
    incidentId: INCIDENT_ID.toString(),
    incidentNumber: "7",
    incidentTitle: INCIDENT_TITLE,
    incidentSeverity: "Critical",
    incidentState: INCIDENT_STATE,
    postedAt: POSTED_AT_TEXT,
    note: overrides?.note ?? NOTE,
    detailsUrl: DETAILS_URL,
  };
}

// The payload webhook subscribers have always received for a note.
function defaultWebhookPayload(
  webhookEventType: string,
  overrides?: {
    unsubscribeUrl?: string;
    incidentTitle?: string;
    note?: string;
  },
): JSONObject {
  return {
    eventType: webhookEventType,
    statusPageId: STATUS_PAGE_ID.toString(),
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    unsubscribeUrl: overrides?.unsubscribeUrl ?? UNSUBSCRIBE_URL,
    data: {
      incidentId: INCIDENT_ID.toString(),
      incidentNumber: "7",
      incidentTitle: overrides?.incidentTitle ?? INCIDENT_TITLE,
      incidentSeverity: "Critical",
      resourcesAffected: "Checkout API",
      note: overrides?.note ?? NOTE,
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

function feedItems(): Array<JSONObject> {
  return mock(IncidentFeedService.createIncidentFeedItem).mock.calls.map(
    (call: Array<unknown>): JSONObject => {
      return call[0] as JSONObject;
    },
  );
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
  storedIncident = incident();

  mock(IncidentPublicNoteService.findBy).mockImplementation(
    async (args: unknown): Promise<Array<IncidentPublicNote>> => {
      const query: JSONObject = (args as { query: JSONObject }).query;

      return query["subscriberNotificationStatusOnNoteUpdated"]
        ? updatedNotes
        : createdNotes;
    },
  );
  mock(IncidentPublicNoteService.updateOneById).mockResolvedValue(1 as never);

  mock(IncidentService.findOneById).mockImplementation(async () => {
    return storedIncident;
  });
  mock(IncidentService.getIncidentLinkInDashboard).mockResolvedValue(
    URL.fromString(DASHBOARD_URL) as never,
  );
  mock(IncidentFeedService.createIncidentFeedItem).mockResolvedValue(
    undefined as never,
  );

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

  mock(Markdown.convertToHTML).mockResolvedValue(NOTE_HTML as never);
  mock(Markdown.convertToPlainText).mockReturnValue(NOTE_TEXT);

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

describe("IncidentPublicNote:SendUpdateNotificationToSubscribers", () => {
  test("is registered next to the created job", () => {
    expect(mockCapturedJobs[UPDATED_JOB]).toBeDefined();
    expect(mockCapturedJobs[CREATED_JOB]).toBeDefined();
  });

  test("looks only for notes with a pending update notification and reads the original status", async () => {
    await runJob(UPDATED_JOB);

    const args: { query: JSONObject; select: JSONObject } = mock(
      IncidentPublicNoteService.findBy,
    ).mock.calls[0]![0] as { query: JSONObject; select: JSONObject };

    expect(args.query).toEqual({
      subscriberNotificationStatusOnNoteUpdated:
        StatusPageSubscriberNotificationStatus.Pending,
    });
    expect(args.select["subscriberNotificationStatusOnNoteCreated"]).toBe(true);
    expect(args.select["note"]).toBe(true);
    expect(args.select["incidentId"]).toBe(true);
  });

  test("does not resolve the host when nothing is pending", async () => {
    await runJob(UPDATED_JOB);

    expect(DatabaseConfig.getHost).not.toHaveBeenCalled();
    nothingSent();
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
      expect(IncidentService.findOneById).not.toHaveBeenCalled();
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
      EmailTemplateType.SubscriberIncidentNoteUpdated,
    );
    expect(sentMail()[0]!["subject"]).toBe(
      `[Incident Note Updated] ${INCIDENT_TITLE}`,
    );
    expect(sentMail()[0]!["vars"]).toEqual(
      expect.objectContaining({
        note: NOTE_HTML,
        incidentTitle: INCIDENT_TITLE,
        incidentSeverity: "Critical",
        resourcesAffected: "Checkout API",
        detailsUrl: DETAILS_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
      }),
    );
  });

  test("uses the update wording on SMS, Slack and Teams, matching the dashboard defaults", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    expect(sentSms()).toEqual([
      `Incident update: ${INCIDENT_TITLE} on Acme Status. A note has been updated. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
    ]);

    const event: StatusPageSubscriberNotificationEventType =
      StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteUpdated;

    expect(sentSms()[0]).toBe(
      dashboardDefault(event, StatusPageSubscriberNotificationMethod.SMS),
    );
    expect(sentSlack()[0]).toContain(
      "**A note on this incident has been updated**",
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

  test("tells webhook subscribers it is an IncidentNoteUpdated event with the latest note", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    expect(sentWebhooks()).toHaveLength(1);
    expect(sentWebhooks()[0]!["eventType"]).toBe("IncidentNoteUpdated");
    expect(sentWebhooks()[0]!["data"]).toEqual({
      incidentId: INCIDENT_ID.toString(),
      incidentNumber: "7",
      incidentTitle: INCIDENT_TITLE,
      incidentSeverity: "Critical",
      resourcesAffected: "Checkout API",
      note: NOTE,
      detailsUrl: DETAILS_URL,
    });
  });

  test("looks up custom templates for the updated event", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    const lookups: Array<JSONObject> = templateLookups();

    expect(lookups).toHaveLength(5);
    for (const lookup of lookups) {
      expect(lookup["eventType"]).toBe(
        StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteUpdated,
      );
      expect((lookup["statusPageId"] as ObjectID).toString()).toBe(
        STATUS_PAGE_ID.toString(),
      );
    }
  });

  test("records in the incident feed that subscribers were told about an edited note", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    expect(feedItems()).toHaveLength(1);
    expect(feedItems()[0]!["feedInfoInMarkdown"]).toBe(
      `📧 **Notification sent to subscribers** because a public note was updated on this [Incident INC-7](${DASHBOARD_URL}).`,
    );
    expect(feedItems()[0]!["moreInformationInMarkdown"]).toContain(NOTE);
  });

  test("records in the feed when no subscriber matched the edited note", async () => {
    updatedNotes = [publicNote()];
    mock(StatusPageSubscriberService.shouldSendNotification).mockReturnValue(
      false,
    );

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(feedItems()[0]!["feedInfoInMarkdown"]).toBe(
      `📧 **No notification sent to subscribers** for the updated public note on [Incident INC-7](${DASHBOARD_URL}).`,
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

  test("writes its status without hooks so it never re-queues itself", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    for (const call of mock(IncidentPublicNoteService.updateOneById).mock
      .calls) {
      expect((call[0] as JSONObject)["props"]).toEqual({
        isRoot: true,
        ignoreHooks: true,
      });
    }
  });

  test("skips the update when the incident is no longer visible on the status page", async () => {
    updatedNotes = [publicNote()];
    storedIncident = incident({ isVisibleOnStatusPage: false });

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(statusWrites()[statusWrites().length - 1]).toEqual({
      subscriberNotificationStatusOnNoteUpdated:
        StatusPageSubscriberNotificationStatus.Skipped,
      subscriberNotificationStatusMessageOnNoteUpdated:
        "Notifications skipped as incident is not visible on status page.",
    });
  });

  test("skips the update when the incident has been deleted", async () => {
    updatedNotes = [publicNote()];
    storedIncident = null;

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatusOnNoteUpdated:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessageOnNoteUpdated:
          "Related incident not found. Skipping notifications to subscribers.",
      },
    ]);
  });

  test("skips the update when the incident has no monitors", async () => {
    updatedNotes = [publicNote()];
    storedIncident = incident({ withoutMonitors: true });

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(
      statusWrites()[0]!["subscriberNotificationStatusOnNoteUpdated"],
    ).toBe(StatusPageSubscriberNotificationStatus.Skipped);
  });

  test("respects a status page that hides incidents", async () => {
    updatedNotes = [publicNote()];
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([
      statusPage({ showIncidentsOnStatusPage: false }),
    ] as never);

    await runJob(UPDATED_JOB);

    nothingSent();
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

  test("handles each note on its own in a multi-note tick", async () => {
    updatedNotes = [
      publicNote({
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.Pending,
      }),
      publicNote({ id: SECOND_NOTE_ID }),
    ];

    await runJob(UPDATED_JOB);

    expect(writesFor(NOTE_ID)).toHaveLength(1);
    expect(
      writesFor(SECOND_NOTE_ID).map((write: JSONObject) => {
        return write["subscriberNotificationStatusOnNoteUpdated"];
      }),
    ).toEqual([
      StatusPageSubscriberNotificationStatus.InProgress,
      StatusPageSubscriberNotificationStatus.Success,
    ]);
    expect(sentMail()).toHaveLength(1);
  });

  test("keeps going after one note's status write fails", async () => {
    updatedNotes = [
      publicNote({
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.Pending,
      }),
      publicNote({ id: SECOND_NOTE_ID }),
    ];

    mock(IncidentPublicNoteService.updateOneById).mockRejectedValueOnce(
      new Error("database hiccup") as never,
    );

    await expect(runJob(UPDATED_JOB)).resolves.toBeUndefined();

    expect(sentMail()).toHaveLength(1);
    expect(
      writesFor(SECOND_NOTE_ID).map((write: JSONObject) => {
        return write["subscriberNotificationStatusOnNoteUpdated"];
      }),
    ).toEqual([
      StatusPageSubscriberNotificationStatus.InProgress,
      StatusPageSubscriberNotificationStatus.Success,
    ]);
  });
});

describe("IncidentPublicNote:SendNotificationToSubscribers (created)", () => {
  test("still only picks up notes whose author asked to notify", async () => {
    await runJob(CREATED_JOB);

    const query: JSONObject = (
      mock(IncidentPublicNoteService.findBy).mock.calls[0]![0] as {
        query: JSONObject;
      }
    ).query;

    expect(query).toEqual({
      subscriberNotificationStatusOnNoteCreated:
        StatusPageSubscriberNotificationStatus.Pending,
      shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true,
    });
  });

  test("sends the new-note messages it always has", async () => {
    createdNotes = [
      publicNote({
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.Pending,
      }),
    ];

    await runJob(CREATED_JOB);

    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberIncidentNoteCreated,
    );
    expect(sentMail()[0]!["subject"]).toBe(
      `[Update Incident] ${INCIDENT_TITLE}`,
    );
    expect(sentSms()[0]).toBe(
      `Incident update: ${INCIDENT_TITLE} on Acme Status. A new note is posted. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
    );
    expect(sentSlack()[0]).toContain(
      "**New note has been added to an incident**",
    );
    expect(sentWebhooks()[0]!["eventType"]).toBe("IncidentNoteCreated");
    expect(feedItems()[0]!["feedInfoInMarkdown"]).toContain(
      "because a public note is added to this [Incident INC-7]",
    );
  });

  test("still matches the dashboard's created defaults", async () => {
    createdNotes = [publicNote()];

    await runJob(CREATED_JOB);

    const event: StatusPageSubscriberNotificationEventType =
      StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated;

    expect(sentSms()[0]).toBe(
      dashboardDefault(event, StatusPageSubscriberNotificationMethod.SMS),
    );
    expect(sentSlack()[0]).toBe(
      dashboardDefault(event, StatusPageSubscriberNotificationMethod.Slack),
    );
  });

  test("uses a custom email template's subject fallback for new notes", async () => {
    createdNotes = [publicNote()];

    const page: StatusPage = statusPage();
    (page as unknown as JSONObject)["smtpConfig"] = { _id: "smtp" };
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([page] as never);
    mock(
      StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
    ).mockImplementation(async (args: unknown) => {
      return (args as JSONObject)["notificationMethod"] ===
        StatusPageSubscriberNotificationMethod.Email
        ? { templateBody: "<p>{{note}}</p>" }
        : null;
    });

    await runJob(CREATED_JOB);

    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.BlankTemplate,
    );
    expect(sentMail()[0]!["subject"]).toBe(
      `[Incident Update] ${INCIDENT_TITLE}`,
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

  test("marks the original notification Failed when sending breaks", async () => {
    createdNotes = [publicNote()];
    mock(Markdown.convertToHTML).mockRejectedValue(
      new Error("markdown exploded") as never,
    );

    await runJob(CREATED_JOB);

    expect(statusWrites()[statusWrites().length - 1]).toEqual({
      subscriberNotificationStatusOnNoteCreated:
        StatusPageSubscriberNotificationStatus.Failed,
      subscriberNotificationStatusMessage: "markdown exploded",
    });
  });
});

describe("IncidentPublicNote update job, with a custom update email template", () => {
  test("falls back to the update subject when the template has none", async () => {
    updatedNotes = [publicNote()];

    const page: StatusPage = statusPage();
    (page as unknown as JSONObject)["smtpConfig"] = { _id: "smtp" };
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([page] as never);
    mock(
      StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
    ).mockImplementation(async (args: unknown) => {
      return (args as JSONObject)["notificationMethod"] ===
        StatusPageSubscriberNotificationMethod.Email
        ? { templateBody: "<p>Edited: {{note}}</p>" }
        : null;
    });

    await runJob(UPDATED_JOB);

    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.BlankTemplate,
    );
    expect(sentMail()[0]!["subject"]).toBe(
      `[Incident Note Updated] ${INCIDENT_TITLE}`,
    );
    expect(sentMail()[0]!["vars"]).toEqual({ body: `<p>Edited: ${NOTE}</p>` });
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
  smsSentence: string;
  chatSentence: string;
  successWrite: JSONObject;
  queue: (notes: Array<IncidentPublicNote>) => void;
}

const TRIGGER_CASES: Array<TriggerCase> = [
  {
    name: "created",
    job: CREATED_JOB,
    event:
      StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated,
    webhookEventType: "IncidentNoteCreated",
    emailTemplateType: EmailTemplateType.SubscriberIncidentNoteCreated,
    emailSubject: `[Update Incident] ${INCIDENT_TITLE}`,
    smsSentence: "A new note is posted.",
    chatSentence: "New note has been added to an incident",
    successWrite: {
      subscriberNotificationStatusOnNoteCreated:
        StatusPageSubscriberNotificationStatus.Success,
      subscriberNotificationStatusMessage:
        "Notifications sent successfully to all subscribers",
    },
    queue: (notes: Array<IncidentPublicNote>): void => {
      createdNotes = notes;
    },
  },
  {
    name: "updated",
    job: UPDATED_JOB,
    event:
      StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteUpdated,
    webhookEventType: "IncidentNoteUpdated",
    emailTemplateType: EmailTemplateType.SubscriberIncidentNoteUpdated,
    emailSubject: `[Incident Note Updated] ${INCIDENT_TITLE}`,
    smsSentence: "A note has been updated.",
    chatSentence: "A note on this incident has been updated",
    successWrite: {
      subscriberNotificationStatusOnNoteUpdated:
        StatusPageSubscriberNotificationStatus.Success,
      subscriberNotificationStatusMessageOnNoteUpdated:
        SubscriberUpdateNotification.sentMessage,
    },
    queue: (notes: Array<IncidentPublicNote>): void => {
      updatedNotes = notes;
    },
  },
];

describe.each(TRIGGER_CASES)(
  "IncidentPublicNote subscriber notification ($name)",
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

    function useStatusPage(page: StatusPage): void {
      mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mockResolvedValue([page] as never);
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
          resourcesAffected: "Checkout API",
          incidentSeverity: "Critical",
          incidentTitle: INCIDENT_TITLE,
          incidentDescription: "Payments fail in Europe.",
          unsubscribeUrl: UNSUBSCRIBE_URL,
          subscriberEmailNotificationFooterText: "Footer text",
        });
      });

      test("sends the default SMS, identical to the dashboard's SMS starter", async () => {
        await runJob(tc.job);

        expect(sentSms()).toEqual([
          `Incident update: ${INCIDENT_TITLE} on Acme Status. ${tc.smsSentence} Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
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
          incidentId: INCIDENT_ID.toString(),
          incidentNumber: "7",
          incidentTitle: INCIDENT_TITLE,
          incidentSeverity: "Critical",
          resourcesAffected: "Checkout API",
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
    });

    describe("with a custom Webhook template", () => {
      test("sends the compiled JSON object instead of the default payload", async () => {
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Webhook]: {
            templateBody: `{
  "kind": "incident-note",
  "incident": {
    "id": "{{incidentId}}",
    "number": {{incidentNumber}},
    "title": "{{incidentTitle}}",
    "state": "{{incidentState}}",
    "severity": "{{incidentSeverity}}"
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
            kind: "incident-note",
            incident: {
              id: INCIDENT_ID.toString(),
              number: 7,
              title: INCIDENT_TITLE,
              state: INCIDENT_STATE,
              severity: "Critical",
            },
            note: NOTE,
            postedAt: POSTED_AT_TEXT,
            page: { id: STATUS_PAGE_ID.toString(), name: "Acme Status" },
            links: [DETAILS_URL, STATUS_PAGE_URL, UNSUBSCRIBE_URL],
            resources: "Checkout API",
          },
        ]);
        expect(warnings()).toEqual([]);
      });

      test("keeps quotes, backslashes and newlines intact", async () => {
        const trickyTitle: string = 'Checkout "EU" \\ failing $& 100%';
        const trickyNote: string =
          'Line one\nLine "two" with C:\\path\\ and a tab\there\r\nend {{note}}';

        storedIncident = incident({ title: trickyTitle });
        tc.queue([publicNote({ note: trickyNote })]);
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Webhook]: {
            templateBody:
              '{"title": "{{incidentTitle}}", "note": "{{note}}", "state": "{{incidentState}}"}',
          },
        });

        await runJob(tc.job);

        const expected: JSONObject = {
          title: trickyTitle,
          note: trickyNote,
          state: INCIDENT_STATE,
        };

        expect(sentWebhooks()).toEqual([expected]);
        expect(JSON.parse(JSON.stringify(sentWebhooks()[0]))).toEqual(expected);
        expect(warnings()).toEqual([]);
      });

      test.each([
        [
          "an unquoted text variable",
          '{"title": {{incidentTitle}}, "note": "{{note}}"}',
        ],
        ["text that is not JSON at all", "Incident {{incidentTitle}} updated"],
        ["a missing closing brace", '{"title": "{{incidentTitle}}"'],
        ["a JSON array", '[{"title": "{{incidentTitle}}"}]'],
        ["a JSON string", '"{{incidentTitle}}"'],
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
        useStatusPage(
          statusPage({ withSmtpConfig: true, withCallSmsConfig: true }),
        );
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Webhook]: {
            templateBody: '{"custom": "{{incidentTitle}}"}',
          },
        });

        await runJob(tc.job);

        expect(sentWebhooks()).toEqual([{ custom: INCIDENT_TITLE }]);
        expectDefaultTextChannels();
        expect(sentMail()[0]!["subject"]).toBe(tc.emailSubject);
      });

      test("fills each subscriber's own unsubscribe link and the raw markdown note", async () => {
        useTwoSubscribers();
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Webhook]: {
            templateBody:
              '{"note": "{{note}}", "unsubscribeUrl": "{{unsubscribeUrl}}"}',
          },
        });

        await runJob(tc.job);

        // Not the SMS plain text or the email HTML.
        expect(sentWebhooks()).toEqual([
          { note: NOTE, unsubscribeUrl: unsubscribeUrlFor(SUBSCRIBER_ID) },
          {
            note: NOTE,
            unsubscribeUrl: unsubscribeUrlFor(SECOND_SUBSCRIBER_ID),
          },
        ]);
        expect(webhookUrls()).toEqual([WEBHOOK_URL, WEBHOOK_URL]);
      });

      test("does not need custom SMTP or SMS configuration", async () => {
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Webhook]: {
            templateBody: '{"custom": "{{incidentState}}"}',
          },
        });

        await runJob(tc.job);

        expect(sentWebhooks()).toEqual([{ custom: INCIDENT_STATE }]);
      });
    });

    describe("every template variable is provided", () => {
      test("in a custom Email template (custom SMTP)", async () => {
        useStatusPage(statusPage({ withSmtpConfig: true }));
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

      test("in a custom SMS template (custom SMS config), with the note as plain text", async () => {
        useStatusPage(statusPage({ withCallSmsConfig: true }));
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
          expectedVariables({ note: NOTE_TEXT }),
        );
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

      test("fills the ids, number, state and posting time with their real values", async () => {
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Slack]: {
            templateBody:
              "{{statusPageId}}|{{incidentId}}|{{incidentNumber}}|{{incidentState}}|{{postedAt}}",
          },
        });

        await runJob(tc.job);

        expect(sentSlack()).toEqual([
          `${STATUS_PAGE_ID.toString()}|${INCIDENT_ID.toString()}|7|${INCIDENT_STATE}|${POSTED_AT_TEXT}`,
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
    });

    describe("posting time, incident state and selects", () => {
      test("uses the note's postedAt rather than the time the job ran", async () => {
        const clock: ClockSpy = stopClockAtJobRun();

        try {
          useCustomTemplates({
            [StatusPageSubscriberNotificationMethod.Slack]: {
              templateBody: "Posted {{postedAt}}",
            },
          });

          await runJob(tc.job);
        } finally {
          clock.mockRestore();
        }

        expect(POSTED_AT_TEXT).not.toBe(JOB_RAN_AT_TEXT);
        expect(sentSlack()).toEqual([`Posted ${POSTED_AT_TEXT}`]);
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

      test("leaves incidentState empty when the incident has no current state", async () => {
        storedIncident = incident({ withoutState: true });
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
            templateBody: "State: [{{incidentState}}]",
          },
          [StatusPageSubscriberNotificationMethod.Webhook]: {
            templateBody: '{"state": "{{incidentState}}"}',
          },
        });

        await runJob(tc.job);

        expect(sentTeams()).toEqual(["State: []"]);
        expect(sentWebhooks()).toEqual([{ state: "" }]);
      });

      test("selects the note's postedAt", async () => {
        await runJob(tc.job);

        const findArgs: { select: JSONObject } = mock(
          IncidentPublicNoteService.findBy,
        ).mock.calls[0]![0] as { select: JSONObject };

        expect(findArgs.select["postedAt"]).toBe(true);
        expect(findArgs.select["note"]).toBe(true);
        expect(findArgs.select["incidentId"]).toBe(true);
      });

      test("selects the incident's current state name and number", async () => {
        await runJob(tc.job);

        const incidentArgs: { select: JSONObject } = mock(
          IncidentService.findOneById,
        ).mock.calls[0]![0] as { select: JSONObject };

        expect(incidentArgs.select["currentIncidentState"]).toEqual({
          name: true,
        });
        expect(incidentArgs.select["incidentNumber"]).toBe(true);
        expect(incidentArgs.select["incidentSeverity"]).toEqual({
          name: true,
        });
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
          expect.objectContaining({ incidentId: INCIDENT_ID.toString() }),
        );
        expect(statusWrites()[statusWrites().length - 1]).toEqual(
          tc.successWrite,
        );
        expect(feedItems()).toHaveLength(1);
      });

      test("a rejected webhook send with a custom template does not fail the job", async () => {
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Webhook]: {
            templateBody: '{"title": "{{incidentTitle}}"}',
          },
        });
        mock(
          StatusPageSubscriberWebhookUtil.sendWebhookNotification,
        ).mockRejectedValue(new Error("webhook down") as never);

        await runJob(tc.job);
        await flushPromises();

        expect(sentWebhooks()).toEqual([{ title: INCIDENT_TITLE }]);
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
          expect.objectContaining({ incidentId: INCIDENT_ID.toString() }),
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
