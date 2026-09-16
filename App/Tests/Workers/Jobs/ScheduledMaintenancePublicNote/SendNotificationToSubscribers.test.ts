import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberUpdateNotification from "Common/Types/StatusPage/SubscriberUpdateNotification";

/*
 * Scheduled maintenance public note notifications: "note posted" and the new
 * "note updated" job share one send path. A maintenance note is where a moved
 * window or a changed scope is usually announced, which is exactly the edit
 * subscribers most need to hear about.
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
const EVENT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const NOTE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

const STATUS_PAGE_URL: string = "https://status.acme.com";
const DETAILS_URL: string = `${STATUS_PAGE_URL}/scheduled-events/${EVENT_ID.toString()}`;
const UNSUBSCRIBE_URL: string = `${STATUS_PAGE_URL}/update-subscription/${SUBSCRIBER_ID.toString()}`;
const DASHBOARD_URL: string =
  "https://oneuptime.acme.com/dashboard/scheduled-maintenance/1";

const EVENT_TITLE: string = "Database engine upgrade";
const NOTE: string = "The window moved to **Sunday 02:00 UTC**.";
const NOTE_HTML: string =
  "<p>The window moved to <strong>Sunday 02:00 UTC</strong>.</p>";

let createdNotes: Array<ScheduledMaintenancePublicNote> = [];
let updatedNotes: Array<ScheduledMaintenancePublicNote> = [];
let storedEvent: ScheduledMaintenance | null = null;

function publicNote(overrides?: {
  subscriberNotificationStatusOnNoteCreated?: StatusPageSubscriberNotificationStatus;
}): ScheduledMaintenancePublicNote {
  const note: ScheduledMaintenancePublicNote =
    new ScheduledMaintenancePublicNote();
  note._id = NOTE_ID.toString();
  note.note = NOTE;
  note.scheduledMaintenanceId = EVENT_ID;
  note.subscriberNotificationStatusOnNoteCreated =
    overrides?.subscriberNotificationStatusOnNoteCreated ||
    StatusPageSubscriberNotificationStatus.Success;
  return note;
}

function scheduledEvent(overrides?: {
  isVisibleOnStatusPage?: boolean;
  withoutStatusPages?: boolean;
}): ScheduledMaintenance {
  const event: ScheduledMaintenance = new ScheduledMaintenance();
  event._id = EVENT_ID.toString();
  event.title = EVENT_TITLE;
  event.description = "The database engine will be upgraded.";
  event.projectId = PROJECT_ID;
  event.startsAt = new Date("2026-09-20T02:00:00.000Z");
  event.isVisibleOnStatusPage = overrides?.isVisibleOnStatusPage !== false;
  event.scheduledMaintenanceNumber = 12;

  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  event.monitors = [monitor];

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
  showScheduledMaintenanceEventsOnStatusPage?: boolean;
}): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID.toString();
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  page.pageTitle = "Acme Status";
  page.isPublicStatusPage = true;
  page.showScheduledMaintenanceEventsOnStatusPage =
    overrides?.showScheduledMaintenanceEventsOnStatusPage !== false;
  return page;
}

function resource(): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = "88888888-8888-4888-8888-888888888888";
  row.statusPageId = STATUS_PAGE_ID;
  row.displayName = "Primary database";
  return row;
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
    note: NOTE,
  };

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
  mock(Markdown.convertToPlainText).mockReturnValue(
    "The window moved to Sunday 02:00 UTC.",
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
        eventDescription: "The database engine will be upgraded.",
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
      scheduledMaintenanceDescription: "The database engine will be upgraded.",
      resourcesAffected: "Primary database",
      note: NOTE,
      detailsUrl: DETAILS_URL,
    });
  });

  test("looks up custom templates for the updated event", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    const lookups: Array<unknown> = mock(
      StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
    ).mock.calls.map((call: Array<unknown>): unknown => {
      return (call[0] as JSONObject)["eventType"];
    });

    expect(lookups).toEqual([
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
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([] as never);

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
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([
      statusPage({ showScheduledMaintenanceEventsOnStatusPage: false }),
    ] as never);

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
