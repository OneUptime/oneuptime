import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
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
 * WHAT AN ESCALATION STEP WRITES TO "OnCallDutyPolicyExecutionLog", ON
 * POSTGRES (issue #8104).
 *
 * Every step of an on-call run writes when its level started, and moving a
 * run on starts with a claim that writes that column alone
 * (claimEscalationAdvance); a new pass writes its count. Each of those
 * columns had a bare index nothing read, so each such update changed an
 * indexed column, could not be HOT, and wrote all fourteen of the table's
 * indexes. DropOnCallExecutionLogStepIndexes1809182000000 took them away.
 * Only a database answers whether that holds, so this copies the migrated
 * table - its indexes as the migrations left them - and runs the service's
 * own statements on it, reading pg_stat_user_tables after each:
 *
 *   - no index on the table names a column the claim or a pass's count
 *     writes (or updatedAt and version, which every update writes), and
 *     the rule a run is on keeps its index, which the ON DELETE SET NULL
 *     of an escalation rule reads (issue #9036) - as a monitor's fire
 *     drills keep theirs (#9386), partial, on no column a step writes;
 *   - a claim, and its give-back, are HOT: no index entry written;
 *   - a level's start, which changes the rule a run is on, is not - it
 *     writes the table's remaining indexes, ten with the key (the fire
 *     drills' holds a drill's tests alone).
 *
 * Opt in with RUN_POSTGRES_ON_CALL_EXECUTION_LOG_WRITES_TESTS=true against
 * a migrated database (ON_CALL_EXECUTION_LOG_WRITES_TEST_DATABASE_HOST,
 * _PORT, _NAME; DATABASE_USERNAME, DATABASE_PASSWORD). The table's
 * structure is cloned into a schema of its own that is dropped afterwards.
 * One connection, so each statement's counts are flushed before they are
 * read (pg_stat_force_next_flush).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_ON_CALL_EXECUTION_LOG_WRITES_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLE: string = "OnCallDutyPolicyExecutionLog";

// What a claim, its give-back and a pass's count write - and every update with them.
const STEP_WRITTEN_COLUMNS: Array<string> = [
  "lastEscalationRuleExecutedAt",
  "lastExecutedEscalationRuleOrder",
  "executeNextEscalationRuleInMinutes",
  "onCallPolicyExecutionRepeatCount",
  "updatedAt",
  "version",
];

interface TableCounts {
  updates: number;
  hot: number;
}

describePostgres("an escalation step's writes, against Postgres", () => {
  const schema: string = `oncall_step_writes_${ObjectID.generate().toString().replace(/-/g, "")}`;
  let database: DataSource;

  async function counts(): Promise<TableCounts> {
    await database.query("SELECT pg_stat_force_next_flush()");

    const rows: Array<{ n_tup_upd: string; n_tup_hot_upd: string }> =
      await database.query(
        `SELECT n_tup_upd, n_tup_hot_upd FROM pg_stat_user_tables WHERE schemaname = $1 AND relname = $2`,
        [schema, TABLE],
      );

    return {
      updates: Number(rows[0]?.n_tup_upd || 0),
      hot: Number(rows[0]?.n_tup_hot_upd || 0),
    };
  }

  // A run on its first level, as the worker leaves it.
  async function seedRun(startedAt: Date): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."${TABLE}" ("_id", "version", "projectId", "onCallDutyPolicyId", "status", "statusMessage", "userNotificationEventType", "lastEscalationRuleExecutedAt", "lastExecutedEscalationRuleId", "lastExecutedEscalationRuleOrder", "executeNextEscalationRuleInMinutes") VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, 1, 15)`,
      [
        id.toString(),
        ObjectID.generate().toString(),
        ObjectID.generate().toString(),
        OnCallDutyPolicyStatus.Executing,
        "Executing the first escalation rule.",
        "Incident Created",
        startedAt,
        ObjectID.generate().toString(),
      ],
    );

    return id;
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["ON_CALL_EXECUTION_LOG_WRITES_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["ON_CALL_EXECUTION_LOG_WRITES_TEST_DATABASE_PORT"] ||
          "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["ON_CALL_EXECUTION_LOG_WRITES_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      // One connection: a statement's counts are flushed by the next on it.
      extra: { options: `-c search_path=${schema},public`, max: 1 },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."${TABLE}" (LIKE public."${TABLE}" INCLUDING ALL)`,
    );
  });

  beforeEach(() => {
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
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

  test("no index names a column a claim or a pass's count writes; the rule a run is on keeps its index, and a monitor's fire drills theirs", async () => {
    // Each index's columns in its own order, and its WHERE when it is partial.
    const indexes: Array<{
      indexname: string;
      columns: Array<string>;
      predicate: string | null;
    }> = await database.query(
      `SELECT i.relname AS indexname,
              ARRAY(
                SELECT a.attname::text
                  FROM unnest(x.indkey::int2[]) WITH ORDINALITY AS k(attnum, place)
                  JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = k.attnum
                 ORDER BY k.place
              ) AS columns,
              pg_get_expr(x.indpred, x.indrelid) AS predicate
         FROM pg_index x
         JOIN pg_class i ON i.oid = x.indexrelid
         JOIN pg_class t ON t.oid = x.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = $1 AND t.relname = $2`,
      [schema, TABLE],
    );

    /*
     * Eleven, with the key: four went (DropOnCallExecutionLogStepIndexes
     * 1809182000000), and a monitor's fire drills' came
     * (AddOnCallFireDrillResultsIndexAndKey1809183110000).
     */
    expect(indexes).toHaveLength(11);

    for (const index of indexes) {
      for (const column of STEP_WRITTEN_COLUMNS) {
        expect({
          index: index.indexname,
          column,
          named: index.columns.includes(column),
        }).toEqual({
          index: index.indexname,
          column,
          named: false,
        });
      }
    }

    expect(
      indexes.some((index: { columns: Array<string> }): boolean => {
        return (
          index.columns.length === 1 &&
          index.columns[0] === "lastExecutedEscalationRuleId"
        );
      }),
    ).toBe(true);

    /*
     * A monitor's fire drills, newest first (#9386): the monitor's last
     * drill is read by it, and a deleted monitor's ON DELETE SET NULL finds
     * its drills' tests by it. Partial - only a drill's tests name a
     * monitor - so a level's start of any other run writes nothing to it.
     */
    expect(
      indexes
        .filter((index: { columns: Array<string> }): boolean => {
          return index.columns.includes("testPageFireDrillMonitorId");
        })
        .map(
          (index: {
            columns: Array<string>;
            predicate: string | null;
          }): { columns: Array<string>; predicate: string | null } => {
            return { columns: index.columns, predicate: index.predicate };
          },
        ),
    ).toEqual([
      {
        columns: ["testPageFireDrillMonitorId", "createdAt"],
        predicate: '("testPageFireDrillMonitorId" IS NOT NULL)',
      },
    ]);
  });

  test("a claim that moves a run on is a HOT update, and so is its give-back", async () => {
    const startedAt: Date = new Date("2026-03-03T12:00:00.000Z");
    const claimedAt: Date = new Date("2026-03-03T12:15:00.000Z");
    const run: ObjectID = await seedRun(startedAt);

    const before: TableCounts = await counts();

    expect(
      await OnCallDutyPolicyExecutionLogService.claimEscalationAdvance({
        executionLogId: run,
        previousLastEscalationRuleExecutedAt: startedAt,
        newLastEscalationRuleExecutedAt: claimedAt,
      }),
    ).toBe(true);

    const afterClaim: TableCounts = await counts();

    expect(afterClaim.updates - before.updates).toBe(1);
    expect(afterClaim.hot - before.hot).toBe(1);

    // A claim made with what was read before it is refused: one wins.
    expect(
      await OnCallDutyPolicyExecutionLogService.claimEscalationAdvance({
        executionLogId: run,
        previousLastEscalationRuleExecutedAt: startedAt,
        newLastEscalationRuleExecutedAt: claimedAt,
      }),
    ).toBe(false);

    const rows: Array<{ lastExecutedEscalationRuleId: string }> =
      await database.query(
        `SELECT "lastExecutedEscalationRuleId" FROM "${schema}"."${TABLE}" WHERE "_id" = $1`,
        [run.toString()],
      );

    expect(
      await OnCallDutyPolicyExecutionLogService.giveBackEscalationAdvance({
        executionLogId: run,
        claimedLastEscalationRuleExecutedAt: claimedAt,
        previousLastEscalationRuleExecutedAt: startedAt,
        lastExecutedEscalationRuleId: new ObjectID(
          rows[0]!.lastExecutedEscalationRuleId,
        ),
        onCallPolicyExecutionRepeatCount: 1,
        throwOnError: true,
      }),
    ).toBe(true);

    const afterGiveBack: TableCounts = await counts();

    expect(afterGiveBack.updates - afterClaim.updates).toBe(1);
    expect(afterGiveBack.hot - afterClaim.hot).toBe(1);
  });

  test("a level's start, which changes the rule the run is on, is not HOT: that index is read by a rule's ON DELETE", async () => {
    const run: ObjectID = await seedRun(new Date("2026-03-03T12:00:00.000Z"));

    const before: TableCounts = await counts();

    await database.query(
      `UPDATE "${schema}"."${TABLE}" SET "lastEscalationRuleExecutedAt" = $1, "lastExecutedEscalationRuleId" = $2, "lastExecutedEscalationRuleOrder" = 2, "executeNextEscalationRuleInMinutes" = 15, "updatedAt" = CURRENT_TIMESTAMP, "version" = "version" + 1 WHERE "_id" = $3`,
      [
        new Date("2026-03-03T12:15:00.000Z"),
        ObjectID.generate().toString(),
        run.toString(),
      ],
    );

    const after: TableCounts = await counts();

    expect(after.updates - before.updates).toBe(1);
    expect(after.hot - before.hot).toBe(0);
  });
});
