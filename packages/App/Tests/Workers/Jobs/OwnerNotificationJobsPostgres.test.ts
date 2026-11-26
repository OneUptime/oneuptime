import Entities from "Common/Models/DatabaseModels/Index";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
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
import { usersNamedBy } from "Common/Tests/Helpers/InMemoryOwnerNotificationDeliveries";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "Common/node_modules/typeorm";

/*
 * THE OWNER NOTIFICATION JOBS, STOPPED AND STARTED AGAIN, ON A REAL
 * POSTGRES (issue #8199).
 *
 * OwnerNotificationJobsSurviveAStop runs every incident and alert owner
 * job through its crash points on the delivery table held in memory. Here
 * three of them - the Created job, whose take is one compare-and-set; the
 * state change job, whose take is a plain mark; the reminder job, whose
 * take moves the reminder on and whose every reminder is a notification of
 * its own - run on the real OwnerNotificationDeliveryService against a copy
 * of the migrated OwnerNotificationDelivery table: stopped before an
 * owner's send, during it, and before the take, then started again; two
 * workers at once, on connections of their own; and a worker that lost its
 * lock going on beside the next run. Each owner is told once.
 *
 * The services the jobs read their records and owners through stand in for
 * the rest of the database, as in the in-memory suite. Opt in with
 * RUN_POSTGRES_OWNER_NOTIFICATION_JOB_TESTS=true and a migrated database
 * (OWNER_NOTIFICATION_JOB_TEST_DATABASE_HOST, _PORT, _NAME;
 * DATABASE_USERNAME, DATABASE_PASSWORD). Every write is to a schema of its
 * own; only the table's structure is copied, never its rows.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_OWNER_NOTIFICATION_JOB_TESTS"] === "true"
    ? describe
    : describe.skip;

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
      compareAndSetColumnsByIdWithoutHooks: jest.fn(),
      onTriggerWorkflow: jest.fn(),
      isIncidentResolved: jest.fn(),
      isIncidentAcknowledged: jest.fn(),
    },
  };
});

// A service with every read and write the three jobs of other resources make.
function mockAnyService(): unknown {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      findBy: jest.fn(),
      findOneById: jest.fn(),
      findOneBy: jest.fn(),
      updateOneById: jest.fn(),
      compareAndSetColumnsByIdWithoutHooks: jest.fn(),
      findOwners: jest.fn(),
      getMonitorLinkInDashboard: jest.fn(),
      getMonitorDestinationInfo: jest.fn(),
      getScheduledMaintenanceLinkInDashboard: jest.fn(),
      getStatusPageLinkInDashboard: jest.fn(),
      createScheduledMaintenanceFeedItem: jest.fn(),
      getUsersInTeams: jest.fn(),
      filterUsersToProjectMembers: jest.fn(),
    },
  };
}

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
jest.mock("Common/Server/Services/ScheduledMaintenanceFeedService", () => {
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
jest.mock("Common/Server/Services/StatusPageService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/StatusPageOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/StatusPageOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/TeamMemberService", () => {
  return mockAnyService();
});

jest.mock("Common/Server/Services/IncidentStateTimelineService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      findBy: jest.fn(),
      findOneById: jest.fn(),
      findOneBy: jest.fn(),
      updateOneById: jest.fn(),
      compareAndSetColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentStateService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/IncidentReminderRuleService", () => {
  return {
    __esModule: true,
    default: { findMatchingRule: jest.fn() },
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
    default: { sendUserNotification: jest.fn() },
  };
});

jest.mock("Common/Server/Services/IncidentFeedService", () => {
  return {
    __esModule: true,
    default: { createIncidentFeedItem: jest.fn() },
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
        getText: jest.fn((data: { fallback: string }) => {
          return data.fallback;
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
      createIncidentStateChangedNotification: jest.fn(() => {
        return {};
      }),
      createGenericNotification: jest.fn(() => {
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

/*
 * The notifications on-call pages sent, which the Created job reads to leave
 * out an owner the incident's page reached already (#7987): nobody was paged
 * here, so every owner is told, as the delivery table's stops are about.
 */
jest.mock("Common/Server/Services/UserOnCallLogTimelineService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(async () => {
        return [];
      }),
    },
  };
});

import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import IncidentReminderRuleService from "Common/Server/Services/IncidentReminderRuleService";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateTimelineService from "Common/Server/Services/IncidentStateTimelineService";
import OwnerNotificationDeliveryService from "Common/Server/Services/OwnerNotificationDeliveryService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import UserService from "Common/Server/Services/UserService";
import OwnerNotificationDeliveries from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";

// Imported for their side effect: RunCron (mocked above) records each handler.
import "../../../FeatureSet/Workers/Jobs/IncidentOwners/SendCreatedResourceNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentOwners/SendStateChangeNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentOwners/SendUnresolvedReminderNotification";
import "../../../FeatureSet/Workers/Jobs/ScheduledMaintenanceOwners/SendStateChangeNotification";
import "../../../FeatureSet/Workers/Jobs/MonitorOwners/SendStatusChangeNotification";
import "../../../FeatureSet/Workers/Jobs/StatusPageOwners/SendOwnerAddedNotification";
import ScheduledMaintenanceStateTimelineService from "Common/Server/Services/ScheduledMaintenanceStateTimelineService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import MonitorStatusTimelineService from "Common/Server/Services/MonitorStatusTimelineService";
import MonitorService from "Common/Server/Services/MonitorService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import StatusPageOwnerTeamService from "Common/Server/Services/StatusPageOwnerTeamService";
import StatusPageOwnerUserService from "Common/Server/Services/StatusPageOwnerUserService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";

type AnyMock = jest.Mock;

function asMock(fn: unknown): AnyMock {
  return fn as AnyMock;
}

const NEVER: Promise<never> = new Promise<never>(() => {
  // a stopped worker hears nothing back
});

interface World {
  incidentId: ObjectID;
  eventId: ObjectID;
  owners: Array<User>;
  isTaken: boolean;
  takes: number;
  takeStops: boolean;
  sendStopsFor: string | null;
  sendGate: Promise<void> | null;
  startTellingStopsFor: string | null;
  sent: Array<string>;
  stoppedAt: Array<string>;
}

let world: World;

interface JobCase {
  title: string;
  jobName: string;
  kind: OwnerNotificationKind;
  // The record is the notification: a Created, a reminder.
  eventIdIsTheIncident: boolean;
  arrange: () => void;
  // The feed's create, for the jobs that write a feed item (#8510).
  feedService?: () => unknown;
  // The line that feed item names an owner it told with.
  feedLineOf?: (owner: User) => string;
}

/*
 * An owner named in a feed item by UserService.getUserMarkdownString, as
 * it is stood in for below.
 */
function feedLineByUserMarkdown(owner: User): string {
  return `- Owner ${owner.id!.toString()}\n`;
}

// The record the other resources' cases tell of, as the job reads it.
function plain(fields: Record<string, unknown>): Record<string, unknown> {
  const id: ObjectID | undefined = fields["id"] as ObjectID | undefined;
  return { ...(id ? { _id: id.toString() } : {}), ...fields };
}

function scheduledMaintenance(): Record<string, unknown> {
  return plain({
    id: world.incidentId,
    projectId: PROJECT_ID,
    project: { name: "Acme" },
    title: "Database upgrade",
    description: "Postgres 16",
    scheduledMaintenanceNumber: 4,
  });
}

function monitor(): Record<string, unknown> {
  return plain({
    id: world.incidentId,
    projectId: PROJECT_ID,
    project: { name: "Acme" },
    name: "Checkout API",
    description: "The checkout endpoint",
  });
}

function incident(): Incident {
  const record: Incident = new Incident(world.incidentId);
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

function timeline(): IncidentStateTimeline {
  const record: IncidentStateTimeline = new IncidentStateTimeline(
    world.eventId,
  );
  record.projectId = PROJECT_ID;
  record.incidentId = world.incidentId;
  record.createdAt = START;
  const project: Project = new Project();
  project.name = "Acme";
  record.project = project;
  const state: IncidentState = new IncidentState();
  state.name = "Resolved";
  record.incidentState = state;
  return record;
}

/*
 * A reminder's move (OwnerReminderBacklog, #9019): sending it - the next
 * one later, counted - is the take, one compare-and-set only the first run
 * to make it wins; taking the reminders away is not.
 */
async function reminderMove(data: { data: JSONObject }): Promise<boolean> {
  if (data.data["nextReminderNotificationAt"] === null) {
    return true;
  }

  return await compareAndSetTake();
}

/*
 * The state change jobs' take (OwnerNotificationBacklog, #7974): one
 * compare-and-set, which only the first run to make it wins.
 */
async function compareAndSetTake(): Promise<boolean> {
  if (world.takeStops) {
    world.takeStops = false;
    world.stoppedAt.push("take");
    return await NEVER;
  }

  if (world.isTaken) {
    return false;
  }

  world.isTaken = true;
  world.takes++;
  return true;
}

const PROJECT_ID: ObjectID = ObjectID.generate();
const START: Date = new Date();

const CASES: Array<JobCase> = [
  {
    title: "an incident's Created notification",
    jobName: "IncidentOwner:SendCreatedResourceEmail",
    kind: OwnerNotificationKind.IncidentCreated,
    eventIdIsTheIncident: true,
    feedService: () => {
      return IncidentFeedService.createIncidentFeedItem;
    },
    // By name, never by address: the feed is read beyond the project (#10669).
    feedLineOf: (owner: User): string => {
      return `- ${owner.name!.toString()}\n`;
    },
    arrange: (): void => {
      asMock(IncidentService.findCreatedNotificationsDue).mockImplementation(
        async () => {
          return world.isTaken ? [] : [incident()];
        },
      );
      asMock(IncidentService.takeCreatedNotification).mockImplementation(
        async (): Promise<boolean> => {
          if (world.takeStops) {
            world.takeStops = false;
            world.stoppedAt.push("take");
            return await NEVER;
          }

          if (world.isTaken) {
            return false;
          }

          world.isTaken = true;
          world.takes++;
          return true;
        },
      );
    },
  },
  {
    title: "an incident's state change",
    jobName: "IncidentOwner:SendStateChangeEmail",
    kind: OwnerNotificationKind.IncidentStateChanged,
    eventIdIsTheIncident: false,
    feedService: () => {
      return IncidentFeedService.createIncidentFeedItem;
    },
    feedLineOf: feedLineByUserMarkdown,
    arrange: (): void => {
      // Read a page at a time, and taken by one compare-and-set.
      asMock(IncidentStateTimelineService.findBy).mockImplementation(
        async () => {
          return world.isTaken ? [] : [timeline()];
        },
      );
      asMock(IncidentService.findBy).mockImplementation(async () => {
        return [incident()];
      });
      asMock(IncidentStateTimelineService.findOneById).mockImplementation(
        async () => {
          return timeline();
        },
      );
      asMock(IncidentStateTimelineService.findOneBy).mockResolvedValue(null);
      asMock(
        IncidentStateTimelineService.compareAndSetColumnsByIdWithoutHooks,
      ).mockImplementation(compareAndSetTake);
    },
  },
  {
    title: "a reminder that an incident is still open",
    jobName: "IncidentOwner:SendUnresolvedReminderNotification",
    kind: OwnerNotificationKind.IncidentReminder,
    eventIdIsTheIncident: true,
    arrange: (): void => {
      // Due a page at a time until a run moves it on (#9019).
      asMock(IncidentService.findBy).mockImplementation(async () => {
        return world.isTaken ? [] : [incident()];
      });
      // Its affected resources.
      asMock(IncidentService.findAllBy).mockImplementation(async () => {
        return [incident()];
      });
      asMock(
        IncidentService.compareAndSetColumnsByIdWithoutHooks,
      ).mockImplementation(reminderMove);
      asMock(IncidentReminderRuleService.findMatchingRule).mockResolvedValue({
        reminderIntervalInMinutes: 30,
      });
    },
  },
  {
    title: "a scheduled maintenance event's state change",
    jobName: "ScheduledMaintenanceOwner:SendStateChangeEmail",
    kind: OwnerNotificationKind.ScheduledMaintenanceStateChanged,
    eventIdIsTheIncident: false,
    feedService: () => {
      return ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem;
    },
    feedLineOf: feedLineByUserMarkdown,
    arrange: (): void => {
      const stateChange: () => Record<string, unknown> = () => {
        return plain({
          id: world.eventId,
          projectId: PROJECT_ID,
          project: { name: "Acme" },
          scheduledMaintenanceId: world.incidentId,
          scheduledMaintenance: scheduledMaintenance(),
          scheduledMaintenanceState: { name: "Completed" },
          createdAt: START,
          startsAt: START,
        });
      };

      asMock(
        ScheduledMaintenanceStateTimelineService.findBy,
      ).mockImplementation(async () => {
        return world.isTaken ? [] : [stateChange()];
      });
      asMock(
        ScheduledMaintenanceStateTimelineService.findOneById,
      ).mockImplementation(async () => {
        return stateChange();
      });
      asMock(
        ScheduledMaintenanceStateTimelineService.findOneBy,
      ).mockResolvedValue(null);
      asMock(
        ScheduledMaintenanceStateTimelineService.compareAndSetColumnsByIdWithoutHooks,
      ).mockImplementation(compareAndSetTake);
      asMock(ScheduledMaintenanceService.findOwners).mockImplementation(
        async () => {
          return world.owners;
        },
      );
      asMock(
        ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard,
      ).mockResolvedValue("https://oneuptime.test/scheduled-maintenance");
      asMock(
        ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem,
      ).mockResolvedValue(undefined);
    },
  },
  {
    title: "a monitor's status change",
    jobName: "MonitorOwner:SendStatusChangeEmail",
    kind: OwnerNotificationKind.MonitorStatusChanged,
    eventIdIsTheIncident: false,
    arrange: (): void => {
      const statusChange: () => Record<string, unknown> = () => {
        return plain({
          id: world.eventId,
          projectId: PROJECT_ID,
          project: { name: "Acme" },
          monitorId: world.incidentId,
          monitorStatus: { name: "Offline" },
          createdAt: START,
          rootCause: "Connection refused",
        });
      };

      asMock(MonitorStatusTimelineService.findBy).mockImplementation(
        async () => {
          return world.isTaken ? [] : [statusChange()];
        },
      );
      asMock(MonitorService.findBy).mockImplementation(async () => {
        return [monitor()];
      });
      asMock(MonitorService.findOneById).mockImplementation(async () => {
        return monitor();
      });
      asMock(MonitorStatusTimelineService.findOneById).mockImplementation(
        async () => {
          return statusChange();
        },
      );
      asMock(MonitorStatusTimelineService.findOneBy).mockResolvedValue(null);
      asMock(
        MonitorStatusTimelineService.compareAndSetColumnsByIdWithoutHooks,
      ).mockImplementation(compareAndSetTake);
      asMock(MonitorService.findOwners).mockImplementation(async () => {
        return world.owners;
      });
      asMock(MonitorService.getMonitorLinkInDashboard).mockResolvedValue(
        "https://oneuptime.test/monitor",
      );
      asMock(MonitorService.getMonitorDestinationInfo).mockReturnValue({
        monitorDestination: "",
        requestType: "",
        monitorType: "",
      });
    },
  },
  {
    title: "a team added as the owner of a status page",
    jobName: "StatusPageOwner:SendOwnerAddedEmail",
    kind: OwnerNotificationKind.StatusPageOwnerAdded,
    eventIdIsTheIncident: false,
    arrange: (): void => {
      /*
       * Read a page at a time with the status page's other owner rows, and
       * taken by one compare-and-set that one run alone wins (#8862).
       */
      const teamId: ObjectID = ObjectID.generate();
      asMock(StatusPageOwnerTeamService.findBy).mockImplementation(async () => {
        return world.isTaken
          ? []
          : [
              plain({
                id: world.eventId,
                statusPageId: world.incidentId,
                teamId: teamId,
              }),
            ];
      });
      asMock(
        StatusPageOwnerTeamService.compareAndSetColumnsByIdWithoutHooks,
      ).mockImplementation(compareAndSetTake);
      asMock(StatusPageOwnerUserService.findBy).mockResolvedValue([]);
      asMock(TeamMemberService.getUsersInTeams).mockImplementation(async () => {
        return world.owners;
      });
      asMock(TeamMemberService.filterUsersToProjectMembers).mockImplementation(
        async (data: { users: Array<User> }) => {
          return data.users;
        },
      );
      // Read with the page's other status pages, or on its own.
      asMock(StatusPageService.findBy).mockResolvedValue([]);
      asMock(StatusPageService.findOneById).mockImplementation(async () => {
        return plain({
          id: world.incidentId,
          projectId: PROJECT_ID,
          project: { name: "Acme" },
          name: "Acme Status",
          description: "How Acme is doing",
        });
      });
      asMock(StatusPageService.getStatusPageLinkInDashboard).mockResolvedValue(
        "https://oneuptime.test/status-page",
      );
    },
  },
];

describePostgres("the owner notification jobs, against Postgres", () => {
  const schema: string = `owner_job_test_${ObjectID.generate().toString().replace(/-/g, "")}`;
  let database: DataSource;
  let now: Date;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["OWNER_NOTIFICATION_JOB_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["OWNER_NOTIFICATION_JOB_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["OWNER_NOTIFICATION_JOB_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      // Two workers at once run their statements on connections of their own.
      extra: { options: `-c search_path=${schema},public`, max: 6 },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."OwnerNotificationDelivery" (LIKE public."OwnerNotificationDelivery" INCLUDING ALL)`,
    );

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    // The real statement, stopped before it is sent for one owner when a test says.
    const startTelling: (id: ObjectID, at: Date) => Promise<boolean> =
      OwnerNotificationDeliveryService.startTelling.bind(
        OwnerNotificationDeliveryService,
      );

    jest
      .spyOn(OwnerNotificationDeliveryService, "startTelling")
      .mockImplementation(async (id: ObjectID, at: Date): Promise<boolean> => {
        if (world.startTellingStopsFor) {
          const rows: Array<{ userId: string }> = await database.query(
            `SELECT "userId" FROM "${schema}"."OwnerNotificationDelivery" WHERE "_id" = $1`,
            [id.toString()],
          );

          if (rows[0]?.userId === world.startTellingStopsFor) {
            world.startTellingStopsFor = null;
            world.stoppedAt.push("startTelling");
            return await NEVER;
          }
        }

        return await startTelling(id, at);
      });
  });

  afterAll(async () => {
    jest.restoreAllMocks();

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  describe.each(CASES)("$title", (jobCase: JobCase) => {
    function runJob(): Promise<void> {
      return mockCapturedJobs[jobCase.jobName]!();
    }

    async function untilStopped(): Promise<void> {
      for (let turn: number = 0; turn < 1000; turn++) {
        if (world.stoppedAt.length > 0) {
          return;
        }

        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 5);
        });
      }

      throw new Error("The run never reached the point it was to stop at.");
    }

    async function restartedMinutesLater(minutes: number): Promise<void> {
      now = new Date(now.getTime() + minutes * 60 * 1000);
      await runJob();
    }

    async function statuses(): Promise<Record<string, string>> {
      const rows: Array<{ userId: string; status: string }> =
        await database.query(
          `SELECT "userId", "status" FROM "${schema}"."OwnerNotificationDelivery" WHERE "kind" = $1 AND "eventId" = $2`,
          [jobCase.kind, world.eventId.toString()],
        );

      const byUser: Record<string, string> = {};

      for (const row of rows) {
        byUser[row.userId] = row.status;
      }

      return byUser;
    }

    function sends(): Record<string, number> {
      const byUser: Record<string, number> = {};

      for (const userId of world.sent) {
        byUser[userId] = (byUser[userId] || 0) + 1;
      }

      return byUser;
    }

    function everyOwnerOnce(): Record<string, number> {
      const once: Record<string, number> = {};

      for (const owner of world.owners) {
        once[owner.id!.toString()] = 1;
      }

      return once;
    }

    beforeEach(async () => {
      jest.clearAllMocks();
      now = new Date();

      // What a run of another test left - one stopped for good - is not this one's.
      await database.query(
        `DELETE FROM "${schema}"."OwnerNotificationDelivery"`,
      );

      const owners: Array<User> = [0, 1, 2].map((index: number): User => {
        const user: User = new User(ObjectID.generate());
        user.name = new Name(`Owner ${index + 1}`);
        user.email = new Email(
          `owner${index + 1}-${user.id!.toString()}@acme.test`,
        );
        return user;
      });

      const incidentId: ObjectID = ObjectID.generate();

      // A record of its own each test: the rows of one never meet another's.
      world = {
        incidentId: incidentId,
        eventId: jobCase.eventIdIsTheIncident
          ? incidentId
          : ObjectID.generate(),
        owners: owners,
        isTaken: false,
        takes: 0,
        takeStops: false,
        sendStopsFor: null,
        sendGate: null,
        startTellingStopsFor: null,
        sent: [],
        stoppedAt: [],
      };

      jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
        return new Date(now.getTime());
      });

      asMock(IncidentService.findCreatedNotificationsDue).mockResolvedValue([]);
      asMock(IncidentService.findAllBy).mockResolvedValue([]);
      asMock(IncidentStateTimelineService.findAllBy).mockResolvedValue([]);
      asMock(IncidentStateTimelineService.findBy).mockResolvedValue([]);
      asMock(IncidentService.findBy).mockResolvedValue([]);
      for (const service of [
        ScheduledMaintenanceStateTimelineService,
        MonitorStatusTimelineService,
        StatusPageOwnerTeamService,
        StatusPageOwnerUserService,
      ]) {
        asMock(service.findAllBy).mockResolvedValue([]);
        asMock(service.findBy).mockResolvedValue([]);
      }
      asMock(IncidentService.findOneById).mockImplementation(async () => {
        return incident();
      });
      asMock(IncidentService.findOwners).mockImplementation(async () => {
        return world.owners;
      });
      asMock(IncidentService.getIncidentLinkInDashboard).mockResolvedValue(
        "https://oneuptime.test/incident",
      );
      asMock(IncidentService.getIncidentIdentifiedDate).mockResolvedValue(
        START,
      );
      asMock(IncidentService.isIncidentResolved).mockResolvedValue(false);
      asMock(IncidentService.isIncidentAcknowledged).mockResolvedValue(false);
      asMock(ProjectService.getOwners).mockResolvedValue([]);
      asMock(UserService.findBy).mockImplementation(
        async (data: { query: JSONObject }) => {
          return usersNamedBy(world.owners, data.query);
        },
      );
      asMock(UserService.getUserMarkdownString).mockImplementation(
        async (data: { userId: ObjectID }) => {
          return `Owner ${data.userId.toString()}`;
        },
      );
      asMock(IncidentFeedService.createIncidentFeedItem).mockResolvedValue(
        undefined,
      );

      asMock(
        UserNotificationSettingService.sendUserNotification,
      ).mockImplementation(async (data: { userId: ObjectID }) => {
        const userId: string = data.userId.toString();

        world.sent.push(userId);

        if (world.sendStopsFor === userId) {
          world.sendStopsFor = null;
          world.stoppedAt.push(`send ${userId}`);
          await (world.sendGate || NEVER);
        }
      });

      jobCase.arrange();
    });

    async function feedStatus(): Promise<Array<string | null>> {
      const rows: Array<{ feedStatus: string | null }> = await database.query(
        `SELECT DISTINCT "feedStatus" FROM "${schema}"."OwnerNotificationDelivery" WHERE "kind" = $1 AND "eventId" = $2`,
        [jobCase.kind, world.eventId.toString()],
      );

      return rows.map((row: { feedStatus: string | null }) => {
        return row.feedStatus;
      });
    }

    test("stopped after the last owner was told, before the feed item: a restarted worker writes it, naming every owner", async () => {
      if (!jobCase.feedService) {
        return;
      }

      const create: AnyMock = asMock(jobCase.feedService());

      // The worker is killed as it writes the feed item.
      create.mockImplementationOnce(async () => {
        world.stoppedAt.push("feed");
        await NEVER;
      });

      void runJob();
      await untilStopped();

      expect(sends()).toEqual(everyOwnerOnce());
      expect(await feedStatus()).toEqual([OwnerNotificationFeedStatus.Pending]);

      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );
      await restartedMinutesLater(30);

      // The call the stopped run never finished, and the restarted one's.
      expect(create.mock.calls).toHaveLength(2);
      const written: string = String(
        (create.mock.calls[1]![0] as JSONObject)["moreInformationInMarkdown"],
      );
      // Each owner, as the job names them; none by address (#10669).
      for (const owner of world.owners) {
        expect(written).toContain(jobCase.feedLineOf!(owner));
        expect(written).not.toContain(owner.email!.toString());
      }
      expect(sends()).toEqual(everyOwnerOnce());
      expect(world.takes).toBe(1);
      expect(await feedStatus()).toEqual([OwnerNotificationFeedStatus.Written]);
    });

    test("two restarted workers, each on its own connections, write the feed item a stopped run left once between them", async () => {
      if (!jobCase.feedService) {
        return;
      }

      const create: AnyMock = asMock(jobCase.feedService());

      create.mockImplementationOnce(async () => {
        world.stoppedAt.push("feed");
        await NEVER;
      });

      void runJob();
      await untilStopped();

      now = new Date(
        now.getTime() +
          OwnerNotificationDeliveries.RESUME_AFTER_MINUTES * 60 * 1000,
      );
      await Promise.all([runJob(), runJob(), runJob()]);

      expect(create.mock.calls).toHaveLength(2);
      expect(sends()).toEqual(everyOwnerOnce());
      expect(await feedStatus()).toEqual([OwnerNotificationFeedStatus.Written]);
    });

    test("with no stop, tells each owner once, and the next run nobody", async () => {
      await runJob();

      expect(sends()).toEqual(everyOwnerOnce());
      expect(Object.values(await statuses())).toEqual([
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
      ]);

      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );
      expect(sends()).toEqual(everyOwnerOnce());
      expect(world.takes).toBe(1);
    });

    test("stopped before the second owner's send: the restarted worker tells the second and the third, each once", async () => {
      world.startTellingStopsFor = world.owners[1]!.id!.toString();

      void runJob();
      await untilStopped();

      expect(world.sent).toEqual([world.owners[0]!.id!.toString()]);

      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );

      expect(sends()).toEqual(everyOwnerOnce());
      expect(Object.values(await statuses())).toEqual([
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
      ]);
      expect(world.takes).toBe(1);
    });

    test("stopped during the second owner's send: the restarted worker tells the third, and never the second again", async () => {
      world.sendStopsFor = world.owners[1]!.id!.toString();

      void runJob();
      await untilStopped();

      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );
      await restartedMinutesLater(30);

      expect(sends()).toEqual(everyOwnerOnce());
      expect((await statuses())[world.owners[1]!.id!.toString()]).toBe(
        OwnerNotificationDeliveryStatus.Sending,
      );
    });

    test("stopped before the take: the restarted worker tells each owner once and takes the record once", async () => {
      world.takeStops = true;

      void runJob();
      await untilStopped();

      expect(Object.values(await statuses())).toEqual([
        OwnerNotificationDeliveryStatus.Pending,
        OwnerNotificationDeliveryStatus.Pending,
        OwnerNotificationDeliveryStatus.Pending,
      ]);

      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );

      expect(sends()).toEqual(everyOwnerOnce());
      expect(world.takes).toBe(1);
    });

    test("two workers at once, each on its own connections, tell each owner once between them", async () => {
      for (let round: number = 0; round < 5; round++) {
        // Another record each round.
        world.isTaken = false;
        world.sent = [];
        world.eventId = ObjectID.generate();

        if (jobCase.eventIdIsTheIncident) {
          world.incidentId = world.eventId;
        }

        await Promise.all([runJob(), runJob()]);

        expect(sends()).toEqual(everyOwnerOnce());
      }
    });

    test("a worker that lost its lock and goes on beside the next run: each owner told once", async () => {
      let release: () => void = (): void => {
        // set below
      };
      world.sendGate = new Promise<void>((resolve: () => void) => {
        release = resolve;
      });
      world.sendStopsFor = world.owners[1]!.id!.toString();

      const first: Promise<void> = runJob();
      await untilStopped();

      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );
      expect(sends()).toEqual(everyOwnerOnce());

      release();
      await first;

      expect(sends()).toEqual(everyOwnerOnce());
      expect(Object.values(await statuses())).toEqual([
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
      ]);
    });
  });
});
