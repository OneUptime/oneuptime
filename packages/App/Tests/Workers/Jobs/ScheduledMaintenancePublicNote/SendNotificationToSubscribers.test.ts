import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberNotificationTemplateVariables from "Common/Types/StatusPage/SubscriberNotificationTemplateVariables";
import SubscriberUpdateNotification from "Common/Types/StatusPage/SubscriberUpdateNotification";

/*
 * Scheduled maintenance public note notifications: "note posted" and the new
 * "note updated" job share one send path. A maintenance note is where a moved
 * window or a changed scope is usually announced, which is exactly the edit
 * subscribers most need to hear about.
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

jest.mock(
  "Common/Server/Services/ScheduledMaintenancePublicNoteService",
  () => {
    return {
      __esModule: true,
      default: { findAllBy: jest.fn(), updateOneById: jest.fn() },
    };
  },
);

jest.mock("Common/Server/Services/ScheduledMaintenanceService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      getScheduledMaintenanceLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ScheduledMaintenanceFeedService", () => {
  return {
    __esModule: true,
    default: { createScheduledMaintenanceFeedItem: jest.fn() },
  };
});

jest.mock("Common/Server/Services/StatusPageResourceService", () => {
  return { __esModule: true, default: { findAllBy: jest.fn() } };
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
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenancePublicNoteService from "Common/Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
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
import "../../../../FeatureSet/Workers/Jobs/ScheduledMaintenancePublicNote/SendNotificationToSubscribers";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const CREATED_JOB: string =
  "ScheduledMaintenancePublicNote:SendNotificationToSubscribers";
const UPDATED_JOB: string =
  "ScheduledMaintenancePublicNote:SendUpdateNotificationToSubscribers";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const EVENT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const NOTE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const OTHER_STATUS_PAGE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const CORE_GROUP_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const STORAGE_GROUP_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);

const STATUS_PAGE_URL: string = "https://status.acme.com";
const DETAILS_URL: string = `${STATUS_PAGE_URL}/scheduled-events/${EVENT_ID.toString()}`;
const UNSUBSCRIBE_URL: string = `${STATUS_PAGE_URL}/update-subscription/${SUBSCRIBER_ID.toString()}`;
const DASHBOARD_URL: string =
  "https://oneuptime.acme.com/dashboard/scheduled-maintenance/1";

const EVENT_TITLE: string = "Database engine upgrade";
const NOTE: string = "The window moved to **Sunday 02:00 UTC**.";
const NOTE_HTML: string =
  "<p>The window moved to <strong>Sunday 02:00 UTC</strong>.</p>";
const NOTE_TEXT: string = "The window moved to Sunday 02:00 UTC.";
const DESCRIPTION: string = "The database engine will be **upgraded**.";
const DESCRIPTION_HTML: string =
  "<p>The database engine will be <strong>upgraded</strong>.</p>";
const DESCRIPTION_TEXT: string = "The database engine will be upgraded.";

// What the mocked Markdown.convertToHTML returns for each input.
const HTML: Record<string, string> = {
  [NOTE]: NOTE_HTML,
  [DESCRIPTION]: DESCRIPTION_HTML,
};

// What the mocked Markdown.convertToPlainText returns for each input.
const PLAIN_TEXT: Record<string, string> = {
  [NOTE]: NOTE_TEXT,
  [DESCRIPTION]: DESCRIPTION_TEXT,
};

// The event's current state; {{scheduledMaintenanceState}} must be this.
const STATE_NAME: string = "Ongoing";

const STARTS_AT: Date = new Date("2026-09-20T02:00:00.000Z");
const STARTS_AT_STRING: string =
  OneUptimeDate.getDateAsUserFriendlyFormattedString(STARTS_AT);

// When the note says it was posted, and when the worker runs.
const NOTE_POSTED_AT: Date = new Date("2026-09-15T08:30:00.000Z");
const NOTE_POSTED_AT_STRING: string =
  OneUptimeDate.getDateAsUserFriendlyFormattedString(NOTE_POSTED_AT);
const SENT_AT: Date = new Date("2026-09-16T11:45:00.000Z");
const SENT_AT_STRING: string =
  OneUptimeDate.getDateAsUserFriendlyFormattedString(SENT_AT);

let createdNotes: Array<ScheduledMaintenancePublicNote> = [];
let updatedNotes: Array<ScheduledMaintenancePublicNote> = [];
let storedEvent: ScheduledMaintenance | null = null;

function publicNote(overrides?: {
  subscriberNotificationStatusOnNoteCreated?: StatusPageSubscriberNotificationStatus;
  // A legacy row from before postedAt was filled in.
  withoutPostedAt?: boolean;
}): ScheduledMaintenancePublicNote {
  const note: ScheduledMaintenancePublicNote =
    new ScheduledMaintenancePublicNote();
  note._id = NOTE_ID.toString();
  note.note = NOTE;
  note.scheduledMaintenanceId = EVENT_ID;
  note.subscriberNotificationStatusOnNoteCreated =
    overrides?.subscriberNotificationStatusOnNoteCreated ||
    StatusPageSubscriberNotificationStatus.Success;

  if (!overrides?.withoutPostedAt) {
    note.postedAt = NOTE_POSTED_AT;
  }

  return note;
}

function scheduledEvent(overrides?: {
  isVisibleOnStatusPage?: boolean;
  withoutStatusPages?: boolean;
  withoutState?: boolean;
}): ScheduledMaintenance {
  const event: ScheduledMaintenance = new ScheduledMaintenance();
  event._id = EVENT_ID.toString();
  event.title = EVENT_TITLE;
  event.description = DESCRIPTION;
  event.projectId = PROJECT_ID;
  event.startsAt = STARTS_AT;
  event.isVisibleOnStatusPage = overrides?.isVisibleOnStatusPage !== false;
  event.scheduledMaintenanceNumber = 12;

  if (!overrides?.withoutState) {
    const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
    state.name = STATE_NAME;
    event.currentScheduledMaintenanceState = state;
  }

  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  event.monitors = [monitor];

  if (!overrides?.withoutStatusPages) {
    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID.toString();
    event.statusPages = [page];
  } else {
    event.statusPages = [];
  }

  return event;
}

function statusPage(overrides?: {
  showScheduledMaintenanceEventsOnStatusPage?: boolean;
  // Custom SMTP and Twilio, so the custom email and SMS templates are used.
  withCustomDelivery?: boolean;
}): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID.toString();
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  page.pageTitle = "Acme Status";
  page.isPublicStatusPage = true;
  page.showScheduledMaintenanceEventsOnStatusPage =
    overrides?.showScheduledMaintenanceEventsOnStatusPage !== false;

  if (overrides?.withCustomDelivery) {
    (page as unknown as JSONObject)["smtpConfig"] = { _id: "smtp" };
    (page as unknown as JSONObject)["callSmsConfig"] = { _id: "twilio" };
  }

  return page;
}

function resource(data?: {
  statusPageId?: ObjectID;
  displayName?: string;
  groupName?: string;
  groupId?: ObjectID;
}): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = data
    ? ObjectID.generate().toString()
    : "88888888-8888-4888-8888-888888888888";
  row.statusPageId = data?.statusPageId || STATUS_PAGE_ID;
  row.displayName = data?.displayName || "Primary database";

  if (data?.groupName) {
    const groupId: ObjectID = data.groupId || CORE_GROUP_ID;
    const group: StatusPageGroup = new StatusPageGroup();
    group._id = groupId.toString();
    group.name = data.groupName;
    row.statusPageGroupId = groupId;
    row.statusPageGroup = group;
  }

  return row;
}

/*
 * The maintenance touches two resources in the "Core" group and one in the
 * "Storage" group on this status page, and one resource on a status page that
 * is not being notified. HTML email bodies put each group on its own line;
 * every other channel shows "<br/>" as literal text, so it gets them on one.
 */
const GROUPED_RESOURCES_AFFECTED_HTML: string =
  "Core: Primary database, Replica<br/>Storage: Backups";
const GROUPED_RESOURCES_AFFECTED_TEXT: string =
  "Core: Primary database, Replica; Storage: Backups";

function groupedResources(): Array<StatusPageResource> {
  return [
    resource({
      statusPageId: STATUS_PAGE_ID,
      displayName: "Primary database",
      groupName: "Core",
    }),
    resource({
      statusPageId: STATUS_PAGE_ID,
      displayName: "Replica",
      groupName: "Core",
    }),
    resource({
      statusPageId: STATUS_PAGE_ID,
      displayName: "Backups",
      groupName: "Storage",
      groupId: STORAGE_GROUP_ID,
    }),
    resource({
      statusPageId: OTHER_STATUS_PAGE_ID,
      displayName: "Billing API",
    }),
  ];
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

function statusWrites(): Array<JSONObject> {
  return mock(
    ScheduledMaintenancePublicNoteService.updateOneById,
  ).mock.calls.map((call: Array<unknown>): JSONObject => {
    return (call[0] as { data: JSONObject }).data;
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
    ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem,
  ).mock.calls.map((call: Array<unknown>): JSONObject => {
    return call[0] as JSONObject;
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

// The event type of every custom template lookup, in order.
function templateLookups(): Array<unknown> {
  return mock(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
  ).mock.calls.map((call: Array<unknown>): unknown => {
    return (call[0] as JSONObject)["eventType"];
  });
}

function queryArgs(fn: unknown): { query: JSONObject; select: JSONObject } {
  return mock(fn).mock.calls[0]![0] as {
    query: JSONObject;
    select: JSONObject;
  };
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
 * Gives the status page a custom template on all four templated channels,
 * with the custom SMTP and Twilio config that email and SMS need to use them.
 * Each body starts with its channel's name so a test can tell which channel a
 * compiled message came from. The email template also has a custom subject.
 *
 * The templates exist only for `eventType`. A lookup for any other event finds
 * nothing, so a job that asks for the wrong event's templates sends the
 * defaults and the test fails.
 */
function useCustomTemplates(data: {
  eventType: StatusPageSubscriberNotificationEventType;
  body: string;
  subject?: string;
}): void {
  mock(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
  ).mockImplementation(async (args: unknown) => {
    if ((args as JSONObject)["eventType"] !== data.eventType) {
      return null;
    }

    const method: StatusPageSubscriberNotificationMethod = (args as JSONObject)[
      "notificationMethod"
    ] as StatusPageSubscriberNotificationMethod;

    if (method === StatusPageSubscriberNotificationMethod.Email) {
      return customTemplate(
        `Email|${data.body}`,
        `Subject|${data.subject || data.body}`,
      );
    }

    return customTemplate(`${method}|${data.body}`);
  });

  mock(
    StatusPageSubscriberService.getStatusPagesToSendNotification,
  ).mockResolvedValue([statusPage({ withCustomDelivery: true })] as never);
}

// The email sent with a custom template: its compiled body and subject.
function sentCustomEmails(): Array<{ body: string; subject: string }> {
  return sentMail().map(
    (mail: JSONObject): { body: string; subject: string } => {
      expect(mail["templateType"]).toBe(EmailTemplateType.BlankTemplate);
      return {
        body: (mail["vars"] as JSONObject)["body"] as string,
        subject: mail["subject"] as string,
      };
    },
  );
}

/*
 * Every message a custom template produced, labelled by channel: the email
 * body, the email subject, SMS, Slack and Teams.
 */
function sentCustomMessages(): Array<string> {
  return [
    ...sentCustomEmails().flatMap(
      (email: { body: string; subject: string }): Array<string> => {
        return [email.body, email.subject];
      },
    ),
    ...sentSms(),
    ...sentSlack(),
    ...sentTeams(),
  ];
}

/*
 * The message each templated channel gets from a template rendering `body`.
 * Each channel gets values in the format it renders: `body` is what Slack and
 * Teams show (the Markdown as written), `emailBody` what the custom email body
 * shows (HTML) and `plainTextBody` what the email subject and SMS show. Both
 * default to `body`, for values that are the same on every channel.
 */
function expectedCustomMessages(data: {
  body: string;
  emailBody?: string;
  plainTextBody?: string;
}): Array<string> {
  return [
    `Email|${data.emailBody ?? data.body}`,
    `Subject|${data.plainTextBody ?? data.body}`,
    `SMS|${data.plainTextBody ?? data.body}`,
    `Slack|${data.body}`,
    `Microsoft Teams|${data.body}`,
  ];
}

/*
 * The variables each custom template was compiled with, by channel: "Email"
 * (the body), "Subject", "SMS", "Slack" and "Microsoft Teams".
 */
function compiledVariablesByChannel(): Record<string, Record<string, string>> {
  const byChannel: Record<string, Record<string, string>> = {};

  for (const call of compileTemplateCalls()) {
    const channel: string = call.template.split("|")[0]!;
    expect(byChannel[channel]).toBeUndefined();
    byChannel[channel] = call.variables;
  }

  return byChannel;
}

// Runs `run` while OneUptimeDate.getCurrentDate returns SENT_AT.
async function atSentAt(run: () => Promise<void>): Promise<void> {
  const spy: jest.Mock = mock(jest.spyOn(OneUptimeDate, "getCurrentDate"));
  spy.mockReturnValue(SENT_AT);

  try {
    await run();
  } finally {
    spy.mockRestore();
  }
}

interface TriggerCase {
  name: string;
  job: string;
  eventType: StatusPageSubscriberNotificationEventType;
  queue: (notes: Array<ScheduledMaintenancePublicNote>) => void;
}

// The two jobs that share the send path, and the template event each uses.
const TRIGGERS: Array<TriggerCase> = [
  {
    name: "created",
    job: CREATED_JOB,
    eventType:
      StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteCreated,
    queue: (notes: Array<ScheduledMaintenancePublicNote>): void => {
      createdNotes = notes;
    },
  },
  {
    name: "updated",
    job: UPDATED_JOB,
    eventType:
      StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteUpdated,
    queue: (notes: Array<ScheduledMaintenancePublicNote>): void => {
      updatedNotes = notes;
    },
  },
];

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
    unsubscribeUrl: UNSUBSCRIBE_URL,
    scheduledMaintenanceTitle: EVENT_TITLE,
    note: NOTE,
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

  createdNotes = [];
  updatedNotes = [];
  storedEvent = scheduledEvent();

  mock(ScheduledMaintenancePublicNoteService.findAllBy).mockImplementation(
    async (args: unknown): Promise<Array<ScheduledMaintenancePublicNote>> => {
      const query: JSONObject = (args as { query: JSONObject }).query;

      return query["subscriberNotificationStatusOnNoteUpdated"]
        ? updatedNotes
        : createdNotes;
    },
  );
  mock(ScheduledMaintenancePublicNoteService.updateOneById).mockResolvedValue(
    1 as never,
  );

  mock(ScheduledMaintenanceService.findOneById).mockImplementation(async () => {
    return storedEvent;
  });
  mock(
    ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard,
  ).mockResolvedValue(URL.fromString(DASHBOARD_URL) as never);
  mock(
    ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem,
  ).mockResolvedValue(undefined as never);

  mock(StatusPageResourceService.findAllBy).mockResolvedValue([
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

  mock(Markdown.convertToHTML).mockImplementation(
    async (markdown: unknown): Promise<string> => {
      return HTML[markdown as string] ?? (markdown as string);
    },
  );
  mock(Markdown.convertToPlainText).mockImplementation(
    (markdown: unknown): string => {
      return PLAIN_TEXT[markdown as string] ?? (markdown as string);
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

describe("ScheduledMaintenancePublicNote:SendUpdateNotificationToSubscribers", () => {
  test("is registered next to the created job", () => {
    expect(mockCapturedJobs[UPDATED_JOB]).toBeDefined();
    expect(mockCapturedJobs[CREATED_JOB]).toBeDefined();
  });

  test("looks only for notes with a pending update notification", async () => {
    await runJob(UPDATED_JOB);

    const args: { query: JSONObject; select: JSONObject } = mock(
      ScheduledMaintenancePublicNoteService.findAllBy,
    ).mock.calls[0]![0] as { query: JSONObject; select: JSONObject };

    expect(args.query).toEqual({
      subscriberNotificationStatusOnNoteUpdated:
        StatusPageSubscriberNotificationStatus.Pending,
    });
    expect(args.select["subscriberNotificationStatusOnNoteCreated"]).toBe(true);
    // {{postedAt}} comes from the note row.
    expect(args.select["postedAt"]).toBe(true);
    expect(DatabaseConfig.getHost).not.toHaveBeenCalled();
  });

  test.each([
    StatusPageSubscriberNotificationStatus.Pending,
    StatusPageSubscriberNotificationStatus.InProgress,
  ])(
    "skips while the note's original notification is %s",
    async (originalStatus: StatusPageSubscriberNotificationStatus) => {
      updatedNotes = [
        publicNote({
          subscriberNotificationStatusOnNoteCreated: originalStatus,
        }),
      ];

      await runJob(UPDATED_JOB);

      nothingSent();
      expect(ScheduledMaintenanceService.findOneById).not.toHaveBeenCalled();
      expect(statusWrites()).toEqual([
        {
          subscriberNotificationStatusOnNoteUpdated:
            StatusPageSubscriberNotificationStatus.Skipped,
          subscriberNotificationStatusMessageOnNoteUpdated:
            SubscriberUpdateNotification.notYetNotifiedMessage,
        },
      ]);
    },
  );

  test("emails the updated-note template with an update subject", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberScheduledMaintenanceEventNoteUpdated,
    );
    expect(sentMail()[0]!["subject"]).toBe(
      `[Scheduled Maintenance Note Updated] ${EVENT_TITLE}`,
    );
    expect(sentMail()[0]!["vars"]).toEqual(
      expect.objectContaining({
        note: NOTE_HTML,
        eventTitle: EVENT_TITLE,
        eventDescription: DESCRIPTION,
        resourcesAffected: "Primary database",
        scheduledAt: STARTS_AT_STRING,
        detailsUrl: DETAILS_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
      }),
    );
  });

  test("uses the update wording on SMS, Slack and Teams, matching the dashboard defaults", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    const event: StatusPageSubscriberNotificationEventType =
      StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteUpdated;

    expect(sentSms()).toEqual([
      `Maintenance note updated: ${EVENT_TITLE} on Acme Status. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
    ]);
    expect(sentSms()[0]).toBe(
      dashboardDefault(event, StatusPageSubscriberNotificationMethod.SMS),
    );
    expect(sentSlack()[0]).toContain("**Note Updated**");
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

  test("tells webhook subscribers it is a ScheduledMaintenanceNoteUpdated event", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    expect(sentWebhooks()[0]!["eventType"]).toBe(
      "ScheduledMaintenanceNoteUpdated",
    );
    expect(sentWebhooks()[0]!["data"]).toEqual({
      scheduledMaintenanceId: EVENT_ID.toString(),
      scheduledMaintenanceTitle: EVENT_TITLE,
      scheduledMaintenanceDescription: DESCRIPTION,
      resourcesAffected: "Primary database",
      note: NOTE,
      detailsUrl: DETAILS_URL,
    });
  });

  test("looks up custom templates for the updated event", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    expect(templateLookups()).toEqual([
      StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteUpdated,
      StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteUpdated,
      StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteUpdated,
      StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteUpdated,
    ]);
  });

  test("records in the maintenance feed that subscribers were told about an edited note", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    expect(feedItems()[0]!["feedInfoInMarkdown"]).toBe(
      `📧 **Notification sent to subscribers** because a public note was updated on this [Scheduled Maintenance 12](${DASHBOARD_URL}).`,
    );
  });

  test("records progress and success on the update columns only", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatusOnNoteUpdated:
          StatusPageSubscriberNotificationStatus.InProgress,
      },
      {
        subscriberNotificationStatusOnNoteUpdated:
          StatusPageSubscriberNotificationStatus.Success,
        subscriberNotificationStatusMessageOnNoteUpdated:
          SubscriberUpdateNotification.sentMessage,
      },
    ]);
  });

  test("skips the update when the event is hidden from the status page", async () => {
    updatedNotes = [publicNote()];
    storedEvent = scheduledEvent({ isVisibleOnStatusPage: false });

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(statusWrites()[statusWrites().length - 1]).toEqual({
      subscriberNotificationStatusOnNoteUpdated:
        StatusPageSubscriberNotificationStatus.Skipped,
      subscriberNotificationStatusMessageOnNoteUpdated:
        "Notifications skipped as scheduled maintenance is not visible on status page.",
    });
  });

  test("skips the update when the event has been deleted", async () => {
    updatedNotes = [publicNote()];
    storedEvent = null;

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatusOnNoteUpdated:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessageOnNoteUpdated:
          "Related scheduled maintenance not found. Skipping notifications to subscribers.",
      },
    ]);
  });

  test("skips the update when no status page shows the event", async () => {
    updatedNotes = [publicNote()];
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([] as never);

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(statusWrites()[statusWrites().length - 1]).toEqual({
      subscriberNotificationStatusOnNoteUpdated:
        StatusPageSubscriberNotificationStatus.Skipped,
      subscriberNotificationStatusMessageOnNoteUpdated:
        "No status pages are configured for this scheduled maintenance. Skipping notifications.",
    });
  });

  test("respects a status page that hides scheduled events", async () => {
    updatedNotes = [publicNote()];
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([
      statusPage({ showScheduledMaintenanceEventsOnStatusPage: false }),
    ] as never);

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(feedItems()[0]!["feedInfoInMarkdown"]).toContain(
      "for the updated public note on [Scheduled Maintenance 12]",
    );
  });

  test("marks the update Failed with the reason when sending breaks", async () => {
    updatedNotes = [publicNote()];
    mock(Markdown.convertToHTML).mockRejectedValue(
      new Error("markdown exploded") as never,
    );

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(statusWrites()[statusWrites().length - 1]).toEqual({
      subscriberNotificationStatusOnNoteUpdated:
        StatusPageSubscriberNotificationStatus.Failed,
      subscriberNotificationStatusMessageOnNoteUpdated: "markdown exploded",
    });
  });
});

describe("ScheduledMaintenancePublicNote:SendNotificationToSubscribers (created)", () => {
  test("still only picks up notes whose author asked to notify", async () => {
    await runJob(CREATED_JOB);

    expect(
      (
        mock(ScheduledMaintenancePublicNoteService.findAllBy).mock
          .calls[0]![0] as { query: JSONObject }
      ).query,
    ).toEqual({
      subscriberNotificationStatusOnNoteCreated:
        StatusPageSubscriberNotificationStatus.Pending,
      shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true,
    });
    // {{postedAt}} comes from the note row.
    expect(
      queryArgs(ScheduledMaintenancePublicNoteService.findAllBy).select[
        "postedAt"
      ],
    ).toBe(true);
  });

  test("sends the new-note messages it always has", async () => {
    createdNotes = [publicNote()];

    await runJob(CREATED_JOB);

    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberScheduledMaintenanceEventNoteCreated,
    );
    expect(sentMail()[0]!["subject"]).toBe(
      `[Update Scheduled Maintenance] ${EVENT_TITLE}`,
    );
    expect(sentSms()[0]).toBe(
      `Maintenance update: ${EVENT_TITLE} on Acme Status. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
    );
    expect(sentSlack()[0]).toContain("**New Note Added**");
    expect(sentWebhooks()[0]!["eventType"]).toBe(
      "ScheduledMaintenanceNoteCreated",
    );
    expect(feedItems()[0]!["feedInfoInMarkdown"]).toContain(
      "because a public note is added to this [Scheduled Maintenance 12]",
    );
  });

  test("still matches the dashboard's created defaults", async () => {
    createdNotes = [publicNote()];

    await runJob(CREATED_JOB);

    const event: StatusPageSubscriberNotificationEventType =
      StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteCreated;

    expect(sentSms()[0]).toBe(
      dashboardDefault(event, StatusPageSubscriberNotificationMethod.SMS),
    );
    expect(sentSlack()[0]).toBe(
      dashboardDefault(event, StatusPageSubscriberNotificationMethod.Slack),
    );
  });

  test("looks up custom templates for the created event", async () => {
    createdNotes = [publicNote()];

    await runJob(CREATED_JOB);

    expect(templateLookups()).toEqual([
      StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteCreated,
      StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteCreated,
      StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteCreated,
      StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteCreated,
    ]);
  });

  test("records its status on the original columns only", async () => {
    createdNotes = [publicNote()];

    await runJob(CREATED_JOB);

    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.InProgress,
      },
      {
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.Success,
        subscriberNotificationStatusMessage:
          "Notifications sent successfully to all subscribers",
      },
    ]);
  });
});

/*
 * Custom templates can use every variable SubscriberNotificationTemplateVariables
 * advertises for the note events. The created and updated jobs share one send
 * path, so each test runs against both.
 */
describe("ScheduledMaintenancePublicNote custom template variables", () => {
  test.each(TRIGGERS)(
    "passes every advertised variable to every custom template ($name)",
    async (trigger: TriggerCase) => {
      trigger.queue([publicNote()]);
      useCustomTemplates({
        eventType: trigger.eventType,
        body: "Hello",
        subject: "Subject",
      });

      await runJob(trigger.job);

      const names: Array<string> =
        SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
          trigger.eventType,
        );
      expect(names.length).toBeGreaterThan(0);

      const calls: Array<CompileTemplateCall> = compileTemplateCalls();

      // Email body, email subject, SMS, Slack and Teams: all four channels.
      expect(
        calls
          .map((call: CompileTemplateCall): string => {
            return call.template.split("|")[0]!;
          })
          .sort(),
      ).toEqual(["Email", "Microsoft Teams", "SMS", "Slack", "Subject"]);

      const missing: Array<string> = [];

      for (const call of calls) {
        for (const name of names) {
          if (
            !Object.prototype.hasOwnProperty.call(call.variables, name) ||
            typeof call.variables[name] !== "string"
          ) {
            missing.push(`${call.template}: ${name}`);
          }
        }
      }

      expect(missing).toEqual([]);
    },
  );

  test.each(TRIGGERS)(
    "renders a template that uses every advertised variable with nothing left over ($name)",
    async (trigger: TriggerCase) => {
      trigger.queue([publicNote()]);
      mock(StatusPageResourceService.findAllBy).mockResolvedValue(
        groupedResources() as never,
      );

      const names: Array<string> =
        SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
          trigger.eventType,
        );
      const body: string = names
        .map((name: string): string => {
          return `${name}=[{{${name}}}]`;
        })
        .join("\n");

      useCustomTemplates({ eventType: trigger.eventType, body: body });

      await atSentAt(async () => {
        await runJob(trigger.job);
      });

      const messages: Array<string> = sentCustomMessages();
      expect(messages).toHaveLength(5);

      for (const message of messages) {
        expect(message).not.toMatch(/{{.*?}}/);

        for (const name of names) {
          expect(message).toContain(`${name}=[`);
          expect(message).not.toContain(`${name}=[]`);
        }
      }

      /*
       * The value each variable must render as in Slack and Teams: the
       * Markdown as written, and the resources on one line.
       */
      const values: Record<string, string> = {
        statusPageName: "Acme Status",
        statusPageUrl: STATUS_PAGE_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
        resourcesAffected: GROUPED_RESOURCES_AFFECTED_TEXT,
        scheduledMaintenanceTitle: EVENT_TITLE,
        scheduledMaintenanceDescription: DESCRIPTION,
        scheduledMaintenanceState: STATE_NAME,
        postedAt: NOTE_POSTED_AT_STRING,
        note: NOTE,
        detailsUrl: DETAILS_URL,
      };
      // The custom email body is HTML, with a line per resource group.
      const emailBodyValues: Record<string, string> = {
        ...values,
        resourcesAffected: GROUPED_RESOURCES_AFFECTED_HTML,
        scheduledMaintenanceDescription: DESCRIPTION_HTML,
        note: NOTE_HTML,
      };
      // The email subject and SMS get the Markdown fields as plain text.
      const plainTextValues: Record<string, string> = {
        ...values,
        scheduledMaintenanceDescription: DESCRIPTION_TEXT,
        note: NOTE_TEXT,
      };
      expect(Object.keys(values).sort()).toEqual([...names].sort());

      const render: (valuesToUse: Record<string, string>) => string = (
        valuesToUse: Record<string, string>,
      ): string => {
        return names
          .map((name: string): string => {
            return `${name}=[${valuesToUse[name]}]`;
          })
          .join("\n");
      };

      expect(messages).toEqual(
        expectedCustomMessages({
          body: render(values),
          emailBody: render(emailBodyValues),
          plainTextBody: render(plainTextValues),
        }),
      );
    },
  );

  test.each(TRIGGERS)(
    "gives every channel the event's current state, not its start date ($name)",
    async (trigger: TriggerCase) => {
      trigger.queue([publicNote()]);
      useCustomTemplates({
        eventType: trigger.eventType,
        body: "state={{scheduledMaintenanceState}}",
      });

      await runJob(trigger.job);

      expect(sentCustomMessages()).toEqual(
        expectedCustomMessages({ body: `state=${STATE_NAME}` }),
      );
      for (const message of sentCustomMessages()) {
        expect(message).not.toContain(STARTS_AT_STRING);
      }

      expect(
        queryArgs(ScheduledMaintenanceService.findOneById).select[
          "currentScheduledMaintenanceState"
        ],
      ).toEqual({ name: true });
    },
  );

  test.each(TRIGGERS)(
    "renders an empty state when the event has none ($name)",
    async (trigger: TriggerCase) => {
      trigger.queue([publicNote()]);
      storedEvent = scheduledEvent({ withoutState: true });
      useCustomTemplates({
        eventType: trigger.eventType,
        body: "state=[{{scheduledMaintenanceState}}]",
      });

      await runJob(trigger.job);

      expect(sentCustomMessages()).toEqual(
        expectedCustomMessages({ body: "state=[]" }),
      );
    },
  );

  test.each(TRIGGERS)(
    "uses when the note was posted, not when it was sent ($name)",
    async (trigger: TriggerCase) => {
      trigger.queue([publicNote()]);
      useCustomTemplates({
        eventType: trigger.eventType,
        body: "posted={{postedAt}}",
      });

      await atSentAt(async () => {
        await runJob(trigger.job);
      });

      expect(NOTE_POSTED_AT_STRING).not.toBe(SENT_AT_STRING);
      expect(sentCustomMessages()).toEqual(
        expectedCustomMessages({ body: `posted=${NOTE_POSTED_AT_STRING}` }),
      );
    },
  );

  test.each(TRIGGERS)(
    "falls back to the time of sending for a legacy note with no postedAt ($name)",
    async (trigger: TriggerCase) => {
      trigger.queue([publicNote({ withoutPostedAt: true })]);
      useCustomTemplates({
        eventType: trigger.eventType,
        body: "posted={{postedAt}}",
      });

      await atSentAt(async () => {
        await runJob(trigger.job);
      });

      expect(sentCustomMessages()).toEqual(
        expectedCustomMessages({ body: `posted=${SENT_AT_STRING}` }),
      );
    },
  );

  test.each(TRIGGERS)(
    "gives the description as HTML in the email body, as plain text in the subject and SMS, and as written in chat ($name)",
    async (trigger: TriggerCase) => {
      trigger.queue([publicNote()]);
      useCustomTemplates({
        eventType: trigger.eventType,
        body: "desc={{scheduledMaintenanceDescription}}",
      });

      await runJob(trigger.job);

      expect(DESCRIPTION_TEXT).not.toBe(DESCRIPTION);
      expect(DESCRIPTION_HTML).not.toBe(DESCRIPTION);
      expect(sentCustomMessages()).toEqual(
        expectedCustomMessages({
          body: `desc=${DESCRIPTION}`,
          emailBody: `desc=${DESCRIPTION_HTML}`,
          plainTextBody: `desc=${DESCRIPTION_TEXT}`,
        }),
      );
      expect(Markdown.convertToHTML).toHaveBeenCalledWith(DESCRIPTION, "Email");
      // Webhooks are not templated and keep the Markdown as written.
      expect(
        (sentWebhooks()[0]!["data"] as JSONObject)[
          "scheduledMaintenanceDescription"
        ],
      ).toBe(DESCRIPTION);
      expect(
        queryArgs(ScheduledMaintenanceService.findOneById).select[
          "description"
        ],
      ).toBe(true);
    },
  );

  test.each(TRIGGERS)(
    "lists the affected resources on this status page, by group ($name)",
    async (trigger: TriggerCase) => {
      trigger.queue([publicNote()]);
      mock(StatusPageResourceService.findAllBy).mockResolvedValue(
        groupedResources() as never,
      );
      useCustomTemplates({
        eventType: trigger.eventType,
        body: "resources={{resourcesAffected}}",
      });

      await runJob(trigger.job);

      // A line per group in the HTML email body, one line everywhere else.
      expect(sentCustomMessages()).toEqual(
        expectedCustomMessages({
          body: `resources=${GROUPED_RESOURCES_AFFECTED_TEXT}`,
          emailBody: `resources=${GROUPED_RESOURCES_AFFECTED_HTML}`,
        }),
      );
      // Webhooks are not templated, but list the same resources on one line.
      expect(
        (sentWebhooks()[0]!["data"] as JSONObject)["resourcesAffected"],
      ).toBe(GROUPED_RESOURCES_AFFECTED_TEXT);

      const select: JSONObject = queryArgs(
        StatusPageResourceService.findAllBy,
      ).select;
      expect(select["statusPageGroupId"]).toBe(true);
      expect(select["statusPageGroup"]).toEqual({ name: true });
    },
  );

  test.each(TRIGGERS)(
    "lists the same resources in the default email (HTML) and the webhook (plain text) ($name)",
    async (trigger: TriggerCase) => {
      trigger.queue([publicNote()]);
      mock(StatusPageResourceService.findAllBy).mockResolvedValue(
        groupedResources() as never,
      );

      await runJob(trigger.job);

      expect(sentMail()).toHaveLength(1);
      // The default email is not a custom template: it still gets HTML.
      expect(sentMail()[0]!["templateType"]).not.toBe(
        EmailTemplateType.BlankTemplate,
      );
      expect(sentMail()[0]!["vars"]).toEqual(
        expect.objectContaining({
          note: NOTE_HTML,
          resourcesAffected: GROUPED_RESOURCES_AFFECTED_HTML,
          scheduledAt: STARTS_AT_STRING,
        }),
      );
      expect(
        (sentWebhooks()[0]!["data"] as JSONObject)["resourcesAffected"],
      ).toBe(GROUPED_RESOURCES_AFFECTED_TEXT);
    },
  );

  test.each(TRIGGERS)(
    "renders no resources when the event affects none on this status page ($name)",
    async (trigger: TriggerCase) => {
      trigger.queue([publicNote()]);
      mock(StatusPageResourceService.findAllBy).mockResolvedValue([
        resource({
          statusPageId: OTHER_STATUS_PAGE_ID,
          displayName: "Billing API",
        }),
      ] as never);
      useCustomTemplates({
        eventType: trigger.eventType,
        body: "resources=[{{resourcesAffected}}]",
      });

      await runJob(trigger.job);

      expect(sentCustomMessages()).toEqual(
        expectedCustomMessages({ body: "resources=[]" }),
      );
      expect(
        (sentWebhooks()[0]!["data"] as JSONObject)["resourcesAffected"],
      ).toBe("");
    },
  );

  test("the default email has no resources when none are affected", async () => {
    createdNotes = [publicNote()];
    mock(StatusPageResourceService.findAllBy).mockResolvedValue([] as never);

    await runJob(CREATED_JOB);

    expect(sentMail()[0]!["vars"]).toEqual(
      expect.objectContaining({ resourcesAffected: "" }),
    );
  });

  test.each(TRIGGERS)(
    "uses custom email and SMS templates only with the page's own SMTP and Twilio ($name)",
    async (trigger: TriggerCase) => {
      trigger.queue([publicNote()]);
      useCustomTemplates({ eventType: trigger.eventType, body: "custom" });
      // Custom email and SMS templates need the page's own SMTP and Twilio.
      mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mockResolvedValue([statusPage()] as never);

      await runJob(trigger.job);

      expect(sentMail()[0]!["templateType"]).not.toBe(
        EmailTemplateType.BlankTemplate,
      );
      expect(sentSms()[0]).toContain(`Details: ${DETAILS_URL}`);
      expect(sentSlack()).toEqual(["Slack|custom"]);
      expect(sentTeams()).toEqual(["Microsoft Teams|custom"]);
      expect(
        compileTemplateCalls().map((call: CompileTemplateCall): string => {
          return call.template;
        }),
      ).toEqual(["Slack|custom", "Microsoft Teams|custom"]);
    },
  );
});

/*
 * Custom templates get each value in the format their channel renders: HTML
 * in the email body (it is wrapped only by BlankTemplate), plain text in the
 * email subject and SMS, and the Markdown as written in Slack and Teams. The
 * grouped resource list is "<br/>"-joined only in the email body.
 */
describe("ScheduledMaintenancePublicNote custom templates, in each channel's format", () => {
  const CHANNEL_BODY: string =
    "note: {{note}} / description: {{scheduledMaintenanceDescription}} / resources: {{resourcesAffected}}";
  const CHANNEL_SUBJECT: string =
    "{{scheduledMaintenanceTitle}}: {{note}} ({{resourcesAffected}})";

  function useChannelTemplates(trigger: TriggerCase): void {
    trigger.queue([publicNote()]);
    mock(StatusPageResourceService.findAllBy).mockResolvedValue(
      groupedResources() as never,
    );
    useCustomTemplates({
      eventType: trigger.eventType,
      body: CHANNEL_BODY,
      subject: CHANNEL_SUBJECT,
    });
  }

  test.each(TRIGGERS)(
    "renders HTML in the email body, plain text in SMS and the subject, and Markdown in chat ($name)",
    async (trigger: TriggerCase) => {
      useChannelTemplates(trigger);

      await runJob(trigger.job);

      expect(sentMail()).toHaveLength(1);
      expect(sentMail()[0]!["templateType"]).toBe(
        EmailTemplateType.BlankTemplate,
      );
      expect(sentMail()[0]!["vars"]).toEqual({
        body: `Email|note: ${NOTE_HTML} / description: ${DESCRIPTION_HTML} / resources: ${GROUPED_RESOURCES_AFFECTED_HTML}`,
      });
      expect(sentMail()[0]!["subject"]).toBe(
        `Subject|${EVENT_TITLE}: ${NOTE_TEXT} (${GROUPED_RESOURCES_AFFECTED_TEXT})`,
      );
      expect(sentSms()).toEqual([
        `SMS|note: ${NOTE_TEXT} / description: ${DESCRIPTION_TEXT} / resources: ${GROUPED_RESOURCES_AFFECTED_TEXT}`,
      ]);
      expect(sentSlack()).toEqual([
        `Slack|note: ${NOTE} / description: ${DESCRIPTION} / resources: ${GROUPED_RESOURCES_AFFECTED_TEXT}`,
      ]);
      expect(sentTeams()).toEqual([
        `Microsoft Teams|note: ${NOTE} / description: ${DESCRIPTION} / resources: ${GROUPED_RESOURCES_AFFECTED_TEXT}`,
      ]);

      // Only the HTML email body may contain "<br/>".
      for (const message of [
        sentMail()[0]!["subject"] as string,
        ...sentSms(),
        ...sentSlack(),
        ...sentTeams(),
      ]) {
        expect(message).not.toContain("<br/>");
      }
    },
  );

  test.each(TRIGGERS)(
    "hands each channel's template every variable, in that channel's format ($name)",
    async (trigger: TriggerCase) => {
      useChannelTemplates(trigger);

      await runJob(trigger.job);

      // Values that are the same on every channel.
      const shared: Record<string, string> = {
        statusPageName: "Acme Status",
        statusPageUrl: STATUS_PAGE_URL,
        detailsUrl: DETAILS_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
        scheduledMaintenanceTitle: EVENT_TITLE,
        scheduledMaintenanceState: STATE_NAME,
        postedAt: NOTE_POSTED_AT_STRING,
      };
      const emailBody: Record<string, string> = {
        ...shared,
        resourcesAffected: GROUPED_RESOURCES_AFFECTED_HTML,
        scheduledMaintenanceDescription: DESCRIPTION_HTML,
        note: NOTE_HTML,
      };
      const plainText: Record<string, string> = {
        ...shared,
        resourcesAffected: GROUPED_RESOURCES_AFFECTED_TEXT,
        scheduledMaintenanceDescription: DESCRIPTION_TEXT,
        note: NOTE_TEXT,
      };
      const markdown: Record<string, string> = {
        ...shared,
        resourcesAffected: GROUPED_RESOURCES_AFFECTED_TEXT,
        scheduledMaintenanceDescription: DESCRIPTION,
        note: NOTE,
      };

      // Every advertised variable, and nothing else, on every channel.
      expect(Object.keys(markdown).sort()).toEqual(
        [
          ...SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
            trigger.eventType,
          ),
        ].sort(),
      );

      expect(compiledVariablesByChannel()).toEqual({
        Email: emailBody,
        Subject: plainText,
        SMS: plainText,
        Slack: markdown,
        "Microsoft Teams": markdown,
      });
    },
  );

  test.each(TRIGGERS)(
    "still sends webhooks the Markdown note and description, with the resources on one line ($name)",
    async (trigger: TriggerCase) => {
      useChannelTemplates(trigger);

      await runJob(trigger.job);

      expect(sentWebhooks()).toHaveLength(1);
      expect(sentWebhooks()[0]!["data"]).toEqual({
        scheduledMaintenanceId: EVENT_ID.toString(),
        scheduledMaintenanceTitle: EVENT_TITLE,
        scheduledMaintenanceDescription: DESCRIPTION,
        resourcesAffected: GROUPED_RESOURCES_AFFECTED_TEXT,
        note: NOTE,
        detailsUrl: DETAILS_URL,
      });
    },
  );

  test.each(TRIGGERS)(
    "converts the note and the description once per public note, not per status page or subscriber ($name)",
    async (trigger: TriggerCase) => {
      useChannelTemplates(trigger);

      const otherPage: StatusPage = statusPage({ withCustomDelivery: true });
      otherPage._id = OTHER_STATUS_PAGE_ID.toString();
      mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mockResolvedValue([
        statusPage({ withCustomDelivery: true }),
        otherPage,
      ] as never);
      mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mockResolvedValue([subscriber(), subscriber()] as never);

      await runJob(trigger.job);

      // Two status pages with two subscribers each.
      expect(sentMail()).toHaveLength(4);
      expect(sentSms()).toHaveLength(4);

      expect(mock(Markdown.convertToHTML).mock.calls).toEqual([
        [NOTE, "Email"],
        [DESCRIPTION, "Email"],
      ]);
      expect(mock(Markdown.convertToPlainText).mock.calls).toEqual([
        [NOTE],
        [DESCRIPTION],
      ]);

      for (const email of sentCustomEmails()) {
        expect(email.body).toContain(`note: ${NOTE_HTML}`);
        expect(email.body).toContain(`description: ${DESCRIPTION_HTML}`);
      }
    },
  );
});

interface TemplateSyntaxNote {
  name: string;
  markdown: string;
  // The plain text the Markdown helper turns it into.
  text: string;
}

/*
 * Notes quoting template syntax. The subject is finished text when the worker
 * sends it, so the mail is marked literal: compiling it again read the braces
 * as Handlebars, and the email either failed to render and was never sent or
 * lost the quoted words. Tests/Notification/
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

// The default email subject's prefix for each job.
const DEFAULT_EMAIL_SUBJECT_PREFIXES: Record<string, string> = {
  [CREATED_JOB]: "[Update Scheduled Maintenance] ",
  [UPDATED_JOB]: "[Scheduled Maintenance Note Updated] ",
};

describe.each(TRIGGERS)(
  "ScheduledMaintenancePublicNote email subjects are sent as written ($name)",
  (trigger: TriggerCase) => {
    test.each(TEMPLATE_SYNTAX_NOTES)(
      "a note with $name reaches the custom subject as written",
      async ({ markdown, text }: TemplateSyntaxNote) => {
        const note: ScheduledMaintenancePublicNote = publicNote();
        note.note = markdown;
        trigger.queue([note]);
        mock(Markdown.convertToPlainText).mockImplementation(
          (value: unknown): string => {
            return value === markdown ? text : "";
          },
        );
        useCustomTemplates({
          eventType: trigger.eventType,
          body: "{{note}}",
          subject: "{{scheduledMaintenanceTitle}}: {{note}}",
        });

        await runJob(trigger.job);

        expect(sentMail()).toHaveLength(1);
        expect(sentMail()[0]!["subject"]).toBe(
          `Subject|${EVENT_TITLE}: ${text}`,
        );
        expect(sentMail()[0]!["isSubjectLiteral"]).toBe(true);
      },
    );

    test("an event title with template syntax reaches the default subject as written", async () => {
      trigger.queue([publicNote()]);
      const event: ScheduledMaintenance = scheduledEvent();
      event.title = "Upgrade to {{ .Values.image.tag }}";
      storedEvent = event;

      await runJob(trigger.job);

      expect(sentMail()).toHaveLength(1);
      expect(sentMail()[0]!["subject"]).toBe(
        `${DEFAULT_EMAIL_SUBJECT_PREFIXES[trigger.job]}Upgrade to {{ .Values.image.tag }}`,
      );
      expect(sentMail()[0]!["isSubjectLiteral"]).toBe(true);
    });
  },
);
