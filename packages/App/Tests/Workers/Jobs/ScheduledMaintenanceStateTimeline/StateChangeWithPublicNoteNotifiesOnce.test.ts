import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import URL from "Common/Types/API/URL";
import Color from "Common/Types/Color";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission, { UserPermission } from "Common/Types/Permission";
import Phone from "Common/Types/Phone";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import UserType from "Common/Types/UserType";

/*
 * A SCHEDULED MAINTENANCE STATE CHANGE WITH A PUBLIC NOTE REACHES EACH
 * SUBSCRIBER ONCE.
 *
 * "Mark Scheduled Maintenance as Ongoing" with a public note and "Notify
 * Status Page Subscribers" on posts the note, which notifies subscribers, and
 * records the state change. Subscribers got both the state change message
 * and the note (found in #4384): the change was marked as sent by its note
 * and then queued anyway. They now get the note, once, on every channel.
 *
 * The note is posted once the change is saved, never before it: a change
 * that is refused, or that fails to save, tells nobody (#4442 found the
 * scheduled maintenance timeline posting its note first, so a change that
 * then failed still sent the note to every subscriber).
 *
 * This runs it end to end without a database: the real state timeline hooks
 * record the change - onBeforeCreate before the save, onCreateSuccess after
 * it - and post its note through the real public note hook; both rows go
 * into an in-memory table that answers the jobs' queries; then the real
 * state change job and the real public note job run, as the worker would
 * every minute, and every message they send is counted.
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

jest.mock("Common/Server/Services/ScheduledMaintenanceService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findOneBy: jest.fn(),
      getScheduledMaintenanceLinkInDashboard: jest.fn(),
      getScheduledMaintenanceNumber: jest.fn(),
      updateOneBy: jest.fn(),
      updateOneById: jest.fn(),
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

import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import MailService from "Common/Server/Services/MailService";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenanceMeasurementValueService from "Common/Server/Services/ScheduledMaintenanceMeasurementValueService";
import ScheduledMaintenancePublicNoteService from "Common/Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "Common/Server/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "Common/Server/Services/ScheduledMaintenanceStateTimelineService";
import SmsService from "Common/Server/Services/SmsService";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import ProjectReferenceCheck from "Common/Server/Utils/Database/ProjectReferenceCheck";
import ProjectScopedReferenceValidator from "Common/Server/Utils/Database/ProjectScopedReferenceValidator";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
import {
  fakeGetUnsubscribeLink,
  withUnsubscribeToken,
} from "../Fixtures/UnsubscribeLinkFixtures";
import "../../../../FeatureSet/Workers/Jobs/ScheduledMaintenanceStateTimeline/SendNotificationToSubscribers";
import "../../../../FeatureSet/Workers/Jobs/ScheduledMaintenancePublicNote/SendNotificationToSubscribers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const STATE_CHANGE_JOB: string =
  "ScheduledMaintenanceStateTimeline:SendNotificationToSubscribers";
const PUBLIC_NOTE_JOB: string =
  "ScheduledMaintenancePublicNote:SendNotificationToSubscribers";

const PROJECT_ID: ObjectID = new ObjectID(
  "3f000000-0000-4000-8000-000000000001",
);
const EVENT_ID: ObjectID = new ObjectID("3f000000-0000-4000-8000-000000000002");
const ONGOING_STATE_ID: ObjectID = new ObjectID(
  "3f000000-0000-4000-8000-000000000003",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "3f000000-0000-4000-8000-000000000004",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "3f000000-0000-4000-8000-000000000005",
);
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "3f000000-0000-4000-8000-000000000006",
);

const STATUS_PAGE_URL: string = "https://status.acme.com";
const STARTS_AT: Date = new Date("2026-10-05T08:00:00.000Z");
const NOTE: string = "The database upgrade has started. Expect read-only mode.";

// The two tables the jobs read, as the database would hold them.
let timelines: Array<ScheduledMaintenanceStateTimeline> = [];
let notes: Array<ScheduledMaintenancePublicNote> = [];
// How many state changes were saved when each note was posted.
let changesSavedWhenNotesWerePosted: Array<number> = [];

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
}

type Hook = (input: unknown) => Promise<unknown>;

function hookOf(service: unknown, name: string): Hook {
  return (service as Record<string, Hook>)[name]!.bind(service);
}

// A row of either table.
type StoredRow =
  | ScheduledMaintenanceStateTimeline
  | ScheduledMaintenancePublicNote;

// Whether a row has every value a job's query asks for.
function matches(row: StoredRow, query: JSONObject): boolean {
  return Object.keys(query).every((key: string) => {
    return (row as unknown as JSONObject)[key] === query[key];
  });
}

function applyUpdate(rows: Array<StoredRow>, input: unknown): number {
  const update: { id: ObjectID; data: JSONObject } = input as {
    id: ObjectID;
    data: JSONObject;
  };

  const row: StoredRow | undefined = rows.find((candidate: StoredRow) => {
    return candidate._id?.toString() === update.id.toString();
  });

  if (!row) {
    return 0;
  }

  Object.assign(row, update.data);
  return 1;
}

function ongoingState(): ScheduledMaintenanceState {
  const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  state._id = ONGOING_STATE_ID.toString();
  state.name = "Ongoing";
  state.color = new Color("#f59e0b");
  state.isScheduledState = false;
  state.isOngoingState = true;
  return state;
}

function scheduledEvent(): ScheduledMaintenance {
  const event: ScheduledMaintenance = new ScheduledMaintenance();
  event._id = EVENT_ID.toString();
  event.title = "Database upgrade";
  event.description = "We are upgrading the primary database.";
  event.projectId = PROJECT_ID;
  event.startsAt = STARTS_AT;
  event.isVisibleOnStatusPage = true;
  event.scheduledMaintenanceNumber = 7;
  event.currentScheduledMaintenanceState = ongoingState();

  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  event.monitors = [monitor];

  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID.toString();
  event.statusPages = [page];

  return event;
}

function statusPage(): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID.toString();
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  page.pageTitle = "Acme Status";
  page.isPublicStatusPage = true;
  page.showScheduledMaintenanceEventsOnStatusPage = true;
  return page;
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

function resource(): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = ObjectID.generate().toString();
  row.statusPageId = STATUS_PAGE_ID;
  row.displayName = "Primary database";
  return row;
}

// A member of the project who may change an event's state, and these too.
function memberProps(permissions: Array<Permission>): DatabaseCommonInteractionProps {
  return {
    userId: new ObjectID("3f000000-0000-4000-8000-0000000000aa"),
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        _type: "UserTenantAccessPermission",
        permissions: [
          Permission.CurrentUser,
          Permission.ProjectUser,
          Permission.ReadProjectScheduledMaintenance,
          Permission.CreateScheduledMaintenanceStateTimeline,
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
      },
    },
  };
}

/*
 * "Mark Scheduled Maintenance as Ongoing", as the dashboard sends it, through
 * the create's hooks: onBeforeCreate decides the change's notification and
 * carries its note forward; the change is saved the way the database stores
 * it - an unset column takes its default (notify, Pending), and the row is
 * read back with its state, as the job's select joins it - and then
 * onCreateSuccess posts its note through the real note hook. `saveFails`
 * stops it where the insert fails, after every check has passed.
 */
async function markOngoing(data: {
  notify: boolean | undefined;
  publicNote?: string;
  props?: DatabaseCommonInteractionProps;
  saveFails?: boolean;
}): Promise<void> {
  const timeline: ScheduledMaintenanceStateTimeline =
    new ScheduledMaintenanceStateTimeline();
  timeline.projectId = PROJECT_ID;
  timeline.scheduledMaintenanceId = EVENT_ID;
  timeline.scheduledMaintenanceStateId = ONGOING_STATE_ID;
  timeline.startsAt = STARTS_AT;

  if (data.notify !== undefined) {
    timeline.shouldStatusPageSubscribersBeNotified = data.notify;
  }

  const result: {
    createBy: {
      data: ScheduledMaintenanceStateTimeline;
      props: DatabaseCommonInteractionProps;
    };
    carryForward: JSONObject;
  } = (await hookOf(
    ScheduledMaintenanceStateTimelineService,
    "onBeforeCreate",
  )({
    data: timeline,
    miscDataProps:
      data.publicNote === undefined ? {} : { publicNote: data.publicNote },
    props: data.props || { isRoot: true, tenantId: PROJECT_ID },
  })) as {
    createBy: {
      data: ScheduledMaintenanceStateTimeline;
      props: DatabaseCommonInteractionProps;
    };
    carryForward: JSONObject;
  };

  if (data.saveFails) {
    // The insert fails: nothing is stored, and the success hook never runs.
    return;
  }

  const saved: ScheduledMaintenanceStateTimeline = result.createBy.data;
  saved._id = ObjectID.generate().toString();
  saved.shouldStatusPageSubscribersBeNotified ??= true;
  saved.subscriberNotificationStatus ??=
    StatusPageSubscriberNotificationStatus.Pending;
  saved.scheduledMaintenanceState = ongoingState();

  timelines.push(saved);

  await (
    ScheduledMaintenanceStateTimelineService as unknown as {
      onCreateSuccess: (
        onCreate: unknown,
        createdItem: ScheduledMaintenanceStateTimeline,
      ) => Promise<unknown>;
    }
  ).onCreateSuccess(
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
  emails: Array<EmailTemplateType>;
  sms: number;
  slack: number;
  teams: number;
  webhooks: Array<string>;
}

function sent(): Sent {
  return {
    emails: mock(MailService.sendMail).mock.calls.map(
      (call: Array<unknown>) => {
        return (call[0] as { templateType: EmailTemplateType }).templateType;
      },
    ),
    sms: mock(SmsService.sendSms).mock.calls.length,
    slack: mock(SlackUtil.sendMessageToChannelViaIncomingWebhook).mock.calls
      .length,
    teams: mock(MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook).mock
      .calls.length,
    webhooks: mock(
      StatusPageSubscriberWebhookUtil.sendWebhookNotification,
    ).mock.calls.map((call: Array<unknown>) => {
      return (call[0] as { payload: { eventType: string } }).payload.eventType;
    }),
  };
}

const NOTHING_SENT: Sent = {
  emails: [],
  sms: 0,
  slack: 0,
  teams: 0,
  webhooks: [],
};

const THE_NOTE_ONCE: Sent = {
  emails: [EmailTemplateType.SubscriberScheduledMaintenanceEventNoteCreated],
  sms: 1,
  slack: 1,
  teams: 1,
  webhooks: ["ScheduledMaintenanceNoteCreated"],
};

const THE_STATE_CHANGE_ONCE: Sent = {
  emails: [EmailTemplateType.SubscriberScheduledMaintenanceEventStateChanged],
  sms: 1,
  slack: 1,
  teams: 1,
  webhooks: ["ScheduledMaintenanceStateChanged"],
};

beforeEach(() => {
  jest.clearAllMocks();
  timelines = [];
  notes = [];
  changesSavedWhenNotesWerePosted = [];

  // The hooks, without a database.
  jest
    .spyOn(ProjectReferenceCheck, "validateCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectScopedReferenceValidator, "validateReferencesBelongToProject")
    .mockResolvedValue(undefined as never);
  jest.spyOn(Semaphore, "lock").mockResolvedValue(null as never);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
  // The event's first state change: nothing before or after it.
  jest
    .spyOn(ScheduledMaintenanceStateTimelineService, "findOneBy")
    .mockResolvedValue(null as never);

  // A posted note goes through the real note hook into the notes table.
  jest
    .spyOn(ScheduledMaintenancePublicNoteService, "create")
    .mockImplementation((async (input: unknown) => {
      const result: { createBy: { data: ScheduledMaintenancePublicNote } } =
        (await hookOf(
          ScheduledMaintenancePublicNoteService,
          "onBeforeCreate",
        )(input)) as { createBy: { data: ScheduledMaintenancePublicNote } };

      changesSavedWhenNotesWerePosted.push(timelines.length);

      const savedNote: ScheduledMaintenancePublicNote = result.createBy.data;
      savedNote._id = ObjectID.generate().toString();
      savedNote.shouldStatusPageSubscribersBeNotifiedOnNoteCreated ??= true;
      savedNote.subscriberNotificationStatusOnNoteCreated ??=
        StatusPageSubscriberNotificationStatus.Pending;

      notes.push(savedNote);
      return savedNote;
    }) as never);

  // The two tables, answering the jobs' queries and status writes.
  jest
    .spyOn(ScheduledMaintenanceStateTimelineService, "findAllBy")
    .mockImplementation((async (input: unknown) => {
      return timelines.filter((row: ScheduledMaintenanceStateTimeline) => {
        return matches(row, (input as { query: JSONObject }).query);
      });
    }) as never);
  jest
    .spyOn(ScheduledMaintenanceStateTimelineService, "updateOneById")
    .mockImplementation((async (input: unknown) => {
      applyUpdate(timelines, input);
    }) as never);
  jest
    .spyOn(ScheduledMaintenancePublicNoteService, "findAllBy")
    .mockImplementation((async (input: unknown) => {
      const select: JSONObject = (input as { select: JSONObject }).select;

      return notes
        .filter((row: ScheduledMaintenancePublicNote) => {
          return matches(row, (input as { query: JSONObject }).query);
        })
        .map(
          (
            row: ScheduledMaintenancePublicNote,
          ): ScheduledMaintenancePublicNote => {
            // The state it was posted with, joined as the select asks for it.
            if (
              select["postedWithScheduledMaintenanceState"] &&
              row.postedWithScheduledMaintenanceStateId?.toString() ===
                ONGOING_STATE_ID.toString()
            ) {
              row.postedWithScheduledMaintenanceState = ongoingState();
            }

            return row;
          },
        );
    }) as never);
  jest
    .spyOn(ScheduledMaintenancePublicNoteService, "updateOneById")
    .mockImplementation((async (input: unknown) => {
      applyUpdate(notes, input);
    }) as never);

  /*
   * What the change's success hook reads and writes besides its note: the
   * state it moved to (read by id, and again with a flag to tell its kind),
   * the event's current state and number, and the measurements it refreshes.
   * The event is read with nothing the move would hold or release.
   */
  jest
    .spyOn(ScheduledMaintenanceStateService, "findOneBy")
    .mockImplementation((async (input: unknown) => {
      const query: JSONObject = (input as { query: JSONObject }).query;

      if (
        String(query["_id"]) !== ONGOING_STATE_ID.toString() ||
        query["isResolvedState"] ||
        query["isEndedState"]
      ) {
        return null;
      }

      return ongoingState();
    }) as never);
  jest
    .spyOn(
      ScheduledMaintenanceStateTimelineService as never,
      "isLastScheduledMaintenanceState",
    )
    .mockResolvedValue(false as never);
  jest
    .spyOn(
      ScheduledMaintenanceMeasurementValueService,
      "recomputeForScheduledMaintenance",
    )
    .mockResolvedValue(undefined as never);
  mock(ScheduledMaintenanceService.findOneBy).mockResolvedValue(null as never);
  mock(ScheduledMaintenanceService.updateOneBy).mockResolvedValue(1 as never);
  mock(ScheduledMaintenanceService.getScheduledMaintenanceNumber).mockResolvedValue(
    { number: 7, numberWithPrefix: "SM-7" } as never,
  );

  // Everything the jobs read about the event and its status page.
  mock(ScheduledMaintenanceService.findOneById).mockResolvedValue(
    scheduledEvent() as never,
  );
  mock(
    ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard,
  ).mockResolvedValue(
    URL.fromString("https://oneuptime.acme.com/dashboard/maintenance") as never,
  );
  mock(
    ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem,
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

describe("a scheduled maintenance state change posted with a public note", () => {
  test("both jobs are registered", () => {
    expect(mockCapturedJobs[STATE_CHANGE_JOB]).toBeDefined();
    expect(mockCapturedJobs[PUBLIC_NOTE_JOB]).toBeDefined();
  });

  test("with Notify on, each subscriber gets the note once, on every channel, and not the state change", async () => {
    await markOngoing({ notify: true, publicNote: NOTE });

    expect(timelines).toHaveLength(1);
    expect(notes).toHaveLength(1);
    // The note was posted once the change was saved, not before it.
    expect(changesSavedWhenNotesWerePosted).toEqual([1]);

    await runTheJobs();

    expect(sent()).toEqual(THE_NOTE_ONCE);

    // The note's email carries what the person wrote.
    const vars: JSONObject = (
      mock(MailService.sendMail).mock.calls[0]![0] as { vars: JSONObject }
    ).vars;
    expect(JSON.stringify(vars)).toContain("The database upgrade has started.");

    // The change is recorded as sent by the note; the note as sent.
    expect(timelines[0]!.subscriberNotificationStatus).toBe(
      StatusPageSubscriberNotificationStatus.Success,
    );
    expect(notes[0]!.subscriberNotificationStatusOnNoteCreated).toBe(
      StatusPageSubscriberNotificationStatus.Success,
    );
  });

  test("the note's messages say the event is Ongoing, on every channel, as the state change's did", async () => {
    await markOngoing({ notify: true, publicNote: NOTE });

    // The note carries the state the event moved to.
    expect(notes[0]!.postedWithScheduledMaintenanceStateId?.toString()).toBe(
      ONGOING_STATE_ID.toString(),
    );

    await runTheJobs();

    const mail: { subject: string; vars: JSONObject } = mock(
      MailService.sendMail,
    ).mock.calls[0]![0] as { subject: string; vars: JSONObject };

    expect(mail.subject).toBe(
      "[Ongoing Scheduled Maintenance] Database upgrade",
    );
    expect(mail.vars["eventState"]).toBe("Ongoing");
    expect(mail.vars["eventStateColor"]).toBe("#f59e0b");

    expect(
      (mock(SmsService.sendSms).mock.calls[0]![0] as { message: string })
        .message,
    ).toMatch(/^Maintenance Database upgrade on Acme Status is Ongoing\. /);
    expect(
      (
        mock(SlackUtil.sendMessageToChannelViaIncomingWebhook).mock
          .calls[0]![0] as { text: string }
      ).text,
    ).toContain("**Status:** Ongoing");
    expect(
      (
        mock(MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook).mock
          .calls[0]![0] as { text: string }
      ).text,
    ).toContain("**Status:** Ongoing");
    expect(
      (
        mock(StatusPageSubscriberWebhookUtil.sendWebhookNotification).mock
          .calls[0]![0] as { payload: { data: JSONObject } }
      ).payload.data["scheduledMaintenanceState"],
    ).toBe("Ongoing");
  });

  test("the next runs send nothing more", async () => {
    await markOngoing({ notify: true, publicNote: NOTE });

    await runTheJobs();
    await runTheJobs();
    await runTheJobs();

    expect(sent()).toEqual(THE_NOTE_ONCE);
  });

  test("without a note, each subscriber gets the state change once", async () => {
    await markOngoing({ notify: true });

    expect(notes).toHaveLength(0);

    await runTheJobs();
    await runTheJobs();

    expect(sent()).toEqual(THE_STATE_CHANGE_ONCE);
    expect(timelines[0]!.subscriberNotificationStatus).toBe(
      StatusPageSubscriberNotificationStatus.Success,
    );
  });

  test("a note with no text in it is not posted, and each subscriber gets the state change once", async () => {
    await markOngoing({ notify: true, publicNote: " \n\t " });

    expect(notes).toHaveLength(0);

    await runTheJobs();

    expect(sent()).toEqual(THE_STATE_CHANGE_ONCE);
  });

  test("with Notify off, nobody is told: not about the change, not about its note", async () => {
    await markOngoing({ notify: false, publicNote: NOTE });

    expect(notes).toHaveLength(1);

    await runTheJobs();

    expect(sent()).toEqual(NOTHING_SENT);
    expect(timelines[0]!.subscriberNotificationStatus).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
    expect(notes[0]!.subscriberNotificationStatusOnNoteCreated).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
  });

  test("with Notify off and no note, nobody is told", async () => {
    await markOngoing({ notify: false });

    await runTheJobs();

    expect(sent()).toEqual(NOTHING_SENT);
  });

  test("a state change whose save fails tells nobody: no note is posted, and the jobs send nothing", async () => {
    await markOngoing({ notify: true, publicNote: NOTE, saveFails: true });

    expect(timelines).toHaveLength(0);
    expect(notes).toHaveLength(0);

    await runTheJobs();

    expect(sent()).toEqual(NOTHING_SENT);
  });

  test("a person who may not post the note: the change is refused, nothing is posted, and nobody is told", async () => {
    await expect(
      markOngoing({
        notify: true,
        publicNote: NOTE,
        props: memberProps([]),
      }),
    ).rejects.toThrow(NotAuthorizedException);

    expect(timelines).toHaveLength(0);
    expect(notes).toHaveLength(0);

    await runTheJobs();

    expect(sent()).toEqual(NOTHING_SENT);
  });

  test("a person who may post the note: each subscriber gets the note once, posted after the change", async () => {
    await markOngoing({
      notify: true,
      publicNote: NOTE,
      props: memberProps([Permission.CreateScheduledMaintenancePublicNote]),
    });

    expect(changesSavedWhenNotesWerePosted).toEqual([1]);

    await runTheJobs();

    expect(sent()).toEqual(THE_NOTE_ONCE);
  });

  test("a change that does not say whether to notify tells subscribers once: the change, by its column default, with its note kept quiet", async () => {
    await markOngoing({ notify: undefined, publicNote: NOTE });

    await runTheJobs();

    expect(sent()).toEqual(THE_STATE_CHANGE_ONCE);
    expect(notes[0]!.subscriberNotificationStatusOnNoteCreated).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
  });
});
