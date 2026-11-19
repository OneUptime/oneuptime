import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddTableHealthSkippedTables1809184919541 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809184919541-AddTableHealthSkippedTables";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind remembering the tables a store's database keeps
 * refusing (#9541): a Dataverse table the app's role may not read, or one
 * Dataverse cannot count or describe, skipped until its next try instead
 * of found again every five minutes.
 *
 * The statements run against a fake QueryRunner, so up() and down() are
 * told apart. Additive and nullable (Docs/migrations/README.md): one JSON
 * column on DataStore, no default, no index, no key, nothing backfilled. A
 * server of the release before ignores it; one of this release reads null
 * as a store whose tables are all asked. The migration has to be
 * registered, named for its class and ordered after every migration before
 * it, or it never runs; the schema drift check holds its statement to the
 * model.
 */

const MIGRATION_TIMESTAMP: string = "1809184919541";
const MIGRATION_BASE_NAME: string = "AddTableHealthSkippedTables";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
// The last migration registered before it.
const PREVIOUS_MIGRATION: string =
  "AddMonitorNetworkDeviceIdIndexAndKey1809184900100";
const PREVIOUS_TIMESTAMP: number = 1809184900100;

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
    new AddTableHealthSkippedTables1809184919541();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddTableHealthSkippedTables1809184919541", () => {
  test("adds the tables a store's database keeps refusing to DataStore, as nullable JSON", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "DataStore" ADD "tableHealthSkippedTables" jsonb`,
    ]);
  });

  test("builds no index, adds no key or default, backfills nothing and touches no other table", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|DEFAULT|NOT NULL|UPDATE /i,
      );
      expect(statement).toMatch(/^ALTER TABLE "DataStore" ADD /);
    }
  });

  test("down drops the column up added, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "DataStore" DROP COLUMN "tableHealthSkippedTables"`,
    ]);
  });

  test("the model declares the column it adds: JSON nobody but OneUptime writes, read as the store's collection is", () => {
    const model: DataStore = new DataStore();
    const column: string = "tableHealthSkippedTables";

    expect(model.getTableColumns().columns).toContain(column);
    expect(model.getTableColumnMetadata(column).type).toBe(
      TableColumnType.JSON,
    );
    expect(model.getTableColumnMetadata(column).required).toBeFalsy();
    expect(model.getColumnAccessControlFor(column)?.create).toEqual([]);
    expect(model.getColumnAccessControlFor(column)?.update).toEqual([]);
    expect(model.getColumnAccessControlFor(column)?.read).toEqual(
      model.getColumnAccessControlFor("tableHealthMessage")?.read,
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
    expect(new AddTableHealthSkippedTables1809184919541().name).toBe(
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
