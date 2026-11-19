import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddKubernetesDiskReadings1809185300000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809185300000-AddKubernetesDiskReadings";
import KubernetesResource from "../../../../Models/DatabaseModels/KubernetesResource";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind a nearly full claim and a node's disk under the
 * cluster's Needs attention (#9643, #9645): when a disk reading was taken,
 * a claim's fill baseline, and a node's image filesystem when it is a disk
 * of its own, on KubernetesResource rows.
 *
 * The statements run against a fake QueryRunner, so up() and down() are
 * told apart. Additive and nullable (Docs/migrations/README.md): five
 * columns, no default, no index, no key, nothing backfilled. A server of the
 * release before ignores them; one of this release reads null as no reading
 * yet. Registered, named for its class and ordered after every migration
 * before it; the schema drift check holds its statements to the model.
 */

const MIGRATION_TIMESTAMP: string = "1809185300000";
const MIGRATION_BASE_NAME: string = "AddKubernetesDiskReadings";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
// The last migration registered before it.
const PREVIOUS_MIGRATION: string =
  "DropIncidentTemplateOwnerNotifiedFlag1809185210000";
const PREVIOUS_TIMESTAMP: number = 1809185210000;

const BIG_NUMBER_COLUMNS: Array<string> = [
  "latestVolumeUsedBaselineBytes",
  "latestImageFsCapacityBytes",
  "latestImageFsAvailableBytes",
];
const DATE_COLUMNS: Array<string> = [
  "latestVolumeMeasuredAt",
  "latestVolumeUsedBaselineAt",
];

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
    new AddKubernetesDiskReadings1809185300000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddKubernetesDiskReadings1809185300000", () => {
  test("adds when a disk was measured, a claim's fill baseline and a node's image disk, nullable", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "KubernetesResource" ADD "latestVolumeMeasuredAt" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "KubernetesResource" ADD "latestVolumeUsedBaselineBytes" bigint`,
      `ALTER TABLE "KubernetesResource" ADD "latestVolumeUsedBaselineAt" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "KubernetesResource" ADD "latestImageFsCapacityBytes" bigint`,
      `ALTER TABLE "KubernetesResource" ADD "latestImageFsAvailableBytes" bigint`,
    ]);
  });

  test("builds no index, adds no key or default, backfills nothing and touches no other table", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|DEFAULT|NOT NULL|UPDATE /i,
      );
      expect(statement).toMatch(/^ALTER TABLE "KubernetesResource" ADD /);
    }
  });

  test("down drops the columns up added, in reverse, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "KubernetesResource" DROP COLUMN "latestImageFsAvailableBytes"`,
      `ALTER TABLE "KubernetesResource" DROP COLUMN "latestImageFsCapacityBytes"`,
      `ALTER TABLE "KubernetesResource" DROP COLUMN "latestVolumeUsedBaselineAt"`,
      `ALTER TABLE "KubernetesResource" DROP COLUMN "latestVolumeUsedBaselineBytes"`,
      `ALTER TABLE "KubernetesResource" DROP COLUMN "latestVolumeMeasuredAt"`,
    ]);
  });

  test.each([
    ...BIG_NUMBER_COLUMNS.map((column: string): [string, TableColumnType] => {
      return [column, TableColumnType.BigPositiveNumber];
    }),
    ...DATE_COLUMNS.map((column: string): [string, TableColumnType] => {
      return [column, TableColumnType.Date];
    }),
  ])(
    "the model declares %s as %s, written by OneUptime alone and read as the other metric columns are",
    (column: string, type: TableColumnType) => {
      const model: KubernetesResource = new KubernetesResource();

      expect(model.getTableColumns().columns).toContain(column);
      expect(model.getTableColumnMetadata(column).type).toBe(type);
      expect(model.getTableColumnMetadata(column).required).toBeFalsy();
      expect(model.getColumnAccessControlFor(column)?.create).toEqual([]);
      expect(model.getColumnAccessControlFor(column)?.update).toEqual([]);
      expect(model.getColumnAccessControlFor(column)?.read).toEqual(
        model.getColumnAccessControlFor("latestVolumeCapacityBytes")?.read,
      );
      expect(model.getTableColumnMetadata(column).canReadOnRelationQuery).toBe(
        true,
      );
    },
  );

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
    expect(new AddKubernetesDiskReadings1809185300000().name).toBe(
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
