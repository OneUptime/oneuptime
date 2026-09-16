import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "Common/Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodePublicNote from "Common/Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Monitor from "Common/Models/DatabaseModels/Monitor";
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
import SubscriberNotificationTemplateChannels from "Common/Types/StatusPage/SubscriberNotificationTemplateChannels";
import SubscriberNotificationTemplateVariables from "Common/Types/StatusPage/SubscriberNotificationTemplateVariables";
import SubscriberUpdateNotification from "Common/Types/StatusPage/SubscriberUpdateNotification";

/*
 * Incident episode public note notifications: "note posted" and the new
 * "note updated" job share one send path.
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

jest.mock("Common/Server/Services/IncidentEpisodePublicNoteService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/IncidentEpisodeService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), getEpisodeLinkInDashboard: jest.fn() },
  };
});

jest.mock("Common/Server/Services/IncidentEpisodeMemberService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/IncidentEpisodeFeedService", () => {
  return {
    __esModule: true,
    default: { createIncidentEpisodeFeedItem: jest.fn() },
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
        return "Edge network";
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
              (): string => {
                return value || "";
              },
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
import IncidentEpisodeFeedService from "Common/Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeMemberService from "Common/Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodePublicNoteService from "Common/Server/Services/IncidentEpisodePublicNoteService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import MailService from "Common/Server/Services/MailService";
import SmsService from "Common/Server/Services/SmsService";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import Markdown from "Common/Server/Types/Markdown";
import logger from "Common/Server/Utils/Logger";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
import StatusPageSubscriberWebhookTemplate from "Common/Server/Utils/StatusPageSubscriberWebhookTemplate";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import { getDefaultSubscriberNotificationTemplate } from "../../../../FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateDefaults";
import "../../../../FeatureSet/Workers/Jobs/IncidentEpisodePublicNote/SendNotificationToSubscribers";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const CREATED_JOB: string =
  "IncidentEpisodePublicNote:SendNotificationToSubscribers";
const UPDATED_JOB: string =
  "IncidentEpisodePublicNote:SendUpdateNotificationToSubscribers";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SECOND_STATUS_PAGE_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const EPISODE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const NOTE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const SECOND_SUBSCRIBER_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

const STATUS_PAGE_URL: string = "https://status.acme.com";
const DETAILS_URL: string = `${STATUS_PAGE_URL}/episodes/${EPISODE_ID.toString()}`;
const UNSUBSCRIBE_URL: string = `${STATUS_PAGE_URL}/update-subscription/${SUBSCRIBER_ID.toString()}`;
const DASHBOARD_URL: string = "https://oneuptime.acme.com/dashboard/episode/1";
const WEBHOOK_URL: string = "https://hooks.acme.com/status";
const TEAMS_URL: string = "https://outlook.office.com/webhook/abc";

const EPISODE_TITLE: string = "Regional network interruption";
const NOTE: string = "Traffic is back on the **primary** links.";
const NOTE_HTML: string =
  "<p>Traffic is back on the <strong>primary</strong> links.</p>";
const NOTE_TEXT: string = "Traffic is back on the primary links.";

// Text that breaks a hand-built JSON document unless it is escaped.
const TRICKY_TITLE: string = 'Router "edge-1" at C:\\net\\edge failed $& more';
const TRICKY_NOTE: string =
  'Line one says "hello".\nLine two has a \\ backslash.\r\n\tAnd a tab.';

let createdNotes: Array<IncidentEpisodePublicNote> = [];
let updatedNotes: Array<IncidentEpisodePublicNote> = [];
let skipNotes: Array<IncidentEpisodePublicNote> = [];
let storedEpisode: IncidentEpisode | null = null;
let memberMonitors: Array<Monitor> = [];

function publicNote(overrides?: {
  note?: string;
  subscriberNotificationStatusOnNoteCreated?: StatusPageSubscriberNotificationStatus;
}): IncidentEpisodePublicNote {
  const note: IncidentEpisodePublicNote = new IncidentEpisodePublicNote();
  note._id = NOTE_ID.toString();
  note.note = overrides?.note ?? NOTE;
  note.incidentEpisodeId = EPISODE_ID;
  note.projectId = PROJECT_ID;
  note.subscriberNotificationStatusOnNoteCreated =
    overrides?.subscriberNotificationStatusOnNoteCreated ||
    StatusPageSubscriberNotificationStatus.Success;
  return note;
}

function episode(overrides?: {
  isVisibleOnStatusPage?: boolean;
  title?: string;
  withoutSeverity?: boolean;
}): IncidentEpisode {
  const row: IncidentEpisode = new IncidentEpisode();
  row._id = EPISODE_ID.toString();
  row.title = overrides?.title ?? EPISODE_TITLE;
  row.description = "Several network incidents are being investigated.";
  row.projectId = PROJECT_ID;
  row.isVisibleOnStatusPage = overrides?.isVisibleOnStatusPage !== false;
  row.episodeNumber = 3;
  row.episodeNumberWithPrefix = "EP-3";

  if (!overrides?.withoutSeverity) {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity.name = "Major";
    row.incidentSeverity = severity;
  }

  return row;
}

function monitor(): Monitor {
  const row: Monitor = new Monitor();
  row._id = MONITOR_ID.toString();
  return row;
}

function statusPage(overrides?: {
  id?: ObjectID;
  pageTitle?: string;
  showEpisodesOnStatusPage?: boolean;
  withSmtpConfig?: boolean;
  withCallSmsConfig?: boolean;
}): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = (overrides?.id || STATUS_PAGE_ID).toString();
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  page.pageTitle = overrides?.pageTitle || "Acme Status";
  page.isPublicStatusPage = true;
  page.showEpisodesOnStatusPage = overrides?.showEpisodesOnStatusPage !== false;

  if (overrides?.withSmtpConfig) {
    (page as unknown as JSONObject)["smtpConfig"] = { _id: "smtp" };
  }

  if (overrides?.withCallSmsConfig) {
    (page as unknown as JSONObject)["callSmsConfig"] = { _id: "twilio" };
  }

  return page;
}

function resource(statusPageId?: ObjectID): StatusPageResource {
  const pageId: ObjectID = statusPageId || STATUS_PAGE_ID;
  const row: StatusPageResource = new StatusPageResource();
  row._id =
    pageId.toString() === STATUS_PAGE_ID.toString()
      ? "88888888-8888-4888-8888-888888888888"
      : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  row.statusPageId = pageId;
  row.displayName = "Edge network";
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
  row.microsoftTeamsIncomingWebhookUrl = URL.fromString(TEAMS_URL);
  row.subscriberWebhook = URL.fromString(WEBHOOK_URL);
  return row;
}

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
}

function statusWrites(): Array<JSONObject> {
  return mock(IncidentEpisodePublicNoteService.updateOneById).mock.calls.map(
    (call: Array<unknown>): JSONObject => {
      return (call[0] as { data: JSONObject }).data;
    },
  );
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

function templateLookups(): Array<JSONObject> {
  return mock(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
  ).mock.calls.map((call: Array<unknown>): JSONObject => {
    return call[0] as JSONObject;
  });
}

function feedItems(): Array<JSONObject> {
  return mock(
    IncidentEpisodeFeedService.createIncidentEpisodeFeedItem,
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
 * The per-subscriber values the job fills for an episode note: what Slack,
 * Teams, Webhook and a custom Email template receive.
 */
function expectedVariables(
  overrides?: Record<string, string>,
): Record<string, string> {
  return {
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    statusPageId: STATUS_PAGE_ID.toString(),
    unsubscribeUrl: UNSUBSCRIBE_URL,
    resourcesAffected: "Edge network",
    episodeId: EPISODE_ID.toString(),
    episodeTitle: EPISODE_TITLE,
    episodeSeverity: "Major",
    note: NOTE,
    detailsUrl: DETAILS_URL,
    ...overrides,
  };
}

function defaultWebhookPayload(
  eventType: string,
  overrides?: { episodeTitle?: string; note?: string },
): JSONObject {
  return {
    eventType: eventType,
    statusPageId: STATUS_PAGE_ID.toString(),
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    unsubscribeUrl: UNSUBSCRIBE_URL,
    data: {
      episodeId: EPISODE_ID.toString(),
      episodeTitle: overrides?.episodeTitle ?? EPISODE_TITLE,
      incidentSeverity: "Major",
      resourcesAffected: "Edge network",
      note: overrides?.note ?? NOTE,
      detailsUrl: DETAILS_URL,
    },
  };
}

function dashboardTemplate(
  eventType: StatusPageSubscriberNotificationEventType,
  method: StatusPageSubscriberNotificationMethod,
): string {
  const template: string =
    getDefaultSubscriberNotificationTemplate(eventType, method)?.body || "";
  expect(template).not.toBe("");
  return template;
}

function dashboardDefault(
  eventType: StatusPageSubscriberNotificationEventType,
  method: StatusPageSubscriberNotificationMethod,
): string {
  const variables: Record<string, string> = expectedVariables();

  return dashboardTemplate(eventType, method).replace(
    /{{\s*(\w+)\s*}}/g,
    (_match: string, key: string) => {
      return variables[key] ?? "";
    },
  );
}

// A template that prints every documented variable as name=[value], one a line.
function everyVariableTemplate(
  eventType: StatusPageSubscriberNotificationEventType,
): string {
  return SubscriberNotificationTemplateVariables.getVariableNames(eventType)
    .map((name: string): string => {
      return `${name}=[{{${name}}}]`;
    })
    .join("\n");
}

function everyVariableRendered(
  eventType: StatusPageSubscriberNotificationEventType,
  variables: Record<string, string>,
): string {
  return SubscriberNotificationTemplateVariables.getVariableNames(eventType)
    .map((name: string): string => {
      return `${name}=[${variables[name]}]`;
    })
    .join("\n");
}

// A Webhook template whose keys are every documented variable name.
function everyVariableWebhookTemplate(
  eventType: StatusPageSubscriberNotificationEventType,
): string {
  const body: Record<string, string> = {};

  for (const name of SubscriberNotificationTemplateVariables.getVariableNames(
    eventType,
  )) {
    body[name] = `{{${name}}}`;
  }

  return JSON.stringify(body, null, 2);
}

function useTemplates(
  templates: Partial<
    Record<
      StatusPageSubscriberNotificationMethod,
      { templateBody: string; emailSubject?: string }
    >
  >,
  onlyForStatusPageId?: ObjectID,
): void {
  mock(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
  ).mockImplementation(async (args: unknown) => {
    const lookup: JSONObject = args as JSONObject;

    if (
      onlyForStatusPageId &&
      (lookup["statusPageId"] as ObjectID).toString() !==
        onlyForStatusPageId.toString()
    ) {
      return null;
    }

    return (
      templates[
        lookup["notificationMethod"] as StatusPageSubscriberNotificationMethod
      ] || null
    );
  });
}

function useStatusPages(pages: Array<StatusPage>): void {
  mock(
    StatusPageSubscriberService.getStatusPagesToSendNotification,
  ).mockResolvedValue(pages as never);
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setImmediate(resolve);
  });
}

async function runJob(name: string): Promise<void> {
  expect(mockCapturedJobs[name]).toBeDefined();
  await mockCapturedJobs[name]!();
  await flushPromises();
}

beforeEach(() => {
  jest.clearAllMocks();

  createdNotes = [];
  updatedNotes = [];
  skipNotes = [];
  storedEpisode = episode();
  memberMonitors = [monitor()];

  mock(IncidentEpisodePublicNoteService.findBy).mockImplementation(
    async (args: unknown): Promise<Array<IncidentEpisodePublicNote>> => {
      const query: JSONObject = (args as { query: JSONObject }).query;

      if (query["subscriberNotificationStatusOnNoteUpdated"]) {
        return updatedNotes;
      }

      if (
        query["shouldStatusPageSubscribersBeNotifiedOnNoteCreated"] === false
      ) {
        return skipNotes;
      }

      return createdNotes;
    },
  );
  mock(IncidentEpisodePublicNoteService.updateOneById).mockResolvedValue(
    1 as never,
  );

  mock(IncidentEpisodeService.findOneById).mockImplementation(async () => {
    return storedEpisode;
  });
  mock(IncidentEpisodeService.getEpisodeLinkInDashboard).mockResolvedValue(
    URL.fromString(DASHBOARD_URL) as never,
  );
  mock(IncidentEpisodeMemberService.findBy).mockImplementation(async () => {
    const incident: Incident = new Incident();
    incident.monitors = memberMonitors;
    const member: IncidentEpisodeMember = new IncidentEpisodeMember();
    member.incident = incident;
    return [member];
  });
  mock(
    IncidentEpisodeFeedService.createIncidentEpisodeFeedItem,
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
  mock(Markdown.convertToPlainText).mockReturnValue(NOTE_TEXT);

  mock(MailService.sendMail).mockResolvedValue(undefined as never);
  mock(SmsService.sendSms).mockResolvedValue(undefined as never);
  mock(SlackUtil.sendMessageToChannelViaIncomingWebhook).mockResolvedValue(
    undefined as never,
  );
  mock(SlackUtil.convertMarkdownToSlackRichText).mockImplementation(
    (text: unknown): string => {
      return text as string;
    },
  );
  mock(
    MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
  ).mockResolvedValue(undefined as never);
  mock(
    StatusPageSubscriberWebhookUtil.sendWebhookNotification,
  ).mockResolvedValue(undefined as never);
});

describe("IncidentEpisodePublicNote:SendUpdateNotificationToSubscribers", () => {
  test("is registered next to the created job", () => {
    expect(mockCapturedJobs[UPDATED_JOB]).toBeDefined();
    expect(mockCapturedJobs[CREATED_JOB]).toBeDefined();
  });

  test("looks only for notes with a pending update notification", async () => {
    await runJob(UPDATED_JOB);

    const calls: Array<Array<unknown>> = mock(
      IncidentEpisodePublicNoteService.findBy,
    ).mock.calls as Array<Array<unknown>>;

    expect(calls).toHaveLength(1);

    const args: { query: JSONObject; select: JSONObject } = calls[0]![0] as {
      query: JSONObject;
      select: JSONObject;
    };

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
      expect(IncidentEpisodeService.findOneById).not.toHaveBeenCalled();
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
      EmailTemplateType.SubscriberEpisodeNoteUpdated,
    );
    expect(sentMail()[0]!["subject"]).toBe(
      `[Incident Note Updated] ${EPISODE_TITLE}`,
    );
    expect(sentMail()[0]!["vars"]).toEqual(
      expect.objectContaining({
        note: NOTE_HTML,
        episodeTitle: EPISODE_TITLE,
        episodeSeverity: "Major",
        resourcesAffected: "Edge network",
        detailsUrl: DETAILS_URL,
      }),
    );
  });

  test("uses the update wording on SMS, Slack and Teams, matching the dashboard defaults", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    const event: StatusPageSubscriberNotificationEventType =
      StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteUpdated;

    expect(sentSms()).toEqual([
      `Incident update: ${EPISODE_TITLE} on Acme Status. A note has been updated. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
    ]);
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

  test("tells webhook subscribers it is an EpisodeNoteUpdated event", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    expect(sentWebhooks()[0]!["eventType"]).toBe("EpisodeNoteUpdated");
    expect((sentWebhooks()[0]!["data"] as JSONObject)["note"]).toBe(NOTE);
  });

  test("looks up custom templates for the updated event", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    expect(templateLookups()).toHaveLength(5);
    for (const lookup of templateLookups()) {
      expect(lookup["eventType"]).toBe(
        StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteUpdated,
      );
      expect((lookup["statusPageId"] as ObjectID).toString()).toBe(
        STATUS_PAGE_ID.toString(),
      );
    }
  });

  test("records in the episode feed that subscribers were told about an edited note", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    expect(feedItems()[0]!["feedInfoInMarkdown"]).toBe(
      `📧 **Notification sent to subscribers** because a public note was updated on this [Episode EP-3](${DASHBOARD_URL}).`,
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

  test("skips the update when the episode is hidden from the status page", async () => {
    updatedNotes = [publicNote()];
    storedEpisode = episode({ isVisibleOnStatusPage: false });

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(statusWrites()[statusWrites().length - 1]).toEqual({
      subscriberNotificationStatusOnNoteUpdated:
        StatusPageSubscriberNotificationStatus.Skipped,
      subscriberNotificationStatusMessageOnNoteUpdated:
        "Notifications skipped as episode is not visible on status page.",
    });
  });

  test("skips the update when the episode has been deleted", async () => {
    updatedNotes = [publicNote()];
    storedEpisode = null;

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatusOnNoteUpdated:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessageOnNoteUpdated:
          "Related episode not found. Skipping notifications to subscribers.",
      },
    ]);
  });

  test("skips the update when no incident in the episode has a monitor", async () => {
    updatedNotes = [publicNote()];
    memberMonitors = [];

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatusOnNoteUpdated:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessageOnNoteUpdated:
          "No monitors are attached to the incidents in this episode. Skipping notifications.",
      },
    ]);
  });

  test("respects a status page that hides episodes", async () => {
    updatedNotes = [publicNote()];
    useStatusPages([statusPage({ showEpisodesOnStatusPage: false })]);

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(templateLookups()).toHaveLength(0);
    expect(feedItems()[0]!["feedInfoInMarkdown"]).toContain(
      "for the updated public note on [Episode EP-3]",
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

describe("IncidentEpisodePublicNote:SendNotificationToSubscribers (created)", () => {
  test("still marks notes that should not notify as Skipped on the original columns", async () => {
    skipNotes = [publicNote()];

    await runJob(CREATED_JOB);

    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessage:
          "Notifications skipped as subscribers are not to be notified for this note.",
      },
    ]);
  });

  test("sends the new-note messages it always has", async () => {
    createdNotes = [publicNote()];

    await runJob(CREATED_JOB);

    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberEpisodeNoteCreated,
    );
    expect(sentMail()[0]!["subject"]).toBe(
      `[Update Incident] ${EPISODE_TITLE}`,
    );
    expect(sentSms()[0]).toBe(
      `Incident update: ${EPISODE_TITLE} on Acme Status. A new note is posted. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
    );
    expect(sentSlack()[0]).toContain(
      "**New note has been added to an incident**",
    );
    expect(sentWebhooks()[0]!["eventType"]).toBe("EpisodeNoteCreated");
    expect(feedItems()[0]!["feedInfoInMarkdown"]).toContain(
      "because a public note is added to this [Episode EP-3]",
    );
  });

  test("still matches the dashboard's created defaults", async () => {
    createdNotes = [publicNote()];

    await runJob(CREATED_JOB);

    const event: StatusPageSubscriberNotificationEventType =
      StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteCreated;

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

  test("selects the episode id and the fields its variables read", async () => {
    createdNotes = [publicNote()];

    await runJob(CREATED_JOB);

    const select: JSONObject = (
      mock(IncidentEpisodeService.findOneById).mock.calls[0]![0] as {
        select: JSONObject;
      }
    ).select;

    expect(select).toEqual(
      expect.objectContaining({
        _id: true,
        title: true,
        incidentSeverity: { name: true },
      }),
    );
  });
});

/*
 * Everything below runs against both jobs: a new note and an edited note go
 * through the same send path, so every channel must behave the same way for
 * each, with only the wording and event names differing.
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
  successStatus: JSONObject;
  queue: (notes: Array<IncidentEpisodePublicNote>) => void;
}

const TRIGGERS: Array<TriggerCase> = [
  {
    name: "created",
    job: CREATED_JOB,
    event:
      StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteCreated,
    webhookEventType: "EpisodeNoteCreated",
    emailTemplateType: EmailTemplateType.SubscriberEpisodeNoteCreated,
    emailSubject: `[Update Incident] ${EPISODE_TITLE}`,
    smsSentence: "A new note is posted.",
    chatSentence: "New note has been added to an incident",
    successStatus: {
      subscriberNotificationStatusOnNoteCreated:
        StatusPageSubscriberNotificationStatus.Success,
      subscriberNotificationStatusMessage:
        "Notifications sent successfully to all subscribers",
    },
    queue: (notes: Array<IncidentEpisodePublicNote>): void => {
      createdNotes = notes;
    },
  },
  {
    name: "updated",
    job: UPDATED_JOB,
    event:
      StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteUpdated,
    webhookEventType: "EpisodeNoteUpdated",
    emailTemplateType: EmailTemplateType.SubscriberEpisodeNoteUpdated,
    emailSubject: `[Incident Note Updated] ${EPISODE_TITLE}`,
    smsSentence: "A note has been updated.",
    chatSentence: "A note on this incident has been updated",
    successStatus: {
      subscriberNotificationStatusOnNoteUpdated:
        StatusPageSubscriberNotificationStatus.Success,
      subscriberNotificationStatusMessageOnNoteUpdated:
        SubscriberUpdateNotification.sentMessage,
    },
    queue: (notes: Array<IncidentEpisodePublicNote>): void => {
      updatedNotes = notes;
    },
  },
];

describe.each(TRIGGERS)(
  "episode note $name: default messages",
  (trigger: TriggerCase) => {
    beforeEach(() => {
      trigger.queue([publicNote()]);
    });

    test("the test's variable map covers exactly the documented variables", () => {
      expect(Object.keys(expectedVariables()).sort()).toEqual(
        SubscriberNotificationTemplateVariables.getVariableNames(
          trigger.event,
        ).sort(),
      );
    });

    test("sends the default email with the event's template and subject", async () => {
      await runJob(trigger.job);

      expect(sentMail()).toHaveLength(1);
      expect(sentMail()[0]).toEqual({
        toEmail: new Email("customer@example.com"),
        templateType: trigger.emailTemplateType,
        vars: {
          note: NOTE_HTML,
          statusPageName: "Acme Status",
          statusPageUrl: STATUS_PAGE_URL,
          detailsUrl: DETAILS_URL,
          logoUrl: "",
          isPublicStatusPage: "true",
          resourcesAffected: "Edge network",
          episodeSeverity: "Major",
          episodeTitle: EPISODE_TITLE,
          episodeDescription:
            "Several network incidents are being investigated.",
          unsubscribeUrl: UNSUBSCRIBE_URL,
          subscriberEmailNotificationFooterText: "Footer text",
        },
        subject: trigger.emailSubject,
      });
    });

    test("sends the default SMS, identical to the dashboard SMS starter", async () => {
      await runJob(trigger.job);

      expect(sentSms()).toEqual([
        `Incident update: ${EPISODE_TITLE} on Acme Status. ${trigger.smsSentence} Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
      ]);
      expect(sentSms()[0]).toBe(
        dashboardDefault(
          trigger.event,
          StatusPageSubscriberNotificationMethod.SMS,
        ),
      );
    });

    test("sends the default Slack message, identical to the dashboard Slack starter", async () => {
      await runJob(trigger.job);

      expect(sentSlack()).toEqual([
        `## Incident - ${EPISODE_TITLE}

**${trigger.chatSentence}**

**Resources Affected:** Edge network
**Severity:** Major

**Note:**
${NOTE}

[View Status Page](${STATUS_PAGE_URL}) | [Unsubscribe](${UNSUBSCRIBE_URL})`,
      ]);
      expect(sentSlack()[0]).toBe(
        dashboardDefault(
          trigger.event,
          StatusPageSubscriberNotificationMethod.Slack,
        ),
      );
      expect(SlackUtil.convertMarkdownToSlackRichText).toHaveBeenCalledTimes(1);
    });

    test("sends the default Teams message as plain markdown, identical to the dashboard Teams starter", async () => {
      // Make the Slack conversion visible, so a converted Teams text would show.
      mock(SlackUtil.convertMarkdownToSlackRichText).mockImplementation(
        (text: unknown): string => {
          return `slack-rich-text:${text as string}`;
        },
      );

      await runJob(trigger.job);

      const teamsDefault: string = dashboardDefault(
        trigger.event,
        StatusPageSubscriberNotificationMethod.MicrosoftTeams,
      );

      expect(sentTeams()).toEqual([teamsDefault]);
      expect(sentSlack()).toEqual([
        `slack-rich-text:${dashboardDefault(
          trigger.event,
          StatusPageSubscriberNotificationMethod.Slack,
        )}`,
      ]);

      const call: { url: URL; text: string } = mock(
        MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
      ).mock.calls[0]![0] as { url: URL; text: string };

      expect(call.url.toString()).toBe(TEAMS_URL);
    });

    test("sends the fixed webhook payload, key for key", async () => {
      await runJob(trigger.job);

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
      expect(payload["eventType"]).toBe(trigger.webhookEventType);
      expect(payload["statusPageId"]).toBe(STATUS_PAGE_ID.toString());
      expect(payload["statusPageName"]).toBe("Acme Status");
      expect(payload["statusPageUrl"]).toBe(STATUS_PAGE_URL);
      expect(payload["unsubscribeUrl"]).toBe(UNSUBSCRIBE_URL);
      expect(payload["data"]).toEqual({
        episodeId: EPISODE_ID.toString(),
        episodeTitle: EPISODE_TITLE,
        incidentSeverity: "Major",
        resourcesAffected: "Edge network",
        note: NOTE,
        detailsUrl: DETAILS_URL,
      });
      expect(payload).toEqual(defaultWebhookPayload(trigger.webhookEventType));

      const call: { webhookUrl: URL } = mock(
        StatusPageSubscriberWebhookUtil.sendWebhookNotification,
      ).mock.calls[0]![0] as { webhookUrl: URL };

      expect(call.webhookUrl.toString()).toBe(WEBHOOK_URL);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    test("the default webhook payload is what the dashboard Webhook starter compiles to", async () => {
      await runJob(trigger.job);

      expect(sentWebhooks()[0]).toEqual(
        StatusPageSubscriberWebhookTemplate.compile(
          dashboardTemplate(
            trigger.event,
            StatusPageSubscriberNotificationMethod.Webhook,
          ),
          expectedVariables(),
        ),
      );
    });

    test("keeps the fixed payload's own fallbacks when the episode has no title or severity", async () => {
      storedEpisode = episode({ title: "", withoutSeverity: true });

      await runJob(trigger.job);

      expect((sentWebhooks()[0]!["data"] as JSONObject)["episodeTitle"]).toBe(
        "",
      );
      expect(
        (sentWebhooks()[0]!["data"] as JSONObject)["incidentSeverity"],
      ).toBe("");
      expect(sentSlack()[0]).toContain("**Severity:**  - ");
      expect(sentSms()[0]).toContain("Incident update: - on Acme Status.");
    });

    test("records success once every channel is sent", async () => {
      await runJob(trigger.job);

      expect(statusWrites()[statusWrites().length - 1]).toEqual(
        trigger.successStatus,
      );
    });
  },
);

describe.each(TRIGGERS)(
  "episode note $name: template lookups",
  (trigger: TriggerCase) => {
    beforeEach(() => {
      trigger.queue([publicNote()]);
    });

    test("looks up one template per channel, including Webhook, for this event and status page", async () => {
      await runJob(trigger.job);

      expect(templateLookups()).toHaveLength(5);
      expect(
        templateLookups()
          .map((lookup: JSONObject): string => {
            return lookup["notificationMethod"] as string;
          })
          .sort(),
      ).toEqual(
        [
          StatusPageSubscriberNotificationMethod.Email,
          StatusPageSubscriberNotificationMethod.SMS,
          StatusPageSubscriberNotificationMethod.Slack,
          StatusPageSubscriberNotificationMethod.MicrosoftTeams,
          StatusPageSubscriberNotificationMethod.Webhook,
        ].sort(),
      );

      for (const lookup of templateLookups()) {
        expect(lookup["eventType"]).toBe(trigger.event);
        expect((lookup["statusPageId"] as ObjectID).toString()).toBe(
          STATUS_PAGE_ID.toString(),
        );
      }
    });

    test("looks up exactly the channels this event can have a template for", async () => {
      await runJob(trigger.job);

      expect(
        templateLookups()
          .map((lookup: JSONObject): string => {
            return lookup["notificationMethod"] as string;
          })
          .sort(),
      ).toEqual(
        SubscriberNotificationTemplateChannels.getSupportedNotificationMethods(
          trigger.event,
        ).sort(),
      );
    });

    test("requests all five templates together", async () => {
      let lookupsWhenFirstAnswered: number = -1;

      mock(
        StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
      ).mockImplementation(() => {
        return new Promise<null>((resolve: (value: null) => void): void => {
          setImmediate(() => {
            if (lookupsWhenFirstAnswered < 0) {
              lookupsWhenFirstAnswered = templateLookups().length;
            }
            resolve(null);
          });
        });
      });

      await runJob(trigger.job);

      expect(lookupsWhenFirstAnswered).toBe(5);
      expect(sentWebhooks()).toHaveLength(1);
    });

    test("looks templates up once per status page, not once per subscriber", async () => {
      mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mockResolvedValue([
        subscriber(),
        subscriber(SECOND_SUBSCRIBER_ID),
      ] as never);

      await runJob(trigger.job);

      expect(templateLookups()).toHaveLength(5);
      expect(sentWebhooks()).toHaveLength(2);
      expect(sentTeams()).toHaveLength(2);
    });

    test("uses each status page's own templates and id", async () => {
      mock(StatusPageResourceService.findByMonitors).mockResolvedValue([
        resource(),
        resource(SECOND_STATUS_PAGE_ID),
      ] as never);
      useStatusPages([
        statusPage(),
        statusPage({ id: SECOND_STATUS_PAGE_ID, pageTitle: "Acme EU Status" }),
      ]);
      useTemplates(
        {
          [StatusPageSubscriberNotificationMethod.Webhook]: {
            templateBody:
              '{"page": "{{statusPageId}}", "name": "{{statusPageName}}", "episode": "{{episodeId}}"}',
          },
        },
        SECOND_STATUS_PAGE_ID,
      );

      await runJob(trigger.job);

      expect(templateLookups()).toHaveLength(10);
      for (const pageId of [STATUS_PAGE_ID, SECOND_STATUS_PAGE_ID]) {
        expect(
          templateLookups().filter((lookup: JSONObject): boolean => {
            return (
              (lookup["statusPageId"] as ObjectID).toString() ===
              pageId.toString()
            );
          }),
        ).toHaveLength(5);
      }

      expect(sentWebhooks()).toEqual([
        defaultWebhookPayload(trigger.webhookEventType),
        {
          page: SECOND_STATUS_PAGE_ID.toString(),
          name: "Acme EU Status",
          episode: EPISODE_ID.toString(),
        },
      ]);
    });
  },
);

describe.each(TRIGGERS)(
  "episode note $name: custom Webhook template",
  (trigger: TriggerCase) => {
    beforeEach(() => {
      trigger.queue([publicNote()]);
    });

    test("sends the compiled template instead of the fixed payload", async () => {
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Webhook]: {
          templateBody: `{
  "type": "episode-note",
  "event": "${trigger.webhookEventType}",
  "episode": { "id": "{{episodeId}}", "title": "{{episodeTitle}}", "severity": "{{episodeSeverity}}" },
  "page": { "id": "{{statusPageId}}", "name": "{{statusPageName}}", "url": "{{statusPageUrl}}" },
  "note": "{{note}}",
  "links": ["{{detailsUrl}}", "{{unsubscribeUrl}}"],
  "resources": "{{resourcesAffected}}",
  "count": 1
}`,
        },
      });

      await runJob(trigger.job);

      expect(sentWebhooks()).toEqual([
        {
          type: "episode-note",
          event: trigger.webhookEventType,
          episode: {
            id: EPISODE_ID.toString(),
            title: EPISODE_TITLE,
            severity: "Major",
          },
          page: {
            id: STATUS_PAGE_ID.toString(),
            name: "Acme Status",
            url: STATUS_PAGE_URL,
          },
          note: NOTE,
          links: [DETAILS_URL, UNSUBSCRIBE_URL],
          resources: "Edge network",
          count: 1,
        },
      ]);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    test("leaves every other channel on its default message", async () => {
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Webhook]: {
          templateBody: '{"custom": "{{episodeTitle}}"}',
        },
      });

      await runJob(trigger.job);

      expect(sentWebhooks()).toEqual([{ custom: EPISODE_TITLE }]);
      expect(sentMail()[0]!["templateType"]).toBe(trigger.emailTemplateType);
      expect(sentSms()[0]).toBe(
        dashboardDefault(
          trigger.event,
          StatusPageSubscriberNotificationMethod.SMS,
        ),
      );
      expect(sentSlack()[0]).toBe(
        dashboardDefault(
          trigger.event,
          StatusPageSubscriberNotificationMethod.Slack,
        ),
      );
      expect(sentTeams()[0]).toBe(
        dashboardDefault(
          trigger.event,
          StatusPageSubscriberNotificationMethod.MicrosoftTeams,
        ),
      );
      expect(statusWrites()[statusWrites().length - 1]).toEqual(
        trigger.successStatus,
      );
    });

    test("keeps quotes, backslashes and line breaks intact", async () => {
      trigger.queue([publicNote({ note: TRICKY_NOTE })]);
      storedEpisode = episode({ title: TRICKY_TITLE });
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Webhook]: {
          templateBody:
            '{"title": "{{episodeTitle}}", "note": "{{ note }}", "quoted": "said: {{episodeTitle}}"}',
        },
      });

      await runJob(trigger.job);

      const payload: JSONObject = sentWebhooks()[0]!;

      expect(payload).toEqual({
        title: TRICKY_TITLE,
        note: TRICKY_NOTE,
        quoted: `said: ${TRICKY_TITLE}`,
      });
      // What goes over the wire parses back to the same text.
      expect(JSON.parse(JSON.stringify(payload))).toEqual({
        title: TRICKY_TITLE,
        note: TRICKY_NOTE,
        quoted: `said: ${TRICKY_TITLE}`,
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    test("the dashboard Webhook starter reproduces the fixed payload even for tricky text", async () => {
      trigger.queue([publicNote({ note: TRICKY_NOTE })]);
      storedEpisode = episode({ title: TRICKY_TITLE });
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Webhook]: {
          templateBody: dashboardTemplate(
            trigger.event,
            StatusPageSubscriberNotificationMethod.Webhook,
          ),
        },
      });

      await runJob(trigger.job);

      expect(sentWebhooks()).toEqual([
        defaultWebhookPayload(trigger.webhookEventType, {
          episodeTitle: TRICKY_TITLE,
          note: TRICKY_NOTE,
        }),
      ]);
    });

    test("ignores an empty template body without a warning", async () => {
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Webhook]: {
          templateBody: "",
        },
      });

      await runJob(trigger.job);

      expect(sentWebhooks()).toEqual([
        defaultWebhookPayload(trigger.webhookEventType),
      ]);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    test.each([
      ["a variable outside a JSON string", '{"title": {{episodeTitle}}}'],
      ["text that is not JSON", "Episode {{episodeTitle}} has a new note"],
      ["a missing closing brace", '{"title": "{{episodeTitle}}"'],
      ["a JSON array", '[{"title": "{{episodeTitle}}"}]'],
      ["a JSON string", '"{{episodeTitle}}"'],
    ])(
      "falls back to the fixed payload and warns for %s",
      async (_label: string, templateBody: string) => {
        useTemplates({
          [StatusPageSubscriberNotificationMethod.Webhook]: {
            templateBody: templateBody,
          },
        });

        await runJob(trigger.job);

        expect(sentWebhooks()).toEqual([
          defaultWebhookPayload(trigger.webhookEventType),
        ]);
        expect(logger.warn).toHaveBeenCalledTimes(1);

        const warning: string = mock(logger.warn).mock.calls[0]![0] as string;

        expect(warning).toContain(STATUS_PAGE_ID.toString());
        expect(warning).toContain(trigger.webhookEventType);

        // The other channels are unaffected and the job still succeeds.
        expect(sentMail()).toHaveLength(1);
        expect(sentSms()).toHaveLength(1);
        expect(sentSlack()).toHaveLength(1);
        expect(sentTeams()).toHaveLength(1);
        expect(statusWrites()[statusWrites().length - 1]).toEqual(
          trigger.successStatus,
        );
      },
    );
  },
);

describe.each(TRIGGERS)(
  "episode note $name: every documented variable is filled",
  (trigger: TriggerCase) => {
    beforeEach(() => {
      trigger.queue([publicNote()]);
    });

    test("in a custom Email template and subject (custom SMTP)", async () => {
      useStatusPages([statusPage({ withSmtpConfig: true })]);
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Email]: {
          templateBody: everyVariableTemplate(trigger.event),
          emailSubject: "{{episodeTitle}} ({{episodeId}}) on {{statusPageId}}",
        },
      });

      await runJob(trigger.job);

      expect(sentMail()).toHaveLength(1);

      const mail: JSONObject = sentMail()[0]!;
      const body: string = (mail["vars"] as { body: string }).body;

      expect(mail["templateType"]).toBe(EmailTemplateType.BlankTemplate);
      expect(body).not.toContain("{{");
      expect(body).toBe(
        everyVariableRendered(trigger.event, expectedVariables()),
      );
      expect(body).toContain(`statusPageId=[${STATUS_PAGE_ID.toString()}]`);
      expect(body).toContain(`episodeId=[${EPISODE_ID.toString()}]`);
      expect(mail["subject"]).toBe(
        `${EPISODE_TITLE} (${EPISODE_ID.toString()}) on ${STATUS_PAGE_ID.toString()}`,
      );
    });

    test("in a custom SMS template (custom Twilio), with the plain-text note", async () => {
      useStatusPages([statusPage({ withCallSmsConfig: true })]);
      useTemplates({
        [StatusPageSubscriberNotificationMethod.SMS]: {
          templateBody: everyVariableTemplate(trigger.event),
        },
      });

      await runJob(trigger.job);

      expect(sentSms()).toHaveLength(1);
      expect(sentSms()[0]).not.toContain("{{");
      expect(sentSms()[0]).toBe(
        everyVariableRendered(
          trigger.event,
          expectedVariables({ note: NOTE_TEXT }),
        ),
      );
      expect(sentSms()[0]).toContain(
        `statusPageId=[${STATUS_PAGE_ID.toString()}]`,
      );
      expect(sentSms()[0]).toContain(`episodeId=[${EPISODE_ID.toString()}]`);
    });

    test("in a custom Slack template", async () => {
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Slack]: {
          templateBody: everyVariableTemplate(trigger.event),
        },
      });

      await runJob(trigger.job);

      expect(sentSlack()).toHaveLength(1);
      expect(sentSlack()[0]).not.toContain("{{");
      expect(sentSlack()[0]).toBe(
        everyVariableRendered(trigger.event, expectedVariables()),
      );
      expect(sentSlack()[0]).toContain(
        `statusPageId=[${STATUS_PAGE_ID.toString()}]`,
      );
      expect(sentSlack()[0]).toContain(`episodeId=[${EPISODE_ID.toString()}]`);
    });

    test("in a custom Microsoft Teams template", async () => {
      useTemplates({
        [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
          templateBody: everyVariableTemplate(trigger.event),
        },
      });

      await runJob(trigger.job);

      expect(sentTeams()).toHaveLength(1);
      expect(sentTeams()[0]).not.toContain("{{");
      expect(sentTeams()[0]).toBe(
        everyVariableRendered(trigger.event, expectedVariables()),
      );
      expect(sentTeams()[0]).toContain(
        `statusPageId=[${STATUS_PAGE_ID.toString()}]`,
      );
      expect(sentTeams()[0]).toContain(`episodeId=[${EPISODE_ID.toString()}]`);
    });

    test("in a custom Webhook template", async () => {
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Webhook]: {
          templateBody: everyVariableWebhookTemplate(trigger.event),
        },
      });

      await runJob(trigger.job);

      expect(sentWebhooks()).toHaveLength(1);
      expect(JSON.stringify(sentWebhooks()[0])).not.toContain("{{");
      expect(sentWebhooks()[0]).toEqual(expectedVariables());
      expect(sentWebhooks()[0]!["statusPageId"]).toBe(
        STATUS_PAGE_ID.toString(),
      );
      expect(sentWebhooks()[0]!["episodeId"]).toBe(EPISODE_ID.toString());
      expect(logger.warn).not.toHaveBeenCalled();
    });

    test("ignores custom Email and SMS templates without a custom SMTP or Twilio config", async () => {
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Email]: {
          templateBody: everyVariableTemplate(trigger.event),
        },
        [StatusPageSubscriberNotificationMethod.SMS]: {
          templateBody: everyVariableTemplate(trigger.event),
        },
      });

      await runJob(trigger.job);

      expect(sentMail()[0]!["templateType"]).toBe(trigger.emailTemplateType);
      expect(sentSms()[0]).toBe(
        dashboardDefault(
          trigger.event,
          StatusPageSubscriberNotificationMethod.SMS,
        ),
      );
    });
  },
);

describe.each(TRIGGERS)(
  "episode note $name: failure isolation",
  (trigger: TriggerCase) => {
    beforeEach(() => {
      trigger.queue([publicNote()]);
      mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mockResolvedValue([
        subscriber(),
        subscriber(SECOND_SUBSCRIBER_ID),
      ] as never);
    });

    test("a rejected webhook send does not stop other subscribers or fail the note", async () => {
      const failure: Error = new Error("webhook endpoint is down");
      mock(
        StatusPageSubscriberWebhookUtil.sendWebhookNotification,
      ).mockRejectedValueOnce(failure as never);

      await expect(runJob(trigger.job)).resolves.toBeUndefined();

      expect(sentWebhooks()).toHaveLength(2);
      expect(sentMail()).toHaveLength(2);
      expect(sentSms()).toHaveLength(2);
      expect(sentSlack()).toHaveLength(2);
      expect(sentTeams()).toHaveLength(2);
      expect(logger.error).toHaveBeenCalledWith(
        failure,
        expect.objectContaining({
          projectId: PROJECT_ID.toString(),
          incidentEpisodeId: EPISODE_ID.toString(),
        }),
      );
      expect(statusWrites()[statusWrites().length - 1]).toEqual(
        trigger.successStatus,
      );
    });

    test("a rejected webhook send with a custom template is handled the same way", async () => {
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Webhook]: {
          templateBody: '{"episode": "{{episodeId}}"}',
        },
      });
      const failure: Error = new Error("webhook endpoint is down");
      mock(
        StatusPageSubscriberWebhookUtil.sendWebhookNotification,
      ).mockRejectedValueOnce(failure as never);

      await runJob(trigger.job);

      expect(sentWebhooks()).toEqual([
        { episode: EPISODE_ID.toString() },
        { episode: EPISODE_ID.toString() },
      ]);
      expect(logger.error).toHaveBeenCalledWith(failure, expect.anything());
      expect(statusWrites()[statusWrites().length - 1]).toEqual(
        trigger.successStatus,
      );
    });

    test("a rejected Teams send does not stop the webhook or fail the note", async () => {
      const failure: Error = new Error("teams webhook removed");
      mock(
        MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
      ).mockRejectedValue(failure as never);

      await runJob(trigger.job);

      expect(sentTeams()).toHaveLength(2);
      expect(sentWebhooks()).toEqual([
        defaultWebhookPayload(trigger.webhookEventType),
        defaultWebhookPayload(trigger.webhookEventType),
      ]);
      expect(sentSlack()).toHaveLength(2);
      expect(logger.error).toHaveBeenCalledWith(failure, expect.anything());
      expect(statusWrites()[statusWrites().length - 1]).toEqual(
        trigger.successStatus,
      );
    });

    test("a failing template lookup marks the note Failed and sends nothing", async () => {
      mock(
        StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
      ).mockRejectedValue(new Error("template store unavailable") as never);

      await runJob(trigger.job);

      nothingSent();

      const lastWrite: JSONObject = statusWrites()[statusWrites().length - 1]!;

      expect(Object.values(lastWrite)).toEqual([
        StatusPageSubscriberNotificationStatus.Failed,
        "template store unavailable",
      ]);
    });
  },
);
