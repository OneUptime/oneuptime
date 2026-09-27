import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import URL from "Common/Types/API/URL";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import IncidentCreatedRenotify from "Common/Types/StatusPage/IncidentCreatedRenotify";
import IncidentScopeAddedPagesNotification from "Common/Types/StatusPage/IncidentScopeAddedPagesNotification";

/*
 * Incident created subscriber notifications. These tests drive a tick of the
 * job against fakes and check what subscribers receive on each channel, and
 * in which format each channel gets the incident description and the
 * resource list.
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

jest.mock("Common/Server/Services/IncidentService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      // IncidentStatusPageScope reads each incident's status page scope.
      findBy: jest.fn(),
      updateOneById: jest.fn(),
      getIncidentLinkInDashboard: jest.fn(),
      // The claim (SubscriberNotificationClaim) and the pages told so far.
      compareAndSetColumnsByIdWithoutHooks: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
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
      // The real substitution, recorded so tests can read the variables.
      Service: {
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

/*
 * The project's incident custom fields (IncidentTemplateVariableBuilder):
 * none unless a test gives it some (see IncidentCustomFieldFixtures), and the
 * visibility of a Rich text field's inline images, recorded.
 */
jest.mock("Common/Server/Services/IncidentCustomFieldService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Utils/InlineImageAccessTokenSync", () => {
  return { __esModule: true, syncIsPublicForMarkdownImages: jest.fn() };
});

import DatabaseConfig from "Common/Server/DatabaseConfig";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import IncidentService from "Common/Server/Services/IncidentService";
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
import Dictionary from "Common/Types/Dictionary";
import {
  StoredIncidentScope,
  allSites,
  incidentScopeFindBy,
  scopedTo,
  siteOf,
  sitePage,
  sitePageId,
  siteResource,
  siteSubscriber,
  statusPagesByIdFake,
  subscribersByPageFake,
} from "../Fixtures/IncidentStatusPageScopeFixtures";
import { Blue500, Red500, Yellow500 } from "Common/Types/BrandColors";
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
import IncidentCustomFieldService from "Common/Server/Services/IncidentCustomFieldService";
import { IncidentTemplateCustomFieldDefinition } from "Common/Server/Utils/StatusPage/IncidentTemplateVariableBuilder";
import {
  AFFECTED_LOCATION,
  AFFECTED_LOCATION_HTML,
  CUSTOM_FIELD_DEFINITIONS,
  CUSTOM_FIELD_PLACEHOLDERS_TEMPLATE,
  CUSTOM_FIELD_VALUES,
  EXPECTED_CUSTOM_FIELD_ROWS,
  EXPECTED_INCLUDED_FIELDS_FEED,
  EXPECTED_WEBHOOK_CUSTOM_FIELDS,
  IMPACT_DETAILS,
  IMPACT_DETAILS_HTML,
  IMPACT_DETAILS_TEXT,
  INCIDENT_LABELS,
  INTERNAL_TICKET,
  expectOnlyOfferedVariables,
  incidentLabels,
  plainTextOfImpactDetails,
  renderImpactDetails,
} from "../Fixtures/IncidentCustomFieldFixtures";
import { syncIsPublicForMarkdownImages } from "Common/Server/Utils/InlineImageAccessTokenSync";
import {
  failSends,
  statusesInOrder,
} from "../Fixtures/SubscriberNotificationSendFixtures";
import {
  PENDING_ROW_VERSION,
  describeSubscriberDelivery,
} from "../Fixtures/SubscriberDeliveryContract";
import { SubscriberNotificationRetryScope } from "Common/Server/Utils/StatusPage/SubscriberNotificationDeliveryRecord";
import SubscriberIncidentEmailBuilder, {
  SubscriberIncidentEmail,
  SubscriberIncidentEmailEvent,
  SubscriberIncidentStatusPageEmail,
} from "Common/Server/Utils/StatusPage/SubscriberIncidentEmailBuilder";
import "../../../../FeatureSet/Workers/Jobs/Incident/SendNotificationToSubscribers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const JOB: string = "Incident:SendNotificationToSubscribers";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

const STATUS_PAGE_URL: string = "https://status.acme.com";
const DETAILS_URL: string = `${STATUS_PAGE_URL}/incidents/${INCIDENT_ID.toString()}`;
const UNSUBSCRIBE_URL: string = unsubscribeLinkFor(
  STATUS_PAGE_URL,
  SUBSCRIBER_ID,
);
// An SMS from this public page carries the manage link (see smsManageLinkFor).
const SMS_UNSUBSCRIBE_URL: string = smsManageLinkFor(
  STATUS_PAGE_URL,
  SUBSCRIBER_ID,
);
const DASHBOARD_URL: string = "https://oneuptime.acme.com/dashboard/incident/1";

const INCIDENT_TITLE: string = "Checkout requests failing";
const DESCRIPTION: string = "Payments fail in **Europe** and the US.";
const DESCRIPTION_HTML: string =
  "<p>Payments fail in <strong>Europe</strong> and the US.</p>";
const DESCRIPTION_TEXT: string = "Payments fail in Europe and the US.";

const GROUPED_RESOURCES_HTML: string =
  "Europe: Checkout API<br/>Americas: Payments API";
const GROUPED_RESOURCES_TEXT: string =
  "Europe: Checkout API; Americas: Payments API";

/*
 * One custom template per channel. Each echoes the description and the
 * resource list, so the message shows which format that channel was given.
 */
const CUSTOM_EMAIL_BODY: string =
  "<div>{{incidentDescription}}</div><div>{{resourcesAffected}}</div>";
const CUSTOM_EMAIL_SUBJECT: string =
  "{{incidentTitle}}: {{incidentDescription}} ({{resourcesAffected}})";
const CUSTOM_SMS_BODY: string =
  "SMS {{incidentDescription}} ({{resourcesAffected}})";
const CUSTOM_SLACK_BODY: string =
  "Slack {{incidentDescription}} ({{resourcesAffected}})";
const CUSTOM_TEAMS_BODY: string =
  "Teams {{incidentDescription}} ({{resourcesAffected}})";

let pendingIncidents: Array<Incident> = [];
// The status page scope stored for each incident id; unscoped when absent.
let storedScopes: Dictionary<StoredIncidentScope> = {};

function incident(): Incident {
  const row: Incident = new Incident();
  row._id = INCIDENT_ID.toString();
  row.title = INCIDENT_TITLE;
  row.description = DESCRIPTION;
  row.projectId = PROJECT_ID;
  row.isVisibleOnStatusPage = true;
  row.incidentNumber = 7;
  row.incidentNumberWithPrefix = "INC-7";

  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical";
  row.incidentSeverity = severity;

  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  row.monitors = [monitor];

  // {{incidentLabels}} reads them alphabetically (INCIDENT_LABELS).
  row.labels = incidentLabels();

  return row;
}

function statusPage(): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID.toString();
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  page.pageTitle = "Acme Status";
  page.isPublicStatusPage = true;
  page.showIncidentsOnStatusPage = true;
  page.onlyShowScopedIncidents = false;
  return page;
}

function resource(): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = "88888888-8888-4888-8888-888888888888";
  row.statusPageId = STATUS_PAGE_ID;
  row.displayName = "Checkout API";
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
      "Checkout API",
      "Europe",
    ),
    resourceInGroup(
      "99999999-9999-4999-8999-999999999999",
      "Payments API",
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

/*
 * Every compile the job made, text and email body alike. An email body's
 * SafeHtml values are shown as their HTML, so the variables compare with the
 * other channels'; `emailBody` says which compile it was.
 */
function compileCalls(): Array<RecordedCompile> {
  return recordedCompiles(
    StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate,
    StatusPageSubscriberNotificationTemplateServiceClass.compileEmailBodyTemplate,
  );
}

// The compile the job made of this template, once.
function compileOf(template: string): RecordedCompile {
  const calls: Array<RecordedCompile> = compileCalls().filter(
    (call: RecordedCompile): boolean => {
      return call.template === template;
    },
  );

  expect(calls).toHaveLength(1);
  return calls[0]!;
}

// The variables the job handed to the compile of this template.
function variablesCompiledInto(template: string): Record<string, string> {
  return compileOf(template).variables;
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
  return withUnsubscribeToken(row);
}

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
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
    unsubscribeUrl:
      method === StatusPageSubscriberNotificationMethod.SMS
        ? SMS_UNSUBSCRIBE_URL
        : UNSUBSCRIBE_URL,
    incidentTitle: INCIDENT_TITLE,
    incidentSeverity: "Critical",
    resourcesAffected: "Checkout API",
    incidentDescription: DESCRIPTION,
  };

  return template.replace(/{{\s*(\w+)\s*}}/g, (_match: string, key: string) => {
    return variables[key] ?? "";
  });
}

async function runJob(): Promise<void> {
  expect(mockCapturedJobs[JOB]).toBeDefined();
  await mockCapturedJobs[JOB]!();
}

beforeEach(() => {
  jest.clearAllMocks();

  // No incident custom fields unless a test gives the project some.
  mock(IncidentCustomFieldService.findBy).mockResolvedValue([] as never);
  mock(syncIsPublicForMarkdownImages).mockResolvedValue(undefined as never);

  pendingIncidents = [incident()];
  storedScopes = {};

  /*
   * The job first looks for pending incidents it should skip, then for the
   * ones to notify. Only the second query returns rows.
   */
  mock(IncidentService.findAllBy).mockImplementation(
    async (args: unknown): Promise<Array<Incident>> => {
      const query: JSONObject = (args as { query: JSONObject }).query;

      return query["shouldStatusPageSubscribersBeNotifiedOnIncidentCreated"] ===
        true
        ? pendingIncidents
        : [];
    },
  );
  mock(IncidentService.findBy).mockImplementation(
    incidentScopeFindBy(() => {
      return storedScopes;
    }) as never,
  );
  mock(IncidentService.updateOneById).mockResolvedValue(1 as never);
  // This run wins every claim unless a test says otherwise.
  mock(IncidentService.compareAndSetColumnsByIdWithoutHooks).mockResolvedValue(
    true as never,
  );
  mock(IncidentService.updateColumnsByIdWithoutHooks).mockResolvedValue(
    undefined as never,
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
    fakeGetUnsubscribeLink,
  );
  mock(StatusPageService.getStatusPageURL).mockResolvedValue(
    STATUS_PAGE_URL as never,
  );
  mock(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
  ).mockResolvedValue(null as never);

  mock(Markdown.convertToHTML).mockResolvedValue(DESCRIPTION_HTML as never);
  mock(Markdown.convertToPlainText).mockReturnValue(DESCRIPTION_TEXT);

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

describe("Incident:SendNotificationToSubscribers", () => {
  test("sends the default new-incident messages", async () => {
    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberIncidentCreated,
    );
    expect(sentMail()[0]!["subject"]).toBe(`[Incident] ${INCIDENT_TITLE}`);
    expect(sentMail()[0]!["vars"]).toEqual(
      expect.objectContaining({
        statusPageName: "Acme Status",
        incidentTitle: INCIDENT_TITLE,
        incidentSeverity: "Critical",
        incidentDescription: DESCRIPTION_HTML,
        resourcesAffected: "Checkout API",
        detailsUrl: DETAILS_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
      }),
    );
    expect(sentSms()).toEqual([
      `Incident ${INCIDENT_TITLE} (Critical) on Acme Status. Impact: Checkout API. Details: ${DETAILS_URL}. Unsub: ${SMS_UNSUBSCRIBE_URL}`,
    ]);
    expect(sentSlack()).toHaveLength(1);
    expect(sentSlack()[0]).toContain(`## 🚨 Incident - ${INCIDENT_TITLE}`);
    expect(sentTeams()).toHaveLength(1);
    expect(sentTeams()[0]).toContain(`## 🚨 Incident - ${INCIDENT_TITLE}`);
    expect(sentWebhooks()[0]!["eventType"]).toBe("IncidentCreated");
  });

  /*
   * Which link each message carries: the unsubscribe page's token link on
   * every channel, except an SMS from a public status page, which keeps the
   * manage link - 57 characters shorter, and an SMS is billed by the segment
   * (StatusPageSubscriberUnsubscribe.buildSmsLink).
   */
  test("a public page: the SMS keeps the manage link, every other channel carries the token link", async () => {
    await runJob();

    expect(sentSms()[0]).toContain(`Unsub: ${SMS_UNSUBSCRIBE_URL}`);
    expect(sentSms()[0]).not.toContain("/unsubscribe/");
    expect(SMS_UNSUBSCRIBE_URL.length).toBe(UNSUBSCRIBE_URL.length - 57);

    expect(sentMail()[0]!["vars"]).toEqual(
      expect.objectContaining({ unsubscribeUrl: UNSUBSCRIBE_URL }),
    );
    expect(sentSlack()[0]).toContain(`[Unsubscribe](${UNSUBSCRIBE_URL})`);
    expect(sentTeams()[0]).toContain(`[Unsubscribe](${UNSUBSCRIBE_URL})`);
    expect(sentWebhooks()[0]!["unsubscribeUrl"]).toBe(UNSUBSCRIBE_URL);
  });

  test("a private page: the SMS carries the token link too, since its manage page needs a signed-in visitor", async () => {
    const privatePage: StatusPage = statusPage();
    privatePage.isPublicStatusPage = false;
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([privatePage] as never);

    await runJob();

    expect(sentSms()).toEqual([
      `Incident ${INCIDENT_TITLE} (Critical) on Acme Status. Impact: Checkout API. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
    ]);
    expect(sentMail()[0]!["vars"]).toEqual(
      expect.objectContaining({ unsubscribeUrl: UNSUBSCRIBE_URL }),
    );
    expect(sentWebhooks()[0]!["unsubscribeUrl"]).toBe(UNSUBSCRIBE_URL);
  });

  test("a private page's custom SMS template gets the token link as {{unsubscribeUrl}}", async () => {
    const privatePage: StatusPage = statusPage();
    privatePage.isPublicStatusPage = false;
    // A custom SMS template is used only with the page's own Twilio.
    (privatePage as unknown as JSONObject)["callSmsConfig"] = { _id: "twilio" };

    mock(
      StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
    ).mockImplementation(async (args: unknown) => {
      return (args as JSONObject)["notificationMethod"] ===
        StatusPageSubscriberNotificationMethod.SMS
        ? { templateBody: "Stop: {{unsubscribeUrl}}" }
        : null;
    });
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([privatePage] as never);

    await runJob();

    expect(sentSms()).toEqual([`Stop: ${UNSUBSCRIBE_URL}`]);
  });

  test("matches the dashboard's incident created defaults", async () => {
    await runJob();

    const event: StatusPageSubscriberNotificationEventType =
      StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated;

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
});

describe("Incident:SendNotificationToSubscribers, with custom templates and grouped resources", () => {
  beforeEach(() => {
    useCustomTemplatesOnEveryChannel();
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
      groupedResources() as never,
    );
  });

  test("renders HTML in the email body, plain text in SMS and the subject, and Markdown in chat", async () => {
    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.BlankTemplate,
    );
    expect(sentMail()[0]!["vars"]).toEqual({
      body: `<div>${DESCRIPTION_HTML}</div><div>${GROUPED_RESOURCES_HTML}</div>`,
    });
    expect(sentMail()[0]!["subject"]).toBe(
      `${INCIDENT_TITLE}: ${DESCRIPTION_TEXT} (${GROUPED_RESOURCES_TEXT})`,
    );
    expect(sentSms()).toEqual([
      `SMS ${DESCRIPTION_TEXT} (${GROUPED_RESOURCES_TEXT})`,
    ]);
    expect(sentSlack()).toEqual([
      `Slack ${DESCRIPTION} (${GROUPED_RESOURCES_TEXT})`,
    ]);
    expect(sentTeams()).toEqual([
      `Teams ${DESCRIPTION} (${GROUPED_RESOURCES_TEXT})`,
    ]);
  });

  test("hands each channel's template the same variables, in that channel's format", async () => {
    await runJob();

    // Only the email body is compiled as HTML.
    expect(compileOf(CUSTOM_EMAIL_BODY).emailBody).toBe(true);
    for (const template of [
      CUSTOM_EMAIL_SUBJECT,
      CUSTOM_SMS_BODY,
      CUSTOM_SLACK_BODY,
      CUSTOM_TEAMS_BODY,
    ]) {
      expect(compileOf(template).emailBody).toBe(false);
    }

    const shared: Record<string, string> = {
      statusPageName: "Acme Status",
      statusPageUrl: STATUS_PAGE_URL,
      detailsUrl: DETAILS_URL,
      unsubscribeUrl: UNSUBSCRIBE_URL,
      incidentSeverity: "Critical",
      incidentTitle: INCIDENT_TITLE,
      // Its labels, alphabetically; it is on this one page.
      incidentLabels: INCIDENT_LABELS,
      affectedStatusPages: "Acme Status",
    };
    const html: Record<string, string> = {
      ...shared,
      incidentDescription: DESCRIPTION_HTML,
      resourcesAffected: GROUPED_RESOURCES_HTML,
    };
    const plainText: Record<string, string> = {
      ...shared,
      incidentDescription: DESCRIPTION_TEXT,
      resourcesAffected: GROUPED_RESOURCES_TEXT,
    };
    const markdown: Record<string, string> = {
      ...shared,
      incidentDescription: DESCRIPTION,
      resourcesAffected: GROUPED_RESOURCES_TEXT,
    };

    expect(variablesCompiledInto(CUSTOM_EMAIL_BODY)).toEqual(html);
    expect(variablesCompiledInto(CUSTOM_EMAIL_SUBJECT)).toEqual(plainText);
    // An SMS from this public page carries the manage link (see smsManageLinkFor).
    expect(variablesCompiledInto(CUSTOM_SMS_BODY)).toEqual({
      ...plainText,
      unsubscribeUrl: SMS_UNSUBSCRIBE_URL,
    });
    expect(variablesCompiledInto(CUSTOM_SLACK_BODY)).toEqual(markdown);
    expect(variablesCompiledInto(CUSTOM_TEAMS_BODY)).toEqual(markdown);
  });

  test("sends webhooks the Markdown description and a plain-text resource list", async () => {
    await runJob();

    expect(sentWebhooks()).toHaveLength(1);
    expect(sentWebhooks()[0]!["data"]).toEqual({
      incidentId: INCIDENT_ID.toString(),
      incidentNumber: "7",
      incidentTitle: INCIDENT_TITLE,
      incidentDescription: DESCRIPTION,
      incidentSeverity: "Critical",
      resourcesAffected: GROUPED_RESOURCES_TEXT,
      detailsUrl: DETAILS_URL,
      // The project has no fields included in subscriber notifications.
      customFields: {},
    });
  });
});

describe("Incident:SendNotificationToSubscribers default email, with grouped resources", () => {
  test("still gets HTML for the description and the resource list", async () => {
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
      groupedResources() as never,
    );

    await runJob();

    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberIncidentCreated,
    );
    expect(sentMail()[0]!["vars"]).toEqual(
      expect.objectContaining({
        incidentDescription: DESCRIPTION_HTML,
        resourcesAffected: GROUPED_RESOURCES_HTML,
      }),
    );
  });
});

interface TemplateSyntaxDescription {
  name: string;
  markdown: string;
  // The plain text the Markdown helper turns it into.
  text: string;
}

/*
 * Descriptions quoting template syntax. The subject is finished text when the
 * worker sends it, so the mail is marked literal: compiling it again read the
 * braces as Handlebars, and the email either failed to render and was never
 * sent or lost the quoted words. Tests/Notification/
 * SubscriberEmailSubjectLiteral.test.ts follows such a subject to SMTP.
 */
const TEMPLATE_SYNTAX_DESCRIPTIONS: Array<TemplateSyntaxDescription> = [
  {
    name: "a bare expression",
    markdown: "Deploy blocked on {{ x }}",
    text: "Deploy blocked on {{ x }}",
  },
  {
    name: "a quoted Helm value",
    markdown: "Helm upgrade failed: `{{ .Values.image.tag }}` was empty",
    text: "Helm upgrade failed: {{ .Values.image.tag }} was empty",
  },
  {
    name: "a lone opening pair of braces",
    markdown: "Config parser stopped at {{ on line 3",
    text: "Config parser stopped at {{ on line 3",
  },
];

describe("Incident:SendNotificationToSubscribers email subjects are sent as written", () => {
  test.each(TEMPLATE_SYNTAX_DESCRIPTIONS)(
    "a description with $name reaches the custom subject as written",
    async ({ markdown, text }: TemplateSyntaxDescription) => {
      const row: Incident = incident();
      row.description = markdown;
      pendingIncidents = [row];
      mock(Markdown.convertToPlainText).mockImplementation(
        (value: unknown): string => {
          return value === markdown ? text : "";
        },
      );
      useCustomTemplatesOnEveryChannel();

      await runJob();

      expect(sentMail()).toHaveLength(1);
      expect(sentMail()[0]!["subject"]).toBe(
        `${INCIDENT_TITLE}: ${text} (Checkout API)`,
      );
      expect(sentMail()[0]!["isSubjectLiteral"]).toBe(true);
    },
  );

  test("a title with template syntax reaches the default subject as written", async () => {
    const row: Incident = incident();
    row.title = "Rollout of {{ .Values.image.tag }} stalled";
    pendingIncidents = [row];

    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["subject"]).toBe(
      "[Incident] Rollout of {{ .Values.image.tag }} stalled",
    );
    expect(sentMail()[0]!["isSubjectLiteral"]).toBe(true);
  });
});

/*
 * An incident declared hidden from status pages. Its 'created' notification
 * used to be marked InProgress and then abandoned; the cron only picks up
 * Pending rows, so it stayed "being sent" forever and publishing the incident
 * later could never send it. It is now settled as Skipped with a reason,
 * which is what lets publishing re-queue it (see IncidentCreatedRenotify).
 */
describe("Incident:SendNotificationToSubscribers, for an incident hidden from status pages", () => {
  const SECOND_INCIDENT_ID: ObjectID = new ObjectID(
    "44444444-4444-4444-8444-444444444444",
  );

  function hiddenIncident(): Incident {
    const row: Incident = incident();
    row.isVisibleOnStatusPage = false;
    return row;
  }

  function statusWritesFor(incidentId: ObjectID): Array<JSONObject> {
    return mock(IncidentService.updateOneById)
      .mock.calls.filter((call: Array<unknown>): boolean => {
        return (
          (call[0] as { id: ObjectID }).id.toString() === incidentId.toString()
        );
      })
      .map((call: Array<unknown>): JSONObject => {
        return (call[0] as { data: JSONObject }).data;
      });
  }

  /*
   * The status each write set, the claim to InProgress included, leaving out
   * the notified-pages record writes.
   */
  function statusesWritten(incidentId: ObjectID): Array<unknown> {
    return statusesInOrder({
      claim: IncidentService.compareAndSetColumnsByIdWithoutHooks,
      update: IncidentService.updateOneById,
      statusColumn: "subscriberNotificationStatusOnIncidentCreated",
      id: incidentId,
    });
  }

  test("marks the 'created' notification Skipped with the reason, and never InProgress", async () => {
    pendingIncidents = [hiddenIncident()];

    await runJob();

    expect(statusWritesFor(INCIDENT_ID)).toEqual([
      {
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessage:
          IncidentCreatedRenotify.hiddenFromStatusPagesMessage,
      },
    ]);
    expect(statusesWritten(INCIDENT_ID)).not.toContain(
      StatusPageSubscriberNotificationStatus.InProgress,
    );
  });

  test("writes the status as root without hooks, like the job's other writes", async () => {
    pendingIncidents = [hiddenIncident()];

    await runJob();

    expect(
      (mock(IncidentService.updateOneById).mock.calls[0]![0] as JSONObject)[
        "props"
      ],
    ).toEqual({ isRoot: true, ignoreHooks: true });
  });

  test("the skip reads as 'hidden from status pages' on the dashboard", async () => {
    pendingIncidents = [hiddenIncident()];

    await runJob();

    const written: JSONObject = statusWritesFor(INCIDENT_ID)[0]!;

    expect(
      IncidentCreatedRenotify.isHiddenFromStatusPagesSkip({
        status: written[
          "subscriberNotificationStatusOnIncidentCreated"
        ] as StatusPageSubscriberNotificationStatus,
        message: written["subscriberNotificationStatusMessage"] as string,
      }),
    ).toBe(true);
  });

  test("sends nothing, looks up no status pages and writes no feed item", async () => {
    pendingIncidents = [hiddenIncident()];

    await runJob();

    expect(sentMail()).toHaveLength(0);
    expect(sentSms()).toHaveLength(0);
    expect(sentSlack()).toHaveLength(0);
    expect(sentTeams()).toHaveLength(0);
    expect(sentWebhooks()).toHaveLength(0);
    expect(StatusPageResourceService.findByMonitors).not.toHaveBeenCalled();
    expect(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).not.toHaveBeenCalled();
    expect(IncidentFeedService.createIncidentFeedItem).not.toHaveBeenCalled();
  });

  test("treats an incident with no stored visibility as hidden", async () => {
    const row: Incident = incident();
    row.isVisibleOnStatusPage = null as unknown as boolean;
    pendingIncidents = [row];

    await runJob();

    expect(statusesWritten(INCIDENT_ID)).toEqual([
      StatusPageSubscriberNotificationStatus.Skipped,
    ]);
    expect(sentMail()).toHaveLength(0);
  });

  test("a hidden incident without monitors is skipped for having no monitors", async () => {
    const row: Incident = hiddenIncident();
    row.monitors = [];
    pendingIncidents = [row];

    await runJob();

    expect(statusWritesFor(INCIDENT_ID)).toEqual([
      {
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessage:
          "No monitors are attached to this incident. Skipping notifications to subscribers.",
      },
    ]);
  });

  test("still notifies for the visible incidents in the same run", async () => {
    const visible: Incident = incident();
    visible._id = SECOND_INCIDENT_ID.toString();
    pendingIncidents = [hiddenIncident(), visible];

    await runJob();

    expect(statusesWritten(INCIDENT_ID)).toEqual([
      StatusPageSubscriberNotificationStatus.Skipped,
    ]);
    expect(statusesWritten(SECOND_INCIDENT_ID)).toEqual([
      StatusPageSubscriberNotificationStatus.InProgress,
      StatusPageSubscriberNotificationStatus.Success,
    ]);
    expect(sentMail()).toHaveLength(1);
  });

  test("once published and re-queued, the same incident is announced", async () => {
    // First run: hidden, so skipped.
    pendingIncidents = [hiddenIncident()];
    await runJob();
    expect(sentMail()).toHaveLength(0);

    // Publishing with the box ticked puts it back to Pending; now it is visible.
    jest.clearAllMocks();
    mock(IncidentService.updateOneById).mockResolvedValue(1 as never);
    pendingIncidents = [incident()];
    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberIncidentCreated,
    );
    expect(statusesWritten(INCIDENT_ID)).toEqual([
      StatusPageSubscriberNotificationStatus.InProgress,
      StatusPageSubscriberNotificationStatus.Success,
    ]);
  });
});

/*
 * An incident limited to some status pages (Incident.statusPages). Ten site
 * pages all list the incident's monitor; the scope decides which of them are
 * told, and the incident's record of pages already told
 * (statusPagesNotifiedOnCreation) keeps a page added later from telling the
 * others again.
 */
describe("Incident:SendNotificationToSubscribers, with a status page scope", () => {
  let pages: Array<StatusPage> = [];
  let subscribers: Array<StatusPageSubscriber> = [];

  function everySiteHasOneEmailSubscriber(): void {
    subscribers = allSites().map((site: number): StatusPageSubscriber => {
      return siteSubscriber({ site: site, email: `site${site}@acme.com` });
    });
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

  function feedItems(): Array<JSONObject> {
    return mock(IncidentFeedService.createIncidentFeedItem).mock.calls.map(
      (call: Array<unknown>): JSONObject => {
        return call[0] as JSONObject;
      },
    );
  }

  // Every record of notified pages the job wrote, in order.
  function notifiedPageRecords(): Array<Array<number>> {
    return mock(IncidentService.updateOneById)
      .mock.calls.map((call: Array<unknown>): JSONObject => {
        return (call[0] as { data: JSONObject }).data;
      })
      .filter((data: JSONObject): boolean => {
        return "statusPagesNotifiedOnCreation" in data;
      })
      .map((data: JSONObject): Array<number> => {
        return (data["statusPagesNotifiedOnCreation"] as Array<string>).map(
          siteOf,
        );
      });
  }

  function finalWrite(): JSONObject {
    const writes: Array<JSONObject> = mock(
      IncidentService.updateOneById,
    ).mock.calls.map((call: Array<unknown>): JSONObject => {
      return (call[0] as { data: JSONObject }).data;
    });

    return writes[writes.length - 1]!;
  }

  function scopedIncident(notifiedSites?: Array<number>): Incident {
    const row: Incident = incident();

    if (notifiedSites) {
      row.statusPagesNotifiedOnCreation = notifiedSites.map(
        (site: number): string => {
          return sitePageId(site).toString();
        },
      );
    }

    return row;
  }

  beforeEach(() => {
    pages = allSites().map((site: number): StatusPage => {
      return sitePage(site);
    });
    subscribers = [];

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

    storedScopes = { [INCIDENT_ID.toString()]: scopedTo([7, 3]) };
  });

  test("a monitor shared by ten pages, scoped to two, tells only those two", async () => {
    everySiteHasOneEmailSubscriber();

    await runJob();

    expect(emailsSentTo()).toEqual(["site3@acme.com", "site7@acme.com"]);
    // Only the scoped pages are even looked at, in name order.
    expect(sitesLookedUp()).toEqual([3, 7]);
  });

  test("an unscoped incident reaches none of ten pages that only show scoped incidents", async () => {
    storedScopes = {};
    pages = allSites().map((site: number): StatusPage => {
      return sitePage(site, { onlyShowScopedIncidents: true });
    });
    everySiteHasOneEmailSubscriber();

    await runJob();

    expect(sentMail()).toHaveLength(0);
    expect(sentWebhooks()).toHaveLength(0);
    expect(sitesLookedUp()).toEqual([]);

    expect(feedItems()).toHaveLength(1);
    expect(feedItems()[0]!["displayColor"]).toEqual(Yellow500);
    expect(feedItems()[0]!["feedInfoInMarkdown"]).toContain(
      "No notification sent to subscribers",
    );
    expect(feedItems()[0]!["moreInformationInMarkdown"]).toContain(
      "**Not sent to 10 status pages that only show incidents limited to them:** Site 01, Site 02",
    );

    // Settled, with nothing recorded as told.
    expect(finalWrite()["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Success,
    );
    expect(finalWrite()["statusPagesNotifiedOnCreation"]).toEqual([]);
  });

  test("an unscoped incident still tells pages that show every incident", async () => {
    storedScopes = {};
    pages = allSites().map((site: number): StatusPage => {
      return sitePage(site, { onlyShowScopedIncidents: site !== 5 });
    });
    everySiteHasOneEmailSubscriber();

    await runJob();

    expect(emailsSentTo()).toEqual(["site5@acme.com"]);
  });

  test("someone on both selected pages gets one email and one SMS, but every webhook, Slack and Teams message", async () => {
    subscribers = [3, 7].map((site: number): StatusPageSubscriber => {
      return siteSubscriber({
        site: site,
        email: "Regional.Manager@acme.com",
        phone: "+15555550100",
        webhook: "https://hooks.acme.com/status",
        slack: "https://hooks.slack.com/services/T000/B000/XXXX",
        teams: "https://outlook.office.com/webhook/abc",
      });
    });

    await runJob();

    expect(emailsSentTo()).toEqual(["regional.manager@acme.com"]);
    expect(sentSms()).toHaveLength(1);

    // Per-page payloads are never merged.
    expect(
      sentWebhooks().map((payload: JSONObject): number => {
        return siteOf(payload["statusPageId"]);
      }),
    ).toEqual([3, 7]);
    expect(sentSlack()).toHaveLength(2);
    expect(sentTeams()).toHaveLength(2);
  });

  test("the first page in name order is the one whose email a shared address gets", async () => {
    // Site 07's row comes first; Site 03 still wins, by name.
    subscribers = [7, 3].map((site: number): StatusPageSubscriber => {
      return siteSubscriber({ site: site, email: "shared@acme.com" });
    });

    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect((sentMail()[0]!["vars"] as JSONObject)["statusPageName"]).toBe(
      "Site 03 Status",
    );
    expect(
      (sentMail()[0]!["vars"] as JSONObject)["unsubscribeUrl"],
    ).toBeDefined();
  });

  test("an unscoped incident sends every subscription its email, as before", async () => {
    storedScopes = {};
    subscribers = [3, 7].map((site: number): StatusPageSubscriber => {
      return siteSubscriber({
        site: site,
        email: "shared@acme.com",
        phone: "+15555550100",
      });
    });

    await runJob();

    expect(emailsSentTo()).toEqual(["shared@acme.com", "shared@acme.com"]);
    expect(sentSms()).toHaveLength(2);
  });

  // Every write the job made to the incident, in order.
  function incidentWrites(): Array<JSONObject> {
    return mock(IncidentService.updateOneById).mock.calls.map(
      (call: Array<unknown>): JSONObject => {
        return (call[0] as { data: JSONObject }).data;
      },
    );
  }

  // Lets the job's fire-and-forget Failed write land.
  async function flushPromises(): Promise<void> {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }

  test("writes the record once, with the status the send settles on", async () => {
    everySiteHasOneEmailSubscriber();

    await runJob();

    expect(notifiedPageRecords()).toEqual([[3, 7]]);
    expect(finalWrite()).toEqual(
      expect.objectContaining({
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Success,
      }),
    );
    // The record is written as root, around the hooks, like every job write.
    for (const call of mock(IncidentService.updateOneById).mock.calls) {
      expect((call[0] as JSONObject)["props"]).toEqual({
        isRoot: true,
        ignoreHooks: true,
      });
    }
  });

  test.each([
    ["scoped to two of ten pages", scopedTo([3, 7])],
    ["reaching all ten pages", undefined],
  ])(
    "writes the incident once per send through its service, %s: every such write fires its update workflows, realtime events and audit log",
    async (_label: string, scope: StoredIncidentScope | undefined) => {
      storedScopes = scope ? { [INCIDENT_ID.toString()]: scope } : {};
      everySiteHasOneEmailSubscriber();

      await runJob();

      expect(
        incidentWrites().map((data: JSONObject): unknown => {
          return data["subscriberNotificationStatusOnIncidentCreated"];
        }),
      ).toEqual([StatusPageSubscriberNotificationStatus.Success]);

      /*
       * The claim to InProgress and the pages told so far are hook-free
       * writes, which fire none of them.
       */
      expect(
        statusesInOrder({
          claim: IncidentService.compareAndSetColumnsByIdWithoutHooks,
          update: IncidentService.updateOneById,
          statusColumn: "subscriberNotificationStatusOnIncidentCreated",
        }),
      ).toEqual([
        StatusPageSubscriberNotificationStatus.InProgress,
        StatusPageSubscriberNotificationStatus.Success,
      ]);
    },
  );

  test("a send that fails part-way records the pages it told, so Retry resumes after them", async () => {
    everySiteHasOneEmailSubscriber();
    mock(IncidentFeedService.createIncidentFeedItem).mockRejectedValue(
      new Error("feed unavailable") as never,
    );

    await runJob();
    await flushPromises();

    expect(emailsSentTo()).toEqual(["site3@acme.com", "site7@acme.com"]);
    expect(finalWrite()).toEqual({
      subscriberNotificationStatusOnIncidentCreated:
        StatusPageSubscriberNotificationStatus.Failed,
      subscriberNotificationStatusMessage: "feed unavailable",
      statusPagesNotifiedOnCreation: [
        sitePageId(3).toString(),
        sitePageId(7).toString(),
      ],
    });
  });

  test("a failed send keeps the pages told before it in the record", async () => {
    everySiteHasOneEmailSubscriber();
    mock(IncidentFeedService.createIncidentFeedItem).mockRejectedValue(
      new Error("feed unavailable") as never,
    );
    pendingIncidents = [scopedIncident([5])];

    await runJob();
    await flushPromises();

    expect(notifiedPageRecords().pop()).toEqual([5, 3, 7]);
  });

  test("a send that fails before it read the record leaves the record alone", async () => {
    everySiteHasOneEmailSubscriber();
    mock(StatusPageResourceService.findByMonitors).mockRejectedValue(
      new Error("database went away") as never,
    );
    pendingIncidents = [scopedIncident([5])];

    await runJob();
    await flushPromises();

    expect(finalWrite()).toEqual({
      subscriberNotificationStatusOnIncidentCreated:
        StatusPageSubscriberNotificationStatus.Failed,
      subscriberNotificationStatusMessage: "database went away",
    });
  });

  describe("pages added while the notification is being sent", () => {
    /*
     * The scope as the job reads it: the first read (before the send) and
     * every read after it can differ, as when an editor adds a page while
     * the send runs.
     */
    function scopeChangesDuringTheSend(
      before: StoredIncidentScope,
      after: StoredIncidentScope,
    ): void {
      let reads: number = 0;

      mock(IncidentService.findBy).mockImplementation(((args: unknown) => {
        reads++;
        const scope: StoredIncidentScope = reads === 1 ? before : after;

        return incidentScopeFindBy(() => {
          return { [INCIDENT_ID.toString()]: scope };
        })(args);
      }) as never);
    }

    test("queues itself again once it has settled, for the added pages only", async () => {
      everySiteHasOneEmailSubscriber();
      scopeChangesDuringTheSend(scopedTo([3, 7]), scopedTo([3, 7, 9]));

      await runJob();

      // This run told the pages it read.
      expect(emailsSentTo()).toEqual(["site3@acme.com", "site7@acme.com"]);

      const writes: Array<JSONObject> = incidentWrites();

      expect(writes).toHaveLength(2);
      expect(writes[0]).toEqual(
        expect.objectContaining({
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Success,
        }),
      );
      expect(notifiedPageRecords()).toEqual([[3, 7]]);
      // Settled first, then queued again: the next run reads the new scope.
      expect(writes[1]).toEqual({
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Pending,
        subscriberNotificationStatusMessage:
          IncidentScopeAddedPagesNotification.addedWhileSendingMessage,
      });

      // The next run tells Site 09, and nobody twice.
      jest.clearAllMocks();
      mock(IncidentService.updateOneById).mockResolvedValue(1 as never);
      storedScopes = { [INCIDENT_ID.toString()]: scopedTo([3, 7, 9]) };
      mock(IncidentService.findBy).mockImplementation(
        incidentScopeFindBy(() => {
          return storedScopes;
        }) as never,
      );
      pendingIncidents = [scopedIncident([3, 7])];

      await runJob();

      expect(emailsSentTo()).toEqual(["site9@acme.com"]);
      expect(
        finalWrite()["subscriberNotificationStatusOnIncidentCreated"],
      ).toBe(StatusPageSubscriberNotificationStatus.Success);
    });

    test("an unchanged scope settles as Success and stays there", async () => {
      everySiteHasOneEmailSubscriber();

      await runJob();

      expect(
        incidentWrites().some((data: JSONObject): boolean => {
          return (
            data["subscriberNotificationStatusMessage"] ===
            IncidentScopeAddedPagesNotification.addedWhileSendingMessage
          );
        }),
      ).toBe(false);
    });

    test("a page removed during the send queues nothing", async () => {
      everySiteHasOneEmailSubscriber();
      scopeChangesDuringTheSend(scopedTo([3, 7]), scopedTo([3]));

      await runJob();

      // Only the settled status: nothing queued it again.
      expect(incidentWrites()).toHaveLength(1);
    });

    test("a page added during the send that does not show incidents queues nothing", async () => {
      everySiteHasOneEmailSubscriber();
      pages[8] = sitePage(9, { showIncidentsOnStatusPage: false });
      scopeChangesDuringTheSend(scopedTo([3, 7]), scopedTo([3, 7, 9]));

      await runJob();

      // Only the settled status: nothing queued it again.
      expect(incidentWrites()).toHaveLength(1);
    });

    test("a page this send skipped does not queue it again", async () => {
      // Site 07 hides incidents: visited, never recorded, never re-queued.
      everySiteHasOneEmailSubscriber();
      pages[6] = sitePage(7, { showIncidentsOnStatusPage: false });

      await runJob();

      // Only the settled status: nothing queued it again.
      expect(incidentWrites()).toHaveLength(1);
    });

    test("a failure checking the scope again leaves the send settled as Success", async () => {
      everySiteHasOneEmailSubscriber();
      let reads: number = 0;
      mock(IncidentService.findBy).mockImplementation(((args: unknown) => {
        reads++;

        if (reads > 1) {
          return Promise.reject(new Error("connection lost"));
        }

        return incidentScopeFindBy(() => {
          return storedScopes;
        })(args);
      }) as never);

      await runJob();
      await flushPromises();

      expect(
        finalWrite()["subscriberNotificationStatusOnIncidentCreated"],
      ).toBe(StatusPageSubscriberNotificationStatus.Success);
    });
  });

  test("an incident announced to nobody, then given pages, tells only the pages added", async () => {
    /*
     * Published without announcing it, then Site 03 added with the box
     * ticked: IncidentService wrote the pages it was limited to (Site 01 and
     * Site 02) in as the record, so only Site 03 hears about it.
     */
    everySiteHasOneEmailSubscriber();
    storedScopes = { [INCIDENT_ID.toString()]: scopedTo([1, 2, 3]) };
    pendingIncidents = [scopedIncident([1, 2])];

    await runJob();

    expect(emailsSentTo()).toEqual(["site3@acme.com"]);
    expect(notifiedPageRecords().pop()).toEqual([1, 2, 3]);
  });

  test("pages added to the scope later are told once, and the others are not told again", async () => {
    everySiteHasOneEmailSubscriber();

    // First send: scoped to Site 03 and Site 07.
    pendingIncidents = [scopedIncident()];
    await runJob();
    expect(emailsSentTo()).toEqual(["site3@acme.com", "site7@acme.com"]);
    const told: Array<number> = notifiedPageRecords().pop()!;
    expect(told).toEqual([3, 7]);

    // Site 09 is added and the notification queued again.
    jest.clearAllMocks();
    mock(IncidentService.updateOneById).mockResolvedValue(1 as never);
    storedScopes = { [INCIDENT_ID.toString()]: scopedTo([3, 7, 9]) };
    pendingIncidents = [scopedIncident(told)];
    await runJob();

    expect(emailsSentTo()).toEqual(["site9@acme.com"]);
    expect(notifiedPageRecords().pop()).toEqual([3, 7, 9]);

    // Queued once more with nothing added: nobody is told again.
    jest.clearAllMocks();
    mock(IncidentService.updateOneById).mockResolvedValue(1 as never);
    pendingIncidents = [scopedIncident([3, 7, 9])];
    await runJob();

    expect(sentMail()).toHaveLength(0);
    expect(feedItems()[0]!["displayColor"]).toEqual(Yellow500);
    expect(feedItems()[0]!["moreInformationInMarkdown"]).toContain(
      "- **Site 09**: not sent again, its subscribers were already sent this notification.",
    );
  });

  test("a page removed from the scope stays recorded, so adding it back does not tell it twice", async () => {
    everySiteHasOneEmailSubscriber();
    // Site 05 was told, then removed; it is not in the scope now.
    pendingIncidents = [scopedIncident([5])];

    await runJob();

    expect(emailsSentTo()).toEqual(["site3@acme.com", "site7@acme.com"]);
    expect(notifiedPageRecords().pop()).toEqual([5, 3, 7]);
  });

  test("a page that hides incidents is not recorded as told", async () => {
    everySiteHasOneEmailSubscriber();
    pages[6] = sitePage(7, { showIncidentsOnStatusPage: false });

    await runJob();

    expect(emailsSentTo()).toEqual(["site3@acme.com"]);
    expect(notifiedPageRecords().pop()).toEqual([3]);
    expect(feedItems()[0]!["moreInformationInMarkdown"]).toContain(
      "- **Site 07**: not sent, this status page does not show incidents.",
    );
  });

  test("a page whose send fails is not recorded, so a later send still reaches it", async () => {
    everySiteHasOneEmailSubscriber();
    mock(
      StatusPageSubscriberService.getSubscribersByStatusPage,
    ).mockImplementation(async (statusPageId: unknown) => {
      if (siteOf(statusPageId) === 3) {
        throw new Error("database went away");
      }

      return subscribersByPageFake(() => {
        return subscribers;
      })(statusPageId);
    });

    await runJob();

    expect(emailsSentTo()).toEqual(["site7@acme.com"]);
    expect(notifiedPageRecords().pop()).toEqual([7]);
    expect(feedItems()[0]!["moreInformationInMarkdown"]).toContain(
      "- **Site 03**: nothing sent. Sending to this status page failed part-way",
    );
  });

  test("the feed item lists each page, the subject used and what was sent", async () => {
    subscribers = [
      siteSubscriber({ site: 3, index: 1, email: "a@acme.com" }),
      siteSubscriber({ site: 3, index: 2, email: "b@acme.com" }),
      siteSubscriber({ site: 7, index: 1, email: "a@acme.com" }),
      siteSubscriber({
        site: 7,
        index: 2,
        email: "c@acme.com",
        webhook: "https://hooks.acme.com/site7",
      }),
    ];

    await runJob();

    expect(feedItems()).toHaveLength(1);
    expect(feedItems()[0]!["displayColor"]).toEqual(Blue500);
    expect(feedItems()[0]!["moreInformationInMarkdown"]).toBe(
      [
        "**Status pages:**",
        "",
        `- **Site 03**: 2 email sent. Subject: "\\[Incident\\] ${INCIDENT_TITLE}".`,
        `- **Site 07**: 1 email, 1 webhook sent. Not sent again to 1 email address already sent it through another status page. Subject: "\\[Incident\\] ${INCIDENT_TITLE}".`,
        "",
        "Email and SMS were sent once per address across these status pages, because this is limited to specific status pages. Someone subscribed on more than one of them got the message of the first page in this list.",
        "",
        "**Not sent to 8 status pages outside the status pages this is limited to:** Site 01, Site 02, Site 04, Site 05, Site 06, Site 08, Site 09, Site 10.",
      ].join("\n"),
    );
  });

  test("the feed item for an unscoped incident lists the pages without the dedupe note", async () => {
    storedScopes = {};
    pages = [sitePage(1), sitePage(2)];
    subscribers = [
      siteSubscriber({ site: 1, email: "a@acme.com" }),
      siteSubscriber({ site: 2, email: "a@acme.com" }),
    ];

    await runJob();

    expect(feedItems()[0]!["moreInformationInMarkdown"]).toBe(
      [
        "**Status pages:**",
        "",
        `- **Site 01**: 1 email sent. Subject: "\\[Incident\\] ${INCIDENT_TITLE}".`,
        `- **Site 02**: 1 email sent. Subject: "\\[Incident\\] ${INCIDENT_TITLE}".`,
      ].join("\n"),
    );
  });

  test("an incident scoped to pages that were all deleted tells nobody", async () => {
    storedScopes = {
      [INCIDENT_ID.toString()]: {
        isScopedToStatusPages: true,
        statusPageIds: [],
      },
    };
    everySiteHasOneEmailSubscriber();

    await runJob();

    expect(sentMail()).toHaveLength(0);
    expect(sitesLookedUp()).toEqual([]);
  });
});

/*
 * Escaping. An incident title, its severity, the status page's name and the
 * names of its resources and groups are plain text a project member typed.
 * In an email they must read as those characters: unescaped, a title such as
 * `<a href="...">Reset your password</a>` is a live link in an email the
 * subscriber trusts. Text channels (a subject, SMS, Slack, Teams, webhooks)
 * show text as written, so they must get no HTML entities at all.
 */
describe("Incident:SendNotificationToSubscribers escapes plain values in email", () => {
  const HOSTILE_SEVERITY: string = "P1 <urgent> & loud";

  const ESCAPING_EMAIL_BODY: string =
    '<h1>{{incidentTitle}}</h1><p>{{statusPageName}} / {{incidentSeverity}}</p><div>{{resourcesAffected}}</div><div>{{incidentDescription}}</div><a href="{{detailsUrl}}">Details</a> <a href="{{unsubscribeUrl}}">Unsubscribe</a>';
  const ESCAPING_TEXT: string =
    "{{incidentTitle}} on {{statusPageName}} ({{incidentSeverity}}): {{resourcesAffected}}";

  function hostileIncident(): Incident {
    const row: Incident = incident();
    row.title = HOSTILE_TITLE;
    row.incidentSeverity!.name = HOSTILE_SEVERITY;
    return row;
  }

  function hostilePage(withCustomProviders: boolean): StatusPage {
    const page: StatusPage = statusPage();
    page.pageTitle = HOSTILE_PAGE_NAME;
    if (withCustomProviders) {
      (page as unknown as JSONObject)["smtpConfig"] = { _id: "smtp" };
      (page as unknown as JSONObject)["callSmsConfig"] = { _id: "twilio" };
    }
    return page;
  }

  beforeEach(() => {
    pendingIncidents = [hostileIncident()];
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
      hostileResources(STATUS_PAGE_ID) as never,
    );
  });

  describe("with custom templates", () => {
    beforeEach(() => {
      mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mockResolvedValue([hostilePage(true)] as never);
      mock(
        StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
      ).mockImplementation(async (args: unknown) => {
        const method: string = (args as JSONObject)[
          "notificationMethod"
        ] as string;
        return {
          templateBody:
            method === StatusPageSubscriberNotificationMethod.Email
              ? ESCAPING_EMAIL_BODY
              : `${method}: ${ESCAPING_TEXT}`,
          emailSubject:
            method === StatusPageSubscriberNotificationMethod.Email
              ? ESCAPING_TEXT
              : undefined,
        };
      });
    });

    test("the email body escapes the title, the severity, the page name and every resource and group name", async () => {
      await runJob();

      expect(sentMail()).toHaveLength(1);
      const body: string = (sentMail()[0]!["vars"] as JSONObject)[
        "body"
      ] as string;

      expect(body).toBe(
        `<h1>${HOSTILE_TITLE_HTML}</h1><p>${HOSTILE_PAGE_NAME_HTML} / P1 &lt;urgent&gt; &amp; loud</p><div>${HOSTILE_RESOURCES_HTML}</div><div>${DESCRIPTION_HTML}</div><a href="${DETAILS_URL}">Details</a> <a href="${UNSUBSCRIBE_URL}">Unsubscribe</a>`,
      );
      expect(body).not.toContain("<script");
      expect(body).not.toContain('<a href="https://evil.example');
      expect(body).not.toContain("<img");
    });

    test("only the description and the resource list reach the email body as HTML", async () => {
      await runJob();

      expectOnlyTheListedHtmlVariables(
        compileOf(ESCAPING_EMAIL_BODY).rawVariables,
        StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated,
      );
    });

    test("the subject, SMS, Slack and Teams get every value as written", async () => {
      await runJob();

      const text: string = `${HOSTILE_TITLE} on ${HOSTILE_PAGE_NAME} (${HOSTILE_SEVERITY}): ${HOSTILE_RESOURCES_TEXT}`;

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
    });

    test("webhooks get the title, the page name and the resource list as written", async () => {
      await runJob();

      expect(sentWebhooks()).toHaveLength(1);
      expect(sentWebhooks()[0]!["statusPageName"]).toBe(HOSTILE_PAGE_NAME);
      expect(sentWebhooks()[0]!["data"]).toEqual(
        expect.objectContaining({
          incidentTitle: HOSTILE_TITLE,
          incidentSeverity: HOSTILE_SEVERITY,
          resourcesAffected: HOSTILE_RESOURCES_TEXT,
        }),
      );
    });
  });

  describe("with the default templates", () => {
    beforeEach(() => {
      mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mockResolvedValue([hostilePage(false)] as never);
    });

    /*
     * The default template escapes the title, severity and page name itself
     * (DetailBoxField plainText=); the resource list goes in its raw-HTML
     * slot, so the job hands it over with every name already escaped.
     */
    test("the email gets the resource list with every name escaped, and the plain values as written for the template to escape", async () => {
      await runJob();

      expect(sentMail()[0]!["templateType"]).toBe(
        EmailTemplateType.SubscriberIncidentCreated,
      );
      expect(sentMail()[0]!["vars"]).toEqual(
        expect.objectContaining({
          resourcesAffected: HOSTILE_RESOURCES_HTML,
          incidentTitle: HOSTILE_TITLE,
          incidentSeverity: HOSTILE_SEVERITY,
          statusPageName: HOSTILE_PAGE_NAME,
          incidentDescription: DESCRIPTION_HTML,
        }),
      );
      expect(sentMail()[0]!["subject"]).toBe(`[Incident] ${HOSTILE_TITLE}`);
    });

    test("SMS, Slack and Teams list the resources as written, never as HTML", async () => {
      await runJob();

      expect(sentSms()).toEqual([
        `Incident ${HOSTILE_TITLE} (${HOSTILE_SEVERITY}) on ${HOSTILE_PAGE_NAME}. Impact: ${HOSTILE_RESOURCES_TEXT}. Details: ${DETAILS_URL}. Unsub: ${SMS_UNSUBSCRIBE_URL}`,
      ]);
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
});

describe("Incident unsubscribe links", () => {
  test("every message links to the subscriber's own unsubscribe page, token included", async () => {
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
 * Incident custom fields. The project has four; three are marked "Include in
 * Subscriber Notifications" (see IncidentCustomFieldFixtures). Those reach
 * the default email, Slack, Teams and webhook messages, in their order; the
 * default SMS stays as it was. Every field is offered to custom templates as
 * {{customFields.<key>}}, escaped in an email body and as written elsewhere.
 * The feed item records the values that went out.
 */
describe("Incident:SendNotificationToSubscribers with incident custom fields", () => {
  function feedItem(): JSONObject {
    const items: Array<JSONObject> = mock(
      IncidentFeedService.createIncidentFeedItem,
    ).mock.calls.map((call: Array<unknown>): JSONObject => {
      return call[0] as JSONObject;
    });

    expect(items).toHaveLength(1);
    return items[0]!;
  }

  beforeEach(() => {
    mock(IncidentCustomFieldService.findBy).mockResolvedValue(
      CUSTOM_FIELD_DEFINITIONS as never,
    );

    const row: Incident = incident();
    row.customFields = CUSTOM_FIELD_VALUES;
    pendingIncidents = [row];

    mock(Markdown.convertToHTML).mockImplementation((async (
      markdown: unknown,
    ): Promise<string> => {
      return renderImpactDetails(() => {
        return DESCRIPTION_HTML;
      })(markdown);
    }) as never);
    mock(Markdown.convertToPlainText).mockImplementation(
      plainTextOfImpactDetails(() => {
        return DESCRIPTION_TEXT;
      }) as never,
    );
  });

  test("reads the incident's labels and custom fields, and the fields of its own project", async () => {
    await runJob();

    const notifyQuery: JSONObject = mock(IncidentService.findAllBy)
      .mock.calls.map((call: Array<unknown>): JSONObject => {
        return call[0] as JSONObject;
      })
      .find((args: JSONObject): boolean => {
        return (
          (args["query"] as JSONObject)[
            "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated"
          ] === true
        );
      })!;

    expect(notifyQuery["select"]).toEqual(
      expect.objectContaining({
        labels: { name: true },
        customFields: true,
      }),
    );

    expect(IncidentCustomFieldService.findBy).toHaveBeenCalledTimes(1);
    expect(
      (mock(IncidentCustomFieldService.findBy).mock.calls[0]![0] as JSONObject)[
        "query"
      ],
    ).toEqual({ projectId: PROJECT_ID });
  });

  test("the default email lists the included fields, in their order", async () => {
    await runJob();

    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberIncidentCreated,
    );
    expect((sentMail()[0]!["vars"] as JSONObject)["customFieldRows"]).toEqual(
      EXPECTED_CUSTOM_FIELD_ROWS,
    );
    // The description is still the description.
    expect((sentMail()[0]!["vars"] as JSONObject)["incidentDescription"]).toBe(
      DESCRIPTION_HTML,
    );
  });

  test("the default Slack and Teams messages list them after the description", async () => {
    await runJob();

    expect(sentSlack()).toEqual([
      `## 🚨 Incident - ${INCIDENT_TITLE}

**Severity:** Critical

**Resources Affected:** Checkout API

**Description:** ${DESCRIPTION}

**Affected Location:** ${AFFECTED_LOCATION}

**Acknowledgement:** No

**Impact Details:**
${IMPACT_DETAILS}

[View Status Page](${STATUS_PAGE_URL}) | [Unsubscribe](${UNSUBSCRIBE_URL})`,
    ]);
    expect(sentTeams()).toEqual([
      `## 🚨 Incident - ${INCIDENT_TITLE}
**Severity:** Critical
**Resources Affected:** Checkout API
**Description:** ${DESCRIPTION}
**Affected Location:** ${AFFECTED_LOCATION}
**Acknowledgement:** No
**Impact Details:**
${IMPACT_DETAILS}
[View Status Page](${STATUS_PAGE_URL}) | [Unsubscribe](${UNSUBSCRIBE_URL})`,
    ]);

    // The field left out of subscriber notifications stays out.
    for (const message of [...sentSlack(), ...sentTeams()]) {
      expect(message).not.toContain(INTERNAL_TICKET);
    }
  });

  test("the default SMS stays short and carries no field", async () => {
    await runJob();

    expect(sentSms()).toEqual([
      `Incident ${INCIDENT_TITLE} (Critical) on Acme Status. Impact: Checkout API. Details: ${DETAILS_URL}. Unsub: ${SMS_UNSUBSCRIBE_URL}`,
    ]);
  });

  test("webhooks get the included fields by key, with their values as stored", async () => {
    await runJob();

    expect((sentWebhooks()[0]!["data"] as JSONObject)["customFields"]).toEqual(
      EXPECTED_WEBHOOK_CUSTOM_FIELDS,
    );
  });

  test("the feed item records the values sent", async () => {
    await runJob();

    const moreInformation: string = feedItem()[
      "moreInformationInMarkdown"
    ] as string;

    expect(moreInformation).toBe(
      [
        "**Status pages:**",
        "",
        `- **Acme**: 1 email, 1 SMS, 1 Slack, 1 Microsoft Teams, 1 webhook sent. Subject: "\\[Incident\\] ${INCIDENT_TITLE}".`,
        "",
        EXPECTED_INCLUDED_FIELDS_FEED,
      ].join("\n"),
    );
  });

  test("an included Rich text field's images are made public for the recipients", async () => {
    await runJob();

    expect(syncIsPublicForMarkdownImages).toHaveBeenCalledTimes(1);
    expect(
      mock(syncIsPublicForMarkdownImages).mock.calls[0]!.slice(0, 2),
    ).toEqual([IMPACT_DETAILS, true]);
  });

  /*
   * A Date is stored as the picked day's midnight in the author's time
   * zone: 27 Sep picked in Berlin is 26 Sep 22:00 UTC, and went out as
   * 26 Sep.
   */
  test("a Date picked east of UTC goes out as the day that was picked", async () => {
    mock(IncidentCustomFieldService.findBy).mockResolvedValue([
      {
        name: "Expected Resolution",
        variableKey: "expected_resolution",
        customFieldType: CustomFieldType.Date,
        includeInSubscriberNotifications: true,
        sortOrder: 1,
      },
    ] as never);

    const row: Incident = incident();
    row.customFields = { "Expected Resolution": "2026-09-26T22:00:00.000Z" };
    pendingIncidents = [row];

    await runJob();

    expect((sentMail()[0]!["vars"] as JSONObject)["customFieldRows"]).toEqual([
      { title: "Expected Resolution", plainText: "2026-09-27" },
    ]);
    expect(sentSlack()[0]).toContain("**Expected Resolution:** 2026-09-27");
    expect(sentTeams()[0]).toContain("**Expected Resolution:** 2026-09-27");
    expect(feedItem()["moreInformationInMarkdown"]).toContain(
      "- **Expected Resolution:** 2026\\-09\\-27",
    );
  });

  test("before the first message that carries them is sent", async () => {
    await runJob();

    const publishedAt: number = mock(syncIsPublicForMarkdownImages).mock
      .invocationCallOrder[0]!;

    for (const send of [
      MailService.sendMail,
      SlackUtil.sendMessageToChannelViaIncomingWebhook,
      MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
      StatusPageSubscriberWebhookUtil.sendWebhookNotification,
    ]) {
      expect(publishedAt).toBeLessThan(mock(send).mock.invocationCallOrder[0]!);
    }
  });

  /*
   * The regression: the images used to be made public as soon as the values
   * were built, before any status page or subscriber was looked at.
   */
  test("an incident that reaches no status page makes no image public", async () => {
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([] as never);

    await runJob();

    expect(sentMail()).toEqual([]);
    expect(syncIsPublicForMarkdownImages).not.toHaveBeenCalled();
  });

  test("nor does one whose subscribers are all filtered out", async () => {
    mock(StatusPageSubscriberService.shouldSendNotification).mockReturnValue(
      false,
    );

    await runJob();

    expect(sentMail()).toEqual([]);
    expect(sentWebhooks()).toEqual([]);
    expect(syncIsPublicForMarkdownImages).not.toHaveBeenCalled();
  });

  describe("a Rich text field only a custom email template places", () => {
    const PLACING_TEMPLATE: string =
      "<div>{{customFields.impact_details}}</div>";

    beforeEach(() => {
      mock(IncidentCustomFieldService.findBy).mockResolvedValue(
        CUSTOM_FIELD_DEFINITIONS.map(
          (
            definition: IncidentTemplateCustomFieldDefinition,
          ): IncidentTemplateCustomFieldDefinition => {
            return definition.name === "Impact Details"
              ? { ...definition, includeInSubscriberNotifications: false }
              : definition;
          },
        ) as never,
      );

      mock(
        StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
      ).mockImplementation(async (args: unknown) => {
        return (args as JSONObject)["notificationMethod"] ===
          StatusPageSubscriberNotificationMethod.Email
          ? { templateBody: PLACING_TEMPLATE, emailSubject: "Subject" }
          : null;
      });
    });

    test("stays private on a page without its own SMTP, where the template is not used", async () => {
      await runJob();

      // The default email went out instead, without the field.
      expect(sentMail()[0]!["templateType"]).toBe(
        EmailTemplateType.SubscriberIncidentCreated,
      );
      expect(syncIsPublicForMarkdownImages).not.toHaveBeenCalled();
      expect(feedItem()["moreInformationInMarkdown"]).not.toContain(
        "Impact Details",
      );
    });

    test("is made public, once, where the template is sent", async () => {
      const page: StatusPage = statusPage();
      (page as unknown as JSONObject)["smtpConfig"] = { _id: "smtp" };
      mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mockResolvedValue([page] as never);

      await runJob();

      expect(sentMail()[0]!["templateType"]).toBe(
        EmailTemplateType.BlankTemplate,
      );
      expect(
        mock(syncIsPublicForMarkdownImages).mock.calls.map(
          (call: Array<unknown>): Array<unknown> => {
            return call.slice(0, 2);
          },
        ),
      ).toEqual([[IMPACT_DETAILS, true]]);
      expect(
        mock(syncIsPublicForMarkdownImages).mock.invocationCallOrder[0]!,
      ).toBeLessThan(mock(MailService.sendMail).mock.invocationCallOrder[0]!);
    });
  });

  test("a project with no field marked for subscribers sends what it always did", async () => {
    mock(IncidentCustomFieldService.findBy).mockResolvedValue(
      CUSTOM_FIELD_DEFINITIONS.map(
        (
          definition: IncidentTemplateCustomFieldDefinition,
        ): IncidentTemplateCustomFieldDefinition => {
          return { ...definition, includeInSubscriberNotifications: false };
        },
      ) as never,
    );

    await runJob();

    expect((sentMail()[0]!["vars"] as JSONObject)["customFieldRows"]).toEqual(
      [],
    );
    expect(sentSlack()[0]).toBe(
      dashboardDefault(
        StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated,
        StatusPageSubscriberNotificationMethod.Slack,
      ),
    );
    expect((sentWebhooks()[0]!["data"] as JSONObject)["customFields"]).toEqual(
      {},
    );
    expect(feedItem()["moreInformationInMarkdown"]).not.toContain(
      "Custom fields sent",
    );
    expect(syncIsPublicForMarkdownImages).not.toHaveBeenCalled();
  });

  describe("in custom templates", () => {
    const SUBJECT: string = "Subject {{customFields.affected_location}}";

    beforeEach(() => {
      const page: StatusPage = statusPage();
      (page as unknown as JSONObject)["smtpConfig"] = { _id: "smtp" };
      (page as unknown as JSONObject)["callSmsConfig"] = { _id: "twilio" };
      mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mockResolvedValue([page] as never);

      mock(
        StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
      ).mockImplementation(async (args: unknown) => {
        const method: string = (args as JSONObject)[
          "notificationMethod"
        ] as string;
        return {
          templateBody: `${method}\n${CUSTOM_FIELD_PLACEHOLDERS_TEMPLATE}`,
          emailSubject:
            method === StatusPageSubscriberNotificationMethod.Email
              ? SUBJECT
              : undefined,
        };
      });
    });

    test("every field is placed by its key: escaped in the email body, as written elsewhere", async () => {
      await runJob();

      expect((sentMail()[0]!["vars"] as JSONObject)["body"]).toBe(
        [
          StatusPageSubscriberNotificationMethod.Email,
          `location=[${AFFECTED_LOCATION_HTML}]`,
          "ack=[No]",
          `impact=[${IMPACT_DETAILS_HTML}]`,
          `ticket=[${INTERNAL_TICKET}]`,
        ].join("\n"),
      );
      expect(sentMail()[0]!["subject"]).toBe(`Subject ${AFFECTED_LOCATION}`);
      expect(sentSms()).toEqual([
        [
          StatusPageSubscriberNotificationMethod.SMS,
          `location=[${AFFECTED_LOCATION}]`,
          "ack=[No]",
          `impact=[${IMPACT_DETAILS_TEXT}]`,
          `ticket=[${INTERNAL_TICKET}]`,
        ].join("\n"),
      ]);

      for (const [method, message] of [
        [StatusPageSubscriberNotificationMethod.Slack, sentSlack()[0]],
        [StatusPageSubscriberNotificationMethod.MicrosoftTeams, sentTeams()[0]],
      ] as Array<[string, string]>) {
        expect(message).toBe(
          [
            method,
            `location=[${AFFECTED_LOCATION}]`,
            "ack=[No]",
            `impact=[${IMPACT_DETAILS}]`,
            `ticket=[${INTERNAL_TICKET}]`,
          ].join("\n"),
        );
      }

      for (const message of [
        sentMail()[0]!["subject"] as string,
        ...sentSms(),
        ...sentSlack(),
        ...sentTeams(),
      ]) {
        expectNoHtmlEntities(message);
      }
    });

    test("every compile carries only offered variables, and only listed or custom field HTML reaches the email body", async () => {
      await runJob();

      for (const call of compileCalls()) {
        expectOnlyOfferedVariables(
          StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated,
          call.rawVariables,
        );
      }

      const emailBody: RecordedCompile = compileCalls().find(
        (call: RecordedCompile): boolean => {
          return call.emailBody;
        },
      )!;

      expectOnlyTheListedHtmlVariables(
        emailBody.rawVariables,
        StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated,
      );
      // A plain field is plain text there, for the compile to escape.
      expect(emailBody.rawVariables["customFields.affected_location"]).toBe(
        AFFECTED_LOCATION,
      );
    });

    test("the feed item records every field a template placed, included or not", async () => {
      await runJob();

      expect(feedItem()["moreInformationInMarkdown"]).toContain(
        [
          "**Custom fields sent:**",
          "",
          "- **Affected Location:** \\<b\\>Site 03\\</b\\> & Site 07",
          "- **Acknowledgement:** No",
          "- **Internal Ticket:** OPS\\-4411",
          "",
          "**Impact Details:**",
          "",
          IMPACT_DETAILS,
        ].join("\n"),
      );
    });
  });
});

/*
 * How the created notification sends (SubscriberDeliveryContract): every
 * message awaited and counted, failures of every kind on every channel,
 * every subscriber past LIMIT_MAX, and the send window and the run's latest
 * claim.
 */
describeSubscriberDelivery({
  title: "Incident:SendNotificationToSubscribers",
  jobName: JOB,
  runJob: runJob,
  cronOptions: (): JSONObject | undefined => {
    return mockCapturedOptions[JOB] as JSONObject | undefined;
  },
  pendRows: (count: number): Array<ObjectID> => {
    pendingIncidents = [];

    for (let index: number = 0; index < count; index++) {
      const row: Incident = incident();
      row.version = PENDING_ROW_VERSION;

      if (index > 0) {
        row._id = ObjectID.generate().toString();
      }

      pendingIncidents.push(row);
    }

    return pendingIncidents.map((row: Incident): ObjectID => {
      return row.id!;
    });
  },
  statusColumn: "subscriberNotificationStatusOnIncidentCreated",
  messageColumn: "subscriberNotificationStatusMessage",
  claim: IncidentService.compareAndSetColumnsByIdWithoutHooks,
  update: IncidentService.updateOneById,
  feed: IncidentFeedService.createIncidentFeedItem,
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
  retryScope: SubscriberNotificationRetryScope.PagesNotYetSent,
});

/*
 * A send that reached some status pages in full and fell short on others.
 * The created notification records only the pages sent in full as told
 * (statusPagesNotifiedOnCreation), so Retry sends to the others and nobody
 * on a finished page is sent it twice.
 */
describe("Incident:SendNotificationToSubscribers, when a send falls short", () => {
  let pages: Array<StatusPage> = [];
  let subscribers: Array<StatusPageSubscriber> = [];

  function notifiedPageRecords(): Array<Array<number>> {
    return mock(IncidentService.updateOneById)
      .mock.calls.map((call: Array<unknown>): JSONObject => {
        return (call[0] as { data: JSONObject }).data;
      })
      .filter((data: JSONObject): boolean => {
        return "statusPagesNotifiedOnCreation" in data;
      })
      .map((data: JSONObject): Array<number> => {
        return (data["statusPagesNotifiedOnCreation"] as Array<string>).map(
          siteOf,
        );
      });
  }

  // The pages told so far, as the send wrote them page by page.
  function progressRecords(): Array<Array<number>> {
    return mock(IncidentService.updateColumnsByIdWithoutHooks).mock.calls.map(
      (call: Array<unknown>): Array<number> => {
        return (
          (call[0] as { data: JSONObject }).data[
            "statusPagesNotifiedOnCreation"
          ] as Array<string>
        ).map(siteOf);
      },
    );
  }

  function settledWrite(): JSONObject {
    const writes: Array<JSONObject> = mock(
      IncidentService.updateOneById,
    ).mock.calls.map((call: Array<unknown>): JSONObject => {
      return (call[0] as { data: JSONObject }).data;
    });

    return writes[writes.length - 1]!;
  }

  function emailsSentTo(): Array<string> {
    return sentMail().map((mail: JSONObject): string => {
      return (mail["toEmail"] as Email).toString();
    });
  }

  function feedItems(): Array<JSONObject> {
    return mock(IncidentFeedService.createIncidentFeedItem).mock.calls.map(
      (call: Array<unknown>): JSONObject => {
        return call[0] as JSONObject;
      },
    );
  }

  beforeEach(() => {
    pages = allSites().map((site: number): StatusPage => {
      return sitePage(site);
    });
    // Site 03 and Site 07 each have an email subscriber; Site 07 also a webhook.
    subscribers = [
      siteSubscriber({ site: 3, email: "site3@acme.com" }),
      siteSubscriber({
        site: 7,
        email: "site7@acme.com",
        webhook: "https://hooks.acme.com/site7",
      }),
    ];

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

    storedScopes = { [INCIDENT_ID.toString()]: scopedTo([3, 7]) };
  });

  test("records only the pages sent in full, and settles as Failed with each page's counts", async () => {
    failSends(
      StatusPageSubscriberWebhookUtil.sendWebhookNotification,
      "returned HTTPErrorResponse",
    );

    await runJob();

    expect(emailsSentTo()).toEqual(["site3@acme.com", "site7@acme.com"]);
    expect(notifiedPageRecords()).toEqual([[3]]);
    expect(settledWrite()).toEqual({
      subscriberNotificationStatusOnIncidentCreated:
        StatusPageSubscriberNotificationStatus.Failed,
      subscriberNotificationStatusMessage:
        "Not every subscriber was sent this notification: 1 of 3 messages failed. Site 03: 1 email sent. Site 07: 1 email sent; 1 webhook failed. Retry sends it again only to the status pages that were not sent it in full: Site 07.",
      statusPagesNotifiedOnCreation: [sitePageId(3).toString()],
    });

    expect(feedItems()).toHaveLength(1);
    expect(feedItems()[0]!["displayColor"]).toEqual(Red500);
    expect(feedItems()[0]!["feedInfoInMarkdown"]).toContain(
      "Subscriber Incident Created Notification Failed for some subscribers",
    );
    expect(feedItems()[0]!["moreInformationInMarkdown"]).toContain(
      "- **Site 07**: 1 email sent; 1 webhook failed.",
    );
  });

  test("Retry resumes after the pages sent in full: only the page that fell short is sent it again", async () => {
    failSends(
      StatusPageSubscriberWebhookUtil.sendWebhookNotification,
      "thrown error",
    );

    await runJob();

    const told: Array<number> = notifiedPageRecords().pop()!;
    expect(told).toEqual([3]);

    // Retry: the dashboard puts the row back to Pending; the webhook answers now.
    jest.clearAllMocks();
    mock(IncidentService.updateOneById).mockResolvedValue(1 as never);
    mock(
      StatusPageSubscriberWebhookUtil.sendWebhookNotification,
    ).mockResolvedValue(undefined as never);
    const retried: Incident = incident();
    retried.statusPagesNotifiedOnCreation = told.map((site: number): string => {
      return sitePageId(site).toString();
    });
    pendingIncidents = [retried];

    await runJob();

    // Site 03 is not sent it twice.
    expect(emailsSentTo()).toEqual(["site7@acme.com"]);
    expect(sentWebhooks()).toHaveLength(1);
    expect(notifiedPageRecords().pop()).toEqual([3, 7]);
    expect(
      settledWrite()["subscriberNotificationStatusOnIncidentCreated"],
    ).toBe(StatusPageSubscriberNotificationStatus.Success);
  });

  test("writes the pages told so far as each finishes, without hooks, so an interrupted send keeps them", async () => {
    await runJob();

    expect(progressRecords()).toEqual([[3], [3, 7]]);

    for (const call of mock(IncidentService.updateColumnsByIdWithoutHooks).mock
      .calls) {
      expect((call[0] as { id: ObjectID }).id.toString()).toBe(
        INCIDENT_ID.toString(),
      );
    }
  });

  test("a page that fell short is never written as told, not even part-way", async () => {
    failSends(MailService.sendMail, "thrown HTTPErrorResponse");

    await runJob();

    expect(progressRecords()).toEqual([]);
    expect(notifiedPageRecords()).toEqual([[]]);
  });

  test("a failure writing the progress does not stop the send", async () => {
    mock(IncidentService.updateColumnsByIdWithoutHooks).mockRejectedValue(
      new Error("database hiccup") as never,
    );

    await runJob();

    expect(emailsSentTo()).toEqual(["site3@acme.com", "site7@acme.com"]);
    expect(notifiedPageRecords()).toEqual([[3, 7]]);
    expect(
      settledWrite()["subscriberNotificationStatusOnIncidentCreated"],
    ).toBe(StatusPageSubscriberNotificationStatus.Success);
  });

  test("a send that fell short does not queue itself again for pages added meanwhile: its Retry covers them", async () => {
    failSends(MailService.sendMail, "thrown error");
    let reads: number = 0;
    mock(IncidentService.findBy).mockImplementation(((args: unknown) => {
      reads++;
      const scope: StoredIncidentScope =
        reads === 1 ? scopedTo([3, 7]) : scopedTo([3, 7, 9]);

      return incidentScopeFindBy(() => {
        return { [INCIDENT_ID.toString()]: scope };
      })(args);
    }) as never);

    await runJob();

    expect(
      mock(IncidentService.updateOneById).mock.calls.map(
        (call: Array<unknown>): unknown => {
          return (call[0] as { data: JSONObject }).data[
            "subscriberNotificationStatusOnIncidentCreated"
          ];
        },
      ),
    ).toEqual([StatusPageSubscriberNotificationStatus.Failed]);
  });
});

/*
 * The email is built by SubscriberIncidentEmailBuilder, the code path the
 * notification preview renders with, so what is previewed is what is sent:
 * the job sends exactly the page's email the builder built, addressed to the
 * subscriber with their own unsubscribe link, and records the fields it
 * carries only as it sends it.
 */
describe("Incident:SendNotificationToSubscribers sends the builder's email", () => {
  interface BuiltPage {
    data: Parameters<typeof SubscriberIncidentEmailBuilder.forStatusPage>[0];
    pageEmail: SubscriberIncidentStatusPageEmail;
    recordSending: jest.Mock;
  }

  // Wraps the real builder, recording what it was given and built.
  function spyOnBuilder(): Array<BuiltPage> {
    const built: Array<BuiltPage> = [];
    const forStatusPage: typeof SubscriberIncidentEmailBuilder.forStatusPage =
      SubscriberIncidentEmailBuilder.forStatusPage.bind(
        SubscriberIncidentEmailBuilder,
      );

    jest
      .spyOn(SubscriberIncidentEmailBuilder, "forStatusPage")
      .mockImplementation(async (data: BuiltPage["data"]) => {
        const pageEmail: SubscriberIncidentStatusPageEmail =
          await forStatusPage(data);
        const recordSending: jest.Mock = jest.fn(() => {
          expect(mock(MailService.sendMail)).not.toHaveBeenCalled();
          return pageEmail.recordSending();
        }) as unknown as jest.Mock;

        built.push({
          data: data,
          pageEmail: pageEmail,
          recordSending: recordSending,
        });

        return {
          ...pageEmail,
          recordSending: recordSending as unknown as () => Promise<void>,
        };
      });

    return built;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the default email: built once for the page, sent as built", async () => {
    const built: Array<BuiltPage> = spyOnBuilder();

    await runJob();

    expect(built).toHaveLength(1);
    expect(built[0]!.data.event).toBe(
      SubscriberIncidentEmailEvent.IncidentCreated,
    );
    expect(built[0]!.data.statusPage._id).toBe(STATUS_PAGE_ID.toString());
    expect(built[0]!.data.statusPageUrl).toBe(STATUS_PAGE_URL);
    expect(built[0]!.data.detailsUrl).toBe(DETAILS_URL);

    const expected: SubscriberIncidentEmail = built[0]!.pageEmail.forSubscriber(
      {
        unsubscribeUrl: UNSUBSCRIBE_URL,
      },
    );

    expect(sentMail()).toEqual([
      {
        toEmail: new Email("customer@example.com"),
        ...expected.envelope,
      },
    ]);
    expect(built[0]!.recordSending).toHaveBeenCalledTimes(1);
  });

  test("a custom template: sent as the builder compiled it", async () => {
    useCustomTemplatesOnEveryChannel();
    const built: Array<BuiltPage> = spyOnBuilder();

    await runJob();

    expect(built[0]!.pageEmail.templateChoice.usesCustomTemplate).toBe(true);

    const expected: SubscriberIncidentEmail = built[0]!.pageEmail.forSubscriber(
      {
        unsubscribeUrl: UNSUBSCRIBE_URL,
      },
    );

    expect(expected.envelope.templateType).toBe(
      EmailTemplateType.BlankTemplate,
    );
    expect(sentMail()).toEqual([
      {
        toEmail: new Email("customer@example.com"),
        ...expected.envelope,
      },
    ]);
  });
});
