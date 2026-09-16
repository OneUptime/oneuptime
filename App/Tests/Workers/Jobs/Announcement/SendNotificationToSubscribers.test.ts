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
      /*
       * The real substitution: {{name}} -> value. A jest.fn so the tests can
       * read the variables each channel was given; clearAllMocks keeps the
       * implementation.
       */
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
const THIRD_STATUS_PAGE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const API_MONITOR_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const WEBSITE_MONITOR_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const CORE_GROUP_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const EDGE_GROUP_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);

const GROUP_IDS: Record<string, ObjectID> = {
  Core: CORE_GROUP_ID,
  Edge: EDGE_GROUP_ID,
};

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

// The two affected resources, in the "Core" group, as the worker formats them.
const RESOURCES_AFFECTED: string = "Core: API, Website";

/*
 * The same two resources split across the "Core" and "Edge" groups. The email
 * body renders HTML, so it gets one group per line; every other channel shows
 * "<br/>" literally, so it gets the groups on one line.
 */
const RESOURCES_AFFECTED_HTML: string = "Core: API<br/>Edge: Website";
const RESOURCES_AFFECTED_TEXT: string = "Core: API; Edge: Website";

type Row = StatusPageAnnouncement;

let createdRows: Array<Row> = [];
let updatedRows: Array<Row> = [];
let skipRows: Array<Row> = [];

// StatusPageResource rows returned for each status page id.
let resourcesByStatusPage: Record<string, Array<StatusPageResource>> = {};

function announcement(overrides?: {
  id?: ObjectID;
  subscriberNotificationStatus?: StatusPageSubscriberNotificationStatus;
  showAnnouncementAt?: Date;
  withoutStatusPages?: boolean;
  monitorIds?: Array<ObjectID>;
  statusPageIds?: Array<ObjectID>;
}): Row {
  const row: Row = new StatusPageAnnouncement();
  row._id = (overrides?.id || ANNOUNCEMENT_ID).toString();
  row.title = TITLE;
  row.description = DESCRIPTION;
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
    row.statusPages = (overrides?.statusPageIds || [STATUS_PAGE_ID]).map(
      (statusPageId: ObjectID): StatusPage => {
        const page: StatusPage = new StatusPage();
        page._id = statusPageId.toString();
        return page;
      },
    );
  }

  return row;
}

// An announcement scoped to the API and Website monitors.
function scopedAnnouncement(): Row {
  return announcement({ monitorIds: [API_MONITOR_ID, WEBSITE_MONITOR_ID] });
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
    (page as unknown as JSONObject)["callSmsConfig"] = { _id: "twilio" };
  }

  return page;
}

// A status page whose custom email and SMS templates are used.
function statusPageWithCustomDelivery(id?: ObjectID): StatusPage {
  return statusPage({
    id: id || STATUS_PAGE_ID,
    withCustomSmtp: true,
    withCustomSms: true,
  });
}

function resource(data: {
  statusPageId: ObjectID;
  displayName: string;
  groupName?: string;
}): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = ObjectID.generate().toString();
  row.displayName = data.displayName;
  row.statusPageId = data.statusPageId;

  if (data.groupName) {
    const groupId: ObjectID = GROUP_IDS[data.groupName]!;
    const group: StatusPageGroup = new StatusPageGroup();
    group._id = groupId.toString();
    group.name = data.groupName;
    row.statusPageGroupId = groupId;
    row.statusPageGroup = group;
  }

  return row;
}

// The API and Website resources, both in the "Core" group.
function coreResources(statusPageId: ObjectID): Array<StatusPageResource> {
  return [
    resource({
      statusPageId: statusPageId,
      displayName: "API",
      groupName: "Core",
    }),
    resource({
      statusPageId: statusPageId,
      displayName: "Website",
      groupName: "Core",
    }),
  ];
}

// The API resource in the "Core" group and the Website resource in "Edge".
function resourcesInTwoGroups(
  statusPageId: ObjectID,
): Array<StatusPageResource> {
  return [
    resource({
      statusPageId: statusPageId,
      displayName: "API",
      groupName: "Core",
    }),
    resource({
      statusPageId: statusPageId,
      displayName: "Website",
      groupName: "Edge",
    }),
  ];
}

function subscriber(): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row._id = SUBSCRIBER_ID.toString();
  row.subscriberEmail = new Email("customer@example.com");
  row.subscriberPhone = new Phone("+15555550100");
  row.slackIncomingWebhookUrl = URL.fromString(SLACK_URL);
  row.microsoftTeamsIncomingWebhookUrl = URL.fromString(TEAMS_URL);
  row.subscriberWebhook = URL.fromString(WEBHOOK_URL);
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

interface CompileTemplateCall {
  template: string;
  variables: Record<string, string>;
}

// Every compileTemplate call, in order.
function compileTemplateCalls(): Array<CompileTemplateCall> {
  return mock(
    StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate,
  ).mock.calls.map((call: Array<unknown>): CompileTemplateCall => {
    return {
      template: call[0] as string,
      variables: call[1] as Record<string, string>,
    };
  });
}

/*
 * The variables each templated channel was compiled with, keyed by the prefix
 * useCustomTemplates gives its template: the notification method, or
 * "Subject" for the email subject. Expects one compile per channel.
 */
function variablesByChannel(): Record<string, Record<string, string>> {
  const byChannel: Record<string, Record<string, string>> = {};

  for (const call of compileTemplateCalls()) {
    const channel: string = call.template.split("|")[0]!;
    expect(byChannel[channel]).toBeUndefined();
    byChannel[channel] = call.variables;
  }

  return byChannel;
}

function resourceLookups(): Array<{ query: JSONObject; select: JSONObject }> {
  return mock(StatusPageResourceService.findAllBy).mock.calls.map(
    (call: Array<unknown>): { query: JSONObject; select: JSONObject } => {
      return call[0] as { query: JSONObject; select: JSONObject };
    },
  );
}

function customTemplate(
  body: string,
  emailSubject?: string,
): StatusPageSubscriberNotificationTemplate {
  const template: StatusPageSubscriberNotificationTemplate =
    new StatusPageSubscriberNotificationTemplate();
  template.templateBody = body;

  if (emailSubject) {
    template.emailSubject = emailSubject;
  }

  return template;
}

/*
 * Gives the status page a custom template on all four templated channels.
 * Each body starts with its channel's name so a test can tell which channel a
 * compiled message came from. The email template also has a custom subject.
 */
function useCustomTemplates(data: { body: string; subject: string }): void {
  mock(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
  ).mockImplementation(async (args: unknown) => {
    const method: StatusPageSubscriberNotificationMethod = (args as JSONObject)[
      "notificationMethod"
    ] as StatusPageSubscriberNotificationMethod;

    if (method === StatusPageSubscriberNotificationMethod.Email) {
      return customTemplate(`Email|${data.body}`, `Subject|${data.subject}`);
    }

    return customTemplate(`${method}|${data.body}`);
  });
}

// The email sent with a custom template: its compiled body and subject.
function sentCustomEmails(): Array<{ body: string; subject: string }> {
  return sentMail().map(
    ({ mail }: { mail: JSONObject }): { body: string; subject: string } => {
      expect(mail["templateType"]).toBe(EmailTemplateType.BlankTemplate);
      return {
        body: (mail["vars"] as JSONObject)["body"] as string,
        subject: mail["subject"] as string,
      };
    },
  );
}

// A template that prints every variable as name=[value], one per line.
function templateUsingEveryVariable(names: Array<string>): string {
  return names
    .map((name: string): string => {
      return `${name}=[{{${name}}}]`;
    })
    .join("\n");
}

// What templateUsingEveryVariable(names) should render to.
function renderedEveryVariable(
  names: Array<string>,
  values: Record<string, string>,
): string {
  return names
    .map((name: string): string => {
      return `${name}=[${values[name]}]`;
    })
    .join("\n");
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
  const variables: Record<string, string> = {
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    detailsUrl: DETAILS_URL,
    announcementTitle: TITLE,
    announcementDescription: DESCRIPTION,
    unsubscribeUrl: UNSUBSCRIBE_URL,
  };

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

  mock(StatusPageResourceService.findAllBy).mockImplementation(
    async (args: unknown): Promise<Array<StatusPageResource>> => {
      const query: JSONObject = (args as { query: JSONObject }).query;
      return resourcesByStatusPage[String(query["statusPageId"])] || [];
    },
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
      ].sort(),
    );

    for (const lookup of lookups) {
      expect(lookup["eventType"]).toBe(
        StatusPageSubscriberNotificationEventType.SubscriberAnnouncementUpdated,
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
 * Custom templates. The dashboard tells template authors which {{variables}}
 * each event offers (SubscriberNotificationTemplateVariables). Both jobs must
 * pass every one of them, with real values, on every templated channel, in
 * the format that channel renders: HTML in the email body, plain text in SMS
 * and the email subject, and the description's Markdown as written in Slack
 * and Teams. Resource lists are plain text everywhere but the email body.
 */

interface TriggerCase {
  name: string;
  job: string;
  eventType: StatusPageSubscriberNotificationEventType;
  queue: (rows: Array<Row>) => void;
}

const TRIGGERS: Array<TriggerCase> = [
  {
    name: "created",
    job: CREATED_JOB,
    eventType:
      StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated,
    queue: (rows: Array<Row>): void => {
      createdRows = rows;
    },
  },
  {
    name: "updated",
    job: UPDATED_JOB,
    eventType:
      StatusPageSubscriberNotificationEventType.SubscriberAnnouncementUpdated,
    queue: (rows: Array<Row>): void => {
      updatedRows = rows;
    },
  },
];

function givenStatusPages(pages: Array<StatusPage>): void {
  mock(
    StatusPageSubscriberService.getStatusPagesToSendNotification,
  ).mockResolvedValue(pages as never);
}

describe.each(TRIGGERS)(
  "custom template variables ($name job)",
  (trigger: TriggerCase) => {
    const variableNames: Array<string> =
      SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
        trigger.eventType,
      );

    test.each([
      { scope: "scoped to resources", scoped: true },
      { scope: "not scoped to resources", scoped: false },
    ])(
      "passes every advertised variable to every templated channel ($scope)",
      async ({ scoped }: { scope: string; scoped: boolean }) => {
        trigger.queue([scoped ? scopedAnnouncement() : announcement()]);
        resourcesByStatusPage[STATUS_PAGE_ID.toString()] =
          coreResources(STATUS_PAGE_ID);
        givenStatusPages([statusPageWithCustomDelivery()]);
        useCustomTemplates({
          body: "{{announcementTitle}}",
          subject: "{{announcementTitle}}",
        });

        await runJob(trigger.job);

        const calls: Array<CompileTemplateCall> = compileTemplateCalls();

        // SMS, Slack, Teams and the email body, plus the email subject.
        expect(
          calls
            .map((call: CompileTemplateCall): string => {
              return call.template.split("|")[0]!;
            })
            .sort(),
        ).toEqual(["Email", "Microsoft Teams", "SMS", "Slack", "Subject"]);
        expect(variableNames.length).toBeGreaterThan(0);

        for (const call of calls) {
          const missing: Array<string> = variableNames.filter(
            (name: string): boolean => {
              return (
                !Object.prototype.hasOwnProperty.call(call.variables, name) ||
                typeof call.variables[name] !== "string"
              );
            },
          );

          expect({ template: call.template, missing: missing }).toEqual({
            template: call.template,
            missing: [],
          });
        }

        // The compiled templates are what each channel sent.
        expect(sentSms()).toEqual([`SMS|${TITLE}`]);
        expect(sentSlack()).toEqual([`Slack|${TITLE}`]);
        expect(sentTeams()).toEqual([`Microsoft Teams|${TITLE}`]);
        expect(sentCustomEmails()).toEqual([
          { body: `Email|${TITLE}`, subject: `Subject|${TITLE}` },
        ]);
      },
    );

    test("renders a template that uses every advertised variable with none left unfilled", async () => {
      trigger.queue([scopedAnnouncement()]);
      resourcesByStatusPage[STATUS_PAGE_ID.toString()] =
        resourcesInTwoGroups(STATUS_PAGE_ID);
      givenStatusPages([statusPageWithCustomDelivery()]);

      const template: string = templateUsingEveryVariable(variableNames);
      useCustomTemplates({ body: template, subject: template });

      await runJob(trigger.job);

      // The values every channel shares, plus the two that depend on format.
      const valuesInFormat: (formatted: {
        description: string;
        resourcesAffected: string;
      }) => Record<string, string> = (formatted: {
        description: string;
        resourcesAffected: string;
      }): Record<string, string> => {
        return {
          statusPageName: "Acme Status",
          statusPageUrl: STATUS_PAGE_URL,
          unsubscribeUrl: UNSUBSCRIBE_URL,
          resourcesAffected: formatted.resourcesAffected,
          announcementTitle: TITLE,
          announcementDescription: formatted.description,
          detailsUrl: DETAILS_URL,
        };
      };

      // This test pins a value for every advertised variable.
      expect(
        Object.keys(
          valuesInFormat({ description: "", resourcesAffected: "" }),
        ).sort(),
      ).toEqual([...variableNames].sort());

      const htmlRendering: string = renderedEveryVariable(
        variableNames,
        valuesInFormat({
          description: DESCRIPTION_HTML,
          resourcesAffected: RESOURCES_AFFECTED_HTML,
        }),
      );
      const plainTextRendering: string = renderedEveryVariable(
        variableNames,
        valuesInFormat({
          description: DESCRIPTION_TEXT,
          resourcesAffected: RESOURCES_AFFECTED_TEXT,
        }),
      );
      const markdownRendering: string = renderedEveryVariable(
        variableNames,
        valuesInFormat({
          description: DESCRIPTION,
          resourcesAffected: RESOURCES_AFFECTED_TEXT,
        }),
      );

      expect(sentSms()).toEqual([`SMS|${plainTextRendering}`]);
      expect(sentSlack()).toEqual([`Slack|${markdownRendering}`]);
      expect(sentTeams()).toEqual([`Microsoft Teams|${markdownRendering}`]);
      expect(sentCustomEmails()).toEqual([
        {
          body: `Email|${htmlRendering}`,
          subject: `Subject|${plainTextRendering}`,
        },
      ]);

      const messages: Array<string> = [
        ...sentSms(),
        ...sentSlack(),
        ...sentTeams(),
        ...sentCustomEmails().flatMap(
          (email: { body: string; subject: string }): Array<string> => {
            return [email.body, email.subject];
          },
        ),
      ];

      expect(messages).toHaveLength(5);

      for (const message of messages) {
        expect(message).not.toMatch(/{{|}}/);
        expect(message).not.toContain("=[]");
      }
    });

    test("gives every channel the same variables apart from the format of the description and the resources", async () => {
      trigger.queue([scopedAnnouncement()]);
      resourcesByStatusPage[STATUS_PAGE_ID.toString()] =
        resourcesInTwoGroups(STATUS_PAGE_ID);
      givenStatusPages([statusPageWithCustomDelivery()]);
      useCustomTemplates({
        body: "{{announcementDescription}}",
        subject: "{{announcementDescription}}",
      });

      await runJob(trigger.job);

      const calls: Array<CompileTemplateCall> = compileTemplateCalls();

      expect(calls).toHaveLength(5);

      for (const call of calls) {
        expect({
          ...call.variables,
          announcementDescription: "",
          resourcesAffected: "",
        }).toEqual({
          statusPageName: "Acme Status",
          statusPageUrl: STATUS_PAGE_URL,
          unsubscribeUrl: UNSUBSCRIBE_URL,
          resourcesAffected: "",
          announcementTitle: TITLE,
          announcementDescription: "",
          detailsUrl: DETAILS_URL,
        });
      }

      /*
       * SMS and the email subject get plain text, the email body HTML, and
       * Slack and Teams the markdown.
       */
      expect(sentSms()).toEqual([`SMS|${DESCRIPTION_TEXT}`]);
      expect(sentSlack()).toEqual([`Slack|${DESCRIPTION}`]);
      expect(sentTeams()).toEqual([`Microsoft Teams|${DESCRIPTION}`]);
      expect(sentCustomEmails()).toEqual([
        {
          body: `Email|${DESCRIPTION_HTML}`,
          subject: `Subject|${DESCRIPTION_TEXT}`,
        },
      ]);
    });

    test("renders HTML in the email body, plain text in SMS and the subject, and Markdown in chat", async () => {
      trigger.queue([scopedAnnouncement()]);
      resourcesByStatusPage[STATUS_PAGE_ID.toString()] =
        resourcesInTwoGroups(STATUS_PAGE_ID);
      givenStatusPages([statusPageWithCustomDelivery()]);
      useCustomTemplates({
        body: "<div>{{announcementDescription}}</div><div>{{resourcesAffected}}</div>",
        subject:
          "{{announcementTitle}}: {{announcementDescription}} ({{resourcesAffected}})",
      });

      await runJob(trigger.job);

      expect(sentCustomEmails()).toEqual([
        {
          body: `Email|<div>${DESCRIPTION_HTML}</div><div>${RESOURCES_AFFECTED_HTML}</div>`,
          subject: `Subject|${TITLE}: ${DESCRIPTION_TEXT} (${RESOURCES_AFFECTED_TEXT})`,
        },
      ]);
      expect(sentSms()).toEqual([
        `SMS|<div>${DESCRIPTION_TEXT}</div><div>${RESOURCES_AFFECTED_TEXT}</div>`,
      ]);
      expect(sentSlack()).toEqual([
        `Slack|<div>${DESCRIPTION}</div><div>${RESOURCES_AFFECTED_TEXT}</div>`,
      ]);
      expect(sentTeams()).toEqual([
        `Microsoft Teams|<div>${DESCRIPTION}</div><div>${RESOURCES_AFFECTED_TEXT}</div>`,
      ]);

      // Only the email body is HTML, so only it may carry the line break.
      for (const message of [
        ...sentSms(),
        ...sentSlack(),
        ...sentTeams(),
        sentCustomEmails()[0]!.subject,
      ]) {
        expect(message).not.toContain("<br/>");
      }
    });

    test("gives each channel its variables in the format it renders", async () => {
      trigger.queue([scopedAnnouncement()]);
      resourcesByStatusPage[STATUS_PAGE_ID.toString()] =
        resourcesInTwoGroups(STATUS_PAGE_ID);
      givenStatusPages([statusPageWithCustomDelivery()]);
      useCustomTemplates({
        body: "{{announcementTitle}}",
        subject: "{{announcementTitle}}",
      });

      await runJob(trigger.job);

      const shared: Record<string, string> = {
        statusPageName: "Acme Status",
        statusPageUrl: STATUS_PAGE_URL,
        detailsUrl: DETAILS_URL,
        announcementTitle: TITLE,
        unsubscribeUrl: UNSUBSCRIBE_URL,
      };

      expect(variablesByChannel()).toEqual({
        [StatusPageSubscriberNotificationMethod.Email]: {
          ...shared,
          announcementDescription: DESCRIPTION_HTML,
          resourcesAffected: RESOURCES_AFFECTED_HTML,
        },
        Subject: {
          ...shared,
          announcementDescription: DESCRIPTION_TEXT,
          resourcesAffected: RESOURCES_AFFECTED_TEXT,
        },
        [StatusPageSubscriberNotificationMethod.SMS]: {
          ...shared,
          announcementDescription: DESCRIPTION_TEXT,
          resourcesAffected: RESOURCES_AFFECTED_TEXT,
        },
        [StatusPageSubscriberNotificationMethod.Slack]: {
          ...shared,
          announcementDescription: DESCRIPTION,
          resourcesAffected: RESOURCES_AFFECTED_TEXT,
        },
        [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
          ...shared,
          announcementDescription: DESCRIPTION,
          resourcesAffected: RESOURCES_AFFECTED_TEXT,
        },
      });
    });

    test("compiles the email subject with the same variables as the body, as plain text", async () => {
      trigger.queue([scopedAnnouncement()]);
      resourcesByStatusPage[STATUS_PAGE_ID.toString()] =
        resourcesInTwoGroups(STATUS_PAGE_ID);
      givenStatusPages([statusPageWithCustomDelivery()]);
      useCustomTemplates({
        body: "{{announcementDescription}}",
        subject: "{{announcementTitle}}: {{announcementDescription}}",
      });

      await runJob(trigger.job);

      const byChannel: Record<
        string,
        Record<string, string>
      > = variablesByChannel();
      const body: Record<string, string> =
        byChannel[StatusPageSubscriberNotificationMethod.Email]!;

      expect(body["announcementDescription"]).toBe(DESCRIPTION_HTML);
      expect(body["resourcesAffected"]).toBe(RESOURCES_AFFECTED_HTML);
      expect(byChannel["Subject"]).toEqual({
        ...body,
        announcementDescription: DESCRIPTION_TEXT,
        resourcesAffected: RESOURCES_AFFECTED_TEXT,
      });
      expect(sentCustomEmails()[0]!.subject).toBe(
        `Subject|${TITLE}: ${DESCRIPTION_TEXT}`,
      );
    });

    test("keeps the webhook's description as written when the page has custom templates", async () => {
      trigger.queue([scopedAnnouncement()]);
      resourcesByStatusPage[STATUS_PAGE_ID.toString()] =
        resourcesInTwoGroups(STATUS_PAGE_ID);
      givenStatusPages([statusPageWithCustomDelivery()]);
      useCustomTemplates({
        body: "{{announcementDescription}}",
        subject: "{{announcementDescription}}",
      });

      await runJob(trigger.job);

      expect(sentWebhooks()).toHaveLength(1);
      expect(sentWebhooks()[0]!["data"]).toEqual({
        announcementId: ANNOUNCEMENT_ID.toString(),
        announcementTitle: TITLE,
        announcementDescription: DESCRIPTION,
        detailsUrl: DETAILS_URL,
      });
      expect(JSON.stringify(sentWebhooks()[0])).not.toMatch(/<br\/>|<p>/);
    });

    test("converts the description once per announcement, however many pages and subscribers", async () => {
      trigger.queue([
        announcement({
          monitorIds: [API_MONITOR_ID, WEBSITE_MONITOR_ID],
          statusPageIds: [STATUS_PAGE_ID, SECOND_STATUS_PAGE_ID],
        }),
      ]);
      resourcesByStatusPage[STATUS_PAGE_ID.toString()] =
        resourcesInTwoGroups(STATUS_PAGE_ID);
      resourcesByStatusPage[SECOND_STATUS_PAGE_ID.toString()] =
        resourcesInTwoGroups(SECOND_STATUS_PAGE_ID);
      givenStatusPages([
        statusPageWithCustomDelivery(STATUS_PAGE_ID),
        statusPageWithCustomDelivery(SECOND_STATUS_PAGE_ID),
      ]);
      mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mockResolvedValue([subscriber(), subscriber()] as never);
      useCustomTemplates({
        body: "{{announcementDescription}}",
        subject: "{{announcementDescription}}",
      });

      await runJob(trigger.job);

      // Two pages with two subscribers each.
      expect(sentSms()).toEqual(
        new Array<string>(4).fill(`SMS|${DESCRIPTION_TEXT}`),
      );
      expect(sentCustomEmails()).toHaveLength(4);

      expect(Markdown.convertToHTML).toHaveBeenCalledTimes(1);
      expect(Markdown.convertToHTML).toHaveBeenCalledWith(
        DESCRIPTION,
        MarkdownContentType.Email,
      );
      expect(Markdown.convertToPlainText).toHaveBeenCalledTimes(1);
      expect(Markdown.convertToPlainText).toHaveBeenCalledWith(DESCRIPTION);
    });

    test("fills resourcesAffected with the announcement's resources, grouped by status page group", async () => {
      trigger.queue([scopedAnnouncement()]);
      resourcesByStatusPage[STATUS_PAGE_ID.toString()] =
        coreResources(STATUS_PAGE_ID);
      givenStatusPages([statusPageWithCustomDelivery()]);
      useCustomTemplates({
        body: "{{resourcesAffected}}",
        subject: "{{resourcesAffected}}",
      });

      await runJob(trigger.job);

      expect(sentSms()).toEqual([`SMS|${RESOURCES_AFFECTED}`]);
      expect(sentSlack()).toEqual([`Slack|${RESOURCES_AFFECTED}`]);
      expect(sentTeams()).toEqual([`Microsoft Teams|${RESOURCES_AFFECTED}`]);
      expect(sentCustomEmails()).toEqual([
        {
          body: `Email|${RESOURCES_AFFECTED}`,
          subject: `Subject|${RESOURCES_AFFECTED}`,
        },
      ]);
    });

    test("lists resources that are in no group as a comma-separated list", async () => {
      trigger.queue([scopedAnnouncement()]);
      resourcesByStatusPage[STATUS_PAGE_ID.toString()] = [
        resource({ statusPageId: STATUS_PAGE_ID, displayName: "API" }),
        resource({ statusPageId: STATUS_PAGE_ID, displayName: "Website" }),
      ];
      givenStatusPages([statusPageWithCustomDelivery()]);
      useCustomTemplates({
        body: "{{resourcesAffected}}",
        subject: "{{resourcesAffected}}",
      });

      await runJob(trigger.job);

      expect(sentSms()).toEqual(["SMS|API, Website"]);
      expect(sentSlack()).toEqual(["Slack|API, Website"]);
      expect(sentTeams()).toEqual(["Microsoft Teams|API, Website"]);
      expect(sentCustomEmails()).toEqual([
        { body: "Email|API, Website", subject: "Subject|API, Website" },
      ]);
    });

    test("leaves resourcesAffected empty when the announcement is not scoped to resources", async () => {
      trigger.queue([announcement()]);
      // Resources exist on the page, but the announcement names none of them.
      resourcesByStatusPage[STATUS_PAGE_ID.toString()] =
        coreResources(STATUS_PAGE_ID);
      givenStatusPages([statusPageWithCustomDelivery()]);
      useCustomTemplates({
        body: "[{{resourcesAffected}}]",
        subject: "[{{resourcesAffected}}]",
      });

      await runJob(trigger.job);

      expect(StatusPageResourceService.findAllBy).not.toHaveBeenCalled();

      const calls: Array<CompileTemplateCall> = compileTemplateCalls();

      expect(calls).toHaveLength(5);

      for (const call of calls) {
        expect(call.variables["resourcesAffected"]).toBe("");
      }

      expect(sentSms()).toEqual(["SMS|[]"]);
      expect(sentSlack()).toEqual(["Slack|[]"]);
      expect(sentTeams()).toEqual(["Microsoft Teams|[]"]);
      expect(sentCustomEmails()).toEqual([
        { body: "Email|[]", subject: "Subject|[]" },
      ]);
    });

    test("uses only the resources on the status page being notified", async () => {
      trigger.queue([
        announcement({
          monitorIds: [API_MONITOR_ID, WEBSITE_MONITOR_ID],
          statusPageIds: [
            STATUS_PAGE_ID,
            SECOND_STATUS_PAGE_ID,
            THIRD_STATUS_PAGE_ID,
          ],
        }),
      ]);
      resourcesByStatusPage[STATUS_PAGE_ID.toString()] =
        coreResources(STATUS_PAGE_ID);
      resourcesByStatusPage[SECOND_STATUS_PAGE_ID.toString()] = [
        resource({ statusPageId: SECOND_STATUS_PAGE_ID, displayName: "API" }),
      ];
      // The third page shows none of the announcement's monitors.
      givenStatusPages([
        statusPageWithCustomDelivery(STATUS_PAGE_ID),
        statusPageWithCustomDelivery(SECOND_STATUS_PAGE_ID),
        statusPageWithCustomDelivery(THIRD_STATUS_PAGE_ID),
      ]);
      useCustomTemplates({
        body: "[{{resourcesAffected}}]",
        subject: "[{{resourcesAffected}}]",
      });

      await runJob(trigger.job);

      expect(
        resourceLookups().map((lookup: { query: JSONObject }): string => {
          return String(lookup.query["statusPageId"]);
        }),
      ).toEqual([
        STATUS_PAGE_ID.toString(),
        SECOND_STATUS_PAGE_ID.toString(),
        THIRD_STATUS_PAGE_ID.toString(),
      ]);

      expect(sentSms()).toEqual([
        `SMS|[${RESOURCES_AFFECTED}]`,
        "SMS|[API]",
        "SMS|[]",
      ]);
      expect(sentSlack()).toEqual([
        `Slack|[${RESOURCES_AFFECTED}]`,
        "Slack|[API]",
        "Slack|[]",
      ]);
      expect(sentTeams()).toEqual([
        `Microsoft Teams|[${RESOURCES_AFFECTED}]`,
        "Microsoft Teams|[API]",
        "Microsoft Teams|[]",
      ]);
      expect(sentCustomEmails()).toEqual([
        {
          body: `Email|[${RESOURCES_AFFECTED}]`,
          subject: `Subject|[${RESOURCES_AFFECTED}]`,
        },
        { body: "Email|[API]", subject: "Subject|[API]" },
        { body: "Email|[]", subject: "Subject|[]" },
      ]);
    });

    test("loads each page's resources for the announcement's monitors, with their group names", async () => {
      trigger.queue([scopedAnnouncement()]);

      await runJob(trigger.job);

      const lookups: Array<{ query: JSONObject; select: JSONObject }> =
        resourceLookups();

      expect(lookups).toHaveLength(1);
      expect(lookups[0]!.select).toEqual({
        _id: true,
        displayName: true,
        statusPageId: true,
        statusPageGroupId: true,
        statusPageGroup: {
          name: true,
        },
      });
      expect(lookups[0]!.query["statusPageId"]).toEqual(
        new ObjectID(STATUS_PAGE_ID.toString()),
      );

      const monitorFilter: { objectLiteralParameters?: JSONObject } =
        lookups[0]!.query["monitorId"] as unknown as {
          objectLiteralParameters?: JSONObject;
        };

      expect(
        Object.values(monitorFilter.objectLiteralParameters || {}),
      ).toEqual([[API_MONITOR_ID.toString(), WEBSITE_MONITOR_ID.toString()]]);
    });

    test("keeps the default messages unchanged for an announcement scoped to resources", async () => {
      trigger.queue([scopedAnnouncement()]);
      resourcesByStatusPage[STATUS_PAGE_ID.toString()] =
        resourcesInTwoGroups(STATUS_PAGE_ID);

      await runJob(trigger.job);

      expect(compileTemplateCalls()).toEqual([]);
      expect(sentSms()).toEqual([
        dashboardDefault(
          trigger.eventType,
          StatusPageSubscriberNotificationMethod.SMS,
        ),
      ]);
      expect(sentSlack()).toEqual([
        dashboardDefault(
          trigger.eventType,
          StatusPageSubscriberNotificationMethod.Slack,
        ),
      ]);
      expect(sentTeams()).toEqual([
        dashboardDefault(
          trigger.eventType,
          StatusPageSubscriberNotificationMethod.MicrosoftTeams,
        ),
      ]);

      const mail: JSONObject = sentMail()[0]!.mail;
      const vars: JSONObject = mail["vars"] as JSONObject;

      // The default email template renders HTML, so it still gets HTML.
      expect(mail["templateType"]).toBe(
        trigger.eventType ===
          StatusPageSubscriberNotificationEventType.SubscriberAnnouncementUpdated
          ? EmailTemplateType.SubscriberAnnouncementUpdated
          : EmailTemplateType.SubscriberAnnouncementCreated,
      );
      expect(vars["announcementDescription"]).toBe(DESCRIPTION_HTML);

      expect(Object.keys(vars).sort()).toEqual(
        [
          "statusPageName",
          "statusPageUrl",
          "detailsUrl",
          "logoUrl",
          "isPublicStatusPage",
          "announcementTitle",
          "announcementDescription",
          "subscriberEmailNotificationFooterText",
          "unsubscribeUrl",
        ].sort(),
      );
    });

    test("sends the default SMS when the page has an SMS template but no custom SMS provider", async () => {
      trigger.queue([scopedAnnouncement()]);
      resourcesByStatusPage[STATUS_PAGE_ID.toString()] =
        coreResources(STATUS_PAGE_ID);
      givenStatusPages([statusPage({ withCustomSmtp: true })]);
      useCustomTemplates({
        body: "{{resourcesAffected}}",
        subject: "{{resourcesAffected}}",
      });

      await runJob(trigger.job);

      expect(sentSms()).toEqual([
        dashboardDefault(
          trigger.eventType,
          StatusPageSubscriberNotificationMethod.SMS,
        ),
      ]);
      expect(sentSlack()).toEqual([`Slack|${RESOURCES_AFFECTED}`]);
    });
  },
);
