import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import URL from "Common/Types/API/URL";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Color from "Common/Types/Color";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "Common/Types/Permission";
import Phone from "Common/Types/Phone";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import UserType from "Common/Types/UserType";

/*
 * AN INCIDENT STATE CHANGE WITH A PUBLIC NOTE REACHES EVERY SUBSCRIBER, ONCE,
 * AND SAYS WHAT THE INCIDENT IS NOW.
 *
 * "Resolve" with a public note and "Notify Status Page Subscribers" on posts
 * the note, which tells subscribers, and records the change as sent by the
 * note: the note is the one message (#4411). Two things were missing:
 *
 *  - The note is posted once the change is saved, as the person changing
 *    the state. Someone who may change an incident's state but not post
 *    public notes had the change saved, recorded as sent by a note that was
 *    then refused: nobody was told. The change is now refused whole, before
 *    anything is saved.
 *  - The note's messages did not say what the change was, so subscribers
 *    stopped learning the state. Every one of them names it now.
 *
 * This runs it end to end without a database, as the scheduled maintenance
 * harness next door does: the real incident state timeline hooks record the
 * change and post its note through the real public note hook; the rows go
 * into in-memory tables that answer the jobs' queries and claims; then the
 * real state change job and the real public note job run, as the worker
 * would every minute, and every message they send is read.
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

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and the real services below reach
 * it, so it is replaced with a factory.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: { hash: jest.fn(), verify: jest.fn() },
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
      findOneById: jest.fn(),
      findOneBy: jest.fn(),
      // IncidentStatusPageScope reads each incident's status page scope.
      findBy: jest.fn(),
      updateOneBy: jest.fn(),
      getIncidentLinkInDashboard: jest.fn(),
      getIncidentNumber: jest.fn(),
      refreshIncidentMetrics: jest.fn(),
      markMonitorsActiveForMonitoring: jest.fn(),
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
        compileEmailBodyTemplate: jest.fn(),
        compileTemplate: jest.fn(),
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

// The project's incident custom fields: none here.
jest.mock("Common/Server/Services/IncidentCustomFieldService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Utils/InlineImageAccessTokenSync", () => {
  return { __esModule: true, syncIsPublicForMarkdownImages: jest.fn() };
});

import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import IncidentAlertService from "Common/Server/Services/IncidentAlertService";
import IncidentCustomFieldService from "Common/Server/Services/IncidentCustomFieldService";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import IncidentMeasurementValueService from "Common/Server/Services/IncidentMeasurementValueService";
import IncidentPublicNoteService from "Common/Server/Services/IncidentPublicNoteService";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateService from "Common/Server/Services/IncidentStateService";
import IncidentStateTimelineService from "Common/Server/Services/IncidentStateTimelineService";
import MailService from "Common/Server/Services/MailService";
import SmsService from "Common/Server/Services/SmsService";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import UserService from "Common/Server/Services/UserService";
import AIIncidentPostmortemRunner from "Common/Server/Utils/AI/SRE/IncidentPostmortemRunner";
import InvestigationGrader from "Common/Server/Utils/AI/SRE/InvestigationGrader";
import ProjectReferenceCheck from "Common/Server/Utils/Database/ProjectReferenceCheck";
import ProjectScopedReferenceValidator from "Common/Server/Utils/Database/ProjectScopedReferenceValidator";
import { syncIsPublicForMarkdownImages } from "Common/Server/Utils/InlineImageAccessTokenSync";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
import { incidentScopeFindBy } from "../Fixtures/IncidentStatusPageScopeFixtures";
import {
  fakeGetUnsubscribeLink,
  smsManageLinkFor,
  withUnsubscribeToken,
} from "../Fixtures/UnsubscribeLinkFixtures";
import "../../../../FeatureSet/Workers/Jobs/IncidentStateTimeline/SendNotificationToSubscribers";
import "../../../../FeatureSet/Workers/Jobs/IncidentPublicNote/SendNotificationToSubscribers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const STATE_CHANGE_JOB: string =
  "IncidentStateTimeline:SendNotificationToSubscribers";
const PUBLIC_NOTE_JOB: string =
  "IncidentPublicNote:SendNotificationToSubscribers";

const PROJECT_ID: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-000000000002",
);
const RESOLVED_STATE_ID: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-000000000003",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-000000000004",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-000000000005",
);
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-000000000006",
);
const USER_ID: ObjectID = new ObjectID("6a000000-0000-4000-8000-000000000007");

const STATUS_PAGE_URL: string = "https://status.acme.com";
const DETAILS_URL: string = `${STATUS_PAGE_URL}/incidents/${INCIDENT_ID.toString()}`;
const SMS_UNSUBSCRIBE_URL: string = smsManageLinkFor(
  STATUS_PAGE_URL,
  SUBSCRIBER_ID,
);
const INCIDENT_TITLE: string = "Checkout requests failing";
const STARTS_AT: Date = new Date("2026-10-05T10:00:00.000Z");
const NOTE: string = "A bad deploy was rolled back. Checkout works again.";
const RESOLVED_COLOR: string = "#16a34a";

// The two tables the jobs read, as the database would hold them.
let timelines: Array<IncidentStateTimeline> = [];
let notes: Array<IncidentPublicNote> = [];

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
}

type Hook = (input: unknown, second?: unknown) => Promise<unknown>;

function hookOf(service: unknown, name: string): Hook {
  return (service as Record<string, Hook>)[name]!.bind(service);
}

interface OnBeforeCreateResult {
  createBy: {
    data: IncidentStateTimeline;
    props: DatabaseCommonInteractionProps;
    miscDataProps?: JSONObject;
  };
  carryForward: Record<string, unknown>;
}

// A row of either table.
type StoredRow = IncidentStateTimeline | IncidentPublicNote;

// Whether a row has every value a job's query asks for.
function matches(row: StoredRow, query: JSONObject): boolean {
  return Object.keys(query).every((key: string) => {
    return (row as unknown as JSONObject)[key] === query[key];
  });
}

function findRow<TRow extends StoredRow>(
  rows: Array<TRow>,
  id: ObjectID,
): TRow | undefined {
  return rows.find((row: TRow) => {
    return row._id?.toString() === id.toString();
  });
}

function applyUpdate(rows: Array<StoredRow>, input: unknown): number {
  const update: { id: ObjectID; data: JSONObject } = input as {
    id: ObjectID;
    data: JSONObject;
  };

  const row: StoredRow | undefined = findRow(rows, update.id);

  if (!row) {
    return 0;
  }

  Object.assign(row, update.data);
  return 1;
}

/*
 * A claim (SubscriberNotificationClaim): the columns are set only if the row
 * still holds every expected value, the version among them.
 */
function compareAndSet(rows: Array<StoredRow>, input: unknown): boolean {
  const claim: {
    id: ObjectID;
    data: JSONObject;
    expectedData: JSONObject;
  } = input as { id: ObjectID; data: JSONObject; expectedData: JSONObject };

  const row: StoredRow | undefined = findRow(rows, claim.id);

  if (!row) {
    return false;
  }

  const stored: JSONObject = row as unknown as JSONObject;

  for (const [key, value] of Object.entries(claim.expectedData)) {
    if (stored[key] !== value) {
      return false;
    }
  }

  Object.assign(row, claim.data);
  row.version = (row.version || 0) + 1;
  return true;
}

function resolvedState(): IncidentState {
  const state: IncidentState = new IncidentState();
  state._id = RESOLVED_STATE_ID.toString();
  state.name = "Resolved";
  state.color = new Color(RESOLVED_COLOR);
  state.isResolvedState = true;
  state.isAcknowledgedState = false;
  state.isCreatedState = false;
  return state;
}

function storedIncident(): Incident {
  const incident: Incident = new Incident();
  incident._id = INCIDENT_ID.toString();
  incident.title = INCIDENT_TITLE;
  incident.description = "Payments fail in Europe.";
  incident.projectId = PROJECT_ID;
  incident.isVisibleOnStatusPage = true;
  incident.incidentNumber = 7;
  incident.incidentNumberWithPrefix = "INC-7";
  incident.labels = [];

  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical";
  incident.incidentSeverity = severity;

  // The incident's state as the jobs read it: what the change moved it to.
  incident.currentIncidentState = resolvedState();

  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  incident.monitors = [monitor];

  return incident;
}

function statusPage(): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID.toString();
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  page.pageTitle = "Acme Status";
  page.isPublicStatusPage = true;
  page.showIncidentsOnStatusPage = true;
  page.onlyShowScopedIncidents = false;
  return page;
}

function resource(): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = ObjectID.generate().toString();
  row.statusPageId = STATUS_PAGE_ID;
  row.displayName = "Checkout API";
  return row;
}

// One subscriber on every channel.
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

// A member of the project with these permissions, asking in it.
function memberProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      Permission.CurrentUser,
      Permission.ProjectUser,
      ...permissions,
    ].map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
        scope: PermissionScope.All,
      };
    }),
  };

  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
}

/*
 * "Resolve", as the dashboard sends it: the real hook decides the change's
 * notification and builds its note; the change is then stored the way the
 * database stores it - an unset column takes its default (notify, Pending)
 * and is handed back, and the row is read back with its state, as the job's
 * select joins it - and the real success hook posts the note through the
 * real note hook.
 */
async function resolve(data: {
  notify: boolean | undefined;
  publicNote?: string;
  props?: DatabaseCommonInteractionProps;
}): Promise<void> {
  const timeline: IncidentStateTimeline = new IncidentStateTimeline();
  timeline.projectId = PROJECT_ID;
  timeline.incidentId = INCIDENT_ID;
  timeline.incidentStateId = RESOLVED_STATE_ID;
  timeline.startsAt = STARTS_AT;

  if (data.notify !== undefined) {
    timeline.shouldStatusPageSubscribersBeNotified = data.notify;
  }

  const result: OnBeforeCreateResult = (await hookOf(
    IncidentStateTimelineService,
    "onBeforeCreate",
  )({
    data: timeline,
    miscDataProps:
      data.publicNote === undefined ? {} : { publicNote: data.publicNote },
    props: data.props || { isRoot: true, tenantId: PROJECT_ID },
  })) as OnBeforeCreateResult;

  const saved: IncidentStateTimeline = result.createBy.data;
  saved._id = ObjectID.generate().toString();
  saved.version = 1;
  saved.shouldStatusPageSubscribersBeNotified ??= true;
  saved.subscriberNotificationStatus ??=
    StatusPageSubscriberNotificationStatus.Pending;
  saved.incidentState = resolvedState();

  timelines.push(saved);

  await hookOf(IncidentStateTimelineService, "onCreateSuccess")(
    { createBy: result.createBy, carryForward: result.carryForward },
    saved,
  );
}

// One run of each job, as the worker runs them every minute.
async function runTheJobs(): Promise<void> {
  await mockCapturedJobs[STATE_CHANGE_JOB]!();
  await mockCapturedJobs[PUBLIC_NOTE_JOB]!();
}

interface Sent {
  emails: Array<{ templateType: string; subject: string; state: unknown }>;
  sms: Array<string>;
  slack: Array<string>;
  teams: Array<string>;
  webhooks: Array<{ eventType: string; state: unknown }>;
}

function sent(): Sent {
  return {
    emails: mock(MailService.sendMail).mock.calls.map(
      (
        call: Array<unknown>,
      ): { templateType: string; subject: string; state: unknown } => {
        const envelope: JSONObject = call[0] as JSONObject;
        return {
          templateType: envelope["templateType"] as string,
          subject: envelope["subject"] as string,
          state: (envelope["vars"] as JSONObject)["incidentState"],
        };
      },
    ),
    sms: mock(SmsService.sendSms).mock.calls.map(
      (call: Array<unknown>): string => {
        return (call[0] as { message: string }).message;
      },
    ),
    slack: mock(
      SlackUtil.sendMessageToChannelViaIncomingWebhook,
    ).mock.calls.map((call: Array<unknown>): string => {
      return (call[0] as { text: string }).text;
    }),
    teams: mock(
      MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
    ).mock.calls.map((call: Array<unknown>): string => {
      return (call[0] as { text: string }).text;
    }),
    webhooks: mock(
      StatusPageSubscriberWebhookUtil.sendWebhookNotification,
    ).mock.calls.map(
      (call: Array<unknown>): { eventType: string; state: unknown } => {
        const payload: JSONObject = (call[0] as { payload: JSONObject })
          .payload;
        return {
          eventType: payload["eventType"] as string,
          state: (payload["data"] as JSONObject)["incidentState"],
        };
      },
    ),
  };
}

function nothingSent(): void {
  expect(sent()).toEqual({
    emails: [],
    sms: [],
    slack: [],
    teams: [],
    webhooks: [],
  });
}

let createNote: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  timelines = [];
  notes = [];

  // The hooks, without a database.
  jest
    .spyOn(ProjectReferenceCheck, "validateCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectScopedReferenceValidator, "validateReferencesBelongToProject")
    .mockResolvedValue(undefined as never);
  jest.spyOn(Semaphore, "lock").mockResolvedValue(null as never);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockResolvedValue("Ada Lovelace" as never);
  // The incident's first state change after Created: nothing after it.
  jest
    .spyOn(IncidentStateTimelineService, "findOneBy")
    .mockResolvedValue(null as never);
  jest
    .spyOn(IncidentStateService, "findOneBy")
    .mockResolvedValue(resolvedState() as never);
  jest
    .spyOn(IncidentAlertService, "cascadeIncidentStateToLinkedAlerts")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(
      IncidentStateTimelineService as unknown as Record<string, () => unknown>,
      "autoAssignIncidentCommander",
    )
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(
      IncidentStateTimelineService as unknown as Record<string, () => unknown>,
      "trackSlaStateChange",
    )
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(
      IncidentStateTimelineService as unknown as Record<string, () => unknown>,
      "isLastIncidentState",
    )
    .mockResolvedValue(false as never);
  jest
    .spyOn(IncidentMeasurementValueService, "recomputeForIncident")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AIIncidentPostmortemRunner, "draftPostmortemOnResolve")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(InvestigationGrader, "gradeInvestigationOnResolve")
    .mockResolvedValue(undefined as never);

  // A posted note goes through the real note hook into the notes table.
  createNote = jest
    .spyOn(IncidentPublicNoteService, "create")
    .mockImplementation((async (input: unknown) => {
      const result: { createBy: { data: IncidentPublicNote } } = (await hookOf(
        IncidentPublicNoteService,
        "onBeforeCreate",
      )(input)) as { createBy: { data: IncidentPublicNote } };

      const savedNote: IncidentPublicNote = result.createBy.data;
      savedNote._id = ObjectID.generate().toString();
      savedNote.version = 1;
      savedNote.shouldStatusPageSubscribersBeNotifiedOnNoteCreated ??= true;
      savedNote.subscriberNotificationStatusOnNoteCreated ??=
        StatusPageSubscriberNotificationStatus.Pending;

      notes.push(savedNote);
      return savedNote;
    }) as never);

  // The two tables, answering the jobs' queries, claims and status writes.
  jest.spyOn(IncidentStateTimelineService, "findBy").mockImplementation((async (
    input: unknown,
  ) => {
    return timelines.filter((row: IncidentStateTimeline) => {
      return matches(row, (input as { query: JSONObject }).query);
    });
  }) as never);
  jest
    .spyOn(IncidentStateTimelineService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation((async (input: unknown) => {
      return compareAndSet(timelines, input);
    }) as never);
  jest
    .spyOn(IncidentStateTimelineService, "updateOneById")
    .mockImplementation((async (input: unknown) => {
      return applyUpdate(timelines, input);
    }) as never);
  jest.spyOn(IncidentPublicNoteService, "findBy").mockImplementation((async (
    input: unknown,
  ) => {
    const select: JSONObject = (input as { select: JSONObject }).select;

    return notes
      .filter((row: IncidentPublicNote) => {
        return matches(row, (input as { query: JSONObject }).query);
      })
      .map((row: IncidentPublicNote): IncidentPublicNote => {
        // The relation, joined as the select asks for it.
        if (
          select["postedWithIncidentState"] &&
          row.postedWithIncidentStateId?.toString() ===
            RESOLVED_STATE_ID.toString()
        ) {
          row.postedWithIncidentState = resolvedState();
        }

        return row;
      });
  }) as never);
  jest
    .spyOn(IncidentPublicNoteService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation((async (input: unknown) => {
      return compareAndSet(notes, input);
    }) as never);
  jest
    .spyOn(IncidentPublicNoteService, "updateOneById")
    .mockImplementation((async (input: unknown) => {
      return applyUpdate(notes, input);
    }) as never);

  // Everything the hooks and the jobs read about the incident and its page.
  mock(IncidentService.findOneById).mockResolvedValue(
    storedIncident() as never,
  );
  mock(IncidentService.findOneBy).mockResolvedValue(storedIncident() as never);
  mock(IncidentService.findBy).mockImplementation(
    incidentScopeFindBy(() => {
      return {};
    }) as never,
  );
  mock(IncidentService.updateOneBy).mockResolvedValue(1 as never);
  mock(IncidentService.getIncidentLinkInDashboard).mockResolvedValue(
    URL.fromString("https://oneuptime.acme.com/dashboard/incident/7") as never,
  );
  mock(IncidentService.getIncidentNumber).mockResolvedValue({
    number: 7,
    numberWithPrefix: "INC-7",
  } as never);
  mock(IncidentService.refreshIncidentMetrics).mockResolvedValue(
    undefined as never,
  );
  mock(IncidentService.markMonitorsActiveForMonitoring).mockResolvedValue(
    undefined as never,
  );
  mock(IncidentFeedService.createIncidentFeedItem).mockResolvedValue(
    undefined as never,
  );
  mock(IncidentCustomFieldService.findBy).mockResolvedValue([] as never);
  mock(syncIsPublicForMarkdownImages).mockResolvedValue(undefined as never);
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

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an incident resolved with a public note, Notify on", () => {
  test("both jobs are registered", () => {
    expect(mockCapturedJobs[STATE_CHANGE_JOB]).toBeDefined();
    expect(mockCapturedJobs[PUBLIC_NOTE_JOB]).toBeDefined();
  });

  test("each subscriber gets the note once, on every channel, and every message says the incident is Resolved", async () => {
    await resolve({ notify: true, publicNote: NOTE });

    expect(timelines).toHaveLength(1);
    expect(notes).toHaveLength(1);

    await runTheJobs();

    expect(sent()).toEqual({
      emails: [
        {
          templateType: EmailTemplateType.SubscriberIncidentNoteCreated,
          subject: `[Resolved Incident] ${INCIDENT_TITLE}`,
          state: "Resolved",
        },
      ],
      sms: [
        `Incident ${INCIDENT_TITLE} on Acme Status is Resolved. A new note is posted. Details: ${DETAILS_URL}. Unsub: ${SMS_UNSUBSCRIBE_URL}`,
      ],
      slack: [expect.stringContaining("**Status:** Resolved")],
      teams: [expect.stringContaining("**Status:** Resolved")],
      webhooks: [{ eventType: "IncidentNoteCreated", state: "Resolved" }],
    });

    // The note's own words go out with it.
    expect(sent().slack[0]).toContain(NOTE);
    expect(
      JSON.stringify(mock(MailService.sendMail).mock.calls[0]![0]),
    ).toContain("A bad deploy was rolled back.");

    // The change is recorded as sent by the note; the note as sent.
    expect(timelines[0]!.subscriberNotificationStatus).toBe(
      StatusPageSubscriberNotificationStatus.Success,
    );
    expect(notes[0]!.subscriberNotificationStatusOnNoteCreated).toBe(
      StatusPageSubscriberNotificationStatus.Success,
    );
  });

  test("the note carries the state the incident moved to", async () => {
    await resolve({ notify: true, publicNote: NOTE });

    expect(notes[0]!.postedWithIncidentStateId?.toString()).toBe(
      RESOLVED_STATE_ID.toString(),
    );
    // Posted after the change, at its time, on the incident.
    expect(notes[0]!.incidentId?.toString()).toBe(INCIDENT_ID.toString());
    expect(notes[0]!.postedAt).toEqual(STARTS_AT);
  });

  test("the next runs send nothing more", async () => {
    await resolve({ notify: true, publicNote: NOTE });

    await runTheJobs();
    await runTheJobs();
    await runTheJobs();

    expect(sent().emails).toHaveLength(1);
    expect(sent().sms).toHaveLength(1);
    expect(sent().slack).toHaveLength(1);
    expect(sent().teams).toHaveLength(1);
    expect(sent().webhooks).toHaveLength(1);
  });
});

describe("an incident resolved by someone who may not post public notes", () => {
  // A custom role: Create Incident State Timeline, without Create Incident Public Note.
  const MAY_CHANGE_STATE_ONLY: Array<Permission> = [
    Permission.CreateIncidentStateTimeline,
  ];

  test("with a note, the change is refused whole: nothing is saved and nobody is told", async () => {
    let error: unknown = null;

    try {
      await resolve({
        notify: true,
        publicNote: NOTE,
        props: memberProps(MAY_CHANGE_STATE_ONLY),
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect((error as Error).message).toContain(
      "The state was not changed: it comes with a public note, which you may not post.",
    );

    expect(timelines).toEqual([]);
    expect(notes).toEqual([]);
    expect(createNote).not.toHaveBeenCalled();

    await runTheJobs();

    nothingSent();
  });

  test("without a note, the change goes ahead and subscribers get the state change message, once", async () => {
    await resolve({ notify: true, props: memberProps(MAY_CHANGE_STATE_ONLY) });

    expect(notes).toEqual([]);

    await runTheJobs();
    await runTheJobs();

    expect(sent().emails).toEqual([
      {
        templateType: EmailTemplateType.SubscriberIncidentStateChanged,
        subject: `[Resolved Incident] ${INCIDENT_TITLE}`,
        state: "Resolved",
      },
    ]);
    expect(sent().webhooks).toEqual([
      { eventType: "IncidentStateChanged", state: "Resolved" },
    ]);
  });

  test("an Incident Member resolves with the note, posted as them", async () => {
    await resolve({
      notify: true,
      publicNote: NOTE,
      props: memberProps([Permission.IncidentMember]),
    });

    expect(createNote).toHaveBeenCalledTimes(1);
    expect(
      (
        createNote.mock.calls[0]![0] as {
          props: DatabaseCommonInteractionProps;
        }
      ).props.userId?.toString(),
    ).toBe(USER_ID.toString());

    await runTheJobs();

    expect(sent().emails).toHaveLength(1);
    expect(sent().emails[0]!.subject).toBe(
      `[Resolved Incident] ${INCIDENT_TITLE}`,
    );
  });
});

describe("the other ways an incident state change is told", () => {
  test("without a note, each subscriber gets the state change message once, as before", async () => {
    await resolve({ notify: true });

    expect(notes).toHaveLength(0);

    await runTheJobs();
    await runTheJobs();

    expect(sent().emails).toEqual([
      {
        templateType: EmailTemplateType.SubscriberIncidentStateChanged,
        subject: `[Resolved Incident] ${INCIDENT_TITLE}`,
        state: "Resolved",
      },
    ]);
    expect(sent().sms).toHaveLength(1);
    expect(sent().webhooks).toEqual([
      { eventType: "IncidentStateChanged", state: "Resolved" },
    ]);
  });

  test("with Notify off, nobody is told: not about the change, not about its note", async () => {
    await resolve({ notify: false, publicNote: NOTE });

    expect(notes).toHaveLength(1);

    await runTheJobs();

    nothingSent();
    expect(timelines[0]!.subscriberNotificationStatus).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
    expect(notes[0]!.subscriberNotificationStatusOnNoteCreated).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
  });

  test("a change that does not say whether to notify tells subscribers once: the change, by its column default, with its note kept quiet", async () => {
    await resolve({ notify: undefined, publicNote: NOTE });

    await runTheJobs();

    expect(sent().emails).toEqual([
      {
        templateType: EmailTemplateType.SubscriberIncidentStateChanged,
        subject: `[Resolved Incident] ${INCIDENT_TITLE}`,
        state: "Resolved",
      },
    ]);
    expect(sent().webhooks).toHaveLength(1);
    expect(notes[0]!.subscriberNotificationStatusOnNoteCreated).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
  });

  test("a note posted on its own, later, keeps the note's own words: no state is claimed", async () => {
    await resolve({ notify: true });
    await runTheJobs();
    jest.clearAllMocks();

    // A note from the Public Notes page: no state change marked it.
    const later: IncidentPublicNote = new IncidentPublicNote();
    later.incidentId = INCIDENT_ID;
    later.projectId = PROJECT_ID;
    later.note = "We are watching the error rate.";
    later.shouldStatusPageSubscribersBeNotifiedOnNoteCreated = true;
    // A state it tries to claim is not kept.
    later.postedWithIncidentStateId = RESOLVED_STATE_ID;

    await IncidentPublicNoteService.create({
      data: later,
      props: { isRoot: true, tenantId: PROJECT_ID },
    });

    expect(notes).toHaveLength(1);
    expect(notes[0]!.postedWithIncidentStateId).toBeNull();

    await runTheJobs();

    expect(sent().emails).toEqual([
      {
        templateType: EmailTemplateType.SubscriberIncidentNoteCreated,
        subject: `[Update Incident] ${INCIDENT_TITLE}`,
        state: undefined,
      },
    ]);
    expect(sent().slack[0]).not.toContain("**Status:**");
    expect(sent().webhooks).toEqual([
      { eventType: "IncidentNoteCreated", state: undefined },
    ]);
  });
});
