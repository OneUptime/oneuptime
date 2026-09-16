import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
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
      // The real substitution: {{name}} -> value, recorded.
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

function announcement(overrides?: {
  id?: ObjectID;
  subscriberNotificationStatus?: StatusPageSubscriberNotificationStatus;
  showAnnouncementAt?: Date;
  withoutStatusPages?: boolean;
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
  row.monitors = [];

  if (!overrides?.withoutStatusPages) {
    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID.toString();
    row.statusPages = [page];
  }

  return row;
}

function statusPage(overrides?: {
  showAnnouncementsOnStatusPage?: boolean;
  withCustomSmtp?: boolean;
  withCustomTwilio?: boolean;
}): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID.toString();
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  page.pageTitle = "Acme Status";
  page.isPublicStatusPage = true;
  page.showAnnouncementsOnStatusPage =
    overrides?.showAnnouncementsOnStatusPage !== false;

  if (overrides?.withCustomSmtp) {
    (page as unknown as JSONObject)["smtpConfig"] = { _id: "smtp" };
  }

  if (overrides?.withCustomTwilio) {
    (page as unknown as JSONObject)["callSmsConfig"] = { _id: "twilio" };
  }

  return page;
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

describe("Announcement custom templates", () => {
  const CUSTOM_BODIES: Record<string, string> = {
    [StatusPageSubscriberNotificationMethod.Email]:
      "<div>{{announcementDescription}}</div>",
    [StatusPageSubscriberNotificationMethod.SMS]:
      "SMS {{announcementDescription}}",
    [StatusPageSubscriberNotificationMethod.Slack]:
      "Slack {{announcementDescription}}",
    [StatusPageSubscriberNotificationMethod.MicrosoftTeams]:
      "Teams {{announcementDescription}}",
  };
  const CUSTOM_SUBJECT: string =
    "{{announcementTitle}}: {{announcementDescription}}";

  function variablesCompiledInto(template: string): Record<string, string> {
    const calls: Array<Array<unknown>> = mock(
      StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate,
    ).mock.calls.filter((call: Array<unknown>): boolean => {
      return call[0] === template;
    });

    expect(calls).toHaveLength(1);
    return calls[0]![1] as Record<string, string>;
  }

  beforeEach(() => {
    createdRows = [announcement()];

    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([
      statusPage({ withCustomSmtp: true, withCustomTwilio: true }),
    ] as never);

    mock(
      StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
    ).mockImplementation(async (args: unknown) => {
      const method: string = (args as JSONObject)[
        "notificationMethod"
      ] as string;
      const template: StatusPageSubscriberNotificationTemplate =
        new StatusPageSubscriberNotificationTemplate();
      template.templateBody = CUSTOM_BODIES[method]!;

      if (method === StatusPageSubscriberNotificationMethod.Email) {
        template.emailSubject = CUSTOM_SUBJECT;
      }

      return template;
    });
  });

  test("renders HTML in the email body, plain text in SMS and the subject, and Markdown in chat", async () => {
    await runJob(CREATED_JOB);

    expect(sentMail()[0]!.mail["vars"]).toEqual({
      body: `<div>${DESCRIPTION_HTML}</div>`,
    });
    expect(sentMail()[0]!.mail["subject"]).toBe(
      `${TITLE}: ${DESCRIPTION_TEXT}`,
    );
    expect(sentSms()).toEqual([`SMS ${DESCRIPTION_TEXT}`]);
    expect(sentSlack()).toEqual([`Slack ${DESCRIPTION}`]);
    expect(sentTeams()).toEqual([`Teams ${DESCRIPTION}`]);
  });

  test("compiles the email subject with the same variables as the body, as plain text", async () => {
    await runJob(CREATED_JOB);

    const body: Record<string, string> = variablesCompiledInto(
      CUSTOM_BODIES[StatusPageSubscriberNotificationMethod.Email]!,
    );

    expect(body["announcementDescription"]).toBe(DESCRIPTION_HTML);
    expect(variablesCompiledInto(CUSTOM_SUBJECT)).toEqual({
      ...body,
      announcementDescription: DESCRIPTION_TEXT,
    });
  });
});
