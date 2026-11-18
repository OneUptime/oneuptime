import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { DropOnCallExecutionLogStepIndexes1809182000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182000000-DropOnCallExecutionLogStepIndexes";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * AN ESCALATION STEP WRITES NO INDEX NOBODY READS (issue #8104).
 *
 * Every escalation step of an on-call run writes when its level started
 * (lastEscalationRuleExecutedAt - the claim that moves the run on writes
 * it alone), the level's order and wait, and a new pass's count. Each of
 * those columns had a bare index that nothing read: every reader reads a
 * run by its _id or its status (OnCallExecutionLogStepColumnReads says
 * where), and the On-Call Policy Logs list filters and sorts by none of
 * them. So every step's update changed an indexed column, could not be
 * HOT, and wrote all fourteen of the table's indexes.
 *
 * The four go, online. "lastExecutedEscalationRuleId" keeps its index: the
 * ON DELETE of an escalation rule (SET NULL since issue #9036, CASCADE
 * before) finds the runs that last executed it by it.
 *
 * Pure SQL-contract assertions against a fake QueryRunner; OnlineDdl's own
 * steps are recorded as "online: <statement>". The names are TypeORM's own,
 * so the drift check finds nothing to change.
 */

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

// The 13-digit timestamp a migration class is named with.
const MIGRATION_TIMESTAMP: RegExp = /(\d{13})$/;

const TABLE: string = "OnCallDutyPolicyExecutionLog";

// The columns whose bare index goes, in the order the migration drops them.
const DROPPED_COLUMNS: Array<string> = [
  "lastExecutedEscalationRuleOrder",
  "lastEscalationRuleExecutedAt",
  "executeNextEscalationRuleInMinutes",
  "onCallPolicyExecutionRepeatCount",
];

function indexOf(columns: Array<string>): string {
  return namingStrategy.indexName(TABLE, columns);
}

// The model's indexes, as TypeORM reads them: a property's @Index() is one of that one column.
function modelIndexes(): Array<string> {
  return getMetadataArgsStorage()
    .indices.filter((index: IndexMetadataArgs): boolean => {
      return index.target === OnCallDutyPolicyExecutionLog;
    })
    .map((index: IndexMetadataArgs): string => {
      return JSON.stringify(index.columns);
    });
}

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
  options: { isTransactionActive: boolean },
): Promise<Array<string>> {
  const statements: Array<string> = [];

  for (const step of ["createIndex", "dropIndex"] as const) {
    jest.spyOn(OnlineDdl, step).mockImplementation((async (
      _runner: QueryRunner,
      statement: string,
    ) => {
      statements.push(`online: ${statement}`);
    }) as never);
  }

  await run({
    isTransactionActive: options.isTransactionActive,
    query: (sql: string): Promise<undefined> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  return statements;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("DropOnCallExecutionLogStepIndexes1809182000000", () => {
  test("the indexes are named as TypeORM names them, as the first migration built them", () => {
    expect(
      DROPPED_COLUMNS.map((column: string): string => {
        return indexOf([column]);
      }),
    ).toEqual([
      "IDX_fbb50489ef5eb354f46d479e2a",
      "IDX_296e2be818e3fba28e43b457fb",
      "IDX_6ad07641fe00f29edc65716aca",
      "IDX_a217798f1dbf12d31b498a1020",
    ]);
    expect(indexOf(["lastExecutedEscalationRuleId"])).toBe(
      "IDX_d4a0ffc5e9e698bb2612ba0e55",
    );
  });

  test("the model indexes none of the columns a step writes alone", () => {
    const indexes: Array<string> = modelIndexes();

    for (const column of DROPPED_COLUMNS) {
      expect(indexes).not.toContain(JSON.stringify([column]));

      // Nor in an index of several.
      for (const index of indexes) {
        expect(JSON.parse(index) as Array<string>).not.toContain(column);
      }
    }
  });

  test("the model keeps the indexes that are read: the rule a run is on (the cascade), its status, the lists, what triggered it, a monitor's fire drills", () => {
    const indexes: Array<string> = modelIndexes();

    for (const columns of [
      ["lastExecutedEscalationRuleId"],
      ["status"],
      ["projectId", "createdAt"],
      ["onCallDutyPolicyId", "createdAt"],
      ["acknowledgementTimeoutStartedAt"],
      ["triggeredByIncidentId"],
      ["triggeredByAlertId"],
      ["triggeredByAlertEpisodeId"],
      ["triggeredByIncidentEpisodeId"],
      /*
       * A monitor's fire drills, newest first (#9386,
       * AddOnCallFireDrillResultsIndexAndKey1809183110000): the monitor's
       * When this goes down card reads its last drill by it, and a deleted
       * monitor's ON DELETE SET NULL finds its drills' tests by it. Partial
       * - only a drill's tests name a monitor - and on no column a step
       * writes, so a step's update stays HOT.
       */
      ["testPageFireDrillMonitorId", "createdAt"],
    ]) {
      expect(indexes).toContain(JSON.stringify(columns));
    }

    /*
     * Ten indexes besides the primary key: thirteen, less the four a step
     * wrote, and a monitor's fire drills' since.
     */
    expect(indexes).toHaveLength(10);
  });

  test("drops the four indexes online, outside a transaction, and nothing else", async () => {
    const migration: DropOnCallExecutionLogStepIndexes1809182000000 =
      new DropOnCallExecutionLogStepIndexes1809182000000();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf(
        (runner: QueryRunner) => {
          return migration.up(runner);
        },
        { isTransactionActive: false },
      ),
    ).toEqual(
      DROPPED_COLUMNS.map((column: string): string => {
        return `online: DROP INDEX "public"."${indexOf([column])}"`;
      }),
    );
  });

  test("OnlineDdl drops each one CONCURRENTLY, and leaves an index already gone alone", async () => {
    const statements: Array<string> = [];

    // OnlineDdl sends the drop itself through the connection's own client.
    const runner: QueryRunner = {
      isTransactionActive: false,
      query: (sql: string): Promise<undefined> => {
        statements.push(sql);
        return Promise.resolve(undefined);
      },
      connect: (): Promise<unknown> => {
        return Promise.resolve({
          query: (request: { text: string }): Promise<undefined> => {
            statements.push(request.text);
            return Promise.resolve(undefined);
          },
        });
      },
    } as unknown as QueryRunner;

    await new DropOnCallExecutionLogStepIndexes1809182000000().up(runner);

    expect(
      statements.filter((sql: string): boolean => {
        return sql.startsWith("DROP INDEX");
      }),
    ).toEqual(
      DROPPED_COLUMNS.map((column: string): string => {
        return `DROP INDEX CONCURRENTLY IF EXISTS "public"."${indexOf([column])}"`;
      }),
    );
  });

  test("down() builds each index again on its column, as the generator wrote it", async () => {
    expect(
      await statementsOf(
        (runner: QueryRunner) => {
          return new DropOnCallExecutionLogStepIndexes1809182000000().down(
            runner,
          );
        },
        { isTransactionActive: true },
      ),
    ).toEqual(
      [...DROPPED_COLUMNS].reverse().map((column: string): string => {
        return `CREATE INDEX "${indexOf([column])}" ON "${TABLE}" ("${column}") `;
      }),
    );
  });

  test("is registered once, after every migration registered before it, and named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === DropOnCallExecutionLogStepIndexes1809182000000;
      }),
    ).toHaveLength(1);

    const position: number = registered.indexOf(
      DropOnCallExecutionLogStepIndexes1809182000000,
    );
    const timestamps: Array<number> = registered.map((migration: unknown) => {
      return Number(
        MIGRATION_TIMESTAMP.exec((migration as { name: string }).name)?.[1] ||
          0,
      );
    });

    expect(Math.max(...timestamps.slice(0, position))).toBeLessThan(
      1809182000000,
    );
    expect(new DropOnCallExecutionLogStepIndexes1809182000000().name).toBe(
      "DropOnCallExecutionLogStepIndexes1809182000000",
    );
  });
});
