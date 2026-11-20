import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddProbeReportedVersion1809185330000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809185330000-AddProbeReportedVersion";
import Probe from "../../../../Models/DatabaseModels/Probe";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Permission from "../../../../Types/Permission";

/*
 * The migration behind the release a probe says it runs (issue #9759):
 * Probe.reportedVersion, kept with its liveness stamp, so a custom probe
 * too old to make one-time codes can be named on its page and in the
 * monitor forms.
 *
 * The statements run against a fake QueryRunner, so up() and down() are
 * told apart. Additive and nullable (Docs/migrations/README.md): one text
 * column, no default, no index, no key, nothing backfilled - every probe
 * reads as having said nothing until its next request. The migration has
 * to be registered, named for its class and ordered after every migration
 * before it, or it never runs; the schema drift check holds its statement
 * to the model.
 */

const MIGRATION_TIMESTAMP: string = "1809185330000";
const MIGRATION_BASE_NAME: string = "AddProbeReportedVersion";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
// The last migration registered before it.
const PREVIOUS_MIGRATION: string =
  "AddDetectionMatchedEventsAndRuleResponseSteps1809185320000";

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
    new AddProbeReportedVersion1809185330000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddProbeReportedVersion1809185330000", () => {
  test("adds reportedVersion to Probe, a nullable text column as wide as the model's", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "Probe" ADD "reportedVersion" character varying(100)`,
    ]);
  });

  test("builds no index, adds no key or default, backfills nothing and touches no other table", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|DEFAULT|NOT NULL|UPDATE /i,
      );
      expect(statement).toMatch(/^ALTER TABLE "Probe" ADD /);
    }
  });

  test("down drops the column up added, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "Probe" DROP COLUMN "reportedVersion"`,
    ]);
  });

  test("the model declares the column it adds: text OneUptime alone writes, read by the probe's readers as its label is", () => {
    const model: Probe = new Probe();

    expect(model.getTableColumns().columns).toContain("reportedVersion");
    expect(model.getTableColumnMetadata("reportedVersion").type).toBe(
      TableColumnType.ShortText,
    );
    expect(
      model.getTableColumnMetadata("reportedVersion").required,
    ).toBeFalsy();

    const access: {
      create: Array<Permission>;
      read: Array<Permission>;
      update: Array<Permission>;
    } = model.getColumnAccessControlFor("reportedVersion") as {
      create: Array<Permission>;
      read: Array<Permission>;
      update: Array<Permission>;
    };

    expect(access.create).toEqual([]);
    expect(access.update).toEqual([]);
    expect([...access.read].sort()).toEqual(
      [...(model.getColumnAccessControlFor("probeVersion")?.read || [])].sort(),
    );
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
    expect(new AddProbeReportedVersion1809185330000().name).toBe(
      MIGRATION_CLASS_NAME,
    );

    const timestamps: Array<number> = fs
      .readdirSync(MIGRATION_DIRECTORY)
      .map((file: string): number => {
        return Number(file.split("-")[0]);
      })
      .filter((value: number): boolean => {
        return Number.isFinite(value) && value > 0;
      });

    expect(Number(MIGRATION_TIMESTAMP)).toBeGreaterThan(
      Math.max(
        ...timestamps.filter((value: number): boolean => {
          return value <= 1809185320000;
        }),
      ),
    );
    expect(names.indexOf(MIGRATION_CLASS_NAME)).toBeGreaterThan(
      names.indexOf(PREVIOUS_MIGRATION),
    );
    expect(names.indexOf(PREVIOUS_MIGRATION)).toBeGreaterThan(-1);
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
