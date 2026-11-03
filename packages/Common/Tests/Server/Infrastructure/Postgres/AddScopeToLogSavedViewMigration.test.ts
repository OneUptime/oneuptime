import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddScopeToLogSavedView1808880000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808880000000-AddScopeToLogSavedView";
import LogSavedView from "../../../../Models/DatabaseModels/LogSavedView";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { SAVED_VIEW_SCOPE_MAX_LENGTH } from "../../../../Utils/Telemetry/SavedViewScope";

/*
 * The migration behind a saved log view's page (issue #5549): one nullable
 * column on LogSavedView, added without a default and without touching a
 * row, so every view a project already has keeps no scope - and a view with
 * no scope is the Logs page's, where those views were made or, for one made
 * on a resource's Logs tab back then, where it still applies its filters.
 * On a big table it is a catalogue change, not a rewrite.
 *
 * Run against a fake QueryRunner, so the statements are what is pinned; the
 * schema drift check holds them to the model, and the migration ran up,
 * down and up again on a real Postgres when it was written.
 */

const MIGRATION_TIMESTAMP: string = "1808880000000";
const MIGRATION_BASE_NAME: string = "AddScopeToLogSavedView";
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
    new AddScopeToLogSavedView1808880000000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddScopeToLogSavedView1808880000000", () => {
  test("adds one nullable column, with no default and no row written", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "LogSavedView" ADD "scope" character varying(500)`,
    ]);

    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(/NOT NULL|DEFAULT|UPDATE |INDEX/);
    }
  });

  test("down takes away exactly what up added", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "LogSavedView" DROP COLUMN "scope"`,
    ]);
  });

  test("LogSavedView declares the column as the migration makes it: optional long text, as long as a scope may be", () => {
    const model: LogSavedView = new LogSavedView();

    expect(model.getTableColumnMetadata("scope").type).toBe(
      TableColumnType.LongText,
    );
    expect(Boolean(model.getTableColumnMetadata("scope").required)).toBe(false);
    expect(ColumnLength.LongText).toBe(500);
    expect(SAVED_VIEW_SCOPE_MAX_LENGTH).toBe(500);
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
    expect(new AddScopeToLogSavedView1808880000000().name).toBe(
      MIGRATION_CLASS_NAME,
    );

    // It runs after every migration with an earlier timestamp.
    const earlier: Array<string> = names.filter((name: string): boolean => {
      const timestamp: number = Number(name.match(/(\d{13})$/)?.[1] || 0);
      return timestamp > 0 && timestamp < Number(MIGRATION_TIMESTAMP);
    });

    for (const name of earlier) {
      expect({
        name,
        before: names.indexOf(name) < names.indexOf(MIGRATION_CLASS_NAME),
      }).toEqual({
        name,
        before: true,
      });
    }

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
