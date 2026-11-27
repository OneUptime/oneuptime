import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddDetectionRuleAddedByOneUptimeAt1809187791037 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187791037-AddDetectionRuleAddedByOneUptimeAt";
import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind "OneUptime added this rule" (#11037): one nullable
 * timestamp on DetectionRule, which only OneUptime writes - when an upgrade
 * adds a new recommended rule to a project that runs every other one.
 *
 * The statements are executed against a fake QueryRunner, so up() and
 * down() are told apart. A nullable column with no default rewrites
 * nothing, so every rule that exists reads as added by someone else. The
 * schema drift check holds the statement to the model; this test holds the
 * model's column to what it means: read with the rule, written by nobody
 * through the API.
 */

const MIGRATION_TIMESTAMP: string = "1809187791037";
const MIGRATION_BASE_NAME: string = "AddDetectionRuleAddedByOneUptimeAt";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

// The timestamp a migration's class name ends with.
const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

async function statementsOf(
  run: (migration: MigrationInterface, runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner;

  await run(new AddDetectionRuleAddedByOneUptimeAt1809187791037(), runner);

  return statements;
}

describe("AddDetectionRuleAddedByOneUptimeAt", () => {
  test("up adds the one nullable timestamp, with no default; down drops it", async () => {
    expect(
      await statementsOf(
        async (
          migration: MigrationInterface,
          runner: QueryRunner,
        ): Promise<void> => {
          await migration.up(runner);
        },
      ),
    ).toEqual([
      `ALTER TABLE "DetectionRule" ADD "addedByOneUptimeAt" TIMESTAMP WITH TIME ZONE`,
    ]);
    expect(
      await statementsOf(
        async (
          migration: MigrationInterface,
          runner: QueryRunner,
        ): Promise<void> => {
          await migration.down(runner);
        },
      ),
    ).toEqual([`ALTER TABLE "DetectionRule" DROP COLUMN "addedByOneUptimeAt"`]);
  });

  test("the model's column: a date, optional, read with the rule and written by nobody through the API", () => {
    const rule: DetectionRule = new DetectionRule();
    const metadata: { type: TableColumnType; required?: boolean } =
      rule.getTableColumnMetadata("addedByOneUptimeAt");

    expect(metadata.type).toBe(TableColumnType.Date);
    expect(Boolean(metadata.required)).toBe(false);

    const access: { create: Array<unknown>; update: Array<unknown> } =
      rule.getColumnAccessControlFor("addedByOneUptimeAt") as unknown as {
        create: Array<unknown>;
        update: Array<unknown>;
      };

    expect(access.create).toEqual([]);
    expect(access.update).toEqual([]);
    // Read by whoever reads the rule.
    expect(
      (
        rule.getColumnAccessControlFor("addedByOneUptimeAt") as unknown as {
          read: Array<unknown>;
        }
      ).read,
    ).toEqual(
      (
        rule.getColumnAccessControlFor("lastMatchAt") as unknown as {
          read: Array<unknown>;
        }
      ).read,
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
    expect(new AddDetectionRuleAddedByOneUptimeAt1809187791037().name).toBe(
      MIGRATION_CLASS_NAME,
    );

    // Its timestamp is above every migration registered before it.
    const index: number = names.indexOf(MIGRATION_CLASS_NAME);
    const timestampOf: (name: string) => number = (name: string): number => {
      return Number(TRAILING_TIMESTAMP.exec(name)?.[1] || 0);
    };

    expect(index).toBeGreaterThan(0);
    expect(Math.max(...names.slice(0, index).map(timestampOf))).toBeLessThan(
      Number(MIGRATION_TIMESTAMP),
    );

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
