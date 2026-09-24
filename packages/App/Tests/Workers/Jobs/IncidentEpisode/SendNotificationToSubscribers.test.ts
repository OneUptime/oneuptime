import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "Common/Models/DatabaseModels/IncidentEpisodeMember";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import URL from "Common/Types/API/URL";
import { Blue500, Yellow500 } from "Common/Types/BrandColors";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberNotificationTemplateVariables from "Common/Types/StatusPage/SubscriberNotificationTemplateVariables";

/*
 * IncidentEpisode:SendNotificationToSubscribers tells status page subscribers
 * that an episode was created. These tests hold it to the variables
 * SubscriberNotificationTemplateVariables offers for SubscriberEpisodeCreated,
 * on every channel that compiles a custom template, check that each custom
 * template gets those values in the format its channel renders, and pin the
 * default messages it sends when no custom template applies.
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

jest.mock("Common/Server/Services/IncidentEpisodeService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      updateOneById: jest.fn(),
      getEpisodeLinkInDashboard: jest.fn(),
    },
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
import "../../../../FeatureSet/Workers/Jobs/IncidentEpisode/SendNotificationToSubscribers";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const JOB: string = "IncidentEpisode:SendNotificationToSubscribers";
const EVENT: StatusPageSubscriberNotificationEventType =
  StatusPageSubscriberNotificationEventType.SubscriberEpisodeCreated;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const EPISODE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const LOGO_FILE_ID: ObjectID = new ObjectID(
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
const SECOND_STATUS_PAGE_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

const STATUS_PAGE_URL: string = "https://status.acme.com";
const SECOND_STATUS_PAGE_URL: string = "https://status.beta.com";
// The status page shows an episode on its incident detail route.
const DETAILS_URL: string =
  "https://status.acme.com/incidents/33333333-3333-4333-8333-333333333333";
const SECOND_DETAILS_URL: string =
  "https://status.beta.com/incidents/33333333-3333-4333-8333-333333333333";
const UNSUBSCRIBE_URL: string =
  "https://status.acme.com/update-subscription/55555555-5555-4555-8555-555555555555";
const SECOND_UNSUBSCRIBE_URL: string =
  "https://status.acme.com/update-subscription/66666666-6666-4666-8666-666666666666";
const DASHBOARD_URL: string = "https://oneuptime.acme.com/dashboard/episode/1";

const EPISODE_TITLE: string = "Regional network interruption";
const SEVERITY: string = "Major";
const RESOURCE: string = "Edge network";
const DESCRIPTION: string = "Several **edge** routers are dropping traffic.";
const DESCRIPTION_HTML: string =
  "<p>Several <strong>edge</strong> routers are dropping traffic.</p>";
const DESCRIPTION_TEXT: string = "Several edge routers are dropping traffic.";

// The episode's resources in two groups, as each format lists them.
const GROUPED_RESOURCES_HTML: string =
  "Europe: Edge network<br/>Americas: Core network";
const GROUPED_RESOURCES_TEXT: string =
  "Europe: Edge network; Americas: Core network";

let pendingEpisodes: Array<IncidentEpisode> = [];
let skipEpisodes: Array<IncidentEpisode> = [];
let memberMonitors: Array<Monitor> = [];

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
  row.description = DESCRIPTION;
  row.projectId = PROJECT_ID;
  row.isVisibleOnStatusPage = overrides?.isVisibleOnStatusPage !== false;
  row.episodeNumber = 3;

  if (!overrides?.withoutSeverity) {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity.name = SEVERITY;
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
  // Leaves the column undefined, which is how an unselected column reads.
  leaveShowEpisodesUnset?: boolean;
  id?: ObjectID;
  pageTitle?: string;
  withoutPageTitle?: boolean;
  withLogo?: boolean;
  // Custom SMTP and Twilio, which Email and SMS need to use custom templates.
  withCustomSmtpAndSms?: boolean;
}): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = (overrides?.id || STATUS_PAGE_ID).toString();
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  if (!overrides?.withoutPageTitle) {
    page.pageTitle = overrides?.pageTitle || "Acme Status";
  }
  page.isPublicStatusPage = true;
  if (!overrides?.leaveShowEpisodesUnset) {
    page.showEpisodesOnStatusPage =
      overrides?.showEpisodesOnStatusPage !== false;
  }
  if (overrides?.withLogo) {
    page.logoFileId = LOGO_FILE_ID;
  }
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
  // Puts the resource in a status page group of this name.
  groupName?: string;
}): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = overrides?.id || "88888888-8888-4888-8888-888888888888";
  row.statusPageId = overrides?.statusPageId || STATUS_PAGE_ID;
  row.displayName = overrides?.displayName || RESOURCE;
  if (overrides?.groupName) {
    const group: StatusPageGroup = new StatusPageGroup();
    group.name = overrides.groupName;
    row.statusPageGroupId = ObjectID.generate();
    row.statusPageGroup = group;
  }
  return row;
}

// "Edge network" in the Europe group and "Core network" in the Americas one.
function groupedResources(): Array<StatusPageResource> {
  return [
    resource({ displayName: "Edge network", groupName: "Europe" }),
    resource({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      displayName: "Core network",
      groupName: "Americas",
    }),
  ];
}

function subscriber(overrides?: {
  id?: ObjectID;
  email?: string;
}): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row._id = (overrides?.id || SUBSCRIBER_ID).toString();
  row.subscriberEmail = new Email(overrides?.email || "customer@example.com");
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
  return mock(IncidentEpisodeService.updateOneById).mock.calls.map(
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

function templateLookups(): Array<JSONObject> {
  return mock(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
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
  method: StatusPageSubscriberNotificationMethod,
): string {
  const template: string =
    getDefaultSubscriberNotificationTemplate(EVENT, method)?.body || "";
  const variables: Record<string, string> = {
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    detailsUrl: DETAILS_URL,
    unsubscribeUrl: UNSUBSCRIBE_URL,
    episodeTitle: EPISODE_TITLE,
    episodeSeverity: SEVERITY,
    episodeDescription: DESCRIPTION,
    resourcesAffected: RESOURCE,
  };

  return template.replace(/{{\s*(\w+)\s*}}/g, (_match: string, key: string) => {
    return variables[key] ?? "";
  });
}

async function runJob(): Promise<void> {
  expect(mockCapturedJobs[JOB]).toBeDefined();
  await mockCapturedJobs[JOB]!();
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

const EMAIL_SUBJECT_TEMPLATE: string =
  "Subject: {{episodeTitle}} ({{episodeSeverity}})";

/*
 * A subject that echoes the format-dependent variables, so the sent subject
 * shows which format it was given.
 */
const FORMAT_EMAIL_SUBJECT_TEMPLATE: string =
  "{{episodeTitle}}: {{episodeDescription}} ({{resourcesAffected}})";

/*
 * A template body that prints every variable advertised for the event as
 * name=[value], so a test can see which ones rendered and with what.
 */
function templateUsingEveryVariable(channel: string): string {
  const lines: Array<string> =
    SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
      EVENT,
    ).map((name: string): string => {
      return `${name}=[{{${name}}}]`;
    });

  return [`channel=${channel}`, ...lines].join("\n");
}

// What templateUsingEveryVariable renders to with these values.
function renderedEveryVariable(
  channel: string,
  values: Record<string, string>,
): string {
  const lines: Array<string> =
    SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
      EVENT,
    ).map((name: string): string => {
      return `${name}=[${values[name] ?? ""}]`;
    });

  return [`channel=${channel}`, ...lines].join("\n");
}

/*
 * Gives the status pages custom SMTP and Twilio and a custom template for
 * the event on Email, SMS, Slack and Teams, each printing every advertised
 * variable. The email template's subject is emailSubject, or
 * EMAIL_SUBJECT_TEMPLATE when none is given. A lookup for any other event
 * finds no template. Returns the body used for each channel.
 */
function useCustomTemplatesOnEveryChannel(
  pages?: Array<StatusPage>,
  emailSubject?: string,
): Record<string, string> {
  mock(
    StatusPageSubscriberService.getStatusPagesToSendNotification,
  ).mockResolvedValue(
    (pages || [statusPage({ withCustomSmtpAndSms: true })]) as never,
  );

  const bodies: Record<string, string> = {
    [StatusPageSubscriberNotificationMethod.Email]:
      templateUsingEveryVariable("email"),
    [StatusPageSubscriberNotificationMethod.SMS]:
      templateUsingEveryVariable("sms"),
    [StatusPageSubscriberNotificationMethod.Slack]:
      templateUsingEveryVariable("slack"),
    [StatusPageSubscriberNotificationMethod.MicrosoftTeams]:
      templateUsingEveryVariable("teams"),
  };

  mock(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
  ).mockImplementation(async (args: unknown) => {
    const lookup: JSONObject = args as JSONObject;
    const method: string = lookup["notificationMethod"] as string;

    if (lookup["eventType"] !== EVENT || !bodies[method]) {
      return null;
    }

    return method === StatusPageSubscriberNotificationMethod.Email
      ? {
          templateBody: bodies[method],
          emailSubject: emailSubject || EMAIL_SUBJECT_TEMPLATE,
        }
      : { templateBody: bodies[method] };
  });

  return bodies;
}

/*
 * The episode's monitor is a resource on both status pages, shown as
 * "Edge network" on the first and "DNS resolvers" on the second.
 */
function resourcesOnBothPages(): void {
  mock(StatusPageResourceService.findAllBy).mockResolvedValue([
    resource(),
    resource({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      statusPageId: SECOND_STATUS_PAGE_ID,
      displayName: "DNS resolvers",
    }),
  ] as never);
}

beforeEach(() => {
  jest.clearAllMocks();

  pendingEpisodes = [episode()];
  skipEpisodes = [];
  memberMonitors = [monitor()];

  mock(IncidentEpisodeService.findAllBy).mockImplementation(
    async (args: unknown): Promise<Array<IncidentEpisode>> => {
      const query: JSONObject = (args as { query: JSONObject }).query;

      if (
        query["shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated"] === false
      ) {
        return skipEpisodes;
      }

      return pendingEpisodes;
    },
  );
  mock(IncidentEpisodeService.updateOneById).mockResolvedValue(1 as never);
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
  // Each subscriber gets a link of its own, on the page it subscribed to.
  mock(StatusPageSubscriberService.getUnsubscribeLink).mockImplementation(
    (url: unknown, subscriberId: unknown): URL => {
      return (url as URL).addRoute(
        `/update-subscription/${(subscriberId as ObjectID).toString()}`,
      );
    },
  );
  mock(StatusPageService.getStatusPageURL).mockImplementation(
    async (statusPageId: unknown): Promise<string> => {
      return (statusPageId as ObjectID).toString() ===
        SECOND_STATUS_PAGE_ID.toString()
        ? SECOND_STATUS_PAGE_URL
        : STATUS_PAGE_URL;
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

describe("IncidentEpisode:SendNotificationToSubscribers default messages", () => {
  test("is registered", () => {
    expect(mockCapturedJobs[JOB]).toBeDefined();
  });

  test("reads the episode fields the messages use", async () => {
    await runJob();

    const pendingQuery: { query: JSONObject; select: JSONObject } | undefined =
      mock(IncidentEpisodeService.findAllBy)
        .mock.calls.map(
          (call: Array<unknown>): { query: JSONObject; select: JSONObject } => {
            return call[0] as { query: JSONObject; select: JSONObject };
          },
        )
        .find((args: { query: JSONObject; select: JSONObject }): boolean => {
          return (
            args.query[
              "shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated"
            ] === true
          );
        });

    expect(pendingQuery).toBeDefined();
    expect(pendingQuery!.select["title"]).toBe(true);
    expect(pendingQuery!.select["description"]).toBe(true);
    expect(pendingQuery!.select["incidentSeverity"]).toEqual({ name: true });
  });

  test("emails the episode-created template with the episode's details", async () => {
    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect((sentMail()[0]!["toEmail"] as Email).toString()).toBe(
      "customer@example.com",
    );
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberEpisodeCreated,
    );
    expect(sentMail()[0]!["subject"]).toBe(`[Incident] ${EPISODE_TITLE}`);
    expect(sentMail()[0]!["vars"]).toEqual({
      statusPageName: "Acme Status",
      statusPageUrl: STATUS_PAGE_URL,
      detailsUrl: DETAILS_URL,
      logoUrl: "",
      isPublicStatusPage: "true",
      resourcesAffected: RESOURCE,
      episodeSeverity: SEVERITY,
      episodeTitle: EPISODE_TITLE,
      episodeDescription: DESCRIPTION_HTML,
      unsubscribeUrl: UNSUBSCRIBE_URL,
      subscriberEmailNotificationFooterText: "Footer text",
    });
  });

  test("links the default email to the status page's logo when it has one", async () => {
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([statusPage({ withLogo: true })] as never);

    await runJob();

    expect((sentMail()[0]!["vars"] as JSONObject)["logoUrl"]).toBe(
      "https://oneuptime.acme.com/status-page-api/logo/22222222-2222-4222-8222-222222222222",
    );
  });

  test("an untitled episode gets the bare subject prefix, not 'undefined'", async () => {
    pendingEpisodes = [episode({ withoutTitle: true })];

    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["subject"]).toBe("[Incident] ");
  });

  test("SMS, Slack and Teams match the dashboard's starter templates", async () => {
    await runJob();

    expect(sentSms()).toEqual([
      `Incident ${EPISODE_TITLE} (${SEVERITY}) on Acme Status. Impact: ${RESOURCE}. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
    ]);
    expect(sentSms()[0]).toBe(
      dashboardDefault(StatusPageSubscriberNotificationMethod.SMS),
    );

    expect(sentSlack()).toHaveLength(1);
    expect(sentSlack()[0]).toBe(
      dashboardDefault(StatusPageSubscriberNotificationMethod.Slack),
    );
    expect(sentSlack()[0]).toContain(`**Description:** ${DESCRIPTION}`);

    expect(sentTeams()).toHaveLength(1);
    expect(sentTeams()[0]).toBe(
      dashboardDefault(StatusPageSubscriberNotificationMethod.MicrosoftTeams),
    );
  });

  test("tells webhook subscribers it is an EpisodeCreated event", async () => {
    await runJob();

    expect(sentWebhooks()).toEqual([
      {
        eventType: "EpisodeCreated",
        statusPageId: STATUS_PAGE_ID.toString(),
        statusPageName: "Acme Status",
        statusPageUrl: STATUS_PAGE_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
        data: {
          episodeId: EPISODE_ID.toString(),
          episodeTitle: EPISODE_TITLE,
          episodeDescription: DESCRIPTION,
          incidentSeverity: SEVERITY,
          resourcesAffected: RESOURCE,
          detailsUrl: DETAILS_URL,
        },
      },
    ]);
  });

  test("records progress, success and a feed item", async () => {
    await runJob();

    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatusOnEpisodeCreated:
          StatusPageSubscriberNotificationStatus.InProgress,
      },
      {
        subscriberNotificationStatusOnEpisodeCreated:
          StatusPageSubscriberNotificationStatus.Success,
        subscriberNotificationStatusMessage:
          "Notifications sent successfully to all subscribers",
      },
    ]);

    expect(feedItems()).toHaveLength(1);
    expect(feedItems()[0]!["displayColor"]).toBe(Blue500);
    expect(feedItems()[0]!["feedInfoInMarkdown"]).toContain(
      `📧 **Subscriber Episode Created Notification Sent for [Episode 3](${DASHBOARD_URL})**:`,
    );
  });

  test("marks episodes that should not notify as Skipped", async () => {
    pendingEpisodes = [];
    skipEpisodes = [episode()];

    await runJob();

    nothingSent();
    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatusOnEpisodeCreated:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessage:
          "Notifications skipped as subscribers are not to be notified for this episode.",
      },
    ]);
  });

  test("skips an episode that is hidden from the status page", async () => {
    pendingEpisodes = [episode({ isVisibleOnStatusPage: false })];

    await runJob();

    nothingSent();
    expect(statusWrites()[statusWrites().length - 1]).toEqual({
      subscriberNotificationStatusOnEpisodeCreated:
        StatusPageSubscriberNotificationStatus.Skipped,
      subscriberNotificationStatusMessage:
        "Episode is not visible on status page. Skipping notifications.",
    });
  });

  test("skips an episode whose incidents have no monitor", async () => {
    memberMonitors = [];

    await runJob();

    nothingSent();
    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatusOnEpisodeCreated:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessage:
          "No monitors are attached to the incidents in this episode. Skipping notifications to subscribers.",
      },
    ]);
  });
});

describe("IncidentEpisode:SendNotificationToSubscribers details link", () => {
  /*
   * The status page app has no /episodes page; an episode opens on the
   * incident detail route, which falls back to the episode lookup.
   */
  test("default email, SMS and webhook link to the episode on the incident detail route", async () => {
    await runJob();

    expect(sentSms()).toHaveLength(1);
    expect(sentSms()[0]).toContain(`Details: ${DETAILS_URL}.`);
    expect((sentMail()[0]!["vars"] as JSONObject)["detailsUrl"]).toBe(
      DETAILS_URL,
    );
    expect((sentWebhooks()[0]!["data"] as JSONObject)["detailsUrl"]).toBe(
      DETAILS_URL,
    );

    const everythingSent: string = JSON.stringify([
      sentMail(),
      sentSms(),
      sentSlack(),
      sentTeams(),
      sentWebhooks(),
    ]);
    expect(everythingSent).not.toContain("/episodes/");
  });

  test("custom templates get the incident detail route on every channel", async () => {
    useCustomTemplatesOnEveryChannel();

    await runJob();

    const calls: Array<CompileCall> = compileCalls();
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.variables["detailsUrl"]).toBe(DETAILS_URL);
      expect(JSON.stringify(call.variables)).not.toContain("/episodes/");
    }
  });

  test("a status page without a custom domain links to its preview incident route", async () => {
    const pageUrl: string = `https://oneuptime.acme.com/status-page/${STATUS_PAGE_ID.toString()}`;
    useCustomTemplatesOnEveryChannel();
    mock(StatusPageService.getStatusPageURL).mockResolvedValue(
      pageUrl as never,
    );

    await runJob();

    const calls: Array<CompileCall> = compileCalls();
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.variables["statusPageUrl"]).toBe(pageUrl);
      expect(call.variables["detailsUrl"]).toBe(
        `https://oneuptime.acme.com/status-page/22222222-2222-4222-8222-222222222222/incidents/${EPISODE_ID.toString()}`,
      );
    }
  });
});

interface PageOrderCase {
  name: string;
  hiddenFirst: boolean;
}

describe("IncidentEpisode:SendNotificationToSubscribers respects showEpisodesOnStatusPage", () => {
  test.each([
    { name: "hiding page listed first", hiddenFirst: true },
    { name: "hiding page listed last", hiddenFirst: false },
  ])(
    "$name: the page that hides episodes gets nothing, the page that shows them is notified",
    async (order: PageOrderCase) => {
      const hidingPage: StatusPage = statusPage({
        showEpisodesOnStatusPage: false,
        withCustomSmtpAndSms: true,
      });
      const showingPage: StatusPage = statusPage({
        id: SECOND_STATUS_PAGE_ID,
        pageTitle: "Beta Status",
        withCustomSmtpAndSms: true,
      });
      resourcesOnBothPages();
      useCustomTemplatesOnEveryChannel(
        order.hiddenFirst
          ? [hidingPage, showingPage]
          : [showingPage, hidingPage],
      );
      mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mockImplementation(
        async (statusPageId: unknown): Promise<Array<StatusPageSubscriber>> => {
          return (statusPageId as ObjectID).toString() ===
            SECOND_STATUS_PAGE_ID.toString()
            ? [
                subscriber({
                  id: SECOND_SUBSCRIBER_ID,
                  email: "beta@example.com",
                }),
              ]
            : [subscriber()];
        },
      );

      await runJob();

      // The hiding page is never even looked at.
      const pagesRead: Array<string> = mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mock.calls.map((call: Array<unknown>): string => {
        return (call[0] as ObjectID).toString();
      });
      expect(pagesRead).toEqual([SECOND_STATUS_PAGE_ID.toString()]);
      for (const lookup of templateLookups()) {
        expect((lookup["statusPageId"] as ObjectID).toString()).toBe(
          SECOND_STATUS_PAGE_ID.toString(),
        );
      }
      expect(templateLookups()).toHaveLength(4);

      // Exactly one subscriber - the showing page's - hears about it.
      expect(sentMail()).toHaveLength(1);
      expect((sentMail()[0]!["toEmail"] as Email).toString()).toBe(
        "beta@example.com",
      );
      expect(sentSms()).toHaveLength(1);
      expect(sentSlack()).toHaveLength(1);
      expect(sentTeams()).toHaveLength(1);
      expect(sentWebhooks()).toHaveLength(1);
      expect(sentWebhooks()[0]!["statusPageId"]).toBe(
        SECOND_STATUS_PAGE_ID.toString(),
      );

      const calls: Array<CompileCall> = compileCalls();
      expect(calls).toHaveLength(5);
      for (const call of calls) {
        expect(call.variables["statusPageName"]).toBe("Beta Status");
        expect(call.variables["statusPageUrl"]).toBe(SECOND_STATUS_PAGE_URL);
        expect(call.variables["detailsUrl"]).toBe(SECOND_DETAILS_URL);
        expect(call.variables["resourcesAffected"]).toBe("DNS resolvers");
      }

      expect(JSON.stringify(sentWebhooks())).not.toContain("Acme Status");

      expect(feedItems()).toHaveLength(1);
      expect(feedItems()[0]!["displayColor"]).toBe(Blue500);
    },
  );

  test("when every page hides episodes nothing is sent and the feed says so", async () => {
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([
      statusPage({ showEpisodesOnStatusPage: false }),
    ] as never);

    await runJob();

    nothingSent();
    expect(
      StatusPageSubscriberService.getSubscribersByStatusPage,
    ).not.toHaveBeenCalled();
    expect(feedItems()).toHaveLength(1);
    expect(feedItems()[0]!["displayColor"]).toBe(Yellow500);
    expect(feedItems()[0]!["feedInfoInMarkdown"]).toBe(
      `📧 **No notification sent to subscribers** for the creation of [Episode 3](${DASHBOARD_URL}).`,
    );
    expect(statusWrites()[statusWrites().length - 1]).toEqual({
      subscriberNotificationStatusOnEpisodeCreated:
        StatusPageSubscriberNotificationStatus.Success,
      subscriberNotificationStatusMessage:
        "Notifications sent successfully to all subscribers",
    });
  });

  test("a page whose showEpisodesOnStatusPage was not loaded counts as hiding episodes", async () => {
    /*
     * Why StatusPageSubscriberService.getStatusPagesToSendNotification must
     * select showEpisodesOnStatusPage: an unselected column reads as
     * undefined, and this job then skips the page.
     */
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([
      statusPage({ leaveShowEpisodesUnset: true }),
    ] as never);

    await runJob();

    nothingSent();
  });
});

interface ProviderCase {
  name: string;
  withCustomSmtp: boolean;
  withCustomSms: boolean;
}

describe("IncidentEpisode:SendNotificationToSubscribers custom templates need the page's own SMTP and Twilio", () => {
  /*
   * Email uses a custom template only when the status page has custom SMTP,
   * and SMS only when it has custom Twilio. Slack and Teams need neither.
   * Each check is tested on its own, so dropping or swapping one fails.
   */
  test.each([
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
    {
      name: "with custom SMTP and Twilio",
      withCustomSmtp: true,
      withCustomSms: true,
    },
  ])(
    "$name: Email and SMS use custom templates only where configured",
    async (providers: ProviderCase) => {
      const page: StatusPage = statusPage();
      if (providers.withCustomSmtp) {
        (page as unknown as JSONObject)["smtpConfig"] = { _id: "smtp" };
      }
      if (providers.withCustomSms) {
        (page as unknown as JSONObject)["callSmsConfig"] = { _id: "twilio" };
      }
      const bodies: Record<string, string> = useCustomTemplatesOnEveryChannel([
        page,
      ]);

      await runJob();

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
          EmailTemplateType.SubscriberEpisodeCreated,
        );
        expect(sentMail()[0]!["subject"]).toBe(`[Incident] ${EPISODE_TITLE}`);
      }

      expect(sentSms()).toHaveLength(1);
      if (providers.withCustomSms) {
        expect(sentSms()[0]).toContain("channel=sms");
      } else {
        expect(sentSms()[0]).toBe(
          dashboardDefault(StatusPageSubscriberNotificationMethod.SMS),
        );
      }

      expect(sentSlack()).toHaveLength(1);
      expect(sentSlack()[0]).toContain("channel=slack");
      expect(sentTeams()).toHaveLength(1);
      expect(sentTeams()[0]).toContain("channel=teams");
    },
  );
});

describe("IncidentEpisode:SendNotificationToSubscribers custom templates receive every advertised variable", () => {
  test("Email body and subject, SMS, Slack and Teams each get all of them", async () => {
    const bodies: Record<string, string> = useCustomTemplatesOnEveryChannel();

    await runJob();

    const calls: Array<CompileCall> = compileCalls();

    // Email body and subject, SMS, Slack and Teams: one each.
    expect(calls).toHaveLength(5);
    expect(
      calls
        .map((call: CompileCall): string => {
          return call.template;
        })
        .sort(),
    ).toEqual(
      [
        bodies[StatusPageSubscriberNotificationMethod.Email]!,
        EMAIL_SUBJECT_TEMPLATE,
        bodies[StatusPageSubscriberNotificationMethod.SMS]!,
        bodies[StatusPageSubscriberNotificationMethod.Slack]!,
        bodies[StatusPageSubscriberNotificationMethod.MicrosoftTeams]!,
      ].sort(),
    );

    const names: Array<string> =
      SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
        EVENT,
      );
    expect([...names].sort()).toEqual(
      [
        "statusPageName",
        "statusPageUrl",
        "unsubscribeUrl",
        "resourcesAffected",
        "episodeTitle",
        "episodeDescription",
        "episodeSeverity",
        "detailsUrl",
      ].sort(),
    );

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
  });

  test("every template lookup is for the episode-created event", async () => {
    useCustomTemplatesOnEveryChannel();

    await runJob();

    expect(templateLookups()).toHaveLength(4);
    expect(
      templateLookups()
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
      ].sort(),
    );
    for (const lookup of templateLookups()) {
      expect(lookup["eventType"]).toBe(EVENT);
    }
  });
});

interface PageNameCase {
  name: string;
  withoutPageTitle: boolean;
  expected: string;
}

describe("IncidentEpisode:SendNotificationToSubscribers custom template variable values", () => {
  test("resourcesAffected, statusPageName and statusPageUrl belong to the page being notified", async () => {
    resourcesOnBothPages();
    useCustomTemplatesOnEveryChannel([
      statusPage({ withCustomSmtpAndSms: true }),
      statusPage({
        withCustomSmtpAndSms: true,
        id: SECOND_STATUS_PAGE_ID,
        pageTitle: "Beta Status",
      }),
    ]);

    await runJob();

    const calls: Array<CompileCall> = compileCalls();
    expect(calls).toHaveLength(10);

    const valuesByPage: Record<string, Array<string>> = {};
    for (const call of calls) {
      const page: string = call.variables["statusPageName"] as string;
      const values: string = [
        call.variables["statusPageUrl"],
        call.variables["resourcesAffected"],
        call.variables["detailsUrl"],
      ].join(" | ");
      valuesByPage[page] = valuesByPage[page] || [];
      if (!valuesByPage[page]!.includes(values)) {
        valuesByPage[page]!.push(values);
      }
    }

    expect(valuesByPage).toEqual({
      "Acme Status": [`${STATUS_PAGE_URL} | ${RESOURCE} | ${DETAILS_URL}`],
      "Beta Status": [
        `${SECOND_STATUS_PAGE_URL} | DNS resolvers | ${SECOND_DETAILS_URL}`,
      ],
    });
  });

  test.each([
    {
      name: "with a page title",
      withoutPageTitle: false,
      expected: "Acme Status",
    },
    { name: "without a page title", withoutPageTitle: true, expected: "Acme" },
  ])("$name: statusPageName is '$expected'", async (row: PageNameCase) => {
    useCustomTemplatesOnEveryChannel([
      statusPage({
        withCustomSmtpAndSms: true,
        withoutPageTitle: row.withoutPageTitle,
      }),
    ]);

    await runJob();

    const calls: Array<CompileCall> = compileCalls();
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.variables["statusPageName"]).toBe(row.expected);
    }
  });

  test("unsubscribeUrl is each subscriber's own link", async () => {
    useCustomTemplatesOnEveryChannel();
    mock(
      StatusPageSubscriberService.getSubscribersByStatusPage,
    ).mockResolvedValue([
      subscriber(),
      subscriber({ id: SECOND_SUBSCRIBER_ID, email: "second@example.com" }),
    ] as never);

    await runJob();

    const calls: Array<CompileCall> = compileCalls();
    expect(calls).toHaveLength(10);

    // Each subscriber's five templates are compiled before the next one's.
    for (const call of calls.slice(0, 5)) {
      expect(call.variables["unsubscribeUrl"]).toBe(UNSUBSCRIBE_URL);
    }
    for (const call of calls.slice(5)) {
      expect(call.variables["unsubscribeUrl"]).toBe(SECOND_UNSUBSCRIBE_URL);
    }

    expect(sentSms()).toHaveLength(2);
    expect(sentSms()[0]).toContain(`unsubscribeUrl=[${UNSUBSCRIBE_URL}]`);
    expect(sentSms()[1]).toContain(
      `unsubscribeUrl=[${SECOND_UNSUBSCRIBE_URL}]`,
    );
  });

  test("episodeTitle and episodeSeverity come from the episode", async () => {
    useCustomTemplatesOnEveryChannel();

    await runJob();

    const calls: Array<CompileCall> = compileCalls();
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.variables["episodeTitle"]).toBe(EPISODE_TITLE);
      expect(call.variables["episodeSeverity"]).toBe(SEVERITY);
    }
    expect(sentMail()[0]!["subject"]).toBe(
      `Subject: ${EPISODE_TITLE} (${SEVERITY})`,
    );
  });

  test("episodeSeverity reads ' - ' when the episode has no severity, as the default email does", async () => {
    pendingEpisodes = [episode({ withoutSeverity: true })];
    useCustomTemplatesOnEveryChannel();

    await runJob();

    const calls: Array<CompileCall> = compileCalls();
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.variables["episodeSeverity"]).toBe(" - ");
    }
    expect(sentMail()[0]!["subject"]).toBe(`Subject: ${EPISODE_TITLE} ( - )`);
  });

  test("episodeDescription is HTML in the email body, plain text in the subject and SMS, and Markdown in Slack and Teams", async () => {
    const bodies: Record<string, string> = useCustomTemplatesOnEveryChannel();

    await runJob();

    expect(Markdown.convertToHTML).toHaveBeenCalledWith(
      DESCRIPTION,
      MarkdownContentType.Email,
    );
    expect(Markdown.convertToPlainText).toHaveBeenCalledWith(DESCRIPTION);

    const expectedByTemplate: Record<string, string> = {
      [bodies[StatusPageSubscriberNotificationMethod.Email]!]: DESCRIPTION_HTML,
      [EMAIL_SUBJECT_TEMPLATE]: DESCRIPTION_TEXT,
      [bodies[StatusPageSubscriberNotificationMethod.SMS]!]: DESCRIPTION_TEXT,
      [bodies[StatusPageSubscriberNotificationMethod.Slack]!]: DESCRIPTION,
      [bodies[StatusPageSubscriberNotificationMethod.MicrosoftTeams]!]:
        DESCRIPTION,
    };

    const calls: Array<CompileCall> = compileCalls();
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.variables["episodeDescription"]).toBe(
        expectedByTemplate[call.template],
      );
    }
  });

  test("the description is converted once per episode, however many pages and subscribers", async () => {
    resourcesOnBothPages();
    useCustomTemplatesOnEveryChannel([
      statusPage({ withCustomSmtpAndSms: true }),
      statusPage({
        withCustomSmtpAndSms: true,
        id: SECOND_STATUS_PAGE_ID,
        pageTitle: "Beta Status",
      }),
    ]);
    mock(
      StatusPageSubscriberService.getSubscribersByStatusPage,
    ).mockResolvedValue([
      subscriber(),
      subscriber({ id: SECOND_SUBSCRIBER_ID, email: "second@example.com" }),
    ] as never);

    await runJob();

    // Two pages with two subscribers each, five templates per subscriber.
    expect(compileCalls()).toHaveLength(20);
    expect(Markdown.convertToHTML).toHaveBeenCalledTimes(1);
    expect(Markdown.convertToHTML).toHaveBeenCalledWith(
      DESCRIPTION,
      MarkdownContentType.Email,
    );
    expect(Markdown.convertToPlainText).toHaveBeenCalledTimes(1);
    expect(Markdown.convertToPlainText).toHaveBeenCalledWith(DESCRIPTION);
  });

  test("a template using every advertised variable renders completely on every channel", async () => {
    useCustomTemplatesOnEveryChannel();

    await runJob();

    // What the fixtures hold for each advertised variable.
    const expectedValues: Record<string, string> = {
      statusPageName: "Acme Status",
      statusPageUrl: STATUS_PAGE_URL,
      unsubscribeUrl: UNSUBSCRIBE_URL,
      resourcesAffected: RESOURCE,
      episodeTitle: EPISODE_TITLE,
      episodeDescription: DESCRIPTION,
      episodeSeverity: SEVERITY,
      detailsUrl: DETAILS_URL,
    };

    const names: Array<string> =
      SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
        EVENT,
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
     * Each channel gets the description in the format it renders: HTML in
     * the email body, plain text in SMS, and as written in Slack and Teams.
     */
    const descriptionByChannel: Record<string, string> = {
      email: DESCRIPTION_HTML,
      sms: DESCRIPTION_TEXT,
      slack: DESCRIPTION,
      teams: DESCRIPTION,
    };

    for (const [channel, message] of Object.entries(rendered)) {
      expect(message).toContain(`channel=${channel}`);
      expect(message).not.toMatch(/{{|}}/);

      for (const name of names) {
        const value: string =
          name === "episodeDescription"
            ? descriptionByChannel[channel]!
            : expectedValues[name]!;

        expect(value).not.toBe("");
        expect(message).toContain(`${name}=[${value}]`);
      }
    }

    expect(sentMail()[0]!["subject"]).toBe(
      `Subject: ${EPISODE_TITLE} (${SEVERITY})`,
    );
  });
});

interface SubjectFallbackCase {
  name: string;
  withoutTitle: boolean;
  subject: string;
}

describe("IncidentEpisode:SendNotificationToSubscribers custom email subject fallback", () => {
  /*
   * A custom email template without its own subject gets "[Incident] "
   * followed by the episode title; an untitled episode gets the bare prefix
   * rather than "undefined".
   */
  test.each([
    {
      name: "titled",
      withoutTitle: false,
      subject: `[Incident] ${EPISODE_TITLE}`,
    },
    { name: "untitled", withoutTitle: true, subject: "[Incident] " },
  ])("$name: the subject is '$subject'", async (row: SubjectFallbackCase) => {
    pendingEpisodes = [episode({ withoutTitle: row.withoutTitle })];

    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([statusPage({ withCustomSmtpAndSms: true })] as never);
    mock(
      StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
    ).mockImplementation(async (args: unknown) => {
      return (args as JSONObject)["notificationMethod"] ===
        StatusPageSubscriberNotificationMethod.Email
        ? { templateBody: "<p>{{episodeDescription}}</p>" }
        : null;
    });

    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.BlankTemplate,
    );
    expect(sentMail()[0]!["subject"]).toBe(row.subject);
    // The email body gets the description as HTML.
    expect(sentMail()[0]!["vars"]).toEqual({
      body: `<p>${DESCRIPTION_HTML}</p>`,
    });
  });
});

interface ChannelValues {
  emailBody: Record<string, string>;
  plainText: Record<string, string>;
  markdown: Record<string, string>;
}

/*
 * The variables each kind of custom template should get for the fixtures
 * with groupedResources(): only episodeDescription and resourcesAffected
 * differ between them.
 */
function groupedChannelValues(): ChannelValues {
  const shared: Record<string, string> = {
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_PAGE_URL,
    detailsUrl: DETAILS_URL,
    unsubscribeUrl: UNSUBSCRIBE_URL,
    episodeSeverity: SEVERITY,
    episodeTitle: EPISODE_TITLE,
  };

  return {
    emailBody: {
      ...shared,
      episodeDescription: DESCRIPTION_HTML,
      resourcesAffected: GROUPED_RESOURCES_HTML,
    },
    plainText: {
      ...shared,
      episodeDescription: DESCRIPTION_TEXT,
      resourcesAffected: GROUPED_RESOURCES_TEXT,
    },
    markdown: {
      ...shared,
      episodeDescription: DESCRIPTION,
      resourcesAffected: GROUPED_RESOURCES_TEXT,
    },
  };
}

describe("IncidentEpisode:SendNotificationToSubscribers custom templates with grouped resources get their channel's format", () => {
  let bodies: Record<string, string> = {};

  beforeEach(() => {
    bodies = useCustomTemplatesOnEveryChannel(
      undefined,
      FORMAT_EMAIL_SUBJECT_TEMPLATE,
    );
    mock(StatusPageResourceService.findAllBy).mockResolvedValue(
      groupedResources() as never,
    );
  });

  test("renders HTML in the email body, plain text in SMS and the subject, and Markdown in chat", async () => {
    await runJob();

    const values: ChannelValues = groupedChannelValues();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.BlankTemplate,
    );
    expect(sentMail()[0]!["vars"]).toEqual({
      body: renderedEveryVariable("email", values.emailBody),
    });
    expect(sentMail()[0]!["subject"]).toBe(
      `${EPISODE_TITLE}: ${DESCRIPTION_TEXT} (${GROUPED_RESOURCES_TEXT})`,
    );
    expect(sentSms()).toEqual([renderedEveryVariable("sms", values.plainText)]);
    expect(sentSlack()).toEqual([
      renderedEveryVariable("slack", values.markdown),
    ]);
    expect(sentTeams()).toEqual([
      renderedEveryVariable("teams", values.markdown),
    ]);

    // The groups are on their own lines only where HTML is rendered.
    const emailBody: string = (sentMail()[0]!["vars"] as JSONObject)[
      "body"
    ] as string;
    expect(emailBody).toContain(
      `resourcesAffected=[${GROUPED_RESOURCES_HTML}]`,
    );
    expect(emailBody).toContain(`episodeDescription=[${DESCRIPTION_HTML}]`);
    for (const message of [
      sentMail()[0]!["subject"] as string,
      sentSms()[0]!,
      sentSlack()[0]!,
      sentTeams()[0]!,
    ]) {
      expect(message).not.toContain("<br/>");
      expect(message).not.toContain("<p>");
    }
    expect(sentSms()[0]).toContain(
      `resourcesAffected=[${GROUPED_RESOURCES_TEXT}]`,
    );
    expect(sentSlack()[0]).toContain(`episodeDescription=[${DESCRIPTION}]`);
    expect(sentTeams()[0]).toContain(`episodeDescription=[${DESCRIPTION}]`);
  });

  test("hands each channel's template every advertised variable, in that channel's format", async () => {
    await runJob();

    const values: ChannelValues = groupedChannelValues();

    const names: Array<string> =
      SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
        EVENT,
      );
    for (const dictionary of [
      values.emailBody,
      values.plainText,
      values.markdown,
    ]) {
      expect(Object.keys(dictionary).sort()).toEqual([...names].sort());
    }

    expect(compileCalls()).toHaveLength(5);
    expect(
      variablesCompiledInto(
        bodies[StatusPageSubscriberNotificationMethod.Email]!,
      ),
    ).toEqual(values.emailBody);
    expect(variablesCompiledInto(FORMAT_EMAIL_SUBJECT_TEMPLATE)).toEqual(
      values.plainText,
    );
    expect(
      variablesCompiledInto(
        bodies[StatusPageSubscriberNotificationMethod.SMS]!,
      ),
    ).toEqual(values.plainText);
    expect(
      variablesCompiledInto(
        bodies[StatusPageSubscriberNotificationMethod.Slack]!,
      ),
    ).toEqual(values.markdown);
    expect(
      variablesCompiledInto(
        bodies[StatusPageSubscriberNotificationMethod.MicrosoftTeams]!,
      ),
    ).toEqual(values.markdown);
  });

  test("sends webhooks the Markdown description and a plain-text resource list", async () => {
    await runJob();

    expect(sentWebhooks()).toHaveLength(1);
    expect(sentWebhooks()[0]!["eventType"]).toBe("EpisodeCreated");
    expect(sentWebhooks()[0]!["data"]).toEqual({
      episodeId: EPISODE_ID.toString(),
      episodeTitle: EPISODE_TITLE,
      episodeDescription: DESCRIPTION,
      incidentSeverity: SEVERITY,
      resourcesAffected: GROUPED_RESOURCES_TEXT,
      detailsUrl: DETAILS_URL,
    });
  });
});

describe("IncidentEpisode:SendNotificationToSubscribers default email with grouped resources", () => {
  test("still gets HTML for the description and the resource list", async () => {
    mock(StatusPageResourceService.findAllBy).mockResolvedValue(
      groupedResources() as never,
    );

    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberEpisodeCreated,
    );
    expect(sentMail()[0]!["subject"]).toBe(`[Incident] ${EPISODE_TITLE}`);
    expect(sentMail()[0]!["vars"]).toEqual(
      expect.objectContaining({
        episodeDescription: DESCRIPTION_HTML,
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

describe("IncidentEpisode:SendNotificationToSubscribers email subjects are sent as written", () => {
  test.each(TEMPLATE_SYNTAX_DESCRIPTIONS)(
    "a description with $name reaches the custom subject as written",
    async ({ markdown, text }: TemplateSyntaxDescription) => {
      const row: IncidentEpisode = episode();
      row.description = markdown;
      pendingEpisodes = [row];
      mock(Markdown.convertToPlainText).mockImplementation(
        (value: unknown): string => {
          return value === markdown ? text : "";
        },
      );
      useCustomTemplatesOnEveryChannel(
        undefined,
        FORMAT_EMAIL_SUBJECT_TEMPLATE,
      );

      await runJob();

      expect(sentMail()).toHaveLength(1);
      expect(sentMail()[0]!["subject"]).toBe(
        `${EPISODE_TITLE}: ${text} (${RESOURCE})`,
      );
      expect(sentMail()[0]!["isSubjectLiteral"]).toBe(true);
    },
  );

  test("a title with template syntax reaches the default subject as written", async () => {
    const row: IncidentEpisode = episode();
    row.title = "Rollout of {{ .Values.image.tag }} stalled";
    pendingEpisodes = [row];

    await runJob();

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["subject"]).toBe(
      "[Incident] Rollout of {{ .Values.image.tag }} stalled",
    );
    expect(sentMail()[0]!["isSubjectLiteral"]).toBe(true);
  });
});
