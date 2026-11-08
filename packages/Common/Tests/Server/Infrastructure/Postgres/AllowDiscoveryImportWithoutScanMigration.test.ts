import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AllowDiscoveryImportWithoutScan1808997600000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808997600000-AllowDiscoveryImportWithoutScan";
import NetworkDeviceDiscoveryImport from "../../../../Models/DatabaseModels/NetworkDeviceDiscoveryImport";

/*
 * The migration behind importing devices from the Discovered Devices list
 * (issue #5775): such an import has no discovery scan, so the import's scan
 * id may be empty.
 *
 * The statements are executed against a fake QueryRunner, so up() and
 * down() are told apart. Up is one DROP NOT NULL - metadata only, no row
 * read or rewritten - and keeps the column's foreign key and index that the
 * generator dropped and re-created around it: re-adding a foreign key on a
 * table that holds rows would check every row under a lock. The schema drift
 * check holds the result to the models.
 */

const MIGRATION_TIMESTAMP: string = "1808997600000";
const MIGRATION_BASE_NAME: string = "AllowDiscoveryImportWithoutScan";
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
    new AllowDiscoveryImportWithoutScan1808997600000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AllowDiscoveryImportWithoutScan1808997600000", () => {
  test("lets an import have no scan, and does nothing else", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "NetworkDeviceDiscoveryImport" ALTER COLUMN "networkDeviceDiscoveryScanId" DROP NOT NULL`,
    ]);
  });

  test("keeps the scan's foreign key and index: nothing is dropped, built or scanned", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CONSTRAINT|FOREIGN KEY|INDEX|UPDATE |DELETE |DEFAULT/i,
      );
    }
  });

  test("down removes the imports the old schema cannot hold, then puts the constraint back", async () => {
    expect(await statementsOf("down")).toEqual([
      `DELETE FROM "NetworkDeviceDiscoveryImport" WHERE "networkDeviceDiscoveryScanId" IS NULL`,
      `ALTER TABLE "NetworkDeviceDiscoveryImport" ALTER COLUMN "networkDeviceDiscoveryScanId" SET NOT NULL`,
    ]);
  });

  test("the model says the scan id is optional", () => {
    const model: NetworkDeviceDiscoveryImport =
      new NetworkDeviceDiscoveryImport();

    expect(
      model.getTableColumnMetadata("networkDeviceDiscoveryScanId").required,
    ).toBe(false);
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
    expect(new AllowDiscoveryImportWithoutScan1808997600000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(names.indexOf(MIGRATION_CLASS_NAME)).toBeGreaterThan(
      names.indexOf("AddEvaluationDetailsAndKeepResponseContent1808997300000"),
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
          return value <= 1808997300000;
        }),
      ),
    );
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
