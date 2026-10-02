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
// The options each job registered with (its timeout among them).
const mockCapturedOptions: Record<string, unknown> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
        mockCapturedOptions[jobName] = options;
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
    default: {
      findBy: jest.fn(),
      updateOneById: jest.fn(),
      // The claim (SubscriberNotificationClaim).
      compareAndSetColumnsByIdWithoutHooks: jest.fn(),
    },
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

// IncidentStatusPageScope reads the member incidents' status page scope.
jest.mock("Common/Server/Services/IncidentService", () => {
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
        /*
         * The real email body compile, which escapes every plain value and
         * inserts only SafeHtml ones as HTML, recorded so tests can read what
         * each email body was given (see SubscriberTemplateCompileFixtures).
         */
        compileEmailBodyTemplate: jest.fn(
          (template: string, variables: Record<string, unknown>): string => {
            return (
              jest.requireActual(
                "Common/Types/StatusPage/SubscriberNotificationTemplateCompiler",
              ) as {
                default: {
                  compileEmailBodyTemplate: (
                    template: string,
                    variables: Record<string, unknown>,
                  ) => string;
                };
              }
            ).default.compileEmailBodyTemplate(template, variables);
          },
        ),
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
import IncidentService from "Common/Server/Services/IncidentService";
import Dictionary from "Common/Types/Dictionary";
import { Blue500, Yellow500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import {
  StoredIncidentScope,
  allSites,
  incidentScopeFindBy,
  scopedTo,
  sharedMonitor,
  siteOf,
  sitePage,
  siteResource,
  siteSubscriber,
  statusPagesByIdFake,
  subscribersByPageFake,
} from "../Fixtures/IncidentStatusPageScopeFixtures";
import {
  expectEveryUnsubscribeLinkToCarryAToken,
  fakeGetUnsubscribeLink,
  smsManageLinkFor,
  unsubscribeLinkFor,
  withUnsubscribeToken,
} from "../Fixtures/UnsubscribeLinkFixtures";
import {
  HOSTILE_PAGE_NAME,
  HOSTILE_PAGE_NAME_HTML,
  HOSTILE_RESOURCES_HTML,
  HOSTILE_RESOURCES_TEXT,
  HOSTILE_TITLE,
  HOSTILE_TITLE_HTML,
  RecordedCompile,
  expectNoHtmlEntities,
  expectOnlyTheListedHtmlVariables,
  hostileResources,
  recordedCompiles,
} from "../Fixtures/SubscriberTemplateCompileFixtures";
import {
  StatusWrite,
  statusWritesInOrder,
} from "../Fixtures/SubscriberNotificationSendFixtures";
import {
  PENDING_ROW_VERSION,
  describeSubscriberDelivery,
} from "../Fixtures/SubscriberDeliveryContract";
import { SubscriberNotificationRetryScope } from "Common/Server/Utils/StatusPage/SubscriberNotificationDeliveryRecord";
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
const UNSUBSCRIBE_URL: string = unsubscribeLinkFor(
  STATUS_PAGE_URL,
  SUBSCRIBER_ID,
);
// An SMS from this public page carries the manage link (see smsManageLinkFor).
const SMS_UNSUBSCRIBE_URL: string = smsManageLinkFor(
  STATUS_PAGE_URL,
  SUBSCRIBER_ID,
);
const DASHBOARD_URL: string = "https://oneuptime.acme.com/dashboard/episode/3";

const EPISODE_TITLE: string = "Regional network interruption";
const EPISODE_SEVERITY: string = "Major";
// Distinct from every other fixture value, so a mix-up shows.
const STATE_NAME: string = "Mitigated";

let pendingTimelines: Array<IncidentEpisodeStateTimeline> = [];
let skipTimelines: Array<IncidentEpisodeStateTimeline> = [];
let storedEpisode: IncidentEpisode | null = null;
let memberMonitors: Array<Monitor> = [];
// The episode's one member incident, unless a test sets memberIncidents.
const MEMBER_INCIDENT_ID: ObjectID = new ObjectID(
  "12121212-1212-4121-8121-121212121212",
);
let memberIncidents: Array<Incident> | null = null;
// The status page scope stored for each incident id; unscoped when absent.
let storedScopes: Dictionary<StoredIncidentScope> = {};
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
  page.onlyShowScopedIncidents = false;
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
  return withUnsubscribeToken(row);
}

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
}

/*
 * Every status write the job made, in order: the claim to InProgress
 * (SubscriberNotificationClaim) and each updateOneById.
 */
function statusWrites(): Array<JSONObject> {
  return statusWritesInOrder({
    claim:
      IncidentEpisodeStateTimelineService.compareAndSetColumnsByIdWithoutHooks,
    update: IncidentEpisodeStateTimelineService.updateOneById,
  }).map((write: StatusWrite): JSONObject => {
    return write.data;
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
  expect(
    StatusPageSubscriberNotificationTemplateServiceClass.compileEmailBodyTemplate,
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
    unsubscribeUrl:
      method === StatusPageSubscriberNotificationMethod.SMS
        ? SMS_UNSUBSCRIBE_URL
        : UNSUBSCRIBE_URL,
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
  // Text and email body compiles, in order (see SubscriberTemplateCompileFixtures).
  return recordedCompiles(
    StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate,
    StatusPageSubscriberNotificationTemplateServiceClass.compileEmailBodyTemplate,
  ).map((call: RecordedCompile): CompileCall => {
    return {
      template: call.template,
      variables: call.variables,
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
  memberIncidents = null;
  storedScopes = {};

  mock(IncidentService.findBy).mockImplementation(
    incidentScopeFindBy(() => {
      return storedScopes;
    }) as never,
  );

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
  // This run wins every claim unless a test says otherwise.
  mock(
    IncidentEpisodeStateTimelineService.compareAndSetColumnsByIdWithoutHooks,
  ).mockResolvedValue(true as never);

  mock(IncidentEpisodeService.findOneById).mockImplementation(async () => {
    return storedEpisode;
  });
  mock(IncidentEpisodeService.getEpisodeLinkInDashboard).mockResolvedValue(
    URL.fromString(DASHBOARD_URL) as never,
  );
  mock(IncidentEpisodeMemberService.findBy).mockImplementation(async () => {
    if (memberIncidents) {
      return memberIncidents.map((incident: Incident) => {
        const member: IncidentEpisodeMember = new IncidentEpisodeMember();
        member.incidentId = incident.id!;
        member.incident = incident;
        return member;
      });
    }

    const incident: Incident = new Incident();
    incident._id = MEMBER_INCIDENT_ID.toString();
    incident.monitors = memberMonitors;
    const member: IncidentEpisodeMember = new IncidentEpisodeMember();
    member.incidentId = MEMBER_INCIDENT_ID;
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
    fakeGetUnsubscribeLink,
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
      // The default email paints the new state in its own colour.
      color: true,
      isCreatedState: true,
    });
  });

  test("sends the default messages it always has, matching the dashboard defaults", async () => {
    pendingTimelines = [stateTimeline()];

    await runJob();

    expect(compileCalls()).toHaveLength(0);

    expect(sentSms()).toEqual([
      `Incident ${EPISODE_TITLE} on Acme Status is ${STATE_NAME}. Details: ${DETAILS_URL}. Unsub: ${SMS_UNSUBSCRIBE_URL}`,
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
          "Notifications sent successfully to all subscribers. Acme: 1 email, 1 SMS, 1 Slack, 1 Microsoft Teams, 1 webhook sent.",
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

/*
 * The default email paints the episode's new state and its severity the way
 * the owner emails do: a dot in each one's colour and the name in a readable
 * shade of it. The other channels carry the names as before.
 */
describe("IncidentEpisodeStateTimeline default email colours", () => {
  test("sends the state's and the severity's dot and name colours", async () => {
    const timeline: IncidentEpisodeStateTimeline = stateTimeline();
    timeline.incidentState!.color = Blue500;
    pendingTimelines = [timeline];
    storedEpisode!.incidentSeverity!.color = Yellow500;

    await runJob();

    expect(sentMail()[0]!["vars"]).toEqual(
      expect.objectContaining({
        episodeState: STATE_NAME,
        ...EmailColorUtil.getTemplateVariables("episodeState", Blue500),
        episodeSeverity: EPISODE_SEVERITY,
        ...EmailColorUtil.getTemplateVariables("episodeSeverity", Yellow500),
      }),
    );
    expect(sentMail()[0]!["vars"]).toHaveProperty(
      "episodeSeverityTextColor",
      EmailColorUtil.getColorPair(Yellow500)!.textColor,
    );
    expect(JSON.stringify(sentWebhooks())).not.toContain(Blue500.toString());
  });

  test("unusable colours are left out and the names stay plain", async () => {
    const timeline: IncidentEpisodeStateTimeline = stateTimeline();
    timeline.incidentState!.color = new Color("#fff; position: fixed");
    pendingTimelines = [timeline];
    storedEpisode!.incidentSeverity!.color = new Color("tomato");

    await runJob();

    const vars: JSONObject = sentMail()[0]!["vars"] as JSONObject;

    expect(vars["episodeState"]).toBe(STATE_NAME);
    expect(vars["episodeSeverity"]).toBe(EPISODE_SEVERITY);
    for (const name of [
      "episodeStateColor",
      "episodeStateTextColor",
      "episodeSeverityColor",
      "episodeSeverityTextColor",
    ]) {
      expect(vars).not.toHaveProperty(name);
    }
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
      // An SMS from a public page carries the manage link (see smsManageLinkFor).
      expect(call.variables["unsubscribeUrl"]).toBe(
        call.template === templateUsingEveryVariable("sms")
          ? smsManageLinkFor(SECOND_STATUS_PAGE_URL, SECOND_SUBSCRIBER_ID)
          : unsubscribeLinkFor(SECOND_STATUS_PAGE_URL, SECOND_SUBSCRIBER_ID),
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
        /*
         * Every page hides episodes: nothing was sent, and the message says
         * so rather than that everyone was sent it.
         */
        "Not sent to any subscriber: no status page was sent this notification. Acme: not sent, this status page does not show episodes.",
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
          `Incident ${EPISODE_TITLE} on Acme Status is ${STATE_NAME}. Details: ${DETAILS_URL}. Unsub: ${SMS_UNSUBSCRIBE_URL}`,
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
    expect(select["incidentSeverity"]).toEqual({ name: true, color: true });

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
    const secondUnsubscribeUrl: string = unsubscribeLinkFor(
      STATUS_PAGE_URL,
      SECOND_SUBSCRIBER_ID,
    );

    /*
     * Five templates for each subscriber, the SMS one carrying - from this
     * public page - the subscriber's manage link (see smsManageLinkFor).
     * Subscribers are sent to a bounded number at a time, so their compiles
     * interleave; each still carries its own subscriber's link.
     */
    expect([...unsubscribeUrls].sort()).toEqual(
      [
        SMS_UNSUBSCRIBE_URL,
        UNSUBSCRIBE_URL,
        UNSUBSCRIBE_URL,
        UNSUBSCRIBE_URL,
        UNSUBSCRIBE_URL,
        smsManageLinkFor(STATUS_PAGE_URL, SECOND_SUBSCRIBER_ID),
        secondUnsubscribeUrl,
        secondUnsubscribeUrl,
        secondUnsubscribeUrl,
        secondUnsubscribeUrl,
      ].sort(),
    );
    // The first subscriber's templates start first.
    expect(unsubscribeUrls[0]).toBe(SMS_UNSUBSCRIBE_URL);
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
        // An SMS from this public page carries the manage link.
        const value: string =
          name === "unsubscribeUrl" && channel === "sms"
            ? SMS_UNSUBSCRIBE_URL
            : expectedValues[name]!;

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
    // An SMS from this public page carries the manage link (see smsManageLinkFor).
    expect(sentSms()).toEqual([
      renderedWithEveryVariable("sms", {
        ...PLAIN_TEXT_VALUES,
        unsubscribeUrl: SMS_UNSUBSCRIBE_URL,
      }),
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
    ).toEqual({ ...PLAIN_TEXT_VALUES, unsubscribeUrl: SMS_UNSUBSCRIBE_URL });
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

  /*
   * The resource list row is raw HTML, so it gets the HTML list. The heading
   * is escaped by the template (EmailTitle's {{title}}), so it gets the
   * plain-text list: with the HTML one, the reader saw a literal "<br/>"
   * between the groups, and an "&amp;" for every ampersand in a name.
   */
  test("the default email gets HTML for the resource list, and plain text in its heading", async () => {
    await runJob();

    expect(compileCalls()).toHaveLength(0);
    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberEpisodeStateChanged,
    );
    expect(sentMail()[0]!["vars"]).toEqual(
      expect.objectContaining({
        emailTitle: `Incident on ${GROUPED_RESOURCES_TEXT} is ${STATE_NAME}`,
        resourcesAffected: GROUPED_RESOURCES_HTML,
      }),
    );
  });
});

interface TemplateSyntaxTitle {
  name: string;
  title: string;
}

/*
 * Titles quoting template syntax. This event's custom subject gets no
 * Markdown-converted text, so the episode title is the user-authored value
 * it carries. The subject is finished text when the worker sends it, so the
 * mail is marked literal: compiling it again read the braces as Handlebars,
 * and the email either failed to render and was never sent or lost the
 * quoted words. Tests/Notification/SubscriberEmailSubjectLiteral.test.ts
 * follows such a subject to SMTP.
 */
const TEMPLATE_SYNTAX_TITLES: Array<TemplateSyntaxTitle> = [
  { name: "a bare expression", title: "Deploy blocked on {{ x }}" },
  {
    name: "a quoted Helm value",
    title: "Helm upgrade failed: {{ .Values.image.tag }} was empty",
  },
  {
    name: "a lone opening pair of braces",
    title: "Config parser stopped at {{ on line 3",
  },
];

describe("IncidentEpisodeStateTimeline email subjects are sent as written", () => {
  test.each(TEMPLATE_SYNTAX_TITLES)(
    "a title with $name reaches the custom subject as written",
    async ({ title }: TemplateSyntaxTitle) => {
      pendingTimelines = [stateTimeline()];
      const row: IncidentEpisode = episode();
      row.title = title;
      storedEpisode = row;
      useCustomTemplatesOnEveryChannel();

      await runJob();

      expect(sentMail()).toHaveLength(1);
      expect(sentMail()[0]!["subject"]).toBe(
        `Subject: ${title} is ${STATE_NAME}`,
      );
      expect(sentMail()[0]!["isSubjectLiteral"]).toBe(true);
    },
  );

  test("a title with template syntax reaches the default subject as written", async () => {
    pendingTimelines = [stateTimeline()];
    const row: IncidentEpisode = episode();
    row.title = "Rollout of {{ .Values.image.tag }} stalled";
    storedEpisode = row;

    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["subject"]).toBe(
      `[${STATE_NAME} Incident] Rollout of {{ .Values.image.tag }} stalled`,
    );
    expect(sentMail()[0]!["isSubjectLiteral"]).toBe(true);
  });
});

/*
 * A state change is marked InProgress before anything is sent, and the cron
 * only ever picks up Pending rows. So an error part-way through must settle
 * the row as Failed: uncaught, it left the row "being sent" forever, and it
 * also ended the run before the remaining state changes were looked at.
 */
describe("IncidentEpisodeStateTimeline errors", () => {
  const SECOND_TIMELINE_ID: string = "abababab-abab-4bab-8bab-abababababab";

  function writesFor(timelineId: string): Array<JSONObject> {
    return statusWritesInOrder({
      claim:
        IncidentEpisodeStateTimelineService.compareAndSetColumnsByIdWithoutHooks,
      update: IncidentEpisodeStateTimelineService.updateOneById,
      id: timelineId,
    }).map((write: StatusWrite): JSONObject => {
      return write.data;
    });
  }

  test("an error while sending marks the state change Failed with the reason, not InProgress", async () => {
    pendingTimelines = [stateTimeline()];
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockRejectedValue(new Error("database unavailable") as never);

    await expect(runJob()).resolves.toBeUndefined();

    nothingSent();
    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatus:
          StatusPageSubscriberNotificationStatus.InProgress,
      },
      {
        subscriberNotificationStatus:
          StatusPageSubscriberNotificationStatus.Failed,
        subscriberNotificationStatusMessage: "database unavailable",
      },
    ]);
  });

  test("one failing state change does not stop the others in the same run", async () => {
    pendingTimelines = [
      stateTimeline(),
      stateTimeline({ id: SECOND_TIMELINE_ID }),
    ];

    let episodeReads: number = 0;
    mock(IncidentEpisodeService.findOneById).mockImplementation(async () => {
      episodeReads += 1;

      if (episodeReads === 1) {
        throw new Error("episode could not be read");
      }

      return storedEpisode;
    });

    await runJob();

    const first: Array<JSONObject> = writesFor(TIMELINE_ID.toString());
    const second: Array<JSONObject> = writesFor(SECOND_TIMELINE_ID);

    expect(first[first.length - 1]).toEqual({
      subscriberNotificationStatus:
        StatusPageSubscriberNotificationStatus.Failed,
      subscriberNotificationStatusMessage: "episode could not be read",
    });
    expect(second[second.length - 1]).toEqual({
      subscriberNotificationStatus:
        StatusPageSubscriberNotificationStatus.Success,
      subscriberNotificationStatusMessage:
        "Notifications sent successfully to all subscribers. Acme: 1 email, 1 SMS, 1 Slack, 1 Microsoft Teams, 1 webhook sent.",
    });
    expect(sentMail()).toHaveLength(1);
  });

  test("a failure to record Failed is logged, not thrown", async () => {
    pendingTimelines = [stateTimeline()];
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockRejectedValue(new Error("database unavailable") as never);
    mock(IncidentEpisodeStateTimelineService.updateOneById).mockImplementation(
      async (args: unknown): Promise<number> => {
        const data: JSONObject = (args as { data: JSONObject }).data;

        if (
          data["subscriberNotificationStatus"] ===
          StatusPageSubscriberNotificationStatus.Failed
        ) {
          throw new Error("write failed");
        }

        return 1;
      },
    );

    await expect(runJob()).resolves.toBeUndefined();
  });
});

/*
 * An episode reaches the union of the status pages its incidents reach, each
 * through its own status page scope (Incident.statusPages). Ten site pages
 * all list the shared monitor the incidents are on.
 */
describe("IncidentEpisodeStateTimeline:SendNotificationToSubscribers, with status page scope on its incidents", () => {
  const INCIDENT_A: ObjectID = new ObjectID(
    "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  );
  const INCIDENT_B: ObjectID = new ObjectID(
    "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1",
  );

  let pages: Array<StatusPage> = [];
  let subscribers: Array<StatusPageSubscriber> = [];

  function memberOnSharedMonitor(id: ObjectID): Incident {
    const incident: Incident = new Incident();
    incident._id = id.toString();
    incident.monitors = [sharedMonitor()];
    return incident;
  }

  function emailsSentTo(): Array<string> {
    return sentMail().map((mail: JSONObject): string => {
      return (mail["toEmail"] as Email).toString();
    });
  }

  function sitesLookedUp(): Array<number> {
    return mock(
      StatusPageSubscriberService.getSubscribersByStatusPage,
    ).mock.calls.map((call: Array<unknown>): number => {
      return siteOf(call[0]);
    });
  }

  beforeEach(() => {
    pages = allSites().map((site: number): StatusPage => {
      return sitePage(site);
    });
    subscribers = allSites().map((site: number): StatusPageSubscriber => {
      return siteSubscriber({ site: site, email: `site${site}@acme.com` });
    });

    mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
      allSites().map(siteResource) as never,
    );
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockImplementation(
      statusPagesByIdFake(() => {
        return pages;
      }) as never,
    );
    mock(
      StatusPageSubscriberService.getSubscribersByStatusPage,
    ).mockImplementation(
      subscribersByPageFake(() => {
        return subscribers;
      }) as never,
    );

    pendingTimelines = [stateTimeline()];
    memberIncidents = [memberOnSharedMonitor(INCIDENT_A)];
    storedScopes = { [INCIDENT_A.toString()]: scopedTo([7, 3]) };
  });

  test("a shared monitor on ten pages, with its incident scoped to two, tells only those two", async () => {
    await runJob();

    expect(emailsSentTo()).toEqual(["site3@acme.com", "site7@acme.com"]);
    expect(sitesLookedUp()).toEqual([3, 7]);
  });

  test("reaches the union of its incidents' pages, each through its own scope", async () => {
    pages = allSites().map((site: number): StatusPage => {
      return sitePage(site, { onlyShowScopedIncidents: site <= 3 });
    });
    memberIncidents = [
      memberOnSharedMonitor(INCIDENT_A),
      memberOnSharedMonitor(INCIDENT_B),
    ];
    storedScopes = { [INCIDENT_A.toString()]: scopedTo([3, 4]) };

    await runJob();

    expect(sitesLookedUp()).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(IncidentService.findBy).toHaveBeenCalledTimes(1);
  });

  test("an episode of unscoped incidents reaches none of ten pages that only show scoped incidents", async () => {
    storedScopes = {};
    pages = allSites().map((site: number): StatusPage => {
      return sitePage(site, { onlyShowScopedIncidents: true });
    });

    await runJob();

    nothingSent();
    expect(feedItems()).toHaveLength(1);
    expect(feedItems()[0]!["displayColor"]).toEqual(Yellow500);
    expect(feedItems()[0]!["moreInformationInMarkdown"]).toContain(
      "**Not sent to 10 status pages that only show incidents limited to them:**",
    );
  });

  test("someone on two reached pages gets one email and one SMS, but each page's webhook, Slack and Teams message", async () => {
    subscribers = [3, 7].map((site: number): StatusPageSubscriber => {
      return siteSubscriber({
        site: site,
        email: "shared@acme.com",
        phone: "+15555550100",
        webhook: "https://hooks.acme.com/status",
        slack: "https://hooks.slack.com/services/T000/B000/XXXX",
        teams: "https://outlook.office.com/webhook/abc",
      });
    });

    await runJob();

    expect(emailsSentTo()).toEqual(["shared@acme.com"]);
    expect(sentSms()).toHaveLength(1);
    expect(
      sentWebhooks().map((payload: JSONObject): number => {
        return siteOf(payload["statusPageId"]);
      }),
    ).toEqual([3, 7]);
    expect(sentSlack()).toHaveLength(2);
    expect(sentTeams()).toHaveLength(2);
  });

  test("an episode of unscoped incidents sends every subscription its email, as before", async () => {
    storedScopes = {};
    subscribers = [3, 7].map((site: number): StatusPageSubscriber => {
      return siteSubscriber({ site: site, email: "shared@acme.com" });
    });

    await runJob();

    expect(emailsSentTo()).toEqual(["shared@acme.com", "shared@acme.com"]);
  });

  test("the feed item lists each page, the subject used and what was sent", async () => {
    subscribers = [
      siteSubscriber({ site: 3, index: 1, email: "a@acme.com" }),
      siteSubscriber({ site: 7, index: 1, email: "b@acme.com" }),
    ];

    await runJob();

    expect(feedItems()).toHaveLength(1);
    expect(feedItems()[0]!["displayColor"]).toEqual(Blue500);
    expect(feedItems()[0]!["moreInformationInMarkdown"]).toBe(
      [
        "**Status pages:**",
        "",
        `- **Site 03**: 1 email sent. Subject: "\\[${STATE_NAME} Incident\\] ${EPISODE_TITLE}".`,
        `- **Site 07**: 1 email sent. Subject: "\\[${STATE_NAME} Incident\\] ${EPISODE_TITLE}".`,
        "",
        "Email and SMS were sent once per address across these status pages, because this is limited to specific status pages. Someone subscribed on more than one of them got the message of the first page in this list.",
        "",
        "**Not sent to 8 status pages outside the status pages this is limited to:** Site 01, Site 02, Site 04, Site 05, Site 06, Site 08, Site 09, Site 10.",
      ].join("\n"),
    );
  });
});

/*
 * Escaping. The episode title, state and severity, the status page's name
 * and the names of its resources and groups are plain text a project member
 * typed. In an email they must read as those characters; text channels (a
 * subject, SMS, Slack, Teams, webhooks) show text as written, so they must
 * get no HTML entities at all.
 */
describe("IncidentEpisodeStateTimeline escapes plain values in email", () => {
  const HOSTILE_STATE: string = "Mitigated <mostly> & 'mostly'";
  const HOSTILE_STATE_HTML: string =
    "Mitigated &lt;mostly&gt; &amp; &#39;mostly&#39;";

  const ESCAPING_EMAIL_BODY: string =
    '<h1>{{episodeTitle}}</h1><p>{{statusPageName}} / {{episodeState}} / {{episodeSeverity}}</p><div>{{resourcesAffected}}</div><a href="{{detailsUrl}}">Details</a>';
  const ESCAPING_TEXT: string =
    "{{episodeTitle}} on {{statusPageName}} is {{episodeState}}: {{resourcesAffected}}";

  beforeEach(() => {
    pendingTimelines = [stateTimeline({ stateName: HOSTILE_STATE })];
    const row: IncidentEpisode = episode();
    row.title = HOSTILE_TITLE;
    storedEpisode = row;
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
      hostileResources(STATUS_PAGE_ID) as never,
    );
  });

  describe("with custom templates", () => {
    beforeEach(() => {
      mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mockResolvedValue([
        statusPage({
          withCustomSmtpAndSms: true,
          pageTitle: HOSTILE_PAGE_NAME,
        }),
      ] as never);
      mock(
        StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
      ).mockImplementation(async (args: unknown) => {
        const method: string = (args as JSONObject)[
          "notificationMethod"
        ] as string;
        return method === StatusPageSubscriberNotificationMethod.Email
          ? { templateBody: ESCAPING_EMAIL_BODY, emailSubject: ESCAPING_TEXT }
          : { templateBody: `${method}: ${ESCAPING_TEXT}` };
      });
    });

    test("the email body escapes the plain values and keeps the resource list as HTML", async () => {
      await runJob();

      expect(sentMail()).toHaveLength(1);
      expect((sentMail()[0]!["vars"] as JSONObject)["body"]).toBe(
        `<h1>${HOSTILE_TITLE_HTML}</h1><p>${HOSTILE_PAGE_NAME_HTML} / ${HOSTILE_STATE_HTML} / ${EPISODE_SEVERITY}</p><div>${HOSTILE_RESOURCES_HTML}</div><a href="${DETAILS_URL}">Details</a>`,
      );

      const emailBody: Array<RecordedCompile> = recordedCompiles(
        StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate,
        StatusPageSubscriberNotificationTemplateServiceClass.compileEmailBodyTemplate,
      ).filter((call: RecordedCompile): boolean => {
        return call.emailBody;
      });
      expect(emailBody).toHaveLength(1);
      expectOnlyTheListedHtmlVariables(emailBody[0]!.rawVariables, EVENT);
    });

    test("the subject, SMS, Slack, Teams and webhooks get every value as written", async () => {
      await runJob();

      const text: string = `${HOSTILE_TITLE} on ${HOSTILE_PAGE_NAME} is ${HOSTILE_STATE}: ${HOSTILE_RESOURCES_TEXT}`;

      expect(sentMail()[0]!["subject"]).toBe(text);
      expect(sentSms()).toEqual([
        `${StatusPageSubscriberNotificationMethod.SMS}: ${text}`,
      ]);
      expect(sentSlack()).toEqual([
        `${StatusPageSubscriberNotificationMethod.Slack}: ${text}`,
      ]);
      expect(sentTeams()).toEqual([
        `${StatusPageSubscriberNotificationMethod.MicrosoftTeams}: ${text}`,
      ]);
      for (const message of [
        sentMail()[0]!["subject"] as string,
        ...sentSms(),
        ...sentSlack(),
        ...sentTeams(),
      ]) {
        expectNoHtmlEntities(message);
      }

      expect(sentWebhooks()[0]!["statusPageName"]).toBe(HOSTILE_PAGE_NAME);
      expect(sentWebhooks()[0]!["data"]).toEqual(
        expect.objectContaining({
          episodeTitle: HOSTILE_TITLE,
          incidentState: HOSTILE_STATE,
          resourcesAffected: HOSTILE_RESOURCES_TEXT,
        }),
      );
    });
  });

  test("the default email gets the resource list escaped and a plain heading, and the chat defaults get it as written", async () => {
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([
      statusPage({ pageTitle: HOSTILE_PAGE_NAME }),
    ] as never);

    await runJob();

    expect(sentMail()[0]!["vars"]).toEqual(
      expect.objectContaining({
        resourcesAffected: HOSTILE_RESOURCES_HTML,
        emailTitle: `Incident on ${HOSTILE_RESOURCES_TEXT} is ${HOSTILE_STATE}`,
        episodeTitle: HOSTILE_TITLE,
        episodeState: HOSTILE_STATE,
        statusPageName: HOSTILE_PAGE_NAME,
      }),
    );
    expect(sentSlack()[0]).toContain(
      `**Resources Affected:** ${HOSTILE_RESOURCES_TEXT}`,
    );
    expect(sentTeams()[0]).toContain(
      `**Resources Affected:** ${HOSTILE_RESOURCES_TEXT}`,
    );
    for (const message of [...sentSms(), ...sentSlack(), ...sentTeams()]) {
      expectNoHtmlEntities(message);
      expect(message).not.toContain("<br/>");
    }
  });
});

describe("IncidentEpisodeStateTimeline unsubscribe links", () => {
  test("every message links to the subscriber's own unsubscribe page, token included", async () => {
    pendingTimelines = [stateTimeline()];

    await runJob();

    /*
     * The job hands getUnsubscribeLink the subscriber row it read - with its
     * unsubscribe token - so the link works on private status pages without
     * signing in. An id alone, or the old manage page, would not.
     */
    expectEveryUnsubscribeLinkToCarryAToken(
      StatusPageSubscriberService.getUnsubscribeLink,
    );
  });
});

/*
 * How the notification sends (SubscriberDeliveryContract): every message
 * awaited and counted, failures of every kind on every channel, every
 * subscriber past LIMIT_MAX, and the send window and the run's latest claim.
 */
describeSubscriberDelivery({
  title: "IncidentEpisodeStateTimeline:SendNotificationToSubscribers",
  jobName: JOB,
  runJob: runJob,
  cronOptions: (): JSONObject | undefined => {
    return mockCapturedOptions[JOB] as JSONObject | undefined;
  },
  pendRows: (count: number): Array<ObjectID> => {
    pendingTimelines = [];

    for (let index: number = 0; index < count; index++) {
      const row: IncidentEpisodeStateTimeline = stateTimeline(
        index > 0 ? { id: ObjectID.generate().toString() } : undefined,
      );
      row.version = PENDING_ROW_VERSION;
      pendingTimelines.push(row);
    }

    return pendingTimelines.map(
      (row: IncidentEpisodeStateTimeline): ObjectID => {
        return row.id!;
      },
    );
  },
  statusColumn: "subscriberNotificationStatus",
  messageColumn: "subscriberNotificationStatusMessage",
  claim:
    IncidentEpisodeStateTimelineService.compareAndSetColumnsByIdWithoutHooks,
  update: IncidentEpisodeStateTimelineService.updateOneById,
  feed: IncidentEpisodeFeedService.createIncidentEpisodeFeedItem,
  subscribers: StatusPageSubscriberService.getSubscribersByStatusPage,
  emailSubscriber: (id: string): StatusPageSubscriber => {
    const row: StatusPageSubscriber = new StatusPageSubscriber();
    row._id = id;
    row.subscriberEmail = new Email(`subscriber-${id.slice(-12)}@example.com`);
    return withUnsubscribeToken(row);
  },
  senders: {
    email: MailService.sendMail,
    sms: SmsService.sendSms,
    slack: SlackUtil.sendMessageToChannelViaIncomingWebhook,
    teams: MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
    webhook: StatusPageSubscriberWebhookUtil.sendWebhookNotification,
  },
  sentMessage: "Notifications sent successfully to all subscribers.",
  retryScope: SubscriberNotificationRetryScope.EveryPage,
});
