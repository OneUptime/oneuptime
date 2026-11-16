import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddMonitorFirstMeasuredAt1809181100000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809181100000-AddMonitorFirstMeasuredAt";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Permission from "../../../../Types/Permission";
import ModelImportExport from "../../../../Utils/ModelImportExport";

/*
 * The migration behind a monitor nothing has checked yet (issue #8899):
 * Monitor.firstMeasuredAt says when a check result, heartbeat, email, agent
 * report or evaluation first reached the monitor, so the lists and status
 * pages can tell a status a check stands behind from the operational one
 * every monitor is created in.
 *
 * The statements run against a fake QueryRunner, so up() and down() are told
 * apart. "Monitor" is written by every probe result, heartbeat and sweep, so
 * the column is nullable with no default and in no index: Postgres adds it
 * without rewriting or scanning the table, and nothing is backfilled here
 * (BackfillMonitorFirstMeasuredAt does that, outside the schema migration).
 * The migration has to be registered, named for its class and ordered after
 * every migration before it, or it never runs; the schema drift check holds
 * its statement to the model.
 */

const MIGRATION_TIMESTAMP: string = "1809181100000";
const MIGRATION_BASE_NAME: string = "AddMonitorFirstMeasuredAt";
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
    new AddMonitorFirstMeasuredAt1809181100000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddMonitorFirstMeasuredAt1809181100000", () => {
  test("adds firstMeasuredAt to Monitor, a nullable timestamp with no default", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "Monitor" ADD "firstMeasuredAt" TIMESTAMP WITH TIME ZONE`,
    ]);
  });

  test("builds no index, adds no key, backfills nothing and touches no other table", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|DEFAULT|NOT NULL|UPDATE /i,
      );
      expect(statement).toMatch(/^ALTER TABLE "Monitor" /);
    }
  });

  test("down drops the column up added, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "Monitor" DROP COLUMN "firstMeasuredAt"`,
    ]);
  });

  test("the model declares the column it adds: a date, not required, written by OneUptime only and read by everyone who reads a monitor", () => {
    const model: Monitor = new Monitor();

    expect(model.getTableColumns().columns).toContain("firstMeasuredAt");
    expect(model.getTableColumnMetadata("firstMeasuredAt").type).toBe(
      TableColumnType.Date,
    );
    expect(model.getTableColumnMetadata("firstMeasuredAt").required).toBeFalsy();
    expect(model.getColumnAccessControlFor("firstMeasuredAt")?.create).toEqual(
      [],
    );
    expect(model.getColumnAccessControlFor("firstMeasuredAt")?.update).toEqual(
      [],
    );
    // The same readers as the monitor's status: a Viewer's page must load.
    expect(
      model.getColumnAccessControlFor("firstMeasuredAt")?.read,
    ).toEqual(model.getColumnAccessControlFor("currentMonitorStatusId")?.read);
    expect(model.getColumnAccessControlFor("firstMeasuredAt")?.read).toEqual(
      expect.arrayContaining([
        Permission.Viewer,
        Permission.MonitorViewer,
        Permission.ReadProjectMonitor,
      ]),
    );
  });

  test("is never exported or imported: a copy of a monitor has not been measured", () => {
    expect(
      ModelImportExport.getImportExportableColumnNames(Monitor),
    ).not.toContain("firstMeasuredAt");
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
    expect(new AddMonitorFirstMeasuredAt1809181100000().name).toBe(
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
          return value <= 1809181000000;
        }),
      ),
    );
    expect(names.indexOf(MIGRATION_CLASS_NAME)).toBeGreaterThan(
      names.indexOf("AddResolvedRecordRetentionServerLimits1809181000000"),
    );
    expect(names.indexOf("AddResolvedRecordRetentionServerLimits1809181000000")).toBeGreaterThan(-1);
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
