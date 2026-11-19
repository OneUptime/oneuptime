import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddDataAssetEntitySetName1809185969600 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809185969600-AddDataAssetEntitySetName";
import DataAsset from "../../../../Models/DatabaseModels/DataAsset";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind keeping each Dataverse table's entity set name with
 * the table (#9696): what Power BI's OData connectors name it by, kept by
 * its collection whether OneUptime or a probe collects the environment, so
 * the BI read no longer asks the environment (which it could not do for a
 * probe's).
 *
 * The statements run against a fake QueryRunner, so up() and down() are
 * told apart. Additive and nullable (Docs/migrations/README.md): one text
 * column on DataAsset, no default, no index, no key, nothing backfilled -
 * each Dataverse table gets its name at its next collection, and a server
 * of the release before ignores the column. The migration has to be
 * registered, named for its class and ordered after every migration before
 * it, or it never runs; the schema drift check holds its statement to the
 * model.
 */

const MIGRATION_TIMESTAMP: string = "1809185969600";
const MIGRATION_BASE_NAME: string = "AddDataAssetEntitySetName";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
// The last migration registered before it.
const PREVIOUS_MIGRATION: string = "AddServiceAINote1809185918000";
const PREVIOUS_TIMESTAMP: number = 1809185918000;

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
    new AddDataAssetEntitySetName1809185969600();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddDataAssetEntitySetName1809185969600", () => {
  test("adds each table's entity set name to DataAsset, as nullable text", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "DataAsset" ADD "entitySetName" character varying(500)`,
    ]);
  });

  test("builds no index, adds no key or default, backfills nothing and touches no other table", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|DEFAULT|NOT NULL|UPDATE /i,
      );
      expect(statement).toMatch(/^ALTER TABLE "DataAsset" ADD /);
    }
  });

  test("down drops the column up added, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "DataAsset" DROP COLUMN "entitySetName"`,
    ]);
  });

  test("the model declares the column it adds: text nobody but OneUptime writes, read as the table's other collected facts are", () => {
    const model: DataAsset = new DataAsset();
    const column: string = "entitySetName";

    expect(model.getTableColumns().columns).toContain(column);
    expect(model.getTableColumnMetadata(column).type).toBe(
      TableColumnType.LongText,
    );
    expect(model.getTableColumnMetadata(column).required).toBeFalsy();
    expect(model.getColumnAccessControlFor(column)?.create).toEqual([]);
    expect(model.getColumnAccessControlFor(column)?.update).toEqual([]);
    expect(model.getColumnAccessControlFor(column)?.read).toEqual(
      model.getColumnAccessControlFor("lastChangedAt")?.read,
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
    expect(new AddDataAssetEntitySetName1809185969600().name).toBe(
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
