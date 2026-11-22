import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AllowDataSecurityAiProposalsForStoresAndRules1809187421200 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187421200-AllowDataSecurityAiProposalsForStoresAndRules";
import DataSecurityAiProposal from "../../../../Models/DatabaseModels/DataSecurityAiProposal";

/*
 * The migration behind OneUptime AI's owner proposals (#10374): a store
 * with no sensitive data has no issue its owners' proposal belongs to, and
 * an owner rule is for many stores at once, so a proposal's issue - and,
 * for a rule, its store - may be empty.
 *
 * The statements are executed against a fake QueryRunner, so up() and
 * down() are told apart. Up is two DROP NOT NULLs - metadata only, no row
 * read or rewritten - and keeps both columns' foreign keys and the issue's
 * index, which the generator dropped and re-created around them: adding a
 * foreign key again on a table that holds rows would check every row
 * under a lock. The schema drift check holds the result to the model.
 */

const MIGRATION_TIMESTAMP: string = "1809187421200";
const MIGRATION_BASE_NAME: string =
  "AllowDataSecurityAiProposalsForStoresAndRules";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
const MIGRATION_BEFORE: string = "AddDetectionRuleLastFailedAt1809187421140";

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
    new AllowDataSecurityAiProposalsForStoresAndRules1809187421200();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AllowDataSecurityAiProposalsForStoresAndRules1809187421200", () => {
  test("lets a proposal have no issue and no store, and does nothing else", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "DataSecurityAiProposal" ALTER COLUMN "dataSecurityIssueId" DROP NOT NULL`,
      `ALTER TABLE "DataSecurityAiProposal" ALTER COLUMN "dataStoreId" DROP NOT NULL`,
    ]);
  });

  test("keeps the foreign keys and the index: nothing is dropped, built or scanned", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CONSTRAINT|FOREIGN KEY|INDEX|UPDATE |DELETE |DEFAULT/i,
      );
    }
  });

  test("down removes the proposals the old schema cannot hold, then puts both constraints back", async () => {
    expect(await statementsOf("down")).toEqual([
      `DELETE FROM "DataSecurityAiProposal" WHERE "dataSecurityIssueId" IS NULL OR "dataStoreId" IS NULL`,
      `ALTER TABLE "DataSecurityAiProposal" ALTER COLUMN "dataStoreId" SET NOT NULL`,
      `ALTER TABLE "DataSecurityAiProposal" ALTER COLUMN "dataSecurityIssueId" SET NOT NULL`,
    ]);
  });

  test("the model says the issue and the store are optional, and may be empty", () => {
    const model: DataSecurityAiProposal = new DataSecurityAiProposal();

    for (const column of ["dataSecurityIssueId", "dataStoreId"]) {
      expect([column, model.getTableColumnMetadata(column).required]).toEqual([
        column,
        false,
      ]);
    }
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
    expect(
      new AllowDataSecurityAiProposalsForStoresAndRules1809187421200().name,
    ).toBe(MIGRATION_CLASS_NAME);
    expect(names.indexOf(MIGRATION_CLASS_NAME)).toBeGreaterThan(
      names.indexOf(MIGRATION_BEFORE),
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
          return value < Number(MIGRATION_TIMESTAMP);
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
