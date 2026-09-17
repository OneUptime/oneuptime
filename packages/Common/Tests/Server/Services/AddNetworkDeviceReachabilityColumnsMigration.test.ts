import { AddNetworkDeviceReachabilityColumns1787600000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1787600000000-AddNetworkDeviceReachabilityColumns";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import { MigrationInterface, QueryRunner } from "typeorm";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration behind the reachability fix (issue #3220).
 *
 * Reachability moved from "lastSeenAt is recent" to "the last poll
 * succeeded", which needs two new columns. Four things have to hold or a
 * deployed instance is worse off than before the fix:
 *
 *   1. up() adds exactly lastPolledAt and isReachable, both nullable —
 *      NULL is the "never polled" state the UI renders as Pending, so a
 *      NOT NULL column or a default would put every existing device into a
 *      real verdict it has not earned;
 *   2. it backfills existing rows, because an unbackfilled fleet would read
 *      as entirely Pending on the first page load after an upgrade — every
 *      device gone from both the Up and Down lists;
 *   3. down() removes exactly what up() added;
 *   4. the migration is registered in SchemaMigrations/Index.ts. An
 *      unregistered migration never runs on boot, so the columns would be
 *      missing while every read and the walk pipeline write to them.
 *
 * Pure SQL-contract assertions against a fake QueryRunner. No Postgres.
 *
 * This file used to carry the ORDERING guard. It has moved on to
 * FixTotpOtpUrlAlgorithmMigration.test.ts, which is the newest registered
 * migration — the guard only says anything while it sits on the newest one.
 * What stays here is the file-on-disk check, which is about THIS migration
 * and stays true forever.
 */

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const MIGRATION_TIMESTAMP: string = "1787600000000";

type MakeQueryRunnerResult = {
  runner: QueryRunner;
  statements: Array<string>;
};

type MakeQueryRunnerFunction = () => MakeQueryRunnerResult;

const makeQueryRunner: MakeQueryRunnerFunction = (): MakeQueryRunnerResult => {
  const statements: Array<string> = [];

  const query: (...args: Array<unknown>) => Promise<undefined> = (
    ...args: Array<unknown>
  ): Promise<undefined> => {
    statements.push(String(args[0]));
    return Promise.resolve(undefined);
  };

  return {
    runner: { query } as unknown as QueryRunner,
    statements,
  };
};

describe("AddNetworkDeviceReachabilityColumns1787600000000 — SQL contract", () => {
  test("up() adds the two columns and backfills, in that order", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddNetworkDeviceReachabilityColumns1787600000000().up(runner);

    expect(statements).toEqual([
      `ALTER TABLE "NetworkDevice" ADD "lastPolledAt" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "NetworkDevice" ADD "isReachable" boolean`,
      `UPDATE "NetworkDevice" SET "lastPolledAt" = "lastSeenAt", "isReachable" = true WHERE "lastSeenAt" IS NOT NULL`,
    ]);
  });

  /*
   * NULL is a meaning here, not an absence: it is what the reachability rule
   * reads as "never polled" and the UI renders as a gray Pending pill. A
   * DEFAULT would give every pre-existing device a verdict on the strength
   * of nothing.
   */
  test("both columns are nullable with no default", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddNetworkDeviceReachabilityColumns1787600000000().up(runner);

    for (const statement of statements.filter((sql: string) => {
      return sql.includes("ALTER TABLE");
    })) {
      expect(statement).not.toContain("NOT NULL");
      expect(statement).not.toContain("DEFAULT");
    }
  });

  /*
   * A device with a lastSeenAt answered the last walk we have any record of
   * — there is no record of a failure — so it is seeded reachable with that
   * timestamp as its last attempt. Anything older than the staleness window
   * still reads Down through the ordinary rule, so this is not a
   * whitewash: it just declines to invent a failure that never happened.
   */
  test("the backfill only touches rows that have actually been seen", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddNetworkDeviceReachabilityColumns1787600000000().up(runner);

    const backfill: string = statements[2]!;

    expect(backfill).toContain(`WHERE "lastSeenAt" IS NOT NULL`);
    expect(backfill).toContain(`"lastPolledAt" = "lastSeenAt"`);
    expect(backfill).toContain(`"isReachable" = true`);
  });

  test("the backfill runs after the columns exist", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddNetworkDeviceReachabilityColumns1787600000000().up(runner);

    const lastAddIndex: number = Math.max(
      statements.findIndex((sql: string) => {
        return sql.includes(`ADD "lastPolledAt"`);
      }),
      statements.findIndex((sql: string) => {
        return sql.includes(`ADD "isReachable"`);
      }),
    );
    const backfillIndex: number = statements.findIndex((sql: string) => {
      return sql.startsWith("UPDATE");
    });

    expect(backfillIndex).toBeGreaterThan(lastAddIndex);
  });

  test("down() drops exactly what up() added, and nothing else", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddNetworkDeviceReachabilityColumns1787600000000().down(runner);

    expect(statements).toEqual([
      `ALTER TABLE "NetworkDevice" DROP COLUMN "isReachable"`,
      `ALTER TABLE "NetworkDevice" DROP COLUMN "lastPolledAt"`,
    ]);
  });

  /*
   * Not just "same count": the exact column names, derived from the two
   * statement sets rather than restated, so adding a column to up() without
   * adding it to down() fails here.
   */
  test("up() and down() name the same columns", async () => {
    const { runner: upRunner, statements: upStatements } = makeQueryRunner();
    const { runner: downRunner, statements: downStatements } =
      makeQueryRunner();

    await new AddNetworkDeviceReachabilityColumns1787600000000().up(upRunner);
    await new AddNetworkDeviceReachabilityColumns1787600000000().down(
      downRunner,
    );

    const columnsIn: (
      statements: Array<string>,
      keyword: string,
    ) => Array<string> = (
      statements: Array<string>,
      keyword: string,
    ): Array<string> => {
      return statements
        .filter((sql: string) => {
          return sql.includes(keyword);
        })
        .map((sql: string) => {
          return sql.split(`${keyword} "`)[1]!.split('"')[0]!;
        })
        .sort();
    };

    expect(columnsIn(downStatements, "DROP COLUMN")).toEqual(
      columnsIn(upStatements, "ADD"),
    );
  });
});

describe("registration", () => {
  /*
   * The step AGENTS.md calls out and the one that fails silently: a
   * migration that is not in this array never runs, so the columns are
   * missing in a real deployment while every read path and the walk
   * pipeline reference them.
   */
  test("the migration is registered so it runs on boot", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: new () => MigrationInterface): string => {
        return migration.name;
      },
    );

    expect(names).toContain("AddNetworkDeviceReachabilityColumns1787600000000");
  });

  test("it is registered exactly once", () => {
    const occurrences: number = SchemaMigrations.filter(
      (migration: new () => MigrationInterface): boolean => {
        return (
          migration.name === "AddNetworkDeviceReachabilityColumns1787600000000"
        );
      },
    ).length;

    expect(occurrences).toBe(1);
  });

  /*
   * TypeORM records applied migrations by the `name` property, not the file
   * name. A mismatch re-runs the migration on every boot.
   */
  test("its declared name matches its class name", () => {
    expect(new AddNetworkDeviceReachabilityColumns1787600000000().name).toBe(
      "AddNetworkDeviceReachabilityColumns1787600000000",
    );
  });
});

describe("identity on disk", () => {
  /*
   * The timestamp in the class name is the one on disk. A class renamed
   * without renaming its file — or two migrations landing on the same
   * timestamp — makes the registered ordering describe something that is not
   * what actually runs.
   */
  test("exactly one file on disk carries its timestamp, and it is this one", () => {
    const matching: Array<string> = fs
      .readdirSync(MIGRATION_DIRECTORY)
      .filter((file: string): boolean => {
        return file.startsWith(`${MIGRATION_TIMESTAMP}-`);
      });

    expect(matching).toEqual([
      `${MIGRATION_TIMESTAMP}-AddNetworkDeviceReachabilityColumns.ts`,
    ]);
  });
});

/*
 * The model side of the same contract. TypeORM generates the schema from
 * these decorators, so a column that exists in the migration but not on the
 * model (or vice versa) is exactly the drift the Postgres Schema Drift
 * workflow fails on.
 */
describe("the NetworkDevice model carries the columns the migration adds", () => {
  test("lastPolledAt and isReachable are declared on the model", () => {
    const device: NetworkDevice = new NetworkDevice();

    expect("lastPolledAt" in device).toBe(true);
    expect("isReachable" in device).toBe(true);
  });

  test("they default to undefined, not to a fabricated verdict", () => {
    const device: NetworkDevice = new NetworkDevice();

    expect(device.lastPolledAt).toBeUndefined();
    expect(device.isReachable).toBeUndefined();
  });

  test("a walk can set them independently of lastSeenAt", () => {
    const device: NetworkDevice = new NetworkDevice();
    const now: Date = new Date("2026-08-18T12:00:00.000Z");

    device.lastPolledAt = now;
    device.isReachable = false;

    expect(device.lastPolledAt).toEqual(now);
    expect(device.isReachable).toBe(false);
    // A failed poll never moves the last successful contact.
    expect(device.lastSeenAt).toBeUndefined();
  });
});
