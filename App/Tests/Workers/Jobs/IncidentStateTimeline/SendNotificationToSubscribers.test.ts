import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
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
 * Incident state change subscriber notifications. These tests drive one tick
 * of the job against fakes and check what each channel's custom template is
 * given, that the default messages stay as they were, and which status
 * columns are written.
 *
 * Each custom template gets values in the format its channel renders: HTML
 * in the email body, plain text in SMS and the email subject, and Markdown
 * in Slack and Teams. The resource list is formatted by the real
 * StatusPageResourceUtil, so the grouped-resource tests see the same "<br/>"
 * and "; " separators that production does.
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

jest.mock("Common/Server/Services/IncidentStateTimelineService", () => {
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
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateTimelineService from "Common/Server/Services/IncidentStateTimelineService";
import MailService from "Common/Server/Services/MailService";
import SmsService from "Common/Server/Services/SmsService";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService, {
  Service as StatusPageSubscriberNotificationTemplateServiceClass,
} from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import { getDefaultSubscriberNotificationTemplate } from "../../../../FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateDefaults";
import "../../../../FeatureSet/Workers/Jobs/IncidentStateTimeline/SendNotificationToSubscribers";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const JOB: string = "IncidentStateTimeline:SendNotificationToSubscribers";

const EVENT_TYPE: StatusPageSubscriberNotificationEventType =
  StatusPageSubscriberNotificationEventType.SubscriberIncidentStateChanged;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_ID: ObjectID = new ObjectID(
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
const SECOND_INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const SECOND_TIMELINE_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
);

const STATUS_PAGE_URL: string = "https://status.acme.com";
const SECOND_STATUS_PAGE_URL: string = "https://status.beta.com";
const DETAILS_URL: string = `${STATUS_PAGE_URL}/incidents/${INCIDENT_ID.toString()}`;
const UNSUBSCRIBE_URL: string = `${STATUS_PAGE_URL}/update-subscription/${SUBSCRIBER_ID.toString()}`;
const DASHBOARD_URL: string = "https://oneuptime.acme.com/dashboard/incident/1";

const INCIDENT_TITLE: string = "Checkout requests failing";
const INCIDENT_STATE_NAME: string = "Identified";
const INCIDENT_SEVERITY: string = "Critical";

/*
 * The description as written (Markdown), the email HTML the Markdown helper
 * turns it into for the email body, and the plain text it turns it into for
 * SMS and the email subject. None appears in any other fixture, so a
 * description can only render if it came from the incident.
 */
const INCIDENT_DESCRIPTION: string =
  "Card payments **fail** for customers in [Europe](https://acme.com/eu).";
const INCIDENT_DESCRIPTION_HTML: string =
  '<p>Card payments <strong>fail</strong> for customers in <a href="https://acme.com/eu">Europe</a>.</p>';
const INCIDENT_DESCRIPTION_TEXT: string =
  "Card payments fail for customers in Europe.";
const SECOND_INCIDENT_DESCRIPTION: string =
  "Search results are _stale_ for every tenant.";
const SECOND_INCIDENT_DESCRIPTION_HTML: string =
  "<p>Search results are <em>stale</em> for every tenant.</p>";
const SECOND_INCIDENT_DESCRIPTION_TEXT: string =
  "Search results are stale for every tenant.";

const HTML_BY_MARKDOWN: Record<string, string> = {
  [INCIDENT_DESCRIPTION]: INCIDENT_DESCRIPTION_HTML,
  [SECOND_INCIDENT_DESCRIPTION]: SECOND_INCIDENT_DESCRIPTION_HTML,
};

const PLAIN_TEXT_BY_MARKDOWN: Record<string, string> = {
  [INCIDENT_DESCRIPTION]: INCIDENT_DESCRIPTION_TEXT,
  [SECOND_INCIDENT_DESCRIPTION]: SECOND_INCIDENT_DESCRIPTION_TEXT,
};

/*
 * Two resources in two groups, as the real StatusPageResourceUtil lists them
 * for HTML (the email body) and for everything else.
 */
const GROUPED_RESOURCES_HTML: string =
  "Europe: Checkout API<br/>Americas: Payments API";
const GROUPED_RESOURCES_TEXT: string =
  "Europe: Checkout API; Americas: Payments API";

let pendingTimelines: Array<IncidentStateTimeline> = [];
let storedIncidents: Record<string, Incident> = {};

function stateTimeline(overrides?: {
  id?: ObjectID;
  incidentId?: ObjectID;
  stateName?: string;
  isCreatedState?: boolean;
}): IncidentStateTimeline {
  const row: IncidentStateTimeline = new IncidentStateTimeline();
  row._id = (overrides?.id || TIMELINE_ID).toString();
  row.projectId = PROJECT_ID;
  row.incidentId = overrides?.incidentId || INCIDENT_ID;
  row.incidentStateId = INCIDENT_STATE_ID;

  const state: IncidentState = new IncidentState();
  state.name = overrides?.stateName || INCIDENT_STATE_NAME;
  state.isCreatedState = Boolean(overrides?.isCreatedState);
  row.incidentState = state;

  return row;
}

function incident(overrides?: {
  id?: ObjectID;
  title?: string;
  // null leaves the description unset.
  description?: string | null;
  withoutTitle?: boolean;
  isVisibleOnStatusPage?: boolean;
}): Incident {
  const row: Incident = new Incident();
  row._id = (overrides?.id || INCIDENT_ID).toString();
  if (!overrides?.withoutTitle) {
    row.title = overrides?.title || INCIDENT_TITLE;
  }
  if (overrides?.description !== null) {
    row.description = overrides?.description || INCIDENT_DESCRIPTION;
  }
  row.projectId = PROJECT_ID;
  row.isVisibleOnStatusPage = overrides?.isVisibleOnStatusPage !== false;
  row.incidentNumber = 7;
  row.incidentNumberWithPrefix = "INC-7";

  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = INCIDENT_SEVERITY;
  row.incidentSeverity = severity;

  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  row.monitors = [monitor];

  return row;
}

function storeIncidents(rows: Array<Incident>): void {
  storedIncidents = {};
  for (const row of rows) {
    storedIncidents[row._id!] = row;
  }
}

function statusPage(overrides?: {
  showIncidentsOnStatusPage?: boolean;
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
  page.showIncidentsOnStatusPage =
    overrides?.showIncidentsOnStatusPage !== false;
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
  // Puts the resource in a status page group with this name.
  groupName?: string;
}): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = overrides?.id || "88888888-8888-4888-8888-888888888888";
  row.statusPageId = overrides?.statusPageId || STATUS_PAGE_ID;
  row.displayName = overrides?.displayName || "Checkout API";
  if (overrides?.groupName) {
    row.statusPageGroupId = ObjectID.generate();
    const group: StatusPageGroup = new StatusPageGroup();
    group.name = overrides.groupName;
    row.statusPageGroup = group;
  }
  return row;
}

// Lists as GROUPED_RESOURCES_HTML and GROUPED_RESOURCES_TEXT.
function groupedResources(): Array<StatusPageResource> {
  return [
    resource({ groupName: "Europe" }),
    resource({
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      displayName: "Payments API",
      groupName: "Americas",
    }),
  ];
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
  row.subscriberWebhook = URL.fromString("https://hooks.acme.com/status");
  return row;
}

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
}

function statusWrites(): Array<JSONObject> {
  return mock(IncidentStateTimelineService.updateOneById).mock.calls.map(
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

// The dashboard's starter template for a channel, filled from the fixtures.
function dashboardDefault(
  method: StatusPageSubscriberNotificationMethod,
): string {
  const template: string =
    getDefaultSubscriberNotificationTemplate(EVENT_TYPE, method)?.body || "";
  const variables: Record<string, string> = {
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    detailsUrl: DETAILS_URL,
    unsubscribeUrl: UNSUBSCRIBE_URL,
    incidentTitle: INCIDENT_TITLE,
    incidentSeverity: INCIDENT_SEVERITY,
    incidentState: INCIDENT_STATE_NAME,
    resourcesAffected: "Checkout API",
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

// Template variables in each format a custom template's channel renders.
interface ChannelVariables {
  // The custom email body, sent as HTML.
  emailBody: Record<string, string>;
  // SMS and the custom email subject.
  plainText: Record<string, string>;
  // Slack and Microsoft Teams.
  markdown: Record<string, string>;
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

// The variables the job handed to compileTemplate for this template, once.
function variablesCompiledInto(template: string): Record<string, string> {
  const calls: Array<CompileCall> = compileCalls().filter(
    (call: CompileCall): boolean => {
      return call.template === template;
    },
  );

  expect(calls).toHaveLength(1);
  return calls[0]!.variables;
}

function offeredVariableNames(): Array<string> {
  const names: Array<string> =
    SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
      EVENT_TYPE,
    );
  expect(names).toContain("incidentDescription");
  return names;
}

// Names the call does not carry as an own key with a string value.
function missingVariables(call: CompileCall): Array<string> {
  return offeredVariableNames().filter((name: string): boolean => {
    return (
      !Object.prototype.hasOwnProperty.call(call.variables, name) ||
      typeof call.variables[name] !== "string"
    );
  });
}

function expectEveryCallToCarryEveryVariable(calls: Array<CompileCall>): void {
  for (const call of calls) {
    expect({
      template: call.template,
      missing: missingVariables(call),
    }).toEqual({ template: call.template, missing: [] });
  }
}

const EMAIL_SUBJECT_TEMPLATE: string =
  "Subject: {{incidentTitle}} is {{incidentState}} on {{resourcesAffected}} ({{incidentDescription}})";

/*
 * A template body that prints every variable advertised for the event as
 * name=[value], so a test can see which ones rendered and with what.
 */
function templateUsingEveryVariable(channel: string): string {
  const lines: Array<string> = offeredVariableNames().map(
    (name: string): string => {
      return `${name}=[{{${name}}}]`;
    },
  );

  return [`channel=${channel}`, ...lines].join("\n");
}

// What templateUsingEveryVariable(channel) renders to with these values.
function renderedWith(channel: string, values: Record<string, string>): string {
  const lines: Array<string> = offeredVariableNames().map(
    (name: string): string => {
      expect(values[name]).toBeDefined();
      return `${name}=[${values[name]}]`;
    },
  );

  return [`channel=${channel}`, ...lines].join("\n");
}

const CUSTOM_BODIES: Record<string, string> = {
  [StatusPageSubscriberNotificationMethod.Email]:
    templateUsingEveryVariable("email"),
  [StatusPageSubscriberNotificationMethod.SMS]:
    templateUsingEveryVariable("sms"),
  [StatusPageSubscriberNotificationMethod.Slack]:
    templateUsingEveryVariable("slack"),
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]:
    templateUsingEveryVariable("teams"),
};

/*
 * Gives the status pages (custom SMTP and Twilio by default) a custom
 * template for the event on Email, SMS, Slack and Teams, each printing every
 * advertised variable. A lookup for any other event finds no template.
 */
function useCustomTemplatesOnEveryChannel(pages?: Array<StatusPage>): void {
  mock(
    StatusPageSubscriberService.getStatusPagesToSendNotification,
  ).mockResolvedValue(
    (pages || [statusPage({ withCustomSmtpAndSms: true })]) as never,
  );

  mock(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
  ).mockImplementation(async (args: unknown) => {
    const lookup: JSONObject = args as JSONObject;
    const method: string = lookup["notificationMethod"] as string;

    if (lookup["eventType"] !== EVENT_TYPE || !CUSTOM_BODIES[method]) {
      return null;
    }

    return method === StatusPageSubscriberNotificationMethod.Email
      ? {
          templateBody: CUSTOM_BODIES[method],
          emailSubject: EMAIL_SUBJECT_TEMPLATE,
        }
      : { templateBody: CUSTOM_BODIES[method] };
  });
}

// Two status pages, each with its own resource, URL and two subscribers.
function useTwoStatusPagesWithTwoSubscribers(): void {
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
      displayName: "Search API",
    }),
  ] as never);
  mock(
    StatusPageSubscriberService.getSubscribersByStatusPage,
  ).mockResolvedValue([
    subscriber(),
    subscriber(SECOND_SUBSCRIBER_ID),
  ] as never);
}

beforeEach(() => {
  jest.clearAllMocks();

  pendingTimelines = [stateTimeline()];
  storeIncidents([incident()]);

  mock(IncidentStateTimelineService.findBy).mockImplementation(async () => {
    return pendingTimelines;
  });
  mock(IncidentStateTimelineService.updateOneById).mockResolvedValue(
    1 as never,
  );

  mock(IncidentService.findOneById).mockImplementation(
    async (args: unknown): Promise<Incident | null> => {
      const id: ObjectID = (args as { id: ObjectID }).id;
      return storedIncidents[id.toString()] || null;
    },
  );
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
  mock(StatusPageSubscriberService.getUnsubscribeLink).mockImplementation(
    (statusPageUrl: unknown, subscriberId: unknown): URL => {
      return URL.fromString((statusPageUrl as URL).toString()).addRoute(
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

  /*
   * Only a known description has an HTML or plain-text form, so the email
   * body, the subject and SMS can only show the right text if the worker
   * converted the incident's own description (to email HTML for the body).
   */
  mock(Markdown.convertToHTML).mockImplementation(
    async (markdown: unknown, contentType: unknown): Promise<string> => {
      return contentType === MarkdownContentType.Email
        ? HTML_BY_MARKDOWN[markdown as string] ?? ""
        : "";
    },
  );
  mock(Markdown.convertToPlainText).mockImplementation(
    (markdown: unknown): string => {
      return PLAIN_TEXT_BY_MARKDOWN[markdown as string] ?? "";
    },
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

describe("IncidentStateTimeline custom templates receive every advertised variable", () => {
  test("Email body and subject, SMS, Slack and Teams each get all of them", async () => {
    useCustomTemplatesOnEveryChannel();

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
        CUSTOM_BODIES[StatusPageSubscriberNotificationMethod.Email]!,
        EMAIL_SUBJECT_TEMPLATE,
        CUSTOM_BODIES[StatusPageSubscriberNotificationMethod.SMS]!,
        CUSTOM_BODIES[StatusPageSubscriberNotificationMethod.Slack]!,
        CUSTOM_BODIES[StatusPageSubscriberNotificationMethod.MicrosoftTeams]!,
      ].sort(),
    );

    expectEveryCallToCarryEveryVariable(calls);
  });

  test("every page and every subscriber gets all of them, with its own page's values and its own unsubscribe link", async () => {
    useTwoStatusPagesWithTwoSubscribers();

    await runJob();

    const calls: Array<CompileCall> = compileCalls();

    // Two pages, two subscribers each, five templates per subscriber.
    expect(calls).toHaveLength(20);
    expectEveryCallToCarryEveryVariable(calls);

    const seen: Array<string> = [];
    for (const call of calls) {
      const page: string = call.variables["statusPageName"]!;
      const pageUrl: string =
        page === "Beta Status" ? SECOND_STATUS_PAGE_URL : STATUS_PAGE_URL;

      expect(call.variables["statusPageUrl"]).toBe(pageUrl);
      expect(call.variables["detailsUrl"]).toBe(
        `${pageUrl}/incidents/${INCIDENT_ID.toString()}`,
      );
      expect(call.variables["resourcesAffected"]).toBe(
        page === "Beta Status" ? "Search API" : "Checkout API",
      );
      expect(call.variables["incidentDescription"]).not.toBe("");

      const unsubscribePrefix: string = `${pageUrl}/update-subscription/`;
      expect(
        call.variables["unsubscribeUrl"]!.startsWith(unsubscribePrefix),
      ).toBe(true);

      const entry: string = `${page} -> ${call.variables["unsubscribeUrl"]!.slice(unsubscribePrefix.length)}`;
      if (!seen.includes(entry)) {
        seen.push(entry);
      }
    }

    expect(seen.sort()).toEqual(
      [
        `Acme Status -> ${SUBSCRIBER_ID.toString()}`,
        `Acme Status -> ${SECOND_SUBSCRIBER_ID.toString()}`,
        `Beta Status -> ${SUBSCRIBER_ID.toString()}`,
        `Beta Status -> ${SECOND_SUBSCRIBER_ID.toString()}`,
      ].sort(),
    );
  });

  test("Slack and Teams get all of them without custom SMTP or Twilio, while Email and SMS keep their defaults", async () => {
    useCustomTemplatesOnEveryChannel([statusPage()]);

    await runJob();

    const calls: Array<CompileCall> = compileCalls();
    expect(
      calls
        .map((call: CompileCall): string => {
          return call.template;
        })
        .sort(),
    ).toEqual(
      [
        CUSTOM_BODIES[StatusPageSubscriberNotificationMethod.Slack]!,
        CUSTOM_BODIES[StatusPageSubscriberNotificationMethod.MicrosoftTeams]!,
      ].sort(),
    );
    expectEveryCallToCarryEveryVariable(calls);

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberIncidentStateChanged,
    );
    expect(sentSms()).toEqual([
      dashboardDefault(StatusPageSubscriberNotificationMethod.SMS),
    ]);
  });
});

describe("IncidentStateTimeline {{incidentDescription}}", () => {
  test("loads the incident's description", async () => {
    await runJob();

    const select: JSONObject = (
      mock(IncidentService.findOneById).mock.calls[0]![0] as {
        select: JSONObject;
      }
    ).select;

    expect(select["description"]).toBe(true);
  });

  test("the email body gets the description as HTML, the subject and SMS as plain text, and Slack and Teams as written", async () => {
    useCustomTemplatesOnEveryChannel();

    await runJob();

    expect(Markdown.convertToHTML).toHaveBeenCalledWith(
      INCIDENT_DESCRIPTION,
      MarkdownContentType.Email,
    );
    expect(Markdown.convertToPlainText).toHaveBeenCalledWith(
      INCIDENT_DESCRIPTION,
    );

    const calls: Array<CompileCall> = compileCalls();
    expect(calls).toHaveLength(5);

    const byTemplate: Record<string, string> = {};
    for (const call of calls) {
      byTemplate[call.template] = call.variables["incidentDescription"]!;
    }

    expect(byTemplate).toEqual({
      [CUSTOM_BODIES[StatusPageSubscriberNotificationMethod.Email]!]:
        INCIDENT_DESCRIPTION_HTML,
      [EMAIL_SUBJECT_TEMPLATE]: INCIDENT_DESCRIPTION_TEXT,
      [CUSTOM_BODIES[StatusPageSubscriberNotificationMethod.SMS]!]:
        INCIDENT_DESCRIPTION_TEXT,
      [CUSTOM_BODIES[StatusPageSubscriberNotificationMethod.Slack]!]:
        INCIDENT_DESCRIPTION,
      [CUSTOM_BODIES[StatusPageSubscriberNotificationMethod.MicrosoftTeams]!]:
        INCIDENT_DESCRIPTION,
    });

    expect(sentSms()[0]).toContain(
      `incidentDescription=[${INCIDENT_DESCRIPTION_TEXT}]`,
    );
    expect(sentSlack()[0]).toContain(
      `incidentDescription=[${INCIDENT_DESCRIPTION}]`,
    );
    expect(sentTeams()[0]).toContain(
      `incidentDescription=[${INCIDENT_DESCRIPTION}]`,
    );
    expect((sentMail()[0]!["vars"] as JSONObject)["body"]).toContain(
      `incidentDescription=[${INCIDENT_DESCRIPTION_HTML}]`,
    );
    expect(sentMail()[0]!["subject"]).toBe(
      `Subject: ${INCIDENT_TITLE} is ${INCIDENT_STATE_NAME} on Checkout API (${INCIDENT_DESCRIPTION_TEXT})`,
    );
  });

  test("converts the description to HTML and plain text once per state change, not per page or subscriber", async () => {
    useTwoStatusPagesWithTwoSubscribers();

    await runJob();

    expect(Markdown.convertToHTML).toHaveBeenCalledTimes(1);
    expect(Markdown.convertToPlainText).toHaveBeenCalledTimes(1);

    const descriptionsFor: (template: string) => Array<string> = (
      template: string,
    ): Array<string> => {
      return compileCalls()
        .filter((call: CompileCall): boolean => {
          return call.template === template;
        })
        .map((call: CompileCall): string => {
          return call.variables["incidentDescription"]!;
        });
    };

    // Two pages with two subscribers each.
    const emailBodies: Array<string> = descriptionsFor(
      CUSTOM_BODIES[StatusPageSubscriberNotificationMethod.Email]!,
    );
    expect(emailBodies).toHaveLength(4);
    for (const description of emailBodies) {
      expect(description).toBe(INCIDENT_DESCRIPTION_HTML);
    }

    const plainText: Array<string> = [
      ...descriptionsFor(EMAIL_SUBJECT_TEMPLATE),
      ...descriptionsFor(
        CUSTOM_BODIES[StatusPageSubscriberNotificationMethod.SMS]!,
      ),
    ];
    expect(plainText).toHaveLength(8);
    for (const description of plainText) {
      expect(description).toBe(INCIDENT_DESCRIPTION_TEXT);
    }
  });

  test("an incident without a description renders an empty description on every channel", async () => {
    storeIncidents([incident({ description: null })]);
    useCustomTemplatesOnEveryChannel();

    await runJob();

    const calls: Array<CompileCall> = compileCalls();
    expect(calls).toHaveLength(5);
    expectEveryCallToCarryEveryVariable(calls);
    for (const call of calls) {
      expect(call.variables["incidentDescription"]).toBe("");
    }

    const rendered: Array<string> = [
      (sentMail()[0]!["vars"] as JSONObject)["body"] as string,
      sentMail()[0]!["subject"] as string,
      sentSms()[0]!,
      sentSlack()[0]!,
      sentTeams()[0]!,
    ];
    for (const message of rendered) {
      expect(message).not.toContain("undefined");
      expect(message).not.toMatch(/{{|}}/);
    }
    expect(sentSms()[0]).toContain("incidentDescription=[]");
  });

  test("each state change in a tick carries its own incident's description", async () => {
    storeIncidents([
      incident(),
      incident({
        id: SECOND_INCIDENT_ID,
        title: "Search is stale",
        description: SECOND_INCIDENT_DESCRIPTION,
      }),
    ]);
    pendingTimelines = [
      stateTimeline(),
      stateTimeline({
        id: SECOND_TIMELINE_ID,
        incidentId: SECOND_INCIDENT_ID,
        stateName: "Resolved",
      }),
    ];
    useCustomTemplatesOnEveryChannel();

    await runJob();

    const calls: Array<CompileCall> = compileCalls();
    expect(calls).toHaveLength(10);
    expectEveryCallToCarryEveryVariable(calls);

    // The format each template's channel renders.
    const formatOf: (template: string) => string = (
      template: string,
    ): string => {
      if (
        template === CUSTOM_BODIES[StatusPageSubscriberNotificationMethod.Email]
      ) {
        return "html";
      }

      if (
        template === EMAIL_SUBJECT_TEMPLATE ||
        template === CUSTOM_BODIES[StatusPageSubscriberNotificationMethod.SMS]
      ) {
        return "text";
      }

      return "markdown";
    };

    const descriptions: Array<string> = calls.map(
      (call: CompileCall): string => {
        return `${call.variables["incidentTitle"]} | ${call.variables["incidentState"]} | ${formatOf(call.template)} | ${call.variables["incidentDescription"]}`;
      },
    );

    expect(Array.from(new Set(descriptions)).sort()).toEqual(
      [
        `${INCIDENT_TITLE} | ${INCIDENT_STATE_NAME} | html | ${INCIDENT_DESCRIPTION_HTML}`,
        `${INCIDENT_TITLE} | ${INCIDENT_STATE_NAME} | text | ${INCIDENT_DESCRIPTION_TEXT}`,
        `${INCIDENT_TITLE} | ${INCIDENT_STATE_NAME} | markdown | ${INCIDENT_DESCRIPTION}`,
        `Search is stale | Resolved | html | ${SECOND_INCIDENT_DESCRIPTION_HTML}`,
        `Search is stale | Resolved | text | ${SECOND_INCIDENT_DESCRIPTION_TEXT}`,
        `Search is stale | Resolved | markdown | ${SECOND_INCIDENT_DESCRIPTION}`,
      ].sort(),
    );
  });
});

describe("IncidentStateTimeline custom template rendering", () => {
  test("a template using every advertised variable renders completely on every channel", async () => {
    useCustomTemplatesOnEveryChannel();

    await runJob();

    // What the fixtures hold for each advertised variable.
    const expectedValues: Record<string, string> = {
      statusPageName: "Acme Status",
      statusPageUrl: STATUS_PAGE_URL,
      unsubscribeUrl: UNSUBSCRIBE_URL,
      resourcesAffected: "Checkout API",
      incidentTitle: INCIDENT_TITLE,
      incidentDescription: INCIDENT_DESCRIPTION,
      incidentSeverity: INCIDENT_SEVERITY,
      incidentState: INCIDENT_STATE_NAME,
      detailsUrl: DETAILS_URL,
    };

    const names: Array<string> = offeredVariableNames();
    expect(Object.keys(expectedValues).sort()).toEqual([...names].sort());

    expect(compileCalls()).toHaveLength(5);
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

    /*
     * The email body gets the description as HTML and SMS as plain text;
     * Slack and Teams get it as written. The ungrouped resource list reads
     * the same in HTML and plain text.
     */
    const descriptionByChannel: Record<string, string> = {
      email: INCIDENT_DESCRIPTION_HTML,
      sms: INCIDENT_DESCRIPTION_TEXT,
      slack: INCIDENT_DESCRIPTION,
      teams: INCIDENT_DESCRIPTION,
    };

    for (const [channel, message] of Object.entries(rendered)) {
      expect(message).toContain(`channel=${channel}`);
      expect(message).not.toMatch(/{{|}}/);

      for (const name of names) {
        const value: string =
          name === "incidentDescription"
            ? descriptionByChannel[channel]!
            : expectedValues[name]!;

        expect(value).not.toBe("");
        expect(message).toContain(`${name}=[${value}]`);
      }
    }

    expect(sentMail()[0]!["subject"]).not.toMatch(/{{|}}/);
    expect(sentMail()[0]!["subject"]).toBe(
      `Subject: ${INCIDENT_TITLE} is ${INCIDENT_STATE_NAME} on Checkout API (${INCIDENT_DESCRIPTION_TEXT})`,
    );
  });

  test("incidentState is the state name as stored, while the defaults capitalise it", async () => {
    pendingTimelines = [stateTimeline({ stateName: "monitoring" })];
    useCustomTemplatesOnEveryChannel([
      statusPage({ withCustomSmtpAndSms: true }),
      statusPage({ id: SECOND_STATUS_PAGE_ID, pageTitle: "Beta Status" }),
    ]);
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue([
      resource(),
      resource({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        statusPageId: SECOND_STATUS_PAGE_ID,
        displayName: "Search API",
      }),
    ] as never);

    await runJob();

    // Five on the page with custom SMTP and Twilio, Slack and Teams on the other.
    const calls: Array<CompileCall> = compileCalls();
    expect(calls).toHaveLength(7);
    for (const call of calls) {
      expect(call.variables["incidentState"]).toBe("monitoring");
    }

    // The second page has no custom SMTP or Twilio, so it sends the defaults.
    expect(sentSms()).toContain(
      `Incident ${INCIDENT_TITLE} on Beta Status is Monitoring. Details: ${SECOND_STATUS_PAGE_URL}/incidents/${INCIDENT_ID.toString()}. Unsub: ${SECOND_STATUS_PAGE_URL}/update-subscription/${SUBSCRIBER_ID.toString()}`,
    );
    expect(
      sentMail().map((mail: JSONObject): string => {
        return mail["subject"] as string;
      }),
    ).toContain(`[Monitoring Incident] ${INCIDENT_TITLE}`);
  });

  test("a custom email template without a subject falls back to the state subject", async () => {
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
        ? { templateBody: "<p>{{incidentDescription}}</p>" }
        : null;
    });

    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.BlankTemplate,
    );
    expect(sentMail()[0]!["subject"]).toBe(
      `[Incident ${INCIDENT_STATE_NAME}] ${INCIDENT_TITLE}`,
    );
    expect(sentMail()[0]!["vars"]).toEqual({
      body: `<p>${INCIDENT_DESCRIPTION_HTML}</p>`,
    });
  });

  test("an untitled incident gets the bare subject fallback, not 'undefined'", async () => {
    storeIncidents([incident({ withoutTitle: true })]);
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([statusPage({ withCustomSmtpAndSms: true })] as never);
    mock(
      StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
    ).mockImplementation(async (args: unknown) => {
      return (args as JSONObject)["notificationMethod"] ===
        StatusPageSubscriberNotificationMethod.Email
        ? { templateBody: "<p>{{incidentTitle}}</p>" }
        : null;
    });

    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["subject"]).toBe(
      `[Incident ${INCIDENT_STATE_NAME}] `,
    );
  });
});

describe("IncidentStateTimeline custom templates, with grouped resources", () => {
  beforeEach(() => {
    useCustomTemplatesOnEveryChannel();
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
      groupedResources() as never,
    );
  });

  // The values each channel's template should get, in its channel's format.
  function expectedVariables(): ChannelVariables {
    const shared: Record<string, string> = {
      statusPageName: "Acme Status",
      statusPageUrl: STATUS_PAGE_URL,
      detailsUrl: DETAILS_URL,
      unsubscribeUrl: UNSUBSCRIBE_URL,
      incidentTitle: INCIDENT_TITLE,
      incidentSeverity: INCIDENT_SEVERITY,
      incidentState: INCIDENT_STATE_NAME,
    };

    return {
      emailBody: {
        ...shared,
        resourcesAffected: GROUPED_RESOURCES_HTML,
        incidentDescription: INCIDENT_DESCRIPTION_HTML,
      },
      plainText: {
        ...shared,
        resourcesAffected: GROUPED_RESOURCES_TEXT,
        incidentDescription: INCIDENT_DESCRIPTION_TEXT,
      },
      markdown: {
        ...shared,
        resourcesAffected: GROUPED_RESOURCES_TEXT,
        incidentDescription: INCIDENT_DESCRIPTION,
      },
    };
  }

  test("renders HTML in the email body, plain text in SMS and the subject, and Markdown in chat", async () => {
    await runJob();

    const expected: ChannelVariables = expectedVariables();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.BlankTemplate,
    );
    expect(sentMail()[0]!["vars"]).toEqual({
      body: renderedWith("email", expected.emailBody),
    });
    expect(sentMail()[0]!["subject"]).toBe(
      `Subject: ${INCIDENT_TITLE} is ${INCIDENT_STATE_NAME} on ${GROUPED_RESOURCES_TEXT} (${INCIDENT_DESCRIPTION_TEXT})`,
    );
    expect(sentSms()).toEqual([renderedWith("sms", expected.plainText)]);
    expect(sentSlack()).toEqual([renderedWith("slack", expected.markdown)]);
    expect(sentTeams()).toEqual([renderedWith("teams", expected.markdown)]);

    // "<br/>" only reaches the channel that renders HTML.
    for (const message of [
      sentMail()[0]!["subject"] as string,
      ...sentSms(),
      ...sentSlack(),
      ...sentTeams(),
    ]) {
      expect(message).not.toContain("<br/>");
    }
  });

  test("hands each channel's template every advertised variable, in that channel's format", async () => {
    await runJob();

    const expected: ChannelVariables = expectedVariables();

    for (const variables of Object.values(expected)) {
      expect(Object.keys(variables).sort()).toEqual(
        [...offeredVariableNames()].sort(),
      );
    }

    expect(
      variablesCompiledInto(
        CUSTOM_BODIES[StatusPageSubscriberNotificationMethod.Email]!,
      ),
    ).toEqual(expected.emailBody);
    expect(variablesCompiledInto(EMAIL_SUBJECT_TEMPLATE)).toEqual(
      expected.plainText,
    );
    expect(
      variablesCompiledInto(
        CUSTOM_BODIES[StatusPageSubscriberNotificationMethod.SMS]!,
      ),
    ).toEqual(expected.plainText);
    expect(
      variablesCompiledInto(
        CUSTOM_BODIES[StatusPageSubscriberNotificationMethod.Slack]!,
      ),
    ).toEqual(expected.markdown);
    expect(
      variablesCompiledInto(
        CUSTOM_BODIES[StatusPageSubscriberNotificationMethod.MicrosoftTeams]!,
      ),
    ).toEqual(expected.markdown);
  });

  test("sends webhooks a plain-text resource list", async () => {
    await runJob();

    expect(sentWebhooks()).toEqual([
      {
        eventType: "IncidentStateChanged",
        statusPageId: STATUS_PAGE_ID.toString(),
        statusPageName: "Acme Status",
        statusPageUrl: STATUS_PAGE_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
        data: {
          incidentId: INCIDENT_ID.toString(),
          incidentNumber: "7",
          incidentTitle: INCIDENT_TITLE,
          incidentSeverity: INCIDENT_SEVERITY,
          incidentState: INCIDENT_STATE_NAME,
          resourcesAffected: GROUPED_RESOURCES_TEXT,
          detailsUrl: DETAILS_URL,
        },
      },
    ]);
  });
});

describe("IncidentStateTimeline default messages", () => {
  test("the default email still gets HTML for a grouped resource list", async () => {
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
      groupedResources() as never,
    );

    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberIncidentStateChanged,
    );
    expect(sentMail()[0]!["vars"]).toEqual(
      expect.objectContaining({
        emailTitle: `Incident on ${GROUPED_RESOURCES_HTML} is ${INCIDENT_STATE_NAME}`,
        resourcesAffected: GROUPED_RESOURCES_HTML,
      }),
    );
  });

  test("compiles no template when the status page has no custom templates", async () => {
    await runJob();

    expect(
      StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate,
    ).not.toHaveBeenCalled();

    const lookups: Array<JSONObject> = mock(
      StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
    ).mock.calls.map((call: Array<unknown>): JSONObject => {
      return call[0] as JSONObject;
    });
    expect(lookups).toHaveLength(4);
    for (const lookup of lookups) {
      expect(lookup["eventType"]).toBe(EVENT_TYPE);
    }
  });

  test("SMS, Slack and Teams are unchanged and match the dashboard defaults", async () => {
    await runJob();

    expect(sentSms()).toEqual([
      `Incident ${INCIDENT_TITLE} on Acme Status is ${INCIDENT_STATE_NAME}. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
    ]);
    expect(sentSms()[0]).toBe(
      dashboardDefault(StatusPageSubscriberNotificationMethod.SMS),
    );

    const richDefault: string = `🚨 ## Incident - ${INCIDENT_TITLE}


**Resources Affected:** Checkout API
**Severity:** ${INCIDENT_SEVERITY}
**Status:** ${INCIDENT_STATE_NAME}

[View Status Page](${STATUS_PAGE_URL}) | [Unsubscribe](${UNSUBSCRIBE_URL})`;

    expect(sentSlack()).toEqual([richDefault]);
    expect(sentSlack()[0]).toBe(
      dashboardDefault(StatusPageSubscriberNotificationMethod.Slack),
    );
    expect(sentTeams()).toEqual([richDefault]);
    expect(sentTeams()[0]).toBe(
      dashboardDefault(StatusPageSubscriberNotificationMethod.MicrosoftTeams),
    );

    for (const message of [...sentSms(), ...sentSlack(), ...sentTeams()]) {
      expect(message).not.toContain(INCIDENT_DESCRIPTION);
      expect(message).not.toContain(INCIDENT_DESCRIPTION_TEXT);
    }
  });

  test("the default email keeps its template, subject and variables", async () => {
    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberIncidentStateChanged,
    );
    expect(sentMail()[0]!["subject"]).toBe(
      `[${INCIDENT_STATE_NAME} Incident] ${INCIDENT_TITLE}`,
    );
    expect(sentMail()[0]!["vars"]).toEqual({
      emailTitle: `Incident on Checkout API is ${INCIDENT_STATE_NAME}`,
      statusPageName: "Acme Status",
      statusPageUrl: STATUS_PAGE_URL,
      detailsUrl: DETAILS_URL,
      logoUrl: "",
      isPublicStatusPage: "true",
      resourcesAffected: "Checkout API",
      incidentSeverity: INCIDENT_SEVERITY,
      incidentTitle: INCIDENT_TITLE,
      incidentState: INCIDENT_STATE_NAME,
      unsubscribeUrl: UNSUBSCRIBE_URL,
      subscriberEmailNotificationFooterText: "Footer text",
    });
  });

  test("the webhook payload is unchanged", async () => {
    await runJob();

    expect(sentWebhooks()).toEqual([
      {
        eventType: "IncidentStateChanged",
        statusPageId: STATUS_PAGE_ID.toString(),
        statusPageName: "Acme Status",
        statusPageUrl: STATUS_PAGE_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
        data: {
          incidentId: INCIDENT_ID.toString(),
          incidentNumber: "7",
          incidentTitle: INCIDENT_TITLE,
          incidentSeverity: INCIDENT_SEVERITY,
          incidentState: INCIDENT_STATE_NAME,
          resourcesAffected: "Checkout API",
          detailsUrl: DETAILS_URL,
        },
      },
    ]);
  });

  test("records progress, success and a feed item", async () => {
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
      `📧 **Status Page Subscribers have been notified** about the state change of the [Incident INC-7](${DASHBOARD_URL}) to **${INCIDENT_STATE_NAME}**`,
    );
  });
});

describe("IncidentStateTimeline skips", () => {
  test("skips the created state, which the incident created job already announced", async () => {
    pendingTimelines = [stateTimeline({ isCreatedState: true })];
    useCustomTemplatesOnEveryChannel();

    await runJob();

    nothingSent();
    expect(compileCalls()).toHaveLength(0);
    expect(IncidentService.findOneById).not.toHaveBeenCalled();
    expect(
      statusWrites()[statusWrites().length - 1]![
        "subscriberNotificationStatus"
      ],
    ).toBe(StatusPageSubscriberNotificationStatus.Skipped);
  });

  test("skips an incident that is not visible on the status page", async () => {
    storeIncidents([incident({ isVisibleOnStatusPage: false })]);
    useCustomTemplatesOnEveryChannel();

    await runJob();

    nothingSent();
    expect(statusWrites()[statusWrites().length - 1]).toEqual({
      subscriberNotificationStatus:
        StatusPageSubscriberNotificationStatus.Skipped,
      subscriberNotificationStatusMessage:
        "Incident is not visible on status page. Skipping notifications.",
    });
  });

  test("respects a status page that hides incidents", async () => {
    useCustomTemplatesOnEveryChannel([
      statusPage({
        withCustomSmtpAndSms: true,
        showIncidentsOnStatusPage: false,
      }),
    ]);

    await runJob();

    nothingSent();
    expect(compileCalls()).toHaveLength(0);
    expect(feedItems()[0]!["feedInfoInMarkdown"]).toContain(
      "**No notification sent to subscribers**",
    );
  });
});
