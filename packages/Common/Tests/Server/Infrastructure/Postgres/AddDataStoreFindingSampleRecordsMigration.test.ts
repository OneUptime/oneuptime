import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddDataStoreFindingSampleRecords1809184700000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809184700000-AddDataStoreFindingSampleRecords";
import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import Permission from "../../../../Types/Permission";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind the records a telemetry finding was found in
 * (#9549): DataStoreFinding.sampleRecords keeps up to ten records of the
 * last scan's sample whose value held the data - when each was written and
 * its trace, span or session, never a value - so the issue's page reads
 * those very records again.
 *
 * The statements run against a fake QueryRunner, so up() and down() are
 * told apart. Additive and nullable (Docs/migrations/README.md): one JSON
 * column, no default, no index, no key, nothing backfilled. The migration
 * has to be registered, named for its class and ordered after every
 * migration before it, or it never runs; the schema drift check holds its
 * statements to the model.
 */

const MIGRATION_TIMESTAMP: string = "1809184700000";
const MIGRATION_BASE_NAME: string = "AddDataStoreFindingSampleRecords";
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
    new AddDataStoreFindingSampleRecords1809184700000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddDataStoreFindingSampleRecords1809184700000", () => {
  test("adds sampleRecords to DataStoreFinding, a nullable JSON column", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "DataStoreFinding" ADD "sampleRecords" jsonb`,
    ]);
  });

  test("builds no index, adds no key or default and backfills nothing", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|DEFAULT|NOT NULL|UPDATE /i,
      );
    }
  });

  test("down drops the column up added, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "DataStoreFinding" DROP COLUMN "sampleRecords"`,
    ]);
  });

  test("the model declares it: JSON, not required, written by OneUptime and read like the masked samples", () => {
    const finding: DataStoreFinding = new DataStoreFinding();

    expect(finding.getTableColumns().columns).toContain("sampleRecords");
    expect(finding.getTableColumnMetadata("sampleRecords").type).toBe(
      TableColumnType.JSON,
    );
    expect(
      finding.getTableColumnMetadata("sampleRecords").required,
    ).toBeFalsy();

    const access: {
      create: Array<Permission>;
      read: Array<Permission>;
      update: Array<Permission>;
    } = finding.getColumnAccessControlFor("sampleRecords")!;

    expect(access.create).toEqual([]);
    expect(access.update).toEqual([]);
    // Whoever may read the masked samples, and nobody else: not a Security Viewer.
    expect(access.read).toEqual(
      finding.getColumnAccessControlFor("maskedSamples")!.read,
    );
    expect(access.read).not.toContain(Permission.SecurityViewer);
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
    expect(new AddDataStoreFindingSampleRecords1809184700000().name).toBe(
      MIGRATION_CLASS_NAME,
    );

    const index: number = names.indexOf(MIGRATION_CLASS_NAME);
    const timestamps: Array<number> = fs
      .readdirSync(MIGRATION_DIRECTORY)
      .map((file: string): number => {
        return Number(file.split("-")[0]);
      })
      .filter((value: number): boolean => {
        return Number.isFinite(value) && value > 0;
      });
    const before: Array<string> = names.slice(0, index);

    // Every migration registered before it is numbered before it.
    for (const name of before) {
      const timestamp: number = Number(name.match(/(\d{13})$/)?.[1] || 0);

      expect([name, timestamp < Number(MIGRATION_TIMESTAMP)]).toEqual([
        name,
        true,
      ]);
    }

    expect(timestamps).toContain(Number(MIGRATION_TIMESTAMP));
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
