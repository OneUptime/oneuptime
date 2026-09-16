import Monitor from "Common/Models/DatabaseModels/Monitor";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberNotificationTemplateVariables from "Common/Types/StatusPage/SubscriberNotificationTemplateVariables";
import SubscriberUpdateNotification from "Common/Types/StatusPage/SubscriberUpdateNotification";
import { JSONObject } from "Common/Types/JSON";

/*
 * Announcement subscriber notifications.
 *
 * The job file registers two crons that share one send path: one for a new
 * announcement, one for an announcement an editor updated and asked to tell
 * subscribers about. The update job is new; the created job is refactored onto
 * the shared path. These tests drive a full tick of each against fakes for
 * every service, and assert on what subscribers would receive and on which
 * status columns are written.
 *
 * RunCron is mocked to capture the handlers, as in the other
 * App/Tests/Workers/Jobs suites. The webhook template compiler and the
 * resource formatter are the real ones, so a payload or a resources list
 * asserted here is exactly what a subscriber would get.
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

jest.mock("Common/Server/Services/StatusPageAnnouncementService", () => {
  return {
    __esModule: true,
    default: { findAllBy: jest.fn(), updateOneById: jest.fn() },
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
      // The real substitution: {{name}} -> value.
      Service: {
        compileTemplate: (
          template: string,
          variables: Record<string, string>,
        ): string => {
          let compiled: string = template;
          for (const [key, value] of Object.entries(variables)) {
            compiled = compiled.replace(
              new RegExp(`{{\\s*${key}\\s*}}`, "g"),
              value || "",
            );
          }
          return compiled;
        },
      },
    };
  },
);

jest.mock("Common/Server/Services/StatusPageResourceService", () => {
  return { __esModule: true, default: { findAllBy: jest.fn() } };
});

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
import MailService from "Common/Server/Services/MailService";
import SmsService from "Common/Server/Services/SmsService";
import StatusPageAnnouncementService from "Common/Server/Services/StatusPageAnnouncementService";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import Markdown from "Common/Server/Types/Markdown";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import StatusPageResourceUtil from "Common/Server/Utils/StatusPageResource";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
import StatusPageSubscriberWebhookTemplate from "Common/Server/Utils/StatusPageSubscriberWebhookTemplate";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import { getDefaultSubscriberNotificationTemplate } from "../../../../FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateDefaults";
import "../../../../FeatureSet/Workers/Jobs/Announcement/SendNotificationToSubscribers";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const CREATED_JOB: string = "Announcement:SendNotificationToSubscribers";
const UPDATED_JOB: string = "Announcement:SendUpdateNotificationToSubscribers";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ANNOUNCEMENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SECOND_ANNOUNCEMENT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const SECOND_STATUS_PAGE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const SECOND_SUBSCRIBER_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const THIRD_SUBSCRIBER_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const SECOND_MONITOR_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const GROUP_ID: ObjectID = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

const STATUS_PAGE_URL: string = "https://status.acme.com";
const DETAILS_URL: string = `${STATUS_PAGE_URL}/announcements/${ANNOUNCEMENT_ID.toString()}`;
const UNSUBSCRIBE_URL: string = `${STATUS_PAGE_URL}/update-subscription/${SUBSCRIBER_ID.toString()}`;
const SLACK_URL: string = "https://hooks.slack.com/services/T000/B000/XXXX";
const TEAMS_URL: string = "https://outlook.office.com/webhook/abc";
const WEBHOOK_URL: string = "https://hooks.acme.com/status";

const TITLE: string = "Planned database maintenance";
const DESCRIPTION: string = "The maintenance now starts on **Sunday**.";
const DESCRIPTION_HTML: string =
  "<p>The maintenance now starts on <strong>Sunday</strong>.</p>";
const DESCRIPTION_TEXT: string = "The maintenance now starts on Sunday.";

type Row = StatusPageAnnouncement;

let createdRows: Array<Row> = [];
let updatedRows: Array<Row> = [];
let skipRows: Array<Row> = [];

// The status page resources StatusPageResourceService finds, by status page id.
let resourcesByStatusPage: Record<string, Array<StatusPageResource>> = {};

function announcement(overrides?: {
  id?: ObjectID;
  subscriberNotificationStatus?: StatusPageSubscriberNotificationStatus;
  showAnnouncementAt?: Date;
  withoutStatusPages?: boolean;
  title?: string;
  description?: string;
  monitorIds?: Array<ObjectID>;
}): Row {
  const row: Row = new StatusPageAnnouncement();
  row._id = (overrides?.id || ANNOUNCEMENT_ID).toString();
  row.title = overrides?.title ?? TITLE;
  row.description = overrides?.description ?? DESCRIPTION;
  row.showAnnouncementAt =
    overrides?.showAnnouncementAt || new Date("2026-01-01T00:00:00.000Z");
  row.subscriberNotificationStatus =
    overrides?.subscriberNotificationStatus ||
    StatusPageSubscriberNotificationStatus.Success;
  row.monitors = (overrides?.monitorIds || []).map(
    (monitorId: ObjectID): Monitor => {
      const monitor: Monitor = new Monitor();
      monitor._id = monitorId.toString();
      return monitor;
    },
  );

  if (!overrides?.withoutStatusPages) {
    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID.toString();
    row.statusPages = [page];
  }

  return row;
}

function statusPage(overrides?: {
  id?: ObjectID;
  showAnnouncementsOnStatusPage?: boolean;
  withCustomSmtp?: boolean;
  withCustomSms?: boolean;
}): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = (overrides?.id || STATUS_PAGE_ID).toString();
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  page.pageTitle = "Acme Status";
  page.isPublicStatusPage = true;
  page.showAnnouncementsOnStatusPage =
    overrides?.showAnnouncementsOnStatusPage !== false;

  if (overrides?.withCustomSmtp) {
    (page as unknown as JSONObject)["smtpConfig"] = { _id: "smtp" };
  }

  if (overrides?.withCustomSms) {
    (page as unknown as JSONObject)["callSmsConfig"] = { _id: "sms" };
  }

  return page;
}

function subscriber(overrides?: {
  id?: ObjectID;
  webhookUrl?: string;
}): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row._id = (overrides?.id || SUBSCRIBER_ID).toString();
  row.subscriberEmail = new Email("customer@example.com");
  row.subscriberPhone = new Phone("+15555550100");
  row.slackIncomingWebhookUrl = URL.fromString(SLACK_URL);
  row.microsoftTeamsIncomingWebhookUrl = URL.fromString(TEAMS_URL);
  row.subscriberWebhook = URL.fromString(overrides?.webhookUrl || WEBHOOK_URL);
  return row;
}

function pageResource(data: {
  displayName: string;
  statusPageId?: ObjectID;
  groupName?: string;
}): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = ObjectID.generate().toString();
  row.statusPageId = data.statusPageId || STATUS_PAGE_ID;
  row.displayName = data.displayName;

  if (data.groupName) {
    const group: StatusPageGroup = new StatusPageGroup();
    group._id = GROUP_ID.toString();
    group.name = data.groupName;
    row.statusPageGroupId = GROUP_ID;
    row.statusPageGroup = group;
  }

  return row;
}

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
}

// Every updateOneById data payload, in order.
function statusWrites(): Array<JSONObject> {
  return mock(StatusPageAnnouncementService.updateOneById).mock.calls.map(
    (call: Array<unknown>): JSONObject => {
      return (call[0] as { data: JSONObject }).data;
    },
  );
}

function writesFor(id: ObjectID): Array<JSONObject> {
  return mock(StatusPageAnnouncementService.updateOneById)
    .mock.calls.filter((call: Array<unknown>): boolean => {
      return (call[0] as { id: ObjectID }).id.toString() === id.toString();
    })
    .map((call: Array<unknown>): JSONObject => {
      return (call[0] as { data: JSONObject }).data;
    });
}

function findAllByQueries(): Array<JSONObject> {
  return mock(StatusPageAnnouncementService.findAllBy).mock.calls.map(
    (call: Array<unknown>): JSONObject => {
      return (call[0] as { query: JSONObject }).query;
    },
  );
}

function sentMail(): Array<{ mail: JSONObject; options: JSONObject }> {
  return mock(MailService.sendMail).mock.calls.map(
    (call: Array<unknown>): { mail: JSONObject; options: JSONObject } => {
      return {
        mail: call[0] as JSONObject,
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

function sentWebhooks(): Array<JSONObject> {
  return mock(
    StatusPageSubscriberWebhookUtil.sendWebhookNotification,
  ).mock.calls.map((call: Array<unknown>): JSONObject => {
    return (call[0] as { payload: JSONObject }).payload;
  });
}

// Webhook payloads keyed by the subscriber webhook they were sent to.
function sentWebhooksByUrl(): Record<string, JSONObject> {
  const byUrl: Record<string, JSONObject> = {};

  for (const call of mock(
    StatusPageSubscriberWebhookUtil.sendWebhookNotification,
  ).mock.calls) {
    const args: { webhookUrl: URL; payload: JSONObject } = call[0] as {
      webhookUrl: URL;
      payload: JSONObject;
    };
    byUrl[args.webhookUrl.toString()] = args.payload;
  }

  return byUrl;
}

function templateLookups(): Array<JSONObject> {
  return mock(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
  ).mock.calls.map((call: Array<unknown>): JSONObject => {
    return call[0] as JSONObject;
  });
}

/*
 * The values every channel's custom template is filled with, as Slack, Teams
 * and Webhook get them. SMS and Email differ only in the description.
 */
function templateValues(overrides?: {
  resourcesAffected?: string;
  statusPageId?: ObjectID;
  announcementTitle?: string;
  announcementDescription?: string;
}): Record<string, string> {
  return {
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    statusPageId: (overrides?.statusPageId || STATUS_PAGE_ID).toString(),
    unsubscribeUrl: UNSUBSCRIBE_URL,
    resourcesAffected: overrides?.resourcesAffected ?? "",
    announcementId: ANNOUNCEMENT_ID.toString(),
    announcementTitle: overrides?.announcementTitle ?? TITLE,
    announcementDescription: overrides?.announcementDescription ?? DESCRIPTION,
    detailsUrl: DETAILS_URL,
  };
}

// The payload webhook subscribers have always received without a template.
function defaultWebhookPayload(
  webhookEventType: string,
  overrides?: {
    statusPageId?: ObjectID;
    announcementTitle?: string;
    announcementDescription?: string;
  },
): JSONObject {
  return {
    eventType: webhookEventType,
    statusPageId: (overrides?.statusPageId || STATUS_PAGE_ID).toString(),
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    unsubscribeUrl: UNSUBSCRIBE_URL,
    data: {
      announcementId: ANNOUNCEMENT_ID.toString(),
      announcementTitle: overrides?.announcementTitle ?? TITLE,
      announcementDescription:
        overrides?.announcementDescription ?? DESCRIPTION,
      detailsUrl: DETAILS_URL,
    },
  };
}

type CustomTemplates = Partial<
  Record<
    StatusPageSubscriberNotificationMethod,
    { body: string; subject?: string }
  >
>;

function useCustomTemplates(templates: CustomTemplates): void {
  mock(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
  ).mockImplementation(
    async (
      args: unknown,
    ): Promise<StatusPageSubscriberNotificationTemplate | null> => {
      const method: StatusPageSubscriberNotificationMethod = (
        args as JSONObject
      )["notificationMethod"] as StatusPageSubscriberNotificationMethod;
      const custom: { body: string; subject?: string } | undefined =
        templates[method];

      if (!custom) {
        return null;
      }

      const template: StatusPageSubscriberNotificationTemplate =
        new StatusPageSubscriberNotificationTemplate();
      template.templateBody = custom.body;

      if (custom.subject) {
        template.emailSubject = custom.subject;
      }

      return template;
    },
  );
}

// A text template that names every variable documented for the event.
function everyVariableTemplate(
  eventType: StatusPageSubscriberNotificationEventType,
): string {
  return SubscriberNotificationTemplateVariables.getVariableNames(eventType)
    .map((name: string): string => {
      return `${name}=[{{${name}}}]`;
    })
    .join("\n");
}

// What everyVariableTemplate compiles to with the given values.
function everyVariableMessage(
  eventType: StatusPageSubscriberNotificationEventType,
  values: Record<string, string>,
): string {
  return SubscriberNotificationTemplateVariables.getVariableNames(eventType)
    .map((name: string): string => {
      expect(values[name]).toBeDefined();
      return `${name}=[${values[name]}]`;
    })
    .join("\n");
}

// A Webhook template that puts every documented variable in a JSON string.
function everyVariableWebhookTemplate(
  eventType: StatusPageSubscriberNotificationEventType,
): string {
  const entries: Array<string> =
    SubscriberNotificationTemplateVariables.getVariableNames(eventType).map(
      (name: string): string => {
        return `  "${name}": "{{${name}}}"`;
      },
    );

  return `{\n${entries.join(",\n")}\n}`;
}

function everyVariablePayload(
  eventType: StatusPageSubscriberNotificationEventType,
  values: Record<string, string>,
): JSONObject {
  const payload: JSONObject = {};

  for (const name of SubscriberNotificationTemplateVariables.getVariableNames(
    eventType,
  )) {
    expect(values[name]).toBeDefined();
    payload[name] = values[name]!;
  }

  return payload;
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

function dashboardDefault(
  eventType: StatusPageSubscriberNotificationEventType,
  method: StatusPageSubscriberNotificationMethod,
): string {
  const template: string =
    getDefaultSubscriberNotificationTemplate(eventType, method)?.body || "";
  const variables: Record<string, string> = templateValues();

  return template.replace(/{{\s*(\w+)\s*}}/g, (_match: string, key: string) => {
    return variables[key] ?? "";
  });
}

async function runJob(name: string): Promise<void> {
  expect(mockCapturedJobs[name]).toBeDefined();
  await mockCapturedJobs[name]!();
}

beforeEach(() => {
  jest.clearAllMocks();

  createdRows = [];
  updatedRows = [];
  skipRows = [];
  resourcesByStatusPage = {};

  mock(StatusPageResourceService.findAllBy).mockImplementation(
    async (args: unknown): Promise<Array<StatusPageResource>> => {
      const query: JSONObject = (args as { query: JSONObject }).query;
      return (
        resourcesByStatusPage[
          (query["statusPageId"] as unknown as ObjectID).toString()
        ] || []
      );
    },
  );

  mock(StatusPageAnnouncementService.findAllBy).mockImplementation(
    async (args: unknown): Promise<Array<Row>> => {
      const query: JSONObject = (args as { query: JSONObject }).query;

      if (query["subscriberNotificationStatusOnAnnouncementUpdated"]) {
        return updatedRows;
      }

      if (query["shouldStatusPageSubscribersBeNotified"] === false) {
        return skipRows;
      }

      return createdRows;
    },
  );
  mock(StatusPageAnnouncementService.updateOneById).mockResolvedValue(
    1 as never,
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

describe("Announcement:SendUpdateNotificationToSubscribers", () => {
  test("is registered as its own cron job", () => {
    expect(mockCapturedJobs[UPDATED_JOB]).toBeDefined();
    expect(mockCapturedJobs[CREATED_JOB]).toBeDefined();
  });

  test("looks only for announcements with a pending update notification", async () => {
    await runJob(UPDATED_JOB);

    const queries: Array<JSONObject> = findAllByQueries();

    expect(queries).toHaveLength(1);
    expect(queries[0]).toEqual({
      subscriberNotificationStatusOnAnnouncementUpdated:
        StatusPageSubscriberNotificationStatus.Pending,
    });
  });

  test("reads the original notification's status so it can tell whether subscribers heard about it", async () => {
    await runJob(UPDATED_JOB);

    const select: JSONObject = (
      mock(StatusPageAnnouncementService.findAllBy).mock.calls[0]![0] as {
        select: JSONObject;
      }
    ).select;

    expect(select["subscriberNotificationStatus"]).toBe(true);
    expect(select["title"]).toBe(true);
    expect(select["description"]).toBe(true);
    expect(select["showAnnouncementAt"]).toBe(true);
  });

  test("does nothing, not even resolve the host, when nothing is pending", async () => {
    await runJob(UPDATED_JOB);

    expect(DatabaseConfig.getHost).not.toHaveBeenCalled();
    expect(StatusPageAnnouncementService.updateOneById).not.toHaveBeenCalled();
    nothingSent();
  });

  test.each([
    StatusPageSubscriberNotificationStatus.Pending,
    StatusPageSubscriberNotificationStatus.InProgress,
  ])(
    "skips the update while the original notification is %s",
    async (originalStatus: StatusPageSubscriberNotificationStatus) => {
      updatedRows = [
        announcement({ subscriberNotificationStatus: originalStatus }),
      ];

      await runJob(UPDATED_JOB);

      nothingSent();
      expect(statusWrites()).toEqual([
        {
          subscriberNotificationStatusOnAnnouncementUpdated:
            StatusPageSubscriberNotificationStatus.Skipped,
          subscriberNotificationStatusMessageOnAnnouncementUpdated:
            SubscriberUpdateNotification.notYetNotifiedMessage,
        },
      ]);
    },
  );

  test("skips an announcement that is not shown on status pages yet", async () => {
    updatedRows = [
      announcement({
        showAnnouncementAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }),
    ];

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(statusWrites()).toHaveLength(1);
    expect(
      statusWrites()[0]!["subscriberNotificationStatusOnAnnouncementUpdated"],
    ).toBe(StatusPageSubscriberNotificationStatus.Skipped);
    expect(
      statusWrites()[0]![
        "subscriberNotificationStatusMessageOnAnnouncementUpdated"
      ],
    ).toMatch(/not shown on status pages yet/);
  });

  test.each([
    StatusPageSubscriberNotificationStatus.Success,
    StatusPageSubscriberNotificationStatus.Skipped,
    StatusPageSubscriberNotificationStatus.Failed,
  ])(
    "sends the update once the original notification is %s",
    async (originalStatus: StatusPageSubscriberNotificationStatus) => {
      updatedRows = [
        announcement({ subscriberNotificationStatus: originalStatus }),
      ];

      await runJob(UPDATED_JOB);

      expect(sentMail()).toHaveLength(1);
    },
  );

  test("emails the updated-announcement template with an update subject", async () => {
    updatedRows = [announcement()];

    await runJob(UPDATED_JOB);

    const { mail, options } = sentMail()[0]!;

    expect(mail["templateType"]).toBe(
      EmailTemplateType.SubscriberAnnouncementUpdated,
    );
    expect(mail["subject"]).toBe(`[Announcement Updated] ${TITLE}`);
    expect(mail["toEmail"]!.toString()).toBe("customer@example.com");
    expect(mail["vars"]).toEqual(
      expect.objectContaining({
        announcementTitle: TITLE,
        announcementDescription: DESCRIPTION_HTML,
        statusPageName: "Acme Status",
        statusPageUrl: STATUS_PAGE_URL,
        detailsUrl: DETAILS_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
        subscriberEmailNotificationFooterText: "Footer text",
        isPublicStatusPage: "true",
      }),
    );
    expect(options["statusPageAnnouncementId"]).toEqual(
      new ObjectID(ANNOUNCEMENT_ID.toString()),
    );
    expect(options["statusPageId"]).toEqual(
      new ObjectID(STATUS_PAGE_ID.toString()),
    );
  });

  test("texts subscribers that the announcement was updated, matching the dashboard's default", async () => {
    updatedRows = [announcement()];

    await runJob(UPDATED_JOB);

    expect(sentSms()).toEqual([
      `Announcement updated: ${TITLE} on Acme Status. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
    ]);
    expect(sentSms()[0]).toBe(
      dashboardDefault(
        StatusPageSubscriberNotificationEventType.SubscriberAnnouncementUpdated,
        StatusPageSubscriberNotificationMethod.SMS,
      ),
    );
  });

  test("posts an update heading to Slack and Teams, matching the dashboard's defaults", async () => {
    updatedRows = [announcement()];

    await runJob(UPDATED_JOB);

    expect(sentSlack()).toHaveLength(1);
    expect(sentTeams()).toHaveLength(1);
    expect(sentSlack()[0]).toContain(`## 📢 Announcement Updated - ${TITLE}`);
    expect(sentSlack()[0]).toBe(
      dashboardDefault(
        StatusPageSubscriberNotificationEventType.SubscriberAnnouncementUpdated,
        StatusPageSubscriberNotificationMethod.Slack,
      ),
    );
    expect(sentTeams()[0]).toBe(
      dashboardDefault(
        StatusPageSubscriberNotificationEventType.SubscriberAnnouncementUpdated,
        StatusPageSubscriberNotificationMethod.MicrosoftTeams,
      ),
    );
  });

  test("tells webhook subscribers it is an AnnouncementUpdated event", async () => {
    updatedRows = [announcement()];

    await runJob(UPDATED_JOB);

    expect(sentWebhooks()).toEqual([
      {
        eventType: "AnnouncementUpdated",
        statusPageId: STATUS_PAGE_ID.toString(),
        statusPageName: "Acme Status",
        statusPageUrl: STATUS_PAGE_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
        data: {
          announcementId: ANNOUNCEMENT_ID.toString(),
          announcementTitle: TITLE,
          announcementDescription: DESCRIPTION,
          detailsUrl: DETAILS_URL,
        },
      },
    ]);
  });

  test("looks up the status page's custom templates for the updated event, not the created one", async () => {
    updatedRows = [announcement()];

    await runJob(UPDATED_JOB);

    const lookups: Array<JSONObject> = mock(
      StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
    ).mock.calls.map((call: Array<unknown>): JSONObject => {
      return call[0] as JSONObject;
    });

    expect(
      lookups
        .map((lookup: JSONObject): unknown => {
          return lookup["notificationMethod"];
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
      expect(lookup["eventType"]).toBe(
        StatusPageSubscriberNotificationEventType.SubscriberAnnouncementUpdated,
      );
      expect((lookup["statusPageId"] as unknown as ObjectID).toString()).toBe(
        STATUS_PAGE_ID.toString(),
      );
    }
  });

  test("uses a custom updated-announcement email template when the page has custom SMTP", async () => {
    updatedRows = [announcement()];

    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([statusPage({ withCustomSmtp: true })] as never);

    const custom: StatusPageSubscriberNotificationTemplate =
      new StatusPageSubscriberNotificationTemplate();
    custom.templateBody = "<p>Changed: {{announcementTitle}}</p>";
    custom.emailSubject = "Heads up, {{announcementTitle}} changed";

    mock(
      StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
    ).mockImplementation(async (args: unknown) => {
      return (args as JSONObject)["notificationMethod"] ===
        StatusPageSubscriberNotificationMethod.Email
        ? custom
        : null;
    });

    await runJob(UPDATED_JOB);

    const { mail } = sentMail()[0]!;

    expect(mail["templateType"]).toBe(EmailTemplateType.BlankTemplate);
    expect(mail["subject"]).toBe(`Heads up, ${TITLE} changed`);
    expect(mail["vars"]).toEqual({ body: `<p>Changed: ${TITLE}</p>` });
  });

  test("records progress and success on the update columns only", async () => {
    updatedRows = [announcement()];

    await runJob(UPDATED_JOB);

    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatusOnAnnouncementUpdated:
          StatusPageSubscriberNotificationStatus.InProgress,
      },
      {
        subscriberNotificationStatusOnAnnouncementUpdated:
          StatusPageSubscriberNotificationStatus.Success,
        subscriberNotificationStatusMessageOnAnnouncementUpdated:
          SubscriberUpdateNotification.sentMessage,
      },
    ]);

    for (const write of statusWrites()) {
      expect(write["subscriberNotificationStatus"]).toBeUndefined();
      expect(write["subscriberNotificationStatusMessage"]).toBeUndefined();
    }
  });

  test("writes its status without running update hooks, so it cannot queue itself again", async () => {
    updatedRows = [announcement()];

    await runJob(UPDATED_JOB);

    for (const call of mock(StatusPageAnnouncementService.updateOneById).mock
      .calls) {
      const args: JSONObject = call[0] as JSONObject;
      expect(args["props"]).toEqual({ isRoot: true, ignoreHooks: true });
      expect(args["miscDataProps"]).toBeUndefined();
    }
  });

  test("still completes when every subscriber has opted out", async () => {
    updatedRows = [announcement()];
    mock(StatusPageSubscriberService.shouldSendNotification).mockReturnValue(
      false,
    );

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(statusWrites()[1]).toEqual({
      subscriberNotificationStatusOnAnnouncementUpdated:
        StatusPageSubscriberNotificationStatus.Success,
      subscriberNotificationStatusMessageOnAnnouncementUpdated:
        "No matching subscribers found. All associated status pages either hide announcements or had no matching subscribers.",
    });
  });

  test("respects a status page that hides announcements", async () => {
    updatedRows = [announcement()];
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([
      statusPage({ showAnnouncementsOnStatusPage: false }),
    ] as never);

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(
      StatusPageSubscriberService.getSubscribersByStatusPage,
    ).not.toHaveBeenCalled();
  });

  test("marks the update Skipped when the announcement has no status pages", async () => {
    updatedRows = [announcement({ withoutStatusPages: true })];

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatusOnAnnouncementUpdated:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessageOnAnnouncementUpdated:
          "No status pages attached to this announcement. Skipping notifications.",
      },
    ]);
  });

  test("marks the update Failed with the reason when sending breaks", async () => {
    updatedRows = [announcement()];
    mock(Markdown.convertToHTML).mockRejectedValue(
      new Error("markdown exploded") as never,
    );

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatusOnAnnouncementUpdated:
          StatusPageSubscriberNotificationStatus.InProgress,
      },
      {
        subscriberNotificationStatusOnAnnouncementUpdated:
          StatusPageSubscriberNotificationStatus.Failed,
        subscriberNotificationStatusMessageOnAnnouncementUpdated:
          "markdown exploded",
      },
    ]);
  });

  test("handles each announcement on its own in a multi-announcement tick", async () => {
    updatedRows = [
      announcement({
        subscriberNotificationStatus:
          StatusPageSubscriberNotificationStatus.Pending,
      }),
      announcement({ id: SECOND_ANNOUNCEMENT_ID }),
    ];

    await runJob(UPDATED_JOB);

    expect(writesFor(ANNOUNCEMENT_ID)).toEqual([
      {
        subscriberNotificationStatusOnAnnouncementUpdated:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessageOnAnnouncementUpdated:
          SubscriberUpdateNotification.notYetNotifiedMessage,
      },
    ]);
    expect(
      writesFor(SECOND_ANNOUNCEMENT_ID).map((write: JSONObject) => {
        return write["subscriberNotificationStatusOnAnnouncementUpdated"];
      }),
    ).toEqual([
      StatusPageSubscriberNotificationStatus.InProgress,
      StatusPageSubscriberNotificationStatus.Success,
    ]);
    expect(sentMail()).toHaveLength(1);
  });

  test("keeps going after one announcement's status write fails", async () => {
    updatedRows = [
      announcement({
        subscriberNotificationStatus:
          StatusPageSubscriberNotificationStatus.Pending,
      }),
      announcement({ id: SECOND_ANNOUNCEMENT_ID }),
    ];

    mock(StatusPageAnnouncementService.updateOneById).mockRejectedValueOnce(
      new Error("database hiccup") as never,
    );

    await runJob(UPDATED_JOB);

    expect(sentMail()).toHaveLength(1);
  });
});

describe("Announcement:SendNotificationToSubscribers (created)", () => {
  test("still only picks up visible announcements whose creator asked to notify", async () => {
    await runJob(CREATED_JOB);

    const queries: Array<JSONObject> = findAllByQueries();

    expect(queries).toHaveLength(2);
    expect(queries[0]!["shouldStatusPageSubscribersBeNotified"]).toBe(false);
    expect(queries[1]!["shouldStatusPageSubscribersBeNotified"]).toBe(true);

    for (const query of queries) {
      expect(query["subscriberNotificationStatus"]).toBe(
        StatusPageSubscriberNotificationStatus.Pending,
      );
      expect(query["showAnnouncementAt"]).toBeDefined();
      expect(
        query["subscriberNotificationStatusOnAnnouncementUpdated"],
      ).toBeUndefined();
    }
  });

  test("marks announcements that should not notify as Skipped on the original columns", async () => {
    skipRows = [announcement()];

    await runJob(CREATED_JOB);

    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatus:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessage:
          "Notifications skipped as subscribers are not to be notified for this announcement.",
      },
    ]);
  });

  test("sends the new-announcement messages it always has", async () => {
    createdRows = [
      announcement({
        subscriberNotificationStatus:
          StatusPageSubscriberNotificationStatus.Pending,
      }),
    ];

    await runJob(CREATED_JOB);

    expect(sentMail()[0]!.mail["templateType"]).toBe(
      EmailTemplateType.SubscriberAnnouncementCreated,
    );
    expect(sentMail()[0]!.mail["subject"]).toBe(`[Announcement] ${TITLE}`);
    expect(sentSms()).toEqual([
      `Announcement ${TITLE} on Acme Status. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
    ]);
    expect(sentSlack()[0]).toContain(`## 📢 Announcement - ${TITLE}`);
    expect(sentTeams()[0]).toContain(`## 📢 Announcement - ${TITLE}`);
    expect(sentWebhooks()[0]!["eventType"]).toBe("AnnouncementCreated");

    for (const call of mock(
      StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
    ).mock.calls) {
      expect((call[0] as JSONObject)["eventType"]).toBe(
        StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated,
      );
    }
  });

  test("matches the dashboard's created defaults for SMS and chat", async () => {
    createdRows = [announcement()];

    await runJob(CREATED_JOB);

    expect(sentSms()[0]).toBe(
      dashboardDefault(
        StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated,
        StatusPageSubscriberNotificationMethod.SMS,
      ),
    );
    expect(sentSlack()[0]).toBe(
      dashboardDefault(
        StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated,
        StatusPageSubscriberNotificationMethod.Slack,
      ),
    );
  });

  test("records its status on the original columns only", async () => {
    createdRows = [announcement()];

    await runJob(CREATED_JOB);

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
  });

  test("marks the original notification Failed when sending breaks", async () => {
    createdRows = [announcement()];
    mock(Markdown.convertToHTML).mockRejectedValue(
      new Error("markdown exploded") as never,
    );

    await runJob(CREATED_JOB);

    expect(statusWrites()[1]).toEqual({
      subscriberNotificationStatus:
        StatusPageSubscriberNotificationStatus.Failed,
      subscriberNotificationStatusMessage: "markdown exploded",
    });
  });
});

/*
 * Both jobs share one send path, so everything below runs against the
 * created job and the updated job alike.
 */
interface TriggerCase {
  name: string;
  job: string;
  eventType: StatusPageSubscriberNotificationEventType;
  emailTemplateType: EmailTemplateType;
  emailSubjectPrefix: string;
  smsPrefix: string;
  chatHeading: string;
  webhookEventType: string;
  statusColumn: string;
  successMessage: string;
}

const TRIGGERS: Array<TriggerCase> = [
  {
    name: "created",
    job: CREATED_JOB,
    eventType:
      StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated,
    emailTemplateType: EmailTemplateType.SubscriberAnnouncementCreated,
    emailSubjectPrefix: "[Announcement] ",
    smsPrefix: "Announcement",
    chatHeading: "📢 Announcement",
    webhookEventType: "AnnouncementCreated",
    statusColumn: "subscriberNotificationStatus",
    successMessage: "Notifications sent successfully to all subscribers",
  },
  {
    name: "updated",
    job: UPDATED_JOB,
    eventType:
      StatusPageSubscriberNotificationEventType.SubscriberAnnouncementUpdated,
    emailTemplateType: EmailTemplateType.SubscriberAnnouncementUpdated,
    emailSubjectPrefix: "[Announcement Updated] ",
    smsPrefix: "Announcement updated:",
    chatHeading: "📢 Announcement Updated",
    webhookEventType: "AnnouncementUpdated",
    statusColumn: "subscriberNotificationStatusOnAnnouncementUpdated",
    successMessage: SubscriberUpdateNotification.sentMessage,
  },
];

interface ResourceCase {
  label: string;
  monitorIds: Array<ObjectID>;
  resources: () => Array<StatusPageResource>;
  resourcesAffected: string;
}

const RESOURCE_CASES: Array<ResourceCase> = [
  {
    label: "without monitors",
    monitorIds: [],
    resources: (): Array<StatusPageResource> => {
      return [];
    },
    resourcesAffected: "",
  },
  {
    label: "with monitors",
    monitorIds: [MONITOR_ID, SECOND_MONITOR_ID],
    resources: (): Array<StatusPageResource> => {
      return [
        pageResource({ displayName: "Checkout API", groupName: "EU" }),
        pageResource({ displayName: "Website", groupName: "EU" }),
        pageResource({ displayName: "Docs" }),
      ];
    },
    resourcesAffected: "EU: Checkout API, Website<br/>Docs",
  },
];

/*
 * Values that would break a Webhook template filled in as raw text: quotes,
 * backslashes, newlines, replacement patterns and a placeholder look-alike.
 */
const TRICKY_TITLE: string = 'Say "hello" to C:\\new\\path $& $1 {{x}}';
const TRICKY_DESCRIPTION: string =
  'Line one\nLine "two"\r\n\ttabbed \\ backslash </script> \u2028 done';

function queue(trigger: TriggerCase, row: Row): void {
  if (trigger.job === CREATED_JOB) {
    createdRows = [row];
  } else {
    updatedRows = [row];
  }
}

function defaultSms(trigger: TriggerCase): string {
  return `${trigger.smsPrefix} ${TITLE} on Acme Status. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`;
}

function defaultChat(trigger: TriggerCase): string {
  return `## ${trigger.chatHeading} - ${TITLE}

**Description:** ${DESCRIPTION}

[View Status Page](${STATUS_PAGE_URL}) | [Unsubscribe](${UNSUBSCRIBE_URL})`;
}

function webhookStarter(trigger: TriggerCase): string {
  const starter: string | undefined = getDefaultSubscriberNotificationTemplate(
    trigger.eventType,
    StatusPageSubscriberNotificationMethod.Webhook,
  )?.body;

  expect(starter).toBeTruthy();

  return starter!;
}

function lastStatusWrite(): JSONObject {
  const writes: Array<JSONObject> = statusWrites();
  return writes[writes.length - 1]!;
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setImmediate(resolve);
  });
}

function expectOtherChannelsToSendDefaults(trigger: TriggerCase): void {
  expect(sentMail()).toHaveLength(1);
  expect(sentMail()[0]!.mail["templateType"]).toBe(trigger.emailTemplateType);
  expect(sentSms()).toEqual([defaultSms(trigger)]);
  expect(sentSlack()).toEqual([defaultChat(trigger)]);
  expect(sentTeams()).toEqual([defaultChat(trigger)]);
}

describe.each(TRIGGERS)(
  "Announcement $name notification channels",
  (trigger: TriggerCase) => {
    describe("without custom templates", () => {
      test.each(RESOURCE_CASES)(
        "sends every channel's default message $label",
        async (resourceCase: ResourceCase) => {
          resourcesByStatusPage = {
            [STATUS_PAGE_ID.toString()]: resourceCase.resources(),
          };
          queue(trigger, announcement({ monitorIds: resourceCase.monitorIds }));

          await runJob(trigger.job);

          expect(sentMail()).toHaveLength(1);
          const { mail } = sentMail()[0]!;
          expect(mail["templateType"]).toBe(trigger.emailTemplateType);
          expect(mail["subject"]).toBe(`${trigger.emailSubjectPrefix}${TITLE}`);
          expect(mail["vars"]).toEqual({
            statusPageName: "Acme Status",
            statusPageUrl: STATUS_PAGE_URL,
            detailsUrl: DETAILS_URL,
            logoUrl: "",
            isPublicStatusPage: "true",
            announcementTitle: TITLE,
            announcementDescription: DESCRIPTION_HTML,
            subscriberEmailNotificationFooterText: "Footer text",
            unsubscribeUrl: UNSUBSCRIBE_URL,
          });

          expect(sentSms()).toEqual([defaultSms(trigger)]);
          expect(sentSlack()).toEqual([defaultChat(trigger)]);
          expect(sentTeams()).toEqual([defaultChat(trigger)]);

          const payloads: Array<JSONObject> = sentWebhooks();
          expect(payloads).toHaveLength(1);
          expect(payloads[0]).toEqual(
            defaultWebhookPayload(trigger.webhookEventType),
          );
          expect(Object.keys(payloads[0]!).sort()).toEqual(
            [
              "eventType",
              "statusPageId",
              "statusPageName",
              "statusPageUrl",
              "unsubscribeUrl",
              "data",
            ].sort(),
          );
          expect(
            Object.keys(payloads[0]!["data"] as JSONObject).sort(),
          ).toEqual(
            [
              "announcementId",
              "announcementTitle",
              "announcementDescription",
              "detailsUrl",
            ].sort(),
          );
          expect(logger.warn).not.toHaveBeenCalled();
        },
      );

      test("sends SMS, Slack and Teams messages equal to the dashboard starters", async () => {
        queue(trigger, announcement());

        await runJob(trigger.job);

        expect(sentSms()[0]).toBe(
          dashboardDefault(
            trigger.eventType,
            StatusPageSubscriberNotificationMethod.SMS,
          ),
        );
        expect(sentSlack()[0]).toBe(
          dashboardDefault(
            trigger.eventType,
            StatusPageSubscriberNotificationMethod.Slack,
          ),
        );
        expect(sentTeams()[0]).toBe(
          dashboardDefault(
            trigger.eventType,
            StatusPageSubscriberNotificationMethod.MicrosoftTeams,
          ),
        );
      });

      test.each(RESOURCE_CASES)(
        "sends the webhook payload the dashboard's Webhook starter compiles to $label",
        async (resourceCase: ResourceCase) => {
          resourcesByStatusPage = {
            [STATUS_PAGE_ID.toString()]: resourceCase.resources(),
          };
          queue(trigger, announcement({ monitorIds: resourceCase.monitorIds }));

          await runJob(trigger.job);

          const compiled: JSONObject | null =
            StatusPageSubscriberWebhookTemplate.compile(
              webhookStarter(trigger),
              templateValues({
                resourcesAffected: resourceCase.resourcesAffected,
              }),
            );

          expect(compiled).not.toBeNull();
          expect(sentWebhooks()).toEqual([compiled]);
        },
      );

      test("sends the same payload when the dashboard's Webhook starter is saved unchanged", async () => {
        queue(trigger, announcement());
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Webhook]: {
            body: webhookStarter(trigger),
          },
        });

        await runJob(trigger.job);

        expect(sentWebhooks()).toEqual([
          defaultWebhookPayload(trigger.webhookEventType),
        ]);
        expect(logger.warn).not.toHaveBeenCalled();
      });
    });

    describe("template lookups", () => {
      test("looks up one template per channel, Webhook included, for this event and status page", async () => {
        queue(trigger, announcement());

        await runJob(trigger.job);

        const lookups: Array<JSONObject> = templateLookups();

        expect(lookups).toHaveLength(5);
        expect(
          lookups
            .map((lookup: JSONObject): unknown => {
              return lookup["notificationMethod"];
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
          expect(lookup["eventType"]).toBe(trigger.eventType);
          expect(
            (lookup["statusPageId"] as unknown as ObjectID).toString(),
          ).toBe(STATUS_PAGE_ID.toString());
        }
      });

      test("looks the templates up once per status page, not once per subscriber", async () => {
        queue(trigger, announcement());
        mock(
          StatusPageSubscriberService.getStatusPagesToSendNotification,
        ).mockResolvedValue([
          statusPage(),
          statusPage({ id: SECOND_STATUS_PAGE_ID }),
        ] as never);
        mock(
          StatusPageSubscriberService.getSubscribersByStatusPage,
        ).mockResolvedValue([
          subscriber(),
          subscriber({ id: SECOND_SUBSCRIBER_ID }),
          subscriber({ id: THIRD_SUBSCRIBER_ID }),
        ] as never);

        await runJob(trigger.job);

        expect(sentWebhooks()).toHaveLength(6);

        const lookups: Array<JSONObject> = templateLookups();
        expect(lookups).toHaveLength(10);

        for (const pageId of [STATUS_PAGE_ID, SECOND_STATUS_PAGE_ID]) {
          const methods: Array<unknown> = lookups
            .filter((lookup: JSONObject): boolean => {
              return (
                (lookup["statusPageId"] as unknown as ObjectID).toString() ===
                pageId.toString()
              );
            })
            .map((lookup: JSONObject): unknown => {
              return lookup["notificationMethod"];
            });

          expect(methods).toHaveLength(5);
          expect(methods).toContain(
            StatusPageSubscriberNotificationMethod.Webhook,
          );
        }
      });
    });

    describe("custom Webhook template", () => {
      test("sends the JSON object the template compiles to, without needing any custom config", async () => {
        queue(trigger, announcement());
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Webhook]: {
            body: `{
  "type": "announcement",
  "text": "{{announcementTitle}} on {{statusPageName}}",
  "links": { "details": "{{detailsUrl}}", "unsubscribe": "{{unsubscribeUrl}}", "page": "{{statusPageUrl}}" },
  "ids": ["{{statusPageId}}", "{{ announcementId }}"],
  "priority": 2,
  "silent": false
}`,
          },
        });

        await runJob(trigger.job);

        expect(sentWebhooks()).toEqual([
          {
            type: "announcement",
            text: `${TITLE} on Acme Status`,
            links: {
              details: DETAILS_URL,
              unsubscribe: UNSUBSCRIBE_URL,
              page: STATUS_PAGE_URL,
            },
            ids: [STATUS_PAGE_ID.toString(), ANNOUNCEMENT_ID.toString()],
            priority: 2,
            silent: false,
          },
        ]);
        expect(
          mock(StatusPageSubscriberWebhookUtil.sendWebhookNotification).mock
            .calls[0]![0] as JSONObject,
        ).toEqual(
          expect.objectContaining({
            webhookUrl: URL.fromString(WEBHOOK_URL),
          }),
        );
        expect(logger.warn).not.toHaveBeenCalled();
        expectOtherChannelsToSendDefaults(trigger);
        expect(lastStatusWrite()[trigger.statusColumn]).toBe(
          StatusPageSubscriberNotificationStatus.Success,
        );
      });

      test("keeps double quotes, backslashes and newlines intact", async () => {
        queue(
          trigger,
          announcement({
            title: TRICKY_TITLE,
            description: TRICKY_DESCRIPTION,
          }),
        );
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Webhook]: {
            body: '{"title": "{{announcementTitle}}", "description": "{{announcementDescription}}", "nested": {"both": "{{announcementTitle}} / {{announcementDescription}}"}}',
          },
        });

        await runJob(trigger.job);

        const expected: JSONObject = {
          title: TRICKY_TITLE,
          description: TRICKY_DESCRIPTION,
          nested: { both: `${TRICKY_TITLE} / ${TRICKY_DESCRIPTION}` },
        };

        expect(sentWebhooks()).toEqual([expected]);
        expect(JSON.parse(JSON.stringify(sentWebhooks()[0]))).toEqual(expected);
        expect(logger.warn).not.toHaveBeenCalled();
      });

      test("sends tricky values in the default payload unchanged too", async () => {
        queue(
          trigger,
          announcement({
            title: TRICKY_TITLE,
            description: TRICKY_DESCRIPTION,
          }),
        );

        await runJob(trigger.job);

        expect(sentWebhooks()).toEqual([
          defaultWebhookPayload(trigger.webhookEventType, {
            announcementTitle: TRICKY_TITLE,
            announcementDescription: TRICKY_DESCRIPTION,
          }),
        ]);
      });

      test.each([
        {
          label: "is not valid JSON",
          body: '{"title": "{{announcementTitle}}"',
        },
        {
          label: "puts a variable outside a JSON string",
          body: '{"title": {{announcementTitle}}}',
        },
        {
          label: "is a JSON array",
          body: '["{{announcementTitle}}", "{{statusPageName}}"]',
        },
        {
          label: "is a JSON string",
          body: '"{{announcementTitle}}"',
        },
        {
          label: "is JSON null",
          body: "null",
        },
      ])(
        "falls back to the default payload and logs a warning when the template $label",
        async (invalid: { label: string; body: string }) => {
          queue(trigger, announcement());
          useCustomTemplates({
            [StatusPageSubscriberNotificationMethod.Webhook]: {
              body: invalid.body,
            },
          });

          await runJob(trigger.job);

          expect(sentWebhooks()).toEqual([
            defaultWebhookPayload(trigger.webhookEventType),
          ]);
          expect(logger.warn).toHaveBeenCalledTimes(1);
          const warning: string = mock(logger.warn).mock.calls[0]![0] as string;
          expect(warning).toContain(STATUS_PAGE_ID.toString());
          expect(warning).toContain(trigger.webhookEventType);

          expectOtherChannelsToSendDefaults(trigger);
          expect(lastStatusWrite()).toEqual({
            [trigger.statusColumn]:
              StatusPageSubscriberNotificationStatus.Success,
            [trigger.statusColumn === "subscriberNotificationStatus"
              ? "subscriberNotificationStatusMessage"
              : "subscriberNotificationStatusMessageOnAnnouncementUpdated"]:
              trigger.successMessage,
          });
        },
      );

      test("fills the description as written, not the SMS or email conversion", async () => {
        queue(trigger, announcement());
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Webhook]: {
            body: '{"description": "{{announcementDescription}}"}',
          },
        });

        await runJob(trigger.job);

        expect(sentWebhooks()).toEqual([{ description: DESCRIPTION }]);
      });

      test("is independent of the chat templates", async () => {
        queue(trigger, announcement());
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Slack]: {
            body: "Slack: {{announcementTitle}}",
          },
          [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
            body: "Teams: {{announcementTitle}}",
          },
        });

        await runJob(trigger.job);

        expect(sentSlack()).toEqual([`Slack: ${TITLE}`]);
        expect(sentTeams()).toEqual([`Teams: ${TITLE}`]);
        expect(sentWebhooks()).toEqual([
          defaultWebhookPayload(trigger.webhookEventType),
        ]);
      });
    });

    describe("every documented variable", () => {
      test("the documented variables include the ids and affected resources", () => {
        expect(
          SubscriberNotificationTemplateVariables.getVariableNames(
            trigger.eventType,
          ),
        ).toEqual(
          expect.arrayContaining([
            "statusPageId",
            "announcementId",
            "resourcesAffected",
            "unsubscribeUrl",
          ]),
        );
      });

      describe.each(RESOURCE_CASES)("$label", (resourceCase: ResourceCase) => {
        beforeEach(() => {
          resourcesByStatusPage = {
            [STATUS_PAGE_ID.toString()]: resourceCase.resources(),
          };
          queue(trigger, announcement({ monitorIds: resourceCase.monitorIds }));
          mock(
            StatusPageSubscriberService.getStatusPagesToSendNotification,
          ).mockResolvedValue([
            statusPage({ withCustomSmtp: true, withCustomSms: true }),
          ] as never);
          useCustomTemplates({
            [StatusPageSubscriberNotificationMethod.Email]: {
              body: everyVariableTemplate(trigger.eventType),
              subject: everyVariableTemplate(trigger.eventType),
            },
            [StatusPageSubscriberNotificationMethod.SMS]: {
              body: everyVariableTemplate(trigger.eventType),
            },
            [StatusPageSubscriberNotificationMethod.Slack]: {
              body: everyVariableTemplate(trigger.eventType),
            },
            [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
              body: everyVariableTemplate(trigger.eventType),
            },
            [StatusPageSubscriberNotificationMethod.Webhook]: {
              body: everyVariableWebhookTemplate(trigger.eventType),
            },
          });
        });

        test("fills every variable in a custom Email template and subject, with the HTML description", async () => {
          await runJob(trigger.job);

          const expected: string = everyVariableMessage(trigger.eventType, {
            ...templateValues({
              resourcesAffected: resourceCase.resourcesAffected,
            }),
            announcementDescription: DESCRIPTION_HTML,
          });

          expect(sentMail()).toHaveLength(1);
          const { mail } = sentMail()[0]!;
          expect(mail["templateType"]).toBe(EmailTemplateType.BlankTemplate);
          expect(mail["vars"]).toEqual({ body: expected });
          expect(mail["subject"]).toBe(expected);
          expect(expected).not.toContain("{{");
          expect(expected).toContain(
            `statusPageId=[${STATUS_PAGE_ID.toString()}]`,
          );
          expect(expected).toContain(
            `announcementId=[${ANNOUNCEMENT_ID.toString()}]`,
          );
          expect(expected).toContain(
            `resourcesAffected=[${resourceCase.resourcesAffected}]`,
          );
        });

        test("fills every variable in a custom SMS template, with the plain-text description", async () => {
          await runJob(trigger.job);

          const expected: string = everyVariableMessage(trigger.eventType, {
            ...templateValues({
              resourcesAffected: resourceCase.resourcesAffected,
            }),
            announcementDescription: DESCRIPTION_TEXT,
          });

          expect(sentSms()).toEqual([expected]);
          expect(expected).not.toContain("{{");
          expect(expected).toContain(
            `statusPageId=[${STATUS_PAGE_ID.toString()}]`,
          );
          expect(expected).toContain(
            `announcementId=[${ANNOUNCEMENT_ID.toString()}]`,
          );
          expect(expected).toContain(
            `resourcesAffected=[${resourceCase.resourcesAffected}]`,
          );
        });

        test("fills every variable in a custom Slack template", async () => {
          await runJob(trigger.job);

          const expected: string = everyVariableMessage(
            trigger.eventType,
            templateValues({
              resourcesAffected: resourceCase.resourcesAffected,
            }),
          );

          expect(sentSlack()).toEqual([expected]);
          expect(expected).not.toContain("{{");
          expect(expected).toContain(
            `announcementDescription=[${DESCRIPTION}]`,
          );
          expect(expected).toContain(
            `resourcesAffected=[${resourceCase.resourcesAffected}]`,
          );
        });

        test("fills every variable in a custom Microsoft Teams template", async () => {
          await runJob(trigger.job);

          const expected: string = everyVariableMessage(
            trigger.eventType,
            templateValues({
              resourcesAffected: resourceCase.resourcesAffected,
            }),
          );

          expect(sentTeams()).toEqual([expected]);
          expect(expected).not.toContain("{{");
          expect(expected).toContain(
            `statusPageId=[${STATUS_PAGE_ID.toString()}]`,
          );
          expect(expected).toContain(
            `announcementId=[${ANNOUNCEMENT_ID.toString()}]`,
          );
        });

        test("fills every variable in a custom Webhook template", async () => {
          await runJob(trigger.job);

          const expected: JSONObject = everyVariablePayload(
            trigger.eventType,
            templateValues({
              resourcesAffected: resourceCase.resourcesAffected,
            }),
          );

          expect(sentWebhooks()).toEqual([expected]);
          expect(JSON.stringify(sentWebhooks()[0])).not.toContain("{{");
          expect(expected["statusPageId"]).toBe(STATUS_PAGE_ID.toString());
          expect(expected["announcementId"]).toBe(ANNOUNCEMENT_ID.toString());
          expect(expected["resourcesAffected"]).toBe(
            resourceCase.resourcesAffected,
          );
          expect(logger.warn).not.toHaveBeenCalled();
        });

        test("still sends the default Email and SMS when the page has no custom SMTP or SMS config", async () => {
          mock(
            StatusPageSubscriberService.getStatusPagesToSendNotification,
          ).mockResolvedValue([statusPage()] as never);

          await runJob(trigger.job);

          expect(sentMail()[0]!.mail["templateType"]).toBe(
            trigger.emailTemplateType,
          );
          expect(sentMail()[0]!.mail["subject"]).toBe(
            `${trigger.emailSubjectPrefix}${TITLE}`,
          );
          expect(sentSms()).toEqual([defaultSms(trigger)]);

          // Chat and Webhook templates need no custom config.
          expect(sentSlack()[0]).toContain("statusPageId=[");
          expect(sentTeams()[0]).toContain("statusPageId=[");
          expect(sentWebhooks()[0]!["statusPageId"]).toBe(
            STATUS_PAGE_ID.toString(),
          );
        });
      });
    });

    describe("affected resources", () => {
      const RESOURCES_TEMPLATE: CustomTemplates = {
        [StatusPageSubscriberNotificationMethod.Slack]: {
          body: "resources=[{{resourcesAffected}}]",
        },
        [StatusPageSubscriberNotificationMethod.Webhook]: {
          body: '{"page": "{{statusPageId}}", "resources": "{{resourcesAffected}}"}',
        },
      };

      test("does not look resources up, and leaves them empty, when the announcement names no monitors", async () => {
        queue(trigger, announcement());
        useCustomTemplates(RESOURCES_TEMPLATE);

        await runJob(trigger.job);

        expect(StatusPageResourceService.findAllBy).not.toHaveBeenCalled();
        expect(sentSlack()).toEqual(["resources=[]"]);
        expect(sentWebhooks()).toEqual([
          { page: STATUS_PAGE_ID.toString(), resources: "" },
        ]);
      });

      test("looks up this page's resources for the announcement's monitors, with their groups", async () => {
        queue(
          trigger,
          announcement({ monitorIds: [MONITOR_ID, SECOND_MONITOR_ID] }),
        );

        await runJob(trigger.job);

        expect(StatusPageResourceService.findAllBy).toHaveBeenCalledTimes(1);
        const args: JSONObject = mock(StatusPageResourceService.findAllBy).mock
          .calls[0]![0] as JSONObject;
        const query: JSONObject = args["query"] as JSONObject;
        const select: JSONObject = args["select"] as JSONObject;

        expect((query["statusPageId"] as unknown as ObjectID).toString()).toBe(
          STATUS_PAGE_ID.toString(),
        );
        expect(JSON.stringify(query["monitorId"])).toContain(
          MONITOR_ID.toString(),
        );
        expect(JSON.stringify(query["monitorId"])).toContain(
          SECOND_MONITOR_ID.toString(),
        );
        expect(select).toEqual({
          _id: true,
          displayName: true,
          statusPageId: true,
          statusPageGroupId: true,
          statusPageGroup: {
            name: true,
          },
        });
      });

      test("lists resources without a group comma separated", async () => {
        resourcesByStatusPage = {
          [STATUS_PAGE_ID.toString()]: [
            pageResource({ displayName: "Checkout API" }),
            pageResource({ displayName: "Website" }),
          ],
        };
        queue(trigger, announcement({ monitorIds: [MONITOR_ID] }));
        useCustomTemplates(RESOURCES_TEMPLATE);

        await runJob(trigger.job);

        expect(sentSlack()).toEqual(["resources=[Checkout API, Website]"]);
        expect(sentWebhooks()).toEqual([
          {
            page: STATUS_PAGE_ID.toString(),
            resources: "Checkout API, Website",
          },
        ]);
      });

      test("groups resources by their status page group, as the incident senders do", async () => {
        const resources: Array<StatusPageResource> = [
          pageResource({ displayName: "Checkout API", groupName: "EU" }),
          pageResource({ displayName: "Docs" }),
          pageResource({ displayName: "Website", groupName: "EU" }),
        ];
        resourcesByStatusPage = { [STATUS_PAGE_ID.toString()]: resources };
        queue(trigger, announcement({ monitorIds: [MONITOR_ID] }));
        useCustomTemplates(RESOURCES_TEMPLATE);

        await runJob(trigger.job);

        const expected: string = "EU: Checkout API, Website<br/>Docs";
        expect(
          StatusPageResourceUtil.getResourcesGroupedByGroupName(resources),
        ).toBe(expected);
        expect(sentSlack()).toEqual([`resources=[${expected}]`]);
        expect(sentWebhooks()).toEqual([
          { page: STATUS_PAGE_ID.toString(), resources: expected },
        ]);
      });

      test("is empty when none of the monitors are on this status page", async () => {
        queue(trigger, announcement({ monitorIds: [MONITOR_ID] }));
        useCustomTemplates(RESOURCES_TEMPLATE);

        await runJob(trigger.job);

        expect(StatusPageResourceService.findAllBy).toHaveBeenCalledTimes(1);
        expect(sentSlack()).toEqual(["resources=[]"]);
        expect(sentWebhooks()).toEqual([
          { page: STATUS_PAGE_ID.toString(), resources: "" },
        ]);
      });

      test("gives each status page its own resources and id", async () => {
        const secondWebhookUrl: string = "https://hooks.acme.com/second";
        resourcesByStatusPage = {
          [STATUS_PAGE_ID.toString()]: [
            pageResource({ displayName: "Checkout API" }),
          ],
          [SECOND_STATUS_PAGE_ID.toString()]: [
            pageResource({
              displayName: "Website",
              statusPageId: SECOND_STATUS_PAGE_ID,
              groupName: "US",
            }),
          ],
        };
        queue(trigger, announcement({ monitorIds: [MONITOR_ID] }));
        mock(
          StatusPageSubscriberService.getStatusPagesToSendNotification,
        ).mockResolvedValue([
          statusPage(),
          statusPage({ id: SECOND_STATUS_PAGE_ID }),
        ] as never);
        mock(
          StatusPageSubscriberService.getSubscribersByStatusPage,
        ).mockImplementation(
          async (pageId: unknown): Promise<Array<StatusPageSubscriber>> => {
            return (pageId as ObjectID).toString() ===
              SECOND_STATUS_PAGE_ID.toString()
              ? [
                  subscriber({
                    id: SECOND_SUBSCRIBER_ID,
                    webhookUrl: secondWebhookUrl,
                  }),
                ]
              : [subscriber()];
          },
        );
        useCustomTemplates(RESOURCES_TEMPLATE);

        await runJob(trigger.job);

        expect(StatusPageResourceService.findAllBy).toHaveBeenCalledTimes(2);
        expect(sentWebhooksByUrl()).toEqual({
          [URL.fromString(WEBHOOK_URL).toString()]: {
            page: STATUS_PAGE_ID.toString(),
            resources: "Checkout API",
          },
          [URL.fromString(secondWebhookUrl).toString()]: {
            page: SECOND_STATUS_PAGE_ID.toString(),
            resources: "US: Website",
          },
        });
        expect(sentSlack().sort()).toEqual(
          ["resources=[Checkout API]", "resources=[US: Website]"].sort(),
        );
      });

      test.each(RESOURCE_CASES)(
        "decides who is notified from the same resources as before $label",
        async (resourceCase: ResourceCase) => {
          const resources: Array<StatusPageResource> = resourceCase.resources();
          resourcesByStatusPage = { [STATUS_PAGE_ID.toString()]: resources };
          queue(trigger, announcement({ monitorIds: resourceCase.monitorIds }));
          mock(
            StatusPageSubscriberService.getSubscribersByStatusPage,
          ).mockResolvedValue([
            subscriber(),
            subscriber({
              id: SECOND_SUBSCRIBER_ID,
              webhookUrl: "https://hooks.acme.com/opted-out",
            }),
          ] as never);
          mock(
            StatusPageSubscriberService.shouldSendNotification,
          ).mockImplementation((args: unknown): boolean => {
            return (
              (
                args as { subscriber: StatusPageSubscriber }
              ).subscriber.id!.toString() !== SECOND_SUBSCRIBER_ID.toString()
            );
          });

          await runJob(trigger.job);

          const calls: Array<Array<unknown>> = mock(
            StatusPageSubscriberService.shouldSendNotification,
          ).mock.calls;
          expect(calls).toHaveLength(2);

          for (const call of calls) {
            const args: {
              statusPageResources: Array<StatusPageResource>;
              statusPage: StatusPage;
              eventType: StatusPageEventType;
            } = call[0] as {
              statusPageResources: Array<StatusPageResource>;
              statusPage: StatusPage;
              eventType: StatusPageEventType;
            };

            if (resourceCase.monitorIds.length > 0) {
              expect(args.statusPageResources).toBe(resources);
            } else {
              expect(args.statusPageResources).toEqual([]);
            }
            expect(args.statusPage.id!.toString()).toBe(
              STATUS_PAGE_ID.toString(),
            );
            expect(args.eventType).toBe(StatusPageEventType.Announcement);
          }

          expect(Object.keys(sentWebhooksByUrl())).toEqual([
            URL.fromString(WEBHOOK_URL).toString(),
          ]);
          expect(sentMail()).toHaveLength(1);
          expect(sentSms()).toHaveLength(1);
          expect(sentSlack()).toHaveLength(1);
          expect(sentTeams()).toHaveLength(1);
        },
      );
    });

    describe("failure isolation", () => {
      beforeEach(() => {
        mock(
          StatusPageSubscriberService.getSubscribersByStatusPage,
        ).mockResolvedValue([
          subscriber(),
          subscriber({
            id: SECOND_SUBSCRIBER_ID,
            webhookUrl: "https://hooks.acme.com/second",
          }),
        ] as never);
      });

      test("a failing webhook send does not stop other channels or subscribers, or fail the job", async () => {
        const error: Error = new Error("webhook endpoint down");
        mock(
          StatusPageSubscriberWebhookUtil.sendWebhookNotification,
        ).mockRejectedValue(error as never);
        queue(trigger, announcement());

        await runJob(trigger.job);
        await flushPromises();

        expect(sentWebhooks()).toHaveLength(2);
        expect(sentMail()).toHaveLength(2);
        expect(sentSms()).toHaveLength(2);
        expect(sentSlack()).toHaveLength(2);
        expect(sentTeams()).toHaveLength(2);
        expect(logger.error).toHaveBeenCalledWith(error, EXTERNAL_FAULT);
        expect(lastStatusWrite()[trigger.statusColumn]).toBe(
          StatusPageSubscriberNotificationStatus.Success,
        );
      });

      test("a failing custom-template webhook send does not stop other channels or fail the job", async () => {
        const error: Error = new Error("webhook endpoint down");
        mock(
          StatusPageSubscriberWebhookUtil.sendWebhookNotification,
        ).mockRejectedValue(error as never);
        useCustomTemplates({
          [StatusPageSubscriberNotificationMethod.Webhook]: {
            body: '{"title": "{{announcementTitle}}"}',
          },
        });
        queue(trigger, announcement());

        await runJob(trigger.job);
        await flushPromises();

        expect(sentWebhooks()).toEqual([{ title: TITLE }, { title: TITLE }]);
        expect(sentMail()).toHaveLength(2);
        expect(sentSms()).toHaveLength(2);
        expect(sentSlack()).toHaveLength(2);
        expect(sentTeams()).toHaveLength(2);
        expect(logger.error).toHaveBeenCalledWith(error, EXTERNAL_FAULT);
        expect(lastStatusWrite()[trigger.statusColumn]).toBe(
          StatusPageSubscriberNotificationStatus.Success,
        );
      });

      test("a failing Microsoft Teams send does not stop other channels or subscribers, or fail the job", async () => {
        const error: Error = new Error("teams webhook gone");
        mock(
          MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
        ).mockRejectedValue(error as never);
        queue(trigger, announcement());

        await runJob(trigger.job);
        await flushPromises();

        expect(sentTeams()).toHaveLength(2);
        expect(sentWebhooks()).toEqual([
          defaultWebhookPayload(trigger.webhookEventType),
          defaultWebhookPayload(trigger.webhookEventType),
        ]);
        expect(sentMail()).toHaveLength(2);
        expect(sentSms()).toHaveLength(2);
        expect(sentSlack()).toHaveLength(2);
        expect(logger.error).toHaveBeenCalledWith(error, EXTERNAL_FAULT);
        expect(lastStatusWrite()[trigger.statusColumn]).toBe(
          StatusPageSubscriberNotificationStatus.Success,
        );
      });
    });
  },
);
