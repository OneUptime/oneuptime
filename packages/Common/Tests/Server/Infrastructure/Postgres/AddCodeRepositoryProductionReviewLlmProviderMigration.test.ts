import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddCodeRepositoryProductionReviewLlmProvider1808330000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808330000000-AddCodeRepositoryProductionReviewLlmProvider";
import { AddCodeRepositoryProductionReviewLlmProviderIndexAndKey1808340000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808340000000-AddCodeRepositoryProductionReviewLlmProviderIndexAndKey";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { MigrationInterface, QueryRunner } from "typeorm";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The two migrations behind a repository's production review LLM provider
 * (CodeRepository.productionReviewLlmProviderId): the column, nullable with
 * nothing to backfill - every repository picks none, the project's default
 * provider, as every review used before - and, in a migration of its own,
 * outside a transaction, its index and its foreign key to "LlmProvider"
 * built online, ON DELETE SET NULL, so a deleted provider leaves its
 * repositories picking none.
 *
 * Statements are recorded against a fake QueryRunner;
 * AddCodeRepositoryProductionReviewLlmProviderPostgres.test.ts runs both on
 * Postgres, on rows.
 */

const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;

const INDEX: string = `CREATE INDEX "IDX_0d6102e35d45ec40768554266e" ON "CodeRepository" ("productionReviewLlmProviderId") `;
const FOREIGN_KEY: string = `ALTER TABLE "CodeRepository" ADD CONSTRAINT "FK_0d6102e35d45ec40768554266e0" FOREIGN KEY ("productionReviewLlmProviderId") REFERENCES "LlmProvider"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`;

type MigrationClass = new () => MigrationInterface;

const MIGRATIONS: Array<MigrationClass> = [
  AddCodeRepositoryProductionReviewLlmProvider1808330000000,
  AddCodeRepositoryProductionReviewLlmProviderIndexAndKey1808340000000,
];

async function record(
  migration: MigrationInterface,
  direction: "up" | "down",
): Promise<Array<string>> {
  const steps: Array<string> = [];

  const runner: QueryRunner = {
    isTransactionActive: false,
    query: async (sql: string): Promise<void> => {
      steps.push(sql);
    },
  } as unknown as QueryRunner;

  for (const step of ["createIndex", "addForeignKey", "dropIndex"] as const) {
    jest.spyOn(OnlineDdl, step).mockImplementation((async (
      _runner: QueryRunner,
      statement: string,
    ) => {
      steps.push(`online: ${statement}`);
    }) as never);
  }

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

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the production reviews' LLM provider migrations", () => {
  test("name themselves after their timestamps", () => {
    expect(
      new AddCodeRepositoryProductionReviewLlmProvider1808330000000().name,
    ).toBe("AddCodeRepositoryProductionReviewLlmProvider1808330000000");
    expect(
      new AddCodeRepositoryProductionReviewLlmProviderIndexAndKey1808340000000()
        .name,
    ).toBe(
      "AddCodeRepositoryProductionReviewLlmProviderIndexAndKey1808340000000",
    );
  });

  test("are registered once each, after every migration before them, the key right after the column", () => {
    const registered: Array<MigrationClass> =
      SchemaMigrations as Array<MigrationClass>;
    const at: number = registered.indexOf(
      AddCodeRepositoryProductionReviewLlmProvider1808330000000,
    );

    expect(at).toBeGreaterThan(0);

    for (const migration of MIGRATIONS) {
      expect(
        registered.filter((candidate: MigrationClass): boolean => {
          return candidate === migration;
        }),
      ).toHaveLength(1);
    }

    expect(registered[at + 1]).toBe(
      AddCodeRepositoryProductionReviewLlmProviderIndexAndKey1808340000000,
    );
    expect(
      timestampOf(
        AddCodeRepositoryProductionReviewLlmProviderIndexAndKey1808340000000,
      ),
    ).toBeGreaterThan(
      timestampOf(AddCodeRepositoryProductionReviewLlmProvider1808330000000),
    );

    for (let before: number = 0; before < at; before++) {
      expect(timestampOf(registered[before]!)).toBeLessThan(
        timestampOf(AddCodeRepositoryProductionReviewLlmProvider1808330000000),
      );
    }
  });

  test("are backed by exactly one file each", () => {
    const files: Array<string> = fs.readdirSync(
      path.join(
        __dirname,
        "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
      ),
    );

    for (const migration of MIGRATIONS) {
      expect(
        files.filter((file: string): boolean => {
          return file.startsWith(`${timestampOf(migration)}-`);
        }),
      ).toHaveLength(1);
    }
  });

  test("add the pick to the repository - nullable, with nothing to backfill", async () => {
    expect(
      await record(
        new AddCodeRepositoryProductionReviewLlmProvider1808330000000(),
        "up",
      ),
    ).toEqual([
      `ALTER TABLE "CodeRepository" ADD "productionReviewLlmProviderId" uuid`,
    ]);
  });

  test("build its index and key online, outside a transaction", async () => {
    const migration: AddCodeRepositoryProductionReviewLlmProviderIndexAndKey1808340000000 =
      new AddCodeRepositoryProductionReviewLlmProviderIndexAndKey1808340000000();

    expect(migration.transaction).toBe(false);
    expect(await record(migration, "up")).toEqual([
      `online: ${INDEX}`,
      `online: ${FOREIGN_KEY}`,
    ]);
    // A deleted provider leaves its repositories picking none.
    expect(FOREIGN_KEY).toContain(`REFERENCES "LlmProvider"("_id")`);
    expect(FOREIGN_KEY).toContain("ON DELETE SET NULL");
  });

  test("down takes the key and index away, then the column", async () => {
    expect(
      await record(
        new AddCodeRepositoryProductionReviewLlmProviderIndexAndKey1808340000000(),
        "down",
      ),
    ).toEqual([
      `ALTER TABLE "CodeRepository" DROP CONSTRAINT "FK_0d6102e35d45ec40768554266e0"`,
      `online: DROP INDEX "public"."IDX_0d6102e35d45ec40768554266e"`,
    ]);

    expect(
      await record(
        new AddCodeRepositoryProductionReviewLlmProvider1808330000000(),
        "down",
      ),
    ).toEqual([
      `ALTER TABLE "CodeRepository" DROP COLUMN "productionReviewLlmProviderId"`,
    ]);
  });
});

describe("the repository's production review LLM provider", () => {
  const repository: CodeRepository = new CodeRepository();

  test("is a relation to a provider, read and written as the repository's other review settings are", () => {
    const relation: ReturnType<CodeRepository["getTableColumnMetadata"]> =
      repository.getTableColumnMetadata("productionReviewLlmProvider");
    const id: ReturnType<CodeRepository["getTableColumnMetadata"]> =
      repository.getTableColumnMetadata("productionReviewLlmProviderId");

    expect(relation.type).toBe(TableColumnType.Entity);
    expect(relation.modelType).toBe(LlmProvider);
    expect(relation.manyToOneRelationColumn).toBe(
      "productionReviewLlmProviderId",
    );
    expect(id.type).toBe(TableColumnType.ObjectID);
    expect(id.required).toBeFalsy();

    for (const column of [
      "productionReviewLlmProvider",
      "productionReviewLlmProviderId",
    ]) {
      expect(repository.getColumnAccessControlFor(column)).toEqual(
        repository.getColumnAccessControlFor(
          "productionReviewPullRequestContent",
        ),
      );
    }
  });

  test("says what empty means", () => {
    for (const column of [
      "productionReviewLlmProvider",
      "productionReviewLlmProviderId",
    ]) {
      expect(repository.getTableColumnMetadata(column).description).toContain(
        "Empty: the project's default provider, else the global one.",
      );
    }
  });
});
