import Incident from "Common/Models/DatabaseModels/Incident";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberWebhookTemplate from "Common/Server/Utils/StatusPageSubscriberWebhookTemplate";
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
import SubscriberNotificationTemplateChannels from "Common/Types/StatusPage/SubscriberNotificationTemplateChannels";
import SubscriberNotificationTemplateVariables from "Common/Types/StatusPage/SubscriberNotificationTemplateVariables";

/*
 * Incident state change subscriber notifications. These tests drive one tick
 * of the job against fakes and check which timelines are skipped and why, what
 * every channel sends with and without custom templates, that each channel's
 * custom template receives every documented variable, and what lands in the
 * incident feed and the timeline's status columns.
 *
 * The Webhook template compiler is the real one, so a Webhook template is
 * compiled here exactly as it is in production.
 *
 * The incident and timeline fakes behave like the database they stand in for:
 * each row is projected through the select the job asked for, so a column the
 * job forgets to select arrives undefined here for the same reason it would in
 * production.
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
    default: { toTwilioConfig: jest.fn() },
  };
});

jest.mock("Common/Server/Services/ProjectSmtpConfigService", () => {
  return {
    __esModule: true,
    default: { toEmailServer: jest.fn() },
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
import IncidentStateTimelineService from "Common/Server/Services/IncidentStateTimelineService";
import MailService from "Common/Server/Services/MailService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectSmtpConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import SmsService from "Common/Server/Services/SmsService";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import logger from "Common/Server/Utils/Logger";
import StatusPageResourceUtil from "Common/Server/Utils/StatusPageResource";
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import { getDefaultSubscriberNotificationTemplate } from "../../../../FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateDefaults";
import "../../../../FeatureSet/Workers/Jobs/IncidentStateTimeline/SendNotificationToSubscribers";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const JOB: string = "IncidentStateTimeline:SendNotificationToSubscribers";

const EVENT: StatusPageSubscriberNotificationEventType =
  StatusPageSubscriberNotificationEventType.SubscriberIncidentStateChanged;

const VARIABLE_NAMES: Array<string> =
  SubscriberNotificationTemplateVariables.getVariableNames(EVENT);

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SECOND_STATUS_PAGE_ID: ObjectID = new ObjectID(
  "23232323-2323-4323-8323-232323232323",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const SECOND_TIMELINE_ID: ObjectID = new ObjectID(
  "45454545-4545-4545-8545-454545454545",
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
const LOGO_FILE_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

const STATUS_PAGE_URL: string = "https://status.acme.com";
const DETAILS_URL: string = `${STATUS_PAGE_URL}/incidents/${INCIDENT_ID.toString()}`;
const DASHBOARD_URL: string = "https://oneuptime.acme.com/dashboard/incident/1";
const SUBSCRIBER_WEBHOOK_URL: string = "https://hooks.acme.com/status";
const SLACK_WEBHOOK_URL: string =
  "https://hooks.slack.com/services/T000/B000/XXXX";
const TEAMS_WEBHOOK_URL: string = "https://outlook.office.com/webhook/abc";

const INCIDENT_TITLE: string = "Checkout requests failing";
const INCIDENT_DESCRIPTION: string =
  "Payments **fail** for cards issued in Europe.";
const SEVERITY: string = "Critical";
const STATE_NAME: string = "Resolved";
const RESOURCES: string = "Checkout API";

const SUCCESS_MESSAGE: string =
  "Notifications sent successfully to all subscribers";

let pendingTimelines: Array<IncidentStateTimeline> = [];
let storedIncident: Incident | null = null;

function unsubscribeUrlFor(subscriberId: ObjectID): string {
  return `${STATUS_PAGE_URL}/update-subscription/${subscriberId.toString()}`;
}

const UNSUBSCRIBE_URL: string = unsubscribeUrlFor(SUBSCRIBER_ID);

function project<T>(row: T, select: JSONObject, create: () => T): T {
  const projected: T = create();

  for (const key of Object.keys(select)) {
    if (select[key]) {
      (projected as unknown as Record<string, unknown>)[key] = (
        row as unknown as Record<string, unknown>
      )[key];
    }
  }

  return projected;
}

function timeline(overrides?: {
  id?: ObjectID;
  withoutIncidentId?: boolean;
  withoutIncidentStateId?: boolean;
  stateName?: string;
  isCreatedState?: boolean;
}): IncidentStateTimeline {
  const row: IncidentStateTimeline = new IncidentStateTimeline();
  row._id = (overrides?.id || TIMELINE_ID).toString();
  row.projectId = PROJECT_ID;

  if (!overrides?.withoutIncidentId) {
    row.incidentId = INCIDENT_ID;
  }

  if (!overrides?.withoutIncidentStateId) {
    row.incidentStateId = INCIDENT_STATE_ID;
  }

  const state: IncidentState = new IncidentState();
  state.name =
    overrides?.stateName !== undefined ? overrides.stateName : STATE_NAME;
  state.isCreatedState = Boolean(overrides?.isCreatedState);
  row.incidentState = state;

  return row;
}

function incident(overrides?: {
  isVisibleOnStatusPage?: boolean;
  withoutMonitors?: boolean;
  withoutNumberPrefix?: boolean;
  title?: string;
  description?: string;
  bare?: boolean;
}): Incident {
  const row: Incident = new Incident();
  row._id = INCIDENT_ID.toString();
  row.title = overrides?.title !== undefined ? overrides.title : INCIDENT_TITLE;
  row.projectId = PROJECT_ID;
  row.isVisibleOnStatusPage = overrides?.isVisibleOnStatusPage !== false;

  // A "bare" incident has only what the job cannot work without.
  if (!overrides?.bare) {
    row.description =
      overrides?.description !== undefined
        ? overrides.description
        : INCIDENT_DESCRIPTION;
    row.incidentNumber = 7;

    if (!overrides?.withoutNumberPrefix) {
      row.incidentNumberWithPrefix = "INC-7";
    }

    const severity: IncidentSeverity = new IncidentSeverity();
    severity.name = SEVERITY;
    row.incidentSeverity = severity;
  }

  if (!overrides?.withoutMonitors) {
    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID.toString();
    row.monitors = [monitor];
  } else {
    row.monitors = [];
  }

  return row;
}

function statusPage(overrides?: {
  id?: ObjectID;
  showIncidentsOnStatusPage?: boolean;
  withSmtpConfig?: boolean;
  withCallSmsConfig?: boolean;
  withLogo?: boolean;
  isPublicStatusPage?: boolean;
}): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = (overrides?.id || STATUS_PAGE_ID).toString();
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  page.pageTitle = "Acme Status";
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
    page.logoFileId = LOGO_FILE_ID;
  }

  return page;
}

function resource(statusPageId: ObjectID): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = ObjectID.generate().toString();
  row.statusPageId = statusPageId;
  row.displayName = RESOURCES;
  return row;
}

function subscriber(overrides?: {
  id?: ObjectID;
  withoutId?: boolean;
  webhookOnly?: boolean;
}): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();

  if (!overrides?.withoutId) {
    row._id = (overrides?.id || SUBSCRIBER_ID).toString();
  }

  row.subscriberWebhook = URL.fromString(SUBSCRIBER_WEBHOOK_URL);

  if (!overrides?.webhookOnly) {
    row.subscriberEmail = new Email("customer@example.com");
    row.subscriberPhone = new Phone("+15555550100");
    row.slackIncomingWebhookUrl = URL.fromString(SLACK_WEBHOOK_URL);
    row.microsoftTeamsIncomingWebhookUrl = URL.fromString(TEAMS_WEBHOOK_URL);
  }

  return row;
}

interface TemplateFixture {
  templateBody: string;
  emailSubject?: string;
}

function useTemplates(
  templates: Partial<
    Record<StatusPageSubscriberNotificationMethod, TemplateFixture>
  >,
): void {
  mock(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
  ).mockImplementation(
    async (
      args: unknown,
    ): Promise<StatusPageSubscriberNotificationTemplate | null> => {
      const method: StatusPageSubscriberNotificationMethod = (
        args as { notificationMethod: StatusPageSubscriberNotificationMethod }
      ).notificationMethod;
      const fixture: TemplateFixture | undefined = templates[method];

      if (!fixture) {
        return null;
      }

      const row: StatusPageSubscriberNotificationTemplate =
        new StatusPageSubscriberNotificationTemplate();
      row.templateBody = fixture.templateBody;

      if (fixture.emailSubject) {
        row.emailSubject = fixture.emailSubject;
      }

      return row;
    },
  );
}

function useStatusPages(pages: Array<StatusPage>): void {
  mock(
    StatusPageSubscriberService.getStatusPagesToSendNotification,
  ).mockResolvedValue(pages as never);
}

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
}

function callArgs(fn: unknown, index: number = 0): Array<JSONObject> {
  return mock(fn).mock.calls.map((call: Array<unknown>): JSONObject => {
    return call[index] as JSONObject;
  });
}

function statusWrites(): Array<JSONObject> {
  return callArgs(IncidentStateTimelineService.updateOneById).map(
    (args: JSONObject): JSONObject => {
      return args["data"] as JSONObject;
    },
  );
}

function writesFor(id: ObjectID): Array<JSONObject> {
  return callArgs(IncidentStateTimelineService.updateOneById)
    .filter((args: JSONObject): boolean => {
      return (args["id"] as ObjectID).toString() === id.toString();
    })
    .map((args: JSONObject): JSONObject => {
      return args["data"] as JSONObject;
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

function succeeded(): Array<JSONObject> {
  return inProgressThen({
    subscriberNotificationStatus:
      StatusPageSubscriberNotificationStatus.Success,
    subscriberNotificationStatusMessage: SUCCESS_MESSAGE,
  });
}

function sentMail(): Array<JSONObject> {
  return callArgs(MailService.sendMail);
}

function sentSms(): Array<string> {
  return callArgs(SmsService.sendSms).map((sms: JSONObject): string => {
    return sms["message"] as string;
  });
}

function sentSlack(): Array<string> {
  return callArgs(SlackUtil.sendMessageToChannelViaIncomingWebhook).map(
    (args: JSONObject): string => {
      return args["text"] as string;
    },
  );
}

function sentTeams(): Array<string> {
  return callArgs(
    MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
  ).map((args: JSONObject): string => {
    return args["text"] as string;
  });
}

function sentWebhooks(): Array<JSONObject> {
  return callArgs(StatusPageSubscriberWebhookUtil.sendWebhookNotification).map(
    (args: JSONObject): JSONObject => {
      return args["payload"] as JSONObject;
    },
  );
}

function templateLookups(): Array<JSONObject> {
  return callArgs(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
  );
}

function feedItems(): Array<JSONObject> {
  return callArgs(IncidentFeedService.createIncidentFeedItem);
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

// The values the job has for the default fixtures, by template variable.
function expectedVariables(): Record<string, string> {
  return {
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    statusPageId: STATUS_PAGE_ID.toString(),
    unsubscribeUrl: UNSUBSCRIBE_URL,
    resourcesAffected: RESOURCES,
    incidentId: INCIDENT_ID.toString(),
    incidentNumber: "7",
    incidentTitle: INCIDENT_TITLE,
    incidentDescription: INCIDENT_DESCRIPTION,
    incidentSeverity: SEVERITY,
    incidentState: STATE_NAME,
    detailsUrl: DETAILS_URL,
  };
}

function dashboardStarter(
  method: StatusPageSubscriberNotificationMethod,
): string {
  const starter: string =
    getDefaultSubscriberNotificationTemplate(EVENT, method)?.body || "";
  expect(starter).not.toBe("");
  return starter;
}

function dashboardDefault(
  method: StatusPageSubscriberNotificationMethod,
): string {
  const variables: Record<string, string> = expectedVariables();

  return dashboardStarter(method).replace(
    /{{\s*(\w+)\s*}}/g,
    (_match: string, key: string): string => {
      return variables[key] ?? "";
    },
  );
}

// A text template that names every documented variable, one per line.
function everyVariableTemplate(): string {
  return VARIABLE_NAMES.map((name: string): string => {
    return `${name}=[{{${name}}}]`;
  }).join("\n");
}

function everyVariableText(): string {
  const variables: Record<string, string> = expectedVariables();

  return VARIABLE_NAMES.map((name: string): string => {
    return `${name}=[${variables[name]}]`;
  }).join("\n");
}

// A Webhook template that maps every documented variable to a JSON key.
function everyVariableWebhookTemplate(): string {
  return `{\n${VARIABLE_NAMES.map((name: string): string => {
    return `  "${name}": "{{${name}}}"`;
  }).join(",\n")}\n}`;
}

function everyVariableObject(): JSONObject {
  const variables: Record<string, string> = expectedVariables();
  const result: JSONObject = {};

  for (const name of VARIABLE_NAMES) {
    result[name] = variables[name]!;
  }

  return result;
}

function defaultWebhookPayload(): JSONObject {
  return {
    eventType: "IncidentStateChanged",
    statusPageId: STATUS_PAGE_ID.toString(),
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    unsubscribeUrl: UNSUBSCRIBE_URL,
    data: {
      incidentId: INCIDENT_ID.toString(),
      incidentNumber: "7",
      incidentTitle: INCIDENT_TITLE,
      incidentSeverity: SEVERITY,
      incidentState: STATE_NAME,
      resourcesAffected: RESOURCES,
      detailsUrl: DETAILS_URL,
    },
  };
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
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

  pendingTimelines = [timeline()];
  storedIncident = incident();

  mock(IncidentStateTimelineService.findBy).mockImplementation(
    async (args: unknown): Promise<Array<IncidentStateTimeline>> => {
      const select: JSONObject = (args as { select: JSONObject }).select;

      return pendingTimelines.map(
        (row: IncidentStateTimeline): IncidentStateTimeline => {
          return project(row, select, (): IncidentStateTimeline => {
            return new IncidentStateTimeline();
          });
        },
      );
    },
  );
  mock(IncidentStateTimelineService.updateOneById).mockResolvedValue(
    1 as never,
  );

  mock(IncidentService.findOneById).mockImplementation(
    async (args: unknown): Promise<Incident | null> => {
      if (!storedIncident) {
        return null;
      }

      return project(
        storedIncident,
        (args as { select: JSONObject }).select,
        (): Incident => {
          return new Incident();
        },
      );
    },
  );
  mock(IncidentService.getIncidentLinkInDashboard).mockResolvedValue(
    URL.fromString(DASHBOARD_URL) as never,
  );
  mock(IncidentFeedService.createIncidentFeedItem).mockResolvedValue(
    undefined as never,
  );

  mock(StatusPageResourceService.findByMonitors).mockResolvedValue([
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

  useStatusPages([statusPage()]);
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
  useTemplates({});

  mock(ProjectCallSMSConfigService.toTwilioConfig).mockImplementation(
    (config: unknown): JSONObject | undefined => {
      return config ? { twilio: "custom" } : undefined;
    },
  );
  mock(ProjectSmtpConfigService.toEmailServer).mockImplementation(
    (config: unknown): JSONObject | undefined => {
      return config ? { smtp: "custom" } : undefined;
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

describe("IncidentStateTimeline:SendNotificationToSubscribers bookkeeping", () => {
  test("is registered as a cron job", () => {
    expect(mockCapturedJobs[JOB]).toBeDefined();
  });

  test("picks up only pending timelines whose author asked to notify subscribers", async () => {
    pendingTimelines = [];

    await runJob();

    const args: JSONObject = callArgs(IncidentStateTimelineService.findBy)[0]!;

    expect(args["query"]).toEqual({
      subscriberNotificationStatus:
        StatusPageSubscriberNotificationStatus.Pending,
      shouldStatusPageSubscribersBeNotified: true,
    });
    expect(args["select"]).toEqual(
      expect.objectContaining({
        _id: true,
        projectId: true,
        incidentId: true,
        incidentStateId: true,
        incidentState: { name: true, isCreatedState: true },
      }),
    );
  });

  test("does nothing when no timeline is pending", async () => {
    pendingTimelines = [];

    await runJob();

    expect(IncidentStateTimelineService.updateOneById).not.toHaveBeenCalled();
    expect(IncidentService.findOneById).not.toHaveBeenCalled();
    expect(feedItems()).toEqual([]);
    nothingSent();
  });

  test("reads the incident columns the templates need, including its description", async () => {
    await runJob();

    const args: JSONObject = callArgs(IncidentService.findOneById)[0]!;

    expect((args["id"] as ObjectID).toString()).toBe(INCIDENT_ID.toString());
    expect(args["select"]).toEqual(
      expect.objectContaining({
        _id: true,
        title: true,
        description: true,
        projectId: true,
        incidentSeverity: { name: true },
        isVisibleOnStatusPage: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
      }),
    );
  });

  interface SkipCase {
    title: string;
    arrange: () => void;
    message: string;
    readsIncident: boolean;
  }

  const skipCases: Array<SkipCase> = [
    {
      title: "the timeline has no incident",
      arrange: (): void => {
        pendingTimelines = [timeline({ withoutIncidentId: true })];
      },
      message:
        "Missing incident or incident state reference. Skipping notifications.",
      readsIncident: false,
    },
    {
      title: "the timeline has no incident state",
      arrange: (): void => {
        pendingTimelines = [timeline({ withoutIncidentStateId: true })];
      },
      message:
        "Missing incident or incident state reference. Skipping notifications.",
      readsIncident: false,
    },
    {
      title: "the incident state has no name",
      arrange: (): void => {
        pendingTimelines = [timeline({ stateName: "" })];
      },
      message: "Incident state has no name. Skipping notifications.",
      readsIncident: false,
    },
    {
      title: "the new state is the created state",
      arrange: (): void => {
        pendingTimelines = [timeline({ isCreatedState: true })];
      },
      message:
        "Notification already sent when the incident was created. So, incident state change notifiction is skipped.",
      readsIncident: false,
    },
    {
      title: "the incident no longer exists",
      arrange: (): void => {
        storedIncident = null;
      },
      message: "Related incident not found. Skipping notifications.",
      readsIncident: true,
    },
    {
      title: "the incident has no monitors",
      arrange: (): void => {
        storedIncident = incident({ withoutMonitors: true });
      },
      message:
        "No monitors are attached to the related incident. Skipping notifications.",
      readsIncident: true,
    },
    {
      title: "the incident is not visible on status pages",
      arrange: (): void => {
        storedIncident = incident({ isVisibleOnStatusPage: false });
      },
      message:
        "Incident is not visible on status page. Skipping notifications.",
      readsIncident: true,
    },
  ];

  test.each(skipCases)(
    "marks the timeline Skipped when $title",
    async (skipCase: SkipCase) => {
      skipCase.arrange();

      await runJob();

      nothingSent();
      expect(statusWrites()).toEqual(
        inProgressThen({
          subscriberNotificationStatus:
            StatusPageSubscriberNotificationStatus.Skipped,
          subscriberNotificationStatusMessage: skipCase.message,
        }),
      );
      expect(feedItems()).toEqual([]);
      expect(StatusPageResourceService.findByMonitors).not.toHaveBeenCalled();
      expect(IncidentService.findOneById).toHaveBeenCalledTimes(
        skipCase.readsIncident ? 1 : 0,
      );
    },
  );

  test("records progress and then success on the timeline", async () => {
    await runJob();

    expect(statusWrites()).toEqual(succeeded());

    for (const args of callArgs(IncidentStateTimelineService.updateOneById)) {
      expect((args["id"] as ObjectID).toString()).toBe(TIMELINE_ID.toString());
      // Without hooks, so a status write never queues the timeline again.
      expect(args["props"]).toEqual({ isRoot: true, ignoreHooks: true });
    }
  });

  test("records in the incident feed that subscribers were notified", async () => {
    await runJob();

    expect(IncidentService.getIncidentLinkInDashboard).toHaveBeenCalledTimes(1);
    const linkArgs: Array<unknown> = mock(
      IncidentService.getIncidentLinkInDashboard,
    ).mock.calls[0]!;
    expect((linkArgs[0] as ObjectID).toString()).toBe(PROJECT_ID.toString());
    expect((linkArgs[1] as ObjectID).toString()).toBe(INCIDENT_ID.toString());

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
    expect(item["feedInfoInMarkdown"]).toBe(
      `📧 **Status Page Subscribers have been notified** about the state change of the [Incident INC-7](${DASHBOARD_URL}) to **${STATE_NAME}**`,
    );
    expect(item["workspaceNotification"]).toEqual({
      sendWorkspaceNotification: true,
    });
  });

  test("falls back to the incident number in the feed when there is no prefix", async () => {
    storedIncident = incident({ withoutNumberPrefix: true });

    await runJob();

    expect(feedItems()[0]!["feedInfoInMarkdown"]).toContain(
      `[Incident #7](${DASHBOARD_URL})`,
    );
  });

  test("records in the feed when a status page hides incidents, and still succeeds", async () => {
    useStatusPages([statusPage({ showIncidentsOnStatusPage: false })]);

    await runJob();

    nothingSent();
    expect(
      StatusPageSubscriberService.getSubscribersByStatusPage,
    ).not.toHaveBeenCalled();
    expect(templateLookups()).toEqual([]);
    expect(feedItems()).toHaveLength(1);
    expect(feedItems()[0]).toEqual(
      expect.objectContaining({
        displayColor: Yellow500,
        feedInfoInMarkdown: `📧 **No notification sent to subscribers** for the state change of [Incident INC-7](${DASHBOARD_URL}) to **${STATE_NAME}**`,
        moreInformationInMarkdown:
          "Subscriber notifications were skipped because all associated status pages either hide incidents or had no matching subscribers.",
        workspaceNotification: { sendWorkspaceNotification: false },
      }),
    );
    expect(statusWrites()).toEqual(succeeded());
  });

  test("records in the feed when no subscriber wants incident updates", async () => {
    mock(StatusPageSubscriberService.shouldSendNotification).mockReturnValue(
      false,
    );

    await runJob();

    nothingSent();
    expect(feedItems()[0]!["displayColor"]).toBe(Yellow500);
    expect(statusWrites()).toEqual(succeeded());
  });

  test("asks whether each subscriber wants this status page's incident resources", async () => {
    await runJob();

    const args: JSONObject = callArgs(
      StatusPageSubscriberService.shouldSendNotification,
    )[0]!;

    expect((args["subscriber"] as StatusPageSubscriber).id?.toString()).toBe(
      SUBSCRIBER_ID.toString(),
    );
    expect(
      (args["statusPageResources"] as Array<StatusPageResource>).map(
        (row: StatusPageResource): string | undefined => {
          return row.statusPageId?.toString();
        },
      ),
    ).toEqual([STATUS_PAGE_ID.toString()]);
    expect(args["eventType"]).toBe(StatusPageEventType.Incident);
  });

  test("skips a subscriber without an id", async () => {
    mock(
      StatusPageSubscriberService.getSubscribersByStatusPage,
    ).mockResolvedValue([subscriber({ withoutId: true })] as never);

    await runJob();

    nothingSent();
    expect(feedItems()[0]!["displayColor"]).toBe(Yellow500);
  });

  test("handles every pending timeline in one tick", async () => {
    pendingTimelines = [
      timeline({ withoutIncidentId: true }),
      timeline({ id: SECOND_TIMELINE_ID }),
    ];

    await runJob();

    expect(writesFor(TIMELINE_ID)).toEqual(
      inProgressThen({
        subscriberNotificationStatus:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessage:
          "Missing incident or incident state reference. Skipping notifications.",
      }),
    );
    expect(writesFor(SECOND_TIMELINE_ID)).toEqual(succeeded());
    expect(sentMail()).toHaveLength(1);
    expect(sentWebhooks()).toHaveLength(1);
  });
});

describe("IncidentStateTimeline:SendNotificationToSubscribers without custom templates", () => {
  test("emails the incident state changed template", async () => {
    await runJob();

    expect(sentMail()).toHaveLength(1);
    const mail: JSONObject = sentMail()[0]!;

    expect((mail["toEmail"] as Email).toString()).toBe("customer@example.com");
    expect(mail["templateType"]).toBe(
      EmailTemplateType.SubscriberIncidentStateChanged,
    );
    expect(mail["subject"]).toBe(`[${STATE_NAME} Incident] ${INCIDENT_TITLE}`);
    expect(mail["vars"]).toEqual({
      emailTitle: `Incident on ${RESOURCES} is ${STATE_NAME}`,
      statusPageName: "Acme Status",
      statusPageUrl: STATUS_PAGE_URL,
      detailsUrl: DETAILS_URL,
      logoUrl: "",
      isPublicStatusPage: "true",
      resourcesAffected: RESOURCES,
      incidentSeverity: SEVERITY,
      incidentTitle: INCIDENT_TITLE,
      incidentState: STATE_NAME,
      unsubscribeUrl: UNSUBSCRIBE_URL,
      subscriberEmailNotificationFooterText: "Footer text",
    });

    const options: JSONObject = callArgs(MailService.sendMail, 1)[0]!;
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

  test("links the status page logo and marks private pages in the default email", async () => {
    useStatusPages([statusPage({ withLogo: true, isPublicStatusPage: false })]);

    await runJob();

    const vars: JSONObject = sentMail()[0]!["vars"] as JSONObject;
    expect(vars["logoUrl"]).toBe(
      `https://oneuptime.acme.com/status-page-api/logo/${STATUS_PAGE_ID.toString()}`,
    );
    expect(vars["isPublicStatusPage"]).toBe("false");
  });

  test("leaves the resources out of the email title when none are named", async () => {
    mock(StatusPageResourceUtil.getResourcesGroupedByGroupName).mockReturnValue(
      "",
    );

    await runJob();

    const mail: JSONObject = sentMail()[0]!;
    expect((mail["vars"] as JSONObject)["emailTitle"]).toBe(
      `Incident is ${STATE_NAME}`,
    );
    expect((mail["vars"] as JSONObject)["resourcesAffected"]).toBe("None");
  });

  test("sends the SMS the dashboard shows as the SMS starter", async () => {
    await runJob();

    expect(sentSms()).toEqual([
      `Incident ${INCIDENT_TITLE} on Acme Status is ${STATE_NAME}. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
    ]);
    expect(sentSms()[0]).toBe(
      dashboardDefault(StatusPageSubscriberNotificationMethod.SMS),
    );

    const sms: JSONObject = callArgs(SmsService.sendSms)[0]!;
    expect((sms["to"] as Phone).toString()).toBe("+15555550100");

    const options: JSONObject = callArgs(SmsService.sendSms, 1)[0]!;
    expect(options["customTwilioConfig"]).toBeUndefined();
    expect((options["statusPageId"] as ObjectID).toString()).toBe(
      STATUS_PAGE_ID.toString(),
    );
    expect((options["incidentId"] as ObjectID).toString()).toBe(
      INCIDENT_ID.toString(),
    );
  });

  test("capitalises the state in the default SMS", async () => {
    pendingTimelines = [timeline({ stateName: "identified" })];

    await runJob();

    expect(sentSms()[0]).toContain(" is Identified. Details: ");
    expect(sentMail()[0]!["subject"]).toBe(
      `[Identified Incident] ${INCIDENT_TITLE}`,
    );
  });

  test("sends the Slack message the dashboard shows as the Slack starter", async () => {
    await runJob();

    expect(sentSlack()).toEqual([
      dashboardDefault(StatusPageSubscriberNotificationMethod.Slack),
    ]);
    expect(sentSlack()[0]).toBe(`🚨 ## Incident - ${INCIDENT_TITLE}


**Resources Affected:** ${RESOURCES}
**Severity:** ${SEVERITY}
**Status:** ${STATE_NAME}

[View Status Page](${STATUS_PAGE_URL}) | [Unsubscribe](${UNSUBSCRIBE_URL})`);
    expect(SlackUtil.convertMarkdownToSlackRichText).toHaveBeenCalledWith(
      sentSlack()[0],
    );
    expect(
      callArgs(SlackUtil.sendMessageToChannelViaIncomingWebhook)[0]![
        "url"
      ]!.toString(),
    ).toBe(SLACK_WEBHOOK_URL);
  });

  test("sends the Microsoft Teams message the dashboard shows as the Teams starter, without Slack formatting", async () => {
    await runJob();

    expect(sentTeams()).toEqual([
      dashboardDefault(StatusPageSubscriberNotificationMethod.MicrosoftTeams),
    ]);
    expect(
      callArgs(MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook)[0]![
        "url"
      ]!.toString(),
    ).toBe(TEAMS_WEBHOOK_URL);
    // Only the Slack message goes through the Slack rich text conversion.
    expect(SlackUtil.convertMarkdownToSlackRichText).toHaveBeenCalledTimes(1);
  });

  test("leaves the resources line out of the chat messages when none are named", async () => {
    mock(StatusPageResourceUtil.getResourcesGroupedByGroupName).mockReturnValue(
      "",
    );

    await runJob();

    const expected: string = `🚨 ## Incident - ${INCIDENT_TITLE}


**Severity:** ${SEVERITY}
**Status:** ${STATE_NAME}

[View Status Page](${STATUS_PAGE_URL}) | [Unsubscribe](${UNSUBSCRIBE_URL})`;

    expect(sentSlack()).toEqual([expected]);
    expect(sentTeams()).toEqual([expected]);
  });

  test("sends webhook subscribers the fixed IncidentStateChanged payload", async () => {
    await runJob();

    expect(sentWebhooks()).toHaveLength(1);
    const payload: JSONObject = sentWebhooks()[0]!;

    expect(payload).toEqual(defaultWebhookPayload());
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
    expect(Object.keys(payload["data"] as JSONObject).sort()).toEqual(
      [
        "detailsUrl",
        "incidentId",
        "incidentNumber",
        "incidentSeverity",
        "incidentState",
        "incidentTitle",
        "resourcesAffected",
      ].sort(),
    );
    expect(
      callArgs(StatusPageSubscriberWebhookUtil.sendWebhookNotification)[0]![
        "webhookUrl"
      ]!.toString(),
    ).toBe(SUBSCRIBER_WEBHOOK_URL);
  });

  test("sends the same payload a Webhook template saved from the dashboard starter would", async () => {
    await runJob();

    const fromStarter: JSONObject | null =
      StatusPageSubscriberWebhookTemplate.compile(
        dashboardStarter(StatusPageSubscriberNotificationMethod.Webhook),
        expectedVariables(),
      );

    expect(fromStarter).not.toBeNull();
    expect(sentWebhooks()[0]).toEqual(fromStarter);
  });

  test("keeps the default payload's empty fallbacks", async () => {
    storedIncident = incident({ bare: true });
    mock(StatusPageResourceUtil.getResourcesGroupedByGroupName).mockReturnValue(
      "",
    );

    await runJob();

    expect(sentWebhooks()[0]!["data"]).toEqual({
      incidentId: INCIDENT_ID.toString(),
      incidentNumber: "",
      incidentTitle: INCIDENT_TITLE,
      incidentSeverity: "",
      incidentState: STATE_NAME,
      resourcesAffected: "",
      detailsUrl: DETAILS_URL,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("groups the resources of the status page being notified", async () => {
    await runJob();

    const args: Array<unknown> = mock(
      StatusPageResourceUtil.getResourcesGroupedByGroupName,
    ).mock.calls[0]!;

    expect(
      (args[0] as Array<StatusPageResource>).map(
        (row: StatusPageResource): string | undefined => {
          return row.statusPageId?.toString();
        },
      ),
    ).toEqual([STATUS_PAGE_ID.toString()]);
    expect(args[1]).toBe("");
  });
});

describe("IncidentStateTimeline:SendNotificationToSubscribers template lookups", () => {
  test("looks up one template per channel, Webhook included, for this event and status page", async () => {
    await runJob();

    const lookups: Array<JSONObject> = templateLookups();

    expect(lookups).toHaveLength(5);

    for (const lookup of lookups) {
      expect(lookup["eventType"]).toBe(EVENT);
      expect((lookup["statusPageId"] as ObjectID).toString()).toBe(
        STATUS_PAGE_ID.toString(),
      );
    }

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
  });

  test("looks up every channel the event is sent on", async () => {
    await runJob();

    expect(
      templateLookups()
        .map((lookup: JSONObject): string => {
          return lookup["notificationMethod"] as string;
        })
        .sort(),
    ).toEqual(
      [
        ...SubscriberNotificationTemplateChannels.getSupportedNotificationMethods(
          EVENT,
        ),
      ].sort(),
    );
  });

  test("looks the templates up once per status page, not once per subscriber", async () => {
    mock(
      StatusPageSubscriberService.getSubscribersByStatusPage,
    ).mockResolvedValue([
      subscriber(),
      subscriber({ id: SECOND_SUBSCRIBER_ID }),
    ] as never);

    await runJob();

    expect(templateLookups()).toHaveLength(5);
    expect(sentWebhooks()).toHaveLength(2);
  });

  test("looks the templates up for each status page on its own", async () => {
    useStatusPages([statusPage(), statusPage({ id: SECOND_STATUS_PAGE_ID })]);
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue([
      resource(STATUS_PAGE_ID),
      resource(SECOND_STATUS_PAGE_ID),
    ] as never);

    await runJob();

    const lookedUpPages: Array<string> = templateLookups().map(
      (lookup: JSONObject): string => {
        return (lookup["statusPageId"] as ObjectID).toString();
      },
    );

    expect(lookedUpPages).toHaveLength(10);
    expect(
      lookedUpPages.filter((id: string): boolean => {
        return id === STATUS_PAGE_ID.toString();
      }),
    ).toHaveLength(5);
    expect(
      lookedUpPages.filter((id: string): boolean => {
        return id === SECOND_STATUS_PAGE_ID.toString();
      }),
    ).toHaveLength(5);
    expect(
      sentWebhooks().map((payload: JSONObject): string => {
        return payload["statusPageId"] as string;
      }),
    ).toEqual([STATUS_PAGE_ID.toString(), SECOND_STATUS_PAGE_ID.toString()]);
  });
});

describe("IncidentStateTimeline:SendNotificationToSubscribers with a custom Webhook template", () => {
  test("sends the compiled template, with no custom SMTP or SMS provider configured", async () => {
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Webhook]: {
        templateBody: `{
  "kind": "incident-state",
  "incident": {
    "id": "{{incidentId}}",
    "number": {{incidentNumber}},
    "title": "{{incidentTitle}}",
    "state": "{{incidentState}}",
    "description": "{{incidentDescription}}"
  },
  "page": "{{statusPageId}}",
  "links": ["{{detailsUrl}}", "{{unsubscribeUrl}}"]
}`,
      },
    });

    await runJob();

    expect(sentWebhooks()).toEqual([
      {
        kind: "incident-state",
        incident: {
          id: INCIDENT_ID.toString(),
          number: 7,
          title: INCIDENT_TITLE,
          state: STATE_NAME,
          description: INCIDENT_DESCRIPTION,
        },
        page: STATUS_PAGE_ID.toString(),
        links: [DETAILS_URL, UNSUBSCRIBE_URL],
      },
    ]);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(
      callArgs(StatusPageSubscriberWebhookUtil.sendWebhookNotification)[0]![
        "webhookUrl"
      ]!.toString(),
    ).toBe(SUBSCRIBER_WEBHOOK_URL);
  });

  test("keeps quotes, backslashes and new lines in values intact", async () => {
    const title: string = 'Checkout "EU" \\ failing';
    const description: string =
      'Line one\nLine "two" at C:\\payments\\eu\r\n\tand a tab $& $1';
    storedIncident = incident({ title: title, description: description });
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Webhook]: {
        templateBody:
          '{"title": "{{incidentTitle}}", "description": "{{ incidentDescription }}"}',
      },
    });

    await runJob();

    const payload: JSONObject = sentWebhooks()[0]!;

    expect(payload).toEqual({ title: title, description: description });
    expect(JSON.parse(JSON.stringify(payload))).toEqual({
      title: title,
      description: description,
    });
  });

  interface BrokenTemplateCase {
    title: string;
    templateBody: string;
  }

  const brokenTemplates: Array<BrokenTemplateCase> = [
    {
      title: "is not valid JSON",
      templateBody: '{"title": "{{incidentTitle}}",',
    },
    {
      title: "leaves a text variable outside quotes",
      templateBody: '{"title": {{incidentTitle}}}',
    },
    {
      title: "is a JSON array",
      templateBody: '[{"title": "{{incidentTitle}}"}]',
    },
  ];

  test.each(brokenTemplates)(
    "falls back to the default payload and warns when the template $title",
    async (brokenTemplate: BrokenTemplateCase) => {
      useTemplates({
        [StatusPageSubscriberNotificationMethod.Webhook]: {
          templateBody: brokenTemplate.templateBody,
        },
      });

      await runJob();

      expect(sentWebhooks()).toEqual([defaultWebhookPayload()]);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(STATUS_PAGE_ID.toString()),
        { statusPageId: STATUS_PAGE_ID.toString() },
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("IncidentStateChanged"),
        expect.anything(),
      );

      // The other channels still get their defaults.
      expect(sentSms()).toEqual([
        dashboardDefault(StatusPageSubscriberNotificationMethod.SMS),
      ]);
      expect(sentSlack()).toEqual([
        dashboardDefault(StatusPageSubscriberNotificationMethod.Slack),
      ]);
      expect(sentTeams()).toEqual([
        dashboardDefault(StatusPageSubscriberNotificationMethod.MicrosoftTeams),
      ]);
      expect(sentMail()[0]!["templateType"]).toBe(
        EmailTemplateType.SubscriberIncidentStateChanged,
      );
      expect(statusWrites()).toEqual(succeeded());
    },
  );

  test("leaves the other channels on their defaults", async () => {
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Webhook]: {
        templateBody: '{"custom": true}',
      },
    });

    await runJob();

    expect(sentWebhooks()).toEqual([{ custom: true }]);
    expect(sentSms()).toEqual([
      dashboardDefault(StatusPageSubscriberNotificationMethod.SMS),
    ]);
    expect(sentSlack()).toEqual([
      dashboardDefault(StatusPageSubscriberNotificationMethod.Slack),
    ]);
    expect(sentTeams()).toEqual([
      dashboardDefault(StatusPageSubscriberNotificationMethod.MicrosoftTeams),
    ]);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberIncidentStateChanged,
    );
  });

  test("fills each subscriber's own unsubscribe link", async () => {
    mock(
      StatusPageSubscriberService.getSubscribersByStatusPage,
    ).mockResolvedValue([
      subscriber(),
      subscriber({ id: SECOND_SUBSCRIBER_ID, webhookOnly: true }),
    ] as never);
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
});

describe("IncidentStateTimeline:SendNotificationToSubscribers fills every documented variable", () => {
  test("the expected values cover exactly the documented variables", () => {
    expect(Object.keys(expectedVariables()).sort()).toEqual(
      [...VARIABLE_NAMES].sort(),
    );
    expect(VARIABLE_NAMES).toEqual(
      expect.arrayContaining([
        "statusPageId",
        "incidentId",
        "incidentNumber",
        "incidentDescription",
      ]),
    );
  });

  test("in a custom email template, when the status page has its own SMTP server", async () => {
    useStatusPages([statusPage({ withSmtpConfig: true })]);
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Email]: {
        templateBody: everyVariableTemplate(),
        emailSubject:
          "{{incidentTitle}} #{{incidentNumber}} ({{statusPageId}})",
      },
    });

    await runJob();

    expect(sentMail()).toHaveLength(1);
    const mail: JSONObject = sentMail()[0]!;
    const body: string = (mail["vars"] as JSONObject)["body"] as string;

    expect(mail["templateType"]).toBe(EmailTemplateType.BlankTemplate);
    expect(mail["vars"]).toEqual({ body: everyVariableText() });
    expect(body).not.toContain("{{");
    expect(body).toContain(`statusPageId=[${STATUS_PAGE_ID.toString()}]`);
    expect(body).toContain(`incidentId=[${INCIDENT_ID.toString()}]`);
    expect(body).toContain("incidentNumber=[7]");
    expect(body).toContain(`incidentDescription=[${INCIDENT_DESCRIPTION}]`);
    expect(mail["subject"]).toBe(
      `${INCIDENT_TITLE} #7 (${STATUS_PAGE_ID.toString()})`,
    );
    expect(callArgs(MailService.sendMail, 1)[0]!["mailServer"]).toEqual({
      smtp: "custom",
    });
  });

  test("in a custom SMS template, when the status page has its own SMS provider", async () => {
    useStatusPages([statusPage({ withCallSmsConfig: true })]);
    useTemplates({
      [StatusPageSubscriberNotificationMethod.SMS]: {
        templateBody: everyVariableTemplate(),
      },
    });

    await runJob();

    expect(sentSms()).toEqual([everyVariableText()]);
    expect(sentSms()[0]).not.toContain("{{");
    expect(sentSms()[0]).toContain(
      `statusPageId=[${STATUS_PAGE_ID.toString()}]`,
    );
    expect(sentSms()[0]).toContain(
      `incidentDescription=[${INCIDENT_DESCRIPTION}]`,
    );
    expect(callArgs(SmsService.sendSms, 1)[0]!["customTwilioConfig"]).toEqual({
      twilio: "custom",
    });
  });

  test("in a custom Slack template", async () => {
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Slack]: {
        templateBody: everyVariableTemplate(),
      },
    });

    await runJob();

    expect(sentSlack()).toEqual([everyVariableText()]);
    expect(sentSlack()[0]).not.toContain("{{");
    expect(sentSlack()[0]).toContain(`incidentId=[${INCIDENT_ID.toString()}]`);
    expect(SlackUtil.convertMarkdownToSlackRichText).toHaveBeenCalledWith(
      everyVariableText(),
    );
  });

  test("in a custom Microsoft Teams template", async () => {
    useTemplates({
      [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
        templateBody: everyVariableTemplate(),
      },
    });

    await runJob();

    expect(sentTeams()).toEqual([everyVariableText()]);
    expect(sentTeams()[0]).not.toContain("{{");
    expect(sentTeams()[0]).toContain("incidentNumber=[7]");
    expect(SlackUtil.convertMarkdownToSlackRichText).not.toHaveBeenCalledWith(
      everyVariableText(),
    );
  });

  test("in a custom Webhook template", async () => {
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Webhook]: {
        templateBody: everyVariableWebhookTemplate(),
      },
    });

    await runJob();

    expect(sentWebhooks()).toEqual([everyVariableObject()]);
    expect(JSON.stringify(sentWebhooks()[0])).not.toContain("{{");
    expect(sentWebhooks()[0]).toEqual(
      expect.objectContaining({
        statusPageId: STATUS_PAGE_ID.toString(),
        incidentId: INCIDENT_ID.toString(),
        incidentNumber: "7",
        incidentDescription: INCIDENT_DESCRIPTION,
      }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("in every channel at once", async () => {
    useStatusPages([
      statusPage({ withSmtpConfig: true, withCallSmsConfig: true }),
    ]);
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Email]: {
        templateBody: everyVariableTemplate(),
        emailSubject: "{{incidentState}}",
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

    expect(sentMail()[0]!["vars"]).toEqual({ body: everyVariableText() });
    expect(sentMail()[0]!["subject"]).toBe(STATE_NAME);
    expect(sentSms()).toEqual([everyVariableText()]);
    expect(sentSlack()).toEqual([everyVariableText()]);
    expect(sentTeams()).toEqual([everyVariableText()]);
    expect(sentWebhooks()).toEqual([everyVariableObject()]);
  });

  test("fills missing incident details with the existing fallbacks", async () => {
    storedIncident = incident({ bare: true });
    mock(StatusPageResourceUtil.getResourcesGroupedByGroupName).mockReturnValue(
      "",
    );
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Slack]: {
        templateBody:
          "[{{incidentNumber}}][{{incidentDescription}}][{{incidentSeverity}}][{{resourcesAffected}}]",
      },
      [StatusPageSubscriberNotificationMethod.Webhook]: {
        templateBody:
          '{"number": "{{incidentNumber}}", "description": "{{incidentDescription}}"}',
      },
    });

    await runJob();

    expect(sentSlack()).toEqual(["[][][ - ][None]"]);
    expect(sentWebhooks()).toEqual([{ number: "", description: "" }]);
  });
});

describe("IncidentStateTimeline:SendNotificationToSubscribers custom template gating", () => {
  test("ignores a custom email template without the status page's own SMTP server", async () => {
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Email]: {
        templateBody: everyVariableTemplate(),
      },
    });

    await runJob();

    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberIncidentStateChanged,
    );
  });

  test("ignores a custom SMS template without the status page's own SMS provider", async () => {
    useTemplates({
      [StatusPageSubscriberNotificationMethod.SMS]: {
        templateBody: everyVariableTemplate(),
      },
    });

    await runJob();

    expect(sentSms()).toEqual([
      dashboardDefault(StatusPageSubscriberNotificationMethod.SMS),
    ]);
  });

  test("uses the default subject for a custom email template without one", async () => {
    useStatusPages([statusPage({ withSmtpConfig: true })]);
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Email]: {
        templateBody: "<p>{{incidentState}}</p>",
      },
    });

    await runJob();

    expect(sentMail()[0]).toEqual(
      expect.objectContaining({
        templateType: EmailTemplateType.BlankTemplate,
        subject: `[Incident ${STATE_NAME}] ${INCIDENT_TITLE}`,
        vars: { body: `<p>${STATE_NAME}</p>` },
      }),
    );
  });

  test("uses custom Slack and Teams templates without any provider configuration", async () => {
    useTemplates({
      [StatusPageSubscriberNotificationMethod.Slack]: {
        templateBody: "Slack: {{incidentTitle}} is {{incidentState}}",
      },
      [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
        templateBody: "Teams: {{incidentTitle}} is {{incidentState}}",
      },
    });

    await runJob();

    expect(sentSlack()).toEqual([`Slack: ${INCIDENT_TITLE} is ${STATE_NAME}`]);
    expect(sentTeams()).toEqual([`Teams: ${INCIDENT_TITLE} is ${STATE_NAME}`]);
  });
});

describe("IncidentStateTimeline:SendNotificationToSubscribers delivery failures", () => {
  interface ChannelCase {
    channel: string;
    sender: () => jest.Mock;
  }

  const channels: Array<ChannelCase> = [
    {
      channel: "email",
      sender: (): jest.Mock => {
        return mock(MailService.sendMail);
      },
    },
    {
      channel: "SMS",
      sender: (): jest.Mock => {
        return mock(SmsService.sendSms);
      },
    },
    {
      channel: "Slack",
      sender: (): jest.Mock => {
        return mock(SlackUtil.sendMessageToChannelViaIncomingWebhook);
      },
    },
    {
      channel: "Microsoft Teams",
      sender: (): jest.Mock => {
        return mock(MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook);
      },
    },
    {
      channel: "webhook",
      sender: (): jest.Mock => {
        return mock(StatusPageSubscriberWebhookUtil.sendWebhookNotification);
      },
    },
  ];

  test.each(channels)(
    "a failed $channel delivery is logged and does not stop the other channels",
    async (channelCase: ChannelCase) => {
      const failure: Error = new Error(`${channelCase.channel} is down`);
      channelCase.sender().mockRejectedValue(failure as never);

      await expect(runJob()).resolves.toBeUndefined();

      for (const other of channels) {
        expect(other.sender()).toHaveBeenCalledTimes(1);
      }

      expect(logger.error).toHaveBeenCalledWith(
        failure,
        expect.objectContaining({
          projectId: PROJECT_ID.toString(),
          incidentId: INCIDENT_ID.toString(),
        }),
      );
      expect(statusWrites()).toEqual(succeeded());
      expect(feedItems()[0]!["displayColor"]).toBe(Blue500);
    },
  );

  test("a failed webhook delivery to one subscriber still reaches the next", async () => {
    mock(
      StatusPageSubscriberService.getSubscribersByStatusPage,
    ).mockResolvedValue([
      subscriber(),
      subscriber({ id: SECOND_SUBSCRIBER_ID, webhookOnly: true }),
    ] as never);
    mock(StatusPageSubscriberWebhookUtil.sendWebhookNotification)
      .mockRejectedValueOnce(new Error("first webhook is down") as never)
      .mockResolvedValue(undefined as never);

    await runJob();

    expect(
      sentWebhooks().map((payload: JSONObject): string => {
        return payload["unsubscribeUrl"] as string;
      }),
    ).toEqual([UNSUBSCRIBE_URL, unsubscribeUrlFor(SECOND_SUBSCRIBER_ID)]);
    expect(statusWrites()).toEqual(succeeded());
  });

  test("a failed Microsoft Teams delivery with a custom template does not stop the webhook", async () => {
    mock(
      MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
    ).mockRejectedValue(new Error("teams is down") as never);
    useTemplates({
      [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
        templateBody: "{{incidentTitle}}",
      },
      [StatusPageSubscriberNotificationMethod.Webhook]: {
        templateBody: '{"title": "{{incidentTitle}}"}',
      },
    });

    await runJob();

    expect(sentTeams()).toEqual([INCIDENT_TITLE]);
    expect(sentWebhooks()).toEqual([{ title: INCIDENT_TITLE }]);
    expect(statusWrites()).toEqual(succeeded());
  });
});
