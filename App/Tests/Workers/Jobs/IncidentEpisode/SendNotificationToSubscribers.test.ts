import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import { IncidentEpisodeFeedEventType } from "Common/Models/DatabaseModels/IncidentEpisodeFeed";
import IncidentEpisodeMember from "Common/Models/DatabaseModels/IncidentEpisodeMember";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import URL from "Common/Types/API/URL";
import { Blue500, Yellow500 } from "Common/Types/BrandColors";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberNotificationTemplateVariables from "Common/Types/StatusPage/SubscriberNotificationTemplateVariables";

/*
 * Incident episode "created" subscriber notifications. These tests drive one
 * tick of the job against fakes and check what each channel receives (default
 * messages, custom templates including Webhook), which status columns are
 * written, and what lands in the episode feed. The Webhook template compiler
 * is the real one.
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

jest.mock("Common/Server/Services/IncidentEpisodeService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      updateOneById: jest.fn(),
      getEpisodeLinkInDashboard: jest.fn(),
    },
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
  return { __esModule: true, default: { findAllBy: jest.fn() } };
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
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import MailService from "Common/Server/Services/MailService";
import SmsService from "Common/Server/Services/SmsService";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import Markdown from "Common/Server/Types/Markdown";
import logger from "Common/Server/Utils/Logger";
import StatusPageResourceUtil from "Common/Server/Utils/StatusPageResource";
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
import StatusPageSubscriberWebhookTemplate from "Common/Server/Utils/StatusPageSubscriberWebhookTemplate";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import { getDefaultSubscriberNotificationTemplate } from "../../../../FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateDefaults";
import "../../../../FeatureSet/Workers/Jobs/IncidentEpisode/SendNotificationToSubscribers";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const JOB: string = "IncidentEpisode:SendNotificationToSubscribers";
const EVENT: StatusPageSubscriberNotificationEventType =
  StatusPageSubscriberNotificationEventType.SubscriberEpisodeCreated;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SECOND_STATUS_PAGE_ID: ObjectID = new ObjectID(
  "23232323-2323-4323-8323-232323232323",
);
const EPISODE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SECOND_EPISODE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const SECOND_SUBSCRIBER_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const SECOND_MONITOR_ID: ObjectID = new ObjectID(
  "78787878-7878-4878-8878-787878787878",
);
const LOGO_FILE_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

const STATUS_PAGE_URL: string = "https://status.acme.com";
const DETAILS_URL: string = `${STATUS_PAGE_URL}/episodes/${EPISODE_ID.toString()}`;
const DASHBOARD_URL: string =
  "https://oneuptime.acme.com/dashboard/incident-episodes/3";
const SLACK_URL: string = "https://hooks.slack.com/services/T000/B000/XXXX";
const TEAMS_URL: string = "https://outlook.office.com/webhook/abc";
const WEBHOOK_URL: string = "https://hooks.acme.com/status";

const EPISODE_TITLE: string = "Checkout requests failing";
const EPISODE_DESCRIPTION: string = "Payments **fail** in Europe.";
const EPISODE_DESCRIPTION_HTML: string =
  "<p>Payments <strong>fail</strong> in Europe.</p>";
const EPISODE_DESCRIPTION_TEXT: string = "Payments fail in Europe.";
const SEVERITY: string = "Critical";
const RESOURCES_AFFECTED: string = "Checkout API";

const EPISODE_FEED_TEXT: string = `📧 **Subscriber Episode Created Notification Sent for [Episode 3](${DASHBOARD_URL})**:
      Notification sent to status page subscribers because this episode was created.`;

const ALL_VARIABLE_NAMES: Array<string> =
  SubscriberNotificationTemplateVariables.getVariableNames(EVENT);

let skippedEpisodes: Array<IncidentEpisode> = [];
let pendingEpisodes: Array<IncidentEpisode> = [];
let episodeMembers: Array<IncidentEpisodeMember> = [];

function unsubscribeUrlFor(subscriberId: ObjectID): string {
  return `${STATUS_PAGE_URL}/update-subscription/${subscriberId.toString()}`;
}

const UNSUBSCRIBE_URL: string = unsubscribeUrlFor(SUBSCRIBER_ID);

function episode(overrides?: {
  id?: ObjectID;
  isVisibleOnStatusPage?: boolean;
  withoutSeverity?: boolean;
  title?: string;
  description?: string;
}): IncidentEpisode {
  const row: IncidentEpisode = new IncidentEpisode();
  row._id = (overrides?.id || EPISODE_ID).toString();
  row.title = overrides?.title ?? EPISODE_TITLE;
  row.description = overrides?.description ?? EPISODE_DESCRIPTION;
  row.projectId = PROJECT_ID;
  row.isVisibleOnStatusPage = overrides?.isVisibleOnStatusPage !== false;
  row.episodeNumber = 3;

  if (!overrides?.withoutSeverity) {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity.name = SEVERITY;
    row.incidentSeverity = severity;
  }

  return row;
}

function member(monitorIds: Array<ObjectID>): IncidentEpisodeMember {
  const incident: Incident = new Incident();
  incident.monitors = monitorIds.map((id: ObjectID): Monitor => {
    const monitor: Monitor = new Monitor();
    monitor._id = id.toString();
    return monitor;
  });

  const row: IncidentEpisodeMember = new IncidentEpisodeMember();
  row.incident = incident;
  return row;
}

function statusPage(overrides?: {
  id?: ObjectID;
  showEpisodesOnStatusPage?: boolean;
  isPublicStatusPage?: boolean;
  withSmtpConfig?: boolean;
  withCallSmsConfig?: boolean;
  withLogo?: boolean;
}): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = (overrides?.id || STATUS_PAGE_ID).toString();
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  page.pageTitle = "Acme Status";
  page.isPublicStatusPage = overrides?.isPublicStatusPage !== false;
  page.showEpisodesOnStatusPage = overrides?.showEpisodesOnStatusPage !== false;

  if (overrides?.withSmtpConfig) {
    const smtpConfig: ProjectSmtpConfig = new ProjectSmtpConfig();
    smtpConfig._id = "12121212-1212-4212-8212-121212121212";
    page.smtpConfig = smtpConfig;
  }

  if (overrides?.withCallSmsConfig) {
    const callSmsConfig: ProjectCallSMSConfig = new ProjectCallSMSConfig();
    callSmsConfig._id = "13131313-1313-4313-8313-131313131313";
    page.callSmsConfig = callSmsConfig;
  }

  if (overrides?.withLogo) {
    page.logoFileId = LOGO_FILE_ID;
  }

  return page;
}

function resource(statusPageId?: ObjectID): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = "88888888-8888-4888-8888-888888888888";
  row.statusPageId = statusPageId || STATUS_PAGE_ID;
  row.displayName = RESOURCES_AFFECTED;
  return row;
}

function subscriber(id?: ObjectID): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row._id = (id || SUBSCRIBER_ID).toString();
  row.subscriberEmail = new Email("customer@example.com");
  row.subscriberPhone = new Phone("+15555550100");
  row.slackIncomingWebhookUrl = URL.fromString(SLACK_URL);
  row.microsoftTeamsIncomingWebhookUrl = URL.fromString(TEAMS_URL);
  row.subscriberWebhook = URL.fromString(WEBHOOK_URL);
  return row;
}

function webhookOnlySubscriber(id?: ObjectID): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row._id = (id || SUBSCRIBER_ID).toString();
  row.subscriberWebhook = URL.fromString(WEBHOOK_URL);
  return row;
}

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
}

function firstArgs(fn: unknown): Array<JSONObject> {
  return mock(fn).mock.calls.map((call: Array<unknown>): JSONObject => {
    return call[0] as JSONObject;
  });
}

function statusWrites(): Array<JSONObject> {
  return firstArgs(IncidentEpisodeService.updateOneById).map(
    (args: JSONObject): JSONObject => {
      return args["data"] as JSONObject;
    },
  );
}

function writesFor(id: ObjectID): Array<JSONObject> {
  return firstArgs(IncidentEpisodeService.updateOneById)
    .filter((args: JSONObject): boolean => {
      return (args["id"] as ObjectID).toString() === id.toString();
    })
    .map((args: JSONObject): JSONObject => {
      return args["data"] as JSONObject;
    });
}

function sentMail(): Array<JSONObject> {
  return firstArgs(MailService.sendMail);
}

function sentMailBodies(): Array<string> {
  return sentMail().map((mail: JSONObject): string => {
    return (mail["vars"] as JSONObject)["body"] as string;
  });
}

function sentSms(): Array<string> {
  return firstArgs(SmsService.sendSms).map((sms: JSONObject): string => {
    return sms["message"] as string;
  });
}

function sentSlack(): Array<string> {
  return firstArgs(SlackUtil.sendMessageToChannelViaIncomingWebhook).map(
    (args: JSONObject): string => {
      return args["text"] as string;
    },
  );
}

function sentTeams(): Array<string> {
  return firstArgs(
    MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
  ).map((args: JSONObject): string => {
    return args["text"] as string;
  });
}

function sentWebhooks(): Array<JSONObject> {
  return firstArgs(StatusPageSubscriberWebhookUtil.sendWebhookNotification).map(
    (args: JSONObject): JSONObject => {
      return args["payload"] as JSONObject;
    },
  );
}

function feedItems(): Array<JSONObject> {
  return firstArgs(IncidentEpisodeFeedService.createIncidentEpisodeFeedItem);
}

function templateLookups(): Array<JSONObject> {
  return firstArgs(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
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

type CustomTemplates = Partial<
  Record<
    StatusPageSubscriberNotificationMethod,
    { templateBody: string; emailSubject?: string }
  >
>;

function useTemplates(templates: CustomTemplates): void {
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

function useSubscribers(subscribers: Array<StatusPageSubscriber>): void {
  mock(
    StatusPageSubscriberService.getSubscribersByStatusPage,
  ).mockResolvedValue(subscribers as never);
}

// The per-subscriber values every Slack/Teams/Webhook template receives.
function expectedVariables(): Record<string, string> {
  return {
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    statusPageId: STATUS_PAGE_ID.toString(),
    unsubscribeUrl: UNSUBSCRIBE_URL,
    resourcesAffected: RESOURCES_AFFECTED,
    episodeId: EPISODE_ID.toString(),
    episodeTitle: EPISODE_TITLE,
    episodeDescription: EPISODE_DESCRIPTION,
    episodeSeverity: SEVERITY,
    detailsUrl: DETAILS_URL,
  };
}

function defaultWebhookPayload(): JSONObject {
  return {
    eventType: "EpisodeCreated",
    statusPageId: STATUS_PAGE_ID.toString(),
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    unsubscribeUrl: UNSUBSCRIBE_URL,
    data: {
      episodeId: EPISODE_ID.toString(),
      episodeTitle: EPISODE_TITLE,
      episodeDescription: EPISODE_DESCRIPTION,
      incidentSeverity: SEVERITY,
      resourcesAffected: RESOURCES_AFFECTED,
      detailsUrl: DETAILS_URL,
    },
  };
}

function dashboardStarter(
  method: StatusPageSubscriberNotificationMethod,
): string {
  return getDefaultSubscriberNotificationTemplate(EVENT, method)?.body || "";
}

function dashboardDefault(
  method: StatusPageSubscriberNotificationMethod,
): string {
  const variables: Record<string, string> = expectedVariables();

  return dashboardStarter(method).replace(
    /{{\s*(\w+)\s*}}/g,
    (_match: string, key: string) => {
      return variables[key] ?? "";
    },
  );
}

function everyVariableTemplate(): string {
  return ALL_VARIABLE_NAMES.map((name: string): string => {
    return `${name}=[{{${name}}}]`;
  }).join("\n");
}

function everyVariableMessage(values: Record<string, string>): string {
  return ALL_VARIABLE_NAMES.map((name: string): string => {
    return `${name}=[${values[name]}]`;
  }).join("\n");
}

function everyVariableWebhookTemplate(): string {
  const entries: string = ALL_VARIABLE_NAMES.map((name: string): string => {
    return `  "${name}": "{{${name}}}"`;
  }).join(",\n");

  return `{\n${entries}\n}`;
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve: (value: unknown) => void) => {
    setImmediate(resolve);
  });
}

async function runJob(): Promise<void> {
  expect(mockCapturedJobs[JOB]).toBeDefined();
  await mockCapturedJobs[JOB]!();
}

beforeEach(() => {
  jest.clearAllMocks();

  skippedEpisodes = [];
  pendingEpisodes = [];
  episodeMembers = [member([MONITOR_ID])];

  mock(IncidentEpisodeService.findAllBy).mockImplementation(
    async (args: unknown): Promise<Array<IncidentEpisode>> => {
      const query: JSONObject = (args as { query: JSONObject }).query;

      return query["shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated"] ===
        false
        ? skippedEpisodes
        : pendingEpisodes;
    },
  );
  mock(IncidentEpisodeService.updateOneById).mockResolvedValue(1 as never);
  mock(IncidentEpisodeService.getEpisodeLinkInDashboard).mockResolvedValue(
    URL.fromString(DASHBOARD_URL) as never,
  );
  mock(IncidentEpisodeMemberService.findBy).mockImplementation(async () => {
    return episodeMembers;
  });
  mock(
    IncidentEpisodeFeedService.createIncidentEpisodeFeedItem,
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
  useSubscribers([subscriber()]);
  mock(StatusPageSubscriberService.shouldSendNotification).mockReturnValue(
    true,
  );
  mock(StatusPageSubscriberService.getUnsubscribeLink).mockImplementation(
    (_statusPageUrl: unknown, subscriberId: unknown): URL => {
      return URL.fromString(unsubscribeUrlFor(subscriberId as ObjectID));
    },
  );
  mock(StatusPageService.getStatusPageURL).mockResolvedValue(
    STATUS_PAGE_URL as never,
  );
  useTemplates({});

  mock(Markdown.convertToHTML).mockResolvedValue(
    EPISODE_DESCRIPTION_HTML as never,
  );
  mock(Markdown.convertToPlainText).mockReturnValue(EPISODE_DESCRIPTION_TEXT);

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

describe("IncidentEpisode:SendNotificationToSubscribers bookkeeping", () => {
  test("is registered", () => {
    expect(mockCapturedJobs[JOB]).toBeDefined();
  });

  test("looks for opted-out episodes first, then pending ones with every column the messages need", async () => {
    await runJob();

    const calls: Array<JSONObject> = firstArgs(
      IncidentEpisodeService.findAllBy,
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]!["query"]).toEqual({
      subscriberNotificationStatusOnEpisodeCreated:
        StatusPageSubscriberNotificationStatus.Pending,
      shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: false,
    });
    expect(calls[1]!["query"]).toEqual({
      subscriberNotificationStatusOnEpisodeCreated:
        StatusPageSubscriberNotificationStatus.Pending,
      shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: true,
    });
    expect(calls[1]!["select"]).toEqual({
      _id: true,
      title: true,
      description: true,
      projectId: true,
      isVisibleOnStatusPage: true,
      incidentSeverity: {
        name: true,
      },
      episodeNumber: true,
    });
    expect(calls[1]!["props"]).toEqual({ isRoot: true });
  });

  test("sends nothing and writes no status when nothing is pending", async () => {
    await runJob();

    nothingSent();
    expect(IncidentEpisodeService.updateOneById).not.toHaveBeenCalled();
    expect(
      IncidentEpisodeFeedService.createIncidentEpisodeFeedItem,
    ).not.toHaveBeenCalled();
  });

  test("marks episodes whose author did not ask to notify as Skipped", async () => {
    skippedEpisodes = [episode(), episode({ id: SECOND_EPISODE_ID })];

    await runJob();

    nothingSent();
    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatusOnEpisodeCreated:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessage:
          "Notifications skipped as subscribers are not to be notified for this episode.",
      },
      {
        subscriberNotificationStatusOnEpisodeCreated:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessage:
          "Notifications skipped as subscribers are not to be notified for this episode.",
      },
    ]);
    expect(writesFor(EPISODE_ID)).toHaveLength(1);
    expect(writesFor(SECOND_EPISODE_ID)).toHaveLength(1);
    expect(IncidentEpisodeMemberService.findBy).not.toHaveBeenCalled();
  });

  test("skips an episode whose member incidents have no monitors, before marking it in progress", async () => {
    pendingEpisodes = [episode()];
    episodeMembers = [member([])];

    await runJob();

    nothingSent();
    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatusOnEpisodeCreated:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessage:
          "No monitors are attached to the incidents in this episode. Skipping notifications to subscribers.",
      },
    ]);
    expect(StatusPageResourceService.findAllBy).not.toHaveBeenCalled();
    expect(
      IncidentEpisodeFeedService.createIncidentEpisodeFeedItem,
    ).not.toHaveBeenCalled();
  });

  test("skips an episode with no member incidents at all", async () => {
    pendingEpisodes = [episode()];
    episodeMembers = [];

    await runJob();

    nothingSent();
    expect(
      statusWrites()[0]!["subscriberNotificationStatusOnEpisodeCreated"],
    ).toBe(StatusPageSubscriberNotificationStatus.Skipped);
  });

  test("reads the members of this episode and looks up resources for their unique monitors", async () => {
    pendingEpisodes = [episode()];
    episodeMembers = [
      member([MONITOR_ID, SECOND_MONITOR_ID]),
      member([MONITOR_ID]),
    ];

    await runJob();

    const memberQuery: JSONObject = firstArgs(
      IncidentEpisodeMemberService.findBy,
    )[0]!["query"] as JSONObject;
    expect((memberQuery["incidentEpisodeId"] as ObjectID).toString()).toBe(
      EPISODE_ID.toString(),
    );

    const resourceQuery: JSONObject = firstArgs(
      StatusPageResourceService.findAllBy,
    )[0]!["query"] as JSONObject;
    const monitorFilter: { objectLiteralParameters: JSONObject } =
      resourceQuery["monitorId"] as unknown as {
        objectLiteralParameters: JSONObject;
      };

    expect(Object.values(monitorFilter.objectLiteralParameters)).toEqual([
      [MONITOR_ID.toString(), SECOND_MONITOR_ID.toString()],
    ]);
  });

  test("skips an episode that is not visible on the status page after marking it in progress", async () => {
    pendingEpisodes = [episode({ isVisibleOnStatusPage: false })];

    await runJob();

    nothingSent();
    expect(StatusPageResourceService.findAllBy).not.toHaveBeenCalled();
    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatusOnEpisodeCreated:
          StatusPageSubscriberNotificationStatus.InProgress,
      },
      {
        subscriberNotificationStatusOnEpisodeCreated:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessage:
          "Episode is not visible on status page. Skipping notifications.",
      },
    ]);
  });

  test("records progress and then success", async () => {
    pendingEpisodes = [episode()];

    await runJob();

    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatusOnEpisodeCreated:
          StatusPageSubscriberNotificationStatus.InProgress,
      },
      {
        subscriberNotificationStatusOnEpisodeCreated:
          StatusPageSubscriberNotificationStatus.Success,
        subscriberNotificationStatusMessage:
          "Notifications sent successfully to all subscribers",
      },
    ]);
  });

  test("writes every status without hooks so it never re-queues itself", async () => {
    skippedEpisodes = [episode({ id: SECOND_EPISODE_ID })];
    pendingEpisodes = [episode()];

    await runJob();

    expect(firstArgs(IncidentEpisodeService.updateOneById)).toHaveLength(3);
    for (const args of firstArgs(IncidentEpisodeService.updateOneById)) {
      expect(args["props"]).toEqual({ isRoot: true, ignoreHooks: true });
    }
  });

  test("records in the episode feed that subscribers were notified", async () => {
    pendingEpisodes = [episode()];

    await runJob();

    expect(feedItems()).toHaveLength(1);
    expect(feedItems()[0]).toEqual({
      incidentEpisodeId: EPISODE_ID,
      projectId: PROJECT_ID,
      incidentEpisodeFeedEventType:
        IncidentEpisodeFeedEventType.SubscriberNotificationSent,
      displayColor: Blue500,
      feedInfoInMarkdown: EPISODE_FEED_TEXT,
    });
  });

  test("records in the feed when no subscriber matched, and still finishes with success", async () => {
    pendingEpisodes = [episode()];
    mock(StatusPageSubscriberService.shouldSendNotification).mockReturnValue(
      false,
    );

    await runJob();

    nothingSent();
    expect(feedItems()).toEqual([
      {
        incidentEpisodeId: EPISODE_ID,
        projectId: PROJECT_ID,
        incidentEpisodeFeedEventType:
          IncidentEpisodeFeedEventType.SubscriberNotificationSent,
        displayColor: Yellow500,
        feedInfoInMarkdown: `📧 **No notification sent to subscribers** for the creation of [Episode 3](${DASHBOARD_URL}).`,
        moreInformationInMarkdown:
          "Subscriber notifications were skipped because all associated status pages either hide episodes or had no matching subscribers.",
      },
    ]);
    expect(
      statusWrites()[statusWrites().length - 1]![
        "subscriberNotificationStatusOnEpisodeCreated"
      ],
    ).toBe(StatusPageSubscriberNotificationStatus.Success);
  });

  test("filters subscribers with the incident event type and the page's resources", async () => {
    pendingEpisodes = [episode()];

    await runJob();

    const args: JSONObject = firstArgs(
      StatusPageSubscriberService.shouldSendNotification,
    )[0]!;

    expect(args["eventType"]).toBe(StatusPageEventType.Incident);
    expect(
      (args["statusPageResources"] as Array<StatusPageResource>).map(
        (row: StatusPageResource): string => {
          return row.displayName || "";
        },
      ),
    ).toEqual([RESOURCES_AFFECTED]);
    expect((args["subscriber"] as StatusPageSubscriber)._id).toBe(
      SUBSCRIBER_ID.toString(),
    );
    expect(
      StatusPageResourceUtil.getResourcesGroupedByGroupName,
    ).toHaveBeenCalledWith([expect.any(StatusPageResource)]);
  });

  test("respects a status page that hides episodes", async () => {
    pendingEpisodes = [episode()];
    useStatusPages([statusPage({ showEpisodesOnStatusPage: false })]);

    await runJob();

    nothingSent();
    expect(
      StatusPageSubscriberService.getSubscribersByStatusPage,
    ).not.toHaveBeenCalled();
    expect(feedItems()[0]!["displayColor"]).toEqual(Yellow500);
  });

  test("skips a subscriber without an id and notifies the rest", async () => {
    pendingEpisodes = [episode()];
    const withoutId: StatusPageSubscriber = new StatusPageSubscriber();
    withoutId.subscriberEmail = new Email("customer@example.com");
    withoutId.subscriberWebhook = URL.fromString(WEBHOOK_URL);
    useSubscribers([withoutId, subscriber(SECOND_SUBSCRIBER_ID)]);

    await runJob();

    expect(sentWebhooks()).toHaveLength(1);
    expect(sentWebhooks()[0]!["unsubscribeUrl"]).toBe(
      unsubscribeUrlFor(SECOND_SUBSCRIBER_ID),
    );
    expect(sentMail()).toHaveLength(1);
  });

  test("asks for the status pages of the affected resources", async () => {
    pendingEpisodes = [episode()];

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

  test("marks the episode Failed with the reason when sending breaks", async () => {
    pendingEpisodes = [episode()];
    mock(Markdown.convertToHTML).mockRejectedValue(
      new Error("markdown exploded") as never,
    );

    await runJob();

    nothingSent();
    expect(statusWrites()[statusWrites().length - 1]).toEqual({
      subscriberNotificationStatusOnEpisodeCreated:
        StatusPageSubscriberNotificationStatus.Failed,
      subscriberNotificationStatusMessage: "markdown exploded",
    });
    expect(
      IncidentEpisodeFeedService.createIncidentEpisodeFeedItem,
    ).not.toHaveBeenCalled();
  });

  test("logs, and does not throw, when even the Failed status cannot be written", async () => {
    pendingEpisodes = [episode()];
    mock(Markdown.convertToHTML).mockRejectedValue(
      new Error("markdown exploded") as never,
    );
    mock(IncidentEpisodeService.updateOneById)
      .mockResolvedValueOnce(1 as never)
      .mockRejectedValueOnce(new Error("database down") as never);

    await expect(runJob()).resolves.toBeUndefined();
    await flushPromises();

    expect(logger.error).toHaveBeenCalledWith(
      `Failed to update episode ${EPISODE_ID.toString()} status after error: database down`,
      expect.anything(),
    );
  });

  test("keeps going to a status page after another page fails", async () => {
    pendingEpisodes = [episode()];
    mock(StatusPageResourceService.findAllBy).mockResolvedValue([
      resource(STATUS_PAGE_ID),
      resource(SECOND_STATUS_PAGE_ID),
    ] as never);
    useStatusPages([statusPage({ id: SECOND_STATUS_PAGE_ID }), statusPage()]);
    mock(StatusPageSubscriberService.getSubscribersByStatusPage)
      .mockRejectedValueOnce(new Error("subscriber lookup failed") as never)
      .mockResolvedValue([subscriber()] as never);

    await runJob();

    expect(sentWebhooks()).toHaveLength(1);
    expect(sentWebhooks()[0]!["statusPageId"]).toBe(STATUS_PAGE_ID.toString());
    expect(feedItems()[0]!["displayColor"]).toEqual(Blue500);
    expect(
      statusWrites()[statusWrites().length - 1]![
        "subscriberNotificationStatusOnEpisodeCreated"
      ],
    ).toBe(StatusPageSubscriberNotificationStatus.Success);
  });

  test("handles each episode on its own in a multi-episode tick", async () => {
    pendingEpisodes = [
      episode({ id: SECOND_EPISODE_ID }),
      episode({ id: EPISODE_ID }),
    ];
    mock(IncidentEpisodeMemberService.findBy).mockImplementation(
      async (args: unknown) => {
        const query: JSONObject = (args as { query: JSONObject }).query;

        return (query["incidentEpisodeId"] as ObjectID).toString() ===
          SECOND_EPISODE_ID.toString()
          ? []
          : [member([MONITOR_ID])];
      },
    );

    await runJob();

    expect(
      writesFor(SECOND_EPISODE_ID).map((write: JSONObject) => {
        return write["subscriberNotificationStatusOnEpisodeCreated"];
      }),
    ).toEqual([StatusPageSubscriberNotificationStatus.Skipped]);
    expect(
      writesFor(EPISODE_ID).map((write: JSONObject) => {
        return write["subscriberNotificationStatusOnEpisodeCreated"];
      }),
    ).toEqual([
      StatusPageSubscriberNotificationStatus.InProgress,
      StatusPageSubscriberNotificationStatus.Success,
    ]);
    expect(sentMail()).toHaveLength(1);
    expect(sentWebhooks()).toHaveLength(1);
  });

  test("keeps going after one episode's status write fails", async () => {
    pendingEpisodes = [
      episode({ id: SECOND_EPISODE_ID }),
      episode({ id: EPISODE_ID }),
    ];
    mock(IncidentEpisodeService.updateOneById).mockRejectedValueOnce(
      new Error("database hiccup") as never,
    );

    await expect(runJob()).resolves.toBeUndefined();

    expect(sentMail()).toHaveLength(1);
    expect(
      writesFor(EPISODE_ID).map((write: JSONObject) => {
        return write["subscriberNotificationStatusOnEpisodeCreated"];
      }),
    ).toEqual([
      StatusPageSubscriberNotificationStatus.InProgress,
      StatusPageSubscriberNotificationStatus.Success,
    ]);
    expect(writesFor(SECOND_EPISODE_ID)[1]).toEqual({
      subscriberNotificationStatusOnEpisodeCreated:
        StatusPageSubscriberNotificationStatus.Failed,
      subscriberNotificationStatusMessage: "database hiccup",
    });
  });
});

describe("IncidentEpisode:SendNotificationToSubscribers default messages", () => {
  test("emails the episode-created template with every value", async () => {
    pendingEpisodes = [episode()];

    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["toEmail"]).toEqual(
      new Email("customer@example.com"),
    );
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberEpisodeCreated,
    );
    expect(sentMail()[0]!["subject"]).toBe(`[Incident] ${EPISODE_TITLE}`);
    expect(sentMail()[0]!["vars"]).toEqual({
      statusPageName: "Acme Status",
      statusPageUrl: STATUS_PAGE_URL,
      detailsUrl: DETAILS_URL,
      logoUrl: "",
      isPublicStatusPage: "true",
      resourcesAffected: RESOURCES_AFFECTED,
      episodeSeverity: SEVERITY,
      episodeTitle: EPISODE_TITLE,
      episodeDescription: EPISODE_DESCRIPTION_HTML,
      unsubscribeUrl: UNSUBSCRIBE_URL,
      subscriberEmailNotificationFooterText: "Footer text",
    });
    expect(
      (mock(MailService.sendMail).mock.calls[0]![1] as JSONObject)[
        "statusPageId"
      ],
    ).toEqual(STATUS_PAGE_ID);
  });

  test("links the status page logo and marks a private page in the default email", async () => {
    pendingEpisodes = [episode()];
    useStatusPages([statusPage({ withLogo: true, isPublicStatusPage: false })]);

    await runJob();

    const vars: JSONObject = sentMail()[0]!["vars"] as JSONObject;
    expect(vars["logoUrl"]).toBe(
      `https://oneuptime.acme.com/status-page-api/logo/${STATUS_PAGE_ID.toString()}`,
    );
    expect(vars["isPublicStatusPage"]).toBe("false");
  });

  test("sends the default SMS, matching the dashboard starter", async () => {
    pendingEpisodes = [episode()];

    await runJob();

    expect(sentSms()).toEqual([
      `Incident ${EPISODE_TITLE} (${SEVERITY}) on Acme Status. Impact: ${RESOURCES_AFFECTED}. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
    ]);
    expect(sentSms()[0]).toBe(
      dashboardDefault(StatusPageSubscriberNotificationMethod.SMS),
    );
    expect((firstArgs(SmsService.sendSms)[0]!["to"] as Phone).toString()).toBe(
      "+15555550100",
    );
  });

  test("sends the default Slack message, matching the dashboard starter", async () => {
    pendingEpisodes = [episode()];

    await runJob();

    expect(sentSlack()).toEqual([
      `## 🚨 Incident - ${EPISODE_TITLE}

**Severity:** ${SEVERITY}

**Resources Affected:** ${RESOURCES_AFFECTED}

**Description:** ${EPISODE_DESCRIPTION}

[View Status Page](${STATUS_PAGE_URL}) | [Unsubscribe](${UNSUBSCRIBE_URL})`,
    ]);
    expect(sentSlack()[0]).toBe(
      dashboardDefault(StatusPageSubscriberNotificationMethod.Slack),
    );
    expect(SlackUtil.convertMarkdownToSlackRichText).toHaveBeenCalledWith(
      sentSlack()[0],
    );
    expect(
      (
        firstArgs(SlackUtil.sendMessageToChannelViaIncomingWebhook)[0]![
          "url"
        ] as URL
      ).toString(),
    ).toBe(SLACK_URL);
  });

  test("sends the default Teams message without Slack conversion, matching the dashboard starter", async () => {
    pendingEpisodes = [episode()];

    await runJob();

    expect(sentTeams()).toEqual([
      `## 🚨 Incident - ${EPISODE_TITLE}
**Severity:** ${SEVERITY}
**Resources Affected:** ${RESOURCES_AFFECTED}
**Description:** ${EPISODE_DESCRIPTION}
[View Status Page](${STATUS_PAGE_URL}) | [Unsubscribe](${UNSUBSCRIBE_URL})`,
    ]);
    expect(sentTeams()[0]).toBe(
      dashboardDefault(StatusPageSubscriberNotificationMethod.MicrosoftTeams),
    );
    expect(SlackUtil.convertMarkdownToSlackRichText).not.toHaveBeenCalledWith(
      sentTeams()[0],
    );
    expect(
      (
        firstArgs(
          MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
        )[0]!["url"] as URL
      ).toString(),
    ).toBe(TEAMS_URL);
  });

  test("sends the fixed webhook payload, which is what the dashboard Webhook starter compiles to", async () => {
    pendingEpisodes = [episode()];

    await runJob();

    expect(sentWebhooks()).toHaveLength(1);

    const payload: JSONObject = sentWebhooks()[0]!;
    const data: JSONObject = payload["data"] as JSONObject;

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
    expect(payload["eventType"]).toBe("EpisodeCreated");
    expect(payload["statusPageId"]).toBe(STATUS_PAGE_ID.toString());
    expect(payload["statusPageName"]).toBe("Acme Status");
    expect(payload["statusPageUrl"]).toBe(STATUS_PAGE_URL);
    expect(payload["unsubscribeUrl"]).toBe(UNSUBSCRIBE_URL);
    expect(data).toEqual({
      episodeId: EPISODE_ID.toString(),
      episodeTitle: EPISODE_TITLE,
      episodeDescription: EPISODE_DESCRIPTION,
      incidentSeverity: SEVERITY,
      resourcesAffected: RESOURCES_AFFECTED,
      detailsUrl: DETAILS_URL,
    });
    expect(payload).toEqual(defaultWebhookPayload());

    const starter: string = dashboardStarter(
      StatusPageSubscriberNotificationMethod.Webhook,
    );
    expect(starter).not.toBe("");
    expect(
      StatusPageSubscriberWebhookTemplate.compile(starter, expectedVariables()),
    ).toEqual(payload);

    expect(
      (
        firstArgs(StatusPageSubscriberWebhookUtil.sendWebhookNotification)[0]![
          "webhookUrl"
        ] as URL
      ).toString(),
    ).toBe(WEBHOOK_URL);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("keeps the existing fallbacks when the episode has no severity", async () => {
    pendingEpisodes = [episode({ withoutSeverity: true })];

    await runJob();

    expect(sentSms()[0]).toContain(`Incident ${EPISODE_TITLE} (-) on`);
    expect(sentSlack()[0]).toContain("**Severity:**  - ");
    expect(sentTeams()[0]).toContain("**Severity:**  - ");
    expect((sentMail()[0]!["vars"] as JSONObject)["episodeSeverity"]).toBe(
      " - ",
    );
    expect((sentWebhooks()[0]!["data"] as JSONObject)["incidentSeverity"]).toBe(
      "",
    );
  });

  test("uses empty text for a missing title and description", async () => {
    pendingEpisodes = [episode({ title: "", description: "" })];

    await runJob();

    expect(sentMail()[0]!["subject"]).toBe("[Incident] ");
    expect(sentWebhooks()[0]!["data"]).toEqual(
      expect.objectContaining({ episodeTitle: "", episodeDescription: "" }),
    );
    expect(Markdown.convertToHTML).toHaveBeenCalledWith("", "Email");
  });

  test("only uses the channels a subscriber signed up with", async () => {
    pendingEpisodes = [episode()];
    useSubscribers([webhookOnlySubscriber()]);

    await runJob();

    expect(sentWebhooks()).toEqual([defaultWebhookPayload()]);
    expect(MailService.sendMail).not.toHaveBeenCalled();
    expect(SmsService.sendSms).not.toHaveBeenCalled();
    expect(
      SlackUtil.sendMessageToChannelViaIncomingWebhook,
    ).not.toHaveBeenCalled();
    expect(
      MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
    ).not.toHaveBeenCalled();
  });

  test("converts the description to HTML and plain text once per episode", async () => {
    pendingEpisodes = [episode()];
    useSubscribers([subscriber(), subscriber(SECOND_SUBSCRIBER_ID)]);

    await runJob();

    expect(Markdown.convertToHTML).toHaveBeenCalledTimes(1);
    expect(Markdown.convertToHTML).toHaveBeenCalledWith(
      EPISODE_DESCRIPTION,
      "Email",
    );
    expect(Markdown.convertToPlainText).toHaveBeenCalledTimes(1);
    expect(sentMail()).toHaveLength(2);
  });
});

describe("IncidentEpisode:SendNotificationToSubscribers template lookups", () => {
  test("looks up one template per channel, including Webhook, for the episode-created event", async () => {
    pendingEpisodes = [episode()];

    await runJob();

    expect(templateLookups()).toHaveLength(5);
    expect(
      templateLookups().map((lookup: JSONObject) => {
        return lookup["notificationMethod"];
      }),
    ).toEqual([
      StatusPageSubscriberNotificationMethod.Email,
      StatusPageSubscriberNotificationMethod.SMS,
      StatusPageSubscriberNotificationMethod.Slack,
      StatusPageSubscriberNotificationMethod.MicrosoftTeams,
      StatusPageSubscriberNotificationMethod.Webhook,
    ]);
    for (const lookup of templateLookups()) {
      expect(lookup["eventType"]).toBe(EVENT);
      expect((lookup["statusPageId"] as ObjectID).toString()).toBe(
        STATUS_PAGE_ID.toString(),
      );
    }
  });

  test("looks templates up once per status page, not once per subscriber", async () => {
    pendingEpisodes = [episode()];
    useSubscribers([
      subscriber(),
      subscriber(SECOND_SUBSCRIBER_ID),
      webhookOnlySubscriber(
        new ObjectID("67676767-6767-4767-8767-676767676767"),
      ),
    ]);

    await runJob();

    expect(templateLookups()).toHaveLength(5);
    expect(sentWebhooks()).toHaveLength(3);
  });

  test("looks templates up for each status page separately", async () => {
    pendingEpisodes = [episode()];
    mock(StatusPageResourceService.findAllBy).mockResolvedValue([
      resource(STATUS_PAGE_ID),
      resource(SECOND_STATUS_PAGE_ID),
    ] as never);
    useStatusPages([statusPage(), statusPage({ id: SECOND_STATUS_PAGE_ID })]);

    await runJob();

    expect(templateLookups()).toHaveLength(10);
    for (const pageId of [STATUS_PAGE_ID, SECOND_STATUS_PAGE_ID]) {
      const methods: Array<unknown> = templateLookups()
        .filter((lookup: JSONObject): boolean => {
          return (
            (lookup["statusPageId"] as ObjectID).toString() ===
            pageId.toString()
          );
        })
        .map((lookup: JSONObject) => {
          return lookup["notificationMethod"];
        });

      expect(methods).toContain(StatusPageSubscriberNotificationMethod.Webhook);
      expect(methods).toHaveLength(5);
    }
    expect(
      sentWebhooks().map((payload: JSONObject) => {
        return payload["statusPageId"];
      }),
    ).toEqual([STATUS_PAGE_ID.toString(), SECOND_STATUS_PAGE_ID.toString()]);
  });

  test("does not look templates up when the page hides episodes", async () => {
    pendingEpisodes = [episode()];
    useStatusPages([statusPage({ showEpisodesOnStatusPage: false })]);

    await runJob();

    expect(templateLookups()).toHaveLength(0);
  });
});

describe("IncidentEpisode:SendNotificationToSubscribers custom Webhook template", () => {
  test("sends the compiled JSON object in place of the default payload", async () => {
    pendingEpisodes = [episode()];
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Webhook]: {
        templateBody: `{
  "text": "{{episodeTitle}} on {{statusPageName}}",
  "episode": "{{episodeId}}",
  "page": "{{ statusPageId }}",
  "severity": "{{episodeSeverity}}",
  "links": { "details": "{{detailsUrl}}", "unsubscribe": "{{unsubscribeUrl}}" },
  "static": 42
}`,
      },
    });

    await runJob();

    expect(sentWebhooks()).toEqual([
      {
        text: `${EPISODE_TITLE} on Acme Status`,
        episode: EPISODE_ID.toString(),
        page: STATUS_PAGE_ID.toString(),
        severity: SEVERITY,
        links: { details: DETAILS_URL, unsubscribe: UNSUBSCRIBE_URL },
        static: 42,
      },
    ]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("keeps quotes, backslashes and newlines intact", async () => {
    const trickyTitle: string = 'Checkout "EU" down \\ retry $& $1 now';
    const trickyDescription: string =
      'Line one\nLine "two"\r\n\tC:\\path\\to {{episodeTitle}}';

    pendingEpisodes = [
      episode({ title: trickyTitle, description: trickyDescription }),
    ];
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Webhook]: {
        templateBody:
          '{"title": "{{episodeTitle}}", "description": "{{episodeDescription}}", "nested": {"both": "{{episodeTitle}} / {{statusPageName}}"}}',
      },
    });

    await runJob();

    const payload: JSONObject = sentWebhooks()[0]!;
    const expected: JSONObject = {
      title: trickyTitle,
      description: trickyDescription,
      nested: { both: `${trickyTitle} / Acme Status` },
    };

    expect(payload).toEqual(expected);
    expect(JSON.parse(JSON.stringify(payload))).toEqual(expected);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("gives each subscriber their own unsubscribe link", async () => {
    pendingEpisodes = [episode()];
    useSubscribers([
      webhookOnlySubscriber(),
      webhookOnlySubscriber(SECOND_SUBSCRIBER_ID),
    ]);
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Webhook]: {
        templateBody: '{"unsubscribe": "{{unsubscribeUrl}}"}',
      },
    });

    await runJob();

    expect(sentWebhooks()).toEqual([
      { unsubscribe: UNSUBSCRIBE_URL },
      { unsubscribe: unsubscribeUrlFor(SECOND_SUBSCRIBER_ID) },
    ]);
  });

  test("fills the raw description, not the SMS plain text or email HTML", async () => {
    pendingEpisodes = [episode()];
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Webhook]: {
        templateBody: '{"description": "{{episodeDescription}}"}',
      },
    });

    await runJob();

    expect(sentWebhooks()).toEqual([{ description: EPISODE_DESCRIPTION }]);
  });

  test.each([
    ["is not valid JSON", '{"title": {{episodeTitle}}}'],
    ["is not valid JSON at all", "Episode {{episodeTitle}} created"],
    ["is a JSON array", '[{"title": "{{episodeTitle}}"}]'],
    ["is a JSON string", '"{{episodeTitle}}"'],
    ["is JSON null", "null"],
  ])(
    "falls back to the default payload and warns when the template %s",
    async (_label: string, templateBody: string) => {
      pendingEpisodes = [episode()];
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Webhook]: { templateBody },
      });

      await runJob();

      expect(sentWebhooks()).toEqual([defaultWebhookPayload()]);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(STATUS_PAGE_ID.toString()),
        { statusPageId: STATUS_PAGE_ID.toString() },
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("EpisodeCreated"),
        expect.anything(),
      );
      expect(
        statusWrites()[statusWrites().length - 1]![
          "subscriberNotificationStatusOnEpisodeCreated"
        ],
      ).toBe(StatusPageSubscriberNotificationStatus.Success);
    },
  );

  test("treats an empty template body as no template", async () => {
    pendingEpisodes = [episode()];
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Webhook]: { templateBody: "" },
    });

    await runJob();

    expect(sentWebhooks()).toEqual([defaultWebhookPayload()]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("does not need a custom SMTP or SMS config", async () => {
    pendingEpisodes = [episode()];
    useStatusPages([statusPage()]);
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Webhook]: {
        templateBody: '{"title": "{{episodeTitle}}"}',
      },
    });

    await runJob();

    expect(sentWebhooks()).toEqual([{ title: EPISODE_TITLE }]);
  });

  test("leaves the other channels on their defaults", async () => {
    pendingEpisodes = [episode()];
    useStatusPages([
      statusPage({ withSmtpConfig: true, withCallSmsConfig: true }),
    ]);
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Webhook]: {
        templateBody: '{"title": "{{episodeTitle}}"}',
      },
    });

    await runJob();

    expect(sentWebhooks()).toEqual([{ title: EPISODE_TITLE }]);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberEpisodeCreated,
    );
    expect(sentSms()).toEqual([
      dashboardDefault(StatusPageSubscriberNotificationMethod.SMS),
    ]);
    expect(sentSlack()).toEqual([
      dashboardDefault(StatusPageSubscriberNotificationMethod.Slack),
    ]);
    expect(sentTeams()).toEqual([
      dashboardDefault(StatusPageSubscriberNotificationMethod.MicrosoftTeams),
    ]);
  });

  test("an unchanged dashboard Webhook starter sends exactly the default payload", async () => {
    pendingEpisodes = [episode()];
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Webhook]: {
        templateBody: dashboardStarter(
          StatusPageSubscriberNotificationMethod.Webhook,
        ),
      },
    });

    await runJob();

    expect(sentWebhooks()).toEqual([defaultWebhookPayload()]);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe("IncidentEpisode:SendNotificationToSubscribers custom text templates", () => {
  test("the dashboard starters for SMS, Slack and Teams send the default messages", async () => {
    pendingEpisodes = [episode()];
    useStatusPages([statusPage({ withCallSmsConfig: true })]);
    useTemplates({
      [StatusPageSubscriberNotificationMethod.SMS]: {
        templateBody: dashboardStarter(
          StatusPageSubscriberNotificationMethod.SMS,
        ),
      },
      [StatusPageSubscriberNotificationMethod.Slack]: {
        templateBody: dashboardStarter(
          StatusPageSubscriberNotificationMethod.Slack,
        ),
      },
      [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
        templateBody: dashboardStarter(
          StatusPageSubscriberNotificationMethod.MicrosoftTeams,
        ),
      },
    });

    await runJob();

    /*
     * A custom SMS template gets the plain-text description; the SMS starter
     * does not use it, so it still matches the default.
     */
    expect(sentSms()).toEqual([
      dashboardDefault(StatusPageSubscriberNotificationMethod.SMS),
    ]);
    expect(sentSlack()).toEqual([
      dashboardDefault(StatusPageSubscriberNotificationMethod.Slack),
    ]);
    expect(sentTeams()).toEqual([
      dashboardDefault(StatusPageSubscriberNotificationMethod.MicrosoftTeams),
    ]);
  });

  test("uses a custom email template and subject only with a custom SMTP config", async () => {
    pendingEpisodes = [episode()];
    useStatusPages([statusPage({ withSmtpConfig: true })]);
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Email]: {
        templateBody: "<p>{{episodeTitle}} ({{episodeId}})</p>",
        emailSubject: "{{episodeTitle}} on {{statusPageName}}",
      },
    });

    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.BlankTemplate,
    );
    expect(sentMail()[0]!["subject"]).toBe(`${EPISODE_TITLE} on Acme Status`);
    expect(sentMail()[0]!["vars"]).toEqual({
      body: `<p>${EPISODE_TITLE} (${EPISODE_ID.toString()})</p>`,
    });
  });

  test("falls back to the default subject when a custom email template has none", async () => {
    pendingEpisodes = [episode()];
    useStatusPages([statusPage({ withSmtpConfig: true })]);
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Email]: {
        templateBody: "<p>{{episodeTitle}}</p>",
      },
    });

    await runJob();

    expect(sentMail()[0]!["subject"]).toBe(`[Incident] ${EPISODE_TITLE}`);
  });

  test("ignores a custom email template without a custom SMTP config", async () => {
    pendingEpisodes = [episode()];
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Email]: {
        templateBody: "<p>{{episodeTitle}}</p>",
      },
    });

    await runJob();

    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberEpisodeCreated,
    );
  });

  test("ignores a custom SMS template without a custom SMS config", async () => {
    pendingEpisodes = [episode()];
    useTemplates({
      [StatusPageSubscriberNotificationMethod.SMS]: {
        templateBody: "Custom {{episodeTitle}}",
      },
    });

    await runJob();

    expect(sentSms()).toEqual([
      dashboardDefault(StatusPageSubscriberNotificationMethod.SMS),
    ]);
  });

  test("fills a custom SMS template with the plain-text description", async () => {
    pendingEpisodes = [episode()];
    useStatusPages([statusPage({ withCallSmsConfig: true })]);
    useTemplates({
      [StatusPageSubscriberNotificationMethod.SMS]: {
        templateBody: "{{episodeTitle}}: {{episodeDescription}}",
      },
    });

    await runJob();

    expect(sentSms()).toEqual([
      `${EPISODE_TITLE}: ${EPISODE_DESCRIPTION_TEXT}`,
    ]);
  });

  test("sends a custom Teams template as-is", async () => {
    pendingEpisodes = [episode()];
    useTemplates({
      [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
        templateBody: "**{{episodeTitle}}** - {{episodeDescription}}",
      },
    });

    await runJob();

    expect(sentTeams()).toEqual([
      `**${EPISODE_TITLE}** - ${EPISODE_DESCRIPTION}`,
    ]);
    expect(sentSlack()).toEqual([
      dashboardDefault(StatusPageSubscriberNotificationMethod.Slack),
    ]);
  });
});

interface TextChannelCase {
  name: string;
  method: StatusPageSubscriberNotificationMethod;
  page: StatusPage;
  sent: () => Array<string>;
  episodeDescription: string;
}

describe("IncidentEpisode:SendNotificationToSubscribers fills every variable", () => {
  test("the expected values cover exactly the variables the dashboard documents", () => {
    expect(Object.keys(expectedVariables()).sort()).toEqual(
      [...ALL_VARIABLE_NAMES].sort(),
    );
    expect(ALL_VARIABLE_NAMES).toContain("statusPageId");
    expect(ALL_VARIABLE_NAMES).toContain("episodeId");
  });

  const textChannels: Array<TextChannelCase> = [
    {
      name: "Email",
      method: StatusPageSubscriberNotificationMethod.Email,
      page: statusPage({ withSmtpConfig: true }),
      sent: sentMailBodies,
      episodeDescription: EPISODE_DESCRIPTION,
    },
    {
      name: "SMS",
      method: StatusPageSubscriberNotificationMethod.SMS,
      page: statusPage({ withCallSmsConfig: true }),
      sent: sentSms,
      episodeDescription: EPISODE_DESCRIPTION_TEXT,
    },
    {
      name: "Slack",
      method: StatusPageSubscriberNotificationMethod.Slack,
      page: statusPage(),
      sent: sentSlack,
      episodeDescription: EPISODE_DESCRIPTION,
    },
    {
      name: "Microsoft Teams",
      method: StatusPageSubscriberNotificationMethod.MicrosoftTeams,
      page: statusPage(),
      sent: sentTeams,
      episodeDescription: EPISODE_DESCRIPTION,
    },
  ];

  test.each(textChannels)(
    "$name: a template using every variable compiles completely",
    async (channel: TextChannelCase) => {
      pendingEpisodes = [episode()];
      useStatusPages([channel.page]);
      useTemplates({
        [channel.method]: {
          templateBody: everyVariableTemplate(),
          emailSubject: "{{episodeId}} {{statusPageId}}",
        },
      });

      await runJob();

      const messages: Array<string> = channel.sent();

      expect(messages).toHaveLength(1);
      expect(messages[0]).not.toContain("{{");
      expect(messages[0]).toBe(
        everyVariableMessage({
          ...expectedVariables(),
          episodeDescription: channel.episodeDescription,
        }),
      );
      expect(messages[0]).toContain(
        `statusPageId=[${STATUS_PAGE_ID.toString()}]`,
      );
      expect(messages[0]).toContain(`episodeId=[${EPISODE_ID.toString()}]`);
    },
  );

  test("Email: a custom subject can use the new id variables", async () => {
    pendingEpisodes = [episode()];
    useStatusPages([statusPage({ withSmtpConfig: true })]);
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Email]: {
        templateBody: everyVariableTemplate(),
        emailSubject: "{{episodeId}} {{statusPageId}}",
      },
    });

    await runJob();

    expect(sentMail()[0]!["subject"]).toBe(
      `${EPISODE_ID.toString()} ${STATUS_PAGE_ID.toString()}`,
    );
  });

  test("Webhook: a template using every variable compiles completely", async () => {
    pendingEpisodes = [episode()];
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Webhook]: {
        templateBody: everyVariableWebhookTemplate(),
      },
    });

    await runJob();

    expect(sentWebhooks()).toHaveLength(1);
    expect(JSON.stringify(sentWebhooks()[0])).not.toContain("{{");
    expect(sentWebhooks()[0]).toEqual(expectedVariables());
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("every channel with a custom template at once", async () => {
    pendingEpisodes = [episode()];
    useStatusPages([
      statusPage({ withSmtpConfig: true, withCallSmsConfig: true }),
    ]);
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Email]: {
        templateBody: everyVariableTemplate(),
      },
      [StatusPageSubscriberNotificationMethod.SMS]: {
        templateBody: everyVariableTemplate(),
      },
      [StatusPageSubscriberNotificationMethod.Slack]: {
        templateBody: everyVariableTemplate(),
      },
      [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
        templateBody: everyVariableTemplate(),
      },
      [StatusPageSubscriberNotificationMethod.Webhook]: {
        templateBody: everyVariableWebhookTemplate(),
      },
    });

    await runJob();

    for (const message of [
      ...sentMailBodies(),
      ...sentSms(),
      ...sentSlack(),
      ...sentTeams(),
      JSON.stringify(sentWebhooks()),
    ]) {
      expect(message).not.toContain("{{");
    }
    expect(sentMailBodies()).toHaveLength(1);
    expect(sentSms()).toHaveLength(1);
    expect(sentSlack()).toHaveLength(1);
    expect(sentTeams()).toHaveLength(1);
    expect(sentWebhooks()).toEqual([expectedVariables()]);
  });
});

describe("IncidentEpisode:SendNotificationToSubscribers failure isolation", () => {
  test("a rejected webhook send does not stop the other channels or fail the job", async () => {
    pendingEpisodes = [episode()];
    useSubscribers([subscriber(), subscriber(SECOND_SUBSCRIBER_ID)]);
    const failure: Error = new Error("webhook endpoint down");
    mock(StatusPageSubscriberWebhookUtil.sendWebhookNotification)
      .mockRejectedValueOnce(failure as never)
      .mockResolvedValue(undefined as never);

    await runJob();
    await flushPromises();

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
    expect(statusWrites()[statusWrites().length - 1]).toEqual({
      subscriberNotificationStatusOnEpisodeCreated:
        StatusPageSubscriberNotificationStatus.Success,
      subscriberNotificationStatusMessage:
        "Notifications sent successfully to all subscribers",
    });
    expect(feedItems()[0]!["displayColor"]).toEqual(Blue500);
  });

  test("a rejected webhook send with a custom template is handled the same way", async () => {
    pendingEpisodes = [episode()];
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Webhook]: {
        templateBody: '{"title": "{{episodeTitle}}"}',
      },
    });
    const failure: Error = new Error("webhook endpoint down");
    mock(
      StatusPageSubscriberWebhookUtil.sendWebhookNotification,
    ).mockRejectedValue(failure as never);

    await runJob();
    await flushPromises();

    expect(sentWebhooks()).toEqual([{ title: EPISODE_TITLE }]);
    expect(logger.error).toHaveBeenCalledWith(failure, expect.anything());
    expect(
      statusWrites()[statusWrites().length - 1]![
        "subscriberNotificationStatusOnEpisodeCreated"
      ],
    ).toBe(StatusPageSubscriberNotificationStatus.Success);
  });

  test("a rejected Teams send does not stop the webhook or fail the job", async () => {
    pendingEpisodes = [episode()];
    const failure: Error = new Error("teams webhook gone");
    mock(
      MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
    ).mockRejectedValue(failure as never);

    await runJob();
    await flushPromises();

    expect(sentTeams()).toHaveLength(1);
    expect(sentWebhooks()).toEqual([defaultWebhookPayload()]);
    expect(logger.error).toHaveBeenCalledWith(failure, expect.anything());
    expect(
      statusWrites()[statusWrites().length - 1]![
        "subscriberNotificationStatusOnEpisodeCreated"
      ],
    ).toBe(StatusPageSubscriberNotificationStatus.Success);
  });

  const otherSenders: Array<[string, unknown]> = [
    ["email", MailService.sendMail],
    ["SMS", SmsService.sendSms],
    ["Slack", SlackUtil.sendMessageToChannelViaIncomingWebhook],
  ];

  test.each(otherSenders)(
    "a rejected %s send does not stop the webhook",
    async (_label: string, sender: unknown) => {
      pendingEpisodes = [episode()];
      mock(sender).mockRejectedValue(new Error("send failed") as never);

      await runJob();
      await flushPromises();

      expect(sentWebhooks()).toEqual([defaultWebhookPayload()]);
      expect(sentTeams()).toHaveLength(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: "send failed" }),
        expect.anything(),
      );
      expect(
        statusWrites()[statusWrites().length - 1]![
          "subscriberNotificationStatusOnEpisodeCreated"
        ],
      ).toBe(StatusPageSubscriberNotificationStatus.Success);
    },
  );

  test("a subscriber whose send throws does not stop the next subscriber", async () => {
    pendingEpisodes = [episode()];
    useSubscribers([subscriber(), subscriber(SECOND_SUBSCRIBER_ID)]);
    mock(SmsService.sendSms).mockImplementationOnce(() => {
      throw new Error("sms client broke");
    });

    await runJob();

    // The first subscriber got email, then SMS threw before the other channels.
    expect(sentMail()).toHaveLength(2);
    expect(sentSlack()).toHaveLength(1);
    expect(sentTeams()).toHaveLength(1);
    expect(sentWebhooks()).toEqual([
      {
        ...defaultWebhookPayload(),
        unsubscribeUrl: unsubscribeUrlFor(SECOND_SUBSCRIBER_ID),
      },
    ]);
    expect(
      statusWrites()[statusWrites().length - 1]![
        "subscriberNotificationStatusOnEpisodeCreated"
      ],
    ).toBe(StatusPageSubscriberNotificationStatus.Success);
  });
});
