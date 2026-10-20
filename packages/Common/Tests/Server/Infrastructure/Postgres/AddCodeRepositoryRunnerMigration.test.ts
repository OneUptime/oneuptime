import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import {
  AddCodeRepositoryRunner1804300000000,
  CODE_REPOSITORY_RUNNER_BACKFILL,
  CODE_REPOSITORY_RUNNER_RESTORE_SWITCH,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1804300000000-AddCodeRepositoryRunner";
import { AddCodeRepositoryRunnerIndexAndKey1804350000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1804350000000-AddCodeRepositoryRunnerIndexAndKey";
import { IS_KUBERNETES_AGENT_RUNNER_SQL } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1796800000000-FoldAiSwitchesIntoEnableAi";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import Runner from "../../../../Models/DatabaseModels/Runner";
import { getTableColumns } from "../../../../Types/Database/TableColumn";
import { MigrationInterface, QueryRunner } from "typeorm";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The two migrations behind a code repository's Runner setting: the
 * repository gets the Runner AI works in it on (CodeRepository.runnerId,
 * empty for a global Runner), each project's choice of Runner for AI code
 * fixes is carried over to its repositories, and the Runner's "Runs AI Code
 * Fixes" switch (Runner.canRunCodeFixTasks) goes - and, in a migration of
 * its own, outside a transaction, the column's index and its foreign key to
 * "Runner", built online on a table projects already have repositories in.
 *
 * Statements are recorded against a fake QueryRunner;
 * AddCodeRepositoryRunnerPostgres.test.ts runs both on Postgres, on rows.
 */

const COLUMN_MIGRATION: string = "AddCodeRepositoryRunner1804300000000";
const KEY_MIGRATION: string = "AddCodeRepositoryRunnerIndexAndKey1804350000000";
const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;

const INDEX: string = `CREATE INDEX "IDX_119124a9f13918c61c08e91ec9" ON "CodeRepository" ("runnerId") `;
const FOREIGN_KEY: string = `ALTER TABLE "CodeRepository" ADD CONSTRAINT "FK_119124a9f13918c61c08e91ec96" FOREIGN KEY ("runnerId") REFERENCES "Runner"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`;

type MigrationClass = new () => MigrationInterface;

const MIGRATIONS: Array<MigrationClass> = [
  AddCodeRepositoryRunner1804300000000,
  AddCodeRepositoryRunnerIndexAndKey1804350000000,
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

describe("the code repository Runner migrations", () => {
  test("name themselves after their timestamps", () => {
    expect(new AddCodeRepositoryRunner1804300000000().name).toBe(
      COLUMN_MIGRATION,
    );
    expect(new AddCodeRepositoryRunnerIndexAndKey1804350000000().name).toBe(
      KEY_MIGRATION,
    );
  });

  test("are registered once each, the index and key right after the column, after every older migration", () => {
    const registered: Array<MigrationClass> =
      SchemaMigrations as Array<MigrationClass>;
    const at: number = registered.indexOf(AddCodeRepositoryRunner1804300000000);

    for (const migration of MIGRATIONS) {
      expect(
        registered.filter((candidate: MigrationClass): boolean => {
          return candidate === migration;
        }),
      ).toHaveLength(1);
    }

    expect(at).toBeGreaterThan(0);
    expect(registered[at + 1]).toBe(
      AddCodeRepositoryRunnerIndexAndKey1804350000000,
    );
    expect(
      timestampOf(AddCodeRepositoryRunnerIndexAndKey1804350000000),
    ).toBeGreaterThan(timestampOf(AddCodeRepositoryRunner1804300000000));

    for (let before: number = 0; before < at; before++) {
      expect(timestampOf(registered[before]!)).toBeLessThan(
        timestampOf(AddCodeRepositoryRunner1804300000000),
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

  test("add the repository's Runner, carry the choice over, then drop the switch", async () => {
    expect(
      await record(new AddCodeRepositoryRunner1804300000000(), "up"),
    ).toEqual([
      `ALTER TABLE "CodeRepository" ADD "runnerId" uuid`,
      CODE_REPOSITORY_RUNNER_BACKFILL,
      `ALTER TABLE "Runner" DROP COLUMN "canRunCodeFixTasks"`,
    ]);
  });

  test("build the column's index and its key online, outside a transaction", async () => {
    const migration: AddCodeRepositoryRunnerIndexAndKey1804350000000 =
      new AddCodeRepositoryRunnerIndexAndKey1804350000000();

    expect(migration.transaction).toBe(false);
    expect(await record(migration, "up")).toEqual([
      `online: ${INDEX}`,
      `online: ${FOREIGN_KEY}`,
    ]);
  });

  test("a deleted Runner leaves its repositories picking none: the key sets their Runner to null", () => {
    expect(FOREIGN_KEY).toContain(`REFERENCES "Runner"("_id")`);
    expect(FOREIGN_KEY).toContain("ON DELETE SET NULL");
  });

  test("down gives the switch back to the Runners repositories pick before the column goes", async () => {
    expect(
      await record(new AddCodeRepositoryRunner1804300000000(), "down"),
    ).toEqual([
      `ALTER TABLE "Runner" ADD "canRunCodeFixTasks" boolean NOT NULL DEFAULT false`,
      CODE_REPOSITORY_RUNNER_RESTORE_SWITCH,
      `ALTER TABLE "CodeRepository" DROP COLUMN "runnerId"`,
    ]);
  });

  test("undo the key and the index", async () => {
    expect(
      await record(
        new AddCodeRepositoryRunnerIndexAndKey1804350000000(),
        "down",
      ),
    ).toEqual([
      `ALTER TABLE "CodeRepository" DROP CONSTRAINT "FK_119124a9f13918c61c08e91ec96"`,
      `online: DROP INDEX "public"."IDX_119124a9f13918c61c08e91ec9"`,
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
