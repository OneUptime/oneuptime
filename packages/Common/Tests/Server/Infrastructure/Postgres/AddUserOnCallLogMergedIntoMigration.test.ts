import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddUserOnCallLogMergedInto1809180370000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809180370000-AddUserOnCallLogMergedInto";
import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind one page for somebody two policies page about one
 * record (issue #7837): a person's page merged into their open page from
 * another policy's run names that page (UserOnCallLog
 * .mergedIntoUserOnCallLogId), whose state says whether it waits, is
 * answered with it, or takes the page over.
 *
 * The statements run against a fake QueryRunner, so up() and down() are told
 * apart. The column is nullable with no default, so Postgres adds it without
 * rewriting the table; nothing is backfilled, no index is built and no key is
 * added: it is read by the page it is on, never searched by. The migration
 * has to be registered, named for its class and ordered after every
 * migration before it, or it never runs; the schema drift check holds its
 * statement to the model.
 */

const MIGRATION_TIMESTAMP: string = "1809180370000";
const MIGRATION_BASE_NAME: string = "AddUserOnCallLogMergedInto";
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
    new AddUserOnCallLogMergedInto1809180370000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddUserOnCallLogMergedInto1809180370000", () => {
  test("adds mergedIntoUserOnCallLogId to UserOnCallLog, a nullable uuid with no default", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "UserOnCallLog" ADD "mergedIntoUserOnCallLogId" uuid`,
    ]);
  });

  test("builds no index, adds no key, backfills nothing and touches no other table", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|DEFAULT|NOT NULL|UPDATE /i,
      );
    }
  });

  test("down drops the column up added, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "UserOnCallLog" DROP COLUMN "mergedIntoUserOnCallLogId"`,
    ]);
  });

  test("the model declares the column it adds: an id, not required, read by nobody but OneUptime", () => {
    const model: UserOnCallLog = new UserOnCallLog();

    expect(model.getTableColumns().columns).toContain(
      "mergedIntoUserOnCallLogId",
    );
    expect(model.getTableColumnMetadata("mergedIntoUserOnCallLogId").type).toBe(
      TableColumnType.ObjectID,
    );
    expect(
      model.getTableColumnMetadata("mergedIntoUserOnCallLogId").required,
    ).toBeFalsy();
    expect(
      model.getColumnAccessControlFor("mergedIntoUserOnCallLogId")?.read,
    ).toEqual([]);
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
    expect(new AddUserOnCallLogMergedInto1809180370000().name).toBe(
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

    // After every migration whose file was there before it.
    expect(Number(MIGRATION_TIMESTAMP)).toBeGreaterThan(
      Math.max(
        ...timestamps.filter((value: number): boolean => {
          return value <= 1809179900000;
        }),
      ),
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
