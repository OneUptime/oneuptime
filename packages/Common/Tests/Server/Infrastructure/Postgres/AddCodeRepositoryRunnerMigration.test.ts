import {
  AddCodeRepositoryRunner1804300000000,
  CODE_REPOSITORY_RUNNER_BACKFILL,
  CODE_REPOSITORY_RUNNER_RESTORE_SWITCH,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1804300000000-AddCodeRepositoryRunner";
import { IS_KUBERNETES_AGENT_RUNNER_SQL } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1796800000000-FoldAiSwitchesIntoEnableAi";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import Runner from "../../../../Models/DatabaseModels/Runner";
import { getTableColumns } from "../../../../Types/Database/TableColumn";
import { MigrationInterface, QueryRunner } from "typeorm";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration behind a code repository's Runner setting: the repository
 * gets the Runner AI works in it on (CodeRepository.runnerId, empty for a
 * global Runner), each project's choice of Runner for AI code fixes is
 * carried over to its repositories, and the Runner's "Runs AI Code Fixes"
 * switch (Runner.canRunCodeFixTasks) goes.
 *
 * Statements are recorded against a fake QueryRunner;
 * AddCodeRepositoryRunnerPostgres.test.ts runs them on Postgres, on rows.
 */

const MIGRATION: string = "AddCodeRepositoryRunner1804300000000";
const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;

type MigrationClass = new () => MigrationInterface;

async function record(direction: "up" | "down"): Promise<Array<string>> {
  const steps: Array<string> = [];

  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      steps.push(sql);
    },
  } as unknown as QueryRunner;

  const migration: AddCodeRepositoryRunner1804300000000 =
    new AddCodeRepositoryRunner1804300000000();

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

describe("the AddCodeRepositoryRunner migration", () => {
  test("names itself after its timestamp", () => {
    expect(new AddCodeRepositoryRunner1804300000000().name).toBe(MIGRATION);
  });

  test("is registered once, after every older migration", () => {
    const registered: Array<MigrationClass> =
      SchemaMigrations as Array<MigrationClass>;
    const at: number = registered.indexOf(AddCodeRepositoryRunner1804300000000);

    expect(
      registered.filter((migration: MigrationClass): boolean => {
        return migration === AddCodeRepositoryRunner1804300000000;
      }),
    ).toHaveLength(1);
    expect(at).toBeGreaterThan(0);

    for (let before: number = 0; before < at; before++) {
      expect(timestampOf(registered[before]!)).toBeLessThan(
        timestampOf(AddCodeRepositoryRunner1804300000000),
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
          `${timestampOf(AddCodeRepositoryRunner1804300000000)}-`,
        );
      }),
    ).toHaveLength(1);
  });

  test("adds the repository's Runner, carries the choice over, then drops the switch", async () => {
    expect(await record("up")).toEqual([
      `ALTER TABLE "CodeRepository" ADD "runnerId" uuid`,
      `CREATE INDEX "IDX_119124a9f13918c61c08e91ec9" ON "CodeRepository" ("runnerId") `,
      `ALTER TABLE "CodeRepository" ADD CONSTRAINT "FK_119124a9f13918c61c08e91ec96" FOREIGN KEY ("runnerId") REFERENCES "Runner"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
      CODE_REPOSITORY_RUNNER_BACKFILL,
      `ALTER TABLE "Runner" DROP COLUMN "canRunCodeFixTasks"`,
    ]);
  });

  test("down gives the switch back to the Runners repositories pick before the column goes", async () => {
    expect(await record("down")).toEqual([
      `ALTER TABLE "Runner" ADD "canRunCodeFixTasks" boolean NOT NULL DEFAULT false`,
      CODE_REPOSITORY_RUNNER_RESTORE_SWITCH,
      `ALTER TABLE "CodeRepository" DROP CONSTRAINT "FK_119124a9f13918c61c08e91ec96"`,
      `DROP INDEX "public"."IDX_119124a9f13918c61c08e91ec9"`,
      `ALTER TABLE "CodeRepository" DROP COLUMN "runnerId"`,
    ]);
  });

  test("the models match: the repository has its Runner, a Runner has no switch", () => {
    expect(Object.keys(getTableColumns(new CodeRepository()))).toEqual(
      expect.arrayContaining(["runner", "runnerId"]),
    );
    expect(Object.keys(getTableColumns(new Runner()))).not.toContain(
      "canRunCodeFixTasks",
    );
  });

  describe("the backfill", () => {
    const sql: string = CODE_REPOSITORY_RUNNER_BACKFILL;

    test("reads only Runners that could take code-fix work", () => {
      for (const condition of [
        `runner."canRunCodeFixTasks" = true`,
        `runner."projectId" IS NOT NULL`,
        `runner."isGlobalRunner" = false`,
        `runner."deletedAt" IS NULL`,
        `runner."lastAlive" IS NOT NULL`,
        // The agent-row predicate an earlier migration holds to the server's rule.
        `AND NOT ${IS_KUBERNETES_AGENT_RUNNER_SQL}`,
      ]) {
        expect(sql).toContain(condition);
      }
    });

    test("takes one Runner a project: alive most recently, then the oldest, then by id", () => {
      expect(sql).toContain(`SELECT DISTINCT ON (runner."projectId")`);
      expect(sql).toContain(
        `ORDER BY runner."projectId", runner."lastAlive" DESC, runner."createdAt" ASC, runner."_id" ASC`,
      );
    });

    test("writes only the project's own repositories that pick none, and no deleted one", () => {
      expect(sql).toMatch(
        /^UPDATE "CodeRepository" AS "repository" SET "runnerId" = "chosen"."runnerId"/,
      );
      expect(sql).toContain(
        `WHERE "repository"."projectId" = "chosen"."projectId" AND "repository"."runnerId" IS NULL AND "repository"."deletedAt" IS NULL`,
      );
    });
  });

  test("down's data step: every Runner a live repository picks", () => {
    expect(CODE_REPOSITORY_RUNNER_RESTORE_SWITCH).toBe(
      `UPDATE "Runner" AS "runner" SET "canRunCodeFixTasks" = true WHERE EXISTS (SELECT 1 FROM "CodeRepository" AS "repository" WHERE "repository"."runnerId" = "runner"."_id" AND "repository"."deletedAt" IS NULL)`,
    );
  });
});
