import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import {
  AddCodeTasks1803950000000,
  CODE_TASK_BACKFILL_FROM_GITHUB_COMMANDS,
  CODE_TASK_BACKFILL_FROM_PULL_REQUESTS,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1803950000000-AddCodeTasks";
import { AddCodeTaskIndexesAndKey1804000000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1804000000000-AddCodeTaskIndexesAndKey";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import { getTableColumns } from "../../../../Types/Database/TableColumn";
import { MigrationInterface, QueryRunner } from "typeorm";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The two migrations behind Code: the AIRun columns a task needs (its
 * repository, its turns, its title, whether it waits for an answer, what a
 * turn ended with and its diff), the backfill that puts existing code-fix
 * runs on their repository's page, and - in a migration of its own, outside
 * a transaction - the indexes and the foreign key, built online on a table
 * every AI feature writes to.
 *
 * Statements are recorded against a fake QueryRunner; CodeTaskPostgres.test.ts
 * runs the backfills on Postgres.
 */

const COLUMNS_MIGRATION: string = "AddCodeTasks1803950000000";
const KEYS_MIGRATION: string = "AddCodeTaskIndexesAndKey1804000000000";
const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;

type MigrationClass = new () => MigrationInterface;

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

describe("the Code migrations", () => {
  test("name themselves after their timestamps", () => {
    expect(new AddCodeTasks1803950000000().name).toBe(COLUMNS_MIGRATION);
    expect(new AddCodeTaskIndexesAndKey1804000000000().name).toBe(
      KEYS_MIGRATION,
    );
  });

  test("are registered once each, the keys right after the columns, after every older migration", () => {
    const registered: Array<MigrationClass> =
      SchemaMigrations as Array<MigrationClass>;
    const columnsAt: number = registered.indexOf(AddCodeTasks1803950000000);
    const keysAt: number = registered.indexOf(
      AddCodeTaskIndexesAndKey1804000000000,
    );

    expect(
      registered.filter((migration: MigrationClass): boolean => {
        return (
          migration === AddCodeTasks1803950000000 ||
          migration === AddCodeTaskIndexesAndKey1804000000000
        );
      }),
    ).toHaveLength(2);
    expect(columnsAt).toBeGreaterThan(0);
    expect(keysAt).toBe(columnsAt + 1);

    for (let before: number = 0; before < columnsAt; before++) {
      expect(timestampOf(registered[before]!)).toBeLessThan(
        timestampOf(AddCodeTasks1803950000000),
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

    for (const migration of [
      AddCodeTasks1803950000000,
      AddCodeTaskIndexesAndKey1804000000000,
    ]) {
      const timestamp: string = `${timestampOf(migration)}-`;

      expect(
        files.filter((file: string): boolean => {
          return file.startsWith(timestamp);
        }),
      ).toHaveLength(1);
    }
  });

  test("add the columns the AIRun model declares, without rewriting the table, then backfill", async () => {
    expect(await record(new AddCodeTasks1803950000000(), "up")).toEqual([
      `ALTER TABLE "AIRun" ADD "codeRepositoryId" uuid`,
      `ALTER TABLE "AIRun" ADD "codeTaskId" uuid`,
      `ALTER TABLE "AIRun" ADD "title" character varying(500)`,
      `ALTER TABLE "AIRun" ADD "needsUserInput" boolean NOT NULL DEFAULT false`,
      `ALTER TABLE "AIRun" ADD "taskOutcome" jsonb`,
      `ALTER TABLE "AIRun" ADD "codeChanges" jsonb`,
      CODE_TASK_BACKFILL_FROM_PULL_REQUESTS,
      CODE_TASK_BACKFILL_FROM_GITHUB_COMMANDS,
    ]);

    const columns: Array<string> = Object.keys(getTableColumns(new AIRun()));

    for (const column of [
      "codeRepositoryId",
      "codeTaskId",
      "title",
      "needsUserInput",
      "taskOutcome",
      "codeChanges",
    ]) {
      expect(columns).toContain(column);
    }
  });

  test("the backfills touch only code-fix runs with no repository, and never cross a project", () => {
    for (const backfill of [
      CODE_TASK_BACKFILL_FROM_PULL_REQUESTS,
      CODE_TASK_BACKFILL_FROM_GITHUB_COMMANDS,
    ]) {
      expect(backfill).toContain(`"run"."runType" = 'CodeFix'`);
      expect(backfill).toContain(`"run"."codeRepositoryId" IS NULL`);
    }

    expect(CODE_TASK_BACKFILL_FROM_PULL_REQUESTS).toContain(
      `"run"."projectId" = "pullRequest"."projectId"`,
    );
    expect(CODE_TASK_BACKFILL_FROM_PULL_REQUESTS).toContain(
      `ORDER BY "aiRunId", "createdAt" DESC`,
    );
    expect(CODE_TASK_BACKFILL_FROM_GITHUB_COMMANDS).toContain(
      `"repository"."projectId" = "run"."projectId"`,
    );
    // Text compared with text: a malformed id in the JSON cannot fail the cast.
    expect(CODE_TASK_BACKFILL_FROM_GITHUB_COMMANDS).toContain(
      `("run"."taskContext" -> 'github' ->> 'codeRepositoryId') = "repository"."_id"::text`,
    );
  });

  test("drop exactly what they added", async () => {
    expect(await record(new AddCodeTasks1803950000000(), "down")).toEqual([
      `ALTER TABLE "AIRun" DROP COLUMN "codeChanges"`,
      `ALTER TABLE "AIRun" DROP COLUMN "taskOutcome"`,
      `ALTER TABLE "AIRun" DROP COLUMN "needsUserInput"`,
      `ALTER TABLE "AIRun" DROP COLUMN "title"`,
      `ALTER TABLE "AIRun" DROP COLUMN "codeTaskId"`,
      `ALTER TABLE "AIRun" DROP COLUMN "codeRepositoryId"`,
    ]);
  });

  test("build the indexes and the key online, outside a transaction", async () => {
    const migration: AddCodeTaskIndexesAndKey1804000000000 =
      new AddCodeTaskIndexesAndKey1804000000000();

    expect(migration.transaction).toBe(false);
    expect(await record(migration, "up")).toEqual([
      `online: CREATE INDEX "IDX_fa2f2ed227f46283753c04de74" ON "AIRun" ("codeRepositoryId") `,
      `online: CREATE INDEX "IDX_f77e615edd01ea057a25209683" ON "AIRun" ("codeTaskId") `,
      `online: ALTER TABLE "AIRun" ADD CONSTRAINT "FK_fa2f2ed227f46283753c04de74f" FOREIGN KEY ("codeRepositoryId") REFERENCES "CodeRepository"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    ]);
  });

  test("removing a repository keeps its tasks: the key sets their repository to null", async () => {
    const steps: Array<string> = await record(
      new AddCodeTaskIndexesAndKey1804000000000(),
      "up",
    );

    expect(
      steps.filter((step: string): boolean => {
        return step.includes("FOREIGN KEY");
      })[0],
    ).toContain("ON DELETE SET NULL");
  });

  test("undo the keys and indexes", async () => {
    expect(
      await record(new AddCodeTaskIndexesAndKey1804000000000(), "down"),
    ).toEqual([
      `ALTER TABLE "AIRun" DROP CONSTRAINT "FK_fa2f2ed227f46283753c04de74f"`,
      `online: DROP INDEX "public"."IDX_f77e615edd01ea057a25209683"`,
      `online: DROP INDEX "public"."IDX_fa2f2ed227f46283753c04de74"`,
    ]);
  });
});
