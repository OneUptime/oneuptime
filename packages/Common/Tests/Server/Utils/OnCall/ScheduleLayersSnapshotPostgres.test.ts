import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import OnCallCalendarFeedCache from "../../../../Server/Infrastructure/OnCallCalendarFeedCache";
import AuditLogService from "../../../../Server/Services/AuditLogService";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import OnCallDutyPolicyScheduleLayerService from "../../../../Server/Services/OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleLayerUserService from "../../../../Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyScheduleService, {
  CurrentOnCallInSchedule,
  NextInRotationInSchedule,
  ResolvedShiftSegments,
  ScheduleLayerProps,
  ScheduleLayerReads,
} from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallShiftChangeListeners from "../../../../Server/Utils/OnCall/OnCallShiftChangeListeners";
import ScheduleLayersSave from "../../../../Server/Utils/OnCall/ScheduleLayersSave";
import ScheduleLayersSnapshot, {
  ScheduleLayersSnapshotEntry,
} from "../../../../Server/Utils/OnCall/ScheduleLayersSnapshot";
import WorkspaceUserGroupSync from "../../../../Server/Utils/Workspace/UserGroups/WorkspaceUserGroupSync";
import Entities from "../../../../Models/DatabaseModels/Index";
import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import CalendarEvent from "../../../../Types/Calendar/CalendarEvent";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import EventInterval from "../../../../Types/Events/EventInterval";
import Recurring from "../../../../Types/Events/Recurring";
import ObjectID from "../../../../Types/ObjectID";
import { LayerProps } from "../../../../Types/OnCallDutyPolicy/Layer";
import RestrictionTimes from "../../../../Types/OnCallDutyPolicy/RestrictionTimes";
import ScheduleLayersSaveUtil, {
  ScheduleLayersSaveRequest,
  ScheduleLayersState,
} from "../../../../Types/OnCallDutyPolicy/ScheduleLayersSave";
import Permission from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import {
  dailyRestriction,
  rotation,
} from "../../../Types/OnCallDutyPolicy/CalendarFeedTestFixtures";
import { DataSource, QueryRunner } from "typeorm";
import { PostgresQueryRunner } from "typeorm/driver/postgres/PostgresQueryRunner";

/*
 * WHO IS ON CALL, FROM ONE SNAPSHOT OF A SCHEDULE'S LAYERS (#9316), against
 * a migrated Postgres.
 *
 * Every run that works out who is on call - a page to the schedule, a level
 * paging its on-call person and the next in its rotation, the roster
 * refresh, the calendar feeds, /my-shifts and the shift reminders - reads
 * the schedule's layers and their people. Read in separate statements, a
 * save of the layers (ScheduleLayersSave) that committed between two of
 * them was seen half, and a page could go to somebody on call in neither
 * the layers as they were nor as saved.
 *
 * Here a real save is committed in the middle of each run: right after the
 * first statement the run sends that reads the layers, before its next.
 * Whatever the run reads after that is as saved. For each change a save
 * makes - a reorder, a layer deleted, a person removed, a person added -
 * the run must work everything out from the layers as they were, or from
 * the layers as saved: what it read of them, and whom it names, are the
 * same as the run made before the save, or the same as the one made after.
 * Never a mix.
 *
 * And a read waits for nothing: it takes no lock, so a save holding the
 * schedule while it writes holds no page up. It reads exactly what the
 * three separate reads it replaces read.
 *
 * Opt in, as ScheduleLayersSavePostgres does, with
 * RUN_POSTGRES_SCHEDULE_LAYERS_SAVE_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_SCHEDULE_LAYERS_SAVE_TESTS=true \
 *   SCHEDULE_LAYERS_SAVE_TEST_DATABASE_HOST=127.0.0.1 \
 *   SCHEDULE_LAYERS_SAVE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Utils/OnCall/ScheduleLayersSnapshotPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, beside
 * ScheduleLayersSavePostgres.
 *
 * Each test's rows are under a project of its own, deleted afterwards, as
 * are the people.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_SCHEDULE_LAYERS_SAVE_TESTS"] === "true"
    ? describe
    : describe.skip;

const NAMES: Array<string> = ["Alex", "Sam", "Kim", "Ria", "Lee"];
const HOUR: number = 60 * 60 * 1000;

// A statement that reads the layers table: the run's first read of the layers.
const READS_THE_LAYERS: RegExp =
  /^\s*SELECT\b[\s\S]*"OnCallDutyPolicyScheduleLayer"/i;

interface Seeded {
  projectId: ObjectID;
  scheduleId: ObjectID;
  weekdaysId: string;
  backupId: string;
  saverId: string;
  // The people, by name, and the rows they have in the layers.
  people: Record<string, string>;
  rows: Record<string, string>;
}

// What a run worked out, readable: compared whole, before, during and after a save.
type Outcome = Record<string, unknown>;

interface Run {
  name: string;
  run: (seeded: Seeded, window: { start: Date; end: Date }) => Promise<Outcome>;
}

interface Change {
  name: string;
  change: (request: ScheduleLayersSaveRequest, seeded: Seeded) => void;
}

function propsFor(
  projectId: ObjectID,
  userId: ObjectID,
): DatabaseCommonInteractionProps {
  return {
    tenantId: projectId,
    userId: userId,
    userType: UserType.User,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        projectId: projectId,
        _type: "UserTenantAccessPermission",
        permissions: [
          {
            _type: "UserPermission",
            permission: Permission.OnCallMember,
            labelIds: [],
            isBlockPermission: false,
          },
        ],
      },
    },
  };
}

describePostgres(
  "who is on call, from one snapshot of a schedule's layers, against a migrated Postgres",
  () => {
    let database: DataSource;
    const projects: Array<string> = [];
    const users: Array<string> = [];

    // Each read of the layers a run made (getScheduleLayerProps), in order.
    let readsMade: Array<Array<LayerProps>>;

    /*
     * While the save committed in the middle of a run is written: its own
     * reads (its roster refresh's) are no run's.
     */
    let saveUnderWay: boolean = false;

    async function insertUser(name: string): Promise<string> {
      const userId: string = ObjectID.generate().toString();
      users.push(userId);
      await database.query(
        `INSERT INTO "User" ("_id","email","name","slug","version") VALUES ($1,$2,$3,$4,1)`,
        [userId, `layers-snapshot-${userId}@example.com`, name, `s${userId}`],
      );
      return userId;
    }

    async function insertProject(): Promise<string> {
      const projectId: string = ObjectID.generate().toString();
      projects.push(projectId);
      await database.query(
        `INSERT INTO "Project" ("_id","name","slug","version") VALUES ($1,'t',$2,1)`,
        [projectId, `s${projectId}`],
      );
      return projectId;
    }

    async function insertSchedule(data: {
      projectId: string;
      timezone: string;
    }): Promise<string> {
      const scheduleId: string = ObjectID.generate().toString();
      await database.query(
        `INSERT INTO "OnCallDutyPolicySchedule" ("_id","projectId","name","slug","timezone","version") VALUES ($1,$2,'Payments primary',$3,$4,1)`,
        [scheduleId, data.projectId, `s${scheduleId}`, data.timezone],
      );
      return scheduleId;
    }

    async function insertLayer(data: {
      projectId: string;
      scheduleId: string;
      name: string;
      order: number;
      startsAt: Date;
    }): Promise<string> {
      const layerId: string = ObjectID.generate().toString();
      await database.query(
        `INSERT INTO "OnCallDutyPolicyScheduleLayer" ("_id","projectId","onCallDutyPolicyScheduleId","name","order","startsAt","handOffTime","version") VALUES ($1,$2,$3,$4,$5,$6,$6,1)`,
        [
          layerId,
          data.projectId,
          data.scheduleId,
          data.name,
          data.order,
          data.startsAt,
        ],
      );
      return layerId;
    }

    /*
     * The schedule: Weekdays - Alex, Sam and Kim taking turns of a day from
     * an hour ago, so Alex is on call now, Sam next - and below it Backup,
     * Ria. Lee is a member of the project in no layer. Everyone is on the
     * project's team, and so is the person who saves.
     */
    async function seed(options: { timezone?: string } = {}): Promise<Seeded> {
      const projectId: string = await insertProject();
      const saverId: string = await insertUser("Saver");
      const people: Record<string, string> = {};

      for (const name of NAMES) {
        people[name] = await insertUser(name);
      }

      const teamId: string = ObjectID.generate().toString();
      await database.query(
        `INSERT INTO "Team" ("_id","projectId","name","slug","version") VALUES ($1,$2,'On call',$3,1)`,
        [teamId, projectId, `s${teamId}`],
      );
      for (const userId of [saverId, ...Object.values(people)]) {
        await database.query(
          `INSERT INTO "TeamMember" ("_id","projectId","teamId","userId","hasAcceptedInvitation","version") VALUES ($1,$2,$3,$4,true,1)`,
          [ObjectID.generate().toString(), projectId, teamId, userId],
        );
      }

      const scheduleId: string = await insertSchedule({
        projectId: projectId,
        timezone: options.timezone || "UTC",
      });

      // On the minute, as a layer's start and hand-off are kept.
      const anHourAgo: Date = new Date(
        Math.floor((Date.now() - HOUR) / 60_000) * 60_000,
      );

      const weekdaysId: string = await insertLayer({
        projectId,
        scheduleId,
        name: "Weekdays",
        order: 1,
        startsAt: anHourAgo,
      });
      const backupId: string = await insertLayer({
        projectId,
        scheduleId,
        name: "Backup",
        order: 2,
        startsAt: anHourAgo,
      });

      const rows: Record<string, string> = {};
      const placed: Array<[string, string, number]> = [
        ["Alex", weekdaysId, 1],
        ["Sam", weekdaysId, 2],
        ["Kim", weekdaysId, 3],
        ["Ria", backupId, 1],
      ];

      for (const [name, layerId, order] of placed) {
        rows[name] = ObjectID.generate().toString();
        await database.query(
          `INSERT INTO "OnCallDutyPolicyScheduleLayerUser" ("_id","projectId","onCallDutyPolicyScheduleId","onCallDutyPolicyScheduleLayerId","userId","order","version") VALUES ($1,$2,$3,$4,$5,$6,1)`,
          [rows[name], projectId, scheduleId, layerId, people[name], order],
        );
      }

      return {
        projectId: new ObjectID(projectId),
        scheduleId: new ObjectID(scheduleId),
        weekdaysId,
        backupId,
        saverId,
        people,
        rows,
      };
    }

    async function stateOf(seeded: Seeded): Promise<ScheduleLayersState> {
      const layers: Array<{ _id: string; order: number }> =
        await database.query(
          `SELECT "_id", "order" FROM "OnCallDutyPolicyScheduleLayer" WHERE "onCallDutyPolicyScheduleId" = $1`,
          [seeded.scheduleId.toString()],
        );
      const layerUsers: Array<{
        _id: string;
        onCallDutyPolicyScheduleLayerId: string;
        userId: string;
        order: number;
      }> = await database.query(
        `SELECT "_id", "onCallDutyPolicyScheduleLayerId", "userId", "order" FROM "OnCallDutyPolicyScheduleLayerUser" WHERE "onCallDutyPolicyScheduleId" = $1`,
        [seeded.scheduleId.toString()],
      );

      return {
        layers: layers.map((row: { _id: string; order: number }) => {
          return { id: row._id, order: row.order };
        }),
        layerUsers: layerUsers.map(
          (row: {
            _id: string;
            onCallDutyPolicyScheduleLayerId: string;
            userId: string;
            order: number;
          }) => {
            return {
              id: row._id,
              layerId: row.onCallDutyPolicyScheduleLayerId,
              userId: row.userId,
              order: row.order,
            };
          },
        ),
      };
    }

    // The save that changes nothing, to change.
    async function unchanged(
      seeded: Seeded,
    ): Promise<ScheduleLayersSaveRequest> {
      return ScheduleLayersSaveUtil.getUnchangedRequest(await stateOf(seeded));
    }

    // The people of a layer for the save, in the order given: kept by their row, or added.
    function peopleOf(
      seeded: Seeded,
      ...names: Array<string>
    ): Array<{ layerUserId?: string | undefined; userId: string }> {
      return names.map((name: string) => {
        const row: string | undefined = seeded.rows[name];
        return row
          ? { layerUserId: row, userId: seeded.people[name]! }
          : { userId: seeded.people[name]! };
      });
    }

    function layerOf(
      request: ScheduleLayersSaveRequest,
      layerId: string,
    ): ScheduleLayersSaveRequest["layers"][number] {
      return request.layers.find(
        (layer: ScheduleLayersSaveRequest["layers"][number]) => {
          return layer.layerId === layerId;
        },
      )!;
    }

    function nameOf(
      seeded: Seeded,
      userId: ObjectID | string | null | undefined,
    ): string | null {
      if (!userId) {
        return null;
      }

      for (const [name, id] of Object.entries(seeded.people)) {
        if (id.toLowerCase() === userId.toString().toLowerCase()) {
          return name;
        }
      }

      return userId.toString();
    }

    // The layers as a read made them, by name, each with its people by name.
    function layersAsRead(
      seeded: Seeded,
      layerProps: Array<LayerProps>,
    ): Array<string> {
      return layerProps.map((layer: LayerProps) => {
        return `${layer.layerName}: ${layer.users
          .map((user: { id?: ObjectID | null }) => {
            return nameOf(seeded, user.id);
          })
          .join(", ")}`;
      });
    }

    function iso(date: Date | null | undefined): string | null {
      return date ? new Date(date).toISOString() : null;
    }

    // What a run worked out, with each read of the layers it made.
    async function outcomeOf(
      run: Run,
      seeded: Seeded,
      window: { start: Date; end: Date },
    ): Promise<Outcome> {
      readsMade = [];
      const outcome: Outcome = await run.run(seeded, window);

      return {
        ...outcome,
        reads: readsMade.map((layerProps: Array<LayerProps>) => {
          return layersAsRead(seeded, layerProps);
        }),
      };
    }

    /*
     * A save of `request`, committed right after the next statement that
     * reads the layers - the run's first read of them - and before the run
     * sends another. Its own statements read the layers too: they leave it
     * be.
     */
    function saveAfterTheFirstReadOfTheLayers(
      seeded: Seeded,
      request: ScheduleLayersSaveRequest,
    ): { committed: () => boolean; restore: () => void } {
      const query: PostgresQueryRunner["query"] =
        PostgresQueryRunner.prototype.query;
      let armed: boolean = true;
      let committed: boolean = false;

      const spy: jest.SpyInstance = jest
        .spyOn(PostgresQueryRunner.prototype, "query")
        .mockImplementation(async function (
          this: PostgresQueryRunner,
          sql: string,
          parameters?: Array<unknown>,
          useStructuredResult?: boolean,
        ): Promise<unknown> {
          const result: unknown = await query.call(
            this,
            sql,
            parameters,
            useStructuredResult as false,
          );

          if (armed && READS_THE_LAYERS.test(sql)) {
            armed = false;
            saveUnderWay = true;

            try {
              await ScheduleLayersSave.save({
                scheduleId: seeded.scheduleId,
                request: request,
                props: propsFor(seeded.projectId, new ObjectID(seeded.saverId)),
              });
            } finally {
              saveUnderWay = false;
            }

            committed = true;
          }

          return result;
        } as never);

      return {
        committed: (): boolean => {
          return committed;
        },
        restore: (): void => {
          spy.mockRestore();
        },
      };
    }

    // The three reads a run made before (#9316), one after another.
    async function readAsBefore(
      scheduleId: ObjectID,
    ): Promise<Array<LayerProps>> {
      const layers: Array<OnCallDutyPolicyScheduleLayer> =
        await OnCallDutyPolicyScheduleLayerService.findBy({
          query: { onCallDutyPolicyScheduleId: scheduleId },
          select: {
            order: true,
            name: true,
            description: true,
            startsAt: true,
            restrictionTimes: true,
            rotation: true,
            onCallDutyPolicyScheduleId: true,
            projectId: true,
            handOffTime: true,
          },
          sort: { order: SortOrder.Ascending },
          props: { isRoot: true },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
        });

      const layerUsers: Array<OnCallDutyPolicyScheduleLayerUser> =
        await OnCallDutyPolicyScheduleLayerUserService.findBy({
          query: { onCallDutyPolicyScheduleId: scheduleId },
          select: {
            user: true,
            order: true,
            onCallDutyPolicyScheduleLayerId: true,
          },
          sort: { order: SortOrder.Ascending },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        });

      const schedule: OnCallDutyPolicySchedule | null =
        await OnCallDutyPolicyScheduleService.findOneById({
          id: scheduleId,
          select: { timezone: true },
          props: { isRoot: true },
        });

      return (
        OnCallDutyPolicyScheduleService as unknown as {
          buildLayerPropsFromRows: (data: {
            layers: Array<OnCallDutyPolicyScheduleLayer>;
            layerUsers: Array<OnCallDutyPolicyScheduleLayerUser>;
            scheduleTimezone: string | undefined;
          }) => { layerProps: Array<LayerProps> };
        }
      ).buildLayerPropsFromRows({
        layers,
        layerUsers,
        scheduleTimezone: schedule?.timezone?.toString() || undefined,
      }).layerProps;
    }

    // Layer props, every part the engine reads, comparable.
    function engineInput(
      layerProps: Array<LayerProps>,
    ): Array<Record<string, unknown>> {
      return layerProps.map((layer: LayerProps) => {
        return {
          layerId: layer.layerId,
          layerName: layer.layerName,
          users: layer.users.map((user: { id?: ObjectID | null }) => {
            return user.id?.toString();
          }),
          startDateTimeOfLayer: iso(layer.startDateTimeOfLayer),
          handOffTime: iso(layer.handOffTime),
          rotationIsRecurring: layer.rotation instanceof Recurring,
          rotation: (layer.rotation as Recurring).toJSON(),
          restrictionTimesIsRestrictionTimes:
            layer.restrictionTimes instanceof RestrictionTimes,
          restrictionTimes: (
            layer.restrictionTimes as RestrictionTimes
          ).toJSON(),
          timezone: layer.timezone,
        };
      });
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["SCHEDULE_LAYERS_SAVE_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["SCHEDULE_LAYERS_SAVE_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["SCHEDULE_LAYERS_SAVE_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        synchronize: false,
        // A run, the save committed in the middle of it, and a lock held: three at once.
        extra: { max: 8 },
      });
      await database.initialize();

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      // The roster refresh's lock is a Redis one; one process needs none.
      jest
        .spyOn(Semaphore, "lock")
        .mockResolvedValue({ name: "lock" } as unknown as SemaphoreMutex);
      jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);

      // Slack user groups and Teams tags that follow a schedule, the feeds' caches and listeners: not here.
      jest
        .spyOn(WorkspaceUserGroupSync, "requestSyncForSchedules")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(OnCallCalendarFeedCache, "purgeForSchedule")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(OnCallCalendarFeedCache, "purgeForUser")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(OnCallShiftChangeListeners, "notify")
        .mockResolvedValue(undefined as never);

      // Workflows run elsewhere.
      jest
        .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);

      // The audit log is ClickHouse's.
      for (const method of [
        "recordCreate",
        "recordUpdate",
        "recordDelete",
      ] as const) {
        jest
          .spyOn(AuditLogService, method)
          .mockResolvedValue(undefined as never);
      }

      // Each read of the layers a run makes, kept to compare.
      const getScheduleLayerProps: (data: {
        scheduleId: ObjectID;
      }) => Promise<ScheduleLayerProps> =
        OnCallDutyPolicyScheduleService.getScheduleLayerProps.bind(
          OnCallDutyPolicyScheduleService,
        );
      jest
        .spyOn(OnCallDutyPolicyScheduleService, "getScheduleLayerProps")
        .mockImplementation(async (data: { scheduleId: ObjectID }) => {
          const isTheSaves: boolean = saveUnderWay;
          const read: ScheduleLayerProps = await getScheduleLayerProps(data);

          if (!isTheSaves) {
            readsMade.push(read.layerProps);
          }

          return read;
        });
    });

    beforeEach(() => {
      readsMade = [];
    });

    /*
     * Deleting a project, or a user, checks every table that can name one -
     * hundreds of foreign keys - which takes most of a minute on a migrated
     * database, more than a hook is given by default.
     */
    afterAll(async () => {
      jest.restoreAllMocks();
      if (database?.isInitialized) {
        if (projects.length > 0) {
          await database.query(`DELETE FROM "Project" WHERE "_id" = ANY($1)`, [
            projects,
          ]);
        }
        if (users.length > 0) {
          await database.query(`DELETE FROM "User" WHERE "_id" = ANY($1)`, [
            users,
          ]);
        }
        await database.destroy();
      }
    }, 300_000);

    // What a save changes, in one go.
    const CHANGES: Array<Change> = [
      {
        name: "a reorder - Backup moved above Weekdays, and Kim to the top of Weekdays",
        change: (request: ScheduleLayersSaveRequest, seeded: Seeded): void => {
          const weekdays: ScheduleLayersSaveRequest["layers"][number] = layerOf(
            request,
            seeded.weekdaysId,
          );
          weekdays.users = peopleOf(seeded, "Kim", "Alex", "Sam");
          request.layers = [layerOf(request, seeded.backupId), weekdays];
        },
      },
      {
        name: "a layer deleted - Weekdays, and its people with it",
        change: (request: ScheduleLayersSaveRequest, seeded: Seeded): void => {
          request.layers = [layerOf(request, seeded.backupId)];
          request.deletedLayerIds = [seeded.weekdaysId];
        },
      },
      {
        name: "a person removed - Alex taken out of Weekdays",
        change: (request: ScheduleLayersSaveRequest, seeded: Seeded): void => {
          layerOf(request, seeded.weekdaysId).users = peopleOf(
            seeded,
            "Sam",
            "Kim",
          );
        },
      },
      {
        name: "a person added - Lee at the top of Weekdays",
        change: (request: ScheduleLayersSaveRequest, seeded: Seeded): void => {
          layerOf(request, seeded.weekdaysId).users = peopleOf(
            seeded,
            "Lee",
            "Alex",
            "Sam",
            "Kim",
          );
        },
      },
    ];

    // The runs that work out who is on call from the layers.
    const RUNS: Array<Run> = [
      {
        name: "a page to the schedule",
        run: async (seeded: Seeded): Promise<Outcome> => {
          const onCall: CurrentOnCallInSchedule | null =
            await OnCallDutyPolicyScheduleService.getCurrentOnCallInSchedule(
              seeded.scheduleId,
            );

          return { paged: nameOf(seeded, onCall?.userId) };
        },
      },
      {
        name: "a level paging the schedule's on-call person and the next in its rotation",
        run: async (seeded: Seeded): Promise<Outcome> => {
          // As the level does: one read of the schedule for both.
          const layerReads: ScheduleLayerReads = new Map<
            string,
            Promise<ScheduleLayerProps>
          >();

          const onCall: CurrentOnCallInSchedule | null =
            await OnCallDutyPolicyScheduleService.getCurrentOnCallInSchedule(
              seeded.scheduleId,
              { layerReads },
            );
          const next: NextInRotationInSchedule | null =
            await OnCallDutyPolicyScheduleService.getNextInRotationInSchedule(
              seeded.scheduleId,
              { layerReads },
            );

          return {
            onCall: nameOf(seeded, onCall?.userId),
            next: nameOf(seeded, next?.nextUserId),
          };
        },
      },
      {
        name: "the roster refresh",
        run: async (seeded: Seeded): Promise<Outcome> => {
          const roster: {
            currentUserId: ObjectID | null;
            rosterStartAt: Date | null;
            handOffTimeAt: Date | null;
            nextUserId: ObjectID | null;
            nextRosterStartAt: Date | null;
            nextHandOffTimeAt: Date | null;
          } =
            await OnCallDutyPolicyScheduleService.getCurrrentUserIdAndHandoffTimeInSchedule(
              seeded.scheduleId,
            );

          return {
            onCall: nameOf(seeded, roster.currentUserId),
            since: iso(roster.rosterStartAt),
            until: iso(roster.handOffTimeAt),
            next: nameOf(seeded, roster.nextUserId),
            nextFrom: iso(roster.nextRosterStartAt),
            nextUntil: iso(roster.nextHandOffTimeAt),
          };
        },
      },
      {
        name: "the calendar feeds, my shifts and the shift reminders",
        run: async (
          seeded: Seeded,
          window: { start: Date; end: Date },
        ): Promise<Outcome> => {
          const resolved: ResolvedShiftSegments | null =
            await OnCallDutyPolicyScheduleService.getResolvedShiftSegments({
              scheduleId: seeded.scheduleId,
              windowStart: window.start,
              windowEnd: window.end,
            });

          return {
            layers: layersAsRead(seeded, resolved?.layerProps || []),
            shifts: (resolved?.segments || []).map((segment: CalendarEvent) => {
              return `${nameOf(seeded, segment.title)} ${iso(segment.start)} - ${iso(segment.end)}`;
            }),
          };
        },
      },
    ];

    describe.each(RUNS)("$name", (run: Run) => {
      test.each(CHANGES)(
        "$name, saved between its reads: everything from the layers as they were, or as saved - never a mix",
        async (change: Change) => {
          const seeded: Seeded = await seed();
          const window: { start: Date; end: Date } = {
            start: new Date(),
            end: new Date(Date.now() + 48 * HOUR),
          };

          const before: Outcome = await outcomeOf(run, seeded, window);

          const request: ScheduleLayersSaveRequest = await unchanged(seeded);
          change.change(request, seeded);

          const save: { committed: () => boolean; restore: () => void } =
            saveAfterTheFirstReadOfTheLayers(seeded, request);

          let during: Outcome;
          try {
            during = await outcomeOf(run, seeded, window);
          } finally {
            save.restore();
          }

          const after: Outcome = await outcomeOf(run, seeded, window);

          // The save committed while the run was under way, after it first read the layers.
          expect(save.committed()).toBe(true);
          // It changed what the run works out.
          expect(after).not.toEqual(before);
          // And the run worked it all out from one side of it.
          expect([before, after]).toContainEqual(during);
        },
      );
    });

    test("the run before the save: Alex is paged, and Sam is next - the schedule as seeded", async () => {
      const seeded: Seeded = await seed();

      expect(
        await outcomeOf(RUNS[1]!, seeded, {
          start: new Date(),
          end: new Date(),
        }),
      ).toEqual({
        onCall: "Alex",
        next: "Sam",
        reads: [["Weekdays: Alex, Sam, Kim", "Backup: Ria"]],
      });
    });

    test("a read while a save holds the schedule, its layers and their people locked: it waits for nothing, and sees them as they were", async () => {
      const seeded: Seeded = await seed();
      const runner: QueryRunner = database.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();

      try {
        // As a save holds them while it writes (ScheduleLayersSave.write) - and part written.
        await runner.query(
          `SELECT "_id" FROM "OnCallDutyPolicySchedule" WHERE "_id" = $1 FOR UPDATE`,
          [seeded.scheduleId.toString()],
        );
        await runner.query(
          `SELECT "_id" FROM "OnCallDutyPolicyScheduleLayer" WHERE "onCallDutyPolicyScheduleId" = $1 FOR UPDATE`,
          [seeded.scheduleId.toString()],
        );
        await runner.query(
          `SELECT "_id" FROM "OnCallDutyPolicyScheduleLayerUser" WHERE "onCallDutyPolicyScheduleId" = $1 FOR UPDATE`,
          [seeded.scheduleId.toString()],
        );
        await runner.query(
          `DELETE FROM "OnCallDutyPolicyScheduleLayerUser" WHERE "_id" = $1`,
          [seeded.rows["Alex"]],
        );
        await runner.query(
          `UPDATE "OnCallDutyPolicyScheduleLayer" SET "order" = 3 WHERE "_id" = $1`,
          [seeded.weekdaysId],
        );

        let timer: ReturnType<typeof setTimeout> | undefined;
        const waited: Promise<never> = new Promise<never>(
          (
            _resolve: (value: never) => void,
            reject: (error: Error) => void,
          ) => {
            timer = setTimeout(() => {
              reject(new Error("The read waited for the save's locks."));
            }, 5000);
          },
        );

        try {
          const read: ScheduleLayerProps = await Promise.race([
            OnCallDutyPolicyScheduleService.getScheduleLayerProps({
              scheduleId: seeded.scheduleId,
            }),
            waited,
          ]);

          expect(layersAsRead(seeded, read.layerProps)).toEqual([
            "Weekdays: Alex, Sam, Kim",
            "Backup: Ria",
          ]);

          const onCall: CurrentOnCallInSchedule | null = await Promise.race([
            OnCallDutyPolicyScheduleService.getCurrentOnCallInSchedule(
              seeded.scheduleId,
            ),
            waited,
          ]);
          expect(nameOf(seeded, onCall?.userId)).toBe("Alex");
        } finally {
          clearTimeout(timer);
        }
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });

    test("reads exactly what the three reads it replaces read: office hours, a weekly rotation, a timezone, a tie in turn order, a person whose user is deleted, a layer with nobody", async () => {
      const seeded: Seeded = await seed({ timezone: "America/New_York" });

      await database.query(
        `UPDATE "OnCallDutyPolicyScheduleLayer" SET "restrictionTimes" = $2, "rotation" = $3 WHERE "_id" = $1`,
        [
          seeded.weekdaysId,
          JSON.stringify(
            dailyRestriction("09:00", "17:00", "America/New_York").toJSON(),
          ),
          JSON.stringify(rotation(EventInterval.Week, 1).toJSON()),
        ],
      );

      // Nights, at the bottom, with nobody in it.
      await insertLayer({
        projectId: seeded.projectId.toString(),
        scheduleId: seeded.scheduleId.toString(),
        name: "Nights",
        order: 3,
        startsAt: new Date(Date.now() - 2 * HOUR),
      });

      // Kim and Sam saved at the same turn: they take turns by their rows' ids.
      await database.query(
        `UPDATE "OnCallDutyPolicyScheduleLayerUser" SET "order" = 2 WHERE "_id" = $1`,
        [seeded.rows["Kim"]],
      );

      // Ria's user is deleted: she takes no turn.
      await database.query(
        `UPDATE "User" SET "deletedAt" = now() WHERE "_id" = $1`,
        [seeded.people["Ria"]],
      );

      const asBefore: Array<LayerProps> = await readAsBefore(seeded.scheduleId);
      const read: ScheduleLayerProps =
        await OnCallDutyPolicyScheduleService.getScheduleLayerProps({
          scheduleId: seeded.scheduleId,
        });

      expect(engineInput(read.layerProps)).toEqual(engineInput(asBefore));

      const samFirst: boolean =
        seeded.rows["Sam"]!.toLowerCase() < seeded.rows["Kim"]!.toLowerCase();
      expect(layersAsRead(seeded, read.layerProps)).toEqual([
        samFirst ? "Weekdays: Alex, Sam, Kim" : "Weekdays: Alex, Kim, Sam",
        "Backup: ",
        "Nights: ",
      ]);
      expect(
        read.layerProps.map((layer: LayerProps) => {
          return layer.timezone;
        }),
      ).toEqual(["America/New_York", "America/New_York", "America/New_York"]);
      expect(read.projectId?.toString()).toBe(seeded.projectId.toString());
      expect(
        read.scheduleUserIds.map((userId: ObjectID) => {
          return nameOf(seeded, userId);
        }),
      ).toEqual(samFirst ? ["Alex", "Sam", "Kim"] : ["Alex", "Kim", "Sam"]);
    });

    test("many schedules at once, a few rows to a statement: each read whole, as it is on its own", async () => {
      const first: Seeded = await seed();
      const second: Seeded = await seed({ timezone: "Europe/Berlin" });
      const empty: string = await insertSchedule({
        projectId: first.projectId.toString(),
        timezone: "UTC",
      });
      const missing: ObjectID = ObjectID.generate();

      const query: (
        sql: string,
        parameters: Array<unknown>,
      ) => Promise<unknown> = async (
        sql: string,
        parameters: Array<unknown>,
      ): Promise<unknown> => {
        return await database.query(sql, parameters);
      };

      const asRead: (
        entry: ScheduleLayersSnapshotEntry | undefined,
      ) => Array<string> = (
        entry: ScheduleLayersSnapshotEntry | undefined,
      ): Array<string> => {
        return (entry?.layers || []).map(
          (layer: OnCallDutyPolicyScheduleLayer) => {
            return `${layer.name}: ${(entry?.layerUsers || [])
              .filter((layerUser: OnCallDutyPolicyScheduleLayerUser) => {
                return (
                  layerUser.onCallDutyPolicyScheduleLayerId?.toString() ===
                  layer.id?.toString()
                );
              })
              .map((layerUser: OnCallDutyPolicyScheduleLayerUser) => {
                return layerUser.user?.id?.toString() || "";
              })
              .join(", ")}`;
          },
        );
      };

      const ids: Array<ObjectID> = [
        first.scheduleId,
        second.scheduleId,
        new ObjectID(empty),
        missing,
      ];

      /*
       * Five rows and two schedules a statement: a schedule is four rows,
       * so the first statement stops part way into its second schedule,
       * which the next one reads again, whole.
       */
      const statements: Array<Array<string>> = [];
      const together: Map<string, ScheduleLayersSnapshotEntry> =
        await ScheduleLayersSnapshot.read({
          scheduleIds: ids,
          query: async (
            sql: string,
            parameters: Array<unknown>,
          ): Promise<unknown> => {
            statements.push(parameters[0] as Array<string>);
            return await query(sql, parameters);
          },
          maxRows: 5,
          schedulesPerStatement: 2,
        });

      expect(statements).toHaveLength(3);

      expect(together.has(missing.toString())).toBe(false);
      expect(together.get(empty)?.layers).toEqual([]);

      for (const scheduleId of [first.scheduleId, second.scheduleId]) {
        const alone: Map<string, ScheduleLayersSnapshotEntry> =
          await ScheduleLayersSnapshot.read({
            scheduleIds: [scheduleId],
            query: query,
          });

        expect(asRead(together.get(scheduleId.toString()))).toEqual(
          asRead(alone.get(scheduleId.toString())),
        );
      }

      expect(
        together.get(second.scheduleId.toString())?.schedule.timezone,
      ).toBe("Europe/Berlin");
    });
  },
);
