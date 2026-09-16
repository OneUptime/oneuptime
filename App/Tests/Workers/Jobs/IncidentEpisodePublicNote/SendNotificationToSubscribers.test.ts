import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "Common/Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodePublicNote from "Common/Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
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
 * Incident episode public note notifications: "note posted" and the new
 * "note updated" job share one send path.
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
import StatusPageSubscriberNotificationTemplateService, {
  Service as StatusPageSubscriberNotificationTemplateServiceClass,
} from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import Markdown from "Common/Server/Types/Markdown";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
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
const EPISODE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const NOTE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

const STATUS_PAGE_URL: string = "https://status.acme.com";
const DETAILS_URL: string = `${STATUS_PAGE_URL}/episodes/${EPISODE_ID.toString()}`;
const UNSUBSCRIBE_URL: string = `${STATUS_PAGE_URL}/update-subscription/${SUBSCRIBER_ID.toString()}`;
const DASHBOARD_URL: string = "https://oneuptime.acme.com/dashboard/episode/1";

const EPISODE_TITLE: string = "Regional network interruption";
const NOTE: string = "Traffic is back on the **primary** links.";
const NOTE_HTML: string =
  "<p>Traffic is back on the <strong>primary</strong> links.</p>";
const NOTE_TEXT: string = "Traffic is back on the primary links.";

const GROUPED_RESOURCES_HTML: string =
  "Europe: Edge network<br/>Americas: Core network";
const GROUPED_RESOURCES_TEXT: string =
  "Europe: Edge network; Americas: Core network";

/*
 * One custom template per channel. Each echoes the note and the resource
 * list, so the message shows which format that channel was given.
 */
const CUSTOM_EMAIL_BODY: string =
  "<div>{{note}}</div><div>{{resourcesAffected}}</div>";
const CUSTOM_EMAIL_SUBJECT: string =
  "{{episodeTitle}}: {{note}} ({{resourcesAffected}})";
const CUSTOM_SMS_BODY: string = "SMS {{note}} ({{resourcesAffected}})";
const CUSTOM_SLACK_BODY: string = "Slack {{note}} ({{resourcesAffected}})";
const CUSTOM_TEAMS_BODY: string = "Teams {{note}} ({{resourcesAffected}})";

let createdNotes: Array<IncidentEpisodePublicNote> = [];
let updatedNotes: Array<IncidentEpisodePublicNote> = [];
let skipNotes: Array<IncidentEpisodePublicNote> = [];
let storedEpisode: IncidentEpisode | null = null;
let memberMonitors: Array<Monitor> = [];

function publicNote(overrides?: {
  subscriberNotificationStatusOnNoteCreated?: StatusPageSubscriberNotificationStatus;
}): IncidentEpisodePublicNote {
  const note: IncidentEpisodePublicNote = new IncidentEpisodePublicNote();
  note._id = NOTE_ID.toString();
  note.note = NOTE;
  note.incidentEpisodeId = EPISODE_ID;
  note.projectId = PROJECT_ID;
  note.subscriberNotificationStatusOnNoteCreated =
    overrides?.subscriberNotificationStatusOnNoteCreated ||
    StatusPageSubscriberNotificationStatus.Success;
  return note;
}

function episode(overrides?: {
  isVisibleOnStatusPage?: boolean;
}): IncidentEpisode {
  const row: IncidentEpisode = new IncidentEpisode();
  row._id = EPISODE_ID.toString();
  row.title = EPISODE_TITLE;
  row.description = "Several network incidents are being investigated.";
  row.projectId = PROJECT_ID;
  row.isVisibleOnStatusPage = overrides?.isVisibleOnStatusPage !== false;
  row.episodeNumber = 3;
  row.episodeNumberWithPrefix = "EP-3";

  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Major";
  row.incidentSeverity = severity;

  return row;
}

function monitor(): Monitor {
  const row: Monitor = new Monitor();
  row._id = MONITOR_ID.toString();
  return row;
}

function statusPage(overrides?: {
  showEpisodesOnStatusPage?: boolean;
}): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID.toString();
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  page.pageTitle = "Acme Status";
  page.isPublicStatusPage = true;
  page.showEpisodesOnStatusPage = overrides?.showEpisodesOnStatusPage !== false;
  return page;
}

function resource(): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = "88888888-8888-4888-8888-888888888888";
  row.statusPageId = STATUS_PAGE_ID;
  row.displayName = "Edge network";
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
      "Edge network",
      "Europe",
    ),
    resourceInGroup(
      "99999999-9999-4999-8999-999999999999",
      "Core network",
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
    episodeTitle: EPISODE_TITLE,
    episodeSeverity: "Major",
    resourcesAffected: "Edge network",
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

    for (const call of mock(
      StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
    ).mock.calls) {
      expect((call[0] as JSONObject)["eventType"]).toBe(
        StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteUpdated,
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
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([
      statusPage({ showEpisodesOnStatusPage: false }),
    ] as never);

    await runJob(UPDATED_JOB);

    nothingSent();
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
});

describe.each([
  ["created", CREATED_JOB],
  ["updated", UPDATED_JOB],
])(
  "IncidentEpisodePublicNote %s job, with custom templates and grouped resources",
  (_trigger: string, job: string) => {
    beforeEach(() => {
      createdNotes = [publicNote()];
      updatedNotes = [publicNote()];
      useCustomTemplatesOnEveryChannel();
      mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
        groupedResources() as never,
      );
    });

    test("renders HTML in the email body, plain text in SMS and the subject, and Markdown in chat", async () => {
      await runJob(job);

      expect(sentMail()).toHaveLength(1);
      expect(sentMail()[0]!["templateType"]).toBe(
        EmailTemplateType.BlankTemplate,
      );
      expect(sentMail()[0]!["vars"]).toEqual({
        body: `<div>${NOTE_HTML}</div><div>${GROUPED_RESOURCES_HTML}</div>`,
      });
      expect(sentMail()[0]!["subject"]).toBe(
        `${EPISODE_TITLE}: ${NOTE_TEXT} (${GROUPED_RESOURCES_TEXT})`,
      );
      expect(sentSms()).toEqual([
        `SMS ${NOTE_TEXT} (${GROUPED_RESOURCES_TEXT})`,
      ]);
      expect(sentSlack()).toEqual([
        `Slack ${NOTE} (${GROUPED_RESOURCES_TEXT})`,
      ]);
      expect(sentTeams()).toEqual([
        `Teams ${NOTE} (${GROUPED_RESOURCES_TEXT})`,
      ]);
    });

    test("hands each channel's template the same variables, in that channel's format", async () => {
      await runJob(job);

      const shared: Record<string, string> = {
        statusPageName: "Acme Status",
        statusPageUrl: STATUS_PAGE_URL,
        detailsUrl: DETAILS_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
        episodeSeverity: "Major",
        episodeTitle: EPISODE_TITLE,
      };
      const html: Record<string, string> = {
        ...shared,
        note: NOTE_HTML,
        resourcesAffected: GROUPED_RESOURCES_HTML,
      };
      const plainText: Record<string, string> = {
        ...shared,
        note: NOTE_TEXT,
        resourcesAffected: GROUPED_RESOURCES_TEXT,
      };
      const markdown: Record<string, string> = {
        ...shared,
        note: NOTE,
        resourcesAffected: GROUPED_RESOURCES_TEXT,
      };

      expect(variablesCompiledInto(CUSTOM_EMAIL_BODY)).toEqual(html);
      expect(variablesCompiledInto(CUSTOM_EMAIL_SUBJECT)).toEqual(plainText);
      expect(variablesCompiledInto(CUSTOM_SMS_BODY)).toEqual(plainText);
      expect(variablesCompiledInto(CUSTOM_SLACK_BODY)).toEqual(markdown);
      expect(variablesCompiledInto(CUSTOM_TEAMS_BODY)).toEqual(markdown);
    });

    test("sends webhooks the Markdown note and a plain-text resource list", async () => {
      await runJob(job);

      const data: JSONObject = sentWebhooks()[0]!["data"] as JSONObject;

      expect(data["note"]).toBe(NOTE);
      expect(data["resourcesAffected"]).toBe(GROUPED_RESOURCES_TEXT);
    });
  },
);

describe("IncidentEpisodePublicNote default email, with grouped resources", () => {
  test("still gets HTML for the note and the resource list", async () => {
    createdNotes = [publicNote()];
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
      groupedResources() as never,
    );

    await runJob(CREATED_JOB);

    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberEpisodeNoteCreated,
    );
    expect(sentMail()[0]!["vars"]).toEqual(
      expect.objectContaining({
        note: NOTE_HTML,
        resourcesAffected: GROUPED_RESOURCES_HTML,
      }),
    );
  });
});
