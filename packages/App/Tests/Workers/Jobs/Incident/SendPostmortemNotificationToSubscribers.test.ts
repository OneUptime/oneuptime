import Incident from "Common/Models/DatabaseModels/Incident";
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

/*
 * Incident postmortem subscriber notifications. These tests drive a tick of
 * the job against fakes and check what subscribers receive on each channel,
 * and in which format each channel gets the postmortem note and the resource
 * list.
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
      // The look again after a skip (requeueIfPublishedSinceRead).
      findOneById: jest.fn(),
      updateOneById: jest.fn(),
      getIncidentLinkInDashboard: jest.fn(),
      // The claim (SubscriberNotificationClaim).
      compareAndSetColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentFeedService", () => {
  return { __esModule: true, default: { createIncidentFeedItem: jest.fn() } };
});

/*
 * The job reaches status pages through IncidentStatusPageScope, which reads
 * resources with findByMonitors - the lookup that also follows monitor
 * groups. findAllBy is kept only to prove the job no longer calls it.
 */
jest.mock("Common/Server/Services/StatusPageResourceService", () => {
  return {
    __esModule: true,
    default: { findByMonitors: jest.fn(), findAllBy: jest.fn() },
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
import { Blue500, Yellow500 } from "Common/Types/BrandColors";
import {
  StoredIncidentScope,
  allSites,
  incidentScopeFindBy,
  scopedTo,
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
import IncidentCustomFieldService from "Common/Server/Services/IncidentCustomFieldService";
import {
  AFFECTED_LOCATION,
  AFFECTED_LOCATION_HTML,
  CUSTOM_FIELD_DEFINITIONS,
  CUSTOM_FIELD_PLACEHOLDERS_CASES,
  CustomFieldPlaceholdersCase,
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
  PENDING_ROW_VERSION,
  describeSubscriberDelivery,
} from "../Fixtures/SubscriberDeliveryContract";
import { statusesInOrder } from "../Fixtures/SubscriberNotificationSendFixtures";
import { SubscriberNotificationRetryScope } from "Common/Server/Utils/StatusPage/SubscriberNotificationDeliveryRecord";
import {
  ResourceFan,
  decideWithTheRealSubscriberPreferences,
  fanEmail,
  lettingSubscribersChooseResources,
  pageShowingTheMonitorThroughAGroup,
  pageShowingTheMonitorTwice,
} from "../Fixtures/MonitorGroupSubscriberFixtures";
import "../../../../FeatureSet/Workers/Jobs/Incident/SendPostmortemNotificationToSubscribers";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const JOB: string = "Incident:SendPostmortemNotificationToSubscribers";

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
const POSTMORTEM: string = "A **bad deploy** broke the checkout flow.";
const POSTMORTEM_HTML: string =
  "<p>A <strong>bad deploy</strong> broke the checkout flow.</p>";
const POSTMORTEM_TEXT: string = "A bad deploy broke the checkout flow.";

const GROUPED_RESOURCES_HTML: string =
  "Europe: Checkout API<br/>Americas: Payments API";
const GROUPED_RESOURCES_TEXT: string =
  "Europe: Checkout API; Americas: Payments API";

/*
 * One custom template per channel. Each echoes the postmortem and the
 * resource list, so the message shows which format that channel was given.
 */
const CUSTOM_EMAIL_BODY: string =
  "<div>{{postmortemNote}}</div><div>{{resourcesAffected}}</div>";
const CUSTOM_EMAIL_SUBJECT: string =
  "{{incidentTitle}}: {{postmortemNote}} ({{resourcesAffected}})";
const CUSTOM_SMS_BODY: string =
  "SMS {{postmortemNote}} ({{resourcesAffected}})";
const CUSTOM_SLACK_BODY: string =
  "Slack {{postmortemNote}} ({{resourcesAffected}})";
const CUSTOM_TEAMS_BODY: string =
  "Teams {{postmortemNote}} ({{resourcesAffected}})";

let pendingIncidents: Array<Incident> = [];
// The status page scope stored for each incident id; unscoped when absent.
let storedScopes: Dictionary<StoredIncidentScope> = {};

/*
 * The job skips an incident unless its postmortem is shown on the status
 * page - switched on, with a note - and subscribers are to be told when it
 * is published.
 */
function incident(): Incident {
  const row: Incident = new Incident();
  row._id = INCIDENT_ID.toString();
  row.title = INCIDENT_TITLE;
  row.description = "Payments fail in Europe.";
  row.projectId = PROJECT_ID;
  row.isVisibleOnStatusPage = true;
  row.showPostmortemOnStatusPage = true;
  row.notifySubscribersOnPostmortemPublished = true;
  row.postmortemNote = POSTMORTEM;
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

// The variables the job handed to compileTemplate for this template.
function variablesCompiledInto(template: string): Record<string, string> {
  // Text and email body compiles (see SubscriberTemplateCompileFixtures).
  const calls: Array<RecordedCompile> = recordedCompiles(
    StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate,
    StatusPageSubscriberNotificationTemplateServiceClass.compileEmailBodyTemplate,
  ).filter((call: RecordedCompile): boolean => {
    return call.template === template;
  });

  expect(calls).toHaveLength(1);
  return calls[0]!.variables;
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
    postmortemNote: POSTMORTEM,
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

  // Only the query for pending postmortem notifications returns rows.
  mock(IncidentService.findAllBy).mockImplementation(
    async (args: unknown): Promise<Array<Incident>> => {
      const query: JSONObject = (args as { query: JSONObject }).query;

      return query["subscriberNotificationStatusOnPostmortemPublished"] ===
        StatusPageSubscriberNotificationStatus.Pending
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
  // Looked at again after a skip: still as the run read it.
  mock(IncidentService.findOneById).mockImplementation(
    async (): Promise<Incident> => {
      return pendingIncidents[0]!;
    },
  );
  // This run wins every claim unless a test says otherwise.
  mock(IncidentService.compareAndSetColumnsByIdWithoutHooks).mockResolvedValue(
    true as never,
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

  mock(Markdown.convertToHTML).mockResolvedValue(POSTMORTEM_HTML as never);
  mock(Markdown.convertToPlainText).mockReturnValue(POSTMORTEM_TEXT);

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

describe("Incident:SendPostmortemNotificationToSubscribers", () => {
  test("sends the default postmortem messages", async () => {
    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberIncidentPostmortemCreated,
    );
    expect(sentMail()[0]!["subject"]).toBe(`[Postmortem] ${INCIDENT_TITLE}`);
    expect(sentMail()[0]!["vars"]).toEqual(
      expect.objectContaining({
        statusPageName: "Acme Status",
        incidentTitle: INCIDENT_TITLE,
        incidentSeverity: "Critical",
        postmortemNote: POSTMORTEM_HTML,
        resourcesAffected: "Checkout API",
        detailsUrl: DETAILS_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
      }),
    );
    expect(sentSms()).toEqual([
      `Postmortem: ${INCIDENT_TITLE} (Critical) on Acme Status. Impact: Checkout API. Details: ${DETAILS_URL}. Unsub: ${SMS_UNSUBSCRIBE_URL}`,
    ]);
    expect(sentSlack()).toHaveLength(1);
    expect(sentSlack()[0]).toContain(
      `## 🚨 Incident Postmortem - ${INCIDENT_TITLE}`,
    );
    expect(sentTeams()).toHaveLength(1);
    expect(sentTeams()[0]).toContain(
      `## 🚨 Incident Postmortem - ${INCIDENT_TITLE}`,
    );
    expect(sentWebhooks()[0]!["eventType"]).toBe("IncidentPostmortemPublished");
  });

  test("matches the dashboard's postmortem published defaults", async () => {
    await runJob();

    const event: StatusPageSubscriberNotificationEventType =
      StatusPageSubscriberNotificationEventType.SubscriberIncidentPostmortemPublished;

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

/*
 * The job decides to skip a postmortem notification - not shown on the
 * status page, not meant to notify, no monitors - from the incident as it
 * read it when the run started, which can be minutes before it gets to it.
 * So it claims the notification first, and settles it as Skipped only when
 * it owns it.
 */
describe("Incident:SendPostmortemNotificationToSubscribers, skipping", () => {
  function postmortemStatuses(): Array<StatusPageSubscriberNotificationStatus> {
    return statusesInOrder({
      claim: IncidentService.compareAndSetColumnsByIdWithoutHooks,
      update: IncidentService.updateOneById,
      statusColumn: "subscriberNotificationStatusOnPostmortemPublished",
    });
  }

  interface SkipCase {
    name: string;
    change: (row: Incident) => void;
    message: string;
  }

  const cases: Array<SkipCase> = [
    {
      name: "a postmortem not shown on the status page",
      change: (row: Incident): void => {
        row.showPostmortemOnStatusPage = false;
      },
      message:
        "Incident is not set to show postmortem on status page. Skipping notifications to subscribers.",
    },
    /*
     * The status page shows a postmortem only with a note, so one switched
     * on without one - or emptied after it was queued, or sent again through
     * the API - announces nothing (IncidentPostmortemPublication).
     */
    {
      name: "a postmortem without a note",
      change: (row: Incident): void => {
        delete row.postmortemNote;
      },
      message:
        "The postmortem has no note, so the status page does not show it. Skipping notifications to subscribers.",
    },
    {
      name: "a postmortem whose note is only whitespace",
      change: (row: Incident): void => {
        row.postmortemNote = "  \n\n  ";
      },
      message:
        "The postmortem has no note, so the status page does not show it. Skipping notifications to subscribers.",
    },
    {
      name: "an incident not set to notify on postmortem published",
      change: (row: Incident): void => {
        row.notifySubscribersOnPostmortemPublished = false;
      },
      message:
        "Incident is not set to notify subscribers on postmortem published. Skipping notifications to subscribers.",
    },
    {
      name: "an incident without monitors",
      change: (row: Incident): void => {
        row.monitors = [];
      },
      message:
        "No monitors are attached to this incident. Skipping notifications to subscribers.",
    },
    /*
     * The status page shows a postmortem only on an incident it shows. The
     * skip says it waits for the incident: showing it sends the postmortem
     * (IncidentPostmortemPublication.isShownByUpdate).
     */
    {
      name: "an incident hidden from status pages",
      change: (row: Incident): void => {
        row.isVisibleOnStatusPage = false;
      },
      message:
        "Incident is hidden from status pages. Subscribers will be sent the postmortem when the incident is made visible on status pages.",
    },
  ];

  test.each(cases)(
    "$name is claimed, then settled as Skipped",
    async (testCase: SkipCase) => {
      const row: Incident = incident();
      testCase.change(row);
      pendingIncidents = [row];

      await runJob();

      expect(sentMail()).toHaveLength(0);
      expect(postmortemStatuses()).toEqual([
        StatusPageSubscriberNotificationStatus.InProgress,
        StatusPageSubscriberNotificationStatus.Skipped,
      ]);
      expect(
        (
          mock(IncidentService.updateOneById).mock.calls[0]![0] as {
            data: JSONObject;
          }
        ).data["subscriberNotificationStatusMessageOnPostmortemPublished"],
      ).toBe(testCase.message);
    },
  );

  /*
   * The run decides from the incident as it read it, before its claim. A
   * postmortem published after that read - while the run held the
   * notification, so the update found it on its way and queued nothing -
   * would be skipped as not shown and never announced. So after a skip for
   * a postmortem the status page does not show, the run looks again, and
   * queues it again when the status page shows it now.
   */
  describe("a postmortem published while the run held its notification", () => {
    const notShownCases: Array<SkipCase> = cases.slice(0, 3);

    function published(): Incident {
      const row: Incident = incident();
      row.showPostmortemOnStatusPage = true;
      row.postmortemNote = POSTMORTEM;
      return row;
    }

    test.each(notShownCases)(
      "$name, published since the run read it, is queued again for the next run",
      async (testCase: SkipCase) => {
        const row: Incident = incident();
        testCase.change(row);
        pendingIncidents = [row];
        mock(IncidentService.findOneById).mockResolvedValue(
          published() as never,
        );

        await runJob();

        expect(sentMail()).toHaveLength(0);
        // Claimed, skipped as read, then queued again - only from that skip.
        expect(postmortemStatuses()).toEqual([
          StatusPageSubscriberNotificationStatus.InProgress,
          StatusPageSubscriberNotificationStatus.Skipped,
          StatusPageSubscriberNotificationStatus.Pending,
        ]);

        const requeue: JSONObject = mock(
          IncidentService.compareAndSetColumnsByIdWithoutHooks,
        ).mock.calls[1]![0] as JSONObject;

        expect(requeue["expectedData"]).toEqual({
          subscriberNotificationStatusOnPostmortemPublished:
            StatusPageSubscriberNotificationStatus.Skipped,
        });
        expect(
          (requeue["data"] as JSONObject)[
            "subscriberNotificationStatusMessageOnPostmortemPublished"
          ],
        ).toBe("Postmortem published. Subscribers will be notified shortly.");
      },
    );

    test.each(notShownCases)(
      "$name, still not shown when the run looks again, stays skipped",
      async (testCase: SkipCase) => {
        const row: Incident = incident();
        testCase.change(row);
        pendingIncidents = [row];

        await runJob();

        expect(postmortemStatuses()).toEqual([
          StatusPageSubscriberNotificationStatus.InProgress,
          StatusPageSubscriberNotificationStatus.Skipped,
        ]);
        expect(IncidentService.findOneById).toHaveBeenCalledTimes(1);
      },
    );

    test("the other skips do not look again: they do not hang on the publish", async () => {
      const row: Incident = incident();
      row.notifySubscribersOnPostmortemPublished = false;
      pendingIncidents = [row];
      mock(IncidentService.findOneById).mockResolvedValue(published() as never);

      await runJob();

      expect(IncidentService.findOneById).not.toHaveBeenCalled();
      expect(postmortemStatuses()).toEqual([
        StatusPageSubscriberNotificationStatus.InProgress,
        StatusPageSubscriberNotificationStatus.Skipped,
      ]);
    });
  });

  /*
   * The run decides from the incident as it read it, before its claim. An
   * update that showed the incident after that read - while the run held the
   * notification, so the update found it on its way - would leave it skipped
   * as waiting for an incident that is shown already. So after a skip for a
   * hidden incident, the run looks again, and queues it again when the
   * incident is shown now and its postmortem published.
   */
  describe("an incident made visible while the run held its notification", () => {
    function hiddenRow(): Incident {
      const row: Incident = incident();
      row.isVisibleOnStatusPage = false;
      return row;
    }

    test("shown since the run read it, it is queued again for the next run, from that skip only", async () => {
      pendingIncidents = [hiddenRow()];
      // Looked at again: shown now, with its postmortem published.
      mock(IncidentService.findOneById).mockResolvedValue(incident() as never);

      await runJob();

      expect(sentMail()).toHaveLength(0);
      expect(postmortemStatuses()).toEqual([
        StatusPageSubscriberNotificationStatus.InProgress,
        StatusPageSubscriberNotificationStatus.Skipped,
        StatusPageSubscriberNotificationStatus.Pending,
      ]);

      const requeue: JSONObject = mock(
        IncidentService.compareAndSetColumnsByIdWithoutHooks,
      ).mock.calls[1]![0] as JSONObject;

      // Only while it is still the skip this run wrote.
      expect(requeue["expectedData"]).toEqual({
        subscriberNotificationStatusOnPostmortemPublished:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessageOnPostmortemPublished:
          "Incident is hidden from status pages. Subscribers will be sent the postmortem when the incident is made visible on status pages.",
      });
      expect(requeue["data"]).toEqual({
        subscriberNotificationStatusOnPostmortemPublished:
          StatusPageSubscriberNotificationStatus.Pending,
        subscriberNotificationStatusMessageOnPostmortemPublished:
          "Incident made visible on status pages. Subscribers will be sent its postmortem shortly.",
      });
    });

    test("looked at again by its id, for its visibility and its postmortem only", async () => {
      pendingIncidents = [hiddenRow()];

      await runJob();

      expect(IncidentService.findOneById).toHaveBeenCalledTimes(1);
      expect(
        (
          mock(IncidentService.findOneById).mock.calls[0]![0] as {
            select: JSONObject;
            props: JSONObject;
          }
        ).select,
      ).toEqual({
        isVisibleOnStatusPage: true,
        showPostmortemOnStatusPage: true,
        postmortemNote: true,
      });
    });

    test("still hidden when the run looks again, it stays skipped, waiting for the incident", async () => {
      pendingIncidents = [hiddenRow()];

      await runJob();

      expect(postmortemStatuses()).toEqual([
        StatusPageSubscriberNotificationStatus.InProgress,
        StatusPageSubscriberNotificationStatus.Skipped,
      ]);
    });

    test("shown since, but with its postmortem taken off the status page, it stays skipped", async () => {
      pendingIncidents = [hiddenRow()];
      const now: Incident = incident();
      now.showPostmortemOnStatusPage = false;
      mock(IncidentService.findOneById).mockResolvedValue(now as never);

      await runJob();

      expect(postmortemStatuses()).toEqual([
        StatusPageSubscriberNotificationStatus.InProgress,
        StatusPageSubscriberNotificationStatus.Skipped,
      ]);
    });

    test("gone by the time the run looks again, it stays skipped", async () => {
      pendingIncidents = [hiddenRow()];
      mock(IncidentService.findOneById).mockResolvedValue(null as never);

      await runJob();

      expect(postmortemStatuses()).toEqual([
        StatusPageSubscriberNotificationStatus.InProgress,
        StatusPageSubscriberNotificationStatus.Skipped,
      ]);
    });
  });

  test.each(cases)(
    "$name is not skipped when it changed since the run read it",
    async (testCase: SkipCase) => {
      const row: Incident = incident();
      testCase.change(row);
      pendingIncidents = [row];
      mock(
        IncidentService.compareAndSetColumnsByIdWithoutHooks,
      ).mockResolvedValue(false as never);

      await runJob();

      expect(IncidentService.updateOneById).not.toHaveBeenCalled();
      expect(sentMail()).toHaveLength(0);
    },
  );
});

describe("Incident:SendPostmortemNotificationToSubscribers, with custom templates and grouped resources", () => {
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
      body: `<div>${POSTMORTEM_HTML}</div><div>${GROUPED_RESOURCES_HTML}</div>`,
    });
    expect(sentMail()[0]!["subject"]).toBe(
      `${INCIDENT_TITLE}: ${POSTMORTEM_TEXT} (${GROUPED_RESOURCES_TEXT})`,
    );
    expect(sentSms()).toEqual([
      `SMS ${POSTMORTEM_TEXT} (${GROUPED_RESOURCES_TEXT})`,
    ]);
    expect(sentSlack()).toEqual([
      `Slack ${POSTMORTEM} (${GROUPED_RESOURCES_TEXT})`,
    ]);
    expect(sentTeams()).toEqual([
      `Teams ${POSTMORTEM} (${GROUPED_RESOURCES_TEXT})`,
    ]);
  });

  test("hands each channel's template the same variables, in that channel's format", async () => {
    await runJob();

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
      postmortemNote: POSTMORTEM_HTML,
      resourcesAffected: GROUPED_RESOURCES_HTML,
    };
    const plainText: Record<string, string> = {
      ...shared,
      postmortemNote: POSTMORTEM_TEXT,
      resourcesAffected: GROUPED_RESOURCES_TEXT,
    };
    const markdown: Record<string, string> = {
      ...shared,
      postmortemNote: POSTMORTEM,
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

  test("sends webhooks the Markdown postmortem and a plain-text resource list", async () => {
    await runJob();

    expect(sentWebhooks()).toHaveLength(1);
    expect(sentWebhooks()[0]!["data"]).toEqual({
      incidentId: INCIDENT_ID.toString(),
      incidentNumber: "7",
      incidentTitle: INCIDENT_TITLE,
      incidentSeverity: "Critical",
      resourcesAffected: GROUPED_RESOURCES_TEXT,
      postmortemNote: POSTMORTEM,
      detailsUrl: DETAILS_URL,
      // The project has no fields included in subscriber notifications.
      customFields: {},
    });
  });
});

describe("Incident:SendPostmortemNotificationToSubscribers default email, with grouped resources", () => {
  test("still gets HTML for the postmortem and the resource list", async () => {
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
      groupedResources() as never,
    );

    await runJob();

    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberIncidentPostmortemCreated,
    );
    expect(sentMail()[0]!["vars"]).toEqual(
      expect.objectContaining({
        postmortemNote: POSTMORTEM_HTML,
        resourcesAffected: GROUPED_RESOURCES_HTML,
      }),
    );
  });
});

interface TemplateSyntaxNote {
  name: string;
  markdown: string;
  // The plain text the Markdown helper turns it into.
  text: string;
}

/*
 * Postmortem notes quoting template syntax. The subject is finished text when
 * the worker sends it, so the mail is marked literal: compiling it again read
 * the braces as Handlebars, and the email either failed to render and was
 * never sent or lost the quoted words. Tests/Notification/
 * SubscriberEmailSubjectLiteral.test.ts follows such a subject to SMTP.
 */
const TEMPLATE_SYNTAX_NOTES: Array<TemplateSyntaxNote> = [
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

describe("Incident:SendPostmortemNotificationToSubscribers email subjects are sent as written", () => {
  test.each(TEMPLATE_SYNTAX_NOTES)(
    "a postmortem note with $name reaches the custom subject as written",
    async ({ markdown, text }: TemplateSyntaxNote) => {
      const row: Incident = incident();
      row.postmortemNote = markdown;
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
      "[Postmortem] Rollout of {{ .Values.image.tag }} stalled",
    );
    expect(sentMail()[0]!["isSubjectLiteral"]).toBe(true);
  });
});

/*
 * An incident limited to some status pages (Incident.statusPages). Ten site
 * pages all list the incident's monitor; the scope decides which of them hear
 * about the postmortem.
 */
describe("Incident:SendPostmortemNotificationToSubscribers, with a status page scope", () => {
  let pages: Array<StatusPage> = [];
  let subscribers: Array<StatusPageSubscriber> = [];

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

    storedScopes = { [INCIDENT_ID.toString()]: scopedTo([7, 3]) };
  });

  test("reaches pages through the monitor lookup that follows monitor groups", async () => {
    await runJob();

    expect(StatusPageResourceService.findByMonitors).toHaveBeenCalledTimes(1);
    expect(StatusPageResourceService.findAllBy).not.toHaveBeenCalled();
  });

  test("a page that lists the monitor only through a monitor group is told", async () => {
    storedScopes = {};
    pages = [sitePage(4)];
    // findByMonitors returns the group's resource like any other.
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue([
      siteResource(4),
    ] as never);

    await runJob();

    expect(emailsSentTo()).toEqual(["site4@acme.com"]);
  });

  test("a monitor shared by ten pages, scoped to two, tells only those two", async () => {
    await runJob();

    expect(emailsSentTo()).toEqual(["site3@acme.com", "site7@acme.com"]);
    expect(
      mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mock.calls.map((call: Array<unknown>): number => {
        return siteOf(call[0]);
      }),
    ).toEqual([3, 7]);
  });

  test("an unscoped incident reaches none of ten pages that only show scoped incidents", async () => {
    storedScopes = {};
    pages = allSites().map((site: number): StatusPage => {
      return sitePage(site, { onlyShowScopedIncidents: true });
    });

    await runJob();

    expect(sentMail()).toHaveLength(0);
    expect(feedItems()).toHaveLength(1);
    // Nothing went out, and the feed no longer claims it did.
    expect(feedItems()[0]!["displayColor"]).toEqual(Yellow500);
    expect(feedItems()[0]!["feedInfoInMarkdown"]).toContain(
      "No postmortem notification sent to subscribers",
    );
    expect(feedItems()[0]!["moreInformationInMarkdown"]).toContain(
      "**Not sent to 10 status pages that only show incidents limited to them:**",
    );
  });

  test("someone on both selected pages gets one email and one SMS, but each page's webhook", async () => {
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

  test("an unscoped incident sends every subscription its email, as before", async () => {
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
      siteSubscriber({ site: 7, index: 1, email: "a@acme.com" }),
      siteSubscriber({ site: 7, index: 2, email: "b@acme.com" }),
    ];

    await runJob();

    expect(feedItems()[0]!["displayColor"]).toEqual(Blue500);
    expect(feedItems()[0]!["moreInformationInMarkdown"]).toBe(
      [
        "**Status pages:**",
        "",
        `- **Site 03**: 1 email sent. Subject: "\\[Postmortem\\] ${INCIDENT_TITLE}".`,
        `- **Site 07**: 1 email sent. Not sent again to 1 email address already sent it through another status page. Subject: "\\[Postmortem\\] ${INCIDENT_TITLE}".`,
        "",
        "Email and SMS were sent once per address across these status pages, because this is limited to specific status pages. Someone subscribed on more than one of them got the message of the first page in this list.",
        "",
        "**Not sent to 8 status pages outside the status pages this is limited to:** Site 01, Site 02, Site 04, Site 05, Site 06, Site 08, Site 09, Site 10.",
      ].join("\n"),
    );
  });
});

/*
 * Escaping. The incident title and severity, the status page's name and the
 * names of its resources and groups are plain text a project member typed.
 * In an email they must read as those characters; the postmortem is
 * Markdown rendered to HTML and stays HTML. Text channels (a subject, SMS,
 * Slack, Teams, webhooks) show text as written, so they must get no HTML
 * entities at all.
 */
describe("Incident:SendPostmortemNotificationToSubscribers escapes plain values in email", () => {
  const HOSTILE_SEVERITY: string = "Sev <1> & 'worst'";

  const ESCAPING_EMAIL_BODY: string =
    '<h1>{{incidentTitle}}</h1><p>{{statusPageName}} / {{incidentSeverity}}</p><div>{{resourcesAffected}}</div><div>{{postmortemNote}}</div><a href="{{detailsUrl}}">Details</a>';
  const ESCAPING_TEXT: string =
    "{{incidentTitle}} on {{statusPageName}} ({{incidentSeverity}}): {{resourcesAffected}}";

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
    const row: Incident = incident();
    row.title = HOSTILE_TITLE;
    row.incidentSeverity!.name = HOSTILE_SEVERITY;
    pendingIncidents = [row];
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
        return method === StatusPageSubscriberNotificationMethod.Email
          ? { templateBody: ESCAPING_EMAIL_BODY, emailSubject: ESCAPING_TEXT }
          : { templateBody: `${method}: ${ESCAPING_TEXT}` };
      });
    });

    test("the email body escapes the plain values and keeps the postmortem and the resource list as HTML", async () => {
      await runJob();

      expect(sentMail()).toHaveLength(1);
      expect((sentMail()[0]!["vars"] as JSONObject)["body"]).toBe(
        `<h1>${HOSTILE_TITLE_HTML}</h1><p>${HOSTILE_PAGE_NAME_HTML} / Sev &lt;1&gt; &amp; &#39;worst&#39;</p><div>${HOSTILE_RESOURCES_HTML}</div><div>${POSTMORTEM_HTML}</div><a href="${DETAILS_URL}">Details</a>`,
      );

      const emailBody: Array<RecordedCompile> = recordedCompiles(
        StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate,
        StatusPageSubscriberNotificationTemplateServiceClass.compileEmailBodyTemplate,
      ).filter((call: RecordedCompile): boolean => {
        return call.emailBody;
      });
      expect(emailBody).toHaveLength(1);
      expectOnlyTheListedHtmlVariables(
        emailBody[0]!.rawVariables,
        StatusPageSubscriberNotificationEventType.SubscriberIncidentPostmortemPublished,
      );
    });

    test("the subject, SMS, Slack, Teams and webhooks get every value as written", async () => {
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

      expect(sentWebhooks()[0]!["statusPageName"]).toBe(HOSTILE_PAGE_NAME);
      expect(sentWebhooks()[0]!["data"]).toEqual(
        expect.objectContaining({
          incidentTitle: HOSTILE_TITLE,
          resourcesAffected: HOSTILE_RESOURCES_TEXT,
        }),
      );
    });
  });

  test("the default email gets the resource list escaped, and the SMS and chat defaults get it as written", async () => {
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([hostilePage(false)] as never);

    await runJob();

    expect(sentMail()[0]!["vars"]).toEqual(
      expect.objectContaining({
        resourcesAffected: HOSTILE_RESOURCES_HTML,
        postmortemNote: POSTMORTEM_HTML,
        incidentTitle: HOSTILE_TITLE,
        statusPageName: HOSTILE_PAGE_NAME,
      }),
    );
    expect(sentSms()).toEqual([
      `Postmortem: ${HOSTILE_TITLE} (${HOSTILE_SEVERITY}) on ${HOSTILE_PAGE_NAME}. Impact: ${HOSTILE_RESOURCES_TEXT}. Details: ${DETAILS_URL}. Unsub: ${SMS_UNSUBSCRIBE_URL}`,
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

describe("Incident postmortem unsubscribe links", () => {
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
 * Incident custom fields in the postmortem notification. The project has
 * four; three are marked "Include in Subscriber Notifications" (see
 * IncidentCustomFieldFixtures). Those reach the default email, Slack, Teams
 * and webhook messages, in their order; the default SMS stays as it was.
 * Every field is offered to custom templates as
 * {{incident.customFields.<key>}} (and the older {{customFields.<key>}}),
 * and the feed item records the values sent.
 */
describe("Incident:SendPostmortemNotificationToSubscribers with incident custom fields", () => {
  const EVENT_TYPE: StatusPageSubscriberNotificationEventType =
    StatusPageSubscriberNotificationEventType.SubscriberIncidentPostmortemPublished;

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
        return POSTMORTEM_HTML;
      })(markdown);
    }) as never);
    mock(Markdown.convertToPlainText).mockImplementation(
      plainTextOfImpactDetails(() => {
        return POSTMORTEM_TEXT;
      }) as never,
    );
  });

  test("reads the incident's labels and custom fields", async () => {
    await runJob();

    expect(
      (mock(IncidentService.findAllBy).mock.calls[0]![0] as JSONObject)[
        "select"
      ],
    ).toEqual(
      expect.objectContaining({
        labels: { name: true },
        customFields: true,
      }),
    );
    expect(
      (mock(IncidentCustomFieldService.findBy).mock.calls[0]![0] as JSONObject)[
        "query"
      ],
    ).toEqual({ projectId: PROJECT_ID });
  });

  test("the default email lists the included fields, in their order", async () => {
    await runJob();

    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberIncidentPostmortemCreated,
    );
    expect((sentMail()[0]!["vars"] as JSONObject)["customFieldRows"]).toEqual(
      EXPECTED_CUSTOM_FIELD_ROWS,
    );
    expect((sentMail()[0]!["vars"] as JSONObject)["postmortemNote"]).toBe(
      POSTMORTEM_HTML,
    );
  });

  test("the default Slack and Teams messages list them after the postmortem", async () => {
    await runJob();

    expect(sentSlack()).toEqual([
      `## 🚨 Incident Postmortem - ${INCIDENT_TITLE}

**Severity:** Critical

**Resources Affected:** Checkout API

**Postmortem:** ${POSTMORTEM}

**Affected Location:** ${AFFECTED_LOCATION}

**Acknowledgement:** No

**Impact Details:**
${IMPACT_DETAILS}

[View Status Page](${STATUS_PAGE_URL}) | [Unsubscribe](${UNSUBSCRIBE_URL})`,
    ]);
    expect(sentTeams()).toEqual([
      `## 🚨 Incident Postmortem - ${INCIDENT_TITLE}
**Severity:** Critical
**Resources Affected:** Checkout API
**Postmortem:** ${POSTMORTEM}
**Affected Location:** ${AFFECTED_LOCATION}
**Acknowledgement:** No
**Impact Details:**
${IMPACT_DETAILS}
[View Status Page](${STATUS_PAGE_URL}) | [Unsubscribe](${UNSUBSCRIBE_URL})`,
    ]);
  });

  test("the default SMS stays short and carries no field", async () => {
    await runJob();

    expect(sentSms()).toEqual([
      `Postmortem: ${INCIDENT_TITLE} (Critical) on Acme Status. Impact: Checkout API. Details: ${DETAILS_URL}. Unsub: ${SMS_UNSUBSCRIBE_URL}`,
    ]);
  });

  test("webhooks get the included fields by key", async () => {
    await runJob();

    expect((sentWebhooks()[0]!["data"] as JSONObject)["customFields"]).toEqual(
      EXPECTED_WEBHOOK_CUSTOM_FIELDS,
    );
  });

  test("the feed item records the values sent, after each page", async () => {
    await runJob();

    const moreInformation: string = feedItem()[
      "moreInformationInMarkdown"
    ] as string;

    expect(moreInformation.startsWith("**Status pages:**")).toBe(true);
    expect(
      moreInformation.endsWith(`\n\n${EXPECTED_INCLUDED_FIELDS_FEED}`),
    ).toBe(true);
  });

  test("an included Rich text field's images are made public", async () => {
    await runJob();

    expect(
      mock(syncIsPublicForMarkdownImages).mock.calls.map(
        (call: Array<unknown>): unknown => {
          return call[0];
        },
      ),
    ).toEqual([IMPACT_DETAILS]);
  });

  test.each(CUSTOM_FIELD_PLACEHOLDERS_CASES)(
    "custom templates written with $written place any field by its key, escaped only in the email body",
    async (placeholders: CustomFieldPlaceholdersCase) => {
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
          templateBody: `${method}\n${placeholders.template}`,
        };
      });

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
      expect(sentSms()).toEqual([
        [
          StatusPageSubscriberNotificationMethod.SMS,
          `location=[${AFFECTED_LOCATION}]`,
          "ack=[No]",
          `impact=[${IMPACT_DETAILS_TEXT}]`,
          `ticket=[${INTERNAL_TICKET}]`,
        ].join("\n"),
      ]);
      expect(sentTeams()[0]).toContain(`impact=[${IMPACT_DETAILS}]`);

      for (const message of [...sentSms(), ...sentSlack(), ...sentTeams()]) {
        expectNoHtmlEntities(message);
      }

      const compiles: Array<RecordedCompile> = recordedCompiles(
        StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate,
        StatusPageSubscriberNotificationTemplateServiceClass.compileEmailBodyTemplate,
      );

      for (const call of compiles) {
        expectOnlyOfferedVariables(EVENT_TYPE, call.rawVariables);
      }

      expectOnlyTheListedHtmlVariables(
        compiles.find((call: RecordedCompile): boolean => {
          return call.emailBody;
        })!.rawVariables,
        EVENT_TYPE,
      );

      expect(feedItem()["moreInformationInMarkdown"]).toContain(
        "- **Internal Ticket:** OPS\\-4411",
      );
    },
  );
});

/*
 * How the notification sends (SubscriberDeliveryContract): every message
 * awaited and counted, failures of every kind on every channel, every
 * subscriber past LIMIT_MAX, and the send window and the run's latest claim.
 */
describeSubscriberDelivery({
  title: "Incident:SendPostmortemNotificationToSubscribers",
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
  statusColumn: "subscriberNotificationStatusOnPostmortemPublished",
  messageColumn: "subscriberNotificationStatusMessageOnPostmortemPublished",
  claimedAtColumn: "subscriberNotificationClaimedAtOnPostmortemPublished",
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
  retryScope: SubscriberNotificationRetryScope.EveryPage,
});

/*
 * Subscribers who chose resources, on a page that shows the incident's
 * monitor through a monitor group. An incident reaches a page's resources
 * through IncidentStatusPageScope, which reads them with the lookup that
 * follows monitor groups (findByMonitors), so whoever picked the group is
 * told - as about an announcement or a scheduled maintenance event on that
 * monitor - and whoever picked another group is not.
 */
describe("Incident:SendPostmortemNotificationToSubscribers subscribers who picked a monitor group", () => {
  function emailsSentTo(): Array<string> {
    return sentMail().map((mail: JSONObject): string => {
      return (mail["toEmail"] as Email).toString();
    });
  }

  function givenThePage(
    page: ReturnType<typeof pageShowingTheMonitorThroughAGroup>,
  ): void {
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
      page.affectedResources as never,
    );
    mock(
      StatusPageSubscriberService.getSubscribersByStatusPage,
    ).mockResolvedValue(page.subscribers as never);
  }

  beforeEach(() => {
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([
      lettingSubscribersChooseResources(statusPage()),
    ] as never);
    decideWithTheRealSubscriberPreferences(
      StatusPageSubscriberService.shouldSendNotification,
    );
  });

  test("a page that shows the monitor only through a group tells the group's subscribers, and not another group's", async () => {
    const page: ReturnType<typeof pageShowingTheMonitorThroughAGroup> =
      pageShowingTheMonitorThroughAGroup(STATUS_PAGE_ID);
    givenThePage(page);

    await runJob();

    expect(emailsSentTo()).toEqual(page.told);
    expect(emailsSentTo()).not.toContain(fanEmail(ResourceFan.OtherGroup));
  });

  test("a page that lists the monitor and its group tells each of their subscribers once", async () => {
    const page: ReturnType<typeof pageShowingTheMonitorTwice> =
      pageShowingTheMonitorTwice(STATUS_PAGE_ID);
    givenThePage(page);

    await runJob();

    expect(emailsSentTo()).toEqual(page.told);
  });
});
