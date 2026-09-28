import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
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
 * Incident public note subscriber notifications: the "note posted" job and
 * the new "note updated" job share one send path. These tests drive a tick of
 * each against fakes and check what subscribers receive, which status columns
 * are written, and what lands in the incident feed.
 *
 * The resource list is formatted by the real StatusPageResourceUtil, so the
 * grouped-resource tests see the same "<br/>" and "; " separators that
 * production does.
 */

type CronHandler = () => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};
// The options each job registered with (its timeout among them).
const mockCapturedOptions: Record<string, unknown> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
        mockCapturedOptions[jobName] = options;
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

jest.mock("Common/Server/Services/IncidentPublicNoteService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      updateOneById: jest.fn(),
      // The claim (SubscriberNotificationClaim).
      compareAndSetColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      // IncidentStatusPageScope reads each incident's status page scope.
      findBy: jest.fn(),
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
      Service: {
        /*
         * The real substitution, wrapped in a mock so tests can read the
         * variables each channel handed to its template.
         */
        /*
         * The real email body compile, which escapes every plain value and
         * inserts only SafeHtml ones as HTML, recorded so tests can read what
         * each email body was given (see SubscriberTemplateCompileFixtures).
         */
        compileEmailBodyTemplate: jest.fn(
          (template: string, variables: Record<string, unknown>): string => {
            return (
              jest.requireActual(
                "Common/Types/StatusPage/SubscriberNotificationTemplateCompiler",
              ) as {
                default: {
                  compileEmailBodyTemplate: (
                    template: string,
                    variables: Record<string, unknown>,
                  ) => string;
                };
              }
            ).default.compileEmailBodyTemplate(template, variables);
          },
        ),
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

/*
 * The project's incident custom fields (IncidentTemplateVariableBuilder):
 * none unless a test gives it some (see IncidentCustomFieldFixtures), and the
 * visibility of a Rich text field's inline images, recorded.
 */
jest.mock("Common/Server/Services/IncidentCustomFieldService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Utils/InlineImageAccessTokenSync", () => {
  return { __esModule: true, syncIsPublicForMarkdownImages: jest.fn() };
});

import DatabaseConfig from "Common/Server/DatabaseConfig";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import IncidentPublicNoteService from "Common/Server/Services/IncidentPublicNoteService";
import IncidentService from "Common/Server/Services/IncidentService";
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
import Dictionary from "Common/Types/Dictionary";
import { Blue500, Yellow500 } from "Common/Types/BrandColors";
import {
  StoredIncidentScope,
  allSites,
  incidentScopeFindBy,
  scopedTo,
  siteOf,
  sitePage,
  siteResource,
  siteSubscriber,
  statusPagesByIdFake,
  subscribersByPageFake,
} from "../Fixtures/IncidentStatusPageScopeFixtures";
import {
  expectEveryUnsubscribeLinkToCarryAToken,
  fakeGetUnsubscribeLink,
  smsManageLinkFor,
  unsubscribeLinkFor,
  withUnsubscribeToken,
} from "../Fixtures/UnsubscribeLinkFixtures";
import {
  HOSTILE_PAGE_NAME,
  HOSTILE_PAGE_NAME_HTML,
  HOSTILE_RESOURCES_HTML,
  HOSTILE_RESOURCES_TEXT,
  HOSTILE_TITLE,
  HOSTILE_TITLE_HTML,
  RecordedCompile,
  expectNoHtmlEntities,
  expectOnlyTheListedHtmlVariables,
  hostileResources,
  recordedCompiles,
} from "../Fixtures/SubscriberTemplateCompileFixtures";
import IncidentCustomFieldService from "Common/Server/Services/IncidentCustomFieldService";
import {
  AFFECTED_LOCATION,
  AFFECTED_LOCATION_HTML,
  CUSTOM_FIELD_DEFINITIONS,
  CUSTOM_FIELD_PLACEHOLDERS_TEMPLATE,
  CUSTOM_FIELD_VALUES,
  EXPECTED_CUSTOM_FIELD_ROWS,
  EXPECTED_INCLUDED_FIELDS_FEED,
  EXPECTED_WEBHOOK_CUSTOM_FIELDS,
  IMPACT_DETAILS,
  IMPACT_DETAILS_HTML,
  IMPACT_DETAILS_TEXT,
  INCIDENT_LABELS,
  INTERNAL_TICKET,
  expectOnlyOfferedVariables,
  incidentLabels,
  plainTextOfImpactDetails,
  renderImpactDetails,
} from "../Fixtures/IncidentCustomFieldFixtures";
import { syncIsPublicForMarkdownImages } from "Common/Server/Utils/InlineImageAccessTokenSync";
import {
  StatusWrite,
  statusWritesInOrder,
} from "../Fixtures/SubscriberNotificationSendFixtures";
import {
  PENDING_ROW_VERSION,
  describeSubscriberDelivery,
} from "../Fixtures/SubscriberDeliveryContract";
import { SubscriberNotificationRetryScope } from "Common/Server/Utils/StatusPage/SubscriberNotificationDeliveryRecord";
import SubscriberIncidentEmailBuilder, {
  SubscriberIncidentEmail,
  SubscriberIncidentEmailEvent,
  SubscriberIncidentStatusPageEmail,
} from "Common/Server/Utils/StatusPage/SubscriberIncidentEmailBuilder";
import "../../../../FeatureSet/Workers/Jobs/IncidentPublicNote/SendNotificationToSubscribers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const CREATED_JOB: string = "IncidentPublicNote:SendNotificationToSubscribers";
const UPDATED_JOB: string =
  "IncidentPublicNote:SendUpdateNotificationToSubscribers";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const NOTE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const SECOND_NOTE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
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
const DETAILS_URL: string = `${STATUS_PAGE_URL}/incidents/${INCIDENT_ID.toString()}`;
const UNSUBSCRIBE_URL: string = unsubscribeLinkFor(
  STATUS_PAGE_URL,
  SUBSCRIBER_ID,
);
// An SMS from this public page carries the manage link (see smsManageLinkFor).
const SMS_UNSUBSCRIBE_URL: string = smsManageLinkFor(
  STATUS_PAGE_URL,
  SUBSCRIBER_ID,
);
const DASHBOARD_URL: string = "https://oneuptime.acme.com/dashboard/incident/1";

const INCIDENT_TITLE: string = "Checkout requests failing";
const NOTE: string = "Traffic moved to the **standby** region.";
const NOTE_HTML: string =
  "<p>Traffic moved to the <strong>standby</strong> region.</p>";
const NOTE_TEXT: string = "Traffic moved to the standby region.";
const INCIDENT_STATE_NAME: string = "Identified";

/*
 * When the note says it was posted: months before any test runs, so a value
 * formatted from "now" can never pass for it.
 */
const POSTED_AT: Date = new Date("2026-03-04T12:00:00.000Z");

const GROUPED_RESOURCES_HTML: string =
  "Europe: Checkout API<br/>Americas: Payments API";
const GROUPED_RESOURCES_TEXT: string =
  "Europe: Checkout API; Americas: Payments API";

let createdNotes: Array<IncidentPublicNote> = [];
let updatedNotes: Array<IncidentPublicNote> = [];
let storedIncident: Incident | null = null;
// The status page scope stored for each incident id; unscoped when absent.
let storedScopes: Dictionary<StoredIncidentScope> = {};

function publicNote(overrides?: {
  id?: ObjectID;
  subscriberNotificationStatusOnNoteCreated?: StatusPageSubscriberNotificationStatus;
  // null leaves postedAt unset, like a legacy row.
  postedAt?: Date | null;
}): IncidentPublicNote {
  const note: IncidentPublicNote = new IncidentPublicNote();
  note._id = (overrides?.id || NOTE_ID).toString();
  note.note = NOTE;
  note.incidentId = INCIDENT_ID;
  note.projectId = PROJECT_ID;
  if (overrides?.postedAt !== null) {
    note.postedAt = overrides?.postedAt || POSTED_AT;
  }
  note.subscriberNotificationStatusOnNoteCreated =
    overrides?.subscriberNotificationStatusOnNoteCreated ||
    StatusPageSubscriberNotificationStatus.Success;
  return note;
}

function incident(overrides?: {
  isVisibleOnStatusPage?: boolean;
  withoutMonitors?: boolean;
  withoutCurrentState?: boolean;
  withoutTitle?: boolean;
}): Incident {
  const row: Incident = new Incident();
  row._id = INCIDENT_ID.toString();
  if (!overrides?.withoutTitle) {
    row.title = INCIDENT_TITLE;
  }
  row.description = "Payments fail in Europe.";
  row.projectId = PROJECT_ID;
  row.isVisibleOnStatusPage = overrides?.isVisibleOnStatusPage !== false;
  row.incidentNumber = 7;
  row.incidentNumberWithPrefix = "INC-7";

  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical";
  row.incidentSeverity = severity;

  if (!overrides?.withoutCurrentState) {
    const state: IncidentState = new IncidentState();
    state.name = INCIDENT_STATE_NAME;
    row.currentIncidentState = state;
  }

  if (!overrides?.withoutMonitors) {
    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID.toString();
    row.monitors = [monitor];
  } else {
    row.monitors = [];
  }

  // {{incidentLabels}} reads them alphabetically (INCIDENT_LABELS).
  row.labels = incidentLabels();

  return row;
}

function statusPage(overrides?: {
  showIncidentsOnStatusPage?: boolean;
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
  page.showIncidentsOnStatusPage =
    overrides?.showIncidentsOnStatusPage !== false;
  page.onlyShowScopedIncidents = false;
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
}): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = overrides?.id || "88888888-8888-4888-8888-888888888888";
  row.statusPageId = overrides?.statusPageId || STATUS_PAGE_ID;
  row.displayName = overrides?.displayName || "Checkout API";
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
  return withUnsubscribeToken(row);
}

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
}

/*
 * The email is built by SubscriberIncidentEmailBuilder, the code path the
 * notification preview renders with, so what is previewed is what is sent.
 * Wraps the real builder, recording what it was given and built.
 */
interface BuiltPage {
  data: Parameters<typeof SubscriberIncidentEmailBuilder.forStatusPage>[0];
  pageEmail: SubscriberIncidentStatusPageEmail;
}

function spyOnEmailBuilder(): Array<BuiltPage> {
  const built: Array<BuiltPage> = [];
  const forStatusPage: typeof SubscriberIncidentEmailBuilder.forStatusPage =
    SubscriberIncidentEmailBuilder.forStatusPage.bind(
      SubscriberIncidentEmailBuilder,
    );

  jest
    .spyOn(SubscriberIncidentEmailBuilder, "forStatusPage")
    .mockImplementation(async (data: BuiltPage["data"]) => {
      const pageEmail: SubscriberIncidentStatusPageEmail =
        await forStatusPage(data);

      built.push({ data: data, pageEmail: pageEmail });

      return pageEmail;
    });

  return built;
}

/*
 * Every status write the job made, in order: the claim to InProgress
 * (SubscriberNotificationClaim) and each updateOneById.
 */
function statusWrites(): Array<JSONObject> {
  return statusWritesInOrder({
    claim: IncidentPublicNoteService.compareAndSetColumnsByIdWithoutHooks,
    update: IncidentPublicNoteService.updateOneById,
  }).map((write: StatusWrite): JSONObject => {
    return write.data;
  });
}

function writesFor(id: ObjectID): Array<JSONObject> {
  return statusWritesInOrder({
    claim: IncidentPublicNoteService.compareAndSetColumnsByIdWithoutHooks,
    update: IncidentPublicNoteService.updateOneById,
    id: id,
  }).map((write: StatusWrite): JSONObject => {
    return write.data;
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
  return mock(IncidentFeedService.createIncidentFeedItem).mock.calls.map(
    (call: Array<unknown>): JSONObject => {
      return call[0] as JSONObject;
    },
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
    unsubscribeUrl:
      method === StatusPageSubscriberNotificationMethod.SMS
        ? SMS_UNSUBSCRIBE_URL
        : UNSUBSCRIBE_URL,
    incidentTitle: INCIDENT_TITLE,
    incidentSeverity: "Critical",
    resourcesAffected: "Checkout API",
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
  // Text and email body compiles, in order (see SubscriberTemplateCompileFixtures).
  return recordedCompiles(
    StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate,
    StatusPageSubscriberNotificationTemplateServiceClass.compileEmailBodyTemplate,
  ).map((call: RecordedCompile): CompileCall => {
    return {
      template: call.template,
      variables: call.variables,
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
      StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated,
  },
  {
    name: "updated job",
    job: UPDATED_JOB,
    eventType:
      StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteUpdated,
  },
];

// Puts one note in the queue the given job reads.
function queueNote(job: string, overrides?: { postedAt?: Date | null }): void {
  const note: IncidentPublicNote = publicNote(overrides);

  if (job === UPDATED_JOB) {
    updatedNotes = [note];
  } else {
    createdNotes = [note];
  }
}

/*
 * The custom email subject. It echoes the note and the resource list too,
 * so a test can see that the subject gets them as plain text.
 */
const EMAIL_SUBJECT_TEMPLATE: string =
  "Subject: {{incidentTitle}} ({{incidentState}}, {{postedAt}}) {{note}} [{{resourcesAffected}}]";

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
 * Gives the status pages custom SMTP and Twilio and a custom template for
 * the event on Email, SMS, Slack and Teams, each printing every advertised
 * variable. A lookup for any other event finds no template. Returns the
 * body used for each channel.
 */
function useCustomTemplatesOnEveryChannel(
  eventType: StatusPageSubscriberNotificationEventType,
  pages?: Array<StatusPage>,
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
      ? { templateBody: bodies[method], emailSubject: EMAIL_SUBJECT_TEMPLATE }
      : { templateBody: bodies[method] };
  });

  return bodies;
}

beforeEach(() => {
  jest.clearAllMocks();

  // No incident custom fields unless a test gives the project some.
  mock(IncidentCustomFieldService.findBy).mockResolvedValue([] as never);
  mock(syncIsPublicForMarkdownImages).mockResolvedValue(undefined as never);

  createdNotes = [];
  updatedNotes = [];
  storedIncident = incident();
  storedScopes = {};

  mock(IncidentService.findBy).mockImplementation(
    incidentScopeFindBy(() => {
      return storedScopes;
    }) as never,
  );

  mock(IncidentPublicNoteService.findBy).mockImplementation(
    async (args: unknown): Promise<Array<IncidentPublicNote>> => {
      const query: JSONObject = (args as { query: JSONObject }).query;

      return query["subscriberNotificationStatusOnNoteUpdated"]
        ? updatedNotes
        : createdNotes;
    },
  );
  mock(IncidentPublicNoteService.updateOneById).mockResolvedValue(1 as never);
  // This run wins every claim unless a test says otherwise.
  mock(
    IncidentPublicNoteService.compareAndSetColumnsByIdWithoutHooks,
  ).mockResolvedValue(true as never);

  mock(IncidentService.findOneById).mockImplementation(async () => {
    return storedIncident;
  });
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
  mock(StatusPageSubscriberService.getUnsubscribeLink).mockImplementation(
    fakeGetUnsubscribeLink,
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

describe("IncidentPublicNote:SendUpdateNotificationToSubscribers", () => {
  test("is registered next to the created job", () => {
    expect(mockCapturedJobs[UPDATED_JOB]).toBeDefined();
    expect(mockCapturedJobs[CREATED_JOB]).toBeDefined();
  });

  test("looks only for notes with a pending update notification and reads the original status", async () => {
    await runJob(UPDATED_JOB);

    const args: { query: JSONObject; select: JSONObject } = mock(
      IncidentPublicNoteService.findBy,
    ).mock.calls[0]![0] as { query: JSONObject; select: JSONObject };

    expect(args.query).toEqual({
      subscriberNotificationStatusOnNoteUpdated:
        StatusPageSubscriberNotificationStatus.Pending,
    });
    expect(args.select["subscriberNotificationStatusOnNoteCreated"]).toBe(true);
    expect(args.select["note"]).toBe(true);
    expect(args.select["incidentId"]).toBe(true);
    expect(args.select["postedAt"]).toBe(true);
  });

  test("does not resolve the host when nothing is pending", async () => {
    await runJob(UPDATED_JOB);

    expect(DatabaseConfig.getHost).not.toHaveBeenCalled();
    nothingSent();
  });

  /*
   * The 'posted' notification is still queued: it has not gone out, and the
   * run that claims it reads the note afresh (the edit changed its version),
   * so it carries the edit. The update is skipped - once claimed, so a
   * decision from an old read never overwrites anything.
   */
  test("skips while the note's original notification is Pending, once it has claimed the update", async () => {
    updatedNotes = [
      publicNote({
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.Pending,
      }),
    ];

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(IncidentService.findOneById).not.toHaveBeenCalled();
    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatusOnNoteUpdated:
          StatusPageSubscriberNotificationStatus.InProgress,
      },
      {
        subscriberNotificationStatusOnNoteUpdated:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessageOnNoteUpdated:
          SubscriberUpdateNotification.notYetNotifiedMessage,
      },
    ]);
  });

  test("a skip decided from an old read is not written when the note changed since", async () => {
    updatedNotes = [
      publicNote({
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.Pending,
      }),
    ];
    // Queued again, or claimed by another run, since this run read it.
    mock(
      IncidentPublicNoteService.compareAndSetColumnsByIdWithoutHooks,
    ).mockResolvedValue(false as never);

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(IncidentPublicNoteService.updateOneById).not.toHaveBeenCalled();
  });

  /*
   * The 'posted' notification is being sent right now, with the note as it
   * was before the edit - a typo fixed, or an ETA corrected, right after
   * posting. Skipping the update would leave subscribers with the old text.
   */
  test("waits, untouched, while the note's original notification is being sent", async () => {
    updatedNotes = [
      publicNote({
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.InProgress,
      }),
    ];

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(
      IncidentPublicNoteService.compareAndSetColumnsByIdWithoutHooks,
    ).not.toHaveBeenCalled();
    expect(IncidentPublicNoteService.updateOneById).not.toHaveBeenCalled();
    expect(feedItems()).toEqual([]);
  });

  test("sends the edit once the original notification has gone out", async () => {
    updatedNotes = [
      publicNote({
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.InProgress,
      }),
    ];

    await runJob(UPDATED_JOB);
    nothingSent();

    // A later run: the original settled with the text from before the edit.
    updatedNotes = [
      publicNote({
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.Success,
      }),
    ];

    await runJob(UPDATED_JOB);

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberIncidentNoteUpdated,
    );
    expect(
      statusWrites()[statusWrites().length - 1]![
        "subscriberNotificationStatusOnNoteUpdated"
      ],
    ).toBe(StatusPageSubscriberNotificationStatus.Success);
  });

  test("emails the updated-note template with an update subject", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberIncidentNoteUpdated,
    );
    expect(sentMail()[0]!["subject"]).toBe(
      `[Incident Note Updated] ${INCIDENT_TITLE}`,
    );
    expect(sentMail()[0]!["vars"]).toEqual(
      expect.objectContaining({
        note: NOTE_HTML,
        incidentTitle: INCIDENT_TITLE,
        incidentSeverity: "Critical",
        resourcesAffected: "Checkout API",
        detailsUrl: DETAILS_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
      }),
    );
  });

  test("uses the update wording on SMS, Slack and Teams, matching the dashboard defaults", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    expect(sentSms()).toEqual([
      `Incident update: ${INCIDENT_TITLE} on Acme Status. A note has been updated. Details: ${DETAILS_URL}. Unsub: ${SMS_UNSUBSCRIBE_URL}`,
    ]);

    const event: StatusPageSubscriberNotificationEventType =
      StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteUpdated;

    expect(sentSms()[0]).toBe(
      dashboardDefault(event, StatusPageSubscriberNotificationMethod.SMS),
    );
    expect(sentSlack()[0]).toContain(
      "**A note on this incident has been updated**",
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

  test("tells webhook subscribers it is an IncidentNoteUpdated event with the latest note", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    expect(sentWebhooks()).toHaveLength(1);
    expect(sentWebhooks()[0]!["eventType"]).toBe("IncidentNoteUpdated");
    expect(sentWebhooks()[0]!["data"]).toEqual({
      incidentId: INCIDENT_ID.toString(),
      incidentNumber: "7",
      incidentTitle: INCIDENT_TITLE,
      incidentSeverity: "Critical",
      resourcesAffected: "Checkout API",
      note: NOTE,
      detailsUrl: DETAILS_URL,
      // The project has no fields included in subscriber notifications.
      customFields: {},
    });
  });

  test("looks up custom templates for the updated event", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    const lookups: Array<JSONObject> = mock(
      StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
    ).mock.calls.map((call: Array<unknown>): JSONObject => {
      return call[0] as JSONObject;
    });

    expect(lookups).toHaveLength(4);
    for (const lookup of lookups) {
      expect(lookup["eventType"]).toBe(
        StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteUpdated,
      );
    }
  });

  test("records in the incident feed that subscribers were told about an edited note", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    expect(feedItems()).toHaveLength(1);
    expect(feedItems()[0]!["feedInfoInMarkdown"]).toBe(
      `📧 **Notification sent to subscribers** because a public note was updated on this [Incident INC-7](${DASHBOARD_URL}).`,
    );
    expect(feedItems()[0]!["moreInformationInMarkdown"]).toContain(NOTE);
  });

  test("records in the feed when no subscriber matched the edited note", async () => {
    updatedNotes = [publicNote()];
    mock(StatusPageSubscriberService.shouldSendNotification).mockReturnValue(
      false,
    );

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(feedItems()[0]!["feedInfoInMarkdown"]).toBe(
      `📧 **No notification sent to subscribers** for the updated public note on [Incident INC-7](${DASHBOARD_URL}).`,
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
          // Then what was sent on each status page (see the delivery tests).
          `${SubscriberUpdateNotification.sentMessage} Acme: 1 email, 1 SMS, 1 Slack, 1 Microsoft Teams, 1 webhook sent.`,
      },
    ]);
  });

  test("writes its status without hooks so it never re-queues itself", async () => {
    updatedNotes = [publicNote()];

    await runJob(UPDATED_JOB);

    for (const call of mock(IncidentPublicNoteService.updateOneById).mock
      .calls) {
      expect((call[0] as JSONObject)["props"]).toEqual({
        isRoot: true,
        ignoreHooks: true,
      });
    }
  });

  test("skips the update when the incident is no longer visible on the status page", async () => {
    updatedNotes = [publicNote()];
    storedIncident = incident({ isVisibleOnStatusPage: false });

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(statusWrites()[statusWrites().length - 1]).toEqual({
      subscriberNotificationStatusOnNoteUpdated:
        StatusPageSubscriberNotificationStatus.Skipped,
      subscriberNotificationStatusMessageOnNoteUpdated:
        "Notifications skipped as incident is not visible on status page.",
    });
  });

  test("skips the update when the incident has been deleted", async () => {
    updatedNotes = [publicNote()];
    storedIncident = null;

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(statusWrites()).toEqual([
      {
        subscriberNotificationStatusOnNoteUpdated:
          StatusPageSubscriberNotificationStatus.InProgress,
      },
      {
        subscriberNotificationStatusOnNoteUpdated:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessageOnNoteUpdated:
          "Related incident not found. Skipping notifications to subscribers.",
      },
    ]);
  });

  test("skips the update when the incident has no monitors", async () => {
    updatedNotes = [publicNote()];
    storedIncident = incident({ withoutMonitors: true });

    await runJob(UPDATED_JOB);

    nothingSent();
    expect(
      statusWrites().map((write: JSONObject) => {
        return write["subscriberNotificationStatusOnNoteUpdated"];
      }),
    ).toEqual([
      StatusPageSubscriberNotificationStatus.InProgress,
      StatusPageSubscriberNotificationStatus.Skipped,
    ]);
  });

  test("respects a status page that hides incidents", async () => {
    updatedNotes = [publicNote()];
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([
      statusPage({ showIncidentsOnStatusPage: false }),
    ] as never);

    await runJob(UPDATED_JOB);

    nothingSent();
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

  test("handles each note on its own in a multi-note tick", async () => {
    updatedNotes = [
      publicNote({
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.Pending,
      }),
      publicNote({ id: SECOND_NOTE_ID }),
    ];

    await runJob(UPDATED_JOB);

    // Claimed, then skipped: its original has not gone out yet.
    expect(
      writesFor(NOTE_ID).map((write: JSONObject) => {
        return write["subscriberNotificationStatusOnNoteUpdated"];
      }),
    ).toEqual([
      StatusPageSubscriberNotificationStatus.InProgress,
      StatusPageSubscriberNotificationStatus.Skipped,
    ]);
    expect(
      writesFor(SECOND_NOTE_ID).map((write: JSONObject) => {
        return write["subscriberNotificationStatusOnNoteUpdated"];
      }),
    ).toEqual([
      StatusPageSubscriberNotificationStatus.InProgress,
      StatusPageSubscriberNotificationStatus.Success,
    ]);
    expect(sentMail()).toHaveLength(1);
  });

  test("keeps going after one note's status write fails", async () => {
    updatedNotes = [
      publicNote({
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.Pending,
      }),
      publicNote({ id: SECOND_NOTE_ID }),
    ];

    mock(IncidentPublicNoteService.updateOneById).mockRejectedValueOnce(
      new Error("database hiccup") as never,
    );

    await expect(runJob(UPDATED_JOB)).resolves.toBeUndefined();

    expect(sentMail()).toHaveLength(1);
    expect(
      writesFor(SECOND_NOTE_ID).map((write: JSONObject) => {
        return write["subscriberNotificationStatusOnNoteUpdated"];
      }),
    ).toEqual([
      StatusPageSubscriberNotificationStatus.InProgress,
      StatusPageSubscriberNotificationStatus.Success,
    ]);
  });
});

describe("IncidentPublicNote jobs send the builder's email", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(TRIGGERS)(
    "the $name builds each page's email once and sends it as built",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);
      const built: Array<BuiltPage> = spyOnEmailBuilder();

      await runJob(trigger.job);

      expect(built).toHaveLength(1);
      expect(built[0]!.data.event).toBe(
        trigger.job === UPDATED_JOB
          ? SubscriberIncidentEmailEvent.IncidentPublicNoteUpdated
          : SubscriberIncidentEmailEvent.IncidentPublicNoteCreated,
      );
      expect(built[0]!.data.statusPage._id).toBe(STATUS_PAGE_ID.toString());
      expect(built[0]!.data.detailsUrl).toBe(DETAILS_URL);

      const expected: SubscriberIncidentEmail =
        built[0]!.pageEmail.forSubscriber({
          unsubscribeUrl: UNSUBSCRIBE_URL,
        });

      expect(sentMail()).toEqual([
        {
          toEmail: new Email("customer@example.com"),
          ...expected.envelope,
        },
      ]);
    },
  );
});

describe("IncidentPublicNote:SendNotificationToSubscribers (created)", () => {
  /*
   * A note edited with 'notify subscribers' ticked before it was announced
   * has both notifications Pending. The posted one goes out with the edit in
   * it (its claim checks the version it read), so its claim settles the
   * update one as Skipped in the same write - otherwise an update run that
   * read the note earlier, and lost its claim to the changed version, would
   * send "a note has been updated" with the text just sent as the new note.
   */
  test("claiming a note's posted notification skips an update notification it covers, in the same write", async () => {
    const note: IncidentPublicNote = publicNote({
      subscriberNotificationStatusOnNoteCreated:
        StatusPageSubscriberNotificationStatus.Pending,
    });
    note.version = 2;
    note.subscriberNotificationStatusOnNoteUpdated =
      StatusPageSubscriberNotificationStatus.Pending;
    createdNotes = [note];

    await runJob(CREATED_JOB);

    const select: JSONObject = (
      mock(IncidentPublicNoteService.findBy).mock.calls[0]![0] as {
        select: JSONObject;
      }
    ).select;
    expect(select["subscriberNotificationStatusOnNoteUpdated"]).toBe(true);

    const claim: JSONObject = mock(
      IncidentPublicNoteService.compareAndSetColumnsByIdWithoutHooks,
    ).mock.calls[0]![0] as JSONObject;

    expect(claim["data"]).toEqual({
      subscriberNotificationStatusOnNoteCreated:
        StatusPageSubscriberNotificationStatus.InProgress,
      subscriberNotificationStatusOnNoteUpdated:
        StatusPageSubscriberNotificationStatus.Skipped,
      subscriberNotificationStatusMessageOnNoteUpdated:
        SubscriberUpdateNotification.notYetNotifiedMessage,
    });
    // Only while the update is still Pending: never one another run is sending.
    expect(claim["expectedData"]).toEqual({
      subscriberNotificationStatusOnNoteCreated:
        StatusPageSubscriberNotificationStatus.Pending,
      subscriberNotificationStatusOnNoteUpdated:
        StatusPageSubscriberNotificationStatus.Pending,
      version: 2,
    });
    expect(sentMail()).toHaveLength(1);
  });

  test.each([
    StatusPageSubscriberNotificationStatus.Success,
    StatusPageSubscriberNotificationStatus.InProgress,
    StatusPageSubscriberNotificationStatus.Failed,
    undefined,
  ])(
    "an update notification that is %s is not touched by the posted notification's claim",
    async (
      updateStatus: StatusPageSubscriberNotificationStatus | undefined,
    ) => {
      const note: IncidentPublicNote = publicNote({
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.Pending,
      });
      note.version = 2;
      if (updateStatus) {
        note.subscriberNotificationStatusOnNoteUpdated = updateStatus;
      }
      createdNotes = [note];

      await runJob(CREATED_JOB);

      const claim: JSONObject = mock(
        IncidentPublicNoteService.compareAndSetColumnsByIdWithoutHooks,
      ).mock.calls[0]![0] as JSONObject;

      expect(claim["data"]).toEqual({
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.InProgress,
      });
      expect(claim["expectedData"]).toEqual({
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.Pending,
        version: 2,
      });
    },
  );

  test("still only picks up notes whose author asked to notify", async () => {
    await runJob(CREATED_JOB);

    const query: JSONObject = (
      mock(IncidentPublicNoteService.findBy).mock.calls[0]![0] as {
        query: JSONObject;
      }
    ).query;

    expect(query).toEqual({
      subscriberNotificationStatusOnNoteCreated:
        StatusPageSubscriberNotificationStatus.Pending,
      shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true,
    });
  });

  test("reads the note's own postedAt for {{postedAt}}", async () => {
    await runJob(CREATED_JOB);

    const select: JSONObject = (
      mock(IncidentPublicNoteService.findBy).mock.calls[0]![0] as {
        select: JSONObject;
      }
    ).select;

    expect(select["postedAt"]).toBe(true);
    expect(select["note"]).toBe(true);
    expect(select["incidentId"]).toBe(true);
  });

  test("sends the new-note messages it always has", async () => {
    createdNotes = [
      publicNote({
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.Pending,
      }),
    ];

    await runJob(CREATED_JOB);

    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.SubscriberIncidentNoteCreated,
    );
    expect(sentMail()[0]!["subject"]).toBe(
      `[Update Incident] ${INCIDENT_TITLE}`,
    );
    expect(sentSms()[0]).toBe(
      `Incident update: ${INCIDENT_TITLE} on Acme Status. A new note is posted. Details: ${DETAILS_URL}. Unsub: ${SMS_UNSUBSCRIBE_URL}`,
    );
    expect(sentSlack()[0]).toContain(
      "**New note has been added to an incident**",
    );
    expect(sentWebhooks()[0]!["eventType"]).toBe("IncidentNoteCreated");
    expect(feedItems()[0]!["feedInfoInMarkdown"]).toContain(
      "because a public note is added to this [Incident INC-7]",
    );
  });

  test("still matches the dashboard's created defaults", async () => {
    createdNotes = [publicNote()];

    await runJob(CREATED_JOB);

    const event: StatusPageSubscriberNotificationEventType =
      StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated;

    expect(sentSms()[0]).toBe(
      dashboardDefault(event, StatusPageSubscriberNotificationMethod.SMS),
    );
    expect(sentSlack()[0]).toBe(
      dashboardDefault(event, StatusPageSubscriberNotificationMethod.Slack),
    );
  });

  test("uses a custom email template's subject fallback for new notes", async () => {
    createdNotes = [publicNote()];

    const page: StatusPage = statusPage();
    (page as unknown as JSONObject)["smtpConfig"] = { _id: "smtp" };
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([page] as never);
    mock(
      StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
    ).mockImplementation(async (args: unknown) => {
      return (args as JSONObject)["notificationMethod"] ===
        StatusPageSubscriberNotificationMethod.Email
        ? { templateBody: "<p>{{note}}</p>" }
        : null;
    });

    await runJob(CREATED_JOB);

    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.BlankTemplate,
    );
    expect(sentMail()[0]!["subject"]).toBe(
      `[Incident Update] ${INCIDENT_TITLE}`,
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
          "Notifications sent successfully to all subscribers. Acme: 1 email, 1 SMS, 1 Slack, 1 Microsoft Teams, 1 webhook sent.",
      },
    ]);
  });

  /*
   * One page's send breaking used to end the whole notification: the pages
   * after it were never tried, and the per-page record and the feed item
   * were replaced by the bare error message.
   */
  test("a page whose send breaks does not stop the pages after it", async () => {
    createdNotes = [publicNote()];
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([
      statusPage(),
      statusPage({ id: SECOND_STATUS_PAGE_ID, pageTitle: "Beta Status" }),
    ] as never);
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue([
      resource(),
      resource({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        statusPageId: SECOND_STATUS_PAGE_ID,
      }),
    ] as never);
    // The first page's subscribers cannot be read; the second page's can.
    mock(
      StatusPageSubscriberService.getSubscribersByStatusPage,
    ).mockImplementation(async (statusPageId: unknown) => {
      if ((statusPageId as ObjectID).toString() === STATUS_PAGE_ID.toString()) {
        throw new Error("could not read the subscribers");
      }

      return [subscriber()];
    });

    await runJob(CREATED_JOB);

    // The second page was still sent it, on every channel.
    expect(sentMail()).toHaveLength(1);
    expect(sentWebhooks()).toHaveLength(1);

    const settled: JSONObject = statusWrites()[statusWrites().length - 1]!;
    expect(settled["subscriberNotificationStatusOnNoteCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Failed,
    );
    expect(settled["subscriberNotificationStatusMessage"]).toContain(
      "Sending to a status page failed part-way.",
    );
    expect(settled["subscriberNotificationStatusMessage"]).toContain(
      "1 email, 1 SMS, 1 Slack, 1 Microsoft Teams, 1 webhook sent",
    );
    expect(feedItems()).toHaveLength(1);
  });

  test("marks the original notification Failed when sending breaks", async () => {
    createdNotes = [publicNote()];
    mock(Markdown.convertToHTML).mockRejectedValue(
      new Error("markdown exploded") as never,
    );

    await runJob(CREATED_JOB);

    expect(statusWrites()[statusWrites().length - 1]).toEqual({
      subscriberNotificationStatusOnNoteCreated:
        StatusPageSubscriberNotificationStatus.Failed,
      subscriberNotificationStatusMessage: "markdown exploded",
    });
  });
});

describe("IncidentPublicNote update job, with a custom update email template", () => {
  test("falls back to the update subject when the template has none", async () => {
    updatedNotes = [publicNote()];

    const page: StatusPage = statusPage();
    (page as unknown as JSONObject)["smtpConfig"] = { _id: "smtp" };
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([page] as never);
    mock(
      StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
    ).mockImplementation(async (args: unknown) => {
      return (args as JSONObject)["notificationMethod"] ===
        StatusPageSubscriberNotificationMethod.Email
        ? { templateBody: "<p>Edited: {{note}}</p>" }
        : null;
    });

    await runJob(UPDATED_JOB);

    expect(sentMail()[0]!["templateType"]).toBe(
      EmailTemplateType.BlankTemplate,
    );
    expect(sentMail()[0]!["subject"]).toBe(
      `[Incident Note Updated] ${INCIDENT_TITLE}`,
    );
    // The note is HTML here: nothing converts a custom email body later.
    expect(sentMail()[0]!["vars"]).toEqual({
      body: `<p>Edited: ${NOTE_HTML}</p>`,
    });
  });
});

/*
 * Custom templates get each value in the format their channel renders: HTML
 * in the email body (BlankTemplate converts nothing), plain text in SMS and
 * the email subject, and the Markdown as written in Slack and Teams. The
 * resources here sit in two groups, so the real resource list is "<br/>"
 * joined in HTML and "; " joined everywhere else.
 */
describe("IncidentPublicNote custom templates, in each channel's format", () => {
  beforeEach(() => {
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
      groupedResources() as never,
    );
  });

  test.each(TRIGGERS)(
    "$name: renders HTML in the email body, plain text in SMS and the subject, and Markdown in chat",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);
      useCustomTemplatesOnEveryChannel(trigger.eventType);

      await runJob(trigger.job);

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

      const expected: Record<
        string,
        { note: string; resourcesAffected: string }
      > = {
        email: { note: NOTE_HTML, resourcesAffected: GROUPED_RESOURCES_HTML },
        sms: { note: NOTE_TEXT, resourcesAffected: GROUPED_RESOURCES_TEXT },
        slack: { note: NOTE, resourcesAffected: GROUPED_RESOURCES_TEXT },
        teams: { note: NOTE, resourcesAffected: GROUPED_RESOURCES_TEXT },
      };

      for (const [channel, message] of Object.entries(rendered)) {
        expect(message).toContain(`channel=${channel}`);
        expect(message).toContain(`note=[${expected[channel]!.note}]`);
        expect(message).toContain(
          `resourcesAffected=[${expected[channel]!.resourcesAffected}]`,
        );

        // Only the HTML email body may carry the HTML line break.
        if (channel !== "email") {
          expect(message).not.toContain("<br/>");
        }
      }

      const postedAt: string =
        OneUptimeDate.getDateAsUserFriendlyFormattedString(POSTED_AT);
      expect(sentMail()[0]!["subject"]).toBe(
        `Subject: ${INCIDENT_TITLE} (${INCIDENT_STATE_NAME}, ${postedAt}) ${NOTE_TEXT} [${GROUPED_RESOURCES_TEXT}]`,
      );
    },
  );

  test.each(TRIGGERS)(
    "$name: hands each channel's template every advertised variable, in that channel's format",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);
      const bodies: Record<string, string> = useCustomTemplatesOnEveryChannel(
        trigger.eventType,
      );

      await runJob(trigger.job);

      // Identical on every channel.
      const shared: Record<string, string> = {
        statusPageName: "Acme Status",
        statusPageUrl: STATUS_PAGE_URL,
        detailsUrl: DETAILS_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
        incidentSeverity: "Critical",
        incidentTitle: INCIDENT_TITLE,
        incidentState: INCIDENT_STATE_NAME,
        postedAt: OneUptimeDate.getDateAsUserFriendlyFormattedString(POSTED_AT),
        incidentLabels: INCIDENT_LABELS,
        affectedStatusPages: "Acme Status",
      };
      const html: Record<string, string> = {
        ...shared,
        note: NOTE_HTML,
        resourcesAffected: GROUPED_RESOURCES_HTML,
      };
      const plainText: Record<string, string> = {
        ...shared,
        note: NOTE_TEXT,
        resourcesAffected: GROUPED_RESOURCES_TEXT,
      };
      const markdown: Record<string, string> = {
        ...shared,
        note: NOTE,
        resourcesAffected: GROUPED_RESOURCES_TEXT,
      };

      // Each dictionary is exactly the advertised variables.
      const names: Array<string> =
        SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
          trigger.eventType,
        );
      expect(Object.keys(html).sort()).toEqual([...names].sort());

      expect(compileCalls()).toHaveLength(5);
      expect(
        variablesCompiledInto(
          bodies[StatusPageSubscriberNotificationMethod.Email]!,
        ),
      ).toEqual(html);
      expect(variablesCompiledInto(EMAIL_SUBJECT_TEMPLATE)).toEqual(plainText);
      // An SMS from this public page carries the manage link (see smsManageLinkFor).
      expect(
        variablesCompiledInto(
          bodies[StatusPageSubscriberNotificationMethod.SMS]!,
        ),
      ).toEqual({ ...plainText, unsubscribeUrl: SMS_UNSUBSCRIBE_URL });
      expect(
        variablesCompiledInto(
          bodies[StatusPageSubscriberNotificationMethod.Slack]!,
        ),
      ).toEqual(markdown);
      expect(
        variablesCompiledInto(
          bodies[StatusPageSubscriberNotificationMethod.MicrosoftTeams]!,
        ),
      ).toEqual(markdown);
    },
  );

  test.each(TRIGGERS)(
    "$name: converts the note once per note, however many pages and subscribers",
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
      // The incident's monitor is listed on both pages.
      mock(StatusPageResourceService.findByMonitors).mockResolvedValue([
        resource(),
        resource({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          statusPageId: SECOND_STATUS_PAGE_ID,
        }),
      ] as never);
      mock(
        StatusPageSubscriberService.getSubscribersByStatusPage,
      ).mockResolvedValue([subscriber(), subscriber()] as never);

      await runJob(trigger.job);

      // Two pages, two subscribers each, five templates per subscriber.
      expect(compileCalls()).toHaveLength(20);
      expect(Markdown.convertToHTML).toHaveBeenCalledTimes(1);
      expect(Markdown.convertToHTML).toHaveBeenCalledWith(
        NOTE,
        MarkdownContentType.Email,
      );
      expect(Markdown.convertToPlainText).toHaveBeenCalledTimes(1);
      expect(Markdown.convertToPlainText).toHaveBeenCalledWith(NOTE);
    },
  );

  test.each(TRIGGERS)(
    "$name: sends webhooks the Markdown note and a plain-text resource list",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);
      useCustomTemplatesOnEveryChannel(trigger.eventType);

      await runJob(trigger.job);

      expect(sentWebhooks()).toHaveLength(1);
      const data: JSONObject = sentWebhooks()[0]!["data"] as JSONObject;

      expect(data["note"]).toBe(NOTE);
      expect(data["resourcesAffected"]).toBe(GROUPED_RESOURCES_TEXT);
    },
  );
});

describe("IncidentPublicNote default email, with grouped resources", () => {
  test.each(TRIGGERS)(
    "$name: still gets HTML for the note and the resource list",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);
      mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
        groupedResources() as never,
      );

      await runJob(trigger.job);

      expect(sentMail()).toHaveLength(1);
      expect(sentMail()[0]!["templateType"]).toBe(
        trigger.job === UPDATED_JOB
          ? EmailTemplateType.SubscriberIncidentNoteUpdated
          : EmailTemplateType.SubscriberIncidentNoteCreated,
      );
      expect(sentMail()[0]!["vars"]).toEqual(
        expect.objectContaining({
          note: NOTE_HTML,
          resourcesAffected: GROUPED_RESOURCES_HTML,
        }),
      );
    },
  );
});

describe("IncidentPublicNote custom email subject fallback", () => {
  test.each([
    { name: "created job", job: CREATED_JOB, prefix: "[Incident Update] " },
    {
      name: "updated job",
      job: UPDATED_JOB,
      prefix: "[Incident Note Updated] ",
    },
  ])(
    "$name: an untitled incident gets the bare prefix, not 'undefined'",
    async (row: { name: string; job: string; prefix: string }) => {
      queueNote(row.job);
      storedIncident = incident({ withoutTitle: true });

      mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mockResolvedValue([
        statusPage({ withCustomSmtpAndSms: true }),
      ] as never);
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
      expect(sentMail()[0]!["subject"]).toBe(row.prefix);
    },
  );
});

describe("IncidentPublicNote custom templates receive every advertised variable", () => {
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

describe("IncidentPublicNote custom template variable values", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test.each(TRIGGERS)(
    "$name: incidentState is the incident's current state name",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);
      useCustomTemplatesOnEveryChannel(trigger.eventType);

      await runJob(trigger.job);

      const select: JSONObject = (
        mock(IncidentService.findOneById).mock.calls[0]![0] as {
          select: JSONObject;
        }
      ).select;
      expect(select["currentIncidentState"]).toEqual({ name: true });

      const calls: Array<CompileCall> = compileCalls();
      expect(calls).toHaveLength(5);
      for (const call of calls) {
        expect(call.variables["incidentState"]).toBe(INCIDENT_STATE_NAME);
      }
    },
  );

  test.each(TRIGGERS)(
    "$name: incidentState renders empty when the incident has no current state",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);
      storedIncident = incident({ withoutCurrentState: true });
      useCustomTemplatesOnEveryChannel(trigger.eventType);

      await runJob(trigger.job);

      const calls: Array<CompileCall> = compileCalls();
      expect(calls).toHaveLength(5);
      for (const call of calls) {
        expect(call.variables["incidentState"]).toBe("");
      }
      expect(sentSms()[0]).toContain("incidentState=[]");
    },
  );

  test.each(TRIGGERS)(
    "$name: postedAt is the note's own postedAt, formatted for people",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);
      useCustomTemplatesOnEveryChannel(trigger.eventType);

      await runJob(trigger.job);

      const expected: string =
        OneUptimeDate.getDateAsUserFriendlyFormattedString(POSTED_AT);

      // Server side the formatter uses a 12-hour clock and a zone name.
      expect(expected).toMatch(/^Mar 0[45] 2026, \d{2}:\d{2} (AM|PM) \S+/);
      expect(expected).not.toBe(
        OneUptimeDate.getDateAsUserFriendlyFormattedString(new Date()),
      );

      const calls: Array<CompileCall> = compileCalls();
      expect(calls).toHaveLength(5);
      for (const call of calls) {
        expect(call.variables["postedAt"]).toBe(expected);
      }
    },
  );

  test.each(TRIGGERS)(
    "$name: postedAt follows an edited postedAt on the note",
    async (trigger: TriggerCase) => {
      const editedPostedAt: Date = new Date("2026-05-20T08:30:00.000Z");
      queueNote(trigger.job, { postedAt: editedPostedAt });
      useCustomTemplatesOnEveryChannel(trigger.eventType);

      await runJob(trigger.job);

      const expected: string =
        OneUptimeDate.getDateAsUserFriendlyFormattedString(editedPostedAt);
      expect(expected).not.toBe(
        OneUptimeDate.getDateAsUserFriendlyFormattedString(POSTED_AT),
      );

      const calls: Array<CompileCall> = compileCalls();
      expect(calls).toHaveLength(5);
      for (const call of calls) {
        expect(call.variables["postedAt"]).toBe(expected);
      }
    },
  );

  test.each(TRIGGERS)(
    "$name: postedAt falls back to the time of sending for a legacy note without one",
    async (trigger: TriggerCase) => {
      const sendingAt: Date = new Date("2026-09-16T15:45:00.000Z");
      jest.useFakeTimers({
        now: sendingAt,
        doNotFake: [
          "setTimeout",
          "setImmediate",
          "nextTick",
          "queueMicrotask",
          "performance",
          "hrtime",
        ],
      });

      queueNote(trigger.job, { postedAt: null });
      useCustomTemplatesOnEveryChannel(trigger.eventType);

      await runJob(trigger.job);

      const expected: string =
        OneUptimeDate.getDateAsUserFriendlyFormattedString(sendingAt);

      const calls: Array<CompileCall> = compileCalls();
      expect(calls).toHaveLength(5);
      for (const call of calls) {
        expect(call.variables["postedAt"]).toBe(expected);
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
          displayName: "Search API",
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
        "Acme Status": ["Checkout API"],
        "Beta Status": ["Search API"],
      });
    },
  );

  test.each(TRIGGERS)(
    "$name: a template using every advertised variable renders completely on every channel",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);
      useCustomTemplatesOnEveryChannel(trigger.eventType);

      await runJob(trigger.job);

      const postedAt: string =
        OneUptimeDate.getDateAsUserFriendlyFormattedString(POSTED_AT);

      // What the fixtures hold for each advertised variable.
      const expectedValues: Record<string, string> = {
        statusPageName: "Acme Status",
        statusPageUrl: STATUS_PAGE_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
        resourcesAffected: "Checkout API",
        incidentTitle: INCIDENT_TITLE,
        incidentSeverity: "Critical",
        incidentState: INCIDENT_STATE_NAME,
        postedAt: postedAt,
        note: NOTE,
        detailsUrl: DETAILS_URL,
        incidentLabels: INCIDENT_LABELS,
        affectedStatusPages: "Acme Status",
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

      for (const [channel, message] of Object.entries(rendered)) {
        expect(message).toContain(`channel=${channel}`);
        expect(message).not.toMatch(/{{|}}/);

        for (const name of names) {
          /*
           * The email body gets the note as HTML and SMS as plain text;
           * Slack and Teams get it as written.
           */
          let value: string = expectedValues[name]!;
          if (name === "note" && channel === "email") {
            value = NOTE_HTML;
          } else if (name === "note" && channel === "sms") {
            value = NOTE_TEXT;
          } else if (name === "unsubscribeUrl" && channel === "sms") {
            // An SMS from this public page carries the manage link.
            value = SMS_UNSUBSCRIBE_URL;
          }

          expect(value).not.toBe("");
          expect(message).toContain(`${name}=[${value}]`);
        }
      }

      // The subject is plain text too.
      expect(sentMail()[0]!["subject"]).toBe(
        `Subject: ${INCIDENT_TITLE} (${INCIDENT_STATE_NAME}, ${postedAt}) ${NOTE_TEXT} [Checkout API]`,
      );
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

describe("IncidentPublicNote email subjects are sent as written", () => {
  describe.each(TRIGGERS)("$name", (trigger: TriggerCase) => {
    test.each(TEMPLATE_SYNTAX_DESCRIPTIONS)(
      "a note with $name reaches the custom subject as written",
      async ({ markdown, text }: TemplateSyntaxDescription) => {
        queueNote(trigger.job);
        const queued: Array<IncidentPublicNote> =
          trigger.job === UPDATED_JOB ? updatedNotes : createdNotes;
        queued[0]!.note = markdown;
        mock(Markdown.convertToPlainText).mockImplementation(
          (value: unknown): string => {
            return value === markdown ? text : "";
          },
        );
        useCustomTemplatesOnEveryChannel(trigger.eventType);

        await runJob(trigger.job);

        const postedAt: string =
          OneUptimeDate.getDateAsUserFriendlyFormattedString(POSTED_AT);
        expect(sentMail()).toHaveLength(1);
        expect(sentMail()[0]!["subject"]).toBe(
          `Subject: ${INCIDENT_TITLE} (${INCIDENT_STATE_NAME}, ${postedAt}) ${text} [Checkout API]`,
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
      const titled: Incident = incident();
      titled.title = "Rollout of {{ .Values.image.tag }} stalled";
      storedIncident = titled;

      await runJob(row.job);

      expect(sentMail()).toHaveLength(1);
      expect(sentMail()[0]!["subject"]).toBe(
        `${row.prefix}Rollout of {{ .Values.image.tag }} stalled`,
      );
      expect(sentMail()[0]!["isSubjectLiteral"]).toBe(true);
    },
  );
});

/*
 * An incident limited to some status pages (Incident.statusPages). Ten site
 * pages all list the incident's monitor; the scope decides which of them hear
 * about a public note, whether it was posted or updated.
 */
describe("IncidentPublicNote subscriber notifications, with a status page scope", () => {
  let pages: Array<StatusPage> = [];
  let subscribers: Array<StatusPageSubscriber> = [];

  const DEFAULT_SUBJECT_PREFIX: Record<string, string> = {
    [CREATED_JOB]: "[Update Incident] ",
    [UPDATED_JOB]: "[Incident Note Updated] ",
  };

  function emailsSentTo(): Array<string> {
    return sentMail().map((mail: JSONObject): string => {
      return (mail["toEmail"] as Email).toString();
    });
  }

  beforeEach(() => {
    pages = allSites().map((site: number): StatusPage => {
      return sitePage(site);
    });
    subscribers = allSites().map((site: number): StatusPageSubscriber => {
      return siteSubscriber({ site: site, email: `site${site}@acme.com` });
    });

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

  test.each(TRIGGERS)(
    "$name: a monitor shared by ten pages, scoped to two, tells only those two",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);

      await runJob(trigger.job);

      expect(emailsSentTo()).toEqual(["site3@acme.com", "site7@acme.com"]);
      expect(
        mock(
          StatusPageSubscriberService.getSubscribersByStatusPage,
        ).mock.calls.map((call: Array<unknown>): number => {
          return siteOf(call[0]);
        }),
      ).toEqual([3, 7]);
    },
  );

  test.each(TRIGGERS)(
    "$name: an unscoped incident reaches none of ten pages that only show scoped incidents",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);
      storedScopes = {};
      pages = allSites().map((site: number): StatusPage => {
        return sitePage(site, { onlyShowScopedIncidents: true });
      });

      await runJob(trigger.job);

      nothingSent();
      expect(feedItems()).toHaveLength(1);
      expect(feedItems()[0]!["displayColor"]).toEqual(Yellow500);
      expect(feedItems()[0]!["moreInformationInMarkdown"]).toContain(
        "**Not sent to 10 status pages that only show incidents limited to them:**",
      );
    },
  );

  test.each(TRIGGERS)(
    "$name: someone on both selected pages gets one email and one SMS, but each page's webhook, Slack and Teams message",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);
      subscribers = [3, 7].map((site: number): StatusPageSubscriber => {
        return siteSubscriber({
          site: site,
          email: "shared@acme.com",
          phone: "+15555550100",
          webhook: "https://hooks.acme.com/status",
          slack: "https://hooks.slack.com/services/T000/B000/XXXX",
          teams: "https://outlook.office.com/webhook/abc",
        });
      });

      await runJob(trigger.job);

      expect(emailsSentTo()).toEqual(["shared@acme.com"]);
      expect(sentSms()).toHaveLength(1);
      expect(
        sentWebhooks().map((payload: JSONObject): number => {
          return siteOf(payload["statusPageId"]);
        }),
      ).toEqual([3, 7]);
      expect(sentSlack()).toHaveLength(2);
      expect(sentTeams()).toHaveLength(2);
    },
  );

  test.each(TRIGGERS)(
    "$name: an unscoped incident sends every subscription its email, as before",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);
      storedScopes = {};
      subscribers = [3, 7].map((site: number): StatusPageSubscriber => {
        return siteSubscriber({ site: site, email: "shared@acme.com" });
      });

      await runJob(trigger.job);

      expect(emailsSentTo()).toEqual(["shared@acme.com", "shared@acme.com"]);
    },
  );

  test.each(TRIGGERS)(
    "$name: the feed item keeps the note, then lists each page, the subject used and what was sent",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);
      subscribers = [
        siteSubscriber({ site: 3, index: 1, email: "a@acme.com" }),
        siteSubscriber({ site: 7, index: 1, email: "b@acme.com" }),
        siteSubscriber({
          site: 7,
          index: 2,
          webhook: "https://hooks.acme.com/site7",
        }),
      ];

      await runJob(trigger.job);

      const subject: string =
        `${DEFAULT_SUBJECT_PREFIX[trigger.job]}${INCIDENT_TITLE}`
          .replace("[", "\\[")
          .replace("]", "\\]");

      expect(feedItems()).toHaveLength(1);
      expect(feedItems()[0]!["displayColor"]).toEqual(Blue500);
      expect(feedItems()[0]!["moreInformationInMarkdown"]).toBe(
        [
          "**Public Note:**",
          "",
          NOTE,
          "",
          "**Status pages:**",
          "",
          `- **Site 03**: 1 email sent. Subject: "${subject}".`,
          `- **Site 07**: 1 email, 1 webhook sent. Subject: "${subject}".`,
          "",
          "Email and SMS were sent once per address across these status pages, because this is limited to specific status pages. Someone subscribed on more than one of them got the message of the first page in this list.",
          "",
          "**Not sent to 8 status pages outside the status pages this is limited to:** Site 01, Site 02, Site 04, Site 05, Site 06, Site 08, Site 09, Site 10.",
        ].join("\n"),
      );
    },
  );
});

/*
 * Escaping, for the created and the updated note alike. The incident title,
 * its state and severity, the status page's name and the names of its
 * resources and groups are plain text a project member typed. In an email
 * they must read as those characters; the note is Markdown rendered to HTML
 * and stays HTML. Text channels (a subject, SMS, Slack, Teams, webhooks)
 * show text as written, so they must get no HTML entities at all.
 */
describe("IncidentPublicNote escapes plain values in email", () => {
  const HOSTILE_STATE: string = "Monitoring <closely> & 'calmly'";
  const HOSTILE_STATE_HTML: string =
    "Monitoring &lt;closely&gt; &amp; &#39;calmly&#39;";
  const HOSTILE_SEVERITY: string = "Sev <1>";

  const ESCAPING_EMAIL_BODY: string =
    '<h1>{{incidentTitle}}</h1><p>{{statusPageName}} / {{incidentState}} / {{incidentSeverity}}</p><div>{{resourcesAffected}}</div><div>{{note}}</div><a href="{{detailsUrl}}">Details</a>';
  const ESCAPING_TEXT: string =
    "{{incidentTitle}} on {{statusPageName}} ({{incidentState}}): {{resourcesAffected}}";

  beforeEach(() => {
    const row: Incident = incident();
    row.title = HOSTILE_TITLE;
    row.currentIncidentState!.name = HOSTILE_STATE;
    row.incidentSeverity!.name = HOSTILE_SEVERITY;
    storedIncident = row;
    mock(StatusPageResourceService.findByMonitors).mockResolvedValue(
      hostileResources(STATUS_PAGE_ID) as never,
    );
  });

  function useEscapingTemplates(): void {
    mock(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).mockResolvedValue([
      statusPage({ withCustomSmtpAndSms: true, pageTitle: HOSTILE_PAGE_NAME }),
    ] as never);
    mock(
      StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
    ).mockImplementation(async (args: unknown) => {
      const method: string = (args as JSONObject)[
        "notificationMethod"
      ] as string;
      return method === StatusPageSubscriberNotificationMethod.Email
        ? { templateBody: ESCAPING_EMAIL_BODY, emailSubject: ESCAPING_TEXT }
        : { templateBody: `${method}: ${ESCAPING_TEXT}` };
    });
  }

  test.each(TRIGGERS)(
    "$name: a custom email body escapes the plain values and keeps the note and the resource list as HTML",
    async ({ job, eventType }: TriggerCase) => {
      useEscapingTemplates();
      queueNote(job);

      await runJob(job);

      expect(sentMail()).toHaveLength(1);
      expect((sentMail()[0]!["vars"] as JSONObject)["body"]).toBe(
        `<h1>${HOSTILE_TITLE_HTML}</h1><p>${HOSTILE_PAGE_NAME_HTML} / ${HOSTILE_STATE_HTML} / Sev &lt;1&gt;</p><div>${HOSTILE_RESOURCES_HTML}</div><div>${NOTE_HTML}</div><a href="${DETAILS_URL}">Details</a>`,
      );

      const emailBody: Array<RecordedCompile> = recordedCompiles(
        StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate,
        StatusPageSubscriberNotificationTemplateServiceClass.compileEmailBodyTemplate,
      ).filter((call: RecordedCompile): boolean => {
        return call.emailBody;
      });
      expect(emailBody).toHaveLength(1);
      expectOnlyTheListedHtmlVariables(emailBody[0]!.rawVariables, eventType);
    },
  );

  test.each(TRIGGERS)(
    "$name: the subject, SMS, Slack, Teams and webhooks get every value as written",
    async ({ job }: TriggerCase) => {
      useEscapingTemplates();
      queueNote(job);

      await runJob(job);

      const text: string = `${HOSTILE_TITLE} on ${HOSTILE_PAGE_NAME} (${HOSTILE_STATE}): ${HOSTILE_RESOURCES_TEXT}`;

      expect(sentMail()[0]!["subject"]).toBe(text);
      expect(sentSms()).toEqual([
        `${StatusPageSubscriberNotificationMethod.SMS}: ${text}`,
      ]);
      expect(sentSlack()).toEqual([
        `${StatusPageSubscriberNotificationMethod.Slack}: ${text}`,
      ]);
      expect(sentTeams()).toEqual([
        `${StatusPageSubscriberNotificationMethod.MicrosoftTeams}: ${text}`,
      ]);
      for (const message of [
        sentMail()[0]!["subject"] as string,
        ...sentSms(),
        ...sentSlack(),
        ...sentTeams(),
      ]) {
        expectNoHtmlEntities(message);
      }

      expect(sentWebhooks()[0]!["statusPageName"]).toBe(HOSTILE_PAGE_NAME);
      expect(sentWebhooks()[0]!["data"]).toEqual(
        expect.objectContaining({
          incidentTitle: HOSTILE_TITLE,
          resourcesAffected: HOSTILE_RESOURCES_TEXT,
        }),
      );
    },
  );

  test.each(TRIGGERS)(
    "$name: the default email gets the resource list escaped, and the chat defaults get it as written",
    async ({ job }: TriggerCase) => {
      mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mockResolvedValue([
        statusPage({ pageTitle: HOSTILE_PAGE_NAME }),
      ] as never);
      queueNote(job);

      await runJob(job);

      expect(sentMail()[0]!["vars"]).toEqual(
        expect.objectContaining({
          resourcesAffected: HOSTILE_RESOURCES_HTML,
          note: NOTE_HTML,
          incidentTitle: HOSTILE_TITLE,
          statusPageName: HOSTILE_PAGE_NAME,
        }),
      );
      // The note email shows no description; it carries none, raw or not.
      expect(sentMail()[0]!["vars"]).not.toHaveProperty("incidentDescription");

      expect(sentSlack()[0]).toContain(
        `**Resources Affected:** ${HOSTILE_RESOURCES_TEXT}`,
      );
      expect(sentTeams()[0]).toContain(
        `**Resources Affected:** ${HOSTILE_RESOURCES_TEXT}`,
      );
      for (const message of [...sentSms(), ...sentSlack(), ...sentTeams()]) {
        expectNoHtmlEntities(message);
        expect(message).not.toContain("<br/>");
      }
    },
  );
});

describe("IncidentPublicNote unsubscribe links", () => {
  test("every message links to the subscriber's own unsubscribe page, token included", async () => {
    queueNote(UPDATED_JOB);

    await runJob(UPDATED_JOB);

    /*
     * The job hands getUnsubscribeLink the subscriber row it read - with its
     * unsubscribe token - so the link works on private status pages without
     * signing in. An id alone, or the old manage page, would not.
     */
    expectEveryUnsubscribeLinkToCarryAToken(
      StatusPageSubscriberService.getUnsubscribeLink,
    );
  });
});

/*
 * Incident custom fields in the public note notifications, posted and
 * updated alike. The project has four fields; three are marked "Include in
 * Subscriber Notifications" (see IncidentCustomFieldFixtures). Those reach
 * the default email, Slack, Teams and webhook messages, in their order; the
 * default SMS stays as it was. Every field is offered to custom templates as
 * {{customFields.<key>}}, and the feed item records the values sent.
 */
describe("IncidentPublicNote with incident custom fields", () => {
  const CHAT_SENTENCES: Record<string, string> = {
    [CREATED_JOB]: "New note has been added to an incident",
    [UPDATED_JOB]: "A note on this incident has been updated",
  };

  const SMS_SENTENCES: Record<string, string> = {
    [CREATED_JOB]: "A new note is posted.",
    [UPDATED_JOB]: "A note has been updated.",
  };

  beforeEach(() => {
    mock(IncidentCustomFieldService.findBy).mockResolvedValue(
      CUSTOM_FIELD_DEFINITIONS as never,
    );

    const row: Incident = incident();
    row.customFields = CUSTOM_FIELD_VALUES;
    storedIncident = row;

    mock(Markdown.convertToHTML).mockImplementation((async (
      markdown: unknown,
    ): Promise<string> => {
      return renderImpactDetails(() => {
        return NOTE_HTML;
      })(markdown);
    }) as never);
    mock(Markdown.convertToPlainText).mockImplementation(
      plainTextOfImpactDetails(() => {
        return NOTE_TEXT;
      }) as never,
    );
  });

  test.each(TRIGGERS)(
    "$name: reads the incident's labels and custom fields",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);

      await runJob(trigger.job);

      expect(
        (mock(IncidentService.findOneById).mock.calls[0]![0] as JSONObject)[
          "select"
        ],
      ).toEqual(
        expect.objectContaining({
          labels: { name: true },
          customFields: true,
        }),
      );
      expect(
        (
          mock(IncidentCustomFieldService.findBy).mock
            .calls[0]![0] as JSONObject
        )["query"],
      ).toEqual({ projectId: PROJECT_ID });
    },
  );

  test.each(TRIGGERS)(
    "$name: the default email lists the included fields, in their order",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);

      await runJob(trigger.job);

      expect((sentMail()[0]!["vars"] as JSONObject)["customFieldRows"]).toEqual(
        EXPECTED_CUSTOM_FIELD_ROWS,
      );
      expect((sentMail()[0]!["vars"] as JSONObject)["note"]).toBe(NOTE_HTML);
    },
  );

  test.each(TRIGGERS)(
    "$name: the default Slack and Teams messages list them above the note",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);

      await runJob(trigger.job);

      const expected: string = `## Incident - ${INCIDENT_TITLE}

**${CHAT_SENTENCES[trigger.job]}**

**Resources Affected:** Checkout API
**Severity:** Critical
**Affected Location:** ${AFFECTED_LOCATION}
**Acknowledgement:** No
**Impact Details:**
${IMPACT_DETAILS}

**Note:**
${NOTE}

[View Status Page](${STATUS_PAGE_URL}) | [Unsubscribe](${UNSUBSCRIBE_URL})`;

      expect(sentSlack()).toEqual([expected]);
      expect(sentTeams()).toEqual([expected]);
    },
  );

  test.each(TRIGGERS)(
    "$name: the default SMS stays short and carries no field",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);

      await runJob(trigger.job);

      expect(sentSms()).toEqual([
        `Incident update: ${INCIDENT_TITLE} on Acme Status. ${SMS_SENTENCES[trigger.job]} Details: ${DETAILS_URL}. Unsub: ${SMS_UNSUBSCRIBE_URL}`,
      ]);
    },
  );

  test.each(TRIGGERS)(
    "$name: webhooks get the included fields by key",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);

      await runJob(trigger.job);

      expect(
        (sentWebhooks()[0]!["data"] as JSONObject)["customFields"],
      ).toEqual(EXPECTED_WEBHOOK_CUSTOM_FIELDS);
    },
  );

  test.each(TRIGGERS)(
    "$name: the feed item records the note, each page, then the values sent",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);

      await runJob(trigger.job);

      const moreInformation: string = feedItems()[0]![
        "moreInformationInMarkdown"
      ] as string;

      expect(moreInformation.startsWith(`**Public Note:**\n\n${NOTE}`)).toBe(
        true,
      );
      expect(moreInformation).toContain("**Status pages:**");
      expect(
        moreInformation.endsWith(`\n\n${EXPECTED_INCLUDED_FIELDS_FEED}`),
      ).toBe(true);
    },
  );

  test.each(TRIGGERS)(
    "$name: custom templates place any field by its key, escaped only in the email body",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);
      mock(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).mockResolvedValue([
        statusPage({ withCustomSmtpAndSms: true }),
      ] as never);
      mock(
        StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
      ).mockImplementation(async (args: unknown) => {
        const method: string = (args as JSONObject)[
          "notificationMethod"
        ] as string;
        return {
          templateBody: `${method}\n${CUSTOM_FIELD_PLACEHOLDERS_TEMPLATE}`,
        };
      });

      await runJob(trigger.job);

      expect((sentMail()[0]!["vars"] as JSONObject)["body"]).toBe(
        [
          StatusPageSubscriberNotificationMethod.Email,
          `location=[${AFFECTED_LOCATION_HTML}]`,
          "ack=[No]",
          `impact=[${IMPACT_DETAILS_HTML}]`,
          `ticket=[${INTERNAL_TICKET}]`,
        ].join("\n"),
      );
      expect(sentSms()).toEqual([
        [
          StatusPageSubscriberNotificationMethod.SMS,
          `location=[${AFFECTED_LOCATION}]`,
          "ack=[No]",
          `impact=[${IMPACT_DETAILS_TEXT}]`,
          `ticket=[${INTERNAL_TICKET}]`,
        ].join("\n"),
      ]);
      expect(sentSlack()[0]).toContain(`impact=[${IMPACT_DETAILS}]`);

      const compiles: Array<RecordedCompile> = recordedCompiles(
        StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate,
        StatusPageSubscriberNotificationTemplateServiceClass.compileEmailBodyTemplate,
      );

      for (const call of compiles) {
        expectOnlyOfferedVariables(trigger.eventType, call.rawVariables);
      }

      expectOnlyTheListedHtmlVariables(
        compiles.find((call: RecordedCompile): boolean => {
          return call.emailBody;
        })!.rawVariables,
        trigger.eventType,
      );

      expect(feedItems()[0]!["moreInformationInMarkdown"]).toContain(
        "- **Internal Ticket:** OPS\\-4411",
      );
    },
  );

  test.each(TRIGGERS)(
    "$name: an included Rich text field's images are made public",
    async (trigger: TriggerCase) => {
      queueNote(trigger.job);

      await runJob(trigger.job);

      expect(
        mock(syncIsPublicForMarkdownImages).mock.calls.map(
          (call: Array<unknown>): unknown => {
            return call[0];
          },
        ),
      ).toEqual([IMPACT_DETAILS]);
    },
  );
});

/*
 * How the notification sends (SubscriberDeliveryContract): every message
 * awaited and counted, failures of every kind on every channel, every
 * subscriber past LIMIT_MAX, and the send window and the run's latest claim.
 */
// The same contract for the "posted" and the "updated" notification.
function describeNoteDelivery(trigger: "created" | "updated"): void {
  const job: string = trigger === "created" ? CREATED_JOB : UPDATED_JOB;

  describeSubscriberDelivery({
    title: job,
    jobName: job,
    runJob: (): Promise<void> => {
      return runJob(job);
    },
    cronOptions: (): JSONObject | undefined => {
      return mockCapturedOptions[job] as JSONObject | undefined;
    },
    pendRows: (count: number): Array<ObjectID> => {
      const rows: Array<IncidentPublicNote> = [];

      for (let index: number = 0; index < count; index++) {
        // An updated note whose original notification went out.
        const row: IncidentPublicNote = publicNote(
          index > 0 ? { id: ObjectID.generate() } : undefined,
        );
        row.version = PENDING_ROW_VERSION;
        rows.push(row);
      }

      if (trigger === "created") {
        createdNotes = rows;
      } else {
        updatedNotes = rows;
      }

      return rows.map((row: IncidentPublicNote): ObjectID => {
        return row.id!;
      });
    },
    statusColumn:
      trigger === "created"
        ? "subscriberNotificationStatusOnNoteCreated"
        : "subscriberNotificationStatusOnNoteUpdated",
    messageColumn:
      trigger === "created"
        ? "subscriberNotificationStatusMessage"
        : "subscriberNotificationStatusMessageOnNoteUpdated",
    claim: IncidentPublicNoteService.compareAndSetColumnsByIdWithoutHooks,
    update: IncidentPublicNoteService.updateOneById,
    feed: IncidentFeedService.createIncidentFeedItem,
    subscribers: StatusPageSubscriberService.getSubscribersByStatusPage,
    emailSubscriber: (id: string): StatusPageSubscriber => {
      const row: StatusPageSubscriber = new StatusPageSubscriber();
      row._id = id;
      row.subscriberEmail = new Email(
        `subscriber-${id.slice(-12)}@example.com`,
      );
      return withUnsubscribeToken(row);
    },
    senders: {
      email: MailService.sendMail,
      sms: SmsService.sendSms,
      slack: SlackUtil.sendMessageToChannelViaIncomingWebhook,
      teams: MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
      webhook: StatusPageSubscriberWebhookUtil.sendWebhookNotification,
    },
    sentMessage:
      trigger === "created"
        ? "Notifications sent successfully to all subscribers."
        : SubscriberUpdateNotification.sentMessage,
    retryScope: SubscriberNotificationRetryScope.EveryPage,
  });
}

describeNoteDelivery("created");
describeNoteDelivery("updated");
