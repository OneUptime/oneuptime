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

jest.mock("Common/Server/Services/IncidentStateTimelineService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      findOneById: jest.fn(),
      findOneBy: jest.fn(),
      updateOneById: jest.fn(),
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
  eventIdIsTheIncident: boolean;
  arrange: () => void;
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

async function takeOrStop(): Promise<void> {
  if (world.takeStops) {
    world.takeStops = false;
    world.stoppedAt.push("take");
    await NEVER;
  }

  world.isTaken = true;
  world.takes++;
}

const PROJECT_ID: ObjectID = ObjectID.generate();
const START: Date = new Date();

const CASES: Array<JobCase> = [
  {
    title: "an incident's Created notification",
    jobName: "IncidentOwner:SendCreatedResourceEmail",
    kind: OwnerNotificationKind.IncidentCreated,
    eventIdIsTheIncident: true,
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
    arrange: (): void => {
      asMock(IncidentStateTimelineService.findAllBy).mockImplementation(
        async () => {
          return world.isTaken ? [] : [timeline()];
        },
      );
      asMock(IncidentStateTimelineService.findOneById).mockImplementation(
        async () => {
          return timeline();
        },
      );
      asMock(IncidentStateTimelineService.findOneBy).mockResolvedValue(null);
      asMock(IncidentStateTimelineService.updateOneById).mockImplementation(
        takeOrStop,
      );
    },
  },
  {
    title: "a reminder that an incident is still open",
    jobName: "IncidentOwner:SendUnresolvedReminderNotification",
    kind: OwnerNotificationKind.IncidentReminder,
    eventIdIsTheIncident: true,
    arrange: (): void => {
      asMock(IncidentService.findAllBy).mockImplementation(async () => {
        return world.isTaken ? [] : [incident()];
      });
      asMock(IncidentService.updateOneById).mockImplementation(
        async (data: { data: JSONObject }) => {
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
