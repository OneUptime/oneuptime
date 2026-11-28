import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddVMwareHealthSettingsAndSwapRates1809187811157 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187811157-AddVMwareHealthSettingsAndSwapRates";
import {
  DEFAULT_VMWARE_HEALTH_RULES,
  VMWARE_HEALTH_RULE_KEYS,
  VMwareHealthRuleKey,
} from "../../../../Types/VMware/VMwareHealthRules";

/*
 * The migration behind #11157:
 *
 *   - VMwareHealthSetting, a project's VMware health rules (VMware >
 *     Settings > Health Rules): one row per project, each threshold a
 *     nullable integer whose default is the rule's default, so a row made
 *     with nothing set judges as the Overview did before - but for
 *     swapping;
 *   - VMwareResource.memorySwapOutBytesPerSecond / memorySwapInBytesPerSecond,
 *     the swap rates ingest works out from how a VM's swapped memory moved
 *     since its previous report: nullable, no default, so every existing row
 *     reads "not known yet" until its next two reports.
 *
 * The statements run against a fake QueryRunner, so up() and down() are
 * told apart. Neither rewrites a row nor builds an index on a table that
 * has rows (Docs/migrations/README.md). The migration has to be registered,
 * named for its class and numbered after every migration before it, or it
 * runs out of order; the schema drift check holds its statements to the
 * models.
 */

const MIGRATION_TIMESTAMP: string = "1809187811157";
const MIGRATION_BASE_NAME: string = "AddVMwareHealthSettingsAndSwapRates";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

async function statementsOf(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface =
    new AddVMwareHealthSettingsAndSwapRates1809187811157();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddVMwareHealthSettingsAndSwapRates1809187811157", () => {
  test("makes the settings table, keyed once per project, and adds the two swap rates", async () => {
    const statements: Array<string> = await statementsOf("up");

    expect(statements).toHaveLength(5);
    expect(statements[0]).toMatch(/^CREATE TABLE "VMwareHealthSetting" \(/);
    expect(statements[0]).toContain('"projectId" uuid NOT NULL');
    expect(statements[1]).toMatch(
      /^CREATE UNIQUE INDEX "IDX_\w+" ON "VMwareHealthSetting" \("projectId"\)/,
    );
    expect(statements.slice(2, 4)).toEqual([
      `ALTER TABLE "VMwareResource" ADD "memorySwapOutBytesPerSecond" numeric`,
      `ALTER TABLE "VMwareResource" ADD "memorySwapInBytesPerSecond" numeric`,
    ]);
    expect(statements[4]).toMatch(
      /^ALTER TABLE "VMwareHealthSetting" ADD CONSTRAINT "FK_\w+" FOREIGN KEY \("projectId"\) REFERENCES "Project"\("_id"\) ON DELETE CASCADE/,
    );
  });

  test("each threshold is a nullable integer whose default is its rule's default", async () => {
    const createTable: string = (await statementsOf("up"))[0]!;

    for (const key of VMWARE_HEALTH_RULE_KEYS) {
      expect({
        key,
        column: createTable.includes(
          `"${key}" integer DEFAULT '${DEFAULT_VMWARE_HEALTH_RULES[key as VMwareHealthRuleKey]}'`,
        ),
      }).toEqual({ key, column: true });
      // Empty turns a rule off, so no threshold is required.
      expect(createTable).not.toContain(`"${key}" integer NOT NULL`);
    }
  });

  test("by default, swapping out now is critical at any rate, and memory left from earlier only past 1 GiB", async () => {
    const createTable: string = (await statementsOf("up"))[0]!;

    expect(createTable).toContain(
      `"vmSwapOutCriticalKibPerSecond" integer DEFAULT '0'`,
    );
    expect(createTable).toContain(
      `"vmSwappedWarningMebibytes" integer DEFAULT '1024'`,
    );
  });

  test("touches VMwareResource only by adding nullable columns: no row rewritten, no index, no key", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(/^UPDATE |^DELETE |^INSERT /i);

      if (statement.includes('"VMwareResource"')) {
        expect(statement).toMatch(/^ALTER TABLE "VMwareResource" ADD "\w+" numeric$/);
      }
    }
  });

  test("down takes away what up made, last first, and nothing else", async () => {
    const statements: Array<string> = await statementsOf("down");

    expect(statements).toHaveLength(5);
    expect(statements[0]).toMatch(
      /^ALTER TABLE "VMwareHealthSetting" DROP CONSTRAINT "FK_\w+"$/,
    );
    expect(statements.slice(1, 3)).toEqual([
      `ALTER TABLE "VMwareResource" DROP COLUMN "memorySwapInBytesPerSecond"`,
      `ALTER TABLE "VMwareResource" DROP COLUMN "memorySwapOutBytesPerSecond"`,
    ]);
    expect(statements[3]).toMatch(/^DROP INDEX "public"\."IDX_\w+"$/);
    expect(statements[4]).toBe(`DROP TABLE "VMwareHealthSetting"`);
  });

  test("the index and key up makes are the ones down drops", async () => {
    const up: string = (await statementsOf("up")).join("\n");
    const down: string = (await statementsOf("down")).join("\n");
    const index: string = /"(IDX_\w+)"/.exec(up)![1]!;
    const key: string = /"(FK_\w+)"/.exec(up)![1]!;

    expect(down).toContain(`"${index}"`);
    expect(down).toContain(`"${key}"`);
  });

  test("is registered once, under its own name, after every migration before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { name: string }): string => {
        return migration.name;
      },
    );

    expect(
      names.filter((name: string): boolean => {
        return name === MIGRATION_CLASS_NAME;
      }),
    ).toHaveLength(1);
    expect(new AddVMwareHealthSettingsAndSwapRates1809187811157().name).toBe(
      MIGRATION_CLASS_NAME,
    );

    // Every migration registered before it is numbered below it.
    const before: Array<number> = names
      .slice(0, names.indexOf(MIGRATION_CLASS_NAME))
      .map((name: string): number => {
        return Number(name.slice(-13));
      })
      .filter((value: number): boolean => {
        return Number.isFinite(value) && value > 0;
      });

    expect(before.length).toBeGreaterThan(0);
    expect(Number(MIGRATION_TIMESTAMP)).toBeGreaterThan(Math.max(...before));
    expect(
      fs.existsSync(
        path.join(
          MIGRATION_DIRECTORY,
          `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`,
        ),
      ),
    ).toBe(true);
  });
});
