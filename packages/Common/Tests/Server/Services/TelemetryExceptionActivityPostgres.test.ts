import Entities from "../../../Models/DatabaseModels/Index";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import TelemetryExceptionActivity, {
  TelemetryExceptionActivityType,
} from "../../../Models/DatabaseModels/TelemetryExceptionActivity";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import TelemetryExceptionActivityService from "../../../Server/Services/TelemetryExceptionActivityService";
import TelemetryExceptionService from "../../../Server/Services/TelemetryExceptionService";
import FindBy from "../../../Server/Types/Database/FindBy";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import logger from "../../../Server/Utils/Logger";
import ExceptionAssignmentNotifications from "../../../Server/Utils/Telemetry/ExceptionAssignmentNotifications";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { DataSource } from "typeorm";

/*
 * AN EXCEPTION'S ACTIVITY, WRITTEN AND READ ON POSTGRES.
 *
 * The unit suites fake the database around the update hooks; this runs the
 * whole of it on a real one: a triage written through updateOneById and
 * updateBy (what the API's update routes, Bulk Actions and OneUptime's own
 * code call) leaves its rows in TelemetryExceptionActivity, a write that
 * changes nothing leaves none, and a read of a timeline - by a teammate, as
 * the API reads it - holds only the entries of the exceptions they may read,
 * newest first.
 *
 * Opt in with RUN_POSTGRES_EXCEPTION_ACTIVITY_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check. The structure of the migrated
 * TelemetryException and TelemetryExceptionActivity tables is cloned into a
 * unique schema that is dropped afterwards. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * EXCEPTION_ACTIVITY_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * EXCEPTION_ACTIVITY_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_EXCEPTION_ACTIVITY_TESTS"] === "true"
    ? describe
    : describe.skip;

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const PRIYA: ObjectID = ObjectID.generate();

function teammate(): DatabaseCommonInteractionProps {
  const permission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.ProjectMember,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  };

  return {
    userId: PRIYA,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: { [PROJECT_ID.toString()]: permission },
  };
}

interface ActivityRow {
  telemetryExceptionId: string;
  activityType: string;
  userId: string | null;
}

describePostgres("exception activity against Postgres", () => {
  const schema: string = `exception_activity_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;

  async function seed(fingerprint: string): Promise<string> {
    const rows: Array<{ _id: string }> = await database.query(
      `INSERT INTO "${schema}"."TelemetryException"
         ("projectId", "primaryEntityId", "fingerprint", "message",
          "exceptionType", "occuranceCount", "isResolved", "isArchived",
          "version", "firstSeenAt", "lastSeenAt")
       VALUES ($1, $2, $3, 'boom', 'TypeError', 1, false, false, 0, now(), now())
       RETURNING "_id"::text AS "_id"`,
      [PROJECT_ID.toString(), SERVICE_ID.toString(), fingerprint],
    );

    return rows[0]!._id;
  }

  async function activityRows(): Promise<Array<ActivityRow>> {
    return await database.query(
      `SELECT "telemetryExceptionId"::text AS "telemetryExceptionId",
              "activityType", "userId"::text AS "userId"
       FROM "${schema}"."TelemetryExceptionActivity"
       ORDER BY "createdAt", "activityType"`,
    );
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["EXCEPTION_ACTIVITY_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["EXCEPTION_ACTIVITY_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["EXCEPTION_ACTIVITY_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of ["TelemetryException", "TelemetryExceptionActivity"]) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    await database.query(
      `DELETE FROM "${schema}"."TelemetryExceptionActivity"`,
    );
    await database.query(`DELETE FROM "${schema}"."TelemetryException"`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a triage through updateOneById leaves one row, crediting the person; one that changes nothing leaves none", async () => {
    const a: string = await seed("fp-a");

    await TelemetryExceptionService.updateOneById({
      id: new ObjectID(a),
      data: { isResolved: true },
      props: { isRoot: true, userId: PRIYA },
    });

    // Resolved already: no change, no row.
    await TelemetryExceptionService.updateOneById({
      id: new ObjectID(a),
      data: { isResolved: true },
      props: { isRoot: true, userId: PRIYA },
    });

    await TelemetryExceptionService.updateOneById({
      id: new ObjectID(a),
      data: { isResolved: false },
      props: { isRoot: true },
    });

    expect(await activityRows()).toEqual([
      {
        telemetryExceptionId: a,
        activityType: TelemetryExceptionActivityType.Resolved,
        userId: PRIYA.toString(),
      },
      {
        telemetryExceptionId: a,
        activityType: TelemetryExceptionActivityType.Reopened,
        userId: null,
      },
    ]);

    // The exception itself was written as asked.
    const stored: Array<{ isResolved: boolean }> = await database.query(
      `SELECT "isResolved" FROM "${schema}"."TelemetryException" WHERE "_id" = $1`,
      [a],
    );
    expect(stored[0]!.isResolved).toBe(false);
  });

  test("one updateBy over several exceptions leaves a row for each it changed", async () => {
    const a: string = await seed("fp-a");
    const b: string = await seed("fp-b");
    const c: string = await seed("fp-c");
    await database.query(
      `UPDATE "${schema}"."TelemetryException" SET "isArchived" = true WHERE "_id" = $1`,
      [c],
    );

    await TelemetryExceptionService.updateBy({
      query: { _id: QueryHelper.any([a, b, c]) },
      data: { isArchived: true },
      limit: 10,
      skip: 0,
      props: { isRoot: true, userId: PRIYA },
    });

    expect(
      (await activityRows())
        .map((row: ActivityRow): string => {
          return `${row.telemetryExceptionId}:${row.activityType}`;
        })
        .sort(),
    ).toEqual(
      [
        `${a}:${TelemetryExceptionActivityType.Archived}`,
        `${b}:${TelemetryExceptionActivityType.Archived}`,
      ].sort(),
    );
  });

  test("a teammate reads a timeline newest first, and only of the exceptions they may read", async () => {
    const a: string = await seed("fp-a");
    const b: string = await seed("fp-b");

    await TelemetryExceptionActivityService.record({
      entries: [
        {
          projectId: PROJECT_ID,
          telemetryExceptionId: new ObjectID(a),
          activityType: TelemetryExceptionActivityType.Resolved,
        },
      ],
      actor: { userId: PRIYA },
    });
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 5);
    });
    await TelemetryExceptionActivityService.record({
      entries: [
        {
          projectId: PROJECT_ID,
          telemetryExceptionId: new ObjectID(a),
          activityType: TelemetryExceptionActivityType.Reopened,
        },
        {
          projectId: PROJECT_ID,
          telemetryExceptionId: new ObjectID(b),
          activityType: TelemetryExceptionActivityType.Archived,
        },
      ],
      actor: { apiKeyName: "Deploy pipeline" },
    });

    // The caller may read a, not b: the exceptions' own scope says so.
    jest.spyOn(TelemetryExceptionService, "findBy").mockImplementation((async (
      findBy: FindBy<TelemetryException>,
    ) => {
      expect(findBy.props.userId?.toString()).toBe(PRIYA.toString());
      const model: TelemetryException = new TelemetryException();
      model._id = a;
      return [model];
    }) as never);

    const read: (
      id: string,
    ) => Promise<Array<TelemetryExceptionActivity>> = async (
      id: string,
    ): Promise<Array<TelemetryExceptionActivity>> => {
      return await TelemetryExceptionActivityService.findBy({
        query: { telemetryExceptionId: new ObjectID(id) },
        select: { activityType: true, apiKeyName: true, createdAt: true },
        sort: { createdAt: SortOrder.Descending },
        limit: 10,
        skip: 0,
        props: teammate(),
      });
    };

    expect(
      (await read(a)).map((entry: TelemetryExceptionActivity) => {
        return [entry.activityType, entry.apiKeyName || null];
      }),
    ).toEqual([
      [TelemetryExceptionActivityType.Reopened, "Deploy pipeline"],
      [TelemetryExceptionActivityType.Resolved, null],
    ]);

    expect(await read(b)).toEqual([]);

    expect(
      (
        await TelemetryExceptionActivityService.countBy({
          query: { telemetryExceptionId: new ObjectID(a) },
          props: teammate(),
        })
      ).toNumber(),
    ).toBe(2);
  });

  test("deleting an exception takes its timeline with it", async () => {
    const a: string = await seed("fp-a");

    await TelemetryExceptionActivityService.record({
      entries: [
        {
          projectId: PROJECT_ID,
          telemetryExceptionId: new ObjectID(a),
          activityType: TelemetryExceptionActivityType.Archived,
        },
      ],
      actor: {},
    });

    const foreignKeys: Array<{ definition: string }> = await database.query(
      `SELECT pg_get_constraintdef(c.oid) AS "definition"
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'public' AND t.relname = 'TelemetryExceptionActivity'
         AND c.contype = 'f'`,
    );

    expect(
      foreignKeys.some((key: { definition: string }): boolean => {
        return (
          key.definition.includes('("telemetryExceptionId")') &&
          key.definition.includes('"TelemetryException"') &&
          key.definition.includes("ON DELETE CASCADE")
        );
      }),
    ).toBe(true);
  });

  /*
   * An assignment is told by the Workers from its entry: written untold,
   * taken - marked told - once, whichever worker gets there first.
   */
  test("an assignment's entry starts untold, and the Workers' run takes it once", async () => {
    const a: string = await seed("fp-a");
    const alex: ObjectID = ObjectID.generate();

    await TelemetryExceptionActivityService.record({
      entries: [
        {
          projectId: PROJECT_ID,
          telemetryExceptionId: new ObjectID(a),
          activityType: TelemetryExceptionActivityType.Assigned,
          assigneeUserId: alex,
        },
        {
          projectId: PROJECT_ID,
          telemetryExceptionId: new ObjectID(a),
          activityType: TelemetryExceptionActivityType.Resolved,
        },
      ],
      actor: { userId: PRIYA },
    });

    const untold: () => Promise<
      Array<{ activityType: string }>
    > = async (): Promise<Array<{ activityType: string }>> => {
      return await database.query(
        `SELECT "activityType" FROM "${schema}"."TelemetryExceptionActivity" WHERE "isAssigneeNotified" = false`,
      );
    };

    expect(await untold()).toEqual([
      { activityType: TelemetryExceptionActivityType.Assigned },
    ]);

    const told: Array<string> = [];
    jest
      .spyOn(ExceptionAssignmentNotifications, "notifyAssignment")
      .mockImplementation((async (entry: TelemetryExceptionActivity) => {
        told.push(entry.assigneeUserId?.toString() || "");
        return [];
      }) as never);

    // Two workers at once: each entry is taken by one of them.
    const taken: Array<number> = await Promise.all([
      ExceptionAssignmentNotifications.sendPendingNotifications(),
      ExceptionAssignmentNotifications.sendPendingNotifications(),
    ]);

    expect(taken[0]! + taken[1]!).toBe(1);
    expect(told).toEqual([alex.toString()]);
    expect(await untold()).toEqual([]);

    // And the next run finds nothing to tell.
    expect(
      await ExceptionAssignmentNotifications.sendPendingNotifications(),
    ).toBe(0);
  });

  test("the untold assignments are found through their partial index", async () => {
    const indexes: Array<{ indexdef: string }> = await database.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'TelemetryExceptionActivity'`,
    );

    expect(
      indexes.some((index: { indexdef: string }): boolean => {
        return (
          index.indexdef.includes('("activityType", "createdAt")') &&
          index.indexdef.includes('WHERE ("isAssigneeNotified" = false)')
        );
      }),
    ).toBe(true);
  });
});
