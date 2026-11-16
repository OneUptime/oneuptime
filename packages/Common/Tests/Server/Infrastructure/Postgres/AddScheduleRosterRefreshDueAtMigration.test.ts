import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddScheduleRosterRefreshDueAt1809181500000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809181500000-AddScheduleRosterRefreshDueAt";
import { AddScheduleRosterRefreshDueAtIndex1809181510000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809181510000-AddScheduleRosterRefreshDueAtIndex";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { DefaultNamingStrategy, QueryRunner } from "typeorm";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHEN A CHANGE TO A SCHEDULE'S LAYERS MADE THROUGH THE API IS TOLD (issue
 * #7813): OnCallDutyPolicySchedule.rosterRefreshDueAt, and the partial index
 * the Workers find the changes that are due by.
 *
 * The column is added without rewriting the table: nullable, no default.
 * The index is built online, in a migration of its own outside a
 * transaction: every roster hand-off writes the table. Pure SQL-contract
 * assertions against a fake QueryRunner; OnlineDdl's own steps are recorded
 * as "online: <statement>". The index's name is TypeORM's own, so the drift
 * check finds nothing to change.
 */

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

// The 13-digit timestamp a migration class is named with.
const MIGRATION_TIMESTAMP: RegExp = /(\d{13})$/;

const TABLE: string = "OnCallDutyPolicySchedule";
const WHERE: string = '"rosterRefreshDueAt" IS NOT NULL';
const INDEX: string = namingStrategy.indexName(
  TABLE,
  ["rosterRefreshDueAt"],
  WHERE,
);

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

function positionOf(migration: unknown): number {
  return (SchemaMigrations as Array<unknown>).indexOf(migration);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AddScheduleRosterRefreshDueAt1809181500000", () => {
  test("adds the column - nullable, no default - in a transaction, and nothing else", async () => {
    const migration: AddScheduleRosterRefreshDueAt1809181500000 =
      new AddScheduleRosterRefreshDueAt1809181500000();

    expect(
      (migration as unknown as { transaction?: boolean }).transaction,
    ).toBeUndefined();
    expect(
      await statementsOf(
        (runner: QueryRunner) => {
          return migration.up(runner);
        },
        { isTransactionActive: true },
      ),
    ).toEqual([
      `ALTER TABLE "${TABLE}" ADD "rosterRefreshDueAt" TIMESTAMP WITH TIME ZONE`,
    ]);
  });

  test("down() drops the column", async () => {
    expect(
      await statementsOf(
        (runner: QueryRunner) => {
          return new AddScheduleRosterRefreshDueAt1809181500000().down(runner);
        },
        { isTransactionActive: true },
      ),
    ).toEqual([`ALTER TABLE "${TABLE}" DROP COLUMN "rosterRefreshDueAt"`]);
  });
});

describe("AddScheduleRosterRefreshDueAtIndex1809181510000", () => {
  test("the index is named as TypeORM names it", () => {
    expect(INDEX).toBe("IDX_d242a03092195f79e2e425ea62");
  });

  test("builds the partial index online, outside a transaction", async () => {
    const migration: AddScheduleRosterRefreshDueAtIndex1809181510000 =
      new AddScheduleRosterRefreshDueAtIndex1809181510000();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf(
        (runner: QueryRunner) => {
          return migration.up(runner);
        },
        { isTransactionActive: false },
      ),
    ).toEqual([
      `online: CREATE INDEX "${INDEX}" ON "${TABLE}" ("rosterRefreshDueAt") WHERE ${WHERE}`,
    ]);
  });

  test("OnlineDdl reads the build as one it can run concurrently, its predicate kept", () => {
    const build: string = OnlineDdl.parseCreateIndex(
      `CREATE INDEX "${INDEX}" ON "${TABLE}" ("rosterRefreshDueAt") WHERE ${WHERE}`,
    ).build;

    expect(build).toContain("CREATE INDEX CONCURRENTLY IF NOT EXISTS");
    expect(build).toContain(`WHERE ${WHERE}`);
  });

  test("down() drops it online", async () => {
    expect(
      await statementsOf(
        (runner: QueryRunner) => {
          return new AddScheduleRosterRefreshDueAtIndex1809181510000().down(
            runner,
          );
        },
        { isTransactionActive: true },
      ),
    ).toEqual([`online: DROP INDEX "public"."${INDEX}"`]);
  });
});

describe("registration", () => {
  test("each is registered once, the column before its index, after every migration before them, and named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    for (const migration of [
      AddScheduleRosterRefreshDueAt1809181500000,
      AddScheduleRosterRefreshDueAtIndex1809181510000,
    ]) {
      expect(
        registered.filter((candidate: unknown): boolean => {
          return candidate === migration;
        }),
      ).toHaveLength(1);
    }

    expect(positionOf(AddScheduleRosterRefreshDueAtIndex1809181510000)).toBe(
      positionOf(AddScheduleRosterRefreshDueAt1809181500000) + 1,
    );

    const timestamps: Array<number> = registered.map((migration: unknown) => {
      return Number(
        MIGRATION_TIMESTAMP.exec((migration as { name: string }).name)?.[1] ||
          0,
      );
    });

    expect(
      Math.max(
        ...timestamps.slice(
          0,
          positionOf(AddScheduleRosterRefreshDueAt1809181500000),
        ),
      ),
    ).toBeLessThan(1809181500000);
    expect(new AddScheduleRosterRefreshDueAt1809181500000().name).toBe(
      "AddScheduleRosterRefreshDueAt1809181500000",
    );
    expect(new AddScheduleRosterRefreshDueAtIndex1809181510000().name).toBe(
      "AddScheduleRosterRefreshDueAtIndex1809181510000",
    );
  });
});
