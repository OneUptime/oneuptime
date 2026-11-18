import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddSecurityCaseTaskResponseStepKey1809184720000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809184690000-AddSecurityCaseTaskResponseStepKey";
import SecurityCaseTask from "../../../../Models/DatabaseModels/SecurityCaseTask";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind a case's response plan (#9557): ticking a step off
 * makes it one of the case's tasks, and the task keeps the step it was made
 * from, so the plan knows the step again whatever language the task's
 * title was written in.
 *
 * The statements run against a fake QueryRunner, so up() and down() are
 * told apart. Additive and nullable (Docs/migrations/README.md): one column
 * on SecurityCaseTask, no default, no index, no key, nothing backfilled. A
 * server of the release before ignores it; a task added by hand or by a
 * playbook has none. The migration has to be registered, named for its
 * class and ordered after every migration before it, or it never runs; the
 * schema drift check holds its statement to the model.
 */

const MIGRATION_TIMESTAMP: string = "1809184720000";
const MIGRATION_BASE_NAME: string = "AddSecurityCaseTaskResponseStepKey";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
// The last migration registered before it.
const PREVIOUS_MIGRATION: string =
  "AddIdentityProviderSignOut1809184710000";
const PREVIOUS_TIMESTAMP: number = 1809184710000;

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
    new AddSecurityCaseTaskResponseStepKey1809184720000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddSecurityCaseTaskResponseStepKey1809184720000", () => {
  test("adds the step a task was made from to SecurityCaseTask, nullable", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "SecurityCaseTask" ADD "responseStepKey" character varying(100)`,
    ]);
  });

  test("builds no index, adds no key or default, backfills nothing and touches no other table", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|DEFAULT|NOT NULL|UPDATE /i,
      );
      expect(statement).toMatch(/^ALTER TABLE "SecurityCaseTask" ADD /);
    }
  });

  test("down drops the column up added, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "SecurityCaseTask" DROP COLUMN "responseStepKey"`,
    ]);
  });

  test("the model declares the column it adds: short text, set once by whoever may add a task, read as the task is", () => {
    const model: SecurityCaseTask = new SecurityCaseTask();
    const column: string = "responseStepKey";

    expect(model.getTableColumns().columns).toContain(column);
    expect(model.getTableColumnMetadata(column).type).toBe(
      TableColumnType.ShortText,
    );
    expect(model.getTableColumnMetadata(column).required).toBeFalsy();
    expect(model.getColumnAccessControlFor(column)?.create).toEqual(
      model.getColumnAccessControlFor("title")?.create,
    );
    expect(model.getColumnAccessControlFor(column)?.update).toEqual([]);
    expect(model.getColumnAccessControlFor(column)?.read).toEqual(
      model.getColumnAccessControlFor("title")?.read,
    );
    expect(model.getTableColumnMetadata(column).canReadOnRelationQuery).toBe(
      true,
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
    expect(new AddSecurityCaseTaskResponseStepKey1809184720000().name).toBe(
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
          return value <= PREVIOUS_TIMESTAMP;
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
