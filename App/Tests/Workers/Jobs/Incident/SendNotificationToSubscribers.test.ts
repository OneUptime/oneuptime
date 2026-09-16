import Incident from "Common/Models/DatabaseModels/Incident";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
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
 * Incident created subscriber notifications.
 *
 * These tests drive one tick of the cron against fakes for every service and
 * check what each channel receives (with and without custom templates), which
 * status columns are written on the incident, and what lands in the incident
 * feed. The Webhook template compiler is the real one, so a custom Webhook
 * template is filled and parsed exactly as it is in production.
 *
 * RunCron is mocked to capture the handler, as in the other
 * App/Tests/Workers/Jobs suites.
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

jest.mock("Common/Server/Utils/StatusPageResource", () => {
  return {
    __esModule: true,
    default: { getResourcesGroupedByGroupName: jest.fn() },
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
    default: {
      toTwilioConfig: jest.fn((config: unknown) => {
        return config ? { twilio: "custom" } : undefined;
      }),
    },
  };
});

jest.mock("Common/Server/Services/ProjectSmtpConfigService", () => {
  return {
    __esModule: true,
    default: {
      toEmailServer: jest.fn((config: unknown) => {
        return config ? { smtp: "custom" } : undefined;
      }),
    },
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
import "../../../../FeatureSet/Workers/Jobs/Incident/SendNotificationToSubscribers";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const JOB_NAME: string = "Incident:SendNotificationToSubscribers";
const EVENT: StatusPageSubscriberNotificationEventType =
  StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated;
const ALL_VARIABLE_NAMES: Array<string> =
  SubscriberNotificationTemplateVariables.getVariableNames(EVENT);

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SECOND_STATUS_PAGE_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SECOND_INCIDENT_ID: ObjectID = new ObjectID(
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

const STATUS_PAGE_URL: string = "https://status.acme.com";
const DETAILS_URL: string = `${STATUS_PAGE_URL}/incidents/${INCIDENT_ID.toString()}`;
const DASHBOARD_URL: string = "https://oneuptime.acme.com/dashboard/incident/1";
const LOGO_URL: string = `https://oneuptime.acme.com/status-page-api/logo/${STATUS_PAGE_ID.toString()}`;
const SLACK_URL: string = "https://hooks.slack.com/services/T000/B000/XXXX";
const TEAMS_URL: string = "https://outlook.office.com/webhook/abc";
const WEBHOOK_URL: string = "https://hooks.acme.com/status";

const INCIDENT_TITLE: string = "Checkout requests failing";
const INCIDENT_DESCRIPTION: string = "Payments **fail** in Europe.";
const DESCRIPTION_HTML: string =
  "<p>Payments <strong>fail</strong> in Europe.</p>";
const DESCRIPTION_TEXT: string = "Payments fail in Europe.";
const RESOURCES_AFFECTED: string = "Checkout API";
const SUCCESS_MESSAGE: string =
  "Notifications sent successfully to all subscribers";

const ALL_METHODS: Array<StatusPageSubscriberNotificationMethod> = [
  StatusPageSubscriberNotificationMethod.Email,
  StatusPageSubscriberNotificationMethod.SMS,
  StatusPageSubscriberNotificationMethod.Slack,
  StatusPageSubscriberNotificationMethod.MicrosoftTeams,
  StatusPageSubscriberNotificationMethod.Webhook,
];

type TemplatesByMethod = Partial<
  Record<
    StatusPageSubscriberNotificationMethod,
    StatusPageSubscriberNotificationTemplate
  >
>;

let incidentsToSkip: Array<Incident> = [];
let pendingIncidents: Array<Incident> = [];
let templates: TemplatesByMethod = {};

function unsubscribeUrlFor(id: ObjectID): string {
  return `${STATUS_PAGE_URL}/update-subscription/${id.toString()}`;
}

const UNSUBSCRIBE_URL: string = unsubscribeUrlFor(SUBSCRIBER_ID);

function incident(overrides?: {
  id?: ObjectID;
  isVisibleOnStatusPage?: boolean;
  withoutMonitors?: boolean;
  withoutSeverity?: boolean;
  withoutNumber?: boolean;
  withoutNumberPrefix?: boolean;
  title?: string;
  description?: string;
}): Incident {
  const row: Incident = new Incident();
  row._id = (overrides?.id || INCIDENT_ID).toString();
  row.title = overrides?.title ?? INCIDENT_TITLE;
  row.description = overrides?.description ?? INCIDENT_DESCRIPTION;
  row.projectId = PROJECT_ID;
  row.isVisibleOnStatusPage = overrides?.isVisibleOnStatusPage !== false;

  if (!overrides?.withoutNumber) {
    row.incidentNumber = 7;
  }

  if (!overrides?.withoutNumberPrefix) {
    row.incidentNumberWithPrefix = "INC-7";
  }

  if (!overrides?.withoutSeverity) {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity.name = "Critical";
    row.incidentSeverity = severity;
  }

  if (overrides?.withoutMonitors) {
    row.monitors = [];
  } else {
    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID.toString();
    row.monitors = [monitor];
  }

  return row;
}

function statusPage(overrides?: {
  id?: ObjectID;
  withoutId?: boolean;
  showIncidentsOnStatusPage?: boolean;
  isPublicStatusPage?: boolean;
  withSmtpConfig?: boolean;
  withCallSmsConfig?: boolean;
  withLogo?: boolean;
  pageTitle?: string;
  name?: string;
}): StatusPage {
  const page: StatusPage = new StatusPage();

  if (!overrides?.withoutId) {
    page._id = (overrides?.id || STATUS_PAGE_ID).toString();
  }

  page.projectId = PROJECT_ID;
  page.name = overrides?.name ?? "Acme";
  page.pageTitle = overrides?.pageTitle ?? "Acme Status";
  page.isPublicStatusPage = overrides?.isPublicStatusPage !== false;
  page.showIncidentsOnStatusPage =
    overrides?.showIncidentsOnStatusPage !== false;

  if (overrides?.withSmtpConfig) {
    page.smtpConfig = new ProjectSmtpConfig();
  }

  if (overrides?.withCallSmsConfig) {
    page.callSmsConfig = new ProjectCallSMSConfig();
  }

  if (overrides?.withLogo) {
    page.logoFileId = new ObjectID("88888888-8888-4888-8888-888888888888");
  }

  return page;
}

function resource(
  statusPageId: ObjectID | undefined = STATUS_PAGE_ID,
): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = ObjectID.generate().toString();
  if (statusPageId) {
    row.statusPageId = statusPageId;
  }
  row.displayName = RESOURCES_AFFECTED;
  return row;
}

function subscriber(
  id: ObjectID | null = SUBSCRIBER_ID,
  overrides?: { email?: string },
): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  if (id) {
    row._id = id.toString();
  }
  row.subscriberEmail = new Email(overrides?.email || "customer@example.com");
  row.subscriberPhone = new Phone("+15555550100");
  row.slackIncomingWebhookUrl = URL.fromString(SLACK_URL);
  row.microsoftTeamsIncomingWebhookUrl = URL.fromString(TEAMS_URL);
  row.subscriberWebhook = URL.fromString(WEBHOOK_URL);
  return row;
}

function template(
  templateBody: string,
  emailSubject?: string,
): StatusPageSubscriberNotificationTemplate {
  const row: StatusPageSubscriberNotificationTemplate =
    new StatusPageSubscriberNotificationTemplate();
  row.templateBody = templateBody;
  if (emailSubject !== undefined) {
    row.emailSubject = emailSubject;
  }
  return row;
}

function useStatusPages(pages: Array<StatusPage>): void {
  mock(
    StatusPageSubscriberService.getStatusPagesToSendNotification,
  ).mockResolvedValue(pages as never);
}

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve: (value: unknown) => void) => {
    setImmediate(resolve);
  });
}

async function runJob(): Promise<void> {
  expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
  await mockCapturedJobs[JOB_NAME]!();
  await flushPromises();
}

interface StatusWrite {
  id: string;
  data: JSONObject;
  props: JSONObject;
}

function statusWrites(): Array<StatusWrite> {
  return mock(IncidentService.updateOneById).mock.calls.map(
    (call: Array<unknown>): StatusWrite => {
      const args: { id: ObjectID; data: JSONObject; props: JSONObject } =
        call[0] as { id: ObjectID; data: JSONObject; props: JSONObject };
      return {
        id: args.id.toString(),
        data: args.data,
        props: args.props,
      };
    },
  );
}

function statusDataFor(id: ObjectID): Array<JSONObject> {
  return statusWrites()
    .filter((write: StatusWrite): boolean => {
      return write.id === id.toString();
    })
    .map((write: StatusWrite): JSONObject => {
      return write.data;
    });
}

function firstArgs(fn: unknown): Array<JSONObject> {
  return mock(fn).mock.calls.map((call: Array<unknown>): JSONObject => {
    return call[0] as JSONObject;
  });
}

function secondArgs(fn: unknown): Array<JSONObject> {
  return mock(fn).mock.calls.map((call: Array<unknown>): JSONObject => {
    return call[1] as JSONObject;
  });
}

function sentMail(): Array<JSONObject> {
  return firstArgs(MailService.sendMail);
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
  return firstArgs(IncidentFeedService.createIncidentFeedItem);
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

// The values every template variable should carry for the default fixtures.
function expectedVariables(
  overrides?: Record<string, string>,
): Record<string, string> {
  return {
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    statusPageId: STATUS_PAGE_ID.toString(),
    unsubscribeUrl: UNSUBSCRIBE_URL,
    resourcesAffected: RESOURCES_AFFECTED,
    incidentId: INCIDENT_ID.toString(),
    incidentNumber: "7",
    incidentTitle: INCIDENT_TITLE,
    incidentDescription: INCIDENT_DESCRIPTION,
    incidentSeverity: "Critical",
    detailsUrl: DETAILS_URL,
    ...overrides,
  };
}

function fill(text: string, variables: Record<string, string>): string {
  return text.replace(/{{\s*(\w+)\s*}}/g, (_match: string, key: string) => {
    return variables[key] ?? "";
  });
}

function dashboardDefault(
  method: StatusPageSubscriberNotificationMethod,
): string {
  return fill(
    getDefaultSubscriberNotificationTemplate(EVENT, method)?.body || "",
    expectedVariables(),
  );
}

function dashboardWebhookDefault(
  variables: Record<string, string>,
): JSONObject | null {
  return StatusPageSubscriberWebhookTemplate.compile(
    getDefaultSubscriberNotificationTemplate(
      EVENT,
      StatusPageSubscriberNotificationMethod.Webhook,
    )?.body || "",
    variables,
  );
}

// The payload webhook subscribers get when there is no custom template.
function expectedDefaultPayload(overrides?: {
  root?: JSONObject;
  data?: JSONObject;
}): JSONObject {
  return {
    eventType: "IncidentCreated",
    statusPageId: STATUS_PAGE_ID.toString(),
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    unsubscribeUrl: UNSUBSCRIBE_URL,
    ...overrides?.root,
    data: {
      incidentId: INCIDENT_ID.toString(),
      incidentNumber: "7",
      incidentTitle: INCIDENT_TITLE,
      incidentDescription: INCIDENT_DESCRIPTION,
      incidentSeverity: "Critical",
      resourcesAffected: RESOURCES_AFFECTED,
      detailsUrl: DETAILS_URL,
      ...overrides?.data,
    },
  };
}

// A text template that references every documented variable, one per line.
const EVERY_VARIABLE_TEXT_TEMPLATE: string = ALL_VARIABLE_NAMES.map(
  (name: string): string => {
    return `${name}=[{{${name}}}]`;
  },
).join("\n");

function everyVariableText(variables: Record<string, string>): string {
  return ALL_VARIABLE_NAMES.map((name: string): string => {
    return `${name}=[${variables[name]}]`;
  }).join("\n");
}

// A Webhook template that maps every documented variable to a JSON key.
function everyVariableWebhookTemplate(): string {
  const body: Record<string, string> = {};
  for (const name of ALL_VARIABLE_NAMES) {
    body[name] = `{{${name}}}`;
  }
  return JSON.stringify(body, null, 2);
}

beforeEach(() => {
  jest.clearAllMocks();

  incidentsToSkip = [];
  pendingIncidents = [incident()];
  templates = {};

  mock(IncidentService.findAllBy).mockImplementation(
    async (args: unknown): Promise<Array<Incident>> => {
      const query: JSONObject = (args as { query: JSONObject }).query;

      return query["shouldStatusPageSubscribersBeNotifiedOnIncidentCreated"]
        ? pendingIncidents
        : incidentsToSkip;
    },
  );
  mock(IncidentService.updateOneById).mockResolvedValue(undefined as never);
  mock(IncidentService.getIncidentLinkInDashboard).mockResolvedValue(
    URL.fromString(DASHBOARD_URL) as never,
  );
  mock(IncidentFeedService.createIncidentFeedItem).mockResolvedValue(
    undefined as never,
  );

  mock(DatabaseConfig.getHost).mockResolvedValue(
    Hostname.fromString("oneuptime.acme.com") as never,
  );
  mock(DatabaseConfig.getHttpProtocol).mockResolvedValue(
    Protocol.HTTPS as never,
  );

  mock(StatusPageResourceService.findByMonitors).mockResolvedValue([
    resource(),
  ] as never);
  mock(StatusPageResourceUtil.getResourcesGroupedByGroupName).mockReturnValue(
    RESOURCES_AFFECTED,
  );

  useStatusPages([statusPage()]);
  mock(
    StatusPageSubscriberService.getSubscribersByStatusPage,
  ).mockResolvedValue([subscriber()] as never);
  mock(StatusPageSubscriberService.shouldSendNotification).mockReturnValue(
    true,
  );
  mock(StatusPageSubscriberService.getUnsubscribeLink).mockImplementation(
    (_url: unknown, id: unknown): URL => {
      return URL.fromString(unsubscribeUrlFor(id as ObjectID));
    },
  );
  mock(StatusPageService.getStatusPageURL).mockResolvedValue(
    STATUS_PAGE_URL as never,
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
      return templates[method] || null;
    },
  );

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
  test("registers the cron", () => {
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
  });

  describe("picking up incidents", () => {
    test("looks for pending incidents to skip and to notify, selecting what the messages need", async () => {
      await runJob();

      const calls: Array<JSONObject> = firstArgs(IncidentService.findAllBy);

      expect(calls).toHaveLength(2);
      expect(calls[0]!["query"]).toEqual({
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Pending,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
      });
      expect(calls[1]!["query"]).toEqual({
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Pending,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
      });
      expect(calls[1]!["select"]).toEqual(
        expect.objectContaining({
          _id: true,
          title: true,
          description: true,
          projectId: true,
          isVisibleOnStatusPage: true,
          monitors: { _id: true },
          incidentSeverity: { name: true },
          incidentNumber: true,
          incidentNumberWithPrefix: true,
        }),
      );
    });

    test("marks incidents whose subscribers are not to be notified as Skipped", async () => {
      incidentsToSkip = [incident({ id: SECOND_INCIDENT_ID })];
      pendingIncidents = [];

      await runJob();

      nothingSent();
      expect(feedItems()).toHaveLength(0);
      expect(statusWrites()).toEqual([
        {
          id: SECOND_INCIDENT_ID.toString(),
          data: {
            subscriberNotificationStatusOnIncidentCreated:
              StatusPageSubscriberNotificationStatus.Skipped,
            subscriberNotificationStatusMessage:
              "Notifications skipped as subscribers are not to be notified for this incident.",
          },
          props: { isRoot: true, ignoreHooks: true },
        },
      ]);
    });

    test("does nothing when no incident is pending", async () => {
      pendingIncidents = [];

      await runJob();

      nothingSent();
      expect(statusWrites()).toHaveLength(0);
      expect(feedItems()).toHaveLength(0);
      expect(StatusPageResourceService.findByMonitors).not.toHaveBeenCalled();
    });

    test("finds the status pages of the incident's monitors, once per status page", async () => {
      mock(StatusPageResourceService.findByMonitors).mockResolvedValue([
        resource(STATUS_PAGE_ID),
        resource(STATUS_PAGE_ID),
        resource(SECOND_STATUS_PAGE_ID),
        resource(undefined),
      ] as never);

      await runJob();

      const monitorsArgs: JSONObject = firstArgs(
        StatusPageResourceService.findByMonitors,
      )[0]!;
      expect(
        (monitorsArgs["monitors"] as unknown as Array<Monitor>).map(
          (monitor: Monitor): string => {
            return monitor.id!.toString();
          },
        ),
      ).toEqual([MONITOR_ID.toString()]);

      const statusPageIds: Array<ObjectID> = mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mock.calls[0]![0] as Array<ObjectID>;
      expect(
        statusPageIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      ).toEqual([STATUS_PAGE_ID.toString(), SECOND_STATUS_PAGE_ID.toString()]);
    });

    test("groups only the status page's own resources and checks the subscriber's preferences", async () => {
      const first: StatusPageResource = resource(STATUS_PAGE_ID);
      const other: StatusPageResource = resource(SECOND_STATUS_PAGE_ID);
      mock(StatusPageResourceService.findByMonitors).mockResolvedValue([
        first,
        other,
      ] as never);

      await runJob();

      expect(
        StatusPageResourceUtil.getResourcesGroupedByGroupName,
      ).toHaveBeenCalledWith([first]);
      expect(
        StatusPageSubscriberService.shouldSendNotification,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          statusPageResources: [first],
          eventType: StatusPageEventType.Incident,
        }),
      );
      expect(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).toHaveBeenCalledWith(expect.anything(), {
        isRoot: true,
        ignoreHooks: true,
      });
    });
  });

  describe("status bookkeeping", () => {
    test("records InProgress then Success, without hooks", async () => {
      await runJob();

      expect(statusWrites()).toEqual([
        {
          id: INCIDENT_ID.toString(),
          data: {
            subscriberNotificationStatusOnIncidentCreated:
              StatusPageSubscriberNotificationStatus.InProgress,
          },
          props: { isRoot: true, ignoreHooks: true },
        },
        {
          id: INCIDENT_ID.toString(),
          data: {
            subscriberNotificationStatusOnIncidentCreated:
              StatusPageSubscriberNotificationStatus.Success,
            subscriberNotificationStatusMessage: SUCCESS_MESSAGE,
          },
          props: { isRoot: true, ignoreHooks: true },
        },
      ]);
    });

    test.each([
      ["an empty monitor list", true],
      ["no monitors selected", false],
    ])(
      "marks the incident Skipped when it has %s",
      async (_label: string, emptyList: boolean) => {
        const row: Incident = incident({ withoutMonitors: true });
        if (!emptyList) {
          delete (row as unknown as JSONObject)["monitors"];
        }
        pendingIncidents = [row];

        await runJob();

        nothingSent();
        expect(feedItems()).toHaveLength(0);
        expect(
          StatusPageSubscriberService.getStatusPagesToSendNotification,
        ).not.toHaveBeenCalled();
        expect(statusWrites()).toEqual([
          {
            id: INCIDENT_ID.toString(),
            data: {
              subscriberNotificationStatusOnIncidentCreated:
                StatusPageSubscriberNotificationStatus.Skipped,
              subscriberNotificationStatusMessage:
                "No monitors are attached to this incident. Skipping notifications to subscribers.",
            },
            props: { isRoot: true, ignoreHooks: true },
          },
        ]);
      },
    );

    test("sends nothing for an incident hidden from the status page, after marking it InProgress", async () => {
      pendingIncidents = [incident({ isVisibleOnStatusPage: false })];

      await runJob();

      nothingSent();
      expect(feedItems()).toHaveLength(0);
      expect(StatusPageResourceService.findByMonitors).not.toHaveBeenCalled();
      expect(statusDataFor(INCIDENT_ID)).toEqual([
        {
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.InProgress,
        },
      ]);
    });

    test("marks the incident Failed with the reason when preparing the messages breaks", async () => {
      mock(Markdown.convertToHTML).mockRejectedValue(
        new Error("markdown exploded") as never,
      );

      await runJob();

      nothingSent();
      expect(feedItems()).toHaveLength(0);
      expect(statusWrites()).toEqual([
        {
          id: INCIDENT_ID.toString(),
          data: {
            subscriberNotificationStatusOnIncidentCreated:
              StatusPageSubscriberNotificationStatus.InProgress,
          },
          props: { isRoot: true, ignoreHooks: true },
        },
        {
          id: INCIDENT_ID.toString(),
          data: {
            subscriberNotificationStatusOnIncidentCreated:
              StatusPageSubscriberNotificationStatus.Failed,
            subscriberNotificationStatusMessage: "markdown exploded",
          },
          props: { isRoot: true, ignoreHooks: true },
        },
      ]);
    });

    test("marks the incident Failed when the dashboard link cannot be built", async () => {
      mock(IncidentService.getIncidentLinkInDashboard).mockRejectedValue(
        new Error("no dashboard host") as never,
      );

      await runJob();

      nothingSent();
      expect(statusDataFor(INCIDENT_ID)).toEqual([
        {
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Failed,
          subscriberNotificationStatusMessage: "no dashboard host",
        },
      ]);
    });

    test("marks the incident Failed when the feed item cannot be written, after sending", async () => {
      mock(IncidentFeedService.createIncidentFeedItem).mockRejectedValue(
        new Error("feed unavailable") as never,
      );

      await runJob();

      expect(sentMail()).toHaveLength(1);
      expect(sentWebhooks()).toHaveLength(1);
      expect(statusDataFor(INCIDENT_ID)).toEqual([
        {
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.InProgress,
        },
        {
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Failed,
          subscriberNotificationStatusMessage: "feed unavailable",
        },
      ]);
    });

    test("stores a non-Error failure as text", async () => {
      mock(StatusPageResourceService.findByMonitors).mockRejectedValue(
        "resource lookup timed out" as never,
      );

      await runJob();

      expect(
        statusDataFor(INCIDENT_ID)[statusDataFor(INCIDENT_ID).length - 1],
      ).toEqual({
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Failed,
        subscriberNotificationStatusMessage: "resource lookup timed out",
      });
    });

    test("logs, and does not throw, when the Failed status cannot be written either", async () => {
      mock(Markdown.convertToHTML).mockRejectedValue(
        new Error("markdown exploded") as never,
      );
      mock(IncidentService.updateOneById)
        .mockResolvedValueOnce(undefined as never)
        .mockRejectedValueOnce(new Error("database down") as never);

      await expect(runJob()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        `Failed to update incident ${INCIDENT_ID.toString()} status after error: database down`,
      );
    });

    test("handles each incident on its own in a multi-incident tick", async () => {
      pendingIncidents = [
        incident({ id: SECOND_INCIDENT_ID }),
        incident({ id: INCIDENT_ID }),
      ];
      mock(StatusPageResourceService.findByMonitors)
        .mockRejectedValueOnce(new Error("first incident broke") as never)
        .mockResolvedValue([resource()] as never);

      await runJob();

      expect(
        statusDataFor(SECOND_INCIDENT_ID).map((data: JSONObject) => {
          return data["subscriberNotificationStatusOnIncidentCreated"];
        }),
      ).toEqual([
        StatusPageSubscriberNotificationStatus.InProgress,
        StatusPageSubscriberNotificationStatus.Failed,
      ]);
      expect(
        statusDataFor(INCIDENT_ID).map((data: JSONObject) => {
          return data["subscriberNotificationStatusOnIncidentCreated"];
        }),
      ).toEqual([
        StatusPageSubscriberNotificationStatus.InProgress,
        StatusPageSubscriberNotificationStatus.Success,
      ]);
      expect(sentMail()).toHaveLength(1);
      expect(feedItems()).toHaveLength(1);
      expect(feedItems()[0]!["incidentId"]).toEqual(INCIDENT_ID);
    });

    test("a status page that fails does not stop the others or fail the incident", async () => {
      useStatusPages([statusPage({ id: SECOND_STATUS_PAGE_ID }), statusPage()]);
      mock(StatusPageService.getStatusPageURL)
        .mockRejectedValueOnce(new Error("status page broke") as never)
        .mockResolvedValue(STATUS_PAGE_URL as never);

      await runJob();

      expect(sentMail()).toHaveLength(1);
      expect(sentWebhooks()).toEqual([expectedDefaultPayload()]);
      expect(logger.error).toHaveBeenCalledWith(new Error("status page broke"));
      expect(feedItems()[0]!["displayColor"]).toBe(Blue500);
      expect(
        statusDataFor(INCIDENT_ID)[statusDataFor(INCIDENT_ID).length - 1],
      ).toEqual({
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Success,
        subscriberNotificationStatusMessage: SUCCESS_MESSAGE,
      });
    });

    test("skips a status page without an id and a subscriber without an id", async () => {
      useStatusPages([statusPage({ withoutId: true }), statusPage()]);
      mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mockResolvedValue([subscriber(null), subscriber()] as never);

      await runJob();

      expect(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).toHaveBeenCalledTimes(1);
      expect(sentMail()).toHaveLength(1);
      expect(templateLookups()).toHaveLength(5);
    });
  });

  describe("incident feed", () => {
    test("records that subscribers were notified", async () => {
      await runJob();

      expect(IncidentService.getIncidentLinkInDashboard).toHaveBeenCalledWith(
        PROJECT_ID,
        INCIDENT_ID,
      );
      expect(feedItems()).toEqual([
        {
          incidentId: INCIDENT_ID,
          projectId: PROJECT_ID,
          incidentFeedEventType:
            IncidentFeedEventType.SubscriberNotificationSent,
          displayColor: Blue500,
          feedInfoInMarkdown: `📧 **Subscriber Incident Created Notification Sent for [Incident INC-7](${DASHBOARD_URL})**:
      Notification sent to status page subscribers because this incident was created.`,
          workspaceNotification: {
            sendWorkspaceNotification: false,
          },
        },
      ]);
    });

    test("records when no subscriber matched", async () => {
      mock(StatusPageSubscriberService.shouldSendNotification).mockReturnValue(
        false,
      );

      await runJob();

      nothingSent();
      expect(feedItems()).toEqual([
        {
          incidentId: INCIDENT_ID,
          projectId: PROJECT_ID,
          incidentFeedEventType:
            IncidentFeedEventType.SubscriberNotificationSent,
          displayColor: Yellow500,
          feedInfoInMarkdown: `📧 **No notification sent to subscribers** for the creation of [Incident INC-7](${DASHBOARD_URL}).`,
          moreInformationInMarkdown:
            "Subscriber notifications were skipped because all associated status pages either hide incidents or had no matching subscribers.",
          workspaceNotification: {
            sendWorkspaceNotification: false,
          },
        },
      ]);
      expect(statusDataFor(INCIDENT_ID)[1]).toEqual({
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Success,
        subscriberNotificationStatusMessage: SUCCESS_MESSAGE,
      });
    });

    test("respects a status page that hides incidents", async () => {
      useStatusPages([statusPage({ showIncidentsOnStatusPage: false })]);

      await runJob();

      nothingSent();
      expect(templateLookups()).toHaveLength(0);
      expect(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).not.toHaveBeenCalled();
      expect(feedItems()[0]!["displayColor"]).toBe(Yellow500);
    });

    test("falls back to the plain incident number when there is no prefix", async () => {
      pendingIncidents = [incident({ withoutNumberPrefix: true })];

      await runJob();

      expect(feedItems()[0]!["feedInfoInMarkdown"]).toContain(
        `[Incident #7](${DASHBOARD_URL})`,
      );
    });

    test("uses a placeholder when the incident has no number at all", async () => {
      pendingIncidents = [
        incident({ withoutNumberPrefix: true, withoutNumber: true }),
      ];
      mock(StatusPageSubscriberService.shouldSendNotification).mockReturnValue(
        false,
      );

      await runJob();

      expect(feedItems()[0]!["feedInfoInMarkdown"]).toContain(
        `[Incident # - ](${DASHBOARD_URL})`,
      );
    });
  });

  describe("default messages (no custom templates)", () => {
    test("emails the incident created template", async () => {
      await runJob();

      expect(sentMail()).toHaveLength(1);
      const mail: JSONObject = sentMail()[0]!;

      expect((mail["toEmail"] as unknown as Email).toString()).toBe(
        "customer@example.com",
      );
      expect(mail["templateType"]).toBe(
        EmailTemplateType.SubscriberIncidentCreated,
      );
      expect(mail["subject"]).toBe(`[Incident] ${INCIDENT_TITLE}`);
      expect(mail["vars"]).toEqual({
        statusPageName: "Acme Status",
        statusPageUrl: STATUS_PAGE_URL,
        detailsUrl: DETAILS_URL,
        logoUrl: "",
        isPublicStatusPage: "true",
        resourcesAffected: RESOURCES_AFFECTED,
        incidentSeverity: "Critical",
        incidentTitle: INCIDENT_TITLE,
        incidentDescription: DESCRIPTION_HTML,
        unsubscribeUrl: UNSUBSCRIBE_URL,
        subscriberEmailNotificationFooterText: "Footer text",
      });
      expect(secondArgs(MailService.sendMail)[0]).toEqual({
        mailServer: undefined,
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        incidentId: INCIDENT_ID,
      });
    });

    test("adds the logo and private flag, and sends through the status page's SMTP server", async () => {
      useStatusPages([
        statusPage({
          withLogo: true,
          isPublicStatusPage: false,
          withSmtpConfig: true,
        }),
      ]);

      await runJob();

      expect(sentMail()[0]!["templateType"]).toBe(
        EmailTemplateType.SubscriberIncidentCreated,
      );
      expect(sentMail()[0]!["vars"]).toEqual(
        expect.objectContaining({
          logoUrl: LOGO_URL,
          isPublicStatusPage: "false",
        }),
      );
      expect(secondArgs(MailService.sendMail)[0]!["mailServer"]).toEqual({
        smtp: "custom",
      });
    });

    test("converts the description to HTML and plain text once per incident", async () => {
      useStatusPages([statusPage({ id: SECOND_STATUS_PAGE_ID }), statusPage()]);
      mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mockResolvedValue([
        subscriber(),
        subscriber(SECOND_SUBSCRIBER_ID),
      ] as never);

      await runJob();

      expect(sentMail()).toHaveLength(4);
      expect(Markdown.convertToHTML).toHaveBeenCalledTimes(1);
      expect(Markdown.convertToHTML).toHaveBeenCalledWith(
        INCIDENT_DESCRIPTION,
        "Email",
      );
      expect(Markdown.convertToPlainText).toHaveBeenCalledTimes(1);
      expect(Markdown.convertToPlainText).toHaveBeenCalledWith(
        INCIDENT_DESCRIPTION,
      );
    });

    test("texts the dashboard's SMS starter", async () => {
      await runJob();

      expect(sentSms()).toEqual([
        `Incident ${INCIDENT_TITLE} (Critical) on Acme Status. Impact: ${RESOURCES_AFFECTED}. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
      ]);
      expect(sentSms()[0]).toBe(
        dashboardDefault(StatusPageSubscriberNotificationMethod.SMS),
      );
      expect(
        (
          firstArgs(SmsService.sendSms)[0]!["to"] as unknown as Phone
        ).toString(),
      ).toBe("+15555550100");
      expect(secondArgs(SmsService.sendSms)[0]).toEqual({
        projectId: PROJECT_ID,
        customTwilioConfig: undefined,
        statusPageId: STATUS_PAGE_ID,
        incidentId: INCIDENT_ID,
      });
    });

    test("posts the dashboard's Slack starter, converted to Slack rich text", async () => {
      await runJob();

      const expected: string = `## 🚨 Incident - ${INCIDENT_TITLE}

**Severity:** Critical

**Resources Affected:** ${RESOURCES_AFFECTED}

**Description:** ${INCIDENT_DESCRIPTION}

[View Status Page](${STATUS_PAGE_URL}) | [Unsubscribe](${UNSUBSCRIBE_URL})`;

      expect(sentSlack()).toEqual([expected]);
      expect(sentSlack()[0]).toBe(
        dashboardDefault(StatusPageSubscriberNotificationMethod.Slack),
      );
      expect(SlackUtil.convertMarkdownToSlackRichText).toHaveBeenCalledTimes(1);
      expect(SlackUtil.convertMarkdownToSlackRichText).toHaveBeenCalledWith(
        expected,
      );
      expect(
        (
          firstArgs(SlackUtil.sendMessageToChannelViaIncomingWebhook)[0]![
            "url"
          ] as unknown as URL
        ).toString(),
      ).toBe(SLACK_URL);
    });

    test("posts the dashboard's Microsoft Teams starter without Slack conversion", async () => {
      await runJob();

      expect(sentTeams()).toEqual([
        `## 🚨 Incident - ${INCIDENT_TITLE}
**Severity:** Critical
**Resources Affected:** ${RESOURCES_AFFECTED}
**Description:** ${INCIDENT_DESCRIPTION}
[View Status Page](${STATUS_PAGE_URL}) | [Unsubscribe](${UNSUBSCRIBE_URL})`,
      ]);
      expect(sentTeams()[0]).toBe(
        dashboardDefault(StatusPageSubscriberNotificationMethod.MicrosoftTeams),
      );
      expect(
        (
          firstArgs(
            MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
          )[0]!["url"] as unknown as URL
        ).toString(),
      ).toBe(TEAMS_URL);
      // Only the Slack message goes through the Slack rich-text conversion.
      expect(SlackUtil.convertMarkdownToSlackRichText).toHaveBeenCalledTimes(1);
    });

    test("sends webhook subscribers the fixed payload, which is the dashboard's Webhook starter", async () => {
      await runJob();

      expect(sentWebhooks()).toHaveLength(1);
      const payload: JSONObject = sentWebhooks()[0]!;

      expect(payload).toEqual(expectedDefaultPayload());
      expect(Object.keys(payload)).toEqual([
        "eventType",
        "statusPageId",
        "statusPageName",
        "statusPageUrl",
        "unsubscribeUrl",
        "data",
      ]);
      expect(Object.keys(payload["data"] as JSONObject)).toEqual([
        "incidentId",
        "incidentNumber",
        "incidentTitle",
        "incidentDescription",
        "incidentSeverity",
        "resourcesAffected",
        "detailsUrl",
      ]);
      expect(payload).toEqual(dashboardWebhookDefault(expectedVariables()));
      expect(
        (
          firstArgs(
            StatusPageSubscriberWebhookUtil.sendWebhookNotification,
          )[0]!["webhookUrl"] as unknown as URL
        ).toString(),
      ).toBe(WEBHOOK_URL);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    test("keeps each channel's own fallback when the incident has no severity", async () => {
      pendingIncidents = [incident({ withoutSeverity: true })];

      await runJob();

      expect(sentMail()[0]!["vars"]).toEqual(
        expect.objectContaining({ incidentSeverity: " - " }),
      );
      expect(sentSms()[0]).toContain(`${INCIDENT_TITLE} (-) on Acme Status`);
      expect(sentSlack()[0]).toContain("**Severity:**  - ");
      expect(sentTeams()[0]).toContain("**Severity:**  - ");
      expect(sentWebhooks()[0]).toEqual(
        expectedDefaultPayload({ data: { incidentSeverity: "" } }),
      );
    });

    test("names the status page by its title, then its name, then a placeholder", async () => {
      useStatusPages([
        statusPage({ pageTitle: "", name: "Acme" }),
        statusPage({ id: SECOND_STATUS_PAGE_ID, pageTitle: "", name: "" }),
      ]);

      await runJob();

      expect(
        sentWebhooks().map((payload: JSONObject) => {
          return payload["statusPageName"];
        }),
      ).toEqual(["Acme", "Status Page"]);
      expect(sentSms()[1]).toContain("on Status Page.");
    });

    test("sends every channel to every matching subscriber", async () => {
      mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mockResolvedValue([
        subscriber(),
        subscriber(SECOND_SUBSCRIBER_ID, { email: "other@example.com" }),
      ] as never);

      await runJob();

      expect(sentMail()).toHaveLength(2);
      expect(sentSms()).toHaveLength(2);
      expect(sentSlack()).toHaveLength(2);
      expect(sentTeams()).toHaveLength(2);
      expect(sentWebhooks()).toEqual([
        expectedDefaultPayload(),
        expectedDefaultPayload({
          root: { unsubscribeUrl: unsubscribeUrlFor(SECOND_SUBSCRIBER_ID) },
        }),
      ]);
    });

    test("does not message a subscriber whose preferences exclude the incident", async () => {
      mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mockResolvedValue([
        subscriber(),
        subscriber(SECOND_SUBSCRIBER_ID),
      ] as never);
      mock(StatusPageSubscriberService.shouldSendNotification)
        .mockReturnValueOnce(false)
        .mockReturnValue(true);

      await runJob();

      expect(sentWebhooks()).toEqual([
        expectedDefaultPayload({
          root: { unsubscribeUrl: unsubscribeUrlFor(SECOND_SUBSCRIBER_ID) },
        }),
      ]);
      expect(sentMail()).toHaveLength(1);
      expect(feedItems()[0]!["displayColor"]).toBe(Blue500);
    });
  });

  describe("template lookups", () => {
    test("looks up one template per channel, including Webhook, for this event and status page", async () => {
      await runJob();

      const lookups: Array<JSONObject> = templateLookups();

      expect(lookups).toHaveLength(5);
      expect(
        lookups.map((lookup: JSONObject) => {
          return lookup["notificationMethod"];
        }),
      ).toEqual(ALL_METHODS);
      for (const lookup of lookups) {
        expect(lookup["eventType"]).toBe(EVENT);
        expect((lookup["statusPageId"] as unknown as ObjectID).toString()).toBe(
          STATUS_PAGE_ID.toString(),
        );
      }
    });

    test("looks templates up once per status page, not per subscriber", async () => {
      useStatusPages([statusPage(), statusPage({ id: SECOND_STATUS_PAGE_ID })]);
      mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mockResolvedValue([
        subscriber(),
        subscriber(SECOND_SUBSCRIBER_ID),
      ] as never);

      await runJob();

      expect(sentWebhooks()).toHaveLength(4);

      const lookups: Array<JSONObject> = templateLookups();
      expect(lookups).toHaveLength(10);

      for (const statusPageId of [STATUS_PAGE_ID, SECOND_STATUS_PAGE_ID]) {
        const forPage: Array<JSONObject> = lookups.filter(
          (lookup: JSONObject): boolean => {
            return (
              (lookup["statusPageId"] as unknown as ObjectID).toString() ===
              statusPageId.toString()
            );
          },
        );
        expect(
          forPage.map((lookup: JSONObject) => {
            return lookup["notificationMethod"];
          }),
        ).toEqual(ALL_METHODS);
      }
    });
  });

  describe("custom Webhook template", () => {
    const CUSTOM_WEBHOOK_TEMPLATE: string = `{
  "type": "incident.created",
  "page": { "id": "{{statusPageId}}", "name": "{{statusPageName}}", "url": "{{statusPageUrl}}" },
  "incident": {
    "id": "{{incidentId}}",
    "number": {{incidentNumber}},
    "title": "{{incidentTitle}}",
    "summary": "{{incidentDescription}}",
    "severity": "{{ incidentSeverity }}",
    "resources": "{{resourcesAffected}}",
    "link": "{{detailsUrl}}"
  },
  "unsubscribe": "{{unsubscribeUrl}}"
}`;

    test("sends the compiled JSON object instead of the default payload", async () => {
      templates = {
        [StatusPageSubscriberNotificationMethod.Webhook]: template(
          CUSTOM_WEBHOOK_TEMPLATE,
        ),
      };

      await runJob();

      expect(sentWebhooks()).toEqual([
        {
          type: "incident.created",
          page: {
            id: STATUS_PAGE_ID.toString(),
            name: "Acme Status",
            url: STATUS_PAGE_URL,
          },
          incident: {
            id: INCIDENT_ID.toString(),
            number: 7,
            title: INCIDENT_TITLE,
            summary: INCIDENT_DESCRIPTION,
            severity: "Critical",
            resources: RESOURCES_AFFECTED,
            link: DETAILS_URL,
          },
          unsubscribe: UNSUBSCRIBE_URL,
        },
      ]);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    test("leaves the other channels on their defaults", async () => {
      templates = {
        [StatusPageSubscriberNotificationMethod.Webhook]: template(
          CUSTOM_WEBHOOK_TEMPLATE,
        ),
      };

      await runJob();

      expect(sentMail()[0]!["templateType"]).toBe(
        EmailTemplateType.SubscriberIncidentCreated,
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

    test("is not used for other channels' templates, and other channels' templates do not touch the webhook", async () => {
      templates = {
        [StatusPageSubscriberNotificationMethod.Slack]: template(
          "Slack: {{incidentTitle}}",
        ),
        [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: template(
          "Teams: {{incidentTitle}}",
        ),
      };

      await runJob();

      expect(sentSlack()).toEqual([`Slack: ${INCIDENT_TITLE}`]);
      expect(sentTeams()).toEqual([`Teams: ${INCIDENT_TITLE}`]);
      expect(sentWebhooks()).toEqual([expectedDefaultPayload()]);
    });

    test("keeps quotes, backslashes and newlines intact", async () => {
      const title: string = 'He said "stop" \\ now $& then';
      const description: string =
        'Line one\nLine "two"\\path\n\ttabbed </script> {{notAVariable}}';
      const resources: string = 'Group "A": API\\v1\nGroup B: Web';

      pendingIncidents = [incident({ title: title, description: description })];
      mock(
        StatusPageResourceUtil.getResourcesGroupedByGroupName,
      ).mockReturnValue(resources);
      templates = {
        [StatusPageSubscriberNotificationMethod.Webhook]: template(
          CUSTOM_WEBHOOK_TEMPLATE,
        ),
      };

      await runJob();

      expect(logger.warn).not.toHaveBeenCalled();
      expect(sentWebhooks()).toHaveLength(1);

      const received: JSONObject = JSON.parse(
        JSON.stringify(sentWebhooks()[0]),
      ) as JSONObject;
      const receivedIncident: JSONObject = received["incident"] as JSONObject;

      expect(receivedIncident["title"]).toBe(title);
      expect(receivedIncident["summary"]).toBe(description);
      expect(receivedIncident["resources"]).toBe(resources);
      expect(receivedIncident["number"]).toBe(7);

      // The other channels still get the raw text.
      expect(sentSlack()[0]).toContain(`## 🚨 Incident - ${title}`);
      expect(sentTeams()[0]).toContain(`**Description:** ${description}`);
    });

    test.each([
      ["an unquoted text variable", '{ "title": {{incidentTitle}} }'],
      ["a missing closing brace", '{ "title": "{{incidentTitle}}"'],
      ["a JSON array", '[ "{{incidentTitle}}", "{{incidentId}}" ]'],
      ["a JSON string", '"{{incidentTitle}}"'],
      ["plain text", "Incident {{incidentTitle}} was created"],
    ])(
      "falls back to the default payload and warns when the template is %s",
      async (_label: string, templateBody: string) => {
        templates = {
          [StatusPageSubscriberNotificationMethod.Webhook]:
            template(templateBody),
        };

        await runJob();

        expect(sentWebhooks()).toEqual([expectedDefaultPayload()]);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        const warning: string = mock(logger.warn).mock.calls[0]![0] as string;
        expect(warning).toContain(STATUS_PAGE_ID.toString());
        expect(warning).toContain("IncidentCreated");

        // The other channels are unaffected and the incident still succeeds.
        expect(sentMail()).toHaveLength(1);
        expect(sentSms()).toHaveLength(1);
        expect(sentSlack()).toHaveLength(1);
        expect(sentTeams()).toHaveLength(1);
        expect(
          statusDataFor(INCIDENT_ID)[statusDataFor(INCIDENT_ID).length - 1],
        ).toEqual({
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Success,
          subscriberNotificationStatusMessage: SUCCESS_MESSAGE,
        });
      },
    );

    test("treats an empty template body as no template, without warning", async () => {
      templates = {
        [StatusPageSubscriberNotificationMethod.Webhook]: template(""),
      };

      await runJob();

      expect(sentWebhooks()).toEqual([expectedDefaultPayload()]);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    test("fills each subscriber's own unsubscribe link", async () => {
      mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mockResolvedValue([
        subscriber(),
        subscriber(SECOND_SUBSCRIBER_ID),
      ] as never);
      templates = {
        [StatusPageSubscriberNotificationMethod.Webhook]: template(
          '{ "unsubscribe": "{{unsubscribeUrl}}", "incident": "{{incidentId}}" }',
        ),
      };

      await runJob();

      expect(sentWebhooks()).toEqual([
        { unsubscribe: UNSUBSCRIBE_URL, incident: INCIDENT_ID.toString() },
        {
          unsubscribe: unsubscribeUrlFor(SECOND_SUBSCRIBER_ID),
          incident: INCIDENT_ID.toString(),
        },
      ]);
      expect(templateLookups()).toHaveLength(5);
    });

    test("saving the dashboard's Webhook starter unchanged keeps the default payload", async () => {
      templates = {
        [StatusPageSubscriberNotificationMethod.Webhook]: template(
          getDefaultSubscriberNotificationTemplate(
            EVENT,
            StatusPageSubscriberNotificationMethod.Webhook,
          )!.body,
        ),
      };

      await runJob();

      expect(sentWebhooks()).toEqual([expectedDefaultPayload()]);
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("every template variable is provided", () => {
    test("the expected values cover exactly the documented variables", () => {
      expect(Object.keys(expectedVariables()).sort()).toEqual(
        [...ALL_VARIABLE_NAMES].sort(),
      );
      expect(ALL_VARIABLE_NAMES).toEqual(
        expect.arrayContaining([
          "statusPageId",
          "incidentId",
          "incidentNumber",
        ]),
      );
    });

    test("in a custom Email template and subject (with custom SMTP)", async () => {
      useStatusPages([statusPage({ withSmtpConfig: true })]);
      templates = {
        [StatusPageSubscriberNotificationMethod.Email]: template(
          EVERY_VARIABLE_TEXT_TEMPLATE,
          "{{incidentNumber}} / {{incidentId}} / {{statusPageId}}",
        ),
      };

      await runJob();

      const mail: JSONObject = sentMail()[0]!;
      const body: string = (mail["vars"] as JSONObject)["body"] as string;

      expect(mail["templateType"]).toBe(EmailTemplateType.BlankTemplate);
      expect(body).not.toContain("{{");
      expect(body).toBe(everyVariableText(expectedVariables()));
      expect(body).toContain(`statusPageId=[${STATUS_PAGE_ID.toString()}]`);
      expect(body).toContain(`incidentId=[${INCIDENT_ID.toString()}]`);
      expect(body).toContain("incidentNumber=[7]");
      expect(mail["subject"]).toBe(
        `7 / ${INCIDENT_ID.toString()} / ${STATUS_PAGE_ID.toString()}`,
      );
      expect(secondArgs(MailService.sendMail)[0]).toEqual({
        mailServer: { smtp: "custom" },
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        incidentId: INCIDENT_ID,
      });
    });

    test("in a custom SMS template (with custom Twilio), using the plain-text description", async () => {
      useStatusPages([statusPage({ withCallSmsConfig: true })]);
      templates = {
        [StatusPageSubscriberNotificationMethod.SMS]: template(
          EVERY_VARIABLE_TEXT_TEMPLATE,
        ),
      };

      await runJob();

      expect(sentSms()[0]).not.toContain("{{");
      expect(sentSms()[0]).toBe(
        everyVariableText(
          expectedVariables({ incidentDescription: DESCRIPTION_TEXT }),
        ),
      );
      expect(secondArgs(SmsService.sendSms)[0]!["customTwilioConfig"]).toEqual({
        twilio: "custom",
      });
    });

    test("in a custom Slack template", async () => {
      templates = {
        [StatusPageSubscriberNotificationMethod.Slack]: template(
          EVERY_VARIABLE_TEXT_TEMPLATE,
        ),
      };

      await runJob();

      expect(sentSlack()[0]).not.toContain("{{");
      expect(sentSlack()[0]).toBe(everyVariableText(expectedVariables()));
      expect(SlackUtil.convertMarkdownToSlackRichText).toHaveBeenCalledWith(
        everyVariableText(expectedVariables()),
      );
    });

    test("in a custom Microsoft Teams template", async () => {
      templates = {
        [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: template(
          EVERY_VARIABLE_TEXT_TEMPLATE,
        ),
      };

      await runJob();

      expect(sentTeams()[0]).not.toContain("{{");
      expect(sentTeams()[0]).toBe(everyVariableText(expectedVariables()));
    });

    test("in a custom Webhook template", async () => {
      templates = {
        [StatusPageSubscriberNotificationMethod.Webhook]: template(
          everyVariableWebhookTemplate(),
        ),
      };

      await runJob();

      expect(logger.warn).not.toHaveBeenCalled();
      expect(JSON.stringify(sentWebhooks()[0])).not.toContain("{{");
      expect(sentWebhooks()[0]).toEqual(expectedVariables());
    });

    test("in every channel at once, for a second subscriber on a second status page", async () => {
      const pages: Array<StatusPage> = [
        statusPage({ withSmtpConfig: true, withCallSmsConfig: true }),
        statusPage({
          id: SECOND_STATUS_PAGE_ID,
          withSmtpConfig: true,
          withCallSmsConfig: true,
        }),
      ];
      useStatusPages(pages);
      mock(StatusPageSubscriberService.getSubscribersByStatusPage)
        .mockResolvedValueOnce([subscriber()] as never)
        .mockResolvedValueOnce([subscriber(SECOND_SUBSCRIBER_ID)] as never);
      templates = {
        [StatusPageSubscriberNotificationMethod.Email]: template(
          EVERY_VARIABLE_TEXT_TEMPLATE,
        ),
        [StatusPageSubscriberNotificationMethod.SMS]: template(
          EVERY_VARIABLE_TEXT_TEMPLATE,
        ),
        [StatusPageSubscriberNotificationMethod.Slack]: template(
          EVERY_VARIABLE_TEXT_TEMPLATE,
        ),
        [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: template(
          EVERY_VARIABLE_TEXT_TEMPLATE,
        ),
        [StatusPageSubscriberNotificationMethod.Webhook]: template(
          everyVariableWebhookTemplate(),
        ),
      };

      await runJob();

      const second: Record<string, string> = expectedVariables({
        statusPageId: SECOND_STATUS_PAGE_ID.toString(),
        unsubscribeUrl: unsubscribeUrlFor(SECOND_SUBSCRIBER_ID),
      });

      expect(sentMail()[1]!["vars"]).toEqual({
        body: everyVariableText(second),
      });
      expect(sentSms()[1]).toBe(
        everyVariableText({
          ...second,
          incidentDescription: DESCRIPTION_TEXT,
        }),
      );
      expect(sentSlack()[1]).toBe(everyVariableText(second));
      expect(sentTeams()[1]).toBe(everyVariableText(second));
      expect(sentWebhooks()[1]).toEqual(second);
    });

    test("fills an empty incident number when the incident has none", async () => {
      pendingIncidents = [
        incident({ withoutNumber: true, withoutNumberPrefix: true }),
      ];
      templates = {
        [StatusPageSubscriberNotificationMethod.Slack]: template(
          "#{{incidentNumber}}#",
        ),
        [StatusPageSubscriberNotificationMethod.Webhook]: template(
          everyVariableWebhookTemplate(),
        ),
      };

      await runJob();

      expect(sentSlack()).toEqual(["##"]);
      expect(sentWebhooks()[0]).toEqual(
        expectedVariables({ incidentNumber: "" }),
      );
    });
  });

  describe("custom Email and SMS templates", () => {
    test("uses the default email when the status page has no custom SMTP server", async () => {
      templates = {
        [StatusPageSubscriberNotificationMethod.Email]: template(
          "<p>{{incidentTitle}}</p>",
          "Custom subject",
        ),
      };

      await runJob();

      expect(sentMail()[0]!["templateType"]).toBe(
        EmailTemplateType.SubscriberIncidentCreated,
      );
      expect(sentMail()[0]!["subject"]).toBe(`[Incident] ${INCIDENT_TITLE}`);
    });

    test("falls back to the default subject when the custom email template has none", async () => {
      useStatusPages([statusPage({ withSmtpConfig: true })]);
      templates = {
        [StatusPageSubscriberNotificationMethod.Email]: template(
          "<p>{{incidentTitle}}: {{incidentDescription}}</p>",
        ),
      };

      await runJob();

      expect(sentMail()).toEqual([
        {
          toEmail: expect.anything(),
          templateType: EmailTemplateType.BlankTemplate,
          vars: { body: `<p>${INCIDENT_TITLE}: ${INCIDENT_DESCRIPTION}</p>` },
          subject: `[Incident] ${INCIDENT_TITLE}`,
        },
      ]);
    });

    test("uses the default SMS when the status page has no custom Twilio config", async () => {
      templates = {
        [StatusPageSubscriberNotificationMethod.SMS]: template(
          "Custom {{incidentTitle}}",
        ),
      };

      await runJob();

      expect(sentSms()[0]).toBe(
        dashboardDefault(StatusPageSubscriberNotificationMethod.SMS),
      );
    });
  });

  describe("failure isolation", () => {
    test("a rejected webhook send does not stop other channels or fail the incident", async () => {
      const failure: Error = new Error("webhook endpoint down");
      mock(
        StatusPageSubscriberWebhookUtil.sendWebhookNotification,
      ).mockRejectedValue(failure as never);

      await runJob();

      expect(sentMail()).toHaveLength(1);
      expect(sentSms()).toHaveLength(1);
      expect(sentSlack()).toHaveLength(1);
      expect(sentTeams()).toHaveLength(1);
      expect(sentWebhooks()).toHaveLength(1);
      expect(logger.error).toHaveBeenCalledWith(failure, {});
      expect(feedItems()[0]!["displayColor"]).toBe(Blue500);
      expect(
        statusDataFor(INCIDENT_ID)[statusDataFor(INCIDENT_ID).length - 1],
      ).toEqual({
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Success,
        subscriberNotificationStatusMessage: SUCCESS_MESSAGE,
      });
    });

    test("a rejected Microsoft Teams send does not stop the webhook or fail the incident", async () => {
      const failure: Error = new Error("teams webhook gone");
      mock(
        MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
      ).mockRejectedValue(failure as never);
      templates = {
        [StatusPageSubscriberNotificationMethod.Webhook]: template(
          '{ "id": "{{incidentId}}" }',
        ),
      };

      await runJob();

      expect(sentTeams()).toHaveLength(1);
      expect(sentWebhooks()).toEqual([{ id: INCIDENT_ID.toString() }]);
      expect(logger.error).toHaveBeenCalledWith(failure, {});
      expect(
        statusDataFor(INCIDENT_ID)[statusDataFor(INCIDENT_ID).length - 1]![
          "subscriberNotificationStatusOnIncidentCreated"
        ],
      ).toBe(StatusPageSubscriberNotificationStatus.Success);
    });

    test("rejected email, SMS and Slack sends are logged and the webhook still goes out", async () => {
      mock(MailService.sendMail).mockRejectedValue(
        new Error("smtp down") as never,
      );
      mock(SmsService.sendSms).mockRejectedValue(
        new Error("twilio down") as never,
      );
      mock(SlackUtil.sendMessageToChannelViaIncomingWebhook).mockRejectedValue(
        new Error("slack down") as never,
      );

      await runJob();

      expect(sentWebhooks()).toEqual([expectedDefaultPayload()]);
      expect(logger.error).toHaveBeenCalledWith(new Error("smtp down"), {});
      expect(logger.error).toHaveBeenCalledWith(new Error("twilio down"), {});
      expect(logger.error).toHaveBeenCalledWith(new Error("slack down"), {});
      expect(
        statusDataFor(INCIDENT_ID)[statusDataFor(INCIDENT_ID).length - 1]![
          "subscriberNotificationStatusOnIncidentCreated"
        ],
      ).toBe(StatusPageSubscriberNotificationStatus.Success);
    });

    test("a webhook send that throws for one subscriber does not stop the next subscriber", async () => {
      mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mockResolvedValue([
        subscriber(),
        subscriber(SECOND_SUBSCRIBER_ID),
      ] as never);
      mock(
        StatusPageSubscriberWebhookUtil.sendWebhookNotification,
      ).mockImplementationOnce(() => {
        throw new Error("webhook client crashed");
      });

      await runJob();

      expect(sentMail()).toHaveLength(2);
      expect(sentTeams()).toHaveLength(2);
      expect(sentWebhooks()).toEqual([
        expectedDefaultPayload(),
        expectedDefaultPayload({
          root: { unsubscribeUrl: unsubscribeUrlFor(SECOND_SUBSCRIBER_ID) },
        }),
      ]);
      expect(logger.error).toHaveBeenCalledWith(
        new Error("webhook client crashed"),
      );
      expect(
        statusDataFor(INCIDENT_ID)[statusDataFor(INCIDENT_ID).length - 1]![
          "subscriberNotificationStatusOnIncidentCreated"
        ],
      ).toBe(StatusPageSubscriberNotificationStatus.Success);
    });
  });
});
