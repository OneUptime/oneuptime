import Entities from "../../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import logger from "../../../../Server/Utils/Logger";
import ScheduleLayerChanges from "../../../../Server/Utils/OnCall/ScheduleLayerChanges";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * A CHANGE TO A SCHEDULE'S LAYERS MADE THROUGH THE API IS HELD ON THE
 * SCHEDULE, IN POSTGRES (issue #7813).
 *
 * A write made through the API holds its schedule's change
 * (rosterRefreshDueAt, a hook-free UPDATE), and the Workers tell the
 * changes whose quiet period is over, then let each hold go with a
 * compare-and-set - unless a write came meanwhile. Here the real
 * ScheduleLayerChanges and the real service statements run against a copy
 * of the migrated "OnCallDutyPolicySchedule" table, its partial index
 * included; working out who is on call and telling the feeds are stubbed:
 *
 *   - the hold is written as the time the write was made plus the quiet
 *     period, to the millisecond, and every write pushes it on;
 *   - the Workers' read finds only the schedules whose hold is due, and
 *     the read is one the partial index answers;
 *   - a change told is let go; one written to while it was told is not,
 *     and is told again once that write is quiet;
 *   - a schedule that has nothing held is never read, nor written.
 *
 * Opt in with RUN_POSTGRES_SCHEDULE_LAYER_CHANGES_TESTS=true and a migrated
 * database (SCHEDULE_LAYER_CHANGES_TEST_DATABASE_HOST, _PORT, _NAME;
 * DATABASE_USERNAME, DATABASE_PASSWORD). Every write is to a schema of its
 * own; only the table's structure is copied, never its rows.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_SCHEDULE_LAYER_CHANGES_TESTS"] === "true"
    ? describe
    : describe.skip;

const PROJECT_ID: ObjectID = ObjectID.generate();
const T0: Date = new Date("2026-03-03T12:00:00.000Z");

function secondsAfter(moment: Date, seconds: number): Date {
  return new Date(moment.getTime() + seconds * 1000);
}

describePostgres("a schedule's change held in Postgres", () => {
  const schema: string = `schedule_layer_changes_${ObjectID.generate().toString().replace(/-/g, "")}`;
  let database: DataSource;
  let now: Date = T0;
  let told: Array<string> = [];

  async function seedSchedule(name: string): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."OnCallDutyPolicySchedule" ("_id", "projectId", "name", "slug", "version") VALUES ($1, $2, $3, $4, 1)`,
      [id.toString(), PROJECT_ID.toString(), name, `${name}-${id.toString()}`],
    );

    return id;
  }

  async function heldUntil(id: ObjectID): Promise<Date | null> {
    const rows: Array<{ rosterRefreshDueAt: Date | null }> =
      await database.query(
        `SELECT "rosterRefreshDueAt" FROM "${schema}"."OnCallDutyPolicySchedule" WHERE "_id" = $1`,
        [id.toString()],
      );

    return rows[0]?.rosterRefreshDueAt || null;
  }

  async function writeThroughTheApi(id: ObjectID, at: Date): Promise<void> {
    now = at;

    await ScheduleLayerChanges.afterLayersWritten({
      scheduleId: id,
      props: { tenantId: PROJECT_ID, apiKeyId: ObjectID.generate() },
      tellNow: async (): Promise<void> => {
        throw new Error("A write made through the API is not told at once.");
      },
    });
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["SCHEDULE_LAYER_CHANGES_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["SCHEDULE_LAYER_CHANGES_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["SCHEDULE_LAYER_CHANGES_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public`, max: 2 },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."OnCallDutyPolicySchedule" (LIKE public."OnCallDutyPolicySchedule" INCLUDING ALL)`,
    );

    const currentSchema: Array<{ current_schema: string }> =
      await database.query("SELECT current_schema()");
    expect(currentSchema[0]?.current_schema).toBe(schema);
  });

  beforeEach(async () => {
    now = T0;
    told = [];

    await database.query(`DELETE FROM "${schema}"."OnCallDutyPolicySchedule"`);

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return now;
    });
    jest.spyOn(logger, "debug").mockImplementation((() => {
      return undefined;
    }) as never);

    jest
      .spyOn(
        OnCallDutyPolicyScheduleService,
        "refreshCurrentUserIdAndHandoffTimeInSchedule",
      )
      .mockImplementation((async (scheduleId: ObjectID) => {
        told.push(scheduleId.toString());
        return {
          currentUserId: null,
          handOffTimeAt: null,
          nextUserId: null,
          nextHandOffTimeAt: null,
          rosterStartAt: null,
          nextRosterStartAt: null,
        };
      }) as never);
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "propagateShiftConfigChange")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("the copy carries the partial index the Workers read by", async () => {
    const indexes: Array<{ indexdef: string }> = await database.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = 'OnCallDutyPolicySchedule' AND indexdef LIKE '%rosterRefreshDueAt%'`,
      [schema],
    );

    expect(indexes).toHaveLength(1);
    expect(indexes[0]!.indexdef).toContain(
      'WHERE ("rosterRefreshDueAt" IS NOT NULL)',
    );
  });

  test("the Workers' read of what is due is one the partial index answers", async () => {
    await database.query("SET enable_seqscan = off");

    try {
      const plan: Array<{ "QUERY PLAN": string }> = await database.query(
        `EXPLAIN SELECT "_id" FROM "${schema}"."OnCallDutyPolicySchedule" WHERE "rosterRefreshDueAt" <= $1 AND "deletedAt" IS NULL ORDER BY "rosterRefreshDueAt" ASC LIMIT 100`,
        [T0],
      );

      expect(
        plan
          .map((row: { "QUERY PLAN": string }): string => {
            return row["QUERY PLAN"];
          })
          .join("\n"),
      ).toMatch(/Index Scan using "?IDX_d242a03092195f79e2e425ea62"?/);
    } finally {
      await database.query("SET enable_seqscan = on");
    }
  });

  test("a write holds the change for the quiet period, to the millisecond, and every write pushes it on", async () => {
    const schedule: ObjectID = await seedSchedule("payments");

    await writeThroughTheApi(schedule, new Date("2026-03-03T12:00:00.123Z"));
    expect((await heldUntil(schedule))?.toISOString()).toBe(
      "2026-03-03T12:00:30.123Z",
    );

    await writeThroughTheApi(schedule, new Date("2026-03-03T12:00:12.456Z"));
    expect((await heldUntil(schedule))?.toISOString()).toBe(
      "2026-03-03T12:00:42.456Z",
    );

    expect(told).toEqual([]);
  });

  test("the Workers tell what is due, once, and let it go; what is not due waits", async () => {
    const due: ObjectID = await seedSchedule("payments");
    const later: ObjectID = await seedSchedule("search");
    const untouched: ObjectID = await seedSchedule("billing");

    await writeThroughTheApi(due, T0);
    await writeThroughTheApi(later, secondsAfter(T0, 20));

    // Before anything is due: nothing told.
    expect(
      await ScheduleLayerChanges.tellDueChanges(secondsAfter(T0, 29)),
    ).toBe(0);

    expect(
      await ScheduleLayerChanges.tellDueChanges(secondsAfter(T0, 31)),
    ).toBe(1);
    expect(told).toEqual([due.toString()]);
    expect(await heldUntil(due)).toBeNull();
    expect(await heldUntil(later)).not.toBeNull();

    expect(
      await ScheduleLayerChanges.tellDueChanges(secondsAfter(T0, 60)),
    ).toBe(1);
    expect(told).toEqual([due.toString(), later.toString()]);
    expect(await heldUntil(later)).toBeNull();

    // Told once: nothing is left to tell, and the schedule never held is never told.
    expect(
      await ScheduleLayerChanges.tellDueChanges(secondsAfter(T0, 600)),
    ).toBe(0);
    expect(told).not.toContain(untouched.toString());
    expect(await heldUntil(untouched)).toBeNull();
  });

  test("a write made while the change is told holds it again: told once more, after its own quiet period", async () => {
    const schedule: ObjectID = await seedSchedule("payments");

    await writeThroughTheApi(schedule, T0);

    // While the Workers tell it, the apply writes another row.
    (
      OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule as unknown as jest.Mock
    ).mockImplementationOnce((async (scheduleId: ObjectID) => {
      told.push(scheduleId.toString());
      await writeThroughTheApi(schedule, secondsAfter(T0, 31));
      return null;
    }) as never);

    expect(
      await ScheduleLayerChanges.tellDueChanges(secondsAfter(T0, 31)),
    ).toBe(1);

    // Not let go: the write's own hold stands.
    expect((await heldUntil(schedule))?.toISOString()).toBe(
      secondsAfter(T0, 61).toISOString(),
    );

    expect(
      await ScheduleLayerChanges.tellDueChanges(secondsAfter(T0, 62)),
    ).toBe(1);
    expect(told).toEqual([schedule.toString(), schedule.toString()]);
    expect(await heldUntil(schedule)).toBeNull();
  });
});
