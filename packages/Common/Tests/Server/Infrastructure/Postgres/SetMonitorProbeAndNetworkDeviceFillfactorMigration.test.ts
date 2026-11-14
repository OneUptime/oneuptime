import { SetMonitorProbeAndNetworkDeviceFillfactor1809151200000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809151200000-SetMonitorProbeAndNetworkDeviceFillfactor";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { QueryRunner } from "typeorm";
import { describe, expect, test } from "@jest/globals";

/*
 * ROOM ON EVERY PAGE FOR THE NEXT UPDATE (issue #7921).
 *
 * "MonitorProbe" and "NetworkDevice" are rewritten all day, and only an
 * update that fits on its row's page can be HOT. The migration keeps room
 * on each page for that: a tenth of MonitorProbe's (fillfactor 90, where
 * every probe result already stays HOT), a fifth of NetworkDevice's
 * (fillfactor 80, measured better than 90 there: a poll writes a device
 * three times, where a check writes a monitor probe twice). TypeORM does
 * not model storage parameters, so the migration is written by hand and
 * the schema drift check cannot catch a change to it: these assertions pin
 * its statements.
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

describe("SetMonitorProbeAndNetworkDeviceFillfactor1809151200000", () => {
  test("keeps room on every page of both tables - and does nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new SetMonitorProbeAndNetworkDeviceFillfactor1809151200000().up(
          runner,
        );
      }),
    ).toEqual([
      `ALTER TABLE "MonitorProbe" SET (fillfactor = 90)`,
      `ALTER TABLE "NetworkDevice" SET (fillfactor = 80)`,
    ]);
  });

  test("down() gives both tables the default back", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new SetMonitorProbeAndNetworkDeviceFillfactor1809151200000().down(
          runner,
        );
      }),
    ).toEqual([
      `ALTER TABLE "NetworkDevice" RESET (fillfactor)`,
      `ALTER TABLE "MonitorProbe" RESET (fillfactor)`,
    ]);
  });

  test("every statement only sets a storage parameter: SHARE UPDATE EXCLUSIVE, no rewrite", async () => {
    const migration: SetMonitorProbeAndNetworkDeviceFillfactor1809151200000 =
      new SetMonitorProbeAndNetworkDeviceFillfactor1809151200000();
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
        new SetMonitorProbeAndNetworkDeviceFillfactor1809151200000() as {
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
          candidate === SetMonitorProbeAndNetworkDeviceFillfactor1809151200000
        );
      }),
    ).toHaveLength(1);
    expect(
      names.indexOf("SetMonitorProbeAndNetworkDeviceFillfactor1809151200000"),
    ).toBeGreaterThan(
      names.indexOf(
        "DropNetworkDeviceLastSeenAtAndProjectIdIndexes1809151100000",
      ),
    );
    expect(
      new SetMonitorProbeAndNetworkDeviceFillfactor1809151200000().name,
    ).toBe("SetMonitorProbeAndNetworkDeviceFillfactor1809151200000");
  });
});
