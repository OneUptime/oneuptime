import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddCloudConnectionAddedMetrics1809185220000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809185220000-AddCloudConnectionAddedMetrics";
import CloudConnection from "../../../../Models/DatabaseModels/CloudConnection";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind the metrics people add to what a cloud connection
 * reads, beyond each resource type's key metrics (#9563):
 * CloudConnection.addedMetrics.
 *
 * The statements are executed against a fake QueryRunner, so up() and down()
 * are told apart. The column is nullable with no default, so Postgres adds
 * it without rewriting the table; nothing is backfilled and nothing scans
 * it. The migration has to be registered, named for its class and ordered
 * after every migration before it, or it never runs; the schema drift check
 * holds its statement to the model.
 */

const MIGRATION_TIMESTAMP: string = "1809185220000";
const MIGRATION_BASE_NAME: string = "AddCloudConnectionAddedMetrics";
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
    new AddCloudConnectionAddedMetrics1809185220000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddCloudConnectionAddedMetrics1809185220000", () => {
  test("adds addedMetrics to CloudConnection, as JSON, nullable, with no default", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "CloudConnection" ADD "addedMetrics" jsonb`,
    ]);
  });

  test("builds no index, adds no key, backfills nothing and touches no other table", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|DEFAULT|NOT NULL|UPDATE /i,
      );
      expect(statement).toMatch(/^ALTER TABLE "CloudConnection" ADD /);
    }
  });

  test("down drops the column up added, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "CloudConnection" DROP COLUMN "addedMetrics"`,
    ]);
  });

  test("the CloudConnection model declares the column it adds, as JSON, not required", () => {
    const model: CloudConnection = new CloudConnection();

    expect(model.tableName).toBe("CloudConnection");
    expect(model.getTableColumns().columns).toContain("addedMetrics");
    expect(model.getTableColumnMetadata("addedMetrics").type).toBe(
      TableColumnType.JSON,
    );
    expect(model.getTableColumnMetadata("addedMetrics").required).toBe(false);
  });

  test("is registered once, under its own name, and shares its timestamp with no other migration", () => {
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
    expect(new AddCloudConnectionAddedMetrics1809185220000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(
      fs.existsSync(
        path.join(
          MIGRATION_DIRECTORY,
          `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`,
        ),
      ),
    ).toBe(true);

    // No other file shares its timestamp.
    expect(
      fs.readdirSync(MIGRATION_DIRECTORY).filter((file: string): boolean => {
        return file.startsWith(`${MIGRATION_TIMESTAMP}-`);
      }),
    ).toEqual([`${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`]);
  });
});
