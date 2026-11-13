import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import AuditLogService from "../../../../Server/Services/AuditLogService";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallCalendarFeedCache from "../../../../Server/Infrastructure/OnCallCalendarFeedCache";
import OnCallShiftChangeListeners from "../../../../Server/Utils/OnCall/OnCallShiftChangeListeners";
import ScheduleLayersSave from "../../../../Server/Utils/OnCall/ScheduleLayersSave";
import WorkspaceUserGroupSync from "../../../../Server/Utils/Workspace/UserGroups/WorkspaceUserGroupSync";
import Entities from "../../../../Models/DatabaseModels/Index";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ConflictException from "../../../../Types/Exception/ConflictException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import ObjectID from "../../../../Types/ObjectID";
import ScheduleLayersSaveUtil, {
  ScheduleLayersSaveRequest,
  ScheduleLayersSaveResult,
  ScheduleLayersState,
} from "../../../../Types/OnCallDutyPolicy/ScheduleLayersSave";
import Permission from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import { DataSource, EntityManager } from "typeorm";

/*
 * Saving the changes made on a schedule's Layers page all at once (issue
 * #7575), against a migrated Postgres: the save's own statements - the
 * schedule's row locked, the layers read under the lock, people taken
 * out, layers deleted, new orders, people added - and what they leave.
 *
 *   - Every change of the page in one save: the rows as the page showed
 *     them, renumbered 1 to n, each row whose order changed a new version
 *     of itself, the people added created by the person who saved, the
 *     people of a deleted layer gone with it; who is on call worked out
 *     once from the new rows, and the schedule's calendar version moved on
 *     once.
 *   - Two saves made to the same layers at once: one is saved, the other
 *     is refused as made to layers that changed - and leaves nothing.
 *   - The permission each change takes, as the real rules decide: someone
 *     who may only read the layers saves nothing, and someone who may move
 *     people but not take them out saves a move, but not a move with a
 *     removal.
 *   - Another project's schedule is not found.
 *
 * Opt in with RUN_POSTGRES_SCHEDULE_LAYERS_SAVE_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_SCHEDULE_LAYERS_SAVE_TESTS=true \
 *   SCHEDULE_LAYERS_SAVE_TEST_DATABASE_HOST=127.0.0.1 \
 *   SCHEDULE_LAYERS_SAVE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Utils/OnCall/ScheduleLayersSavePostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after that
 * job has applied every registered migration to an empty database.
 *
 * Each test's rows are under a project of its own, deleted afterwards, as
 * are the people.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_SCHEDULE_LAYERS_SAVE_TESTS"] === "true"
    ? describe
    : describe.skip;

interface Seeded {
  projectId: ObjectID;
  scheduleId: ObjectID;
  weekdaysId: string;
  backupId: string;
  // The people, by name, and the rows they have in the layers.
  people: Record<string, string>;
  rows: Record<string, string>;
}

const NAMES: Array<string> = ["Alex", "Sam", "Kim", "Ria", "Lee"];

function propsFor(
  projectId: ObjectID,
  userId: ObjectID,
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    tenantId: projectId,
    userId: userId,
    userType: UserType.User,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        projectId: projectId,
        _type: "UserTenantAccessPermission",
        permissions: permissions.map((permission: Permission) => {
          return {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          };
        }),
      },
    },
  };
}

describePostgres(
  "saving a schedule's layers at once, against a migrated Postgres",
  () => {
    let database: DataSource;
    const projects: Array<string> = [];
    const users: Array<string> = [];
    let refreshes: number;
    // The audit log's entries, as "recordDelete <table>".
    let audited: Array<string>;

    async function insertUser(name: string): Promise<string> {
      const userId: string = ObjectID.generate().toString();
      users.push(userId);
      await database.query(
        `INSERT INTO "User" ("_id","email","name","slug","version") VALUES ($1,$2,$3,$4,1)`,
        [userId, `layers-save-${userId}@example.com`, name, `s${userId}`],
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

    /*
     * The schedule: Weekdays - Alex, Sam and Kim taking turns of a day from
     * an hour ago, so Alex is on call now - and below it Backup, Ria. Lee is
     * a member of the project in no layer. Everyone is on the project's team.
     */
    async function seed(saverId: string): Promise<Seeded> {
      const projectId: string = await insertProject();
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

      const scheduleId: string = ObjectID.generate().toString();
      await database.query(
        `INSERT INTO "OnCallDutyPolicySchedule" ("_id","projectId","name","slug","timezone","version") VALUES ($1,$2,'Payments primary',$3,'UTC',1)`,
        [scheduleId, projectId, `s${scheduleId}`],
      );

      const anHourAgo: Date = new Date(Date.now() - 60 * 60 * 1000);
      const weekdaysId: string = ObjectID.generate().toString();
      const backupId: string = ObjectID.generate().toString();

      for (const [layerId, name, order] of [
        [weekdaysId, "Weekdays", 1],
        [backupId, "Backup", 2],
      ] as Array<[string, string, number]>) {
        await database.query(
          `INSERT INTO "OnCallDutyPolicyScheduleLayer" ("_id","projectId","onCallDutyPolicyScheduleId","name","order","startsAt","handOffTime","version") VALUES ($1,$2,$3,$4,$5,$6,$6,1)`,
          [layerId, projectId, scheduleId, name, order, anHourAgo],
        );
      }

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
        weekdaysId: weekdaysId,
        backupId: backupId,
        people: people,
        rows: rows,
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

    // Who takes turns in a layer, by name and order, as Postgres holds them.
    async function turnsIn(
      seeded: Seeded,
      layerId: string,
    ): Promise<Array<string>> {
      const rows: Array<{ userId: string; order: number }> =
        await database.query(
          `SELECT "userId", "order" FROM "OnCallDutyPolicyScheduleLayerUser" WHERE "onCallDutyPolicyScheduleLayerId" = $1 ORDER BY "order", "_id"`,
          [layerId],
        );
      const nameOf: Record<string, string> = {};
      for (const [name, userId] of Object.entries(seeded.people)) {
        nameOf[userId] = name;
      }
      return rows.map((row: { userId: string; order: number }) => {
        return `${nameOf[row.userId]}:${row.order}`;
      });
    }

    async function layersOf(seeded: Seeded): Promise<Array<string>> {
      const rows: Array<{ name: string; order: number }> = await database.query(
        `SELECT "name", "order" FROM "OnCallDutyPolicyScheduleLayer" WHERE "onCallDutyPolicyScheduleId" = $1 ORDER BY "order"`,
        [seeded.scheduleId.toString()],
      );
      return rows.map((row: { name: string; order: number }) => {
        return `${row.name}:${row.order}`;
      });
    }

    async function scheduleRow(seeded: Seeded): Promise<{
      currentUserIdOnRoster: string | null;
      nextUserIdOnRoster: string | null;
      shiftConfigVersion: number;
    }> {
      const rows: Array<{
        currentUserIdOnRoster: string | null;
        nextUserIdOnRoster: string | null;
        shiftConfigVersion: number;
      }> = await database.query(
        `SELECT "currentUserIdOnRoster", "nextUserIdOnRoster", "shiftConfigVersion" FROM "OnCallDutyPolicySchedule" WHERE "_id" = $1`,
        [seeded.scheduleId.toString()],
      );
      return rows[0]!;
    }

    // The people of a layer for the save, in the order given: kept by their row, or added.
    function peopleOf(
      seeded: Seeded,
      ...names: Array<string>
    ): Array<{ layerUserId?: string | undefined; userId: string }> {
      return names.map((name: string) => {
        const row: string | undefined = seeded.rows[name];
        return row && name !== "Lee"
          ? { layerUserId: row, userId: seeded.people[name]! }
          : { userId: seeded.people[name]! };
      });
    }

    async function unchanged(
      seeded: Seeded,
    ): Promise<ScheduleLayersSaveRequest> {
      return ScheduleLayersSaveUtil.getUnchangedRequest(await stateOf(seeded));
    }

    async function refusal(run: () => Promise<unknown>): Promise<Error> {
      try {
        await run();
      } catch (error) {
        return error as Error;
      }
      throw new Error("Expected the save to be refused");
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
        // Two saves at once need two connections.
        extra: { max: 6 },
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

      // The audit log is ClickHouse's: counted here.
      const countAudit: (
        method: string,
      ) => (data: {
        model: { tableName?: string | undefined };
      }) => Promise<void> = (method: string) => {
        return async (data: {
          model: { tableName?: string | undefined };
        }): Promise<void> => {
          audited.push(`${method} ${data.model.tableName || ""}`);
        };
      };

      for (const method of [
        "recordCreate",
        "recordUpdate",
        "recordDelete",
      ] as const) {
        jest
          .spyOn(AuditLogService, method)
          .mockImplementation(countAudit(method) as never);
      }
      const refresh: (scheduleId: ObjectID) => Promise<unknown> =
        OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule.bind(
          OnCallDutyPolicyScheduleService,
        );
      jest
        .spyOn(
          OnCallDutyPolicyScheduleService,
          "refreshCurrentUserIdAndHandoffTimeInSchedule",
        )
        .mockImplementation((async (scheduleId: ObjectID) => {
          refreshes++;
          return await refresh(scheduleId);
        }) as never);
    });

    beforeEach(() => {
      refreshes = 0;
      audited = [];
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

    test("every change of the page in one save: the rows as the page showed them", async () => {
      const saverId: string = await insertUser("Saver");
      const seeded: Seeded = await seed(saverId);
      const props: DatabaseCommonInteractionProps = propsFor(
        seeded.projectId,
        new ObjectID(saverId),
        [Permission.OnCallMember],
      );

      const versionsBefore: Array<{ _id: string; version: number }> =
        await database.query(
          `SELECT "_id", "version" FROM "OnCallDutyPolicyScheduleLayerUser" WHERE "onCallDutyPolicyScheduleId" = $1`,
          [seeded.scheduleId.toString()],
        );
      const configBefore: number = (await scheduleRow(seeded))
        .shiftConfigVersion;

      // Weekdays: Kim to the top, Alex out, Lee added. Backup deleted.
      const request: ScheduleLayersSaveRequest = await unchanged(seeded);
      request.layers = request.layers.filter((layer: { layerId: string }) => {
        return layer.layerId === seeded.weekdaysId;
      });
      request.layers[0]!.users = peopleOf(seeded, "Kim", "Sam", "Lee");
      request.deletedLayerIds = [seeded.backupId];

      const result: ScheduleLayersSaveResult = await ScheduleLayersSave.save({
        scheduleId: seeded.scheduleId,
        request: request,
        props: props,
      });

      expect(await layersOf(seeded)).toEqual(["Weekdays:1"]);
      expect(await turnsIn(seeded, seeded.weekdaysId)).toEqual([
        "Kim:1",
        "Sam:2",
        "Lee:3",
      ]);

      // Ria went with the Backup layer, by its foreign key.
      const ria: Array<unknown> = await database.query(
        `SELECT "_id" FROM "OnCallDutyPolicyScheduleLayerUser" WHERE "_id" = $1`,
        [seeded.rows["Ria"]],
      );
      expect(ria).toEqual([]);

      // Kim's row is a new version of itself; Sam's, at the same turn, is not.
      const versionsAfter: Record<string, number> = {};
      for (const row of (await database.query(
        `SELECT "_id", "version" FROM "OnCallDutyPolicyScheduleLayerUser" WHERE "onCallDutyPolicyScheduleId" = $1`,
        [seeded.scheduleId.toString()],
      )) as Array<{ _id: string; version: number }>) {
        versionsAfter[row._id] = row.version;
      }
      const before: Record<string, number> = {};
      for (const row of versionsBefore) {
        before[row._id] = row.version;
      }
      expect(versionsAfter[seeded.rows["Kim"]!]).toBe(
        before[seeded.rows["Kim"]!]! + 1,
      );
      expect(versionsAfter[seeded.rows["Sam"]!]).toBe(
        before[seeded.rows["Sam"]!]!,
      );

      // Lee's row: by the person who saved, in this schedule and project.
      const lee: Array<{
        createdByUserId: string;
        projectId: string;
        onCallDutyPolicyScheduleId: string;
        version: number;
      }> = await database.query(
        `SELECT "createdByUserId", "projectId", "onCallDutyPolicyScheduleId", "version" FROM "OnCallDutyPolicyScheduleLayerUser" WHERE "userId" = $1`,
        [seeded.people["Lee"]],
      );
      expect(lee).toEqual([
        {
          createdByUserId: saverId,
          projectId: seeded.projectId.toString(),
          onCallDutyPolicyScheduleId: seeded.scheduleId.toString(),
          version: 1,
        },
      ]);

      // The version the save answers is the layers' as Postgres holds them.
      expect(result.version).toBe(
        ScheduleLayersSaveUtil.getVersion(await stateOf(seeded)),
      );
      expect(result).toEqual(
        expect.objectContaining({
          deletedLayers: 1,
          addedLayerUsers: 1,
          removedLayerUsers: 1,
          movedLayerUsers: 1,
        }),
      );

      // Who is on call, worked out once from the new rows: Kim, then Sam.
      expect(refreshes).toBe(1);
      const schedule: {
        currentUserIdOnRoster: string | null;
        nextUserIdOnRoster: string | null;
        shiftConfigVersion: number;
      } = await scheduleRow(seeded);
      expect(schedule.currentUserIdOnRoster).toBe(seeded.people["Kim"]);
      expect(schedule.nextUserIdOnRoster).toBe(seeded.people["Sam"]);
      // The calendar feeds' version moved on once.
      expect(schedule.shiftConfigVersion).toBe(configBefore + 1);
      // Alex out, Backup deleted, Kim moved, Lee added - the rows of the layers the save wrote.
      expect(
        audited
          .filter((entry: string) => {
            return entry.includes("OnCallDutyPolicyScheduleLayer");
          })
          .sort(),
      ).toEqual([
        "recordCreate OnCallDutyPolicyScheduleLayerUser",
        "recordDelete OnCallDutyPolicyScheduleLayer",
        "recordDelete OnCallDutyPolicyScheduleLayerUser",
        "recordUpdate OnCallDutyPolicyScheduleLayerUser",
      ]);
    });

    test("a save that waits for another's lock reads the layers again once it has it: refused, and leaves nothing", async () => {
      const saverId: string = await insertUser("Saver");
      const seeded: Seeded = await seed(saverId);
      const props: DatabaseCommonInteractionProps = propsFor(
        seeded.projectId,
        new ObjectID(saverId),
        [Permission.OnCallMember],
      );

      /*
       * The first save holds the schedule's lock until told to go on; the
       * second is let through to its own lock, and the time it gets it is
       * kept.
       */
      const realTransaction: <T>(
        run: (manager: EntityManager) => Promise<T>,
      ) => Promise<T> = OnCallDutyPolicyScheduleService.executeTransaction.bind(
        OnCallDutyPolicyScheduleService,
      );
      let firstHasTheLock!: () => void;
      const firstLocked: Promise<void> = new Promise<void>(
        (resolve: () => void) => {
          firstHasTheLock = resolve;
        },
      );
      let letTheFirstGoOn!: () => void;
      const firstMayGoOn: Promise<void> = new Promise<void>(
        (resolve: () => void) => {
          letTheFirstGoOn = resolve;
        },
      );
      let secondLockedAt: number | null = null;
      let transactionsStarted: number = 0;

      const transactions: jest.SpyInstance = jest
        .spyOn(OnCallDutyPolicyScheduleService, "executeTransaction")
        .mockImplementation((async (
          run: (manager: EntityManager) => Promise<unknown>,
        ) => {
          const which: number = transactionsStarted++;
          return await realTransaction(async (manager: EntityManager) => {
            const held: EntityManager = new Proxy(manager, {
              get: (target: EntityManager, key: string | symbol): unknown => {
                if (key !== "query") {
                  return Reflect.get(target, key);
                }
                return async (
                  sql: string,
                  parameters: Array<unknown>,
                ): Promise<unknown> => {
                  const result: unknown = await target.query(sql, parameters);
                  // The save's first statement: the schedule's row, locked.
                  if (
                    sql.startsWith(
                      `SELECT "_id" FROM "OnCallDutyPolicySchedule"`,
                    )
                  ) {
                    if (which === 0) {
                      firstHasTheLock();
                      await firstMayGoOn;
                    } else {
                      secondLockedAt = Date.now();
                    }
                  }
                  return result;
                };
              },
            });
            return await run(held);
          });
        }) as never);

      try {
        const kimFirst: ScheduleLayersSaveRequest = await unchanged(seeded);
        kimFirst.layers[0]!.users = peopleOf(seeded, "Kim", "Alex", "Sam");

        const samOut: ScheduleLayersSaveRequest = await unchanged(seeded);
        samOut.layers[0]!.users = peopleOf(seeded, "Alex", "Kim", "Lee");

        const first: Promise<ScheduleLayersSaveResult> =
          ScheduleLayersSave.save({
            scheduleId: seeded.scheduleId,
            request: kimFirst,
            props: props,
          });
        await firstLocked;

        // Read before the first commits, so it passes the check made before the lock.
        const second: Promise<ScheduleLayersSaveResult> =
          ScheduleLayersSave.save({
            scheduleId: seeded.scheduleId,
            request: samOut,
            props: props,
          });
        const secondSettled: Promise<unknown> = second.catch(
          (error: unknown) => {
            return error;
          },
        );

        // Long enough for the second to reach the lock, and wait on it.
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 1000);
        });
        expect(transactionsStarted).toBe(2);
        expect(secondLockedAt).toBeNull();

        const goneOnAt: number = Date.now();
        letTheFirstGoOn();

        await first;
        const outcome: unknown = await secondSettled;

        expect(outcome).toBeInstanceOf(ConflictException);
        expect(secondLockedAt).not.toBeNull();
        expect(secondLockedAt!).toBeGreaterThanOrEqual(goneOnAt);
        expect(await turnsIn(seeded, seeded.weekdaysId)).toEqual([
          "Kim:1",
          "Alex:2",
          "Sam:3",
        ]);
      } finally {
        // On a failure too, so the first save does not hold its transaction open.
        letTheFirstGoOn();
        transactions.mockRestore();
      }
    });

    test("two saves made to the same layers at once: one is saved, the other refused and leaves nothing", async () => {
      const saverId: string = await insertUser("Saver");
      const seeded: Seeded = await seed(saverId);
      const props: DatabaseCommonInteractionProps = propsFor(
        seeded.projectId,
        new ObjectID(saverId),
        [Permission.OnCallMember],
      );

      // One tab moves Kim to the top; another takes Sam out and adds Lee.
      const kimFirst: ScheduleLayersSaveRequest = await unchanged(seeded);
      kimFirst.layers[0]!.users = peopleOf(seeded, "Kim", "Alex", "Sam");

      const samOut: ScheduleLayersSaveRequest = await unchanged(seeded);
      samOut.layers[0]!.users = peopleOf(seeded, "Alex", "Kim", "Lee");

      const results: Array<PromiseSettledResult<ScheduleLayersSaveResult>> =
        await Promise.allSettled([
          ScheduleLayersSave.save({
            scheduleId: seeded.scheduleId,
            request: kimFirst,
            props: props,
          }),
          ScheduleLayersSave.save({
            scheduleId: seeded.scheduleId,
            request: samOut,
            props: props,
          }),
        ]);

      const saved: Array<number> = [];
      const refused: Array<unknown> = [];
      results.forEach(
        (
          outcome: PromiseSettledResult<ScheduleLayersSaveResult>,
          at: number,
        ) => {
          if (outcome.status === "fulfilled") {
            saved.push(at);
          } else {
            refused.push(outcome.reason);
          }
        },
      );

      expect(saved.length).toBe(1);
      expect(refused.length).toBe(1);
      expect(refused[0]).toBeInstanceOf(ConflictException);
      expect((refused[0] as Error).message).toBe(
        ScheduleLayersSave.CONFLICT_MESSAGE,
      );

      // Exactly the saved one's rows - none of the other's.
      expect(await turnsIn(seeded, seeded.weekdaysId)).toEqual(
        saved[0] === 0
          ? ["Kim:1", "Alex:2", "Sam:3"]
          : ["Alex:1", "Kim:2", "Lee:3"],
      );
    });

    test("the layers changed by someone else since the page read them: refused, nothing written", async () => {
      const saverId: string = await insertUser("Saver");
      const seeded: Seeded = await seed(saverId);
      const props: DatabaseCommonInteractionProps = propsFor(
        seeded.projectId,
        new ObjectID(saverId),
        [Permission.OnCallMember],
      );

      const request: ScheduleLayersSaveRequest = await unchanged(seeded);
      request.layers[0]!.users = peopleOf(seeded, "Sam", "Alex", "Kim");

      // Someone else adds Lee to Backup.
      await database.query(
        `INSERT INTO "OnCallDutyPolicyScheduleLayerUser" ("_id","projectId","onCallDutyPolicyScheduleId","onCallDutyPolicyScheduleLayerId","userId","order","version") VALUES ($1,$2,$3,$4,$5,2,1)`,
        [
          ObjectID.generate().toString(),
          seeded.projectId.toString(),
          seeded.scheduleId.toString(),
          seeded.backupId,
          seeded.people["Lee"],
        ],
      );

      const error: Error = await refusal(() => {
        return ScheduleLayersSave.save({
          scheduleId: seeded.scheduleId,
          request: request,
          props: props,
        });
      });

      expect(error).toBeInstanceOf(ConflictException);
      expect(await turnsIn(seeded, seeded.weekdaysId)).toEqual([
        "Alex:1",
        "Sam:2",
        "Kim:3",
      ]);
      expect(refreshes).toBe(0);
    });

    test("someone who may only read the layers saves nothing", async () => {
      const saverId: string = await insertUser("Viewer");
      const seeded: Seeded = await seed(saverId);
      const props: DatabaseCommonInteractionProps = propsFor(
        seeded.projectId,
        new ObjectID(saverId),
        [Permission.OnCallViewer],
      );

      const changes: Array<(request: ScheduleLayersSaveRequest) => void> = [
        // A drag.
        (request: ScheduleLayersSaveRequest): void => {
          request.layers[0]!.users = peopleOf(seeded, "Kim", "Alex", "Sam");
        },
        // Someone taken out.
        (request: ScheduleLayersSaveRequest): void => {
          request.layers[0]!.users = peopleOf(seeded, "Alex", "Sam");
        },
        // Someone added.
        (request: ScheduleLayersSaveRequest): void => {
          request.layers[1]!.users = peopleOf(seeded, "Ria", "Lee");
        },
        // A layer moved up.
        (request: ScheduleLayersSaveRequest): void => {
          request.layers = [request.layers[1]!, request.layers[0]!];
        },
        // A layer deleted.
        (request: ScheduleLayersSaveRequest): void => {
          request.layers = [request.layers[0]!];
          request.deletedLayerIds = [seeded.backupId];
        },
      ];

      for (const change of changes) {
        const request: ScheduleLayersSaveRequest = await unchanged(seeded);
        change(request);

        const error: Error = await refusal(() => {
          return ScheduleLayersSave.save({
            scheduleId: seeded.scheduleId,
            request: request,
            props: props,
          });
        });

        expect(error).toBeInstanceOf(NotAuthorizedException);
      }

      expect(await layersOf(seeded)).toEqual(["Weekdays:1", "Backup:2"]);
      expect(await turnsIn(seeded, seeded.weekdaysId)).toEqual([
        "Alex:1",
        "Sam:2",
        "Kim:3",
      ]);
      expect(await turnsIn(seeded, seeded.backupId)).toEqual(["Ria:1"]);
      expect(refreshes).toBe(0);
    });

    test("someone who may move people but not take them out: a move is saved, a move with a removal is not", async () => {
      const saverId: string = await insertUser("Editor");
      const seeded: Seeded = await seed(saverId);
      const props: DatabaseCommonInteractionProps = propsFor(
        seeded.projectId,
        new ObjectID(saverId),
        [
          Permission.ReadProjectOnCallDutyPolicySchedule,
          Permission.ReadOnCallDutyPolicyScheduleLayer,
          Permission.EditOnCallDutyPolicyScheduleLayer,
        ],
      );

      const both: ScheduleLayersSaveRequest = await unchanged(seeded);
      both.layers[0]!.users = peopleOf(seeded, "Kim", "Alex");

      const error: Error = await refusal(() => {
        return ScheduleLayersSave.save({
          scheduleId: seeded.scheduleId,
          request: both,
          props: props,
        });
      });
      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(await turnsIn(seeded, seeded.weekdaysId)).toEqual([
        "Alex:1",
        "Sam:2",
        "Kim:3",
      ]);

      const move: ScheduleLayersSaveRequest = await unchanged(seeded);
      move.layers[0]!.users = peopleOf(seeded, "Kim", "Alex", "Sam");

      await ScheduleLayersSave.save({
        scheduleId: seeded.scheduleId,
        request: move,
        props: props,
      });

      expect(await turnsIn(seeded, seeded.weekdaysId)).toEqual([
        "Kim:1",
        "Alex:2",
        "Sam:3",
      ]);
    });

    test("another project's schedule is not found, and keeps its layers", async () => {
      const saverId: string = await insertUser("Saver");
      const seeded: Seeded = await seed(saverId);
      const otherProjectId: ObjectID = new ObjectID(await insertProject());
      const props: DatabaseCommonInteractionProps = propsFor(
        otherProjectId,
        new ObjectID(saverId),
        [Permission.ProjectOwner],
      );

      const request: ScheduleLayersSaveRequest = await unchanged(seeded);
      request.layers[0]!.users = peopleOf(seeded, "Kim", "Alex", "Sam");

      const error: Error = await refusal(() => {
        return ScheduleLayersSave.save({
          scheduleId: seeded.scheduleId,
          request: request,
          props: props,
        });
      });

      expect(error).toBeInstanceOf(NotFoundException);
      expect(await turnsIn(seeded, seeded.weekdaysId)).toEqual([
        "Alex:1",
        "Sam:2",
        "Kim:3",
      ]);
    });
  },
);
