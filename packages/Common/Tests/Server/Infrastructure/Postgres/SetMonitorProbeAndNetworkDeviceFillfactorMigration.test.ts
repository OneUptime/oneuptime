import { SetMonitorProbeAndNetworkDeviceFillfactor1809150600000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809150600000-SetMonitorProbeAndNetworkDeviceFillfactor";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { QueryRunner } from "typeorm";
import { describe, expect, test } from "@jest/globals";

/*
 * ROOM ON EVERY PAGE FOR THE NEXT UPDATE (issue #7921).
 *
 * "MonitorProbe" and "NetworkDevice" are rewritten all day, and only an
 * update that fits on its row's page can be HOT. The migration keeps a
 * tenth of each page free for that (fillfactor 90). TypeORM does not model
 * storage parameters, so the migration is written by hand and the schema
 * drift check cannot catch a change to it: these assertions pin its
 * statements.
 *
 * They also pin what keeps it harmless on two tables probes write all the
 * time. ALTER TABLE ... SET / RESET of fillfactor takes SHARE UPDATE
 * EXCLUSIVE - no read or write waits for it - and rewrites nothing. An
 * ALTER TABLE that does anything else here (a column, a constraint, a
 * tablespace) takes ACCESS EXCLUSIVE, and some rewrite the table under it.
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
  /^ALTER TABLE "(MonitorProbe|NetworkDevice)" (SET \(fillfactor = \d+\)|RESET \(fillfactor\))$/;

describe("SetMonitorProbeAndNetworkDeviceFillfactor1809150600000", () => {
  test("keeps a tenth of every page of both tables free - and does nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new SetMonitorProbeAndNetworkDeviceFillfactor1809150600000().up(
          runner,
        );
      }),
    ).toEqual([
      `ALTER TABLE "MonitorProbe" SET (fillfactor = 90)`,
      `ALTER TABLE "NetworkDevice" SET (fillfactor = 90)`,
    ]);
  });

  test("down() gives both tables the default back", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new SetMonitorProbeAndNetworkDeviceFillfactor1809150600000().down(
          runner,
        );
      }),
    ).toEqual([
      `ALTER TABLE "NetworkDevice" RESET (fillfactor)`,
      `ALTER TABLE "MonitorProbe" RESET (fillfactor)`,
    ]);
  });

  test("every statement only sets a storage parameter: SHARE UPDATE EXCLUSIVE, no rewrite", async () => {
    const migration: SetMonitorProbeAndNetworkDeviceFillfactor1809150600000 =
      new SetMonitorProbeAndNetworkDeviceFillfactor1809150600000();
    const statements: Array<string> = [
      ...(await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      })),
      ...(await statementsOf((runner: QueryRunner) => {
        return migration.down(runner);
      })),
    ];

    expect(
      statements.filter((statement: string): boolean => {
        return !STORAGE_PARAMETER_ONLY.test(statement);
      }),
    ).toEqual([]);
  });

  /*
   * In a transaction of its own, like any migration: its lock is held for
   * the instant the two statements take, and SchemaMigrationRunner bounds
   * the wait for it. It waits only for what takes the same lock on the
   * table - a vacuum, an ANALYZE, an online index build - and an autovacuum
   * gives way to it.
   */
  test("runs in a transaction: nothing in it needs to run outside one", () => {
    expect(
      (
        new SetMonitorProbeAndNetworkDeviceFillfactor1809150600000() as {
          transaction?: boolean;
        }
      ).transaction,
    ).not.toBe(false);
  });

  test("is registered once, after the migration before it, and named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const names: Array<string> = registered.map((migration: unknown) => {
      return (migration as { name: string }).name;
    });

    expect(
      registered.filter((candidate: unknown): boolean => {
        return (
          candidate === SetMonitorProbeAndNetworkDeviceFillfactor1809150600000
        );
      }),
    ).toHaveLength(1);
    expect(
      names.indexOf("SetMonitorProbeAndNetworkDeviceFillfactor1809150600000"),
    ).toBeGreaterThan(
      names.indexOf(
        "DropNetworkDeviceLastSeenAtAndProjectIdIndexes1809150500000",
      ),
    );
    expect(
      new SetMonitorProbeAndNetworkDeviceFillfactor1809150600000().name,
    ).toBe("SetMonitorProbeAndNetworkDeviceFillfactor1809150600000");
  });
});
