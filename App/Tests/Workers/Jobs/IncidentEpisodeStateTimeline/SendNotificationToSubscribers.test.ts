import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import { IncidentEpisodeFeedEventType } from "Common/Models/DatabaseModels/IncidentEpisodeFeed";
import IncidentEpisodeMember from "Common/Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodeStateTimeline from "Common/Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
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
 * Incident episode state change notifications. These tests drive one tick of
 * the job against fakes and check what each channel's subscribers receive,
 * which custom templates are read and how they are filled, and which status
 * columns and feed items the job writes. The Webhook template compiler is the
 * real one, so a Webhook template is checked end to end.
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

jest.mock("Common/Server/Services/IncidentEpisodeStateTimelineService", () => {
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
    default: {
      toTwilioConfig: jest.fn((config: unknown) => {
        return config ? { accountSid: "custom-twilio" } : undefined;
      }),
    },
  };
});

jest.mock("Common/Server/Services/ProjectSmtpConfigService", () => {
  return {
    __esModule: true,
    default: {
      toEmailServer: jest.fn((config: unknown) => {
        return config ? { host: "smtp.acme.com" } : undefined;
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
import IncidentEpisodeFeedService from "Common/Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeMemberService from "Common/Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "Common/Server/Services/IncidentEpisodeStateTimelineService";
import MailService from "Common/Server/Services/MailService";
import SmsService from "Common/Server/Services/SmsService";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import logger from "Common/Server/Utils/Logger";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
import StatusPageSubscriberWebhookTemplate from "Common/Server/Utils/StatusPageSubscriberWebhookTemplate";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import { getDefaultSubscriberNotificationTemplate } from "../../../../FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateDefaults";
import "../../../../FeatureSet/Workers/Jobs/IncidentEpisodeStateTimeline/SendNotificationToSubscribers";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const JOB: string =
  "IncidentEpisodeStateTimeline:SendNotificationToSubscribers";

const EVENT: StatusPageSubscriberNotificationEventType =
  StatusPageSubscriberNotificationEventType.SubscriberEpisodeStateChanged;

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
const TIMELINE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const SECOND_TIMELINE_ID: ObjectID = new ObjectID(
  "46464646-4646-4646-8646-464646464646",
);
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const SECOND_SUBSCRIBER_ID: ObjectID = new ObjectID(
  "56565656-5656-4656-8656-565656565656",
);
const INCIDENT_STATE_ID: ObjectID = new ObjectID(
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
const SECOND_STATUS_PAGE_URL: string = "https://status.other.com";
const DETAILS_URL: string = `${STATUS_PAGE_URL}/episodes/${EPISODE_ID.toString()}`;
const UNSUBSCRIBE_URL: string = `${STATUS_PAGE_URL}/update-subscription/${SUBSCRIBER_ID.toString()}`;
const DASHBOARD_URL: string = "https://oneuptime.acme.com/dashboard/episode/1";
const WEBHOOK_URL: string = "https://hooks.acme.com/status";
const SLACK_URL: string = "https://hooks.slack.com/services/T000/B000/XXXX";
const TEAMS_URL: string = "https://outlook.office.com/webhook/abc";

const EPISODE_TITLE: string = "Regional network interruption";
const STATE_NAME: string = "Investigating";
const SEVERITY_NAME: string = "Major";
const RESOURCE_NAME: string = "Edge network";

/*
 * What every custom template for this event should be filled with, for the
 * default fixtures below. The keys are checked against the shared variable
 * list, so a variable added there without a value here fails the suite.
 */
const EXPECTED_VARIABLES: Record<string, string> = {
  statusPageName: "Acme Status",
  statusPageUrl: STATUS_PAGE_URL,
  statusPageId: STATUS_PAGE_ID.toString(),
  unsubscribeUrl: UNSUBSCRIBE_URL,
  resourcesAffected: RESOURCE_NAME,
  episodeId: EPISODE_ID.toString(),
  episodeTitle: EPISODE_TITLE,
  episodeSeverity: SEVERITY_NAME,
  episodeState: STATE_NAME,
  detailsUrl: DETAILS_URL,
};

let skippedTimelines: Array<IncidentEpisodeStateTimeline> = [];
let pendingTimelines: Array<IncidentEpisodeStateTimeline> = [];
let storedEpisode: IncidentEpisode | null = null;
let members: Array<IncidentEpisodeMember> = [];
let customTemplates: Partial<
  Record<
    StatusPageSubscriberNotificationMethod,
    StatusPageSubscriberNotificationTemplate
  >
> = {};

interface TimelineOverrides {
  id?: ObjectID;
  stateName?: string;
  isCreatedState?: boolean;
  withoutEpisodeId?: boolean;
  withoutStateId?: boolean;
  withoutState?: boolean;
}

function stateTimeline(
  overrides?: TimelineOverrides,
): IncidentEpisodeStateTimeline {
  const row: IncidentEpisodeStateTimeline = new IncidentEpisodeStateTimeline();
  row._id = (overrides?.id || TIMELINE_ID).toString();
  row.projectId = PROJECT_ID;

  if (!overrides?.withoutEpisodeId) {
    row.incidentEpisodeId = EPISODE_ID;
  }

  if (!overrides?.withoutStateId) {
    row.incidentStateId = INCIDENT_STATE_ID;
  }

  if (!overrides?.withoutState) {
    const state: IncidentState = new IncidentState();
    state.name =
      overrides?.stateName !== undefined ? overrides.stateName : STATE_NAME;
    state.isCreatedState = overrides?.isCreatedState === true;
    row.incidentState = state;
  }

  return row;
}

function episode(overrides?: {
  isVisibleOnStatusPage?: boolean;
  title?: string;
  withoutSeverity?: boolean;
  withoutEpisodeNumber?: boolean;
}): IncidentEpisode {
  const row: IncidentEpisode = new IncidentEpisode();
  row._id = EPISODE_ID.toString();
  row.title = overrides?.title !== undefined ? overrides.title : EPISODE_TITLE;
  row.projectId = PROJECT_ID;
  row.isVisibleOnStatusPage = overrides?.isVisibleOnStatusPage !== false;

  if (!overrides?.withoutEpisodeNumber) {
    row.episodeNumber = 3;
  }

  if (!overrides?.withoutSeverity) {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity.name = SEVERITY_NAME;
    row.incidentSeverity = severity;
  }

  return row;
}

function monitor(id: ObjectID): Monitor {
  const row: Monitor = new Monitor();
  row._id = id.toString();
  return row;
}

function member(monitors: Array<Monitor> | undefined): IncidentEpisodeMember {
  const row: IncidentEpisodeMember = new IncidentEpisodeMember();
  const incident: Incident = new Incident();

  if (monitors) {
    incident.monitors = monitors;
  }

  row.incident = incident;
  return row;
}

function statusPage(overrides?: {
  id?: ObjectID | null;
  showEpisodesOnStatusPage?: boolean;
  withSmtpConfig?: boolean;
  withCallSmsConfig?: boolean;
  withLogo?: boolean;
  withoutPageTitle?: boolean;
  isPublicStatusPage?: boolean;
}): StatusPage {
  const page: StatusPage = new StatusPage();

  if (overrides?.id !== null) {
    page._id = (overrides?.id || STATUS_PAGE_ID).toString();
  }

  page.projectId = PROJECT_ID;
  page.name = "Acme";

  if (!overrides?.withoutPageTitle) {
    page.pageTitle = "Acme Status";
  }

  page.isPublicStatusPage = overrides?.isPublicStatusPage !== false;
  page.showEpisodesOnStatusPage = overrides?.showEpisodesOnStatusPage !== false;

  if (overrides?.withSmtpConfig) {
    page.smtpConfig = new ProjectSmtpConfig();
  }

  if (overrides?.withCallSmsConfig) {
    page.callSmsConfig = new ProjectCallSMSConfig();
  }

  if (overrides?.withLogo) {
    page.logoFileId = LOGO_FILE_ID;
  }

  return page;
}

function resource(overrides?: {
  statusPageId?: ObjectID | null;
  displayName?: string;
}): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = "88888888-8888-4888-8888-888888888888";

  if (overrides?.statusPageId !== null) {
    row.statusPageId = overrides?.statusPageId || STATUS_PAGE_ID;
  }

  if (overrides?.displayName !== "") {
    row.displayName = overrides?.displayName || RESOURCE_NAME;
  }

  return row;
}

type SubscriberChannel = "email" | "sms" | "slack" | "teams" | "webhook";

const ALL_CHANNELS: Array<SubscriberChannel> = [
  "email",
  "sms",
  "slack",
  "teams",
  "webhook",
];

function subscriber(overrides?: {
  id?: ObjectID | null;
  channels?: Array<SubscriberChannel>;
}): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  const channels: Array<SubscriberChannel> =
    overrides?.channels || ALL_CHANNELS;

  if (overrides?.id !== null) {
    row._id = (overrides?.id || SUBSCRIBER_ID).toString();
  }

  if (channels.includes("email")) {
    row.subscriberEmail = new Email("customer@example.com");
  }

  if (channels.includes("sms")) {
    row.subscriberPhone = new Phone("+15555550100");
  }

  if (channels.includes("slack")) {
    row.slackIncomingWebhookUrl = URL.fromString(SLACK_URL);
  }

  if (channels.includes("teams")) {
    row.microsoftTeamsIncomingWebhookUrl = URL.fromString(TEAMS_URL);
  }

  if (channels.includes("webhook")) {
    row.subscriberWebhook = URL.fromString(WEBHOOK_URL);
  }

  return row;
}

function template(data: {
  templateBody: string;
  emailSubject?: string;
}): StatusPageSubscriberNotificationTemplate {
  const row: StatusPageSubscriberNotificationTemplate =
    new StatusPageSubscriberNotificationTemplate();
  row.templateBody = data.templateBody;

  if (data.emailSubject) {
    row.emailSubject = data.emailSubject;
  }

  return row;
}

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
}

function statusWrites(): Array<JSONObject> {
  return mock(IncidentEpisodeStateTimelineService.updateOneById).mock.calls.map(
    (call: Array<unknown>): JSONObject => {
      return (call[0] as { data: JSONObject }).data;
    },
  );
}

function writesFor(id: ObjectID): Array<JSONObject> {
  return mock(IncidentEpisodeStateTimelineService.updateOneById)
    .mock.calls.filter((call: Array<unknown>): boolean => {
      return (call[0] as { id: ObjectID }).id.toString() === id.toString();
    })
    .map((call: Array<unknown>): JSONObject => {
      return (call[0] as { data: JSONObject }).data;
    });
}

function inProgressThen(finalWrite: JSONObject): Array<JSONObject> {
  return [
    {
      subscriberNotificationStatus:
        StatusPageSubscriberNotificationStatus.InProgress,
    },
    finalWrite,
  ];
}

function skipped(message: string): JSONObject {
  return {
    subscriberNotificationStatus:
      StatusPageSubscriberNotificationStatus.Skipped,
    subscriberNotificationStatusMessage: message,
  };
}

const SUCCESS_WRITE: JSONObject = {
  subscriberNotificationStatus: StatusPageSubscriberNotificationStatus.Success,
  subscriberNotificationStatusMessage:
    "Notifications sent successfully to all subscribers",
};

function mailCalls(): Array<{ mail: JSONObject; options: JSONObject }> {
  return mock(MailService.sendMail).mock.calls.map(
    (call: Array<unknown>): { mail: JSONObject; options: JSONObject } => {
      return {
        mail: call[0] as JSONObject,
        options: call[1] as JSONObject,
      };
    },
  );
}

function sentMail(): Array<JSONObject> {
  return mailCalls().map(
    (call: { mail: JSONObject; options: JSONObject }): JSONObject => {
      return call.mail;
    },
  );
}

function smsCalls(): Array<{ sms: JSONObject; options: JSONObject }> {
  return mock(SmsService.sendSms).mock.calls.map(
    (call: Array<unknown>): { sms: JSONObject; options: JSONObject } => {
      return {
        sms: call[0] as JSONObject,
        options: call[1] as JSONObject,
      };
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

function webhookCalls(): Array<{ webhookUrl: URL; payload: JSONObject }> {
  return mock(
    StatusPageSubscriberWebhookUtil.sendWebhookNotification,
  ).mock.calls.map(
    (call: Array<unknown>): { webhookUrl: URL; payload: JSONObject } => {
      return call[0] as { webhookUrl: URL; payload: JSONObject };
    },
  );
}

function sentWebhooks(): Array<JSONObject> {
  return webhookCalls().map(
    (call: { webhookUrl: URL; payload: JSONObject }): JSONObject => {
      return call.payload;
    },
  );
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

function dashboardTemplate(
  method: StatusPageSubscriberNotificationMethod,
): string {
  return getDefaultSubscriberNotificationTemplate(EVENT, method)?.body || "";
}

function dashboardDefault(
  method: StatusPageSubscriberNotificationMethod,
  variables?: Record<string, string>,
): string {
  const values: Record<string, string> = variables || EXPECTED_VARIABLES;

  return dashboardTemplate(method).replace(
    /{{\s*(\w+)\s*}}/g,
    (_match: string, key: string) => {
      return values[key] ?? "";
    },
  );
}

function variableNames(): Array<string> {
  return SubscriberNotificationTemplateVariables.getVariableNames(EVENT);
}

// A text template that names every variable, and what it should compile to.
function everyVariableTemplate(): string {
  return variableNames()
    .map((name: string): string => {
      return `${name}=[{{${name}}}]`;
    })
    .join("\n");
}

function everyVariableCompiled(): string {
  return variableNames()
    .map((name: string): string => {
      return `${name}=[${EXPECTED_VARIABLES[name]}]`;
    })
    .join("\n");
}

function everyVariableWebhookTemplate(): string {
  const fields: Array<string> = variableNames().map((name: string): string => {
    return `  "${name}": "{{${name}}}"`;
  });

  return `{\n${fields.join(",\n")}\n}`;
}

function useTemplates(
  templates: Partial<
    Record<
      StatusPageSubscriberNotificationMethod,
      StatusPageSubscriberNotificationTemplate
    >
  >,
): void {
  customTemplates = templates;
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

async function flushPromises(): Promise<void> {
  await new Promise((resolve: (value: unknown) => void) => {
    setImmediate(resolve);
  });
}

async function runJob(): Promise<void> {
  expect(mockCapturedJobs[JOB]).toBeDefined();
  await mockCapturedJobs[JOB]!();
  await flushPromises();
}

beforeEach(() => {
  jest.clearAllMocks();

  skippedTimelines = [];
  pendingTimelines = [stateTimeline()];
  storedEpisode = episode();
  members = [member([monitor(MONITOR_ID)])];
  customTemplates = {};

  mock(IncidentEpisodeStateTimelineService.findBy).mockImplementation(
    async (args: unknown): Promise<Array<IncidentEpisodeStateTimeline>> => {
      const query: JSONObject = (args as { query: JSONObject }).query;

      return query["shouldStatusPageSubscribersBeNotified"] === false
        ? skippedTimelines
        : pendingTimelines;
    },
  );
  mock(IncidentEpisodeStateTimelineService.updateOneById).mockResolvedValue(
    1 as never,
  );

  mock(IncidentEpisodeService.findOneById).mockImplementation(async () => {
    return storedEpisode;
  });
  mock(IncidentEpisodeService.getEpisodeLinkInDashboard).mockResolvedValue(
    URL.fromString(DASHBOARD_URL) as never,
  );
  mock(IncidentEpisodeMemberService.findBy).mockImplementation(async () => {
    return members;
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
  useSubscribers([subscriber()]);
  mock(StatusPageSubscriberService.shouldSendNotification).mockReturnValue(
    true,
  );
  mock(StatusPageSubscriberService.getUnsubscribeLink).mockImplementation(
    (statusPageUrl: unknown, subscriberId: unknown): URL => {
      return URL.fromString(
        `${(statusPageUrl as URL).toString()}/update-subscription/${(subscriberId as ObjectID).toString()}`,
      );
    },
  );
  mock(StatusPageService.getStatusPageURL).mockImplementation(
    async (statusPageId: unknown): Promise<string> => {
      return (statusPageId as ObjectID).toString() ===
        SECOND_STATUS_PAGE_ID.toString()
        ? SECOND_STATUS_PAGE_URL
        : STATUS_PAGE_URL;
    },
  );
  mock(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
  ).mockImplementation(
    async (
      args: unknown,
    ): Promise<StatusPageSubscriberNotificationTemplate | null> => {
      const method: StatusPageSubscriberNotificationMethod = (
        args as { notificationMethod: StatusPageSubscriberNotificationMethod }
      ).notificationMethod;

      return customTemplates[method] || null;
    },
  );

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

describe("IncidentEpisodeStateTimeline:SendNotificationToSubscribers", () => {
  test("keeps the expected variable values in step with the shared variable list", () => {
    expect(Object.keys(EXPECTED_VARIABLES).sort()).toEqual(
      [...variableNames()].sort(),
    );
  });

  describe("status bookkeeping", () => {
    test("is registered as a cron job", () => {
      expect(mockCapturedJobs[JOB]).toBeDefined();
    });

    test("first looks for pending timelines whose subscribers should not be notified, then for the ones that should", async () => {
      await runJob();

      const calls: Array<{
        query: JSONObject;
        select: JSONObject;
        props: JSONObject;
      }> = mock(IncidentEpisodeStateTimelineService.findBy).mock.calls.map(
        (
          call: Array<unknown>,
        ): { query: JSONObject; select: JSONObject; props: JSONObject } => {
          return call[0] as {
            query: JSONObject;
            select: JSONObject;
            props: JSONObject;
          };
        },
      );

      expect(calls).toHaveLength(2);
      expect(calls[0]!.query).toEqual({
        subscriberNotificationStatus:
          StatusPageSubscriberNotificationStatus.Pending,
        shouldStatusPageSubscribersBeNotified: false,
      });
      expect(calls[0]!.select).toEqual({ _id: true });
      expect(calls[1]!.query).toEqual({
        subscriberNotificationStatus:
          StatusPageSubscriberNotificationStatus.Pending,
        shouldStatusPageSubscribersBeNotified: true,
      });
      expect(calls[1]!.select).toEqual({
        _id: true,
        projectId: true,
        incidentEpisodeId: true,
        incidentStateId: true,
        incidentState: {
          name: true,
          isCreatedState: true,
        },
      });
      expect(calls[1]!.props).toEqual({ isRoot: true });
    });

    test("marks timelines that should not notify subscribers as Skipped without sending anything", async () => {
      skippedTimelines = [
        stateTimeline(),
        stateTimeline({ id: SECOND_TIMELINE_ID }),
      ];
      pendingTimelines = [];

      await runJob();

      nothingSent();
      const skipWrite: JSONObject = skipped(
        "Notifications skipped as subscribers are not to be notified for this state change.",
      );
      expect(writesFor(TIMELINE_ID)).toEqual([skipWrite]);
      expect(writesFor(SECOND_TIMELINE_ID)).toEqual([skipWrite]);
      expect(IncidentEpisodeService.findOneById).not.toHaveBeenCalled();
      expect(feedItems()).toHaveLength(0);
    });

    test("does nothing when no timeline is pending", async () => {
      pendingTimelines = [];

      await runJob();

      nothingSent();
      expect(statusWrites()).toEqual([]);
      expect(feedItems()).toHaveLength(0);
    });

    test("records progress, then success", async () => {
      await runJob();

      expect(statusWrites()).toEqual(inProgressThen(SUCCESS_WRITE));
    });

    test("writes every status without hooks so it never re-queues itself", async () => {
      skippedTimelines = [stateTimeline({ id: SECOND_TIMELINE_ID })];

      await runJob();

      const calls: Array<unknown> = mock(
        IncidentEpisodeStateTimelineService.updateOneById,
      ).mock.calls;

      expect(calls).toHaveLength(3);
      for (const call of calls) {
        expect(((call as Array<unknown>)[0] as JSONObject)["props"]).toEqual({
          isRoot: true,
          ignoreHooks: true,
        });
      }
    });

    test("records in the episode feed that subscribers were notified", async () => {
      await runJob();

      expect(feedItems()).toEqual([
        {
          incidentEpisodeId: EPISODE_ID,
          projectId: PROJECT_ID,
          incidentEpisodeFeedEventType:
            IncidentEpisodeFeedEventType.SubscriberNotificationSent,
          displayColor: Blue500,
          feedInfoInMarkdown: `📧 **Status Page Subscribers have been notified** about the state change of the [Episode 3](${DASHBOARD_URL}) to **${STATE_NAME}**`,
        },
      ]);
      expect(
        IncidentEpisodeService.getEpisodeLinkInDashboard,
      ).toHaveBeenCalledWith(PROJECT_ID, EPISODE_ID);
    });

    test("uses a dash for the episode number when there is none", async () => {
      storedEpisode = episode({ withoutEpisodeNumber: true });

      await runJob();

      expect(feedItems()[0]!["feedInfoInMarkdown"]).toContain(
        `[Episode  - ](${DASHBOARD_URL})`,
      );
    });

    test("records in the feed when no subscriber matched, and still finishes with success", async () => {
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
          feedInfoInMarkdown: `📧 **No notification sent to subscribers** for the state change of [Episode 3](${DASHBOARD_URL}) to **${STATE_NAME}**`,
          moreInformationInMarkdown:
            "Subscriber notifications were skipped because all associated status pages either hide episodes or had no matching subscribers.",
        },
      ]);
      expect(statusWrites()).toEqual(inProgressThen(SUCCESS_WRITE));
    });

    test("handles each pending timeline on its own in a multi-timeline tick", async () => {
      pendingTimelines = [
        stateTimeline({ withoutEpisodeId: true }),
        stateTimeline({ id: SECOND_TIMELINE_ID }),
      ];

      await runJob();

      expect(writesFor(TIMELINE_ID)).toEqual(
        inProgressThen(
          skipped(
            "Missing episode or incident state reference. Skipping notifications.",
          ),
        ),
      );
      expect(writesFor(SECOND_TIMELINE_ID)).toEqual(
        inProgressThen(SUCCESS_WRITE),
      );
      expect(sentMail()).toHaveLength(1);
      expect(feedItems()).toHaveLength(1);
    });
  });

  describe("skip paths", () => {
    test.each<[string, TimelineOverrides, string]>([
      [
        "the episode reference is missing",
        { withoutEpisodeId: true },
        "Missing episode or incident state reference. Skipping notifications.",
      ],
      [
        "the incident state reference is missing",
        { withoutStateId: true },
        "Missing episode or incident state reference. Skipping notifications.",
      ],
      [
        "the incident state was not loaded",
        { withoutState: true },
        "Incident state has no name. Skipping notifications.",
      ],
      [
        "the incident state has no name",
        { stateName: "" },
        "Incident state has no name. Skipping notifications.",
      ],
      [
        "the new state is the created state",
        { isCreatedState: true },
        "Notification already sent when the episode was created. So, episode state change notification is skipped.",
      ],
    ])(
      "skips when %s, before loading the episode",
      async (_label: string, overrides: TimelineOverrides, message: string) => {
        pendingTimelines = [stateTimeline(overrides)];

        await runJob();

        nothingSent();
        expect(IncidentEpisodeService.findOneById).not.toHaveBeenCalled();
        expect(statusWrites()).toEqual(inProgressThen(skipped(message)));
        expect(feedItems()).toHaveLength(0);
      },
    );

    test("skips when the episode no longer exists", async () => {
      storedEpisode = null;

      await runJob();

      nothingSent();
      expect(IncidentEpisodeMemberService.findBy).not.toHaveBeenCalled();
      expect(statusWrites()).toEqual(
        inProgressThen(
          skipped("Related episode not found. Skipping notifications."),
        ),
      );
      expect(feedItems()).toHaveLength(0);
    });

    test("loads the episode with the columns the messages need", async () => {
      await runJob();

      const args: { id: ObjectID; select: JSONObject } = mock(
        IncidentEpisodeService.findOneById,
      ).mock.calls[0]![0] as { id: ObjectID; select: JSONObject };

      expect(args.id.toString()).toBe(EPISODE_ID.toString());
      expect(args.select).toEqual({
        _id: true,
        title: true,
        projectId: true,
        incidentSeverity: {
          name: true,
        },
        isVisibleOnStatusPage: true,
        episodeNumber: true,
      });
    });

    test.each<[string, Array<Array<Monitor> | undefined>]>([
      ["the episode has no member incidents", []],
      ["the member incidents have no monitors", [undefined, []]],
    ])(
      "skips when %s",
      async (
        _label: string,
        monitorLists: Array<Array<Monitor> | undefined>,
      ) => {
        members = monitorLists.map(
          (monitors: Array<Monitor> | undefined): IncidentEpisodeMember => {
            return member(monitors);
          },
        );

        await runJob();

        nothingSent();
        expect(StatusPageResourceService.findByMonitors).not.toHaveBeenCalled();
        expect(statusWrites()).toEqual(
          inProgressThen(
            skipped(
              "No monitors are attached to the incidents in this episode. Skipping notifications.",
            ),
          ),
        );
      },
    );

    test("skips when the episode is not visible on the status page", async () => {
      storedEpisode = episode({ isVisibleOnStatusPage: false });

      await runJob();

      nothingSent();
      expect(StatusPageResourceService.findByMonitors).not.toHaveBeenCalled();
      expect(statusWrites()).toEqual(
        inProgressThen(
          skipped(
            "Episode is not visible on status page. Skipping notifications.",
          ),
        ),
      );
    });

    test("looks up status page resources once per distinct monitor across member incidents", async () => {
      members = [
        member([monitor(MONITOR_ID), monitor(SECOND_MONITOR_ID)]),
        member([monitor(MONITOR_ID)]),
      ];

      await runJob();

      const args: { monitorIds: Array<ObjectID> } = mock(
        StatusPageResourceService.findByMonitors,
      ).mock.calls[0]![0] as { monitorIds: Array<ObjectID> };

      expect(
        args.monitorIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      ).toEqual([MONITOR_ID.toString(), SECOND_MONITOR_ID.toString()]);

      const memberArgs: { query: JSONObject } = mock(
        IncidentEpisodeMemberService.findBy,
      ).mock.calls[0]![0] as { query: JSONObject };
      expect(
        (
          memberArgs.query["incidentEpisodeId"] as unknown as ObjectID
        ).toString(),
      ).toBe(EPISODE_ID.toString());
    });

    test("asks only for the status pages the resources belong to, ignoring resources without one", async () => {
      mock(StatusPageResourceService.findByMonitors).mockResolvedValue([
        resource(),
        resource({ statusPageId: null }),
      ] as never);

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

    test("skips a status page that hides episodes", async () => {
      useStatusPages([statusPage({ showEpisodesOnStatusPage: false })]);

      await runJob();

      nothingSent();
      expect(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).not.toHaveBeenCalled();
      expect(templateLookups()).toHaveLength(0);
      expect(feedItems()[0]!["displayColor"]).toBe(Yellow500);
      expect(statusWrites()).toEqual(inProgressThen(SUCCESS_WRITE));
    });

    test("skips a status page without an id", async () => {
      useStatusPages([statusPage({ id: null })]);

      await runJob();

      nothingSent();
      expect(templateLookups()).toHaveLength(0);
      expect(statusWrites()).toEqual(inProgressThen(SUCCESS_WRITE));
    });

    test("skips a subscriber without an id and still notifies the others", async () => {
      useSubscribers([subscriber({ id: null }), subscriber()]);

      await runJob();

      expect(sentMail()).toHaveLength(1);
      expect(sentWebhooks()).toHaveLength(1);
      expect(
        StatusPageSubscriberService.shouldSendNotification,
      ).toHaveBeenCalledTimes(1);
    });

    test("asks whether each subscriber wants incident notifications for this page's resources", async () => {
      const page: StatusPage = statusPage();
      useStatusPages([page]);

      await runJob();

      const args: JSONObject = mock(
        StatusPageSubscriberService.shouldSendNotification,
      ).mock.calls[0]![0] as JSONObject;

      expect(args["eventType"]).toBe(StatusPageEventType.Incident);
      expect(args["statusPage"]).toBe(page);
      expect(
        (args["statusPageResources"] as unknown as Array<StatusPageResource>)
          .length,
      ).toBe(1);
      expect(
        (
          (args["subscriber"] as unknown as StatusPageSubscriber).id as ObjectID
        ).toString(),
      ).toBe(SUBSCRIBER_ID.toString());
    });

    test("only notifies subscribers that pass the preference check", async () => {
      useSubscribers([subscriber(), subscriber({ id: SECOND_SUBSCRIBER_ID })]);
      mock(
        StatusPageSubscriberService.shouldSendNotification,
      ).mockImplementation((args: unknown): boolean => {
        return (
          (
            args as { subscriber: StatusPageSubscriber }
          ).subscriber.id!.toString() === SECOND_SUBSCRIBER_ID.toString()
        );
      });

      await runJob();

      expect(sentWebhooks()).toHaveLength(1);
      expect(sentWebhooks()[0]!["unsubscribeUrl"]).toBe(
        `${STATUS_PAGE_URL}/update-subscription/${SECOND_SUBSCRIBER_ID.toString()}`,
      );
      expect(feedItems()[0]!["displayColor"]).toBe(Blue500);
    });
  });

  describe("default messages (no custom templates)", () => {
    test("emails the episode state changed template with every variable", async () => {
      await runJob();

      expect(mailCalls()).toHaveLength(1);
      expect(mailCalls()[0]!.mail).toEqual({
        toEmail: new Email("customer@example.com"),
        templateType: EmailTemplateType.SubscriberEpisodeStateChanged,
        vars: {
          emailTitle: `Incident on ${RESOURCE_NAME} is ${STATE_NAME}`,
          statusPageName: "Acme Status",
          statusPageUrl: STATUS_PAGE_URL,
          detailsUrl: DETAILS_URL,
          logoUrl: "",
          isPublicStatusPage: "true",
          resourcesAffected: RESOURCE_NAME,
          episodeSeverity: SEVERITY_NAME,
          episodeTitle: EPISODE_TITLE,
          episodeState: STATE_NAME,
          unsubscribeUrl: UNSUBSCRIBE_URL,
          subscriberEmailNotificationFooterText: "Footer text",
        },
        subject: `[${STATE_NAME} Incident] ${EPISODE_TITLE}`,
      });
      expect(mailCalls()[0]!.options).toEqual({
        mailServer: undefined,
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
      });
    });

    test("adds the logo URL and private flag to the default email", async () => {
      useStatusPages([
        statusPage({ withLogo: true, isPublicStatusPage: false }),
      ]);

      await runJob();

      const vars: JSONObject = sentMail()[0]!["vars"] as JSONObject;
      expect(vars["logoUrl"]).toBe(
        `https://oneuptime.acme.com/status-page-api/logo/${STATUS_PAGE_ID.toString()}`,
      );
      expect(vars["isPublicStatusPage"]).toBe("false");
    });

    test("uses fallbacks in the default email when the episode has no severity or resources", async () => {
      storedEpisode = episode({ withoutSeverity: true });
      mock(StatusPageResourceService.findByMonitors).mockResolvedValue([
        resource({ displayName: "" }),
      ] as never);

      await runJob();

      const vars: JSONObject = sentMail()[0]!["vars"] as JSONObject;
      expect(vars["emailTitle"]).toBe(`Incident is ${STATE_NAME}`);
      expect(vars["resourcesAffected"]).toBe("None");
      expect(vars["episodeSeverity"]).toBe(" - ");
    });

    test("uses the status page name when it has no title", async () => {
      useStatusPages([statusPage({ withoutPageTitle: true })]);

      await runJob();

      expect(sentSms()[0]).toBe(
        `Incident ${EPISODE_TITLE} on Acme is ${STATE_NAME}. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
      );
      expect(sentWebhooks()[0]!["statusPageName"]).toBe("Acme");
    });

    test("sends the default SMS, matching the dashboard SMS starter", async () => {
      await runJob();

      expect(sentSms()).toEqual([
        `Incident ${EPISODE_TITLE} on Acme Status is ${STATE_NAME}. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
      ]);
      expect(sentSms()[0]).toBe(
        dashboardDefault(StatusPageSubscriberNotificationMethod.SMS),
      );
      expect(smsCalls()[0]!.sms["to"]).toEqual(new Phone("+15555550100"));
      expect(smsCalls()[0]!.options).toEqual({
        projectId: PROJECT_ID,
        customTwilioConfig: undefined,
        statusPageId: STATUS_PAGE_ID,
      });
    });

    test("capitalises the state in the default SMS and email subject", async () => {
      pendingTimelines = [stateTimeline({ stateName: "monitoring" })];

      await runJob();

      expect(sentSms()[0]).toContain(" is Monitoring. ");
      expect(sentMail()[0]!["subject"]).toBe(
        `[Monitoring Incident] ${EPISODE_TITLE}`,
      );
      expect(sentSlack()[0]).toContain("**Status:** monitoring");
    });

    test("sends the default Slack message, matching the dashboard Slack starter", async () => {
      await runJob();

      const expected: string = `🚨 ## Incident - ${EPISODE_TITLE}


**Resources Affected:** ${RESOURCE_NAME}
**Severity:** ${SEVERITY_NAME}
**Status:** ${STATE_NAME}

[View Status Page](${STATUS_PAGE_URL}) | [Unsubscribe](${UNSUBSCRIBE_URL})`;

      expect(sentSlack()).toEqual([expected]);
      expect(sentSlack()[0]).toBe(
        dashboardDefault(StatusPageSubscriberNotificationMethod.Slack),
      );
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

    test("sends the default Microsoft Teams message, matching the dashboard Teams starter", async () => {
      await runJob();

      const expected: string = `🚨 ## Incident - ${EPISODE_TITLE}


**Resources Affected:** ${RESOURCE_NAME}
**Severity:** ${SEVERITY_NAME}
**Status:** ${STATE_NAME}

[View Status Page](${STATUS_PAGE_URL}) | [Unsubscribe](${UNSUBSCRIBE_URL})`;

      expect(sentTeams()).toEqual([expected]);
      expect(sentTeams()[0]).toBe(
        dashboardDefault(StatusPageSubscriberNotificationMethod.MicrosoftTeams),
      );
      expect(
        (
          mock(MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook).mock
            .calls[0]![0] as { url: URL }
        ).url.toString(),
      ).toBe(TEAMS_URL);
    });

    test("does not convert the Teams message to Slack rich text", async () => {
      mock(SlackUtil.convertMarkdownToSlackRichText).mockImplementation(
        (text: unknown): string => {
          return `slack-rich-text:${text as string}`;
        },
      );

      await runJob();

      expect(SlackUtil.convertMarkdownToSlackRichText).toHaveBeenCalledTimes(1);
      expect(sentSlack()[0]).toBe(
        `slack-rich-text:${dashboardDefault(StatusPageSubscriberNotificationMethod.Slack)}`,
      );
      expect(sentTeams()[0]).toBe(
        dashboardDefault(StatusPageSubscriberNotificationMethod.MicrosoftTeams),
      );
    });

    test("leaves the resources line out of Slack and Teams when nothing is affected", async () => {
      storedEpisode = episode({ withoutSeverity: true, title: "" });
      mock(StatusPageResourceService.findByMonitors).mockResolvedValue([
        resource({ displayName: "" }),
      ] as never);

      await runJob();

      // The title and severity fall back to " - "; no resources line at all.
      const expected: string =
        "🚨 ## Incident -  - \n\n\n" +
        "**Severity:**  - \n" +
        `**Status:** ${STATE_NAME}\n\n` +
        `[View Status Page](${STATUS_PAGE_URL}) | [Unsubscribe](${UNSUBSCRIBE_URL})`;

      expect(sentSlack()).toEqual([expected]);
      expect(sentTeams()).toEqual([expected]);
      expect(sentSms()[0]).toBe(
        `Incident  on Acme Status is ${STATE_NAME}. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
      );
    });

    test("sends the fixed webhook payload, identical to the dashboard Webhook starter", async () => {
      await runJob();

      expect(webhookCalls()).toHaveLength(1);
      expect(webhookCalls()[0]!.webhookUrl.toString()).toBe(WEBHOOK_URL);

      const payload: JSONObject = sentWebhooks()[0]!;
      expect(payload).toEqual({
        eventType: "EpisodeStateChanged",
        statusPageId: STATUS_PAGE_ID.toString(),
        statusPageName: "Acme Status",
        statusPageUrl: STATUS_PAGE_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
        data: {
          episodeId: EPISODE_ID.toString(),
          episodeTitle: EPISODE_TITLE,
          incidentSeverity: SEVERITY_NAME,
          incidentState: STATE_NAME,
          resourcesAffected: RESOURCE_NAME,
          detailsUrl: DETAILS_URL,
        },
      });
      expect(Object.keys(payload)).toEqual([
        "eventType",
        "statusPageId",
        "statusPageName",
        "statusPageUrl",
        "unsubscribeUrl",
        "data",
      ]);
      expect(Object.keys(payload["data"] as JSONObject)).toEqual([
        "episodeId",
        "episodeTitle",
        "incidentSeverity",
        "incidentState",
        "resourcesAffected",
        "detailsUrl",
      ]);

      expect(payload).toEqual(
        StatusPageSubscriberWebhookTemplate.compile(
          dashboardTemplate(StatusPageSubscriberNotificationMethod.Webhook),
          EXPECTED_VARIABLES,
        ),
      );
      expect(logger.warn).not.toHaveBeenCalled();
    });

    test("keeps the webhook payload's empty-string fallbacks", async () => {
      storedEpisode = episode({ withoutSeverity: true, title: "" });
      mock(StatusPageResourceService.findByMonitors).mockResolvedValue([
        resource({ displayName: "" }),
      ] as never);

      await runJob();

      expect(sentWebhooks()[0]!["data"]).toEqual({
        episodeId: EPISODE_ID.toString(),
        episodeTitle: "",
        incidentSeverity: "",
        incidentState: STATE_NAME,
        resourcesAffected: "",
        detailsUrl: DETAILS_URL,
      });
    });

    test("sends each channel only to subscribers that set it up", async () => {
      useSubscribers([
        subscriber({ channels: ["email"] }),
        subscriber({ id: SECOND_SUBSCRIBER_ID, channels: ["webhook"] }),
      ]);

      await runJob();

      expect(sentMail()).toHaveLength(1);
      expect(sentSms()).toHaveLength(0);
      expect(sentSlack()).toHaveLength(0);
      expect(sentTeams()).toHaveLength(0);
      expect(sentWebhooks()).toHaveLength(1);
      expect(sentWebhooks()[0]!["unsubscribeUrl"]).toBe(
        `${STATUS_PAGE_URL}/update-subscription/${SECOND_SUBSCRIBER_ID.toString()}`,
      );
    });
  });

  describe("template lookups", () => {
    test("looks up one template per channel, including Webhook, for this event and status page", async () => {
      await runJob();

      const lookups: Array<JSONObject> = templateLookups();

      expect(lookups).toHaveLength(5);
      expect(
        lookups
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

      for (const lookup of lookups) {
        expect(lookup["eventType"]).toBe(EVENT);
        expect((lookup["statusPageId"] as unknown as ObjectID).toString()).toBe(
          STATUS_PAGE_ID.toString(),
        );
      }
    });

    test("looks templates up once per status page, not once per subscriber", async () => {
      useSubscribers([
        subscriber(),
        subscriber({ id: SECOND_SUBSCRIBER_ID }),
        subscriber(),
      ]);

      await runJob();

      expect(templateLookups()).toHaveLength(5);
      expect(sentWebhooks()).toHaveLength(3);
    });

    test("looks templates up for each status page separately and fills in that page's values", async () => {
      mock(StatusPageResourceService.findByMonitors).mockResolvedValue([
        resource(),
        resource({ statusPageId: SECOND_STATUS_PAGE_ID }),
      ] as never);
      useStatusPages([statusPage(), statusPage({ id: SECOND_STATUS_PAGE_ID })]);

      await runJob();

      const lookups: Array<JSONObject> = templateLookups();
      expect(lookups).toHaveLength(10);

      const byPage: Record<string, number> = {};
      for (const lookup of lookups) {
        const id: string = (
          lookup["statusPageId"] as unknown as ObjectID
        ).toString();
        byPage[id] = (byPage[id] || 0) + 1;
        expect(lookup["eventType"]).toBe(EVENT);
      }
      expect(byPage).toEqual({
        [STATUS_PAGE_ID.toString()]: 5,
        [SECOND_STATUS_PAGE_ID.toString()]: 5,
      });

      expect(
        sentWebhooks().map((payload: JSONObject): string => {
          return payload["statusPageId"] as string;
        }),
      ).toEqual([STATUS_PAGE_ID.toString(), SECOND_STATUS_PAGE_ID.toString()]);
      expect((sentWebhooks()[1]!["data"] as JSONObject)["detailsUrl"]).toBe(
        `${SECOND_STATUS_PAGE_URL}/episodes/${EPISODE_ID.toString()}`,
      );
    });
  });

  describe("custom Webhook template", () => {
    test("sends the compiled JSON object instead of the default payload, leaving other channels alone", async () => {
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Webhook]: template({
          templateBody: `{
  "type": "episode.state_changed",
  "page": { "id": "{{statusPageId}}", "name": "{{statusPageName}}" },
  "episode": {
    "id": "{{episodeId}}",
    "title": "{{episodeTitle}}",
    "state": "{{episodeState}}",
    "severity": "{{episodeSeverity}}"
  },
  "links": ["{{detailsUrl}}", "{{unsubscribeUrl}}"],
  "static": 42
}`,
        }),
      });

      await runJob();

      expect(sentWebhooks()).toEqual([
        {
          type: "episode.state_changed",
          page: { id: STATUS_PAGE_ID.toString(), name: "Acme Status" },
          episode: {
            id: EPISODE_ID.toString(),
            title: EPISODE_TITLE,
            state: STATE_NAME,
            severity: SEVERITY_NAME,
          },
          links: [DETAILS_URL, UNSUBSCRIBE_URL],
          static: 42,
        },
      ]);
      expect(webhookCalls()[0]!.webhookUrl.toString()).toBe(WEBHOOK_URL);
      expect(logger.warn).not.toHaveBeenCalled();

      expect(sentMail()[0]!["templateType"]).toBe(
        EmailTemplateType.SubscriberEpisodeStateChanged,
      );
      expect(sentSms()[0]).toBe(
        dashboardDefault(StatusPageSubscriberNotificationMethod.SMS),
      );
      expect(sentSlack()[0]).toBe(
        dashboardDefault(StatusPageSubscriberNotificationMethod.Slack),
      );
      expect(sentTeams()[0]).toBe(
        dashboardDefault(StatusPageSubscriberNotificationMethod.MicrosoftTeams),
      );
    });

    test("does not need a custom SMTP or Twilio configuration", async () => {
      useStatusPages([statusPage()]);
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Webhook]: template({
          templateBody: `{"title": "{{episodeTitle}}"}`,
        }),
      });

      await runJob();

      expect(sentWebhooks()).toEqual([{ title: EPISODE_TITLE }]);
    });

    test("keeps quotes, backslashes and newlines intact through the JSON round trip", async () => {
      const trickyTitle: string =
        'Checkout "EU" is down \\ path C:\\temp\nsecond line\ttab $& {{notAVariable}}';
      const trickyState: string = 'Identified "root cause"\r\nnext';
      storedEpisode = episode({ title: trickyTitle });
      pendingTimelines = [stateTimeline({ stateName: trickyState })];
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Webhook]: template({
          templateBody: `{"title": "{{episodeTitle}}", "state": "{{ episodeState }}", "text": "{{episodeTitle}} / {{episodeState}}"}`,
        }),
      });

      await runJob();

      const payload: JSONObject = sentWebhooks()[0]!;
      const roundTripped: JSONObject = JSON.parse(
        JSON.stringify(payload),
      ) as JSONObject;

      expect(roundTripped).toEqual({
        title: trickyTitle,
        state: trickyState,
        text: `${trickyTitle} / ${trickyState}`,
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    test.each<[string, string]>([
      ["is not valid JSON", `{"title": "{{episodeTitle}}"`],
      ["is a JSON array", `["{{episodeTitle}}", "{{episodeState}}"]`],
      [
        "puts a text variable outside a JSON string",
        `{"title": {{episodeTitle}}}`,
      ],
      ["is a JSON string", `"{{episodeTitle}}"`],
    ])(
      "falls back to the default payload and logs a warning when the template %s",
      async (_label: string, templateBody: string) => {
        useTemplates({
          [StatusPageSubscriberNotificationMethod.Webhook]: template({
            templateBody,
          }),
        });

        await runJob();

        expect(sentWebhooks()).toHaveLength(1);
        expect(sentWebhooks()[0]).toEqual({
          eventType: "EpisodeStateChanged",
          statusPageId: STATUS_PAGE_ID.toString(),
          statusPageName: "Acme Status",
          statusPageUrl: STATUS_PAGE_URL,
          unsubscribeUrl: UNSUBSCRIBE_URL,
          data: {
            episodeId: EPISODE_ID.toString(),
            episodeTitle: EPISODE_TITLE,
            incidentSeverity: SEVERITY_NAME,
            incidentState: STATE_NAME,
            resourcesAffected: RESOURCE_NAME,
            detailsUrl: DETAILS_URL,
          },
        });

        expect(logger.warn).toHaveBeenCalledTimes(1);
        const [message, attributes]: Array<unknown> = mock(logger.warn).mock
          .calls[0]!;
        expect(message).toContain(STATUS_PAGE_ID.toString());
        expect(message).toContain("EpisodeStateChanged");
        expect(attributes).toEqual({
          statusPageId: STATUS_PAGE_ID.toString(),
        });

        expect(sentMail()).toHaveLength(1);
        expect(sentSms()).toHaveLength(1);
        expect(sentSlack()[0]).toBe(
          dashboardDefault(StatusPageSubscriberNotificationMethod.Slack),
        );
        expect(sentTeams()[0]).toBe(
          dashboardDefault(
            StatusPageSubscriberNotificationMethod.MicrosoftTeams,
          ),
        );
        expect(statusWrites()).toEqual(inProgressThen(SUCCESS_WRITE));
      },
    );

    test("sends the default payload when the template body is empty", async () => {
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Webhook]: template({
          templateBody: "",
        }),
      });

      await runJob();

      expect(sentWebhooks()[0]!["eventType"]).toBe("EpisodeStateChanged");
      expect(logger.warn).not.toHaveBeenCalled();
    });

    test("fills each subscriber's own unsubscribe link into the template", async () => {
      useSubscribers([subscriber(), subscriber({ id: SECOND_SUBSCRIBER_ID })]);
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Webhook]: template({
          templateBody: `{"unsubscribe": "{{unsubscribeUrl}}"}`,
        }),
      });

      await runJob();

      expect(sentWebhooks()).toEqual([
        { unsubscribe: UNSUBSCRIBE_URL },
        {
          unsubscribe: `${STATUS_PAGE_URL}/update-subscription/${SECOND_SUBSCRIBER_ID.toString()}`,
        },
      ]);
    });
  });

  describe("every template variable is provided", () => {
    test("Email (with custom SMTP): body and subject use every variable", async () => {
      useStatusPages([statusPage({ withSmtpConfig: true })]);
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Email]: template({
          templateBody: everyVariableTemplate(),
          emailSubject: variableNames()
            .map((name: string): string => {
              return `{{${name}}}`;
            })
            .join("|"),
        }),
      });

      await runJob();

      expect(mailCalls()).toHaveLength(1);
      const mail: JSONObject = mailCalls()[0]!.mail;

      expect(mail["templateType"]).toBe(EmailTemplateType.BlankTemplate);
      expect(mail["vars"]).toEqual({ body: everyVariableCompiled() });
      expect(mail["subject"]).toBe(
        variableNames()
          .map((name: string): string => {
            return EXPECTED_VARIABLES[name]!;
          })
          .join("|"),
      );
      expect((mail["vars"] as JSONObject)["body"]).not.toContain("{{");
      expect(mail["subject"]).not.toContain("{{");
      expect(mailCalls()[0]!.options).toEqual({
        mailServer: { host: "smtp.acme.com" },
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
      });
    });

    test("SMS (with custom Twilio): the message uses every variable", async () => {
      useStatusPages([statusPage({ withCallSmsConfig: true })]);
      useTemplates({
        [StatusPageSubscriberNotificationMethod.SMS]: template({
          templateBody: everyVariableTemplate(),
        }),
      });

      await runJob();

      expect(sentSms()).toEqual([everyVariableCompiled()]);
      expect(sentSms()[0]).not.toContain("{{");
      expect(smsCalls()[0]!.options["customTwilioConfig"]).toEqual({
        accountSid: "custom-twilio",
      });
    });

    test("Slack: the message uses every variable", async () => {
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Slack]: template({
          templateBody: everyVariableTemplate(),
        }),
      });

      await runJob();

      expect(sentSlack()).toEqual([everyVariableCompiled()]);
      expect(sentSlack()[0]).not.toContain("{{");
      expect(SlackUtil.convertMarkdownToSlackRichText).toHaveBeenCalledWith(
        everyVariableCompiled(),
      );
    });

    test("Microsoft Teams: the message uses every variable", async () => {
      useTemplates({
        [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: template({
          templateBody: everyVariableTemplate(),
        }),
      });

      await runJob();

      expect(sentTeams()).toEqual([everyVariableCompiled()]);
      expect(sentTeams()[0]).not.toContain("{{");
    });

    test("Webhook: the payload uses every variable", async () => {
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Webhook]: template({
          templateBody: everyVariableWebhookTemplate(),
        }),
      });

      await runJob();

      expect(sentWebhooks()).toEqual([EXPECTED_VARIABLES]);
      expect(JSON.stringify(sentWebhooks()[0])).not.toContain("{{");
      expect(logger.warn).not.toHaveBeenCalled();
    });

    test("all channels at once get the new id variables", async () => {
      const body: string =
        "page={{statusPageId}} episode={{episodeId}} state={{episodeState}}";
      const expected: string = `page=${STATUS_PAGE_ID.toString()} episode=${EPISODE_ID.toString()} state=${STATE_NAME}`;

      useStatusPages([
        statusPage({ withSmtpConfig: true, withCallSmsConfig: true }),
      ]);
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Email]: template({
          templateBody: body,
        }),
        [StatusPageSubscriberNotificationMethod.SMS]: template({
          templateBody: body,
        }),
        [StatusPageSubscriberNotificationMethod.Slack]: template({
          templateBody: body,
        }),
        [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: template({
          templateBody: body,
        }),
        [StatusPageSubscriberNotificationMethod.Webhook]: template({
          templateBody: `{"text": "${body}"}`,
        }),
      });

      await runJob();

      expect(sentMail()[0]!["vars"]).toEqual({ body: expected });
      expect(sentSms()).toEqual([expected]);
      expect(sentSlack()).toEqual([expected]);
      expect(sentTeams()).toEqual([expected]);
      expect(sentWebhooks()).toEqual([{ text: expected }]);
    });

    test("fills the text-channel fallbacks when the episode has no severity or resources", async () => {
      storedEpisode = episode({ withoutSeverity: true });
      mock(StatusPageResourceService.findByMonitors).mockResolvedValue([
        resource({ displayName: "" }),
      ] as never);
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Slack]: template({
          templateBody: "{{episodeSeverity}}|{{resourcesAffected}}",
        }),
        [StatusPageSubscriberNotificationMethod.Webhook]: template({
          templateBody: `{"severity": "{{episodeSeverity}}", "resources": "{{resourcesAffected}}"}`,
        }),
      });

      await runJob();

      expect(sentSlack()).toEqual([" - |None"]);
      expect(sentWebhooks()).toEqual([{ severity: " - ", resources: "None" }]);
    });
  });

  describe("custom Email and SMS templates", () => {
    test("ignores a custom email template without a custom SMTP configuration", async () => {
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Email]: template({
          templateBody: "<p>{{episodeTitle}}</p>",
        }),
      });

      await runJob();

      expect(sentMail()[0]!["templateType"]).toBe(
        EmailTemplateType.SubscriberEpisodeStateChanged,
      );
    });

    test("falls back to the state subject when the custom email template has none", async () => {
      useStatusPages([statusPage({ withSmtpConfig: true })]);
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Email]: template({
          templateBody: "<p>{{episodeTitle}} is {{episodeState}}</p>",
        }),
      });

      await runJob();

      expect(sentMail()[0]).toEqual({
        toEmail: new Email("customer@example.com"),
        templateType: EmailTemplateType.BlankTemplate,
        vars: { body: `<p>${EPISODE_TITLE} is ${STATE_NAME}</p>` },
        subject: `[Incident ${STATE_NAME}] ${EPISODE_TITLE}`,
      });
    });

    test("ignores a custom SMS template without a custom Twilio configuration", async () => {
      useTemplates({
        [StatusPageSubscriberNotificationMethod.SMS]: template({
          templateBody: "Custom {{episodeTitle}}",
        }),
      });

      await runJob();

      expect(sentSms()[0]).toBe(
        dashboardDefault(StatusPageSubscriberNotificationMethod.SMS),
      );
    });

    test("uses custom Slack and Teams templates without any custom configuration", async () => {
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Slack]: template({
          templateBody: "Slack: {{episodeTitle}}",
        }),
        [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: template({
          templateBody: "Teams: {{episodeTitle}}",
        }),
      });

      await runJob();

      expect(sentSlack()).toEqual([`Slack: ${EPISODE_TITLE}`]);
      expect(sentTeams()).toEqual([`Teams: ${EPISODE_TITLE}`]);
    });
  });

  describe("failure isolation", () => {
    test("a failed webhook send does not stop other channels or the job", async () => {
      const failure: Error = new Error("webhook endpoint unreachable");
      mock(
        StatusPageSubscriberWebhookUtil.sendWebhookNotification,
      ).mockRejectedValue(failure as never);

      await runJob();

      expect(sentWebhooks()).toHaveLength(1);
      expect(sentMail()).toHaveLength(1);
      expect(sentSms()).toHaveLength(1);
      expect(sentSlack()).toHaveLength(1);
      expect(sentTeams()).toHaveLength(1);
      expect(logger.error).toHaveBeenCalledWith(
        failure,
        expect.objectContaining({
          projectId: PROJECT_ID.toString(),
          incidentEpisodeId: EPISODE_ID.toString(),
        }),
      );
      expect(feedItems()[0]!["displayColor"]).toBe(Blue500);
      expect(statusWrites()).toEqual(inProgressThen(SUCCESS_WRITE));
    });

    test("a failed custom-template webhook send is handled the same way", async () => {
      const failure: Error = new Error("webhook endpoint unreachable");
      mock(
        StatusPageSubscriberWebhookUtil.sendWebhookNotification,
      ).mockRejectedValue(failure as never);
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Webhook]: template({
          templateBody: `{"title": "{{episodeTitle}}"}`,
        }),
      });

      await runJob();

      expect(sentWebhooks()).toEqual([{ title: EPISODE_TITLE }]);
      expect(logger.error).toHaveBeenCalledWith(failure, expect.anything());
      expect(statusWrites()).toEqual(inProgressThen(SUCCESS_WRITE));
    });

    test("a failed Microsoft Teams send does not stop other channels or the job", async () => {
      const failure: Error = new Error("teams webhook gone");
      mock(
        MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
      ).mockRejectedValue(failure as never);

      await runJob();

      expect(sentTeams()).toHaveLength(1);
      expect(sentWebhooks()).toHaveLength(1);
      expect(sentMail()).toHaveLength(1);
      expect(sentSms()).toHaveLength(1);
      expect(sentSlack()).toHaveLength(1);
      expect(logger.error).toHaveBeenCalledWith(
        failure,
        expect.objectContaining({
          incidentEpisodeId: EPISODE_ID.toString(),
        }),
      );
      expect(statusWrites()).toEqual(inProgressThen(SUCCESS_WRITE));
    });

    test("failed email, SMS and Slack sends are logged and the job still succeeds", async () => {
      mock(MailService.sendMail).mockRejectedValue(
        new Error("mail down") as never,
      );
      mock(SmsService.sendSms).mockRejectedValue(
        new Error("sms down") as never,
      );
      mock(SlackUtil.sendMessageToChannelViaIncomingWebhook).mockRejectedValue(
        new Error("slack down") as never,
      );

      await runJob();

      expect(sentTeams()).toHaveLength(1);
      expect(sentWebhooks()).toHaveLength(1);
      expect(logger.error).toHaveBeenCalledTimes(3);
      expect(statusWrites()).toEqual(inProgressThen(SUCCESS_WRITE));
    });

    test("one subscriber's failed webhook does not stop the next subscriber", async () => {
      useSubscribers([subscriber(), subscriber({ id: SECOND_SUBSCRIBER_ID })]);
      mock(
        StatusPageSubscriberWebhookUtil.sendWebhookNotification,
      ).mockRejectedValueOnce(new Error("first webhook down") as never);

      await runJob();

      expect(sentWebhooks()).toHaveLength(2);
      expect(sentWebhooks()[1]!["unsubscribeUrl"]).toBe(
        `${STATUS_PAGE_URL}/update-subscription/${SECOND_SUBSCRIBER_ID.toString()}`,
      );
      expect(sentMail()).toHaveLength(2);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(statusWrites()).toEqual(inProgressThen(SUCCESS_WRITE));
    });
  });
});
