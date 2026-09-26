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
import IncidentCreatedRenotify from "Common/Types/StatusPage/IncidentCreatedRenotify";

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

jest.mock("Common/Server/Services/IncidentService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      // IncidentStatusPageScope reads each incident's status page scope.
      findBy: jest.fn(),
      updateOneById: jest.fn(),
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
import { Blue500, Yellow500 } from "Common/Types/BrandColors";
import "../../../../FeatureSet/Workers/Jobs/Incident/SendNotificationToSubscribers";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

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
const UNSUBSCRIBE_URL: string = `${STATUS_PAGE_URL}/update-subscription/${SUBSCRIBER_ID.toString()}`;
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
    unsubscribeUrl: UNSUBSCRIBE_URL,
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
  mock(StatusPageSubscriberService.getUnsubscribeLink).mockReturnValue(
    URL.fromString(UNSUBSCRIBE_URL),
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
      `Incident ${INCIDENT_TITLE} (Critical) on Acme Status. Impact: Checkout API. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
    ]);
    expect(sentSlack()).toHaveLength(1);
    expect(sentSlack()[0]).toContain(`## 🚨 Incident - ${INCIDENT_TITLE}`);
    expect(sentTeams()).toHaveLength(1);
    expect(sentTeams()[0]).toContain(`## 🚨 Incident - ${INCIDENT_TITLE}`);
    expect(sentWebhooks()[0]!["eventType"]).toBe("IncidentCreated");
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

    const shared: Record<string, string> = {
      statusPageName: "Acme Status",
      statusPageUrl: STATUS_PAGE_URL,
      detailsUrl: DETAILS_URL,
      unsubscribeUrl: UNSUBSCRIBE_URL,
      incidentSeverity: "Critical",
      incidentTitle: INCIDENT_TITLE,
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
    expect(variablesCompiledInto(CUSTOM_SMS_BODY)).toEqual(plainText);
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

  // The status each write set, leaving out the notified-pages record writes.
  function statusesWritten(incidentId: ObjectID): Array<unknown> {
    return statusWritesFor(incidentId)
      .filter((data: JSONObject): boolean => {
        return "subscriberNotificationStatusOnIncidentCreated" in data;
      })
      .map((data: JSONObject): unknown => {
        return data["subscriberNotificationStatusOnIncidentCreated"];
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

  test("records each page as it is told, and settles with the full record", async () => {
    everySiteHasOneEmailSubscriber();

    await runJob();

    expect(notifiedPageRecords()).toEqual([[3], [3, 7], [3, 7]]);
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
      "- **Site 03**: nothing queued. Sending to this status page failed part-way",
    );
  });

  test("the feed item lists each page, the subject used and what was queued", async () => {
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
        `- **Site 03**: 2 email queued. Subject: "\\[Incident\\] ${INCIDENT_TITLE}".`,
        `- **Site 07**: 1 email, 1 webhook queued. Not sent again to 1 email address already sent it through another status page. Subject: "\\[Incident\\] ${INCIDENT_TITLE}".`,
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
        `- **Site 01**: 1 email queued. Subject: "\\[Incident\\] ${INCIDENT_TITLE}".`,
        `- **Site 02**: 1 email queued. Subject: "\\[Incident\\] ${INCIDENT_TITLE}".`,
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
