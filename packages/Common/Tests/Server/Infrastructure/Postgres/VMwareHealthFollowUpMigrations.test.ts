import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddVMwareSwapRateSource1809187811468 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187811468-AddVMwareSwapRateSource";
import { AddVMwareHealthRuleOverridesAndEvaluationPeriods1809187811469 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187811469-AddVMwareHealthRuleOverridesAndEvaluationPeriods";
import { VMWARE_HEALTH_PERIOD_RULE_KEYS } from "../../../../Types/VMware/VMwareHealthRules";

/*
 * The migrations behind #11468 and #11469:
 *
 *   - AddVMwareSwapRateSource: VMwareResource.memorySwapRateSource, where a
 *     part's swap rates came from (vSphere's counters, or worked out) -
 *     nullable with no default, so no row is rewritten;
 *   - AddVMwareHealthRuleOverridesAndEvaluationPeriods: the
 *     VMwareHealthRuleOverride table (new and empty, so its indexes and keys
 *     are made with it), VMwareResource.healthReadings (nullable, no
 *     default) and a wait per group of the project's rules (a constant
 *     default of 0: a metadata-only change on Postgres 11+).
 *
 * Their statements run against a fake QueryRunner (Docs/migrations/
 * README.md): neither rewrites a row, builds an index on a table that has
 * rows, or adds a NOT NULL column without a default to one. Each is
 * registered once, under its own name, after every migration before it.
 */

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

async function statementsOf(
  migration: MigrationInterface,
  direction: "up" | "down",
): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql.trim());
    },
  } as unknown as QueryRunner;

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

function expectRegistered(data: {
  className: string;
  timestamp: string;
  fileBase: string;
  name: string;
}): void {
  const names: Array<string> = SchemaMigrations.map(
    (migration: { name: string }): string => {
      return migration.name;
    },
  );

  expect(
    names.filter((name: string): boolean => {
      return name === data.className;
    }),
  ).toHaveLength(1);
  expect(data.name).toBe(data.className);

  const before: Array<number> = names
    .slice(0, names.indexOf(data.className))
    .map((name: string): number => {
      return Number(name.slice(-13));
    })
    .filter((value: number): boolean => {
      return Number.isFinite(value) && value > 0;
    });
  expect(before.length).toBeGreaterThan(0);
  expect(Number(data.timestamp)).toBeGreaterThan(Math.max(...before));
  expect(
    fs.existsSync(
      path.join(MIGRATION_DIRECTORY, `${data.timestamp}-${data.fileBase}.ts`),
    ),
  ).toBe(true);
}

describe("AddVMwareSwapRateSource1809187811468", () => {
  const migration: AddVMwareSwapRateSource1809187811468 =
    new AddVMwareSwapRateSource1809187811468();

  test("adds the source of each part's swap rates, nullable, with no default", async () => {
    expect(await statementsOf(migration, "up")).toEqual([
      `ALTER TABLE "VMwareResource" ADD "memorySwapRateSource" character varying(100)`,
    ]);
  });

  test("down takes it away, and nothing else", async () => {
    expect(await statementsOf(migration, "down")).toEqual([
      `ALTER TABLE "VMwareResource" DROP COLUMN "memorySwapRateSource"`,
    ]);
  });

  test("is registered once, under its own name, after every migration before it", () => {
    expectRegistered({
      className: "AddVMwareSwapRateSource1809187811468",
      timestamp: "1809187811468",
      fileBase: "AddVMwareSwapRateSource",
      name: migration.name,
    });
  });
});

describe("AddVMwareHealthRuleOverridesAndEvaluationPeriods1809187811469", () => {
  const migration: AddVMwareHealthRuleOverridesAndEvaluationPeriods1809187811469 =
    new AddVMwareHealthRuleOverridesAndEvaluationPeriods1809187811469();

  test("makes the overrides table, keyed to its project and vCenter, one override per part", async () => {
    const statements: Array<string> = await statementsOf(migration, "up");
    const create: string = statements[0]!;

    expect(create).toMatch(/^CREATE TABLE "VMwareHealthRuleOverride" \(/);
    for (const column of [
      `"projectId" uuid NOT NULL`,
      `"vmwareVCenterId" uuid NOT NULL`,
      `"scope" character varying(100) NOT NULL`,
      `"resourceExternalId" character varying(100)`,
      `"resourceName" character varying(100)`,
      `"datacenterName" character varying(100)`,
      `"clusterName" character varying(100)`,
      `"hostName" character varying(100)`,
      `"rules" jsonb`,
      // Who made and changed it, as every table since the record actors.
      `"createdByActorType" character varying(100)`,
      `"lastModifiedByActorId" uuid`,
    ]) {
      expect({ column, present: create.includes(column) }).toEqual({
        column,
        present: true,
      });
    }

    // One override per part, and one per whole vCenter: the deleted ones aside.
    expect(statements).toContainEqual(
      expect.stringMatching(
        /^CREATE UNIQUE INDEX "IDX_\w+" ON "VMwareHealthRuleOverride" \("projectId", "vmwareVCenterId", "scope", "resourceExternalId"\) WHERE "deletedAt" IS NULL AND "resourceExternalId" IS NOT NULL$/,
      ),
    );
    expect(statements).toContainEqual(
      expect.stringMatching(
        /^CREATE UNIQUE INDEX "IDX_\w+" ON "VMwareHealthRuleOverride" \("projectId", "vmwareVCenterId", "scope"\) WHERE "deletedAt" IS NULL AND "resourceExternalId" IS NULL$/,
      ),
    );
    // A vCenter's overrides go with it, and a project's with the project.
    expect(statements).toContainEqual(
      expect.stringMatching(
        /^ALTER TABLE "VMwareHealthRuleOverride" ADD CONSTRAINT "FK_\w+" FOREIGN KEY \("vmwareVCenterId"\) REFERENCES "VMwareVCenter"\("_id"\) ON DELETE CASCADE/,
      ),
    );
    expect(statements).toContainEqual(
      expect.stringMatching(
        /^ALTER TABLE "VMwareHealthRuleOverride" ADD CONSTRAINT "FK_\w+" FOREIGN KEY \("projectId"\) REFERENCES "Project"\("_id"\) ON DELETE CASCADE/,
      ),
    );
  });

  test("adds each part's readings, and a wait per group of rules that judges the latest report until set", async () => {
    const statements: Array<string> = await statementsOf(migration, "up");

    expect(statements).toContain(
      `ALTER TABLE "VMwareResource" ADD "healthReadings" jsonb`,
    );
    for (const key of VMWARE_HEALTH_PERIOD_RULE_KEYS) {
      expect(statements).toContain(
        `ALTER TABLE "VMwareHealthSetting" ADD "${key}" integer DEFAULT '0'`,
      );
    }
  });

  test("touches the tables that have rows only by adding nullable or defaulted columns", async () => {
    for (const statement of await statementsOf(migration, "up")) {
      expect(statement).not.toMatch(/^UPDATE |^DELETE |^INSERT /i);
      if (
        statement.includes('"VMwareResource"') ||
        statement.includes('"VMwareHealthSetting"')
      ) {
        expect(statement).toMatch(
          /^ALTER TABLE "(VMwareResource|VMwareHealthSetting)" ADD "\w+" (jsonb|integer DEFAULT '0')$/,
        );
      }
      // Indexes only on the new, empty table.
      if (
        statement.startsWith("CREATE INDEX") ||
        statement.startsWith("CREATE UNIQUE INDEX")
      ) {
        expect(statement).toContain(`ON "VMwareHealthRuleOverride"`);
      }
    }
  });

  test("down takes away what up made, last first, and nothing else", async () => {
    const up: Array<string> = await statementsOf(migration, "up");
    const down: Array<string> = await statementsOf(migration, "down");

    expect(down).toHaveLength(up.length);
    expect(down[down.length - 1]).toBe(`DROP TABLE "VMwareHealthRuleOverride"`);
    expect(down).toContain(
      `ALTER TABLE "VMwareResource" DROP COLUMN "healthReadings"`,
    );
    for (const key of VMWARE_HEALTH_PERIOD_RULE_KEYS) {
      expect(down).toContain(
        `ALTER TABLE "VMwareHealthSetting" DROP COLUMN "${key}"`,
      );
    }
    // Every index and key up made is one down drops.
    const upNames: Array<string> = (up.join("\n").match(/"(IDX|FK)_\w+"/g) ||
      []) as Array<string>;
    for (const name of new Set(upNames)) {
      expect(down.join("\n")).toContain(name);
    }
  });

  test("is registered once, under its own name, after every migration before it", () => {
    expectRegistered({
      className:
        "AddVMwareHealthRuleOverridesAndEvaluationPeriods1809187811469",
      timestamp: "1809187811469",
      fileBase: "AddVMwareHealthRuleOverridesAndEvaluationPeriods",
      name: migration.name,
    });
  });
});
