import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddKubernetesVolumeClaimUsage1809184859539 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809184859539-AddKubernetesVolumeClaimUsage";
import KubernetesResource from "../../../../Models/DatabaseModels/KubernetesResource";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind a persistent volume claim's used, free and capacity
 * (#9539): the latest k8s.volume.* point the kubernetes-agent sends for a
 * claim, mirrored onto the claim's KubernetesResource row, so the Persistent
 * Volume Claims list reads every claim's usage from Postgres in one read.
 *
 * The statements run against a fake QueryRunner, so up() and down() are
 * told apart. Additive and nullable (Docs/migrations/README.md): four bigint
 * columns on KubernetesResource, no default, no index, no key, nothing
 * backfilled. A server of the release before ignores them; one of this
 * release reads null as a claim with no usage reported yet. The migration has
 * to be registered, named for its class and ordered after every migration
 * before it, or it never runs; the schema drift check holds its statements to
 * the model.
 */

const MIGRATION_TIMESTAMP: string = "1809184859539";
const MIGRATION_BASE_NAME: string = "AddKubernetesVolumeClaimUsage";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
// The last migration registered before it.
const PREVIOUS_MIGRATION: string =
  "AddDataSecurityComplianceSettings1809184850000";
const PREVIOUS_TIMESTAMP: number = 1809184850000;

const COLUMNS: Array<string> = [
  "latestVolumeCapacityBytes",
  "latestVolumeAvailableBytes",
  "latestVolumeInodes",
  "latestVolumeInodesFree",
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
    new AddKubernetesVolumeClaimUsage1809184859539();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddKubernetesVolumeClaimUsage1809184859539", () => {
  test("adds a claim's capacity, available bytes and inodes to KubernetesResource, nullable", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "KubernetesResource" ADD "latestVolumeCapacityBytes" bigint`,
      `ALTER TABLE "KubernetesResource" ADD "latestVolumeAvailableBytes" bigint`,
      `ALTER TABLE "KubernetesResource" ADD "latestVolumeInodes" bigint`,
      `ALTER TABLE "KubernetesResource" ADD "latestVolumeInodesFree" bigint`,
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
      `ALTER TABLE "KubernetesResource" DROP COLUMN "latestVolumeInodesFree"`,
      `ALTER TABLE "KubernetesResource" DROP COLUMN "latestVolumeInodes"`,
      `ALTER TABLE "KubernetesResource" DROP COLUMN "latestVolumeAvailableBytes"`,
      `ALTER TABLE "KubernetesResource" DROP COLUMN "latestVolumeCapacityBytes"`,
    ]);
  });

  test.each(COLUMNS)(
    "the model declares %s: a big number nobody but OneUptime writes, read as the other metric columns are",
    (column: string) => {
      const model: KubernetesResource = new KubernetesResource();

      expect(model.getTableColumns().columns).toContain(column);
      expect(model.getTableColumnMetadata(column).type).toBe(
        TableColumnType.BigPositiveNumber,
      );
      expect(model.getTableColumnMetadata(column).required).toBeFalsy();
      expect(model.getColumnAccessControlFor(column)?.create).toEqual([]);
      expect(model.getColumnAccessControlFor(column)?.update).toEqual([]);
      expect(model.getColumnAccessControlFor(column)?.read).toEqual(
        model.getColumnAccessControlFor("latestMemoryBytes")?.read,
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
    expect(new AddKubernetesVolumeClaimUsage1809184859539().name).toBe(
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
