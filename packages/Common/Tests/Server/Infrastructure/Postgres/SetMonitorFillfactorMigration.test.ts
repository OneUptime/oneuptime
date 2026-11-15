import { SetMonitorFillfactor1809172000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809172000000-SetMonitorFillfactor";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { QueryRunner } from "typeorm";
import { describe, expect, test } from "@jest/globals";

/*
 * ROOM ON EVERY "MONITOR" PAGE FOR THE NEXT UPDATE (issue #8095).
 *
 * The telemetry sweep's stamps, the heartbeats and every server report
 * rewrite "Monitor" rows all day. Since MatchMonitorIndexesToTheirReads
 * none of them moves an indexed column, so each can be HOT - if it fits on
 * its row's page. The migration keeps a tenth of each page free for that
 * (fillfactor 90): on a seeded table, HOT updates went from 84% to 95% of
 * those writes. TypeORM does not model storage parameters, so the migration
 * is written by hand and the schema drift check cannot catch a change to
 * it: these assertions pin its statements.
 *
 * They also pin what keeps it harmless on a table every heartbeat writes.
 * ALTER TABLE ... SET / RESET of fillfactor takes SHARE UPDATE EXCLUSIVE -
 * no read or write waits for it - and rewrites nothing. An ALTER TABLE that
 * does anything else here (a column, a constraint, a tablespace) takes
 * ACCESS EXCLUSIVE, and some rewrite the table under it.
 */

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> {
  const statements: Array<string> = [];

  await run({
    isTransactionActive: true,
    query: (sql: string): Promise<undefined> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  return statements;
}

const STORAGE_PARAMETER_ONLY: RegExp =
  /^ALTER TABLE "Monitor" (SET \(fillfactor = \d+\)|RESET \(fillfactor\))$/;

describe("SetMonitorFillfactor1809172000000", () => {
  test("keeps a tenth of every Monitor page free - and does nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new SetMonitorFillfactor1809172000000().up(runner);
      }),
    ).toEqual([`ALTER TABLE "Monitor" SET (fillfactor = 90)`]);
  });

  test("down() gives the table the default back", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new SetMonitorFillfactor1809172000000().down(runner);
      }),
    ).toEqual([`ALTER TABLE "Monitor" RESET (fillfactor)`]);
  });

  test("every statement only sets a storage parameter: SHARE UPDATE EXCLUSIVE, no rewrite", async () => {
    const migration: SetMonitorFillfactor1809172000000 =
      new SetMonitorFillfactor1809172000000();
    const statements: Array<string> = [
      ...(await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      })),
      ...(await statementsOf((runner: QueryRunner) => {
        return migration.down(runner);
      })),
    ];

    expect(statements).toHaveLength(2);
    expect(
      statements.filter((statement: string): boolean => {
        return !STORAGE_PARAMETER_ONLY.test(statement);
      }),
    ).toEqual([]);
  });

  /*
   * In a transaction of its own, like any migration: its lock is held for
   * the instant the statement takes, and SchemaMigrationRunner bounds the
   * wait for it. It waits only for what takes the same lock on the table -
   * a vacuum, an ANALYZE, an online index build - and an autovacuum gives
   * way to it.
   */
  test("runs in a transaction: nothing in it needs to run outside one", () => {
    expect(
      (new SetMonitorFillfactor1809172000000() as { transaction?: boolean })
        .transaction,
    ).not.toBe(false);
  });

  test("is registered once, after the Monitor index migration, and named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const names: Array<string> = registered.map((migration: unknown) => {
      return (migration as { name: string }).name;
    });

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === SetMonitorFillfactor1809172000000;
      }),
    ).toHaveLength(1);
    expect(names.indexOf("SetMonitorFillfactor1809172000000")).toBeGreaterThan(
      names.indexOf("MatchMonitorIndexesToTheirReads1809165000000"),
    );
    expect(new SetMonitorFillfactor1809172000000().name).toBe(
      "SetMonitorFillfactor1809172000000",
    );
  });
});
