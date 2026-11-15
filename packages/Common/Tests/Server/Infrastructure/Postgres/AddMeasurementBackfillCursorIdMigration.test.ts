import { AddMeasurementBackfillCursorId1809178200000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809178200000-AddMeasurementBackfillCursorId";
import { RemovePermissionsTeamsCannotBeGiven1809178100000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809178100000-RemovePermissionsTeamsCannotBeGiven";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import AlertMeasurement from "../../../../Models/DatabaseModels/AlertMeasurement";
import IncidentMeasurement from "../../../../Models/DatabaseModels/IncidentMeasurement";
import ScheduledMaintenanceMeasurement from "../../../../Models/DatabaseModels/ScheduledMaintenanceMeasurement";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration behind a measurement backfill's tie-broken cursor (#8171):
 * the id of the record a page ended on (backfillCursorId), beside its
 * createdAt, on the three measurement tables. Nullable with no default, so
 * each table only gains a column in its catalog: no row is rewritten, and a
 * walk under way reads as one whose cursor has no id yet, which the
 * backfill resumes from its createdAt, inclusive, as it did. Statements are
 * recorded against a fake QueryRunner.
 */

const MIGRATION_NAME: string = "AddMeasurementBackfillCursorId1809178200000";
const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;

type MigrationClass = new () => MigrationInterface;

const TABLES: Array<{ tableName: string; model: { new (): BaseModel } }> = [
  { tableName: "IncidentMeasurement", model: IncidentMeasurement },
  { tableName: "AlertMeasurement", model: AlertMeasurement },
  {
    tableName: "ScheduledMaintenanceMeasurement",
    model: ScheduledMaintenanceMeasurement,
  },
];

async function record(
  migration: MigrationInterface,
  direction: "up" | "down",
): Promise<Array<string>> {
  const steps: Array<string> = [];

  const runner: QueryRunner = {
    isTransactionActive: true,
    query: async (sql: string): Promise<void> => {
      steps.push(sql);
    },
  } as unknown as QueryRunner;

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return steps;
}

function timestampOf(migration: MigrationClass): number {
  const match: RegExpMatchArray | null =
    migration.name.match(TRAILING_TIMESTAMP);

  return match ? parseInt(match[1]!, 10) : 0;
}

describe("the measurement backfill cursor id migration", () => {
  test("names itself after its timestamp", () => {
    expect(new AddMeasurementBackfillCursorId1809178200000().name).toBe(
      MIGRATION_NAME,
    );
  });

  test("is registered once, after every earlier migration", () => {
    const registered: Array<MigrationClass> =
      SchemaMigrations as Array<MigrationClass>;
    const at: number = registered.indexOf(
      AddMeasurementBackfillCursorId1809178200000,
    );

    expect(
      registered.filter((candidate: MigrationClass): boolean => {
        return candidate === AddMeasurementBackfillCursorId1809178200000;
      }),
    ).toHaveLength(1);
    expect(at).toBeGreaterThan(
      registered.indexOf(RemovePermissionsTeamsCannotBeGiven1809178100000),
    );

    for (let before: number = 0; before < at; before++) {
      expect(timestampOf(registered[before]!)).toBeLessThan(
        timestampOf(AddMeasurementBackfillCursorId1809178200000),
      );
    }
  });

  test("is backed by exactly one file", () => {
    const files: Array<string> = fs.readdirSync(
      path.join(
        __dirname,
        "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
      ),
    );

    expect(
      files.filter((file: string): boolean => {
        return file.startsWith(
          `${timestampOf(AddMeasurementBackfillCursorId1809178200000)}-`,
        );
      }),
    ).toEqual(["1809178200000-AddMeasurementBackfillCursorId.ts"]);
  });

  test("adds the column to the three tables, a nullable uuid, with no default, nothing backfilled and no index", async () => {
    const steps: Array<string> = await record(
      new AddMeasurementBackfillCursorId1809178200000(),
      "up",
    );

    expect(steps).toEqual([
      `ALTER TABLE "IncidentMeasurement" ADD "backfillCursorId" uuid`,
      `ALTER TABLE "AlertMeasurement" ADD "backfillCursorId" uuid`,
      `ALTER TABLE "ScheduledMaintenanceMeasurement" ADD "backfillCursorId" uuid`,
    ]);

    for (const step of steps) {
      expect(step).not.toMatch(/NOT NULL|DEFAULT|UPDATE |INDEX|REFERENCES/);
    }
  });

  test("down drops the column from the three tables, in the reverse order", async () => {
    expect(
      await record(new AddMeasurementBackfillCursorId1809178200000(), "down"),
    ).toEqual([
      `ALTER TABLE "ScheduledMaintenanceMeasurement" DROP COLUMN "backfillCursorId"`,
      `ALTER TABLE "AlertMeasurement" DROP COLUMN "backfillCursorId"`,
      `ALTER TABLE "IncidentMeasurement" DROP COLUMN "backfillCursorId"`,
    ]);
  });

  describe("the models declare what the migration builds", () => {
    test.each(TABLES)(
      "$tableName.backfillCursorId: a nullable uuid read as an ObjectID, beside the cursor's createdAt",
      (table: { tableName: string; model: { new (): BaseModel } }) => {
        const model: BaseModel = new table.model();

        expect(model.tableName).toBe(table.tableName);
        expect(model.getTableColumnMetadata("backfillCursorId")?.type).toBe(
          TableColumnType.ObjectID,
        );
        expect(
          model.getTableColumnMetadata("backfillCursorCreatedAt")?.type,
        ).toBe(TableColumnType.Date);

        const column: ColumnMetadataArgs | undefined =
          getMetadataArgsStorage().columns.find(
            (candidate: ColumnMetadataArgs): boolean => {
              return (
                candidate.target === table.model &&
                candidate.propertyName === "backfillCursorId"
              );
            },
          );

        expect(column?.options.type).toBe("uuid");
        expect(column?.options.nullable).toBe(true);
        expect(column?.options.default).toBeUndefined();
        expect(column?.options.transformer).toBeDefined();
      },
    );

    test.each(TABLES)(
      "$tableName has no index on the cursor: it is only ever read with its row",
      (table: { tableName: string; model: { new (): BaseModel } }) => {
        expect(
          getMetadataArgsStorage().indices.filter(
            (index: IndexMetadataArgs): boolean => {
              return (
                index.target === table.model &&
                Array.isArray(index.columns) &&
                index.columns.includes("backfillCursorId")
              );
            },
          ),
        ).toEqual([]);
      },
    );

    test.each(TABLES)(
      "$tableName.backfillCursorId is OneUptime's to write: nobody creates or edits it",
      (table: { tableName: string; model: { new (): BaseModel } }) => {
        const model: BaseModel = new table.model();
        const access: { create: Array<unknown>; update: Array<unknown> } =
          model.getColumnAccessControlFor("backfillCursorId") as unknown as {
            create: Array<unknown>;
            update: Array<unknown>;
          };

        expect(access.create).toEqual([]);
        expect(access.update).toEqual([]);
        expect(model.getTableColumnMetadata("backfillCursorId")?.computed).toBe(
          true,
        );
      },
    );
  });
});
