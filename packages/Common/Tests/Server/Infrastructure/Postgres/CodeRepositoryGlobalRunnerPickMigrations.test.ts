import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddCodeRepositoryGlobalRunnerPick1807700000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1807700000000-AddCodeRepositoryGlobalRunnerPick";
import { KeepCodeRepositoriesOnGlobalRunners1807710000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1807710000000-KeepCodeRepositoriesOnGlobalRunners";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { KUBERNETES_AGENT_RUNNER_NAME_PATTERN } from "../../../../Server/Utils/AI/CodeFix/CodeFixClaimQuery";

/*
 * A code repository that picks no Runner follows its project's default
 * Runner (Types/Runner/CodeRepositoryRunner). Two migrations, in order:
 *
 *   - AddCodeRepositoryGlobalRunnerPick: "isGlobalRunnerPicked", whether a
 *     repository picked the Global Runner itself - nullable, no default, so
 *     no row is rewritten. Generated with npm run
 *     generate-postgres-migration.
 *   - KeepCodeRepositoriesOnGlobalRunners: a repository that picks no
 *     Runner in a project that already has a default Runner ran on a global
 *     Runner before; it is written as having picked the Global Runner, so
 *     none moves at the upgrade. Hand-written: it changes data.
 *
 * The statements are EXECUTED against a fake QueryRunner, so up() and
 * down() are told apart; CodeRepositoryDefaultRunnerPostgres runs them on a
 * real Postgres, on seeded rows.
 */

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

// A migration's 13-digit timestamp, read off its class name.
const TIMESTAMP_OF_NAME: RegExp = /(\d{13})$/;

async function statementsOf(
  migration: MigrationInterface,
  direction: "up" | "down",
): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

function registeredNames(): Array<string> {
  return (SchemaMigrations as Array<{ name: string }>).map(
    (migration: { name: string }): string => {
      return migration.name;
    },
  );
}

describe("AddCodeRepositoryGlobalRunnerPick1807700000000", () => {
  test("adds a nullable boolean with no default, and nothing else", async () => {
    expect(
      await statementsOf(
        new AddCodeRepositoryGlobalRunnerPick1807700000000(),
        "up",
      ),
    ).toEqual([
      `ALTER TABLE "CodeRepository" ADD "isGlobalRunnerPicked" boolean`,
    ]);
  });

  test("down drops it", async () => {
    expect(
      await statementsOf(
        new AddCodeRepositoryGlobalRunnerPick1807700000000(),
        "down",
      ),
    ).toEqual([
      `ALTER TABLE "CodeRepository" DROP COLUMN "isGlobalRunnerPicked"`,
    ]);
  });

  test("matches the model it was generated from: optional, no default, read only for a repository that picks no Runner", () => {
    const repository: CodeRepository = new CodeRepository();
    const column: ReturnType<typeof repository.getTableColumnMetadata> =
      repository.getTableColumnMetadata("isGlobalRunnerPicked");

    expect(column.type).toBe(TableColumnType.Boolean);
    expect(column.required).toBeFalsy();
    expect(column.isDefaultValueColumn).toBeFalsy();
    expect(column.defaultValue).toBeUndefined();
    expect(column.title).toBe("Picks Global Runner");
    expect(column.description).toContain(
      "Read only when the repository picks no Runner of its own.",
    );
    expect(column.description).toContain(
      "Unset, a repository that picks no Runner follows the project's default Runner",
    );
  });

  test("whoever reads, creates or edits a repository's Runner does the same with it", () => {
    const repository: CodeRepository = new CodeRepository();

    for (const action of ["create", "read", "update"] as const) {
      expect(
        repository.getColumnAccessControlFor("isGlobalRunnerPicked")?.[action],
      ).toEqual(repository.getColumnAccessControlFor("runnerId")?.[action]);
    }
  });
});

describe("KeepCodeRepositoriesOnGlobalRunners1807710000000", () => {
  test("writes true only for a repository that picks no Runner and never said, in a project with a default Runner by the rule a default must meet", async () => {
    const statements: Array<string> = await statementsOf(
      new KeepCodeRepositoriesOnGlobalRunners1807710000000(),
      "up",
    );

    expect(statements).toEqual([
      `UPDATE "CodeRepository" AS "codeRepository" SET "isGlobalRunnerPicked" = true WHERE "codeRepository"."runnerId" IS NULL AND "codeRepository"."isGlobalRunnerPicked" IS NULL AND EXISTS (SELECT 1 FROM "Runner" AS "defaultRunner" WHERE "defaultRunner"."projectId" = "codeRepository"."projectId" AND "defaultRunner"."isProjectDefault" = true AND "defaultRunner"."deletedAt" IS NULL AND "defaultRunner"."isGlobalRunner" IS NOT TRUE AND "defaultRunner"."canRunRunbooks" IS NOT FALSE AND COALESCE(lower(btrim("defaultRunner"."name")), '') NOT LIKE 'kubernetes-agent/%')`,
    ]);

    // The in-cluster agent Runner's name, as the claim reads it.
    expect(statements[0]).toContain(
      `'${KUBERNETES_AGENT_RUNNER_NAME_PATTERN}'`,
    );
  });

  test("down does nothing: the repositories it wrote run where they ran before it", async () => {
    expect(
      await statementsOf(
        new KeepCodeRepositoriesOnGlobalRunners1807710000000(),
        "down",
      ),
    ).toEqual([]);
  });
});

describe("registration", () => {
  test("both are registered, in order, the column before the data", () => {
    const names: Array<string> = registeredNames();
    const add: number = names.indexOf(
      "AddCodeRepositoryGlobalRunnerPick1807700000000",
    );
    const keep: number = names.indexOf(
      "KeepCodeRepositoriesOnGlobalRunners1807710000000",
    );

    expect(add).toBeGreaterThan(-1);
    expect(keep).toBe(add + 1);
  });

  test("each class's name ends in its file's timestamp, and its file is the one Index.ts imports", () => {
    for (const [name, file] of [
      [
        "AddCodeRepositoryGlobalRunnerPick1807700000000",
        "1807700000000-AddCodeRepositoryGlobalRunnerPick.ts",
      ],
      [
        "KeepCodeRepositoriesOnGlobalRunners1807710000000",
        "1807710000000-KeepCodeRepositoriesOnGlobalRunners.ts",
      ],
    ] as const) {
      expect(TIMESTAMP_OF_NAME.exec(name)?.[1]).toBe(file.substring(0, 13));
      expect(fs.existsSync(path.join(MIGRATION_DIRECTORY, file))).toBe(true);
    }
  });

  test("the data migration is never online DDL: it builds no index and adds no key", () => {
    const source: string = fs.readFileSync(
      path.join(
        MIGRATION_DIRECTORY,
        "1807710000000-KeepCodeRepositoriesOnGlobalRunners.ts",
      ),
      "utf-8",
    );

    expect(source).not.toContain("CREATE INDEX");
    expect(source).not.toContain("FOREIGN KEY");
  });
});
