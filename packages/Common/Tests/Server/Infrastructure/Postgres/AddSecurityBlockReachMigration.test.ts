import { AddSecurityBlockReachAndWiderValue1809187421200 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187421200-AddSecurityBlockReachAndWiderValue";
import { AddSecurityBlockValueReachIndex1809187421210 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187421210-AddSecurityBlockValueReachIndex";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import OnlineDdl, {
  OnlineIndex,
} from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import SecurityBlock from "../../../../Models/DatabaseModels/SecurityBlock";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";

/*
 * The migrations that let the blocklist hold domains, URLs and files, and
 * an address blocked everywhere (#10346):
 *
 *   AddSecurityBlockReachAndWiderValue  "reach" (Edge for every block made
 *                                       before), "value" widened to 500 in
 *                                       place, the one-per-value index dropped;
 *   AddSecurityBlockValueReachIndex     the one-per-value-and-reach index,
 *                                       built online.
 *
 * The drift check proves the schema matches the model. This pins what a
 * regeneration could silently reverse:
 *
 *  1. THE VALUE IS WIDENED IN PLACE. TypeORM writes a length change as DROP
 *     COLUMN + ADD, which loses every block's value and fails outright on a
 *     table with a row (ADD ... NOT NULL, no default). ALTER COLUMN ... TYPE
 *     keeps them, and rewrites nothing.
 *  2. EVERY BLOCK MADE BEFORE IS AT THE EDGE: "reach" defaults to Edge.
 *  3. ONE ACTIVE BLOCK PER VALUE AND REACH, among the active rows only, built
 *     CONCURRENTLY in a migration without a transaction, after the first.
 *  4. down() puts back the blocklist before: what it cannot hold - a
 *     domain's, a URL's or a file's block, an address blocked everywhere
 *     beside its block at the edge - is taken away first.
 */

type MigrationClass = new () => MigrationInterface;

async function recordQueries(
  migration: MigrationInterface,
  direction: "up" | "down",
): Promise<Array<string>> {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement.trim());
    },
  } as unknown as QueryRunner;

  await migration[direction](queryRunner);

  return statements;
}

function registeredNames(): Array<string> {
  return (SchemaMigrations as unknown as Array<MigrationClass>).map(
    (migration: MigrationClass): string => {
      return migration.name;
    },
  );
}

describe("AddSecurityBlockReachAndWiderValue migration", () => {
  test("its class, name and stamp agree", () => {
    expect(new AddSecurityBlockReachAndWiderValue1809187421200().name).toBe(
      "AddSecurityBlockReachAndWiderValue1809187421200",
    );
  });

  test("widens the value in place, never by dropping the column", async () => {
    const up: Array<string> = await recordQueries(
      new AddSecurityBlockReachAndWiderValue1809187421200(),
      "up",
    );

    expect(up).toContain(
      `ALTER TABLE "SecurityBlock" ALTER COLUMN "value" TYPE character varying(500)`,
    );

    for (const statement of up) {
      expect(statement).not.toMatch(/DROP COLUMN "value"/);
      expect(statement).not.toMatch(/ADD "value"/);
    }
  });

  test("every block made before is at the edge", async () => {
    const up: Array<string> = await recordQueries(
      new AddSecurityBlockReachAndWiderValue1809187421200(),
      "up",
    );

    expect(up).toContain(
      `ALTER TABLE "SecurityBlock" ADD "reach" character varying(100) NOT NULL DEFAULT 'Edge'`,
    );
  });

  test("drops the one-per-value index in the same transaction that alters the table", async () => {
    const migration: AddSecurityBlockReachAndWiderValue1809187421200 =
      new AddSecurityBlockReachAndWiderValue1809187421200();
    const up: Array<string> = await recordQueries(migration, "up");

    expect(up[0]).toBe(`DROP INDEX "public"."IDX_a4755bd06e3601ee046fcd7fe4"`);
    // A transaction: the ALTER TABLE's lock covers the drop.
    expect(
      (migration as unknown as { transaction?: boolean }).transaction,
    ).not.toBe(false);
    expect(
      up.some((statement: string): boolean => {
        return statement.startsWith(`ALTER TABLE "SecurityBlock"`);
      }),
    ).toBe(true);
    // It builds no index: the online one does, after it.
    expect(
      up.some((statement: string): boolean => {
        return statement.includes("CREATE");
      }),
    ).toBe(false);
  });

  test("down() takes away what the blocklist before cannot hold, then undoes up()", async () => {
    const down: Array<string> = await recordQueries(
      new AddSecurityBlockReachAndWiderValue1809187421200(),
      "down",
    );

    expect(down[0]).toBe(
      `DELETE FROM "SecurityBlock" WHERE "indicatorType" NOT IN ('IpAddress', 'IpRange') OR LENGTH("value") > 100`,
    );
    expect(down[1]).toMatch(
      /^DELETE FROM "SecurityBlock" AS "everywhere" WHERE "everywhere"\."reach" = 'Everywhere'/,
    );
    expect(down.slice(2)).toEqual([
      `ALTER TABLE "SecurityBlock" ALTER COLUMN "value" TYPE character varying(100)`,
      `ALTER TABLE "SecurityBlock" DROP COLUMN "reach"`,
      `CREATE UNIQUE INDEX "IDX_a4755bd06e3601ee046fcd7fe4" ON "SecurityBlock" ("projectId", "value") WHERE (((state)::text = 'Active'::text) AND ("deletedAt" IS NULL))`,
    ]);
  });
});

const UNIQUE_INDEX: string = `CREATE UNIQUE INDEX "IDX_ac2da67eb841306d277e0aeb47" ON "SecurityBlock" ("projectId", "value", "reach") WHERE "state" = 'Active' AND "deletedAt" IS NULL`;

// What a migration hands OnlineDdl, and runs itself, in order.
async function onlineStatementsOf(
  run: (runner: QueryRunner) => Promise<void>,
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
    isTransactionActive: false,
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

describe("AddSecurityBlockValueReachIndex migration", () => {
  test("builds one active block per value and reach online, outside a transaction - and nothing else", async () => {
    const migration: AddSecurityBlockValueReachIndex1809187421210 =
      new AddSecurityBlockValueReachIndex1809187421210();

    expect(migration.transaction).toBe(false);
    expect(
      await onlineStatementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([`online: ${UNIQUE_INDEX}`]);
  });

  test("OnlineDdl reads the build as a unique index it can run concurrently, its predicate kept", () => {
    const parsed: OnlineIndex = OnlineDdl.parseCreateIndex(UNIQUE_INDEX);

    expect(parsed.build).toBe(
      `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "IDX_ac2da67eb841306d277e0aeb47" ON "SecurityBlock" ("projectId", "value", "reach") WHERE "state" = 'Active' AND "deletedAt" IS NULL`,
    );
  });

  test("down() drops it online", async () => {
    const migration: AddSecurityBlockValueReachIndex1809187421210 =
      new AddSecurityBlockValueReachIndex1809187421210();

    expect(
      await onlineStatementsOf((runner: QueryRunner) => {
        return migration.down(runner);
      }),
    ).toEqual([
      `online: DROP INDEX "public"."IDX_ac2da67eb841306d277e0aeb47"`,
    ]);
  });
});

describe("the two migrations, with the model", () => {
  test("are registered once each, in order, after every migration before them", () => {
    const names: Array<string> = registeredNames();
    const first: number = names.indexOf(
      "AddSecurityBlockReachAndWiderValue1809187421200",
    );
    const second: number = names.indexOf(
      "AddSecurityBlockValueReachIndex1809187421210",
    );

    expect(first).toBeGreaterThan(-1);
    expect(second).toBe(first + 1);
    expect(names.lastIndexOf("AddSecurityBlockReachAndWiderValue1809187421200")).toBe(first);
    expect(names.indexOf("AddSecurityBlocklist1809187150000")).toBeLessThan(
      first,
    );

    const stamps: Array<number> = names.map((name: string): number => {
      return Number((name.match(/(\d{13})$/) || [])[1] || 0);
    });

    for (let index: number = 0; index < first; index++) {
      expect(stamps[index]!).toBeLessThan(1809187421200);
    }
  });

  test("the model declares the index the online migration builds, and reach defaulting to Edge", () => {
    const index: IndexMetadataArgs | undefined =
      getMetadataArgsStorage().indices.find((item: IndexMetadataArgs) => {
        return (
          item.target === SecurityBlock &&
          Array.isArray(item.columns) &&
          (item.columns as Array<string>).join(",") === "projectId,value,reach"
        );
      });

    expect(index).toBeDefined();
    expect(index!.unique).toBe(true);
    expect(index!.where).toBe(`"state" = 'Active' AND "deletedAt" IS NULL`);

    const reach: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
      .columns.find((column: ColumnMetadataArgs) => {
        return column.target === SecurityBlock && column.propertyName === "reach";
      });

    expect(reach?.options.default).toBe("Edge");

    const value: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
      .columns.find((column: ColumnMetadataArgs) => {
        return column.target === SecurityBlock && column.propertyName === "value";
      });

    expect(value?.options.length).toBe(500);
  });
});
