import Alert from "Common/Models/DatabaseModels/Alert";
import AlertInternalNote from "Common/Models/DatabaseModels/AlertInternalNote";
import AlertOwnerTeam from "Common/Models/DatabaseModels/AlertOwnerTeam";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentInternalNote from "Common/Models/DatabaseModels/IncidentInternalNote";
import IncidentOwnerTeam from "Common/Models/DatabaseModels/IncidentOwnerTeam";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import {
  OwnerNotificationDeliveryStatus,
  OwnerNotificationFeedStatus,
  OwnerNotificationKind,
} from "Common/Types/Notification/OwnerNotificationDelivery";
import ObjectID from "Common/Types/ObjectID";
import {
  InMemoryOwnerNotificationDeliveries,
  useInMemoryOwnerNotificationDeliveries,
  usersNamedBy,
} from "Common/Tests/Helpers/InMemoryOwnerNotificationDeliveries";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * EVERY OWNER NOTIFICATION JOB TELLS EACH OWNER ONCE, WHEREVER ITS WORKER
 * STOPS, AND WRITES THE FEED ITEM NAMING WHOM IT REACHED (issues #8199,
 * #8509, #8510).
 *
 * The ten jobs of incidents and alerts - Created, state changed, note
 * posted, owner added and still-open reminder - and the 23 of episodes,
 * monitors, scheduled maintenance events, status pages, SLOs and network
 * devices each take (mark) the record
 * they tell of before they tell its owners. A worker stopped hard in between
 * (an out-of-memory kill, a node lost) used to leave every owner not reached
 * yet untold for good. Now each writes whom it is about to tell before the
 * take, tells each owner through a claim only one run can win, and starts
 * every run with the owners a stopped run left (OwnerNotificationDeliveries).
 *
 * Here each real job runs, tick by tick, with the services it reads and
 * writes standing in for the database - the record is due until the job
 * takes it, as the job's own read would answer - and the delivery table held
 * in memory as Postgres answers its statements
 * (InMemoryOwnerNotificationDeliveries; OwnerNotificationDeliveryPostgres
 * and App's OwnerNotificationJobsPostgres run them on Postgres). A worker is
 * stopped where a test says, as a kill would stop it: the statement or the
 * send there never answers, so nothing after it in that run happens. The
 * worker is then started again - the next run, minutes later - on the same
 * rows. Every case runs for every job:
 *
 *   - before an owner's send, during it, after it and before it was
 *     recorded, after it was recorded, after the last owner;
 *   - before the take, while the owners are written down;
 *   - two workers at once, and a worker that lost its lock going on beside
 *     the next run;
 *   - a worker stopped every time it sets out, a send that fails, a record
 *     gone before the next run.
 */

type CronHandler = () => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../FeatureSet/Workers/Utils/Cron", () => {
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
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

// A pre-existing TS5.9 diagnostic in PasswordHash fails any suite that loads it.
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      findBy: jest.fn(),
      findOneById: jest.fn(),
      findCreatedNotificationsDue: jest.fn(),
      takeCreatedNotification: jest.fn(),
      findOwners: jest.fn(),
      getIncidentLinkInDashboard: jest.fn(),
      getIncidentIdentifiedDate: jest.fn(),
      updateOneById: jest.fn(),
      isIncidentResolved: jest.fn(),
      isIncidentAcknowledged: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/AlertService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      findBy: jest.fn(),
      findOneById: jest.fn(),
      findCreatedNotificationsDue: jest.fn(),
      takeCreatedNotification: jest.fn(),
      findOwners: jest.fn(),
      getAlertLinkInDashboard: jest.fn(),
      getAlertIdentifiedDate: jest.fn(),
      countBy: jest.fn(),
      updateOneById: jest.fn(),
      isAlertResolved: jest.fn(),
      isAlertAcknowledged: jest.fn(),
    },
  };
});

function mockRecordService(): unknown {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      findOneById: jest.fn(),
      findOneBy: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
}

// A service with every read and write the owner jobs of the other resources make.
function mockAnyService(): unknown {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      findBy: jest.fn(),
      findOneById: jest.fn(),
      findOneBy: jest.fn(),
      updateOneById: jest.fn(),
      findOwners: jest.fn(),
      getEpisodeLinkInDashboard: jest.fn(),
      getMonitorLinkInDashboard: jest.fn(),
      getMonitorDestinationInfo: jest.fn(),
      getScheduledMaintenanceLinkInDashboard: jest.fn(),
      getStatusPageLinkInDashboard: jest.fn(),
      getSloLinkInDashboard: jest.fn(),
      isScheduledMaintenanceCompleted: jest.fn(),
      isScheduledMaintenanceOngoing: jest.fn(),
      findMatchingRule: jest.fn(),
      createIncidentEpisodeFeedItem: jest.fn(),
      createAlertEpisodeFeedItem: jest.fn(),
      createScheduledMaintenanceFeedItem: jest.fn(),
    },
  };
}

jest.mock("Common/Server/Services/IncidentEpisodeService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/IncidentEpisodeStateTimelineService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/IncidentEpisodeInternalNoteService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/IncidentEpisodeMemberService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/IncidentEpisodeOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/IncidentEpisodeOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/IncidentEpisodeFeedService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/AlertEpisodeService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/AlertEpisodeStateTimelineService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/AlertEpisodeInternalNoteService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/AlertEpisodeMemberService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/AlertEpisodeOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/AlertEpisodeOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/AlertEpisodeFeedService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/MonitorService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/MonitorStatusTimelineService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/MonitorStatusService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/MonitorOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/MonitorOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/ScheduledMaintenanceService", () => {
  return mockAnyService();
});
jest.mock(
  "Common/Server/Services/ScheduledMaintenanceStateTimelineService",
  () => {
    return mockAnyService();
  },
);
jest.mock("Common/Server/Services/ScheduledMaintenanceStateService", () => {
  return mockAnyService();
});
jest.mock(
  "Common/Server/Services/ScheduledMaintenancePublicNoteService",
  () => {
    return mockAnyService();
  },
);
jest.mock(
  "Common/Server/Services/ScheduledMaintenanceInternalNoteService",
  () => {
    return mockAnyService();
  },
);
jest.mock("Common/Server/Services/ScheduledMaintenanceOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/ScheduledMaintenanceOwnerUserService", () => {
  return mockAnyService();
});
jest.mock(
  "Common/Server/Services/ScheduledMaintenanceReminderRuleService",
  () => {
    return mockAnyService();
  },
);
jest.mock("Common/Server/Services/ScheduledMaintenanceFeedService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/StatusPageService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/StatusPageAnnouncementService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/StatusPageOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/StatusPageOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/ServiceLevelObjectiveService", () => {
  return mockAnyService();
});
jest.mock(
  "Common/Server/Services/ServiceLevelObjectiveOwnerTeamService",
  () => {
    return mockAnyService();
  },
);
jest.mock(
  "Common/Server/Services/ServiceLevelObjectiveOwnerUserService",
  () => {
    return mockAnyService();
  },
);
jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/NetworkDeviceOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/NetworkDeviceOwnerUserService", () => {
  return mockAnyService();
});

// The network device job links to the dashboard it reads from the database.
jest.mock("Common/Server/DatabaseConfig", () => {
  const url: typeof import("Common/Types/API/URL").default = (
    jest.requireActual("Common/Types/API/URL") as {
      default: typeof import("Common/Types/API/URL").default;
    }
  ).default;

  return {
    __esModule: true,
    default: {
      getDashboardUrl: jest.fn(async () => {
        return url.fromString("https://oneuptime.test");
      }),
    },
  };
});

jest.mock("Common/Server/Services/IncidentStateTimelineService", () => {
  return mockRecordService();
});
jest.mock("Common/Server/Services/AlertStateTimelineService", () => {
  return mockRecordService();
});
jest.mock("Common/Server/Services/IncidentStateService", () => {
  return mockRecordService();
});
jest.mock("Common/Server/Services/AlertStateService", () => {
  return mockRecordService();
});
jest.mock("Common/Server/Services/IncidentPublicNoteService", () => {
  return mockRecordService();
});
jest.mock("Common/Server/Services/IncidentInternalNoteService", () => {
  return mockRecordService();
});
jest.mock("Common/Server/Services/AlertInternalNoteService", () => {
  return mockRecordService();
});
jest.mock("Common/Server/Services/IncidentOwnerTeamService", () => {
  return mockRecordService();
});
jest.mock("Common/Server/Services/IncidentOwnerUserService", () => {
  return mockRecordService();
});
jest.mock("Common/Server/Services/AlertOwnerTeamService", () => {
  return mockRecordService();
});
jest.mock("Common/Server/Services/AlertOwnerUserService", () => {
  return mockRecordService();
});

jest.mock("Common/Server/Services/IncidentReminderRuleService", () => {
  return {
    __esModule: true,
    default: { findMatchingRule: jest.fn() },
  };
});

jest.mock("Common/Server/Services/AlertReminderRuleService", () => {
  return {
    __esModule: true,
    default: { findMatchingRule: jest.fn() },
  };
});

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      getUsersInTeams: jest.fn(),
      filterUsersToProjectMembers: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: { getOwners: jest.fn() },
  };
});

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      getUserMarkdownString: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/UserNotificationSettingService", () => {
  return {
    __esModule: true,
    default: {
      sendUserNotification: jest.fn(),
      ensureSettingExistsForUser: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentFeedService", () => {
  return {
    __esModule: true,
    default: { createIncidentFeedItem: jest.fn() },
  };
});

jest.mock("Common/Server/Services/AlertFeedService", () => {
  return {
    __esModule: true,
    default: { createAlertFeedItem: jest.fn() },
  };
});

jest.mock(
  "Common/Server/Utils/AffectedResources/LinkedAffectedResources",
  () => {
    return {
      __esModule: true,
      default: {
        readForIncident: jest.fn(async () => {
          return [];
        }),
        readForAlert: jest.fn(async () => {
          return [];
        }),
        readForScheduledMaintenance: jest.fn(async () => {
          return [];
        }),
        getText: jest.fn((data: { fallback: string }) => {
          return data.fallback;
        }),
        getNames: jest.fn(() => {
          return [];
        }),
      },
    };
  },
);

jest.mock("Common/Server/Utils/PushNotificationUtil", () => {
  return {
    __esModule: true,
    default: {
      createIncidentCreatedNotification: jest.fn(() => {
        return {};
      }),
      createAlertCreatedNotification: jest.fn(() => {
        return {};
      }),
      createIncidentStateChangedNotification: jest.fn(() => {
        return {};
      }),
      createIncidentNotePostedNotification: jest.fn(() => {
        return {};
      }),
      createGenericNotification: jest.fn(() => {
        return {};
      }),
      createMonitorCreatedNotification: jest.fn(() => {
        return {};
      }),
      createMonitorStatusChangedNotification: jest.fn(() => {
        return {};
      }),
    },
  };
});

jest.mock("Common/Server/Utils/WhatsAppTemplateUtil", () => {
  return {
    __esModule: true,
    createWhatsAppMessageFromTemplate: jest.fn(() => {
      return { templateVariables: {} };
    }),
  };
});

import AlertFeedService from "Common/Server/Services/AlertFeedService";
import AlertInternalNoteService from "Common/Server/Services/AlertInternalNoteService";
import AlertOwnerTeamService from "Common/Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "Common/Server/Services/AlertOwnerUserService";
import AlertReminderRuleService from "Common/Server/Services/AlertReminderRuleService";
import AlertService from "Common/Server/Services/AlertService";
import AlertStateTimelineService from "Common/Server/Services/AlertStateTimelineService";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import IncidentInternalNoteService from "Common/Server/Services/IncidentInternalNoteService";
import IncidentOwnerTeamService from "Common/Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "Common/Server/Services/IncidentOwnerUserService";
import IncidentPublicNoteService from "Common/Server/Services/IncidentPublicNoteService";
import IncidentReminderRuleService from "Common/Server/Services/IncidentReminderRuleService";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateTimelineService from "Common/Server/Services/IncidentStateTimelineService";
import ProjectService from "Common/Server/Services/ProjectService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import UserService from "Common/Server/Services/UserService";
import logger from "Common/Server/Utils/Logger";
import OwnerNotificationDeliveries from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "Common/Server/Services/IncidentEpisodeStateTimelineService";
import IncidentEpisodeInternalNoteService from "Common/Server/Services/IncidentEpisodeInternalNoteService";
import IncidentEpisodeMemberService from "Common/Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeOwnerTeamService from "Common/Server/Services/IncidentEpisodeOwnerTeamService";
import IncidentEpisodeOwnerUserService from "Common/Server/Services/IncidentEpisodeOwnerUserService";
import IncidentEpisodeFeedService from "Common/Server/Services/IncidentEpisodeFeedService";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import AlertEpisodeStateTimelineService from "Common/Server/Services/AlertEpisodeStateTimelineService";
import AlertEpisodeInternalNoteService from "Common/Server/Services/AlertEpisodeInternalNoteService";
import AlertEpisodeMemberService from "Common/Server/Services/AlertEpisodeMemberService";
import AlertEpisodeOwnerTeamService from "Common/Server/Services/AlertEpisodeOwnerTeamService";
import AlertEpisodeOwnerUserService from "Common/Server/Services/AlertEpisodeOwnerUserService";
import AlertEpisodeFeedService from "Common/Server/Services/AlertEpisodeFeedService";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorStatusTimelineService from "Common/Server/Services/MonitorStatusTimelineService";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import MonitorOwnerTeamService from "Common/Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "Common/Server/Services/MonitorOwnerUserService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "Common/Server/Services/ScheduledMaintenanceStateTimelineService";
import ScheduledMaintenanceStateService from "Common/Server/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenancePublicNoteService from "Common/Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceInternalNoteService from "Common/Server/Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenanceOwnerTeamService from "Common/Server/Services/ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceOwnerUserService from "Common/Server/Services/ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenanceReminderRuleService from "Common/Server/Services/ScheduledMaintenanceReminderRuleService";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import StatusPageAnnouncementService from "Common/Server/Services/StatusPageAnnouncementService";
import StatusPageOwnerTeamService from "Common/Server/Services/StatusPageOwnerTeamService";
import StatusPageOwnerUserService from "Common/Server/Services/StatusPageOwnerUserService";
import ServiceLevelObjectiveService from "Common/Server/Services/ServiceLevelObjectiveService";
import ServiceLevelObjectiveOwnerTeamService from "Common/Server/Services/ServiceLevelObjectiveOwnerTeamService";
import ServiceLevelObjectiveOwnerUserService from "Common/Server/Services/ServiceLevelObjectiveOwnerUserService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import NetworkDeviceOwnerTeamService from "Common/Server/Services/NetworkDeviceOwnerTeamService";
import NetworkDeviceOwnerUserService from "Common/Server/Services/NetworkDeviceOwnerUserService";

// Imported for their side effect: RunCron (mocked above) records each handler.
import "../../../FeatureSet/Workers/Jobs/IncidentOwners/SendCreatedResourceNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentOwners/SendStateChangeNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentOwners/SendNotePostedNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentOwners/SendUnresolvedReminderNotification";
import "../../../FeatureSet/Workers/Jobs/AlertOwners/SendCreatedResourceNotification";
import "../../../FeatureSet/Workers/Jobs/AlertOwners/SendStateChangeNotification";
import "../../../FeatureSet/Workers/Jobs/AlertOwners/SendNotePostedNotification";
import "../../../FeatureSet/Workers/Jobs/AlertOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/AlertOwners/SendUnresolvedReminderNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentEpisodeOwners/SendCreatedResourceNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentEpisodeOwners/SendStateChangeNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentEpisodeOwners/SendNotePostedNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentEpisodeOwners/SendIncidentAddedNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentEpisodeOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/AlertEpisodeOwners/SendCreatedResourceNotification";
import "../../../FeatureSet/Workers/Jobs/AlertEpisodeOwners/SendStateChangeNotification";
import "../../../FeatureSet/Workers/Jobs/AlertEpisodeOwners/SendNotePostedNotification";
import "../../../FeatureSet/Workers/Jobs/AlertEpisodeOwners/SendAlertAddedNotification";
import "../../../FeatureSet/Workers/Jobs/AlertEpisodeOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/MonitorOwners/SendCreatedResourceNotification";
import "../../../FeatureSet/Workers/Jobs/MonitorOwners/SendStatusChangeNotification";
import "../../../FeatureSet/Workers/Jobs/MonitorOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/ScheduledMaintenanceOwners/SendCreatedResourceNotification";
import "../../../FeatureSet/Workers/Jobs/ScheduledMaintenanceOwners/SendStateChangeNotification";
import "../../../FeatureSet/Workers/Jobs/ScheduledMaintenanceOwners/SendNotePostedNotification";
import "../../../FeatureSet/Workers/Jobs/ScheduledMaintenanceOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/ScheduledMaintenanceOwners/SendUnresolvedReminderNotification";
import "../../../FeatureSet/Workers/Jobs/StatusPageOwners/SendCreatedResourceNotification";
import "../../../FeatureSet/Workers/Jobs/StatusPageOwners/SendAnnouncementCreatedNotification";
import "../../../FeatureSet/Workers/Jobs/StatusPageOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/SloOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/NetworkDeviceOwners/SendOwnerAddedNotification";

type AnyMock = jest.Mock;

function asMock(fn: unknown): AnyMock {
  return fn as AnyMock;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-0000000000a1",
);
const ALERT_ID: ObjectID = new ObjectID("aaaaaaaa-0000-4000-8000-0000000000b1");
// The record whose notification it is, for the kinds that have one of their own.
const EVENT_ID: ObjectID = new ObjectID("aaaaaaaa-0000-4000-8000-0000000000e1");

const START: Date = new Date("2026-11-15T10:00:00.000Z");

function makeOwner(n: number): User {
  const user: User = new User(
    new ObjectID(`11111111-0000-4000-8000-00000000000${n}`),
  );
  user.name = new Name(`Owner ${n}`);
  user.email = new Email(`owner${n}@acme.test`);
  return user;
}

const OWNER_1: User = makeOwner(1);
const OWNER_2: User = makeOwner(2);
const OWNER_3: User = makeOwner(3);
const OWNERS: Array<User> = [OWNER_1, OWNER_2, OWNER_3];

function idOf(user: User): string {
  return user.id!.toString();
}

// Whether a feed item's details name the owner: by their markdown, or name and address.
function namesOwner(markdown: string, user: User): boolean {
  return (
    markdown.includes(idOf(user)) || markdown.includes(user.email!.toString())
  );
}

const NEVER: Promise<never> = new Promise<never>(() => {
  // a stopped worker hears nothing back
});

/*
 * What the services stand in for: the record a job tells of, whether it is
 * still due (not taken), and what was sent.
 */
interface World {
  owners: Array<User>;
  // The record (and its incident or alert) is there.
  exists: boolean;
  // The job took it: marked it notified, or moved its reminder on.
  isTaken: boolean;
  takes: number;
  isResolved: boolean;
  // Whether a public note is published: owners are told only of a published one.
  isPublished: boolean;
  // The next take never answers: the worker stops there.
  takeStops: boolean;
  // That owner's next send starts and never returns, or returns when `sendGate` does.
  sendStopsFor: string | null;
  sendGate: Promise<void> | null;
  sendFailsFor: string | null;
  // Every send, in order: whom it was to.
  sent: Array<string>;
  // Where a worker stopped.
  stoppedAt: Array<string>;
}

let world: World;

// One job, the record it tells of, and how the services answer for it.
interface JobCase {
  title: string;
  jobName: string;
  kind: OwnerNotificationKind;
  resourceId: ObjectID;
  eventId: ObjectID;
  occurrence: number;
  arrange: () => void;
  // The feed items written for the record.
  feedItems: () => Array<{ moreInformationInMarkdown: string }>;
  // Whether its feed item names whom it reached.
  namesWhomItReached: boolean;
  // The feed's create, for the jobs that write a feed item.
  feedService?: unknown;
}

function incident(): Incident {
  const record: Incident = new Incident(INCIDENT_ID);
  record.projectId = PROJECT_ID;
  record.title = "Checkout is down";
  record.description = "Checkout returns 500s";
  record.incidentNumber = 12;
  record.createdAt = START;
  record.declaredAt = START;
  record.enableReminders = true;
  record.reminderNotificationSentCount = 0;

  const project: Project = new Project();
  project.name = "Acme";
  record.project = project;

  const state: IncidentState = new IncidentState();
  state.name = "Identified";
  record.currentIncidentState = state;

  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Major";
  record.incidentSeverity = severity;

  return record;
}

function alert(): Alert {
  const record: Alert = new Alert(ALERT_ID);
  record.projectId = PROJECT_ID;
  record.title = "CPU is high";
  record.description = "CPU above 90%";
  record.alertNumber = 7;
  record.createdAt = START;
  record.enableReminders = true;
  record.reminderNotificationSentCount = 0;

  const project: Project = new Project();
  project.name = "Acme";
  record.project = project;

  const state: AlertState = new AlertState();
  state.name = "Identified";
  record.currentAlertState = state;

  const severity: AlertSeverity = new AlertSeverity();
  severity.name = "High";
  record.alertSeverity = severity;

  return record;
}

// The record's due read: there while it is not taken.
function dueWhileNotTaken<T>(record: () => T): () => Promise<Array<T>> {
  return async (): Promise<Array<T>> => {
    return world.exists && !world.isTaken ? [record()] : [];
  };
}

async function takeOrStop(): Promise<void> {
  if (world.takeStops) {
    world.takeStops = false;
    world.stoppedAt.push("take");
    await NEVER;
  }

  world.isTaken = true;
  world.takes++;
}

// A take that matches only the record as it was read, as the Created jobs' does.
async function compareAndSetTake(): Promise<boolean> {
  if (world.takeStops) {
    world.takeStops = false;
    world.stoppedAt.push("take");
    return await NEVER;
  }

  if (world.isTaken || !world.exists) {
    return false;
  }

  world.isTaken = true;
  world.takes++;
  return true;
}

function feedOf(
  mock: unknown,
  key: string,
  id: ObjectID,
): () => Array<{ moreInformationInMarkdown: string }> {
  return (): Array<{ moreInformationInMarkdown: string }> => {
    return asMock(mock)
      .mock.calls.map((call: Array<unknown>) => {
        return call[0] as Record<string, unknown>;
      })
      .filter((item: Record<string, unknown>): boolean => {
        return String(item[key]) === id.toString();
      })
      .map((item: Record<string, unknown>) => {
        return {
          moreInformationInMarkdown: String(item["moreInformationInMarkdown"]),
        };
      });
  };
}

const incidentFeed: () => Array<{ moreInformationInMarkdown: string }> = feedOf(
  IncidentFeedService.createIncidentFeedItem,
  "incidentId",
  INCIDENT_ID,
);
const alertFeed: () => Array<{ moreInformationInMarkdown: string }> = feedOf(
  AlertFeedService.createAlertFeedItem,
  "alertId",
  ALERT_ID,
);

function arrangeIncident(): void {
  asMock(IncidentService.findOneById).mockImplementation(async () => {
    return world.exists ? incident() : null;
  });
  asMock(IncidentService.findOwners).mockImplementation(async () => {
    return world.owners;
  });
}

function arrangeAlert(): void {
  asMock(AlertService.findOneById).mockImplementation(async () => {
    return world.exists ? alert() : null;
  });
  asMock(AlertService.findOwners).mockImplementation(async () => {
    return world.owners;
  });
}

const CASES: Array<JobCase> = [
  {
    title: "an incident's Created notification",
    jobName: "IncidentOwner:SendCreatedResourceEmail",
    kind: OwnerNotificationKind.IncidentCreated,
    resourceId: INCIDENT_ID,
    eventId: INCIDENT_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: incidentFeed,
    feedService: IncidentFeedService.createIncidentFeedItem,
    arrange: (): void => {
      arrangeIncident();
      asMock(IncidentService.findCreatedNotificationsDue).mockImplementation(
        dueWhileNotTaken(incident),
      );
      asMock(IncidentService.takeCreatedNotification).mockImplementation(
        compareAndSetTake,
      );
    },
  },
  {
    title: "an alert's Created notification",
    jobName: "AlertOwner:SendCreatedResourceEmail",
    kind: OwnerNotificationKind.AlertCreated,
    resourceId: ALERT_ID,
    eventId: ALERT_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: alertFeed,
    feedService: AlertFeedService.createAlertFeedItem,
    arrange: (): void => {
      arrangeAlert();
      asMock(AlertService.findCreatedNotificationsDue).mockImplementation(
        dueWhileNotTaken(alert),
      );
      asMock(AlertService.takeCreatedNotification).mockImplementation(
        compareAndSetTake,
      );
    },
  },
  {
    title: "an incident's state change",
    jobName: "IncidentOwner:SendStateChangeEmail",
    kind: OwnerNotificationKind.IncidentStateChanged,
    resourceId: INCIDENT_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: incidentFeed,
    feedService: IncidentFeedService.createIncidentFeedItem,
    arrange: (): void => {
      arrangeIncident();

      const timeline: () => IncidentStateTimeline =
        (): IncidentStateTimeline => {
          const record: IncidentStateTimeline = new IncidentStateTimeline(
            EVENT_ID,
          );
          record.projectId = PROJECT_ID;
          record.incidentId = INCIDENT_ID;
          record.createdAt = START;
          const project: Project = new Project();
          project.name = "Acme";
          record.project = project;
          const state: IncidentState = new IncidentState();
          state.name = "Resolved";
          record.incidentState = state;
          return record;
        };

      asMock(IncidentStateTimelineService.findAllBy).mockImplementation(
        dueWhileNotTaken(timeline),
      );
      asMock(IncidentStateTimelineService.findOneById).mockImplementation(
        async () => {
          return world.exists ? timeline() : null;
        },
      );
      asMock(IncidentStateTimelineService.findOneBy).mockResolvedValue(null);
      asMock(IncidentStateTimelineService.updateOneById).mockImplementation(
        takeOrStop,
      );
    },
  },
  {
    title: "an alert's state change",
    jobName: "AlertOwner:SendStateChangeEmail",
    kind: OwnerNotificationKind.AlertStateChanged,
    resourceId: ALERT_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: alertFeed,
    feedService: AlertFeedService.createAlertFeedItem,
    arrange: (): void => {
      arrangeAlert();

      const timeline: () => AlertStateTimeline = (): AlertStateTimeline => {
        const record: AlertStateTimeline = new AlertStateTimeline(EVENT_ID);
        record.projectId = PROJECT_ID;
        record.alertId = ALERT_ID;
        record.createdAt = START;
        const project: Project = new Project();
        project.name = "Acme";
        record.project = project;
        const state: AlertState = new AlertState();
        state.name = "Resolved";
        record.alertState = state;
        return record;
      };

      asMock(AlertStateTimelineService.findAllBy).mockImplementation(
        dueWhileNotTaken(timeline),
      );
      asMock(AlertStateTimelineService.findOneById).mockImplementation(
        async () => {
          return world.exists ? timeline() : null;
        },
      );
      asMock(AlertStateTimelineService.findOneBy).mockResolvedValue(null);
      asMock(AlertStateTimelineService.updateOneById).mockImplementation(
        takeOrStop,
      );
    },
  },
  {
    title: "a public note posted on an incident",
    jobName: "IncidentOwner:SendsNotePostedEmail",
    kind: OwnerNotificationKind.IncidentPublicNotePosted,
    resourceId: INCIDENT_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: incidentFeed,
    feedService: IncidentFeedService.createIncidentFeedItem,
    arrange: (): void => {
      arrangeIncident();

      const note: () => IncidentPublicNote = (): IncidentPublicNote => {
        const record: IncidentPublicNote = new IncidentPublicNote(EVENT_ID);
        record.projectId = PROJECT_ID;
        record.incidentId = INCIDENT_ID;
        record.note = "We are on it";
        return record;
      };

      asMock(IncidentPublicNoteService.findAllBy).mockImplementation(
        dueWhileNotTaken(note),
      );
      // Read again only while it is published, as the job asks.
      asMock(IncidentPublicNoteService.findOneBy).mockImplementation(
        async (data: { query: JSONObject }) => {
          return world.exists &&
            world.isPublished &&
            data.query["isPublished"] === true
            ? note()
            : null;
        },
      );
      asMock(IncidentPublicNoteService.updateOneById).mockImplementation(
        takeOrStop,
      );
    },
  },
  {
    title: "a private note posted on an incident",
    jobName: "IncidentOwner:SendsNotePostedEmail",
    kind: OwnerNotificationKind.IncidentInternalNotePosted,
    resourceId: INCIDENT_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: incidentFeed,
    feedService: IncidentFeedService.createIncidentFeedItem,
    arrange: (): void => {
      arrangeIncident();

      const note: () => IncidentInternalNote = (): IncidentInternalNote => {
        const record: IncidentInternalNote = new IncidentInternalNote(EVENT_ID);
        record.projectId = PROJECT_ID;
        record.incidentId = INCIDENT_ID;
        record.note = "Rolling back";
        return record;
      };

      asMock(IncidentInternalNoteService.findAllBy).mockImplementation(
        dueWhileNotTaken(note),
      );
      asMock(IncidentInternalNoteService.findOneById).mockImplementation(
        async () => {
          return world.exists ? note() : null;
        },
      );
      asMock(IncidentInternalNoteService.updateOneById).mockImplementation(
        takeOrStop,
      );
    },
  },
  {
    title: "a note posted on an alert",
    jobName: "AlertOwner:SendsNotePostedEmail",
    kind: OwnerNotificationKind.AlertInternalNotePosted,
    resourceId: ALERT_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: alertFeed,
    feedService: AlertFeedService.createAlertFeedItem,
    arrange: (): void => {
      arrangeAlert();

      const note: () => AlertInternalNote = (): AlertInternalNote => {
        const record: AlertInternalNote = new AlertInternalNote(EVENT_ID);
        record.projectId = PROJECT_ID;
        record.alertId = ALERT_ID;
        record.note = "Scaling out";
        return record;
      };

      asMock(AlertInternalNoteService.findAllBy).mockImplementation(
        dueWhileNotTaken(note),
      );
      asMock(AlertInternalNoteService.findOneById).mockImplementation(
        async () => {
          return world.exists ? note() : null;
        },
      );
      asMock(AlertInternalNoteService.updateOneById).mockImplementation(
        takeOrStop,
      );
    },
  },
  {
    title: "a team added as the owner of an incident",
    jobName: "IncidentOwner:SendOwnerAddedEmail",
    kind: OwnerNotificationKind.IncidentOwnerAdded,
    resourceId: INCIDENT_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: false,
    feedItems: incidentFeed,
    arrange: (): void => {
      arrangeIncident();

      const ownerRow: () => IncidentOwnerTeam = (): IncidentOwnerTeam => {
        const record: IncidentOwnerTeam = new IncidentOwnerTeam(EVENT_ID);
        record.projectId = PROJECT_ID;
        record.incidentId = INCIDENT_ID;
        record.teamId = new ObjectID("aaaaaaaa-0000-4000-8000-0000000000c1");
        return record;
      };

      asMock(IncidentOwnerTeamService.findAllBy).mockImplementation(
        dueWhileNotTaken(ownerRow),
      );
      asMock(IncidentOwnerUserService.findAllBy).mockResolvedValue([]);
      asMock(IncidentOwnerTeamService.updateOneById).mockImplementation(
        takeOrStop,
      );
    },
  },
  {
    title: "a team added as the owner of an alert",
    jobName: "AlertOwner:SendOwnerAddedEmail",
    kind: OwnerNotificationKind.AlertOwnerAdded,
    resourceId: ALERT_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: false,
    feedItems: alertFeed,
    arrange: (): void => {
      arrangeAlert();

      const ownerRow: () => AlertOwnerTeam = (): AlertOwnerTeam => {
        const record: AlertOwnerTeam = new AlertOwnerTeam(EVENT_ID);
        record.projectId = PROJECT_ID;
        record.alertId = ALERT_ID;
        record.teamId = new ObjectID("aaaaaaaa-0000-4000-8000-0000000000c1");
        return record;
      };

      asMock(AlertOwnerTeamService.findAllBy).mockImplementation(
        dueWhileNotTaken(ownerRow),
      );
      asMock(AlertOwnerUserService.findAllBy).mockResolvedValue([]);
      asMock(AlertOwnerTeamService.updateOneById).mockImplementation(
        takeOrStop,
      );
    },
  },
  {
    title: "a reminder that an incident is still open",
    jobName: "IncidentOwner:SendUnresolvedReminderNotification",
    kind: OwnerNotificationKind.IncidentReminder,
    resourceId: INCIDENT_ID,
    eventId: INCIDENT_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: incidentFeed,
    feedService: IncidentFeedService.createIncidentFeedItem,
    arrange: (): void => {
      arrangeIncident();
      asMock(IncidentService.findAllBy).mockImplementation(
        dueWhileNotTaken(incident),
      );
      asMock(IncidentService.updateOneById).mockImplementation(
        async (data: { data: JSONObject }) => {
          // Moving the reminder on is the take; stopping it is not.
          if (data.data["nextReminderNotificationAt"] !== null) {
            await takeOrStop();
          }
        },
      );
      asMock(IncidentReminderRuleService.findMatchingRule).mockResolvedValue({
        reminderIntervalInMinutes: 30,
      });
    },
  },
  {
    title: "a reminder that an alert is still open",
    jobName: "AlertOwner:SendUnresolvedReminderNotification",
    kind: OwnerNotificationKind.AlertReminder,
    resourceId: ALERT_ID,
    eventId: ALERT_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: alertFeed,
    feedService: AlertFeedService.createAlertFeedItem,
    arrange: (): void => {
      arrangeAlert();
      asMock(AlertService.findAllBy).mockImplementation(
        dueWhileNotTaken(alert),
      );
      asMock(AlertService.updateOneById).mockImplementation(
        async (data: { data: JSONObject }) => {
          if (data.data["nextReminderNotificationAt"] !== null) {
            await takeOrStop();
          }
        },
      );
      asMock(AlertReminderRuleService.findMatchingRule).mockResolvedValue({
        reminderIntervalInMinutes: 30,
      });
    },
  },
];

/*
 * THE OTHER RESOURCES' JOBS (#8509): episodes, monitors, scheduled
 * maintenance events, status pages, SLOs and network devices. Their records
 * stand in as plain objects - each job reads only the fields it is given -
 * and every service answers from the world as the incident and alert ones
 * do.
 */
const EVERY_RESOURCE_SERVICES: Array<unknown> = [
  IncidentEpisodeService,
  IncidentEpisodeStateTimelineService,
  IncidentEpisodeInternalNoteService,
  IncidentEpisodeMemberService,
  IncidentEpisodeOwnerTeamService,
  IncidentEpisodeOwnerUserService,
  IncidentEpisodeFeedService,
  AlertEpisodeService,
  AlertEpisodeStateTimelineService,
  AlertEpisodeInternalNoteService,
  AlertEpisodeMemberService,
  AlertEpisodeOwnerTeamService,
  AlertEpisodeOwnerUserService,
  AlertEpisodeFeedService,
  MonitorService,
  MonitorStatusTimelineService,
  MonitorStatusService,
  MonitorOwnerTeamService,
  MonitorOwnerUserService,
  ScheduledMaintenanceService,
  ScheduledMaintenanceStateTimelineService,
  ScheduledMaintenanceStateService,
  ScheduledMaintenancePublicNoteService,
  ScheduledMaintenanceInternalNoteService,
  ScheduledMaintenanceOwnerTeamService,
  ScheduledMaintenanceOwnerUserService,
  ScheduledMaintenanceReminderRuleService,
  ScheduledMaintenanceFeedService,
  StatusPageService,
  StatusPageAnnouncementService,
  StatusPageOwnerTeamService,
  StatusPageOwnerUserService,
  ServiceLevelObjectiveService,
  ServiceLevelObjectiveOwnerTeamService,
  ServiceLevelObjectiveOwnerUserService,
  NetworkDeviceService,
  NetworkDeviceOwnerTeamService,
  NetworkDeviceOwnerUserService,
];

// The record the owners of the other resources are told of.
const RESOURCE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-0000000000d1",
);
const TEAM_ID: ObjectID = new ObjectID("aaaaaaaa-0000-4000-8000-0000000000c1");

type PlainRecord = Record<string, unknown>;

function plain(fields: PlainRecord): PlainRecord {
  const id: ObjectID | undefined = fields["id"] as ObjectID | undefined;
  return { ...(id ? { _id: id.toString() } : {}), ...fields };
}

const OF_THE_PROJECT: PlainRecord = {
  projectId: PROJECT_ID,
  project: { name: "Acme" },
};

function incidentEpisode(): PlainRecord {
  return plain({
    id: RESOURCE_ID,
    ...OF_THE_PROJECT,
    title: "Checkout is flapping",
    description: "Three incidents in an hour",
    episodeNumber: 3,
    createdAt: START,
    currentIncidentState: { name: "Active" },
    incidentSeverity: { name: "Major" },
  });
}

function alertEpisode(): PlainRecord {
  return plain({
    id: RESOURCE_ID,
    ...OF_THE_PROJECT,
    title: "CPU is spiking",
    description: "Three alerts in an hour",
    episodeNumber: 5,
    createdAt: START,
    currentAlertState: { name: "Active" },
    alertSeverity: { name: "High" },
  });
}

function monitor(): PlainRecord {
  return plain({
    id: RESOURCE_ID,
    ...OF_THE_PROJECT,
    name: "Checkout API",
    description: "The checkout endpoint",
    currentMonitorStatus: { name: "Operational" },
  });
}

function scheduledMaintenance(): PlainRecord {
  return plain({
    id: RESOURCE_ID,
    ...OF_THE_PROJECT,
    title: "Database upgrade",
    description: "Postgres 16",
    scheduledMaintenanceNumber: 4,
    currentScheduledMaintenanceState: { name: "Ongoing" },
    createdAt: START,
    startsAt: START,
    enableReminders: true,
    reminderNotificationSentCount: 0,
    labels: [],
  });
}

function statusPage(): PlainRecord {
  return plain({
    id: RESOURCE_ID,
    ...OF_THE_PROJECT,
    name: "Acme Status",
    description: "How Acme is doing",
  });
}

function serviceLevelObjective(): PlainRecord {
  return plain({
    id: RESOURCE_ID,
    ...OF_THE_PROJECT,
    name: "Checkout availability",
    targetPercentage: 99.9,
    windowDays: 30,
  });
}

function networkDevice(): PlainRecord {
  return plain({ id: RESOURCE_ID, ...OF_THE_PROJECT, name: "core-sw-1" });
}

// A team row of the record, added as its owner: its members are the owners.
function ownerTeamRow(recordIdField: string): () => PlainRecord {
  return (): PlainRecord => {
    return plain({
      id: EVENT_ID,
      projectId: PROJECT_ID,
      [recordIdField]: RESOURCE_ID,
      teamId: TEAM_ID,
    });
  };
}

function serviceOf(service: unknown): Record<string, unknown> {
  return service as Record<string, unknown>;
}

// The record a job tells of, read by its id while it is there.
function arrangeRecord(service: unknown, record: () => PlainRecord): void {
  asMock(serviceOf(service)["findOneById"]).mockImplementation(async () => {
    return world.exists ? record() : null;
  });
}

/*
 * A record due until the job takes it: read by the job's due read, read
 * again by its id while it is there, and taken by its update.
 */
function arrangeDue(service: unknown, record: () => PlainRecord): void {
  asMock(serviceOf(service)["findAllBy"]).mockImplementation(
    dueWhileNotTaken(record),
  );
  arrangeRecord(service, record);
  asMock(serviceOf(service)["updateOneById"]).mockImplementation(takeOrStop);
}

function feedOfService(
  service: unknown,
  create: string,
  key: string,
): () => Array<{ moreInformationInMarkdown: string }> {
  return feedOf(serviceOf(service)[create], key, RESOURCE_ID);
}

interface OwnerAddedOf {
  title: string;
  jobName: string;
  kind: OwnerNotificationKind;
  recordService: unknown;
  teamService: unknown;
  recordIdField: string;
  record: () => PlainRecord;
}

function ownerAddedCase(of: OwnerAddedOf): JobCase {
  return {
    title: of.title,
    jobName: of.jobName,
    kind: of.kind,
    resourceId: RESOURCE_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: false,
    feedItems: () => {
      return [];
    },
    arrange: (): void => {
      arrangeRecord(of.recordService, of.record);
      arrangeDue(of.teamService, ownerTeamRow(of.recordIdField));
    },
  };
}

interface EpisodeOf {
  noun: "incident" | "alert";
  jobPrefix: string;
  episodeService: unknown;
  timelineService: unknown;
  noteService: unknown;
  memberService: unknown;
  teamService: unknown;
  feedService: unknown;
  feedCreate: string;
  episodeIdField: string;
  memberIdField: string;
  episode: () => PlainRecord;
  kinds: {
    created: OwnerNotificationKind;
    stateChanged: OwnerNotificationKind;
    notePosted: OwnerNotificationKind;
    memberAdded: OwnerNotificationKind;
    ownerAdded: OwnerNotificationKind;
  };
  memberAddedJob: string;
}

function episodeCases(of: EpisodeOf): Array<JobCase> {
  const feedItems: () => Array<{ moreInformationInMarkdown: string }> =
    feedOfService(of.feedService, of.feedCreate, of.episodeIdField);
  const feedService: unknown = serviceOf(of.feedService)[of.feedCreate];

  return [
    {
      title: `an ${of.noun} episode's Created notification`,
      jobName: `${of.jobPrefix}:SendCreatedResourceEmail`,
      kind: of.kinds.created,
      resourceId: RESOURCE_ID,
      eventId: RESOURCE_ID,
      occurrence: 1,
      namesWhomItReached: true,
      feedItems: feedItems,
      feedService: feedService,
      arrange: (): void => {
        arrangeDue(of.episodeService, of.episode);
      },
    },
    {
      title: `an ${of.noun} episode's state change`,
      jobName: `${of.jobPrefix}:SendStateChangeEmail`,
      kind: of.kinds.stateChanged,
      resourceId: RESOURCE_ID,
      eventId: EVENT_ID,
      occurrence: 1,
      namesWhomItReached: true,
      feedItems: feedItems,
      feedService: feedService,
      arrange: (): void => {
        arrangeRecord(of.episodeService, of.episode);
        arrangeDue(of.timelineService, (): PlainRecord => {
          return plain({
            id: EVENT_ID,
            ...OF_THE_PROJECT,
            [of.episodeIdField]: RESOURCE_ID,
            [`${of.noun}State`]: { name: "Resolved" },
            createdAt: START,
          });
        });
      },
    },
    {
      title: `a note posted on an ${of.noun} episode`,
      jobName: `${of.jobPrefix}:SendsNotePostedEmail`,
      kind: of.kinds.notePosted,
      resourceId: RESOURCE_ID,
      eventId: EVENT_ID,
      occurrence: 1,
      namesWhomItReached: true,
      feedItems: feedItems,
      feedService: feedService,
      arrange: (): void => {
        arrangeRecord(of.episodeService, of.episode);
        arrangeDue(of.noteService, (): PlainRecord => {
          return plain({
            id: EVENT_ID,
            projectId: PROJECT_ID,
            [of.episodeIdField]: RESOURCE_ID,
            note: "Rolled back the deploy",
          });
        });
      },
    },
    {
      title: `an ${of.noun} added to an ${of.noun} episode`,
      jobName: of.memberAddedJob,
      kind: of.kinds.memberAdded,
      resourceId: RESOURCE_ID,
      // The batch: its first member row, and how many it holds.
      eventId: EVENT_ID,
      occurrence: 1,
      namesWhomItReached: true,
      feedItems: feedItems,
      feedService: feedService,
      arrange: (): void => {
        const member: () => PlainRecord = (): PlainRecord => {
          return plain({
            id: EVENT_ID,
            projectId: PROJECT_ID,
            [of.episodeIdField]: RESOURCE_ID,
            [of.memberIdField]: of.noun === "incident" ? INCIDENT_ID : ALERT_ID,
            addedAt: START,
            createdAt: START,
          });
        };

        arrangeRecord(of.episodeService, of.episode);
        arrangeDue(of.memberService, member);
        // The batch read again by a later run: the members notified since.
        asMock(serviceOf(of.memberService)["findBy"]).mockImplementation(
          async () => {
            return world.exists ? [member()] : [];
          },
        );

        if (of.noun === "incident") {
          asMock(IncidentService.findBy).mockImplementation(async () => {
            return [incident()];
          });
        } else {
          asMock(AlertService.findBy).mockImplementation(async () => {
            return [alert()];
          });
        }
      },
    },
    ownerAddedCase({
      title: `a team added as the owner of an ${of.noun} episode`,
      jobName: `${of.jobPrefix}:SendOwnerAddedEmail`,
      kind: of.kinds.ownerAdded,
      recordService: of.episodeService,
      teamService: of.teamService,
      recordIdField: of.episodeIdField,
      record: of.episode,
    }),
  ];
}

const scheduledMaintenanceFeed: () => Array<{
  moreInformationInMarkdown: string;
}> = feedOfService(
  ScheduledMaintenanceFeedService,
  "createScheduledMaintenanceFeedItem",
  "scheduledMaintenanceId",
);

function scheduledMaintenanceNote(): PlainRecord {
  return plain({
    id: EVENT_ID,
    projectId: PROJECT_ID,
    scheduledMaintenanceId: RESOURCE_ID,
    note: "Halfway through",
  });
}

const EVERY_RESOURCE_CASES: Array<JobCase> = [
  ...episodeCases({
    noun: "incident",
    jobPrefix: "IncidentEpisodeOwner",
    episodeService: IncidentEpisodeService,
    timelineService: IncidentEpisodeStateTimelineService,
    noteService: IncidentEpisodeInternalNoteService,
    memberService: IncidentEpisodeMemberService,
    teamService: IncidentEpisodeOwnerTeamService,
    feedService: IncidentEpisodeFeedService,
    feedCreate: "createIncidentEpisodeFeedItem",
    episodeIdField: "incidentEpisodeId",
    memberIdField: "incidentId",
    episode: incidentEpisode,
    kinds: {
      created: OwnerNotificationKind.IncidentEpisodeCreated,
      stateChanged: OwnerNotificationKind.IncidentEpisodeStateChanged,
      notePosted: OwnerNotificationKind.IncidentEpisodeInternalNotePosted,
      memberAdded: OwnerNotificationKind.IncidentEpisodeIncidentAdded,
      ownerAdded: OwnerNotificationKind.IncidentEpisodeOwnerAdded,
    },
    memberAddedJob: "IncidentEpisodeOwner:SendIncidentAddedEmail",
  }),
  ...episodeCases({
    noun: "alert",
    jobPrefix: "AlertEpisodeOwner",
    episodeService: AlertEpisodeService,
    timelineService: AlertEpisodeStateTimelineService,
    noteService: AlertEpisodeInternalNoteService,
    memberService: AlertEpisodeMemberService,
    teamService: AlertEpisodeOwnerTeamService,
    feedService: AlertEpisodeFeedService,
    feedCreate: "createAlertEpisodeFeedItem",
    episodeIdField: "alertEpisodeId",
    memberIdField: "alertId",
    episode: alertEpisode,
    kinds: {
      created: OwnerNotificationKind.AlertEpisodeCreated,
      stateChanged: OwnerNotificationKind.AlertEpisodeStateChanged,
      notePosted: OwnerNotificationKind.AlertEpisodeInternalNotePosted,
      memberAdded: OwnerNotificationKind.AlertEpisodeAlertAdded,
      ownerAdded: OwnerNotificationKind.AlertEpisodeOwnerAdded,
    },
    memberAddedJob: "AlertEpisodeOwner:SendAlertAddedEmail",
  }),
  {
    title: "a monitor's Created notification",
    jobName: "MonitorOwner:SendCreatedResourceEmail",
    kind: OwnerNotificationKind.MonitorCreated,
    resourceId: RESOURCE_ID,
    eventId: RESOURCE_ID,
    occurrence: 1,
    namesWhomItReached: false,
    feedItems: () => {
      return [];
    },
    arrange: (): void => {
      arrangeDue(MonitorService, monitor);
    },
  },
  {
    title: "a monitor's status change",
    jobName: "MonitorOwner:SendStatusChangeEmail",
    kind: OwnerNotificationKind.MonitorStatusChanged,
    resourceId: RESOURCE_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: false,
    feedItems: () => {
      return [];
    },
    arrange: (): void => {
      arrangeDue(MonitorStatusTimelineService, (): PlainRecord => {
        return plain({
          id: EVENT_ID,
          ...OF_THE_PROJECT,
          monitorId: RESOURCE_ID,
          monitor: monitor(),
          monitorStatus: { name: "Offline" },
          createdAt: START,
          rootCause: "Connection refused",
        });
      });
    },
  },
  ownerAddedCase({
    title: "a team added as the owner of a monitor",
    jobName: "MonitorOwner:SendOwnerAddedEmail",
    kind: OwnerNotificationKind.MonitorOwnerAdded,
    recordService: MonitorService,
    teamService: MonitorOwnerTeamService,
    recordIdField: "monitorId",
    record: monitor,
  }),
  {
    title: "a scheduled maintenance event's Created notification",
    jobName: "ScheduledMaintenanceOwner:SendCreatedResourceEmail",
    kind: OwnerNotificationKind.ScheduledMaintenanceCreated,
    resourceId: RESOURCE_ID,
    eventId: RESOURCE_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: scheduledMaintenanceFeed,
    feedService:
      ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem,
    arrange: (): void => {
      arrangeDue(ScheduledMaintenanceService, scheduledMaintenance);
    },
  },
  {
    title: "a scheduled maintenance event's state change",
    jobName: "ScheduledMaintenanceOwner:SendStateChangeEmail",
    kind: OwnerNotificationKind.ScheduledMaintenanceStateChanged,
    resourceId: RESOURCE_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: scheduledMaintenanceFeed,
    feedService:
      ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem,
    arrange: (): void => {
      arrangeDue(ScheduledMaintenanceStateTimelineService, (): PlainRecord => {
        return plain({
          id: EVENT_ID,
          ...OF_THE_PROJECT,
          scheduledMaintenanceId: RESOURCE_ID,
          scheduledMaintenance: scheduledMaintenance(),
          scheduledMaintenanceState: { name: "Completed" },
          createdAt: START,
          startsAt: START,
        });
      });
    },
  },
  {
    title: "a public note posted on a scheduled maintenance event",
    jobName: "ScheduledMaintenanceOwner:SendsNotePostedEmail",
    kind: OwnerNotificationKind.ScheduledMaintenancePublicNotePosted,
    resourceId: RESOURCE_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: scheduledMaintenanceFeed,
    feedService:
      ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem,
    arrange: (): void => {
      arrangeRecord(ScheduledMaintenanceService, scheduledMaintenance);
      asMock(
        ScheduledMaintenancePublicNoteService.findAllBy,
      ).mockImplementation(dueWhileNotTaken(scheduledMaintenanceNote));
      // Read again only while it is published, as the job asks.
      asMock(
        ScheduledMaintenancePublicNoteService.findOneBy,
      ).mockImplementation(async (data: { query: JSONObject }) => {
        return world.exists &&
          world.isPublished &&
          data.query["isPublished"] === true
          ? scheduledMaintenanceNote()
          : null;
      });
      asMock(
        ScheduledMaintenancePublicNoteService.updateOneById,
      ).mockImplementation(takeOrStop);
    },
  },
  {
    title: "a private note posted on a scheduled maintenance event",
    jobName: "ScheduledMaintenanceOwner:SendsNotePostedEmail",
    kind: OwnerNotificationKind.ScheduledMaintenanceInternalNotePosted,
    resourceId: RESOURCE_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: scheduledMaintenanceFeed,
    feedService:
      ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem,
    arrange: (): void => {
      arrangeRecord(ScheduledMaintenanceService, scheduledMaintenance);
      arrangeDue(
        ScheduledMaintenanceInternalNoteService,
        scheduledMaintenanceNote,
      );
    },
  },
  ownerAddedCase({
    title: "a team added as the owner of a scheduled maintenance event",
    jobName: "ScheduledMaintenanceOwner:SendOwnerAddedEmail",
    kind: OwnerNotificationKind.ScheduledMaintenanceOwnerAdded,
    recordService: ScheduledMaintenanceService,
    teamService: ScheduledMaintenanceOwnerTeamService,
    recordIdField: "scheduledMaintenanceId",
    record: scheduledMaintenance,
  }),
  {
    title: "a reminder that a scheduled maintenance event is still open",
    jobName: "ScheduledMaintenanceOwner:SendUnresolvedReminderNotification",
    kind: OwnerNotificationKind.ScheduledMaintenanceReminder,
    resourceId: RESOURCE_ID,
    eventId: RESOURCE_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: scheduledMaintenanceFeed,
    feedService:
      ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem,
    arrange: (): void => {
      asMock(ScheduledMaintenanceService.findAllBy).mockImplementation(
        dueWhileNotTaken(scheduledMaintenance),
      );
      arrangeRecord(ScheduledMaintenanceService, scheduledMaintenance);
      asMock(ScheduledMaintenanceService.updateOneById).mockImplementation(
        async (data: { data: JSONObject }) => {
          // Moving the reminder on is the take; stopping it is not.
          if (data.data["nextReminderNotificationAt"] !== null) {
            await takeOrStop();
          }
        },
      );
      asMock(
        ScheduledMaintenanceReminderRuleService.findMatchingRule,
      ).mockResolvedValue({
        reminderIntervalInMinutes: 30,
        remindWhileScheduled: true,
      });
    },
  },
  {
    title: "a status page's Created notification",
    jobName: "StatusPageOwner:SendCreatedResourceEmail",
    kind: OwnerNotificationKind.StatusPageCreated,
    resourceId: RESOURCE_ID,
    eventId: RESOURCE_ID,
    occurrence: 1,
    namesWhomItReached: false,
    feedItems: () => {
      return [];
    },
    arrange: (): void => {
      arrangeDue(StatusPageService, statusPage);
    },
  },
  {
    title: "an announcement posted on a status page",
    jobName: "StatusPageOwner:SendAnnouncementCreatedEmail",
    kind: OwnerNotificationKind.StatusPageAnnouncementCreated,
    // One notification per announcement, whichever of its pages they own.
    resourceId: EVENT_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: false,
    feedItems: () => {
      return [];
    },
    arrange: (): void => {
      arrangeDue(StatusPageAnnouncementService, (): PlainRecord => {
        return plain({
          id: EVENT_ID,
          projectId: PROJECT_ID,
          title: "Planned work tonight",
          description: "From 22:00 UTC",
          statusPages: [statusPage()],
        });
      });
    },
  },
  ownerAddedCase({
    title: "a team added as the owner of a status page",
    jobName: "StatusPageOwner:SendOwnerAddedEmail",
    kind: OwnerNotificationKind.StatusPageOwnerAdded,
    recordService: StatusPageService,
    teamService: StatusPageOwnerTeamService,
    recordIdField: "statusPageId",
    record: statusPage,
  }),
  ownerAddedCase({
    title: "a team added as the owner of an SLO",
    jobName: "SloOwners:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.ServiceLevelObjectiveOwnerAdded,
    recordService: ServiceLevelObjectiveService,
    teamService: ServiceLevelObjectiveOwnerTeamService,
    recordIdField: "serviceLevelObjectiveId",
    record: serviceLevelObjective,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a network device",
    jobName: "NetworkDeviceOwner:SendOwnerAddedEmail",
    kind: OwnerNotificationKind.NetworkDeviceOwnerAdded,
    recordService: NetworkDeviceService,
    teamService: NetworkDeviceOwnerTeamService,
    recordIdField: "networkDeviceId",
    record: networkDevice,
  }),
];

describe.each([...CASES, ...EVERY_RESOURCE_CASES])(
  "$title",
  (jobCase: JobCase) => {
    let table: InMemoryOwnerNotificationDeliveries;
    let now: Date;

    function runJob(): Promise<void> {
      const handler: CronHandler | undefined =
        mockCapturedJobs[jobCase.jobName];

      if (!handler) {
        throw new Error(`${jobCase.jobName} registered no cron handler.`);
      }

      return handler();
    }

    // Waits until a run started without waiting for it has stopped `count` times.
    async function untilStopped(count: number = 1): Promise<void> {
      for (let turn: number = 0; turn < 2000; turn++) {
        if (table.stops() + world.stoppedAt.length >= count) {
          return;
        }

        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });
      }

      throw new Error("The run never reached the point it was to stop at.");
    }

    // The worker is started again: the next run, some minutes on.
    async function restartedMinutesLater(minutes: number): Promise<void> {
      now = new Date(now.getTime() + minutes * 60 * 1000);
      await runJob();
    }

    function statuses(): Record<string, OwnerNotificationDeliveryStatus> {
      return table.statusesOf(jobCase.eventId, jobCase.occurrence);
    }

    // Each owner the job sent this record's notification to, and how often.
    function sendsByOwner(): Record<string, number> {
      const sends: Record<string, number> = {};

      for (const userId of world.sent) {
        sends[userId] = (sends[userId] || 0) + 1;
      }

      return sends;
    }

    function everyOwnerOnce(): Record<string, number> {
      return {
        [idOf(OWNER_1)]: 1,
        [idOf(OWNER_2)]: 1,
        [idOf(OWNER_3)]: 1,
      };
    }

    beforeEach(() => {
      jest.clearAllMocks();

      table = useInMemoryOwnerNotificationDeliveries();
      now = START;

      world = {
        owners: [...OWNERS],
        exists: true,
        isTaken: false,
        takes: 0,
        isResolved: false,
        isPublished: true,
        takeStops: false,
        sendStopsFor: null,
        sendGate: null,
        sendFailsFor: null,
        sent: [],
        stoppedAt: [],
      };

      jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
        return new Date(now.getTime());
      });

      // Nothing else is due, for any job.
      for (const service of [
        IncidentStateTimelineService,
        AlertStateTimelineService,
        IncidentPublicNoteService,
        IncidentInternalNoteService,
        AlertInternalNoteService,
        IncidentOwnerTeamService,
        IncidentOwnerUserService,
        AlertOwnerTeamService,
        AlertOwnerUserService,
        IncidentService,
        AlertService,
      ]) {
        asMock(service.findAllBy).mockResolvedValue([]);
      }

      for (const service of EVERY_RESOURCE_SERVICES) {
        const each: Record<string, unknown> = service as unknown as Record<
          string,
          unknown
        >;

        asMock(each["findAllBy"]).mockResolvedValue([]);
        asMock(each["findBy"]).mockResolvedValue([]);
        asMock(each["findOneBy"]).mockResolvedValue(null);
        asMock(each["findOneById"]).mockResolvedValue(null);
        asMock(each["updateOneById"]).mockResolvedValue(undefined);
        asMock(each["findOwners"]).mockImplementation(async () => {
          return world.owners;
        });
        asMock(each["isScheduledMaintenanceCompleted"]).mockImplementation(
          async () => {
            return world.isResolved;
          },
        );
        asMock(each["isScheduledMaintenanceOngoing"]).mockResolvedValue(false);
        asMock(each["getMonitorDestinationInfo"]).mockReturnValue({
          monitorDestination: "",
          requestType: "",
          monitorType: "",
        });

        for (const link of [
          "getEpisodeLinkInDashboard",
          "getMonitorLinkInDashboard",
          "getScheduledMaintenanceLinkInDashboard",
          "getStatusPageLinkInDashboard",
          "getSloLinkInDashboard",
        ]) {
          asMock(each[link]).mockResolvedValue("https://oneuptime.test/record");
        }

        for (const feed of [
          "createIncidentEpisodeFeedItem",
          "createAlertEpisodeFeedItem",
          "createScheduledMaintenanceFeedItem",
        ]) {
          asMock(each[feed]).mockResolvedValue(undefined);
        }
      }

      asMock(IncidentService.findBy).mockResolvedValue([]);
      asMock(AlertService.findBy).mockResolvedValue([]);
      asMock(
        UserNotificationSettingService.ensureSettingExistsForUser,
      ).mockResolvedValue(undefined);

      asMock(IncidentService.findCreatedNotificationsDue).mockResolvedValue([]);
      asMock(AlertService.findCreatedNotificationsDue).mockResolvedValue([]);
      asMock(IncidentService.getIncidentLinkInDashboard).mockResolvedValue(
        "https://oneuptime.test/incident",
      );
      asMock(AlertService.getAlertLinkInDashboard).mockResolvedValue(
        "https://oneuptime.test/alert",
      );
      asMock(IncidentService.getIncidentIdentifiedDate).mockResolvedValue(
        START,
      );
      asMock(AlertService.getAlertIdentifiedDate).mockResolvedValue(START);
      asMock(IncidentService.isIncidentResolved).mockImplementation(
        async () => {
          return world.isResolved;
        },
      );
      asMock(AlertService.isAlertResolved).mockImplementation(async () => {
        return world.isResolved;
      });
      asMock(IncidentService.isIncidentAcknowledged).mockResolvedValue(false);
      asMock(AlertService.isAlertAcknowledged).mockResolvedValue(false);

      asMock(ProjectService.getOwners).mockResolvedValue([]);
      asMock(TeamMemberService.getUsersInTeams).mockImplementation(async () => {
        return world.owners;
      });
      asMock(TeamMemberService.filterUsersToProjectMembers).mockImplementation(
        async (data: { users: Array<User> }) => {
          return data.users;
        },
      );

      asMock(UserService.findBy).mockImplementation(
        async (data: { query: JSONObject }) => {
          return usersNamedBy(OWNERS, data.query);
        },
      );
      asMock(UserService.getUserMarkdownString).mockImplementation(
        async (data: { userId: ObjectID }) => {
          return `Owner ${data.userId.toString()}`;
        },
      );

      asMock(
        UserNotificationSettingService.sendUserNotification,
      ).mockImplementation(async (data: { userId: ObjectID }) => {
        const userId: string = data.userId.toString();

        world.sent.push(userId);

        if (world.sendFailsFor === userId) {
          throw new Error("smtp connection reset");
        }

        if (world.sendStopsFor === userId) {
          world.sendStopsFor = null;
          world.stoppedAt.push(`send ${userId}`);
          await (world.sendGate || NEVER);
        }
      });

      asMock(IncidentFeedService.createIncidentFeedItem).mockResolvedValue(
        undefined,
      );
      asMock(AlertFeedService.createAlertFeedItem).mockResolvedValue(undefined);

      jobCase.arrange();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("with no stop, tells each owner once, and the next run nobody", async () => {
      await runJob();

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(world.takes).toBe(1);
      expect(Object.values(statuses())).toEqual([
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
      ]);

      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );
      await restartedMinutesLater(60);

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(world.takes).toBe(1);

      if (jobCase.namesWhomItReached) {
        expect(jobCase.feedItems()).toHaveLength(1);
      }
    });

    test("whom it is to tell is written down before the record is taken", async () => {
      world.takeStops = true;
      void runJob();
      await untilStopped();

      expect(world.stoppedAt).toEqual(["take"]);
      expect(Object.values(statuses())).toEqual([
        OwnerNotificationDeliveryStatus.Pending,
        OwnerNotificationDeliveryStatus.Pending,
        OwnerNotificationDeliveryStatus.Pending,
      ]);
      expect(world.sent).toEqual([]);
    });

    test("stopped before an owner's send: that owner and the ones after are told by the next run, each once", async () => {
      table.stopAt({ statement: "startTelling", userId: idOf(OWNER_2) });

      void runJob();
      await untilStopped();

      expect(world.sent).toEqual([idOf(OWNER_1)]);
      expect(world.isTaken).toBe(true);
      expect(statuses()).toEqual({
        [idOf(OWNER_1)]: OwnerNotificationDeliveryStatus.Sent,
        [idOf(OWNER_2)]: OwnerNotificationDeliveryStatus.Pending,
        [idOf(OWNER_3)]: OwnerNotificationDeliveryStatus.Pending,
      });

      // Too soon: the run that stopped might still be going.
      await restartedMinutesLater(1);
      expect(world.sent).toEqual([idOf(OWNER_1)]);

      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(world.takes).toBe(1);
      expect(Object.values(statuses())).toEqual([
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
      ]);

      if (jobCase.namesWhomItReached) {
        // One feed item, by the run that finished, naming everyone it reached.
        const items: Array<{ moreInformationInMarkdown: string }> =
          jobCase.feedItems();
        expect(items).toHaveLength(1);

        for (const owner of OWNERS) {
          expect([
            idOf(owner),
            namesOwner(items[0]!.moreInformationInMarkdown, owner),
          ]).toEqual([idOf(owner), true]);
        }
      }

      // And no run after it tells anyone again.
      await restartedMinutesLater(30);
      expect(sendsByOwner()).toEqual(everyOwnerOnce());
    });

    test("stopped during an owner's send: that owner is never told again - nobody knows whether it went out - and the ones after are", async () => {
      world.sendStopsFor = idOf(OWNER_2);

      void runJob();
      await untilStopped();

      expect(world.sent).toEqual([idOf(OWNER_1), idOf(OWNER_2)]);
      expect(statuses()).toEqual({
        [idOf(OWNER_1)]: OwnerNotificationDeliveryStatus.Sent,
        [idOf(OWNER_2)]: OwnerNotificationDeliveryStatus.Sending,
        [idOf(OWNER_3)]: OwnerNotificationDeliveryStatus.Pending,
      });

      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(statuses()).toEqual({
        [idOf(OWNER_1)]: OwnerNotificationDeliveryStatus.Sent,
        [idOf(OWNER_2)]: OwnerNotificationDeliveryStatus.Sending,
        [idOf(OWNER_3)]: OwnerNotificationDeliveryStatus.Sent,
      });
      expect(
        asMock(logger.warn).mock.calls.some((call: Array<unknown>): boolean => {
          return String(call[0]).includes(
            "1 owner(s) were being told as it stopped",
          );
        }),
      ).toBe(true);
    });

    test("stopped after an owner's send, before it was recorded: that owner is not told again, the ones after are", async () => {
      table.stopAt({ statement: "finishTelling", userId: idOf(OWNER_2) });

      void runJob();
      await untilStopped();

      expect(world.sent).toEqual([idOf(OWNER_1), idOf(OWNER_2)]);
      expect(statuses()[idOf(OWNER_2)]).toBe(
        OwnerNotificationDeliveryStatus.Sending,
      );

      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
    });

    test("stopped once an owner's send was recorded: the ones after are told by the next run", async () => {
      table.stopAt({
        statement: "finishTelling",
        userId: idOf(OWNER_2),
        when: "after",
      });

      void runJob();
      await untilStopped();

      expect(statuses()).toEqual({
        [idOf(OWNER_1)]: OwnerNotificationDeliveryStatus.Sent,
        [idOf(OWNER_2)]: OwnerNotificationDeliveryStatus.Sent,
        [idOf(OWNER_3)]: OwnerNotificationDeliveryStatus.Pending,
      });

      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
    });

    test("stopped after the last owner was told: nobody is told again", async () => {
      table.stopAt({
        statement: "finishTelling",
        userId: idOf(OWNER_3),
        when: "after",
      });

      void runJob();
      await untilStopped();

      expect(sendsByOwner()).toEqual(everyOwnerOnce());

      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );
      await restartedMinutesLater(30);

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(world.takes).toBe(1);

      if (!jobCase.namesWhomItReached) {
        expect(jobCase.feedItems()).toEqual([]);
        return;
      }

      /*
       * The feed item the stopped run had still to write is written by the
       * next run, once, naming every owner the stopped run told (#8510).
       */
      expect(jobCase.feedItems()).toHaveLength(1);

      for (const owner of OWNERS) {
        expect([
          idOf(owner),
          namesOwner(jobCase.feedItems()[0]!.moreInformationInMarkdown, owner),
        ]).toEqual([idOf(owner), true]);
      }

      expect(table.feedStatusOf(jobCase.eventId, jobCase.occurrence)).toBe(
        OwnerNotificationFeedStatus.Written,
      );
    });

    test("stopped after the last owner was told, before the feed item: a later run writes it once, naming every owner told", async () => {
      if (!jobCase.namesWhomItReached) {
        return;
      }

      // The worker is killed as it writes the feed item.
      asMock(jobCase.feedService).mockImplementationOnce(async () => {
        world.stoppedAt.push("feed");
        await NEVER;
      });

      void runJob();
      await untilStopped();

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(table.feedStatusOf(jobCase.eventId, jobCase.occurrence)).toBe(
        OwnerNotificationFeedStatus.Pending,
      );

      // A run a moment later leaves it: the stopped run may still be at it.
      await restartedMinutesLater(1);
      expect(jobCase.feedItems()).toHaveLength(1);

      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );
      await restartedMinutesLater(30);

      // The call the stopped run never finished, and the later run's.
      expect(jobCase.feedItems()).toHaveLength(2);
      for (const owner of OWNERS) {
        expect([
          idOf(owner),
          namesOwner(jobCase.feedItems()[1]!.moreInformationInMarkdown, owner),
        ]).toEqual([idOf(owner), true]);
      }
      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(world.takes).toBe(1);
      expect(table.feedStatusOf(jobCase.eventId, jobCase.occurrence)).toBe(
        OwnerNotificationFeedStatus.Written,
      );
    });

    test("a feed item that fails to write is written by a later run, and given up after three runs set out", async () => {
      if (!jobCase.namesWhomItReached) {
        return;
      }

      asMock(jobCase.feedService).mockRejectedValue(
        new Error("the feed refused it"),
      );

      await runJob();
      expect(sendsByOwner()).toEqual(everyOwnerOnce());

      for (let run: number = 0; run < 5; run++) {
        await restartedMinutesLater(
          OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
        );
      }

      // The run that told them, and the two more a notification is given.
      expect(asMock(jobCase.feedService).mock.calls).toHaveLength(
        OwnerNotificationDeliveries.ATTEMPTS_AT_MOST,
      );
      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(table.feedStatusOf(jobCase.eventId, jobCase.occurrence)).toBe(
        OwnerNotificationFeedStatus.NotWritten,
      );
    });

    test("two workers taking up the feed item a stopped run left unwritten write it once between them", async () => {
      if (!jobCase.namesWhomItReached) {
        return;
      }

      asMock(jobCase.feedService).mockImplementationOnce(async () => {
        world.stoppedAt.push("feed");
        await NEVER;
      });

      void runJob();
      await untilStopped();

      now = new Date(
        now.getTime() +
          OwnerNotificationDeliveries.RESUME_AFTER_MINUTES * 60 * 1000,
      );
      table.interleave(true);
      await Promise.all([runJob(), runJob()]);
      table.interleave(false);

      // The stopped run's unfinished call, and one more.
      expect(jobCase.feedItems()).toHaveLength(2);
      expect(sendsByOwner()).toEqual(everyOwnerOnce());
    });

    test("stopped before the take: the next run tells each owner once, and takes the record once", async () => {
      world.takeStops = true;

      void runJob();
      await untilStopped();

      expect(world.sent).toEqual([]);
      expect(world.isTaken).toBe(false);

      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(world.takes).toBe(1);

      if (jobCase.namesWhomItReached) {
        expect(jobCase.feedItems()).toHaveLength(1);
      }

      await restartedMinutesLater(30);
      expect(sendsByOwner()).toEqual(everyOwnerOnce());
    });

    test("stopped while writing down whom it is to tell: the record is read again, and each owner told once", async () => {
      table.stopAt({ statement: "writeOwnersToTell" });

      void runJob();
      await untilStopped();

      expect(table.rows).toEqual([]);
      expect(world.isTaken).toBe(false);

      await restartedMinutesLater(1);

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(world.takes).toBe(1);
    });

    test("two workers at once tell each owner once between them", async () => {
      table.interleave(true);

      await Promise.all([runJob(), runJob()]);

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(Object.values(statuses())).toEqual([
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
      ]);

      if (jobCase.namesWhomItReached) {
        expect(jobCase.feedItems().length).toBeGreaterThanOrEqual(1);
        expect(jobCase.feedItems().length).toBeLessThanOrEqual(2);
      }

      // Nor does a run after them.
      table.interleave(false);
      await restartedMinutesLater(30);
      expect(sendsByOwner()).toEqual(everyOwnerOnce());
    });

    test("a worker that lost its lock and goes on beside the next run: each owner told once", async () => {
      let release: () => void = (): void => {
        // set below
      };
      world.sendGate = new Promise<void>((resolve: () => void) => {
        release = resolve;
      });
      world.sendStopsFor = idOf(OWNER_2);

      // The first worker stands still in the second owner's send.
      const first: Promise<void> = runJob();
      await untilStopped();

      // Minutes later the next run starts, while the first still holds the second owner.
      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );

      expect(sendsByOwner()).toEqual(everyOwnerOnce());

      // The first goes on: the third owner is told already.
      release();
      await first;

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(Object.values(statuses())).toEqual([
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
      ]);
    });

    test("a worker stopped every time it sets out gives up after three runs, and tells nobody twice", async () => {
      table.stopAt({ statement: "startTelling", userId: idOf(OWNER_1) });
      void runJob();
      await untilStopped(1);

      for (
        let attempt: number = 2;
        attempt <= OwnerNotificationDeliveries.ATTEMPTS_AT_MOST;
        attempt++
      ) {
        table.stopAt({ statement: "startTelling", userId: idOf(OWNER_1) });
        now = new Date(
          now.getTime() +
            OwnerNotificationDeliveries.RESUME_AFTER_MINUTES * 60 * 1000,
        );
        void runJob();
        await untilStopped(attempt);
      }

      expect(world.sent).toEqual([]);

      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );

      expect(world.sent).toEqual([]);
      expect(Object.values(statuses())).toEqual([
        OwnerNotificationDeliveryStatus.Failed,
        OwnerNotificationDeliveryStatus.Failed,
        OwnerNotificationDeliveryStatus.Failed,
      ]);
      expect(
        asMock(logger.error).mock.calls.some(
          (call: Array<unknown>): boolean => {
            return String(call[0]).startsWith("Gave up telling 3 owner(s)");
          },
        ),
      ).toBe(true);
      expect(world.takes).toBe(1);
    });

    test("an owner whose send fails is not told again, and the others are told once", async () => {
      world.sendFailsFor = idOf(OWNER_2);

      await runJob();
      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(statuses()).toEqual({
        [idOf(OWNER_1)]: OwnerNotificationDeliveryStatus.Sent,
        [idOf(OWNER_2)]: OwnerNotificationDeliveryStatus.Failed,
        [idOf(OWNER_3)]: OwnerNotificationDeliveryStatus.Sent,
      });
    });

    test("a record gone before the next run takes its owners up: nobody else is told", async () => {
      table.stopAt({ statement: "startTelling", userId: idOf(OWNER_2) });
      void runJob();
      await untilStopped();

      world.exists = false;
      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );

      expect(world.sent).toEqual([idOf(OWNER_1)]);
      expect(statuses()).toEqual({
        [idOf(OWNER_1)]: OwnerNotificationDeliveryStatus.Sent,
        [idOf(OWNER_2)]: OwnerNotificationDeliveryStatus.Failed,
        [idOf(OWNER_3)]: OwnerNotificationDeliveryStatus.Failed,
      });
    });

    if (
      jobCase.kind === OwnerNotificationKind.IncidentPublicNotePosted ||
      jobCase.kind ===
        OwnerNotificationKind.ScheduledMaintenancePublicNotePosted
    ) {
      test("a public note no longer published when the next run takes its owners up: nobody else is told", async () => {
        table.stopAt({ statement: "startTelling", userId: idOf(OWNER_2) });
        void runJob();
        await untilStopped();

        world.isPublished = false;
        await restartedMinutesLater(
          OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
        );

        expect(world.sent).toEqual([idOf(OWNER_1)]);
        expect(statuses()).toEqual({
          [idOf(OWNER_1)]: OwnerNotificationDeliveryStatus.Sent,
          [idOf(OWNER_2)]: OwnerNotificationDeliveryStatus.Failed,
          [idOf(OWNER_3)]: OwnerNotificationDeliveryStatus.Failed,
        });
      });
    }

    if (
      jobCase.kind === OwnerNotificationKind.IncidentReminder ||
      jobCase.kind === OwnerNotificationKind.AlertReminder ||
      jobCase.kind === OwnerNotificationKind.ScheduledMaintenanceReminder
    ) {
      test("a reminder taken up late, of a record resolved since, is not sent", async () => {
        table.stopAt({ statement: "startTelling", userId: idOf(OWNER_2) });
        void runJob();
        await untilStopped();

        world.isResolved = true;
        await restartedMinutesLater(
          OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
        );

        expect(world.sent).toEqual([idOf(OWNER_1)]);
        expect(statuses()[idOf(OWNER_3)]).toBe(
          OwnerNotificationDeliveryStatus.Failed,
        );
      });
    }

    if (
      jobCase.kind === OwnerNotificationKind.IncidentReminder ||
      jobCase.kind === OwnerNotificationKind.AlertReminder
    ) {
      test("the next reminder is another notification: told again, once", async () => {
        await runJob();

        // Half an hour on, the reminder is due again.
        world.isTaken = false;
        now = new Date(now.getTime() + 30 * 60 * 1000);

        const findAllBy: unknown =
          jobCase.kind === OwnerNotificationKind.IncidentReminder
            ? IncidentService.findAllBy
            : AlertService.findAllBy;

        asMock(findAllBy).mockImplementation(async () => {
          if (world.isTaken) {
            return [];
          }

          const record: Incident | Alert =
            jobCase.kind === OwnerNotificationKind.IncidentReminder
              ? incident()
              : alert();
          record.reminderNotificationSentCount = 1;
          return [record];
        });

        await runJob();

        expect(sendsByOwner()).toEqual({
          [idOf(OWNER_1)]: 2,
          [idOf(OWNER_2)]: 2,
          [idOf(OWNER_3)]: 2,
        });
        expect(Object.values(table.statusesOf(jobCase.eventId, 2))).toEqual([
          OwnerNotificationDeliveryStatus.Sent,
          OwnerNotificationDeliveryStatus.Sent,
          OwnerNotificationDeliveryStatus.Sent,
        ]);
      });
    }
  },
);

describe("the owners of an owner row", () => {
  test("a person a team row and a user row both added to an incident in the same run is told once", async () => {
    jest.clearAllMocks();
    useInMemoryOwnerNotificationDeliveries();

    const sent: Array<string> = [];

    asMock(IncidentService.findOneById).mockImplementation(async () => {
      return incident();
    });
    asMock(IncidentService.getIncidentLinkInDashboard).mockResolvedValue(
      "https://oneuptime.test/incident",
    );

    const teamRow: IncidentOwnerTeam = new IncidentOwnerTeam(EVENT_ID);
    teamRow.incidentId = INCIDENT_ID;
    teamRow.teamId = new ObjectID("aaaaaaaa-0000-4000-8000-0000000000c1");

    const userRow: { id: ObjectID; incidentId: ObjectID; user: User } = {
      id: new ObjectID("aaaaaaaa-0000-4000-8000-0000000000e2"),
      incidentId: INCIDENT_ID,
      user: OWNER_1,
    };

    asMock(IncidentOwnerTeamService.findAllBy).mockResolvedValue([teamRow]);
    asMock(IncidentOwnerUserService.findAllBy).mockResolvedValue([userRow]);
    asMock(IncidentOwnerTeamService.updateOneById).mockResolvedValue(undefined);
    asMock(IncidentOwnerUserService.updateOneById).mockResolvedValue(undefined);
    asMock(TeamMemberService.getUsersInTeams).mockResolvedValue([
      OWNER_1,
      OWNER_2,
    ]);
    asMock(TeamMemberService.filterUsersToProjectMembers).mockImplementation(
      async (data: { users: Array<User> }) => {
        return data.users;
      },
    );
    asMock(
      UserNotificationSettingService.sendUserNotification,
    ).mockImplementation(async (data: { userId: ObjectID }) => {
      sent.push(data.userId.toString());
    });

    await mockCapturedJobs["IncidentOwner:SendOwnerAddedEmail"]!();

    expect(sent.sort()).toEqual([idOf(OWNER_1), idOf(OWNER_2)].sort());

    // Both rows are marked, so neither is read again.
    expect(IncidentOwnerTeamService.updateOneById).toHaveBeenCalledTimes(1);
    expect(IncidentOwnerUserService.updateOneById).toHaveBeenCalledTimes(1);

    jest.restoreAllMocks();
  });
});
