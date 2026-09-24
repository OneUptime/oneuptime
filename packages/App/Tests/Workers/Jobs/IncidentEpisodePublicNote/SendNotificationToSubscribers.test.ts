import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "Common/Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodePublicNote from "Common/Models/DatabaseModels/IncidentEpisodePublicNote";
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
import SubscriberNotificationTemplateVariables from "Common/Types/StatusPage/SubscriberNotificationTemplateVariables";
import SubscriberUpdateNotification from "Common/Types/StatusPage/SubscriberUpdateNotification";

/*
 * Incident episode public note notifications: "note posted" and the new
 * "note updated" job share one send path.
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

jest.mock("Common/Server/Services/IncidentEpisodePublicNoteService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/IncidentEpisodeService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), getEpisodeLinkInDashboard: jest.fn() },
  };
});

jest.mock("Common/Server/Services/IncidentEpisodeMemberService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/IncidentEpisodeFeedService", () => {
  return {
    __esModule: true,
    default: { createIncidentEpisodeFeedItem: jest.fn() },
  };
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
      Service: {
        /*
         * The real substitution, wrapped in a mock so tests can read the
         * variables each channel handed to its template.
         */
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
import IncidentEpisodeFeedService from "Common/Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeMemberService from "Common/Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodePublicNoteService from "Common/Server/Services/IncidentEpisodePublicNoteService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import MailService from "Common/Server/Services/MailService";
import SmsService from "Common/Server/Services/SmsService";
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
import "../../../../FeatureSet/Workers/Jobs/IncidentEpisodePublicNote/SendNotificationToSubscribers";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const CREATED_JOB: string =
  "IncidentEpisodePublicNote:SendNotificationToSubscribers";
const UPDATED_JOB: string =
  "IncidentEpisodePublicNote:SendUpdateNotificationToSubscribers";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const EPISODE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const NOTE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const SECOND_STATUS_PAGE_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

const STATUS_PAGE_URL: string = "https://status.acme.com";
// The status page shows an episode on its incident detail route.
const DETAILS_URL: string = `${STATUS_PAGE_URL}/incidents/${EPISODE_ID.toString()}`;
const UNSUBSCRIBE_URL: string = `${STATUS_PAGE_URL}/update-subscription/${SUBSCRIBER_ID.toString()}`;
const DASHBOARD_URL: string = "https://oneuptime.acme.com/dashboard/episode/1";

const EPISODE_TITLE: string = "Regional network interruption";
const NOTE: string = "Traffic is back on the **primary** links.";
const NOTE_HTML: string =
  "<p>Traffic is back on the <strong>primary</strong> links.</p>";
const NOTE_TEXT: string = "Traffic is back on the primary links.";

// What the real StatusPageResourceUtil makes of groupedResources().
const GROUPED_RESOURCES_HTML: string =
  "Europe: Edge network<br/>Americas: Core network";
const GROUPED_RESOURCES_TEXT: string =
  "Europe: Edge network; Americas: Core network";

let createdNotes: Array<IncidentEpisodePublicNote> = [];
let updatedNotes: Array<IncidentEpisodePublicNote> = [];
let skipNotes: Array<IncidentEpisodePublicNote> = [];
let storedEpisode: IncidentEpisode | null = null;
let memberMonitors: Array<Monitor> = [];

function publicNote(overrides?: {
  subscriberNotificationStatusOnNoteCreated?: StatusPageSubscriberNotificationStatus;
  note?: string;
}): IncidentEpisodePublicNote {
  const note: IncidentEpisodePublicNote = new IncidentEpisodePublicNote();
  note._id = NOTE_ID.toString();
  note.note = overrides?.note || NOTE;
  note.incidentEpisodeId = EPISODE_ID;
  note.projectId = PROJECT_ID;
  note.subscriberNotificationStatusOnNoteCreated =
    overrides?.subscriberNotificationStatusOnNoteCreated ||
    StatusPageSubscriberNotificationStatus.Success;
  return note;
}

function episode(overrides?: {
  isVisibleOnStatusPage?: boolean;
  withoutTitle?: boolean;
  withoutSeverity?: boolean;
}): IncidentEpisode {
  const row: IncidentEpisode = new IncidentEpisode();
  row._id = EPISODE_ID.toString();
  if (!overrides?.withoutTitle) {
    row.title = EPISODE_TITLE;
  }
  row.description = "Several network incidents are being investigated.";
  row.projectId = PROJECT_ID;
  row.isVisibleOnStatusPage = overrides?.isVisibleOnStatusPage !== false;
  row.episodeNumber = 3;
  row.episodeNumberWithPrefix = "EP-3";

  if (!overrides?.withoutSeverity) {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity.name = "Major";
    row.incidentSeverity = severity;
  }

  return row;
}

function monitor(): Monitor {
  const row: Monitor = new Monitor();
  row._id = MONITOR_ID.toString();
  return row;
}

function statusPage(overrides?: {
  showEpisodesOnStatusPage?: boolean;
  id?: ObjectID;
  pageTitle?: string;
  // Custom SMTP and Twilio, which Email and SMS need to use custom templates.
  withCustomSmtpAndSms?: boolean;
}): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = (overrides?.id || STATUS_PAGE_ID).toString();
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  page.pageTitle = overrides?.pageTitle || "Acme Status";
  page.isPublicStatusPage = true;
  page.showEpisodesOnStatusPage = overrides?.showEpisodesOnStatusPage !== false;
  if (overrides?.withCustomSmtpAndSms) {
    (page as unknown as JSONObject)["smtpConfig"] = { _id: "smtp" };
    (page as unknown as JSONObject)["callSmsConfig"] = { _id: "twilio" };
  }
  return page;
}

function resource(overrides?: {
  id?: string;
  statusPageId?: ObjectID;
  displayName?: string;
  groupName?: string;
}): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = overrides?.id || "88888888-8888-4888-8888-888888888888";
  row.statusPageId = overrides?.statusPageId || STATUS_PAGE_ID;
  row.displayName = overrides?.displayName || "Edge network";
  if (overrides?.groupName) {
    row.statusPageGroupId = ObjectID.generate();
    const group: StatusPageGroup = new StatusPageGroup();
    group.name = overrides.groupName;
    row.statusPageGroup = group;
  }
  return row;
}

/*
 * Two resources in two groups on one status page, which the real
 * StatusPageResourceUtil lists as GROUPED_RESOURCES_HTML or
 * GROUPED_RESOURCES_TEXT.
 */
function groupedResources(statusPageId: ObjectID): Array<StatusPageResource> {
  return [
    resource({
      id: ObjectID.generate().toString(),
      statusPageId: statusPageId,
      displayName: "Edge network",
      groupName: "Europe",
    }),
    resource({
      id: ObjectID.generate().toString(),
      statusPageId: statusPageId,
      displayName: "Core network",
      groupName: "Americas",
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
  return mock(IncidentEpisodePublicNoteService.updateOneById).mock.calls.map(
    (call: Array<unknown>): JSONObject => {
      return (call[0] as { data: JSONObject }).data;
    },
  );
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
    IncidentEpisodeFeedService.createIncidentEpisodeFeedItem,
  ).mock.calls.map((call: Array<unknown>): JSONObject => {
    return call[0] as JSONObject;
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
    unsubscribeUrl: UNSUBSCRIBE_URL,
    episodeTitle: EPISODE_TITLE,
    episodeSeverity: "Major",
    resourcesAffected: "Edge network",
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

interface CompileCall {
  template: string;
  variables: Record<string, string>;
}

function compileCalls(): Array<CompileCall> {
  return mock(
    StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate,
  ).mock.calls.map((call: Array<unknown>): CompileCall => {
    return {
      template: call[0] as string,
      variables: call[1] as Record<string, string>,
    };
  });
}

// The variables the job handed to compileTemplate for this template.
function variablesCompiledInto(template: string): Record<string, string> {
  const calls: Array<CompileCall> = compileCalls().filter(
    (call: CompileCall): boolean => {
      return call.template === template;
    },
  );

  expect(calls).toHaveLength(1);
  return calls[0]!.variables;
}

interface TriggerCase {
  name: string;
  job: string;
  eventType: StatusPageSubscriberNotificationEventType;
}

const TRIGGERS: Array<TriggerCase> = [
  {
    name: "created job",
    job: CREATED_JOB,
    eventType:
      StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteCreated,
  },
  {
    name: "updated job",
    job: UPDATED_JOB,
    eventType:
      StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteUpdated,
  },
];

// Puts one note in the queue the given job reads.
function queueNote(job: string, overrides?: { note?: string }): void {
  const note: IncidentEpisodePublicNote = publicNote(overrides);

  if (job === UPDATED_JOB) {
    updatedNotes = [note];
  } else {
    createdNotes = [note];
  }
}

const EMAIL_SUBJECT_TEMPLATE: string =
  "Subject: {{episodeTitle}} ({{episodeSeverity}})";

// A custom email subject that shows which format the subject was given.
const FORMAT_EMAIL_SUBJECT_TEMPLATE: string =
  "{{episodeTitle}}: {{note}} ({{resourcesAffected}})";

/*
 * A template body that prints every variable advertised for the event as
 * name=[value], so a test can see which ones rendered and with what.
 */
function templateUsingEveryVariable(
  channel: string,
  eventType: StatusPageSubscriberNotificationEventType,
): string {
  const lines: Array<string> =
    SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
      eventType,
    ).map((name: string): string => {
      return `${name}=[{{${name}}}]`;
    });

  return [`channel=${channel}`, ...lines].join("\n");
}

/*
 * What templateUsingEveryVariable(channel, eventType) renders to when each
 * advertised variable has the value given in `values`.
 */
function renderedEveryVariable(
  channel: string,
  eventType: StatusPageSubscriberNotificationEventType,
  values: Record<string, string>,
): string {
  const lines: Array<string> =
    SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
      eventType,
    ).map((name: string): string => {
      return `${name}=[${values[name] ?? ""}]`;
    });

  return [`channel=${channel}`, ...lines].join("\n");
}

/*
 * Gives the status pages custom SMTP and Twilio and a custom template for
 * the event on Email, SMS, Slack and Teams, each printing every advertised
 * variable, and emailSubject as the custom email subject. A lookup for any
 * other event finds no template. Returns the body used for each channel.
 */
function useCustomTemplatesOnEveryChannel(
  eventType: StatusPageSubscriberNotificationEventType,
  pages?: Array<StatusPage>,
  emailSubject: string = EMAIL_SUBJECT_TEMPLATE,
): Record<string, string> {
  mock(
    StatusPageSubscriberService.getStatusPagesToSendNotification,
  ).mockResolvedValue(
    (pages || [statusPage({ withCustomSmtpAndSms: true })]) as never,
  );

  const bodies: Record<string, string> = {
    [StatusPageSubscriberNotificationMethod.Email]: templateUsingEveryVariable(
      "email",
      eventType,
    ),
    [StatusPageSubscriberNotificationMethod.SMS]: templateUsingEveryVariable(
      "sms",
      eventType,
    ),
    [StatusPageSubscriberNotificationMethod.Slack]: templateUsingEveryVariable(
      "slack",
      eventType,
    ),
    [StatusPageSubscriberNotificationMethod.MicrosoftTeams]:
      templateUsingEveryVariable("teams", eventType),
  };

  mock(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
  ).mockImplementation(async (args: unknown) => {
    const lookup: JSONObject = args as JSONObject;
    const method: string = lookup["notificationMethod"] as string;

    if (lookup["eventType"] !== eventType || !bodies[method]) {
      return null;
    }

    return method === StatusPageSubscriberNotificationMethod.Email
      ? { templateBody: bodies[method], emailSubject: emailSubject }
      : { templateBody: bodies[method] };
  });

  return bodies;
}

beforeEach(() => {
  jest.clearAllMocks();

  createdNotes = [];
  updatedNotes = [];
  skipNotes = [];
  storedEpisode = episode();
  memberMonitors = [monitor()];

  mock(IncidentEpisodePublicNoteService.findBy).mockImplementation(
    async (args: unknown): Promise<Array<IncidentEpisodePublicNote>> => {
      const query: JSONObject = (args as { query: JSONObject }).query;

      if (query["subscriberNotificationStatusOnNoteUpdated"]) {
        return updatedNotes;
      }

      if (
        query["shouldStatusPageSubscribersBeNotifiedOnNoteCreated"] === false
      ) {
        return skipNotes;
      }

      return createdNotes;
    },
  );
  mock(IncidentEpisodePublicNoteService.updateOneById).mockResolvedValue(
    1 as never,
  );

  mock(IncidentEpisodeService.findOneById).mockImplementation(async () => {
    return storedEpisode;
  });
  mock(IncidentEpisodeService.getEpisodeLinkInDashboard).mockResolvedValue(
    URL.fromString(DASHBOARD_URL) as never,
  );
  mock(IncidentEpisodeMemberService.findBy).mockImplementation(async () => {
    const incident: Incident = new Incident();
    incident.monitors = memberMonitors;
    const member: IncidentEpisodeMember = new IncidentEpisodeMember();
    member.incident = incident;
    return [member];
  });
  mock(
    IncidentEpisodeFeedService.createIncidentEpisodeFeedItem,
  ).mockResolvedValue(undefined as never);

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

  mock(Markdown.convertToHTML).mockResolvedValue(NOTE_HTML as never);
  mock(Markdown.convertToPlainText).mockReturnValue(NOTE_TEXT);

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

describe("IncidentEpisodePublicNote:SendUpdateNotificationToSubscribers", () => {
  test("is registered next to the created job", () => {
    expect(mockCapturedJobs[UPDATED_JOB]).toBeDefined();
    expect(mockCapturedJobs[CREATED_JOB]).toBeDefined();
  });

  test("looks only for notes with a pending update notification", async () => {
    await runJob(UPDATED_JOB);

    const calls: Array<Array<unknown>> = mock(
      IncidentEpisodePublicNoteService.findBy,
    ).mock.calls as Array<Array<unknown>>;

    expect(calls).toHaveLength(1);

    const args: { query: JSONObject; select: JSONObject } = calls[0]![0] as {
      query: JSONObject;
      select: JSONObject;
    };

    expect(args.query).toEqual({
      subscriberNotificationStatusOnNoteUpdated:
        StatusPageSubscriberNotificationStatus.Pending,
    });
    expect(args.select["subscriberNotificationStatusOnNoteCreated"]).toBe(true);
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
      expect(IncidentEpisodeService.findOneById).not.toHaveBeenCalled();
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
      EmailTemplateType.SubscriberEpisodeNoteUpdated,
    );
    expect(sentMail()[0]!["subject"]).toBe(
      `[Incident Note Updated] ${EPISODE_TITLE}`,
    );
    expect(sentMail()[0]!["vars"]).toEqual(
      expect.objectContaining({
        note: NOTE_HTML,
        episodeTitle: EPISODE_TITLE,
        episodeSeverity: "Major",
        resourcesAffected: "Edge network",
        detailsUrl: DETAILS_URL,
      }),
    );
  });

  test("uses the update wording on SMS, Slack and Teams, matching the dashboard defaults", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    const event: StatusPageSubscriberNotificationEventType =
      StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteUpdated;

    expect(sentSms()).toEqual([
      `Incident update: ${EPISODE_TITLE} on Acme Status. A note has been updated. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
    ]);
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

  test("tells webhook subscribers it is an EpisodeNoteUpdated event", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    expect(sentWebhooks()[0]!["eventType"]).toBe("EpisodeNoteUpdated");
    expect((sentWebhooks()[0]!["data"] as JSONObject)["note"]).toBe(NOTE);
  });

  test("looks up custom templates for the updated event", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    for (const call of mock(
      StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
    ).mock.calls) {
      expect((call[0] as JSONObject)["eventType"]).toBe(
        StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteUpdated,
      );
    }
  });

  test("records in the episode feed that subscribers were told about an edited note", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    expect(feedItems()[0]!["feedInfoInMarkdown"]).toBe(
      `📧 **Notification sent to subscribers** because a public note was updated on this [Episode EP-3](${DASHBOARD_URL}).`,
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

  test("skips the update when the episode is hidden from the status page", async () => {
    updatedNotes = [publicNote()];
    storedEpisode = episode({ isVisibleOnStatusPage: false });

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(statusWrites()[statusWrites().length - 1]).toEqual({
      subscriberNotificationStatusOnNoteUpdated:
        StatusPageSubscriberNotificationStatus.Skipped,
      subscriberNotificationStatusMessageOnNoteUpdated:
        "Notifications skipped as episode is not visible on status page.",
    });
  });

  test("skips the update when the episode has been deleted", async () => {
    updatedNotes = [publicNote()];
    storedEpisode = null;

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatusOnNoteUpdated:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessageOnNoteUpdated:
          "Related episode not found. Skipping notifications to subscribers.",
      },
    ]);
  });

  test("skips the update when no incident in the episode has a monitor", async () => {
    updatedNotes = [publicNote()];
    memberMonitors = [];

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatusOnNoteUpdated:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessageOnNoteUpdated:
          "No monitors are attached to the incidents in this episode. Skipping notifications.",
      },
    ]);
  });

  test("respects a status page that hides episodes", async () => {
    updatedNotes = [publicNote()];
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([
      statusPage({ showEpisodesOnStatusPage: false }),
    ] as never);

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(feedItems()[0]!["feedInfoInMarkdown"]).toContain(
      "for the updated public note on [Episode EP-3]",
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

describe("IncidentEpisodePublicNote:SendNotificationToSubscribers (created)", () => {
  test("still marks notes that should not notify as Skipped on the original columns", async () => {
    skipNotes = [publicNote()];

    await runJob(CREATED_JOB);

    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessage:
          "Notifications skipped as subscribers are not to be notified for this note.",
      },
    ]);
  });

  test("sends the new-note messages it always has", async () => {
    createdNotes = [publicNote()];

    await runJob(CREATED_JOB);

    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberEpisodeNoteCreated,
    );
    expect(sentMail()[0]!["subject"]).toBe(
      `[Update Incident] ${EPISODE_TITLE}`,
    );
    expect(sentSms()[0]).toBe(
      `Incident update: ${EPISODE_TITLE} on Acme Status. A new note is posted. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
    );
    expect(sentSlack()[0]).toContain(
      "**New note has been added to an incident**",
    );
    expect(sentWebhooks()[0]!["eventType"]).toBe("EpisodeNoteCreated");
    expect(feedItems()[0]!["feedInfoInMarkdown"]).toContain(
      "because a public note is added to this [Episode EP-3]",
    );
  });

  test("still matches the dashboard's created defaults", async () => {
    createdNotes = [publicNote()];

    await runJob(CREATED_JOB);

    const event: StatusPageSubscriberNotificationEventType =
      StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteCreated;

    expect(sentSms()[0]).toBe(
      dashboardDefault(event, StatusPageSubscriberNotificationMethod.SMS),
    );
    expect(sentSlack()[0]).toBe(
      dashboardDefault(event, StatusPageSubscriberNotificationMethod.Slack),
    );
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

describe("IncidentEpisodePublicNote details link", () => {
  /*
   * The status page app has no /episodes page; an episode opens on the
   * incident detail route, which falls back to the episode lookup.
   */
  const EXPECTED_DETAILS_URL: string =
    "https://status.acme.com/incidents/33333333-3333-4333-8333-333333333333";

  test.each(TRIGGERS)(
    "$name: default SMS, email and webhook link to the episode on the incident detail route",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);

      await runJob(trigger.job);

      expect(sentSms()).toHaveLength(1);
      expect(sentSms()[0]).toContain(`Details: ${EXPECTED_DETAILS_URL}.`);
      expect((sentMail()[0]!["vars"] as JSONObject)["detailsUrl"]).toBe(
        EXPECTED_DETAILS_URL,
      );
      expect((sentWebhooks()[0]!["data"] as JSONObject)["detailsUrl"]).toBe(
        EXPECTED_DETAILS_URL,
      );
      expect(JSON.stringify(sentWebhooks())).not.toContain("/episodes/");
      expect(sentSms()[0]).not.toContain("/episodes/");
    },
  );

  test.each(TRIGGERS)(
    "$name: a status page without a custom domain links to its preview incident route",
    async (trigger: TriggerCase) => {
      const pageUrl: string = `https://oneuptime.acme.com/status-page/${STATUS_PAGE_ID.toString()}`;
      queueNote(trigger.job);
      useCustomTemplatesOnEveryChannel(trigger.eventType);
      mock(StatusPageService.getStatusPageURL).mockResolvedValue(
        pageUrl as never,
      );

      await runJob(trigger.job);

      const calls: Array<CompileCall> = compileCalls();
      expect(calls).toHaveLength(5);
      for (const call of calls) {
        expect(call.variables["statusPageUrl"]).toBe(pageUrl);
        expect(call.variables["detailsUrl"]).toBe(
          `${pageUrl}/incidents/${EPISODE_ID.toString()}`,
        );
      }
    },
  );
});

interface SubjectFallbackCase {
  name: string;
  job: string;
  withoutTitle: boolean;
  subject: string;
}

describe("IncidentEpisodePublicNote custom email subject fallback", () => {
  /*
   * A custom email template without its own subject gets the trigger's
   * prefix followed by the episode title; an untitled episode gets the bare
   * prefix rather than "undefined".
   */
  test.each([
    {
      name: "created job, titled",
      job: CREATED_JOB,
      withoutTitle: false,
      subject: `[Incident Update] ${EPISODE_TITLE}`,
    },
    {
      name: "updated job, titled",
      job: UPDATED_JOB,
      withoutTitle: false,
      subject: `[Incident Note Updated] ${EPISODE_TITLE}`,
    },
    {
      name: "created job, untitled",
      job: CREATED_JOB,
      withoutTitle: true,
      subject: "[Incident Update] ",
    },
    {
      name: "updated job, untitled",
      job: UPDATED_JOB,
      withoutTitle: true,
      subject: "[Incident Note Updated] ",
    },
  ])("$name: the subject is '$subject'", async (row: SubjectFallbackCase) => {
    queueNote(row.job);
    storedEpisode = episode({ withoutTitle: row.withoutTitle });

    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([statusPage({ withCustomSmtpAndSms: true })] as never);
    mock(
      StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
    ).mockImplementation(async (args: unknown) => {
      return (args as JSONObject)["notificationMethod"] ===
        StatusPageSubscriberNotificationMethod.Email
        ? { templateBody: "<p>{{note}}</p>" }
        : null;
    });

    await runJob(row.job);

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.BlankTemplate,
    );
    expect(sentMail()[0]!["subject"]).toBe(row.subject);
    // The custom email body is HTML, so it gets the note as HTML.
    expect(sentMail()[0]!["vars"]).toEqual({ body: `<p>${NOTE_HTML}</p>` });
  });
});

interface ProviderCase {
  name: string;
  withCustomSmtp: boolean;
  withCustomSms: boolean;
}

const PROVIDER_CASES: Array<ProviderCase> = [
  {
    name: "without custom SMTP or Twilio",
    withCustomSmtp: false,
    withCustomSms: false,
  },
  {
    name: "with custom SMTP only",
    withCustomSmtp: true,
    withCustomSms: false,
  },
  {
    name: "with custom Twilio only",
    withCustomSmtp: false,
    withCustomSms: true,
  },
];

// The default email each trigger sends when no custom template applies.
const DEFAULT_EMAIL: Record<
  string,
  { templateType: EmailTemplateType; subject: string }
> = {
  [CREATED_JOB]: {
    templateType: EmailTemplateType.SubscriberEpisodeNoteCreated,
    subject: `[Update Incident] ${EPISODE_TITLE}`,
  },
  [UPDATED_JOB]: {
    templateType: EmailTemplateType.SubscriberEpisodeNoteUpdated,
    subject: `[Incident Note Updated] ${EPISODE_TITLE}`,
  },
};

describe("IncidentEpisodePublicNote custom templates need the page's own SMTP and Twilio", () => {
  /*
   * Email uses a custom template only when the status page has custom SMTP,
   * and SMS only when it has custom Twilio. Slack and Teams need neither.
   * Each check is tested on its own, so dropping or swapping one fails.
   */
  describe.each(TRIGGERS)("$name", (trigger: TriggerCase) => {
    test.each(PROVIDER_CASES)(
      "$name: Email and SMS use custom templates only where configured",
      async (providers: ProviderCase) => {
        queueNote(trigger.job);
        const page: StatusPage = statusPage();
        if (providers.withCustomSmtp) {
          (page as unknown as JSONObject)["smtpConfig"] = { _id: "smtp" };
        }
        if (providers.withCustomSms) {
          (page as unknown as JSONObject)["callSmsConfig"] = { _id: "twilio" };
        }
        const bodies: Record<string, string> = useCustomTemplatesOnEveryChannel(
          trigger.eventType,
          [page],
        );

        await runJob(trigger.job);

        const expectedTemplates: Array<string> = [
          bodies[StatusPageSubscriberNotificationMethod.Slack]!,
          bodies[StatusPageSubscriberNotificationMethod.MicrosoftTeams]!,
        ];
        if (providers.withCustomSmtp) {
          expectedTemplates.push(
            bodies[StatusPageSubscriberNotificationMethod.Email]!,
            EMAIL_SUBJECT_TEMPLATE,
          );
        }
        if (providers.withCustomSms) {
          expectedTemplates.push(
            bodies[StatusPageSubscriberNotificationMethod.SMS]!,
          );
        }

        expect(
          compileCalls()
            .map((call: CompileCall): string => {
              return call.template;
            })
            .sort(),
        ).toEqual(expectedTemplates.sort());

        expect(sentMail()).toHaveLength(1);
        if (providers.withCustomSmtp) {
          expect(sentMail()[0]!["templateType"]).toBe(
            EmailTemplateType.BlankTemplate,
          );
          expect((sentMail()[0]!["vars"] as JSONObject)["body"]).toContain(
            "channel=email",
          );
        } else {
          expect(sentMail()[0]!["templateType"]).toBe(
            DEFAULT_EMAIL[trigger.job]!.templateType,
          );
          expect(sentMail()[0]!["subject"]).toBe(
            DEFAULT_EMAIL[trigger.job]!.subject,
          );
        }

        expect(sentSms()).toHaveLength(1);
        if (providers.withCustomSms) {
          expect(sentSms()[0]).toContain("channel=sms");
        } else {
          expect(sentSms()[0]).toMatch(/^Incident update: /);
        }

        expect(sentSlack()[0]).toContain("channel=slack");
        expect(sentTeams()[0]).toContain("channel=teams");
      },
    );
  });
});

describe("IncidentEpisodePublicNote custom templates receive every advertised variable", () => {
  test.each(TRIGGERS)(
    "$name: Email, SMS, Slack and Teams each get all of them",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);
      const bodies: Record<string, string> = useCustomTemplatesOnEveryChannel(
        trigger.eventType,
      );

      await runJob(trigger.job);

      const calls: Array<CompileCall> = compileCalls();

      // Email body and subject, SMS, Slack and Teams: one each.
      expect(calls).toHaveLength(5);
      expect(
        calls.map((call: CompileCall): string => {
          return call.template;
        }),
      ).toEqual(
        expect.arrayContaining([
          bodies[StatusPageSubscriberNotificationMethod.Email],
          EMAIL_SUBJECT_TEMPLATE,
          bodies[StatusPageSubscriberNotificationMethod.SMS],
          bodies[StatusPageSubscriberNotificationMethod.Slack],
          bodies[StatusPageSubscriberNotificationMethod.MicrosoftTeams],
        ]),
      );

      const names: Array<string> =
        SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
          trigger.eventType,
        );
      expect(names.length).toBeGreaterThan(0);

      for (const call of calls) {
        const missing: Array<string> = names.filter((name: string): boolean => {
          return (
            !Object.prototype.hasOwnProperty.call(call.variables, name) ||
            typeof call.variables[name] !== "string"
          );
        });

        expect({ template: call.template, missing }).toEqual({
          template: call.template,
          missing: [],
        });
      }
    },
  );
});

describe("IncidentEpisodePublicNote custom template variable values", () => {
  test.each(TRIGGERS)(
    "$name: detailsUrl opens the episode on the status page, on every channel",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);
      useCustomTemplatesOnEveryChannel(trigger.eventType);

      await runJob(trigger.job);

      const calls: Array<CompileCall> = compileCalls();
      expect(calls).toHaveLength(5);
      for (const call of calls) {
        expect(call.variables["detailsUrl"]).toBe(
          "https://status.acme.com/incidents/33333333-3333-4333-8333-333333333333",
        );
      }
    },
  );

  test.each(TRIGGERS)(
    "$name: resourcesAffected lists only the resources on that status page",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);
      useCustomTemplatesOnEveryChannel(trigger.eventType, [
        statusPage({ withCustomSmtpAndSms: true }),
        statusPage({
          withCustomSmtpAndSms: true,
          id: SECOND_STATUS_PAGE_ID,
          pageTitle: "Beta Status",
        }),
      ]);
      mock(StatusPageResourceService.findByMonitors).mockResolvedValue([
        resource(),
        resource({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          statusPageId: SECOND_STATUS_PAGE_ID,
          displayName: "DNS resolvers",
        }),
      ] as never);

      await runJob(trigger.job);

      const calls: Array<CompileCall> = compileCalls();
      expect(calls).toHaveLength(10);

      const resourcesByPage: Record<string, Array<string>> = {};
      for (const call of calls) {
        const page: string = call.variables["statusPageName"] as string;
        const resources: string = call.variables["resourcesAffected"] as string;
        resourcesByPage[page] = resourcesByPage[page] || [];
        if (!resourcesByPage[page]!.includes(resources)) {
          resourcesByPage[page]!.push(resources);
        }
      }

      expect(resourcesByPage).toEqual({
        "Acme Status": ["Edge network"],
        "Beta Status": ["DNS resolvers"],
      });
    },
  );

  test.each(TRIGGERS)(
    "$name: episodeTitle and episodeSeverity come from the episode",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);
      useCustomTemplatesOnEveryChannel(trigger.eventType);

      await runJob(trigger.job);

      const select: JSONObject = (
        mock(IncidentEpisodeService.findOneById).mock.calls[0]![0] as {
          select: JSONObject;
        }
      ).select;
      expect(select["title"]).toBe(true);
      expect(select["incidentSeverity"]).toEqual({ name: true });

      const calls: Array<CompileCall> = compileCalls();
      expect(calls).toHaveLength(5);
      for (const call of calls) {
        expect(call.variables["episodeTitle"]).toBe(EPISODE_TITLE);
        expect(call.variables["episodeSeverity"]).toBe("Major");
      }
    },
  );

  test.each(TRIGGERS)(
    "$name: episodeSeverity reads ' - ' when the episode has no severity, as the default messages do",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);
      storedEpisode = episode({ withoutSeverity: true });
      useCustomTemplatesOnEveryChannel(trigger.eventType);

      await runJob(trigger.job);

      const calls: Array<CompileCall> = compileCalls();
      expect(calls).toHaveLength(5);
      for (const call of calls) {
        expect(call.variables["episodeSeverity"]).toBe(" - ");
      }
      expect(sentMail()[0]!["subject"]).toBe(`Subject: ${EPISODE_TITLE} ( - )`);
    },
  );

  test.each(TRIGGERS)(
    "$name: note is the note row's current text, in each channel's format",
    async (trigger: TriggerCase) => {
      const editedNote: string = "Links are **stable** again after the fix.";
      const editedNoteHtml: string =
        "<p>Links are <strong>stable</strong> again after the fix.</p>";
      const editedNoteText: string = "Links are stable again after the fix.";
      queueNote(trigger.job, { note: editedNote });
      const bodies: Record<string, string> = useCustomTemplatesOnEveryChannel(
        trigger.eventType,
      );
      mock(Markdown.convertToHTML).mockImplementation(
        async (text: unknown): Promise<string> => {
          return `<p>${(text as string).replace(
            /\*\*(.+?)\*\*/g,
            "<strong>$1</strong>",
          )}</p>`;
        },
      );
      mock(Markdown.convertToPlainText).mockImplementation(
        (text: unknown): string => {
          return (text as string).replace(/\*\*/g, "");
        },
      );

      await runJob(trigger.job);

      // The job reads the note text from the row it is sending for.
      const sendQuery: { query: JSONObject; select: JSONObject } | undefined = (
        mock(IncidentEpisodePublicNoteService.findBy).mock.calls.map(
          (call: Array<unknown>): { query: JSONObject; select: JSONObject } => {
            return call[0] as { query: JSONObject; select: JSONObject };
          },
        ) as Array<{ query: JSONObject; select: JSONObject }>
      ).find((args: { query: JSONObject; select: JSONObject }): boolean => {
        return (
          args.query["shouldStatusPageSubscribersBeNotifiedOnNoteCreated"] !==
          false
        );
      });
      expect(sendQuery?.select["note"]).toBe(true);

      expect(Markdown.convertToHTML).toHaveBeenCalledWith(
        editedNote,
        MarkdownContentType.Email,
      );
      expect(Markdown.convertToPlainText).toHaveBeenCalledWith(editedNote);

      /*
       * HTML in the email body, plain text in the email subject and SMS, and
       * the Markdown as written in Slack and Teams.
       */
      const noteByTemplate: Record<string, string> = {
        [bodies[StatusPageSubscriberNotificationMethod.Email]!]: editedNoteHtml,
        [EMAIL_SUBJECT_TEMPLATE]: editedNoteText,
        [bodies[StatusPageSubscriberNotificationMethod.SMS]!]: editedNoteText,
        [bodies[StatusPageSubscriberNotificationMethod.Slack]!]: editedNote,
        [bodies[StatusPageSubscriberNotificationMethod.MicrosoftTeams]!]:
          editedNote,
      };

      const calls: Array<CompileCall> = compileCalls();
      expect(calls).toHaveLength(5);
      for (const call of calls) {
        expect({
          template: call.template,
          note: call.variables["note"],
        }).toEqual({
          template: call.template,
          note: noteByTemplate[call.template],
        });
      }
    },
  );

  test.each(TRIGGERS)(
    "$name: a template using every advertised variable renders completely on every channel",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);
      useCustomTemplatesOnEveryChannel(trigger.eventType);

      await runJob(trigger.job);

      // What the fixtures hold for each advertised variable.
      const expectedValues: Record<string, string> = {
        statusPageName: "Acme Status",
        statusPageUrl: STATUS_PAGE_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
        resourcesAffected: "Edge network",
        episodeTitle: EPISODE_TITLE,
        episodeSeverity: "Major",
        note: NOTE,
        detailsUrl: DETAILS_URL,
      };

      const names: Array<string> =
        SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
          trigger.eventType,
        );
      expect(Object.keys(expectedValues).sort()).toEqual([...names].sort());

      expect(sentMail()).toHaveLength(1);
      expect(sentMail()[0]!["templateType"]).toBe(
        EmailTemplateType.BlankTemplate,
      );
      expect(sentSms()).toHaveLength(1);
      expect(sentSlack()).toHaveLength(1);
      expect(sentTeams()).toHaveLength(1);

      const rendered: Record<string, string> = {
        email: (sentMail()[0]!["vars"] as JSONObject)["body"] as string,
        sms: sentSms()[0]!,
        slack: sentSlack()[0]!,
        teams: sentTeams()[0]!,
      };

      /*
       * The email body gets the note as HTML, SMS as plain text, and Slack
       * and Teams as written. The fixture's one ungrouped resource reads the
       * same in every format.
       */
      const noteByChannel: Record<string, string> = {
        email: NOTE_HTML,
        sms: NOTE_TEXT,
        slack: NOTE,
        teams: NOTE,
      };

      for (const [channel, message] of Object.entries(rendered)) {
        expect(message).toContain(`channel=${channel}`);
        expect(message).not.toMatch(/{{|}}/);

        for (const name of names) {
          const value: string =
            name === "note" ? noteByChannel[channel]! : expectedValues[name]!;

          expect(value).not.toBe("");
          expect(message).toContain(`${name}=[${value}]`);
        }
      }

      expect(sentMail()[0]!["subject"]).toBe(
        `Subject: ${EPISODE_TITLE} (Major)`,
      );
    },
  );
});

describe.each(TRIGGERS)(
  "IncidentEpisodePublicNote $name, with custom templates and grouped resources",
  (trigger: TriggerCase) => {
    /*
     * Custom email bodies are HTML (they are sent with BlankTemplate), email
     * subjects and SMS are plain text, and Slack and Teams render Markdown.
     * The grouped resource list shows the difference too: "<br/>" between
     * groups in the email body, "; " everywhere else.
     */
    const shared: Record<string, string> = {
      statusPageName: "Acme Status",
      statusPageUrl: STATUS_PAGE_URL,
      detailsUrl: DETAILS_URL,
      unsubscribeUrl: UNSUBSCRIBE_URL,
      episodeSeverity: "Major",
      episodeTitle: EPISODE_TITLE,
    };
    const emailBodyVariables: Record<string, string> = {
      ...shared,
      note: NOTE_HTML,
      resourcesAffected: GROUPED_RESOURCES_HTML,
    };
    const plainTextVariables: Record<string, string> = {
      ...shared,
      note: NOTE_TEXT,
      resourcesAffected: GROUPED_RESOURCES_TEXT,
    };
    const markdownVariables: Record<string, string> = {
      ...shared,
      note: NOTE,
      resourcesAffected: GROUPED_RESOURCES_TEXT,
    };

    let bodies: Record<string, string> = {};

    beforeEach(() => {
      queueNote(trigger.job);
      bodies = useCustomTemplatesOnEveryChannel(
        trigger.eventType,
        [statusPage({ withCustomSmtpAndSms: true })],
        FORMAT_EMAIL_SUBJECT_TEMPLATE,
      );
      mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
        groupedResources(STATUS_PAGE_ID) as never,
      );
    });

    test("renders HTML in the email body, plain text in SMS and the subject, and Markdown in chat", async () => {
      await runJob(trigger.job);

      expect(sentMail()).toHaveLength(1);
      expect(sentMail()[0]!["templateType"]).toBe(
        EmailTemplateType.BlankTemplate,
      );
      expect(sentMail()[0]!["vars"]).toEqual({
        body: renderedEveryVariable(
          "email",
          trigger.eventType,
          emailBodyVariables,
        ),
      });
      expect(sentMail()[0]!["subject"]).toBe(
        `${EPISODE_TITLE}: ${NOTE_TEXT} (${GROUPED_RESOURCES_TEXT})`,
      );
      expect(sentSms()).toEqual([
        renderedEveryVariable("sms", trigger.eventType, plainTextVariables),
      ]);
      expect(sentSlack()).toEqual([
        renderedEveryVariable("slack", trigger.eventType, markdownVariables),
      ]);
      expect(sentTeams()).toEqual([
        renderedEveryVariable("teams", trigger.eventType, markdownVariables),
      ]);

      // Spelled out, so a slip in the expectations above cannot hide one.
      const emailBody: string = (sentMail()[0]!["vars"] as JSONObject)[
        "body"
      ] as string;
      expect(emailBody).toContain(`note=[${NOTE_HTML}]`);
      expect(emailBody).toContain(
        "resourcesAffected=[Europe: Edge network<br/>Americas: Core network]",
      );
      expect(sentSms()[0]).toContain(`note=[${NOTE_TEXT}]`);
      expect(sentSlack()[0]).toContain(`note=[${NOTE}]`);
      expect(sentTeams()[0]).toContain(`note=[${NOTE}]`);

      for (const message of [
        sentMail()[0]!["subject"] as string,
        sentSms()[0]!,
        sentSlack()[0]!,
        sentTeams()[0]!,
      ]) {
        expect(message).toContain(
          "Europe: Edge network; Americas: Core network",
        );
        expect(message).not.toContain("<br/>");
      }
    });

    test("hands each channel's template every advertised variable, in that channel's format", async () => {
      await runJob(trigger.job);

      const names: Array<string> = [
        ...SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
          trigger.eventType,
        ),
      ].sort();
      for (const variables of [
        emailBodyVariables,
        plainTextVariables,
        markdownVariables,
      ]) {
        expect(Object.keys(variables).sort()).toEqual(names);
      }

      expect(compileCalls()).toHaveLength(5);
      expect(
        variablesCompiledInto(
          bodies[StatusPageSubscriberNotificationMethod.Email]!,
        ),
      ).toEqual(emailBodyVariables);
      expect(variablesCompiledInto(FORMAT_EMAIL_SUBJECT_TEMPLATE)).toEqual(
        plainTextVariables,
      );
      expect(
        variablesCompiledInto(
          bodies[StatusPageSubscriberNotificationMethod.SMS]!,
        ),
      ).toEqual(plainTextVariables);
      expect(
        variablesCompiledInto(
          bodies[StatusPageSubscriberNotificationMethod.Slack]!,
        ),
      ).toEqual(markdownVariables);
      expect(
        variablesCompiledInto(
          bodies[StatusPageSubscriberNotificationMethod.MicrosoftTeams]!,
        ),
      ).toEqual(markdownVariables);
    });

    test("sends webhooks the Markdown note and a plain-text resource list", async () => {
      await runJob(trigger.job);

      expect(sentWebhooks()).toHaveLength(1);
      const data: JSONObject = sentWebhooks()[0]!["data"] as JSONObject;

      expect(data["note"]).toBe(NOTE);
      expect(data["resourcesAffected"]).toBe(GROUPED_RESOURCES_TEXT);
    });

    test("converts the note once, however many status pages and subscribers it reaches", async () => {
      useCustomTemplatesOnEveryChannel(
        trigger.eventType,
        [
          statusPage({ withCustomSmtpAndSms: true }),
          statusPage({
            withCustomSmtpAndSms: true,
            id: SECOND_STATUS_PAGE_ID,
            pageTitle: "Beta Status",
          }),
        ],
        FORMAT_EMAIL_SUBJECT_TEMPLATE,
      );
      mock(StatusPageResourceService.findByMonitors).mockResolvedValue([
        ...groupedResources(STATUS_PAGE_ID),
        ...groupedResources(SECOND_STATUS_PAGE_ID),
      ] as never);
      mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mockResolvedValue([subscriber(), subscriber()] as never);

      await runJob(trigger.job);

      expect(Markdown.convertToHTML).toHaveBeenCalledTimes(1);
      expect(Markdown.convertToHTML).toHaveBeenCalledWith(
        NOTE,
        MarkdownContentType.Email,
      );
      expect(Markdown.convertToPlainText).toHaveBeenCalledTimes(1);
      expect(Markdown.convertToPlainText).toHaveBeenCalledWith(NOTE);

      // Two pages, two subscribers each, five templates per subscriber.
      const calls: Array<CompileCall> = compileCalls();
      expect(calls).toHaveLength(20);

      const variablesByTemplate: Record<string, Record<string, string>> = {
        [bodies[StatusPageSubscriberNotificationMethod.Email]!]:
          emailBodyVariables,
        [FORMAT_EMAIL_SUBJECT_TEMPLATE]: plainTextVariables,
        [bodies[StatusPageSubscriberNotificationMethod.SMS]!]:
          plainTextVariables,
        [bodies[StatusPageSubscriberNotificationMethod.Slack]!]:
          markdownVariables,
        [bodies[StatusPageSubscriberNotificationMethod.MicrosoftTeams]!]:
          markdownVariables,
      };

      for (const call of calls) {
        const expected: Record<string, string> =
          variablesByTemplate[call.template]!;
        expect({
          template: call.template,
          note: call.variables["note"],
          resourcesAffected: call.variables["resourcesAffected"],
        }).toEqual({
          template: call.template,
          note: expected["note"],
          resourcesAffected: expected["resourcesAffected"],
        });
      }
    });
  },
);

describe("IncidentEpisodePublicNote default email, with grouped resources", () => {
  test.each(TRIGGERS)(
    "$name: still gets HTML for the note and the resource list",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);
      mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
        groupedResources(STATUS_PAGE_ID) as never,
      );

      await runJob(trigger.job);

      expect(sentMail()).toHaveLength(1);
      expect(sentMail()[0]!["templateType"]).toBe(
        DEFAULT_EMAIL[trigger.job]!.templateType,
      );
      expect(sentMail()[0]!["subject"]).toBe(
        DEFAULT_EMAIL[trigger.job]!.subject,
      );
      expect(sentMail()[0]!["vars"]).toEqual(
        expect.objectContaining({
          note: NOTE_HTML,
          resourcesAffected: GROUPED_RESOURCES_HTML,
        }),
      );
      expect(compileCalls()).toHaveLength(0);
    },
  );
});

interface TemplateSyntaxDescription {
  name: string;
  markdown: string;
  // The plain text the Markdown helper turns it into.
  text: string;
}

/*
 * Notes quoting template syntax. The subject is finished text when the job
 * sends it, so the mail is marked literal: compiling it again read the braces
 * as Handlebars, and the email either failed to render and was never sent or
 * lost the quoted words. Tests/Notification/
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

describe("IncidentEpisodePublicNote email subjects are sent as written", () => {
  describe.each(TRIGGERS)("$name", (trigger: TriggerCase) => {
    test.each(TEMPLATE_SYNTAX_DESCRIPTIONS)(
      "a note with $name reaches the custom subject as written",
      async ({ markdown, text }: TemplateSyntaxDescription) => {
        queueNote(trigger.job, { note: markdown });
        mock(Markdown.convertToPlainText).mockImplementation(
          (value: unknown): string => {
            return value === markdown ? text : "";
          },
        );
        useCustomTemplatesOnEveryChannel(
          trigger.eventType,
          [statusPage({ withCustomSmtpAndSms: true })],
          FORMAT_EMAIL_SUBJECT_TEMPLATE,
        );

        await runJob(trigger.job);

        expect(sentMail()).toHaveLength(1);
        expect(sentMail()[0]!["subject"]).toBe(
          `${EPISODE_TITLE}: ${text} (Edge network)`,
        );
        expect(sentMail()[0]!["isSubjectLiteral"]).toBe(true);
      },
    );
  });

  test.each([
    { name: "created job", job: CREATED_JOB, prefix: "[Update Incident] " },
    {
      name: "updated job",
      job: UPDATED_JOB,
      prefix: "[Incident Note Updated] ",
    },
  ])(
    "$name: a title with template syntax reaches the default subject as written",
    async (row: { name: string; job: string; prefix: string }) => {
      queueNote(row.job);
      const titled: IncidentEpisode = episode();
      titled.title = "Rollout of {{ .Values.image.tag }} stalled";
      storedEpisode = titled;

      await runJob(row.job);

      expect(sentMail()).toHaveLength(1);
      expect(sentMail()[0]!["subject"]).toBe(
        `${row.prefix}Rollout of {{ .Values.image.tag }} stalled`,
      );
      expect(sentMail()[0]!["isSubjectLiteral"]).toBe(true);
    },
  );
});
