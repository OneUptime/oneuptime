import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddDataBiConnectionReadState1809184910000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809184910000-AddDataBiConnectionReadState";
import DataBiConnection from "../../../../Models/DatabaseModels/DataBiConnection";
import Permission from "../../../../Types/Permission";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind what a BI tool's read keeps so the next one reads
 * less (#9551, #9552, #9554): DataBiConnection.readState holds Power BI's
 * workspaces as last scanned, its dataflows' definitions and the
 * Dataverse environments' entity set names.
 *
 * The statements run against a fake QueryRunner, so up() and down() are
 * told apart. Additive and nullable (Docs/migrations/README.md): one JSON
 * column, no default, no index, no key, nothing backfilled. The migration
 * has to be registered, named for its class and ordered after every
 * migration before it, or it never runs; the schema drift check holds its
 * statement to the model (it was generated from it).
 */

const MIGRATION_TIMESTAMP: string = "1809184910000";
const MIGRATION_BASE_NAME: string = "AddDataBiConnectionReadState";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
// The last migration registered before it.
const PREVIOUS_MIGRATION: string =
  "AddMonitorNetworkDeviceIdIndexAndKey1809184900100";

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
    new AddDataBiConnectionReadState1809184910000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddDataBiConnectionReadState1809184910000", () => {
  test("adds readState to DataBiConnection, a nullable JSON column", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "DataBiConnection" ADD "readState" jsonb`,
    ]);
  });

  test("builds no index, adds no key or default and backfills nothing", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|DEFAULT|NOT NULL|UPDATE /i,
      );
      expect(statement).toMatch(/^ALTER TABLE "DataBiConnection" ADD /);
    }
  });

  test("down drops the column up added, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "DataBiConnection" DROP COLUMN "readState"`,
    ]);
  });

  test("the model declares the column: JSON, not required, written by OneUptime alone and read by nobody through the API", () => {
    const connection: DataBiConnection = new DataBiConnection();

    expect(connection.getTableColumns().columns).toContain("readState");
    expect(connection.getTableColumnMetadata("readState").type).toBe(
      TableColumnType.JSON,
    );
    expect(connection.getTableColumnMetadata("readState").required).toBeFalsy();
    expect(connection.getTableColumnMetadata("readState").computed).toBe(true);

    const access: {
      create: Array<Permission>;
      read: Array<Permission>;
      update: Array<Permission>;
    } = connection.getColumnAccessControlFor("readState")!;

    // It holds what Power BI and Dataverse returned: nobody reads, writes or makes it but OneUptime.
    expect(access.create).toEqual([]);
    expect(access.read).toEqual([]);
    expect(access.update).toEqual([]);
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
    expect(new AddDataBiConnectionReadState1809184910000().name).toBe(
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

    // Numbered after the migration before it, and no other file shares its number.
    expect(Number(MIGRATION_TIMESTAMP)).toBeGreaterThan(
      Number(PREVIOUS_MIGRATION.slice(-MIGRATION_TIMESTAMP.length)),
    );
    expect(
      timestamps.filter((value: number): boolean => {
        return value === Number(MIGRATION_TIMESTAMP);
      }),
    ).toHaveLength(1);
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
