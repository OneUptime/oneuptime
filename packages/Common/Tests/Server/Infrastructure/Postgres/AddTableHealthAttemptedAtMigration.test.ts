import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddTableHealthAttemptedAt1809183900000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809183900000-AddTableHealthAttemptedAt";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind saying when a store's last Data Observability
 * collection ended, collected or failed (#9506): Collect Now waits for it
 * to pass the time it was pressed, and a failed store says when it last
 * tried.
 *
 * The statements run against a fake QueryRunner, so up() and down() are
 * told apart. Additive and nullable (Docs/migrations/README.md): one column
 * on DataStore, no default, no index, no key, nothing backfilled. A server
 * of the release before ignores it; one of this release reads null as a
 * store that has not been collected since. The migration has to be
 * registered, named for its class and ordered after every migration before
 * it, or it never runs; the schema drift check holds its statement to the
 * model.
 */

const MIGRATION_TIMESTAMP: string = "1809183900000";
const MIGRATION_BASE_NAME: string = "AddTableHealthAttemptedAt";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
// The last migration registered before it.
const PREVIOUS_MIGRATION: string = "AddEmailLogTemplateType1809183830000";
const PREVIOUS_TIMESTAMP: number = 1809183830000;

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
    new AddTableHealthAttemptedAt1809183900000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddTableHealthAttemptedAt1809183900000", () => {
  test("adds when the last collection ended to DataStore, nullable", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "DataStore" ADD "tableHealthAttemptedAt" TIMESTAMP WITH TIME ZONE`,
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
      `ALTER TABLE "DataStore" DROP COLUMN "tableHealthAttemptedAt"`,
    ]);
  });

  test("the model declares the column it adds: a date nobody but OneUptime writes, read as the time of the last collection is", () => {
    const model: DataStore = new DataStore();
    const column: string = "tableHealthAttemptedAt";

    expect(model.getTableColumns().columns).toContain(column);
    expect(model.getTableColumnMetadata(column).type).toBe(
      TableColumnType.Date,
    );
    expect(model.getTableColumnMetadata(column).required).toBeFalsy();
    expect(model.getColumnAccessControlFor(column)?.create).toEqual([]);
    expect(model.getColumnAccessControlFor(column)?.update).toEqual([]);
    expect(model.getColumnAccessControlFor(column)?.read).toEqual(
      model.getColumnAccessControlFor("tableHealthCollectedAt")?.read,
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
    expect(new AddTableHealthAttemptedAt1809183900000().name).toBe(
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
