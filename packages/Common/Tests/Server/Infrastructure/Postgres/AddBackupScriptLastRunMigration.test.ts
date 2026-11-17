import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddBackupScriptLastRun1809183200000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809183200000-AddBackupScriptLastRun";
import GlobalConfig from "../../../../Models/DatabaseModels/GlobalConfig";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind `npm run backup` telling the server it ran (issue
 * #7026): GlobalConfig.backupScriptLastRun holds the last run - when, and
 * whether it succeeded, and the dump's size - for the setup checklist's
 * Backups check.
 *
 * The statements run against a fake QueryRunner, so up() and down() are
 * told apart. Additive and nullable (Docs/migrations/README.md): one JSON
 * column, no default, no index, no key, nothing backfilled, on the one-row
 * GlobalConfig. A server whose script never tells it reads null, as the
 * checklist did before. The migration has to be registered, named for its
 * class and ordered after every migration before it, or it never runs; the
 * schema drift check holds its statement to the model.
 */

const MIGRATION_TIMESTAMP: string = "1809183200000";
const MIGRATION_BASE_NAME: string = "AddBackupScriptLastRun";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
// The last migration registered before it.
const PREVIOUS_MIGRATION: string =
  "AddOnCallFireDrillResultsIndexAndKey1809183110000";

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
    new AddBackupScriptLastRun1809183200000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddBackupScriptLastRun1809183200000", () => {
  test("adds backupScriptLastRun to GlobalConfig, a nullable JSON column", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "GlobalConfig" ADD "backupScriptLastRun" jsonb`,
    ]);
  });

  test("builds no index, adds no key or default, backfills nothing and touches no other table", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|DEFAULT|NOT NULL|UPDATE /i,
      );
      expect(statement).toMatch(/^ALTER TABLE "GlobalConfig" ADD /);
    }
  });

  test("down drops the column up added, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "GlobalConfig" DROP COLUMN "backupScriptLastRun"`,
    ]);
  });

  test("the model declares the column it adds: JSON, not required, nobody's to read or write through the API", () => {
    const model: GlobalConfig = new GlobalConfig();

    expect(model.getTableColumns().columns).toContain("backupScriptLastRun");
    expect(model.getTableColumnMetadata("backupScriptLastRun").type).toBe(
      TableColumnType.JSON,
    );
    expect(
      model.getTableColumnMetadata("backupScriptLastRun").required,
    ).toBeFalsy();
    expect(model.getColumnAccessControlFor("backupScriptLastRun")).toEqual({
      create: [],
      read: [],
      update: [],
    });
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
    expect(new AddBackupScriptLastRun1809183200000().name).toBe(
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
          return value <= 1809183110000;
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
