import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "Common/Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodeStateTimeline from "Common/Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
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
import SubscriberNotificationTemplateVariables from "Common/Types/StatusPage/SubscriberNotificationTemplateVariables";

/*
 * Incident episode state change notifications: the job that tells status
 * page subscribers an episode moved to a new state.
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
        /*
         * The real substitution, wrapped in a mock so tests can read the
         * variables each channel handed to its template.
         */
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
import IncidentEpisodeFeedService from "Common/Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeMemberService from "Common/Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "Common/Server/Services/IncidentEpisodeStateTimelineService";
import MailService from "Common/Server/Services/MailService";
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
const EPISODE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const INCIDENT_STATE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const SECOND_STATUS_PAGE_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const SECOND_SUBSCRIBER_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);

const STATUS_PAGE_URL: string = "https://status.acme.com";
const SECOND_STATUS_PAGE_URL: string = "https://status.beta.com";
// The status page shows an episode on its incident detail route.
const DETAILS_URL: string = `${STATUS_PAGE_URL}/incidents/${EPISODE_ID.toString()}`;
const UNSUBSCRIBE_URL: string = `${STATUS_PAGE_URL}/update-subscription/${SUBSCRIBER_ID.toString()}`;
const DASHBOARD_URL: string = "https://oneuptime.acme.com/dashboard/episode/3";

const EPISODE_TITLE: string = "Regional network interruption";
const EPISODE_SEVERITY: string = "Major";
// Distinct from every other fixture value, so a mix-up shows.
const STATE_NAME: string = "Mitigated";

let pendingTimelines: Array<IncidentEpisodeStateTimeline> = [];
let skipTimelines: Array<IncidentEpisodeStateTimeline> = [];
let storedEpisode: IncidentEpisode | null = null;
let memberMonitors: Array<Monitor> = [];
let subscribersByPage: Record<string, Array<StatusPageSubscriber>> = {};

function stateTimeline(overrides?: {
  id?: string;
  stateName?: string;
  isCreatedState?: boolean;
}): IncidentEpisodeStateTimeline {
  const state: IncidentState = new IncidentState();
  state._id = INCIDENT_STATE_ID.toString();
  state.name = overrides?.stateName ?? STATE_NAME;
  state.isCreatedState = Boolean(overrides?.isCreatedState);

  const row: IncidentEpisodeStateTimeline = new IncidentEpisodeStateTimeline();
  row._id = overrides?.id || TIMELINE_ID.toString();
  row.projectId = PROJECT_ID;
  row.incidentEpisodeId = EPISODE_ID;
  row.incidentStateId = INCIDENT_STATE_ID;
  row.incidentState = state;
  return row;
}

function episode(overrides?: {
  isVisibleOnStatusPage?: boolean;
  withoutTitle?: boolean;
  withoutSeverity?: boolean;
}): IncidentEpisode {
  const row: IncidentEpisode = new IncidentEpisode();
  row._id = EPISODE_ID.toString();
  if (!overrides?.withoutTitle) {
    row.title = EPISODE_TITLE;
  }
  row.projectId = PROJECT_ID;
  row.isVisibleOnStatusPage = overrides?.isVisibleOnStatusPage !== false;
  row.episodeNumber = 3;

  if (!overrides?.withoutSeverity) {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity.name = EPISODE_SEVERITY;
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
  showEpisodesOnStatusPage?: boolean;
  id?: ObjectID;
  pageTitle?: string;
  // Custom SMTP and Twilio, which Email and SMS need to use custom templates.
  withCustomSmtpAndSms?: boolean;
}): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = (overrides?.id || STATUS_PAGE_ID).toString();
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  page.pageTitle = overrides?.pageTitle || "Acme Status";
  page.isPublicStatusPage = true;
  page.showEpisodesOnStatusPage = overrides?.showEpisodesOnStatusPage !== false;
  if (overrides?.withCustomSmtpAndSms) {
    (page as unknown as JSONObject)["smtpConfig"] = { _id: "smtp" };
    (page as unknown as JSONObject)["callSmsConfig"] = { _id: "twilio" };
  }
  return page;
}

function resource(overrides?: {
  id?: string;
  statusPageId?: ObjectID;
  displayName?: string;
}): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = overrides?.id || "88888888-8888-4888-8888-888888888888";
  row.statusPageId = overrides?.statusPageId || STATUS_PAGE_ID;
  row.displayName = overrides?.displayName ?? "Edge network";
  return row;
}

const GROUPED_RESOURCES_HTML: string =
  "Europe: Edge network<br/>Americas: Core network";
const GROUPED_RESOURCES_TEXT: string =
  "Europe: Edge network; Americas: Core network";

function resourceInGroup(
  id: string,
  displayName: string,
  groupName: string,
): StatusPageResource {
  const row: StatusPageResource = resource({
    id: id,
    displayName: displayName,
  });
  row.statusPageGroupId = ObjectID.generate();
  const group: StatusPageGroup = new StatusPageGroup();
  group.name = groupName;
  row.statusPageGroup = group;
  return row;
}

// Two resources in two groups on the first status page.
function groupedResources(): Array<StatusPageResource> {
  return [
    resourceInGroup(
      "88888888-8888-4888-8888-888888888888",
      "Edge network",
      "Europe",
    ),
    resourceInGroup(
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      "Core network",
      "Americas",
    ),
  ];
}

function subscriber(overrides?: {
  id?: ObjectID;
  email?: string;
}): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row._id = (overrides?.id || SUBSCRIBER_ID).toString();
  row.subscriberEmail = new Email(overrides?.email || "customer@example.com");
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
  return mock(IncidentEpisodeStateTimelineService.updateOneById).mock.calls.map(
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
  expect(
    StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate,
  ).not.toHaveBeenCalled();
}

// The dashboard's starter template for a channel, filled with the fixtures.
function dashboardDefault(
  method: StatusPageSubscriberNotificationMethod,
): string {
  const template: string =
    getDefaultSubscriberNotificationTemplate(EVENT, method)?.body || "";
  const variables: Record<string, string> = {
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    detailsUrl: DETAILS_URL,
    unsubscribeUrl: UNSUBSCRIBE_URL,
    episodeTitle: EPISODE_TITLE,
    episodeSeverity: EPISODE_SEVERITY,
    episodeState: STATE_NAME,
    resourcesAffected: "Edge network",
  };

  expect(template).not.toBe("");

  return template.replace(/{{\s*(\w+)\s*}}/g, (_match: string, key: string) => {
    return variables[key] ?? "";
  });
}

async function runJob(): Promise<void> {
  expect(mockCapturedJobs[JOB]).toBeDefined();
  await mockCapturedJobs[JOB]!();
}

interface CompileCall {
  template: string;
  variables: Record<string, string>;
}

function compileCalls(): Array<CompileCall> {
  return mock(
    StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate,
  ).mock.calls.map((call: Array<unknown>): CompileCall => {
    return {
      template: call[0] as string,
      variables: call[1] as Record<string, string>,
    };
  });
}

const EMAIL_SUBJECT_TEMPLATE: string =
  "Subject: {{episodeTitle}} is {{episodeState}}";

/*
 * A template body that prints every variable advertised for the event as
 * name=[value], so a test can see which ones rendered and with what.
 */
function templateUsingEveryVariable(channel: string): string {
  const lines: Array<string> =
    SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
      EVENT,
    ).map((name: string): string => {
      return `${name}=[{{${name}}}]`;
    });

  return [`channel=${channel}`, ...lines].join("\n");
}

// What templateUsingEveryVariable(channel) renders to, given these values.
function renderedWithEveryVariable(
  channel: string,
  values: Record<string, string>,
): string {
  const lines: Array<string> =
    SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
      EVENT,
    ).map((name: string): string => {
      return `${name}=[${values[name] ?? ""}]`;
    });

  return [`channel=${channel}`, ...lines].join("\n");
}

// The variables the job handed to compileTemplate for this template.
function variablesCompiledInto(template: string): Record<string, string> {
  const calls: Array<CompileCall> = compileCalls().filter(
    (call: CompileCall): boolean => {
      return call.template === template;
    },
  );

  expect(calls).toHaveLength(1);
  return calls[0]!.variables;
}

/*
 * Gives the status pages (custom SMTP and Twilio by default) a custom
 * template for the event on Email, SMS, Slack and Teams, each printing every
 * advertised variable, and the email the given subject. A lookup for any
 * other event finds no template. Returns the body used for each channel.
 */
function useCustomTemplatesOnEveryChannel(
  pages?: Array<StatusPage>,
  emailSubject: string = EMAIL_SUBJECT_TEMPLATE,
): Record<string, string> {
  mock(
    StatusPageSubscriberService.getStatusPagesToSendNotification,
  ).mockResolvedValue(
    (pages || [statusPage({ withCustomSmtpAndSms: true })]) as never,
  );

  const bodies: Record<string, string> = {
    [StatusPageSubscriberNotificationMethod.Email]:
      templateUsingEveryVariable("email"),
    [StatusPageSubscriberNotificationMethod.SMS]:
      templateUsingEveryVariable("sms"),
    [StatusPageSubscriberNotificationMethod.Slack]:
      templateUsingEveryVariable("slack"),
    [StatusPageSubscriberNotificationMethod.MicrosoftTeams]:
      templateUsingEveryVariable("teams"),
  };

  mock(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
  ).mockImplementation(async (args: unknown) => {
    const lookup: JSONObject = args as JSONObject;
    const method: string = lookup["notificationMethod"] as string;

    if (lookup["eventType"] !== EVENT || !bodies[method]) {
      return null;
    }

    return method === StatusPageSubscriberNotificationMethod.Email
      ? { templateBody: bodies[method], emailSubject: emailSubject }
      : { templateBody: bodies[method] };
  });

  return bodies;
}

beforeEach(() => {
  jest.clearAllMocks();

  pendingTimelines = [];
  skipTimelines = [];
  storedEpisode = episode();
  memberMonitors = [monitor()];
  subscribersByPage = {
    [STATUS_PAGE_ID.toString()]: [subscriber()],
    [SECOND_STATUS_PAGE_ID.toString()]: [
      subscriber({ id: SECOND_SUBSCRIBER_ID, email: "beta@example.com" }),
    ],
  };

  mock(IncidentEpisodeStateTimelineService.findBy).mockImplementation(
    async (args: unknown): Promise<Array<IncidentEpisodeStateTimeline>> => {
      const query: JSONObject = (args as { query: JSONObject }).query;

      if (query["shouldStatusPageSubscribersBeNotified"] === false) {
        return skipTimelines;
      }

      return pendingTimelines;
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
  ).mockImplementation(async (statusPageId: unknown) => {
    return subscribersByPage[(statusPageId as ObjectID).toString()] || [];
  });
  mock(StatusPageSubscriberService.shouldSendNotification).mockReturnValue(
    true,
  );
  mock(StatusPageSubscriberService.getUnsubscribeLink).mockImplementation(
    (pageUrl: unknown, subscriberId: unknown): URL => {
      return URL.fromString((pageUrl as URL).toString()).addRoute(
        `/update-subscription/${(subscriberId as ObjectID).toString()}`,
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

describe("IncidentEpisodeStateTimeline:SendNotificationToSubscribers", () => {
  test("is registered", () => {
    expect(mockCapturedJobs[JOB]).toBeDefined();
  });

  test("reads the new state's name with each pending timeline", async () => {
    await runJob();

    const pendingQuery: { query: JSONObject; select: JSONObject } | undefined =
      (
        mock(IncidentEpisodeStateTimelineService.findBy).mock.calls.map(
          (call: Array<unknown>): { query: JSONObject; select: JSONObject } => {
            return call[0] as { query: JSONObject; select: JSONObject };
          },
        ) as Array<{ query: JSONObject; select: JSONObject }>
      ).find((args: { query: JSONObject; select: JSONObject }): boolean => {
        return args.query["shouldStatusPageSubscribersBeNotified"] === true;
      });

    expect(pendingQuery?.query).toEqual({
      subscriberNotificationStatus:
        StatusPageSubscriberNotificationStatus.Pending,
      shouldStatusPageSubscribersBeNotified: true,
    });
    expect(pendingQuery?.select["incidentState"]).toEqual({
      name: true,
      isCreatedState: true,
    });
  });

  test("sends the default messages it always has, matching the dashboard defaults", async () => {
    pendingTimelines = [stateTimeline()];

    await runJob();

    expect(compileCalls()).toHaveLength(0);

    expect(sentSms()).toEqual([
      `Incident ${EPISODE_TITLE} on Acme Status is ${STATE_NAME}. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
    ]);
    expect(sentSms()[0]).toBe(
      dashboardDefault(StatusPageSubscriberNotificationMethod.SMS),
    );

    expect(sentSlack()).toEqual([
      `🚨 ## Incident - ${EPISODE_TITLE}\n\n\n**Resources Affected:** Edge network\n**Severity:** ${EPISODE_SEVERITY}\n**Status:** ${STATE_NAME}\n\n[View Status Page](${STATUS_PAGE_URL}) | [Unsubscribe](${UNSUBSCRIBE_URL})`,
    ]);
    expect(sentSlack()[0]).toBe(
      dashboardDefault(StatusPageSubscriberNotificationMethod.Slack),
    );
    expect(sentTeams()).toEqual([sentSlack()[0]]);
    expect(sentTeams()[0]).toBe(
      dashboardDefault(StatusPageSubscriberNotificationMethod.MicrosoftTeams),
    );

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberEpisodeStateChanged,
    );
    expect(sentMail()[0]!["subject"]).toBe(
      `[${STATE_NAME} Incident] ${EPISODE_TITLE}`,
    );
    expect(sentMail()[0]!["vars"]).toEqual({
      emailTitle: `Incident on Edge network is ${STATE_NAME}`,
      statusPageName: "Acme Status",
      statusPageUrl: STATUS_PAGE_URL,
      detailsUrl: DETAILS_URL,
      logoUrl: "",
      isPublicStatusPage: "true",
      resourcesAffected: "Edge network",
      episodeSeverity: EPISODE_SEVERITY,
      episodeTitle: EPISODE_TITLE,
      episodeState: STATE_NAME,
      unsubscribeUrl: UNSUBSCRIBE_URL,
      subscriberEmailNotificationFooterText: "Footer text",
    });

    expect(sentWebhooks()).toEqual([
      {
        eventType: "EpisodeStateChanged",
        statusPageId: STATUS_PAGE_ID.toString(),
        statusPageName: "Acme Status",
        statusPageUrl: STATUS_PAGE_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
        data: {
          episodeId: EPISODE_ID.toString(),
          episodeTitle: EPISODE_TITLE,
          incidentSeverity: EPISODE_SEVERITY,
          incidentState: STATE_NAME,
          resourcesAffected: "Edge network",
          detailsUrl: DETAILS_URL,
        },
      },
    ]);
  });

  test("looks up custom templates for the episode state changed event on each channel", async () => {
    pendingTimelines = [stateTimeline()];

    await runJob();

    const lookups: Array<JSONObject> = mock(
      StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
    ).mock.calls.map((call: Array<unknown>): JSONObject => {
      return call[0] as JSONObject;
    });

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
      ].sort(),
    );
    for (const lookup of lookups) {
      expect(lookup["eventType"]).toBe(EVENT);
      expect((lookup["statusPageId"] as ObjectID).toString()).toBe(
        STATUS_PAGE_ID.toString(),
      );
    }
  });

  test("records progress, success and a feed entry naming the new state", async () => {
    pendingTimelines = [stateTimeline()];

    await runJob();

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
    expect(feedItems()).toHaveLength(1);
    expect(feedItems()[0]!["feedInfoInMarkdown"]).toBe(
      `📧 **Status Page Subscribers have been notified** about the state change of the [Episode 3](${DASHBOARD_URL}) to **${STATE_NAME}**`,
    );
  });

  test("marks timelines that should not notify as Skipped", async () => {
    skipTimelines = [stateTimeline()];

    await runJob();

    nothingSent();
    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatus:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessage:
          "Notifications skipped as subscribers are not to be notified for this state change.",
      },
    ]);
  });

  interface SkipCase {
    name: string;
    arrange: () => void;
    message: string;
  }

  test.each([
    {
      name: "the new state is the created state",
      arrange: (): void => {
        pendingTimelines = [stateTimeline({ isCreatedState: true })];
      },
      message:
        "Notification already sent when the episode was created. So, episode state change notification is skipped.",
    },
    {
      name: "the new state has no name",
      arrange: (): void => {
        pendingTimelines = [stateTimeline({ stateName: "" })];
      },
      message: "Incident state has no name. Skipping notifications.",
    },
    {
      name: "the episode has been deleted",
      arrange: (): void => {
        pendingTimelines = [stateTimeline()];
        storedEpisode = null;
      },
      message: "Related episode not found. Skipping notifications.",
    },
    {
      name: "no incident in the episode has a monitor",
      arrange: (): void => {
        pendingTimelines = [stateTimeline()];
        memberMonitors = [];
      },
      message:
        "No monitors are attached to the incidents in this episode. Skipping notifications.",
    },
    {
      name: "the episode is hidden from status pages",
      arrange: (): void => {
        pendingTimelines = [stateTimeline()];
        storedEpisode = episode({ isVisibleOnStatusPage: false });
      },
      message: "Episode is not visible on status page. Skipping notifications.",
    },
  ])("skips when $name", async (row: SkipCase) => {
    row.arrange();

    await runJob();

    nothingSent();
    expect(statusWrites()[statusWrites().length - 1]).toEqual({
      subscriberNotificationStatus:
        StatusPageSubscriberNotificationStatus.Skipped,
      subscriberNotificationStatusMessage: row.message,
    });
  });
});

describe("IncidentEpisodeStateTimeline details link", () => {
  /*
   * The status page app has no /episodes page; an episode opens on the
   * incident detail route, which falls back to the episode lookup.
   */
  const EXPECTED_DETAILS_URL: string =
    "https://status.acme.com/incidents/33333333-3333-4333-8333-333333333333";

  test("default SMS, email and webhook link to the episode on the incident detail route", async () => {
    pendingTimelines = [stateTimeline()];

    await runJob();

    expect(sentSms()).toHaveLength(1);
    expect(sentSms()[0]).toContain(`Details: ${EXPECTED_DETAILS_URL}.`);
    expect((sentMail()[0]!["vars"] as JSONObject)["detailsUrl"]).toBe(
      EXPECTED_DETAILS_URL,
    );
    expect((sentWebhooks()[0]!["data"] as JSONObject)["detailsUrl"]).toBe(
      EXPECTED_DETAILS_URL,
    );
    expect(JSON.stringify(sentMail())).not.toContain("/episodes/");
    expect(JSON.stringify(sentWebhooks())).not.toContain("/episodes/");
    expect(sentSms()[0]).not.toContain("/episodes/");
  });

  test("custom templates get the incident detail route on every channel", async () => {
    pendingTimelines = [stateTimeline()];
    useCustomTemplatesOnEveryChannel();

    await runJob();

    const calls: Array<CompileCall> = compileCalls();
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.variables["detailsUrl"]).toBe(EXPECTED_DETAILS_URL);
    }
    expect(JSON.stringify(sentMail())).not.toContain("/episodes/");
    expect(sentSms()[0]).not.toContain("/episodes/");
    expect(sentSlack()[0]).not.toContain("/episodes/");
    expect(sentTeams()[0]).not.toContain("/episodes/");
  });

  test("a status page without a custom domain links to its preview incident route", async () => {
    const pageUrl: string = `https://oneuptime.acme.com/status-page/${STATUS_PAGE_ID.toString()}`;
    pendingTimelines = [stateTimeline()];
    useCustomTemplatesOnEveryChannel();
    mock(StatusPageService.getStatusPageURL).mockResolvedValue(
      pageUrl as never,
    );

    await runJob();

    const calls: Array<CompileCall> = compileCalls();
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.variables["statusPageUrl"]).toBe(pageUrl);
      expect(call.variables["detailsUrl"]).toBe(
        `${pageUrl}/incidents/${EPISODE_ID.toString()}`,
      );
    }
  });
});

describe("IncidentEpisodeStateTimeline status pages that hide episodes", () => {
  test("a page with showEpisodesOnStatusPage off gets nothing while a page with it on is notified", async () => {
    pendingTimelines = [stateTimeline()];
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue([
      resource(),
      resource({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        statusPageId: SECOND_STATUS_PAGE_ID,
        displayName: "DNS resolvers",
      }),
    ] as never);
    useCustomTemplatesOnEveryChannel([
      statusPage({
        withCustomSmtpAndSms: true,
        showEpisodesOnStatusPage: false,
      }),
      statusPage({
        withCustomSmtpAndSms: true,
        id: SECOND_STATUS_PAGE_ID,
        pageTitle: "Beta Status",
        showEpisodesOnStatusPage: true,
      }),
    ]);

    await runJob();

    // Both pages were considered.
    const consideredPageIds: Array<string> = (
      mock(StatusPageSubscriberService.getStatusPagesToSendNotification).mock
        .calls[0]![0] as Array<ObjectID>
    ).map((id: ObjectID): string => {
      return id.toString();
    });
    expect(consideredPageIds.sort()).toEqual(
      [STATUS_PAGE_ID.toString(), SECOND_STATUS_PAGE_ID.toString()].sort(),
    );

    // Only the page that shows episodes was worked on.
    const subscriberLookups: Array<string> = mock(
      StatusPageSubscriberService.getSubscribersByStatusPage,
    ).mock.calls.map((call: Array<unknown>): string => {
      return (call[0] as ObjectID).toString();
    });
    expect(subscriberLookups).toEqual([SECOND_STATUS_PAGE_ID.toString()]);
    for (const call of mock(
      StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
    ).mock.calls) {
      expect(
        ((call[0] as JSONObject)["statusPageId"] as ObjectID).toString(),
      ).toBe(SECOND_STATUS_PAGE_ID.toString());
    }

    // Every message went to the shown page's subscriber, about that page.
    expect(
      sentMail().map((mail: JSONObject): string => {
        return (mail["toEmail"] as Email).toString();
      }),
    ).toEqual(["beta@example.com"]);
    expect(sentSms()).toHaveLength(1);
    expect(sentSlack()).toHaveLength(1);
    expect(sentTeams()).toHaveLength(1);
    expect(sentWebhooks()).toHaveLength(1);
    expect(sentWebhooks()[0]!["statusPageId"]).toBe(
      SECOND_STATUS_PAGE_ID.toString(),
    );

    const calls: Array<CompileCall> = compileCalls();
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.variables["statusPageName"]).toBe("Beta Status");
      expect(call.variables["statusPageUrl"]).toBe(SECOND_STATUS_PAGE_URL);
      expect(call.variables["resourcesAffected"]).toBe("DNS resolvers");
      expect(call.variables["unsubscribeUrl"]).toBe(
        `${SECOND_STATUS_PAGE_URL}/update-subscription/${SECOND_SUBSCRIBER_ID.toString()}`,
      );
    }

    expect(JSON.stringify(sentMail())).not.toContain("Acme Status");
    expect(JSON.stringify(sentWebhooks())).not.toContain(STATUS_PAGE_URL);
    expect(feedItems()[0]!["feedInfoInMarkdown"]).toContain(
      "**Status Page Subscribers have been notified**",
    );
  });

  test("a status page that hides episodes gets nothing and the feed says so", async () => {
    pendingTimelines = [stateTimeline()];
    useCustomTemplatesOnEveryChannel([
      statusPage({
        withCustomSmtpAndSms: true,
        showEpisodesOnStatusPage: false,
      }),
    ]);

    await runJob();

    nothingSent();
    expect(
      StatusPageSubscriberService.getSubscribersByStatusPage,
    ).not.toHaveBeenCalled();
    expect(feedItems()).toHaveLength(1);
    expect(feedItems()[0]!["feedInfoInMarkdown"]).toBe(
      `📧 **No notification sent to subscribers** for the state change of [Episode 3](${DASHBOARD_URL}) to **${STATE_NAME}**`,
    );
    expect(statusWrites()[statusWrites().length - 1]).toEqual({
      subscriberNotificationStatus:
        StatusPageSubscriberNotificationStatus.Success,
      subscriberNotificationStatusMessage:
        "Notifications sent successfully to all subscribers",
    });
  });
});

interface ProviderCase {
  name: string;
  withCustomSmtp: boolean;
  withCustomSms: boolean;
}

describe("IncidentEpisodeStateTimeline custom templates need the page's own SMTP and Twilio", () => {
  /*
   * Email uses a custom template only when the status page has custom SMTP,
   * and SMS only when it has custom Twilio. Slack and Teams need neither.
   * Each check is tested on its own, so dropping or swapping one fails.
   */
  test.each([
    {
      name: "without custom SMTP or Twilio",
      withCustomSmtp: false,
      withCustomSms: false,
    },
    {
      name: "with custom SMTP only",
      withCustomSmtp: true,
      withCustomSms: false,
    },
    {
      name: "with custom Twilio only",
      withCustomSmtp: false,
      withCustomSms: true,
    },
  ])(
    "$name: Email and SMS use custom templates only where configured",
    async (providers: ProviderCase) => {
      pendingTimelines = [stateTimeline()];
      const page: StatusPage = statusPage();
      if (providers.withCustomSmtp) {
        (page as unknown as JSONObject)["smtpConfig"] = { _id: "smtp" };
      }
      if (providers.withCustomSms) {
        (page as unknown as JSONObject)["callSmsConfig"] = { _id: "twilio" };
      }
      const bodies: Record<string, string> = useCustomTemplatesOnEveryChannel([
        page,
      ]);

      await runJob();

      const expectedTemplates: Array<string> = [
        bodies[StatusPageSubscriberNotificationMethod.Slack]!,
        bodies[StatusPageSubscriberNotificationMethod.MicrosoftTeams]!,
      ];
      if (providers.withCustomSmtp) {
        expectedTemplates.push(
          bodies[StatusPageSubscriberNotificationMethod.Email]!,
          EMAIL_SUBJECT_TEMPLATE,
        );
      }
      if (providers.withCustomSms) {
        expectedTemplates.push(
          bodies[StatusPageSubscriberNotificationMethod.SMS]!,
        );
      }

      expect(
        compileCalls()
          .map((call: CompileCall): string => {
            return call.template;
          })
          .sort(),
      ).toEqual(expectedTemplates.sort());

      expect(sentMail()).toHaveLength(1);
      if (providers.withCustomSmtp) {
        expect(sentMail()[0]!["templateType"]).toBe(
          EmailTemplateType.BlankTemplate,
        );
        expect((sentMail()[0]!["vars"] as JSONObject)["body"]).toContain(
          "channel=email",
        );
      } else {
        expect(sentMail()[0]!["templateType"]).toBe(
          EmailTemplateType.SubscriberEpisodeStateChanged,
        );
        expect(sentMail()[0]!["subject"]).toBe(
          `[${STATE_NAME} Incident] ${EPISODE_TITLE}`,
        );
      }

      expect(sentSms()).toHaveLength(1);
      if (providers.withCustomSms) {
        expect(sentSms()[0]).toContain("channel=sms");
      } else {
        expect(sentSms()[0]).toBe(
          `Incident ${EPISODE_TITLE} on Acme Status is ${STATE_NAME}. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
        );
      }

      expect(sentSlack()[0]).toContain("channel=slack");
      expect(sentTeams()[0]).toContain("channel=teams");
    },
  );
});

interface SubjectFallbackCase {
  name: string;
  withoutTitle: boolean;
  subject: string;
}

describe("IncidentEpisodeStateTimeline custom email subject fallback", () => {
  /*
   * A custom email template without its own subject gets the state prefix
   * followed by the episode title; an untitled episode gets the bare prefix
   * rather than "undefined".
   */
  test.each([
    {
      name: "titled",
      withoutTitle: false,
      subject: `[Incident ${STATE_NAME}] ${EPISODE_TITLE}`,
    },
    {
      name: "untitled",
      withoutTitle: true,
      subject: `[Incident ${STATE_NAME}] `,
    },
  ])("$name: the subject is '$subject'", async (row: SubjectFallbackCase) => {
    pendingTimelines = [stateTimeline()];
    storedEpisode = episode({ withoutTitle: row.withoutTitle });

    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([statusPage({ withCustomSmtpAndSms: true })] as never);
    mock(
      StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
    ).mockImplementation(async (args: unknown) => {
      return (args as JSONObject)["notificationMethod"] ===
        StatusPageSubscriberNotificationMethod.Email
        ? { templateBody: "<p>{{episodeState}}</p>" }
        : null;
    });

    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.BlankTemplate,
    );
    expect(sentMail()[0]!["subject"]).toBe(row.subject);
    expect(sentMail()[0]!["vars"]).toEqual({ body: `<p>${STATE_NAME}</p>` });
  });

  test("an untitled episode's default email subject has no 'undefined'", async () => {
    pendingTimelines = [stateTimeline()];
    storedEpisode = episode({ withoutTitle: true });

    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["subject"]).toBe(`[${STATE_NAME} Incident] `);
  });
});

describe("IncidentEpisodeStateTimeline custom templates receive every advertised variable", () => {
  test("Email body and subject, SMS, Slack and Teams each get all of them", async () => {
    pendingTimelines = [stateTimeline()];
    const bodies: Record<string, string> = useCustomTemplatesOnEveryChannel();

    await runJob();

    const calls: Array<CompileCall> = compileCalls();

    // Email body and subject, SMS, Slack and Teams: one each.
    expect(calls).toHaveLength(5);
    expect(
      calls
        .map((call: CompileCall): string => {
          return call.template;
        })
        .sort(),
    ).toEqual(
      [
        bodies[StatusPageSubscriberNotificationMethod.Email]!,
        EMAIL_SUBJECT_TEMPLATE,
        bodies[StatusPageSubscriberNotificationMethod.SMS]!,
        bodies[StatusPageSubscriberNotificationMethod.Slack]!,
        bodies[StatusPageSubscriberNotificationMethod.MicrosoftTeams]!,
      ].sort(),
    );

    const names: Array<string> =
      SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
        EVENT,
      );
    expect(names.length).toBeGreaterThan(0);
    expect(names).toEqual(
      expect.arrayContaining(["episodeState", "detailsUrl"]),
    );

    for (const call of calls) {
      const missing: Array<string> = names.filter((name: string): boolean => {
        return (
          !Object.prototype.hasOwnProperty.call(call.variables, name) ||
          typeof call.variables[name] !== "string"
        );
      });

      expect({ template: call.template, missing }).toEqual({
        template: call.template,
        missing: [],
      });
    }
  });
});

describe("IncidentEpisodeStateTimeline custom template variable values", () => {
  test("episodeState is the new state's name as written, on every channel", async () => {
    /*
     * Lower-case on purpose: the default SMS capitalises the first letter,
     * but the variable is the state's name unchanged.
     */
    pendingTimelines = [stateTimeline({ stateName: "partially restored" })];
    useCustomTemplatesOnEveryChannel();

    await runJob();

    const calls: Array<CompileCall> = compileCalls();
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.variables["episodeState"]).toBe("partially restored");
    }
    expect(sentMail()[0]!["subject"]).toBe(
      `Subject: ${EPISODE_TITLE} is partially restored`,
    );
  });

  test("each timeline in a tick uses its own new state", async () => {
    pendingTimelines = [
      stateTimeline({ stateName: "Identified" }),
      stateTimeline({
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        stateName: "Resolved",
      }),
    ];
    useCustomTemplatesOnEveryChannel();

    await runJob();

    const states: Array<string> = compileCalls().map(
      (call: CompileCall): string => {
        return call.variables["episodeState"] as string;
      },
    );
    expect(states).toEqual([
      "Identified",
      "Identified",
      "Identified",
      "Identified",
      "Identified",
      "Resolved",
      "Resolved",
      "Resolved",
      "Resolved",
      "Resolved",
    ]);
  });

  test("episodeTitle and episodeSeverity come from the episode", async () => {
    pendingTimelines = [stateTimeline()];
    useCustomTemplatesOnEveryChannel();

    await runJob();

    const select: JSONObject = (
      mock(IncidentEpisodeService.findOneById).mock.calls[0]![0] as {
        select: JSONObject;
      }
    ).select;
    expect(select["title"]).toBe(true);
    expect(select["incidentSeverity"]).toEqual({ name: true });

    const calls: Array<CompileCall> = compileCalls();
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.variables["episodeTitle"]).toBe(EPISODE_TITLE);
      expect(call.variables["episodeSeverity"]).toBe(EPISODE_SEVERITY);
    }
  });

  test("episodeSeverity reads ' - ' when the episode has no severity, as the default messages do", async () => {
    pendingTimelines = [stateTimeline()];
    storedEpisode = episode({ withoutSeverity: true });
    useCustomTemplatesOnEveryChannel();

    await runJob();

    const calls: Array<CompileCall> = compileCalls();
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.variables["episodeSeverity"]).toBe(" - ");
    }
  });

  test("resourcesAffected lists only the resources on that status page", async () => {
    pendingTimelines = [stateTimeline()];
    useCustomTemplatesOnEveryChannel([
      statusPage({ withCustomSmtpAndSms: true }),
      statusPage({
        withCustomSmtpAndSms: true,
        id: SECOND_STATUS_PAGE_ID,
        pageTitle: "Beta Status",
      }),
    ]);
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue([
      resource(),
      resource({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        statusPageId: SECOND_STATUS_PAGE_ID,
        displayName: "DNS resolvers",
      }),
    ] as never);

    await runJob();

    const calls: Array<CompileCall> = compileCalls();
    expect(calls).toHaveLength(10);

    const resourcesByPage: Record<string, Array<string>> = {};
    for (const call of calls) {
      const page: string = call.variables["statusPageName"] as string;
      const resources: string = call.variables["resourcesAffected"] as string;
      resourcesByPage[page] = resourcesByPage[page] || [];
      if (!resourcesByPage[page]!.includes(resources)) {
        resourcesByPage[page]!.push(resources);
      }
    }

    expect(resourcesByPage).toEqual({
      "Acme Status": ["Edge network"],
      "Beta Status": ["DNS resolvers"],
    });
  });

  test("resourcesAffected reads 'None' when the page's resources have no names", async () => {
    pendingTimelines = [stateTimeline()];
    useCustomTemplatesOnEveryChannel();
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue([
      resource({ displayName: "" }),
    ] as never);

    await runJob();

    const calls: Array<CompileCall> = compileCalls();
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.variables["resourcesAffected"]).toBe("None");
    }
  });

  test("unsubscribeUrl belongs to the subscriber being sent to", async () => {
    pendingTimelines = [stateTimeline()];
    subscribersByPage[STATUS_PAGE_ID.toString()] = [
      subscriber(),
      subscriber({ id: SECOND_SUBSCRIBER_ID, email: "second@example.com" }),
    ];
    useCustomTemplatesOnEveryChannel();

    await runJob();

    const unsubscribeUrls: Array<string> = compileCalls().map(
      (call: CompileCall): string => {
        return call.variables["unsubscribeUrl"] as string;
      },
    );
    const secondUnsubscribeUrl: string = `${STATUS_PAGE_URL}/update-subscription/${SECOND_SUBSCRIBER_ID.toString()}`;

    // Subscribers are sent to one after another, five templates each.
    expect(unsubscribeUrls).toEqual([
      UNSUBSCRIBE_URL,
      UNSUBSCRIBE_URL,
      UNSUBSCRIBE_URL,
      UNSUBSCRIBE_URL,
      UNSUBSCRIBE_URL,
      secondUnsubscribeUrl,
      secondUnsubscribeUrl,
      secondUnsubscribeUrl,
      secondUnsubscribeUrl,
      secondUnsubscribeUrl,
    ]);
  });

  test("a template using every advertised variable renders completely on every channel", async () => {
    pendingTimelines = [stateTimeline()];
    useCustomTemplatesOnEveryChannel();

    await runJob();

    // What the fixtures hold for each advertised variable.
    const expectedValues: Record<string, string> = {
      statusPageName: "Acme Status",
      statusPageUrl: STATUS_PAGE_URL,
      unsubscribeUrl: UNSUBSCRIBE_URL,
      resourcesAffected: "Edge network",
      episodeTitle: EPISODE_TITLE,
      episodeSeverity: EPISODE_SEVERITY,
      episodeState: STATE_NAME,
      detailsUrl: DETAILS_URL,
    };

    const names: Array<string> =
      SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
        EVENT,
      );
    expect(Object.keys(expectedValues).sort()).toEqual([...names].sort());

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.BlankTemplate,
    );
    expect(sentSms()).toHaveLength(1);
    expect(sentSlack()).toHaveLength(1);
    expect(sentTeams()).toHaveLength(1);

    const rendered: Record<string, string> = {
      email: (sentMail()[0]!["vars"] as JSONObject)["body"] as string,
      sms: sentSms()[0]!,
      slack: sentSlack()[0]!,
      teams: sentTeams()[0]!,
    };

    for (const [channel, message] of Object.entries(rendered)) {
      expect(message).toContain(`channel=${channel}`);
      expect(message).not.toMatch(/{{|}}/);

      for (const name of names) {
        const value: string = expectedValues[name]!;

        expect(value).not.toBe("");
        expect(message).toContain(`${name}=[${value}]`);
      }
    }

    expect(sentMail()[0]!["subject"]).toBe(
      `Subject: ${EPISODE_TITLE} is ${STATE_NAME}`,
    );
  });
});

describe("IncidentEpisodeStateTimeline custom templates get values in their channel's format", () => {
  /*
   * The custom email body is HTML (it is wrapped only by BlankTemplate), so
   * it gets the grouped resource list one group per line. SMS, the email
   * subject, Slack, Teams and webhooks do not render HTML, so they get it on
   * one line. Everything else reads the same on every channel.
   */
  const SUBJECT_WITH_RESOURCES: string =
    "{{episodeTitle}} is {{episodeState}} ({{resourcesAffected}})";

  const SHARED_VALUES: Record<string, string> = {
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    detailsUrl: DETAILS_URL,
    unsubscribeUrl: UNSUBSCRIBE_URL,
    episodeSeverity: EPISODE_SEVERITY,
    episodeTitle: EPISODE_TITLE,
    episodeState: STATE_NAME,
  };
  const EMAIL_BODY_VALUES: Record<string, string> = {
    ...SHARED_VALUES,
    resourcesAffected: GROUPED_RESOURCES_HTML,
  };
  const PLAIN_TEXT_VALUES: Record<string, string> = {
    ...SHARED_VALUES,
    resourcesAffected: GROUPED_RESOURCES_TEXT,
  };

  beforeEach(() => {
    pendingTimelines = [stateTimeline()];
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
      groupedResources() as never,
    );
  });

  test("the fixtures cover every advertised variable", () => {
    const names: Array<string> =
      SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
        EVENT,
      );

    expect(Object.keys(EMAIL_BODY_VALUES).sort()).toEqual([...names].sort());
    expect(Object.keys(PLAIN_TEXT_VALUES).sort()).toEqual([...names].sort());
  });

  test("renders HTML in the email body and a plain-text resource list everywhere else", async () => {
    useCustomTemplatesOnEveryChannel(undefined, SUBJECT_WITH_RESOURCES);

    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.BlankTemplate,
    );
    expect(sentMail()[0]!["vars"]).toEqual({
      body: renderedWithEveryVariable("email", EMAIL_BODY_VALUES),
    });
    expect(sentMail()[0]!["subject"]).toBe(
      `${EPISODE_TITLE} is ${STATE_NAME} (${GROUPED_RESOURCES_TEXT})`,
    );
    expect(sentSms()).toEqual([
      renderedWithEveryVariable("sms", PLAIN_TEXT_VALUES),
    ]);
    expect(sentSlack()).toEqual([
      renderedWithEveryVariable("slack", PLAIN_TEXT_VALUES),
    ]);
    expect(sentTeams()).toEqual([
      renderedWithEveryVariable("teams", PLAIN_TEXT_VALUES),
    ]);

    for (const message of [
      sentMail()[0]!["subject"] as string,
      sentSms()[0]!,
      sentSlack()[0]!,
      sentTeams()[0]!,
    ]) {
      expect(message).not.toContain("<br/>");
    }
  });

  test("hands each channel's template every advertised variable, in that channel's format", async () => {
    const bodies: Record<string, string> = useCustomTemplatesOnEveryChannel();

    await runJob();

    expect(compileCalls()).toHaveLength(5);
    expect(
      variablesCompiledInto(
        bodies[StatusPageSubscriberNotificationMethod.Email]!,
      ),
    ).toEqual(EMAIL_BODY_VALUES);
    expect(variablesCompiledInto(EMAIL_SUBJECT_TEMPLATE)).toEqual(
      PLAIN_TEXT_VALUES,
    );
    expect(
      variablesCompiledInto(
        bodies[StatusPageSubscriberNotificationMethod.SMS]!,
      ),
    ).toEqual(PLAIN_TEXT_VALUES);
    expect(
      variablesCompiledInto(
        bodies[StatusPageSubscriberNotificationMethod.Slack]!,
      ),
    ).toEqual(PLAIN_TEXT_VALUES);
    expect(
      variablesCompiledInto(
        bodies[StatusPageSubscriberNotificationMethod.MicrosoftTeams]!,
      ),
    ).toEqual(PLAIN_TEXT_VALUES);
  });

  test("sends webhooks a plain-text resource list", async () => {
    await runJob();

    expect(sentWebhooks()).toHaveLength(1);
    expect(sentWebhooks()[0]!["eventType"]).toBe("EpisodeStateChanged");
    expect(sentWebhooks()[0]!["data"]).toEqual({
      episodeId: EPISODE_ID.toString(),
      episodeTitle: EPISODE_TITLE,
      incidentSeverity: EPISODE_SEVERITY,
      incidentState: STATE_NAME,
      resourcesAffected: GROUPED_RESOURCES_TEXT,
      detailsUrl: DETAILS_URL,
    });
  });

  test("the default email still gets HTML for the resource list", async () => {
    await runJob();

    expect(compileCalls()).toHaveLength(0);
    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberEpisodeStateChanged,
    );
    expect(sentMail()[0]!["vars"]).toEqual(
      expect.objectContaining({
        emailTitle: `Incident on ${GROUPED_RESOURCES_HTML} is ${STATE_NAME}`,
        resourcesAffected: GROUPED_RESOURCES_HTML,
      }),
    );
  });
});
