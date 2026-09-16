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
import { Blue500 } from "Common/Types/BrandColors";
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
 * Incident postmortem subscriber notifications. These tests drive one tick of
 * the job against fakes for every service and check what subscribers receive
 * on each channel, which templates are looked up, which status columns are
 * written, and what lands in the incident feed.
 *
 * The Webhook template compiler (StatusPageSubscriberWebhookTemplate) is the
 * real one, so a custom Webhook template is compiled exactly as in production.
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
  return { __esModule: true, default: { findAllBy: jest.fn() } };
});

jest.mock("Common/Server/Types/Database/QueryHelper", () => {
  return { __esModule: true, default: { any: jest.fn() } };
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
    Service: { getSubscriberEmailFooterText: jest.fn() },
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
  return { __esModule: true, default: { toTwilioConfig: jest.fn() } };
});

jest.mock("Common/Server/Services/ProjectSmtpConfigService", () => {
  return { __esModule: true, default: { toEmailServer: jest.fn() } };
});

jest.mock("Common/Server/Types/Markdown", () => {
  return {
    __esModule: true,
    MarkdownContentType: { Email: "Email" },
    default: { convertToHTML: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Workspace/Slack/Slack", () => {
  return {
    __esModule: true,
    default: {
      sendMessageToChannelViaIncomingWebhook: jest.fn(),
      convertMarkdownToSlackRichText: jest.fn(),
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
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectSmtpConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import SmsService from "Common/Server/Services/SmsService";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import StatusPageService, {
  Service as StatusPageServiceType,
} from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Markdown from "Common/Server/Types/Markdown";
import logger from "Common/Server/Utils/Logger";
import StatusPageResourceUtil from "Common/Server/Utils/StatusPageResource";
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
import StatusPageSubscriberWebhookTemplate from "Common/Server/Utils/StatusPageSubscriberWebhookTemplate";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import { getDefaultSubscriberNotificationTemplate } from "../../../../FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateDefaults";
import "../../../../FeatureSet/Workers/Jobs/Incident/SendPostmortemNotificationToSubscribers";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const JOB_NAME: string = "Incident:SendPostmortemNotificationToSubscribers";

const EVENT: StatusPageSubscriberNotificationEventType =
  StatusPageSubscriberNotificationEventType.SubscriberIncidentPostmortemPublished;

const VARIABLE_NAMES: Array<string> =
  SubscriberNotificationTemplateVariables.getVariableNames(EVENT);

const ALL_METHODS: Array<StatusPageSubscriberNotificationMethod> = [
  StatusPageSubscriberNotificationMethod.Email,
  StatusPageSubscriberNotificationMethod.SMS,
  StatusPageSubscriberNotificationMethod.Slack,
  StatusPageSubscriberNotificationMethod.MicrosoftTeams,
  StatusPageSubscriberNotificationMethod.Webhook,
];

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
const LOGO_FILE_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);

const STATUS_PAGE_URL: string = "https://status.acme.com";
const DETAILS_URL: string = `${STATUS_PAGE_URL}/incidents/${INCIDENT_ID.toString()}`;
const DASHBOARD_URL: string = "https://oneuptime.acme.com/dashboard/incident/7";
const SLACK_URL: string = "https://hooks.slack.com/services/T000/B000/XXXX";
const TEAMS_URL: string = "https://outlook.office.com/webhook/abc";
const WEBHOOK_URL: string = "https://hooks.acme.com/status";
const EMAIL_ADDRESS: string = "customer@example.com";
const PHONE_NUMBER: string = "+15555550100";

const INCIDENT_TITLE: string = "Checkout requests failing";
const SEVERITY: string = "Critical";
const RESOURCES: string = "Checkout API";
const POSTMORTEM_NOTE: string =
  "A **bad deploy** broke checkout.\nWe rolled it back.";
const POSTMORTEM_HTML: string =
  "<p>A <strong>bad deploy</strong> broke checkout.</p><p>We rolled it back.</p>";
const FOOTER_TEXT: string = "Footer text";
const SMTP_SERVER: JSONObject = { hostname: "smtp.acme.com" };
const TWILIO_CONFIG: JSONObject = { accountSid: "AC-custom" };

// Awkward text for the JSON escaping checks.
const TRICKY_TITLE: string = 'Checkout "EU" \\ failing';
const TRICKY_NOTE: string =
  'Line one\nLine "two" in C:\\deploy\\{braces} with $& and $1\r\n\tdone';
const TRICKY_RESOURCES: string = 'Checkout "API" \\ EU';

function unsubscribeUrlFor(subscriberId: ObjectID): string {
  return `${STATUS_PAGE_URL}/update-subscription/${subscriberId.toString()}`;
}

const UNSUBSCRIBE_URL: string = unsubscribeUrlFor(SUBSCRIBER_ID);

type TemplatesByMethod = Partial<
  Record<
    StatusPageSubscriberNotificationMethod,
    StatusPageSubscriberNotificationTemplate
  >
>;

let pendingIncidents: Array<Incident> = [];
let templates: TemplatesByMethod = {};

function incident(overrides?: {
  id?: ObjectID;
  title?: string;
  postmortemNote?: string;
  showPostmortemOnStatusPage?: boolean;
  notifySubscribersOnPostmortemPublished?: boolean;
  isVisibleOnStatusPage?: boolean;
  withoutMonitors?: boolean;
  withoutSeverity?: boolean;
  withoutIncidentNumber?: boolean;
  withoutNumberPrefix?: boolean;
}): Incident {
  const row: Incident = new Incident();
  row._id = (overrides?.id || INCIDENT_ID).toString();
  row.title = overrides?.title ?? INCIDENT_TITLE;
  row.description = "Payments fail in Europe.";
  row.projectId = PROJECT_ID;
  row.postmortemNote = overrides?.postmortemNote ?? POSTMORTEM_NOTE;
  row.showPostmortemOnStatusPage =
    overrides?.showPostmortemOnStatusPage !== false;
  row.notifySubscribersOnPostmortemPublished =
    overrides?.notifySubscribersOnPostmortemPublished !== false;
  row.isVisibleOnStatusPage = overrides?.isVisibleOnStatusPage !== false;

  if (!overrides?.withoutIncidentNumber) {
    row.incidentNumber = 7;
  }

  if (!overrides?.withoutIncidentNumber && !overrides?.withoutNumberPrefix) {
    row.incidentNumberWithPrefix = "INC-7";
  }

  if (!overrides?.withoutSeverity) {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity.name = SEVERITY;
    row.incidentSeverity = severity;
  }

  if (overrides?.withoutMonitors) {
    row.monitors = [];
  } else {
    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID.toString();
    const monitorWithoutId: Monitor = new Monitor();
    row.monitors = [monitor, monitorWithoutId];
  }

  return row;
}

function statusPage(overrides?: {
  id?: ObjectID;
  showIncidentsOnStatusPage?: boolean;
  withSmtpConfig?: boolean;
  withCallSmsConfig?: boolean;
  withLogo?: boolean;
}): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = (overrides?.id || STATUS_PAGE_ID).toString();
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  page.pageTitle = "Acme Status";
  page.isPublicStatusPage = true;
  page.showIncidentsOnStatusPage =
    overrides?.showIncidentsOnStatusPage !== false;

  if (overrides?.withSmtpConfig) {
    const smtpConfig: ProjectSmtpConfig = new ProjectSmtpConfig();
    smtpConfig._id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    page.smtpConfig = smtpConfig;
  }

  if (overrides?.withCallSmsConfig) {
    const callSmsConfig: ProjectCallSMSConfig = new ProjectCallSMSConfig();
    callSmsConfig._id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    page.callSmsConfig = callSmsConfig;
  }

  if (overrides?.withLogo) {
    page.logoFileId = LOGO_FILE_ID;
  }

  return page;
}

function resource(statusPageId?: ObjectID): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = new ObjectID(
    `cccccccc-cccc-4ccc-8ccc-${(statusPageId || STATUS_PAGE_ID)
      .toString()
      .slice(-12)}`,
  ).toString();
  row.displayName = RESOURCES;

  if (statusPageId) {
    row.statusPageId = statusPageId;
  }

  return row;
}

function subscriber(overrides?: {
  id?: ObjectID;
  withoutId?: boolean;
}): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();

  if (!overrides?.withoutId) {
    row._id = (overrides?.id || SUBSCRIBER_ID).toString();
  }

  row.subscriberEmail = new Email(EMAIL_ADDRESS);
  row.subscriberPhone = new Phone(PHONE_NUMBER);
  row.slackIncomingWebhookUrl = URL.fromString(SLACK_URL);
  row.microsoftTeamsIncomingWebhookUrl = URL.fromString(TEAMS_URL);
  row.subscriberWebhook = URL.fromString(WEBHOOK_URL);
  return row;
}

function useTemplate(
  method: StatusPageSubscriberNotificationMethod,
  templateBody: string,
  emailSubject?: string,
): void {
  const template: StatusPageSubscriberNotificationTemplate =
    new StatusPageSubscriberNotificationTemplate();
  template.templateBody = templateBody;

  if (emailSubject !== undefined) {
    template.emailSubject = emailSubject;
  }

  templates[method] = template;
}

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
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

function statusWrites(): Array<JSONObject> {
  return firstArgs(IncidentService.updateOneById).map(
    (args: JSONObject): JSONObject => {
      return args["data"] as JSONObject;
    },
  );
}

function writesFor(id: ObjectID): Array<JSONObject> {
  return firstArgs(IncidentService.updateOneById)
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

function sentSms(): Array<string> {
  return firstArgs(SmsService.sendSms).map((args: JSONObject): string => {
    return args["message"] as string;
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

function templateLookups(): Array<JSONObject> {
  return firstArgs(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
  );
}

function feedItems(): Array<JSONObject> {
  return firstArgs(IncidentFeedService.createIncidentFeedItem);
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

function everyChannelSentOnce(): void {
  expect(sentMail()).toHaveLength(1);
  expect(sentSms()).toHaveLength(1);
  expect(sentSlack()).toHaveLength(1);
  expect(sentTeams()).toHaveLength(1);
  expect(sentWebhooks()).toHaveLength(1);
}

// What every custom template for this incident and subscriber should receive.
function expectedVariables(
  overrides?: Record<string, string>,
): Record<string, string> {
  return {
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    statusPageId: STATUS_PAGE_ID.toString(),
    unsubscribeUrl: UNSUBSCRIBE_URL,
    resourcesAffected: RESOURCES,
    incidentId: INCIDENT_ID.toString(),
    incidentNumber: "7",
    incidentTitle: INCIDENT_TITLE,
    incidentSeverity: SEVERITY,
    postmortemNote: POSTMORTEM_NOTE,
    detailsUrl: DETAILS_URL,
    ...overrides,
  };
}

function fillTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(
    /{{\s*(\w+)\s*}}/g,
    (_match: string, key: string): string => {
      if (!(key in variables)) {
        throw new Error(`The template uses an unknown variable: ${key}`);
      }
      return variables[key]!;
    },
  );
}

function dashboardStarter(
  method: StatusPageSubscriberNotificationMethod,
): string {
  const body: string | undefined = getDefaultSubscriberNotificationTemplate(
    EVENT,
    method,
  )?.body;

  expect(body).toBeTruthy();

  return body || "";
}

function dashboardDefault(
  method: StatusPageSubscriberNotificationMethod,
  variables?: Record<string, string>,
): string {
  return fillTemplate(
    dashboardStarter(method),
    variables || expectedVariables(),
  );
}

function defaultWebhookPayload(): JSONObject {
  return {
    eventType: "IncidentPostmortemPublished",
    statusPageId: STATUS_PAGE_ID.toString(),
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    unsubscribeUrl: UNSUBSCRIBE_URL,
    data: {
      incidentId: INCIDENT_ID.toString(),
      incidentNumber: "7",
      incidentTitle: INCIDENT_TITLE,
      incidentSeverity: SEVERITY,
      resourcesAffected: RESOURCES,
      postmortemNote: POSTMORTEM_NOTE,
      detailsUrl: DETAILS_URL,
    },
  };
}

// A text template that names every documented variable, one per line.
function everyVariableTextTemplate(): string {
  return VARIABLE_NAMES.map((name: string): string => {
    return `${name}=[{{${name}}}]`;
  }).join("\n");
}

function everyVariableText(variables: Record<string, string>): string {
  return VARIABLE_NAMES.map((name: string): string => {
    return `${name}=[${variables[name]}]`;
  }).join("\n");
}

// A Webhook template that names every documented variable as a JSON string.
function everyVariableWebhookTemplate(): string {
  const entries: string = VARIABLE_NAMES.map((name: string): string => {
    return `  "${name}": "{{${name}}}"`;
  }).join(",\n");

  return `{\n${entries}\n}`;
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setImmediate(resolve);
  });
}

async function runJob(): Promise<void> {
  expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
  await mockCapturedJobs[JOB_NAME]!();
  await flushPromises();
}

beforeEach(() => {
  jest.resetAllMocks();

  pendingIncidents = [incident()];
  templates = {};

  mock(IncidentService.findAllBy).mockImplementation(
    async (): Promise<Array<Incident>> => {
      return pendingIncidents;
    },
  );
  mock(IncidentService.updateOneById).mockResolvedValue(1 as never);
  mock(IncidentService.getIncidentLinkInDashboard).mockResolvedValue(
    URL.fromString(DASHBOARD_URL) as never,
  );
  mock(IncidentFeedService.createIncidentFeedItem).mockResolvedValue(
    undefined as never,
  );

  mock(QueryHelper.any).mockImplementation((values: unknown): JSONObject => {
    return { anyOf: values as Array<ObjectID> };
  });
  mock(StatusPageResourceService.findAllBy).mockResolvedValue([
    resource(STATUS_PAGE_ID),
  ] as never);
  mock(StatusPageResourceUtil.getResourcesGroupedByGroupName).mockReturnValue(
    RESOURCES,
  );

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
    (_statusPageUrl: unknown, subscriberId: unknown): URL => {
      return URL.fromString(unsubscribeUrlFor(subscriberId as ObjectID));
    },
  );
  mock(StatusPageService.getStatusPageURL).mockResolvedValue(
    STATUS_PAGE_URL as never,
  );
  mock(StatusPageServiceType.getSubscriberEmailFooterText).mockReturnValue(
    FOOTER_TEXT,
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

  mock(Markdown.convertToHTML).mockResolvedValue(POSTMORTEM_HTML as never);

  mock(ProjectSmtpConfigService.toEmailServer).mockImplementation(
    (config: unknown): JSONObject | undefined => {
      return config ? SMTP_SERVER : undefined;
    },
  );
  mock(ProjectCallSMSConfigService.toTwilioConfig).mockImplementation(
    (config: unknown): JSONObject | undefined => {
      return config ? TWILIO_CONFIG : undefined;
    },
  );

  mock(MailService.sendMail).mockResolvedValue(undefined as never);
  mock(SmsService.sendSms).mockResolvedValue(undefined as never);
  mock(SlackUtil.convertMarkdownToSlackRichText).mockImplementation(
    (text: unknown): string => {
      return text as string;
    },
  );
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
  describe("finding incidents", () => {
    test("registers the cron job", () => {
      expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
    });

    test("looks only for incidents with a pending postmortem notification and selects what the messages need", async () => {
      await runJob();

      expect(IncidentService.findAllBy).toHaveBeenCalledTimes(1);

      const args: JSONObject = firstArgs(IncidentService.findAllBy)[0]!;

      expect(args["query"]).toEqual({
        subscriberNotificationStatusOnPostmortemPublished:
          StatusPageSubscriberNotificationStatus.Pending,
      });
      expect(args["props"]).toEqual({ isRoot: true });
      expect(args["select"]).toEqual(
        expect.objectContaining({
          _id: true,
          title: true,
          projectId: true,
          postmortemNote: true,
          incidentNumber: true,
          incidentNumberWithPrefix: true,
          isVisibleOnStatusPage: true,
          showPostmortemOnStatusPage: true,
          notifySubscribersOnPostmortemPublished: true,
          monitors: { _id: true },
          incidentSeverity: { name: true },
        }),
      );
    });

    test("does nothing when no incident is pending", async () => {
      pendingIncidents = [];

      await runJob();

      nothingSent();
      expect(IncidentService.updateOneById).not.toHaveBeenCalled();
      expect(IncidentFeedService.createIncidentFeedItem).not.toHaveBeenCalled();
    });
  });

  describe("status bookkeeping and skip paths", () => {
    test("marks the notification InProgress and then Success, without hooks", async () => {
      await runJob();

      everyChannelSentOnce();
      expect(statusWrites()).toEqual([
        {
          subscriberNotificationStatusOnPostmortemPublished:
            StatusPageSubscriberNotificationStatus.InProgress,
        },
        {
          subscriberNotificationStatusOnPostmortemPublished:
            StatusPageSubscriberNotificationStatus.Success,
          subscriberNotificationStatusMessageOnPostmortemPublished:
            "Notifications sent successfully to all subscribers",
        },
      ]);

      for (const args of firstArgs(IncidentService.updateOneById)) {
        expect((args["id"] as ObjectID).toString()).toBe(
          INCIDENT_ID.toString(),
        );
        expect(args["props"]).toEqual({ isRoot: true, ignoreHooks: true });
      }
    });

    test.each([
      {
        name: "the postmortem is not shown on the status page",
        overrides: { showPostmortemOnStatusPage: false },
        message:
          "Incident is not set to show postmortem on status page. Skipping notifications to subscribers.",
      },
      {
        name: "subscribers should not be notified about the postmortem",
        overrides: { notifySubscribersOnPostmortemPublished: false },
        message:
          "Incident is not set to notify subscribers on postmortem published. Skipping notifications to subscribers.",
      },
      {
        name: "the incident has no monitors",
        overrides: { withoutMonitors: true },
        message:
          "No monitors are attached to this incident. Skipping notifications to subscribers.",
      },
    ])(
      "marks the notification Skipped when $name",
      async (data: {
        name: string;
        overrides: Parameters<typeof incident>[0];
        message: string;
      }) => {
        pendingIncidents = [incident(data.overrides)];

        await runJob();

        nothingSent();
        expect(statusWrites()).toEqual([
          {
            subscriberNotificationStatusOnPostmortemPublished:
              StatusPageSubscriberNotificationStatus.Skipped,
            subscriberNotificationStatusMessageOnPostmortemPublished:
              data.message,
          },
        ]);
        expect(firstArgs(IncidentService.updateOneById)[0]!["props"]).toEqual({
          isRoot: true,
          ignoreHooks: true,
        });
        expect(StatusPageResourceService.findAllBy).not.toHaveBeenCalled();
        expect(
          IncidentFeedService.createIncidentFeedItem,
        ).not.toHaveBeenCalled();
      },
    );

    test("marks the notification Skipped after InProgress when the incident is not visible on the status page", async () => {
      pendingIncidents = [incident({ isVisibleOnStatusPage: false })];

      await runJob();

      nothingSent();
      expect(statusWrites()).toEqual([
        {
          subscriberNotificationStatusOnPostmortemPublished:
            StatusPageSubscriberNotificationStatus.InProgress,
        },
        {
          subscriberNotificationStatusOnPostmortemPublished:
            StatusPageSubscriberNotificationStatus.Skipped,
          subscriberNotificationStatusMessageOnPostmortemPublished:
            "Incident is not visible on status page. Skipping notifications to subscribers.",
        },
      ]);
      expect(StatusPageResourceService.findAllBy).not.toHaveBeenCalled();
      expect(IncidentFeedService.createIncidentFeedItem).not.toHaveBeenCalled();
    });

    test("sends nothing on a status page that hides incidents but still records success", async () => {
      mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mockResolvedValue([
        statusPage({ showIncidentsOnStatusPage: false }),
      ] as never);

      await runJob();

      nothingSent();
      expect(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).not.toHaveBeenCalled();
      expect(templateLookups()).toHaveLength(0);
      expect(feedItems()).toHaveLength(1);
      expect(statusWrites()[statusWrites().length - 1]).toEqual({
        subscriberNotificationStatusOnPostmortemPublished:
          StatusPageSubscriberNotificationStatus.Success,
        subscriberNotificationStatusMessageOnPostmortemPublished:
          "Notifications sent successfully to all subscribers",
      });
    });

    test("sends nothing to a subscriber whose preferences exclude the incident", async () => {
      mock(StatusPageSubscriberService.shouldSendNotification).mockReturnValue(
        false,
      );

      await runJob();

      nothingSent();
      expect(
        statusWrites()[statusWrites().length - 1]![
          "subscriberNotificationStatusOnPostmortemPublished"
        ],
      ).toBe(StatusPageSubscriberNotificationStatus.Success);
    });

    test("checks subscriber preferences against the status page's resources for an incident event", async () => {
      await runJob();

      const args: JSONObject = firstArgs(
        StatusPageSubscriberService.shouldSendNotification,
      )[0]!;

      expect((args["subscriber"] as unknown as StatusPageSubscriber)._id).toBe(
        SUBSCRIBER_ID.toString(),
      );
      expect((args["statusPage"] as unknown as StatusPage)._id).toBe(
        STATUS_PAGE_ID.toString(),
      );
      expect(
        (args["statusPageResources"] as unknown as Array<StatusPageResource>)
          .length,
      ).toBe(1);
      expect(args["eventType"]).toBe(StatusPageEventType.Incident);
    });

    test("ignores a subscriber without an id", async () => {
      mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mockResolvedValue([subscriber({ withoutId: true })] as never);

      await runJob();

      nothingSent();
      expect(
        StatusPageSubscriberService.shouldSendNotification,
      ).not.toHaveBeenCalled();
    });

    test("renders the postmortem to HTML once per incident, not per subscriber", async () => {
      mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mockResolvedValue([
        subscriber(),
        subscriber({ id: SECOND_SUBSCRIBER_ID }),
      ] as never);

      await runJob();

      expect(sentMail()).toHaveLength(2);
      expect(Markdown.convertToHTML).toHaveBeenCalledTimes(1);
      expect(Markdown.convertToHTML).toHaveBeenCalledWith(
        POSTMORTEM_NOTE,
        "Email",
      );
    });

    test("marks the notification Failed with the reason when preparing it breaks", async () => {
      mock(Markdown.convertToHTML).mockRejectedValue(
        new Error("markdown exploded") as never,
      );

      await runJob();

      nothingSent();
      expect(statusWrites()[statusWrites().length - 1]).toEqual({
        subscriberNotificationStatusOnPostmortemPublished:
          StatusPageSubscriberNotificationStatus.Failed,
        subscriberNotificationStatusMessageOnPostmortemPublished:
          "markdown exploded",
      });
      expect(firstArgs(IncidentService.updateOneById).pop()!["props"]).toEqual({
        isRoot: true,
        ignoreHooks: true,
      });
      expect(IncidentFeedService.createIncidentFeedItem).not.toHaveBeenCalled();
    });

    test("marks the notification Failed when the incident feed item cannot be written", async () => {
      mock(IncidentFeedService.createIncidentFeedItem).mockRejectedValue(
        new Error("feed unavailable") as never,
      );

      await runJob();

      everyChannelSentOnce();
      expect(statusWrites()[statusWrites().length - 1]).toEqual({
        subscriberNotificationStatusOnPostmortemPublished:
          StatusPageSubscriberNotificationStatus.Failed,
        subscriberNotificationStatusMessageOnPostmortemPublished:
          "feed unavailable",
      });
    });

    test("logs, and does not throw, when even the Failed status cannot be written", async () => {
      mock(Markdown.convertToHTML).mockRejectedValue(
        new Error("markdown exploded") as never,
      );
      mock(IncidentService.updateOneById).mockImplementation(
        async (args: unknown): Promise<number> => {
          const data: JSONObject = (args as { data: JSONObject }).data;

          if (
            data["subscriberNotificationStatusOnPostmortemPublished"] ===
            StatusPageSubscriberNotificationStatus.Failed
          ) {
            throw new Error("database down");
          }

          return 1;
        },
      );

      await expect(runJob()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        `Failed to update incident ${INCIDENT_ID.toString()} status after error: database down`,
        expect.objectContaining({ incidentId: INCIDENT_ID.toString() }),
      );
    });

    test("records the notification in the incident feed", async () => {
      await runJob();

      expect(feedItems()).toHaveLength(1);

      const item: JSONObject = feedItems()[0]!;

      expect((item["incidentId"] as ObjectID).toString()).toBe(
        INCIDENT_ID.toString(),
      );
      expect((item["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(item["incidentFeedEventType"]).toBe(
        IncidentFeedEventType.SubscriberNotificationSent,
      );
      expect(item["displayColor"]).toBe(Blue500);
      expect(item["feedInfoInMarkdown"]).toContain(
        `**Subscriber Incident Postmortem Notification Sent for [Incident INC-7](${DASHBOARD_URL})**`,
      );
      expect(item["feedInfoInMarkdown"]).toContain(
        "because postmortem was published for this incident.",
      );
      expect(item["workspaceNotification"]).toEqual({
        sendWorkspaceNotification: false,
      });
    });

    test("names the incident by number in the feed when it has no prefix", async () => {
      pendingIncidents = [incident({ withoutNumberPrefix: true })];

      await runJob();

      expect(feedItems()[0]!["feedInfoInMarkdown"]).toContain(
        `[Incident #7](${DASHBOARD_URL})`,
      );
    });

    test("handles each incident on its own in a multi-incident tick", async () => {
      pendingIncidents = [
        incident({ showPostmortemOnStatusPage: false }),
        incident({ id: SECOND_INCIDENT_ID }),
      ];

      await runJob();

      expect(writesFor(INCIDENT_ID)).toEqual([
        {
          subscriberNotificationStatusOnPostmortemPublished:
            StatusPageSubscriberNotificationStatus.Skipped,
          subscriberNotificationStatusMessageOnPostmortemPublished:
            "Incident is not set to show postmortem on status page. Skipping notifications to subscribers.",
        },
      ]);
      expect(
        writesFor(SECOND_INCIDENT_ID).map((write: JSONObject): unknown => {
          return write["subscriberNotificationStatusOnPostmortemPublished"];
        }),
      ).toEqual([
        StatusPageSubscriberNotificationStatus.InProgress,
        StatusPageSubscriberNotificationStatus.Success,
      ]);
      everyChannelSentOnce();
    });

    test("keeps going after one incident fails", async () => {
      pendingIncidents = [incident(), incident({ id: SECOND_INCIDENT_ID })];
      mock(Markdown.convertToHTML).mockRejectedValueOnce(
        new Error("markdown exploded") as never,
      );

      await runJob();

      expect(writesFor(INCIDENT_ID).pop()).toEqual({
        subscriberNotificationStatusOnPostmortemPublished:
          StatusPageSubscriberNotificationStatus.Failed,
        subscriberNotificationStatusMessageOnPostmortemPublished:
          "markdown exploded",
      });
      expect(
        writesFor(SECOND_INCIDENT_ID).pop()![
          "subscriberNotificationStatusOnPostmortemPublished"
        ],
      ).toBe(StatusPageSubscriberNotificationStatus.Success);
      everyChannelSentOnce();
    });
  });

  describe("finding status pages and subscribers", () => {
    test("looks up status page resources for the incident's monitors that have an id", async () => {
      await runJob();

      const monitorIds: Array<string> = (
        mock(QueryHelper.any).mock.calls[0]![0] as Array<ObjectID>
      ).map((id: ObjectID): string => {
        return id.toString();
      });

      expect(monitorIds).toEqual([MONITOR_ID.toString()]);

      const args: JSONObject = firstArgs(
        StatusPageResourceService.findAllBy,
      )[0]!;

      expect((args["query"] as JSONObject)["monitorId"]).toBe(
        mock(QueryHelper.any).mock.results[0]!.value,
      );
      expect(args["props"]).toEqual({ isRoot: true, ignoreHooks: true });
    });

    test("notifies the status pages that show the incident's resources", async () => {
      mock(StatusPageResourceService.findAllBy).mockResolvedValue([
        resource(STATUS_PAGE_ID),
        resource(),
        resource(SECOND_STATUS_PAGE_ID),
      ] as never);

      await runJob();

      const statusPageIds: Array<string> = (
        mock(StatusPageSubscriberService.getStatusPagesToSendNotification).mock
          .calls[0]![0] as Array<ObjectID>
      ).map((id: ObjectID): string => {
        return id.toString();
      });

      expect(statusPageIds).toEqual([
        STATUS_PAGE_ID.toString(),
        SECOND_STATUS_PAGE_ID.toString(),
      ]);
    });

    test("describes only the resources on each status page", async () => {
      mock(StatusPageResourceService.findAllBy).mockResolvedValue([
        resource(STATUS_PAGE_ID),
        resource(SECOND_STATUS_PAGE_ID),
      ] as never);

      await runJob();

      const groupedResources: Array<Array<StatusPageResource>> = mock(
        StatusPageResourceUtil.getResourcesGroupedByGroupName,
      ).mock.calls.map((call: Array<unknown>): Array<StatusPageResource> => {
        return call[0] as Array<StatusPageResource>;
      });

      expect(groupedResources).toHaveLength(1);
      expect(groupedResources[0]!).toHaveLength(1);
      expect(groupedResources[0]![0]!.statusPageId?.toString()).toBe(
        STATUS_PAGE_ID.toString(),
      );
    });

    test("keeps notifying other status pages when one fails", async () => {
      mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mockResolvedValue([
        statusPage(),
        statusPage({ id: SECOND_STATUS_PAGE_ID }),
      ] as never);
      mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mockImplementation(
        async (statusPageId: unknown): Promise<Array<StatusPageSubscriber>> => {
          if (
            (statusPageId as ObjectID).toString() === STATUS_PAGE_ID.toString()
          ) {
            throw new Error("subscribers unavailable");
          }
          return [subscriber()];
        },
      );

      await runJob();

      everyChannelSentOnce();
      expect(sentWebhooks()[0]!["statusPageId"]).toBe(
        SECOND_STATUS_PAGE_ID.toString(),
      );
      expect(statusWrites().pop()).toEqual({
        subscriberNotificationStatusOnPostmortemPublished:
          StatusPageSubscriberNotificationStatus.Success,
        subscriberNotificationStatusMessageOnPostmortemPublished:
          "Notifications sent successfully to all subscribers",
      });
    });

    test("keeps notifying other subscribers when one fails", async () => {
      mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mockResolvedValue([
        subscriber(),
        subscriber({ id: SECOND_SUBSCRIBER_ID }),
      ] as never);
      mock(StatusPageSubscriberService.getUnsubscribeLink).mockImplementation(
        (_statusPageUrl: unknown, subscriberId: unknown): URL => {
          if (
            (subscriberId as ObjectID).toString() === SUBSCRIBER_ID.toString()
          ) {
            throw new Error("bad subscriber");
          }
          return URL.fromString(unsubscribeUrlFor(subscriberId as ObjectID));
        },
      );

      await runJob();

      everyChannelSentOnce();
      expect(sentWebhooks()[0]!["unsubscribeUrl"]).toBe(
        unsubscribeUrlFor(SECOND_SUBSCRIBER_ID),
      );
      expect(
        statusWrites().pop()![
          "subscriberNotificationStatusOnPostmortemPublished"
        ],
      ).toBe(StatusPageSubscriberNotificationStatus.Success);
    });
  });

  describe("with no custom templates", () => {
    test("emails the postmortem template with the rendered postmortem", async () => {
      await runJob();

      expect(sentMail()).toHaveLength(1);

      const mail: JSONObject = sentMail()[0]!;

      expect((mail["toEmail"] as unknown as Email).toString()).toBe(
        EMAIL_ADDRESS,
      );
      expect(mail["templateType"]).toBe(
        EmailTemplateType.SubscriberIncidentPostmortemCreated,
      );
      expect(mail["subject"]).toBe(`[Postmortem] ${INCIDENT_TITLE}`);
      expect(mail["vars"]).toEqual({
        statusPageName: "Acme Status",
        statusPageUrl: STATUS_PAGE_URL,
        detailsUrl: DETAILS_URL,
        logoUrl: "",
        isPublicStatusPage: "true",
        resourcesAffected: RESOURCES,
        incidentSeverity: SEVERITY,
        incidentTitle: INCIDENT_TITLE,
        postmortemNote: POSTMORTEM_HTML,
        unsubscribeUrl: UNSUBSCRIBE_URL,
        subscriberEmailNotificationFooterText: FOOTER_TEXT,
      });

      const options: JSONObject = secondArgs(MailService.sendMail)[0]!;

      expect(options["mailServer"]).toBeUndefined();
      expect((options["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect((options["statusPageId"] as ObjectID).toString()).toBe(
        STATUS_PAGE_ID.toString(),
      );
      expect((options["incidentId"] as ObjectID).toString()).toBe(
        INCIDENT_ID.toString(),
      );
    });

    test("links the status page logo in the default email when there is one", async () => {
      mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mockResolvedValue([statusPage({ withLogo: true })] as never);

      await runJob();

      const logoUrl: string = (sentMail()[0]!["vars"] as JSONObject)[
        "logoUrl"
      ] as string;

      expect(logoUrl.startsWith("https://oneuptime.acme.com/")).toBe(true);
      expect(logoUrl.endsWith(`/logo/${STATUS_PAGE_ID.toString()}`)).toBe(true);
    });

    test("sends the default email through the status page's own SMTP server when it has one", async () => {
      mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mockResolvedValue([statusPage({ withSmtpConfig: true })] as never);

      await runJob();

      expect(sentMail()[0]!["templateType"]).toBe(
        EmailTemplateType.SubscriberIncidentPostmortemCreated,
      );
      expect(secondArgs(MailService.sendMail)[0]!["mailServer"]).toEqual(
        SMTP_SERVER,
      );
    });

    test("texts the default SMS, matching the dashboard starter", async () => {
      await runJob();

      expect(sentSms()).toEqual([
        `Postmortem: ${INCIDENT_TITLE} (${SEVERITY}) on Acme Status. Impact: ${RESOURCES}. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
      ]);
      expect(sentSms()[0]).toBe(
        dashboardDefault(StatusPageSubscriberNotificationMethod.SMS),
      );

      const sms: JSONObject = firstArgs(SmsService.sendSms)[0]!;
      const options: JSONObject = secondArgs(SmsService.sendSms)[0]!;

      expect((sms["to"] as unknown as Phone).toString()).toBe(PHONE_NUMBER);
      expect(options["customTwilioConfig"]).toBeUndefined();
      expect((options["statusPageId"] as ObjectID).toString()).toBe(
        STATUS_PAGE_ID.toString(),
      );
      expect((options["incidentId"] as ObjectID).toString()).toBe(
        INCIDENT_ID.toString(),
      );
    });

    test("posts the default Slack message, matching the dashboard starter", async () => {
      await runJob();

      expect(sentSlack()).toEqual([
        dashboardDefault(StatusPageSubscriberNotificationMethod.Slack),
      ]);
      expect(sentSlack()[0]).toContain(`**Postmortem:** ${POSTMORTEM_NOTE}`);
      expect(
        firstArgs(SlackUtil.sendMessageToChannelViaIncomingWebhook)[0]![
          "url"
        ]!.toString(),
      ).toBe(SLACK_URL);
    });

    test("posts the default Teams message, matching the dashboard starter, without Slack formatting", async () => {
      mock(SlackUtil.convertMarkdownToSlackRichText).mockImplementation(
        (text: unknown): string => {
          return `slack-rich-text:${text as string}`;
        },
      );

      await runJob();

      expect(sentTeams()).toEqual([
        dashboardDefault(StatusPageSubscriberNotificationMethod.MicrosoftTeams),
      ]);
      expect(
        firstArgs(
          MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
        )[0]!["url"]!.toString(),
      ).toBe(TEAMS_URL);
      expect(SlackUtil.convertMarkdownToSlackRichText).toHaveBeenCalledTimes(1);
      expect(sentSlack()).toEqual([
        `slack-rich-text:${dashboardDefault(StatusPageSubscriberNotificationMethod.Slack)}`,
      ]);
    });

    test("sends the fixed webhook payload", async () => {
      await runJob();

      expect(sentWebhooks()).toHaveLength(1);

      const payload: JSONObject = sentWebhooks()[0]!;
      const data: JSONObject = payload["data"] as JSONObject;

      expect(Object.keys(payload).sort()).toEqual([
        "data",
        "eventType",
        "statusPageId",
        "statusPageName",
        "statusPageUrl",
        "unsubscribeUrl",
      ]);
      expect(payload["eventType"]).toBe("IncidentPostmortemPublished");
      expect(payload["statusPageId"]).toBe(STATUS_PAGE_ID.toString());
      expect(payload["statusPageName"]).toBe("Acme Status");
      expect(payload["statusPageUrl"]).toBe(STATUS_PAGE_URL);
      expect(payload["unsubscribeUrl"]).toBe(UNSUBSCRIBE_URL);
      expect(Object.keys(data).sort()).toEqual([
        "detailsUrl",
        "incidentId",
        "incidentNumber",
        "incidentSeverity",
        "incidentTitle",
        "postmortemNote",
        "resourcesAffected",
      ]);
      expect(data["incidentId"]).toBe(INCIDENT_ID.toString());
      expect(data["incidentNumber"]).toBe("7");
      expect(data["incidentTitle"]).toBe(INCIDENT_TITLE);
      expect(data["incidentSeverity"]).toBe(SEVERITY);
      expect(data["resourcesAffected"]).toBe(RESOURCES);
      expect(data["postmortemNote"]).toBe(POSTMORTEM_NOTE);
      expect(data["detailsUrl"]).toBe(DETAILS_URL);
      expect(payload).toEqual(defaultWebhookPayload());

      expect(
        firstArgs(StatusPageSubscriberWebhookUtil.sendWebhookNotification)[0]![
          "webhookUrl"
        ]!.toString(),
      ).toBe(WEBHOOK_URL);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    test("the fixed webhook payload is what the dashboard Webhook starter compiles to", async () => {
      await runJob();

      const starter: string = dashboardStarter(
        StatusPageSubscriberNotificationMethod.Webhook,
      );

      expect(
        StatusPageSubscriberWebhookTemplate.compile(
          starter,
          expectedVariables(),
        ),
      ).toEqual(sentWebhooks()[0]);
      expect(
        StatusPageSubscriberWebhookTemplate.compile(
          starter,
          expectedVariables(),
        ),
      ).toEqual(defaultWebhookPayload());
    });

    test("saving the dashboard Webhook starter as a template leaves the payload unchanged", async () => {
      useTemplate(
        StatusPageSubscriberNotificationMethod.Webhook,
        dashboardStarter(StatusPageSubscriberNotificationMethod.Webhook),
      );

      await runJob();

      expect(sentWebhooks()).toEqual([defaultWebhookPayload()]);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    test("keeps the default webhook payload's empty fallbacks", async () => {
      pendingIncidents = [
        incident({
          withoutSeverity: true,
          withoutIncidentNumber: true,
          postmortemNote: "",
        }),
      ];

      await runJob();

      const data: JSONObject = sentWebhooks()[0]!["data"] as JSONObject;

      expect(data["incidentSeverity"]).toBe("");
      expect(data["incidentNumber"]).toBe("");
      expect(data["postmortemNote"]).toBe("");
    });

    test("keeps each channel's severity fallback when the incident has none", async () => {
      pendingIncidents = [incident({ withoutSeverity: true })];

      await runJob();

      expect(sentSms()[0]).toContain(`${INCIDENT_TITLE} (-) on Acme Status`);
      expect(sentSlack()[0]).toContain("**Severity:**  - ");
      expect(sentTeams()[0]).toContain("**Severity:**  - ");
      expect((sentMail()[0]!["vars"] as JSONObject)["incidentSeverity"]).toBe(
        " - ",
      );
    });
  });

  describe("template lookups", () => {
    test("looks up one template per channel, including Webhook, for the postmortem event and status page", async () => {
      await runJob();

      const lookups: Array<JSONObject> = templateLookups();

      expect(lookups).toHaveLength(5);
      expect(
        lookups
          .map((lookup: JSONObject): string => {
            return lookup["notificationMethod"] as string;
          })
          .sort(),
      ).toEqual([...ALL_METHODS].sort());

      for (const lookup of lookups) {
        expect(lookup["eventType"]).toBe(EVENT);
        expect((lookup["statusPageId"] as ObjectID).toString()).toBe(
          STATUS_PAGE_ID.toString(),
        );
      }
    });

    test("looks up templates once per status page, not once per subscriber", async () => {
      mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mockResolvedValue([
        subscriber(),
        subscriber({ id: SECOND_SUBSCRIBER_ID }),
        subscriber({
          id: new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
        }),
      ] as never);

      await runJob();

      expect(sentWebhooks()).toHaveLength(3);
      expect(templateLookups()).toHaveLength(5);
    });

    test("looks up each status page's own templates", async () => {
      mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mockResolvedValue([
        statusPage(),
        statusPage({ id: SECOND_STATUS_PAGE_ID }),
      ] as never);

      await runJob();

      const lookups: Array<JSONObject> = templateLookups();

      expect(lookups).toHaveLength(10);

      for (const statusPageId of [STATUS_PAGE_ID, SECOND_STATUS_PAGE_ID]) {
        const methods: Array<string> = lookups
          .filter((lookup: JSONObject): boolean => {
            return (
              (lookup["statusPageId"] as ObjectID).toString() ===
              statusPageId.toString()
            );
          })
          .map((lookup: JSONObject): string => {
            return lookup["notificationMethod"] as string;
          })
          .sort();

        expect(methods).toEqual([...ALL_METHODS].sort());
      }
    });
  });

  describe("with a custom Webhook template", () => {
    test("sends the compiled JSON object instead of the default payload, without needing custom SMTP or SMS settings", async () => {
      useTemplate(
        StatusPageSubscriberNotificationMethod.Webhook,
        `{
  "type": "postmortem",
  "page": "{{statusPageName}}",
  "incident": { "id": "{{incidentId}}", "number": {{incidentNumber}}, "title": "{{incidentTitle}}" },
  "summary": "{{postmortemNote}}",
  "links": ["{{detailsUrl}}", "{{unsubscribeUrl}}"]
}`,
      );

      await runJob();

      expect(sentWebhooks()).toEqual([
        {
          type: "postmortem",
          page: "Acme Status",
          incident: {
            id: INCIDENT_ID.toString(),
            number: 7,
            title: INCIDENT_TITLE,
          },
          summary: POSTMORTEM_NOTE,
          links: [DETAILS_URL, UNSUBSCRIBE_URL],
        },
      ]);
      expect(
        firstArgs(StatusPageSubscriberWebhookUtil.sendWebhookNotification)[0]![
          "webhookUrl"
        ]!.toString(),
      ).toBe(WEBHOOK_URL);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    test("keeps quotes, backslashes and newlines intact", async () => {
      pendingIncidents = [
        incident({ title: TRICKY_TITLE, postmortemNote: TRICKY_NOTE }),
      ];
      mock(
        StatusPageResourceUtil.getResourcesGroupedByGroupName,
      ).mockReturnValue(TRICKY_RESOURCES);
      useTemplate(
        StatusPageSubscriberNotificationMethod.Webhook,
        '{"title": "{{incidentTitle}}", "note": "{{postmortemNote}}", "resources": "{{resourcesAffected}}", "severity": "{{incidentSeverity}}"}',
      );

      await runJob();

      const payload: JSONObject = sentWebhooks()[0]!;
      const expected: JSONObject = {
        title: TRICKY_TITLE,
        note: TRICKY_NOTE,
        resources: TRICKY_RESOURCES,
        severity: SEVERITY,
      };

      expect(payload).toEqual(expected);
      expect(JSON.parse(JSON.stringify(payload))).toEqual(expected);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    test("keeps quotes, backslashes and newlines intact in the default payload too", async () => {
      pendingIncidents = [
        incident({ title: TRICKY_TITLE, postmortemNote: TRICKY_NOTE }),
      ];
      mock(
        StatusPageResourceUtil.getResourcesGroupedByGroupName,
      ).mockReturnValue(TRICKY_RESOURCES);

      await runJob();

      const data: JSONObject = JSON.parse(JSON.stringify(sentWebhooks()[0]!))[
        "data"
      ];

      expect(data["incidentTitle"]).toBe(TRICKY_TITLE);
      expect(data["postmortemNote"]).toBe(TRICKY_NOTE);
      expect(data["resourcesAffected"]).toBe(TRICKY_RESOURCES);
    });

    test.each([
      {
        name: "is not valid JSON",
        templateBody: '{"title": "{{incidentTitle}}",}',
      },
      {
        name: "puts a text variable outside a JSON string",
        templateBody: '{"title": {{incidentTitle}}}',
      },
      {
        name: "is plain text",
        templateBody: "Postmortem for {{incidentTitle}}",
      },
      {
        name: "is a JSON array",
        templateBody: '[{"title": "{{incidentTitle}}"}]',
      },
      {
        name: "is a JSON string",
        templateBody: '"{{incidentTitle}}"',
      },
    ])(
      "falls back to the default payload and warns when the template $name",
      async (data: { name: string; templateBody: string }) => {
        useTemplate(
          StatusPageSubscriberNotificationMethod.Webhook,
          data.templateBody,
        );

        await runJob();

        expect(sentWebhooks()).toEqual([defaultWebhookPayload()]);
        expect(logger.warn).toHaveBeenCalledTimes(1);

        const warning: Array<unknown> = mock(logger.warn).mock.calls[0]!;

        expect(warning[0]).toContain(STATUS_PAGE_ID.toString());
        expect(warning[0]).toContain("IncidentPostmortemPublished");
        expect(warning[1]).toEqual({ statusPageId: STATUS_PAGE_ID.toString() });
        expect(
          statusWrites().pop()![
            "subscriberNotificationStatusOnPostmortemPublished"
          ],
        ).toBe(StatusPageSubscriberNotificationStatus.Success);
      },
    );

    test("sends the default payload without a warning when the template body is empty", async () => {
      useTemplate(StatusPageSubscriberNotificationMethod.Webhook, "");

      await runJob();

      expect(sentWebhooks()).toEqual([defaultWebhookPayload()]);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    test("leaves the other channels on their defaults", async () => {
      useTemplate(
        StatusPageSubscriberNotificationMethod.Webhook,
        '{"custom": "{{incidentTitle}}"}',
      );

      await runJob();

      expect(sentWebhooks()).toEqual([{ custom: INCIDENT_TITLE }]);
      expect(sentMail()[0]!["templateType"]).toBe(
        EmailTemplateType.SubscriberIncidentPostmortemCreated,
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

    test("does not change the Webhook payload when only other channels have custom templates", async () => {
      useTemplate(
        StatusPageSubscriberNotificationMethod.Slack,
        "Slack: {{incidentTitle}}",
      );
      useTemplate(
        StatusPageSubscriberNotificationMethod.MicrosoftTeams,
        "Teams: {{incidentTitle}}",
      );

      await runJob();

      expect(sentSlack()).toEqual([`Slack: ${INCIDENT_TITLE}`]);
      expect(sentTeams()).toEqual([`Teams: ${INCIDENT_TITLE}`]);
      expect(sentWebhooks()).toEqual([defaultWebhookPayload()]);
    });

    test("compiles the template for each subscriber with their own unsubscribe link", async () => {
      mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mockResolvedValue([
        subscriber(),
        subscriber({ id: SECOND_SUBSCRIBER_ID }),
      ] as never);
      useTemplate(
        StatusPageSubscriberNotificationMethod.Webhook,
        '{"unsubscribe": "{{unsubscribeUrl}}"}',
      );

      await runJob();

      expect(sentWebhooks()).toEqual([
        { unsubscribe: unsubscribeUrlFor(SUBSCRIBER_ID) },
        { unsubscribe: unsubscribeUrlFor(SECOND_SUBSCRIBER_ID) },
      ]);
    });

    test("applies the template only on the status page it belongs to", async () => {
      mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mockResolvedValue([
        statusPage(),
        statusPage({ id: SECOND_STATUS_PAGE_ID }),
      ] as never);

      const customTemplate: StatusPageSubscriberNotificationTemplate =
        new StatusPageSubscriberNotificationTemplate();
      customTemplate.templateBody = '{"page": "{{statusPageId}}"}';

      mock(
        StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
      ).mockImplementation(
        async (
          args: unknown,
        ): Promise<StatusPageSubscriberNotificationTemplate | null> => {
          const lookup: JSONObject = args as JSONObject;

          return (lookup["statusPageId"] as ObjectID).toString() ===
            STATUS_PAGE_ID.toString() &&
            lookup["notificationMethod"] ===
              StatusPageSubscriberNotificationMethod.Webhook
            ? customTemplate
            : null;
        },
      );

      await runJob();

      expect(sentWebhooks()).toHaveLength(2);
      expect(sentWebhooks()[0]).toEqual({ page: STATUS_PAGE_ID.toString() });
      expect(sentWebhooks()[1]!["eventType"]).toBe(
        "IncidentPostmortemPublished",
      );
      expect(sentWebhooks()[1]!["statusPageId"]).toBe(
        SECOND_STATUS_PAGE_ID.toString(),
      );
    });
  });

  describe("every template variable is provided", () => {
    test("the expected values cover exactly the documented variables", () => {
      expect(Object.keys(expectedVariables()).sort()).toEqual(
        [...VARIABLE_NAMES].sort(),
      );
      expect(VARIABLE_NAMES).toEqual(
        expect.arrayContaining([
          "statusPageId",
          "incidentId",
          "incidentNumber",
          "postmortemNote",
          "unsubscribeUrl",
        ]),
      );
    });

    test.each([
      {
        method: StatusPageSubscriberNotificationMethod.Email,
        statusPageOverrides: { withSmtpConfig: true },
        sent: (): Array<string> => {
          return sentMail().map((mail: JSONObject): string => {
            expect(mail["templateType"]).toBe(EmailTemplateType.BlankTemplate);
            return (mail["vars"] as JSONObject)["body"] as string;
          });
        },
      },
      {
        method: StatusPageSubscriberNotificationMethod.SMS,
        statusPageOverrides: { withCallSmsConfig: true },
        sent: sentSms,
      },
      {
        method: StatusPageSubscriberNotificationMethod.Slack,
        statusPageOverrides: {},
        sent: sentSlack,
      },
      {
        method: StatusPageSubscriberNotificationMethod.MicrosoftTeams,
        statusPageOverrides: {},
        sent: sentTeams,
      },
    ])(
      "a $method template can use every variable",
      async (data: {
        method: StatusPageSubscriberNotificationMethod;
        statusPageOverrides: Parameters<typeof statusPage>[0];
        sent: () => Array<string>;
      }) => {
        mock(
          StatusPageSubscriberService.getStatusPagesToSendNotification,
        ).mockResolvedValue([statusPage(data.statusPageOverrides)] as never);
        useTemplate(data.method, everyVariableTextTemplate());

        await runJob();

        const messages: Array<string> = data.sent();

        expect(messages).toHaveLength(1);
        expect(messages[0]).not.toContain("{{");
        expect(messages[0]).toBe(everyVariableText(expectedVariables()));
        expect(messages[0]).toContain(
          `statusPageId=[${STATUS_PAGE_ID.toString()}]`,
        );
        expect(messages[0]).toContain(`incidentId=[${INCIDENT_ID.toString()}]`);
        expect(messages[0]).toContain("incidentNumber=[7]");
        expect(messages[0]).toContain(`postmortemNote=[${POSTMORTEM_NOTE}]`);
      },
    );

    test("a custom email subject can use every variable", async () => {
      mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mockResolvedValue([statusPage({ withSmtpConfig: true })] as never);
      useTemplate(
        StatusPageSubscriberNotificationMethod.Email,
        "<p>{{postmortemNote}}</p>",
        everyVariableTextTemplate(),
      );

      await runJob();

      expect(sentMail()[0]!["subject"]).toBe(
        everyVariableText(expectedVariables()),
      );
    });

    test("a Webhook template can use every variable", async () => {
      useTemplate(
        StatusPageSubscriberNotificationMethod.Webhook,
        everyVariableWebhookTemplate(),
      );

      await runJob();

      expect(sentWebhooks()).toEqual([expectedVariables()]);
      expect(JSON.stringify(sentWebhooks()[0])).not.toContain("{{");
      expect(logger.warn).not.toHaveBeenCalled();
    });

    test("an incident without a number gets an empty incidentNumber", async () => {
      pendingIncidents = [incident({ withoutIncidentNumber: true })];
      useTemplate(
        StatusPageSubscriberNotificationMethod.Webhook,
        everyVariableWebhookTemplate(),
      );
      useTemplate(
        StatusPageSubscriberNotificationMethod.Slack,
        everyVariableTextTemplate(),
      );

      await runJob();

      expect(sentWebhooks()).toEqual([
        expectedVariables({ incidentNumber: "" }),
      ]);
      expect(sentSlack()).toEqual([
        everyVariableText(expectedVariables({ incidentNumber: "" })),
      ]);
    });

    test("custom templates keep each channel's severity fallback", async () => {
      pendingIncidents = [incident({ withoutSeverity: true })];
      mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mockResolvedValue([
        statusPage({ withSmtpConfig: true, withCallSmsConfig: true }),
      ] as never);

      for (const method of [
        StatusPageSubscriberNotificationMethod.Email,
        StatusPageSubscriberNotificationMethod.SMS,
        StatusPageSubscriberNotificationMethod.Slack,
        StatusPageSubscriberNotificationMethod.MicrosoftTeams,
      ]) {
        useTemplate(method, "[{{incidentSeverity}}]");
      }
      useTemplate(
        StatusPageSubscriberNotificationMethod.Webhook,
        '{"severity": "{{incidentSeverity}}"}',
      );

      await runJob();

      expect((sentMail()[0]!["vars"] as JSONObject)["body"]).toBe("[ - ]");
      expect(sentSms()).toEqual(["[-]"]);
      expect(sentSlack()).toEqual(["[ - ]"]);
      expect(sentTeams()).toEqual(["[ - ]"]);
      expect(sentWebhooks()).toEqual([{ severity: " - " }]);
    });
  });

  describe("custom template gating", () => {
    test("uses a custom email template only with a custom SMTP server", async () => {
      useTemplate(
        StatusPageSubscriberNotificationMethod.Email,
        "<h1>{{incidentTitle}}</h1>",
        "Postmortem #{{incidentNumber}}: {{incidentTitle}}",
      );

      await runJob();

      expect(sentMail()[0]!["templateType"]).toBe(
        EmailTemplateType.SubscriberIncidentPostmortemCreated,
      );
      expect(sentMail()[0]!["subject"]).toBe(`[Postmortem] ${INCIDENT_TITLE}`);
    });

    test("sends a custom email template through the custom SMTP server", async () => {
      mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mockResolvedValue([statusPage({ withSmtpConfig: true })] as never);
      useTemplate(
        StatusPageSubscriberNotificationMethod.Email,
        "<h1>{{incidentTitle}}</h1>",
        "Postmortem #{{incidentNumber}}: {{incidentTitle}}",
      );

      await runJob();

      expect(sentMail()).toHaveLength(1);
      expect(sentMail()[0]!["templateType"]).toBe(
        EmailTemplateType.BlankTemplate,
      );
      expect(sentMail()[0]!["vars"]).toEqual({
        body: `<h1>${INCIDENT_TITLE}</h1>`,
      });
      expect(sentMail()[0]!["subject"]).toBe(
        `Postmortem #7: ${INCIDENT_TITLE}`,
      );
      expect(secondArgs(MailService.sendMail)[0]!["mailServer"]).toEqual(
        SMTP_SERVER,
      );
    });

    test("falls back to the postmortem subject when the custom email template has none", async () => {
      mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mockResolvedValue([statusPage({ withSmtpConfig: true })] as never);
      useTemplate(
        StatusPageSubscriberNotificationMethod.Email,
        "<h1>{{incidentTitle}}</h1>",
      );

      await runJob();

      expect(sentMail()[0]!["templateType"]).toBe(
        EmailTemplateType.BlankTemplate,
      );
      expect(sentMail()[0]!["subject"]).toBe(`[Postmortem] ${INCIDENT_TITLE}`);
    });

    test("uses a custom SMS template only with a custom SMS configuration", async () => {
      useTemplate(
        StatusPageSubscriberNotificationMethod.SMS,
        "Custom: {{incidentTitle}}",
      );

      await runJob();

      expect(sentSms()).toEqual([
        dashboardDefault(StatusPageSubscriberNotificationMethod.SMS),
      ]);
    });

    test("sends a custom SMS template through the custom SMS configuration", async () => {
      mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mockResolvedValue([statusPage({ withCallSmsConfig: true })] as never);
      useTemplate(
        StatusPageSubscriberNotificationMethod.SMS,
        "Custom: {{incidentTitle}} #{{incidentNumber}}",
      );

      await runJob();

      expect(sentSms()).toEqual([`Custom: ${INCIDENT_TITLE} #7`]);
      expect(secondArgs(SmsService.sendSms)[0]!["customTwilioConfig"]).toEqual(
        TWILIO_CONFIG,
      );
    });

    test("uses custom Slack and Teams templates without any custom configuration", async () => {
      useTemplate(
        StatusPageSubscriberNotificationMethod.Slack,
        "Slack {{incidentId}}",
      );
      useTemplate(
        StatusPageSubscriberNotificationMethod.MicrosoftTeams,
        "Teams {{statusPageId}}",
      );

      await runJob();

      expect(sentSlack()).toEqual([`Slack ${INCIDENT_ID.toString()}`]);
      expect(sentTeams()).toEqual([`Teams ${STATUS_PAGE_ID.toString()}`]);
    });
  });

  describe("delivery failures", () => {
    test("a failed webhook delivery is logged and does not stop other channels or fail the job", async () => {
      const failure: Error = new Error("webhook down");
      mock(
        StatusPageSubscriberWebhookUtil.sendWebhookNotification,
      ).mockRejectedValue(failure as never);

      await runJob();

      everyChannelSentOnce();
      expect(logger.error).toHaveBeenCalledWith(
        failure,
        expect.objectContaining({
          projectId: PROJECT_ID.toString(),
          incidentId: INCIDENT_ID.toString(),
        }),
      );
      expect(statusWrites().pop()).toEqual({
        subscriberNotificationStatusOnPostmortemPublished:
          StatusPageSubscriberNotificationStatus.Success,
        subscriberNotificationStatusMessageOnPostmortemPublished:
          "Notifications sent successfully to all subscribers",
      });
      expect(feedItems()).toHaveLength(1);
    });

    test("a failed Teams delivery is logged and does not stop other channels or fail the job", async () => {
      const failure: Error = new Error("teams down");
      mock(
        MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
      ).mockRejectedValue(failure as never);

      await runJob();

      everyChannelSentOnce();
      expect(logger.error).toHaveBeenCalledWith(
        failure,
        expect.objectContaining({ incidentId: INCIDENT_ID.toString() }),
      );
      expect(
        statusWrites().pop()![
          "subscriberNotificationStatusOnPostmortemPublished"
        ],
      ).toBe(StatusPageSubscriberNotificationStatus.Success);
    });

    test("a failed webhook delivery to one subscriber does not stop the next", async () => {
      mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mockResolvedValue([
        subscriber(),
        subscriber({ id: SECOND_SUBSCRIBER_ID }),
      ] as never);
      mock(
        StatusPageSubscriberWebhookUtil.sendWebhookNotification,
      ).mockRejectedValueOnce(new Error("webhook down") as never);

      await runJob();

      expect(sentWebhooks()).toHaveLength(2);
      expect(sentWebhooks()[1]!["unsubscribeUrl"]).toBe(
        unsubscribeUrlFor(SECOND_SUBSCRIBER_ID),
      );
      expect(sentMail()).toHaveLength(2);
      expect(
        statusWrites().pop()![
          "subscriberNotificationStatusOnPostmortemPublished"
        ],
      ).toBe(StatusPageSubscriberNotificationStatus.Success);
    });

    test.each([
      {
        channel: "email",
        fn: (): unknown => {
          return MailService.sendMail;
        },
      },
      {
        channel: "SMS",
        fn: (): unknown => {
          return SmsService.sendSms;
        },
      },
      {
        channel: "Slack",
        fn: (): unknown => {
          return SlackUtil.sendMessageToChannelViaIncomingWebhook;
        },
      },
    ])(
      "a failed $channel delivery does not stop the webhook",
      async (data: { channel: string; fn: () => unknown }) => {
        mock(data.fn()).mockRejectedValue(new Error("down") as never);

        await runJob();

        expect(sentWebhooks()).toEqual([defaultWebhookPayload()]);
        expect(
          statusWrites().pop()![
            "subscriberNotificationStatusOnPostmortemPublished"
          ],
        ).toBe(StatusPageSubscriberNotificationStatus.Success);
      },
    );
  });
});
